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

interface BomRow {
  id: string
  component_sku: string
  product_name: string
  category: string | null
  unit_cost: number
  uom_type: 'percentage' | 'pcs'
  qty_value: number  // percentage (0-100) or pcs count
  is_case_level: boolean
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
  { key: 'distribution_price', label: 'Dist.',  mult: 2.5 },
  { key: 'wholesale_price',    label: 'Whsl.',  mult: 4   },
  { key: 'msrp',               label: 'MSRP',   mult: 8   },
  { key: 'imap',               label: 'IMAP',   mult: 6   },
  { key: 'map_price',          label: 'MAP',    mult: 5   },
] as const

const PKG_CATEGORIES = ['Packaging', 'Print Plates']

function getUomType(cat: string | null): 'percentage' | 'pcs' {
  return cat && PKG_CATEGORIES.includes(cat) ? 'pcs' : 'percentage'
}

const CAT_COLORS: Record<string, string> = {
  'Raw Material':         'bg-amber-500/20 text-amber-400 border-amber-500/30',
  'Packaging':            'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'Additives':            'bg-pink-500/20 text-pink-400 border-pink-500/30',
  'WIP':                  'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  'Print Plates':         'bg-violet-500/20 text-violet-400 border-violet-500/30',
  'Composter Components': 'bg-teal-500/20 text-teal-400 border-teal-500/30',
  'Component':            'bg-gray-700/50 text-gray-400 border-gray-700',
}

const fmt2 = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
const fmt4 = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(n)

// ── Main Component ─────────────────────────────────────────────────────────
export default function BomEditor({ product, onClose, onUpdate }: Props) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])

  // Data
  const [components, setComponents] = useState<BomRow[]>([])
  const [weightGrams, setWeightGrams] = useState(String(product.weight_per_unit_grams ?? ''))
  const [productionCost, setProductionCost] = useState('0')
  const [loading, setLoading] = useState(true)

  // Add-row state
  const [addQuery, setAddQuery] = useState('')
  const [addSku, setAddSku] = useState('')
  const [addSkuName, setAddSkuName] = useState('')
  const [addSkuCat, setAddSkuCat] = useState<string | null>(null)
  const [addUomType, setAddUomType] = useState<'percentage' | 'pcs'>('percentage')
  const [addQty, setAddQty] = useState('')
  const [addCaseLevel, setAddCaseLevel] = useState(false)
  const [addErr, setAddErr] = useState('')
  const [adding, setAdding] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [showDrop, setShowDrop] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)
  const addQtyRef = useRef<HTMLInputElement>(null)

  // Saving
  const [savingWeight, setSavingWeight] = useState(false)
  const [savingProdCost, setSavingProdCost] = useState(false)
  const [savingTier, setSavingTier] = useState<string | null>(null)
  const [savingAll, setSavingAll] = useState(false)
  const [savingCase, setSavingCase] = useState(false)
  const [msg, setMsg] = useState('')

  // ── Load BOM ──────────────────────────────────────────────────────────────
  const loadBom = useCallback(async () => {
    setLoading(true)
    let bomRows: any[] = []

    // Try finished_good_sku first, then fall back to sku
    const { data: d1, error: e1 } = await sb.from('product_bom').select('*').eq('finished_good_sku', product.sku)
    if (!e1) {
      bomRows = d1 ?? []
    } else {
      const { data: d2 } = await sb.from('product_bom').select('*').eq('sku', product.sku)
      bomRows = d2 ?? []
    }

    // Load production_cost
    const { data: pd } = await sb.from('products').select('production_cost').eq('sku', product.sku).maybeSingle()
    if (pd?.production_cost != null) setProductionCost(String(pd.production_cost))

    if (!bomRows.length) { setComponents([]); setLoading(false); return }

    // Fetch component details
    const compSkusAll = bomRows.map((r: any) => r.component_sku).filter(Boolean) as string[]
    const compSkus = compSkusAll.filter((s, i) => compSkusAll.indexOf(s) === i)
    const { data: prods } = await sb.from('products').select('sku,product_name,category,unit_cost').in('sku', compSkus)
    const pm: Record<string, any> = {}
    for (const p of (prods ?? []) as any[]) pm[p.sku] = p

    const rows: BomRow[] = bomRows.map((r: any) => {
      const comp = pm[r.component_sku] ?? {}
      const cat = comp.category ?? null
      // uom_type: from saved column, or derive from category
      const uomType: 'percentage' | 'pcs' =
        r.uom_type === 'pcs' ? 'pcs' : r.uom_type === 'percentage' ? 'percentage' : getUomType(cat)
      // qty_value: from new column or fall back to percentage
      const qtyVal: number = r.qty_value != null ? Number(r.qty_value) : Number(r.percentage ?? 0)
      return {
        id: r.id,
        component_sku: r.component_sku,
        product_name: comp.product_name ?? '—',
        category: cat,
        unit_cost: Number(comp.unit_cost ?? 0),
        uom_type: uomType,
        qty_value: qtyVal,
        is_case_level: Boolean(r.is_case_level),
      }
    })
    setComponents(rows)
    setLoading(false)
  }, [sb, product.sku])

  useEffect(() => { loadBom() }, [loadBom])

  // Close dropdown on outside click
  useEffect(() => {
    function h(e: MouseEvent) { if (dropRef.current && !dropRef.current.contains(e.target as Node)) setShowDrop(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // ── Derived values ─────────────────────────────────────────────────────────
  const wG = parseFloat(weightGrams) || 0
  const caseQty = product.case_qty || 1

  const computedRows = useMemo(() =>
    components.map(c => {
      let ext = 0
      if (c.uom_type === 'percentage') {
        const cpg = c.unit_cost / 453.592
        ext = (c.qty_value / 100) * wG * cpg
      } else if (!c.is_case_level) {
        ext = c.qty_value * c.unit_cost
      } else {
        ext = (c.qty_value * c.unit_cost) / caseQty
      }
      return { ...c, extended_cost: ext }
    }),
    [components, wG, caseQty]
  )

  const totals = useMemo(() => {
    let rawMat = 0, unitPkg = 0, casePkgPerUnit = 0
    for (const c of computedRows) {
      if (c.uom_type === 'percentage') rawMat += c.extended_cost
      else if (!c.is_case_level) unitPkg += c.extended_cost
      else casePkgPerUnit += c.extended_cost
    }
    const totalMat = rawMat + unitPkg + casePkgPerUnit
    return { rawMat, unitPkg, casePkgPerUnit, totalMat }
  }, [computedRows])

  const totalPct = computedRows.filter(c => c.uom_type === 'percentage').reduce((s, c) => s + c.qty_value, 0)
  const prodCostNum = parseFloat(productionCost) || 0
  const totalCost = totals.totalMat + prodCostNum
  const caseCostTotal = totalCost * caseQty

  const suggested: Record<string, number> = {}
  for (const t of TIERS) suggested[t.key] = totalCost * t.mult

  // ── Typeahead search ────────────────────────────────────────────────────────
  useEffect(() => {
    if (addQuery.length < 2) { setSearchResults([]); setShowDrop(false); return }
    const t = setTimeout(async () => {
      const { data } = await sb.from('products')
        .select('sku,product_name,category,unit_cost')
        .or(`sku.ilike.%${addQuery}%,product_name.ilike.%${addQuery}%`)
        .neq('sku', product.sku)
        .neq('category', 'Finished Goods')
        .order('sku').limit(8)
      setSearchResults((data ?? []) as SearchResult[])
      setShowDrop(true)
    }, 180)
    return () => clearTimeout(t)
  }, [addQuery, sb, product.sku])

  function selectResult(r: SearchResult) {
    setAddSku(r.sku)
    setAddSkuName(r.product_name)
    setAddSkuCat(r.category)
    const uom = getUomType(r.category)
    setAddUomType(uom)
    setAddCaseLevel(false)
    setAddQuery('')
    setShowDrop(false)
    setTimeout(() => addQtyRef.current?.focus(), 50)
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(''), 3000) }

  async function saveWeight() {
    setSavingWeight(true)
    const { error } = await sb.from('products').update({ weight_per_unit_grams: wG || null }).eq('sku', product.sku)
    setSavingWeight(false)
    if (error) flash('Error: ' + error.message)
    else { flash('Weight saved!'); loadBom() }
  }

  async function saveProdCost() {
    setSavingProdCost(true)
    const { error } = await sb.from('products').update({ production_cost: prodCostNum || 0 }).eq('sku', product.sku)
    setSavingProdCost(false)
    flash(error ? 'Error: ' + error.message : 'Production cost saved!')
  }

  async function saveTier(key: string, val: number) {
    setSavingTier(key)
    const { error } = await sb.from('products').update({ [key]: val || null }).eq('sku', product.sku)
    setSavingTier(null)
    flash(error ? 'Error: ' + error.message : 'Saved!')
  }

  async function saveAll() {
    setSavingAll(true)
    const patch: Record<string, any> = {
      weight_per_unit_grams: wG || null,
      bom_cost: totalCost || null,
      production_cost: prodCostNum || 0,
      case_cost: caseCostTotal || null,
    }
    for (const t of TIERS) patch[t.key] = suggested[t.key] || null
    const { error } = await sb.from('products').update(patch).eq('sku', product.sku)
    setSavingAll(false)
    flash(error ? 'Error: ' + error.message : 'All pricing saved!')
    if (!error && onUpdate) onUpdate()
  }

  async function saveCaseCost() {
    setSavingCase(true)
    const { error } = await sb.from('products').update({ case_cost: caseCostTotal || null }).eq('sku', product.sku)
    setSavingCase(false)
    flash(error ? 'Error: ' + error.message : 'Case cost saved!')
  }

  async function addComponent() {
    setAddErr('')
    if (!addSku) { setAddErr('Select a SKU from search'); return }
    const qty = parseFloat(addQty)
    if (!qty || qty <= 0) { setAddErr('Enter a value > 0'); return }
    if (addUomType === 'percentage' && totalPct + qty > 100.001) {
      setAddErr(`Total % would be ${(totalPct + qty).toFixed(2)} (max 100)`); return
    }

    setAdding(true)
    const payload: Record<string, any> = {
      component_sku: addSku,
      percentage: addUomType === 'percentage' ? qty : 0,
      qty_value: qty,
      uom_type: addUomType,
      is_case_level: addCaseLevel,
    }

    // Try with finished_good_sku + new columns
    let { error } = await sb.from('product_bom').insert({ ...payload, finished_good_sku: product.sku })

    if (error?.message?.includes('finished_good_sku')) {
      // Fallback: use sku column
      const fb1 = await sb.from('product_bom').insert({ ...payload, sku: product.sku })
      error = fb1.error
    }
    if (error?.message?.includes('uom_type') || error?.message?.includes('qty_value') || error?.message?.includes('is_case_level')) {
      // New columns not migrated yet — insert base only
      const fb2 = await sb.from('product_bom').insert({
        finished_good_sku: product.sku,
        component_sku: addSku,
        percentage: addUomType === 'percentage' ? qty : 0,
      })
      if (fb2.error?.message?.includes('finished_good_sku')) {
        const fb3 = await sb.from('product_bom').insert({ sku: product.sku, component_sku: addSku, percentage: addUomType === 'percentage' ? qty : 0 })
        if (fb3.error) { setAddErr(fb3.error.message); setAdding(false); return }
      } else if (fb2.error) { setAddErr(fb2.error.message); setAdding(false); return }
      error = null
    }

    if (error) { setAddErr(error.message); setAdding(false); return }

    // Clear inputs immediately — ready for next component
    setAddSku(''); setAddSkuName(''); setAddSkuCat(null)
    setAddQuery(''); setAddQty(''); setAddUomType('percentage')
    setAddCaseLevel(false); setAddErr('')
    setAdding(false)
    loadBom()
  }

  async function deleteRow(id: string) {
    await sb.from('product_bom').delete().eq('id', id)
    setComponents(cs => cs.filter(c => c.id !== id))
  }

  async function toggleCaseLevel(id: string, cur: boolean) {
    const next = !cur
    // Update DB speculatively (column may not exist)
    const { error } = await sb.from('product_bom').update({ is_case_level: next }).eq('id', id)
    if (!error) {
      setComponents(cs => cs.map(c => c.id === id ? { ...c, is_case_level: next } : c))
    }
  }

  async function updateQtyValue(id: string, rawVal: string) {
    const v = parseFloat(rawVal)
    if (isNaN(v) || v < 0) return
    setComponents(cs => cs.map(c => c.id === id ? { ...c, qty_value: v } : c))
    // Update DB
    const row = components.find(c => c.id === id)
    if (!row) return
    const patch: Record<string, any> = { qty_value: v }
    if (row.uom_type === 'percentage') patch.percentage = v
    await sb.from('product_bom').update(patch).eq('id', id)
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/60 z-40"/>
      <div onClick={e => e.stopPropagation()}
        className="fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-screen w-full md:w-[900px] bg-gray-900 border-l border-gray-800 z-50 flex flex-col shadow-2xl">

        {/* ── Header (fixed) ── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800 shrink-0">
          <div className="min-w-0">
            <span className="text-xs text-violet-400 font-semibold uppercase tracking-wider">BOM Editor</span>
            <h2 className="text-white font-semibold text-sm mt-0.5 truncate">
              <span className="text-emerald-400 font-mono">{product.sku}</span>
              <span className="text-gray-400 mx-1.5">·</span>
              {product.product_name}
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-gray-800 shrink-0 ml-4">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        {/* ── Two-column body (fills remaining height, no outer scroll) ── */}
        <div className="flex-1 flex overflow-hidden min-h-0">

          {/* ── LEFT COLUMN: weight + components + add row ── */}
          <div className="flex flex-col overflow-hidden border-r border-gray-800" style={{ width: '55%' }}>
            <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2 space-y-3">

              {/* Weight */}
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500 whitespace-nowrap">Unit weight (g)</label>
                <input type="number" min="0" step="0.001" value={weightGrams} onChange={e => setWeightGrams(e.target.value)}
                  className="bg-gray-800 border border-gray-700 text-white rounded px-2 py-1.5 text-xs w-28 focus:outline-none focus:ring-1 focus:ring-violet-500 transition"/>
                <button onClick={saveWeight} disabled={savingWeight}
                  className="text-xs px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors disabled:opacity-50 whitespace-nowrap">
                  {savingWeight ? '…' : 'Save'}
                </button>
                <span className="text-xs text-gray-600">case: {caseQty} units</span>
              </div>

              {/* Components table */}
              <div className="border border-gray-800 rounded-lg overflow-hidden">
                <table className="w-full" style={{ fontSize: '11px' }}>
                  <thead>
                    <tr className="bg-gray-800/70 border-b border-gray-800">
                      <th className="text-left text-gray-500 px-2 py-1.5 font-medium">P/N</th>
                      <th className="text-left text-gray-500 px-2 py-1.5 font-medium">Name</th>
                      <th className="text-left text-gray-500 px-2 py-1.5 font-medium">Cat</th>
                      <th className="text-left text-gray-500 px-2 py-1.5 font-medium">UOM</th>
                      <th className="text-left text-gray-500 px-2 py-1.5 font-medium">Qty/%</th>
                      <th className="text-left text-gray-500 px-2 py-1.5 font-medium">Cost</th>
                      <th className="text-left text-gray-500 px-2 py-1.5 font-medium">Ext/unit</th>
                      <th className="text-center text-gray-500 px-1 py-1.5 font-medium">Case?</th>
                      <th className="px-1 py-1.5"/>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && (
                      <tr><td colSpan={9} className="px-3 py-4 text-center text-gray-600">Loading…</td></tr>
                    )}
                    {!loading && computedRows.length === 0 && (
                      <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-700">No components. Use the row below to add.</td></tr>
                    )}
                    {!loading && computedRows.map(c => (
                      <tr key={c.id} className="border-b border-gray-800/50 last:border-0 hover:bg-gray-800/20">
                        <td className="px-2 py-1.5 text-emerald-400 font-mono font-bold whitespace-nowrap">{c.component_sku}</td>
                        <td className="px-2 py-1.5 text-gray-200 max-w-[110px] truncate">{c.product_name}</td>
                        <td className="px-2 py-1.5">
                          {c.category && (
                            <span className={`px-1 py-0.5 rounded border text-xs ${CAT_COLORS[c.category] ?? 'bg-gray-700/50 text-gray-400 border-gray-700'}`}
                              style={{ fontSize: '10px' }}>
                              {c.category.split(' ')[0]}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-gray-500">{c.uom_type === 'pcs' ? 'pcs' : '%'}</td>
                        {/* Editable qty value */}
                        <td className="px-2 py-1.5">
                          <input type="number" min="0" step="0.01"
                            defaultValue={c.qty_value}
                            key={c.id + '-qty'}
                            onBlur={e => updateQtyValue(c.id, e.target.value)}
                            className="bg-gray-800/80 border border-gray-700/50 text-gray-200 rounded px-1.5 py-0.5 w-16 focus:outline-none focus:ring-1 focus:ring-violet-500 transition"
                            style={{ fontSize: '11px' }}/>
                        </td>
                        <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">
                          {c.uom_type === 'pcs' ? fmt2(c.unit_cost) : `${(c.unit_cost / 453.592).toFixed(5)}/g`}
                        </td>
                        <td className="px-2 py-1.5 text-white font-semibold whitespace-nowrap">
                          {fmt4(c.extended_cost)}
                          {c.is_case_level && (
                            <span className="text-gray-600 ml-1" style={{ fontSize: '10px' }}>÷{caseQty}</span>
                          )}
                        </td>
                        {/* Case-level checkbox — only for pcs type */}
                        <td className="px-1 py-1.5 text-center">
                          {c.uom_type === 'pcs' ? (
                            <input type="checkbox" checked={c.is_case_level}
                              onChange={() => toggleCaseLevel(c.id, c.is_case_level)}
                              className="accent-violet-500 cursor-pointer w-3 h-3"/>
                          ) : <span className="text-gray-800">—</span>}
                        </td>
                        <td className="px-1 py-1.5">
                          <button onClick={() => deleteRow(c.id)}
                            className="text-red-500 hover:text-red-400 p-0.5 rounded hover:bg-red-500/10 transition-colors">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                    {/* Totals */}
                    {!loading && computedRows.length > 0 && (
                      <tr className="bg-gray-800/40 border-t border-gray-700">
                        <td colSpan={3} className="px-2 py-1.5 text-gray-500 text-right" style={{ fontSize: '11px' }}>Totals →</td>
                        <td className="px-2 py-1.5"/>
                        <td className={`px-2 py-1.5 font-bold ${totalPct > 100.001 ? 'text-red-400' : totalPct >= 99.9 ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {totalPct.toFixed(1)}%
                        </td>
                        <td className="px-2 py-1.5"/>
                        <td className="px-2 py-1.5 text-white font-bold">
                          {fmt4(totals.totalMat)}
                        </td>
                        <td colSpan={2}/>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Add component row (sticky at bottom of left column) ── */}
            <div className="shrink-0 px-4 py-3 border-t border-gray-800 bg-gray-900/80">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">+ Add Component</p>
              <div className="flex items-center gap-2 flex-wrap">
                {/* SKU search */}
                <div className="relative flex-1 min-w-[160px]" ref={dropRef}>
                  {addSku ? (
                    <div className="flex items-center gap-1.5 bg-gray-800 border border-emerald-500/40 rounded px-2 py-1.5 text-xs">
                      <span className="text-emerald-400 font-mono font-bold">{addSku}</span>
                      <span className="text-gray-400 truncate max-w-[80px]">{addSkuName}</span>
                      {addSkuCat && <span className={`px-1 py-0.5 rounded border ${CAT_COLORS[addSkuCat] ?? 'bg-gray-700/50 text-gray-400 border-gray-700'}`} style={{ fontSize: '10px' }}>{addSkuCat.split(' ')[0]}</span>}
                      <button onClick={() => { setAddSku(''); setAddSkuName(''); setAddSkuCat(null) }}
                        className="ml-auto text-gray-600 hover:text-white">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                      </button>
                    </div>
                  ) : (
                    <input value={addQuery} onChange={e => setAddQuery(e.target.value)}
                      onFocus={() => addQuery.length >= 2 && setShowDrop(true)}
                      placeholder="Search SKU or name (min 2 chars)…"
                      className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-500 transition"
                      style={{ fontSize: '12px' }}/>
                  )}
                  {showDrop && searchResults.length > 0 && !addSku && (
                    <div className="absolute bottom-full left-0 right-0 mb-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-20 overflow-hidden max-h-48 overflow-y-auto">
                      {searchResults.map(r => (
                        <button key={r.sku} onMouseDown={() => selectResult(r)}
                          className="w-full text-left px-3 py-2 border-b border-gray-700 last:border-0 hover:bg-gray-700 transition-colors">
                          <div className="flex items-center gap-2">
                            <span className="text-emerald-400 font-mono font-bold text-xs">{r.sku}</span>
                            {r.category && <span className={`px-1 py-0.5 rounded border text-xs ${CAT_COLORS[r.category] ?? 'bg-gray-700/50 text-gray-400 border-gray-700'}`} style={{ fontSize: '10px' }}>{r.category.split(' ')[0]}</span>}
                          </div>
                          <div className="flex items-center justify-between mt-0.5">
                            <p className="text-gray-300 truncate text-xs">{r.product_name}</p>
                            {r.unit_cost != null && <p className="text-gray-500 text-xs ml-2 whitespace-nowrap">{fmt2(r.unit_cost)}/lb</p>}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Qty input with dynamic label */}
                <div className="flex items-center gap-1">
                  <span className="text-gray-500 text-xs whitespace-nowrap">{addUomType === 'pcs' ? 'pcs/unit:' : '% weight:'}</span>
                  <input ref={addQtyRef} type="number" min="0" step="0.01" value={addQty}
                    onChange={e => setAddQty(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addComponent()}
                    placeholder="0"
                    className="bg-gray-800 border border-gray-700 text-white rounded px-2 py-1.5 w-20 focus:outline-none focus:ring-1 focus:ring-violet-500 transition"
                    style={{ fontSize: '12px' }}/>
                </div>

                {/* Case-level checkbox — only for pcs UOM */}
                {addUomType === 'pcs' && (
                  <label className="flex items-center gap-1 text-xs text-gray-400 cursor-pointer whitespace-nowrap">
                    <input type="checkbox" checked={addCaseLevel} onChange={e => setAddCaseLevel(e.target.checked)}
                      className="accent-violet-500 w-3 h-3"/>
                    Case-lvl
                  </label>
                )}

                <button onClick={addComponent} disabled={adding || !addSku || !addQty}
                  className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded text-xs font-medium transition-colors whitespace-nowrap">
                  {adding ? '…' : '+ Add'}
                </button>
              </div>
              {addErr && <p className="text-red-400 text-xs mt-1.5">{addErr}</p>}
              {addUomType === 'percentage' && totalPct < 100 && computedRows.some(c => c.uom_type === 'percentage') && (
                <p className="text-xs text-gray-600 mt-1">{(100 - totalPct).toFixed(2)}% remaining</p>
              )}
            </div>
          </div>

          {/* ── RIGHT COLUMN: cost summary + pricing + case cost ── */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4" style={{ width: '45%' }}>

            {/* Cost Summary */}
            <div className="border border-gray-800 rounded-lg overflow-hidden">
              <div className="bg-gray-800/60 px-3 py-2 border-b border-gray-800">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Cost Summary</p>
              </div>
              <div className="divide-y divide-gray-800/50" style={{ fontSize: '12px' }}>
                <div className="px-3 py-2 flex justify-between">
                  <span className="text-gray-400">Raw Material</span>
                  <span className="text-gray-200 font-mono">{fmt4(totals.rawMat)}</span>
                </div>
                {totals.unitPkg > 0 && (
                  <div className="px-3 py-2 flex justify-between">
                    <span className="text-gray-400">Unit Packaging</span>
                    <span className="text-gray-200 font-mono">{fmt4(totals.unitPkg)}</span>
                  </div>
                )}
                {totals.casePkgPerUnit > 0 && (
                  <div className="px-3 py-2 flex justify-between">
                    <span className="text-gray-400">Case Pkg ÷{caseQty}</span>
                    <span className="text-gray-200 font-mono">{fmt4(totals.casePkgPerUnit)}</span>
                  </div>
                )}
                <div className="px-3 py-2 flex justify-between">
                  <span className="text-gray-400">Total Material</span>
                  <span className="text-white font-semibold font-mono">{fmt4(totals.totalMat)}</span>
                </div>
                {/* Production cost input */}
                <div className="px-3 py-2 flex items-center justify-between gap-2">
                  <span className="text-gray-400 shrink-0">Production</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-500 text-xs">$</span>
                    <input type="number" min="0" step="0.0001" value={productionCost}
                      onChange={e => setProductionCost(e.target.value)}
                      className="bg-gray-800 border border-gray-700 text-white rounded px-2 py-1 w-24 focus:outline-none focus:ring-1 focus:ring-violet-500 transition"
                      style={{ fontSize: '12px' }}/>
                    <button onClick={saveProdCost} disabled={savingProdCost}
                      className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors disabled:opacity-50">
                      {savingProdCost ? '…' : 'Save'}
                    </button>
                  </div>
                </div>
                <div className="px-3 py-2.5 flex justify-between bg-gray-800/30">
                  <span className="text-white font-semibold">Total Cost / unit</span>
                  <span className="text-emerald-400 font-bold text-base font-mono">{fmt4(totalCost)}</span>
                </div>
              </div>
            </div>

            {/* Pricing table */}
            {totalCost > 0 && (
              <div className="border border-gray-800 rounded-lg overflow-hidden">
                <div className="bg-gray-800/60 px-3 py-2 border-b border-gray-800 flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Pricing</p>
                  <button onClick={saveAll} disabled={savingAll}
                    className="text-xs px-2.5 py-1 bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 text-white rounded transition-colors">
                    {savingAll ? '…' : 'Save All'}
                  </button>
                </div>
                <table className="w-full" style={{ fontSize: '11px' }}>
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left text-gray-600 px-3 py-1.5 font-medium">Tier</th>
                      <th className="text-left text-gray-600 px-2 py-1.5 font-medium">×</th>
                      <th className="text-left text-gray-600 px-2 py-1.5 font-medium">Suggested</th>
                      <th className="text-left text-gray-600 px-2 py-1.5 font-medium">Current</th>
                      <th className="px-2 py-1.5"/>
                    </tr>
                  </thead>
                  <tbody>
                    {TIERS.map(({ key, label, mult }) => (
                      <tr key={key} className="border-b border-gray-800/40 last:border-0 hover:bg-gray-800/20">
                        <td className="px-3 py-1.5 text-gray-300 font-medium">{label}</td>
                        <td className="px-2 py-1.5 text-gray-600">{mult}</td>
                        <td className="px-2 py-1.5 text-emerald-400 font-semibold font-mono">{fmt2(suggested[key])}</td>
                        <td className="px-2 py-1.5 text-gray-500 font-mono">
                          {product[key] != null ? fmt2(Number(product[key])) : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="px-2 py-1.5">
                          <button onClick={() => saveTier(key, suggested[key])} disabled={savingTier === key}
                            className="text-xs px-2 py-0.5 rounded bg-violet-700/40 hover:bg-violet-700 text-violet-300 transition-colors disabled:opacity-50">
                            {savingTier === key ? '…' : '💾'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Case cost */}
            {totalCost > 0 && (
              <div className="border border-gray-800 rounded-lg p-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Case Cost</p>
                  <p className="text-white font-bold text-lg mt-0.5 font-mono">{fmt2(caseCostTotal)}</p>
                  <p className="text-xs text-gray-600 mt-0.5">{fmt4(totalCost)} × {caseQty} units</p>
                </div>
                <button onClick={saveCaseCost} disabled={savingCase}
                  className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors disabled:opacity-50 whitespace-nowrap">
                  {savingCase ? '…' : 'Save Case Cost'}
                </button>
              </div>
            )}

            {/* Flash message */}
            {msg && (
              <p className={`text-xs text-center py-2 rounded ${msg.startsWith('Error') ? 'text-red-400 bg-red-500/10' : 'text-emerald-400 bg-emerald-500/10'}`}>
                {msg}
              </p>
            )}

            {/* SQL reminder */}
            <div className="border border-dashed border-gray-800 rounded-lg p-3 bg-gray-900/40">
              <p className="text-xs text-gray-600 font-semibold mb-1.5">Run in Supabase SQL editor to enable all features:</p>
              <pre className="text-gray-700 text-xs font-mono leading-relaxed overflow-x-auto">{`ALTER TABLE product_bom
  ADD COLUMN IF NOT EXISTS uom_type text DEFAULT 'percentage',
  ADD COLUMN IF NOT EXISTS qty_value numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_case_level boolean DEFAULT false;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS production_cost numeric DEFAULT 0;`}</pre>
            </div>

          </div>
        </div>
      </div>
    </>
  )
}
