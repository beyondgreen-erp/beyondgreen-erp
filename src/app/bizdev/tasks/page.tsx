'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import TagInput, { TagInputHandle } from '@/components/TagInput'
import ImportExportBar from '@/components/ImportExportBar'
import FileUpload from '@/components/FileUpload'
import CommentSection from '@/components/CommentSection'
import { useMultiSelect } from '@/hooks/useMultiSelect'
import BulkActionBar from '@/components/BulkActionBar'

interface Customer { id: string; company_name: string }
interface TeamMember { id: string; email: string; full_name: string; avatar_color: string; avatar_initials: string | null }
interface Task {
  id: string; task_name: string; assigned_to: string | null; due_date: string | null
  priority: string; status: string; customer_id: string | null; notes: string | null
  is_active: boolean; group_name: string | null; description: string | null
}

const PRIORITIES = ['Low', 'Medium', 'High', 'Critical']
const STATUSES   = ['Backlog', 'In Progress', 'Review', 'Done', 'Blocked', 'On Hold', 'Archived']
const GROUPS     = ['Current', 'Waiting Final Approval', 'On-Going', 'Completed']

// Light-mode badge colours
const PC: Record<string, { bg: string; text: string; dot: string }> = {
  Low:      { bg: '#F3F4F6', text: '#6B7280', dot: '#9CA3AF' },
  Medium:   { bg: '#EFF6FF', text: '#1D4ED8', dot: '#3B82F6' },
  High:     { bg: '#FFF7ED', text: '#C2410C', dot: '#F97316' },
  Critical: { bg: '#FEF2F2', text: '#B91C1C', dot: '#EF4444' },
}
const SC: Record<string, { bg: string; text: string }> = {
  Backlog:      { bg: '#F3F4F6', text: '#6B7280' },
  'In Progress':{ bg: '#EFF6FF', text: '#1D4ED8' },
  Review:       { bg: '#F5F3FF', text: '#6D28D9' },
  Done:         { bg: '#ECFDF5', text: '#065F46' },
  Blocked:      { bg: '#FEF2F2', text: '#B91C1C' },
  'On Hold':    { bg: '#FFFBEB', text: '#92400E' },
  Archived:     { bg: '#F9FAFB', text: '#9CA3AF' },
}
// Left-border colour per priority
const PRIORITY_BORDER: Record<string, string> = {
  Critical: '#EF4444', High: '#F97316', Medium: '#3B82F6', Low: '#E4E6EE',
}

const empty = { task_name: '', assigned_to: '', due_date: '', priority: 'Medium', status: 'Backlog', customer_id: '', notes: '', group_name: 'Current' }
type F = typeof empty

function fmtDue(d: string | null) {
  if (!d) return null
  const date = new Date(d + 'T00:00:00')
  const today = new Date(); today.setHours(0,0,0,0)
  const diff  = Math.ceil((date.getTime() - today.getTime()) / 86400000)
  return {
    str:     date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    overdue: diff < 0,
    today:   diff === 0,
    soon:    diff > 0 && diff <= 3,
  }
}

// Section accent colours
const GROUP_COLOR: Record<string, { accent: string; lightBg: string }> = {
  'Current':                  { accent: '#3B6FE0', lightBg: '#EEF2FF' },
  'Waiting Final Approval':   { accent: '#D97706', lightBg: '#FFFBEB' },
  'On-Going':                 { accent: '#059669', lightBg: '#ECFDF5' },
  'Completed':                { accent: '#6B7280', lightBg: '#F9FAFB' },
}

export default function TasksPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows,        setRows]        = useState<Task[]>([])
  const [customers,   setCustomers]   = useState<Customer[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [loading,     setLoading]     = useState(true)
  const [search,      setSearch]      = useState('')
  const [filterStatus,   setFilterStatus]   = useState('')
  const [filterAssignee, setFilterAssignee] = useState('')
  const [open,    setOpen]    = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [form,    setForm]    = useState<F>(empty)
  const [saving,  setSaving]  = useState(false)
  const [busy,    setBusy]    = useState(false)
  const [err,     setErr]     = useState('')
  const [deleting,setDeleting]= useState(false)
  const [assigneeOpen, setAssigneeOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(['Completed']))
  const [userEmail, setUserEmail] = useState('')
  const ms     = useMultiSelect<Task>()
  const tagRef = useRef<TagInputHandle>(null)

  async function load() {
    setLoading(true)
    const [{ data: t }, { data: c }, { data: tm }] = await Promise.all([
      sb.from('tasks').select('*').eq('is_active', true).order('task_name'),
      sb.from('customers').select('id,company_name').eq('is_active', true).order('company_name'),
      sb.from('user_profiles').select('id,email,full_name,avatar_color,avatar_initials').eq('is_active', true).order('full_name'),
    ])
    if (t)  setRows(t as Task[])
    if (c)  setCustomers(c as Customer[])
    if (tm) setTeamMembers(tm as TeamMember[])
    setLoading(false)
  }
  useEffect(() => {
    load()
    sb.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email) })
  }, []) // eslint-disable-line

  const memberMap = useMemo(() => Object.fromEntries(teamMembers.map(m => [m.email, m])), [teamMembers])

  const filtered = useMemo(() => rows.filter(r => {
    if (filterStatus   && r.status       !== filterStatus)   return false
    if (filterAssignee && r.assigned_to  !== filterAssignee) return false
    if (search) {
      const q = search.toLowerCase()
      return r.task_name.toLowerCase().includes(q) ||
             (r.assigned_to ?? '').toLowerCase().includes(q) ||
             (r.description ?? '').toLowerCase().includes(q)
    }
    return true
  }), [rows, filterStatus, filterAssignee, search])

  const grouped = useMemo(() => {
    const g: Record<string, Task[]> = {}
    for (const n of GROUPS) g[n] = []
    for (const r of filtered) {
      const key = r.group_name && GROUPS.includes(r.group_name) ? r.group_name : 'Current'
      g[key].push(r)
    }
    return g
  }, [filtered])

  function toggleGroup(g: string) {
    setCollapsed(prev => { const n = new Set(prev); if (n.has(g)) { n.delete(g) } else { n.add(g) } return n })
  }
  function openAdd()       { setEditing(null); setForm(empty); setErr(''); setOpen(true) }
  function openEdit(r: Task) {
    setEditing(r)
    setForm({ task_name: r.task_name, assigned_to: r.assigned_to ?? '', due_date: r.due_date ?? '',
              priority: r.priority, status: r.status, customer_id: r.customer_id ?? '',
              notes: r.notes ?? '', group_name: r.group_name ?? 'Current' })
    setErr(''); setOpen(true)
  }
  function close() { setOpen(false); setAssigneeOpen(false); setTimeout(() => { setEditing(null); setForm(empty) }, 300) }

  async function save() {
    if (!form.task_name.trim()) { setErr('Task name is required.'); return }
    setErr(''); setSaving(true)
    const p = { task_name: form.task_name.trim(), assigned_to: form.assigned_to || null,
                due_date: form.due_date || null, priority: form.priority, status: form.status,
                customer_id: form.customer_id || null, notes: form.notes.trim() || null,
                group_name: form.group_name || null }
    const { error } = editing
      ? await sb.from('tasks').update({ ...p, updated_at: new Date().toISOString() }).eq('id', editing.id)
      : await sb.from('tasks').insert({ ...p, is_active: true })
    if (error) { setErr(error.message); setSaving(false); return }
    setSaving(false); await tagRef.current?.sendNotifications(); close(); load()
  }
  async function toggleArchive() {
    if (!editing) return
    setBusy(true)
    await sb.from('tasks').update({ is_active: !editing.is_active, updated_at: new Date().toISOString() }).eq('id', editing.id)
    setBusy(false); close(); load()
  }
  async function bulkDelete() {
    if (!confirm(`Delete ${ms.count} tasks? This cannot be undone.`)) return
    setDeleting(true)
    await sb.from('tasks').delete().in('id', Array.from(ms.selected))
    ms.clear(); setDeleting(false); load()
  }

  const inp = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition'
  const sel = inp + ' cursor-pointer'
  const hasFilters = !!(search || filterStatus || filterAssignee)
  const totalActive = rows.filter(r => r.status !== 'Done' && r.status !== 'Archived').length
  const totalDone   = rows.filter(r => r.status === 'Done').length

  return (
    <div className="min-h-screen" style={{ background: '#F5F6FA' }}>
      <div className="max-w-5xl mx-auto px-6 py-8">

        {/* ── Header ── */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-[#1A1D2E]">Task Board</h1>
            <p className="text-[#6B7280] mt-1">
              {loading ? 'Loading…' : `${totalActive} active · ${totalDone} done · ${rows.length} total`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ImportExportBar table="tasks" filename="tasks" columns={[
              { header: 'Task Name',   dbKey: 'task_name',   example: 'Follow up on proposal', required: true },
              { header: 'Assigned To', dbKey: 'assigned_to', example: 'john@beyondgreen.com' },
              { header: 'Due Date',    dbKey: 'due_date',    example: '2024-02-15' },
              { header: 'Priority',    dbKey: 'priority',    example: 'Medium' },
              { header: 'Status',      dbKey: 'status',      example: 'Backlog' },
              { header: 'Group',       dbKey: 'group_name',  example: 'Current' },
              { header: 'Notes',       dbKey: 'notes',       example: '' },
            ]} onImportDone={load} />
            <button
              onClick={openAdd}
              className="flex items-center gap-2 bg-[#3B6FE0] hover:bg-[#2D5EC7] text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4"/>
              </svg>
              Add Task
            </button>
          </div>
        </div>

        {/* ── Summary cards ── */}
        {!loading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            {[
              { label: 'Active',   value: totalActive,                              color: '#3B6FE0', bg: '#EEF2FF' },
              { label: 'Done',     value: totalDone,                                color: '#059669', bg: '#ECFDF5' },
              { label: 'Blocked',  value: rows.filter(r=>r.status==='Blocked').length,  color: '#DC2626', bg: '#FEF2F2' },
              { label: 'Overdue',  value: rows.filter(r=>{ if(!r.due_date||r.status==='Done')return false; return new Date(r.due_date+'T00:00:00')<new Date() }).length, color: '#D97706', bg: '#FFFBEB' },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-2xl border border-[#E4E6EE] px-5 py-4">
                <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
                <p className="text-sm text-[#6B7280] mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Team avatars ── */}
        {!loading && teamMembers.length > 0 && (
          <div className="flex gap-2 items-center mb-6 overflow-x-auto pb-1">
            <span className="text-sm text-[#9CA3AF] shrink-0 mr-1">Filter:</span>
            <button
              onClick={() => setFilterAssignee('')}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-all shrink-0 ${!filterAssignee ? 'bg-[#1A1D2E] text-white border-[#1A1D2E]' : 'bg-white text-[#6B7280] border-[#E4E6EE] hover:border-[#D0D3E0]'}`}
            >
              All
            </button>
            {teamMembers.map(m => {
              const active = filterAssignee === m.email
              return (
                <button
                  key={m.email}
                  onClick={() => setFilterAssignee(p => p === m.email ? '' : m.email)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-all shrink-0 ${active ? 'bg-[#1A1D2E] text-white border-[#1A1D2E]' : 'bg-white text-[#6B7280] border-[#E4E6EE] hover:border-[#D0D3E0]'}`}
                >
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ backgroundColor: m.avatar_color }}>
                    {m.avatar_initials || m.full_name[0]}
                  </span>
                  {m.full_name.split(' ')[0]}
                </button>
              )
            })}
          </div>
        )}

        {/* ── Search + status filter ── */}
        <div className="flex flex-wrap gap-2 mb-6">
          <div className="relative flex-1 min-w-[200px]">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
            <input
              placeholder="Search tasks…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
            />
          </div>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="bg-white border border-[#E4E6EE] text-[#6B7280] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
          >
            <option value="">All Statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {hasFilters && (
            <button
              onClick={() => { setSearch(''); setFilterStatus(''); setFilterAssignee('') }}
              className="flex items-center gap-1.5 text-sm text-[#6B7280] hover:text-[#1A1D2E] border border-[#E4E6EE] bg-white px-4 py-2.5 rounded-xl transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
              </svg>
              Clear
            </button>
          )}
        </div>

        {/* ── Task groups ── */}
        {loading ? (
          <div className="flex justify-center py-24">
            <svg className="w-6 h-6 animate-spin text-[#D0D3E0]" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="w-16 h-16 rounded-2xl bg-[#F0F1F5] flex items-center justify-center">
              <svg className="w-8 h-8 text-[#D0D3E0]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
              </svg>
            </div>
            <p className="text-[#6B7280] font-medium">{hasFilters ? 'No tasks match your filters.' : 'No tasks yet — add one to get started.'}</p>
            {hasFilters && (
              <button onClick={() => { setSearch(''); setFilterStatus(''); setFilterAssignee('') }} className="text-[#3B6FE0] hover:underline text-sm">
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {GROUPS.map(groupName => {
              const tasks = grouped[groupName]
              if (!tasks || tasks.length === 0) return null
              const isCollapsed = collapsed.has(groupName)
              const gc = GROUP_COLOR[groupName] ?? { accent: '#6B7280', lightBg: '#F9FAFB' }
              const doneCount = tasks.filter(t => t.status === 'Done').length
              const activeCount = tasks.length - doneCount

              return (
                <div key={groupName} className="bg-white rounded-2xl border border-[#E4E6EE] overflow-hidden">

                  {/* Section header */}
                  <button
                    onClick={() => toggleGroup(groupName)}
                    className="w-full flex items-center justify-between px-6 py-4 hover:bg-[#FAFAFA] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: gc.accent }}/>
                      <span className="text-[#1A1D2E] font-semibold text-base">{groupName}</span>
                      <span
                        className="text-xs font-semibold px-2.5 py-1 rounded-full"
                        style={{ background: gc.lightBg, color: gc.accent }}
                      >
                        {tasks.length}
                      </span>
                      {activeCount > 0 && doneCount > 0 && (
                        <span className="text-xs text-[#9CA3AF] hidden sm:block">
                          {activeCount} active · {doneCount} done
                        </span>
                      )}
                    </div>
                    <svg
                      className="w-5 h-5 text-[#9CA3AF] transition-transform duration-200 shrink-0"
                      style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
                    </svg>
                  </button>

                  {/* Task list */}
                  {!isCollapsed && (
                    <div className="border-t border-[#F0F1F5]">
                      {tasks.map((task, idx) => {
                        const member = task.assigned_to ? memberMap[task.assigned_to] : null
                        const due    = fmtDue(task.due_date)
                        const pc     = PC[task.priority] ?? PC.Medium
                        const sc     = SC[task.status]   ?? SC.Backlog
                        const isDone = task.status === 'Done'
                        const borderColor = PRIORITY_BORDER[task.priority] ?? '#E4E6EE'

                        return (
                          <div
                            key={task.id}
                            onClick={() => openEdit(task)}
                            className={`flex items-center gap-4 px-6 py-4 cursor-pointer transition-colors ${idx !== tasks.length - 1 ? 'border-b border-[#F0F1F5]' : ''} ${ms.isSelected(task.id) ? 'bg-blue-50' : 'hover:bg-[#FAFAFA]'}`}
                            style={{ borderLeft: `3px solid ${borderColor}` }}
                          >
                            {/* Checkbox */}
                            <div onClick={e => { e.stopPropagation(); ms.toggle(task.id) }}>
                              <input
                                type="checkbox"
                                checked={ms.isSelected(task.id)}
                                onChange={() => ms.toggle(task.id)}
                                className="w-4 h-4 accent-blue-600 cursor-pointer shrink-0"
                              />
                            </div>

                            {/* Task name + description */}
                            <div className="flex-1 min-w-0">
                              <p className={`font-medium text-sm leading-snug ${isDone ? 'line-through text-[#9CA3AF]' : 'text-[#1A1D2E]'}`}>
                                {task.task_name}
                              </p>
                              {task.description && (
                                <p className="text-xs text-[#9CA3AF] mt-0.5 truncate">{task.description}</p>
                              )}
                            </div>

                            {/* Assignee */}
                            <div className="hidden sm:flex items-center gap-2 shrink-0 w-32">
                              {member ? (
                                <>
                                  <span className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ backgroundColor: member.avatar_color }}>
                                    {member.avatar_initials || member.full_name[0]}
                                  </span>
                                  <span className="text-sm text-[#6B7280] truncate">{member.full_name.split(' ')[0]}</span>
                                </>
                              ) : (
                                <span className="text-sm text-[#D0D3E0]">—</span>
                              )}
                            </div>

                            {/* Status */}
                            <div className="hidden md:block shrink-0">
                              <span
                                className="text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap"
                                style={{ background: sc.bg, color: sc.text }}
                              >
                                {task.status}
                              </span>
                            </div>

                            {/* Priority dot */}
                            <div className="hidden lg:flex items-center gap-1.5 shrink-0 w-20">
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: pc.dot }}/>
                              <span className="text-xs font-medium" style={{ color: pc.text }}>{task.priority}</span>
                            </div>

                            {/* Due date */}
                            <div className="shrink-0 text-right w-20">
                              {due ? (
                                <span className={`text-xs font-medium ${due.overdue && !isDone ? 'text-red-500' : due.today && !isDone ? 'text-amber-500' : due.soon && !isDone ? 'text-orange-400' : 'text-[#9CA3AF]'}`}>
                                  {due.overdue && !isDone ? '⚠ ' : ''}{due.str}
                                </span>
                              ) : (
                                <span className="text-xs text-[#D0D3E0]">No date</span>
                              )}
                            </div>
                          </div>
                        )
                      })}

                      {/* Add task inline shortcut */}
                      <button
                        onClick={() => { setForm(p => ({ ...p, group_name: groupName })); openAdd() }}
                        className="w-full flex items-center gap-2 px-6 py-3 text-sm text-[#9CA3AF] hover:text-[#3B6FE0] hover:bg-[#F5F7FF] transition-colors border-t border-[#F0F1F5]"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
                        </svg>
                        Add task to {groupName}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <BulkActionBar count={ms.count} onDelete={bulkDelete} onClear={ms.clear} deleting={deleting}/>

      {/* Backdrop */}
      <div
        onClick={close}
        className={`fixed inset-0 bg-black/40 z-40 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      />

      {/* ── Slide-out drawer ── */}
      <div
        onClick={e => e.stopPropagation()}
        className={`fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-full w-full md:w-[440px] bg-white border-l border-[#E4E6EE] z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E4E6EE] shrink-0">
          <div>
            <h2 className="text-[#1A1D2E] font-bold text-lg">{editing ? 'Edit Task' : 'New Task'}</h2>
            {editing && <p className="text-[#9CA3AF] text-sm mt-0.5 truncate max-w-[300px]">{editing.task_name}</p>}
          </div>
          <button onClick={close} className="w-9 h-9 flex items-center justify-center rounded-xl text-[#9CA3AF] hover:text-[#1A1D2E] hover:bg-[#F5F6FA] transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Drawer body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          <div>
            <label className="block text-sm font-semibold text-[#374151] mb-2">Task Name <span className="text-red-500">*</span></label>
            <input
              value={form.task_name}
              onChange={e => setForm(p => ({ ...p, task_name: e.target.value }))}
              placeholder="What needs to be done?"
              className={inp}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-[#374151] mb-2">Status</label>
              <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))} className={sel}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-[#374151] mb-2">Priority</label>
              <select value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))} className={sel}>
                {PRIORITIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Preview badges */}
          <div className="flex gap-2">
            <span className="text-xs font-semibold px-3 py-1.5 rounded-full" style={{ background: (SC[form.status] ?? SC.Backlog).bg, color: (SC[form.status] ?? SC.Backlog).text }}>{form.status}</span>
            <span className="text-xs font-semibold px-3 py-1.5 rounded-full" style={{ background: (PC[form.priority] ?? PC.Medium).bg, color: (PC[form.priority] ?? PC.Medium).text }}>{form.priority}</span>
          </div>

          <div>
            <label className="block text-sm font-semibold text-[#374151] mb-2">Section / Group</label>
            <select value={form.group_name} onChange={e => setForm(p => ({ ...p, group_name: e.target.value }))} className={sel}>
              {GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>

          {/* Assignee */}
          <div className="relative">
            <label className="block text-sm font-semibold text-[#374151] mb-2">Assigned To</label>
            <button
              type="button"
              onClick={() => setAssigneeOpen(v => !v)}
              className="w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition flex items-center gap-2.5 text-left"
            >
              {form.assigned_to ? (() => {
                const m = teamMembers.find(m => m.email === form.assigned_to)
                return m ? (
                  <>
                    <span className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ backgroundColor: m.avatar_color }}>
                      {m.avatar_initials || m.full_name[0]}
                    </span>
                    <span className="flex-1 font-medium">{m.full_name}</span>
                  </>
                ) : <span className="text-[#9CA3AF] flex-1">{form.assigned_to}</span>
              })() : <span className="text-[#9CA3AF] flex-1">Unassigned</span>}
              <svg className={`w-4 h-4 text-[#9CA3AF] shrink-0 transition-transform ${assigneeOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
              </svg>
            </button>
            {assigneeOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-[#E4E6EE] rounded-xl overflow-hidden z-10 shadow-lg max-h-56 overflow-y-auto">
                <button type="button" onClick={() => { setForm(p => ({ ...p, assigned_to: '' })); setAssigneeOpen(false) }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-sm text-[#9CA3AF] hover:bg-[#F5F6FA] transition-colors text-left">
                  Unassigned
                </button>
                {teamMembers.map(m => (
                  <button key={m.id} type="button"
                    onClick={() => { setForm(p => ({ ...p, assigned_to: m.email })); setAssigneeOpen(false) }}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-[#F5F6FA] transition-colors text-left ${form.assigned_to === m.email ? 'bg-[#EEF2FF] text-[#3B6FE0]' : 'text-[#1A1D2E]'}`}
                  >
                    <span className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ backgroundColor: m.avatar_color }}>
                      {m.avatar_initials || m.full_name[0]}
                    </span>
                    <span className="font-medium">{m.full_name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-semibold text-[#374151] mb-2">Due Date</label>
            <input type="date" value={form.due_date} onChange={e => setForm(p => ({ ...p, due_date: e.target.value }))} className={inp}/>
          </div>

          <div>
            <label className="block text-sm font-semibold text-[#374151] mb-2">Linked Customer</label>
            <select value={form.customer_id} onChange={e => setForm(p => ({ ...p, customer_id: e.target.value }))} className={sel}>
              <option value="">— None —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-[#374151] mb-2">Notes</label>
            <TagInput ref={tagRef} value={form.notes} onChange={v => setForm(p => ({ ...p, notes: v }))} page="Tasks" className={inp + ' resize-none'}/>
          </div>

          {editing && (
            <>
              <div className="border-t border-[#E4E6EE] pt-5">
                <FileUpload supabase={sb} recordType="tasks" recordId={editing.id} currentUserEmail={userEmail}/>
              </div>
              <div className="border-t border-[#E4E6EE] pt-5">
                <CommentSection recordType="tasks" recordId={editing.id} currentUserEmail={userEmail}/>
              </div>
            </>
          )}
        </div>

        {/* Drawer footer */}
        <div className="shrink-0 px-6 py-5 border-t border-[#E4E6EE] space-y-3">
          {err && (
            <div className="flex gap-2 items-start bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <svg className="w-4 h-4 text-red-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              <p className="text-red-600 text-sm">{err}</p>
            </div>
          )}
          <div className="flex gap-3">
            {editing && (
              <button onClick={toggleArchive} disabled={busy}
                className="text-sm px-4 py-2.5 rounded-xl border border-[#E4E6EE] text-[#6B7280] hover:bg-[#F5F6FA] transition-colors disabled:opacity-50 shrink-0">
                {editing.is_active ? 'Archive' : 'Restore'}
              </button>
            )}
            <button onClick={close}
              className="flex-1 text-sm px-4 py-2.5 rounded-xl border border-[#E4E6EE] text-[#6B7280] hover:bg-[#F5F6FA] transition-colors">
              Cancel
            </button>
            <button onClick={save} disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 bg-[#3B6FE0] hover:bg-[#2D5EC7] disabled:opacity-60 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors">
              {saving
                ? <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Saving…</>
                : editing ? 'Save Changes' : 'Create Task'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
