// PostScript / EPS writer for packaging scenes.
// EPS is the lowest-common-denominator format printers ask for: it opens in Illustrator,
// imports into CorelDRAW (File ▸ Import ▸ EPS), and RIPs directly.
// • Paths vector, text already outlined.
// • Process CMYK / spot colours (Separation colour space + DSC custom-colour comments).
// • Images: ASCII85 + Flate (LanguageLevel 3); alpha via an ImageType 3 interleaved mask.
// • PostScript has no live transparency: object opacity < 100 % is written at full strength.
import { zlibSync } from 'fflate'
import { type Scene, type Seg, type Paint, type PathItem, type ImageItem, type Clip, rgbToCmyk } from './scene'

const f = (n: number) => {
  if (!isFinite(n)) return '0'
  const s = (Math.round(n * 10000) / 10000).toString()
  return s === '-0' ? '0' : s
}
const psStr = (s: string) => '(' + s.replace(/[\\()]/g, m => '\\' + m).replace(/[^\x20-\x7e]/g, '?') + ')'

export function ascii85(data: Uint8Array): string {
  let out = '', line = 0
  const emit = (s: string) => { for (const ch of s) { out += ch; if (++line >= 76) { out += '\n'; line = 0 } } }
  let i = 0
  for (; i + 4 <= data.length; i += 4) {
    const v = ((data[i] << 24) >>> 0) + (data[i + 1] << 16) + (data[i + 2] << 8) + data[i + 3]
    if (v === 0) { emit('z'); continue }
    let t = v; const c = new Array(5)
    for (let k = 4; k >= 0; k--) { c[k] = String.fromCharCode((t % 85) + 33); t = Math.floor(t / 85) }
    emit(c.join(''))
  }
  const rem = data.length - i
  if (rem > 0) {
    const b = [0, 0, 0, 0]; for (let k = 0; k < rem; k++) b[k] = data[i + k]
    let t = ((b[0] << 24) >>> 0) + (b[1] << 16) + (b[2] << 8) + b[3]; const c = new Array(5)
    for (let k = 4; k >= 0; k--) { c[k] = String.fromCharCode((t % 85) + 33); t = Math.floor(t / 85) }
    emit(c.slice(0, rem + 1).join(''))
  }
  return out + '~>'
}

function pathOps(segs: Seg[]): string {
  let o = 'newpath\n'
  for (const s of segs) {
    if (s[0] === 'M') o += `${f(s[1])} ${f(s[2])} m\n`
    else if (s[0] === 'L') o += `${f(s[1])} ${f(s[2])} l\n`
    else if (s[0] === 'C') o += `${f(s[1])} ${f(s[2])} ${f(s[3])} ${f(s[4])} ${f(s[5])} ${f(s[6])} c\n`
    else o += 'h\n'
  }
  return o
}

export interface PsOptions { eps: boolean; flattenToCmyk?: boolean }

export function writePs(scene: Scene, opts: PsOptions): string {
  const W = scene.width, H = scene.height
  const spots = new Map<string, [number, number, number, number]>()
  let usesProcess = false
  const collect = (p: Paint | null) => {
    if (!p) return
    if (p.spot) spots.set(p.spot, p.cmyk || rgbToCmyk(p.rgb))
    else usesProcess = true
  }
  for (const l of scene.layers) for (const it of l.items) if (it.kind === 'path') { collect(it.fill); if (it.stroke && it.strokeWidth > 0) collect(it.stroke) }

  function color(p: Paint): string {
    if (p.spot) {
      const [c, m, y, k] = spots.get(p.spot)!
      return `[/Separation ${psStr(p.spot)} /DeviceCMYK {dup ${f(c)} mul exch dup ${f(m)} mul exch dup ${f(y)} mul exch ${f(k)} mul}] setcolorspace 1 setcolor\n`
    }
    const cmyk = p.cmyk || (opts.flattenToCmyk ? rgbToCmyk(p.rgb) : null)
    if (cmyk) return `${cmyk.map(f).join(' ')} setcmykcolor\n`
    return `${p.rgb.map(f).join(' ')} setrgbcolor\n`
  }
  const clipOps = (clips?: Clip[]) => (clips || []).map(c => pathOps(c.segs) + (c.rule === 'evenodd' ? 'eoclip newpath\n' : 'clip newpath\n')).join('')

  function pathItem(it: PathItem): string {
    const hasFill = !!it.fill, hasStroke = !!it.stroke && it.strokeWidth > 0
    if (!hasFill && !hasStroke) return ''
    let o = 'gsave\n' + clipOps(it.clips)
    if (it.overprint) o += 'true setoverprint\n'
    o += `[${it.m.map(f).join(' ')}] concat\n`
    const body = pathOps(it.segs)
    if (hasFill) {
      o += (hasStroke ? 'gsave\n' : '') + color(it.fill!) + body + (it.fillRule === 'evenodd' ? 'eofill\n' : 'fill\n') + (hasStroke ? 'grestore\n' : '')
    }
    if (hasStroke) {
      o += color(it.stroke!)
      o += `${f(it.strokeWidth)} setlinewidth ${{ butt: 0, round: 1, square: 2 }[it.cap]} setlinecap ${{ miter: 0, round: 1, bevel: 2 }[it.join]} setlinejoin ${f(Math.max(1, it.miter))} setmiterlimit\n`
      o += `[${(it.dash || []).map(f).join(' ')}] 0 setdash\n`
      o += body + 'stroke\n'
    }
    return o + 'grestore\n'
  }

  function imageItem(it: ImageItem): string {
    const { w, h, rgba } = it
    let hasAlpha = false
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 255) { hasAlpha = true; break }
    let o = 'gsave\n' + clipOps(it.clips) + `[${it.m.map(f).join(' ')}] concat\n/DeviceRGB setcolorspace\n`
    if (!hasAlpha) {
      const rgb = new Uint8Array(w * h * 3)
      for (let i = 0, j = 0; i < rgba.length; i += 4) { rgb[j++] = rgba[i]; rgb[j++] = rgba[i + 1]; rgb[j++] = rgba[i + 2] }
      o += `<< /ImageType 1 /Width ${w} /Height ${h} /BitsPerComponent 8 /Decode [0 1 0 1 0 1] /ImageMatrix [1 0 0 1 0 0]\n/DataSource currentfile /ASCII85Decode filter /FlateDecode filter >> image\n`
      o += ascii85(zlibSync(rgb, { level: 6 })) + '\n'
    } else {
      // interleaved mask (1 mask sample, then R G B per pixel); mask=1 → painted
      const buf = new Uint8Array(w * h * 4)
      for (let i = 0; i < rgba.length; i += 4) {
        buf[i] = rgba[i + 3] >= 128 ? 255 : 0
        buf[i + 1] = rgba[i]; buf[i + 2] = rgba[i + 1]; buf[i + 3] = rgba[i + 2]
      }
      o += `<< /ImageType 3 /InterleaveType 1\n/DataDict << /ImageType 1 /Width ${w} /Height ${h} /BitsPerComponent 8 /Decode [0 1 0 1 0 1] /ImageMatrix [1 0 0 1 0 0]\n/DataSource currentfile /ASCII85Decode filter /FlateDecode filter >>\n/MaskDict << /ImageType 1 /Width ${w} /Height ${h} /BitsPerComponent 8 /Decode [1 0] /ImageMatrix [1 0 0 1 0 0] >> >> image\n`
      o += ascii85(zlibSync(buf, { level: 6 })) + '\n'
    }
    return o + 'grestore\n'
  }

  const hdr: string[] = []
  hdr.push(opts.eps ? '%!PS-Adobe-3.0 EPSF-3.0' : '%!PS-Adobe-3.0')
  hdr.push(`%%Creator: beyondGREEN ERP Packaging Studio`)
  hdr.push(`%%Title: ${scene.title.replace(/[\r\n]/g, ' ')}`)
  hdr.push(`%%CreationDate: ${new Date().toISOString()}`)
  hdr.push(`%%BoundingBox: 0 0 ${Math.ceil(W)} ${Math.ceil(H)}`)
  hdr.push(`%%HiResBoundingBox: 0 0 ${f(W)} ${f(H)}`)
  hdr.push('%%LanguageLevel: 3')
  if (usesProcess) hdr.push('%%DocumentProcessColors: Cyan Magenta Yellow Black')
  if (spots.size) {
    const names = Array.from(spots.keys())
    hdr.push('%%DocumentCustomColors: ' + names.map(psStr).join(' '))
    names.forEach((n, i) => hdr.push(`%%${i ? '+' : 'CMYKCustomColor:'} ${spots.get(n)!.map(f).join(' ')} ${psStr(n)}`))
  }
  hdr.push(opts.eps ? '%%Pages: 0' : '%%Pages: 1')
  if (!opts.eps) hdr.push(`%%DocumentMedia: Artboard ${f(W)} ${f(H)} 0 () ()`)
  hdr.push('%%EndComments')
  hdr.push('%%BeginProlog')
  hdr.push('/m /moveto load def /l /lineto load def /c /curveto load def /h /closepath load def')
  hdr.push('%%EndProlog')
  hdr.push('%%BeginSetup')
  if (!opts.eps) hdr.push(`<< /PageSize [${f(W)} ${f(H)}] >> setpagedevice`)
  hdr.push('%%EndSetup')
  let body = ''
  if (!opts.eps) body += '%%Page: 1 1\n'
  body += `save\n0 ${f(H)} translate 1 -1 scale\n`
  for (const layer of scene.layers) {
    if (!layer.visible) continue
    body += `% ---- layer: ${layer.name.replace(/[\r\n]/g, ' ')}\n`
    for (const it of layer.items) body += it.kind === 'path' ? pathItem(it) : imageItem(it)
  }
  body += 'restore\n'
  if (!opts.eps) body += 'showpage\n'
  body += '%%Trailer\n%%EOF\n'
  return hdr.join('\n') + '\n' + body
}
