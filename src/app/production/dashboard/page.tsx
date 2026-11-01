'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PRODUCTION DASHBOARD — one management view across every production board and every machine.
 * Output by board (logged production, in each board's unit and in pieces), open work orders and lateness,
 * machine status, queued hours, actual vs spec rate, and recent reported machine runs.
 * All numbers come from production_dashboard(from, to). Estimates are never shown as output.
 */
export const dynamic = 'force-dynamic'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const CAP = 22
const ymd = (d: Date) => d.toLocaleDateString('en-CA')
const addDays = (s: string, n: number) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d) }
const fmt = (n: any) => Math.round(Number(n) || 0).toLocaleString()
const fmtDay = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const card = 'bg-white border border-[#E4E6EE] rounded-2xl'

const RANGES = [
  { k: 'today', l: 'Today', from: (t: string) => t },
  { k: '7', l: 'Last 7 days', from: (t: string) => addDays(t, -6) },
  { k: '30', l: 'Last 30 days', from: (t: string) => addDays(t, -29) },
] as const

export default function ProductionDashboard() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const today = ymd(new Date())
  const [range, setRange] = useState<'today' | '7' | '30'>('7')
  const [data, setData] = useState<any>(null)
  const [err, setErr] = useState('')
  const [now, setNow] = useState(Date.now())
  const from = RANGES.find(r => r.k === range)!.from(today)

  async function load() {
    const { data, error } = await sb.rpc('production_dashboard', { p_from: from, p_to: today })
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
  const tops: any[] = data?.top_skus || []
  const days: string[] = []
  for (let d = from; d <= today; d = addDays(d, 1)) days.push(d)

  const totPcs = boards.reduce((s, b) => s + Number(b.pcs || 0), 0)
  const openWos = boards.reduce((s, b) => s + Number(b.open_wos || 0), 0)
  const late = boards.reduce((s, b) => s + Number(b.late || 0), 0)
  const running = machines.filter(m => m.running).length
  const paused = machines.filter(m => m.paused).length
  const queuedH = machines.reduce((s, m) => s + Number(m.queue_hours || 0), 0)
  const capH = machines.length * CAP
  const plannedToday = machines.filter(m => m.planned_today).length
  const estOf = (m: any) => m.run_rate ? Number(m.run_rate) * (Number(m.run_elapsed_sec || 0) + (m.run_started_at ? Math.max(0, (now - Date.parse(m.run_started_at)) / 1000) : 0)) / 3600 : null

  // Daily pieces across boards, stacked
  const dailyMax = Math.max(1, ...days.map(d => boards.reduce((s, b) => s + Number((b.daily || []).find((x: any) => x.d === d)?.pcs || 0), 0)))
  const groups = Array.from(new Set(machines.map(m => m.group || 'Other')))

  return (
    <div className="p-4 md:p-8 min-h-screen">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-700 border-emerald-500/30">PRODUCTION</span>
          <h1 className="text-2xl font-semibold text-[#1A1D2E] mt-1">Production Dashboard</h1>
          <p className="text-gray-500 text-sm">All production boards and machines in one view. Output is what was logged or reported, never the running estimate.</p>
        </div>
        <div className="flex gap-1 bg-[#ECEEF3] rounded-xl p-1">
          {RANGES.map(r => <button key={r.k} onClick={() => setRange(r.k)} className={`h-9 px-4 rounded-lg text-sm font-semibold ${range === r.k ? 'bg-white shadow-sm text-[#1A1D2E]' : 'text-gray-500'}`}>{r.l}</button>)}
        </div>
      </div>
      {err && <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
      {!data && !err && <p className="py-20 text-center text-sm text-gray-500">Loading…</p>}

      {data && <>
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
          {[
            { l: 'Pieces produced', v: fmt(totPcs), s: range === 'today' ? 'today' : `${fmtDay(from)} to today` },
            { l: 'Open work orders', v: fmt(openWos), s: late ? `${late} past due` : 'none past due', red: late > 0 },
            { l: 'Machines running', v: `${running} / ${machines.length}`, s: paused ? `${paused} paused` : 'live' },
            { l: 'Queued machine time', v: `${fmt(queuedH)} h`, s: `${Math.round(queuedH / Math.max(1, capH) * 100)}% of one day across all machines` },
            { l: 'Planned today', v: `${plannedToday}`, s: 'machines on today\'s run plan' },
            { l: 'Reported runs', v: fmt(runs.length), s: `${fmt(runs.reduce((s, r) => s + Number(r.actual_pcs || 0), 0))} pcs reported` },
          ].map(k => (
            <div key={k.l} className={card + ' p-4'}>
              <p className="text-xs text-gray-500">{k.l}</p>
              <p className="text-2xl font-bold text-[#1A1D2E] mt-0.5">{k.v}</p>
              <p className={`text-[11px] mt-0.5 ${(k as any).red ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>{k.s}</p>
            </div>
          ))}
        </div>

        {/* Output by board */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
          <section className={card + ' p-5 lg:col-span-2'}>
            <div className="flex items-center justify-between mb-3"><h2 className="font-semibold text-[#1A1D2E]">Output by day</h2><span className="text-xs text-gray-500">pieces, all boards</span></div>
            <div className="flex items-end gap-1.5 h-44">
              {days.map(d => {
                const segs = boards.map(b => ({ b, pcs: Number((b.daily || []).find((x: any) => x.d === d)?.pcs || 0) })).filter(s => s.pcs > 0)
                const tot = segs.reduce((s, x) => s + x.pcs, 0)
                return (
                  <div key={d} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${fmtDay(d)}: ${fmt(tot)} pcs`}>
                    <div className="w-full flex flex-col-reverse rounded-md overflow-hidden bg-[#F2F4F8]" style={{ height: 150 }}>
                      {segs.map(s => <div key={s.b.key} style={{ height: `${s.pcs / dailyMax * 150}px`, background: s.b.accent }} />)}
                    </div>
                    {days.length <= 14 && <span className="text-[10px] text-gray-500 truncate">{fmtDay(d).split(',')[0]}</span>}
                  </div>
                )
              })}
            </div>
            <div className="flex flex-wrap gap-3 mt-3">{boards.filter(b => Number(b.pcs) > 0).map(b => <span key={b.key} className="flex items-center gap-1.5 text-[11px] text-gray-600"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: b.accent }} />{b.title}</span>)}</div>
          </section>
          <section className={card + ' p-5'}>
            <h2 className="font-semibold text-[#1A1D2E] mb-3">Top SKUs produced</h2>
            {!tops.length ? <p className="text-sm text-gray-500">Nothing logged in this period.</p> : (
              <ul className="flex flex-col gap-2">
                {tops.map(t => (
                  <li key={t.sku} className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-mono font-semibold text-[#1A1D2E] truncate">{t.sku}</span>
                    <span className="text-right text-xs text-gray-600 whitespace-nowrap"><b className="text-[#1A1D2E]">{fmt(t.units)}</b> {(t.uom || '').toLowerCase()}<span className="block text-[10px] text-gray-400">{fmt(t.pcs)} pcs</span></span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="mb-5">
          <h2 className="font-semibold text-[#1A1D2E] mb-3">Production boards</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {boards.map(b => {
              const pct = Number(b.open_target) ? Math.round(Number(b.open_made) / Number(b.open_target) * 100) : 0
              return (
                <a key={b.key} href={b.route} className={card + ' p-4 hover:shadow-md transition-shadow block'} style={{ borderTop: `4px solid ${b.accent}` }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-[#1A1D2E] leading-tight">{b.title}</p>
                    {Number(b.late) > 0 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-700 whitespace-nowrap">{b.late} late</span>}
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                    <div className="rounded-lg bg-[#F5F6FA] p-2"><p className="text-[10px] uppercase tracking-wide text-gray-500">Output</p><p className="font-bold text-[#1A1D2E]">{fmt(b.units)}</p><p className="text-[10px] text-gray-500">{(b.unit || 'units').toLowerCase()}</p></div>
                    <div className="rounded-lg bg-[#F5F6FA] p-2"><p className="text-[10px] uppercase tracking-wide text-gray-500">Pieces</p><p className="font-bold text-[#1A1D2E]">{fmt(b.pcs)}</p><p className="text-[10px] text-gray-500">{b.entries} entries</p></div>
                    <div className="rounded-lg bg-[#F5F6FA] p-2"><p className="text-[10px] uppercase tracking-wide text-gray-500">Open WOs</p><p className="font-bold text-[#1A1D2E]">{b.open_wos}</p><p className="text-[10px] text-gray-500">{pct}% made</p></div>
                  </div>
                  {(b.wos || []).length > 0 ? (
                    <ul className="mt-3 flex flex-col gap-1.5">
                      {(b.wos || []).slice(0, 4).map((w: any) => {
                        const p = Number(w.t) ? Math.min(100, Math.round(Number(w.m) / Number(w.t) * 100)) : 0
                        const isLate = w.due && w.due < today && Number(w.m) < Number(w.t)
                        return (
                          <li key={w.id} className="text-xs">
                            <div className="flex justify-between gap-2"><span className="font-semibold text-[#1A1D2E] truncate">{w.code}</span><span className={isLate ? 'text-red-600 font-semibold' : 'text-gray-500'}>{fmt(w.m)} / {fmt(w.t)}{w.due ? ` · ${isLate ? 'was due' : 'due'} ${fmtDay(w.due)}` : ''}</span></div>
                            <div className="h-1.5 rounded-full bg-[#E6ECE7] mt-1 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${p}%`, background: b.accent }} /></div>
                          </li>
                        )
                      })}
                      {(b.wos || []).length > 4 && <li className="text-[11px] text-gray-400">+{(b.wos || []).length - 4} more</li>}
                    </ul>
                  ) : <p className="mt-3 text-xs text-gray-400">No open work orders.</p>}
                </a>
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
                <tr><th className="text-left px-4 py-2">Machine</th><th className="text-left px-2">Status</th><th className="text-left px-2">Running now</th><th className="text-left px-2">Mold</th><th className="text-right px-2">Queued</th><th className="text-right px-2">Actual vs spec</th><th className="text-right px-4">Reported ({range === 'today' ? 'today' : 'period'})</th></tr>
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
                        <tr key={m.id} className="border-t border-[#EEF0F5]">
                          <td className="px-4 py-2"><span className="font-mono font-bold text-[#1A1D2E]">{m.code}</span>{m.planned_today && <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">planned today</span>}</td>
                          <td className="px-2"><span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${m.running ? 'text-emerald-700' : m.paused ? 'text-amber-700' : 'text-red-600'}`}><span className={`w-2 h-2 rounded-full ${m.running ? 'bg-emerald-500 animate-pulse' : m.paused ? 'bg-amber-500' : 'bg-red-500'}`} />{m.running ? 'Running' : m.paused ? 'Paused' : (m.status || 'Off')}</span></td>
                          <td className="px-2 text-xs text-gray-600">{m.run_wo ? <>{m.run_wo}{est != null && <span className="block text-[10px] text-gray-400">≈ {fmt(est)} pcs est.</span>}</> : '—'}</td>
                          <td className="px-2 text-xs font-mono text-gray-600">{m.mold || '—'}</td>
                          <td className="px-2 text-right text-xs"><span className={qp > 100 ? 'text-red-600 font-semibold' : 'text-[#1A1D2E]'}>{q ? `${q.toFixed(1)} h` : '—'}</span>{q ? <span className="block text-[10px] text-gray-400">{qp}% of a day · {m.queue_wos} WO</span> : null}</td>
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
