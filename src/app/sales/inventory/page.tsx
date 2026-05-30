'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState, memo } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import BomEditor from './BomEditor'
import CaseLabel from './CaseLabel'

interface Product {
  id: string
  sku: string
  product_name: string
  product_category: string | null
  category: string | null
  product_location: string | null
  unit_of_measure: string | null
  on_hand_qty: number
  unit_cost: number | null
  bom_cost: number | null
  case_cost: number | null
  upc_gtin: string | null
  case_qty: number | null
  weight_per_unit_grams: number | null
  distribution_price: number | null
  wholesale_price: number | null
  msrp: number | null
  imap: number | null
  map_price: number | null
  requires_bom: boolean | null
  is_active: boolean
  is_discontinued: boolean | null
}

const PRODUCT_TABS = ['All','BAGS','CUTLERY','STRAW-CUPS','RAW MATERIAL','ADDITIVES','WIP','PACKAGING','PRINT PLATE','MOLDING','COMPOSTER']
const PRODUCT_TAB_OPTIONS = PRODUCT_TABS.slice(1)
const CATEGORY_OPTIONS = ['Finished Goods','Raw Material','Component','Packaging','Mold','WIP','Additives','Print Plates','Composter Components']
const UOM_OPTIONS = ['EA','PKS','LBS','ROLLS','CASE','M','FT','OZ','GAL','KG','SET','Other']

const fmt$ = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

const inp = 'w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition'

const emptyForm = {
  sku: '',
  product_name: '',
  product_category: '',
  category: '',
  unit_of_measure: 'EA',
  on_hand_qty: '0',
  unit_cost: '',
  product_location: '',
  upc_gtin: '',
  case_qty: '',
  weight_per_unit_grams: '',
  distribution_price: '',
  wholesale_price: '',
  msrp: '',
  imap: '',
  map_price: '',
  is_active: true,
  is_discontinued: false,
}
type F = typeof emptyForm

// EditPanel as a memo'd component so it doesn't re-render on every keystroke
const EditPanel = memo(function EditPanel({
  open, editing, form, setForm, err, saving, busy,
  onClose, onSave, onDelete, onToggleActive,
}: {
  open: boolean
  editing: Product | null
  form: F
  setForm: React.Dispatch<React.SetStateAction<F>>
  err: string
  saving: boolean
  busy: boolean
  onClose: () => void
  onSave: () => void
  onDelete: () => void
  onToggleActive: () => void
}) {
  return (
    <>
      <div onClick={onClose} className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}/>
      <div onClick={e => e.stopPropagation()}
        className={`fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-full w-full md:w-[560px] bg-gray-900 border-l border-gray-800 z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-800 shrink-0">
          <div>
            <h2 className="text-white font-semibold">{editing ? 'Edit Product' : 'Add Product'}</h2>
            {editing && <p className="text-xs text-gray-500 mt-0.5">SKU: {editing.sku}</p>}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-gray-800">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* SKU */}
          <div className="bg-gray-800/60 border border-emerald-500/20 rounded-xl p-4">
            <label className="block text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2">SKU <span className="text-red-400">*</span></label>
            <input value={form.sku}
              onChange={e => setForm(p => ({ ...p, sku: e.target.value.toUpperCase() }))}
              readOnly={!!editing}
              placeholder="e.g. BG-1001"
              className={`w-full bg-gray-900 border border-emerald-500/30 text-emerald-400 placeholder-gray-600 rounded-lg px-4 py-3 text-lg font-mono font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500 transition ${editing ? 'opacity-70 cursor-not-allowed' : ''}`}/>
          </div>

          {/* Product Name */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Product Name <span className="text-red-400">*</span></label>
            <input value={form.product_name} onChange={e => setForm(p => ({ ...p, product_name: e.target.value }))} className={inp}/>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Tab/product_category */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Tab / Product Category</label>
              <select value={form.product_category} onChange={e => setForm(p => ({ ...p, product_category: e.target.value }))} className={inp + ' cursor-pointer'}>
                <option value="">— None —</option>
                {PRODUCT_TAB_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {/* Type/category */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Type</label>
              <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} className={inp + ' cursor-pointer'}>
                <option value="">— None —</option>
                {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Unit of Measure</label>
              <select value={form.unit_of_measure} onChange={e => setForm(p => ({ ...p, unit_of_measure: e.target.value }))} className={inp + ' cursor-pointer'}>
                {UOM_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">On Hand Qty</label>
              <input type="number" min="0" value={form.on_hand_qty} onChange={e => setForm(p => ({ ...p, on_hand_qty: e.target.value }))} className={inp}/>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Unit Cost ($)</label>
              <input type="number" min="0" step="0.0001" value={form.unit_cost} onChange={e => setForm(p => ({ ...p, unit_cost: e.target.value }))} className={inp}/>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Physical Location</label>
              <input value={form.product_location} onChange={e => setForm(p => ({ ...p, product_location: e.target.value }))} placeholder="e.g. Shelf A3" className={inp}/>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">UPC / GTIN</label>
              <input value={form.upc_gtin} onChange={e => setForm(p => ({ ...p, upc_gtin: e.target.value }))} className={inp}/>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Case Qty</label>
              <input type="number" min="0" value={form.case_qty} onChange={e => setForm(p => ({ ...p, case_qty: e.target.value }))} className={inp}/>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Weight per unit (g)</label>
            <input type="number" min="0" step="0.001" value={form.weight_per_unit_grams} onChange={e => setForm(p => ({ ...p, weight_per_unit_grams: e.target.value }))} className={inp}/>
          </div>

          <div className="border-t border-gray-800 pt-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Pricing</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Distribution Price</label>
                <input type="number" min="0" step="0.0001" value={form.distribution_price} onChange={e => setForm(p => ({ ...p, distribution_price: e.target.value }))} className={inp}/>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Wholesale Price</label>
                <input type="number" min="0" step="0.0001" value={form.wholesale_price} onChange={e => setForm(p => ({ ...p, wholesale_price: e.target.value }))} className={inp}/>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">MSRP</label>
                <input type="number" min="0" step="0.0001" value={form.msrp} onChange={e => setForm(p => ({ ...p, msrp: e.target.value }))} className={inp}/>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">IMAP</label>
                <input type="number" min="0" step="0.0001" value={form.imap} onChange={e => setForm(p => ({ ...p, imap: e.target.value }))} className={inp}/>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">MAP Price</label>
                <input type="number" min="0" step="0.0001" value={form.map_price} onChange={e => setForm(p => ({ ...p, map_price: e.target.value }))} className={inp}/>
              </div>
            </div>
          </div>

          {/* Toggles */}
          <div className="space-y-2 pt-2">
            <label className="flex items-center gap-3 cursor-pointer select-none p-3 bg-gray-800/40 rounded-lg border border-gray-700"
              onClick={() => setForm(p => ({ ...p, is_active: !p.is_active }))}>
              <div className={`w-9 h-5 rounded-full transition-colors relative ${form.is_active ? 'bg-emerald-600' : 'bg-gray-700'}`}>
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.is_active ? 'translate-x-4' : 'translate-x-0.5'}`}/>
              </div>
              <span className="text-sm text-gray-300">Active</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer select-none p-3 bg-gray-800/40 rounded-lg border border-gray-700"
              onClick={() => setForm(p => ({ ...p, is_discontinued: !p.is_discontinued }))}>
              <div className={`w-9 h-5 rounded-full transition-colors relative ${form.is_discontinued ? 'bg-red-600' : 'bg-gray-700'}`}>
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.is_discontinued ? 'translate-x-4' : 'translate-x-0.5'}`}/>
              </div>
              <span className="text-sm text-gray-300">Discontinued</span>
            </label>
          </div>
        </div>

        <div className="shrink-0 px-6 py-4 border-t border-gray-800 space-y-3">
          {err && (
            <div className="flex gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5">
              <p className="text-red-400 text-xs">{err}</p>
            </div>
          )}
          <div className="flex gap-3">
            {editing && (
              <button onClick={onDelete} className="text-sm px-3 py-2.5 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors" title="Delete">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            )}
            {editing && (
              <button onClick={onToggleActive} disabled={busy} className="text-sm px-3 py-2.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors disabled:opacity-50">
                {busy ? '…' : editing.is_active ? 'Deactivate' : 'Activate'}
              </button>
            )}
            <button onClick={onClose} className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors">Cancel</button>
            <button onClick={onSave} disabled={saving} className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
})

export default function InventoryPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<Product[]>([])
  const [bomMap, setBomMap] = useState<Record<string, number>>({}) // sku -> count of bom entries
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [tabFilter, setTabFilter] = useState('All')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [form, setForm] = useState<F>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [loadError, setLoadError] = useState('')
  const [selectedBomProduct, setSelectedBomProduct] = useState<Product | null>(null)
  const [selectedLabelProduct, setSelectedLabelProduct] = useState<Product | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    const [{ data: p, error: pErr }, { data: b }] = await Promise.all([
      sb.from('products').select('*').order('sku', { ascending: true }),
      sb.from('product_bom').select('sku'),
    ])
    if (pErr) {
      setLoadError(`Failed to load: ${pErr.message}`)
    } else if (p) {
      setRows(p as Product[])
    }
    if (b) {
      const counts: Record<string, number> = {}
      for (const r of b as any[]) {
        counts[r.sku] = (counts[r.sku] ?? 0) + 1
      }
      setBomMap(counts)
    }
    setLoading(false)
  }, [sb])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    let pool = rows
    if (tabFilter !== 'All') pool = pool.filter(r => (r.product_category ?? '') === tabFilter)
    if (!q) return pool
    const skuExact = pool.filter(r => r.sku.toLowerCase() === q)
    const skuStart = pool.filter(r => r.sku.toLowerCase().startsWith(q) && r.sku.toLowerCase() !== q)
    const skuContain = pool.filter(r => r.sku.toLowerCase().includes(q) && !r.sku.toLowerCase().startsWith(q))
    const nameMatch = pool.filter(r => (r.product_name ?? '').toLowerCase().includes(q) && !r.sku.toLowerCase().includes(q))
    return [...skuExact, ...skuStart, ...skuContain, ...nameMatch]
  }, [rows, search, tabFilter])

  function openAdd() {
    setEditing(null)
    setForm(emptyForm)
    setErr('')
    setOpen(true)
  }

  function openEdit(r: Product) {
    setEditing(r)
    setForm({
      sku: r.sku,
      product_name: r.product_name ?? '',
      product_category: r.product_category ?? '',
      category: r.category ?? '',
      unit_of_measure: r.unit_of_measure ?? 'EA',
      on_hand_qty: String(r.on_hand_qty ?? 0),
      unit_cost: r.unit_cost != null ? String(r.unit_cost) : '',
      product_location: r.product_location ?? '',
      upc_gtin: r.upc_gtin ?? '',
      case_qty: r.case_qty != null ? String(r.case_qty) : '',
      weight_per_unit_grams: r.weight_per_unit_grams != null ? String(r.weight_per_unit_grams) : '',
      distribution_price: r.distribution_price != null ? String(r.distribution_price) : '',
      wholesale_price: r.wholesale_price != null ? String(r.wholesale_price) : '',
      msrp: r.msrp != null ? String(r.msrp) : '',
      imap: r.imap != null ? String(r.imap) : '',
      map_price: r.map_price != null ? String(r.map_price) : '',
      is_active: r.is_active !== false,
      is_discontinued: r.is_discontinued === true,
    })
    setErr('')
    setOpen(true)
  }

  function closeEdit() {
    setOpen(false)
    setTimeout(() => { setEditing(null); setForm(emptyForm) }, 300)
  }

  async function save() {
    if (!form.sku.trim() || !form.product_name.trim()) { setErr('SKU and Product Name are required.'); return }
    setErr(''); setSaving(true)
    const payload: Record<string, any> = {
      sku: form.sku.trim().toUpperCase(),
      product_name: form.product_name.trim(),
      product_category: form.product_category || null,
      category: form.category || null,
      unit_of_measure: form.unit_of_measure || null,
      on_hand_qty: parseFloat(form.on_hand_qty) || 0,
      unit_cost: form.unit_cost ? parseFloat(form.unit_cost) : null,
      product_location: form.product_location.trim() || null,
      upc_gtin: form.upc_gtin.trim() || null,
      case_qty: form.case_qty ? parseInt(form.case_qty) : null,
      weight_per_unit_grams: form.weight_per_unit_grams ? parseFloat(form.weight_per_unit_grams) : null,
      distribution_price: form.distribution_price ? parseFloat(form.distribution_price) : null,
      wholesale_price: form.wholesale_price ? parseFloat(form.wholesale_price) : null,
      msrp: form.msrp ? parseFloat(form.msrp) : null,
      imap: form.imap ? parseFloat(form.imap) : null,
      map_price: form.map_price ? parseFloat(form.map_price) : null,
      is_active: form.is_active,
      is_discontinued: form.is_discontinued,
    }
    const { error } = editing
      ? await sb.from('products').update(payload).eq('sku', editing.sku)
      : await sb.from('products').insert(payload)
    if (error) { setErr(error.message); setSaving(false); return }
    setSaving(false); closeEdit(); load()
  }

  async function handleDelete() {
    if (!editing) return
    if (!confirm(`Permanently delete ${editing.sku}? This cannot be undone.`)) return
    const { error } = await sb.from('products').delete().eq('id', editing.id)
    if (error) { alert('Delete failed: ' + error.message); return }
    closeEdit(); load()
  }

  async function toggleActive() {
    if (!editing) return
    setBusy(true)
    await sb.from('products').update({ is_active: !editing.is_active }).eq('id', editing.id)
    setBusy(false); closeEdit(); load()
  }

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { All: rows.length }
    for (const r of rows) {
      const t = r.product_category ?? 'Unknown'
      counts[t] = (counts[t] ?? 0) + 1
    }
    return counts
  }, [rows])

  return (
    <div className="p-4 md:p-8 min-h-screen">
      {loadError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-4 flex items-center gap-3">
          <span className="text-red-400 text-sm flex-1">{loadError}</span>
          <button onClick={load} className="text-xs text-red-400 border border-red-500/30 rounded-lg px-3 py-1 hover:bg-red-500/10">Retry</button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-blue-500/20 text-blue-300 border-blue-500/30">INVENTORY</span>
          <h1 className="text-2xl font-semibold text-white mt-1">Products & Inventory</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${filtered.length} product${filtered.length !== 1 ? 's' : ''}`}</p>
        </div>
        <button onClick={openAdd} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
          Add Product
        </button>
      </div>

      {/* Tab filters */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1 overflow-x-auto mb-4">
        {PRODUCT_TABS.map(t => (
          <button key={t} onClick={() => setTabFilter(t)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${tabFilter === t ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>
            {t}{tabCounts[t] != null ? ` (${tabCounts[t]})` : ''}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-4 max-w-md">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        <input placeholder="Search SKU or product name…" value={search} onChange={e => setSearch(e.target.value)}
          className="w-full bg-gray-900 border border-gray-800 text-white placeholder-gray-600 rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"/>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <svg className="w-5 h-5 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-gray-500 py-20 text-sm">No products found.</p>
        ) : (
          <table className="w-full min-w-[1000px] text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                {['SKU','Product Name','Tab','Type','UOM','On Hand','Cost','BOM','UPC','Actions'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 px-3 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => {
                const bomCount = bomMap[p.sku] ?? 0
                const needsBom = p.requires_bom === true
                const isFinishedGood = p.category === 'Finished Goods'
                return (
                  <tr key={p.id}
                    className={`border-b border-gray-800/60 last:border-0 transition-colors ${p.is_discontinued ? 'opacity-50' : ''} ${i % 2 === 1 ? 'bg-gray-800/10' : ''} hover:bg-gray-800/40`}>
                    <td className="px-3 py-3.5">
                      <span className="text-emerald-400 font-mono font-bold text-xs">{p.sku}</span>
                    </td>
                    <td className="px-3 py-3.5 text-white font-medium max-w-[220px] truncate">{p.product_name}</td>
                    <td className="px-3 py-3.5">
                      {p.product_category && (
                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-blue-500/15 text-blue-400 border border-blue-500/20">{p.product_category}</span>
                      )}
                    </td>
                    <td className="px-3 py-3.5">
                      {p.category && (
                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-gray-700/50 text-gray-400 border border-gray-700">{p.category}</span>
                      )}
                    </td>
                    <td className="px-3 py-3.5 text-gray-400 text-xs">{p.unit_of_measure ?? '—'}</td>
                    <td className="px-3 py-3.5 font-semibold text-gray-200">{p.on_hand_qty ?? 0}</td>
                    <td className="px-3 py-3.5 text-gray-400 text-xs">{fmt$(p.unit_cost)}</td>
                    <td className="px-3 py-3.5">
                      {bomCount > 0 ? (
                        <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
                      ) : needsBom ? (
                        <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                      ) : (
                        <span className="text-gray-700 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3.5 text-gray-500 text-xs font-mono">{p.upc_gtin ?? '—'}</td>
                    <td className="px-3 py-3.5">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(p)}
                          className="text-xs px-2 py-1 rounded bg-gray-700/50 hover:bg-gray-700 text-gray-300 transition-colors">Edit</button>
                        <button onClick={() => setSelectedBomProduct(p)}
                          className="text-xs px-2 py-1 rounded bg-violet-700/50 hover:bg-violet-700 text-violet-300 transition-colors">BOM</button>
                        {isFinishedGood && (
                          <button onClick={() => setSelectedLabelProduct(p)}
                            className="text-xs px-2 py-1 rounded bg-amber-700/50 hover:bg-amber-700 text-amber-300 transition-colors">Label</button>
                        )}
                        <button onClick={async () => {
                          if (!confirm(`Delete ${p.sku}?`)) return
                          await sb.from('products').delete().eq('id', p.id)
                          load()
                        }} className="text-xs px-2 py-1 rounded bg-red-900/40 hover:bg-red-900/70 text-red-400 transition-colors">Del</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <EditPanel
        open={open}
        editing={editing}
        form={form}
        setForm={setForm}
        err={err}
        saving={saving}
        busy={busy}
        onClose={closeEdit}
        onSave={save}
        onDelete={handleDelete}
        onToggleActive={toggleActive}
      />

      {selectedBomProduct && (
        <BomEditor
          product={selectedBomProduct}
          onClose={() => { setSelectedBomProduct(null); load() }}
        />
      )}

      {selectedLabelProduct && (
        <CaseLabel
          product={selectedLabelProduct}
          onClose={() => setSelectedLabelProduct(null)}
        />
      )}
    </div>
  )
}
