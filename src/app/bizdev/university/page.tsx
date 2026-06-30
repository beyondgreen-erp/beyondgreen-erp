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

const knowLevel = (n: number) => n >= 26 ? 'Expert' : n >= 13 ? 'Deep' : n >= 6 ? 'Solid' : n >= 3 ? 'Growing' : 'Sparse'
function catIcon(c: string): string {
  const k = (c || '').toLowerCase()
  if (/cert|complian/.test(k)) return 'ti-rosette'
  if (/contract|legal|agree/.test(k)) return 'ti-file-certificate'
  if (/spec|product|sku|cutlery|cup|straw/.test(k)) return 'ti-box'
  if (/sds|safety|chem|material/.test(k)) return 'ti-flask'
  if (/quality|qc|test/.test(k)) return 'ti-checkup-list'
  if (/draw|design|art/.test(k)) return 'ti-ruler-2'
  if (/policy|sop|procedure|process/.test(k)) return 'ti-clipboard-text'
  if (/customer|sales|client/.test(k)) return 'ti-users'
  if (/vendor|supplier|manufactur/.test(k)) return 'ti-building-store'
  if (/ship|logist|freight|deliver/.test(k)) return 'ti-truck'
  if (/produc|capacity|machine|lot/.test(k)) return 'ti-building-factory-2'
  if (/finance|invoice|cost|price/.test(k)) return 'ti-receipt'
  return 'ti-book'
}

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

  const cats = useMemo(() => {
    const m: Record<string, { category: string; count: number; chars: number; doc: number; manual: number; knowledge: number; updated: number }> = {}
    for (const r of rows) {
      const c = r.category || 'General'
      if (!m[c]) m[c] = { category: c, count: 0, chars: 0, doc: 0, manual: 0, knowledge: 0, updated: 0 }
      const e = m[c]; e.count++; e.chars += (r.content || '').length
      if (r.source === 'document') e.doc++; else if (r.source === 'knowledge') e.knowledge++; else e.manual++
      const t = new Date(r.created_at).getTime(); if (t > e.updated) e.updated = t
    }
    return Object.values(m).map(e => ({ ...e, score: e.count + e.chars / 600 })).sort((a, b) => b.score - a.score)
  }, [rows])
  const maxScore = Math.max(1, ...cats.map(c => c.score))
  const visibleCats = cats.filter(c => !search || c.category.toLowerCase().includes(search.toLowerCase()))

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

  const docCount = rows.filter(r => r.source === 'document').length
  const manualCount = rows.filter(r => r.source === 'manual').length

  return (
    <div className="p-4 md:p-8 min-h-screen">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-violet-500/20 text-violet-700 border-violet-500/30">KNOWLEDGE</span>
          <h1 className="text-2xl font-semibold text-[#1A1D2E] mt-1 flex items-center gap-2"><i className="ti ti-school text-violet-600" /> beyondGREEN University</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${rows.length} knowledge entr${rows.length !== 1 ? 'ies' : 'y'} · ${docCount} from documents · ${manualCount} added by team`}</p>
        </div>
        <button onClick={() => setAdding(a => !a)} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors shrink-0">
          <i className={`ti ti-${adding ? 'x' : 'plus'}`} /> {adding ? 'Cancel' : 'Add Knowledge'}
        </button>
      </div>

      <div className="rounded-xl border border-violet-500/30 bg-gradient-to-br from-violet-500/[0.08] to-transparent p-5 mb-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center"><i className="ti ti-sparkles text-white" /></div>
          <div>
            <p className="text-sm font-semibold text-[#1A1D2E]">Ask the University</p>
            <p className="text-xs text-gray-500">Everything beyondGREEN knows — pulled from documents and team knowledge.</p>
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
            <div className="sm:col-span-2"><label className="block text-xs text-gray-400 mb-1.5">Title <span className="text-red-400">*</span></label><input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} className={inp} placeholder="e.g. Standard lead times for PLA cutlery" /></div>
            <div><label className="block text-xs text-gray-400 mb-1.5">Category</label><input value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} className={inp} placeholder="General" /></div>
          </div>
          <div><label className="block text-xs text-gray-400 mb-1.5">Knowledge <span className="text-red-400">*</span></label><textarea value={form.content} onChange={e => setForm(p => ({ ...p, content: e.target.value }))} rows={4} className={inp + ' resize-none'} placeholder="Write what the team should know. This becomes searchable and feeds answers across the company." /></div>
          <div><label className="block text-xs text-gray-400 mb-1.5">Tags</label><input value={form.tags} onChange={e => setForm(p => ({ ...p, tags: e.target.value }))} className={inp} placeholder="comma, separated, optional" /></div>
          {err && <p className="text-xs text-red-500">{err}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className="text-sm px-4 py-2 rounded-lg border border-[#E4E6EE] text-gray-500 hover:text-gray-700">Cancel</button>
            <button onClick={saveEntry} disabled={saving} className="text-sm px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-medium">{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}

      <div className="relative max-w-sm mb-4">
        <i className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
        <input placeholder="Filter categories…" value={search} onChange={e => setSearch(e.target.value)} className={inp + ' pl-9'} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><i className="ti ti-loader-2 animate-spin text-gray-400 text-xl" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-[#E4E6EE] bg-white py-20 text-center">
          <i className="ti ti-school text-3xl text-gray-300" />
          <p className="text-gray-500 text-sm mt-2">The University is empty. Add knowledge or analyze documents to fill it.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {[
              { label: 'Knowledge entries', value: rows.length, icon: 'ti-book' },
              { label: 'Categories known', value: cats.length, icon: 'ti-category-2' },
              { label: 'From documents', value: docCount, icon: 'ti-files' },
              { label: 'Added by team', value: manualCount, icon: 'ti-user-plus' },
            ].map(s2 => (
              <div key={s2.label} className="rounded-xl border border-[#E4E6EE] bg-white p-4">
                <div className="flex items-center gap-2 text-violet-500 mb-0.5"><i className={`ti ${s2.icon}`} /><span className="text-2xl font-bold text-[#1A1D2E]">{s2.value}</span></div>
                <p className="text-xs text-gray-500">{s2.label}</p>
              </div>
            ))}
          </div>
          <p className="text-sm font-semibold text-[#1A1D2E] mb-3 flex items-center gap-2"><i className="ti ti-chart-bar text-violet-600" />How much the University knows by category</p>
          <div className="rounded-xl border border-[#E4E6EE] bg-white p-5 space-y-4">
            {visibleCats.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No categories match.</p>
            ) : visibleCats.map(c => {
              const pct = Math.max(6, Math.round(c.score / maxScore * 100))
              return (
                <div key={c.category}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="w-7 h-7 rounded-lg bg-violet-500/10 text-violet-600 flex items-center justify-center shrink-0"><i className={`ti ${catIcon(c.category)} text-sm`} /></span>
                    <span className="text-sm font-medium text-[#1A1D2E]">{c.category}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-600 border border-violet-500/20">{knowLevel(c.count)}</span>
                    <span className="text-xs text-gray-400 ml-auto">{c.count} entr{c.count !== 1 ? 'ies' : 'y'}</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-[#F1F0F8] overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: pct + '%', background: 'linear-gradient(90deg,#a78bfa,#7c3aed)' }} />
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-400 flex-wrap">
                    {c.doc > 0 && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-violet-500" />{c.doc} from documents</span>}
                    {c.manual > 0 && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-500" />{c.manual} added by team</span>}
                    {c.knowledge > 0 && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-teal-500" />{c.knowledge} learned</span>}
                    <span className="ml-auto">updated {new Date(c.updated).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
