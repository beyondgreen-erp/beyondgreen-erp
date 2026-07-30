'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Profile { user_email: string; display_name: string | null; avatar_config: any; equipped: any; beyond_dollars: number; xp: number; level: number; last_daily?: string | null; daily_streak?: number }
interface Item { id: string; name: string; category: string; slot: string; price: number; rarity: string; level_req: number; asset: any; sort: number }

const DICEBEAR = '/api/avatar'
const BOX_COST = 120
const SKIN = ['ffdbb4','edb98a','fd9841','d08b5b','ae5d29','614335']
const TOP = ['shortFlat','shortWaved','shortCurly','shortRound','theCaesar','theCaesarAndSidePart','sides','shavedSides','dreads01','dreads02','curly','curvy','bun','bob','longButNotTooLong','straight01','straight02','straightAndStrand','frizzle','shaggy','shaggyMullet','fro','froBand','bigHair','miaWallace']
const HAIRCOLOR = ['2c1b18','4a312c','724133','a55728','b58143','c93305','d6b370','e8e1e1','f59797']
const EYES = ['default','happy','wink','squint','surprised','hearts','side','closed','cry','xDizzy']
const EYEBROWS = ['default','defaultNatural','flatNatural','raisedExcited','angryNatural','sadConcerned','upDown']
const MOUTH = ['smile','default','twinkle','serious','tongue','disbelief','eating','grimace','sad']
const CLOTHES = ['shirtCrewNeck','shirtVNeck','shirtScoopNeck','collarAndSweater','blazerAndShirt','blazerAndSweater','graphicShirt','hoodie','overall']
const CLOTHESCOLOR = ['262e33','5199e4','25557c','929598','a7ffc4','b1e2ff','e6e6e6','ff488e','ff5c5c','ffafb9','ffffb1','ffffff','65c9ff','3c4f5c']
const BGCOLOR = ['b6e3f4','c0aede','d1d4f9','ffd5dc','ffdfbf','transparent']
const FACIALHAIR = ['','beardLight','beardMedium','beardMajestic','moustacheFancy','moustacheMagnum']
const ACCESSORIES = ['','round','wayfarers','sunglasses','prescription01','prescription02','kurt','eyepatch']
const HATS = ['','hat','turban','hijab','winterHat02','winterHat03','winterHat04']
const GRAPHIC = ['','bat','bear','cumbia','deer','diamond','hola','pizza','resist','skull','skullOutline']
const RARITY: Record<string,string> = { Common:'#9CA3AF', Uncommon:'#22c55e', Rare:'#3b82f6', Epic:'#a855f7', Legendary:'#f59e0b' }

function levelInfo(xp: number) {
  let lvl = 1, need = 100, lo = 0
  while (lvl <= 300) { const hi = lo + need; if (xp < hi) return { level: lvl, intoLevel: xp - lo, span: need, pct: Math.max(0, Math.min(100, Math.round((xp - lo) / need * 100))) }; lo = hi; lvl++; need += 60 }
  return { level: lvl, intoLevel: 0, span: need, pct: 100 }
}
function tierTitle(level: number) {
  if (level >= 16) return 'Legend'; if (level >= 13) return 'Boss'; if (level >= 10) return 'Director'
  if (level >= 8) return 'Manager'; if (level >= 6) return 'Lead'; if (level >= 4) return 'Specialist'
  if (level >= 2) return 'Coordinator'; return 'Rookie'
}
// Your avatar is rendered PURELY from your config — what you build is exactly what shows.
// (Shop cosmetics you own are folded into this config when you wear them.)
function avatarUrl(cfg: any, _equipped?: any, _itemsById?: any, size = 0) {
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
  if (size) p.set('size', String(size))
  return `${DICEBEAR}?${p.toString()}`
}

// Fold a shop item's look onto an avatar config (character gear + multi-slot "Look" kits).
// Flair items (titles, name colors, frames, badges) don't change the character image.
function applyItem(cfg: any, item: any): any {
  if (!item) return cfg
  const a = item.asset || {}
  const out = { ...(cfg || {}) }
  if (a.kind === 'avatar') {
    if (a.param === 'clothing') { out.clothing = a.value; out.clothingGraphic = a.graphic || '' }
    else if (a.param === 'top') { out.top = a.value; if (a.hatColor) out.hatColor = a.hatColor }
    else if (a.param === 'accessories') { out.accessories = a.value }
    else if (a.param === 'facialHair') { out.facialHair = a.value }
  } else if (a.kind === 'bg') { out.backgroundColor = a.value; out.bgGradient = a.value2 || '' }
  else if (a.kind === 'kit' && a.cfg) { Object.assign(out, a.cfg) }
  return out
}
function equippedTitle(equipped: any, itemsById: Record<string, Item>) {
  const id = equipped?.title; if (!id) return null; const it = itemsById[id]
  if (!it || it.asset?.kind !== 'title') return null
  return { text: it.asset.text as string, color: it.asset.color as string }
}
function equippedNameStyle(equipped: any, itemsById: Record<string, Item>): React.CSSProperties | null {
  const id = equipped?.nameColor; if (!id) return null; const a = itemsById[id]?.asset
  if (!a) return null
  if (a.kind === 'nameColor') return { color: a.value }
  if (a.kind === 'nameGradient') return { background: `linear-gradient(90deg, ${a.from}, ${a.to})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent' }
  return null
}
function equippedFrame(equipped: any, itemsById: Record<string, Item>): string | null {
  const id = equipped?.frame; if (!id) return null; const it = itemsById[id]
  if (!it || it.asset?.kind !== 'frame') return null
  return it.asset.style as string
}
function equippedBadge(equipped: any, itemsById: Record<string, Item>): string | null {
  const id = equipped?.badge; if (!id) return null; const it = itemsById[id]
  if (!it || it.asset?.kind !== 'badge') return null
  return it.asset.emoji as string
}
function equippedProp(equipped: any, itemsById: Record<string, Item>): string | null {
  const id = equipped?.prop; if (!id) return null; const it = itemsById[id]
  if (!it || it.asset?.kind !== 'prop') return null
  return it.asset.emoji as string
}
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
function FramedAvatar({ url, frame, badge, prop, size }: { url: string; frame?: string | null; badge?: string | null; prop?: string | null; size: number }) {
  const f = frame ? FRAME_DECO[frame] : null
  const pad = f ? Math.max(2, Math.round(size * 0.06)) : 0
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      {f && <div className={f.anim || ''} style={{ position: 'absolute', inset: 0, borderRadius: '9999px', background: f.bg, boxShadow: f.glow }} />}
      <img src={url} alt="" style={{ position: 'absolute', inset: pad, width: size - 2 * pad, height: size - 2 * pad, borderRadius: '9999px', background: '#e6edf5', objectFit: 'cover' }} />
      {prop && <span style={{ position: 'absolute', left: -2, bottom: -2, fontSize: Math.round(size * 0.4), lineHeight: 1, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.5))', transform: 'rotate(-10deg)' }}>{prop}</span>}
      {badge && <span style={{ position: 'absolute', right: -1, bottom: -1, fontSize: Math.round(size * 0.36), lineHeight: 1, filter: 'drop-shadow(0 1px 1px rgba(0,0,0,.45))' }}>{badge}</span>}
    </div>
  )
}

export default function BeyondWorldPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [me, setMe] = useState<Profile | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [owned, setOwned] = useState<Set<string>>(new Set())
  const [board, setBoard] = useState<Profile[]>([])
  const [tab, setTab] = useState<'avatar'|'shop'|'leaderboard'>('shop')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [draft, setDraft] = useState<any>({})
  const [catTab, setCatTab] = useState<'looks'|'body'|'clothes'|'face'|'hair'|'accessories'>('looks')
  const [boxResult, setBoxResult] = useState<any>(null)

  const itemsById = useMemo(() => Object.fromEntries(items.map(i => [i.id, i])), [items])

  const load = useCallback(async () => {
    const { data: prof } = await sb.rpc('bw_me')
    const p = (Array.isArray(prof) ? prof[0] : prof) as Profile
    setMe(p); setDraft({ seed: p?.user_email, ...(p?.avatar_config || {}) })
    const [{ data: its }, { data: pis }, { data: lb }] = await Promise.all([
      sb.from('shop_items').select('*').eq('is_active', true).order('sort'),
      p ? sb.from('player_items').select('item_id').eq('user_email', p.user_email) : Promise.resolve({ data: [] as any }),
      sb.from('player_profiles').select('*').order('level', { ascending: false }).order('xp', { ascending: false }).limit(50),
    ])
    setItems((its as Item[]) || [])
    setOwned(new Set(((pis as any[]) || []).map(r => r.item_id)))
    setBoard((lb as Profile[]) || [])
  }, [sb])
  useEffect(() => { load() }, [load])

  async function saveAvatar() {
    setBusy('save'); setMsg('')
    const { seed, ...cfg } = draft
    const { error } = await sb.rpc('bw_save_avatar', { p_config: cfg })
    setBusy(''); if (error) setMsg(error.message); else { setMsg('Avatar saved!'); load() }
  }
  async function buy(it: Item) {
    setBusy(it.id); setMsg('')
    const { error } = await sb.rpc('bw_buy', { p_item: it.id })
    setBusy(''); if (error) setMsg(error.message.replace('P0001:', '').trim() || 'Could not buy'); else { setMsg(`Bought ${it.name}!`); load() }
  }
  // Buy a piece of character gear/look and immediately wear it (kept local so the builder draft isn't reset)
  async function buyGear(it: Item) {
    setBusy(it.id); setMsg('')
    const { error } = await sb.rpc('bw_buy', { p_item: it.id })
    setBusy('')
    if (error) { setMsg(error.message.replace('P0001:', '').trim() || 'Could not buy'); return }
    setOwned(prev => { const n = new Set(prev); n.add(it.id); return n })
    setMe(m => m ? { ...m, beyond_dollars: m.beyond_dollars - it.price } : m)
    setDraft((d: any) => applyItem(d, it))
    setMsg(`Unlocked ${it.name} — now wearing it! Hit Save Avatar to keep it.`)
  }
  async function equip(slot: string, itemId: string | null) {
    setBusy('eq' + (itemId || slot)); setMsg('')
    const { error } = await sb.rpc('bw_equip', { p_slot: slot, p_item: itemId || '' })
    setBusy(''); if (error) setMsg(error.message); else load()
  }
  async function claimDaily() {
    setBusy('daily'); setMsg('')
    const { data, error } = await sb.rpc('bw_daily_bonus')
    setBusy('')
    if (error) { setMsg(error.message.replace('P0001:', '').trim()); return }
    if (data?.ok) { setMsg(`Daily reward claimed: +฿${data.bonus}!  🔥 ${data.streak}-day streak`); load() }
    else setMsg(data?.msg || 'Already claimed today — come back tomorrow!')
  }
  async function openBox() {
    setBusy('box'); setMsg('')
    const { data, error } = await sb.rpc('bw_open_box', { p_cost: BOX_COST })
    setBusy('')
    if (error) { setMsg(error.message.replace('P0001:', '').trim() || 'Could not open box'); return }
    if (data?.ok) { setBoxResult(data.item); load() }
  }

  if (!me) return <div className="min-h-screen p-8" style={{ background: '#0f1226' }}><p className="text-white/70">Loading beyondWorld…</p></div>

  const li = levelInfo(me.xp)
  // Achievement gates for prestige items (must be earned, not just bought)
  const myRankByXp = board.filter(p => (p.xp || 0) > (me.xp || 0)).length + 1
  const reqLabel = (it: any) => {
    const a = it.asset || {}; const parts: string[] = []
    if (a.req_rank) parts.push(a.req_rank === 1 ? '👑 #1 only' : `🏅 Top ${a.req_rank}`)
    if (a.req_streak) parts.push(`🔥 ${a.req_streak}d streak`)
    return parts.join(' · ')
  }
  const reqUnmet = (it: any) => {
    const a = it.asset || {}
    if (a.req_streak && (me.daily_streak || 0) < a.req_streak) return true
    if (a.req_rank && myRankByXp > a.req_rank) return true
    return false
  }
  const equipped = me.equipped || {}
  const myUrl = avatarUrl(me.avatar_config, equipped, itemsById)
  const myTitle = equippedTitle(equipped, itemsById)
  const myNameStyle = equippedNameStyle(equipped, itemsById)
  const myFrame = equippedFrame(equipped, itemsById)
  const myBadge = equippedBadge(equipped, itemsById)
  const myProp = equippedProp(equipped, itemsById)
  const previewUrl = avatarUrl(draft, {}, itemsById) // base avatar so every customizer choice is visible; equipped shop cosmetics show on the hero above
  const cats = Array.from(new Set(items.map(i => i.category)))
  const today = new Date().toISOString().slice(0, 10)
  const claimedToday = me.last_daily === today
  const streak = me.daily_streak || 0
  const nextDaily = 40 + Math.min(streak + (claimedToday ? 0 : 1), 7) * 15

  const swatch = (val: string, cur: string, on: () => void) => (
    <button key={val} onClick={on} title={val} className="w-7 h-7 rounded-full border-2 shrink-0" style={{ background: val === 'transparent' ? 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 10px 10px' : `#${val}`, borderColor: cur === val ? '#22c55e' : 'rgba(255,255,255,0.25)' }} />
  )
  const optRow = (label: string, opts: string[], field: string, isColor = false) => (
    <div className="mb-3">
      <p className="text-xs font-semibold text-white/50 uppercase mb-1.5">{label}</p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {opts.map(o => isColor ? swatch(o, draft[field], () => setDraft({ ...draft, [field]: o }))
          : <button key={o} onClick={() => setDraft({ ...draft, [field]: o })} className={`px-2.5 py-1 rounded-lg text-xs whitespace-nowrap border ${draft[field] === o || (!draft[field] && o === '') ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10'}`}>{o || 'none'}</button>)}
      </div>
    </div>
  )
  const nameOf = (p: Profile) => (p.display_name || p.user_email.split('@')[0])

  return (
    <div className="min-h-screen" style={{ background: 'radial-gradient(1200px 600px at 50% -10%, #20264f 0%, #0f1226 60%)' }}>
      <div className="max-w-5xl mx-auto px-6 py-8 text-white">
        <style>{BW_KEYFRAMES}</style>
        {/* Header / hero */}
        <div className="flex items-center gap-2 mb-1"><span className="text-2xl">🎮</span><h1 className="text-3xl font-extrabold tracking-tight">beyond<span className="text-emerald-400">World</span></h1></div>
        <p className="text-white/50 text-sm mb-6">Do real work, earn beyondDollars, level up, and flex your avatar in front of the whole team.</p>

        <div className="rounded-2xl p-5 mb-4 flex flex-col sm:flex-row items-center gap-5" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="relative shrink-0">
            <FramedAvatar url={myUrl} frame={myFrame} badge={myBadge} prop={myProp} size={112} />
          </div>
          <div className="flex-1 w-full text-center sm:text-left">
            <div className="flex items-center gap-2 justify-center sm:justify-start flex-wrap">
              <span className="text-lg font-bold" style={myNameStyle || undefined}>{nameOf(me)}</span>
              {myTitle && <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: `${myTitle.color}22`, color: myTitle.color, border: `1px solid ${myTitle.color}55` }}>{myTitle.text}</span>}
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">Lvl {li.level} {tierTitle(li.level)}</span>
            </div>
            <div className="mt-2">
              <div className="flex justify-between text-xs text-white/50 mb-1"><span>XP {me.xp}</span><span>{li.intoLevel}/{li.span} to Lvl {li.level + 1}</span></div>
              <div className="h-2.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${li.pct}%`, background: 'linear-gradient(90deg,#22c55e,#34d399)' }} /></div>
            </div>
          </div>
          <div className="shrink-0 text-center bg-white/5 rounded-xl px-5 py-3 border border-white/10">
            <div className="text-2xl font-extrabold text-amber-300">฿{me.beyond_dollars.toLocaleString()}</div>
            <div className="text-[11px] text-white/50 uppercase tracking-wide">beyondDollars</div>
          </div>
        </div>

        {/* Daily reward banner */}
        <div className="rounded-2xl p-4 mb-6 flex items-center gap-4" style={{ background: claimedToday ? 'rgba(255,255,255,0.04)' : 'linear-gradient(90deg, rgba(245,158,11,0.18), rgba(34,197,94,0.12))', border: '1px solid rgba(255,255,255,0.1)' }}>
          <span className="text-3xl">{claimedToday ? '✅' : '🎁'}</span>
          <div className="flex-1">
            <p className="font-bold text-sm">{claimedToday ? `Daily reward claimed — 🔥 ${streak}-day streak` : 'Claim your daily reward'}</p>
            <p className="text-xs text-white/55">{claimedToday ? 'Come back tomorrow to keep the streak alive and earn even more.' : `+฿${nextDaily} today · longer streaks pay more (up to +฿145/day)`}</p>
          </div>
          <button onClick={claimDaily} disabled={busy === 'daily' || claimedToday}
            className="px-4 py-2 rounded-xl text-sm font-bold bg-amber-400 hover:bg-amber-300 text-[#1a1300] disabled:opacity-40 disabled:cursor-not-allowed">
            {claimedToday ? 'Claimed' : busy === 'daily' ? '…' : `Claim +฿${nextDaily}`}
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-5">
          {([['shop','beyondShop'],['avatar','My Avatar'],['leaderboard','Leaderboard']] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 rounded-xl text-sm font-semibold ${tab === k ? 'bg-emerald-500 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}>{lbl}</button>
          ))}
        </div>
        {msg && <div className="mb-4 text-sm px-3 py-2 rounded-lg bg-white/10 border border-white/10">{msg}</div>}

        {tab === 'avatar' && (() => {
          const CATS = [['looks','✨ Looks'],['clothes','Clothes'],['hair','Hair'],['face','Face'],['accessories','Accessories'],['body','Body']] as const
          const thumb = (field: string, value: string) => avatarUrl({ ...draft, [field]: value }, undefined, undefined, 120)
          const optGrid = (field: string, options: string[]) => (
            <div className="grid grid-cols-4 sm:grid-cols-5 gap-2.5 mb-1">
              {options.map(o => {
                const sel = (draft[field] || '') === o
                return (
                  <button key={field + (o || 'none')} onClick={() => setDraft({ ...draft, [field]: o })}
                    className="relative rounded-xl overflow-hidden aspect-square transition"
                    style={{ background: '#0e1330', border: `2px solid ${sel ? '#22c55e' : 'rgba(255,255,255,0.08)'}`, boxShadow: sel ? '0 0 0 3px rgba(34,197,94,0.25)' : 'none' }}>
                    <img src={thumb(field, o)} alt="" loading="lazy" className="w-full h-full object-cover" />
                    {!o && <span className="absolute bottom-1 inset-x-0 text-center text-[9px] text-white/60">none</span>}
                  </button>
                )
              })}
            </div>
          )
          const colorGrid = (field: string, options: string[]) => (
            <div className="flex flex-wrap gap-2 mb-1">
              {options.map(o => (
                <button key={field + o} onClick={() => setDraft({ ...draft, [field]: o, ...(field === 'backgroundColor' ? { bgGradient: '' } : {}) })} title={o}
                  className="w-8 h-8 rounded-full border-2 shrink-0"
                  style={{ background: o === 'transparent' ? 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 10px 10px' : `#${o}`, borderColor: (draft[field] || '') === o ? '#22c55e' : 'rgba(255,255,255,0.25)' }} />
              ))}
            </div>
          )
          const head = (t: string) => <p className="text-[11px] font-semibold text-white/45 uppercase tracking-wide mt-3 mb-2 first:mt-0">{t}</p>
          const gearOf = (cats: string[]) => items.filter(i => cats.includes(i.category))
          const gearSel = (it: any) => {
            const a = it.asset || {}
            if (a.kind === 'bg') return (draft.backgroundColor || '') === a.value
            if (a.kind === 'kit') return false
            if (a.param === 'clothing') return (draft.clothing || '') === a.value && (draft.clothingGraphic || '') === (a.graphic || '')
            return (draft[a.param] || '') === a.value
          }
          const gearGrid = (cats: string[]) => {
            const list = gearOf(cats)
            if (!list.length) return <p className="text-white/30 text-[11px] mb-1">More coming to the shop soon.</p>
            return (
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2.5 mb-1">
                {list.map(it => {
                  const isOwned = owned.has(it.id); const sel = gearSel(it); const tooLow = li.level < it.level_req; const canAfford = me.beyond_dollars >= it.price
                  return (
                    <button key={it.id} title={`${it.name}${isOwned ? '' : tooLow ? ` — reach Lvl ${it.level_req}` : ` — ฿${it.price}`}`}
                      onClick={() => isOwned ? setDraft((d: any) => applyItem(d, it)) : buyGear(it)}
                      disabled={busy === it.id || (!isOwned && (tooLow || !canAfford))}
                      className="relative rounded-xl overflow-hidden aspect-square transition disabled:opacity-45"
                      style={{ background: '#0e1330', border: `2px solid ${sel ? '#22c55e' : isOwned ? 'rgba(255,255,255,0.14)' : 'rgba(245,158,11,0.35)'}`, boxShadow: sel ? '0 0 0 3px rgba(34,197,94,0.25)' : 'none' }}>
                      <img src={avatarUrl(applyItem(draft, it))} alt="" loading="lazy" className="w-full h-full object-cover" />
                      <span className="absolute top-0.5 left-0.5 text-[8px] font-black px-1 rounded" style={{ background: `${RARITY[it.rarity]}`, color: '#0b0e1f' }}>{it.rarity[0]}</span>
                      {!isOwned && <span className="absolute bottom-0 inset-x-0 text-center text-[9px] font-bold py-0.5 bg-black/60" style={{ color: tooLow ? '#f87171' : '#fbbf24' }}>{tooLow ? `Lv ${it.level_req}` : `฿${it.price}`}</span>}
                      {isOwned && !sel && <span className="absolute bottom-0.5 right-1 text-[8px] text-emerald-300">✓</span>}
                    </button>
                  )
                })}
              </div>
            )
          }
          const looks = gearOf(['Looks'])
          return (
            <div className="grid md:grid-cols-2 gap-6">
              {/* Avatar preview */}
              <div className="rounded-2xl p-6 flex flex-col items-center justify-center" style={{ background: 'radial-gradient(360px 360px at 50% 15%, rgba(255,255,255,0.07), rgba(255,255,255,0.02))', border: '1px solid rgba(255,255,255,0.08)' }}>
                <FramedAvatar url={previewUrl} frame={myFrame} badge={myBadge} prop={myProp} size={264} />
                <button onClick={saveAvatar} disabled={busy === 'save'} className="mt-5 px-8 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-semibold disabled:opacity-50">{busy === 'save' ? 'Saving…' : 'Save Avatar'}</button>
                <p className="text-white/35 text-xs mt-2">This is exactly how you&apos;ll look everywhere. Green = selected · <span className="text-amber-300">฿</span> = buy &amp; wear.</p>
              </div>
              {/* Customizer panel */}
              <div className="rounded-2xl p-4 flex flex-col" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="flex gap-1 border-b border-white/10 mb-3 overflow-x-auto">
                  {CATS.map(([k, lbl]) => (
                    <button key={k} onClick={() => setCatTab(k)} className={`px-3 py-2 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition ${catTab === k ? 'text-white border-emerald-400' : 'text-white/50 border-transparent hover:text-white/80'}`}>{lbl}</button>
                  ))}
                </div>
                <div className="overflow-y-auto pr-1" style={{ maxHeight: 470 }}>
                  {catTab === 'looks' && (<>
                    {head('One-Tap Looks — a whole vibe in one click')}
                    {looks.length === 0
                      ? <p className="text-white/40 text-xs">Themed Looks are coming to the shop — earn beyondDollars and check back!</p>
                      : <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {looks.map(it => {
                          const isOwned = owned.has(it.id); const tooLow = li.level < it.level_req; const canAfford = me.beyond_dollars >= it.price
                          return (
                            <div key={it.id} className="rounded-xl overflow-hidden" style={{ background: '#0e1330', border: `1px solid ${isOwned ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.08)'}` }}>
                              <img src={avatarUrl(applyItem(draft, it))} alt={it.name} loading="lazy" className="w-full aspect-square object-cover" />
                              <div className="p-2">
                                <p className="text-xs font-semibold truncate">{it.name}</p>
                                <div className="flex items-center gap-1 mb-1.5 flex-wrap"><span className="text-[9px] font-bold px-1 rounded" style={{ background: `${RARITY[it.rarity]}22`, color: RARITY[it.rarity] }}>{it.rarity}</span>{it.level_req > 1 && <span className="text-[9px] text-white/40">Lv {it.level_req}+</span>}{reqLabel(it) && <span className="text-[9px] font-bold px-1 rounded bg-amber-400/15 text-amber-300">{reqLabel(it)}</span>}</div>
                                {isOwned
                                  ? <button onClick={() => setDraft((d: any) => applyItem(d, it))} className="w-full text-xs font-semibold py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white">Wear Look</button>
                                  : <button onClick={() => buyGear(it)} disabled={tooLow || !canAfford || busy === it.id || reqUnmet(it)} className="w-full text-xs font-semibold py-1.5 rounded-lg bg-amber-400/90 hover:bg-amber-300 text-[#1a1300] disabled:opacity-40">{tooLow ? `Reach Lv ${it.level_req}` : reqUnmet(it) ? 'Locked 🔒' : busy === it.id ? '…' : `฿${it.price}`}</button>}
                              </div>
                            </div>
                          )
                        })}
                      </div>}
                  </>)}
                  {catTab === 'clothes' && (<>{head('Outfit')}{optGrid('clothing', CLOTHES)}{head('Premium Outfits & Graphic Tees')}{gearGrid(['Outfits', 'Graphic Tees'])}{head('Outfit Color')}{colorGrid('clothesColor', CLOTHESCOLOR)}{head('Graphic')}{optGrid('clothingGraphic', GRAPHIC)}</>)}
                  {catTab === 'hair' && (<>{head('Hair Style')}{optGrid('top', TOP)}{head('Hair Color')}{colorGrid('hairColor', HAIRCOLOR)}{head('Facial Hair')}{optGrid('facialHair', FACIALHAIR)}{head('Premium Facial Hair')}{gearGrid(['Facial Hair'])}</>)}
                  {catTab === 'face' && (<>{head('Eyes')}{optGrid('eyes', EYES)}{head('Eyebrows')}{optGrid('eyebrows', EYEBROWS)}{head('Mouth')}{optGrid('mouth', MOUTH)}</>)}
                  {catTab === 'accessories' && (<>{head('Glasses')}{optGrid('accessories', ACCESSORIES)}{head('Premium Glasses')}{gearGrid(['Glasses'])}{head('Headwear')}{optGrid('top', HATS)}{head('Premium Headwear')}{gearGrid(['Hats'])}</>)}
                  {catTab === 'body' && (<>{head('Skin Tone')}{colorGrid('skinColor', SKIN)}{head('Background')}{colorGrid('backgroundColor', BGCOLOR)}{head('Premium Backgrounds')}{gearGrid(['Backgrounds'])}</>)}
                </div>
                <p className="text-white/35 text-[11px] mt-3">Titles, name colors, frames &amp; badges live in the beyondShop tab.</p>
              </div>
            </div>
          )
        })()}

        {tab === 'shop' && (
          <div className="space-y-6">
            {/* Mystery box */}
            <div className="rounded-2xl p-5 flex flex-col sm:flex-row items-center gap-4" style={{ background: 'linear-gradient(100deg, rgba(168,85,247,0.22), rgba(59,130,246,0.16))', border: '1px solid rgba(168,85,247,0.4)' }}>
              <span className="text-5xl">🎁</span>
              <div className="flex-1 text-center sm:text-left">
                <p className="font-extrabold text-lg">Mystery Box</p>
                <p className="text-xs text-white/60">Open for a random item you don&apos;t own yet — rarer items have a small chance to drop. Great way to score something you can&apos;t afford outright.</p>
              </div>
              <button onClick={openBox} disabled={busy === 'box' || me.beyond_dollars < BOX_COST}
                className="px-5 py-2.5 rounded-xl text-sm font-bold bg-purple-500 hover:bg-purple-400 text-white disabled:opacity-40 disabled:cursor-not-allowed">
                {busy === 'box' ? 'Opening…' : me.beyond_dollars < BOX_COST ? `Need ฿${BOX_COST}` : `Open Box — ฿${BOX_COST}`}
              </button>
            </div>

            {cats.map(cat => (
              <div key={cat}>
                <h3 className="text-sm font-bold text-white/70 uppercase tracking-wide mb-2">{cat}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {items.filter(i => i.category === cat).map(it => {
                    const isOwned = owned.has(it.id)
                    const isEquipped = equipped[it.slot] === it.id
                    const tooLow = li.level < it.level_req
                    const canAfford = me.beyond_dollars >= it.price
                    const a = it.asset || {}
                    let previewNode
                    if (a.kind === 'title') previewNode = <span className="text-sm font-bold px-2.5 py-1 rounded-full text-center" style={{ background: `${a.color}22`, color: a.color, border: `1px solid ${a.color}55` }}>{a.text}</span>
                    else if (a.kind === 'nameColor') previewNode = <span className="text-xl font-extrabold" style={{ color: a.value }}>{nameOf(me)}</span>
                    else if (a.kind === 'nameGradient') previewNode = <span className="text-xl font-extrabold" style={{ background: `linear-gradient(90deg, ${a.from}, ${a.to})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent' }}>{nameOf(me)}</span>
                    else if (a.kind === 'frame') previewNode = <FramedAvatar url={avatarUrl(me.avatar_config, equipped, itemsById)} frame={a.style} size={72} />
                    else if (a.kind === 'badge') previewNode = <FramedAvatar url={avatarUrl(me.avatar_config, equipped, itemsById)} badge={a.emoji} size={72} />
                    else if (a.kind === 'prop') previewNode = <FramedAvatar url={avatarUrl(me.avatar_config, equipped, itemsById)} prop={a.emoji} size={72} />
                    else previewNode = <img src={avatarUrl(applyItem(me.avatar_config, it))} alt={it.name} className="h-20 w-20 rounded-lg" />
                    return (
                      <div key={it.id} className="rounded-xl p-3 flex flex-col" style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${isEquipped ? '#22c55e' : 'rgba(255,255,255,0.08)'}` }}>
                        <div className="h-20 flex items-center justify-center mb-2">{previewNode}</div>
                        <div className="flex items-center gap-1.5"><span className="text-sm font-semibold truncate">{it.name}</span></div>
                        <div className="flex items-center gap-2 mt-0.5 mb-2 flex-wrap">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${RARITY[it.rarity]}22`, color: RARITY[it.rarity] }}>{it.rarity}</span>
                          {it.level_req > 1 && <span className="text-[10px] text-white/40">Lvl {it.level_req}+</span>}
                          {reqLabel(it) && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-300 border border-amber-400/30">{reqLabel(it)}</span>}
                        </div>
                        {!isOwned ? (
                          <button onClick={() => buy(it)} disabled={busy === it.id || tooLow || !canAfford || reqUnmet(it)}
                            className="mt-auto text-xs font-semibold py-1.5 rounded-lg bg-amber-400/90 hover:bg-amber-300 text-[#1a1300] disabled:opacity-40 disabled:cursor-not-allowed">
                            {tooLow ? `Reach Lvl ${it.level_req}` : reqUnmet(it) ? 'Locked 🔒' : busy === it.id ? '…' : `฿${it.price}`}
                          </button>
                        ) : ['title', 'nameColor', 'frame', 'badge', 'prop'].includes(it.slot) ? (
                          <button onClick={() => equip(it.slot, isEquipped ? null : it.id)} disabled={busy === 'eq' + it.id}
                            className={`mt-auto text-xs font-semibold py-1.5 rounded-lg ${isEquipped ? 'bg-white/10 text-white/70' : 'bg-emerald-500 hover:bg-emerald-400 text-white'}`}>
                            {isEquipped ? 'Unequip' : 'Equip'}
                          </button>
                        ) : (
                          <button onClick={() => { setDraft((d: any) => applyItem(d, it)); setCatTab(it.asset?.kind === 'kit' ? 'looks' : 'clothes'); setTab('avatar'); setMsg(`Added ${it.name} to your look — hit Save Avatar to keep it`) }}
                            className="mt-auto text-xs font-semibold py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white">
                            Wear it
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'leaderboard' && (
          <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            {board.map((p, i) => {
              const pl = levelInfo(p.xp)
              const t = equippedTitle(p.equipped, itemsById)
              const ns = equippedNameStyle(p.equipped, itemsById)
              const fr = equippedFrame(p.equipped, itemsById)
              const bd = equippedBadge(p.equipped, itemsById)
              const pr = equippedProp(p.equipped, itemsById)
              const isMe = p.user_email === me.user_email
              return (
                <div key={p.user_email} className="flex items-center gap-3 px-4 py-3 border-b border-white/5 last:border-0" style={isMe ? { background: 'rgba(34,197,94,0.08)' } : undefined}>
                  <span className={`w-7 text-center font-extrabold ${i === 0 ? 'text-amber-300' : i === 1 ? 'text-gray-300' : i === 2 ? 'text-amber-600' : 'text-white/30'}`}>{i + 1}</span>
                  <div className="shrink-0"><FramedAvatar url={avatarUrl(p.avatar_config, p.equipped, itemsById)} frame={fr} badge={bd} prop={pr} size={40} /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate flex items-center gap-1.5">
                      <span style={ns || undefined}>{nameOf(p)}</span>
                      {t && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: `${t.color}22`, color: t.color, border: `1px solid ${t.color}55` }}>{t.text}</span>}
                    </p>
                    <p className="text-xs text-white/40">Lvl {pl.level} {tierTitle(pl.level)} · {p.xp} XP</p>
                  </div>
                  <span className="text-amber-300 font-bold text-sm">฿{p.beyond_dollars.toLocaleString()}</span>
                </div>
              )
            })}
            {board.length === 0 && <p className="p-8 text-center text-white/40 text-sm">No players yet.</p>}
          </div>
        )}
      </div>

      {/* Mystery box result modal */}
      {boxResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(5,7,20,0.75)' }} >
          <div className="rounded-2xl p-6 max-w-xs w-full text-center" style={{ background: '#161a36', border: `2px solid ${RARITY[boxResult.rarity] || '#fff'}` }} onClick={e => e.stopPropagation()}>
            <p className="text-sm text-white/60 mb-1">🎉 You unboxed</p>
            <div className="h-24 flex items-center justify-center my-3">
              {boxResult.asset?.kind === 'title' ? <span className="text-base font-bold px-3 py-1.5 rounded-full" style={{ background: `${boxResult.asset.color}22`, color: boxResult.asset.color, border: `1px solid ${boxResult.asset.color}55` }}>{boxResult.asset.text}</span>
                : boxResult.asset?.kind === 'nameColor' ? <span className="text-2xl font-extrabold" style={{ color: boxResult.asset.value }}>{nameOf(me)}</span>
                : <img src={avatarUrl(applyItem(me.avatar_config, boxResult))} alt={boxResult.name} className="h-24 w-24 rounded-xl" />}
            </div>
            <p className="text-lg font-extrabold">{boxResult.name}</p>
            <span className="inline-block mt-1 text-xs font-bold px-2 py-0.5 rounded" style={{ background: `${RARITY[boxResult.rarity]}22`, color: RARITY[boxResult.rarity] }}>{boxResult.rarity}</span>
            <button onClick={() => setBoxResult(null)} className="mt-5 w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-semibold">Nice!</button>
          </div>
        </div>
      )}
    </div>
  )
}
