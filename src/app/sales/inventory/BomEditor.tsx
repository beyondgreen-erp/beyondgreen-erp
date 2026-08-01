'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

// ── Types ──────────────────────────────────────────────────────────────────
interface ProductProp {
  sku: string
  product_name: string
  category: string | null
  weight_per_unit_grams: number | null
  bom_cost: number | null
  distribution_price: number | null
  wholesale_price: number | null
  msrp: number | null
  imap: number | null
  map_price: number | null
  case_qty: number | null
  case_cost: number | null
  [key: string]: any
}

type Basis = 'percentage' | 'pcs_unit' | 'pcs_case'

interface BomRow {
  id: string
  component_sku: string
  product_name: string
  category: string | null
  unit_cost: number
  basis: Basis
  qty_value: number  // percentage (0-100) or pcs count
}

interface SearchResult {
  sku: string
  product_name: string
  category: string | null
  unit_cost: number | null
}

interface Props {
  product: ProductProp
  onClose: () => void
  onUpdate?: () => void
}

// ── Constants ──────────────────────────────────────────────────────────────
const TIERS = [
  { key: 'distribution_price', label: 'Distribution', mult: 2.5 },
  { key: 'wholesale_price',    label: 'Wholesale',    mult: 4   },
  { key: 'msrp',               label: 'MSRP',         mult: 8   },
  { key: 'imap',               label: 'IMAP',         mult: 6   },
  { key: 'map_price',          label: 'MAP',          mult: 5   },
] as const

const PKG_CATEGORIES = ['Packaging', 'Print Plates']
const defaultBasis = (cat: string | null): Basis =>
  cat && PKG_CATEGORIES.includes(cat) ? 'pcs_unit' : 'percentage'

const BASIS_LABEL: Record<Basis, string> = {
  percentage: '% by weight',
  pcs_unit: 'pcs / unit',
  pcs_case: 'pcs / case',
}

const CAT_COLORS: Record<string, { bg: string; fg: string }> = {
  'Raw Material':         { bg: '#FEF3C7', fg: '#92400E' },
  'Packaging':            { bg: '#DBEAFE', fg: '#1E40AF' },
  'Additives':            { bg: '#FCE7F3', fg: '#9D174D' },
  'WIP':                  { bg: '#CFFAFE', fg: '#155E75' },
  'Print Plates':         { bg: '#EDE9FE', fg: '#5B21B6' },
  'Composter Components': { bg: '#CCFBF1', fg: '#115E59' },
  'Component':            { bg: '#F1F3F7', fg: '#4B5563' },
}
const catStyle = (c: string | null) => (c && CAT_COLORS[c]) || { bg: '#F1F3F7', fg: '#4B5563' }

const fmt2 = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0)
const fmt4 = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(n || 0)

const GRAMS_PER_LB = 453.592
const inp = 'bg-white border border-[#E4E6EE] text-[#1A1D2E] rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00863F]/40 transition'

// ── Component ────────────────────────────────────────────────────────────────
export default function BomEditor({ product, onClose, onUpdate }: Props) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])

  const [components, setComponents] = useState<BomRow[]>([])
  const [weightGrams, setWeightGrams] = useState(String(product.weight_per_unit_grams ?? ''))
  const [productionCost, setProductionCost] = useState('0')
  const [loading, setLoading] = useState(true)

  const [addQuery, setAddQuery] = useState('')
  const [addSku, setAddSku] = useState('')
  const [addSkuName, setAddSkuName] = useState('')
  const [addSkuCat, setAddSkuCat] = useState<string | null>(null)
  const [addBasis, setAddBasis] = useState<Basis>('percentage')
  const [addQty, setAddQty] = useState('')
  const [addErr, setAddErr] = useState('')
  const [adding, setAdding] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [showDrop, setShowDrop] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)
  const addQtyRef = useRef<HTMLInputElement>(null)

  const [savingWeight, setSavingWeight] = useState(false)
  const [savingProdCost, setSavingProdCost] = useState(false)
  const [savingTier, setSavingTier] = useState<string | null>(null)
  const [savingAll, setSavingAll] = useState(false)
  const [savingCase, setSavingCase] = useState(false)
  const [msg, setMsg] = useState('')

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadBom = useCallback(async () => {
    setLoading(true)
    let bomRows: any[] = []
    const { data: d1, error: e1 } = await sb.from('product_bom').select('*').eq('finished_good_sku', product.sku)
    if (!e1) bomRows = d1 ?? []
    else { const { data: d2 } = await sb.from('product_bom').select('*').eq('sku', product.sku); bomRows = d2 ?? [] }

    const { data: pd } = await sb.from('products').select('production_cost').eq('sku', product.sku).maybeSingle()
    if (pd?.production_cost != null) setProductionCost(String(pd.production_cost))

    if (!bomRows.length) { setComponents([]); setLoading(false); return }

    const compSkus = Array.from(new Set(bomRows.map((r: any) => r.component_sku).filter(Boolean))) as string[]
    const { data: prods } = await sb.from('products').select('sku,product_name,category,unit_cost').in('sku', compSkus)
    const pm: Record<string, any> = {}
    for (const p of (prods ?? []) as any[]) pm[p.sku] = p

    const rows: BomRow[] = bomRows.map((r: any) => {
      const comp = pm[r.component_sku] ?? {}
      const cat = comp.category ?? null
      const uom = r.uom_type === 'pcs' ? 'pcs' : r.uom_type === 'percentage' ? 'percentage' : (defaultBasis(cat) === 'percentage' ? 'percentage' : 'pcs')
      const basis: Basis = uom === 'percentage' ? 'percentage' : (r.is_case_level ? 'pcs_case' : 'pcs_unit')
      return {
        id: r.id,
        component_sku: r.component_sku,
        product_name: comp.product_name ?? '— (not in inventory)',
        category: cat,
        unit_cost: Number(comp.unit_cost ?? 0),
        basis,
        qty_value: r.qty_value != null ? Number(r.qty_value) : Number(r.percentage ?? 0),
      }
    })
    setComponents(rows)
    setLoading(false)
  }, [sb, product.sku])

  useEffect(() => { loadBom() }, [loadBom])

  useEffect(() => {
    function h(e: MouseEvent) { if (dropRef.current && !dropRef.current.contains(e.target as Node)) setShowDrop(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // ── Derived ─────────────────────────────────────────────────────────────────
  const wG = parseFloat(weightGrams) || 0
  const caseQty = product.case_qty || 1

  const extOf = useCallback((c: { basis: Basis; qty_value: number; unit_cost: number }) => {
    if (c.basis === 'percentage') return (c.qty_value / 100) * wG * (c.unit_cost / GRAMS_PER_LB)
    if (c.basis === 'pcs_unit') return c.qty_value * c.unit_cost
    return (c.qty_value * c.unit_cost) / caseQty // pcs_case → per unit
  }, [wG, caseQty])

  const computedRows = useMemo(() => components.map(c => ({ ...c, extended_cost: extOf(c) })), [components, extOf])

  const totals = useMemo(() => {
    let rawMat = 0, unitPkg = 0, casePkg = 0
    for (const c of computedRows) {
      if (c.basis === 'percentage') rawMat += c.extended_cost
      else if (c.basis === 'pcs_unit') unitPkg += c.extended_cost
      else casePkg += c.extended_cost
    }
    return { rawMat, unitPkg, casePkg, totalMat: rawMat + unitPkg + casePkg }
  }, [computedRows])

  const totalPct = computedRows.filter(c => c.basis === 'percentage').reduce((s, c) => s + c.qty_value, 0)
  const anyPct = computedRows.some(c => c.basis === 'percentage')
  const missingCost = computedRows.filter(c => (c.unit_cost || 0) === 0)
  const prodCostNum = parseFloat(productionCost) || 0
  const totalCost = totals.totalMat + prodCostNum
  const caseCostTotal = totalCost * caseQty
  const suggested: Record<string, number> = {}
  for (const t of TIERS) suggested[t.key] = totalCost * t.mult

  // ── Search (Ultron: live inventory products) ───────────────────────────────
  useEffect(() => {
    if (addQuery.length < 2) { setSearchResults([]); setShowDrop(false); return }
    const t = setTimeout(async () => {
      const { data } = await sb.from('products')
        .select('sku,product_name,category,unit_cost')
        .or(`sku.ilike.%${addQuery}%,product_name.ilike.%${addQuery}%`)
        .neq('sku', product.sku).neq('category', 'Finished Goods')
        .order('sku').limit(8)
      setSearchResults((data ?? []) as SearchResult[]); setShowDrop(true)
    }, 180)
    return () => clearTimeout(t)
  }, [addQuery, sb, product.sku])

  function selectResult(r: SearchResult) {
    setAddSku(r.sku); setAddSkuName(r.product_name); setAddSkuCat(r.category)
    setAddBasis(defaultBasis(r.category)); setAddQuery(''); setShowDrop(false)
    setTimeout(() => addQtyRef.current?.focus(), 50)
  }

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3000) }

  // ── Persistence helpers ─────────────────────────────────────────────────────
  const basisToDb = (b: Basis) => ({ uom_type: b === 'percentage' ? 'percentage' : 'pcs', is_case_level: b === 'pcs_case' })

  async function saveWeight() {
    setSavingWeight(true)
    const { error } = await sb.from('products').update({ weight_per_unit_grams: wG || null }).eq('sku', product.sku)
    setSavingWeight(false); error ? flash('Error: ' + error.message) : (flash('Weight saved'), loadBom())
  }
  async function saveProdCost() {
    setSavingProdCost(true)
    const { error } = await sb.from('products').update({ production_cost: prodCostNum || 0 }).eq('sku', product.sku)
    setSavingProdCost(false); flash(error ? 'Error: ' + error.message : 'Production cost saved')
  }
  async function saveTier(key: string, val: number) {
    setSavingTier(key)
    const { error } = await sb.from('products').update({ [key]: val || null }).eq('sku', product.sku)
    setSavingTier(null); flash(error ? 'Error: ' + error.message : 'Saved')
  }
  async function saveAll() {
    setSavingAll(true)
    const patch: Record<string, any> = { weight_per_unit_grams: wG || null, bom_cost: totalCost || null, production_cost: prodCostNum || 0, case_cost: caseCostTotal || null }
    for (const t of TIERS) patch[t.key] = suggested[t.key] || null
    const { error } = await sb.from('products').update(patch).eq('sku', product.sku)
    setSavingAll(false); flash(error ? 'Error: ' + error.message : 'All pricing saved')
    if (!error && onUpdate) onUpdate()
  }
  async function saveCaseCost() {
    setSavingCase(true)
    const { error } = await sb.from('products').update({ case_cost: caseCostTotal || null }).eq('sku', product.sku)
    setSavingCase(false); flash(error ? 'Error: ' + error.message : 'Case cost saved')
  }

  async function addComponent() {
    setAddErr('')
    if (!addSku) { setAddErr('Pick a component from search'); return }
    const qty = parseFloat(addQty)
    if (!qty || qty <= 0) { setAddErr('Enter a value greater than 0'); return }
    if (addBasis === 'percentage' && totalPct + qty > 100.001) { setAddErr(`Total % would be ${(totalPct + qty).toFixed(2)} (max 100)`); return }
    setAdding(true)
    const db = basisToDb(addBasis)
    const { error } = await sb.from('product_bom').insert({
      finished_good_sku: product.sku, component_sku: addSku,
      percentage: addBasis === 'percentage' ? qty : 0, qty_value: qty, ...db,
    })
    if (error) { setAddErr(error.message); setAdding(false); return }
    setAddSku(''); setAddSkuName(''); setAddSkuCat(null); setAddQuery(''); setAddQty(''); setAddBasis('percentage'); setAdding(false)
    loadBom()
  }
  async function deleteRow(id: string) {
    await sb.from('product_bom').delete().eq('id', id)
    setComponents(cs => cs.filter(c => c.id !== id))
  }
  async function updateBasis(id: string, b: Basis) {
    setComponents(cs => cs.map(c => c.id === id ? { ...c, basis: b } : c))
    await sb.from('product_bom').update(basisToDb(b)).eq('id', id)
  }
  async function updateQtyValue(id: string, rawVal: string) {
    const v = parseFloat(rawVal)
    if (isNaN(v) || v < 0) return
    setComponents(cs => cs.map(c => c.id === id ? { ...c, qty_value: v } : c))
    const row = components.find(c => c.id === id)
    const patch: Record<string, any> = { qty_value: v }
    if (row?.basis === 'percentage') patch.percentage = v
    await sb.from('product_bom').update(patch).eq('id', id)
  }

  const CatBadge = ({ c }: { c: string | null }) => c ? (() => { const s = catStyle(c); return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ background: s.bg, color: s.fg }}>{c}</span> })() : null

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div onClick={e => e.stopPropagation()}
        className="fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-screen w-full md:w-[940px] bg-[#F7F8FB] z-50 flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#E4E6EE] bg-white shrink-0">
          <div className="min-w-0">
            <span className="text-[11px] text-[#7A3FB0] font-bold uppercase tracking-wider">BOM Editor</span>
            <h2 className="text-[#1A1D2E] font-semibold text-sm mt-0.5 truncate">
              <span className="text-[#0F7A4E] font-mono">{product.sku}</span>
              <span className="text-gray-400 mx-1.5">·</span>{product.product_name}
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1 rounded-lg hover:bg-gray-100 shrink-0 ml-4">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* LEFT: components */}
          <div className="flex flex-col overflow-hidden border-r border-[#E4E6EE]" style={{ width: '58%' }}>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {/* Weight */}
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-xs text-gray-500 whitespace-nowrap font-medium">Unit weight (g)</label>
                <input type="number" min="0" step="0.001" value={weightGrams} onChange={e => setWeightGrams(e.target.value)} className={inp + ' w-28'} />
                <button onClick={saveWeight} disabled={savingWeight} className="text-xs px-2.5 py-1.5 bg-[#EEF0F4] hover:bg-[#E2E6EE] text-gray-600 rounded-lg disabled:opacity-50">{savingWeight ? '…' : 'Save'}</button>
                <span className="text-xs text-gray-400 ml-auto">Case = {caseQty} unit{caseQty === 1 ? '' : 's'}</span>
              </div>

              {/* Warnings */}
              {anyPct && Math.abs(totalPct - 100) > 0.1 && (
                <div className="text-[11px] rounded-lg px-3 py-2 bg-amber-50 border border-amber-200 text-amber-800">
                  Raw-material % adds up to <b>{totalPct.toFixed(2)}%</b> — should be 100% for an accurate per-unit material cost.
                </div>
              )}
              {missingCost.length > 0 && (
                <div className="text-[11px] rounded-lg px-3 py-2 bg-amber-50 border border-amber-200 text-amber-800">
                  {missingCost.length} component{missingCost.length === 1 ? '' : 's'} have no unit cost in Inventory ({missingCost.map(c => c.component_sku).join(', ')}) — set their cost so the BOM totals are complete.
                </div>
              )}

              {/* Components table */}
              <div className="bg-white border border-[#ECEEF3] rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs min-w-[560px]">
                    <thead>
                      <tr className="bg-[#FBFCFE] border-b border-[#EEF0F4] text-[10px] uppercase tracking-wide text-gray-400">
                        <th className="text-left font-semibold px-2.5 py-2">Component</th>
                        <th className="text-left font-semibold px-2 py-2 w-[128px]">Basis</th>
                        <th className="text-right font-semibold px-2 py-2 w-[70px]">Qty</th>
                        <th className="text-right font-semibold px-2 py-2 w-[92px]">Unit cost</th>
                        <th className="text-right font-semibold px-2.5 py-2 w-[96px]">Ext / unit</th>
                        <th className="w-8 px-1 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F3F4F8]">
                      {loading && <tr><td colSpan={6} className="px-3 py-5 text-center text-gray-400">Loading…</td></tr>}
                      {!loading && computedRows.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400 italic">No components yet — add one below.</td></tr>}
                      {!loading && computedRows.map(c => (
                        <tr key={c.id} className="hover:bg-[#FBFCFE]">
                          <td className="px-2.5 py-2">
                            <div className="font-mono font-semibold text-[#0F7A4E] text-[12px]">{c.component_sku}</div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-gray-500 truncate max-w-[150px] inline-block align-middle">{c.product_name}</span>
                              <CatBadge c={c.category} />
                            </div>
                          </td>
                          <td className="px-2 py-2">
                            <select value={c.basis} onChange={e => updateBasis(c.id, e.target.value as Basis)} className={inp + ' w-full !py-1 !px-1.5 text-[11px] cursor-pointer'}>
                              <option value="percentage">% by weight</option>
                              <option value="pcs_unit">pcs / unit</option>
                              <option value="pcs_case">pcs / case</option>
                            </select>
                          </td>
                          <td className="px-2 py-2">
                            <input type="number" min="0" step="0.01" defaultValue={c.qty_value} key={c.id + c.basis + '-q'} onBlur={e => updateQtyValue(c.id, e.target.value)} className={inp + ' w-full text-right !py-1 !px-1.5 text-[11px]'} />
                          </td>
                          <td className="px-2 py-2 text-right text-gray-500 whitespace-nowrap">
                            {c.basis === 'percentage' ? <span>{fmt2(c.unit_cost)}<span className="text-gray-300">/lb</span></span> : <span>{fmt2(c.unit_cost)}<span className="text-gray-300">/ea</span></span>}
                          </td>
                          <td className="px-2.5 py-2 text-right font-semibold text-[#1A1D2E] whitespace-nowrap">{fmt4(c.extended_cost)}</td>
                          <td className="px-1 py-2 text-center">
                            <button onClick={() => deleteRow(c.id)} className="text-red-400 hover:text-red-600 p-0.5 rounded hover:bg-red-50"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg></button>
                          </td>
                        </tr>
                      ))}
                      {!loading && computedRows.length > 0 && (
                        <tr className="bg-[#FBFCFE] border-t border-[#EEF0F4]">
                          <td className="px-2.5 py-2 text-right text-gray-500" colSpan={2}>Material total →</td>
                          <td className={`px-2 py-2 text-right font-bold ${anyPct && Math.abs(totalPct - 100) > 0.1 ? 'text-amber-600' : 'text-emerald-600'}`}>{anyPct ? totalPct.toFixed(1) + '%' : ''}</td>
                          <td />
                          <td className="px-2.5 py-2 text-right font-bold text-[#1A1D2E]">{fmt4(totals.totalMat)}</td>
                          <td />
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Add component */}
            <div className="shrink-0 px-4 py-3 border-t border-[#E4E6EE] bg-white">
              <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">+ Add component (from Inventory)</p>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[180px]" ref={dropRef}>
                  {addSku ? (
                    <div className="flex items-center gap-1.5 bg-[#F0FDF4] border border-emerald-300 rounded-lg px-2 py-1.5 text-xs">
                      <span className="text-[#0F7A4E] font-mono font-bold">{addSku}</span>
                      <span className="text-gray-500 truncate max-w-[110px]">{addSkuName}</span>
                      <CatBadge c={addSkuCat} />
                      <button onClick={() => { setAddSku(''); setAddSkuName(''); setAddSkuCat(null) }} className="ml-auto text-gray-400 hover:text-gray-700"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg></button>
                    </div>
                  ) : (
                    <input value={addQuery} onChange={e => setAddQuery(e.target.value)} onFocus={() => addQuery.length >= 2 && setShowDrop(true)} placeholder="Search SKU or name (min 2 chars)…" className={inp + ' w-full'} />
                  )}
                  {showDrop && searchResults.length > 0 && !addSku && (
                    <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-[#E4E6EE] rounded-lg shadow-xl z-20 overflow-hidden max-h-52 overflow-y-auto">
                      {searchResults.map(r => (
                        <button key={r.sku} onMouseDown={() => selectResult(r)} className="w-full text-left px-3 py-2 border-b border-[#F1F3F7] last:border-0 hover:bg-[#F2F6FF]">
                          <div className="flex items-center gap-2"><span className="text-[#0F7A4E] font-mono font-bold text-xs">{r.sku}</span><CatBadge c={r.category} /></div>
                          <div className="flex items-center justify-between mt-0.5"><p className="text-gray-600 truncate text-xs">{r.product_name}</p>{r.unit_cost != null && <p className="text-gray-400 text-xs ml-2 whitespace-nowrap">{fmt2(r.unit_cost)}</p>}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <select value={addBasis} onChange={e => setAddBasis(e.target.value as Basis)} className={inp + ' cursor-pointer'}>
                  <option value="percentage">% by weight</option>
                  <option value="pcs_unit">pcs / unit</option>
                  <option value="pcs_case">pcs / case</option>
                </select>
                <input ref={addQtyRef} type="number" min="0" step="0.01" value={addQty} onChange={e => setAddQty(e.target.value)} onKeyDown={e => e.key === 'Enter' && addComponent()} placeholder={addBasis === 'percentage' ? '%' : 'pcs'} className={inp + ' w-20 text-right'} />
                <button onClick={addComponent} disabled={adding || !addSku || !addQty} className="px-3 py-1.5 bg-[#00863F] hover:bg-[#0b7a3d] disabled:bg-gray-200 disabled:text-gray-400 text-white rounded-lg text-xs font-semibold whitespace-nowrap">{adding ? '…' : '+ Add'}</button>
              </div>
              {addErr && <p className="text-red-600 text-xs mt-1.5">{addErr}</p>}
              {addBasis === 'percentage' && anyPct && totalPct < 100 && <p className="text-[11px] text-gray-400 mt-1">{(100 - totalPct).toFixed(2)}% of weight remaining.</p>}
            </div>
          </div>

          {/* RIGHT: cost summary + pricing */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {/* Cost summary */}
            <div className="bg-white border border-[#ECEEF3] rounded-xl p-4">
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Cost Summary</p>
              {[
                ['Raw material', totals.rawMat],
                ['Unit packaging', totals.unitPkg],
                ['Case packaging (÷ case)', totals.casePkg],
              ].map(([l, v]) => (
                <div key={l as string} className="flex items-center justify-between py-1 text-sm"><span className="text-gray-500">{l}</span><span className="text-[#1A1D2E] font-medium">{fmt4(v as number)}</span></div>
              ))}
              <div className="flex items-center justify-between py-1.5 text-sm border-t border-[#EEF0F4] mt-1"><span className="text-gray-600 font-semibold">Total material</span><span className="text-[#1A1D2E] font-bold">{fmt4(totals.totalMat)}</span></div>
              <div className="flex items-center justify-between gap-2 py-2 border-t border-[#EEF0F4] mt-1">
                <span className="text-gray-500 text-sm">Production</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-400 text-sm">$</span>
                  <input type="number" min="0" step="0.0001" value={productionCost} onChange={e => setProductionCost(e.target.value)} className={inp + ' w-24 text-right !py-1'} />
                  <button onClick={saveProdCost} disabled={savingProdCost} className="text-xs px-2 py-1 bg-[#EEF0F4] hover:bg-[#E2E6EE] text-gray-600 rounded disabled:opacity-50">{savingProdCost ? '…' : 'Save'}</button>
                </div>
              </div>
              <div className="flex items-center justify-between py-2 border-t border-[#EEF0F4] mt-1"><span className="text-[#1A1D2E] font-bold text-sm">Total cost / unit</span><span className="text-[#00863F] font-extrabold text-lg">{fmt4(totalCost)}</span></div>
            </div>

            {/* Pricing */}
            <div className="bg-white border border-[#ECEEF3] rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Pricing</p>
                <button onClick={saveAll} disabled={savingAll} className="text-xs px-3 py-1 rounded-lg bg-[#7A3FB0] hover:bg-[#6a35a0] text-white font-semibold disabled:opacity-50">{savingAll ? '…' : 'Save All'}</button>
              </div>
              <table className="w-full text-xs">
                <thead><tr className="text-[10px] uppercase tracking-wide text-gray-400"><th className="text-left font-semibold py-1">Tier</th><th className="text-center font-semibold py-1 w-8">×</th><th className="text-right font-semibold py-1">Suggested</th><th className="text-right font-semibold py-1">Current</th><th className="w-8" /></tr></thead>
                <tbody>
                  {TIERS.map(t => (
                    <tr key={t.key} className="border-t border-[#F3F4F8]">
                      <td className="py-1.5 text-gray-600 font-medium">{t.label}</td>
                      <td className="py-1.5 text-center text-gray-400">{t.mult}</td>
                      <td className="py-1.5 text-right text-emerald-600 font-semibold font-mono">{fmt2(suggested[t.key])}</td>
                      <td className="py-1.5 text-right text-gray-400 font-mono">{product[t.key] != null ? fmt2(Number(product[t.key])) : '—'}</td>
                      <td className="py-1.5 text-right"><button onClick={() => saveTier(t.key, suggested[t.key])} disabled={savingTier === t.key} className="text-xs px-2 py-0.5 rounded bg-[#EFE7FB] hover:bg-[#E3D5F8] text-[#7A3FB0] disabled:opacity-50">{savingTier === t.key ? '…' : 'Save'}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Case cost */}
            {totalCost > 0 && (
              <div className="bg-white border border-[#ECEEF3] rounded-xl p-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Case Cost</p>
                  <p className="text-[#1A1D2E] font-extrabold text-lg mt-0.5 font-mono">{fmt2(caseCostTotal)}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{fmt4(totalCost)} × {caseQty} unit{caseQty === 1 ? '' : 's'}</p>
                </div>
                <button onClick={saveCaseCost} disabled={savingCase} className="text-xs px-3 py-1.5 bg-[#EEF0F4] hover:bg-[#E2E6EE] text-gray-600 rounded-lg disabled:opacity-50 whitespace-nowrap">{savingCase ? '…' : 'Save Case Cost'}</button>
              </div>
            )}

            {msg && <p className={`text-xs text-center py-2 rounded-lg ${msg.startsWith('Error') ? 'text-red-600 bg-red-50' : 'text-emerald-700 bg-emerald-50'}`}>{msg}</p>}
          </div>
        </div>
      </div>
    </>
  )
}
