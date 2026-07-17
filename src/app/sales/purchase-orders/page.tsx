'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { getFileUrl } from '@/lib/fileHelpers'
import Comments from '@/components/Comments'

const GROUPS = [
  { key: 'group_mkr363e4', title: 'Imports', color: '#007eb5' },
  { key: 'group_mkzk3jaa', title: '2026 - PO & Receiving Log', color: '#00c875' },
  { key: 'new_group_mkkttdvf', title: '2025 - PO & Receiving Log', color: '#fdab3d' },
  { key: 'group_mkq991my', title: 'Receiving Log', color: '#5559df' },
]

const STATUS_COLORS: Record<string, string> = {
  'PO Issued': '#fdab3d', 'Received': '#00c875', 'In Transit - Ocean / Air': '#df2f4a', 'Delayed': '#bb3354',
  'Short Ship': '#9d50dd', 'PO Canceled': '#7f5347', 'Partial Received': '#579bfc', "Verification Req'd": '#ff007f',
  'Awaiting Shipment': '#ffcb00', 'Pending Review': '#333333', 'Ready for Pick-Up': '#4eccc6', 'Order Placed': '#cab641',
  'Pending Order': '#ff6d3b', 'Missing Item': '#784bd1', 'Return': '#ff5ac4', 'Vendor Shipped': '#66ccff',
  'In Transit - Domestic Road': '#7e3b8a', 'In Making': '#037f4c', 'PO Merged with Export Invoice': '#9cd326',
  'ON HOLD': '#ff7575', 'Awaiting Release': '#faa1f1', 'Arrived at Port': '#ffadad', 'Released awaiting to ship': '#bda8f9',
}
const LOC_COLORS: Record<string, string> = {
  'SAN ANTONIO, TX': '#5559df', 'SANTA ANA, CA': '#00c875', 'SNA -> SATX': '#df2f4a', 'SNA & SATX': '#007eb5',
}
const statusColor = (s: string | null) => (s && STATUS_COLORS[s]) || '#c4c4c4'
const fmtDate = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

export default function PurchasingRequestsPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<any[]>([])
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
      sb.from('purchasing_requests').select('*').order('position', { nullsFirst: false }),
      sb.from('purchasing_request_items').select('*').order('position', { nullsFirst: false }),
      sb.from('comments').select('record_id').eq('record_type', 'purchasing_request'),
    ])
    setRows(o || []); setItems(it || [])
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
    return ['name', 'status', 'location', 'po_number', 'supplier', 'supplier_pn', 'person_requesting', 'customer_project', 'batch_lot', 'received_by'].some(k => String(r[k] ?? '').toLowerCase().includes(s))
      || itemsOf(r.id).some(i => [i.part_number, i.description].some(v => String(v ?? '').toLowerCase().includes(s)))
  }
  const groupRows = (key: string) => rows.filter(r => r.group_key === key && match(r))
  const filesOf = (r: any) => [...((r.receiving_docs || []) as any[]).map((f: any) => ({ ...f, tag: 'Receiving Doc' })), ...((r.attachments || []) as any[]).map((f: any) => ({ ...f, tag: 'From Comments' }))]

  async function openFile(f: any) {
    const url = await getFileUrl(sb, f.path)
    if (url) window.open(url, '_blank'); else alert('Could not open the file.')
  }

  const total = rows.length
  const detailItems = detail ? itemsOf(detail.id) : []
  const detailFiles = detail ? filesOf(detail) : []

  return (
    <div className="min-h-screen mon-page p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <span className="mon-tag t-blue">🧾 Purchasing</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">Purchasing Requests</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${total} requests`}</p>
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search item, PO#, supplier, person…" className="bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm w-full sm:w-72 focus:outline-none focus:ring-2 focus:ring-[#3B6FE0]/40" />
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
                  <table className="w-full text-sm min-w-[1150px]">
                    <thead>
                      <tr className="text-[11px] uppercase text-gray-400 border-b border-[#EEF0F4]">
                        <th className="text-left px-4 py-2 font-semibold">Item</th>
                        <th className="text-left px-3 py-2 font-semibold w-[140px]">Location</th>
                        <th className="text-left px-3 py-2 font-semibold w-[200px]">Status</th>
                        <th className="text-left px-3 py-2 font-semibold w-[130px]">Requested By</th>
                        <th className="text-left px-3 py-2 font-semibold w-[110px]">PO #</th>
                        <th className="text-left px-3 py-2 font-semibold w-[140px]">Supplier</th>
                        <th className="text-left px-3 py-2 font-semibold w-[100px]">PO Date</th>
                        <th className="text-left px-3 py-2 font-semibold w-[70px]">Details</th>
                        <th className="text-left px-3 py-2 font-semibold w-[70px]">Files</th>
                        <th className="text-left px-3 py-2 font-semibold w-[80px]">Comments</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gr.map((r, i) => {
                        const its = itemsOf(r.id)
                        const nFiles = filesOf(r).length
                        const nc = commentCounts[r.id] || 0
                        return (
                          <tr key={r.id} className={`cursor-pointer hover:bg-[#F2F6FF] ${i % 2 ? 'bg-[#F8FAFC]' : 'bg-white'}`} onClick={() => setDetail(r)}>
                            <td className="px-4 py-2.5 font-semibold text-[#1A1D2E]">{r.name}</td>
                            <td className="px-3 py-2.5">{r.location ? <span className="text-white text-[10px] font-semibold rounded-full px-2 py-0.5 inline-block whitespace-nowrap" style={{ background: LOC_COLORS[r.location] || '#c4c4c4' }}>{r.location}</span> : <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-2.5">{r.status ? <span className="text-white text-[11px] font-semibold rounded-full px-2.5 py-1 inline-block whitespace-nowrap" style={{ background: statusColor(r.status) }}>{r.status}</span> : <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-2.5 text-gray-600">{r.person_requesting || '—'}</td>
                            <td className="px-3 py-2.5 text-gray-600">{r.po_number || '—'}</td>
                            <td className="px-3 py-2.5 text-gray-600">{r.supplier || '—'}</td>
                            <td className="px-3 py-2.5 text-gray-600">{fmtDate(r.po_date) || '—'}</td>
                            <td className="px-3 py-2.5 text-gray-600">{its.length ? `${its.length} item${its.length > 1 ? 's' : ''}` : '—'}</td>
                            <td className="px-3 py-2.5">{nFiles ? <span className="text-[#3B6FE0] text-xs font-semibold">📎 {nFiles}</span> : <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-2.5">{nc ? <span className="text-emerald-600 text-xs font-semibold">💬 {nc}</span> : <span className="text-gray-300">—</span>}</td>
                          </tr>
                        )
                      })}
                      {gr.length === 0 && <tr><td colSpan={10} className="px-4 py-6 text-center text-gray-400 text-sm">No requests</td></tr>}
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
          <div className="relative w-full max-w-[860px] my-6 bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between px-6 py-4 text-white" style={{ background: (GROUPS.find(g => g.key === detail.group_key)?.color) || '#5559df' }}>
              <div className="min-w-0">
                <p className="text-white/70 text-xs uppercase tracking-wide">{detail.group_title}</p>
                <h2 className="text-xl font-bold leading-tight">{detail.name}</h2>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  {detail.status && <span className="inline-block text-[11px] font-semibold rounded-full px-2.5 py-0.5" style={{ background: statusColor(detail.status), color: '#fff' }}>{detail.status}</span>}
                  {detail.location && <span className="inline-block text-[11px] font-semibold rounded-full px-2.5 py-0.5 bg-white/20">{detail.location}</span>}
                </div>
              </div>
              <button onClick={() => setDetail(null)} className="text-white/80 hover:text-white text-2xl leading-none">&times;</button>
            </div>

            <div className="px-6 py-4 max-h-[75vh] overflow-y-auto space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                <Field label="Requested By" value={detail.person_requesting} />
                <Field label="PO Required?" value={detail.po_required} />
                <Field label="PO Number" value={detail.po_number} />
                <Field label="Customer / Project" value={detail.customer_project} />
                <Field label="Supplier" value={detail.supplier} />
                <Field label="Supplier P/N" value={detail.supplier_pn} />
                <Field label="PO Date" value={fmtDate(detail.po_date)} />
                <Field label="Qty Ordered" value={detail.qty_ordered} />
                <Field label="Date Received" value={fmtDate(detail.date_received)} />
                <Field label="Qty Received" value={detail.qty_received} />
                <Field label="Balance" value={detail.balance} />
                <Field label="# of Pkgs Rec'd" value={detail.pkgs_received} />
                <Field label="Condition Rec'd" value={detail.condition_received} />
                <Field label="Received By" value={detail.received_by} />
                <Field label="Batch / Lot No." value={detail.batch_lot} />
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Order Details</p>
                {detailItems.length === 0 ? <p className="text-sm text-gray-400">No line items.</p> : (
                  <div className="border border-[#EEF0F4] rounded-lg overflow-x-auto">
                    <table className="w-full text-sm min-w-[640px]">
                      <thead><tr className="bg-[#FBFCFE] text-[11px] uppercase text-gray-400">
                        <th className="text-left px-3 py-2">P/N</th>
                        <th className="text-left px-3 py-2">Description</th>
                        <th className="text-right px-3 py-2">Qty Ordered</th>
                        <th className="text-left px-3 py-2">Date Ordered</th>
                        <th className="text-right px-3 py-2">Total Received</th>
                        <th className="text-left px-3 py-2">Date Received</th>
                        <th className="text-right px-3 py-2">Balance</th>
                      </tr></thead>
                      <tbody>
                        {detailItems.map(it => (
                          <tr key={it.id} className="border-t border-[#F0F2F6]">
                            <td className="px-3 py-2 font-mono text-emerald-700">{it.part_number || it.name || '—'}</td>
                            <td className="px-3 py-2 text-gray-600">{it.description || '—'}</td>
                            <td className="px-3 py-2 text-right">{it.qty_ordered || '—'}</td>
                            <td className="px-3 py-2">{fmtDate(it.date_ordered) || '—'}</td>
                            <td className="px-3 py-2 text-right">{it.total_received || '—'}</td>
                            <td className="px-3 py-2">{fmtDate(it.date_received) || '—'}</td>
                            <td className="px-3 py-2 text-right">{it.balance || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {detailFiles.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Files ({detailFiles.length})</p>
                  <div className="flex flex-wrap gap-2">
                    {detailFiles.map((f: any, idx: number) => (
                      <button key={idx} onClick={() => openFile(f)} className="flex items-center gap-2 text-xs bg-[#F5F7FB] border border-[#E4E6EE] rounded-lg px-3 py-2 hover:bg-[#EAF0FC] text-left">
                        <span className="text-[#3B6FE0]">📄</span>
                        <span className="min-w-0"><span className="block font-semibold text-gray-700 truncate max-w-[240px]">{f.name}</span><span className="text-[10px] text-gray-400">{f.tag}</span></span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t border-[#EEF0F4] pt-4">
                <Comments recordId={detail.id} recordType="purchasing_request" currentUserEmail={userEmail} title="Notes & Comments" />
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
