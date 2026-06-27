'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Profile { user_email: string; display_name: string | null; avatar_config: any; equipped: any; beyond_dollars: number; xp: number; level: number }
interface Item { id: string; name: string; category: string; slot: string; price: number; rarity: string; level_req: number; asset: any; sort: number }

const DICEBEAR = 'https://api.dicebear.com/9.x/avataaars/svg'
const SKIN = ['ffdbb4','edb98a','fd9841','d08b5b','ae5d29','614335']
const TOP = ['shortFlat','shortWaved','shortCurly','shortRound','theCaesar','sides','dreads01','curly','bun','bob','longButNotTooLong','straight01','straight02','frizzle','shaggy','fro','bigHair','miaWallace']
const HAIRCOLOR = ['2c1b18','4a312c','724133','a55728','b58143','c93305','d6b370','e8e1e1','f59797']
const EYES = ['default','happy','wink','squint','surprised','hearts','side','closed','cry','xDizzy']
const EYEBROWS = ['default','defaultNatural','flatNatural','raisedExcited','angryNatural','sadConcerned','upDown']
const MOUTH = ['smile','default','twinkle','serious','tongue','disbelief','eating','grimace','sad']
const CLOTHES = ['shirtCrewNeck','shirtVNeck','shirtScoopNeck','collarAndSweater']
const CLOTHESCOLOR = ['262e33','5199e4','25557c','929598','a7ffc4','b1e2ff','e6e6e6','ff488e','ff5c5c','ffafb9','ffffb1','ffffff','65c9ff','3c4f5c']
const BGCOLOR = ['b6e3f4','c0aede','d1d4f9','ffd5dc','ffdfbf','transparent']
const RARITY: Record<string,string> = { Common:'#9CA3AF', Uncommon:'#22c55e', Rare:'#3b82f6', Epic:'#a855f7', Legendary:'#f59e0b' }
const SLOT_LABEL: Record<string,string> = { top:'Hat/Hair', accessories:'Glasses', clothing:'Outfit', facialHair:'Facial Hair', background:'Background', ride:'Ride', gear:'Gear' }

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
function avatarUrl(cfg: any, equipped: any, itemsById: Record<string, Item>, size = 0) {
  cfg = cfg || {}; equipped = equipped || {}
  const base: any = {
    skinColor: cfg.skinColor || 'edb98a', top: cfg.top || 'shortFlat', hairColor: cfg.hairColor || '4a312c',
    eyes: cfg.eyes || 'default', eyebrows: cfg.eyebrows || 'default', mouth: cfg.mouth || 'smile',
    clothing: cfg.clothing || 'shirtCrewNeck', clothesColor: cfg.clothesColor || '5199e4',
    backgroundColor: cfg.backgroundColor || 'b6e3f4', facialHair: cfg.facialHair || '',
  }
  let hatColor: string | null = null, accessories: string | null = null, facialHair = base.facialHair
  for (const slot of ['top','accessories','clothing','facialHair','background']) {
    const id = equipped?.[slot]; if (!id) continue; const it = itemsById[id]; if (!it) continue; const a = it.asset || {}
    if (a.kind === 'avatar') {
      if (a.param === 'top') { base.top = a.value; if (a.hatColor) hatColor = a.hatColor }
      else if (a.param === 'accessories') accessories = a.value
      else if (a.param === 'clothing') base.clothing = a.value
      else if (a.param === 'facialHair') facialHair = a.value
    } else if (a.kind === 'bg' && slot === 'background') base.backgroundColor = a.value
  }
  const p = new URLSearchParams()
  p.set('seed', cfg.seed || 'beyondGREEN')
  for (const k of ['skinColor','top','hairColor','eyes','eyebrows','mouth','clothing','clothesColor','backgroundColor']) p.set(k, base[k])
  if (hatColor) p.set('hatColor', hatColor)
  if (facialHair) { p.set('facialHair', facialHair); p.set('facialHairProbability','100') } else p.set('facialHairProbability','0')
  if (accessories) { p.set('accessories', accessories); p.set('accessoriesProbability','100') } else p.set('accessoriesProbability','0')
  if (size) p.set('size', String(size))
  return `${DICEBEAR}?${p.toString()}`
}
function badgesFor(equipped: any, itemsById: Record<string, Item>) {
  const out: string[] = []
  for (const slot of ['ride','gear']) { const id = equipped?.[slot]; if (!id) continue; const it = itemsById[id]; if (it?.asset?.emoji) out.push(it.asset.emoji) }
  return out
}

export default function BeyondWorldPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [me, setMe] = useState<Profile | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [owned, setOwned] = useState<Set<string>>(new Set())
  const [board, setBoard] = useState<Profile[]>([])
  const [tab, setTab] = useState<'avatar'|'shop'|'leaderboard'>('avatar')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [draft, setDraft] = useState<any>({})

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
  async function equip(slot: string, itemId: string | null) {
    setBusy('eq' + (itemId || slot)); setMsg('')
    const { error } = await sb.rpc('bw_equip', { p_slot: slot, p_item: itemId || '' })
    setBusy(''); if (error) setMsg(error.message); else load()
  }

  if (!me) return <div className="min-h-screen p-8" style={{ background: '#0f1226' }}><p className="text-white/70">Loading beyondWorld…</p></div>

  const li = levelInfo(me.xp)
  const equipped = me.equipped || {}
  const myUrl = avatarUrl(me.avatar_config, equipped, itemsById)
  const myBadges = badgesFor(equipped, itemsById)
  const previewUrl = avatarUrl(draft, equipped, itemsById)
  const cats = Array.from(new Set(items.map(i => i.category)))

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

  return (
    <div className="min-h-screen" style={{ background: 'radial-gradient(1200px 600px at 50% -10%, #20264f 0%, #0f1226 60%)' }}>
      <div className="max-w-5xl mx-auto px-6 py-8 text-white">
        {/* Header / hero */}
        <div className="flex items-center gap-2 mb-1"><span className="text-2xl">🎮</span><h1 className="text-3xl font-extrabold tracking-tight">beyond<span className="text-emerald-400">World</span></h1></div>
        <p className="text-white/50 text-sm mb-6">Do real work, earn beyondDollars, level up, and deck out your avatar.</p>

        <div className="rounded-2xl p-5 mb-6 flex flex-col sm:flex-row items-center gap-5" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="relative shrink-0">
            <div className="w-28 h-28 rounded-2xl overflow-hidden ring-2 ring-emerald-400/40" style={{ background: '#fff2' }}><img src={myUrl} alt="avatar" className="w-full h-full" /></div>
            {myBadges.length > 0 && <div className="absolute -bottom-2 -right-2 bg-[#11152e] rounded-full px-2 py-1 text-lg shadow-lg border border-white/10">{myBadges.join(' ')}</div>}
          </div>
          <div className="flex-1 w-full text-center sm:text-left">
            <div className="flex items-center gap-2 justify-center sm:justify-start">
              <span className="text-lg font-bold">{me.display_name || me.user_email}</span>
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

        {/* Tabs */}
        <div className="flex gap-2 mb-5">
          {([['avatar','My Avatar'],['shop','beyondShop'],['leaderboard','Leaderboard']] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 rounded-xl text-sm font-semibold ${tab === k ? 'bg-emerald-500 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}>{lbl}</button>
          ))}
        </div>
        {msg && <div className="mb-4 text-sm px-3 py-2 rounded-lg bg-white/10 border border-white/10">{msg}</div>}

        {tab === 'avatar' && (
          <div className="grid md:grid-cols-2 gap-6">
            <div className="rounded-2xl p-5 flex flex-col items-center justify-center" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="w-48 h-48 rounded-2xl overflow-hidden"><img src={previewUrl} alt="preview" className="w-full h-full" /></div>
              <p className="text-white/40 text-xs mt-3">Live preview — make it look like you</p>
              <button onClick={saveAvatar} disabled={busy === 'save'} className="mt-4 px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-semibold disabled:opacity-50">{busy === 'save' ? 'Saving…' : 'Save Avatar'}</button>
            </div>
            <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              {optRow('Skin', SKIN, 'skinColor', true)}
              {optRow('Hair Style', TOP, 'top')}
              {optRow('Hair Color', HAIRCOLOR, 'hairColor', true)}
              {optRow('Eyes', EYES, 'eyes')}
              {optRow('Eyebrows', EYEBROWS, 'eyebrows')}
              {optRow('Mouth', MOUTH, 'mouth')}
              {optRow('Outfit', CLOTHES, 'clothing')}
              {optRow('Outfit Color', CLOTHESCOLOR, 'clothesColor', true)}
              {optRow('Background', BGCOLOR, 'backgroundColor', true)}
              <p className="text-white/40 text-xs mt-2">Want hats, glasses, beards & more? Earn beyondDollars and shop the beyondShop.</p>
            </div>
          </div>
        )}

        {tab === 'shop' && (
          <div className="space-y-6">
            {cats.map(cat => (
              <div key={cat}>
                <h3 className="text-sm font-bold text-white/70 uppercase tracking-wide mb-2">{cat}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {items.filter(i => i.category === cat).map(it => {
                    const isOwned = owned.has(it.id)
                    const isEquipped = equipped[it.slot] === it.id
                    const tooLow = li.level < it.level_req
                    const canAfford = me.beyond_dollars >= it.price
                    const isBadge = it.asset?.kind === 'badge'
                    const preview = isBadge ? null : avatarUrl(me.avatar_config, { [it.slot]: it.id }, itemsById)
                    return (
                      <div key={it.id} className="rounded-xl p-3 flex flex-col" style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${isEquipped ? '#22c55e' : 'rgba(255,255,255,0.08)'}` }}>
                        <div className="h-20 flex items-center justify-center mb-2">
                          {isBadge ? <span className="text-5xl">{it.asset.emoji}</span> : <img src={preview!} alt={it.name} className="h-20 w-20 rounded-lg" />}
                        </div>
                        <div className="flex items-center gap-1.5"><span className="text-sm font-semibold truncate">{it.name}</span></div>
                        <div className="flex items-center gap-2 mt-0.5 mb-2">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${RARITY[it.rarity]}22`, color: RARITY[it.rarity] }}>{it.rarity}</span>
                          {it.level_req > 1 && <span className="text-[10px] text-white/40">Lvl {it.level_req}+</span>}
                        </div>
                        {!isOwned ? (
                          <button onClick={() => buy(it)} disabled={busy === it.id || tooLow || !canAfford}
                            className="mt-auto text-xs font-semibold py-1.5 rounded-lg bg-amber-400/90 hover:bg-amber-300 text-[#1a1300] disabled:opacity-40 disabled:cursor-not-allowed">
                            {tooLow ? `Reach Lvl ${it.level_req}` : busy === it.id ? '…' : `฿${it.price}`}
                          </button>
                        ) : (
                          <button onClick={() => equip(it.slot, isEquipped ? null : it.id)} disabled={busy === 'eq' + it.id}
                            className={`mt-auto text-xs font-semibold py-1.5 rounded-lg ${isEquipped ? 'bg-white/10 text-white/70' : 'bg-emerald-500 hover:bg-emerald-400 text-white'}`}>
                            {isEquipped ? 'Unequip' : 'Equip'}
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
              return (
                <div key={p.user_email} className="flex items-center gap-3 px-4 py-3 border-b border-white/5 last:border-0">
                  <span className={`w-7 text-center font-extrabold ${i === 0 ? 'text-amber-300' : i === 1 ? 'text-gray-300' : i === 2 ? 'text-amber-600' : 'text-white/30'}`}>{i + 1}</span>
                  <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0" style={{ background: '#fff2' }}><img src={avatarUrl(p.avatar_config, p.equipped, itemsById)} alt="" className="w-full h-full" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{p.display_name || p.user_email} {badgesFor(p.equipped, itemsById).join(' ')}</p>
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
    </div>
  )
}
