'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import ShareLink from '@/components/ShareLink'
import { useItemDeepLink } from '@/components/useItemDeepLink'
import Comments from '@/components/Comments'
import FileUpload from '@/components/FileUpload'
import { statusColor } from '@/lib/statusColors'

interface WLine {
  id?: string; _new?: boolean; part_number: string | null; qty: number | null; qty_per_case: number | null
  completed_qty: number | null; uom: string | null; packaging: string | null; production_status: string | null
  cost_each: string | null; total_cost: string | null; added_details: string | null; line_number?: number | null
}
interface WOrder {
  id: string; monday_item_id: string | null; name: string; group_name: string | null; status: string | null
  order_date: string | null; ship_due_date: string | null; load_number: string | null; facility: string | null
  srp: number | null; units: number | null; pallets: string | null; work_order: string | null; lot: string | null
  po_number: string | null; ship_to: string | null; ship_from: string | null; bol_date: string | null; bol2: string | null
  carrier: string | null; trailer_no: string | null; seal_number: string | null; special_instructions: string | null
  qty: number | null; pkg_type: string | null; qty2: number | null; pkg_type2: string | null; weight: number | null
  commodity_description: string | null; total_value: number | null; do_not_delete: string | null; board_position: number | null
}

const GROUPS = [
  { key: 'Walmart Orders', color: '#0086C0' },
  { key: 'Ready for Shipment', color: '#00A84F' },
  { key: 'Prepped & Ready for Dispatch', color: '#A25DDC' },
  { key: 'Cancelled', color: '#E2445C' },
]
const STATUS_OPTIONS = ['Waiting for PU', 'Shipped', 'ON HOLD', 'Waiting PU DATE', 'Awaiting WM Guidance', 'Resubmit PO', 'PU Date Assigned', '3rd Party', 'beyondGREEN Ship', 'Resubmitted - Awaiting Confirmation', 'MABD', 'Cancelled', 'Partial Shipped', 'Trailer Overflow', 'Duplicate', 'BUILDING ORDER']

const fmtD = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const fmt$ = (n: number | null) => (n == null ? '—' : '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const fmtN = (n: number | null) => (n == null ? '—' : Number(n).toLocaleString())

type FKind = 'text' | 'date' | 'num' | 'money' | 'status' | 'longtext'
const FIELDS: { key: keyof WOrder; label: string; kind: FKind; wide?: boolean }[] = [
  { key: 'status', label: 'Status', kind: 'status' },
  { key: 'order_date', label: 'Order Date', kind: 'date' },
  { key: 'ship_due_date', label: 'Ship Due Date', kind: 'date' },
  { key: 'facility', label: 'Facility', kind: 'text' },
  { key: 'po_number', label: 'PO #', kind: 'text' },
  { key: 'load_number', label: 'Load #', kind: 'text' },
  { key: 'carrier', label: 'Carrier', kind: 'text' },
  { key: 'bol2', label: 'BOL #', kind: 'text' },
  { key: 'bol_date', label: 'BOL Date', kind: 'date' },
  { key: 'trailer_no', label: 'Trailer No', kind: 'text' },
  { key: 'seal_number', label: 'Seal Number', kind: 'text' },
  { key: 'srp', label: 'SRP', kind: 'num' },
  { key: 'units', label: 'Units', kind: 'num' },
  { key: 'pallets', label: 'Pallets', kind: 'text' },
  { key: 'qty', label: 'Qty (PLT)', kind: 'num' },
  { key: 'qty2', label: 'Qty 2 (CS)', kind: 'num' },
  { key: 'weight', label: 'Weight (lbs)', kind: 'num' },
  { key: 'total_value', label: 'Total Value', kind: 'money' },
  { key: 'work_order', label: 'Work Order #', kind: 'text' },
  { key: 'lot', label: 'Lot #', kind: 'text' },
  { key: 'ship_from', label: 'Ship From', kind: 'text', wide: true },
  { key: 'ship_to', label: 'Ship To', kind: 'text', wide: true },
  { key: 'commodity_description', label: 'Commodity Description', kind: 'longtext', wide: true },
  { key: 'special_instructions', label: 'Special Instructions', kind: 'longtext', wide: true },
]

export default function WalmartBoard() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<WOrder[]>([])
  const [lines, setLines] = useState<Record<string, WLine[]>>({})
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({})
  const [fileCounts, setFileCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [userEmail, setUserEmail] = useState('')

  const [detail, setDetail] = useState<WOrder | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<any>({})
  const [lineForms, setLineForms] = useState<WLine[]>([])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [adding, setAdding] = useState(false)
  const navRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: o } = await sb.from('walmart_board_orders').select('*').eq('archived', false).order('board_position', { ascending: true, nullsFirst: false }).order('name', { ascending: true })
    const orders = (o as WOrder[]) || []
    setRows(orders)
    const { data: l } = await sb.from('walmart_board_lines').select('*').order('line_number', { ascending: true })
    const lm: Record<string, WLine[]> = {}
    ;((l as any[]) || []).forEach(r => { (lm[r.order_id] ||= []).push(r) })
    setLines(lm)
    const ids = orders.map(r => r.id)
    if (ids.length) {
      const cc: Record<string, number> = {}; const fc: Record<string, number> = {}
      for (let i = 0; i < ids.length; i += 200) {
        const slice = ids.slice(i, i + 200)
        const { data: cm } = await sb.from('comments').select('record_id').eq('record_type', 'walmart_order').in('record_id', slice)
        ;((cm as any[]) || []).forEach(c => { cc[c.record_id] = (cc[c.record_id] || 0) + 1 })
        const { data: fm } = await sb.from('file_attachments').select('record_id').eq('record_type', 'walmart_order').in('record_id', slice)
        ;((fm as any[]) || []).forEach(f => { fc[f.record_id] = (fc[f.record_id] || 0) + 1 })
      }
      setCommentCounts(cc); setFileCounts(fc)
    }
    setLoading(false)
    sb.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email) })
  }, [sb])
  useEffect(() => { load() }, [load])

  function openDetail(r: WOrder) { setEditing(false); setDetail(r) }
  useItemDeepLink(rows, (r) => openDetail(r as WOrder))
  function closeDetail() { setDetail(null); setEditing(false) }
  const detailLines = detail ? (lines[detail.id] || []) : []

  function startEdit() {
    if (!detail) return
    const f: any = { name: detail.name ?? '' }
    for (const fld of FIELDS) f[fld.key] = (detail as any)[fld.key] ?? ''
    setForm(f)
    setLineForms(detailLines.map(l => ({ ...l })))
    setEditing(true)
  }
  const setLine = (i: number, patch: Partial<WLine>) => setLineForms(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  const addLine = () => setLineForms(ls => [...ls, { _new: true, part_number: '', qty: null, qty_per_case: null, completed_qty: null, uom: 'SRPs', packaging: 'Packed', production_status: null, cost_each: '', total_cost: '', added_details: '' }])
  const removeLine = (i: number) => setLineForms(ls => ls.filter((_, idx) => idx !== i))

  async function saveRecord() {
    if (!detail) return
    setSaving(true)
    try {
      const clean = (v: any) => { const s = String(v ?? '').trim(); return s === '' ? null : s }
      const patch: any = { name: clean(form.name) ?? detail.name, updated_at: new Date().toISOString() }
      for (const fld of FIELDS) {
        if (fld.kind === 'date') patch[fld.key] = form[fld.key] || null
        else if (fld.kind === 'num' || fld.kind === 'money') { const n = Number(form[fld.key]); patch[fld.key] = form[fld.key] === '' || form[fld.key] == null || isNaN(n) ? null : n }
        else patch[fld.key] = clean(form[fld.key])
      }
      const { error } = await sb.from('walmart_board_orders').update(patch).eq('id', detail.id)
      if (error) { alert('Save failed: ' + error.message); return }
      const keptIds = lineForms.filter(l => l.id && !l._new).map(l => l.id)
      const toDelete = detailLines.map(l => l.id).filter(id => id && !keptIds.includes(id)) as string[]
      if (toDelete.length) await sb.from('walmart_board_lines').delete().in('id', toDelete)
      for (let i = 0; i < lineForms.length; i++) {
        const l = lineForms[i]
        const num = (v: any) => { const n = Number(v); return v === '' || v == null || isNaN(n) ? null : n }
        const row: any = { order_id: detail.id, part_number: (String(l.part_number ?? '').trim() || null), qty: num(l.qty), qty_per_case: num(l.qty_per_case), completed_qty: num(l.completed_qty), uom: (String(l.uom ?? '').trim() || null), packaging: (String(l.packaging ?? '').trim() || null), production_status: (String(l.production_status ?? '').trim() || null), cost_each: (String(l.cost_each ?? '').trim() || null), total_cost: (String(l.total_cost ?? '').trim() || null), added_details: (String(l.added_details ?? '').trim() || null), line_number: i + 1 }
        if (l._new || !l.id) await sb.from('walmart_board_lines').insert(row)
        else await sb.from('walmart_board_lines').update(row).eq('id', l.id)
      }
      const updated = { ...detail, ...patch }
      setRows(rs => rs.map(r => r.id === detail.id ? updated : r))
      setDetail(updated); setEditing(false)
      await load()
    } finally { setSaving(false) }
  }

  async function deleteRecord() {
    if (!detail) return
    if (!confirm(`Delete "${detail.name}"?\n\nThis permanently removes the order, its line items and all of its comments. This cannot be undone.`)) return
    setDeleting(true)
    try {
      await sb.from('walmart_board_lines').delete().eq('order_id', detail.id)
      try { await sb.rpc('delete_record_comments', { p_record_type: 'walmart_order', p_record_id: detail.id }) } catch { /* */ }
      const { error } = await sb.from('walmart_board_orders').delete().eq('id', detail.id)
      if (error) { alert('Delete failed: ' + error.message); return }
      setRows(rs => rs.filter(r => r.id !== detail.id)); closeDetail()
    } finally { setDeleting(false) }
  }

  async function addOrder() {
    const name = prompt('New Walmart order name (e.g. WALMART|1234567890):')
    if (!name || !name.trim()) return
    setAdding(true)
    try {
      const { data, error } = await sb.from('walmart_board_orders').insert({ name: name.trim(), group_name: 'Walmart Orders', facility: 'bG - SACA' }).select('*').single()
      if (error) { alert('Create failed: ' + error.message); return }
      await load()
      if (data) openDetail(data as WOrder)
    } finally { setAdding(false) }
  }

  const q = search.trim().toLowerCase()
  const match = (r: WOrder) => !q || [r.name, r.po_number, r.ship_to, r.status, r.load_number, r.bol2].some(v => (v || '').toLowerCase().includes(q))
  const groupRows = (key: string) => rows.filter(r => (r.group_name || 'Walmart Orders') === key && match(r))
  const extra = Array.from(new Set(rows.map(r => r.group_name || 'Walmart Orders').filter(k => k && !GROUPS.some(g => g.key === k))))
  const allGroups = [...GROUPS, ...extra.map(k => ({ key: k, color: '#9699A6' }))]
  const shown = allGroups.reduce((a, g) => a + groupRows(g.key).length, 0)
  const totalVal = rows.reduce((a, r) => a + (Number(r.total_value) || 0), 0)

  const inputCls = 'w-full bg-white border border-[#E4E6EE] rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3B6FE0]/40'
  const cellCls = 'w-full bg-white border border-[#E4E6EE] rounded px-1.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#3B6FE0]/40'

  function editControl(fld: typeof FIELDS[number]) {
    if (fld.kind === 'status') return <select className={inputCls} value={form.status || ''} onChange={e => setForm((f: any) => ({ ...f, status: e.target.value }))}><option value="">—</option>{STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}</select>
    if (fld.kind === 'date') return <input type="date" className={inputCls} value={form[fld.key] || ''} onChange={e => setForm((f: any) => ({ ...f, [fld.key]: e.target.value }))} />
    if (fld.kind === 'num' || fld.kind === 'money') return <input type="number" step="any" className={inputCls} value={form[fld.key] ?? ''} onChange={e => setForm((f: any) => ({ ...f, [fld.key]: e.target.value }))} />
    if (fld.kind === 'longtext') return <textarea rows={2} className={inputCls + ' resize-none'} value={form[fld.key] ?? ''} onChange={e => setForm((f: any) => ({ ...f, [fld.key]: e.target.value }))} />
    return <input className={inputCls} value={form[fld.key] ?? ''} onChange={e => setForm((f: any) => ({ ...f, [fld.key]: e.target.value }))} />
  }
  const showVal = (fld: typeof FIELDS[number], r: WOrder) => {
    const v = (r as any)[fld.key]
    if (fld.kind === 'date') return fmtD(v)
    if (fld.kind === 'money') return v != null ? fmt$(Number(v)) : <span className="text-gray-300">—</span>
    if (fld.kind === 'num') return v != null ? fmtN(Number(v)) : <span className="text-gray-300">—</span>
    return v || <span className="text-gray-300">—</span>
  }

  return (
    <div ref={navRef}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div>
          <span className="mon-tag">🛒 Walmart Orders</span>
          <p className="text-gray-500 text-sm mt-1">{loading ? 'Loading…' : `${shown} of ${rows.length} orders · ${fmt$(totalVal)} total value`}</p>
        </div>
        <button onClick={addOrder} disabled={adding} className="mon-btn">{adding ? 'Adding…' : '+ New Walmart order'}</button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input placeholder="Search name, PO#, ship-to, status, load#…" value={search} onChange={e => setSearch(e.target.value)} className="flex-1 min-w-[240px] max-w-md bg-white border border-[#E4E6EE] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <div className="flex items-center gap-1.5 ml-auto text-xs">
          <button onClick={() => setCollapsed(Object.fromEntries(allGroups.map(g => [g.key, true])))} className="px-2.5 py-1.5 rounded-md text-gray-500 hover:bg-[#F0F2F7]">Collapse all</button>
          <button onClick={() => setCollapsed({})} className="px-2.5 py-1.5 rounded-md text-gray-500 hover:bg-[#F0F2F7]">Expand all</button>
        </div>
      </div>

      {loading ? <p className="text-gray-400 text-sm">Loading…</p> : (
        <div className="space-y-2.5 mb-6">
          {allGroups.map(group => {
            const gr = groupRows(group.key); const isCol = collapsed[group.key]
            const val = gr.reduce((a, r) => a + (Number(r.total_value) || 0), 0)
            return (
              <div key={group.key} className="bg-white rounded-xl overflow-hidden shadow-sm border border-[#ECEEF3]">
                <div className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none" style={{ background: group.color + '14', borderLeft: '5px solid ' + group.color }} onClick={() => setCollapsed(c => ({ ...c, [group.key]: !c[group.key] }))}>
                  <span className="text-[10px]" style={{ color: group.color, display: 'inline-block', transform: isCol ? 'none' : 'rotate(90deg)' }}>&#9654;</span>
                  <span className="font-bold text-sm" style={{ color: group.color }}>{group.key}</span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: group.color + '26', color: group.color }}>{gr.length}</span>
                  {val > 0 && <span className="ml-auto text-[11px] text-gray-400">{fmt$(val)}</span>}
                </div>
                {!isCol && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[1040px]">
                      <thead>
                        <tr className="border-b border-[#EEF0F4] text-[11px] uppercase tracking-wide text-gray-400 bg-[#FBFCFE]">
                          <th className="text-left font-semibold px-4 py-2 min-w-[180px]">Order</th>
                          <th className="text-left font-semibold px-3 py-2 w-[190px]">Status</th>
                          <th className="text-left font-semibold px-3 py-2 w-[110px]">PO #</th>
                          <th className="text-left font-semibold px-3 py-2 min-w-[220px]">Ship To</th>
                          <th className="text-left font-semibold px-3 py-2 w-[110px]">Ship Due</th>
                          <th className="text-left font-semibold px-3 py-2 w-[100px]">Carrier</th>
                          <th className="text-right font-semibold px-3 py-2 w-[110px]">Total Value</th>
                          <th className="text-left font-semibold px-3 py-2 w-[70px]">Files</th>
                          <th className="text-left font-semibold px-3 py-2 w-[80px]">Comments</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EAECF2]">
                        {gr.map((r, i) => {
                          const sc = statusColor(r.status)
                          const nf = fileCounts[r.id] || 0; const nc = commentCounts[r.id] || 0
                          return (
                            <tr key={r.id} id={'item-' + r.id} className={`cursor-pointer hover:bg-[#F2F6FF] ${i % 2 ? 'bg-[#F8FAFC]' : 'bg-white'}`} onClick={() => openDetail(r)}>
                              <td className="px-4 py-2.5 text-[13px] font-semibold text-[#1A1D2E]">{r.name}</td>
                              <td className="px-3 py-2.5"><span className="text-[11px] font-semibold rounded-full px-2.5 py-1 inline-block" style={{ background: sc.bg, color: sc.fg }}>{r.status || '—'}</span></td>
                              <td className="px-3 py-2.5 text-[13px] font-mono text-gray-600">{r.po_number || '—'}</td>
                              <td className="px-3 py-2.5 text-[12px] text-gray-500 truncate max-w-[260px]">{r.ship_to || '—'}</td>
                              <td className="px-3 py-2.5 text-[13px] text-gray-600">{fmtD(r.ship_due_date)}</td>
                              <td className="px-3 py-2.5 text-[13px] text-gray-600">{r.carrier || '—'}</td>
                              <td className="px-3 py-2.5 text-[13px] text-gray-700 text-right font-semibold">{r.total_value != null ? fmt$(Number(r.total_value)) : '—'}</td>
                              <td className="px-3 py-2.5">{nf ? <span className="text-[#3B6FE0] text-xs font-semibold">📎 {nf}</span> : <span className="text-gray-300">—</span>}</td>
                              <td className="px-3 py-2.5">{nc ? <span className="text-emerald-600 text-xs font-semibold">💬 {nc}</span> : <span className="text-gray-300">—</span>}</td>
                            </tr>
                          )
                        })}
                        {gr.length === 0 && <tr><td colSpan={9} className="px-4 py-4 text-center text-gray-400 text-xs italic">No orders</td></tr>}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: 'rgba(26,32,53,0.5)' }} onClick={closeDetail}>
          <div className="relative w-full max-w-[900px] my-6 bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between px-6 py-4 text-white" style={{ background: statusColor(detail.status).solid || '#0086C0' }}>
              <div className="min-w-0">
                <p className="text-white/70 text-xs uppercase tracking-wide">Walmart Order · {detail.group_name || '—'}</p>
                <h2 className="text-xl font-bold leading-tight">{detail.name}</h2>
                {detail.status && <span className="inline-block mt-1.5 text-[11px] font-semibold rounded-full px-2.5 py-0.5" style={{ background: 'rgba(255,255,255,0.25)' }}>{detail.status}</span>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!editing && (
                  <>
                    <button onClick={startEdit} className="text-xs font-semibold rounded-lg px-3 py-1.5 bg-white/15 hover:bg-white/25 transition-colors">✎ Edit</button>
                    <button onClick={deleteRecord} disabled={deleting} className="text-xs font-semibold rounded-lg px-3 py-1.5 bg-white/15 hover:bg-red-500 disabled:opacity-50 transition-colors">{deleting ? 'Deleting…' : '🗑 Delete'}</button>
                  </>
                )}
                <button onClick={closeDetail} className="text-white/80 hover:text-white text-2xl leading-none pl-1">&times;</button>
              </div>
            </div>

            <div className="px-6 py-4 max-h-[76vh] overflow-y-auto space-y-5">
              <div className="-mt-1"><ShareLink id={detail.id} /></div>

              {editing ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  <label className="col-span-2 sm:col-span-3"><span className="text-[11px] uppercase tracking-wide text-gray-400">Order Name</span><input className={inputCls} value={form.name} onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))} /></label>
                  {FIELDS.map(fld => (<label key={String(fld.key)} className={fld.wide ? 'col-span-2 sm:col-span-3' : ''}><span className="text-[11px] uppercase tracking-wide text-gray-400">{fld.label}</span>{editControl(fld)}</label>))}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                  {FIELDS.map(fld => (
                    <div key={String(fld.key)} className={fld.wide ? 'col-span-2 sm:col-span-3' : ''}>
                      <p className="text-[11px] uppercase tracking-wide text-gray-400">{fld.label}</p>
                      <p className="text-gray-800 mt-0.5 break-words whitespace-pre-wrap">{showVal(fld, detail)}</p>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Order Details (Pallets / SKUs)</p>
                  {editing && <button onClick={addLine} className="text-xs px-2.5 py-1 rounded-lg bg-[#EAF0FC] text-[#3B6FE0] font-semibold hover:bg-[#DCE7FB]">＋ Add line</button>}
                </div>
                {editing ? (
                  <div className="border border-[#EEF0F4] rounded-lg overflow-x-auto">
                    <table className="w-full text-sm min-w-[640px]">
                      <thead><tr className="bg-[#FBFCFE] text-[11px] uppercase text-gray-400"><th className="text-left px-2 py-2">P/N</th><th className="text-left px-2 py-2 w-[80px]">Qty</th><th className="text-left px-2 py-2 w-[90px]">UOM</th><th className="text-left px-2 py-2 w-[90px]">Packaging</th><th className="text-left px-2 py-2 w-[90px]">Cost Each</th><th className="px-1 py-2 w-[32px]"></th></tr></thead>
                      <tbody>
                        {lineForms.map((l, i) => (
                          <tr key={l.id || 'n' + i} className="border-t border-[#F0F2F6]">
                            <td className="px-2 py-1.5"><input className={cellCls + ' font-mono'} value={l.part_number ?? ''} onChange={e => setLine(i, { part_number: e.target.value })} /></td>
                            <td className="px-2 py-1.5"><input type="number" className={cellCls} value={l.qty ?? ''} onChange={e => setLine(i, { qty: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                            <td className="px-2 py-1.5"><input className={cellCls} value={l.uom ?? ''} onChange={e => setLine(i, { uom: e.target.value })} /></td>
                            <td className="px-2 py-1.5"><input className={cellCls} value={l.packaging ?? ''} onChange={e => setLine(i, { packaging: e.target.value })} /></td>
                            <td className="px-2 py-1.5"><input className={cellCls} value={l.cost_each ?? ''} onChange={e => setLine(i, { cost_each: e.target.value })} /></td>
                            <td className="px-1 py-1.5 text-center"><button onClick={() => removeLine(i)} className="text-gray-300 hover:text-red-500 text-base leading-none" title="Remove">×</button></td>
                          </tr>
                        ))}
                        {lineForms.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-400 text-sm">No lines. Click “＋ Add line”.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                ) : detailLines.length === 0 ? <p className="text-sm text-gray-400">No order detail lines.</p> : (
                  <div className="border border-[#EEF0F4] rounded-lg overflow-x-auto">
                    <table className="w-full text-sm min-w-[560px]">
                      <thead><tr className="bg-[#FBFCFE] text-[11px] uppercase text-gray-400"><th className="text-left px-3 py-2">P/N</th><th className="text-right px-3 py-2">Qty</th><th className="text-left px-3 py-2">UOM</th><th className="text-left px-3 py-2">Packaging</th><th className="text-right px-3 py-2">Cost Each</th></tr></thead>
                      <tbody>
                        {detailLines.map(l => (<tr key={l.id} className="border-t border-[#F0F2F6]"><td className="px-3 py-2 font-mono text-emerald-600">{l.part_number || '—'}</td><td className="px-3 py-2 text-right text-gray-700">{l.qty ?? '—'}</td><td className="px-3 py-2 text-gray-600">{l.uom || '—'}</td><td className="px-3 py-2 text-gray-600">{l.packaging || '—'}</td><td className="px-3 py-2 text-right text-gray-600">{l.cost_each ? '$' + l.cost_each : '—'}</td></tr>))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {editing && (
                <div className="flex items-center justify-between gap-3 border-t border-[#EEF0F4] pt-4">
                  <button onClick={deleteRecord} disabled={deleting || saving} className="text-xs font-semibold rounded-lg px-3 py-2 text-red-600 hover:bg-red-50 disabled:opacity-50">{deleting ? 'Deleting…' : '🗑 Delete order'}</button>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setEditing(false)} disabled={saving} className="text-sm px-4 py-2 rounded-lg border border-[#E4E6EE] text-gray-600 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
                    <button onClick={saveRecord} disabled={saving} className="text-sm px-4 py-2 rounded-lg text-white font-semibold disabled:opacity-50" style={{ background: '#0086C0' }}>{saving ? 'Saving…' : 'Save changes'}</button>
                  </div>
                </div>
              )}

              <div className="border-t border-[#EEF0F4] pt-4">
                <FileUpload supabase={sb} recordType="walmart_order" recordId={detail.id} currentUserEmail={userEmail} />
              </div>
              <div className="border-t border-[#EEF0F4] pt-4">
                <Comments recordId={detail.id} recordType="walmart_order" currentUserEmail={userEmail} title="Notes & Comments" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
