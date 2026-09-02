'use client'
import { useEffect, useState, useCallback } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import OrdersMirror from '@/components/OrdersMirror'
import Comments from '@/components/Comments'
import FileUpload from '@/components/FileUpload'
import { useItemDeepLink } from '@/components/useItemDeepLink'
import { checkOrderReadyToShip } from '@/lib/orderFlow'

const sb = createSupabaseBrowserClient()

const STATUS_OPTIONS = ['Queued', 'In Progress', 'QC', 'QC Passed', 'Complete', 'On Hold', 'Cancelled'] as const
const DONE_STATUSES = ['QC Passed', 'Complete']

interface WO {
  id: string
  wo_number: string | number
  sales_order_id: string | null
  status: string
  notes: string | null
  created_at: string
  sales_orders?: { order_number: string; customers?: { company_name: string } } | null
}

function statusClass(status: string) {
  if (DONE_STATUSES.includes(status)) return 'bg-green-100 text-green-700'
  if (status === 'In Progress') return 'bg-blue-100 text-blue-700'
  if (status === 'QC') return 'bg-purple-100 text-purple-700'
  if (status === 'On Hold') return 'bg-amber-100 text-amber-700'
  if (status === 'Cancelled') return 'bg-gray-200 text-gray-600'
  return 'bg-yellow-100 text-yellow-700'
}

export default function WorkOrdersPage() {
  const [orders, setOrders] = useState<WO[]>([])
  const [loading, setLoading] = useState(true)
  const [userEmail, setUserEmail] = useState('')
  const [detail, setDetail] = useState<WO | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await sb
      .from('work_orders')
      .select('*, sales_orders(order_number, customers(company_name))')
      .order('created_at', { ascending: false })
    setOrders((data as WO[]) || [])
    setLoading(false)
    sb.auth.getUser().then(({ data: u }) => { if (u.user?.email) setUserEmail(u.user.email) })
  }, [])

  useEffect(() => { load() }, [load])

  const openDetail = useCallback((wo: WO) => setDetail(wo), [])
  useItemDeepLink(orders, openDetail)

  async function setStatus(wo: WO, status: string) {
    if (!status || status === wo.status) return
    setOrders(os => os.map(o => (o.id === wo.id ? { ...o, status } : o)))
    setDetail(d => (d && d.id === wo.id ? { ...d, status } : d))
    await sb.from('work_orders').update({ status, updated_at: new Date().toISOString() }).eq('id', wo.id)
    // Ultron: keep the linked Sales Order in step — advance it when the work order is done.
    if (DONE_STATUSES.includes(status) && wo.sales_order_id) {
      try { await checkOrderReadyToShip(wo.sales_order_id) } catch { /* non-blocking */ }
    }
  }

  const q = orders.filter(o => o.status === 'Queued')
  const ip = orders.filter(o => ['In Progress', 'QC', 'On Hold'].includes(o.status))
  const done = orders.filter(o => DONE_STATUSES.includes(o.status))

  const StatusSelect = ({ wo, full }: { wo: WO; full?: boolean }) => {
    const known = (STATUS_OPTIONS as readonly string[]).includes(wo.status)
    return (
      <select
        value={known ? wo.status : ''}
        onChange={e => setStatus(wo, e.target.value)}
        onClick={e => e.stopPropagation()}
        className={`${full ? 'w-full px-3 py-2' : 'px-2 py-1.5'} text-sm border border-gray-200 rounded-lg bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500`}
      >
        {!known && <option value="">{wo.status || '—'}</option>}
        {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
    )
  }

  return (
    <div className="min-h-screen p-8 bg-gray-50">
      <p className="text-xs font-semibold text-emerald-600 uppercase tracking-widest mb-1">PRODUCTION</p>
      <h1 className="text-3xl font-bold text-gray-900 mb-4">Work Orders</h1>

      <div className="mb-4 rounded-lg bg-[#10B981]/10 border border-[#10B981]/25 text-[12px] text-[#0f7a5a] px-3 py-2">🔗 Ultron — status is editable inline and on each record; notes &amp; comments sync two-way with the Sales / Production boards.</div>

      {/* Sales orders currently in production (mirrored from Sales Orders) */}
      <OrdersMirror statuses={['Production Queue', 'In Production']} title="Sales Orders in Production" tagClass="t-orange" emoji="🏭" />

      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Queued', count: q.length, cls: 'bg-yellow-50 border-yellow-200 text-yellow-700' },
          { label: 'In Progress / QC', count: ip.length, cls: 'bg-blue-50 border-blue-200 text-blue-700' },
          { label: 'Done', count: done.length, cls: 'bg-green-50 border-green-200 text-green-700' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl border p-5 ${s.cls}`}>
            <p className="text-sm font-medium">{s.label}</p>
            <p className="text-3xl font-bold mt-1">{s.count}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">Loading...</div>
      ) : (
        <div className="space-y-3">
          {orders.map(wo => (
            <div key={wo.id} id={`item-${wo.id}`} className="bg-white rounded-xl border border-gray-100 p-5 flex items-center justify-between shadow-sm hover:border-gray-200 transition-colors">
              <div className="min-w-0 cursor-pointer" onClick={() => openDetail(wo)}>
                <div className="flex items-center gap-3 mb-1">
                  <span className="font-bold text-gray-900">WO-{wo.wo_number}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusClass(wo.status)}`}>{wo.status}</span>
                </div>
                <p className="text-sm text-gray-500">SO: {wo.sales_orders?.order_number ?? '—'} &middot; {wo.sales_orders?.customers?.company_name ?? '—'}</p>
                {wo.notes && <p className="text-xs text-gray-400 mt-1 truncate max-w-2xl">{wo.notes}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <StatusSelect wo={wo} />
                <button onClick={() => openDetail(wo)} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">View</button>
              </div>
            </div>
          ))}
          {orders.length === 0 && <div className="text-center py-20 text-gray-400">No work orders yet.</div>}
        </div>
      )}

      {/* Detail record (Ultron) */}
      {detail && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setDetail(null)} />
          <div className="fixed inset-y-0 right-0 w-full md:w-[560px] bg-white z-50 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 shrink-0">
              <div>
                <h2 className="text-gray-900 font-semibold">WO-{detail.wo_number}</h2>
                <p className="text-xs text-gray-500 mt-0.5">SO: {detail.sales_orders?.order_number ?? '—'} · {detail.sales_orders?.customers?.company_name ?? '—'}</p>
              </div>
              <button onClick={() => setDetail(null)} className="text-gray-500 hover:text-gray-700 p-1 rounded-lg hover:bg-gray-50">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Status</label>
                <StatusSelect wo={detail} full />
              </div>
              {detail.notes && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Work Order Notes</label>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg p-3">{detail.notes}</p>
                </div>
              )}
              <div className="border-t border-gray-100 pt-4">
                <FileUpload supabase={sb} recordType="work_order" recordId={detail.id} currentUserEmail={userEmail} />
              </div>
              <div className="border-t border-gray-100 pt-4">
                {/* Two-way sync with the linked Sales Order thread (Ultron) */}
                <Comments recordId={detail.sales_order_id ?? detail.id} recordType={detail.sales_order_id ? 'sales_order' : 'work_order'} currentUserEmail={userEmail} title="Notes & Comments" />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
