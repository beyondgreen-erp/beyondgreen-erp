// Email charts for the Walmart weekly report, drawn with @napi-rs/canvas (no browser needed).
// Fonts are bundled with the module so they also render on Vercel.
import path from 'path'
import { createCanvas, GlobalFonts, SKRSContext2D } from '@napi-rs/canvas'
import { Results, SKUS, SKU_NAME } from './types'
import { md } from './weeks'

const G = '#2BA84A', G2 = '#5CC27A', G3 = '#A9DDB8', GREY = '#9AA0A8', DARK = '#17202A', ORANGE = '#F2A33A', YEL = '#F6D55C', RED = '#D9534F', AXIS = '#DDE4DF'
let fontsReady = false
function fonts() {
  if (fontsReady) return
  const dir = path.join(process.cwd(), 'src', 'lib', 'walmartWeekly', 'fonts')
  try { GlobalFonts.registerFromPath(path.join(dir, 'DejaVuSans.ttf'), 'DejaVu Sans'); GlobalFonts.registerFromPath(path.join(dir, 'DejaVuSans-Bold.ttf'), 'DejaVu Sans Bold') } catch { /* fall back to whatever the host has */ }
  fontsReady = true
}
const F = (px: number, bold = false) => `${bold ? 'bold ' : ''}${px}px "${bold ? 'DejaVu Sans Bold' : 'DejaVu Sans'}", "DejaVu Sans", sans-serif`
const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

interface Frame { ctx: SKRSContext2D; W: number; H: number; L: number; R: number; T: number; B: number }
function frame(W: number, H: number, title: string, pad = { L: 80, R: 20, T: 46, B: 60 }) {
  fonts()
  const canvas = createCanvas(W, H); const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = DARK; ctx.font = F(17, true); ctx.textAlign = 'center'; ctx.fillText(title, W / 2, 26)
  return { canvas, f: { ctx, W, H, L: pad.L, R: W - pad.R, T: pad.T, B: H - pad.B } as Frame }
}
function yAxis(f: Frame, min: number, max: number, ticks = 6) {
  const { ctx } = f; const span = max - min || 1
  const step = niceStep(span / ticks)
  ctx.strokeStyle = AXIS; ctx.lineWidth = 1; ctx.fillStyle = '#555'; ctx.font = F(11); ctx.textAlign = 'right'
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) {
    const y = f.B - (v - min) / span * (f.B - f.T)
    ctx.beginPath(); ctx.moveTo(f.L, y); ctx.lineTo(f.R, y); ctx.stroke()
    ctx.fillText(fmt(v), f.L - 8, y + 4)
  }
  return (v: number) => f.B - (v - min) / span * (f.B - f.T)
}
function niceStep(raw: number) { const p = Math.pow(10, Math.floor(Math.log10(raw))); const m = raw / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p }
function legend(f: Frame, items: { color: string; label: string; hatch?: boolean }[], x = f.L + 6, y = f.T + 4) {
  const { ctx } = f; ctx.font = F(11); ctx.textAlign = 'left'
  for (const it of items) { ctx.fillStyle = it.color; ctx.fillRect(x, y, 14, 11); ctx.fillStyle = DARK; ctx.fillText(it.label, x + 20, y + 10); y += 17 }
}
function xLabel(f: Frame, x: number, lines: string[], y = f.B + 16) { const { ctx } = f; ctx.fillStyle = DARK; ctx.font = F(11); ctx.textAlign = 'center'; lines.forEach((l, i) => ctx.fillText(l, x, y + i * 14)) }
function valueLabel(f: Frame, x: number, y: number, text: string, size = 10) { const { ctx } = f; ctx.fillStyle = DARK; ctx.font = F(size); ctx.textAlign = 'center'; ctx.fillText(text, x, y) }

export function chartWeeklyOrders(R: Results): Buffer {
  const wk = R.weeks.slice(-13)
  const { canvas, f } = frame(1000, 460, `Walmart orders by week, ${wk.length ? `WK ${wk[0].wk} to WK ${wk[wk.length - 1].wk}` : ''} (units)`)
  const max = Math.max(...wk.map(w => w.units), 1) * 1.2
  const y = yAxis(f, 0, max)
  const slot = (f.R - f.L) / wk.length, bw = slot * 0.62
  wk.forEach((w, i) => {
    const x = f.L + slot * (i + 0.5) - bw / 2
    const sh = w.shipped, op = w.units - sh
    f.ctx.fillStyle = G; f.ctx.fillRect(x, y(sh), bw, f.B - y(sh))
    if (op > 0) { f.ctx.fillStyle = w.wk === R.orderWeek ? YEL : ORANGE; f.ctx.fillRect(x, y(sh + op), bw, y(sh) - y(sh + op)) }
    valueLabel(f, x + bw / 2, y(w.units) - 6, fmt(w.units))
    xLabel(f, x + bw / 2, [`WK ${w.wk > 52 ? w.wk - 52 : w.wk}`, md(w.orderDate)])
  })
  legend(f, [{ color: G, label: 'Shipped' }, { color: ORANGE, label: 'Earlier weeks: pickups still open' }, { color: YEL, label: `WK ${R.orderWeek > 52 ? R.orderWeek - 52 : R.orderWeek}: this week's order, shipping now` }])
  return canvas.toBuffer('image/png')
}

export function chartDailyProduction(R: Results): Buffer {
  const days = R.prodDays.slice(-16)
  const { canvas, f } = frame(1000, 420, `Daily production, ${days.length ? `${md(days[0].date)} to ${md(days[days.length - 1].date)}` : ''} (units, ERP production board)`)
  const max = Math.max(...days.map(d => d.tot * 6), 1) * 1.22
  const y = yAxis(f, 0, max)
  const slot = (f.R - f.L) / Math.max(days.length, 1), bw = slot * 0.66
  const wks = Array.from(new Set(days.map(d => d.wk))).sort((a, b) => a - b)
  const shade = [G3, G2, G]
  const col = (wk: number) => shade[Math.max(0, wks.indexOf(wk) - wks.length + 3)] || G3
  days.forEach((d, i) => {
    const x = f.L + slot * (i + 0.5) - bw / 2, v = d.tot * 6
    f.ctx.fillStyle = col(d.wk); f.ctx.fillRect(x, y(v), bw, f.B - y(v))
    valueLabel(f, x + bw / 2, y(v) - 5, fmt(v), 9)
    const dt = new Date(d.date + 'T00:00:00Z')
    xLabel(f, x + bw / 2, [dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }), md(d.date)])
  })
  legend(f, wks.map(wk => { const pw = R.prodWeeks.find(w => w.wk === wk); const u = pw ? pw.units : days.filter(d => d.wk === wk).reduce((a, d) => a + d.tot * 6, 0); return { color: col(wk), label: `WK ${wk > 52 ? wk - 52 : wk}${wk === wks[wks.length - 1] ? ' to date' : ''}: ${fmt(u)}` } }))
  return canvas.toBuffer('image/png')
}

export function chartPositionVsRequirement(R: Results): Buffer {
  const { canvas, f } = frame(1000, 460, 'Safety stock position vs 3-week requirement after the store increases (units)', { L: 80, R: 20, T: 46, B: 64 })
  const posV = R.requirement.map(r => r.position), reqV = R.requirement.map(r => r.req3After)
  const min = Math.min(0, ...posV) * 1.5, max = Math.max(...reqV, ...posV, 1) * 1.15
  const y = yAxis(f, min, max)
  const slot = (f.R - f.L) / SKUS.length, bw = slot * 0.36
  R.requirement.forEach((r, i) => {
    const cx = f.L + slot * (i + 0.5)
    f.ctx.fillStyle = r.position >= 0 ? G : RED; f.ctx.fillRect(cx - bw, y(Math.max(0, r.position)), bw - 2, Math.abs(y(r.position) - y(0)))
    f.ctx.fillStyle = GREY; f.ctx.fillRect(cx + 2, y(r.req3After), bw - 2, y(0) - y(r.req3After))
    valueLabel(f, cx - bw / 2, r.position >= 0 ? y(r.position) - 5 : y(r.position) + 13, fmt(r.position), 9)
    valueLabel(f, cx + bw / 2, y(r.req3After) - 5, fmt(r.req3After), 9)
    xLabel(f, cx, [SKU_NAME[r.sku], `${fmt(r.storesAfter)} stores`])
  })
  f.ctx.strokeStyle = '#888'; f.ctx.beginPath(); f.ctx.moveTo(f.L, y(0)); f.ctx.lineTo(f.R, y(0)); f.ctx.stroke()
  legend(f, [{ color: G, label: `Position after the WK ${R.orderWeek > 52 ? R.orderWeek - 52 : R.orderWeek} order ships` }, { color: GREY, label: '3-week requirement after store increases' }], f.R - 330)
  return canvas.toBuffer('image/png')
}

export function chartForecast(R: Results): Buffer {
  const rows = R.forecast.rows.slice(0, 9)
  const planSkus = SKUS.filter(k => R.forecast.planTotal[k])
  const { canvas, f } = frame(1000, 460, planSkus.length ? `${planSkus.map(k => SKU_NAME[k]).join(' and ')}: comp-store supply plan vs the forecast (units per order)` : 'Order forecast by order date (units)', { L: 80, R: 20, T: 46, B: 70 })
  const manualFor = (d: string) => Object.values(R.forecast.manual[d] || {}).reduce((a, b) => a + (Number(b) || 0), 0)
  const series = planSkus.length ? planSkus : (['total'] as const)
  const vals = rows.map(r => planSkus.length ? Math.max(...planSkus.map(k => r.sku[k] + (Number(R.forecast.manual[r.date]?.[k]) || 0))) : Object.values(r.sku).reduce((a, b) => a + b, 0) + manualFor(r.date))
  const max = Math.max(...vals, 1) * 1.25
  const y = yAxis(f, 0, max)
  const slot = (f.R - f.L) / Math.max(rows.length, 1); const n = planSkus.length ? planSkus.length + 1 : 1; const bw = slot * 0.8 / n
  const cols = [G, G2, '#1E7A36']
  rows.forEach((r, i) => {
    const x0 = f.L + slot * (i + 0.5) - (bw * n) / 2
    if (planSkus.length) {
      planSkus.forEach((k, j) => {
        const v = r.sku[k], mv = Number(R.forecast.manual[r.date]?.[k]) || 0, x = x0 + j * bw
        f.ctx.fillStyle = cols[j]; f.ctx.fillRect(x, y(v), bw - 2, f.B - y(v))
        if (mv) { f.ctx.fillStyle = YEL; f.ctx.fillRect(x, y(v + mv), bw - 2, y(v) - y(v + mv)) }
        if (r.plan || mv) valueLabel(f, x + bw / 2, y(v + mv) - 4, mv ? `${fmt(v)} + ${fmt(mv)}` : fmt(v), 8)
      })
      const o = r.orig ? planSkus.reduce((a, k) => a + (r.orig![k] || 0), 0) : 0
      const x = x0 + planSkus.length * bw; f.ctx.fillStyle = GREY; f.ctx.fillRect(x, y(o), bw - 2, f.B - y(o))
    } else {
      const v = vals[i]; f.ctx.fillStyle = G; f.ctx.fillRect(x0, y(v), bw - 2, f.B - y(v)); valueLabel(f, x0 + bw / 2, y(v) - 5, fmt(v), 9)
    }
    xLabel(f, f.L + slot * (i + 0.5), [r.label, md(r.date), ...(R.forecast.rows[i + 1] && (new Date(R.forecast.rows[i + 1].date).getTime() - new Date(r.date).getTime()) > 8 * 86400000 ? ['(2 wks)'] : [])])
  })
  if (planSkus.length) legend(f, [...planSkus.map((k, j) => ({ color: cols[j], label: `${SKU_NAME[k]}, comp-store plan` })), { color: GREY, label: `Same items per the ${R.forecast.runDate ? md(R.forecast.runDate) + ' ' : ''}forecast (current stores)` }, ...(R.forecast.manualTotal ? [{ color: YEL, label: 'Expected one-time manual orders' }] : [])], f.R - 330)
  void series
  return canvas.toBuffer('image/png')
}

export function chartPackagingCover(R: Results): Buffer {
  const { canvas, f } = frame(1000, 400, 'Unit Packaging on hand vs the reset (weeks of cover)', { L: 110, R: 30, T: 46, B: 50 })
  const cap = 60, wtr = R.packaging.weeksToReset
  const { ctx } = f; const rowH = (f.B - f.T) / SKUS.length
  const x = (w: number) => f.L + Math.min(w, cap) / (cap + 22) * (f.R - f.L)
  ctx.strokeStyle = AXIS; ctx.fillStyle = '#555'; ctx.font = F(11); ctx.textAlign = 'center'
  for (let v = 0; v <= cap + 20; v += 10) { ctx.beginPath(); ctx.moveTo(x(v), f.T); ctx.lineTo(x(v), f.B); ctx.stroke(); ctx.fillText(String(v), x(v), f.B + 16) }
  R.packaging.unit.forEach((u, i) => {
    const w = u.weeks ?? 0, yy = f.T + rowH * i + rowH * 0.2, h = rowH * 0.6
    ctx.fillStyle = w < 8 ? RED : w < wtr ? ORANGE : G; ctx.fillRect(f.L, yy, x(w) - f.L, h)
    ctx.fillStyle = DARK; ctx.font = F(11); ctx.textAlign = 'left'; ctx.fillText(`${Math.round(w)} wks  (${fmt(u.committed)} on hand${u.onOrder ? ' + on order' : ''})`, x(w) + 6, yy + h / 2 + 4)
    ctx.textAlign = 'right'; ctx.fillText(SKU_NAME[u.sku], f.L - 8, yy + h / 2 + 4)
  })
  ctx.strokeStyle = DARK; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(x(wtr), f.T); ctx.lineTo(x(wtr), f.B); ctx.stroke(); ctx.setLineDash([])
  ctx.fillStyle = DARK; ctx.font = F(11); ctx.textAlign = 'center'; ctx.fillText(`Weeks of cover at the supply plan rate (bars capped at ${cap}). Dashed line: ${wtr} weeks to the ${md(R.packaging.resetDate)}/${R.packaging.resetDate.slice(0, 4)} reset.`, (f.L + f.R) / 2, f.B + 34)
  return canvas.toBuffer('image/png')
}

export function buildCharts(R: Results): { id: string; png: Buffer }[] {
  return [
    { id: 'c1', png: chartWeeklyOrders(R) },
    { id: 'c2', png: chartDailyProduction(R) },
    { id: 'c3', png: chartPositionVsRequirement(R) },
    { id: 'c4', png: chartForecast(R) },
    { id: 'c5', png: chartPackagingCover(R) },
  ]
}
