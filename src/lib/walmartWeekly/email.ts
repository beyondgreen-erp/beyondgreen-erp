// Builds the bG Weekly Update email body (HTML) from the computed results plus the
// notes typed for the week. House rules: units (never SRP counts for Walmart volume),
// "SRPs" and "Unit Packaging" as the packaging terms, polite asks, no em dashes.
import { Results, SKUS, SKU_NAME, Settings, Sku, WeeklyInputs } from './types'
import { md, mdy } from './weeks'
import { SIGNATURE_HTML } from './signature'

const FS = 'font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: rgb(23, 32, 42);'
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const n = (x: number) => Math.round(x).toLocaleString('en-US')
const paren = (x: number) => x < 0 ? `(${n(-x)})` : n(x)
const pct = (x: number) => `${Math.round(x * 100)}%`
const p = (t: string) => `<p style="margin: 0 0 10px 0; line-height: 1.45; ${FS}">${t}</p>`
const h = (t: string) => `<p style="margin: 18px 0 6px 0; ${FS} font-size: 12pt; color: rgb(43, 168, 74);"><b>${t}</b></p>`
const ul = (items: string[]) => `<ul style="margin: 0 0 10px 22px; padding: 0;">${items.map(i => `<li style="margin: 0 0 4px 0; line-height: 1.45; ${FS}">${i}</li>`).join('')}</ul>`
const img = (c: string) => `<p style="margin: 6px 0 12px 0;"><img src="cid:${c}" width="640" style="width: 640px; max-width: 100%; height: auto; display: block; border: 1px solid rgb(221, 228, 223);"></p>`
function table(hdr: string[], rows: string[][], aligns?: string[], totalLast = false) {
  const al = aligns || ['left', ...hdr.slice(1).map(() => 'right')]
  const th = hdr.map((x, i) => `<th style="background: rgb(43, 168, 74); color: white; padding: 6px 10px; text-align: ${al[i]}; font-family: Calibri, Arial, sans-serif; font-size: 10pt; border: 1px solid rgb(221, 228, 223);">${x}</th>`).join('')
  const body = rows.map((r, i) => {
    const last = totalLast && i === rows.length - 1
    const bg = last ? 'rgb(227, 243, 232)' : i % 2 ? 'rgb(249, 250, 249)' : 'white'
    return '<tr>' + r.map((x, j) => `<td style="padding: 5px 10px; text-align: ${al[j]}; background: ${bg}; font-family: Calibri, Arial, sans-serif; font-size: 10pt; color: rgb(23, 32, 42); border: 1px solid rgb(221, 228, 223);${last ? ' font-weight: bold;' : ''}">${x}</td>`).join('') + '</tr>'
  }).join('')
  return `<table cellpadding="0" cellspacing="0" style="border-collapse: collapse; margin: 4px 0 12px 0;"><tr>${th}</tr>${body}</table>`
}
// Free text typed in the ERP: paragraphs on blank lines, single newlines kept as breaks.
const notes = (t?: string) => (t || '').trim() ? (t || '').trim().split(/\n\s*\n/).map(x => p(esc(x).replace(/\n/g, '<br>'))).join('') : ''
const wkn = (abs: number) => abs > 52 ? abs - 52 : abs
const noDash = (s: string) => s.replace(/—/g, ', ').replace(/–/g, ' to ')

export function subjectFor(R: Results) {
  const d = R.reportDate; return `bG Weekly Update WK ${R.wmWeek} ${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}.${d.slice(0, 4)}`
}

export function buildEmailHtml(R: Results, S: Settings, I: WeeklyInputs): string {
  const B: string[] = []
  const ow = wkn(R.orderWeek), N = I.notes || {}
  const comp = R.requirement.filter(r => r.storesAfter !== r.storesNow)
  const compNames = comp.map(c => SKU_NAME[c.sku])
  const joinList = (xs: string[]) => xs.length <= 1 ? (xs[0] || '') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]
  const compPhrase = joinList(compNames)
  const planSkus = SKUS.filter(k => R.forecast.planTotal[k])

  B.push(p(esc(S.greeting || 'Hi Cora,')))
  B.push(p(`Here is the beyondGREEN weekly update on the ${esc(S.programName)} for WM WK ${R.wmWeek}. It covers certifications, service, the pickups on the ${md(R.orderDate)} order, production, safety stock, the forecast${compPhrase ? ` with the store increases on ${compPhrase}` : ''}, packaging${N.meeting ? ', and next week’s meeting' : ''}. The supporting workbook is attached.`))

  // ---- certifications ----
  if (S.certifications.length || N.certifications) {
    B.push(h('Certification update'))
    if (S.certifications.length) B.push(ul(S.certifications.map(c => `<b>${esc(c.name)}:</b> ${esc(c.status)}.`)))
    B.push(notes(N.certifications) || p('We will pass along each result as it comes in.'))
  }

  // ---- service ----
  B.push(h(`Service performance, ${R.reportDate.slice(0, 4)} to date`))
  B.push(p(`Every Walmart purchase order shipped in ${R.reportDate.slice(0, 4)} has shipped complete, with no cuts and no short ships: ${n(R.ytd.shipped)} units across ${n(R.ytd.posShipped)} POs, and ${R.ytd.fullWeeks} consecutive full weeks at 100% fill (WK 1 through WK ${R.ytd.fullWeeks}).${R.ytd.posOpen ? ` ${R.ytd.posOpen} PO${R.ytd.posOpen === 1 ? ' is' : 's are'} open on the pickup side and listed below.` : ''}`))
  if (R.pushbacks.length) {
    B.push(p('Pickup activity on the last few orders, from our Ordered vs Ship log:'))
    B.push(table(['Order week', 'POs', 'Units', 'What happened', 'Picked up', 'MABD'], R.pushbacks.map(x => [`WK ${wkn(x.wk)} (${md(x.orderDate)})`, String(x.pos), n(x.units), esc(x.what), esc(x.picked) || 'open', esc(x.mabd) + (x.late ? ' (past MABD)' : '')]), ['left', 'right', 'right', 'left', 'left', 'left']))
  }
  B.push(table([`${R.reportDate.slice(0, 4)} year to date`, 'Units ordered', 'Units shipped to date', 'Fill rate on shipped POs', 'POs shipped', 'POs open', 'Full weeks at 100%'], [['All 7 items', n(R.ytd.ordered), n(R.ytd.shipped), '100.0%', n(R.ytd.posShipped), n(R.ytd.posOpen), String(R.ytd.fullWeeks)]]))
  B.push(img('c1'))

  // ---- shipping this week ----
  B.push(h(`Shipping this week, WM WK ${ow} orders`))
  const t = R.thisOrder
  let shipLine = `The ${md(R.orderDate)} order was ${t.pos} purchase order${t.pos === 1 ? '' : 's'} totaling ${n(t.units)} units`
  if (t.forecast && t.forecastTotal) {
    const over = t.units / t.forecastTotal - 1
    shipLine += `, ${Math.abs(over) < 0.005 ? 'in line with' : `${pct(Math.abs(over))} ${over >= 0 ? 'above' : 'below'}`} the ${n(t.forecastTotal)} units in the ${R.forecast.runDate ? md(R.forecast.runDate) + ' ' : ''}forecast for that week`
    const big = SKUS.filter(k => t.forecast![k] > 0).map(k => ({ k, d: Math.abs(t.sku[k] / t.forecast![k] - 1), u: t.sku[k] })).sort((a, b) => b.u - a.u).slice(0, 2)
    if (big.length) shipLine += `. ${big.map(x => `${SKU_NAME[x.k]} came in at ${n(x.u)} against ${n(t.forecast![x.k])}`).join(' and ')}`
  }
  B.push(p(shipLine + '.'))
  B.push(table(['Load', 'Purchase orders', 'Units', 'Pallets', 'Pickup', 'MABD range', 'Status'], [
    ...R.loads.map(l => [esc(l.load), String(l.pos), n(l.units), l.pallets ? String(l.pallets) : '', l.pickup ? md(l.pickup) : (l.status === 'Pending rerouting' ? 'Pending' : 'Not scheduled'), l.mabdMin ? (l.mabdMin === l.mabdMax ? md(l.mabdMin) : `${md(l.mabdMin)} to ${md(l.mabdMax)}`) : '', `WK ${wkn(l.wk)}, ${l.status.toLowerCase()}`]),
    ['Total open', String(R.loads.reduce((a, l) => a + l.pos, 0)), n(R.loads.reduce((a, l) => a + l.units, 0)), String(R.loads.reduce((a, l) => a + (l.pallets || 0), 0) || ''), '', '', ''],
  ], ['left', 'right', 'right', 'right', 'left', 'left', 'left'], true))
  B.push(notes(N.shipping))

  // ---- production ----
  B.push(h('Production'))
  const pwCur = R.prodWeeks[R.prodWeeks.length - 1], pwPrev = R.prodWeeks[R.prodWeeks.length - 2]
  B.push(p(`Production comes straight from the Walmart production board in our ERP. ${pwPrev ? `WK ${wkn(pwPrev.wk)} ran ${pwPrev.days} day${pwPrev.days === 1 ? '' : 's'} and produced ${n(pwPrev.units)} units${pwPrev.ordered !== null ? ` against ${n(pwPrev.ordered)} units ordered` : ''}. ` : ''}${pwCur ? `WK ${wkn(pwCur.wk)} is under way with ${n(pwCur.units)} units built${pwCur.days ? ` over ${pwCur.days} day${pwCur.days === 1 ? '' : 's'}` : ''}.` : ''}`))
  B.push(table(['Walmart week', 'Dates logged', 'Units produced', 'Units ordered'], R.prodWeeks.map(w => [`WK ${wkn(w.wk)}`, esc(w.dates), n(w.units), w.ordered !== null ? n(w.ordered) : 'placed next order day']), ['left', 'left', 'right', 'right']))
  B.push(notes(N.production))
  B.push(img('c2'))

  // ---- safety stock ----
  B.push(h('Safety stock position'))
  B.push(p(`Carrying last week’s position forward on the same rolling basis, after the full WK ${ow} order ships:`))
  B.push(table(['All 7 items', 'Units'], [[`Opening position, after WK ${ow - 1} POs`, n(R.position.openingTotal)], [`Add: production ${md(R.prodWindow.from)} to ${md(R.prodWindow.to)}`, n(R.position.productionTotal)], [`Less: WK ${ow} POs (placed ${md(R.orderDate)})`, `(${n(R.position.shippingTotal)})`], [`Position after WK ${ow} POs ship`, n(R.position.closingTotal)]], undefined, true))
  const neg = R.requirement.filter(r => r.position < 0)
  const ws = R.reqTotals.weeksSupply, wsp = R.reqTotals.weeksSupplySp
  B.push(p(`At the current ${S.stores.base} stores the three-week requirement is ${n(R.reqTotals.req3)} units, so the position is ${ws === null ? '' : ws.toFixed(1)} weeks of supply. Against the supply plan, which averages ${n(R.reqTotals.spAvg)} units a week over the next eight order weeks, the position is ${wsp === null ? '' : wsp.toFixed(1)} weeks.${neg.length ? ` ${neg.map(r => `${SKU_NAME[r.sku]} (${paren(r.position)})`).join(' and ')} ${neg.length === 1 ? 'is' : 'are'} negative on paper while production catches up ahead of the pickups.` : ''}${comp.length ? ` ${comp.map(c => `${SKU_NAME[c.sku]} is at ${n(c.position)}`).join(' and ')} going into the store increase.` : ''}`))
  B.push(img('c3'))

  // ---- forecast ----
  B.push(h(planSkus.length ? `Forecast: the ${planSkus.map(k => SKU_NAME[k]).join(' and ')} supply plan${R.forecast.manualTotal ? ' and the manual orders' : ''}` : 'Order forecast'))
  let fcLine = `We are working from the ${R.forecast.runDate ? md(R.forecast.runDate) + ' ' : ''}order forecast${R.forecast.batchName ? '' : ''}`
  if (planSkus.length) {
    const first = R.forecast.rows.find(r => r.plan)
    fcLine += ` with the comp-store supply plan applied to ${planSkus.map(k => SKU_NAME[k]).join(' and ')}${first ? ` from the ${md(first.date)} order` : ''}. ${planSkus.map(k => `${SKU_NAME[k]} runs ${n(R.forecast.planTotal[k] || 0)} units over the plan`).join(' and ')}.`
  } else fcLine += '.'
  if (R.forecast.manualTotal) {
    const mo = Object.entries(R.forecast.manual)
    fcLine += ` In addition to the regular weekly order, we understand ${mo.length === 1 ? 'a one-time manual order is' : 'one-time manual orders are'} expected on ${mo.map(([d, o]) => `${md(d)} (${SKUS.filter(k => Number(o[k])).map(k => `${SKU_NAME[k]} ${n(Number(o[k]))}`).join(', ')} units)`).join(' and ')}.`
  }
  fcLine += ` The supply plan now averages ${n(R.reqTotals.spAvg)} units a week over the next eight order weeks.`
  B.push(p(fcLine))
  const manualBySku = (k: Sku) => Object.values(R.forecast.manual).reduce((a, o) => a + (Number(o[k]) || 0), 0)
  B.push(table(['Item', 'Stores', `${md(R.orderDate)} order (units)`, 'Forecast for that week', 'Order as % of forecast', 'Supply plan, avg / week (next 8)', ...(R.forecast.manualTotal ? ['Manual order expected'] : [])], [
    ...SKUS.map(k => { const r = R.requirement.find(x => x.sku === k)!; const f = t.forecast?.[k] || 0; return [SKU_NAME[k], n(r.storesAfter), n(t.sku[k]), f ? n(f) : '', f ? pct(t.sku[k] / f) : '', n(r.spAvg), ...(R.forecast.manualTotal ? [manualBySku(k) ? n(manualBySku(k)) : ''] : [])] }),
    ['All 7 items', '', n(t.units), t.forecastTotal ? n(t.forecastTotal) : '', t.forecastTotal ? pct(t.units / t.forecastTotal) : '', n(R.reqTotals.spAvg), ...(R.forecast.manualTotal ? [n(R.forecast.manualTotal)] : [])],
  ], ['left', 'right', 'right', 'right', 'right', 'right', 'right'], true))
  B.push(img('c4'))
  B.push(notes(N.forecast))

  // ---- readiness ----
  if (comp.length) {
    B.push(h(`Readiness for the store increases on ${compPhrase}`))
    B.push(table(['Item', 'Store count', `Position after WK ${ow} ships`, 'Three-week requirement', 'Build to that target', 'Supply plan avg / week'], [
      ...comp.map(c => [SKU_NAME[c.sku], n(c.storesAfter), n(c.position), n(c.req3After), n(c.build), n(c.spAvg)]),
      ['All 7 items', '', n(R.position.closingTotal), n(R.reqTotals.req3After), n(R.reqTotals.build), n(R.reqTotals.spAvg)],
    ], ['left', 'right', 'right', 'right', 'right', 'right'], true))
    B.push(p(`Across all items the three-week requirement after the increases is ${n(R.reqTotals.req3After)} units against a position of ${n(R.position.closingTotal)}. We are building the production, SRP and Unit Packaging plan to this and will update you each week on how the position closes.`))
  }

  // ---- packaging ----
  B.push(h(`Packaging plan to the ${mdy(R.packaging.resetDate)} reset`))
  const topup = R.packaging.unit.filter(u => u.status === 'Top-up').map(u => SKU_NAME[u.sku])
  B.push(p(`<b>Unit Packaging.</b> ${n(R.packaging.unitTotals.committed)} pieces are committed (${n(R.packaging.unitTotals.onHand)} on hand per the ERP as of ${md(R.packaging.asOf)}${R.packaging.unitTotals.onOrder ? ` plus ${n(R.packaging.unitTotals.onOrder)} on order` : ''}), measured against ${R.packaging.weeksToReset} weeks to the ${mdy(R.packaging.resetDate)} reset.${topup.length ? ` At the supply plan rate, ${topup.length > 1 ? topup.slice(0, -1).join(', ') + ' and ' + topup[topup.length - 1] : topup[0]} will ${topup.length > 1 ? 'each ' : ''}need a top-up to reach the reset.` : ' Every item is covered to the reset at the supply plan rate.'}`))
  B.push(table(['Unit Packaging', `On hand ${md(R.packaging.asOf)}`, 'On order', 'Usage per week at supply plan', 'Weeks of cover', 'Status to reset'], [
    ...R.packaging.unit.map(u => [SKU_NAME[u.sku], n(u.onHand), u.onOrder ? n(u.onOrder) : '', n(u.usage), u.weeks === null ? '' : String(Math.round(u.weeks)), u.status]),
    ['All 7 items', n(R.packaging.unitTotals.onHand), R.packaging.unitTotals.onOrder ? n(R.packaging.unitTotals.onOrder) : '', n(R.packaging.unitTotals.usage), '', ''],
  ], ['left', 'right', 'right', 'right', 'right', 'left'], true))
  B.push(img('c5'))
  const lowSrp = R.packaging.srp.filter(s => s.weeks !== null && s.weeks < 1).map(s => `${SKU_NAME[s.sku]} (${n(s.onHand)})`)
  B.push(p(`<b>SRPs.</b> ${n(R.packaging.srpTotals.onHand)} are on hand per the ERP${R.packaging.srpTotals.onOrder ? `, and ${n(R.packaging.srpTotals.onOrder)} remain on order on ${esc(S.srpPoNote)}` : ''}.${lowSrp.length ? ` ${lowSrp.join(', ')} ${lowSrp.length === 1 ? 'is' : 'are'} under a week of cover at the supply plan rate, so we are managing production to the SRPs available while the balance of the order lands.` : ''}`))
  B.push(notes(N.packaging))

  // ---- asks / meeting / closing ----
  if (N.asks?.trim()) { B.push(h('A few asks')); B.push(ul(N.asks.trim().split(/\n+/).filter(Boolean).map(x => esc(x.replace(/^[-*•]\s*/, ''))))) }
  if (N.meeting?.trim()) { B.push(h('Meeting next week')); B.push(notes(N.meeting)) }
  B.push(notes(N.closing) || p('Happy to jump on a quick call if it is easier to walk through any of this together. The updated workbook is attached.'))
  B.push(p('Thank you,'))

  const body = noDash(B.join(''))
  return `<html><head><meta charset="utf-8"></head><body style="margin: 0; padding: 16px; background: white;">${body}${SIGNATURE_HTML}</body></html>`
}

export function htmlToText(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<\/(p|div|tr|li|h\d)>/g, '\n').replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim()
}
