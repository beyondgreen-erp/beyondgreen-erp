'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createElement, useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Profile { user_email: string; display_name: string | null; avatar_config: any; beyond_dollars: number; xp: number; level: number }

const MODEL_VIEWER_SRC = 'https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js'

// Stable, free, CORS-enabled 3D character models (Google model-viewer + three.js demo assets)
const CHARACTERS = [
  { key: 'astro', name: 'Astronaut', emoji: '🧑‍🚀', url: 'https://modelviewer.dev/shared-assets/models/Astronaut.glb' },
  { key: 'robot', name: 'Robo', emoji: '🤖', url: 'https://threejs.org/examples/models/gltf/RobotExpressive/RobotExpressive.glb' },
  { key: 'soldier', name: 'Scout', emoji: '🪖', url: 'https://threejs.org/examples/models/gltf/Soldier.glb' },
  { key: 'xbot', name: 'Agent', emoji: '🥷', url: 'https://threejs.org/examples/models/gltf/Xbot.glb' },
  { key: 'fox', name: 'Fox', emoji: '🦊', url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Fox/glTF-Binary/Fox.glb' },
  { key: 'parrot', name: 'Parrot', emoji: '🦜', url: 'https://threejs.org/examples/models/gltf/Parrot.glb' },
]
const charByKey: Record<string, typeof CHARACTERS[number]> = Object.fromEntries(CHARACTERS.map(c => [c.key, c]))
const charUrl = (k?: string) => (charByKey[k || 'astro'] || CHARACTERS[0]).url
const charEmoji = (k?: string) => (charByKey[k || 'astro'] || CHARACTERS[0]).emoji

const TINTS: { key: string; name: string; bg: string; swatch: string }[] = [
  { key: 'aurora', name: 'Aurora', bg: 'radial-gradient(120% 120% at 50% 8%, #2a3f6c 0%, #0c0f24 72%)', swatch: '#3b6ea5' },
  { key: 'emerald', name: 'Emerald', bg: 'radial-gradient(120% 120% at 50% 8%, #1f5d49 0%, #07140f 72%)', swatch: '#22c55e' },
  { key: 'sunset', name: 'Sunset', bg: 'radial-gradient(120% 120% at 50% 8%, #6b2f4f 0%, #1a0c16 72%)', swatch: '#ff6b81' },
  { key: 'gold', name: 'Gold', bg: 'radial-gradient(120% 120% at 50% 8%, #6b5a1f 0%, #16120a 72%)', swatch: '#f4c20d' },
  { key: 'violet', name: 'Violet', bg: 'radial-gradient(120% 120% at 50% 8%, #432f6b 0%, #100c1f 72%)', swatch: '#a855f7' },
  { key: 'slate', name: 'Slate', bg: 'radial-gradient(120% 120% at 50% 8%, #33404f 0%, #0c1016 72%)', swatch: '#94a3b8' },
]
const tintBy = (k?: string) => (TINTS.find(t => t.key === k) || TINTS[0])

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

function Viewer({ url, style }: { url: string; style?: any }) {
  return createElement('model-viewer', {
    key: url, src: url, style, 'camera-controls': true, 'auto-rotate': true, autoplay: true,
    'shadow-intensity': '1', 'rotation-per-second': '24deg', 'interaction-prompt': 'none',
    'disable-zoom': true, exposure: '1.05', loading: 'eager', reveal: 'auto',
  } as any)
}

export default function BeyondWorldPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [me, setMe] = useState<Profile | null>(null)
  const [board, setBoard] = useState<Profile[]>([])
  const [tab, setTab] = useState<'character' | 'leaderboard'>('character')
  const [mvReady, setMvReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [draft, setDraft] = useState<{ model3d: string; tint: string }>({ model3d: 'astro', tint: 'aurora' })

  useEffect(() => {
    if ((window as any).customElements?.get('model-viewer')) { setMvReady(true); return }
    const s = document.createElement('script'); s.type = 'module'; s.src = MODEL_VIEWER_SRC
    s.onload = () => setMvReady(true); document.head.appendChild(s)
  }, [])

  const load = useCallback(async () => {
    const { data: prof } = await sb.rpc('bw_me')
    const p = (Array.isArray(prof) ? prof[0] : prof) as Profile
    setMe(p)
    const cfg = p?.avatar_config || {}
    setDraft({ model3d: cfg.model3d || 'astro', tint: cfg.tint || 'aurora' })
    const { data: lb } = await sb.from('player_profiles').select('*').order('level', { ascending: false }).order('xp', { ascending: false }).limit(50)
    setBoard((lb as Profile[]) || [])
  }, [sb])
  useEffect(() => { load() }, [load])

  async function save() {
    setBusy(true); setMsg('')
    const { error } = await sb.rpc('bw_save_avatar', { p_config: draft })
    setBusy(false); if (error) setMsg(error.message); else { setMsg('Character saved!'); load() }
  }

  if (!me) return <div className="min-h-screen p-8" style={{ background: '#0f1226' }}><p className="text-white/70">Loading beyondWorld…</p></div>

  const li = levelInfo(me.xp)
  const myCfg = me.avatar_config || {}
  const heroTint = tintBy(myCfg.tint).bg
  const draftTint = tintBy(draft.tint).bg

  return (
    <div className="min-h-screen" style={{ background: 'radial-gradient(1200px 600px at 50% -10%, #20264f 0%, #0f1226 60%)' }}>
      <div className="max-w-5xl mx-auto px-6 py-8 text-white">
        <div className="flex items-center gap-2 mb-1"><span className="text-2xl">🎮</span><h1 className="text-3xl font-extrabold tracking-tight">beyond<span className="text-emerald-400">World</span></h1></div>
        <p className="text-white/50 text-sm mb-6">Do real work, earn beyondDollars, level up, and pick your 3D character.</p>

        {/* hero */}
        <div className="rounded-2xl p-5 mb-6 flex flex-col sm:flex-row items-center gap-5" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="w-28 h-40 rounded-2xl overflow-hidden ring-2 ring-emerald-400/40 shrink-0" style={{ background: heroTint }}>
            {mvReady ? <Viewer url={charUrl(myCfg.model3d)} style={{ width: '100%', height: '100%' }} /> : <div className="w-full h-full flex items-center justify-center text-3xl">{charEmoji(myCfg.model3d)}</div>}
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
          {([['character', 'My Character'], ['leaderboard', 'Leaderboard']] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 rounded-xl text-sm font-semibold ${tab === k ? 'bg-emerald-500 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}>{lbl}</button>
          ))}
        </div>
        {msg && <div className="mb-4 text-sm px-3 py-2 rounded-lg bg-white/10 border border-white/10">{msg}</div>}

        {tab === 'character' && (
          <div className="grid md:grid-cols-2 gap-6">
            <div className="rounded-2xl p-5 flex flex-col items-center" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="w-full max-w-sm h-[440px] rounded-2xl overflow-hidden" style={{ background: draftTint }}>
                {mvReady
                  ? <Viewer url={charUrl(draft.model3d)} style={{ width: '100%', height: '100%' }} />
                  : <div className="w-full h-full flex items-center justify-center text-6xl">{charEmoji(draft.model3d)}</div>}
              </div>
              <button onClick={save} disabled={busy} className="mt-4 px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-semibold disabled:opacity-50">{busy ? 'Saving…' : 'Save Character'}</button>
              <p className="text-white/40 text-xs mt-3">Drag to spin your character around.</p>
            </div>
            <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <p className="text-xs font-semibold text-white/50 uppercase mb-2">Character</p>
              <div className="grid grid-cols-3 gap-2 mb-5">
                {CHARACTERS.map(c => (
                  <button key={c.key} onClick={() => setDraft(d => ({ ...d, model3d: c.key }))}
                    className={`flex flex-col items-center gap-1 py-3 rounded-xl border ${draft.model3d === c.key ? 'bg-emerald-500/20 border-emerald-500' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}>
                    <span className="text-2xl">{c.emoji}</span>
                    <span className="text-xs">{c.name}</span>
                  </button>
                ))}
              </div>
              <p className="text-xs font-semibold text-white/50 uppercase mb-2">Scene Color</p>
              <div className="flex gap-2 flex-wrap">
                {TINTS.map(t => (
                  <button key={t.key} onClick={() => setDraft(d => ({ ...d, tint: t.key }))} title={t.name}
                    className="w-9 h-9 rounded-full border-2 shrink-0" style={{ background: t.swatch, borderColor: draft.tint === t.key ? '#fff' : 'rgba(255,255,255,0.25)' }} />
                ))}
              </div>
              <p className="text-white/40 text-xs mt-4">More characters and outfits coming soon — these load as real 3D models you can spin.</p>
            </div>
          </div>
        )}

        {tab === 'leaderboard' && (
          <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            {board.map((p, i) => {
              const pl = levelInfo(p.xp)
              const cfg = p.avatar_config || {}
              return (
                <div key={p.user_email} className="flex items-center gap-3 px-4 py-3 border-b border-white/5 last:border-0">
                  <span className={`w-7 text-center font-extrabold ${i === 0 ? 'text-amber-300' : i === 1 ? 'text-gray-300' : i === 2 ? 'text-amber-600' : 'text-white/30'}`}>{i + 1}</span>
                  <div className="w-10 h-12 rounded-lg overflow-hidden shrink-0 flex items-center justify-center text-xl" style={{ background: tintBy(cfg.tint).bg }}>{charEmoji(cfg.model3d)}</div>
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
