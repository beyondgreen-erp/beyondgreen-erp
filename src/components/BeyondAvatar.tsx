'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useId, useMemo } from 'react'

/*
  BeyondAvatar — semi-realistic shaded 2D character (front view), viewBox 0 0 240 360.
  Base look from `config`; equipped gear from `equipped` (slot -> id) via `itemsById`.
  Item `asset`: { art:<code>, color?, c1?, c2? }.  No armor.
*/

const S = (h?: string, fb = '#000') => (h ? (h.startsWith('#') ? h : '#' + h) : fb)
function shade(hex: string, amt: number) {
  const h = (hex || '#000').replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16)
  let r = (n >> 16) + amt, g = ((n >> 8) & 255) + amt, b = (n & 255) + amt
  r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b))
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)
}

// gradient registry (per render instance)
function makeGrad(uid: string) {
  const defs: string[] = []
  let i = 0
  const lin = (c1: string, c2: string, vertical = true) => {
    const id = `g${uid}_${i++}`
    defs.push(`<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 0}"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`)
    return `url(#${id})`
  }
  const rad = (c1: string, c2: string, cx = '50%', cy = '38%', r = '62%') => {
    const id = `g${uid}_${i++}`
    defs.push(`<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></radialGradient>`)
    return `url(#${id})`
  }
  return { defs, lin, rad }
}

// ---------- geometry ----------
const TORSO = 'M88,118 C90,108 102,103 120,103 C138,103 150,108 152,118 L146,206 C141,218 120,222 99,206 Z'
const HAND_L = { x: 70, y: 210 }
const HAND_R = { x: 170, y: 210 }

// ===================== BASE BODY =====================
function baseBody(c: any, G: any, hasBody: boolean, hasLegs: boolean, hasFeet: boolean) {
  const skin = S(c.skinColor, '#e8b98f'); const skinD = shade(skin, -26), skinL = shade(skin, 16), skinO = shade(skin, -55)
  const shirt = S(c.shirtColor, '#4f7cc4'); const pants = S(c.pantsColor, '#34405c'); const hair = S(c.hairColor, '#3a2a20')
  const p: string[] = []

  // ground shadow
  p.push(`<ellipse cx="120" cy="346" rx="52" ry="9" fill="#000" opacity="0.20"/>`)

  // legs
  if (!hasLegs) {
    const pg = G.lin(shade(pants, 12), shade(pants, -18))
    p.push(`<path d="M102,212 C100,250 100,300 104,340 L118,340 C119,300 119,250 119,214 Z" fill="${pg}" stroke="${shade(pants, -34)}" stroke-width="1"/>`)
    p.push(`<path d="M121,214 C121,250 121,300 122,340 L136,340 C140,300 140,250 138,212 Z" fill="${pg}" stroke="${shade(pants, -34)}" stroke-width="1"/>`)
  } else {
    const lg = G.lin(skinL, skinD)
    p.push(`<path d="M102,212 C100,250 100,300 104,340 L118,340 C119,300 119,250 119,214 Z" fill="${lg}"/>`)
    p.push(`<path d="M121,214 C121,250 121,300 122,340 L136,340 C140,300 140,250 138,212 Z" fill="${lg}"/>`)
  }
  // feet (default shoes)
  if (!hasFeet) {
    p.push(`<path d="M100,338 q-13,2 -13,8 q0,4 6,4 h18 v-12 z" fill="#2c2f36"/>`)
    p.push(`<path d="M140,338 q13,2 13,8 q0,4 -6,4 h-18 v-12 z" fill="#2c2f36"/>`)
  }

  // arms (skin), drawn behind torso
  const ag = G.lin(skinL, skinD)
  p.push(`<path d="M92,116 C78,124 70,160 68,196 C67,206 78,210 80,200 C84,168 92,140 100,126 Z" fill="${ag}"/>`)
  p.push(`<path d="M148,116 C162,124 170,160 172,196 C173,206 162,210 160,200 C156,168 148,140 140,126 Z" fill="${ag}"/>`)

  // torso (default tee) — body item overlays
  if (!hasBody) {
    const tg = G.lin(shade(shirt, 14), shade(shirt, -20))
    p.push(`<path d="${TORSO}" fill="${tg}" stroke="${shade(shirt, -34)}" stroke-width="1"/>`)
    p.push(`<path d="M104,108 Q120,120 136,108" stroke="${shade(shirt, -28)}" stroke-width="2" fill="none" opacity="0.6"/>`)
    // sleeves
    p.push(`<path d="M92,116 C82,122 76,140 74,156 C82,150 92,134 100,124 Z" fill="${shade(shirt, -8)}"/>`)
    p.push(`<path d="M148,116 C158,122 164,140 166,156 C158,150 148,134 140,124 Z" fill="${shade(shirt, -8)}"/>`)
  }
  // neck
  p.push(`<path d="M111,92 h18 v12 q-9,8 -18,0 z" fill="${skinD}"/>`)
  p.push(`<path d="M108,104 q12,9 24,0 q-2,5 -12,5 q-10,0 -12,-5 z" fill="${skinO}" opacity="0.25"/>`)

  // hands
  p.push(`<circle cx="${HAND_L.x}" cy="${HAND_L.y}" r="8.5" fill="${G.lin(skinL, skinD)}"/>`)
  p.push(`<circle cx="${HAND_R.x}" cy="${HAND_R.y}" r="8.5" fill="${G.lin(skinL, skinD)}"/>`)

  // head
  const hg = G.rad(skinL, skin)
  p.push(`<ellipse cx="88" cy="62" rx="6" ry="9" fill="${skin}"/><ellipse cx="152" cy="62" rx="6" ry="9" fill="${skin}"/>`)
  p.push(`<ellipse cx="120" cy="60" rx="29" ry="33" fill="${hg}" stroke="${skinO}" stroke-width="0.8"/>`)
  // soft cheek/jaw shadow
  p.push(`<path d="M93,66 q27,30 54,0 q-6,26 -27,26 q-21,0 -27,-26 z" fill="${skinD}" opacity="0.22"/>`)
  p.push(face(c, skinO))
  p.push(hairStyle(c.hair, hair, G))
  return p.join('')
}

function face(c: any, skinO: string) {
  const eye = c.eyes || 'default', mo = c.mouth || 'smile'
  const iris = '#6b4a32'
  let eyes = ''
  const E = (cx: number) => `<ellipse cx="${cx}" cy="58" rx="6" ry="4.4" fill="#fff"/><circle cx="${cx + 1}" cy="58.5" r="3.1" fill="${iris}"/><circle cx="${cx + 1}" cy="58.5" r="1.5" fill="#1a1410"/><circle cx="${cx + 2.2}" cy="56.8" r="1" fill="#fff"/><path d="M${cx - 6},55.5 q6,-4 12,0" stroke="${skinO}" stroke-width="1.1" fill="none" opacity="0.5"/>`
  if (eye === 'wink') eyes = `<circle cx="108" cy="58" r="3" fill="#241a14"/>` + E(132).replace('108', '132') + `<path d="M126,58 q6,-3 12,0" stroke="#241a14" stroke-width="2.4" fill="none" stroke-linecap="round"/>`
  else if (eye === 'happy') eyes = `<path d="M101,59 q7,-7 14,0" stroke="#241a14" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M125,59 q7,-7 14,0" stroke="#241a14" stroke-width="2.6" fill="none" stroke-linecap="round"/>`
  else eyes = E(108) + E(132)
  // brows
  const brows = `<path d="M101,49 q7,-3.5 14,-0.5" stroke="#4a372b" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M125,48.5 q7,-3 14,0.5" stroke="#4a372b" stroke-width="2.6" fill="none" stroke-linecap="round"/>`
  // nose
  const nose = `<path d="M118,60 q-3,9 0,12 q3,1 5,0" stroke="${skinO}" stroke-width="1.4" fill="none" opacity="0.45" stroke-linecap="round"/>`
  let mouth = ''
  if (mo === 'grin') mouth = `<path d="M109,75 q11,11 22,0 q-11,4 -22,0 z" fill="#fff" stroke="#9c3a3a" stroke-width="1.4"/><path d="M109,75 q11,4 22,0" stroke="#7a2e2e" stroke-width="1" fill="none"/>`
  else if (mo === 'neutral') mouth = `<path d="M111,77 q9,2 18,0" stroke="#a25a4f" stroke-width="2.6" fill="none" stroke-linecap="round"/>`
  else mouth = `<path d="M110,75 q10,8 20,0" stroke="#a25a4f" stroke-width="2.8" fill="none" stroke-linecap="round"/><path d="M113,77 q7,4 14,0" stroke="#c98" stroke-width="1.4" fill="none" opacity="0.6"/>`
  return brows + nose + eyes + mouth
}

function hairStyle(style: string, col: string, G: any) {
  const c = G.lin(shade(col, 18), shade(col, -16)); const d = shade(col, -26)
  switch (style) {
    case 'bald': return ''
    case 'buzz': return `<path d="M92,54 a29,30 0 0 1 56,0 q-28,-12 -56,0 z" fill="${col}" opacity="0.9"/>`
    case 'long': return `<path d="M90,58 a30,32 0 0 1 60,0 l5,52 q-12,9 -17,-4 l-3,-34 q-30,11 -45,0 l-3,34 q-5,13 -17,4 z" fill="${c}"/><path d="M92,50 a28,28 0 0 1 56,0 q-28,-15 -56,0 z" fill="${d}"/>`
    case 'bun': return `<circle cx="120" cy="24" r="10" fill="${c}"/><path d="M92,55 a28,29 0 0 1 56,0 q-28,-16 -56,0 z" fill="${c}"/>`
    case 'afro': return `<circle cx="120" cy="44" r="39" fill="${c}"/><circle cx="120" cy="44" r="39" fill="#000" opacity="0.06"/>`
    default: return `<path d="M91,58 a29,30 0 0 1 58,0 q-5,-3 -11,1 q-9,-11 -23,-9 q-13,-2 -22,9 q-6,-4 -11,-1 z" fill="${c}"/><path d="M99,46 q21,-12 42,0" stroke="${shade(col, 26)}" stroke-width="2" fill="none" opacity="0.5"/>`
  }
}

// ===================== CLOTHING ITEMS =====================
function lapels(c1: string) {
  return `<path d="M120,105 L106,150 L120,150 Z" fill="${shade(c1, 14)}"/><path d="M118,105 L101,120 L112,150 Z" fill="${shade(c1, 22)}"/><path d="M122,105 L139,120 L128,150 Z" fill="${shade(c1, 22)}"/>`
}
function shadeFold(c1: string) {
  return `<path d="M101,150 q19,12 38,0" stroke="${shade(c1, -26)}" stroke-width="2" fill="none" opacity="0.4"/><path d="M120,108 L120,206" stroke="${shade(c1, 18)}" stroke-width="1.5" opacity="0.3"/>`
}
function bodyItem(art: string, a: any, G: any): string {
  const sleeve = (col: string) => `<path d="M92,116 C82,122 76,140 74,158 C82,151 92,134 100,124 Z" fill="${shade(col, -10)}"/><path d="M148,116 C158,122 164,140 166,158 C158,151 148,134 140,124 Z" fill="${shade(col, -10)}"/>`
  const base = (col: string, extra = '') => {
    const tg = G.lin(shade(col, 14), shade(col, -22))
    return `<path d="${TORSO}" fill="${tg}" stroke="${shade(col, -36)}" stroke-width="1"/>` + sleeve(col) + extra
  }
  const c1 = S(a.c1 || a.color, '#4f7cc4'), c2 = S(a.c2, '#fff')
  switch (art) {
    case 'torso_suit':
      return base(c1, lapels(c1) + `<rect x="116" y="150" width="8" height="56" rx="2" fill="${c2}"/><circle cx="120" cy="166" r="1.6" fill="${shade(c2, -40)}"/><circle cx="120" cy="184" r="1.6" fill="${shade(c2, -40)}"/>` + `<path d="M104,150 L120,150 L113,176 Z" fill="${shade(c1, -14)}" opacity="0.5"/>`)
    case 'torso_coat': {
      const cg = G.lin(shade(c1, 14), shade(c1, -22))
      return `<path d="M88,118 C90,108 102,103 120,103 C138,103 150,108 152,118 L156,250 C120,262 84,250 84,250 Z" fill="${cg}" stroke="${shade(c1, -34)}" stroke-width="1"/>` + sleeve(c1)
        + `<path d="M120,104 L120,250" stroke="${shade(c1, -24)}" stroke-width="2"/>` + lapels(c1)
        + `<rect x="150" y="150" width="9" height="6" rx="1" fill="${shade(c1, -28)}"/><rect x="150" y="186" width="9" height="6" rx="1" fill="${shade(c1, -28)}"/>`
    }
    case 'torso_hoodie':
      return base(c1, `<path d="M94,106 Q120,130 146,106 Q149,122 136,128 Q120,138 104,128 Q91,122 94,106 Z" fill="${shade(c1, -16)}"/><path d="M112,150 q8,9 16,0" stroke="${shade(c1, -26)}" stroke-width="2" fill="none"/><rect x="100" y="186" width="40" height="18" rx="5" fill="${shade(c1, -12)}"/><path d="M114,128 v22 M126,128 v22" stroke="${shade(c1, 12)}" stroke-width="1.5" opacity="0.4"/>`)
    case 'torso_shirt':
      return base(c1, `<path d="M120,105 L109,140 L120,134 L131,140 Z" fill="${shade(c1, 18)}"/>` + shadeFold(c1))
    default: // tee
      return base(c1, `<path d="M104,108 Q120,122 136,108" stroke="${shade(c1, -22)}" stroke-width="2.5" fill="none"/>` + (a.c2 ? `<rect x="111" y="146" width="18" height="16" rx="2" fill="${c2}"/>` : ''))
  }
}

// ===================== LEG ITEMS =====================
function legItem(art: string, a: any, G: any): string {
  const col = S(a.color, '#34405c')
  const pg = G.lin(shade(col, 12), shade(col, -20))
  const leg = (d: string) => `<path d="${d}" fill="${pg}" stroke="${shade(col, -34)}" stroke-width="1"/>`
  const out = leg('M101,210 C99,250 99,300 103,342 L119,342 C120,300 120,250 120,212 Z') + leg('M121,212 C121,250 121,300 122,342 L138,342 C142,300 142,250 139,210 Z')
  const seam = art === 'legs_pants' ? `<path d="M110,220 L108,338 M130,220 L132,338" stroke="${shade(col, 20)}" stroke-width="1" opacity="0.4"/><path d="M101,236 q9,4 18,0 M121,236 q9,4 18,0" stroke="${shade(col, 16)}" stroke-width="1" opacity="0.4"/>` : ''
  return out + seam
}

// ===================== FEET ITEMS =====================
function feetItem(art: string, a: any, G: any): string {
  const col = S(a.color, '#eee'); const sg = G.lin(shade(col, 16), shade(col, -16))
  if (art === 'feet_boot') {
    const one = (x: number) => `<path d="M${x},318 h17 v16 q15,2 15,11 h-32 z" fill="${sg}"/><rect x="${x}" y="316" width="17" height="8" rx="3" fill="${shade(col, 18)}"/><path d="M${x + 3},322 l11,0 M${x + 3},327 l11,0" stroke="${shade(col, -28)}" stroke-width="1" opacity="0.5"/><rect x="${x - 1}" y="344" width="34" height="5" rx="2" fill="#3a2a18"/>`
    return one(99) + one(124)
  }
  if (art === 'feet_loafer') {
    const one = (cx: number) => `<path d="M${cx - 16},332 q-3,-9 5,-11 q11,-2 27,2 q5,2 4,7 q-1,5 -8,6 q-16,2 -28,-4 z" fill="${sg}"/><path d="M${cx - 8},327 l16,0" stroke="#caa45a" stroke-width="2"/>`
    return one(108) + one(134)
  }
  // sneaker
  const one = (cx: number) => `<path d="M${cx - 16},330 q-3,-10 6,-12 q12,-2 24,3 q6,2 6,8 v3 h-36 z" fill="${sg}"/><rect x="${cx - 18}" y="338" width="38" height="6" rx="3" fill="#fff" stroke="#d8d8d8" stroke-width="0.6"/><path d="M${cx - 8},322 q10,6 20,-2" stroke="${shade(col, -28)}" stroke-width="3" fill="none" stroke-linecap="round"/>`
  return one(106) + one(134)
}

// ===================== EYEWEAR =====================
function faceItem(art: string, a: any): string {
  const col = S(a.color, '#222')
  if (art === 'glasses_sun')
    return `<rect x="99" y="52" width="19" height="12" rx="4" fill="${col}"/><rect x="122" y="52" width="19" height="12" rx="4" fill="${col}"/><path d="M117,56 h6" stroke="${col}" stroke-width="2.4"/><rect x="100" y="53" width="6" height="3" rx="1.5" fill="#fff" opacity="0.35"/>`
  return `<circle cx="108" cy="58" r="8.5" fill="#bfe0ff" fill-opacity="0.18" stroke="${col}" stroke-width="2.2"/><circle cx="132" cy="58" r="8.5" fill="#bfe0ff" fill-opacity="0.18" stroke="${col}" stroke-width="2.2"/><path d="M116.5,58 h7" stroke="${col}" stroke-width="2.2"/>`
}

// ===================== HELD ITEMS =====================
function mainItem(art: string, a: any, G: any): string {
  const x = HAND_R.x, y = HAND_R.y
  if (art === 'held_briefcase') {
    const col = S(a.color, '#6b4a2b'); const bg = G.lin(shade(col, 14), shade(col, -18))
    return `<g transform="translate(${x - 1},${y + 5})"><rect x="-3" y="-11" width="6" height="11" rx="2" fill="none" stroke="${shade(col, -26)}" stroke-width="3"/><rect x="-23" y="0" width="46" height="31" rx="4" fill="${bg}" stroke="${shade(col, -30)}" stroke-width="1.2"/><rect x="-23" y="13" width="46" height="3" fill="${shade(col, -22)}"/><rect x="-7" y="-4" width="14" height="6" rx="2" fill="${shade(col, -28)}"/><rect x="13" y="10" width="7" height="9" rx="1" fill="#d4af37"/></g>`
  }
  if (art === 'held_coffee')
    return `<g transform="translate(${x},${y})"><path d="M-9,-2 h18 l-2,22 q-7,3 -14,0 z" fill="#fff" stroke="#cbb79a" stroke-width="1.2"/><rect x="-10" y="-3" width="20" height="6" rx="2" fill="#7a5230"/><ellipse cx="0" cy="-3" rx="9" ry="3" fill="#5a3a1e"/><rect x="-6" y="6" width="12" height="9" rx="1" fill="#c8a06a" opacity="0.8"/></g>`
  if (art === 'held_laptop')
    return `<g transform="translate(${x - 1},${y})"><rect x="-21" y="-3" width="42" height="27" rx="3" fill="#2b2f36"/><rect x="-18" y="0" width="36" height="21" rx="1" fill="${G.lin('#9fe0ff', '#4aa6e0')}"/><rect x="-23" y="22" width="46" height="6" rx="2" fill="#3a3f47"/></g>`
  return ''
}

// ===================== VEHICLES (realistic front view) =====================
function wheel(cx: number, cy: number, r: number) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#141417"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#2a2a2e" stroke-width="2"/>`
    + `<circle cx="${cx}" cy="${cy}" r="${r * 0.62}" fill="#c7ccd2"/><circle cx="${cx}" cy="${cy}" r="${r * 0.62}" fill="none" stroke="#9aa0a8" stroke-width="1"/>`
    + [0, 72, 144, 216, 288].map(a => { const rad = a * Math.PI / 180; return `<line x1="${cx}" y1="${cy}" x2="${cx + Math.cos(rad) * r * 0.58}" y2="${cy + Math.sin(rad) * r * 0.58}" stroke="#8a9098" stroke-width="2.4"/>` }).join('')
    + `<circle cx="${cx}" cy="${cy}" r="${r * 0.18}" fill="#6b7178"/>`
}
function vehicle(art: string, a: any, G: any): { mode: 'car' | 'ride'; back: string; front: string } {
  const col = S(a.color, '#cccccc'); const dk = shade(col, -30), lt = shade(col, 22)
  const glass = G.lin('#cfe6f5', '#7fa8c8')
  if (art === 'veh_sedan' || art === 'veh_suv' || art === 'veh_truck' || art === 'veh_super') {
    const sport = art === 'veh_super', suv = art === 'veh_suv', truck = art === 'veh_truck'
    const roofTop = sport ? 66 : suv ? 16 : 30
    const hood = sport ? 250 : truck ? 232 : 244
    const bodyG = G.lin(lt, dk)
    // cabin: roof bar + A-pillars + windshield (character sits in front of the glass)
    const back = `<g>`
      + `<rect x="80" y="${roofTop}" width="80" height="16" rx="8" fill="${bodyG}"/>`
      + `<path d="M86,150 L95,${roofTop + 12}" stroke="${col}" stroke-width="12" stroke-linecap="round"/>`
      + `<path d="M154,150 L145,${roofTop + 12}" stroke="${col}" stroke-width="12" stroke-linecap="round"/>`
      + `<path d="M96,148 L103,${roofTop + 17} L137,${roofTop + 17} L144,148 Z" fill="${glass}" opacity="0.9"/>`
      + `<path d="M101,146 l7,-${roofTop > 40 ? 12 : 18}" stroke="#fff" stroke-width="3" opacity="0.28"/>`
      + `</g>`
    // lower body, grille, lights, wheels in front (covers legs)
    const front = `<g>`
      + wheel(50, 330, 24) + wheel(190, 330, 24)
      + `<path d="M36,${hood + 6} C36,${hood - 6} 50,${hood - 12} 70,${hood - 12} L170,${hood - 12} C190,${hood - 12} 204,${hood - 6} 204,${hood + 6} L206,322 C206,334 196,340 184,340 L56,340 C44,340 34,334 34,322 Z" fill="${bodyG}" stroke="${shade(col, -40)}" stroke-width="1.2"/>`
      + `<path d="M40,${hood + 2} q80,-10 160,0" stroke="${lt}" stroke-width="3" opacity="0.5" fill="none"/>`               // hood highlight
      + `<rect x="56" y="${hood + 16}" width="128" height="18" rx="7" fill="#15171c"/>`                                      // grille
      + `<path d="M${60},${hood + 20} h120 M60,${hood + 26} h120" stroke="#33363c" stroke-width="1.5"/>`
      + `<path d="M40,${hood + 14} q14,-2 30,2 l-2,12 q-16,-3 -28,-1 z" fill="#fdf6c9" stroke="#cabf6a" stroke-width="1"/>`     // L headlight
      + `<path d="M200,${hood + 14} q-14,-2 -30,2 l2,12 q16,-3 28,-1 z" fill="#fdf6c9" stroke="#cabf6a" stroke-width="1"/>`   // R headlight
      + `<rect x="100" y="324" width="40" height="11" rx="2" fill="#e9e9e9"/><path d="M104,330 h32" stroke="#888" stroke-width="1"/>` // plate
      + `<rect x="40" y="332" width="160" height="8" rx="3" fill="#2a2a2e"/>`                                                 // bumper
      + (truck ? `<rect x="150" y="${hood - 28}" width="56" height="20" rx="3" fill="${dk}"/>` : '')
      + `</g>`
    return { mode: 'car', back, front }
  }
  if (art === 'veh_moto' || art === 'veh_vespa' || art === 'veh_bike') {
    if (art === 'veh_bike') {
      const front = `<g>`
        + `<circle cx="84" cy="320" r="28" fill="none" stroke="#1a1a1f" stroke-width="5"/><circle cx="156" cy="320" r="28" fill="none" stroke="#1a1a1f" stroke-width="5"/>`
        + `<path d="M84,320 L120,320 L104,274 Z M120,320 L138,274 L104,274 M138,274 L156,320" fill="none" stroke="${G.lin(lt, dk)}" stroke-width="5" stroke-linejoin="round"/>`
        + `<path d="M104,274 L100,252" stroke="#2a2a2e" stroke-width="5"/><rect x="92" y="246" width="18" height="7" rx="3" fill="#2a2a2e"/>`
        + `<circle cx="120" cy="320" r="6" fill="#2a2a2e"/>`
        + `<path d="M138,274 L${HAND_R.x - 6},${HAND_R.y} M138,274 L${HAND_L.x + 8},${HAND_L.y}" stroke="${dk}" stroke-width="6" stroke-linecap="round"/>`
        + `</g>`
      return { mode: 'ride', back: '', front }
    }
    const vespa = art === 'veh_vespa'
    const bodyG = G.lin(lt, dk)
    const front = vespa
      ? `<g><circle cx="120" cy="322" r="16" fill="#141417"/><circle cx="120" cy="322" r="9" fill="#c7ccd2"/>`
        + `<path d="M96,214 q24,-7 48,0 l8,106 q-32,11 -64,0 z" fill="${bodyG}" stroke="${shade(col, -34)}" stroke-width="1"/>`   // leg shield
        + `<rect x="90" y="314" width="60" height="12" rx="4" fill="${dk}"/>`
        + `<ellipse cx="120" cy="248" rx="10" ry="13" fill="#fdf6c9"/>`
        + `<path d="M120,214 L${HAND_R.x - 8},${HAND_R.y - 4} M120,214 L${HAND_L.x + 8},${HAND_L.y - 4}" stroke="${lt}" stroke-width="6" stroke-linecap="round"/></g>`
      : `<g>` + wheel(120, 322, 30)
        + `<path d="M86,300 h22 M134,300 h22" stroke="#c8ccd0" stroke-width="9" stroke-linecap="round"/>`                       // exhausts
        + `<path d="M94,214 q26,-9 52,0 l4,44 q0,32 -30,42 q-30,-10 -30,-42 z" fill="${bodyG}" stroke="${shade(col, -34)}" stroke-width="1"/>`
        + `<path d="M94,214 q26,-9 52,0 l-2,15 q-24,-8 -48,0 z" fill="${lt}" opacity="0.5"/>`
        + `<rect x="106" y="250" width="28" height="40" rx="5" fill="#3a3a3f"/>`
        + `<ellipse cx="120" cy="300" rx="12" ry="10" fill="#fdf6c9"/>`
        + `<path d="M120,214 L${HAND_R.x - 8},${HAND_R.y - 4} M120,214 L${HAND_L.x + 8},${HAND_L.y - 4}" stroke="${dk}" stroke-width="7" stroke-linecap="round"/></g>`
    return { mode: 'ride', back: '', front }
  }
  // skateboard
  const back = `<g><rect x="80" y="346" width="80" height="10" rx="5" fill="${G.lin(lt, dk)}"/><rect x="80" y="346" width="80" height="3" rx="2" fill="${lt}"/><circle cx="98" cy="359" r="5" fill="#ddd"/><circle cx="142" cy="359" r="5" fill="#ddd"/></g>`
  return { mode: 'ride', back, front: '' }
}

// ===================== ASSEMBLY =====================
function buildInner(config: any, equipped: any, itemsById: Record<string, any>, uid: string) {
  const c = config || {}, eq = equipped || {}
  const G = makeGrad(uid)
  const item = (slot: string) => { const id = eq[slot]; return id ? itemsById[id] : null }
  const asset = (slot: string) => { const it = item(slot); return it ? it.asset || {} : null }
  const vehIt = item('vehicle')
  const veh = vehIt ? vehicle((vehIt.asset || {}).art, vehIt.asset || {}, G) : null
  const bodyA = asset('body'), legA = asset('legs'), feetA = asset('feet'), mainA = asset('hand_main'), faceA = asset('face')

  const L: string[] = []
  if (c.bg) L.push(`<rect x="0" y="0" width="240" height="360" fill="${S(c.bg)}"/>`)
  if (veh) L.push(veh.back)
  L.push(baseBody(c, G, !!bodyA, !!legA, !!feetA))
  if (legA) L.push(legItem(legA.art, legA, G))
  if (feetA) L.push(feetItem(feetA.art, feetA, G))
  if (bodyA) L.push(bodyItem(bodyA.art, bodyA, G))
  if (mainA) L.push(mainItem(mainA.art, mainA, G))
  if (faceA) L.push(faceItem(faceA.art, faceA))
  if (veh) L.push(veh.front)
  return `<defs>${G.defs.join('')}</defs>` + L.join('')
}

export default function BeyondAvatar({ config, equipped, itemsById, className, style }: {
  config?: any; equipped?: any; itemsById?: Record<string, any>; className?: string; style?: any
}) {
  const uid = useId().replace(/[:]/g, '')
  const inner = useMemo(() => buildInner(config, equipped, itemsById || {}, uid), [config, equipped, itemsById, uid])
  return (
    <svg viewBox="0 0 240 360" className={className} style={style} xmlns="http://www.w3.org/2000/svg"
      dangerouslySetInnerHTML={{ __html: inner }} />
  )
}
