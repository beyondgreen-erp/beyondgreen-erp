'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react'

export default function EmailPage() {
  const [status, setStatus] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  const [addr, setAddr] = useState('')

  async function refresh() {
    try { const d = await fetch('/api/outlook/status').then(r => r.json()); setStatus(d) } catch { /* ignore */ }
    setLoading(false)
  }
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const p = q.get('outlook')
    if (p === 'connected') setFlash({ kind: 'ok', msg: 'Mailbox connected.' })
    else if (p === 'not_configured') setFlash({ kind: 'err', msg: 'Microsoft app is not configured on the server (Azure keys missing).' })
    else if (p === 'wrong_account') setFlash({ kind: 'err', msg: `Microsoft signed you in as ${q.get('got') || 'a different account'} instead of ${q.get('wanted') || 'the address you asked for'}. Nothing was saved. Type the exact address below and try again — you may need to pick “Use another account” and sign in fresh.` })
    else if (p) setFlash({ kind: 'err', msg: 'Could not connect (' + p + '). Try again.' })
    refresh()
  }, [])

  function connect() {
    const a = addr.trim().toLowerCase()
    window.location.href = a ? `/api/outlook/connect?hint=${encodeURIComponent(a)}` : '/api/outlook/connect'
  }

  async function disconnect(email: string) {
    if (!confirm(`Disconnect ${email}? The ERP will stop sending/reading from it.`)) return
    await fetch('/api/outlook/disconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
    refresh()
  }

  const mailboxes: any[] = status?.mailboxes || []

  return (
    <div className="p-4 md:p-8 min-h-screen max-w-2xl mx-auto">
      <div className="mb-6">
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-white text-[#0086C0] border-[#CDE6F5]">SETTINGS</span>
        <h1 className="text-2xl font-semibold text-[#1A1D2E] mt-1">Email Connection</h1>
        <p className="text-gray-500 text-sm mt-0.5">Mailboxes the ERP can send outreach from and read replies in. You can connect more than one.</p>
      </div>

      {flash && (
        <div className={`mb-4 rounded-lg px-4 py-2.5 text-sm ${flash.kind === 'ok' ? 'bg-[#E6F7EE] text-[#036B34] border border-[#B9E3CB]' : 'bg-[#FCE8EC] text-[#A11B30] border border-[#F3C6CF]'}`}>{flash.msg}</div>
      )}

      <div className="bg-white border border-[#E4E6EE] rounded-xl p-6">
        {loading ? <p className="text-gray-400 text-sm">Checking connections…</p> : (
          <>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Connected mailboxes</p>
            {mailboxes.length === 0 ? (
              <div className="flex items-center gap-3 py-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[#F0F1F5] shrink-0"><i className="ti ti-mail-off text-gray-400 text-lg" /></div>
                <p className="text-sm text-gray-500">No mailboxes connected yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-[#F0F1F5] mb-2">
                {mailboxes.map((m: any) => (
                  <div key={m.email} className="flex items-center gap-3 py-2.5">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-[#E6F7EE] shrink-0"><i className="ti ti-mail-check text-[#00A84F]" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[#1A1D2E] truncate">{m.email}</p>
                      <p className="text-[11px] text-gray-400">{m.connected_at ? `Connected ${new Date(m.connected_at).toLocaleDateString()}` : ''}</p>
                    </div>
                    <button onClick={() => disconnect(m.email)} className="text-xs px-2.5 py-1.5 rounded-md border border-red-200 text-red-600 hover:bg-red-50">Disconnect</button>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-2 flex flex-col sm:flex-row gap-2 sm:items-center">
              <input
                value={addr}
                onChange={e => setAddr(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') connect() }}
                placeholder="Exact address to connect (e.g. rudy.patel@byndgrn.com)"
                className="flex-1 text-sm px-3 py-2.5 rounded-lg border border-[#D6D9E4] focus:border-[#0086C0] focus:ring-1 focus:ring-[#0086C0] outline-none"
              />
              <button onClick={connect} className="inline-flex items-center justify-center gap-2 text-sm px-4 py-2.5 rounded-lg bg-[#0086C0] text-white hover:bg-[#0074a6] font-medium shrink-0">
                <i className="ti ti-plus" />Connect {mailboxes.length ? 'another' : 'a'} mailbox
              </button>
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">Tip: typing the address locks Microsoft to that exact mailbox. Leave blank to just pick from the account list.</p>

            <div className="mt-5 space-y-2 text-xs text-gray-500 border-t border-[#F0F1F5] pt-4">
              <p><b>Sign in as the exact address you want to add.</b> Each mailbox you authorize can be chosen as a sequence’s “From email.”</p>
              <p>Connecting the same address again just refreshes it; other mailboxes stay connected.</p>
              <p className="text-[#8A6D3B]">For cold outreach, point your sequences at a <b>dedicated outreach mailbox</b> (e.g. rudy.patel@byndgrn.com). Keep high-volume cold sending off any mailbox you rely on for normal business email.</p>
              <p>Microsoft 365 mailboxes only. Addresses hosted elsewhere (e.g. Google) won’t connect here.</p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
