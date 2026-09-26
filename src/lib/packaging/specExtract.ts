/* eslint-disable @typescript-eslint/no-explicit-any */
// Reads the exact print specification out of the ORIGINAL uploaded file (never the rebuilt
// preview): CMYK colour builds exactly as defined in Illustrator, spot / technical plates
// (Cut, Crease, Perf…) with their CMYK equivalents, and every dimension callout written on
// the dieline. Runs in the browser; the file never leaves the ERP.
import { unzlibSync } from 'fflate'
import { getPdfjs, ghostscriptToPdf } from './importers'

export interface SpecColor { c: number; m: number; y: number; k: number; uses: number; hex: string; label: string }
export interface SpecPlate { name: string; cmyk: number[] | null; hex: string; technical: boolean; lab?: number[] | null }
export interface SpecDim { text: string; value: number; unit: string; vertical: boolean; uses: number }
export interface DesignSpec {
  version: 1
  extracted_at: string
  source_sha256: string
  source_name: string
  page: { w: number; h: number }            // pt
  flat: { w: number; h: number; unit: string } | null
  dims: SpecDim[]
  colors: SpecColor[]                       // process CMYK builds, most used first
  plates: SpecPlate[]                       // spot / technical plates
  paper: boolean                            // file contains 0/0/0/0 (no-ink / paper) areas
  notes: string[]
}

const TECH = /(cut|crease|perf|die ?line|dieline|bleed|artios|fold|glue|score|safety|trim|varnish free|braille|dimension)/i
const r1 = (v: number) => Math.round(v * 10) / 10
export function cmykHex(c: number, m: number, y: number, k: number) {
  const f = (x: number) => Math.round(255 * (1 - x / 100) * (1 - k / 100))
  return '#' + [f(c), f(m), f(y)].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()
}
export function labHex(L: number, a: number, b: number) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200
  const f = (t: number) => t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787
  const X = 0.95047 * f(fx), Y = f(fy), Z = 1.08883 * f(fz)
  const lin = [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.204 * Y + 1.057 * Z]
  const g = (c: number) => Math.round(255 * Math.max(0, Math.min(1, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)))
  return '#' + lin.map(g).map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()
}
export const cmykLabel = (c: number, m: number, y: number, k: number) => `C${r1(c)} M${r1(m)} Y${r1(y)} K${r1(k)}`
const latin1 = (b: Uint8Array) => { let s = ''; const n = 1 << 15; for (let i = 0; i < b.length; i += n) s += String.fromCharCode.apply(null, Array.from(b.subarray(i, i + n))); return s }
const pdfName = (n: string) => n.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))

type Tally = Map<string, { v: number[]; uses: number }>
function add(t: Tally, v: number[]) {
  const pct = v.map(x => Math.max(0, Math.min(100, x * 100)))
  const key = pct.map(x => Math.round(x)).join('/') // group builds that differ by < 0.5%
  const e = t.get(key)
  if (e) e.uses++; else t.set(key, { v: pct, uses: 1 })
}

// ── PostScript / EPS (Illustrator) ─────────────────────────────────────────
function scanPostScript(s: string, t: Tally, plates: Map<string, number[] | null>) {
  // custom (spot) colours declared in the DSC header
  const hdr = s.slice(0, 200000)
  const block = hdr.match(/%%CMYKCustomColor:([^\n]*(?:\n%%\+[^\n]*)*)/)
  if (block) for (const line of block[1].split(/\n%%\+/)) {
    const m = line.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+\((.*)\)/)
    if (m) plates.set(m[5], [m[1], m[2], m[3], m[4]].map(x => r1(parseFloat(x) * 100)))
  }
  const names = hdr.match(/%%DocumentCustomColors:([^\n]*(?:\n%%\+[^\n]*)*)/)
  if (names) for (const m of names[1].matchAll(/\(([^)]*)\)/g)) if (!plates.has(m[1])) plates.set(m[1], null)
  // artwork body only (skip procsets, which contain test colours)
  const start = Math.max(s.indexOf('%%EndSetup'), 0)
  const body = s.slice(start)
  const re = /(?<![\w.])(\.?\d[\d.]*)\s+(\.?\d[\d.]*)\s+(\.?\d[\d.]*)\s+(\.?\d[\d.]*)\s+(cmyk|setcmykcolor|k|K)\b/g
  for (const m of body.matchAll(re)) {
    const v = [m[1], m[2], m[3], m[4]].map(Number)
    if (v.every(x => x >= 0 && x <= 1)) add(t, v)
  }
}

// ── PDF (Illustrator .ai with PDF compatibility, or PDF) ───────────────────
const labPlates = new Map<string, number[]>(), cmykPlates = new Map<string, number[]>()
function scanPdf(bytes: Uint8Array, t: Tally, plates: Map<string, number[] | null>) {
  const raw = latin1(bytes)
  const texts: string[] = [raw]
  const re = /stream\r?\n/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    const dictStart = raw.lastIndexOf('<<', m.index)
    const dict = raw.slice(Math.max(0, dictStart - 2000), m.index)
    const end = raw.indexOf('endstream', m.index)
    if (end < 0) break
    const local = dict.slice(dict.lastIndexOf('obj'))
    if (/\/Subtype\s*\/Image|\/FontFile|\/Length1|\/N\s+[34]\b.*\/ICC|\/Type\s*\/XRef|\/Metadata/.test(local)) { re.lastIndex = end; continue }
    const chunk = bytes.subarray(m.index + m[0].length, end)
    let out: Uint8Array | null = null
    if (/FlateDecode/.test(local)) { try { out = unzlibSync(chunk) } catch { out = null } }
    else if (!/\/Filter/.test(local)) out = chunk
    if (out && out.length) texts.push(latin1(out))
    re.lastIndex = end
  }
  for (const s of texts) {
    for (const x of s.matchAll(/(?<![\w.])(-?\.?\d[\d.]*)\s+(-?\.?\d[\d.]*)\s+(-?\.?\d[\d.]*)\s+(-?\.?\d[\d.]*)\s+(k|K|scn|SCN|sc|SC)\b/g)) {
      const v = [x[1], x[2], x[3], x[4]].map(Number)
      if (v.every(n => n >= 0 && n <= 1)) add(t, v)
    }
    for (const x of s.matchAll(/\/Separation\s*\/([^\s/[\]<>()]+)\s*(\/Device(?:CMYK|RGB|Gray)|\d+\s+0\s+R|\[[^\]]*\])\s*(\d+\s+0\s+R|<<[^]*?>>)/g)) {
      const name = pdfName(x[1])
      if (/^(All|None)$/.test(name)) continue
      const obj = (ref: string) => { const n = ref.match(/^(\d+)/)![1]; const o = raw.match(new RegExp(`(?:^|[\\r\\n\\s])${n}\\s+0\\s+obj([^]*?)endobj`)); return o ? o[1] : '' }
      const alt = /^\d/.test(x[2]) ? obj(x[2]) : x[2]
      const fn = /^\d/.test(x[3]) ? obj(x[3]) : x[3]
      const c1 = fn.match(/\/C1\s*\[([^\]]*)\]/)
      const v = c1 ? c1[1].trim().split(/\s+/).map(Number) : null
      if (/DeviceCMYK/.test(alt) && v?.length === 4) cmykPlates.set(name, v.map(n => r1(n * 100)))
      else if (/\/Lab/.test(alt) && v?.length === 3) labPlates.set(name, v.map(r1))
      else if (!plates.has(name)) plates.set(name, null)
    }
  }
}

// ── dimension callouts (text on the dieline) ───────────────────────────────
async function readDims(pdfBytes: Uint8Array): Promise<{ page: { w: number; h: number }; dims: SpecDim[] }> {
  const pdfjs = await getPdfjs()
  const doc = await pdfjs.getDocument({ data: pdfBytes, isOffscreenCanvasSupported: false, disableFontFace: true }).promise
  const page = await doc.getPage(1)
  const vp = page.getViewport({ scale: 1 })
  const tc = await page.getTextContent()
  const items: any[] = tc.items.filter((i: any) => typeof i.str === 'string')
  const found = new Map<string, SpecDim>()
  const push = (num: string, unit: string, tr: number[]) => {
    const u = unit === '"' ? 'in' : unit.toLowerCase()
    const vertical = Math.abs(tr[1]) > Math.abs(tr[0])
    const text = `${num} ${u}`
    const key = text + (vertical ? '|v' : '|h')
    const e = found.get(key)
    if (e) e.uses++; else found.set(key, { text, value: parseFloat(num), unit: u, vertical, uses: 1 })
  }
  for (let i = 0; i < items.length; i++) {
    const s = items[i].str
    for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*(in|mm|cm|")(?![a-z])/gi)) push(m[1], m[2], items[i].transform)
    // number and unit split across two text runs
    const n = s.match(/^\s*(\d+(?:\.\d+)?)\s*$/)
    const next = items[i + 1]?.str || ''
    if (n && /^\s*(in|mm|cm)\b/i.test(next)) push(n[1], next.trim().slice(0, 2), items[i].transform)
  }
  return { page: { w: vp.width, h: vp.height }, dims: Array.from(found.values()).sort((a, b) => b.value - a.value) }
}

export async function extractSpec(bytes: Uint8Array, name: string, sha256: string, onStatus?: (s: string) => void): Promise<DesignSpec> {
  const head = latin1(bytes.subarray(0, 1024))
  const isPdf = head.includes('%PDF')
  const isDosEps = bytes[0] === 0xc5 && bytes[1] === 0xd0
  const notes: string[] = []
  const tally: Tally = new Map()
  const plates = new Map<string, number[] | null>()
  onStatus?.('Reading exact colour codes…')
  let psText: string | null = null
  if (isPdf) scanPdf(bytes, tally, plates)
  else {
    let ps = bytes
    if (isDosEps) { // DOS EPS binary header → PostScript section
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      const off = dv.getUint32(4, true), len = dv.getUint32(8, true)
      ps = bytes.subarray(off, off + len)
    }
    psText = latin1(ps)
    scanPostScript(psText, tally, plates)
  }
  onStatus?.('Reading dieline dimensions…')
  let page = { w: 0, h: 0 }, dims: SpecDim[] = []
  try {
    const pdf = isPdf ? bytes : await ghostscriptToPdf(bytes, /EPSF/.test(psText?.slice(0, 200) || head) || isDosEps || /\.eps$/i.test(name) ? 'eps' : 'ps', false)
    const r = await readDims(pdf); page = r.page; dims = r.dims
  } catch (e: any) { notes.push('Dimension callouts could not be read: ' + (e?.message || e)) }

  const all = Array.from(tally.values())
  const paper = all.some(e => e.v.every(x => x < 0.5))
  const colors = all.filter(e => !e.v.every(x => x < 0.5)).sort((a, b) => b.uses - a.uses).map(e => {
    const [c, m, y, k] = e.v.map(r1)
    return { c, m, y, k, uses: e.uses, hex: cmykHex(c, m, y, k), label: cmykLabel(c, m, y, k) }
  })
  labPlates.forEach((_, n) => plates.delete(n)); cmykPlates.forEach((v, n) => plates.set(n, v))
  const plateList: SpecPlate[] = [
    ...Array.from(plates.entries()).map(([n, v]) => ({ name: n, cmyk: v, hex: v ? cmykHex(v[0], v[1], v[2], v[3]) : '#999999', technical: TECH.test(n) })),
    ...Array.from(labPlates.entries()).map(([n, l]) => ({ name: n, cmyk: null, lab: l, hex: labHex(l[0], l[1], l[2]), technical: TECH.test(n) })),
  ]
  labPlates.clear(); cmykPlates.clear()
  const unitCount = new Map<string, number>(); dims.forEach(d => unitCount.set(d.unit, (unitCount.get(d.unit) || 0) + d.uses))
  const main = Array.from(unitCount.entries()).sort((a, b) => b[1] - a[1])[0]?.[0]
  dims.sort((a, b) => (a.unit === main ? 0 : 1) - (b.unit === main ? 0 : 1) || b.value - a.value)
  const h = dims.filter(d => !d.vertical && d.unit === main), v = dims.filter(d => d.vertical && d.unit === main)
  const flat = h.length && v.length ? { w: h[0].value, h: v[0].value, unit: main! } : null
  if (!dims.length) notes.push('No dimension callouts (e.g. “9.78 in”) were found as text in the file.')
  return {
    version: 1, extracted_at: new Date().toISOString(), source_sha256: sha256, source_name: name,
    page, flat, dims, colors, plates: plateList, paper, notes,
  }
}
