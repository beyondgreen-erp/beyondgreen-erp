// Packaging design — renderer-independent scene model + geometry helpers.
// Everything the exporters (PDF / AI / EPS / PS / SVG) need is expressed here in
// document space: points (1/72 in), origin top-left of the artboard, y pointing down.

export type Mat = [number, number, number, number, number, number] // a b c d e f  (x' = a*x + c*y + e, y' = b*x + d*y + f)
export type Seg = ['M', number, number] | ['L', number, number] | ['C', number, number, number, number, number, number] | ['Z']

export interface Paint {
  rgb: [number, number, number]          // 0..1
  cmyk?: [number, number, number, number] // 0..1 — when present, written as process CMYK
  spot?: string                           // spot / custom colour name (e.g. "Dieline", "PMS 7482 C")
}

export interface Clip { segs: Seg[]; rule: 'nonzero' | 'evenodd' } // already in document space

export interface PathItem {
  kind: 'path'
  m: Mat
  segs: Seg[]
  fill: Paint | null
  fillRule: 'nonzero' | 'evenodd'
  stroke: Paint | null
  strokeWidth: number
  cap: 'butt' | 'round' | 'square'
  join: 'miter' | 'round' | 'bevel'
  miter: number
  dash?: number[]
  opacity: number
  overprint?: boolean
  clips?: Clip[]
}

export interface ImageItem {
  kind: 'image'
  m: Mat              // maps pixel space (0..w, 0..h, y down) → document space
  w: number
  h: number
  rgba: Uint8Array | Uint8ClampedArray // w*h*4
  opacity: number
  clips?: Clip[]
}

export type SceneItem = PathItem | ImageItem

export interface SceneLayer { name: string; visible: boolean; items: SceneItem[] }

export interface Scene {
  width: number   // pt
  height: number  // pt
  title: string
  layers: SceneLayer[]
}

// ── matrices ────────────────────────────────────────────────────────────────
export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0]
/** multiply(A, B) = apply B first, then A (same convention as fabric's multiplyTransformMatrices(A, B)). */
export function multiply(a: Mat, b: Mat): Mat {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]
}
export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-12
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det]
}
export function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}
export function transformSegs(segs: Seg[], m: Mat): Seg[] {
  return segs.map(s => {
    switch (s[0]) {
      case 'M': case 'L': { const [x, y] = apply(m, s[1], s[2]); return [s[0], x, y] as Seg }
      case 'C': {
        const [a, b] = apply(m, s[1], s[2]); const [c, d] = apply(m, s[3], s[4]); const [e, f] = apply(m, s[5], s[6])
        return ['C', a, b, c, d, e, f] as Seg
      }
      default: return ['Z'] as Seg
    }
  })
}
export function segsBounds(segs: Seg[]): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const add = (x: number, y: number) => { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y }
  for (const s of segs) {
    if (s[0] === 'M' || s[0] === 'L') add(s[1], s[2])
    else if (s[0] === 'C') { add(s[1], s[2]); add(s[3], s[4]); add(s[5], s[6]) }
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 }
}

// ── primitive shapes as bezier paths ────────────────────────────────────────
const K = 0.5522847498307936
export function ellipseSegs(cx: number, cy: number, rx: number, ry: number): Seg[] {
  const ox = rx * K, oy = ry * K
  return [
    ['M', cx + rx, cy],
    ['C', cx + rx, cy + oy, cx + ox, cy + ry, cx, cy + ry],
    ['C', cx - ox, cy + ry, cx - rx, cy + oy, cx - rx, cy],
    ['C', cx - rx, cy - oy, cx - ox, cy - ry, cx, cy - ry],
    ['C', cx + ox, cy - ry, cx + rx, cy - oy, cx + rx, cy],
    ['Z'],
  ]
}
export function rectSegs(x: number, y: number, w: number, h: number, rx = 0, ry = 0): Seg[] {
  rx = Math.min(Math.abs(rx), w / 2); ry = Math.min(Math.abs(ry || rx), h / 2)
  if (!rx || !ry) return [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']]
  const ox = rx * K, oy = ry * K
  return [
    ['M', x + rx, y], ['L', x + w - rx, y],
    ['C', x + w - rx + ox, y, x + w, y + ry - oy, x + w, y + ry],
    ['L', x + w, y + h - ry],
    ['C', x + w, y + h - ry + oy, x + w - rx + ox, y + h, x + w - rx, y + h],
    ['L', x + rx, y + h],
    ['C', x + rx - ox, y + h, x, y + h - ry + oy, x, y + h - ry],
    ['L', x, y + ry],
    ['C', x, y + ry - oy, x + rx - ox, y, x + rx, y],
    ['Z'],
  ]
}

// ── SVG path data → absolute M/L/C/Z ────────────────────────────────────────
/** Accepts either an SVG `d` string or fabric's parsed path array ([['M',x,y],['Q',...]]). */
export function parsePath(input: string | Array<Array<string | number>>): Seg[] {
  const cmds: Array<[string, number[]]> = []
  if (typeof input === 'string') {
    const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g
    let cur: [string, number[]] | null = null
    let mt: RegExpExecArray | null
    while ((mt = re.exec(input))) {
      if (mt[1]) { cur = [mt[1], []]; cmds.push(cur) }
      else if (cur) cur[1].push(parseFloat(mt[2]))
    }
  } else {
    for (const c of input) cmds.push([String(c[0]), (c.slice(1) as number[]).map(Number)])
  }
  const out: Seg[] = []
  let x = 0, y = 0, sx = 0, sy = 0
  let lcx = 0, lcy = 0, lqx = 0, lqy = 0, prev = ''
  const arity: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }
  for (const [raw, nums] of cmds) {
    const up = raw.toUpperCase(), rel = raw !== up
    const n = arity[up]
    if (up === 'Z') { out.push(['Z']); x = sx; y = sy; prev = 'Z'; continue }
    let first = true
    for (let i = 0; i + n <= nums.length; i += n) {
      const a = nums.slice(i, i + n)
      let cmd = up
      if (up === 'M' && !first) cmd = 'L'
      const ox = rel ? x : 0, oy = rel ? y : 0
      switch (cmd) {
        case 'M': x = a[0] + ox; y = a[1] + oy; sx = x; sy = y; out.push(['M', x, y]); break
        case 'L': x = a[0] + ox; y = a[1] + oy; out.push(['L', x, y]); break
        case 'H': x = a[0] + ox; out.push(['L', x, y]); break
        case 'V': y = a[0] + (rel ? y : 0); out.push(['L', x, y]); break
        case 'C': {
          const c1x = a[0] + ox, c1y = a[1] + oy, c2x = a[2] + ox, c2y = a[3] + oy
          x = a[4] + ox; y = a[5] + oy; out.push(['C', c1x, c1y, c2x, c2y, x, y]); lcx = c2x; lcy = c2y; break
        }
        case 'S': {
          const c1x = prev === 'C' || prev === 'S' ? 2 * x - lcx : x, c1y = prev === 'C' || prev === 'S' ? 2 * y - lcy : y
          const c2x = a[0] + ox, c2y = a[1] + oy
          x = a[2] + ox; y = a[3] + oy; out.push(['C', c1x, c1y, c2x, c2y, x, y]); lcx = c2x; lcy = c2y; break
        }
        case 'Q': {
          const qx = a[0] + ox, qy = a[1] + oy, ex = a[2] + ox, ey = a[3] + oy
          out.push(['C', x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), ex + 2 / 3 * (qx - ex), ey + 2 / 3 * (qy - ey), ex, ey])
          x = ex; y = ey; lqx = qx; lqy = qy; break
        }
        case 'T': {
          const qx = prev === 'Q' || prev === 'T' ? 2 * x - lqx : x, qy = prev === 'Q' || prev === 'T' ? 2 * y - lqy : y
          const ex = a[0] + ox, ey = a[1] + oy
          out.push(['C', x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), ex + 2 / 3 * (qx - ex), ey + 2 / 3 * (qy - ey), ex, ey])
          x = ex; y = ey; lqx = qx; lqy = qy; break
        }
        case 'A': {
          const ex = a[5] + ox, ey = a[6] + oy
          out.push(...arcToCurves(x, y, a[0], a[1], a[2], !!a[3], !!a[4], ex, ey))
          x = ex; y = ey; break
        }
      }
      prev = cmd; first = false
    }
    if (n === 0 || nums.length === 0) prev = up
  }
  return out
}

function arcToCurves(x1: number, y1: number, rx: number, ry: number, phiDeg: number, large: boolean, sweep: boolean, x2: number, y2: number): Seg[] {
  if (rx === 0 || ry === 0) return [['L', x2, y2]]
  const phi = phiDeg * Math.PI / 180, cos = Math.cos(phi), sin = Math.sin(phi)
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy
  rx = Math.abs(rx); ry = Math.abs(ry)
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam) }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
  let co = Math.sqrt(Math.max(0, num / den)); if (large === sweep) co = -co
  const cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const d = Math.hypot(ux, uy) * Math.hypot(vx, vy); let a = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / d)))
    if (ux * vy - uy * vx < 0) a = -a; return a
  }
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI
  const nSeg = Math.ceil(Math.abs(dt) / (Math.PI / 2))
  const out: Seg[] = []
  const d = dt / nSeg, kk = 4 / 3 * Math.tan(d / 4)
  let t = t1
  for (let i = 0; i < nSeg; i++) {
    const c1 = Math.cos(t), s1 = Math.sin(t), c2 = Math.cos(t + d), s2 = Math.sin(t + d)
    const p = (px: number, py: number): [number, number] => [cx + rx * px * cos - ry * py * sin, cy + rx * px * sin + ry * py * cos]
    const [ax, ay] = p(c1 - kk * s1, s1 + kk * c1), [bx, by] = p(c2 + kk * s2, s2 - kk * c2), [ex, ey] = p(c2, s2)
    out.push(['C', ax, ay, bx, by, ex, ey]); t += d
  }
  return out
}

export function segsToSvgD(segs: Seg[], prec = 3): string {
  const f = (n: number) => +n.toFixed(prec)
  return segs.map(s => s[0] === 'Z' ? 'Z' : s[0] + (s.slice(1) as number[]).map(f).join(' ')).join('')
}

// ── colour helpers ──────────────────────────────────────────────────────────
export function parseColor(input: string | null | undefined): { rgb: [number, number, number]; alpha: number } | null {
  if (!input || input === 'transparent' || input === 'none') return null
  const s = input.trim().toLowerCase()
  let m: RegExpMatchArray | null
  if ((m = s.match(/^#([0-9a-f]{3,8})$/))) {
    let h = m[1]
    if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('')
    const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
    return { rgb: [r, g, b], alpha: a }
  }
  if ((m = s.match(/^rgba?\(([^)]+)\)$/))) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(v => v.endsWith('%') ? parseFloat(v) * 2.55 : parseFloat(v))
    return { rgb: [p[0] / 255, p[1] / 255, p[2] / 255], alpha: p[3] == null ? 1 : (m[1].includes('%') && p[3] > 1 ? p[3] / 255 : p[3]) }
  }
  const named: Record<string, string> = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', cyan: '#00ffff', magenta: '#ff00ff', gray: '#808080', grey: '#808080' }
  if (named[s]) return parseColor(named[s])
  return null
}
export function rgbToHex(rgb: [number, number, number]): string {
  return '#' + rgb.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')
}
/** Naive device conversion (no ICC). Good enough for a starting point; printers apply their own profile. */
export function rgbToCmyk([r, g, b]: [number, number, number]): [number, number, number, number] {
  const k = 1 - Math.max(r, g, b)
  if (k >= 0.999) return [0, 0, 0, 1]
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k].map(v => Math.round(v * 1000) / 1000) as [number, number, number, number]
}
export function cmykToRgb([c, m, y, k]: [number, number, number, number]): [number, number, number] {
  return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)]
}

export const PT_PER_IN = 72
export const PT_PER_MM = 72 / 25.4
