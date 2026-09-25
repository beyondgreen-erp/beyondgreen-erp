'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

interface WOrder { id: string; name: string | null; po_number: string | null; status: string | null; group_name: string | null; order_date: string | null; bol_date: string | null; ship_due_date: string | null; units: number | null; total_value: number | null }
interface WLine { order_id: string; part_number: string | null; qty: number | null }
interface Prod { sku: string; product_name: string | null; on_hand_qty: number | null; case_qty: number | null; weight_per_unit_grams: number | null }
interface Bom { finished_good_sku: string; component_sku: string; uom_type: string | null; qty_value: number | null; percentage: number | null; is_case_level: boolean | null }

const money = (n: number) => '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtD = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const isShipped = (o: WOrder) => (o.status || '').toLowerCase() === 'shipped' || (o.group_name || '') === 'Shipped'
const isCancelled = (o: WOrder) => (o.group_name || '') === 'Cancelled' || (o.status || '').toLowerCase() === 'cancelled'
const monthOf = (d: string | null) => d ? d.slice(0, 7) : ''

function monthOptions(): { v: string; label: string }[] {
  const out: { v: string; label: string }[] = []
  const now = new Date()
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const v = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
    out.push({ v, label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) })
  }
  return out
}

export default function WalmartActivityReport() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [orders, setOrders] = useState<WOrder[]>([])
  const [lines, setLines] = useState<Record<string, WLine[]>>({})
  const [products, setProducts] = useState<Prod[]>([])
  const [bom, setBom] = useState<Bom[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const months = useMemo(monthOptions, [])
  const [month, setMonth] = useState(months[0].v)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: o }, { data: l }, { data: p }, { data: b }] = await Promise.all([
      sb.from('walmart_board_orders').select('id, name, po_number, status, group_name, order_date, bol_date, ship_due_date, units, total_value').eq('archived', false),
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
    const ch = sb.channel('walmart-activity-report-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'walmart_board_orders' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'walmart_board_lines' }, bump)
      .subscribe()
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => { clearTimeout(t); sb.removeChannel(ch); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus) }
  }, [load])

  const productBySku = useMemo(() => {
    const m: Record<string, Prod> = {}
    for (const p of products) m[(p.sku || '').trim().toUpperCase()] = p
    return m
  }, [products])

  const added = useMemo(() => orders.filter(o => !isCancelled(o) && monthOf(o.order_date) === month), [orders, month])
  const shipped = useMemo(() => orders.filter(o => isShipped(o) && monthOf(o.bol_date) === month), [orders, month])
  const openOrders = useMemo(() => orders.filter(o => !isShipped(o) && !isCancelled(o)), [orders])

  const material = useMemo(() => {
    const comp: Record<string, { need: number; onHand: number; name: string | null }> = {}
    for (const o of openOrders) {
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
          if (!comp[cs]) comp[cs] = { need: 0, onHand: Number(productBySku[cs]?.on_hand_qty ?? NaN), name: productBySku[cs]?.product_name ?? null }
          comp[cs].need += need
        }
      }
    }
    return Object.entries(comp).map(([sku, v]) => ({ sku, name: v.name, need: Math.round(v.need * 100) / 100, onHand: v.onHand, short: isNaN(v.onHand) ? null : Math.max(0, Math.round((v.need - v.onHand) * 100) / 100) })).sort((a, b) => (b.short ?? 0) - (a.short ?? 0) || a.sku.localeCompare(b.sku))
  }, [openOrders, lines, bom, productBySku])

  const missingFg = useMemo(() => {
    const ord: Record<string, number> = {}
    for (const o of openOrders) for (const ln of (lines[o.id] || [])) {
      const fsku = (ln.part_number || '').trim().toUpperCase(); const qq = Number(ln.qty) || 0
      if (!fsku || !qq) continue
      ord[fsku] = (ord[fsku] || 0) + qq
    }
    return Object.entries(ord).map(([sku, need]) => {
      const p = productBySku[sku]; const onHand = Number(p?.on_hand_qty ?? NaN)
      return { sku, name: p?.product_name ?? null, need, onHand, short: isNaN(onHand) ? null : Math.max(0, need - onHand) }
    }).sort((a, b) => (b.short ?? 0) - (a.short ?? 0) || a.sku.localeCompare(b.sku))
  }, [openOrders, lines, productBySku])

  const shippedValue = useMemo(() => shipped.reduce((s, o) => s + (Number(o.total_value) || 0), 0), [shipped])
  const addedUnits = useMemo(() => added.reduce((s, o) => s + (Number(o.units) || 0), 0), [added])
  // Per-PO shortage rows — same ship-date allocation the PO Requirements list uses,
  // so the headline count reconciles with the per-PO "short" badges.
  const perPoRows = useMemo(() => {
    type Row = { po: string; shipKey: number; sku: string; need: number; onHand: number; short: number | null }
    const out: Row[] = []
    for (const o of openOrders) {
      const poLabel = o.po_number || o.name || '—'
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
        out.push({ po: poLabel, shipKey, sku: cs, need, onHand: Number(cp?.on_hand_qty ?? NaN), short: null })
      }
    }
    const consumed: Record<string, number> = {}
    for (const r of [...out].sort((a, b) => (a.shipKey - b.shipKey) || a.po.localeCompare(b.po))) {
      if (isNaN(r.onHand)) { r.short = null; continue }
      const used = consumed[r.sku] || 0
      const availNow = Math.max(0, r.onHand - used)
      r.short = Math.max(0, r.need - availNow)
      consumed[r.sku] = used + r.need
    }
    return out
  }, [openOrders, lines, bom, productBySku])

  const shortLines = perPoRows.filter(r => (r.short ?? 0) > 0).length
  const posWithShort = new Set(perPoRows.filter(r => (r.short ?? 0) > 0).map(r => r.po)).size
  const shortSkus = new Set(perPoRows.filter(r => (r.short ?? 0) > 0).map(r => r.sku)).size

  function download() {
    setBusy(true)
    try {
      const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' })
      const M = 40
      const GREEN: [number, number, number] = [15, 122, 78]
      const DARK: [number, number, number] = [26, 29, 46]
      const RED: [number, number, number] = [220, 38, 38]
      const monthLabel = months.find(m => m.v === month)?.label || month
      let y = 46
      doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]); doc.text('beyondGREEN', M, y)
      doc.setTextColor(DARK[0], DARK[1], DARK[2]); doc.setFontSize(13); doc.text('Walmart Activity Report', M, y + 18)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(120, 120, 120)
      doc.text(monthLabel + '  ·  generated ' + new Date().toLocaleString(), M, y + 32)
      y += 56

      const section = (title: string) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(DARK[0], DARK[1], DARK[2]); doc.text(title, M, y); y += 8 }
      const nextY = () => { y = (doc as any).lastAutoTable.finalY + 22 }

      section('Orders Shipped')
      autoTable(doc, {
        startY: y,
        head: [['PO #', 'Ship Date', 'Units', 'Value ($)']],
        body: shipped.length ? shipped.map(o => [o.po_number || o.name || '—', fmtD(o.bol_date), (Number(o.units) || 0).toLocaleString(), money(Number(o.total_value) || 0)]) : [['—', 'No shipments this month', '', '']],
        foot: shipped.length ? [['TOTAL', '', shipped.reduce((s, o) => s + (Number(o.units) || 0), 0).toLocaleString(), money(shippedValue)]] : undefined,
        theme: 'grid', headStyles: { fillColor: DARK, textColor: [255, 255, 255], fontSize: 8 }, footStyles: { fillColor: [236, 240, 243], textColor: DARK, fontStyle: 'bold', fontSize: 8 }, bodyStyles: { fontSize: 8, textColor: DARK }, columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } }, margin: { left: M, right: M },
      })
      nextY()

      section('Orders Added')
      autoTable(doc, {
        startY: y,
        head: [['PO #', 'Order Date', 'Status', 'Units']],
        body: added.length ? added.map(o => [o.po_number || o.name || '—', fmtD(o.order_date), o.status || 'Pending', (Number(o.units) || 0).toLocaleString()]) : [['—', 'No new orders this month', '', '']],
        foot: added.length ? [['TOTAL', '', '', addedUnits.toLocaleString()]] : undefined,
        theme: 'grid', headStyles: { fillColor: DARK, textColor: [255, 255, 255], fontSize: 8 }, footStyles: { fillColor: [236, 240, 243], textColor: DARK, fontStyle: 'bold', fontSize: 8 }, bodyStyles: { fontSize: 8, textColor: DARK }, columnStyles: { 3: { halign: 'right' } }, margin: { left: M, right: M },
      })
      nextY()

      section('Current Material Requirements (open POs, BOM-exploded)')
      autoTable(doc, {
        startY: y,
        head: [['Component', 'Description', 'Qty Needed', 'On Hand', 'Short']],
        body: material.length ? material.map(r => [r.sku, r.name || '', Math.round(r.need).toLocaleString(), isNaN(r.onHand) ? '—' : Math.round(r.onHand).toLocaleString(), r.short == null ? 'n/a' : (r.short <= 0 ? 'OK' : Math.round(r.short).toLocaleString())]) : [['—', 'No open POs', '', '', '']],
        theme: 'grid', headStyles: { fillColor: DARK, textColor: [255, 255, 255], fontSize: 8 }, bodyStyles: { fontSize: 7.5, textColor: DARK }, columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right', fontStyle: 'bold' } }, margin: { left: M, right: M },
        didParseCell: (d: any) => { if (d.section === 'body' && d.column.index === 4 && d.cell.raw !== 'OK' && d.cell.raw !== 'n/a' && d.cell.raw !== '') d.cell.styles.textColor = RED },
      })
      nextY()

      section('Missing Finished Goods (open ordered vs on hand)')
      autoTable(doc, {
        startY: y,
        head: [['BG P/N', 'Product', 'Ordered (open)', 'On Hand', 'Short']],
        body: missingFg.length ? missingFg.map(r => [r.sku, r.name || '', r.need.toLocaleString(), isNaN(r.onHand) ? '—' : r.onHand.toLocaleString(), r.short == null ? 'n/a' : (r.short <= 0 ? 'OK' : r.short.toLocaleString())]) : [['—', 'No open POs', '', '', '']],
        theme: 'grid', headStyles: { fillColor: DARK, textColor: [255, 255, 255], fontSize: 8 }, bodyStyles: { fontSize: 7.5, textColor: DARK }, columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right', fontStyle: 'bold' } }, margin: { left: M, right: M },
        didParseCell: (d: any) => { if (d.section === 'body' && d.column.index === 4 && d.cell.raw !== 'OK' && d.cell.raw !== 'n/a' && d.cell.raw !== '') d.cell.styles.textColor = RED },
      })

      doc.save('beyondGREEN_Walmart_Activity_Report_' + month + '.pdf')
    } finally { setBusy(false) }
  }

  return (
    <div className="bg-white rounded-2xl border border-[#E4E6EE] overflow-hidden mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4 border-b border-[#E4E6EE]">
        <div>
          <h2 className="text-lg font-bold text-[#1A1D2E]">Walmart Activity Report</h2>
          <p className="text-xs text-gray-500 mt-0.5">{loading ? 'Loading…' : 'Live · updates as orders are entered and shipped'}</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={month} onChange={e => setMonth(e.target.value)} className="px-3 py-2 text-sm bg-white border border-[#E4E6EE] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
            {months.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}
          </select>
          <button onClick={download} disabled={loading || busy} title="Download the full Walmart activity report as a PDF" className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg bg-[#0071CE] text-white hover:bg-[#005fa8] disabled:opacity-50 transition-colors"><i className="ti ti-download" />{busy ? 'Generating…' : 'Download Activity Report'}</button>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-[#EEF0F4]">
        <div className="px-6 py-4"><p className="text-[11px] uppercase text-gray-400 font-semibold">Orders Added</p><p className="text-2xl font-bold text-[#1A1D2E] mt-1">{added.length}</p><p className="text-[11px] text-gray-500">{addedUnits.toLocaleString()} units</p></div>
        <div className="px-6 py-4"><p className="text-[11px] uppercase text-gray-400 font-semibold">Orders Shipped</p><p className="text-2xl font-bold text-[#1A1D2E] mt-1">{shipped.length}</p><p className="text-[11px] text-gray-500">{money(shippedValue)}</p></div>
        <div className="px-6 py-4"><p className="text-[11px] uppercase text-gray-400 font-semibold">Open POs</p><p className="text-2xl font-bold text-[#1A1D2E] mt-1">{openOrders.length}</p><p className="text-[11px] text-gray-500">awaiting ship</p></div>
        <div className="px-6 py-4"><p className="text-[11px] uppercase text-gray-400 font-semibold">Short Lines</p><p className={'text-2xl font-bold mt-1 ' + (shortLines ? 'text-red-600' : 'text-emerald-600')}>{shortLines}</p><p className="text-[11px] text-gray-500">{shortSkus} component{shortSkus === 1 ? '' : 's'} · {posWithShort} PO{posWithShort === 1 ? '' : 's'}</p></div>
      </div>
      <div className="px-6 py-2 border-t border-[#EEF0F4]"><p className="text-[11px] text-gray-400">Added &amp; shipped counts cover the selected month; material &amp; finished-goods shortages reflect all open POs. Shipped POs drop off the requirements.</p></div>
    </div>
  )
}
