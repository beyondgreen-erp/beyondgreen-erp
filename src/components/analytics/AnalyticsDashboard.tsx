'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ANALYTICS — one visual home for profit, leaks, flow and planning.
 * Data comes from analytics_get() (a cached JSON built by analytics_build(), refreshed hourly by pg_cron),
 * so the page costs one small query no matter how many charts it shows.
 * Every dollar sits inside data-money-hide, so Money Guard blurs it until the money password is entered.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
  ReferenceLine, Cell, ScatterChart, Scatter, ZAxis, LineChart,
} from 'recharts'
import { createSupabaseBrowserClient } from '@/lib/supabase'

type Tab = 'pulse' | 'leaks' | 'flow' | 'plan' | 'gaps'
const TABS: { key: Tab; label: string; icon: string; hint: string }[] = [
  { key: 'pulse', label: 'Profit Pulse', icon: 'ti-heartbeat', hint: 'Shipped revenue, margin and backlog' },
  { key: 'leaks', label: 'Leaks & Loss', icon: 'ti-droplet-off', hint: 'Where money walks out the door' },
  { key: 'flow', label: 'Flow & Bottlenecks', icon: 'ti-route', hint: 'Where orders and work get stuck' },
  { key: 'plan', label: 'Planning Ahead', icon: 'ti-calendar-stats', hint: 'Stock cover, cash and reorders' },
  { key: 'gaps', label: 'Data Gaps', icon: 'ti-alert-triangle', hint: 'Missing data that hides the truth' },
]

const C = { green: '#00A84F', dark: '#00632F', blue: '#0086C0', sky: '#579BFC', orange: '#FDAB3D', red: '#E2445C', purple: '#A25DDC', gray: '#C4C4C4', teal: '#00C2B2', yellow: '#FFCB00' }
const LINE_COLORS = [C.green, C.blue, C.orange, C.purple, C.teal, C.red, C.sky, C.yellow, C.dark]

const n = (v: any) => Number(v) || 0
const fmt = (v: any) => n(v).toLocaleString('en-US', { maximumFractionDigits: 0 })
const usd = (v: any) => { const x = n(v); const a = Math.abs(x); const s = x < 0 ? '-' : ''; return a >= 1e6 ? `${s}$${(a / 1e6).toFixed(2)}M` : a >= 1e4 ? `${s}$${(a / 1e3).toFixed(1)}k` : `${s}$${fmt(a)}` }
const usdFull = (v: any) => (n(v) < 0 ? '-$' : '$') + fmt(Math.abs(n(v)))
const pct = (v: any) => (v === null || v === undefined ? '—' : `${n(v).toFixed(1)}%`)
const shortDate = (d: string) => { const [, m, dd] = d.split('-'); return `${Number(m)}/${Number(dd)}` }
const monthLabel = (m: string) => { const [y, mm] = m.split('-').map(Number); return new Date(y, mm - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) }

/* ---------------- small building blocks ---------------- */
function Card({ title, sub, right, children, className = '' }: { title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-2xl shadow-sm border border-[#ECEEF3] p-4 ${className}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <p className="text-[13px] font-semibold text-[#1A1D2E]">{title}</p>
          {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

function Kpi({ label, value, sub, tone = 'neutral', icon }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'good' | 'bad' | 'warn' | 'neutral'; icon?: string }) {
  const ring = { good: 'border-l-[#00A84F]', bad: 'border-l-[#E2445C]', warn: 'border-l-[#FDAB3D]', neutral: 'border-l-[#579BFC]' }[tone]
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-[#ECEEF3] border-l-4 ${ring} px-3.5 py-3`}>
      <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold flex items-center gap-1.5">{icon && <i className={`ti ${icon} text-[13px]`} />}{label}</p>
      <p className="text-[22px] font-bold text-[#1A1D2E] leading-tight mt-1">{value}</p>
      {sub && <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}

function Empty({ msg, fix }: { msg: string; fix?: string }) {
  return (
    <div className="h-full min-h-[140px] flex flex-col items-center justify-center text-center text-gray-400 text-[12px] px-6">
      <i className="ti ti-chart-dots-3 text-2xl mb-1" />
      <p>{msg}</p>
      {fix && <p className="text-[11px] mt-1 text-[#0086C0]">{fix}</p>}
    </div>
  )
}

function Table({ cols, rows, max = 12, onRow }: { cols: { k: string; label: string; right?: boolean; money?: boolean; render?: (r: any) => React.ReactNode }[]; rows: any[]; max?: number; onRow?: (r: any) => void }) {
  const [all, setAll] = useState(false)
  if (!rows?.length) return <Empty msg="Nothing here right now." />
  const shown = all ? rows : rows.slice(0, max)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead><tr className="text-left text-[10.5px] uppercase tracking-wide text-gray-400">
          {cols.map(c => <th key={c.k} className={`py-1.5 px-2 font-semibold ${c.right ? 'text-right' : ''}`}>{c.label}</th>)}
        </tr></thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i} onClick={onRow ? () => onRow(r) : undefined} className={`border-t border-[#F1F2F6] ${onRow ? 'cursor-pointer hover:bg-[#F5F9FF]' : ''}`}>
              {cols.map(c => <td key={c.k} className={`py-1.5 px-2 ${c.right ? 'text-right tabular-nums' : ''} text-[#3A4056]`}>{c.render ? c.render(r) : c.money ? usdFull(r[c.k]) : r[c.k] ?? '—'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && <button onClick={() => setAll(!all)} className="mt-2 text-[11px] font-semibold text-[#0086C0] hover:underline">{all ? 'Show less' : `Show all ${rows.length}`}</button>}
    </div>
  )
}

const axis = { tick: { fontSize: 10, fill: '#6b7280' }, tickLine: false } as const
const tipStyle = { contentStyle: { borderRadius: 10, border: '1px solid #ECEEF3', fontSize: 12 } }

/* ---------------- page ---------------- */
export default function AnalyticsDashboard() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [tab, setTab] = useState<Tab>('pulse')
  const [d, setD] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async (refresh = false) => {
    setBusy(true); setErr('')
    const { data, error } = await sb.rpc('analytics_get', { p_refresh: refresh })
    if (error) setErr(error.message); else setD(data)
    setBusy(false)
  }, [sb])

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab') as Tab | null
    if (t && TABS.some(x => x.key === t)) setTab(t)
    load(false)
  }, [load])

  const pick = (t: Tab) => { setTab(t); const u = new URL(window.location.href); u.searchParams.set('tab', t); window.history.replaceState(null, '', u.toString()) }
  const gapCount = (d?.gaps || []).filter((g: any) => (g.good_when === '>0' ? n(g.n) === 0 : n(g.n) > 0)).length

  return (
    <div data-money-hide className="pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-[22px] font-bold text-[#1A1D2E] flex items-center gap-2"><i className="ti ti-chart-infographic text-[#00A84F]" />Analytics</h1>
          <p className="text-[12px] text-gray-500">Find the gaps, stop the leaks, and see today&apos;s profit at a glance. Click any bar or row to drill in.</p>
        </div>
        <div className="flex items-center gap-2">
          {d?.refreshed_at && <span className="text-[11px] text-gray-400">Updated {new Date(d.refreshed_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
          <button onClick={() => load(true)} disabled={busy} className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-[#00A84F] text-white hover:bg-[#00632F] disabled:opacity-60 flex items-center gap-1.5">
            <i className={`ti ti-refresh ${busy ? 'animate-spin' : ''}`} />{busy ? 'Refreshing' : 'Refresh now'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {TABS.map(t => (
          <button key={t.key} onClick={() => pick(t.key)} title={t.hint}
            className={`px-3.5 py-2 rounded-xl text-[13px] font-semibold flex items-center gap-1.5 border transition ${tab === t.key ? 'bg-[#1A1D2E] text-white border-[#1A1D2E]' : 'bg-white text-[#3A4056] border-[#ECEEF3] hover:border-[#C9CDD8]'}`}>
            <i className={`ti ${t.icon}`} />{t.label}
            {t.key === 'gaps' && gapCount > 0 && <span className="ml-0.5 text-[10px] bg-[#E2445C] text-white rounded-full px-1.5">{gapCount}</span>}
          </button>
        ))}
      </div>

      {err && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 text-red-700 text-[12px] px-3 py-2">Could not load analytics: {err}</div>}
      {!d ? <div className="text-gray-400 text-sm py-20 text-center">Loading analytics…</div> : (
        <>
          {tab === 'pulse' && <Pulse d={d} />}
          {tab === 'leaks' && <Leaks d={d} />}
          {tab === 'flow' && <Flow d={d} />}
          {tab === 'plan' && <Plan d={d} />}
          {tab === 'gaps' && <Gaps d={d} onSaved={() => load(true)} />}
        </>
      )}
    </div>
  )
}

/* ================= 1. PROFIT PULSE ================= */
function Pulse({ d }: { d: any }) {
  const p = d.pulse || {}; const k = p.kpi || {}
  const [range, setRange] = useState(30)
  const [cust, setCust] = useState<any>(null)
  const tgt = n(k.target_gm)
  const dailyTarget = n(d.targets?.daily_ship_target)
  const daily = (p.daily || []).slice(-range).map((r: any) => ({ ...r, costed: n(r.shipped) - n(r.uncosted), label: shortDate(r.d) }))
  const monthly = (p.monthly || []).map((r: any) => ({ ...r, label: monthLabel(r.m) }))
  const mtdDelta = n(k.last_mtd) ? (100 * (n(k.mtd) - n(k.last_mtd))) / n(k.last_mtd) : null
  const w = p.waterfall || {}
  const wf = useMemo(() => {
    const steps = [
      { name: 'Revenue', v: n(w.revenue), kind: 'total' },
      { name: 'Product cost', v: -n(w.cogs), kind: 'neg' },
      { name: 'No cost yet', v: -n(w.uncosted), kind: 'gap' },
      { name: 'Freight paid', v: -n(w.freight_cost), kind: 'neg' },
      { name: 'Freight billed', v: n(w.freight_billed), kind: 'pos' },
      { name: 'Broker', v: -n(w.broker), kind: 'neg' },
    ]
    let run = 0; const out: any[] = []
    for (const s of steps) {
      if (s.kind === 'total') { out.push({ name: s.name, base: 0, val: s.v, raw: s.v, kind: s.kind }); run = s.v; continue }
      const start = run; run += s.v
      out.push({ name: s.name, base: Math.min(start, run), val: Math.abs(s.v), raw: s.v, kind: s.kind })
    }
    out.push({ name: 'Contribution', base: 0, val: run, raw: run, kind: 'total' })
    return out
  }, [w])
  const custs = p.customers || []
  const skus = (p.skus || []).map((s: any) => ({ ...s, rev: n(s.rev), gm_pct: n(s.gm_pct) }))
  const below = skus.filter((s: any) => s.gm_pct < tgt).sort((a: any, b: any) => b.rev - a.rev)
  const custColor = (g: any) => (g === null || g === undefined ? C.gray : n(g) < 0 ? C.red : n(g) < tgt ? C.orange : C.green)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <Kpi icon="ti-truck-delivery" label="Shipped today" value={usd(k.today)} sub={`Yesterday ${usd(k.yesterday)}`} tone={dailyTarget && n(k.yesterday) < dailyTarget ? 'warn' : 'good'} />
        <Kpi icon="ti-calendar-month" label="Shipped MTD" value={usd(k.mtd)} sub={mtdDelta === null ? '' : <span className={mtdDelta >= 0 ? 'text-[#00A84F]' : 'text-[#E2445C]'}>{mtdDelta >= 0 ? '▲' : '▼'} {Math.abs(mtdDelta).toFixed(0)}% vs same day last month</span>} tone={mtdDelta !== null && mtdDelta < 0 ? 'warn' : 'good'} />
        <Kpi icon="ti-percentage" label="Gross margin 30 d" value={pct(k.gm30)} sub={`Target ${tgt}%`} tone={n(k.gm30) >= tgt ? 'good' : 'bad'} />
        <Kpi icon="ti-coin" label="Gross profit 30 d" value={usd(k.gm30_usd)} sub={`on ${usd(k.shipped30)} shipped`} />
        <Kpi icon="ti-file-plus" label="Booked 30 d" value={usd(k.booked30)} sub="New orders entered" />
        <Kpi icon="ti-stack-2" label="Backlog" value={usd(k.backlog)} sub={`${fmt(k.backlog_n)} open orders`} tone="neutral" />
        <Kpi icon="ti-shield-check" label="Cost coverage" value={`${fmt(k.cost_coverage)}%`} sub="of 90 d revenue has costs" tone={n(k.cost_coverage) >= 95 ? 'good' : 'warn'} />
      </div>

      <Card title="Daily shipped revenue and gross profit" sub="Bars: shipped (grey part has no cost yet). Lines: gross profit and new orders booked."
        right={<div className="flex gap-1">{[30, 60, 90].map(r => <button key={r} onClick={() => setRange(r)} className={`text-[11px] px-2 py-1 rounded-md font-semibold ${range === r ? 'bg-[#1A1D2E] text-white' : 'bg-[#F5F6FA] text-gray-600'}`}>{r} d</button>)}</div>}>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F6" vertical={false} />
              <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
              <YAxis {...axis} axisLine={false} width={56} tickFormatter={usd} />
              <Tooltip {...tipStyle} formatter={(v: any, name: any) => [usdFull(v), name]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {dailyTarget > 0 && <ReferenceLine y={dailyTarget} stroke={C.purple} strokeDasharray="4 4" label={{ value: `Target ${usd(dailyTarget)}`, fontSize: 10, fill: C.purple, position: 'insideTopRight' }} />}
              <Bar dataKey="costed" name="Shipped" stackId="s" fill={C.sky} radius={[0, 0, 0, 0]} />
              <Bar dataKey="uncosted" name="Shipped, no cost" stackId="s" fill={C.gray} radius={[3, 3, 0, 0]} />
              <Line type="monotone" dataKey="gm" name="Gross profit" stroke={C.green} strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="booked" name="Booked" stroke={C.orange} strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Monthly shipped and margin %" sub={`Green line is gross margin %. Dashed purple is the ${tgt}% target.`}>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F6" vertical={false} />
                <XAxis dataKey="label" {...axis} />
                <YAxis yAxisId="l" {...axis} axisLine={false} width={56} tickFormatter={usd} />
                <YAxis yAxisId="r" orientation="right" {...axis} axisLine={false} width={40} tickFormatter={(v: number) => `${v}%`} domain={[0, 100]} />
                <Tooltip {...tipStyle} formatter={(v: any, name: any) => [name === 'Margin %' ? pct(v) : usdFull(v), name]} />
                <ReferenceLine yAxisId="r" y={tgt} stroke={C.purple} strokeDasharray="4 4" />
                <Bar yAxisId="l" dataKey="shipped" name="Shipped" fill={C.sky} radius={[4, 4, 0, 0]} />
                <Bar yAxisId="l" dataKey="gm" name="Gross profit" fill={C.green} radius={[4, 4, 0, 0]} />
                <Line yAxisId="r" type="monotone" dataKey="gm_pct" name="Margin %" stroke={C.dark} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Where the last 90 days of revenue went" sub="Revenue down to contribution after product cost, freight and broker fees.">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={wf} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F6" vertical={false} />
                <XAxis dataKey="name" {...axis} interval={0} tick={{ fontSize: 10, fill: '#6b7280' }} />
                <YAxis {...axis} axisLine={false} width={56} tickFormatter={usd} />
                <Tooltip {...tipStyle} formatter={(_v: any, _n: any, it: any) => [usdFull(it?.payload?.raw), it?.payload?.name]} />
                <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
                <Bar dataKey="val" stackId="w" radius={[4, 4, 0, 0]}>
                  {wf.map((r, i) => <Cell key={i} fill={r.kind === 'total' ? (r.name === 'Revenue' ? C.blue : C.green) : r.kind === 'gap' ? C.gray : r.kind === 'pos' ? C.teal : C.red} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {n(w.freight_billed) === 0 && n(w.freight_cost) > 0 && <p className="text-[11px] text-[#B26B00] mt-1"><i className="ti ti-alert-circle" /> {usdFull(w.freight_cost)} of freight paid and none logged as billed to customers. Check that freight is being charged.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Top customers, last 180 days" sub="Bar color: green at or above target margin, orange below, red losing money, grey no cost data. Click a bar.">
          <div className="h-[420px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={custs.slice(0, 15)} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F6" horizontal={false} />
                <XAxis type="number" {...axis} tickFormatter={usd} />
                <YAxis type="category" dataKey="name" width={150} {...axis} tick={{ fontSize: 10, fill: '#3A4056' }} />
                <Tooltip {...tipStyle} formatter={(v: any, _n: any, it: any) => [`${usdFull(v)} · margin ${pct(it?.payload?.gm_pct)}`, 'Shipped']} />
                <Bar dataKey="shipped" radius={[0, 4, 4, 0]} onClick={(e: any) => setCust(e?.payload || e)} className="cursor-pointer">
                  {custs.slice(0, 15).map((c: any, i: number) => <Cell key={i} fill={custColor(c.gm_pct)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {cust && (
            <div className="mt-2 rounded-xl bg-[#F5F9FF] border border-[#DCE8FF] px-3 py-2 text-[12px] flex flex-wrap gap-x-5 gap-y-1 items-center">
              <b className="text-[#1A1D2E]">{cust.name}</b>
              <span>Shipped {usdFull(cust.shipped)}</span><span>Gross profit {usdFull(cust.gm)}</span><span>Margin {pct(cust.gm_pct)}</span><span>{fmt(cust.shipments)} shipments</span>
              <Link href={`/sales/orders?q=${encodeURIComponent(cust.name)}`} className="text-[#0086C0] font-semibold hover:underline">Open orders →</Link>
              <button onClick={() => setCust(null)} className="ml-auto text-gray-400 hover:text-gray-600"><i className="ti ti-x" /></button>
            </div>
          )}
        </Card>

        <Card title="SKU margin map, last 180 days" sub="Each dot is a SKU. Right = more revenue, low = thin margin. Anything under the purple line misses target.">
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F6" />
                <XAxis type="number" dataKey="rev" name="Revenue" {...axis} tickFormatter={usd} scale="sqrt" />
                <YAxis type="number" dataKey="gm_pct" name="Margin" {...axis} width={44} tickFormatter={(v: number) => `${v}%`} domain={[(dm: number) => Math.max(-60, Math.floor(dm / 10) * 10), 100]} allowDataOverflow />
                <ZAxis range={[60, 60]} />
                <ReferenceLine y={tgt} stroke={C.purple} strokeDasharray="4 4" />
                <ReferenceLine y={0} stroke={C.red} />
                <Tooltip {...tipStyle} cursor={{ strokeDasharray: '3 3' }} content={({ payload }: any) => {
                  const s = payload?.[0]?.payload; if (!s) return null
                  return <div className="bg-white border border-[#ECEEF3] rounded-lg px-2.5 py-1.5 text-[11px] shadow"><b>{s.sku}</b> {s.name}<br />Revenue {usdFull(s.rev)} · cost {usdFull(s.cost)} · margin {pct(s.gm_pct)}</div>
                }} />
                <Scatter data={skus}>
                  {skus.map((s: any, i: number) => <Cell key={i} fill={s.gm_pct < 0 ? C.red : s.gm_pct < tgt ? C.orange : C.green} />)}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[12px] font-semibold text-[#1A1D2E] mt-2 mb-1">{below.length} SKUs below {tgt}% margin</p>
          <Table rows={below} max={6} cols={[
            { k: 'sku', label: 'SKU' }, { k: 'name', label: 'Item', render: r => <span className="truncate block max-w-[220px]">{r.name}</span> },
            { k: 'rev', label: 'Revenue', right: true, money: true }, { k: 'gm_pct', label: 'Margin', right: true, render: r => <span className={r.gm_pct < 0 ? 'text-[#E2445C] font-semibold' : 'text-[#B26B00]'}>{pct(r.gm_pct)}</span> },
          ]} />
        </Card>
      </div>
    </div>
  )
}

/* ================= 2. LEAKS ================= */
function Leaks({ d }: { d: any }) {
  const l = d.leaks || {}
  const freight = (l.freight_monthly || []).map((r: any) => ({ ...r, label: monthLabel(r.m) }))
  const ontime = (l.on_time_monthly || []).map((r: any) => ({ ...r, label: monthLabel(r.m), pct: (100 * n(r.on_time)) / Math.max(1, n(r.on_time) + n(r.late)) }))
  const osd = (l.osd_monthly || []).map((r: any) => ({ ...r, label: monthLabel(r.m) }))
  const adj = (l.adjust_monthly || []).map((r: any) => ({ ...r, label: monthLabel(r.m), loss: n(r.loss), gain: n(r.gain) }))
  const lastOT = ontime.length ? ontime[ontime.length - 1] : null
  const fr90 = freight.slice(-3)
  const frCost = fr90.reduce((t: number, r: any) => t + n(r.cost), 0)
  const adjLoss90 = adj.slice(-3).reduce((t: number, r: any) => t + n(r.loss), 0)
  const tgtOT = n(d.targets?.on_time_pct) || 95

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon="ti-box-off" label="Dead stock" value={usd(l.dead_total?.value)} sub={`${fmt(l.dead_total?.skus)} SKUs, no movement ${l.dead_days} d`} tone={n(l.dead_total?.value) > 0 ? 'bad' : 'good'} />
        <Kpi icon="ti-package-off" label="Short ships 90 d" value={usd(l.short_total_90)} sub="Ordered but not shipped" tone={n(l.short_total_90) > 0 ? 'warn' : 'good'} />
        <Kpi icon="ti-truck" label="Freight paid, 3 mo" value={usd(frCost)} sub="None logged as billed back" tone="warn" />
        <Kpi icon="ti-clock-exclamation" label="On time last month" value={lastOT ? pct(lastOT.pct) : '—'} sub={`Target ${tgtOT}%`} tone={lastOT && lastOT.pct >= tgtOT ? 'good' : 'bad'} />
        <Kpi icon="ti-adjustments-alt" label="Count adjustments, 3 mo" value={usd(adjLoss90)} sub="Inventory written down" tone={adjLoss90 < 0 ? 'bad' : 'good'} />
        <Kpi icon="ti-receipt-off" label="Lines below cost" value={fmt((l.below_cost || []).length)} sub="Last 180 days" tone={(l.below_cost || []).length ? 'bad' : 'good'} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Walmart OS&D reports by month" sub="Over, short and damaged reports. Each one risks a chargeback.">
          <div className="h-64">
            {osd.length ? <ResponsiveContainer width="100%" height="100%">
              <BarChart data={osd} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F6" vertical={false} />
                <XAxis dataKey="label" {...axis} /><YAxis {...axis} axisLine={false} width={32} />
                <Tooltip {...tipStyle} /><Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="shorts" name="Short" stackId="o" fill={C.orange} />
                <Bar dataKey="damages" name="Damaged" stackId="o" fill={C.red} />
                <Bar dataKey="overs" name="Over" stackId="o" fill={C.sky} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer> : <Empty msg="No OS&D reports in the last 12 months." />}
          </div>
          {(l.osd_carriers || []).length > 0 && <div className="flex flex-wrap gap-1.5 mt-2">{l.osd_carriers.map((c: any) => <span key={c.carrier} className="text-[11px] px-2 py-0.5 rounded-full bg-[#FFF4E5] text-[#8A5300]">{c.carrier}: {c.reports} ({c.damages} dmg, {c.shorts} short)</span>)}</div>}
        </Card>

        <Card title="On-time shipping by month" sub="Shipped on or before the required ship date vs late. Line is on-time %.">
          <div className="h-64">
            {ontime.length ? <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={ontime} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F6" vertical={false} />
                <XAxis dataKey="label" {...axis} /><YAxis yAxisId="l" {...axis} axisLine={false} width={32} />
                <YAxis yAxisId="r" orientation="right" {...axis} axisLine={false} width={40} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
                <Tooltip {...tipStyle} formatter={(v: any, name: any) => [name === 'On time %' ? pct(v) : fmt(v), name]} /><Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine yAxisId="r" y={tgtOT} stroke={C.purple} strokeDasharray="4 4" />
                <Bar yAxisId="l" dataKey="on_time" name="On time" stackId="t" fill={C.green} />
                <Bar yAxisId="l" dataKey="late" name="Late" stackId="t" fill={C.red} radius={[4, 4, 0, 0]} />
                <Line yAxisId="r" dataKey="pct" name="On time %" stroke={C.dark} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer> : <Empty msg="No shipments with a required ship date yet." />}
          </div>
        </Card>

        <Card title="Freight paid vs billed to customers" sub="If freight is paid but never billed back, it comes straight out of margin.">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={freight} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F6" vertical={false} />
                <XAxis dataKey="label" {...axis} /><YAxis yAxisId="l" {...axis} axisLine={false} width={56} tickFormatter={usd} />
                <YAxis yAxisId="r" orientation="right" {...axis} axisLine={false} width={40} tickFormatter={(v: number) => `${v}%`} />
                <Tooltip {...tipStyle} formatter={(v: any, name: any) => [name === '% of revenue' ? pct(v) : usdFull(v), name]} /><Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="l" dataKey="cost" name="Freight paid" fill={C.red} radius={[4, 4, 0, 0]} />
                <Bar yAxisId="l" dataKey="billed" name="Freight billed" fill={C.teal} radius={[4, 4, 0, 0]} />
                <Line yAxisId="r" dataKey="pct_of_rev" name="% of revenue" stroke={C.purple} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Only {fmt(fr90.reduce((t: number, r: any) => t + n(r.with_cost), 0))} of {fmt(fr90.reduce((t: number, r: any) => t + n(r.shipments), 0))} shipments in the last 3 months have a freight cost logged.</p>
        </Card>

        <Card title="Inventory count adjustments" sub="Red is stock written down after a count (lost, scrapped, miscounted). Green is stock found.">
          <div className="h-64">
            {adj.length ? <ResponsiveContainer width="100%" height="100%">
              <BarChart data={adj} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} stackOffset="sign">
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F6" vertical={false} />
                <XAxis dataKey="label" {...axis} /><YAxis {...axis} axisLine={false} width={56} tickFormatter={usd} />
                <Tooltip {...tipStyle} formatter={(v: any, name: any) => [usdFull(v), name]} /><Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={0} stroke="#9CA3AF" />
                <Bar dataKey="loss" name="Written down" stackId="a" fill={C.red} />
                <Bar dataKey="gain" name="Found" stackId="a" fill={C.green} />
              </BarChart>
            </ResponsiveContainer> : <Empty msg="No count adjustments yet." />}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Biggest write-downs, last 90 days" sub="SKUs that keep coming up short at count time. Check the process for these first.">
          <Table rows={l.adjust_top || []} cols={[
            { k: 'sku', label: 'SKU' }, { k: 'name', label: 'Item', render: r => <span className="truncate block max-w-[220px]">{r.name}</span> },
            { k: 'qty', label: 'Units', right: true, render: r => fmt(r.qty) }, { k: 'entries', label: 'Counts', right: true },
            { k: 'net', label: 'Value', right: true, render: r => <span className="text-[#E2445C] font-semibold">{usdFull(r.net)}</span> },
          ]} />
        </Card>
        <Card title={`Dead stock (nothing out in ${l.dead_days} days)`} sub="Cash sitting on shelves. Sell, rework, or discount these.">
          <Table rows={l.dead_stock || []} cols={[
            { k: 'sku', label: 'SKU', render: r => <Link className="text-[#0086C0] hover:underline" href={`/sales/inventory?q=${encodeURIComponent(r.sku)}`}>{r.sku}</Link> },
            { k: 'name', label: 'Item', render: r => <span className="truncate block max-w-[200px]">{r.name}</span> },
            { k: 'on_hand', label: 'On hand', right: true, render: r => fmt(r.on_hand) }, { k: 'last_out', label: 'Last out', right: true, render: r => r.last_out || 'Never' },
            { k: 'value', label: 'Value', right: true, money: true },
          ]} />
        </Card>
        <Card title="Order lines priced below cost" sub="Last 180 days. Either the price is wrong or the cost is wrong. Both need a look.">
          <Table rows={l.below_cost || []} cols={[
            { k: 'order_number', label: 'Order', render: r => <Link className="text-[#0086C0] hover:underline" href={`/sales/orders?q=${encodeURIComponent(r.order_number || '')}`}>{r.order_number}</Link> },
            { k: 'customer', label: 'Customer', render: r => <span className="truncate block max-w-[140px]">{r.customer}</span> }, { k: 'sku', label: 'SKU' },
            { k: 'price', label: 'Price', right: true, render: r => `$${n(r.price).toFixed(2)}` }, { k: 'cost', label: 'Cost', right: true, render: r => `$${n(r.cost).toFixed(2)}` },
            { k: 'loss', label: 'Loss', right: true, render: r => <span className="text-[#E2445C] font-semibold">{usdFull(r.loss)}</span> },
          ]} />
        </Card>
        <Card title="Short ships" sub="Lines closed short. Each one is revenue the customer wanted and did not get.">
          <Table rows={l.short_ships || []} cols={[
            { k: 'order_number', label: 'Order' }, { k: 'customer', label: 'Customer', render: r => <span className="truncate block max-w-[140px]">{r.customer}</span> },
            { k: 'sku', label: 'SKU' }, { k: 'short_qty', label: 'Short', right: true, render: r => fmt(r.short_qty) }, { k: 'value', label: 'Value', right: true, money: true }, { k: 'at', label: 'Closed', right: true },
          ]} />
          <div className="mt-3 pt-3 border-t border-[#F1F2F6]">
            <p className="text-[12px] font-semibold text-[#1A1D2E] mb-1">Scrap, last 90 days</p>
            {(l.scrap || []).length ? <div className="flex flex-wrap gap-1.5">{l.scrap.map((s: any) => <span key={s.scrap_type} className="text-[11px] px-2 py-0.5 rounded-full bg-[#FDECEF] text-[#9B1C31]">{s.scrap_type}: {fmt(s.lbs)} lbs</span>)}</div>
              : <p className="text-[11px] text-gray-400">No scrap logged yet. Ask operators to log scrap lbs on each work order so yield loss shows up here.</p>}
          </div>
        </Card>
      </div>
    </div>
  )
}

/* ================= 3. FLOW ================= */
function Flow({ d }: { d: any }) {
  const f = d.flow || {}
  const funnel = f.funnel || []
  const prodRaw = f.production_daily || []
  const { prod, lines } = useMemo(() => {
    const byLine: Record<string, number> = {}
    prodRaw.forEach((r: any) => { byLine[r.line] = (byLine[r.line] || 0) + n(r.qty) })
    const ls = Object.keys(byLine).sort((a, b) => byLine[b] - byLine[a]).slice(0, 8)
    const days: Record<string, any> = {}
    prodRaw.forEach((r: any) => { const k = r.d; days[k] = days[k] || { d: k, label: shortDate(k) }; const key = ls.includes(r.line) ? r.line : 'Other'; days[k][key] = (days[k][key] || 0) + n(r.qty) })
    return { prod: Object.values(days).sort((a: any, b: any) => a.d.localeCompare(b.d)), lines: prodRaw.some((r: any) => !ls.includes(r.line)) ? [...ls, 'Other'] : ls }
  }, [prodRaw])
  const cycle = (f.cycle_monthly || []).map((r: any) => ({ ...r, label: monthLabel(r.m), median_days: n(r.median_days) }))
  const m = f.machines || {}
  const stuckColor = (days: number) => (days > 14 ? C.red : days > 7 ? C.orange : C.green)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <Kpi icon="ti-list-check" label="Open orders" value={fmt(funnel.reduce((t: number, r: any) => t + n(r.n), 0))} sub={usd(funnel.reduce((t: number, r: any) => t + n(r.value), 0))} />
        <Kpi icon="ti-alarm" label="Past ship date" value={fmt((f.late_open || []).length)} sub={usd((f.late_open || []).reduce((t: number, r: any) => t + n(r.value), 0))} tone={(f.late_open || []).length ? 'bad' : 'good'} />
        <Kpi icon="ti-clock-hour-4" label="Order to ship (median)" value={cycle.length ? `${cycle[cycle.length - 1].median_days.toFixed(0)} d` : '—'} sub="Most recent month" />
        <Kpi icon="ti-settings-automation" label="Machines running" value={`${fmt(m.running)} / ${fmt(m.active)}`} sub={`${fmt(m.paused)} paused, ${fmt(m.setup)} in setup`} tone={n(m.running) ? 'good' : 'warn'} />
        <Kpi icon="ti-clipboard-list" label="Work orders open" value={fmt((f.wo_aging || []).reduce((t: number, r: any) => t + n(r.n), 0))} sub={`${fmt((f.wo_aging || []).reduce((t: number, r: any) => t + n(r.stale), 0))} older than 14 d`} tone={(f.wo_aging || []).some((r: any) => n(r.stale)) ? 'warn' : 'good'} />
        <Kpi icon="ti-building-factory-2" label="Produced 7 d" value={fmt(prodRaw.filter((r: any) => r.d >= new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)).reduce((t: number, r: any) => t + n(r.qty), 0))} sub="Units booked to stock" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Order pipeline and time stuck in each stage" sub="Bar = number of orders. Color = average days in that stage (green under 7, orange 7 to 14, red over 14).">
          <div className="h-72">
            {funnel.length ? <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnel} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F6" horizontal={false} />
                <XAxis type="number" {...axis} allowDecimals={false} />
                <YAxis type="category" dataKey="status" width={150} {...axis} tick={{ fontSize: 10, fill: '#3A4056' }} />
                <Tooltip {...tipStyle} formatter={(v: any, _n: any, it: any) => [`${v} orders · ${usdFull(it?.payload?.value)} · avg ${it?.payload?.avg_days} d, max ${it?.payload?.max_days} d`, it?.payload?.status]} />
                <Bar dataKey="n" radius={[0, 4, 4, 0]} onClick={(e: any) => { const s = (e?.payload || e)?.status; if (s) window.location.href = `/sales/orders?status=${encodeURIComponent(s)}` }} className="cursor-pointer">
                  {funnel.map((r: any, i: number) => <Cell key={i} fill={stuckColor(n(r.avg_days))} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer> : <Empty msg="No open orders." />}
          </div>
        </Card>

        <Card title="Open orders by age" sub="Days since the order was placed. Old orders tie up materials and frustrate customers.">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={f.aging || []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F6" vertical={false} />
                <XAxis dataKey="bucket" {...axis} /><YAxis yAxisId="l" {...axis} axisLine={false} width={32} allowDecimals={false} />
                <YAxis yAxisId="r" orientation="right" {...axis} axisLine={false} width={56} tickFormatter={usd} />
                <Tooltip {...tipStyle} formatter={(v: any, name: any) => [name === 'Value' ? usdFull(v) : fmt(v), name]} /><Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="l" dataKey="n" name="Orders" radius={[4, 4, 0, 0]}>
                  {(f.aging || []).map((r: any, i: number) => <Cell key={i} fill={[C.green, C.green, C.orange, C.red, C.red][Math.min(4, n(r.sort) - 1)]} />)}
                </Bar>
                <Line yAxisId="r" dataKey="value" name="Value" stroke={C.purple} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Production booked to stock, last 60 days" sub="Units produced per day, stacked by production line.">
          <div className="h-64">
            {prod.length ? <ResponsiveContainer width="100%" height="100%">
              <BarChart data={prod} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F6" vertical={false} />
                <XAxis dataKey="label" {...axis} /><YAxis {...axis} axisLine={false} width={48} tickFormatter={fmt} />
                <Tooltip {...tipStyle} formatter={(v: any, name: any) => [fmt(v), name]} /><Legend wrapperStyle={{ fontSize: 11 }} />
                {lines.map((ln, i) => <Bar key={ln} dataKey={ln} stackId="p" fill={LINE_COLORS[i % LINE_COLORS.length]} />)}
              </BarChart>
            </ResponsiveContainer> : <Empty msg="No production booked in the last 60 days." />}
          </div>
        </Card>

        <Card title="Order to first shipment, by month" sub="Median and average days from order date to first shipment. Lower is better.">
          <div className="h-64">
            {cycle.length ? <ResponsiveContainer width="100%" height="100%">
              <LineChart data={cycle} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F6" vertical={false} />
                <XAxis dataKey="label" {...axis} /><YAxis {...axis} axisLine={false} width={32} />
                <Tooltip {...tipStyle} formatter={(v: any, name: any) => [`${n(v).toFixed(1)} d`, name]} /><Legend wrapperStyle={{ fontSize: 11 }} />
                <Line dataKey="median_days" name="Median" stroke={C.green} strokeWidth={2.5} />
                <Line dataKey="avg_days" name="Average" stroke={C.orange} strokeDasharray="5 3" />
              </LineChart>
            </ResponsiveContainer> : <Empty msg="Not enough shipped orders yet." />}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Open orders past their ship date" sub="Click a row to open the order.">
          <Table rows={f.late_open || []} onRow={r => { window.location.href = `/sales/orders?item=${r.id}` }} cols={[
            { k: 'order_number', label: 'Order' }, { k: 'customer', label: 'Customer', render: r => <span className="truncate block max-w-[160px]">{r.customer}</span> },
            { k: 'status', label: 'Stage' }, { k: 'required_ship_date', label: 'Due', right: true },
            { k: 'days_late', label: 'Late', right: true, render: r => <span className="text-[#E2445C] font-semibold">{r.days_late} d</span> }, { k: 'value', label: 'Value', right: true, money: true },
          ]} />
        </Card>
        <Card title="Machines and work orders" sub="Run hours, downtime and output vs plan come from the run log operators close on each work order.">
          {(m.runs30 || []).length ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={m.runs30} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F6" vertical={false} />
                  <XAxis dataKey="machine" {...axis} /><YAxis {...axis} axisLine={false} width={32} />
                  <Tooltip {...tipStyle} /><Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="run_hours" name="Run h" stackId="h" fill={C.green} />
                  <Bar dataKey="setup_hours" name="Setup h" stackId="h" fill={C.orange} />
                  <Bar dataKey="down_hours" name="Down h" stackId="h" fill={C.red} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <Empty msg="No machine runs logged in the last 30 days, so uptime and output vs plan cannot be measured yet." fix="Have operators close each run on the work order screen." />}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
            {(f.wo_aging || []).map((w: any) => (
              <Link key={w.status} href="/production/work-orders" className="rounded-xl bg-[#F5F6FA] px-3 py-2 hover:bg-[#ECEFF6]">
                <p className="text-[11px] text-gray-500">{w.status}</p>
                <p className="text-[18px] font-bold text-[#1A1D2E]">{fmt(w.n)}</p>
                <p className={`text-[10.5px] ${n(w.stale) ? 'text-[#E2445C]' : 'text-gray-400'}`}>{fmt(w.stale)} over 14 d · avg {w.avg_days} d</p>
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

/* ================= 4. PLANNING ================= */
function Plan({ d }: { d: any }) {
  const p = d.plan || {}
  const minCover = n(p.cover_min) || 21
  const cover = (p.cover || []).map((r: any) => ({ ...r, cover_days: Math.min(n(r.cover_days), 180), real: r.cover_days }))
  const cash = (p.cash_weeks || []).map((r: any) => ({ ...r, label: r.wk === 0 ? 'This wk + past due' : r.label }))
  const noPayments = n(p.payments_recorded) === 0
  const arTotal = (p.ar_aging || []).reduce((t: number, r: any) => t + n(r.value), 0)
  const arOver = (p.ar_aging || []).filter((r: any) => r.bucket !== 'Current').reduce((t: number, r: any) => t + n(r.value), 0)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon="ti-battery-2" label={`SKUs under ${minCover} d cover`} value={fmt(cover.filter((r: any) => n(r.real) < minCover).length)} sub="Based on the last 60 days of use" tone={cover.some((r: any) => n(r.real) < minCover) ? 'bad' : 'good'} />
        <Kpi icon="ti-cash" label="Open invoices" value={usd(arTotal)} sub={noPayments ? 'Payments not recorded in ERP' : 'Balance due'} tone={noPayments ? 'warn' : 'neutral'} />
        <Kpi icon="ti-alert-octagon" label="Past due" value={usd(arOver)} sub={`${arTotal ? Math.round((100 * arOver) / arTotal) : 0}% of open`} tone={arOver ? 'bad' : 'good'} />
        <Kpi icon="ti-repeat" label="Customers overdue to reorder" value={fmt((p.reorder || []).length)} sub="Past their usual reorder gap" tone={(p.reorder || []).length ? 'warn' : 'good'} />
      </div>

      <Card title="Days of stock cover" sub={`On hand divided by daily use (last 60 days). Red bars run out before ${minCover} days. Capped at 180 on the chart.`}>
        <div className="h-[460px]">
          {cover.length ? <ResponsiveContainer width="100%" height="100%">
            <BarChart data={cover.slice(0, 25)} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F6" horizontal={false} />
              <XAxis type="number" {...axis} domain={[0, 180]} />
              <YAxis type="category" dataKey="sku" width={120} {...axis} tick={{ fontSize: 10, fill: '#3A4056' }} />
              <ReferenceLine x={minCover} stroke={C.purple} strokeDasharray="4 4" label={{ value: `${minCover} d`, fontSize: 10, fill: C.purple, position: 'top' }} />
              <Tooltip {...tipStyle} content={({ payload }: any) => {
                const r = payload?.[0]?.payload; if (!r) return null
                return <div className="bg-white border border-[#ECEEF3] rounded-lg px-2.5 py-1.5 text-[11px] shadow"><b>{r.sku}</b> {r.name}<br />On hand {fmt(r.on_hand)} · uses {r.per_day}/day · {r.real ?? 0} d cover<br />Runs out about {r.stockout || 'now'} · open demand {fmt(r.open_demand)}</div>
              }} />
              <Bar dataKey="cover_days" radius={[0, 4, 4, 0]} onClick={(e: any) => { const s = (e?.payload || e)?.sku; if (s) window.location.href = `/sales/inventory?q=${encodeURIComponent(s)}` }} className="cursor-pointer">
                {cover.slice(0, 25).map((r: any, i: number) => <Cell key={i} fill={n(r.real) < minCover ? C.red : n(r.real) < minCover * 2 ? C.orange : C.green} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer> : <Empty msg="No usage in the last 60 days to measure cover." />}
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Cash coming in, next 10 weeks" sub="Open invoices by due date, plus open orders expected to ship and pay on 30-day terms.">
          {noPayments && <p className="text-[11px] text-[#8A5300] bg-[#FFF4E5] rounded-lg px-2.5 py-1.5 mb-2"><i className="ti ti-alert-circle" /> No invoice payments are recorded in the ERP yet, so paid invoices still show as open. Record payments on Invoices to make this exact.</p>}
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cash} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F6" vertical={false} />
                <XAxis dataKey="label" {...axis} interval={0} tick={{ fontSize: 9, fill: '#6b7280' }} /><YAxis {...axis} axisLine={false} width={56} tickFormatter={usd} />
                <Tooltip {...tipStyle} formatter={(v: any, name: any) => [usdFull(v), name]} /><Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="invoiced" name="Invoiced, due" stackId="c" fill={C.green} />
                <Bar dataKey="from_orders" name="From open orders" stackId="c" fill={C.sky} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Receivables aging" sub="Open invoice balances by days past due.">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={p.ar_aging || []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F6" vertical={false} />
                <XAxis dataKey="bucket" {...axis} /><YAxis {...axis} axisLine={false} width={56} tickFormatter={usd} />
                <Tooltip {...tipStyle} formatter={(v: any, _n: any, it: any) => [`${usdFull(v)} · ${it?.payload?.n} invoices`, it?.payload?.bucket]} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {(p.ar_aging || []).map((r: any, i: number) => <Cell key={i} fill={[C.green, C.yellow, C.orange, C.red, '#9B1C31'][Math.min(4, n(r.sort) - 1)]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Table rows={p.ar_top || []} max={6} cols={[
            { k: 'customer', label: 'Customer', render: r => <Link className="text-[#0086C0] hover:underline" href={`/sales/invoices?q=${encodeURIComponent(r.customer)}`}>{r.customer}</Link> },
            { k: 'invoices', label: 'Invoices', right: true }, { k: 'open', label: 'Open', right: true, money: true },
            { k: 'overdue', label: 'Past due', right: true, render: r => <span className={n(r.overdue) ? 'text-[#E2445C] font-semibold' : ''}>{usdFull(r.overdue)}</span> },
          ]} />
        </Card>
      </div>

      <Card title="Customers overdue to reorder" sub="Customers with 3+ orders who are past their usual gap between orders. Sorted by days late times average order. A good call list.">
        <Table rows={p.reorder || []} cols={[
          { k: 'customer', label: 'Customer', render: r => <Link className="text-[#0086C0] hover:underline" href={`/sales/customers?q=${encodeURIComponent(r.customer)}`}>{r.customer}</Link> },
          { k: 'orders', label: 'Orders (2 yr)', right: true }, { k: 'gap_days', label: 'Usual gap', right: true, render: r => `${r.gap_days} d` },
          { k: 'last_order', label: 'Last order', right: true }, { k: 'expected', label: 'Expected by', right: true },
          { k: 'overdue_days', label: 'Late', right: true, render: r => <span className="text-[#E2445C] font-semibold">{r.overdue_days} d</span> },
          { k: 'avg_order', label: 'Avg order', right: true, money: true },
        ]} />
      </Card>
    </div>
  )
}

/* ================= 5. DATA GAPS + TARGETS ================= */
function Gaps({ d, onSaved }: { d: any; onSaved: () => void }) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [t, setT] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(d.targets || {}).map(([k, v]) => [k, String(v)])))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const labels: Record<string, string> = { gm_pct: 'Target gross margin %', on_time_pct: 'Target on-time ship %', days_cover_min: 'Minimum days of cover', dead_days: 'Days with no movement = dead stock', daily_ship_target: 'Daily shipped revenue target ($)' }
  async function save() {
    setSaving(true); setMsg('')
    const { data: u } = await sb.auth.getUser()
    for (const [k, v] of Object.entries(t)) {
      const num = Number(v); if (!Number.isFinite(num)) continue
      const { error } = await sb.from('analytics_targets').update({ value: num, updated_by: u.user?.email || null, updated_at: new Date().toISOString() }).eq('key', k)
      if (error) { setMsg(error.message); setSaving(false); return }
    }
    setSaving(false); setMsg('Saved. Charts refreshed.'); onSaved()
  }
  const isBad = (g: any) => (g.good_when === '>0' ? n(g.n) === 0 : n(g.n) > 0)
  return (
    <div className="space-y-4">
      <Card title="Data gaps that hide the truth" sub="Every chart is only as good as the data behind it. Close these and the margins, leaks and forecasts get sharper.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {(d.gaps || []).map((g: any) => (
            <Link key={g.key} href={g.href || '#'} className={`rounded-xl border px-3.5 py-3 hover:shadow-sm transition ${isBad(g) ? 'border-[#F6C9D0] bg-[#FFF7F8]' : 'border-[#CDEFD9] bg-[#F4FCF7]'}`}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-[12.5px] font-semibold text-[#1A1D2E]">{g.label}</p>
                <span className={`text-[18px] font-bold tabular-nums ${isBad(g) ? 'text-[#E2445C]' : 'text-[#00A84F]'}`}>{g.money ? usdFull(g.n) : fmt(g.n)}</span>
              </div>
              <p className="text-[11px] text-gray-500 mt-0.5"><i className="ti ti-tool" /> {g.fix}</p>
              {g.list?.length > 0 && <p className="text-[10.5px] text-gray-400 mt-1 truncate">{g.list.join(', ')}</p>}
            </Link>
          ))}
        </div>
      </Card>
      <Card title="Targets" sub="These drive the colors, reference lines and the daily alert email.">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Object.keys(t).map(k => (
            <label key={k} className="text-[12px] text-gray-600">
              {labels[k] || k}
              <input data-money-ok value={t[k]} onChange={e => setT({ ...t, [k]: e.target.value })} inputMode="decimal"
                className="mt-1 w-full border border-[#E4E6EE] rounded-lg px-2.5 py-1.5 text-[13px] text-[#1A1D2E] focus:outline-none focus:border-[#00A84F]" />
            </label>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-3">
          <button onClick={save} disabled={saving} className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-[#00A84F] text-white hover:bg-[#00632F] disabled:opacity-60">{saving ? 'Saving' : 'Save targets'}</button>
          {msg && <span className="text-[12px] text-gray-500">{msg}</span>}
        </div>
        <p className="text-[11px] text-gray-400 mt-3">A short alert email goes to Rudy on weekdays at 6:50 AM Central when something is off target: slow shipping day, margin under target, late orders, low stock cover, lines below cost, new OS&amp;D reports, and customers overdue to reorder.</p>
      </Card>
    </div>
  )
}
