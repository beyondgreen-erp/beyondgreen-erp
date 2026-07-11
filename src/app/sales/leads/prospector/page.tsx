'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { statusColor } from '@/lib/statusColors'

interface Lead {
  id: string; company_name: string; contact_name: string | null; title: string | null; seniority: string | null
  email: string | null; phone: string | null; website: string | null; linkedin_url: string | null
  city: string | null; state: string | null; industry: string | null; company_size: string | null
  customer_status: string | null; pipeline_stage: string | null; is_scraped_lead: boolean | null
  scraped_at: string | null; scrape_region: string | null; contacted_at: string | null
  enriched_at: string | null; enrichment_source: string | null; lead_source: string | null; notes: string | null
  do_not_contact: boolean | null
}
interface LeadList { id: string; name: string; color: string | null }
interface SavedSearch { id: string; name: string; filters: any }
interface Stat { customer_id: string; emails_sent: number | null; responded: boolean | null; active_campaign: boolean | null }

const PAGE_SIZE = 50
const emptyFilters = { search: '', industries: [] as string[], states: [] as string[], status: 'all', hasEmail: false, hasPhone: false, hasWebsite: false, enriched: false, notContacted: false, listId: 'all', websiteNoEmail: false, showDnc: false }
type Filters = typeof emptyFilters

export default function LeadProspectorPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [leads, setLeads] = useState<Lead[]>([])
  const [lists, setLists] = useState<LeadList[]>([])
  const [sequences, setSequences] = useState<{ id: string; name: string; status: string }[]>([])
  const [members, setMembers] = useState<Record<string, string[]>>({}) // customer_id -> list_ids
  const [saved, setSaved] = useState<SavedSearch[]>([])
  const [stats, setStats] = useState<Record<string, Stat>>({})
  const [loading, setLoading] = useState(true)
  const [userEmail, setUserEmail] = useState('')

  const [f, setF] = useState<Filters>(emptyFilters)
  const [industrySearch, setIndustrySearch] = useState('')
  const [showAllIndustries, setShowAllIndustries] = useState(false)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState('')
  const [detail, setDetail] = useState<Lead | null>(null)
  const [detailOutreach, setDetailOutreach] = useState<any[]>([])

  useEffect(() => { sb.auth.getUser().then(({ data }) => setUserEmail(data.user?.email || '')) }, [sb])

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: l }, { data: ll }, { data: lm }, { data: ss }] = await Promise.all([
      sb.from('customers').select('id,company_name,contact_name,title,seniority,email,phone,website,linkedin_url,city,state,industry,company_size,customer_status,pipeline_stage,is_scraped_lead,scraped_at,scrape_region,contacted_at,enriched_at,enrichment_source,lead_source,notes,do_not_contact').eq('board', 'Leads').order('company_name').limit(8000),
      sb.from('lead_lists').select('id,name,color').order('created_at', { ascending: false }),
      sb.from('lead_list_members').select('list_id,customer_id'),
      sb.from('lead_saved_searches').select('id,name,filters').order('created_at', { ascending: false }),
    ])
    setLeads((l as Lead[]) || [])
    setLists((ll as LeadList[]) || [])
    const m: Record<string, string[]> = {}
    ;(lm as any[] || []).forEach(r => { (m[r.customer_id] ||= []).push(r.list_id) })
    setMembers(m)
    setSaved((ss as SavedSearch[]) || [])
    const { data: sq } = await sb.from('sequences').select('id,name,status').in('status', ['active', 'draft']).order('created_at', { ascending: false })
    setSequences((sq as any[]) || [])
    const ids = ((l as Lead[]) || []).map(x => x.id)
    if (ids.length) {
      const { data: cs } = await sb.from('customer_campaign_stats').select('customer_id,emails_sent,responded,active_campaign').in('customer_id', ids)
      const sm: Record<string, Stat> = {}
      ;(cs as Stat[] || []).forEach(s => { sm[s.customer_id] = s })
      setStats(sm)
    }
    setLoading(false)
  }, [sb])
  useEffect(() => { load() }, [load])

  // ── facet options with counts ──
  const industryCounts = useMemo(() => {
    const m: Record<string, number> = {}
    leads.forEach(l => { if (l.industry) m[l.industry] = (m[l.industry] || 0) + 1 })
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [leads])
  const stateCounts = useMemo(() => {
    const m: Record<string, number> = {}
    leads.forEach(l => { if (l.state) m[l.state] = (m[l.state] || 0) + 1 })
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [leads])
  const statusOptions = useMemo(() => Array.from(new Set(leads.map(l => l.customer_status || 'Lead'))).sort(), [leads])

  const match = (l: Lead) => {
    if (f.search) {
      const q = f.search.toLowerCase()
      const hay = [l.company_name, l.contact_name, l.title, l.email, l.website, l.industry, l.city, l.state].map(x => (x || '').toLowerCase()).join(' ')
      if (!hay.includes(q)) return false
    }
    if (f.industries.length && !(l.industry && f.industries.includes(l.industry))) return false
    if (f.states.length && !(l.state && f.states.includes(l.state))) return false
    if (f.status !== 'all' && (l.customer_status || 'Lead') !== f.status) return false
    if (f.hasEmail && !l.email) return false
    if (f.hasPhone && !l.phone) return false
    if (f.hasWebsite && !l.website) return false
    if (f.enriched && !l.enriched_at) return false
    if (f.notContacted && l.contacted_at) return false
    if (f.listId !== 'all' && !(members[l.id] || []).includes(f.listId)) return false
    if (f.websiteNoEmail && !(l.website && !l.email)) return false
    // Do-not-contact leads are hidden by default; the "Do-not-contact list" toggle shows only them.
    if (f.showDnc) { if (!l.do_not_contact) return false } else if (l.do_not_contact) return false
    return true
  }
  const filtered = useMemo(() => leads.filter(match), [leads, f, members]) // eslint-disable-line
  useEffect(() => { setPage(0) }, [f])
  const pageRows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  const pageCount = Math.ceil(filtered.length / PAGE_SIZE)

  const withEmail = filtered.filter(l => l.email).length
  const withPhone = filtered.filter(l => l.phone).length
  const notContacted = filtered.filter(l => !l.contacted_at).length
  const enrichedCount = filtered.filter(l => l.enriched_at).length

  // ── selection ──
  const selArr = () => Array.from(sel)
  const toggleSel = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allPageSelected = pageRows.length > 0 && pageRows.every(r => sel.has(r.id))
  const togglePage = () => setSel(s => { const n = new Set(s); if (allPageSelected) pageRows.forEach(r => n.delete(r.id)); else pageRows.forEach(r => n.add(r.id)); return n })
  const selectAllFiltered = () => setSel(new Set(filtered.map(l => l.id)))

  const toggleArr = (key: 'industries' | 'states', v: string) => setF(p => ({ ...p, [key]: p[key].includes(v) ? p[key].filter(x => x !== v) : [...p[key], v] }))

  // ── actions ──
  const [showNewList, setShowNewList] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [addToListId, setAddToListId] = useState('')

  async function createList(withSelection: boolean) {
    if (!newListName.trim()) return
    const { data } = await sb.from('lead_lists').insert({ name: newListName.trim(), created_by: userEmail }).select('*').single()
    if (data && withSelection && sel.size) {
      const rows = selArr().map(cid => ({ list_id: (data as LeadList).id, customer_id: cid, added_by: userEmail }))
      await sb.from('lead_list_members').upsert(rows, { onConflict: 'list_id,customer_id' })
    }
    setNewListName(''); setShowNewList(false); load()
  }
  async function addSelectedToList(listId: string) {
    if (!listId || !sel.size) return
    const rows = selArr().map(cid => ({ list_id: listId, customer_id: cid, added_by: userEmail }))
    await sb.from('lead_list_members').upsert(rows, { onConflict: 'list_id,customer_id' })
    setAddToListId(''); load()
    setBusy(`Added ${sel.size} to list.`); setTimeout(() => setBusy(''), 2500)
  }
  async function markContacted() {
    if (!sel.size) return
    await sb.from('customers').update({ contacted_at: new Date().toISOString(), pipeline_stage: 'Contacted' }).in('id', selArr())
    load(); setBusy(`Marked ${sel.size} contacted.`); setTimeout(() => setBusy(''), 2500)
  }
  async function markDNC(ids: string[]) {
    if (!ids.length) return
    if (!confirm(`Mark ${ids.length} lead(s) as DO NOT CONTACT?\n\nThey'll be removed from every list and permanently excluded from all automated outreach.`)) return
    await sb.from('customers').update({ do_not_contact: true, updated_at: new Date().toISOString() }).in('id', ids)
    await sb.from('lead_list_members').delete().in('customer_id', ids)
    try { await sb.from('customer_campaign_stats').upsert(ids.map(id => ({ customer_id: id, active_campaign: false })), { onConflict: 'customer_id' }) } catch { /* ignore */ }
    setSel(new Set()); setDetail(null); load(); setBusy(`${ids.length} marked Do-Not-Contact.`); setTimeout(() => setBusy(''), 3000)
  }
  function siteUrl(l: Lead) {
    const w = (l.website || '').trim(); if (!w) return null
    return w.startsWith('http') ? w : 'https://' + w
  }
  async function logWebForm(l: Lead) {
    try {
      await sb.from('customer_outreach').insert({ customer_id: l.id, subject: 'Website contact-form outreach', body: '(Submitted via the company website contact form.)', delivered_via: 'web_form', status: 'sent', sent_by: userEmail, sent_at: new Date().toISOString() })
    } catch { /* ignore */ }
    await sb.from('customers').update({ contacted_at: new Date().toISOString(), pipeline_stage: 'Contacted' }).eq('id', l.id)
    load(); openDetail(l); setBusy('Logged website-form outreach.'); setTimeout(() => setBusy(''), 2500)
  }
  async function enrollInSequence(seqId: string) {
    if (!seqId || !sel.size) return
    const eligible = selArr().filter(id => !leads.find(l => l.id === id)?.do_not_contact)
    const rows = eligible.map(cid => ({ sequence_id: seqId, customer_id: cid, enrolled_by: userEmail, status: 'active', current_step: 0, next_send_at: new Date().toISOString() }))
    if (rows.length) await sb.from('sequence_enrollments').upsert(rows, { onConflict: 'sequence_id,customer_id' })
    load(); setBusy(`Enrolled ${rows.length} lead(s) into the sequence.`); setTimeout(() => setBusy(''), 3000)
  }
  async function enrichSelected() {
    if (!sel.size) return
    setBusy(`Enriching ${sel.size} lead(s)…`)
    try {
      const r = await fetch('/api/leads/enrich', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: selArr().slice(0, 40) }) })
      const j = await r.json()
      setBusy(j.message || 'Enrichment complete.'); setTimeout(() => setBusy(''), 6000)
      load()
    } catch { setBusy('Enrichment failed.'); setTimeout(() => setBusy(''), 4000) }
  }
  function exportCSV() {
    const rows = sel.size ? filtered.filter(l => sel.has(l.id)) : filtered
    const cols = ['company_name', 'contact_name', 'title', 'email', 'phone', 'website', 'city', 'state', 'industry', 'customer_status']
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csv = [cols.join(','), ...rows.map(r => cols.map(c => esc((r as any)[c])).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
  }

  // ── saved searches ──
  const [showSaveSearch, setShowSaveSearch] = useState(false)
  const [searchName, setSearchName] = useState('')
  async function saveSearch() {
    if (!searchName.trim()) return
    await sb.from('lead_saved_searches').insert({ name: searchName.trim(), filters: f, created_by: userEmail })
    setSearchName(''); setShowSaveSearch(false); load()
  }
  function applySaved(s: SavedSearch) { setF({ ...emptyFilters, ...(s.filters || {}) }) }
  const activeFilterCount = (f.industries.length ? 1 : 0) + (f.states.length ? 1 : 0) + (f.status !== 'all' ? 1 : 0) + (f.hasEmail ? 1 : 0) + (f.hasPhone ? 1 : 0) + (f.hasWebsite ? 1 : 0) + (f.enriched ? 1 : 0) + (f.notContacted ? 1 : 0) + (f.listId !== 'all' ? 1 : 0)

  async function openDetail(l: Lead) {
    setDetail(l)
    const { data } = await sb.from('customer_outreach').select('subject,sent_at,status,open_count,response_received').eq('customer_id', l.id).order('sent_at', { ascending: false }).limit(20)
    setDetailOutreach((data as any[]) || [])
  }

  const chk = 'w-4 h-4 rounded border-gray-300 text-[#0086C0] focus:ring-0 cursor-pointer'
  const Facet = ({ label, on, onClick, count }: { label: string; on: boolean; onClick: () => void; count?: number }) => (
    <button onClick={onClick} className="flex items-center justify-between w-full px-2 py-1.5 rounded-md hover:bg-[#F0F4F9] text-left">
      <span className="flex items-center gap-2 text-[13px] text-[#3A4056] min-w-0">
        <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${on ? 'bg-[#0086C0] border-[#0086C0]' : 'border-gray-300'}`}>{on && <i className="ti ti-check text-white text-[10px]" />}</span>
        <span className="truncate">{label}</span>
      </span>
      {count != null && <span className="text-[11px] text-gray-400 shrink-0">{count.toLocaleString()}</span>}
    </button>
  )

  return (
    <div className="min-h-screen bg-[#F5F6FA] flex">
      {/* ── Filter rail ── */}
      <aside className="w-64 shrink-0 bg-white border-r border-[#E4E6EE] h-[calc(100vh-64px)] sticky top-0 overflow-y-auto">
        <div className="p-3 border-b border-[#EEF0F4] flex items-center justify-between">
          <span className="text-sm font-bold text-[#1A1D2E] flex items-center gap-1.5"><i className="ti ti-filter text-[#0086C0]" />Filters{activeFilterCount > 0 && <span className="text-[10px] bg-[#0086C0] text-white rounded-full px-1.5">{activeFilterCount}</span>}</span>
          {activeFilterCount > 0 && <button onClick={() => setF(emptyFilters)} className="text-[11px] text-gray-400 hover:text-gray-700">Clear</button>}
        </div>

        <div className="p-3 space-y-4">
          <div>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Quick filters</p>
            <div className="space-y-0.5">
              <Facet label="Has email" on={f.hasEmail} onClick={() => setF(p => ({ ...p, hasEmail: !p.hasEmail }))} />
              <Facet label="Has phone" on={f.hasPhone} onClick={() => setF(p => ({ ...p, hasPhone: !p.hasPhone }))} />
              <Facet label="Has website" on={f.hasWebsite} onClick={() => setF(p => ({ ...p, hasWebsite: !p.hasWebsite }))} />
              <Facet label="Enriched" on={f.enriched} onClick={() => setF(p => ({ ...p, enriched: !p.enriched }))} />
              <Facet label="Not yet contacted" on={f.notContacted} onClick={() => setF(p => ({ ...p, notContacted: !p.notContacted }))} />
              <Facet label="Website, no email" on={f.websiteNoEmail} onClick={() => setF(p => ({ ...p, websiteNoEmail: !p.websiteNoEmail }))} />
              <button onClick={() => setF(p => ({ ...p, showDnc: !p.showDnc }))} className={`flex items-center justify-between w-full px-2 py-1.5 rounded-md text-left ${f.showDnc ? 'bg-[#FCE8EC]' : 'hover:bg-[#F0F4F9]'}`}>
                <span className="flex items-center gap-2 text-[13px] min-w-0" style={{ color: f.showDnc ? '#A11B30' : '#3A4056' }}>
                  <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${f.showDnc ? 'bg-[#E2445C] border-[#E2445C]' : 'border-gray-300'}`}>{f.showDnc && <i className="ti ti-check text-white text-[10px]" />}</span>
                  <span className="truncate">Do-not-contact list</span>
                </span>
                <i className="ti ti-ban text-[#E2445C] text-sm shrink-0" />
              </button>
            </div>
          </div>

          <div>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Industry</p>
            <input value={industrySearch} onChange={e => setIndustrySearch(e.target.value)} placeholder="Search industry…" className="w-full text-xs border border-[#E4E6EE] rounded-md px-2 py-1.5 mb-1 focus:outline-none focus:ring-1 focus:ring-[#0086C0]" />
            <div className="space-y-0.5 max-h-64 overflow-y-auto">
              {industryCounts.filter(([n]) => !industrySearch || n.toLowerCase().includes(industrySearch.toLowerCase())).slice(0, showAllIndustries ? 999 : 10).map(([name, count]) => (
                <Facet key={name} label={name} count={count} on={f.industries.includes(name)} onClick={() => toggleArr('industries', name)} />
              ))}
            </div>
            {industryCounts.length > 10 && <button onClick={() => setShowAllIndustries(v => !v)} className="text-[11px] text-[#0086C0] mt-1">{showAllIndustries ? 'Show less' : `Show all ${industryCounts.length}`}</button>}
          </div>

          <div>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">State</p>
            <div className="space-y-0.5 max-h-48 overflow-y-auto">
              {stateCounts.map(([name, count]) => <Facet key={name} label={name} count={count} on={f.states.includes(name)} onClick={() => toggleArr('states', name)} />)}
            </div>
          </div>

          <div>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Status</p>
            <select value={f.status} onChange={e => setF(p => ({ ...p, status: e.target.value }))} className="w-full text-xs border border-[#E4E6EE] rounded-md px-2 py-1.5">
              <option value="all">All statuses</option>
              {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {saved.length > 0 && (
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Saved searches</p>
              <div className="space-y-0.5">
                {saved.map(s => <button key={s.id} onClick={() => applySaved(s)} className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md hover:bg-[#F0F4F9] text-[13px] text-[#3A4056] text-left"><i className="ti ti-bookmark text-gray-400" />{s.name}</button>)}
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="px-5 pt-4 pb-3 border-b border-[#E4E6EE] bg-white">
          <div className="flex items-center gap-3 mb-3">
            <div>
              <h1 className="text-xl font-bold text-[#1A1D2E] flex items-center gap-2"><i className="ti ti-target-arrow text-[#0086C0]" />Lead Prospector</h1>
              <p className="text-xs text-gray-500">{loading ? 'Loading…' : `${filtered.length.toLocaleString()} of ${leads.length.toLocaleString()} leads`}</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => setShowSaveSearch(true)} className="text-xs px-3 py-2 rounded-lg border border-[#E4E6EE] text-gray-500 hover:text-[#1A1D2E]"><i className="ti ti-bookmark mr-1" />Save search</button>
              <button onClick={() => setShowNewList(true)} className="text-xs px-3 py-2 rounded-lg border border-[#E4E6EE] text-gray-500 hover:text-[#1A1D2E]"><i className="ti ti-list mr-1" />New list</button>
              <button onClick={exportCSV} className="text-xs px-3 py-2 rounded-lg bg-[#0086C0] text-white hover:bg-[#0074a6]"><i className="ti ti-download mr-1" />Export</button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-lg">
              <i className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
              <input value={f.search} onChange={e => setF(p => ({ ...p, search: e.target.value }))} placeholder="Search name, company, email, website…" className="w-full pl-9 pr-3 py-2 text-sm border border-[#E4E6EE] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0086C0]/30" />
            </div>
            <select value={f.listId} onChange={e => setF(p => ({ ...p, listId: e.target.value }))} className="text-xs border border-[#E4E6EE] rounded-lg px-2 py-2">
              <option value="all">All leads</option>
              {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <div className="flex gap-3 text-[11px] text-gray-500 ml-2">
              <span><b className="text-[#0086C0]">{withEmail}</b> email</span>
              <span><b className="text-[#00A84F]">{withPhone}</b> phone</span>
              <span><b className="text-[#A25DDC]">{enrichedCount}</b> enriched</span>
              <span><b className="text-[#FDAB3D]">{notContacted}</b> uncontacted</span>
            </div>
          </div>
        </div>

        {/* bulk bar */}
        {sel.size > 0 && (
          <div className="flex items-center gap-2 px-5 py-2 bg-[#EAF4FB] border-b border-[#CDE6F5]">
            <span className="text-xs font-semibold text-[#0074a6]">{sel.size} selected</span>
            {sel.size < filtered.length && <button onClick={selectAllFiltered} className="text-xs text-[#0086C0] underline">Select all {filtered.length}</button>}
            <div className="ml-2 flex items-center gap-1.5">
              <select value={addToListId} onChange={e => { setAddToListId(e.target.value); addSelectedToList(e.target.value) }} className="text-xs border border-[#CDE6F5] bg-white rounded-md px-2 py-1.5">
                <option value="">+ Add to list…</option>
                {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <select value="" onChange={e => { if (e.target.value) enrollInSequence(e.target.value) }} className="text-xs border border-[#CDE6F5] bg-white rounded-md px-2 py-1.5">
                <option value="">+ Add to sequence…</option>
                {sequences.map(s => <option key={s.id} value={s.id}>{s.name}{s.status !== 'active' ? ' (draft)' : ''}</option>)}
              </select>
              <button onClick={enrichSelected} className="text-xs px-2.5 py-1.5 rounded-md bg-white border border-[#CDE6F5] hover:bg-[#F0F8FD]"><i className="ti ti-sparkles mr-1 text-[#A25DDC]" />Enrich</button>
              <button onClick={markContacted} className="text-xs px-2.5 py-1.5 rounded-md bg-white border border-[#CDE6F5] hover:bg-[#F0F8FD]"><i className="ti ti-mail-check mr-1" />Mark contacted</button>
              <button onClick={() => markDNC(selArr())} className="text-xs px-2.5 py-1.5 rounded-md bg-white border border-red-200 text-red-600 hover:bg-red-50"><i className="ti ti-ban mr-1" />Do not contact</button>
              <button onClick={exportCSV} className="text-xs px-2.5 py-1.5 rounded-md bg-white border border-[#CDE6F5] hover:bg-[#F0F8FD]"><i className="ti ti-download mr-1" />Export</button>
            </div>
            <button onClick={() => setSel(new Set())} className="ml-auto text-xs text-gray-400 hover:text-gray-700">Clear</button>
          </div>
        )}
        {busy && <div className="px-5 py-1.5 bg-[#FFF8E7] border-b border-[#F3E5C0] text-xs text-[#8A6D3B]">{busy}</div>}

        {/* table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[#F7F8FB] border-b border-[#E4E6EE] z-10">
              <tr className="text-[11px] uppercase tracking-wide text-gray-400">
                <th className="w-10 px-3 py-2"><input type="checkbox" className={chk} checked={allPageSelected} onChange={togglePage} /></th>
                <th className="text-left px-2 py-2 font-semibold">Name</th>
                <th className="text-left px-2 py-2 font-semibold">Email</th>
                <th className="text-left px-2 py-2 font-semibold">Phone</th>
                <th className="text-left px-2 py-2 font-semibold">Location</th>
                <th className="text-left px-2 py-2 font-semibold">Industry</th>
                <th className="text-left px-2 py-2 font-semibold">Status</th>
                <th className="text-left px-2 py-2 font-semibold">Engagement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F1F5]">
              {loading ? <tr><td colSpan={8} className="text-center py-16 text-gray-400 text-sm">Loading leads…</td></tr>
                : pageRows.length === 0 ? <tr><td colSpan={8} className="text-center py-16 text-gray-400 text-sm">No leads match these filters.</td></tr>
                  : pageRows.map(l => {
                    const st = stats[l.id]; const sc = statusColor(l.customer_status || 'Lead')
                    return (
                      <tr key={l.id} className={`hover:bg-[#F7FAFD] cursor-pointer ${l.do_not_contact ? 'bg-[#FDF2F4]' : sel.has(l.id) ? 'bg-[#EAF4FB]' : 'bg-white'}`} onClick={() => openDetail(l)}>
                        <td className="px-3 py-2" onClick={e => e.stopPropagation()}><input type="checkbox" className={chk} checked={sel.has(l.id)} onChange={() => toggleSel(l.id)} /></td>
                        <td className="px-2 py-2 min-w-[200px]">
                          <div className="font-semibold text-[#1A1D2E] truncate max-w-[240px]">{l.company_name}</div>
                          <div className="text-[11px] text-gray-500 truncate max-w-[240px]">{[l.contact_name, l.title].filter(Boolean).join(' · ') || (l.website ? l.website.replace(/^https?:\/\//, '') : '—')}</div>
                        </td>
                        <td className="px-2 py-2">{l.email ? <a href={`mailto:${l.email}`} onClick={e => e.stopPropagation()} className="text-[#0086C0] hover:underline text-xs">{l.email}</a> : <span className="text-gray-300 text-xs">—</span>}</td>
                        <td className="px-2 py-2 text-xs text-gray-600">{l.phone || <span className="text-gray-300">—</span>}</td>
                        <td className="px-2 py-2 text-xs text-gray-600">{[l.city, l.state].filter(Boolean).join(', ') || <span className="text-gray-300">—</span>}</td>
                        <td className="px-2 py-2 text-xs text-gray-600 truncate max-w-[140px]">{l.industry || <span className="text-gray-300">—</span>}</td>
                        <td className="px-2 py-2">{l.do_not_contact ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-md text-white" style={{ background: '#E2445C' }}>⛔ DO NOT CONTACT</span> : <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: sc.bg, color: sc.fg }}>{l.customer_status || 'Lead'}</span>}</td>
                        <td className="px-2 py-2 text-[11px] text-gray-500">
                          {st?.emails_sent ? <span title="emails sent" className="mr-2">✉ {st.emails_sent}</span> : null}
                          {st?.responded ? <span className="text-[#00A84F] font-semibold">Replied</span> : st?.active_campaign ? <span className="text-[#FDAB3D]">In campaign</span> : (l.contacted_at ? <span className="text-gray-400">Contacted</span> : <span className="text-gray-300">New</span>)}
                        </td>
                      </tr>
                    )
                  })}
            </tbody>
          </table>
        </div>

        {/* pagination */}
        {pageCount > 1 && (
          <div className="flex items-center justify-between px-5 py-2 border-t border-[#E4E6EE] bg-white text-xs text-gray-500">
            <span>Page {page + 1} of {pageCount} · {filtered.length.toLocaleString()} leads</span>
            <div className="flex gap-1">
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-2 py-1 rounded border border-[#E4E6EE] disabled:opacity-40">Prev</button>
              <button disabled={page >= pageCount - 1} onClick={() => setPage(p => p + 1)} className="px-2 py-1 rounded border border-[#E4E6EE] disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Detail drawer ── */}
      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(20,24,40,0.35)' }} onClick={() => setDetail(null)}>
          <div className="w-[440px] max-w-full bg-white h-full overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-[#EEF0F4] flex items-start gap-3" style={{ background: 'linear-gradient(180deg,#EAF4FB,#fff)' }}>
              <div className="w-11 h-11 rounded-xl bg-[#0086C0] text-white flex items-center justify-center font-bold shrink-0">{detail.company_name[0]}</div>
              <div className="min-w-0 flex-1">
                <h2 className="font-bold text-[#1A1D2E] truncate">{detail.company_name}</h2>
                <p className="text-xs text-gray-500 truncate">{[detail.contact_name, detail.title].filter(Boolean).join(' · ') || 'No contact yet'}</p>
              </div>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-700 text-lg">×</button>
            </div>
            <div className="p-4 space-y-4">
              {detail.do_not_contact && <div className="rounded-lg bg-[#E2445C] text-white text-center font-bold text-sm py-2.5">⛔ DO NOT CONTACT — excluded from all outreach</div>}
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[['Email', detail.email && `mailto:${detail.email}`, detail.email], ['Phone', null, detail.phone], ['Website', detail.website && (detail.website.startsWith('http') ? detail.website : 'https://' + detail.website), detail.website?.replace(/^https?:\/\//, '')], ['LinkedIn', detail.linkedin_url, detail.linkedin_url ? 'Profile' : null], ['Location', null, [detail.city, detail.state].filter(Boolean).join(', ')], ['Industry', null, detail.industry], ['Status', null, detail.customer_status || 'Lead'], ['Source', null, detail.lead_source || (detail.is_scraped_lead ? 'Scraped' : '—')]].map(([label, href, val], i) => (
                  <div key={i} className="bg-[#F7F8FB] rounded-lg px-2.5 py-1.5">
                    <p className="text-[10px] uppercase text-gray-400">{label}</p>
                    {val ? (href ? <a href={href as string} target="_blank" rel="noreferrer" className="text-[#0086C0] hover:underline break-all">{val}</a> : <p className="text-[#1A1D2E] break-words">{val}</p>) : <p className="text-gray-300">—</p>}
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                {detail.email && <a href={`mailto:${detail.email}`} className="flex-1 text-center text-xs px-3 py-2 rounded-lg bg-[#0086C0] text-white hover:bg-[#0074a6]"><i className="ti ti-mail mr-1" />Email</a>}
                <button onClick={async () => { setSel(new Set([detail.id])); await enrichSelected() }} className="flex-1 text-xs px-3 py-2 rounded-lg border border-[#E4E6EE] hover:bg-[#F5F6FA]"><i className="ti ti-sparkles mr-1 text-[#A25DDC]" />Enrich</button>
              </div>
              {detail.website && !detail.email && !detail.do_not_contact && (
                <div className="rounded-lg border border-[#DCEFE3] bg-[#F2FBF6] p-2.5">
                  <p className="text-[11px] text-[#03683a] mb-1.5 font-semibold">No email on file — reach out via their website form</p>
                  <div className="flex gap-2">
                    <a href={siteUrl(detail) || '#'} target="_blank" rel="noreferrer" className="flex-1 text-center text-xs px-3 py-2 rounded-lg bg-[#00A84F] text-white hover:bg-[#03934a]"><i className="ti ti-external-link mr-1" />Open website</a>
                    <button onClick={() => logWebForm(detail)} className="flex-1 text-xs px-3 py-2 rounded-lg border border-[#B9E3CB] text-[#03683a] hover:bg-[#E7F6EE]"><i className="ti ti-check mr-1" />Log form outreach</button>
                  </div>
                </div>
              )}
              {!detail.do_not_contact && <button onClick={() => markDNC([detail.id])} className="w-full text-xs px-3 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"><i className="ti ti-ban mr-1" />Mark do-not-contact</button>}
              {(members[detail.id] || []).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {(members[detail.id] || []).map(lid => { const ll = lists.find(x => x.id === lid); return ll ? <span key={lid} className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: (ll.color || '#0086C0') + '20', color: ll.color || '#0086C0' }}>{ll.name}</span> : null })}
                </div>
              )}
              <div>
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Engagement history</p>
                {detailOutreach.length === 0 ? <p className="text-xs text-gray-400">No outreach yet.</p> : (
                  <div className="space-y-1.5">
                    {detailOutreach.map((o, i) => (
                      <div key={i} className="text-xs bg-[#F7F8FB] rounded-lg px-2.5 py-1.5">
                        <div className="flex items-center justify-between"><span className="font-medium text-[#1A1D2E] truncate">{o.subject || 'Email'}</span><span className="text-gray-400 shrink-0 ml-2">{o.sent_at ? new Date(o.sent_at).toLocaleDateString() : ''}</span></div>
                        <div className="text-[11px] text-gray-500">{o.response_received ? '↩ Replied' : o.open_count ? `👁 Opened ${o.open_count}×` : (o.status || 'Sent')}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {detail.notes && <div><p className="text-[11px] font-bold text-gray-400 uppercase mb-1">Notes</p><p className="text-xs text-gray-600 whitespace-pre-wrap">{detail.notes}</p></div>}
            </div>
          </div>
        </div>
      )}

      {/* new list modal */}
      {showNewList && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(20,24,40,0.4)' }} onClick={() => setShowNewList(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-[#1A1D2E] mb-3">New list</h3>
            <input autoFocus value={newListName} onChange={e => setNewListName(e.target.value)} placeholder="List name (e.g. Chicago Steakhouses)" className="w-full border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-[#0086C0]/30" />
            <div className="flex gap-2">
              <button onClick={() => setShowNewList(false)} className="ml-auto text-sm px-4 py-2 rounded-lg border border-[#E4E6EE] text-gray-500">Cancel</button>
              <button onClick={() => createList(sel.size > 0)} className="text-sm px-4 py-2 rounded-lg bg-[#0086C0] text-white">{sel.size > 0 ? `Create + add ${sel.size}` : 'Create list'}</button>
            </div>
          </div>
        </div>
      )}

      {/* save search modal */}
      {showSaveSearch && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(20,24,40,0.4)' }} onClick={() => setShowSaveSearch(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-[#1A1D2E] mb-1">Save this search</h3>
            <p className="text-xs text-gray-500 mb-3">Save your current filters to reuse later.</p>
            <input autoFocus value={searchName} onChange={e => setSearchName(e.target.value)} placeholder="Search name" className="w-full border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-[#0086C0]/30" />
            <div className="flex gap-2">
              <button onClick={() => setShowSaveSearch(false)} className="ml-auto text-sm px-4 py-2 rounded-lg border border-[#E4E6EE] text-gray-500">Cancel</button>
              <button onClick={saveSearch} className="text-sm px-4 py-2 rounded-lg bg-[#0086C0] text-white">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
