'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

interface WOrder { id: string; name: string | null; po_number: string | null; status: string | null; group_name: string | null; ship_due_date: string | null }
interface WLine { order_id: string; part_number: string | null; qty: number | null }
interface Prod { sku: string; product_name: string | null; on_hand_qty: number | null; case_qty: number | null; weight_per_unit_grams: number | null }
interface Bom { finished_good_sku: string; component_sku: string; uom_type: string | null; qty_value: number | null; percentage: number | null; is_case_level: boolean | null }

const fmtN = (n: number | null) => (n == null || isNaN(n) ? '—' : Number(n).toLocaleString())
// The pack count (24 or 48) lives at the end of the finished-good SKU (e.g. 22GVF48 -> 48).
const ctOf = (sku: string) => { const m = /(\d+)\s*$/.exec(sku || ''); return m ? Number(m[1]) : 0 }

export default function WalmartRequirements() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [orders, setOrders] = useState<WOrder[]>([])
  const [lines, setLines] = useState<Record<string, WLine[]>>({})
  const [products, setProducts] = useState<Prod[]>([])
  const [bom, setBom] = useState<Bom[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [sel, setSel] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
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
  }, [sb])

  useEffect(() => {
    load()
    let t: any
    const bump = () => { clearTimeout(t); t = setTimeout(() => load(), 400) }
    const ch = sb.channel('walmart-po-requirements-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'walmart_board_orders' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'walmart_board_lines' }, bump)
      .subscribe()
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => { clearTimeout(t); sb.removeChannel(ch); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus) }
  }, [load, sb])

  const productBySku = useMemo(() => {
    const m: Record<string, Prod> = {}
    for (const p of products) m[(p.sku || '').trim().toUpperCase()] = p
    return m
  }, [products])

  type Row = { po: string; poName: string; shipKey: number; sku: string; name: string | null; srps: number; packs: number; pieces: number }

  // Per PO, per finished-good SKU: how many SRPs, packs (24/48-ct) and total pieces the order requires.
  // SRPs come from the "-SI" BOM line, packs from the "-P" line (6 packs per SRP), pieces = packs x pack-count.
  const perPo = useMemo(() => {
    const included = orders.filter(o => (o.group_name || '') !== 'Cancelled' && (o.status || '').toLowerCase() !== 'shipped' && (o.group_name || '') !== 'Shipped')
    const map = new Map<string, Row>()
    for (const o of included) {
      const poLabel = (o.po_number || o.name || '—')
      const shipKey = o.ship_due_date ? Date.parse(o.ship_due_date) : Number.POSITIVE_INFINITY
      for (const ln of (lines[o.id] || [])) {
        const fsku = (ln.part_number || '').trim().toUpperCase()
        const qq = Number(ln.qty) || 0
        if (!fsku || !qq) continue
        const fp = productBySku[fsku]
        let packs = 0, srps = 0
        for (const bb of bom) {
          if ((bb.finished_good_sku || '').trim().toUpperCase() !== fsku) continue
          const cs = (bb.component_sku || '').trim().toUpperCase()
          if (!cs.endsWith('-P') && !cs.endsWith('-SI')) continue
          let perUnit = 0
          if (bb.is_case_level) { const cq = Number(fp?.case_qty) || 0; perUnit = cq > 0 ? (Number(bb.qty_value) || 0) / cq : 0 }
          else perUnit = Number(bb.qty_value) || 0
          const need = perUnit * qq
          if (cs.endsWith('-SI')) srps += need
          else packs += need
        }
        const ct = ctOf(fsku)
        if (!packs && srps) packs = srps * 6
        if (!srps && packs) srps = packs / 6
        let pieces = packs * ct
        if (!pieces && srps) pieces = srps * 6 * ct
        srps = Math.round(srps); packs = Math.round(packs); pieces = Math.round(pieces)
        if (srps <= 0 && packs <= 0 && pieces <= 0) continue
        const key = poLabel + '||' + fsku
        const ex = map.get(key)
        if (ex) { ex.srps += srps; ex.packs += packs; ex.pieces += pieces }
        else map.set(key, { po: poLabel, poName: o.name || '', shipKey, sku: fsku, name: fp?.product_name ?? null, srps, packs, pieces })
      }
    }
    return [...map.values()].sort((a, b) => a.po.localeCompare(b.po) || a.sku.localeCompare(b.sku))
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
    return [...m.values()].map(g => ({
      ...g,
      srps: g.rows.reduce((s, r) => s + r.srps, 0),
      packs: g.rows.reduce((s, r) => s + r.packs, 0),
      pieces: g.rows.reduce((s, r) => s + r.pieces, 0),
    }))
  }, [perPo, q])

  function exportPdf(onlySelected = false) {
    const useGroups = onlySelected ? groups.filter(g => sel[g.po]) : groups
    if (useGroups.length === 0) return
    const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' })
    const M = 40
    const GREEN: [number, number, number] = [15, 122, 78]
    const DARK: [number, number, number] = [26, 29, 46]
    let y = 46
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(GREEN[0], GREEN[1], GREEN[2])
    doc.text('beyondGREEN', M, y)
    doc.setTextColor(DARK[0], DARK[1], DARK[2]); doc.setFontSize(13)
    doc.text('Walmart PO Requirements', M, y + 18)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(120, 120, 120)
    doc.text('Generated ' + new Date().toLocaleString(), M, y + 32)
    const tSrps = useGroups.reduce((s, g) => s + g.srps, 0)
    const tPacks = useGroups.reduce((s, g) => s + g.packs, 0)
    const tPieces = useGroups.reduce((s, g) => s + g.pieces, 0)
    doc.text(useGroups.length + ' active POs' + (onlySelected ? ' (selected)' : '') + '  ·  ' + tSrps.toLocaleString() + ' SRPs  ·  ' + tPacks.toLocaleString() + ' packs  ·  ' + tPieces.toLocaleString() + ' pieces  ·  shipped POs excluded', M, y + 46)
    y += 66

    const body: any[] = []
    for (const g of useGroups) {
      for (const r of g.rows) body.push([r.po, r.sku, (r.name || ''), r.srps.toLocaleString(), r.packs.toLocaleString(), r.pieces.toLocaleString()])
    }
    autoTable(doc, {
      startY: y,
      head: [['PO', 'Finished SKU', 'Description', 'SRPs', 'Packs', 'Pieces']],
      body,
      foot: [['TOTAL', '', '', tSrps.toLocaleString(), tPacks.toLocaleString(), tPieces.toLocaleString()]],
      theme: 'grid',
      headStyles: { fillColor: DARK, textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
      footStyles: { fillColor: [236, 240, 243], textColor: DARK, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 7.5, textColor: DARK },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 0: { cellWidth: 84 }, 1: { cellWidth: 76 }, 2: { cellWidth: 150 }, 3: { cellWidth: 58, halign: 'right' }, 4: { cellWidth: 58, halign: 'right' }, 5: { cellWidth: 62, halign: 'right', fontStyle: 'bold' } },
      margin: { left: M, right: M },
    })
    doc.save('beyondGREEN_Walmart_PO_Requirements' + (onlySelected ? '_selected' : '') + '_' + new Date().toISOString().slice(0, 10) + '.pdf')
  }

  const selCount = Object.keys(sel).filter(k => sel[k]).length
  const allSelected = groups.length > 0 && groups.every(g => sel[g.po])

  return (
    <div className="bg-white rounded-2xl border border-[#E4E6EE] overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4 border-b border-[#E4E6EE]">
        <div>
          <h2 className="text-lg font-bold text-[#1A1D2E]">Walmart PO Requirements</h2>
          <p className="text-xs text-gray-500 mt-0.5">{loading ? 'Loading…' : `${groups.length} PO${groups.length === 1 ? '' : 's'}`} · packs (24/48-ct) & SRPs (6 packs each) per finished SKU · shipped POs drop off</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => load()} disabled={loading} title="Reload latest Walmart PO data" className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-[#E4E6EE] text-gray-600 hover:bg-[#F5F6FA] disabled:opacity-50 transition-colors"><i className={'ti ti-refresh' + (loading ? ' animate-spin' : '')} />Refresh</button>
          <button onClick={() => exportPdf(selCount > 0)} disabled={loading || groups.length === 0} title={selCount > 0 ? `Export a PDF of the ${selCount} selected PO(s)` : 'Download a PDF report of all POs'} className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg bg-[#0071CE] text-white hover:bg-[#005fa8] disabled:opacity-50 transition-colors"><i className="ti ti-file-type-pdf" />{selCount > 0 ? `Export Selected (${selCount})` : 'Export PDF'}</button>
          <div className="relative">
            <i className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
            <input placeholder="Search PO or SKU…" value={q} onChange={e => setQ(e.target.value)} className="pl-9 pr-4 py-2 text-sm bg-white border border-[#E4E6EE] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
      </div>
      {!loading && groups.length > 0 && (
        <div className="flex items-center gap-3 px-4 sm:px-6 py-2 bg-[#FBFCFE] border-b border-[#EEF0F4] text-xs text-gray-500">
          <input type="checkbox" checked={allSelected} onChange={e => { const on = e.target.checked; setSel(() => { const n: Record<string, boolean> = {}; if (on) groups.forEach(g => { n[g.po] = true }); return n }) }} className="w-4 h-4 accent-[#0071CE] cursor-pointer shrink-0" title="Select all POs" />
          <span>{selCount > 0 ? `${selCount} PO${selCount === 1 ? '' : 's'} selected — use Export Selected to export just these` : 'Tip: check specific POs to export only those'}</span>
          {selCount > 0 && <button onClick={() => setSel({})} className="ml-auto text-[#0071CE] font-medium hover:underline">Clear</button>}
        </div>
      )}
      <div>
        {loading ? <div className="px-6 py-16 text-center text-gray-400 text-sm">Loading…</div>
         : groups.length === 0 ? <div className="px-6 py-16 text-center text-gray-400 text-sm">No active Walmart POs.</div>
         : groups.map(g => {
          const isOpen = !!open[g.po]
          return (
            <div key={g.po} className="border-b border-[#EEF0F4] last:border-b-0">
              <div className="w-full flex items-center gap-3 px-4 sm:px-6 py-3 hover:bg-[#F8FAFC] transition-colors">
                <input type="checkbox" checked={!!sel[g.po]} onChange={e => setSel(s => ({ ...s, [g.po]: e.target.checked }))} className="w-4 h-4 accent-[#0071CE] cursor-pointer shrink-0" title="Select this PO for export" />
                <button onClick={() => setOpen(o => ({ ...o, [g.po]: !o[g.po] }))} className="flex-1 flex items-center gap-3 text-left">
                  <span className="text-[11px] text-gray-400 shrink-0" style={{ display: 'inline-block', transition: 'transform .15s', transform: isOpen ? 'rotate(90deg)' : 'none' }}>&#9654;</span>
                  <span className="font-bold text-sm text-[#0F172A] shrink-0">{g.po}</span>
                  {g.poName && g.poName !== g.po && <span className="text-xs text-gray-400 truncate hidden sm:block">{g.poName}</span>}
                  <span className="ml-auto flex items-center gap-3 text-[11px] font-medium text-gray-500 shrink-0">
                    <span><b className="text-[#0F172A]">{fmtN(g.srps)}</b> SRPs</span>
                    <span><b className="text-[#0F172A]">{fmtN(g.packs)}</b> packs</span>
                    <span><b className="text-[#0F172A]">{fmtN(g.pieces)}</b> pcs</span>
                  </span>
                </button>
              </div>
              {isOpen && (
                <div className="overflow-x-auto bg-[#FBFCFE] border-t border-[#EEF0F4]">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead><tr className="text-[10px] uppercase text-gray-400">
                      <th className="text-left px-6 py-2">Finished SKU</th>
                      <th className="text-left px-3 py-2">Description</th>
                      <th className="text-right px-3 py-2">SRPs</th>
                      <th className="text-right px-3 py-2">Packs</th>
                      <th className="text-right px-6 py-2">Pieces</th>
                    </tr></thead>
                    <tbody>
                      {g.rows.map((r, i) => (
                        <tr key={r.sku + i} className="border-t border-[#EEF0F4]">
                          <td className="px-6 py-2 font-mono text-gray-700">{r.sku}</td>
                          <td className="px-3 py-2 text-gray-500 max-w-[240px] truncate" title={r.name || ''}>{r.name || '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-700 tabular-nums">{fmtN(r.srps)}</td>
                          <td className="px-3 py-2 text-right text-gray-700 tabular-nums">{fmtN(r.packs)}</td>
                          <td className="px-6 py-2 text-right text-gray-900 font-semibold tabular-nums">{fmtN(r.pieces)}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-[#E4E6EE] bg-white">
                        <td className="px-6 py-2 font-semibold text-gray-700" colSpan={2}>PO total</td>
                        <td className="px-3 py-2 text-right font-semibold text-gray-800 tabular-nums">{fmtN(g.srps)}</td>
                        <td className="px-3 py-2 text-right font-semibold text-gray-800 tabular-nums">{fmtN(g.packs)}</td>
                        <td className="px-6 py-2 text-right font-bold text-gray-900 tabular-nums">{fmtN(g.pieces)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="px-6 py-2 border-t border-[#EEF0F4]"><p className="text-[11px] text-gray-400">Packs use the 24/48-ct in each finished SKU; SRPs = 6 packs; Pieces = packs × pack-count. Assorted kits count total utensil pieces.</p></div>
    </div>
  )
}
