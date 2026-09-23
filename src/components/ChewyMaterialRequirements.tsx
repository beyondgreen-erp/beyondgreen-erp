'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState, Fragment } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

interface SOrder { id: string; order_number: string | null; status: string | null; order_section: string | null; order_date: string | null; customer: { company_name: string | null } | null }
interface SLine { sales_order_id: string; sku: string | null; qty: number | null; quantity: number | null; unit_of_measure: string | null }
interface Prod { sku: string; product_name: string | null; unit_of_measure: string | null; pieces_per_pack: number | null; packs_per_case: number | null; weight_per_unit_grams: number | null }
interface Bom { id: string; finished_good_sku: string; component_sku: string; uom_type: string | null; percentage: number | null }

const fmtN = (n: number | null, d = 0) => (n == null || isNaN(n) ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d }))
const fmtDate = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const DONE = ['shipped', 'completed', 'closed', 'cancelled']
const isCaseUom = (u?: string | null) => /case/i.test(u || '')

type MatSplit = { code: string; pct: number; kg: number | null }
type Row = {
  sku: string; dbSku: string; rowKey: string; name: string | null; openOrders: number; poDate: string | null
  uomLabel: string; packsOrdered: number; splitPct: number
  packsPerCase: number | null; piecesPerPack: number | null; piecesPerOrder: number
  partWtG: number | null; materials: MatSplit[]; totalMatKg: number | null
  packagingRequired: number
}
type MatDraftRow = { code: string; pct: string }

export default function ChewyMaterialRequirements() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [orders, setOrders] = useState<SOrder[]>([])
  const [lines, setLines] = useState<SLine[]>([])
  const [products, setProducts] = useState<Prod[]>([])
  const [bom, setBom] = useState<Bom[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')

  // inline edit state
  const [editingWtSku, setEditingWtSku] = useState<string | null>(null)
  const [wtDraft, setWtDraft] = useState('')
  const [savingWt, setSavingWt] = useState(false)
  const [editingMatSku, setEditingMatSku] = useState<string | null>(null)
  const [matDraft, setMatDraft] = useState<MatDraftRow[]>([])
  const [savingMat, setSavingMat] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: o }, { data: l }, { data: p }, { data: b }] = await Promise.all([
      sb.from('sales_orders').select('id, order_number, status, order_section, order_date, customer:customers(company_name)').eq('archived', false).eq('is_active', true),
      sb.from('sales_order_lines').select('sales_order_id, sku, qty, quantity, unit_of_measure'),
      sb.from('products').select('sku, product_name, unit_of_measure, pieces_per_pack, packs_per_case, weight_per_unit_grams'),
      sb.from('product_bom').select('id, finished_good_sku, component_sku, uom_type, percentage'),
    ])
    const chewy = ((o as any[]) || []).filter((so: any) => {
      const sec = so.order_section || ''
      const cust = (so.customer?.company_name || '').trim().toLowerCase()
      const isChewy = sec === 'Chewy' || cust === 'chewy'
      return isChewy && !DONE.includes((so.status || '').toLowerCase())
    }) as SOrder[]
    setOrders(chewy)
    const chewyIds = new Set(chewy.map(o2 => o2.id))
    setLines(((l as SLine[]) || []).filter(ln => chewyIds.has(ln.sales_order_id)))
    setProducts((p as Prod[]) || [])
    setBom((b as Bom[]) || [])
    setLoading(false)
  }, [sb])

  useEffect(() => {
    load()
    let t: ReturnType<typeof setTimeout> | null = null
    const bump = () => { if (t) clearTimeout(t); t = setTimeout(() => { load() }, 400) }
    const ch = sb.channel('chewy-material-requirements-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_orders' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_order_lines' }, bump)
      .subscribe()
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => { if (t) clearTimeout(t); sb.removeChannel(ch); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus) }
  }, [load, sb])

  const productBySku = useMemo(() => {
    const m: Record<string, Prod> = {}
    for (const p of products) m[(p.sku || '').trim().toUpperCase()] = p
    return m
  }, [products])

  const bomBySku = useMemo(() => {
    const m: Record<string, Bom[]> = {}
    for (const b of bom) {
      if (b.uom_type !== 'percentage') continue
      const k = (b.finished_good_sku || '').trim().toUpperCase()
      if (!k) continue
      ;(m[k] ||= []).push(b)
    }
    return m
  }, [bom])

  const orderCountBySo = useMemo(() => new Set(orders.map(o => o.id)), [orders])
  const orderById = useMemo(() => { const m: Record<string, SOrder> = {}; for (const o of orders) m[o.id] = o; return m }, [orders])

  const rows = useMemo<Row[]>(() => {
    // Normalize every line to "packs" using each SKU's own packs_per_case, then aggregate
    // by SKU + PO date so material needs can be read off by order date.
    const packsByKey: Record<string, number> = {}
    const uomVotesByKey: Record<string, Record<string, number>> = {}
    const soCountByKey: Record<string, Set<string>> = {}
    const keyInfo: Record<string, { sku: string; poDate: string | null }> = {}
    for (const ln of lines) {
      if (!orderCountBySo.has(ln.sales_order_id)) continue
      const sku = (ln.sku || '').trim().toUpperCase()
      const qty = Number(ln.quantity ?? ln.qty) || 0
      if (!sku || !qty) continue
      const poDate = orderById[ln.sales_order_id]?.order_date || null
      const key = sku // group by SKU across all of its open orders
      const prod = productBySku[sku]
      const packsPerCase = Number(prod?.packs_per_case) || 1
      const packs = isCaseUom(ln.unit_of_measure) ? qty * packsPerCase : qty
      packsByKey[key] = (packsByKey[key] || 0) + packs
      if (!keyInfo[key] || (poDate != null && (keyInfo[key].poDate == null || poDate < (keyInfo[key].poDate as string)))) keyInfo[key] = { sku, poDate }
      const uv = (uomVotesByKey[key] ||= {})
      const label = isCaseUom(ln.unit_of_measure) ? 'cases' : 'pack'
      uv[label] = (uv[label] || 0) + 1
      ;(soCountByKey[key] ||= new Set()).add(ln.sales_order_id)
    }
    const totalPacks = Object.values(packsByKey).reduce((a, b) => a + b, 0)
    const out: Row[] = Object.entries(packsByKey).map(([key, packsOrdered]) => {
      const { sku, poDate } = keyInfo[key]
      const prod = productBySku[sku]
      const piecesPerPack = prod?.pieces_per_pack != null ? Number(prod.pieces_per_pack) : null
      const piecesPerOrder = piecesPerPack != null ? packsOrdered * piecesPerPack : 0
      const partWtG = prod?.weight_per_unit_grams != null ? Number(prod.weight_per_unit_grams) : null
      // Total material required, reported in POUNDS (grams / 453.59237). Per-material splits below inherit lb.
      const totalMatKg = partWtG != null ? (piecesPerOrder * partWtG) / 453.59237 : null
      const skuBom = bomBySku[sku] || []
      const materials: MatSplit[] = skuBom.map(b => ({
        code: b.component_sku,
        pct: Number(b.percentage) || 0,
        kg: totalMatKg != null ? (totalMatKg * (Number(b.percentage) || 0)) / 100 : null,
      }))
      const votes = uomVotesByKey[key] || {}
      const uomLabel = (votes['cases'] || 0) > (votes['pack'] || 0) ? 'cases' : 'pack'
      return {
        sku, dbSku: prod?.sku || sku, rowKey: key, name: prod?.product_name ?? null, openOrders: soCountByKey[key]?.size || 0, poDate,
        uomLabel, packsOrdered, splitPct: totalPacks > 0 ? (packsOrdered / totalPacks) * 100 : 0,
        packsPerCase: prod?.packs_per_case ?? null, piecesPerPack, piecesPerOrder,
        partWtG, materials, totalMatKg, packagingRequired: packsOrdered,
      }
    })
    out.sort((a, b) => {
      const ad = a.poDate || '9999-99-99', bd = b.poDate || '9999-99-99'
      return ad !== bd ? ad.localeCompare(bd) : a.sku.localeCompare(b.sku, undefined, { numeric: true })
    })
    return out
  }, [lines, orderCountBySo, orderById, productBySku, bomBySku])

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase()
    if (!ql) return rows
    return rows.filter(r => r.sku.toLowerCase().includes(ql) || (r.name || '').toLowerCase().includes(ql))
  }, [rows, q])

  const totals = useMemo(() => {
    const t = { packsOrdered: 0, piecesPerOrder: 0, totalMatKg: 0, hasAnyMat: false, packagingRequired: 0 }
    for (const r of filtered) {
      t.packsOrdered += r.packsOrdered
      t.piecesPerOrder += r.piecesPerOrder
      t.packagingRequired += r.packagingRequired
      if (r.totalMatKg != null) { t.totalMatKg += r.totalMatKg; t.hasAnyMat = true }
    }
    return t
  }, [filtered])

  const missingWeight = filtered.filter(r => r.partWtG == null).length
  const missingBom = filtered.filter(r => r.materials.length === 0).length

  // ── Edit: Part Wt (g) ────────────────────────────────────────────────────
  function startEditWt(r: Row) {
    setEditingMatSku(null)
    setEditingWtSku(r.rowKey)
    setWtDraft(r.partWtG != null ? String(r.partWtG) : '')
  }
  async function saveWt(r: Row) {
    const val = wtDraft.trim()
    const n = val === '' ? null : Number(val)
    if (val !== '' && (isNaN(n as number) || (n as number) < 0)) { alert('Enter a valid weight in grams.'); return }
    setSavingWt(true)
    const { error } = await sb.from('products').update({
      weight_per_unit_grams: n, qty_updated_by: 'manual edit (business reports)', qty_updated_source: 'Chewy Material Requirements widget', qty_updated_at: new Date().toISOString(),
    }).eq('sku', r.dbSku)
    setSavingWt(false)
    if (error) { alert('Could not save: ' + error.message); return }
    setProducts(prev => prev.map(p => p.sku === r.dbSku ? { ...p, weight_per_unit_grams: n } : p))
    setEditingWtSku(null)
  }

  // ── Edit: Materials (BOM %) ──────────────────────────────────────────────
  function startEditMaterials(r: Row) {
    setEditingWtSku(null)
    setEditingMatSku(r.rowKey)
    setMatDraft(r.materials.length ? r.materials.map(m => ({ code: m.code, pct: String(m.pct) })) : [{ code: '', pct: '' }])
  }
  function addMatRow() { setMatDraft(d => [...d, { code: '', pct: '' }]) }
  function removeMatRow(i: number) { setMatDraft(d => d.filter((_, idx) => idx !== i)) }
  function updateMatRow(i: number, field: 'code' | 'pct', val: string) {
    setMatDraft(d => d.map((row, idx) => idx === i ? { ...row, [field]: val } : row))
  }
  async function saveMaterials(r: Row) {
    const cleaned = matDraft.map(m => ({ code: m.code.trim().toUpperCase(), pct: Number(m.pct) })).filter(m => m.code)
    const total = cleaned.reduce((a, m) => a + (isNaN(m.pct) ? 0 : m.pct), 0)
    if (cleaned.some(m => isNaN(m.pct) || m.pct < 0)) { alert('Each material needs a valid, non-negative percentage.'); return }
    if (cleaned.length && Math.round(total) !== 100) { if (!confirm(`These percentages add up to ${total}%, not 100%. Save anyway?`)) return }
    setSavingMat(true)
    const existingIds = (bomBySku[r.sku] || []).map(b => b.id)
    if (existingIds.length) await sb.from('product_bom').delete().in('id', existingIds)
    if (cleaned.length) {
      const insertRows = cleaned.map(m => ({ finished_good_sku: r.dbSku, component_sku: m.code, uom_type: 'percentage', percentage: m.pct, qty_value: m.pct, is_case_level: false }))
      const { error } = await sb.from('product_bom').insert(insertRows)
      if (error) { setSavingMat(false); alert('Could not save: ' + error.message); return }
    }
    setSavingMat(false)
    setEditingMatSku(null)
    load()
  }

  function exportPdf() {
    const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' })
    const M = 36
    const BLUE: [number, number, number] = [28, 73, 194]
    const DARK: [number, number, number] = [26, 29, 46]
    let y = 42
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(BLUE[0], BLUE[1], BLUE[2])
    doc.text('beyondGREEN', M, y)
    doc.setTextColor(DARK[0], DARK[1], DARK[2]); doc.setFontSize(13)
    doc.text('Chewy Material & Packaging Requirements — Open Orders', M, y + 18)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(120, 120, 120)
    doc.text('Generated ' + new Date().toLocaleString() + '  ·  ' + filtered.length + ' SKUs across open Chewy orders', M, y + 32)
    y += 50
    const bodyRows = filtered.map(r => [
      r.sku, String(r.openOrders), fmtDate(r.poDate), r.uomLabel, fmtN(r.packsOrdered), r.splitPct.toFixed(1) + '%',
      fmtN(r.packsPerCase), fmtN(r.piecesPerPack), fmtN(r.piecesPerOrder),
      r.partWtG == null ? '—' : r.partWtG.toString(),
      r.totalMatKg == null ? '—' : fmtN(r.totalMatKg, 1),
      fmtN(r.packagingRequired),
    ])
    autoTable(doc, {
      startY: y,
      head: [['BG P/N', 'Orders', 'Next PO', 'UOM', 'Order Qty', '% Split', 'Packs/Case', 'Pieces/Pack', 'Pieces/Order', 'Part Wt (g)', 'Total Mat (lbs)', 'Packaging Req.']],
      body: bodyRows,
      foot: [['TOTAL', String(orders.length), '', '', fmtN(totals.packsOrdered), '100%', '', '', fmtN(totals.piecesPerOrder), '', totals.hasAnyMat ? fmtN(totals.totalMatKg, 1) : '—', fmtN(totals.packagingRequired)]],
      theme: 'grid',
      headStyles: { fillColor: DARK, textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
      footStyles: { fillColor: [240, 242, 247], textColor: DARK, fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8, textColor: DARK },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: M, right: M },
    })
    doc.save('beyondGREEN_Chewy_Material_Requirements_' + new Date().toISOString().slice(0, 10) + '.pdf')
  }

  return (
    <div className="bg-white rounded-2xl border border-[#E4E6EE] overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4 border-b border-[#E4E6EE]">
        <div>
          <h2 className="text-lg font-bold text-[#1A1D2E]">Chewy Material &amp; Packaging Requirements</h2>
          <p className="text-xs text-gray-500 mt-0.5">{loading ? 'Loading…' : `${filtered.length} SKU${filtered.length === 1 ? '' : 's'} across ${orders.length} open Chewy order${orders.length === 1 ? '' : 's'}`} · grouped by SKU (all open orders combined) · shipped orders drop off, new orders add in · order quantities normalized to packs · click Part Wt or Materials to edit</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => load()} disabled={loading} title="Reload latest Chewy order data" className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-[#E4E6EE] text-gray-600 hover:bg-[#F5F6FA] disabled:opacity-50 transition-colors"><i className={'ti ti-refresh' + (loading ? ' animate-spin' : '')} />Refresh</button>
          <button onClick={exportPdf} disabled={loading || filtered.length === 0} title="Download a PDF report" className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg bg-[#1C49C2] text-white hover:bg-[#163a9c] disabled:opacity-50 transition-colors"><i className="ti ti-file-type-pdf" />Export PDF</button>
          <div className="relative">
            <i className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
            <input placeholder="Search SKU or item…" value={q} onChange={e => setQ(e.target.value)} className="pl-9 pr-4 py-2 text-sm bg-white border border-[#E4E6EE] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
      </div>

      {!loading && (missingWeight > 0 || missingBom > 0) && (
        <div className="px-6 py-2.5 bg-amber-50 border-b border-amber-100 text-[11px] text-amber-800">
          {missingWeight > 0 && <span>{missingWeight} SKU{missingWeight === 1 ? '' : 's'} missing a per-piece weight — click Part Wt (g) on that row to add one.</span>}
          {missingWeight > 0 && missingBom > 0 && <span> · </span>}
          {missingBom > 0 && <span>{missingBom} SKU{missingBom === 1 ? '' : 's'} have no material BOM % on file — click Materials on that row to add the breakdown.</span>}
        </div>
      )}

      <div className="overflow-x-auto">
        {loading ? <div className="px-6 py-16 text-center text-gray-400 text-sm">Loading…</div>
         : filtered.length === 0 ? <div className="px-6 py-16 text-center text-gray-400 text-sm">No item requirements for open Chewy orders.</div>
         : (
          <table className="w-full min-w-[1200px] text-sm">
            <thead>
              <tr className="text-[10px] uppercase text-gray-400 border-b border-[#EEF0F4]">
                <th className="text-left px-6 py-2">BG P/N</th>
                <th className="text-right px-3 py-2">Orders</th>
                <th className="text-left px-3 py-2">Next PO</th>
                <th className="text-left px-3 py-2">UOM</th>
                <th className="text-right px-3 py-2">Order Qty</th>
                <th className="text-right px-3 py-2">% Split</th>
                <th className="text-right px-3 py-2">Packs/Case</th>
                <th className="text-right px-3 py-2">Pieces/Pack</th>
                <th className="text-right px-3 py-2">Pieces/Order</th>
                <th className="text-right px-3 py-2">Part Wt (g)</th>
                <th className="text-left px-3 py-2">Materials</th>
                <th className="text-right px-3 py-2">Total Mat Req (lbs)</th>
                <th className="text-right px-6 py-2">Packaging Req.</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <Fragment key={r.rowKey}>
                  <tr className="border-b border-[#EEF0F4] hover:bg-[#FBFCFE]">
                    <td className="px-6 py-2.5 font-mono font-semibold text-gray-800" title={r.name || ''}>{r.sku}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-700 font-medium">{r.openOrders}</td>
                    <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{fmtDate(r.poDate)}</td>
                    <td className="px-3 py-2.5 text-gray-500">{r.uomLabel}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{fmtN(r.packsOrdered)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{r.splitPct.toFixed(1)}%</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{fmtN(r.packsPerCase)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{fmtN(r.piecesPerPack)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-700 font-medium">{fmtN(r.piecesPerOrder)}</td>
                    <td className="px-3 py-2.5 text-right">
                      {editingWtSku === r.rowKey ? (
                        <div className="flex items-center justify-end gap-1">
                          <input autoFocus type="number" step="0.01" min="0" value={wtDraft} onChange={e => setWtDraft(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveWt(r); if (e.key === 'Escape') setEditingWtSku(null) }}
                            className="w-20 px-1.5 py-1 text-right text-sm border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" />
                          <button disabled={savingWt} onClick={() => saveWt(r)} className="text-emerald-600 hover:text-emerald-700"><i className="ti ti-check" /></button>
                          <button disabled={savingWt} onClick={() => setEditingWtSku(null)} className="text-gray-400 hover:text-gray-600"><i className="ti ti-x" /></button>
                        </div>
                      ) : (
                        <button onClick={() => startEditWt(r)} className="tabular-nums text-gray-500 hover:text-blue-600 hover:underline decoration-dotted underline-offset-2">
                          {r.partWtG == null ? <span className="text-amber-500 italic">add</span> : r.partWtG}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {editingMatSku !== r.rowKey && (
                        <button onClick={() => startEditMaterials(r)} className="text-left hover:underline decoration-dotted underline-offset-2">
                          {r.materials.length
                            ? <span className="text-gray-600">{r.materials.map(m => `${m.code} ${m.pct}%`).join(' · ')}</span>
                            : <span className="text-amber-500 italic">add materials</span>}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-[#1A1D2E]">{r.totalMatKg == null ? <span className="text-gray-300 font-normal">—</span> : fmtN(r.totalMatKg, 1)}</td>
                    <td className="px-6 py-2.5 text-right tabular-nums font-semibold text-[#1C49C2]">{fmtN(r.packagingRequired)}</td>
                  </tr>
                  {editingMatSku === r.rowKey && (
                    <tr className="bg-blue-50/40 border-b border-[#EEF0F4]">
                      <td colSpan={13} className="px-6 py-3">
                        <div className="flex flex-wrap items-start gap-4">
                          <div className="flex flex-col gap-1.5">
                            {matDraft.map((m, i) => (
                              <div key={i} className="flex items-center gap-2">
                                <input placeholder="Material code (e.g. F23B0)" value={m.code} onChange={e => updateMatRow(i, 'code', e.target.value)}
                                  className="w-48 px-2 py-1.5 text-sm border border-[#E4E6EE] rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                <input type="number" step="0.1" min="0" max="100" placeholder="%" value={m.pct} onChange={e => updateMatRow(i, 'pct', e.target.value)}
                                  className="w-20 px-2 py-1.5 text-sm text-right border border-[#E4E6EE] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                <span className="text-xs text-gray-400">%</span>
                                <button onClick={() => removeMatRow(i)} className="text-gray-400 hover:text-red-500"><i className="ti ti-trash" /></button>
                              </div>
                            ))}
                            <button onClick={addMatRow} className="self-start text-xs font-semibold text-blue-600 hover:text-blue-700 mt-0.5">+ Add material</button>
                          </div>
                          <div className="flex items-center gap-2 pt-0.5">
                            <button disabled={savingMat} onClick={() => saveMaterials(r)} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#1C49C2] text-white hover:bg-[#163a9c] disabled:opacity-50">{savingMat ? 'Saving…' : 'Save'}</button>
                            <button disabled={savingMat} onClick={() => setEditingMatSku(null)} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[#E4E6EE] text-gray-600 hover:bg-white">Cancel</button>
                          </div>
                        </div>
                        <p className="text-[11px] text-gray-400 mt-2">Percentages should total 100%. Total Mat Req for this SKU needs a Part Wt (g) on file to compute — set that first if it&apos;s blank.</p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[#E4E6EE] bg-[#FBFCFE] font-bold text-[#1A1D2E]">
                <td className="px-6 py-3">TOTAL</td>
                <td className="px-3 py-3 text-right tabular-nums">{orders.length}</td>
                <td className="px-3 py-3"></td>
                <td className="px-3 py-3"></td>
                <td className="px-3 py-3 text-right tabular-nums">{fmtN(totals.packsOrdered)}</td>
                <td className="px-3 py-3 text-right tabular-nums">100%</td>
                <td className="px-3 py-3"></td>
                <td className="px-3 py-3"></td>
                <td className="px-3 py-3 text-right tabular-nums">{fmtN(totals.piecesPerOrder)}</td>
                <td className="px-3 py-3"></td>
                <td className="px-3 py-3"></td>
                <td className="px-3 py-3 text-right tabular-nums">{totals.hasAnyMat ? fmtN(totals.totalMatKg, 1) : '—'}</td>
                <td className="px-6 py-3 text-right tabular-nums text-[#1C49C2]">{fmtN(totals.packagingRequired)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
      <div className="px-6 py-2 border-t border-[#EEF0F4]"><p className="text-[11px] text-gray-400">Order Qty, Pieces/Order and Packaging Required are normalized to packs (case orders converted via each SKU&apos;s Packs/Case). Part Wt and Materials are editable inline — changes save straight to the Product record and its BOM.</p></div>
    </div>
  )
}
