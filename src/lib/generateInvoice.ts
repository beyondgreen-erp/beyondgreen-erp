/* eslint-disable @typescript-eslint/no-explicit-any */
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const GREEN: [number,number,number] = [16,185,129]
const DARK: [number,number,number] = [17,24,39]
const GRAY: [number,number,number] = [107,114,128]
const RED: [number,number,number] = [239,68,68]
const fmt$ = (n: number) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n)
const fmtD = (d: string|null|undefined) => d ? new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) : '—'

export interface InvoiceData {
  invoice_number_display?: string | null
  invoice_number?: string
  invoice_type?: string
  invoice_date?: string | null
  due_date?: string | null
  status?: string
  subtotal?: number
  tax_rate?: number
  tax_amount?: number
  total_amount?: number
  amount?: number
  amount_paid?: number
  balance_due?: number
  payment_terms?: string | null
  po_number?: string | null
  notes?: string | null
}

export interface InvoiceCustomer {
  company_name: string
  email?: string | null
  phone?: string | null
  billing_address?: string | null
  contact_name?: string | null
}

export interface InvoiceLine {
  sku?: string | null
  description: string
  quantity: number
  unit_price: number
  uom?: string | null
  line_total?: number
}

export function generateInvoicePDF(
  invoice: InvoiceData,
  customer: InvoiceCustomer | null,
  lines: InvoiceLine[],
  orderNumber?: string | null
) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const isProforma = invoice.invoice_type === 'proforma'
  const invNum = invoice.invoice_number_display ?? invoice.invoice_number ?? '—'
  const total = invoice.total_amount ?? invoice.amount ?? 0
  const paid = invoice.amount_paid ?? 0
  const balance = invoice.balance_due ?? (total - paid)

  // ── Header band ──────────────────────────────────────────────
  doc.setFillColor(...GREEN)
  doc.rect(0, 0, W, 42, 'F')

  // Company name
  doc.setTextColor(255,255,255)
  doc.setFontSize(20)
  doc.setFont('helvetica','bold')
  doc.text('beyondGREEN biotech', 14, 16)

  doc.setFontSize(8)
  doc.setFont('helvetica','normal')
  doc.setTextColor(220,255,240)
  doc.text('1202 E. Wakeham Ave.  ·  Santa Ana, CA 92705', 14, 22)
  doc.text('(866) 364-9466  ·  beyondgreenbiotech.com', 14, 27)

  // Invoice title (right side)
  doc.setTextColor(255,255,255)
  doc.setFontSize(22)
  doc.setFont('helvetica','bold')
  const title = isProforma ? 'PROFORMA INVOICE' : 'INVOICE'
  doc.text(title, W - 14, 18, { align: 'right' })
  doc.setFontSize(9)
  doc.setFont('helvetica','normal')
  doc.setTextColor(220,255,240)
  doc.text(`#${invNum}`, W - 14, 25, { align: 'right' })
  doc.text(`Date: ${fmtD(invoice.invoice_date)}`, W - 14, 30, { align: 'right' })
  doc.text(`Due: ${fmtD(invoice.due_date)}`, W - 14, 35, { align: 'right' })

  // ── Status badge ─────────────────────────────────────────────
  const statusColors: Record<string,[number,number,number]> = {
    paid:[16,185,129], overdue:[239,68,68], pending:[245,158,11],
    partial:[59,130,246], proforma:[107,114,128], void:[75,85,99],
  }
  const st = (invoice.status ?? 'pending').toLowerCase()
  const sc = statusColors[st] ?? [107,114,128]
  doc.setFillColor(...sc)
  doc.roundedRect(W - 50, 4, 36, 8, 2, 2, 'F')
  doc.setTextColor(255,255,255)
  doc.setFontSize(7)
  doc.setFont('helvetica','bold')
  doc.text(st.toUpperCase(), W - 32, 9, { align: 'center' })

  let y = 52

  // ── Bill To + Order Details ───────────────────────────────────
  doc.setTextColor(...DARK)
  doc.setFontSize(8)
  doc.setFont('helvetica','bold')
  doc.setTextColor(...GRAY)
  doc.text('BILL TO', 14, y)
  doc.text('ORDER DETAILS', W/2, y)
  y += 4

  doc.setTextColor(...DARK)
  doc.setFont('helvetica','bold')
  doc.setFontSize(10)
  doc.text(customer?.company_name ?? '—', 14, y)

  // Order details right column
  doc.setFontSize(8)
  doc.setFont('helvetica','normal')
  doc.setTextColor(...GRAY)
  const details = [
    ['PO Number:', invoice.po_number ?? '—'],
    ['Sales Order:', orderNumber ?? '—'],
    ['Payment Terms:', invoice.payment_terms ?? 'Net 30'],
  ]
  let dy = y
  for (const [label, val] of details) {
    doc.setFont('helvetica','bold'); doc.text(label, W/2, dy); doc.setFont('helvetica','normal')
    doc.setTextColor(...DARK); doc.text(val, W/2 + 28, dy); doc.setTextColor(...GRAY)
    dy += 5
  }

  y += 5
  doc.setFontSize(9)
  doc.setFont('helvetica','normal')
  doc.setTextColor(...DARK)
  if (customer?.contact_name) { doc.text(customer.contact_name, 14, y); y += 4 }
  if (customer?.billing_address) {
    const addrLines = doc.splitTextToSize(customer.billing_address, 80) as string[]
    addrLines.forEach((l: string) => { doc.text(l, 14, y); y += 4 })
  }
  if (customer?.email) { doc.setTextColor(...GRAY); doc.text(customer.email, 14, y); y += 4 }
  if (customer?.phone) { doc.text(customer.phone, 14, y); y += 4 }
  doc.setTextColor(...DARK)

  y = Math.max(y, dy) + 6

  // ── Line items ────────────────────────────────────────────────
  const tableRows = lines.length > 0
    ? lines.map((l, i) => [
        String(i + 1),
        l.sku ?? '—',
        l.description,
        String(l.quantity),
        l.uom ?? 'EA',
        fmt$(l.unit_price),
        fmt$(l.line_total ?? l.quantity * l.unit_price),
      ])
    : [['—', '—', 'See shipment/order details', '—', '—', '—', fmt$(total)]]

  autoTable(doc, {
    startY: y,
    head: [['#','SKU','Description','Qty','UOM','Unit Price','Total']],
    body: tableRows,
    theme: 'grid',
    headStyles: { fillColor: DARK, textColor: [255,255,255], fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, textColor: DARK },
    alternateRowStyles: { fillColor: [248,250,252] },
    columnStyles: {
      0: { cellWidth: 8 }, 1: { cellWidth: 22 }, 2: { cellWidth: 68 },
      3: { cellWidth: 12, halign: 'right' }, 4: { cellWidth: 14, halign: 'center' },
      5: { cellWidth: 24, halign: 'right' }, 6: { cellWidth: 24, halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: 14, right: 14 },
  })

  y = (doc as any).lastAutoTable.finalY + 6

  // ── Totals ────────────────────────────────────────────────────
  const sub = invoice.subtotal ?? total
  const taxR = invoice.tax_rate ?? 0
  const taxA = invoice.tax_amount ?? 0

  const totals: [string, string, boolean, boolean][] = [
    ['Subtotal', fmt$(sub), false, false],
    [`Tax (${taxR}%)`, fmt$(taxA), false, false],
    ['Total', fmt$(total), true, false],
    ['Amount Paid', fmt$(paid), false, false],
    ['Balance Due', fmt$(balance), true, balance > 0],
  ]
  let ty = y
  for (const [label, val, bold, isRed] of totals) {
    const lx = W - 70, vx = W - 14
    if (bold) {
      doc.setDrawColor(...(isRed ? RED : GREEN))
      doc.setLineWidth(0.4)
      doc.line(lx - 2, ty - 3, W - 12, ty - 3)
    }
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(bold ? 10 : 8)
    doc.setTextColor(...(isRed ? RED : DARK))
    doc.text(label, lx, ty)
    doc.text(val, vx, ty, { align: 'right' })
    ty += bold ? 7 : 5
  }

  y = Math.max(ty, y) + 4

  // ── Payment info ──────────────────────────────────────────────
  if (y < 220) {
    doc.setFontSize(8)
    doc.setFont('helvetica','bold')
    doc.setTextColor(...GRAY)
    doc.text('PAYMENT INFORMATION', 14, y)
    y += 5
    doc.setFont('helvetica','normal')
    doc.setTextColor(...DARK)
    doc.text('Please remit payment to: beyondGREEN biotech', 14, y); y += 4
    doc.text(`Reference: ${invNum}`, 14, y); y += 4
    if (invoice.notes) {
      const nl = doc.splitTextToSize(invoice.notes, W - 28) as string[]
      nl.forEach((l: string) => { doc.text(l, 14, y); y += 4 })
    }
  }

  // ── Proforma watermark ────────────────────────────────────────
  if (isProforma) {
    doc.saveGraphicsState()
    doc.setGState(new (doc as any).GState({ opacity: 0.07 }))
    doc.setTextColor(0,0,0)
    doc.setFontSize(52)
    doc.setFont('helvetica','bold')
    doc.text('PROFORMA', W/2, 160, { align: 'center', angle: 45 })
    doc.text('NOT A FINAL INVOICE', W/2, 200, { align: 'center', angle: 45 })
    doc.restoreGraphicsState()
  }

  // ── Footer ────────────────────────────────────────────────────
  const fY = doc.internal.pageSize.getHeight() - 12
  doc.setFillColor(...GREEN)
  doc.rect(0, fY - 4, W, 16, 'F')
  doc.setTextColor(255,255,255)
  doc.setFontSize(8)
  doc.setFont('helvetica','normal')
  doc.text('Thank you for your business!', W/2, fY + 1, { align: 'center' })
  doc.text('Questions? Contact finance@beyondgreenbiotech.com', W/2, fY + 5, { align: 'center' })

  doc.save(`${invNum}.pdf`)
}
