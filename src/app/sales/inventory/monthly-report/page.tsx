'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Snap {
  snapshot_date: string; scope: string; sku: string; product_name: string | null
  category: string | null; on_hand_qty: number | null; unit_of_measure: string | null
  unit_cost: number | null; inventory_value: number | null; is_month_end: boolean
}
interface Alert {
  alert_date: string; scope: string; sku: string; product_name: string | null; category: string | null
  on_hand_qty: number | null; unit_of_measure: string | null; daily_velocity: number | null
  days_to_runout: number | null; reason: string; suggested_reorder_qty: number | null
}

const fmt$ = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
const fmtN = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n)

const REASON_LABEL: Record<string, string> = {
  forecast_runout: 'Projected run-out',
  below_reorder_point: 'Below reorder point',
  below_safety_stock: 'Below safety stock',
}
const SCOPE_LABEL: Record<string, string> = { product: 'Products', walmart: 'Walmart' }

export default function MonthlyInventoryReport() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [dates, setDates] = useState<string[]>([])
  const [monthEndOnly, setMonthEndOnly] = useState(false)
  const [selDate, setSelDate] = useState<string>('')
  const [snaps, setSnaps] = useState<Snap[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('All')

  // available snapshot dates
  useEffect(() => { (async () => {
    let query = sb.from('inventory_snapshots').select('snapshot_date,is_month_end').order('snapshot_date', { ascending: false })
    const { data } = await query
    const all = (data || []) as any[]
    const filtered = monthEndOnly ? all.filter(d => d.is_month_end) : all
    const uniq = Array.from(new Set(filtered.map(d => d.snapshot_date)))
    setDates(uniq)
    setSelDate(prev => (prev && uniq.includes(prev)) ? prev : (uniq[0] || ''))
  })() }, [sb, monthEndOnly])

  // load snapshot + alerts for selected date
  useEffect(() => { if (!selDate) return; (async () => {
    setLoading(true)
    const [{ data: sd }, { data: ad }] = await Promise.all([
      sb.from('inventory_snapshots').select('*').eq('snapshot_date', selDate).order('inventory_value', { ascending: false }),
      sb.from('inventory_alerts').select('*').eq('alert_date', selDate).order('days_to_runout', { ascending: true, nullsFirst: false }),
    ])
    setSnaps((sd || []) as Snap[])
    setAlerts((ad || []) as Alert[])
    setLoading(false)
  })() }, [sb, selDate])

  const categories = useMemo(() => ['All', ...Array.from(new Set(snaps.map(s => s.category || '—'))).sort()], [snaps])
  const filtered = useMemo(() => snaps.filter(s =>
    (cat === 'All' || (s.category || '—') === cat) &&
    (!q || s.sku?.toLowerCase().includes(q.toLowerCase()) || (s.product_name || '').toLowerCase().includes(q.toLowerCase()))
  ), [snaps, cat, q])

  const totalValue = useMemo(() => snaps.reduce((a, s) => a + (s.inventory_value || 0), 0), [snaps])
  const filteredValue = useMemo(() => filtered.reduce((a, s) => a + (s.inventory_value || 0), 0), [filtered])
  const runouts = alerts.filter(a => a.reason === 'forecast_runout').length

  const isME = snaps[0]?.is_month_end

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-[#1A1D2E]">Monthly Inventory Report &amp; Low-Stock Watch</h1>
          <p className="text-sm text-gray-500 mt-1">
            Levels, value, sales velocity and projected run-out across products and Walmart stock. Snapshots are captured daily; month-end sets are retained for review.
          </p>
        </div>
        <Link href="/sales/inventory" className="text-sm px-3 py-2 rounded-lg border border-[#E4E6EE] text-[#3B6FE0] hover:bg-[#F8FAFF]">← Inventory</Link>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <label className="text-sm text-gray-600">As of
          <select value={selDate} onChange={e => setSelDate(e.target.value)}
            className="ml-2 bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm">
            {dates.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className="text-sm text-gray-600 flex items-center gap-2">
          <input type="checkbox" checked={monthEndOnly} onChange={e => setMonthEndOnly(e.target.checked)} />
          Month-end snapshots only
        </label>
        {isME && <span className="text-[11px] font-semibold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">Month-end snapshot</span>}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Card label="SKUs tracked" value={snaps.length} color="#3B6FE0" />
        <Card label="Total inventory value" value={fmt$(totalValue)} color="#1D9E75" />
        <Card label="Low-stock alerts" value={alerts.length} color={alerts.length ? '#E2445C' : '#6B7280'} />
        <Card label="Projected run-outs" value={runouts} color={runouts ? '#F59E0B' : '#6B7280'} />
      </div>

      {/* Low-stock section */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-[#1A1D2E] mb-2">Low-stock &amp; reorder watch</h2>
        {loading ? <p className="text-sm text-gray-400">Loading…</p> : alerts.length === 0 ? (
          <p className="text-sm text-gray-500 bg-white border border-[#E4E6EE] rounded-xl p-4">No items below threshold for this date. 🎉</p>
        ) : (
          <div className="overflow-x-auto bg-white border border-[#E4E6EE] rounded-xl">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase text-gray-500 border-b border-[#EEF0F4]">
                  <th className="px-3 py-2">Scope</th><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right">On hand</th><th className="px-3 py-2 text-right">Sold/day</th>
                  <th className="px-3 py-2 text-right">Days left</th><th className="px-3 py-2">Reason</th>
                  <th className="px-3 py-2 text-right">Suggested reorder</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a, i) => {
                  const urgent = a.days_to_runout != null && a.days_to_runout <= 7
                  return (
                    <tr key={i} className="border-b border-[#F4F5F8] last:border-0 hover:bg-[#F8FAFF]">
                      <td className="px-3 py-2 text-gray-500">{SCOPE_LABEL[a.scope] || a.scope}</td>
                      <td className="px-3 py-2 font-medium">{a.sku}</td>
                      <td className="px-3 py-2 text-gray-600 max-w-[260px] truncate" title={a.product_name || ''}>{a.product_name}</td>
                      <td className="px-3 py-2 text-right">{fmtN(a.on_hand_qty)} <span className="text-gray-400 text-xs">{a.unit_of_measure}</span></td>
                      <td className="px-3 py-2 text-right">{a.daily_velocity != null ? fmtN(a.daily_velocity) : '—'}</td>
                      <td className={'px-3 py-2 text-right font-semibold ' + (urgent ? 'text-red-600' : 'text-amber-600')}>
                        {a.days_to_runout != null ? a.days_to_runout : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{REASON_LABEL[a.reason] || a.reason}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-medium">{a.suggested_reorder_qty != null ? fmtN(a.suggested_reorder_qty) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Full inventory */}
      <section>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-2">
          <h2 className="text-lg font-semibold text-[#1A1D2E]">Inventory levels</h2>
          <div className="flex items-center gap-2">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search SKU or name"
              className="bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm w-56" />
            <select value={cat} onChange={e => setCat(e.target.value)} className="bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm">
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <p className="text-xs text-gray-500 mb-2">{filtered.length} items · value {fmt$(filteredValue)}</p>
        <div className="overflow-x-auto bg-white border border-[#E4E6EE] rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase text-gray-500 border-b border-[#EEF0F4]">
                <th className="px-3 py-2">Scope</th><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">Category</th><th className="px-3 py-2 text-right">On hand</th>
                <th className="px-3 py-2 text-right">Unit cost</th><th className="px-3 py-2 text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => (
                <tr key={i} className="border-b border-[#F4F5F8] last:border-0 hover:bg-[#F8FAFF]">
                  <td className="px-3 py-2 text-gray-500">{SCOPE_LABEL[s.scope] || s.scope}</td>
                  <td className="px-3 py-2 font-medium">{s.sku}</td>
                  <td className="px-3 py-2 text-gray-600 max-w-[280px] truncate" title={s.product_name || ''}>{s.product_name}</td>
                  <td className="px-3 py-2 text-gray-500">{s.category || '—'}</td>
                  <td className="px-3 py-2 text-right">{fmtN(s.on_hand_qty)} <span className="text-gray-400 text-xs">{s.unit_of_measure}</span></td>
                  <td className="px-3 py-2 text-right">{fmt$(s.unit_cost)}</td>
                  <td className="px-3 py-2 text-right">{fmt$(s.inventory_value)}</td>
                </tr>
              ))}
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">No items match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function Card({ label, value, color }: { label: string; value: any; color: string }) {
  return (
    <div className="rounded-xl border border-[#E4E6EE] bg-white p-4" style={{ borderLeft: '4px solid ' + color }}>
      <div className="text-2xl font-bold leading-none" style={{ color }}>{value}</div>
      <div className="text-[11px] font-medium text-gray-500 mt-1.5">{label}</div>
    </div>
  )
}
