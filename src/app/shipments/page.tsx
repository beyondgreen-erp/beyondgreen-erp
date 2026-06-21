'use client'
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Shipment {
  id: string
  external_id: string | null
  shipment_number: number | null
  customer_name: string | null
  customer_email: string | null
  po_number: string | null
  facility: string | null
  delivery_status: string | null
  ship_date: string | null
  order_date: string | null
  carrier: string | null
  tracking_number: string | null
  ship_to_address: string | null
  ship_cost: number | null
  total_value: number | null
  bol_number: string | null
  invoice_number: string | null
  month_group: string | null
}

const PAGE = 50
const STATUSES = ['All', 'Shipped', 'Delivered', 'Will Call Pick-Up', 'Customer Canceled']
const SC: Record<string, string> = {
  Shipped: 'bg-blue-50 text-blue-700 border-blue-200',
  Delivered: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Will Call Pick-Up': 'bg-amber-50 text-amber-700 border-amber-200',
  'Customer Canceled': 'bg-red-50 text-red-700 border-red-200',
}
const fmtD = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const fmt$ = (n: number | null) => n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

export default function ShipmentsPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<Shipment[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('All')
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState<{ total: number; shipped: number; delivered: number; value: number }>({ total: 0, shipped: 0, delivered: 0, value: 0 })

  const load = useCallback(async () => {
    setLoading(true)
    let q = sb.from('shipments').select('*', { count: 'exact' })
    if (status !== 'All') q = q.eq('delivery_status', status)
    if (search.trim()) {
      const s = search.trim().replace(/[%,]/g, ' ')
      q = q.or(`customer_name.ilike.%${s}%,po_number.ilike.%${s}%,external_id.ilike.%${s}%,tracking_number.ilike.%${s}%`)
    }
    const { data, count } = await q
      .order('ship_date', { ascending: false, nullsFirst: false })
      .range(page * PAGE, page * PAGE + PAGE - 1)
    setRows((data as Shipment[]) || [])
    setTotal(count || 0)
    setLoading(false)
  }, [sb, status, search, page])

  useEffect(() => { load() }, [load])

  // Summary across the whole table (not just the page)
  useEffect(() => {
    (async () => {
      const [t, sh, de] = await Promise.all([
        sb.from('shipments').select('id', { count: 'exact', head: true }),
        sb.from('shipments').select('id', { count: 'exact', head: true }).eq('delivery_status', 'Shipped'),
        sb.from('shipments').select('id', { count: 'exact', head: true }).eq('delivery_status', 'Delivered'),
      ])
      setCounts(c => ({ ...c, total: t.count || 0, shipped: sh.count || 0, delivered: de.count || 0 }))
    })()
  }, [sb])

  const pages = Math.max(1, Math.ceil(total / PAGE))

  return (
    <div className="min-h-screen p-8" style={{ background: '#F5F6FA' }}>
      <p className="text-xs font-semibold text-emerald-600 uppercase tracking-widest mb-1">FULFILLMENT</p>
      <h1 className="text-3xl font-bold text-gray-900 mb-1">Shipments</h1>
      <p className="text-gray-500 text-sm mb-6">{loading ? 'Loading…' : `${total.toLocaleString()} shipment${total !== 1 ? 's' : ''}${status !== 'All' ? ` · ${status}` : ''}`}</p>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Shipments', count: counts.total.toLocaleString(), cls: 'bg-white border-gray-200 text-gray-800' },
          { label: 'Shipped', count: counts.shipped.toLocaleString(), cls: 'bg-blue-50 border-blue-200 text-blue-700' },
          { label: 'Delivered', count: counts.delivered.toLocaleString(), cls: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl border p-5 ${s.cls}`}>
            <p className="text-sm font-medium opacity-80">{s.label}</p>
            <p className="text-3xl font-bold mt-1">{s.count}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          <input placeholder="Search customer, PO, tracking…" value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }}
            className="w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"/>
        </div>
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(0) }}
          className="bg-white border border-[#E4E6EE] text-[#1A1D2E] rounded-lg px-3 py-2.5 text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500">
          {STATUSES.map(s => <option key={s} value={s}>{s === 'All' ? 'All Statuses' : s}</option>)}
        </select>
      </div>

      <div className="rounded-xl overflow-x-auto bg-white" style={{ border: '1px solid #E4E6EE' }}>
        {loading ? (
          <div className="flex items-center justify-center py-20"><svg className="w-5 h-5 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div>
        ) : rows.length === 0 ? (
          <div className="text-center py-20 text-gray-400 text-sm">No shipments match.</div>
        ) : (
          <table className="w-full min-w-[820px] text-sm">
            <thead><tr className="border-b border-[#E4E6EE]">{['Ship ID', 'Customer', 'PO #', 'Ship Date', 'Carrier', 'Tracking', 'Status', 'Value'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 px-4 py-3">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className={`border-b border-[#F3F4F6] last:border-0 hover:bg-[#F9FAFB] transition-colors ${i % 2 ? 'bg-[#FAFAFA]' : ''}`}>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{r.external_id || (r.shipment_number != null ? `#${r.shipment_number}` : '—')}</td>
                  <td className="px-4 py-3 text-gray-800 font-medium">{r.customer_name || '—'}<div className="text-xs text-gray-400 font-normal">{r.facility || ''}</div></td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{r.po_number || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{fmtD(r.ship_date)}</td>
                  <td className="px-4 py-3 text-gray-500">{r.carrier || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{r.tracking_number || '—'}</td>
                  <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded-full font-medium border ${SC[r.delivery_status || ''] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>{r.delivery_status || '—'}</span></td>
                  <td className="px-4 py-3 text-gray-700 font-medium">{fmt$(r.total_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-gray-500">Page {page + 1} of {pages.toLocaleString()}</p>
          <div className="flex gap-2">
            <button disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))} className="text-sm px-3 py-1.5 rounded-lg border border-[#E4E6EE] bg-white text-gray-600 disabled:opacity-40 hover:bg-[#F5F6FA] transition-colors">Previous</button>
            <button disabled={page >= pages - 1} onClick={() => setPage(p => Math.min(pages - 1, p + 1))} className="text-sm px-3 py-1.5 rounded-lg border border-[#E4E6EE] bg-white text-gray-600 disabled:opacity-40 hover:bg-[#F5F6FA] transition-colors">Next</button>
          </div>
        </div>
      )}
    </div>
  )
}
