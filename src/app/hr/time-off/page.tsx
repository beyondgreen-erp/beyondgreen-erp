'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import Comments from '@/components/Comments'

const TYPES = ['Sick', 'Vacation', 'Personal', 'Bereavement', 'Jury Duty', 'Unpaid Leave', 'Work From Home', 'Other']
const TYPE_COLORS: Record<string, string> = {
  'Sick': '#e2445c', 'Vacation': '#00c875', 'Personal': '#579bfc', 'Bereavement': '#784bd1',
  'Jury Duty': '#cab641', 'Unpaid Leave': '#808080', 'Work From Home': '#ff007f', 'Other': '#9699a6',
}
const STATUSES = ['Pending', 'Approved', 'Denied', 'Cancelled']
const STATUS_COLORS: Record<string, string> = {
  'Pending': '#fdab3d', 'Approved': '#00c875', 'Denied': '#e2445c', 'Cancelled': '#808080',
}
const GROUPS = [
  { key: 'Pending', title: 'Pending Approval', color: '#fdab3d' },
  { key: 'Approved', title: 'Approved', color: '#00c875' },
  { key: 'Denied', title: 'Denied', color: '#e2445c' },
  { key: 'Cancelled', title: 'Cancelled', color: '#808080' },
]

const NOTIFY_EMAILS = ['Rudyp@beyondgreenbiotech.com', 'Finance@beyondgreenbiotech.com', 'shea@beyondgreenbiotech.com', 'veejay.patell@byndgrn.com']
const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const typeColor = (t: string | null) => (t && TYPE_COLORS[t]) || '#c4c4c4'
const statusColor = (s: string | null) => (s && STATUS_COLORS[s]) || '#c4c4c4'
const fmtDate = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
const dayCount = (a: string | null, b: string | null) => {
  if (!a || !b) return null
  const d = Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000) + 1
  return d > 0 ? d : null
}
const initials = (name: string) => name.split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase()
const avatarColor = (name: string) => {
  const palette = ['#5559df', '#00c875', '#579bfc', '#a25ddc', '#fdab3d', '#037f4c', '#ff6d3b', '#bb3354', '#00a89b', '#7e3b8a']
  let h = 0; for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

interface Req {
  id: string; employee_name: string | null; employee_email: string | null; type: string | null
  start_date: string | null; end_date: string | null; days: number | null; half_day: boolean
  coverage: string | null; reason: string | null; status: string | null; approver: string | null
  decided_at: string | null; attachments?: { name: string; url: string }[] | null; created_by?: string | null
}

function RequestModal({ open, onClose, onCreated, sb, me }: { open: boolean; onClose: () => void; onCreated: () => void; sb: ReturnType<typeof createSupabaseBrowserClient>; me: { name: string; email: string } }) {
  const [form, setForm] = useState<any>({ employee_name: '', type: 'Vacation', start_date: '', end_date: '', half_day: false, coverage: '', reason: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { if (open) setForm((f: any) => ({ ...f, employee_name: me.name || '' })) }, [open, me.name])

  const auto = dayCount(form.start_date, form.end_date)
  const days = form.half_day ? 0.5 : auto

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError('')
    if (!form.start_date) { setError('Start date is required.'); return }
    setSaving(true)
    try {
      const row = {
        employee_name: form.employee_name?.trim() || me.name || null,
        employee_email: me.email || null,
        type: form.type || null,
        start_date: form.start_date || null,
        end_date: form.end_date || form.start_date || null,
        days: days ?? null,
        half_day: !!form.half_day,
        coverage: form.coverage?.trim() || null,
        reason: form.reason?.trim() || null,
        status: 'Pending',
        created_by: me.email || null,
      }
      const { error } = await sb.from('time_off_requests').insert(row)
      if (error) { setError(error.message); return }
      // Notify approvers of the new request (non-blocking)
      try {
        const dates = row.start_date ? `${fmtDate(row.start_date)}${row.end_date && row.end_date !== row.start_date ? ' – ' + fmtDate(row.end_date) : ''}` : '—'
        const trow = (l: string, v: any) => `<tr><td style="padding:4px 0;color:#6b7280;width:140px">${l}</td><td style="padding:4px 0;font-weight:600">${esc(v) || '—'}</td></tr>`
        const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1A1D2E">`
          + `<h2 style="color:#5559df;margin:0 0 6px;font-size:18px">New time-off request</h2>`
          + `<p style="margin:0 0 14px;font-size:14px">${esc(row.employee_name || 'A team member')} submitted a time-off request for review.</p>`
          + `<table style="border-collapse:collapse;width:100%;font-size:14px">`
          + trow('Employee', row.employee_name)
          + trow('Type', row.type)
          + `<tr><td style="padding:4px 0;color:#6b7280;width:140px">Dates</td><td style="padding:4px 0;font-weight:600">${dates}</td></tr>`
          + trow('Days', row.half_day ? 'Half day' : (row.days != null ? row.days : ''))
          + trow('Coverage / backup', row.coverage)
          + trow('Reason / notes', row.reason)
          + trow('Requested by', row.employee_email)
          + `</table>`
          + `<div style="margin:18px 0 6px"><a href="https://beyondgreen-erp.vercel.app/hr/time-off" style="display:inline-block;background:#5559df;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:600">Review in the ERP</a></div>`
          + `<p style="margin:12px 0 0;font-size:12px;color:#9ca3af">Sent automatically by the beyondGREEN ERP Time Off board.</p>`
          + `</div>`
        fetch('/api/send-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: NOTIFY_EMAILS, subject: `New time-off request — ${row.employee_name || 'Employee'} (${row.type || 'Time off'})`, html, reply_to: row.employee_email || undefined }) }).catch(() => {})
      } catch { /* non-blocking */ }
      setForm({ employee_name: me.name || '', type: 'Vacation', start_date: '', end_date: '', half_day: false, coverage: '', reason: '' })
      onClose(); onCreated()
    } finally { setSaving(false) }
  }
  if (!open) return null
  const inp = 'w-full bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#5559df]/40'
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(26,32,53,0.5)' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 text-white rounded-t-2xl" style={{ background: '#5559df' }}>
          <h2 className="font-bold text-lg">Request time off</h2>
          <button onClick={onClose} className="text-white/80 hover:text-white text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded text-sm">{error}</div>}
          <label className="block"><span className="text-xs font-medium text-gray-600">Employee</span><input className={inp} value={form.employee_name} onChange={e => setForm((f: any) => ({ ...f, employee_name: e.target.value }))} placeholder="Your name" /></label>
          <label className="block"><span className="text-xs font-medium text-gray-600">Type</span>
            <select className={inp} value={form.type} onChange={e => setForm((f: any) => ({ ...f, type: e.target.value }))}>{TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-xs font-medium text-gray-600">Start date</span><input type="date" className={inp} value={form.start_date} onChange={e => setForm((f: any) => ({ ...f, start_date: e.target.value }))} required /></label>
            <label className="block"><span className="text-xs font-medium text-gray-600">End date</span><input type="date" className={inp} value={form.end_date} onChange={e => setForm((f: any) => ({ ...f, end_date: e.target.value }))} /></label>
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={form.half_day} onChange={e => setForm((f: any) => ({ ...f, half_day: e.target.checked }))} className="w-4 h-4" />Half day</label>
            <span className="text-xs text-gray-500">{days != null ? `${days} day${days === 1 ? '' : 's'}` : ''}</span>
          </div>
          <label className="block"><span className="text-xs font-medium text-gray-600">Coverage / backup</span><input className={inp} value={form.coverage} onChange={e => setForm((f: any) => ({ ...f, coverage: e.target.value }))} placeholder="Who will cover, or N/A" /></label>
          <label className="block"><span className="text-xs font-medium text-gray-600">Reason / notes</span><textarea rows={2} className={inp} value={form.reason} onChange={e => setForm((f: any) => ({ ...f, reason: e.target.value }))} placeholder="Optional details" /></label>
          <div className="flex gap-2 pt-2 border-t border-gray-100">
            <button type="submit" disabled={saving} className="flex-1 text-white font-semibold py-2 rounded-lg disabled:opacity-50" style={{ background: '#5559df' }}>{saving ? 'Submitting…' : 'Submit request'}</button>
            <button type="button" onClick={onClose} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-800 font-medium py-2 rounded-lg">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

const FIELDS: { key: keyof Req; label: string; kind: 'text' | 'date' | 'num' | 'type' | 'status' | 'bool' }[] = [
  { key: 'type', label: 'Type', kind: 'type' },
  { key: 'status', label: 'Status', kind: 'status' },
  { key: 'start_date', label: 'Start Date', kind: 'date' },
  { key: 'end_date', label: 'End Date', kind: 'date' },
  { key: 'days', label: 'Days', kind: 'num' },
  { key: 'half_day', label: 'Half Day', kind: 'bool' },
  { key: 'employee_email', label: 'Employee Email', kind: 'text' },
  { key: 'coverage', label: 'Coverage / Backup', kind: 'text' },
  { key: 'approver', label: 'Approver', kind: 'text' },
]

export default function TimeOffPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<Req[]>([])
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [detail, setDetail] = useState<Req | null>(null)
  const [me, setMe] = useState<{ name: string; email: string }>({ name: '', email: '' })
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<any>({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await sb.from('time_off_requests').select('*').order('start_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
    const list = (data as Req[]) || []
    setRows(list)
    const ids = list.map(r => r.id)
    if (ids.length) {
      const { data: cm } = await sb.from('comments').select('record_id').eq('record_type', 'time_off_request').in('record_id', ids)
      const counts: Record<string, number> = {}
      ;(cm || []).forEach((c: any) => { counts[c.record_id] = (counts[c.record_id] || 0) + 1 })
      setCommentCounts(counts)
    }
    setLoading(false)
  }, [sb])

  useEffect(() => {
    load()
    sb.auth.getUser().then(async ({ data }) => {
      const email = data.user?.email || ''
      let name = ''
      if (email) { const { data: p } = await sb.from('user_profiles').select('full_name, display_name').eq('email', email).maybeSingle(); name = (p as any)?.full_name || (p as any)?.display_name || email.split('@')[0] }
      setMe({ name, email })
    })
  }, [load, sb])

  const match = (r: Req) => {
    if (!q) return true
    const s = q.toLowerCase()
    return [r.employee_name, r.type, r.reason, r.coverage, r.approver, r.status].some(v => String(v ?? '').toLowerCase().includes(s))
  }
  const groups = useMemo(() => {
    const present = new Set(rows.map(r => r.status || 'Pending'))
    const ordered = GROUPS.filter(g => present.has(g.key))
    for (const s of present) if (!GROUPS.some(g => g.key === s)) ordered.push({ key: s, title: s, color: '#9699a6' })
    return ordered
  }, [rows])
  const groupRows = (key: string) => rows.filter(r => (r.status || 'Pending') === key && match(r))
  const total = rows.length
  const pendingN = rows.filter(r => (r.status || 'Pending') === 'Pending').length

  function openDetail(r: Req) { setEditing(false); setDetail(r) }
  function closeDetail() { setDetail(null); setEditing(false) }

  function startEdit() {
    if (!detail) return
    const f: any = { employee_name: detail.employee_name ?? '', reason: detail.reason ?? '' }
    for (const fld of FIELDS) f[fld.key] = (detail as any)[fld.key] ?? (fld.kind === 'bool' ? false : '')
    setForm(f); setEditing(true)
  }

  async function saveRecord() {
    if (!detail) return
    setSaving(true)
    try {
      const clean = (v: any) => { const s = String(v ?? '').trim(); return s === '' ? null : s }
      const patch: any = { employee_name: clean(form.employee_name) ?? detail.employee_name, reason: clean(form.reason), updated_at: new Date().toISOString() }
      for (const fld of FIELDS) {
        if (fld.kind === 'date') patch[fld.key] = form[fld.key] || null
        else if (fld.kind === 'num') { const n = Number(form[fld.key]); patch[fld.key] = form[fld.key] === '' || isNaN(n) ? null : n }
        else if (fld.kind === 'bool') patch[fld.key] = !!form[fld.key]
        else patch[fld.key] = clean(form[fld.key])
      }
      const { error } = await sb.from('time_off_requests').update(patch).eq('id', detail.id)
      if (error) { alert('Save failed: ' + error.message); return }
      const updated = { ...detail, ...patch }
      setRows(rs => rs.map(r => r.id === detail.id ? updated : r)); setDetail(updated); setEditing(false)
    } finally { setSaving(false) }
  }

  async function decide(status: 'Approved' | 'Denied') {
    if (!detail) return
    const patch: any = { status, approver: me.name || me.email || null, decided_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    const { error } = await sb.from('time_off_requests').update(patch).eq('id', detail.id)
    if (error) { alert('Failed: ' + error.message); return }
    const updated = { ...detail, ...patch }
    setRows(rs => rs.map(r => r.id === detail.id ? updated : r)); setDetail(updated)
  }

  async function deleteRecord() {
    if (!detail) return
    if (!confirm(`Delete this time-off request for "${detail.employee_name || 'employee'}"? This also removes its comments and cannot be undone.`)) return
    setDeleting(true)
    try {
      await sb.rpc('delete_record_comments', { p_record_type: 'time_off_request', p_record_id: detail.id })
      const { error } = await sb.from('time_off_requests').delete().eq('id', detail.id)
      if (error) { alert('Delete failed: ' + error.message); return }
      setRows(rs => rs.filter(r => r.id !== detail.id)); closeDetail()
    } finally { setDeleting(false) }
  }

  async function uploadFile(rec: Req, file: File) {
    setUploading(true)
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `time-off/${rec.id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safe}`
      const { error } = await sb.storage.from('record-board').upload(path, file)
      if (error) { alert('Upload failed: ' + error.message); return }
      const { data } = sb.storage.from('record-board').getPublicUrl(path)
      const next = [...(rec.attachments || []), { name: file.name, url: data.publicUrl }]
      await sb.from('time_off_requests').update({ attachments: next }).eq('id', rec.id)
      setRows(rs => rs.map(o => o.id === rec.id ? { ...o, attachments: next } : o))
      setDetail((d: any) => (d && d.id === rec.id ? { ...d, attachments: next } : d))
    } finally { setUploading(false) }
  }
  async function removeFile(rec: Req, idx: number) {
    const next = (rec.attachments || []).filter((_: any, i: number) => i !== idx)
    await sb.from('time_off_requests').update({ attachments: next }).eq('id', rec.id)
    setRows(rs => rs.map(o => o.id === rec.id ? { ...o, attachments: next } : o))
    setDetail((d: any) => (d && d.id === rec.id ? { ...d, attachments: next } : d))
  }

  const inputCls = 'w-full bg-white border border-[#E4E6EE] rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#5559df]/40'
  const detailDays = detail ? (detail.half_day ? '0.5' : (detail.days ?? dayCount(detail.start_date, detail.end_date) ?? '')) : ''

  function editControl(fld: typeof FIELDS[number]) {
    if (fld.kind === 'type') return <select className={inputCls} value={form.type || ''} onChange={e => setForm((f: any) => ({ ...f, type: e.target.value }))}><option value="">—</option>{TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
    if (fld.kind === 'status') return <select className={inputCls} value={form.status || ''} onChange={e => setForm((f: any) => ({ ...f, status: e.target.value }))}>{STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select>
    if (fld.kind === 'date') return <input type="date" className={inputCls} value={form[fld.key] || ''} onChange={e => setForm((f: any) => ({ ...f, [fld.key]: e.target.value }))} />
    if (fld.kind === 'num') return <input type="number" step="0.5" className={inputCls} value={form[fld.key] ?? ''} onChange={e => setForm((f: any) => ({ ...f, [fld.key]: e.target.value }))} />
    if (fld.kind === 'bool') return <select className={inputCls} value={form[fld.key] ? 'yes' : 'no'} onChange={e => setForm((f: any) => ({ ...f, [fld.key]: e.target.value === 'yes' }))}><option value="no">No</option><option value="yes">Yes</option></select>
    return <input className={inputCls} value={form[fld.key] ?? ''} onChange={e => setForm((f: any) => ({ ...f, [fld.key]: e.target.value }))} />
  }

  return (
    <div className="min-h-screen mon-page p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <span className="mon-tag" style={{ background: '#5559df22', color: '#5559df' }}>🌴 Time Off</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">Time Off</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${total} request${total === 1 ? '' : 's'} · ${pendingN} pending`}</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="text-white font-semibold rounded-lg px-4 py-2 text-sm shadow-sm hover:opacity-90" style={{ background: '#5559df' }}>+ Request time off</button>
      </div>

      <div className="mb-4">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, type, reason…" className="bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm w-full sm:w-80 focus:outline-none focus:ring-2 focus:ring-[#5559df]/40" />
      </div>

      <div className="space-y-4">
        <div className="mb-3 rounded-lg bg-[#10B981]/10 border border-[#10B981]/25 text-[12px] text-[#0f7a5a] px-3 py-2">🔗 Ultron — notes &amp; comments sync two-way across the record boards.</div>{groups.map(group => {
          const gr = groupRows(group.key)
          const isCol = collapsed[group.key]
          return (
            <div key={group.key} className="bg-white rounded-xl shadow-sm border border-[#ECEEF3]">
              <div className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none sticky top-0 z-30 rounded-t-xl" style={{ background: '#fff', borderLeft: '5px solid ' + group.color }} onClick={() => setCollapsed(c => ({ ...c, [group.key]: !c[group.key] }))}>
                <span className="text-[10px]" style={{ color: group.color, display: 'inline-block', transform: isCol ? 'none' : 'rotate(90deg)' }}>&#9654;</span>
                <span className="font-bold text-sm" style={{ color: group.color }}>{group.title}</span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: group.color + '26', color: group.color }}>{gr.length}</span>
              </div>
              {!isCol && (
                <div>
                  <table className="w-full text-sm min-w-[860px]">
                    <thead className="sticky top-[47px] z-20 [&_th]:bg-[#FBFCFE]">
                      <tr className="text-[11px] uppercase text-gray-400 border-b border-[#EEF0F4]">
                        <th className="text-left px-4 py-2 font-semibold">Employee</th>
                        <th className="text-left px-3 py-2 font-semibold w-[150px]">Type</th>
                        <th className="text-left px-3 py-2 font-semibold w-[200px]">Dates</th>
                        <th className="text-left px-3 py-2 font-semibold w-[70px]">Days</th>
                        <th className="text-left px-3 py-2 font-semibold w-[110px]">Status</th>
                        <th className="text-left px-3 py-2 font-semibold w-[80px]">Files</th>
                        <th className="text-left px-3 py-2 font-semibold w-[90px]">Comments</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gr.map((r, i) => {
                        const nm = r.employee_name || '—'
                        const nFiles = r.attachments?.length || 0
                        const nc = commentCounts[r.id] || 0
                        const d = r.half_day ? '½' : (r.days ?? dayCount(r.start_date, r.end_date) ?? '—')
                        return (
                          <tr key={r.id} className={`cursor-pointer hover:bg-[#F2F6FF] ${i % 2 ? 'bg-[#F8FAFC]' : 'bg-white'}`} onClick={() => openDetail(r)}>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2.5">
                                <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0" style={{ background: avatarColor(nm) }}>{initials(nm)}</div>
                                <span className="font-semibold text-[#1A1D2E]">{nm}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2.5">{r.type ? <span className="text-white text-[11px] font-semibold rounded-full px-2.5 py-1 inline-block" style={{ background: typeColor(r.type) }}>{r.type}</span> : <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-2.5 text-gray-600">{r.start_date ? `${fmtDate(r.start_date)}${r.end_date && r.end_date !== r.start_date ? ' – ' + fmtDate(r.end_date) : ''}` : '—'}</td>
                            <td className="px-3 py-2.5 text-gray-600">{d}</td>
                            <td className="px-3 py-2.5"><span className="text-white text-[11px] font-semibold rounded-full px-2.5 py-1 inline-block" style={{ background: statusColor(r.status) }}>{r.status || 'Pending'}</span></td>
                            <td className="px-3 py-2.5">{nFiles ? <span className="text-[#5559df] text-xs font-semibold">📎 {nFiles}</span> : <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-2.5">{nc ? <span className="text-emerald-600 text-xs font-semibold">💬 {nc}</span> : <span className="text-gray-300">—</span>}</td>
                          </tr>
                        )
                      })}
                      {gr.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400 text-sm">No requests</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
        {!loading && groups.length === 0 && (
          <div className="bg-white rounded-xl border border-[#ECEEF3] p-10 text-center">
            <p className="text-gray-500 text-sm">No time-off requests yet.</p>
            <button onClick={() => setShowAdd(true)} className="mt-3 text-white font-semibold rounded-lg px-4 py-2 text-sm" style={{ background: '#5559df' }}>+ Request time off</button>
          </div>
        )}
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: 'rgba(26,32,53,0.5)' }} onClick={closeDetail}>
          <div className="relative w-full max-w-[820px] my-6 bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between px-6 py-4 text-white" style={{ background: '#5559df' }}>
              <div className="min-w-0">
                <p className="text-white/70 text-xs uppercase tracking-wide">Time Off Request</p>
                <h2 className="text-xl font-bold leading-tight">{detail.employee_name || '—'}</h2>
                <div className="flex items-center gap-2 mt-1.5">
                  {detail.type && <span className="text-[11px] font-semibold rounded-full px-2.5 py-0.5" style={{ background: 'rgba(255,255,255,0.22)' }}>{detail.type}</span>}
                  <span className="text-[11px] font-semibold rounded-full px-2.5 py-0.5" style={{ background: statusColor(detail.status), color: '#fff' }}>{detail.status || 'Pending'}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!editing && detail.status !== 'Approved' && <button onClick={() => decide('Approved')} className="text-xs font-semibold rounded-lg px-3 py-1.5 bg-white/15 hover:bg-emerald-500 transition-colors">✓ Approve</button>}
                {!editing && detail.status !== 'Denied' && <button onClick={() => decide('Denied')} className="text-xs font-semibold rounded-lg px-3 py-1.5 bg-white/15 hover:bg-red-500 transition-colors">✕ Deny</button>}
                {!editing && <button onClick={startEdit} className="text-xs font-semibold rounded-lg px-3 py-1.5 bg-white/15 hover:bg-white/25 transition-colors">✎ Edit</button>}
                {!editing && <button onClick={deleteRecord} disabled={deleting} className="text-xs font-semibold rounded-lg px-3 py-1.5 bg-white/15 hover:bg-red-500 disabled:opacity-50 transition-colors">{deleting ? 'Deleting…' : '🗑'}</button>}
                <button onClick={closeDetail} className="text-white/80 hover:text-white text-2xl leading-none pl-1">&times;</button>
              </div>
            </div>

            <div className="px-6 py-4 max-h-[75vh] overflow-y-auto space-y-5">
              {editing ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  <label className="col-span-2 sm:col-span-3"><span className="text-[11px] uppercase tracking-wide text-gray-400">Employee</span><input className={inputCls} value={form.employee_name} onChange={e => setForm((f: any) => ({ ...f, employee_name: e.target.value }))} /></label>
                  {FIELDS.map(fld => (<label key={String(fld.key)}><span className="text-[11px] uppercase tracking-wide text-gray-400">{fld.label}</span>{editControl(fld)}</label>))}
                  <label className="col-span-2 sm:col-span-3"><span className="text-[11px] uppercase tracking-wide text-gray-400">Reason / Notes</span><textarea rows={2} className={inputCls} value={form.reason} onChange={e => setForm((f: any) => ({ ...f, reason: e.target.value }))} /></label>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                    <Field label="Type" value={detail.type} />
                    <Field label="Status" value={detail.status} />
                    <Field label="Days" value={String(detailDays || '—')} />
                    <Field label="Start Date" value={fmtDate(detail.start_date)} />
                    <Field label="End Date" value={fmtDate(detail.end_date)} />
                    <Field label="Half Day" value={detail.half_day ? 'Yes' : 'No'} />
                    <Field label="Employee Email" value={detail.employee_email} />
                    <Field label="Coverage / Backup" value={detail.coverage} />
                    <Field label="Approver" value={detail.approver} />
                    <Field label="Decided" value={detail.decided_at ? new Date(detail.decided_at).toLocaleString() : ''} wide />
                    <Field label="Reason / Notes" value={detail.reason} wide />
                  </div>
                </>
              )}

              {editing && (
                <div className="flex items-center justify-between gap-3 border-t border-[#EEF0F4] pt-4">
                  <button onClick={deleteRecord} disabled={deleting || saving} className="text-xs font-semibold rounded-lg px-3 py-2 text-red-600 hover:bg-red-50 disabled:opacity-50">{deleting ? 'Deleting…' : '🗑 Delete request'}</button>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setEditing(false)} disabled={saving} className="text-sm px-4 py-2 rounded-lg border border-[#E4E6EE] text-gray-600 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
                    <button onClick={saveRecord} disabled={saving} className="text-sm px-4 py-2 rounded-lg text-white font-semibold disabled:opacity-50" style={{ background: '#5559df' }}>{saving ? 'Saving…' : 'Save changes'}</button>
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Files</p>
                  <div>
                    <input ref={fileRef} type="file" multiple className="hidden" onChange={async e => { const fs = Array.from(e.target.files || []); for (const f of fs) { await uploadFile(detail, f) } if (e.target) e.target.value = '' }} />
                    <button onClick={() => fileRef.current?.click()} disabled={uploading} className="text-xs px-2.5 py-1.5 rounded-lg text-white font-semibold hover:opacity-90 disabled:opacity-50" style={{ background: '#5559df' }}>{uploading ? 'Uploading…' : '＋ Upload file'}</button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(detail.attachments || []).map((f: any, idx: number) => (
                    <div key={'a' + idx} className="flex items-center gap-2 text-xs bg-[#F5F6FE] border border-[#D8DAF5] rounded-lg px-3 py-2">
                      <a href={f.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 min-w-0 hover:underline"><span style={{ color: '#5559df' }}>📎</span><span className="min-w-0"><span className="block font-semibold text-gray-700 truncate max-w-[220px]">{f.name}</span><span className="text-[10px] text-gray-400">Uploaded</span></span></a>
                      <button onClick={() => removeFile(detail, idx)} className="text-gray-300 hover:text-red-500 leading-none text-base">×</button>
                    </div>
                  ))}
                  {(detail.attachments?.length || 0) === 0 && <p className="text-sm text-gray-400">No files yet — upload one above.</p>}
                </div>
              </div>

              <div className="border-t border-[#EEF0F4] pt-4">
                <Comments recordId={detail.id} recordType="time_off_request" currentUserEmail={me.email} title="Notes & Comments" />
              </div>
            </div>
          </div>
        </div>
      )}

      <RequestModal open={showAdd} onClose={() => setShowAdd(false)} onCreated={load} sb={sb} me={me} />
    </div>
  )
}

function Field({ label, value, wide }: { label: string; value: any; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2 sm:col-span-3' : ''}>
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-gray-800 mt-0.5 break-words">{value || <span className="text-gray-300">—</span>}</p>
    </div>
  )
}
