'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Visual preview of a document's file (first page / the image itself).
 * Thumbnails are made once in the browser (PDF + Illustrator via pdf.js, EPS via Ghostscript,
 * images resized), saved to storage under doc-thumbs/ and recorded in document_thumbs, so everyone
 * after that just loads a small JPEG.
 */
import { useEffect, useRef, useState } from 'react'

const BUCKET = 'erp-files'
const IMG = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']
const PDFLIKE = ['pdf', 'ai']
const EPS = ['eps', 'ps']
const MAX = 520
export const extOf = (name?: string | null) => (name || '').split('.').pop()?.toLowerCase() || ''
export const canThumb = (name?: string | null) => { const e = extOf(name); return IMG.includes(e) || PDFLIKE.includes(e) || EPS.includes(e) }

const STYLE: Record<string, { bg: string; fg: string; icon: string }> = {
  pdf: { bg: '#FEE2E2', fg: '#B91C1C', icon: 'ti-file-type-pdf' },
  doc: { bg: '#DBEAFE', fg: '#1D4ED8', icon: 'ti-file-type-doc' }, docx: { bg: '#DBEAFE', fg: '#1D4ED8', icon: 'ti-file-type-docx' },
  xls: { bg: '#DCFCE7', fg: '#15803D', icon: 'ti-file-type-xls' }, xlsx: { bg: '#DCFCE7', fg: '#15803D', icon: 'ti-file-spreadsheet' }, csv: { bg: '#DCFCE7', fg: '#15803D', icon: 'ti-file-type-csv' },
  ppt: { bg: '#FFEDD5', fg: '#C2410C', icon: 'ti-file-type-ppt' }, pptx: { bg: '#FFEDD5', fg: '#C2410C', icon: 'ti-presentation' },
  zip: { bg: '#FEF9C3', fg: '#A16207', icon: 'ti-file-zip' }, html: { bg: '#E0E7FF', fg: '#4338CA', icon: 'ti-file-type-html' },
  eps: { bg: '#F3E8FF', fg: '#7E22CE', icon: 'ti-vector' }, ai: { bg: '#FFEDD5', fg: '#C2410C', icon: 'ti-vector-bezier' },
}

// ── tiny job queue so a folder of 70 files doesn't fire 70 renders at once
let active = 0
const queue: (() => void)[] = []
const JOB_TIMEOUT = 60000
function withTimeout<T>(p: Promise<T>): Promise<T> {
  return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('preview timed out')), JOB_TIMEOUT); p.then(v => { clearTimeout(t); res(v) }, e => { clearTimeout(t); rej(e) }) })
}
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((res, rej) => { queue.push(() => { active++; withTimeout(fn()).then(res, rej).finally(() => { active--; pump() }) }); pump() })
}
function pump() { while (active < 3 && queue.length) queue.shift()!() }
const inflight = new Map<string, Promise<string | null>>()
const failed = new Set<string>()

function loadScript(src: string, globalName: string): Promise<any> {
  const w = window as any
  if (w[globalName]) return Promise.resolve(w[globalName])
  const key = '__loading_' + globalName
  if (w[key]) return w[key]
  w[key] = new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = src; s.async = true
    s.onload = () => (w[globalName] ? resolve(w[globalName]) : reject(new Error(globalName + ' did not load')))
    s.onerror = () => reject(new Error('Could not load ' + src))
    document.head.appendChild(s)
  })
  return w[key]
}
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build'
async function pdfjs() { const lib = await loadScript(`${PDFJS}/pdf.min.js`, 'pdfjsLib'); lib.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.js`; return lib }

function canvasToJpeg(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', 0.82))
}
async function renderPdf(bytes: Uint8Array): Promise<Blob> {
  const lib = await pdfjs()
  const doc = await lib.getDocument({ data: bytes, isOffscreenCanvasSupported: false }).promise
  try {
    const page = await doc.getPage(1)
    const v1 = page.getViewport({ scale: 1 })
    const scale = Math.min(3, MAX / Math.max(v1.width, v1.height))
    const vp = page.getViewport({ scale })
    const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height)
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
    await page.render({ canvasContext: ctx, viewport: vp }).promise
    return canvasToJpeg(c)
  } finally { doc.destroy?.() }
}
async function renderImage(blob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image')); i.src = url })
    const w = img.naturalWidth || MAX, h = img.naturalHeight || MAX
    const s = Math.min(1, MAX / Math.max(w, h))
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s))
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height)
    return canvasToJpeg(c)
  } finally { URL.revokeObjectURL(url) }
}

async function generate(sb: any, docId: string, srcPath: string, name: string): Promise<string | null> {
  const ext = extOf(name)
  const { data: file, error } = await sb.storage.from(BUCKET).download(srcPath)
  if (error || !file) throw new Error(error?.message || 'download failed')
  let thumb: Blob
  if (IMG.includes(ext)) thumb = await renderImage(ext === 'svg' ? new Blob([await file.arrayBuffer()], { type: 'image/svg+xml' }) : file)
  else if (PDFLIKE.includes(ext)) thumb = await renderPdf(new Uint8Array(await file.arrayBuffer()))
  else if (EPS.includes(ext)) {
    const { ghostscriptToPdf } = await import('@/lib/packaging/importers')
    thumb = await renderPdf(await ghostscriptToPdf(new Uint8Array(await file.arrayBuffer()), ext as 'eps' | 'ps', false))
  } else return null
  const path = `doc-thumbs/${docId}/${Date.now()}.jpg`
  const up = await sb.storage.from(BUCKET).upload(path, thumb, { contentType: 'image/jpeg', upsert: true })
  if (up.error) throw new Error(up.error.message)
  await sb.from('document_thumbs').upsert({ document_id: docId, src_path: srcPath, thumb_path: path, updated_at: new Date().toISOString() })
  const { data } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600)
  return data?.signedUrl || null
}

/** Loads saved thumbnails for the given documents in one round trip: docId → { src, url }. */
export async function loadThumbs(sb: any, ids?: string[]): Promise<Record<string, { src: string; url: string }>> {
  let q = sb.from('document_thumbs').select('document_id,src_path,thumb_path')
  if (ids) { if (!ids.length) return {}; q = q.in('document_id', ids) }
  const { data } = await q
  const rows = (data as { document_id: string; src_path: string; thumb_path: string }[]) || []
  if (!rows.length) return {}
  const { data: signed } = await sb.storage.from(BUCKET).createSignedUrls(rows.map(r => r.thumb_path), 3600)
  const byPath = new Map<string, string>(((signed as any[]) || []).filter(s => s.signedUrl).map(s => [s.path, s.signedUrl]))
  const out: Record<string, { src: string; url: string }> = {}
  for (const r of rows) { const u = byPath.get(r.thumb_path); if (u) out[r.document_id] = { src: r.src_path, url: u } }
  return out
}

interface Props { sb: any; docId: string; file: { path: string; name: string } | null; saved?: { src: string; url: string }; className?: string; big?: boolean }

export default function DocThumb({ sb, docId, file, saved, className = '', big }: Props) {
  const ok = saved && file && saved.src === file.path ? saved.url : null
  const [url, setUrl] = useState<string | null>(ok)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (ok) setUrl(ok) }, [ok])

  useEffect(() => {
    if (url || !file || !canThumb(file.name)) return
    const key = docId + '|' + file.path
    if (failed.has(key)) return
    const el = ref.current
    if (!el) return
    let alive = true
    const io = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return
      io.disconnect()
      setBusy(true)
      let p = inflight.get(key)
      if (!p) { p = enqueue(() => generate(sb, docId, file.path, file.name)); inflight.set(key, p) }
      p.then(u => { if (alive && u) setUrl(u) })
        .catch(() => { failed.add(key) })
        .finally(() => { inflight.delete(key); if (alive) setBusy(false) })
    }, { rootMargin: '300px' })
    io.observe(el)
    return () => { alive = false; io.disconnect() }
  }, [url, file, docId, sb])

  const ext = extOf(file?.name)
  const st = STYLE[ext] || { bg: '#F3F4F6', fg: '#6B7280', icon: file ? 'ti-file' : 'ti-file-off' }
  return (
    <div ref={ref} className={`relative w-full h-full flex items-center justify-center overflow-hidden ${className}`} style={url ? { background: '#F5F6FA' } : { background: st.bg }}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" loading="lazy" draggable={false} className={`max-w-full max-h-full object-contain ${big ? '' : 'p-2'} drop-shadow-sm`} onError={() => setUrl(null)} />
      ) : (
        <div className="flex flex-col items-center gap-1" style={{ color: st.fg }}>
          <i className={`ti ${st.icon} ${big ? 'text-6xl' : 'text-4xl'}`} />
          <span className="text-[10px] font-bold tracking-wider uppercase">{file ? ext || 'file' : 'no file'}</span>
          {busy && <span className="text-[10px] opacity-70">Making preview…</span>}
        </div>
      )}
      {url && ext && <span className="absolute bottom-1.5 right-1.5 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: st.bg, color: st.fg }}>{ext}</span>}
    </div>
  )
}
