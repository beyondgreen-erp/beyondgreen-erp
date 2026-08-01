'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

// Inbound = credit (+stock): receiving, production, returns, positive adjustments.
// Outbound = debit (−stock): shipments, sales, consumption, waste, negative adjustments.
const OUTBOUND = new Set(['ship', 'shipment', 'shipped', 'sale', 'sold', 'outbound', 'consume', 'consumed', 'pick', 'waste', 'damage', 'scrap', 'adjust_out', 'transfer_out', 'fba', 'deduct'])
function isOutbound(t: string): boolean {
  const s = (t || '').toLowerCase()
  if (OUTBOUND.has(s)) return true
  return /(^|[_-])out(bound)?([_-]|$)|ship|sale|sold|consum|waste|damage|scrap|pick|deduct/.test(s)
}
// Signed quantity: respect an already-negative stored qty, otherwise sign by type.
function signedQty(m: Mv): number {
  const raw = Number(m.qty) || 0
  if (raw < 0) return raw
  const q = Math.abs(raw)
  return isOutbound(m.movement_type || '') ? -q : q
}
const TYPE_LABEL: Record<string, string> = {
  receive: 'Received', produce: 'Produced', ship: 'Shipped', sale: 'Sold',
  adjust_in: 'Adjust +', adjust_out: 'Adjust −', return: 'Returned', transfer_in: 'Transfer in', transfer_out: 'Transfer out',
}
const prettyType = (t: string) => TYPE_LABEL[(t || '').toLowerCase()] || ((t || '—').charAt(0).toUpperCase() + (t || '').slice(1))

interface Mv {
  id: string; sku: string; product_id: string | null; movement_type: string | null
  qty: number | null; uom: string | null; pack_qty: number | null; lot_number: string | null
  note: string | null; ref_table: string | null; created_by: string | null; created_at: string
}
interface Prod { sku: string; product_name: string | null; on_hand_qty: number | null; uom: string | null }

const fmt = (n: number) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })
const fmtSigned = (n: number) => (n > 0 ? '+' : '') + fmt(n)
const who = (e: string | null) => (e || '').split('@')[0] || '—'
const dt = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function InventoryLedgerPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [moves, setMoves] = useState<Mv[]>([])
  const [prods, setProds] = useState<Record<string, Prod>>({})
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'item' | 'txns'>('item')
  const [search, setSearch] = useState('')
  const [dir, setDir] = useState<'all' | 'in' | 'out'>('all')
  const [openSku, setOpenSku] = useState<Record<string, boolean>>({})

  useEffect(() => { (async () => {
    const since = new Date(); since.setFullYear(since.getFullYear() - 1)
    const { data: mv } = await sb.from('inventory_movements')
      .select('id, sku, product_id, movement_type, qty, uom, pack_qty, lot_number, note, ref_table, created_by, created_at')
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: true }).range(0, 4999)
    const rows = (mv as Mv[]) || []
    setMoves(rows)
    const { data: ps } = await sb.from('products').select('sku, product_name, on_hand_qty, unit_of_measure').range(0, 9999)
    const map: Record<string, Prod> = {}
    for (const p of (ps as any[]) || []) map[String(p.sku)] = { sku: p.sku, product_name: p.product_name, on_hand_qty: p.on_hand_qty, uom: p.unit_of_measure }
    setProds(map)
    setLoading(false)
  })() }, [sb])

  const nm = (sku: string) => prods[sku]?.product_name || sku
  const onHand = (sku: string) => Number(prods[sku]?.on_hand_qty || 0)

  // Per-SKU: sort asc, compute opening so the running balance ends exactly at current on-hand.
  const perSku = useMemo(() => {
    const bySku: Record<string, Mv[]> = {}
    for (const m of moves) { (bySku[m.sku] ||= []).push(m) }
    const out: Record<string, { rows: (Mv & { signed: number; balance: number })[]; net: number; totalIn: number; totalOut: number; opening: number; current: number }> = {}
    for (const sku of Object.keys(bySku)) {
      const asc = [...bySku[sku]].sort((a, b) => a.created_at.localeCompare(b.created_at))
      let net = 0, totalIn = 0, totalOut = 0
      for (const m of asc) { const s = signedQty(m); net += s; if (s >= 0) totalIn += s; else totalOut += -s }
      const current = onHand(sku)
      const opening = current - net
      let run = opening
      const rows = asc.map(m => { const signed = signedQty(m); run += signed; return { ...m, signed, balance: run } })
      out[sku] = { rows, net, totalIn, totalOut, opening, current }
    }
    return out
  }, [moves, prods]) // eslint-disable-line react-hooks/exhaustive-deps

  const q = search.trim().toLowerCase()
  const matchSku = (sku: string) => !q || sku.toLowerCase().includes(q) || nm(sku).toLowerCase().includes(q)
  const matchDir = (signed: number) => dir === 'all' || (dir === 'in' ? signed >= 0 : signed < 0)

  const skuList = Object.keys(perSku).filter(matchSku).sort((a, b) => nm(a).localeCompare(nm(b)))
  const flatTxns = useMemo(() => {
    const all: (Mv & { signed: number; balance: number })[] = []
    for (const sku of Object.keys(perSku)) all.push(...perSku[sku].rows)
    return all.filter(m => matchSku(m.sku) && matchDir(m.signed)).sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [perSku, q, dir]) // eslint-disable-line react-hooks/exhaustive-deps

  const totalIn = flatTxns.reduce((a, m) => a + (m.signed > 0 ? m.signed : 0), 0)
  const totalOut = flatTxns.reduce((a, m) => a + (m.signed < 0 ? -m.signed : 0), 0)

  const inp = 'bg-white border border-[#E4E6EE] text-gray-600 rounded-lg px-3 py-2 text-xs'
  const TypeBadge = ({ t, signed }: { t: string; signed: number }) => (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
      style={signed >= 0 ? { background: '#DCFCE7', color: '#15803D' } : { background: '#FEE2E2', color: '#B91C1C' }}>
      {signed >= 0 ? '▲' : '▼'} {prettyType(t)}
    </span>
  )

  return (
    <div className="px-[10%] py-6">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <h1 className="text-xl font-bold text-[#1A1D2E]">Inventory Ledger</h1>
        <div className="inline-flex rounded-lg overflow-hidden border border-[#E4E6EE]">
          <button onClick={() => setView('item')} className={`px-3 py-1.5 text-xs font-semibold ${view === 'item' ? 'bg-[#00863F] text-white' : 'bg-white text-gray-600'}`}>By item</button>
          <button onClick={() => setView('txns')} className={`px-3 py-1.5 text-xs font-semibold border-l border-[#E4E6EE] ${view === 'txns' ? 'bg-[#00863F] text-white' : 'bg-white text-gray-600'}`}>All transactions</button>
        </div>
      </div>
      <p className="text-gray-500 text-sm mb-4">Inbound credits and outbound debits for every item, with the resulting new stock. {loading ? '' : `${Object.keys(perSku).length} items · ${moves.length} entries`}</p>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Total In (credits)', value: '+' + fmt(totalIn), c: '#15803D' },
          { label: 'Total Out (debits)', value: '−' + fmt(totalOut), c: '#B91C1C' },
          { label: 'Net Change', value: fmtSigned(totalIn - totalOut), c: '#1A1D2E' },
          { label: 'Items Tracked', value: String(Object.keys(perSku).length), c: '#1A1D2E' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-[#ECEEF3] rounded-xl px-4 py-3">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{s.label}</p>
            <p className="text-lg font-bold mt-0.5" style={{ color: s.c }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search SKU or item name…" className={`${inp} flex-1 min-w-[200px]`} />
        <select value={dir} onChange={e => setDir(e.target.value as any)} className={`${inp} cursor-pointer`}>
          <option value="all">All movements</option>
          <option value="in">Inbound only</option>
          <option value="out">Outbound only</option>
        </select>
      </div>

      {loading ? <p className="text-sm text-gray-400 italic">Loading ledger…</p> : (
        view === 'item' ? (
          skuList.length === 0 ? <p className="text-sm text-gray-400 italic">No items match.</p> :
          <div className="space-y-2">
            {skuList.map(sku => {
              const d = perSku[sku]
              const isOpen = openSku[sku]
              const rows = d.rows.filter(m => matchDir(m.signed))
              if (dir !== 'all' && rows.length === 0) return null
              return (
                <div key={sku} className="bg-white border border-[#ECEEF3] rounded-xl overflow-hidden">
                  <button onClick={() => setOpenSku(o => ({ ...o, [sku]: !o[sku] }))} className="w-full flex items-center gap-3 px-4 py-3 text-left">
                    <span className="text-[10px] text-gray-400 w-3">{isOpen ? '▼' : '▶'}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[#1A1D2E] truncate">{nm(sku)}</p>
                      <p className="text-[11px] font-mono text-gray-400">{sku}</p>
                    </div>
                    <div className="hidden sm:block text-right w-24"><p className="text-[10px] text-gray-400 uppercase">In</p><p className="text-sm font-semibold text-emerald-600">+{fmt(d.totalIn)}</p></div>
                    <div className="hidden sm:block text-right w-24"><p className="text-[10px] text-gray-400 uppercase">Out</p><p className="text-sm font-semibold text-red-600">−{fmt(d.totalOut)}</p></div>
                    <div className="text-right w-28"><p className="text-[10px] text-gray-400 uppercase">On hand</p><p className="text-base font-bold text-[#1A1D2E]">{fmt(d.current)}<span className="text-[11px] text-gray-400 font-medium"> {prods[sku]?.uom || ''}</span></p></div>
                  </button>
                  {isOpen && (
                    <div className="border-t border-[#EEF0F4] overflow-x-auto">
                      <table className="w-full text-xs min-w-[640px]">
                        <thead>
                          <tr className="text-[10px] uppercase tracking-wide text-gray-400 bg-[#FBFCFE] border-b border-[#EEF0F4]">
                            <th className="text-left font-semibold px-4 py-2">Date</th>
                            <th className="text-left font-semibold px-3 py-2">Type</th>
                            <th className="text-left font-semibold px-3 py-2">Reference / Note</th>
                            <th className="text-right font-semibold px-3 py-2 w-[80px]">Credit</th>
                            <th className="text-right font-semibold px-3 py-2 w-[80px]">Debit</th>
                            <th className="text-right font-semibold px-4 py-2 w-[100px]">New stock</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-b border-[#F3F4F8] bg-[#FBFCFE]">
                            <td className="px-4 py-2 text-gray-400 italic" colSpan={5}>Opening balance</td>
                            <td className="px-4 py-2 text-right font-semibold text-gray-500">{fmt(d.opening)}</td>
                          </tr>
                          {[...rows].reverse().map(m => (
                            <tr key={m.id} className="border-b border-[#F3F4F8]">
                              <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{dt(m.created_at)}</td>
                              <td className="px-3 py-2"><TypeBadge t={m.movement_type || ''} signed={m.signed} /></td>
                              <td className="px-3 py-2 text-gray-500 max-w-[240px] truncate" title={m.note || ''}>{m.note || (m.ref_table ? m.ref_table : '')} {m.lot_number ? `· Lot ${m.lot_number}` : ''} <span className="text-gray-300">· {who(m.created_by)}</span></td>
                              <td className="px-3 py-2 text-right font-semibold text-emerald-600">{m.signed > 0 ? '+' + fmt(m.signed) : ''}</td>
                              <td className="px-3 py-2 text-right font-semibold text-red-600">{m.signed < 0 ? '−' + fmt(-m.signed) : ''}</td>
                              <td className="px-4 py-2 text-right font-bold text-[#1A1D2E]">{fmt(m.balance)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          flatTxns.length === 0 ? <p className="text-sm text-gray-400 italic">No transactions match.</p> :
          <div className="bg-white border border-[#ECEEF3] rounded-xl overflow-x-auto">
            <table className="w-full text-xs min-w-[820px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-gray-400 bg-[#FBFCFE] border-b border-[#EEF0F4]">
                  <th className="text-left font-semibold px-4 py-2.5">Date</th>
                  <th className="text-left font-semibold px-3 py-2.5">Item</th>
                  <th className="text-left font-semibold px-3 py-2.5">Type</th>
                  <th className="text-left font-semibold px-3 py-2.5">Reference / Note</th>
                  <th className="text-right font-semibold px-3 py-2.5 w-[80px]">Credit</th>
                  <th className="text-right font-semibold px-3 py-2.5 w-[80px]">Debit</th>
                  <th className="text-right font-semibold px-4 py-2.5 w-[100px]">New stock</th>
                </tr>
              </thead>
              <tbody>
                {flatTxns.map(m => (
                  <tr key={m.id} className="border-b border-[#F3F4F8] hover:bg-[#FBFCFE]">
                    <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{dt(m.created_at)}</td>
                    <td className="px-3 py-2.5"><span className="font-semibold text-[#1A1D2E]">{nm(m.sku)}</span> <span className="font-mono text-gray-400">· {m.sku}</span></td>
                    <td className="px-3 py-2.5"><TypeBadge t={m.movement_type || ''} signed={m.signed} /></td>
                    <td className="px-3 py-2.5 text-gray-500 max-w-[220px] truncate" title={m.note || ''}>{m.note || m.ref_table || ''} <span className="text-gray-300">· {who(m.created_by)}</span></td>
                    <td className="px-3 py-2.5 text-right font-semibold text-emerald-600">{m.signed > 0 ? '+' + fmt(m.signed) : ''}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-red-600">{m.signed < 0 ? '−' + fmt(-m.signed) : ''}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-[#1A1D2E]">{fmt(m.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}
