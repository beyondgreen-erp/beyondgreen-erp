'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Product {
  id: string
  sku: string
  product_name: string
  unit_cost: number | null
  weight_per_unit_grams: number | null
  bom_cost: number | null
  case_qty: number | null
  distribution_price: number | null
  wholesale_price: number | null
  msrp: number | null
  imap: number | null
  map_price: number | null
}

interface BomRow {
  id: string
  sku: string
  component_sku: string
  percentage: number
  component?: { product_name: string; unit_cost: number | null }
}

interface Props {
  product: Product
  onClose: () => void
}

const fmt$ = (n: number, digits = 4) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n)

const inp = 'bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition'

const TIERS = [
  { key: 'distribution_price', label: 'Distribution', mult: 2.5 },
  { key: 'wholesale_price',    label: 'Wholesale',    mult: 4   },
  { key: 'msrp',               label: 'MSRP',         mult: 8   },
  { key: 'imap',               label: 'IMAP',         mult: 6   },
  { key: 'map_price',          label: 'MAP',          mult: 5   },
] as const

export default function BomEditor({ product, onClose }: Props) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [bom, setBom] = useState<BomRow[]>([])
  const [allProducts, setAllProducts] = useState<{ sku: string; product_name: string; unit_cost: number | null }[]>([])
  const [weightGrams, setWeightGrams] = useState(String(product.weight_per_unit_grams ?? ''))
  const [loading, setLoading] = useState(true)
  const [savingAll, setSavingAll] = useState(false)
  const [savingTier, setSavingTier] = useState<string | null>(null)
  const [savingWeight, setSavingWeight] = useState(false)
  const [savingCase, setSavingCase] = useState(false)
  const [skuSearch, setSkuSearch] = useState('')
  const [addSku, setAddSku] = useState('')
  const [addPct, setAddPct] = useState('')
  const [addErr, setAddErr] = useState('')
  const [msg, setMsg] = useState('')

  const loadBom = useCallback(async () => {
    setLoading(true)
    const [{ data: bomRows }, { data: prods }] = await Promise.all([
      sb.from('product_bom').select('*').eq('sku', product.sku),
      sb.from('products').select('sku,product_name,unit_cost').order('sku'),
    ])
    const map: Record<string, any> = {}
    for (const p of (prods ?? []) as any[]) map[p.sku] = p
    setBom(((bomRows ?? []) as any[]).map(r => ({ ...r, component: map[r.component_sku] })))
    setAllProducts((prods ?? []) as any[])
    setLoading(false)
  }, [sb, product.sku])

  useEffect(() => { loadBom() }, [loadBom])

  const wG = parseFloat(weightGrams) || 0
  const totalPct = bom.reduce((s, r) => s + (r.percentage ?? 0), 0)
  const bomCost = bom.reduce((sum, r) => {
    const cpg = (r.component?.unit_cost ?? 0) / 453.592
    return sum + (r.percentage / 100) * wG * cpg
  }, 0)
  const caseCost = bomCost * (product.case_qty ?? 1)

  const suggested: Record<string, number> = {}
  for (const t of TIERS) suggested[t.key] = bomCost * t.mult

  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(''), 3000) }

  async function saveWeight() {
    setSavingWeight(true)
    const { error } = await sb.from('products').update({ weight_per_unit_grams: wG || null }).eq('sku', product.sku)
    setSavingWeight(false)
    flash(error ? 'Error: ' + error.message : 'Weight saved!')
  }

  async function saveTier(key: string, value: number) {
    setSavingTier(key)
    const { error } = await sb.from('products').update({ [key]: value || null }).eq('sku', product.sku)
    setSavingTier(null)
    flash(error ? 'Error: ' + error.message : `${key} saved!`)
  }

  async function saveAll() {
    setSavingAll(true)
    const patch: Record<string, any> = {
      weight_per_unit_grams: wG || null,
      bom_cost: bomCost || null,
      case_cost: caseCost || null,
    }
    for (const t of TIERS) patch[t.key] = suggested[t.key] || null
    const { error } = await sb.from('products').update(patch).eq('sku', product.sku)
    setSavingAll(false)
    flash(error ? 'Error: ' + error.message : 'All pricing saved!')
  }

  async function saveCaseCost() {
    setSavingCase(true)
    const { error } = await sb.from('products').update({ case_cost: caseCost || null }).eq('sku', product.sku)
    setSavingCase(false)
    flash(error ? 'Error: ' + error.message : 'Case cost saved!')
  }

  async function addComponent() {
    setAddErr('')
    if (!addSku) { setAddErr('Select a component SKU.'); return }
    const pct = parseFloat(addPct)
    if (!pct || pct <= 0) { setAddErr('Enter a valid percentage > 0.'); return }
    if (totalPct + pct > 100.001) { setAddErr(`Total would exceed 100% (currently ${totalPct.toFixed(2)}%).`); return }
    const { error } = await sb.from('product_bom').upsert(
      { sku: product.sku, component_sku: addSku, percentage: pct },
      { onConflict: 'sku,component_sku' }
    )
    if (error) { setAddErr(error.message); return }
    setAddSku(''); setAddPct(''); loadBom()
  }

  async function deleteRow(id: string) {
    await sb.from('product_bom').delete().eq('id', id)
    loadBom()
  }

  const filteredProducts = useMemo(() =>
    allProducts.filter(p =>
      p.sku !== product.sku &&
      !bom.find(b => b.component_sku === p.sku) &&
      (!skuSearch || p.sku.toLowerCase().includes(skuSearch.toLowerCase()) ||
        p.product_name.toLowerCase().includes(skuSearch.toLowerCase()))
    ).slice(0, 50),
    [allProducts, bom, product.sku, skuSearch])

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/60 z-40"/>
      <div onClick={e => e.stopPropagation()}
        className="fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-full w-full md:w-[640px] bg-gray-900 border-l border-gray-800 z-50 flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-800 shrink-0">
          <div>
            <p className="text-xs text-violet-400 font-semibold uppercase tracking-wider">BOM Editor</p>
            <h2 className="text-white font-semibold mt-0.5">{product.sku}: {product.product_name}</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-gray-800">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* Weight */}
          <div className="bg-gray-800/40 rounded-xl border border-gray-700 p-4">
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Finished unit weight (grams)
            </label>
            <div className="flex gap-2 items-center">
              <input type="number" min="0" step="0.001" value={weightGrams} onChange={e => setWeightGrams(e.target.value)}
                className={inp + ' w-40'} placeholder="0"/>
              <button onClick={saveWeight} disabled={savingWeight}
                className="text-xs px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors disabled:opacity-50">
                {savingWeight ? 'Saving…' : 'Save Weight'}
              </button>
            </div>
          </div>

          {/* Components table */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Components</p>
            {loading ? (
              <p className="text-gray-600 text-sm py-4">Loading…</p>
            ) : bom.length === 0 ? (
              <p className="text-gray-600 text-sm py-4">No components added yet.</p>
            ) : (
              <div className="rounded-lg border border-gray-800 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-800/60 border-b border-gray-800">
                      {['P/N','Name','%','Cost/lb','Cost/g','Ext. Cost',''].map(h => (
                        <th key={h} className="text-left text-gray-500 px-3 py-2 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bom.map(r => {
                      const uc  = r.component?.unit_cost ?? 0
                      const cpg = uc / 453.592
                      const ext = (r.percentage / 100) * wG * cpg
                      return (
                        <tr key={r.id} className="border-b border-gray-800/60 last:border-0">
                          <td className="px-3 py-2.5 text-emerald-400 font-mono font-bold">{r.component_sku}</td>
                          <td className="px-3 py-2.5 text-gray-300 max-w-[140px] truncate">{r.component?.product_name ?? '—'}</td>
                          <td className="px-3 py-2.5 text-gray-300 font-medium">{r.percentage.toFixed(2)}%</td>
                          <td className="px-3 py-2.5 text-gray-400">{fmt$(uc, 2)}</td>
                          <td className="px-3 py-2.5 text-gray-400">${cpg.toFixed(6)}</td>
                          <td className="px-3 py-2.5 text-gray-200 font-medium">${ext.toFixed(4)}</td>
                          <td className="px-3 py-2.5">
                            <button onClick={() => deleteRow(r.id)}
                              className="text-red-400 hover:text-red-300 p-1 rounded hover:bg-red-500/10 transition-colors">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                    <tr className="bg-gray-800/50 border-t border-gray-700">
                      <td colSpan={2} className="px-3 py-2.5 text-gray-400 font-semibold text-right">Totals</td>
                      <td className={`px-3 py-2.5 font-bold text-sm ${totalPct > 100 ? 'text-red-400' : totalPct >= 99.9 ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {totalPct.toFixed(2)}%
                        {totalPct < 99.9 && totalPct > 0 && (
                          <span className="text-amber-500/60 text-xs ml-1">(≠100%)</span>
                        )}
                      </td>
                      <td colSpan={2}/>
                      <td className="px-3 py-2.5 text-white font-bold text-sm">${bomCost.toFixed(4)}</td>
                      <td/>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Add component */}
          <div className="border border-gray-800 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">+ Add Component</p>
            <input value={skuSearch} onChange={e => setSkuSearch(e.target.value)}
              placeholder="Search SKU or name…" className={inp + ' w-full'}/>
            <div className="flex gap-2">
              <select value={addSku} onChange={e => setAddSku(e.target.value)} className={inp + ' flex-1'}>
                <option value="">Select component…</option>
                {filteredProducts.map(p => (
                  <option key={p.sku} value={p.sku}>
                    {p.sku} — {p.product_name} ({p.unit_cost != null ? fmt$(p.unit_cost, 2) + '/lb' : 'no cost'})
                  </option>
                ))}
              </select>
              <input type="number" min="0" max="100" step="0.01" value={addPct}
                onChange={e => setAddPct(e.target.value)} placeholder="%" className={inp + ' w-24'}/>
              <button onClick={addComponent}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-sm font-medium transition-colors">
                Add
              </button>
            </div>
            {addErr && <p className="text-red-400 text-xs">{addErr}</p>}
          </div>

          {/* Pricing calculator */}
          {bomCost > 0 && (
            <div className="border border-gray-800 rounded-xl overflow-hidden">
              <div className="bg-gray-800/60 px-4 py-3 border-b border-gray-800">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Pricing Calculator — BOM Cost: <span className="text-white">{fmt$(bomCost)}</span>
                </p>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800">
                    {['Tier','Multiplier','Suggested Price','Current Price',''].map(h => (
                      <th key={h} className="text-left text-gray-500 px-4 py-2.5 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-gray-800/50">
                    <td className="px-4 py-2.5 text-gray-400 font-medium">BOM Cost</td>
                    <td className="px-4 py-2.5 text-gray-600">—</td>
                    <td className="px-4 py-2.5 text-white font-bold">{fmt$(bomCost)}</td>
                    <td colSpan={2}/>
                  </tr>
                  {TIERS.map(({ key, label, mult }) => (
                    <tr key={key} className="border-b border-gray-800/50 last:border-0">
                      <td className="px-4 py-2.5 text-gray-300 font-medium">{label}</td>
                      <td className="px-4 py-2.5 text-gray-500">{mult}×</td>
                      <td className="px-4 py-2.5 text-emerald-400 font-semibold">{fmt$(suggested[key])}</td>
                      <td className="px-4 py-2.5 text-gray-500">
                        {(product as any)[key] != null ? fmt$((product as any)[key], 2) : <span className="text-gray-700">—</span>}
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

          {/* Case cost */}
          {bomCost > 0 && product.case_qty && (
            <div className="bg-gray-800/40 rounded-xl border border-gray-700 p-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Case Cost ({product.case_qty} units)</p>
                <p className="text-white font-bold text-lg mt-0.5">{fmt$(caseCost, 2)}</p>
                <p className="text-xs text-gray-600 mt-0.5">BOM cost × {product.case_qty}</p>
              </div>
              <button onClick={saveCaseCost} disabled={savingCase}
                className="text-xs px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap">
                {savingCase ? 'Saving…' : 'Save Case Cost'}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
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
            {bomCost > 0 && (
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
