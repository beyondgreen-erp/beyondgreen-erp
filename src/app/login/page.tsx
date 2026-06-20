'use client'
import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const sb = createSupabaseBrowserClient()

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'login' | 'reset'>('login')
  const [resetSent, setResetSent] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)
  const [resetError, setResetError] = useState('')

  async function handleLogin() {
    setError('')
    if (!email || !password) { setError('Please enter your email and password.'); return }
    setLoading(true)
    const { error: e } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
    setLoading(false)
    if (e) { setError('Incorrect email or password. Please try again.'); return }
    window.location.href = '/'
  }

  async function handleReset() {
    setResetError('')
    if (!email || !email.includes('@')) { setResetError('Please enter your email address above.'); return }
    setResetLoading(true)
    try {
      const res = await fetch('/api/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      const data = await res.json()
      if (!res.ok) { setResetError(data.error || 'Failed to send reset email.') }
      else { setResetSent(true) }
    } catch {
      setResetError('Network error — please try again.')
    }
    setResetLoading(false)
  }

  const inp: React.CSSProperties = { width: '100%', border: '1px solid #E2E8F0', borderRadius: 8, padding: '11px 14px', fontSize: 14, outline: 'none', boxSizing: 'border-box', color: '#0F1C2E', fontFamily: 'inherit' }
  const lbl: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: '#5A6E8A', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }

  return (
    <div style={{ minHeight: '100vh', background: '#1A2035', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: 'white', borderRadius: 16, padding: 40, width: '100%', maxWidth: 420, boxShadow: '0 24px 64px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 36 }}>
          <div style={{ background: '#3B6FE0', borderRadius: 10, width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ color: 'white', fontWeight: 800, fontSize: 16 }}>bG</span>
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#0F1C2E' }}>beyondGREEN ERP</div>
            <div style={{ fontSize: 11, color: '#8A9FC0', marginTop: 1 }}>Internal Operations Platform</div>
          </div>
        </div>

        {mode === 'login' ? (
          <>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#8A9FC0', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Restricted access — authorized personnel only</p>
            <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', color: '#0F1C2E', marginBottom: 28 }}>Sign in</h1>
            {error && <div style={{ background: '#FEE2E2', color: '#DC2626', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 20 }}>{error}</div>}
            <div style={{ marginBottom: 16 }}>
              <label style={lbl}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@beyondgreenbiotech.com" style={inp} />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={lbl}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Your password" onKeyDown={e => e.key === 'Enter' && handleLogin()} style={inp} />
            </div>
            <button onClick={handleLogin} disabled={loading} style={{ width: '100%', background: loading ? '#93B4FF' : '#3B6FE0', color: 'white', border: 'none', borderRadius: 10, padding: 14, fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', marginBottom: 16 }}>
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
            <p style={{ textAlign: 'center', fontSize: 13 }}>
              <button onClick={() => { setMode('reset'); setError(''); setResetSent(false); setResetError('') }} style={{ background: 'none', border: 'none', color: '#3B6FE0', cursor: 'pointer', fontSize: 13, textDecoration: 'underline', padding: 0 }}>
                Forgot password?
              </button>
            </p>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', color: '#0F1C2E', marginBottom: 12 }}>Reset password</h1>
            {resetSent ? (
              <div>
                <div style={{ background: '#D1FAE5', color: '#065F46', padding: 16, borderRadius: 10, fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
                  ✅ <strong>Check your inbox.</strong> A password reset link has been sent to <strong>{email}</strong>. It expires in 1 hour. Check spam if you don&apos;t see it within 2 minutes.
                </div>
                <button onClick={() => { setMode('login'); setResetSent(false) }} style={{ background: 'none', border: '1px solid #E2E8F0', borderRadius: 8, padding: '10px 20px', fontSize: 14, color: '#5A6E8A', cursor: 'pointer', width: '100%' }}>
                  ← Back to login
                </button>
              </div>
            ) : (
              <>
                <p style={{ color: '#5A6E8A', fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>Enter your email and we&apos;ll send you a link to reset your password.</p>
                {resetError && <div style={{ background: '#FEE2E2', color: '#DC2626', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 16 }}>{resetError}</div>}
                <div style={{ marginBottom: 20 }}>
                  <label style={lbl}>Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@beyondgreenbiotech.com" onKeyDown={e => e.key === 'Enter' && handleReset()} style={inp} />
                </div>
                <button onClick={handleReset} disabled={resetLoading} style={{ width: '100%', background: resetLoading ? '#93B4FF' : '#3B6FE0', color: 'white', border: 'none', borderRadius: 10, padding: 14, fontSize: 15, fontWeight: 700, cursor: resetLoading ? 'not-allowed' : 'pointer', marginBottom: 12 }}>
                  {resetLoading ? 'Sending...' : 'Send reset link'}
                </button>
                <button onClick={() => { setMode('login'); setResetError('') }} style={{ background: 'none', border: 'none', color: '#8A9FC0', cursor: 'pointer', fontSize: 13, width: '100%', padding: '8px 0' }}>
                  ← Back to login
                </button>
              </>
            )}
          </>
        )}
        <p style={{ textAlign: 'center', color: '#8A9FC0', fontSize: 11, marginTop: 28 }}>beyondGREEN Biotech, Inc. · Internal ERP System</p>
      </div>
    </div>
  )
}
