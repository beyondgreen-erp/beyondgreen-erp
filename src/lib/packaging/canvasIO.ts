/* eslint-disable @typescript-eslint/no-explicit-any */
// Serialise / restore a fabric canvas to the DesignDoc JSON, with images stored as separate
// storage assets (so the working file stays small and autosaves stay fast).
import * as fabric from 'fabric'
import { type DesignDoc, OBJ_PROPS, sha1Hex } from './doc'
import { loadFamily } from './fonts'

export type AssetUploader = (path: string, blob: Blob) => Promise<void>
export type AssetResolver = (path: string) => Promise<string> // returns an object URL

async function elementBlob(el: any): Promise<Blob | null> {
  if (!el) return null
  if (el instanceof HTMLCanvasElement) return new Promise(r => el.toBlob(b => r(b), 'image/png'))
  const c = document.createElement('canvas')
  c.width = el.naturalWidth || el.width; c.height = el.naturalHeight || el.height
  c.getContext('2d')!.drawImage(el, 0, 0)
  return new Promise(r => c.toBlob(b => r(b), 'image/png'))
}

/** Upload any image that is not stored yet and stamp its assetPath. */
export async function ensureAssets(canvas: fabric.Canvas, designId: string, upload: AssetUploader) {
  const walk = async (objs: any[]) => {
    for (const o of objs) {
      if (o.type === 'group') await walk(o.getObjects())
      if (o.type !== 'image' || o.assetPath) continue
      const blob: Blob | null = o.__srcBlob || await elementBlob(o.getElement())
      if (!blob) continue
      const hash = await sha1Hex(await blob.arrayBuffer())
      const ext = blob.type === 'image/jpeg' ? 'jpg' : 'png'
      const path = `designs/${designId}/assets/${hash}.${ext}`
      await upload(path, blob)
      o.assetPath = path
      delete o.__srcBlob
    }
  }
  await walk(canvas.getObjects())
}

export function serialize(canvas: fabric.Canvas, doc: DesignDoc): DesignDoc {
  const objects = (canvas.getObjects() as any[]).filter(o => !o.isHelper).map(o => {
    const j: any = o.toObject(OBJ_PROPS)
    const fix = (x: any) => {
      if (x.type === 'Image' || x.type === 'image') { if (x.assetPath) x.src = 'asset:' + x.assetPath }
      if (Array.isArray(x.objects)) x.objects.forEach(fix)
    }
    fix(j)
    return j
  })
  return { ...doc, objects }
}

export async function restore(canvas: fabric.Canvas | fabric.StaticCanvas, doc: DesignDoc, resolveAsset: AssetResolver): Promise<void> {
  // resolve asset URLs + preload fonts used by text objects
  const fonts = new Set<string>()
  const prep = async (x: any) => {
    if ((x.type === 'Image' || x.type === 'image') && typeof x.src === 'string' && x.src.startsWith('asset:')) {
      x.assetPath = x.src.slice(6)
      try { x.src = await resolveAsset(x.assetPath) } catch { x.src = '' }
    }
    if (x.fontFamily) fonts.add(x.fontFamily)
    if (x.styles) JSON.stringify(x.styles).replace(/"fontFamily":"([^"]+)"/g, (_: string, f: string) => { fonts.add(f); return '' })
    if (Array.isArray(x.objects)) for (const c of x.objects) await prep(c)
  }
  const objs = JSON.parse(JSON.stringify(doc.objects || []))
  for (const o of objs) await prep(o)
  await Promise.all(Array.from(fonts).map(f => loadFamily(f).catch(() => undefined)))
  const helpers = (canvas.getObjects() as any[]).filter(o => o.isHelper)
  const enlivened = await fabric.util.enlivenObjects(objs) as fabric.FabricObject[]
  canvas.remove(...(canvas.getObjects() as any[]).filter(o => !o.isHelper))
  canvas.add(...enlivened)
  // keep helpers (artboard shading etc.) at the bottom
  helpers.forEach(h => canvas.sendObjectToBack(h))
}

export async function thumbnail(canvas: fabric.Canvas | fabric.StaticCanvas, doc: DesignDoc, maxPx = 480): Promise<Blob> {
  const mult = Math.min(maxPx / doc.width, maxPx / doc.height)
  const vpt = canvas.viewportTransform.slice() as any
  const hidden: any[] = []
  for (const o of canvas.getObjects() as any[]) if (o.isHelper && o.visible) { hidden.push(o); o.visible = false }
  const bg = canvas.backgroundColor
  canvas.viewportTransform = [1, 0, 0, 1, 0, 0]
  canvas.backgroundColor = '#ffffff'
  try {
    const url = canvas.toDataURL({ format: 'png', multiplier: mult, left: 0, top: 0, width: doc.width, height: doc.height, enableRetinaScaling: false } as any)
    return await (await fetch(url)).blob()
  } finally {
    canvas.viewportTransform = vpt; canvas.backgroundColor = bg
    hidden.forEach(o => (o.visible = true)); canvas.requestRenderAll()
  }
}
