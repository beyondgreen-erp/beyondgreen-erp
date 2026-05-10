'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import TagInput, { TagInputHandle } from '@/components/TagInput'
import ImportExportBar from '@/components/ImportExportBar'
import FileUpload from '@/components/FileUpload'
import CommentSection from '@/components/CommentSection'

interface Customer { id: string; company_name: string }
interface TeamMember { id: string; email: string; full_name: string; avatar_color: string; avatar_initials: string | null }
interface Task {
  id: string; task_name: string; assigned_to: string | null; due_date: string | null
  priority: string; status: string; customer_id: string | null; notes: string | null
  is_active: boolean; group_name: string | null; description: string | null
}

const PRIORITIES = ['Low', 'Medium', 'High', 'Critical']
const STATUSES = ['Backlog', 'In Progress', 'Review', 'Done', 'Blocked', 'On Hold', 'Archived']
const GROUPS = ['Current', 'Waiting Final Approval', 'On-Going', 'Completed']
const GROUP_ORDER = ['Current', 'Waiting Final Approval', 'On-Going', 'Completed']

const PC: Record<string, string> = {
  Low: 'bg-gray-700/40 text-gray-400 border-gray-700',
  Medium: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  High: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
  Critical: 'bg-red-500/15 text-red-400 border-red-500/20',
}
const SC: Record<string, string> = {
  Backlog: 'bg-gray-700/40 text-gray-400 border-gray-700',
  'In Progress': 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  Review: 'bg-violet-500/15 text-violet-400 border-violet-500/20',
  Done: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  Blocked: 'bg-red-500/15 text-red-400 border-red-500/20',
  'On Hold': 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  Archived: 'bg-gray-800/60 text-gray-600 border-gray-700/50',
}
const STATUS_HEX: Record<string, string> = {
  'In Progress': '#3b82f6', Done: '#10b981', Backlog: '#6b7280',
  'On Hold': '#f59e0b', Review: '#8b5cf6', Blocked: '#ef4444', Archived: '#374151',
}

const empty = { task_name: '', assigned_to: '', due_date: '', priority: 'Medium', status: 'Backlog', customer_id: '', notes: '', group_name: 'Current' }
type F = typeof empty

function dbErr(e: { code?: string; message: string; hint?: string }) {
  return [e.message, e.code && `(${e.code})`, e.hint && `Hint: ${e.hint}`].filter(Boolean).join(' — ')
}
function fmtDue(d: string | null) {
  if (!d) return null
  const date = new Date(d + 'T00:00:00')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return { str: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), overdue: date < today }
}

export default function TasksPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<Task[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterAssignee, setFilterAssignee] = useState('')
  const [filterGroup, setFilterGroup] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [form, setForm] = useState<F>(empty)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [assigneeOpen, setAssigneeOpen] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set(['Completed']))
  const [userEmail, setUserEmail] = useState('')
  const tagRef = useRef<TagInputHandle>(null)
  const drawerRef = useRef<HTMLDivElement>(null)

  async function load() {
    setLoading(true)
    const [{ data: t }, { data: c }, { data: tm }] = await Promise.all([
      sb.from('tasks').select('*').eq('is_active', true).order('task_name'),
      sb.from('customers').select('id,company_name').eq('is_active', true).order('company_name'),
      sb.from('user_profiles').select('id,email,full_name,avatar_color,avatar_initials').eq('is_active', true).order('full_name'),
    ])
    if (t) setRows(t as Task[])
    if (c) setCustomers(c as Customer[])
    if (tm) setTeamMembers(tm as TeamMember[])
    setLoading(false)
  }
  useEffect(() => {
    load()
    sb.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email) })
  }, []) // eslint-disable-line

  const memberMap = useMemo(() => Object.fromEntries(teamMembers.map(m => [m.email, m])), [teamMembers])

  const personStats = useMemo(() => {
    const stats: Record<string, { member: TeamMember; total: number; byStatus: Record<string, number> }> = {}
    for (const r of rows) {
      if (!r.assigned_to || !memberMap[r.assigned_to]) continue
      if (!stats[r.assigned_to]) stats[r.assigned_to] = { member: memberMap[r.assigned_to], total: 0, byStatus: {} }
      stats[r.assigned_to].total++
      stats[r.assigned_to].byStatus[r.status] = (stats[r.assigned_to].byStatus[r.status] ?? 0) + 1
    }
    return Object.values(stats).sort((a, b) => b.total - a.total)
  }, [rows, memberMap])

  const filtered = useMemo(() => rows.filter(r => {
    if (filterStatus && r.status !== filterStatus) return false
    if (filterAssignee && r.assigned_to !== filterAssignee) return false
    if (filterGroup && (r.group_name ?? '') !== filterGroup) return false
    if (search) {
      const q = search.toLowerCase()
      return r.task_name.toLowerCase().includes(q) || (r.assigned_to ?? '').toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q)
    }
    return true
  }), [rows, filterStatus, filterAssignee, filterGroup, search])

  const grouped = useMemo(() => {
    const g: Record<string, Task[]> = {}
    for (const name of GROUP_ORDER) g[name] = []
    for (const r of filtered) {
      const key = r.group_name && GROUP_ORDER.includes(r.group_name) ? r.group_name : 'Other'
      if (!g[key]) g[key] = []
      g[key].push(r)
    }
    return g
  }, [filtered])

  const groupKeys = [...GROUP_ORDER, ...(grouped['Other']?.length ? ['Other'] : [])]

  function toggleGroup(g: string) {
    setCollapsedGroups(prev => {
      const n = new Set(prev)
      if (n.has(g)) { n.delete(g) } else { n.add(g) }
      return n
    })
  }
  function selectPerson(email: string) { setFilterAssignee(p => p === email ? '' : email) }
  function openAdd() { setEditing(null); setForm(empty); setErr(''); setOpen(true) }
  function openEdit(r: Task) {
    setEditing(r)
    setForm({ task_name: r.task_name, assigned_to: r.assigned_to ?? '', due_date: r.due_date ?? '', priority: r.priority, status: r.status, customer_id: r.customer_id ?? '', notes: r.notes ?? '', group_name: r.group_name ?? 'Current' })
    setErr(''); setOpen(true)
  }
  function close() { setOpen(false); setAssigneeOpen(false); setTimeout(() => { setEditing(null); setForm(empty) }, 300) }


  async function save() {
    if (!form.task_name.trim()) { setErr('Task Name is required.'); return }
    setErr(''); setSaving(true)
    const p = { task_name: form.task_name.trim(), assigned_to: form.assigned_to.trim() || null, due_date: form.due_date || null, priority: form.priority, status: form.status, customer_id: form.customer_id || null, notes: form.notes.trim() || null, group_name: form.group_name || null }
    const { error } = editing
      ? await sb.from('tasks').update({ ...p, updated_at: new Date().toISOString() }).eq('id', editing.id)
      : await sb.from('tasks').insert({ ...p, is_active: true })
    if (error) { setErr(dbErr(error)); setSaving(false); return }
    setSaving(false); await tagRef.current?.sendNotifications(); close(); load()
  }
  async function toggleArchive() {
    if (!editing) return
    setBusy(true)
    await sb.from('tasks').update({ is_active: !editing.is_active, updated_at: new Date().toISOString() }).eq('id', editing.id)
    setBusy(false); close(); load()
  }

  const inp = 'w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition'
  const sel = inp + ' cursor-pointer'
  const hasFilters = !!(search || filterStatus || filterAssignee || filterGroup)
  const selectedMember = filterAssignee ? memberMap[filterAssignee] : null

  return (
    <div className="p-4 md:p-8 min-h-screen">

      {/* ── Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-violet-500/20 text-violet-300 border-violet-500/30">BUSINESS DEV</span>
          <h1 className="text-2xl font-semibold text-white mt-2">Task Board</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {loading ? 'Loading…' : selectedMember
              ? `${filtered.length} task${filtered.length !== 1 ? 's' : ''} assigned to ${selectedMember.full_name}`
              : `${filtered.length} of ${rows.length} tasks`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ImportExportBar table="tasks" filename="tasks" columns={[
            { header: 'Task Name', dbKey: 'task_name', example: 'Follow up on proposal', required: true },
            { header: 'Assigned To', dbKey: 'assigned_to', example: 'john@beyondgreen.com' },
            { header: 'Due Date', dbKey: 'due_date', example: '2024-02-15' },
            { header: 'Priority', dbKey: 'priority', example: 'Medium' },
            { header: 'Status', dbKey: 'status', example: 'Backlog' },
            { header: 'Group', dbKey: 'group_name', example: 'Current' },
            { header: 'Notes', dbKey: 'notes', example: '' },
          ]} onImportDone={load} />
          <button onClick={openAdd} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors whitespace-nowrap">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
            Add Task
          </button>
        </div>
      </div>

      {/* ── Team strip ── */}
      {!loading && personStats.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-semibold text-gray-600 tracking-widest mb-3">TEAM</p>
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
            {/* All */}
            <button
              onClick={() => setFilterAssignee('')}
              className={`flex-shrink-0 flex flex-col items-center gap-2 px-4 py-3 rounded-xl border transition-all ${!filterAssignee ? 'bg-gray-800 border-gray-600' : 'bg-gray-900 border-gray-800 hover:border-gray-700 hover:bg-gray-800/50'}`}
            >
              <div className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center">
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>
                </svg>
              </div>
              <div className="text-center">
                <p className={`text-xs font-semibold ${!filterAssignee ? 'text-white' : 'text-gray-500'}`}>All</p>
                <p className="text-xs text-gray-600">{rows.length}</p>
              </div>
            </button>

            {personStats.map(({ member, total, byStatus }) => {
              const isSelected = filterAssignee === member.email
              const topStatuses = Object.entries(byStatus).sort((a, b) => b[1] - a[1]).slice(0, 4)
              const inProgress = byStatus['In Progress'] ?? 0
              const done = byStatus['Done'] ?? 0
              return (
                <button
                  key={member.email}
                  onClick={() => selectPerson(member.email)}
                  className={`flex-shrink-0 flex flex-col items-center gap-2 px-4 py-3 rounded-xl border transition-all min-w-[96px] ${isSelected ? 'bg-gray-800 border-gray-500' : 'bg-gray-900 border-gray-800 hover:border-gray-700 hover:bg-gray-800/50'}`}
                >
                  <div className="relative">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: member.avatar_color }}>
                      {member.avatar_initials || member.full_name[0]}
                    </div>
                    {isSelected && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-400 rounded-full border-2 border-gray-800"/>}
                  </div>
                  <div className="text-center">
                    <p className={`text-xs font-semibold truncate max-w-[80px] ${isSelected ? 'text-white' : 'text-gray-400'}`}>{member.full_name.split(' ')[0]}</p>
                    <p className="text-xs text-gray-600">{total} tasks</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap justify-center">
                    {inProgress > 0 && <span className="text-xs text-blue-400 font-medium">{inProgress} active</span>}
                    {done > 0 && <span className="text-xs text-emerald-600">{done} done</span>}
                  </div>
                  {/* Mini status bar */}
                  <div className="flex gap-0.5 w-full h-1 rounded-full overflow-hidden">
                    {topStatuses.map(([status, count]) => (
                      <div key={status} className="h-full rounded-full" style={{ backgroundColor: STATUS_HEX[status] ?? '#6b7280', flex: count }}/>
                    ))}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Filter bar ── */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          <input placeholder="Search tasks…" value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-gray-900 border border-gray-800 text-white placeholder-gray-600 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 transition"/>
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="bg-gray-900 border border-gray-800 text-gray-400 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 cursor-pointer">
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterGroup} onChange={e => setFilterGroup(e.target.value)} className="bg-gray-900 border border-gray-800 text-gray-400 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 cursor-pointer">
          <option value="">All Groups</option>
          {GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        {hasFilters && (
          <button onClick={() => { setSearch(''); setFilterStatus(''); setFilterAssignee(''); setFilterGroup('') }} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-white transition-colors px-2 py-2 rounded-lg hover:bg-gray-800">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
            Clear
          </button>
        )}
      </div>

      {/* ── Task sections ── */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <svg className="w-6 h-6 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <svg className="w-12 h-12 text-gray-800" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
          </svg>
          <p className="text-gray-500 text-sm">{hasFilters ? 'No tasks match your filters.' : 'No tasks yet.'}</p>
          {hasFilters && (
            <button onClick={() => { setSearch(''); setFilterStatus(''); setFilterAssignee(''); setFilterGroup('') }} className="text-violet-400 hover:text-violet-300 text-sm transition-colors">
              Clear all filters
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {groupKeys.map(groupName => {
            const tasks = grouped[groupName]
            if (!tasks || tasks.length === 0) return null
            const collapsed = collapsedGroups.has(groupName)
            const statusCounts: Record<string, number> = {}
            for (const t of tasks) statusCounts[t.status] = (statusCounts[t.status] ?? 0) + 1
            const topStatuses = Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).slice(0, 3)

            return (
              <div key={groupName} className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
                <button onClick={() => toggleGroup(groupName)} className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-800/30 transition-colors">
                  <div className="flex items-center gap-3">
                    <svg className={`w-4 h-4 text-gray-600 transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
                    </svg>
                    <span className="text-white font-semibold text-sm">{groupName}</span>
                    <span className="text-xs bg-gray-800 text-gray-500 px-2 py-0.5 rounded-full">{tasks.length}</span>
                  </div>
                  <div className="hidden sm:flex items-center gap-4 pr-1">
                    {topStatuses.map(([status, count]) => (
                      <div key={status} className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_HEX[status] ?? '#6b7280' }}/>
                        <span className="text-xs text-gray-600">{count} {status}</span>
                      </div>
                    ))}
                  </div>
                </button>

                {!collapsed && (
                  <div className="border-t border-gray-800/60 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-800/40">
                          <th className="text-left text-xs font-semibold text-gray-600 px-5 py-2.5 w-[38%]">Task</th>
                          <th className="text-left text-xs font-semibold text-gray-600 px-4 py-2.5">Assigned To</th>
                          <th className="text-left text-xs font-semibold text-gray-600 px-4 py-2.5">Status</th>
                          <th className="text-left text-xs font-semibold text-gray-600 px-4 py-2.5">Priority</th>
                          <th className="text-left text-xs font-semibold text-gray-600 px-4 py-2.5">Due</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tasks.map(r => {
                          const member = r.assigned_to ? memberMap[r.assigned_to] : null
                          const due = fmtDue(r.due_date)
                          return (
                            <tr
                              key={r.id}
                              onClick={() => openEdit(r)}
                              className="border-b border-gray-800/30 last:border-0 cursor-pointer hover:bg-gray-800/50 transition-colors group"
                            >
                              <td className="px-5 py-3.5">
                                <p className="text-white text-sm font-medium group-hover:text-violet-300 transition-colors line-clamp-1">{r.task_name}</p>
                                {r.description && <p className="text-gray-600 text-xs mt-0.5 line-clamp-1">{r.description}</p>}
                              </td>
                              <td className="px-4 py-3.5">
                                {member ? (
                                  <div className="flex items-center gap-2">
                                    <span className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ backgroundColor: member.avatar_color }}>
                                      {member.avatar_initials || member.full_name[0]}
                                    </span>
                                    <span className="text-gray-400 text-sm truncate">{member.full_name.split(' ')[0]}</span>
                                  </div>
                                ) : <span className="text-gray-700">—</span>}
                              </td>
                              <td className="px-4 py-3.5">
                                <span className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium border ${SC[r.status] ?? SC.Backlog}`}>{r.status}</span>
                              </td>
                              <td className="px-4 py-3.5">
                                <span className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium border ${PC[r.priority] ?? PC.Medium}`}>{r.priority}</span>
                              </td>
                              <td className="px-4 py-3.5 whitespace-nowrap">
                                {due ? (
                                  <span className={`text-xs font-medium ${due.overdue && r.status !== 'Done' ? 'text-red-400' : 'text-gray-500'}`}>
                                    {due.overdue && r.status !== 'Done' && '⚠ '}{due.str}
                                  </span>
                                ) : <span className="text-gray-700 text-xs">—</span>}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Backdrop ── */}
      <div onClick={close} className={`fixed inset-0 bg-black/60 z-40 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}/>

      {/* ── Slide-out drawer ── */}
      <div
        ref={drawerRef}
        onClick={(e) => e.stopPropagation()}
        className={`fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-full w-full md:max-w-md bg-gray-950 border-l border-gray-800 z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-800 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-lg">{editing ? 'Edit Task' : 'New Task'}</h2>
            {editing && <p className="text-gray-600 text-xs mt-0.5 truncate max-w-[280px]">{editing.task_name}</p>}
          </div>
          <button onClick={close} className="text-gray-500 hover:text-white p-1.5 rounded-lg hover:bg-gray-800 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Task Name <span className="text-red-400">*</span></label>
            <input value={form.task_name} onChange={e => setForm(p => ({ ...p, task_name: e.target.value }))} placeholder="What needs to be done?" className={inp}/>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Status</label>
              <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))} className={sel}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Priority</label>
              <select value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))} className={sel}>
                {PRIORITIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="flex gap-2">
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${SC[form.status] ?? SC.Backlog}`}>{form.status}</span>
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${PC[form.priority] ?? PC.Medium}`}>{form.priority}</span>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Group</label>
            <select value={form.group_name} onChange={e => setForm(p => ({ ...p, group_name: e.target.value }))} className={sel}>
              {GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>

          <div className="relative">
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Assigned To</label>
            <button type="button" onClick={() => setAssigneeOpen(v => !v)} className={inp + ' cursor-pointer flex items-center gap-2.5 text-left'}>
              {form.assigned_to ? (() => {
                const m = teamMembers.find(m => m.email === form.assigned_to)
                return m ? (
                  <><span className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ backgroundColor: m.avatar_color }}>{m.avatar_initials || m.full_name[0]}</span><span className="flex-1 text-white">{m.full_name}</span></>
                ) : <span className="text-gray-500 flex-1">{form.assigned_to}</span>
              })() : <span className="text-gray-500 flex-1">— Unassigned —</span>}
              <svg className={`w-4 h-4 text-gray-500 shrink-0 transition-transform ${assigneeOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
            </button>
            {assigneeOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden z-10 shadow-xl max-h-52 overflow-y-auto">
                <button type="button" onClick={() => { setForm(p => ({ ...p, assigned_to: '' })); setAssigneeOpen(false) }} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-gray-500 hover:bg-gray-700 transition-colors text-left">— Unassigned —</button>
                {teamMembers.map(m => (
                  <button key={m.id} type="button" onClick={() => { setForm(p => ({ ...p, assigned_to: m.email })); setAssigneeOpen(false) }} className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-gray-700 transition-colors text-left ${form.assigned_to === m.email ? 'bg-violet-600/20 text-white' : 'text-gray-300'}`}>
                    <span className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ backgroundColor: m.avatar_color }}>{m.avatar_initials || m.full_name[0]}</span>
                    {m.full_name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Due Date</label>
            <input type="date" value={form.due_date} onChange={e => setForm(p => ({ ...p, due_date: e.target.value }))} className={inp}/>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Linked Customer</label>
            <select value={form.customer_id} onChange={e => setForm(p => ({ ...p, customer_id: e.target.value }))} className={sel}>
              <option value="">— None —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Notes</label>
            <TagInput ref={tagRef} value={form.notes} onChange={v => setForm(p => ({ ...p, notes: v }))} page="Tasks" className={inp + ' resize-none'}/>
          </div>

          {editing && (
            <>
              <div className="border-t border-gray-800 pt-5">
                <FileUpload supabase={sb} recordType="tasks" recordId={editing.id} currentUserEmail={userEmail} />
              </div>
              <div className="border-t border-gray-800 pt-5">
                <CommentSection recordType="tasks" recordId={editing.id} currentUserEmail={userEmail} />
              </div>
            </>
          )}
        </div>

        <div className="shrink-0 px-6 py-4 border-t border-gray-800 space-y-3">
          {err && (
            <div className="flex gap-2 items-start bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5">
              <svg className="w-4 h-4 text-red-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              <p className="text-red-400 text-xs">{err}</p>
            </div>
          )}
          <div className="flex gap-3">
            {editing && (
              <button onClick={toggleArchive} disabled={busy} className="text-sm px-3 py-2.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600 transition-colors disabled:opacity-50 shrink-0">
                {editing.is_active ? 'Archive' : 'Restore'}
              </button>
            )}
            <button onClick={close} className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600 transition-colors">
              Cancel
            </button>
            <button onClick={save} disabled={saving} className="flex-1 flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
              {saving ? <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Saving…</> : editing ? 'Save Changes' : 'Create Task'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
