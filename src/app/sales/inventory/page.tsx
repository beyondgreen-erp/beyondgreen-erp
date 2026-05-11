'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Product {
  id: string
  sku: string
  product_name: string
  name?: string
  category: string | null
  unit_of_measure: string | null
  on_hand_qty: number
  reorder_point: number
  unit_cost: number | null
  unit_price: number | null
  pack_price: number | null
  case_price: number | null
  case_qty: number | null
  location: string | null
  is_active: boolean
  is_discontinued: boolean | null
  external_id: string | null
  modification_log: string | null
  duplicate_flag: boolean | null
  duplicate_of: string | null
  duplicate_reason: string | null
  duplicate_reviewed: boolean | null
  notes: string | null
  vendor_id: string | null
}
interface Vendor { id: string; company_name: string }

const CATEGORIES = ['All','Finished Goods','Packaging','Raw Material','Print Plates','Composter Components','Molds','Additives','WIP','Discontinued','Other']
const STATUS_FILTERS = ['all','active','low_stock','out_of_stock','discontinued','duplicates'] as const
type StatusFilter = typeof STATUS_FILTERS[number]
const UOM_OPTIONS = ['EA','PKS','LBS','ROLLS','CASE','M','FT','OZ','GAL','KG','SET','Other']
const CATEGORY_OPTIONS = ['Finished Goods','Packaging','Raw Material','Print Plates','Composter Components','Molds','Additives','WIP','Other']

const CATEGORY_COLORS: Record<string, string> = {
  'Finished Goods':'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  'Packaging':'bg-blue-500/15 text-blue-400 border-blue-500/20',
  'Raw Material':'bg-amber-500/15 text-amber-400 border-amber-500/20',
  'Print Plates':'bg-violet-500/15 text-violet-400 border-violet-500/20',
  'Composter Components':'bg-teal-500/15 text-teal-400 border-teal-500/20',
  'Molds':'bg-orange-500/15 text-orange-400 border-orange-500/20',
  'Additives':'bg-pink-500/15 text-pink-400 border-pink-500/20',
  'WIP':'bg-cyan-500/15 text-cyan-400 border-cyan-500/20',
  'Discontinued':'bg-gray-700/40 text-gray-500 border-gray-700',
  'Other':'bg-gray-700/30 text-gray-400 border-gray-700',
}

const fmt$ = (n: number | null) => n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

function pname(p: Product) { return p.product_name ?? p.name ?? '' }

const emptyForm = {
  sku: '', product_name: '', category: '', unit_of_measure: 'EA',
  on_hand_qty: '0', reorder_point: '0', unit_cost: '', unit_price: '',
  pack_price: '', case_price: '', case_qty: '', location: '', notes: '',
  vendor_id: '', is_discontinued: false,
}
type F = typeof emptyForm

export default function InventoryPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<Product[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [form, setForm] = useState<F>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [showDupes, setShowDupes] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: p, error: pErr }, { data: v }] = await Promise.all([
      sb.from('products').select('*').order('name'),
      sb.from('vendors').select('id,company_name').eq('is_active', true).order('company_name'),
    ])
    if (pErr) setImportMsg(`Error loading products: ${pErr.message}`)
    if (p) setRows(p as Product[])
    if (v) setVendors(v as Vendor[])
    setLoading(false)
  }, [sb])

  useEffect(() => { load() }, [load])

  // Filtering + search with SKU priority
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    let pool = rows

    if (statusFilter === 'active') pool = pool.filter(r => r.is_active !== false && !r.is_discontinued)
    else if (statusFilter === 'low_stock') pool = pool.filter(r => r.is_active !== false && r.on_hand_qty > 0 && r.on_hand_qty <= r.reorder_point)
    else if (statusFilter === 'out_of_stock') pool = pool.filter(r => r.is_active !== false && r.on_hand_qty === 0)
    else if (statusFilter === 'discontinued') pool = pool.filter(r => r.is_discontinued === true)
    else if (statusFilter === 'duplicates') pool = pool.filter(r => r.duplicate_flag === true && r.duplicate_reviewed !== true)
    // 'all' — show everything

    if (catFilter !== 'All') pool = pool.filter(r => (r.category ?? '') === catFilter)

    if (!q) return pool

    const sku = (r: Product) => (r.sku ?? '').toLowerCase()
    const skuMatch = pool.filter(r => sku(r) === q)
    const skuStarts = pool.filter(r => sku(r).startsWith(q) && sku(r) !== q)
    const skuContains = pool.filter(r => sku(r).includes(q) && !sku(r).startsWith(q))
    const nameMatch = pool.filter(r => pname(r).toLowerCase().includes(q) && !sku(r).includes(q))

    return [...skuMatch, ...skuStarts, ...skuContains, ...nameMatch]
  }, [rows, search, catFilter, statusFilter])

  const dupeCount = rows.filter(r => r.duplicate_flag === true && r.duplicate_reviewed !== true).length
  const lowStock = rows.filter(r => r.is_active && r.on_hand_qty > 0 && r.on_hand_qty <= r.reorder_point && r.reorder_point > 0).length
  const outOfStock = rows.filter(r => r.is_active && r.on_hand_qty === 0).length

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
      product_name: pname(r),
      category: r.category ?? '',
      unit_of_measure: r.unit_of_measure ?? 'EA',
      on_hand_qty: String(r.on_hand_qty),
      reorder_point: String(r.reorder_point),
      unit_cost: r.unit_cost != null ? String(r.unit_cost) : '',
      unit_price: r.unit_price != null ? String(r.unit_price) : '',
      pack_price: r.pack_price != null ? String(r.pack_price) : '',
      case_price: r.case_price != null ? String(r.case_price) : '',
      case_qty: r.case_qty != null ? String(r.case_qty) : '',
      location: r.location ?? '',
      notes: r.notes ?? '',
      vendor_id: r.vendor_id ?? '',
      is_discontinued: r.is_discontinued === true,
    })
    setErr('')
    setOpen(true)
  }

  function close() {
    setOpen(false)
    setTimeout(() => { setEditing(null); setForm(emptyForm) }, 300)
  }

  async function save() {
    if (!form.sku.trim() || !form.product_name.trim()) { setErr('SKU and Product Name are required.'); return }
    setErr(''); setSaving(true)
    const caseQty = form.case_qty ? parseInt(form.case_qty) : null
    const unitCost = form.unit_cost ? parseFloat(form.unit_cost) : null
    const payload = {
      sku: form.sku.trim().toUpperCase(),
      product_name: form.product_name.trim(),
      name: form.product_name.trim(),
      category: form.category.trim() || null,
      unit_of_measure: form.unit_of_measure.trim() || null,
      on_hand_qty: parseFloat(form.on_hand_qty) || 0,
      reorder_point: parseFloat(form.reorder_point) || 0,
      unit_cost: unitCost,
      unit_price: form.unit_price ? parseFloat(form.unit_price) : null,
      pack_price: form.pack_price ? parseFloat(form.pack_price) : null,
      case_price: form.case_price ? parseFloat(form.case_price) : (unitCost && caseQty ? unitCost * caseQty : null),
      case_qty: caseQty,
      location: form.location.trim() || null,
      notes: form.notes.trim() || null,
      vendor_id: form.vendor_id || null,
      is_active: !form.is_discontinued,
      is_discontinued: form.is_discontinued,
    }
    const { error } = editing
      ? await sb.from('products').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editing.id)
      : await sb.from('products').insert({ ...payload })
    if (error) { setErr(error.message); setSaving(false); return }
    setSaving(false); close(); load()
  }

  async function toggleArchive() {
    if (!editing) return
    setBusy(true)
    await sb.from('products').update({ is_active: !editing.is_active, updated_at: new Date().toISOString() }).eq('id', editing.id)
    setBusy(false); close(); load()
  }

  async function markReviewed(id: string) {
    await sb.from('products').update({ duplicate_reviewed: true, updated_at: new Date().toISOString() }).eq('id', id)
    load()
  }

  async function markDupeInactive(id: string) {
    await sb.from('products').update({ is_active: false, duplicate_reviewed: true, updated_at: new Date().toISOString() }).eq('id', id)
    load()
  }

  async function handleFileImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setImportMsg('Uploading and parsing file…')
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch('/api/import/inventory', { method: 'POST', body: fd })
      const json = await res.json()
      if (json.error) {
        setImportMsg(`Error: ${json.error}`)
      } else {
        setImportMsg(`Imported ${json.imported} of ${json.total} products.${json.errors?.length ? ` Errors: ${json.errors.join('; ')}` : ''}`)
        load()
      }
    } catch (err) {
      setImportMsg(`Upload failed: ${err}`)
    }
    setImporting(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const inp = 'w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition'

  const statusFilterLabels: Record<StatusFilter, string> = {
    all: `All Active (${rows.filter(r => r.is_active !== false).length})`,
    active: 'Active',
    low_stock: `Low Stock (${lowStock})`,
    out_of_stock: `Out of Stock (${outOfStock})`,
    discontinued: `Discontinued (${rows.filter(r => r.is_discontinued).length})`,
    duplicates: `Flagged Dupes (${dupeCount})`,
  }

  return (
    <div className="p-4 md:p-8 min-h-screen">
      {/* Duplicate alert banner */}
      {dupeCount > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
          <span className="text-red-400 font-medium text-sm">{dupeCount} potential duplicate product{dupeCount !== 1 ? 's' : ''} found</span>
          <button onClick={() => setShowDupes(true)} className="ml-auto text-xs text-red-400 border border-red-500/30 rounded-lg px-3 py-1 hover:bg-red-500/10 transition-colors">Review Duplicates</button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-blue-500/20 text-blue-300 border-blue-500/30">INVENTORY</span>
          <h1 className="text-2xl font-semibold text-white mt-1">Products & Inventory</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${filtered.length} product${filtered.length !== 1 ? 's' : ''} · SKU is the primary identifier`}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileImport}/>
          <button onClick={() => fileRef.current?.click()} disabled={importing}
            className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 border border-gray-700 text-gray-300 hover:text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">
            {importing
              ? <><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Importing…</>
              : <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>Import XLSX</>
            }
          </button>
          <button onClick={openAdd} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>Add Item
          </button>
        </div>
      </div>

      {importMsg && (
        <div className={`rounded-xl border px-4 py-3 text-sm mb-4 ${importMsg.startsWith('Error') ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'}`}>
          {importMsg}
        </div>
      )}

      {/* Status filter tabs */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1 overflow-x-auto mb-3">
        {STATUS_FILTERS.map(f => (
          <button key={f} onClick={() => setStatusFilter(f)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${statusFilter === f
              ? f === 'duplicates' ? 'bg-red-600 text-white'
              : f === 'low_stock' ? 'bg-amber-600 text-white'
              : f === 'out_of_stock' ? 'bg-red-700 text-white'
              : f === 'discontinued' ? 'bg-gray-600 text-white'
              : 'bg-blue-600 text-white'
              : 'text-gray-400 hover:text-white'}`}>
            {statusFilterLabels[f]}
          </button>
        ))}
      </div>

      {/* Category filter pills */}
      <div className="flex gap-1.5 flex-wrap mb-4">
        {CATEGORIES.map(c => (
          <button key={c} onClick={() => setCatFilter(c)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium border transition-colors ${catFilter === c ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-700 text-gray-400 hover:border-gray-600 hover:text-white'}`}>
            {c}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-4 max-w-md">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        <input placeholder="Search by SKU (Part #) or product name…" value={search} onChange={e => setSearch(e.target.value)}
          className="w-full bg-gray-900 border border-gray-800 text-white placeholder-gray-600 rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"/>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <svg className="w-5 h-5 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <p className="text-gray-500 text-sm">
              {rows.length === 0
                ? 'No products in database. Use "Import XLSX" to upload your inventory file, or click "Add Item" to add manually.'
                : search
                ? `No items match "${search}".`
                : `No items match the current filters. (${rows.length} total in DB)`}
            </p>
          </div>
        ) : (
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="w-6 px-2 py-3"/>
                {['Part # / SKU','Product Name','Category','UOM','On Hand','Unit Cost','Case Qty','Pack Price','Reorder Pt','Location','Status'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 px-3 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => {
                const isLow = p.is_active && p.on_hand_qty > 0 && p.reorder_point > 0 && p.on_hand_qty <= p.reorder_point
                const isOut = p.is_active && p.on_hand_qty === 0
                const isDisc = p.is_discontinued === true
                const isDupe = p.duplicate_flag === true && p.duplicate_reviewed !== true
                return (
                  <tr key={p.id} onClick={() => openEdit(p)}
                    style={isOut ? { borderLeft: '3px solid rgb(239 68 68)' } : isLow ? { borderLeft: '3px solid rgb(245 158 11)' } : {}}
                    className={`border-b border-gray-800/60 last:border-0 cursor-pointer transition-colors
                      ${isDisc ? 'opacity-60 bg-gray-800/20 hover:bg-gray-800/40' : isOut ? 'bg-red-950/10 hover:bg-red-950/20' : isLow ? 'bg-amber-950/10 hover:bg-amber-950/20' : i % 2 === 1 ? 'bg-gray-800/10 hover:bg-gray-800/40' : 'hover:bg-gray-800/40'}`}>
                    <td className="px-2 py-3">
                      {isDupe && (
                        <svg className="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                      )}
                    </td>
                    <td className="px-3 py-3.5">
                      <span className="text-emerald-400 font-mono font-bold text-xs">{p.sku}</span>
                    </td>
                    <td className={`px-3 py-3.5 text-white font-medium ${isDisc ? 'line-through text-gray-500' : ''}`}>{pname(p)}</td>
                    <td className="px-3 py-3.5">
                      {p.category && (
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium border ${CATEGORY_COLORS[p.category] ?? CATEGORY_COLORS.Other}`}>{p.category}</span>
                      )}
                    </td>
                    <td className="px-3 py-3.5 text-gray-400 text-xs">{p.unit_of_measure ?? '—'}</td>
                    <td className={`px-3 py-3.5 font-semibold text-sm ${isOut ? 'text-red-400' : isLow ? 'text-amber-400' : 'text-gray-200'}`}>
                      {p.on_hand_qty}
                    </td>
                    <td className="px-3 py-3.5 text-gray-400 text-xs">{fmt$(p.unit_cost)}</td>
                    <td className="px-3 py-3.5 text-gray-500 text-xs">{p.case_qty ?? '—'}</td>
                    <td className="px-3 py-3.5 text-gray-400 text-xs">{fmt$(p.pack_price)}</td>
                    <td className={`px-3 py-3.5 text-xs ${isLow || isOut ? 'text-amber-400 font-medium' : 'text-gray-500'}`}>{p.reorder_point}</td>
                    <td className="px-3 py-3.5 text-gray-500 text-xs">{p.location ?? '—'}</td>
                    <td className="px-3 py-3.5">
                      {isDisc ? (
                        <span className="text-xs px-2 py-1 rounded-full font-medium bg-gray-700/40 text-gray-500 border border-gray-700">Discontinued</span>
                      ) : isOut ? (
                        <span className="text-xs px-2 py-1 rounded-full font-medium bg-red-500/15 text-red-400 border border-red-500/20">Out of Stock</span>
                      ) : isLow ? (
                        <span className="text-xs px-2 py-1 rounded-full font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20">Low Stock</span>
                      ) : (
                        <span className="text-xs px-2 py-1 rounded-full font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">Active</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Overlay */}
      <div onClick={close} className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}/>

      {/* Slide-out panel */}
      <div ref={panelRef} onClick={e => e.stopPropagation()}
        className={`fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-full w-full md:w-[540px] bg-gray-900 border-l border-gray-800 z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-800 shrink-0">
          <div>
            <h2 className="text-white font-semibold">{editing ? 'Edit Product' : 'Add Product'}</h2>
            {editing && <p className="text-xs text-gray-500 mt-0.5">ID: {editing.id.slice(0, 8)}…</p>}
          </div>
          <button onClick={close} className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-gray-800"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* Duplicate flag warning */}
          {editing?.duplicate_flag && editing.duplicate_reviewed !== true && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
              <div className="flex items-start gap-2">
                <svg className="w-4 h-4 text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                <div className="flex-1">
                  <p className="text-red-400 font-medium text-xs">Potential Duplicate</p>
                  <p className="text-red-400/70 text-xs mt-0.5">{editing.duplicate_reason ?? `Duplicate of: ${editing.duplicate_of}`}</p>
                </div>
              </div>
              <button onClick={() => markReviewed(editing.id)} className="mt-3 w-full text-xs px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors">
                Mark as Reviewed — Not a Duplicate
              </button>
            </div>
          )}

          {/* SKU — primary identifier, large and prominent */}
          <div className="bg-gray-800/60 border border-emerald-500/20 rounded-xl p-4">
            <label className="block text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2">Part Number / SKU <span className="text-red-400">*</span></label>
            <input value={form.sku} onChange={e => setForm(p => ({ ...p, sku: e.target.value.toUpperCase() }))}
              placeholder="e.g. 2016090" className="w-full bg-gray-900 border border-emerald-500/30 text-emerald-400 placeholder-gray-600 rounded-lg px-4 py-3 text-lg font-mono font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"/>
            <p className="text-xs text-gray-600 mt-1.5">Unique identifier — used across all orders, quotes, and production records</p>
          </div>

          {/* Product Name */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Product Name <span className="text-red-400">*</span></label>
            <input value={form.product_name} onChange={e => setForm(p => ({ ...p, product_name: e.target.value }))} className={inp}/>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Category */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Category</label>
              <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} className={inp + ' cursor-pointer'}>
                <option value="">— None —</option>
                {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {/* UOM */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Unit of Measure</label>
              <select value={form.unit_of_measure} onChange={e => setForm(p => ({ ...p, unit_of_measure: e.target.value }))} className={inp + ' cursor-pointer'}>
                {UOM_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">On Hand Qty</label>
              <input type="number" min="0" value={form.on_hand_qty} onChange={e => setForm(p => ({ ...p, on_hand_qty: e.target.value }))} className={inp}/>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Reorder Point</label>
              <input type="number" min="0" value={form.reorder_point} onChange={e => setForm(p => ({ ...p, reorder_point: e.target.value }))} className={inp}/>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Unit Cost ($)</label>
              <input type="number" min="0" step="0.0001" value={form.unit_cost} onChange={e => setForm(p => ({ ...p, unit_cost: e.target.value }))} className={inp}/>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Unit Price ($)</label>
              <input type="number" min="0" step="0.0001" value={form.unit_price} onChange={e => setForm(p => ({ ...p, unit_price: e.target.value }))} className={inp}/>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Case Qty</label>
              <input type="number" min="0" value={form.case_qty} onChange={e => setForm(p => ({ ...p, case_qty: e.target.value }))} className={inp}/>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Pack Price ($)</label>
              <input type="number" min="0" step="0.0001" value={form.pack_price} onChange={e => setForm(p => ({ ...p, pack_price: e.target.value }))} className={inp}/>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Case Price ($)</label>
              <input type="number" min="0" step="0.0001"
                value={form.case_price || (form.unit_cost && form.case_qty ? String(parseFloat(form.unit_cost) * parseInt(form.case_qty)) : '')}
                onChange={e => setForm(p => ({ ...p, case_price: e.target.value }))}
                placeholder={form.unit_cost && form.case_qty ? String(parseFloat(form.unit_cost) * parseInt(form.case_qty)) : 'Auto'}
                className={inp}/>
              <p className="text-xs text-gray-600 mt-0.5">= unit cost × case qty</p>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Location / Bin</label>
            <input value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} placeholder="e.g. Shelf A3, Bin 4" className={inp}/>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Vendor</label>
            <select value={form.vendor_id} onChange={e => setForm(p => ({ ...p, vendor_id: e.target.value }))} className={inp + ' cursor-pointer'}>
              <option value="">— None —</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.company_name}</option>)}
            </select>
          </div>

          <label className="flex items-center gap-3 cursor-pointer select-none p-3 bg-gray-800/40 rounded-lg border border-gray-700">
            <div onClick={() => setForm(p => ({ ...p, is_discontinued: !p.is_discontinued }))}
              className={`w-9 h-5 rounded-full transition-colors relative ${form.is_discontinued ? 'bg-red-600' : 'bg-gray-700'}`}>
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.is_discontinued ? 'translate-x-4' : 'translate-x-0.5'}`}/>
            </div>
            <div>
              <span className="text-sm text-gray-300">Discontinued</span>
              <p className="text-xs text-gray-600">Hides from active inventory and order dropdowns</p>
            </div>
          </label>

          {editing?.modification_log && (
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Modification Log (read-only)</label>
              <div className="bg-gray-800/40 rounded-lg px-3 py-2.5 text-xs text-gray-500 font-mono">{editing.modification_log}</div>
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Notes</label>
            <textarea rows={2} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} className={inp + ' resize-none'}/>
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
              <button onClick={toggleArchive} disabled={busy} className="text-sm px-3 py-2.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors disabled:opacity-50">
                {editing.is_active ? 'Archive' : 'Restore'}
              </button>
            )}
            <button onClick={close} className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors">Cancel</button>
            <button onClick={save} disabled={saving} className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
              {saving ? 'Saving…' : 'Save Product'}
            </button>
          </div>
        </div>
      </div>

      {/* Duplicates review modal */}
      {showDupes && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/70">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between shrink-0">
              <h3 className="text-white font-semibold">Review Potential Duplicates</h3>
              <button onClick={() => setShowDupes(false)} className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-gray-800"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg></button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-800/90">
                  <tr>
                    {['SKU','Product Name','Duplicate of','Reason','Actions'].map(h => (
                      <th key={h} className="text-left text-gray-500 px-4 py-2.5 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.filter(r => r.duplicate_flag === true && r.duplicate_reviewed !== true).map(r => (
                    <tr key={r.id} className="border-b border-gray-800/60 last:border-0">
                      <td className="px-4 py-3 text-emerald-400 font-mono font-bold">{r.sku}</td>
                      <td className="px-4 py-3 text-gray-300">{pname(r)}</td>
                      <td className="px-4 py-3 text-gray-500 font-mono">{r.duplicate_of ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{r.duplicate_reason ?? '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          <button onClick={() => markReviewed(r.id)} className="text-xs px-2 py-1 rounded bg-blue-700/50 hover:bg-blue-700 text-blue-300 transition-colors whitespace-nowrap">Keep Both</button>
                          <button onClick={() => markDupeInactive(r.id)} className="text-xs px-2 py-1 rounded bg-red-900/50 hover:bg-red-800/60 text-red-400 transition-colors whitespace-nowrap">Deactivate</button>
                          <button onClick={() => { setShowDupes(false); openEdit(r) }} className="text-xs px-2 py-1 rounded bg-gray-700/50 hover:bg-gray-700 text-gray-300 transition-colors">Edit</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.filter(r => r.duplicate_flag === true && r.duplicate_reviewed !== true).length === 0 && (
                <p className="text-center text-gray-500 py-8 text-sm">No pending duplicates.</p>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-800 shrink-0">
              <button onClick={() => setShowDupes(false)} className="w-full text-sm px-4 py-2.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
