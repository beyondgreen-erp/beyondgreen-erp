'use client'
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Fba {
  id: string; name: string | null; channel: string | null; status: string | null; ship_date: string | null
  inbound_shipment_id: string | null; quantity_requested: number | null; quantity_shipped: number | null; comments: string | null
}
const fmtD = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const num = (n: number | null) => n == null ? '—' : n.toLocaleString()
const sc = (s: string | null) => /receiv|closed|deliver|complet/i.test(s || '') ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : /transit|shipped|working/i.test(s || '') ? 'bg-blue-50 text-blue-700 border-blue-200' : /hold|cancel|problem|delay/i.test(s || '') ? 'bg-red-50 text-red-700 border-red-200' : 'bg-gray-50 text-gray-600 border-gray-200'

export default function FbaPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<Fba[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [channel, setChannel] = useState('All')

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await sb.from('fba_shipments').select('*').order('ship_date', { ascending: false, nullsFirst: false })
    setRows((data as Fba[]) || [])
    setLoading(false)
  }, [sb])
  useEffect(() => { load() }, [load])

  const channels = ['All', ...Array.from(new Set(rows.map(r => r.channel).filter(Boolean) as string[]))]
  const filtered = rows.filter(r => {
    if (channel !== 'All' && r.channel !== channel) return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (r.name || '').toLowerCase().includes(q) || (r.inbound_shipment_id || '').toLowerCase().includes(q) || (r.status || '').toLowerCase().includes(q)
  })
  const totReq = filtered.reduce((a, r) => a + (r.quantity_requested || 0), 0)
  const totShip = filtered.reduce((a, r) => a + (r.quantity_shipped || 0), 0)

  return (
    <div className="min-h-screen p-8" style={{ background: '#F5F6FA' }}>
      <p className="text-xs font-semibold text-orange-600 uppercase tracking-widest mb-1">FULFILLMENT</p>
      <h1 className="text-3xl font-bold text-gray-900 mb-1">FBA / WFS Shipments</h1>
      <p className="text-gray-500 text-sm mb-6">{loading ? 'Loading…' : `${filtered.length} shipment${filtered.length !== 1 ? 's' : ''} · ${totShip.toLocaleString()} / ${totReq.toLocaleString()} units shipped`}</p>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          <input placeholder="Search name, shipment ID…" value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"/>
        </div>
        {channels.length > 2 && (
          <select value={channel} onChange={e => setChannel(e.target.value)} className="bg-white border border-[#E4E6EE] text-[#1A1D2E] rounded-lg px-3 py-2.5 text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500">
            {channels.map(c => <option key={c} value={c}>{c === 'All' ? 'All Channels' : c}</option>)}
          </select>
        )}
      </div>

      <div className="rounded-xl overflow-x-auto bg-white" style={{ border: '1px solid #E4E6EE' }}>
        {loading ? <div className="flex items-center justify-center py-20"><svg className="w-5 h-5 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div>
        : filtered.length === 0 ? <div className="text-center py-20 text-gray-400 text-sm">No shipments.</div>
        : <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="border-b border-[#E4E6EE]">{['Name', 'Channel', 'Status', 'Ship Date', 'Inbound ID', 'Requested', 'Shipped'].map(h => <th key={h} className="text-left text-xs font-semibold text-gray-500 px-4 py-3">{h}</th>)}</tr></thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={r.id} className={`border-b border-[#F3F4F6] last:border-0 hover:bg-[#F9FAFB] transition-colors ${i % 2 ? 'bg-[#FAFAFA]' : ''}`}>
                  <td className="px-4 py-3 text-gray-800 font-medium">{r.name || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{r.channel || '—'}</td>
                  <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded-full font-medium border ${sc(r.status)}`}>{r.status || '—'}</span></td>
                  <td className="px-4 py-3 text-gray-500">{fmtD(r.ship_date)}</td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{r.inbound_shipment_id || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{num(r.quantity_requested)}</td>
                  <td className="px-4 py-3 text-gray-700 font-medium">{num(r.quantity_shipped)}</td>
                </tr>
              ))}
            </tbody>
          </table>}
      </div>
    </div>
  )
}
