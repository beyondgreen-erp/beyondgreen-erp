'use client'
import ShareLink from '@/components/ShareLink'
import { useItemDeepLink } from '@/components/useItemDeepLink'
export const dynamic = 'force-dynamic'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Line { id: string; name: string | null; sku: string | null; quantity: number | null }
interface Sample {
  id: string; name: string | null; requesting_facility: string | null; requestor: string | null; customer_email: string | null
  customer_type: string | null; product: string | null; status: string | null; ship_due_date: string | null; sample_date: string | null
  ship_cost: number | null; shipped_via: string | null; tracking_number: string | null; ship_to_address: string | null; group_name: string | null
}
const fmtD = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const sc = (s: string | null) => /sent|ship|complet|done|deliver/i.test(s || '') ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : /hold|cancel|reject/i.test(s || '') ? 'bg-red-50 text-red-700 border-red-200' : /progress|prep|work|request/i.test(s || '') ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-gray-50 text-gray-600 border-gray-200'

export default function SamplesPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<Sample[]>([])
  useItemDeepLink(rows, (r) => toggle(r.id))
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('All')
  const [open, setOpen] = useState<string | null>(null)
  const [lines, setLines] = useState<Record<string, Line[]>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await sb.from('sample_submissions').select('*').order('sample_date', { ascending: false, nullsFirst: false })
    setRows((data as Sample[]) || [])
    setLoading(false)
  }, [sb])
  useEffect(() => { load() }, [load])

  async function toggle(id: string) {
    if (open === id) { setOpen(null); return }
    setOpen(id)
    if (!lines[id]) {
      const { data } = await sb.from('sample_submission_lines').select('id,name,sku,quantity').eq('sample_id', id).order('line_number')
      setLines(m => ({ ...m, [id]: (data as Line[]) || [] }))
    }
  }

  const statuses = ['All', ...Array.from(new Set(rows.map(r => r.status).filter(Boolean) as string[]))].slice(0, 14)
  const filtered = rows.filter(r => {
    if (status !== 'All' && r.status !== status) return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (r.name || '').toLowerCase().includes(q) || (r.customer_email || '').toLowerCase().includes(q) || (r.product || '').toLowerCase().includes(q) || (r.requestor || '').toLowerCase().includes(q)
  })

  return (
    <div className="min-h-screen p-8" style={{ background: '#F5F6FA' }}>
      <p className="text-xs font-semibold text-pink-600 uppercase tracking-widest mb-1">SAMPLES</p>
      <h1 className="text-3xl font-bold text-gray-900 mb-1">Sample Submissions</h1>
      <p className="text-gray-500 text-sm mb-6">{loading ? 'Loading…' : `${filtered.length} submission${filtered.length !== 1 ? 's' : ''}`}</p>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          <input placeholder="Search name, customer, product…" value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"/>
        </div>
        <select value={status} onChange={e => setStatus(e.target.value)} className="bg-white border border-[#E4E6EE] text-[#1A1D2E] rounded-lg px-3 py-2.5 text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500">
          {statuses.map(s => <option key={s} value={s}>{s === 'All' ? 'All Statuses' : s}</option>)}
        </select>
      </div>

      <div className="rounded-xl overflow-x-auto bg-white" style={{ border: '1px solid #E4E6EE' }}>
        {loading ? <div className="flex items-center justify-center py-20"><svg className="w-5 h-5 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div>
        : filtered.length === 0 ? <div className="text-center py-20 text-gray-400 text-sm">No submissions.</div>
        : <table className="w-full min-w-[820px] text-sm">
            <thead><tr className="border-b border-[#E4E6EE]">{['', 'Name', 'Status', 'Customer', 'Product', 'Requestor', 'Sample Date', 'Ship Due'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 px-4 py-3">{h}</th>)}</tr></thead>
            <tbody>
              {filtered.map((r, i) => {
                const isOpen = open === r.id
                const ls = lines[r.id]
                return (
                  <Fragment key={r.id}>
                    <tr id={'item-' + r.id} onClick={() => toggle(r.id)} className={`border-b border-[#F3F4F6] cursor-pointer hover:bg-[#F9FAFB] transition-colors ${i % 2 ? 'bg-[#FAFAFA]' : ''}`}>
                      <td className="px-4 py-3 text-gray-400"><svg className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg></td>
                      <td className="px-4 py-3 text-gray-800 font-medium">{r.name || '—'}</td>
                      <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded-full font-medium border ${sc(r.status)}`}>{r.status || '—'}</span></td>
                      <td className="px-4 py-3 text-gray-500">{r.customer_email || '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{r.product || '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{r.requestor || '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{fmtD(r.sample_date)}</td>
                      <td className="px-4 py-3 text-gray-500">{fmtD(r.ship_due_date)}</td>
                    </tr>
                    {isOpen && (
                      <tr key={r.id + '-d'} className="bg-[#F9FAFB]">
                        <td colSpan={8} className="px-8 py-3"><div className="mb-2" onClick={e => e.stopPropagation()}><ShareLink id={r.id} /></div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-xs mb-3">
                            <div><span className="text-gray-400">Facility: </span><span className="text-gray-700">{r.requesting_facility || '—'}</span></div>
                            <div><span className="text-gray-400">Type: </span><span className="text-gray-700">{r.customer_type || '—'}</span></div>
                            <div><span className="text-gray-400">Via: </span><span className="text-gray-700">{r.shipped_via || '—'}</span></div>
                            <div><span className="text-gray-400">Tracking: </span><span className="text-gray-700 font-mono">{r.tracking_number || '—'}</span></div>
                            <div className="col-span-2 md:col-span-4"><span className="text-gray-400">Ship To: </span><span className="text-gray-700">{r.ship_to_address || '—'}</span></div>
                          </div>
                          {ls == null ? <p className="text-xs text-gray-400">Loading items…</p>
                          : ls.length === 0 ? <p className="text-xs text-gray-400">No sample items.</p>
                          : <table className="w-full text-xs"><thead><tr className="text-gray-400"><th className="text-left py-1">Item</th><th className="text-left py-1">SKU</th><th className="text-right py-1">Qty</th></tr></thead>
                              <tbody>{ls.map(ln => <tr key={ln.id} className="border-t border-[#EEF0F5]"><td className="py-1.5 text-gray-700">{ln.name || '—'}</td><td className="py-1.5 font-mono text-emerald-600">{ln.sku || '—'}</td><td className="py-1.5 text-right text-gray-600">{ln.quantity ?? '—'}</td></tr>)}</tbody></table>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>}
      </div>
    </div>
  )
}
