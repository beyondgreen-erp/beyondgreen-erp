// SVG writer (outlined text, layers as <g> groups with Inkscape/Illustrator-friendly ids).
import { type Scene, type Paint, type PathItem, type ImageItem, segsToSvgD, rgbToHex } from './scene'

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const f = (n: number) => +n.toFixed(4)

export function writeSvg(scene: Scene, pngDataUrl: (it: ImageItem) => string): string {
  let clipN = 0
  let defs = ''
  const paint = (p: Paint | null) => p ? rgbToHex(p.rgb) : 'none'
  const meta = (p: Paint | null, kind: string) => {
    if (!p) return ''
    let s = ''
    if (p.cmyk) s += ` data-${kind}-cmyk="${p.cmyk.map(v => Math.round(v * 100)).join(',')}"`
    if (p.spot) s += ` data-${kind}-spot="${esc(p.spot)}"`
    return s
  }
  const clipAttr = (clips?: { segs: any; rule: string }[]) => {
    if (!clips || !clips.length) return { open: '', close: '' }
    let open = '', close = ''
    for (const c of clips) {
      const id = 'clip' + (++clipN)
      defs += `<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><path d="${segsToSvgD(c.segs)}" clip-rule="${c.rule}"/></clipPath>`
      open += `<g clip-path="url(#${id})">`; close += '</g>'
    }
    return { open, close }
  }
  function pathItem(it: PathItem) {
    const c = clipAttr(it.clips)
    const attrs = [
      `d="${segsToSvgD(it.segs)}"`, `transform="matrix(${it.m.map(f).join(' ')})"`,
      `fill="${paint(it.fill)}"`, `fill-rule="${it.fillRule}"`,
      `stroke="${it.stroke && it.strokeWidth > 0 ? paint(it.stroke) : 'none'}"`,
    ]
    if (it.stroke && it.strokeWidth > 0) attrs.push(`stroke-width="${f(it.strokeWidth)}"`, `stroke-linecap="${it.cap}"`, `stroke-linejoin="${it.join}"`, `stroke-miterlimit="${f(it.miter)}"`)
    if (it.dash && it.dash.length) attrs.push(`stroke-dasharray="${it.dash.map(f).join(' ')}"`)
    if (it.opacity < 1) attrs.push(`opacity="${f(it.opacity)}"`)
    return `${c.open}<path ${attrs.join(' ')}${meta(it.fill, 'fill')}${meta(it.stroke, 'stroke')}/>${c.close}`
  }
  function imageItem(it: ImageItem) {
    const c = clipAttr(it.clips)
    return `${c.open}<image width="${it.w}" height="${it.h}" transform="matrix(${it.m.map(f).join(' ')})" preserveAspectRatio="none"${it.opacity < 1 ? ` opacity="${f(it.opacity)}"` : ''} href="${pngDataUrl(it)}"/>${c.close}`
  }
  const body = scene.layers.map((l, i) => {
    const id = 'layer' + (i + 1)
    return `<g id="${id}" inkscape:groupmode="layer" inkscape:label="${esc(l.name)}" data-name="${esc(l.name)}"${l.visible ? '' : ' style="display:none"'}>` +
      l.items.map(it => it.kind === 'path' ? pathItem(it) : imageItem(it)).join('') + '</g>'
  }).join('')
  const wIn = f(scene.width / 72), hIn = f(scene.height / 72)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${wIn}in" height="${hIn}in" viewBox="0 0 ${f(scene.width)} ${f(scene.height)}"><title>${esc(scene.title)}</title>${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>\n`
}
