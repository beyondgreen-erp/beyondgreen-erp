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
  const [stats, setStats] = useState<Record<string, { last_campaign_launch: string | null; emails_sent: number; active_campaign: boolean; responded: boolean }>>({})

  const [generating, setGenerating] = useState(false)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [overflow, setOverflow] = useState(0)

  const [sending, setSending] = useState(false)
  const [results, setResults] = useState<{ id: string; ok: boolean; error?: string }[]>([])
  const [err, setErr] = useState('')
  const [wf, setWf] = useState<any>(null)
  const [wfLoading, setWfLoading] = useState(false)
  const [wfPreview, setWfPreview] = useState<any>(null)
  const [wfBusy, setWfBusy] = useState('')
  const [view, setView] = useState<'launch' | 'analytics'>('launch')
  const [an, setAn] = useState<any>(null)
  const [anLoading, setAnLoading] = useState(false)

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
    try { const sres = await fetch('/api/campaign/ops'); const sj = await sres.json(); setStats(sj.stats || {}) } catch {}
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

  async function openWorkflow(customerId: string, company: string) {
    setWfPreview(null); setWf({ company: company, customer_id: customerId }); setWfLoading(true)
    try {
      const res = await fetch('/api/campaign/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'workflow', customer_id: customerId }) })
      const j = await res.json()
      setWf({ company: company, customer_id: customerId, customer: j.customer, metrics: j.metrics, thread: j.thread })
    } catch (e) {}
    setWfLoading(false)
  }
  async function previewNext(customerId: string) {
    setWfBusy('preview')
    try {
      const res = await fetch('/api/campaign/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preview_next', customer_id: customerId }) })
      const j = await res.json()
      if (j.draft) setWfPreview(j.draft)
    } catch (e) {}
    setWfBusy('')
  }
  async function fillMissing(outreachId: string) {
    setWfBusy('fill:' + outreachId)
    try {
      const res = await fetch('/api/campaign/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'fill_missing', outreach_id: outreachId }) })
      const j = await res.json()
      if (j.draft) setWf((prev: any) => prev ? { ...prev, thread: (prev.thread || []).map((t: any) => t.id === outreachId ? { ...t, subject: j.draft.subject, body: j.draft.body, missing_content: false } : t) } : prev)
    } catch (e) {}
    setWfBusy('')
  }
  async function loadAnalytics() {
    setAnLoading(true)
    try {
      const res = await fetch('/api/campaign/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'analytics' }) })
      const j = await res.json()
      setAn(j)
    } catch (e) {}
    setAnLoading(false)
  }
  async function removeFromCampaign(customerId: string) {
    if (!confirm('Stop the active campaign and all follow-ups for this customer?')) return
    setStats((prev) => ({ ...prev, [customerId]: { last_campaign_launch: prev[customerId]?.last_campaign_launch ?? null, emails_sent: prev[customerId]?.emails_sent ?? 0, responded: prev[customerId]?.responded ?? false, active_campaign: false } }))
    try { await fetch('/api/campaign/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove', customer_id: customerId }) }) } catch {}
  }

  const darkBtn = { background: '#1A1D2E', color: '#FFFFFF' }

  // ---------------- ANALYTICS VIEW ----------------
  if (view === 'analytics') {
    return (
      <div className="min-h-screen" style={{ background: '#F5F6FA' }}>
        <Header />
        <div className="bg-white border border-[#E4E6EE] rounded-2xl p-4 mb-4 flex items-center gap-3">
          <button onClick={() => setView('launch')} className="text-sm px-3 py-2 rounded-lg border border-[#E4E6EE] text-gray-600 hover:text-gray-900">← Back to launch</button>
          <span className="text-sm font-semibold text-[#1A1D2E]">Campaign Analytics</span>
          <button onClick={loadAnalytics} className="ml-auto text-sm px-3 py-2 rounded-lg border border-[#E4E6EE] text-gray-600">Refresh</button>
        </div>
        {anLoading || !an ? (
          <div className="text-sm text-gray-400 py-12 text-center">{anLoading ? 'Crunching the numbers…' : 'No data yet.'}</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Metric label="Emails sent" value={an.overall.sent} />
              <Metric label="Open rate" value={an.overall.open_rate + '%'} />
              <Metric label="Reply rate" value={an.overall.reply_rate + '%'} />
              <Metric label="Replies" value={an.overall.replied} />
            </div>
            <div className="bg-white border border-[#E4E6EE] rounded-2xl p-4">
              <div className="text-xs font-semibold text-blue-700 mb-2">WHAT THE AI LEARNED</div>
              {(an.insights || []).length === 0 ? (<div className="text-sm text-gray-400">Send a few more campaigns to unlock insights.</div>) : (
                <ul className="space-y-2">{an.insights.map((s: string, i: number) => (<li key={i} className="text-sm text-gray-700 flex gap-2"><span className="text-blue-500">•</span><span>{s}</span></li>))}</ul>
              )}
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-white border border-[#E4E6EE] rounded-2xl p-4">
                <div className="text-xs font-semibold text-gray-500 mb-2">CAMPAIGN LEADERBOARD</div>
                <table className="w-full text-left text-sm">
                  <thead><tr className="text-xs text-gray-400"><th className="py-1">Launched</th><th className="py-1">Sent</th><th className="py-1">Open</th><th className="py-1">Reply</th></tr></thead>
                  <tbody>{(an.campaigns || []).map((c: any, i: number) => (<tr key={i} className="border-t border-[#F1F2F6]"><td className="py-1.5">{c.label}</td><td className="py-1.5">{c.sent}</td><td className="py-1.5">{c.open_rate}%</td><td className="py-1.5">{c.reply_rate}%</td></tr>))}</tbody>
                </table>
              </div>
              <div className="bg-white border border-[#E4E6EE] rounded-2xl p-4">
                <div className="text-xs font-semibold text-gray-500 mb-2">OPEN RATE BY DAY</div>
                <div className="space-y-1">{(an.by_day || []).map((d: any, i: number) => (<div key={i} className="flex items-center gap-2 text-sm"><span className="w-10 text-gray-500">{d.day}</span><div className="flex-1 bg-gray-100 rounded h-3"><div className="bg-blue-500 h-3 rounded" style={{ width: d.open_rate + '%' }} /></div><span className="w-10 text-right text-gray-600">{d.open_rate}%</span></div>))}</div>
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-white border border-[#E4E6EE] rounded-2xl p-4">
                <div className="text-xs font-semibold text-emerald-700 mb-2">SUBJECT LINES THAT WORKED</div>
                {(an.winners || []).length === 0 ? (<div className="text-sm text-gray-400">None yet.</div>) : (<ul className="space-y-1">{an.winners.map((w: any, i: number) => (<li key={i} className="text-sm text-gray-700">{w.subject} <span className="text-xs text-emerald-600">{w.replied ? '· replied' : '· opened'}</span></li>))}</ul>)}
              </div>
              <div className="bg-white border border-[#E4E6EE] rounded-2xl p-4">
                <div className="text-xs font-semibold text-red-600 mb-2">SUBJECT LINES THAT FELL FLAT</div>
                {(an.losers || []).length === 0 ? (<div className="text-sm text-gray-400">None yet.</div>) : (<ul className="space-y-1">{an.losers.map((l: any, i: number) => (<li key={i} className="text-sm text-gray-500">{l.subject}</li>))}</ul>)}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ---------------- SELECT STEP ----------------
  if (step === 'select') {
    return (
      <div className="min-h-screen" style={{ background: '#F5F6FA' }}>
        <Header />
        <div className="bg-white border border-[#E4E6EE] rounded-2xl p-4 mb-4 flex flex-wrap items-center gap-3">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company, industry, email…" className="flex-1 min-w-[220px] text-sm px-3 py-2 rounded-lg border border-[#E4E6EE] outline-none" />
          <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={onlyEmailable} onChange={(e) => setOnlyEmailable(e.target.checked)} /> Only contactable</label>
          <button onClick={() => { setView('analytics'); loadAnalytics() }} className="text-sm font-semibold px-4 py-2.5 rounded-lg border border-[#E4E6EE] text-gray-700 hover:bg-gray-50">Analytics</button>
          <button onClick={generateDrafts} disabled={generating || selected.size === 0} className="text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors disabled:opacity-40" style={darkBtn}>
            {generating ? 'Generating drafts…' : `Generate Drafts (${selected.size})`}
          </button>
        </div>
        {err && <Banner kind="err">{err}</Banner>}
        <div className="bg-white border border-[#E4E6EE] rounded-2xl overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-[#E4E6EE]" style={{ background: '#F9FAFB' }}>
                <th className="px-4 py-3 w-10"><input type="checkbox" checked={allSelected} onChange={toggleAll} /></th>
                <th className="px-4 py-3">Company</th><th className="px-4 py-3">Industry</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Win %</th><th className="px-4 py-3">Last Launch</th><th className="px-4 py-3">Sent</th><th className="px-4 py-3">Campaign</th><th className="px-4 py-3">Replied</th><th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400 text-sm">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400 text-sm">No customers match.</td></tr>
              ) : filtered.map((r) => {
                const canSelect = !!r.best_email && !r.do_not_contact
                const s = stats[r.id]
                return (
                  <tr key={r.id} className="border-b border-[#F1F2F6] hover:bg-[#FAFBFF]">
                    <td className="px-4 py-3"><input type="checkbox" disabled={!canSelect} checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
                    <td className="px-4 py-3 text-sm text-[#1A1D2E] font-medium">{r.company_name}{r.do_not_contact && <span className="ml-2 text-[10px] text-red-500 font-semibold">DO NOT CONTACT</span>}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{r.industry || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{r.best_email || <span className="text-gray-300">no email</span>}</td>
                    <td className="px-4 py-3">{pillFor(r.probability)}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{s?.last_campaign_launch ? new Date(s.last_campaign_launch).toLocaleDateString() : '\u2014'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{s?.emails_sent || 0}</td>
                    <td className="px-4 py-3">{s?.active_campaign ? <button onClick={(e) => { e.stopPropagation(); openWorkflow(r.id, r.company_name) }} className="text-xs font-semibold px-2 py-0.5 rounded-full hover:opacity-80" style={{ background: '#DBEAFE', color: '#1D4ED8' }}>Active ›</button> : <span className="text-gray-300 text-xs">\u2014</span>}</td>
                    <td className="px-4 py-3">{s?.responded ? <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: '#DCFCE7', color: '#166534' }}>Replied</span> : <span className="text-gray-300 text-xs">\u2014</span>}</td>
                    <td className="px-4 py-3">{s?.active_campaign && <button onClick={(e) => { e.stopPropagation(); removeFromCampaign(r.id) }} title="Stop campaign and follow-ups for this customer" className="text-xs font-semibold px-2 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50">Remove</button>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {wf && (
          <div className="fixed inset-0 z-50 flex justify-end" onClick={() => { setWf(null); setWfPreview(null) }}>
            <div className="absolute inset-0 bg-black/30" />
            <div onClick={(e) => e.stopPropagation()} className="relative w-full max-w-md h-full bg-white shadow-xl overflow-y-auto p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-xs font-semibold text-blue-700">CAMPAIGN WORKFLOW</div>
                  <div className="text-lg font-semibold text-[#1A1D2E]">{wf.company || (wf.customer && wf.customer.company_name) || ''}</div>
                </div>
                <button onClick={() => { setWf(null); setWfPreview(null) }} className="text-gray-400 hover:text-gray-700 text-xl px-2">×</button>
              </div>
              {wfLoading ? (
                <div className="text-sm text-gray-400 py-8 text-center">Loading…</div>
              ) : (
                <div>
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    <Metric label="Emails sent" value={wf.metrics ? wf.metrics.sent : 0} />
                    <Metric label="Opens" value={(wf.metrics ? wf.metrics.opened_count : 0) + ' (' + (wf.metrics ? wf.metrics.open_rate : 0) + '%)'} />
                    <Metric label="Replied" value={wf.metrics && wf.metrics.replied ? 'Yes' : 'No'} />
                    <Metric label="Step" value={(wf.metrics ? wf.metrics.step : 0) + ' of ' + (wf.metrics ? wf.metrics.max_follow_ups : 0)} />
                    <Metric label="Next send" value={wf.metrics && wf.metrics.next_due ? new Date(wf.metrics.next_due).toLocaleDateString() : '—'} />
                    <Metric label="Win prob" value={(wf.customer && wf.customer.probability != null ? wf.customer.probability + '%' : '—') + (wf.customer && wf.customer.delta ? (wf.customer.delta > 0 ? ' (+' + wf.customer.delta + ')' : ' (' + wf.customer.delta + ')') : '')} />
                  </div>
                  <div className="text-xs font-semibold text-gray-500 mb-2">SEQUENCE</div>
                  <div className="space-y-2 mb-4">
                    {(wf.thread || []).map((m: any, i: number) => (
                      <div key={m.id} className="border border-[#E4E6EE] rounded-xl p-3">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium text-[#1A1D2E]">{i === 0 ? 'Initial email' : 'Follow-up ' + i}</div>
                          <div className="text-xs">{m.sent_at ? <span className="text-green-600">Sent</span> : <span className="text-amber-600">Scheduled</span>}{m.opened ? <span className="text-blue-600 ml-1">· Opened</span> : null}{m.replied ? <span className="text-emerald-700 ml-1">· Replied</span> : null}</div>
                        </div>
                        <div className="text-sm text-gray-700 mt-1">{m.subject || <span className="text-red-500">(missing subject)</span>}</div>
                        {m.missing_content ? (
                          <button onClick={() => fillMissing(m.id)} disabled={wfBusy === 'fill:' + m.id} className="mt-2 text-xs font-semibold px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 disabled:opacity-40">{wfBusy === 'fill:' + m.id ? 'Generating…' : 'AI: fill missing content'}</button>
                        ) : (
                          <div className="text-xs text-gray-500 mt-1 whitespace-pre-wrap">{(m.body || '').slice(0, 220)}</div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-[#E4E6EE] pt-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs font-semibold text-gray-500">NEXT EMAIL (AI PREVIEW)</div>
                      <button onClick={() => previewNext(wf.customer_id)} disabled={wfBusy === 'preview'} className="text-xs font-semibold px-2 py-1 rounded-lg text-white disabled:opacity-40" style={{ background: '#1A1D2E' }}>{wfBusy === 'preview' ? 'Thinking…' : 'Preview with AI'}</button>
                    </div>
                    {wfPreview ? (
                      <div className="border border-[#E4E6EE] rounded-xl p-3">
                        <div className="text-sm font-medium text-[#1A1D2E]">{wfPreview.subject}</div>
                        <div className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">{wfPreview.body}</div>
                      </div>
                    ) : (
                      <div className="text-xs text-gray-400">Click Preview with AI to see what the next follow-up would say. Nothing sends until its scheduled date.</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
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

function Metric({ label, value }: { label: string; value: any }) {
  return (
    <div className="bg-[#F9FAFB] border border-[#E4E6EE] rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-sm font-semibold text-[#1A1D2E]">{value}</div>
    </div>
  )
}

function Banner({ kind, children }: { kind: 'ok' | 'err' | 'warn'; children: any }) {
  const styles = kind === 'ok' ? { background: '#ECFDF5', color: '#065F46' } : kind === 'warn' ? { background: '#FEFCE8', color: '#854D0E' } : { background: '#FEF2F2', color: '#DC2626' }
  return <div className="mb-3 text-sm px-4 py-3 rounded-lg" style={styles}>{children}</div>
}
