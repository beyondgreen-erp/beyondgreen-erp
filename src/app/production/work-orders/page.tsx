'use client'
import { useEffect, useState, useCallback } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import OrdersMirror from '@/components/OrdersMirror'
import Comments from '@/components/Comments'
import FileUpload from '@/components/FileUpload'
import { useItemDeepLink } from '@/components/useItemDeepLink'
import { checkOrderReadyToShip } from '@/lib/orderFlow'
import ExportButton from '@/components/ExportButton'

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
  const [woProduct, setWoProduct] = useState<{ sku: string; product_name: string | null; on_hand_qty: number | null; unit_of_measure: string | null } | null>(null)
  const [fgMoves, setFgMoves] = useState<{ created_at: string; qty: number; uom: string | null; created_by: string | null }[]>([])
  const [booking, setBooking] = useState(false)
  const [negStock, setNegStock] = useState<{ sku: string; product_name: string | null; on_hand_qty: number | null }[]>([])
  const fmtN = (n: any) => (n === null || n === undefined || n === '') ? '\u2014' : Number(n).toLocaleString()
  const fgBooked = fgMoves.reduce((s, m) => s + Number(m.qty || 0), 0)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await sb
      .from('work_orders')
      .select('*, sales_orders!work_orders_sales_order_id_fkey(order_number, customers(company_name))')
      .order('created_at', { ascending: false })
    setOrders((data as WO[]) || [])
    const { data: neg } = await sb.from('products').select('sku,product_name,on_hand_qty').lt('on_hand_qty', 0).order('on_hand_qty', { ascending: true }).limit(50)
    setNegStock((neg as any[]) || [])
    setLoading(false)
    sb.auth.getUser().then(({ data: u }) => { if (u.user?.email) setUserEmail(u.user.email) })
  }, [])

  useEffect(() => { load() }, [load])

  // Load the linked finished-goods product + any FG already booked from this work order.
  useEffect(() => {
    if (!detail) { setWoProduct(null); setFgMoves([]); return }
    const pid = (detail as any).product_id as string | null
    ;(async () => {
      if (pid) {
        const { data: pr } = await sb.from('products').select('sku,product_name,on_hand_qty,unit_of_measure').eq('id', pid).maybeSingle()
        setWoProduct((pr as any) || null)
      } else setWoProduct(null)
      const { data: mv } = await sb.from('inventory_movements').select('created_at,qty,uom,created_by').eq('ref_table', 'work_orders').eq('ref_id', detail.id).eq('movement_type', 'produce').order('created_at')
      setFgMoves((mv as any[]) || [])
    })()
  }, [detail])

  const openDetail = useCallback((wo: WO) => setDetail(wo), [])
  useItemDeepLink(orders, openDetail)

  // Ultron: clicking a production order opens (creating if needed) its work-order record in place.
  const openForOrder = useCallback(async (soId: string) => {
    let wo = orders.find(o => o.sales_order_id === soId)
    if (!wo) {
      const { data } = await sb
        .from('work_orders')
        .insert({ sales_order_id: soId, order_id: soId, status: 'Queued' })
        .select('*, sales_orders!work_orders_sales_order_id_fkey(order_number, customers(company_name))')
        .single()
      if (data) { wo = data as WO; setOrders(os => [wo as WO, ...os]) }
    }
    if (wo) setDetail(wo)
  }, [orders])

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

  // Explicit \u201cClose & Book FG\u201d \u2014 books produced finished goods into inventory with a ledger entry (idempotent per booking).
  async function bookFG() {
    if (!detail) return
    const pid = (detail as any).product_id
    if (!pid) { alert('No finished-goods product is linked to this work order, so there is nothing to book. Link a product on the order first.'); return }
    const remaining = Math.max(0, Number((detail as any).qty_ordered || 0) - fgBooked)
    const suggested = remaining || Number((detail as any).qty_ordered || 0) || ''
    const input = window.prompt('Quantity of finished goods to book into inventory for WO-' + detail.wo_number + ':', String(suggested))
    if (input == null) return
    const qty = Number(input)
    if (!qty || qty <= 0) { alert('Enter a quantity greater than zero.'); return }
    setBooking(true)
    try {
      const { data, error } = await sb.rpc('post_wo_fg', { p_wo_id: detail.id, p_qty: qty, p_user: userEmail || null })
      if (error) { alert('Could not book finished goods: ' + error.message); return }
      const r: any = data
      alert('\u2713 Booked ' + qty + ' into inventory for ' + (r?.sku || 'item') + '. On-hand is now ' + (r?.on_hand ?? '\u2014') + '.')
      const { data: pr } = await sb.from('products').select('sku,product_name,on_hand_qty,unit_of_measure').eq('id', pid).maybeSingle()
      setWoProduct((pr as any) || null)
      const { data: mv } = await sb.from('inventory_movements').select('created_at,qty,uom,created_by').eq('ref_table', 'work_orders').eq('ref_id', detail.id).eq('movement_type', 'produce').order('created_at')
      setFgMoves((mv as any[]) || [])
      load()
    } catch (e: any) { alert('Could not book finished goods: ' + (e?.message || e)) }
    finally { setBooking(false) }
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
      <ExportButton rows={orders} name="Work Orders" />
      <p className="text-xs font-semibold text-emerald-600 uppercase tracking-widest mb-1">PRODUCTION</p>
      <h1 className="text-3xl font-bold text-gray-900 mb-4">Work Orders</h1>

      <div className="mb-4 rounded-lg bg-[#10B981]/10 border border-[#10B981]/25 text-[12px] text-[#0f7a5a] px-3 py-2">🔗 Ultron — status is editable inline and on each record; notes &amp; comments sync two-way with the Sales / Production boards.</div>

      {negStock.length > 0 && (
        <div className="mb-4 rounded-lg bg-amber-50 border border-amber-300 text-[12px] text-amber-800 px-3 py-2">
          <span className="font-semibold">⚠ {negStock.length} item{negStock.length > 1 ? 's' : ''} negative on-hand</span> — finished goods likely shipped but never booked from production. Open the item’s work order and use “Close &amp; Book FG” to correct it.
          <div className="mt-1 text-amber-700">{negStock.slice(0, 12).map(n => `${n.sku} (${n.on_hand_qty})`).join(', ')}{negStock.length > 12 ? ', …' : ''}</div>
        </div>
      )}

      {/* Sales orders currently in production (mirrored from Sales Orders) */}
      <OrdersMirror statuses={['Production Queue', 'In Production']} title="Sales Orders in Production" tagClass="t-orange" emoji="🏭" onRowClick={openForOrder} />

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
            <div key={wo.id} id={`item-${wo.id}`} onClick={() => openDetail(wo)} className="bg-white rounded-xl border border-gray-100 p-5 flex items-center justify-between shadow-sm hover:border-gray-200 hover:shadow transition-all cursor-pointer">
              <div className="min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <span className="font-bold text-gray-900">WO-{wo.wo_number}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusClass(wo.status)}`}>{wo.status}</span>
                </div>
                <p className="text-sm text-gray-500">SO: {wo.sales_orders?.order_number ?? '—'} &middot; {wo.sales_orders?.customers?.company_name ?? '—'}</p>
                {wo.notes && <p className="text-xs text-gray-400 mt-1 truncate max-w-2xl">{wo.notes}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
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
                <label className="block text-xs text-gray-400 mb-1.5">Finished Goods \u2192 Inventory</label>
                {(detail as any).product_id ? (
                  <div className="text-sm text-gray-700 space-y-1">
                    <p><span className="font-mono text-emerald-700">{woProduct?.sku ?? '\u2014'}</span>{woProduct?.product_name ? ' \u00b7 ' + woProduct.product_name : ''}</p>
                    <p className="text-xs text-gray-500">Ordered {fmtN((detail as any).qty_ordered)} \u00b7 Booked to inventory {fmtN(fgBooked)} \u00b7 On hand {fmtN(woProduct?.on_hand_qty)}</p>
                    {fgMoves.length > 0 && (
                      <ul className="text-xs text-gray-500 mt-1 space-y-0.5">
                        {fgMoves.map((m, i) => (<li key={i}>+{fmtN(m.qty)} {m.uom || ''} \u00b7 {new Date(m.created_at).toLocaleDateString()}{m.created_by ? ' \u00b7 ' + m.created_by : ''}</li>))}
                      </ul>
                    )}
                    <button onClick={bookFG} disabled={booking} className="mt-2 px-3 py-2 text-sm rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-500 disabled:opacity-50">{booking ? 'Booking\u2026' : 'Close & Book FG'}</button>
                  </div>
                ) : (
                  <p className="text-xs text-amber-600">No finished-goods product is linked to this work order, so FG can\u2019t be booked to inventory. Link a product on the order first.</p>
                )}
              </div>
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
