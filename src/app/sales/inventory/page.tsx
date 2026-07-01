'use client'
import ShareLink from '@/components/ShareLink'
import { useItemDeepLink } from '@/components/useItemDeepLink'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState, memo } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import BomEditor from './BomEditor'
import CaseLabel from './CaseLabel'
import { useMultiSelect } from '@/hooks/useMultiSelect'
import BulkActionBar from '@/components/BulkActionBar'
import Comments from '@/components/Comments'

interface Product {
  id: string
  sku: string
  product_name: string
  product_category: string | null
  category: string | null
  product_location: string | null
  unit_of_measure: string | null
  on_hand_qty: number
  reorder_point: number | null
  unit_cost: number | null
  bom_cost: number | null
  case_cost: number | null
  upc_gtin: string | null
  gtin_image_url: string | null
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
  notes: string | null
}

const PRODUCT_TABS = ['All','BAGS','CUTLERY','STRAW-CUPS','RAW MATERIAL','ADDITIVES','WIP','PACKAGING','PRINT PLATE','MOLDING','COMPOSTER']
const PRODUCT_TAB_OPTIONS = PRODUCT_TABS.slice(1)
const CATEGORY_OPTIONS = ['Finished Goods','Raw Material','Component','Packaging','Mold','WIP','Additives','Print Plates','Composter Components']
const UOM_OPTIONS = ['EA','PKS','LBS','ROLLS','CASE','M','FT','OZ','GAL','KG','SET','Other']

const fmt$ = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
const fmtV = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

const inp = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition'

const emptyForm = {
  sku: '',
  product_name: '',
  product_category: '',
  category: '',
  unit_of_measure: 'EA',
  on_hand_qty: '0',
  reorder_point: '0',
  unit_cost: '',
  product_location: '',
  upc_gtin: '',
  gtin_image_url: '',
  case_qty: '',
  weight_per_unit_grams: '',
  distribution_price: '',
  wholesale_price: '',
  msrp: '',
  imap: '',
  map_price: '',
  notes: '',
  is_active: true,
  is_discontinued: false,
}
type F = typeof emptyForm

// ── Stat card ────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bg-white border rounded-xl px-4 py-3 flex flex-col gap-0.5" style={{borderColor:"#E4E6EE"}}>
      <span className="text-xs font-medium" style={{color:'#9CA3AF'}}>{label}</span>
      <span className={`text-xl font-bold ${accent ?? ''}`} style={!accent ? {color:'#1A1D2E'} : {}}>{value}</span>
      {sub && <span className="text-xs" style={{color:'#9CA3AF'}}>{sub}</span>}
    </div>
  )
}

// ── Edit panel (memo'd so typing doesn't re-render table) ────
const EditPanel = memo(function EditPanel({
  open, editing, form, setForm, err, saving, busy,
  onClose, onSave, onDelete, onToggleActive, userEmail,
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
  userEmail: string
}) {
  const liveValue = (parseFloat(form.on_hand_qty) || 0) * (parseFloat(form.unit_cost) || 0)

  return (
    <>
      <div onClick={onClose}
        className={`fixed inset-0 bg-black/30 z-40 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}/>
      <div onClick={e => e.stopPropagation()}
        className={`fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-full w-full md:w-[560px] bg-white border-l border-[#E4E6EE] z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${open ? 'translate-x-0' : 'translate-x-full'}`}>

        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E4E6EE] shrink-0">
          <div>
            <h2 className="text-[#1A1D2E] font-semibold">{editing ? 'Edit Product' : 'Add Product'}</h2>
            {editing && <ShareLink id={editing.id} className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-[#6B7280] hover:text-[#1A1D2E] border border-[#E4E6EE] hover:border-[#D0D3E0] bg-white px-2.5 py-1.5 rounded-lg transition-colors shrink-0" />}
            {editing && <p className="text-xs text-gray-500 mt-0.5">SKU: {editing.sku}</p>}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 p-1 rounded-lg hover:bg-[#F5F6FA]">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* SKU */}
          <div className="bg-[#F0F2F7] border border-emerald-500/20 rounded-xl p-4">
            <label className="block text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2">SKU <span className="text-red-400">*</span></label>
            <input value={form.sku}
              onChange={e => setForm(p => ({ ...p, sku: e.target.value.toUpperCase() }))}
              readOnly={!!editing}
              placeholder="e.g. BG-1001"
              className={`w-full bg-white border border-emerald-500/30 text-emerald-400 placeholder-gray-600 rounded-lg px-4 py-3 text-lg font-mono font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500 transition ${editing ? 'opacity-70 cursor-not-allowed' : ''}`}/>
          </div>

          {/* Product Name */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Product Name <span className="text-red-400">*</span></label>
            <input value={form.product_name} onChange={e => setForm(p => ({ ...p, product_name: e.target.value }))} className={inp}/>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Tab / Category</label>
              <select value={form.product_category} onChange={e => setForm(p => ({ ...p, product_category: e.target.value }))} className={inp + ' cursor-pointer'}>
                <option value="">— None —</option>
                {PRODUCT_TAB_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
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
              <label className="block text-xs text-gray-400 mb-1.5">Physical Location</label>
              <input value={form.product_location} onChange={e => setForm(p => ({ ...p, product_location: e.target.value }))} placeholder="e.g. Shelf A3" className={inp}/>
            </div>
          </div>

          {/* On Hand + Reorder + Cost */}
          <div className="bg-[#F5F6FA] rounded-xl border border-[#E4E6EE] p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Stock & Cost</p>
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
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Unit Cost ($)</label>
              <input type="number" min="0" step="0.0001" value={form.unit_cost} onChange={e => setForm(p => ({ ...p, unit_cost: e.target.value }))} className={inp}/>
              {liveValue > 0 && (
                <p className="text-xs text-emerald-400 mt-1 font-medium">
                  Inventory Value: {fmtV(liveValue)}
                </p>
              )}
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
            <label className="block text-xs text-gray-400 mb-1.5">GTIN Barcode Image <span className="text-gray-500 font-normal">(used on the case label)</span></label>
            {form.gtin_image_url ? (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={form.gtin_image_url} alt="GTIN barcode" className="h-14 w-auto border border-[#E4E6EE] rounded bg-white p-1 object-contain" />
                <a href={form.gtin_image_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 underline">View</a>
                <button type="button" onClick={() => setForm(p => ({ ...p, gtin_image_url: '' }))} className="text-xs text-red-500 underline">Remove</button>
              </div>
            ) : (
              <label className={`${inp} flex items-center justify-center cursor-pointer text-gray-500 ${gtinUploading ? 'opacity-60' : 'hover:border-blue-400'}`}>
                {gtinUploading ? 'Uploading…' : 'Upload GTIN barcode image (PNG/JPG)'}
                <input type="file" accept="image/*" className="hidden" disabled={gtinUploading}
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadGtinImage(f); e.target.value = '' }} />
              </label>
            )}
            <p className="text-[11px] text-gray-500 mt-1">If provided, this exact barcode image is placed on the case label. Otherwise the label generates a barcode from the UPC/GTIN number.</p>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Weight per unit (g)</label>
            <input type="number" min="0" step="0.001" value={form.weight_per_unit_grams} onChange={e => setForm(p => ({ ...p, weight_per_unit_grams: e.target.value }))} className={inp}/>
          </div>

          {/* Pricing */}
          <div className="border-t border-[#E4E6EE] pt-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Pricing</p>
            <div className="grid grid-cols-2 gap-3">
              {([
                ['Distribution Price', 'distribution_price'],
                ['Wholesale Price', 'wholesale_price'],
                ['MSRP', 'msrp'],
                ['IMAP', 'imap'],
                ['MAP Price', 'map_price'],
              ] as const).map(([label, key]) => (
                <div key={key}>
                  <label className="block text-xs text-gray-400 mb-1.5">{label}</label>
                  <input type="number" min="0" step="0.0001" value={(form as any)[key]}
                    onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} className={inp}/>
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Notes</label>
            <textarea rows={2} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} className={inp + ' resize-none'}/>
          </div>

          {/* Comments */}
          {editing && (
            <div className="border-t border-[#E4E6EE] pt-4">
              <Comments recordId={editing.id} recordType="product" currentUserEmail={userEmail}/>
            </div>
          )}

          {/* Toggles */}
          <div className="space-y-2">
            {([
              ['is_active', 'Active', 'bg-emerald-600'],
              ['is_discontinued', 'Discontinued', 'bg-red-600'],
            ] as const).map(([key, label, onColor]) => (
              <label key={key} className="flex items-center gap-3 cursor-pointer select-none p-3 bg-[#F5F6FA] rounded-lg border border-[#E4E6EE]"
                onClick={() => setForm(p => ({ ...p, [key]: !p[key] }))}>
                <div className={`w-9 h-5 rounded-full transition-colors relative ${(form as any)[key] ? onColor : 'bg-gray-300'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${(form as any)[key] ? 'translate-x-4' : 'translate-x-0.5'}`}/>
                </div>
                <span className="text-sm text-gray-500">{label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="shrink-0 px-6 py-4 border-t border-[#E4E6EE] space-y-3">
          {err && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5">
              <p className="text-red-400 text-xs">{err}</p>
            </div>
          )}
          <div className="flex gap-3">
            {editing && (
              <button onClick={onDelete}
                className="text-sm px-3 py-2.5 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors" title="Delete">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            )}
            {editing && (
              <button onClick={onToggleActive} disabled={busy}
                className="text-sm px-3 py-2.5 rounded-lg border border-[#E4E6EE] text-gray-400 hover:text-gray-700 transition-colors disabled:opacity-50">
                {busy ? '…' : editing.is_active ? 'Deactivate' : 'Activate'}
              </button>
            )}
            <button onClick={onClose} className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-[#E4E6EE] text-gray-400 hover:text-gray-700 transition-colors">Cancel</button>
            <button onClick={onSave} disabled={saving}
              className="flex-1 flex items-center justify-center bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-[#1A1D2E] text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
})

// ── Page ─────────────────────────────────────────────────────
export default function InventoryPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<Product[]>([])
  useItemDeepLink(rows, openEdit)
  const [bomMap, setBomMap] = useState<Record<string, number>>({})
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
  const [bomProduct, setBomProduct] = useState<Product | null>(null)
  const [labelProduct, setLabelProduct] = useState<Product | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [gtinUploading, setGtinUploading] = useState(false)
  const [userEmail, setUserEmail] = useState('')

  async function uploadGtinImage(file: File) {
    setGtinUploading(true); setErr('')
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase()
      const path = `gtin/${(form.sku || 'sku').trim().toUpperCase().replace(/[^A-Za-z0-9_-]/g, '')}-${Date.now()}.${ext}`
      const { error: upErr } = await sb.storage.from('erp-images').upload(path, file, { upsert: true })
      if (upErr) { setErr('Image upload failed: ' + upErr.message); return }
      const { data: urlData } = sb.storage.from('erp-images').getPublicUrl(path)
      setForm(p => ({ ...p, gtin_image_url: urlData.publicUrl }))
    } finally { setGtinUploading(false) }
  }
  const ms = useMultiSelect<Product>()

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    const [{ data: p, error: pErr }, { data: b }] = await Promise.all([
      sb.from('products').select('*').order('sku', { ascending: true }),
      sb.from('product_bom').select('sku'),
    ])
    if (pErr) { setLoadError(`Failed to load: ${pErr.message}`) }
    else if (p) { setRows(p as Product[]) }
    if (b) {
      const counts: Record<string, number> = {}
      for (const r of b as any[]) counts[r.sku] = (counts[r.sku] ?? 0) + 1
      setBomMap(counts)
    }
    setLoading(false)
  }, [sb])

  useEffect(() => {
    load()
    sb.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email) })
  }, [load, sb])

  // Tab-filtered pool (before search)
  const tabPool = useMemo(() =>
    tabFilter === 'All' ? rows : rows.filter(r => (r.product_category ?? '') === tabFilter),
    [rows, tabFilter])

  // Search on top of tab pool
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return tabPool
    const exact  = tabPool.filter(r => r.sku.toLowerCase() === q)
    const starts = tabPool.filter(r => r.sku.toLowerCase().startsWith(q) && r.sku.toLowerCase() !== q)
    const contains = tabPool.filter(r => r.sku.toLowerCase().includes(q) && !r.sku.toLowerCase().startsWith(q))
    const name   = tabPool.filter(r => (r.product_name ?? '').toLowerCase().includes(q) && !r.sku.toLowerCase().includes(q))
    return [...exact, ...starts, ...contains, ...name]
  }, [tabPool, search])

  // Stats (based on tab pool, not search-filtered)
  const stats = useMemo(() => {
    const totalValue = tabPool.reduce((s, p) => s + (p.on_hand_qty ?? 0) * (p.unit_cost ?? 0), 0)
    const finishedGoods = tabPool.filter(p => p.category === 'Finished Goods').length
    const outOfStock = tabPool.filter(p => !p.on_hand_qty || p.on_hand_qty === 0).length
    return { totalValue, finishedGoods, outOfStock }
  }, [tabPool])

  const tabCounts = useMemo(() => {
    const c: Record<string, number> = { All: rows.length }
    for (const r of rows) { const t = r.product_category ?? 'Uncategorized'; c[t] = (c[t] ?? 0) + 1 }
    return c
  }, [rows])

  function openAdd() { setEditing(null); setForm(emptyForm); setErr(''); setOpen(true) }

  function openEdit(r: Product) {
    setEditing(r)
    setForm({
      sku: r.sku,
      product_name: r.product_name ?? '',
      product_category: r.product_category ?? '',
      category: r.category ?? '',
      unit_of_measure: r.unit_of_measure ?? 'EA',
      on_hand_qty: String(r.on_hand_qty ?? 0),
      reorder_point: String(r.reorder_point ?? 0),
      unit_cost: r.unit_cost != null ? String(r.unit_cost) : '',
      product_location: r.product_location ?? '',
      upc_gtin: r.upc_gtin ?? '',
      gtin_image_url: r.gtin_image_url ?? '',
      case_qty: r.case_qty != null ? String(r.case_qty) : '',
      weight_per_unit_grams: r.weight_per_unit_grams != null ? String(r.weight_per_unit_grams) : '',
      distribution_price: r.distribution_price != null ? String(r.distribution_price) : '',
      wholesale_price: r.wholesale_price != null ? String(r.wholesale_price) : '',
      msrp: r.msrp != null ? String(r.msrp) : '',
      imap: r.imap != null ? String(r.imap) : '',
      map_price: r.map_price != null ? String(r.map_price) : '',
      notes: r.notes ?? '',
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
      reorder_point: parseFloat(form.reorder_point) || 0,
      unit_cost: form.unit_cost ? parseFloat(form.unit_cost) : null,
      product_location: form.product_location.trim() || null,
      upc_gtin: form.upc_gtin.trim() || null,
      gtin_image_url: form.gtin_image_url || null,
      case_qty: form.case_qty ? parseInt(form.case_qty) : null,
      weight_per_unit_grams: form.weight_per_unit_grams ? parseFloat(form.weight_per_unit_grams) : null,
      distribution_price: form.distribution_price ? parseFloat(form.distribution_price) : null,
      wholesale_price: form.wholesale_price ? parseFloat(form.wholesale_price) : null,
      msrp: form.msrp ? parseFloat(form.msrp) : null,
      imap: form.imap ? parseFloat(form.imap) : null,
      map_price: form.map_price ? parseFloat(form.map_price) : null,
      notes: form.notes.trim() || null,
      is_active: form.is_active,
      is_discontinued: form.is_discontinued,
    }
    const { error } = editing
      ? await sb.from('products').update(payload).eq('sku', editing.sku)
      : await sb.from('products').insert(payload)
    if (error) { setErr(error.message); setSaving(false); return }
    setSaving(false); closeEdit(); load()
  }

  async function handleDelete(id: string, sku: string) {
    if (!confirm(`Delete ${sku}? This cannot be undone.`)) return
    await sb.from('products').delete().eq('id', id)
    load()
  }

  async function bulkDelete() {
    if (!confirm(`Delete ${ms.count} products? This cannot be undone.`)) return
    setDeleting(true)
    await sb.from('products').delete().in('id', Array.from(ms.selected))
    ms.clear()
    setDeleting(false)
    load()
  }

  async function toggleActive() {
    if (!editing) return
    setBusy(true)
    await sb.from('products').update({ is_active: !editing.is_active }).eq('id', editing.id)
    setBusy(false); closeEdit(); load()
  }

  return (
    <div className="p-4 md:p-6 min-h-screen" style={{background:"#F5F6FA"}}>
      {loadError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-4 flex items-center gap-3">
          <span className="text-red-400 text-sm flex-1">{loadError}</span>
          <button onClick={load} className="text-xs text-red-400 border border-red-500/30 rounded-lg px-3 py-1">Retry</button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-blue-500/20 text-blue-300 border-blue-500/30">INVENTORY</span>
          <h1 className="text-2xl font-semibold text-[#1A1D2E] mt-1">Products & Inventory</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${rows.length} total products`}</p>
        </div>
        <button onClick={openAdd}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
          Add Product
        </button>
      </div>

      {/* Stats bar — updates with active tab */}
      {!loading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatCard label="Total SKUs" value={String(tabPool.length)} sub={tabFilter !== 'All' ? tabFilter : 'all categories'}/>
          <StatCard label="Inventory Value" value={fmtV(stats.totalValue)} accent="text-emerald-400" sub="on-hand × unit cost"/>
          <StatCard label="Finished Goods" value={String(stats.finishedGoods)} sub="category = Finished Goods"/>
          <StatCard label="Out of Stock" value={String(stats.outOfStock)} accent={stats.outOfStock > 0 ? 'text-red-400' : 'text-[#1A1D2E]'} sub="qty = 0"/>
        </div>
      )}

      {/* Tab filters */}
      <div className="flex gap-1 bg-[#F0F2F7] rounded-lg p-1 overflow-x-auto mb-4">
        {PRODUCT_TABS.map(t => (
          <button key={t} onClick={() => setTabFilter(t)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${tabFilter === t ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-700'}`}>
            {t}{tabCounts[t] != null ? ` (${tabCounts[t]})` : ''}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-4 max-w-md">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        <input placeholder="Search SKU or product name…" value={search} onChange={e => setSearch(e.target.value)}
          className="w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"/>
        {search && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">{filtered.length} results</span>}
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-x-auto" style={{border:"1px solid #E4E6EE",background:"#FFFFFF"}}>
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <svg className="w-5 h-5 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-gray-500 py-20 text-sm">No products found.</p>
        ) : (
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="border-b border-[#E4E6EE]">
                <th className="w-10 px-3 py-3"><input type="checkbox" checked={ms.isAllSelected(filtered)} onChange={()=>ms.toggleAll(filtered)} className="accent-emerald-500 w-4 h-4 cursor-pointer"/></th>
                {['SKU','Product Name','Tab','Type','UOM','On Hand','Inv. Value','Unit Cost','BOM','UPC','Actions'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 px-3 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => {
                const invValue = (p.on_hand_qty ?? 0) * (p.unit_cost ?? 0)
                const isOut  = !p.on_hand_qty || p.on_hand_qty === 0
                const isLow  = !isOut && (p.on_hand_qty ?? 0) <= 10
                const isDisc = p.is_discontinued === true
                const bomCount = bomMap[p.sku] ?? 0
                const needsBom = p.requires_bom === true
                const isFG = p.category === 'Finished Goods'

                return (
                  <tr key={p.id}
                    style={isOut ? { borderLeft: '3px solid rgb(239 68 68)' } : isLow ? { borderLeft: '3px solid rgb(245 158 11)' } : {}}
                    className={`border-b border-[#F3F4F6] last:border-0 transition-colors
                      ${isDisc ? 'opacity-50' : ''}
                      ${ms.isSelected(p.id) ? 'bg-blue-500/5' : isOut ? 'bg-red-950/20 hover:bg-red-950/30' : isLow ? 'bg-amber-950/20 hover:bg-amber-950/30' : i % 2 === 1 ? 'bg-[#FAFAFA] hover:bg-[#F9FAFB]' : 'hover:bg-[#F9FAFB]'}`}>
                    <td className="px-3 py-3.5" onClick={e=>e.stopPropagation()}>
                      <input type="checkbox" checked={ms.isSelected(p.id)} onChange={()=>ms.toggle(p.id)} className="accent-emerald-500 w-4 h-4 cursor-pointer"/>
                    </td>
                    <td className="px-3 py-3.5">
                      <span className="text-emerald-400 font-mono font-bold text-xs">{p.sku}</span>
                    </td>
                    <td className={`px-3 py-3.5 text-[#1A1D2E] font-medium max-w-[200px] truncate ${isDisc ? 'line-through text-gray-500' : ''}`}>
                      {p.product_name}
                    </td>
                    <td className="px-3 py-3.5">
                      {p.product_category && (
                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-blue-500/15 text-blue-400 border border-blue-500/20">
                          {p.product_category}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3.5">
                      {p.category && (
                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-[#F5F6FA]/50 text-gray-400 border border-[#E4E6EE]">
                          {p.category}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3.5 text-gray-400 text-xs">{p.unit_of_measure ?? '—'}</td>
                    <td className={`px-3 py-3.5 font-semibold text-sm ${isOut ? 'text-red-400' : isLow ? 'text-amber-400' : 'text-gray-200'}`}>
                      {p.on_hand_qty ?? 0}
                    </td>
                    <td className="px-3 py-3.5 text-xs font-medium">
                      {invValue > 0
                        ? <span className="text-emerald-400">{fmtV(invValue)}</span>
                        : <span className="text-gray-700">—</span>
                      }
                    </td>
                    <td className="px-3 py-3.5 text-gray-400 text-xs">{fmt$(p.unit_cost)}</td>
                    <td className="px-3 py-3.5">
                      {bomCount > 0
                        ? <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
                        : needsBom
                        ? <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                        : <span className="text-gray-700 text-xs">—</span>
                      }
                    </td>
                    <td className="px-3 py-3.5 text-gray-500 text-xs font-mono">{p.upc_gtin ?? '—'}</td>
                    <td className="px-3 py-3.5">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(p)}
                          className="text-xs px-2 py-1 rounded bg-[#F5F6FA]/50 hover:bg-[#F5F6FA] text-gray-500 transition-colors">Edit</button>
                        <button onClick={() => setBomProduct(p)}
                          className="text-xs px-2 py-1 rounded bg-violet-700/50 hover:bg-violet-700 text-violet-300 transition-colors">BOM</button>
                        {isFG && (
                          <button onClick={() => setLabelProduct(p)}
                            className="text-xs px-2 py-1 rounded bg-amber-700/50 hover:bg-amber-700 text-amber-300 transition-colors">Label</button>
                        )}
                        <button onClick={() => handleDelete(p.id, p.sku)}
                          className="text-xs px-2 py-1 rounded bg-red-900/40 hover:bg-red-900/70 text-red-400 transition-colors">Del</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {/* Totals footer */}
            <tfoot>
              <tr className="border-t border-[#E4E6EE] bg-[#F5F6FA]">
                <td className="px-3 py-3"/>
                <td colSpan={5} className="px-3 py-3 text-xs text-gray-500 font-medium">
                  {filtered.length} products shown
                </td>
                <td className="px-3 py-3 text-xs font-semibold text-gray-500">
                  {filtered.reduce((s, p) => s + (p.on_hand_qty ?? 0), 0).toLocaleString()}
                </td>
                <td className="px-3 py-3 text-xs font-bold text-emerald-400">
                  {fmtV(filtered.reduce((s, p) => s + (p.on_hand_qty ?? 0) * (p.unit_cost ?? 0), 0))}
                </td>
                <td colSpan={4}/>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      <BulkActionBar count={ms.count} onDelete={bulkDelete} onClear={ms.clear} deleting={deleting}/>

      <EditPanel
        open={open} editing={editing} form={form} setForm={setForm}
        err={err} saving={saving} busy={busy}
        onClose={closeEdit} onSave={save}
        onDelete={() => { if (editing) handleDelete(editing.id, editing.sku).then(closeEdit) }}
        onToggleActive={toggleActive}
        userEmail={userEmail}
      />

      {bomProduct && (
        <BomEditor product={bomProduct} onClose={() => { setBomProduct(null); load() }}/>
      )}
      {labelProduct && (
        <CaseLabel product={labelProduct} onClose={() => setLabelProduct(null)}/>
      )}
    </div>
  )
}
