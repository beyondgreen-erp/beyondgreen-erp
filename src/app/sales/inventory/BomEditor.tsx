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

interface BomLine {
  id: string
  component_sku: string
  product_name: string
  category: string | null
  unit_cost: number
  percentage: number
  cost_per_gram: number
  extended_cost: number
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

const fmt$ = (n: number, d = 4) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: d, maximumFractionDigits: d }).format(n)
const inp = 'bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 transition'

// ── Component ──────────────────────────────────────────────────────────────
export default function BomEditor({ product, onClose, onUpdate }: Props) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])

  const [components, setComponents] = useState<BomLine[]>([])
  const [weightGrams, setWeightGrams] = useState(String(product.weight_per_unit_grams ?? ''))
  const [productionCost, setProductionCost] = useState('0')
  const [loading, setLoading] = useState(true)

  // Search state
  const [skuQuery, setSkuQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [showSearch, setShowSearch] = useState(false)
  const [selectedSku, setSelectedSku] = useState('')
  const [selectedSkuName, setSelectedSkuName] = useState('')
  const [newPct, setNewPct] = useState('')
  const [addErr, setAddErr] = useState('')
  const searchRef = useRef<HTMLDivElement>(null)

  // Save state
  const [savingWeight, setSavingWeight] = useState(false)
  const [savingProdCost, setSavingProdCost] = useState(false)
  const [savingTier, setSavingTier] = useState<string | null>(null)
  const [savingAll, setSavingAll] = useState(false)
  const [savingCase, setSavingCase] = useState(false)
  const [msg, setMsg] = useState('')

  // ── Load BOM ──────────────────────────────────────────────────────────────
  const loadBom = useCallback(async () => {
    setLoading(true)

    // Try finished_good_sku first, fall back to sku column
    let bomRows: any[] = []
    const { data: d1 } = await sb
      .from('product_bom')
      .select('id, finished_good_sku, component_sku, percentage')
      .eq('finished_good_sku', product.sku)
    if (d1 && d1.length >= 0) {
      bomRows = d1
    } else {
      // Fall back to old sku column
      const { data: d2 } = await sb
        .from('product_bom')
        .select('id, sku, component_sku, percentage')
        .eq('sku', product.sku)
      bomRows = d2 ?? []
    }

    // Load production_cost
    const { data: prodData } = await sb
      .from('products')
      .select('production_cost')
      .eq('sku', product.sku)
      .maybeSingle()
    if (prodData?.production_cost != null) {
      setProductionCost(String(prodData.production_cost))
    }

    if (bomRows.length === 0) { setComponents([]); setLoading(false); return }

    // Load component product details
    const skus = bomRows.map((r: any) => r.component_sku).filter(Boolean)
    const { data: prods } = await sb
      .from('products')
      .select('sku, product_name, category, unit_cost')
      .in('sku', skus)
    const prodMap: Record<string, any> = {}
    for (const p of (prods ?? []) as any[]) prodMap[p.sku] = p

    const wG = parseFloat(String(product.weight_per_unit_grams ?? '')) || 0
    const lines: BomLine[] = bomRows.map((r: any) => {
      const comp = prodMap[r.component_sku] ?? {}
      const uc = comp.unit_cost ?? 0
      const cpg = uc / 453.592
      const ext = (r.percentage / 100) * wG * cpg
      return {
        id: r.id,
        component_sku: r.component_sku,
        product_name: comp.product_name ?? '—',
        category: comp.category ?? null,
        unit_cost: uc,
        percentage: r.percentage,
        cost_per_gram: cpg,
        extended_cost: ext,
      }
    })
    setComponents(lines)
    setLoading(false)
  }, [sb, product.sku, product.weight_per_unit_grams])

  useEffect(() => { loadBom() }, [loadBom])

  // Recalculate extended costs when weight changes
  const wG = parseFloat(weightGrams) || 0
  const computedComponents = useMemo(() =>
    components.map(c => ({
      ...c,
      cost_per_gram: c.unit_cost / 453.592,
      extended_cost: (c.percentage / 100) * wG * (c.unit_cost / 453.592),
    })),
    [components, wG]
  )

  const totalPct = computedComponents.reduce((s, c) => s + c.percentage, 0)
  const materialCost = computedComponents.reduce((s, c) => s + c.extended_cost, 0)
  const prodCostNum = parseFloat(productionCost) || 0
  const totalProductionCost = materialCost + prodCostNum
  const caseCost = totalProductionCost * (product.case_qty ?? 1)

  const suggested: Record<string, number> = {}
  for (const t of TIERS) suggested[t.key] = totalProductionCost * t.mult

  // ── SKU Typeahead ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (skuQuery.length < 1) { setSearchResults([]); return }
    const timer = setTimeout(async () => {
      const { data } = await sb
        .from('products')
        .select('sku, product_name, category, unit_cost')
        .or(`sku.ilike.%${skuQuery}%,product_name.ilike.%${skuQuery}%`)
        .neq('sku', product.sku)
        .neq('category', 'Finished Goods')
        .order('sku')
        .limit(10)
      setSearchResults((data ?? []) as SearchResult[])
      setShowSearch(true)
    }, 200)
    return () => clearTimeout(timer)
  }, [skuQuery, sb, product.sku])

  // Close dropdown on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSearch(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  // ── Helpers ────────────────────────────────────────────────────────────────
  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(''), 3500) }

  async function saveWeight() {
    setSavingWeight(true)
    const { error } = await sb.from('products').update({ weight_per_unit_grams: wG || null }).eq('sku', product.sku)
    setSavingWeight(false)
    if (error) { flash('Error: ' + error.message) } else { flash('Weight saved!'); loadBom() }
  }

  async function saveProdCost() {
    setSavingProdCost(true)
    const { error } = await sb.from('products').update({ production_cost: prodCostNum || 0 }).eq('sku', product.sku)
    setSavingProdCost(false)
    flash(error ? 'Error: ' + error.message : 'Production cost saved!')
  }

  async function saveTier(key: string, value: number) {
    setSavingTier(key)
    const { error } = await sb.from('products').update({ [key]: value || null }).eq('sku', product.sku)
    setSavingTier(null)
    flash(error ? 'Error: ' + error.message : 'Saved!')
  }

  async function saveAll() {
    setSavingAll(true)
    const patch: Record<string, any> = {
      weight_per_unit_grams: wG || null,
      bom_cost: totalProductionCost || null,
      production_cost: prodCostNum || 0,
      case_cost: caseCost || null,
    }
    for (const t of TIERS) patch[t.key] = suggested[t.key] || null
    const { error } = await sb.from('products').update(patch).eq('sku', product.sku)
    setSavingAll(false)
    flash(error ? 'Error: ' + error.message : 'All pricing saved!')
    if (!error && onUpdate) onUpdate()
  }

  async function saveCaseCost() {
    setSavingCase(true)
    const { error } = await sb.from('products').update({ case_cost: caseCost || null }).eq('sku', product.sku)
    setSavingCase(false)
    flash(error ? 'Error: ' + error.message : 'Case cost saved!')
  }

  async function addComponent() {
    setAddErr('')
    if (!selectedSku) { setAddErr('Select a component SKU.'); return }
    const pct = parseFloat(newPct)
    if (!pct || pct <= 0) { setAddErr('Enter a valid percentage > 0.'); return }
    if (totalPct + pct > 100.001) { setAddErr(`Total would exceed 100% (currently ${totalPct.toFixed(2)}%).`); return }

    // Try finished_good_sku first, fall back to sku
    const insertPayload: Record<string, any> = {
      component_sku: selectedSku,
      percentage: pct,
    }

    // Check if finished_good_sku column exists by trying it
    const { error: e1 } = await sb.from('product_bom').insert({
      ...insertPayload,
      finished_good_sku: product.sku,
    })

    if (e1 && e1.message.includes('finished_good_sku')) {
      // Column doesn't exist yet, use sku
      const { error: e2 } = await sb.from('product_bom').insert({
        ...insertPayload,
        sku: product.sku,
      })
      if (e2) { setAddErr(e2.message); return }
    } else if (e1) {
      setAddErr(e1.message); return
    }

    setSelectedSku('')
    setSelectedSkuName('')
    setSkuQuery('')
    setNewPct('')
    setAddErr('')
    loadBom()
  }

  async function deleteComponent(id: string) {
    await sb.from('product_bom').delete().eq('id', id)
    loadBom()
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/60 z-40"/>
      <div onClick={e => e.stopPropagation()}
        className="fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-full w-full md:w-[700px] bg-gray-900 border-l border-gray-800 z-50 flex flex-col shadow-2xl">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-800 shrink-0">
          <div>
            <p className="text-xs text-violet-400 font-semibold uppercase tracking-wider">BOM Editor</p>
            <h2 className="text-white font-semibold mt-0.5">
              {product.sku}: {product.product_name}
            </h2>
            {product.category && (
              <p className="text-xs text-gray-500 mt-0.5">{product.category}</p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-gray-800">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-5 space-y-6">

            {/* ── Section 1: Unit Weight ── */}
            <div className="bg-gray-800/40 rounded-xl border border-gray-700 p-4">
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Finished unit weight (grams)
              </label>
              <div className="flex gap-2 items-center">
                <input type="number" min="0" step="0.001" value={weightGrams}
                  onChange={e => setWeightGrams(e.target.value)}
                  className={inp + ' w-40'} placeholder="0"/>
                <button onClick={saveWeight} disabled={savingWeight}
                  className="text-xs px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors disabled:opacity-50">
                  {savingWeight ? 'Saving…' : 'Save Weight'}
                </button>
              </div>
              <p className="text-xs text-gray-600 mt-1.5">Used for cost-per-gram calculations across all components</p>
            </div>

            {/* ── Section 2: Components Table ── */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Raw Material Components</p>
                <p className="text-xs text-gray-600">Raw Materials, Packaging, Additives, WIP, Print Plates</p>
              </div>

              {loading ? (
                <div className="flex items-center gap-2 py-6 text-gray-600 text-sm">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                  Loading…
                </div>
              ) : computedComponents.length === 0 ? (
                <div className="border border-dashed border-gray-700 rounded-lg py-8 text-center">
                  <p className="text-gray-600 text-sm">No components added yet.</p>
                  <p className="text-gray-700 text-xs mt-1">Use the form below to add raw material components.</p>
                </div>
              ) : (
                <div className="rounded-lg border border-gray-800 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-800/60 border-b border-gray-800">
                        {['P/N','Product Name','Category','% of Wt','Cost/lb','Cost/g','Ext. Cost',''].map(h => (
                          <th key={h} className="text-left text-gray-500 px-3 py-2.5 font-medium whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {computedComponents.map(c => (
                        <tr key={c.id} className="border-b border-gray-800/60 last:border-0 hover:bg-gray-800/20">
                          <td className="px-3 py-2.5 text-emerald-400 font-mono font-bold whitespace-nowrap">{c.component_sku}</td>
                          <td className="px-3 py-2.5 text-gray-200 max-w-[140px] truncate">{c.product_name}</td>
                          <td className="px-3 py-2.5">
                            {c.category && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-400 border border-gray-700 whitespace-nowrap">{c.category}</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-gray-300 font-medium">{c.percentage.toFixed(2)}%</td>
                          <td className="px-3 py-2.5 text-gray-400">{fmt$(c.unit_cost, 2)}</td>
                          <td className="px-3 py-2.5 text-gray-500 font-mono">${c.cost_per_gram.toFixed(6)}</td>
                          <td className="px-3 py-2.5 text-white font-semibold">${c.extended_cost.toFixed(4)}</td>
                          <td className="px-3 py-2.5">
                            <button onClick={() => deleteComponent(c.id)}
                              className="text-red-400 hover:text-red-300 p-1 rounded hover:bg-red-500/10 transition-colors">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {/* Totals row */}
                    <tfoot>
                      <tr className="bg-gray-800/50 border-t border-gray-700">
                        <td colSpan={3} className="px-3 py-2.5 text-gray-400 font-semibold text-right text-xs">Totals</td>
                        <td className={`px-3 py-2.5 font-bold text-sm ${totalPct > 100.001 ? 'text-red-400' : totalPct >= 99.9 ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {totalPct.toFixed(2)}%
                          {totalPct < 99.9 && totalPct > 0 && <span className="text-xs font-normal ml-1 opacity-60">(≠100%)</span>}
                          {totalPct > 100.001 && <span className="text-xs font-normal ml-1 opacity-60">(overflow!)</span>}
                        </td>
                        <td colSpan={2}/>
                        <td className="px-3 py-2.5 text-white font-bold text-sm">${materialCost.toFixed(4)}</td>
                        <td/>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>

            {/* ── Section 3: Add Component ── */}
            <div className="border border-gray-800 rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">+ Add Component</p>

              <div className="flex gap-2 items-start">
                {/* SKU typeahead */}
                <div className="flex-1 relative" ref={searchRef}>
                  <input
                    value={selectedSku ? `${selectedSku} — ${selectedSkuName}` : skuQuery}
                    onChange={e => {
                      setSkuQuery(e.target.value)
                      setSelectedSku('')
                      setSelectedSkuName('')
                    }}
                    onFocus={() => skuQuery && setShowSearch(true)}
                    placeholder="Search SKU or product name…"
                    className={inp + ' w-full'}/>
                  {showSearch && searchResults.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-10 overflow-hidden max-h-48 overflow-y-auto">
                      {searchResults.map(r => (
                        <button key={r.sku}
                          onMouseDown={() => {
                            setSelectedSku(r.sku)
                            setSelectedSkuName(r.product_name)
                            setSkuQuery('')
                            setShowSearch(false)
                          }}
                          className="w-full text-left px-3 py-2.5 text-xs border-b border-gray-700 last:border-0 hover:bg-gray-700 transition-colors">
                          <div className="flex items-center gap-2">
                            <span className="text-emerald-400 font-mono font-bold">{r.sku}</span>
                            {r.category && (
                              <span className="text-xs px-1 py-0.5 rounded bg-gray-700 text-gray-400">{r.category}</span>
                            )}
                          </div>
                          <p className="text-gray-300 mt-0.5 truncate">{r.product_name}</p>
                          {r.unit_cost != null && (
                            <p className="text-gray-500 mt-0.5">{fmt$(r.unit_cost, 2)}/lb</p>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedSku && (
                    <button onClick={() => { setSelectedSku(''); setSelectedSkuName(''); setSkuQuery('') }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                  )}
                </div>

                <input type="number" min="0" max="100" step="0.01" value={newPct}
                  onChange={e => setNewPct(e.target.value)}
                  placeholder="%" className={inp + ' w-24'}/>

                <button onClick={addComponent}
                  disabled={!selectedSku || !newPct}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap">
                  + Add
                </button>
              </div>

              {addErr && <p className="text-red-400 text-xs">{addErr}</p>}
              <p className="text-xs text-gray-600">Remaining: {Math.max(0, 100 - totalPct).toFixed(2)}% available</p>
            </div>

            {/* ── Section 4: Cost Summary ── */}
            {wG > 0 && (
              <div className="border border-gray-800 rounded-xl overflow-hidden">
                <div className="bg-gray-800/60 px-4 py-3 border-b border-gray-800">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Cost Summary</p>
                </div>
                <div className="divide-y divide-gray-800/60">
                  <div className="px-4 py-3 flex items-center justify-between">
                    <span className="text-sm text-gray-400">Raw Material Cost</span>
                    <span className="text-white font-semibold">{fmt$(materialCost)}</span>
                  </div>
                  <div className="px-4 py-3 flex items-center justify-between gap-4">
                    <span className="text-sm text-gray-400 shrink-0">Production Cost</span>
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                        <input type="number" min="0" step="0.0001" value={productionCost}
                          onChange={e => setProductionCost(e.target.value)}
                          placeholder="0.00" className="bg-gray-800 border border-gray-700 text-white rounded-lg pl-6 pr-3 py-1.5 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-violet-500 transition"/>
                      </div>
                      <button onClick={saveProdCost} disabled={savingProdCost}
                        className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap">
                        {savingProdCost ? '…' : 'Save'}
                      </button>
                    </div>
                  </div>
                  <div className="px-4 py-3 flex items-center justify-between bg-gray-800/30">
                    <span className="text-sm font-semibold text-white">Total Production Cost</span>
                    <span className="text-emerald-400 font-bold text-lg">{fmt$(totalProductionCost)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* ── Section 5: Pricing Calculator ── */}
            {totalProductionCost > 0 && (
              <div className="border border-gray-800 rounded-xl overflow-hidden">
                <div className="bg-gray-800/60 px-4 py-3 border-b border-gray-800">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Pricing Calculator — based on total cost <span className="text-white">{fmt$(totalProductionCost)}</span>
                  </p>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800">
                      {['Tier','Mult','Suggested Price','Current Price',''].map(h => (
                        <th key={h} className="text-left text-gray-500 px-4 py-2.5 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-gray-800/40 bg-gray-800/20">
                      <td className="px-4 py-2.5 text-gray-400 font-medium">Production Cost</td>
                      <td className="px-4 py-2.5 text-gray-600">—</td>
                      <td className="px-4 py-2.5 text-white font-bold">{fmt$(totalProductionCost)}</td>
                      <td colSpan={2}/>
                    </tr>
                    {TIERS.map(({ key, label, mult }) => (
                      <tr key={key} className="border-b border-gray-800/40 last:border-0 hover:bg-gray-800/20">
                        <td className="px-4 py-2.5 text-gray-300 font-medium">{label}</td>
                        <td className="px-4 py-2.5 text-gray-500">{mult}×</td>
                        <td className="px-4 py-2.5 text-emerald-400 font-bold">{fmt$(suggested[key])}</td>
                        <td className="px-4 py-2.5 text-gray-500">
                          {product[key] != null
                            ? <span className="text-gray-400">{fmt$(product[key], 2)}</span>
                            : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <button onClick={() => saveTier(key, suggested[key])}
                            disabled={savingTier === key}
                            className="text-xs px-2.5 py-1 rounded bg-violet-700/50 hover:bg-violet-700 text-violet-300 transition-colors disabled:opacity-50">
                            {savingTier === key ? '…' : 'Save'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Section 6: Case Cost ── */}
            {totalProductionCost > 0 && product.case_qty && (
              <div className="bg-gray-800/40 rounded-xl border border-gray-700 p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
                    Case Cost ({product.case_qty} units)
                  </p>
                  <p className="text-white font-bold text-xl mt-0.5">{fmt$(caseCost, 2)}</p>
                  <p className="text-xs text-gray-600 mt-0.5">
                    {fmt$(totalProductionCost)} × {product.case_qty} units
                  </p>
                </div>
                <button onClick={saveCaseCost} disabled={savingCase}
                  className="text-xs px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap">
                  {savingCase ? 'Saving…' : 'Save Case Cost'}
                </button>
              </div>
            )}

          </div>
        </div>

        {/* ── Footer ── */}
        <div className="shrink-0 px-6 py-4 border-t border-gray-800 flex items-center gap-3">
          {msg && (
            <span className={`text-xs flex-1 ${msg.startsWith('Error') ? 'text-red-400' : 'text-emerald-400'}`}>
              {msg}
            </span>
          )}
          <div className="flex gap-3 ml-auto">
            <button onClick={onClose}
              className="text-sm px-4 py-2.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors">
              Close
            </button>
            {totalProductionCost > 0 && (
              <button onClick={saveAll} disabled={savingAll}
                className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
                {savingAll ? 'Saving…' : 'Save All Pricing'}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
