'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface WOrder { id: string; name: string | null; po_number: string | null; status: string | null; group_name: string | null; ship_due_date: string | null }
interface WLine { order_id: string; part_number: string | null; qty: number | null }
interface Prod { sku: string; product_name: string | null; on_hand_qty: number | null; case_qty: number | null; weight_per_unit_grams: number | null }
interface Bom { finished_good_sku: string; component_sku: string; uom_type: string | null; qty_value: number | null; percentage: number | null; is_case_level: boolean | null }

const fmtN = (n: number | null) => (n == null || isNaN(n) ? '—' : Number(n).toLocaleString())

export default function WalmartRequirements() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [orders, setOrders] = useState<WOrder[]>([])
  const [lines, setLines] = useState<Record<string, WLine[]>>({})
  const [products, setProducts] = useState<Prod[]>([])
  const [bom, setBom] = useState<Bom[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})

  useEffect(() => {
    (async () => {
      setLoading(true)
      const [{ data: o }, { data: l }, { data: p }, { data: b }] = await Promise.all([
        sb.from('walmart_board_orders').select('id, name, po_number, status, group_name, ship_due_date').eq('archived', false),
        sb.from('walmart_board_lines').select('order_id, part_number, qty'),
        sb.from('products').select('sku, product_name, on_hand_qty, case_qty, weight_per_unit_grams'),
        sb.from('product_bom').select('finished_good_sku, component_sku, uom_type, qty_value, percentage, is_case_level'),
      ])
      setOrders((o as WOrder[]) || [])
      const lm: Record<string, WLine[]> = {}
      for (const r of (l as WLine[]) || []) { (lm[r.order_id] ||= []).push(r) }
      setLines(lm)
      setProducts((p as Prod[]) || [])
      setBom((b as Bom[]) || [])
      setLoading(false)
    })()
  }, [sb])

  const productBySku = useMemo(() => {
    const m: Record<string, Prod> = {}
    for (const p of products) m[(p.sku || '').trim().toUpperCase()] = p
    return m
  }, [products])

  type Row = { po: string; poName: string; shipKey: number; sku: string; name: string | null; need: number; onHand: number; short: number | null }

  const perPo = useMemo(() => {
    const included = orders.filter(o => (o.group_name || '') !== 'Cancelled' && (o.status || '').toLowerCase() !== 'shipped' && (o.group_name || '') !== 'Shipped')
    const out: Row[] = []
    for (const o of included) {
      const poLabel = (o.po_number || o.name || '—')
      const shipKey = o.ship_due_date ? Date.parse(o.ship_due_date) : Number.POSITIVE_INFINITY
      const compForPo: Record<string, number> = {}
      for (const ln of (lines[o.id] || [])) {
        const fsku = (ln.part_number || '').trim().toUpperCase()
        const qq = Number(ln.qty) || 0
        if (!fsku || !qq) continue
        const fp = productBySku[fsku]
        for (const bb of bom) {
          if ((bb.finished_good_sku || '').trim().toUpperCase() !== fsku) continue
          const cs = (bb.component_sku || '').trim().toUpperCase()
          if (!cs) continue
          let perUnit = 0
          if (bb.uom_type === 'percentage') perUnit = ((Number(bb.qty_value ?? bb.percentage) || 0) / 100) * (Number(fp?.weight_per_unit_grams) || 0) / 453.592
          else if (bb.is_case_level) { const cq = Number(fp?.case_qty) || 0; perUnit = cq > 0 ? (Number(bb.qty_value) || 0) / cq : 0 }
          else perUnit = Number(bb.qty_value) || 0
          const need = perUnit * qq
          if (need <= 0) continue
          compForPo[cs] = (compForPo[cs] || 0) + need
        }
      }
      for (const [cs, need] of Object.entries(compForPo)) {
        const cp = productBySku[cs]
        out.push({ po: poLabel, poName: o.name || '', shipKey, sku: cs, name: cp?.product_name ?? null, need: Math.round(need * 100) / 100, onHand: Number(cp?.on_hand_qty ?? NaN), short: null })
      }
    }
    const consumed: Record<string, number> = {}
    for (const r of [...out].sort((a, b) => (a.shipKey - b.shipKey) || a.po.localeCompare(b.po))) {
      if (isNaN(r.onHand)) { r.short = null; continue }
      const used = consumed[r.sku] || 0
      const availNow = Math.max(0, r.onHand - used)
      r.short = Math.max(0, Math.round((r.need - availNow) * 100) / 100)
      consumed[r.sku] = used + r.need
    }
    out.sort((a, b) => a.po.localeCompare(b.po) || a.sku.localeCompare(b.sku))
    return out
  }, [orders, lines, bom, productBySku])

  const groups = useMemo(() => {
    const ql = q.trim().toLowerCase()
    const m = new Map<string, { po: string; poName: string; rows: Row[] }>()
    for (const r of perPo) {
      const hit = !ql || r.po.toLowerCase().includes(ql) || r.sku.toLowerCase().includes(ql) || (r.name || '').toLowerCase().includes(ql) || r.poName.toLowerCase().includes(ql)
      if (!hit) continue
      if (!m.has(r.po)) m.set(r.po, { po: r.po, poName: r.poName, rows: [] })
      m.get(r.po)!.rows.push(r)
    }
    return [...m.values()].map(g => ({ ...g, shortCount: g.rows.filter(r => (r.short ?? 0) > 0).length }))
  }, [perPo, q])

  return (
    <div className="bg-white rounded-2xl border border-[#E4E6EE] overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4 border-b border-[#E4E6EE]">
        <div>
          <h2 className="text-lg font-bold text-[#1A1D2E]">Walmart PO Requirements</h2>
          <p className="text-xs text-gray-500 mt-0.5">{loading ? 'Loading…' : `${groups.length} PO${groups.length === 1 ? '' : 's'}`} · click a PO to see its BOM components · shipped POs drop off</p>
        </div>
        <div className="relative">
          <i className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
          <input placeholder="Search PO or component…" value={q} onChange={e => setQ(e.target.value)} className="pl-9 pr-4 py-2 text-sm bg-white border border-[#E4E6EE] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>
      <div>
        {loading ? <div className="px-6 py-16 text-center text-gray-400 text-sm">Loading…</div>
         : groups.length === 0 ? <div className="px-6 py-16 text-center text-gray-400 text-sm">No BOM components needed for active Walmart POs.</div>
         : groups.map(g => {
          const isOpen = !!open[g.po]
          return (
            <div key={g.po} className="border-b border-[#EEF0F4] last:border-b-0">
              <button onClick={() => setOpen(o => ({ ...o, [g.po]: !o[g.po] }))} className="w-full flex items-center gap-3 px-4 sm:px-6 py-3 hover:bg-[#F8FAFC] text-left transition-colors">
                <span className="text-[11px] text-gray-400 shrink-0" style={{ display: 'inline-block', transition: 'transform .15s', transform: isOpen ? 'rotate(90deg)' : 'none' }}>&#9654;</span>
                <span className="font-bold text-sm text-[#0F172A] shrink-0">{g.po}</span>
                {g.poName && g.poName !== g.po && <span className="text-xs text-gray-400 truncate hidden sm:block">{g.poName}</span>}
                <span className="ml-auto text-[11px] font-medium text-gray-500 shrink-0">{g.rows.length} component{g.rows.length === 1 ? '' : 's'}</span>
                {g.shortCount > 0
                  ? <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200 shrink-0">{g.shortCount} short</span>
                  : <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 shrink-0">OK</span>}
              </button>
              {isOpen && (
                <div className="overflow-x-auto bg-[#FBFCFE] border-t border-[#EEF0F4]">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead><tr className="text-[10px] uppercase text-gray-400">
                      <th className="text-left px-6 py-2">Component</th>
                      <th className="text-left px-3 py-2">Description</th>
                      <th className="text-right px-3 py-2">Qty Needed</th>
                      <th className="text-right px-3 py-2">On Hand</th>
                      <th className="text-right px-6 py-2">Short</th>
                    </tr></thead>
                    <tbody>
                      {g.rows.map((r, i) => (
                        <tr key={r.sku + i} className="border-t border-[#EEF0F4]">
                          <td className="px-6 py-2 font-mono text-gray-700">{r.sku}</td>
                          <td className="px-3 py-2 text-gray-500 max-w-[240px] truncate" title={r.name || ''}>{r.name || '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-700 tabular-nums">{fmtN(r.need)}</td>
                          <td className="px-3 py-2 text-right text-gray-600 tabular-nums">{fmtN(r.onHand)}</td>
                          <td className="px-6 py-2 text-right">{r.short == null ? <span className="text-gray-300">n/a</span> : r.short <= 0 ? <span className="text-[11px] font-semibold text-emerald-600">OK</span> : <span className="text-[11px] font-semibold text-red-500">short {fmtN(r.short)}</span>}</td>
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
      <div className="px-6 py-2 border-t border-[#EEF0F4]"><p className="text-[11px] text-gray-400">On Hand is the shared inventory pool; Short accounts for stock already claimed by earlier-shipping POs (by ship date).</p></div>
    </div>
  )
}
