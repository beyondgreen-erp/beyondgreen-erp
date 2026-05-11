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
}

export interface PDFCustomer {
  company_name: string
  email?: string | null
  phone?: string | null
  billing_address?: string | null
  contact_name?: string | null
}

const GREEN: [number, number, number] = [16, 185, 129]
const DARK: [number, number, number] = [20, 20, 20]
const GRAY: [number, number, number] = [120, 120, 120]
const fmt$ = (n: number) => '$' + n.toFixed(2)

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

export function generateOrderPDF(
  order: PDFOrder,
  lines: PDFLine[],
  customer: PDFCustomer | null
) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  header(doc, 'SALES ORDER')

  let y = 76
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text(order.order_number, 36, y); y += 14
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  if (order.order_date) { doc.text(`Order Date: ${order.order_date}`, 36, y); y += 12 }
  if (order.required_ship_date) { doc.text(`Required Ship: ${order.required_ship_date}`, 36, y); y += 12 }
  if (order.po_number) { doc.text(`PO #: ${order.po_number}`, 36, y); y += 12 }
  doc.text(`Status: ${order.status}`, 36, y)

  if (customer) {
    doc.setFontSize(8)
    doc.setTextColor(...GRAY)
    doc.text('BILL TO', W / 2, 76)
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
  const tax = order.subtotal * (order.tax_pct ?? 0) / 100

  const totals: [string, string][] = [
    ['Subtotal:', fmt$(order.subtotal)],
    [`Tax (${order.tax_pct ?? 0}%):`, fmt$(tax)],
    ['TOTAL:', fmt$(order.total)],
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

  if (order.shipping_address) {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text('Ship To:', 36, afterTable)
    doc.setFont('helvetica', 'normal')
    doc.text(doc.splitTextToSize(order.shipping_address, (W - 80) / 2) as string[], 36, afterTable + 12)
  } else if (order.notes) {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text('Notes:', 36, afterTable)
    doc.setFont('helvetica', 'normal')
    doc.text(doc.splitTextToSize(order.notes, (W - 80) / 2) as string[], 36, afterTable + 12)
  }

  doc.setFontSize(8)
  doc.setTextColor(...GRAY)
  doc.text(`Generated ${new Date().toLocaleString()} · beyondGREEN ERP`, W / 2, doc.internal.pageSize.getHeight() - 18, { align: 'center' })
  doc.save(`order-${order.order_number}.pdf`)
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
