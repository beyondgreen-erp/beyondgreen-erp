'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const CATEGORIES = ['Company Info', 'Products', 'Customers', 'Pricing', 'Processes', 'Certifications', 'Vendors', 'Other']

const DEFAULT_FACTS = [
  { category: 'Company Info', fact: 'beyondGREEN is a sustainable products company focused on eco-friendly and biotech packaging solutions.' },
  { category: 'Company Info', fact: 'beyondGREEN ERP manages production, sales, inventory, customers, vendors, certifications and business development across 17 modules.' },
  { category: 'Company Info', fact: 'beyondGREEN operates in the biotech and green packaging industry, providing sustainable alternatives to conventional packaging.' },
  { category: 'Processes', fact: 'The sales process at beyondGREEN goes: Quote → Sales Order → Work Order → Production → Shipping → Invoice.' },
  { category: 'Processes', fact: 'Purchase orders are created when inventory falls below the reorder point for a product.' },
  { category: 'Processes', fact: 'All certifications must be reviewed and renewed 90 days before expiry to ensure continuous compliance.' },
  { category: 'Processes', fact: 'Work orders link sales orders to production jobs and track machines, quantities, and completion status.' },
  { category: 'Products', fact: 'Products in the ERP track SKU, name, category, unit of measure, on-hand quantity, reorder point, unit cost, and unit price.' },
  { category: 'Vendors', fact: 'Vendors are tracked with company name, contact, lead times, and payment terms to support purchase order management.' },
]

interface Fact { id: string; category: string; fact: string; created_at: string }

export default function BergBrainPage() {
  const sb = createSupabaseBrowserClient()
  const [category, setCategory] = useState('Company Info')
  const [factText, setFactText] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(null)
  const [facts, setFacts] = useState<Fact[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [seeding, setSeeding] = useState(false)
  const PER_PAGE = 20

  useEffect(() => { loadFacts() }, [page]) // eslint-disable-line

  async function loadFacts() {
    setLoading(true)
    const from = page * PER_PAGE
    const to = from + PER_PAGE - 1
    const { data, count } = await sb
      .from('berg_company_facts')
      .select('id, category, fact, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to)
    setFacts(data ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }

  async function saveFact() {
    if (!factText.trim()) return
    setSaving(true)
    setNotice(null)
    try {
      const res = await fetch('/api/berg/brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, fact: factText.trim() }),
      })
      if (!res.ok) throw new Error(await res.text())
      setFactText('')
      setNotice({ ok: true, msg: 'Saved to BERG\'s brain.' })
      setPage(0)
      loadFacts()
    } catch (e) {
      setNotice({ ok: false, msg: String(e) })
    }
    setSaving(false)
  }

  async function seedDefaults() {
    setSeeding(true)
    setNotice(null)
    try {
      for (const { category: cat, fact } of DEFAULT_FACTS) {
        await fetch('/api/berg/brain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category: cat, fact }),
        })
      }
      setNotice({ ok: true, msg: `${DEFAULT_FACTS.length} default facts loaded into BERG's brain.` })
      setPage(0)
      loadFacts()
    } catch (e) {
      setNotice({ ok: false, msg: String(e) })
    }
    setSeeding(false)
  }

  async function deleteFact(id: string) {
    await sb.from('berg_company_facts').delete().eq('id', id)
    loadFacts()
  }

  const totalPages = Math.ceil(total / PER_PAGE)
  const inp = 'w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition'

  return (
    <div className="p-4 md:p-8 min-h-screen max-w-4xl mx-auto">
      <div className="mb-8">
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-emerald-500/20 text-emerald-300 border-emerald-500/30">SETTINGS</span>
        <h1 className="text-2xl font-semibold text-white mt-1">BERG Knowledge Base</h1>
        <p className="text-gray-500 text-sm mt-0.5">Teach BERG everything about beyondGREEN</p>
      </div>

      {/* Add a fact */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
        <h2 className="text-white font-semibold mb-4">Add a Fact</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Category</label>
            <select value={category} onChange={e => setCategory(e.target.value)} className={inp + ' cursor-pointer'}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Fact</label>
            <textarea
              rows={3}
              value={factText}
              onChange={e => setFactText(e.target.value)}
              placeholder="Type anything you want BERG to know about beyondGREEN…"
              className={inp + ' resize-none'}
            />
          </div>
          {notice && (
            <div className={`text-xs px-3 py-2.5 rounded-lg border ${notice.ok ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
              {notice.msg}
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={saveFact}
              disabled={saving || !factText.trim()}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-900 disabled:text-emerald-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
            >
              {saving ? 'Saving…' : 'Save to BERG\'s brain'}
            </button>
            <button
              onClick={seedDefaults}
              disabled={seeding}
              className="flex items-center gap-2 border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white text-sm px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {seeding ? 'Loading…' : 'Load Default Knowledge'}
            </button>
          </div>
        </div>
      </div>

      {/* Knowledge overview */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-white font-semibold">Current Knowledge</h2>
          <span className="text-gray-500 text-sm">{total} fact{total !== 1 ? 's' : ''}</span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <svg className="w-5 h-5 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          </div>
        ) : facts.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-gray-500 text-sm">No facts yet. Add one above or load the defaults.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  {['Category', 'Fact', 'Added', ''].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-500 px-5 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {facts.map((f, i) => (
                  <tr key={f.id} className={`border-b border-gray-800/60 last:border-0 ${i % 2 === 0 ? '' : 'bg-gray-800/10'}`}>
                    <td className="px-5 py-3 text-emerald-400 text-xs font-medium whitespace-nowrap">{f.category}</td>
                    <td className="px-5 py-3 text-gray-300 max-w-md truncate">{f.fact}</td>
                    <td className="px-5 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {new Date(f.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="px-5 py-3">
                      <button
                        onClick={() => deleteFact(f.id)}
                        className="text-gray-600 hover:text-red-400 transition-colors text-xs"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-800">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="text-sm text-gray-400 hover:text-white disabled:opacity-30 transition-colors"
            >← Prev</button>
            <span className="text-gray-500 text-xs">Page {page + 1} of {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="text-sm text-gray-400 hover:text-white disabled:opacity-30 transition-colors"
            >Next →</button>
          </div>
        )}
      </div>

      {/* Document upload placeholder */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 opacity-50 cursor-not-allowed">
        <h2 className="text-white font-semibold mb-2">Document Upload <span className="text-xs text-gray-500 font-normal ml-2">Phase 2</span></h2>
        <p className="text-gray-500 text-sm">Upload PDFs, SOPs, pricing guides and BERG will learn from them. Coming soon.</p>
      </div>
    </div>
  )
}
