'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import Comments from '@/components/Comments'

const GROUPS = [
  { key: 'new_group24848', title: 'Stocked in Warehouse', color: '#175a63' },
  { key: 'new_group12084', title: 'Scrapped (Regranulated & Disposed)', color: '#df2f4a' },
]

const STATUS_COLORS: Record<string, string> = {
  'Shipped': '#00c875',
  'Stocked in Warehouse': '#175a63',
  'On HOLD': '#bb3354',
  'Recycled': '#037f4c',
  'Donation': '#faa1f1',
  'Awaiting Production': '#ff007f',
  'In Production': '#216edf',
  'Waiting for LTL Pick-Up': '#333333',
  'Ready at Will Call': '#9d50dd',
}
const PROD_COLORS: Record<string, string> = {
  'Production Complete': '#00c875',
  'Production Queue': '#037f4c',
  'Production In Progress': '#579bfc',
  'Back Ordered': '#df2f4a',
  'Needs Packaging': '#ffcb00',
  'Completed and Picked Up': '#ff007f',
}
const statusColor = (s: string | null) => (s && STATUS_COLORS[s]) || '#c4c4c4'
const fmtDate = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

export default function PrivateLabelStockPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [orders, setOrders] = useState<any[]>([])
  const [items, setItems] = useState<any[]>([])
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [detail, setDetail] = useState<any | null>(null)
  const [userEmail, setUserEmail] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: o }, { data: it }, { data: cm }] = await Promise.all([
      sb.from('pl_stock_orders').select('*').order('position', { nullsFirst: false }),
      sb.from('pl_stock_order_items').select('*').order('position', { nullsFirst: false }),
      sb.from('comments').select('record_id').eq('record_type', 'pl_stock_order'),
    ])
    setOrders(o || []); setItems(it || [])
    const counts: Record<string, number> = {}
    ;(cm || []).forEach((c: any) => { counts[c.record_id] = (counts[c.record_id] || 0) + 1 })
    setCommentCounts(counts)
    setLoading(false)
    sb.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email) })
  }, [sb])
  useEffect(() => { load() }, [load])

  const itemsOf = (oid: string) => items.filter(i => i.parent_id === oid).sort((a, b) => (a.position || 0) - (b.position || 0))
  const match = (r: any) => {
    if (!q) return true
    const s = q.toLowerCase()
    return ['name', 'status', 'po_number', 'customer_email', 'shipping_address'].some(k => String(r[k] ?? '').toLowerCase().includes(s))
      || itemsOf(r.id).some(i => String(i.part_number ?? '').toLowerCase().includes(s))
  }
  const groupRows = (key: string) => orders.filter(r => r.group_key === key && match(r))

  const total = orders.length
  const detailItems = detail ? itemsOf(detail.id) : []

  return (
    <div className="min-h-screen mon-page p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <span className="mon-tag t-blue">🏷️ Private Label Stock</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">Private Label Stock</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${total} orders`}</p>
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search orders, P/N, PO#…" className="bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm w-full sm:w-72 focus:outline-none focus:ring-2 focus:ring-[#3B6FE0]/40" />
      </div>

      <div className="space-y-4">
        {GROUPS.map(group => {
          const gr = groupRows(group.key)
          const isCol = collapsed[group.key]
          return (
            <div key={group.key} className="bg-white rounded-xl overflow-hidden shadow-sm border border-[#ECEEF3]">
              <div className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none" style={{ background: group.color + '14', borderLeft: '5px solid ' + group.color }} onClick={() => setCollapsed(c => ({ ...c, [group.key]: !c[group.key] }))}>
                <span className="text-[10px]" style={{ color: group.color, display: 'inline-block', transform: isCol ? 'none' : 'rotate(90deg)' }}>&#9654;</span>
                <span className="font-bold text-sm" style={{ color: group.color }}>{group.title}</span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: group.color + '26', color: group.color }}>{gr.length}</span>
              </div>
              {!isCol && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[900px]">
                    <thead>
                      <tr className="text-[11px] uppercase text-gray-400 border-b border-[#EEF0F4]">
                        <th className="text-left px-4 py-2 font-semibold">Order</th>
                        <th className="text-left px-3 py-2 font-semibold w-[110px]">Order Date</th>
                        <th className="text-left px-3 py-2 font-semibold w-[170px]">Status</th>
                        <th className="text-left px-3 py-2 font-semibold w-[70px]">Details</th>
                        <th className="text-left px-3 py-2 font-semibold w-[120px]">PO #</th>
                        <th className="text-left px-3 py-2 font-semibold w-[90px]">Files</th>
                        <th className="text-left px-3 py-2 font-semibold w-[90px]">Comments</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gr.map((r, i) => {
                        const its = itemsOf(r.id)
                        const nFiles = (r.order_form_files?.length || 0) + (r.so_files?.length || 0)
                        const nc = commentCounts[r.id] || 0
                        return (
                          <tr key={r.id} className={`cursor-pointer hover:bg-[#F2F6FF] ${i % 2 ? 'bg-[#F8FAFC]' : 'bg-white'}`} onClick={() => setDetail(r)}>
                            <td className="px-4 py-2.5 font-semibold text-[#1A1D2E]">{r.name}</td>
                            <td className="px-3 py-2.5 text-gray-600">{fmtDate(r.order_date)}</td>
                            <td className="px-3 py-2.5"><span className="text-white text-[11px] font-semibold rounded-full px-2.5 py-1 inline-block" style={{ background: statusColor(r.status) }}>{r.status || '—'}</span></td>
                            <td className="px-3 py-2.5 text-gray-600">{its.length ? `${its.length} item${its.length > 1 ? 's' : ''}` : '—'}</td>
                            <td className="px-3 py-2.5 text-gray-600">{r.po_number || '—'}</td>
                            <td className="px-3 py-2.5">{nFiles ? <span className="text-[#3B6FE0] text-xs font-semibold">📎 {nFiles}</span> : <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-2.5">{nc ? <span className="text-emerald-600 text-xs font-semibold">💬 {nc}</span> : <span className="text-gray-300">—</span>}</td>
                          </tr>
                        )
                      })}
                      {gr.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400 text-sm">No orders</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: 'rgba(26,32,53,0.5)' }} onClick={() => setDetail(null)}>
          <div className="relative w-full max-w-[840px] my-6 bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between px-6 py-4 text-white" style={{ background: '#175a63' }}>
              <div className="min-w-0">
                <p className="text-white/70 text-xs uppercase tracking-wide">{detail.group_title}</p>
                <h2 className="text-xl font-bold leading-tight">{detail.name}</h2>
                <span className="inline-block mt-1.5 text-[11px] font-semibold rounded-full px-2.5 py-0.5" style={{ background: statusColor(detail.status), color: '#fff' }}>{detail.status || '—'}</span>
              </div>
              <button onClick={() => setDetail(null)} className="text-white/80 hover:text-white text-2xl leading-none">&times;</button>
            </div>

            <div className="px-6 py-4 max-h-[75vh] overflow-y-auto space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                <Field label="Order Date" value={fmtDate(detail.order_date)} />
                <Field label="Ship Due Date" value={fmtDate(detail.ship_due_date)} />
                <Field label="PO #" value={detail.po_number} />
                <Field label="Customer Email" value={detail.customer_email} />
                <Field label="Shipping Address" value={detail.shipping_address} wide />
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Order Details</p>
                {detailItems.length === 0 ? <p className="text-sm text-gray-400">No line items.</p> : (
                  <div className="border border-[#EEF0F4] rounded-lg overflow-x-auto">
                    <table className="w-full text-sm min-w-[640px]">
                      <thead><tr className="bg-[#FBFCFE] text-[11px] uppercase text-gray-400">
                        <th className="text-left px-3 py-2">P/N</th>
                        <th className="text-right px-3 py-2">Qty</th>
                        <th className="text-left px-3 py-2">Production Status</th>
                        <th className="text-right px-3 py-2">Completed</th>
                        <th className="text-left px-3 py-2">UOM</th>
                        <th className="text-right px-3 py-2">Cost Each</th>
                        <th className="text-right px-3 py-2">Total</th>
                      </tr></thead>
                      <tbody>
                        {detailItems.map(it => (
                          <tr key={it.id} className="border-t border-[#F0F2F6]">
                            <td className="px-3 py-2 font-mono text-emerald-700">{it.part_number || it.name || '—'}</td>
                            <td className="px-3 py-2 text-right">{it.qty || '—'}</td>
                            <td className="px-3 py-2">{it.production_status ? <span className="text-white text-[10px] font-semibold rounded-full px-2 py-0.5" style={{ background: PROD_COLORS[it.production_status] || '#c4c4c4' }}>{it.production_status}</span> : '—'}</td>
                            <td className="px-3 py-2 text-right">{it.completed_qty || '—'}</td>
                            <td className="px-3 py-2">{it.uom || '—'}</td>
                            <td className="px-3 py-2 text-right">{it.cost_each ? `$${it.cost_each}` : '—'}</td>
                            <td className="px-3 py-2 text-right">{it.total_cost ? `$${it.total_cost}` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {detailItems.some(it => it.added_details) && (
                  <div className="mt-2 space-y-1">
                    {detailItems.filter(it => it.added_details).map(it => (
                      <p key={it.id} className="text-xs text-gray-500"><span className="font-mono text-emerald-700">{it.part_number || it.name}</span>: {it.added_details}</p>
                    ))}
                  </div>
                )}
              </div>

              {((detail.order_form_files?.length || 0) + (detail.so_files?.length || 0)) > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Files</p>
                  <div className="flex flex-wrap gap-2">
                    {[...(detail.order_form_files || []).map((f: any) => ({ ...f, tag: 'Order Form' })), ...(detail.so_files || []).map((f: any) => ({ ...f, tag: 'SO' }))].map((f: any, idx: number) => (
                      <a key={idx} href={f.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-xs bg-[#F5F7FB] border border-[#E4E6EE] rounded-lg px-3 py-2 hover:bg-[#EAF0FC]">
                        <span className="text-[#3B6FE0]">📄</span>
                        <span className="min-w-0"><span className="block font-semibold text-gray-700 truncate max-w-[240px]">{f.name}</span><span className="text-[10px] text-gray-400">{f.tag}</span></span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t border-[#EEF0F4] pt-4">
                <Comments recordId={detail.id} recordType="pl_stock_order" currentUserEmail={userEmail} title="Notes & Comments" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, wide }: { label: string; value: any; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2 sm:col-span-3' : ''}>
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-gray-800 mt-0.5">{value || <span className="text-gray-300">—</span>}</p>
    </div>
  )
}
