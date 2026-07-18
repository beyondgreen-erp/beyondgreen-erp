// Case + pallet label generation (client-side). Uses jsPDF + jsbarcode.
import { jsPDF } from 'jspdf'
import JsBarcode from 'jsbarcode'

export interface LabelOrder { poNumber: string; shipToName: string; shipToAddress: string }
export interface CaseLabel {
  sku: string; description?: string; upcGtin: string | null
  customerPartNumber?: string | null; vendorPartNumber?: string | null
  caseNumber: number; totalCases: number; unitsInCase?: number
  gtinImageDataUrl?: string | null   // uploaded GTIN barcode image (data URL); used instead of generating one
}
export interface PalletLabel { palletNumber: number; totalPallets: number; sscc?: string | null; caseCount: number; weight?: number; skus?: string[]; dims?: string }

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
// Load an image URL (any format the browser can decode — png/jpeg/webp/gif) and re-encode it to a
// clean PNG data URL. jsPDF's addImage only accepts PNG/JPEG, so an uploaded WEBP/other barcode image
// would otherwise fail to embed. Requires the host to allow CORS (Supabase public objects do).
export async function loadBarcodePng(url: string): Promise<string | null> {
  if (typeof document === 'undefined') return null
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth || 600
        canvas.height = img.naturalHeight || 300
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve(null); return }
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0)
        resolve(canvas.toDataURL('image/png'))
      } catch { resolve(null) }
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}
export function missingUpcSkus(cases: CaseLabel[]): string[] {
  const m = new Set<string>()
  for (const c of cases) if (!c.gtinImageDataUrl && (!c.upcGtin || !barcodeFormat(c.upcGtin))) m.add(c.sku)
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
    // Prefer the uploaded GTIN barcode image; if it can't be embedded, fall back to a barcode
    // generated from the UPC/GTIN number so the label is never left blank.
    const genBarcode = barcodeDataUrl(c.upcGtin || '')
    const bw = 2.7, bh = 1.15
    let placed = false
    const primary = c.gtinImageDataUrl || genBarcode
    if (primary) {
      doc.setDrawColor(0); doc.setLineWidth(0.03)
      doc.rect(cx - bw / 2 - 0.12, y, bw + 0.24, bh + 0.18)
      try { doc.addImage(primary, 'PNG', cx - bw / 2, y + 0.09, bw, bh); placed = true } catch { /* unsupported image — try the generated barcode below */ }
      if (!placed && genBarcode && genBarcode !== primary) {
        try { doc.addImage(genBarcode, 'PNG', cx - bw / 2, y + 0.09, bw, bh); placed = true } catch { /* */ }
      }
    }
    if (!placed) {
      doc.setDrawColor(180); doc.rect(cx - bw / 2 - 0.12, y, bw + 0.24, bh + 0.18)
      doc.setFontSize(10); doc.setTextColor(170, 0, 0)
      doc.text('UPC / GTIN MISSING', cx, y + bh / 2 + 0.1, { align: 'center' }); doc.setTextColor(0, 0, 0)
    }
    y += bh + 0.34
    ctext(doc, `VENDOR PART # ${c.vendorPartNumber || c.sku}`, cx, y, 12.5, 'bold', maxW, 0.2)
  })
  return doc
}

export function buildPalletLabels(order: LabelOrder, pallets: PalletLabel[], docsQr?: string | null): jsPDF {
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
    if (p.dims) y = ctext(doc, p.dims, cx, y, 12, 'normal', maxW, 0.22)
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
    // Docs QR (top-right corner) — scanning opens the packing slip + BOL only.
    if (docsQr) {
      try {
        const q = 0.82
        doc.addImage(docsQr, 'PNG', W - q - 0.15, 0.12, q, q)
        doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5)
        doc.text('SCAN: DOCS', W - q / 2 - 0.15, 0.12 + q + 0.09, { align: 'center' })
      } catch { /* */ }
    }
  })
  return doc
}
