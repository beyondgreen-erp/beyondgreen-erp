'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from 'react'
import JsBarcode from 'jsbarcode'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import {
  generateCaseLabels, generatePalletLabels, generateBOL,
  type ShipAddress, type PalletInfo, type BOLLine,
} from '@/lib/labelGenerator'

// ─── Types ─────────────────────────────────────────────────────

interface FullOrder {
  id: string
  order_number: string
  po_number: string | null
  shipping_address: string | null
  total_value: number | null
  notes: string | null
  customers: { company_name: string; shipping_address: string | null } | null
}

interface SOLine {
  id: string
  sku: string
  quantity: number
  unit_price: number
  description: string | null
  unit_of_measure: string | null
  qty_per_case: number | null
}

interface LineItem {
  lineId: string
  sku: string
  productName: string
  upc: string
  caseQty: number
  uom: string
  orderedQty: number
  numCases: number
  unitPrice: number
  weightPerUnitG: number
  hasProduct: boolean
}

interface PalletEntry {
  id: number
  casesByLine: Record<string, number>
}

// ─── Constants ─────────────────────────────────────────────────

const PALLET_TARE_LBS = 25
const inp = 'w-full bg-white border border-[#E4E6EE] focus:border-[#3B6FE0] rounded-xl px-4 py-2.5 text-sm text-[#1A1D2E] placeholder-[#9CA3AF] focus:outline-none transition-colors'
const inpSm = 'w-full bg-white border border-[#E4E6EE] focus:border-[#3B6FE0] rounded-lg px-3 py-1.5 text-xs text-[#1A1D2E] placeholder-[#9CA3AF] focus:outline-none transition-colors'

// ─── Helpers ───────────────────────────────────────────────────

function caseLbsForLine(item: LineItem): number {
  return (item.weightPerUnitG * item.caseQty) / 453.592
}

function palletWeightLbs(pallet: PalletEntry, items: LineItem[]): number {
  let w = PALLET_TARE_LBS
  for (const [lineId, cases] of Object.entries(pallet.casesByLine)) {
    const item = items.find(i => i.lineId === lineId)
    if (item) w += cases * caseLbsForLine(item)
  }
  return w
}

function palletTotalCases(pallet: PalletEntry): number {
  return Object.values(pallet.casesByLine).reduce((s, n) => s + n, 0)
}

function totalCasesAssigned(lineId: string, pallets: PalletEntry[]): number {
  return pallets.reduce((s, p) => s + (p.casesByLine[lineId] ?? 0), 0)
}

// ─── Component ─────────────────────────────────────────────────

interface Props {
  orderId: string
  initialCarrier?: string | null
  onClose: () => void
}

export default function LabelWizard({ orderId, initialCarrier, onClose }: Props) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)

  const [order, setOrder] = useState<FullOrder | null>(null)
  const [lines, setLines] = useState<LineItem[]>([])

  // Step 2 – Case Labels
  const [shipTo, setShipTo] = useState<ShipAddress>({ name: '', address1: '', address2: '', city: '', state: '', zip: '' })
  const [caseLabelsGenerated, setCaseLabelsGenerated] = useState(false)
  const previewBcRef = useRef<SVGSVGElement>(null)

  // Step 3 – Pallet Labels
  const [numPallets, setNumPallets] = useState(1)
  const [pallets, setPallets] = useState<PalletEntry[]>([{ id: 1, casesByLine: {} }])
  const [palletLabelsGenerated, setPalletLabelsGenerated] = useState(false)

  // Step 4 – BOL
  const [bolCarrier, setBolCarrier] = useState('')
  const [bolTrailer, setBolTrailer] = useState('')
  const [bolPro, setBolPro] = useState('')

  // ── Load data ─────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      setLoading(true)

      const { data: ord } = await sb
        .from('sales_orders')
        .select('id, order_number, po_number, shipping_address, total_value, notes, customers(company_name, shipping_address)')
        .eq('id', orderId)
        .single()

      const { data: rawLines } = await sb
        .from('sales_order_lines')
        .select('id, sku, quantity, unit_price, description, unit_of_measure, qty_per_case')
        .eq('sales_order_id', orderId)
        .order('line_number')

      if (!ord || !rawLines) { setLoading(false); return }

      const skus = Array.from(new Set((rawLines as SOLine[]).map(l => l.sku).filter(Boolean)))
      const { data: prods } = await sb
        .from('products')
        .select('sku, product_name, upc_gtin, case_qty, weight_per_unit_grams, unit_of_measure')
        .in('sku', skus)

      const prodMap: Record<string, any> = {}
      for (const p of prods ?? []) prodMap[p.sku] = p

      const merged: LineItem[] = (rawLines as SOLine[])
        .filter(l => l.sku && l.quantity > 0)
        .map(l => {
          const prod = prodMap[l.sku]
          const caseQty = l.qty_per_case || prod?.case_qty || 1
          return {
            lineId: l.id,
            sku: l.sku,
            productName: prod?.product_name ?? l.description ?? l.sku,
            upc: prod?.upc_gtin ?? '',
            caseQty,
            uom: l.unit_of_measure ?? prod?.unit_of_measure ?? 'EA',
            orderedQty: l.quantity,
            numCases: Math.ceil(l.quantity / caseQty),
            unitPrice: l.unit_price ?? 0,
            weightPerUnitG: prod?.weight_per_unit_grams ?? 0,
            hasProduct: !!prod,
          }
        })

      const o = ord as any
      const custName = o.customers?.company_name ?? (o.notes ?? '').split('|')[0].trim()
      const shipAddr = o.shipping_address ?? o.customers?.shipping_address ?? ''

      setOrder(o as FullOrder)
      setLines(merged)
      setShipTo({ name: custName, address1: shipAddr, address2: '', city: '', state: '', zip: '' })
      setBolCarrier(initialCarrier ?? '')
      setLoading(false)
    }
    load()
  }, [orderId]) // eslint-disable-line

  // ── Preview barcode ───────────────────────────────────────────

  useEffect(() => {
    if (step !== 2 || !previewBcRef.current) return
    const first = lines.find(l => l.upc || l.sku)
    if (!first) return
    try {
      JsBarcode(previewBcRef.current, first.upc || first.sku, {
        format: 'CODE128', width: 1.2, height: 30, displayValue: false, margin: 2,
        background: '#ffffff', lineColor: '#000000',
      })
    } catch { /* non-fatal */ }
  }, [step, lines])

  // ── Line item updates ─────────────────────────────────────────

  function updateLine(lineId: string, updates: Partial<LineItem>) {
    setLines(prev => prev.map(l => {
      if (l.lineId !== lineId) return l
      const next = { ...l, ...updates }
      if (updates.caseQty !== undefined) {
        next.numCases = Math.ceil(next.orderedQty / (next.caseQty || 1))
      }
      return next
    }))
  }

  // ── Pallet helpers ────────────────────────────────────────────

  function changeNumPallets(n: number) {
    const capped = Math.max(1, Math.min(n, 99))
    const next: PalletEntry[] = Array.from({ length: capped }, (_, i) => ({
      id: i + 1,
      casesByLine: pallets[i]?.casesByLine ?? {},
    }))
    setNumPallets(capped)
    setPallets(next)
  }

  function setPalletCases(palletId: number, lineId: string, cases: number) {
    setPallets(prev => prev.map(p =>
      p.id === palletId
        ? { ...p, casesByLine: { ...p.casesByLine, [lineId]: Math.max(0, cases) } }
        : p
    ))
  }

  function autoDistribute() {
    const next: PalletEntry[] = pallets.map(p => ({ ...p, casesByLine: {} }))
    for (const line of lines) {
      const perPallet = Math.floor(line.numCases / pallets.length)
      const remainder = line.numCases % pallets.length
      for (let i = 0; i < pallets.length; i++) {
        next[i].casesByLine[line.lineId] = perPallet + (i < remainder ? 1 : 0)
      }
    }
    setPallets(next)
  }

  // ── Generate functions ────────────────────────────────────────

  function doCaseLabels() {
    const allLabels = lines.flatMap(line => {
      return Array.from({ length: line.numCases }, (_, i) => ({
        sku: line.sku,
        productName: line.productName,
        upc: line.upc || line.sku,
        caseQty: line.caseQty,
        uom: line.uom,
        caseNumber: i + 1,
        totalCases: line.numCases,
      }))
    })
    generateCaseLabels({
      shipTo,
      poNumber: order?.po_number ?? undefined,
      orderNumber: order?.order_number ?? undefined,
      labels: allLabels,
    })
    setCaseLabelsGenerated(true)
  }

  function doPalletLabels() {
    const palletInfos: PalletInfo[] = pallets
      .filter(p => palletTotalCases(p) > 0)
      .map(p => {
        const pLines = Object.entries(p.casesByLine)
          .filter(([, c]) => c > 0)
          .map(([lineId, cases]) => {
            const line = lines.find(l => l.lineId === lineId)!
            return {
              sku: line.sku,
              productName: line.productName,
              cases,
              weightLbs: cases * caseLbsForLine(line),
            }
          })
        const totalCases = pLines.reduce((s, l) => s + l.cases, 0)
        const totalWeightLbs = PALLET_TARE_LBS + pLines.reduce((s, l) => s + l.weightLbs, 0)
        return {
          palletNumber: p.id,
          totalPallets: pallets.filter(x => palletTotalCases(x) > 0).length,
          palletId: `PLT-${(order?.order_number ?? 'ORD').replace(/\s/g, '')}-${String(p.id).padStart(2, '0')}`,
          lines: pLines,
          totalCases,
          totalWeightLbs,
        }
      })
    generatePalletLabels({
      shipTo,
      orderNumber: order?.order_number ?? undefined,
      poNumber: order?.po_number ?? undefined,
      pallets: palletInfos,
    })
    setPalletLabelsGenerated(true)
  }

  function doBOL() {
    const bolLines: BOLLine[] = pallets.flatMap(p =>
      Object.entries(p.casesByLine)
        .filter(([, cases]) => cases > 0)
        .map(([lineId, cases]) => {
          const line = lines.find(l => l.lineId === lineId)!
          return {
            palletNumber: p.id,
            cases,
            sku: line.sku,
            description: line.productName,
            weightLbs: PALLET_TARE_LBS / pallets.length + cases * caseLbsForLine(line),
          }
        })
    )
    const totalWeight = pallets.reduce((s, p) => s + palletWeightLbs(p, lines), 0)
    const totalCases = lines.reduce((s, l) => s + l.numCases, 0)
    generateBOL({
      shipTo,
      orderNumber: order?.order_number ?? undefined,
      poNumber: order?.po_number ?? undefined,
      carrierName: bolCarrier || undefined,
      trailerNumber: bolTrailer || undefined,
      proNumber: bolPro || undefined,
      shipDate: new Date().toLocaleDateString(),
      freightValue: order?.total_value ?? undefined,
      lines: bolLines,
      totalWeight,
      totalCases,
      totalPallets: pallets.filter(p => palletTotalCases(p) > 0).length,
    })
  }

  // ── Derived ───────────────────────────────────────────────────

  const totalCaseLabels = lines.reduce((s, l) => s + l.numCases, 0)
  const missingData = lines.filter(l => !l.upc || !l.caseQty)

  const STEPS = ['Confirm Order', 'Case Labels', 'Pallet Labels', 'BOL']

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E4E6EE] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center">
              <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/>
              </svg>
            </div>
            <div>
              <h2 className="text-[#1A1D2E] font-semibold text-sm">Label Wizard</h2>
              {order && <p className="text-xs text-gray-400">{order.order_number}</p>}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-[#1A1D2E] p-1.5 rounded-lg hover:bg-[#F5F6FA]">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Step tabs */}
        <div className="flex border-b border-[#E4E6EE] shrink-0 px-6">
          {STEPS.map((label, i) => {
            const s = (i + 1) as 1 | 2 | 3 | 4
            const active = step === s
            const done = step > s
            return (
              <button
                key={s}
                onClick={() => { if (done || s === 1) setStep(s) }}
                className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${active ? 'border-amber-400 text-amber-500' : done ? 'border-transparent text-gray-400 hover:text-[#1A1D2E] cursor-pointer' : 'border-transparent text-gray-300 cursor-default'}`}
              >
                <span className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center font-bold ${active ? 'bg-amber-400 text-white' : done ? 'bg-emerald-400 text-white' : 'bg-gray-200 text-gray-400'}`}>
                  {done ? '✓' : s}
                </span>
                {label}
              </button>
            )
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <svg className="w-6 h-6 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            </div>
          ) : (

            // ── STEP 1: Order Confirmation ──────────────────────────
            step === 1 ? (
              <div className="space-y-5">
                {/* Order info */}
                <div className="bg-[#F5F6FA] border border-[#E4E6EE] rounded-xl p-4 flex flex-col sm:flex-row gap-4">
                  <div className="flex-1 space-y-1">
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">Customer</p>
                    <p className="font-semibold text-[#1A1D2E]">
                      {order?.customers?.company_name ?? (order?.notes ?? '').split('|')[0].trim() ?? '—'}
                    </p>
                  </div>
                  <div className="flex-1 space-y-1">
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">Order #</p>
                    <p className="font-mono font-semibold text-[#1A1D2E]">{order?.order_number ?? '—'}</p>
                  </div>
                  <div className="flex-1 space-y-1">
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">PO #</p>
                    <p className="font-mono text-[#1A1D2E]">{order?.po_number ?? '—'}</p>
                  </div>
                </div>

                {missingData.length > 0 && (
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3">
                    <p className="text-amber-400 text-xs font-medium">
                      {missingData.length} line{missingData.length > 1 ? 's' : ''} missing UPC or Case Qty — edit below before printing.
                    </p>
                  </div>
                )}

                {lines.length === 0 ? (
                  <p className="text-center text-gray-400 py-10 text-sm">No line items found for this order.</p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-[#E4E6EE]">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-[#E4E6EE] bg-[#F5F6FA]">
                          {['SKU', 'Product Name', 'UPC / GTIN', 'Case Qty', 'UOM', 'Ordered Qty', '# Cases'].map(h => (
                            <th key={h} className="text-left px-3 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map(line => {
                          const warnUPC = !line.upc
                          const warnCQ = !line.caseQty
                          const warn = warnUPC || warnCQ
                          return (
                            <tr key={line.lineId} className={`border-b border-[#F3F4F6] last:border-0 ${warn ? 'bg-amber-500/5' : ''}`}>
                              <td className="px-3 py-2.5 font-mono text-emerald-500 font-bold">{line.sku}</td>
                              <td className="px-3 py-2.5 text-[#1A1D2E] max-w-[160px] truncate">
                                <input
                                  value={line.productName}
                                  onChange={e => updateLine(line.lineId, { productName: e.target.value })}
                                  className={inpSm}
                                />
                              </td>
                              <td className="px-3 py-2.5">
                                <div className="flex items-center gap-1.5">
                                  <input
                                    value={line.upc}
                                    onChange={e => updateLine(line.lineId, { upc: e.target.value })}
                                    placeholder="Enter UPC"
                                    className={inpSm + (warnUPC ? ' border-amber-400' : '')}
                                  />
                                  {warnUPC && (
                                    <svg className="w-3.5 h-3.5 text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                                    </svg>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2.5 w-24">
                                <input
                                  type="number"
                                  min="1"
                                  value={line.caseQty}
                                  onChange={e => updateLine(line.lineId, { caseQty: parseInt(e.target.value) || 1 })}
                                  className={inpSm + (warnCQ ? ' border-amber-400' : '')}
                                />
                              </td>
                              <td className="px-3 py-2.5 text-gray-400">{line.uom}</td>
                              <td className="px-3 py-2.5 text-gray-400 text-right">{line.orderedQty.toLocaleString()}</td>
                              <td className="px-3 py-2.5 font-semibold text-[#1A1D2E] text-right">{line.numCases}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-[#E4E6EE] bg-[#F5F6FA]">
                          <td colSpan={6} className="px-3 py-2 text-xs text-gray-400 text-right font-medium">Total Case Labels</td>
                          <td className="px-3 py-2 font-bold text-[#1A1D2E] text-right">{totalCaseLabels}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            ) :

            // ── STEP 2: Case Labels ────────────────────────────────
            step === 2 ? (
              <div className="space-y-5">
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_200px] gap-5">
                  {/* Left: ship-to + table */}
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Ship To Address</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="sm:col-span-2">
                          <label className="block text-xs text-gray-400 mb-1">Company / Name</label>
                          <input value={shipTo.name} onChange={e => setShipTo(p => ({ ...p, name: e.target.value }))} className={inp}/>
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-xs text-gray-400 mb-1">Address Line 1</label>
                          <input value={shipTo.address1 ?? ''} onChange={e => setShipTo(p => ({ ...p, address1: e.target.value }))} className={inp}/>
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-xs text-gray-400 mb-1">Address Line 2</label>
                          <input value={shipTo.address2 ?? ''} onChange={e => setShipTo(p => ({ ...p, address2: e.target.value }))} className={inp}/>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">City</label>
                          <input value={shipTo.city ?? ''} onChange={e => setShipTo(p => ({ ...p, city: e.target.value }))} className={inp}/>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">State</label>
                            <input value={shipTo.state ?? ''} onChange={e => setShipTo(p => ({ ...p, state: e.target.value }))} maxLength={2} className={inp}/>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">ZIP</label>
                            <input value={shipTo.zip ?? ''} onChange={e => setShipTo(p => ({ ...p, zip: e.target.value }))} className={inp}/>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Labels summary */}
                    <div className="overflow-x-auto rounded-xl border border-[#E4E6EE]">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-[#E4E6EE] bg-[#F5F6FA]">
                            {['SKU', 'Product', 'UPC', 'Case Qty', '# Labels'].map(h => (
                              <th key={h} className="text-left px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {lines.map(l => (
                            <tr key={l.lineId} className="border-b border-[#F3F4F6] last:border-0">
                              <td className="px-3 py-2 font-mono text-emerald-500 font-bold">{l.sku}</td>
                              <td className="px-3 py-2 text-[#1A1D2E] max-w-[160px] truncate">{l.productName}</td>
                              <td className="px-3 py-2 font-mono text-gray-400">{l.upc || <span className="text-amber-400">—</span>}</td>
                              <td className="px-3 py-2 text-gray-400">{l.caseQty}</td>
                              <td className="px-3 py-2 font-semibold text-[#1A1D2E] text-right">{l.numCases}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-[#E4E6EE] bg-[#F5F6FA]">
                            <td colSpan={4} className="px-3 py-2 text-xs text-gray-400 text-right">Total</td>
                            <td className="px-3 py-2 font-bold text-[#1A1D2E] text-right">{totalCaseLabels}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>

                  {/* Right: label preview */}
                  <div className="flex flex-col items-center gap-2">
                    <p className="text-xs text-gray-400 font-medium text-center">Label Preview (4&quot; × 6&quot;)</p>
                    <div style={{
                      width: 192, height: 288, border: '1.5px solid #333', borderRadius: 4,
                      fontFamily: 'Arial, sans-serif', fontSize: 6, background: '#fff', color: '#000',
                      padding: '8px 10px', display: 'flex', flexDirection: 'column', flexShrink: 0,
                      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                    }}>
                      <div style={{ textAlign: 'center', marginBottom: 4 }}>
                        <div style={{ fontWeight: 700, fontSize: 7, textTransform: 'uppercase', letterSpacing: 0.3 }}>beyondGREEN Biotech, Inc.</div>
                        <div style={{ fontSize: 5.5, color: '#555', marginTop: 1 }}>1202 E. Wakeham Ave., Santa Ana, CA 92705</div>
                      </div>
                      <div style={{ borderTop: '1px solid #222', margin: '3px 0' }}/>
                      <div style={{ marginBottom: 3 }}>
                        <div style={{ fontSize: 5, fontWeight: 700, textTransform: 'uppercase', color: '#777', letterSpacing: 0.5, marginBottom: 1 }}>SHIP TO</div>
                        <div style={{ fontSize: 9, fontWeight: 700 }}>{shipTo.name || 'Customer Name'}</div>
                        {shipTo.address1 && <div style={{ fontSize: 5.5, color: '#333' }}>{shipTo.address1}</div>}
                        {(shipTo.city || shipTo.state) && <div style={{ fontSize: 5.5, color: '#333' }}>{[shipTo.city, shipTo.state, shipTo.zip].filter(Boolean).join(', ')}</div>}
                      </div>
                      <div style={{ borderTop: '1px solid #222', margin: '3px 0' }}/>
                      <div style={{ fontSize: 8, fontWeight: 700, lineHeight: 1.3 }}>{lines[0]?.productName || 'Product Name'}</div>
                      <div style={{ fontSize: 5.5, color: '#444', marginBottom: 2 }}>SKU: {lines[0]?.sku || '—'} | Case Qty: {lines[0]?.caseQty || 0} {lines[0]?.uom || ''}</div>
                      <div style={{ borderTop: '1px solid #222', margin: '3px 0' }}/>
                      <div style={{ display: 'flex', justifyContent: 'center', flex: 1, alignItems: 'center' }}>
                        <svg ref={previewBcRef} style={{ maxWidth: '100%' }}/>
                      </div>
                      <div style={{ borderTop: '1px solid #222', margin: '3px 0' }}/>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 5.5, fontWeight: 700 }}>
                        <span>Case 1 of {lines[0]?.numCases || 1}</span>
                        <span>{order?.po_number ? `PO: ${order.po_number}` : order?.order_number}</span>
                      </div>
                    </div>
                    <p className="text-[10px] text-gray-400 text-center leading-tight">Actual output prints<br/>one label per page</p>
                  </div>
                </div>

                {caseLabelsGenerated && (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 flex items-center gap-3">
                    <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
                    </svg>
                    <p className="text-emerald-400 text-xs font-medium">{totalCaseLabels} case label{totalCaseLabels !== 1 ? 's' : ''} sent to printer. Continue to pallet labels?</p>
                  </div>
                )}
              </div>
            ) :

            // ── STEP 3: Pallet Labels ─────────────────────────────
            step === 3 ? (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-3">
                    <label className="text-sm font-medium text-[#1A1D2E]">Number of Pallets:</label>
                    <div className="flex items-center border border-[#E4E6EE] rounded-xl overflow-hidden">
                      <button
                        onClick={() => changeNumPallets(numPallets - 1)}
                        className="px-3 py-2 text-gray-400 hover:text-[#1A1D2E] hover:bg-[#F5F6FA] transition-colors text-lg font-bold"
                      >−</button>
                      <input
                        type="number" min="1" max="99" value={numPallets}
                        onChange={e => changeNumPallets(parseInt(e.target.value) || 1)}
                        className="w-14 text-center text-sm text-[#1A1D2E] bg-white py-2 border-x border-[#E4E6EE] focus:outline-none"
                      />
                      <button
                        onClick={() => changeNumPallets(numPallets + 1)}
                        className="px-3 py-2 text-gray-400 hover:text-[#1A1D2E] hover:bg-[#F5F6FA] transition-colors text-lg font-bold"
                      >+</button>
                    </div>
                  </div>
                  <button
                    onClick={autoDistribute}
                    className="flex items-center gap-1.5 text-xs bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400 px-3 py-2 rounded-xl transition-colors font-medium"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7"/>
                    </svg>
                    Auto-Distribute Evenly
                  </button>
                </div>

                {/* Pallet assignment matrix */}
                <div className="overflow-x-auto rounded-xl border border-[#E4E6EE]">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[#E4E6EE] bg-[#F5F6FA]">
                        <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-gray-400 uppercase">Product / SKU</th>
                        {pallets.map(p => (
                          <th key={p.id} className="text-center px-2 py-2.5 text-[10px] font-semibold text-gray-400 uppercase whitespace-nowrap">
                            Pallet {p.id}
                          </th>
                        ))}
                        <th className="text-right px-3 py-2.5 text-[10px] font-semibold text-gray-400 uppercase">Assigned / Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map(line => {
                        const assigned = totalCasesAssigned(line.lineId, pallets)
                        const ok = assigned === line.numCases
                        const over = assigned > line.numCases
                        return (
                          <tr key={line.lineId} className="border-b border-[#F3F4F6] last:border-0">
                            <td className="px-3 py-2.5">
                              <div className="font-mono text-emerald-500 font-bold">{line.sku}</div>
                              <div className="text-gray-400 truncate max-w-[180px]">{line.productName}</div>
                            </td>
                            {pallets.map(p => (
                              <td key={p.id} className="px-2 py-2 text-center">
                                <input
                                  type="number"
                                  min="0"
                                  value={p.casesByLine[line.lineId] ?? 0}
                                  onChange={e => setPalletCases(p.id, line.lineId, parseInt(e.target.value) || 0)}
                                  className="w-16 text-center bg-white border border-[#E4E6EE] rounded-lg px-1.5 py-1 text-xs text-[#1A1D2E] focus:outline-none focus:border-[#3B6FE0] transition-colors"
                                />
                              </td>
                            ))}
                            <td className={`px-3 py-2.5 text-right font-medium ${ok ? 'text-emerald-400' : over ? 'text-red-400' : 'text-amber-400'}`}>
                              {assigned} / {line.numCases}
                              {ok && ' ✓'}
                              {over && ' !'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-[#E4E6EE] bg-[#F5F6FA]">
                        <td className="px-3 py-2.5 text-xs text-gray-400 font-medium">Pallet Totals</td>
                        {pallets.map(p => (
                          <td key={p.id} className="px-2 py-2.5 text-center">
                            <div className="text-[#1A1D2E] font-semibold">{palletTotalCases(p)} cases</div>
                            <div className="text-gray-400 text-[10px]">{palletWeightLbs(p, lines).toFixed(0)} lbs</div>
                          </td>
                        ))}
                        <td className="px-3 py-2.5 text-right text-gray-400 text-xs">
                          incl. {PALLET_TARE_LBS} lb tare/pallet
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {palletLabelsGenerated && (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 flex items-center gap-3">
                    <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
                    </svg>
                    <p className="text-emerald-400 text-xs font-medium">{pallets.length} pallet label{pallets.length !== 1 ? 's' : ''} sent to printer. Continue to BOL?</p>
                  </div>
                )}
              </div>
            ) :

            // ── STEP 4: BOL ───────────────────────────────────────
            step === 4 ? (
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1.5">Carrier</label>
                    <input value={bolCarrier} onChange={e => setBolCarrier(e.target.value)} placeholder="e.g. UPS Freight" className={inp}/>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1.5">Trailer #</label>
                    <input value={bolTrailer} onChange={e => setBolTrailer(e.target.value)} placeholder="Optional" className={inp}/>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1.5">PRO #</label>
                    <input value={bolPro} onChange={e => setBolPro(e.target.value)} placeholder="Optional" className={inp}/>
                  </div>
                </div>

                {/* BOL summary */}
                <div className="bg-[#F5F6FA] border border-[#E4E6EE] rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-[#E4E6EE]">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Shipment Summary</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-[#E4E6EE]">
                          {['Pallet #', '# Cases', 'SKU', 'Description', 'Weight'].map(h => (
                            <th key={h} className="text-left px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pallets.flatMap(p =>
                          Object.entries(p.casesByLine)
                            .filter(([, c]) => c > 0)
                            .map(([lineId, cases]) => {
                              const line = lines.find(l => l.lineId === lineId)!
                              const lbs = (PALLET_TARE_LBS / pallets.length + cases * caseLbsForLine(line)).toFixed(0)
                              return (
                                <tr key={`${p.id}-${lineId}`} className="border-b border-[#F3F4F6] last:border-0">
                                  <td className="px-3 py-2 font-semibold">Pallet {p.id}</td>
                                  <td className="px-3 py-2 text-[#1A1D2E] font-semibold">{cases}</td>
                                  <td className="px-3 py-2 font-mono text-emerald-500">{line.sku}</td>
                                  <td className="px-3 py-2 text-gray-400 max-w-[200px] truncate">{line.productName}</td>
                                  <td className="px-3 py-2 text-gray-400">{lbs} lbs</td>
                                </tr>
                              )
                            })
                        )}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-[#E4E6EE] bg-[#F5F6FA]">
                          <td className="px-3 py-2.5 font-bold text-[#1A1D2E]">TOTAL</td>
                          <td className="px-3 py-2.5 font-bold text-[#1A1D2E]">{lines.reduce((s, l) => s + l.numCases, 0)} cases</td>
                          <td colSpan={2}/>
                          <td className="px-3 py-2.5 font-bold text-[#1A1D2E]">
                            {pallets.reduce((s, p) => s + palletWeightLbs(p, lines), 0).toFixed(0)} lbs
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  {order?.total_value && (
                    <div className="px-4 py-3 border-t border-[#E4E6EE] flex items-center justify-between">
                      <span className="text-xs text-gray-400">Declared Freight Value</span>
                      <span className="text-sm font-semibold text-[#1A1D2E]">
                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(order.total_value)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ) : null
          )}
        </div>

        {/* Footer nav */}
        {!loading && (
          <div className="shrink-0 px-6 py-4 border-t border-[#E4E6EE] flex items-center justify-between gap-3">
            <button
              onClick={() => step > 1 ? setStep((step - 1) as 1 | 2 | 3 | 4) : onClose()}
              className="flex items-center gap-2 text-sm text-gray-400 hover:text-[#1A1D2E] border border-[#E4E6EE] hover:border-[#D0D3E0] px-4 py-2.5 rounded-xl transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
              </svg>
              {step === 1 ? 'Cancel' : 'Back'}
            </button>

            <div className="flex items-center gap-2">
              {step === 1 && (
                <button
                  onClick={() => { if (lines.length > 0) setStep(2) }}
                  disabled={lines.length === 0}
                  className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
                >
                  Next: Case Labels
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                  </svg>
                </button>
              )}

              {step === 2 && (
                <>
                  <button
                    onClick={doCaseLabels}
                    className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/>
                    </svg>
                    Print {totalCaseLabels} Case Label{totalCaseLabels !== 1 ? 's' : ''}
                  </button>
                  {caseLabelsGenerated && (
                    <button
                      onClick={() => setStep(3)}
                      className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
                    >
                      Pallet Labels →
                    </button>
                  )}
                </>
              )}

              {step === 3 && (
                <>
                  <button
                    onClick={doPalletLabels}
                    className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/>
                    </svg>
                    Print {pallets.length} Pallet Label{pallets.length !== 1 ? 's' : ''}
                  </button>
                  {palletLabelsGenerated && (
                    <button
                      onClick={() => setStep(4)}
                      className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
                    >
                      Generate BOL →
                    </button>
                  )}
                </>
              )}

              {step === 4 && (
                <button
                  onClick={doBOL}
                  className="flex items-center gap-2 bg-[#1A1D2E] hover:bg-[#252840] text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                  </svg>
                  Generate Bill of Lading
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
