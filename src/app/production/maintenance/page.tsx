'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import Comments from '@/components/Comments'
import FileUpload from '@/components/FileUpload'
import ShareLink from '@/components/ShareLink'
import { useItemDeepLink } from '@/components/useItemDeepLink'
import ItemHistory from '@/components/ItemHistory'
import { useToast } from '@/components/Toast'
import { usePermissions } from '@/lib/permissions'

/* ═══════════════════════════════════════════════════════════════════════════
   Maintenance Requests — anyone files a request (phone-friendly), it lands with the
   default maintenance lead (or whoever is picked), and the database emails + pings
   the assignee the moment it is assigned. Completion emails the requester back.
   ═══════════════════════════════════════════════════════════════════════ */

const ACCENT = '#0F7A4E'
const COLUMNS = ['Open', 'Assigned', 'In Progress', 'On Hold', 'Completed'] as const
const STATUSES = ['Open', 'Assigned', 'In Progress', 'On Hold', 'Completed', 'Cancelled'] as const
const CATEGORIES = ['Mechanical', 'Electrical', 'Facility', 'Supplies', 'Safety', 'Plumbing', 'IT / Network', 'Cleaning', 'Other'] as const
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const
const CLOSED = new Set(['Completed', 'Cancelled'])
const DONE_WINDOW_DAYS = 30

const STATUS_COLORS: Record<string, string> = { Open: '#9699a6', Assigned: '#579bfc', 'In Progress': '#a25ddc', 'On Hold': '#fdab3d', Completed: '#00c875', Cancelled: '#c4c4c4' }
const PRIORITY_COLORS: Record<string, string> = { Low: '#00c875', Medium: '#579bfc', High: '#fdab3d', Critical: '#e2445c' }
const PRIORITY_RANK: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 }
const CATEGORY_ICON: Record<string, string> = { Mechanical: '⚙️', Electrical: '⚡', Facility: '🏭', Supplies: '🧻', Safety: '🦺', Plumbing: '🚰', 'IT / Network': '🖥️', Cleaning: '🧹', Other: '🔧' }
const statusColor = (s: string | null | undefined) => (s && STATUS_COLORS[s]) || '#c4c4c4'
const priorityColor = (p: string | null | undefined) => (p && PRIORITY_COLORS[p]) || '#c4c4c4'

const initials = (name: string) => (name || '').split(/[\s@._]+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase()
const avatarColor = (name: string) => {
  const palette = ['#5559df', '#00c875', '#579bfc', '#a25ddc', '#fdab3d', '#037f4c', '#ff6d3b', '#bb3354', '#00a89b', '#7e3b8a']
  let h = 0; for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}
const fmtStamp = (d: string | null | undefined) => d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
function dueMeta(d: string | null, status: string | null) {
  if (!d) return null
  const date = new Date(d + 'T00:00:00'); const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.ceil((date.getTime() - today.getTime()) / 86400000)
  const closed = CLOSED.has(status || '')
  return { str: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), overdue: !closed && diff < 0, today: !closed && diff === 0 }
}
const ago = (iso: string | null | undefined) => {
  if (!iso) return ''
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

interface TeamMember { id: string; email: string; full_name: string; avatar_color: string; avatar_initials: string | null }
interface Machine { id: string; name: string; machine_code: string | null; location: string | null }
interface MRequest {
  id: string; request_number: string | null; title: string; description: string | null; category: string; priority: string; status: string
  location: string | null; machine_id: string | null; asset_name: string | null; downtime: boolean; requested_by: string | null; assigned_to: string | null
  due_date: string | null; started_at: string | null; completed_at: string | null; resolution: string | null; parts_used: string | null; cost: number | null
  email_sent_at: string | null; last_email_status: string | null; created_at: string; updated_at: string
}

const inp = 'w-full bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F7A4E]/40'
const inpSm = 'w-full bg-white border border-[#E4E6EE] rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F7A4E]/40'
const Avatar = ({ name, member, size = 24 }: { name: string; member?: TeamMember | null; size?: number }) => (
  <span title={member?.full_name || name} className="rounded-full inline-flex items-center justify-center text-white font-bold shrink-0"
    style={{ width: size, height: size, fontSize: Math.round(size * 0.4), background: member?.avatar_color || avatarColor(member?.full_name || name) }}>
    {member?.avatar_initials || initials(member?.full_name || name)}
  </span>
)
const Pill = ({ text, color }: { text: string; color: string }) => <span className="text-white text-[11px] font-semibold rounded-full px-2.5 py-0.5 inline-block whitespace-nowrap" style={{ background: color }}>{text}</span>
const Down = ({ small }: { small?: boolean }) => <span className={`font-extrabold tracking-wide rounded px-1.5 py-0.5 bg-red-600 text-white ${small ? 'text-[9px]' : 'text-[10px]'}`}>DOWN</span>

// ─────────────────────────────────────────── New request window
function NewRequestModal({ open, onClose, onCreated, sb, team, machines, me, defaultAssignee }: {
  open: boolean; onClose: () => void; onCreated: (id: string) => void; sb: any; team: TeamMember[]; machines: Machine[]; me: TeamMember | null; defaultAssignee: string | null
}) {
  const empty = { title: '', category: 'Mechanical', priority: 'Medium', downtime: false, machine_id: '', location: '', description: '', assigned_to: '', due_date: '' }
  const [form, setForm] = useState<any>(empty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setForm(empty); setError('') } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const defaultMember = team.find(m => m.email.toLowerCase() === (defaultAssignee || '').toLowerCase())

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError('')
    if (!form.title.trim()) { setError('Tell us what is wrong — a short title is required.'); return }
    setSaving(true)
    try {
      const m = machines.find(x => x.id === form.machine_id)
      const row = {
        title: form.title.trim(), category: form.category, priority: form.downtime && form.priority === 'Low' ? 'Medium' : form.priority, downtime: !!form.downtime,
        machine_id: form.machine_id || null, asset_name: m?.name || null, location: form.location?.trim() || m?.location || null,
        description: form.description?.trim() || null, assigned_to: form.assigned_to || null, due_date: form.due_date || null, requested_by: me?.email || null,
      }
      const { data, error } = await sb.from('maintenance_requests').insert(row).select('id').single()
      if (error) { setError(error.message); return }
      onClose(); onCreated(data?.id)
    } finally { setSaving(false) }
  }
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4" style={{ background: 'rgba(26,32,53,0.5)' }} onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[92vh] overflow-y-auto border border-[#E4E6EE]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 text-white rounded-t-2xl" style={{ background: ACCENT }}>
          <div><p className="text-white/70 text-[11px] uppercase tracking-wide">Maintenance</p><h2 className="font-bold text-lg leading-tight">New request</h2></div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={submit} className="p-5 sm:p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded text-sm">{error}</div>}
          <label className="block"><span className="text-xs font-medium text-gray-600">What&apos;s wrong? *</span><input className={inp} value={form.title} onChange={e => setForm((f: any) => ({ ...f, title: e.target.value }))} placeholder="e.g. Extruder 2 belt squealing, bag sealer not heating" autoFocus /></label>
          <label className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 cursor-pointer ${form.downtime ? 'border-red-300 bg-red-50' : 'border-[#E4E6EE] bg-white'}`}>
            <input type="checkbox" className="w-5 h-5 accent-red-600" checked={form.downtime} onChange={e => setForm((f: any) => ({ ...f, downtime: e.target.checked }))} />
            <span className="text-sm"><b className={form.downtime ? 'text-red-700' : 'text-[#1A1D2E]'}>Equipment is down</b><span className="text-gray-500"> — production is stopped or blocked by this</span></span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-xs font-medium text-gray-600">Category</span><select className={inp} value={form.category} onChange={e => setForm((f: any) => ({ ...f, category: e.target.value }))}>{CATEGORIES.map(s => <option key={s} value={s}>{CATEGORY_ICON[s]} {s}</option>)}</select></label>
            <label className="block"><span className="text-xs font-medium text-gray-600">Priority</span><select className={inp} value={form.priority} onChange={e => setForm((f: any) => ({ ...f, priority: e.target.value }))}>{PRIORITIES.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-xs font-medium text-gray-600">Machine / asset</span>
              <select className={inp} value={form.machine_id} onChange={e => setForm((f: any) => ({ ...f, machine_id: e.target.value }))}><option value="">— Not a machine —</option>{machines.map(m => <option key={m.id} value={m.id}>{m.name}{m.location ? ` · ${m.location}` : ''}</option>)}</select>
            </label>
            <label className="block"><span className="text-xs font-medium text-gray-600">Location / area</span><input className={inp} value={form.location} onChange={e => setForm((f: any) => ({ ...f, location: e.target.value }))} placeholder="Bags dept, dock 2, break room…" /></label>
          </div>
          <label className="block"><span className="text-xs font-medium text-gray-600">Details</span><textarea rows={3} className={inp} value={form.description} onChange={e => setForm((f: any) => ({ ...f, description: e.target.value }))} placeholder="What happened, when it started, anything already tried. Photos can be added right after you submit." /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-xs font-medium text-gray-600">Send to</span>
              <select className={inp} value={form.assigned_to} onChange={e => setForm((f: any) => ({ ...f, assigned_to: e.target.value }))}>
                <option value="">{defaultMember ? `Default — ${defaultMember.full_name}` : defaultAssignee ? `Default — ${defaultAssignee}` : 'Unassigned (no default set)'}</option>
                {team.map(m => <option key={m.id} value={m.email}>{m.full_name}</option>)}
              </select>
            </label>
            <label className="block"><span className="text-xs font-medium text-gray-600">Needed by</span><input type="date" className={inp} value={form.due_date} onChange={e => setForm((f: any) => ({ ...f, due_date: e.target.value }))} /></label>
          </div>
          <p className="text-[11px] text-gray-400">The person it goes to gets an email and an in-app alert the moment you submit.</p>
          <div className="flex gap-2 pt-2 border-t border-gray-100">
            <button type="submit" disabled={saving} className="flex-1 text-white font-semibold py-2.5 rounded-lg disabled:opacity-50" style={{ background: ACCENT }}>{saving ? 'Submitting…' : 'Submit request'}</button>
            <button type="button" onClick={onClose} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-800 font-medium py-2.5 rounded-lg">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────── Page
export default function MaintenancePage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const { toast } = useToast()
  const perms = usePermissions()
  const [rows, setRows] = useState<MRequest[]>([])
  const [team, setTeam] = useState<TeamMember[]>([])
  const [machines, setMachines] = useState<Machine[]>([])
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({})
  const [fileCounts, setFileCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'board' | 'list'>('board')
  const [q, setQ] = useState('')
  const [filterAssignee, setFilterAssignee] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [mine, setMine] = useState(false)
  const [showAllDone, setShowAllDone] = useState(false)
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'updated_at', dir: -1 })
  const [detail, setDetail] = useState<MRequest | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const [defaultAssignee, setDefaultAssignee] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    const [{ data: r }, { data: tm }, { data: mc }, { data: st }] = await Promise.all([
      sb.from('maintenance_requests').select('*').order('created_at', { ascending: false }),
      sb.from('user_profiles').select('id,email,full_name,avatar_color,avatar_initials').eq('is_active', true).order('full_name'),
      sb.from('machines').select('id,name,machine_code,location').eq('is_active', true).order('name'),
      sb.rpc('maintenance_settings'),
    ])
    const list = (r as MRequest[]) || []
    setRows(list)
    if (tm) setTeam(tm as TeamMember[])
    if (mc) setMachines(mc as Machine[])
    setDefaultAssignee((st as any)?.default_assignee || null)
    const ids = list.map(x => x.id)
    if (ids.length) {
      const [{ data: cm }, { data: fa }] = await Promise.all([
        sb.from('comments').select('record_id').eq('record_type', 'maintenance_request').in('record_id', ids),
        sb.from('file_attachments').select('record_id').eq('record_type', 'maintenance_requests').in('record_id', ids),
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
  useEffect(() => {
    const ch = sb.channel('maintenance-live').on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance_requests' }, () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current)
      reloadTimer.current = setTimeout(() => load(true), 400)
    }).subscribe()
    return () => { sb.removeChannel(ch) }
  }, [sb, load])
  useEffect(() => { if (detail) { const fresh = rows.find(r => r.id === detail.id); if (fresh && fresh !== detail) setDetail(fresh) } }, [rows]) // eslint-disable-line react-hooks/exhaustive-deps

  const me = useMemo(() => team.find(m => m.email.toLowerCase() === userEmail.toLowerCase()) || null, [team, userEmail])
  const member = useCallback((email: string | null | undefined) => email ? team.find(m => m.email.toLowerCase() === email.toLowerCase()) || null : null, [team])
  const displayName = (email: string | null | undefined) => member(email)?.full_name || email || ''
  const isMine = (r: MRequest) => !!userEmail && (r.assigned_to || '').toLowerCase() === userEmail.toLowerCase()

  const openDetail = useCallback((r: MRequest) => setDetail(r), [])
  useItemDeepLink(rows, (r: MRequest) => openDetail(r))

  const match = (r: MRequest) => {
    if (mine && !isMine(r)) return false
    if (filterAssignee && (r.assigned_to || '').toLowerCase() !== filterAssignee.toLowerCase()) return false
    if (filterCategory && r.category !== filterCategory) return false
    if (filterPriority && r.priority !== filterPriority) return false
    if (filterStatus && r.status !== filterStatus) return false
    if (CLOSED.has(r.status) && !showAllDone && !q) {
      const t = new Date(r.completed_at || r.updated_at || r.created_at).getTime()
      if (Date.now() - t > DONE_WINDOW_DAYS * 86400000) return false
    }
    if (!q) return true
    const s = q.toLowerCase()
    return [r.request_number, r.title, r.description, r.asset_name, r.location, r.category, displayName(r.assigned_to), displayName(r.requested_by)].some(v => String(v ?? '').toLowerCase().includes(s))
  }
  const visible = useMemo(() => rows.filter(match), [rows, q, filterAssignee, filterCategory, filterPriority, filterStatus, mine, showAllDone, team, userEmail]) // eslint-disable-line react-hooks/exhaustive-deps

  const columnSort = (a: MRequest, b: MRequest) => {
    if (a.downtime !== b.downtime) return a.downtime ? -1 : 1
    const pr = (PRIORITY_RANK[b.priority] || 0) - (PRIORITY_RANK[a.priority] || 0)
    if (pr) return pr
    if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1
    if (!!a.due_date !== !!b.due_date) return a.due_date ? -1 : 1
    return (a.created_at || '').localeCompare(b.created_at || '')
  }
  const columns = useMemo(() => {
    const present = new Set(visible.map(r => r.status || 'Open'))
    const cols: string[] = [...COLUMNS]
    for (const s of present) if (!cols.includes(s)) cols.push(s)
    return cols.map(key => ({ key, color: statusColor(key), items: visible.filter(r => (r.status || 'Open') === key).sort(CLOSED.has(key) ? (a, b) => (b.completed_at || b.updated_at || '').localeCompare(a.completed_at || a.updated_at || '') : columnSort) }))
  }, [visible])

  const listRows = useMemo(() => {
    const dir = sort.dir
    const val = (r: MRequest): any => {
      switch (sort.key) {
        case 'number': return parseInt((r.request_number || '').replace(/\D/g, '') || '0', 10)
        case 'priority': return (r.downtime ? 10 : 0) + (PRIORITY_RANK[r.priority] || 0)
        case 'due': return r.due_date || (dir === 1 ? '9999' : '')
        case 'status': return COLUMNS.indexOf(r.status as any)
        case 'assignee': return displayName(r.assigned_to)
        case 'title': return r.title || ''
        case 'category': return r.category || ''
        default: return r.updated_at || r.created_at || ''
      }
    }
    return [...visible].sort((a, b) => { const x = val(a), y = val(b); return x < y ? -dir : x > y ? dir : 0 })
  }, [visible, sort, team]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggleSort = (key: string) => setSort(s => s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === 'updated_at' ? -1 : 1 })

  const openRows = rows.filter(r => !CLOSED.has(r.status))
  const kpi = {
    open: openRows.length, down: openRows.filter(r => r.downtime).length, inProgress: rows.filter(r => r.status === 'In Progress').length,
    overdue: rows.filter(r => dueMeta(r.due_date, r.status)?.overdue).length,
    completed30: rows.filter(r => r.status === 'Completed' && Date.now() - new Date(r.completed_at || r.updated_at).getTime() <= 30 * 86400000).length,
  }

  async function patch(id: string, fields: Record<string, any>, okMsg?: string) {
    const prev = rows.find(r => r.id === id)
    setRows(rs => rs.map(r => r.id === id ? { ...r, ...fields } : r))
    const { error } = await sb.from('maintenance_requests').update(fields).eq('id', id)
    if (error) { toast('Save failed: ' + error.message, 'error'); if (prev) setRows(rs => rs.map(r => r.id === id ? prev : r)); return false }
    if (okMsg) toast(okMsg)
    return true
  }
  async function setStatus(r: MRequest, status: string) {
    if (r.status === status) return
    if (status === 'Assigned' && !r.assigned_to) { toast('Pick an assignee first — Assigned means someone owns it.', 'warning'); return }
    await patch(r.id, { status }, `${r.request_number} → ${status}`)
  }
  async function remove(r: MRequest) {
    if (!confirm(`Delete ${r.request_number} "${r.title}"? This cannot be undone.`)) return
    await sb.rpc('delete_record_comments', { p_record_type: 'maintenance_request', p_record_id: r.id })
    await sb.from('file_attachments').delete().eq('record_type', 'maintenance_requests').eq('record_id', r.id)
    const { error } = await sb.from('maintenance_requests').delete().eq('id', r.id)
    if (error) { toast('Delete failed: ' + error.message, 'error'); return }
    setRows(rs => rs.filter(x => x.id !== r.id)); setDetail(null); toast('Request deleted')
  }
  async function saveDefaultAssignee(email: string) {
    const { error } = await sb.rpc('maintenance_set_default_assignee', { p_email: email || null })
    if (error) { toast(error.message, 'error'); return }
    setDefaultAssignee(email || null); toast(email ? `New requests now go to ${displayName(email)}` : 'Default assignee cleared')
  }
  function onDrop(status: string) {
    const id = dragId; setDragId(null); setDragOver(null)
    if (!id) return
    const r = rows.find(x => x.id === id)
    if (r) setStatus(r, status)
  }

  const chip = (active: boolean) => `px-3 py-1.5 rounded-lg border text-sm font-medium shrink-0 transition-colors ${active ? 'bg-[#1A1D2E] text-white border-[#1A1D2E]' : 'bg-white text-gray-500 border-[#E4E6EE] hover:border-[#D0D3E0]'}`

  const Card = ({ r }: { r: MRequest }) => {
    const m = member(r.assigned_to); const due = dueMeta(r.due_date, r.status)
    const nc = commentCounts[r.id] || 0, nf = fileCounts[r.id] || 0
    return (
      <div id={'item-' + r.id} draggable onDragStart={e => { e.dataTransfer.setData('text/plain', r.id); e.dataTransfer.effectAllowed = 'move'; setDragId(r.id) }} onDragEnd={() => { setDragId(null); setDragOver(null) }}
        onClick={() => openDetail(r)}
        className={`bg-white rounded-xl border p-3 cursor-pointer hover:shadow-md transition-all select-none ${r.downtime && !CLOSED.has(r.status) ? 'border-red-300' : 'border-[#E4E6EE] hover:border-[#C7CBE0]'} ${dragId === r.id ? 'opacity-40' : ''}`}>
        <div className="flex items-start gap-2">
          <span className="text-base leading-none mt-0.5" title={r.category}>{CATEGORY_ICON[r.category] || '🔧'}</span>
          <p className={`text-[13px] font-semibold leading-snug flex-1 ${CLOSED.has(r.status) ? 'text-gray-400 line-through' : 'text-[#1A1D2E]'}`}>{r.title}</p>
          {r.downtime && !CLOSED.has(r.status) && <Down small />}
        </div>
        {(r.asset_name || r.location) && <p className="text-[11px] text-gray-500 mt-1.5 truncate">{[r.asset_name, r.location].filter(Boolean).join(' · ')}</p>}
        <div className="flex items-center gap-2 mt-2.5">
          <span className="text-[11px] font-bold text-gray-400 tracking-wide">{r.request_number}</span>
          <span className="w-2 h-2 rounded-full" title={r.priority} style={{ background: priorityColor(r.priority) }} />
          {due && <span className={`text-[11px] font-semibold ${due.overdue ? 'text-red-600' : due.today ? 'text-amber-600' : 'text-gray-400'}`}>{due.overdue ? '⚠ ' : ''}{due.str}</span>}
          <span className="ml-auto flex items-center gap-2 text-[11px] text-gray-400">
            {nf > 0 && <span>📎{nf}</span>}{nc > 0 && <span>💬{nc}</span>}
            {r.assigned_to ? <Avatar name={r.assigned_to} member={m} size={22} /> : <span className="w-[22px] h-[22px] rounded-full border border-dashed border-gray-300 inline-block" title="Unassigned" />}
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <span className="mon-tag" style={{ background: ACCENT + '22', color: ACCENT }}>🛠 Maintenance</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">Maintenance Requests</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${kpi.open} open${kpi.down ? ` · ${kpi.down} with equipment down` : ''} · the assignee is emailed the moment a request lands with them`}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {perms.is_admin && (
            <label className="flex items-center gap-2 text-xs text-gray-500 bg-white border border-[#E4E6EE] rounded-lg px-2.5 py-1.5">
              <span className="whitespace-nowrap">New requests go to</span>
              <select data-ro-ok value={defaultAssignee || ''} onChange={e => saveDefaultAssignee(e.target.value)} className="text-sm font-medium text-[#1A1D2E] bg-transparent focus:outline-none">
                <option value="">— nobody (set this!) —</option>{team.map(m => <option key={m.id} value={m.email}>{m.full_name}</option>)}
              </select>
            </label>
          )}
          <div className="flex rounded-lg border border-[#E4E6EE] bg-white p-0.5">
            {(['board', 'list'] as const).map(v => <button key={v} data-ro-ok onClick={() => setView(v)} className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${view === v ? 'text-white' : 'text-gray-500 hover:text-gray-800'}`} style={view === v ? { background: ACCENT } : undefined}>{v === 'board' ? '▦ Board' : '☰ List'}</button>)}
          </div>
          <button onClick={() => setShowAdd(true)} className="text-white font-semibold rounded-lg px-4 py-2 text-sm shadow-sm hover:opacity-90" style={{ background: ACCENT }}>+ New Request</button>
        </div>
      </div>

      {!loading && !defaultAssignee && perms.is_admin && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-sm px-4 py-3">No default assignee yet — requests filed without a name sit in <b>Open</b> and nobody is emailed. Pick the maintenance lead in the selector above.</div>
      )}

      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
          {[
            { label: 'Open', value: kpi.open, color: ACCENT, on: () => { setMine(false); setFilterStatus('') } },
            { label: 'Equipment down', value: kpi.down, color: '#e2445c', on: () => { setView('list'); setFilterStatus(''); setSort({ key: 'priority', dir: -1 }) } },
            { label: 'In Progress', value: kpi.inProgress, color: '#a25ddc', on: () => { setView('list'); setFilterStatus('In Progress') } },
            { label: 'Overdue', value: kpi.overdue, color: '#fdab3d', on: () => { setView('list'); setFilterStatus(''); setSort({ key: 'due', dir: 1 }) } },
            { label: 'Completed · 30d', value: kpi.completed30, color: '#00c875', on: () => { setView('list'); setFilterStatus('Completed') } },
          ].map(s => (
            <button key={s.label} data-ro-ok onClick={s.on} className="text-left bg-white rounded-xl border border-[#ECEEF3] px-5 py-3.5 hover:border-[#C7CBE0] transition-colors">
              <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
              <p className="text-sm text-gray-500 mt-0.5">{s.label}</p>
            </button>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search requests, machines, people…" className="bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm w-full sm:w-72 focus:outline-none focus:ring-2 focus:ring-[#0F7A4E]/40" />
        <select data-ro-ok value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="bg-white border border-[#E4E6EE] rounded-lg px-2.5 py-2 text-sm"><option value="">All categories</option>{CATEGORIES.map(t => <option key={t}>{t}</option>)}</select>
        <select data-ro-ok value={filterPriority} onChange={e => setFilterPriority(e.target.value)} className="bg-white border border-[#E4E6EE] rounded-lg px-2.5 py-2 text-sm"><option value="">All priorities</option>{PRIORITIES.map(t => <option key={t}>{t}</option>)}</select>
        {view === 'list' && <select data-ro-ok value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="bg-white border border-[#E4E6EE] rounded-lg px-2.5 py-2 text-sm"><option value="">All statuses</option>{STATUSES.map(t => <option key={t}>{t}</option>)}</select>}
        <button data-ro-ok onClick={() => setMine(m => !m)} className={chip(mine)}>Mine</button>
        <button data-ro-ok onClick={() => setShowAllDone(v => !v)} className={chip(showAllDone)}>{showAllDone ? 'All closed shown' : `Closed · last ${DONE_WINDOW_DAYS}d`}</button>
        {(q || filterCategory || filterPriority || filterStatus || filterAssignee || mine) && <button data-ro-ok onClick={() => { setQ(''); setFilterCategory(''); setFilterPriority(''); setFilterStatus(''); setFilterAssignee(''); setMine(false) }} className="text-sm text-gray-400 hover:text-gray-700 px-2">Clear</button>}
      </div>
      {!loading && team.length > 0 && (
        <div className="flex gap-2 items-center mb-4 overflow-x-auto pb-1">
          <span className="text-sm text-gray-400 shrink-0 mr-1">Assignee:</span>
          <button data-ro-ok onClick={() => setFilterAssignee('')} className={chip(!filterAssignee)}>All</button>
          {team.filter(m => rows.some(r => (r.assigned_to || '').toLowerCase() === m.email.toLowerCase()) || m.email.toLowerCase() === (defaultAssignee || '').toLowerCase()).map(m => (
            <button key={m.email} data-ro-ok onClick={() => setFilterAssignee(p => p === m.email ? '' : m.email)} className={`flex items-center gap-2 ${chip(filterAssignee === m.email)}`}>
              <Avatar name={m.full_name} member={m} size={22} />{m.full_name.split(' ')[0]}
            </button>
          ))}
        </div>
      )}

      {view === 'board' && (
        <div className="flex gap-3 overflow-x-auto pb-4 -mx-1 px-1 items-start">
          {columns.map(col => (
            <div key={col.key} onDragOver={e => { e.preventDefault(); if (dragOver !== col.key) setDragOver(col.key) }} onDragLeave={() => setDragOver(d => d === col.key ? null : d)} onDrop={e => { e.preventDefault(); onDrop(col.key) }}
              className={`w-[272px] shrink-0 rounded-2xl border bg-[#F6F7FB] p-2.5 transition-colors ${dragOver === col.key && dragId ? 'border-[#0F7A4E] bg-[#ECF7F1]' : 'border-[#ECEEF3]'}`} style={{ minHeight: 160 }}>
              <div className="flex items-center gap-2 px-1.5 pb-2.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: col.color }} />
                <span className="font-bold text-[13px] text-[#1A1D2E]">{col.key}</span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: col.color + '26', color: col.color }}>{col.items.length}</span>
                {col.key === 'Open' && <button onClick={() => setShowAdd(true)} className="ml-auto text-gray-400 hover:text-gray-700 text-lg leading-none" title="New request">+</button>}
              </div>
              <div className="space-y-2 max-h-[68vh] overflow-y-auto pr-0.5">
                {col.items.map(r => <Card key={r.id} r={r} />)}
                {col.items.length === 0 && <div className="text-center text-xs text-gray-400 py-6 border border-dashed border-[#E4E6EE] rounded-xl">{dragId ? 'Drop here' : 'Nothing here'}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'list' && (
        <div className="bg-white rounded-xl shadow-sm border border-[#ECEEF3] overflow-x-auto">
          <table className="w-full text-sm min-w-[980px]">
            <thead>
              <tr className="text-[11px] uppercase text-gray-400 border-b border-[#EEF0F4] bg-[#FBFCFE]">
                <SortTh k="number" label="#" w="w-[90px]" /><SortTh k="title" label="Request" /><SortTh k="category" label="Category" w="w-[120px]" /><SortTh k="assignee" label="Assignee" w="w-[160px]" />
                <SortTh k="priority" label="Priority" w="w-[110px]" /><SortTh k="status" label="Status" w="w-[120px]" /><SortTh k="due" label="Needed by" w="w-[100px]" /><SortTh k="updated_at" label="Updated" w="w-[100px]" />
              </tr>
            </thead>
            <tbody>
              {listRows.map((r, i) => {
                const due = dueMeta(r.due_date, r.status)
                return (
                  <tr key={r.id} id={'item-' + r.id} className={`cursor-pointer hover:bg-[#F2F6FF] ${i % 2 ? 'bg-[#F8FAFC]' : 'bg-white'}`} onClick={() => openDetail(r)}>
                    <td className="px-3 py-2.5 font-bold text-gray-500 text-xs">{r.request_number}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">{r.downtime && !CLOSED.has(r.status) && <Down small />}<span className={`font-semibold ${CLOSED.has(r.status) ? 'line-through text-gray-400' : 'text-[#1A1D2E]'}`}>{r.title}</span></div>
                      {(r.asset_name || r.location) && <span className="text-[11px] text-gray-400">{[r.asset_name, r.location].filter(Boolean).join(' · ')}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-600">{CATEGORY_ICON[r.category] || ''} {r.category}</td>
                    <td className="px-3 py-2.5">{r.assigned_to ? <span className="flex items-center gap-1.5"><Avatar name={r.assigned_to} member={member(r.assigned_to)} size={22} /><span className="text-gray-600 text-xs truncate max-w-[110px]">{displayName(r.assigned_to)}</span></span> : <span className="text-gray-300">Unassigned</span>}</td>
                    <td className="px-3 py-2.5"><Pill text={r.priority} color={priorityColor(r.priority)} /></td>
                    <td className="px-3 py-2.5"><Pill text={r.status} color={statusColor(r.status)} /></td>
                    <td className="px-3 py-2.5">{due ? <span className={`text-xs font-semibold ${due.overdue ? 'text-red-600' : due.today ? 'text-amber-600' : 'text-gray-500'}`}>{due.overdue ? '⚠ ' : ''}{due.str}</span> : <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-400">{ago(r.updated_at)}</td>
                  </tr>
                )
              })}
              {listRows.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 text-sm">{loading ? 'Loading…' : 'No requests match.'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <RequestWindow r={detail} sb={sb} team={team} machines={machines} userEmail={userEmail} me={me} member={member} isAdmin={perms.is_admin}
          onClose={() => setDetail(null)} onPatch={(f, msg) => patch(detail.id, f, msg)} onStatus={s => setStatus(detail, s)} onDelete={() => remove(detail)} />
      )}
      <NewRequestModal open={showAdd} onClose={() => setShowAdd(false)} sb={sb} team={team} machines={machines} me={me} defaultAssignee={defaultAssignee}
        onCreated={async (id) => { toast('Request submitted — add photos below if you have them'); await load(true); if (id) { const { data } = await sb.from('maintenance_requests').select('*').eq('id', id).single(); if (data) setDetail(data as MRequest) } }} />
    </div>
  )
}

// ─────────────────────────────────────────── Request window
function RequestWindow({ r, sb, team, machines, userEmail, me, member, isAdmin, onClose, onPatch, onStatus, onDelete }: {
  r: MRequest; sb: any; team: TeamMember[]; machines: Machine[]; userEmail: string; me: TeamMember | null; member: (e: string | null | undefined) => TeamMember | null; isAdmin: boolean
  onClose: () => void; onPatch: (f: Record<string, any>, msg?: string) => Promise<boolean>; onStatus: (s: string) => void; onDelete: () => void
}) {
  const [editTitle, setEditTitle] = useState(false)
  const [title, setTitle] = useState(r.title)
  const [editDesc, setEditDesc] = useState(false)
  const [desc, setDesc] = useState(r.description || '')
  const [closing, setClosing] = useState(false)
  const [res, setRes] = useState({ resolution: r.resolution || '', parts_used: r.parts_used || '', cost: r.cost != null ? String(r.cost) : '' })
  useEffect(() => { setTitle(r.title); setDesc(r.description || ''); setEditTitle(false); setEditDesc(false); setRes({ resolution: r.resolution || '', parts_used: r.parts_used || '', cost: r.cost != null ? String(r.cost) : '' }) }, [r.id, r.title, r.description, r.resolution, r.parts_used, r.cost])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey); const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])
  const assignee = member(r.assigned_to), requester = member(r.requested_by)
  const closed = CLOSED.has(r.status)
  const due = dueMeta(r.due_date, r.status)
  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <div><p className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">{label}</p>{children}</div>
  const hdrBtn = 'text-xs font-semibold rounded-lg px-3 py-1.5 bg-white/15 hover:bg-white/25 transition-colors disabled:opacity-50'

  async function complete() {
    const ok = await onPatch({ status: 'Completed', resolution: res.resolution.trim() || null, parts_used: res.parts_used.trim() || null, cost: res.cost ? Number(res.cost) : null }, `${r.request_number} completed — requester notified`)
    if (ok) setClosing(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6" style={{ background: 'rgba(26,32,53,0.5)' }} onClick={onClose}>
      <div className="relative w-full md:max-w-[1040px] max-h-[92vh] bg-white rounded-2xl border border-[#E4E6EE] shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-6 py-4 text-white" style={{ background: r.downtime && !closed ? '#B91C1C' : ACCENT }}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-white/80 text-xs"><span className="font-bold tracking-wide">{r.request_number}</span><span>·</span><span>{CATEGORY_ICON[r.category]} {r.category}</span>{r.downtime && !closed && <><span>·</span><Down /></>}</div>
            {editTitle ? (
              <input autoFocus value={title} onChange={e => setTitle(e.target.value)} onBlur={async () => { setEditTitle(false); if (title.trim() && title.trim() !== r.title) await onPatch({ title: title.trim() }, 'Title saved') }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setTitle(r.title); setEditTitle(false) } }}
                className="mt-1 w-full bg-white/15 border border-white/40 rounded-lg px-2 py-1 text-lg font-bold text-white focus:outline-none" />
            ) : (
              <h2 className="text-xl font-bold leading-tight break-words mt-0.5 cursor-text group" onClick={() => setEditTitle(true)} title="Click to edit">{r.title} <span className="opacity-0 group-hover:opacity-70 text-sm font-normal">✎</span></h2>
            )}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Pill text={r.status} color={statusColor(r.status)} />
              <span className="text-[11px] font-semibold rounded-full px-2.5 py-0.5" style={{ background: 'rgba(255,255,255,0.22)' }}>{r.priority}</span>
              {(r.asset_name || r.location) && <span className="text-[11px] font-semibold rounded-full px-2.5 py-0.5 bg-white/20">{[r.asset_name, r.location].filter(Boolean).join(' · ')}</span>}
              {due && <span className={`text-[11px] font-semibold rounded-full px-2.5 py-0.5 ${due.overdue ? 'bg-black/30' : 'bg-white/20'}`}>{due.overdue ? '⚠ Overdue · ' : 'Needed by '}{due.str}</span>}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end max-w-[46%]">
            {(r.status === 'Open' || r.status === 'Assigned') && <button onClick={() => onStatus('In Progress')} className={hdrBtn}>▶ Start work</button>}
            {!closed && <button onClick={() => setClosing(true)} className={hdrBtn + ' hover:bg-emerald-500'}>✓ Complete</button>}
            {closed && <button onClick={() => onStatus('In Progress')} className={hdrBtn}>↩ Reopen</button>}
            <ShareLink id={r.id} className={hdrBtn} />
            {isAdmin && <button onClick={onDelete} className={hdrBtn + ' hover:bg-red-500'} title="Delete">🗑</button>}
            <button data-ro-ok onClick={onClose} className="text-white/80 hover:text-white text-2xl leading-none pl-1">&times;</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {closing && (
            <div className="m-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="font-semibold text-emerald-900 text-sm mb-2">Complete {r.request_number} — what was done?</p>
              <textarea rows={3} className={inp} placeholder="Resolution (what you fixed / replaced / adjusted)" value={res.resolution} onChange={e => setRes(s => ({ ...s, resolution: e.target.value }))} autoFocus />
              <div className="grid grid-cols-2 gap-3 mt-2">
                <input className={inp} placeholder="Parts used (optional)" value={res.parts_used} onChange={e => setRes(s => ({ ...s, parts_used: e.target.value }))} />
                <input className={inp} type="number" step="0.01" placeholder="Cost $ (optional)" value={res.cost} onChange={e => setRes(s => ({ ...s, cost: e.target.value }))} />
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={complete} className="text-sm px-4 py-2 rounded-lg text-white font-semibold" style={{ background: '#15803D' }}>Mark Completed</button>
                <button onClick={() => setClosing(false)} className="text-sm px-4 py-2 rounded-lg border border-[#E4E6EE] text-gray-600 bg-white">Cancel</button>
              </div>
              <p className="text-[11px] text-emerald-800/70 mt-2">{r.requested_by ? `${requester?.full_name || r.requested_by} will get a completion email.` : 'No requester on file — no completion email will go out.'}</p>
            </div>
          )}
          <div className="grid md:grid-cols-[1fr_300px]">
            <div className="px-6 py-5 space-y-6 min-w-0">
              <section>
                <div className="flex items-center justify-between mb-1.5"><p className="text-[11px] uppercase tracking-wide text-gray-400">Details</p>{!editDesc && <button onClick={() => setEditDesc(true)} className="text-xs text-gray-400 hover:text-gray-700">✎ Edit</button>}</div>
                {editDesc ? (
                  <div>
                    <textarea autoFocus rows={5} value={desc} onChange={e => setDesc(e.target.value)} className={inp} />
                    <div className="flex gap-2 mt-2">
                      <button onClick={async () => { const ok = await onPatch({ description: desc.trim() || null }, 'Details saved'); if (ok) setEditDesc(false) }} className="text-sm px-3 py-1.5 rounded-lg text-white font-semibold" style={{ background: ACCENT }}>Save</button>
                      <button onClick={() => { setDesc(r.description || ''); setEditDesc(false) }} className="text-sm px-3 py-1.5 rounded-lg border border-[#E4E6EE] text-gray-600">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div onClick={() => setEditDesc(true)} className="text-sm text-gray-800 whitespace-pre-wrap break-words rounded-lg border border-transparent hover:border-[#E4E6EE] hover:bg-[#FAFBFD] -mx-2 px-2 py-1.5 cursor-text min-h-[44px]">{r.description || <span className="text-gray-300">Add details…</span>}</div>
                )}
                {closed && (r.resolution || r.parts_used || r.cost != null) && (
                  <div className="mt-3 rounded-lg bg-[#F0FBF4] border border-[#CDEAD9] px-3 py-2 text-sm text-[#14532D]">
                    <p className="text-[11px] uppercase tracking-wide text-[#15803D] mb-1">Resolution</p>
                    {r.resolution && <p className="whitespace-pre-wrap">{r.resolution}</p>}
                    {(r.parts_used || r.cost != null) && <p className="text-xs mt-1 text-[#166534]">{r.parts_used ? `Parts: ${r.parts_used}` : ''}{r.parts_used && r.cost != null ? ' · ' : ''}{r.cost != null ? `Cost: $${Number(r.cost).toFixed(2)}` : ''}</p>}
                  </div>
                )}
              </section>
              <section className="border-t border-[#EEF0F4] pt-4">
                <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-2">Photos &amp; files</p>
                <FileUpload supabase={sb} recordType="maintenance_requests" recordId={r.id} currentUserEmail={userEmail} accept="image/*,.pdf,.doc,.docx,.xlsx,.mp4,.mov" />
              </section>
              <section className="border-t border-[#EEF0F4] pt-4">
                <Comments recordId={r.id} recordType="maintenance_request" currentUserEmail={userEmail} title="Updates & comments" />
                <ItemHistory recordId={r.id} recordType="maintenance_request" />
              </section>
            </div>
            <aside className="bg-[#F8F9FC] border-t md:border-t-0 md:border-l border-[#EEF0F4] px-5 py-5 space-y-4 text-sm">
              <Field label="Status"><select className={inpSm} value={r.status} onChange={e => e.target.value === 'Completed' ? setClosing(true) : onStatus(e.target.value)}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select></Field>
              <Field label="Assigned to">
                <div className="flex items-center gap-2">
                  {r.assigned_to ? <Avatar name={r.assigned_to} member={assignee} size={26} /> : <span className="w-[26px] h-[26px] rounded-full border border-dashed border-gray-300 inline-block shrink-0" />}
                  <select className={inpSm} value={r.assigned_to || ''} onChange={e => onPatch({ assigned_to: e.target.value || null }, e.target.value ? `Sent to ${(member(e.target.value)?.full_name || e.target.value).split(' ')[0]} — email + alert on the way` : 'Unassigned')}>
                    <option value="">Unassigned</option>{team.map(m => <option key={m.id} value={m.email}>{m.full_name}{me && m.email === me.email ? ' (me)' : ''}</option>)}
                    {r.assigned_to && !assignee && <option value={r.assigned_to}>{r.assigned_to}</option>}
                  </select>
                </div>
                {me && assignee?.email !== me.email && <button onClick={() => onPatch({ assigned_to: me.email }, 'Assigned to you')} className="text-xs mt-1.5 font-semibold" style={{ color: ACCENT }}>Take this one</button>}
                {r.last_email_status && <p className="text-[11px] text-gray-400 mt-1.5">✉ {r.last_email_status}{r.email_sent_at ? ` · ${fmtStamp(r.email_sent_at)}` : ''}</p>}
              </Field>
              <Field label="Requested by"><div className="flex items-center gap-2">{r.requested_by ? <><Avatar name={r.requested_by} member={requester} size={22} /><span className="text-gray-700 text-xs">{requester?.full_name || r.requested_by}</span></> : <span className="text-gray-300">—</span>}</div></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Priority"><select className={inpSm} value={r.priority} onChange={e => onPatch({ priority: e.target.value }, 'Priority saved')}>{PRIORITIES.map(s => <option key={s}>{s}</option>)}</select></Field>
                <Field label="Category"><select className={inpSm} value={r.category} onChange={e => onPatch({ category: e.target.value }, 'Category saved')}>{CATEGORIES.map(s => <option key={s}>{s}</option>)}</select></Field>
              </div>
              <Field label="Equipment down?">
                <button onClick={() => onPatch({ downtime: !r.downtime }, r.downtime ? 'Marked as running' : 'Marked as DOWN')} className={`w-full text-left rounded-lg border px-3 py-2 text-sm font-semibold ${r.downtime ? 'border-red-300 bg-red-50 text-red-700' : 'border-[#E4E6EE] bg-white text-gray-600'}`}>{r.downtime ? '⛔ Yes — production impacted' : 'No — running'}</button>
              </Field>
              <Field label="Machine / asset">
                <select className={inpSm} value={r.machine_id || ''} onChange={e => { const m = machines.find(x => x.id === e.target.value); onPatch({ machine_id: e.target.value || null, asset_name: m?.name || null }, 'Asset saved') }}>
                  <option value="">— Not a machine —</option>{machines.map(m => <option key={m.id} value={m.id}>{m.name}{m.location ? ` · ${m.location}` : ''}</option>)}
                </select>
              </Field>
              <Field label="Location / area"><input className={inpSm} defaultValue={r.location || ''} key={r.id + (r.location || '')} onBlur={e => { if (e.target.value.trim() !== (r.location || '')) onPatch({ location: e.target.value.trim() || null }, 'Location saved') }} placeholder="Where is it?" /></Field>
              <Field label="Needed by"><input type="date" className={inpSm} value={r.due_date || ''} onChange={e => onPatch({ due_date: e.target.value || null }, 'Date saved')} /></Field>
              <div className="border-t border-[#EEF0F4] pt-3 text-[11px] text-gray-400 space-y-1">
                <p>Filed {fmtStamp(r.created_at)}</p>
                {r.started_at && <p>Work started {fmtStamp(r.started_at)}</p>}
                {r.completed_at && <p>Completed {fmtStamp(r.completed_at)}</p>}
                <p>Updated {ago(r.updated_at)}</p>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  )
}
