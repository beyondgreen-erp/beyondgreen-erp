'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PRODUCTION DASHBOARD — one management view across every production board and every machine.
 * Output and revenue by board (logged production x price per piece), open work orders and lateness,
 * machine status, queued hours, actual vs spec rate, and recent reported machine runs.
 * Revenue = pieces produced x price per piece: Walmart distribution price, else the linked order price, else list price.
 * All numbers come from production_dashboard(from, to, today). Running estimates are never counted as output.
 */
export const dynamic = 'force-dynamic'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  PieChart, Pie, Cell, ReferenceLine, Brush,
} from 'recharts'

const CAP = 22
const ymd = (d: Date) => d.toLocaleDateString('en-CA')
const addDays = (s: string, n: number) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d) }
const fmt = (n: any) => Math.round(Number(n) || 0).toLocaleString()
const money = (n: any) => '$' + (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })
const money2 = (n: any) => '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const short = (n: number) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(Math.round(n))
const fmtDay = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const card = 'bg-white border border-[#E4E6EE] rounded-2xl'

const RANGES = [
  { k: 'today', l: 'Today', from: (t: string) => t },
  { k: '7', l: '7 days', from: (t: string) => addDays(t, -6) },
  { k: '30', l: '30 days', from: (t: string) => addDays(t, -29) },
  { k: '90', l: '90 days', from: (t: string) => addDays(t, -89) },
] as const
type Metric = 'rev' | 'pcs' | 'units'
const METRICS: { k: Metric; l: string }[] = [{ k: 'rev', l: 'Revenue' }, { k: 'pcs', l: 'Pieces' }, { k: 'units', l: 'Units' }]

export default function ProductionDashboard() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const today = ymd(new Date())
  const [range, setRange] = useState<typeof RANGES[number]['k']>('7')
  const [metric, setMetric] = useState<Metric>('rev')
  const [focus, setFocus] = useState<string | null>(null) // board key filter
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [data, setData] = useState<any>(null)
  const [err, setErr] = useState('')
  const [now, setNow] = useState(Date.now())
  const from = RANGES.find(r => r.k === range)!.from(today)

  async function load() {
    const { data, error } = await sb.rpc('production_dashboard', { p_from: from, p_to: today, p_today: today })
    if (error) { setErr(error.message); return }
    setErr(''); setData(data)
  }
  useEffect(() => { load() }, [range]) // eslint-disable-line
  useEffect(() => {
    let t: any
    const bump = () => { clearTimeout(t); t = setTimeout(load, 800) }
    const ch = sb.channel('prod-dash')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'machines' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'walmart_production_entries' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'straw_production_entries' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pb_production_entries' }, bump)
      .subscribe()
    const tick = setInterval(() => setNow(Date.now()), 5000)
    const poll = setInterval(load, 60000)
    return () => { clearTimeout(t); clearInterval(tick); clearInterval(poll); sb.removeChannel(ch) }
  }, [sb, range]) // eslint-disable-line

  const boards: any[] = data?.boards || []
  const machines: any[] = data?.machines || []
  const runs: any[] = data?.runs || []
  const tops: any[] = (data?.top_skus || []).filter((t: any) => !focus || t.board === focus)
  const shownBoards = boards.filter(b => !focus || b.key === focus)
  const days: string[] = []
  for (let d = from; d <= today; d = addDays(d, 1)) days.push(d)

  // Chart rows: one per day, one key per board
  const trend = days.map(d => {
    const row: any = { d, label: days.length > 31 ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : fmtDay(d).replace(/,.*/, '') + ' ' + d.slice(8) }
    for (const b of shownBoards) {
      const x = (b.daily || []).find((y: any) => y.d === d)
      row[b.key] = Number(x?.[metric === 'rev' ? 'rev' : metric === 'pcs' ? 'pcs' : 'units'] || 0)
    }
    return row
  })
  const activeBoards = shownBoards.filter(b => Number(b.pcs) > 0 || Number(b.open_wos) > 0)
  const chartBoards = shownBoards.filter(b => (b.daily || []).length > 0)
  const fmtMetric = (v: number) => metric === 'rev' ? money(v) : fmt(v)
  const axisMetric = (v: number) => metric === 'rev' ? '$' + short(v) : short(v)

  const revBoards = boards.filter(b => Number(b.revenue) > 0).map(b => ({ name: b.title, key: b.key, value: Number(b.revenue), fill: b.accent }))
  const totRev = Number(data?.rev_range || 0)
  const totPcs = boards.reduce((s, b) => s + Number(b.pcs || 0), 0)
  const openWos = boards.reduce((s, b) => s + Number(b.open_wos || 0), 0)
  const late = boards.reduce((s, b) => s + Number(b.late || 0), 0)
  const running = machines.filter(m => m.running).length
  const paused = machines.filter(m => m.paused).length
  const queuedH = machines.reduce((s, m) => s + Number(m.queue_hours || 0), 0)
  const estOf = (m: any) => m.run_rate ? Number(m.run_rate) * (Number(m.run_elapsed_sec || 0) + (m.run_started_at ? Math.max(0, (now - Date.parse(m.run_started_at)) / 1000) : 0)) / 3600 : null
  const load_ = machines.filter(m => Number(m.queue_hours) > 0 || m.running || m.paused)
    .map(m => ({ code: m.code, hours: Math.round(Number(m.queue_hours || 0) * 10) / 10, group: m.group, over: Number(m.queue_hours || 0) > CAP }))
    .sort((a, b) => b.hours - a.hours)
  const statusPie = [
    { name: 'Running', value: running, fill: '#1E9E6A' },
    { name: 'Paused', value: paused, fill: '#E0A21B' },
    { name: 'Off / down', value: Math.max(0, machines.length - running - paused), fill: '#E5541B' },
  ].filter(x => x.value > 0)
  const groups = Array.from(new Set(machines.map(m => m.group || 'Other')))
  const wsLabel = data?.week_start ? fmtDay(data.week_start).replace(/,.*/, '') : 'Mon'
  const rangeLabel = range === 'today' ? 'today' : `${fmtDay(from)} to today`
  const unpriced: string[] = data?.unpriced || []

  const tip = { contentStyle: { borderRadius: 12, border: '1px solid #E4E6EE', fontSize: 12 }, labelStyle: { fontWeight: 600 } }

  return (
    <div className="p-4 md:p-8 min-h-screen">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3 mb-5">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-700 border-emerald-500/30">PRODUCTION</span>
          <h1 className="text-2xl font-semibold text-[#1A1D2E] mt-1">Production Dashboard</h1>
          <p className="text-gray-500 text-sm">All boards and machines. Output and revenue come from what was logged or reported, never the running estimate.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex gap-1 bg-[#ECEEF3] rounded-xl p-1">
            {RANGES.map(r => <button key={r.k} onClick={() => setRange(r.k)} className={`h-9 px-3 rounded-lg text-sm font-semibold ${range === r.k ? 'bg-white shadow-sm text-[#1A1D2E]' : 'text-gray-500'}`}>{r.l}</button>)}
          </div>
          <select value={focus || ''} onChange={e => setFocus(e.target.value || null)} className="h-11 rounded-xl border border-[#E4E6EE] bg-white px-3 text-sm font-semibold text-[#1A1D2E]">
            <option value="">All boards</option>
            {boards.map(b => <option key={b.key} value={b.key}>{b.title}</option>)}
          </select>
        </div>
      </div>
      {err && <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
      {!data && !err && <p className="py-20 text-center text-sm text-gray-500">Loading…</p>}

      {data && <>
        {/* Revenue + KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
          {[
            { l: 'Revenue today', v: money(data.rev_today), s: `${fmt(data.pcs_today)} pcs made today`, hi: true },
            { l: 'Revenue this week', v: money(data.rev_week), s: `${wsLabel} to today · ${fmt(data.pcs_week)} pcs`, hi: true },
            { l: `Revenue · ${RANGES.find(r => r.k === range)!.l}`, v: money(totRev), s: totPcs ? `${money2(totRev / Math.max(1, totPcs) * 1000)} per 1,000 pcs` : rangeLabel },
            { l: 'Open work orders', v: fmt(openWos), s: late ? `${late} past due` : 'none past due', red: late > 0 },
            { l: 'Machines running', v: `${running} / ${machines.length}`, s: paused ? `${paused} paused` : 'live now' },
            { l: 'Queued machine time', v: `${fmt(queuedH)} h`, s: `${(queuedH / CAP).toFixed(1)} machine-days of work` },
          ].map(k => (
            <div key={k.l} className={card + ' p-4'} style={(k as any).hi ? { background: 'linear-gradient(135deg,#F0FAF5,#fff)', borderColor: '#BFE5D2' } : undefined}>
              <p className="text-xs text-gray-500">{k.l}</p>
              <p className={`text-2xl font-bold mt-0.5 ${(k as any).hi ? 'text-emerald-700' : 'text-[#1A1D2E]'}`}>{k.v}</p>
              <p className={`text-[11px] mt-0.5 ${(k as any).red ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>{k.s}</p>
            </div>
          ))}
        </div>
        {unpriced.length > 0 && <p className="mb-4 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">No price found for {unpriced.join(', ')}, so their output counts as $0. Add a price on the product or the sales order line.</p>}

        {/* Trend + revenue split */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-5">
          <section className={card + ' p-5 xl:col-span-2'}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h2 className="font-semibold text-[#1A1D2E]">Output trend</h2>
              <div className="flex gap-1 bg-[#F2F4F8] rounded-lg p-0.5">
                {METRICS.map(m => <button key={m.k} onClick={() => setMetric(m.k)} className={`h-8 px-3 rounded-md text-xs font-semibold ${metric === m.k ? 'bg-white shadow-sm text-[#1A1D2E]' : 'text-gray-500'}`}>{m.l}</button>)}
              </div>
            </div>
            {chartBoards.length === 0 ? <p className="py-16 text-center text-sm text-gray-500">Nothing logged in this period.</p> : (
              <div style={{ width: '100%', height: 300 }}>
                <ResponsiveContainer>
                  <AreaChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>{chartBoards.map(b => <linearGradient key={b.key} id={'g' + b.key} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={b.accent} stopOpacity={0.5} /><stop offset="100%" stopColor={b.accent} stopOpacity={0.05} /></linearGradient>)}</defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F5" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} minTickGap={12} />
                    <YAxis tickFormatter={axisMetric} tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} width={56} />
                    <Tooltip {...tip} formatter={(v: any, n: any) => [fmtMetric(Number(v)), boards.find(b => b.key === n)?.title || n]} labelFormatter={(_: any, p: any) => p?.[0]?.payload?.d ? fmtDay(p[0].payload.d) : ''} />
                    <Legend onClick={(e: any) => { const k = e?.dataKey; setHidden(h => { const n = new Set(h); n.has(k) ? n.delete(k) : n.add(k); return n }) }}
                      formatter={(v: any) => <span style={{ fontSize: 12, color: hidden.has(v) ? '#C0C4CE' : '#374151', cursor: 'pointer' }}>{boards.find(b => b.key === v)?.title || v}</span>} />
                    {chartBoards.map(b => <Area key={b.key} type="monotone" dataKey={b.key} stackId="1" stroke={b.accent} strokeWidth={2} fill={`url(#g${b.key})`} hide={hidden.has(b.key)} />)}
                    {days.length > 14 && <Brush dataKey="label" height={22} stroke="#9CA3AF" travellerWidth={8} />}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
            <p className="text-[11px] text-gray-400 mt-1">Tap a board in the legend to hide or show it.{days.length > 14 ? ' Drag the slider to zoom.' : ''}</p>
          </section>
          <section className={card + ' p-5'}>
            <h2 className="font-semibold text-[#1A1D2E] mb-1">Revenue by board</h2>
            <p className="text-xs text-gray-500 mb-2">{rangeLabel} · tap a slice to filter</p>
            {revBoards.length === 0 ? <p className="py-16 text-center text-sm text-gray-500">No revenue in this period.</p> : (
              <div style={{ width: '100%', height: 250 }} className="relative">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={revBoards} dataKey="value" nameKey="name" innerRadius={62} outerRadius={95} paddingAngle={2}
                      onClick={(d: any) => setFocus(f => f === d?.key ? null : d?.key)} cursor="pointer">
                      {revBoards.map(r => <Cell key={r.key} fill={r.fill} stroke="#fff" strokeWidth={2} opacity={!focus || focus === r.key ? 1 : 0.35} />)}
                    </Pie>
                    <Tooltip {...tip} formatter={(v: any, n: any) => [money(v), n]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <p className="text-[11px] text-gray-500">Total</p>
                  <p className="text-lg font-bold text-[#1A1D2E]">{money(totRev)}</p>
                </div>
              </div>
            )}
            <ul className="mt-2 flex flex-col gap-1">
              {boards.filter(b => Number(b.revenue) > 0 || Number(b.rev_week) > 0).map(b => (
                <li key={b.key} className="flex items-center justify-between text-xs"><span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: b.accent }} />{b.title}</span><span className="text-gray-600">today <b className="text-[#1A1D2E]">{money(b.rev_today)}</b> · week <b className="text-[#1A1D2E]">{money(b.rev_week)}</b></span></li>
              ))}
            </ul>
          </section>
        </div>

        {/* Top SKUs + machine load */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-5">
          <section className={card + ' p-5'}>
            <div className="flex items-center justify-between mb-2"><h2 className="font-semibold text-[#1A1D2E]">Top SKUs</h2><span className="text-xs text-gray-500">{metric === 'rev' ? 'by revenue' : 'by pieces'}</span></div>
            {!tops.length ? <p className="py-12 text-center text-sm text-gray-500">Nothing logged in this period.</p> : (
              <div style={{ width: '100%', height: Math.max(180, tops.length * 30) }}>
                <ResponsiveContainer>
                  <BarChart data={tops.map(t => ({ ...t, v: metric === 'rev' ? Number(t.revenue) : metric === 'pcs' ? Number(t.pcs) : Number(t.units) }))} layout="vertical" margin={{ left: 0, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F5" horizontal={false} />
                    <XAxis type="number" tickFormatter={axisMetric} tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="sku" width={110} tick={{ fontSize: 11, fill: '#1A1D2E', fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
                    <Tooltip {...tip} formatter={() => null} content={({ active, payload }: any) => active && payload?.[0] ? (
                      <div className="rounded-xl border border-[#E4E6EE] bg-white px-3 py-2 text-xs shadow">
                        <p className="font-mono font-bold">{payload[0].payload.sku}</p>
                        <p>{fmt(payload[0].payload.units)} {(payload[0].payload.uom || '').toLowerCase()} · {fmt(payload[0].payload.pcs)} pcs</p>
                        <p className="font-semibold text-emerald-700">{money(payload[0].payload.revenue)}</p>
                        <p className="text-gray-400">{payload[0].payload.price_source}</p>
                      </div>) : null} />
                    <Bar dataKey="v" radius={[0, 6, 6, 0]}>
                      {tops.map(t => <Cell key={t.sku} fill={boards.find(b => b.key === t.board)?.accent || '#1E9E6A'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>
          <section className={card + ' p-5'}>
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-[#1A1D2E]">Machine load</h2>
              <span className="text-xs text-gray-500">queued hours · line = one 22 h day</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2" style={{ height: 240 }}>
                {load_.length === 0 ? <p className="py-12 text-center text-sm text-gray-500">No work queued on machines.</p> : (
                  <ResponsiveContainer>
                    <BarChart data={load_} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F5" vertical={false} />
                      <XAxis dataKey="code" tick={{ fontSize: 10, fill: '#374151' }} interval={0} angle={-35} textAnchor="end" height={44} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                      <Tooltip {...tip} formatter={(v: any) => [`${v} h (${Math.round(Number(v) / CAP * 100)}% of a day)`, 'Queued']} />
                      <ReferenceLine y={CAP} stroke="#E5541B" strokeDasharray="4 4" />
                      <Bar dataKey="hours" radius={[6, 6, 0, 0]} cursor="pointer" onClick={() => { window.location.href = '/production/machine-status' }}>
                        {load_.map(m => <Cell key={m.code} fill={m.over ? '#E5541B' : m.hours > CAP * 0.7 ? '#E0A21B' : '#1E9E6A'} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div style={{ height: 240 }} className="relative">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={statusPie} dataKey="value" nameKey="name" innerRadius={40} outerRadius={62} paddingAngle={2}>
                      {statusPie.map(s => <Cell key={s.name} fill={s.fill} stroke="#fff" strokeWidth={2} />)}
                    </Pie>
                    <Tooltip {...tip} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-x-0 top-[96px] text-center pointer-events-none"><p className="text-lg font-bold text-[#1A1D2E]">{running}/{machines.length}</p><p className="text-[10px] text-gray-500">running</p></div>
                <ul className="absolute inset-x-0 bottom-0 text-[11px] text-gray-600 flex flex-col items-center">{statusPie.map(s => <li key={s.name} className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: s.fill }} />{s.name} {s.value}</li>)}</ul>
              </div>
            </div>
          </section>
        </div>

        {/* Boards */}
        <section className="mb-5">
          <h2 className="font-semibold text-[#1A1D2E] mb-3">Production boards</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {(activeBoards.length ? shownBoards : shownBoards).map(b => {
              const pct = Number(b.open_target) ? Math.round(Number(b.open_made) / Number(b.open_target) * 100) : 0
              const spark = days.map(d => ({ d, v: Number((b.daily || []).find((x: any) => x.d === d)?.rev || 0) }))
              return (
                <div key={b.key} className={card + ' p-4 hover:shadow-md transition-shadow'} style={{ borderTop: `4px solid ${b.accent}` }}>
                  <div className="flex items-start justify-between gap-2">
                    <a href={b.route} className="font-semibold text-[#1A1D2E] leading-tight hover:underline">{b.title}</a>
                    {Number(b.late) > 0 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-700 whitespace-nowrap">{b.late} late</span>}
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                    <div className="rounded-lg bg-[#F0FAF5] p-2"><p className="text-[10px] uppercase tracking-wide text-gray-500">Revenue</p><p className="font-bold text-emerald-700">{money(b.revenue)}</p><p className="text-[10px] text-gray-500">today {money(b.rev_today)}</p></div>
                    <div className="rounded-lg bg-[#F5F6FA] p-2"><p className="text-[10px] uppercase tracking-wide text-gray-500">Output</p><p className="font-bold text-[#1A1D2E]">{fmt(b.units)}</p><p className="text-[10px] text-gray-500">{(b.unit || 'units').toLowerCase()} · {short(Number(b.pcs))} pcs</p></div>
                    <div className="rounded-lg bg-[#F5F6FA] p-2"><p className="text-[10px] uppercase tracking-wide text-gray-500">Open WOs</p><p className="font-bold text-[#1A1D2E]">{b.open_wos}</p><p className="text-[10px] text-gray-500">{pct}% made</p></div>
                  </div>
                  {spark.some(s => s.v > 0) && (
                    <div style={{ height: 48 }} className="mt-2">
                      <ResponsiveContainer>
                        <AreaChart data={spark} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                          <Tooltip {...tip} formatter={(v: any) => [money(v), 'Revenue']} labelFormatter={(_: any, p: any) => p?.[0]?.payload?.d ? fmtDay(p[0].payload.d) : ''} />
                          <Area type="monotone" dataKey="v" stroke={b.accent} fill={b.accent} fillOpacity={0.15} strokeWidth={2} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  {(b.wos || []).length > 0 ? (
                    <ul className="mt-3 flex flex-col gap-1.5">
                      {(b.wos || []).slice(0, 4).map((w: any) => {
                        const p = Number(w.t) ? Math.min(100, Math.round(Number(w.m) / Number(w.t) * 100)) : 0
                        const isLate = w.due && w.due < today && Number(w.m) < Number(w.t)
                        return (
                          <li key={w.id} className="text-xs" title={`${fmt(w.m)} of ${fmt(w.t)} made (${p}%)`}>
                            <div className="flex justify-between gap-2"><span className="font-semibold text-[#1A1D2E] truncate">{w.code}</span><span className={isLate ? 'text-red-600 font-semibold' : 'text-gray-500'}>{p}%{w.due ? ` · ${isLate ? 'was due' : 'due'} ${fmtDay(w.due)}` : ''}</span></div>
                            <div className="h-1.5 rounded-full bg-[#E6ECE7] mt-1 overflow-hidden"><div className="h-full rounded-full transition-all" style={{ width: `${p}%`, background: b.accent }} /></div>
                          </li>
                        )
                      })}
                      {(b.wos || []).length > 4 && <li className="text-[11px] text-gray-400">+{(b.wos || []).length - 4} more</li>}
                    </ul>
                  ) : <p className="mt-3 text-xs text-gray-400">No open work orders.</p>}
                </div>
              )
            })}
          </div>
        </section>

        {/* Machines */}
        <section className={card + ' mb-5 overflow-hidden'}>
          <div className="px-5 py-4 border-b border-[#E4E6EE] flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-[#1A1D2E]">Machines</h2>
            <a href="/production/machine-status" className="text-xs font-semibold text-emerald-700 hover:underline">Open Machine Status →</a>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#F5F6FA] text-[11px] uppercase tracking-wide text-gray-500">
                <tr><th className="text-left px-4 py-2">Machine</th><th className="text-left px-2">Status</th><th className="text-left px-2">Running now</th><th className="text-left px-2">Mold</th><th className="text-left px-2 w-40">Queued</th><th className="text-right px-2">Actual vs spec</th><th className="text-right px-4">Reported</th></tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <Fragment key={'g' + g}>
                    <tr className="bg-white"><td colSpan={7} className="px-4 pt-3 pb-1 text-[11px] font-bold text-gray-500 uppercase tracking-wide">{g}</td></tr>
                    {machines.filter(m => (m.group || 'Other') === g).map(m => {
                      const q = Number(m.queue_hours || 0)
                      const qp = Math.round(q / CAP * 100)
                      const est = estOf(m)
                      const eff = m.learned_pph && m.spec_pph ? Math.round(Number(m.learned_pph) / Number(m.spec_pph) * 100) : null
                      return (
                        <tr key={m.id} className="border-t border-[#EEF0F5] hover:bg-[#FAFBFC]">
                          <td className="px-4 py-2"><span className="font-mono font-bold text-[#1A1D2E]">{m.code}</span>{m.planned_today && <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">planned today</span>}</td>
                          <td className="px-2"><span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${m.running ? 'text-emerald-700' : m.paused ? 'text-amber-700' : 'text-red-600'}`}><span className={`w-2 h-2 rounded-full ${m.running ? 'bg-emerald-500 animate-pulse' : m.paused ? 'bg-amber-500' : 'bg-red-500'}`} />{m.running ? 'Running' : m.paused ? 'Paused' : (m.status || 'Off')}</span></td>
                          <td className="px-2 text-xs text-gray-600">{m.run_wo ? <>{m.run_wo}{est != null && <span className="block text-[10px] text-gray-400">≈ {fmt(est)} pcs est.</span>}</> : '—'}</td>
                          <td className="px-2 text-xs font-mono text-gray-600">{m.mold || '—'}</td>
                          <td className="px-2 text-xs">{q ? (
                            <div title={`${q.toFixed(1)} h across ${m.queue_wos} work order(s)`}>
                              <div className="flex justify-between"><span className={qp > 100 ? 'text-red-600 font-semibold' : 'text-[#1A1D2E]'}>{q.toFixed(1)} h</span><span className="text-gray-400">{qp}%</span></div>
                              <div className="h-1.5 rounded-full bg-[#E6ECE7] mt-1 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.min(100, qp)}%`, background: qp > 100 ? '#E5541B' : qp > 70 ? '#E0A21B' : '#1E9E6A' }} /></div>
                            </div>) : <span className="text-gray-400">—</span>}</td>
                          <td className="px-2 text-right text-xs">{m.learned_pph ? <><b className="text-[#1A1D2E]">{fmt(m.learned_pph)}/hr</b>{eff != null && <span className={`block text-[10px] ${eff < 85 ? 'text-amber-700' : 'text-gray-400'}`}>{eff}% of {fmt(m.spec_pph)}</span>}</> : m.spec_pph ? <span className="text-gray-500">spec {fmt(m.spec_pph)}/hr</span> : <span className="text-gray-400">no rate</span>}</td>
                          <td className="px-4 text-right text-xs">{Number(m.period_pcs) ? <><b className="text-[#1A1D2E]">{fmt(m.period_pcs)} pcs</b><span className="block text-[10px] text-gray-400">{Number(m.period_hours).toFixed(1)} h run</span></> : <span className="text-gray-400">—</span>}</td>
                        </tr>
                      )
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Recent runs */}
        <section className={card + ' overflow-hidden'}>
          <div className="px-5 py-4 border-b border-[#E4E6EE]"><h2 className="font-semibold text-[#1A1D2E]">Recent reported machine runs</h2><p className="text-xs text-gray-500">Actual counts the operators booked, compared with the estimate and spec.</p></div>
          {!runs.length ? <p className="px-5 py-6 text-sm text-gray-500">No machine runs reported in this period yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#F5F6FA] text-[11px] uppercase tracking-wide text-gray-500"><tr><th className="text-left px-4 py-2">When</th><th className="text-left px-2">Machine</th><th className="text-left px-2">Work order</th><th className="text-right px-2">Run</th><th className="text-right px-2">Actual</th><th className="text-right px-2">Estimate</th><th className="text-right px-4">Rate vs spec</th></tr></thead>
                <tbody>
                  {runs.map((r, i) => {
                    const eff = r.spec_pph ? Math.round(Number(r.actual_pph) / Number(r.spec_pph) * 100) : null
                    return (
                      <tr key={i} className="border-t border-[#EEF0F5]">
                        <td className="px-4 py-2 text-xs text-gray-600">{new Date(r.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{r.operator && <span className="block text-[10px] text-gray-400">{r.operator}</span>}</td>
                        <td className="px-2 font-mono font-semibold text-[#1A1D2E]">{r.machine_code}</td>
                        <td className="px-2 text-xs text-gray-600">{r.wo_code || '—'}{r.child_sku && <span className="block text-[10px] font-mono text-gray-400">{r.child_sku}</span>}</td>
                        <td className="px-2 text-right text-xs">{Number(r.run_hours).toFixed(1)} h</td>
                        <td className="px-2 text-right text-xs font-semibold text-[#1A1D2E]">{fmt(r.actual_pcs)} pcs</td>
                        <td className="px-2 text-right text-xs text-gray-500">{r.est_pcs ? `${fmt(r.est_pcs)} pcs` : '—'}</td>
                        <td className="px-4 text-right text-xs">{fmt(r.actual_pph)}/hr{eff != null && <span className={`block text-[10px] ${eff < 85 ? 'text-amber-700' : 'text-gray-400'}`}>{eff}% of spec</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </>}
    </div>
  )
}
