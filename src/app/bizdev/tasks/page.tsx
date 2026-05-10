'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import TagInput, { TagInputHandle } from '@/components/TagInput'
import ImportExportBar from '@/components/ImportExportBar'

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

const empty = { task_name: '', assigned_to: '', due_date: '', priority: 'Medium', status: 'Backlog', customer_id: '', notes: '', group_name: 'Current' }
type F = typeof empty

function dbErr(e: { code?: string; message: string; hint?: string }) {
  return [e.message, e.code && `(${e.code})`, e.hint && `Hint: ${e.hint}`].filter(Boolean).join(' — ')
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
  const ref = useRef<HTMLDivElement>(null)
  const tagRef = useRef<TagInputHandle>(null)

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
  useEffect(() => { load() }, []) // eslint-disable-line

  const memberMap = useMemo(() => Object.fromEntries(teamMembers.map(m => [m.email, m])), [teamMembers])

  const filtered = rows.filter(r => {
    if (filterStatus && r.status !== filterStatus) return false
    if (filterAssignee && r.assigned_to !== filterAssignee) return false
    if (filterGroup && (r.group_name ?? '') !== filterGroup) return false
    if (search) {
      const q = search.toLowerCase()
      return r.task_name.toLowerCase().includes(q) || (r.assigned_to ?? '').toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q)
    }
    return true
  })

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
      const next = new Set(prev)
      next.has(g) ? next.delete(g) : next.add(g)
      return next
    })
  }

  function openAdd() { setEditing(null); setForm(empty); setErr(''); setOpen(true) }
  function openEdit(r: Task) {
    setEditing(r)
    setForm({ task_name: r.task_name, assigned_to: r.assigned_to ?? '', due_date: r.due_date ?? '', priority: r.priority, status: r.status, customer_id: r.customer_id ?? '', notes: r.notes ?? '', group_name: r.group_name ?? 'Current' })
    setErr('')
    setOpen(true)
  }
  function close() { setOpen(false); setAssigneeOpen(false); setTimeout(() => { setEditing(null); setForm(empty) }, 300) }
  useEffect(() => {
    const h = (e: MouseEvent) => { if (open && ref.current && !ref.current.contains(e.target as Node)) close() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open]) // eslint-disable-line

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

  return (
    <div className="p-4 md:p-8 min-h-screen">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-violet-500/20 text-violet-300 border-violet-500/30">BUSINESS DEV</span>
          <h1 className="text-2xl font-semibold text-white mt-1">Tasks</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${filtered.length} task${filtered.length !== 1 ? 's' : ''}`}</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportExportBar table="tasks" filename="tasks" columns={[
            { header: 'Task Name', dbKey: 'task_name', example: 'Follow up on proposal', required: true },
            { header: 'Assigned To', dbKey: 'assigned_to', example: 'john@beyondgreen.com' },
            { header: 'Due Date', dbKey: 'due_date', example: '2024-02-15' },
            { header: 'Priority', dbKey: 'priority', example: 'Medium' },
            { header: 'Status', dbKey: 'status', example: 'Backlog' },
            { header: 'Group', dbKey: 'group_name', example: 'Current' },
            { header: 'Customer Name', dbKey: 'customer_name', example: 'Acme Corp', lookup: { fromTable: 'customers', matchField: 'company_name', storeAs: 'customer_id' } },
            { header: 'Notes', dbKey: 'notes', example: '' },
          ]} onImportDone={load} />
          <button onClick={openAdd} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
            Add Task
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          <input placeholder="Search tasks…" value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-gray-900 border border-gray-800 text-white placeholder-gray-600 rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 transition"/>
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="bg-gray-900 border border-gray-800 text-gray-400 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 cursor-pointer">
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)} className="bg-gray-900 border border-gray-800 text-gray-400 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 cursor-pointer">
          <option value="">All Members</option>
          {teamMembers.map(m => <option key={m.id} value={m.email}>{m.full_name}</option>)}
        </select>
        <select value={filterGroup} onChange={e => setFilterGroup(e.target.value)} className="bg-gray-900 border border-gray-800 text-gray-400 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 cursor-pointer">
          <option value="">All Groups</option>
          {GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        {hasFilters && (
          <button onClick={() => { setSearch(''); setFilterStatus(''); setFilterAssignee(''); setFilterGroup('') }} className="text-sm text-gray-500 hover:text-white transition-colors px-2">
            Clear
          </button>
        )}
      </div>

      {/* Grouped task sections */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <svg className="w-5 h-5 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-gray-500 text-sm">{hasFilters ? 'No matches.' : 'No tasks yet.'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groupKeys.map(groupName => {
            const tasks = grouped[groupName]
            if (!tasks || tasks.length === 0) return null
            const collapsed = collapsedGroups.has(groupName)
            return (
              <div key={groupName} className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
                <button onClick={() => toggleGroup(groupName)} className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-800/40 transition-colors">
                  <div className="flex items-center gap-3">
                    <svg className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
                    </svg>
                    <span className="text-white font-semibold text-sm">{groupName}</span>
                    <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">{tasks.length}</span>
                  </div>
                </button>
                {!collapsed && (
                  <div className="overflow-x-auto border-t border-gray-800">
                    <table className="w-full min-w-[680px] text-sm">
                      <thead>
                        <tr className="border-b border-gray-800">
                          {['Task Name', 'Assigned To', 'Priority', 'Status', 'Due Date', ''].map(h => (
                            <th key={h} className="text-left text-xs font-semibold text-gray-500 px-5 py-3">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {tasks.map((r, i) => {
                          const member = r.assigned_to ? memberMap[r.assigned_to] : null
                          return (
                            <tr key={r.id} className={`border-b border-gray-800/60 last:border-0 transition-colors ${i % 2 === 0 ? 'hover:bg-gray-800/40' : 'bg-gray-800/10 hover:bg-gray-800/40'}`}>
                              <td className="px-5 py-3.5 max-w-xs">
                                <p className="text-white font-medium truncate">{r.task_name}</p>
                                {r.description && <p className="text-gray-600 text-xs mt-0.5 truncate">{r.description}</p>}
                              </td>
                              <td className="px-5 py-3.5">
                                {member ? (
                                  <div className="flex items-center gap-2">
                                    <span className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ backgroundColor: member.avatar_color }}>
                                      {member.avatar_initials || member.full_name[0]}
                                    </span>
                                    <span className="text-gray-300 text-sm">{member.full_name}</span>
                                  </div>
                                ) : <span className="text-gray-600">—</span>}
                              </td>
                              <td className="px-5 py-3.5">
                                <span className={`text-xs px-2 py-1 rounded-full font-medium border ${PC[r.priority] ?? PC.Medium}`}>{r.priority}</span>
                              </td>
                              <td className="px-5 py-3.5">
                                <span className={`text-xs px-2 py-1 rounded-full font-medium border ${SC[r.status] ?? SC.Backlog}`}>{r.status}</span>
                              </td>
                              <td className="px-5 py-3.5 text-gray-400 text-sm whitespace-nowrap">
                                {r.due_date ? new Date(r.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                              </td>
                              <td className="px-5 py-3.5">
                                <button onClick={() => openEdit(r)} className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-2.5 py-1 rounded-lg transition-colors">
                                  Edit
                                </button>
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

      {/* Backdrop */}
      <div className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}/>

      {/* Slide-out drawer */}
      <div ref={ref} className={`fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-full w-full md:max-w-md bg-gray-900 border-l border-gray-800 z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-800 shrink-0">
          <h2 className="text-white font-semibold">{editing ? 'Edit Task' : 'Add Task'}</h2>
          <button onClick={close} className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-gray-800">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Task Name <span className="text-red-400">*</span></label>
            <input value={form.task_name} onChange={e => setForm(p => ({ ...p, task_name: e.target.value }))} className={inp}/>
          </div>
          {/* Assigned To — custom avatar dropdown */}
          <div className="relative">
            <label className="block text-xs text-gray-400 mb-1.5">Assigned To</label>
            <button type="button" onClick={() => setAssigneeOpen(v => !v)} className={inp + ' cursor-pointer flex items-center gap-2.5 text-left'}>
              {form.assigned_to ? (() => {
                const m = teamMembers.find(m => m.email === form.assigned_to)
                return m ? (
                  <><span className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ backgroundColor: m.avatar_color }}>{m.avatar_initials || m.full_name[0]}</span><span className="flex-1">{m.full_name}</span></>
                ) : <span className="text-gray-500 flex-1">{form.assigned_to}</span>
              })() : <span className="text-gray-500 flex-1">— Unassigned —</span>}
              <svg className={`w-4 h-4 text-gray-500 shrink-0 transition-transform ${assigneeOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
            </button>
            {assigneeOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden z-10 shadow-xl max-h-48 overflow-y-auto">
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
            <label className="block text-xs text-gray-400 mb-1.5">Due Date</label>
            <input type="date" value={form.due_date} onChange={e => setForm(p => ({ ...p, due_date: e.target.value }))} className={inp}/>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Priority</label>
              <select value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))} className={sel}>
                {PRIORITIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Status</label>
              <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))} className={sel}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Group</label>
            <select value={form.group_name} onChange={e => setForm(p => ({ ...p, group_name: e.target.value }))} className={sel}>
              {GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          {form.priority && (
            <div className={`rounded-lg px-3 py-2 flex items-center justify-between border ${PC[form.priority] ?? ''}`}>
              <span className="text-xs opacity-70">Priority level</span>
              <span className="text-sm font-medium">{form.priority}</span>
            </div>
          )}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Linked Customer</label>
            <select value={form.customer_id} onChange={e => setForm(p => ({ ...p, customer_id: e.target.value }))} className={sel}>
              <option value="">— None —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </div>
          <TagInput ref={tagRef} value={form.notes} onChange={v => setForm(p => ({ ...p, notes: v }))} page="Tasks" className={inp + ' resize-none'}/>
        </div>
        <div className="shrink-0 px-6 py-4 border-t border-gray-800 space-y-3">
          {err && (
            <div className="flex gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5">
              <svg className="w-4 h-4 text-red-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              <p className="text-red-400 text-xs">{err}</p>
            </div>
          )}
          <div className="flex gap-3">
            {editing && (
              <button onClick={toggleArchive} disabled={busy} className="text-sm px-3 py-2.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors disabled:opacity-50">
                {editing.is_active ? 'Archive' : 'Restore'}
              </button>
            )}
            <button onClick={close} className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors">Cancel</button>
            <button onClick={save} disabled={saving} className="flex-1 flex items-center justify-center bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
