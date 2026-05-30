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

const fmt$ = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4 }).format(n)

const fmt4 = (n: number) => n.toFixed(4)

export default function BomEditor({ product, onClose }: Props) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [bom, setBom] = useState<BomRow[]>([])
  const [allProducts, setAllProducts] = useState<{ sku: string; product_name: string; unit_cost: number | null }[]>([])
  const [weight, setWeight] = useState(String(product.weight_per_unit_grams ?? ''))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [addSku, setAddSku] = useState('')
  const [addPct, setAddPct] = useState('')
  const [addErr, setAddErr] = useState('')
  const [saveMsg, setSaveMsg] = useState('')

  const loadBom = useCallback(async () => {
    setLoading(true)
    const [{ data: bomRows }, { data: prods }] = await Promise.all([
      sb.from('product_bom').select('*').eq('sku', product.sku),
      sb.from('products').select('sku,product_name,unit_cost').order('sku'),
    ])
    const prodMap: Record<string, { product_name: string; unit_cost: number | null }> = {}
    for (const p of (prods ?? []) as any[]) prodMap[p.sku] = p
    const rows: BomRow[] = (bomRows ?? []).map((r: any) => ({
      ...r,
      component: prodMap[r.component_sku],
    }))
    setBom(rows)
    setAllProducts((prods ?? []) as any[])
    setLoading(false)
  }, [sb, product.sku])

  useEffect(() => { loadBom() }, [loadBom])

  const totalPct = bom.reduce((s, r) => s + (r.percentage ?? 0), 0)
  const weightG = parseFloat(weight) || 0

  const bomCost = bom.reduce((sum, r) => {
    const uc = r.component?.unit_cost ?? 0
    const costPerGram = uc / 453.592
    return sum + (r.percentage / 100) * weightG * costPerGram
  }, 0)

  const suggestedPrices = {
    distribution: bomCost * 2.5,
    wholesale: bomCost * 4,
    msrp: bomCost * 8,
    imap: bomCost * 6,
    map: bomCost * 5,
  }

  async function addComponent() {
    setAddErr('')
    if (!addSku) { setAddErr('Select a component SKU.'); return }
    const pct = parseFloat(addPct)
    if (!pct || pct <= 0) { setAddErr('Enter a valid percentage > 0.'); return }
    if (totalPct + pct > 100) { setAddErr(`Total would exceed 100% (currently ${fmt4(totalPct)}%).`); return }
    const { error } = await sb.from('product_bom').upsert(
      { sku: product.sku, component_sku: addSku, percentage: pct },
      { onConflict: 'sku,component_sku' }
    )
    if (error) { setAddErr(error.message); return }
    setAddSku('')
    setAddPct('')
    loadBom()
  }

  async function deleteRow(id: string) {
    await sb.from('product_bom').delete().eq('id', id)
    loadBom()
  }

  async function saveCostPricing() {
    setSaving(true)
    setSaveMsg('')
    const { error } = await sb.from('products').update({
      weight_per_unit_grams: weightG || null,
      bom_cost: bomCost || null,
      distribution_price: suggestedPrices.distribution || null,
      wholesale_price: suggestedPrices.wholesale || null,
      msrp: suggestedPrices.msrp || null,
      imap: suggestedPrices.imap || null,
      map_price: suggestedPrices.map || null,
    }).eq('sku', product.sku)
    setSaving(false)
    if (error) { setSaveMsg('Error: ' + error.message) }
    else { setSaveMsg('Saved!') }
  }

  const inp = 'bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition'

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
          {/* Weight input */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Weight per unit (grams)</label>
            <input type="number" min="0" step="0.001" value={weight} onChange={e => setWeight(e.target.value)}
              className={inp + ' w-40'} placeholder="0"/>
            <p className="text-xs text-gray-600 mt-1">Used for cost-per-gram calculations</p>
          </div>

          {/* Components table */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Components</p>
            {loading ? (
              <p className="text-gray-600 text-sm">Loading…</p>
            ) : bom.length === 0 ? (
              <p className="text-gray-600 text-sm">No components added yet.</p>
            ) : (
              <div className="rounded-lg border border-gray-800 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-800/60 border-b border-gray-800">
                      {['Component SKU','Name','% of weight','Cost/g','Ext. Cost',''].map(h => (
                        <th key={h} className="text-left text-gray-500 px-3 py-2 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bom.map(r => {
                      const uc = r.component?.unit_cost ?? 0
                      const cpg = uc / 453.592
                      const ext = (r.percentage / 100) * weightG * cpg
                      return (
                        <tr key={r.id} className="border-b border-gray-800/60 last:border-0">
                          <td className="px-3 py-2.5 text-emerald-400 font-mono font-bold">{r.component_sku}</td>
                          <td className="px-3 py-2.5 text-gray-300">{r.component?.product_name ?? '—'}</td>
                          <td className="px-3 py-2.5 text-gray-300 font-medium">{fmt4(r.percentage)}%</td>
                          <td className="px-3 py-2.5 text-gray-400">${fmt4(cpg)}</td>
                          <td className="px-3 py-2.5 text-gray-400">${fmt4(ext)}</td>
                          <td className="px-3 py-2.5">
                            <button onClick={() => deleteRow(r.id)}
                              className="text-red-400 hover:text-red-300 p-1 rounded hover:bg-red-500/10 transition-colors">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                    <tr className="bg-gray-800/40">
                      <td colSpan={2} className="px-3 py-2 text-gray-500 font-medium text-right">Total</td>
                      <td className={`px-3 py-2 font-bold ${totalPct > 100 ? 'text-red-400' : totalPct === 100 ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {fmt4(totalPct)}%
                      </td>
                      <td className="px-3 py-2"/>
                      <td className="px-3 py-2 text-white font-bold">${fmt4(bomCost)}</td>
                      <td/>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Add component */}
          <div className="border border-gray-800 rounded-lg p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">+ Add Component</p>
            <div className="flex gap-2">
              <select value={addSku} onChange={e => setAddSku(e.target.value)} className={inp + ' flex-1'}>
                <option value="">Select SKU…</option>
                {allProducts
                  .filter(p => p.sku !== product.sku && !bom.find(b => b.component_sku === p.sku))
                  .map(p => (
                    <option key={p.sku} value={p.sku}>{p.sku} — {p.product_name}</option>
                  ))}
              </select>
              <input type="number" min="0" max="100" step="0.01" value={addPct} onChange={e => setAddPct(e.target.value)}
                placeholder="%" className={inp + ' w-24'}/>
              <button onClick={addComponent} className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-sm font-medium transition-colors">
                Add
              </button>
            </div>
            {addErr && <p className="text-red-400 text-xs">{addErr}</p>}
          </div>

          {/* Suggested pricing */}
          {bomCost > 0 && (
            <div className="border border-gray-800 rounded-lg p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Suggested Pricing (based on BOM cost {fmt$( bomCost)})</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {[
                  { label: 'Distribution (×2.5)', value: suggestedPrices.distribution },
                  { label: 'Wholesale (×4)', value: suggestedPrices.wholesale },
                  { label: 'MSRP (×8)', value: suggestedPrices.msrp },
                  { label: 'IMAP (×6)', value: suggestedPrices.imap },
                  { label: 'MAP (×5)', value: suggestedPrices.map },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between bg-gray-800/40 rounded px-3 py-2">
                    <span className="text-gray-400 text-xs">{label}</span>
                    <span className="text-white font-medium text-xs">{fmt$(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-6 py-4 border-t border-gray-800 flex items-center gap-3">
          {saveMsg && (
            <span className={`text-xs ${saveMsg.startsWith('Error') ? 'text-red-400' : 'text-emerald-400'}`}>{saveMsg}</span>
          )}
          <div className="flex gap-3 ml-auto">
            <button onClick={onClose} className="text-sm px-4 py-2.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors">
              Close
            </button>
            <button onClick={saveCostPricing} disabled={saving}
              className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
              {saving ? 'Saving…' : 'Save BOM Cost + Pricing'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
