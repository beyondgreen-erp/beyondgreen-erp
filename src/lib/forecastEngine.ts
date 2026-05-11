/* eslint-disable @typescript-eslint/no-explicit-any */

export interface OrderRecord {
  id: string
  customer_id: string | null
  customer_name: string | null
  order_date: string | null
  total_value: number | null
}

export interface QuotationRecord {
  id: string
  customer_id: string | null
  total_value: number | null
}

export interface MonthlyRevenue {
  month: string        // "YYYY-MM"
  label: string        // "Jan '25"
  revenue: number
  projected: boolean
}

export interface CustomerForecast {
  customer_id: string
  customer_name: string
  order_count: number
  avg_order_value: number
  avg_days_between: number | null
  last_order_date: string | null
  next_order_date: string | null
  annual_forecast: number
  confidence: number   // 0–90
}

export interface ForecastResult {
  monthly: MonthlyRevenue[]
  customerForecasts: CustomerForecast[]
  annualForecast: number
  avgMonthlyRevenue: number
  pipelineValue: number
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

function isoMonth(d: Date): string {
  return d.toISOString().slice(0, 7)
}

export function buildForecast(orders: OrderRecord[], quotations: QuotationRecord[]): ForecastResult {
  const now = new Date()

  // ── Monthly historical buckets ──────────────────────────────────────────────
  const byMonth: Record<string, number> = {}
  for (const o of orders) {
    if (!o.order_date || !o.total_value) continue
    const key = o.order_date.slice(0, 7)
    byMonth[key] = (byMonth[key] ?? 0) + o.total_value
  }

  const historical: MonthlyRevenue[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = isoMonth(d)
    historical.push({ month: key, label: monthLabel(d), revenue: byMonth[key] ?? 0, projected: false })
  }

  const nonZero = historical.filter(m => m.revenue > 0)
  const avgMonthlyRevenue = nonZero.length > 0
    ? nonZero.reduce((s, m) => s + m.revenue, 0) / nonZero.length
    : 0

  const projected: MonthlyRevenue[] = []
  for (let i = 1; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    projected.push({
      month: isoMonth(d),
      label: monthLabel(d),
      revenue: Math.round(avgMonthlyRevenue * (1 + i * 0.02)),
      projected: true,
    })
  }

  const annualForecast = avgMonthlyRevenue * 12

  // ── Customer-level forecasts ────────────────────────────────────────────────
  const byCustomer: Record<string, OrderRecord[]> = {}
  for (const o of orders) {
    if (!o.customer_id) continue
    if (!byCustomer[o.customer_id]) byCustomer[o.customer_id] = []
    byCustomer[o.customer_id].push(o)
  }

  const customerForecasts: CustomerForecast[] = Object.entries(byCustomer).map(([custId, custOrders]) => {
    const sorted = [...custOrders]
      .filter(o => o.order_date)
      .sort((a, b) => a.order_date!.localeCompare(b.order_date!))

    const avg_order_value = custOrders.reduce((s, o) => s + (o.total_value ?? 0), 0) / custOrders.length

    let avg_days_between: number | null = null
    if (sorted.length >= 2) {
      const gaps: number[] = []
      for (let i = 1; i < sorted.length; i++) {
        const a = new Date(sorted[i - 1].order_date!)
        const b = new Date(sorted[i].order_date!)
        gaps.push((b.getTime() - a.getTime()) / 86400000)
      }
      avg_days_between = gaps.reduce((s, g) => s + g, 0) / gaps.length
    }

    const last_order_date = sorted.length > 0 ? sorted[sorted.length - 1].order_date : null

    let next_order_date: string | null = null
    if (last_order_date && avg_days_between) {
      const d = new Date(last_order_date)
      d.setDate(d.getDate() + Math.round(avg_days_between))
      next_order_date = d.toISOString().slice(0, 10)
    }

    const annual_forecast = avg_days_between && avg_days_between > 0
      ? (365 / avg_days_between) * avg_order_value
      : avg_order_value * 12

    const confidence = Math.min(custOrders.length * 15, 90)

    return {
      customer_id: custId,
      customer_name: custOrders[0].customer_name ?? 'Unknown',
      order_count: custOrders.length,
      avg_order_value,
      avg_days_between,
      last_order_date,
      next_order_date,
      annual_forecast,
      confidence,
    }
  }).sort((a, b) => b.annual_forecast - a.annual_forecast)

  // ── Pipeline value (70% of open quotes) ────────────────────────────────────
  const pipelineValue = quotations.reduce((s, q) => s + (q.total_value ?? 0) * 0.70, 0)

  return {
    monthly: [...historical, ...projected],
    customerForecasts,
    annualForecast,
    avgMonthlyRevenue,
    pipelineValue,
  }
}
