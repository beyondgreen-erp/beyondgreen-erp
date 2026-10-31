'use client'
export const dynamic = 'force-dynamic'
import { useState } from 'react'
import AuthShell, { AuthLink } from '@/components/portal/AuthShell'

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
    <AuthShell eyebrow="Reset password" title={done ? <>Link <span className="pa-grad">on its way.</span></> : <>Forgot your <span className="pa-grad">password?</span></>}
      subtitle={done ? <>If <strong>{email}</strong> has a portal account, a reset link is in your inbox. It expires in 2 hours.</> : 'Enter your email and we will send you a link to choose a new one.'}
      below={<>Remembered it? <AuthLink href="/portal">Back to sign in</AuthLink></>}>
      {done ? (
        <a href="/portal" className="pa-btn" style={{ textDecoration: 'none' }}>Back to sign in</a>
      ) : (
        <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
          {err && <div className="pa-err">{err}</div>}
          <label><span className="pa-lbl">Email</span><input type="email" required className="pa-in" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></label>
          <button className="pa-btn" disabled={busy}>{busy ? 'Sending…' : 'Send reset link  →'}</button>
        </form>
      )}
    </AuthShell>
  )
}
