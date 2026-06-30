'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Entry {
  id: string; title: string; content: string; category: string; source: string
  tags: string | null; source_document_id: string | null; created_by: string | null; created_at: string
}
interface Source { type: string; title: string; id: string }

const inp = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition'

const SUBJECTS: { name: string; icon: string; kw: string[] }[] = [
  { name: 'Compostability & Certifications', icon: 'ti-certificate', kw: ['compost', 'certif', 'bpi', 'astm', 'd6400', 'fda', 'biodegrad', 'tuv', 'ok compost', 'delist', 'accredit', ' lab', 'home compost', 'industrial compost'] },
  { name: 'Soil & Composting Science', icon: 'ti-plant-2', kw: ['soil', 'microb', 'decompos', 'organic matter', 'nutrient', 'fertil', 'humus', 'carbon', 'breakdown', 'aerobic', 'anaerobic', 'compost pile', 'worm', 'moisture'] },
  { name: 'Product Specifications', icon: 'ti-ruler-measure', kw: ['spec', 'dimension', 'cutlery', 'utensil', 'double wall', ' cup', ' bag', ' lid', 'straw', ' oz', 'sku', 'biopolymer', 'documentation', 'width', 'height'] },
  { name: 'Materials & Manufacturing', icon: 'ti-building-factory-2', kw: ['material', ' pla', 'resin', 'mold', 'manufactur', 'supplier', 'factory', 'production', 'tooling', 'polymer', 'feedstock'] },
  { name: 'Logistics & Shipping', icon: 'ti-truck-delivery', kw: ['ship', 'freight', 'carrier', 'pallet', 'trailer', 'delivery', 'warehouse', 'logistic', 'fba', 'wfs', ' bol'] },
  { name: 'Imports & Customs', icon: 'ti-anchor', kw: ['import', 'customs', 'bond', 'duty', 'tariff', 'acn', 'broker', 'add ', 'entry done', ' oec', 'clearance', 'antidumping'] },
  { name: 'Sales & Customers', icon: 'ti-users', kw: ['customer', 'sales order', 'walmart', 'chewy', 'amazon', 'quote', 'retailer', 'account', 'distributor', 'wholesale'] },
  { name: 'Finance & Accounting', icon: 'ti-receipt-2', kw: ['invoice', 'payment', ' cost', 'pricing', 'accounting', 'remittance', 'bond#', 'net 30', 'terms'] },
  { name: 'Brand & Marketing', icon: 'ti-palette', kw: ['logo', 'brand', 'marketing', 'label', 'social', 'website', 'design'] },
  { name: 'Quality & Compliance', icon: 'ti-clipboard-check', kw: ['quality', ' qc', 'inspection', 'compliance', 'audit', 'defect', 'os&d', 'exception', 'recall'] },
]
function classify(title: string, content: string, tags: string | null): { name: string; icon: string } {
  const hay = ((title || '') + ' ' + (content || '') + ' ' + (tags || '')).toLowerCase()
  const tl = (title || '').toLowerCase()
  let best = 0, pick = -1
  SUBJECTS.forEach((s, i) => {
    let score = 0
    for (const k of s.kw) { if (hay.includes(k)) score += 1; if (tl.includes(k)) score += 2 }
    if (score > best) { best = score; pick = i }
  })
  return pick >= 0 ? { name: SUBJECTS[pick].name, icon: SUBJECTS[pick].icon } : { name: 'General Knowledge', icon: 'ti-book-2' }
}
const mastery = (score: number) => score >= 30 ? 'Mastery' : score >= 16 ? 'Advanced' : score >= 8 ? 'Proficient' : score >= 3 ? 'Developing' : 'Intro'
const fmtDay = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export default function UniversityPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [userEmail, setUserEmail] = useState('')

  const [q, setQ] = useState('')
  const [answer, setAnswer] = useState('')
  const [sources, setSources] = useState<Source[]>([])
  const [asking, setAsking] = useState(false)

  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ title: '', content: '', category: 'General', tags: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function load() {
    setLoading(true)
    const { data } = await sb.from('university_entries').select('*').eq('is_active', true).order('created_at', { ascending: false })
    if (data) setRows(data as Entry[])
    setLoading(false)
  }
  useEffect(() => {
    load()
    sb.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email) })
  }, []) // eslint-disable-line

  const subjects = useMemo(() => {
    const m: Record<string, { name: string; icon: string; count: number; chars: number; doc: number; manual: number; knowledge: number; updated: number }> = {}
    for (const r of rows) {
      const s = classify(r.title, r.content, r.tags)
      if (!m[s.name]) m[s.name] = { name: s.name, icon: s.icon, count: 0, chars: 0, doc: 0, manual: 0, knowledge: 0, updated: 0 }
      const e = m[s.name]; e.count++; e.chars += (r.content || '').length
      if (r.source === 'document') e.doc++; else if (r.source === 'knowledge') e.knowledge++; else e.manual++
      const t = new Date(r.created_at).getTime(); if (t > e.updated) e.updated = t
    }
    return Object.values(m).map(e => ({ ...e, score: e.count + e.chars / 600 })).sort((a, b) => b.score - a.score)
  }, [rows])
  const maxScore = Math.max(1, ...subjects.map(s => s.score))
  const visible = subjects.filter(s => !search || s.name.toLowerCase().includes(search.toLowerCase()))
  const docCount = rows.filter(r => r.source === 'document').length
  const manualCount = rows.filter(r => r.source !== 'document').length

  async function ask(e?: React.FormEvent) {
    e?.preventDefault()
    if (!q.trim() || asking) return
    setAsking(true); setAnswer(''); setSources([])
    try {
      const res = await fetch('/api/university/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q }) })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Failed')
      setAnswer(j.answer || ''); setSources(j.sources || [])
    } catch (e2) { setAnswer('Error: ' + (e2 as Error).message) } finally { setAsking(false) }
  }

  async function saveEntry() {
    if (!form.title.trim() || !form.content.trim()) { setErr('Title and knowledge are required.'); return }
    setErr(''); setSaving(true)
    try {
      const res = await fetch('/api/university/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, created_by: userEmail }) })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Failed')
      setForm({ title: '', content: '', category: 'General', tags: '' }); setAdding(false); load()
    } catch (e) { setErr((e as Error).message) } finally { setSaving(false) }
  }

  const serif = { fontFamily: 'Georgia, "Times New Roman", serif' }

  return (
    <div className="p-4 md:p-8 min-h-screen">
      <div className="rounded-2xl p-6 mb-5 text-white relative overflow-hidden" style={{ background: 'linear-gradient(135deg,#2E2A6B 0%,#4F46E5 55%,#6D28D9 100%)' }}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="w-16 h-16 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(255,255,255,0.12)', border: '2px solid #C9A227' }}>
            <i className="ti ti-school text-3xl" style={{ color: '#F4D77E' }} />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold" style={{ color: '#E7C766', letterSpacing: '0.22em' }}>EST. 2026 &middot; SCIENTIA IN VIRIDITATE</p>
            <h1 className="text-2xl sm:text-3xl font-semibold leading-tight" style={serif}>beyondGREEN University</h1>
            <p className="text-sm text-white/70 mt-0.5">The collective intelligence of beyondGREEN &mdash; everything the company knows, organized into fields of study.</p>
          </div>
          <button onClick={() => setAdding(a => !a)} className="sm:ml-auto self-start flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors shrink-0" style={{ background: '#C9A227', color: '#231a00' }}>
            <i className={`ti ti-${adding ? 'x' : 'plus'}`} /> {adding ? 'Cancel' : 'Add Knowledge'}
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
          {[
            { l: 'Total credits', v: rows.length, i: 'ti-award' },
            { l: 'Departments', v: subjects.length, i: 'ti-building-bank' },
            { l: 'From documents', v: docCount, i: 'ti-files' },
            { l: 'Faculty notes', v: manualCount, i: 'ti-pencil' },
          ].map(s => (
            <div key={s.l} className="rounded-xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.10)' }}>
              <div className="flex items-center gap-2"><i className={`ti ${s.i}`} style={{ color: '#E7C766' }} /><span className="text-2xl font-bold leading-none">{loading ? '—' : s.v}</span></div>
              <p className="text-[11px] text-white/60 mt-1">{s.l}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-violet-500/30 bg-gradient-to-br from-violet-500/[0.08] to-transparent p-5 mb-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center"><i className="ti ti-sparkles text-white" /></div>
          <div>
            <p className="text-sm font-semibold text-[#1A1D2E]">Ask the University</p>
            <p className="text-xs text-gray-500">Everything beyondGREEN knows &mdash; pulled from documents and team knowledge.</p>
          </div>
        </div>
        <form onSubmit={ask} className="flex gap-2">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. What are our compostability certifications and who manufactures our cutlery?" className={inp} />
          <button type="submit" disabled={asking || !q.trim()} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors shrink-0">
            {asking ? <i className="ti ti-loader-2 animate-spin" /> : <i className="ti ti-search" />} Ask
          </button>
        </form>
        {answer && (
          <div className="bg-white border border-[#E4E6EE] rounded-lg px-4 py-3 mt-3">
            <p className="text-sm text-[#1A1D2E] whitespace-pre-wrap leading-relaxed">{answer}</p>
            {sources.length > 0 && (
              <div className="mt-3 pt-3 border-t border-[#E4E6EE] flex flex-wrap gap-1.5 items-center">
                <span className="text-xs text-gray-400 mr-1">Sources:</span>
                {sources.map(s => <span key={s.id} className="text-xs px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-600 border border-violet-500/20">{s.type}: {s.title}</span>)}
              </div>
            )}
          </div>
        )}
      </div>

      {adding && (
        <div className="rounded-xl border border-[#E4E6EE] bg-white p-5 mb-5 space-y-3">
          <p className="text-sm font-semibold text-[#1A1D2E]">Add to the University</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2"><label className="block text-xs text-gray-400 mb-1.5">Title <span className="text-red-400">*</span></label><input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} className={inp} placeholder="e.g. Soil control best practices for home composting" /></div>
            <div><label className="block text-xs text-gray-400 mb-1.5">Topic / tags</label><input value={form.tags} onChange={e => setForm(p => ({ ...p, tags: e.target.value }))} className={inp} placeholder="soil, compost" /></div>
          </div>
          <div><label className="block text-xs text-gray-400 mb-1.5">Knowledge <span className="text-red-400">*</span></label><textarea value={form.content} onChange={e => setForm(p => ({ ...p, content: e.target.value }))} rows={4} className={inp + ' resize-none'} placeholder="Write what the team should know. It is automatically filed into the right department and becomes searchable across the company." /></div>
          {err && <p className="text-xs text-red-500">{err}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className="text-sm px-4 py-2 rounded-lg border border-[#E4E6EE] text-gray-500 hover:text-gray-700">Cancel</button>
            <button onClick={saveEntry} disabled={saving} className="text-sm px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-medium">{saving ? 'Saving…' : 'Enroll Knowledge'}</button>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        <h2 className="text-lg font-semibold text-[#1A1D2E] flex items-center gap-2" style={serif}><i className="ti ti-books text-indigo-600" />Course Catalog</h2>
        <div className="relative w-full sm:max-w-xs">
          <i className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
          <input placeholder="Find a department…" value={search} onChange={e => setSearch(e.target.value)} className={inp + ' pl-9'} />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><i className="ti ti-loader-2 animate-spin text-gray-400 text-xl" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-[#E4E6EE] bg-white py-20 text-center">
          <i className="ti ti-school text-3xl text-gray-300" />
          <p className="text-gray-500 text-sm mt-2">No knowledge enrolled yet. Add knowledge or analyze documents to open the first department.</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-[#E4E6EE] bg-white py-16 text-center text-gray-400 text-sm">No departments match that search.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {visible.map(s => {
            const pct = Math.max(8, Math.round(s.score / maxScore * 100))
            const lvl = mastery(s.score)
            return (
              <div key={s.name} className="rounded-xl border border-[#E4E6EE] bg-white p-4 hover:border-indigo-300 transition-colors">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 text-white" style={{ background: 'linear-gradient(135deg,#4F46E5,#7C3AED)' }}><i className={`ti ${s.icon} text-xl`} /></div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#1A1D2E] truncate" style={serif}>{s.name}</p>
                    <p className="text-[11px] text-gray-400">{s.count} credit{s.count !== 1 ? 's' : ''} &middot; last studied {fmtDay(s.updated)}</p>
                  </div>
                  <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full shrink-0" style={{ background: 'rgba(201,162,39,0.12)', color: '#8A6D12', border: '1px solid rgba(201,162,39,0.35)' }}>{lvl}</span>
                </div>
                <div className="h-3 rounded-full overflow-hidden" style={{ background: '#EEEDF6' }}>
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: pct + '%', background: 'linear-gradient(90deg,#6366F1,#8B5CF6,#A78BFA)' }} />
                </div>
                <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-400 flex-wrap">
                  {s.doc > 0 && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-violet-500" />{s.doc} from documents</span>}
                  {s.manual > 0 && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />{s.manual} note{s.manual !== 1 ? 's' : ''}</span>}
                  {s.knowledge > 0 && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-teal-500" />{s.knowledge} learned</span>}
                  <span className="ml-auto font-semibold" style={{ color: '#7C3AED' }}>{pct}% mastery</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
