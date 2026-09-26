/* eslint-disable @typescript-eslint/no-explicit-any */
// One entry point for every export format. All formats are produced in the browser.
import * as fabric from 'fabric'
import { zipSync } from 'fflate'
import { fabricToScene } from './fabricScene'
import { writePdf } from './writePdf'
import { writePs } from './writePs'
import { writeSvg } from './writeSvg'
import type { DocLayer } from './doc'
import type { ImageItem } from './scene'
import { buildProofObjects, sheetLayout, loadBrandLogo, type ProofInfo } from './proofTemplate'
import { transformSegs, rectSegs, multiply as mmul, type SceneItem } from './scene'

export type ExportFormat = 'ai' | 'eps' | 'pdf' | 'ps' | 'svg' | 'png' | 'jpg'

export const FORMATS: { key: ExportFormat; label: string; desc: string; mime: string }[] = [
  { key: 'ai', label: 'AI', desc: 'Adobe Illustrator (PDF-compatible) — opens in Illustrator, imports into CorelDRAW', mime: 'application/postscript' },
  { key: 'eps', label: 'EPS', desc: 'Encapsulated PostScript — universal for printers, CorelDRAW & Illustrator', mime: 'application/postscript' },
  { key: 'pdf', label: 'PDF', desc: 'Print-ready vector PDF with layers & spot colours', mime: 'application/pdf' },
  { key: 'ps', label: 'PS', desc: 'PostScript — send straight to a RIP', mime: 'application/postscript' },
  { key: 'svg', label: 'SVG', desc: 'Scalable vector — web & CorelDRAW import', mime: 'image/svg+xml' },
  { key: 'png', label: 'PNG', desc: 'Raster image, transparent background', mime: 'image/png' },
  { key: 'jpg', label: 'JPG', desc: 'Raster image, white background', mime: 'image/jpeg' },
]

export interface ExportOptions {
  includeDieline: boolean
  convertToCmyk: boolean
  dpi: number
  jpgQuality: number
}
export const DEFAULT_EXPORT: ExportOptions = { includeDieline: true, convertToCmyk: true, dpi: 300, jpgQuality: 0.92 }

export interface ExportDoc { width: number; height: number; title: string; layers: DocLayer[] }

function rgbaToPngDataUrl(it: ImageItem): string {
  const c = document.createElement('canvas'); c.width = it.w; c.height = it.h
  const ctx = c.getContext('2d')!
  const id = ctx.createImageData(it.w, it.h); id.data.set(it.rgba); ctx.putImageData(id, 0, 0)
  return c.toDataURL('image/png')
}

async function raster(canvas: fabric.Canvas | fabric.StaticCanvas, doc: ExportDoc, fmt: 'png' | 'jpg', o: ExportOptions): Promise<{ blob: Blob; warnings: string[] }> {
  const warnings: string[] = []
  let mult = o.dpi / 72
  const maxSide = 16000, maxArea = 180e6
  const scaleCap = Math.min(maxSide / (doc.width * mult), maxSide / (doc.height * mult), Math.sqrt(maxArea / (doc.width * mult * doc.height * mult)), 1)
  if (scaleCap < 1) { mult *= scaleCap; warnings.push(`Artwork is very large — ${fmt.toUpperCase()} rendered at ${Math.floor(mult * 72)} dpi (browser limit).`) }
  const hiddenLayers = new Set(doc.layers.filter(l => !l.visible || (!o.includeDieline && l.kind === 'dieline')).map(l => l.id))
  const objs = canvas.getObjects() as any[]
  const restore: [any, boolean][] = []
  for (const obj of objs) {
    if (obj.isHelper || hiddenLayers.has(obj.layerId)) { restore.push([obj, obj.visible]); obj.visible = false }
  }
  const vpt = canvas.viewportTransform.slice() as any
  const bg = canvas.backgroundColor
  const active = (canvas as any).getActiveObject?.()
  if (active) (canvas as any).discardActiveObject?.()
  canvas.viewportTransform = [1, 0, 0, 1, 0, 0]
  canvas.backgroundColor = fmt === 'jpg' ? '#ffffff' : ''
  try {
    const url = canvas.toDataURL({ format: fmt === 'jpg' ? 'jpeg' : 'png', quality: o.jpgQuality, multiplier: mult, left: 0, top: 0, width: doc.width, height: doc.height, enableRetinaScaling: false } as any)
    const blob = await (await fetch(url)).blob()
    return { blob, warnings }
  } finally {
    canvas.viewportTransform = vpt
    canvas.backgroundColor = bg
    for (const [obj, v] of restore) obj.visible = v
    if (active) (canvas as any).setActiveObject?.(active)
    canvas.requestRenderAll()
  }
}

export async function exportDesign(canvas: fabric.Canvas | fabric.StaticCanvas, doc: ExportDoc, fmt: ExportFormat, o: ExportOptions = DEFAULT_EXPORT): Promise<{ blob: Blob; warnings: string[] }> {
  if (fmt === 'png' || fmt === 'jpg') return raster(canvas, doc, fmt, o)
  const { scene, warnings } = await fabricToScene(canvas, doc, { layerFilter: l => o.includeDieline || l.kind !== 'dieline' })
  const hasTransparency = scene.layers.some(l => l.items.some(i => i.opacity < 1))
  switch (fmt) {
    case 'pdf': case 'ai':
      return { blob: new Blob([writePdf(scene, { flattenToCmyk: o.convertToCmyk }) as any], { type: fmt === 'pdf' ? 'application/pdf' : 'application/postscript' }), warnings }
    case 'eps': case 'ps':
      if (hasTransparency) warnings.push(`${fmt.toUpperCase()} has no live transparency — semi-transparent objects print at full strength.`)
      return { blob: new Blob([writePs(scene, { eps: fmt === 'eps', flattenToCmyk: o.convertToCmyk })], { type: 'application/postscript' }), warnings }
    case 'svg':
      return { blob: new Blob([writeSvg(scene, rgbaToPngDataUrl)], { type: 'image/svg+xml' }), warnings }
  }
}

export async function zipFiles(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const entries: Record<string, Uint8Array> = {}
  for (const f of files) entries[f.name] = new Uint8Array(await f.blob.arrayBuffer())
  return new Blob([zipSync(entries, { level: 6 }) as any], { type: 'application/zip' })
}

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 30000)
}

// ── Proof sheet: artwork placed on the official approval template, one vector PDF ──

export async function exportProofSheet(canvas: fabric.Canvas | fabric.StaticCanvas, doc: ExportDoc, info: ProofInfo, o: ExportOptions = DEFAULT_EXPORT): Promise<{ blob: Blob; warnings: string[] }> {
  const L = sheetLayout(doc.width, doc.height)
  const shift: [number, number, number, number, number, number] = [1, 0, 0, 1, -L.x, -L.y]
  const move = (it: SceneItem, extraClip?: any): SceneItem => {
    const clips = (it.clips || []).map(c => ({ ...c, segs: transformSegs(c.segs, shift) }))
    if (extraClip) clips.push(extraClip)
    return { ...it, m: mmul(shift, it.m), clips: clips.length ? clips : undefined } as SceneItem
  }
  // 1) template
  const el = document.createElement('canvas')
  const sc = new fabric.StaticCanvas(el, { width: 10, height: 10, renderOnAddRemove: false } as any)
  const logo = await loadBrandLogo()
  const tpl = buildProofObjects(info, doc.width, doc.height, logo)
  sc.add(...tpl)
  const tplLayer: DocLayer = { id: '__proof', name: 'Proof template', visible: true, locked: true, color: '#9CA3AF' }
  for (const t of tpl as any[]) t.layerId = '__proof'
  const t = await fabricToScene(sc, { ...doc, layers: [tplLayer] })
  sc.dispose()
  // 2) artwork, clipped to the artboard
  const a = await fabricToScene(canvas, doc, { layerFilter: l => o.includeDieline || l.kind !== 'dieline' })
  const artClip = { segs: transformSegs(rectSegs(0, 0, doc.width, doc.height), shift), rule: 'nonzero' as const }
  const layers = [
    ...t.scene.layers.map(l => ({ ...l, items: l.items.map(i => move(i)) })),
    ...a.scene.layers.map(l => ({ ...l, items: l.items.map(i => move(i, artClip)) })),
  ]
  const scene = { width: L.w, height: L.h, title: `${doc.title} — proof ${info.proofNo || ''}`.trim(), layers }
  return { blob: new Blob([writePdf(scene, { flattenToCmyk: false }) as any], { type: 'application/pdf' }), warnings: [...t.warnings, ...a.warnings] }
}
