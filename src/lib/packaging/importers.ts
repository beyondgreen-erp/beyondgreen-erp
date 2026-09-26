/* eslint-disable @typescript-eslint/no-explicit-any */
// Browser-side importers: SVG, PDF, Illustrator (.ai), EPS, PS, PNG/JPG.
// PDF-family files are normalised by Ghostscript (WASM, runs locally in the browser — the
// file never leaves the ERP) so fonts become outlines, then rebuilt as vectors.
import * as fabric from 'fabric'
import { importPdfPage } from './pdfImport'
import { sceneItemsToFabric } from './fabricScene'
import { matchFamily } from './fonts'
import { unzlibSync } from 'fflate'

const toBin = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(u.subarray(i, i + 0x8000))); return s }
const fromBin = (s: string) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff; return u }

/**
 * Ghostscript writes CIE Lab colours (e.g. a "Cut" spot plate with a Lab alternate) as ICCBased spaces
 * carrying a Lab profile. pdf.js treats any 3-component ICCBased space as RGB, so those colours come out
 * wrong (the red cut line becomes white). Rewrite such spaces back to plain /Lab and rebuild the xref.
 */
export function fixLabIccSpaces(pdf: Uint8Array): { bytes: Uint8Array; fixed: number } {
  let s = toBin(pdf)
  const labStreams = new Set<string>()
  const objRe = /(?:^|[\r\n])(\d+) 0 obj\s*<<((?:(?!endobj)[\s\S])*?)>>\s*stream\r?\n/g
  let m: RegExpExecArray | null
  while ((m = objRe.exec(s))) {
    const dict = m[2]
    if (!/\/N\s+3\b/.test(dict) || /\/Type\s*\/XObject/.test(dict)) continue
    const lenM = dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/)
    const start = m.index + m[0].length
    const end = lenM ? start + Number(lenM[1]) : s.indexOf('endstream', start)
    let head = fromBin(s.slice(start, Math.min(end, start + 64)))
    if (/\/FlateDecode/.test(dict)) { try { head = unzlibSync(fromBin(s.slice(start, end))).subarray(0, 64) } catch { continue } }
    if (head.length >= 24 && String.fromCharCode(...Array.from(head.subarray(12, 20))) === 'spacLab ') labStreams.add(m[1])
  }
  if (!labStreams.size) return { bytes: pdf, fixed: 0 }
  let fixed = 0
  s = s.replace(/\[\s*\/ICCBased\s+(\d+)\s+0\s+R\s*\]/g, (all, n) => labStreams.has(n) ? (fixed++, '[/Lab<</WhitePoint[0.9642 1 0.8249]/Range[-128 127 -128 127]>>]') : all)
  if (!fixed) return { bytes: pdf, fixed: 0 }
  // rebuild the classic xref table so byte offsets stay valid
  const x = s.lastIndexOf('\nxref')
  const t = s.indexOf('trailer', x)
  if (x < 0 || t < 0) return { bytes: fromBin(s), fixed } // pdf.js reconstructs broken xrefs itself
  const offs = new Map<number, number>()
  const re2 = /(^|[\r\n])(\d+) 0 obj\b/g
  while ((m = re2.exec(s.slice(0, x)))) offs.set(Number(m[2]), m.index + m[1].length)
  const size = Math.max(...Array.from(offs.keys())) + 1
  let tbl = `xref\n0 ${size}\n0000000000 65535 f \n`
  for (let i = 1; i < size; i++) tbl += offs.has(i) ? String(offs.get(i)).padStart(10, '0') + ' 00000 n \n' : '0000000000 65535 f \n'
  const trailer = s.slice(t, s.indexOf('startxref', t)).replace(/\/Size\s+\d+/, `/Size ${size}`)
  s = s.slice(0, x + 1) + tbl + trailer + `startxref\n${x + 1}\n%%EOF\n`
  return { bytes: fromBin(s), fixed }
}

function loadScript(src: string, globalName: string): Promise<any> {
  const w = window as any
  if (w[globalName]) return Promise.resolve(w[globalName])
  const key = '__loading_' + globalName
  if (w[key]) return w[key]
  w[key] = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src; s.async = true
    s.onload = () => w[globalName] ? resolve(w[globalName]) : reject(new Error(globalName + ' did not load'))
    s.onerror = () => reject(new Error('Could not load ' + src))
    document.head.appendChild(s)
  })
  return w[key]
}

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build'
const GS = 'https://cdn.jsdelivr.net/npm/@jspawn/ghostscript-wasm@0.0.2' // AGPL Ghostscript 9.56, unmodified

export async function getPdfjs(): Promise<any> {
  const lib = await loadScript(`${PDFJS}/pdf.min.js`, 'pdfjsLib')
  lib.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.js`
  return lib
}

let gsQueue: Promise<unknown> = Promise.resolve()
/** Run Ghostscript (WASM) → PDF with all text converted to outlines. */
export async function ghostscriptToPdf(input: Uint8Array, kind: 'pdf' | 'eps' | 'ps', outlineText = true): Promise<Uint8Array> {
  const run = async () => {
    const factory = await loadScript(`${GS}/gs.js`, 'Module')
    const errs: string[] = []
    const gs = await factory({ locateFile: (p: string) => `${GS}/${p}`, print: () => {}, printErr: (s: string) => errs.push(s), noInitialRun: true })
    const inName = '/input.' + kind
    gs.FS.writeFile(inName, input)
    const args = ['-dSAFER', '-dBATCH', '-dNOPAUSE', '-dQUIET', '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.6', '-dAutoRotatePages=/None', '-dFirstPage=1', '-dLastPage=1']
    if (outlineText) args.push('-dNoOutputFonts')
    if (kind === 'eps') args.push('-dEPSCrop')
    args.push('-sOutputFile=/output.pdf', inName)
    const code = gs.callMain(args)
    let out: Uint8Array | null = null
    try { out = gs.FS.readFile('/output.pdf') } catch { /* none */ }
    if (!out || !out.length) throw new Error('Ghostscript could not read this file' + (errs.length ? ': ' + errs.slice(-3).join(' ') : ` (code ${code})`))
    return out
  }
  const p = gsQueue.then(run, run)
  gsQueue = p.catch(() => undefined)
  return p
}

export interface ImportResult { width: number; height: number; objects: fabric.FabricObject[]; warnings: string[]; kind: string }

function extOf(name: string) { return (name.split('.').pop() || '').toLowerCase() }

async function sniff(buf: Uint8Array): Promise<'pdf' | 'eps' | 'ps' | 'svg' | 'png' | 'jpg' | 'unknown'> {
  const head = new TextDecoder('latin1').decode(buf.slice(0, 1024))
  if (buf[0] === 0xc5 && buf[1] === 0xd0 && buf[2] === 0xd3 && buf[3] === 0xc6) return 'eps' // DOS EPS binary header
  if (head.startsWith('%PDF') || head.includes('%PDF-')) return 'pdf'
  if (head.startsWith('%!PS-Adobe') && head.includes('EPSF')) return 'eps'
  if (head.startsWith('%!')) return 'ps'
  if (/<svg[\s>]/i.test(head) || head.trimStart().startsWith('<?xml')) return 'svg'
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png'
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg'
  return 'unknown'
}

export const ACCEPT = '.ai,.pdf,.eps,.ps,.svg,.png,.jpg,.jpeg'

export interface ImportOptions {
  /** 'live' keeps text retypable (fonts matched to the library); 'outline' converts it to exact vector shapes */
  text?: 'live' | 'outline'
}

export async function importFile(file: File, onStatus?: (s: string) => void, opts: ImportOptions = {}): Promise<ImportResult> {
  const textMode = opts.text || 'live'
  const buf = new Uint8Array(await file.arrayBuffer())
  const ext = extOf(file.name)
  let kind = await sniff(buf)
  if (kind === 'unknown' && ext === 'ai') kind = 'ps' // very old PostScript-based Illustrator files

  if (kind === 'svg') {
    onStatus?.('Reading SVG…')
    return importSvg(new TextDecoder().decode(buf))
  }
  if (kind === 'png' || kind === 'jpg') {
    const url = URL.createObjectURL(file)
    const img = await fabric.FabricImage.fromURL(url)
    return { width: img.width!, height: img.height!, objects: [img], warnings: [], kind }
  }
  if (kind === 'unknown') throw new Error('Unsupported file. Use AI, PDF, EPS, PS, SVG, PNG or JPG.')

  // PDF family (.ai files saved with PDF compatibility — Illustrator's default — are PDFs inside)
  let pdfBytes: Uint8Array = buf
  const warnings: string[] = []
  if (kind !== 'pdf' || textMode === 'outline') {
    onStatus?.(kind === 'pdf' ? 'Converting text to outlines…' : `Interpreting ${kind.toUpperCase()}…`)
    try {
      pdfBytes = await ghostscriptToPdf(buf, kind === 'pdf' ? 'pdf' : kind, textMode === 'outline')
      pdfBytes = fixLabIccSpaces(pdfBytes).bytes
    } catch (e: any) {
      if (kind !== 'pdf') throw e
      warnings.push('Could not convert text to outlines — text was kept live instead. ' + (e?.message || ''))
    }
  }
  onStatus?.(ext === 'ai' ? 'Rebuilding Illustrator artwork…' : 'Rebuilding vectors…')
  const pdfjs = await getPdfjs()
  let doc: any
  try {
    doc = await pdfjs.getDocument({ data: pdfBytes, isOffscreenCanvasSupported: false, disableFontFace: true, fontExtraProperties: true }).promise
  } catch (e: any) {
    if (ext === 'ai') throw new Error('This .ai file was saved without "Create PDF Compatible File". In Illustrator, re-save it with that option ticked (it is on by default), or save a copy as PDF/EPS, then upload again.')
    throw e
  }
  if (doc.numPages > 1) warnings.push(`File has ${doc.numPages} pages/artboards — only the first was imported.`)
  const page = await doc.getPage(1)
  const res = await importPdfPage(pdfjs, page, { text: textMode })
  onStatus?.('Placing objects…')
  // report font substitutions for live text
  const subs = new Map<string, string>()
  for (const it of res.items) if (it.kind === 'text') {
    const fam = matchFamily(it.fontName)
    const base = it.fontName.split(/[-,]/)[0]
    if (base && fam.replace(/\s/g, '').toLowerCase() !== base.replace(/\s/g, '').toLowerCase()) subs.set(base, fam)
  }
  if (subs.size) warnings.push('Fonts not in the library were matched to the closest one: ' + Array.from(subs).map(([a, b]) => `${a} → ${b}`).join(', ') + '. Import with "Convert text to outlines" to keep the exact lettering.')
  const objects = await sceneItemsToFabric(res.items, { pageClip: { w: res.width, h: res.height } })
  return { width: res.width, height: res.height, objects, warnings: [...warnings, ...res.warnings], kind: ext === 'ai' ? 'ai' : kind }
}

async function importSvg(text: string): Promise<ImportResult> {
  const { objects, options } = await fabric.loadSVGFromString(text)
  const objs = objects.filter(Boolean) as fabric.FabricObject[]
  // Physical size: honour width/height with absolute units; otherwise 1 user unit = 1 pt (Illustrator convention)
  const svg = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement
  const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number)
  const toPt = (v: string | null) => {
    if (!v) return null
    const m = v.match(/^([\d.]+)\s*(in|mm|cm|pt|pc|px)?$/); if (!m) return null
    const n = parseFloat(m[1]); const u = m[2] || 'px'
    return u === 'in' ? n * 72 : u === 'mm' ? n * 72 / 25.4 : u === 'cm' ? n * 720 / 25.4 : u === 'pc' ? n * 12 : n
  }
  // fabric has already applied the viewBox → width/height mapping (in CSS px); rescale to points.
  const fw = Number((options as any).width) || (vb.length === 4 ? vb[2] : 612)
  const fh = Number((options as any).height) || (vb.length === 4 ? vb[3] : 792)
  const wAttr = svg.getAttribute('width'), hAttr = svg.getAttribute('height')
  const absolute = (v: string | null) => !!v && /(in|mm|cm|pt|pc)\s*$/.test(v)
  const wPt = absolute(wAttr) ? toPt(wAttr)! : (vb.length === 4 ? vb[2] : fw)
  const hPt = absolute(hAttr) ? toPt(hAttr)! : (vb.length === 4 ? vb[3] : fh)
  const s = fw ? wPt / fw : 1
  if (Math.abs(s - 1) > 1e-4) {
    for (const o of objs) fabric.util.applyTransformToObject(o, fabric.util.multiplyTransformMatrices([s, 0, 0, s, 0, 0], o.calcTransformMatrix()))
  }
  return { width: wPt || 612, height: hPt || 792, objects: objs, warnings: [], kind: 'svg' }
}
