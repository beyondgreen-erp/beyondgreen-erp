'use client'
import ShareLink from '@/components/ShareLink'
import { useItemDeepLink } from '@/components/useItemDeepLink'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState, memo } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import BomEditor from './BomEditor'
import CaseLabel from './CaseLabel'
import ZonePicker from '@/components/ZonePicker'
import { useMultiSelect } from '@/hooks/useMultiSelect'
import BulkActionBar from '@/components/BulkActionBar'
import Comments from '@/components/Comments'

interface Product {
  id: string
  sku: string
  our_part_number: string | null
  supplier_part_number: string | null
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
  is_import: boolean | null
  is_active: boolean
  is_discontinued: boolean | null
  notes: string | null
}

const PRODUCT_TABS = ['All','BAGS','CUTLERY','STRAW-CUPS','RAW MATERIAL','ADDITIVES','WIP','PACKAGING','PRINT PLATE','MOLDING','COMPOSTER']
const PRODUCT_TAB_OPTIONS = PRODUCT_TABS.slice(1)
const CATEGORY_OPTIONS = ['Finished Goods','Raw Material','Component','Packaging','Mold','WIP','Additives','Print Plates','Composter Components']

// ── Product class (top-level grouping) ────────────────────────────────────────
// The board is grouped by class: Finished Products, WIP, Packaging, etc.
// Only Finished Products need a BOM (unless flagged Import — No BOM).
const CLASS_FINISHED = 'Finished Products'
const CLASS_ORDER = [CLASS_FINISHED, 'WIP', 'Packaging', 'Raw Material', 'Additives', 'Composter Components', 'Print Plates', 'Mold', 'Component', 'Unclassified']
const CLASS_COLORS: Record<string, string> = {
  'Finished Products': '#00A84F', 'WIP': '#00C7C7', 'Packaging': '#579BFC', 'Raw Material': '#E2445C',
  'Additives': '#FDAB3D', 'Composter Components': '#037F4C', 'Print Plates': '#9699A6', 'Mold': '#FF6D3B',
  'Component': '#A25DDC', 'Unclassified': '#9699A6',
}
// Fold the messy free-text `category` values into clean class buckets.
const CLASS_MAP: Record<string, string> = {
  'finished goods': CLASS_FINISHED, 'finished products': CLASS_FINISHED, 'bags': CLASS_FINISHED,
  'wraps': CLASS_FINISHED, 'molded fiber': CLASS_FINISHED,
  'component': 'Packaging',
  '': 'Unclassified', 'uncategorized': 'Unclassified',
}
function classOf(p: { category: string | null }): string {
  const raw = (p.category || '').trim()
  return CLASS_MAP[raw.toLowerCase()] ?? (raw || 'Unclassified')
}
const isFinished = (p: { category: string | null }) => classOf(p) === CLASS_FINISHED
// Which class values (as stored in `category`) count as finished, for the editor toggle.
const FINISHED_CATEGORY_VALUES = ['Finished Goods', 'Finished Products', 'Bags', 'Wraps', 'Molded Fiber']
const UOM_OPTIONS = ['EA','PKS','LBS','ROLLS','CASE','M','FT','OZ','GAL','KG','SET','Other']

const fmt$ = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
const fmtV = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

const inp = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition'

const emptyForm = {
  sku: '',
  our_part_number: '',
  supplier_part_number: '',
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
  is_import: false,
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
  const [gtinUploading, setGtinUploading] = useState(false)
  const gsb = useMemo(() => createSupabaseBrowserClient(), [])
  async function uploadGtinImage(file: File) {
    setGtinUploading(true)
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase()
      const path = `gtin/${(form.sku || 'sku').trim().toUpperCase().replace(/[^A-Za-z0-9_-]/g, '')}-${Date.now()}.${ext}`
      const { error } = await gsb.storage.from('erp-images').upload(path, file, { upsert: true })
      if (error) { alert('Image upload failed: ' + error.message); return }
      const { data } = gsb.storage.from('erp-images').getPublicUrl(path)
      setForm(p => ({ ...p, gtin_image_url: data.publicUrl }))
    } finally { setGtinUploading(false) }
  }

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

          {/* Part numbers */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Our Part #</label>
              <input value={form.our_part_number} onChange={e => setForm(p => ({ ...p, our_part_number: e.target.value }))} placeholder="Internal part #" className={inp}/>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Supplier Part #</label>
              <input value={form.supplier_part_number} onChange={e => setForm(p => ({ ...p, supplier_part_number: e.target.value }))} placeholder="Supplier part #" className={inp}/>
            </div>
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
              <label className="block text-xs text-gray-400 mb-1.5">Class (group)</label>
              <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} className={inp + ' cursor-pointer'}>
                <option value="">— None —</option>
                {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {FINISHED_CATEGORY_VALUES.includes(form.category) && (
            <label className="flex items-start gap-2.5 rounded-lg border border-[#E4E6EE] bg-[#FBFCFE] px-3 py-2.5 cursor-pointer select-none">
              <input type="checkbox" checked={!!form.is_import} onChange={e => setForm(p => ({ ...p, is_import: e.target.checked }))} className="accent-amber-500 w-4 h-4 mt-0.5" />
              <span className="text-xs text-[#1A1D2E]">
                <span className="font-semibold">Import Product — No BOM</span>
                <span className="block text-gray-400 mt-0.5">Finished products need a BOM. Tick this if it&apos;s imported (bought finished) so it&apos;s exempt from the BOM requirement.</span>
              </span>
            </label>
          )}

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
  const [allocMap, setAllocMap] = useState<Record<string, { qty: number; orders: number }>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [tabFilter, setTabFilter] = useState('All')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [form, setForm] = useState<F>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [loadError, setLoadError] = useState('')
  const [bomProduct, setBomProduct] = useState<Product | null>(null)
  const [labelProduct, setLabelProduct] = useState<Product | null>(null)
  const [zoneProduct, setZoneProduct] = useState<Product | null>(null)
  const [zonedSet, setZonedSet] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const ms = useMultiSelect<Product>()

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    const [{ data: p, error: pErr }, { data: b }, { data: pz }, { data: alloc }] = await Promise.all([
      sb.from('products').select('*').order('sku', { ascending: true }),
      sb.from('product_bom').select('finished_good_sku'),
      sb.from('product_zones').select('product_id'),
      sb.from('v_component_allocation_totals').select('component_sku, allocated_qty, open_orders'),
    ])
    if (pErr) { setLoadError(`Failed to load: ${pErr.message}`) }
    else if (p) { setRows(p as Product[]) }
    if (b) {
      const counts: Record<string, number> = {}
      for (const r of b as any[]) { const k = r.finished_good_sku; if (k) counts[k] = (counts[k] ?? 0) + 1 }
      setBomMap(counts)
    }
    const am: Record<string, { qty: number; orders: number }> = {}
    for (const r of (alloc as any[]) || []) am[r.component_sku] = { qty: Number(r.allocated_qty) || 0, orders: Number(r.open_orders) || 0 }
    setAllocMap(am)
    setZonedSet(new Set(((pz as any[]) || []).map(r => r.product_id)))
    setLoading(false)
  }, [sb])

  const loadZoned = useCallback(async () => {
    const { data } = await sb.from('product_zones').select('product_id')
    setZonedSet(new Set(((data as any[]) || []).map(r => r.product_id)))
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
    const finishedGoods = tabPool.filter(p => isFinished(p)).length
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
      our_part_number: r.our_part_number ?? '',
      supplier_part_number: r.supplier_part_number ?? '',
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
      is_import: r.is_import === true,
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
      sku: form.sku.trim(),
      our_part_number: form.our_part_number.trim() || null,
      supplier_part_number: form.supplier_part_number.trim() || null,
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
      // Import flag only meaningful on finished products; store false otherwise.
      is_import: FINISHED_CATEGORY_VALUES.includes(form.category) ? !!form.is_import : false,
    }
    // Adding a brand-new item with a SKU that already exists would throw a raw
    // "duplicate key ... products_sku_unique" error. Catch it early with a clear message.
    if (!editing) {
      const { data: existing } = await sb.from('products').select('id, sku').ilike('sku', payload.sku).limit(1)
      if (existing && existing.length) {
        setErr(`A product with SKU "${payload.sku}" already exists — edit that item instead of adding a new one.`)
        setSaving(false); return
      }
    }
    const { error } = editing
      ? await sb.from('products').update(payload).eq('id', editing.id)
      : await sb.from('products').insert(payload)
    if (error) {
      const msg = /duplicate key|products_sku_unique/i.test(error.message)
        ? `A product with SKU "${payload.sku}" already exists — edit that item instead of adding a new one.`
        : error.message
      setErr(msg); setSaving(false); return
    }
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
        <div className="flex items-center gap-2">
          <a href="/sales/inventory/monthly-report"
            className="flex items-center gap-2 border border-[#E4E6EE] hover:border-[#D0D3E0] bg-white text-[#3B6FE0] text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
            Monthly Report &amp; Low-Stock
          </a>
          <button onClick={openAdd}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
            Add Product
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {!loading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatCard label="Total SKUs" value={String(rows.length)} sub="all categories"/>
          <StatCard label="Inventory Value" value={fmtV(stats.totalValue)} accent="text-emerald-600" sub="on-hand x unit cost"/>
          <StatCard label="Finished Products" value={String(stats.finishedGoods)} sub="finished-goods class"/>
          <StatCard label="Out of Stock" value={String(stats.outOfStock)} accent={stats.outOfStock > 0 ? 'text-red-600' : 'text-[#1A1D2E]'} sub="qty = 0"/>
        </div>
      )}

      {/* Search + collapse controls */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          <input placeholder="Search SKU or product name..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"/>
        </div>
        <span className="text-xs text-gray-400">{filtered.length} shown</span>
        <div className="flex items-center gap-1.5 ml-auto text-xs">
          <button onClick={() => setCollapsed(Object.fromEntries(PRODUCT_TAB_OPTIONS.concat('Uncategorized').map(g => [g, true])))} className="px-2.5 py-1.5 rounded-md text-gray-500 hover:bg-[#F0F2F7]">Collapse all</button>
          <button onClick={() => setCollapsed({})} className="px-2.5 py-1.5 rounded-md text-gray-500 hover:bg-[#F0F2F7]">Expand all</button>
        </div>
      </div>

      {/* Grouped record board */}
      {loading ? (
        <div className="flex items-center justify-center py-20 bg-white rounded-xl border border-[#E4E6EE]">
          <svg className="w-5 h-5 animate-spin text-gray-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-[#E4E6EE] rounded-xl px-4 py-16 text-center text-gray-500 text-sm">No products found.</div>
      ) : (() => {
        const COLORS = CLASS_COLORS
        const gmap: Record<string, Product[]> = {}
        for (const p of filtered) { const k = classOf(p); (gmap[k] ||= []).push(p) }
        const extra = Object.keys(gmap).filter(k => !CLASS_ORDER.includes(k)).sort()
        const keys = [...CLASS_ORDER.filter(k => gmap[k]), ...extra]
        return (
          <div className="space-y-2.5 mb-6">
            {keys.map(cat => {
              const items = gmap[cat]; const isCol = collapsed[cat]; const color = COLORS[cat] || '#9699A6'
              const gVal = items.reduce((s, p) => s + (p.on_hand_qty ?? 0) * (p.unit_cost ?? 0), 0)
              return (
                <div key={cat} className="bg-white rounded-xl shadow-sm border border-[#ECEEF3]">
                  <div className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none sticky top-0 z-30 rounded-t-xl" style={{ background: '#fff', borderLeft: '5px solid ' + color }} onClick={() => setCollapsed(c => ({ ...c, [cat]: !c[cat] }))}>
                    <span className="text-[10px]" style={{ color, display:'inline-block', transform: isCol ? 'none' : 'rotate(90deg)' }}>&#9654;</span>
                    <span className="font-bold text-sm" style={{ color }}>{cat}</span>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: color + '26', color }}>{items.length}</span>
                    {gVal > 0 && <span className="ml-auto text-[11px] text-gray-400">{fmtV(gVal)}</span>}
                  </div>
                  {!isCol && (
                    <div>
                      <table className="w-full text-sm min-w-[920px]">
                        <thead className="sticky top-[47px] z-20 [&_th]:bg-[#FBFCFE]">
                          <tr className="border-b border-[#EEF0F4] text-[11px] uppercase tracking-wide text-gray-400 bg-[#FBFCFE]">
                            <th className="w-9 px-3 py-2.5"><input type="checkbox" checked={items.length>0 && items.every(p=>ms.isSelected(p.id))} onChange={()=>ms.toggleAll(items)} className="accent-emerald-500 w-4 h-4 cursor-pointer"/></th>
                            <th className="text-left font-semibold px-3 py-2.5 w-[140px]">SKU</th>
                            <th className="text-left font-semibold px-3 py-2.5 min-w-[200px]">Product</th>
                            <th className="text-left font-semibold px-3 py-2.5 w-[130px]">Type</th>
                            <th className="text-left font-semibold px-3 py-2.5 w-[64px]">UOM</th>
                            <th className="text-right font-semibold px-3 py-2.5 w-[84px]">On Hand</th>
                            <th className="text-right font-semibold px-3 py-2.5 w-[104px]">Alloc / Avail</th>
                            <th className="text-right font-semibold px-3 py-2.5 w-[92px]">Unit Cost</th>
                            <th className="text-right font-semibold px-3 py-2.5 w-[110px]">Inv. Value</th>
                            <th className="text-left font-semibold px-3 py-2.5 w-[150px]">UPC</th>
                            <th className="text-center font-semibold px-2 py-2.5 w-[54px]">BOM</th>
                            <th className="text-left font-semibold px-3 py-2.5 w-[184px]">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F1F3F7]">
                          {items.map((p, i) => {
                            const invValue = (p.on_hand_qty ?? 0) * (p.unit_cost ?? 0)
                            const isOut = !p.on_hand_qty || p.on_hand_qty === 0
                            const isLow = !isOut && (p.on_hand_qty ?? 0) <= 10
                            const isDisc = p.is_discontinued === true
                            const bomCount = bomMap[p.sku] ?? 0
                            const isFG = isFinished(p)
                            const isImport = p.is_import === true
                            // Only finished products (that aren't imported) need a BOM.
                            const needsBom = isFG && !isImport && bomCount === 0
                            return (
                              <tr key={p.id} id={'item-'+p.id}
                                style={isOut ? { borderLeft:'3px solid #E2445C' } : isLow ? { borderLeft:'3px solid #FDAB3D' } : { borderLeft:'3px solid transparent' }}
                                className={`transition-colors ${ms.isSelected(p.id) ? 'bg-blue-50' : i % 2 ? 'bg-[#FBFCFE]' : 'bg-white'} hover:bg-[#F2F6FF] ${isDisc ? 'opacity-60' : ''}`}>
                                <td className="px-3 py-3" onClick={e=>e.stopPropagation()}><input type="checkbox" checked={ms.isSelected(p.id)} onChange={()=>ms.toggle(p.id)} className="accent-emerald-500 w-4 h-4 cursor-pointer"/></td>
                                <td className="px-3 py-3"><div className="flex items-center gap-2"><button title={zonedSet.has(p.id)?'Storage zone set — click to edit':'No storage zone — click to set'} onClick={e=>{e.stopPropagation(); setZoneProduct(p)}} className={`shrink-0 rounded-full ${zonedSet.has(p.id)?'':'animate-pulse'}`} style={{width:11,height:11,border:'none',cursor:'pointer',background:zonedSet.has(p.id)?'#10b981':'#3B82F6',boxShadow:zonedSet.has(p.id)?'none':'0 0 0 3px rgba(59,130,246,0.35)'}}/><span className="font-mono font-semibold text-[13px] text-[#0F7A4E] truncate block max-w-[130px] cursor-pointer" onClick={()=>openEdit(p)}>{p.sku}</span></div></td>
                                <td className={`px-3 py-3 cursor-pointer text-[#1A1D2E] font-medium ${isDisc ? 'line-through text-gray-400' : ''}`} onClick={()=>openEdit(p)}><span className="block truncate max-w-[320px]">{p.product_name}</span></td>
                                <td className="px-3 py-3 cursor-pointer" onClick={()=>openEdit(p)}>{p.category ? <span className="text-[11px] px-1.5 py-0.5 rounded font-medium bg-[#EEF2FB] text-[#3A4A6B] border border-[#DCE3F2] truncate inline-block max-w-[118px] align-middle">{p.category}</span> : <span className="text-gray-300">-</span>}</td>
                                <td className="px-3 py-3 text-gray-500 text-xs cursor-pointer" onClick={()=>openEdit(p)}>{p.unit_of_measure ?? '-'}</td>
                                <td className={`px-3 py-3 text-right font-semibold cursor-pointer ${isOut ? 'text-red-600' : isLow ? 'text-amber-600' : 'text-[#1A1D2E]'}`} onClick={()=>openEdit(p)}>{p.on_hand_qty ?? 0}</td>
                                <td className="px-3 py-3 text-right cursor-pointer" onClick={()=>openEdit(p)}>{(() => {
                                  const a = allocMap[p.sku]?.qty || 0
                                  if (a <= 0) return <span className="text-gray-300 text-xs">—</span>
                                  const avail = (p.on_hand_qty ?? 0) - a
                                  return <div className="leading-tight" title={`${allocMap[p.sku]?.orders || 0} open order(s) reserve ${a.toLocaleString()}`}><div className="text-[11px] text-violet-600 font-semibold">{a.toLocaleString()} alloc</div><div className={`text-[11px] font-semibold ${avail < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{avail.toLocaleString()} avail</div></div>
                                })()}</td>
                                <td className="px-3 py-3 text-right text-gray-600 text-xs cursor-pointer" onClick={()=>openEdit(p)}>{fmt$(p.unit_cost)}</td>
                                <td className="px-3 py-3 text-right text-xs font-medium cursor-pointer" onClick={()=>openEdit(p)}>{invValue > 0 ? <span className="text-emerald-600">{fmtV(invValue)}</span> : <span className="text-gray-300">-</span>}</td>
                                <td className="px-3 py-3 cursor-pointer" onClick={()=>openEdit(p)}><span className="text-gray-500 text-xs font-mono truncate block max-w-[140px]">{p.upc_gtin ?? '-'}</span></td>
                                <td className="px-2 py-3 text-center">{bomCount > 0 ? <svg className="w-4 h-4 text-emerald-500 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg> : (isFG && isImport) ? <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-[#FBF0DD] text-[#8A5A0B] whitespace-nowrap" title="Import Product — No BOM required">Import</span> : needsBom ? <span title="Finished product — BOM required"><svg className="w-4 h-4 text-amber-500 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg></span> : <span className="text-gray-300 text-xs">-</span>}</td>
                                <td className="px-3 py-3" onClick={e=>e.stopPropagation()}>
                                  <div className="flex items-center gap-1">
                                    <button onClick={() => openEdit(p)} className="text-[11px] px-2 py-1 rounded bg-[#EEF0F4] hover:bg-[#E2E6EE] text-gray-600 transition-colors">Edit</button>
                                    {isFG && !isImport && <button onClick={() => setBomProduct(p)} className="text-[11px] px-2 py-1 rounded bg-[#EFE7FB] hover:bg-[#E3D5F8] text-[#7A3FB0] transition-colors">BOM</button>}
                                    <button onClick={() => setZoneProduct(p)} className={`text-[11px] px-2 py-1 rounded transition-colors ${zonedSet.has(p.id)?'bg-[#E7F0FB] text-[#2563EB] hover:bg-[#D6E6F8]':'bg-blue-500 text-white animate-pulse'}`}>Zone</button>
                                    {isFG && <button onClick={() => setLabelProduct(p)} className="text-[11px] px-2 py-1 rounded bg-[#FBF0DD] hover:bg-[#F6E4C1] text-[#8A5A0B] transition-colors">Label</button>}
                                    <button onClick={() => handleDelete(p.id, p.sku)} className="text-[11px] px-2 py-1 rounded bg-[#FBE9E9] hover:bg-[#F6D5D5] text-[#B3261E] transition-colors">Del</button>
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })()}


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
      {zoneProduct && (
        <ZonePicker productId={zoneProduct.id} productName={zoneProduct.product_name} currentUserEmail={userEmail} onClose={() => { setZoneProduct(null); loadZoned() }} />
      )}
    </div>
  )
}
