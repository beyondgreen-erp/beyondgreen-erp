// Straw work order paperwork: the printed work order (beyondGREEN OP_004 straw template)
// and the 4x6 case labels. Data comes from the straw_wo_print(p_wo) RPC.
import { jsPDF } from 'jspdf'
import '@/lib/pdfSafeText'
import JsBarcode from 'jsbarcode'
import { loadBarcodePng } from '@/lib/shipping/labels'

export interface StrawPrintOrder { id: string; order_number: string | null; po_number: string | null; customer: string | null; ship_to: string | null; ship_date: string | null; status: string | null }
export interface StrawPrintBom { component: string; name: string | null; role: string | null; uom_type: string | null; qty: number | null }
export interface StrawPrintByOrder { order_number: string | null; po_number: string | null; line_id: string; qty: number | null; uom: string | null; pack_pcs: number | null; packs: number | null }
export interface StrawPrintLine {
  sku: string; name: string | null; uom: string | null; std_pcs: number | null; target_std: number; made_std: number; pack_pcs: number | null
  upc: string | null; gtin_image_url: string | null; customer_part: string | null; our_part: string | null
  case_size: string | null; case_weight: number | null; cases_per_pallet: number | null; color: string | null; print_color: string | null
  inner_diameter_mm: number | null; wall_thickness_mm: number | null; straw_length_in: number | null; straw_weight_g: number | null
  cycle: number | null; special: string | null; by_order: StrawPrintByOrder[]; bom: StrawPrintBom[]
}
export interface StrawPrint {
  wo: { id: string; code: string | null; status: string | null; notes: string | null; start_date: string | null; due_date: string | null; created_at: string | null; operator: string | null; machine: string | null; printed_by: string | null }
  orders: StrawPrintOrder[]; lines: StrawPrintLine[]
}

const n = (v: any) => Number(v) || 0
const fmt = (v: any, dp = 2) => (v === null || v === undefined || v === '' ? '' : n(v).toLocaleString('en-US', { maximumFractionDigits: dp }))
const fmtDate = (s?: string | null) => { if (!s) return ''; const d = new Date(String(s).length <= 10 ? s + 'T00:00:00' : s); return isNaN(d.getTime()) ? String(s) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
const realAddr = (s?: string | null) => { const t = String(s || '').trim(); return t && !/^(tbd|n\/?a|-+)$/i.test(t) ? t : '' }

/** pieces per case for this line, its case count and its piece count */
export function lineQty(l: StrawPrintLine) {
  const std = n(l.std_pcs), pack = n(l.pack_pcs) || std
  const pcs = n(l.target_std) * std
  const packs = pack ? pcs / pack : n(l.target_std)
  return { std, pack, pcs, packs: Math.round(packs * 1000) / 1000 }
}

function ordersFor(d: StrawPrint, l: StrawPrintLine) {
  const nums = new Set(l.by_order.map(b => b.order_number))
  const os = d.orders.filter(o => nums.has(o.order_number))
  return os.length ? os : d.orders
}
const uniq = (a: (string | null | undefined)[]) => Array.from(new Set(a.map(x => String(x || '').trim()).filter(Boolean)))

// ── Work order (letter) ─────────────────────────────────────────────────────
const GREEN: [number, number, number] = [18, 122, 74]
const CREAM: [number, number, number] = [255, 248, 225]
const RULE: [number, number, number] = [150, 160, 180]

export function buildStrawWorkOrderPdf(d: StrawPrint): jsPDF {
  const doc = new jsPDF({ unit: 'in', format: 'letter', orientation: 'portrait' })
  const L = 0.45, R = 8.5 - 0.45, W = R - L, BOTTOM = 11 - 0.5
  let y = 0
  const lines = d.lines.length ? d.lines : []
  const ensure = (h: number) => { if (y + h > BOTTOM) { doc.addPage('letter', 'portrait'); y = 0.5 } }
  const bar = (t: string) => {
    ensure(0.55)
    doc.setFillColor(...GREEN); doc.rect(L, y, W, 0.24, 'F')
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5)
    doc.text(t, L + 0.06, y + 0.165); doc.setTextColor(0, 0, 0)
    y += 0.3
  }
  // one label/value pair; blank values print as a cream fill-in box
  const cell = (x: number, w: number, label: string, value: string) => {
    const lw = 1.05
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(70, 75, 90)
    doc.text(doc.splitTextToSize(label, lw - 0.05) as string[], x, y + 0.13)
    const vx = x + lw, vw = w - lw - 0.08
    if (!value) { doc.setFillColor(...CREAM); doc.rect(vx, y, vw, 0.26, 'F') }
    doc.setDrawColor(...RULE); doc.setLineWidth(0.008); doc.line(vx, y + 0.26, vx + vw, y + 0.26)
    doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
    if (value) doc.text((doc.splitTextToSize(value, vw - 0.04) as string[])[0] || '', vx + 0.03, y + 0.18)
  }
  const row = (a: [string, string], b?: [string, string]) => {
    ensure(0.32)
    cell(L, W / 2, a[0], a[1]); if (b) cell(L + W / 2, W / 2, b[0], b[1])
    y += 0.31
  }
  const wide = (label: string, value: string) => { ensure(0.32); cell(L, W, label, value); y += 0.31 }
  const table = (head: string[], widths: number[], rows: string[][], blankRows = 0) => {
    const rh = 0.22
    ensure(rh * (1 + Math.min(rows.length + blankRows, 4)))
    doc.setFillColor(90, 96, 112); doc.rect(L, y, W, rh, 'F')
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.2)
    let x = L; head.forEach((h, i) => { doc.text(h, x + widths[i] * W / 2, y + 0.15, { align: 'center' }); x += widths[i] * W })
    doc.setTextColor(0, 0, 0); y += rh
    const all = [...rows, ...Array.from({ length: blankRows }, () => head.map(() => ''))]
    all.forEach(r => {
      ensure(rh)
      x = L
      r.forEach((v, i) => {
        const cw = widths[i] * W
        if (!v && i >= head.length - 2) { doc.setFillColor(...CREAM); doc.rect(x, y, cw, rh, 'F') }
        doc.setDrawColor(...RULE); doc.setLineWidth(0.006); doc.rect(x, y, cw, rh)
        doc.setFont('helvetica', i === 0 ? 'bold' : 'normal'); doc.setFontSize(7.8)
        if (v) doc.text((doc.splitTextToSize(v, cw - 0.06) as string[])[0] || '', x + 0.04, y + 0.152)
        x += cw
      })
      y += rh
    })
    y += 0.08
  }

  const printOne = (l: StrawPrintLine, idx: number) => {
    if (idx > 0) doc.addPage('letter', 'portrait')
    y = 0.5
    const q = lineQty(l)
    const os = ordersFor(d, l)
    const custom = q.pack && q.std && Math.abs(q.pack - q.std) > 0.001
    // header
    doc.setTextColor(...GREEN); doc.setFont('helvetica', 'bold'); doc.setFontSize(15)
    doc.text('beyondGREEN  —  Straw Conversion Work Order', 4.25, y + 0.1, { align: 'center' })
    doc.setTextColor(110, 115, 130); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
    doc.text('OP_004 REV_A   ·   Production Work Order   ·   1202 E Wakeham Ave, Santa Ana, CA 92705', 4.25, y + 0.32, { align: 'center' })
    doc.setTextColor(0, 0, 0)
    y += 0.5

    bar('Work Order')
    row(['Date', fmtDate(d.wo.start_date || d.wo.created_at)], ['Machine #', d.wo.machine || ''])
    row(['Work Order #', d.wo.code || ''], ['Item Part # (SKU)', l.sku])
    wide('Description', l.name || '')
    row(['Straw Quantity', `${fmt(q.packs)} cases × ${fmt(q.pack, 0)} pcs = ${fmt(q.pcs, 0)} pcs`], ['UOM', 'Cases'])
    row(['Sales Order #', uniq(os.map(o => o.order_number)).join(', ')], ['Customer', uniq(os.map(o => o.customer)).join(', ')])
    row(['Customer PO', uniq(os.map(o => o.po_number)).join(', ')], ['Required Ship Date', uniq(os.map(o => fmtDate(o.ship_date))).join(', ') || fmtDate(d.wo.due_date)])
    row(['Operator', d.wo.operator || ''], ['Supervisor', ''])
    row(['Scheduled Start', ''], ['Status', d.wo.status || ''])

    bar('Packing — use these counts on every case')
    row(['Pcs per Case', `${fmt(q.pack, 0)} pcs`], ['Cases to Pack', fmt(Math.ceil(q.packs - 1e-9), 0)])
    row(['Case Labels Needed', fmt(Math.ceil(q.packs - 1e-9), 0)], ['Case Size', custom ? '' : (l.case_size || '')])
    row(['Case Weight (lb)', custom ? '' : fmt(l.case_weight)], ['Cases per Pallet', custom ? '' : fmt(l.cases_per_pallet, 0)])
    if (custom) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(180, 83, 9)
      ensure(0.22)
      doc.text(`Customer case size: ${fmt(q.pack, 0)} pcs per case (our standard case is ${fmt(q.std, 0)}). Pack to the customer's count.`, L, y + 0.12)
      doc.setTextColor(0, 0, 0); y += 0.22
    }

    bar('Product Specifications')
    const nm = (l.name || '').toLowerCase()
    const wrapped = /unwrapped/.test(nm) ? 'No' : /wrapped/.test(nm) ? 'Yes' : ''
    row(['Inner Diameter (mm)', fmt(l.inner_diameter_mm)], ['Straw Length (in)', fmt(l.straw_length_in)])
    row(['Wall Thickness (mm)', fmt(l.wall_thickness_mm)], ['Straw Weight (g)', fmt(l.straw_weight_g, 3)])
    row(['Straw Color', l.color || ''], ['Wrapper', wrapped])
    row(['Wrapper Print', ''], ['Print Color', l.print_color || ''])
    row(['Print Plate', ''], ['Customer Part #', l.customer_part || ''])

    bar('Materials & Bill of Materials  —  record the lot number and actual quantity used')
    const gw = n(l.straw_weight_g)
    const roleName = (r: string | null) => ({ rm: 'Raw material', color: 'Color', additive: 'Additive', packaging: 'Packaging' } as Record<string, string>)[String(r || '').toLowerCase()] || String(r || '').replace(/_/g, ' ')
    table(['Material (role)', 'Component SKU', 'Description', 'Basis', 'Qty', 'Req. (lb)', 'Lot / Batch #', 'Used'],
      [0.12, 0.13, 0.25, 0.1, 0.07, 0.09, 0.15, 0.09],
      l.bom.map(b => {
        const pct = String(b.uom_type || '') === 'percentage'
        const lb = pct && gw ? (q.pcs * gw * n(b.qty) / 100) / 453.592 : 0
        return [roleName(b.role), b.component, b.name || '', pct ? '% by weight' : String(b.uom_type || '').replace('pcs_', 'per '), pct ? `${fmt(b.qty)}%` : fmt(b.qty, 4), lb ? fmt(lb) : '', '', '']
      }), l.bom.length ? 1 : 4)

    bar('Production Calculator')
    const meters = q.pcs * n(l.straw_length_in) * 0.0254
    const hours = n(l.cycle) && meters ? meters / n(l.cycle) / 60 : 0
    row(['Ext. Cycle Time (M/Min)', fmt(l.cycle)], ['Straws Needed', fmt(q.pcs, 0)])
    row(['Extruded Length (M)', meters ? fmt(meters, 1) : ''], ['Production Hours', hours ? fmt(hours) : ''])
    row(['Total Resin (lb)', gw ? fmt((q.pcs * gw) / 453.592) : ''], ['Made so far', n(l.made_std) ? `${fmt(n(l.made_std) * q.std / (q.pack || 1))} cases` : ''])

    if (l.by_order.length) {
      bar('Orders on this work order')
      table(['Sales Order', 'Customer PO', 'Customer', 'Ordered', 'Pcs / Case', 'Cases', 'Pieces', 'Ship'],
        [0.11, 0.17, 0.2, 0.11, 0.1, 0.08, 0.11, 0.12],
        l.by_order.map(b => {
          const o = d.orders.find(x => x.order_number === b.order_number)
          return [String(b.order_number || ''), b.po_number || '', o?.customer || '', `${fmt(b.qty)} ${b.uom || ''}`, fmt(b.pack_pcs, 0), fmt(b.packs), fmt(n(b.packs) * n(b.pack_pcs), 0), fmtDate(o?.ship_date)]
        }))
    }

    bar('Special Notes / Set-Up Instructions')
    const notes = [d.wo.notes, l.special, custom ? `Pack ${fmt(q.pack, 0)} pcs per case for this order.` : ''].filter(Boolean).join('  ·  ')
    ensure(0.6)
    doc.setFillColor(...CREAM); doc.rect(L, y, W, 0.55, 'F'); doc.setDrawColor(...RULE); doc.rect(L, y, W, 0.55)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
    if (notes) doc.text((doc.splitTextToSize(notes, W - 0.1) as string[]).slice(0, 4), L + 0.05, y + 0.15)
    y += 0.63

    bar('Production Record  —  completed on the floor')
    row(['Shift', ''], ['Date Run', ''])
    row(['Actual Start Time', ''], ['Actual Stop Time', ''])
    row(['Total Run Hours', ''], ['Good Cases Produced', ''])
    row(['Scrap / Reject Qty', ''], ['Scrap Reason', ''])
    bar('Sign-Off')
    row(['Operator (print & sign)', ''], ['Date', ''])
    row(['Supervisor', ''], ['QC Check', ''])

    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8); doc.setTextColor(120, 125, 140)
    doc.text(`Shaded cells are filled in on the floor. ${d.wo.code || ''} · printed ${new Date().toLocaleString('en-US')}${d.wo.printed_by ? ' by ' + d.wo.printed_by.split('@')[0] : ''} · log production on the Straw board when done.`, L, Math.min(y + 0.1, 11 - 0.25))
    doc.setTextColor(0, 0, 0)
  }

  if (!lines.length) { y = 0.5; doc.setFontSize(12); doc.text('This work order has no straw targets yet.', L, 1) }
  lines.forEach(printOne)
  return doc
}

// ── 4x6 case labels ─────────────────────────────────────────────────────────
function codeImage(value: string, format: string): string | null {
  if (typeof document === 'undefined') return null
  try {
    const c = document.createElement('canvas')
    JsBarcode(c, value, { format, width: 2, height: 80, displayValue: true, fontSize: 18, textMargin: 2, margin: 6 })
    return c.toDataURL('image/png')
  } catch { return null }
}
function barcodeFor(l: StrawPrintLine): { img: string | null; caption: string } {
  const d = String(l.upc || '').replace(/[^0-9]/g, '')
  if (d.length === 12) { const i = codeImage(d, 'UPC'); if (i) return { img: i, caption: 'UPC' } }
  if (d.length === 13) { const i = codeImage(d, 'EAN13'); if (i) return { img: i, caption: 'GTIN' } }
  if (d.length >= 6) { const i = codeImage(d, 'CODE128'); if (i) return { img: i, caption: 'GTIN' } }
  return { img: codeImage(l.sku, 'CODE128'), caption: 'Item SKU' }
}

export interface LabelPlan { sku: string; order_number: string | null; cases: number; pack: number; lastPcs: number }

/** One label per case, per order on the work order. */
export function planLabels(d: StrawPrint): LabelPlan[] {
  const out: LabelPlan[] = []
  for (const l of d.lines) {
    const q = lineQty(l)
    const parts = l.by_order.length ? l.by_order.map(b => ({ order_number: b.order_number, pack: n(b.pack_pcs) || q.pack, pcs: n(b.packs) * (n(b.pack_pcs) || q.pack) }))
      : [{ order_number: d.orders[0]?.order_number ?? null, pack: q.pack, pcs: q.pcs }]
    for (const p of parts) {
      if (!(p.pcs > 0) || !(p.pack > 0)) continue
      const cases = Math.ceil(p.pcs / p.pack - 1e-9)
      out.push({ sku: l.sku, order_number: p.order_number, cases, pack: p.pack, lastPcs: Math.round(p.pcs - (cases - 1) * p.pack) })
    }
  }
  return out
}

export async function buildStrawCaseLabels(d: StrawPrint, onlySku?: string): Promise<jsPDF> {
  const W = 4, H = 6, cx = W / 2, M = 0.18
  const doc = new jsPDF({ unit: 'in', format: [W, H], orientation: 'portrait' })
  const imgs: Record<string, string | null> = {}
  for (const l of d.lines) if (l.gtin_image_url && !(l.gtin_image_url in imgs)) imgs[l.gtin_image_url] = await loadBarcodePng(l.gtin_image_url)
  let first = true
  for (const p of planLabels(d)) {
    if (onlySku && p.sku !== onlySku) continue
    const l = d.lines.find(x => x.sku === p.sku)!
    const o = d.orders.find(x => x.order_number === p.order_number) || d.orders[0]
    const gen = barcodeFor(l)
    const uploaded = l.gtin_image_url ? imgs[l.gtin_image_url] : null
    for (let i = 1; i <= p.cases; i++) {
      if (!first) doc.addPage([W, H], 'portrait')
      first = false
      const pcs = i === p.cases ? p.lastPcs : p.pack
      let y = 0.3
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
      doc.text('BEYONDGREEN BIOTECH, INC.', cx, y, { align: 'center' }); y += 0.14
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
      doc.text('1202 E. WAKEHAM AVE., SANTA ANA, CA 92705', cx, y, { align: 'center' })
      y += 0.08; doc.setLineWidth(0.02); doc.line(M, y, W - M, y); y += 0.22
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.text('CUSTOMER', M, y); y += 0.24
      doc.setFont('helvetica', 'bold'); doc.setFontSize(17)
      const cust = (doc.splitTextToSize((o?.customer || '').toUpperCase() || '—', W - 2 * M) as string[]).slice(0, 2)
      cust.forEach(t => { doc.text(t, M, y); y += 0.26 })
      y += 0.02
      doc.setFontSize(20); doc.text(`PO# ${o?.po_number || '—'}`, M, y); y += 0.24
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
      doc.text(`SO# ${o?.order_number || '—'}   ·   WO ${d.wo.code || ''}${o?.ship_date ? '   ·   Ship ' + fmtDate(o.ship_date) : ''}`, M, y); y += 0.17
      const addr = realAddr(o?.ship_to)
      if (addr) { doc.setFontSize(8); (doc.splitTextToSize('Ship to: ' + addr.replace(/\n/g, ', '), W - 2 * M) as string[]).slice(0, 2).forEach(t => { doc.text(t, M, y); y += 0.14 }) }
      y += 0.02; doc.setLineWidth(0.02); doc.line(M, y, W - M, y); y += 0.22
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5)
      doc.text(`ITEM: ${l.sku}`, M, y); y += 0.18
      if (l.customer_part) { doc.setFontSize(9.5); doc.text(`CUSTOMER PART #: ${l.customer_part}`, M, y); y += 0.16 }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
      const desc = p.pack !== n(l.std_pcs) ? String(l.name || '').replace(/,?\s*\d[\d,]*\s*pcs\s*\/\s*(cs|case)\b/i, '') : String(l.name || '')
      ;(doc.splitTextToSize(desc, W - 2 * M) as string[]).slice(0, 2).forEach(t => { doc.text(t, M, y); y += 0.14 })
      y += 0.06
      // quantity + case count boxes
      const bw = (W - 2 * M - 0.1) / 2
      doc.setLineWidth(0.025); doc.rect(M, y, bw, 0.62); doc.rect(M + bw + 0.1, y, bw, 0.62)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
      doc.text('QTY PER CASE', M + bw / 2, y + 0.15, { align: 'center' }); doc.text('CASE', M + bw * 1.5 + 0.1, y + 0.15, { align: 'center' })
      doc.setFont('helvetica', 'bold'); doc.setFontSize(19)
      doc.text(`${fmt(pcs, 0)} PCS`, M + bw / 2, y + 0.47, { align: 'center' })
      doc.text(`${i} of ${p.cases}`, M + bw * 1.5 + 0.1, y + 0.47, { align: 'center' })
      y += 0.74
      // barcode
      const bh = 1.0, bwid = 2.9
      const img = uploaded || gen.img
      let placed = false
      if (img) { try { doc.addImage(img, 'PNG', cx - bwid / 2, y, bwid, bh); placed = true } catch { /* fall back */ } }
      if (!placed && gen.img && gen.img !== img) { try { doc.addImage(gen.img, 'PNG', cx - bwid / 2, y, bwid, bh); placed = true } catch { /* */ } }
      y += bh + 0.13
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
      doc.text(uploaded ? 'GTIN' : gen.caption, cx, y, { align: 'center' }); y += 0.2
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
      doc.text('LOT # ______________     PACKED ____ / ____ / ____', cx, Math.min(y + 0.05, H - 0.2), { align: 'center' })
    }
  }
  if (first) { doc.setFontSize(12); doc.text('No cases to label on this work order.', cx, 1, { align: 'center' }) }
  return doc
}
