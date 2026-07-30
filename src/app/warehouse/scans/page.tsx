'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Mv { sku: string; qty: number; created_at: string }

function localDay(iso: string) { const d = new Date(iso); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10) }
function startOfWeek() { const d = new Date(); const dow = (d.getDay() + 6) % 7; d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - dow); return d }

export default function ProductionScansPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [tab, setTab] = useState<'today' | 'week' | 'history'>('today')
  const [rows, setRows] = useState<Mv[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<Record<string, boolean>>({})

  useEffect(() => { (async () => {
    const since = new Date(); since.setDate(since.getDate() - 120)
    const { data } = await sb.from('inventory_movements').select('sku, qty, created_at')
      .eq('movement_type', 'produce').gte('created_at', since.toISOString()).order('created_at', { ascending: false })
    const mv = (data as Mv[]) || []
    setRows(mv)
    const skus = Array.from(new Set(mv.map(m => m.sku)))
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

  const aggBy = (filter: (m: Mv) => boolean) => {
    const m: Record<string, number> = {}
    for (const r of rows) if (filter(r)) m[r.sku] = (m[r.sku] || 0) + Number(r.qty || 0)
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }
  const todayAgg = aggBy(m => localDay(m.created_at) === todayKey)
  const weekAgg = aggBy(m => new Date(m.created_at) >= weekStart)

  // history: group by day
  const byDay: Record<string, Record<string, number>> = {}
  for (const r of rows) { const d = localDay(r.created_at); (byDay[d] ||= {}); byDay[d][r.sku] = (byDay[d][r.sku] || 0) + Number(r.qty || 0) }
  const days = Object.keys(byDay).sort().reverse()

  const nm = (sku: string) => names[sku] || sku
  const fmt = (n: number) => Number(n).toLocaleString()

  const Row = ({ sku, qty }: { sku: string; qty: number }) => (
    <div className="flex items-center justify-between rounded-xl px-3.5 py-3 mb-1.5" style={{ background: '#1A2035', border: '1px solid #2A3350' }}>
      <div className="min-w-0"><p className="text-sm font-semibold truncate">{nm(sku)}</p><p className="text-[11px] font-mono" style={{ color: '#8A9FC0' }}>{sku}</p></div>
      <span className="text-xl font-extrabold" style={{ color: '#34d399' }}>{fmt(qty)}</span>
    </div>
  )

  return (
    <div className="text-white flex flex-col" style={{ background: '#0F1424', minHeight: '100dvh' }}>
      <div className="sticky top-0 z-20 px-4 pt-4 pb-2" style={{ background: '#0F1424', borderBottom: '1px solid #1c2540', paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}>
        <div className="max-w-md mx-auto">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-lg font-extrabold">Production</h1>
            <button onClick={signOut} className="text-[11px] font-semibold px-2.5 py-1 rounded-lg" style={{ background: '#1A2035', color: '#8A9FC0', border: '1px solid #2A3350' }}>Sign out</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Link href="/warehouse/produce" className="text-center py-2 rounded-lg text-sm font-bold" style={{ background: '#1A2035', color: '#8A9FC0', border: '1px solid #2A3350' }}>Scan</Link>
            <span className="text-center py-2 rounded-lg text-sm font-bold" style={{ background: '#D97706', color: '#fff' }}>History</span>
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
              {tab === 'today' && (todayAgg.length ? todayAgg.map(([s, q]) => <Row key={s} sku={s} qty={q} />) : <p className="text-sm italic" style={{ color: '#5A6E8A' }}>Nothing produced today yet.</p>)}
              {tab === 'week' && (weekAgg.length ? weekAgg.map(([s, q]) => <Row key={s} sku={s} qty={q} />) : <p className="text-sm italic" style={{ color: '#5A6E8A' }}>Nothing produced this week yet.</p>)}
              {tab === 'history' && (days.length ? days.map(d => {
                const items = Object.entries(byDay[d]).sort((a, b) => b[1] - a[1])
                const dayTotal = items.reduce((a, [, q]) => a + q, 0)
                const isOpen = open[d]
                return (
                  <div key={d} className="mb-2">
                    <button onClick={() => setOpen(o => ({ ...o, [d]: !o[d] }))} className="w-full flex items-center justify-between rounded-xl px-3.5 py-3" style={{ background: '#141a2e', border: '1px solid #2A3350' }}>
                      <span className="text-sm font-bold">{new Date(d + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                      <span className="text-sm font-extrabold" style={{ color: '#34d399' }}>{fmt(dayTotal)} <span style={{ color: '#5A6E8A' }}>{isOpen ? '▲' : '▼'}</span></span>
                    </button>
                    {isOpen && <div className="mt-1.5 pl-1">{items.map(([s, q]) => <Row key={s} sku={s} qty={q} />)}</div>}
                  </div>
                )
              }) : <p className="text-sm italic" style={{ color: '#5A6E8A' }}>No production recorded yet.</p>)}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
