// Case + pallet label generation (client-side). Uses jsPDF + jsbarcode.
import { jsPDF } from 'jspdf'
import JsBarcode from 'jsbarcode'

export interface LabelOrder { poNumber: string; shipToName: string; shipToAddress: string }
export interface CaseLabel {
  sku: string; description?: string; upcGtin: string | null
  customerPartNumber?: string | null; vendorPartNumber?: string | null
  caseNumber: number; totalCases: number; unitsInCase?: number
}
export interface PalletLabel { palletNumber: number; totalPallets: number; sscc?: string | null; caseCount: number; weight?: number; skus?: string[] }

const SHIP_FROM = ['BEYONDGREEN BIOTECH, INC.', '1202 E. WAKEHAM AVE.,', 'SANTA ANA, CA 92705']
const digitsOnly = (s: string) => (s || '').replace(/[^0-9]/g, '')

function barcodeFormat(code: string): string | null {
  const d = digitsOnly(code)
  if (d.length === 12) return 'UPC'
  if (d.length === 13) return 'EAN13'
  if (d.length === 8) return 'EAN8'
  if (d.length >= 6) return 'CODE128'
  return null
}
function barcodeDataUrl(value: string): string | null {
  const fmt = barcodeFormat(value)
  if (!fmt || typeof document === 'undefined') return null
  try {
    const canvas = document.createElement('canvas')
    JsBarcode(canvas, fmt === 'CODE128' ? value : digitsOnly(value), { format: fmt, width: 2, height: 90, displayValue: true, fontSize: 20, textMargin: 2, margin: 4 })
    return canvas.toDataURL('image/png')
  } catch { return null }
}
export function missingUpcSkus(cases: CaseLabel[]): string[] {
  const m = new Set<string>()
  for (const c of cases) if (!c.upcGtin || !barcodeFormat(c.upcGtin)) m.add(c.sku)
  return [...m]
}

// centered wrapped text; returns new y
function ctext(doc: jsPDF, s: string, cx: number, y: number, size: number, style: 'bold' | 'normal', maxW: number, lh: number): number {
  doc.setFont('helvetica', style); doc.setFontSize(size)
  const lines = doc.splitTextToSize(s, maxW) as string[]
  lines.forEach(l => { doc.text(l, cx, y, { align: 'center' }); y += lh })
  return y
}

export function buildCaseLabels(order: LabelOrder, cases: CaseLabel[]): jsPDF {
  const W = 4, H = 6
  const doc = new jsPDF({ unit: 'in', format: [W, H], orientation: 'portrait' })
  const cx = W / 2, maxW = W - 0.4
  cases.forEach((c, idx) => {
    if (idx > 0) doc.addPage([W, H], 'portrait')
    let y = 0.32
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5)
    SHIP_FROM.forEach(l => { doc.text(l, cx, y, { align: 'center' }); y += 0.17 })
    y += 0.16
    y = ctext(doc, 'SHIP TO:', cx, y, 12, 'bold', maxW, 0.22)
    y = ctext(doc, order.shipToName.toUpperCase(), cx, y, 12.5, 'bold', maxW, 0.22)
    y = ctext(doc, order.shipToAddress.replace(/\n/g, ', '), cx, y, 10.5, 'normal', maxW, 0.19)
    y += 0.14
    y = ctext(doc, `PO# ${order.poNumber || '-'}`, cx, y, 21, 'bold', maxW, 0.32)
    y += 0.06
    y = ctext(doc, `Case ${c.caseNumber} of ${c.totalCases}`, cx, y, 16, 'bold', maxW, 0.28)
    y = ctext(doc, `PART # ${c.customerPartNumber || c.sku}`, cx, y, 11.5, 'bold', maxW, 0.22)
    y += 0.06
    const img = barcodeDataUrl(c.upcGtin || '')
    const bw = 2.7, bh = 1.15
    if (img) {
      doc.setDrawColor(0); doc.setLineWidth(0.03)
      doc.rect(cx - bw / 2 - 0.12, y, bw + 0.24, bh + 0.18)
      doc.addImage(img, 'PNG', cx - bw / 2, y + 0.09, bw, bh)
    } else {
      doc.setDrawColor(180); doc.rect(cx - bw / 2 - 0.12, y, bw + 0.24, bh + 0.18)
      doc.setFontSize(10); doc.setTextColor(170, 0, 0)
      doc.text('UPC / GTIN MISSING', cx, y + bh / 2 + 0.1, { align: 'center' }); doc.setTextColor(0, 0, 0)
    }
    y += bh + 0.34
    ctext(doc, `VENDOR PART # ${c.vendorPartNumber || c.sku}`, cx, y, 12.5, 'bold', maxW, 0.2)
  })
  return doc
}

export function buildPalletLabels(order: LabelOrder, pallets: PalletLabel[]): jsPDF {
  const W = 4, H = 6
  const doc = new jsPDF({ unit: 'in', format: [W, H], orientation: 'portrait' })
  const cx = W / 2, maxW = W - 0.4
  pallets.forEach((p, idx) => {
    if (idx > 0) doc.addPage([W, H], 'portrait')
    let y = 0.4
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5)
    SHIP_FROM.forEach(l => { doc.text(l, cx, y, { align: 'center' }); y += 0.17 })
    y += 0.18
    y = ctext(doc, 'SHIP TO:', cx, y, 12, 'bold', maxW, 0.22)
    y = ctext(doc, order.shipToName.toUpperCase(), cx, y, 12.5, 'bold', maxW, 0.22)
    y = ctext(doc, order.shipToAddress.replace(/\n/g, ', '), cx, y, 10.5, 'normal', maxW, 0.19)
    y += 0.16
    y = ctext(doc, `PO# ${order.poNumber || '-'}`, cx, y, 20, 'bold', maxW, 0.34)
    y += 0.08
    y = ctext(doc, `PALLET ${p.palletNumber} of ${p.totalPallets}`, cx, y, 26, 'bold', maxW, 0.42)
    y += 0.06
    y = ctext(doc, `Cases: ${p.caseCount}${p.weight ? '    Weight: ' + Math.round(p.weight) + ' lb' : ''}`, cx, y, 13, 'normal', maxW, 0.24)
    y += 0.12
    const id = p.sscc || `PLT-${order.poNumber}-${p.palletNumber}`
    if (typeof document !== 'undefined') {
      try {
        const canvas = document.createElement('canvas')
        JsBarcode(canvas, id, { format: 'CODE128', width: 2, height: 110, displayValue: true, fontSize: 16, margin: 4 })
        const bw = 3.2, bh = 1.35
        doc.addImage(canvas.toDataURL('image/png'), 'PNG', cx - bw / 2, y, bw, bh)
      } catch { /* */ }
    }
  })
  return doc
}
