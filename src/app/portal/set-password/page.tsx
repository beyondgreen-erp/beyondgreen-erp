'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useEffect, useState } from 'react'
import AuthShell, { AuthLink } from '@/components/portal/AuthShell'

export default function SetPasswordPage() {
  const [token, setToken] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [welcome, setWelcome] = useState(false)

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const t = p.get('token') || ''
    setToken(t)
    setWelcome(p.get('welcome') === '1')
    if (!t) setError('This link is missing its token. Please use the link from your email.')
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError('')
    if (pw.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (pw !== pw2) { setError('Passwords do not match.'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/portal/set-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password: pw }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'This link is invalid or has expired.'); return }
      setSignedIn(!!data.signed_in)
      setDone(true)
    } catch { setError('Something went wrong. Please try again.') } finally { setBusy(false) }
  }

  if (done) {
    const next = signedIn ? (welcome ? '/portal/account' : '/portal') : '/portal'
    return (
      <AuthShell eyebrow={welcome ? 'Email confirmed' : 'Password updated'} title={welcome ? <>Welcome to <span className="pa-grad">beyondGREEN.</span></> : <>You&apos;re <span className="pa-grad">all set.</span></>}
        subtitle={signedIn ? (welcome ? 'Next, a few details so we can set up your account. Save anytime and come back.' : 'You are signed in.') : 'You can now sign in to your portal.'}>
        <a href={next} className="pa-btn" style={{ textDecoration: 'none' }}>{signedIn ? (welcome ? 'Continue to onboarding  →' : 'Open my portal  →') : 'Go to sign in  →'}</a>
      </AuthShell>
    )
  }

  return (
    <AuthShell eyebrow={welcome ? 'Confirm your email' : 'Set your password'} title={welcome ? <>One last step to <span className="pa-grad">get started.</span></> : <>Choose a <span className="pa-grad">new password.</span></>}
      subtitle={welcome ? 'Set a password to confirm your email and open your portal.' : 'Use at least 6 characters.'}
      below={<>Link expired? <AuthLink href="/portal/forgot">Send a new one</AuthLink></>}>
      <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
        {error && <div className="pa-err">{error}</div>}
        <label><span className="pa-lbl">Password</span><input type="password" className="pa-in" value={pw} onChange={e => setPw(e.target.value)} placeholder="At least 6 characters" autoComplete="new-password" /></label>
        <label><span className="pa-lbl">Confirm password</span><input type="password" className="pa-in" value={pw2} onChange={e => setPw2(e.target.value)} autoComplete="new-password" /></label>
        <button className="pa-btn" disabled={busy || !token}>{busy ? 'Saving…' : welcome ? 'Confirm and continue  →' : 'Save password  →'}</button>
      </form>
    </AuthShell>
  )
}
