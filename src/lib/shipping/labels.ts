// Case + pallet label generation (client-side). Uses jsPDF + jsbarcode.
// Case label layout matches the beyondGREEN / Imperial Dade ("Rebel Hen") example:
// ship-from header, SHIP TO, PO#, "Case X of N", customer part #, UPC-A barcode, vendor part #.
import { jsPDF } from 'jspdf'
import JsBarcode from 'jsbarcode'

export interface LabelOrder {
  poNumber: string
  shipToName: string
  shipToAddress: string   // multi-line allowed via \n
}

export interface CaseLabel {
  sku: string
  description?: string
  upcGtin: string | null
  customerPartNumber?: string | null
  vendorPartNumber?: string | null
  caseNumber: number
  totalCases: number
  unitsInCase?: number
}

export interface PalletLabel {
  palletNumber: number
  totalPallets: number
  sscc?: string | null
  caseCount: number
  weight?: number
  skus?: string[]
}

const SHIP_FROM = ['BEYONDGREEN BIOTECH, INC.', '1202 E. WAKEHAM AVE.,', 'SANTA ANA, CA 92705']

function digitsOnly(s: string): string {
  return (s || '').replace(/[^0-9]/g, '')
}

// Pick a valid symbology for the stored UPC/GTIN.
function barcodeFormat(code: string): string | null {
  const d = digitsOnly(code)
  if (d.length === 12) return 'UPC'
  if (d.length === 13) return 'EAN13'
  if (d.length === 8) return 'EAN8'
  if (d.length >= 6) return 'CODE128'
  return null
}

// Render a barcode to a PNG data URL using an offscreen canvas.
function barcodeDataUrl(value: string, opts?: { height?: number; fontSize?: number; width?: number }): string | null {
  const fmt = barcodeFormat(value)
  if (!fmt) return null
  try {
    const canvas = document.createElement('canvas')
    JsBarcode(canvas, fmt === 'CODE128' ? value : digitsOnly(value), {
      format: fmt,
      width: opts?.width ?? 2,
      height: opts?.height ?? 90,
      displayValue: true,
      fontSize: opts?.fontSize ?? 18,
      textMargin: 2,
      margin: 4,
    })
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

// SKUs missing a scannable UPC/GTIN. Callers should block and prompt the user.
export function missingUpcSkus(cases: CaseLabel[]): string[] {
  const missing = new Set<string>()
  for (const c of cases) {
    if (!c.upcGtin || !barcodeFormat(c.upcGtin)) missing.add(c.sku)
  }
  return [...missing]
}

// 4x6 inch thermal label, portrait. One case per page.
export function buildCaseLabels(order: LabelOrder, cases: CaseLabel[]): jsPDF {
  const W = 4, H = 6
  const doc = new jsPDF({ unit: 'in', format: [W, H], orientation: 'portrait' })
  const cx = W / 2
  cases.forEach((c, idx) => {
    if (idx > 0) doc.addPage([W, H], 'portrait')
    let y = 0.35
    // Ship-from header
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    SHIP_FROM.forEach(line => { doc.text(line, cx, y, { align: 'center' }); y += 0.19 })
    y += 0.18
    // SHIP TO
    doc.setFontSize(12)
    doc.text('SHIP TO:', cx, y, { align: 'center' }); y += 0.24
    doc.setFontSize(13)
    doc.text(order.shipToName.toUpperCase(), cx, y, { align: 'center', maxWidth: W - 0.4 }); y += 0.24
    doc.setFontSize(11)
    order.shipToAddress.split('\n').forEach(line => {
      if (!line.trim()) return
      doc.text(line, cx, y, { align: 'center', maxWidth: W - 0.4 }); y += 0.2
    })
    y += 0.16
    // PO#
    doc.setFontSize(22)
    doc.text(`PO# ${order.poNumber || '-'}`, cx, y, { align: 'center' }); y += 0.36
    // Case X of N
    doc.setFontSize(16)
    doc.text(`Case ${c.caseNumber} of ${c.totalCases}`, cx, y, { align: 'center' }); y += 0.3
    // Customer part #
    doc.setFontSize(12)
    const custPart = c.customerPartNumber || c.sku
    doc.text(`PART # ${custPart}`, cx, y, { align: 'center' }); y += 0.22
    // Barcode box
    const img = barcodeDataUrl(c.upcGtin || '')
    if (img) {
      const bw = 2.6, bh = 1.2
      doc.setDrawColor(0); doc.setLineWidth(0.03)
      doc.rect(cx - bw / 2 - 0.1, y, bw + 0.2, bh + 0.2)
      doc.addImage(img, 'PNG', cx - bw / 2, y + 0.1, bw, bh)
      y += bh + 0.34
    } else {
      doc.setFontSize(10); doc.setTextColor(180, 0, 0)
      doc.text('UPC/GTIN MISSING', cx, y + 0.3, { align: 'center' })
      doc.setTextColor(0, 0, 0); y += 0.6
    }
    // Vendor part #
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
    doc.text(`VENDOR PART # ${c.vendorPartNumber || c.sku}`, cx, y, { align: 'center' })
  })
  return doc
}

// 4x6 pallet license-plate label. One pallet per page.
export function buildPalletLabels(order: LabelOrder, pallets: PalletLabel[]): jsPDF {
  const W = 4, H = 6
  const doc = new jsPDF({ unit: 'in', format: [W, H], orientation: 'portrait' })
  const cx = W / 2
  pallets.forEach((p, idx) => {
    if (idx > 0) doc.addPage([W, H], 'portrait')
    let y = 0.4
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
    SHIP_FROM.forEach(line => { doc.text(line, cx, y, { align: 'center' }); y += 0.19 })
    y += 0.2
    doc.setFontSize(12)
    doc.text('SHIP TO:', cx, y, { align: 'center' }); y += 0.24
    doc.setFontSize(13)
    doc.text(order.shipToName.toUpperCase(), cx, y, { align: 'center', maxWidth: W - 0.4 }); y += 0.24
    doc.setFontSize(11)
    order.shipToAddress.split('\n').forEach(line => {
      if (!line.trim()) return
      doc.text(line, cx, y, { align: 'center', maxWidth: W - 0.4 }); y += 0.2
    })
    y += 0.2
    doc.setFontSize(22)
    doc.text(`PO# ${order.poNumber || '-'}`, cx, y, { align: 'center' }); y += 0.4
    doc.setFontSize(30)
    doc.text(`PALLET ${p.palletNumber} of ${p.totalPallets}`, cx, y, { align: 'center' }); y += 0.44
    doc.setFontSize(14)
    doc.text(`Cases: ${p.caseCount}${p.weight ? '   Weight: ' + Math.round(p.weight) + ' lb' : ''}`, cx, y, { align: 'center' })
    y += 0.4
    // Pallet SSCC / id barcode (Code128)
    const id = p.sscc || `PLT-${order.poNumber}-${p.palletNumber}`
    try {
      const canvas = document.createElement('canvas')
      JsBarcode(canvas, id, { format: 'CODE128', width: 2, height: 110, displayValue: true, fontSize: 16, margin: 4 })
      const url = canvas.toDataURL('image/png')
      const bw = 3.2, bh = 1.4
      doc.addImage(url, 'PNG', cx - bw / 2, y, bw, bh)
    } catch { /* ignore */ }
  })
  return doc
}
