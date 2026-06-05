'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

interface Order {
  id: string
  customer_id: string | null
  customer_name: string | null
  order_date: string | null
  total_value: number | null
  status: string | null
}

interface Quotation {
  id: string
  customer_id: string | null
  quote_date: string | null
  total_value: number | null
  status: string | null
}

interface CustomerForecast {
  customer_id: string
  customer_name: string
  order_count: number
  avg_order_value: number
  avg_days_between: number | null
  last_order_date: string | null
  next_order_date: string | null
  annual_forecast: number
  confidence: number
}

interface MonthlyData {
  month: string
  revenue: number
  projected: boolean
}

const fmtMoney = (n: number) => {
  if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return '$' + (n / 1000).toFixed(0) + 'K'
  return '$' + n.toFixed(0)
}

const fmtMoneyFull = (n: number) => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

function buildForecast(orders: Order[]): { monthly: MonthlyData[]; customerForecasts: CustomerForecast[] } {
  const now = new Date()

  // Group by month
  const byMonth: Record<string, number> = {}
  for (const o of orders) {
    if (!o.order_date || !o.total_value) continue
    const key = o.order_date.slice(0, 7)
    byMonth[key] = (byMonth[key] ?? 0) + o.total_value
  }

  // Get last 6 historical months
  const historical: MonthlyData[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = d.toISOString().slice(0, 7)
    historical.push({
      month: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      revenue: byMonth[key] ?? 0,
      projected: false,
    })
  }

  // Average of non-zero months for projection
  const nonZero = historical.filter(m => m.revenue > 0)
  const avgMonthly = nonZero.length > 0 ? nonZero.reduce((s, m) => s + m.revenue, 0) / nonZero.length : 0

  // Project 6 months forward
  const projected: MonthlyData[] = []
  for (let i = 1; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const growth = 1 + (i * 0.02) // slight growth trend
    projected.push({
      month: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      revenue: Math.round(avgMonthly * growth),
      projected: true,
    })
  }

  // Group orders by customer
  const byCustomer: Record<string, Order[]> = {}
  for (const o of orders) {
    if (!o.customer_id) continue
    if (!byCustomer[o.customer_id]) byCustomer[o.customer_id] = []
    byCustomer[o.customer_id].push(o)
  }

  const customerForecasts: CustomerForecast[] = Object.entries(byCustomer).map(([custId, custOrders]) => {
    const sorted = [...custOrders].filter(o => o.order_date).sort((a, b) => a.order_date!.localeCompare(b.order_date!))
    const avgOrderValue = custOrders.reduce((s, o) => s + (o.total_value ?? 0), 0) / custOrders.length

    let avgDays: number | null = null
    if (sorted.length >= 2) {
      const gaps: number[] = []
      for (let i = 1; i < sorted.length; i++) {
        const a = new Date(sorted[i - 1].order_date!)
        const b = new Date(sorted[i].order_date!)
        gaps.push((b.getTime() - a.getTime()) / 86400000)
      }
      avgDays = gaps.reduce((s, g) => s + g, 0) / gaps.length
    }

    const lastOrderDate = sorted.length > 0 ? sorted[sorted.length - 1].order_date : null
    let nextOrderDate: string | null = null
    if (lastOrderDate && avgDays) {
      const d = new Date(lastOrderDate)
      d.setDate(d.getDate() + Math.round(avgDays))
      nextOrderDate = d.toISOString().slice(0, 10)
    }

    const annualForecast = avgDays && avgDays > 0 ? (365 / avgDays) * avgOrderValue : avgOrderValue * 12
    const confidence = Math.min(custOrders.length * 15, 90)

    return {
      customer_id: custId,
      customer_name: custOrders[0].customer_name ?? 'Unknown',
      order_count: custOrders.length,
      avg_order_value: avgOrderValue,
      avg_days_between: avgDays,
      last_order_date: lastOrderDate,
      next_order_date: nextOrderDate,
      annual_forecast: annualForecast,
      confidence,
    }
  }).sort((a, b) => b.annual_forecast - a.annual_forecast)

  return { monthly: [...historical, ...projected], customerForecasts }
}

export default function ForecastingPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [orders, setOrders] = useState<Order[]>([])
  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [ordRes, quoteRes] = await Promise.all([
        sb.from('sales_orders').select('id,customer_id,customer_name,order_date,total_value,status').neq('status', 'Cancelled').order('order_date', { ascending: true }),
        sb.from('quotations').select('id,customer_id,quote_date,total_value,status').eq('status', 'Draft').not('total_value', 'is', null),
      ])
      setOrders(ordRes.data ?? [])
      setQuotations(quoteRes.data ?? [])
    } catch (e: any) {
      setError(e.message)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, []) // eslint-disable-line

  const { monthly, customerForecasts } = useMemo(() => buildForecast(orders), [orders])

  const avgMonthly = monthly.filter(m => !m.projected && m.revenue > 0).reduce((s, m) => s + m.revenue, 0) / Math.max(monthly.filter(m => !m.projected && m.revenue > 0).length, 1)
  const annualForecast = avgMonthly * 12
  const pipelineValue = quotations.reduce((s, q) => s + (q.total_value ?? 0) * 0.70, 0)

  const summaryCards = [
    { label: 'Annual Forecast', value: fmtMoney(annualForecast), sub: 'Based on avg monthly revenue', color: 'text-[#00C896]' },
    { label: 'Pipeline Value', value: fmtMoney(pipelineValue), sub: '70% of open quotations', color: 'text-blue-400' },
    { label: 'Avg Monthly Revenue', value: fmtMoney(avgMonthly), sub: 'Last 6 months (non-zero)', color: 'text-violet-400' },
    { label: 'Active Customers', value: String(customerForecasts.length), sub: 'With at least 1 order', color: 'text-amber-400' },
  ]

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload?.length) {
      return (
        <div className="bg-[#1A1A20] border border-[#E4E6EE] rounded-xl px-4 py-3 text-sm">
          <p className="text-[#9898A8] text-xs mb-1">{label}</p>
          <p className="text-[#1A1D2E] font-semibold">{fmtMoneyFull(payload[0].value)}</p>
          {payload[0].payload.projected && <p className="text-[#5A5A6A] text-xs mt-0.5">Projected</p>}
        </div>
      )
    }
    return null
  }

  return (
    <div className="p-5 md:p-8 min-h-screen space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-violet-500/20 text-violet-300 border-violet-500/30">BUSINESS</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5 tracking-tight">Revenue Forecasting</h1>
          <p className="text-[#5A5A6A] text-sm mt-0.5">Historical trends and forward projections</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 bg-white border border-[#E4E6EE] text-[#9898A8] hover:text-[#1A1D2E] text-sm px-4 py-2.5 rounded-xl transition-all self-start">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          Refresh
        </button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-red-400 text-sm">{error}</div>}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {summaryCards.map(s => (
          <div key={s.label} className="bg-white border border-[#E4E6EE] rounded-2xl p-4">
            <p className={`text-2xl font-bold ${s.color}`}>{loading ? '—' : s.value}</p>
            <p className="text-[#1A1D2E] text-xs font-medium mt-1">{s.label}</p>
            <p className="text-[#5A5A6A] text-[11px] mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Revenue Chart */}
      <section className="bg-white border border-[#E4E6EE] rounded-2xl p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-[#1A1D2E] font-semibold">Revenue — Historical & Projected</h2>
          <div className="flex items-center gap-4 text-xs text-[#9898A8]">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-[#00C896] inline-block" /> Actual</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-[#00C896]/40 inline-block" /> Projected</span>
          </div>
        </div>
        {loading ? (
          <div className="flex items-center justify-center h-48"><svg className="w-5 h-5 animate-spin text-[#3A3A45]" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthly} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke="#2A2A35" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: '#5A5A6A', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#5A5A6A', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => fmtMoney(v)} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Bar dataKey="revenue" radius={[4, 4, 0, 0]}
                fill="#00C896"
                fillOpacity={1}
                label={false}
                // projected bars get lower opacity via CSS isn't possible, we handle via data
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>

      {/* Customer Forecasts */}
      <section>
        <h2 className="text-[#1A1D2E] font-semibold mb-3">Customer Forecasts</h2>
        <div className="bg-white border border-[#E4E6EE] rounded-2xl overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16"><svg className="w-5 h-5 animate-spin text-[#3A3A45]" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div>
          ) : customerForecasts.length === 0 ? (
            <div className="text-center py-16 text-[#5A5A6A] text-sm">No order data to build forecasts from</div>
          ) : (
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-[#E4E6EE]">
                  {['Customer','Orders','Avg Order Value','Avg Days Between','Last Order','Next Predicted','Annual Forecast','Confidence'].map(h => (
                    <th key={h} className="text-left text-xs font-medium text-[#5A5A6A] uppercase tracking-wider py-3 px-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {customerForecasts.map((c, i) => {
                  const confCls = c.confidence >= 60 ? 'text-[#00C896]' : c.confidence >= 30 ? 'text-amber-400' : 'text-[#5A5A6A]'
                  const nextPast = c.next_order_date && c.next_order_date < new Date().toISOString().slice(0, 10)
                  return (
                    <tr key={c.customer_id} className={`border-b border-[#E4E6EE]/60 last:border-0 ${i % 2 === 1 ? 'bg-white/30' : ''}`}>
                      <td className="px-4 py-3 text-[#1A1D2E] text-xs font-medium max-w-[160px] truncate">{c.customer_name}</td>
                      <td className="px-4 py-3 text-[#9898A8] text-xs">{c.order_count}</td>
                      <td className="px-4 py-3 text-[#1A1D2E] text-xs">{fmtMoneyFull(c.avg_order_value)}</td>
                      <td className="px-4 py-3 text-[#9898A8] text-xs">{c.avg_days_between != null ? `${Math.round(c.avg_days_between)}d` : '—'}</td>
                      <td className="px-4 py-3 text-[#9898A8] text-xs">{c.last_order_date ? new Date(c.last_order_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}</td>
                      <td className={`px-4 py-3 text-xs ${nextPast ? 'text-amber-400' : 'text-[#9898A8]'}`}>
                        {c.next_order_date ? new Date(c.next_order_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}
                        {nextPast && <span className="ml-1 text-[10px] text-amber-400">(overdue)</span>}
                      </td>
                      <td className="px-4 py-3 text-[#00C896] text-xs font-semibold">{fmtMoney(c.annual_forecast)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-16 bg-[#1E1E24] rounded-full h-1.5">
                            <div className="bg-[#00C896] h-1.5 rounded-full" style={{ width: `${c.confidence}%` }} />
                          </div>
                          <span className={`text-xs ${confCls}`}>{c.confidence}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Pipeline */}
      {quotations.length > 0 && (
        <section className="bg-white border border-[#E4E6EE] rounded-2xl p-6">
          <h2 className="text-[#1A1D2E] font-semibold mb-4">Open Pipeline ({quotations.length} quotes)</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <p className="text-[#5A5A6A] text-xs mb-1">Total Quote Value</p>
              <p className="text-[#1A1D2E] font-semibold">{fmtMoneyFull(quotations.reduce((s, q) => s + (q.total_value ?? 0), 0))}</p>
            </div>
            <div>
              <p className="text-[#5A5A6A] text-xs mb-1">Pipeline Value (70%)</p>
              <p className="text-[#00C896] font-semibold">{fmtMoneyFull(pipelineValue)}</p>
            </div>
            <div>
              <p className="text-[#5A5A6A] text-xs mb-1">Avg Quote Size</p>
              <p className="text-[#1A1D2E] font-semibold">{fmtMoneyFull(quotations.reduce((s, q) => s + (q.total_value ?? 0), 0) / quotations.length)}</p>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
