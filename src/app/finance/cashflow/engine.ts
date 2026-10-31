/* eslint-disable @typescript-eslint/no-explicit-any */
// Cash flow + liability payoff engine (pure functions, runs in the browser).

export interface Liability {
  id: string; kind: string; name: string; account_code: string | null; balance: number; original_balance: number | null
  aging: { current?: number; d1_30?: number; d31_60?: number; d61_90?: number; d90p?: number } | null
  apr: number; min_payment: number | null; min_frequency: string | null; due_date: string | null; priority: number | null; critical: boolean
  negotiated_amount: number | null; contact: string | null; notes: string | null; status: string; source: string | null; as_of: string | null; updated_at?: string; updated_by?: string | null
}
export interface Expense { id: string; name: string; category: string | null; amount: number; frequency: string; day_of_month: number | null; active: boolean; notes: string | null }
export interface Income { id: string; name: string; category: string | null; amount: number; frequency: string; expected_date: string | null; probability: number; active: boolean; notes: string | null }
export interface Erp {
  ar: { id: string; number: string; customer: string; due: string | null; issued: string | null; open: number; status: string }[]
  pipeline: { id: string; number: string; name: string; status: string; ship: string | null; value: number; terms: string | null }[]
  walmart: { id: string; po: string; group: string; ship: string | null; value: number }[]
  collected180: number
}
export interface Settings { cash_on_hand: number; cash_as_of: string; min_reserve: number; weekly_budget: number; quarterly_goal: number; strategy: string; collect_rate: number; collect_lag_days: number }

export const n = (v: any) => Number(v) || 0
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const parse = (s: string) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d) }
export const addDays = (d: Date, k: number) => { const x = new Date(d); x.setDate(x.getDate() + k); return x }
export const monday = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x }
export const money = (v: any, dp = 0) => (n(v) < 0 ? '-$' : '$') + Math.abs(n(v)).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
export const short$ = (v: any) => { const a = Math.abs(n(v)); const s = a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'K' : a.toFixed(0); return (n(v) < 0 ? '-$' : '$') + s }
export const fmtDate = (d: Date | string | null) => { if (!d) return '—'; const x = typeof d === 'string' ? parse(d) : d; return x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
export const quarterOf = (d: Date) => `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`

const PER_YEAR: Record<string, number> = { weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, annual: 1, yearly: 1 }
export const weeklyOf = (amount: number, freq: string) => freq === 'once' ? 0 : n(amount) * (PER_YEAR[freq] ?? 12) / 52

export const kindLabel: Record<string, string> = { ap: 'Vendor (AP)', loan: 'Loan', credit_card: 'Credit card', other: 'Other' }
export const isOpen = (l: Liability) => l.status !== 'paid' && n(l.balance) > 0.5
export const target = (l: Liability) => (n(l.negotiated_amount) > 0 && n(l.negotiated_amount) < n(l.balance)) ? n(l.negotiated_amount) : n(l.balance)
export const over90 = (l: Liability) => n(l.aging?.d90p)
const termsDays = (t: string | null) => { const m = String(t || '').match(/(\d{1,3})/); return m ? Number(m[1]) : 30 }

/** How many weeks to clear one balance at a fixed weekly amount (with weekly interest). */
export function payoffWeeks(balance: number, apr: number, perWeek: number) {
  let b = n(balance); const r = n(apr) / 100 / 52
  if (b <= 0) return { weeks: 0, interest: 0, never: false }
  if (perWeek <= 0 || perWeek <= b * r) return { weeks: Infinity, interest: Infinity, never: true }
  let w = 0, interest = 0
  while (b > 0.005 && w < 5200) { const i = b * r; interest += i; b = b + i - perWeek; w++ }
  return { weeks: w, interest, never: false }
}

/** Order the plan pays balances in. */
export function rankLiabilities(list: Liability[], strategy: string) {
  const open = list.filter(isOpen)
  const pri = (l: Liability) => (l.priority != null ? l.priority : 999)
  const cmp: Record<string, (a: Liability, b: Liability) => number> = {
    // critical suppliers, then agreed settlements, then interest-bearing, then the oldest vendor bills, loans last
    smart: (a, b) => (b.critical ? 1 : 0) - (a.critical ? 1 : 0)
      || ((n(b.negotiated_amount) > 0 ? 1 : 0) - (n(a.negotiated_amount) > 0 ? 1 : 0))
      || (n(b.apr) - n(a.apr))
      || ((a.kind === 'loan' ? 1 : 0) - (b.kind === 'loan' ? 1 : 0))
      || (over90(b) / Math.max(1, n(b.balance)) - over90(a) / Math.max(1, n(a.balance)))
      || (target(a) - target(b)),
    avalanche: (a, b) => (n(b.apr) - n(a.apr)) || (target(a) - target(b)),
    snowball: (a, b) => target(a) - target(b),
    aging: (a, b) => (over90(b) - over90(a)) || (target(a) - target(b)),
    custom: () => 0,
  }
  const c = cmp[strategy] || cmp.smart
  return [...open].sort((a, b) => (pri(a) - pri(b)) || c(a, b))
}

export interface Week { start: Date; label: string; ar: number; pipeline: number; walmart: number; other: number; inflow: number; expenses: number; minimums: number; outflow: number; free: number; payoff: number; cash: number }

/** 13-week (or longer) forecast plus the weekly payoff the plan can afford. */
export function forecast(s: Settings, liabilities: Liability[], expenses: Expense[], income: Income[], erp: Erp, weeks = 13): Week[] {
  const start = monday(new Date())
  const rate = n(s.collect_rate) / 100, lag = n(s.collect_lag_days)
  const W: Week[] = Array.from({ length: weeks }, (_, i) => {
    const st = addDays(start, i * 7)
    return { start: st, label: st.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), ar: 0, pipeline: 0, walmart: 0, other: 0, inflow: 0, expenses: 0, minimums: 0, outflow: 0, free: 0, payoff: 0, cash: 0 }
  })
  const idx = (d: Date) => Math.floor((d.getTime() - start.getTime()) / (7 * 864e5))
  const put = (d: Date, key: 'ar' | 'pipeline' | 'walmart' | 'other', v: number) => { let i = idx(d); if (i < 0) i = 0; if (i < weeks) W[i][key] += v }
  for (const a of erp.ar) put(addDays(a.due ? parse(a.due) : addDays(new Date(), 14), lag), 'ar', a.open * rate)
  for (const o of erp.pipeline) put(addDays(o.ship ? parse(o.ship) : addDays(new Date(), 28), termsDays(o.terms) + lag), 'pipeline', o.value * rate)
  for (const o of erp.walmart) put(addDays(o.ship ? parse(o.ship) : addDays(new Date(), 21), 30 + lag), 'walmart', o.value * rate)
  for (const inc of income.filter(x => x.active)) {
    const p = n(inc.probability) / 100
    if (inc.frequency === 'once') { if (inc.expected_date) put(parse(inc.expected_date), 'other', n(inc.amount) * p); continue }
    const per = weeklyOf(inc.amount, inc.frequency) * p
    const from = inc.expected_date ? idx(parse(inc.expected_date)) : 0
    W.forEach((w, i) => { if (i >= from) w.other += per })
  }
  for (const e of expenses.filter(x => x.active)) {
    if (e.frequency === 'monthly' && e.day_of_month) {
      W.forEach(w => { for (let k = 0; k < 7; k++) { const d = addDays(w.start, k); if (d.getDate() === e.day_of_month) w.expenses += n(e.amount) } })
    } else if (e.frequency === 'once') { /* one-offs belong under income/expenses with a date — not modeled */ }
    else W.forEach(w => { w.expenses += weeklyOf(e.amount, e.frequency) })
  }
  const minWeekly = liabilities.filter(isOpen).reduce((t, l) => t + weeklyOf(n(l.min_payment), l.min_frequency || 'monthly'), 0)
  let cash = n(s.cash_on_hand)
  for (const w of W) {
    w.minimums = minWeekly
    w.inflow = w.ar + w.pipeline + w.walmart + w.other
    w.outflow = w.expenses + w.minimums
    w.free = w.inflow - w.outflow
    cash += w.free
    w.payoff = Math.max(0, Math.min(n(s.weekly_budget), cash - n(s.min_reserve)))
    cash -= w.payoff
    w.cash = cash
  }
  return W
}

export interface Plan {
  weeks: { start: Date; paid: { id: string; name: string; amount: number }[]; total: number; debt: number }[]
  payoff: Record<string, { week: number; date: Date | null; interest: number; paid: number }>
  debtFree: Date | null; totalInterest: number; savings: number
}

/** Week-by-week payoff: minimums on everything, the extra goes down the ranked list (settles at negotiated amounts). */
export function simulate(s: Settings, liabilities: Liability[], perWeek: (i: number) => number, maxWeeks = 520): Plan {
  const order = rankLiabilities(liabilities, s.strategy)
  const bal: Record<string, number> = {}; const tgt: Record<string, number> = {}
  for (const l of order) { bal[l.id] = n(l.balance); tgt[l.id] = target(l) }
  const res: Plan = { weeks: [], payoff: {}, debtFree: null, totalInterest: 0, savings: 0 }
  for (const l of order) res.payoff[l.id] = { week: -1, date: null, interest: 0, paid: 0 }
  const start = monday(new Date())
  const settled = new Set<string>()
  for (let w = 0; w < maxWeeks; w++) {
    const live = order.filter(l => bal[l.id] > 0.005)
    if (!live.length) { res.debtFree = addDays(start, w * 7); break }
    const paid: { id: string; name: string; amount: number }[] = []
    const pay = (l: Liability, amt: number) => {
      if (amt <= 0) return 0
      // a negotiated settlement: paying the agreed amount clears the whole balance
      const need = settled.has(l.id) ? bal[l.id] : Math.min(bal[l.id], tgt[l.id])
      const a = Math.min(amt, need)
      if (a <= 0) return 0
      bal[l.id] -= a; tgt[l.id] -= a; res.payoff[l.id].paid += a
      if (tgt[l.id] <= 0.005 && bal[l.id] > 0.005) { res.savings += bal[l.id]; bal[l.id] = 0 }
      const x = paid.find(p => p.id === l.id); if (x) x.amount += a; else paid.push({ id: l.id, name: l.name, amount: a })
      return a
    }
    for (const l of live) { const i = bal[l.id] * n(l.apr) / 100 / 52; bal[l.id] += i; tgt[l.id] += i; res.payoff[l.id].interest += i; res.totalInterest += i }
    for (const l of live) pay(l, weeklyOf(n(l.min_payment), l.min_frequency || 'monthly'))
    let pool = perWeek(w)
    for (const l of order) { if (pool <= 0.005) break; if (bal[l.id] > 0.005) pool -= pay(l, pool) }
    for (const l of order) if (bal[l.id] <= 0.005 && res.payoff[l.id].week < 0) { res.payoff[l.id].week = w; res.payoff[l.id].date = addDays(start, w * 7) }
    res.weeks.push({ start: addDays(start, w * 7), paid, total: paid.reduce((t, p) => t + p.amount, 0), debt: order.reduce((t, l) => t + Math.max(0, bal[l.id]), 0) })
  }
  return res
}
