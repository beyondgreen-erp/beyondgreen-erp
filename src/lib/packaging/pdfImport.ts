/* eslint-disable @typescript-eslint/no-explicit-any */
// PDF (and PDF-compatible .ai) → editable vector items.
// Walks pdf.js's operator list and rebuilds every path, colour, stroke, clip and image in
// document space. EPS / PS / legacy files are first normalised to PDF by Ghostscript with
// text converted to outlines, so the walker only ever needs to understand paths + images.
import { type Mat, type Seg, type PathItem, type ImageItem, type SceneItem, type Clip, multiply, transformSegs } from './scene'

export interface ImportedPage { width: number; height: number; items: SceneItem[]; warnings: string[] }

interface GState {
  ctm: Mat
  fill: [number, number, number]
  stroke: [number, number, number]
  fillAlpha: number
  strokeAlpha: number
  lineWidth: number
  cap: PathItem['cap']
  join: PathItem['join']
  miter: number
  dash: number[]
  clips: Clip[]
  groupAlpha: number
}

const CAPS: PathItem['cap'][] = ['butt', 'round', 'square']
const JOINS: PathItem['join'][] = ['miter', 'round', 'bevel']

export async function importPdfPage(pdfjs: any, page: any): Promise<ImportedPage> {
  const OPS = pdfjs.OPS
  const viewport = page.getViewport({ scale: 1 })
  const opList = await page.getOperatorList()
  const warnings = new Set<string>()
  const items: SceneItem[] = []

  let st: GState = {
    ctm: viewport.transform.slice(0, 6) as Mat,
    fill: [0, 0, 0], stroke: [0, 0, 0], fillAlpha: 1, strokeAlpha: 1,
    lineWidth: 1, cap: 'butt', join: 'miter', miter: 10, dash: [], clips: [], groupAlpha: 1,
  }
  const stack: GState[] = []
  let path: Seg[] = []
  let pendingClip: 'nonzero' | 'evenodd' | null = null
  let cx = 0, cy = 0, sx = 0, sy = 0

  const save = () => stack.push({ ...st, clips: st.clips.slice(), dash: st.dash.slice() })
  const restore = () => { if (stack.length) st = stack.pop()! }
  const getObj = (id: any) => {
    if (typeof id !== 'string') return id
    try { return id.startsWith('g_') ? page.commonObjs.get(id) : page.objs.get(id) } catch { return null }
  }

  function construct(ops: number[], args: number[]) {
    let j = 0
    for (const op of ops) {
      switch (op | 0) {
        case OPS.rectangle: {
          const x = args[j++], y = args[j++], w = args[j++], h = args[j++]
          path.push(['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z'])
          cx = sx = x; cy = sy = y; break
        }
        case OPS.moveTo: cx = sx = args[j++]; cy = sy = args[j++]; path.push(['M', cx, cy]); break
        case OPS.lineTo: cx = args[j++]; cy = args[j++]; path.push(['L', cx, cy]); break
        case OPS.curveTo: path.push(['C', args[j], args[j + 1], args[j + 2], args[j + 3], args[j + 4], args[j + 5]]); cx = args[j + 4]; cy = args[j + 5]; j += 6; break
        case OPS.curveTo2: path.push(['C', cx, cy, args[j], args[j + 1], args[j + 2], args[j + 3]]); cx = args[j + 2]; cy = args[j + 3]; j += 4; break
        case OPS.curveTo3: path.push(['C', args[j], args[j + 1], args[j + 2], args[j + 3], args[j + 2], args[j + 3]]); cx = args[j + 2]; cy = args[j + 3]; j += 4; break
        case OPS.closePath: path.push(['Z']); cx = sx; cy = sy; break
      }
    }
  }

  function finishPath(fill: boolean, stroke: boolean, rule: 'nonzero' | 'evenodd', close = false) {
    if (close) path.push(['Z'])
    if (path.length && (fill || stroke)) {
      items.push({
        kind: 'path', m: st.ctm.slice() as Mat, segs: path,
        fill: fill ? { rgb: st.fill } : null, fillRule: rule,
        stroke: stroke ? { rgb: st.stroke } : null,
        strokeWidth: st.lineWidth || 0.25, // PDF 0-width = thinnest line
        cap: st.cap, join: st.join, miter: st.miter, dash: st.dash.length ? st.dash.slice() : undefined,
        opacity: (fill ? st.fillAlpha : st.strokeAlpha) * st.groupAlpha,
        clips: st.clips.length ? st.clips.slice() : undefined,
      })
    }
    if (pendingClip && path.length) st.clips = [...st.clips, { segs: transformSegs(path, st.ctm), rule: pendingClip }]
    pendingClip = null
    path = []
  }

  function imageToRgba(img: any, maskColor?: [number, number, number]): { w: number; h: number; rgba: Uint8ClampedArray } | null {
    if (!img) return null
    const w = img.width, h = img.height
    if (img.bitmap && typeof document !== 'undefined') {
      const c = document.createElement('canvas'); c.width = w; c.height = h
      const cx2 = c.getContext('2d')!; cx2.drawImage(img.bitmap, 0, 0)
      return { w, h, rgba: cx2.getImageData(0, 0, w, h).data }
    }
    const src: Uint8Array = img.data
    if (!src) return null
    const out = new Uint8ClampedArray(w * h * 4)
    if (maskColor) {
      const rowBytes = (w + 7) >> 3
      const inverse = !!img.inverseDecode
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const bit = (src[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1
        const painted = inverse ? bit === 1 : bit === 0
        const o = (y * w + x) * 4
        out[o] = maskColor[0] * 255; out[o + 1] = maskColor[1] * 255; out[o + 2] = maskColor[2] * 255; out[o + 3] = painted ? 255 : 0
      }
      return { w, h, rgba: out }
    }
    switch (img.kind) {
      case 3: out.set(src.subarray(0, w * h * 4)); break // RGBA_32BPP
      case 2: for (let i = 0, j = 0; i < w * h; i++) { out[i * 4] = src[j++]; out[i * 4 + 1] = src[j++]; out[i * 4 + 2] = src[j++]; out[i * 4 + 3] = 255 } break
      case 1: { // GRAYSCALE_1BPP
        const rowBytes = (w + 7) >> 3
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const v = ((src[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1) ? 255 : 0
          const o = (y * w + x) * 4; out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = 255
        }
        break
      }
      default: return null
    }
    return { w, h, rgba: out }
  }

  function pushImage(img: { w: number; h: number; rgba: Uint8ClampedArray } | null) {
    if (!img) { warnings.add('An embedded image could not be decoded and was skipped.'); return }
    const m = multiply(st.ctm, [1 / img.w, 0, 0, -1 / img.h, 0, 1])
    const it: ImageItem = { kind: 'image', m, w: img.w, h: img.h, rgba: img.rgba, opacity: st.fillAlpha * st.groupAlpha, clips: st.clips.length ? st.clips.slice() : undefined }
    items.push(it)
  }

  const { fnArray, argsArray } = opList
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i], a = argsArray[i]
    switch (fn) {
      case OPS.save: save(); break
      case OPS.restore: restore(); break
      case OPS.transform: st.ctm = multiply(st.ctm, a as Mat); break
      case OPS.setLineWidth: st.lineWidth = a[0]; break
      case OPS.setLineCap: st.cap = CAPS[a[0]] || 'butt'; break
      case OPS.setLineJoin: st.join = JOINS[a[0]] || 'miter'; break
      case OPS.setMiterLimit: st.miter = a[0]; break
      case OPS.setDash: st.dash = (a[0] || []).slice(); break
      case OPS.setGState:
        for (const [k, v] of a[0]) {
          if (k === 'LW') st.lineWidth = v
          else if (k === 'LC') st.cap = CAPS[v] || 'butt'
          else if (k === 'LJ') st.join = JOINS[v] || 'miter'
          else if (k === 'ML') st.miter = v
          else if (k === 'D') st.dash = (v[0] || []).slice()
          else if (k === 'ca') st.fillAlpha = v
          else if (k === 'CA') st.strokeAlpha = v
          else if (k === 'SMask' && v) warnings.add('Soft masks (transparency masks) were flattened.')
        }
        break
      case OPS.setFillRGBColor: st.fill = [a[0] / 255, a[1] / 255, a[2] / 255]; break
      case OPS.setStrokeRGBColor: st.stroke = [a[0] / 255, a[1] / 255, a[2] / 255]; break
      case OPS.setFillColorN: case OPS.setStrokeColorN:
        warnings.add('Pattern / gradient fills were replaced by a flat colour.'); break
      case OPS.shadingFill: warnings.add('Gradient (shading) areas were skipped.'); break
      case OPS.constructPath: construct(a[0], a[1]); break
      case OPS.moveTo: case OPS.lineTo: case OPS.curveTo: case OPS.curveTo2: case OPS.curveTo3: case OPS.rectangle: case OPS.closePath:
        construct([fn], a || []); break
      case OPS.fill: finishPath(true, false, 'nonzero'); break
      case OPS.eoFill: finishPath(true, false, 'evenodd'); break
      case OPS.stroke: finishPath(false, true, 'nonzero'); break
      case OPS.closeStroke: finishPath(false, true, 'nonzero', true); break
      case OPS.fillStroke: finishPath(true, true, 'nonzero'); break
      case OPS.eoFillStroke: finishPath(true, true, 'evenodd'); break
      case OPS.closeFillStroke: finishPath(true, true, 'nonzero', true); break
      case OPS.closeEOFillStroke: finishPath(true, true, 'evenodd', true); break
      case OPS.endPath: finishPath(false, false, 'nonzero'); break
      case OPS.clip: pendingClip = 'nonzero'; break
      case OPS.eoClip: pendingClip = 'evenodd'; break
      case OPS.paintFormXObjectBegin: {
        save()
        if (Array.isArray(a[0]) && a[0].length === 6) st.ctm = multiply(st.ctm, a[0] as Mat)
        const bb = a[1]
        if (bb) {
          const x = bb[0], y = bb[1], w = bb[2] - bb[0], h = bb[3] - bb[1]
          st.clips = [...st.clips, { segs: transformSegs([['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']], st.ctm), rule: 'nonzero' }]
        }
        break
      }
      case OPS.paintFormXObjectEnd: restore(); break
      case OPS.beginGroup: save(); st.groupAlpha *= st.fillAlpha; st.fillAlpha = st.strokeAlpha = 1; break
      case OPS.endGroup: restore(); break
      case OPS.paintImageXObject: pushImage(imageToRgba(getObj(a[0]))); break
      case OPS.paintInlineImageXObject: pushImage(imageToRgba(a[0])); break
      case OPS.paintImageMaskXObject: pushImage(imageToRgba(getObj(a[0]?.data ?? a[0]) || a[0], st.fill)); break
      case OPS.paintImageXObjectRepeat: case OPS.paintImageMaskXObjectRepeat: case OPS.paintImageMaskXObjectGroup: case OPS.paintInlineImageXObjectGroup:
        warnings.add('Some tiled / grouped images were skipped.'); break
      case OPS.showText: case OPS.showSpacedText: case OPS.nextLineShowText: case OPS.nextLineSetSpacingShowText:
        warnings.add('Live text could not be converted to outlines and was skipped.'); break
    }
  }

  // Drop degenerate full-page white backgrounds some exporters add.
  return { width: viewport.width, height: viewport.height, items, warnings: Array.from(warnings) }
}
