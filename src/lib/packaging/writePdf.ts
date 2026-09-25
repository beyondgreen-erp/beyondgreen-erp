// Vector PDF writer for packaging scenes. Also used for the PDF-compatible .ai export
// (Illustrator and CorelDRAW both open/import PDF-based .ai files natively).
// • Paths stay vector; text arrives already converted to outlines.
// • Process CMYK where the scene specifies it, spot colours as /Separation, RGB otherwise.
// • Each layer becomes an Optional Content Group so Acrobat / Illustrator / CorelDRAW keep layers.
// • Images: Flate-compressed RGB with an SMask for transparency.
import { zlibSync } from 'fflate'
import { type Scene, type Seg, type Paint, type PathItem, type ImageItem, type Clip, multiply, type Mat } from './scene'

const enc = new TextEncoder()
const f = (n: number) => {
  if (!isFinite(n)) return '0'
  const s = (Math.round(n * 10000) / 10000).toString()
  return s === '-0' ? '0' : s
}
const pdfStr = (s: string) => '(' + s.replace(/[\\()]/g, m => '\\' + m).replace(/[^\x20-\x7e]/g, '?') + ')'
const pdfName = (s: string) => '/' + s.replace(/[^A-Za-z0-9_.-]/g, c => '#' + c.charCodeAt(0).toString(16).padStart(2, '0'))

function pathOps(segs: Seg[]): string {
  let o = ''
  for (const s of segs) {
    if (s[0] === 'M') o += `${f(s[1])} ${f(s[2])} m\n`
    else if (s[0] === 'L') o += `${f(s[1])} ${f(s[2])} l\n`
    else if (s[0] === 'C') o += `${f(s[1])} ${f(s[2])} ${f(s[3])} ${f(s[4])} ${f(s[5])} ${f(s[6])} c\n`
    else o += 'h\n'
  }
  return o
}

export interface PdfOptions { producer?: string; flattenToCmyk?: boolean }

export function writePdf(scene: Scene, opts: PdfOptions = {}): Uint8Array {
  const objs: (Uint8Array | string)[] = [] // index = obj number - 1
  const alloc = () => { objs.push(''); return objs.length }
  const set = (n: number, v: string | Uint8Array) => { objs[n - 1] = v }
  const stream = (dict: string, data: Uint8Array) => {
    const head = enc.encode(`<< ${dict} /Length ${data.length} >>\nstream\n`)
    const tail = enc.encode('\nendstream')
    const out = new Uint8Array(head.length + data.length + tail.length)
    out.set(head); out.set(data, head.length); out.set(tail, head.length + data.length)
    return out
  }

  const catalogN = alloc(), pagesN = alloc(), pageN = alloc(), contentN = alloc()
  const colorSpaces: Record<string, { name: string; n: number }> = {}
  const gstates: Record<string, { name: string; n: number }> = {}
  const xobjects: { name: string; n: number }[] = []
  const ocgs: { name: string; n: number; res: string }[] = []

  function spotCS(p: Paint): string {
    const key = p.spot! + '|' + (p.cmyk || []).join(',')
    if (!colorSpaces[key]) {
      const n = alloc(), name = 'CS' + (Object.keys(colorSpaces).length + 1)
      const cmyk = p.cmyk || rgbToCmykLocal(p.rgb)
      set(n, `[/Separation ${pdfName(p.spot!)} /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [${cmyk.map(f).join(' ')}] /N 1 >>]`)
      colorSpaces[key] = { name, n }
    }
    return colorSpaces[key].name
  }
  function gs(alpha: number, overprint: boolean): string {
    const key = `${f(alpha)}|${overprint}`
    if (!gstates[key]) {
      const n = alloc(), name = 'GS' + (Object.keys(gstates).length + 1)
      set(n, `<< /Type /ExtGState /ca ${f(alpha)} /CA ${f(alpha)}${overprint ? ' /OP true /op true /OPM 1' : ''} >>`)
      gstates[key] = { name, n }
    }
    return gstates[key].name
  }
  function paintOp(p: Paint, stroke: boolean): string {
    if (p.spot) return `/${spotCS(p)} ${stroke ? 'CS' : 'cs'} 1 ${stroke ? 'SCN' : 'scn'}\n`
    const cmyk = p.cmyk || (opts.flattenToCmyk ? rgbToCmykLocal(p.rgb) : null)
    if (cmyk) return `${cmyk.map(f).join(' ')} ${stroke ? 'K' : 'k'}\n`
    return `${p.rgb.map(f).join(' ')} ${stroke ? 'RG' : 'rg'}\n`
  }
  function clipOps(clips?: Clip[]): string {
    if (!clips || !clips.length) return ''
    return clips.map(c => pathOps(c.segs) + (c.rule === 'evenodd' ? 'W* n\n' : 'W n\n')).join('')
  }
  const cm = (m: Mat) => `${m.map(f).join(' ')} cm\n`

  function pathItem(it: PathItem): string {
    const hasFill = !!it.fill, hasStroke = !!it.stroke && it.strokeWidth > 0
    if (!hasFill && !hasStroke) return ''
    let o = 'q\n' + clipOps(it.clips)
    if (it.opacity < 1 || it.overprint) o += `/${gs(it.opacity, !!it.overprint)} gs\n`
    o += cm(it.m)
    if (hasFill) o += paintOp(it.fill!, false)
    if (hasStroke) {
      o += paintOp(it.stroke!, true)
      o += `${f(it.strokeWidth)} w ${{ butt: 0, round: 1, square: 2 }[it.cap]} J ${{ miter: 0, round: 1, bevel: 2 }[it.join]} j ${f(Math.max(1, it.miter))} M\n`
      o += it.dash && it.dash.length ? `[${it.dash.map(f).join(' ')}] 0 d\n` : '[] 0 d\n'
    }
    o += pathOps(it.segs)
    const eo = it.fillRule === 'evenodd'
    o += hasFill && hasStroke ? (eo ? 'B*\n' : 'B\n') : hasFill ? (eo ? 'f*\n' : 'f\n') : 'S\n'
    return o + 'Q\n'
  }

  function imageItem(it: ImageItem): string {
    const { w, h, rgba } = it
    const rgb = new Uint8Array(w * h * 3), alpha = new Uint8Array(w * h)
    let hasAlpha = false
    for (let i = 0, j = 0, k = 0; i < rgba.length; i += 4) {
      rgb[j++] = rgba[i]; rgb[j++] = rgba[i + 1]; rgb[j++] = rgba[i + 2]
      alpha[k++] = rgba[i + 3]; if (rgba[i + 3] !== 255) hasAlpha = true
    }
    let smask = ''
    if (hasAlpha) {
      const sn = alloc()
      set(sn, stream(`/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, zlibSync(alpha, { level: 6 })))
      smask = ` /SMask ${sn} 0 R`
    }
    const n = alloc(), name = 'Im' + (xobjects.length + 1)
    set(n, stream(`/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${smask}`, zlibSync(rgb, { level: 6 })))
    xobjects.push({ name, n })
    // unit square → pixel space (row 0 at top) → document
    const m = multiply(it.m, [w, 0, 0, -h, 0, h])
    let o = 'q\n' + clipOps(it.clips)
    if (it.opacity < 1) o += `/${gs(it.opacity, false)} gs\n`
    return o + cm(m) + `/${name} Do\nQ\n`
  }

  let content = `1 0 0 -1 0 ${f(scene.height)} cm\n`
  scene.layers.forEach((layer, li) => {
    const n = alloc(), res = 'OC' + (li + 1)
    set(n, `<< /Type /OCG /Name ${pdfStr(layer.name)} >>`)
    ocgs.push({ name: layer.name, n, res })
    content += `/OC /${res} BDC\n`
    for (const it of layer.items) content += it.kind === 'path' ? pathItem(it) : imageItem(it)
    content += 'EMC\n'
  })

  set(contentN, stream('/Filter /FlateDecode', zlibSync(enc.encode(content), { level: 6 })))
  const dictOf = (list: { name: string; n: number }[]) => list.map(x => `/${x.name} ${x.n} 0 R`).join(' ')
  const resources = [
    Object.keys(colorSpaces).length ? `/ColorSpace << ${dictOf(Object.values(colorSpaces))} >>` : '',
    Object.keys(gstates).length ? `/ExtGState << ${dictOf(Object.values(gstates))} >>` : '',
    xobjects.length ? `/XObject << ${dictOf(xobjects)} >>` : '',
    ocgs.length ? `/Properties << ${ocgs.map(o => `/${o.res} ${o.n} 0 R`).join(' ')} >>` : '',
  ].filter(Boolean).join(' ')
  const box = `[0 0 ${f(scene.width)} ${f(scene.height)}]`
  set(pageN, `<< /Type /Page /Parent ${pagesN} 0 R /MediaBox ${box} /TrimBox ${box} /CropBox ${box} /Resources << ${resources} >> /Contents ${contentN} 0 R >>`)
  set(pagesN, `<< /Type /Pages /Kids [${pageN} 0 R] /Count 1 >>`)
  const offRefs = scene.layers.map((l, i) => l.visible ? '' : `${ocgs[i].n} 0 R`).filter(Boolean).join(' ')
  const allRefs = ocgs.map(o => `${o.n} 0 R`).join(' ')
  set(catalogN, `<< /Type /Catalog /Pages ${pagesN} 0 R /OCProperties << /OCGs [${allRefs}] /D << /Order [${allRefs}] /ON [${scene.layers.map((l, i) => l.visible ? `${ocgs[i].n} 0 R` : '').filter(Boolean).join(' ')}] /OFF [${offRefs}] >> >> >>`)
  const infoN = alloc()
  const now = new Date(), pad = (x: number) => String(x).padStart(2, '0')
  const date = `D:${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  set(infoN, `<< /Title ${pdfStr(scene.title)} /Creator (beyondGREEN ERP Packaging Studio) /Producer ${pdfStr(opts.producer || 'beyondGREEN ERP')} /CreationDate (${date}) /ModDate (${date}) >>`)

  // serialise
  const chunks: Uint8Array[] = []
  let pos = 0
  const push = (b: Uint8Array | string) => { const u = typeof b === 'string' ? enc.encode(b) : b; chunks.push(u); pos += u.length }
  push('%PDF-1.6\n')
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))
  const offsets: number[] = []
  objs.forEach((o, i) => { offsets.push(pos); push(`${i + 1} 0 obj\n`); push(o); push('\nendobj\n') })
  const xref = pos
  push(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`)
  push(offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join(''))
  push(`trailer\n<< /Size ${objs.length + 1} /Root ${catalogN} 0 R /Info ${infoN} 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  const out = new Uint8Array(pos)
  let p = 0
  for (const c of chunks) { out.set(c, p); p += c.length }
  return out
}

function rgbToCmykLocal([r, g, b]: [number, number, number]): [number, number, number, number] {
  const k = 1 - Math.max(r, g, b)
  if (k >= 0.999) return [0, 0, 0, 1]
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k]
}
