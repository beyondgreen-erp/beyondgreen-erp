'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const DEFAULT_TEMPLATE = `<div style="font-family:Arial,Helvetica,sans-serif;color:#333;margin-top:24px;padding-top:12px;border-top:1px solid #E4E6EE;">
  <img src="https://beyondgreenbiotech.com/cdn/shop/files/beyondgreenlogo.png" alt="beyondGREEN" style="height:52px;margin-bottom:6px;" />
  <div style="color:#00A84F;font-weight:bold;font-size:11px;margin-bottom:10px;">beyondGREEN biotech &nbsp;|&nbsp; beyondGREEN Professional</div>
  <div style="font-weight:bold;font-size:14px;color:#1A1D2E;">Rudy Patel</div>
  <div style="color:#00A84F;font-weight:bold;font-size:12px;">Chief Business Development Officer</div>
  <div style="color:#666;font-style:italic;font-size:11px;margin-bottom:8px;">Certified HACCP Coordinator</div>
  <div style="color:#666;font-size:11px;line-height:1.5;margin-bottom:10px;">
    Strategic Planning &nbsp;|&nbsp; Sales Leadership &nbsp;|&nbsp; Partnership Development<br/>
    Market Analysis &nbsp;|&nbsp; Product Development<br/>
    Cross-Functional Development &nbsp;|&nbsp; Risk Management
  </div>
  <table cellpadding="0" cellspacing="0" style="font-size:11px;color:#333;border-collapse:collapse;">
    <tr><td style="color:#00A84F;font-weight:bold;padding-right:14px;">Email</td><td>rudyp@beyondGREENbiotech.com</td></tr>
    <tr><td style="color:#00A84F;font-weight:bold;padding-right:14px;">Toll-Free</td><td>(866) 364-9466</td></tr>
    <tr><td style="color:#00A84F;font-weight:bold;padding-right:14px;">Direct</td><td>(949) 606-4667</td></tr>
    <tr><td style="color:#00A84F;font-weight:bold;padding-right:14px;">Office</td><td>1202 E. Wakeham Ave., Santa Ana, CA 92705</td></tr>
    <tr><td style="color:#00A84F;font-weight:bold;padding-right:14px;">Web</td><td><a href="https://beyondgreenbiotech.com" style="color:#00A84F;">beyondgreenbiotech.com</a></td></tr>
  </table>
</div>`

export default function EmailSignaturePage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [userEmail, setUserEmail] = useState('')
  const [html, setHtml] = useState('')
  const [textVersion, setTextVersion] = useState('')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data: u } = await sb.auth.getUser()
    const em = u.user?.email || ''
    setUserEmail(em)
    if (!em) return
    const { data } = await sb.from('user_email_signatures').select('signature_html,signature_text,updated_at').eq('user_email', em).maybeSingle()
    setHtml(data?.signature_html || '')
    setTextVersion(data?.signature_text || '')
    setSavedAt(data?.updated_at || null)
  }, [sb])
  useEffect(() => { load() }, [load])

  async function save() {
    if (!userEmail) return
    setBusy(true)
    await sb.from('user_email_signatures').upsert({
      user_email: userEmail,
      signature_html: html,
      signature_text: textVersion,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_email' })
    setBusy(false); load()
  }
  function resetToDefault() {
    if (!confirm('Replace the current signature with the default beyondGREEN block? Your current HTML will be lost.')) return
    setHtml(DEFAULT_TEMPLATE)
  }

  return (
    <div className="min-h-screen mon-page p-4 md:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div>
          <span className="mon-tag t-blue">📧 Settings · Signature</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">My email signature</h1>
          <p className="text-gray-500 text-sm mt-0.5">Auto-appended to every sequence email you send. Uses <b>{userEmail || '…'}</b> as your key.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/sales/sequences/review" className="text-sm px-3 py-2 rounded-lg border border-[#E4E6EE] text-gray-600 hover:text-[#1A1D2E]">Review queue →</Link>
          <button onClick={resetToDefault} className="text-sm px-3 py-2 rounded-lg border border-[#E4E6EE] text-gray-600 hover:text-[#1A1D2E]">Reset to default</button>
          <button onClick={save} disabled={busy} className="text-sm px-4 py-2 rounded-lg bg-[#3B6FE0] text-white font-semibold disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-[#ECEEF3] rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#EEF0F4] flex items-center justify-between">
            <p className="text-xs font-bold text-[#1A1D2E]">Signature HTML</p>
            <p className="text-[10px] text-gray-400">{savedAt ? `Saved ${new Date(savedAt).toLocaleString()}` : 'Unsaved'}</p>
          </div>
          <textarea value={html} onChange={e => setHtml(e.target.value)} rows={22} className="w-full font-mono text-[11px] p-3 focus:outline-none resize-y" placeholder="Paste HTML here…" />
        </div>
        <div className="bg-white border border-[#ECEEF3] rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#EEF0F4]">
            <p className="text-xs font-bold text-[#1A1D2E]">Live preview</p>
          </div>
          <div className="p-4 min-h-[440px]" dangerouslySetInnerHTML={{ __html: html || '<p style="color:#9CA3AF;font-size:12px;">Nothing here yet. Paste HTML on the left.</p>' }} />
        </div>
      </div>

      <div className="mt-4 bg-white border border-[#ECEEF3] rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[#EEF0F4]">
          <p className="text-xs font-bold text-[#1A1D2E]">Plain-text fallback (optional)</p>
          <p className="text-[10px] text-gray-400 mt-0.5">Used only if a recipient's mail client refuses HTML. Leave blank to skip.</p>
        </div>
        <textarea value={textVersion} onChange={e => setTextVersion(e.target.value)} rows={8} className="w-full font-mono text-[11px] p-3 focus:outline-none resize-y" />
      </div>
    </div>
  )
}
