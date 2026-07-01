'use client'
import { useEffect, useState, useCallback } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { buildCaseLabels, buildPalletLabels, missingUpcSkus, type CaseLabel, type PalletLabel } from '@/lib/shipping/labels'
import { buildBOL, buildMasterBOL, buildPackingList, loadImageDataUrl, type BolLine, type BolData, type PackListCase } from '@/lib/shipping/bol'

const sb = createSupabaseBrowserClient()
const GRAMS_PER_LB = 453.592
const SHIP_FROM_NAME = 'beyondGREEN biotech, Inc.'
const SHIP_FROM_ADDR = '1202 E Wakeham Ave.,\nSanta Ana, CA 92705 USA'
// Orders in these sales-order statuses appear in the shipping queue.
const SHIPPABLE = ['Ready to Ship', 'PU Date Assigned', 'Partially Shipped']

interface QueueItem {
  id: string
  sales_order_id: string
  status: string
  sales_orders?: {
    order_number: string; po_number?: string | null; shipping_address?: string | null
    total?: number | null; total_amount?: number | null; customer_id?: string
    customers?: { company_name: string; shipping_address?: string | null }
  }
}
interface Line {
  sku: string; description?: string | null; quantity?: number | null; qty_per_case?: number | null
  product_id?: string | null
  products?: { case_qty?: number | null; weight_per_unit_grams?: number | null; upc_gtin?: string | null; customer_part_number?: string | null; product_name?: string | null }
}
interface PlanRow {
  sku: string; description: string; units: number; unitsPerCase: number; cases: number
  caseWeightLb: number; upc: string | null; customerPart: string | null
}
interface BolRow { id: string; bol_number: string; po_number?: string | null; ship_to_name?: string | null; pallet_qty?: number; case_qty?: number; weight?: number; declared_value?: number; commodity_description?: string | null; status?: string }

function shipTo(o?: QueueItem['sales_orders']): { name: string; addr: string } {
  const name = o?.customers?.company_name || 'Customer'
  const addr = (o?.shipping_address || o?.customers?.shipping_address || '').toString()
  return { name, addr }
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

  const load = useCallback(async () => {
    setLoading(true)
    // Read directly from sales_orders (the shipping_queue table is not populated).
    const { data } = await sb.from('sales_orders')
      .select('id, order_number, po_number, shipping_address, total, total_amount, customer_id, status, required_ship_date, customers(company_name, shipping_address)')
      .in('status', SHIPPABLE)
      .order('required_ship_date', { ascending: true, nullsFirst: false })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (data as any[]) || []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped: QueueItem[] = rows.map((o: any) => ({
      id: o.id, sales_order_id: o.id, status: o.status,
      sales_orders: {
        order_number: o.order_number, po_number: o.po_number, shipping_address: o.shipping_address,
        total: o.total, total_amount: o.total_amount, customer_id: o.customer_id, customers: o.customers,
      },
    }))
    setItems(mapped)
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
    setOpenId(item.id); setNotes(''); setMissing([]); setBusy('load')
    const { data } = await sb.from('sales_order_lines')
      .select('sku, description, quantity, qty_per_case, product_id, products(case_qty, weight_per_unit_grams, upc_gtin, customer_part_number, product_name)')
      .eq('sales_order_id', item.sales_order_id)
    const rows: PlanRow[] = ((data as Line[]) || []).map(l => {
      const upc = l.qty_per_case || l.products?.case_qty || 1
      const units = l.quantity || 0
      const gpu = l.products?.weight_per_unit_grams || 0
      return {
        sku: l.sku || '(no sku)', description: l.description || l.products?.product_name || '',
        units, unitsPerCase: upc || 1, cases: Math.max(1, Math.ceil(units / (upc || 1))),
        caseWeightLb: +(((upc || 1) * gpu) / GRAMS_PER_LB).toFixed(2),
        upc: l.products?.upc_gtin || null, customerPart: l.products?.customer_part_number || null,
      }
    })
    setPlan(rows); setBusy('')
  }

  function updateCases(i: number, v: number) {
    setPlan(p => p.map((r, idx) => idx === i ? { ...r, cases: Math.max(1, v || 1) } : r))
  }

  const activeItem = items.find(i => i.id === openId)
  const totals = {
    cases: plan.reduce((a, r) => a + r.cases, 0),
    weight: +(plan.reduce((a, r) => a + r.cases * r.caseWeightLb, 0)).toFixed(2),
    pallets: Math.max(1, Math.ceil(plan.reduce((a, r) => a + r.cases, 0) / Math.max(1, cap))),
  }

  async function aiSuggest() {
    setBusy('ai')
    try {
      const res = await fetch('/api/shipping/pack-suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxCasesPerPallet: cap, lines: plan.map(r => ({ sku: r.sku, description: r.description, units: r.units, unitsPerCase: r.unitsPerCase, weightPerUnitGrams: r.caseWeightLb * GRAMS_PER_LB / r.unitsPerCase })) }),
      })
      const j = await res.json()
      if (j.skuPlan) setPlan(p => p.map(r => { const s = j.skuPlan.find((x: { sku: string }) => x.sku === r.sku); return s ? { ...r, cases: s.cases } : r }))
      if (j.notes) setNotes(j.notes)
    } catch { setNotes('AI suggestion unavailable; using computed plan.') }
    setBusy('')
  }

  function caseArray(): CaseLabel[] {
    const out: CaseLabel[] = []
    for (const r of plan) {
      for (let n = 1; n <= r.cases; n++) {
        out.push({ sku: r.sku, description: r.description, upcGtin: r.upc, customerPartNumber: r.customerPart, vendorPartNumber: r.sku, caseNumber: n, totalCases: r.cases, unitsInCase: r.unitsPerCase })
      }
    }
    return out
  }

  function genCaseLabels() {
    const cases = caseArray()
    const miss = missingUpcSkus(cases)
    if (miss.length) { setMissing(miss); return }
    setMissing([])
    const st = shipTo(activeItem?.sales_orders)
    const doc = buildCaseLabels({ poNumber: activeItem?.sales_orders?.po_number || '', shipToName: st.name, shipToAddress: st.addr }, cases)
    doc.save(`case-labels-${activeItem?.sales_orders?.order_number || 'order'}.pdf`)
  }

  function genPalletLabels() {
    const st = shipTo(activeItem?.sales_orders)
    const pallets: PalletLabel[] = []
    const perPallet = Math.max(1, cap)
    const total = totals.pallets
    let caseCursor = totals.cases
    for (let p = 1; p <= total; p++) {
      const cnt = Math.min(perPallet, caseCursor); caseCursor -= cnt
      pallets.push({ palletNumber: p, totalPallets: total, caseCount: cnt, weight: +(totals.weight / total).toFixed(0) })
    }
    const doc = buildPalletLabels({ poNumber: activeItem?.sales_orders?.po_number || '', shipToName: st.name, shipToAddress: st.addr }, pallets)
    doc.save(`pallet-labels-${activeItem?.sales_orders?.order_number || 'order'}.pdf`)
  }

  async function genBOL() {
    if (!activeItem) return
    setBusy('bol')
    const o = activeItem.sales_orders
    const st = shipTo(o)
    const orderValue = o?.total_amount || o?.total || 0
    let fill = { commodityDescription: plan[0]?.description || 'Disposable Foodservice Products', nmfcNumber: '', freightClass: '', declaredValue: orderValue, specialInstructions: 'DO NOT STACK' }
    try {
      const res = await fetch('/api/shipping/bol-fill', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productDescriptions: plan.map(p => p.description), totalPallets: totals.pallets, totalCases: totals.cases, totalWeight: totals.weight, orderValue }),
      })
      const j = await res.json(); if (!j.error) fill = { ...fill, ...j }
    } catch { /* fallback */ }

    const bolNumber = `BOL-${(o?.order_number || Date.now().toString()).replace(/[^0-9A-Za-z]/g, '').slice(0, 20)}`
    const line: BolLine = { handlingQty: totals.pallets, handlingType: 'PLT', packageQty: totals.cases, packageType: 'CS', weight: totals.weight, commodityDescription: fill.commodityDescription, poNumber: o?.po_number || '', nmfcNumber: fill.nmfcNumber, freightClass: fill.freightClass }
    const data: BolData = {
      bolNumber, date: new Date().toLocaleDateString(), shipFromName: SHIP_FROM_NAME, shipFromAddress: SHIP_FROM_ADDR,
      shipToName: st.name, shipToAddress: st.addr, carrierName: 'SINGLE (Walmart FLEET)', scac: 'WALM',
      freightTerms: '3rd Party', specialInstructions: fill.specialInstructions, puNumber: o?.po_number || '', loadNumber: o?.po_number || '',
      totalPallets: totals.pallets, totalCases: totals.cases, totalWeight: totals.weight, declaredValue: fill.declaredValue,
    }
    const logo = await loadImageDataUrl('/bG-logo-clean.png')
    const doc = buildBOL(data, [line], logo)

    await sb.from('bols').insert({
      bol_number: bolNumber, sales_order_id: activeItem.sales_order_id, carrier_name: data.carrierName, scac: data.scac,
      ship_to_name: st.name, ship_to_address: st.addr, po_number: o?.po_number || null, pu_number: o?.po_number || null,
      pallet_qty: totals.pallets, case_qty: totals.cases, weight: totals.weight, declared_value: fill.declaredValue,
      commodity_description: fill.commodityDescription, nmfc_number: fill.nmfcNumber, freight_class: fill.freightClass, status: 'Draft',
    })
    doc.save(`${bolNumber}.pdf`)
    setBusy(''); loadBols()
  }

  function genPackingList() {
    if (!activeItem) return
    const o = activeItem.sales_orders; const st = shipTo(o)
    const cases: PackListCase[] = []
    plan.forEach(r => { for (let n = 1; n <= r.cases; n++) cases.push({ sku: r.sku, description: r.description, caseNumber: n, totalCases: r.cases, unitsInCase: r.unitsPerCase, weight: r.caseWeightLb }) })
    const meta = { poNumber: o?.po_number || '', orderNumber: o?.order_number || '', shipToName: st.name, shipToAddress: st.addr, date: new Date().toLocaleDateString() }
    loadImageDataUrl('/bG-logo-clean.png').then(logo => {
      buildPackingList(meta, cases, totals, logo).save(`packing-list-${o?.order_number || 'order'}.pdf`)
    }).catch(() => buildPackingList(meta, cases, totals, null).save(`packing-list-${o?.order_number || 'order'}.pdf`))
  }

  async function mergeMaster() {
    const chosen = bols.filter(b => sel[b.id])
    if (chosen.length < 2) { alert('Select at least two BOLs to merge.'); return }
    setBusy('master')
    const lines: BolLine[] = chosen.map(b => ({ handlingQty: b.pallet_qty || 0, handlingType: 'PLT', packageQty: b.case_qty || 0, packageType: 'CS', weight: b.weight || 0, commodityDescription: b.commodity_description || 'Disposable Cutlery', poNumber: b.po_number || '' }))
    const totalPallets = chosen.reduce((a, b) => a + (b.pallet_qty || 0), 0)
    const totalCases = chosen.reduce((a, b) => a + (b.case_qty || 0), 0)
    const totalWeight = +(chosen.reduce((a, b) => a + (b.weight || 0), 0)).toFixed(2)
    const declared = +(chosen.reduce((a, b) => a + (b.declared_value || 0), 0)).toFixed(2)
    const masterNumber = `Master-${Date.now().toString().slice(-8)}`
    const data: BolData = {
      isMaster: true, bolNumber: masterNumber, date: new Date().toLocaleDateString(), shipFromName: SHIP_FROM_NAME, shipFromAddress: SHIP_FROM_ADDR,
      shipToName: chosen[0].ship_to_name || 'Consolidation', shipToAddress: '', carrierName: 'SINGLE (Walmart FLEET)', scac: 'WALM',
      freightTerms: '3rd Party', specialInstructions: 'Master BOL', totalPallets, totalCases, totalWeight, declaredValue: declared,
    }
    const logo = await loadImageDataUrl('/bG-logo-clean.png')
    const doc = buildMasterBOL(data, lines, logo)
    const { data: mb } = await sb.from('master_bols').insert({
      master_bol_number: masterNumber, carrier_name: data.carrierName, scac: data.scac, ship_to_name: data.shipToName,
      total_pallets: totalPallets, total_cases: totalCases, total_weight: totalWeight, declared_value: declared, status: 'Draft',
    }).select().single()
    if (mb) await sb.from('master_bol_bols').insert(chosen.map(b => ({ master_bol_id: mb.id, bol_id: b.id })))
    doc.save(`${masterNumber}.pdf`)
    setBusy(''); setSel({})
  }

  const btn = 'text-xs font-semibold px-3 py-2 rounded-lg border transition-colors disabled:opacity-50'

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold">Shipping Queue</h1>
        <button onClick={() => setShowMaster(s => !s)} className={`${btn} bg-indigo-600 text-white border-indigo-600`}>
          {showMaster ? 'Hide' : 'Merge BOLs → Master BOL'}
        </button>
      </div>
      <p className="text-xs text-gray-400 mb-5">Showing orders with status: {SHIPPABLE.join(', ')}.</p>

      {showMaster && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-sm font-semibold mb-2">Generated BOLs — select to merge into a Master BOL</p>
          {bols.length === 0 ? <p className="text-xs text-gray-400">No draft BOLs yet. Generate BOLs from orders below.</p> : (
            <div className="space-y-1">
              {bols.map(b => (
                <label key={b.id} className="flex items-center gap-3 text-xs py-1.5 border-b border-gray-100">
                  <input type="checkbox" checked={!!sel[b.id]} onChange={e => setSel(s => ({ ...s, [b.id]: e.target.checked }))} />
                  <span className="font-mono font-semibold w-40 truncate">{b.bol_number}</span>
                  <span className="flex-1 text-gray-500 truncate">PO {b.po_number || '—'} · {b.ship_to_name}</span>
                  <span className="text-gray-500">{b.pallet_qty} PLT · {b.case_qty} CS · {b.weight} lb</span>
                </label>
              ))}
              <button onClick={mergeMaster} disabled={busy === 'master'} className={`${btn} bg-emerald-600 text-white border-emerald-600 mt-3`}>
                {busy === 'master' ? 'Merging…' : 'Generate Master BOL'}
              </button>
            </div>
          )}
        </div>
      )}

      {loading ? <p className="text-gray-400">Loading…</p> : items.length === 0 ? <p className="text-gray-400">No orders ready to ship.</p> : (
        <div className="space-y-2">
          {items.map(item => {
            const o = item.sales_orders; const open = openId === item.id
            return (
              <div key={item.id} className="rounded-xl border border-gray-200 bg-white">
                <button onClick={() => openOrder(item)} className="w-full flex items-center gap-4 px-4 py-3 text-left">
                  <span className="font-semibold truncate max-w-md">{o?.order_number || '—'}</span>
                  <span className="text-sm text-gray-500 flex-1 truncate">{o?.customers?.company_name} · PO {o?.po_number || '—'}</span>
                  <span className="text-xs px-2 py-1 rounded-full bg-gray-100 whitespace-nowrap">{item.status}</span>
                  <span className="text-indigo-600 text-sm whitespace-nowrap">{open ? 'Close' : 'Pack & Ship'}</span>
                </button>

                {open && (
                  <div className="border-t border-gray-100 p-4">
                    {busy === 'load' ? <p className="text-xs text-gray-400">Loading order…</p> : plan.length === 0 ? <p className="text-xs text-gray-400">No line items on this order.</p> : (
                      <>
                        <div className="flex items-center gap-3 mb-3">
                          <label className="text-xs text-gray-500">Max cases / pallet</label>
                          <input type="number" value={cap} onChange={e => setCap(Math.max(1, Number(e.target.value) || 1))} className="w-20 border rounded px-2 py-1 text-sm" />
                          <button onClick={aiSuggest} disabled={busy === 'ai'} className={`${btn} bg-violet-600 text-white border-violet-600`}>
                            {busy === 'ai' ? 'Thinking…' : '✨ AI Suggest Packing'}
                          </button>
                        </div>

                        <table className="w-full text-sm mb-3">
                          <thead><tr className="text-left text-xs text-gray-500 border-b">
                            <th className="py-1.5">SKU</th><th>Description</th><th className="text-right">Units</th>
                            <th className="text-right">Units/Case</th><th className="text-right">Cases</th><th className="text-right">Case lb</th><th className="text-center">UPC</th>
                          </tr></thead>
                          <tbody>
                            {plan.map((r, i) => (
                              <tr key={i} className="border-b border-gray-50">
                                <td className="py-1.5 font-mono">{r.sku}</td>
                                <td className="text-gray-600">{r.description}</td>
                                <td className="text-right">{r.units}</td>
                                <td className="text-right">{r.unitsPerCase}</td>
                                <td className="text-right"><input type="number" value={r.cases} onChange={e => updateCases(i, Number(e.target.value))} className="w-16 border rounded px-1 py-0.5 text-right text-sm" /></td>
                                <td className="text-right">{r.caseWeightLb}</td>
                                <td className="text-center">{r.upc ? '✓' : <span className="text-red-500 font-bold">!</span>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>

                        <p className="text-xs text-gray-600 mb-3">Totals: <b>{totals.pallets}</b> pallets · <b>{totals.cases}</b> cases · <b>{totals.weight}</b> lb</p>
                        {notes && <div className="text-xs bg-violet-50 border-l-4 border-violet-400 p-2 mb-3 whitespace-pre-line">{notes}</div>}
                        {missing.length > 0 && (
                          <div className="text-xs bg-red-50 border-l-4 border-red-400 text-red-700 p-3 mb-3">
                            <b>UPC or GTIN is missing in the Inventory board</b> for: {missing.join(', ')}.<br />
                            Please add the UPC/GTIN (and product image) in Inventory before generating labels.
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2">
                          <button onClick={genCaseLabels} className={`${btn} bg-white border-gray-300`}>🏷️ Case Labels</button>
                          <button onClick={genPalletLabels} className={`${btn} bg-white border-gray-300`}>📦 Pallet Labels</button>
                          <button onClick={genPackingList} className={`${btn} bg-white border-gray-300`}>📋 Packing List</button>
                          <button onClick={genBOL} disabled={busy === 'bol'} className={`${btn} bg-emerald-600 text-white border-emerald-600`}>{busy === 'bol' ? 'Generating…' : '📄 Generate BOL'}</button>
                        </div>
                      </>
                    )}
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
