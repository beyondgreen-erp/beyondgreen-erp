'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import Comments from '@/components/Comments'

const STATUS_COLORS: Record<string, string> = {
  'Received': '#00c875',
  'PO Issued': '#fdab3d',
  'In Transit': '#df2f4a',
  'Delayed': '#bb3354',
  'Short Ship': '#9d50dd',
  'PO Cancelled': '#7f5347',
  'Partial Received': '#579bfc',
  "Verification Req'd": '#ff007f',
  'Awaiting Shipment': '#ffcb00',
  'Pending Review': '#333333',
  'Ready for Pick-Up': '#4eccc6',
  'Order Placed': '#cab641',
  'Pending Order': '#ff6d3b',
  'Missing Item': '#784bd1',
  'Return': '#ff5ac4',
}
const STATUS_OPTIONS = Object.keys(STATUS_COLORS)
const LOCATION_OPTIONS = ['SAN ANTONIO, TX', 'SANTA ANA, CA']
const PO_REQUIRED_OPTIONS = ['Yes', 'No', 'Unsure']

const LOCATION_COLORS: Record<string, string> = {
  'SAN ANTONIO, TX': '#5559df',
  'SANTA ANA, CA': '#00c875',
  'Unspecified': '#9aa0ad',
}
const statusColor = (s: string | null) => (s && STATUS_COLORS[s]) || '#c4c4c4'
const fmtDate = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

// Field config for the drawer (order matters)
const FIELDS: { key: string; label: string; kind: 'text' | 'date' | 'status' | 'location' | 'po_req' }[] = [
  { key: 'status', label: 'Status', kind: 'status' },
  { key: 'location', label: 'Location', kind: 'location' },
  { key: 'po_required', label: 'PO Required?', kind: 'po_req' },
  { key: 'po_number', label: 'PO Number', kind: 'text' },
  { key: 'supplier', label: 'Supplier', kind: 'text' },
  { key: 'supplier_pn', label: 'Supplier P/N', kind: 'text' },
  { key: 'po_date', label: 'PO Date', kind: 'date' },
  { key: 'date_expected', label: 'Date Expected', kind: 'date' },
  { key: 'quantity_ordered', label: 'Qty Ordered', kind: 'text' },
  { key: 'date_recd', label: 'Date Recd', kind: 'date' },
  { key: 'quantity_recd', label: 'Qty Recd', kind: 'text' },
  { key: 'pkgs_recd', label: '# Pkgs Recd', kind: 'text' },
  { key: 'condition_recd', label: 'Condition Recd', kind: 'text' },
  { key: 'received_by', label: 'Received By', kind: 'text' },
  { key: 'batch_lot', label: 'Batch / Lot No.', kind: 'text' },
  { key: 'balance', label: 'Balance', kind: 'text' },
  { key: 'customer_project', label: 'Customer / Project', kind: 'text' },
  { key: 'person_requesting', label: 'Person Requesting', kind: 'text' },
]

type Line = {
  id?: string
  _new?: boolean
  part_number?: string | null
  qty_ordered?: string | null
  description?: string | null
  supplier_pn?: string | null
  total_received?: string | null
  date_received?: string | null
  balance?: string | null
}

export default function ReceivingBoard({ year }: { year: number }) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<any[]>([])
  const [items, setItems] = useState<any[]>([])
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [detail, setDetail] = useState<any | null>(null)
  const [userEmail, setUserEmail] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<any>({})
  const [lines, setLines] = useState<Line[]>([])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: r } = await sb.from('historical_receiving').select('*').eq('board_year', year).order('position', { nullsFirst: false })
    const ids = (r || []).map((x: any) => x.id)
    const [{ data: it }, { data: cm }] = await Promise.all([
      ids.length ? sb.from('historical_receiving_items').select('*').in('parent_id', ids).order('position', { nullsFirst: false }) : Promise.resolve({ data: [] as any[] }),
      ids.length ? sb.from('comments').select('record_id').eq('record_type', 'historical_receiving').in('record_id', ids) : Promise.resolve({ data: [] as any[] }),
    ])
    setRows(r || []); setItems(it || [])
    const counts: Record<string, number> = {}
    ;(cm || []).forEach((c: any) => { counts[c.record_id] = (counts[c.record_id] || 0) + 1 })
    setCommentCounts(counts)
    setLoading(false)
    sb.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email) })
  }, [sb, year])
  useEffect(() => { load() }, [load])

  const itemsOf = (oid: string) => items.filter(i => i.parent_id === oid).sort((a, b) => (a.position || 0) - (b.position || 0))
  const match = (r: any) => {
    if (!q) return true
    const s = q.toLowerCase()
    return ['name', 'status', 'po_number', 'supplier', 'supplier_pn', 'location', 'batch_lot', 'received_by', 'customer_project'].some(k => String(r[k] ?? '').toLowerCase().includes(s))
      || itemsOf(r.id).some(i => String(i.part_number ?? '').toLowerCase().includes(s))
  }

  // Groups by location, stable order + any extras
  const groups = useMemo(() => {
    const present = new Set(rows.map(r => r.location || 'Unspecified'))
    const ordered = [...LOCATION_OPTIONS, 'Unspecified'].filter(g => present.has(g))
    for (const g of present) if (!ordered.includes(g)) ordered.push(g)
    return ordered.map(g => ({ key: g, title: g, color: LOCATION_COLORS[g] || '#9aa0ad' }))
  }, [rows])
  const groupRows = (key: string) => rows.filter(r => (r.location || 'Unspecified') === key && match(r))

  const total = rows.length
  const detailItems = detail ? itemsOf(detail.id) : []

  function openDetail(r: any) { setEditing(false); setDetail(r) }
  function closeDetail() { setDetail(null); setEditing(false) }

  function startEdit() {
    if (!detail) return
    const f: any = {}
    for (const fld of FIELDS) f[fld.key] = detail[fld.key] ?? ''
    f.name = detail.name ?? ''
    setForm(f)
    setLines(detailItems.map(i => ({
      id: i.id, part_number: i.part_number ?? '', qty_ordered: i.qty_ordered ?? '',
      description: i.description ?? '', supplier_pn: i.supplier_pn ?? '',
      total_received: i.total_received ?? '', date_received: i.date_received ?? '', balance: i.balance ?? '',
    })))
    setEditing(true)
  }
  const setLine = (idx: number, patch: Partial<Line>) => setLines(ls => ls.map((l, i) => i === idx ? { ...l, ...patch } : l))
  const addLine = () => setLines(ls => [...ls, { _new: true, part_number: '', qty_ordered: '' }])
  const removeLine = (idx: number) => setLines(ls => ls.filter((_, i) => i !== idx))

  async function saveRecord() {
    if (!detail) return
    setSaving(true)
    try {
      const clean = (v: any) => { const s = String(v ?? '').trim(); return s === '' ? null : s }
      const patch: any = { name: clean(form.name) ?? detail.name, updated_at: new Date().toISOString() }
      for (const fld of FIELDS) patch[fld.key] = (fld.kind === 'date') ? (form[fld.key] || null) : clean(form[fld.key])
      const { error: upErr } = await sb.from('historical_receiving').update(patch).eq('id', detail.id)
      if (upErr) { alert('Save failed: ' + upErr.message); return }

      const keptIds = lines.filter(l => l.id && !l._new).map(l => l.id)
      const toDelete = detailItems.map(i => i.id).filter(id => !keptIds.includes(id))
      if (toDelete.length) await sb.from('historical_receiving_items').delete().in('id', toDelete)
      for (let idx = 0; idx < lines.length; idx++) {
        const l = lines[idx]
        const cln = (v: any) => { const s = String(v ?? '').trim(); return s === '' ? null : s }
        const row: any = {
          parent_id: detail.id, part_number: cln(l.part_number), qty_ordered: cln(l.qty_ordered),
          description: cln(l.description), supplier_pn: cln(l.supplier_pn), total_received: cln(l.total_received),
          date_received: l.date_received || null, balance: cln(l.balance), position: idx,
        }
        if (l._new || !l.id) await sb.from('historical_receiving_items').insert(row)
        else await sb.from('historical_receiving_items').update(row).eq('id', l.id)
      }
      const updated = { ...detail, ...patch }
      setDetail(updated); setEditing(false); await load()
    } finally { setSaving(false) }
  }

  async function deleteRecord() {
    if (!detail) return
    if (!confirm(`Delete "${detail.name}"?\n\nThis permanently removes the record, its ${detailItems.length} line item(s), and all of its comments. This cannot be undone.`)) return
    setDeleting(true)
    try {
      await sb.from('historical_receiving_items').delete().eq('parent_id', detail.id)
      await sb.rpc('delete_record_comments', { p_record_type: 'historical_receiving', p_record_id: detail.id })
      const { error } = await sb.from('historical_receiving').delete().eq('id', detail.id)
      if (error) { alert('Delete failed: ' + error.message); return }
      closeDetail(); await load()
    } finally { setDeleting(false) }
  }

  async function uploadRecordFile(rec: any, file: File) {
    setUploading(true)
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `receiving/${rec.id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safe}`
      const { error } = await sb.storage.from('record-board').upload(path, file)
      if (error) { alert('Upload failed: ' + error.message); return }
      const { data } = sb.storage.from('record-board').getPublicUrl(path)
      const next = [...(rec.attachments || []), { name: file.name, url: data.publicUrl }]
      await sb.from('historical_receiving').update({ attachments: next }).eq('id', rec.id)
      setRows(rs => rs.map(o => o.id === rec.id ? { ...o, attachments: next } : o))
      setDetail((d: any) => (d && d.id === rec.id ? { ...d, attachments: next } : d))
    } finally { setUploading(false) }
  }
  async function removeRecordFile(rec: any, idx: number) {
    const next = (rec.attachments || []).filter((_: any, i: number) => i !== idx)
    await sb.from('historical_receiving').update({ attachments: next }).eq('id', rec.id)
    setRows(rs => rs.map(o => o.id === rec.id ? { ...o, attachments: next } : o))
    setDetail((d: any) => (d && d.id === rec.id ? { ...d, attachments: next } : d))
  }

  const inputCls = 'w-full bg-white border border-[#E4E6EE] rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3B6FE0]/40'
  const cellCls = 'w-full bg-white border border-[#E4E6EE] rounded px-1.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#3B6FE0]/40'

  function editControl(fld: typeof FIELDS[number]) {
    if (fld.kind === 'status') return <select className={inputCls} value={form.status || ''} onChange={e => setForm((f: any) => ({ ...f, status: e.target.value }))}><option value="">—</option>{STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}</select>
    if (fld.kind === 'location') return <select className={inputCls} value={form.location || ''} onChange={e => setForm((f: any) => ({ ...f, location: e.target.value }))}><option value="">—</option>{LOCATION_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}</select>
    if (fld.kind === 'po_req') return <select className={inputCls} value={form.po_required || ''} onChange={e => setForm((f: any) => ({ ...f, po_required: e.target.value }))}><option value="">—</option>{PO_REQUIRED_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}</select>
    if (fld.kind === 'date') return <input type="date" className={inputCls} value={form[fld.key] || ''} onChange={e => setForm((f: any) => ({ ...f, [fld.key]: e.target.value }))} />
    return <input className={inputCls} value={form[fld.key] ?? ''} onChange={e => setForm((f: any) => ({ ...f, [fld.key]: e.target.value }))} />
  }

  return (
    <div className="min-h-screen mon-page p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <span className="mon-tag t-blue">📦 {year} Item Order / Receiving</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">{year} Item Order / Receiving</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${total} records`}</p>
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, PO#, supplier, P/N…" className="bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm w-full sm:w-80 focus:outline-none focus:ring-2 focus:ring-[#3B6FE0]/40" />
      </div>

      <div className="space-y-4">
        {groups.map(group => {
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
                  <table className="w-full text-sm min-w-[960px]">
                    <thead>
                      <tr className="text-[11px] uppercase text-gray-400 border-b border-[#EEF0F4]">
                        <th className="text-left px-4 py-2 font-semibold">Item</th>
                        <th className="text-left px-3 py-2 font-semibold w-[150px]">Status</th>
                        <th className="text-left px-3 py-2 font-semibold w-[130px]">PO #</th>
                        <th className="text-left px-3 py-2 font-semibold w-[160px]">Supplier</th>
                        <th className="text-left px-3 py-2 font-semibold w-[110px]">PO Date</th>
                        <th className="text-left px-3 py-2 font-semibold w-[70px]">Lines</th>
                        <th className="text-left px-3 py-2 font-semibold w-[80px]">Files</th>
                        <th className="text-left px-3 py-2 font-semibold w-[90px]">Comments</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gr.map((r, i) => {
                        const its = itemsOf(r.id)
                        const nFiles = r.attachments?.length || 0
                        const nc = commentCounts[r.id] || 0
                        return (
                          <tr key={r.id} className={`cursor-pointer hover:bg-[#F2F6FF] ${i % 2 ? 'bg-[#F8FAFC]' : 'bg-white'}`} onClick={() => openDetail(r)}>
                            <td className="px-4 py-2.5 font-semibold text-[#1A1D2E]">{r.name || '—'}</td>
                            <td className="px-3 py-2.5">{r.status ? <span className="text-white text-[11px] font-semibold rounded-full px-2.5 py-1 inline-block" style={{ background: statusColor(r.status) }}>{r.status}</span> : <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-2.5 text-gray-600">{r.po_number || '—'}</td>
                            <td className="px-3 py-2.5 text-gray-600 truncate max-w-[160px]">{r.supplier || '—'}</td>
                            <td className="px-3 py-2.5 text-gray-600">{fmtDate(r.po_date) || '—'}</td>
                            <td className="px-3 py-2.5 text-gray-600">{its.length || '—'}</td>
                            <td className="px-3 py-2.5">{nFiles ? <span className="text-[#3B6FE0] text-xs font-semibold">📎 {nFiles}</span> : <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-2.5">{nc ? <span className="text-emerald-600 text-xs font-semibold">💬 {nc}</span> : <span className="text-gray-300">—</span>}</td>
                          </tr>
                        )
                      })}
                      {gr.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-400 text-sm">No records</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
        {!loading && groups.length === 0 && <div className="bg-white rounded-xl border border-[#ECEEF3] p-8 text-center text-gray-400 text-sm">No records.</div>}
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: 'rgba(26,32,53,0.5)' }} >
          <div className="relative w-full max-w-[860px] my-6 bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between px-6 py-4 text-white" style={{ background: LOCATION_COLORS[detail.location || 'Unspecified'] || '#175a63' }}>
              <div className="min-w-0">
                <p className="text-white/70 text-xs uppercase tracking-wide">{year} Item Order / Receiving · {detail.location || 'Unspecified'}</p>
                <h2 className="text-xl font-bold leading-tight">{detail.name || '—'}</h2>
                {detail.status && <span className="inline-block mt-1.5 text-[11px] font-semibold rounded-full px-2.5 py-0.5" style={{ background: statusColor(detail.status), color: '#fff' }}>{detail.status}</span>}
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
              {editing ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  <label className="col-span-2 sm:col-span-3">
                    <span className="text-[11px] uppercase tracking-wide text-gray-400">Item Name</span>
                    <input className={inputCls} value={form.name} onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))} />
                  </label>
                  {FIELDS.map(fld => (
                    <label key={fld.key}>
                      <span className="text-[11px] uppercase tracking-wide text-gray-400">{fld.label}</span>
                      {editControl(fld)}
                    </label>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                  {FIELDS.map(fld => (
                    <Field key={fld.key} label={fld.label} value={fld.kind === 'date' ? fmtDate(detail[fld.key]) : detail[fld.key]} />
                  ))}
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Line Items</p>
                  {editing && <button onClick={addLine} className="text-xs px-2.5 py-1 rounded-lg bg-[#EAF0FC] text-[#3B6FE0] font-semibold hover:bg-[#DCE7FB]">＋ Add line</button>}
                </div>
                {editing ? (
                  <div className="border border-[#EEF0F4] rounded-lg overflow-x-auto">
                    <table className="w-full text-sm min-w-[760px]">
                      <thead><tr className="bg-[#FBFCFE] text-[11px] uppercase text-gray-400">
                        <th className="text-left px-2 py-2 w-[150px]">P/N</th>
                        <th className="text-left px-2 py-2 w-[90px]">Qty Ord.</th>
                        <th className="text-left px-2 py-2">Description</th>
                        <th className="text-left px-2 py-2 w-[110px]">Total Recd</th>
                        <th className="text-left px-2 py-2 w-[130px]">Date Recd</th>
                        <th className="text-left px-2 py-2 w-[90px]">Balance</th>
                        <th className="px-1 py-2 w-[32px]"></th>
                      </tr></thead>
                      <tbody>
                        {lines.map((l, idx) => (
                          <tr key={l.id || `new-${idx}`} className="border-t border-[#F0F2F6]">
                            <td className="px-2 py-1.5"><input className={cellCls + ' font-mono'} value={l.part_number ?? ''} onChange={e => setLine(idx, { part_number: e.target.value })} /></td>
                            <td className="px-2 py-1.5"><input className={cellCls} value={l.qty_ordered ?? ''} onChange={e => setLine(idx, { qty_ordered: e.target.value })} /></td>
                            <td className="px-2 py-1.5"><input className={cellCls} value={l.description ?? ''} onChange={e => setLine(idx, { description: e.target.value })} /></td>
                            <td className="px-2 py-1.5"><input className={cellCls} value={l.total_received ?? ''} onChange={e => setLine(idx, { total_received: e.target.value })} /></td>
                            <td className="px-2 py-1.5"><input type="date" className={cellCls} value={l.date_received ?? ''} onChange={e => setLine(idx, { date_received: e.target.value })} /></td>
                            <td className="px-2 py-1.5"><input className={cellCls} value={l.balance ?? ''} onChange={e => setLine(idx, { balance: e.target.value })} /></td>
                            <td className="px-1 py-1.5 text-center"><button onClick={() => removeLine(idx)} className="text-gray-300 hover:text-red-500 text-base leading-none" title="Remove line">×</button></td>
                          </tr>
                        ))}
                        {lines.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-center text-gray-400 text-sm">No line items. Click “＋ Add line”.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                ) : detailItems.length === 0 ? <p className="text-sm text-gray-400">No line items.</p> : (
                  <div className="border border-[#EEF0F4] rounded-lg overflow-x-auto">
                    <table className="w-full text-sm min-w-[680px]">
                      <thead><tr className="bg-[#FBFCFE] text-[11px] uppercase text-gray-400">
                        <th className="text-left px-3 py-2">P/N</th>
                        <th className="text-left px-3 py-2">Qty Ordered</th>
                        <th className="text-left px-3 py-2">Description</th>
                        <th className="text-left px-3 py-2">Total Received</th>
                        <th className="text-left px-3 py-2">Date Received</th>
                        <th className="text-left px-3 py-2">Balance</th>
                      </tr></thead>
                      <tbody>
                        {detailItems.map(it => (
                          <tr key={it.id} className="border-t border-[#F0F2F6]">
                            <td className="px-3 py-2 font-mono text-emerald-700">{it.part_number || it.name || '—'}</td>
                            <td className="px-3 py-2">{it.qty_ordered || '—'}</td>
                            <td className="px-3 py-2">{it.description || '—'}</td>
                            <td className="px-3 py-2">{it.total_received || '—'}</td>
                            <td className="px-3 py-2">{fmtDate(it.date_received) || '—'}</td>
                            <td className="px-3 py-2">{it.balance || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {editing && (
                <div className="flex items-center justify-between gap-3 border-t border-[#EEF0F4] pt-4">
                  <button onClick={deleteRecord} disabled={deleting || saving} className="text-xs font-semibold rounded-lg px-3 py-2 text-red-600 hover:bg-red-50 disabled:opacity-50">{deleting ? 'Deleting…' : '🗑 Delete record'}</button>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setEditing(false)} disabled={saving} className="text-sm px-4 py-2 rounded-lg border border-[#E4E6EE] text-gray-600 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
                    <button onClick={saveRecord} disabled={saving} className="text-sm px-4 py-2 rounded-lg text-white font-semibold disabled:opacity-50" style={{ background: '#175a63' }}>{saving ? 'Saving…' : 'Save changes'}</button>
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Files</p>
                  <div>
                    <input ref={fileRef} type="file" multiple className="hidden" onChange={async e => { const fs = Array.from(e.target.files || []); for (const f of fs) { await uploadRecordFile(detail, f) } if (e.target) e.target.value = '' }} />
                    <button onClick={() => fileRef.current?.click()} disabled={uploading} className="text-xs px-2.5 py-1.5 rounded-lg bg-[#3B6FE0] text-white font-semibold hover:opacity-90 disabled:opacity-50">{uploading ? 'Uploading…' : '＋ Upload file'}</button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(detail.attachments || []).map((f: any, idx: number) => (
                    <div key={'a' + idx} className="flex items-center gap-2 text-xs bg-[#F5FBF7] border border-[#CDEBD9] rounded-lg px-3 py-2">
                      <a href={f.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 min-w-0 hover:underline">
                        <span className="text-emerald-600">📎</span>
                        <span className="min-w-0"><span className="block font-semibold text-gray-700 truncate max-w-[220px]">{f.name}</span><span className="text-[10px] text-gray-400">Uploaded</span></span>
                      </a>
                      <button onClick={() => removeRecordFile(detail, idx)} className="text-gray-300 hover:text-red-500 leading-none text-base">×</button>
                    </div>
                  ))}
                  {(detail.attachments?.length || 0) === 0 && <p className="text-sm text-gray-400">No files yet — upload one above.</p>}
                </div>
              </div>

              <div className="border-t border-[#EEF0F4] pt-4">
                <Comments recordId={detail.id} recordType="historical_receiving" currentUserEmail={userEmail} title="Notes & Comments" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-gray-800 mt-0.5 break-words">{value || <span className="text-gray-300">—</span>}</p>
    </div>
  )
}
