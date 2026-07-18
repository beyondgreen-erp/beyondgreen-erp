'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useState } from 'react'
import { STAGE_TONE, TONES } from '@/lib/portalStages'

const GREEN = '#037f4c'

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-[11px] text-gray-300">—</span>
  const t = TONES[STAGE_TONE[status] || 'gray'] || TONES.gray
  return <span className="text-[11px] font-bold rounded-full px-2.5 py-1 inline-block whitespace-nowrap" style={{ background: t.bg, color: t.text }}>{status}</span>
}

export default function ClientPortalPage() {
  const [phase, setPhase] = useState<'loading' | 'login' | 'app'>('loading')
  const [data, setData] = useState<any | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [msgState, setMsgState] = useState<'idle' | 'sending' | 'sent'>('idle')

  const loadMe = useCallback(async () => {
    const r = await fetch('/api/portal/me', { cache: 'no-store' })
    if (r.ok) { setData(await r.json()); setPhase('app') } else { setPhase('login') }
  }, [])
  useEffect(() => { loadMe() }, [loadMe])

  async function login(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      const r = await fetch('/api/portal/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(j.error || 'Login failed.'); return }
      setPassword(''); await loadMe()
    } finally { setBusy(false) }
  }
  async function logout() {
    await fetch('/api/portal/logout', { method: 'POST' }).catch(() => {})
    setData(null); setEmail(''); setPassword(''); setPhase('login')
  }
  async function sendMessage(e: React.FormEvent) {
    e.preventDefault(); if (!msg.trim()) return
    setMsgState('sending')
    const r = await fetch('/api/portal/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg }) })
    if (r.ok) { setMsg(''); setMsgState('sent'); setTimeout(() => setMsgState('idle'), 4000) } else { setMsgState('idle'); alert('Could not send. Please try again.') }
  }

  if (phase === 'loading') return <div className="min-h-screen grid place-items-center text-gray-400" style={{ background: '#F1F3F7' }}>Loading…</div>

  if (phase === 'login') {
    return (
      <div className="min-h-screen grid place-items-center p-4" style={{ background: '#F1F3F7' }}>
        <div className="w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="w-14 h-14 rounded-2xl mx-auto grid place-items-center text-white font-black text-lg" style={{ background: GREEN }}>bG</div>
            <h1 className="text-xl font-bold text-[#1A1D2E] mt-3">beyondGREEN Client Portal</h1>
            <p className="text-sm text-gray-500 mt-1">Track your projects.</p>
          </div>
          <form onSubmit={login} className="bg-white rounded-2xl border border-[#E4E6EE] p-6 space-y-4 shadow-sm">
            {err && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{err}</div>}
            <label className="block"><span className="text-xs font-medium text-gray-600">Email</span>
              <input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required className="w-full mt-1 bg-white border border-[#E4E6EE] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#037f4c]/40" /></label>
            <label className="block"><span className="text-xs font-medium text-gray-600">Password</span>
              <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required className="w-full mt-1 bg-white border border-[#E4E6EE] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#037f4c]/40" /></label>
            <button type="submit" disabled={busy} className="w-full text-white font-semibold py-2.5 rounded-lg disabled:opacity-50" style={{ background: GREEN }}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
          <p className="text-center text-xs text-gray-400 mt-4">Trouble signing in? Email info@byndgrn.com</p>
        </div>
      </div>
    )
  }

  const projects = data?.projects || []
  const company = data?.client?.company || data?.client?.name || 'Your account'

  return (
    <div className="min-h-screen" style={{ background: '#F1F3F7' }}>
      <div className="text-white" style={{ background: GREEN }}>
        <div className="mx-auto max-w-3xl px-5 py-5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-white/80 text-xs uppercase tracking-wide">beyondGREEN · Client Portal</p>
            <h1 className="text-xl font-bold leading-tight truncate">{company}</h1>
          </div>
          <button onClick={logout} className="text-xs font-semibold bg-white/15 hover:bg-white/25 rounded-lg px-3 py-1.5 shrink-0">Sign out</button>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-5 space-y-6">
        <section>
          <div className="flex items-center justify-between mb-2 px-1">
            <h2 className="font-bold text-[#1A1D2E]">Your Projects <span className="text-gray-400 font-normal">({projects.length})</span></h2>
            <button onClick={loadMe} className="text-xs font-semibold" style={{ color: GREEN }}>↻ Refresh</button>
          </div>
          <div className="space-y-3">
            {projects.length === 0 ? (
              <div className="bg-white rounded-xl border border-[#E4E6EE] p-6 text-center text-sm text-gray-400">No projects to show yet. We&apos;ll add them here as they get going.</div>
            ) : projects.map((p: any) => (
              <div key={p.id} className="bg-white rounded-xl border border-[#E4E6EE] overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[#F1F3F9]">
                  <p className="font-bold text-[#1A1D2E]">{p.name}</p>
                  <StatusBadge status={p.status} />
                </div>
                {p.notes && p.notes.trim() ? (
                  <div className="px-4 py-3">
                    <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Notes</p>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{p.notes}</p>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="font-bold text-[#1A1D2E] mb-2 px-1">Message us</h2>
          <form onSubmit={sendMessage} className="bg-white rounded-xl border border-[#E4E6EE] p-4">
            {msgState === 'sent' && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-lg px-3 py-2 mb-3">Message sent — our team will get back to you.</div>}
            <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={3} placeholder="Ask a question or send us an update…" className="w-full bg-white border border-[#E4E6EE] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#037f4c]/40 resize-none" />
            <div className="flex justify-end mt-2">
              <button type="submit" disabled={msgState === 'sending' || !msg.trim()} className="text-white font-semibold rounded-lg px-4 py-2 text-sm disabled:opacity-50" style={{ background: GREEN }}>{msgState === 'sending' ? 'Sending…' : 'Send message'}</button>
            </div>
          </form>
        </section>

        <p className="text-center text-[11px] text-gray-400 pt-2 pb-8">beyondGREEN Biotech · For anything else, message us above or email info@byndgrn.com.</p>
      </div>
    </div>
  )
}
