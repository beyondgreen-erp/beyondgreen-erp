'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Conversation {
  id: string
  customer_id: string
  logged_by: string
  conversation_type: string
  subject: string | null
  content: string
  contact_name: string | null
  outcome: string | null
  follow_up_date: string | null
  follow_up_notes: string | null
  is_pinned: boolean
  created_at: string
}

const TYPE_CFG: Record<string, { icon: string; color: string; bg: string; label: string }> = {
  call:      { icon: 'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z', color: 'text-blue-400',    bg: 'bg-blue-500/10',    label: 'Call' },
  email:     { icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z', color: 'text-purple-400',  bg: 'bg-purple-500/10',  label: 'Email' },
  text:      { icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z', color: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'Text/WhatsApp' },
  whatsapp:  { icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z', color: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'WhatsApp' },
  meeting:   { icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z', color: 'text-amber-400',  bg: 'bg-amber-500/10',  label: 'Meeting' },
  note:      { icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z', color: 'text-gray-400',   bg: 'bg-gray-500/10',   label: 'Note' },
  in_person: { icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z', color: 'text-teal-400',   bg: 'bg-teal-500/10',   label: 'In Person' },
  other:     { icon: 'M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z', color: 'text-slate-400',  bg: 'bg-slate-500/10',  label: 'Other' },
}

const ALL_TYPES = [
  { value: 'call', label: '📞 Call' },
  { value: 'email', label: '📧 Email' },
  { value: 'text', label: '💬 Text/WhatsApp' },
  { value: 'meeting', label: '🤝 Meeting' },
  { value: 'note', label: '📝 Note' },
  { value: 'in_person', label: '👤 In Person' },
  { value: 'other', label: '📋 Other' },
]

const FILTERS = ['all', 'call', 'email', 'text', 'meeting', 'note', 'in_person']

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 2) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const inputCls = 'w-full bg-[#18181C] border border-[#2A2A35] rounded-xl px-3 py-2.5 text-sm text-white placeholder-[#5A5A6A] focus:outline-none focus:border-[#00C896] transition-all'

interface Props {
  customerId: string
  customerName: string
  currentUserEmail: string
}

export default function ConversationLog({ customerId, customerName, currentUserEmail }: Props) {
  const supabase = createSupabaseBrowserClient()
  const [convos, setConvos] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [tableExists, setTableExists] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<Conversation | null>(null)
  const [saving, setSaving] = useState(false)

  const emptyForm = {
    conversation_type: 'note', subject: '', content: '', contact_name: '',
    outcome: '', follow_up_date: '', follow_up_notes: '',
  }
  const [form, setForm] = useState(emptyForm)
  const [showForm, setShowForm] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('customer_conversations')
      .select('*')
      .eq('customer_id', customerId)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
    if (error?.code === '42P01') { setTableExists(false); setLoading(false); return }
    setConvos(data ?? [])
    setLoading(false)
  }, [customerId]) // eslint-disable-line

  useEffect(() => { load() }, [load])

  async function saveConvo() {
    if (!form.content.trim()) return
    setSaving(true)
    if (editing) {
      await supabase.from('customer_conversations').update({
        conversation_type: form.conversation_type,
        subject: form.subject || null,
        content: form.content,
        contact_name: form.contact_name || null,
        outcome: form.outcome || null,
        follow_up_date: form.follow_up_date || null,
        follow_up_notes: form.follow_up_notes || null,
        updated_at: new Date().toISOString(),
      }).eq('id', editing.id)
    } else {
      await supabase.from('customer_conversations').insert({
        customer_id: customerId,
        logged_by: currentUserEmail,
        conversation_type: form.conversation_type,
        subject: form.subject || null,
        content: form.content,
        contact_name: form.contact_name || null,
        outcome: form.outcome || null,
        follow_up_date: form.follow_up_date || null,
        follow_up_notes: form.follow_up_notes || null,
      })
      // Auto-create personal reminder if follow-up date is set
      if (form.follow_up_date) {
        await supabase.from('user_reminders').insert({
          user_email: currentUserEmail,
          title: `Follow up: ${customerName}`,
          notes: form.follow_up_notes || `Re: ${form.subject || form.conversation_type} logged ${new Date().toLocaleDateString()}`,
          due_date: form.follow_up_date,
          priority: 'medium',
          reminder_type: 'follow_up',
          linked_customer_id: customerId,
          is_private: true,
        }).then(() => {}) // fire-and-forget, table may not exist yet
      }
    }
    setForm(emptyForm)
    setEditing(null)
    setShowForm(false)
    setSaving(false)
    load()
  }

  async function deleteConvo(id: string) {
    if (!confirm('Delete this conversation entry?')) return
    await supabase.from('customer_conversations').delete().eq('id', id)
    setConvos(prev => prev.filter(c => c.id !== id))
  }

  async function togglePin(c: Conversation) {
    await supabase.from('customer_conversations').update({ is_pinned: !c.is_pinned }).eq('id', c.id)
    setConvos(prev => prev.map(x => x.id === c.id ? { ...x, is_pinned: !c.is_pinned } : x))
  }

  function openEdit(c: Conversation) {
    setEditing(c)
    setForm({
      conversation_type: c.conversation_type,
      subject: c.subject ?? '',
      content: c.content,
      contact_name: c.contact_name ?? '',
      outcome: c.outcome ?? '',
      follow_up_date: c.follow_up_date ?? '',
      follow_up_notes: c.follow_up_notes ?? '',
    })
    setShowForm(true)
  }

  function cancelForm() { setForm(emptyForm); setEditing(null); setShowForm(false) }

  if (!tableExists) {
    return (
      <div className="p-6 text-center">
        <p className="text-[#5A5A6A] text-sm mb-2">Conversations table not found.</p>
        <p className="text-[#3A3A45] text-xs font-mono">CREATE TABLE customer_conversations (…)</p>
      </div>
    )
  }

  const filtered = convos.filter(c => {
    if (filter !== 'all' && c.conversation_type !== filter) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (c.content ?? '').toLowerCase().includes(q) ||
           (c.subject ?? '').toLowerCase().includes(q) ||
           (c.contact_name ?? '').toLowerCase().includes(q)
  })

  return (
    <div className="space-y-4">
      {/* Log button */}
      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="w-full flex items-center justify-center gap-2 border border-dashed border-[#2A2A35] hover:border-[#00C896] text-[#5A5A6A] hover:text-[#00C896] rounded-xl py-3 text-sm font-medium transition-all"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Log Conversation
        </button>
      )}

      {/* Form */}
      {showForm && (
        <div className="bg-[#18181C] border border-[#2A2A35] rounded-2xl p-4 space-y-3">
          <p className="text-white text-sm font-semibold">{editing ? 'Edit Entry' : 'Log Conversation'}</p>

          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className="block text-xs text-[#9898A8] mb-1">Type</label>
              <div className="flex flex-wrap gap-1.5">
                {ALL_TYPES.map(t => (
                  <button
                    key={t.value}
                    onClick={() => setForm(f => ({ ...f, conversation_type: t.value }))}
                    className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${form.conversation_type === t.value ? 'bg-[#00C89620] text-[#00C896] border-[#00C89640]' : 'bg-[#111113] text-[#9898A8] border-[#2A2A35] hover:text-white'}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-[#9898A8] mb-1">Contact Name</label>
              <input value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} placeholder="Who did you speak with?" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-[#9898A8] mb-1">Subject</label>
              <input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="Subject (optional)" className={inputCls} />
            </div>
          </div>

          <div>
            <label className="block text-xs text-[#9898A8] mb-1">Content <span className="text-red-400">*</span></label>
            <textarea
              value={form.content}
              onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
              placeholder="Paste email content, call notes, or any conversation details here…"
              rows={4}
              className={inputCls + ' resize-none'}
            />
          </div>

          <div>
            <label className="block text-xs text-[#9898A8] mb-1">Outcome</label>
            <input value={form.outcome} onChange={e => setForm(f => ({ ...f, outcome: e.target.value }))} placeholder="What was the result?" className={inputCls} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-[#9898A8] mb-1">Follow-up Date</label>
              <input type="date" value={form.follow_up_date} onChange={e => setForm(f => ({ ...f, follow_up_date: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-[#9898A8] mb-1">Follow-up Notes</label>
              <input value={form.follow_up_notes} onChange={e => setForm(f => ({ ...f, follow_up_notes: e.target.value }))} placeholder="What to follow up on?" className={inputCls} />
            </div>
          </div>

          {form.follow_up_date && (
            <div className="bg-[#00C89610] border border-[#00C89630] rounded-xl px-3 py-2 text-xs text-[#00C896]">
              A personal reminder will be created on your dashboard for {form.follow_up_date}.
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={saveConvo} disabled={saving || !form.content.trim()} className="flex-1 bg-[#00C896] hover:bg-[#00B085] disabled:opacity-50 text-black font-semibold text-sm py-2.5 rounded-xl transition-all">
              {saving ? 'Saving…' : editing ? 'Update Entry' : 'Log Conversation'}
            </button>
            <button onClick={cancelForm} className="px-4 bg-[#2A2A35] hover:bg-[#3A3A45] text-[#9898A8] text-sm rounded-xl transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Filter + search */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-1 flex-wrap">
          {FILTERS.map(f => {
            const cfg = TYPE_CFG[f]
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${filter === f ? 'bg-[#2A2A35] text-white border-[#3A3A45]' : 'text-[#5A5A6A] border-[#2A2A35] hover:text-[#9898A8]'}`}
              >
                {f === 'all' ? 'All' : cfg?.label ?? f}
              </button>
            )
          })}
        </div>
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#5A5A6A]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search conversations…"
            className="w-full bg-[#18181C] border border-[#2A2A35] text-white placeholder-[#5A5A6A] rounded-xl pl-8 pr-4 py-2 text-xs focus:outline-none focus:border-[#00C896] transition-all"
          />
        </div>
      </div>

      {/* Timeline */}
      {loading ? (
        <div className="flex justify-center py-8"><svg className="w-5 h-5 animate-spin text-[#3A3A45]" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-[#5A5A6A] text-sm">{search || filter !== 'all' ? 'No matches' : 'No conversations logged yet'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(c => {
            const cfg = TYPE_CFG[c.conversation_type] ?? TYPE_CFG.other
            const isExpanded = expanded.has(c.id)
            const isLong = c.content.length > 300
            const displayContent = isLong && !isExpanded ? c.content.slice(0, 300) + '…' : c.content
            const isOwn = c.logged_by === currentUserEmail

            return (
              <div key={c.id} className={`bg-[#18181C] border rounded-2xl p-4 transition-all ${c.is_pinned ? 'border-amber-500/30' : 'border-[#2A2A35]'}`}>
                <div className="flex items-start gap-3">
                  <div className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${cfg.bg}`}>
                    <svg className={`w-3.5 h-3.5 ${cfg.color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={cfg.icon} />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
                      {c.contact_name && <span className="text-xs text-[#9898A8]">with {c.contact_name}</span>}
                      <span className="text-xs text-[#3A3A45]">·</span>
                      <span className="text-xs text-[#5A5A6A]">{timeAgo(c.created_at)}</span>
                      <span className="text-xs text-[#3A3A45]">·</span>
                      <span className="text-xs text-[#5A5A6A]">{c.logged_by.split('@')[0]}</span>
                      {c.is_pinned && <span className="text-xs text-amber-400">📌 Pinned</span>}
                    </div>
                    {c.subject && <p className="text-white text-xs font-semibold mb-1">{c.subject}</p>}
                    <p className="text-[#9898A8] text-xs leading-relaxed whitespace-pre-wrap">{displayContent}</p>
                    {isLong && (
                      <button
                        onClick={() => setExpanded(prev => { const n = new Set(prev); if (isExpanded) { n.delete(c.id) } else { n.add(c.id) } return n })}
                        className="text-xs text-[#00C896] hover:text-[#00B085] mt-1 transition-colors"
                      >
                        {isExpanded ? 'Show less' : 'Show more'}
                      </button>
                    )}
                    {c.outcome && <p className="text-xs text-[#5A5A6A] mt-1.5"><span className="text-[#9898A8]">Outcome:</span> {c.outcome}</p>}
                    {c.follow_up_date && (
                      <div className="mt-2 inline-flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1">
                        <svg className="w-3 h-3 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        <span className="text-xs text-amber-400">Follow up: {new Date(c.follow_up_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        {c.follow_up_notes && <span className="text-xs text-[#9898A8]">— {c.follow_up_notes}</span>}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => togglePin(c)} className={`p-1.5 rounded-lg transition-colors ${c.is_pinned ? 'text-amber-400 hover:text-amber-300' : 'text-[#3A3A45] hover:text-[#9898A8]'}`} title="Pin">
                      <svg className="w-3.5 h-3.5" fill={c.is_pinned ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" /></svg>
                    </button>
                    {isOwn && (
                      <>
                        <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-[#3A3A45] hover:text-[#9898A8] transition-colors" title="Edit">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </button>
                        <button onClick={() => deleteConvo(c.id)} className="p-1.5 rounded-lg text-[#3A3A45] hover:text-red-400 transition-colors" title="Delete">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
