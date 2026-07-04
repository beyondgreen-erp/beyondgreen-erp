'use client'
import { useEffect, useState, useCallback } from 'react'
import nextDynamic from 'next/dynamic'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import type { LeadPoint, ScrapeArea } from '@/components/LeadsMap'

const LeadsMap = nextDynamic(() => import('@/components/LeadsMap'), { ssr: false })
const sb = createSupabaseBrowserClient()

interface Lead {
  id: string; company_name: string | null; email: string | null; phone: string | null; website: string | null
  city: string | null; state: string | null; customer_status: string | null; lead_source: string | null
  is_scraped_lead: boolean | null; scraped_at: string | null; scrape_region: string | null
  latitude: number | null; longitude: number | null; industry: string | null
}
interface Scrape { id: string; prompt: string | null; zip: string | null; radius_miles: number | null; center_lat: number | null; center_lng: number | null; result_count: number | null; new_count: number | null; emails_found: number | null; created_at: string | null }
interface Region { area: string; state: string; score: number; regulationAngle: string; demographicAngle: string; suggestedZips?: string[] }
interface MarketResult { summary: string; regions: Region[]; cautions?: string }

export default function LeadsPage() {
  const [tab, setTab] = useState<'leads' | 'scrape' | 'market'>('leads')
  const [leads, setLeads] = useState<Lead[]>([])
  const [scrapes, setScrapes] = useState<Scrape[]>([])
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState<Record<string, boolean>>({})
  const [userEmail, setUserEmail] = useState('')

  const [prompt, setPrompt] = useState('restaurants, fast food, cafes')
  const [zip, setZip] = useState('')
  const [radius, setRadius] = useState(25)
  const [scrapeBusy, setScrapeBusy] = useState(false)
  const [scrapeMsg, setScrapeMsg] = useState('')

  const [product, setProduct] = useState('')
  const [marketBusy, setMarketBusy] = useState(false)
  const [market, setMarket] = useState<MarketResult | null>(null)
  const [marketErr, setMarketErr] = useState('')

  useEffect(() => { sb.auth.getUser().then(({ data }) => setUserEmail(data.user?.email || '')) }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: l }, { data: s }] = await Promise.all([
      sb.from('customers').select('id, company_name, email, phone, website, city, state, customer_status, lead_source, is_scraped_lead, scraped_at, scrape_region, latitude, longitude, industry')
        .or('is_scraped_lead.eq.true,customer_status.eq.Lead').order('scraped_at', { ascending: false, nullsFirst: false }).limit(2000),
      sb.from('lead_scrapes').select('*').order('created_at', { ascending: false }).limit(500),
    ])
    setLeads((l as Lead[]) || [])
    setScrapes((s as Scrape[]) || [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  async function runScrape() {
    if (!zip.trim()) { setScrapeMsg('Enter a ZIP code.'); return }
    setScrapeBusy(true); setScrapeMsg('Searching Google Places and extracting emails… this can take up to a minute.')
    try {
      const res = await fetch('/api/leads/scrape', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, zip: zip.trim(), radiusMiles: radius, createdBy: userEmail }) })
      const j = await res.json()
      setScrapeMsg(j.error ? `⚠️ ${j.error}` : `✅ ${j.message}`)
      if (!j.error) await load()
    } catch (e) { setScrapeMsg('⚠️ ' + (e as Error).message) }
    setScrapeBusy(false)
  }

  async function analyze() {
    if (!product.trim()) return
    setMarketBusy(true); setMarket(null); setMarketErr('')
    try {
      const res = await fetch('/api/leads/market-fit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product }) })
      const j = await res.json()
      if (j.error) setMarketErr(j.error); else setMarket(j)
    } catch (e) { setMarketErr((e as Error).message) }
    setMarketBusy(false)
  }

  async function convertSelected(status: string) {
    const ids = Object.keys(sel).filter(k => sel[k])
    if (!ids.length) return
    await sb.from('customers').update({ customer_status: status }).in('id', ids)
    setSel({}); load()
  }
  async function deleteSelected() {
    const ids = Object.keys(sel).filter(k => sel[k])
    if (!ids.length || !confirm(`Delete ${ids.length} lead(s)?`)) return
    await sb.from('customers').delete().in('id', ids)
    setSel({}); load()
  }

  const selCount = Object.values(sel).filter(Boolean).length
  const withEmail = leads.filter(l => l.email).length
  const mapLeads: LeadPoint[] = leads.filter(l => l.latitude && l.longitude).map(l => ({ id: l.id, name: l.company_name, lat: l.latitude as number, lng: l.longitude as number, email: l.email, city: l.city, state: l.state }))
  const mapScrapes: ScrapeArea[] = scrapes.filter(s => s.center_lat && s.center_lng).map(s => ({ id: s.id, center_lat: s.center_lat as number, center_lng: s.center_lng as number, radius_miles: s.radius_miles || 25, prompt: s.prompt, created_at: s.created_at, new_count: s.new_count }))

  const tabBtn = (t: typeof tab, label: string) => (
    <button onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-semibold rounded-lg ${tab === t ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>{label}</button>
  )

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold">Leads</h1>
        <Link href="/sales/campaign" className="text-xs font-semibold px-3 py-2 rounded-lg bg-emerald-600 text-white">Open Email Campaigns →</Link>
      </div>
      <p className="text-xs text-gray-400 mb-4">{leads.length} leads · {withEmail} with email. Leads are customer records with status “Lead”; add emails then target them in Email Campaigns.</p>

      <div className="flex gap-2 mb-5">{tabBtn('leads', 'Leads')}{tabBtn('scrape', 'Find Leads (Scrape)')}{tabBtn('market', 'Market Finder')}</div>

      {tab === 'leads' && (
        <>
          {selCount > 0 && (
            <div className="flex items-center gap-2 mb-3 text-xs">
              <span className="text-gray-500">{selCount} selected:</span>
              <button onClick={() => convertSelected('Prospect')} className="px-2.5 py-1.5 rounded border bg-white">Convert to Prospect</button>
              <button onClick={() => convertSelected('Active Customer')} className="px-2.5 py-1.5 rounded border bg-white">Mark Active Customer</button>
              <Link href="/sales/campaign" className="px-2.5 py-1.5 rounded border bg-emerald-50 text-emerald-700">Add to Campaign →</Link>
              <button onClick={deleteSelected} className="px-2.5 py-1.5 rounded border bg-red-50 text-red-600">Delete</button>
            </div>
          )}
          {loading ? <p className="text-gray-400">Loading…</p> : leads.length === 0 ? <p className="text-gray-400">No leads yet. Use “Find Leads (Scrape)” to add some.</p> : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-gray-500 bg-gray-50 border-b">
                  <th className="p-2 w-8"></th><th className="p-2">Company</th><th className="p-2">Location</th><th className="p-2">Email</th><th className="p-2">Phone</th><th className="p-2">Source</th><th className="p-2">Status</th><th className="p-2">Scraped</th>
                </tr></thead>
                <tbody>
                  {leads.map(l => (
                    <tr key={l.id} className="border-b border-gray-50">
                      <td className="p-2"><input type="checkbox" checked={!!sel[l.id]} onChange={e => setSel(s => ({ ...s, [l.id]: e.target.checked }))} /></td>
                      <td className="p-2 font-medium">{l.company_name}{l.website && <a href={l.website} target="_blank" rel="noreferrer" className="text-blue-500 ml-1">↗</a>}</td>
                      <td className="p-2 text-gray-500">{[l.city, l.state].filter(Boolean).join(', ') || '—'}</td>
                      <td className="p-2">{l.email ? <a href={`mailto:${l.email}`} className="text-blue-600">{l.email}</a> : <span className="text-amber-500">none</span>}</td>
                      <td className="p-2 text-gray-500">{l.phone || '—'}</td>
                      <td className="p-2 text-gray-500">{l.is_scraped_lead ? 'Scraped' : (l.lead_source || '—')}</td>
                      <td className="p-2">{l.customer_status || 'Lead'}</td>
                      <td className="p-2 text-gray-400">{l.scraped_at ? new Date(l.scraped_at).toLocaleDateString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
            <div>
              <label className="block text-xs text-gray-500 mb-1">ZIP code</label>
              <input value={zip} onChange={e => setZip(e.target.value)} placeholder="92705" className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Radius: <b>{radius} mi</b></label>
              <input type="range" min={5} max={50} value={radius} onChange={e => setRadius(Number(e.target.value))} className="w-full" />
            </div>
            <div className="md:col-span-4">
              <button onClick={runScrape} disabled={scrapeBusy} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50">{scrapeBusy ? 'Scraping…' : '🔍 Find Leads'}</button>
              {scrapeMsg && <span className="ml-3 text-xs text-gray-600">{scrapeMsg}</span>}
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden" style={{ height: 420 }}>
            <LeadsMap leads={mapLeads} scrapes={mapScrapes} />
          </div>
          <p className="text-xs text-gray-400">Indigo circles = areas already scraped (so you don’t rework them). Green dots = leads with email; amber = no email found.</p>

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
                    <div className="flex items-center justify-between mb-1">
                      <p className="font-semibold">{r.area}, {r.state}</p>
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">{r.score}</span>
                    </div>
                    <p className="text-xs text-gray-600 mb-1"><b className="text-emerald-700">Regulation:</b> {r.regulationAngle}</p>
                    <p className="text-xs text-gray-600 mb-2"><b className="text-blue-700">Demographics:</b> {r.demographicAngle}</p>
                    {r.suggestedZips && r.suggestedZips.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {r.suggestedZips.map(z => (
                          <button key={z} onClick={() => { setZip(z); setTab('scrape') }} className="text-[11px] px-2 py-1 rounded bg-gray-100 hover:bg-indigo-100">Scrape {z} →</button>
                        ))}
                      </div>
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
