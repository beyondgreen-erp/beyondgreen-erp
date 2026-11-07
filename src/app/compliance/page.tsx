'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'
import { STATE_STYLE, scoreColor, scoreGrade, fmtDate, DueRow } from '@/lib/compliance'

function rowHref(r: DueRow) {
  if (r.boardKey === 'capa') return `/compliance/capa${r.itemId ? `?item=${r.itemId}` : ''}`
  if (r.boardKey === 'complaints') return `/compliance/complaints${r.itemId ? `?item=${r.itemId}` : ''}`
  if (r.boardKey === 'certifications') return '/bizdev/certifications'
  return `/board/${r.boardKey}${r.itemId ? `?item=${r.itemId}` : ''}`
}

function Ring({ value }: { value: number | null }) {
  const pct = value === null ? 0 : Math.round(value * 100)
  const c = scoreColor(value); const r = 54; const len = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 140 140" className="w-36 h-36 shrink-0">
      <circle cx="70" cy="70" r={r} fill="none" stroke="#EEF0F4" strokeWidth="14" />
      <circle cx="70" cy="70" r={r} fill="none" stroke={c} strokeWidth="14" strokeLinecap="round" strokeDasharray={`${(len * pct) / 100} ${len}`} transform="rotate(-90 70 70)" />
      <text x="70" y="68" textAnchor="middle" fontSize="32" fontWeight="800" fill="#1A1D2E">{value === null ? '-' : pct}</text>
      <text x="70" y="90" textAnchor="middle" fontSize="11" fill="#6B7280">of 100</text>
    </svg>
  )
}

function Kpi({ label, value, sub, tone, href, icon }: { label: string; value: any; sub?: string; tone?: 'bad' | 'warn' | 'good'; href?: string; icon: string }) {
  const color = tone === 'bad' ? '#C8102E' : tone === 'warn' ? '#B45309' : tone === 'good' ? '#00753A' : '#1A1D2E'
  const body = (
    <div className="bg-white rounded-xl border border-[#E4E6EE] p-4 h-full hover:shadow-md transition-shadow">
      <div className="flex items-center gap-2 text-xs text-gray-500"><i className={`ti ${icon} text-base`} style={{ color }} />{label}</div>
      <div className="text-2xl font-bold mt-1.5" style={{ color }}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5 leading-snug">{sub}</div>}
    </div>
  )
  return href ? <Link href={href} className="block">{body}</Link> : body
}

const FILTERS: { key: string; label: string }[] = [{ key: 'overdue', label: 'Overdue' }, { key: 'missing', label: 'Never logged' }, { key: 'soon', label: 'Due in 30 days' }]

export default function ComplianceDashboard() {
  const [d, setD] = useState<any>(null)
  const [err, setErr] = useState('')
  const [filter, setFilter] = useState('overdue')
  const [program, setProgram] = useState('')

  async function load() {
    setErr('')
    try { const r = await fetch('/api/compliance/summary', { cache: 'no-store' }); const j = await r.json(); if (j.error) setErr(j.error); else setD(j) } catch (e: any) { setErr(e?.message || 'Could not load') }
  }
  useEffect(() => { load() }, [])

  const actions: DueRow[] = useMemo(() => (d?.actions || []).filter((a: DueRow) => a.state === filter && (!program || a.program === program)), [d, filter, program])
  const programs: string[] = useMemo(() => Array.from(new Set<string>((d?.actions || []).map((a: DueRow) => a.program))).sort(), [d])
  const binder = useMemo(() => {
    const m: Record<string, any[]> = {}
    for (const b of d?.boards || []) (m[b.program] ||= []).push(b)
    return Object.entries(m)
  }, [d])

  if (err) return <div className="p-6 text-sm text-red-600">Could not load the compliance dashboard: {err} <button className="underline ml-2" onClick={load}>Retry</button></div>
  if (!d) return <div className="p-6 text-sm text-gray-400">Loading compliance data…</div>
  const k = d.kpis

  return (
    <div className="min-h-screen pb-10" style={{ background: '#F5F6FA' }}>
      {/* Header */}
      <div className="rounded-2xl p-5 sm:p-6 mb-4 text-white" style={{ background: 'linear-gradient(135deg,#0B3D2E 0%,#00753A 55%,#00A84F 100%)' }}>
        <div className="flex flex-col md:flex-row md:items-center gap-5">
          <div className="bg-white rounded-2xl p-2 self-start"><Ring value={d.readiness} /></div>
          <div className="flex-1 min-w-0">
            <p className="text-xs uppercase tracking-widest text-white/70">HACCP / GMP Compliance · Santa Ana ({d.activeSites.join(', ')})</p>
            <h1 className="text-2xl sm:text-3xl font-bold mt-1">Audit readiness: {scoreGrade(d.readiness)}</h1>
            <p className="text-sm text-white/85 mt-1">
              {k.overdue} items overdue or never logged · {k.dueSoon} due in the next 30 days
              {d.nextAudit ? ` · next audit ${fmtDate(d.nextAudit.next)} (${d.nextAudit.item})` : ' · no audit scheduled yet'}
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <Link href="/compliance/capa" className="text-xs font-semibold bg-white/15 hover:bg-white/25 px-3 py-1.5 rounded-lg">+ Log CAPA</Link>
              <Link href="/compliance/complaints" className="text-xs font-semibold bg-white/15 hover:bg-white/25 px-3 py-1.5 rounded-lg">+ Log complaint</Link>
              <Link href="/board/compliance-hold?new=1" className="text-xs font-semibold bg-white/15 hover:bg-white/25 px-3 py-1.5 rounded-lg">+ Put product on HOLD</Link>
              <Link href="/board/compliance-audits?new=1" className="text-xs font-semibold bg-white/15 hover:bg-white/25 px-3 py-1.5 rounded-lg">+ Schedule audit</Link>
              <button onClick={load} className="text-xs font-semibold bg-white/15 hover:bg-white/25 px-3 py-1.5 rounded-lg"><i className="ti ti-refresh" /> Refresh</button>
            </div>
          </div>
          <p className="text-[11px] text-white/70 md:self-end">Updated {new Date(d.asOf).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-3 mb-4">
        <Kpi icon="ti-alert-triangle" label="Open CAPAs" value={k.capaOpen} sub={`${k.capaOverdue} past target date`} tone={k.capaOverdue ? 'bad' : 'good'} href="/compliance/capa" />
        <Kpi icon="ti-clock" label="Avg days to close CAPA" value={k.capaAvgCloseDays ?? '-'} sub="Closed in last 12 months" tone={k.capaAvgCloseDays > 30 ? 'warn' : undefined} />
        <Kpi icon="ti-message-report" label="Complaints, 12 months" value={k.complaints12} sub={`${k.complaintsOpen} still open`} tone={k.complaintsOpen ? 'warn' : 'good'} href="/compliance/complaints" />
        <Kpi icon="ti-chart-dots-3" label="Complaints per million units" value={k.cpmu === null ? '-' : k.cpmu.toFixed(1)} sub={k.unitsShipped ? `${k.cpmuComplaints} complaints / ${Math.round(k.unitsShipped).toLocaleString()} packs shipped since ${fmtDate(k.unitsSince)}` : 'No shipments in the ERP yet'} />
        <Kpi icon="ti-hand-stop" label="Product on HOLD" value={k.holdsOpen} sub="Open holds" tone={k.holdsOpen ? 'warn' : 'good'} href="/board/compliance-hold" />
        <Kpi icon="ti-route" label="Days since mock recall" value={k.daysSinceRecall ?? 'Never'} sub={k.lastRecall ? `Last ${fmtDate(k.lastRecall)}, due yearly` : 'Due yearly'} tone={k.daysSinceRecall === null || k.daysSinceRecall > 365 ? 'bad' : 'good'} href="/board/compliance-traceability" />
        <Kpi icon="ti-rosette" label="Certifications" value={k.certExpired ? `${k.certExpired} expired` : 'Current'} sub={`${k.certExpiring} expiring in 90 days`} tone={k.certExpired ? 'bad' : k.certExpiring ? 'warn' : 'good'} href="/bizdev/certifications" />
        <Kpi icon="ti-flask-2" label="SDS on file" value={k.sdsCoverage === null ? '-' : `${Math.round(k.sdsCoverage * 100)}%`} sub="Chemicals with a current SDS" tone={k.sdsCoverage !== null && k.sdsCoverage < 1 ? 'warn' : 'good'} href="/board/compliance-chemicals" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 mb-4">
        {/* Readiness breakdown */}
        <div className="xl:col-span-2 bg-white rounded-2xl border border-[#E4E6EE] p-4">
          <h2 className="font-semibold text-[#1A1D2E]">What drives the score</h2>
          <p className="text-xs text-gray-500 mb-3">Each program is weighted by how much an auditor leans on it. Tap one to fix it.</p>
          <div className="space-y-2.5">
            {[...d.components].sort((a: any, b: any) => (a.score ?? 2) - (b.score ?? 2)).map((c: any) => (
              <Link key={c.key} href={c.href} className="block group">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-[#1A1D2E] group-hover:underline">{c.label}</span>
                  <span className="font-bold" style={{ color: scoreColor(c.score) }}>{c.score === null ? 'n/a' : `${Math.round(c.score * 100)}%`}</span>
                </div>
                <div className="h-2 rounded-full bg-[#EEF0F4] mt-1 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.round((c.score ?? 0) * 100)}%`, background: scoreColor(c.score) }} /></div>
                <p className="text-[11px] text-gray-500 mt-0.5">{c.detail} · weight {c.weight}</p>
              </Link>
            ))}
          </div>
        </div>
        {/* Trend */}
        <div className="xl:col-span-3 bg-white rounded-2xl border border-[#E4E6EE] p-4">
          <h2 className="font-semibold text-[#1A1D2E]">Complaints and CAPAs, last 12 months</h2>
          <p className="text-xs text-gray-500 mb-2">Bars are complaints and CAPAs opened; the line is CAPAs closed.</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={d.trend} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F4" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="complaints" name="Complaints" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                <Bar dataKey="capaOpened" name="CAPAs opened" fill="#DC2626" radius={[4, 4, 0, 0]} />
                <Line dataKey="capaClosed" name="CAPAs closed" stroke="#00A84F" strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        {/* Action list */}
        <div className="xl:col-span-2 bg-white rounded-2xl border border-[#E4E6EE] p-4">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <h2 className="font-semibold text-[#1A1D2E] mr-auto">What needs doing</h2>
            <div className="flex gap-1 bg-[#F5F6FA] rounded-lg p-1">
              {FILTERS.map(f => {
                const n = (d.actions || []).filter((a: DueRow) => a.state === f.key).length
                return <button key={f.key} onClick={() => setFilter(f.key)} className={'px-2.5 py-1 text-xs font-semibold rounded-md ' + (filter === f.key ? 'bg-white shadow text-[#1A1D2E]' : 'text-gray-500')}>{f.label} ({n})</button>
              })}
            </div>
            <select value={program} onChange={e => setProgram(e.target.value)} className="text-xs border border-[#E4E6EE] rounded-lg px-2 py-1.5 bg-white">
              <option value="">All programs</option>
              {programs.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          {actions.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">Nothing here. Nice work.</p> : (
            <div className="divide-y divide-[#F1F2F6] max-h-[520px] overflow-y-auto">
              {actions.slice(0, 150).map((a, i) => {
                const s = STATE_STYLE[a.state]
                return (
                  <Link key={i} href={rowHref(a)} className="flex items-start gap-3 py-2.5 hover:bg-[#F9FAFB] px-1 rounded">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 mt-0.5" style={{ background: s.bg, color: s.fg }}>{s.label}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[#1A1D2E] break-words">{a.item}</p>
                      <p className="text-[11px] text-gray-500">{a.board} · {a.cadence}{a.owner ? ` · ${a.owner}` : ''}</p>
                      <p className="text-[11px] text-gray-400">{a.task}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-semibold" style={{ color: s.fg }}>{a.next ? fmtDate(a.next) : 'No record'}</p>
                      {a.daysLeft !== undefined && <p className="text-[10px] text-gray-400">{a.daysLeft < 0 ? `${-a.daysLeft} days late` : `in ${a.daysLeft} days`}</p>}
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
        {/* Reporting calendar */}
        <div className="bg-white rounded-2xl border border-[#E4E6EE] p-4">
          <h2 className="font-semibold text-[#1A1D2E]">Next reporting dates</h2>
          <p className="text-xs text-gray-500 mb-3">Everything due in the next 90 days.</p>
          {d.calendar.length === 0 ? <p className="text-sm text-gray-400">Nothing scheduled in the next 90 days.</p> : (
            <ol className="space-y-2 max-h-[520px] overflow-y-auto">
              {d.calendar.map((c: DueRow, i: number) => (
                <li key={i}>
                  <Link href={rowHref(c)} className="flex gap-3 items-start hover:bg-[#F9FAFB] rounded p-1">
                    <div className="w-12 shrink-0 text-center rounded-lg border border-[#E4E6EE] py-1">
                      <p className="text-[10px] uppercase text-gray-500">{new Date(c.next + 'T00:00').toLocaleDateString('en-US', { month: 'short' })}</p>
                      <p className="text-lg font-bold text-[#1A1D2E] leading-none">{new Date(c.next + 'T00:00').getDate()}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#1A1D2E] break-words">{c.item}</p>
                      <p className="text-[11px] text-gray-500">{c.board} · {c.cadence}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {/* Audit binder */}
      <div className="bg-white rounded-2xl border border-[#E4E6EE] p-4">
        <h2 className="font-semibold text-[#1A1D2E]">Audit binder</h2>
        <p className="text-xs text-gray-500 mb-3">The HACCP / GMP program in the order an auditor walks it, with live status for each record set.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {binder.map(([prog, list]) => (
            <div key={prog} className="rounded-xl border border-[#EEF0F4] p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">{prog}</p>
              {list.map((b: any) => (
                <Link key={b.key} href={b.href} className="flex items-center gap-2 py-1.5 hover:underline">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: scoreColor(b.score) }} />
                  <span className="text-sm text-[#1A1D2E] flex-1 truncate">{b.label}</span>
                  <span className="text-[11px] text-gray-500 shrink-0">{b.live} records{b.overdue ? ` · ${b.overdue} late` : ''}</span>
                </Link>
              ))}
            </div>
          ))}
          <div className="rounded-xl border border-[#EEF0F4] p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">Corrective Action, Complaints & Certifications</p>
            <Link href="/compliance/capa" className="flex items-center gap-2 py-1.5 hover:underline"><span className="w-2 h-2 rounded-full" style={{ background: k.capaOverdue ? '#DC2626' : '#00A84F' }} /><span className="text-sm flex-1">CAPA Log</span><span className="text-[11px] text-gray-500">{k.capaTotal} records</span></Link>
            <Link href="/compliance/complaints" className="flex items-center gap-2 py-1.5 hover:underline"><span className="w-2 h-2 rounded-full" style={{ background: k.complaintsOpen ? '#F59E0B' : '#00A84F' }} /><span className="text-sm flex-1">Customer Complaints</span><span className="text-[11px] text-gray-500">{k.complaints12} in 12 months</span></Link>
            <Link href="/bizdev/certifications" className="flex items-center gap-2 py-1.5 hover:underline"><span className="w-2 h-2 rounded-full" style={{ background: k.certExpired ? '#DC2626' : '#00A84F' }} /><span className="text-sm flex-1">Certifications</span><span className="text-[11px] text-gray-500">{k.certExpiring} expiring</span></Link>
            <Link href="/production/quality-control" className="flex items-center gap-2 py-1.5 hover:underline"><span className="w-2 h-2 rounded-full bg-gray-300" /><span className="text-sm flex-1">Quality Control</span></Link>
            <Link href="/bizdev/documents" className="flex items-center gap-2 py-1.5 hover:underline"><span className="w-2 h-2 rounded-full bg-gray-300" /><span className="text-sm flex-1">Document Repository</span></Link>
          </div>
        </div>
        <p className="text-[11px] text-gray-400 mt-3">Records from sites other than {d.activeSites.join(', ')} are kept as archive and are not scored. The score is a working guide for the team, not a certification body&apos;s grade.</p>
      </div>
    </div>
  )
}
