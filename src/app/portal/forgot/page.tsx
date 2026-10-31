'use client'
export const dynamic = 'force-dynamic'
import Link from 'next/link'
import { useState } from 'react'

const GREEN = '#037f4c'

export default function ForgotPage() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      const r = await fetch('/api/portal/self/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(j.error || 'Please try again.'); return }
      setDone(true)
    } finally { setBusy(false) }
  }
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'linear-gradient(160deg, #0b6b45 0%, #037f4c 45%, #1f5e3f 100%)' }}>
      <div className="w-full max-w-sm">
        <h1 className="text-white text-xl font-bold text-center mb-4">Reset your password</h1>
        <div className="bg-white rounded-2xl shadow-2xl p-6">
          {done ? (
            <p className="text-sm text-gray-600 leading-relaxed">If <strong>{email}</strong> has a portal account, we just sent a reset link. It expires in 2 hours.</p>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              {err && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{err}</div>}
              <label className="block"><span className="block text-xs font-semibold text-gray-600 mb-1">Email</span><input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="w-full border border-[#E4E6EE] rounded-xl px-3.5 py-2.5 text-sm" /></label>
              <button disabled={busy} className="w-full rounded-xl py-2.5 text-white font-bold text-sm disabled:opacity-50" style={{ background: GREEN }}>{busy ? 'Sending…' : 'Send reset link'}</button>
            </form>
          )}
          <Link href="/portal" className="block text-center mt-4 text-xs font-semibold" style={{ color: GREEN }}>Back to sign in</Link>
        </div>
      </div>
    </div>
  )
}
