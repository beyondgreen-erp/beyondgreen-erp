/* eslint-disable @typescript-eslint/no-explicit-any */
// Browser-side importers: SVG, PDF, Illustrator (.ai), EPS, PS, PNG/JPG.
// PDF-family files are normalised by Ghostscript (WASM, runs locally in the browser — the
// file never leaves the ERP) so fonts become outlines, then rebuilt as vectors.
import * as fabric from 'fabric'
import { importPdfPage } from './pdfImport'
import { sceneItemsToFabric } from './fabricScene'

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
export async function ghostscriptToPdf(input: Uint8Array, kind: 'pdf' | 'eps' | 'ps'): Promise<Uint8Array> {
  const run = async () => {
    const factory = await loadScript(`${GS}/gs.js`, 'Module')
    const errs: string[] = []
    const gs = await factory({ locateFile: (p: string) => `${GS}/${p}`, print: () => {}, printErr: (s: string) => errs.push(s), noInitialRun: true })
    const inName = '/input.' + kind
    gs.FS.writeFile(inName, input)
    const args = ['-dSAFER', '-dBATCH', '-dNOPAUSE', '-dQUIET', '-sDEVICE=pdfwrite', '-dNoOutputFonts', '-dCompatibilityLevel=1.6', '-dAutoRotatePages=/None', '-dFirstPage=1', '-dLastPage=1']
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

export async function importFile(file: File, onStatus?: (s: string) => void): Promise<ImportResult> {
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

  // PDF family
  let pdfBytes: Uint8Array = buf
  const warnings: string[] = []
  {
    onStatus?.(kind === 'pdf' ? (ext === 'ai' ? 'Converting Illustrator file…' : 'Converting PDF (outlining fonts)…') : `Interpreting ${kind.toUpperCase()}…`)
    try {
      pdfBytes = await ghostscriptToPdf(buf, kind === 'pdf' ? 'pdf' : kind)
    } catch (e: any) {
      if (kind !== 'pdf') throw e
      warnings.push('Font outlining step failed; live text may be missing. ' + (e?.message || ''))
    }
  }
  onStatus?.('Rebuilding vectors…')
  const pdfjs = await getPdfjs()
  const doc = await pdfjs.getDocument({ data: pdfBytes, isOffscreenCanvasSupported: false, disableFontFace: true }).promise
  if (doc.numPages > 1) warnings.push(`File has ${doc.numPages} pages/artboards — only the first was imported.`)
  const page = await doc.getPage(1)
  const res = await importPdfPage(pdfjs, page)
  const objects = sceneItemsToFabric(res.items, { pageClip: { w: res.width, h: res.height } })
  // Drop a full-page white background rectangle if the exporter added one.
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
