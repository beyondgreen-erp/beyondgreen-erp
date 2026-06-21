'use client'
export const dynamic = 'force-dynamic'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Line { id: string; pls_id: string; sku: string | null; quantity: number | null; cost_each: number | null; completed_qty: number | null; unit_of_measure: string | null; production_status: string | null; sku_flagged: boolean | null }
interface Stock {
  id: string; order_number: string | null; status: string | null; order_date: string | null; ship_due_date: string | null
  po_number: string | null; customer_email: string | null; ship_to_address: string | null; group_name: string | null; notes: string | null
}
const fmtD = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const fmt$ = (n: number | null) => n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
const sc = (s: string | null) => /complet|done|ship/i.test(s || '') ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : /hold|cancel/i.test(s || '') ? 'bg-red-50 text-red-700 border-red-200' : 'bg-blue-50 text-blue-700 border-blue-200'

export default function PrivateLabelStockPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<Stock[]>([])
  const [lines, setLines] = useState<Record<string, Line[]>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: s }, { data: l }] = await Promise.all([
      sb.from('private_label_stock').select('*').order('order_date', { ascending: false, nullsFirst: false }),
      sb.from('private_label_stock_lines').select('*').order('line_number'),
    ])
    setRows((s as Stock[]) || [])
    const map: Record<string, Line[]> = {}
    for (const ln of (l as Line[]) || []) { (map[ln.pls_id] ||= []).push(ln) }
    setLines(map)
    setLoading(false)
  }, [sb])
  useEffect(() => { load() }, [load])

  const filtered = rows.filter(r => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (r.order_number || '').toLowerCase().includes(q) || (r.customer_email || '').toLowerCase().includes(q) || (r.po_number || '').toLowerCase().includes(q) || (r.status || '').toLowerCase().includes(q)
  })

  return (
    <div className="min-h-screen p-8" style={{ background: '#F5F6FA' }}>
      <p className="text-xs font-semibold text-violet-600 uppercase tracking-widest mb-1">INVENTORY</p>
      <h1 className="text-3xl font-bold text-gray-900 mb-1">Private Label Stock</h1>
      <p className="text-gray-500 text-sm mb-6">{loading ? 'Loading…' : `${filtered.length} stock order${filtered.length !== 1 ? 's' : ''}`}</p>

      <div className="relative flex-1 max-w-sm mb-4">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        <input placeholder="Search order, customer, PO…" value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"/>
      </div>

      <div className="rounded-xl overflow-x-auto bg-white" style={{ border: '1px solid #E4E6EE' }}>
        {loading ? <div className="flex items-center justify-center py-20"><svg className="w-5 h-5 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div>
        : filtered.length === 0 ? <div className="text-center py-20 text-gray-400 text-sm">No stock orders.</div>
        : <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="border-b border-[#E4E6EE]">{['', 'Order #', 'Status', 'Customer', 'Order Date', 'Ship Due', 'PO #', 'Items'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 px-4 py-3">{h}</th>)}</tr></thead>
            <tbody>
              {filtered.map((r, i) => {
                const ls = lines[r.id] || []
                const isOpen = open === r.id
                return (
                  <Fragment key={r.id}>
                    <tr onClick={() => setOpen(isOpen ? null : r.id)} className={`border-b border-[#F3F4F6] cursor-pointer hover:bg-[#F9FAFB] transition-colors ${i % 2 ? 'bg-[#FAFAFA]' : ''}`}>
                      <td className="px-4 py-3 text-gray-400"><svg className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg></td>
                      <td className="px-4 py-3 text-gray-800 font-medium">{r.order_number || '—'}</td>
                      <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded-full font-medium border ${sc(r.status)}`}>{r.status || '—'}</span></td>
                      <td className="px-4 py-3 text-gray-500">{r.customer_email || '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{fmtD(r.order_date)}</td>
                      <td className="px-4 py-3 text-gray-500">{fmtD(r.ship_due_date)}</td>
                      <td className="px-4 py-3 text-gray-500 font-mono text-xs">{r.po_number || '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{ls.length}</td>
                    </tr>
                    {isOpen && (
                      <tr key={r.id + '-d'} className="bg-[#F9FAFB]">
                        <td colSpan={8} className="px-8 py-3">
                          {ls.length === 0 ? <p className="text-xs text-gray-400">No line items.</p> : (
                            <table className="w-full text-xs">
                              <thead><tr className="text-gray-400"><th className="text-left py-1">SKU</th><th className="text-right py-1">Qty</th><th className="text-right py-1">Done</th><th className="text-right py-1">Cost</th><th className="text-left py-1 pl-4">Prod. Status</th></tr></thead>
                              <tbody>{ls.map(ln => <tr key={ln.id} className="border-t border-[#EEF0F5]"><td className={`py-1.5 font-mono ${ln.sku_flagged ? 'text-amber-600' : 'text-emerald-600'}`}>{ln.sku || '—'}{ln.sku_flagged ? ' ⚠' : ''}</td><td className="py-1.5 text-right text-gray-600">{ln.quantity ?? '—'}</td><td className="py-1.5 text-right text-gray-600">{ln.completed_qty ?? '—'}</td><td className="py-1.5 text-right text-gray-600">{fmt$(ln.cost_each)}</td><td className="py-1.5 pl-4 text-gray-600">{ln.production_status || '—'}</td></tr>)}</tbody>
                            </table>
                          )}
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
