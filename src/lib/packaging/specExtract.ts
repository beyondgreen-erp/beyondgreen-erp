/* eslint-disable @typescript-eslint/no-explicit-any */
// Reads the exact print specification out of the ORIGINAL uploaded file (never the rebuilt
// preview): CMYK colour builds exactly as defined in Illustrator, spot / technical plates
// (Cut, Crease, Perf…) with their CMYK equivalents, and every dimension callout written on
// the dieline. Runs in the browser; the file never leaves the ERP.
import { unzlibSync } from 'fflate'
import { getPdfjs, ghostscriptToPdf } from './importers'

export interface SpecColor { c: number; m: number; y: number; k: number; uses: number; hex: string; label: string }
export interface SpecPlate { name: string; cmyk: number[] | null; hex: string; technical: boolean; lab?: number[] | null; rgb?: number[] | null }
export interface SpecRgb { r: number; g: number; b: number; uses: number; hex: string; label: string }
/** Sizes measured from the dieline geometry itself (cut / crease / dieline plate), in inches. */
export interface SpecMeasured { unit: 'in'; extents: { w: number; h: number }; across: number[]; down: number[]; box: { w: number; d: number; h: number } | null; plate: string }
export interface SpecDim { text: string; value: number; unit: string; vertical: boolean; uses: number }
export interface DesignSpec {
  version: 1 | 2 | 3
  extracted_at: string
  source_sha256: string
  source_name: string
  page: { w: number; h: number }            // pt
  flat: { w: number; h: number; unit: string } | null
  dims: SpecDim[]
  colors: SpecColor[]                       // process CMYK builds, most used first
  plates: SpecPlate[]                       // spot / technical plates
  paper: boolean                            // file contains 0/0/0/0 (no-ink / paper) areas
  rgb?: SpecRgb[]                           // RGB colours, when the artwork is not (only) CMYK
  measured?: SpecMeasured | null            // panel sizes measured from the die lines
  notes: string[]
}

export const SPEC_VERSION = 3
const DIE = /(cut|crease|perf|die ?line|dieline|fold|score)/i
const NOT_DIE = /(bleed|dimension|annot|safety|varnish|glue)/i
const hex2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
export const rgbHex = (r: number, g: number, b: number) => ('#' + hex2(r) + hex2(g) + hex2(b)).toUpperCase()
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
const labPlates = new Map<string, number[]>(), cmykPlates = new Map<string, number[]>(), rgbPlates = new Map<string, number[]>()
interface PdfScan { raw: string; texts: string[]; rgb: Map<string, { v: number[]; uses: number }>; csKind: Map<string, string>; csSep: Map<string, string> }
const objBody = (raw: string, n: string) => { const o = raw.match(new RegExp(`(?:^|[\\r\\n\\s])${n}\\s+0\\s+obj([^]*?)endobj`)); return o ? o[1] : '' }
/** Resource colour-space names (/CS0 …) → kind ('rgb' | 'cmyk' | 'lab' | 'sep' | 'gray') and separation name. */
function colourSpaces(raw: string, texts: string[], kind: Map<string, string>, sep: Map<string, string>) {
  const classify = (name: string, def: string, depth = 0) => {
    let d = def.trim()
    if (/^\d+\s+0\s+R/.test(d) && depth < 3) d = objBody(raw, d.match(/^(\d+)/)![1]).trim()
    const sm = d.match(/^\[?\s*\/Separation\s*\/([^\s/[\]<>()]+)/)
    if (sm) { kind.set(name, 'sep'); sep.set(name, pdfName(sm[1])); return }
    if (/^\[?\s*\/DeviceN/.test(d)) { kind.set(name, 'sep'); return }
    if (/^\[?\s*\/(DeviceRGB|CalRGB)/.test(d)) { kind.set(name, 'rgb'); return }
    if (/^\[?\s*\/DeviceCMYK/.test(d)) { kind.set(name, 'cmyk'); return }
    if (/^\[?\s*\/Lab/.test(d)) { kind.set(name, 'lab'); return }
    if (/^\[?\s*\/(DeviceGray|CalGray)/.test(d)) { kind.set(name, 'gray'); return }
    const icc = d.match(/^\[?\s*\/ICCBased\s+(\d+)\s+0\s+R/)
    if (icc) {
      const o = objBody(raw, icc[1])
      const n = o.match(/\/N\s+(\d)/)
      const isLab = /\/Alternate\s*\[?\s*\/Lab/.test(o) || o.slice(0, 4000).includes('spacLab ')
      kind.set(name, isLab ? 'lab' : n?.[1] === '3' ? 'rgb' : n?.[1] === '4' ? 'cmyk' : 'gray')
    }
  }
  for (const s of texts) for (const d of s.matchAll(/\/ColorSpace\s*<<([^]*?)>>(?!\s*\])/g)) {
    for (const e of d[1].matchAll(/\/([^\s/[\]<>()]+)\s*(\d+\s+0\s+R|\[[^\]]*\]|\/[A-Za-z]+)/g)) if (!kind.has(e[1])) classify(e[1], e[2])
  }
  // resource dictionary stored as its own object: /ColorSpace 99 0 R
  for (const d of raw.matchAll(/\/ColorSpace\s+(\d+)\s+0\s+R/g)) {
    for (const e of objBody(raw, d[1]).matchAll(/\/([^\s/[\]<>()]+)\s*(\d+\s+0\s+R|\[[^\]]*\]|\/[A-Za-z]+)/g)) if (!kind.has(e[1])) classify(e[1], e[2])
  }
}
function scanPdf(bytes: Uint8Array, t: Tally, plates: Map<string, number[] | null>): PdfScan {
  const raw = latin1(bytes)
  const texts: string[] = [raw]
  const rgb = new Map<string, { v: number[]; uses: number }>(), csKind = new Map<string, string>(), csSep = new Map<string, string>()
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
  colourSpaces(raw, texts, csKind, csSep)
  const addRgb = (v: number[]) => {
    const c = v.map(x => Math.round(Math.max(0, Math.min(1, x)) * 255))
    const key = c.join('/'); const e = rgb.get(key)
    if (e) e.uses++; else rgb.set(key, { v: c, uses: 1 })
  }
  // RGB colours: `r g b rg`, or `r g b scn` while an RGB colour space is selected.
  // A page's content is often split over several streams, so the selected colour space carries over.
  let fill = '', stroke = ''
  for (const s of texts.slice(1)) {
    for (const x of s.matchAll(/\/([^\s/[\]<>()]+)\s+(cs|CS)\b|(?<![\w.])((?:-?\.?\d[\d.]*\s+){3,4})(scn|SCN|sc|SC|rg|RG)\b/g)) {
      if (x[2]) { if (x[2] === 'cs') fill = x[1]; else stroke = x[1]; continue }
      const nums = x[3].trim().split(/\s+/).map(Number)
      if (nums.length !== 3 || !nums.every(n => n >= 0 && n <= 1)) continue
      const op = x[4]
      if (op === 'rg' || op === 'RG') { addRgb(nums); continue }
      const k = csKind.get(op === op.toLowerCase() ? fill : stroke) || (/RGB/i.test(op === op.toLowerCase() ? fill : stroke) ? 'rgb' : '')
      if (k === 'rgb') addRgb(nums)
    }
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
      else if (v?.length === 3 && v.every(n => n >= 0 && n <= 1)) rgbPlates.set(name, v.map(n => Math.round(n * 255)))
      else if (!plates.has(name)) plates.set(name, null)
    }
  }
  return { raw, texts, rgb, csKind, csSep }
}

// ── sizes measured from the die lines ──────────────────────────────────────
type Mat6 = [number, number, number, number, number, number]
/** Decoded content stream(s) of the first page. */
function pageContent(bytes: Uint8Array, raw: string): string {
  const pg = raw.match(/(?:^|[\r\n\s])\d+\s+0\s+obj((?:(?!endobj)[^])*?\/Type\s*\/Page(?![s\w])(?:(?!endobj)[^])*?)endobj/)
  if (!pg) return ''
  const c = pg[1].match(/\/Contents\s*(\[[^\]]*\]|\d+\s+0\s+R)/)
  if (!c) return ''
  let out = ''
  for (const r of c[1].matchAll(/(\d+)\s+0\s+R/g)) {
    const m = new RegExp(`(?:^|[\\r\\n\\s])${r[1]}\\s+0\\s+obj\\s*<<((?:(?!endobj)[^])*?)>>\\s*stream\\r?\\n`).exec(raw)
    if (!m) continue
    const start = m.index + m[0].length, end = raw.indexOf('endstream', start)
    if (end < 0) continue
    const chunk = bytes.subarray(start, end)
    if (/FlateDecode/.test(m[1])) { try { out += latin1(unzlibSync(chunk)) + '\n' } catch { /* skip */ } }
    else if (!/\/Filter/.test(m[1])) out += latin1(chunk) + '\n'
  }
  return out
}
/** Walk the page content and collect straight die-line segments (stroked in a cut / crease / dieline plate). */
function measureDie(content: string, csSep: Map<string, string>): SpecMeasured | null {
  const tok = content.match(/\[[^\]]*\]|<<[^]*?>>|\((?:\\.|[^\\)])*\)|\/[^\s/[\]<>()]+|[^\s/[\]<>()]+/g)
  if (!tok) return null
  let ctm: Mat6 = [1, 0, 0, 1, 0, 0], scs = ''
  const st: { ctm: Mat6; scs: string }[] = []
  let args: number[] = [], lastName = ''
  let cur: [number, number] | null = null, start: [number, number] | null = null
  let path: [number, number, number, number, boolean][] = [] // x0,y0,x1,y1,straight
  const segs = new Map<string, [number, number, number, number, boolean][]>()
  const P = (x: number, y: number): [number, number] => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]
  const line = (p: [number, number], straight = true) => { if (cur) path.push([cur[0], cur[1], p[0], p[1], straight]); cur = p }
  for (const k of tok) {
    if (/^-?\d*\.?\d+$/.test(k)) { args.push(parseFloat(k)); continue }
    if (k[0] === '/') { lastName = k.slice(1); continue }
    if (k[0] === '[' || k[0] === '(' || k[0] === '<') continue
    const a = args
    switch (k) {
      case 'q': st.push({ ctm: ctm.slice() as Mat6, scs }); break
      case 'Q': { const s = st.pop(); if (s) { ctm = s.ctm; scs = s.scs } break }
      case 'cm': if (a.length >= 6) { const m = a.slice(-6); ctm = [m[0] * ctm[0] + m[1] * ctm[2], m[0] * ctm[1] + m[1] * ctm[3], m[2] * ctm[0] + m[3] * ctm[2], m[2] * ctm[1] + m[3] * ctm[3], m[4] * ctm[0] + m[5] * ctm[2] + ctm[4], m[4] * ctm[1] + m[5] * ctm[3] + ctm[5]] } break
      case 'CS': scs = lastName; break
      case 'm': if (a.length >= 2) cur = start = P(a[a.length - 2], a[a.length - 1]); break
      case 'l': if (a.length >= 2) line(P(a[a.length - 2], a[a.length - 1])); break
      case 'c': case 'v': case 'y': if (a.length >= 2) line(P(a[a.length - 2], a[a.length - 1]), false); break
      case 'h': if (start) line(start); break
      case 're': if (a.length >= 4) { const [x, y, w, h] = a.slice(-4); cur = start = P(x, y); line(P(x + w, y)); line(P(x + w, y + h)); line(P(x, y + h)); line(start) } break
      case 's': case 'S': case 'b': case 'B': case 'b*': case 'B*': {
        if ((k === 's' || k === 'b' || k === 'b*') && start) line(start)
        const name = csSep.get(scs)
        if (name && DIE.test(name) && !NOT_DIE.test(name)) { const l = segs.get(name) || []; l.push(...path); segs.set(name, l) }
        path = []; cur = start = null; break
      }
      case 'f': case 'F': case 'f*': case 'n': path = []; cur = start = null; break
    }
    args = []
  }
  const all = Array.from(segs.values()).flat()
  if (all.length < 8) return null
  const IN = 72, q = (v: number) => Math.round(v * 100) / 100
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const s of all) { x0 = Math.min(x0, s[0], s[2]); x1 = Math.max(x1, s[0], s[2]); y0 = Math.min(y0, s[1], s[3]); y1 = Math.max(y1, s[1], s[3]) }
  // collinear axis-aligned lines, merged by position (0.5 pt)
  const V = new Map<number, { len: number; lo: number; hi: number }>(), H = new Map<number, { len: number; lo: number; hi: number }>()
  const put = (m: Map<number, { len: number; lo: number; hi: number }>, pos: number, a: number, b: number) => {
    const key = Math.round(pos * 2) / 2, lo = Math.min(a, b), hi = Math.max(a, b)
    const e = m.get(key); if (e) { e.len += hi - lo; e.lo = Math.min(e.lo, lo); e.hi = Math.max(e.hi, hi) } else m.set(key, { len: hi - lo, lo, hi })
  }
  for (const s of all) {
    if (!s[4]) continue
    if (Math.abs(s[0] - s[2]) < 0.3 && Math.abs(s[1] - s[3]) > 1) put(V, s[0], s[1], s[3])
    else if (Math.abs(s[1] - s[3]) < 0.3 && Math.abs(s[0] - s[2]) > 1) put(H, s[1], s[0], s[2])
  }
  const major = (m: Map<number, { len: number; lo: number; hi: number }>) => {
    const max = Math.max(0, ...Array.from(m.values()).map(e => e.len))
    return Array.from(m.entries()).filter(([, e]) => e.len >= max * 0.6 && e.len > 36).map(([pos, e]) => ({ pos, ...e })).sort((a, b) => a.pos - b.pos)
  }
  let hs = major(H), vs = major(V)
  // keep only fold / cut lines of the carton body: verticals inside the span of the long horizontals, and vice versa
  // (drops a bleed outline drawn 1/8 in outside the cut)
  if (hs.length >= 2) { const lo = Math.min(...hs.map(h => h.lo)) - 1, hi = Math.max(...hs.map(h => h.hi)) + 1; const f = vs.filter(v => v.pos >= lo && v.pos <= hi); if (f.length >= 2) vs = f }
  if (vs.length >= 2) { const lo = Math.min(...vs.map(v => v.lo)) - 1, hi = Math.max(...vs.map(v => v.hi)) + 1; const f = hs.filter(h => h.pos >= lo && h.pos <= hi); if (f.length >= 2) hs = f }
  const gaps = (l: { pos: number }[]) => l.slice(1).map((e, i) => q((e.pos - l[i].pos) / IN)).filter(g => g >= 0.2)
  const across = gaps(vs), down = gaps(hs).reverse() // PDF y runs upward → list top to bottom
  if (across.length < 2 || !down.length) return null // only part of the die is on this plate — nothing reliable to report
  let box: SpecMeasured['box'] = null
  if (across.length >= 4 && down.length >= 1) {
    // tuck-end carton: panels alternate face / side / face / side
    for (let i = 0; i + 3 < across.length && !box; i++) {
      const [a, b, c, d] = across.slice(i, i + 4)
      if (Math.abs(a - c) <= 0.07 && Math.abs(b - d) <= 0.07 && Math.abs(a - b) > 0.07) box = { w: Math.max(a, b), d: Math.min(Math.max(a, c), Math.max(b, d)), h: Math.max(...down) }
    }
  }
  return { unit: 'in', extents: { w: q((x1 - x0) / IN), h: q((y1 - y0) / IN) }, across, down, box, plate: Array.from(segs.keys()).join(', ') }
}

// ── dimension callouts (text on the dieline) ───────────────────────────────
async function readDims(pdfBytes: Uint8Array): Promise<{ page: { w: number; h: number }; dims: SpecDim[] }> {
  const pdfjs = await getPdfjs()
  const doc = await pdfjs.getDocument({ data: pdfBytes.slice(), isOffscreenCanvasSupported: false, disableFontFace: true }).promise // pdf.js detaches the buffer it is given
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
  let scan: PdfScan | null = null
  let measured: SpecMeasured | null = null
  if (isPdf) scan = scanPdf(bytes, tally, plates)
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
    try {
      // die geometry: straight from the PDF, or from the PDF Ghostscript made of the EPS / PS
      const s2 = isPdf ? scan! : scanPdf(pdf, new Map(), new Map())
      measured = measureDie(pageContent(pdf, s2.raw), s2.csSep)
    } catch (e) { console.warn('die measure', e) }
  } catch (e: any) { notes.push('Dimension callouts could not be read: ' + (e?.message || e)) }

  const all = Array.from(tally.values())
  const paper = all.some(e => e.v.every(x => x < 0.5))
  const colors = all.filter(e => !e.v.every(x => x < 0.5)).sort((a, b) => b.uses - a.uses).map(e => {
    const [c, m, y, k] = e.v.map(r1)
    return { c, m, y, k, uses: e.uses, hex: cmykHex(c, m, y, k), label: cmykLabel(c, m, y, k) }
  })
  labPlates.forEach((_, n) => plates.delete(n)); cmykPlates.forEach((v, n) => plates.set(n, v))
  rgbPlates.forEach((_, n) => { if (plates.get(n) == null) plates.delete(n); else rgbPlates.delete(n) })
  // RGB colours (artwork saved in RGB): merge near-identical values, most used first
  const rgbAll = Array.from(scan?.rgb.values() || []).sort((a, b) => b.uses - a.uses)
  const rgbList: SpecRgb[] = []
  for (const e of rgbAll) {
    const hit = rgbList.find(c => Math.abs(c.r - e.v[0]) <= 6 && Math.abs(c.g - e.v[1]) <= 6 && Math.abs(c.b - e.v[2]) <= 6)
    if (hit) hit.uses += e.uses
    else rgbList.push({ r: e.v[0], g: e.v[1], b: e.v[2], uses: e.uses, hex: rgbHex(e.v[0], e.v[1], e.v[2]), label: `R${e.v[0]} G${e.v[1]} B${e.v[2]}` })
  }
  // strong (brand) colours first, then tints, then black / white
  const chroma = (c: SpecRgb) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)
  rgbList.sort((a, b) => chroma(b) - chroma(a) || b.uses - a.uses)
  const plateList: SpecPlate[] = [
    ...Array.from(plates.entries()).map(([n, v]) => ({ name: n, cmyk: v, hex: v ? cmykHex(v[0], v[1], v[2], v[3]) : '#999999', technical: TECH.test(n) })),
    ...Array.from(labPlates.entries()).map(([n, l]) => ({ name: n, cmyk: null, lab: l, hex: labHex(l[0], l[1], l[2]), technical: TECH.test(n) })),
    ...Array.from(rgbPlates.entries()).map(([n, c]) => ({ name: n, cmyk: null, rgb: c, hex: rgbHex(c[0], c[1], c[2]), technical: TECH.test(n) })),
  ]
  labPlates.clear(); cmykPlates.clear(); rgbPlates.clear()
  const unitCount = new Map<string, number>(); dims.forEach(d => unitCount.set(d.unit, (unitCount.get(d.unit) || 0) + d.uses))
  const main = Array.from(unitCount.entries()).sort((a, b) => b[1] - a[1])[0]?.[0]
  dims.sort((a, b) => (a.unit === main ? 0 : 1) - (b.unit === main ? 0 : 1) || b.value - a.value)
  const h = dims.filter(d => !d.vertical && d.unit === main), v = dims.filter(d => d.vertical && d.unit === main)
  const flat = h.length && v.length ? { w: h[0].value, h: v[0].value, unit: main! } : null
  if (!dims.length) notes.push(measured ? 'No dimension callouts are written in the file — sizes were measured from the die lines.' : 'No dimension callouts (e.g. “9.78 in”) were found as text in the file.')
  if (rgbList.length && !colors.length) notes.push('This artwork is saved in RGB, not CMYK. The values shown are the exact RGB colours in the file — the printer will need CMYK or Pantone values, so ask the designer for a CMYK file or agree the conversion before printing.')
  else if (rgbList.length) notes.push('This artwork mixes RGB and CMYK colours.')
  return {
    version: SPEC_VERSION, rgb: rgbList, measured, extracted_at: new Date().toISOString(), source_sha256: sha256, source_name: name,
    page, flat, dims, colors, plates: plateList, paper, notes,
  }
}
