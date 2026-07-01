// Straight Bill of Lading + Master BOL + Packing List PDF generation (client-side, jsPDF).
// Layout mirrors the VICS Straight BOL template the user provided.
import { jsPDF } from 'jspdf'

export interface BolLine {
  handlingQty: number      // pallets
  handlingType?: string    // PLT
  packageQty: number       // cases
  packageType?: string     // CS
  weight: number
  commodityDescription: string
  poNumber?: string
  nmfcNumber?: string
  freightClass?: string
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
  specialInstructions?: string
  puNumber?: string
  loadNumber?: string
  puDate?: string
  puTime?: string
  totalPallets: number
  totalCases: number
  totalWeight: number
  declaredValue?: number
}

// Load an image URL (e.g. /bG-logo-clean.png) into a PNG data URL for embedding.
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
  } catch {
    return null
  }
}

const GREEN: [number, number, number] = [43, 168, 74]

function box(doc: jsPDF, x: number, y: number, w: number, h: number) {
  doc.setDrawColor(0); doc.setLineWidth(0.4)
  doc.rect(x, y, w, h)
}

function label(doc: jsPDF, text: string, x: number, y: number, size = 6.5) {
  doc.setFont('helvetica', 'bold'); doc.setFontSize(size)
  doc.text(text, x, y)
}

function val(doc: jsPDF, text: string, x: number, y: number, size = 9) {
  doc.setFont('helvetica', 'normal'); doc.setFontSize(size)
  doc.text(text, x, y)
}

function renderBol(doc: jsPDF, d: BolData, lines: BolLine[], logo: string | null) {
  const M = 28
  const pageW = doc.internal.pageSize.getWidth()
  const right = pageW - M
  const midX = pageW / 2
  let y = M

  // Title + logo
  if (logo) { try { doc.addImage(logo, 'PNG', M, y - 6, 120, 47) } catch { /* */ } }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16)
  doc.text(d.isMaster ? 'Master Bill of Lading' : 'Straight Bill of Lading', midX + 10, y + 10)
  doc.setFontSize(8); doc.setFont('helvetica', 'normal')
  doc.text('Original - Not Negotiable', midX + 10, y + 22)
  y += 44

  const colW = (right - M) / 2
  const leftX = M, rightX = midX + 6
  const headH = 150

  // Ship From / Ship To (left column)
  box(doc, leftX, y, colW - 6, headH)
  let ly = y + 12
  label(doc, 'Ship From:', leftX + 4, ly); ly += 12
  val(doc, d.shipFromName, leftX + 4, ly, 9); ly += 11
  d.shipFromAddress.split('\n').forEach(l => { val(doc, l, leftX + 4, ly, 8); ly += 10 })
  ly += 10
  doc.setDrawColor(200); doc.line(leftX, ly - 4, leftX + colW - 6, ly - 4); doc.setDrawColor(0)
  label(doc, 'Ship To:', leftX + 4, ly); ly += 12
  val(doc, d.shipToName, leftX + 4, ly, 9); ly += 11
  d.shipToAddress.split('\n').forEach(l => { val(doc, l, leftX + 4, ly, 8); ly += 10 })

  // Right column: date/bol/carrier/special instructions
  box(doc, rightX, y, colW - 6, headH)
  let ry = y + 12
  label(doc, 'Date:', rightX + 4, ry); val(doc, d.date, rightX + 40, ry); ry += 13
  label(doc, 'Bill of Lading No:', rightX + 4, ry); val(doc, d.bolNumber, rightX + 88, ry); ry += 14
  label(doc, 'Carrier Name:', rightX + 4, ry); val(doc, d.carrierName || '', rightX + 74, ry); ry += 12
  label(doc, 'SCAC:', rightX + 4, ry); val(doc, d.scac || '', rightX + 40, ry)
  label(doc, 'Pro No:', rightX + 130, ry); val(doc, d.proNumber || '', rightX + 168, ry); ry += 12
  label(doc, 'Trailer No:', rightX + 4, ry); val(doc, d.trailerNo || '', rightX + 58, ry)
  label(doc, 'Seal No:', rightX + 130, ry); val(doc, d.sealNumber || '', rightX + 172, ry); ry += 14
  doc.setDrawColor(200); doc.line(rightX, ry - 5, rightX + colW - 6, ry - 5); doc.setDrawColor(0)
  label(doc, 'Special Instructions:', rightX + 4, ry)
  if (d.isMaster) { doc.setFont('helvetica', 'bold'); doc.text('[X] Master BOL', rightX + 110, ry) }
  ry += 12
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
  const si: string[] = []
  si.push('"DO NOT STACK"')
  if (d.puNumber) si.push(`PU# ${d.puNumber}`)
  if (d.loadNumber) si.push(`Load# ${d.loadNumber}`)
  if (d.puDate) si.push(`PU Date: ${d.puDate}`)
  if (d.puTime) si.push(`PU Time: ${d.puTime}`)
  si.push(`Pallet QTY: ${d.totalPallets}  Cases: ${d.totalCases}  Weight: ${d.totalWeight}`)
  si.forEach(l => { doc.text(l, rightX + 4, ry); ry += 10 })

  y += headH + 6
  label(doc, 'Freight Charge Terms: ' + (d.freightTerms || 'Prepaid'), leftX + 2, y + 2, 7)
  y += 10

  // Commodity table
  const cols = [
    { t: 'QTY', w: 34 }, { t: 'TYPE', w: 34 }, { t: 'QTY', w: 40 }, { t: 'TYPE', w: 34 },
    { t: 'WEIGHT', w: 52 }, { t: 'H.M.', w: 30 }, { t: 'Commodity Description', w: 0 },
    { t: 'NMFC', w: 44 }, { t: 'CLASS', w: 40 },
  ]
  const tableW = right - M
  const fixed = cols.reduce((s, c) => s + c.w, 0)
  cols[6].w = tableW - fixed
  const rowH = 15
  const headerH = 22
  // grouped header
  box(doc, M, y, tableW, headerH)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5)
  doc.text('Handling Unit', M + 30, y + 8, { align: 'center' })
  doc.text('Package', M + 108, y + 8, { align: 'center' })
  let cxp = M
  cols.forEach(c => { doc.text(c.t, cxp + c.w / 2, y + 18, { align: 'center', maxWidth: c.w - 2 }); cxp += c.w })
  // vertical lines
  cxp = M
  cols.forEach(c => { doc.line(cxp, y, cxp, y + headerH); cxp += c.w })
  doc.line(right, y, right, y + headerH)
  y += headerH

  const bodyRows = Math.max(lines.length, d.isMaster ? lines.length : 6)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  for (let i = 0; i < bodyRows; i++) {
    const ln = lines[i]
    box(doc, M, y, tableW, rowH)
    let cxr = M
    const cells = ln ? [
      String(ln.handlingQty ?? ''), ln.handlingType || 'PLT', String(ln.packageQty ?? ''), ln.packageType || 'CS',
      ln.weight ? String(ln.weight) : '', '',
      (ln.commodityDescription || '') + (ln.poNumber ? `  PO#${ln.poNumber}` : ''),
      ln.nmfcNumber || '', ln.freightClass || '',
    ] : ['', '', '', '', '', '', '', '', '']
    cols.forEach((c, ci) => {
      doc.line(cxr, y, cxr, y + rowH)
      const align = ci === 6 ? 'left' : 'center'
      const tx = ci === 6 ? cxr + 3 : cxr + c.w / 2
      if (cells[ci]) doc.text(String(cells[ci]), tx, y + 10, { align: align as 'left' | 'center', maxWidth: c.w - 4 })
      cxr += c.w
    })
    doc.line(right, y, right, y + rowH)
    y += rowH
  }
  // Totals row
  box(doc, M, y, tableW, rowH)
  doc.setFont('helvetica', 'bold')
  doc.text(String(d.totalPallets), M + cols[0].w / 2, y + 10, { align: 'center' })
  doc.text(String(d.totalCases), M + cols[0].w + cols[1].w + cols[2].w / 2, y + 10, { align: 'center' })
  doc.text(String(d.totalWeight), M + cols[0].w + cols[1].w + cols[2].w + cols[3].w + cols[4].w / 2, y + 10, { align: 'center' })
  doc.text('TOTALS', M + cols[6].w / 2 + 200, y + 10, { align: 'center' })
  y += rowH + 10

  // Declared value + certification
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
  doc.text('The agreed or declared value of the property is specifically stated by the shipper to be not exceeding', M, y, { maxWidth: tableW })
  y += 12
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
  doc.text(`$${(d.declaredValue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, M, y)
  y += 24

  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5)
  doc.text('NOTE: Liability Limitation for loss or damage in this shipment may be applicable. See 49 U.S.C. 14706(c)(1)(A) and (B).', M, y, { maxWidth: tableW })
  y += 26
  // Signatures
  const sigW = (tableW - 20) / 2
  doc.setDrawColor(0)
  doc.line(M, y + 24, M + sigW, y + 24)
  label(doc, 'Shipper Signature / Date', M, y + 34, 7)
  doc.line(right - sigW, y + 24, right, y + 24)
  label(doc, 'Carrier Signature / Pickup Date', right - sigW, y + 34, 7)
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
  sku: string
  description?: string
  caseNumber: number
  totalCases: number
  unitsInCase?: number
  weight?: number
  palletNumber?: number | null
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
  const right = pageW - M
  let y = M
  if (logo) { try { doc.addImage(logo, 'PNG', M, y - 4, 120, 47) } catch { /* */ } }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18)
  doc.text('Packing List', right, y + 14, { align: 'right' })
  y += 52
  doc.setFontSize(9); doc.setFont('helvetica', 'normal')
  doc.text(`Order: ${order.orderNumber}`, M, y)
  doc.text(`PO#: ${order.poNumber}`, M + 180, y)
  doc.text(`Date: ${order.date}`, right, y, { align: 'right' }); y += 14
  doc.setFont('helvetica', 'bold'); doc.text('Ship To:', M, y); y += 12
  doc.setFont('helvetica', 'normal')
  doc.text(order.shipToName, M, y); y += 12
  order.shipToAddress.split('\n').forEach(l => { if (l.trim()) { doc.text(l, M, y); y += 12 } })
  y += 8

  const cols = [
    { t: 'Pallet', w: 50 }, { t: 'Case', w: 70 }, { t: 'SKU', w: 110 },
    { t: 'Description', w: 0 }, { t: 'Units', w: 50 }, { t: 'Weight', w: 60 },
  ]
  const tableW = right - M
  const fixed = cols.reduce((s, c) => s + c.w, 0)
  cols[3].w = tableW - fixed
  doc.setFillColor(240, 244, 248); doc.rect(M, y, tableW, 16, 'F')
  box(doc, M, y, tableW, 16)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
  let cxp = M
  cols.forEach(c => { doc.text(c.t, cxp + 3, y + 11); cxp += c.w })
  y += 16
  doc.setFont('helvetica', 'normal')
  cases.forEach(c => {
    if (y > 740) { doc.addPage(); y = M }
    box(doc, M, y, tableW, 14)
    let cxr = M
    const cells = [
      c.palletNumber ? String(c.palletNumber) : '-',
      `${c.caseNumber}/${c.totalCases}`, c.sku, c.description || '',
      c.unitsInCase != null ? String(c.unitsInCase) : '', c.weight != null ? String(c.weight) : '',
    ]
    cols.forEach((col, ci) => { doc.text(String(cells[ci]), cxr + 3, y + 10, { maxWidth: col.w - 5 }); cxr += col.w })
    y += 14
  })
  y += 12
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
  doc.text(`Totals:  Pallets ${totals.pallets}   Cases ${totals.cases}   Weight ${totals.weight} lb`, M, y)
  return doc
}
