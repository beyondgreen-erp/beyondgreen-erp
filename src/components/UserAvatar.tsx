'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
// Shared avatar used everywhere a person's name appears in the ERP.
// Renders the player's beyondWorld avatar (DiceBear avataaars + equipped cosmetics).
// Falls back to the classic coloured initials circle when a user has no avatar yet.
import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const DICEBEAR = 'https://api.dicebear.com/9.x/avataaars/svg'

function buildUrl(cfg: any, equipped: any, itemsById: Record<string, any>) {
  cfg = cfg || {}; equipped = equipped || {}
  const base: any = {
    skinColor: cfg.skinColor || 'edb98a', top: cfg.top || 'shortFlat', hairColor: cfg.hairColor || '4a312c',
    eyes: cfg.eyes || 'default', eyebrows: cfg.eyebrows || 'default', mouth: cfg.mouth || 'smile',
    clothing: cfg.clothing || 'shirtCrewNeck', clothesColor: cfg.clothesColor || '5199e4',
    backgroundColor: cfg.backgroundColor || 'b6e3f4', facialHair: cfg.facialHair || '',
  }
  let hatColor: string | null = null, accessories: string | null = null, facialHair = base.facialHair, graphic: string | null = null
  for (const slot of ['top','accessories','clothing','facialHair','background']) {
    const id = equipped?.[slot]; if (!id) continue; const it = itemsById[id]; if (!it) continue; const a = it.asset || {}
    if (a.kind === 'avatar') {
      if (a.param === 'top') { base.top = a.value; if (a.hatColor) hatColor = a.hatColor }
      else if (a.param === 'accessories') accessories = a.value
      else if (a.param === 'clothing') { base.clothing = a.value; if (a.graphic) graphic = a.graphic }
      else if (a.param === 'facialHair') facialHair = a.value
    } else if (a.kind === 'bg' && slot === 'background') base.backgroundColor = a.value
  }
  const p = new URLSearchParams()
  p.set('seed', cfg.seed || 'beyondGREEN')
  for (const k of ['skinColor','top','hairColor','eyes','eyebrows','mouth','clothing','clothesColor','backgroundColor']) p.set(k, base[k])
  if (hatColor) p.set('hatColor', hatColor)
  if (graphic) p.set('clothingGraphic', graphic)
  if (facialHair) { p.set('facialHair', facialHair); p.set('facialHairProbability','100') } else p.set('facialHairProbability','0')
  if (accessories) { p.set('accessories', accessories); p.set('accessoriesProbability','100') } else p.set('accessoriesProbability','0')
  return `${DICEBEAR}?${p.toString()}`
}

// Singleton cache: fetch every player's avatar config + the cosmetics catalog once,
// then resolve a ready-to-use image URL per email. Shared across all <UserAvatar/> instances.
let cachePromise: Promise<Record<string, string>> | null = null
function loadAvatarMap(): Promise<Record<string, string>> {
  if (cachePromise) return cachePromise
  cachePromise = (async () => {
    try {
      const sb = createSupabaseBrowserClient()
      const [{ data: profs }, { data: items }] = await Promise.all([
        sb.from('player_profiles').select('user_email,avatar_config,equipped'),
        sb.from('shop_items').select('id,slot,asset'),
      ])
      const itemsById: Record<string, any> = {}
      for (const it of (items as any[]) || []) itemsById[it.id] = it
      const map: Record<string, string> = {}
      for (const p of (profs as any[]) || []) {
        if (!p.user_email) continue
        map[String(p.user_email).toLowerCase()] = buildUrl(p.avatar_config, p.equipped, itemsById)
      }
      return map
    } catch { return {} }
  })()
  return cachePromise
}

export default function UserAvatar({ email, initials = '?', color = '#374151', size = 32, className = '', style = {} }:
  { email?: string | null; initials?: string; color?: string; size?: number; className?: string; style?: React.CSSProperties }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (!email) return
    loadAvatarMap().then(map => { if (alive) setUrl(map[email.toLowerCase()] || null) })
    return () => { alive = false }
  }, [email])

  const dim = { width: size, height: size }
  if (url) {
    return (
      <img src={url} alt={initials} className={`rounded-full object-cover shrink-0 ${className}`}
        style={{ ...dim, background: '#e6edf5', ...style }} />
    )
  }
  return (
    <div className={`rounded-full flex items-center justify-center text-white font-bold shrink-0 ${className}`}
      style={{ ...dim, backgroundColor: color, fontSize: Math.max(10, Math.round(size * 0.38)), ...style }}>
      {initials}
    </div>
  )
}
