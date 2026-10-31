// Work order paperwork for the production boards (Make to Stock, Private Label, Contract Mfg):
// the printed work order (beyondGREEN OP template style) and the 4x6 case labels.
// Data comes from the pb_wo_print(p_wo) RPC. Quantities are in each SKU's own stocking unit.
import { jsPDF } from 'jspdf'
import '@/lib/pdfSafeText'
import { buildStrawCaseLabels, planLabels as planStrawLabels, type StrawPrint } from '@/lib/strawWoDocs'

export interface PbPrintOrder { id: string; order_number: string | null; po_number: string | null; customer: string | null; ship_to: string | null; ship_date: string | null; status: string | null }
export interface PbPrintBom { component: string; name: string | null; role: string | null; uom_type: string | null; case_level: boolean; qty: number | null; cost: number | null; comp_uom: string | null }
export interface PbPrintByOrder { order_number: string | null; po_number: string | null; line_id: string; qty: number | null; uom: string | null; units: number | null }
export interface PbPrintLine {
  sku: string; name: string | null; uom: string | null; case_qty: number | null; pieces_per_pack: number | null; target: number; made: number
  upc: string | null; gtin_image_url: string | null; customer_part: string | null; our_part: string | null
  case_size: string | null; case_weight: string | number | null; cases_per_pallet: number | null; color: string | null; print_color: string | null
  size: string | null; thickness: string | null; weight_g: number | null; special: string | null; by_order: PbPrintByOrder[]; bom: PbPrintBom[]
}
export interface PbPrint {
  board: { key: string; title: string }
  wo: { id: string; code: string | null; status: string | null; notes: string | null; start_date: string | null; due_date: string | null; created_at: string | null; operator: string | null; machine: string | null; printed_by: string | null }
  orders: PbPrintOrder[]; lines: PbPrintLine[]
}

const n = (v: any) => Number(v) || 0
const fmt = (v: any, dp = 2) => (v === null || v === undefined || v === '' ? '' : n(v).toLocaleString('en-US', { maximumFractionDigits: dp }))
const fmtDate = (s?: string | null) => { if (!s) return ''; const d = new Date(String(s).length <= 10 ? s + 'T00:00:00' : s); return isNaN(d.getTime()) ? String(s) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
const isCase = (u?: string | null) => /^(CASE|CASES|CS|CTN|CARTON)$/i.test(String(u || '').trim())
const isPack = (u?: string | null) => /^(PK|PKS|PACK|PACKS)$/i.test(String(u || '').trim())
const uniq = (a: (string | null | undefined)[]) => Array.from(new Set(a.map(x => String(x || '').trim()).filter(Boolean)))

/** stocking units → cases, and what one case holds (in label units) */
export function caseMath(l: { uom: string | null; case_qty: number | null; pieces_per_pack?: number | null }, units: number) {
  if (isCase(l.uom)) return { cases: units, perCase: n(l.case_qty) || n(l.pieces_per_pack) || 1, label: 'PCS' }
  const per = n(l.case_qty) || 1
  return { cases: units / per, perCase: per, label: String(l.uom || 'UNITS').toUpperCase() }
}
/** pieces in one stocking unit (bags in a pack, etc.) */
const piecesPerUnit = (l: PbPrintLine) => (isPack(l.uom) ? n(l.pieces_per_pack) || 1 : isCase(l.uom) ? n(l.case_qty) || n(l.pieces_per_pack) || 1 : 1)

/** what each BOM line needs for `units` of the finished good (stocking-unit model, same as the BOM editor) */
export function bomNeed(l: PbPrintLine, b: PbPrintBom, units: number): { qty: number; uom: string } {
  const v = n(b.qty)
  if (b.uom_type === 'percentage') return { qty: (v / 100) * n(l.weight_g) * piecesPerUnit(l) * units / 453.592, uom: 'lb' }
  if (b.case_level) return { qty: v * (isCase(l.uom) ? units : units / (n(l.case_qty) || 1)), uom: b.comp_uom || 'pcs' }
  if (b.uom_type === 'pcs_pack') return { qty: v * units * (piecesPerUnit(l) / (n(l.pieces_per_pack) || piecesPerUnit(l) || 1)), uom: b.comp_uom || 'pcs' }
  return { qty: v * units, uom: b.comp_uom || 'pcs' }
}

const GREEN: [number, number, number] = [18, 122, 74]
const CREAM: [number, number, number] = [255, 248, 225]
const RULE: [number, number, number] = [150, 160, 180]

export function buildPbWorkOrderPdf(d: PbPrint): jsPDF {
  const doc = new jsPDF({ unit: 'in', format: 'letter', orientation: 'portrait' })
  const L = 0.45, R = 8.5 - 0.45, W = R - L, BOTTOM = 11 - 0.5
  let y = 0
  const ensure = (h: number) => { if (y + h > BOTTOM) { doc.addPage('letter', 'portrait'); y = 0.5 } }
  const bar = (t: string) => {
    ensure(0.55)
    doc.setFillColor(...GREEN); doc.rect(L, y, W, 0.24, 'F')
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5)
    doc.text(t, L + 0.06, y + 0.165); doc.setTextColor(0, 0, 0)
    y += 0.3
  }
  const cell = (x: number, w: number, label: string, value: string) => {
    const lw = 1.15
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(70, 75, 90)
    doc.text(doc.splitTextToSize(label, lw - 0.05) as string[], x, y + 0.13)
    const vx = x + lw, vw = w - lw - 0.08
    if (!value) { doc.setFillColor(...CREAM); doc.rect(vx, y, vw, 0.26, 'F') }
    doc.setDrawColor(...RULE); doc.setLineWidth(0.008); doc.line(vx, y + 0.26, vx + vw, y + 0.26)
    doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
    if (value) doc.text((doc.splitTextToSize(value, vw - 0.04) as string[])[0] || '', vx + 0.03, y + 0.18)
  }
  const row = (a: [string, string], b?: [string, string]) => { ensure(0.32); cell(L, W / 2, a[0], a[1]); if (b) cell(L + W / 2, W / 2, b[0], b[1]); y += 0.31 }
  const wide = (label: string, value: string) => { ensure(0.32); cell(L, W, label, value); y += 0.31 }
  const table = (head: string[], widths: number[], rows: string[][], blankRows = 0) => {
    const rh = 0.22
    const draw = (cells: string[], bold: boolean, fill?: [number, number, number]) => {
      ensure(rh)
      let x = L
      cells.forEach((c, i) => {
        const w = widths[i] * W
        if (fill) { doc.setFillColor(...fill); doc.rect(x, y, w, rh, 'F') }
        doc.setDrawColor(...RULE); doc.setLineWidth(0.006); doc.rect(x, y, w, rh)
        doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(bold ? 7.5 : 8)
        doc.text((doc.splitTextToSize(c, w - 0.06) as string[])[0] || '', x + 0.03, y + 0.15)
        x += w
      })
      y += rh
    }
    draw(head, true, [232, 240, 235])
    rows.forEach(r => draw(r, false))
    for (let i = 0; i < blankRows; i++) draw(head.map(() => ''), false, CREAM)
    y += 0.1
  }

  const printOne = (l: PbPrintLine, idx: number) => {
    if (idx > 0) doc.addPage('letter', 'portrait')
    y = 0.45
    const units = n(l.target), cm = caseMath(l, units)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15)
    doc.text(`beyondGREEN  —  ${d.board.title} Work Order`, 4.25, y + 0.1, { align: 'center' })
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
    doc.text('beyondGREEN Biotech, Inc.  ·  1202 E. Wakeham Ave., Santa Ana, CA 92705', 4.25, y + 0.3, { align: 'center' })
    y += 0.5
    bar('WORK ORDER')
    const os = d.orders.filter(o => l.by_order.some(b => b.order_number === o.order_number))
    const ords = os.length ? os : d.orders
    row(['Work Order #', d.wo.code || ''], ['Status', d.wo.status || ''])
    row(['Customer', uniq(ords.map(o => o.customer)).join(', ') || (d.orders.length ? '' : 'Stock build')], ['PO #', uniq(ords.map(o => o.po_number)).join(', ')])
    row(['Sales Order #', uniq(ords.map(o => o.order_number)).join(', ')], ['Ship Date', fmtDate(ords.map(o => o.ship_date).filter(Boolean).sort()[0] || d.wo.due_date)])
    row(['Start Date', fmtDate(d.wo.start_date)], ['Due Date', fmtDate(d.wo.due_date)])
    row(['Operator', d.wo.operator || ''], ['Machine', d.wo.machine || ''])
    bar('PRODUCT')
    row(['Item SKU', l.sku], ['Customer Part #', l.customer_part || ''])
    wide('Description', l.name || '')
    row(['Quantity to Make', `${fmt(units)} ${l.uom || ''}`], ['Cases', `${fmt(cm.cases)} cases × ${fmt(cm.perCase, 0)} ${cm.label.toLowerCase()}`])
    row(['Size', l.size || ''], ['Thickness', l.thickness || ''])
    row(['Color', l.color || ''], ['Print', l.print_color || ''])
    row(['Unit Weight (g)', fmt(l.weight_g, 3)], ['UPC / GTIN', l.upc || ''])
    row(['Case Size', l.case_size || ''], ['Cases / Pallet', fmt(l.cases_per_pallet, 0)])
    if (l.special) wide('Special Instructions', l.special)
    row(['Made so far', n(l.made) ? `${fmt(l.made)} ${l.uom || ''}` : ''], ['Lot #', ''])
    if (l.by_order.length) {
      bar('BY ORDER')
      table(['SO #', 'PO #', 'Customer', 'Ordered', `${l.uom || 'Units'}`, 'Cases', 'Ship'], [0.11, 0.15, 0.27, 0.13, 0.12, 0.1, 0.12],
        l.by_order.map(b => { const o = d.orders.find(x => x.order_number === b.order_number); return [String(b.order_number || ''), b.po_number || '', o?.customer || '', `${fmt(b.qty)} ${b.uom || ''}`, fmt(b.units), fmt(caseMath(l, n(b.units)).cases), fmtDate(o?.ship_date)] }))
    }
    if (l.bom.length) {
      bar('MATERIALS (BOM)')
      table(['Component', 'Description', 'Basis', 'Per', 'Needed'], [0.17, 0.43, 0.13, 0.1, 0.17],
        l.bom.map(b => {
          const need = bomNeed(l, b, units)
          const basis = b.uom_type === 'percentage' ? '% weight' : b.case_level ? 'per case' : b.uom_type === 'pcs_pack' ? 'per pack' : 'per unit'
          return [b.component, b.name || '', basis, b.uom_type === 'percentage' ? `${fmt(b.qty)}%` : fmt(b.qty), `${fmt(need.qty)} ${need.uom}`]
        }))
    }
    bar('PRODUCTION LOG (filled in on the floor)')
    table(['Date', 'Shift / Operator', `${l.uom || 'Units'} made`, 'Cases', 'Scrap', 'Lot #', 'Initials'], [0.12, 0.2, 0.14, 0.11, 0.11, 0.18, 0.14], [], 6)
    bar('SIGN-OFF')
    row(['Quality Check', ''], ['Checked By', ''])
    row(['Completed By', ''], ['Date', ''])
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(110, 115, 130)
    doc.text(`Shaded cells are filled in on the floor. ${d.wo.code || ''} · printed ${new Date().toLocaleString('en-US')}${d.wo.printed_by ? ' by ' + d.wo.printed_by.split('@')[0] : ''} · log production on the board when done.`, L, Math.min(y + 0.1, 11 - 0.25))
    doc.setTextColor(0, 0, 0)
  }
  if (!d.lines.length) { doc.setFontSize(12); doc.text('This work order has no targets yet.', L, 1) }
  d.lines.forEach(printOne)
  return doc
}

/** Same 4x6 case labels as the straw board, counted in this board's cases. */
export function pbAsLabelPrint(d: PbPrint): { print: StrawPrint; unit: string } {
  const labels = uniq(d.lines.map(l => caseMath(l, 1).label))
  const lines = d.lines.map(l => {
    const cm = caseMath(l, n(l.target))
    return {
      sku: l.sku, name: l.name, uom: l.uom, std_pcs: cm.perCase, target_std: cm.cases, made_std: caseMath(l, n(l.made)).cases, pack_pcs: cm.perCase,
      upc: l.upc, gtin_image_url: l.gtin_image_url, customer_part: l.customer_part, our_part: l.our_part, case_size: l.case_size,
      case_weight: n(l.case_weight) || null, cases_per_pallet: l.cases_per_pallet, color: l.color, print_color: l.print_color,
      inner_diameter_mm: null, wall_thickness_mm: null, straw_length_in: null, straw_weight_g: l.weight_g, cycle: null, special: l.special,
      by_order: l.by_order.map(b => ({ order_number: b.order_number, po_number: b.po_number, line_id: b.line_id, qty: b.qty, uom: b.uom, pack_pcs: cm.perCase, packs: caseMath(l, n(b.units)).cases })),
      bom: [],
    }
  })
  return { print: { wo: d.wo, orders: d.orders, lines } as StrawPrint, unit: labels.length === 1 ? labels[0] : 'UNITS' }
}
export function planPbLabels(d: PbPrint) { return planStrawLabels(pbAsLabelPrint(d).print) }
export async function buildPbCaseLabels(d: PbPrint) { const { print, unit } = pbAsLabelPrint(d); return buildStrawCaseLabels(print, undefined, unit) }
