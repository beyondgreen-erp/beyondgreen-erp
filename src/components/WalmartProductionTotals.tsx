'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Walmart production totals — Daily / Monthly / Fiscal Year — straight from the logs on the
 * Walmart Production board (walmart_production_entries, voided entries excluded).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import jsPDF from 'jspdf'
import '@/lib/pdfSafeText'
import autoTable from 'jspdf-autotable'
import { ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, PieChart, Pie, Cell } from 'recharts'

export type Period = 'daily' | 'monthly' | 'fy'
const SKUS = [
  { sku: '22GVA24', short: 'Assorted 24', color: '#a25ddc' }, { sku: '22GVA48', short: 'Assorted 48', color: '#784bd1' },
  { sku: '22GVF24', short: 'Fork 24', color: '#579bfc' }, { sku: '22GVF48', short: 'Fork 48', color: '#0071ce' },
  { sku: '22GVK48', short: 'Knife 48', color: '#e2445c' }, { sku: '22GVS24', short: 'Spoon 24', color: '#00c875' },
  { sku: '22GVS48', short: 'Spoon 48', color: '#037f4c' },
]
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const addDays = (s: string, n: number) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d) }
const fmt = (n: number) => (Number(n) || 0).toLocaleString('en-US')
const nice = (s: string) => parse(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
const who = (e: string | null) => (e || 'unknown').split('@')[0]

interface Entry { id: string; production_date: string; sku: string; qty: number; entered_by: string | null; created_at: string; lot_number: string | null; note: string | null; work_orders: { wo_code: string | null } | null }
interface Row { key: string; label: string; bySku: Record<string, number>; total: number }

export default function WalmartProductionTotals({ sb, period }: { sb: any; period: Period; onPeriod?: (p: Period) => void }) {
  const today = ymd(new Date())
  const [day, setDay] = useState(today)
  const [month, setMonth] = useState(today.slice(0, 7))
  const [fyStart, setFyStartState] = useState(1)
  const [fyEndYear, setFyEndYear] = useState(new Date().getFullYear())
  const [entries, setEntries] = useState<Entry[]>([])
  const [trend, setTrend] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    try {
      const v = Number(localStorage.getItem('wm.fyStart'))
      if (v >= 1 && v <= 12) {
        setFyStartState(v)
        const d = new Date(); setFyEndYear(v === 1 ? d.getFullYear() : (d.getMonth() + 1 >= v ? d.getFullYear() + 1 : d.getFullYear()))
      }
    } catch { /* ignore */ }
  }, [])
  function setFyStart(v: number) {
    setFyStartState(v); try { localStorage.setItem('wm.fyStart', String(v)) } catch { /* ignore */ }
    const d = new Date(); setFyEndYear(v === 1 ? d.getFullYear() : (d.getMonth() + 1 >= v ? d.getFullYear() + 1 : d.getFullYear()))
  }
  // FY "2026" = the fiscal year that ENDS in 2026
  const fyFrom = fyStart === 1 ? `${fyEndYear}-01-01` : `${fyEndYear - 1}-${pad(fyStart)}-01`
  const fyTo = addDays(fyStart === 1 ? `${fyEndYear + 1}-01-01` : `${fyEndYear}-${pad(fyStart)}-01`, -1)
  const monthFrom = `${month}-01`
  const monthTo = (() => { const [y, m] = month.split('-').map(Number); return ymd(new Date(y, m, 0)) })()
  const [from, to] = period === 'daily' ? [day, day] : period === 'monthly' ? [monthFrom, monthTo] : [fyFrom, fyTo]

  const fetchRange = useCallback(async (a: string, b: string) => {
    const out: Entry[] = []
    for (let i = 0; i < 50000; i += 1000) {
      const { data, error } = await sb.from('walmart_production_entries')
        .select('id,production_date,sku,qty,entered_by,created_at,lot_number,note,work_orders(wo_code)')
        .is('voided_at', null).gte('production_date', a).lte('production_date', b)
        .order('production_date').order('created_at').range(i, i + 999)
      if (error) throw new Error(error.message)
      out.push(...((data as Entry[]) || []))
      if (!data || data.length < 1000) break
    }
    return out
  }, [sb])

  useEffect(() => {
    let alive = true
    setLoading(true); setErr('')
    ;(async () => {
      try {
        const [main, tr] = await Promise.all([fetchRange(from, to), period === 'daily' ? fetchRange(addDays(day, -13), day) : Promise.resolve([] as Entry[])])
        if (!alive) return
        setEntries(main); setTrend(tr)
      } catch (e) { if (alive) setErr((e as Error).message) }
      if (alive) setLoading(false)
    })()
    return () => { alive = false }
  }, [fetchRange, from, to, period, day])

  const bySku = useMemo(() => { const m: Record<string, number> = {}; for (const e of entries) m[e.sku] = (m[e.sku] || 0) + Number(e.qty); return m }, [entries])
  const total = entries.reduce((s, e) => s + Number(e.qty), 0)
  const people = useMemo(() => {
    const m = new Map<string, { logs: number; qty: number; days: Set<string> }>()
    for (const e of entries) { const k = e.entered_by || 'unknown'; const v = m.get(k) || { logs: 0, qty: 0, days: new Set<string>() }; v.logs++; v.qty += Number(e.qty); v.days.add(e.production_date); m.set(k, v) }
    return Array.from(m.entries()).map(([k, v]) => ({ who: k, logs: v.logs, qty: v.qty, days: v.days.size })).sort((a, b) => b.qty - a.qty)
  }, [entries])

  // rows: daily → each log; monthly → each day; fy → each month
  const rows: Row[] = useMemo(() => {
    const mk = (key: string, label: string): Row => ({ key, label, bySku: {}, total: 0 })
    const map = new Map<string, Row>()
    if (period === 'monthly') { for (let d = monthFrom; d <= monthTo; d = addDays(d, 1)) map.set(d, mk(d, nice(d))) }
    if (period === 'fy') { for (let i = 0; i < 12; i++) { const d = parse(fyFrom); d.setMonth(d.getMonth() + i); const k = ymd(d).slice(0, 7); map.set(k, mk(k, `${MONTHS[d.getMonth()]} ${d.getFullYear()}`)) } }
    for (const e of entries) {
      const k = period === 'daily' ? e.id : period === 'monthly' ? e.production_date : e.production_date.slice(0, 7)
      if (!map.has(k)) map.set(k, mk(k, period === 'daily' ? `${new Date(e.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · ${who(e.entered_by)}${e.work_orders?.wo_code ? ' · ' + e.work_orders.wo_code : ''}` : k))
      const r = map.get(k)!; r.bySku[e.sku] = (r.bySku[e.sku] || 0) + Number(e.qty); r.total += Number(e.qty)
    }
    return Array.from(map.values())
  }, [entries, period, monthFrom, monthTo, fyFrom])
  const trendDays = useMemo(() => {
    const m: Record<string, number> = {}; for (const e of trend) m[e.production_date] = (m[e.production_date] || 0) + Number(e.qty)
    return Array.from({ length: 14 }, (_, i) => { const d = addDays(day, i - 13); return { d, q: m[d] || 0 } })
  }, [trend, day])
  // chart rows: daily → last 14 days by SKU; monthly → each day; FY → each month (+ running total)
  const chartData = useMemo(() => {
    if (period === 'daily') {
      const m: Record<string, Record<string, number>> = {}
      for (const e of trend) { (m[e.production_date] ||= {})[e.sku] = (m[e.production_date]?.[e.sku] || 0) + Number(e.qty) }
      return trendDays.map(t => ({ key: t.d, label: parse(t.d).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }), ...Object.fromEntries(SKUS.map(s => [s.sku, m[t.d]?.[s.sku] || 0])), total: t.q }))
    }
    let run = 0
    return rows.map(r => { run += r.total; return {
      key: r.key,
      label: period === 'monthly' ? String(parse(r.key).getDate()) : MONTHS[Number(r.key.slice(5)) - 1].slice(0, 3),
      ...Object.fromEntries(SKUS.map(s => [s.sku, r.bySku[s.sku] || 0])), total: r.total, cumulative: run } })
  }, [period, trend, trendDays, rows])
  const mix = SKUS.map(s => ({ name: s.short, sku: s.sku, value: bySku[s.sku] || 0, color: s.color })).filter(x => x.value > 0)
  const peopleChart = people.slice(0, 10).map(p => ({ name: who(p.who), qty: p.qty }))

  const title = period === 'daily' ? `Daily Production — ${nice(day)}` : period === 'monthly' ? `Monthly Production — ${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}` : `Fiscal Year ${fyEndYear} Production — ${nice(fyFrom)} to ${nice(fyTo)}`
  const firstCol = period === 'daily' ? 'Logged (time · by · WO)' : period === 'monthly' ? 'Day' : 'Month'
  const shownRows = period === 'monthly' ? rows : rows

  function exportCsv() {
    const head = [firstCol, ...SKUS.map(s => `${s.short} (${s.sku})`), 'Total']
    const lines = [head, ...shownRows.map(r => [r.label, ...SKUS.map(s => String(r.bySku[s.sku] || 0)), String(r.total)]), ['Total', ...SKUS.map(s => String(bySku[s.sku] || 0)), String(total)]]
    const csv = lines.map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `Walmart_${period === 'daily' ? 'Daily_' + day : period === 'monthly' ? 'Monthly_' + month : 'FY' + fyEndYear}_Production.csv`; a.click()
  }
  function exportPdf() {
    const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' })
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(title, 36, 40)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110)
    doc.text(`beyondGREEN biotech · Walmart Production · ${fmt(total)} SRP from ${entries.length} logs · voided entries excluded · generated ${new Date().toLocaleString('en-US')}`, 36, 56); doc.setTextColor(0)
    const head = { fillColor: [0, 113, 206] as [number, number, number], textColor: 255, fontStyle: 'bold' as const, fontSize: 8 }
    autoTable(doc, { startY: 68, head: [[firstCol, ...SKUS.map(s => s.short), 'Total']], body: shownRows.map(r => [r.label, ...SKUS.map(s => r.bySku[s.sku] ? fmt(r.bySku[s.sku]) : ''), r.total ? fmt(r.total) : '']),
      foot: [['Total', ...SKUS.map(s => fmt(bySku[s.sku] || 0)), fmt(total)]], styles: { fontSize: 8, cellPadding: 3 }, headStyles: head, footStyles: { fillColor: [240, 242, 246], textColor: 20, fontStyle: 'bold', fontSize: 8 }, margin: { left: 36, right: 36 } })
    autoTable(doc, { startY: (doc as any).lastAutoTable.finalY + 16, head: [['Person', 'Logs', 'SRP', 'Days']], body: people.map(p => [p.who, fmt(p.logs), fmt(p.qty), fmt(p.days)]), styles: { fontSize: 8, cellPadding: 3 }, headStyles: head, margin: { left: 36, right: 36 }, tableWidth: 360 })
    doc.save(`Walmart_${period === 'daily' ? 'Daily_' + day : period === 'monthly' ? 'Monthly_' + month : 'FY' + fyEndYear}_Production.pdf`)
  }

  const step = (dir: number) => {
    if (period === 'daily') setDay(addDays(day, dir))
    else if (period === 'monthly') { const [y, m] = month.split('-').map(Number); const d = new Date(y, m - 1 + dir, 1); setMonth(ymd(d).slice(0, 7)) }
    else setFyEndYear(fyEndYear + dir)
  }
  const btn = 'h-9 px-3 rounded-lg border border-[#E4E6EE] bg-white text-sm font-semibold text-gray-600'
  const th = 'px-2 py-2 text-[11px] uppercase tracking-wide text-gray-400 font-semibold text-right whitespace-nowrap'
  const td = 'px-2 py-1.5 text-[13px] text-right border-t border-[#F0F2F6] whitespace-nowrap'

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-[#E4E6EE] p-4 flex flex-col lg:flex-row lg:items-center gap-3 lg:justify-between">
        <p className="text-sm font-semibold text-[#1A1D2E]">{period === 'daily' ? 'Pick a day' : period === 'monthly' ? 'Pick a month' : 'Pick a fiscal year'}</p>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => step(-1)} className={btn} aria-label="Previous">‹</button>
          {period === 'daily' && <input type="date" value={day} max={today} onChange={e => e.target.value && setDay(e.target.value)} className={btn} />}
          {period === 'monthly' && <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} className={btn} />}
          {period === 'fy' && <>
            <span className="h-9 px-3 rounded-lg border border-[#E4E6EE] bg-white text-sm font-semibold flex items-center">FY {fyEndYear}</span>
            <label className="text-xs text-gray-500 flex items-center gap-1">FY starts
              <select value={fyStart} onChange={e => setFyStart(Number(e.target.value))} className="h-9 rounded-lg border border-[#E4E6EE] bg-white text-sm px-2">{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
          </>}
          <button onClick={() => step(1)} className={btn} aria-label="Next">›</button>
          <button onClick={() => period === 'daily' ? setDay(today) : period === 'monthly' ? setMonth(today.slice(0, 7)) : setFyStart(fyStart)} className={btn}>Today</button>
          <button onClick={exportCsv} disabled={loading} className={btn}>⬇ CSV</button>
          <button onClick={exportPdf} disabled={loading} className={btn}>⬇ PDF</button>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-bold text-[#1A1D2E]">{title}</h2>
        <p className="text-xs text-gray-500">From the Walmart Production board logs · voided entries excluded{period === 'fy' ? ` · FY ${fyEndYear} runs ${nice(fyFrom)} – ${nice(fyTo)}` : ''}</p>
      </div>
      {err && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        <div className="rounded-xl bg-[#0071ce] text-white p-3"><p className="text-[11px] uppercase opacity-80">Total SRP</p><p className="text-2xl font-extrabold">{loading ? '…' : fmt(total)}</p><p className="text-[11px] opacity-80">{entries.length} logs</p></div>
        {SKUS.map(s => <div key={s.sku} className="rounded-xl bg-white border border-[#ECEEF3] p-3" style={{ borderTop: '4px solid ' + s.color }}>
          <p className="text-[11px] text-gray-500">{s.short}</p><p className="text-xl font-bold text-[#1A1D2E]">{loading ? '…' : fmt(bySku[s.sku] || 0)}</p><p className="font-mono text-[10px] text-gray-400">{s.sku}</p></div>)}
      </div>

      <div className="bg-white rounded-xl border border-[#E4E6EE] p-4">
        <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-2">
          {period === 'daily' ? 'Last 14 days by SKU · click a bar to open that day' : period === 'monthly' ? 'SRP made each day by SKU · line = running total' : 'SRP made each month by SKU · line = running total'}</p>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              onClick={(st: any) => { const k = st?.activePayload?.[0]?.payload?.key; if (period === 'daily' && k) setDay(k) }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F6" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={{ stroke: '#E4E6EE' }} />
              <YAxis yAxisId="l" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => fmt(v)} />
              {period !== 'daily' && <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => fmt(v)} />}
              <Tooltip formatter={(v: any, n: any) => [fmt(Number(v)), SKUS.find(s => s.sku === n)?.short || (n === 'cumulative' ? 'Running total' : n)]} labelFormatter={(l: any, pl: any) => { const k = pl?.[0]?.payload?.key; return k ? (period === 'fy' ? `${MONTHS[Number(String(k).slice(5)) - 1]} ${String(k).slice(0, 4)}` : nice(k)) : l }} />
              <Legend formatter={(v: any) => SKUS.find(s => s.sku === v)?.short || (v === 'cumulative' ? 'Running total' : v)} wrapperStyle={{ fontSize: 11 }} />
              {SKUS.map(sk => <Bar key={sk.sku} yAxisId="l" dataKey={sk.sku} stackId="a" fill={sk.color} cursor={period === 'daily' ? 'pointer' : undefined}>
                {period === 'daily' && chartData.map((d: any) => <Cell key={d.key} fillOpacity={d.key === day ? 1 : 0.45} />)}
              </Bar>)}
              {period !== 'daily' && <Line yAxisId="r" type="monotone" dataKey="cumulative" stroke="#1A1D2E" strokeWidth={2} dot={false} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-[#E4E6EE] p-4">
          <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-2">SKU mix {period === 'daily' ? 'for the day' : 'for the period'}</p>
          {mix.length === 0 ? <p className="py-16 text-center text-sm text-gray-400">No production.</p> : <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={mix} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={1}
                  label={(e: any) => `${e.name} ${total ? Math.round((e.value / total) * 100) : 0}%`} labelLine={false} style={{ fontSize: 10 }}>
                  {mix.map(m => <Cell key={m.sku} fill={m.color} />)}
                </Pie>
                <Tooltip formatter={(v: any) => fmt(Number(v)) + ' SRP'} />
              </PieChart>
            </ResponsiveContainer>
          </div>}
        </div>
        <div className="bg-white rounded-xl border border-[#E4E6EE] p-4">
          <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-2">SRP logged by person</p>
          {peopleChart.length === 0 ? <p className="py-16 text-center text-sm text-gray-400">No production.</p> : <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={peopleChart} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F6" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={(v: number) => fmt(v)} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#374151' }} width={90} />
                <Tooltip formatter={(v: any) => fmt(Number(v)) + ' SRP'} />
                <Bar dataKey="qty" fill="#0071ce" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-[#E4E6EE] overflow-x-auto">
        <table className="w-full">
          <thead className="bg-[#FAFBFD]"><tr><th className={th + ' text-left'}>{firstCol}</th>{SKUS.map(s => <th key={s.sku} className={th}>{s.short}</th>)}<th className={th}>Total</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={9} className="py-10 text-center text-sm text-gray-400">Loading…</td></tr>
              : shownRows.length === 0 ? <tr><td colSpan={9} className="py-10 text-center text-sm text-gray-400">No production logged {period === 'daily' ? 'on this day' : 'in this period'}.</td></tr>
              : shownRows.map(r => <tr key={r.key} className={r.total ? '' : 'text-gray-300'}>
                  <td className={td + ' text-left'}>{r.label}</td>
                  {SKUS.map(s => <td key={s.sku} className={td}>{r.bySku[s.sku] ? fmt(r.bySku[s.sku]) : '—'}</td>)}
                  <td className={td + ' font-bold'}>{r.total ? fmt(r.total) : '—'}</td></tr>)}
          </tbody>
          {!loading && shownRows.length > 0 && <tfoot><tr className="bg-[#F0F2F6] font-bold"><td className={td + ' text-left'}>Total</td>{SKUS.map(s => <td key={s.sku} className={td}>{fmt(bySku[s.sku] || 0)}</td>)}<td className={td}>{fmt(total)}</td></tr></tfoot>}
        </table>
      </div>

      <div className="bg-white rounded-xl border border-[#E4E6EE] overflow-x-auto max-w-xl">
        <table className="w-full"><thead className="bg-[#FAFBFD]"><tr><th className={th + ' text-left'}>Person</th><th className={th}>Logs</th><th className={th}>SRP</th><th className={th}>Days</th></tr></thead>
          <tbody>{people.length === 0 ? <tr><td colSpan={4} className="py-6 text-center text-sm text-gray-400">—</td></tr> : people.map(p => <tr key={p.who}><td className={td + ' text-left'}>{p.who}</td><td className={td}>{fmt(p.logs)}</td><td className={td + ' font-semibold'}>{fmt(p.qty)}</td><td className={td}>{fmt(p.days)}</td></tr>)}</tbody></table>
      </div>
    </div>
  )
}
