'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Mv { id: string; product_id: string | null; sku: string | null; movement_type: string; qty: number; uom: string | null; lot_number: string | null; pack_qty: number | null; ref_table: string | null; created_by: string | null; created_at: string; name?: string }

const TYPES = [
  { key: 'all', label: 'All' },
  { key: 'receive', label: 'Receiving' },
  { key: 'produce', label: 'Production' },
  { key: 'consume', label: 'BOM used' },
  { key: 'adjust', label: 'Adjustments' },
]
const typeStyle = (t: string): { bg: string; c: string } =>
  t === 'receive' ? { bg: '#DDF3E8', c: '#0F7A4E' }
    : t === 'produce' ? { bg: '#F3E8FF', c: '#7A3FB0' }
    : t === 'consume' ? { bg: '#FBE9E9', c: '#B3261E' }
    : { bg: '#EEF2FB', c: '#3A4A6B' }

export default function ScanActivityPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<Mv[]>([])
  const [loading, setLoading] = useState(true)
  const [type, setType] = useState('all')
  const [device, setDevice] = useState('all')
  const [search, setSearch] = useState('')
  const [live, setLive] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await sb.from('inventory_movements')
      .select('id, product_id, sku, movement_type, qty, uom, lot_number, pack_qty, ref_table, created_by, created_at')
      .order('created_at', { ascending: false }).limit(200)
    const mv = (data as Mv[]) || []
    const ids = Array.from(new Set(mv.map(m => m.product_id).filter(Boolean))) as string[]
    if (ids.length) {
      const { data: ps } = await sb.from('products').select('id, product_name').in('id', ids)
      const nm: Record<string, string> = {}
      for (const p of (ps as any[]) || []) nm[p.id] = p.product_name
      mv.forEach(m => { m.name = m.product_id ? nm[m.product_id] : undefined })
    }
    setRows(mv); setLoading(false)
  }, [sb])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!live) return
    const ch = sb.channel('scan-activity')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'inventory_movements' }, () => load())
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [sb, live, load])

  const devices = useMemo(() => Array.from(new Set(rows.map(r => r.created_by).filter(Boolean))) as string[], [rows])
  const shown = rows.filter(r =>
    (type === 'all' || r.movement_type === type) &&
    (device === 'all' || r.created_by === device) &&
    (!search.trim() || [r.sku, r.name, r.created_by, r.lot_number].some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase()))))

  const today = new Date().toISOString().slice(0, 10)
  const todays = rows.filter(r => (r.created_at || '').slice(0, 10) === today)
  const nRecv = todays.filter(r => r.movement_type === 'receive').length
  const nProd = todays.filter(r => r.movement_type === 'produce').length

  const fmt = (v: string) => { const d = new Date(v); return isNaN(+d) ? '—' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1A1D2E]">Scan Activity</h1>
          <p className="text-sm text-gray-500 mt-1">Live feed of every receiving &amp; production scan across all devices — straight from the inventory ledger.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setLive(v => !v)} className={`text-xs font-semibold px-3 py-2 rounded-lg border ${live ? 'bg-[#DDF3E8] text-[#0F7A4E] border-[#BFE9D5]' : 'bg-white text-gray-500 border-[#E4E6EE]'}`}>{live ? '● Live' : 'Paused'}</button>
          <button onClick={load} className="text-xs font-semibold px-3 py-2 rounded-lg bg-[#EEF2FB] text-[#3B6FE0]">Refresh</button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-xl border border-[#E4E6EE] bg-white p-3"><p className="text-xs text-gray-400">Received today</p><p className="text-2xl font-extrabold text-[#0F7A4E]">{nRecv}</p></div>
        <div className="rounded-xl border border-[#E4E6EE] bg-white p-3"><p className="text-xs text-gray-400">Produced today</p><p className="text-2xl font-extrabold text-[#7A3FB0]">{nProd}</p></div>
        <div className="rounded-xl border border-[#E4E6EE] bg-white p-3"><p className="text-xs text-gray-400">Events shown</p><p className="text-2xl font-extrabold text-[#1A1D2E]">{shown.length}</p></div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex gap-1.5">{TYPES.map(t => <button key={t.key} onClick={() => setType(t.key)} className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${type === t.key ? 'bg-[#1A1D2E] text-white border-[#1A1D2E]' : 'bg-white text-gray-500 border-[#E4E6EE]'}`}>{t.label}</button>)}</div>
        <select value={device} onChange={e => setDevice(e.target.value)} className="text-xs border border-[#E4E6EE] rounded-lg px-2.5 py-1.5 text-gray-600">
          <option value="all">All devices / users</option>
          {devices.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search SKU, item, lot…" className="flex-1 min-w-[160px] text-xs border border-[#E4E6EE] rounded-lg px-3 py-1.5" />
      </div>

      <div className="rounded-xl border border-[#E4E6EE] bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#FBFCFE] text-[11px] uppercase tracking-wide text-gray-400">
            <tr>
              <th className="text-left font-semibold px-3 py-2.5">Time</th>
              <th className="text-left font-semibold px-3 py-2.5">Type</th>
              <th className="text-left font-semibold px-3 py-2.5">Item</th>
              <th className="text-right font-semibold px-3 py-2.5">Qty</th>
              <th className="text-left font-semibold px-3 py-2.5">Bags</th>
              <th className="text-left font-semibold px-3 py-2.5">Lot</th>
              <th className="text-left font-semibold px-3 py-2.5">Device / User</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F1F3F7]">
            {loading ? <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">Loading…</td></tr>
              : shown.length === 0 ? <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400 italic">No scan activity yet.</td></tr>
                : shown.map(r => { const ts = typeStyle(r.movement_type); return (
                  <tr key={r.id} className="hover:bg-[#F7FBF9]">
                    <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{fmt(r.created_at)}</td>
                    <td className="px-3 py-2.5"><span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase" style={{ background: ts.bg, color: ts.c }}>{r.movement_type}</span></td>
                    <td className="px-3 py-2.5"><span className="font-medium text-[#1A1D2E]">{r.name || r.sku || '—'}</span> {r.name && r.sku && <span className="text-xs text-gray-400 font-mono">{r.sku}</span>}</td>
                    <td className={`px-3 py-2.5 text-right font-bold ${Number(r.qty) < 0 ? 'text-red-600' : 'text-[#0F7A4E]'}`}>{Number(r.qty) > 0 ? '+' : ''}{r.qty}{r.uom ? <span className="text-[10px] text-gray-400 font-normal"> {r.uom}</span> : null}</td>
                    <td className="px-3 py-2.5 text-gray-500">{r.pack_qty ?? '—'}</td>
                    <td className="px-3 py-2.5 text-gray-500 font-mono text-xs">{r.lot_number || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{r.created_by || '—'}</td>
                  </tr>
                ) })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
