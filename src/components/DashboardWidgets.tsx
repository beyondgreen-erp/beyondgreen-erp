'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import RemindersWidget from './RemindersWidget'
import MentionsWidget from './MentionsWidget'
import TeamPresenceStrip from './TeamPresenceStrip'
import RawMaterialsPanel from './RawMaterialsPanel'
import InventoryLinkGaps from './InventoryLinkGaps'

const sb = createSupabaseBrowserClient()

const OPEN_STATUSES = ['New', 'Confirmed', 'Awaiting BOM Components', 'Awaiting Production', 'Production Queue', 'In Production', 'QC', 'Ready to Ship', 'Partially Shipped', 'On Hold']
const fmt$ = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
const fmtD = (d?: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—')

/* ============================================================
   WIDGET CATALOG — the master list of everything you can add
   ============================================================ */
export type WidgetSize = 'sm' | 'md' | 'lg' | 'xl'
export interface Widget {
  id: string
  type: string
  size: WidgetSize
  position: number
  config: any
}
interface CatalogEntry {
  label: string
  icon: string
  defaultSize: WidgetSize
  category: string
  description: string
  configurable?: boolean
  render: (w: Widget, onCfg: (patch: any) => void) => JSX.Element
}

/* ============================================================
   SHARED HELPERS
   ============================================================ */
function useOnce<T>(fn: () => Promise<T>, deps: any[] = []): T | null {
  const [v, setV] = useState<T | null>(null)
  useEffect(() => { let a = true; fn().then(r => { if (a) setV(r) }); return () => { a = false } }, deps) // eslint-disable-line
  return v
}
function BigNumber({ value, sub, color, href }: { value: any; sub: string; color?: string; href?: string }) {
  const inner = (
    <div className="px-5 py-5 h-full flex flex-col justify-center">
      <p className={`text-3xl font-bold ${color || 'text-[#0F1C2E]'}`}>{value ?? '…'}</p>
      <p className="text-xs text-[#8A9FC0] mt-1 uppercase tracking-wide font-semibold">{sub}</p>
    </div>
  )
  return href ? <Link href={href} className="block h-full hover:bg-[#F8FAFF]">{inner}</Link> : inner
}
function EmptyState({ msg }: { msg: string }) {
  return <p className="text-center py-6 text-sm text-[#8A9FC0]">{msg}</p>
}

/* ============================================================
   PERSONAL WIDGETS
   ============================================================ */
function ClockWidget() {
  const [now, setNow] = useState(new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  return (
    <div className="px-5 py-5 h-full flex flex-col justify-center">
      <p className="text-3xl font-bold text-[#0F1C2E] font-mono">{now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}</p>
      <p className="text-sm text-[#5A6E8A] mt-1">{now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
    </div>
  )
}

function WeatherWidget({ w, onCfg }: { w: Widget; onCfg: (p: any) => void }) {
  const city = w.config?.city || 'Los Angeles'
  const [data, setData] = useState<any>(null)
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(city)
  useEffect(() => {
    let alive = true
    setErr(''); setData(null)
    ;(async () => {
      try {
        const g = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`).then(r => r.json())
        if (!g?.results?.[0]) throw new Error('City not found')
        const { latitude, longitude, name, admin1, country_code } = g.results[0]
        const wx = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=4`).then(r => r.json())
        if (alive) setData({ name, admin1, country_code, ...wx })
      } catch (e: any) { if (alive) setErr(e.message || 'Weather unavailable') }
    })()
    return () => { alive = false }
  }, [city])
  const codeIcon = (c: number) => c === 0 ? '☀️' : c < 3 ? '⛅' : c < 50 ? '☁️' : c < 70 ? '🌧️' : c < 80 ? '🌨️' : '⛈️'
  return (
    <div className="p-4 h-full">
      {editing ? (
        <div className="flex flex-col gap-2">
          <label className="text-xs text-gray-500">City</label>
          <input value={draft} onChange={e => setDraft(e.target.value)} className="border border-[#E4E6EE] rounded px-2 py-1.5 text-sm" placeholder="e.g. Los Angeles" />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setEditing(false)} className="text-xs px-3 py-1.5 rounded border border-[#E4E6EE]">Cancel</button>
            <button onClick={() => { onCfg({ city: draft }); setEditing(false) }} className="text-xs px-3 py-1.5 rounded bg-[#3B6FE0] text-white">Save</button>
          </div>
        </div>
      ) : err ? (
        <div className="text-xs text-red-500">{err} <button onClick={() => setEditing(true)} className="underline">Change city</button></div>
      ) : !data ? <p className="text-xs text-gray-400">Loading weather…</p> : (
        <>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-[#8A9FC0] uppercase tracking-wide">{data.name}{data.admin1 ? `, ${data.admin1}` : ''}</p>
              <p className="text-4xl font-bold text-[#0F1C2E] mt-1">{Math.round(data.current?.temperature_2m ?? 0)}°</p>
              <p className="text-xs text-[#5A6E8A] mt-1">Humidity {data.current?.relative_humidity_2m}% · Wind {Math.round(data.current?.wind_speed_10m ?? 0)} mph</p>
            </div>
            <div className="text-5xl">{codeIcon(data.current?.weather_code ?? 0)}</div>
          </div>
          {data.daily?.time?.length ? (
            <div className="grid grid-cols-4 gap-1 mt-3 pt-3 border-t border-[#EEF0F4]">
              {data.daily.time.slice(0, 4).map((t: string, i: number) => (
                <div key={t} className="text-center">
                  <p className="text-[10px] text-gray-400 uppercase">{i === 0 ? 'Today' : new Date(t + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' })}</p>
                  <p className="text-lg leading-none mt-0.5">{codeIcon(data.daily.weather_code[i])}</p>
                  <p className="text-[11px] font-semibold text-[#0F1C2E]">{Math.round(data.daily.temperature_2m_max[i])}°<span className="text-gray-400 font-normal">/{Math.round(data.daily.temperature_2m_min[i])}°</span></p>
                </div>
              ))}
            </div>
          ) : null}
          <button onClick={() => { setDraft(city); setEditing(true) }} className="text-[10px] text-[#3B6FE0] mt-2 hover:underline">Change city</button>
        </>
      )}
    </div>
  )
}

// Curated set of Google News queries relevant to beyondGREEN's business
// (plastic bans, compostable/biodegradable, sustainability legislation, EPR, etc.)
const DEFAULT_NEWS_TOPICS = [
  'single-use plastic ban',
  'styrofoam ban',
  'plastic bag ban',
  'compostable packaging',
  'biodegradable straws',
  'EPR extended producer responsibility',
  'sustainability legislation',
  'plastic pollution law',
  'sustainable packaging',
  'beyondGREEN biotech',
]

function NewsWidget({ w, onCfg }: { w: Widget; onCfg: (p: any) => void }) {
  // Reads from Supabase shared cache. A pg_cron job refreshes the cache
  // every 30 minutes (server-side), so the whole team sees the same headlines
  // and we spend at most ~10 external calls per half-hour team-wide.
  const filterTopics: string[] = (w.config?.topics && Array.isArray(w.config.topics)) ? w.config.topics : []
  const speed: number = Number(w.config?.speed || 60)
  const [items, setItems] = useState<{ title: string; link: string; source: string; pubDate: string; topic: string }[] | null>(null)
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState(false)
  const [tab, setTab] = useState<'filter' | 'admin'>('filter')
  const [allTopics, setAllTopics] = useState<{ topic: string; enabled: boolean }[]>([])
  const [draft, setDraft] = useState<string[]>(filterTopics)
  const [paused, setPaused] = useState(false)
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null)
  const [newTopic, setNewTopic] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    setErr('')
    const [{ data: topics }, { data: state }, { data: cache }] = await Promise.all([
      sb.from('news_ticker_topics').select('topic,enabled').order('topic'),
      sb.from('news_ticker_state').select('last_refreshed_at').eq('id', 1).maybeSingle(),
      sb.from('news_ticker_cache').select('topic,title,link,source,pub_date').order('pub_date', { ascending: false, nullsFirst: false }).limit(80),
    ])
    const allT = (topics || []).map((t: any) => ({ topic: t.topic, enabled: t.enabled }))
    setAllTopics(allT)
    setRefreshedAt(state?.last_refreshed_at || null)
    const enabledSet = new Set(allT.filter(t => t.enabled).map(t => t.topic))
    const filt = filterTopics.length ? new Set(filterTopics) : enabledSet
    const rows = (cache || []).filter((r: any) => filt.has(r.topic)).map((r: any) => ({
      title: String(r.title || '').replace(/&amp;/g, '&').replace(/&#39;/g, '’').replace(/&quot;/g, '"'),
      link: r.link,
      source: String(r.source || 'Google News').replace(/&amp;/g, '&'),
      pubDate: r.pub_date || '',
      topic: r.topic,
    }))
    setItems(rows.slice(0, 40))
  }, [JSON.stringify(filterTopics)]) // eslint-disable-line

  useEffect(() => { load() }, [load])

  const addTopic = async () => {
    const t = newTopic.trim(); if (!t) return
    setBusy('add')
    const { error } = await sb.from('news_ticker_topics').insert({ topic: t, enabled: true })
    setBusy('')
    if (error) { alert(error.message); return }
    setNewTopic(''); await load()
  }
  const toggleTopicEnabled = async (topic: string, enabled: boolean) => {
    setBusy('toggle')
    await sb.from('news_ticker_topics').update({ enabled }).eq('topic', topic)
    setBusy(''); await load()
  }
  const deleteTopic = async (topic: string) => {
    if (!confirm(`Remove "${topic}" from the shared ticker for the whole team?`)) return
    setBusy('del')
    // Also clean cached rows for this topic so it disappears immediately
    await sb.from('news_ticker_cache').delete().eq('topic', topic)
    await sb.from('news_ticker_topics').delete().eq('topic', topic)
    setBusy(''); await load()
  }
  const refreshNow = async () => {
    setBusy('refresh')
    const url = 'https://tdhqucirvetvjpfsmnfb.supabase.co/functions/v1/news-ticker-refresh?secret=change-me'
    const anon = (sb as any).supabaseKey || ''
    try {
      await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${anon}` }, body: '{}' })
    } catch { /* ignore */ }
    // Give server a beat, then reload
    setTimeout(async () => { await load(); setBusy('') }, 4000)
  }

  if (editing) {
    const toggle = (t: string) => setDraft(d => d.includes(t) ? d.filter(x => x !== t) : [...d, t])
    return (
      <div className="p-3 h-full flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 mb-2 border-b border-[#EEF0F4]">
          <button onClick={() => setTab('filter')} className={`text-xs px-2 py-1.5 font-semibold ${tab === 'filter' ? 'text-emerald-700 border-b-2 border-emerald-600' : 'text-gray-400'}`}>My filter</button>
          <button onClick={() => setTab('admin')} className={`text-xs px-2 py-1.5 font-semibold ${tab === 'admin' ? 'text-emerald-700 border-b-2 border-emerald-600' : 'text-gray-400'}`}>Manage topics (team)</button>
          <span className="ml-auto text-[10px] text-gray-400">Last refresh: {refreshedAt ? new Date(refreshedAt).toLocaleString() : '—'}</span>
        </div>

        {tab === 'filter' && (
          <>
            <p className="text-[10px] text-gray-500 mb-2">Filter which topics YOU see (leave empty = show all enabled).</p>
            <div className="flex-1 overflow-y-auto flex flex-wrap gap-1.5 mb-2">
              {allTopics.filter(t => t.enabled).map(t => (
                <button key={t.topic} onClick={() => toggle(t.topic)}
                  className={`text-[10px] rounded-full px-2 py-1 border ${draft.includes(t.topic) ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-500 border-[#E4E6EE] hover:border-emerald-400'}`}>
                  {t.topic}
                </button>
              ))}
              {allTopics.length === 0 && <p className="text-xs text-gray-400">No topics yet.</p>}
            </div>
            <div className="flex items-center justify-between">
              <button onClick={() => setDraft([])} className="text-[10px] text-gray-500 hover:text-[#3B6FE0]">Clear (show all)</button>
              <div className="flex gap-2">
                <button onClick={() => { setDraft(filterTopics); setEditing(false) }} className="text-xs px-3 py-1.5 rounded border border-[#E4E6EE]">Cancel</button>
                <button onClick={() => { onCfg({ topics: draft }); setEditing(false) }} className="text-xs px-3 py-1.5 rounded bg-[#3B6FE0] text-white">Save filter</button>
              </div>
            </div>
          </>
        )}

        {tab === 'admin' && (
          <>
            <p className="text-[10px] text-gray-500 mb-2">Add or remove topics for the entire team. Fresh headlines pull on the next 30-min refresh (or hit Refresh now).</p>
            <div className="flex gap-1 mb-2">
              <input value={newTopic} onChange={e => setNewTopic(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTopic()}
                placeholder='e.g. "California SB 54"' className="flex-1 border border-[#E4E6EE] rounded px-2 py-1 text-xs" />
              <button onClick={addTopic} disabled={!newTopic.trim() || busy === 'add'} className="text-xs px-3 py-1 rounded bg-emerald-600 text-white font-semibold disabled:opacity-50">+ Add</button>
            </div>
            <div className="flex-1 overflow-y-auto border border-[#EEF0F4] rounded">
              {allTopics.length === 0 ? <p className="text-xs text-gray-400 p-3 text-center">No topics.</p> : allTopics.map(t => (
                <div key={t.topic} className="flex items-center gap-2 px-2 py-1.5 border-b border-[#EEF0F4] last:border-0 text-xs">
                  <label className="flex items-center gap-1.5 cursor-pointer flex-1 min-w-0">
                    <input type="checkbox" checked={t.enabled} onChange={e => toggleTopicEnabled(t.topic, e.target.checked)} className="accent-emerald-600" />
                    <span className={`truncate ${t.enabled ? 'text-[#0F1C2E] font-medium' : 'text-gray-400 line-through'}`}>{t.topic}</span>
                  </label>
                  <button onClick={() => deleteTopic(t.topic)} className="text-red-400 hover:text-red-600 text-sm leading-none px-1" title="Delete topic">×</button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-2">
              <button onClick={refreshNow} disabled={busy === 'refresh'} className="text-xs px-3 py-1.5 rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
                {busy === 'refresh' ? 'Refreshing…' : '↻ Refresh now'}
              </button>
              <button onClick={() => setEditing(false)} className="text-xs px-3 py-1.5 rounded border border-[#E4E6EE]">Close</button>
            </div>
          </>
        )}
      </div>
    )
  }

  if (err) return <div className="p-3 text-xs text-red-500">{err}</div>
  if (!items) return <div className="p-3 text-xs text-gray-400">Loading ticker…</div>
  if (items.length === 0) return <div className="p-3 text-xs text-gray-400">No headlines yet.</div>

  // Duplicate the sequence so the marquee loops seamlessly
  const loop = [...items, ...items]

  return (
    <div className="h-12 flex items-center overflow-hidden relative bg-gradient-to-r from-emerald-50 via-white to-emerald-50"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes bg-ticker { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        .bg-ticker-track { animation: bg-ticker ${speed}s linear infinite; }
        .bg-ticker-track.paused { animation-play-state: paused; }
      ` }} />
      <div className="shrink-0 z-10 bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-r-md shadow flex items-center gap-1.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
        Sustainability News
      </div>
      <div className={`bg-ticker-track flex whitespace-nowrap ${paused ? 'paused' : ''}`} style={{ willChange: 'transform', minWidth: '200%' }}>
        {loop.map((it, i) => (
          <a key={i} href={it.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-4 py-2 hover:bg-white/70 border-r border-emerald-100">
            <span className="text-[10px] uppercase font-bold text-emerald-700 bg-emerald-100 rounded px-1.5 py-0.5">{it.topic}</span>
            <span className="text-xs font-medium text-[#0F1C2E]">{it.title}</span>
            <span className="text-[10px] text-gray-400">— {it.source}</span>
          </a>
        ))}
      </div>
      <button onClick={() => setEditing(true)} title="Edit ticker topics"
        className="absolute right-1 top-1 z-10 text-[10px] text-emerald-700 bg-white/80 border border-emerald-200 rounded px-1.5 py-0.5 hover:bg-white">
        ⚙
      </button>
    </div>
  )
}

function NotesWidget({ userEmail }: { userEmail: string }) {
  const [content, setContent] = useState('')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const timer = useRef<any>(null)
  useEffect(() => {
    if (!userEmail) return
    sb.from('dashboard_notes').select('content,updated_at').eq('user_email', userEmail).maybeSingle()
      .then(({ data }) => { setContent(data?.content || ''); setSavedAt(data?.updated_at || null) })
  }, [userEmail])
  const onChange = (v: string) => {
    setContent(v)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      await sb.from('dashboard_notes').upsert({ user_email: userEmail, content: v, updated_at: new Date().toISOString() }, { onConflict: 'user_email' })
      setSavedAt(new Date().toISOString())
    }, 500)
  }
  return (
    <div className="p-3 h-full flex flex-col">
      <textarea value={content} onChange={e => onChange(e.target.value)} placeholder="Jot anything… notes are private and auto-saved." className="flex-1 w-full border-0 focus:outline-none text-sm text-[#0F1C2E] resize-none min-h-[160px]" />
      <p className="text-[10px] text-gray-400 mt-1">{savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Auto-saves as you type'}</p>
    </div>
  )
}

function QuickLinksWidget({ w, onCfg }: { w: Widget; onCfg: (p: any) => void }) {
  const links: { label: string; url: string }[] = w.config?.links || [
    { label: 'Shopify Admin', url: 'https://admin.shopify.com' },
    { label: 'Monday', url: 'https://beyondgreenbiotech.monday.com' },
    { label: 'Outlook', url: 'https://outlook.office.com' },
  ]
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<{ label: string; url: string }[]>(links)
  return (
    <div className="p-3 h-full">
      {editing ? (
        <div className="space-y-2">
          {draft.map((l, i) => (
            <div key={i} className="flex gap-1">
              <input value={l.label} onChange={e => { const d = [...draft]; d[i] = { ...d[i], label: e.target.value }; setDraft(d) }} placeholder="Label" className="flex-1 border border-[#E4E6EE] rounded px-2 py-1 text-xs" />
              <input value={l.url} onChange={e => { const d = [...draft]; d[i] = { ...d[i], url: e.target.value }; setDraft(d) }} placeholder="https://…" className="flex-1 border border-[#E4E6EE] rounded px-2 py-1 text-xs" />
              <button onClick={() => setDraft(draft.filter((_, j) => j !== i))} className="text-red-400 text-xs px-1">×</button>
            </div>
          ))}
          <button onClick={() => setDraft([...draft, { label: '', url: '' }])} className="text-xs text-[#3B6FE0]">+ Add link</button>
          <div className="flex gap-1 justify-end">
            <button onClick={() => { setDraft(links); setEditing(false) }} className="text-xs px-2 py-1 rounded border border-[#E4E6EE]">Cancel</button>
            <button onClick={() => { onCfg({ links: draft.filter(l => l.label && l.url) }); setEditing(false) }} className="text-xs px-2 py-1 rounded bg-[#3B6FE0] text-white">Save</button>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          {links.map((l, i) => (
            <a key={i} href={l.url} target="_blank" rel="noreferrer" className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-[#F8FAFF] text-xs text-[#3B6FE0] font-medium">
              <span className="truncate">{l.label}</span>
              <span className="text-gray-300">↗</span>
            </a>
          ))}
          <button onClick={() => { setDraft(links); setEditing(true) }} className="text-[10px] text-gray-400 hover:text-[#3B6FE0] mt-1">Edit links</button>
        </div>
      )}
    </div>
  )
}

/* ============================================================
   KPI WIDGETS (single-number)
   ============================================================ */
function KpiOpenOrders() {
  const [n, setN] = useState<number | null>(null)
  useEffect(() => { sb.from('sales_orders').select('id', { count: 'exact', head: true }).eq('archived', false).in('status', OPEN_STATUSES).then(({ count }) => setN(count || 0)) }, [])
  return <BigNumber value={n} sub="Open Orders" color="text-indigo-600" href="/sales/orders" />
}
function KpiRevenueMTD() {
  // Sources from the Daily Ship Report (Amazon + Shopify + Faire + Chewy + B2B),
  // filtered to the current month in Pacific Time. Matches /sales/daily-ship-report.
  const [n, setN] = useState<number | null>(null)
  useEffect(() => {
    // Build "YYYY-MM-01" in America/Los_Angeles so we don't drift on Vercel's UTC clock.
    const pt = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }) // YYYY-MM-DD
    const monthStart = pt.substring(0, 7) + '-01'
    // Next month first day
    const y = Number(pt.substring(0, 4)), m = Number(pt.substring(5, 7))
    const ny = m === 12 ? y + 1 : y
    const nm = m === 12 ? 1 : m + 1
    const nextMonthStart = `${ny}-${String(nm).padStart(2, '0')}-01`
    sb.from('daily_ship_report').select('amazon,shopify,faire,chewy,b2b,ship_date').gte('ship_date', monthStart).lt('ship_date', nextMonthStart)
      .then(({ data }) => {
        const total = (data || []).reduce((s: number, r: any) =>
          s + (Number(r.amazon) || 0) + (Number(r.shopify) || 0) + (Number(r.faire) || 0) + (Number(r.chewy) || 0) + (Number(r.b2b) || 0), 0)
        setN(total)
      })
  }, [])
  return <BigNumber value={n == null ? null : fmt$(n)} sub="Revenue MTD (Ship Report)" color="text-emerald-600" href="/sales/daily-ship-report" />
}
function KpiShippingQueue() {
  const [n, setN] = useState<number | null>(null)
  useEffect(() => { sb.from('sales_orders').select('id', { count: 'exact', head: true }).eq('archived', false).eq('status', 'Ready to Ship').then(({ count }) => setN(count || 0)) }, [])
  return <BigNumber value={n} sub="Ready to Ship" color="text-orange-600" href="/production/shipping-queue" />
}
function KpiOverdueInvoices() {
  const [n, setN] = useState<number | null>(null)
  const [amt, setAmt] = useState(0)
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0]
    sb.from('invoices').select('total_amount,due_date,status').neq('status', 'paid').neq('status', 'Paid').neq('status', 'void')
      .then(({ data }) => {
        const od = (data || []).filter((i: any) => i.due_date && i.due_date < today)
        setN(od.length); setAmt(od.reduce((s: number, i: any) => s + (i.total_amount || 0), 0))
      })
  }, [])
  return <BigNumber value={n} sub={n && n > 0 ? `Overdue · ${fmt$(amt)}` : 'Overdue Invoices'} color={n && n > 0 ? 'text-red-600' : 'text-gray-600'} href="/sales/invoices" />
}
function KpiOpenTasks() {
  const [n, setN] = useState<number | null>(null)
  useEffect(() => { sb.from('tasks').select('id', { count: 'exact', head: true }).not('status', 'in', '("Done","Archived","Cancelled")').then(({ count }) => setN(count || 0)) }, [])
  return <BigNumber value={n} sub="Open Tasks" color="text-blue-600" href="/bizdev/tasks" />
}
function KpiCustomers() {
  const [n, setN] = useState<number | null>(null)
  useEffect(() => { sb.from('customers').select('id', { count: 'exact', head: true }).then(({ count }) => setN(count || 0)) }, [])
  return <BigNumber value={n} sub="Customers" color="text-purple-600" href="/sales/customers" />
}
function KpiPROpen() {
  const [n, setN] = useState<number | null>(null)
  useEffect(() => { sb.from('purchasing_requests').select('id', { count: 'exact', head: true }).not('status', 'in', '("Received","PO Canceled","PO Merged with Export Invoice")').then(({ count }) => setN(count || 0)) }, [])
  return <BigNumber value={n} sub="Open Purchasing Requests" color="text-amber-600" href="/purchasing/requests" />
}

/* ============================================================
   LIST / BOARD WIDGETS
   ============================================================ */
function TasksWidget() {
  const [rows, setRows] = useState<any[] | null>(null)
  useEffect(() => {
    sb.from('tasks').select('id,name,status,priority,due_date').not('status', 'in', '("Done","Archived")').order('due_date', { ascending: true }).limit(6)
      .then(({ data }) => setRows(data || []))
  }, [])
  const pc = (p: string) => ({ Critical: 'text-red-600', High: 'text-orange-500', Medium: 'text-yellow-600', Low: 'text-gray-400' } as any)[p] || 'text-gray-400'
  if (!rows) return <EmptyState msg="Loading…" />
  if (rows.length === 0) return <EmptyState msg="All caught up ✓" />
  return (
    <div>
      {rows.map(t => (
        <div key={t.id} className="flex items-center justify-between px-4 py-2.5 border-b border-[#EEF0F4] last:border-0">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[#0F1C2E] truncate">{t.name}</p>
            <p className="text-xs text-[#8A9FC0]">{t.due_date ? fmtD(t.due_date) : 'No due date'}</p>
          </div>
          <span className={`text-xs font-bold ml-2 ${pc(t.priority)}`}>{t.priority || ''}</span>
        </div>
      ))}
    </div>
  )
}

function RecentOrdersWidget() {
  const [rows, setRows] = useState<any[] | null>(null)
  useEffect(() => {
    sb.from('sales_orders').select('id,order_number,status,total_amount,customers(company_name),updated_at').eq('archived', false).order('updated_at', { ascending: false }).limit(5)
      .then(({ data }) => setRows(data || []))
  }, [])
  const chip = (s: string) => {
    const m: Record<string, string> = { Shipped: 'bg-teal-100 text-teal-700', 'Ready to Ship': 'bg-orange-100 text-orange-700', 'In Production': 'bg-blue-100 text-blue-700', QC: 'bg-purple-100 text-purple-700', New: 'bg-indigo-100 text-indigo-700', Confirmed: 'bg-indigo-100 text-indigo-700' }
    return (m[s] || 'bg-gray-100 text-gray-600') + ' text-xs px-2 py-0.5 rounded-full font-medium'
  }
  if (!rows) return <EmptyState msg="Loading…" />
  if (rows.length === 0) return <EmptyState msg="No orders yet" />
  return (
    <div>
      {rows.map((o: any) => (
        <Link key={o.id} href={`/sales/orders/${o.id}`} className="flex items-center justify-between px-4 py-2.5 border-b border-[#EEF0F4] last:border-0 hover:bg-[#F8FAFF]">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#0F1C2E]">{o.order_number || o.id.substring(0, 8)}</p>
            <p className="text-xs text-[#8A9FC0] truncate">{o.customers?.company_name || '—'}</p>
          </div>
          <div className="text-right ml-2">
            <span className={chip(o.status)}>{o.status}</span>
            <p className="text-xs text-[#8A9FC0] mt-1">{fmt$(o.total_amount || 0)}</p>
          </div>
        </Link>
      ))}
    </div>
  )
}

function PipelineWidget() {
  const stages = [
    { label: 'New', color: '#6366F1', href: '/sales/orders' },
    { label: 'In Production', color: '#F59E0B', href: '/sales/orders' },
    { label: 'QC', color: '#8B5CF6', href: '/production/quality-control' },
    { label: 'Ready to Ship', color: '#F97316', href: '/production/shipping-queue' },
    { label: 'Shipped', color: '#14B8A6', href: '/shipments' },
  ]
  const [counts, setCounts] = useState<Record<string, number>>({})
  useEffect(() => {
    (async () => {
      const c: Record<string, number> = {}
      for (const s of stages) { const { count } = await sb.from('sales_orders').select('id', { count: 'exact', head: true }).eq('archived', false).eq('status', s.label); c[s.label] = count || 0 }
      setCounts(c)
    })()
  }, []) // eslint-disable-line
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1
  return (
    <div className="p-4">
      <div className="flex h-3 rounded-full overflow-hidden mb-3 gap-0.5">
        {stages.map(s => <div key={s.label} style={{ width: `${((counts[s.label] || 0) / total) * 100}%`, background: s.color, minWidth: counts[s.label] ? 4 : 0 }} title={`${s.label}: ${counts[s.label] || 0}`} />)}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1.5">
        {stages.map(s => (
          <Link key={s.label} href={s.href} className="flex items-center gap-1.5 text-xs text-[#5A6E8A] hover:text-[#3B6FE0]">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
            {s.label} <span className="font-bold text-[#0F1C2E]">{counts[s.label] || 0}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

function OverdueInvoicesWidget() {
  const [rows, setRows] = useState<any[] | null>(null)
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0]
    sb.from('invoices').select('id,total_amount,due_date,status,customers(company_name)').neq('status', 'paid').neq('status', 'Paid').neq('status', 'void')
      .then(({ data }) => setRows((data || []).filter((i: any) => i.due_date && i.due_date < today).slice(0, 6)))
  }, [])
  if (!rows) return <EmptyState msg="Loading…" />
  if (rows.length === 0) return <EmptyState msg="No overdue invoices ✓" />
  return (
    <div className="p-3">
      {rows.map((inv: any) => (
        <div key={inv.id} className="flex justify-between text-xs py-1.5 border-b border-[#EEF0F4] last:border-0">
          <span className="text-red-600 truncate">{inv.customers?.company_name || '—'}</span>
          <span className="text-red-700 font-bold ml-2">{fmt$(inv.total_amount || 0)}</span>
        </div>
      ))}
    </div>
  )
}

function BirthdaysWidget() {
  const [rows, setRows] = useState<any[] | null>(null)
  useEffect(() => {
    sb.from('employees').select('id,name,birthday,department').not('birthday', 'is', null).eq('status', 'Active')
      .then(({ data }) => {
        const m = new Date().getMonth()
        const list = (data || [])
          .map((r: any) => ({ ...r, mo: r.birthday ? new Date(r.birthday + 'T00:00:00').getMonth() : -1, day: r.birthday ? new Date(r.birthday + 'T00:00:00').getDate() : 0 }))
          .filter((r: any) => r.mo === m)
          .sort((a: any, b: any) => a.day - b.day)
        setRows(list)
      })
  }, [])
  if (!rows) return <EmptyState msg="Loading…" />
  if (rows.length === 0) return <EmptyState msg="No birthdays this month" />
  return (
    <div>
      {rows.map((r: any) => (
        <div key={r.id} className="flex items-center justify-between px-4 py-2 border-b border-[#EEF0F4] last:border-0">
          <div>
            <p className="text-sm font-semibold text-[#0F1C2E]">🎂 {r.name}</p>
            <p className="text-xs text-[#8A9FC0]">{r.department || '—'}</p>
          </div>
          <p className="text-xs font-bold text-pink-600">{new Date(r.birthday + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
        </div>
      ))}
    </div>
  )
}

function TimeOffWidget() {
  const [rows, setRows] = useState<any[] | null>(null)
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0]
    sb.from('time_off_requests').select('id,employee_name,type,start_date,end_date,days,status').eq('status', 'Approved').gte('end_date', today).order('start_date', { ascending: true }).limit(8)
      .then(({ data }) => setRows(data || []))
  }, [])
  if (!rows) return <EmptyState msg="Loading…" />
  if (rows.length === 0) return <EmptyState msg="Nobody on leave right now ✓" />
  return (
    <div>
      {rows.map(r => (
        <div key={r.id} className="flex items-center justify-between px-4 py-2 border-b border-[#EEF0F4] last:border-0">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#0F1C2E] truncate">{r.employee_name}</p>
            <p className="text-xs text-[#8A9FC0]">{r.type || 'Time Off'} · {r.days || 1} day{(r.days || 1) === 1 ? '' : 's'}</p>
          </div>
          <p className="text-xs font-medium text-teal-600 ml-2 whitespace-nowrap">{fmtD(r.start_date)}{r.end_date !== r.start_date ? ' – ' + fmtD(r.end_date) : ''}</p>
        </div>
      ))}
    </div>
  )
}

function RecentDocumentsWidget() {
  const [rows, setRows] = useState<any[] | null>(null)
  useEffect(() => {
    sb.from('documents').select('id,title,category,owner,created_at').order('created_at', { ascending: false }).limit(6)
      .then(({ data }) => setRows(data || []))
  }, [])
  if (!rows) return <EmptyState msg="Loading…" />
  if (rows.length === 0) return <EmptyState msg="No documents yet" />
  return (
    <div>
      {rows.map(d => (
        <Link key={d.id} href="/bizdev/documents" className="flex items-center justify-between px-4 py-2.5 border-b border-[#EEF0F4] last:border-0 hover:bg-[#F8FAFF]">
          <div className="min-w-0 flex items-center gap-2">
            <span>📄</span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-[#0F1C2E] truncate">{d.title || 'Untitled'}</p>
              <p className="text-xs text-[#8A9FC0] truncate">{d.category || d.owner || 'Team'}</p>
            </div>
          </div>
          <p className="text-xs text-[#8A9FC0] whitespace-nowrap ml-2">{fmtD(d.created_at?.split('T')[0])}</p>
        </Link>
      ))}
    </div>
  )
}

/* ============================================================
   CATALOG (single source of truth)
   ============================================================ */
export const CATALOG: Record<string, CatalogEntry> = {
  clock: { label: 'Clock & Date', icon: '🕐', defaultSize: 'sm', category: 'Personal', description: 'Live clock with day/date.', render: () => <ClockWidget /> },
  weather: { label: 'Weather', icon: '☁️', defaultSize: 'sm', category: 'Personal', description: '4-day forecast for any city.', configurable: true, render: (w, o) => <WeatherWidget w={w} onCfg={o} /> },
  news: { label: 'Sustainability News Ticker', icon: '📰', defaultSize: 'xl', category: 'Personal', description: 'Scrolling ticker of headlines: plastic bans, sustainability legislation, EPR, compostables. Fully editable topics.', configurable: true, render: (w, o) => <NewsWidget w={w} onCfg={o} /> },
  notes: { label: 'My Notes', icon: '📝', defaultSize: 'md', category: 'Personal', description: 'Private scratchpad, auto-saved.', render: () => <NotesInline /> },
  quick_links: { label: 'Quick Links', icon: '🔗', defaultSize: 'sm', category: 'Personal', description: 'Bookmark tools & sites.', configurable: true, render: (w, o) => <QuickLinksWidget w={w} onCfg={o} /> },

  kpi_open_orders: { label: 'Open Orders', icon: '📦', defaultSize: 'sm', category: 'KPIs', description: 'Count of open sales orders.', render: () => <KpiOpenOrders /> },
  kpi_revenue_mtd: { label: 'Revenue MTD', icon: '💰', defaultSize: 'sm', category: 'KPIs', description: 'Shipped/closed order revenue this month.', render: () => <KpiRevenueMTD /> },
  kpi_shipping_queue: { label: 'Shipping Queue', icon: '🚚', defaultSize: 'sm', category: 'KPIs', description: 'Orders ready to ship.', render: () => <KpiShippingQueue /> },
  kpi_overdue_invoices: { label: 'Overdue Invoices', icon: '⚠️', defaultSize: 'sm', category: 'KPIs', description: 'Count & total of overdue invoices.', render: () => <KpiOverdueInvoices /> },
  kpi_open_tasks: { label: 'Open Tasks (count)', icon: '✅', defaultSize: 'sm', category: 'KPIs', description: 'Total unresolved tasks.', render: () => <KpiOpenTasks /> },
  kpi_customers: { label: 'Total Customers', icon: '👥', defaultSize: 'sm', category: 'KPIs', description: 'Customer count.', render: () => <KpiCustomers /> },
  kpi_pr_open: { label: 'Open Purchasing Reqs', icon: '🛒', defaultSize: 'sm', category: 'KPIs', description: 'Open purchasing requests.', render: () => <KpiPROpen /> },

  tasks: { label: 'Open Tasks (list)', icon: '✅', defaultSize: 'md', category: 'ERP Boards', description: 'Top 6 tasks by due date.', render: () => <TasksWidget /> },
  reminders: { label: 'Reminders', icon: '⏰', defaultSize: 'sm', category: 'ERP Boards', description: 'Your reminders.', render: () => <RemindersWidget /> },
  mentions: { label: '@ Mentions', icon: '💬', defaultSize: 'lg', category: 'ERP Boards', description: 'Where teammates tagged you.', render: () => <MentionsWidget /> },
  team_presence: { label: 'Team Presence', icon: '👥', defaultSize: 'xl', category: 'ERP Boards', description: 'Who is online now.', render: () => <TeamPresenceStrip /> },
  pipeline: { label: 'Order Pipeline', icon: '📊', defaultSize: 'md', category: 'ERP Boards', description: 'Sales order status bar.', render: () => <PipelineWidget /> },
  recent_orders: { label: 'Recent Sales Orders', icon: '📦', defaultSize: 'md', category: 'ERP Boards', description: '5 most recent orders.', render: () => <RecentOrdersWidget /> },
  overdue_invoices_list: { label: 'Overdue Invoices List', icon: '⚠️', defaultSize: 'sm', category: 'ERP Boards', description: 'Top overdue invoices.', render: () => <OverdueInvoicesWidget /> },
  raw_materials: { label: 'Raw Materials Status', icon: '🧪', defaultSize: 'xl', category: 'ERP Boards', description: 'Raw materials panel.', render: () => <RawMaterialsPanel /> },
  inventory_gaps: { label: 'Inventory Link Gaps', icon: '🔧', defaultSize: 'xl', category: 'ERP Boards', description: 'Products missing inventory links.', render: () => <InventoryLinkGaps /> },
  recent_documents: { label: 'Recent Documents', icon: '📄', defaultSize: 'md', category: 'ERP Boards', description: 'Latest uploaded documents.', render: () => <RecentDocumentsWidget /> },

  birthdays: { label: 'Birthdays This Month', icon: '🎂', defaultSize: 'md', category: 'HR', description: 'Team birthdays this month.', render: () => <BirthdaysWidget /> },
  time_off_upcoming: { label: 'Upcoming Time Off', icon: '🏖️', defaultSize: 'md', category: 'HR', description: 'Approved time off in progress or coming up.', render: () => <TimeOffWidget /> },
}

/* NotesInline requires user email — read it from context */
function NotesInline() {
  const [email, setEmail] = useState('')
  useEffect(() => { sb.auth.getUser().then(({ data }) => setEmail(data.user?.email || '')) }, [])
  if (!email) return <EmptyState msg="Loading…" />
  return <NotesWidget userEmail={email} />
}

/* ============================================================
   DEFAULT LAYOUT — a nice starter set of widgets
   ============================================================ */
const DEFAULT_LAYOUT: { type: string; size: WidgetSize; config?: any }[] = [
  { type: 'clock', size: 'sm' },
  { type: 'kpi_open_orders', size: 'sm' },
  { type: 'kpi_revenue_mtd', size: 'sm' },
  { type: 'kpi_overdue_invoices', size: 'sm' },
  { type: 'tasks', size: 'md' },
  { type: 'reminders', size: 'sm' },
  { type: 'weather', size: 'sm', config: { city: 'Los Angeles' } },
  { type: 'pipeline', size: 'md' },
  { type: 'recent_orders', size: 'md' },
  { type: 'mentions', size: 'xl' },
  { type: 'birthdays', size: 'md' },
  { type: 'time_off_upcoming', size: 'md' },
  { type: 'news', size: 'xl', config: {} },
  { type: 'notes', size: 'md' },
]

/* ============================================================
   TILE WRAPPER
   ============================================================ */
const SIZES: Record<WidgetSize, string> = {
  sm: 'col-span-12 sm:col-span-6 md:col-span-4 lg:col-span-3',
  md: 'col-span-12 sm:col-span-12 md:col-span-6 lg:col-span-6',
  lg: 'col-span-12 md:col-span-8 lg:col-span-9',
  xl: 'col-span-12',
}

function Tile(props: {
  w: Widget; editing: boolean; onRemove: () => void; onResize: (s: WidgetSize) => void; onMove: (dir: 'up' | 'down') => void; onCfg: (patch: any) => void
}) {
  const { w, editing, onRemove, onResize, onMove, onCfg } = props
  const entry = CATALOG[w.type]
  if (!entry) return null
  return (
    <div className={`${SIZES[w.size]} bg-white rounded-xl border ${editing ? 'border-[#3B6FE0]/40 ring-1 ring-[#3B6FE0]/10' : 'border-[#E2E8F0]'} overflow-hidden flex flex-col`}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#EEF0F4] bg-[#FAFBFD]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base leading-none">{entry.icon}</span>
          <h3 className="font-bold text-xs text-[#0F1C2E] truncate">{entry.label}</h3>
        </div>
        <div className="flex items-center gap-1">
          {editing ? (
            <>
              <button onClick={() => onMove('up')} title="Move up" className="text-gray-400 hover:text-[#3B6FE0] text-xs px-1">▲</button>
              <button onClick={() => onMove('down')} title="Move down" className="text-gray-400 hover:text-[#3B6FE0] text-xs px-1">▼</button>
              <select value={w.size} onChange={e => onResize(e.target.value as WidgetSize)} className="text-[10px] border border-[#E4E6EE] rounded px-1 py-0.5 bg-white">
                <option value="sm">S</option><option value="md">M</option><option value="lg">L</option><option value="xl">XL</option>
              </select>
              <button onClick={onRemove} title="Remove" className="text-red-400 hover:text-red-600 text-lg leading-none px-1">×</button>
            </>
          ) : null}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">{entry.render(w, onCfg)}</div>
    </div>
  )
}

/* ============================================================
   ADD WIDGET MODAL
   ============================================================ */
function AddModal({ onClose, onAdd, existing }: { onClose: () => void; onAdd: (type: string) => void; existing: Set<string> }) {
  const [q, setQ] = useState('')
  const cats = useMemo(() => {
    const m: Record<string, [string, CatalogEntry][]> = {}
    Object.entries(CATALOG).forEach(([k, v]) => {
      if (q && !(v.label + ' ' + v.description).toLowerCase().includes(q.toLowerCase())) return
      m[v.category] = m[v.category] || []
      m[v.category].push([k, v])
    })
    return m
  }, [q])
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: 'rgba(15,28,46,0.5)' }} onClick={onClose}>
      <div className="relative w-full max-w-3xl my-8 bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-[#E4E6EE] flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-[#0F1C2E]">Add a widget</h2>
            <p className="text-xs text-gray-500">Pick anything to add to your dashboard. Multiple copies allowed.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>
        <div className="px-6 py-3 border-b border-[#EEF0F4]">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search widgets…" className="w-full border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3B6FE0]/40" />
        </div>
        <div className="px-6 py-4 max-h-[65vh] overflow-y-auto space-y-5">
          {Object.entries(cats).map(([cat, list]) => (
            <div key={cat}>
              <p className="text-[11px] uppercase tracking-wide font-bold text-gray-400 mb-2">{cat}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {list.map(([k, v]) => (
                  <button key={k} onClick={() => onAdd(k)} className="flex items-start gap-3 text-left border border-[#E4E6EE] rounded-lg p-3 hover:border-[#3B6FE0] hover:bg-[#F8FAFF] transition">
                    <span className="text-2xl leading-none">{v.icon}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-[#0F1C2E] flex items-center gap-1.5">{v.label}{existing.has(k) && <span className="text-[9px] text-gray-400 font-normal">(added)</span>}</p>
                      <p className="text-xs text-gray-500 line-clamp-2">{v.description}</p>
                    </div>
                    <span className="text-[#3B6FE0] font-bold text-lg">+</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {Object.keys(cats).length === 0 && <p className="text-center text-sm text-gray-400 py-6">No widgets match “{q}”.</p>}
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   DASHBOARD SHELL — main export
   ============================================================ */
export default function DashboardShell() {
  const [userEmail, setUserEmail] = useState('')
  const [userName, setUserName] = useState('')
  const [greeting, setGreeting] = useState('')
  const [widgets, setWidgets] = useState<Widget[] | null>(null)
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    const h = new Date().getHours()
    setGreeting(h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening')
    sb.auth.getUser().then(async ({ data }) => {
      const email = data.user?.email || ''
      setUserEmail(email)
      if (email) {
        sb.from('user_profiles').select('full_name').eq('email', email).maybeSingle().then(({ data: p }) => setUserName(p?.full_name || email.split('@')[0]))
      }
    })
  }, [])

  const load = useCallback(async (email: string) => {
    const { data } = await sb.from('user_dashboard_widgets').select('*').eq('user_email', email).order('position', { ascending: true })
    if (!data || data.length === 0) {
      // Seed default layout
      const rows = DEFAULT_LAYOUT.map((d, i) => ({ user_email: email, widget_type: d.type, size: d.size, position: i, config: d.config || {} }))
      const { data: inserted } = await sb.from('user_dashboard_widgets').insert(rows).select('*')
      setWidgets((inserted || []).map((r: any) => ({ id: r.id, type: r.widget_type, size: r.size, position: r.position, config: r.config || {} })))
    } else {
      setWidgets(data.map((r: any) => ({ id: r.id, type: r.widget_type, size: r.size, position: r.position, config: r.config || {} })))
    }
  }, [])
  useEffect(() => { if (userEmail) load(userEmail) }, [userEmail, load])

  const patchWidget = async (id: string, patch: Partial<Widget>) => {
    setWidgets(ws => (ws || []).map(w => w.id === id ? { ...w, ...patch } : w))
    const dbPatch: any = { updated_at: new Date().toISOString() }
    if ('size' in patch) dbPatch.size = patch.size
    if ('position' in patch) dbPatch.position = patch.position
    if ('config' in patch) dbPatch.config = patch.config
    await sb.from('user_dashboard_widgets').update(dbPatch).eq('id', id)
  }
  const removeWidget = async (id: string) => {
    setWidgets(ws => (ws || []).filter(w => w.id !== id))
    await sb.from('user_dashboard_widgets').delete().eq('id', id)
  }
  const moveWidget = async (id: string, dir: 'up' | 'down') => {
    if (!widgets) return
    const idx = widgets.findIndex(w => w.id === id)
    const swap = dir === 'up' ? idx - 1 : idx + 1
    if (idx < 0 || swap < 0 || swap >= widgets.length) return
    const next = [...widgets]
    ;[next[idx], next[swap]] = [next[swap], next[idx]]
    const reindexed = next.map((w, i) => ({ ...w, position: i }))
    setWidgets(reindexed)
    await Promise.all(reindexed.map(w => sb.from('user_dashboard_widgets').update({ position: w.position, updated_at: new Date().toISOString() }).eq('id', w.id)))
  }
  const addWidget = async (type: string) => {
    if (!userEmail || !widgets) return
    const entry = CATALOG[type]
    const pos = widgets.length
    const { data: ins } = await sb.from('user_dashboard_widgets').insert({ user_email: userEmail, widget_type: type, size: entry.defaultSize, position: pos, config: {} }).select('*').single()
    if (ins) setWidgets([...widgets, { id: ins.id, type: ins.widget_type, size: ins.size, position: ins.position, config: ins.config || {} }])
    setAdding(false)
  }
  const resetDefaults = async () => {
    if (!userEmail) return
    if (!confirm('Reset your dashboard to the default widget layout?')) return
    await sb.from('user_dashboard_widgets').delete().eq('user_email', userEmail)
    setWidgets(null)
    load(userEmail)
  }

  const existing = useMemo(() => new Set((widgets || []).map(w => w.type)), [widgets])

  return (
    <div className="min-h-screen bg-[#F7F8FA] p-4 sm:p-6">
      <div className="mb-5 flex items-start sm:items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-sm text-[#8A9FC0]">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          <h1 className="text-2xl font-bold text-[#0F1C2E]">{greeting}{userName ? ', ' + userName : ''} 👋</h1>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <Link href="/sales/orders?new=1" className="px-3 py-2 bg-[#3B6FE0] text-white text-xs font-semibold rounded-lg hover:bg-[#2D5CC8]">+ New Order</Link>
          <Link href="/sales/quotations?new=1" className="px-3 py-2 bg-white border border-[#E2E8F0] text-[#0F1C2E] text-xs font-semibold rounded-lg hover:bg-[#F1F4F9]">+ New Quote</Link>
          <button onClick={() => setAdding(true)} className="px-3 py-2 bg-emerald-500 text-white text-xs font-semibold rounded-lg hover:bg-emerald-600">+ Add Widget</button>
          <button onClick={() => setEditing(v => !v)} className={`px-3 py-2 text-xs font-semibold rounded-lg border ${editing ? 'bg-[#3B6FE0] text-white border-[#3B6FE0]' : 'bg-white text-[#0F1C2E] border-[#E2E8F0] hover:bg-[#F1F4F9]'}`}>
            {editing ? 'Done Editing' : '✎ Customize'}
          </button>
          {editing && <button onClick={resetDefaults} className="px-3 py-2 bg-white border border-[#E2E8F0] text-gray-500 text-xs font-semibold rounded-lg hover:bg-[#F1F4F9]">Reset to default</button>}
        </div>
      </div>

      {widgets == null ? (
        <div className="grid grid-cols-12 gap-3">
          {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="col-span-12 sm:col-span-6 md:col-span-4 lg:col-span-3 h-32 bg-white rounded-xl border border-[#E2E8F0] animate-pulse" />)}
        </div>
      ) : widgets.length === 0 ? (
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-8 text-center">
          <p className="text-lg font-bold text-[#0F1C2E]">Your dashboard is empty</p>
          <p className="text-sm text-gray-500 mt-1">Click <b>+ Add Widget</b> to build your view — or reset to defaults.</p>
          <div className="flex gap-2 justify-center mt-4">
            <button onClick={() => setAdding(true)} className="px-4 py-2 bg-emerald-500 text-white text-sm font-semibold rounded-lg">+ Add Widget</button>
            <button onClick={resetDefaults} className="px-4 py-2 bg-white border border-[#E2E8F0] text-[#0F1C2E] text-sm font-semibold rounded-lg">Reset to default</button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-3">
          {widgets.map(w => (
            <Tile key={w.id} w={w} editing={editing}
              onRemove={() => removeWidget(w.id)}
              onResize={s => patchWidget(w.id, { size: s })}
              onMove={dir => moveWidget(w.id, dir)}
              onCfg={patch => patchWidget(w.id, { config: { ...w.config, ...patch } })}
            />
          ))}
        </div>
      )}

      {adding && <AddModal existing={existing} onClose={() => setAdding(false)} onAdd={addWidget} />}
    </div>
  )
}
