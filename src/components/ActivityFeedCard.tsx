'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const sb = createSupabaseBrowserClient()

type Ev = {
  event_time: string; event_date: string; direction: string; source: string; label: string
  reference: string; party: string; sku: string; item: string; qty: number; uom: string
  who: string; onhand_after: number | null
}

const CHIP: Record<string, string> = {
  po_placed: 'bg-amber-100 text-amber-700',
  received:  'bg-emerald-100 text-emerald-700',
  shipped:   'bg-rose-100 text-rose-700',
  consumed:  'bg-violet-100 text-violet-700',
  produced:  'bg-sky-100 text-sky-700',
  adjusted:  'bg-slate-100 text-slate-700',
  stocked:   'bg-teal-100 text-teal-700',
}
const fmtQty = (n: number) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
const fmtOnHand = (n: number | null) => (n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }))
function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  const d = Math.floor(s / 86400)
  return d === 1 ? 'yesterday' : d + 'd ago'
}

export default function ActivityFeedCard() {
  const [rows, setRows] = useState<Ev[] | null>(null)
  const bounce = useRef<any>(null)

  const load = useCallback(async () => {
    const { data } = await sb.from('v_activity_feed')
      .select('event_time,event_date,direction,source,label,reference,party,sku,item,qty,uom,who,onhand_after')
      .order('event_time', { ascending: false })
      .limit(8)
    setRows((data as any[]) || [])
  }, [])

  useEffect(() => {
    load()
    const bump = () => { if (bounce.current) clearTimeout(bounce.current); bounce.current = setTimeout(load, 400) }
    const ch = sb.channel('activity-feed-card')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_movements' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_orders' }, bump)
      .subscribe()
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => { sb.removeChannel(ch); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus) }
  }, [load])

  const today = useMemo(() => {
    const t = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
    const list = (rows || []).filter(r => r.event_date === t)
    return { inN: list.filter(r => r.direction === 'in').length, outN: list.filter(r => r.direction === 'out').length }
  }, [rows])

  return (
    <div className="bg-white rounded-2xl border border-[#E4E6EE] shadow-sm mb-5 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#EEF0F4]">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <h2 className="text-sm font-bold text-[#0F1C2E]">Live Activity</h2>
          <span className="hidden md:inline text-xs text-[#8A9FC0]">inbound · receiving · shipping · production · inventory</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-emerald-600">↓ {today.inN} in</span>
          <span className="text-xs font-semibold text-rose-600">↑ {today.outN} out</span>
          <span className="text-[10px] text-[#8A9FC0] uppercase tracking-wide">today</span>
          <Link href="/activity" className="text-xs font-semibold text-[#3B6FE0] hover:underline">View all →</Link>
        </div>
      </div>

      {rows == null ? (
        <p className="px-5 py-6 text-sm text-[#8A9FC0]">Loading activity…</p>
      ) : rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-[#8A9FC0]">No activity yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-[#8A9FC0] border-b border-[#EEF0F4] bg-[#FAFBFD]">
                <th className="px-4 py-2 w-6"></th>
                <th className="px-2 py-2 w-24">Type</th>
                <th className="px-2 py-2 w-24">SKU</th>
                <th className="px-2 py-2">Item</th>
                <th className="px-2 py-2 w-28">Party / Ref</th>
                <th className="px-2 py-2 w-24">By</th>
                <th className="px-2 py-2 w-20 text-right">Qty</th>
                <th className="px-2 py-2 w-20 text-right">On hand</th>
                <th className="px-3 py-2 w-16 text-right">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F3F7]">
              {rows.map((r, i) => {
                const inbound = r.direction === 'in'
                const chip = CHIP[r.source] || 'bg-gray-100 text-gray-600'
                return (
                  <tr key={i} className="hover:bg-[#F8FAFF]">
                    <td className="px-4 py-2.5">
                      <span className={`inline-grid place-items-center w-6 h-6 rounded-full text-xs font-bold ${inbound ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>{inbound ? '↓' : '↑'}</span>
                    </td>
                    <td className="px-2 py-2.5">
                      <span className={`text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 ${chip}`}>{r.label}</span>
                    </td>
                    <td className="px-2 py-2.5 font-mono font-semibold text-[#0F1C2E] whitespace-nowrap">{r.sku || '—'}</td>
                    <td className="px-2 py-2.5 text-[#5A6E8A] truncate max-w-[220px]" title={r.item || undefined}>{r.item || '—'}</td>
                    <td className="px-2 py-2.5 text-[#8A9FC0] truncate max-w-[130px]" title={`${r.party}${r.reference && r.reference !== '—' ? ' · ' + r.reference : ''}`}>
                      {r.party}{r.reference && r.reference !== '—' ? <span className="text-[#B5C0D0]"> · {r.reference}</span> : null}
                    </td>
                    <td className="px-2 py-2.5 text-[#5A6E8A] text-xs truncate max-w-[110px]" title={r.who || undefined}>{r.who ? r.who.split('@')[0] : '—'}</td>
                    <td className={`px-2 py-2.5 text-right font-bold whitespace-nowrap ${inbound ? 'text-emerald-600' : 'text-rose-600'}`}>{inbound ? '+' : '−'}{fmtQty(r.qty)} <span className="text-[10px] font-normal text-[#8A9FC0]">{r.uom}</span></td>
                    <td className="px-2 py-2.5 text-right font-semibold text-[#0F1C2E] whitespace-nowrap">{fmtOnHand(r.onhand_after)}</td>
                    <td className="px-3 py-2.5 text-right text-[10px] text-[#8A9FC0] whitespace-nowrap">{ago(r.event_time)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
