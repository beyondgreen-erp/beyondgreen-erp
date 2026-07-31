'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Mv {
  id: string
  sku: string
  qty: number | null
  uom: string | null
  pack_qty: number | null
  lot_number: string | null
  created_by: string | null
  created_at: string
}

function localDay(iso: string) { const d = new Date(iso); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10) }
function startOfWeek() { const d = new Date(); const dow = (d.getDay() + 6) % 7; d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - dow); return d }
const fmt = (n: number | null | undefined) => n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 3 })
const who = (e: string | null) => (e || '').split('@')[0] || '—'
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

export default function ReceivingLogPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [tab, setTab] = useState<'today' | 'week' | 'history'>('today')
  const [rows, setRows] = useState<Mv[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<Record<string, boolean>>({})

  useEffect(() => { (async () => {
    const since = new Date(); since.setDate(since.getDate() - 180)
    const { data } = await sb.from('inventory_movements')
      .select('id, sku, qty, uom, pack_qty, lot_number, created_by, created_at')
      .eq('movement_type', 'receive').gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
    const mv = (data as Mv[]) || []
    setRows(mv)
    const skus = Array.from(new Set(mv.map(m => m.sku).filter(Boolean)))
    if (skus.length) {
      const { data: ps } = await sb.from('products').select('sku, product_name').in('sku', skus)
      const map: Record<string, string> = {}
      for (const p of (ps as any[]) || []) map[p.sku] = p.product_name
      setNames(map)
    }
    setLoading(false)
  })() }, [sb])

  async function signOut() { await sb.auth.signOut(); window.location.href = '/login' }

  const todayKey = new Date().toISOString().slice(0, 10)
  const weekStart = startOfWeek()
  const nm = (sku: string) => names[sku] || sku

  const todayRows = rows.filter(m => localDay(m.created_at) === todayKey)
  const weekRows = rows.filter(m => new Date(m.created_at) >= weekStart)

  const byDay: Record<string, Mv[]> = {}
  for (const r of rows) { const d = localDay(r.created_at); (byDay[d] ||= []).push(r) }
  const days = Object.keys(byDay).sort().reverse()

  const Entry = ({ m }: { m: Mv }) => (
    <div className="rounded-xl px-3.5 py-3 mb-1.5" style={{ background: '#1A2035', border: '1px solid #2A3350' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{nm(m.sku)}</p>
          <p className="text-[11px] font-mono" style={{ color: '#8A9FC0' }}>{m.sku}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-lg font-extrabold leading-none" style={{ color: '#34d399' }}>{fmt(m.qty)} <span className="text-xs font-bold" style={{ color: '#5A6E8A' }}>{m.uom || ''}</span></p>
          {m.pack_qty != null && Number(m.pack_qty) > 0 && (
            <p className="text-[11px] mt-0.5" style={{ color: '#93C5FD' }}>{fmt(m.pack_qty)} unit{Number(m.pack_qty) === 1 ? '' : 's'}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap mt-1.5 text-[10px]" style={{ color: '#5A6E8A' }}>
        <span>🕒 {timeOf(m.created_at)}</span>
        <span>· 👤 {who(m.created_by)}</span>
        {m.lot_number ? <span>· Lot {m.lot_number}</span> : null}
      </div>
    </div>
  )

  return (
    <div className="text-white flex flex-col" style={{ background: '#0F1424', minHeight: '100dvh' }}>
      <div className="sticky top-0 z-20 px-4 pt-4 pb-2" style={{ background: '#0F1424', borderBottom: '1px solid #1c2540', paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}>
        <div className="max-w-md mx-auto">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-lg font-extrabold">📒 Receiving Log</h1>
            <button onClick={signOut} className="text-[11px] font-semibold px-2.5 py-1 rounded-lg" style={{ background: '#1A2035', color: '#8A9FC0', border: '1px solid #2A3350' }}>Sign out</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Link href="/warehouse/scan" className="text-center py-2 rounded-lg text-sm font-bold" style={{ background: '#1A2035', color: '#8A9FC0', border: '1px solid #2A3350' }}>← Receive</Link>
            <span className="text-center py-2 rounded-lg text-sm font-bold" style={{ background: '#0e7a46', color: '#fff' }}>Log</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-md mx-auto px-4 py-4">
          <div className="grid grid-cols-3 gap-2 mb-4">
            {(['today', 'week', 'history'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} className="py-2.5 rounded-xl text-sm font-bold capitalize" style={{ background: tab === t ? '#3B6FE0' : '#1A2035', color: tab === t ? '#fff' : '#8A9FC0', border: '1px solid #2A3350' }}>{t === 'week' ? 'This week' : t}</button>
            ))}
          </div>

          {loading ? <p className="text-sm italic" style={{ color: '#5A6E8A' }}>Loading…</p> : (
            <>
              {tab === 'today' && (todayRows.length
                ? <>
                    <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#5A6E8A' }}>{todayRows.length} receipt{todayRows.length === 1 ? '' : 's'} today</p>
                    {todayRows.map(m => <Entry key={m.id} m={m} />)}
                  </>
                : <p className="text-sm italic" style={{ color: '#5A6E8A' }}>Nothing received today yet.</p>)}

              {tab === 'week' && (weekRows.length
                ? <>
                    <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#5A6E8A' }}>{weekRows.length} receipt{weekRows.length === 1 ? '' : 's'} this week</p>
                    {weekRows.map(m => <Entry key={m.id} m={m} />)}
                  </>
                : <p className="text-sm italic" style={{ color: '#5A6E8A' }}>Nothing received this week yet.</p>)}

              {tab === 'history' && (days.length ? days.map(d => {
                const items = byDay[d]
                const isOpen = open[d]
                return (
                  <div key={d} className="mb-2">
                    <button onClick={() => setOpen(o => ({ ...o, [d]: !o[d] }))} className="w-full flex items-center justify-between rounded-xl px-3.5 py-3" style={{ background: '#141a2e', border: '1px solid #2A3350' }}>
                      <span className="text-sm font-bold">{new Date(d + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                      <span className="text-sm font-extrabold" style={{ color: '#34d399' }}>{items.length} <span style={{ color: '#5A6E8A' }}>receipt{items.length === 1 ? '' : 's'} {isOpen ? '▲' : '▼'}</span></span>
                    </button>
                    {isOpen && <div className="mt-1.5 pl-1">{items.map(m => <Entry key={m.id} m={m} />)}</div>}
                  </div>
                )
              }) : <p className="text-sm italic" style={{ color: '#5A6E8A' }}>No receiving recorded yet.</p>)}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
