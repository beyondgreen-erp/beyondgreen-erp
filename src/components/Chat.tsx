'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import UserAvatar from '@/components/UserAvatar'

type Channel = 'general' | 'sales' | 'production' | 'bizdev'
interface Msg { id: string; channel: string; sender_email: string; sender_name: string; content: string; created_at: string }

const CHANNELS: { id: Channel; label: string; color: string }[] = [
  { id: 'general', label: 'General', color: 'text-gray-500' },
  { id: 'sales', label: 'Sales', color: 'text-blue-400' },
  { id: 'production', label: 'Production', color: 'text-emerald-400' },
  { id: 'bizdev', label: 'BizDev', color: 'text-violet-400' },
]

const AVATAR_COLORS = ['bg-emerald-600','bg-blue-600','bg-violet-600','bg-amber-600','bg-red-600','bg-teal-600','bg-pink-600']
function avatarColor(email: string) { return AVATAR_COLORS[email.charCodeAt(0) % AVATAR_COLORS.length] }
function initials(name: string) { return name.slice(0, 2).toUpperCase() }

function timeAgo(iso: string) {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function renderContent(text: string) {
  const parts = text.split(/(@[\w.@+-]+)/g)
  return parts.map((part, i) =>
    part.startsWith('@') ? <span key={i} className="text-emerald-400 font-medium bg-emerald-500/10 rounded px-0.5">{part}</span> : part
  )
}

export default function Chat() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [open, setOpen] = useState(false)
  const [channel, setChannel] = useState<Channel>('general')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [allUsers, setAllUsers] = useState<string[]>([])
  const [unread, setUnread] = useState(0)
  const [showDrop, setShowDrop] = useState(false)
  const [dropQuery, setDropQuery] = useState('')
  const [dropIdx, setDropIdx] = useState(0)
  const [atPos, setAtPos] = useState(-1)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    sb.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null))
    sb.from('user_presence').select('email').then(({ data }) => {
      if (data) setAllUsers(data.map((u: { email: string }) => u.email))
    })
  }, []) // eslint-disable-line

  useEffect(() => {
    function load() {
      sb.from('messages').select('*').eq('channel', channel).order('created_at', { ascending: true }).limit(100)
        .then(({ data }) => { if (data) setMsgs(data as Msg[]) })
    }
    load()
    const ch = sb.channel('chat_' + channel)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel=eq.${channel}` },
        (payload) => {
          const m = payload.new as Msg
          setMsgs(prev => [...prev, m])
          if (!open) setUnread(u => u + 1)
        })
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [channel]) // eslint-disable-line

  useEffect(() => {
    if (open) setUnread(0)
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }, [open, msgs.length])

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__openChat = () => setOpen(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return () => { delete (window as any).__openChat }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__chatUnread = unread
  }, [unread])

  const filteredUsers = allUsers.filter(u => u.toLowerCase().includes(dropQuery.toLowerCase()) && u !== userEmail)

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value
    setInput(v)
    const pos = e.target.selectionStart ?? 0
    const before = v.slice(0, pos)
    const m = before.match(/@([\w.]*)$/)
    if (m) { setAtPos(pos - m[0].length); setDropQuery(m[1]); setShowDrop(true); setDropIdx(0) }
    else { setShowDrop(false); setAtPos(-1); setDropQuery('') }
  }

  function selectMention(email: string) {
    if (atPos < 0) return
    const before = input.slice(0, atPos)
    const afterAt = input.slice(atPos)
    const spaceIdx = afterAt.search(/\s/)
    const after = spaceIdx >= 0 ? afterAt.slice(spaceIdx) : ''
    const next = `${before}@${email} ${after}`
    setInput(next); setShowDrop(false); setAtPos(-1); setDropQuery('')
    setTimeout(() => { inputRef.current?.focus() }, 0)
  }

  async function sendMsg() {
    const trimmed = input.trim()
    if (!trimmed || !userEmail) return
    try{const _m=(trimmed.match(/@[\w.+-]+(?:@[\w.-]+\.[a-zA-Z]+)?/g)||[]).map(function(s){return s.slice(1).toLowerCase()});if(_m.length)fetch('/api/notify-mentions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mentions:_m,body:trimmed,authorName:userEmail.split(String.fromCharCode(64))[0],authorEmail:userEmail,recordId:channel,recordType:'Company Chat',recordUrl:location.href})}).catch(function(){});}catch(_e){}setInput(''); setShowDrop(false)
    const name = userEmail.split('@')[0]
    await sb.from('messages').insert({ channel, sender_email: userEmail, sender_name: name, content: trimmed })
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (showDrop && filteredUsers.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setDropIdx(i => (i + 1) % filteredUsers.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setDropIdx(i => (i - 1 + filteredUsers.length) % filteredUsers.length); return }
      if (e.key === 'Enter') { e.preventDefault(); selectMention(filteredUsers[dropIdx]); return }
      if (e.key === 'Escape') { setShowDrop(false); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg() }
  }

  return (
    <>
      {/* backdrop — above mobile nav (z-40) so it blocks interaction */}
      <div
        className={`fixed inset-0 bg-black/40 z-50 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setOpen(false)}
      />

      {/* chat panel — full-screen on mobile, 480px drawer on desktop */}
      <div
        className={`fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-full md:w-[480px] z-[60] transition-transform duration-300 ease-in-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="h-full bg-white md:border-l md:border-[#E4E6EE] flex flex-col shadow-2xl">

          {/* header — push below iOS status bar */}
          <div
            className="flex items-center gap-3 px-5 border-b border-[#E4E6EE] shrink-0"
            style={{ paddingTop: 'max(16px, env(safe-area-inset-top))', paddingBottom: '16px' }}
          >
            <svg className="w-5 h-5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p className="text-[#1A1D2E] font-semibold flex-1">Company Chat</p>
            <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-gray-700 p-2 rounded-lg hover:bg-[#F5F6FA] transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* channel tabs */}
          <div className="flex border-b border-[#E4E6EE] shrink-0">
            {CHANNELS.map(c => (
              <button key={c.id} onClick={() => setChannel(c.id)}
                className={`flex-1 py-3 text-xs font-semibold transition-colors border-b-2 ${channel === c.id ? `${c.color} border-current` : 'text-gray-500 border-transparent hover:text-gray-600'}`}>
                {c.label}
              </button>
            ))}
          </div>

          {/* messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 overscroll-contain">
            {msgs.length === 0 && (
              <div className="flex items-center justify-center h-full">
                <p className="text-gray-600 text-sm">No messages yet. Start the conversation!</p>
              </div>
            )}
            {msgs.map((m) => (
              <div key={m.id} className="flex gap-3">
                <UserAvatar email={m.sender_email} initials={initials(m.sender_name || m.sender_email)} color="#3B6FE0" size={32} className="mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-[#1A1D2E] text-sm font-medium">{m.sender_name || m.sender_email.split('@')[0]}</span>
                    <span className="text-gray-600 text-xs">{timeAgo(m.created_at)}</span>
                  </div>
                  <p className="text-gray-500 text-sm mt-0.5 leading-relaxed whitespace-pre-wrap break-words">{renderContent(m.content)}</p>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* input — respect home bar on iPhone */}
          <div
            className="shrink-0 px-4 pt-3 border-t border-[#E4E6EE]"
            style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
          >
            <div className="relative">
              {showDrop && filteredUsers.length > 0 && (
                <div className="absolute z-10 bottom-full mb-2 left-0 right-0 bg-white border border-[#E4E6EE] rounded-xl shadow-xl overflow-hidden">
                  {filteredUsers.slice(0, 6).map((u, i) => (
                    <button key={u} type="button" onMouseDown={() => selectMention(u)}
                      className={`w-full text-left px-3 py-3 text-sm flex items-center gap-2 transition-colors ${i === dropIdx ? 'bg-emerald-600/20 text-emerald-300' : 'text-gray-500 hover:bg-[#F5F6FA]'}`}>
                      <UserAvatar email={u} initials={u[0].toUpperCase()} color="#3B6FE0" size={28} />
                      <span className="truncate text-sm">{u}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2 items-end">
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={handleInput}
                  onKeyDown={handleKey}
                  placeholder={`Message #${channel}…`}
                  className="flex-1 bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none transition"
                  style={{ minHeight: 44, maxHeight: 120 }}
                />
                <button onClick={sendMsg} disabled={!input.trim()}
                  className="p-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-[#F5F6FA] disabled:text-gray-600 text-white transition-colors shrink-0">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>
    </>
  )
}

export function ChatTrigger() {
  const [unread, setUnread] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => {
      setUnread((window as Window & { __chatUnread?: number }).__chatUnread ?? 0)
    }, 1000)
    return () => clearInterval(interval)
  }, [])
  function open() { (window as Window & { __openChat?: () => void }).__openChat?.() }
  return (
    <button onClick={open} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-700 hover:bg-[#F5F6FA]/50 transition-colors w-full relative">
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
      <span>Company Chat</span>
      {unread > 0 && (
        <span className="ml-auto w-4 h-4 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  )
}
