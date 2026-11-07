'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
/** Dashboard tile: today's profit pulse (shipped, margin, backlog, alerts) with a 30-day sparkline. Opens /analytics. */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ResponsiveContainer, ComposedChart, Bar, Line, Tooltip, XAxis } from 'recharts'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const n = (v: any) => Number(v) || 0
const usd = (v: any) => { const x = n(v); const a = Math.abs(x); const s = x < 0 ? '-' : ''; return a >= 1e6 ? `${s}$${(a / 1e6).toFixed(2)}M` : a >= 1e4 ? `${s}$${(a / 1e3).toFixed(1)}k` : `${s}$${Math.round(a).toLocaleString('en-US')}` }

export default function ProfitPulseWidget() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [d, setD] = useState<any>(null)
  useEffect(() => { sb.rpc('analytics_get', { p_refresh: false }).then(({ data }) => setD(data)) }, [sb])
  if (!d) return <div className="text-[12px] text-gray-400 p-3">Loading profit pulse…</div>
  const k = d.pulse?.kpi || {}
  const tgt = n(k.target_gm)
  const daily = (d.pulse?.daily || []).slice(-30).map((r: any) => ({ ...r, label: r.d.slice(5) }))
  const late = (d.flow?.late_open || []).length
  const lowCover = (d.plan?.cover || []).filter((r: any) => n(r.cover_days) < n(d.plan?.cover_min)).length
  const below = (d.leaks?.below_cost || []).length
  const alerts = [
    late && { t: `${late} orders past ship date`, href: '/analytics?tab=flow' },
    lowCover && { t: `${lowCover} SKUs low on stock`, href: '/analytics?tab=plan' },
    below && { t: `${below} lines below cost`, href: '/analytics?tab=leaks' },
  ].filter(Boolean) as { t: string; href: string }[]
  const Stat = ({ label, value, tone }: { label: string; value: string; tone?: string }) => (
    <div><p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">{label}</p><p className={`text-[17px] font-bold leading-tight ${tone || 'text-[#1A1D2E]'}`}>{value}</p></div>
  )
  return (
    <div data-money-hide className="h-full flex flex-col">
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        <Stat label="Shipped today" value={usd(k.today)} />
        <Stat label="Yesterday" value={usd(k.yesterday)} />
        <Stat label="Month to date" value={usd(k.mtd)} tone={n(k.mtd) >= n(k.last_mtd) ? 'text-[#00A84F]' : 'text-[#E2445C]'} />
        <Stat label="Margin 30 d" value={k.gm30 == null ? '—' : `${n(k.gm30).toFixed(1)}%`} tone={n(k.gm30) >= tgt ? 'text-[#00A84F]' : 'text-[#E2445C]'} />
        <Stat label="Gross profit 30 d" value={usd(k.gm30_usd)} />
        <Stat label="Backlog" value={usd(k.backlog)} />
      </div>
      <div className="h-24 mt-2 flex-1 min-h-[80px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={daily} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <XAxis dataKey="label" hide />
            <Tooltip contentStyle={{ borderRadius: 10, fontSize: 11 }} formatter={(v: any, name: any) => [usd(v), name]} />
            <Bar dataKey="shipped" name="Shipped" fill="#579BFC" radius={[3, 3, 0, 0]} />
            <Line type="monotone" dataKey="gm" name="Gross profit" stroke="#00A84F" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        {alerts.map(a => <Link key={a.t} href={a.href} className="text-[11px] px-2 py-0.5 rounded-full bg-[#FDECEF] text-[#9B1C31] hover:underline">{a.t}</Link>)}
        <Link href="/analytics" className="ml-auto text-[11px] font-semibold text-[#0086C0] hover:underline">Open Analytics →</Link>
      </div>
    </div>
  )
}
