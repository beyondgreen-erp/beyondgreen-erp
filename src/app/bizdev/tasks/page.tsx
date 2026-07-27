'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import Comments from '@/components/Comments'
import FileUpload from '@/components/FileUpload'
import ImportExportBar from '@/components/ImportExportBar'
import ShareLink from '@/components/ShareLink'
import { useItemDeepLink } from '@/components/useItemDeepLink'

const PRIORITIES = ['Low', 'Medium', 'High', 'Critical', 'Urgent']
const STATUSES = ['Backlog', 'In Progress', 'Review', 'Blocked', 'On Hold', 'Done']
const GROUP_SECTIONS = ['Current', 'Waiting Final Approval', 'On-Going', 'Completed']
const DONE = new Set(['Done', 'Completed'])

// Status → group card (Record Board sections), in display order
const STATUS_GROUPS: { key: string; title: string; color: string }[] = [
  { key: 'Backlog', title: 'Backlog', color: '#9699a6' },
  { key: 'In Progress', title: 'In Progress', color: '#579bfc' },
  { key: 'Review', title: 'Review', color: '#a25ddc' },
  { key: 'Blocked', title: 'Blocked', color: '#e2445c' },
  { key: 'On Hold', title: 'On Hold', color: '#fdab3d' },
  { key: 'Done', title: 'Done', color: '#00c875' },
]
const STATUS_COLORS: Record<string, string> = {
  'Backlog': '#9699a6', 'In Progress': '#579bfc', 'Review': '#a25ddc', 'Blocked': '#e2445c',
  'On Hold': '#fdab3d', 'Done': '#00c875', 'Completed': '#00c875', 'Archived': '#c4c4c4',
}
const PRIORITY_COLORS: Record<string, string> = {
  'Low': '#00c875', 'Medium': '#579bfc', 'High': '#fdab3d', 'Critical': '#e2445c', 'Urgent': '#bb3354',
}
const statusColor = (s: string | null) => (s && STATUS_COLORS[s]) || '#c4c4c4'
const priorityColor = (p: string | null) => (p && PRIORITY_COLORS[p]) || '#c4c4c4'

const initials = (name: string) => (name || '').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase()
const avatarColor = (name: string) => {
  const palette = ['#5559df', '#00c875', '#579bfc', '#a25ddc', '#fdab3d', '#037f4c', '#ff6d3b', '#bb3354', '#00a89b', '#7e3b8a']
  let h = 0; for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}
const fmtDate = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
function dueMeta(d: string | null, status: string | null) {
  if (!d) return null
  const date = new Date(d + 'T00:00:00'); const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.ceil((date.getTime() - today.getTime()) / 86400000)
  const done = DONE.has(status || '')
  return { str: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), overdue: !done && diff < 0, today: !done && diff === 0, soon: !done && diff > 0 && diff <= 3 }
}

interface Customer { id: string; company_name: string }
interface TeamMember { id: string; email: string; full_name: string; avatar_color: string; avatar_initials: string | null }
interface Task {
  id: string; task_name: string; assigned_to: string | null; due_date: string | null
  priority: string; status: string; customer_id: string | null; notes: string | null
  is_active: boolean; group_name: string | null; description: string | null
  reviewed_at: string | null; reviewed_by: string | null; created_at?: string | null
}

const emptyAdd = { task_name: '', assigned_to: '', due_date: '', priority: 'Medium', status: 'Backlog', customer_id: '', notes: '', group_name: 'Current' }

// ─────────────────────────────────────────── Add modal
function AddModal({ open, onClose, onCreated, sb, teamMembers, customers }: {
  open: boolean; onClose: () => void; onCreated: () => void
  sb: ReturnType<typeof createSupabaseBrowserClient>; teamMembers: TeamMember[]; customers: Customer[]
}) {
  const [form, setForm] = useState<any>(emptyAdd)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [aiText, setAiText] = useState('')
  const [aiBusy, setAiBusy] = useState(false)

  useEffect(() => { if (open) { setForm(emptyAdd); setAiText(''); setError('') } }, [open])

  async function aiFill() {
    if (!aiText.trim()) return
    setAiBusy(true); setError('')
    try {
      const res = await fetch('/api/tasks/parse', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: aiText, members: teamMembers.map(m => ({ full_name: m.full_name, email: m.email })) }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'AI could not parse that.')
      setForm((p: any) => ({
        ...p, task_name: j.task_name || p.task_name, assigned_to: j.assignee || p.assigned_to,
        priority: j.priority || p.priority, due_date: j.due_date || p.due_date,
        notes: j.notes ? (p.notes ? p.notes + '\n' + j.notes : j.notes) : p.notes,
      }))
    } catch (e) { setError((e as Error).message) }
    setAiBusy(false)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError('')
    if (!form.task_name.trim()) { setError('Task name is required.'); return }
    setSaving(true)
    try {
      const row = {
        task_name: form.task_name.trim(), assigned_to: form.assigned_to || null, due_date: form.due_date || null,
        priority: form.priority, status: form.status, customer_id: form.customer_id || null,
        notes: form.notes?.trim() || null, group_name: form.group_name || null, is_active: true,
      }
      const { error } = await sb.from('tasks').insert(row)
      if (error) { setError(error.message); return }
      onClose(); onCreated()
    } finally { setSaving(false) }
  }
  if (!open) return null
  const inp = 'w-full bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#5559df]/40'
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(26,32,53,0.5)' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 text-white rounded-t-2xl" style={{ background: '#5559df' }}>
          <h2 className="font-bold text-lg">New Task</h2>
          <button onClick={onClose} className="text-white/80 hover:text-white text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded text-sm">{error}</div>}

          <div className="rounded-xl border border-[#D9E2FB] bg-[#F4F7FF] p-3.5">
            <div className="flex items-center gap-2 mb-2">
              <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-[#5559df] text-white text-sm">✨</span>
              <span className="text-sm font-semibold text-[#1A1D2E]">Quick add with AI</span>
            </div>
            <p className="text-xs text-gray-500 mb-2">Paste an email or note — AI drafts the task and picks who it should go to.</p>
            <textarea value={aiText} onChange={e => setAiText(e.target.value)} placeholder="Paste text here…" rows={3} className={inp + ' resize-none'} />
            <button type="button" onClick={aiFill} disabled={aiBusy || !aiText.trim()} className="mt-2 w-full text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50" style={{ background: '#5559df' }}>{aiBusy ? 'Reading…' : 'Fill task with AI'}</button>
          </div>

          <label className="block"><span className="text-xs font-medium text-gray-600">Task name *</span><input className={inp} value={form.task_name} onChange={e => setForm((f: any) => ({ ...f, task_name: e.target.value }))} placeholder="What needs to be done?" autoFocus /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-xs font-medium text-gray-600">Status</span><select className={inp} value={form.status} onChange={e => setForm((f: any) => ({ ...f, status: e.target.value }))}>{STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
            <label className="block"><span className="text-xs font-medium text-gray-600">Priority</span><select className={inp} value={form.priority} onChange={e => setForm((f: any) => ({ ...f, priority: e.target.value }))}>{PRIORITIES.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
          </div>
          <label className="block"><span className="text-xs font-medium text-gray-600">Assigned to</span>
            <input className={inp} list="team-list" value={form.assigned_to} onChange={e => setForm((f: any) => ({ ...f, assigned_to: e.target.value }))} placeholder="Unassigned" />
            <datalist id="team-list">{teamMembers.map(m => <option key={m.id} value={m.full_name} />)}</datalist>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-xs font-medium text-gray-600">Due date</span><input type="date" className={inp} value={form.due_date} onChange={e => setForm((f: any) => ({ ...f, due_date: e.target.value }))} /></label>
            <label className="block"><span className="text-xs font-medium text-gray-600">Section</span><select className={inp} value={form.group_name} onChange={e => setForm((f: any) => ({ ...f, group_name: e.target.value }))}>{GROUP_SECTIONS.map(g => <option key={g} value={g}>{g}</option>)}</select></label>
          </div>
          <label className="block"><span className="text-xs font-medium text-gray-600">Linked customer</span><select className={inp} value={form.customer_id} onChange={e => setForm((f: any) => ({ ...f, customer_id: e.target.value }))}><option value="">— None —</option>{customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select></label>
          <label className="block"><span className="text-xs font-medium text-gray-600">Notes</span><textarea rows={2} className={inp} value={form.notes} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} placeholder="Optional details" /></label>
          <div className="flex gap-2 pt-2 border-t border-gray-100">
            <button type="submit" disabled={saving} className="flex-1 text-white font-semibold py-2 rounded-lg disabled:opacity-50" style={{ background: '#5559df' }}>{saving ? 'Creating…' : 'Create task'}</button>
            <button type="button" onClick={onClose} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-800 font-medium py-2 rounded-lg">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────── Page
export default function TasksPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<Task[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({})
  const [fileCounts, setFileCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [filterAssignee, setFilterAssignee] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [detail, setDetail] = useState<Task | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<any>({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const [showAdd, setShowAdd] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: t }, { data: c }, { data: tm }] = await Promise.all([
      sb.from('tasks').select('*').eq('is_active', true).order('due_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }),
      sb.from('customers').select('id,company_name').eq('is_active', true).order('company_name'),
      sb.from('user_profiles').select('id,email,full_name,avatar_color,avatar_initials').eq('is_active', true).order('full_name'),
    ])
    const list = (t as Task[]) || []
    setRows(list)
    if (c) setCustomers(c as Customer[])
    if (tm) setTeamMembers(tm as TeamMember[])
    const ids = list.map(r => r.id)
    if (ids.length) {
      const [{ data: cm }, { data: fa }] = await Promise.all([
        sb.from('comments').select('record_id').eq('record_type', 'task').in('record_id', ids),
        sb.from('file_attachments').select('record_id').eq('record_type', 'tasks').in('record_id', ids),
      ])
      const cc: Record<string, number> = {}; (cm || []).forEach((x: any) => { cc[x.record_id] = (cc[x.record_id] || 0) + 1 })
      const fc: Record<string, number> = {}; (fa || []).forEach((x: any) => { fc[x.record_id] = (fc[x.record_id] || 0) + 1 })
      setCommentCounts(cc); setFileCounts(fc)
    } else { setCommentCounts({}); setFileCounts({}) }
    setLoading(false)
  }, [sb])

  useEffect(() => {
    load()
    sb.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email) })
  }, [load, sb])

  useItemDeepLink(rows, (r: Task) => openDetail(r))

  const customerName = (id: string | null) => id ? (customers.find(c => c.id === id)?.company_name || '') : ''
  const resolveMember = (val: string | null) => {
    if (!val) return null
    const v = val.trim().toLowerCase()
    return teamMembers.find(m => m.full_name.toLowerCase() === v || m.email.toLowerCase() === v)
      || teamMembers.find(m => m.full_name.split(' ')[0].toLowerCase() === v) || null
  }
  const assigneeTokens = (val: string | null) => (val || '').split(',').map(s => s.trim()).filter(Boolean)

  const match = (r: Task) => {
    if (filterAssignee) {
      const m = teamMembers.find(x => x.email === filterAssignee)
      const toks = assigneeTokens(r.assigned_to).map(s => s.toLowerCase())
      const ok = m ? toks.some(t => t === m.email.toLowerCase() || t === m.full_name.toLowerCase() || t === m.full_name.split(' ')[0].toLowerCase()) : toks.includes(filterAssignee.toLowerCase())
      if (!ok) return false
    }
    if (!q) return true
    const s = q.toLowerCase()
    return [r.task_name, r.assigned_to, r.description, r.notes, customerName(r.customer_id)].some(v => String(v ?? '').toLowerCase().includes(s))
  }

  const groups = useMemo(() => {
    const present = new Set(rows.map(r => r.status || 'Backlog'))
    const ordered = STATUS_GROUPS.filter(g => present.has(g.key))
    for (const s of present) if (!STATUS_GROUPS.some(g => g.key === s)) ordered.push({ key: s, title: s, color: statusColor(s) })
    return ordered
  }, [rows])
  const groupRows = (key: string) => rows.filter(r => (r.status || 'Backlog') === key && match(r))

  const totalActive = rows.filter(r => !DONE.has(r.status)).length
  const totalDone = rows.filter(r => DONE.has(r.status)).length
  const totalBlocked = rows.filter(r => r.status === 'Blocked').length
  const totalOverdue = rows.filter(r => { const d = dueMeta(r.due_date, r.status); return d?.overdue }).length
  const newCount = rows.filter(r => !r.reviewed_at).length

  function openDetail(r: Task) { setEditing(false); setDetail(r) }
  function closeDetail() { setDetail(null); setEditing(false) }

  function startEdit() {
    if (!detail) return
    setForm({
      task_name: detail.task_name ?? '', assigned_to: detail.assigned_to ?? '', status: detail.status ?? 'Backlog',
      priority: detail.priority ?? 'Medium', due_date: detail.due_date ?? '', group_name: detail.group_name ?? 'Current',
      customer_id: detail.customer_id ?? '', notes: detail.notes ?? '',
    })
    setEditing(true)
  }

  async function saveRecord() {
    if (!detail) return
    if (!form.task_name.trim()) { alert('Task name is required.'); return }
    setSaving(true)
    try {
      const patch: any = {
        task_name: form.task_name.trim(), assigned_to: form.assigned_to?.trim() || null, status: form.status,
        priority: form.priority, due_date: form.due_date || null, group_name: form.group_name || null,
        customer_id: form.customer_id || null, notes: form.notes?.trim() || null, updated_at: new Date().toISOString(),
      }
      const { error } = await sb.from('tasks').update(patch).eq('id', detail.id)
      if (error) { alert('Save failed: ' + error.message); return }
      const updated = { ...detail, ...patch }
      setRows(rs => rs.map(r => r.id === detail.id ? updated : r)); setDetail(updated); setEditing(false)
    } finally { setSaving(false) }
  }

  async function setStatus(status: string) {
    if (!detail) return
    setBusy(true)
    try {
      const patch: any = { status, updated_at: new Date().toISOString() }
      if (DONE.has(status) && !detail.reviewed_at) { patch.reviewed_at = new Date().toISOString(); patch.reviewed_by = userEmail || 'unknown' }
      const { error } = await sb.from('tasks').update(patch).eq('id', detail.id)
      if (error) { alert('Update failed: ' + error.message); return }
      const updated = { ...detail, ...patch }
      setRows(rs => rs.map(r => r.id === detail.id ? updated : r)); setDetail(updated)
    } finally { setBusy(false) }
  }

  async function markReviewed() {
    if (!detail) return
    const patch: any = { reviewed_at: new Date().toISOString(), reviewed_by: userEmail || 'unknown', updated_at: new Date().toISOString() }
    const { error } = await sb.from('tasks').update(patch).eq('id', detail.id)
    if (error) { alert('Failed: ' + error.message); return }
    const updated = { ...detail, ...patch }
    setRows(rs => rs.map(r => r.id === detail.id ? updated : r)); setDetail(updated)
  }

  async function archive() {
    if (!detail) return
    if (!confirm('Archive this task? It will be hidden from the board but not deleted.')) return
    setBusy(true)
    try {
      const { error } = await sb.from('tasks').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', detail.id)
      if (error) { alert('Archive failed: ' + error.message); return }
      setRows(rs => rs.filter(r => r.id !== detail.id)); closeDetail()
    } finally { setBusy(false) }
  }

  async function deleteRecord() {
    if (!detail) return
    if (!confirm(`Delete "${detail.task_name || 'this task'}"? This also removes its comments and files, and cannot be undone.`)) return
    setDeleting(true)
    try {
      await sb.rpc('delete_record_comments', { p_record_type: 'task', p_record_id: detail.id })
      await sb.from('file_attachments').delete().eq('record_type', 'tasks').eq('record_id', detail.id)
      const { error } = await sb.from('tasks').delete().eq('id', detail.id)
      if (error) { alert('Delete failed: ' + error.message); return }
      setRows(rs => rs.filter(r => r.id !== detail.id)); closeDetail()
    } finally { setDeleting(false) }
  }

  const inputCls = 'w-full bg-white border border-[#E4E6EE] rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#5559df]/40'
  const isDone = detail ? DONE.has(detail.status) : false

  return (
    <div className="min-h-screen mon-page p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <span className="mon-tag" style={{ background: '#5559df22', color: '#5559df' }}>✅ Tasks</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">Task Board</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${totalActive} active · ${totalDone} done · ${rows.length} total`}</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportExportBar table="tasks" filename="tasks" columns={[
            { header: 'Task Name', dbKey: 'task_name', example: 'Follow up on proposal', required: true },
            { header: 'Assigned To', dbKey: 'assigned_to', example: 'john@beyondgreen.com' },
            { header: 'Due Date', dbKey: 'due_date', example: '2024-02-15' },
            { header: 'Priority', dbKey: 'priority', example: 'Medium' },
            { header: 'Status', dbKey: 'status', example: 'Backlog' },
            { header: 'Group', dbKey: 'group_name', example: 'Current' },
            { header: 'Notes', dbKey: 'notes', example: '' },
          ]} onImportDone={load} />
          <button onClick={() => setShowAdd(true)} className="text-white font-semibold rounded-lg px-4 py-2 text-sm shadow-sm hover:opacity-90" style={{ background: '#5559df' }}>+ Add Task</button>
        </div>
      </div>

      {/* Summary cards */}
      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            { label: 'Active', value: totalActive, color: '#5559df' },
            { label: 'Done', value: totalDone, color: '#00c875' },
            { label: 'Blocked', value: totalBlocked, color: '#e2445c' },
            { label: 'Overdue', value: totalOverdue, color: '#fdab3d' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-[#ECEEF3] px-5 py-3.5">
              <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
              <p className="text-sm text-gray-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Team filter chips */}
      {!loading && teamMembers.length > 0 && (
        <div className="flex gap-2 items-center mb-4 overflow-x-auto pb-1">
          <span className="text-sm text-gray-400 shrink-0 mr-1">Assignee:</span>
          <button onClick={() => setFilterAssignee('')} className={`px-3 py-1.5 rounded-lg border text-sm font-medium shrink-0 transition-colors ${!filterAssignee ? 'bg-[#1A1D2E] text-white border-[#1A1D2E]' : 'bg-white text-gray-500 border-[#E4E6EE] hover:border-[#D0D3E0]'}`}>All</button>
          {teamMembers.map(m => {
            const active = filterAssignee === m.email
            return (
              <button key={m.email} onClick={() => setFilterAssignee(p => p === m.email ? '' : m.email)} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium shrink-0 transition-colors ${active ? 'bg-[#1A1D2E] text-white border-[#1A1D2E]' : 'bg-white text-gray-500 border-[#E4E6EE] hover:border-[#D0D3E0]'}`}>
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0" style={{ backgroundColor: m.avatar_color || avatarColor(m.full_name) }}>{m.avatar_initials || initials(m.full_name)}</span>
                {m.full_name.split(' ')[0]}
              </button>
            )
          })}
        </div>
      )}

      {/* Search */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search tasks…" className="bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm w-full sm:w-80 focus:outline-none focus:ring-2 focus:ring-[#5559df]/40" />
        {newCount > 0 && <span className="text-xs font-semibold px-3 py-1.5 rounded-full bg-[#EEF4FF] text-[#5559df]">{newCount} new to review</span>}
      </div>

      {/* Groups */}
      <div className="space-y-4">
        <div className="mb-3 rounded-lg bg-[#10B981]/10 border border-[#10B981]/25 text-[12px] text-[#0f7a5a] px-3 py-2">🔗 Ultron — notes &amp; comments sync two-way across the record boards.</div>{groups.map(group => {
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
                  <table className="w-full text-sm min-w-[880px]">
                    <thead>
                      <tr className="text-[11px] uppercase text-gray-400 border-b border-[#EEF0F4]">
                        <th className="text-left px-4 py-2 font-semibold">Task</th>
                        <th className="text-left px-3 py-2 font-semibold w-[190px]">Assignee</th>
                        <th className="text-left px-3 py-2 font-semibold w-[110px]">Priority</th>
                        <th className="text-left px-3 py-2 font-semibold w-[110px]">Due</th>
                        <th className="text-left px-3 py-2 font-semibold w-[120px]">Status</th>
                        <th className="text-left px-3 py-2 font-semibold w-[70px]">Files</th>
                        <th className="text-left px-3 py-2 font-semibold w-[90px]">Comments</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gr.map((r, i) => {
                        const toks = assigneeTokens(r.assigned_to)
                        const due = dueMeta(r.due_date, r.status)
                        const nc = commentCounts[r.id] || 0
                        const nf = fileCounts[r.id] || 0
                        return (
                          <tr key={r.id} className={`cursor-pointer hover:bg-[#F2F6FF] ${i % 2 ? 'bg-[#F8FAFC]' : 'bg-white'}`} onClick={() => openDetail(r)}>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                {!r.reviewed_at && <span className="text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded bg-[#5559df] text-white shrink-0">NEW</span>}
                                <span className={`font-semibold ${DONE.has(r.status) ? 'line-through text-gray-400' : 'text-[#1A1D2E]'}`}>{r.task_name || '—'}</span>
                              </div>
                              {r.customer_id && <span className="text-[11px] text-gray-400">{customerName(r.customer_id)}</span>}
                            </td>
                            <td className="px-3 py-2.5">
                              {toks.length === 0 ? <span className="text-gray-300">Unassigned</span> : (
                                <div className="flex items-center gap-1.5">
                                  <div className="flex -space-x-1.5">
                                    {toks.slice(0, 3).map((t, k) => { const m = resolveMember(t); const nm = m?.full_name || t; return (
                                      <span key={k} title={nm} className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold ring-2 ring-white" style={{ background: m?.avatar_color || avatarColor(nm) }}>{m?.avatar_initials || initials(nm)}</span>
                                    )})}
                                  </div>
                                  <span className="text-gray-600 text-xs truncate max-w-[100px]">{(resolveMember(toks[0])?.full_name || toks[0]).split(' ')[0]}{toks.length > 1 ? ` +${toks.length - 1}` : ''}</span>
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2.5"><span className="text-white text-[11px] font-semibold rounded-full px-2.5 py-1 inline-block" style={{ background: priorityColor(r.priority) }}>{r.priority || '—'}</span></td>
                            <td className="px-3 py-2.5">{due ? <span className={`text-xs font-semibold ${due.overdue ? 'text-red-600' : due.today ? 'text-amber-600' : 'text-gray-500'}`}>{due.overdue ? '⚠ ' : ''}{due.str}</span> : <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-2.5"><span className="text-white text-[11px] font-semibold rounded-full px-2.5 py-1 inline-block" style={{ background: statusColor(r.status) }}>{r.status || 'Backlog'}</span></td>
                            <td className="px-3 py-2.5">{nf ? <span className="text-[#5559df] text-xs font-semibold">📎 {nf}</span> : <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-2.5">{nc ? <span className="text-emerald-600 text-xs font-semibold">💬 {nc}</span> : <span className="text-gray-300">—</span>}</td>
                          </tr>
                        )
                      })}
                      {gr.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400 text-sm">No tasks</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
        {!loading && groups.length === 0 && (
          <div className="bg-white rounded-xl border border-[#ECEEF3] p-10 text-center">
            <p className="text-gray-500 text-sm">{q || filterAssignee ? 'No tasks match your filters.' : 'No tasks yet — add one to get started.'}</p>
            <button onClick={() => setShowAdd(true)} className="mt-3 text-white font-semibold rounded-lg px-4 py-2 text-sm" style={{ background: '#5559df' }}>+ Add Task</button>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: 'rgba(26,32,53,0.5)' }} onClick={closeDetail}>
          <div className="relative w-full max-w-[820px] my-6 bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between px-6 py-4 text-white" style={{ background: '#5559df' }}>
              <div className="min-w-0">
                <p className="text-white/70 text-xs uppercase tracking-wide">Task</p>
                <h2 className="text-xl font-bold leading-tight break-words">{detail.task_name || '—'}</h2>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className="text-[11px] font-semibold rounded-full px-2.5 py-0.5" style={{ background: statusColor(detail.status), color: '#fff' }}>{detail.status || 'Backlog'}</span>
                  <span className="text-[11px] font-semibold rounded-full px-2.5 py-0.5" style={{ background: 'rgba(255,255,255,0.22)' }}>{detail.priority || 'Medium'}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!editing && !isDone && <button onClick={() => setStatus('Done')} disabled={busy} className="text-xs font-semibold rounded-lg px-3 py-1.5 bg-white/15 hover:bg-emerald-500 disabled:opacity-50 transition-colors">✓ Complete</button>}
                {!editing && isDone && <button onClick={() => setStatus('In Progress')} disabled={busy} className="text-xs font-semibold rounded-lg px-3 py-1.5 bg-white/15 hover:bg-white/25 disabled:opacity-50 transition-colors">↩ Reopen</button>}
                {!editing && <ShareLink id={detail.id} className="text-xs font-semibold rounded-lg px-3 py-1.5 bg-white/15 hover:bg-white/25 transition-colors" />}
                {!editing && <button onClick={startEdit} className="text-xs font-semibold rounded-lg px-3 py-1.5 bg-white/15 hover:bg-white/25 transition-colors">✎ Edit</button>}
                {!editing && <button onClick={deleteRecord} disabled={deleting} className="text-xs font-semibold rounded-lg px-3 py-1.5 bg-white/15 hover:bg-red-500 disabled:opacity-50 transition-colors">{deleting ? 'Deleting…' : '🗑'}</button>}
                <button onClick={closeDetail} className="text-white/80 hover:text-white text-2xl leading-none pl-1">&times;</button>
              </div>
            </div>

            <div className="px-6 py-4 max-h-[75vh] overflow-y-auto space-y-5">
              {!editing && !detail.reviewed_at && (
                <div className="rounded-xl border border-[#BFD3FA] bg-[#EEF4FF] p-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2"><span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#5559df] text-white">NEW</span><span className="text-sm text-[#1A1D2E]">Not yet reviewed.</span></div>
                  <button onClick={markReviewed} className="text-xs font-semibold rounded-lg px-3 py-1.5 text-white" style={{ background: '#5559df' }}>Mark reviewed</button>
                </div>
              )}
              {!editing && detail.reviewed_at && (
                <div className="rounded-xl border border-[#CDEAD9] bg-[#F0FBF4] p-3 flex items-center gap-2 text-sm text-[#15803D]"><span>✓</span><span>Reviewed{detail.reviewed_by ? ` by ${(resolveMember(detail.reviewed_by)?.full_name || detail.reviewed_by).split(' ')[0]}` : ''}</span></div>
              )}

              {editing ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  <label className="col-span-2 sm:col-span-3"><span className="text-[11px] uppercase tracking-wide text-gray-400">Task name</span><input className={inputCls} value={form.task_name} onChange={e => setForm((f: any) => ({ ...f, task_name: e.target.value }))} /></label>
                  <label><span className="text-[11px] uppercase tracking-wide text-gray-400">Status</span><select className={inputCls} value={form.status} onChange={e => setForm((f: any) => ({ ...f, status: e.target.value }))}>{STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
                  <label><span className="text-[11px] uppercase tracking-wide text-gray-400">Priority</span><select className={inputCls} value={form.priority} onChange={e => setForm((f: any) => ({ ...f, priority: e.target.value }))}>{PRIORITIES.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
                  <label><span className="text-[11px] uppercase tracking-wide text-gray-400">Due date</span><input type="date" className={inputCls} value={form.due_date || ''} onChange={e => setForm((f: any) => ({ ...f, due_date: e.target.value }))} /></label>
                  <label className="col-span-2 sm:col-span-2"><span className="text-[11px] uppercase tracking-wide text-gray-400">Assigned to</span><input className={inputCls} list="team-list-edit" value={form.assigned_to} onChange={e => setForm((f: any) => ({ ...f, assigned_to: e.target.value }))} placeholder="Unassigned" /><datalist id="team-list-edit">{teamMembers.map(m => <option key={m.id} value={m.full_name} />)}</datalist></label>
                  <label><span className="text-[11px] uppercase tracking-wide text-gray-400">Section</span><select className={inputCls} value={form.group_name || ''} onChange={e => setForm((f: any) => ({ ...f, group_name: e.target.value }))}><option value="">—</option>{GROUP_SECTIONS.map(g => <option key={g} value={g}>{g}</option>)}</select></label>
                  <label className="col-span-2 sm:col-span-3"><span className="text-[11px] uppercase tracking-wide text-gray-400">Linked customer</span><select className={inputCls} value={form.customer_id || ''} onChange={e => setForm((f: any) => ({ ...f, customer_id: e.target.value }))}><option value="">— None —</option>{customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select></label>
                  <label className="col-span-2 sm:col-span-3"><span className="text-[11px] uppercase tracking-wide text-gray-400">Notes</span><textarea rows={3} className={inputCls} value={form.notes} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} /></label>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                  <Field label="Status" value={detail.status} />
                  <Field label="Priority" value={detail.priority} />
                  <Field label="Assigned To" value={detail.assigned_to} />
                  <Field label="Due Date" value={fmtDate(detail.due_date)} />
                  <Field label="Section" value={detail.group_name} />
                  <Field label="Linked Customer" value={customerName(detail.customer_id)} />
                  <Field label="Notes" value={detail.notes} wide />
                  {detail.description && <Field label="Description" value={detail.description} wide />}
                </div>
              )}

              {editing && (
                <div className="flex items-center justify-between gap-3 border-t border-[#EEF0F4] pt-4">
                  <div className="flex items-center gap-2">
                    <button onClick={archive} disabled={busy || saving} className="text-xs font-semibold rounded-lg px-3 py-2 text-gray-600 hover:bg-gray-100 disabled:opacity-50">Archive</button>
                    <button onClick={deleteRecord} disabled={deleting || saving} className="text-xs font-semibold rounded-lg px-3 py-2 text-red-600 hover:bg-red-50 disabled:opacity-50">{deleting ? 'Deleting…' : '🗑 Delete task'}</button>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setEditing(false)} disabled={saving} className="text-sm px-4 py-2 rounded-lg border border-[#E4E6EE] text-gray-600 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
                    <button onClick={saveRecord} disabled={saving} className="text-sm px-4 py-2 rounded-lg text-white font-semibold disabled:opacity-50" style={{ background: '#5559df' }}>{saving ? 'Saving…' : 'Save changes'}</button>
                  </div>
                </div>
              )}

              {!editing && (
                <>
                  <div className="border-t border-[#EEF0F4] pt-4">
                    <FileUpload supabase={sb} recordType="tasks" recordId={detail.id} currentUserEmail={userEmail} />
                  </div>
                  <div className="border-t border-[#EEF0F4] pt-4">
                    <Comments recordId={detail.id} recordType="task" currentUserEmail={userEmail} title="Notes & Comments" />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <AddModal open={showAdd} onClose={() => setShowAdd(false)} onCreated={load} sb={sb} teamMembers={teamMembers} customers={customers} />
    </div>
  )
}

function Field({ label, value, wide }: { label: string; value: any; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2 sm:col-span-3' : ''}>
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-gray-800 mt-0.5 break-words whitespace-pre-wrap">{value || <span className="text-gray-300">—</span>}</p>
    </div>
  )
}
