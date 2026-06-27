'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import UserAvatar from '@/components/UserAvatar'

export interface DMPeer { email: string; name?: string; color?: string; initials?: string }
interface DM { id: string; sender_email: string; sender_name: string | null; recipient_email: string; content: string; created_at: string }
interface Win {
  peer: DMPeer
  msgs: DM[]
  minimized: boolean
  unread: number
  pos: { x: number; y: number }
}

const FALLBACK_COLORS = ['#059669', '#2563EB', '#7C3AED', '#D97706', '#DC2626', '#0D9488', '#DB2777']
function colorFor(email: string) { return FALLBACK_COLORS[email.charCodeAt(0) % FALLBACK_COLORS.length] }
function initialsFor(name?: string, email?: string) {
  if (name && name.trim()) return name.trim().split(/\s+/).map(n => n[0]).join('').slice(0, 2).toUpperCase()
  return (email || '?').slice(0, 2).toUpperCase()
}
function shortName(p: DMPeer) { return p.name || p.email.split('@')[0] }
function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/* ---------- loud ping via Web Audio (no asset needed) ---------- */
let audioCtx: AudioContext | null = null
function ensureAudio() {
  if (typeof window === 'undefined') return null
  if (!audioCtx) { try { audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)() } catch { return null } }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {})
  return audioCtx
}
function playPing() {
  const ctx = ensureAudio(); if (!ctx) return
  const now = ctx.currentTime
  const master = ctx.createGain()
  master.gain.value = 0.0001
  master.connect(ctx.destination)
  // two-tone, deliberately loud + bright so it's heard across the room
  const tones = [{ f: 880, t: 0 }, { f: 1320, t: 0.14 }]
  tones.forEach(({ f, t }) => {
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(f, now + t)
    g.gain.setValueAtTime(0.0001, now + t)
    g.gain.exponentialRampToValueAtTime(0.6, now + t + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.22)
    osc.connect(g); g.connect(master)
    osc.start(now + t); osc.stop(now + t + 0.24)
  })
}

export default function DirectMessages() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [me, setMe] = useState<{ email: string; name: string } | null>(null)
  const meRef = useRef<{ email: string; name: string } | null>(null)
  const [wins, setWins] = useState<Win[]>([])
  const winsRef = useRef<Win[]>([])
  winsRef.current = wins

  useEffect(() => { meRef.current = me }, [me])

  /* resume audio on first user gesture (browser autoplay policy) */
  useEffect(() => {
    const unlock = () => ensureAudio()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock) }
  }, [])

  /* who am I */
  useEffect(() => {
    sb.auth.getUser().then(async ({ data }) => {
      const email = data.user?.email; if (!email) return
      let name = email.split('@')[0]
      try {
        const { data: p } = await sb.from('user_profiles').select('full_name,display_name').eq('email', email).single()
        if (p?.display_name) name = p.display_name; else if (p?.full_name) name = p.full_name
      } catch { /* ignore */ }
      setMe({ email, name })
    })
  }, []) // eslint-disable-line

  const markRead = useCallback((peerEmail: string) => {
    const m = meRef.current; if (!m) return
    sb.from('direct_messages').update({ read_at: new Date().toISOString() })
      .eq('recipient_email', m.email).eq('sender_email', peerEmail).is('read_at', null)
      .then(() => {})
  }, [sb])

  const loadHistory = useCallback(async (peerEmail: string) => {
    const m = meRef.current; if (!m) return [] as DM[]
    const { data } = await sb.from('direct_messages').select('*')
      .or(`and(sender_email.eq.${m.email},recipient_email.eq.${peerEmail}),and(sender_email.eq.${peerEmail},recipient_email.eq.${m.email})`)
      .order('created_at', { ascending: true }).limit(200)
    return (data || []) as DM[]
  }, [sb])

  const openWindow = useCallback(async (peer: DMPeer) => {
    setWins(prev => {
      const existing = prev.find(w => w.peer.email === peer.email)
      if (existing) return prev.map(w => w.peer.email === peer.email ? { ...w, minimized: false, unread: 0 } : w)
      return [...prev, { peer, msgs: [], minimized: false, unread: 0, pos: { x: 0, y: 0 } }]
    })
    markRead(peer.email)
    const hist = await loadHistory(peer.email)
    setWins(prev => prev.map(w => w.peer.email === peer.email ? { ...w, msgs: hist } : w))
  }, [loadHistory, markRead])

  /* expose opener to the rest of the app (dashboard avatars call this) */
  useEffect(() => {
    ;(window as any).__openDM = (peer: DMPeer | string) => {
      const p: DMPeer = typeof peer === 'string' ? { email: peer } : peer
      openWindow(p)
    }
    return () => { delete (window as any).__openDM }
  }, [openWindow])

  /* realtime: RLS limits delivered rows to ones where I'm a participant */
  useEffect(() => {
    if (!me) return
    const ch = sb.channel('dm_stream_' + me.email)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, (payload) => {
        const dm = payload.new as DM
        const m = meRef.current; if (!m) return
        const incoming = dm.sender_email !== m.email
        const peerEmail = incoming ? dm.sender_email : dm.recipient_email
        setWins(prev => {
          const idx = prev.findIndex(w => w.peer.email === peerEmail)
          if (idx === -1) {
            if (!incoming) return prev
            // pop open a minimized window for an unexpected new sender
            const peer: DMPeer = { email: peerEmail, name: dm.sender_name || undefined }
            return [...prev, { peer, msgs: [dm], minimized: true, unread: 1, pos: { x: 0, y: 0 } }]
          }
          return prev.map((w, i) => {
            if (i !== idx) return w
            if (w.msgs.some(x => x.id === dm.id)) return w
            const focused = !w.minimized
            return { ...w, msgs: [...w.msgs, dm], unread: focused ? 0 : w.unread + (incoming ? 1 : 0) }
          })
        })
        if (incoming) {
          playPing()
          markRead(peerEmail)
        }
      })
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [me, sb, markRead])

  if (!me) return null
  return (
    <div className="fixed bottom-0 right-0 z-[70] hidden md:flex flex-row-reverse items-end gap-3 p-4 pointer-events-none">
      {wins.map((w) => (
        <DMWindow
          key={w.peer.email}
          me={me}
          win={w}
          sb={sb}
          onClose={() => setWins(prev => prev.filter(x => x.peer.email !== w.peer.email))}
          onToggleMin={() => setWins(prev => prev.map(x => x.peer.email === w.peer.email ? { ...x, minimized: !x.minimized, unread: x.minimized ? 0 : x.unread } : x))}
          onFocusRead={() => { setWins(prev => prev.map(x => x.peer.email === w.peer.email ? { ...x, unread: 0 } : x)); markRead(w.peer.email) }}
        />
      ))}
    </div>
  )
}

function DMWindow({ me, win, sb, onClose, onToggleMin, onFocusRead }: {
  me: { email: string; name: string }; win: Win; sb: any
  onClose: () => void; onToggleMin: () => void; onFocusRead: () => void
}) {
  const { peer } = win
  const color = peer.color || colorFor(peer.email)
  const initials = peer.initials || initialsFor(peer.name, peer.email)
  const [input, setInput] = useState('')
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (!win.minimized) setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 40) }, [win.msgs.length, win.minimized])

  /* dragging by the header */
  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => setPos({ x: e.clientX - drag.dx, y: e.clientY - drag.dy })
    const up = () => setDrag(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [drag])

  function startDrag(e: React.PointerEvent) {
    const r = boxRef.current?.getBoundingClientRect()
    if (!r) return
    setPos({ x: r.left, y: r.top })
    setDrag({ dx: e.clientX - r.left, dy: e.clientY - r.top })
  }

  async function send() {
    const text = input.trim(); if (!text) return
    setInput('')
    await sb.from('direct_messages').insert({
      sender_email: me.email, sender_name: me.name, recipient_email: peer.email, content: text,
    })
  }

  // floating position: dragged (fixed) or default stacked along the bottom-right
  const floatStyle: React.CSSProperties = pos
    ? { position: 'fixed', left: Math.max(8, pos.x), top: Math.max(8, pos.y), right: 'auto', bottom: 'auto' }
    : {}

  return (
    <div
      ref={boxRef}
      className="pointer-events-auto w-[320px] rounded-2xl shadow-2xl border border-[#E4E6EE] bg-white overflow-hidden flex flex-col"
      style={{ height: win.minimized ? 48 : 420, ...floatStyle }}
    >
      {/* header (drag handle) */}
      <div
        onPointerDown={startDrag}
        onDoubleClick={onToggleMin}
        className="flex items-center gap-2 px-3 h-12 shrink-0 cursor-move select-none"
        style={{ background: color }}
      >
        <UserAvatar email={peer.email} initials={initials} color={color} size={28} />
        <div className="flex-1 min-w-0" onClick={onFocusRead}>
          <p className="text-white text-sm font-semibold truncate leading-tight">{shortName(peer)}</p>
          <p className="text-white/70 text-[10px] truncate leading-tight">{peer.email}</p>
        </div>
        {win.unread > 0 && win.minimized && (
          <span className="w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">{win.unread > 9 ? '9+' : win.unread}</span>
        )}
        <button onClick={onToggleMin} title={win.minimized ? 'Expand' : 'Minimize'} className="text-white/80 hover:text-white p-1 rounded hover:bg-white/15">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d={win.minimized ? 'M5 15l7-7 7 7' : 'M5 12h14'} /></svg>
        </button>
        <button onClick={onClose} title="Close" className="text-white/80 hover:text-white p-1 rounded hover:bg-white/15">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      {!win.minimized && (
        <>
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-[#F8F9FB]" onClick={onFocusRead}>
            {win.msgs.length === 0 && <p className="text-center text-gray-400 text-xs mt-6">Say hello to {shortName(peer)} 👋</p>}
            {win.msgs.map(m => {
              const mine = m.sender_email === me.email
              return (
                <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${mine ? 'text-white rounded-br-sm' : 'bg-white border border-[#E4E6EE] text-[#1A1D2E] rounded-bl-sm'}`}
                    style={mine ? { background: color } : undefined}>
                    <p className="whitespace-pre-wrap break-words leading-snug">{m.content}</p>
                    <p className={`text-[10px] mt-0.5 ${mine ? 'text-white/70' : 'text-gray-400'}`}>{timeAgo(m.created_at)}</p>
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>
          <div className="shrink-0 p-2 border-t border-[#E4E6EE] flex gap-2 items-end bg-white">
            <textarea
              rows={1} value={input}
              onChange={e => setInput(e.target.value)}
              onFocus={onFocusRead}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder={`Message ${shortName(peer)}…`}
              className="flex-1 resize-none rounded-xl border border-[#E4E6EE] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              style={{ minHeight: 38, maxHeight: 96 }}
            />
            <button onClick={send} disabled={!input.trim()} className="p-2 rounded-xl text-white disabled:opacity-40 shrink-0" style={{ background: color }}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
