'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react'

export default function EmailPage() {
  const [status, setStatus] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('outlook')
    if (p === 'connected') setFlash({ kind: 'ok', msg: 'Mailbox connected.' })
    else if (p === 'not_configured') setFlash({ kind: 'err', msg: 'Microsoft app is not configured on the server (Azure keys missing).' })
    else if (p) setFlash({ kind: 'err', msg: 'Could not connect (' + p + '). Try again.' })
    fetch('/api/outlook/status').then(r => r.json()).then(d => { setStatus(d); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const connected = status?.connected
  const email = status?.email

  return (
    <div className="p-4 md:p-8 min-h-screen max-w-2xl mx-auto">
      <div className="mb-6">
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-white text-[#0086C0] border-[#CDE6F5]">SETTINGS</span>
        <h1 className="text-2xl font-semibold text-[#1A1D2E] mt-1">Email Connection</h1>
        <p className="text-gray-500 text-sm mt-0.5">The mailbox the ERP sends outreach from and reads replies in.</p>
      </div>

      {flash && (
        <div className={`mb-4 rounded-lg px-4 py-2.5 text-sm ${flash.kind === 'ok' ? 'bg-[#E6F7EE] text-[#036B34] border border-[#B9E3CB]' : 'bg-[#FCE8EC] text-[#A11B30] border border-[#F3C6CF]'}`}>{flash.msg}</div>
      )}

      <div className="bg-white border border-[#E4E6EE] rounded-xl p-6">
        {loading ? <p className="text-gray-400 text-sm">Checking connection…</p> : (
          <>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: connected ? '#E6F7EE' : '#F0F1F5' }}>
                <i className={`ti ${connected ? 'ti-mail-check text-[#00A84F]' : 'ti-mail-off text-gray-400'} text-xl`} />
              </div>
              <div className="min-w-0">
                {connected ? (
                  <>
                    <p className="text-[#1A1D2E] font-semibold">Connected</p>
                    <p className="text-sm text-gray-500 truncate">{email}{status?.connected_at ? ` · since ${new Date(status.connected_at).toLocaleDateString()}` : ''}</p>
                  </>
                ) : (
                  <>
                    <p className="text-[#1A1D2E] font-semibold">No mailbox connected</p>
                    <p className="text-sm text-gray-500">Connect a Microsoft 365 mailbox to send and read outreach.</p>
                  </>
                )}
              </div>
            </div>

            <a href="/api/outlook/connect" className="inline-flex items-center gap-2 text-sm px-4 py-2.5 rounded-lg bg-[#0086C0] text-white hover:bg-[#0074a6] font-medium">
              <i className="ti ti-brand-windows" />{connected ? 'Switch / reconnect mailbox' : 'Connect a mailbox'}
            </a>

            <div className="mt-5 space-y-2 text-xs text-gray-500 border-t border-[#F0F1F5] pt-4">
              <p><b>Sign in as the exact address you want to use.</b> Whatever mailbox you authorize becomes the send-from and reply-reading account.</p>
              <p>Connecting a mailbox <b>replaces</b> the current one — the ERP only keeps one Microsoft connection at a time.</p>
              <p className="text-[#8A6D3B]">For cold outreach, use a <b>dedicated outreach mailbox</b> where possible. Sending high volume from a mailbox on a domain you rely on for normal business email can hurt that domain’s deliverability.</p>
              <p>Only works with <b>Microsoft 365</b> mailboxes your organization can authorize. If the address is hosted elsewhere (e.g. Google), it won’t connect here.</p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
