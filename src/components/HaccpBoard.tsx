'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import Link from 'next/link'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'
import { useEmployees, directoryHref, peopleOf } from '@/lib/useEmployees'
import { parseDate, today, daysBetween, addDays, fmtDate } from '@/lib/compliance'

type Field = { key: string; label: string; type?: string; options?: string[] }
const PLATFORMS = ['Shopify', 'AMAZON', 'Chewy', 'Private Label', 'faire.com', 'B2B', 'Dropship']
const COMPLAINT_STATUS = ['Open', 'Investigating', 'Resolved', 'Closed']
const CAPA_STATUS = ['Open', 'In Progress', 'Verified', 'Closed']
const CAPA_SOURCE = ['Customer Complaint', 'Internal Audit', 'NCR', 'Manual']

const COMPLAINT_FIELDS: Field[] = [
  { key: 'title', label: 'Title / Product Line' },
  { key: 'complaint_number', label: 'Complaint #' },
  { key: 'product', label: 'Product / SKU' },
  { key: 'platform', label: 'Platform', type: 'select', options: PLATFORMS },
  { key: 'complaint_received_date', label: 'Received Date', type: 'date' },
  { key: 'customer_email', label: 'Customer Email' },
  { key: 'status', label: 'Status', type: 'select', options: COMPLAINT_STATUS },
  { key: 'complaint', label: 'Complaint', type: 'area' },
  { key: 'resolution', label: 'Resolution', type: 'area' },
]
const CAPA_FIELDS: Field[] = [
  { key: 'capa_number', label: 'CAPA #' },
  { key: 'capa_date', label: 'Date', type: 'date' },
  { key: 'source', label: 'Source', type: 'select', options: CAPA_SOURCE },
  { key: 'department', label: 'Department' },
  { key: 'responsible_person', label: 'Responsible Person', type: 'person' },
  { key: 'status', label: 'Status', type: 'select', options: CAPA_STATUS },
  { key: 'description', label: 'Non-Conformance / Problem', type: 'area' },
  { key: 'immediate_correction', label: 'Immediate Correction', type: 'area' },
  { key: 'why1', label: '5 Whys - Why 1?' },
  { key: 'why2', label: 'Why 2?' },
  { key: 'why3', label: 'Why 3?' },
  { key: 'why4', label: 'Why 4?' },
  { key: 'why5', label: 'Why 5? (root cause)' },
  { key: 'root_cause', label: 'Root Cause', type: 'area' },
  { key: 'corrective_action', label: 'Corrective Action', type: 'area' },
  { key: 'corrective_target_date', label: 'Corrective Target Date', type: 'date' },
  { key: 'corrective_effective', label: 'Corrective Effective?', type: 'bool' },
  { key: 'preventive_action', label: 'Preventive Action', type: 'area' },
  { key: 'preventive_target_date', label: 'Preventive Target Date', type: 'date' },
  { key: 'preventive_effective', label: 'Preventive Effective?', type: 'bool' },
  { key: 'verified_by', label: 'Verified By', type: 'person' },
  { key: 'verified_date', label: 'Verified Date', type: 'date' },
  { key: 'evidence', label: 'Evidence', type: 'area' },
]

function fmt(v: any) { if (v === true) return 'Yes'; if (v === false) return 'No'; if (v == null || v === '') return '-'; return String(v) }

export default function HaccpBoard({ lock }: { lock?: 'complaints' | 'capa' }) {
  const [board, setBoard] = useState<string>(lock || 'complaints')
  const employees = useEmployees()
  const [view, setView] = useState<'all' | 'open' | 'overdue'>('all')
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<any>(null)
  const [isNew, setIsNew] = useState(false)
  const [ai, setAi] = useState(false)
  const [aiText, setAiText] = useState('')
  const [busy, setBusy] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const fields = board === 'capa' ? CAPA_FIELDS : COMPLAINT_FIELDS

  useEffect(() => { sb.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email) }) }, [sb])
  useEffect(() => { load() }, [board])
  useEffect(() => { if (lock) return; const p = new URLSearchParams(window.location.search); const b = p.get('board'); if (b === 'complaints' || b === 'capa') setBoard(b) }, [lock])
  useEffect(() => { const p = new URLSearchParams(window.location.search); const id = p.get('item'); if (id && rows.length) { const f = rows.find((x) => String(x.id) === id); if (f) { openEdit(f); window.history.replaceState({}, '', window.location.pathname) } } }, [rows])

  async function load() {
    setLoading(true)
    try { const r = await fetch('/api/haccp?board=' + board); const j = await r.json(); setRows(j.rows || []) } catch (e) {}
    setLoading(false)
  }
  function openAdd() { setEditing({}); setIsNew(true) }
  function openEdit(row: any) { setEditing({ ...row }); setIsNew(false) }
  async function uploadAttachment(e: any) {
    const files = e.target.files; if (!files || !files.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files) as any[]) {
        const dataBase64: string = await new Promise((res) => { const rd = new FileReader(); rd.onload = () => res(String(rd.result).split(',')[1]); rd.readAsDataURL(file); });
        const r = await fetch('/api/haccp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upload', board, id: (editing && editing.id) || '', file: { name: file.name, contentType: file.type, dataBase64 } }) });
        const j = await r.json();
        if (j.ok) { setEditing((prev: any) => ({ ...prev, attachments: [ ...((prev && prev.attachments) || []), { url: j.url, name: j.name, contentType: j.contentType } ] })); } else { alert(j.error || 'Upload failed'); }
      }
    } catch (err: any) { alert((err && err.message) || 'Upload failed'); }
    setBusy(false); e.target.value = '';
  }
  function removeAttachment(idx: number) {
    setEditing((prev: any) => ({ ...prev, attachments: (((prev && prev.attachments) || []).filter((_: any, i: number) => i !== idx)) }));
  }
  async function save() {
    setBusy(true)
    try {
      const r = await fetch('/api/haccp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: isNew ? 'create' : 'update', board, id: editing.id, data: editing, created_by: userEmail }) })
      const j = await r.json()
      if (j.ok) { setEditing(null); await load() } else { alert(j.error || 'Save failed') }
    } catch (e: any) { alert(e?.message || 'Save failed') }
    setBusy(false)
  }
  async function remove(row: any) {
    if (!confirm('Delete this entry? This cannot be undone.')) return
    await fetch('/api/haccp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', board, id: row.id }) })
    await load()
  }
  async function runAi() {
    if (!aiText.trim()) return
    setBusy(true)
    try {
      const r = await fetch('/api/haccp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ai_quick_add', board, text: aiText, created_by: userEmail }) })
      const j = await r.json()
      if (j.ok) { setAi(false); setAiText(''); await load() } else { alert(j.error || 'AI add failed') }
    } catch (e: any) { alert(e?.message || 'AI add failed') }
    setBusy(false)
  }

  const cols: string[][] = board === 'capa'
    ? [['capa_number', 'CAPA #'], ['source', 'Source'], ['description', 'Problem'], ['corrective_action', 'Corrective Action'], ['responsible_person', 'Responsible'], ['status', 'Status'], ['capa_date', 'Date'], ['corrective_target_date', 'Target'], ['capa_file_url', 'File']]
    : [['complaint_number', 'Complaint #'], ['title', 'Title'], ['product', 'Product'], ['platform', 'Platform'], ['complaint', 'Complaint'], ['status', 'Status'], ['complaint_received_date', 'Date']]

  // ---- live status: what is open, what is late, how fast things close
  const t = today()
  const isClosed = (r: any) => /closed|verified|complete|done|resolved/i.test(String(r.status || ''))
  const openedOf = (r: any) => parseDate(board === 'capa' ? r.capa_date : r.complaint_received_date) || parseDate(r.created_at)
  const dueOf = (r: any) => {
    if (board === 'capa') { const tgt = parseDate(r.corrective_target_date); if (tgt) return tgt }
    const o = openedOf(r); return o ? addDays(o, 30) : null
  }
  const lateDays = (r: any) => { if (isClosed(r)) return null; const d = dueOf(r); return d ? daysBetween(d, t) : null }
  const stats = useMemo(() => {
    const open = rows.filter(r => !isClosed(r))
    const overdue = open.filter(r => (lateDays(r) ?? -1) > 0)
    const closeDays: number[] = []
    rows.forEach(r => { if (!isClosed(r)) return; const o = openedOf(r); const c = parseDate(board === 'capa' ? r.verified_date : r.updated_at); if (o && c && c >= o) closeDays.push(daysBetween(o, c)) })
    const months: any[] = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(t.getFullYear(), t.getMonth() - i, 1)
      const same = (x: Date | null) => !!x && x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth()
      months.push({ label: d.toLocaleDateString('en-US', { month: 'short' }), opened: rows.filter(r => same(openedOf(r))).length, closed: rows.filter(r => isClosed(r) && same(parseDate(board === 'capa' ? r.verified_date : r.updated_at))).length })
    }
    const year = rows.filter(r => { const o = openedOf(r); return o && o >= addDays(t, -365) }).length
    return { open: open.length, overdue, avgClose: closeDays.length ? Math.round(closeDays.reduce((a, b) => a + b, 0) / closeDays.length) : null, months, year }
  }, [rows, board]) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = rows.filter(r => view === 'all' ? true : view === 'open' ? !isClosed(r) : (lateDays(r) ?? -1) > 0)
  const noun = board === 'capa' ? 'CAPA' : 'complaint'
  const title = board === 'capa' ? 'CAPA Log' : 'Customer Complaints'
  const personCell = (v: any) => {
    const names = peopleOf(v); if (!names.length) return <span className="text-gray-300">-</span>
    return <span className="flex flex-wrap gap-1">{names.map(n => <Link key={n} href={directoryHref(n)} className="text-[#0B6E99] hover:underline whitespace-nowrap">{n}</Link>)}</span>
  }
  const cellFor = (row: any, key: string) => {
    if (key === 'capa_file_url') return row.capa_file_url ? <a href={row.capa_file_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Open</a> : <span className="text-gray-300">-</span>
    if (key === 'responsible_person') return personCell(row[key])
    if (key === 'status') { const late = lateDays(row); return <span className="inline-flex items-center gap-1 flex-wrap"><span className={'text-[11px] font-semibold px-2 py-0.5 rounded-full ' + (isClosed(row) ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>{fmt(row.status)}</span>{late !== null && late > 0 && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600">{late}d late</span>}</span> }
    return <div className="line-clamp-3 max-w-xs">{fmt(row[key])}</div>
  }

  return (
    <div className="min-h-screen" style={{ background: '#F5F6FA' }}>
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 mb-4">
        <div className="flex-1 min-w-0">
          <Link href="/compliance" className="text-xs font-semibold text-emerald-700 hover:underline">&larr; Compliance Dashboard</Link>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1">{title}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{board === 'capa' ? 'Corrective and preventive actions. Every complaint opens a linked CAPA; target dates drive the overdue alerts.' : 'Every customer complaint, investigated and closed within 30 days. Each one opens a linked CAPA automatically.'}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setAi(true)} className="text-sm font-semibold px-4 py-2 rounded-lg border border-[#E4E6EE] bg-white text-gray-700 hover:bg-gray-50">AI Quick Add</button>
          <button onClick={openAdd} className="text-sm font-semibold px-4 py-2 rounded-lg text-white" style={{ background: '#00A84F' }}>+ Log {noun}</button>
        </div>
      </div>

      {!lock && (
        <div className="flex gap-1 bg-white border border-[#E4E6EE] rounded-xl p-1 mb-4 w-fit">
          <button onClick={() => setBoard('complaints')} className={'px-4 py-2 text-sm font-semibold rounded-lg ' + (board === 'complaints' ? 'bg-[#1A1D2E] text-white' : 'text-gray-600 hover:bg-gray-100')}>Customer Complaints</button>
          <button onClick={() => setBoard('capa')} className={'px-4 py-2 text-sm font-semibold rounded-lg ' + (board === 'capa' ? 'bg-[#1A1D2E] text-white' : 'text-gray-600 hover:bg-gray-100')}>CAPA Log</button>
        </div>
      )}

      {/* Status strip + trend */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 mb-4">
        <div className="lg:col-span-2 grid grid-cols-2 gap-3">
          {[
            { l: 'Open', v: stats.open, c: stats.open ? '#B45309' : '#00753A' },
            { l: board === 'capa' ? 'Past target date' : 'Open over 30 days', v: stats.overdue.length, c: stats.overdue.length ? '#C8102E' : '#00753A' },
            { l: 'Avg days to close', v: stats.avgClose ?? '-', c: '#1A1D2E' },
            { l: 'Logged in 12 months', v: stats.year, c: '#1A1D2E' },
          ].map(x => <div key={x.l} className="bg-white rounded-xl border border-[#E4E6EE] p-3"><p className="text-xs text-gray-500">{x.l}</p><p className="text-2xl font-bold mt-1" style={{ color: x.c }}>{x.v}</p></div>)}
        </div>
        <div className="lg:col-span-3 bg-white rounded-xl border border-[#E4E6EE] p-3">
          <p className="text-xs font-semibold text-gray-500 mb-1">Opened vs closed, last 12 months</p>
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.months} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F4" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6B7280' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#6B7280' }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="opened" name="Opened" fill={board === 'capa' ? '#DC2626' : '#F59E0B'} radius={[3, 3, 0, 0]} />
                <Bar dataKey="closed" name="Closed" fill="#00A84F" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {stats.overdue.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 mb-4">
          <p className="text-sm font-semibold text-red-700"><i className="ti ti-alarm" /> {stats.overdue.length} {noun}{stats.overdue.length === 1 ? ' is' : 's are'} late. Close {stats.overdue.length === 1 ? 'it' : 'them'} out before the next audit.</p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {stats.overdue.slice(0, 12).map((r: any) => <button key={r.id} onClick={() => openEdit(r)} className="text-xs font-semibold px-2 py-1 rounded-lg bg-white border border-red-200 text-red-700 hover:bg-red-100">{r.capa_number || r.complaint_number || r.title || 'Open'} · {lateDays(r)}d</button>)}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mb-2">
        {(['all', 'open', 'overdue'] as const).map(v => <button key={v} onClick={() => setView(v)} className={'text-xs font-semibold px-3 py-1.5 rounded-lg border ' + (view === v ? 'bg-[#1A1D2E] text-white border-[#1A1D2E]' : 'bg-white text-gray-600 border-[#E4E6EE]')}>{v === 'all' ? `All (${rows.length})` : v === 'open' ? `Open (${stats.open})` : `Late (${stats.overdue.length})`}</button>)}
      </div>

      {/* Phone: record cards */}
      <div className="md:hidden space-y-2">
        {loading ? <p className="text-sm text-gray-400">Loading...</p> : shown.length === 0 ? <p className="text-sm text-gray-400">No entries.</p> : shown.map(row => (
          <button key={row.id} onClick={() => openEdit(row)} className="w-full text-left bg-white rounded-xl border border-[#E4E6EE] p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold text-sm text-[#1A1D2E] break-words">{board === 'capa' ? (row.capa_number || 'CAPA') : (row.complaint_number ? row.complaint_number + ' · ' : '') + (row.title || row.product || 'Complaint')}</p>
              {cellFor(row, 'status')}
            </div>
            <p className="text-xs text-gray-600 mt-1 break-words">{board === 'capa' ? fmt(row.description) : fmt(row.complaint)}</p>
            <p className="text-[11px] text-gray-500 mt-1">{fmtDate(openedOf(row))}{board === 'capa' && row.responsible_person ? ' · ' + row.responsible_person : ''}{board === 'capa' && row.corrective_target_date ? ' · target ' + fmtDate(row.corrective_target_date) : ''}</p>
          </button>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden md:block bg-white border border-[#E4E6EE] rounded-2xl overflow-x-auto">
        <table className="w-full text-left">
          <thead><tr className="text-xs text-gray-500 border-b border-[#E4E6EE]" style={{ background: '#F9FAFB' }}>{cols.map((c) => <th key={c[0]} className="px-4 py-3 whitespace-nowrap">{c[1]}</th>)}<th className="px-4 py-3"></th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={cols.length + 1} className="px-4 py-8 text-center text-gray-400 text-sm">Loading...</td></tr>
              : shown.length === 0 ? <tr><td colSpan={cols.length + 1} className="px-4 py-8 text-center text-gray-400 text-sm">No entries.</td></tr>
                : shown.map((row) => (
                  <tr key={row.id} className="border-b border-[#F1F2F6] hover:bg-[#FAFBFF] align-top cursor-pointer" onClick={() => openEdit(row)}>
                    {cols.map((c) => <td key={c[0]} className="px-4 py-3 text-sm text-gray-700" onClick={e => { if ((e.target as HTMLElement).closest('a')) e.stopPropagation() }}>{cellFor(row, c[0])}</td>)}
                    <td className="px-4 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <button onClick={() => { const u = window.location.origin + (lock ? window.location.pathname + '?item=' : '/haccp?board=' + board + '&item=') + row.id; navigator.clipboard.writeText(u); alert('Item link copied - share it with the team'); }} className="text-xs font-semibold px-2 py-1 rounded-lg border border-[#E4E6EE] text-[#1A1D2E] mr-1">Copy link</button>
                      <button onClick={() => remove(row)} className="text-xs font-semibold px-2 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50">Delete</button>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={(isNew ? 'Add ' : 'Edit ') + (board === 'capa' ? 'CAPA' : 'Complaint')} onClose={() => setEditing(null)}>
          <datalist id="haccp-employees">{employees.map(e => <option key={e.id} value={e.name}>{e.job_description || e.department || ''}</option>)}</datalist>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {fields.map((f) => (
              <div key={f.key} className={f.type === 'area' ? 'sm:col-span-2' : ''}>
                <label className="block text-xs font-semibold text-gray-500 mb-1">{f.label}</label>
                {f.type === 'area' ? <textarea value={editing[f.key] || ''} onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })} rows={3} className="w-full text-sm px-3 py-2 rounded-lg border border-[#E4E6EE] outline-none" />
                  : f.type === 'select' ? <select value={editing[f.key] || ''} onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })} className="w-full text-sm px-3 py-2 rounded-lg border border-[#E4E6EE]"><option value=""></option>{(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}</select>
                    : f.type === 'bool' ? <select value={editing[f.key] === true ? 'yes' : editing[f.key] === false ? 'no' : ''} onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value === 'yes' ? true : e.target.value === 'no' ? false : null })} className="w-full text-sm px-3 py-2 rounded-lg border border-[#E4E6EE]"><option value="">-</option><option value="yes">Yes</option><option value="no">No</option></select>
                      : f.type === 'person' ? <><input list="haccp-employees" value={editing[f.key] || ''} onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })} placeholder="Pick from the Team Directory" className="w-full text-sm px-3 py-2 rounded-lg border border-[#E4E6EE] outline-none" />{editing[f.key] ? <Link href={directoryHref(String(editing[f.key]))} className="text-[11px] text-[#0B6E99] hover:underline">View in Team Directory</Link> : null}</>
                      : <input type={f.type === 'date' ? 'date' : 'text'} value={editing[f.key] || ''} onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })} className="w-full text-sm px-3 py-2 rounded-lg border border-[#E4E6EE] outline-none" />}
              </div>
            ))}
          </div>
          <div className="col-span-2 mt-2">
            <label className="block text-xs font-semibold text-gray-500 mb-1">Attachments (files or images)</label>
            <input type="file" multiple onChange={uploadAttachment} className="block text-xs mb-2" />
            <div className="flex flex-wrap gap-2">
              {(((editing && editing.attachments) || []) as any[]).map((a: any, i: number) => (
                <div key={i} className="border border-[#E4E6EE] rounded-lg p-2 text-xs flex flex-col items-start gap-1" style={{ maxWidth: "160px" }}>
                  {String(a.contentType || "").indexOf("image") === 0 ? <img src={a.url} alt={a.name} style={{ maxWidth: "140px", maxHeight: "90px", objectFit: "cover", borderRadius: "6px" }} /> : <span className="text-gray-600 break-all">{a.name}</span>}
                  <div className="flex gap-2 mt-1">
                    <a href={a.url} target="_blank" className="text-[#1A1D2E] font-semibold">Open</a>
                    <button onClick={() => { navigator.clipboard.writeText(a.url); alert("Link copied"); }} className="text-[#1A1D2E] font-semibold">Copy link</button>
                    <button onClick={() => removeAttachment(i)} className="text-red-500 font-semibold">Remove</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setEditing(null)} className="text-sm px-4 py-2 rounded-lg border border-[#E4E6EE] text-gray-600">Cancel</button>
            <button onClick={save} disabled={busy} className="text-sm font-semibold px-4 py-2 rounded-lg text-white disabled:opacity-40" style={{ background: '#1A1D2E' }}>{busy ? 'Saving...' : 'Save'}</button>
          </div>
        </Modal>
      )}

      {ai && (
        <Modal title={'AI Quick Add - ' + (board === 'capa' ? 'CAPA' : 'Complaint')} onClose={() => setAi(false)}>
          <p className="text-xs text-gray-500 mb-2">Paste an email, note, or complaint below. The AI reads it, pulls out the fields, and adds the entry{board === 'complaints' ? ' (and automatically opens a linked CAPA)' : ''}.</p>
          <textarea value={aiText} onChange={(e) => setAiText(e.target.value)} rows={10} placeholder="Paste text here..." className="w-full text-sm px-3 py-2 rounded-lg border border-[#E4E6EE] outline-none" />
          <div className="flex justify-end gap-2 mt-3">
            <button onClick={() => setAi(false)} className="text-sm px-4 py-2 rounded-lg border border-[#E4E6EE] text-gray-600">Cancel</button>
            <button onClick={runAi} disabled={busy || !aiText.trim()} className="text-sm font-semibold px-4 py-2 rounded-lg text-white disabled:opacity-40" style={{ background: '#1A1D2E' }}>{busy ? 'Extracting...' : 'Extract & Add'}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Modal({ title, children, onClose }: { title: string; children: any; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" >
      <div className="absolute inset-0 bg-black/30" />
      <div onClick={(e) => e.stopPropagation()} className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-white rounded-2xl shadow-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-[#1A1D2E]">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl px-2">X</button>
        </div>
        {children}
      </div>
    </div>
  )
}
