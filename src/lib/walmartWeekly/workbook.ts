/* eslint-disable @typescript-eslint/no-explicit-any */
// Builds the supporting workbook (Dashboard, Weekly Orders, Safety Stock, Forecast,
// Production, Order vs Ship, Packaging) with SheetJS. Values, not formulas, so every
// viewer (phone previews included) shows the numbers.
import * as XLSX from 'xlsx'
import { Results, SKUS, SKU_DESC, SKU_NAME, Settings, WM_ITEM } from './types'
import { longDate, md, mdy } from './weeks'

type Row = any[]
const wkLbl = (abs: number) => abs > 52 ? `FY27 WK ${abs - 52}` : `WK ${abs}`
const dateCell = (s: string | null | undefined) => s ? new Date(s + 'T00:00:00Z') : null

function sheet(rows: Row[], widths: number[]) {
  const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true })
  ws['!cols'] = widths.map(w => ({ wch: w }))
  // number formats
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
  for (let r = range.s.r; r <= range.e.r; r++) for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (!cell) continue
    if (cell.t === 'n') cell.z = Number.isInteger(cell.v) ? '#,##0' : '#,##0.0'
    if (cell.t === 'd') cell.z = 'm/d/yyyy'
  }
  return ws
}

export function buildWorkbook(R: Results, S: Settings): Buffer {
  const wb = XLSX.utils.book_new()
  const ow = R.orderWeek > 52 ? R.orderWeek - 52 : R.orderWeek

  // ---- Dashboard ----
  const d: Row[] = [
    ['beyondGREEN, Walmart Weekly Report'],
    [`Report date ${longDate(R.reportDate)}  |  Current Walmart week: WK ${R.wmWeek} (${R.weekSpan})  |  All quantities in units unless marked SRP  |  Prepared by Rudy Patel`],
    [],
    [`Shipping this week: WM WK ${ow} orders, placed ${md(R.orderDate)}${R.loads.some(l => l.wk < R.orderWeek) ? ', plus open POs from earlier weeks' : ''}`],
    ['Load #', 'Purchase orders', 'Units', 'Pallets', 'Scheduled pickup', 'MABD range', 'Status'],
    ...R.loads.map(l => [l.load, l.pos, l.units, l.pallets || null, l.pickup ? dateCell(l.pickup) : (l.status === 'Pending rerouting' ? 'Pending rerouting' : 'Not scheduled'), l.mabdMin ? `${md(l.mabdMin)} to ${md(l.mabdMax)}` : '', `WK ${l.wk > 52 ? l.wk - 52 : l.wk}, ${l.status.toLowerCase()}`]),
    ['TOTAL', R.loads.reduce((a, l) => a + l.pos, 0), R.loads.reduce((a, l) => a + l.units, 0), R.loads.reduce((a, l) => a + (l.pallets || 0), 0)],
    [],
  ]
  if (R.pushbacks.length) {
    d.push(['Pickup pushbacks from Walmart Transportation (from the Ordered vs Ship comments)'], ['Order week', 'POs', 'Units', 'What happened', 'Picked up', 'MABD', 'Vs MABD'])
    for (const p of R.pushbacks) d.push([`WK ${p.wk > 52 ? p.wk - 52 : p.wk} (${md(p.orderDate)})`, p.pos, p.units, p.what, p.picked, p.mabd, p.late ? 'Past MABD' : 'Ahead'])
    d.push([])
  }
  d.push([`Service performance, ${R.reportDate.slice(0, 4)} year to date (WK 1 to WK ${ow})`], ['Units ordered YTD', 'Units shipped to date', 'Fill rate on shipped POs', 'POs shipped', 'POs open', 'Full weeks at 100%'],
    [R.ytd.ordered, R.ytd.shipped, 1, R.ytd.posShipped, R.ytd.posOpen, R.ytd.fullWeeks], [])
  d.push([`Safety stock: position after the WK ${ow} orders ship`], ['', `Opening (after WK ${ow - 1})`, `+ Production ${md(R.prodWindow.from)} to ${md(R.prodWindow.to)}`, `- Shipping WK ${ow} POs`, `Position after WK ${ow}`, `3-week req. (${S.stores.base} stores)`, 'Weeks of supply', '3-week req. after increases', 'Build to target'],
    ['All 7 items', R.position.openingTotal, R.position.productionTotal, R.position.shippingTotal, R.position.closingTotal, Math.round(R.reqTotals.req3), R.reqTotals.weeksSupply ?? '', Math.round(R.reqTotals.req3After), Math.round(R.reqTotals.build)],
    [`Same position in SRP: opening ${Math.round(R.position.openingTotal / 6).toLocaleString()}, produced ${Math.round(R.position.productionTotal / 6).toLocaleString()}, shipping ${Math.round(R.position.shippingTotal / 6).toLocaleString()}, position ${Math.round(R.position.closingTotal / 6).toLocaleString()}.`], [])
  d.push(['Production (ERP Walmart production board)'], ['WM WK', 'Week', 'Dates logged', 'SRP produced', 'SRP per day', 'Units produced', 'Units ordered', 'Produced vs ordered'])
  for (const w of R.prodWeeks) d.push([w.wk > 52 ? w.wk - 52 : w.wk, w.span, w.dates, w.srp, w.days ? Math.round(w.srp / w.days) : 0, w.units, w.ordered ?? 'order not placed yet', w.ordered !== null ? w.units - w.ordered : 'partial week'])
  d.push([])
  const comp = R.requirement.filter(r => r.storesAfter !== r.storesNow)
  if (comp.length) {
    d.push([`Readiness for the ${comp.map(c => SKU_NAME[c.sku]).join(' and ')} store increases`], ['Item', 'Store count', `Position after WK ${ow}`, '3-week req. at that count', 'Build to target', 'Supply plan avg / week', 'Expected manual order'])
    for (const c of comp) d.push([SKU_NAME[c.sku], c.storesAfter, c.position, Math.round(c.req3After), Math.round(c.build), c.spAvg, Object.values(R.forecast.manual).reduce((a, o) => a + (Number(o[c.sku]) || 0), 0) || null])
    d.push(['All 7 items', '', R.position.closingTotal, Math.round(R.reqTotals.req3After), Math.round(R.reqTotals.build), R.forecast.spAvgTotal, R.forecast.manualTotal || null])
  }
  XLSX.utils.book_append_sheet(wb, sheet(d, [26, 16, 16, 14, 18, 18, 46, 18, 14]), 'Dashboard')

  // ---- Weekly Orders ----
  const wo: Row[] = [[`Walmart Weekly Orders, ${R.reportDate.slice(0, 4)}`], ['Units ordered by item, by Walmart week (Sunday to Saturday). Source: ERP Walmart board plus the WM Ordered vs Ship history. 1 SRP = 6 units.'], [],
    ['WM WK', 'Order date', 'POs', ...SKUS.map(k => SKU_NAME[k]), 'Units ordered', 'Units shipped', 'Fill %', 'Modular reset', 'Status']]
  for (const w of R.weeks) wo.push([w.wk > 52 ? w.wk - 52 : w.wk, dateCell(w.orderDate), w.pos, ...SKUS.map(k => w.sku[k]), w.units, w.shipped, w.units ? w.shipped / w.units : '', w.reset ? 'YES' : '', w.status])
  wo.push(['TOTAL', '', R.weeks.reduce((a, w) => a + w.pos, 0), ...SKUS.map(k => R.weeks.reduce((a, w) => a + w.sku[k], 0)), R.ytd.ordered, R.ytd.shipped, R.ytd.ordered ? R.ytd.shipped / R.ytd.ordered : ''])
  const wos = sheet(wo, [8, 12, 7, 11, 11, 11, 11, 11, 11, 11, 13, 13, 9, 12, 16])
  for (let r = 4; r < wo.length; r++) { const c = wos[XLSX.utils.encode_cell({ r, c: 12 })]; if (c && c.t === 'n') c.z = '0.0%' }
  XLSX.utils.book_append_sheet(wb, wos, 'Weekly Orders')

  // ---- Safety Stock ----
  const ss: Row[] = [[`Safety Stock Position, WM WK ${R.wmWeek}`], ['All figures in units. The floor reports SRP; 1 SRP = 6 units. The position rolls forward from the prior report: opening position + production (ERP board) less the full order for the week.'], [],
    ['1.  Position walk'], ['SKU', 'WM item #', 'Description', `Opening (after WK ${ow - 1} POs)`, `+ Production ${md(R.prodWindow.from)} to ${md(R.prodWindow.to)}`, `- Shipping WK ${ow} POs (${md(R.orderDate)})`, `Position after WK ${ow} ships`, 'Position in SRP', 'Opening SRP', 'Production SRP', 'Shipping SRP']]
  for (const k of SKUS) ss.push([k, WM_ITEM[k], SKU_DESC[k], R.position.opening[k], R.position.production[k], R.position.shipping[k], R.position.closing[k], Math.round(R.position.closing[k] / 6), Math.round(R.position.opening[k] / 6), Math.round(R.position.production[k] / 6), Math.round(R.position.shipping[k] / 6)])
  ss.push(['TOTAL', '', 'All 7 Walmart items', R.position.openingTotal, R.position.productionTotal, R.position.shippingTotal, R.position.closingTotal, Math.round(R.position.closingTotal / 6), Math.round(R.position.openingTotal / 6), Math.round(R.position.productionTotal / 6), Math.round(R.position.shippingTotal / 6)], [])
  ss.push(['2.  Requirement and coverage', '', '', `USW x store count x 1.20 buffer x 3 weeks. Supply plan columns use ${R.forecast.batchName || 'the current forecast'}, 8 order weeks from ${R.forecast.window[0] ? md(R.forecast.window[0]) : ''} (manual orders excluded).`], [],
    ['Store count', S.stores.base, 'Comp 48CT stores', S.stores.comp48, 'Comp 24CT stores', S.stores.comp24], [],
    ['SKU', 'Description', 'USW', 'Store count', 'Average units per week', '+20% buffer', '3-week req.', '% split', `Position after WK ${ow}`, 'Position vs 3-week req.', 'Weeks of supply', 'Coverage', 'Supply plan avg / week', '3-week req. at supply plan', 'Store count after increase', '3-week req. after increase', 'Build to that target'])
  for (const r of R.requirement) ss.push([r.sku, SKU_DESC[r.sku], r.usw, r.storesNow, Math.round(r.avgWeek), Math.round(r.avgWeek * 1.2), Math.round(r.req3), R.reqTotals.req3 ? r.req3 / R.reqTotals.req3 : 0, r.position, Math.round(r.vsReq), r.weeksSupply === null ? '' : Math.round(r.weeksSupply * 10) / 10, r.vsReq >= 0 ? 'Covered' : 'Building', r.spAvg, Math.round(r.req3Sp), r.storesAfter, Math.round(r.req3After), Math.round(r.build)])
  ss.push(['TOTAL', 'All 7 Walmart items', '', S.stores.base, Math.round(R.requirement.reduce((a, r) => a + r.avgWeek, 0)), '', Math.round(R.reqTotals.req3), 1, R.position.closingTotal, Math.round(R.position.closingTotal - R.reqTotals.req3), R.reqTotals.weeksSupply === null ? '' : Math.round(R.reqTotals.weeksSupply * 10) / 10, '', R.reqTotals.spAvg, Math.round(R.reqTotals.req3Sp), '', Math.round(R.reqTotals.req3After), Math.round(R.reqTotals.build)])
  const sss = sheet(ss, [10, 12, 22, 12, 14, 14, 14, 10, 12, 12, 10, 11, 12, 12, 11, 12, 12])
  for (let r = 0; r < ss.length; r++) { const c = sss[XLSX.utils.encode_cell({ r, c: 7 })]; if (c && c.t === 'n' && r > 15) c.z = '0.0%' }
  XLSX.utils.book_append_sheet(wb, sss, 'Safety Stock')

  // ---- Forecast ----
  const fc: Row[] = [[`Walmart Order Forecast${R.forecast.runDate ? ', ' + md(R.forecast.runDate) + ' run' : ''}${Object.keys(R.forecast.planTotal).length ? ', with the comp-store supply plan on ' + Object.keys(R.forecast.planTotal).map(k => SKU_NAME[k as keyof typeof SKU_NAME]).join(' and ') : ''}`],
    ['Units by item, by order date. Green rows carry the comp-store supply plan on the items listed; a row covering two weeks holds both weeks. Manual orders are listed separately.'], [],
    ['Order date', 'WM WK', ...SKUS.map(k => SKU_NAME[k]), 'Total units', 'Total SRP', 'Plan row', ...Object.keys(R.forecast.planTotal).map(k => `${SKU_NAME[k as keyof typeof SKU_NAME]} per forecast`)]]
  for (const r of R.forecast.rows) fc.push([dateCell(r.date), r.label, ...SKUS.map(k => r.sku[k] || null), SKUS.reduce((a, k) => a + r.sku[k], 0), Math.round(SKUS.reduce((a, k) => a + r.sku[k], 0) / 6), r.plan ? 'plan' : '', ...Object.keys(R.forecast.planTotal).map(k => r.orig ? r.orig[k as keyof typeof r.orig] : null)])
  for (const [date, o] of Object.entries(R.forecast.manual)) fc.push([dateCell(date), 'manual order', ...SKUS.map(k => Number(o[k]) || null), SKUS.reduce((a, k) => a + (Number(o[k]) || 0), 0), Math.round(SKUS.reduce((a, k) => a + (Number(o[k]) || 0), 0) / 6), 'manual'])
  fc.push(['TOTAL', '', ...SKUS.map(k => R.forecast.rows.reduce((a, r) => a + r.sku[k], 0) + Object.values(R.forecast.manual).reduce((a, o) => a + (Number(o[k]) || 0), 0)), R.forecast.totalUnits, Math.round(R.forecast.totalUnits / 6)])
  XLSX.utils.book_append_sheet(wb, sheet(fc, [12, 14, 11, 11, 11, 11, 11, 11, 11, 12, 10, 9, 14, 14]), 'Forecast')

  // ---- Production ----
  const pr: Row[] = [[`Production, ${R.prodDays.length ? md(R.prodDays[0].date) + ' to ' + md(R.prodDays[R.prodDays.length - 1].date) : ''}`], ['Daily output from the Walmart production board in the ERP, in SRP. Units = SRP x 6. Walmart weeks run Sunday to Saturday.'], [],
    ['Date', 'Day', 'WM WK', ...SKUS.map(k => SKU_NAME[k]), 'SRP total', 'Units']]
  for (const p of R.prodDays) pr.push([dateCell(p.date), new Date(p.date + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }), p.wk > 52 ? p.wk - 52 : p.wk, ...SKUS.map(k => p.srp[k] || null), p.tot, p.tot * 6])
  pr.push(['TOTAL', '', '', ...SKUS.map(k => R.prodDays.reduce((a, p) => a + p.srp[k], 0)), R.prodDays.reduce((a, p) => a + p.tot, 0), R.prodDays.reduce((a, p) => a + p.tot, 0) * 6], [], ['Weekly summary'], ['WM WK', 'Week (Sun to Sat)', 'Dates logged', 'SRP produced', 'SRP per day', 'Units produced', 'Units ordered', 'Produced vs ordered'])
  for (const w of R.prodWeeks) pr.push([w.wk > 52 ? w.wk - 52 : w.wk, w.span, w.dates, w.srp, w.days ? Math.round(w.srp / w.days) : 0, w.units, w.ordered ?? 'order not placed yet', w.ordered !== null ? w.units - w.ordered : 'partial week'])
  XLSX.utils.book_append_sheet(wb, sheet(pr, [12, 6, 8, 10, 10, 10, 10, 10, 10, 10, 10, 10]), 'Production')

  // ---- Order vs Ship ----
  const ov: Row[] = [[`Order vs Ship, WM WK ${Math.max(1, ow - 4)} to WK ${ow} purchase orders`], ['One row per purchase order. Item columns are SRP; units = SRP x 6. Rows dated after the report date are scheduled pickups, not shipments.'], [],
    ['Fill status', 'PO #', 'Order date', 'MABD', 'Ship / pickup', 'WK ord', 'Load #', 'Pallets', 'Comment', ...SKUS.map(k => SKU_NAME[k]), 'SRP ordered', 'SRP shipped', 'Units ordered', 'Units shipped', 'Fill %']]
  for (const p of R.pos) {
    const srpTot = SKUS.reduce((a, k) => a + p.srp[k], 0)
    ov.push([p.shipped ? 'Shipped' : (p.status === 'Rerouting' ? 'Rerouting' : p.pickupDate ? 'Scheduled' : 'Not scheduled'), p.po, dateCell(p.orderDate), dateCell(p.mabd), dateCell(p.shipDate || p.pickupDate), p.wkOrdered > 52 ? p.wkOrdered - 52 : p.wkOrdered, p.load || 'Not assigned', p.pallets, p.comment, ...SKUS.map(k => p.srp[k] || null), srpTot, p.shipped ? srpTot : 0, p.units, p.unitsShipped, p.units ? p.unitsShipped / p.units : ''])
  }
  ov.push(['TOTAL', '', '', '', '', '', '', R.pos.reduce((a, p) => a + (p.pallets || 0), 0), '', ...SKUS.map(k => R.pos.reduce((a, p) => a + p.srp[k], 0)), R.pos.reduce((a, p) => a + SKUS.reduce((b, k) => b + p.srp[k], 0), 0), R.pos.reduce((a, p) => a + (p.shipped ? SKUS.reduce((b, k) => b + p.srp[k], 0) : 0), 0), R.pos.reduce((a, p) => a + p.units, 0), R.pos.reduce((a, p) => a + p.unitsShipped, 0)])
  const ovs = sheet(ov, [12, 13, 11, 11, 12, 7, 12, 8, 40, 9, 9, 9, 9, 9, 9, 9, 10, 10, 11, 11, 8])
  for (let r = 4; r < ov.length; r++) { const c = ovs[XLSX.utils.encode_cell({ r, c: 20 })]; if (c && c.t === 'n') c.z = '0.0%' }
  XLSX.utils.book_append_sheet(wb, ovs, 'Order vs Ship')

  // ---- Packaging ----
  const pk: Row[] = [[`Packaging Plan to the ${mdy(R.packaging.resetDate)} Reset`], [`ERP piece counts as of ${md(R.packaging.asOf)} plus committed on order, run against the supply plan usage and the FY28 WK 20 MOD reset.`], [],
    ['FY28 WK 20 MOD reset', dateCell(R.packaging.resetDate), 'Weeks remaining', R.packaging.weeksToReset], [],
    ['1.  Unit Packaging, position against the WK 20 reset'], ['SKU', 'Description', 'ERP part', 'On hand (pieces)', 'ERP as of', 'On order / committed', 'Total committed', 'Usage per week at supply plan', 'Weeks of cover', 'Weeks to reset', 'Status to reset', 'Position at reset']]
  for (const u of R.packaging.unit) pk.push([u.sku, SKU_DESC[u.sku], u.sku + '-P', u.onHand, md(R.packaging.asOf), u.onOrder, u.committed, u.usage, u.weeks === null ? '' : Math.round(u.weeks * 10) / 10, R.packaging.weeksToReset, u.status, Math.round(u.atReset)])
  pk.push(['TOTAL', '', '', R.packaging.unitTotals.onHand, '', R.packaging.unitTotals.onOrder, R.packaging.unitTotals.committed, R.packaging.unitTotals.usage], [])
  if (S.unitPkgNote) pk.push([S.unitPkgNote], [])
  pk.push(['2.  SRPs'], ['SKU', 'Description', 'ERP part', 'On hand (pieces)', 'ERP as of', `On order (${S.srpPoNote})`, 'Usage per week at supply plan', 'Weeks of cover (on hand)', 'Weeks of cover (with on order)', 'Status'])
  for (const s of R.packaging.srp) pk.push([s.sku, SKU_DESC[s.sku], s.sku + '-SI', s.onHand, md(R.packaging.asOf), s.onOrder, Math.round(s.usage), s.weeks === null ? '' : Math.round(s.weeks * 10) / 10, s.weeksWithOrder === null ? '' : Math.round(s.weeksWithOrder * 10) / 10, s.status])
  pk.push(['TOTAL', '', '', R.packaging.srpTotals.onHand, '', R.packaging.srpTotals.onOrder, Math.round(R.packaging.srp.reduce((a, s) => a + s.usage, 0))])
  XLSX.utils.book_append_sheet(wb, sheet(pk, [10, 22, 12, 14, 10, 14, 14, 16, 12, 10, 13, 14]), 'Packaging')

  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true }) as Buffer)
}
