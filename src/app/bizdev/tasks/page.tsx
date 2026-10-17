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
import ItemHistory from '@/components/ItemHistory'
import { useToast } from '@/components/Toast'
import { usePointerDnd } from '@/lib/usePointerDnd'

/* ═══════════════════════════════════════════════════════════════════════════
   Tickets — Jira-style ticketing on the `tasks` table (keys BG-###).
   Board (kanban, drag between columns) · List · one centered ticket window
   with inline editing. Assignment pings the assignee via a DB trigger.
   ═══════════════════════════════════════════════════════════════════════ */

const ACCENT = '#5559df'
const COLUMNS = ['Backlog', 'In Progress', 'Review', 'On Hold', 'Done'] as const
const STATUSES = ['Backlog', 'In Progress', 'Review', 'Blocked', 'On Hold', 'Done'] as const
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical', 'Urgent'] as const
const TYPES = ['Task', 'Bug', 'Request', 'Improvement'] as const
const RESOLUTIONS = ['Done', 'Fixed', "Won't Do", 'Duplicate', 'Cannot Reproduce'] as const
const DONE = new Set(['Done', 'Completed'])
const DONE_WINDOW_DAYS = 14

const STATUS_COLORS: Record<string, string> = {
  'Backlog': '#9699a6', 'In Progress': '#579bfc', 'Review': '#a25ddc', 'Blocked': '#e2445c',
  'On Hold': '#fdab3d', 'Done': '#00c875', 'Completed': '#00c875', 'Archived': '#c4c4c4', 'External': '#00a89b',
}
const PRIORITY_COLORS: Record<string, string> = { Low: '#00c875', Medium: '#579bfc', High: '#fdab3d', Critical: '#e2445c', Urgent: '#bb3354' }
const PRIORITY_RANK: Record<string, number> = { Urgent: 5, Critical: 4, High: 3, Medium: 2, Low: 1 }
const TYPE_META: Record<string, { icon: string; color: string }> = {
  Task: { icon: '✓', color: '#579bfc' }, Bug: { icon: '●', color: '#e2445c' }, Request: { icon: '?', color: '#a25ddc' }, Improvement: { icon: '↑', color: '#00c875' },
}
const statusColor = (s: string | null | undefined) => (s && STATUS_COLORS[s]) || '#c4c4c4'
const priorityColor = (p: string | null | undefined) => (p && PRIORITY_COLORS[p]) || '#c4c4c4'
const typeMeta = (t: string | null | undefined) => TYPE_META[t || 'Task'] || TYPE_META.Task

const initials = (name: string) => (name || '').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase()
const avatarColor = (name: string) => {
  const palette = ['#5559df', '#00c875', '#579bfc', '#a25ddc', '#fdab3d', '#037f4c', '#ff6d3b', '#bb3354', '#00a89b', '#7e3b8a']
  let h = 0; for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}
const fmtDate = (d: string | null | undefined) => d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
const fmtStamp = (d: string | null | undefined) => d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
function dueMeta(d: string | null, status: string | null) {
  if (!d) return null
  const date = new Date(d + 'T00:00:00'); const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.ceil((date.getTime() - today.getTime()) / 86400000)
  const done = DONE.has(status || '')
  return { str: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), overdue: !done && diff < 0, today: !done && diff === 0, soon: !done && diff > 0 && diff <= 3 }
}
const ago = (iso: string | null | undefined) => {
  if (!iso) return ''
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

interface Customer { id: string; company_name: string }
interface TeamMember { id: string; email: string; full_name: string; avatar_color: string; avatar_initials: string | null }
interface Ticket {
  id: string; ticket_key: string | null; task_name: string; description: string | null; notes: string | null
  assigned_to: string | null; reporter: string | null; ticket_type: string | null; labels: string[] | null; resolution: string | null
  priority: string; status: string; customer_id: string | null; due_date: string | null; group_name: string | null
  is_active: boolean; created_at: string | null; updated_at: string | null; started_at: string | null; completed_at: string | null
  reviewed_at: string | null; reviewed_by: string | null; points_earned: number | null; linked_record_type: string | null; linked_record_id: string | null
}

const inp = 'w-full bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#5559df]/40'
const inpSm = 'w-full bg-white border border-[#E4E6EE] rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#5559df]/40'
const Avatar = ({ name, member, size = 24, className = '' }: { name: string; member?: TeamMember | null; size?: number; className?: string }) => (
  <span title={member?.full_name || name} className={`rounded-full inline-flex items-center justify-center text-white font-bold shrink-0 ${className}`}
    style={{ width: size, height: size, fontSize: Math.round(size * 0.4), background: member?.avatar_color || avatarColor(member?.full_name || name) }}>
    {member?.avatar_initials || initials(member?.full_name || name)}
  </span>
)
const TypeBadge = ({ type, small }: { type: string | null | undefined; small?: boolean }) => {
  const m = typeMeta(type)
  return <span title={type || 'Task'} className={`inline-flex items-center justify-center rounded text-white font-bold shrink-0 ${small ? 'w-4 h-4 text-[10px]' : 'w-5 h-5 text-[11px]'}`} style={{ background: m.color }}>{m.icon}</span>
}
const Pill = ({ text, color }: { text: string; color: string }) => <span className="text-white text-[11px] font-semibold rounded-full px-2.5 py-0.5 inline-block whitespace-nowrap" style={{ background: color }}>{text}</span>

// ─────────────────────────────────────────── New ticket window
function NewTicketModal({ open, onClose, onCreated, sb, team, customers, userEmail, me }: {
  open: boolean; onClose: () => void; onCreated: (id: string) => void; sb: any; team: TeamMember[]; customers: Customer[]; userEmail: string; me: TeamMember | null
}) {
  const empty = { task_name: '', ticket_type: 'Task', priority: 'Medium', status: 'Backlog', assigned_to: '', due_date: '', description: '', labels: '', customer_id: '' }
  const [form, setForm] = useState<any>(empty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [aiText, setAiText] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  useEffect(() => { if (open) { setForm(empty); setAiText(''); setError('') } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  async function aiFill() {
    if (!aiText.trim()) return
    setAiBusy(true); setError('')
    try {
      const res = await fetch('/api/tasks/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: aiText, members: team.map(m => ({ full_name: m.full_name, email: m.email })) }) })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'AI could not parse that.')
      setForm((p: any) => ({ ...p, task_name: j.task_name || p.task_name, assigned_to: j.assignee || p.assigned_to, priority: j.priority || p.priority, due_date: j.due_date || p.due_date, description: j.notes ? (p.description ? p.description + '\n' + j.notes : j.notes) : p.description }))
    } catch (e) { setError((e as Error).message) }
    setAiBusy(false)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError('')
    if (!form.task_name.trim()) { setError('A title is required.'); return }
    setSaving(true)
    try {
      const row = {
        task_name: form.task_name.trim(), ticket_type: form.ticket_type, priority: form.priority, status: form.status,
        assigned_to: form.assigned_to || null, due_date: form.due_date || null, description: form.description?.trim() || null,
        labels: String(form.labels || '').split(',').map((s: string) => s.trim()).filter(Boolean),
        customer_id: form.customer_id || null, reporter: userEmail || null, group_name: 'Current', is_active: true,
      }
      const { data, error } = await sb.from('tasks').insert(row).select('id').single()
      if (error) { setError(error.message); return }
      onClose(); onCreated(data?.id)
    } finally { setSaving(false) }
  }
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(26,32,53,0.5)' }} onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[92vh] overflow-y-auto border border-[#E4E6EE]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 text-white rounded-t-2xl" style={{ background: ACCENT }}>
          <div><p className="text-white/70 text-[11px] uppercase tracking-wide">Tickets</p><h2 className="font-bold text-lg leading-tight">New ticket</h2></div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded text-sm">{error}</div>}
          <div className="rounded-xl border border-[#D9E2FB] bg-[#F4F7FF] p-3.5">
            <div className="flex items-center gap-2 mb-1.5"><span className="flex items-center justify-center w-6 h-6 rounded-lg text-white text-sm" style={{ background: ACCENT }}>✨</span><span className="text-sm font-semibold text-[#1A1D2E]">Quick add with AI</span></div>
            <p className="text-xs text-gray-500 mb-2">Paste an email or note — AI drafts the ticket and picks who it should go to.</p>
            <textarea value={aiText} onChange={e => setAiText(e.target.value)} placeholder="Paste text here…" rows={2} className={inp + ' resize-none'} />
            <button type="button" onClick={aiFill} disabled={aiBusy || !aiText.trim()} className="mt-2 w-full text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50" style={{ background: ACCENT }}>{aiBusy ? 'Reading…' : 'Fill ticket with AI'}</button>
          </div>
          <label className="block"><span className="text-xs font-medium text-gray-600">Title *</span><input className={inp} value={form.task_name} onChange={e => setForm((f: any) => ({ ...f, task_name: e.target.value }))} placeholder="What needs to happen?" autoFocus /></label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block"><span className="text-xs font-medium text-gray-600">Type</span><select className={inp} value={form.ticket_type} onChange={e => setForm((f: any) => ({ ...f, ticket_type: e.target.value }))}>{TYPES.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
            <label className="block"><span className="text-xs font-medium text-gray-600">Priority</span><select className={inp} value={form.priority} onChange={e => setForm((f: any) => ({ ...f, priority: e.target.value }))}>{PRIORITIES.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
            <label className="block"><span className="text-xs font-medium text-gray-600">Status</span><select className={inp} value={form.status} onChange={e => setForm((f: any) => ({ ...f, status: e.target.value }))}>{STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-xs font-medium text-gray-600">Assign to</span>
              <select className={inp} value={form.assigned_to} onChange={e => setForm((f: any) => ({ ...f, assigned_to: e.target.value }))}>
                <option value="">Unassigned</option>
                {me && <option value={me.full_name}>{me.full_name} (me)</option>}
                {team.filter(m => !me || m.email !== me.email).map(m => <option key={m.id} value={m.full_name}>{m.full_name}</option>)}
              </select>
            </label>
            <label className="block"><span className="text-xs font-medium text-gray-600">Due date</span><input type="date" className={inp} value={form.due_date} onChange={e => setForm((f: any) => ({ ...f, due_date: e.target.value }))} /></label>
          </div>
          <label className="block"><span className="text-xs font-medium text-gray-600">Description</span><textarea rows={4} className={inp} value={form.description} onChange={e => setForm((f: any) => ({ ...f, description: e.target.value }))} placeholder="Context, steps, acceptance criteria…" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-xs font-medium text-gray-600">Labels</span><input className={inp} value={form.labels} onChange={e => setForm((f: any) => ({ ...f, labels: e.target.value }))} placeholder="comma, separated" /></label>
            <label className="block"><span className="text-xs font-medium text-gray-600">Linked customer</span><select className={inp} value={form.customer_id} onChange={e => setForm((f: any) => ({ ...f, customer_id: e.target.value }))}><option value="">— None —</option>{customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select></label>
          </div>
          <div className="flex gap-2 pt-2 border-t border-gray-100">
            <button type="submit" disabled={saving} className="flex-1 text-white font-semibold py-2 rounded-lg disabled:opacity-50" style={{ background: ACCENT }}>{saving ? 'Creating…' : 'Create ticket'}</button>
            <button type="button" onClick={onClose} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-800 font-medium py-2 rounded-lg">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────── Page
export default function TicketsPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const { toast } = useToast()
  const [rows, setRows] = useState<Ticket[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [team, setTeam] = useState<TeamMember[]>([])
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({})
  const [fileCounts, setFileCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'board' | 'list'>('board')
  const [q, setQ] = useState('')
  const [filterAssignee, setFilterAssignee] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [mine, setMine] = useState(false)
  const [showAllDone, setShowAllDone] = useState(false)
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'updated_at', dir: -1 })
  const [detail, setDetail] = useState<Ticket | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    const [{ data: t }, { data: c }, { data: tm }] = await Promise.all([
      sb.from('tasks').select('*').eq('is_active', true).neq('status', 'Archived').order('created_at', { ascending: false }),
      sb.from('customers').select('id,company_name').eq('is_active', true).order('company_name'),
      sb.from('user_profiles').select('id,email,full_name,avatar_color,avatar_initials').eq('is_active', true).order('full_name'),
    ])
    const list = (t as Ticket[]) || []
    setRows(list)
    if (c) setCustomers(c as Customer[])
    if (tm) setTeam(tm as TeamMember[])
    const ids = list.map(r => r.id)
    if (ids.length) {
      const [{ data: cm }, { data: fa }] = await Promise.all([
        sb.from('comments').select('record_id').eq('record_type', 'task').in('record_id', ids),
        sb.from('file_attachments').select('record_id').eq('record_type', 'tasks').in('record_id', ids),
      ])
      const cc: Record<string, number> = {}; (cm || []).forEach((x: any) => { cc[x.record_id] = (cc[x.record_id] || 0) + 1 })
      const fc: Record<string, number> = {}; (fa || []).forEach((x: any) => { fc[x.record_id] = (fc[x.record_id] || 0) + 1 })
      setCommentCounts(cc); setFileCounts(fc)
    }
    setLoading(false)
  }, [sb])

  useEffect(() => {
    load()
    sb.auth.getUser().then(({ data }: any) => { if (data.user?.email) setUserEmail(data.user.email) })
  }, [load, sb])

  // Live: any change to tasks by anyone refreshes the board (debounced).
  useEffect(() => {
    const ch = sb.channel('tickets-live').on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current)
      reloadTimer.current = setTimeout(() => load(true), 400)
    }).subscribe()
    return () => { sb.removeChannel(ch) }
  }, [sb, load])

  // Keep the open window in sync with refreshed rows.
  useEffect(() => { if (detail) { const fresh = rows.find(r => r.id === detail.id); if (fresh && fresh !== detail) setDetail(fresh) } }, [rows]) // eslint-disable-line react-hooks/exhaustive-deps

  const me = useMemo(() => team.find(m => m.email.toLowerCase() === userEmail.toLowerCase()) || null, [team, userEmail])
  const customerName = (id: string | null) => id ? (customers.find(c => c.id === id)?.company_name || '') : ''
  const resolveMember = useCallback((val: string | null | undefined) => {
    if (!val) return null
    const v = val.trim().toLowerCase()
    return team.find(m => m.full_name.toLowerCase() === v || m.email.toLowerCase() === v) || team.find(m => m.full_name.split(' ')[0].toLowerCase() === v) || null
  }, [team])
  const displayName = (val: string | null | undefined) => { const m = resolveMember(val); return m ? m.full_name : (val || '') }
  const isMine = (r: Ticket) => !!me && resolveMember(r.assigned_to)?.email === me.email

  const openDetail = useCallback((r: Ticket) => {
    setDetail(r)
    // Assignee opening the ticket acknowledges it (clears the NEW badge).
    if (!r.reviewed_at && me && resolveMember(r.assigned_to)?.email === me.email) {
      const patch = { reviewed_at: new Date().toISOString(), reviewed_by: me.email }
      sb.from('tasks').update(patch).eq('id', r.id).then(() => setRows(rs => rs.map(x => x.id === r.id ? { ...x, ...patch } : x)))
    }
  }, [me, resolveMember, sb])
  useItemDeepLink(rows, (r: Ticket) => openDetail(r))

  const match = (r: Ticket) => {
    if (mine && !isMine(r)) return false
    if (filterAssignee) {
      const m = team.find(x => x.email === filterAssignee)
      const rm = resolveMember(r.assigned_to)
      if (!(m && rm && rm.email === m.email)) return false
    }
    if (filterType && (r.ticket_type || 'Task') !== filterType) return false
    if (filterPriority && r.priority !== filterPriority) return false
    if (filterStatus && r.status !== filterStatus) return false
    if (DONE.has(r.status) && !showAllDone && !q) {
      const t = new Date(r.completed_at || r.updated_at || r.created_at || 0).getTime()
      if (Date.now() - t > DONE_WINDOW_DAYS * 86400000) return false
    }
    if (!q) return true
    const s = q.toLowerCase()
    return [r.ticket_key, r.task_name, r.assigned_to, r.description, r.notes, r.reporter, (r.labels || []).join(' '), customerName(r.customer_id)].some(v => String(v ?? '').toLowerCase().includes(s))
  }
  const visible = useMemo(() => rows.filter(match), [rows, q, filterAssignee, filterType, filterPriority, filterStatus, mine, showAllDone, team, customers, me]) // eslint-disable-line react-hooks/exhaustive-deps

  const columnSort = (a: Ticket, b: Ticket) => {
    const pr = (PRIORITY_RANK[b.priority] || 0) - (PRIORITY_RANK[a.priority] || 0)
    if (pr) return pr
    if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1
    if (!!a.due_date !== !!b.due_date) return a.due_date ? -1 : 1
    return (b.created_at || '').localeCompare(a.created_at || '')
  }
  const columns = useMemo(() => {
    const present = new Set(visible.map(r => r.status || 'Backlog'))
    const cols: string[] = [...COLUMNS]
    for (const s of present) if (!cols.includes(s)) cols.push(s)
    return cols.map(key => ({ key, color: statusColor(key), items: visible.filter(r => (r.status || 'Backlog') === key).sort(key === 'Done' ? (a, b) => (b.completed_at || b.updated_at || '').localeCompare(a.completed_at || a.updated_at || '') : columnSort) }))
  }, [visible])

  const listRows = useMemo(() => {
    const dir = sort.dir
    const val = (r: Ticket): any => {
      switch (sort.key) {
        case 'key': return parseInt((r.ticket_key || '').replace(/\D/g, '') || '0', 10)
        case 'priority': return PRIORITY_RANK[r.priority] || 0
        case 'due': return r.due_date || (dir === 1 ? '9999' : '')
        case 'status': return COLUMNS.indexOf(r.status as any)
        case 'assignee': return displayName(r.assigned_to)
        case 'title': return r.task_name || ''
        default: return r.updated_at || r.created_at || ''
      }
    }
    return [...visible].sort((a, b) => { const x = val(a), y = val(b); return x < y ? -dir : x > y ? dir : 0 })
  }, [visible, sort, team]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggleSort = (key: string) => setSort(s => s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === 'updated_at' ? -1 : 1 })

  const open = rows.filter(r => !DONE.has(r.status))
  const kpi = {
    open: open.length, inProgress: rows.filter(r => r.status === 'In Progress').length, review: rows.filter(r => r.status === 'Review').length,
    overdue: rows.filter(r => dueMeta(r.due_date, r.status)?.overdue).length, mine: open.filter(isMine).length,
  }

  // ── writes
  async function patch(id: string, fields: Partial<Ticket> & Record<string, any>, okMsg?: string) {
    const prev = rows.find(r => r.id === id)
    setRows(rs => rs.map(r => r.id === id ? { ...r, ...fields } : r))
    const { error } = await sb.from('tasks').update(fields).eq('id', id)
    if (error) { toast('Save failed: ' + error.message, 'error'); if (prev) setRows(rs => rs.map(r => r.id === id ? prev : r)); return false }
    if (okMsg) toast(okMsg)
    return true
  }
  async function setStatus(r: Ticket, status: string) {
    if (r.status === status) return
    const fields: any = { status }
    if (DONE.has(status)) { fields.resolution = r.resolution || 'Done'; if (!r.reviewed_at) { fields.reviewed_at = new Date().toISOString(); fields.reviewed_by = userEmail || 'unknown' } }
    else fields.resolution = null
    await patch(r.id, fields, `${r.ticket_key || 'Ticket'} → ${status}`)
  }
  async function archive(r: Ticket) {
    if (!confirm(`Archive ${r.ticket_key || 'this ticket'}? It leaves the board but keeps its history.`)) return
    const ok = await patch(r.id, { is_active: false }, 'Archived')
    if (ok) { setRows(rs => rs.filter(x => x.id !== r.id)); setDetail(null) }
  }
  async function remove(r: Ticket) {
    if (!confirm(`Delete ${r.ticket_key || 'this ticket'} "${r.task_name}"? Comments and files go with it. This cannot be undone.`)) return
    await sb.rpc('delete_record_comments', { p_record_type: 'task', p_record_id: r.id })
    await sb.from('file_attachments').delete().eq('record_type', 'tasks').eq('record_id', r.id)
    const { error } = await sb.from('tasks').delete().eq('id', r.id)
    if (error) { toast('Delete failed: ' + error.message, 'error'); return }
    setRows(rs => rs.filter(x => x.id !== r.id)); setDetail(null); toast('Ticket deleted')
  }

  // ── drag & drop between columns (pointer-based: mouse + touch, whole column is the target)
  const rowsRef = useRef(rows); rowsRef.current = rows
  const dnd = usePointerDnd({ onDrop: (id, status) => { const r = rowsRef.current.find(x => x.id === id); if (r) setStatus(r, status) } })
  const dragId = dnd.dragId

  const chip = (active: boolean) => `px-3 py-1.5 rounded-lg border text-sm font-medium shrink-0 transition-colors ${active ? 'bg-[#1A1D2E] text-white border-[#1A1D2E]' : 'bg-white text-gray-500 border-[#E4E6EE] hover:border-[#D0D3E0]'}`

  const renderCard = (r: Ticket) => {
    const m = resolveMember(r.assigned_to); const due = dueMeta(r.due_date, r.status)
    const nc = commentCounts[r.id] || 0, nf = fileCounts[r.id] || 0
    return (
      <div key={r.id} id={'item-' + r.id} {...dnd.item(r.id)}
        onClick={() => openDetail(r)}
        className={`bg-white rounded-xl border border-[#E4E6EE] p-3 hover:border-[#C7CBE0] hover:shadow-md transition-[border-color,box-shadow] select-none touch-manipulation ${dragId === r.id ? 'opacity-30 border-dashed' : ''}`}>
        <div className="flex items-start gap-2">
          <TypeBadge type={r.ticket_type} small />
          <p className={`text-[13px] font-semibold leading-snug flex-1 ${DONE.has(r.status) ? 'text-gray-400 line-through' : 'text-[#1A1D2E]'}`}>{r.task_name || '—'}</p>
        </div>
        {(r.labels || []).length > 0 && <div className="flex flex-wrap gap-1 mt-2">{(r.labels || []).slice(0, 3).map(l => <span key={l} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#F1F3F9] text-gray-500">{l}</span>)}</div>}
        <div className="flex items-center gap-2 mt-2.5">
          <span className="text-[11px] font-bold text-gray-400 tracking-wide">{r.ticket_key}</span>
          {!r.reviewed_at && !DONE.has(r.status) && <span className="text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded text-white" style={{ background: ACCENT }}>NEW</span>}
          <span className="w-2 h-2 rounded-full" title={r.priority} style={{ background: priorityColor(r.priority) }} />
          {due && <span className={`text-[11px] font-semibold ${due.overdue ? 'text-red-600' : due.today ? 'text-amber-600' : 'text-gray-400'}`}>{due.overdue ? '⚠ ' : ''}{due.str}</span>}
          <span className="ml-auto flex items-center gap-2 text-[11px] text-gray-400">
            {nf > 0 && <span>📎{nf}</span>}{nc > 0 && <span>💬{nc}</span>}
            {m || r.assigned_to ? <Avatar name={r.assigned_to || ''} member={m} size={22} /> : <span className="w-[22px] h-[22px] rounded-full border border-dashed border-gray-300 inline-block" title="Unassigned" />}
          </span>
        </div>
      </div>
    )
  }

  const SortTh = ({ k, label, w }: { k: string; label: string; w?: string }) => (
    <th className={`text-left px-3 py-2 font-semibold cursor-pointer select-none hover:text-gray-600 ${w || ''}`} onClick={() => toggleSort(k)}>{label}{sort.key === k ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</th>
  )

  return (
    <div className="min-h-screen mon-page p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <span className="mon-tag" style={{ background: ACCENT + '22', color: ACCENT }}>🎫 Tickets</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">Tickets</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${kpi.open} open · ${rows.length - kpi.open} done · assign work to one person, track it to Done`}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-[#E4E6EE] bg-white p-0.5">
            {(['board', 'list'] as const).map(v => <button key={v} data-ro-ok onClick={() => setView(v)} className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${view === v ? 'text-white' : 'text-gray-500 hover:text-gray-800'}`} style={view === v ? { background: ACCENT } : undefined}>{v === 'board' ? '▦ Board' : '☰ List'}</button>)}
          </div>
          <ImportExportBar table="tasks" filename="tickets" columns={[
            { header: 'Title', dbKey: 'task_name', example: 'Follow up on proposal', required: true },
            { header: 'Type', dbKey: 'ticket_type', example: 'Task' },
            { header: 'Assigned To', dbKey: 'assigned_to', example: 'Rudy Patel' },
            { header: 'Due Date', dbKey: 'due_date', example: '2026-11-15' },
            { header: 'Priority', dbKey: 'priority', example: 'Medium' },
            { header: 'Status', dbKey: 'status', example: 'Backlog' },
            { header: 'Description', dbKey: 'description', example: '' },
          ]} onImportDone={() => load(true)} />
          <button onClick={() => setShowAdd(true)} className="text-white font-semibold rounded-lg px-4 py-2 text-sm shadow-sm hover:opacity-90" style={{ background: ACCENT }}>+ New Ticket</button>
        </div>
      </div>

      {/* KPIs */}
      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
          {[
            { label: 'Open', value: kpi.open, color: ACCENT, on: () => { setMine(false); setFilterStatus('') } },
            { label: 'In Progress', value: kpi.inProgress, color: '#579bfc', on: () => { setView('list'); setFilterStatus('In Progress') } },
            { label: 'In Review', value: kpi.review, color: '#a25ddc', on: () => { setView('list'); setFilterStatus('Review') } },
            { label: 'Overdue', value: kpi.overdue, color: '#e2445c', on: () => { setView('list'); setFilterStatus(''); setSort({ key: 'due', dir: 1 }) } },
            { label: 'Assigned to me', value: kpi.mine, color: '#00c875', on: () => setMine(m => !m) },
          ].map(s => (
            <button key={s.label} data-ro-ok onClick={s.on} className={`text-left bg-white rounded-xl border px-5 py-3.5 hover:border-[#C7CBE0] transition-colors ${s.label === 'Assigned to me' && mine ? 'border-[#00c875]' : 'border-[#ECEEF3]'}`}>
              <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
              <p className="text-sm text-gray-500 mt-0.5">{s.label}</p>
            </button>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search tickets, keys, people…" className="bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm w-full sm:w-72 focus:outline-none focus:ring-2 focus:ring-[#5559df]/40" />
        <select data-ro-ok value={filterType} onChange={e => setFilterType(e.target.value)} className="bg-white border border-[#E4E6EE] rounded-lg px-2.5 py-2 text-sm"><option value="">All types</option>{TYPES.map(t => <option key={t}>{t}</option>)}</select>
        <select data-ro-ok value={filterPriority} onChange={e => setFilterPriority(e.target.value)} className="bg-white border border-[#E4E6EE] rounded-lg px-2.5 py-2 text-sm"><option value="">All priorities</option>{PRIORITIES.map(t => <option key={t}>{t}</option>)}</select>
        {view === 'list' && <select data-ro-ok value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="bg-white border border-[#E4E6EE] rounded-lg px-2.5 py-2 text-sm"><option value="">All statuses</option>{STATUSES.map(t => <option key={t}>{t}</option>)}</select>}
        <button data-ro-ok onClick={() => setMine(m => !m)} className={chip(mine)}>Mine</button>
        <button data-ro-ok onClick={() => setShowAllDone(v => !v)} className={chip(showAllDone)} title={`Done tickets older than ${DONE_WINDOW_DAYS} days are hidden unless this is on`}>{showAllDone ? 'All done shown' : `Done · last ${DONE_WINDOW_DAYS}d`}</button>
        {(q || filterType || filterPriority || filterStatus || filterAssignee || mine) && <button data-ro-ok onClick={() => { setQ(''); setFilterType(''); setFilterPriority(''); setFilterStatus(''); setFilterAssignee(''); setMine(false) }} className="text-sm text-gray-400 hover:text-gray-700 px-2">Clear</button>}
      </div>
      {!loading && team.length > 0 && (
        <div className="flex gap-2 items-center mb-4 overflow-x-auto pb-1">
          <span className="text-sm text-gray-400 shrink-0 mr-1">Assignee:</span>
          <button data-ro-ok onClick={() => setFilterAssignee('')} className={chip(!filterAssignee)}>All</button>
          {team.map(m => (
            <button key={m.email} data-ro-ok onClick={() => setFilterAssignee(p => p === m.email ? '' : m.email)} className={`flex items-center gap-2 ${chip(filterAssignee === m.email)}`}>
              <Avatar name={m.full_name} member={m} size={22} />{m.full_name.split(' ')[0]}
            </button>
          ))}
        </div>
      )}

      {/* Board */}
      {view === 'board' && (
        <div className="flex gap-3 overflow-x-auto pb-4 -mx-1 px-1 items-stretch">
          {columns.map(col => (
            <div key={col.key} {...dnd.zone(col.key)}
              className={`w-[272px] shrink-0 flex flex-col rounded-2xl border-2 p-2.5 transition-colors ${dnd.overZone === col.key && dragId ? 'border-[#5559df] bg-[#EEF0FF]' : dragId ? 'border-dashed border-[#D5D8E6] bg-[#F6F7FB]' : 'border-transparent bg-[#F6F7FB]'}`} style={{ minHeight: '62vh' }}>
              <div className="flex items-center gap-2 px-1.5 pb-2.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: col.color }} />
                <span className="font-bold text-[13px] text-[#1A1D2E]">{col.key}</span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: col.color + '26', color: col.color }}>{col.items.length}</span>
                {col.key === 'Backlog' && <button onClick={() => setShowAdd(true)} className="ml-auto text-gray-400 hover:text-gray-700 text-lg leading-none" title="New ticket">+</button>}
              </div>
              <div className="space-y-2 flex-1 max-h-[68vh] overflow-y-auto pr-0.5">
                {col.items.map(r => renderCard(r))}
                {col.items.length === 0 && <div className={`text-center text-xs py-6 border border-dashed rounded-xl ${dnd.overZone === col.key && dragId ? 'text-[#5559df] border-[#5559df]' : 'text-gray-400 border-[#E4E6EE]'}`}>{dragId ? 'Drop here' : 'Nothing here'}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* List */}
      {view === 'list' && (
        <div className="bg-white rounded-xl shadow-sm border border-[#ECEEF3] overflow-x-auto">
          <table className="w-full text-sm min-w-[960px]">
            <thead>
              <tr className="text-[11px] uppercase text-gray-400 border-b border-[#EEF0F4] bg-[#FBFCFE]">
                <SortTh k="key" label="Key" w="w-[90px]" /><SortTh k="title" label="Title" /><SortTh k="assignee" label="Assignee" w="w-[170px]" />
                <SortTh k="priority" label="Priority" w="w-[100px]" /><SortTh k="status" label="Status" w="w-[120px]" /><SortTh k="due" label="Due" w="w-[100px]" /><SortTh k="updated_at" label="Updated" w="w-[110px]" />
                <th className="px-3 py-2 w-[80px]" />
              </tr>
            </thead>
            <tbody>
              {listRows.map((r, i) => {
                const m = resolveMember(r.assigned_to); const due = dueMeta(r.due_date, r.status)
                return (
                  <tr key={r.id} id={'item-' + r.id} className={`cursor-pointer hover:bg-[#F2F6FF] ${i % 2 ? 'bg-[#F8FAFC]' : 'bg-white'}`} onClick={() => openDetail(r)}>
                    <td className="px-3 py-2.5"><span className="flex items-center gap-1.5"><TypeBadge type={r.ticket_type} small /><span className="font-bold text-gray-500 text-xs">{r.ticket_key}</span></span></td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">{!r.reviewed_at && !DONE.has(r.status) && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded text-white" style={{ background: ACCENT }}>NEW</span>}<span className={`font-semibold ${DONE.has(r.status) ? 'line-through text-gray-400' : 'text-[#1A1D2E]'}`}>{r.task_name || '—'}</span></div>
                      {r.customer_id && <span className="text-[11px] text-gray-400">{customerName(r.customer_id)}</span>}
                    </td>
                    <td className="px-3 py-2.5">{r.assigned_to ? <span className="flex items-center gap-1.5"><Avatar name={r.assigned_to} member={m} size={22} /><span className="text-gray-600 text-xs truncate max-w-[110px]">{displayName(r.assigned_to)}</span></span> : <span className="text-gray-300">Unassigned</span>}</td>
                    <td className="px-3 py-2.5"><Pill text={r.priority || '—'} color={priorityColor(r.priority)} /></td>
                    <td className="px-3 py-2.5"><Pill text={r.status || 'Backlog'} color={statusColor(r.status)} /></td>
                    <td className="px-3 py-2.5">{due ? <span className={`text-xs font-semibold ${due.overdue ? 'text-red-600' : due.today ? 'text-amber-600' : 'text-gray-500'}`}>{due.overdue ? '⚠ ' : ''}{due.str}</span> : <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-400">{ago(r.updated_at || r.created_at)}</td>
                    <td className="px-3 py-2.5 text-[11px] text-gray-400 whitespace-nowrap">{fileCounts[r.id] ? `📎${fileCounts[r.id]} ` : ''}{commentCounts[r.id] ? `💬${commentCounts[r.id]}` : ''}</td>
                  </tr>
                )
              })}
              {listRows.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 text-sm">{loading ? 'Loading…' : 'No tickets match.'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Ticket window */}
      {detail && (
        <TicketWindow r={detail} sb={sb} team={team} customers={customers} userEmail={userEmail} me={me} resolveMember={resolveMember} customerName={customerName}
          onClose={() => setDetail(null)} onPatch={(f, msg) => patch(detail.id, f, msg)} onStatus={s => setStatus(detail, s)} onArchive={() => archive(detail)} onDelete={() => remove(detail)} />
      )}

      <NewTicketModal open={showAdd} onClose={() => setShowAdd(false)} sb={sb} team={team} customers={customers} userEmail={userEmail} me={me}
        onCreated={async (id) => { toast('Ticket created'); await load(true); if (id) { const { data } = await sb.from('tasks').select('*').eq('id', id).single(); if (data) setDetail(data as Ticket) } }} />
    </div>
  )
}

// ─────────────────────────────────────────── Ticket window (centered, inline editing)
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div><p className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">{label}</p>{children}</div> }

function TicketWindow({ r, sb, team, customers, userEmail, me, resolveMember, customerName, onClose, onPatch, onStatus, onArchive, onDelete }: {
  r: Ticket; sb: any; team: TeamMember[]; customers: Customer[]; userEmail: string; me: TeamMember | null
  resolveMember: (v: string | null | undefined) => TeamMember | null; customerName: (id: string | null) => string
  onClose: () => void; onPatch: (f: Record<string, any>, msg?: string) => Promise<boolean>; onStatus: (s: string) => void; onArchive: () => void; onDelete: () => void
}) {
  const [editTitle, setEditTitle] = useState(false)
  const [title, setTitle] = useState(r.task_name || '')
  const [editDesc, setEditDesc] = useState(false)
  const [desc, setDesc] = useState(r.description || '')
  const [labelDraft, setLabelDraft] = useState('')
  useEffect(() => { setTitle(r.task_name || ''); setDesc(r.description || ''); setEditTitle(false); setEditDesc(false) }, [r.id, r.task_name, r.description])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey); const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  const assignee = resolveMember(r.assigned_to)
  const reporter = resolveMember(r.reporter)
  const isDone = DONE.has(r.status)
  const due = dueMeta(r.due_date, r.status)
  const assigneeOptions = useMemo(() => {
    const opts = team.map(m => m.full_name)
    if (r.assigned_to && !assignee && !opts.includes(r.assigned_to)) opts.unshift(r.assigned_to)
    return opts
  }, [team, r.assigned_to, assignee])
  const hdrBtn = 'text-xs font-semibold rounded-lg px-3 py-1.5 bg-white/15 hover:bg-white/25 transition-colors disabled:opacity-50'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6" style={{ background: 'rgba(26,32,53,0.5)' }} onClick={onClose}>
      <div className="relative w-full md:max-w-[1040px] max-h-[92vh] bg-white rounded-2xl border border-[#E4E6EE] shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* header */}
        <div className="flex items-start justify-between gap-3 px-6 py-4 text-white" style={{ background: ACCENT }}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-white/80 text-xs"><TypeBadge type={r.ticket_type} small /><span className="font-bold tracking-wide">{r.ticket_key}</span><span>·</span><span>{r.ticket_type || 'Task'}</span>{r.customer_id && <><span>·</span><span>{customerName(r.customer_id)}</span></>}</div>
            {editTitle ? (
              <input autoFocus value={title} onChange={e => setTitle(e.target.value)} onBlur={async () => { setEditTitle(false); if (title.trim() && title.trim() !== r.task_name) await onPatch({ task_name: title.trim() }, 'Title saved') }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setTitle(r.task_name); setEditTitle(false) } }}
                className="mt-1 w-full bg-white/15 border border-white/40 rounded-lg px-2 py-1 text-lg font-bold text-white focus:outline-none" />
            ) : (
              <h2 className="text-xl font-bold leading-tight break-words mt-0.5 cursor-text group" onClick={() => setEditTitle(true)} title="Click to edit title">{r.task_name || '—'} <span className="opacity-0 group-hover:opacity-70 text-sm font-normal">✎</span></h2>
            )}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Pill text={r.status || 'Backlog'} color={statusColor(r.status)} />
              <span className="text-[11px] font-semibold rounded-full px-2.5 py-0.5" style={{ background: 'rgba(255,255,255,0.22)' }}>{r.priority || 'Medium'}</span>
              {due && <span className={`text-[11px] font-semibold rounded-full px-2.5 py-0.5 ${due.overdue ? 'bg-red-500' : 'bg-white/20'}`}>{due.overdue ? '⚠ Overdue · ' : 'Due '}{due.str}</span>}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end max-w-[46%]">
            {r.status === 'Backlog' && <button onClick={() => onStatus('In Progress')} className={hdrBtn}>▶ Start</button>}
            {r.status === 'In Progress' && <button onClick={() => onStatus('Review')} className={hdrBtn}>Send to review</button>}
            {!isDone && <button onClick={() => onStatus('Done')} className={hdrBtn + ' hover:bg-emerald-500'}>✓ Done</button>}
            {isDone && <button onClick={() => onStatus('In Progress')} className={hdrBtn}>↩ Reopen</button>}
            <ShareLink id={r.id} className={hdrBtn} />
            <button onClick={onArchive} className={hdrBtn} title="Archive">▣</button>
            <button onClick={onDelete} className={hdrBtn + ' hover:bg-red-500'} title="Delete">🗑</button>
            <button data-ro-ok onClick={onClose} className="text-white/80 hover:text-white text-2xl leading-none pl-1">&times;</button>
          </div>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid md:grid-cols-[1fr_300px]">
            <div className="px-6 py-5 space-y-6 min-w-0">
              {/* description */}
              <section>
                <div className="flex items-center justify-between mb-1.5"><p className="text-[11px] uppercase tracking-wide text-gray-400">Description</p>{!editDesc && <button onClick={() => setEditDesc(true)} className="text-xs text-gray-400 hover:text-gray-700">✎ Edit</button>}</div>
                {editDesc ? (
                  <div>
                    <textarea autoFocus rows={6} value={desc} onChange={e => setDesc(e.target.value)} className={inp} placeholder="Context, steps to reproduce, acceptance criteria…" />
                    <div className="flex gap-2 mt-2">
                      <button onClick={async () => { const ok = await onPatch({ description: desc.trim() || null }, 'Description saved'); if (ok) setEditDesc(false) }} className="text-sm px-3 py-1.5 rounded-lg text-white font-semibold" style={{ background: ACCENT }}>Save</button>
                      <button onClick={() => { setDesc(r.description || ''); setEditDesc(false) }} className="text-sm px-3 py-1.5 rounded-lg border border-[#E4E6EE] text-gray-600">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div onClick={() => setEditDesc(true)} className="text-sm text-gray-800 whitespace-pre-wrap break-words rounded-lg border border-transparent hover:border-[#E4E6EE] hover:bg-[#FAFBFD] -mx-2 px-2 py-1.5 cursor-text min-h-[44px]">{r.description || <span className="text-gray-300">Add a description…</span>}</div>
                )}
                {r.notes && <div className="mt-3 rounded-lg bg-[#FFFBEB] border border-[#FDE68A] px-3 py-2 text-xs text-[#92400E] whitespace-pre-wrap"><b>Notes:</b> {r.notes}</div>}
              </section>
              <section className="border-t border-[#EEF0F4] pt-4"><FileUpload supabase={sb} recordType="tasks" recordId={r.id} currentUserEmail={userEmail} /></section>
              <section className="border-t border-[#EEF0F4] pt-4">
                <Comments recordId={r.id} recordType="task" currentUserEmail={userEmail} title="Comments" />
                <ItemHistory recordId={r.id} recordType="task" />
              </section>
            </div>

            {/* sidebar */}
            <aside className="bg-[#F8F9FC] border-t md:border-t-0 md:border-l border-[#EEF0F4] px-5 py-5 space-y-4 text-sm">
              <Field label="Status"><select className={inpSm} value={r.status || 'Backlog'} onChange={e => onStatus(e.target.value)}>{STATUSES.map(s => <option key={s}>{s}</option>)}{!STATUSES.includes(r.status as any) && r.status && <option>{r.status}</option>}</select></Field>
              <Field label="Assignee">
                <div className="flex items-center gap-2">
                  {r.assigned_to ? <Avatar name={r.assigned_to} member={assignee} size={26} /> : <span className="w-[26px] h-[26px] rounded-full border border-dashed border-gray-300 inline-block shrink-0" />}
                  <select className={inpSm} value={r.assigned_to || ''} onChange={e => onPatch({ assigned_to: e.target.value || null }, e.target.value ? `Assigned to ${e.target.value.split(' ')[0]} — they've been notified` : 'Unassigned')}>
                    <option value="">Unassigned</option>{assigneeOptions.map(n => <option key={n} value={n}>{n}{me && n === me.full_name ? ' (me)' : ''}</option>)}
                  </select>
                </div>
                {me && assignee?.email !== me.email && <button onClick={() => onPatch({ assigned_to: me.full_name }, 'Assigned to you')} className="text-xs mt-1.5 font-semibold" style={{ color: ACCENT }}>Assign to me</button>}
              </Field>
              <Field label="Reporter"><div className="flex items-center gap-2">{r.reporter ? <><Avatar name={r.reporter} member={reporter} size={22} /><span className="text-gray-700 text-xs">{reporter?.full_name || r.reporter}</span></> : <span className="text-gray-300">—</span>}</div></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Priority"><select className={inpSm} value={r.priority || 'Medium'} onChange={e => onPatch({ priority: e.target.value }, 'Priority saved')}>{PRIORITIES.map(s => <option key={s}>{s}</option>)}</select></Field>
                <Field label="Type"><select className={inpSm} value={r.ticket_type || 'Task'} onChange={e => onPatch({ ticket_type: e.target.value }, 'Type saved')}>{TYPES.map(s => <option key={s}>{s}</option>)}</select></Field>
              </div>
              <Field label="Due date"><input type="date" className={inpSm} value={r.due_date || ''} onChange={e => onPatch({ due_date: e.target.value || null }, 'Due date saved')} /></Field>
              <Field label="Labels">
                <div className="flex flex-wrap gap-1 mb-1.5">{(r.labels || []).map(l => <span key={l} className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white border border-[#E4E6EE] text-gray-600 inline-flex items-center gap-1">{l}<button onClick={() => onPatch({ labels: (r.labels || []).filter(x => x !== l) })} className="text-gray-400 hover:text-red-500">×</button></span>)}</div>
                <input className={inpSm} value={labelDraft} onChange={e => setLabelDraft(e.target.value)} placeholder="Add label + Enter" onKeyDown={async e => { if (e.key === 'Enter' && labelDraft.trim()) { e.preventDefault(); const l = labelDraft.trim(); if (!(r.labels || []).includes(l)) await onPatch({ labels: [...(r.labels || []), l] }); setLabelDraft('') } }} />
              </Field>
              <Field label="Linked customer"><select className={inpSm} value={r.customer_id || ''} onChange={e => onPatch({ customer_id: e.target.value || null }, 'Customer saved')}><option value="">— None —</option>{customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select></Field>
              {isDone && <Field label="Resolution"><select className={inpSm} value={r.resolution || 'Done'} onChange={e => onPatch({ resolution: e.target.value }, 'Resolution saved')}>{RESOLUTIONS.map(s => <option key={s}>{s}</option>)}</select></Field>}
              {r.points_earned != null && r.points_earned > 0 && <Field label="beyondWorld points"><span className="font-semibold text-[#1A1D2E]">{r.points_earned}</span></Field>}
              <div className="border-t border-[#EEF0F4] pt-3 text-[11px] text-gray-400 space-y-1">
                <p>Created {fmtStamp(r.created_at)}{r.reporter ? ` by ${(reporter?.full_name || r.reporter).split(' ')[0]}` : ''}</p>
                {r.started_at && <p>Started {fmtStamp(r.started_at)}</p>}
                {r.completed_at && <p>Completed {fmtStamp(r.completed_at)}</p>}
                <p>Updated {ago(r.updated_at)}</p>
                {r.reviewed_at ? <p>Acknowledged by {(resolveMember(r.reviewed_by)?.full_name || r.reviewed_by || '').split(' ')[0]} · {fmtStamp(r.reviewed_at)}</p> : <p>Not yet acknowledged by assignee</p>}
                {r.linked_record_type && <p>Linked to {r.linked_record_type}</p>}
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  )
}
