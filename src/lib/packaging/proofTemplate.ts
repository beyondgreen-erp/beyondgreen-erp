/* eslint-disable @typescript-eslint/no-explicit-any */
// Official artwork approval proof sheet (ProSpec-style) wrapped around the artboard.
// Everything on it is generated from ERP data (customer / lead, product / SKU, design
// status, inks used in the artwork) — nobody types a title block by hand any more.
// The sheet is built from fabric objects so the same objects draw on screen, in the
// printer portal, and as vectors in the "Proof sheet (PDF)" export.
import * as fabric from 'fabric'
import type { DocLayer, Swatch } from './doc'
import type { DesignSpec } from './specExtract'

export const BRAND_LOGO_URL = 'https://tdhqucirvetvjpfsmnfb.supabase.co/storage/v1/object/public/haccp-attachments/brand/v2/bg_logo_horizontal.png'
export const BRAND_GREEN = '#2ABF06'
const INK = '#111827', MUTED = '#6B7280', RULE = '#D1D5DB', PANEL = '#F3F4F6'
const FONT = 'Inter'

export const DEFAULT_TERMS = 'Please review this proof carefully. Check all copy, spelling, dimensions, colours, barcodes, legal and regulatory information. ' +
  'Colours shown on screen or on digital proofs are approximations; Pantone / spot references govern final production. ' +
  'Signing this proof confirms the artwork is correct and releases beyondGREEN biotech, Inc. from liability for any errors not marked. ' +
  'Production is scheduled only after a signed approval is received. Changes after approval may add cost and lead time. ' +
  'This artwork and design are confidential and may not be reproduced without written consent.'

export interface ProofCustomer {
  id?: string | null; name: string; contact?: string; email?: string; phone?: string; location?: string; status?: string; code?: string
}
export interface ProofProduct {
  id?: string | null; sku: string; name?: string; size?: string; pack?: string; upc?: string; customerPart?: string; color?: string; thickness?: string; caseSize?: string
}
export interface ProofInk { name: string; hex: string; cmyk?: number[] | null; spot?: boolean; technical?: boolean }

/** Stored in the design document so the printer portal can draw the same sheet. */
export interface ProofInfo {
  enabled: boolean
  jobName?: string
  proofNo?: string
  version?: number
  date?: string          // ISO
  status?: string
  artist?: string
  productType?: string
  customer?: ProofCustomer | null
  product?: ProofProduct | null
  printMethod?: string
  substrate?: string
  finish?: string
  notes?: string
  terms?: string
  inks?: ProofInk[]
  dieline?: string       // e.g. 16.63 × 13.14 in
}

export const PRINT_METHODS = ['Flexographic', 'Offset lithography', 'Digital', 'Rotogravure', 'Screen print', 'Hot stamp / foil', 'TBD']

// ── ERP → proof data ─────────────────────────────────────────────────────────
export function customerFromRow(r: any): ProofCustomer | null {
  if (!r) return null
  return {
    id: r.id, name: r.company_name || '', contact: r.contact_name || '', email: r.email || '', phone: r.phone || '',
    location: [r.city, r.state].filter(Boolean).join(', '),
    status: r.customer_status || (r.is_scraped_lead ? 'Lead' : ''),
    code: r.customer_code != null ? String(r.customer_code) : '',
  }
}
export const CUSTOMER_COLS = 'id, company_name, contact_name, email, phone, city, state, customer_status, is_scraped_lead, customer_code'
export const PRODUCT_COLS = 'id, sku, product_name, product_size, product_thickness, product_color, print_color, pieces_per_pack, packs_per_case, case_qty, case_size, upc_gtin, customer_part_number'
export function productFromRow(r: any): ProofProduct | null {
  if (!r) return null
  const pack = [r.pieces_per_pack ? `${r.pieces_per_pack}/pack` : '', r.packs_per_case ? `${r.packs_per_case} packs/case` : (r.case_qty ? `${r.case_qty}/case` : '')].filter(Boolean).join(' · ')
  return {
    id: r.id, sku: r.sku || '', name: r.product_name || '', size: r.product_size || '', pack, upc: r.upc_gtin || '',
    customerPart: r.customer_part_number || '', color: r.product_color || '', thickness: r.product_thickness || '', caseSize: r.case_size || '',
  }
}

const NON_PRINTING = /^(dieline|die ?line|cut|crease|fold|perf|bleed|safety|glue|varnish free)/i
/** Inks actually used by the printable artwork (spot colours by name, plus process CMYK). */
export function collectInks(objects: any[], layers: DocLayer[], swatches: Swatch[] = []): ProofInk[] {
  const dieIds = new Set(layers.filter(l => l.kind === 'dieline').map(l => l.id))
  const spots = new Map<string, ProofInk>()
  let process = false
  const visit = (o: any, layerId?: string) => {
    if (!o || o.visible === false || o.isHelper || o.isProof) return
    const lid = o.layerId || layerId
    if (lid && dieIds.has(lid)) return
    if (o.type === 'group') { for (const c of o.getObjects ? o.getObjects() : o.objects || []) visit(c, lid); return }
    if (o.type === 'image') { process = true; return }
    for (const k of ['fill', 'stroke'] as const) {
      const v = o[k]
      if (!v || (k === 'stroke' && !(o.strokeWidth > 0))) continue
      const spot = o[k === 'fill' ? 'spotFill' : 'spotStroke']
      if (spot) {
        if (NON_PRINTING.test(spot)) continue
        if (!spots.has(spot)) spots.set(spot, { name: spot, hex: typeof v === 'string' ? v : '#000000', cmyk: o[k === 'fill' ? 'cmykFill' : 'cmykStroke'] || null, spot: true })
      } else if (typeof v === 'string' && v !== 'transparent' && !/rgba\([^)]*,\s*0\)/.test(v)) process = true
      else if (v && typeof v === 'object') process = true
    }
  }
  for (const o of objects) visit(o)
  const out = Array.from(spots.values()).sort((a, b) => a.name.localeCompare(b.name))
  if (process) {
    // name process swatches the team has defined, otherwise show the four process plates
    out.push({ name: 'Process Cyan', hex: '#00AEEF', cmyk: [100, 0, 0, 0] }, { name: 'Process Magenta', hex: '#EC008C', cmyk: [0, 100, 0, 0] },
      { name: 'Process Yellow', hex: '#FFF200', cmyk: [0, 0, 100, 0] }, { name: 'Process Black', hex: '#231F20', cmyk: [0, 0, 0, 100] })
  }
  void swatches
  return out
}

/** Inks straight from the original file: exact CMYK builds, printing spots, then die plates. */
export function specInks(spec: DesignSpec): ProofInk[] {
  const out: ProofInk[] = []
  for (const p of spec.plates.filter(p => !p.technical)) out.push({ name: p.name + (p.cmyk ? ` (${p.cmyk.map(v => Math.round(v)).join('/')})` : ''), hex: p.hex, cmyk: p.cmyk, spot: true })
  for (const c of spec.colors) out.push({ name: c.label, hex: c.hex, cmyk: [c.c, c.m, c.y, c.k] })
  for (const p of spec.plates.filter(p => p.technical)) out.push({ name: `${p.name} — die / non-printing`, hex: p.hex, cmyk: p.cmyk, spot: true, technical: true })
  return out
}

// ── layout ───────────────────────────────────────────────────────────────────
export interface SheetLayout { x: number; y: number; w: number; h: number; S: number; headerH: number; footerY: number; footerH: number; gap: number; margin: number }

export function sheetLayout(w: number, h: number): SheetLayout {
  const S = Math.max(1, (w + 48) / 792, h / 900)
  const margin = 24 * S
  const W = Math.max(792 * S, w + 2 * margin)
  const headerH = 62 * S, gap = 16 * S, footerH = 214 * S
  const x = -(W - w) / 2
  const y = -(margin + headerH + gap)
  const footerY = h + gap
  return { x, y, w: W, h: footerY + footerH + margin - y, S, headerH, footerY, footerH, gap, margin }
}

const fmtDate = (iso?: string) => {
  const d = iso ? new Date(iso) : new Date()
  return isNaN(+d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

let logoPromise: Promise<HTMLImageElement | null> | null = null
export function loadBrandLogo(): Promise<HTMLImageElement | null> {
  if (typeof window === 'undefined') return Promise.resolve(null)
  if (!logoPromise) logoPromise = new Promise(res => {
    const im = new Image(); im.crossOrigin = 'anonymous'
    im.onload = () => res(im); im.onerror = () => res(null)
    im.src = BRAND_LOGO_URL
  })
  return logoPromise
}

/** Builds the proof sheet as fabric objects in document space (the artboard is 0,0 → w,h). */
export function buildProofObjects(info: ProofInfo, w: number, h: number, logo: HTMLImageElement | null): fabric.FabricObject[] {
  const L = sheetLayout(w, h)
  const S = L.S, X = L.x, W = L.w
  const out: fabric.FabricObject[] = []
  const common = { selectable: false, evented: false, objectCaching: false, originX: 'left', originY: 'top' } as any
  const rect = (x: number, y: number, ww: number, hh: number, o: any = {}) => out.push(new fabric.Rect({ ...common, left: x, top: y, width: ww, height: hh, fill: o.fill ?? '', stroke: o.stroke ?? null, strokeWidth: o.sw ?? 0, rx: o.r ?? 0, ry: o.r ?? 0, strokeUniform: false }))
  const line = (x1: number, y1: number, x2: number, y2: number, color = RULE, sw = 0.75 * S) => rect(Math.min(x1, x2), Math.min(y1, y2) - (y1 === y2 ? sw / 2 : 0), Math.max(Math.abs(x2 - x1), y1 === y2 ? 0 : sw), Math.max(Math.abs(y2 - y1), y1 === y2 ? sw : 0), { fill: color })
  const text = (s: string, x: number, y: number, size: number, o: any = {}) => {
    const t: any = o.width
      ? new fabric.Textbox(s || '', { ...common, left: x, top: y, width: o.width, fontSize: size * S, fontFamily: FONT, fontWeight: o.bold ? 'bold' : 'normal', fill: o.color || INK, lineHeight: o.lh || 1.2, textAlign: o.align || 'left', charSpacing: o.cs || 0, splitByGrapheme: false } as any)
      : new fabric.FabricText(s || '', { ...common, left: x, top: y, fontSize: size * S, fontFamily: FONT, fontWeight: o.bold ? 'bold' : 'normal', fill: o.color || INK, charSpacing: o.cs || 0 } as any)
    if (o.alignRight) { t.initDimensions?.(); t.set({ left: x - t.width }) }
    if (o.maxWidth && !o.width) { t.initDimensions?.(); if (t.width > o.maxWidth) t.set({ scaleX: o.maxWidth / t.width, scaleY: o.maxWidth / t.width }) }
    out.push(t); return t
  }

  // sheet paper
  rect(X, L.y, W, L.h, { fill: '#FFFFFF', stroke: RULE, sw: 0.75 * S })

  // ── header ──
  const hy = L.y + L.margin, hx = X + L.margin, hw = W - 2 * L.margin
  rect(hx, hy, hw, L.headerH, { fill: '#FFFFFF' })
  rect(hx, hy + L.headerH - 3 * S, hw, 3 * S, { fill: BRAND_GREEN })
  let tx = hx
  if (logo) {
    const lh = 30 * S, lw = lh * (logo.naturalWidth / logo.naturalHeight || 4)
    const img = new fabric.FabricImage(logo as any, { ...common, left: hx, top: hy + (L.headerH - 3 * S - lh) / 2, scaleX: lw / logo.naturalWidth, scaleY: lh / logo.naturalHeight })
    out.push(img); tx = hx + lw + 16 * S
    line(tx - 8 * S, hy + 10 * S, tx - 8 * S, hy + L.headerH - 13 * S)
  }
  text('ARTWORK APPROVAL PROOF', tx, hy + 12 * S, 15, { bold: true, cs: 40 })
  text([info.jobName, info.productType].filter(Boolean).join('  ·  ') || 'Untitled job', tx, hy + 33 * S, 9.5, { color: MUTED, maxWidth: hw * 0.42 })
  // right: proof meta boxes
  const metas: Array<[string, string]> = [['PROOF #', info.proofNo || '—'], ['VERSION', info.version != null ? `V${info.version}` : 'V1'], ['DATE', fmtDate(info.date)], ['STATUS', (info.status || 'Draft').toUpperCase()]]
  const bw = 78 * S, bh = L.headerH - 16 * S
  let bx = hx + hw - metas.length * bw
  for (const [k, v] of metas) {
    const isStatus = k === 'STATUS'
    const approved = /approved|final/i.test(v)
    rect(bx + 2 * S, hy + 4 * S, bw - 4 * S, bh, { fill: isStatus ? (approved ? '#DCFCE7' : '#FEF3C7') : PANEL, r: 3 * S })
    text(k, bx + 9 * S, hy + 11 * S, 6.5, { bold: true, color: MUTED, cs: 80 })
    text(v, bx + 9 * S, hy + 24 * S, 11, { bold: true, color: isStatus ? (approved ? '#166534' : '#92400E') : INK, maxWidth: bw - 18 * S })
    bx += bw
  }

  // artboard frame label
  text(`ARTWORK — ${info.dieline || ''}`.replace(/ — $/, ''), 0, -12 * S, 6.5, { bold: true, color: MUTED, cs: 60 })

  // ── footer information panel ──
  const fy = L.footerY, fx = hx, fw = hw
  const row1 = 100 * S, row2 = L.footerH - row1 - 18 * S
  rect(fx, fy, fw, row1 + row2, { stroke: '#9CA3AF', sw: 0.75 * S })
  const cols = 4, cw = fw / cols
  const cust = info.customer, prod = info.product
  const sections: Array<{ title: string; rows: Array<[string, string]> }> = [
    { title: cust?.status && /lead|prospect/i.test(cust.status) ? 'LEAD / PROSPECT' : 'CUSTOMER', rows: [
      ['Company', cust?.name || '—'], ['Contact', cust?.contact || ''], ['Email', cust?.email || ''], ['Phone', cust?.phone || ''],
      ['Location', cust?.location || ''], ['Account', [cust?.status, cust?.code ? `#${cust.code}` : ''].filter(Boolean).join(' · ')],
    ] },
    { title: 'PRODUCT / SKU', rows: [
      ['SKU', prod?.sku || '—'], ['Item', prod?.name || ''], ['Size', [prod?.size, prod?.thickness].filter(Boolean).join(' · ')],
      ['Pack', prod?.pack || ''], ['UPC / GTIN', prod?.upc || ''], ['Cust. part #', prod?.customerPart || ''],
    ] },
    { title: 'PRINT SPECIFICATIONS', rows: [
      ['Dieline', info.dieline || ''], ['Method', info.printMethod || ''], ['Substrate', info.substrate || prod?.color || ''],
      ['Finish', info.finish || ''], ['Inks', info.inks?.length ? `${info.inks.filter(i => !i.technical).length} colour builds (${info.inks.filter(i => i.spot && !i.technical).length} spot)` : ''], ['Artist', info.artist || ''],
    ] },
  ]
  const headH = 15 * S
  sections.forEach((sec, i) => {
    const cx = fx + i * cw
    rect(cx, fy, cw, headH, { fill: PANEL })
    text(sec.title, cx + 8 * S, fy + 4.5 * S, 7, { bold: true, cs: 60 })
    if (i) line(cx, fy, cx, fy + row1, '#9CA3AF')
    let ry = fy + headH + 6 * S
    for (const [k, v] of sec.rows) {
      text(k.toUpperCase(), cx + 8 * S, ry + 1 * S, 5.5, { bold: true, color: MUTED, cs: 40 })
      text(v || '—', cx + 62 * S, ry, 7.5, { color: v ? INK : '#9CA3AF', maxWidth: cw - 70 * S })
      ry += 12.5 * S
    }
  })
  // inks column
  {
    const cx = fx + 3 * cw
    line(cx, fy, cx, fy + row1, '#9CA3AF')
    rect(cx, fy, cw, headH, { fill: PANEL })
    text('COLOURS / INKS', cx + 8 * S, fy + 4.5 * S, 7, { bold: true, cs: 60 })
    const inks = info.inks || []
    const per = 6
    let ry = fy + headH + 6 * S
    inks.slice(0, inks.length > per ? per - 1 : per).forEach(ink => {
      rect(cx + 8 * S, ry, 10 * S, 10 * S, { fill: ink.hex, stroke: '#9CA3AF', sw: 0.5 * S, r: 1.5 * S })
      text(ink.name, cx + 23 * S, ry, 7.5, { bold: !!ink.spot && !ink.technical, color: ink.technical ? MUTED : INK, maxWidth: cw - 30 * S })
      ry += 12.5 * S
    })
    if (inks.length > per) text(`+ ${inks.length - per + 1} more — full list under Specs`, cx + 23 * S, ry, 7, { color: MUTED })
    if (!inks.length) text('No printable inks yet', cx + 8 * S, ry, 7.5, { color: '#9CA3AF' })
  }
  line(fx, fy + row1, fx + fw, fy + row1, '#9CA3AF')

  // row 2: approval + terms
  const ay = fy + row1, aw = fw * 0.46
  rect(fx, ay, aw, headH, { fill: '#111827' })
  text('CUSTOMER APPROVAL — PLEASE CHECK ONE AND SIGN', fx + 8 * S, ay + 4.5 * S, 7, { bold: true, color: '#FFFFFF', cs: 40 })
  const opts = ['APPROVED AS IS', 'APPROVED WITH CHANGES', 'REVISE & RESUBMIT']
  let ox = fx + 8 * S
  for (const o of opts) {
    rect(ox, ay + headH + 9 * S, 9 * S, 9 * S, { stroke: INK, sw: 0.9 * S })
    const t = text(o, ox + 13 * S, ay + headH + 10 * S, 7, { bold: true })
    t.initDimensions?.(); ox += 13 * S + t.width + 14 * S
  }
  const sy = ay + headH + 40 * S
  const sig: Array<[string, number]> = [['SIGNATURE', 0.5], ['PRINT NAME', 0.28], ['DATE', 0.22]]
  let sx = fx + 8 * S
  const sAvail = aw - 16 * S
  for (const [k, f] of sig) {
    const lw = sAvail * f - 8 * S
    line(sx, sy, sx + lw, sy, INK, 0.75 * S)
    text(k, sx, sy + 3 * S, 5.5, { bold: true, color: MUTED, cs: 60 })
    sx += sAvail * f
  }
  text('Notes / changes requested:', fx + 8 * S, sy + 16 * S, 6.5, { color: MUTED })
  line(fx + 8 * S, sy + 38 * S, fx + aw - 8 * S, sy + 38 * S, RULE)
  line(fx + aw, ay, fx + aw, ay + row2, '#9CA3AF')
  // terms
  const tx2 = fx + aw
  rect(tx2, ay, fw - aw, headH, { fill: PANEL })
  text('TERMS & CONDITIONS', tx2 + 8 * S, ay + 4.5 * S, 7, { bold: true, cs: 60 })
  if (info.notes) {
    text('JOB NOTES', tx2 + 8 * S, ay + headH + 6 * S, 5.5, { bold: true, color: MUTED, cs: 40 })
    text(info.notes, tx2 + 8 * S, ay + headH + 14 * S, 7, { width: fw - aw - 16 * S })
  }
  const termsY = ay + headH + (info.notes ? 36 * S : 6 * S)
  text(info.terms || DEFAULT_TERMS, tx2 + 8 * S, termsY, 6.3, { width: fw - aw - 16 * S, color: '#374151', lh: 1.25 })

  // bottom strip
  const by = fy + row1 + row2 + 5 * S
  text('beyondGREEN biotech, Inc.  ·  This proof is generated automatically from the beyondGREEN ERP  ·  Confidential', fx, by, 6, { color: MUTED })
  text(`${info.proofNo || ''}  ·  ${fmtDate(info.date)}  ·  Page 1 of 1`, fx + fw, by, 6, { color: MUTED, alignRight: true })

  for (const o of out as any[]) { o.isProof = true; o.setCoords?.() }
  return out
}

/** Draws prebuilt proof objects on a context that is already in document space. */
export function drawProof(ctx: CanvasRenderingContext2D, objs: fabric.FabricObject[]) {
  for (const o of objs) { ctx.save(); (o as any).render(ctx); ctx.restore() }
}
