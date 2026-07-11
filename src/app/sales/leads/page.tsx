'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import nextDynamic from 'next/dynamic'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import type { LeadPoint, ScrapeArea } from '@/components/LeadsMap'

const LeadsMap = nextDynamic(() => import('@/components/LeadsMap'), { ssr: false })
const sb = createSupabaseBrowserClient()

interface Lead {
  id: string; company_name: string | null; email: string | null; phone: string | null; website: string | null
  city: string | null; state: string | null; customer_status: string | null; pipeline_stage: string | null
  is_scraped_lead: boolean | null; scraped_at: string | null; scrape_region: string | null; scrape_id: string | null
  contacted_at: string | null; latitude: number | null; longitude: number | null; industry: string | null
}
interface Scrape { id: string; prompt: string | null; zip: string | null; radius_miles: number | null; center_lat: number | null; center_lng: number | null; result_count: number | null; new_count: number | null; emails_found: number | null; created_at: string | null }
interface Region { area: string; state: string; score: number; regulationAngle: string; demographicAngle: string; suggestedZips?: string[] }
interface MarketResult { summary: string; regions: Region[]; cautions?: string }
interface NewLead { id: string; company_name: string | null; email: string | null; city: string | null; state: string | null }

const isContacted = (l: Lead) => !!l.contacted_at || (!!l.pipeline_stage && l.pipeline_stage !== 'Lead')

export default function LeadsPage() {
  const [tab, setTab] = useState<'leads' | 'scrape' | 'market'>('leads')
  const [leads, setLeads] = useState<Lead[]>([])
  const [scrapes, setScrapes] = useState<Scrape[]>([])
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState<Record<string, boolean>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [filter, setFilter] = useState<'all' | 'new' | 'contacted'>('all')
  const [visN, setVisN] = useState(200) // how many rows are shown (grows on scroll)
  const [userEmail, setUserEmail] = useState('')

  const [prompt, setPrompt] = useState('restaurants, fast food, cafes')
  const [zip, setZip] = useState('')
  const [radius, setRadius] = useState(25)
  const [scrapeBusy, setScrapeBusy] = useState(false)
  const [scrapeMsg, setScrapeMsg] = useState('')
  const [justAdded, setJustAdded] = useState<NewLead[]>([])

  const [product, setProduct] = useState('')
  const [marketBusy, setMarketBusy] = useState(false)
  const [market, setMarket] = useState<MarketResult | null>(null)
  const [marketErr, setMarketErr] = useState('')

  useEffect(() => { sb.auth.getUser().then(({ data }) => setUserEmail(data.user?.email || '')) }, [])

  const load = useCallback(async () => {
    setLoading(true)
    // Supabase caps a response at 1000 rows — page through so imported leads (not just scrapes) all load.
    const cols = 'id, company_name, email, phone, website, city, state, customer_status, pipeline_stage, is_scraped_lead, scraped_at, scrape_region, scrape_id, contacted_at, latitude, longitude, industry'
    const all: Lead[] = []
    const SIZE = 1000
    for (let from = 0; from < 100000; from += SIZE) {
      const { data, error } = await sb.from('customers').select(cols)
        .or('is_scraped_lead.eq.true,customer_status.eq.Lead')
        .order('scraped_at', { ascending: false, nullsFirst: false })
        .range(from, from + SIZE - 1)
      if (error || !data || !data.length) break
      all.push(...(data as Lead[]))
      if (data.length < SIZE) break
    }
    const { data: s } = await sb.from('lead_scrapes').select('*').order('created_at', { ascending: false }).limit(500)
    setLeads(all)
    setScrapes((s as Scrape[]) || [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  // Group leads by the scrape run they came from (newest first); leftovers → "Existing / manual".
  const groups = useMemo(() => {
    const byId: Record<string, Lead[]> = {}
    const manual: Lead[] = []
    const scrapeIds = new Set(scrapes.map(s => s.id))
    for (const l of leads) {
      if (l.scrape_id && scrapeIds.has(l.scrape_id)) (byId[l.scrape_id] ||= []).push(l)
      else manual.push(l)
    }
    const g: { key: string; scrape: Scrape | null; rows: Lead[] }[] = scrapes.filter(s => byId[s.id]?.length).map(s => ({ key: s.id, scrape: s as Scrape | null, rows: byId[s.id] }))
    if (manual.length) g.push({ key: 'manual', scrape: null, rows: manual })
    return g
  }, [leads, scrapes])

  const passFilter = (l: Lead) => filter === 'all' ? true : filter === 'contacted' ? isContacted(l) : !isContacted(l)
  const totalNew = leads.filter(l => !isContacted(l)).length

  // Flat list (no grouping). Source column shows the scrape date or "Manually added".
  const flat = useMemo(() => leads.filter(passFilter), [leads, filter]) // eslint-disable-line
  const flatView = flat.slice(0, visN)
  useEffect(() => { setVisN(200) }, [filter])
  const sourceLabel = (l: Lead) => l.scraped_at ? `Scraped · ${new Date(l.scraped_at).toLocaleDateString()}` : 'Manually added'
  const allFlatSelected = flatView.length > 0 && flatView.every(r => sel[r.id])
  const toggleAllFlat = (on: boolean) => setSel(s => { const n = { ...s }; flatView.forEach(r => n[r.id] = on); return n })

  async function runScrape() {
    if (!zip.trim()) { setScrapeMsg('Enter a ZIP code.'); return }
    setScrapeBusy(true); setScrapeMsg('Searching Google Places and extracting emails… up to a minute.'); setJustAdded([])
    try {
      const res = await fetch('/api/leads/scrape', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, zip: zip.trim(), radiusMiles: radius, createdBy: userEmail }) })
      const j = await res.json()
      setScrapeMsg(j.error ? `⚠️ ${j.error}` : `✅ ${j.message}`)
      if (!j.error) { setJustAdded(j.newLeads || []); if (j.scrapeId) setExpanded(e => ({ ...e, [j.scrapeId]: true })); await load() }
    } catch (e) { setScrapeMsg('⚠️ ' + (e as Error).message) }
    setScrapeBusy(false)
  }

  async function analyze() {
    if (!product.trim()) return
    setMarketBusy(true); setMarket(null); setMarketErr('')
    try {
      const res = await fetch('/api/leads/market-fit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product }) })
      const j = await res.json(); if (j.error) setMarketErr(j.error); else setMarket(j)
    } catch (e) { setMarketErr((e as Error).message) }
    setMarketBusy(false)
  }

  const selIds = () => Object.keys(sel).filter(k => sel[k])
  async function markContacted(val: boolean) {
    const ids = selIds(); if (!ids.length) return
    await sb.from('customers').update(val ? { contacted_at: new Date().toISOString(), pipeline_stage: 'Contacted' } : { contacted_at: null, pipeline_stage: 'Lead' }).in('id', ids)
    setSel({}); load()
  }
  async function convertSelected(status: string) { const ids = selIds(); if (!ids.length) return; await sb.from('customers').update({ customer_status: status }).in('id', ids); setSel({}); load() }
  async function deleteSelected() { const ids = selIds(); if (!ids.length || !confirm(`Delete ${ids.length} lead(s)?`)) return; await sb.from('customers').delete().in('id', ids); setSel({}); load() }
  async function deleteOne(id: string) { if (!confirm('Delete this lead?')) return; await sb.from('customers').delete().eq('id', id); load() }
  async function deleteGroup(rows: Lead[], key: string) {
    if (!rows.length || !confirm(`Delete all ${rows.length} leads in this group? This also removes the scrape from history/map.`)) return
    await sb.from('customers').delete().in('id', rows.map(r => r.id))
    if (key && key !== 'manual') await sb.from('lead_scrapes').delete().eq('id', key)
    setSel({}); load()
  }
  function toggleGroup(rows: Lead[], on: boolean) { setSel(s => { const n = { ...s }; rows.forEach(r => n[r.id] = on); return n }) }

  const selCount = selIds().length
  const withEmail = leads.filter(l => l.email).length
  const mapLeads: LeadPoint[] = leads.filter(l => l.latitude && l.longitude).map(l => ({ id: l.id, name: l.company_name, lat: l.latitude as number, lng: l.longitude as number, email: l.email, city: l.city, state: l.state }))
  const mapScrapes: ScrapeArea[] = scrapes.filter(s => s.center_lat && s.center_lng).map(s => ({ id: s.id, center_lat: s.center_lat as number, center_lng: s.center_lng as number, radius_miles: s.radius_miles || 25, prompt: s.prompt, created_at: s.created_at, new_count: s.new_count }))

  const tabBtn = (t: typeof tab, label: string) => <button onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-semibold rounded-lg ${tab === t ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>{label}</button>
  const fBtn = (f: typeof filter, label: string) => <button onClick={() => setFilter(f)} className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${filter === f ? 'bg-gray-800 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>{label}</button>

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <div>
          <span className="mon-tag t-purple">🎯 Leads</span>
          <h1 className="text-2xl font-bold mt-1.5">Leads</h1>
        </div>
        <Link href="/sales/campaign" className="mon-btn">Open Email Campaigns →</Link>
      </div>
      <p className="text-xs text-gray-400 mb-4">{leads.length} leads · {withEmail} with email · <b className="text-amber-600">{totalNew} not yet contacted</b>. Grouped by the scrape they came from.</p>

      <div className="flex gap-2 mb-5">{tabBtn('leads', 'Leads')}{tabBtn('scrape', 'Find Leads (Scrape)')}{tabBtn('market', 'Market Finder')}</div>

      {tab === 'leads' && (
        <>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="text-xs text-gray-500 mr-1">Show:</span>{fBtn('all', 'All')}{fBtn('new', 'Not contacted')}{fBtn('contacted', 'Contacted')}
            {selCount > 0 && (
              <div className="flex items-center gap-2 ml-auto text-xs">
                <span className="text-gray-500">{selCount} selected:</span>
                <button onClick={() => markContacted(true)} className="px-2.5 py-1.5 rounded border bg-blue-50 text-blue-700">Mark Contacted</button>
                <button onClick={() => markContacted(false)} className="px-2.5 py-1.5 rounded border bg-white">Mark Not Contacted</button>
                <button onClick={() => convertSelected('Prospect')} className="px-2.5 py-1.5 rounded border bg-white">Convert to Prospect</button>
                <Link href="/sales/campaign" className="px-2.5 py-1.5 rounded border bg-emerald-50 text-emerald-700">Add to Campaign →</Link>
                <button onClick={deleteSelected} className="px-2.5 py-1.5 rounded border bg-red-50 text-red-600">Delete</button>
              </div>
            )}
          </div>

          {loading ? <p className="text-gray-400">Loading…</p> : flat.length === 0 ? <p className="text-gray-400">No leads match this filter.</p> : (
            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <div className="max-h-[calc(100vh-260px)] overflow-auto" onScroll={e => { const el = e.currentTarget; if (el.scrollHeight - el.scrollTop - el.clientHeight < 500) setVisN(v => v < flat.length ? Math.min(v + 200, flat.length) : v) }}>
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50 z-10"><tr className="text-left text-gray-500 border-b">
                    <th className="p-2 w-8"><input type="checkbox" checked={allFlatSelected} onChange={e => toggleAllFlat(e.target.checked)} /></th>
                    <th className="p-2">Company</th><th className="p-2">Location</th><th className="p-2">Email</th><th className="p-2">Phone</th><th className="p-2">Industry</th><th className="p-2">Source</th><th className="p-2">Status</th><th className="p-2 w-10"></th>
                  </tr></thead>
                  <tbody>
                    {flatView.map(l => {
                      const contacted = isContacted(l)
                      return (
                        <tr key={l.id} className={`border-b border-gray-50 ${!contacted ? 'bg-amber-50/40' : ''}`}>
                          <td className="p-2"><input type="checkbox" checked={!!sel[l.id]} onChange={e => setSel(s => ({ ...s, [l.id]: e.target.checked }))} /></td>
                          <td className="p-2 font-medium">{l.company_name}{l.website && <a href={l.website} target="_blank" rel="noreferrer" className="text-blue-500 ml-1">↗</a>}</td>
                          <td className="p-2 text-gray-500">{[l.city, l.state].filter(Boolean).join(', ') || '—'}</td>
                          <td className="p-2">{l.email ? <a href={`mailto:${l.email}`} className="text-blue-600">{l.email}</a> : <span className="text-amber-500">none</span>}</td>
                          <td className="p-2 text-gray-500">{l.phone || '—'}</td>
                          <td className="p-2 text-gray-500">{l.industry || '—'}</td>
                          <td className="p-2 whitespace-nowrap">{l.scraped_at
                            ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">{sourceLabel(l)}</span>
                            : <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">Manually added</span>}</td>
                          <td className="p-2">{contacted
                            ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Contacted</span>
                            : <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">New</span>}</td>
                          <td className="p-2 text-right"><button onClick={() => deleteOne(l.id)} title="Delete lead" className="text-red-500 hover:text-red-700">🗑</button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 text-xs text-gray-500">
                <span>Showing {flatView.length.toLocaleString()} of {flat.length.toLocaleString()}</span>
                {flatView.length < flat.length && <button onClick={() => setVisN(v => Math.min(v + 1000, flat.length))} className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50">Load more</button>}
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'scrape' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4 grid md:grid-cols-4 gap-3 items-end">
            <div className="md:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">What to find (business types / keywords)</label>
              <input value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="restaurants, fast food, cafes, food trucks" className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div><label className="block text-xs text-gray-500 mb-1">ZIP code</label><input value={zip} onChange={e => setZip(e.target.value)} placeholder="92705" className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">Radius: <b>{radius} mi</b></label><input type="range" min={5} max={50} value={radius} onChange={e => setRadius(Number(e.target.value))} className="w-full" /></div>
            <div className="md:col-span-4">
              <button onClick={runScrape} disabled={scrapeBusy} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50">{scrapeBusy ? 'Scraping…' : '🔍 Find Leads'}</button>
              {scrapeMsg && <span className="ml-3 text-xs text-gray-600">{scrapeMsg}</span>}
            </div>
          </div>

          {justAdded.length > 0 && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-semibold text-emerald-800 mb-2">✅ Just added {justAdded.length} new leads</p>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
                {justAdded.map(n => (
                  <div key={n.id} className="flex justify-between gap-2 border-b border-emerald-100 py-0.5">
                    <span className="truncate">{n.company_name} <span className="text-gray-400">{[n.city, n.state].filter(Boolean).join(', ')}</span></span>
                    <span className={n.email ? 'text-emerald-700' : 'text-amber-500'}>{n.email || 'no email'}</span>
                  </div>
                ))}
              </div>
              <button onClick={() => setTab('leads')} className="mt-2 text-xs font-semibold text-indigo-600">View in Leads →</button>
            </div>
          )}

          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden" style={{ height: 420 }}><LeadsMap leads={mapLeads} scrapes={mapScrapes} /></div>
          <p className="text-xs text-gray-400">Indigo circles = already-scraped areas (don’t rework them). Green dots = leads with email; amber = no email.</p>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-sm font-semibold mb-2">Scrape history</p>
            {scrapes.length === 0 ? <p className="text-xs text-gray-400">No scrapes yet.</p> : (
              <div className="space-y-1 text-xs">
                {scrapes.map(s => (
                  <div key={s.id} className="flex items-center gap-3 py-1.5 border-b border-gray-100">
                    <span className="font-medium flex-1 truncate">{s.prompt}</span>
                    <span className="text-gray-500">ZIP {s.zip} · {s.radius_miles} mi</span>
                    <span className="text-gray-500">{s.new_count} new · {s.emails_found} emails</span>
                    <span className="text-gray-400">{s.created_at ? new Date(s.created_at).toLocaleDateString() : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'market' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <label className="block text-xs text-gray-500 mb-1">Which product do you want to sell? Where should we target?</label>
            <div className="flex gap-2">
              <input value={product} onChange={e => setProduct(e.target.value)} placeholder="e.g. compostable cutlery, PLA cold cups, kraft takeout bags" className="flex-1 border rounded-lg px-3 py-2 text-sm" />
              <button onClick={analyze} disabled={marketBusy} className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold disabled:opacity-50">{marketBusy ? 'Analyzing…' : '✨ Find Best Markets'}</button>
            </div>
            <p className="text-[11px] text-gray-400 mt-2">Weighs plastic/foam ban laws and demographic behavior. AI guidance from general knowledge — verify current statutes before large spend.</p>
          </div>
          {marketErr && <div className="text-xs bg-red-50 border-l-4 border-red-400 text-red-700 p-3">{marketErr}</div>}
          {market && (
            <>
              <div className="text-sm bg-violet-50 border-l-4 border-violet-400 p-3">{market.summary}</div>
              <div className="grid md:grid-cols-2 gap-3">
                {market.regions.map((r, i) => (
                  <div key={i} className="rounded-xl border border-gray-200 bg-white p-4">
                    <div className="flex items-center justify-between mb-1"><p className="font-semibold">{r.area}, {r.state}</p><span className="text-xs font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">{r.score}</span></div>
                    <p className="text-xs text-gray-600 mb-1"><b className="text-emerald-700">Regulation:</b> {r.regulationAngle}</p>
                    <p className="text-xs text-gray-600 mb-2"><b className="text-blue-700">Demographics:</b> {r.demographicAngle}</p>
                    {r.suggestedZips && r.suggestedZips.length > 0 && (
                      <div className="flex flex-wrap gap-1">{r.suggestedZips.map(z => <button key={z} onClick={() => { setZip(z); setTab('scrape') }} className="text-[11px] px-2 py-1 rounded bg-gray-100 hover:bg-indigo-100">Scrape {z} →</button>)}</div>
                    )}
                  </div>
                ))}
              </div>
              {market.cautions && <p className="text-[11px] text-gray-400">{market.cautions}</p>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
