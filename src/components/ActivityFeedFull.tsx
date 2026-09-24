'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const sb = createSupabaseBrowserClient()

type Ev = {
  event_time: string; event_date: string; direction: string; source: string; label: string
  reference: string; party: string; sku: string; item: string; qty: number; uom: string; who: string; note: string | null
}

const SOURCES: { key: string; label: string }[] = [
  { key: 'po_placed', label: 'PO Placed' },
  { key: 'received', label: 'Received' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'consumed', label: 'Consumed' },
]
const SRC: Record<string, string> = {
  po_placed: 'bg-amber-100 text-amber-700',
  received: 'bg-emerald-100 text-emerald-700',
  shipped: 'bg-rose-100 text-rose-700',
  consumed: 'bg-violet-100 text-violet-700',
}
const PAGE = 100
const fmtQty = (n: number) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
const fmtTime = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function ActivityFeedFull() {
  const [rows, setRows] = useState<Ev[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [active, setActive] = useState<Set<string>>(new Set(SOURCES.map(s => s.key)))
  const [dir, setDir] = useState<'all' | 'in' | 'out'>('all')
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const bounce = useRef<any>(null)

  const load = useCallback(async (append = false) => {
    setLoading(true)
    let query = sb.from('v_activity_feed')
      .select('event_time,event_date,direction,source,label,reference,party,sku,item,qty,uom,who,note')
      .order('event_time', { ascending: false })
    const srcArr = Array.from(active)
    if (srcArr.length && srcArr.length < SOURCES.length) query = query.in('source', srcArr)
    if (dir !== 'all') query = query.eq('direction', dir)
    if (from) query = query.gte('event_date', from)
    if (to) query = query.lte('event_date', to)
    if (q.trim()) {
      const s = q.trim().replace(/[%,]/g, ' ')
      query = query.or(`sku.ilike.%${s}%,party.ilike.%${s}%,reference.ilike.%${s}%,item.ilike.%${s}%`)
    }
    const offset = append ? rows.length : 0
    query = query.range(offset, offset + PAGE - 1)
    const { data } = await query
    const batch = (data as any[]) || []
    setHasMore(batch.length === PAGE)
    setRows(append ? [...rows, ...batch] : batch)
    setLoading(false)
  }, [active, dir, q, from, to, rows])

  // reload on filter change (not on rows change)
  useEffect(() => { load(false) }, [active, dir, from, to]) // eslint-disable-line
  useEffect(() => { if (bounce.current) clearTimeout(bounce.current); bounce.current = setTimeout(() => load(false), 350); return () => clearTimeout(bounce.current) }, [q]) // eslint-disable-line

  // realtime
  useEffect(() => {
    const bump = () => load(false)
    const ch = sb.channel('activity-feed-full')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_movements' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_orders' }, bump)
      .subscribe()
    const onFocus = () => load(false)
    window.addEventListener('focus', onFocus)
    return () => { sb.removeChannel(ch); window.removeEventListener('focus', onFocus) }
  }, []) // eslint-disable-line

  const toggle = (k: string) => setActive(a => { const n = new Set(a); n.has(k) ? n.delete(k) : n.add(k); return n.size ? n : new Set(SOURCES.map(s => s.key)) })

  const totals = useMemo(() => {
    const t = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
    const today = rows.filter(r => r.event_date === t)
    return { inN: today.filter(r => r.direction === 'in').length, outN: today.filter(r => r.direction === 'out').length, total: today.length }
  }, [rows])

  return (
    <div className="min-h-screen bg-[#F7F8FA] p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-2 mb-1">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <h1 className="text-2xl font-bold text-[#0F1C2E]">Live Activity Ledger</h1>
        </div>
        <p className="text-sm text-[#8A9FC0] mb-4">Every inbound PO, item received, shipment out, and production consumption — live across the company. Today: <span className="font-semibold text-emerald-600">{totals.inN} in</span> · <span className="font-semibold text-rose-600">{totals.outN} out</span>.</p>

        <div className="bg-white rounded-2xl border border-[#E4E6EE] p-3 mb-4 flex flex-wrap items-center gap-2">
          {SOURCES.map(s => (
            <button key={s.key} onClick={() => toggle(s.key)}
              className={`text-xs font-semibold rounded-full px-3 py-1.5 border ${active.has(s.key) ? SRC[s.key] + ' border-transparent' : 'bg-white text-gray-400 border-[#E4E6EE]'}`}>
              {s.label}
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-[#E4E6EE]" />
          <select value={dir} onChange={e => setDir(e.target.value as any)} className="text-xs border border-[#E4E6EE] rounded-lg px-2 py-1.5">
            <option value="all">All directions</option>
            <option value="in">Inbound only</option>
            <option value="out">Outbound only</option>
          </select>
          <input value={from} onChange={e => setFrom(e.target.value)} type="date" className="text-xs border border-[#E4E6EE] rounded-lg px-2 py-1.5" />
          <span className="text-xs text-[#8A9FC0]">to</span>
          <input value={to} onChange={e => setTo(e.target.value)} type="date" className="text-xs border border-[#E4E6EE] rounded-lg px-2 py-1.5" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search SKU, customer, supplier, ref…" className="flex-1 min-w-[180px] text-xs border border-[#E4E6EE] rounded-lg px-3 py-1.5" />
          {(from || to || q || dir !== 'all' || active.size < SOURCES.length) && (
            <button onClick={() => { setFrom(''); setTo(''); setQ(''); setDir('all'); setActive(new Set(SOURCES.map(s => s.key))) }} className="text-xs text-gray-400 hover:text-[#3B6FE0]">Clear</button>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-[#E4E6EE] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#0F1C2E] text-white text-left">
                  <th className="px-3 py-2 font-semibold">When</th>
                  <th className="px-3 py-2 font-semibold">Type</th>
                  <th className="px-3 py-2 font-semibold">SKU / Item</th>
                  <th className="px-3 py-2 font-semibold text-right">Qty</th>
                  <th className="px-3 py-2 font-semibold">Party</th>
                  <th className="px-3 py-2 font-semibold">Reference</th>
                  <th className="px-3 py-2 font-semibold">By</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const inbound = r.direction === 'in'
                  return (
                    <tr key={i} className="border-b border-[#F1F3F7] hover:bg-[#F8FAFF]">
                      <td className="px-3 py-2 whitespace-nowrap text-[#5A6E8A] text-xs">{fmtTime(r.event_time)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 ${SRC[r.source] || 'bg-gray-100 text-gray-600'}`}>{r.label}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-semibold text-[#0F1C2E]">{r.sku || '—'}</span>
                        {r.item ? <span className="text-[#8A9FC0]">  {r.item}</span> : null}
                      </td>
                      <td className={`px-3 py-2 text-right font-bold whitespace-nowrap ${inbound ? 'text-emerald-600' : 'text-rose-600'}`}>{inbound ? '+' : '−'}{fmtQty(r.qty)} <span className="text-[10px] font-normal text-[#8A9FC0]">{r.uom}</span></td>
                      <td className="px-3 py-2 text-[#0F1C2E] truncate max-w-[180px]">{r.party}</td>
                      <td className="px-3 py-2 text-[#5A6E8A] truncate max-w-[160px]">{r.reference}</td>
                      <td className="px-3 py-2 text-[#8A9FC0] text-xs truncate max-w-[150px]">{(r.who || '').split('@')[0]}</td>
                    </tr>
                  )
                })}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-[#8A9FC0]">No activity matches these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-3 flex items-center justify-between border-t border-[#EEF0F4]">
            <span className="text-xs text-[#8A9FC0]">{loading ? 'Loading…' : `${rows.length} event${rows.length === 1 ? '' : 's'} shown`}</span>
            {hasMore && !loading && (
              <button onClick={() => load(true)} className="text-xs font-semibold text-[#3B6FE0] hover:underline">Load more</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
