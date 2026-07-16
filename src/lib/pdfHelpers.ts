/* eslint-disable @typescript-eslint/no-explicit-any */
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export interface PDFLine {
  line_number: number
  sku: string | null
  description: string
  quantity: number
  quantity_shipped?: number
  unit_of_measure: string | null
  unit_price: number
  discount_pct: number
}

export interface PDFOrder {
  order_number: string
  order_date: string | null
  required_ship_date: string | null
  status: string
  po_number?: string | null
  shipping_address?: string | null
  carrier?: string | null
  tracking_number?: string | null
  subtotal: number
  tax_pct: number
  total: number
  notes?: string | null
  terms?: string | null
  fob?: string | null
  sales_rep?: string | null
}

export interface PDFCustomer {
  company_name: string
  email?: string | null
  phone?: string | null
  billing_address?: string | null
  shipping_address?: string | null
  contact_name?: string | null
}

const GREEN: [number, number, number] = [16, 185, 129]
const DARK: [number, number, number] = [20, 20, 20]
const GRAY: [number, number, number] = [120, 120, 120]
const fmt$ = (n: number) => '$' + n.toFixed(2)

const fmtMoney = (n: number) => (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const COMPANY = { name: 'beyondGREEN biotech, Inc.', addr: ['1202 E Wakeham Ave', 'Santa Ana, CA 92705', 'dba beyondGREEN'] }

let _bgLogoCache: string | null | undefined
async function loadBrandLogo(): Promise<string | null> {
  if (_bgLogoCache !== undefined) return _bgLogoCache
  try {
    const res = await fetch('/bG-logo.png')
    const blob = await res.blob()
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(fr.result as string)
      fr.onerror = reject
      fr.readAsDataURL(blob)
    })
    _bgLogoCache = dataUrl
    return dataUrl
  } catch { _bgLogoCache = null; return null }
}

function fmtDate(d?: string | null, blankIfNull = false): string {
  if (!d) return blankIfNull ? '' : new Date().toLocaleDateString('en-US')
  const dt = new Date(d.length <= 10 ? d + 'T00:00:00' : d)
  if (isNaN(dt.getTime())) return d
  return dt.toLocaleDateString('en-US')
}

function drawAddrBox(doc: jsPDF, x: number, y: number, w: number, h: number, label: string, rows: string[]) {
  const headH = 20
  doc.setDrawColor(0); doc.setLineWidth(0.7)
  doc.rect(x, y, w, h)
  doc.line(x, y + headH, x + w, y + headH)
  doc.setTextColor(0, 0, 0)
  doc.setFont('times', 'bold'); doc.setFontSize(10)
  doc.text(label, x + 8, y + 13.5)
  doc.setFont('times', 'normal'); doc.setFontSize(10)
  let ly = y + headH + 14
  rows.forEach(t => {
    const wrapped = doc.splitTextToSize(t, w - 16) as string[]
    wrapped.forEach(ww => { if (ly < y + h - 3) { doc.text(ww, x + 8, ly); ly += 12 } })
  })
}

function billToRows(order: PDFOrder, customer: PDFCustomer | null): string[] {
  const out: string[] = []
  if (customer?.company_name) out.push(customer.company_name)
  const addr = customer?.billing_address || order.shipping_address || ''
  if (addr) out.push(...addr.split(/\r?\n/).filter(Boolean))
  return out
}

function shipToRows(order: PDFOrder, customer: PDFCustomer | null): string[] {
  const out: string[] = []
  if (customer?.company_name) out.push(customer.company_name)
  const addr = order.shipping_address || customer?.shipping_address || customer?.billing_address || ''
  if (addr) out.push(...addr.split(/\r?\n/).filter(Boolean))
  return out
}


function header(doc: jsPDF, title: string) {
  const W = doc.internal.pageSize.getWidth()
  doc.setFillColor(...GREEN)
  doc.rect(0, 0, W, 56, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('beyondGREEN ERP', 36, 34)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.text(title, W - 36, 34, { align: 'right' })
  doc.setTextColor(...DARK)
}

export function generatePackingSlip(order: PDFOrder, lines: PDFLine[], customer: PDFCustomer | null) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  header(doc, 'PACKING SLIP')

  // Left: order info
  let y = 76
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text(order.order_number, 36, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  y += 14
  if (order.order_date) { doc.text(`Order Date: ${order.order_date}`, 36, y); y += 12 }
  if (order.required_ship_date) { doc.text(`Ship By: ${order.required_ship_date}`, 36, y); y += 12 }
  if (order.po_number) { doc.text(`PO #: ${order.po_number}`, 36, y); y += 12 }
  if (order.carrier) { doc.text(`Carrier: ${order.carrier}`, 36, y); y += 12 }
  if (order.tracking_number) { doc.text(`Tracking: ${order.tracking_number}`, 36, y) }

  // Right: ship-to
  if (customer) {
    doc.setFontSize(8)
    doc.setTextColor(...GRAY)
    doc.text('SHIP TO', W / 2, 76)
    doc.setTextColor(...DARK)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text(customer.company_name, W / 2, 88)
    doc.setFont('helvetica', 'normal')
    let cy = 100
    if (customer.contact_name) { doc.text(customer.contact_name, W / 2, cy); cy += 11 }
    if (customer.billing_address) {
      const wrapped = doc.splitTextToSize(customer.billing_address, 220) as string[]
      doc.text(wrapped, W / 2, cy)
      cy += wrapped.length * 11
    }
    if (customer.phone) doc.text(customer.phone, W / 2, cy)
  }

  autoTable(doc, {
    startY: 158,
    head: [['#', 'SKU', 'Description', 'Qty Ordered', 'Qty Shipped', 'UOM']],
    body: lines.map(l => [
      l.line_number,
      l.sku ?? '—',
      l.description,
      l.quantity,
      l.quantity_shipped ?? '',
      l.unit_of_measure ?? '—',
    ]),
    headStyles: { fillColor: GREEN, textColor: [255, 255, 255], fontSize: 9, fontStyle: 'bold' },
    bodyStyles: { fontSize: 9, minCellHeight: 18 },
    alternateRowStyles: { fillColor: [246, 250, 247] },
    columnStyles: {
      0: { cellWidth: 24, halign: 'center' },
      1: { cellWidth: 72, font: 'courier', fontSize: 8 },
      3: { cellWidth: 78, halign: 'center' },
      4: { cellWidth: 78, halign: 'center' },
      5: { cellWidth: 50 },
    },
  })

  const afterTable = (doc as any).lastAutoTable.finalY + 16

  if (order.notes) {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text('Notes:', 36, afterTable)
    doc.setFont('helvetica', 'normal')
    doc.text(doc.splitTextToSize(order.notes, W - 72) as string[], 36, afterTable + 12)
  }

  doc.setFontSize(8)
  doc.setTextColor(...GRAY)
  doc.text(`Generated ${new Date().toLocaleString()} · beyondGREEN ERP`, W / 2, doc.internal.pageSize.getHeight() - 18, { align: 'center' })

  doc.save(`packing-slip-${order.order_number}.pdf`)
}

export function generateBOL(order: PDFOrder, lines: PDFLine[], customer: PDFCustomer | null) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  header(doc, 'BILL OF LADING')

  // Shipper / Consignee boxes
  const bW = (W - 80) / 2
  const bY = 70
  doc.setDrawColor(210, 210, 210)
  doc.setLineWidth(0.5)
  doc.rect(36, bY, bW, 88)
  doc.rect(36 + bW + 8, bY, bW, 88)

  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...GRAY)
  doc.text('SHIPPER', 44, bY + 11)
  doc.text('CONSIGNEE', 44 + bW + 8, bY + 11)
  doc.setTextColor(...DARK)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('beyondGREEN', 44, bY + 24)
  doc.setFont('helvetica', 'normal')

  const cx = 44 + bW + 8
  if (customer) {
    doc.setFont('helvetica', 'bold')
    doc.text(customer.company_name, cx, bY + 24)
    doc.setFont('helvetica', 'normal')
    let cy = bY + 36
    if (customer.contact_name) { doc.text(customer.contact_name, cx, cy); cy += 11 }
    if (customer.billing_address) {
      const wrapped = doc.splitTextToSize(customer.billing_address, bW - 16) as string[]
      doc.text(wrapped, cx, cy)
      cy += wrapped.length * 11
    }
    if (customer.phone) doc.text(customer.phone, cx, cy)
  }

  // Shipment details grid
  const dY = bY + 104
  const details: [string, string][] = [
    ['BOL #:', order.order_number],
    ['Order Date:', order.order_date ?? '—'],
    ['Ship Date:', order.required_ship_date ?? '—'],
    ['Carrier:', order.carrier ?? '—'],
    ['Tracking #:', order.tracking_number ?? '—'],
    ['PO #:', order.po_number ?? '—'],
  ]
  doc.setFontSize(9)
  details.forEach(([label, value], i) => {
    const x = i < 3 ? 36 : W / 2
    const baseY = dY + (i % 3) * 14
    doc.setFont('helvetica', 'bold')
    doc.text(label, x, baseY)
    doc.setFont('helvetica', 'normal')
    doc.text(value, x + 72, baseY)
  })

  autoTable(doc, {
    startY: dY + 52,
    head: [['#', 'SKU', 'Description', 'Quantity', 'UOM', 'Weight (lbs)', 'Notes']],
    body: lines.map(l => [
      l.line_number,
      l.sku ?? '—',
      l.description,
      l.quantity,
      l.unit_of_measure ?? '—',
      '',
      '',
    ]),
    headStyles: { fillColor: GREEN, textColor: [255, 255, 255], fontSize: 9, fontStyle: 'bold' },
    bodyStyles: { fontSize: 9, minCellHeight: 22 },
    alternateRowStyles: { fillColor: [246, 250, 247] },
    columnStyles: {
      0: { cellWidth: 24, halign: 'center' },
      1: { cellWidth: 68, font: 'courier', fontSize: 8 },
      3: { cellWidth: 58, halign: 'center' },
      4: { cellWidth: 44 },
      5: { cellWidth: 70, halign: 'center' },
    },
  })

  const sigY = (doc as any).lastAutoTable.finalY + 36
  doc.setDrawColor(...GRAY)
  doc.line(36, sigY, 200, sigY)
  doc.line(W - 200, sigY, W - 36, sigY)
  doc.setFontSize(8)
  doc.setTextColor(...GRAY)
  doc.text('Shipper Signature & Date', 36, sigY + 11)
  doc.text('Carrier Signature & Date', W - 200, sigY + 11)

  doc.setFontSize(8)
  doc.text(`Generated ${new Date().toLocaleString()} · beyondGREEN ERP`, W / 2, doc.internal.pageSize.getHeight() - 18, { align: 'center' })

  doc.save(`bol-${order.order_number}.pdf`)
}

export async function generateOrderPDF(
  order: PDFOrder,
  lines: PDFLine[],
  customer: PDFCustomer | null
) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const L = 36, R = W - 36
  doc.setTextColor(0, 0, 0)

  // Header: logo + title + Date/Sales Order # box
  const logo = await loadBrandLogo()
  if (logo) { try { doc.addImage(logo, 'PNG', L, 28, 122, 48) } catch { /* skip */ } }
  doc.setFont('times', 'bold'); doc.setFontSize(28)
  doc.text('Sales Order', R, 60, { align: 'right' })

  const boxW = 200, boxX = R - boxW, boxY = 74, colX = boxX + boxW / 2, rowH = 20
  doc.setDrawColor(0); doc.setLineWidth(0.7)
  doc.rect(boxX, boxY, boxW, rowH)
  doc.rect(boxX, boxY + rowH, boxW, rowH)
  doc.line(colX, boxY, colX, boxY + rowH * 2)
  doc.setFont('times', 'bold'); doc.setFontSize(9.5)
  doc.text('Date', boxX + boxW / 4, boxY + 13.5, { align: 'center' })
  doc.text('Sales Order #', colX + boxW / 4, boxY + 13.5, { align: 'center' })
  doc.setFont('times', 'normal')
  doc.text(fmtDate(order.order_date), boxX + boxW / 4, boxY + rowH + 13.5, { align: 'center' })
  doc.text(order.order_number || '-', colX + boxW / 4, boxY + rowH + 13.5, { align: 'center' })

  // Company block
  doc.setFont('times', 'bold'); doc.setFontSize(11)
  doc.text(COMPANY.name, L, 100)
  doc.setFont('times', 'normal'); doc.setFontSize(12)
  let cyc = 118
  COMPANY.addr.forEach(line => { doc.text(line, L, cyc); cyc += 15 })

  // Bill To / Ship To
  const bY = 176, boxH = 96, lbW = 250, rbX = 300, rbW = R - rbX
  drawAddrBox(doc, L, bY, lbW, boxH, 'Name / Address', billToRows(order, customer))
  drawAddrBox(doc, rbX, bY, rbW, boxH, 'Ship To', shipToRows(order, customer))

  // Info row
  const iY = bY + boxH + 12, infoRowH = 20
  const infoCols = [
    { label: 'P.O. No.', value: order.po_number || '', w: 120 },
    { label: 'Ship By', value: fmtDate(order.required_ship_date, true), w: 120 },
    { label: 'Terms', value: order.terms || 'Net 30', w: 120 },
    { label: 'FOB', value: order.fob || 'Santa Ana', w: 96 },
    { label: 'Sales Rep', value: order.sales_rep || 'RP', w: 84 },
  ]
  let ix = L
  doc.setLineWidth(0.7); doc.setDrawColor(0)
  infoCols.forEach(c => {
    doc.setFillColor(238, 238, 238)
    doc.rect(ix, iY, c.w, infoRowH, 'FD')
    doc.setFont('times', 'bold'); doc.setFontSize(9.5); doc.setTextColor(0, 0, 0)
    doc.text(c.label, ix + c.w / 2, iY + 13.5, { align: 'center' })
    ix += c.w
  })
  ix = L
  infoCols.forEach(c => {
    doc.rect(ix, iY + infoRowH, c.w, infoRowH, 'S')
    doc.setFont('times', 'normal'); doc.setFontSize(9.5)
    doc.text(c.value || '', ix + c.w / 2, iY + infoRowH + 13.5, { align: 'center' })
    ix += c.w
  })

  // Line items
  const bodyRows = lines.map(l => {
    const total = l.quantity * l.unit_price * (1 - (l.discount_pct || 0) / 100)
    return [
      l.sku ?? '',
      l.description ?? '',
      l.quantity ? String(l.quantity) : '',
      l.unit_price ? fmtMoney(l.unit_price) : '',
      l.unit_of_measure ?? '',
      total ? fmtMoney(total) : '',
    ]
  })
  autoTable(doc, {
    startY: iY + infoRowH * 2,
    margin: { left: L, right: 36 },
    head: [['Item', 'Description', 'Qty', 'Cost', 'U/M', 'Total']],
    body: bodyRows,
    theme: 'grid',
    styles: { font: 'times', fontSize: 10, textColor: [0, 0, 0], lineColor: [120, 120, 120], lineWidth: 0.5, cellPadding: 3, valign: 'top' },
    headStyles: { fillColor: [238, 238, 238], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center', lineColor: [90, 90, 90], lineWidth: 0.6 },
    columnStyles: {
      0: { cellWidth: 74 },
      1: { cellWidth: 236 },
      2: { cellWidth: 52, halign: 'right' },
      3: { cellWidth: 58, halign: 'right' },
      4: { cellWidth: 40, halign: 'center' },
      5: { cellWidth: 64, halign: 'right' },
    },
  })

  const grand = lines.reduce((sum, l) => sum + l.quantity * l.unit_price * (1 - (l.discount_pct || 0) / 100), 0) || (order.total ?? 0)
  let afterY = (doc as any).lastAutoTable.finalY + 22
  if (afterY > H - 120) afterY = H - 120

  // Footer notes (left)
  doc.setFont('times', 'normal'); doc.setFontSize(9); doc.setTextColor(0, 0, 0)
  const notes = [
    'Payment: Custom projects require a 40% deposit to confirm the order; the balance is due at time of shipment unless approved credit terms apply. First custom-project orders are not eligible for credit terms - to apply, email finance@beyondgreenbiotech.com.',
    'Freight is billed on an actual basis. Report any quality or shortage claims within 7 days of receipt. This sale is subject to the Terms & Conditions of Sale on the following page.',
  ]
  let ny = afterY
  notes.forEach(n => {
    const wrapped = doc.splitTextToSize(n, 330) as string[]
    doc.text(wrapped, L, ny)
    ny += wrapped.length * 11 + 3
  })

  // Total box (right)
  const tbW = 200, tbX = R - tbW, tbY = afterY - 8, tbH = 40
  doc.setDrawColor(0); doc.setLineWidth(0.8)
  doc.rect(tbX, tbY, tbW, tbH)
  doc.setFont('times', 'bold'); doc.setFontSize(16)
  doc.text('Total', tbX + 14, tbY + 26)
  doc.setFontSize(14)
  doc.text('$' + fmtMoney(grand), tbX + tbW - 12, tbY + 26, { align: 'right' })

  // ---- Page 2: Terms & Conditions of Sale ----
  drawTermsPage(doc, order)

  doc.save(`sales-order-${(order.order_number || 'SO').replace(/[^\w.-]+/g, '_')}.pdf`)
}

const SO_TERMS: [string, string][] = [
  ['1. Acceptance', 'This Sales Order and these Terms & Conditions of Sale constitute the entire agreement between beyondGREEN biotech, Inc. ("Seller") and the customer named above ("Buyer") and supersede any prior understandings. Seller\'s acceptance is expressly limited to these terms. Any additional or conflicting terms in Buyer\'s documents are rejected unless expressly agreed to in writing by Seller.'],
  ['2. Prices & Taxes', 'Prices are in U.S. dollars and exclude all sales, use, excise, and similar taxes, duties, and fees, which are the responsibility of Buyer unless a valid exemption certificate is provided. Quoted prices are valid for 30 days unless otherwise stated.'],
  ['3. Payment Terms', 'For custom projects, a 40% deposit is required to confirm and schedule the order, with the remaining balance due at the time of shipment, unless credit terms have been applied for and approved by Seller in writing. Approved credit terms are Net 30 days from the invoice date. First orders for custom projects are not eligible for credit terms. To apply for credit terms, email finance@beyondgreenbiotech.com.'],
  ['4. Deposits', 'Deposits are non-refundable once production has been scheduled or materials have been procured, given the custom, made-to-order nature of the goods.'],
  ['5. Late Payment', 'Past-due balances accrue interest at 1.5% per month (or the maximum rate permitted by law). Buyer is responsible for reasonable costs of collection, including attorneys\' fees. Seller may suspend performance or shipment while any balance is past due.'],
  ['6. Delivery, Title & Risk of Loss', 'Unless otherwise stated on the face of this order, shipments are FOB Origin, Santa Ana, California. Title and risk of loss pass to Buyer upon delivery of the goods to the carrier. Delivery and completion dates are good-faith estimates and are not guaranteed.'],
  ['7. Freight', 'Freight, handling, and insurance are billed to Buyer on an actual basis unless otherwise agreed in writing. Seller may select the carrier and routing absent written instructions from Buyer.'],
  ['8. Inspection & Claims', 'Buyer shall inspect all goods promptly upon receipt. Claims for shortages, defects, damage, or non-conformance must be submitted in writing within 7 days of receipt. Failure to notify Seller within this period constitutes irrevocable acceptance of the goods.'],
  ['9. Cancellation & Returns', 'Custom and made-to-order goods are non-cancellable and non-returnable once production has commenced. Any authorized return of standard stock items requires Seller\'s prior written authorization and may be subject to a restocking fee.'],
  ['10. Limited Warranty', 'Seller warrants that the goods will materially conform to the agreed specifications and be free from defects in material and workmanship under normal use for twelve (12) months from delivery. Buyer\'s sole and exclusive remedy, at Seller\'s option, is the repair, replacement, or refund of the purchase price of non-conforming goods.'],
  ['11. Disclaimer of Warranties', 'EXCEPT AS EXPRESSLY SET FORTH ABOVE, SELLER DISCLAIMS ALL OTHER WARRANTIES, EXPRESS OR IMPLIED, INCLUDING THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE.'],
  ['12. Limitation of Liability', 'Seller\'s total liability arising out of or relating to this order shall not exceed the purchase price of the goods giving rise to the claim. In no event shall Seller be liable for any indirect, incidental, special, punitive, or consequential damages, including lost profits, even if advised of the possibility of such damages.'],
  ['13. Buyer-Supplied Content & Compliance', 'Buyer is responsible for ensuring that any artwork, labeling, dimensions, or specifications it provides are accurate, comply with applicable laws, and do not infringe any third-party rights. Buyer shall indemnify and hold Seller harmless from any claims arising out of Buyer-supplied content or instructions.'],
  ['14. Force Majeure', 'Seller shall not be liable for any delay or failure to perform due to causes beyond its reasonable control, including acts of God, government action, supply or material shortages, labor disputes, utility or transportation interruptions, or public-health events.'],
  ['15. Governing Law', 'This agreement is governed by the laws of the State of California, without regard to its conflict-of-laws principles. The exclusive venue for any dispute shall be the state or federal courts located in Orange County, California. If any provision is held unenforceable, the remaining provisions remain in full force.'],
]

function drawTermsPage(doc: jsPDF, order: PDFOrder) {
  doc.addPage()
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const L = 36, R = W - 36, CW = R - L
  let y = 54
  doc.setTextColor(0, 0, 0)
  doc.setFont('times', 'bold'); doc.setFontSize(15)
  doc.text('Terms & Conditions of Sale', L, y)
  doc.setFont('times', 'normal'); doc.setFontSize(8.5)
  doc.text(`${COMPANY.name}  |  Sales Order ${order.order_number || ''}`.trim(), R, y, { align: 'right' })
  y += 8
  doc.setDrawColor(120, 120, 120); doc.setLineWidth(0.6); doc.line(L, y, R, y)
  y += 16

  const ensure = (need: number) => { if (y + need > H - 60) { doc.addPage(); y = 54 } }

  SO_TERMS.forEach(([title, body]) => {
    doc.setFont('times', 'bold'); doc.setFontSize(9)
    const headLines = doc.splitTextToSize(title, CW) as string[]
    doc.setFont('times', 'normal'); doc.setFontSize(8.5)
    const bodyLines = doc.splitTextToSize(body, CW) as string[]
    ensure(headLines.length * 10.5 + bodyLines.length * 9.8 + 8)
    doc.setFont('times', 'bold'); doc.setFontSize(9)
    doc.text(headLines, L, y); y += headLines.length * 10.5
    doc.setFont('times', 'normal'); doc.setFontSize(8.5)
    doc.text(bodyLines, L, y); y += bodyLines.length * 9.8 + 7
  })

  // Acknowledgement / signature line
  ensure(48)
  y += 6
  doc.setDrawColor(120, 120, 120); doc.setLineWidth(0.5)
  doc.line(L, y, L + 240, y)
  doc.line(R - 150, y, R, y)
  doc.setFont('times', 'normal'); doc.setFontSize(8)
  doc.setTextColor(90, 90, 90)
  doc.text('Accepted & Agreed (Buyer Signature)', L, y + 11)
  doc.text('Date', R - 150, y + 11)

  // Footer
  doc.setFontSize(7.5); doc.setTextColor(120, 120, 120)
  doc.text(`${COMPANY.name}  -  1202 E Wakeham Ave, Santa Ana, CA 92705  -  finance@beyondgreenbiotech.com`, W / 2, H - 30, { align: 'center' })
}

export function generateQuotePDF(
  quote: { quote_number: string; quote_date: string | null; expiry_date: string | null; status: string; tax_pct: number; subtotal: number; total: number; notes?: string | null },
  lines: PDFLine[],
  customer: PDFCustomer | null
) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  header(doc, 'QUOTATION')

  let y = 76
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text(quote.quote_number, 36, y); y += 14
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  if (quote.quote_date) { doc.text(`Date: ${quote.quote_date}`, 36, y); y += 12 }
  if (quote.expiry_date) { doc.text(`Valid Until: ${quote.expiry_date}`, 36, y); y += 12 }
  doc.text(`Status: ${quote.status}`, 36, y)

  if (customer) {
    doc.setFontSize(8)
    doc.setTextColor(...GRAY)
    doc.text('QUOTE TO', W / 2, 76)
    doc.setTextColor(...DARK)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text(customer.company_name, W / 2, 88)
    doc.setFont('helvetica', 'normal')
    let cy = 100
    if (customer.contact_name) { doc.text(customer.contact_name, W / 2, cy); cy += 11 }
    if (customer.email) { doc.text(customer.email, W / 2, cy); cy += 11 }
    if (customer.phone) doc.text(customer.phone, W / 2, cy)
  }

  autoTable(doc, {
    startY: 154,
    head: [['#', 'SKU', 'Description', 'Qty', 'UOM', 'Unit Price', 'Disc%', 'Total']],
    body: lines.map(l => {
      const total = l.quantity * l.unit_price * (1 - l.discount_pct / 100)
      return [l.line_number, l.sku ?? '—', l.description, l.quantity, l.unit_of_measure ?? '—', fmt$(l.unit_price), l.discount_pct ? l.discount_pct + '%' : '—', fmt$(total)]
    }),
    headStyles: { fillColor: GREEN, textColor: [255, 255, 255], fontSize: 9, fontStyle: 'bold' },
    bodyStyles: { fontSize: 9 },
    alternateRowStyles: { fillColor: [246, 250, 247] },
    columnStyles: {
      0: { cellWidth: 24, halign: 'center' },
      1: { cellWidth: 68, font: 'courier', fontSize: 8 },
      3: { cellWidth: 44, halign: 'center' },
      4: { cellWidth: 44 },
      5: { cellWidth: 68, halign: 'right' },
      6: { cellWidth: 44, halign: 'center' },
      7: { cellWidth: 68, halign: 'right' },
    },
  })

  const afterTable = (doc as any).lastAutoTable.finalY + 12
  const tax = quote.subtotal * (quote.tax_pct ?? 0) / 100

  const totals: [string, string][] = [
    ['Subtotal:', fmt$(quote.subtotal)],
    [`Tax (${quote.tax_pct ?? 0}%):`, fmt$(tax)],
    ['TOTAL:', fmt$(quote.total)],
  ]
  let ty = afterTable
  totals.forEach(([label, value], i) => {
    doc.setFontSize(i === 2 ? 10 : 9)
    doc.setFont('helvetica', i === 2 ? 'bold' : 'normal')
    doc.text(label, W - 160, ty)
    doc.text(value, W - 36, ty, { align: 'right' })
    if (i === 1) { doc.setDrawColor(...GRAY); doc.line(W - 160, ty + 4, W - 36, ty + 4) }
    ty += i === 2 ? 0 : 14
  })

  if (quote.notes) {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text('Notes:', 36, afterTable)
    doc.setFont('helvetica', 'normal')
    doc.text(doc.splitTextToSize(quote.notes, (W - 80) / 2) as string[], 36, afterTable + 12)
  }

  doc.setFontSize(8)
  doc.setTextColor(...GRAY)
  doc.text(`Generated ${new Date().toLocaleString()} · beyondGREEN ERP`, W / 2, doc.internal.pageSize.getHeight() - 18, { align: 'center' })

  doc.save(`quote-${quote.quote_number}.pdf`)
}
