'use client'
import { useState, useEffect } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const sb = createSupabaseBrowserClient()

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    sb.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') { /* ready */ }
    })
  }, [])

  async function handleSubmit() {
    setError('')
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setLoading(true)
    const { error: e } = await sb.auth.updateUser({ password })
    setLoading(false)
    if (e) { setError(e.message); return }
    setSuccess(true)
    setTimeout(() => { window.location.href = '/' }, 2500)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#1A2035', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: 'white', borderRadius: 16, padding: 40, width: '100%', maxWidth: 420, boxShadow: '0 24px 64px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
          <div style={{ background: '#3B6FE0', borderRadius: 10, width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: 'white', fontWeight: 800, fontSize: 14 }}>bG</span>
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>beyondGREEN ERP</div>
            <div style={{ fontSize: 12, color: '#8A9FC0' }}>Set new password</div>
          </div>
        </div>
        {success ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>✅</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Password updated!</h2>
            <p style={{ color: '#5A6E8A', fontSize: 14 }}>Redirecting you to the dashboard...</p>
          </div>
        ) : (
          <>
            <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 8 }}>Choose a new password</h2>
            <p style={{ color: '#5A6E8A', fontSize: 14, marginBottom: 28, lineHeight: 1.6 }}>Minimum 8 characters.</p>
            {error && <div style={{ background: '#FEE2E2', color: '#DC2626', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 16 }}>{error}</div>}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#5A6E8A', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>New Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Minimum 8 characters" style={{ width: '100%', border: '1px solid #E2E8F0', borderRadius: 8, padding: '11px 14px', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#5A6E8A', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Confirm Password</label>
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Re-enter your new password" onKeyDown={e => e.key === 'Enter' && handleSubmit()} style={{ width: '100%', border: '1px solid #E2E8F0', borderRadius: 8, padding: '11px 14px', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <button onClick={handleSubmit} disabled={loading || !password || !confirm} style={{ width: '100%', background: loading ? '#93B4FF' : '#3B6FE0', color: 'white', border: 'none', borderRadius: 10, padding: 13, fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer' }}>
              {loading ? 'Updating...' : 'Set new password'}
            </button>
            <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: '#8A9FC0' }}>
              <a href="/login" style={{ color: '#3B6FE0', textDecoration: 'none' }}>← Back to login</a>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
