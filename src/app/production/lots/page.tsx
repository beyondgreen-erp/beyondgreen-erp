'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface LotCode {
  id: string
  lot_number: string
  lot_type: string | null
  sku: string | null
  product_name: string | null
  quantity: number | null
  status: string | null
  created_at: string
  notes: string | null
  parent_lot_id: string | null
  purchase_order_id: string | null
  work_order_id: string | null
}

const LOT_TYPES = ['All', 'Raw Material', 'WIP', 'Finished Goods', 'Shipped']

const TYPE_CFG: Record<string, { cls: string; dot: string }> = {
  'Raw Material': { cls: 'bg-blue-500/15 text-blue-400 border-blue-500/25', dot: 'bg-blue-400' },
  'WIP': { cls: 'bg-amber-500/15 text-amber-400 border-amber-500/25', dot: 'bg-amber-400' },
  'Finished Goods': { cls: 'bg-[#00C89615] text-[#00C896] border-[#00C89630]', dot: 'bg-[#00C896]' },
  'Shipped': { cls: 'bg-violet-500/15 text-violet-400 border-violet-500/25', dot: 'bg-violet-400' },
}

const STATUS_CFG: Record<string, string> = {
  Active: 'bg-[#00C89615] text-[#00C896] border-[#00C89630]',
  Shipped: 'bg-violet-500/15 text-violet-400 border-violet-500/25',
  Quarantine: 'bg-red-500/15 text-red-400 border-red-500/25',
  Consumed: 'bg-[#2A2A35] text-[#9898A8] border-[#3A3A45]',
}

export default function LotsPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<LotCode[]>([])
  const [loading, setLoading] = useState(true)
  const [tableExists, setTableExists] = useState(true)
  const [tab, setTab] = useState('All')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<LotCode | null>(null)
  const [children, setChildren] = useState<LotCode[]>([])
  const [parent, setParent] = useState<LotCode | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  async function load() {
    setLoading(true)
    const { data, error } = await sb.from('lot_codes').select('*').order('created_at', { ascending: false })
    if (error?.code === '42P01') { setTableExists(false); setLoading(false); return }
    setTableExists(true)
    setRows(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, []) // eslint-disable-line

  async function openLot(lot: LotCode) {
    setSelected(lot)
    setChildren([])
    setParent(null)
    const [childRes, parentRes] = await Promise.all([
      sb.from('lot_codes').select('*').eq('parent_lot_id', lot.id),
      lot.parent_lot_id ? sb.from('lot_codes').select('*').eq('id', lot.parent_lot_id).single() : Promise.resolve({ data: null }),
    ])
    setChildren(childRes.data ?? [])
    setParent((parentRes as any).data ?? null)
  }

  function close() { setSelected(null) }

  const filtered = rows.filter(r => {
    if (tab !== 'All' && r.lot_type !== tab) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (r.lot_number ?? '').toLowerCase().includes(q) || (r.sku ?? '').toLowerCase().includes(q) || (r.product_name ?? '').toLowerCase().includes(q)
  })

  const counts = Object.fromEntries(LOT_TYPES.slice(1).map(t => [t, rows.filter(r => r.lot_type === t).length]))

  if (!tableExists) {
    return (
      <div className="p-8 max-w-2xl">
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-violet-500/20 text-violet-300 border-violet-500/30">OPERATIONS</span>
        <h1 className="text-2xl font-bold text-white mt-2 mb-6">Lot Tracking</h1>
        <div className="bg-[#111113] border border-[#2A2A35] rounded-2xl p-8 text-center">
          <div className="w-14 h-14 bg-amber-500/15 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <h2 className="text-white font-semibold text-lg mb-2">Lot Code Table Not Found</h2>
          <p className="text-[#9898A8] text-sm mb-4 max-w-md mx-auto">The <code className="text-[#00C896]">lot_codes</code> table needs to be created in Supabase.</p>
          <div className="bg-[#0A0A0B] border border-[#2A2A35] rounded-xl p-4 text-left text-xs font-mono text-[#00C896] overflow-x-auto whitespace-pre">{`CREATE TABLE lot_codes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lot_number text UNIQUE NOT NULL,
  lot_type text,
  sku text,
  product_name text,
  quantity numeric,
  status text DEFAULT 'Active',
  notes text,
  parent_lot_id uuid REFERENCES lot_codes(id),
  purchase_order_id uuid,
  work_order_id uuid,
  created_at timestamptz DEFAULT now()
);`}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-5 md:p-8 min-h-screen">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-violet-500/20 text-violet-300 border-violet-500/30">OPERATIONS</span>
          <h1 className="text-2xl font-bold text-white mt-1.5 tracking-tight">Lot Tracking</h1>
          <p className="text-[#5A5A6A] text-sm mt-0.5">{loading ? 'Loading…' : `${filtered.length} lot${filtered.length !== 1 ? 's' : ''}`}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {LOT_TYPES.slice(1).map(t => {
          const cfg = TYPE_CFG[t] ?? { cls: 'bg-[#18181C] text-white border-[#2A2A35]', dot: 'bg-white' }
          return (
            <div key={t} className="bg-[#111113] border border-[#2A2A35] rounded-2xl p-4">
              <p className="text-2xl font-bold text-white">{loading ? '—' : counts[t] ?? 0}</p>
              <div className="flex items-center gap-1.5 mt-1">
                <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                <p className="text-[#5A5A6A] text-xs">{t}</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Tabs + Search */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <div className="flex gap-1 bg-[#111113] border border-[#2A2A35] rounded-xl p-1">
          {LOT_TYPES.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${tab === t ? 'bg-[#2A2A35] text-white' : 'text-[#5A5A6A] hover:text-[#9898A8]'}`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5A5A6A]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input
            placeholder="Search lot number or SKU…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-[#111113] border border-[#2A2A35] text-white placeholder-[#5A5A6A] rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-[#00C896] transition-all"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-[#111113] border border-[#2A2A35] rounded-2xl overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20"><svg className="w-5 h-5 animate-spin text-[#3A3A45]" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-14 h-14 bg-[#1E1E24] rounded-2xl flex items-center justify-center mb-4">
              <svg className="w-7 h-7 text-[#3A3A4A]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg>
            </div>
            <p className="text-white font-medium mb-1">No lot codes yet</p>
            <p className="text-[#5A5A6A] text-sm text-center max-w-sm">Lot codes are assigned when purchase orders are received and when production work orders are completed.</p>
          </div>
        ) : (
          <table className="w-full min-w-[800px] text-sm">
            <thead>
              <tr className="border-b border-[#2A2A35]">
                {['Lot Number','Type','SKU','Product','Qty','Status','Date','Links'].map(h => (
                  <th key={h} className="text-left text-xs font-medium text-[#5A5A6A] uppercase tracking-wider py-3 px-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const typeCfg = TYPE_CFG[r.lot_type ?? ''] ?? { cls: 'bg-[#2A2A35] text-[#9898A8] border-[#3A3A45]', dot: 'bg-[#5A5A6A]' }
                const statusCls = STATUS_CFG[r.status ?? ''] ?? 'bg-[#2A2A35] text-[#9898A8] border-[#3A3A45]'
                return (
                  <tr
                    key={r.id}
                    onClick={() => openLot(r)}
                    className={`border-b border-[#2A2A35]/60 last:border-0 hover:bg-[#18181C] transition-colors cursor-pointer ${i % 2 === 1 ? 'bg-[#18181C]/30' : ''}`}
                  >
                    <td className="px-4 py-3.5 text-[#00C896] font-mono text-xs font-semibold">{r.lot_number}</td>
                    <td className="px-4 py-3.5">
                      {r.lot_type ? <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs border ${typeCfg.cls}`}><span className={`w-1.5 h-1.5 rounded-full ${typeCfg.dot}`} />{r.lot_type}</span> : '—'}
                    </td>
                    <td className="px-4 py-3.5 text-[#9898A8] font-mono text-xs">{r.sku ?? '—'}</td>
                    <td className="px-4 py-3.5 text-white text-xs truncate max-w-[140px]">{r.product_name ?? '—'}</td>
                    <td className="px-4 py-3.5 text-white text-xs">{r.quantity != null ? r.quantity.toLocaleString() : '—'}</td>
                    <td className="px-4 py-3.5">
                      {r.status ? <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium border ${statusCls}`}>{r.status}</span> : '—'}
                    </td>
                    <td className="px-4 py-3.5 text-[#9898A8] text-xs">{new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}</td>
                    <td className="px-4 py-3.5 text-xs text-[#5A5A6A] space-x-2">
                      {r.purchase_order_id && <span className="text-blue-400">PO</span>}
                      {r.work_order_id && <span className="text-violet-400">WO</span>}
                      {r.parent_lot_id && <span className="text-amber-400">Child</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Backdrop */}
      <div className={`fixed inset-0 bg-black/60 z-40 transition-opacity duration-300 ${selected ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={close} />

      {/* Slide-out panel */}
      <div ref={panelRef} className={`fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-full w-full md:w-[560px] bg-[#111113] border-l border-[#2A2A35] z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${selected ? 'translate-x-0' : 'translate-x-full'}`}>
        {selected && (
          <>
            <div className="flex items-center justify-between px-6 py-5 border-b border-[#2A2A35] shrink-0">
              <div>
                <h2 className="text-white font-semibold font-mono">{selected.lot_number}</h2>
                <p className="text-[#5A5A6A] text-xs mt-0.5">{selected.lot_type} · {selected.product_name ?? selected.sku ?? '—'}</p>
              </div>
              <button onClick={close} className="p-2 rounded-xl text-[#5A5A6A] hover:text-white hover:bg-[#18181C] transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              {/* Details */}
              <section>
                <h3 className="text-xs font-semibold text-[#5A5A6A] uppercase tracking-wider mb-3">Lot Details</h3>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Lot Number', value: selected.lot_number },
                    { label: 'Type', value: selected.lot_type ?? '—' },
                    { label: 'SKU', value: selected.sku ?? '—' },
                    { label: 'Product', value: selected.product_name ?? '—' },
                    { label: 'Quantity', value: selected.quantity != null ? selected.quantity.toLocaleString() : '—' },
                    { label: 'Status', value: selected.status ?? '—' },
                    { label: 'Created', value: new Date(selected.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) },
                  ].map(f => (
                    <div key={f.label} className="bg-[#18181C] border border-[#2A2A35] rounded-xl p-3">
                      <p className="text-[#5A5A6A] text-[11px] uppercase tracking-wider mb-0.5">{f.label}</p>
                      <p className="text-white text-sm">{f.value}</p>
                    </div>
                  ))}
                </div>
                {selected.notes && (
                  <div className="mt-3 bg-[#18181C] border border-[#2A2A35] rounded-xl p-3">
                    <p className="text-[#5A5A6A] text-[11px] uppercase tracking-wider mb-1">Notes</p>
                    <p className="text-white text-sm">{selected.notes}</p>
                  </div>
                )}
              </section>

              {/* Traceability Chain */}
              <section>
                <h3 className="text-xs font-semibold text-[#5A5A6A] uppercase tracking-wider mb-3">Traceability Chain</h3>
                <div className="space-y-2">
                  {parent && (
                    <div className="bg-[#18181C] border border-amber-500/20 rounded-xl p-3 cursor-pointer hover:border-amber-500/40 transition-colors" onClick={() => openLot(parent!)}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] text-amber-400 uppercase font-semibold">Parent Lot</span>
                        <svg className="w-3 h-3 text-[#5A5A6A]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
                      </div>
                      <p className="text-[#00C896] font-mono text-xs">{parent.lot_number}</p>
                      <p className="text-[#9898A8] text-xs">{parent.product_name ?? parent.sku ?? '—'} · {parent.lot_type}</p>
                    </div>
                  )}

                  <div className="bg-[#00C89610] border border-[#00C89630] rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] text-[#00C896] uppercase font-semibold">This Lot</span>
                    </div>
                    <p className="text-[#00C896] font-mono text-xs">{selected.lot_number}</p>
                    <p className="text-[#9898A8] text-xs">{selected.product_name ?? selected.sku ?? '—'} · {selected.lot_type}</p>
                  </div>

                  {children.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 px-1 mb-1">
                        <svg className="w-3 h-3 text-[#5A5A6A]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
                        <span className="text-[10px] text-[#5A5A6A] uppercase font-semibold">Child Lots ({children.length})</span>
                      </div>
                      {children.map(c => (
                        <div key={c.id} className="bg-[#18181C] border border-violet-500/20 rounded-xl p-3 cursor-pointer hover:border-violet-500/40 transition-colors mb-2" onClick={() => openLot(c)}>
                          <p className="text-violet-400 font-mono text-xs">{c.lot_number}</p>
                          <p className="text-[#9898A8] text-xs">{c.product_name ?? c.sku ?? '—'} · {c.lot_type}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {!parent && children.length === 0 && (
                    <p className="text-[#5A5A6A] text-xs text-center py-4">No parent or child lots linked to this lot code</p>
                  )}
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
