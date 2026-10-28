'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Team chat alerts — mounted once for the whole app.
 *  · a "ping" sound on every new message sent to you (not your own, not muted conversations,
 *    not the conversation you already have open on screen)
 *  · a pop-up card (top-right) with who + a preview; click it to open that chat
 *  · a desktop notification when the ERP tab is in the background (after you allow it)
 *  · the tab title flashes "(2) New message" until you come back
 * Sound / desktop alerts can be switched off from the card and are remembered on this device.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Alert { id: string; conv: string; who: string; title: string; text: string; at: number }
const LS_SOUND = 'chat.alert.sound'
const LS_ASKED = 'chat.alert.asked'
const strip = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()

let audioCtx: AudioContext | null = null
function ctx() {
  if (typeof window === 'undefined') return null
  if (!audioCtx) { const C = (window as any).AudioContext || (window as any).webkitAudioContext; if (C) audioCtx = new C() }
  return audioCtx
}
export function playPing() {
  const c = ctx(); if (!c) return
  if (c.state === 'suspended') c.resume().catch(() => {})
  const now = c.currentTime
  ;[[880, 0], [1320, 0.12]].forEach(([f, t]) => {
    const o = c.createOscillator(), g = c.createGain()
    o.type = 'sine'; o.frequency.value = f
    g.gain.setValueAtTime(0.0001, now + t); g.gain.exponentialRampToValueAtTime(0.35, now + t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.28)
    o.connect(g); g.connect(c.destination); o.start(now + t); o.stop(now + t + 0.3)
  })
}

export default function ChatAlerts() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [me, setMe] = useState('')
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [sound, setSound] = useState(true)
  const [perm, setPerm] = useState<string>('default')
  const names = useRef<Record<string, string>>({})
  const convs = useRef<Record<string, { muted: boolean; title: string }>>({})
  const unseen = useRef(0)
  const baseTitle = useRef('')
  const flash = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    try { setSound(localStorage.getItem(LS_SOUND) !== 'off') } catch { /* ignore */ }
    if (typeof Notification !== 'undefined') setPerm(Notification.permission)
    sb.auth.getUser().then(({ data }: any) => setMe((data.user?.email || '').toLowerCase()))
    sb.from('user_profiles').select('email,full_name').then(({ data }: any) => {
      for (const p of (data as any[]) || []) names.current[String(p.email).toLowerCase()] = p.full_name || String(p.email).split('@')[0]
    })
    // browsers only allow sound after the person has clicked something on the page
    const unlock = () => { const c = ctx(); if (c && c.state === 'suspended') c.resume().catch(() => {}) }
    window.addEventListener('pointerdown', unlock, { once: false })
    window.addEventListener('keydown', unlock, { once: false })
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock) }
  }, [sb])

  const loadConvs = useCallback(async () => {
    const { data } = await sb.rpc('chat_overview')
    const m: Record<string, { muted: boolean; title: string }> = {}
    for (const c of (data as any[]) || []) m[c.id] = { muted: !!c.muted, title: c.kind === 'group' ? `# ${c.name || 'Group'}` : 'Direct message' }
    convs.current = m
  }, [sb])
  useEffect(() => { loadConvs() }, [loadConvs])

  // tab title: flash while hidden, restore on return
  const stopFlash = useCallback(() => {
    unseen.current = 0
    if (flash.current) { clearInterval(flash.current); flash.current = null }
    if (baseTitle.current) document.title = baseTitle.current
  }, [])
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') stopFlash() }
    document.addEventListener('visibilitychange', onVis); window.addEventListener('focus', stopFlash)
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', stopFlash) }
  }, [stopFlash])

  const openChat = useCallback((conv: string) => {
    window.dispatchEvent(new CustomEvent('open-team-chat', { detail: { conversationId: conv } }))
    setAlerts(a => a.filter(x => x.conv !== conv)); stopFlash()
  }, [stopFlash])

  useEffect(() => {
    if (!me) return
    const ch = sb.channel('chat-alerts')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, async (payload: any) => {
        const m = payload.new
        if (!m || String(m.sender_email || '').toLowerCase() === me) return
        if (!convs.current[m.conversation_id]) await loadConvs()
        const c = convs.current[m.conversation_id]
        if (!c || c.muted) return                                   // not mine, or muted
        const hidden = document.visibilityState !== 'visible'
        const w = window as any
        if (!hidden && w.__teamChatActive === m.conversation_id && w.__teamChatVisible) return   // already reading it
        const who = names.current[String(m.sender_email).toLowerCase()] || String(m.sender_email).split('@')[0]
        const mentioned = Array.isArray(m.mentions) && m.mentions.map((x: string) => String(x).toLowerCase()).includes(me)
        const text = (strip(m.body_text || m.body_html || '') || ((m.attachments || []).length ? '📎 sent a file' : 'New message')).slice(0, 140)
        const title = c.title === 'Direct message' ? `${who} messaged you` : `${who} in ${c.title}${mentioned ? ' · mentioned you' : ''}`
        if (sound) playPing()
        setAlerts(a => [{ id: m.id, conv: m.conversation_id, who, title, text, at: Date.now() }, ...a.filter(x => x.conv !== m.conversation_id)].slice(0, 4))
        if (hidden) {
          unseen.current += 1
          if (!baseTitle.current || !document.title.startsWith('(')) baseTitle.current = document.title
          if (!flash.current) {
            let on = false
            flash.current = setInterval(() => { on = !on; document.title = on ? `(${unseen.current}) 💬 New message` : baseTitle.current }, 1200)
          }
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            try {
              const n = new Notification(title, { body: text, tag: 'chat-' + m.conversation_id, icon: '/favicon.ico' })
              n.onclick = () => { window.focus(); openChat(m.conversation_id); n.close() }
            } catch { /* some browsers only allow notifications from a service worker */ }
          }
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_members' }, () => { loadConvs() })
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [sb, me, sound, loadConvs, openChat])

  // cards fade out on their own after 12 s
  useEffect(() => {
    if (!alerts.length) return
    const t = setTimeout(() => setAlerts(a => a.filter(x => Date.now() - x.at < 12000)), 12500)
    return () => clearTimeout(t)
  }, [alerts])

  function toggleSound() { const v = !sound; setSound(v); try { localStorage.setItem(LS_SOUND, v ? 'on' : 'off') } catch { /* ignore */ } if (v) playPing() }
  async function askDesktop() {
    if (typeof Notification === 'undefined') return
    try { const p = await Notification.requestPermission(); setPerm(p); localStorage.setItem(LS_ASKED, '1') } catch { /* ignore */ }
  }

  if (!alerts.length) return null
  return (
    <div className="fixed z-[95] top-16 right-3 left-3 sm:left-auto sm:w-[360px] space-y-2 pointer-events-none">
      {alerts.map(a => (
        <div key={a.id} className="pointer-events-auto bg-white rounded-2xl shadow-2xl border border-[#E4E6EE] overflow-hidden animate-[fadeIn_.2s_ease-out]" style={{ borderLeft: '5px solid #0F7A4E' }}>
          <button onClick={() => openChat(a.conv)} className="w-full text-left px-4 pt-3 pb-2">
            <p className="text-[12px] font-bold text-[#0F7A4E] flex items-center gap-1.5">💬 {a.title}</p>
            <p className="text-[13px] text-[#1A1D2E] mt-0.5 line-clamp-2">{a.text}</p>
          </button>
          <div className="px-4 pb-2.5 flex items-center gap-3 text-[11px]">
            <button onClick={() => openChat(a.conv)} className="font-semibold text-[#0F7A4E] hover:underline">Open chat</button>
            <button onClick={() => setAlerts(x => x.filter(y => y.id !== a.id))} className="text-gray-400 hover:text-gray-600">Dismiss</button>
            <span className="ml-auto flex items-center gap-2">
              <button onClick={toggleSound} className="text-gray-400 hover:text-gray-600" title={sound ? 'Turn the ping off on this device' : 'Turn the ping on'}>{sound ? '🔔 Sound on' : '🔕 Sound off'}</button>
              {perm === 'default' && <button onClick={askDesktop} className="text-gray-400 hover:text-gray-600" title="Get a pop-up even when the ERP tab is in the background">🖥 Desktop alerts</button>}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
