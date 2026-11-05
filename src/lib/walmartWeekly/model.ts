// Pure computation for the Walmart weekly report. No I/O here, so it can be unit-tested.
import { BySku, ForecastRow, PoRow, ProdDay, Results, SKUS, Settings, Sku, WeekRow, WeeklyInputs, zeroBySku } from './types'
import { ForecastBatch } from './data'
import { addDays, fiscalWeek, lastThursday, md, orderDateForAbs, parse, weekLabel, weekSpan, wk1Start } from './weeks'

export interface ModelInput {
  settings: Settings
  inputs: WeeklyInputs
  pos: PoRow[]
  production: { date: string; sku: Sku; srp: number }[]
  inventory: { asOf: string; unit: BySku; srp: BySku; fg: BySku }
  forecast: ForecastBatch | null
  prior: { report_date: string; results: any } | null
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const sumBy = (b: BySku) => sum(SKUS.map(k => b[k]))
const r0 = (n: number) => Math.round(n)

export function compute(m: ModelInput): Results {
  const { settings: S, inputs: I, pos } = m
  const reportDate = I.reportDate
  const cur = fiscalWeek(reportDate)
  const orderDate = lastThursday(reportDate)
  const orderWeek = fiscalWeek(orderDate).abs
  const fy = cur.fy
  const ytdStart = wk1Start(fy)

  // ---- weekly orders (fiscal YTD) ----
  const weekMap = new Map<number, WeekRow>()
  for (const p of pos) {
    if (p.orderDate < ytdStart || p.wkOrdered > orderWeek) continue
    const w = weekMap.get(p.wkOrdered) || { wk: p.wkOrdered, orderDate: p.orderDate, pos: 0, units: 0, shipped: 0, sku: zeroBySku(), reset: false, status: '' }
    w.orderDate = w.orderDate < p.orderDate ? w.orderDate : p.orderDate
    w.pos++; w.units += p.units; w.shipped += p.unitsShipped
    for (const k of SKUS) w.sku[k] += p.srp[k] * 6
    weekMap.set(p.wkOrdered, w)
  }
  const weeks = Array.from(weekMap.values()).sort((a, b) => a.wk - b.wk)
  for (const w of weeks) { w.reset = w.pos >= 40; w.status = w.shipped === w.units ? 'Shipped in full' : 'Shipping' }
  const ytdPos = pos.filter(p => p.orderDate >= ytdStart && p.wkOrdered <= orderWeek)
  let fullWeeks = 0
  for (const w of weeks) { if (w.shipped === w.units && w.units > 0) fullWeeks++; else break }
  const ytd = { ordered: sum(ytdPos.map(p => p.units)), shipped: sum(ytdPos.map(p => p.unitsShipped)), posShipped: ytdPos.filter(p => p.shipped).length, posOpen: ytdPos.filter(p => !p.shipped).length, fullWeeks }

  // ---- loads shipping now: all unshipped POs from the current order week and earlier ----
  const open = pos.filter(p => !p.shipped && p.wkOrdered <= orderWeek)
  const loadMap = new Map<string, Results['loads'][number]>()
  for (const p of open.sort((a, b) => (a.pickupDate || '9').localeCompare(b.pickupDate || '9') || a.po.localeCompare(b.po))) {
    const key = p.load || 'Not assigned'
    const g = loadMap.get(key) || { load: key, pos: 0, units: 0, pallets: 0 as number | null, pickup: p.pickupDate, mabdMin: p.mabd, mabdMax: p.mabd, wk: p.wkOrdered, status: '' }
    g.pos++; g.units += p.units
    g.pallets = (g.pallets ?? 0) + (p.pallets ?? 0)
    if (p.mabd) { g.mabdMin = !g.mabdMin || p.mabd < g.mabdMin ? p.mabd : g.mabdMin; g.mabdMax = !g.mabdMax || p.mabd > g.mabdMax ? p.mabd : g.mabdMax }
    const rer = /rerout/i.test(p.status || '') || /rerout/i.test(p.comment || '')
    g.status = rer ? 'Pending rerouting' : (p.pickupDate ? (p.wkOrdered < orderWeek ? 'Late scheduled' : 'Confirmed') : 'Schedule not received')
    if (rer) g.pickup = null
    loadMap.set(key, g)
  }
  const loads = Array.from(loadMap.values())

  // ---- pickup pushbacks: comments on POs from the last 4 order weeks ----
  const pbMap = new Map<number, Results['pushbacks'][number]>()
  for (const p of pos.filter(p => p.wkOrdered >= orderWeek - 3 && p.wkOrdered <= orderWeek && p.comment)) {
    const g = pbMap.get(p.wkOrdered) || { wk: p.wkOrdered, orderDate: p.orderDate, pos: 0, units: 0, what: '', picked: '', mabd: '', late: false }
    g.pos++; g.units += p.units
    const what = (p.comment || '').replace(/\s*;\s*/g, '; ')
    if (!g.what.includes(what)) g.what = g.what ? g.what + '; ' + what : what
    const pd = p.shipDate || p.pickupDate
    if (pd && !g.picked.includes(md(pd))) g.picked = g.picked ? g.picked + ', ' + md(pd) : md(pd)
    if (p.mabd) { const cur = g.mabd ? g.mabd.split('|') : []; cur.push(p.mabd); const u = Array.from(new Set(cur)).sort(); g.mabd = u.join('|') }
    if (p.mabd && pd && pd > p.mabd) g.late = true
    pbMap.set(p.wkOrdered, g)
  }
  const pushbacks = Array.from(pbMap.values()).sort((a, b) => a.wk - b.wk).map(g => { const u = g.mabd ? g.mabd.split('|') : []; return { ...g, mabd: u.length > 1 ? `${md(u[0])} to ${md(u[u.length - 1])}` : (u[0] ? md(u[0]) : '') } })

  // ---- this week's order vs forecast ----
  const thisPos = pos.filter(p => p.wkOrdered === orderWeek)
  const thisSku = zeroBySku(); for (const p of thisPos) for (const k of SKUS) thisSku[k] += p.srp[k] * 6
  const fcByDate = new Map<string, BySku>()
  if (m.forecast) for (const r of m.forecast.rows) { const b = fcByDate.get(r.order_date) || zeroBySku(); b[r.sku] += r.qty; fcByDate.set(r.order_date, b) }
  const fcThis = fcByDate.get(orderDate) || null
  const thisOrder = { pos: thisPos.length, units: sumBy(thisSku), sku: thisSku, forecast: fcThis, forecastTotal: fcThis ? sumBy(fcThis) : 0 }

  // ---- production ----
  const dayMap = new Map<string, ProdDay>()
  for (const e of m.production) { const d = dayMap.get(e.date) || { date: e.date, wk: fiscalWeek(e.date).abs, srp: zeroBySku(), tot: 0 }; d.srp[e.sku] += e.srp; d.tot += e.srp; dayMap.set(e.date, d) }
  const prodDays = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date))
  const prodWeeks: Results['prodWeeks'] = []
  for (const wk of [cur.abs - 2, cur.abs - 1, cur.abs]) {
    const ds = prodDays.filter(d => d.wk === wk)
    const ordered = weeks.find(w => w.wk === wk)?.units ?? null
    const start = addDays(wk1Start(2026), (wk - 1) * 7)
    prodWeeks.push({ wk, span: `${md(start)} to ${md(addDays(start, 6))}`, dates: ds.length ? `${md(ds[0].date)} to ${md(ds[ds.length - 1].date)}${wk === cur.abs ? ' (to date)' : ''} (${ds.length} day${ds.length === 1 ? '' : 's'})` : 'no entries', srp: sum(ds.map(d => d.tot)), days: ds.length, units: sum(ds.map(d => d.tot)) * 6, ordered: wk === cur.abs ? null : ordered })
  }
  const windowFrom = I.priorReportDate ? addDays(I.priorReportDate, 1) : addDays(reportDate, -7)
  const prodWin = zeroBySku()
  for (const d of prodDays) if (d.date >= windowFrom && d.date <= reportDate) for (const k of SKUS) prodWin[k] += d.srp[k] * 6
  const prodWindow = { from: windowFrom, to: reportDate, units: prodWin, total: sumBy(prodWin) }

  // ---- safety stock walk ----
  const opening: BySku = { ...zeroBySku(), ...(I.openingPosition || m.prior?.results?.position?.closing || {}) }
  const closing = zeroBySku(); for (const k of SKUS) closing[k] = opening[k] + prodWin[k] - thisSku[k]
  const position = { opening, production: prodWin, shipping: thisSku, closing, openingTotal: sumBy(opening), productionTotal: sumBy(prodWin), shippingTotal: sumBy(thisSku), closingTotal: sumBy(closing) }

  // ---- forecast rows: forecast + comp-store plans (by absolute week) + manual orders ----
  const plan = m.forecast?.plan || {}
  const manual = I.manualOrders || m.forecast?.manual || {}
  const nextOrder = addDays(orderDate, 7)
  const dateSet = new Set<string>(Array.from(fcByDate.keys()).filter(d => d >= orderDate))
  for (const sku of Object.keys(plan)) for (const absStr of Object.keys(plan[sku])) {
    const abs = Number(absStr); const d = orderDateForAbs(abs)
    if (d < orderDate) continue
    // a plan week with no forecast order date is folded into the previous order date (two-week orders)
    if (!dateSet.has(d) && dateSet.has(addDays(d, -7))) continue
    dateSet.add(d)
  }
  const dates = Array.from(dateSet).sort()
  const rows: ForecastRow[] = dates.map(d => {
    const abs = fiscalWeek(d).abs
    const base = fcByDate.get(d) || zeroBySku()
    const sku = { ...base }
    let isPlan = false
    for (const s of SKUS) {
      const p = plan[s]; if (!p) continue
      const nextD = addDays(d, 7); const coversTwo = !dateSet.has(nextD) && dates.some(x => x > nextD)
      const q = (p[String(abs)] ?? null)
      if (q !== null) { sku[s] = q + (coversTwo ? (p[String(abs + 1)] || 0) : 0); isPlan = true }
    }
    return { date: d, wk: abs, label: weekLabel(abs), sku, plan: isPlan, orig: fcByDate.get(d) || null }
  })
  // supply plan average: the next 8 order weeks starting with the next order (two-week rows count twice)
  const window: string[] = []; let wkCount = 0
  for (const r of rows) {
    if (r.date < nextOrder) continue
    if (wkCount >= 8) break
    window.push(r.date)
    const nextD = addDays(r.date, 7); wkCount += (!dateSet.has(nextD) && rows.some(x => x.date > nextD)) ? 2 : 1
  }
  const spAvg = zeroBySku()
  for (const k of SKUS) spAvg[k] = r0(sum(rows.filter(r => window.includes(r.date)).map(r => r.sku[k])) / Math.max(1, Math.min(8, wkCount)))
  const manualTotal = sum(Object.values(manual).map(o => sum(Object.values(o).map(v => Number(v) || 0))))
  const planTotal: Partial<BySku> = {}; for (const s of Object.keys(plan)) planTotal[s as Sku] = sum(Object.values(plan[s]))
  const forecast = { rows, manual, manualTotal, totalUnits: sum(rows.map(r => sumBy(r.sku))) + manualTotal, window, spAvg, spAvgTotal: sumBy(spAvg), runDate: m.forecast?.forecast_run_date || null, planTotal, batchName: m.forecast?.name || null }

  // ---- requirement and coverage ----
  const storesFor = (k: Sku) => S.stores[S.storeGroup[k]] ?? S.stores.base
  const requirement = SKUS.map(k => {
    const usw = S.usw[k]; const avgWeek = usw * S.stores.base; const req3 = avgWeek * 1.2 * 3
    const storesAfter = storesFor(k); const req3After = usw * storesAfter * 1.2 * 3
    return { sku: k, usw, storesNow: S.stores.base, avgWeek, req3, position: closing[k], vsReq: closing[k] - req3, weeksSupply: avgWeek ? closing[k] / avgWeek : null, spAvg: spAvg[k], req3Sp: spAvg[k] * 1.2 * 3, storesAfter, req3After, build: Math.max(0, req3After - closing[k]) }
  })
  const reqTot = { req3: sum(requirement.map(r => r.req3)), spAvg: sumBy(spAvg), req3Sp: sum(requirement.map(r => r.req3Sp)), req3After: sum(requirement.map(r => r.req3After)), build: sum(requirement.map(r => r.build)) }
  const avgTot = sum(requirement.map(r => r.avgWeek))
  const reqTotals = { ...reqTot, weeksSupply: avgTot ? position.closingTotal / avgTot : null, weeksSupplySp: reqTot.spAvg ? position.closingTotal / reqTot.spAvg : null }

  // ---- packaging ----
  const weeksToReset = Math.round((parse(S.resetDate).getTime() - parse(reportDate).getTime()) / (7 * 86400000))
  const unit = SKUS.map(k => {
    const onHand = m.inventory.unit[k], onOrder = S.unitPkgOnOrder[k] || 0, committed = onHand + onOrder, usage = spAvg[k]
    const w = usage ? committed / usage : null
    return { sku: k, onHand, onOrder, committed, usage, weeks: w, status: w === null ? '' : (w < weeksToReset ? 'Top-up' : 'Covered'), atReset: committed - usage * weeksToReset }
  })
  const srp = SKUS.map(k => {
    const onHand = m.inventory.srp[k], onOrder = S.srpOnOrder[k] || 0, usage = spAvg[k] / 6
    const w = usage ? onHand / usage : null, w2 = usage ? (onHand + onOrder) / usage : null
    return { sku: k, onHand, onOrder, usage, weeks: w, weeksWithOrder: w2, status: w === null ? '' : w < 1 ? 'Critical' : w < 4 ? 'Replenishing' : w < 8 ? 'Monitoring' : 'Covered' }
  })
  const packaging = { resetDate: S.resetDate, weeksToReset, asOf: m.inventory.asOf, unit, unitTotals: { onHand: sum(unit.map(u => u.onHand)), onOrder: sum(unit.map(u => u.onOrder)), committed: sum(unit.map(u => u.committed)), usage: sum(unit.map(u => u.usage)) }, srp, srpTotals: { onHand: sum(srp.map(s => s.onHand)), onOrder: sum(srp.map(s => s.onOrder)) } }

  return {
    reportDate, wmWeek: cur.wk, weekSpan: weekSpan(reportDate), orderWeek, orderDate,
    weeks, ytd, loads, pushbacks, thisOrder, prodDays, prodWeeks, prodWindow, position, requirement, reqTotals, forecast, packaging,
    pos: pos.filter(p => p.wkOrdered >= orderWeek - 4 && p.wkOrdered <= orderWeek),
  }
}
