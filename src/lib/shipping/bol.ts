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

  const rowH = 13
  const drawRow = (cells: (string | number)[], opts?: { indent?: boolean; boldRow?: boolean }) => {
    rect(doc, M, y, tableW, rowH)
    cols.forEach((c, i) => { if (i > 0) line(doc, xOf[i], y, xOf[i], y + rowH) })
    doc.setFont('helvetica', opts?.boldRow ? 'bold' : 'normal'); doc.setFontSize(7.5)
    cells.forEach((val, i) => {
      if (val === '' || val == null) return
      if (i === 6) doc.text(String(val), descX + (opts?.indent ? 14 : 3), y + 9, { maxWidth: cols[6].w - (opts?.indent ? 16 : 5) })
      else doc.text(String(val), xOf[i] + cols[i].w / 2, y + 9, { align: 'center', maxWidth: cols[i].w - 2 })
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
  sku: string; description?: string; caseNumber: number; totalCases: number
  unitsInCase?: number; weight?: number; palletNumber?: number | null
}

export function buildPackingList(
  order: { poNumber: string; orderNumber: string; shipToName: string; shipToAddress: string; date: string },
  cases: PackListCase[],
  totals: { pallets: number; cases: number; weight: number },
  logo: string | null,
): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' })
  const M = 32
  const pageW = doc.internal.pageSize.getWidth()
  const R = pageW - M
  let y = M
  if (logo) { try { doc.addImage(logo, 'PNG', M, y, 108, 42) } catch { /* */ } }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17)
  doc.text('Packing List', R, y + 16, { align: 'right' })
  y += 50
  doc.setFontSize(9); doc.setFont('helvetica', 'normal')
  doc.text(`Order: ${order.orderNumber}`, M, y)
  doc.text(`PO#: ${order.poNumber}`, M + 220, y)
  doc.text(`Date: ${order.date}`, R, y, { align: 'right' }); y += 15
  doc.setFont('helvetica', 'bold'); doc.text('Ship To:', M, y); doc.setFont('helvetica', 'normal')
  doc.text(order.shipToName, M + 42, y); y += 12
  order.shipToAddress.split('\n').forEach(l => { if (l.trim()) { doc.text(l, M + 42, y); y += 11 } })
  y += 10

  const cols = [{ t: 'Pallet', w: 44 }, { t: 'Case', w: 60 }, { t: 'SKU', w: 90 }, { t: 'Description', w: 0 }, { t: 'Units', w: 46 }, { t: 'Wt(lb)', w: 50 }]
  const tableW = R - M
  cols[3].w = tableW - cols.reduce((s, c, i) => i === 3 ? s : s + c.w, 0)
  const xOf: number[] = []; { let cx = M; cols.forEach(c => { xOf.push(cx); cx += c.w }) }
  doc.setFillColor(238, 242, 246); doc.rect(M, y, tableW, 16, 'F'); doc.setDrawColor(0); doc.setLineWidth(0.5); doc.rect(M, y, tableW, 16)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
  cols.forEach((c, i) => doc.text(c.t, xOf[i] + 3, y + 11))
  y += 16
  doc.setFont('helvetica', 'normal')
  cases.forEach(c => {
    if (y > 748) { doc.addPage(); y = M }
    doc.setDrawColor(220); doc.setLineWidth(0.3); doc.line(M, y + 13, R, y + 13)
    const cells = [c.palletNumber ? String(c.palletNumber) : '-', `${c.caseNumber}/${c.totalCases}`, c.sku, c.description || '', c.unitsInCase != null ? String(c.unitsInCase) : '', c.weight != null ? String(c.weight) : '']
    cols.forEach((col, i) => doc.text(String(cells[i]), xOf[i] + 3, y + 9, { maxWidth: col.w - 5 }))
    y += 13
  })
  y += 12
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
  doc.text(`Totals:   Pallets ${totals.pallets}    Cases ${totals.cases}    Weight ${Math.round(totals.weight)} lb`, M, y)
  return doc
}
