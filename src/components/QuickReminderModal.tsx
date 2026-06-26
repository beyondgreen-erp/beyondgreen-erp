'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Parsed { title: string; notes: string; reminder_type: string; priority: string }
const TYPES = ['follow_up','call','meeting','deadline','personal','other']
const PRIORITIES = ['urgent','high','medium','low']

export default function QuickReminderModal({ userEmail, onClose, onSaved }: { userEmail: string; onClose: () => void; onSaved: () => void }) {
  const [step, setStep] = useState<'paste'|'preview'|'saving'|'done'>('paste')
  const [emailThread, setEmailThread] = useState('')
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState('')
  const [parsed, setParsed] = useState<Parsed | null>(null)

  async function handleParse() {
    if (!emailThread.trim()) return
    setParsing(true); setError('')
    try {
      const res = await fetch('/api/reminders/ai-extract', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailThread }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setParsed({ title: data.title || '', notes: data.notes || '', reminder_type: data.reminder_type || 'follow_up', priority: data.priority || 'medium' })
      setStep('preview')
    } catch (e: any) {
      setError(e?.message || 'AI extraction failed. Please try again.')
    } finally { setParsing(false) }
  }

  async function handleSave() {
    if (!parsed || !parsed.title.trim() || !userEmail) return
    setStep('saving'); setError('')
    try {
      const { error: ie } = await supabase.from('user_reminders').insert({
        user_email: userEmail,
        title: parsed.title.trim(),
        notes: parsed.notes.trim() || null,
        reminder_type: parsed.reminder_type,
        priority: parsed.priority,
        daily_email: true,
        due_date: null,
        is_completed: false,
        is_private: true,
        color: '#1D9E75',
      })
      if (ie) throw new Error(ie.message)
      setStep('done')
      setTimeout(() => { onSaved(); onClose() }, 1200)
    } catch (e: any) {
      setError(e?.message || 'Save failed'); setStep('preview')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h2 className="text-lg font-bold text-gray-900">✨ Reminder from Email</h2>
            <p className="text-sm text-gray-500">Paste an email — AI makes a daily reminder that emails you at {userEmail || 'your login email'} every morning until you complete it.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        {step === 'paste' && (
          <div className="p-5 space-y-4">
            <textarea value={emailThread} onChange={e => setEmailThread(e.target.value)}
              placeholder="Paste the email here…"
              className="w-full h-56 border border-gray-300 rounded-lg p-3 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div className="flex gap-3 justify-end">
              <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleParse} disabled={parsing || !emailThread.trim()}
                className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2">
                {parsing ? <><span className="animate-spin">⏳</span> Reading…</> : '✨ Create Reminder'}
              </button>
            </div>
          </div>
        )}

        {step === 'preview' && parsed && (
          <div className="p-5 space-y-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs text-emerald-800">📧 You&apos;ll get a daily email about this until you mark it complete.</div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Reminder</label>
              <input value={parsed.title} onChange={e => setParsed({ ...parsed, title: e.target.value })}
                className="w-full mt-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Notes / Context</label>
              <textarea value={parsed.notes} onChange={e => setParsed({ ...parsed, notes: e.target.value })}
                className="w-full mt-1 border rounded-lg px-3 py-2 text-sm h-20 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Type</label>
                <select value={parsed.reminder_type} onChange={e => setParsed({ ...parsed, reminder_type: e.target.value })} className="w-full mt-1 border rounded-lg px-3 py-2 text-sm">
                  {TYPES.map(t => <option key={t} value={t}>{t.replace('_',' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Priority</label>
                <select value={parsed.priority} onChange={e => setParsed({ ...parsed, priority: e.target.value })} className="w-full mt-1 border rounded-lg px-3 py-2 text-sm">
                  {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div className="flex gap-3 justify-between pt-2 border-t">
              <button onClick={() => setStep('paste')} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">← Back</button>
              <button onClick={handleSave} className="px-6 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-semibold">✓ Save Daily Reminder</button>
            </div>
          </div>
        )}

        {step === 'saving' && <div className="p-10 text-center"><div className="text-4xl animate-spin inline-block">⏳</div><p className="mt-3 text-gray-600">Saving…</p></div>}
        {step === 'done' && <div className="p-10 text-center"><div className="text-5xl">✅</div><p className="mt-3 font-semibold text-gray-900">Daily reminder set!</p><p className="text-sm text-gray-500">You&apos;ll be emailed each morning until you complete it.</p></div>}
      </div>
    </div>
  )
}
