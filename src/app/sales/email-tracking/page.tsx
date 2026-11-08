'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const sb = createSupabaseBrowserClient()

interface Row {
  id: string
  customer_id: string | null
  to_email: string | null
  subject: string | null
  sent_at: string | null
  status: string | null
  campaign: string | null
  opened_at: string | null
  last_opened_at: string | null
  open_count: number | null
  machine_open_count: number | null
  clicked_at: string | null
  last_clicked_at: string | null
  click_count: number | null
  response_received: boolean | null
  response_at: string | null
  customers?: { company_name: string | null; contact_name: string | null } | null
}
interface Ev { id: string; kind: string; at: string; likely_machine: boolean; reason: string | null; user_agent: string | null }

const fmtDT = (d?: string | null) => d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
const fmtD = (d?: string | null) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const pct = (n: number, d: number) => d ? Math.round((n / d) * 100) + '%' : '0%'
const replied = (r: Row) => !!r.response_received || r.status === 'responded'
const bounced = (r: Row) => r.status === 'bounced'
const opens = (r: Row) => r.open_count || 0
const clicks = (r: Row) => r.click_count || 0
const isHot = (r: Row) => !replied(r) && !bounced(r) && (clicks(r) > 0 || opens(r) >= 2)
const company = (r: Row) => r.customers?.company_name || (r.subject || '').replace(/^.*kits for /, '').replace(/, samples on us$/, '') || r.to_email || ''

function deviceLabel(ua?: string | null) {
  const u = ua || ''
  if (/GoogleImageProxy/i.test(u)) return 'Gmail'
  if (/iPhone|iPad/i.test(u)) return 'iPhone / iPad'
  if (/Android/i.test(u)) return 'Android'
  if (/Outlook|Microsoft Office|ms-office/i.test(u)) return 'Outlook'
  if (/Macintosh/i.test(u)) return 'Mac'
  if (/Windows/i.test(u)) return 'Windows'
  return u ? 'Other' : 'Unknown'
}

function StatusPill({ r }: { r: Row }) {
  if (bounced(r)) return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600">Bounced</span>
  if (replied(r)) return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">Replied</span>
  if (clicks(r) > 0) return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700">Clicked</span>
  if (opens(r) > 0) return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">Opened</span>
  return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Not opened yet</span>
}

export default function EmailTrackingPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [batch, setBatch] = useState('all')
  const [filter, setFilter] = useState<'all' | 'hot' | 'opened' | 'clicked' | 'unopened' | 'replied'>('all')
  const [open, setOpen] = useState<string | null>(null)
  const [events, setEvents] = useState<Record<string, Ev[]>>({})

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    const { data, error } = await sb
      .from('customer_outreach')
      .select('id, customer_id, to_email, subject, sent_at, status, campaign, opened_at, last_opened_at, open_count, machine_open_count, clicked_at, last_clicked_at, click_count, response_received, response_at, customers(company_name, contact_name)')
      .eq('tracked', true)
      .neq('status', 'queued')
      .order('sent_at', { ascending: false })
      .limit(5000)
    if (error) setErr(error.message)
    setRows((data as any) || [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  // A batch = campaign + send date
  const batchKey = (r: Row) => `${r.campaign || 'Other'}|${(r.sent_at || '').slice(0, 10)}`
  const batches = useMemo(() => {
    const m: Record<string, Row[]> = {}
    rows.forEach(r => { const k = batchKey(r); (m[k] = m[k] || []).push(r) })
    return Object.entries(m).sort((a, b) => b[0].split('|')[1].localeCompare(a[0].split('|')[1]))
  }, [rows])

  const scoped = useMemo(() => {
    const s = q.trim().toLowerCase()
    return rows.filter(r => {
      if (batch !== 'all' && batchKey(r) !== batch) return false
      if (filter === 'hot' && !isHot(r)) return false
      if (filter === 'opened' && opens(r) === 0) return false
      if (filter === 'clicked' && clicks(r) === 0) return false
      if (filter === 'unopened' && (opens(r) > 0 || bounced(r))) return false
      if (filter === 'replied' && !replied(r)) return false
      if (!s) return true
      return [company(r), r.to_email, r.customers?.contact_name, r.subject].some(x => (x || '').toLowerCase().includes(s))
    })
  }, [rows, q, batch, filter])

  const totals = useMemo(() => {
    const base = batch === 'all' ? rows : rows.filter(r => batchKey(r) === batch)
    const delivered = base.filter(r => !bounced(r)).length
    return {
      sent: base.length,
      delivered,
      opened: base.filter(r => opens(r) > 0).length,
      clicked: base.filter(r => clicks(r) > 0).length,
      replied: base.filter(replied).length,
      bounced: base.filter(bounced).length,
      hot: base.filter(isHot).length,
    }
  }, [rows, batch])

  const hot = useMemo(() => scoped.filter(isHot).sort((a, b) => (clicks(b) * 5 + opens(b)) - (clicks(a) * 5 + opens(a))).slice(0, 12), [scoped])

  async function toggle(id: string) {
    if (open === id) { setOpen(null); return }
    setOpen(id)
    if (!events[id]) {
      const { data } = await sb.from('outreach_events').select('id, kind, at, likely_machine, reason, user_agent').eq('outreach_id', id).order('at', { ascending: false }).limit(100)
      setEvents(e => ({ ...e, [id]: (data as any) || [] }))
    }
  }

  const stat = (label: string, value: number, sub?: string, color = '#1A1D2E') => (
    <div className="bg-white rounded-xl border border-[#ECEEF3] px-4 py-3 min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">{label}</p>
      <p className="text-2xl font-bold" style={{ color }}>{value.toLocaleString()}</p>
      {sub && <p className="text-[11px] text-gray-500">{sub}</p>}
    </div>
  )

  const filterBtn = (k: typeof filter, label: string) => (
    <button key={k} onClick={() => setFilter(k)} className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border ${filter === k ? 'bg-[#1A1D2E] text-white border-[#1A1D2E]' : 'bg-white text-gray-600 border-[#E4E6EE]'}`}>{label}</button>
  )

  const detail = (r: Row) => {
    const ev = events[r.id]
    return (
      <div className="bg-[#FBFCFE] border-t border-[#EEF0F4] px-4 py-3 text-xs space-y-2">
        <p className="text-gray-600"><b>Subject:</b> {r.subject}</p>
        <p className="text-gray-600"><b>First opened:</b> {fmtDT(r.opened_at)} · <b>Last opened:</b> {fmtDT(r.last_opened_at)} · <b>First click:</b> {fmtDT(r.clicked_at)}{replied(r) && <> · <b>Replied:</b> {fmtDT(r.response_at)}</>}</p>
        {!!r.machine_open_count && <p className="text-gray-400">{r.machine_open_count} automatic load{r.machine_open_count === 1 ? '' : 's'} filtered out (security scanners, Apple privacy proxy, or our own team viewing it).</p>}
        {!ev ? <p className="text-gray-400">Loading activity…</p> : ev.length === 0 ? <p className="text-gray-400">No activity yet.</p> : (
          <ul className="space-y-1">
            {ev.map(e => (
              <li key={e.id} className={e.likely_machine ? 'text-gray-400' : 'text-[#1A1D2E]'}>
                {fmtDT(e.at)} · {e.kind === 'click' ? 'Clicked link' : 'Opened'} · {deviceLabel(e.user_agent)}{e.likely_machine && <> · <i>filtered: {e.reason}</i></>}
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">CRM</p>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1">Email Tracking</h1>
          <p className="text-gray-500 text-sm mt-0.5">Opens, clicks and replies for every tracked email sent from rudy@beyondgreenbiotech.com.</p>
        </div>
        <button onClick={load} className="px-3 py-2 rounded-lg border border-[#E4E6EE] bg-white text-sm font-semibold text-gray-700">↻ Refresh</button>
      </div>

      <div className="flex flex-wrap gap-2 items-center mb-4">
        <select value={batch} onChange={e => setBatch(e.target.value)} className="bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm max-w-full">
          <option value="all">All batches ({rows.length})</option>
          {batches.map(([k, list]) => { const [c, d] = k.split('|'); return <option key={k} value={k}>{c} · {fmtD(d + 'T12:00:00')} ({list.length})</option> })}
        </select>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search company, name or email…" className="bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm w-full sm:w-72" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        {stat('Sent', totals.sent, `${totals.bounced} bounced`)}
        {stat('Opened', totals.opened, `${pct(totals.opened, totals.delivered)} open rate`, '#3B6FE0')}
        {stat('Clicked', totals.clicked, `${pct(totals.clicked, totals.delivered)} click rate`, '#7C3AED')}
        {stat('Replied', totals.replied, `${pct(totals.replied, totals.delivered)} reply rate`, '#059669')}
        {stat('Hot leads', totals.hot, 'opened 2+ times or clicked', '#D97706')}
        {stat('Not opened', totals.delivered - totals.opened, 'may still be unread or images off')}
      </div>

      {hot.length > 0 && (
        <div className="bg-white rounded-xl border border-amber-200 mb-5">
          <div className="px-4 py-3 border-b border-amber-100 flex items-center gap-2" style={{ borderLeft: '5px solid #D97706' }}>
            <span className="font-bold text-sm text-amber-700">🔥 Hot leads, call these first</span>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{hot.length}</span>
          </div>
          <div className="divide-y divide-[#EEF0F4]">
            {hot.map(r => (
              <div key={r.id} className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-semibold text-[#1A1D2E]">{company(r)}</span>
                <span className="text-gray-500 text-xs">{r.customers?.contact_name || ''} <a href={`mailto:${r.to_email}`} className="text-[#3B6FE0]">{r.to_email}</a></span>
                <span className="ml-auto text-xs text-gray-600">Opened {opens(r)}x{clicks(r) > 0 && <> · <b className="text-violet-700">clicked {clicks(r)}x</b></>} · last {fmtDT(r.last_clicked_at || r.last_opened_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-3">
        {filterBtn('all', 'All')}{filterBtn('hot', 'Hot')}{filterBtn('opened', 'Opened')}{filterBtn('clicked', 'Clicked')}{filterBtn('unopened', 'Not opened')}{filterBtn('replied', 'Replied')}
        <span className="text-xs text-gray-400 self-center ml-1">{scoped.length} shown</span>
      </div>

      {err && <p className="text-red-600 text-sm mb-3">Could not load tracking data: {err}</p>}
      {loading ? <p className="text-gray-400 text-sm">Loading…</p> : scoped.length === 0 ? (
        <p className="text-gray-400 text-sm bg-white rounded-xl border border-[#ECEEF3] p-6 text-center">No tracked emails match.</p>
      ) : (
        <>
          {/* Phone: record cards */}
          <div className="sm:hidden space-y-2">
            {scoped.map(r => (
              <div key={r.id} className="bg-white rounded-xl border border-[#ECEEF3] overflow-hidden">
                <button onClick={() => toggle(r.id)} className="w-full text-left px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-[#1A1D2E] text-sm break-words">{company(r)}</p>
                    <StatusPill r={r} />
                  </div>
                  <p className="text-xs text-gray-500 break-all">{r.customers?.contact_name ? r.customers.contact_name + ' · ' : ''}{r.to_email}</p>
                  <div className="grid grid-cols-3 gap-2 mt-2 text-[11px]">
                    <div><p className="text-gray-400">Sent</p><p className="text-gray-700">{fmtDT(r.sent_at)}</p></div>
                    <div><p className="text-gray-400">Opens</p><p className="text-gray-700">{opens(r)}{r.last_opened_at ? ' · ' + fmtDT(r.last_opened_at) : ''}</p></div>
                    <div><p className="text-gray-400">Clicks</p><p className="text-gray-700">{clicks(r)}</p></div>
                  </div>
                </button>
                {open === r.id && detail(r)}
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden sm:block bg-white rounded-xl border border-[#ECEEF3] overflow-x-auto">
            <table className="w-full text-xs min-w-[980px]">
              <thead className="[&_th]:bg-[#FBFCFE]">
                <tr className="text-[11px] uppercase text-gray-400 border-b border-[#EEF0F4]">
                  <th className="text-left px-3 py-2 font-semibold">Company</th>
                  <th className="text-left px-3 py-2 font-semibold">Contact</th>
                  <th className="text-left px-3 py-2 font-semibold w-[130px]">Sent</th>
                  <th className="text-left px-3 py-2 font-semibold w-[120px]">Status</th>
                  <th className="text-right px-3 py-2 font-semibold w-[70px]">Opens</th>
                  <th className="text-left px-3 py-2 font-semibold w-[130px]">Last opened</th>
                  <th className="text-right px-3 py-2 font-semibold w-[70px]">Clicks</th>
                  <th className="text-left px-3 py-2 font-semibold w-[130px]">Last click</th>
                </tr>
              </thead>
              <tbody>
                {scoped.map((r, i) => (
                  <FragmentRow key={r.id} r={r} i={i} isOpen={open === r.id} onToggle={() => toggle(r.id)} detail={detail} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="text-[11px] text-gray-400 mt-4 leading-relaxed">
        How to read this: an open is counted when the recipient&apos;s email app loads the hidden image. Automatic loads from security scanners, Apple Mail Privacy Protection and our own team are filtered out. People who read with images turned off will not show as opened, so &quot;Not opened&quot; does not always mean unread. Clicks are the most reliable signal.
      </p>
    </div>
  )
}

function FragmentRow({ r, i, isOpen, onToggle, detail }: { r: Row; i: number; isOpen: boolean; onToggle: () => void; detail: (r: Row) => JSX.Element }) {
  return (
    <>
      <tr onClick={onToggle} className={`cursor-pointer hover:bg-[#F2F6FF] ${i % 2 ? 'bg-[#F8FAFC]' : 'bg-white'}`}>
        <td className="px-3 py-2 font-semibold text-[#1A1D2E]">{isHot(r) && <span title="Hot lead">🔥 </span>}{company(r)}</td>
        <td className="px-3 py-2 text-gray-600">{r.customers?.contact_name || ''} <a href={`mailto:${r.to_email}`} onClick={e => e.stopPropagation()} className="text-[#3B6FE0] break-all">{r.to_email}</a></td>
        <td className="px-3 py-2 text-gray-500">{fmtDT(r.sent_at)}</td>
        <td className="px-3 py-2"><StatusPill r={r} /></td>
        <td className="px-3 py-2 text-right font-semibold">{opens(r)}</td>
        <td className="px-3 py-2 text-gray-500">{fmtDT(r.last_opened_at)}</td>
        <td className="px-3 py-2 text-right font-semibold">{clicks(r)}</td>
        <td className="px-3 py-2 text-gray-500">{fmtDT(r.last_clicked_at)}</td>
      </tr>
      {isOpen && <tr><td colSpan={8} className="p-0">{detail(r)}</td></tr>}
    </>
  )
}
