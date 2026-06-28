/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Row {
  id: string
  company_name: string
  email: string | null
  industry: string | null
  account_type: string | null
  customer_status: string | null
  probability: number | null
  do_not_contact: boolean | null
  best_email: string | null
}

export default function CampaignPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [onlyEmailable, setOnlyEmailable] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [userEmail, setUserEmail] = useState('')
  const [maxFollowUps, setMaxFollowUps] = useState(5)
  const [launching, setLaunching] = useState(false)
  const [result, setResult] = useState<{ queued: number; skipped: number } | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email) })
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load() {
    setLoading(true)
    const { data: custs } = await supabase
      .from('customers')
      .select('id, company_name, email, industry, account_type, customer_status, probability, do_not_contact')
      .order('company_name', { ascending: true })
      .limit(2000)
    const ids = (custs || []).map((c: any) => c.id)
    const emailByCust: Record<string, string> = {}
    // pull primary-contact emails to fill gaps
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200)
      const { data: cts } = await supabase
        .from('customer_contacts')
        .select('customer_id, email, is_primary')
        .in('customer_id', chunk)
      for (const ct of (cts || []) as any[]) {
        if (ct.email && (ct.is_primary || !emailByCust[ct.customer_id])) emailByCust[ct.customer_id] = ct.email
      }
    }
    const out: Row[] = (custs || []).map((c: any) => ({
      ...c,
      best_email: c.email || emailByCust[c.id] || null,
    }))
    setRows(out)
    setLoading(false)
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return rows.filter((r) => {
      if (onlyEmailable && (!r.best_email || r.do_not_contact)) return false
      if (!q) return true
      return (
        r.company_name?.toLowerCase().includes(q) ||
        (r.industry || '').toLowerCase().includes(q) ||
        (r.best_email || '').toLowerCase().includes(q) ||
        (r.account_type || '').toLowerCase().includes(q)
      )
    })
  }, [rows, search, onlyEmailable])

  const selectableIds = filtered.filter((r) => r.best_email && !r.do_not_contact).map((r) => r.id)
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id))

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function toggleAll() {
    setSelected((prev) => {
      if (allSelected) { const n = new Set(prev); selectableIds.forEach((id) => n.delete(id)); return n }
      return new Set([...Array.from(prev), ...selectableIds])
    })
  }

  async function launch() {
    setErr(''); setResult(null)
    const ids = Array.from(selected)
    if (ids.length === 0) { setErr('Select at least one customer.'); return }
    if (!confirm(`Launch an email campaign to ${ids.length} customer${ids.length !== 1 ? 's' : ''}? Each gets a personalized AI email now, then up to ${maxFollowUps} follow-ups until they reply.`)) return
    setLaunching(true)
    try {
      const res = await fetch('/api/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'campaign_send', customer_ids: ids, sent_by: userEmail, max_follow_ups: maxFollowUps }),
      })
      const j = await res.json()
      if (!res.ok || j.error) { setErr(j.error || 'Launch failed'); setLaunching(false); return }
      setResult({ queued: j.queued || 0, skipped: j.skipped || 0 })
      setSelected(new Set())
    } catch (e: any) {
      setErr(e?.message || 'Launch failed')
    }
    setLaunching(false)
  }

  const pillFor = (p: number | null) => {
    const v = p ?? 0
    const bg = v >= 70 ? '#DCFCE7' : v >= 40 ? '#FEF9C3' : '#F1F5F9'
    const fg = v >= 70 ? '#166534' : v >= 40 ? '#854D0E' : '#475569'
    return <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: bg, color: fg }}>{v}%</span>
  }

  return (
    <div className="min-h-screen" style={{ background: '#F5F6FA' }}>
      <div className="mb-5">
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-blue-500/20 text-blue-700 border-blue-500/30">SALES</span>
        <h1 className="text-2xl font-semibold text-[#1A1D2E] mt-1">Email Campaigns</h1>
        <p className="text-gray-500 text-sm mt-0.5">
          Select customers and launch a personalized AI outreach sequence. Emails send one at a time from your Outlook,
          with up to 5 follow-ups that stop automatically the moment someone replies.
        </p>
      </div>

      <div className="bg-white border border-[#E4E6EE] rounded-2xl p-4 mb-4 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company, industry, email…"
          className="flex-1 min-w-[220px] text-sm px-3 py-2 rounded-lg border border-[#E4E6EE] outline-none"
        />
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={onlyEmailable} onChange={(e) => setOnlyEmailable(e.target.checked)} />
          Only contactable
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          Follow-ups:
          <select value={maxFollowUps} onChange={(e) => setMaxFollowUps(parseInt(e.target.value))} className="text-sm px-2 py-1.5 rounded-lg border border-[#E4E6EE]">
            {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button
          onClick={launch}
          disabled={launching || selected.size === 0}
          className="text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors disabled:opacity-40"
          style={{ background: '#1A1D2E', color: '#FFFFFF' }}
        >
          {launching ? 'Launching…' : `Launch Campaign (${selected.size})`}
        </button>
      </div>

      {err && <div className="mb-3 text-sm px-4 py-3 rounded-lg" style={{ background: '#FEF2F2', color: '#DC2626' }}>{err}</div>}
      {result && (
        <div className="mb-3 text-sm px-4 py-3 rounded-lg" style={{ background: '#ECFDF5', color: '#065F46' }}>
          Campaign launched — {result.queued} queued to send.{result.skipped ? ` ${result.skipped} skipped (no email or do-not-contact).` : ''}{' '}
          Emails go out one at a time over the next few minutes; replies are tracked automatically and stop the follow-ups.
        </div>
      )}

      <div className="bg-white border border-[#E4E6EE] rounded-2xl overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="text-xs text-gray-500 border-b border-[#E4E6EE]" style={{ background: '#F9FAFB' }}>
              <th className="px-4 py-3 w-10"><input type="checkbox" checked={allSelected} onChange={toggleAll} /></th>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Industry</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Win %</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">No customers match.</td></tr>
            ) : (
              filtered.map((r) => {
                const canSelect = !!r.best_email && !r.do_not_contact
                return (
                  <tr key={r.id} className="border-b border-[#F1F2F6] hover:bg-[#FAFBFF]">
                    <td className="px-4 py-3">
                      <input type="checkbox" disabled={!canSelect} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                    </td>
                    <td className="px-4 py-3 text-sm text-[#1A1D2E] font-medium">
                      {r.company_name}
                      {r.do_not_contact && <span className="ml-2 text-[10px] text-red-500 font-semibold">DO NOT CONTACT</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">{r.industry || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{r.best_email || <span className="text-gray-300">no email</span>}</td>
                    <td className="px-4 py-3">{pillFor(r.probability)}</td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400 mt-3">
        Only authorized users can launch campaigns. Make sure your Outlook is connected (Customers → Connect Outlook) so emails
        send from your mailbox and land in your Sent folder.
      </p>
    </div>
  )
}
