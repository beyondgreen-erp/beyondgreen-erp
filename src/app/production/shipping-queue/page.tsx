'use client'
import { useEffect, useState, useCallback } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import Comments from '@/components/Comments'
import { buildCaseLabels, buildPalletLabels, missingUpcSkus, type CaseLabel, type PalletLabel } from '@/lib/shipping/labels'
import { buildBOL, buildMasterBOL, buildPackingList, loadImageDataUrl, type BolLine, type BolData, type PackListCase } from '@/lib/shipping/bol'

const sb = createSupabaseBrowserClient()
const GRAMS_PER_LB = 453.592
const SHIP_FROM_NAME = 'beyondGREEN biotech, Inc.'
const SHIP_FROM_ADDR = '1202 E Wakeham Ave.,\nSanta Ana, CA 92705 USA'
const SHIPPABLE = ['Ready to Ship', 'PU Date Assigned', 'Partially Shipped']

interface OrderInfo {
  order_number: string; po_number?: string | null; shipping_address?: string | null
  total?: number | null; total_amount?: number | null; total_value?: number | null; customer_id?: string
  status?: string | null; order_date?: string | null; required_ship_date?: string | null
  carrier?: string | null; tracking_number?: string | null; additional_comments?: string | null
  customers?: { company_name: string; shipping_address?: string | null }
}
interface QueueItem { id: string; sales_order_id: string; status: string; sales_orders?: OrderInfo }
interface PlanRow {
  sku: string; description: string; units: number; unitsPerCase: number; cases: number
  caseWeightLb: number; casesPerPallet: number; gramsPerUnit: number; upc: string | null; customerPart: string | null
  uom: string; packaging: string; done: number
}
interface BolRow { id: string; bol_number: string; po_number?: string | null; ship_to_name?: string | null; pallet_qty?: number; case_qty?: number; weight?: number; declared_value?: number; commodity_description?: string | null; status?: string }
interface PalletSlot { palletNumber: number; caseCount: number; weightLb: number; sku: string }
interface SkuLine extends PlanRow { pallets: number; palletStart: number; palletEnd: number }

function shipTo(o?: OrderInfo): { name: string; addr: string } {
  return { name: o?.customers?.company_name || 'Customer', addr: (o?.shipping_address || o?.customers?.shipping_address || '').toString() }
}
function fmtMoney(n?: number | null) { return n != null ? '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—' }

// Assign each SKU's cases to sequential pallets (no auto-mixing).
function buildPacking(plan: PlanRow[], defaultCap: number): { skuLines: SkuLine[]; pallets: PalletSlot[]; totalPallets: number } {
  let palletNo = 0
  const skuLines: SkuLine[] = []
  const pallets: PalletSlot[] = []
  for (const r of plan) {
    const cpp = Math.max(1, r.casesPerPallet || defaultCap)
    const nP = Math.max(1, Math.ceil(r.cases / cpp))
    const start = palletNo + 1
    let remaining = r.cases
    for (let i = 0; i < nP; i++) {
      palletNo++
      const cnt = Math.min(cpp, remaining); remaining -= cnt
      pallets.push({ palletNumber: palletNo, caseCount: cnt, weightLb: +(cnt * r.caseWeightLb).toFixed(0), sku: r.sku })
    }
    skuLines.push({ ...r, pallets: nP, palletStart: start, palletEnd: palletNo })
  }
  return { skuLines, pallets, totalPallets: palletNo }
}

export default function ShippingQueuePage() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [plan, setPlan] = useState<PlanRow[]>([])
  const [cap, setCap] = useState(40)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState('')
  const [missing, setMissing] = useState<string[]>([])
  const [bols, setBols] = useState<BolRow[]>([])
  const [sel, setSel] = useState<Record<string, boolean>>({})
  const [showMaster, setShowMaster] = useState(false)
  const [userEmail, setUserEmail] = useState('')

  useEffect(() => { sb.auth.getUser().then(({ data }) => setUserEmail(data.user?.email || '')) }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await sb.from('sales_orders')
      .select('id, order_number, po_number, shipping_address, total, total_amount, total_value, customer_id, status, order_date, required_ship_date, carrier, tracking_number, additional_comments, customers(company_name, shipping_address)')
      .in('status', SHIPPABLE).order('required_ship_date', { ascending: true, nullsFirst: false })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (data as any[]) || []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setItems(rows.map((o: any) => ({ id: o.id, sales_order_id: o.id, status: o.status, sales_orders: o })))
    setLoading(false)
  }, [])

  const loadBols = useCallback(async () => {
    const { data } = await sb.from('bols').select('id, bol_number, po_number, ship_to_name, pallet_qty, case_qty, weight, declared_value, commodity_description, status')
      .eq('status', 'Draft').order('created_at', { ascending: false })
    setBols((data as BolRow[]) || [])
  }, [])

  useEffect(() => { load(); loadBols() }, [load, loadBols])

  async function openOrder(item: QueueItem) {
    if (openId === item.id) { setOpenId(null); return }
    setOpenId(item.id); setNotes(''); setMissing([]); setBusy('load'); setPlan([])
    const { data: lines } = await sb.from('sales_order_lines').select('*').eq('sales_order_id', item.sales_order_id).order('line_number', { ascending: true })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ls = (lines as any[]) || []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pids = [...new Set(ls.map((l: any) => l.product_id).filter(Boolean))]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prodMap: Record<string, any> = {}
    if (pids.length) {
      const { data: prods } = await sb.from('products').select('id, case_qty, weight_per_unit_grams, upc_gtin, customer_part_number, product_name').in('id', pids)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;((prods as any[]) || []).forEach((p: any) => { prodMap[p.id] = p })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rowsOut: PlanRow[] = ls.map((l: any) => {
      const prod = l.product_id ? prodMap[l.product_id] : null
      const upc = l.qty_per_case || prod?.case_qty || 1
      const units = l.quantity ?? l.qty ?? 0
      const gpu = prod?.weight_per_unit_grams || 0
      return {
        sku: l.sku || '(no sku)', description: l.description || prod?.product_name || '',
        units, unitsPerCase: upc || 1, cases: Math.max(1, Math.ceil(units / (upc || 1))),
        caseWeightLb: +(((upc || 1) * gpu) / GRAMS_PER_LB).toFixed(2), casesPerPallet: cap, gramsPerUnit: gpu,
        upc: prod?.upc_gtin || null, customerPart: prod?.customer_part_number || null,
        uom: l.unit_of_measure || '', packaging: l.packaging || '', done: l.quantity_shipped || l.completed_qty || 0,
      }
    })
    setPlan(rowsOut); setBusy('')
  }

  function upd(i: number, patch: Partial<PlanRow>) { setPlan(p => p.map((r, idx) => idx === i ? { ...r, ...patch } : r)) }
  function setUnitsPerCase(i: number, v: number) {
    setPlan(p => p.map((r, idx) => {
      if (idx !== i) return r
      const upc = Math.max(1, v || 1)
      return { ...r, unitsPerCase: upc, cases: Math.max(1, Math.ceil(r.units / upc)), caseWeightLb: r.gramsPerUnit ? +((upc * r.gramsPerUnit) / GRAMS_PER_LB).toFixed(2) : r.caseWeightLb }
    }))
  }

  const activeItem = items.find(i => i.id === openId)
  const o = activeItem?.sales_orders
  const st = o ? shipTo(o) : { name: '', addr: '' }
  const pk = buildPacking(plan, cap)
  const totals = {
    cases: plan.reduce((a, r) => a + r.cases, 0),
    weight: +(plan.reduce((a, r) => a + r.cases * r.caseWeightLb, 0)).toFixed(2),
    pallets: pk.totalPallets,
  }
  const missingWeight = plan.some(r => !r.caseWeightLb)

  async function aiSuggest() {
    setBusy('ai')
    try {
      const res = await fetch('/api/shipping/pack-suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxCasesPerPallet: cap, lines: plan.map(r => ({ sku: r.sku, description: r.description, units: r.units, unitsPerCase: r.unitsPerCase, weightPerUnitGrams: r.gramsPerUnit })) }),
      })
      const j = await res.json()
      if (j.skuPlan) setPlan(p => p.map(r => { const s = j.skuPlan.find((x: { sku: string }) => x.sku === r.sku); return s ? { ...r, cases: s.cases } : r }))
      if (j.notes) setNotes(j.notes)
    } catch { setNotes('AI suggestion unavailable; using computed plan.') }
    setBusy('')
  }

  function caseArray(): CaseLabel[] {
    const out: CaseLabel[] = []
    for (const r of plan) for (let n = 1; n <= r.cases; n++) out.push({ sku: r.sku, description: r.description, upcGtin: r.upc, customerPartNumber: r.customerPart, vendorPartNumber: r.sku, caseNumber: n, totalCases: r.cases, unitsInCase: r.unitsPerCase })
    return out
  }

  function genCaseLabels() {
    const cases = caseArray()
    const miss = missingUpcSkus(cases)
    if (miss.length) { setMissing(miss); return }
    setMissing([])
    buildCaseLabels({ poNumber: o?.po_number || '', shipToName: st.name, shipToAddress: st.addr }, cases).save(`case-labels-${o?.order_number || 'order'}.pdf`)
  }

  function genPalletLabels() {
    const pallets: PalletLabel[] = pk.pallets.map(p => ({ palletNumber: p.palletNumber, totalPallets: pk.totalPallets, caseCount: p.caseCount, weight: p.weightLb, skus: [p.sku] }))
    buildPalletLabels({ poNumber: o?.po_number || '', shipToName: st.name, shipToAddress: st.addr }, pallets).save(`pallet-labels-${o?.order_number || 'order'}.pdf`)
  }

  async function genBOL() {
    if (!activeItem) return
    setBusy('bol')
    const orderValue = o?.total_amount || o?.total || o?.total_value || 0
    let fill = { commodityDescription: plan[0]?.description || 'Disposable Foodservice Products', nmfcNumber: '', freightClass: '', declaredValue: orderValue, specialInstructions: 'DO NOT STACK' }
    try {
      const res = await fetch('/api/shipping/bol-fill', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productDescriptions: plan.map(p => p.description), totalPallets: totals.pallets, totalCases: totals.cases, totalWeight: totals.weight, orderValue }),
      })
      const j = await res.json(); if (!j.error) fill = { ...fill, ...j }
    } catch { /* fallback */ }
    const po = o?.po_number || ''
    const lines: BolLine[] = pk.skuLines.map(s => ({
      handlingQty: s.pallets, handlingType: 'Pallet', packageQty: s.cases, packageType: 'Case',
      weight: +(s.cases * s.caseWeightLb).toFixed(0),
      commodityDescription: `${s.description || s.sku} - ${s.unitsPerCase}pcs/cs (Pallet # ${s.palletStart}${s.palletEnd > s.palletStart ? '-' + s.palletEnd : ''})`,
      freightClass: fill.freightClass || '', nmfcNumber: fill.nmfcNumber || '',
    }))
    if (po) lines.push({ kind: 'note', commodityDescription: `All items listed as part of PO# ${po}` })
    const bolNumber = `BOL-${(o?.order_number || Date.now().toString()).replace(/[^0-9A-Za-z]/g, '').slice(0, 20)}`
    const data: BolData = {
      bolNumber, date: new Date().toLocaleDateString(), shipFromName: SHIP_FROM_NAME, shipFromAddress: SHIP_FROM_ADDR,
      shipToName: st.name, shipToAddress: st.addr, carrierName: o?.carrier || 'SINGLE (Walmart FLEET)', scac: 'WALM', freightTerms: '3rd Party',
      specialInstructions: ['"DO NOT STACK"', po ? `PU# ${po}` : '', po ? `Load# ${po}` : ''].filter(Boolean),
      totalPallets: totals.pallets, totalCases: totals.cases, totalWeight: totals.weight, declaredValue: fill.declaredValue,
    }
    const logo = await loadImageDataUrl('/bG-logo-clean.png')
    buildBOL(data, lines, logo).save(`${bolNumber}.pdf`)
    await sb.from('bols').insert({
      bol_number: bolNumber, sales_order_id: activeItem.sales_order_id, carrier_name: data.carrierName, scac: data.scac,
      ship_to_name: st.name, ship_to_address: st.addr, po_number: po || null, pu_number: po || null,
      pallet_qty: totals.pallets, case_qty: totals.cases, weight: totals.weight, declared_value: fill.declaredValue,
      commodity_description: fill.commodityDescription, nmfc_number: fill.nmfcNumber, freight_class: fill.freightClass, status: 'Draft',
    })
    setBusy(''); loadBols()
  }

  function genPackingList() {
    if (!activeItem) return
    const cases: PackListCase[] = []
    pk.skuLines.forEach(s => {
      let caseIdx = 0
      for (let pnum = s.palletStart; pnum <= s.palletEnd; pnum++) {
        const slot = pk.pallets.find(p => p.palletNumber === pnum)
        const cnt = slot ? slot.caseCount : 0
        for (let k = 0; k < cnt; k++) { caseIdx++; cases.push({ sku: s.sku, description: s.description, caseNumber: caseIdx, totalCases: s.cases, unitsInCase: s.unitsPerCase, weight: s.caseWeightLb, palletNumber: pnum }) }
      }
    })
    const meta = { poNumber: o?.po_number || '', orderNumber: o?.order_number || '', shipToName: st.name, shipToAddress: st.addr, date: new Date().toLocaleDateString() }
    loadImageDataUrl('/bG-logo-clean.png').then(logo => buildPackingList(meta, cases, totals, logo).save(`packing-list-${o?.order_number || 'order'}.pdf`))
      .catch(() => buildPackingList(meta, cases, totals, null).save(`packing-list-${o?.order_number || 'order'}.pdf`))
  }

  async function mergeMaster() {
    const chosen = bols.filter(b => sel[b.id])
    if (chosen.length < 2) { alert('Select at least two BOLs to merge.'); return }
    setBusy('master')
    const lines: BolLine[] = chosen.map(b => ({ handlingQty: b.pallet_qty || 0, handlingType: 'Pallet', packageQty: b.case_qty || 0, packageType: 'Case', weight: b.weight || 0, commodityDescription: `${b.commodity_description || 'Disposable Cutlery'} — PO# ${b.po_number || ''}` }))
    const totalPallets = chosen.reduce((a, b) => a + (b.pallet_qty || 0), 0)
    const totalCases = chosen.reduce((a, b) => a + (b.case_qty || 0), 0)
    const totalWeight = +(chosen.reduce((a, b) => a + (b.weight || 0), 0)).toFixed(2)
    const declared = +(chosen.reduce((a, b) => a + (b.declared_value || 0), 0)).toFixed(2)
    const masterNumber = `Master-${Date.now().toString().slice(-8)}`
    const data: BolData = {
      isMaster: true, bolNumber: masterNumber, date: new Date().toLocaleDateString(), shipFromName: SHIP_FROM_NAME, shipFromAddress: SHIP_FROM_ADDR,
      shipToName: chosen[0].ship_to_name || 'Consolidation', shipToAddress: '', carrierName: 'SINGLE (Walmart FLEET)', scac: 'WALM', freightTerms: '3rd Party',
      specialInstructions: [], totalPallets, totalCases, totalWeight, declaredValue: declared,
    }
    const logo = await loadImageDataUrl('/bG-logo-clean.png')
    buildMasterBOL(data, lines, logo).save(`${masterNumber}.pdf`)
    const { data: mb } = await sb.from('master_bols').insert({
      master_bol_number: masterNumber, carrier_name: data.carrierName, scac: data.scac, ship_to_name: data.shipToName,
      total_pallets: totalPallets, total_cases: totalCases, total_weight: totalWeight, declared_value: declared, status: 'Draft',
    }).select().single()
    if (mb) await sb.from('master_bol_bols').insert(chosen.map(b => ({ master_bol_id: mb.id, bol_id: b.id })))
    setBusy(''); setSel({})
  }

  const btn = 'text-xs font-semibold px-3 py-2 rounded-lg border transition-colors disabled:opacity-50'
  const num = 'w-14 border rounded px-1 py-0.5 text-right text-xs'

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold">Shipping Queue</h1>
        <button onClick={() => setShowMaster(s => !s)} className={`${btn} bg-indigo-600 text-white border-indigo-600`}>{showMaster ? 'Hide' : 'Merge BOLs → Master BOL'}</button>
      </div>
      <p className="text-xs text-gray-400 mb-5">Mirrors the Sales Orders board. Showing: {SHIPPABLE.join(', ')}.</p>

      {showMaster && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-sm font-semibold mb-2">Generated BOLs — select to merge</p>
          {bols.length === 0 ? <p className="text-xs text-gray-400">No draft BOLs yet.</p> : (
            <div className="space-y-1">
              {bols.map(b => (
                <label key={b.id} className="flex items-center gap-3 text-xs py-1.5 border-b border-gray-100">
                  <input type="checkbox" checked={!!sel[b.id]} onChange={e => setSel(s => ({ ...s, [b.id]: e.target.checked }))} />
                  <span className="font-mono font-semibold w-40 truncate">{b.bol_number}</span>
                  <span className="flex-1 text-gray-500 truncate">PO {b.po_number || '—'} · {b.ship_to_name}</span>
                  <span className="text-gray-500">{b.pallet_qty} PLT · {b.case_qty} CS · {b.weight} lb</span>
                </label>
              ))}
              <button onClick={mergeMaster} disabled={busy === 'master'} className={`${btn} bg-emerald-600 text-white border-emerald-600 mt-3`}>{busy === 'master' ? 'Merging…' : 'Generate Master BOL'}</button>
            </div>
          )}
        </div>
      )}

      {loading ? <p className="text-gray-400">Loading…</p> : items.length === 0 ? <p className="text-gray-400">No orders ready to ship.</p> : (
        <div className="space-y-2">
          {items.map(item => {
            const io = item.sales_orders; const open = openId === item.id
            return (
              <div key={item.id} className="rounded-xl border border-gray-200 bg-white">
                <button onClick={() => openOrder(item)} className="w-full flex items-center gap-4 px-4 py-3 text-left">
                  <span className="font-semibold truncate max-w-md">{io?.order_number || '—'}</span>
                  <span className="text-sm text-gray-500 flex-1 truncate">{io?.customers?.company_name} · PO {io?.po_number || '—'}</span>
                  <span className="text-xs px-2 py-1 rounded-full bg-gray-100 whitespace-nowrap">{item.status}</span>
                  <span className="text-indigo-600 text-sm whitespace-nowrap">{open ? 'Close' : 'Pack & Ship'}</span>
                </button>

                {open && (
                  <div className="border-t border-gray-100 p-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-xs mb-4">
                      <div><span className="text-gray-400 block">Customer</span>{o?.customers?.company_name || '—'}</div>
                      <div><span className="text-gray-400 block">PO #</span>{o?.po_number || '—'}</div>
                      <div><span className="text-gray-400 block">Status</span>{item.status}</div>
                      <div><span className="text-gray-400 block">Order Value</span>{fmtMoney(o?.total_amount ?? o?.total ?? o?.total_value)}</div>
                      <div><span className="text-gray-400 block">Order Date</span>{o?.order_date || '—'}</div>
                      <div><span className="text-gray-400 block">Req. Ship Date</span>{o?.required_ship_date || '—'}</div>
                      <div><span className="text-gray-400 block">Carrier</span>{o?.carrier || '—'}</div>
                      <div className="col-span-2 md:col-span-1"><span className="text-gray-400 block">Ship To</span>{st.name}</div>
                    </div>
                    {o?.shipping_address && <div className="text-xs text-gray-500 mb-3 whitespace-pre-line"><span className="text-gray-400">Address: </span>{st.addr}</div>}
                    {o?.additional_comments && <div className="text-xs bg-amber-50 border-l-4 border-amber-300 p-2 mb-3 whitespace-pre-line"><b>Notes:</b> {o.additional_comments}</div>}

                    {busy === 'load' ? <p className="text-xs text-gray-400">Loading order…</p> : plan.length === 0 ? <p className="text-xs text-gray-400">No line items found on this order.</p> : (
                      <>
                        <div className="flex items-center gap-3 mb-3">
                          <label className="text-xs text-gray-500">Default cases / pallet</label>
                          <input type="number" value={cap} onChange={e => setCap(Math.max(1, Number(e.target.value) || 1))} className="w-20 border rounded px-2 py-1 text-sm" />
                          <button onClick={aiSuggest} disabled={busy === 'ai'} className={`${btn} bg-violet-600 text-white border-violet-600`}>{busy === 'ai' ? 'Thinking…' : '✨ AI Suggest Packing'}</button>
                        </div>

                        <div className="overflow-x-auto">
                        <table className="w-full text-xs mb-3">
                          <thead><tr className="text-left text-gray-500 border-b bg-gray-50">
                            <th className="py-1.5 px-2">SKU</th><th className="px-2">Product / Description</th><th className="text-right px-2">Qty</th>
                            <th className="px-2">UOM</th><th className="text-right px-2">Units/Case</th><th className="text-right px-2">Cases</th>
                            <th className="text-right px-2">Case&nbsp;lb</th><th className="text-right px-2">Cases/Plt</th><th className="text-center px-2">UPC</th>
                          </tr></thead>
                          <tbody>
                            {plan.map((r, i) => (
                              <tr key={i} className="border-b border-gray-50">
                                <td className="py-1.5 px-2 font-mono">{r.sku}</td>
                                <td className="px-2 text-gray-600">{r.description}</td>
                                <td className="text-right px-2">{r.units}</td>
                                <td className="px-2 text-gray-500">{r.uom || '—'}</td>
                                <td className="text-right px-2"><input type="number" value={r.unitsPerCase} onChange={e => setUnitsPerCase(i, Number(e.target.value))} className={num} /></td>
                                <td className="text-right px-2"><input type="number" value={r.cases} onChange={e => upd(i, { cases: Math.max(1, Number(e.target.value) || 1) })} className={num} /></td>
                                <td className="text-right px-2"><input type="number" step="0.01" value={r.caseWeightLb} onChange={e => upd(i, { caseWeightLb: Math.max(0, Number(e.target.value) || 0) })} className={`${num} ${!r.caseWeightLb ? 'ring-1 ring-red-300' : ''}`} /></td>
                                <td className="text-right px-2"><input type="number" value={r.casesPerPallet} onChange={e => upd(i, { casesPerPallet: Math.max(1, Number(e.target.value) || 1) })} className={num} /></td>
                                <td className="text-center px-2">{r.upc ? '✓' : <span className="text-red-500 font-bold">!</span>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        </div>

                        <p className="text-xs text-gray-600 mb-2">Totals: <b>{totals.pallets}</b> pallets · <b>{totals.cases}</b> cases · <b>{totals.weight}</b> lb</p>
                        {missingWeight && <div className="text-xs bg-amber-50 border-l-4 border-amber-400 text-amber-800 p-2 mb-3">Some case weights are 0 — type the case weight (lb) in the <b>Case&nbsp;lb</b> column so the BOL/labels are accurate.</div>}
                        {notes && <div className="text-xs bg-violet-50 border-l-4 border-violet-400 p-2 mb-3 whitespace-pre-line">{notes}</div>}
                        {missing.length > 0 && (
                          <div className="text-xs bg-red-50 border-l-4 border-red-400 text-red-700 p-3 mb-3">
                            <b>UPC or GTIN is missing in the Inventory board</b> for: {missing.join(', ')}.<br />Please add the UPC/GTIN (and product image) in Inventory before generating labels.
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2 mb-4">
                          <button onClick={genCaseLabels} className={`${btn} bg-white border-gray-300`}>🏷️ Case Labels</button>
                          <button onClick={genPalletLabels} className={`${btn} bg-white border-gray-300`}>📦 Pallet Labels</button>
                          <button onClick={genPackingList} className={`${btn} bg-white border-gray-300`}>📋 Packing List</button>
                          <button onClick={genBOL} disabled={busy === 'bol'} className={`${btn} bg-emerald-600 text-white border-emerald-600`}>{busy === 'bol' ? 'Generating…' : '📄 Generate BOL'}</button>
                        </div>
                      </>
                    )}

                    <div className="border-t border-gray-100 pt-4">
                      <Comments recordType="sales_order" recordId={item.sales_order_id} currentUserEmail={userEmail} title="Activity Log" />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
