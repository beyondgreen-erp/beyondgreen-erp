'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useEffect, useState } from 'react'

const GREEN = '#037f4c'

export default function SetPasswordPage() {
  const [token, setToken] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token') || ''
    setToken(t)
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
      setDone(true)
    } catch { setError('Something went wrong. Please try again.') } finally { setBusy(false) }
  }

  const wrap: React.CSSProperties = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: `linear-gradient(160deg, #0b6b45 0%, #037f4c 45%, #1f5e3f 100%)` }
  const card: React.CSSProperties = { width: '100%', maxWidth: 400, background: '#fff', borderRadius: 18, padding: 28, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }
  const inp: React.CSSProperties = { width: '100%', boxSizing: 'border-box', border: '1px solid #E4E6EE', borderRadius: 10, padding: '11px 12px', fontSize: 14, marginTop: 4 }

  return (
    <div style={wrap}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ width: 46, height: 46, borderRadius: 12, background: '#ffffff22', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15 }}>bG</div>
          <h1 style={{ color: '#fff', fontSize: 20, fontWeight: 700, margin: '12px 0 2px' }}>beyondGREEN Client Portal</h1>
          <p style={{ color: '#e6f3ec', fontSize: 13, margin: 0 }}>Set a password to access your account.</p>
        </div>
        <div style={card}>
          {done ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#E4F7EE', color: GREEN, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700 }}>&#10003;</div>
              <p style={{ fontSize: 16, fontWeight: 600, color: '#1A1D2E', margin: '12px 0 4px' }}>Password set</p>
              <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 16px' }}>You can now sign in to your portal.</p>
              <a href="/portal" style={{ display: 'inline-block', background: GREEN, color: '#fff', textDecoration: 'none', fontWeight: 600, fontSize: 14, padding: '11px 22px', borderRadius: 10 }}>Go to sign in</a>
            </div>
          ) : (
            <form onSubmit={submit}>
              {error && <div style={{ background: '#FDECEC', border: '1px solid #F5C6C6', color: '#B4231F', fontSize: 13, borderRadius: 8, padding: '8px 12px', marginBottom: 14 }}>{error}</div>}
              <label style={{ display: 'block', marginBottom: 14 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#5A6E8A' }}>New password</span>
                <input type="password" style={inp} value={pw} onChange={e => setPw(e.target.value)} placeholder="At least 6 characters" autoComplete="new-password" />
              </label>
              <label style={{ display: 'block', marginBottom: 18 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#5A6E8A' }}>Confirm password</span>
                <input type="password" style={inp} value={pw2} onChange={e => setPw2(e.target.value)} placeholder="Re-enter password" autoComplete="new-password" />
              </label>
              <button type="submit" disabled={busy || !token} style={{ width: '100%', background: GREEN, color: '#fff', fontWeight: 600, fontSize: 15, border: 'none', borderRadius: 10, padding: '12px 0', cursor: busy || !token ? 'default' : 'pointer', opacity: busy || !token ? 0.6 : 1 }}>{busy ? 'Saving…' : 'Set password'}</button>
            </form>
          )}
        </div>
        <p style={{ textAlign: 'center', color: '#cfe7d9', fontSize: 12, marginTop: 14 }}>Trouble? Email info@byndgrn.com</p>
      </div>
    </div>
  )
}
