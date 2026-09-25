/* eslint-disable @typescript-eslint/no-explicit-any */
// Font registry for Packaging Studio.
// Every font is loaded twice: once as a browser FontFace (so the canvas shows it) and once
// through opentype.js (so exports can convert text to vector outlines — printers never
// need the font installed). Built-ins are open-licence (OFL/Apache) fonts served by the
// Fontsource CDN; brand fonts uploaded by the team are added at runtime.
const FONT_CDN = 'https://cdn.jsdelivr.net/fontsource/fonts'
import { parse as parseFont, type Font } from 'opentype.js'

export interface FontFile { family: string; weight: 400 | 700; style: 'normal' | 'italic'; url: string }

const BUILTIN: Record<string, { slug: string; variants: Array<[400 | 700, 'normal' | 'italic']> }> = {
  'Inter': { slug: 'inter', variants: [[400, 'normal'], [700, 'normal'], [400, 'italic'], [700, 'italic']] },
  'Roboto': { slug: 'roboto', variants: [[400, 'normal'], [700, 'normal'], [400, 'italic'], [700, 'italic']] },
  'Roboto Condensed': { slug: 'roboto-condensed', variants: [[400, 'normal'], [700, 'normal'], [400, 'italic'], [700, 'italic']] },
  'Open Sans': { slug: 'open-sans', variants: [[400, 'normal'], [700, 'normal'], [400, 'italic'], [700, 'italic']] },
  'Montserrat': { slug: 'montserrat', variants: [[400, 'normal'], [700, 'normal'], [400, 'italic'], [700, 'italic']] },
  'Lato': { slug: 'lato', variants: [[400, 'normal'], [700, 'normal'], [400, 'italic'], [700, 'italic']] },
  'Poppins': { slug: 'poppins', variants: [[400, 'normal'], [700, 'normal'], [400, 'italic'], [700, 'italic']] },
  'Raleway': { slug: 'raleway', variants: [[400, 'normal'], [700, 'normal'], [400, 'italic'], [700, 'italic']] },
  'Nunito': { slug: 'nunito', variants: [[400, 'normal'], [700, 'normal'], [400, 'italic'], [700, 'italic']] },
  'DM Sans': { slug: 'dm-sans', variants: [[400, 'normal'], [700, 'normal'], [400, 'italic'], [700, 'italic']] },
  'Barlow': { slug: 'barlow', variants: [[400, 'normal'], [700, 'normal'], [400, 'italic'], [700, 'italic']] },
  'Source Sans 3': { slug: 'source-sans-3', variants: [[400, 'normal'], [700, 'normal'], [400, 'italic'], [700, 'italic']] },
  'Oswald': { slug: 'oswald', variants: [[400, 'normal'], [700, 'normal']] },
  'Bebas Neue': { slug: 'bebas-neue', variants: [[400, 'normal']] },
  'Archivo Black': { slug: 'archivo-black', variants: [[400, 'normal']] },
  'Playfair Display': { slug: 'playfair-display', variants: [[400, 'normal'], [700, 'normal'], [400, 'italic'], [700, 'italic']] },
  'Merriweather': { slug: 'merriweather', variants: [[400, 'normal'], [700, 'normal'], [400, 'italic'], [700, 'italic']] },
  'Pacifico': { slug: 'pacifico', variants: [[400, 'normal']] },
}

const registry = new Map<string, FontFile[]>()
for (const [family, def] of Object.entries(BUILTIN)) {
  registry.set(family, def.variants.map(([weight, style]) => ({ family, weight, style, url: `${FONT_CDN}/${def.slug}@latest/latin-${weight}-${style}.ttf` })))
}

export const DEFAULT_FONT = 'Inter'

export function fontFamilies(): string[] { return Array.from(registry.keys()).sort((a, b) => a.localeCompare(b)) }

/** Register a team-uploaded font (TTF/OTF). */
export function registerFont(file: FontFile) {
  const list = registry.get(file.family) || []
  if (!list.some(v => v.weight === file.weight && v.style === file.style)) list.push(file)
  registry.set(file.family, list)
}

function pick(family: string, weight: any, style: any): FontFile | null {
  const list = registry.get(family)
  if (!list || !list.length) return null
  const w = (weight === 'bold' || Number(weight) >= 600) ? 700 : 400
  const s = style === 'italic' || style === 'oblique' ? 'italic' : 'normal'
  return list.find(v => v.weight === w && v.style === s)
    || list.find(v => v.weight === w)
    || list.find(v => v.style === s)
    || list[0]
}

const otCache = new Map<string, Promise<Font>>()
const faceCache = new Map<string, Promise<void>>()

async function loadOt(url: string): Promise<Font> {
  if (!otCache.has(url)) {
    otCache.set(url, fetch(url).then(r => { if (!r.ok) throw new Error('font ' + url); return r.arrayBuffer() }).then(buf => parseFont(buf)))
  }
  return otCache.get(url)!
}

/** Make a font variant available to the browser canvas. */
export async function loadFontFace(family: string, weight: any = 400, style: any = 'normal'): Promise<boolean> {
  const v = pick(family, weight, style)
  if (!v || typeof document === 'undefined') return false
  const key = `${v.family}|${v.weight}|${v.style}`
  if (!faceCache.has(key)) {
    faceCache.set(key, (async () => {
      const face = new FontFace(v.family, `url(${JSON.stringify(v.url)})`, { weight: String(v.weight), style: v.style })
      await face.load()
      ;(document as any).fonts.add(face)
    })())
  }
  try { await faceCache.get(key); return true } catch { return false }
}

/** Load every variant of a family for canvas display. */
export async function loadFamily(family: string) {
  const list = registry.get(family) || []
  await Promise.all(list.map(v => loadFontFace(v.family, v.weight, v.style)))
}

/** opentype Font for outlining; falls back to the default font. */
export async function getOutlineFont(family: string, weight: any, style: any): Promise<{ font: Font; substituted: boolean }> {
  const v = pick(family, weight, style)
  if (v) {
    try { return { font: await loadOt(v.url), substituted: false } } catch { /* fall through */ }
  }
  const d = pick(DEFAULT_FONT, weight, style)!
  return { font: await loadOt(d.url), substituted: true }
}
