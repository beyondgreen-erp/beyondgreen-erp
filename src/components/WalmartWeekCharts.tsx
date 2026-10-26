'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
/** Charts for the Walmart Production board: this week's output by day, and the work order's target vs made. */
import { useMemo } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts'

interface Sku { sku: string; short: string; color: string }
interface Props { skus: readonly Sku[]; entries: { production_date: string; sku: string; qty: number; voided_at: string | null }[]; week: string; prog: { sku: string; target_qty: number; made_qty: number }[]; woCode?: string | null }
const pad = (n: number) => String(n).padStart(2, '0')
const fmt = (n: number) => (Number(n) || 0).toLocaleString('en-US')

export default function WalmartWeekCharts({ skus, entries, week, prog, woCode }: Props) {
  const days = useMemo(() => {
    const [y, m, d] = week.split('-').map(Number)
    return Array.from({ length: 7 }, (_, i) => { const dt = new Date(y, m - 1, d + i); return { key: `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`, label: dt.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' }) } })
  }, [week])
  const byDay = useMemo(() => days.map(d => {
    const row: any = { label: d.label }
    for (const s of skus) row[s.sku] = 0
    for (const e of entries) if (!e.voided_at && e.production_date === d.key) row[e.sku] = (row[e.sku] || 0) + Number(e.qty)
    return row
  }), [days, entries, skus])
  const weekTotal = byDay.reduce((t, r) => t + skus.reduce((a, s) => a + (r[s.sku] || 0), 0), 0)
  const progData = skus.map(s => { const p = prog.find(x => x.sku === s.sku); return { name: s.short, Target: Number(p?.target_qty) || 0, Made: Number(p?.made_qty) || 0, color: s.color } }).filter(r => r.Target || r.Made)
  const name = (v: any) => skus.find(s => s.sku === v)?.short || v

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
      <div className="bg-white rounded-2xl shadow-sm border border-[#ECEEF3] p-4">
        <div className="flex items-baseline justify-between mb-1">
          <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">This week by day</p>
          <a href="/production/reports?view=daily" className="text-[11px] font-semibold text-[#0071ce] hover:underline">{fmt(weekTotal)} SRP · reports →</a>
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byDay} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F6" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={{ stroke: '#E4E6EE' }} />
              <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => fmt(v)} />
              <Tooltip formatter={(v: any, n: any) => [fmt(Number(v)), name(n)]} />
              <Legend formatter={name} wrapperStyle={{ fontSize: 10 }} />
              {skus.map(s => <Bar key={s.sku} dataKey={s.sku} stackId="a" fill={s.color} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="bg-white rounded-2xl shadow-sm border border-[#ECEEF3] p-4">
        <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1">Target vs made{woCode ? ` · ${woCode}` : ''}</p>
        {progData.length === 0 ? <p className="py-20 text-center text-sm text-gray-400">No work order targets.</p> : <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={progData} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F6" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={{ stroke: '#E4E6EE' }} />
              <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => fmt(v)} />
              <Tooltip formatter={(v: any, n: any) => [fmt(Number(v)) + ' SRP', n]} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="Target" fill="#D7DCE6" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Made" fill="#0071ce" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>}
      </div>
    </div>
  )
}
