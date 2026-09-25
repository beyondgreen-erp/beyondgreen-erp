'use client'
import ShareLink from '@/components/ShareLink'
import { useItemDeepLink } from '@/components/useItemDeepLink'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState, memo, Fragment } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import BomEditor from './BomEditor'
import CaseLabel from './CaseLabel'
import ZonePicker from '@/components/ZonePicker'
import { useMultiSelect } from '@/hooks/useMultiSelect'
import BulkActionBar from '@/components/BulkActionBar'
import * as XLSX from 'xlsx'
import Comments from '@/components/Comments'
import { uomOptions, normalizeUom, describeLadder } from '@/lib/uom'

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
  qty_updated_at: string | null
  qty_updated_by: string | null
  qty_updated_source: string | null
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
  product_image_url: string | null
  product_size: string | null
  product_weight: string | null
  product_thickness: string | null
  product_color: string | null
  print_color: string | null
  pieces_per_pack: number | null
  packs_per_case: number | null
  bag_length_in: number | null
  bag_width_in: number | null
  case_size: string | null
  case_weight: string | null
  cases_per_pallet: number | null
  pallet_ti_hi: string | null
  pallet_weight: string | null
  special_instructions: string | null
  requires_bom: boolean | null
  is_import: boolean | null
  is_active: boolean
  is_discontinued: boolean | null
  notes: string | null
}

const PRODUCT_TABS = ['All','BAGS','CUTLERY','STRAW-CUPS','RAW MATERIAL','ADDITIVES','WIP','PACKAGING','PRINT PLATE','MOLDING','COMPOSTER','ROLLS','MISC']
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
const ADD_NEW_UOM = '__add_new_uom__'

const fmt$ = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
const fmtV = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

const inp = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition'

// Fields the stock maths reads. Anything wrong in one of these moves the wrong
// quantity of stock, so they are marked out from the descriptive fields around them.
const inpCalc = 'w-full bg-white border-2 border-blue-400 text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition'
const lblCalc = 'block text-xs font-semibold text-blue-700 mb-1.5'

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
  product_image_url: '',
  product_size: '',
  product_weight: '',
  product_thickness: '',
  product_color: '',
  print_color: '',
  pieces_per_pack: '',
  packs_per_case: '',
  bag_length_in: '',
  bag_width_in: '',
  case_size: '',
  case_weight: '',
  cases_per_pallet: '',
  pallet_ti_hi: '',
  pallet_weight: '',
  special_instructions: '',
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
  // What the conversion panel needs to describe itself.
  const baseUom = normalizeUom(form.unit_of_measure) || 'EA'
  const ladderLine = describeLadder({
    unit_of_measure: form.unit_of_measure,
    pieces_per_pack: Number(form.pieces_per_pack) || null,
    packs_per_case: Number(form.packs_per_case) || null,
    cases_per_pallet: Number(form.cases_per_pallet) || null,
    case_qty: Number(form.case_qty) || null,
  })
  const zeroRung = ['pieces_per_pack', 'packs_per_case', 'cases_per_pallet']
    .some(k => String((form as any)[k] ?? '').trim() === '0')

  const [productUploading, setProductUploading] = useState(false)
  async function uploadProductImage(file: File) {
    setProductUploading(true)
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase()
      const path = `products/${(form.sku || 'sku').trim().toUpperCase().replace(/[^A-Za-z0-9_-]/g, '')}-${Date.now()}.${ext}`
      const { error } = await gsb.storage.from('record-board').upload(path, file, { upsert: true, contentType: file.type || 'image/png' })
      if (error) { alert('Image upload failed: ' + error.message); return }
      const { data } = gsb.storage.from('record-board').getPublicUrl(path)
      setForm(p => ({ ...p, product_image_url: data.publicUrl }))
    } finally { setProductUploading(false) }
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
              placeholder="e.g. BG-1001"
              className="w-full bg-white border border-emerald-500/30 text-emerald-400 placeholder-gray-600 rounded-lg px-4 py-3 text-lg font-mono font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"/>
            {editing && <p className="text-[11px] text-gray-400 mt-1.5">Changing the SKU renames it everywhere it&apos;s used (BOMs, orders, invoices, shipments, inventory history, Walmart/Chewy boards). You&apos;ll be asked to confirm on save.</p>}
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
              <select value={form.product_category} onChange={e => {
                const v = e.target.value
                if (v === '__new__') {
                  const t = (window.prompt('New category name:') || '').trim().toUpperCase()
                  if (t) setForm(p => ({ ...p, product_category: t }))
                  return
                }
                setForm(p => ({ ...p, product_category: v }))
              }} className={inp + ' cursor-pointer'}>
                <option value="">— None —</option>
                {Array.from(new Set([...PRODUCT_TAB_OPTIONS, ...(form.product_category ? [form.product_category] : [])])).map(c => <option key={c} value={c}>{c}</option>)}
                <option value="__new__">+ Add new category…</option>
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
              <label className={lblCalc}>Unit of Measure <span className="text-blue-400 font-normal">· stocking unit</span></label>
              <select value={normalizeUom(form.unit_of_measure) ?? 'EA'} onChange={e => {
                const v = e.target.value
                if (v === ADD_NEW_UOM) {
                  const entered = normalizeUom(window.prompt('New unit of measure (e.g. TOTE, DRUM, SLEEVE):') || '')
                  if (entered) setForm(p => ({ ...p, unit_of_measure: entered }))
                  return
                }
                setForm(p => ({ ...p, unit_of_measure: v }))
              }} className={inpCalc + ' cursor-pointer'}>
                {uomOptions(form.unit_of_measure).map(u => <option key={u} value={u}>{u}</option>)}
                <option value={ADD_NEW_UOM}>+ Add new UOM&hellip;</option>
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
                <label className={lblCalc}>On Hand Qty <span className="text-blue-400 font-normal">· counted in {baseUom}</span></label>
                <input type="number" min="0" value={form.on_hand_qty} onChange={e => setForm(p => ({ ...p, on_hand_qty: e.target.value }))} className={inpCalc}/>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Reorder Point</label>
                <input type="number" min="0" value={form.reorder_point} onChange={e => setForm(p => ({ ...p, reorder_point: e.target.value }))} className={inp}/>
              </div>
            </div>
            <div>
              <label className={lblCalc}>Unit Cost <span className="text-blue-400 font-normal">· $ per one {baseUom}</span></label>
              <input type="number" min="0" step="0.0001" value={form.unit_cost} onChange={e => setForm(p => ({ ...p, unit_cost: e.target.value }))} className={inpCalc}/>
              {liveValue > 0 && (
                <p className="text-xs text-emerald-400 mt-1 font-medium">
                  Inventory Value: {fmtV(liveValue)}
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">UPC / GTIN</label>
            <input value={form.upc_gtin} onChange={e => setForm(p => ({ ...p, upc_gtin: e.target.value }))} className={inp}/>
          </div>


          {/* Every field the stock conversion reads, in one place and marked in blue.
              A case with no inner pack is still a case: Packs Per Case is 1, and the
              pieces all sit on Pieces Per Pack. Zero is never the answer — it would
              make a case hold nothing. */}
          <div className="bg-[#EEF4FF] rounded-xl border-2 border-blue-400 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider">Pack &amp; Case Conversion</p>
                <p className="text-[11px] text-blue-900/70 mt-1">
                  Everything outlined in blue feeds the stock maths. These three turn an order in
                  packs, cases or pallets into {baseUom} when inventory is deducted.
                </p>
              </div>
              <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-semibold border ${ladderLine ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-amber-100 text-amber-800 border-amber-300'}`}>
                {ladderLine ? 'Complete' : 'Incomplete'}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={lblCalc}>Pieces Per Pack</label>
                <input type="number" min="1" value={form.pieces_per_pack}
                  onChange={e => setForm(p => ({ ...p, pieces_per_pack: e.target.value }))} className={inpCalc}/>
              </div>
              <div>
                <label className={lblCalc}>Packs Per Case</label>
                <input type="number" min="1" value={form.packs_per_case}
                  onChange={e => setForm(p => ({ ...p, packs_per_case: e.target.value }))} className={inpCalc}/>
              </div>
              <div>
                <label className={lblCalc}>Cases Per Pallet</label>
                <input type="number" min="1" value={form.cases_per_pallet}
                  onChange={e => setForm(p => ({ ...p, cases_per_pallet: e.target.value }))} className={inpCalc}/>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 items-end">
              <div>
                <label className={lblCalc}>Case Qty <span className="text-blue-400 font-normal">· pieces in a case</span></label>
                <input type="number" min="0" value={form.case_qty}
                  onChange={e => setForm(p => ({ ...p, case_qty: e.target.value }))} className={inpCalc}/>
              </div>
              <button type="button" onClick={() => setForm(p => ({
                ...p,
                packs_per_case: '1',
                pieces_per_pack: p.pieces_per_pack.trim() || p.case_qty.trim(),
              }))}
                className="h-[42px] text-xs px-3 rounded-lg border-2 border-blue-400 bg-white text-blue-700 font-medium hover:bg-blue-50">
                No inner pack — case holds loose pieces
              </button>
            </div>

            {zeroRung && (
              <p className="text-[11px] text-red-700 bg-red-50 border border-red-300 rounded-lg px-3 py-2">
                A pack or case set to <strong>0</strong> holds nothing, so every conversion through it
                comes out as zero. Use <strong>1</strong> when there is no inner pack.
              </p>
            )}

            <p className="text-[11px] text-blue-900 bg-white border border-blue-300 rounded-lg px-3 py-2">
              <span className="font-semibold uppercase tracking-wider text-blue-700 mr-2">Reads as</span>
              {ladderLine || `Not set — an order in CASE or PKS will not convert into ${baseUom}.`}
            </p>
            <p className="text-[11px] text-blue-900/60">
              Loose pieces in a case: Pieces Per Pack = the case count, Packs Per Case = 1.
              With an inner pack: Pieces Per Pack = pieces in one pack, Packs Per Case = packs in one case.
            </p>
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

          {/* Product Specifications */}
          <div className="border-t border-[#E4E6EE] pt-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Specifications</p>

            <div className="mb-3">
              <label className="block text-xs text-gray-400 mb-1.5">Product Image</label>
              {form.product_image_url ? (
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={form.product_image_url} alt="Product" className="h-20 w-20 border border-[#E4E6EE] rounded bg-white p-1 object-contain" />
                  <a href={form.product_image_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 underline">View</a>
                  <button type="button" onClick={() => setForm(p => ({ ...p, product_image_url: '' }))} className="text-xs text-red-500 underline">Remove</button>
                </div>
              ) : (
                <label className={`${inp} flex items-center justify-center cursor-pointer text-gray-500 ${productUploading ? 'opacity-60' : 'hover:border-blue-400'}`}>
                  {productUploading ? 'Uploading…' : 'Upload product image (PNG/JPG)'}
                  <input type="file" accept="image/*" className="hidden" disabled={productUploading}
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadProductImage(f); e.target.value = '' }} />
                </label>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {([
                ['Product Size', 'product_size'],
                ['Product Weight', 'product_weight'],
                ['Product Thickness', 'product_thickness'],
                ['Product Color', 'product_color'],
                ['Print Color', 'print_color'],
                ['Bag Length (in)', 'bag_length_in'],
                ['Bag Width (in)', 'bag_width_in'],
                ['Case Size', 'case_size'],
                ['Case Weight', 'case_weight'],
                ['Pallet Ti x Hi', 'pallet_ti_hi'],
                ['Pallet Weight', 'pallet_weight'],
              ] as const).map(([label, key]) => (
                <div key={key}>
                  <label className="block text-xs text-gray-400 mb-1.5">{label}</label>
                  <input value={(form as any)[key]}
                    onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} className={inp}/>
                </div>
              ))}
            </div>

            <div className="mt-3">
              <label className="block text-xs text-gray-400 mb-1.5">Special Instructions</label>
              <textarea rows={2} value={form.special_instructions} onChange={e => setForm(p => ({ ...p, special_instructions: e.target.value }))} className={inp + ' resize-none'}/>
            </div>
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
  // Products whose unit of measure needs a person to settle it: either ordered in EA
  // against a different stocking unit, or stocked in EA while carrying pack/case figures.
  const [uomFlags, setUomFlags] = useState<Record<string, { fix: string; ea_line_count: number; units_seen: string | null; ea_on_orders: boolean }>>({})
  const [onlyUomFlagged, setOnlyUomFlagged] = useState(false)
  // Conversion worklist import. Held here rather than in a page of its own so the
  // person fixing the flagged rows and the person loading the sheet are in one place.
  const [uomImport, setUomImport] = useState<any | null>(null)
  const [uomBusy, setUomBusy] = useState(false)
  const [uomFile, setUomFile] = useState<File | null>(null)
  useItemDeepLink(rows, openEdit)
  const [bomMap, setBomMap] = useState<Record<string, number>>({})
  const [allocMap, setAllocMap] = useState<Record<string, { qty: number; orders: number }>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [tabFilter, setTabFilter] = useState('All')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [activeClass, setActiveClass] = useState<string>('All')
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
  const [lastRecv, setLastRecv] = useState<Record<string, string>>({})
  const [activityOpen, setActivityOpen] = useState<Record<string, boolean>>({})
  const [activityData, setActivityData] = useState<Record<string, any[]>>({})
  const [manualAlloc, setManualAlloc] = useState<Record<string, number>>({})
  // Finished goods committed to open sales orders. Without this the Alloc/Avail column
  // was blank for every finished product, because component allocations only cover BOM parts.
  const [soAlloc, setSoAlloc] = useState<Record<string, { qty: number; orders: number }>>({})
  const [allocProduct, setAllocProduct] = useState<Product | null>(null)
  const ms = useMultiSelect<Product>()

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    const [{ data: p, error: pErr }, { data: b }, { data: pz }, { data: alloc }, { data: lr }, { data: mal }, { data: uf }, { data: soa }] = await Promise.all([
      sb.from('products').select('*').order('sku', { ascending: true }),
      sb.from('product_bom').select('finished_good_sku'),
      sb.from('product_zones').select('product_id'),
      sb.from('v_component_allocation_totals').select('component_sku, allocated_qty, open_orders'),
      sb.rpc('inventory_last_received'),
      sb.from('v_manual_allocation_totals').select('sku, allocated_qty'),
      sb.from('product_uom_flags').select('sku, fix, ea_line_count, units_seen, ea_on_orders'),
      sb.from('v_fg_allocation_totals').select('sku_key, allocated_qty, open_orders'),
    ])
    { const m: Record<string, string> = {}; for (const r of (lr as any[]) || []) { if (r.sku) m[r.sku] = r.last_received } setLastRecv(m) }
    { const m: Record<string, any> = {}; for (const r of (uf as any[]) || []) { if (r.sku) m[r.sku] = r } setUomFlags(m) }
    if (pErr) { setLoadError(`Failed to load: ${pErr.message}`) }
    else if (p) { setRows(p as Product[]) }
    if (b) {
      const counts: Record<string, number> = {}
      for (const r of b as any[]) { const k = r.finished_good_sku; if (k) counts[k] = (counts[k] ?? 0) + 1 }
      setBomMap(counts)
    }
    // Key both allocation maps by the same normalised SKU as manualAlloc — order lines and
    // products disagree on case ("bG23FRK1000" vs "BG23FRK1000"), which hid real allocations.
    const am: Record<string, { qty: number; orders: number }> = {}
    for (const r of (alloc as any[]) || []) { if (r.component_sku) am[String(r.component_sku).trim().toUpperCase()] = { qty: Number(r.allocated_qty) || 0, orders: Number(r.open_orders) || 0 } }
    setAllocMap(am)
    { const sm: Record<string, { qty: number; orders: number }> = {}; for (const r of (soa as any[]) || []) { if (r.sku_key) sm[String(r.sku_key).trim().toUpperCase()] = { qty: Number(r.allocated_qty) || 0, orders: Number(r.open_orders) || 0 } } setSoAlloc(sm) }
    { const mm: Record<string, number> = {}; for (const r of (mal as any[]) || []) { if (r.sku) mm[String(r.sku).toUpperCase()] = Number(r.allocated_qty) || 0 } setManualAlloc(mm) }
    setZonedSet(new Set(((pz as any[]) || []).map(r => r.product_id)))
    setLoading(false)
  }, [sb])

  const loadZoned = useCallback(async () => {
    const { data } = await sb.from('product_zones').select('product_id')
    setZonedSet(new Set(((data as any[]) || []).map(r => r.product_id)))
  }, [sb])

  async function toggleActivity(p: Product) {
    const willOpen = !activityOpen[p.id]
    setActivityOpen(o => ({ ...o, [p.id]: willOpen }))
    if (willOpen) {
      // Mark this row as loading (undefined) so we never flash "no movements" mid-fetch.
      setActivityData(d => ({ ...d, [p.id]: undefined as any }))
      // The first RPC call for a row can transiently return an error/empty; retry a few
      // times before concluding there are none, so real entries always appear.
      let rows: any[] | null = null
      for (let attempt = 0; attempt < 3 && (rows === null || rows.length === 0); attempt++) {
        if (attempt) await new Promise(res => setTimeout(res, 200))
        const { data, error } = await sb.rpc('sku_activity', { p_sku: p.sku, p_limit: 25 })
        rows = error ? rows : ((data as any[]) || [])
      }
      setActivityData(d => ({ ...d, [p.id]: rows || [] }))
    }
  }
  const fmtDT = (v: any) => { if (!v) return '—'; const d = new Date(v); return isNaN(+d) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }) }

  /**
   * When this item's on-hand quantity last moved, and whether a person typed it or
   * the system moved it — so the figure can be trusted without asking anyone.
   *
   * Amber is a hand-entered number; green is a shipment, receipt, production run or
   * FBA move. Grey means the quantity changed but nothing recorded how.
   */
  function qtyStamp(p: Product) {
    if (!p.qty_updated_at) return <span className="text-gray-300 text-xs">—</span>
    const d = new Date(p.qty_updated_at)
    if (isNaN(+d)) return <span className="text-gray-300 text-xs">—</span>
    const src = p.qty_updated_source || 'system'
    const tone = src === 'manual'
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : src === 'auto'
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : 'bg-gray-50 text-gray-500 border-[#E4E6EE]'
    const label = src === 'manual' ? 'Manual entry' : src === 'auto' ? 'Automatic' : 'Source not recorded'
    const days = Math.floor((Date.now() - d.getTime()) / 86400000)
    const ago = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
    return (
      <span
        title={`${label}${p.qty_updated_by ? ` by ${p.qty_updated_by}` : ''} — ${d.toLocaleString()} (${ago}). Open Activity for the full history.`}
        className={`inline-block whitespace-nowrap px-1.5 py-0.5 rounded border text-[11px] font-medium ${tone}`}>
        {d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        <span className="opacity-70">{' '}{d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
      </span>
    )
  }

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
    const pool = onlyUomFlagged ? tabPool.filter(r => uomFlags[r.sku]) : tabPool
    const q = search.toLowerCase().trim()
    if (!q) return pool
    const exact  = pool.filter(r => r.sku.toLowerCase() === q)
    const starts = pool.filter(r => r.sku.toLowerCase().startsWith(q) && r.sku.toLowerCase() !== q)
    const contains = pool.filter(r => r.sku.toLowerCase().includes(q) && !r.sku.toLowerCase().startsWith(q))
    const name   = pool.filter(r => (r.product_name ?? '').toLowerCase().includes(q) && !r.sku.toLowerCase().includes(q))
    return [...exact, ...starts, ...contains, ...name]
  }, [tabPool, search, onlyUomFlagged, uomFlags])

  async function postUomSheet(file: File, commit: boolean) {
    setUomBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/import/uom-conversions' + (commit ? '?commit=1' : ''), { method: 'POST', body: fd })
      const json = await res.json()
      setUomImport(json)
      if (commit && !json.error) { setUomFile(null); load() }
    } catch (e: any) {
      setUomImport({ error: String(e) })
    } finally {
      setUomBusy(false)
    }
  }

  function exportInventory(list: Product[], scope: string) {
    const header = ['SKU','Product','Category','UOM','On Hand','Qty Last Updated','Updated How','Updated By','Allocated','Available','Unit Cost','Inventory Value','UPC']
    const data = list.map(p => {
      const k = String(p.sku ?? '').trim().toUpperCase()
      const so = soAlloc[k]?.qty || 0
      const a = allocMap[k]?.qty || 0
      const ma = manualAlloc[k] || 0
      const alloc = so + a + ma
      const oh = p.on_hand_qty ?? 0
      const uc = p.unit_cost ?? 0
      const stampedAt = p.qty_updated_at ? new Date(p.qty_updated_at) : null
      const how = p.qty_updated_source === 'manual' ? 'Manual' : p.qty_updated_source === 'auto' ? 'Auto' : ''
      return [p.sku, p.product_name ?? '', (p as any).product_category ?? '', p.unit_of_measure ?? '', oh,
              stampedAt && !isNaN(+stampedAt) ? stampedAt.toLocaleString() : '', how, p.qty_updated_by ?? '',
              alloc, oh - alloc, uc, Number((oh * uc).toFixed(2)), (p as any).upc_gtin ?? '']
    })
    const ws = XLSX.utils.aoa_to_sheet([header, ...data])
    ws['!cols'] = [{wch:20},{wch:50},{wch:18},{wch:8},{wch:11},{wch:20},{wch:12},{wch:26},{wch:11},{wch:11},{wch:12},{wch:15},{wch:16}]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Inventory')
    XLSX.writeFile(wb, `beyondGREEN_Inventory_${scope}_${new Date().toISOString().slice(0,10)}.xlsx`)
  }

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
  // Print blank write-in inventory labels (SKU / Lot / Qty / Date) for bins & incoming stock
  function printBlankLabels() {
    const n = parseInt(window.prompt('How many blank inventory labels?', '12') || '0', 10)
    if (!n || n < 1) return
    const count = Math.min(n, 200)
    const one = `
      <div class="lbl">
        <div class="hd">beyondGREEN · Inventory Label</div>
        <div class="row"><span>SKU</span><i></i></div>
        <div class="row"><span>Product</span><i></i></div>
        <div class="two"><div class="row"><span>Lot #</span><i></i></div><div class="row"><span>Qty</span><i></i></div></div>
        <div class="two"><div class="row"><span>Date</span><i></i></div><div class="row"><span>By</span><i></i></div></div>
      </div>`
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Blank Inventory Labels (${count})</title>
<style>
  @page{size:letter;margin:0.35in}
  body{font-family:Arial,Helvetica,sans-serif;margin:0}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:0.18in}
  .lbl{border:1.5px solid #111;border-radius:8px;padding:10px 12px;height:1.55in;box-sizing:border-box;break-inside:avoid}
  .hd{font-size:10px;font-weight:bold;color:#00854a;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px}
  .row{display:flex;align-items:flex-end;gap:6px;margin:7px 0}
  .row span{font-size:11px;color:#333;width:52px;font-weight:bold}
  .row i{flex:1;border-bottom:1.5px solid #333;height:16px;display:block}
  .two{display:flex;gap:14px}.two .row{flex:1}
  .noprint{margin:12px}
</style></head><body>
<div class="noprint"><button onclick="window.print()" style="padding:8px 16px;font-size:14px">Print ${count} labels</button></div>
<div class="grid">${Array.from({ length: count }).map(() => one).join('')}</div>
</body></html>`
    const w = window.open('', '_blank', 'width=780,height=900')
    if (!w) { alert('Allow pop-ups to print labels.'); return }
    w.document.write(html); w.document.close()
  }

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
      product_image_url: r.product_image_url ?? '',
      product_size: r.product_size ?? '',
      product_weight: r.product_weight ?? '',
      product_thickness: r.product_thickness ?? '',
      product_color: r.product_color ?? '',
      print_color: r.print_color ?? '',
      pieces_per_pack: r.pieces_per_pack != null ? String(r.pieces_per_pack) : '',
      packs_per_case: r.packs_per_case != null ? String(r.packs_per_case) : '',
      bag_length_in: r.bag_length_in != null ? String(r.bag_length_in) : '',
      bag_width_in: r.bag_width_in != null ? String(r.bag_width_in) : '',
      case_size: r.case_size ?? '',
      case_weight: r.case_weight ?? '',
      cases_per_pallet: r.cases_per_pallet != null ? String(r.cases_per_pallet) : '',
      pallet_ti_hi: r.pallet_ti_hi ?? '',
      pallet_weight: r.pallet_weight ?? '',
      special_instructions: r.special_instructions ?? '',
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
    // Zero on a rung is not "unset" — it is a conversion that multiplies stock by nothing.
    if (['pieces_per_pack', 'packs_per_case', 'cases_per_pallet']
      .some(k => String((form as any)[k] ?? '').trim() === '0')) {
      setErr('Pieces Per Pack, Packs Per Case and Cases Per Pallet cannot be 0 — a container that holds nothing makes every conversion come out as zero. Use 1 where there is no inner pack.')
      return
    }
    setErr(''); setSaving(true)
    const payload: Record<string, any> = {
      sku: form.sku.trim(),
      our_part_number: form.our_part_number.trim() || null,
      supplier_part_number: form.supplier_part_number.trim() || null,
      product_name: form.product_name.trim(),
      product_category: form.product_category || null,
      category: form.category || null,
      unit_of_measure: normalizeUom(form.unit_of_measure),
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
      product_image_url: form.product_image_url || null,
      product_size: form.product_size.trim() || null,
      product_weight: form.product_weight.trim() || null,
      product_thickness: form.product_thickness.trim() || null,
      product_color: form.product_color.trim() || null,
      print_color: form.print_color.trim() || null,
      pieces_per_pack: form.pieces_per_pack ? parseInt(form.pieces_per_pack) : null,
      packs_per_case: form.packs_per_case ? parseInt(form.packs_per_case) : null,
      bag_length_in: form.bag_length_in ? parseFloat(form.bag_length_in) : null,
      bag_width_in: form.bag_width_in ? parseFloat(form.bag_width_in) : null,
      case_size: form.case_size.trim() || null,
      case_weight: form.case_weight.trim() || null,
      cases_per_pallet: form.cases_per_pallet ? parseInt(form.cases_per_pallet) : null,
      pallet_ti_hi: form.pallet_ti_hi.trim() || null,
      pallet_weight: form.pallet_weight.trim() || null,
      special_instructions: form.special_instructions.trim() || null,
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
    // SKU rename on an existing product: cascade the change everywhere the SKU is
    // referenced (BOMs, orders, invoices, shipments, movements, Walmart/Chewy boards)
    // so nothing is orphaned. Runs atomically in the DB before the rest of the fields save.
    if (editing) {
      const oldSku = String((editing as any).sku || '').trim()
      const newSku = payload.sku
      if (oldSku && newSku && newSku.toUpperCase() !== oldSku.toUpperCase()) {
        if (!confirm(`Rename SKU "${oldSku}" \u2192 "${newSku}"?\n\nThis updates the SKU everywhere it is used (BOMs, orders, invoices, shipments, inventory history, Walmart/Chewy boards). It can't be bulk-undone.`)) { setSaving(false); return }
        const { error: rErr } = await sb.rpc('rename_sku', { p_old: oldSku, p_new: newSku })
        if (rErr) {
          const m = /already used|already exists|unique|duplicate/i.test(rErr.message) ? `SKU "${newSku}" is already used by another product.` : ('Could not rename SKU: ' + rErr.message)
          setErr(m); setSaving(false); return
        }
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
    // Log a manual on-hand adjustment so the team's manual entry shows in the item's Activity feed.
    if (editing) {
      const oldOnHand = Number(editing.on_hand_qty ?? 0)
      const newOnHand = parseFloat(form.on_hand_qty) || 0
      const delta = newOnHand - oldOnHand
      if (delta !== 0) {
        try {
          await sb.from('inventory_movements').insert({
            product_id: editing.id, sku: payload.sku, movement_type: 'adjust',
            qty: delta, uom: payload.unit_of_measure || null, ref_table: 'manual',
            note: `Manual on-hand adjustment (${oldOnHand} \u2192 ${newOnHand})`, created_by: userEmail || null,
          })
        } catch { /* never block the save on activity logging */ }
      }
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
          <button onClick={printBlankLabels}
            className="flex items-center gap-2 border border-[#E4E6EE] hover:border-[#D0D3E0] bg-white text-[#8A5A0B] text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
            <span>🏷️</span> Blank Labels
          </button>
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
        {Object.keys(uomFlags).length > 0 && (
          <button onClick={() => setOnlyUomFlagged(v => !v)}
            title="Products whose unit of measure and conversion still need setting"
            className={`px-2.5 py-1.5 rounded-md text-[13px] font-medium border transition-colors ${onlyUomFlagged
              ? 'bg-amber-500 text-white border-amber-500'
              : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'}`}>
            UOM to fix ({Object.keys(uomFlags).length})
          </button>
        )}
        <button onClick={() => exportInventory(filtered, tabFilter === 'All' ? 'All' : tabFilter)} className="px-2.5 py-1.5 rounded-md text-[13px] font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200">Export</button>
        <label className="px-2.5 py-1.5 rounded-md text-[13px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 cursor-pointer"
          title="Load the filled-in Pack & Case Conversion worklist. Shows what would change before anything is written.">
          Import UOM sheet
          <input type="file" accept=".xlsx,.xls" className="hidden" disabled={uomBusy}
            onChange={e => { const f = e.target.files?.[0]; if (f) { setUomFile(f); postUomSheet(f, false) } e.target.value = '' }} />
        </label>
        <div className="flex items-center gap-1.5 ml-auto text-xs">
          <button onClick={() => setCollapsed(Object.fromEntries(PRODUCT_TAB_OPTIONS.concat('Uncategorized').map(g => [g, true])))} className="px-2.5 py-1.5 rounded-md text-gray-500 hover:bg-[#F0F2F7]">Collapse all</button>
          <button onClick={() => setCollapsed({})} className="px-2.5 py-1.5 rounded-md text-gray-500 hover:bg-[#F0F2F7]">Expand all</button>
        </div>
      </div>


      {(uomBusy || uomImport) && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => !uomBusy && setUomImport(null)}>
          <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl border border-[#E4E6EE] shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="px-5 py-4 border-b border-[#E4E6EE] flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-[#1A1D2E]">Pack &amp; Case Conversion import</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {uomImport?.committed ? 'Applied.' : 'Nothing has been written yet — this is what the sheet would change.'}
                </p>
              </div>
              <button onClick={() => setUomImport(null)} disabled={uomBusy} className="text-gray-500 hover:text-gray-700 p-1 rounded-lg hover:bg-[#F5F6FA]">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 text-sm">
              {uomBusy && <p className="text-gray-500">Reading the sheet&hellip;</p>}

              {uomImport?.error && (
                <p className="text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{String(uomImport.error)}</p>
              )}

              {uomImport && !uomImport.error && (
                <>
                  <div className="grid grid-cols-4 gap-2">
                    {[['Rows read', uomImport.rows_read], ['With entries', uomImport.rows_with_entries],
                      ['Will change', uomImport.will_update], ['Already correct', uomImport.unchanged]].map(([l, v]) => (
                      <div key={String(l)} className="rounded-lg border border-[#E4E6EE] bg-[#F5F6FA] px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wider text-gray-400">{l}</p>
                        <p className="text-lg font-semibold text-[#1A1D2E]">{Number(v ?? 0).toLocaleString('en-US')}</p>
                      </div>
                    ))}
                  </div>

                  {!!Object.keys(uomImport.by_field ?? {}).length && (
                    <p className="text-[12px] text-gray-600">
                      <span className="font-semibold text-gray-400 uppercase tracking-wider mr-2 text-[10px]">Fields</span>
                      {Object.entries(uomImport.by_field).map(([f, n]) => `${f.replace(/_/g, ' ')} ${n}`).join('  ·  ')}
                    </p>
                  )}

                  {!!uomImport.rejected?.length && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                      <p className="text-[12px] font-semibold text-red-800 mb-1">{uomImport.rejected.length} value(s) refused — these rows are skipped, the rest still apply</p>
                      <ul className="text-[11px] text-red-700 space-y-0.5 max-h-32 overflow-y-auto">
                        {uomImport.rejected.slice(0, 40).map((r: any, i: number) => (
                          <li key={i}>Row {r.row} · {r.sku} · {r.field}: {r.reason}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {!!uomImport.unknown_skus?.length && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                      <p className="text-[12px] font-semibold text-amber-800 mb-1">{uomImport.unknown_skus.length} SKU(s) are not in the catalogue — nothing is created for these</p>
                      <p className="text-[11px] text-amber-800">{uomImport.unknown_skus.slice(0, 25).map((u: any) => u.sku).join(', ')}</p>
                    </div>
                  )}

                  {!!uomImport.changes?.length && (
                    <div className="rounded-lg border border-[#E4E6EE]">
                      <table className="w-full text-[11px]">
                        <thead className="bg-[#F5F6FA] text-gray-400 uppercase tracking-wider text-[10px]">
                          <tr><th className="text-left px-2 py-1.5">SKU</th><th className="text-left px-2 py-1.5">Change</th></tr>
                        </thead>
                        <tbody>
                          {uomImport.changes.slice(0, 200).map((c: any) => (
                            <tr key={c.sku} className="border-t border-[#E4E6EE]">
                              <td className="px-2 py-1.5 font-mono text-[#0F7A4E]">{c.sku}</td>
                              <td className="px-2 py-1.5 text-gray-600">
                                {Object.entries(c.changes).map(([f, v]: any) => `${f.replace(/_/g, ' ')}: ${v.from ?? 'blank'} → ${v.to}`).join(' · ')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {!!uomImport.errors?.length && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                      {uomImport.errors.map((e: string, i: number) => <p key={i}>{e}</p>)}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="px-5 py-3 border-t border-[#E4E6EE] flex items-center justify-between">
              <p className="text-[11px] text-gray-400">
                Only the unit, the three conversion figures and the cost are written. Quantities, names and categories are never touched.
              </p>
              <div className="flex gap-2">
                <button onClick={() => setUomImport(null)} disabled={uomBusy}
                  className="text-xs px-3 py-1.5 rounded-lg border border-[#E4E6EE] text-gray-500">Close</button>
                {uomImport && !uomImport.error && !uomImport.committed && uomImport.will_update > 0 && (
                  <button onClick={() => uomFile && postUomSheet(uomFile, true)} disabled={uomBusy || !uomFile}
                    className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-blue-300 text-white font-medium">
                    {uomBusy ? 'Applying…' : `Apply ${uomImport.will_update} change(s)`}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

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
        const effectiveClass = search.trim() ? 'All' : (keys.includes(activeClass) ? activeClass : 'All')
        const shownKeys = effectiveClass === 'All' ? keys : keys.filter(k => k === effectiveClass)
        const tabList = ['All', ...keys]
        return (
          <div className="space-y-2.5 mb-6">
            <div className="flex items-center gap-1.5 flex-wrap bg-white rounded-xl border border-[#ECEEF3] shadow-sm px-2.5 py-2 sticky top-0 z-40 mb-1">
              {tabList.map(t => {
                const cnt = t === 'All' ? keys.reduce((sm, k) => sm + gmap[k].length, 0) : (gmap[t]?.length || 0)
                const col = t === 'All' ? '#3B6FE0' : (COLORS[t] || '#9699A6')
                const on = effectiveClass === t
                return (
                  <button key={t} onClick={() => setActiveClass(t)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                    style={on ? { background: col, color: '#fff' } : { background: col + '18', color: col }}>
                    {t} <span className="opacity-70">{cnt}</span>
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-gray-400 mb-3 flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-500">Last Updated:</span>
              <span className="px-1.5 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200 font-medium">Automatic</span>
              <span>shipment, receipt, production or FBA</span>
              <span className="text-gray-300">·</span>
              <span className="px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200 font-medium">Manual</span>
              <span>someone typed the number</span>
              <span className="text-gray-300">·</span>
              <span>hover for who and when, or open Activity for the full history</span>
            </p>
            {shownKeys.map(cat => {
              const items = gmap[cat]; const isCol = effectiveClass === 'All' ? collapsed[cat] : false; const color = COLORS[cat] || '#9699A6'
              const gVal = items.reduce((s, p) => s + (p.on_hand_qty ?? 0) * (p.unit_cost ?? 0), 0)
              return (
                <div key={cat} className="bg-white rounded-xl shadow-sm border border-[#ECEEF3]">
                  <div className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none sticky top-[46px] z-20 rounded-t-xl" style={{ background: '#fff', borderLeft: '5px solid ' + color }} onClick={() => setCollapsed(c => ({ ...c, [cat]: !c[cat] }))}>
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
                            <th className="text-right font-semibold px-3 py-2.5 w-[84px]">On Hand</th><th className="text-left font-semibold px-3 py-2.5 w-[132px]">Last Updated</th>
                            <th className="text-right font-semibold px-3 py-2.5 w-[104px]" title="Allocated = stock committed to open sales orders + consumed by BOMs on open orders + reserved by hand. Available = on hand minus that. Hover any cell for the breakdown; a red number means oversold.">Alloc / Avail</th>
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
                            const acts = activityData[p.id]
                            return (
                              <Fragment key={p.id}>
                              <tr id={'item-'+p.id}
                                style={isOut ? { borderLeft:'3px solid #E2445C' } : isLow ? { borderLeft:'3px solid #FDAB3D' } : { borderLeft:'3px solid transparent' }}
                                className={`transition-colors ${ms.isSelected(p.id) ? 'bg-blue-50' : i % 2 ? 'bg-[#FBFCFE]' : 'bg-white'} hover:bg-[#F2F6FF] ${isDisc ? 'opacity-60' : ''}`}>
                                <td className="px-3 py-3" onClick={e=>e.stopPropagation()}><input type="checkbox" checked={ms.isSelected(p.id)} onChange={()=>ms.toggle(p.id)} className="accent-emerald-500 w-4 h-4 cursor-pointer"/></td>
                                <td className="px-3 py-3"><div className="flex items-center gap-2"><button title={zonedSet.has(p.id)?'Storage zone set — click to edit':'No storage zone — click to set'} onClick={e=>{e.stopPropagation(); setZoneProduct(p)}} className={`shrink-0 rounded-full ${zonedSet.has(p.id)?'':'animate-pulse'}`} style={{width:11,height:11,border:'none',cursor:'pointer',background:zonedSet.has(p.id)?'#10b981':'#3B82F6',boxShadow:zonedSet.has(p.id)?'none':'0 0 0 3px rgba(59,130,246,0.35)'}}/><span className="font-mono font-semibold text-[13px] text-[#0F7A4E] truncate block max-w-[130px] cursor-pointer" onClick={()=>openEdit(p)}>{p.sku}</span></div></td>
                                <td className={`px-3 py-3 cursor-pointer text-[#1A1D2E] font-medium ${isDisc ? 'line-through text-gray-400' : ''}`} onClick={()=>openEdit(p)}><span className="block truncate max-w-[320px]">{p.product_name}</span>{lastRecv[p.sku] && <span className="block text-[10px] text-gray-400 font-normal mt-0.5">Rcvd {fmtDT(lastRecv[p.sku])}</span>}</td>
                                <td className="px-3 py-3 cursor-pointer" onClick={()=>openEdit(p)}>{p.category ? <span className="text-[11px] px-1.5 py-0.5 rounded font-medium bg-[#EEF2FB] text-[#3A4A6B] border border-[#DCE3F2] truncate inline-block max-w-[118px] align-middle">{p.category}</span> : <span className="text-gray-300">-</span>}</td>
                                <td className="px-3 py-3 text-xs cursor-pointer" onClick={()=>openEdit(p)}>{(() => {
                                  const f = uomFlags[p.sku]
                                  if (!f) return <span className="text-gray-500">{p.unit_of_measure ?? '-'}</span>
                                  return (
                                    <span className="inline-flex items-center gap-1" title={f.fix + (f.units_seen ? ` · Ordered in: ${f.units_seen}` : '')}>
                                      <span className="text-gray-500">{p.unit_of_measure ?? '-'}</span>
                                      <span className="px-1 rounded bg-amber-100 text-amber-800 border border-amber-300 text-[10px] font-semibold">
                                        {f.ea_on_orders ? `EA \u00d7${f.ea_line_count}` : 'EA?'}
                                      </span>
                                    </span>
                                  )
                                })()}</td>
                                <td className={`px-3 py-3 text-right font-semibold cursor-pointer ${isOut ? 'text-red-600' : isLow ? 'text-amber-600' : 'text-[#1A1D2E]'}`} onClick={()=>openEdit(p)}>{p.on_hand_qty ?? 0}</td>
                                <td className="px-3 py-3 cursor-pointer" onClick={()=>openEdit(p)}>{qtyStamp(p)}</td>
                                <td className="px-3 py-3 text-right cursor-pointer" onClick={()=>openEdit(p)}>{(() => {
                                  const k = String(p.sku ?? '').trim().toUpperCase()
                                  const so = soAlloc[k]?.qty || 0          // finished goods on open sales orders
                                  const a = allocMap[k]?.qty || 0          // BOM components consumed by open orders
                                  const ma = manualAlloc[k] || 0           // hand-reserved stock
                                  const tot = so + a + ma
                                  if (tot <= 0) return <span className="text-gray-300 text-xs">—</span>
                                  const avail = (p.on_hand_qty ?? 0) - tot
                                  const parts = [
                                    so>0?`${so.toLocaleString()} on ${soAlloc[k]?.orders || 0} open order${(soAlloc[k]?.orders || 0) === 1 ? '' : 's'}`:null,
                                    a>0?`${a.toLocaleString()} BOM`:null,
                                    ma>0?`${ma.toLocaleString()} manual`:null,
                                  ].filter(Boolean).join(' + ')
                                  return <div className="leading-tight" title={`Reserved: ${parts}`}><div className="text-[11px] text-violet-600 font-semibold">{tot.toLocaleString()} alloc{ma>0?' *':''}</div><div className={`text-[11px] font-semibold ${avail < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{avail.toLocaleString()} avail</div></div>
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
                                    <button onClick={() => toggleActivity(p)} title="Receiving & movement history" className={`text-[11px] px-2 py-1 rounded transition-colors ${activityOpen[p.id] ? 'bg-[#DDF3E8] text-[#0F7A4E]' : 'bg-[#EAF7F0] text-[#0F7A4E] hover:bg-[#DDF3E8]'}`}>Activity {activityOpen[p.id] ? '▾' : '▸'}</button>
                                    <button onClick={() => setAllocProduct(p)} title="Reserve stock to an order/job" className="text-[11px] px-2 py-1 rounded bg-[#E7EAFB] hover:bg-[#D6DCF8] text-[#4338CA] transition-colors">Alloc</button>
                                    <button onClick={() => handleDelete(p.id, p.sku)} className="text-[11px] px-2 py-1 rounded bg-[#FBE9E9] hover:bg-[#F6D5D5] text-[#B3261E] transition-colors">Del</button>
                                  </div>
                                </td>
                              </tr>
                              {activityOpen[p.id] && (
                                <tr className="bg-[#F7FBF9]">
                                  <td colSpan={13} className="px-6 py-3">
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[#0F7A4E] mb-2">Activity · {p.sku}</p>
                                    {acts === undefined ? <p className="text-xs text-gray-400 italic">Loading movements…</p> : acts.length === 0 ? <p className="text-xs text-gray-400 italic">No recorded movements yet.</p> : (
                                      <table className="w-full text-xs">
                                        <thead><tr className="text-[10px] uppercase tracking-wide text-gray-400 text-left"><th className="py-1 pr-4">Date</th><th className="py-1 pr-4">Type</th><th className="py-1 pr-4 text-right">Qty</th><th className="py-1 pr-4">UOM</th><th className="py-1 pr-4">Bags</th><th className="py-1 pr-4">Lot</th><th className="py-1 pr-4">Source</th><th className="py-1 pr-4">By</th></tr></thead>
                                        <tbody>
                                          {acts.map((a: any) => (
                                            <tr key={a.id} className="border-t border-[#E4EFEA]">
                                              <td className="py-1.5 pr-4 text-gray-600 whitespace-nowrap">{fmtDT(a.created_at)}</td>
                                              <td className="py-1.5 pr-4"><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${a.movement_type==='receive'?'bg-[#DDF3E8] text-[#0F7A4E]':a.movement_type==='ship'?'bg-[#FBE9E9] text-[#B3261E]':'bg-[#EEF2FB] text-[#3A4A6B]'}`}>{a.movement_type}</span></td>
                                              <td className={`py-1.5 pr-4 text-right font-semibold ${Number(a.qty)<0?'text-red-600':'text-[#0F7A4E]'}`}>{Number(a.qty)>0?'+':''}{a.qty}</td>
                                              <td className="py-1.5 pr-4 text-gray-500">{a.uom || '—'}</td>
                                              <td className="py-1.5 pr-4 text-gray-500">{a.pack_qty ?? '—'}</td>
                                              <td className="py-1.5 pr-4 text-gray-500 font-mono">{a.lot_number || '—'}</td>
                                              <td className="py-1.5 pr-4 text-gray-500">{(() => {
                                                const manual = ['manual','cycle_count','opening_balance'].includes(String(a.ref_table || ''))
                                                return (
                                                  <span className="inline-flex items-center gap-1">
                                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${manual ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>{manual ? 'Manual' : 'Auto'}</span>
                                                    <span>{a.ref_table || '—'}</span>
                                                  </span>
                                                )
                                              })()}</td>
                                              <td className="py-1.5 pr-4 text-gray-500 truncate max-w-[160px]">{a.created_by || '—'}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    )}
                                  </td>
                                </tr>
                              )}
                              </Fragment>
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


      <BulkActionBar count={ms.count} onDelete={bulkDelete} onClear={ms.clear} deleting={deleting} extraActions={<button onClick={() => exportInventory(rows.filter(r => ms.selected.has(r.id)), 'Selected')} className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-xl" style={{background:'#ECFDF5',color:'#047857',border:'1px solid #A7F3D0'}}>Export {ms.count}</button>}/>

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
      {allocProduct && (
        <AllocPanel product={allocProduct} userEmail={userEmail} onClose={() => { setAllocProduct(null); load() }} />
      )}
      {zoneProduct && (
        <ZonePicker productId={zoneProduct.id} productName={zoneProduct.product_name} currentUserEmail={userEmail} onClose={() => { setZoneProduct(null); loadZoned() }} />
      )}
    </div>
  )
}

function AllocPanel({ product, userEmail, onClose }: { product: any; userEmail: string; onClose: () => void }) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [qty, setQty] = useState('')
  const [allocTo, setAllocTo] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await sb.from('manual_allocations').select('*').eq('is_active', true)
      .ilike('sku', product.sku).order('created_at', { ascending: false })
    setRows((data as any[]) || [])
    setLoading(false)
  }, [sb, product.sku])
  useEffect(() => { load() }, [load])

  const totalAlloc = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0)
  const avail = (Number(product.on_hand_qty) || 0) - totalAlloc

  async function add() {
    setErr('')
    const q = Number(qty)
    if (!q || q <= 0) { setErr('Enter a quantity greater than 0.'); return }
    if (!allocTo.trim()) { setErr('Enter the order or job this is reserved for.'); return }
    setBusy(true)
    const { error } = await sb.from('manual_allocations').insert({
      product_id: product.id, sku: product.sku, qty: q,
      allocated_to: allocTo.trim(), note: note.trim() || null, created_by: userEmail || 'erp',
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setQty(''); setAllocTo(''); setNote(''); load()
  }
  async function release(id: string) {
    setBusy(true)
    await sb.from('manual_allocations').update({ is_active: false }).eq('id', id)
    setBusy(false); load()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#4338CA]">Manual Allocation</p>
            <p className="font-mono font-semibold text-[#0F7A4E]">{product.sku}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">&times;</button>
        </div>
        <div className="px-5 py-4">
          <div className="grid grid-cols-3 gap-3 mb-4 text-center">
            <div className="rounded-lg bg-[#F3F6FC] py-2"><div className="text-[10px] uppercase text-gray-400">On hand</div><div className="font-semibold text-[#1A1D2E]">{(Number(product.on_hand_qty)||0).toLocaleString()}</div></div>
            <div className="rounded-lg bg-[#EFE7FB] py-2" title="Reserved by hand on this panel only — it does not include stock committed to open sales orders or consumed by BOMs."><div className="text-[10px] uppercase text-gray-400">Reserved by hand</div><div className="font-semibold text-violet-600">{totalAlloc.toLocaleString()}</div></div>
            <div className="rounded-lg bg-[#EAF7F0] py-2" title="On hand minus hand-reserved. The Alloc / Avail column on the board also nets off open sales orders and BOM usage."><div className="text-[10px] uppercase text-gray-400">Left after that</div><div className={`font-semibold ${avail<0?'text-red-600':'text-emerald-600'}`}>{avail.toLocaleString()}</div></div>
          </div>

          <div className="rounded-lg border border-gray-200 p-3 mb-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">Reserve stock</p>
            <div className="flex gap-2 mb-2">
              <input value={qty} onChange={e=>setQty(e.target.value)} inputMode="decimal" placeholder="Qty" className="w-24 border border-gray-300 rounded px-2 py-1.5 text-sm"/>
              <input value={allocTo} onChange={e=>setAllocTo(e.target.value)} placeholder="Order / job (e.g. SO-31570)" className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm"/>
            </div>
            <input value={note} onChange={e=>setNote(e.target.value)} placeholder="Note (optional)" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm mb-2"/>
            {err && <p className="text-xs text-red-600 mb-2">{err}</p>}
            <button onClick={add} disabled={busy} className="w-full bg-[#4338CA] hover:bg-[#3730A3] disabled:opacity-50 text-white text-sm font-semibold rounded py-2 transition-colors">{busy ? 'Saving…' : 'Reserve'}</button>
          </div>

          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">Active reservations</p>
          {loading ? <p className="text-xs text-gray-400 italic">Loading…</p> : rows.length === 0 ? <p className="text-xs text-gray-400 italic">No manual reservations.</p> : (
            <table className="w-full text-xs">
              <thead><tr className="text-[10px] uppercase tracking-wide text-gray-400 text-left"><th className="py-1 pr-3 text-right">Qty</th><th className="py-1 pr-3">Reserved for</th><th className="py-1 pr-3">Note</th><th className="py-1 pr-3">By</th><th className="py-1"></th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-t border-gray-100">
                    <td className="py-1.5 pr-3 text-right font-semibold text-violet-600">{(Number(r.qty)||0).toLocaleString()}</td>
                    <td className="py-1.5 pr-3">{r.allocated_to || '—'}</td>
                    <td className="py-1.5 pr-3 text-gray-500 truncate max-w-[120px]">{r.note || '—'}</td>
                    <td className="py-1.5 pr-3 text-gray-400 truncate max-w-[90px]">{r.created_by || '—'}</td>
                    <td className="py-1.5 text-right"><button onClick={()=>release(r.id)} disabled={busy} className="text-[10px] px-2 py-0.5 rounded bg-[#FBE9E9] hover:bg-[#F6D5D5] text-[#B3261E]">Release</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
