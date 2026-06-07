'use client'

import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

/* eslint-disable @typescript-eslint/no-explicit-any */
interface LinkedTask {
  id: string
  task_name: string
  assigned_to: string | null
  due_date: string | null
  priority: string
  status: string
}

interface Props {
  recordType: string
  recordId: string | undefined
  defaultCustomerId?: string | null
  currentUserEmail: string
}

const SC: Record<string,string> = { Backlog:'bg-[#F5F6FA]/40 text-gray-400 border-[#E4E6EE]', 'In Progress':'bg-blue-500/15 text-blue-400 border-blue-500/20', Review:'bg-violet-500/15 text-violet-400 border-violet-500/20', Done:'bg-emerald-500/15 text-emerald-400 border-emerald-500/20', Blocked:'bg-red-500/15 text-red-400 border-red-500/20', 'On Hold':'bg-amber-500/15 text-amber-400 border-amber-500/20' }
const PRIORITIES = ['Low','Medium','High','Critical']
const STATUSES = ['Backlog','In Progress','Review','Done','Blocked','On Hold']
const emptyTask = { task_name:'', assigned_to:'', due_date:'', priority:'Medium', status:'Backlog', notes:'' }

export default function LinkedTasks({ recordType, recordId, defaultCustomerId, currentUserEmail }: Props) {
  const sb = createSupabaseBrowserClient()
  const [tasks, setTasks] = useState<LinkedTask[]>([])
  const [members, setMembers] = useState<{email:string;full_name:string}[]>([])
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState(emptyTask)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function load() {
    if (!recordId) return
    const { data } = await sb.from('tasks')
      .select('id,task_name,assigned_to,due_date,priority,status')
      .eq('linked_record_type', recordType)
      .eq('linked_record_id', recordId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
    if (data) setTasks(data as LinkedTask[])
  }

  useEffect(() => {
    load()
    sb.from('user_profiles').select('email,full_name').eq('is_active', true).order('full_name')
      .then(({ data }) => { if (data) setMembers(data as any[]) })
  }, [recordId]) // eslint-disable-line

  async function createTask() {
    if (!form.task_name.trim()) { setErr('Task name is required.'); return }
    setErr(''); setSaving(true)
    const { error } = await sb.from('tasks').insert({
      task_name: form.task_name.trim(),
      assigned_to: form.assigned_to || null,
      due_date: form.due_date || null,
      priority: form.priority,
      status: form.status,
      notes: form.notes.trim() || null,
      customer_id: defaultCustomerId || null,
      linked_record_type: recordType,
      linked_record_id: recordId,
      is_active: true,
      group_name: 'Current',
    })
    if (error) { setErr(error.message); setSaving(false); return }
    setSaving(false)
    setForm(emptyTask)
    setAdding(false)
    load()
  }

  const inp = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 transition'

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-500 tracking-widest uppercase">Linked Tasks</p>
        {!adding && (
          <button onClick={() => { setAdding(true); setForm({ ...emptyTask, assigned_to: currentUserEmail }) }} className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>Create Task
          </button>
        )}
      </div>

      {adding && (
        <div className="bg-[#F5F6FA]/60 border border-[#E4E6EE] rounded-lg p-3 space-y-2.5">
          <div>
            <input value={form.task_name} onChange={e=>setForm(p=>({...p,task_name:e.target.value}))} placeholder="Task name…" className={inp} autoFocus/>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Assign to</label>
              <select value={form.assigned_to} onChange={e=>setForm(p=>({...p,assigned_to:e.target.value}))} className={inp+' cursor-pointer'}>
                <option value="">— Unassigned —</option>
                {members.map(m=><option key={m.email} value={m.email}>{m.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Due Date</label>
              <input type="date" value={form.due_date} onChange={e=>setForm(p=>({...p,due_date:e.target.value}))} className={inp}/>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Priority</label>
              <select value={form.priority} onChange={e=>setForm(p=>({...p,priority:e.target.value}))} className={inp+' cursor-pointer'}>
                {PRIORITIES.map(p=><option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Status</label>
              <select value={form.status} onChange={e=>setForm(p=>({...p,status:e.target.value}))} className={inp+' cursor-pointer'}>
                {STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div>
            <textarea rows={2} value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} placeholder="Notes (optional)…" className={inp+' resize-none'}/>
          </div>
          {err && <p className="text-red-400 text-xs">{err}</p>}
          <div className="flex gap-2">
            <button onClick={()=>{setAdding(false);setErr('')}} className="flex-1 text-xs px-3 py-2 rounded-lg border border-[#E4E6EE] text-gray-400 hover:text-gray-700 transition-colors">Cancel</button>
            <button onClick={createTask} disabled={saving} className="flex-1 text-xs px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white font-medium transition-colors">{saving?'Saving…':'Create Task'}</button>
          </div>
        </div>
      )}

      {tasks.length > 0 ? (
        <div className="space-y-1.5">
          {tasks.map(t => (
            <div key={t.id} className="flex items-center gap-2.5 bg-[#F5F6FA]/40 rounded-lg px-3 py-2.5">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.priority==='Critical'?'bg-red-400':t.priority==='High'?'bg-orange-400':t.priority==='Medium'?'bg-blue-400':'bg-gray-500'}`}/>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[#1A1D2E] font-medium truncate">{t.task_name}</p>
                {(t.assigned_to||t.due_date) && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    {t.assigned_to && <span>{t.assigned_to.split('@')[0]}</span>}
                    {t.assigned_to && t.due_date && <span className="mx-1">·</span>}
                    {t.due_date && <span>{new Date(t.due_date+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span>}
                  </p>
                )}
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium border shrink-0 ${SC[t.status]||SC.Backlog}`}>{t.status}</span>
            </div>
          ))}
        </div>
      ) : !adding ? (
        <p className="text-xs text-gray-600 italic">No linked tasks.</p>
      ) : null}
    </div>
  )
}
