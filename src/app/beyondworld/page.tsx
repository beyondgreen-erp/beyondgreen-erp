'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import BeyondAvatar from '@/components/BeyondAvatar'

interface Profile { user_email: string; display_name: string | null; avatar_config: any; equipped: any; beyond_dollars: number; xp: number; level: number }
interface Item { id: string; name: string; category: string; slot: string; price: number; rarity: string; level_req: number; asset: any; sort: number }

const SKIN = ['ffdbb4', 'edb98a', 'fd9841', 'd08b5b', 'ae5d29', '614335']
const HAIR = ['short', 'buzz', 'long', 'bun', 'afro', 'bald']
const HAIRCOLOR = ['2c1b18', '4a312c', '724133', 'a55728', 'b58143', 'c93305', 'd6b370', 'e8e1e1']
const EYES = ['default', 'happy', 'wink']
const MOUTH = ['smile', 'grin', 'neutral']
const SHIRT = ['5199e4', '25557c', '929598', 'a7ffc4', 'ff488e', 'ff5c5c', 'ffffff', '262e33', 'f4c20d']
const PANTS = ['2f3b52', '16181d', '4b5320', '3b5bdb', '6b4a2b', '777777']

const RARITY: Record<string, string> = { Common: '#9CA3AF', Uncommon: '#22c55e', Rare: '#3b82f6', Epic: '#a855f7', Legendary: '#f59e0b' }
const SLOT_LABEL: Record<string, string> = { head: 'Helmet', body: 'Top', legs: 'Bottoms', feet: 'Footwear', hand_main: 'Right Hand', hand_off: 'Shield', face: 'Eyewear', vehicle: 'Vehicle' }

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

export default function BeyondWorldPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [me, setMe] = useState<Profile | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [owned, setOwned] = useState<Set<string>>(new Set())
  const [board, setBoard] = useState<Profile[]>([])
  const [tab, setTab] = useState<'avatar' | 'shop' | 'leaderboard'>('avatar')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [draft, setDraft] = useState<any>({})

  const itemsById = useMemo(() => Object.fromEntries(items.map(i => [i.id, i])), [items])

  const load = useCallback(async () => {
    const { data: prof } = await sb.rpc('bw_me')
    const p = (Array.isArray(prof) ? prof[0] : prof) as Profile
    setMe(p); setDraft({ ...(p?.avatar_config || {}) })
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
    const { error } = await sb.rpc('bw_save_avatar', { p_config: draft })
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
  const cats = Array.from(new Set(items.sort((a, b) => a.sort - b.sort).map(i => i.category)))
  const frame = '#0c0f24'

  const swatch = (val: string, cur: string, on: () => void) => (
    <button key={val} onClick={on} title={val} className="w-7 h-7 rounded-full border-2 shrink-0" style={{ background: `#${val}`, borderColor: cur === val ? '#22c55e' : 'rgba(255,255,255,0.25)' }} />
  )
  const optRow = (label: string, opts: string[], field: string, isColor = false) => (
    <div className="mb-3">
      <p className="text-xs font-semibold text-white/50 uppercase mb-1.5">{label}</p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {opts.map(o => isColor ? swatch(o, draft[field], () => setDraft({ ...draft, [field]: o }))
          : <button key={o} onClick={() => setDraft({ ...draft, [field]: o })} className={`px-2.5 py-1 rounded-lg text-xs whitespace-nowrap border capitalize ${draft[field] === o || (!draft[field] && field === 'hair' && o === 'short') ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10'}`}>{o}</button>)}
      </div>
    </div>
  )

  return (
    <div className="min-h-screen" style={{ background: 'radial-gradient(1200px 600px at 50% -10%, #20264f 0%, #0f1226 60%)' }}>
      <div className="max-w-5xl mx-auto px-6 py-8 text-white">
        <div className="flex items-center gap-2 mb-1"><span className="text-2xl">🎮</span><h1 className="text-3xl font-extrabold tracking-tight">beyond<span className="text-emerald-400">World</span></h1></div>
        <p className="text-white/50 text-sm mb-6">Do real work, earn beyondDollars, level up, and gear out your character.</p>

        {/* hero */}
        <div className="rounded-2xl p-5 mb-6 flex flex-col sm:flex-row items-center gap-5" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="w-28 h-40 rounded-2xl overflow-hidden ring-2 ring-emerald-400/40 shrink-0 flex items-end justify-center" style={{ background: frame }}>
            <BeyondAvatar config={me.avatar_config} equipped={equipped} itemsById={itemsById} className="w-full h-full" />
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

        {/* tabs */}
        <div className="flex gap-2 mb-5">
          {([['avatar', 'My Character'], ['shop', 'beyondShop'], ['leaderboard', 'Leaderboard']] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 rounded-xl text-sm font-semibold ${tab === k ? 'bg-emerald-500 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}>{lbl}</button>
          ))}
        </div>
        {msg && <div className="mb-4 text-sm px-3 py-2 rounded-lg bg-white/10 border border-white/10">{msg}</div>}

        {tab === 'avatar' && (
          <div className="grid md:grid-cols-2 gap-6">
            <div className="rounded-2xl p-5 flex flex-col items-center" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="w-52 h-72 rounded-2xl overflow-hidden flex items-end justify-center" style={{ background: frame }}>
                <BeyondAvatar config={draft} equipped={equipped} itemsById={itemsById} className="w-full h-full" />
              </div>
              <p className="text-white/40 text-xs mt-3">Live preview — gear from the beyondShop shows here too</p>
              <button onClick={saveAvatar} disabled={busy === 'save'} className="mt-4 px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-semibold disabled:opacity-50">{busy === 'save' ? 'Saving…' : 'Save Character'}</button>
            </div>
            <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              {optRow('Skin', SKIN, 'skinColor', true)}
              {optRow('Hair', HAIR, 'hair')}
              {optRow('Hair Color', HAIRCOLOR, 'hairColor', true)}
              {optRow('Eyes', EYES, 'eyes')}
              {optRow('Mouth', MOUTH, 'mouth')}
              {optRow('Default Shirt', SHIRT, 'shirtColor', true)}
              {optRow('Default Pants', PANTS, 'pantsColor', true)}
              <p className="text-white/40 text-xs mt-2">Designer outfits, armor, vehicles & more are in the beyondShop.</p>
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
                    return (
                      <div key={it.id} className="rounded-xl p-3 flex flex-col" style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${isEquipped ? '#22c55e' : 'rgba(255,255,255,0.08)'}` }}>
                        <div className="h-28 rounded-lg overflow-hidden mb-2 flex items-end justify-center" style={{ background: frame }}>
                          <BeyondAvatar config={me.avatar_config} equipped={{ [it.slot]: it.id }} itemsById={itemsById} className="h-full" />
                        </div>
                        <div className="flex items-center gap-1.5"><span className="text-sm font-semibold truncate">{it.name}</span></div>
                        <div className="flex items-center gap-2 mt-0.5 mb-2">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${RARITY[it.rarity]}22`, color: RARITY[it.rarity] }}>{it.rarity}</span>
                          <span className="text-[10px] text-white/40">{SLOT_LABEL[it.slot] || it.slot}</span>
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
                  <div className="w-10 h-14 rounded-lg overflow-hidden shrink-0 flex items-end justify-center" style={{ background: frame }}><BeyondAvatar config={p.avatar_config} equipped={p.equipped} itemsById={itemsById} className="h-full" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{p.display_name || p.user_email}</p>
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
