'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Profile { user_email: string; display_name: string | null; rpm_url: string | null; beyond_dollars: number; xp: number; level: number }

const RPM_SUBDOMAIN = 'demo' // swap for your own free Ready Player Me subdomain when ready
const RPM_FRAME = `https://${RPM_SUBDOMAIN}.readyplayer.me/avatar?frameApi&bodyType=fullbody&clearCache`
const MODEL_VIEWER_SRC = 'https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js'

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
const portrait = (glb?: string | null) => glb ? glb.replace(/\.glb.*$/, '.png') + '?scene=fullbody-portrait-v1&blendShapes[mouthSmile]=0.3' : ''

function ModelViewer({ src, style, poster }: { src: string; style?: any; poster?: string }) {
  return createElement('model-viewer', {
    src, poster, style, 'camera-controls': true, 'auto-rotate': true, 'shadow-intensity': '1',
    'camera-orbit': '0deg 90deg 4m', 'field-of-view': '30deg', exposure: '1.1',
    'disable-zoom': true, 'interaction-prompt': 'none', loading: 'eager',
  } as any)
}

export default function BeyondWorldPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [me, setMe] = useState<Profile | null>(null)
  const [board, setBoard] = useState<Profile[]>([])
  const [tab, setTab] = useState<'character' | 'leaderboard'>('character')
  const [creator, setCreator] = useState(false)
  const [mvReady, setMvReady] = useState(false)
  const [msg, setMsg] = useState('')
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  // load the <model-viewer> web component once
  useEffect(() => {
    if ((window as any).customElements?.get('model-viewer')) { setMvReady(true); return }
    const s = document.createElement('script'); s.type = 'module'; s.src = MODEL_VIEWER_SRC
    s.onload = () => setMvReady(true); document.head.appendChild(s)
  }, [])

  const load = useCallback(async () => {
    const { data: prof } = await sb.rpc('bw_me')
    const p = (Array.isArray(prof) ? prof[0] : prof) as Profile
    setMe(p)
    const { data: lb } = await sb.from('player_profiles').select('*').order('level', { ascending: false }).order('xp', { ascending: false }).limit(50)
    setBoard((lb as Profile[]) || [])
  }, [sb])
  useEffect(() => { load() }, [load])

  // Ready Player Me frame messaging
  useEffect(() => {
    if (!creator) return
    function parse(e: MessageEvent) { try { return typeof e.data === 'string' ? JSON.parse(e.data) : e.data } catch { return null } }
    async function onMsg(e: MessageEvent) {
      const j = parse(e)
      if (!j || j.source !== 'readyplayerme') return
      if (j.eventName === 'v1.frame.ready') {
        iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ target: 'readyplayerme', type: 'subscribe', eventName: 'v1.**' }), '*')
      }
      if (j.eventName === 'v1.avatar.exported') {
        const url = j.data?.url
        if (url) {
          const { error } = await sb.rpc('bw_save_rpm', { p_url: url })
          setCreator(false)
          if (error) setMsg(error.message); else { setMsg('Avatar saved!'); load() }
        }
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [creator, sb, load])

  if (!me) return <div className="min-h-screen p-8" style={{ background: '#0f1226' }}><p className="text-white/70">Loading beyondWorld…</p></div>

  const li = levelInfo(me.xp)
  const frame = 'radial-gradient(120% 120% at 50% 10%, #2a2f5c 0%, #0c0f24 70%)'
  const hasAvatar = !!me.rpm_url

  return (
    <div className="min-h-screen" style={{ background: 'radial-gradient(1200px 600px at 50% -10%, #20264f 0%, #0f1226 60%)' }}>
      <div className="max-w-5xl mx-auto px-6 py-8 text-white">
        <div className="flex items-center gap-2 mb-1"><span className="text-2xl">🎮</span><h1 className="text-3xl font-extrabold tracking-tight">beyond<span className="text-emerald-400">World</span></h1></div>
        <p className="text-white/50 text-sm mb-6">Do real work, earn beyondDollars, level up, and build your 3D character.</p>

        {/* hero */}
        <div className="rounded-2xl p-5 mb-6 flex flex-col sm:flex-row items-center gap-5" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="w-28 h-40 rounded-2xl overflow-hidden ring-2 ring-emerald-400/40 shrink-0 flex items-center justify-center" style={{ background: frame }}>
            {hasAvatar
              ? <img src={portrait(me.rpm_url)} alt="avatar" className="w-full h-full object-cover" />
              : <span className="text-4xl">🧑‍🚀</span>}
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
          <div className="rounded-2xl p-5 flex flex-col items-center" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="w-full max-w-sm h-[460px] rounded-2xl overflow-hidden" style={{ background: frame }}>
              {hasAvatar && mvReady
                ? <ModelViewer src={me.rpm_url as string} style={{ width: '100%', height: '100%' }} />
                : <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-center px-6">
                    <span className="text-5xl">🧑‍🚀</span>
                    <p className="text-white/60 text-sm">{hasAvatar ? 'Loading your 3D character…' : 'You don’t have a 3D character yet.'}</p>
                  </div>}
            </div>
            <button onClick={() => setCreator(true)} className="mt-5 px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-semibold">
              {hasAvatar ? 'Edit my 3D character' : 'Create my 3D character'}
            </button>
            <p className="text-white/40 text-xs mt-3">Pick your face, hair, outfit and style — it saves automatically.</p>
          </div>
        )}

        {tab === 'leaderboard' && (
          <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            {board.map((p, i) => {
              const pl = levelInfo(p.xp)
              return (
                <div key={p.user_email} className="flex items-center gap-3 px-4 py-3 border-b border-white/5 last:border-0">
                  <span className={`w-7 text-center font-extrabold ${i === 0 ? 'text-amber-300' : i === 1 ? 'text-gray-300' : i === 2 ? 'text-amber-600' : 'text-white/30'}`}>{i + 1}</span>
                  <div className="w-10 h-14 rounded-lg overflow-hidden shrink-0 flex items-center justify-center" style={{ background: frame }}>
                    {p.rpm_url ? <img src={portrait(p.rpm_url)} alt="" className="w-full h-full object-cover" /> : <span className="text-lg">🧑‍🚀</span>}
                  </div>
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

      {/* Ready Player Me creator modal */}
      {creator && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="relative w-full max-w-3xl h-[80vh] rounded-2xl overflow-hidden bg-[#0c0f24] border border-white/10">
            <button onClick={() => setCreator(false)} className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 text-white text-lg leading-none">×</button>
            <iframe ref={iframeRef} title="Ready Player Me" src={RPM_FRAME} allow="camera *; microphone *; clipboard-write" className="w-full h-full" style={{ border: 0 }} />
          </div>
        </div>
      )}
    </div>
  )
}
