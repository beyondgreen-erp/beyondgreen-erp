'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
/** "Allow Claude to use the ERP as you?" — the approval step of the Claude connector sign-in. */
export const dynamic = 'force-dynamic'
import { useEffect, useState } from 'react'

export default function AuthorizeClaude() {
  const [info, setInfo] = useState<any>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState<URLSearchParams | null>(null)

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    setQ(sp)
    if (sp.get('response_type') !== 'code') { setErr('This sign-in link is not valid (response_type must be code).'); return }
    fetch(`/api/oauth/approve?client_id=${encodeURIComponent(sp.get('client_id') || '')}&redirect_uri=${encodeURIComponent(sp.get('redirect_uri') || '')}`)
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (r.status === 401) { window.location.replace('/login?next=' + encodeURIComponent(window.location.pathname + window.location.search)); return }
        if (d.error) setErr(d.error); else setInfo(d)
      })
      .catch(() => setErr('Could not reach the ERP. Try again.'))
  }, [])

  async function decide(decision: 'allow' | 'deny') {
    if (!q) return
    setBusy(true); setErr('')
    const r = await fetch('/api/oauth/approve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decision, client_id: q.get('client_id'), redirect_uri: q.get('redirect_uri'), state: q.get('state'),
        code_challenge: q.get('code_challenge'), code_challenge_method: q.get('code_challenge_method'), scope: q.get('scope'),
      }),
    })
    const d = await r.json().catch(() => ({}))
    if (d.redirect) { window.location.href = d.redirect; return }
    setBusy(false); setErr(d.error || 'Something went wrong.')
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#F5F6FA' }}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
        <div className="px-6 py-5" style={{ background: '#16803D' }}>
          <div className="text-xs font-semibold tracking-wider text-green-100 uppercase">beyondGREEN ERP</div>
          <div className="text-xl font-bold text-white mt-1">Connect Claude to the ERP</div>
        </div>
        <div className="p-6 space-y-4">
          {!info && !err && <div className="text-gray-500 text-sm">Checking your sign-in…</div>}
          {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{err}</div>}
          {info && (
            <>
              <p className="text-gray-800 text-[15px] leading-relaxed">
                <b>{info.client_name || 'Claude'}</b> is asking to use the ERP as <b>{info.email}</b>.
              </p>
              <ul className="text-sm text-gray-600 space-y-1.5 list-disc pl-5">
                <li>It can see and change only what your own login can see and change.</li>
                <li>Every change it makes is saved under your name in the activity logs.</li>
                <li>Off-site rules for your account still apply.</li>
                <li>You can disconnect it anytime in Settings ▸ Claude Connector.</li>
              </ul>
              {!info.verified && <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">Confirm this device with the emailed code first, then reload this page.</div>}
              <div className="flex gap-3 pt-2">
                <button disabled={busy} onClick={() => decide('deny')} className="flex-1 py-2.5 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-50">Cancel</button>
                <button disabled={busy || !info.verified} onClick={() => decide('allow')} className="flex-1 py-2.5 rounded-lg text-white font-semibold disabled:opacity-50" style={{ background: '#16803D' }}>{busy ? 'Connecting…' : 'Allow'}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
