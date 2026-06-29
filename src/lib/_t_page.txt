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
interface Draft {
  id: string
  customer_id: string
  company_name: string
  contact_name?: string | null
  to_email: string
  subject: string
  body: string
  probability: number | null
}

export default function CampaignPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [step, setStep] = useState<'select' | 'review' | 'sent'>('select')

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [onlyEmailable, setOnlyEmailable] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [userEmail, setUserEmail] = useState('')
  const [maxFollowUps, setMaxFollowUps] = useState(5)

  const [generating, setGenerating] = useState(false)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [overflow, setOverflow] = useState(0)

  const [sending, setSending] = useState(false)
  const [results, setResults] = useState<{ id: string; ok: boolean; error?: string }[]>([])
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
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200)
      const { data: cts } = await supabase.from('customer_contacts').select('customer_id, email, is_primary').in('customer_id', chunk)
      for (const ct of (cts || []) as any[]) {
        if (ct.email && (ct.is_primary || !emailByCust[ct.customer_id])) emailByCust[ct.customer_id] = ct.email
      }
    }
    setRows((custs || []).map((c: any) => ({ ...c, best_email: c.email || emailByCust[c.id] || null })))
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
  const selectedArr = Array.from(selected)

  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAll() {
    setSelected((prev) => {
      if (allSelected) { const n = new Set(prev); selectableIds.forEach((id) => n.delete(id)); return n }
      return new Set([...Array.from(prev), ...selectableIds])
    })
  }

  const pillFor = (p: number | null) => {
    const v = p ?? 0
    const bg = v >= 70 ? '#DCFCE7' : v >= 40 ? '#FEF9C3' : '#F1F5F9'
    const fg = v >= 70 ? '#166534' : v >= 40 ? '#854D0E' : '#475569'
    return <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: bg, color: fg }}>{v}%</span>
  }

  async function generateDrafts() {
    setErr('')
    if (selectedArr.length === 0) { setErr('Select at least one customer.'); return }
    setGenerating(true)
    try {
      const res = await fetch('/api/outreach', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'campaign_generate', customer_ids: selectedArr, sent_by: userEmail }),
      })
      const j = await res.json()
      if (!res.ok || j.error) { setErr(j.error || 'Could not generate drafts'); setGenerating(false); return }
      setDrafts(j.drafts || [])
      setOverflow(j.overflow || 0)
      setStep('review')
    } catch (e: any) { setErr(e?.message || 'Could not generate drafts') }
    setGenerating(false)
  }

  function updateDraft(id: string, field: 'subject' | 'body', value: string) {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, [field]: value } : d)))
  }
  function removeDraft(id: string) {
    setDrafts((prev) => prev.filter((d) => d.id !== id))
    fetch('/api/outreach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'campaign_discard', ids: [id] }) }).catch(() => {})
  }

  async function sendAll() {
    setErr('')
    if (drafts.length === 0) { setErr('No drafts to send.'); return }
    if (!confirm(`Send ${drafts.length} email${drafts.length !== 1 ? 's' : ''} now from your Outlook? Each gets up to ${maxFollowUps} auto follow-ups until they reply.`)) return
    setSending(true)
    try {
      const res = await fetch('/api/outreach', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'campaign_send_batch', items: drafts.map((d) => ({ id: d.id, subject: d.subject, body: d.body })), sent_by: userEmail, max_follow_ups: maxFollowUps }),
      })
      const j = await res.json()
      if (!res.ok || j.error) { setErr(j.error || 'Send failed'); setSending(false); return }
      setResults(j.results || [])
      setStep('sent')
    } catch (e: any) { setErr(e?.message || 'Send failed') }
    setSending(false)
  }

  function reset() {
    setStep('select'); setDrafts([]); setResults([]); setSelected(new Set()); setOverflow(0); setErr('')
  }

  const darkBtn = { background: '#1A1D2E', color: '#FFFFFF' }

  // ---------------- SELECT STEP ----------------
  if (step === 'select') {
    return (
      <div className="min-h-screen" style={{ background: '#F5F6FA' }}>
        <Header />
        <div className="bg-white border border-[#E4E6EE] rounded-2xl p-4 mb-4 flex flex-wrap items-center gap-3">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company, industry, email…" className="flex-1 min-w-[220px] text-sm px-3 py-2 rounded-lg border border-[#E4E6EE] outline-none" />
          <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={onlyEmailable} onChange={(e) => setOnlyEmailable(e.target.checked)} /> Only contactable</label>
          <button onClick={generateDrafts} disabled={generating || selected.size === 0} className="text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors disabled:opacity-40" style={darkBtn}>
            {generating ? 'Generating drafts…' : `Generate Drafts (${selected.size})`}
          </button>
        </div>
        {err && <Banner kind="err">{err}</Banner>}
        <div className="bg-white border border-[#E4E6EE] rounded-2xl overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-[#E4E6EE]" style={{ background: '#F9FAFB' }}>
                <th className="px-4 py-3 w-10"><input type="checkbox" checked={allSelected} onChange={toggleAll} /></th>
                <th className="px-4 py-3">Company</th><th className="px-4 py-3">Industry</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Win %</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">No customers match.</td></tr>
              ) : filtered.map((r) => {
                const canSelect = !!r.best_email && !r.do_not_contact
                return (
                  <tr key={r.id} className="border-b border-[#F1F2F6] hover:bg-[#FAFBFF]">
                    <td className="px-4 py-3"><input type="checkbox" disabled={!canSelect} checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
                    <td className="px-4 py-3 text-sm text-[#1A1D2E] font-medium">{r.company_name}{r.do_not_contact && <span className="ml-2 text-[10px] text-red-500 font-semibold">DO NOT CONTACT</span>}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{r.industry || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{r.best_email || <span className="text-gray-300">no email</span>}</td>
                    <td className="px-4 py-3">{pillFor(r.probability)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-3">Pick your recipients, then <b>Generate Drafts</b> — you’ll review and edit every email before anything sends. (Up to 12 per batch.)</p>
      </div>
    )
  }

  // ---------------- REVIEW STEP ----------------
  if (step === 'review') {
    return (
      <div className="min-h-screen" style={{ background: '#F5F6FA' }}>
        <Header />
        <div className="bg-white border border-[#E4E6EE] rounded-2xl p-4 mb-4 flex flex-wrap items-center gap-3">
          <button onClick={() => setStep('select')} className="text-sm px-3 py-2 rounded-lg border border-[#E4E6EE] text-gray-600 hover:text-gray-900">← Back</button>
          <span className="text-sm text-gray-600">{drafts.length} email{drafts.length !== 1 ? 's' : ''} ready to review</span>
          <label className="flex items-center gap-2 text-sm text-gray-600 ml-auto">Follow-ups:
            <select value={maxFollowUps} onChange={(e) => setMaxFollowUps(parseInt(e.target.value))} className="text-sm px-2 py-1.5 rounded-lg border border-[#E4E6EE]">
              {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button onClick={sendAll} disabled={sending || drafts.length === 0} className="text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors disabled:opacity-40" style={darkBtn}>
            {sending ? 'Sending…' : `Send All (${drafts.length})`}
          </button>
        </div>
        {overflow > 0 && <Banner kind="warn">{overflow} more were selected than fit in one batch. Send these first, then run another batch for the rest.</Banner>}
        {err && <Banner kind="err">{err}</Banner>}
        <p className="text-xs text-gray-400 mb-3">Edit anything below. Your logo, signature, and catalog link are added automatically, and open-tracking is built in.</p>
        <div className="space-y-4">
          {drafts.map((d) => (
            <div key={d.id} className="bg-white border border-[#E4E6EE] rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm">
                  <span className="font-semibold text-[#1A1D2E]">{d.company_name}</span>
                  <span className="text-gray-400"> · {d.to_email}</span>
                  {d.contact_name && <span className="text-gray-400"> · {d.contact_name}</span>}
                </div>
                <div className="flex items-center gap-2">{pillFor(d.probability)}
                  <button onClick={() => removeDraft(d.id)} title="Remove from this campaign" className="text-gray-400 hover:text-red-500 text-sm px-2">✕</button>
                </div>
              </div>
              <input value={d.subject} onChange={(e) => updateDraft(d.id, 'subject', e.target.value)} placeholder="Subject" className="w-full text-sm font-medium px-3 py-2 rounded-lg border border-[#E4E6EE] outline-none mb-2" />
              <textarea value={d.body} onChange={(e) => updateDraft(d.id, 'body', e.target.value)} rows={9} className="w-full text-sm px-3 py-2 rounded-lg border border-[#E4E6EE] outline-none leading-6" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ---------------- SENT STEP ----------------
  const byId: Record<string, Draft> = {}; drafts.forEach((d) => (byId[d.id] = d))
  const okCount = results.filter((r) => r.ok).length
  return (
    <div className="min-h-screen" style={{ background: '#F5F6FA' }}>
      <Header />
      <Banner kind="ok">Sent {okCount} of {results.length} from your Outlook. They’re in your Sent folder, logged on each customer, and now tracking opens &amp; replies.</Banner>
      <div className="bg-white border border-[#E4E6EE] rounded-2xl overflow-hidden mb-4">
        <table className="w-full text-left">
          <thead><tr className="text-xs text-gray-500 border-b border-[#E4E6EE]" style={{ background: '#F9FAFB' }}><th className="px-4 py-3">Company</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Result</th></tr></thead>
          <tbody>
            {results.map((r) => {
              const d = byId[r.id]
              return (
                <tr key={r.id} className="border-b border-[#F1F2F6]">
                  <td className="px-4 py-3 text-sm text-[#1A1D2E] font-medium">{d?.company_name || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{d?.to_email || '—'}</td>
                  <td className="px-4 py-3 text-sm">{r.ok ? <span className="text-green-600 font-medium">✓ Sent</span> : <span className="text-red-500">✕ {r.error || 'failed'}</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <button onClick={reset} className="text-sm font-semibold px-4 py-2.5 rounded-lg" style={darkBtn}>Start another campaign</button>
    </div>
  )
}

function Header() {
  return (
    <div className="mb-5">
      <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-blue-500/20 text-blue-700 border-blue-500/30">SALES</span>
      <h1 className="text-2xl font-semibold text-[#1A1D2E] mt-1">Email Campaigns</h1>
      <p className="text-gray-500 text-sm mt-0.5">Select customers, review every AI-written email, then send them together from your Outlook — with auto follow-ups, reply tracking, and open tracking.</p>
    </div>
  )
}

function Banner({ kind, children }: { kind: 'ok' | 'err' | 'warn'; children: any }) {
  const styles = kind === 'ok' ? { background: '#ECFDF5', color: '#065F46' } : kind === 'warn' ? { background: '#FEFCE8', color: '#854D0E' } : { background: '#FEF2F2', color: '#DC2626' }
  return <div className="mb-3 text-sm px-4 py-3 rounded-lg" style={styles}>{children}</div>
}
