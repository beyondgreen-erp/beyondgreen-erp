'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const sb = createSupabaseBrowserClient()

type Ev = {
  event_time: string; event_date: string; direction: string; source: string; label: string
  reference: string; party: string; sku: string; item: string; qty: number; uom: string; who: string
}

const SRC: Record<string, { chip: string; dot: string }> = {
  po_placed: { chip: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  received:  { chip: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  shipped:   { chip: 'bg-rose-100 text-rose-700', dot: 'bg-rose-500' },
  consumed:  { chip: 'bg-violet-100 text-violet-700', dot: 'bg-violet-500' },
}
const fmtQty = (n: number) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
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
      .select('event_time,event_date,direction,source,label,reference,party,sku,item,qty,uom,who')
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
          <span className="text-xs text-[#8A9FC0]">inbound · receiving · shipping · production</span>
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
        <div className="divide-y divide-[#F1F3F7]">
          {rows.map((r, i) => {
            const st = SRC[r.source] || { chip: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' }
            const inbound = r.direction === 'in'
            return (
              <div key={i} className="flex items-center gap-3 px-5 py-2.5 hover:bg-[#F8FAFF]">
                <span className={`shrink-0 w-6 h-6 rounded-full grid place-items-center text-xs font-bold ${inbound ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>{inbound ? '↓' : '↑'}</span>
                <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 ${st.chip}`}>{r.label}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-[#0F1C2E] truncate">
                    <span className="font-semibold">{r.sku || r.item || '—'}</span>
                    {r.item && r.sku ? <span className="text-[#8A9FC0]">  {r.item}</span> : null}
                  </p>
                  <p className="text-xs text-[#8A9FC0] truncate">{r.party}{r.reference && r.reference !== '—' ? `  ·  ${r.reference}` : ''}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-sm font-bold ${inbound ? 'text-emerald-600' : 'text-rose-600'}`}>{inbound ? '+' : '−'}{fmtQty(r.qty)} <span className="text-[10px] font-normal text-[#8A9FC0]">{r.uom}</span></p>
                  <p className="text-[10px] text-[#8A9FC0]">{ago(r.event_time)}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
