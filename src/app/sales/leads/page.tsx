'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
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
  contacted_at: string | null; latitude: number | null; longitude: number | null; industry: string | null; is_dead_lead: boolean | null
  auto_outreach_paused: boolean | null; last_reply_intent: string | null
}
interface Scrape { id: string; prompt: string | null; zip: string | null; radius_miles: number | null; center_lat: number | null; center_lng: number | null; result_count: number | null; new_count: number | null; emails_found: number | null; created_at: string | null }
interface Enrollment { id: string; sequence_id: string; customer_id: string; status: string; current_step: number; next_send_at: string | null; last_step_sent_at: string | null; enrolled_at: string | null }
interface SeqLite { id: string; name: string; status: string; steps_total: number }
interface Region { area: string; state: string; score: number; regulationAngle: string; demographicAngle: string; suggestedZips?: string[] }
interface MarketResult { summary: string; regions: Region[]; cautions?: string }
interface NewLead { id: string; company_name: string | null; email: string | null; city: string | null; state: string | null }

// Record-Board style status groups (colored, collapsible, count pill)
const GROUPS = [
  { key: 'new',        title: 'New leads',       color: '#FDAB3D', match: (l: Lead, enr: boolean) => !isContacted(l) && !enr && !l.is_dead_lead },
  { key: 'sequence',   title: 'In sequence',     color: '#6366F1', match: (l: Lead, enr: boolean) => enr && !l.is_dead_lead },
  { key: 'contacted',  title: 'Contacted',       color: '#3B6FE0', match: (l: Lead, enr: boolean) => isContacted(l) && !enr && !isReplied(l) && !l.is_dead_lead },
  { key: 'replied',    title: 'Replied / warm',  color: '#00C875', match: (l: Lead, enr: boolean) => isReplied(l) && !l.is_dead_lead },
  { key: 'dead',       title: 'Dead',            color: '#9699A6', match: (l: Lead) => !!l.is_dead_lead },
]

function isContacted(l: Lead) { return !!l.contacted_at || (!!l.pipeline_stage && l.pipeline_stage !== 'Lead' && l.pipeline_stage !== 'New') }
function isReplied(l: Lead) { const s = (l.pipeline_stage || '').toLowerCase(); return s === 'interested' || s === 'replied' || s === 'warm' }
const fmtD = (d?: string | null) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'
const fmtDT = (d?: string | null) => d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

export default function LeadsPage() {
  const [tab, setTab] = useState<'leads' | 'scrape' | 'market'>('leads')
  const [leads, setLeads] = useState<Lead[]>([])
  const [scrapes, setScrapes] = useState<Scrape[]>([])
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState<Record<string, boolean>>({})
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [q, setQ] = useState('')
  const [visN, setVisN] = useState<Record<string, number>>({}) // rows shown per group
  const [userEmail, setUserEmail] = useState('')
  const [enrByCustomer, setEnrByCustomer] = useState<Record<string, Enrollment & { seq_name: string; steps_total: number }>>({})
  const [sequences, setSequences] = useState<SeqLite[]>([])

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
    const cols = 'id, company_name, email, phone, website, city, state, customer_status, pipeline_stage, is_scraped_lead, scraped_at, scrape_region, scrape_id, contacted_at, latitude, longitude, industry, is_dead_lead, auto_outreach_paused, last_reply_intent'
    const all: Lead[] = []
    const SIZE = 1000
    for (let from = 0; from < 100000; from += SIZE) {
      const { data } = await sb.from('customers').select(cols)
        .or('is_scraped_lead.eq.true,customer_status.eq.Lead')
        .order('scraped_at', { ascending: false, nullsFirst: false })
        .range(from, from + SIZE - 1)
      if (!data || !data.length) break
      all.push(...(data as Lead[]))
      if (data.length < SIZE) break
    }
    const [{ data: s }, { data: enr }, { data: seqs }, { data: steps }] = await Promise.all([
      sb.from('lead_scrapes').select('*').order('created_at', { ascending: false }).limit(500),
      sb.from('sequence_enrollments').select('*').eq('status', 'active'),
      sb.from('sequences').select('id,name,status').in('status', ['active', 'draft', 'paused']).order('created_at', { ascending: false }),
      sb.from('sequence_steps').select('sequence_id'),
    ])
    setLeads(all)
    setScrapes((s as Scrape[]) || [])

    // Group step counts per sequence
    const stepCount: Record<string, number> = {}
    ;((steps as any[]) || []).forEach(x => { stepCount[x.sequence_id] = (stepCount[x.sequence_id] || 0) + 1 })
    const seqLite: SeqLite[] = ((seqs as any[]) || []).map(x => ({ id: x.id, name: x.name, status: x.status, steps_total: stepCount[x.id] || 0 }))
    setSequences(seqLite)

    // Index active enrollments by customer, with the sequence name and step total pre-joined
    const seqMap: Record<string, SeqLite> = {}
    seqLite.forEach(x => { seqMap[x.id] = x })
    const m: Record<string, Enrollment & { seq_name: string; steps_total: number }> = {}
    ;((enr as Enrollment[]) || []).forEach(e => {
      const sq = seqMap[e.sequence_id]
      m[e.customer_id] = { ...e, seq_name: sq?.name || '(unknown)', steps_total: sq?.steps_total || 0 }
    })
    setEnrByCustomer(m)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const totalNew = leads.filter(l => !isContacted(l)).length
  const withEmail = leads.filter(l => l.email).length

  // Group leads by pipeline status for the Record Board layout
  const grouped = useMemo(() => {
    const gs: Record<string, Lead[]> = { new: [], sequence: [], contacted: [], replied: [], dead: [] }
    const qs = q.trim().toLowerCase()
    for (const l of leads) {
      if (qs) {
        const hay = [l.company_name, l.email, l.city, l.state, l.industry, l.phone].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(qs)) continue
      }
      const enr = !!enrByCustomer[l.id]
      const grp = GROUPS.find(g => g.match(l, enr))?.key || 'new'
      gs[grp].push(l)
    }
    return gs
  }, [leads, q, enrByCustomer])

  const selIds = () => Object.keys(sel).filter(k => sel[k])
  const selCount = selIds().length
  const toggleGroupSel = (rows: Lead[], on: boolean) => setSel(s => { const n = { ...s }; rows.forEach(r => n[r.id] = on); return n })

  async function runScrape() {
    if (!zip.trim()) { setScrapeMsg('Enter a ZIP code.'); return }
    setScrapeBusy(true); setScrapeMsg('Searching Google Places and extracting emails…'); setJustAdded([])
    try {
      const res = await fetch('/api/leads/scrape', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, zip: zip.trim(), radiusMiles: radius, createdBy: userEmail }) })
      const j = await res.json()
      setScrapeMsg(j.error ? `⚠️ ${j.error}` : `✅ ${j.message}`)
      if (!j.error) { setJustAdded(j.newLeads || []); await load() }
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

  async function markContacted(val: boolean) {
    const ids = selIds(); if (!ids.length) return
    await sb.from('customers').update(val ? { contacted_at: new Date().toISOString(), pipeline_stage: 'Contacted' } : { contacted_at: null, pipeline_stage: 'Lead' }).in('id', ids)
    setSel({}); load()
  }
  async function convertSelected(status: string) { const ids = selIds(); if (!ids.length) return; await sb.from('customers').update({ customer_status: status }).in('id', ids); setSel({}); load() }
  async function enrollSelected(seqId: string) {
    const ids = selIds(); if (!seqId || !ids.length) return
    const { data: cRows } = await sb.from('customers').select('id,auto_outreach_paused,company_name').in('id', ids)
    const paused = (cRows || []).filter((c: any) => c.auto_outreach_paused)
    const eligible = ids.filter(id => !paused.find((p: any) => p.id === id))
    if (paused.length) {
      const names = paused.map((p: any) => p.company_name || p.id).slice(0, 5).join(', ')
      if (!confirm(`${paused.length} paused lead(s) will be SKIPPED: ${names}${paused.length > 5 ? '…' : ''}\n\nContinue enrolling the other ${eligible.length}?`)) return
    }
    if (!eligible.length) { setSel({}); return }
    const rows = eligible.map(cid => ({ sequence_id: seqId, customer_id: cid, enrolled_by: userEmail, status: 'active', current_step: 0, next_send_at: new Date().toISOString() }))
    await sb.from('sequence_enrollments').upsert(rows, { onConflict: 'sequence_id,customer_id' })
    setSel({}); load()
  }
  async function stopSequenceForLead(customerId: string) {
    if (!confirm('Stop this lead’s sequence? No more follow-ups will be sent.')) return
    await sb.from('sequence_enrollments').update({ status: 'stopped', updated_at: new Date().toISOString() }).eq('customer_id', customerId).eq('status', 'active')
    load()
  }
  async function pauseLead(customerId: string) {
    const reason = window.prompt('Reason for pausing this lead? (e.g. "not now", "wrong contact", "asked to stop")', 'not now')
    if (reason === null) return
    await fetch('/api/leads/sequence-pause-lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_ids: [customerId], reason }) })
    load()
  }
  async function unpauseLead(customerId: string) {
    if (!confirm('Unpause this lead and resume their sequences?')) return
    await fetch('/api/leads/sequence-unpause-lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_ids: [customerId] }) })
    load()
  }
  async function sendNextNow(customerId: string) {
    // If a pending review send already exists for this lead, approve THAT one.
    // Otherwise force-run the sequence bypassing the send-day check.
    const enr = enrByCustomer[customerId]
    if (!enr) return
    const { data: pending } = await sb.from('sequence_sends')
      .select('id').eq('enrollment_id', enr.id).eq('status', 'review').limit(1)
    if (pending && pending.length) {
      const r = await fetch('/api/leads/sequence-approve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ send_ids: [pending[0].id] }),
      })
      const j = await r.json()
      alert(j.message || j.error || 'Sent.')
    } else {
      await sb.from('sequence_enrollments').update({ next_send_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', enr.id)
      // Passing sequence_id bypasses the Mon-Fri send-day check for one-off manual sends.
      const r = await fetch(`/api/leads/sequence-run?sequence_id=${encodeURIComponent(enr.sequence_id)}`)
      const j = await r.json()
      alert(j.message || j.error || 'Sent.')
    }
    load()
  }
  async function deleteSelected() { const ids = selIds(); if (!ids.length || !confirm(`Delete ${ids.length} lead(s)?`)) return; await sb.from('customers').delete().in('id', ids); setSel({}); load() }
  async function deleteOne(id: string) { if (!confirm('Delete this lead?')) return; await sb.from('customers').delete().eq('id', id); load() }

  const mapLeads: LeadPoint[] = leads.filter(l => l.latitude && l.longitude).map(l => ({ id: l.id, name: l.company_name, lat: l.latitude as number, lng: l.longitude as number, email: l.email, city: l.city, state: l.state }))
  const mapScrapes: ScrapeArea[] = scrapes.filter(s => s.center_lat && s.center_lng).map(s => ({ id: s.id, center_lat: s.center_lat as number, center_lng: s.center_lng as number, radius_miles: s.radius_miles || 25, prompt: s.prompt, created_at: s.created_at, new_count: s.new_count }))

  const tabBtn = (t: typeof tab, label: string) => <button onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-semibold rounded-lg ${tab === t ? 'bg-[#3B6FE0] text-white' : 'bg-white border border-[#E4E6EE] text-gray-600'}`}>{label}</button>

  return (
    <div className="min-h-screen mon-page p-4 md:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <span className="mon-tag t-purple">🎯 CRM · Leads</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">Leads</h1>
          <p className="text-gray-500 text-sm mt-0.5">{leads.length.toLocaleString()} leads · {withEmail.toLocaleString()} with email · <b className="text-amber-600">{totalNew.toLocaleString()} not yet contacted</b></p>
        </div>
        <div className="flex gap-2 items-center">
          <Link href="/sales/sequences" className="text-sm px-3 py-2 rounded-lg border border-[#E4E6EE] text-gray-600 hover:text-[#1A1D2E]">Sequences →</Link>
          <Link href="/sales/campaign" className="text-sm px-3 py-2 rounded-lg border border-[#E4E6EE] text-gray-600 hover:text-[#1A1D2E]">Campaigns →</Link>
        </div>
      </div>

      <div className="flex gap-2 mb-5">{tabBtn('leads', 'Leads')}{tabBtn('scrape', 'Find Leads (Scrape)')}{tabBtn('market', 'Market Finder')}</div>

      {tab === 'leads' && (
        <>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, email, city, industry…" className="bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm w-full sm:w-72 focus:outline-none focus:ring-2 focus:ring-[#3B6FE0]/40" />
            {selCount > 0 && (
              <div className="flex items-center gap-2 ml-auto text-xs flex-wrap">
                <span className="text-gray-500 font-semibold">{selCount} selected:</span>
                <button onClick={() => markContacted(true)} className="px-2.5 py-1.5 rounded border border-[#E4E6EE] bg-blue-50 text-blue-700 font-semibold">Mark Contacted</button>
                <button onClick={() => markContacted(false)} className="px-2.5 py-1.5 rounded border border-[#E4E6EE] bg-white">Uncontact</button>
                <button onClick={() => convertSelected('Prospect')} className="px-2.5 py-1.5 rounded border border-[#E4E6EE] bg-white">→ Prospect</button>
                <select value="" onChange={e => { if (e.target.value) enrollSelected(e.target.value) }} className="px-2 py-1.5 rounded border border-[#E4E6EE] bg-indigo-50 text-indigo-700 font-semibold">
                  <option value="">+ Add to sequence…</option>
                  {sequences.map(s => <option key={s.id} value={s.id}>{s.name}{s.status !== 'active' ? ` (${s.status})` : ''}</option>)}
                </select>
                <button onClick={deleteSelected} className="px-2.5 py-1.5 rounded border border-red-200 bg-red-50 text-red-600 font-semibold">Delete</button>
              </div>
            )}
          </div>

          {loading ? <p className="text-gray-400 text-sm">Loading…</p> : (
            <div className="space-y-4">
              {GROUPS.map(group => {
                const rows = grouped[group.key] || []
                const shown = visN[group.key] ?? 100
                const view = rows.slice(0, shown)
                const isCol = collapsed[group.key]
                const allSelected = view.length > 0 && view.every(r => sel[r.id])
                return (
                  <div key={group.key} className="bg-white rounded-xl overflow-hidden shadow-sm border border-[#ECEEF3]">
                    <div className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none sticky top-0 z-30 rounded-t-xl" style={{ background: '#fff', borderLeft: '5px solid ' + group.color }} onClick={() => setCollapsed(c => ({ ...c, [group.key]: !c[group.key] }))}>
                      <span className="text-[10px]" style={{ color: group.color, display: 'inline-block', transform: isCol ? 'none' : 'rotate(90deg)' }}>&#9654;</span>
                      <span className="font-bold text-sm" style={{ color: group.color }}>{group.title}</span>
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: group.color + '26', color: group.color }}>{rows.length}</span>
                    </div>
                    {!isCol && (
                      <div className="overflow-x-auto">
                        {rows.length === 0 ? <p className="text-center text-xs text-gray-400 py-4">Nothing here.</p> : (
                          <table className="w-full text-xs min-w-[1100px]">
                            <thead>
                              <tr className="text-[11px] uppercase text-gray-400 border-b border-[#EEF0F4]">
                                <th className="px-3 py-2 w-8"><input type="checkbox" checked={allSelected} onChange={e => toggleGroupSel(view, e.target.checked)} /></th>
                                <th className="text-left px-3 py-2 font-semibold">Company</th>
                                <th className="text-left px-3 py-2 font-semibold w-[130px]">Location</th>
                                <th className="text-left px-3 py-2 font-semibold w-[200px]">Email</th>
                                <th className="text-left px-3 py-2 font-semibold w-[120px]">Industry</th>
                                <th className="text-left px-3 py-2 font-semibold w-[300px]">Sequence</th>
                                <th className="text-right px-3 py-2 font-semibold w-[60px]"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {view.map((l, i) => {
                                const enr = enrByCustomer[l.id]
                                const stepIdx = enr ? enr.current_step : -1
                                const stepsTotal = enr?.steps_total || 0
                                const progress = enr && stepsTotal > 0 ? Math.min(100, Math.round((stepIdx / stepsTotal) * 100)) : 0
                                return (
                                  <tr key={l.id} className={`hover:bg-[#F2F6FF] ${i % 2 ? 'bg-[#F8FAFC]' : 'bg-white'} ${l.auto_outreach_paused ? 'bg-amber-50/40' : ''}`}>
                                    <td className="px-3 py-2"><input type="checkbox" checked={!!sel[l.id]} onChange={e => setSel(s => ({ ...s, [l.id]: e.target.checked }))} /></td>
                                    <td className="px-3 py-2">
                                      <p className="font-semibold text-[#1A1D2E]">{l.company_name || '(unnamed)'}{l.website && <a href={l.website} target="_blank" rel="noreferrer" className="text-[#3B6FE0] ml-1 text-xs">↗</a>}</p>
                                      {l.phone && <p className="text-[10px] text-gray-400">{l.phone}</p>}
                                    </td>
                                    <td className="px-3 py-2 text-gray-500">{[l.city, l.state].filter(Boolean).join(', ') || '—'}</td>
                                    <td className="px-3 py-2">{l.email ? <a href={`mailto:${l.email}`} className="text-[#3B6FE0]">{l.email}</a> : <span className="text-amber-500 text-[11px]">no email</span>}</td>
                                    <td className="px-3 py-2 text-gray-500 truncate max-w-[120px]" title={l.industry || ''}>{l.industry || '—'}</td>
                                    <td className="px-3 py-2">
                                      {enr ? (
                                        <div>
                                          <div className="flex items-center justify-between gap-2">
                                            <Link href="/sales/sequences" className="font-semibold text-indigo-700 text-[11px] truncate max-w-[160px]">{enr.seq_name}</Link>
                                            <span className="text-[10px] font-bold text-gray-500 whitespace-nowrap">Step {Math.min(stepIdx + 1, stepsTotal)}/{stepsTotal || '?'}</span>
                                          </div>
                                          <div className="h-1 bg-gray-100 rounded-full mt-1 overflow-hidden"><div className="h-full bg-indigo-500" style={{ width: progress + '%' }} /></div>
                                          <div className="flex items-center justify-between text-[10px] text-gray-400 mt-0.5">
                                            <span>Last: {fmtD(enr.last_step_sent_at)}</span>
                                            <span>Next: {fmtDT(enr.next_send_at)}</span>
                                          </div>
                                          <div className="flex gap-1 mt-1">
                                            <button onClick={() => sendNextNow(l.id)} className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-200 text-emerald-600 hover:bg-emerald-50">Send now</button>
                                            <button onClick={() => pauseLead(l.id)} className="text-[10px] px-1.5 py-0.5 rounded border border-amber-200 text-amber-600 hover:bg-amber-50" title="Pause this lead — stops all their sequences and blocks future enrollment">⏸ Pause</button>
                                            <button onClick={() => stopSequenceForLead(l.id)} className="text-[10px] px-1.5 py-0.5 rounded border border-red-200 text-red-500 hover:bg-red-50">Stop</button>
                                          </div>
                                        </div>
                                      ) : l.is_dead_lead ? (
                                        <span className="text-[11px] text-gray-500">☠ Dead lead</span>
                                      ) : l.auto_outreach_paused ? (
                                        <div>
                                          <span className="text-[11px] font-semibold text-amber-600">⏸ Paused{l.last_reply_intent ? ` — ${l.last_reply_intent}` : ''}</span>
                                          <button onClick={() => unpauseLead(l.id)} className="ml-2 text-[10px] px-1.5 py-0.5 rounded border border-emerald-200 text-emerald-600 hover:bg-emerald-50">▶ Unpause</button>
                                        </div>
                                      ) : isReplied(l) ? (
                                        <span className="text-[11px] font-semibold text-emerald-700">Replied — {l.pipeline_stage}</span>
                                      ) : isContacted(l) ? (
                                        <span className="text-[11px] text-blue-600">Contacted {fmtD(l.contacted_at)}</span>
                                      ) : (
                                        <span className="text-[11px] text-amber-600">Not contacted</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-right"><button onClick={() => deleteOne(l.id)} className="text-red-400 hover:text-red-600 text-sm">🗑</button></td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        )}
                        {rows.length > view.length && (
                          <div className="px-4 py-2 border-t border-[#EEF0F4] text-center">
                            <button onClick={() => setVisN(v => ({ ...v, [group.key]: (v[group.key] ?? 100) + 200 }))} className="text-xs text-[#3B6FE0] font-semibold hover:underline">Load {Math.min(200, rows.length - view.length)} more (showing {view.length.toLocaleString()} of {rows.length.toLocaleString()})</button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {tab === 'scrape' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#E4E6EE] bg-white p-4 grid md:grid-cols-4 gap-3 items-end">
            <div className="md:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">What to find (business types / keywords)</label>
              <input value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="restaurants, fast food, cafes" className="w-full border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm" />
            </div>
            <div><label className="block text-xs text-gray-500 mb-1">ZIP code</label><input value={zip} onChange={e => setZip(e.target.value)} placeholder="92705" className="w-full border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">Radius: <b>{radius} mi</b></label><input type="range" min={5} max={50} value={radius} onChange={e => setRadius(Number(e.target.value))} className="w-full" /></div>
            <div className="md:col-span-4">
              <button onClick={runScrape} disabled={scrapeBusy} className="px-4 py-2 rounded-lg bg-[#3B6FE0] text-white text-sm font-semibold disabled:opacity-50">{scrapeBusy ? 'Scraping…' : '🔍 Find Leads'}</button>
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
              <button onClick={() => setTab('leads')} className="mt-2 text-xs font-semibold text-[#3B6FE0]">View in Leads →</button>
            </div>
          )}

          <div className="rounded-xl border border-[#E4E6EE] bg-white overflow-hidden" style={{ height: 420 }}><LeadsMap leads={mapLeads} scrapes={mapScrapes} /></div>
          <p className="text-xs text-gray-400">Indigo circles = already-scraped areas. Green dots = leads with email; amber = no email.</p>

          <div className="rounded-xl border border-[#E4E6EE] bg-white p-4">
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
          <div className="rounded-xl border border-[#E4E6EE] bg-white p-4">
            <label className="block text-xs text-gray-500 mb-1">Which product do you want to sell? Where should we target?</label>
            <div className="flex gap-2">
              <input value={product} onChange={e => setProduct(e.target.value)} placeholder="e.g. compostable cutlery, PLA cold cups, kraft takeout bags" className="flex-1 border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm" />
              <button onClick={analyze} disabled={marketBusy} className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold disabled:opacity-50">{marketBusy ? 'Analyzing…' : '✨ Find Best Markets'}</button>
            </div>
            <p className="text-[11px] text-gray-400 mt-2">Weighs plastic/foam ban laws and demographic behavior.</p>
          </div>
          {marketErr && <div className="text-xs bg-red-50 border-l-4 border-red-400 text-red-700 p-3">{marketErr}</div>}
          {market && (
            <>
              <div className="text-sm bg-violet-50 border-l-4 border-violet-400 p-3">{market.summary}</div>
              <div className="grid md:grid-cols-2 gap-3">
                {market.regions.map((r, i) => (
                  <div key={i} className="rounded-xl border border-[#E4E6EE] bg-white p-4">
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

export const dynamic = 'force-dynamic'
