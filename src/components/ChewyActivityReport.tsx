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
const fmtMoney = (n: number) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

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

export default function ChewyActivityReport() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const months = useMemo(() => recentMonths(12), [])
  const [month, setMonth] = useState(months[0].value)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function generate() {
    setBusy(true); setMsg('Building report…')
    try {
      const { start, end, label } = monthRange(month)
      const [{ data: soData }, { data: lineData }, { data: prodData }, { data: bomData }, { data: shipData }] = await Promise.all([
        sb.from('sales_orders').select('id, order_number, po_number, status, order_section, order_date, customer:customers(company_name)').eq('archived', false).eq('is_active', true),
        sb.from('sales_order_lines').select('sales_order_id, sku, qty, quantity, unit_of_measure'),
        sb.from('products').select('sku, product_name, pieces_per_pack, packs_per_case, weight_per_unit_grams, on_hand_qty'),
        sb.from('product_bom').select('finished_good_sku, component_sku, uom_type, percentage'),
        sb.from('shipments').select('po_number, ship_date, total_value, customer_name, sales_order_id, archived').gte('ship_date', start).lte('ship_date', end),
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

      const prodBySku: Record<string, any> = {}
      for (const p of (prodData as any[]) || []) prodBySku[(p.sku || '').trim().toUpperCase()] = p
      const bomBySku: Record<string, any[]> = {}
      for (const b of (bomData as any[]) || []) { if (b.uom_type === 'percentage') (bomBySku[(b.finished_good_sku || '').trim().toUpperCase()] ||= []).push(b) }

      const shipped = ((shipData as any[]) || [])
        .filter(s => !s.archived && ((s.customer_name || '').trim().toLowerCase() === 'chewy' || chewyIds.has(s.sales_order_id)))
        .map(s => ({ po: s.po_number || (orderById[s.sales_order_id]?.po_number) || '—', date: s.ship_date, value: Number(s.total_value) || 0 }))
        .sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.po.localeCompare(b.po))
      const shippedTotal = shipped.reduce((a, s) => a + s.value, 0)

      const added = orders
        .filter(o => (o.order_date || '') >= start && (o.order_date || '') <= end)
        .map(o => {
          const lns = linesByOrder[o.id] || []
          const qty = lns.reduce((a, l) => a + (Number(l.quantity ?? l.qty) || 0), 0)
          return { po: o.po_number || o.order_number || '—', date: o.order_date, status: o.status || '—', qty }
        })
        .sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.po.localeCompare(b.po))

      const openIds = new Set(orders.filter(o => !DONE.includes((o.status || '').toLowerCase())).map(o => o.id))
      const needBySku: Record<string, number> = {}
      const packsBySku: Record<string, number> = {}
      for (const id of openIds) {
        for (const ln of (linesByOrder[id] || [])) {
          const sku = (ln.sku || '').trim().toUpperCase()
          const qty = Number(ln.quantity ?? ln.qty) || 0
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
        const comps = (bomBySku[sku] || []).map(b => ({ code: b.component_sku, pct: Number(b.percentage) || 0, lbs: lbs != null ? (lbs * (Number(b.percentage) || 0)) / 100 : null }))
        return { sku, name: p?.product_name || '', packs, pcs, wt, lbs, comps }
      }).sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }))
      const matTotal = matRows.reduce((a, r) => a + (r.lbs || 0), 0)
      const compTotals: Record<string, number> = {}
      for (const r of matRows) for (const c of r.comps) if (c.lbs != null) compTotals[c.code] = (compTotals[c.code] || 0) + c.lbs

      const missRows = Object.keys(needBySku).map(sku => {
        const p = prodBySku[sku]
        const onHand = p?.on_hand_qty != null ? Number(p.on_hand_qty) : null
        const need = needBySku[sku]
        const short = onHand == null ? null : Math.max(0, need - onHand)
        return { sku, name: p?.product_name || '', need, onHand, short }
      }).filter(r => (r.short ?? 0) > 0).sort((a, b) => (b.short || 0) - (a.short || 0))

      const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' })
      const M = 40
      const BLUE: [number, number, number] = [28, 73, 194]
      const DARK: [number, number, number] = [26, 29, 46]
      const RED: [number, number, number] = [209, 67, 67]
      doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(BLUE[0], BLUE[1], BLUE[2])
      doc.text('beyondGREEN — Chewy.com Activity Report', M, 44)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(120, 120, 120)
      doc.text(label + '  ·  Generated ' + new Date().toLocaleString(), M, 58)

      const section = (title: string, y: number) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(DARK[0], DARK[1], DARK[2]); doc.text(title, M, y); return y + 6 }
      const nextY = () => ((doc as any).lastAutoTable?.finalY || 66) + 22

      let y = section('1.  Orders Shipped in ' + label + ' (' + shipped.length + ' shipment' + (shipped.length === 1 ? '' : 's') + ')', 78)
      autoTable(doc, {
        startY: y, theme: 'grid', margin: { left: M, right: M },
        head: [['PO # (Chewy RS)', 'Ship Date', 'Value ($)']],
        body: shipped.length ? shipped.map(s => [s.po, fmtDate(s.date), fmtMoney(s.value)]) : [['—', 'No shipments in ' + label, '']],
        foot: shipped.length ? [['TOTAL', '', fmtMoney(shippedTotal)]] : undefined,
        headStyles: { fillColor: DARK, textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
        footStyles: { fillColor: [238, 242, 247], textColor: DARK, fontSize: 8, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8, textColor: DARK }, alternateRowStyles: { fillColor: [246, 248, 251] },
        columnStyles: { 0: { cellWidth: 200 }, 1: { cellWidth: 160 }, 2: { cellWidth: 135, halign: 'right' } },
      })

      y = section('2.  Orders Added in ' + label + ' (' + added.length + ' order' + (added.length === 1 ? '' : 's') + ')', nextY())
      autoTable(doc, {
        startY: y, theme: 'grid', margin: { left: M, right: M },
        head: [['PO # (Chewy RS)', 'Order Date', 'Status', 'Order Qty']],
        body: added.length ? added.map(o => [o.po, fmtDate(o.date), o.status, fmtN(o.qty)]) : [['—', 'No orders added in ' + label, '', '']],
        headStyles: { fillColor: DARK, textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8, textColor: DARK }, alternateRowStyles: { fillColor: [246, 248, 251] },
        columnStyles: { 0: { cellWidth: 175 }, 1: { cellWidth: 95 }, 2: { cellWidth: 170 }, 3: { cellWidth: 90, halign: 'right' } },
      })

      y = section('3.  Current Material (BOM) Needed to Produce Open Orders', nextY())
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
      const compList = Object.entries(compTotals).sort((a, b) => b[1] - a[1])
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(120, 120, 120)
      const compLine = compList.length
        ? 'Component-resin totals (where a BOM % is on file): ' + compList.map(([c, v]) => c + ' = ' + fmtN(v, 2) + ' lbs').join(',  ') + '.'
        : 'No component-resin (%) breakdown is on file for these SKUs yet — only the total lb requirement is shown.'
      doc.text(doc.splitTextToSize(compLine + ' Material = pieces x part weight, converted to pounds. Add each SKU material split on the board to see per-resin totals.', 515), M, ((doc as any).lastAutoTable.finalY + 12))

      y = section('4.  Missing Finished Goods to Complete Open Orders', nextY() + 6)
      autoTable(doc, {
        startY: y, theme: 'grid', margin: { left: M, right: M },
        head: [['BG P/N', 'Product', 'Ordered (open)', 'On Hand', 'Short']],
        body: missRows.length ? missRows.map(r => [r.sku, (r.name || '').slice(0, 46), fmtN(r.need), r.onHand == null ? '—' : fmtN(r.onHand), fmtN(r.short)]) : [['—', 'All open orders are covered by finished-goods on hand', '', '', '']],
        headStyles: { fillColor: DARK, textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8, textColor: DARK }, alternateRowStyles: { fillColor: [246, 248, 251] },
        columnStyles: { 0: { cellWidth: 68 }, 1: { cellWidth: 230 }, 2: { cellWidth: 90, halign: 'right' }, 3: { cellWidth: 70, halign: 'right' }, 4: { cellWidth: 74, halign: 'right', fontStyle: 'bold' } },
        didParseCell: (data: any) => { if (data.section === 'body' && data.column.index === 4 && data.cell.raw && data.cell.raw !== '') data.cell.styles.textColor = RED },
      })
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(120, 120, 120)
      doc.text(doc.splitTextToSize('Short = ordered (open orders) minus finished-goods on hand. Negative on-hand means the item is already oversold. Figures mirror the Chewy PO Requirements tab.', 515), M, ((doc as any).lastAutoTable.finalY + 12))

      doc.save('beyondGREEN_Chewy_Activity_Report_' + month + '.pdf')
      setMsg('')
    } catch (e: any) {
      setMsg('Could not build report: ' + (e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-[#E4E6EE] px-6 py-4 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold text-[#1A1D2E]">Chewy Activity Report</h2>
        <p className="text-xs text-gray-500 mt-0.5">Shipped orders (with ship date) + orders added (with order date) for the month, plus current BOM material needed and missing finished goods to complete open orders.</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <select value={month} onChange={e => setMonth(e.target.value)} disabled={busy}
          className="px-3 py-2 text-sm bg-white border border-[#E4E6EE] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
          {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <button onClick={generate} disabled={busy}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-[#1C49C2] text-white hover:bg-[#163a9c] disabled:opacity-50 transition-colors">
          <i className={busy ? 'ti ti-loader-2 animate-spin' : 'ti ti-file-download'} />{busy ? 'Generating…' : 'Download Activity Report'}
        </button>
      </div>
      {msg && <span className="text-xs text-red-500">{msg}</span>}
    </div>
  )
}
