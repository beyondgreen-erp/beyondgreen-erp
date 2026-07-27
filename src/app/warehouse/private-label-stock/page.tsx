'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
const STATUS_OPTIONS = Object.keys(STATUS_COLORS)
const PROD_OPTIONS = Object.keys(PROD_COLORS)
const statusColor = (s: string | null) => (s && STATUS_COLORS[s]) || '#c4c4c4'
const fmtDate = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

type Line = {
  id?: string
  _new?: boolean
  name?: string | null
  part_number?: string | null
  qty?: string | null
  production_status?: string | null
  completed_qty?: string | null
  uom?: string | null
  cost_each?: string | null
  total_cost?: string | null
  added_details?: string | null
}

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
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // ── Edit / delete state ──────────────────────────────────────────────
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<any>({})
  const [lines, setLines] = useState<Line[]>([])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function uploadRecordFile(order: any, file: File) {
    setUploading(true)
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `orders/${order.id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safe}`
      const { error } = await sb.storage.from('record-board').upload(path, file)
      if (error) { alert('Upload failed: ' + error.message); return }
      const { data } = sb.storage.from('record-board').getPublicUrl(path)
      const next = [...(order.attachments || []), { name: file.name, url: data.publicUrl }]
      await sb.from('pl_stock_orders').update({ attachments: next }).eq('id', order.id)
      setOrders(os => os.map(o => o.id === order.id ? { ...o, attachments: next } : o))
      setDetail((d: any) => (d && d.id === order.id ? { ...d, attachments: next } : d))
    } finally { setUploading(false) }
  }

  async function removeRecordFile(order: any, idx: number) {
    const next = (order.attachments || []).filter((_: any, i: number) => i !== idx)
    await sb.from('pl_stock_orders').update({ attachments: next }).eq('id', order.id)
    setOrders(os => os.map(o => o.id === order.id ? { ...o, attachments: next } : o))
    setDetail((d: any) => (d && d.id === order.id ? { ...d, attachments: next } : d))
  }


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

  // ── Open / close detail ──────────────────────────────────────────────
  function openDetail(r: any) {
    setEditing(false)
    setDetail(r)
  }
  function closeDetail() {
    setDetail(null)
    setEditing(false)
  }

  function startEdit() {
    if (!detail) return
    setForm({
      name: detail.name ?? '',
      status: detail.status ?? '',
      group_key: detail.group_key ?? GROUPS[0].key,
      order_date: detail.order_date ?? '',
      ship_due_date: detail.ship_due_date ?? '',
      po_number: detail.po_number ?? '',
      customer_email: detail.customer_email ?? '',
      shipping_address: detail.shipping_address ?? '',
    })
    setLines(detailItems.map(i => ({
      id: i.id,
      name: i.name ?? '',
      part_number: i.part_number ?? '',
      qty: i.qty ?? '',
      production_status: i.production_status ?? '',
      completed_qty: i.completed_qty ?? '',
      uom: i.uom ?? '',
      cost_each: i.cost_each ?? '',
      total_cost: i.total_cost ?? '',
      added_details: i.added_details ?? '',
    })))
    setEditing(true)
  }

  const setLine = (idx: number, patch: Partial<Line>) =>
    setLines(ls => ls.map((l, i) => i === idx ? { ...l, ...patch } : l))
  const addLine = () => setLines(ls => [...ls, { _new: true, part_number: '', qty: '' }])
  const removeLine = (idx: number) => setLines(ls => ls.filter((_, i) => i !== idx))

  async function saveRecord() {
    if (!detail) return
    setSaving(true)
    try {
      const g = GROUPS.find(x => x.key === form.group_key)
      const clean = (v: any) => { const s = String(v ?? '').trim(); return s === '' ? null : s }
      const patch = {
        name: clean(form.name) ?? detail.name,
        status: clean(form.status),
        group_key: form.group_key,
        group_title: g?.title ?? detail.group_title,
        order_date: form.order_date || null,
        ship_due_date: form.ship_due_date || null,
        po_number: clean(form.po_number),
        customer_email: clean(form.customer_email),
        shipping_address: clean(form.shipping_address),
        updated_at: new Date().toISOString(),
      }
      const { error: upErr } = await sb.from('pl_stock_orders').update(patch).eq('id', detail.id)
      if (upErr) { alert('Save failed: ' + upErr.message); return }

      // Line items: delete removed, update existing, insert new
      const keptIds = lines.filter(l => l.id && !l._new).map(l => l.id)
      const toDelete = detailItems.map(i => i.id).filter(id => !keptIds.includes(id))
      if (toDelete.length) await sb.from('pl_stock_order_items').delete().in('id', toDelete)

      for (let idx = 0; idx < lines.length; idx++) {
        const l = lines[idx]
        const cln = (v: any) => { const s = String(v ?? '').trim(); return s === '' ? null : s }
        const row: any = {
          parent_id: detail.id,
          name: cln(l.name),
          part_number: cln(l.part_number),
          qty: cln(l.qty),
          production_status: cln(l.production_status),
          completed_qty: cln(l.completed_qty),
          uom: cln(l.uom),
          cost_each: cln(l.cost_each),
          total_cost: cln(l.total_cost),
          added_details: cln(l.added_details),
          position: idx,
        }
        if (l._new || !l.id) await sb.from('pl_stock_order_items').insert(row)
        else await sb.from('pl_stock_order_items').update(row).eq('id', l.id)
      }

      const updated = { ...detail, ...patch }
      setDetail(updated)
      setEditing(false)
      await load()
    } finally { setSaving(false) }
  }

  async function deleteRecord() {
    if (!detail) return
    if (!confirm(`Delete "${detail.name}"?\n\nThis permanently removes the record, its ${detailItems.length} line item(s), and all of its comments. This cannot be undone.`)) return
    setDeleting(true)
    try {
      await sb.from('pl_stock_order_items').delete().eq('parent_id', detail.id)
      await sb.rpc('delete_record_comments', { p_record_type: 'pl_stock_order', p_record_id: detail.id })
      const { error } = await sb.from('pl_stock_orders').delete().eq('id', detail.id)
      if (error) { alert('Delete failed: ' + error.message); return }
      closeDetail()
      await load()
    } finally { setDeleting(false) }
  }

  const inputCls = 'w-full bg-white border border-[#E4E6EE] rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3B6FE0]/40'
  const cellCls = 'w-full bg-white border border-[#E4E6EE] rounded px-1.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#3B6FE0]/40'

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
              <div className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none sticky top-0 z-30 rounded-t-xl" style={{ background: '#fff', borderLeft: '5px solid ' + group.color }} onClick={() => setCollapsed(c => ({ ...c, [group.key]: !c[group.key] }))}>
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
                        const nFiles = (r.order_form_files?.length || 0) + (r.so_files?.length || 0) + (r.attachments?.length || 0)
                        const nc = commentCounts[r.id] || 0
                        return (
                          <tr key={r.id} className={`cursor-pointer hover:bg-[#F2F6FF] ${i % 2 ? 'bg-[#F8FAFC]' : 'bg-white'}`} onClick={() => openDetail(r)}>
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
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: 'rgba(26,32,53,0.5)' }} onClick={closeDetail}>
          <div className="relative w-full max-w-[840px] my-6 bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between px-6 py-4 text-white" style={{ background: '#175a63' }}>
              <div className="min-w-0">
                <p className="text-white/70 text-xs uppercase tracking-wide">{detail.group_title}</p>
                <h2 className="text-xl font-bold leading-tight">{detail.name}</h2>
                <span className="inline-block mt-1.5 text-[11px] font-semibold rounded-full px-2.5 py-0.5" style={{ background: statusColor(detail.status), color: '#fff' }}>{detail.status || '—'}</span>
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

            <div className="px-6 py-4 max-h-[75vh] overflow-y-auto space-y-5">
              {/* ── Header fields ── */}
              {editing ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  <label className="col-span-2 sm:col-span-3">
                    <span className="text-[11px] uppercase tracking-wide text-gray-400">Order Name</span>
                    <input className={inputCls} value={form.name} onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))} />
                  </label>
                  <label>
                    <span className="text-[11px] uppercase tracking-wide text-gray-400">Status</span>
                    <select className={inputCls} value={form.status} onChange={e => setForm((f: any) => ({ ...f, status: e.target.value }))}>
                      <option value="">—</option>
                      {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                  <label>
                    <span className="text-[11px] uppercase tracking-wide text-gray-400">Group</span>
                    <select className={inputCls} value={form.group_key} onChange={e => setForm((f: any) => ({ ...f, group_key: e.target.value }))}>
                      {GROUPS.map(g => <option key={g.key} value={g.key}>{g.title}</option>)}
                    </select>
                  </label>
                  <label>
                    <span className="text-[11px] uppercase tracking-wide text-gray-400">Order Date</span>
                    <input type="date" className={inputCls} value={form.order_date || ''} onChange={e => setForm((f: any) => ({ ...f, order_date: e.target.value }))} />
                  </label>
                  <label>
                    <span className="text-[11px] uppercase tracking-wide text-gray-400">Ship Due Date</span>
                    <input type="date" className={inputCls} value={form.ship_due_date || ''} onChange={e => setForm((f: any) => ({ ...f, ship_due_date: e.target.value }))} />
                  </label>
                  <label>
                    <span className="text-[11px] uppercase tracking-wide text-gray-400">PO #</span>
                    <input className={inputCls} value={form.po_number} onChange={e => setForm((f: any) => ({ ...f, po_number: e.target.value }))} />
                  </label>
                  <label>
                    <span className="text-[11px] uppercase tracking-wide text-gray-400">Customer Email</span>
                    <input className={inputCls} value={form.customer_email} onChange={e => setForm((f: any) => ({ ...f, customer_email: e.target.value }))} />
                  </label>
                  <label className="col-span-2 sm:col-span-3">
                    <span className="text-[11px] uppercase tracking-wide text-gray-400">Shipping Address</span>
                    <input className={inputCls} value={form.shipping_address} onChange={e => setForm((f: any) => ({ ...f, shipping_address: e.target.value }))} />
                  </label>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                  <Field label="Order Date" value={fmtDate(detail.order_date)} />
                  <Field label="Ship Due Date" value={fmtDate(detail.ship_due_date)} />
                  <Field label="PO #" value={detail.po_number} />
                  <Field label="Customer Email" value={detail.customer_email} />
                  <Field label="Shipping Address" value={detail.shipping_address} wide />
                </div>
              )}

              {/* ── Line items ── */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Order Details</p>
                  {editing && <button onClick={addLine} className="text-xs px-2.5 py-1 rounded-lg bg-[#EAF0FC] text-[#3B6FE0] font-semibold hover:bg-[#DCE7FB]">＋ Add line</button>}
                </div>
                {editing ? (
                  <div className="border border-[#EEF0F4] rounded-lg overflow-x-auto">
                    <table className="w-full text-sm min-w-[720px]">
                      <thead><tr className="bg-[#FBFCFE] text-[11px] uppercase text-gray-400">
                        <th className="text-left px-2 py-2">P/N</th>
                        <th className="text-left px-2 py-2 w-[70px]">Qty</th>
                        <th className="text-left px-2 py-2 w-[150px]">Prod. Status</th>
                        <th className="text-left px-2 py-2 w-[80px]">Completed</th>
                        <th className="text-left px-2 py-2 w-[70px]">UOM</th>
                        <th className="text-left px-2 py-2 w-[80px]">Cost Each</th>
                        <th className="text-left px-2 py-2 w-[80px]">Total</th>
                        <th className="px-1 py-2 w-[32px]"></th>
                      </tr></thead>
                      <tbody>
                        {lines.map((l, idx) => (
                          <tr key={l.id || `new-${idx}`} className="border-t border-[#F0F2F6] align-top">
                            <td className="px-2 py-1.5">
                              <input className={cellCls + ' font-mono'} value={l.part_number ?? ''} onChange={e => setLine(idx, { part_number: e.target.value })} placeholder="Part #" />
                              <input className={cellCls + ' mt-1 text-[11px]'} value={l.added_details ?? ''} onChange={e => setLine(idx, { added_details: e.target.value })} placeholder="Details (optional)" />
                            </td>
                            <td className="px-2 py-1.5"><input className={cellCls} value={l.qty ?? ''} onChange={e => setLine(idx, { qty: e.target.value })} /></td>
                            <td className="px-2 py-1.5">
                              <select className={cellCls} value={l.production_status ?? ''} onChange={e => setLine(idx, { production_status: e.target.value })}>
                                <option value="">—</option>
                                {PROD_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </td>
                            <td className="px-2 py-1.5"><input className={cellCls} value={l.completed_qty ?? ''} onChange={e => setLine(idx, { completed_qty: e.target.value })} /></td>
                            <td className="px-2 py-1.5"><input className={cellCls} value={l.uom ?? ''} onChange={e => setLine(idx, { uom: e.target.value })} /></td>
                            <td className="px-2 py-1.5"><input className={cellCls} value={l.cost_each ?? ''} onChange={e => setLine(idx, { cost_each: e.target.value })} /></td>
                            <td className="px-2 py-1.5"><input className={cellCls} value={l.total_cost ?? ''} onChange={e => setLine(idx, { total_cost: e.target.value })} /></td>
                            <td className="px-1 py-1.5 text-center"><button onClick={() => removeLine(idx)} className="text-gray-300 hover:text-red-500 text-base leading-none" title="Remove line">×</button></td>
                          </tr>
                        ))}
                        {lines.length === 0 && <tr><td colSpan={8} className="px-3 py-4 text-center text-gray-400 text-sm">No line items. Click “＋ Add line”.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                ) : detailItems.length === 0 ? <p className="text-sm text-gray-400">No line items.</p> : (
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
                {!editing && detailItems.some(it => it.added_details) && (
                  <div className="mt-2 space-y-1">
                    {detailItems.filter(it => it.added_details).map(it => (
                      <p key={it.id} className="text-xs text-gray-500"><span className="font-mono text-emerald-700">{it.part_number || it.name}</span>: {it.added_details}</p>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Edit action bar ── */}
              {editing && (
                <div className="flex items-center justify-between gap-3 border-t border-[#EEF0F4] pt-4">
                  <button onClick={deleteRecord} disabled={deleting || saving} className="text-xs font-semibold rounded-lg px-3 py-2 text-red-600 hover:bg-red-50 disabled:opacity-50">{deleting ? 'Deleting…' : '🗑 Delete record'}</button>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setEditing(false)} disabled={saving} className="text-sm px-4 py-2 rounded-lg border border-[#E4E6EE] text-gray-600 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
                    <button onClick={saveRecord} disabled={saving} className="text-sm px-4 py-2 rounded-lg text-white font-semibold disabled:opacity-50" style={{ background: '#175a63' }}>{saving ? 'Saving…' : 'Save changes'}</button>
                  </div>
                </div>
              )}

              {/* ── Files ── */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Files</p>
                  <div>
                    <input ref={fileRef} type="file" multiple className="hidden" onChange={async e => { const fs = Array.from(e.target.files || []); for (const f of fs) { await uploadRecordFile(detail, f) } if (e.target) e.target.value = '' }} />
                    <button onClick={() => fileRef.current?.click()} disabled={uploading} className="text-xs px-2.5 py-1.5 rounded-lg bg-[#3B6FE0] text-white font-semibold hover:opacity-90 disabled:opacity-50">{uploading ? 'Uploading…' : '＋ Upload file'}</button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[...(detail.order_form_files || []).map((f: any) => ({ ...f, tag: 'Order Form' })), ...(detail.so_files || []).map((f: any) => ({ ...f, tag: 'SO' }))].map((f: any, idx: number) => (
                    <a key={'m' + idx} href={f.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-xs bg-[#F5F7FB] border border-[#E4E6EE] rounded-lg px-3 py-2 hover:bg-[#EAF0FC]">
                      <span className="text-[#3B6FE0]">📄</span>
                      <span className="min-w-0"><span className="block font-semibold text-gray-700 truncate max-w-[240px]">{f.name}</span><span className="text-[10px] text-gray-400">{f.tag}</span></span>
                    </a>
                  ))}
                  {(detail.attachments || []).map((f: any, idx: number) => (
                    <div key={'a' + idx} className="flex items-center gap-2 text-xs bg-[#F5FBF7] border border-[#CDEBD9] rounded-lg px-3 py-2">
                      <a href={f.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 min-w-0 hover:underline">
                        <span className="text-emerald-600">📎</span>
                        <span className="min-w-0"><span className="block font-semibold text-gray-700 truncate max-w-[220px]">{f.name}</span><span className="text-[10px] text-gray-400">Uploaded</span></span>
                      </a>
                      <button onClick={() => removeRecordFile(detail, idx)} className="text-gray-300 hover:text-red-500 leading-none text-base">×</button>
                    </div>
                  ))}
                  {((detail.order_form_files?.length || 0) + (detail.so_files?.length || 0) + (detail.attachments?.length || 0)) === 0 && <p className="text-sm text-gray-400">No files yet — upload one above.</p>}
                </div>
              </div>

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
