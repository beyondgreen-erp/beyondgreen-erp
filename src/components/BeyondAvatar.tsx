'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo } from 'react'

/*
  BeyondAvatar — a full-body, layered SVG paper-doll character.
  Base look comes from `config` (skin, hair, eyes, mouth, default shirt/pant colors).
  Equipped gear comes from `equipped` (slot -> item id) resolved through `itemsById`.
  Each shop item carries an `asset` blob: { art: <code>, metal?, color?, c1?, c2? }.
  viewBox is 0 0 240 360.  x=120 is the character centre line.
*/

const S = (h?: string, fb = '#000') => (h ? (h.startsWith('#') ? h : '#' + h) : fb)

// metal palettes -> [base, dark, light]
const METAL: Record<string, [string, string, string]> = {
  bronze: ['#cd7f32', '#8a5320', '#e8a96a'],
  iron: ['#9aa3ab', '#5c636a', '#c3c9cf'],
  steel: ['#cfd6dd', '#878e96', '#eef1f4'],
  mith: ['#5570c9', '#33488f', '#8aa0e6'],
  adamant: ['#4f9a78', '#2f6b4f', '#7bc4a0'],
  rune: ['#36c0c8', '#1f8a90', '#83e6ec'],
  dragon: ['#c0392b', '#7a1f16', '#e8635a'],
}
const mtl = (k?: string) => METAL[k || 'iron'] || METAL.iron

// ---- geometry constants (shared so layers line up) ----
const HEAD = { cx: 120, cy: 58, r: 32 }
const TORSO = 'M86,112 Q92,100 120,100 Q148,100 154,112 L150,214 Q120,226 90,214 Z'
const HAND_L = { x: 64, y: 208 }
const HAND_R = { x: 176, y: 208 }

// ===================== BASE BODY =====================
function baseBody(c: any, hasHelmet: boolean, hasBody: boolean, hasLegs: boolean, hasFeet: boolean) {
  const skin = S(c.skinColor, '#edb98a')
  const skinDk = shade(skin, -18)
  const shirt = S(c.shirtColor, '#5199e4')
  const pants = S(c.pantsColor, '#2f3b52')
  const hair = S(c.hairColor, '#3a2a20')
  const parts: string[] = []

  // legs (skin + default pants) — drawn even if covered by a car later
  if (!hasLegs) {
    parts.push(`<rect x="100" y="214" width="20" height="120" rx="9" fill="${pants}"/>`)
    parts.push(`<rect x="120" y="214" width="20" height="120" rx="9" fill="${pants}"/>`)
    parts.push(`<rect x="104" y="214" width="4" height="118" fill="${shade(pants,-12)}" opacity="0.5"/>`)
    parts.push(`<rect x="124" y="214" width="4" height="118" fill="${shade(pants,-12)}" opacity="0.5"/>`)
  } else {
    // bare skin legs; legs item overlays
    parts.push(`<rect x="100" y="214" width="20" height="120" rx="9" fill="${skin}"/>`)
    parts.push(`<rect x="120" y="214" width="20" height="120" rx="9" fill="${skin}"/>`)
  }
  // feet (default shoes)
  if (!hasFeet) {
    parts.push(`<ellipse cx="106" cy="336" rx="15" ry="8" fill="#2b2b2b"/>`)
    parts.push(`<ellipse cx="134" cy="336" rx="15" ry="8" fill="#2b2b2b"/>`)
  }

  // arms (skin) behind torso so sleeves can overlay
  parts.push(arm('L', skin))
  parts.push(arm('R', skin))

  // torso (default tee) — body item overlays
  if (!hasBody) {
    parts.push(`<path d="${TORSO}" fill="${shirt}"/>`)
    parts.push(`<path d="M86,112 Q92,100 120,100 Q148,100 154,112 L150,128 Q120,140 90,128 Z" fill="${shade(shirt,12)}" opacity="0.6"/>`)
    // sleeves
    parts.push(sleeve('L', shirt))
    parts.push(sleeve('R', shirt))
  }
  // neck
  parts.push(`<rect x="111" y="84" width="18" height="20" rx="7" fill="${skinDk}"/>`)

  // hands (skin) on top
  parts.push(`<circle cx="${HAND_L.x}" cy="${HAND_L.y}" r="9" fill="${skin}"/>`)
  parts.push(`<circle cx="${HAND_R.x}" cy="${HAND_R.y}" r="9" fill="${skin}"/>`)

  // head
  parts.push(`<ellipse cx="89" cy="60" rx="7" ry="9" fill="${skin}"/>`)
  parts.push(`<ellipse cx="151" cy="60" rx="7" ry="9" fill="${skin}"/>`)
  parts.push(`<circle cx="${HEAD.cx}" cy="${HEAD.cy}" r="${HEAD.r}" fill="${skin}"/>`)
  // face
  parts.push(face(c))
  // hair (skip when a helmet is on)
  if (!hasHelmet) parts.push(hairStyle(c.hair, hair))
  return parts.join('')
}

function shade(hex: string, amt: number) {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16)
  let r = (n >> 16) + amt, g = ((n >> 8) & 255) + amt, b = (n & 255) + amt
  r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b))
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)
}

function arm(side: 'L' | 'R', fill: string) {
  return side === 'L'
    ? `<rect x="64" y="106" width="18" height="104" rx="9" fill="${fill}" transform="rotate(9 73 110)"/>`
    : `<rect x="158" y="106" width="18" height="104" rx="9" fill="${fill}" transform="rotate(-9 167 110)"/>`
}
function sleeve(side: 'L' | 'R', fill: string) {
  return side === 'L'
    ? `<rect x="64" y="104" width="18" height="58" rx="9" fill="${fill}" transform="rotate(9 73 110)"/>`
    : `<rect x="158" y="104" width="18" height="58" rx="9" fill="${fill}" transform="rotate(-9 167 110)"/>`
}

function face(c: any) {
  const eye = c.eyes || 'default'
  const mo = c.mouth || 'smile'
  let eyes = ''
  if (eye === 'wink') eyes = `<circle cx="108" cy="58" r="3.6" fill="#27313a"/><path d="M127,58 q5,-3 10,0" stroke="#27313a" stroke-width="2.5" fill="none" stroke-linecap="round"/>`
  else if (eye === 'happy') eyes = `<path d="M103,59 q5,-6 10,0" stroke="#27313a" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M127,59 q5,-6 10,0" stroke="#27313a" stroke-width="2.6" fill="none" stroke-linecap="round"/>`
  else eyes = `<circle cx="108" cy="58" r="3.6" fill="#27313a"/><circle cx="132" cy="58" r="3.6" fill="#27313a"/>`
  let mouth = ''
  if (mo === 'grin') mouth = `<path d="M110,74 q10,10 20,0 z" fill="#fff" stroke="#c0392b" stroke-width="1.5"/>`
  else if (mo === 'neutral') mouth = `<path d="M111,76 h18" stroke="#a0564a" stroke-width="2.6" stroke-linecap="round"/>`
  else mouth = `<path d="M110,74 q10,9 20,0" stroke="#a0564a" stroke-width="2.8" fill="none" stroke-linecap="round"/>`
  // brows
  const brows = `<path d="M101,48 q7,-3 14,0" stroke="#5b463a" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M125,48 q7,-3 14,0" stroke="#5b463a" stroke-width="2.4" fill="none" stroke-linecap="round"/>`
  return brows + eyes + mouth
}

function hairStyle(style: string, col: string) {
  const c = col, d = shade(col, -22)
  switch (style) {
    case 'bald': return ''
    case 'buzz': return `<path d="M88,52 a32,32 0 0 1 64,0 q-32,-14 -64,0 z" fill="${c}" opacity="0.92"/>`
    case 'long': return `<path d="M86,56 a34,34 0 0 1 68,0 l4,46 q-12,8 -16,-6 l-2,-30 q-36,12 -40,0 l-2,30 q-4,14 -16,6 z" fill="${c}"/><path d="M88,50 a32,32 0 0 1 64,0 q-32,-16 -64,0 z" fill="${d}"/>`
    case 'bun': return `<circle cx="120" cy="24" r="11" fill="${c}"/><path d="M88,54 a32,32 0 0 1 64,0 q-32,-18 -64,0 z" fill="${c}"/>`
    case 'afro': return `<circle cx="120" cy="42" r="42" fill="${c}"/><circle cx="120" cy="58" r="31" fill="none"/>`
    default: /* short */ return `<path d="M88,56 a32,32 0 0 1 64,0 q-6,-2 -10,2 q-8,-10 -22,-8 q-14,-2 -22,8 q-4,-4 -10,-2 z" fill="${c}"/>`
  }
}

// ===================== BODY (torso) ITEMS =====================
function bodyItem(art: string, a: any): string {
  const c1 = S(a.c1, '#222'), c2 = S(a.c2, '#fff')
  if (art === 'torso_plate') {
    const [base, dk, lt] = mtl(a.metal)
    return `<path d="${TORSO}" fill="${base}" stroke="${dk}" stroke-width="2"/>`
      + sleeve('L', base) + sleeve('R', base)
      + `<path d="M86,112 Q92,100 120,100 Q148,100 154,112 L150,126 Q120,138 90,126 Z" fill="${lt}" opacity="0.55"/>`
      + `<path d="M120,100 L120,222" stroke="${dk}" stroke-width="2" opacity="0.6"/>`
      + `<path d="M96,150 h48 M94,178 h52" stroke="${dk}" stroke-width="2" opacity="0.5"/>`
      + `<circle cx="104" cy="138" r="3" fill="${dk}"/><circle cx="136" cy="138" r="3" fill="${dk}"/>`
  }
  const detail = (over: string) =>
    `<path d="${TORSO}" fill="${c1}"/>` + sleeve('L', c1) + sleeve('R', c1) + over
  switch (art) {
    case 'torso_suit':
      return detail(
        `<path d="M120,104 L104,150 L120,150 Z" fill="${c2}"/>`
        + `<path d="M118,104 L100,118 L112,150 Z" fill="${shade(c1,14)}"/>`
        + `<path d="M122,104 L140,118 L128,150 Z" fill="${shade(c1,14)}"/>`
        + `<rect x="116" y="150" width="8" height="60" fill="${c2}" opacity="0.9"/>`
        + `<circle cx="120" cy="170" r="2" fill="${shade(c2,-30)}"/><circle cx="120" cy="190" r="2" fill="${shade(c2,-30)}"/>`)
    case 'torso_coat':
      return `<path d="M86,112 Q92,100 120,100 Q148,100 154,112 L156,250 Q120,262 84,250 Z" fill="${c1}"/>`
        + sleeve('L', c1) + sleeve('R', c1)
        + `<path d="M120,102 L120,250" stroke="${shade(c1,-18)}" stroke-width="2.5"/>`
        + `<path d="M118,104 L104,150 M122,104 L136,150" stroke="${shade(c1,16)}" stroke-width="6" stroke-linecap="round"/>`
        + `<rect x="150" y="150" width="10" height="6" fill="${shade(c1,-22)}"/>`
    case 'torso_hoodie':
      return detail(
        `<path d="M92,104 Q120,128 148,104 Q150,118 138,124 Q120,134 102,124 Q90,118 92,104 Z" fill="${shade(c1,-14)}"/>`
        + `<path d="M112,150 q8,8 16,0" stroke="${shade(c1,-20)}" stroke-width="2" fill="none"/>`
        + `<rect x="100" y="186" width="40" height="18" rx="4" fill="${shade(c1,-10)}"/>`)
    case 'torso_shirt':
      return detail(
        `<path d="M120,104 L108,140 L120,134 L132,140 Z" fill="${shade(c1,16)}"/>`
        + `<path d="M120,104 L120,210" stroke="${c2}" stroke-width="2" opacity="0.7"/>`)
    default: /* torso_tee */
      return detail(`<path d="M104,106 Q120,120 136,106" stroke="${shade(c1,-16)}" stroke-width="3" fill="none"/>`
        + (a.c2 ? `<rect x="112" y="150" width="16" height="16" fill="${c2}"/>` : ''))
  }
}

// ===================== LEG ITEMS =====================
function legItem(art: string, a: any): string {
  if (art === 'legs_plate') {
    const [base, dk, lt] = mtl(a.metal)
    return `<rect x="97" y="210" width="24" height="124" rx="9" fill="${base}" stroke="${dk}" stroke-width="1.5"/>`
      + `<rect x="119" y="210" width="24" height="124" rx="9" fill="${base}" stroke="${dk}" stroke-width="1.5"/>`
      + `<rect x="97" y="248" width="24" height="8" fill="${lt}" opacity="0.6"/><rect x="119" y="248" width="24" height="8" fill="${lt}" opacity="0.6"/>`
      + `<rect x="97" y="290" width="24" height="6" fill="${dk}" opacity="0.5"/><rect x="119" y="290" width="24" height="6" fill="${dk}" opacity="0.5"/>`
  }
  const col = S(a.color, '#2f3b52')
  return `<rect x="98" y="212" width="23" height="122" rx="9" fill="${col}"/>`
    + `<rect x="119" y="212" width="23" height="122" rx="9" fill="${col}"/>`
    + `<rect x="103" y="214" width="3" height="118" fill="${shade(col,-14)}" opacity="0.5"/>`
    + `<rect x="124" y="214" width="3" height="118" fill="${shade(col,-14)}" opacity="0.5"/>`
}

// ===================== FEET ITEMS =====================
function feetItem(art: string, a: any): string {
  const col = S(a.color, '#eee')
  if (art === 'feet_boot')
    return `<path d="M92,318 h16 v12 q14,2 14,10 h-30 z" fill="${col}"/><path d="M120,318 h16 v12 q14,2 14,10 h-30 z" fill="${col}"/>`
      + `<rect x="92" y="338" width="30" height="5" rx="2" fill="${shade(col,-30)}"/><rect x="120" y="338" width="30" height="5" rx="2" fill="${shade(col,-30)}"/>`
  if (art === 'feet_loafer')
    return `<ellipse cx="108" cy="334" rx="16" ry="8" fill="${col}"/><ellipse cx="134" cy="334" rx="16" ry="8" fill="${col}"/>`
      + `<path d="M100,330 h10 M126,330 h10" stroke="#d4af37" stroke-width="2"/>`
  // sneaker
  return `<path d="M93,326 q-4,10 14,12 h6 v-14 z" fill="${col}"/><path d="M121,326 q-4,10 14,12 h6 v-14 z" fill="${col}"/>`
    + `<rect x="89" y="336" width="30" height="6" rx="3" fill="#fff"/><rect x="117" y="336" width="30" height="6" rx="3" fill="#fff"/>`
    + `<path d="M104,328 l6,4 M132,328 l6,4" stroke="${shade(col,-30)}" stroke-width="2"/>`
}

// ===================== HEAD ITEMS (helmets) =====================
function headItem(art: string, a: any): string {
  const [base, dk, lt] = mtl(a.metal)
  if (art === 'helm_full')
    return `<path d="M86,58 a34,34 0 0 1 68,0 l0,16 q-10,4 -14,-2 l0,-10 q-20,-6 -40,0 l0,10 q-4,6 -14,2 z" fill="${base}" stroke="${dk}" stroke-width="2"/>`
      + `<rect x="100" y="56" width="40" height="8" rx="3" fill="${shade(dk,-10)}"/>`
      + `<path d="M118,30 q2,-8 4,0" stroke="${a.plume || lt}" stroke-width="6" stroke-linecap="round"/>`
      + `<path d="M90,50 a30,30 0 0 1 60,0 q-30,-12 -60,0 z" fill="${lt}" opacity="0.4"/>`
  // med helm (open)
  return `<path d="M88,56 a32,32 0 0 1 64,0 q-32,-16 -64,0 z" fill="${base}" stroke="${dk}" stroke-width="2"/>`
    + `<rect x="118" y="40" width="4" height="44" fill="${base}" stroke="${dk}" stroke-width="1"/>`
    + `<path d="M90,48 a30,30 0 0 1 60,0 q-30,-12 -60,0 z" fill="${lt}" opacity="0.4"/>`
}

// ===================== FACE accessory (glasses) =====================
function faceItem(art: string, a: any): string {
  const col = S(a.color, '#222')
  if (art === 'glasses_sun')
    return `<rect x="99" y="53" width="18" height="11" rx="3" fill="${col}"/><rect x="123" y="53" width="18" height="11" rx="3" fill="${col}"/><path d="M117,57 h6" stroke="${col}" stroke-width="2"/>`
  return `<circle cx="108" cy="58" r="8" fill="none" stroke="${col}" stroke-width="2"/><circle cx="132" cy="58" r="8" fill="none" stroke="${col}" stroke-width="2"/><path d="M116,58 h8" stroke="${col}" stroke-width="2"/>`
}

// ===================== HAND-OFF (shield) =====================
function offItem(art: string, a: any): string {
  const [base, dk, lt] = mtl(a.metal)
  // kite shield centred on left hand
  const x = HAND_L.x, y = HAND_L.y
  return `<g transform="translate(${x - 2},${y - 6})">`
    + `<path d="M-16,-22 h32 v18 q0,22 -16,32 q-16,-10 -16,-32 z" fill="${base}" stroke="${dk}" stroke-width="2"/>`
    + `<path d="M0,-22 v52 M-16,-4 h32" stroke="${dk}" stroke-width="2" opacity="0.6"/>`
    + `<circle cx="0" cy="2" r="5" fill="${lt}"/></g>`
}

// ===================== HAND-MAIN (held item / weapon) =====================
function mainItem(art: string, a: any): string {
  const x = HAND_R.x, y = HAND_R.y
  const t = (inner: string) => `<g transform="translate(${x},${y})">${inner}</g>`
  if (art === 'weapon_sword' || art === 'weapon_scimitar') {
    const [base, dk, lt] = mtl(a.metal)
    const blade = art === 'weapon_scimitar'
      ? `<path d="M2,-6 q22,-30 8,-66 q-2,40 -16,64 z" fill="${base}" stroke="${dk}" stroke-width="1.5"/>`
      : `<rect x="-3" y="-78" width="8" height="74" rx="2" fill="${base}" stroke="${dk}" stroke-width="1.5"/><path d="M1,-78 v74" stroke="${lt}" stroke-width="1.5"/>`
    return t(`<rect x="-9" y="-6" width="20" height="6" rx="2" fill="#3a2a18"/>`
      + `<rect x="-2" y="0" width="6" height="16" rx="2" fill="#5a3a1e"/>` + blade)
  }
  if (art === 'weapon_katana') {
    return t(`<rect x="-2" y="0" width="6" height="16" rx="2" fill="#1a1a1a"/>`
      + `<rect x="-9" y="-4" width="20" height="5" rx="2" fill="#2a2a2a"/>`
      + `<path d="M2,-4 q14,-34 4,-70 q4,38 -8,70 z" fill="#e9edf0" stroke="#9aa3ab" stroke-width="1"/>`)
  }
  if (art === 'held_briefcase') {
    const col = S(a.color, '#6b4a2b')
    return `<g transform="translate(${x - 2},${y + 4})"><rect x="-2" y="-10" width="4" height="10" fill="${shade(col,-20)}"/>`
      + `<rect x="-22" y="0" width="44" height="30" rx="4" fill="${col}" stroke="${shade(col,-25)}" stroke-width="2"/>`
      + `<rect x="-22" y="12" width="44" height="3" fill="${shade(col,-20)}"/><rect x="-6" y="-4" width="12" height="6" rx="2" fill="${shade(col,-30)}"/>`
      + `<rect x="14" y="10" width="6" height="8" rx="1" fill="#d4af37"/></g>`
  }
  if (art === 'held_coffee')
    return t(`<rect x="-9" y="-2" width="18" height="22" rx="3" fill="#fff" stroke="#cbb79a" stroke-width="1.5"/>`
      + `<rect x="-9" y="4" width="18" height="7" fill="#7a5230"/><ellipse cx="0" cy="-2" rx="9" ry="3" fill="#e8ded0"/>`)
  if (art === 'held_laptop')
    return `<g transform="translate(${x - 2},${y})"><rect x="-20" y="-2" width="40" height="26" rx="3" fill="#2b2f36"/>`
      + `<rect x="-17" y="1" width="34" height="20" rx="1" fill="#7fd0ff"/><rect x="-22" y="22" width="44" height="5" rx="2" fill="#3a3f47"/></g>`
  return ''
}

// ===================== VEHICLES =====================
// each returns { mode:'car'|'ride', back:string, front:string }
function vehicle(art: string, a: any): { mode: 'car' | 'ride'; back: string; front: string } {
  const col = S(a.color, '#cccccc')
  const dk = shade(col, -28), lt = shade(col, 18)
  const wheel = (cx: number) => `<circle cx="${cx}" cy="334" r="22" fill="#15151a"/><circle cx="${cx}" cy="334" r="10" fill="#9aa0a8"/><circle cx="${cx}" cy="334" r="4" fill="#444"/>`
  if (art === 'veh_sedan' || art === 'veh_truck' || art === 'veh_suv' || art === 'veh_super') {
    const isSuper = art === 'veh_super', isSuv = art === 'veh_suv', isTruck = art === 'veh_truck'
    const top = isSuper ? 178 : 150         // hood line — head + shoulders sit above it
    // optional cabin roof + pillars behind the character (SUV/truck)
    const back = (isSuv || isTruck)
      ? `<g><rect x="74" y="18" width="92" height="20" rx="7" fill="${col}"/>`
        + `<rect x="74" y="30" width="9" height="124" fill="${col}"/><rect x="157" y="30" width="9" height="124" fill="${col}"/></g>`
      : ''
    const front = `<g>`
      + wheel(46) + wheel(194)
      + `<rect x="40" y="${top}" width="160" height="${344 - top}" rx="${isSuper ? 34 : 22}" fill="${col}"/>`
      + `<rect x="40" y="${top}" width="160" height="14" rx="8" fill="${lt}" opacity="0.45"/>`
      // windshield (character's head & shoulders are above this)
      + `<path d="M82,${top + 4} L158,${top + 4} L146,${top + 30} L94,${top + 30} Z" fill="#1b2c44" opacity="0.85"/>`
      + `<path d="M120,${top + 4} L120,${top + 30}" stroke="#33455f" stroke-width="2"/>`
      // grille + plate + bumper near the bottom
      + `<rect x="62" y="306" width="116" height="16" rx="5" fill="${dk}"/>`
      + `<rect x="104" y="324" width="32" height="9" rx="2" fill="#e8e8e8"/>`
      + `<ellipse cx="64" cy="296" rx="13" ry="9" fill="#fff6c2"/><ellipse cx="176" cy="296" rx="13" ry="9" fill="#fff6c2"/>`
      + `<rect x="44" y="332" width="152" height="9" rx="4" fill="${dk}"/>`
      + (isTruck ? `<rect x="150" y="${top - 16}" width="50" height="20" rx="4" fill="${dk}" opacity="0.85"/>` : '')
      + `</g>`
    return { mode: 'car', back, front }
  }
  if (art === 'veh_moto' || art === 'veh_vespa' || art === 'veh_bike') {
    if (art === 'veh_bike') {
      // bicycle, front view: two big wheels, frame, raised seat, handlebars to hands
      const front = `<g>`
        + `<circle cx="86" cy="318" r="30" fill="#1a1a1f" stroke="#333" stroke-width="3"/><circle cx="86" cy="318" r="11" fill="#8a9099"/>`
        + `<circle cx="154" cy="318" r="30" fill="#1a1a1f" stroke="#333" stroke-width="3"/><circle cx="154" cy="318" r="11" fill="#8a9099"/>`
        + `<path d="M86,318 L120,318 L106,272 Z M120,318 L138,272 L106,272 M138,272 L154,318" fill="none" stroke="${col}" stroke-width="5" stroke-linejoin="round"/>`
        + `<path d="M106,272 L102,250" stroke="#333" stroke-width="5"/><rect x="93" y="244" width="18" height="7" rx="3" fill="#333"/>`
        + `<circle cx="120" cy="318" r="7" fill="#333"/>`
        + `<path d="M138,272 L${HAND_R.x - 6},${HAND_R.y} M138,272 L${HAND_L.x + 8},${HAND_L.y}" stroke="${col}" stroke-width="6" stroke-linecap="round"/>`
        + `</g>`
      return { mode: 'ride', back: '', front }
    }
    if (art === 'veh_vespa') {
      // scooter, front view: big leg-shield hides the legs, handlebars to hands
      const front = `<g>`
        + `<circle cx="120" cy="322" r="15" fill="#15151a"/><circle cx="120" cy="322" r="6" fill="#888"/>`
        + `<path d="M96,214 q24,-6 48,0 l7,104 q-31,10 -62,0 z" fill="${col}"/>`         // leg shield over legs
        + `<rect x="90" y="314" width="60" height="11" rx="4" fill="${dk}"/>`              // floorboard
        + `<ellipse cx="120" cy="250" rx="10" ry="13" fill="#fff6c2"/>`                    // headlight
        + `<path d="M120,214 L${HAND_R.x - 8},${HAND_R.y - 4} M120,214 L${HAND_L.x + 8},${HAND_L.y - 4}" stroke="${lt}" stroke-width="6" stroke-linecap="round"/>`
        + `</g>`
      return { mode: 'ride', back: '', front }
    }
    // motorcycle, front view: large body straddled over the legs, big wheel, pipes, bars
    const front = `<g>`
      + `<circle cx="120" cy="322" r="30" fill="#15151a"/><circle cx="120" cy="322" r="12" fill="#9aa0a8"/><circle cx="120" cy="322" r="4" fill="#444"/>`
      + `<rect x="84" y="298" width="22" height="11" rx="5" fill="#c8ccd0"/><rect x="134" y="298" width="22" height="11" rx="5" fill="#c8ccd0"/>` // twin exhausts
      + `<path d="M94,214 q26,-8 52,0 l4,42 q0,30 -30,40 q-30,-10 -30,-40 z" fill="${col}"/>`   // big body over legs
      + `<path d="M94,214 q26,-8 52,0 l-2,14 q-24,-7 -48,0 z" fill="${lt}" opacity="0.5"/>`        // seat highlight
      + `<rect x="106" y="250" width="28" height="40" rx="5" fill="#3a3a3f"/>`                     // engine block
      + `<ellipse cx="120" cy="300" rx="12" ry="10" fill="#fff6c2"/>`                              // headlight
      + `<path d="M120,214 L${HAND_R.x - 8},${HAND_R.y - 4} M120,214 L${HAND_L.x + 8},${HAND_L.y - 4}" stroke="${dk}" stroke-width="7" stroke-linecap="round"/>`
      + `<circle cx="${HAND_R.x - 6}" cy="${HAND_R.y - 6}" r="5" fill="#222"/><circle cx="${HAND_L.x + 6}" cy="${HAND_L.y - 6}" r="5" fill="#222"/>`
      + `</g>`
    return { mode: 'ride', back: '', front }
  }
  // skateboard
  const back = `<g><rect x="82" y="346" width="76" height="9" rx="4" fill="${col}"/>`
    + `<rect x="82" y="346" width="76" height="3" rx="2" fill="${lt}"/>`
    + `<circle cx="98" cy="358" r="5" fill="#ddd"/><circle cx="142" cy="358" r="5" fill="#ddd"/></g>`
  return { mode: 'ride', back, front: '' }
}

// ===================== ASSEMBLY =====================
function buildInner(config: any, equipped: any, itemsById: Record<string, any>) {
  const c = config || {}
  const eq = equipped || {}
  const item = (slot: string) => { const id = eq[slot]; return id ? itemsById[id] : null }
  const asset = (slot: string) => { const it = item(slot); return it ? it.asset || {} : null }

  const vehIt = item('vehicle')
  const veh = vehIt ? vehicle((vehIt.asset || {}).art, vehIt.asset || {}) : null
  const headA = asset('head'), bodyA = asset('body'), legA = asset('legs'), feetA = asset('feet')
  const offA = asset('hand_off'), mainA = asset('hand_main'), faceA = asset('face')

  const L: string[] = []
  if (c.bg) L.push(`<rect x="0" y="0" width="240" height="360" fill="${S(c.bg)}"/>`)
  if (veh) L.push(veh.back)
  // base body (knows what's covered)
  L.push(baseBody(c, !!headA, !!bodyA, !!legA, !!feetA))
  // overlays
  if (legA) L.push(legItem(legA.art, legA))
  if (feetA) L.push(feetItem(feetA.art, feetA))
  if (bodyA) L.push(bodyItem(bodyA.art, bodyA))
  if (offA) L.push(offItem(offA.art, offA))
  if (mainA) L.push(mainItem(mainA.art, mainA))
  if (headA) L.push(headItem(headA.art, headA))
  if (faceA) L.push(faceItem(faceA.art, faceA))
  if (veh) L.push(veh.front)
  return L.join('')
}

export default function BeyondAvatar({ config, equipped, itemsById, className, style }: {
  config?: any; equipped?: any; itemsById?: Record<string, any>; className?: string; style?: any
}) {
  const inner = useMemo(() => buildInner(config, equipped, itemsById || {}), [config, equipped, itemsById])
  return (
    <svg viewBox="0 0 240 360" className={className} style={style} xmlns="http://www.w3.org/2000/svg"
      dangerouslySetInnerHTML={{ __html: inner }} />
  )
}

// Helper for shop previews: build equipped map for a single item plus the base look
export function previewEquipped(item: any) {
  return { [item.slot]: item.id }
}
