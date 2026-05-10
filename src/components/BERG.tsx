'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

type Status = 'ready' | 'listening' | 'thinking' | 'speaking'
type Msg = { role: 'user' | 'berg'; text: string }

/* ─── Jarvis Orb ─────────────────────────────────────────────────────────── */
function JarvisOrb({ status }: { status: Status }) {
  const color = {
    ready:    '#10b981',
    listening:'#3b82f6',
    thinking: '#f59e0b',
    speaking: '#10b981',
  }[status]

  const glowColor = {
    ready:    'rgba(16,185,129,',
    listening:'rgba(59,130,246,',
    thinking: 'rgba(245,158,11,',
    speaking: 'rgba(16,185,129,',
  }[status]

  const bars = Array.from({ length: 16 })

  return (
    <div className="flex flex-col items-center gap-3 py-4 select-none">
      {/* orb wrapper — shake when speaking */}
      <div
        style={{
          animation: status === 'speaking' ? 'berg-shake 0.12s linear infinite' : 'none',
          filter: `drop-shadow(0 0 18px ${glowColor}0.6))`,
        }}
      >
        <div className="relative w-36 h-36 flex items-center justify-center">

          {/* outermost halo */}
          <div className="absolute inset-0 rounded-full"
            style={{
              border: `1px solid ${glowColor}0.15)`,
              animation: 'berg-spin-cw 18s linear infinite',
            }}
          />

          {/* outer ring with dashes */}
          <svg className="absolute inset-0" width="144" height="144" viewBox="0 0 144 144">
            <circle cx="72" cy="72" r="66"
              fill="none"
              stroke={color}
              strokeWidth="1"
              strokeOpacity="0.25"
              strokeDasharray="8 6"
              style={{ animation: 'berg-spin-cw 12s linear infinite', transformOrigin: '72px 72px' }}
            />
            {/* thinking arc */}
            {status === 'thinking' && (
              <circle cx="72" cy="72" r="66"
                fill="none"
                stroke={color}
                strokeWidth="2.5"
                strokeOpacity="0.9"
                strokeDasharray="283"
                strokeDashoffset="283"
                strokeLinecap="round"
                style={{
                  animation: 'berg-think 1.6s ease-in-out infinite',
                  transformOrigin: '72px 72px',
                  transform: 'rotate(-90deg)',
                }}
              />
            )}
          </svg>

          {/* mid ring */}
          <svg className="absolute" width="112" height="112" style={{ top: 16, left: 16 }} viewBox="0 0 112 112">
            <circle cx="56" cy="56" r="50"
              fill="none"
              stroke={color}
              strokeWidth="1"
              strokeOpacity="0.35"
              strokeDasharray="12 4"
              style={{ animation: 'berg-spin-ccw 8s linear infinite', transformOrigin: '56px 56px' }}
            />
          </svg>

          {/* inner ring */}
          <svg className="absolute" width="80" height="80" style={{ top: 32, left: 32 }} viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="34"
              fill="none"
              stroke={color}
              strokeWidth="1.5"
              strokeOpacity="0.5"
              strokeDasharray="5 3"
              style={{ animation: 'berg-spin-cw 5s linear infinite', transformOrigin: '40px 40px' }}
            />
          </svg>

          {/* orbit particles */}
          {[0, 60, 120, 180, 240, 300].map((deg, i) => (
            <div key={i}
              className="absolute w-1.5 h-1.5 rounded-full"
              style={{
                background: color,
                top: `${72 - 52 * Math.sin((deg * Math.PI) / 180) - 3}px`,
                left: `${72 + 52 * Math.cos((deg * Math.PI) / 180) - 3}px`,
                animation: `berg-particle ${1.2 + i * 0.18}s ease-in-out infinite`,
                animationDelay: `${i * 0.2}s`,
              }}
            />
          ))}

          {/* core glow */}
          <div className="absolute rounded-full"
            style={{
              width: 52, height: 52,
              top: 42, left: 42,
              background: `radial-gradient(circle, ${glowColor}0.35) 0%, transparent 70%)`,
              animation: `berg-pulse-glow ${status === 'listening' ? '0.7s' : '2.4s'} ease-in-out infinite`,
            }}
          />

          {/* center B */}
          <div className="relative z-10 w-12 h-12 rounded-full flex items-center justify-center"
            style={{
              background: `radial-gradient(circle, ${glowColor}0.3) 0%, rgba(0,0,0,0.6) 100%)`,
              border: `1.5px solid ${glowColor}0.6)`,
              boxShadow: status === 'listening'
                ? `0 0 0 0 ${glowColor}0), 0 0 16px ${glowColor}0.5)`
                : `0 0 16px ${glowColor}0.4)`,
              animation: status === 'listening' ? 'berg-listen 0.8s ease-in-out infinite' : 'none',
            }}
          >
            <span className="font-black text-xl tracking-tight" style={{ color, fontFamily: 'monospace' }}>B</span>
          </div>
        </div>
      </div>

      {/* status label */}
      <div className="flex flex-col items-center gap-1">
        <p className="text-xs font-bold tracking-[0.25em] uppercase" style={{ color, fontFamily: 'monospace' }}>
          BERG
        </p>
        <p className="text-xs tracking-widest" style={{ color: `${glowColor}0.7)`, fontFamily: 'monospace' }}>
          {status === 'ready' ? '[ ONLINE ]' : status === 'listening' ? '[ LISTENING ]' : status === 'thinking' ? '[ PROCESSING ]' : '[ SPEAKING ]'}
        </p>
      </div>

      {/* waveform — only when speaking or listening */}
      {(status === 'speaking' || status === 'listening') && (
        <div className="flex items-end justify-center gap-0.5 h-6">
          {bars.map((_, i) => (
            <div key={i}
              className="w-1 rounded-full"
              style={{
                background: color,
                minHeight: 3,
                animation: `berg-wave ${0.35 + (i % 4) * 0.08}s ease-in-out infinite alternate`,
                animationDelay: `${i * 0.04}s`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Main BERG component ─────────────────────────────────────────────────── */
export default function BERG() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [open, setOpen] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: 'berg', text: 'BERG online. All 17 modules operational. How may I assist you?' }
  ])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<Status>('ready')
  const [speakEnabled, setSpeakEnabled] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [micPermission, setMicPermission] = useState<'unknown'|'granted'|'denied'>('unknown')
  const [voiceSupported, setVoiceSupported] = useState(false)
  const speakEnabledRef = useRef(false)
  const busyRef = useRef(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const recognitionRef = useRef<unknown>(null)
  const voicesRef = useRef<SpeechSynthesisVoice[]>([])

  // Load voices — async on mobile (fires voiceschanged event)
  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    const load = () => { voicesRef.current = window.speechSynthesis.getVoices() }
    load()
    window.speechSynthesis.addEventListener('voiceschanged', load)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load)
  }, [])

  // Check voice support on mount
  useEffect(() => {
    setVoiceSupported(!!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) // eslint-disable-line @typescript-eslint/no-explicit-any
  }, [])

  useEffect(() => {
    sb.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? ''))
  }, []) // eslint-disable-line

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__openBERG = () => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 350) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return () => { delete (window as any).__openBERG }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs])

  async function buildContext(): Promise<string> {
    try {
      const [
        { count: customers },
        { count: vendors },
        { count: products },
        { data: machines },
        { data: invoices },
        { count: tasks },
        { data: wos },
      ] = await Promise.all([
        sb.from('customers').select('*', { count: 'exact', head: true }).eq('is_active', true),
        sb.from('vendors').select('*', { count: 'exact', head: true }).eq('is_active', true),
        sb.from('products').select('*', { count: 'exact', head: true }).eq('is_active', true),
        sb.from('machines').select('status').eq('is_active', true),
        sb.from('invoices').select('status,due_date').eq('is_active', true),
        sb.from('tasks').select('*', { count: 'exact', head: true }).eq('is_active', true).neq('status', 'Done'),
        sb.from('work_orders').select('status,due_date').eq('is_active', true),
      ])
      const today = new Date().toISOString().slice(0, 10)
      const running  = (machines || []).filter((m: { status: string }) => m.status === 'Running').length
      const down     = (machines || []).filter((m: { status: string }) => m.status === 'Down').length
      const idle     = (machines || []).filter((m: { status: string }) => m.status === 'Idle').length
      const maint    = (machines || []).filter((m: { status: string }) => m.status === 'Maintenance').length
      const overdueInv = (invoices || []).filter(
        (inv: { status: string; due_date: string | null }) => inv.due_date && inv.due_date < today && inv.status !== 'Paid'
      ).length
      const activeWOs   = (wos || []).filter((w: { status: string }) => w.status !== 'Complete').length
      const overdueWOs  = (wos || []).filter(
        (w: { status: string; due_date: string | null }) => w.due_date && w.due_date < today && w.status !== 'Complete'
      ).length
      return [
        `Active customers: ${customers ?? 'unknown'}`,
        `Active vendors: ${vendors ?? 'unknown'}`,
        `Active products/inventory items: ${products ?? 'unknown'}`,
        `Machines — running: ${running}, idle: ${idle}, maintenance: ${maint}, down: ${down}`,
        `Work orders — active: ${activeWOs}, overdue: ${overdueWOs}`,
        `Overdue invoices: ${overdueInv}`,
        `Open tasks: ${tasks ?? 'unknown'}`,
        `Current date: ${today}`,
        `Logged-in user email: ${userEmail}`,
      ].join('\n')
    } catch {
      return `Current date: ${new Date().toISOString().slice(0, 10)}\nLogged-in user email: ${userEmail}`
    }
  }

  // iOS requires speechSynthesis.speak() to be called synchronously within a user
  // gesture. Calling this on button tap before any async work keeps the audio
  // session active so the real utterance is allowed after the fetch completes.
  function unlockSpeech() {
    if (!speakEnabledRef.current || !('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    const warmup = new SpeechSynthesisUtterance(' ')
    warmup.volume = 0
    warmup.rate = 0.1
    window.speechSynthesis.speak(warmup)
  }

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || busyRef.current) return
    busyRef.current = true
    setInput('')
    setMsgs(m => [...m, { role: 'user', text: trimmed }])
    setStatus('thinking')
    try {
      const context = await buildContext()
      const res = await fetch('/api/berg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, context, userEmail }),
      })
      if (!res.ok || !res.body) throw new Error('No response')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let full = ''
      setMsgs(m => [...m, { role: 'berg', text: '' }])
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        full += decoder.decode(value)
        setMsgs(m => {
          const copy = [...m]
          copy[copy.length - 1] = { role: 'berg', text: full }
          return copy
        })
      }
      if (speakEnabledRef.current && full) {
        const spoken = full
          .replace(/#{1,6}\s*/g, '')
          .replace(/\*\*(.+?)\*\*/g, '$1')
          .replace(/\*(.+?)\*/g, '$1')
          .replace(/__(.+?)__/g, '$1')
          .replace(/_(.+?)_/g, '$1')
          .replace(/`{1,3}[^`]*`{1,3}/g, '')
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
          .replace(/^[-*+]\s+/gm, '')
          .replace(/^\d+\.\s+/gm, '')
          .replace(/[|>~]/g, '')
          .replace(/\n{2,}/g, '. ')
          .replace(/\n/g, ', ')
          .trim()
        speakText(spoken)
      } else {
        setStatus('ready')
        busyRef.current = false
      }
    } catch {
      setMsgs(m => [...m, { role: 'berg', text: 'System error. Please stand by.' }])
      setStatus('ready')
      busyRef.current = false
    }
  }

  function speakText(text: string) {
    if (!speakEnabledRef.current || !('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'en-US'
    utterance.rate = 0.9
    utterance.pitch = 1.0
    utterance.volume = 1.0
    const preferred = voicesRef.current.find(v =>
      v.name.includes('Daniel') || v.name.includes('Alex') || v.name.includes('Google UK')
    )
    if (preferred) utterance.voice = preferred
    utterance.onstart = () => setStatus('speaking')
    utterance.onend = () => { setStatus('ready'); busyRef.current = false }
    utterance.onerror = () => { setStatus('ready'); busyRef.current = false }
    setTimeout(() => { window.speechSynthesis.speak(utterance) }, 200)
  }

  async function startListening() {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true })
      setMicPermission('granted')
    } catch {
      setMicPermission('denied')
      setStatus('ready')
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { setStatus('ready'); return }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition: any = new SR()
    recognitionRef.current = recognition
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = 'en-US'
    recognition.maxAlternatives = 1
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onstart = () => { setIsListening(true); setStatus('listening') }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript
      setIsListening(false)
      setStatus('ready')
      setInput(transcript)
      setTimeout(() => send(transcript), 100)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (event: any) => {
      setIsListening(false)
      if (event.error === 'not-allowed') setMicPermission('denied')
      setStatus('ready')
    }
    recognition.onend = () => { setIsListening(false); if (status === 'listening') setStatus('ready') }
    setTimeout(() => {
      try { recognition.start() } catch { setStatus('ready') }
    }, 150)
  }

  function stopListening() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (recognitionRef.current) { try { (recognitionRef.current as any).stop() } catch { /* ignore */ } }
    setIsListening(false)
    setStatus('ready')
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
  }

  const inp = 'flex-1 bg-gray-900 border border-gray-700 text-white placeholder-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none transition'

  return (
    <>
      <div className="fixed bottom-24 right-4 md:bottom-6 md:right-6 z-50 flex flex-col items-end gap-3">
        {/* panel */}
        <div
          className={`transition-all duration-300 ease-in-out origin-bottom-right ${
            open ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-4 pointer-events-none'
          }`}
          style={{ width: 'min(400px, calc(100vw - 32px))' }}
        >
          <div
            className="w-full bg-gray-950 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            style={{
              border: '1px solid rgba(16,185,129,0.25)',
              boxShadow: '0 0 40px rgba(16,185,129,0.08), 0 25px 60px rgba(0,0,0,0.6)',
              maxHeight: '85vh',
            }}
          >
            {/* top bar */}
            <div className="flex items-center justify-between px-4 pt-3 pb-0 shrink-0">
              <span className="text-xs text-emerald-500/50 font-mono tracking-widest">beyondGREEN ERP v1.0</span>
              <button onClick={() => setOpen(false)} className="text-gray-600 hover:text-gray-300 p-1 rounded transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Jarvis orb */}
            <JarvisOrb status={status} />

            {/* divider */}
            <div className="mx-4 border-t border-emerald-500/10 mb-3" />

            {/* messages */}
            <div className="flex-1 overflow-y-auto px-4 pb-2 space-y-3 min-h-0" style={{ maxHeight: 260 }}>
              {msgs.map((m, i) => (
                <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {m.role === 'berg' && (
                    <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                      style={{ background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.4)' }}>
                      <span className="text-emerald-400 font-black text-xs" style={{ fontFamily: 'monospace' }}>B</span>
                    </div>
                  )}
                  <div
                    className={`max-w-[82%] rounded-xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
                      m.role === 'user'
                        ? 'bg-blue-600/80 text-white rounded-tr-sm'
                        : 'text-emerald-100 rounded-tl-sm'
                    }`}
                    style={m.role === 'berg' ? {
                      background: 'rgba(16,185,129,0.07)',
                      border: '1px solid rgba(16,185,129,0.15)',
                      fontFamily: 'monospace',
                      fontSize: '0.8rem',
                    } : {}}
                  >
                    {m.text || (
                      <span className="flex gap-1 items-center py-0.5">
                        {[0, 150, 300].map(d => (
                          <span key={d} className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: `${d}ms` }} />
                        ))}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* iOS Safari mic hint — shown on first open when voice is supported */}
            {voiceSupported && micPermission === 'unknown' && (
              <div className="mx-3 mb-2 px-3 py-2 rounded-lg text-[10px] text-gray-500 border border-gray-800 bg-gray-900/50 leading-relaxed">
                Using Safari on iPhone? Tap the mic and <strong className="text-gray-400">allow microphone</strong> when prompted.
                Chrome on iPhone does not support voice.
              </div>
            )}
            {micPermission === 'denied' && (
              <div className="mx-3 mb-2 px-3 py-2 rounded-lg text-[10px] text-red-500 border border-red-900/40 bg-red-900/10 leading-relaxed">
                Mic blocked. Go to iPhone Settings → Safari → Microphone → Allow.
              </div>
            )}

            {/* input */}
            <div className="shrink-0 px-3 py-3 border-t border-emerald-500/10 bg-gray-950">
              <div className="flex items-end gap-2">
                {voiceSupported ? (
                  <button
                    onClick={isListening ? stopListening : startListening}
                    disabled={busyRef.current && !isListening}
                    title={isListening ? 'Tap to stop' : micPermission === 'denied' ? 'Mic blocked — check Safari Settings' : 'Voice input'}
                    className={`p-2 rounded-xl border transition-colors shrink-0 ${
                      isListening
                        ? 'border-red-500 text-red-400 bg-red-500/20 animate-pulse'
                        : micPermission === 'denied'
                        ? 'border-red-800 text-red-600'
                        : 'border-gray-700 text-gray-500 hover:text-emerald-400 hover:border-emerald-700'
                    } disabled:opacity-40`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                  </button>
                ) : (
                  <span className="text-[10px] text-gray-600 px-1 shrink-0">Type to chat</span>
                )}
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder="Query BERG…"
                  disabled={busyRef.current}
                  className={inp}
                  style={{ minHeight: 36, maxHeight: 80, fontFamily: 'monospace', fontSize: '0.8rem' }}
                />
                <button
                  onClick={() => setSpeakEnabled(v => { speakEnabledRef.current = !v; return !v })}
                  title={speakEnabled ? 'Mute voice output' : 'Enable voice output'}
                  className={`p-2 rounded-xl border transition-colors shrink-0 ${
                    speakEnabled
                      ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10'
                      : 'border-gray-700 text-gray-500 hover:text-emerald-400 hover:border-emerald-700'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M12 6v12m0 0l-3-3m3 3l3-3" />
                  </svg>
                </button>
                <button
                  onClick={() => { unlockSpeech(); send(input) }}
                  disabled={!input.trim() || busyRef.current}
                  className="p-2 rounded-xl transition-colors shrink-0 disabled:opacity-30"
                  style={{ background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.4)', color: '#10b981' }}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* floating trigger */}
        <div className="relative group">
          <div className={`absolute inset-0 rounded-full ${!open ? 'animate-ping' : ''}`}
            style={{ background: 'rgba(16,185,129,0.25)' }} />
          <button
            onClick={() => { setOpen(v => !v); setTimeout(() => inputRef.current?.focus(), 350) }}
            title="BERG"
            className="relative w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-lg"
            style={{
              background: 'radial-gradient(circle, rgba(16,185,129,0.3) 0%, rgba(0,0,0,0.8) 100%)',
              border: '2px solid rgba(16,185,129,0.6)',
              boxShadow: '0 0 20px rgba(16,185,129,0.35)',
              color: '#10b981',
            }}
          >
            {open
              ? <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              : <span className="font-black text-xl" style={{ fontFamily: 'monospace' }}>B</span>
            }
          </button>
          {!open && (
            <span className="absolute right-16 top-1/2 -translate-y-1/2 bg-gray-900 text-emerald-400 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none border border-emerald-500/20 font-mono">
              BERG — Online
            </span>
          )}
        </div>
      </div>
    </>
  )
}
