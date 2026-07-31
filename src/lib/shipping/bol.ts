// Straight Bill of Lading + Master BOL + Packing List PDF generation (client-side, jsPDF).
import { jsPDF } from 'jspdf'

export interface BolLine {
  handlingQty?: number
  handlingType?: string   // Pallet
  packageQty?: number
  packageType?: string    // Case
  weight?: number
  commodityDescription: string
  nmfcNumber?: string
  freightClass?: string
  kind?: 'line' | 'sub' | 'note'   // sub = indented mixed-pallet content; note = full-width note
}

export interface BolData {
  isMaster?: boolean
  bolNumber: string
  date: string
  shipFromName: string
  shipFromAddress: string
  shipToName: string
  shipToAddress: string
  carrierName?: string
  scac?: string
  trailerNo?: string
  sealNumber?: string
  proNumber?: string
  freightTerms?: string
  specialInstructions?: string[]   // list of lines
  totalPallets: number
  totalCases: number
  totalWeight: number
  declaredValue?: number
  poNote?: string
}

export async function loadImageDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    const blob = await res.blob()
    return await new Promise((resolve) => {
      const fr = new FileReader()
      fr.onloadend = () => resolve(typeof fr.result === 'string' ? fr.result : null)
      fr.onerror = () => resolve(null)
      fr.readAsDataURL(blob)
    })
  } catch { return null }
}

function line(doc: jsPDF, x1: number, y1: number, x2: number, y2: number) { doc.setDrawColor(0); doc.setLineWidth(0.5); doc.line(x1, y1, x2, y2) }
function rect(doc: jsPDF, x: number, y: number, w: number, h: number) { doc.setDrawColor(0); doc.setLineWidth(0.5); doc.rect(x, y, w, h) }
function bold(doc: jsPDF, s: string, x: number, y: number, size = 7) { doc.setFont('helvetica', 'bold'); doc.setFontSize(size); doc.text(s, x, y) }
function norm(doc: jsPDF, s: string, x: number, y: number, size = 8) { doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.text(s, x, y) }

function renderBol(doc: jsPDF, d: BolData, lines: BolLine[], logo: string | null) {
  const M = 24
  const pageW = doc.internal.pageSize.getWidth()
  const R = pageW - M
  const midX = (M + R) / 2
  let y = M

  // Title
  if (logo) { try { doc.addImage(logo, 'PNG', M, y, 108, 42) } catch { /* */ } }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15)
  doc.text(d.isMaster ? 'Master Bill of Lading' : 'Straight Bill of Lading', midX + 20, y + 16)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  doc.text('Original – Not Negotiable', midX + 20, y + 28)
  y += 48

  // Header: two columns
  const headTop = y
  const colW = (R - M) / 2
  const lx = M, rx = midX
  const headH = 150
  rect(doc, lx, headTop, colW, headH)
  rect(doc, rx, headTop, colW, headH)

  // Left: Ship From / Ship To
  let ly = headTop + 12
  bold(doc, 'Ship From:', lx + 4, ly, 7.5); ly += 12
  bold(doc, d.shipFromName, lx + 4, ly, 8.5); ly += 11
  d.shipFromAddress.split('\n').forEach(l => { if (l.trim()) { norm(doc, l, lx + 4, ly, 8); ly += 10 } })
  ly = headTop + headH / 2
  line(doc, lx, ly, lx + colW, ly)
  ly += 12
  bold(doc, 'Ship To:', lx + 4, ly, 7.5); ly += 12
  bold(doc, d.shipToName, lx + 4, ly, 8.5); ly += 11
  d.shipToAddress.split('\n').forEach(l => { if (l.trim()) { norm(doc, l, lx + 4, ly, 8); ly += 10 } })

  // Right: date/bol/carrier + special instructions
  let ry = headTop + 12
  bold(doc, 'Date:', rx + 4, ry, 7.5); norm(doc, d.date, rx + 40, ry); ry += 13
  bold(doc, 'BOL No:', rx + 4, ry, 7.5); norm(doc, d.bolNumber, rx + 48, ry); ry += 13
  bold(doc, 'Carrier:', rx + 4, ry, 7.5); norm(doc, d.carrierName || '', rx + 48, ry); ry += 12
  bold(doc, 'SCAC:', rx + 4, ry, 7.5); norm(doc, d.scac || '', rx + 40, ry)
  bold(doc, 'Pro No:', rx + colW / 2, ry, 7.5); norm(doc, d.proNumber || '', rx + colW / 2 + 42, ry); ry += 12
  bold(doc, 'Trailer:', rx + 4, ry, 7.5); norm(doc, d.trailerNo || '', rx + 44, ry)
  bold(doc, 'Seal:', rx + colW / 2, ry, 7.5); norm(doc, d.sealNumber || '', rx + colW / 2 + 32, ry); ry += 8
  const rmid = headTop + headH / 2
  line(doc, rx, rmid, rx + colW, rmid)
  ry = rmid + 12
  bold(doc, 'Special Instructions:', rx + 4, ry, 7.5)
  if (d.isMaster) bold(doc, '[X] Master BOL', rx + colW - 78, ry, 7.5)
  ry += 11
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
  ;(d.specialInstructions || []).forEach(l => {
    const wrapped = doc.splitTextToSize(l, colW - 10) as string[]
    wrapped.forEach(w => { if (ry < headTop + headH - 3) { doc.text(w, rx + 4, ry); ry += 9 } })
  })

  y = headTop + headH
  norm(doc, `Freight Charge Terms: ${d.freightTerms || 'Prepaid'}`, M + 2, y + 10, 7.5)
  y += 16

  // Commodity table
  const cols = [
    { t: 'QTY', w: 30 }, { t: 'TYPE', w: 40 }, { t: 'QTY', w: 34 }, { t: 'TYPE', w: 40 },
    { t: 'WEIGHT', w: 46 }, { t: 'HM', w: 22 }, { t: 'Commodity Description', w: 0 },
    { t: 'NMFC', w: 40 }, { t: 'CLASS', w: 34 },
  ]
  const tableW = R - M
  cols[6].w = tableW - cols.reduce((s, c, i) => i === 6 ? s : s + c.w, 0)
  const xOf: number[] = []; { let cx = M; cols.forEach(c => { xOf.push(cx); cx += c.w }) }
  const descX = xOf[6]

  const headerH = 22
  rect(doc, M, y, tableW, headerH)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5)
  doc.text('Handling Unit', (xOf[0] + xOf[2]) / 2, y + 8, { align: 'center' })
  doc.text('Package', (xOf[2] + xOf[4]) / 2, y + 8, { align: 'center' })
  doc.text('LTL Only', (xOf[7] + R) / 2, y + 8, { align: 'center' })
  cols.forEach((c, i) => doc.text(c.t, xOf[i] + c.w / 2, y + 18, { align: 'center', maxWidth: c.w - 2 }))
  cols.forEach((c, i) => { if (i > 0) line(doc, xOf[i], y, xOf[i], y + headerH) })
  y += headerH

  const LH = 9 // line height inside a commodity cell
  const drawRow = (cells: (string | number)[], opts?: { indent?: boolean; boldRow?: boolean }) => {
    doc.setFont('helvetica', opts?.boldRow ? 'bold' : 'normal'); doc.setFontSize(7.5)
    const indent = opts?.indent ? 14 : 3
    const descAvailW = cols[6].w - (opts?.indent ? 16 : 5)
    const descText = String(cells[6] ?? '')
    // Split on explicit newlines first, then word-wrap each piece to the column.
    const wrapped = descText
      ? descText.split('\n').flatMap(seg => doc.splitTextToSize(seg, descAvailW) as string[])
      : []
    const rowH = Math.max(13, wrapped.length * LH + 5)
    rect(doc, M, y, tableW, rowH)
    cols.forEach((c, i) => { if (i > 0) line(doc, xOf[i], y, xOf[i], y + rowH) })
    cells.forEach((val, i) => {
      if (val === '' || val == null) return
      if (i === 6) {
        let ty = y + 9
        wrapped.forEach(w => { doc.text(w, descX + indent, ty); ty += LH })
      } else {
        // vertically centre the single-line cells within the (possibly taller) row
        doc.text(String(val), xOf[i] + cols[i].w / 2, y + rowH / 2 + 2.5, { align: 'center', maxWidth: cols[i].w - 2 })
      }
    })
    y += rowH
  }

  const minRows = 12
  let drawn = 0
  lines.forEach(ln => {
    if (ln.kind === 'note') { drawRow(['', '', '', '', '', '', ln.commodityDescription, '', ''], { boldRow: true }); drawn++; return }
    if (ln.kind === 'sub') { drawRow(['', '', '', '', '', '', ln.commodityDescription, ln.nmfcNumber || '', ln.freightClass || ''], { indent: true }); drawn++; return }
    drawRow([
      ln.handlingQty ?? '', ln.handlingType || 'Pallet', ln.packageQty ?? '', ln.packageType || 'Case',
      ln.weight != null ? Math.round(ln.weight) : '', '', ln.commodityDescription, ln.nmfcNumber || '', ln.freightClass || '',
    ]); drawn++
  })
  for (; drawn < minRows; drawn++) drawRow(['', '', '', '', '', '', '', '', ''])

  // Totals row
  const rowH = 13
  doc.setFillColor(245, 245, 245); doc.rect(M, y, tableW, rowH, 'F')
  rect(doc, M, y, tableW, rowH)
  cols.forEach((c, i) => { if (i > 0) line(doc, xOf[i], y, xOf[i], y + rowH) })
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
  doc.text(String(d.totalPallets), xOf[0] + cols[0].w / 2, y + 9, { align: 'center' })
  doc.text(String(d.totalCases), xOf[2] + cols[2].w / 2, y + 9, { align: 'center' })
  doc.text(String(Math.round(d.totalWeight)), xOf[4] + cols[4].w / 2, y + 9, { align: 'center' })
  doc.text('TOTALS', descX + 3, y + 9)
  y += rowH + 12

  // Declared value + note + signatures
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
  doc.text('The agreed or declared value of the property is specifically stated by the shipper to be not exceeding:', M, y, { maxWidth: tableW })
  y += 12
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
  doc.text(`$${(d.declaredValue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, M, y)
  y += 20
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5)
  doc.text('NOTE: Liability Limitation for loss or damage in this shipment may be applicable. See 49 U.S.C. 14706(c)(1)(A) and (B).', M, y, { maxWidth: tableW })
  y += 30
  const sigW = (tableW - 30) / 2
  line(doc, M, y, M + sigW, y); line(doc, R - sigW, y, R, y)
  bold(doc, 'Shipper Signature / Date', M, y + 11, 7)
  bold(doc, 'Carrier Signature / Pickup Date', R - sigW, y + 11, 7)
}

export function buildBOL(d: BolData, lines: BolLine[], logo: string | null): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' })
  renderBol(doc, d, lines, logo)
  return doc
}
export function buildMasterBOL(d: BolData, lines: BolLine[], logo: string | null): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' })
  renderBol(doc, { ...d, isMaster: true }, lines, logo)
  return doc
}

export interface PackListCase {
  sku: string; description?: string
  caseCount: number            // total cases of this SKU being shipped (this shipment)
  casesOrdered?: number        // cases of this SKU on the order (legacy/reference)
  unitsInCase?: number         // units (UOM) per case
  units?: number               // total units of this SKU
  weight?: number              // total line weight (lb)
  uom?: string                 // unit of measure the qtys are counted in (e.g. Pack, Each, Case)
  orderedUnits?: number        // quantity ordered, in the UOM
  shippedUnits?: number        // quantity shipped, in the UOM (= caseCount × unitsInCase)
  boxDims?: string             // box/case dimensions e.g. 12 × 10 × 8 in
  boxWeight?: number           // weight of one box/case (lb)
}
export interface PackListPallet {
  number: number; dims?: string; weight?: number
  lines: { sku: string; description?: string; cases: number; units: number }[]
}

export function buildPackingList(
  order: { poNumber: string; orderNumber: string; shipToName: string; shipToAddress: string; date: string; shipFromName?: string; shipFromAddress?: string; partialCaption?: string },
  cases: PackListCase[],
  totals: { pallets: number; cases: number; weight: number },
  logo: string | null,
  pallets?: PackListPallet[],
): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' })
  const M = 36
  const pageW = doc.internal.pageSize.getWidth()
  const R = pageW - M
  const bottom = doc.internal.pageSize.getHeight() - M
  let y = M
  const need = (h: number) => { if (y + h > bottom) { doc.addPage(); y = M } }

  if (logo) { try { doc.addImage(logo, 'PNG', M, y, 104, 40) } catch { /* */ } }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(20, 22, 34)
  doc.text('Packing List', R, y + 15, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90, 96, 110)
  doc.text(order.date, R, y + 30, { align: 'right' })
  if (order.partialCaption) { doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(200, 40, 40); doc.text(order.partialCaption, R, y + 44, { align: 'right' }); doc.setTextColor(20, 22, 34) }
  y += 52

  // Order / PO band
  doc.setDrawColor(225); doc.setLineWidth(0.6); doc.line(M, y, R, y); y += 14
  doc.setTextColor(20, 22, 34); doc.setFontSize(10); doc.setFont('helvetica', 'bold')
  doc.text(order.orderNumber || '', M, y)
  if (order.poNumber) { doc.setFont('helvetica', 'normal'); doc.setTextColor(90, 96, 110); doc.text(`PO #${order.poNumber}`, R, y, { align: 'right' }) }
  y += 16

  // Ship From / Ship To — two columns
  const colW = (R - M - 20) / 2
  const boxTop = y
  const addrBlock = (x: number, label: string, name: string, addr: string) => {
    let yy = boxTop
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(120, 126, 140)
    doc.text(label.toUpperCase(), x, yy); yy += 13
    doc.setFontSize(10); doc.setTextColor(20, 22, 34); doc.text(name || '—', x, yy); yy += 12
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(70, 74, 88)
    ;(addr || '').split('\n').forEach(l => { if (l.trim()) { doc.text(l.trim(), x, yy, { maxWidth: colW - 6 }); yy += 11 } })
    return yy
  }
  const y1 = addrBlock(M, 'Ship From', order.shipFromName || 'beyondGREEN Biotech, Inc.', order.shipFromAddress || '1202 E. Wakeham Ave.\nSanta Ana, CA 92705 USA')
  const y2 = addrBlock(M + colW + 20, 'Ship To', order.shipToName, order.shipToAddress)
  y = Math.max(y1, y2) + 14

  // Per-SKU summary table.
  // Ordered / Shipped are counted in each line's own UOM (e.g. Packs); "Total Cases"
  // is the derived number of shipping boxes (shipped ÷ units-per-case).
  const cols = [
    { t: 'SKU', w: 68, a: 'l' as const },
    { t: 'Description', w: 0, a: 'l' as const },
    { t: 'UOM', w: 44, a: 'l' as const },
    { t: 'Ordered', w: 48, a: 'r' as const },
    { t: 'Shipped', w: 48, a: 'r' as const },
    { t: 'Total Cases', w: 56, a: 'r' as const },
    { t: 'Box Size', w: 82, a: 'l' as const },
    { t: 'Box Wt', w: 44, a: 'r' as const },
  ]
  const tableW = R - M
  cols[1].w = tableW - cols.reduce((s, c, i) => i === 1 ? s : s + c.w, 0)
  const xOf: number[] = []; { let cx = M; cols.forEach(c => { xOf.push(cx); cx += c.w }) }
  const cellX = (i: number) => cols[i].a === 'r' ? xOf[i] + cols[i].w - 4 : xOf[i] + 4
  const header = () => {
    doc.setFillColor(238, 242, 246); doc.rect(M, y, tableW, 17, 'F')
    doc.setDrawColor(210); doc.setLineWidth(0.5); doc.rect(M, y, tableW, 17)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(60, 64, 78)
    cols.forEach((c, i) => doc.text(c.t, cellX(i), y + 11.5, c.a === 'r' ? { align: 'right' } : undefined))
    y += 17
  }
  need(40); header()
  doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 32, 44)
  const ordered = [...cases].sort((a, b) => a.sku.localeCompare(b.sku))
  ordered.forEach((c, idx) => {
    if (y + 14 > bottom) { doc.addPage(); y = M; header(); doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 32, 44) }
    if (idx % 2 === 1) { doc.setFillColor(248, 249, 251); doc.rect(M, y, tableW, 14, 'F') }
    const upc = c.unitsInCase || 1
    const shipped = c.shippedUnits ?? (c.caseCount * upc)
    const ord = c.orderedUnits ?? c.units ?? shipped
    const bw = c.boxWeight || 0
    const cells = [
      c.sku, c.description || '', c.uom || 'Case',
      String(Math.round(ord)), String(Math.round(shipped)), String(c.caseCount),
      c.boxDims || '', bw ? String(+bw.toFixed(1)) : '',
    ]
    doc.setFontSize(9)
    cols.forEach((col, i) => doc.text(String(cells[i]), cellX(i), y + 10, { maxWidth: col.w - 6, align: col.a === 'r' ? 'right' : 'left' }))
    y += 14
  })
  doc.setDrawColor(210); doc.setLineWidth(0.5); doc.line(M, y, R, y)
  y += 15
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(20, 22, 34)
  const totalCases = cases.reduce((a, c) => a + (c.caseCount || 0), 0)
  const totalsParts = [
    totals.pallets > 0 ? `${totals.pallets} pallet${totals.pallets === 1 ? '' : 's'}` : '',
    `${totalCases} total case${totalCases === 1 ? '' : 's'}`,
    totals.weight > 0 ? `${Math.round(totals.weight)} lb` : '',
  ].filter(Boolean)
  doc.text(`Totals:   ${totalsParts.join('    ')}`, M, y)
  y += 8

  // Per-pallet breakdown
  if (pallets && pallets.length) {
    y += 20; need(30)
    doc.setDrawColor(225); doc.line(M, y, R, y); y += 15
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(20, 22, 34)
    doc.text('Pallet detail', M, y); y += 6
    pallets.forEach(p => {
      need(34)
      y += 12
      doc.setFillColor(238, 242, 246); doc.rect(M, y - 9, tableW, 16, 'F')
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(30, 32, 44)
      const meta = [p.dims, p.weight ? `${Math.round(p.weight)} lb` : ''].filter(Boolean).join('  ·  ')
      doc.text(`Pallet ${p.number}`, M + 4, y + 2)
      if (meta) doc.text(meta, R - 4, y + 2, { align: 'right' })
      y += 15
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(60, 64, 78)
      p.lines.forEach(l => {
        need(13)
        const label = `${l.cases} × ${l.sku}${l.description ? ' — ' + l.description : ''}`
        doc.text(label, M + 12, y + 8, { maxWidth: tableW - 120 })
        doc.text(`${l.units} units`, R - 4, y + 8, { align: 'right' })
        y += 13
      })
    })
  }
  return doc
}
