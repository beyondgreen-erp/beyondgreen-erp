'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
// Shared avatar used everywhere a person's name appears in the ERP.
// Renders the player's beyondWorld avatar (DiceBear avataaars + equipped cosmetics),
// including prestige frames (rings/auras) and corner badges. Falls back to the
// classic coloured initials circle when a user has no avatar yet.
import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const DICEBEAR = '/api/avatar'

const FRAME_DECO: Record<string, { bg: string; glow?: string; anim?: string }> = {
  bronze: { bg: '#cd7f32' }, silver: { bg: '#cfd4da' },
  gold: { bg: '#f5c518', glow: '0 0 6px 1px rgba(245,197,24,.6)' },
  emerald: { bg: '#34d399', glow: '0 0 8px 1px rgba(52,211,153,.7)' },
  sapphire: { bg: '#3b82f6', glow: '0 0 8px 1px rgba(59,130,246,.7)' },
  ruby: { bg: '#ef4444', glow: '0 0 9px 1px rgba(239,68,68,.7)' },
  neon: { bg: '#22d3ee', glow: '0 0 12px 2px rgba(34,211,238,.85)', anim: 'bw-pulse' },
  rainbow: { bg: 'conic-gradient(from 0deg,#ff0000,#ff8800,#ffee00,#00cc44,#0088ff,#8800ff,#ff0066,#ff0000)', anim: 'bw-spin' },
  diamond: { bg: 'linear-gradient(135deg,#ffffff,#a5f3fc,#3b82f6,#ffffff)', glow: '0 0 10px 2px rgba(165,243,252,.85)', anim: 'bw-pulse' },
  mythic: { bg: 'conic-gradient(from 0deg,#a855f7,#ec4899,#f59e0b,#a855f7)', glow: '0 0 14px 2px rgba(168,85,247,.85)', anim: 'bw-spin' },
  cosmic: { bg: 'conic-gradient(from 0deg,#22d3ee,#a855f7,#ec4899,#f59e0b,#22d3ee)', glow: '0 0 20px 3px rgba(168,85,247,.9)', anim: 'bw-spin' },
  celestial: { bg: 'linear-gradient(135deg,#fde68a,#f5c518,#ffffff,#fbbf24,#f5c518)', glow: '0 0 18px 3px rgba(245,197,24,.95)', anim: 'bw-pulse' },
}
const BW_KEYFRAMES = '@keyframes bw-spin{to{transform:rotate(1turn)}}@keyframes bw-pulse{0%,100%{opacity:1}50%{opacity:.45}}.bw-spin{animation:bw-spin 5s linear infinite}.bw-pulse{animation:bw-pulse 1.6s ease-in-out infinite}'
let kfInjected = false
function injectKeyframes() {
  if (kfInjected || typeof document === 'undefined') return
  if (!document.getElementById('bw-frames-kf')) {
    const s = document.createElement('style'); s.id = 'bw-frames-kf'; s.textContent = BW_KEYFRAMES; document.head.appendChild(s)
  }
  kfInjected = true
}

// Config is the single source of truth for the character (matches beyondWorld's renderer).
function buildUrl(cfg: any, _equipped?: any, _itemsById?: any) {
  cfg = cfg || {}
  const p = new URLSearchParams()
  p.set('seed', cfg.seed || 'beyondGREEN')
  p.set('skinColor', cfg.skinColor || 'edb98a')
  p.set('top', cfg.top || 'shortFlat')
  p.set('hairColor', cfg.hairColor || '4a312c')
  p.set('eyes', cfg.eyes || 'default')
  p.set('eyebrows', cfg.eyebrows || 'default')
  p.set('mouth', cfg.mouth || 'smile')
  p.set('clothing', cfg.clothing || 'shirtCrewNeck')
  p.set('clothesColor', cfg.clothesColor || '5199e4')
  if (cfg.clothingGraphic) p.set('clothingGraphic', cfg.clothingGraphic)
  if (cfg.hatColor) p.set('hatColor', cfg.hatColor)
  const bg = cfg.backgroundColor || 'b6e3f4'
  if (cfg.bgGradient) { p.set('backgroundColor', bg + ',' + cfg.bgGradient); p.set('backgroundType', 'gradientLinear') }
  else p.set('backgroundColor', bg)
  if (cfg.facialHair) { p.set('facialHair', cfg.facialHair); p.set('facialHairProbability', '100'); p.set('facialHairColor', cfg.facialHairColor || '2c1b18') } else p.set('facialHairProbability', '0')
  if (cfg.accessories) { p.set('accessories', cfg.accessories); p.set('accessoriesProbability', '100'); p.set('accessoriesColor', cfg.accessoriesColor || '3c4f5c') } else p.set('accessoriesProbability', '0')
  return `${DICEBEAR}?${p.toString()}`
}

interface Deco { url: string; frame: string | null; badge: string | null; prop: string | null }
let cachePromise: Promise<Record<string, Deco>> | null = null
function loadAvatarMap(): Promise<Record<string, Deco>> {
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
      const map: Record<string, Deco> = {}
      for (const p of (profs as any[]) || []) {
        if (!p.user_email) continue
        const eq = p.equipped || {}
        const frameIt = itemsById[eq.frame]; const badgeIt = itemsById[eq.badge]; const propIt = itemsById[eq.prop]
        map[String(p.user_email).toLowerCase()] = {
          url: buildUrl(p.avatar_config, eq, itemsById),
          frame: frameIt?.asset?.kind === 'frame' ? frameIt.asset.style : null,
          badge: badgeIt?.asset?.kind === 'badge' ? badgeIt.asset.emoji : null,
          prop: propIt?.asset?.kind === 'prop' ? propIt.asset.emoji : null,
        }
      }
      return map
    } catch { return {} }
  })()
  return cachePromise
}

export default function UserAvatar({ email, initials = '?', color = '#374151', size = 32, className = '', style = {} }:
  { email?: string | null; initials?: string; color?: string; size?: number; className?: string; style?: React.CSSProperties }) {
  const [deco, setDeco] = useState<Deco | null>(null)
  useEffect(() => {
    let alive = true; injectKeyframes()
    if (!email) return
    loadAvatarMap().then(map => { if (alive) setDeco(map[email.toLowerCase()] || null) })
    return () => { alive = false }
  }, [email])

  if (deco?.url) {
    const f = deco.frame ? FRAME_DECO[deco.frame] : null
    const pad = f ? Math.max(2, Math.round(size * 0.07)) : 0
    return (
      <div className={`shrink-0 ${className}`} style={{ position: 'relative', width: size, height: size, ...style }}>
        {f && <div className={f.anim || ''} style={{ position: 'absolute', inset: 0, borderRadius: '9999px', background: f.bg, boxShadow: f.glow }} />}
        <img src={deco.url} alt={initials} style={{ position: 'absolute', inset: pad, width: size - 2 * pad, height: size - 2 * pad, borderRadius: '9999px', background: '#e6edf5', objectFit: 'cover' }} />
        {deco.prop && <span style={{ position: 'absolute', left: -2, bottom: -2, fontSize: Math.round(size * 0.4), lineHeight: 1, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.5))', transform: 'rotate(-10deg)' }}>{deco.prop}</span>}
        {deco.badge && <span style={{ position: 'absolute', right: -1, bottom: -1, fontSize: Math.round(size * 0.36), lineHeight: 1, filter: 'drop-shadow(0 1px 1px rgba(0,0,0,.45))' }}>{deco.badge}</span>}
      </div>
    )
  }
  return (
    <div className={`rounded-full flex items-center justify-center text-white font-bold shrink-0 ${className}`}
      style={{ width: size, height: size, backgroundColor: color, fontSize: Math.max(10, Math.round(size * 0.38)), ...style }}>
      {initials}
    </div>
  )
}
