/* eslint-disable @typescript-eslint/no-explicit-any */
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export interface CostingQuoteHeader {
  quote_number: string
  quote_date: string | null
  valid_until: string | null
  prepared_by: string | null
  customer_name: string | null
  customer_contact?: string | null
  customer_email?: string | null
  notes?: string | null
  include_freight_disclaimer?: boolean
}

export interface CostingQuoteLine {
  line_number: number
  description: string
  product_type?: string | null
  specs?: string | null
  country_of_origin: string
  freight_method: string
  uom: string
  moq_qty: number
  order_qty: number
  packing_per_case: number
  selling_price_per_case: number
  selling_price_per_piece: number
  needs_freight_disclaimer?: boolean
}

export interface CostingQuoteInternal extends CostingQuoteLine {
  exw_cost_per_case: number
  freight_cost_per_case: number
  china_tariff_25_pct: number
  duty_10_pct: number
  mpf: number
  hmf: number
  total_duties_per_case: number
  total_cost_per_case: number
  cost_per_piece: number
  markup_pct: number
  profit_per_case: number
  profit_margin_pct: number
  total_profit: number
  total_income: number
}

const DARK_GREEN: [number, number, number] = [20, 120, 60]
const DARK: [number, number, number] = [20, 20, 20]
const GRAY: [number, number, number] = [100, 100, 100]
const LIGHT_GRAY: [number, number, number] = [245, 245, 245]
const WHITE: [number, number, number] = [255, 255, 255]
const AMBER: [number, number, number] = [180, 83, 9]

const fmt$ = (n: number) => '$' + n.toFixed(2)
const fmtN = (n: number) => n.toLocaleString()
const fmtDate = (d: string | null) => {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function addPageFooter(doc: jsPDF, pageNum: number, totalPages: number) {
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  doc.setDrawColor(200, 200, 200)
  doc.setLineWidth(0.5)
  doc.line(36, H - 36, W - 36, H - 36)
  doc.setFontSize(8)
  doc.setTextColor(...GRAY)
  doc.setFont('helvetica', 'normal')
  doc.text('beyondGREEN biotech, Inc.  |  Santa Ana, CA  |  beyondgreenbiotech.com  |  (866) 364-9466', W / 2, H - 22, { align: 'center' })
  doc.text(`Page ${pageNum} of ${totalPages}`, W - 36, H - 22, { align: 'right' })
}

function buildHeader(doc: jsPDF, quote: CostingQuoteHeader) {
  const W = doc.internal.pageSize.getWidth()

  // Green header bar
  doc.setFillColor(...DARK_GREEN)
  doc.rect(0, 0, W, 70, 'F')

  // Company info (white on green)
  doc.setTextColor(...WHITE)
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('beyondGREEN biotech, Inc.', 36, 28)

  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'normal')
  doc.text('1202 E. Wakeham Ave., Santa Ana, CA 92705', 36, 40)
  doc.text('(866) 364-9466  |  info@beyondgreenbiotech.com  |  beyondgreenbiotech.com', 36, 50)

  // Quote title right-aligned
  doc.setFontSize(22)
  doc.setFont('helvetica', 'bold')
  doc.text('PRICE QUOTATION', W - 36, 28, { align: 'right' })

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(`Quote #: ${quote.quote_number}`, W - 36, 40, { align: 'right' })
  doc.text(`Date: ${fmtDate(quote.quote_date)}`, W - 36, 50, { align: 'right' })
  if (quote.valid_until) {
    doc.text(`Valid Until: ${fmtDate(quote.valid_until)}`, W - 36, 60, { align: 'right' })
  }

  doc.setTextColor(...DARK)

  // Prepared for / by section
  let y = 88
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...GRAY)
  doc.text('PREPARED FOR:', 36, y)
  doc.text('PREPARED BY:', W / 2 + 10, y)

  doc.setTextColor(...DARK)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  y += 12
  doc.text(quote.customer_name || 'N/A', 36, y)
  doc.text(quote.prepared_by || 'beyondGREEN Sales Team', W / 2 + 10, y)
  if (quote.customer_contact) { y += 12; doc.text(quote.customer_contact, 36, y) }
  if (quote.customer_email) { y += 12; doc.text(quote.customer_email, 36, y) }
  y += 10
  doc.text('beyondGREEN biotech, Inc.', W / 2 + 10, 100 + 12)
  doc.text('(866) 364-9466', W / 2 + 10, 100 + 24)

  return Math.max(y, 140) + 10
}

export function generateCustomerCostingPDF(
  quote: CostingQuoteHeader,
  lines: CostingQuoteLine[]
) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' })
  const W = doc.internal.pageSize.getWidth()

  const startY = buildHeader(doc, quote)
  const hasOverseas = lines.some(l => l.freight_method === 'OCEAN' || l.freight_method === 'AIR')

  // Items table — customer-facing (no internal costs)
  const tableRows = lines.map(l => [
    l.line_number,
    [l.description, l.specs ? `  ${l.specs}` : ''].filter(Boolean).join('\n'),
    l.country_of_origin,
    l.freight_method,
    fmtN(l.moq_qty) || '—',
    fmtN(l.packing_per_case) || '—',
    fmt$(l.selling_price_per_case),
    fmt$(l.selling_price_per_piece),
    l.uom,
  ])

  autoTable(doc, {
    startY,
    head: [['#', 'Product Description', 'Origin', 'Freight', 'MOQ Cases', 'Pcs/Case', 'Price/Case', 'Price/Piece', 'UOM']],
    body: tableRows,
    theme: 'grid',
    headStyles: { fillColor: DARK_GREEN, textColor: WHITE, fontSize: 8, fontStyle: 'bold', cellPadding: 5 },
    bodyStyles: { fontSize: 8.5, cellPadding: 5, textColor: DARK },
    alternateRowStyles: { fillColor: LIGHT_GRAY },
    columnStyles: {
      0: { cellWidth: 25, halign: 'center' },
      1: { cellWidth: 200 },
      2: { cellWidth: 55, halign: 'center' },
      3: { cellWidth: 55, halign: 'center' },
      4: { cellWidth: 60, halign: 'right' },
      5: { cellWidth: 55, halign: 'right' },
      6: { cellWidth: 70, halign: 'right', fontStyle: 'bold' },
      7: { cellWidth: 70, halign: 'right' },
      8: { cellWidth: 45, halign: 'center' },
    },
    margin: { left: 36, right: 36 },
    didParseCell: (data: any) => {
      if (data.section === 'body' && data.column.index === 6) {
        data.cell.styles.fillColor = [220, 252, 231]
      }
    },
  })

  const afterTable = (doc as any).lastAutoTable.finalY + 20

  // Pricing summary
  const totalSell = lines.reduce((s, l) => s + l.selling_price_per_case * l.order_qty, 0)
  const totalCases = lines.reduce((s, l) => s + l.order_qty, 0)

  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...DARK)
  doc.text('PRICING SUMMARY', W - 200, afterTable)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.text(`Total Cases Ordered: ${fmtN(totalCases)}`, W - 200, afterTable + 14)
  doc.text(`Total Order Value: ${fmt$(totalSell)}`, W - 200, afterTable + 26)

  let disclaimerY = afterTable + 50

  // Notes
  if (quote.notes) {
    doc.setFontSize(8.5)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...DARK)
    doc.text('NOTES:', 36, disclaimerY)
    doc.setFont('helvetica', 'normal')
    const noteLines = doc.splitTextToSize(quote.notes, W - 72)
    doc.text(noteLines, 36, disclaimerY + 12)
    disclaimerY += 12 + noteLines.length * 12 + 10
  }

  // Freight disclaimer
  if (hasOverseas && quote.include_freight_disclaimer !== false) {
    // Check if we need a new page
    if (disclaimerY > doc.internal.pageSize.getHeight() - 200) {
      doc.addPage()
      disclaimerY = 50
    }

    doc.setFillColor(255, 251, 235)
    doc.setDrawColor(...AMBER)
    doc.setLineWidth(0.5)
    const boxH = 175
    doc.roundedRect(36, disclaimerY, W - 72, boxH, 4, 4, 'FD')

    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...AMBER)
    doc.text('IMPORTANT NOTICE — PRICING DISCLAIMER', 46, disclaimerY + 14)

    doc.setFont('helvetica', 'normal')
    doc.setTextColor(92, 60, 15)
    doc.setFontSize(8)

    const disclaimerText = [
      `All prices quoted herein are based on current market conditions as of ${fmtDate(quote.quote_date)}.`,
      '',
      '• All pricing is FOB beyondGREEN biotech, Inc., 1202 E. Wakeham Ave., Santa Ana, CA 92705',
      '• Prices for imported goods are subject to change based on:',
      '    - Actual freight costs at time of order',
      '    - Currency exchange rate fluctuations',
      '    - Changes in import duties, tariffs, or government regulations',
      '    - Fuel surcharges and port fees',
      `• This quotation is valid for 30 days from the date of issue`,
      '• Final pricing will be confirmed upon receipt of purchase order and verification of current freight rates',
      '',
      'beyondGREEN biotech, Inc. reserves the right to adjust pricing to reflect actual landed costs at time of shipment.',
    ]

    let textY = disclaimerY + 26
    disclaimerText.forEach(line => {
      doc.text(line, 46, textY)
      textY += 10
    })

    disclaimerY += boxH + 16
  }

  // Terms
  if (disclaimerY > doc.internal.pageSize.getHeight() - 120) {
    doc.addPage()
    disclaimerY = 50
  }

  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...DARK)
  doc.text('TERMS & CONDITIONS', 36, disclaimerY)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...GRAY)
  const terms = [
    'Payment Terms: Net 30 (or as agreed upon)',
    'Lead Time: 12–16 weeks for overseas items; 2–4 weeks for domestic',
    'Minimum Order: As quoted per item above',
    'All prices in USD',
  ]
  terms.forEach((t, i) => {
    doc.text(`• ${t}`, 36, disclaimerY + 12 + i * 11)
  })

  // Add footers to all pages
  const totalPages = (doc as any).internal.getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    addPageFooter(doc, i, totalPages)
  }

  doc.save(`${quote.quote_number || 'quote'}-customer.pdf`)
}

export function generateInternalCostingPDF(
  quote: CostingQuoteHeader,
  lines: CostingQuoteInternal[]
) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' })
  const W = doc.internal.pageSize.getWidth()

  const startY = buildHeader(doc, quote)

  // Internal confidential banner
  doc.setFillColor(30, 30, 30)
  doc.rect(36, startY - 10, W - 72, 18, 'F')
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(255, 80, 80)
  doc.text('⚠  INTERNAL DOCUMENT — CONFIDENTIAL — DO NOT SHARE WITH CUSTOMERS', W / 2, startY + 2, { align: 'center' })

  const tableRows = lines.map(l => [
    l.line_number,
    l.description,
    l.country_of_origin,
    l.freight_method,
    fmtN(l.order_qty),
    fmtN(l.packing_per_case),
    fmt$(l.exw_cost_per_case),
    fmt$(l.freight_cost_per_case),
    fmt$(l.total_duties_per_case),
    fmt$(l.total_cost_per_case),
    `${l.markup_pct.toFixed(0)}%`,
    fmt$(l.selling_price_per_case),
    fmt$(l.selling_price_per_piece),
    `${l.profit_margin_pct.toFixed(1)}%`,
    fmt$(l.total_profit),
  ])

  autoTable(doc, {
    startY: startY + 14,
    head: [['#', 'Description', 'Origin', 'Freight', 'Cases', 'Pcs/Cs', 'EXW/Cs', 'Freight/Cs', 'Duties/Cs', 'Total Cost', 'Markup', 'Sell/Cs', 'Sell/Pc', 'Margin%', 'Total Profit']],
    body: tableRows,
    theme: 'grid',
    headStyles: { fillColor: [30, 30, 30], textColor: WHITE, fontSize: 7, fontStyle: 'bold', cellPadding: 4 },
    bodyStyles: { fontSize: 7.5, cellPadding: 4, textColor: DARK },
    alternateRowStyles: { fillColor: LIGHT_GRAY },
    columnStyles: {
      0: { cellWidth: 20, halign: 'center' },
      1: { cellWidth: 130 },
      2: { cellWidth: 40, halign: 'center' },
      3: { cellWidth: 45, halign: 'center' },
      4: { cellWidth: 38, halign: 'right' },
      5: { cellWidth: 40, halign: 'right' },
      6: { cellWidth: 52, halign: 'right' },
      7: { cellWidth: 52, halign: 'right' },
      8: { cellWidth: 52, halign: 'right' },
      9: { cellWidth: 58, halign: 'right', fontStyle: 'bold' },
      10: { cellWidth: 40, halign: 'center' },
      11: { cellWidth: 52, halign: 'right', fontStyle: 'bold' },
      12: { cellWidth: 45, halign: 'right' },
      13: { cellWidth: 45, halign: 'right' },
      14: { cellWidth: 60, halign: 'right' },
    },
    margin: { left: 36, right: 36 },
    didParseCell: (data: any) => {
      if (data.section === 'body' && data.column.index === 13) {
        const val = parseFloat(String(data.cell.raw).replace('%', ''))
        if (val >= 40) data.cell.styles.textColor = [16, 120, 60]
        else if (val >= 25) data.cell.styles.textColor = [146, 64, 14]
        else data.cell.styles.textColor = [185, 28, 28]
      }
    },
  })

  const fy = (doc as any).lastAutoTable.finalY + 20
  const totalCost = lines.reduce((s, l) => s + l.total_cost_per_case * l.order_qty, 0)
  const totalSell = lines.reduce((s, l) => s + l.selling_price_per_case * l.order_qty, 0)
  const totalProfit = lines.reduce((s, l) => s + l.total_profit, 0)
  const avgMargin = totalSell > 0 ? (totalProfit / totalSell) * 100 : 0

  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...DARK)
  const cols = [
    ['Total Landed Cost', fmt$(totalCost)],
    ['Total Selling Price', fmt$(totalSell)],
    ['Total Profit', fmt$(totalProfit)],
    ['Overall Margin', `${avgMargin.toFixed(1)}%`],
  ]
  let sx = 36
  cols.forEach(([label, val]) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...GRAY)
    doc.text(label, sx, fy)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...DARK)
    doc.text(val, sx, fy + 14)
    sx += 130
  })

  const totalPages = (doc as any).internal.getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    addPageFooter(doc, i, totalPages)
  }

  doc.save(`${quote.quote_number || 'quote'}-internal-costing.pdf`)
}
