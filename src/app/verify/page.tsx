'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
/** Confirm this device once with an emailed code. Remembered devices pass straight through. */
export const dynamic = 'force-dynamic'
import { useEffect, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

function safeNext(): string {
  if (typeof window === 'undefined') return '/'
  const n = new URLSearchParams(window.location.search).get('next') || '/'
  return n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/verify') ? n : '/'
}

export default function VerifyDevice() {
  const [phase, setPhase] = useState<'checking' | 'ask' | 'sent'>('checking')
  const [to, setTo] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const codeRef = useRef<HTMLInputElement>(null)

  const call = async (action: string, body: any = {}) => {
    const r = await fetch('/api/staff-2fa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, action }) })
    return { status: r.status, data: await r.json().catch(() => ({})) }
  }
  const go = () => { window.location.replace(safeNext()) }

  useEffect(() => {
    call('status').then(({ status, data }) => {
      if (status === 401) { window.location.replace('/login?next=' + encodeURIComponent(safeNext())); return }
      if (data.verified) { go(); return }
      setTo(data.email || ''); setPhase('ask')
      // send the code right away so nobody waits on a button they did not see
      send()
    })
  }, []) // eslint-disable-line

  async function send() {
    setBusy(true); setMsg('')
    const { data } = await call('send-code')
    setBusy(false)
    if (data.error) { setMsg(data.error); return }
    setTo(data.to || to); setPhase('sent'); setTimeout(() => codeRef.current?.focus(), 50)
  }
  async function verify(e?: React.FormEvent) {
    e?.preventDefault()
    const code = (codeRef.current?.value || '').replace(/\D/g, '')
    if (code.length !== 6) { setMsg('Enter the 6-digit code.'); return }
    setBusy(true); setMsg('')
    const { data } = await call('verify', { code })
    setBusy(false)
    if (data.error) { setMsg(data.error); return }
    go()
  }
  async function signOut() {
    await createSupabaseBrowserClient().auth.signOut()
    window.location.replace('/login')
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#F5F6FA' }}>
      <div className="w-full max-w-sm rounded-2xl bg-white border border-[#E4E6EE] p-7 shadow-sm flex flex-col gap-4">
        <div className="text-3xl">🔐</div>
        <h1 className="text-xl font-bold text-[#1A1D2E]">Confirm this device</h1>
        {phase === 'checking' && <p className="text-sm text-gray-500">Checking…</p>}
        {phase !== 'checking' && <p className="text-sm text-gray-500">For security, we email you a code the first time you sign in on a new device. After that, this device is remembered.</p>}
        {phase === 'ask' && (
          <button onClick={send} disabled={busy} className="h-11 rounded-lg bg-emerald-600 text-white font-bold disabled:opacity-50">{busy ? 'Sending…' : `Email me a code${to ? ` (${to})` : ''}`}</button>
        )}
        {phase === 'sent' && (
          <form onSubmit={verify} className="flex flex-col gap-3">
            <p className="text-xs text-gray-600">We sent a 6-digit code to <b>{to}</b>. It works for 10 minutes.</p>
            <input ref={codeRef} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456"
              className="h-12 rounded-lg border border-[#E4E6EE] px-3 text-center text-2xl tracking-[0.4em] font-mono text-[#1A1D2E] focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            <button type="submit" disabled={busy} className="h-11 rounded-lg bg-emerald-600 text-white font-bold disabled:opacity-50">{busy ? 'Checking…' : 'Confirm device'}</button>
            <button type="button" onClick={send} disabled={busy} className="text-xs font-semibold text-emerald-700 hover:underline">Send a new code</button>
          </form>
        )}
        {msg && <p className="text-xs text-red-600">{msg}</p>}
        <button onClick={signOut} className="text-xs text-gray-400 hover:text-gray-600 self-start">Sign out</button>
      </div>
    </div>
  )
}
