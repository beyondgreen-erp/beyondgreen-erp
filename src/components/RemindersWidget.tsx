'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Reminder {
  id: string
  title: string
  notes: string | null
  due_date: string | null
  due_time: string | null
  priority: string
  is_completed: boolean
  color: string
  reminder_type: string
}

const TYPE_ICONS: Record<string, string> = {
  personal: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  follow_up: 'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z',
  call: 'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z',
  meeting: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  deadline: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  other: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
}

const PRIORITY_DOT: Record<string, string> = {
  urgent: 'bg-red-400',
  high: 'bg-orange-400',
  medium: 'bg-amber-400',
  low: 'bg-[#D0D3E0]',
}

const inputCls = 'w-full bg-white border border-[#E4E6EE] rounded-xl px-3 py-2 text-sm text-[#1A1D2E] placeholder-[#9CA3AF] focus:outline-none focus:border-[#3B6FE0] transition-all'

export default function RemindersWidget() {
  const supabase = createSupabaseBrowserClient()
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [userEmail, setUserEmail] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [loading, setLoading] = useState(true)
  const [tableExists, setTableExists] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    title: '', notes: '', due_date: '', due_time: '',
    priority: 'medium', reminder_type: 'personal', color: '#1D9E75',
  })

  const fetchReminders = useCallback(async (email: string) => {
    console.log('Fetching reminders for:', email)
    setLoading(true)
    setError(null)

    const { data, error: fetchError } = await supabase
      .from('user_reminders')
      .select('*')
      .eq('user_email', email)
      .eq('is_completed', false)
      .order('created_at', { ascending: false })

    console.log('Reminders result:', data, fetchError)

    if (fetchError) {
      if (fetchError.code === '42P01') {
        setTableExists(false)
        setLoading(false)
        return
      }
      console.error('Reminders fetch error:', fetchError)
      setError(fetchError.message)
      setLoading(false)
      return
    }

    setReminders(data || [])
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user }, error: authError }) => {
      console.log('Reminders user:', user?.email, authError)
      if (!user?.email) {
        console.error('No user email found for reminders')
        setLoading(false)
        return
      }
      setUserEmail(user.email)
      fetchReminders(user.email)
    })
  }, []) // eslint-disable-line

  // Realtime subscription
  useEffect(() => {
    if (!userEmail) return

    const channel = supabase
      .channel('user_reminders_' + userEmail)
      .on('postgres_changes' as any, {
        event: '*',
        schema: 'public',
        table: 'user_reminders',
        filter: `user_email=eq.${userEmail}`,
      }, () => {
        fetchReminders(userEmail)
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userEmail, fetchReminders, supabase])

  async function addReminder() {
    if (!form.title.trim()) return
    if (!userEmail) {
      alert('Not logged in')
      return
    }

    console.log('Adding reminder for:', userEmail)

    const { data, error: insertError } = await supabase
      .from('user_reminders')
      .insert({
        user_email: userEmail,
        title: form.title.trim(),
        notes: form.notes.trim() || null,
        due_date: form.due_date || null,
        due_time: form.due_time || null,
        priority: form.priority,
        reminder_type: form.reminder_type,
        is_completed: false,
        is_private: true,
        color: '#1D9E75',
      })
      .select()

    console.log('Insert result:', data, insertError)

    if (insertError) {
      alert('Failed to save reminder: ' + insertError.message)
      return
    }

    setForm({ title: '', notes: '', due_date: '', due_time: '', priority: 'medium', reminder_type: 'personal', color: '#1D9E75' })
    setShowAdd(false)
    await fetchReminders(userEmail)
  }

  async function completeReminder(id: string) {
    await supabase.from('user_reminders').update({ is_completed: true, completed_at: new Date().toISOString() }).eq('id', id)
    setReminders(prev => prev.filter(r => r.id !== id))
  }

  async function deleteReminder(id: string) {
    await supabase.from('user_reminders').delete().eq('id', id)
    setReminders(prev => prev.filter(r => r.id !== id))
  }

  if (!tableExists) return null

  const today = new Date().toISOString().slice(0, 10)
  const overdue = reminders.filter(r => r.due_date && r.due_date < today)
  const dueToday = reminders.filter(r => r.due_date === today)
  const upcoming = reminders.filter(r => !r.due_date || r.due_date > today)

  return (
    <div className="bg-white border border-[#E4E6EE] rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#E4E6EE]">
        <div className="flex items-center gap-2.5">
          <svg className="w-4 h-4 text-[#00C896]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <h2 className="text-[#1A1D2E] font-semibold text-sm">My Reminders</h2>
          {reminders.length > 0 && (
            <span className="bg-[#00C89620] text-[#00C896] text-xs px-2 py-0.5 rounded-full">{reminders.length}</span>
          )}
          {overdue.length > 0 && (
            <span className="bg-red-500/20 text-red-400 text-xs px-2 py-0.5 rounded-full animate-pulse">{overdue.length} overdue</span>
          )}
        </div>
        <button
          onClick={() => setShowAdd(v => !v)}
          className="flex items-center gap-1.5 bg-[#00C896] hover:bg-[#00B085] text-black text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
          Add
        </button>
      </div>

      {/* Error display */}
      {error && (
        <div className="mx-4 mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-xl">
          <p className="text-red-400 text-xs">{error}</p>
          <button
            onClick={() => { setError(null); if (userEmail) fetchReminders(userEmail) }}
            className="text-red-400 text-xs underline mt-1"
          >
            Retry
          </button>
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <div className="p-4 border-b border-[#E4E6EE] bg-[#F5F6FA] space-y-3">
          <input
            type="text"
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder="Reminder title…"
            className={inputCls}
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') addReminder(); if (e.key === 'Escape') setShowAdd(false) }}
          />
          <textarea
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            placeholder="Notes (optional)…"
            rows={2}
            className={inputCls + ' resize-none'}
          />
          <div className="grid grid-cols-2 gap-2">
            <input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} className={inputCls} />
            <input type="time" value={form.due_time} onChange={e => setForm(f => ({ ...f, due_time: e.target.value }))} className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className={inputCls}>
              <option value="urgent">🔴 Urgent</option>
              <option value="high">🟠 High</option>
              <option value="medium">🟡 Medium</option>
              <option value="low">⚪ Low</option>
            </select>
            <select value={form.reminder_type} onChange={e => setForm(f => ({ ...f, reminder_type: e.target.value }))} className={inputCls}>
              <option value="personal">Personal</option>
              <option value="follow_up">Follow Up</option>
              <option value="call">Call</option>
              <option value="meeting">Meeting</option>
              <option value="deadline">Deadline</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={addReminder} className="flex-1 bg-[#00C896] hover:bg-[#00B085] text-black font-semibold text-sm py-2 rounded-xl transition-colors">
              Save Reminder
            </button>
            <button onClick={() => setShowAdd(false)} className="px-4 bg-[#F0F1F5] hover:bg-[#E4E6EE] text-[#6B7280] text-sm rounded-xl transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="divide-y divide-[#E4E6EE] max-h-80 overflow-y-auto">
        {loading && (
          <div className="p-8 text-center text-[#5A5A6A] text-sm">Loading reminders…</div>
        )}
        {!loading && reminders.length === 0 && (
          <div className="p-8 text-center">
            <svg className="w-8 h-8 text-[#E4E6EE] mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <p className="text-[#9CA3AF] text-sm">No reminders</p>
            <p className="text-[#D0D3E0] text-xs mt-0.5">Only you can see your reminders</p>
            <p className="text-[#E4E6EE] text-xs mt-1">Logged in as: {userEmail || 'unknown'}</p>
          </div>
        )}

        {overdue.map(r => <ReminderRow key={r.id} reminder={r} isOverdue onComplete={completeReminder} onDelete={deleteReminder} typeIcons={TYPE_ICONS} priorityDot={PRIORITY_DOT} />)}

        {dueToday.length > 0 && (
          <div className="px-4 py-1.5 bg-amber-500/5">
            <p className="text-xs text-amber-400 font-medium uppercase tracking-wide">Due Today</p>
          </div>
        )}
        {dueToday.map(r => <ReminderRow key={r.id} reminder={r} isToday onComplete={completeReminder} onDelete={deleteReminder} typeIcons={TYPE_ICONS} priorityDot={PRIORITY_DOT} />)}

        {upcoming.length > 0 && dueToday.length > 0 && (
          <div className="px-4 py-1.5 bg-[#F5F6FA]">
            <p className="text-xs text-[#9CA3AF] font-medium uppercase tracking-wide">Upcoming</p>
          </div>
        )}
        {upcoming.map(r => <ReminderRow key={r.id} reminder={r} onComplete={completeReminder} onDelete={deleteReminder} typeIcons={TYPE_ICONS} priorityDot={PRIORITY_DOT} />)}
      </div>
    </div>
  )
}

interface RowProps {
  reminder: Reminder
  isOverdue?: boolean
  isToday?: boolean
  typeIcons: Record<string, string>
  priorityDot: Record<string, string>
  onComplete: (id: string) => void
  onDelete: (id: string) => void
}

function ReminderRow({ reminder: r, isOverdue, isToday, typeIcons, priorityDot, onComplete, onDelete }: RowProps) {
  return (
    <div className={`flex items-start gap-3 px-4 py-3 hover:bg-[#F5F6FA] transition-colors group ${isOverdue ? 'bg-red-500/5' : isToday ? 'bg-amber-500/5' : ''}`}>
      <button
        onClick={() => onComplete(r.id)}
        className="mt-0.5 w-4 h-4 rounded-full border-2 border-[#D0D3E0] hover:border-[#00C896] flex-shrink-0 transition-colors"
        title="Mark complete"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <svg className="w-3 h-3 text-[#5A5A6A] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={typeIcons[r.reminder_type] ?? typeIcons.other} />
          </svg>
          <p className={`text-sm font-medium truncate ${isOverdue ? 'text-red-500' : 'text-[#1A1D2E]'}`}>{r.title}</p>
        </div>
        {r.notes && <p className="text-xs text-[#9CA3AF] mt-0.5 truncate">{r.notes}</p>}
        {r.due_date && (
          <p className={`text-xs mt-0.5 ${isOverdue ? 'text-red-400 font-medium' : isToday ? 'text-amber-400' : 'text-[#5A5A6A]'}`}>
            {isOverdue ? '⚠ Overdue · ' : ''}
            {new Date(r.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            {r.due_time ? ' at ' + r.due_time : ''}
          </p>
        )}
      </div>
      <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${priorityDot[r.priority] ?? 'bg-[#D0D3E0]'}`} />
      <button
        onClick={() => onDelete(r.id)}
        className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center text-[#5A5A6A] hover:text-red-400 transition-all flex-shrink-0"
        title="Delete"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
  )
}
