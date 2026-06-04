'use client'
export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const ALLOWED_DOMAINS = ['beyondgreenbiotech.com', 'byndgrn.com']

function validateDomain(email: string) {
  const domain = email.split('@')[1]?.toLowerCase()
  return ALLOWED_DOMAINS.includes(domain ?? '')
}

export default function LoginPage() {
  const router = useRouter()
  const params = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'login' | 'reset'>('login')
  const [resetSent, setResetSent] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)

  useEffect(() => {
    if (params.get('expired') === '1') setSessionExpired(true)
    if (params.get('error') === 'unauthorized') setError('Your email domain is not authorized to access this system.')
  }, [params])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!validateDomain(email)) {
      setError('Access restricted to beyondgreenbiotech.com and byndgrn.com email addresses only.')
      return
    }

    setLoading(true)
    const supabase = createSupabaseBrowserClient()
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)

    if (authError) {
      setError(authError.message === 'Invalid login credentials'
        ? 'Invalid email or password. Please try again.'
        : authError.message)
      return
    }

    router.push('/')
    router.refresh()
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!validateDomain(email)) {
      setError('Access restricted to beyondgreenbiotech.com and byndgrn.com email addresses only.')
      return
    }

    setLoading(true)
    const supabase = createSupabaseBrowserClient()
    const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login?reset=true`,
    })
    setLoading(false)

    if (authError) { setError(authError.message); return }
    setResetSent(true)
  }

  return (
    <div className="min-h-screen bg-[#0A0A0B] flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <span className="text-white font-bold text-lg">bG</span>
            </div>
            <span className="text-white font-bold text-xl">beyondGREEN ERP</span>
          </div>
          <p className="text-gray-500 text-sm">Restricted access — authorized personnel only</p>
        </div>

        <div className="bg-[#111113] border border-[#2A2A35] rounded-2xl p-8">
          {mode === 'login' ? (
            <>
              <h1 className="text-white font-semibold text-lg mb-6">Sign in</h1>

              {sessionExpired && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 mb-4">
                  <p className="text-amber-400 text-sm font-medium">Session expired — please sign in again.</p>
                </div>
              )}

              {resetSent && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 mb-4">
                  <p className="text-emerald-400 text-sm">Password reset email sent. Check your inbox.</p>
                </div>
              )}

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 mb-4">
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="text-xs text-gray-400 uppercase tracking-wider block mb-1.5">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@beyondgreenbiotech.com"
                    required
                    className="w-full bg-[#0A0A0B] border border-[#2A2A35] rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500 text-sm transition-colors"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 uppercase tracking-wider block mb-1.5">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="w-full bg-[#0A0A0B] border border-[#2A2A35] rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500 text-sm transition-colors"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors text-sm"
                >
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>
              </form>

              <button
                onClick={() => { setMode('reset'); setError('') }}
                className="w-full text-center text-gray-500 hover:text-gray-300 text-sm mt-4 transition-colors"
              >
                Forgot password?
              </button>
            </>
          ) : (
            <>
              <h1 className="text-white font-semibold text-lg mb-2">Reset password</h1>
              <p className="text-gray-500 text-sm mb-6">Enter your work email and we&apos;ll send a reset link.</p>

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 mb-4">
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}

              {resetSent ? (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 text-center">
                  <p className="text-emerald-400 text-sm">Reset link sent to {email}</p>
                </div>
              ) : (
                <form onSubmit={handleReset} className="space-y-4">
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@beyondgreenbiotech.com"
                    required
                    className="w-full bg-[#0A0A0B] border border-[#2A2A35] rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500 text-sm transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors text-sm"
                  >
                    {loading ? 'Sending…' : 'Send reset link'}
                  </button>
                </form>
              )}

              <button
                onClick={() => { setMode('login'); setError('') }}
                className="w-full text-center text-gray-500 hover:text-gray-300 text-sm mt-4 transition-colors"
              >
                ← Back to sign in
              </button>
            </>
          )}
        </div>

        <p className="text-center text-gray-600 text-xs mt-6">
          beyondGREEN biotech, Inc. · Internal ERP System
        </p>
      </div>
    </div>
  )
}
