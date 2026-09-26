/* eslint-disable @typescript-eslint/no-explicit-any */
// Fabric canvas  ⇄  renderer-independent Scene.
// fabricToScene() feeds every vector exporter; sceneItemsToFabric() turns imported
// PDF/AI/EPS/PS artwork into editable fabric objects.
import * as fabric from 'fabric'
import {
  type Scene, type SceneItem, type SceneLayer, type Mat, type Seg, type Paint, type Clip, type PathItem,
  multiply, parsePath, rectSegs, ellipseSegs, transformSegs, parseColor, segsToSvgD, segsBounds, rgbToHex, IDENTITY,
} from './scene'
import { getOutlineFont, loadFontFace, matchFamily } from './fonts'
import type { ImportItem, TextRunItem } from './pdfImport'
import type { DocLayer } from './doc'

const tl = (x: number, y: number): Mat => [1, 0, 0, 1, x, y]

function paintOf(obj: any, kind: 'fill' | 'stroke', warn: Set<string>): Paint | null {
  const v = obj[kind]
  if (!v) return null
  let rgb: [number, number, number] | null = null
  if (typeof v === 'string') {
    const c = parseColor(v)
    if (!c || c.alpha === 0) return null
    rgb = c.rgb
  } else if (v && Array.isArray(v.colorStops) && v.colorStops.length) {
    warn.add('Gradients were exported as a flat colour (first stop).')
    const c = parseColor(v.colorStops[0].color); rgb = c ? c.rgb : [0, 0, 0]
  } else return null
  const p: Paint = { rgb }
  const cmyk = obj[kind === 'fill' ? 'cmykFill' : 'cmykStroke']
  const spot = obj[kind === 'fill' ? 'spotFill' : 'spotStroke']
  if (Array.isArray(cmyk) && cmyk.length === 4) p.cmyk = cmyk.map((n: number) => n / 100) as any
  if (spot) p.spot = String(spot)
  return p
}

function styleOf(obj: any, warn: Set<string>) {
  return {
    fill: paintOf(obj, 'fill', warn),
    stroke: obj.strokeWidth > 0 ? paintOf(obj, 'stroke', warn) : null,
    strokeWidth: obj.strokeWidth || 0,
    cap: (obj.strokeLineCap || 'butt') as PathItem['cap'],
    join: ((obj.strokeLineJoin === 'miter-clip' ? 'miter' : obj.strokeLineJoin) || 'miter') as PathItem['join'],
    miter: obj.strokeMiterLimit || 4,
    dash: Array.isArray(obj.strokeDashArray) && obj.strokeDashArray.length ? obj.strokeDashArray.slice() : undefined,
    fillRule: (obj.fillRule === 'evenodd' ? 'evenodd' : 'nonzero') as PathItem['fillRule'],
    overprint: !!obj.overprint,
  }
}

/** Geometry of a primitive fabric object in its own (centred) local space. */
function localSegs(obj: any): Seg[] | null {
  const t = obj.type
  if (t === 'path') return transformSegs(parsePath(obj.path), tl(-obj.pathOffset.x, -obj.pathOffset.y))
  if (t === 'rect') return rectSegs(-obj.width / 2, -obj.height / 2, obj.width, obj.height, obj.rx || 0, obj.ry || 0)
  if (t === 'ellipse') return ellipseSegs(0, 0, obj.rx, obj.ry)
  if (t === 'circle') return ellipseSegs(0, 0, obj.radius, obj.radius)
  if (t === 'triangle') { const w = obj.width / 2, h = obj.height / 2; return [['M', -w, h], ['L', 0, -h], ['L', w, h], ['Z']] }
  if (t === 'line') { const p = obj.calcLinePoints(); return [['M', p.x1, p.y1], ['L', p.x2, p.y2]] }
  if (t === 'polygon' || t === 'polyline') {
    const pts = obj.points || []
    const segs: Seg[] = pts.map((p: any, i: number) => [i ? 'L' : 'M', p.x - obj.pathOffset.x, p.y - obj.pathOffset.y] as Seg)
    if (t === 'polygon' && segs.length) segs.push(['Z'])
    return segs
  }
  return null
}

function clipsOf(obj: any, parentClips: Clip[]): Clip[] {
  const out = parentClips.slice()
  const cp = obj.clipPath
  if (cp) {
    const segs = localSegs(cp)
    if (segs) {
      const m = cp.absolutePositioned ? cp.calcTransformMatrix() as Mat : multiply(obj.calcTransformMatrix() as Mat, cp.calcTransformMatrix() as Mat)
      out.push({ segs: transformSegs(segs, m), rule: cp.fillRule === 'evenodd' ? 'evenodd' : 'nonzero' })
    }
  }
  return out
}

async function textItems(obj: any, m: Mat, opacity: number, clips: Clip[], warn: Set<string>): Promise<SceneItem[]> {
  const out: SceneItem[] = []
  const lines: string[][] = obj._textLines || []
  let lineTop = -obj.height / 2
  for (let i = 0; i < lines.length; i++) {
    const heightImpl = obj.getHeightOfLineImpl ? obj.getHeightOfLineImpl(i) : obj.getHeightOfLine(i) / obj.lineHeight
    const baseline = lineTop + heightImpl * (1 - obj._fontSizeFraction)
    const left = -obj.width / 2 + obj._getLineLeftOffset(i)
    const bounds = obj.__charBounds?.[i] || []
    for (let j = 0; j < lines[i].length; j++) {
      const ch = lines[i][j]
      if (!ch || /^\s$/.test(ch)) continue
      const style = obj.getCompleteStyleDeclaration(i, j)
      const b = bounds[j] || { left: 0 }
      const { font, substituted } = await getOutlineFont(style.fontFamily, style.fontWeight, style.fontStyle)
      if (substituted) warn.add(`Font "${style.fontFamily}" is not in the font library — outlined with Inter.`)
      const size = style.fontSize
      const p = font.getPath(ch, left + b.left, baseline + (style.deltaY || 0), size)
      const segs: Seg[] = []
      let lx = 0, ly = 0
      for (const c of p.commands as any[]) {
        if (c.type === 'M') { segs.push(['M', c.x, c.y]); lx = c.x; ly = c.y }
        else if (c.type === 'L') { segs.push(['L', c.x, c.y]); lx = c.x; ly = c.y }
        else if (c.type === 'C') { segs.push(['C', c.x1, c.y1, c.x2, c.y2, c.x, c.y]); lx = c.x; ly = c.y }
        else if (c.type === 'Q') { segs.push(['C', lx + 2 / 3 * (c.x1 - lx), ly + 2 / 3 * (c.y1 - ly), c.x + 2 / 3 * (c.x1 - c.x), c.y + 2 / 3 * (c.y1 - c.y), c.x, c.y]); lx = c.x; ly = c.y }
        else if (c.type === 'Z') segs.push(['Z'])
      }
      if (!segs.length) continue
      const st = styleOf({ ...obj, ...style, cmykFill: obj.cmykFill, spotFill: obj.spotFill, cmykStroke: obj.cmykStroke, spotStroke: obj.spotStroke }, warn)
      out.push({ kind: 'path', m, segs, ...st, fillRule: 'nonzero', opacity, clips: clips.length ? clips : undefined })
      // decorations
      const deco = (dy: number) => {
        const w = (b.kernedWidth ?? b.width ?? 0), th = size / 15
        out.push({ kind: 'path', m, segs: rectSegs(left + b.left, baseline + dy - th / 2, w, th), ...st, stroke: null, fillRule: 'nonzero', opacity, clips: clips.length ? clips : undefined })
      }
      if (style.underline) deco(size * 0.1)
      if (style.linethrough) deco(-size * 0.28)
      if (style.overline) deco(-size * 0.82)
    }
    lineTop += obj.getHeightOfLine(i)
  }
  return out
}

function imageRgba(obj: any): { w: number; h: number; rgba: Uint8ClampedArray } | null {
  const el = obj.getElement?.() || obj._element
  if (!el) return null
  const w = Math.max(1, Math.round(obj.width)), h = Math.max(1, Math.round(obj.height))
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const ctx = c.getContext('2d')!
  ctx.drawImage(el, obj.cropX || 0, obj.cropY || 0, w, h, 0, 0, w, h)
  return { w, h, rgba: ctx.getImageData(0, 0, w, h).data }
}

async function objectItems(obj: any, parentOpacity: number, parentClips: Clip[], warn: Set<string>): Promise<SceneItem[]> {
  if (!obj || obj.visible === false || obj.isHelper) return []
  const opacity = parentOpacity * (obj.opacity ?? 1)
  const clips = clipsOf(obj, parentClips)
  const m = obj.calcTransformMatrix() as Mat
  const t = obj.type
  if (t === 'group' || t === 'activeselection' || t === 'activeSelection') {
    const out: SceneItem[] = []
    for (const child of obj.getObjects()) out.push(...await objectItems(child, opacity, clips, warn))
    return out
  }
  if (t === 'image') {
    const img = imageRgba(obj)
    if (!img) return []
    return [{ kind: 'image', m: multiply(m, tl(-obj.width / 2, -obj.height / 2)), w: img.w, h: img.h, rgba: img.rgba, opacity, clips: clips.length ? clips : undefined }]
  }
  if (t === 'i-text' || t === 'textbox' || t === 'text') return textItems(obj, m, opacity, clips, warn)
  const segs = localSegs(obj)
  if (!segs) { warn.add(`Unsupported object type "${t}" skipped.`); return [] }
  const st = styleOf(obj, warn)
  if (obj.strokeUniform && st.stroke) {
    return [{ kind: 'path', m: IDENTITY, segs: transformSegs(segs, m), ...st, opacity, clips: clips.length ? clips : undefined }]
  }
  return [{ kind: 'path', m, segs, ...st, opacity, clips: clips.length ? clips : undefined }]
}

export interface SceneOptions { includeHidden?: boolean; layerFilter?: (l: DocLayer) => boolean }

export async function fabricToScene(canvas: fabric.Canvas | fabric.StaticCanvas, doc: { width: number; height: number; title: string; layers: DocLayer[] }, opts: SceneOptions = {}): Promise<{ scene: Scene; warnings: string[] }> {
  const warn = new Set<string>()
  const objs = canvas.getObjects() as any[]
  const layers: SceneLayer[] = []
  // doc.layers is ordered top → bottom (like Illustrator's panel); scene layers paint bottom → top
  const ordered = doc.layers.slice().reverse()
  for (const l of ordered) {
    if (opts.layerFilter && !opts.layerFilter(l)) continue
    if (!l.visible && !opts.includeHidden) continue
    const items: SceneItem[] = []
    for (const o of objs) if ((o.layerId || ordered[0]?.id) === l.id) items.push(...await objectItems(o, 1, [], warn))
    layers.push({ name: l.name, visible: l.visible, items })
  }
  return { scene: { width: doc.width, height: doc.height, title: doc.title, layers }, warnings: Array.from(warn) }
}

// ── import: scene items → fabric objects ────────────────────────────────────
function rgbaToCanvas(w: number, h: number, rgba: Uint8Array | Uint8ClampedArray) {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const id = c.getContext('2d')!.createImageData(w, h); id.data.set(rgba)
  c.getContext('2d')!.putImageData(id, 0, 0)
  return c
}

function clipKey(clips?: Clip[]) {
  if (!clips || !clips.length) return ''
  // Use the tightest clip only — fabric supports a single clipPath per object/group.
  const c = tightest(clips)!
  return segsToSvgD(c.segs, 2) + c.rule
}
function tightest(clips: Clip[]): Clip | null {
  let best: Clip | null = null, area = Infinity
  for (const c of clips) {
    const b = segsBounds(c.segs); if (!b) continue
    const a = (b.x1 - b.x0) * (b.y1 - b.y0)
    if (a < area) { area = a; best = c }
  }
  return best
}

/** Converts imported items into fabric objects (in document space). Consecutive items that
 *  share a clip are wrapped in a clipped group, like an Illustrator clipping group. */
async function textRunToFabric(it: TextRunItem): Promise<fabric.FabricObject> {
  const family = matchFamily(it.fontName)
  const weight = it.bold ? 'bold' : 'normal', style = it.italic ? 'italic' : 'normal'
  await loadFontFace(family, weight, style)
  const t: any = new fabric.IText(it.text, {
    fontFamily: family, fontWeight: weight, fontStyle: style, fontSize: it.fontSize,
    fill: rgbToHex(it.fill), opacity: it.opacity, originX: 'left', originY: 'top', left: 0, top: 0, objectCaching: false,
  } as any)
  t.initDimensions()
  // Match the source run width by adjusting tracking (fonts may differ slightly from the original)
  const n = Array.from(it.text).length
  if (n > 1 && it.advance > 0 && t.width > 0) {
    const diff = it.advance - t.width
    const perChar = (diff / (n - 1)) / it.fontSize * 1000
    if (Math.abs(perChar) < 300) { t.set({ charSpacing: Math.round(perChar) }); t.initDimensions() }
  }
  t.sourceFont = it.fontName
  const baseline = t.getHeightOfLine ? (t.getHeightOfLine(0) / t.lineHeight) * (1 - t._fontSizeFraction) : it.fontSize * 0.88
  fabric.util.applyTransformToObject(t, multiply(it.m, tl(t.width / 2, t.height / 2 - baseline)) as any)
  t.setCoords()
  return t
}

/** Converts imported items into fabric objects (in document space). Consecutive items that
 *  share a clip are wrapped in a clipped group, like an Illustrator clipping group; its
 *  contents stay individually selectable and editable. */
export async function sceneItemsToFabric(items: ImportItem[], opts: { pageClip?: { w: number; h: number } } = {}): Promise<fabric.FabricObject[]> {
  const out: fabric.FabricObject[] = []
  const toObj = async (it: ImportItem): Promise<fabric.FabricObject | null> => {
    if (it.kind === 'text') return textRunToFabric(it)
    if (it.kind === 'path') {
      const segs = transformSegs(it.segs, it.m)
      if (!segs.length) return null
      const scale = Math.sqrt(Math.abs(it.m[0] * it.m[3] - it.m[1] * it.m[2])) || 1
      const p = new fabric.Path(segsToSvgD(segs, 3), {
        fill: it.fill ? rgbToHex(it.fill.rgb) : '',
        stroke: it.stroke ? rgbToHex(it.stroke.rgb) : undefined,
        strokeWidth: it.stroke ? it.strokeWidth * scale : 0,
        strokeLineCap: it.cap, strokeLineJoin: it.join, strokeMiterLimit: it.miter,
        strokeDashArray: it.dash ? it.dash.map(d => d * scale) : undefined,
        fillRule: it.fillRule, opacity: it.opacity, objectCaching: false,
      } as any)
      return p
    }
    const el = rgbaToCanvas(it.w, it.h, it.rgba)
    const img = new fabric.FabricImage(el as any, { originX: 'left', originY: 'top', left: 0, top: 0, opacity: it.opacity } as any)
    fabric.util.applyTransformToObject(img, multiply(it.m, tl(it.w / 2, it.h / 2)) as any)
    return img
  }
  let i = 0
  while (i < items.length) {
    const key = clipKey(items[i].clips)
    // ignore clips that are simply the page / artboard
    const c = items[i].clips ? tightest(items[i].clips!) : null
    const b = c ? segsBounds(c.segs) : null
    const isPage = !c || (opts.pageClip && b && b.x0 <= 0.5 && b.y0 <= 0.5 && b.x1 >= opts.pageClip.w - 0.5 && b.y1 >= opts.pageClip.h - 0.5)
    if (isPage) { const o = await toObj(items[i]); if (o) out.push(o); i++; continue }
    const run: fabric.FabricObject[] = []
    while (i < items.length && clipKey(items[i].clips) === key) { const o = await toObj(items[i]); if (o) run.push(o); i++ }
    if (!run.length) continue
    const g: any = new fabric.Group(run, { subTargetCheck: true, interactive: true } as any)
    // convert the absolute clip into the group's local plane so it moves with the group
    const inv = fabric.util.invertTransform(g.calcTransformMatrix())
    const segsLocal = transformSegs(c!.segs, inv as any)
    g.clipPath = new fabric.Path(segsToSvgD(segsLocal, 3), { fillRule: c!.rule } as any)
    g.name = 'Clip group'
    out.push(g)
  }
  return unwrapPlacementClips(out)
}

// ── Clip groups that only exist because of how Illustrator stores placed art ──────────
// Illustrator writes every placed/embedded image (and many pasted logos) with a rectangular
// clip the size of the image. That clip is invisible in Illustrator, but kept as a mask here
// it crops the logo as soon as it is moved. Such clips are dropped; real masks are kept.
function clipWorldRect(g: any): { x0: number; y0: number; x1: number; y1: number } | null {
  const cp = g.clipPath
  if (!cp || cp.absolutePositioned || cp.inverted) return null
  const M = fabric.util.multiplyTransformMatrices(g.calcTransformMatrix(), cp.calcTransformMatrix())
  let pts: Array<[number, number]> = []
  if (cp.type === 'rect' || cp.type === 'Rect') {
    const w = cp.width / 2, h = cp.height / 2
    pts = [[-w, -h], [w, -h], [w, h], [-w, h]]
  } else if (Array.isArray(cp.path)) {
    const off = cp.pathOffset || { x: 0, y: 0 }
    for (const c of cp.path as any[]) {
      const op = String(c[0]).toUpperCase()
      if (op === 'Z') continue
      if (op !== 'M' && op !== 'L') return null // curves → a real shaped mask
      pts.push([c[1] - off.x, c[2] - off.y])
    }
  } else return null
  if (pts.length < 4 || pts.length > 6) return null
  const wp = pts.map(([x, y]) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]])
  const xs = wp.map(p => p[0]), ys = wp.map(p => p[1])
  const b = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
  const e = 0.5
  for (const [x, y] of wp) {
    if (!((Math.abs(x - b.x0) < e || Math.abs(x - b.x1) < e) && (Math.abs(y - b.y0) < e || Math.abs(y - b.y1) < e))) return null // rotated / not a rectangle
  }
  return b
}

/** True when a group's clip does nothing visible (or is just an image's placement frame). */
export function isRedundantClip(g: any): boolean {
  if (!g || g.type !== 'group' || !g.clipPath) return false
  const b = clipWorldRect(g); if (!b) return false
  const kids = g.getObjects() as any[]
  if (!kids.length) return true
  let u = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  for (const k of kids) {
    const r = k.getBoundingRect()
    u = { x0: Math.min(u.x0, r.left), y0: Math.min(u.y0, r.top), x1: Math.max(u.x1, r.left + r.width), y1: Math.max(u.y1, r.top + r.height) }
  }
  const bw = b.x1 - b.x0, bh = b.y1 - b.y0
  const tol = Math.max(1.5, 0.01 * Math.max(bw, bh))
  if (u.x0 >= b.x0 - tol && u.y0 >= b.y0 - tol && u.x1 <= b.x1 + tol && u.y1 <= b.y1 + tol) return true
  // an image with its own placement frame (still true after the image was moved inside it)
  if (kids.length === 1 && kids[0].type === 'image') {
    const uw = u.x1 - u.x0, uh = u.y1 - u.y0
    if (Math.abs(uw - bw) <= 2 * tol && Math.abs(uh - bh) <= 2 * tol) return true
  }
  return false
}

type Container = { getObjects(): any[]; remove(...o: any[]): any; insertAt(i: number, ...o: any[]): any }
/** Recursively removes redundant clip groups inside a canvas or group. Returns how many were released. */
export function releaseRedundantClips(parent: Container): number {
  let n = 0
  const objs = parent.getObjects().slice()
  for (let i = objs.length - 1; i >= 0; i--) {
    const o = objs[i]
    if (o.type !== 'group') continue
    n += releaseRedundantClips(o)
    if (!isRedundantClip(o)) continue
    const idx = parent.getObjects().indexOf(o)
    const layerId = o.layerId
    parent.remove(o)
    const kids = o.removeAll() as any[]
    for (const k of kids) { if (layerId && !k.layerId) k.layerId = layerId; k.setCoords?.() }
    parent.insertAt(idx, ...kids)
    n++
  }
  return n
}

/** Same as releaseRedundantClips for a plain array of top-level objects (import results). */
export function unwrapPlacementClips(objs: any[]): any[] {
  const res: any[] = []
  for (const o of objs) {
    if (o.type === 'group') {
      releaseRedundantClips(o)
      if (isRedundantClip(o)) {
        const kids = o.removeAll() as any[]
        for (const k of kids) { if (o.layerId && !k.layerId) k.layerId = o.layerId; k.setCoords?.() }
        res.push(...kids); continue
      }
    }
    res.push(o)
  }
  return res
}

export { segsToSvgD }
