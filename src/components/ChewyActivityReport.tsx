'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const DONE = ['shipped', 'completed', 'closed', 'cancelled']
const isCaseUom = (u?: string | null) => /case/i.test(u || '')
const G_PER_LB = 453.59237

const fmtN = (n: number | null, d = 0) => (n == null || isNaN(n) ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d }))
const fmtDate = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'

function recentMonths(count = 12) {
  const out: { value: string; label: string }[] = []
  const now = new Date()
  for (let i = 0; i < count; i++) {
    const dt = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const value = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0')
    const label = dt.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    out.push({ value, label })
  }
  return out
}
function monthRange(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  const start = ym + '-01'
  const endD = new Date(y, m, 0)
  const end = ym + '-' + String(endD.getDate()).padStart(2, '0')
  const label = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  return { start, end, label }
}
const lineQty = (l: any) => Number(l.quantity ?? l.qty) || 0

export default function ChewyActivityReport() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const months = useMemo(() => recentMonths(12), [])
  const [month, setMonth] = useState(months[0].value)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function generate() {
    setBusy(true); setMsg('Building ledger…')
    try {
      const { start, end, label } = monthRange(month)
      const [{ data: soData }, { data: lineData }, { data: prodData }, { data: bomData }, { data: shipData }] = await Promise.all([
        sb.from('sales_orders').select('id, order_number, po_number, status, order_section, order_date, customer:customers(company_name)').eq('archived', false).eq('is_active', true),
        sb.from('sales_order_lines').select('sales_order_id, sku, qty, quantity, unit_of_measure'),
        sb.from('products').select('sku, product_name, pieces_per_pack, packs_per_case, weight_per_unit_grams, on_hand_qty'),
        sb.from('product_bom').select('finished_good_sku, component_sku, uom_type, percentage'),
        sb.from('shipments').select('po_number, ship_date, total_value, customer_name, sales_order_id, archived'),
      ])

      const orders = ((soData as any[]) || []).filter(o => {
        const sec = o.order_section || ''
        const cust = (o.customer?.company_name || '').trim().toLowerCase()
        return sec === 'Chewy' || cust === 'chewy'
      })
      const chewyIds = new Set(orders.map(o => o.id))
      const orderById: Record<string, any> = {}
      for (const o of orders) orderById[o.id] = o

      const linesByOrder: Record<string, any[]> = {}
      for (const ln of (lineData as any[]) || []) { if (chewyIds.has(ln.sales_order_id)) (linesByOrder[ln.sales_order_id] ||= []).push(ln) }
      const orderQty: Record<string, number> = {}
      for (const id of chewyIds) orderQty[id] = (linesByOrder[id] || []).reduce((a, l) => a + lineQty(l), 0)

      const prodBySku: Record<string, any> = {}
      for (const p of (prodData as any[]) || []) prodBySku[(p.sku || '').trim().toUpperCase()] = p
      const bomBySku: Record<string, any[]> = {}
      for (const b of (bomData as any[]) || []) { if (b.uom_type === 'percentage') (bomBySku[(b.finished_good_sku || '').trim().toUpperCase()] ||= []).push(b) }
      const skuName = (sku: string) => (prodBySku[(sku || '').trim().toUpperCase()]?.product_name) || sku || '—'

      // earliest ship date per Chewy order
      const shipDateByOrder: Record<string, string> = {}
      for (const s of (shipData as any[]) || []) {
        if (s.archived) continue
        const isChewy = (s.customer_name || '').trim().toLowerCase() === 'chewy' || chewyIds.has(s.sales_order_id)
        if (!isChewy || !s.sales_order_id || !s.ship_date) continue
        const cur = shipDateByOrder[s.sales_order_id]
        if (!cur || s.ship_date < cur) shipDateByOrder[s.sales_order_id] = s.ship_date
      }

      // Opening backlog at month start = entered before start AND not shipped before start
      let opening = 0
      for (const o of orders) {
        const od = o.order_date || ''
        if (od && od < start) {
          const sd = shipDateByOrder[o.id]
          if (!sd || sd >= start) opening += orderQty[o.id] || 0
        }
      }

      // Ledger events within the month
      type Ev = { date: string; kind: 'credit' | 'debit'; po: string; qty: number; lines: { sku: string; qty: number }[] }
      const events: Ev[] = []
      for (const o of orders) {
        const po = o.po_number || o.order_number || '—'
        const lns = (linesByOrder[o.id] || []).map(l => ({ sku: l.sku || '—', qty: lineQty(l) })).filter(l => l.qty)
        const od = o.order_date || ''
        if (od >= start && od <= end) events.push({ date: od, kind: 'credit', po, qty: orderQty[o.id] || 0, lines: lns })
        const sd = shipDateByOrder[o.id] || ''
        if (sd >= start && sd <= end) events.push({ date: sd, kind: 'debit', po, qty: orderQty[o.id] || 0, lines: lns })
      }
      const kindRank = (k: string) => (k === 'credit' ? 0 : 1)
      events.sort((a, b) => a.date.localeCompare(b.date) || kindRank(a.kind) - kindRank(b.kind) || a.po.localeCompare(b.po))

      // Build ledger rows (+ meta for styling)
      type Meta = 'opening' | 'hcredit' | 'hdebit' | 'scredit' | 'sdebit' | 'closing'
      const rows: any[][] = []
      const meta: Meta[] = []
      const push = (r: any[], m: Meta) => { rows.push(r); meta.push(m) }

      push(['', '', 'Opening backlog — ' + fmtDate(start), '', '', fmtN(opening)], 'opening')
      let bal = opening
      let totCredit = 0, totDebit = 0
      for (const ev of events) {
        if (ev.kind === 'credit') { bal += ev.qty; totCredit += ev.qty } else { bal -= ev.qty; totDebit += ev.qty }
        push([fmtDate(ev.date), ev.kind === 'credit' ? 'Entered' : 'Shipped', ev.po,
          ev.kind === 'credit' ? fmtN(ev.qty) : '', ev.kind === 'debit' ? fmtN(ev.qty) : '', fmtN(bal)],
          ev.kind === 'credit' ? 'hcredit' : 'hdebit')
        for (const l of ev.lines) {
          push(['', '', '↲ ' + l.sku + '  ' + skuName(l.sku), ev.kind === 'credit' ? fmtN(l.qty) : '', ev.kind === 'debit' ? fmtN(l.qty) : '', ''],
            ev.kind === 'credit' ? 'scredit' : 'sdebit')
        }
      }
      push(['', '', 'Closing backlog — ' + fmtDate(end), fmtN(totCredit), fmtN(totDebit), fmtN(bal)], 'closing')

      // ---- open-order aggregates for sections 2 & 3 ----
      const openIds = new Set(orders.filter(o => !DONE.includes((o.status || '').toLowerCase())).map(o => o.id))
      const needBySku: Record<string, number> = {}
      const packsBySku: Record<string, number> = {}
      for (const id of openIds) {
        for (const ln of (linesByOrder[id] || [])) {
          const sku = (ln.sku || '').trim().toUpperCase()
          const qty = lineQty(ln)
          if (!sku || !qty) continue
          needBySku[sku] = (needBySku[sku] || 0) + qty
          const ppc = Number(prodBySku[sku]?.packs_per_case) || 1
          packsBySku[sku] = (packsBySku[sku] || 0) + (isCaseUom(ln.unit_of_measure) ? qty * ppc : qty)
        }
      }
      const matRows = Object.entries(packsBySku).map(([sku, packs]) => {
        const p = prodBySku[sku]
        const pcs = p?.pieces_per_pack != null ? packs * Number(p.pieces_per_pack) : 0
        const wt = p?.weight_per_unit_grams != null ? Number(p.weight_per_unit_grams) : null
        const lbs = wt != null ? (pcs * wt) / G_PER_LB : null
        return { sku, name: p?.product_name || '', packs, pcs, wt, lbs }
      }).sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }))
      const matTotal = matRows.reduce((a, r) => a + (r.lbs || 0), 0)

      const missRows = Object.keys(needBySku).map(sku => {
        const p = prodBySku[sku]
        const onHand = p?.on_hand_qty != null ? Number(p.on_hand_qty) : null
        const need = needBySku[sku]
        const short = onHand == null ? null : Math.max(0, need - onHand)
        return { sku, name: p?.product_name || '', need, onHand, short }
      }).filter(r => (r.short ?? 0) > 0).sort((a, b) => (b.short || 0) - (a.short || 0))

      // ---- PDF ----
      const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' })
      const M = 40
      const BLUE: [number, number, number] = [28, 73, 194]
      const DARK: [number, number, number] = [26, 29, 46]
      const GREEN: [number, number, number] = [22, 128, 74]
      const RED: [number, number, number] = [201, 58, 58]
      const GREY: [number, number, number] = [120, 120, 120]
      doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(BLUE[0], BLUE[1], BLUE[2])
      doc.text('beyondGREEN — Chewy.com Order Ledger', M, 44)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(GREY[0], GREY[1], GREY[2])
      doc.text(label + '  ·  Generated ' + new Date().toLocaleString() + '  ·  quantities in units', M, 58)

      const section = (title: string, y: number) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(DARK[0], DARK[1], DARK[2]); doc.text(title, M, y); return y + 6 }
      const nextY = () => ((doc as any).lastAutoTable?.finalY || 66) + 22

      let y = section('1.  Order Ledger — Entries (credit) & Shipments (debit) by date', 78)
      autoTable(doc, {
        startY: y, theme: 'grid', margin: { left: M, right: M },
        head: [['Date', 'Type', 'PO / Item', 'Credit\n(Entered)', 'Debit\n(Shipped)', 'Balance\n(Open backlog)']],
        body: rows,
        headStyles: { fillColor: DARK, textColor: [255, 255, 255], fontSize: 7.5, fontStyle: 'bold' },
        bodyStyles: { fontSize: 7.5, textColor: DARK },
        columnStyles: { 0: { cellWidth: 52 }, 1: { cellWidth: 52 }, 2: { cellWidth: 253 }, 3: { cellWidth: 60, halign: 'right' }, 4: { cellWidth: 60, halign: 'right' }, 5: { cellWidth: 58, halign: 'right' } },
        didParseCell: (data: any) => {
          if (data.section !== 'body') return
          const m = meta[data.row.index]
          const c = data.column.index
          if (m === 'opening' || m === 'closing') {
            data.cell.styles.fillColor = [238, 242, 247]
            data.cell.styles.fontStyle = 'bold'
          } else if (m === 'hcredit' || m === 'hdebit') {
            if (c === 2) data.cell.styles.fontStyle = 'bold'
            if (c === 3 && data.cell.raw) data.cell.styles.textColor = GREEN
            if (c === 4 && data.cell.raw) data.cell.styles.textColor = RED
            if (c === 5) data.cell.styles.fontStyle = 'bold'
          } else if (m === 'scredit' || m === 'sdebit') {
            data.cell.styles.textColor = GREY
            data.cell.styles.fontSize = 7
            if (c === 3 && data.cell.raw) data.cell.styles.textColor = GREEN
            if (c === 4 && data.cell.raw) data.cell.styles.textColor = RED
          }
        },
      })
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(GREY[0], GREY[1], GREY[2])
      doc.text(doc.splitTextToSize('Credit = order quantity entered (raises open backlog).  Debit = order quantity shipped (lowers it).  Balance runs from the opening backlog through each event to the closing backlog.  Quantities are line units as entered (mixed cases/packs, matching the board).', 515), M, ((doc as any).lastAutoTable.finalY + 12))

      y = section('2.  Current Material (BOM) Needed to Produce Open Orders', nextY() + 6)
      autoTable(doc, {
        startY: y, theme: 'grid', margin: { left: M, right: M },
        head: [['BG P/N', 'Product', 'Packs', 'Pieces', 'Part Wt (g)', 'Total Material (lbs)']],
        body: matRows.map(r => [r.sku, (r.name || '').slice(0, 42), fmtN(r.packs), fmtN(r.pcs), r.wt == null ? '—' : String(r.wt), r.lbs == null ? '—' : fmtN(r.lbs, 2)]),
        foot: [['TOTAL', '', '', '', '', fmtN(matTotal, 2)]],
        headStyles: { fillColor: DARK, textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
        footStyles: { fillColor: [238, 242, 247], textColor: DARK, fontSize: 8, fontStyle: 'bold' },
        bodyStyles: { fontSize: 7.5, textColor: DARK }, alternateRowStyles: { fillColor: [246, 248, 251] },
        columnStyles: { 0: { cellWidth: 62 }, 1: { cellWidth: 190 }, 2: { cellWidth: 55, halign: 'right' }, 3: { cellWidth: 65, halign: 'right' }, 4: { cellWidth: 65, halign: 'right' }, 5: { cellWidth: 95, halign: 'right' } },
      })
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(GREY[0], GREY[1], GREY[2])
      doc.text(doc.splitTextToSize('Material = pieces x part weight, converted to pounds, across all open Chewy orders. Add each SKU resin split on the board to see per-component totals.', 515), M, ((doc as any).lastAutoTable.finalY + 12))

      y = section('3.  Missing Finished Goods to Complete Open Orders', nextY() + 6)
      autoTable(doc, {
        startY: y, theme: 'grid', margin: { left: M, right: M },
        head: [['BG P/N', 'Product', 'Ordered (open)', 'On Hand', 'Short']],
        body: missRows.length ? missRows.map(r => [r.sku, (r.name || '').slice(0, 46), fmtN(r.need), r.onHand == null ? '—' : fmtN(r.onHand), fmtN(r.short)]) : [['—', 'All open orders are covered by finished-goods on hand', '', '', '']],
        headStyles: { fillColor: DARK, textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8, textColor: DARK }, alternateRowStyles: { fillColor: [246, 248, 251] },
        columnStyles: { 0: { cellWidth: 68 }, 1: { cellWidth: 230 }, 2: { cellWidth: 90, halign: 'right' }, 3: { cellWidth: 70, halign: 'right' }, 4: { cellWidth: 74, halign: 'right', fontStyle: 'bold' } },
        didParseCell: (data: any) => { if (data.section === 'body' && data.column.index === 4 && data.cell.raw && data.cell.raw !== '') data.cell.styles.textColor = RED },
      })
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(GREY[0], GREY[1], GREY[2])
      doc.text(doc.splitTextToSize('Short = ordered (open orders) minus finished-goods on hand. Negative on-hand means the item is already oversold. Figures mirror the Chewy PO Requirements tab.', 515), M, ((doc as any).lastAutoTable.finalY + 12))

      doc.save('beyondGREEN_Chewy_Activity_Ledger_' + month + '.pdf')
      setMsg('')
    } catch (e: any) {
      setMsg('Could not build ledger: ' + (e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-[#E4E6EE] px-6 py-4 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold text-[#1A1D2E]">Chewy Activity Ledger</h2>
        <p className="text-xs text-gray-500 mt-0.5">A debit/credit ledger by date — orders entered (credit) and shipped (debit) with items as sub-rows and a running open-backlog balance, plus current BOM material and missing finished goods for open orders.</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <select value={month} onChange={e => setMonth(e.target.value)} disabled={busy}
          className="px-3 py-2 text-sm bg-white border border-[#E4E6EE] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
          {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <button onClick={generate} disabled={busy}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-[#1C49C2] text-white hover:bg-[#163a9c] disabled:opacity-50 transition-colors">
          <i className={busy ? 'ti ti-loader-2 animate-spin' : 'ti ti-file-download'} />{busy ? 'Generating…' : 'Download Activity Ledger'}
        </button>
      </div>
      {msg && <span className="text-xs text-red-500">{msg}</span>}
    </div>
  )
}
