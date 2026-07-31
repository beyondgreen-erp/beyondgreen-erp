'use client'
import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import Comments from '@/components/Comments'
import { statusColor } from '@/lib/statusColors'
import { buildCaseLabels, buildPalletLabels, missingUpcSkus, loadBarcodePng, type CaseLabel, type PalletLabel } from '@/lib/shipping/labels'
import { generatePickTickets, type PickTicketPallet } from '@/lib/labelGenerator'
import { buildBOL, buildMasterBOL, buildPackingList, loadImageDataUrl, type BolLine, type BolData, type PackListCase } from '@/lib/shipping/bol'

const sb = createSupabaseBrowserClient()
const GRAMS_PER_LB = 453.592
const SHIP_FROM_NAME = 'beyondGREEN biotech, Inc.'
const SHIP_FROM_ADDR = '1202 E Wakeham Ave.,\nSanta Ana, CA 92705 USA'
const SHIPPABLE = ['In Production', 'Ready to Ship', 'Ready at Will Call', 'Partially Shipped']
const DOC_LABELS: Record<string, string> = { bol: 'BOL', packingList: 'Packing List', palletLabels: 'Pallet Labels', caseLabels: 'Case Labels' }

interface OrderInfo {
  order_number: string; po_number?: string | null; shipping_address?: string | null
  total?: number | null; total_amount?: number | null; total_value?: number | null; customer_id?: string
  status?: string | null; order_date?: string | null; required_ship_date?: string | null
  carrier?: string | null; tracking_number?: string | null; additional_comments?: string | null
  ship_prep?: Record<string, boolean> | null
  customers?: { company_name: string; shipping_address?: string | null }
}
interface QueueItem { id: string; sales_order_id: string; status: string; sales_orders?: OrderInfo }
interface WInfo { name?: string | null; status?: string | null; po_number?: string | null; ship_to?: string | null; ship_due_date?: string | null; order_date?: string | null; carrier?: string | null; total_value?: number | null }
interface WQueueItem { id: string; status: string; w?: WInfo }
interface PlanRow {
  sku: string; description: string; units: number; unitsPerCase: number; cases: number
  caseWeightLb: number; gramsPerUnit: number; upc: string | null; customerPart: string | null
  gtinImageUrl: string | null; uom: string; packaging: string; done: number
  productId: string | null
  // Session-only box/case dimensions (inches) captured during packing.
  boxLengthIn: number; boxWidthIn: number; boxHeightIn: number
}
// A freight-style pallet configuration: N identical pallets, each with the same dimensions,
// weight, freight attributes, and contents (one or more SKUs — mixed pallets supported).
interface PalletContent { sku: string; casesPerPallet: number }
interface PalletConfig {
  id: number; count: number
  lengthIn: number; widthIn: number; heightIn: number
  weightLb: number; freightClass: string; nmfc: string; stackable: boolean; notes: string
  contents: PalletContent[]
}
// One physical pallet, expanded from a configuration (each config of count N yields N of these).
interface ExpandedPallet {
  number: number; weightLb: number
  lengthIn: number; widthIn: number; heightIn: number
  freightClass: string; nmfc: string; stackable: boolean; notes: string
  lines: { sku: string; cases: number; unitsPerCase: number; description: string; upc: string | null; customerPart: string | null; gtinImageUrl: string | null; caseWeightLb: number }[]
}
const DEFAULT_L = 48, DEFAULT_W = 40
function newConfig(id: number): PalletConfig {
  return { id, count: 1, lengthIn: DEFAULT_L, widthIn: DEFAULT_W, heightIn: 0, weightLb: 0, freightClass: '', nmfc: '', stackable: false, notes: '', contents: [{ sku: '', casesPerPallet: 0 }] }
}
interface BolRow { id: string; bol_number: string; po_number?: string | null; ship_to_name?: string | null; pallet_qty?: number; case_qty?: number; weight?: number; declared_value?: number; commodity_description?: string | null; status?: string }

// Editable BOL form state (mirrors BolData + editable commodity lines)
interface BolLineForm { palletId: number; handlingQty: number; packageQty: number; weight: number; commodityDescription: string; nmfcNumber: string; freightClass: string }
interface BolForm {
  bolNumber: string; date: string; carrierName: string; scac: string; freightTerms: string
  proNumber: string; trailerNo: string; sealNumber: string
  poNumber: string; puNumber: string; loadNumber: string
  shipFromName: string; shipFromAddress: string; shipToName: string; shipToAddress: string
  specialInstructions: string   // newline-separated in the textarea
  declaredValue: number
  lines: BolLineForm[]
}

function shipTo(o?: OrderInfo): { name: string; addr: string } {
  return { name: o?.customers?.company_name || 'Customer', addr: (o?.shipping_address || o?.customers?.shipping_address || '').toString() }
}
function fmtMoney(n?: number | null) { return n != null ? '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—' }

export default function ShippingQueuePage() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [wItems, setWItems] = useState<WQueueItem[]>([])
  const [openW, setOpenW] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [shipMode, setShipMode] = useState<'full' | 'partial'>('full')
  const [priorShipments, setPriorShipments] = useState(0)
  const [draftMsg, setDraftMsg] = useState('')
  const [plan, setPlan] = useState<PlanRow[]>([])
  const [configs, setConfigs] = useState<PalletConfig[]>([])
  const [cfgDraft, setCfgDraft] = useState<PalletConfig | null>(null)   // config being added/edited in the pop-up
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState('')
  const [missing, setMissing] = useState<string[]>([])
  const [bols, setBols] = useState<BolRow[]>([])
  const [sel, setSel] = useState<Record<string, boolean>>({})
  const [showMaster, setShowMaster] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  // Search / filter
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  // BOL review + gating
  const [parcel, setParcel] = useState(false)
  const [bolForm, setBolForm] = useState<BolForm | null>(null)
  const [finalized, setFinalized] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const prevUrlRef = useRef('')
  // Closeout / move-to-shipments
  const [shipPrep, setShipPrep] = useState<Record<string, boolean>>({})
  const [closeout, setCloseout] = useState(false)
  const [coShipId, setCoShipId] = useState('')
  const [coSlipUrl, setCoSlipUrl] = useState('')
  const [coBolUrl, setCoBolUrl] = useState('')
  const [coPhotos, setCoPhotos] = useState<{ url: string; type: string }[]>([])
  const [coSummary, setCoSummary] = useState('')
  const [shipCarrier, setShipCarrier] = useState('')
  const [shipTracking, setShipTracking] = useState('')
  const [shipCost, setShipCost] = useState('')
  const [shipBrokerCost, setShipBrokerCost] = useState('')
  const [coBusy, setCoBusy] = useState('')

  useEffect(() => { sb.auth.getUser().then(({ data }) => setUserEmail(data.user?.email || '')) }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await sb.from('sales_orders')
      .select('id, order_number, po_number, shipping_address, total, total_amount, total_value, customer_id, status, order_date, required_ship_date, carrier, tracking_number, additional_comments, ship_prep, customers(company_name, shipping_address)')
      .in('status', SHIPPABLE).eq('archived', false).order('required_ship_date', { ascending: true, nullsFirst: false })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (data as any[]) || []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setItems(rows.map((o: any) => ({ id: o.id, sales_order_id: o.id, status: o.status, sales_orders: o })))
    // Mirror Walmart board orders that are in a shippable status (same status vocabulary, non-archived).
    const { data: wdata } = await sb.from('walmart_board_orders')
      .select('id, name, status, po_number, ship_to, ship_due_date, order_date, carrier, total_value')
      .in('status', SHIPPABLE).eq('archived', false).order('ship_due_date', { ascending: true, nullsFirst: false })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setWItems(((wdata as any[]) || []).map((w: any) => ({ id: w.id, status: w.status, w })))
    setLoading(false)
  }, [])

  const loadBols = useCallback(async () => {
    const { data } = await sb.from('bols').select('id, bol_number, po_number, ship_to_name, pallet_qty, case_qty, weight, declared_value, commodity_description, status')
      .eq('status', 'Draft').order('created_at', { ascending: false })
    setBols((data as BolRow[]) || [])
  }, [])

  useEffect(() => { load(); loadBols() }, [load, loadBols])

  // Keep every account in sync in real time: reload when any order or BOL changes,
  // and whenever the tab regains focus. No manual refresh, no per-account drift.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null
    const bump = () => { if (t) clearTimeout(t); t = setTimeout(() => { load(); loadBols() }, 400) }
    const ch = sb.channel('shipping-queue-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_orders' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bols' }, bump)
      .subscribe()
    const onFocus = () => { load(); loadBols() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => { if (t) clearTimeout(t); sb.removeChannel(ch); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus) }
  }, [load, loadBols])

  function resetPackState() {
    setPlan([]); setConfigs([]); setCfgDraft(null); setParcel(false)
    setBolForm(null); setFinalized(false); setMissing([]); setNotes('')
    if (prevUrlRef.current) { URL.revokeObjectURL(prevUrlRef.current); prevUrlRef.current = '' }
    setPreviewUrl('')
    setShipPrep({}); setCloseout(false); setCoShipId(''); setCoSlipUrl(''); setCoBolUrl(''); setCoPhotos([]); setCoSummary(''); setCoBusy('')
    setShipCarrier(''); setShipTracking(''); setShipCost(''); setShipBrokerCost('')
    setShipMode('full'); setPriorShipments(0)
  }

  async function openOrder(item: QueueItem) {
    if (openId === item.id) { setOpenId(null); resetPackState(); return }
    setOpenId(item.id); resetPackState(); setBusy('load')
    setShipPrep(item.sales_orders?.ship_prep || {})
    void sb.from('shipments').select('id', { count: 'exact', head: true }).eq('sales_order_id', item.sales_order_id).then(({ count }) => setPriorShipments(count || 0))
    const { data: lines } = await sb.from('sales_order_lines').select('*').eq('sales_order_id', item.sales_order_id).order('line_number', { ascending: true })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ls = (lines as any[]) || []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pids = [...new Set(ls.map((l: any) => l.product_id).filter(Boolean))]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prodMap: Record<string, any> = {}
    const PROD_COLS = 'id, sku, case_qty, weight_per_unit_grams, upc_gtin, gtin_image_url, customer_part_number, product_name'
    if (pids.length) {
      const { data: prods } = await sb.from('products').select(PROD_COLS).in('id', pids)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;((prods as any[]) || []).forEach((p: any) => { prodMap[p.id] = p })
    }
    // Fallback: match products by SKU (case-insensitive). Order lines imported from Monday
    // often carry a product_id that no longer exists, or a SKU cased differently ("bG" vs "BG"),
    // which orphaned the GTIN / UPC lookup. Resolving by SKU recovers those.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prodBySku: Record<string, any> = {}
    const skus = [...new Set(ls.map((l: any) => String(l.sku || '').trim()).filter(Boolean))]
    if (skus.length) {
      const orFilter = skus.map((s: string) => `sku.ilike.${s.replace(/[,()]/g, '')}`).join(',')
      const { data: bySku } = await sb.from('products').select(PROD_COLS).or(orFilter)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;((bySku as any[]) || []).forEach((p: any) => { prodBySku[String(p.sku || '').toUpperCase()] = p })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rowsOut: PlanRow[] = ls.map((l: any) => {
      const prod = (l.product_id && prodMap[l.product_id]) || prodBySku[String(l.sku || '').toUpperCase()] || null
      // Cases = ordered quantity unless the line explicitly bundles units per case.
      // (product.case_qty is the retail count e.g. "1,000CT" — not a shipping case grouping.)
      const upc = l.qty_per_case || 1
      const units = l.quantity ?? l.qty ?? 0
      const gpu = prod?.weight_per_unit_grams || 0
      const cs = Math.max(1, Math.ceil(units / (upc || 1)))
      return {
        sku: l.sku || '(no sku)', description: l.description || prod?.product_name || '',
        units, unitsPerCase: upc || 1, cases: cs,
        caseWeightLb: +(((upc || 1) * gpu) / GRAMS_PER_LB).toFixed(2), gramsPerUnit: gpu,
        upc: prod?.upc_gtin || null, customerPart: prod?.customer_part_number || null, gtinImageUrl: prod?.gtin_image_url || null,
        uom: l.unit_of_measure || 'Case', packaging: l.packaging || '', done: l.quantity_shipped || l.completed_qty || 0,
        productId: l.product_id || null,
        boxLengthIn: 0, boxWidthIn: 0, boxHeightIn: 0,
      }
    })
    // Apply any saved SKU→GTIN overrides (covers SKUs that aren't in the inventory product list).
    try {
      const skuList = [...new Set(rowsOut.map(r => String(r.sku || '').trim().toUpperCase()).filter(Boolean))]
      if (skuList.length) {
        const { data: ov } = await sb.from('sku_gtin_overrides').select('sku, gtin_image_url').in('sku', skuList)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ovMap: Record<string, string> = {}; ((ov as any[]) || []).forEach((o: any) => { ovMap[String(o.sku).toUpperCase()] = o.gtin_image_url })
        for (const r of rowsOut) { if (!r.gtinImageUrl) { const u = ovMap[String(r.sku || '').trim().toUpperCase()]; if (u) r.gtinImageUrl = u } }
      }
    } catch { /* ignore */ }
    // Restore a saved draft (pallet configurations, parcel flag, BOL form) if one exists.
    try {
      const { data: od } = await sb.from('sales_orders').select('pack_draft').eq('id', item.sales_order_id).single()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const draft: any = (od as any)?.pack_draft
      if (draft && (Array.isArray(draft.configs) || Array.isArray(draft.lines))) {
        if (Array.isArray(draft.configs)) setConfigs(draft.configs as PalletConfig[])
        if (typeof draft.parcel === 'boolean') setParcel(draft.parcel)
        if (draft.shipMode === 'partial' || draft.shipMode === 'full') setShipMode(draft.shipMode)
        if (draft.bol) setBolForm(draft.bol)
        setPlan(rowsOut)
        if (Array.isArray(draft.configs) && draft.configs.length) { setDraftMsg('Draft restored'); setTimeout(() => setDraftMsg(''), 3000) }
        setBusy('')
        return
      }
    } catch { /* no draft / column — start fresh */ }
    setPlan(rowsOut); setBusy('')
  }

  // Save the current pack/ship progress so it can be resumed later.
  async function saveDraft(opts?: { silent?: boolean }) {
    if (!activeItem) return
    const hasProgress = configs.length > 0 || !!bolForm || parcel
    if (!hasProgress) return
    const draft = {
      savedAt: new Date().toISOString(),
      parcel,
      shipMode,
      configs,
      lines: plan.map(r => ({ sku: r.sku, cases: r.cases, unitsPerCase: r.unitsPerCase })),
      bol: bolForm,
    }
    try {
      await sb.from('sales_orders').update({ pack_draft: draft }).eq('id', activeItem.sales_order_id)
      if (!opts?.silent) { setDraftMsg('Draft saved ✓'); setTimeout(() => setDraftMsg(''), 2500) }
    } catch {
      if (!opts?.silent) { setDraftMsg('Could not save draft'); setTimeout(() => setDraftMsg(''), 2500) }
    }
  }

  // Editing packing after the BOL was reviewed/finalized invalidates it (labels must come from a fresh BOL).
  function invalidateBol() { if (finalized) setFinalized(false); if (bolForm) setBolForm(null) }

  function removeLine(i: number) {
    const sku = plan[i]?.sku
    setPlan(p => p.filter((_, idx) => idx !== i))
    if (sku) setConfigs(cs => cs.map(c => ({ ...c, contents: c.contents.filter(ct => ct.sku !== sku) })).filter(c => c.contents.length > 0))
    invalidateBol()
  }
  // Set total cases for a line (recomputes from units/case; carriers count each ordered unit as a case unless bundled).
  function setCases(i: number, v: number) {
    const cs = Math.max(1, v || 1)
    setPlan(p => p.map((r, idx) => idx === i ? { ...r, cases: cs } : r)); invalidateBol()
  }
  const fullCasesFor = (r: PlanRow) => Math.max(1, Math.ceil(Math.max(0, (r.units || 0) - (r.done || 0)) / (r.unitsPerCase || 1)))
  function chooseShipMode(mode: 'full' | 'partial') {
    setShipMode(mode)
    if (mode === 'full') { setPlan(p => p.map(r => ({ ...r, cases: fullCasesFor(r) }))); invalidateBol() }
  }
  function setUnitsPerCase(i: number, v: number) {
    setPlan(p => p.map((r, idx) => {
      if (idx !== i) return r
      const upc = Math.max(1, v || 1)
      const cs = Math.max(1, Math.ceil(r.units / upc))
      return { ...r, unitsPerCase: upc, cases: cs, caseWeightLb: r.gramsPerUnit ? +((upc * r.gramsPerUnit) / GRAMS_PER_LB).toFixed(2) : r.caseWeightLb }
    }))
    invalidateBol()
  }
  // Session-only line-item editors: UOM, ordered qty, box dimensions & box weight.
  function setUom(i: number, v: string) {
    setPlan(p => p.map((r, idx) => idx === i ? { ...r, uom: v } : r)); invalidateBol()
  }
  function setOrdered(i: number, v: number) {
    setPlan(p => p.map((r, idx) => idx === i ? { ...r, units: Math.max(0, v || 0) } : r)); invalidateBol()
  }
  function setBoxDim(i: number, key: 'boxLengthIn' | 'boxWidthIn' | 'boxHeightIn', v: number) {
    setPlan(p => p.map((r, idx) => idx === i ? { ...r, [key]: Math.max(0, v || 0) } : r)); invalidateBol()
  }
  function setBoxWeight(i: number, v: number) {
    setPlan(p => p.map((r, idx) => idx === i ? { ...r, caseWeightLb: Math.max(0, v || 0), gramsPerUnit: 0 } : r)); invalidateBol()
  }
  const boxDimsStr = (r: PlanRow) => dimsStr(r.boxLengthIn, r.boxWidthIn, r.boxHeightIn) || ''

  const activeItem = items.find(i => i.id === openId)
  const activeW = wItems.find(i => i.id === openW)
  const o = activeItem?.sales_orders
  const shipPrefillRef = useRef<string | null>(null)
  useEffect(() => {
    if (!openId) { shipPrefillRef.current = null; return }
    if (shipPrefillRef.current === openId) return
    const ord = items.find(i => i.id === openId)?.sales_orders
    if (!ord) return
    shipPrefillRef.current = openId
    setShipCarrier((ord.carrier as string | null) || '')
    setShipTracking((ord.tracking_number as string | null) || '')
  }, [openId, items])
  const st = o ? shipTo(o) : { name: '', addr: '' }

  // ---- Configurations → expanded pallets -----------------------------------
  const dimsStr = (l: number, w: number, h: number) => (l || w || h) ? `${l || 0}×${w || 0}×${h || 0} in` : ''
  const expanded: ExpandedPallet[] = useMemo(() => {
    const bySku = new Map(plan.map(r => [r.sku, r]))
    const out: ExpandedPallet[] = []
    let n = 0
    for (const cfg of configs) {
      for (let k = 0; k < Math.max(0, cfg.count); k++) {
        n++
        out.push({
          number: n, weightLb: cfg.weightLb, lengthIn: cfg.lengthIn, widthIn: cfg.widthIn, heightIn: cfg.heightIn,
          freightClass: cfg.freightClass, nmfc: cfg.nmfc, stackable: cfg.stackable, notes: cfg.notes,
          lines: cfg.contents.filter(c => (c.casesPerPallet || 0) > 0).map(c => {
            const r = bySku.get(c.sku)
            return { sku: c.sku, cases: c.casesPerPallet, unitsPerCase: r?.unitsPerCase || 1, description: r?.description || c.sku, upc: r?.upc || null, customerPart: r?.customerPart || null, gtinImageUrl: r?.gtinImageUrl || null, caseWeightLb: r?.caseWeightLb || 0 }
          }),
        })
      }
    }
    return out
  }, [configs, plan])

  const assignedBySku = useMemo(() => {
    const m: Record<string, number> = {}
    for (const cfg of configs) for (const c of cfg.contents) m[c.sku] = (m[c.sku] || 0) + Math.max(0, cfg.count) * (c.casesPerPallet || 0)
    return m
  }, [configs])
  const remainingForSku = (sku: string, cases: number) => cases - (assignedBySku[sku] || 0)
  const anyUnallocated = plan.some(r => remainingForSku(r.sku, r.cases) !== 0)

  const totals = {
    cases: expanded.reduce((a, p) => a + p.lines.reduce((s, l) => s + l.cases, 0), 0),
    pallets: expanded.length,
    weight: +(expanded.reduce((a, p) => a + (p.weightLb || 0), 0)).toFixed(0),
  }
  const anyPalletMissingWeight = expanded.some(p => !p.weightLb)

  // Config editor (pop-up) helpers
  function openConfig(cfg?: PalletConfig) {
    const nextId = configs.reduce((m, c) => Math.max(m, c.id), 0) + 1
    setCfgDraft(cfg ? { ...cfg, contents: cfg.contents.map(c => ({ ...c })) } : newConfig(nextId))
  }
  function saveConfig() {
    if (!cfgDraft) return
    const cleaned = { ...cfgDraft, count: Math.max(1, cfgDraft.count || 1), contents: cfgDraft.contents.filter(c => c.sku && (c.casesPerPallet || 0) > 0) }
    if (!cleaned.contents.length) { alert('Add at least one SKU with a case count to this pallet.'); return }
    setConfigs(cs => cs.some(c => c.id === cleaned.id) ? cs.map(c => c.id === cleaned.id ? cleaned : c) : [...cs, cleaned])
    setCfgDraft(null); invalidateBol()
  }
  function deleteConfig(id: number) { setConfigs(cs => cs.filter(c => c.id !== id)); invalidateBol() }
  function patchDraft(patch: Partial<PalletConfig>) { setCfgDraft(d => d ? { ...d, ...patch } : d) }
  function addContentRow() { setCfgDraft(d => d ? { ...d, contents: [...d.contents, { sku: plan[0]?.sku || '', casesPerPallet: 0 }] } : d) }
  function patchContent(idx: number, patch: Partial<PalletContent>) { setCfgDraft(d => d ? { ...d, contents: d.contents.map((c, i) => i === idx ? { ...c, ...patch } : c) } : d) }
  function removeContentRow(idx: number) { setCfgDraft(d => d ? { ...d, contents: d.contents.filter((_, i) => i !== idx) } : d) }

  // Auto-pack: one starting configuration per SKU (full pallets + a remainder). User edits from there.
  function autoPack() {
    const AUTO_CPP = 60
    let id = 0
    const next: PalletConfig[] = []
    for (const r of plan) {
      const left = remainingForSku(r.sku, r.cases) + (assignedBySku[r.sku] || 0) // = r.cases
      const total = r.cases
      if (total <= 0) continue
      const full = Math.floor(total / AUTO_CPP)
      const rem = total - full * AUTO_CPP
      if (full > 0) next.push({ ...newConfig(++id), count: full, heightIn: 60, contents: [{ sku: r.sku, casesPerPallet: AUTO_CPP }] })
      if (rem > 0) next.push({ ...newConfig(++id), count: 1, heightIn: 60, contents: [{ sku: r.sku, casesPerPallet: rem }] })
      void left
    }
    setConfigs(next); invalidateBol()
  }

  // ---- BOL review / preview / finalize -------------------------------------
  function buildBolLines(): BolLineForm[] {
    return expanded.map(p => {
      const cases = p.lines.reduce((a, l) => a + l.cases, 0)
      const dims = dimsStr(p.lengthIn, p.widthIn, p.heightIn)
      const body = p.lines.map(l => `${l.description || l.sku} — ${l.unitsPerCase}pcs/cs × ${l.cases}cs`).join('\n') || '(empty pallet)'
      const desc = [dims, body, p.stackable ? '' : 'Do not stack', p.notes].filter(Boolean).join('\n')
      return { palletId: p.number, handlingQty: 1, packageQty: cases, weight: p.weightLb, commodityDescription: desc, nmfcNumber: p.nmfc || '', freightClass: p.freightClass || '' }
    })
  }

  async function reviewBol() {
    if (!activeItem) return
    setBusy('bol')
    const orderValue = o?.total_amount || o?.total || o?.total_value || 0
    let fill = { nmfcNumber: '', freightClass: '', specialInstructions: 'DO NOT STACK' }
    try {
      const res = await fetch('/api/shipping/bol-fill', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productDescriptions: plan.map(p => p.description), totalPallets: totals.pallets, totalCases: totals.cases, totalWeight: totals.weight, orderValue }),
      })
      const j = await res.json(); if (!j.error) fill = { ...fill, ...j }
    } catch { /* fallback to defaults */ }
    const po = o?.po_number || ''
    const bolNumber = `BOL-${(o?.order_number || Date.now().toString()).replace(/[^0-9A-Za-z]/g, '').slice(0, 20)}`
    const si = ''   // blank by default — fill in per shipment
    const lines = buildBolLines().map(l => ({ ...l, nmfcNumber: l.nmfcNumber || fill.nmfcNumber || '', freightClass: l.freightClass || fill.freightClass || '' }))
    setBolForm({
      bolNumber, date: new Date().toLocaleDateString(), carrierName: o?.carrier || '', scac: '', freightTerms: '3rd Party',
      proNumber: '', trailerNo: '', sealNumber: '', poNumber: po, puNumber: po, loadNumber: po,
      shipFromName: SHIP_FROM_NAME, shipFromAddress: SHIP_FROM_ADDR, shipToName: st.name, shipToAddress: st.addr,
      specialInstructions: si, declaredValue: orderValue, lines,
    })
    setFinalized(false)
    setBusy('')
  }

  function formToData(f: BolForm): { data: BolData; lines: BolLine[] } {
    const lines: BolLine[] = f.lines.map((l, idx) => ({
      handlingQty: l.handlingQty, handlingType: 'Pallet', packageQty: l.packageQty, packageType: 'Case',
      weight: +(+l.weight).toFixed(0),
      commodityDescription: `Pallet ${idx + 1}: ${l.commodityDescription}`,
      nmfcNumber: l.nmfcNumber, freightClass: l.freightClass,
    }))
    if (f.poNumber) lines.push({ kind: 'note', commodityDescription: `All items listed as part of PO# ${f.poNumber}` })
    const data: BolData = {
      bolNumber: f.bolNumber, date: f.date, shipFromName: f.shipFromName, shipFromAddress: f.shipFromAddress,
      shipToName: f.shipToName, shipToAddress: f.shipToAddress, carrierName: f.carrierName, scac: f.scac, freightTerms: f.freightTerms,
      proNumber: f.proNumber, trailerNo: f.trailerNo, sealNumber: f.sealNumber,
      specialInstructions: f.specialInstructions.split('\n').filter(Boolean),
      totalPallets: f.lines.length, totalCases: f.lines.reduce((a, l) => a + (+l.packageQty || 0), 0),
      totalWeight: f.lines.reduce((a, l) => a + (+l.weight || 0), 0), declaredValue: f.declaredValue,
    }
    return { data, lines }
  }

  // Live PDF preview (debounced) whenever the BOL form changes.
  useEffect(() => {
    if (!bolForm) { if (prevUrlRef.current) { URL.revokeObjectURL(prevUrlRef.current); prevUrlRef.current = '' } setPreviewUrl(''); return }
    let cancelled = false
    const t = setTimeout(async () => {
      const logo = await loadImageDataUrl('/bG-logo-clean.png')
      if (cancelled) return
      const { data, lines } = formToData(bolForm)
      const url = String(buildBOL(data, lines, logo).output('bloburl'))
      if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current)
      prevUrlRef.current = url; setPreviewUrl(url)
    }, 450)
    return () => { cancelled = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bolForm])

  function updBolLine(i: number, patch: Partial<BolLineForm>) { setBolForm(f => f ? { ...f, lines: f.lines.map((l, idx) => idx === i ? { ...l, ...patch } : l) } : f) }
  function updBol(patch: Partial<BolForm>) { setBolForm(f => f ? { ...f, ...patch } : f) }

  async function finalizeBol() {
    if (!activeItem || !bolForm) return
    setBusy('finalize')
    const { data, lines } = formToData(bolForm)
    const logo = await loadImageDataUrl('/bG-logo-clean.png')
    buildBOL(data, lines, logo).save(`${bolForm.bolNumber}.pdf`)
    const payload = { configs, plan: plan.map(r => ({ sku: r.sku, description: r.description, cases: r.cases, unitsPerCase: r.unitsPerCase, upc: r.upc, customerPart: r.customerPart })), bol: bolForm }
    await sb.from('bols').insert({
      bol_number: bolForm.bolNumber, sales_order_id: activeItem.sales_order_id, carrier_name: bolForm.carrierName, scac: bolForm.scac,
      ship_from_name: bolForm.shipFromName, ship_from_address: bolForm.shipFromAddress, ship_to_name: bolForm.shipToName, ship_to_address: bolForm.shipToAddress,
      po_number: bolForm.poNumber || null, pu_number: bolForm.puNumber || null, load_number: bolForm.loadNumber || null,
      pro_number: bolForm.proNumber || null, trailer_no: bolForm.trailerNo || null, seal_number: bolForm.sealNumber || null,
      pallet_qty: data.totalPallets, case_qty: data.totalCases, weight: data.totalWeight, declared_value: bolForm.declaredValue,
      freight_terms: bolForm.freightTerms, special_instructions: bolForm.specialInstructions,
      commodity_description: bolForm.lines.map(l => l.commodityDescription).join(' | '),
      nmfc_number: bolForm.lines[0]?.nmfcNumber || null, freight_class: bolForm.lines[0]?.freightClass || null,
      status: 'Final', payload,
    })
    setFinalized(true); setBusy(''); loadBols(); markDoc('bol')
  }

  // ---- Labels (only after BOL finalized, or in parcel mode) -----------------
  const labelsUnlocked = finalized || parcel

  async function genCaseLabels() {
    setBusy('labels')
    const urls = [...new Set(plan.map(r => r.gtinImageUrl).filter(Boolean))] as string[]
    const map: Record<string, string> = {}
    // The GTIN image lives in a PRIVATE storage bucket, so its public URL 404s for the browser.
    // Download it through the authenticated session, then re-encode to PNG so jsPDF can embed it
    // (handles webp/jpeg too). Falls back to a UPC-generated barcode later if this can't be loaded.
    await Promise.all(urls.map(async u => {
      try {
        const m = u.match(/\/erp-images\/(.+)$/)
        let blob: Blob | null = null
        if (m) { const { data } = await sb.storage.from('erp-images').download(decodeURIComponent(m[1])); blob = (data as Blob) || null }
        if (!blob) { const res = await fetch(u); if (res.ok) blob = await res.blob() }
        if (!blob) return
        const obj = URL.createObjectURL(blob)
        const png = await loadBarcodePng(obj)
        URL.revokeObjectURL(obj)
        if (png) map[u] = png
      } catch { /* leave unmapped → barcode fallback */ }
    }))
    const cases: CaseLabel[] = []
    for (const r of plan) for (let n = 1; n <= r.cases; n++) cases.push({
      sku: r.sku, description: r.description, upcGtin: r.upc,
      gtinImageDataUrl: r.gtinImageUrl ? map[r.gtinImageUrl] || null : null,
      customerPartNumber: r.customerPart, vendorPartNumber: r.sku, caseNumber: n, totalCases: r.cases, unitsInCase: r.unitsPerCase,
    })
    const miss = missingUpcSkus(cases)
    if (miss.length) { setMissing(miss); setBusy(''); return }
    setMissing([])
    buildCaseLabels({ poNumber: bolForm?.poNumber || o?.po_number || '', shipToName: st.name, shipToAddress: st.addr }, cases).save(`case-labels-${o?.order_number || 'order'}.pdf`)
    setBusy(''); markDoc('caseLabels')
  }

  // Upload a GTIN barcode image for a SKU that is missing one. Used immediately for
  // this shipment's case labels AND written back to the Inventory board (products.gtin_image_url).
  async function uploadGtin(sku: string, file: File) {
    setBusy('gtin-' + sku)
    try {
      const safe = sku.replace(/[^A-Za-z0-9_-]/g, '') || 'sku'
      const path = `gtin/${safe}-${Date.now()}.png`
      const { error } = await sb.storage.from('erp-images').upload(path, file, { upsert: true, contentType: file.type || 'image/png' })
      if (error) throw error
      const url = sb.storage.from('erp-images').getPublicUrl(path).data.publicUrl
      // apply to every plan row with this SKU so the case labels can use it now
      setPlan(p => p.map(r => r.sku === sku ? { ...r, gtinImageUrl: url } : r))
      // write back to Inventory so it's available next time. Update by product id first; if that
      // matched no row (orphaned/mismatched id), fall back to a case-insensitive SKU match so the
      // GTIN reliably persists to the real product.
      const pid = plan.find(r => r.sku === sku)?.productId
      let saved = 0
      if (pid) { const { data } = await sb.from('products').update({ gtin_image_url: url }).eq('id', pid).select('id'); saved = (data as unknown[])?.length || 0 }
      if (!saved) { const { data } = await sb.from('products').update({ gtin_image_url: url }).ilike('sku', sku).select('id'); saved = (data as unknown[])?.length || 0 }
      // Persist a SKU→GTIN fallback so it sticks even when the SKU has no inventory product.
      try { await sb.from('sku_gtin_overrides').upsert({ sku: sku.trim().toUpperCase(), gtin_image_url: url, updated_at: new Date().toISOString() }) } catch { /* ignore */ }
      setMissing(m => m.filter(s => s !== sku))
    } catch (e) { alert('GTIN upload failed: ' + (e as Error).message) }
    setBusy('')
  }

  async function genPalletLabels() {
    // Save the shipping-docs snapshot and build a QR the pallet labels can carry,
    // so scanning a pallet in the field opens the packing slip + BOL (not the ERP).
    await ensureShipDocs()   // keep the shipping-docs snapshot for /ship-docs; no QR is printed on the label
    const labels: PalletLabel[] = expanded.map(p => ({ palletNumber: p.number, totalPallets: expanded.length, caseCount: p.lines.reduce((a, l) => a + l.cases, 0), weight: p.weightLb, skus: p.lines.map(l => l.sku), dims: dimsStr(p.lengthIn, p.widthIn, p.heightIn) || undefined }))
    buildPalletLabels({ poNumber: bolForm?.poNumber || o?.po_number || '', shipToName: st.name, shipToAddress: st.addr }, labels, null).save(`pallet-labels-${o?.order_number || 'order'}.pdf`)
    markDoc('palletLabels')
  }

  // Save the packed pallet layout (so it can be scanned to completion) and print
  // one QR pick ticket per pallet. Each pallet gets a unique scan token.
  async function genPickTickets() {
    if (!activeItem) return
    const active = expanded.filter(p => p.lines.reduce((a, l) => a + l.cases, 0) > 0)
    if (active.length === 0) { alert('Add at least one pallet configuration (with contents) before printing pick tickets.'); return }
    const soId = activeItem.sales_order_id
    try {
      const totalPallets = active.length
      await sb.from('shipment_cases').delete().eq('sales_order_id', soId)
      await sb.from('shipment_pallets').delete().eq('sales_order_id', soId)
      const ticketPallets: PickTicketPallet[] = []
      let idx = 0
      for (const p of active) {
        idx++
        const token = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const pLines = p.lines.map(l => ({ sku: l.sku, productName: l.description || l.sku, cases: l.cases, unitsPerCase: l.unitsPerCase, units: l.cases * l.unitsPerCase }))
        const caseCount = pLines.reduce((s, l) => s + l.cases, 0)
        const totalUnits = pLines.reduce((s, l) => s + l.units, 0)
        const palletId = `PLT-${(o?.order_number || 'ORD').replace(/\s/g, '')}-${String(idx).padStart(2, '0')}`
        const { data: pRow, error: pErr } = await sb.from('shipment_pallets').insert({
          sales_order_id: soId, pallet_number: idx, total_pallets: totalPallets,
          sscc: palletId, case_count: caseCount, weight: Math.round(p.weightLb || 0), pick_token: token,
        }).select('id').single()
        if (pErr) throw pErr
        const palletDbId = (pRow as { id: string } | null)?.id
        if (palletDbId) {
          let caseNo = 1
          for (const l of pLines) {
            await sb.from('shipment_cases').insert({
              sales_order_id: soId, pallet_id: palletDbId, sku: l.sku, description: l.productName,
              case_number: caseNo, total_cases: l.cases, units_in_case: l.unitsPerCase,
            })
            caseNo += l.cases
          }
        }
        ticketPallets.push({ palletNumber: idx, totalPallets, palletId, token, lines: pLines, totalCases: caseCount, totalUnits })
      }
      generatePickTickets({
        shipTo: { name: st.name, address1: st.addr },
        orderNumber: o?.order_number || undefined,
        poNumber: o?.po_number || undefined,
        scanBaseUrl: window.location.origin,
        pallets: ticketPallets,
      })
    } catch (e) {
      alert('Failed to save pallets: ' + ((e as Error).message || 'unknown error'))
    }
  }

  // Aggregate packing by SKU. Each pallet's manually-entered total weight is
  // allocated to its SKUs by case share, so every line shows a real weight even
  // when per-unit product weights aren't on file. Shared by the packing-list PDF
  // and the public shipping-docs snapshot.
  function buildPackListCases(): PackListCase[] {
    const bySku = new Map<string, PackListCase>()
    // Per-SKU line metadata (UOM, ordered qty in the UOM, box size & weight) from the plan.
    const meta: Record<string, { uom: string; ordered: number; dims: string; boxWt: number }> = {}
    const orderedBySku: Record<string, number> = {}
    plan.forEach(r => {
      const k = r.sku || r.description
      orderedBySku[k] = (orderedBySku[k] || 0) + Math.max(1, Math.ceil((r.units || 0) / (r.unitsPerCase || 1)))
      const m = meta[k] || { uom: r.uom || 'Case', ordered: 0, dims: boxDimsStr(r), boxWt: r.caseWeightLb || 0 }
      m.ordered += r.units || 0
      if (!m.dims) m.dims = boxDimsStr(r)
      if (!m.boxWt) m.boxWt = r.caseWeightLb || 0
      meta[k] = m
    })
    expanded.forEach(p => {
      const palletCases = p.lines.reduce((a, l) => a + l.cases, 0)
      p.lines.forEach(l => {
        const perCaseWt = l.caseWeightLb || 0
        const allocWt = perCaseWt > 0
          ? l.cases * perCaseWt
          : (palletCases > 0 ? (p.weightLb || 0) * (l.cases / palletCases) : 0)
        const cur: PackListCase = bySku.get(l.sku) || { sku: l.sku, description: l.description, caseCount: 0, casesOrdered: orderedBySku[l.sku] || 0, unitsInCase: l.unitsPerCase, weight: 0 }
        cur.caseCount += l.cases
        cur.weight = (cur.weight || 0) + allocWt
        bySku.set(l.sku, cur)
      })
    })
    // Fallback: no pallet configuration yet — build the item list straight from the
    // order line items so the packing list always lists the products being shipped.
    if (bySku.size === 0) {
      plan.forEach(r => {
        if (!r.sku && !r.description) return
        const key = r.sku || r.description
        const cur: PackListCase = bySku.get(key) || { sku: r.sku || '', description: r.description, caseCount: 0, casesOrdered: 0, unitsInCase: r.unitsPerCase, weight: 0, units: 0 }
        cur.caseCount += r.cases
        cur.casesOrdered = (cur.casesOrdered || 0) + Math.max(1, Math.ceil((r.units || 0) / (r.unitsPerCase || 1)))
        cur.units = (cur.units || 0) + (r.units || 0)
        cur.weight = (cur.weight || 0) + (r.caseWeightLb || 0) * r.cases
        bySku.set(key, cur)
      })
    }
    // Attach UOM / ordered / shipped (in UOM) / box size & weight to each line.
    return [...bySku.entries()].map(([key, c]) => {
      const m = meta[key] || meta[c.sku] || { uom: 'Case', ordered: 0, dims: '', boxWt: 0 }
      const upc = c.unitsInCase || 1
      return {
        ...c,
        uom: m.uom || 'Case',
        orderedUnits: m.ordered || c.units || (c.caseCount * upc),
        shippedUnits: c.caseCount * upc,
        boxDims: m.dims || undefined,
        boxWeight: m.boxWt || undefined,
      }
    })
  }

  function packMeta() {
    return { poNumber: o?.po_number || '', orderNumber: o?.order_number || '', shipToName: st.name, shipToAddress: st.addr, shipFromName: SHIP_FROM_NAME, shipFromAddress: SHIP_FROM_ADDR, date: new Date().toLocaleDateString(), partialCaption: shipMode === 'partial' ? `PARTIAL SHIPMENT #${priorShipments + 1} of ____` : '' }
  }
  function packListPallets() {
    return expanded.map(p => ({
      number: p.number,
      dims: dimsStr(p.lengthIn, p.widthIn, p.heightIn) || undefined,
      weight: p.weightLb,
      lines: p.lines.map(l => ({ sku: l.sku, description: l.description, cases: l.cases, units: l.cases * l.unitsPerCase })),
    }))
  }

  // Save a public snapshot (packing-slip + BOL inputs) under a per-order token so
  // the pallet-label QR can open just those two documents — no ERP access, no
  // order internals beyond what's already printed on the shipping paperwork.
  async function ensureShipDocs(): Promise<string | null> {
    if (!activeItem) return null
    const snapshot = {
      savedAt: new Date().toISOString(),
      orderNumber: o?.order_number || '',
      customer: st.name,
      packing: { meta: packMeta(), cases: buildPackListCases(), totals },
      bol: bolForm ? formToData(bolForm) : null,
    }
    try {
      const { data: od } = await sb.from('sales_orders').select('docs_token').eq('id', activeItem.sales_order_id).single()
      const token: string = ((od as { docs_token?: string } | null)?.docs_token)
        || ((typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)
      await sb.from('sales_orders').update({ docs_token: token, ship_docs: snapshot }).eq('id', activeItem.sales_order_id)
      return token
    } catch {
      return null
    }
  }

  function genPackingList() {
    if (!activeItem) return
    const cases = buildPackListCases()
    const meta = packMeta()
    const plts = packListPallets()
    const listTotals = plts.length > 0 ? totals : {
      cases: cases.reduce((a, c) => a + (c.caseCount || 0), 0),
      pallets: 0,
      weight: Math.round(cases.reduce((a, c) => a + (c.weight || 0), 0)),
    }
    loadImageDataUrl('/bG-logo-clean.png').then(logo => buildPackingList(meta, cases, listTotals, logo, plts).save(`packing-list-${o?.order_number || 'order'}.pdf`))
      .catch(() => buildPackingList(meta, cases, listTotals, null, plts).save(`packing-list-${o?.order_number || 'order'}.pdf`))
    markDoc('packingList')
  }

  // ── Close out & move to shipments ─────────────────────────────────────────
  async function markDoc(key: string) {
    if (!activeItem) return
    const next = { ...shipPrep, [key]: true }
    setShipPrep(next)
    try { await sb.from('sales_orders').update({ ship_prep: next }).eq('id', activeItem.sales_order_id) } catch { /* */ }
  }
  const requiredDocs = parcel ? ['packingList', 'caseLabels'] : ['bol', 'packingList', 'palletLabels', 'caseLabels']
  const canMove = true // documents are optional — shipping no longer requires labels/BOL

  function startCloseout() { setCoShipId((typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString()); setCoSlipUrl(''); setCoBolUrl(''); setCoPhotos([]); setCoSummary(''); setCoBusy(''); setCloseout(true) }

  async function uploadDoc(file: File, kind: 'slip' | 'bol') {
    setCoBusy(kind)
    try {
      const path = `shipping/${coShipId}/${kind}-${Date.now()}-${file.name}`
      const { error } = await sb.storage.from('erp-files').upload(path, file, { upsert: true })
      if (error) throw error
      const { data } = sb.storage.from('erp-files').getPublicUrl(path)
      await sb.from('file_attachments').insert({ record_type: 'shipment', record_id: coShipId, file_name: file.name, file_size: file.size, file_type: file.type, storage_path: path, uploaded_by: userEmail })
      if (kind === 'slip') setCoSlipUrl(data.publicUrl); else setCoBolUrl(data.publicUrl)
    } catch (e) { alert('Upload failed: ' + (e as Error).message) }
    setCoBusy('')
  }
  async function uploadPhoto(file: File, type: string) {
    setCoBusy('photo')
    try {
      const path = `shipping/${coShipId}/${type}-${Date.now()}.jpg`
      const { error } = await sb.storage.from('erp-images').upload(path, file, { upsert: true })
      if (error) throw error
      const { data } = sb.storage.from('erp-images').getPublicUrl(path)
      await sb.from('file_attachments').insert({ record_type: 'shipment', record_id: coShipId, file_name: `${type}.jpg`, file_size: file.size, file_type: file.type, storage_path: path, uploaded_by: userEmail })
      setCoPhotos(p => [...p, { url: data.publicUrl, type }])
    } catch (e) { alert('Upload failed: ' + (e as Error).message) }
    setCoBusy('')
  }
  async function genSummary() {
    setCoBusy('ai')
    try {
      const res = await fetch('/api/shipping/ship-summary', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNumber: o?.order_number, poNumber: o?.po_number, customer: st.name, carrier: o?.carrier, bolNumber: bolForm?.bolNumber, totalPallets: totals.pallets, totalCases: totals.cases, totalWeight: totals.weight, photoUrls: coPhotos.map(p => p.url), docNames: [coSlipUrl && 'Signed Packing Slip', coBolUrl && 'Signed BOL'].filter(Boolean) }),
      })
      const j = await res.json(); setCoSummary(j.summary || '')
    } catch { setCoSummary('') }
    setCoBusy('')
  }
  const needBolDoc = !parcel && !!shipPrep.bol
  const canConfirm = true // photos & signed docs are optional — attach if you want, but not required

  async function createShipment(extra: Record<string, unknown>) {
    if (!activeItem || !o) return
    const now = new Date()
    // NOTE: shipped_at is a generated column (= ship_date) — do NOT insert it (Postgres rejects it).
    const { error: shipErr } = await sb.from('shipments').insert({
      id: coShipId || undefined, sales_order_id: activeItem.sales_order_id, order_id: activeItem.sales_order_id,
      customer_name: st.name, po_number: o.po_number || null,
      carrier: (shipCarrier || o.carrier) || null, tracking_number: (shipTracking || o.tracking_number) || null,
      ship_cost: shipCost ? parseFloat(shipCost) : null, broker_cost: shipBrokerCost ? parseFloat(shipBrokerCost) : null,
      ship_date: now.toISOString().slice(0, 10), order_date: o.order_date || null,
      total_value: o.total_amount ?? o.total ?? o.total_value ?? null, ship_to_address: st.addr || null,
      bol_number: bolForm?.bolNumber || null, packing_slip_url: coSlipUrl || null, pod_file_url: coBolUrl || null,
      month_group: now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      ...extra,
    })
    if (shipErr) throw new Error(shipErr.message)
    const targetId = coShipId || (extra.id as string)
    if (targetId) {
      // Consolidate the order's comments + attachments onto the shipment (handle both singular/plural record_type conventions)
      await sb.from('comments').update({ record_type: 'shipment', record_id: targetId }).in('record_type', ['sales_order', 'sales_orders']).eq('record_id', activeItem.sales_order_id)
      await sb.from('file_attachments').update({ record_type: 'shipment', record_id: targetId }).in('record_type', ['sales_order', 'sales_orders']).eq('record_id', activeItem.sales_order_id)
    }
  }
  async function confirmMove() {
    if (!canConfirm || !activeItem) return
    setCoBusy('move')
    try {
      await createShipment({ id: coShipId, delivery_status: 'Shipped', status: 'Shipped', ai_summary: coSummary || null })
      await sb.from('sales_orders').update({ status: 'Shipped', carrier: (shipCarrier || o?.carrier) || null, tracking_number: (shipTracking || o?.tracking_number) || null }).eq('id', activeItem.sales_order_id)
    } catch (e) { alert('Move failed: ' + (e as Error).message); setCoBusy(''); return }
    setOpenId(null); resetPackState(); load()
  }
  async function doOverride() {
    if (!activeItem) return
    const pw = window.prompt('Enter the Shipped Override password:')
    if (pw == null || !pw) return
    const { data: ok } = await sb.rpc('verify_ship_override', { pw })
    if (!ok) { alert('Incorrect password.'); return }
    setBusy('override')
    try {
      const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString()
      await createShipment({ id, delivery_status: 'Shipped', status: 'Shipped', ai_summary: 'Manually marked shipped via override — closeout documents not attached.' })
      await sb.from('sales_orders').update({ status: 'Shipped', carrier: (shipCarrier || o?.carrier) || null, tracking_number: (shipTracking || o?.tracking_number) || null }).eq('id', activeItem.sales_order_id)
    } catch (e) { alert('Override failed: ' + (e as Error).message); setBusy(''); return }
    setBusy(''); setOpenId(null); resetPackState(); load()
  }
  async function doCancel() {
    if (!activeItem) return
    const reason = window.prompt('Reason for cancellation (required):')
    if (reason == null) return
    if (!reason.trim()) { alert('A cancellation reason is required.'); return }
    setBusy('cancel')
    try {
      const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString()
      await createShipment({ id, delivery_status: 'Cancelled', status: 'Cancelled', cancel_reason: reason.trim(), month_group: 'Cancelled' })
      await sb.from('sales_orders').update({ status: 'Cancelled' }).eq('id', activeItem.sales_order_id)
    } catch (e) { alert('Cancel failed: ' + (e as Error).message); setBusy(''); return }
    setBusy(''); setOpenId(null); resetPackState(); load()
  }

  async function mergeMaster() {
    const chosen = bols.filter(b => sel[b.id])
    if (chosen.length < 2) { alert('Select at least two BOLs to merge.'); return }
    setBusy('master')
    const lines: BolLine[] = chosen.map(b => ({ handlingQty: b.pallet_qty || 0, handlingType: 'Pallet', packageQty: b.case_qty || 0, packageType: 'Case', weight: b.weight || 0, commodityDescription: `${b.commodity_description || 'Disposable Cutlery'} — PO# ${b.po_number || ''}` }))
    const totalPallets = chosen.reduce((a, b) => a + (b.pallet_qty || 0), 0)
    const totalCases = chosen.reduce((a, b) => a + (b.case_qty || 0), 0)
    const totalWeight = +(chosen.reduce((a, b) => a + (b.weight || 0), 0)).toFixed(2)
    const declared = +(chosen.reduce((a, b) => a + (b.declared_value || 0), 0)).toFixed(2)
    const masterNumber = `Master-${Date.now().toString().slice(-8)}`
    const data: BolData = {
      isMaster: true, bolNumber: masterNumber, date: new Date().toLocaleDateString(), shipFromName: SHIP_FROM_NAME, shipFromAddress: SHIP_FROM_ADDR,
      shipToName: chosen[0].ship_to_name || 'Consolidation', shipToAddress: '', carrierName: '', scac: '', freightTerms: '3rd Party',
      specialInstructions: [], totalPallets, totalCases, totalWeight, declaredValue: declared,
    }
    const logo = await loadImageDataUrl('/bG-logo-clean.png')
    buildMasterBOL(data, lines, logo).save(`${masterNumber}.pdf`)
    const { data: mb } = await sb.from('master_bols').insert({
      master_bol_number: masterNumber, carrier_name: data.carrierName, scac: data.scac, ship_to_name: data.shipToName,
      total_pallets: totalPallets, total_cases: totalCases, total_weight: totalWeight, declared_value: declared, status: 'Draft',
    }).select().single()
    if (mb) await sb.from('master_bol_bols').insert(chosen.map(b => ({ master_bol_id: mb.id, bol_id: b.id })))
    setBusy(''); setSel({})
  }

  const btn = 'text-xs font-semibold px-3 py-2 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
  const num = 'w-16 border rounded px-1 py-0.5 text-right text-xs'
  const inp = 'w-full border rounded px-2 py-1 text-xs'

  const visible = items.filter(it => {
    if (statusFilter !== 'All' && it.status !== statusFilter) return false
    if (!query.trim()) return true
    const q = query.toLowerCase()
    const io = it.sales_orders
    return [io?.order_number, io?.po_number, io?.customers?.company_name].some(v => (v || '').toString().toLowerCase().includes(q))
  })
  const wVisible = wItems.filter(it => {
    if (statusFilter !== 'All' && it.status !== statusFilter) return false
    if (!query.trim()) return true
    const q = query.toLowerCase()
    const w = it.w
    return [w?.name, w?.po_number, w?.ship_to].some(v => (v || '').toString().toLowerCase().includes(q))
  })

  const photoSlots: { type: string; label: string; req: boolean }[] = parcel
    ? [{ type: 'package', label: 'Sealed package', req: true }, { type: 'shipping_label', label: 'Shipping label', req: true }, { type: 'other', label: 'Other', req: false }]
    : [{ type: 'packed_pallet', label: 'Packed pallet(s)', req: true }, { type: 'shipping_label', label: 'Pallet / shipping label', req: true }, { type: 'sealed_cases', label: 'Sealed cases', req: true }, { type: 'bol_document', label: 'BOL on shipment', req: true }, { type: 'truck_loaded', label: 'Loaded on truck', req: false }]

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <div>
          <span className="mon-tag">📦 Shipping</span>
          <h1 className="text-2xl font-bold mt-1.5">Shipping Queue</h1>
        </div>
        <button onClick={() => setShowMaster(s => !s)} className={`${btn} bg-indigo-600 text-white border-indigo-600`}>{showMaster ? 'Hide' : 'Merge BOLs → Master BOL'}</button>
      </div>
      <p className="text-xs text-gray-400 mb-2">Live from the Sales Order &amp; Walmart boards — showing orders in <b className="text-[#00863F]">In Production</b>, <b className="text-[#00863F]">Ready to Ship</b>, <b className="text-[#00863F]">Ready at Will Call</b>, or <b className="text-[#00863F]">Partially Shipped</b>.</p>
      <div className="mb-4 rounded-lg bg-[#10B981]/10 border border-[#10B981]/25 text-[12px] text-[#0f7a5a] px-3 py-2">🔗 Inventory-linked (Ultron). Line items and SKUs pull live from the Inventory board. Statuses are unified with the Sales Order board, and comments sync both ways between this queue and the Sales / Walmart boards.</div>

      {/* Search + filter */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search order #, PO #, or customer…" className="flex-1 min-w-[220px] border rounded-lg px-3 py-2 text-sm" />
        <span className="text-xs text-gray-400">{visible.length + wVisible.length} of {items.length + wItems.length}</span>
      </div>

      {showMaster && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-sm font-semibold mb-2">Generated BOLs — select to merge</p>
          {bols.length === 0 ? <p className="text-xs text-gray-400">No draft BOLs yet.</p> : (
            <div className="space-y-1">
              {bols.map(b => (
                <label key={b.id} className="flex items-center gap-3 text-xs py-1.5 border-b border-gray-100">
                  <input type="checkbox" checked={!!sel[b.id]} onChange={e => setSel(s => ({ ...s, [b.id]: e.target.checked }))} />
                  <span className="font-mono font-semibold w-40 truncate">{b.bol_number}</span>
                  <span className="flex-1 text-gray-500 truncate">PO {b.po_number || '—'} · {b.ship_to_name}</span>
                  <span className="text-gray-500">{b.pallet_qty} PLT · {b.case_qty} CS · {b.weight} lb</span>
                </label>
              ))}
              <button onClick={mergeMaster} disabled={busy === 'master'} className={`${btn} bg-emerald-600 text-white border-emerald-600 mt-3`}>{busy === 'master' ? 'Merging…' : 'Generate Master BOL'}</button>
            </div>
          )}
        </div>
      )}

      {loading ? <p className="text-gray-400">Loading…</p> : (visible.length + wVisible.length) === 0 ? <p className="text-gray-400">No matching orders.</p> : (
        <div className="space-y-3">
          {SHIPPABLE.map(g => {
            const gSales = visible.filter(it => it.status === g)
            const gW = wVisible.filter(it => it.status === g)
            if (gSales.length + gW.length === 0) return null
            const gc = statusColor(g); const isCol = collapsed[g]
            return (
              <div key={g} className="bg-white rounded-xl overflow-hidden shadow-sm border border-[#ECEEF3]">
                <div onClick={() => setCollapsed(c => ({ ...c, [g]: !c[g] }))} className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none sticky top-0 z-30 rounded-t-xl" style={{ background: gc.bg, borderLeft: '5px solid ' + gc.solid }}>
                  <span className="text-[10px]" style={{ color: gc.solid, display: 'inline-block', transform: isCol ? 'none' : 'rotate(90deg)' }}>&#9654;</span>
                  <span className="font-bold text-sm" style={{ color: gc.fg }}>{g}</span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: gc.solid + '26', color: gc.fg }}>{gSales.length + gW.length}</span>
                </div>
                {!isCol && (
                <div className="p-2 space-y-2">
                  {gSales.map(item => {
            const io = item.sales_orders; const open = openId === item.id
            return (
              <div key={item.id} className="rounded-xl border border-gray-200 bg-white shadow-sm mon-row">
                <button onClick={() => openOrder(item)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#1A1D2E] truncate">{io?.order_number || '—'}</p>
                    <p className="text-xs text-gray-500 truncate">{io?.customers?.company_name || ''}{io?.po_number ? ' · PO ' + io?.po_number : ''}</p>
                  </div>
                  <span className="hidden sm:inline-flex">{(() => { const c = statusColor(item.status); return (
                    <span className="mon-pill" style={{ background: c.bg, color: c.fg }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: c.solid }} />{item.status}</span>
                  ) })()}</span>
                  <span className="text-xs text-gray-500 w-24 text-right hidden sm:block">{io?.required_ship_date || ''}</span>
                  <span className="mon-btn !py-1.5 !px-3 whitespace-nowrap shrink-0">{open ? 'Close' : (<><span className="sm:hidden">🚚 Ship</span><span className="hidden sm:inline">🚚 Pack &amp; Ship</span></>)}</span>
                </button>

                {open && (
                  <div className="mon-backdrop" onClick={() => { saveDraft({ silent: true }); setOpenId(null); resetPackState() }}>
                   <div className="mon-modal" style={{ maxWidth: 1000 }} onClick={e => e.stopPropagation()}>
                    <div className="mon-modal-head">
                      <div className="min-w-0">
                        <h2 className="text-lg truncate">{io?.order_number || 'Order'}</h2>
                        <p className="text-white/80 text-xs mt-0.5 truncate">{io?.customers?.company_name || ''}{io?.po_number ? ' · PO ' + io?.po_number : ''}</p>
                        {(() => { const c = statusColor(item.status); return (
                          <span className="mon-pill mt-2" style={{ background: c.bg, color: c.fg }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: c.solid }} />{item.status}</span>
                        ) })()}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {draftMsg && <span className="text-white/90 text-xs font-medium whitespace-nowrap">{draftMsg}</span>}
                        <button onClick={() => saveDraft()} className="text-xs font-semibold text-white/90 hover:text-white border border-white/30 hover:border-white/60 bg-white/10 px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap">💾 Save Draft</button>
                        <button onClick={() => { saveDraft({ silent: true }); setOpenId(null); resetPackState() }} className="mon-modal-close" aria-label="Close">×</button>
                      </div>
                    </div>
                    <div className="mon-modal-body bg-[#E9ECF2]">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-xs mb-4">
                      <div><span className="text-gray-400 block">Customer</span>{o?.customers?.company_name || '—'}</div>
                      <div><span className="text-gray-400 block">PO #</span>{o?.po_number || '—'}</div>
                      <div><span className="text-gray-400 block">Status</span>{item.status}</div>
                      <div><span className="text-gray-400 block">Order Value</span>{fmtMoney(o?.total_amount ?? o?.total ?? o?.total_value)}</div>
                      <div><span className="text-gray-400 block">Order Date</span>{o?.order_date || '—'}</div>
                      <div><span className="text-gray-400 block">Req. Ship Date</span>{o?.required_ship_date || '—'}</div>
                      <div><span className="text-gray-400 block">Carrier</span>{o?.carrier || '—'}</div>
                      <div className="col-span-2 md:col-span-1"><span className="text-gray-400 block">Ship To</span>{st.name}</div>
                    </div>
                    {o?.shipping_address && <div className="text-xs text-gray-500 mb-3 whitespace-pre-line"><span className="text-gray-400">Address: </span>{st.addr}</div>}
                    {o?.additional_comments && <div className="text-xs bg-amber-50 border-l-4 border-amber-300 p-2 mb-3 whitespace-pre-line"><b>Notes:</b> {o.additional_comments}</div>}

                    {busy === 'load' ? <p className="text-xs text-gray-400">Loading order…</p> : plan.length === 0 ? <p className="text-xs text-gray-400">No line items found on this order.</p> : (
                      <>
                        {/* Ship Full / Ship Partial */}
                        <div className="rounded-xl border border-gray-200 bg-white p-3 mb-3 shadow-sm flex flex-wrap items-center gap-3">
                          <span className="text-sm font-semibold text-[#1A1D2E]">Shipment type</span>
                          <div className="inline-flex rounded-lg overflow-hidden border border-gray-300">
                            <button onClick={() => chooseShipMode('full')} className={`px-3 py-1.5 text-sm font-semibold ${shipMode === 'full' ? 'bg-[#00863F] text-white' : 'bg-white text-gray-600'}`}>Ship Full</button>
                            <button onClick={() => chooseShipMode('partial')} className={`px-3 py-1.5 text-sm font-semibold border-l border-gray-300 ${shipMode === 'partial' ? 'bg-amber-500 text-white' : 'bg-white text-gray-600'}`}>Ship Partial</button>
                          </div>
                          {shipMode === 'partial'
                            ? <span className="text-xs text-amber-600">Partial shipment #{priorShipments + 1} — lower each SKU&apos;s case target below; the packing list is marked partial.</span>
                            : <span className="text-xs text-gray-400">Every SKU is set to its full remaining quantity.</span>}
                        </div>
                        {/* STEP 0 — Line items: UOM, units per case, ordered, box size & weight (session only) */}
                        <div className="rounded-xl border border-gray-200 bg-white p-4 mb-3 shadow-sm">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="w-6 h-6 rounded-full bg-indigo-50 text-indigo-600 text-xs flex items-center justify-center font-semibold shrink-0">✎</span>
                            <span className="text-sm font-semibold text-[#1A1D2E]">Line items</span>
                            <span className="ml-auto text-[11px] text-gray-400">Set the UOM, how many go in a case, and each box&apos;s size &amp; weight — the packing list uses these.</span>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs min-w-[840px]">
                              <thead>
                                <tr className="text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-200">
                                  <th className="text-left font-semibold px-2 py-1.5">SKU</th>
                                  <th className="text-left font-semibold px-2 py-1.5">Description</th>
                                  <th className="text-left font-semibold px-2 py-1.5 w-[84px]">UOM</th>
                                  <th className="text-right font-semibold px-2 py-1.5 w-[74px]">Units / Case</th>
                                  <th className="text-right font-semibold px-2 py-1.5 w-[70px]">Ordered</th>
                                  <th className="text-right font-semibold px-2 py-1.5 w-[62px]">Cases</th>
                                  <th className="text-right font-semibold px-2 py-1.5 w-[66px]">Shipped</th>
                                  <th className="text-center font-semibold px-2 py-1.5 w-[160px]">Box L×W×H (in)</th>
                                  <th className="text-right font-semibold px-2 py-1.5 w-[70px]">Box Wt</th>
                                </tr>
                              </thead>
                              <tbody>
                                {plan.map((r, i) => (
                                  <tr key={i} className="border-b border-gray-100">
                                    <td className="px-2 py-1.5 font-mono text-[#1A1D2E] whitespace-nowrap">{r.sku}{r.upc ? '' : ' ⚠'}</td>
                                    <td className="px-2 py-1.5 text-gray-500 max-w-[220px] truncate" title={r.description}>{r.description || '—'}</td>
                                    <td className="px-2 py-1.5"><input list="uom-options" value={r.uom} onChange={e => setUom(i, e.target.value)} className="w-full rounded border border-gray-300 px-1.5 py-1" /></td>
                                    <td className="px-2 py-1.5"><input type="number" min={1} value={r.unitsPerCase} onChange={e => setUnitsPerCase(i, parseInt(e.target.value) || 1)} className="w-full text-right rounded border border-gray-300 px-1.5 py-1" /></td>
                                    <td className="px-2 py-1.5"><input type="number" min={0} value={r.units} onChange={e => setOrdered(i, parseInt(e.target.value) || 0)} className="w-full text-right rounded border border-gray-300 px-1.5 py-1" /></td>
                                    <td className="px-2 py-1.5"><input type="number" min={1} value={r.cases} onChange={e => setCases(i, parseInt(e.target.value) || 1)} className="w-full text-right rounded border border-gray-300 px-1.5 py-1" /></td>
                                    <td className="px-2 py-1.5 text-right text-gray-600 font-semibold">{r.cases * r.unitsPerCase}</td>
                                    <td className="px-2 py-1.5">
                                      <div className="flex items-center gap-1">
                                        <input type="number" min={0} value={r.boxLengthIn || ''} placeholder="L" onChange={e => setBoxDim(i, 'boxLengthIn', parseFloat(e.target.value) || 0)} className="w-full text-center rounded border border-gray-300 px-1 py-1" />
                                        <span className="text-gray-300">×</span>
                                        <input type="number" min={0} value={r.boxWidthIn || ''} placeholder="W" onChange={e => setBoxDim(i, 'boxWidthIn', parseFloat(e.target.value) || 0)} className="w-full text-center rounded border border-gray-300 px-1 py-1" />
                                        <span className="text-gray-300">×</span>
                                        <input type="number" min={0} value={r.boxHeightIn || ''} placeholder="H" onChange={e => setBoxDim(i, 'boxHeightIn', parseFloat(e.target.value) || 0)} className="w-full text-center rounded border border-gray-300 px-1 py-1" />
                                      </div>
                                    </td>
                                    <td className="px-2 py-1.5"><input type="number" min={0} step="0.1" value={r.caseWeightLb || ''} placeholder="lb" onChange={e => setBoxWeight(i, parseFloat(e.target.value) || 0)} className="w-full text-right rounded border border-gray-300 px-1.5 py-1" /></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <datalist id="uom-options">
                              <option value="Case" /><option value="Pack" /><option value="Each" /><option value="Bag" /><option value="Box" /><option value="Roll" /><option value="Set" /><option value="Carton" /><option value="Pallet" />
                            </datalist>
                          </div>
                          <p className="text-[11px] text-gray-400 mt-2">Example: UOM <b>Pack</b>, Units/Case <b>20</b>, Ordered <b>200</b> → 200 packs = <b>10 cases</b>. &ldquo;Shipped&rdquo; = Cases × Units/Case. These apply to this packing list only.</p>
                        </div>

                        {/* STEP 1 — Build the pallets (freight configurations) */}
                        <div className="rounded-xl border border-gray-200 bg-white p-4 mb-3 shadow-sm">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="w-6 h-6 rounded-full bg-indigo-50 text-indigo-600 text-xs flex items-center justify-center font-semibold shrink-0">1</span>
                            <span className="text-sm font-semibold text-[#1A1D2E]">Build the pallets</span>
                            <span className="ml-auto text-xs text-gray-400">{totals.pallets} pallet{totals.pallets !== 1 ? 's' : ''} · {totals.cases} cases · {totals.weight} lb</span>
                            <button onClick={autoPack} className={`${btn} bg-violet-600 text-white border-violet-600`} title="Generate a starting configuration per SKU">✨ Auto-pack</button>
                          </div>
                          <p className="text-xs text-gray-500 mb-3">Add a pallet and choose which SKU(s) go on it &mdash; you pick, nothing is auto-assigned. Put 2 or 3 SKUs on one pallet for a mixed pallet. Set &ldquo;# of pallets&rdquo; above 1 only if several pallets are identical. (&#10024; Auto-pack is an optional shortcut.)</p>

                          {/* Per-SKU allocation tracker */}
                          <div className="flex flex-wrap gap-1.5 mb-3">
                            {plan.map((r, i) => {
                              const rem = remainingForSku(r.sku, r.cases)
                              const done = rem === 0
                              return (
                                <span key={i} className={`inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-full px-2.5 py-1 ${done ? 'bg-emerald-50 text-emerald-700' : rem > 0 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
                                  <span className="font-mono">{r.sku}</span>
                                  <span className="font-normal inline-flex items-center gap-1">
                                    {r.cases - rem} /
                                    <input type="number" min={1} value={r.cases}
                                      onChange={e => setCases(i, parseInt(e.target.value) || 1)}
                                      onClick={e => e.stopPropagation()}
                                      title="Cases to ship — lower this to ship a partial"
                                      className="w-12 text-center rounded border border-current/40 bg-white/80 text-[#1A1D2E] px-1 py-0.5 font-semibold" />
                                    {r.upc ? '' : ' ⚠'}
                                  </span>
                                  {done ? <span>✓</span> : <span>{rem > 0 ? `${rem} left` : `${-rem} over`}</span>}
                                  <button onClick={() => removeLine(i)} title="Remove this SKU from the shipment" className="text-current/50 hover:text-red-600">✕</button>
                                </span>
                              )
                            })}
                          </div>
                          <p className="text-[11px] text-gray-400 -mt-1.5 mb-3">Shipping a <b>partial</b>? Lower a SKU&apos;s case target above (e.g. 62 → 50). Case labels, BOL and packing list all follow the number you set.</p>

                          {/* Configuration cards */}
                          <div className="space-y-2 mb-3">
                            {configs.map(cfg => {
                              const casesEach = cfg.contents.reduce((a, c) => a + (c.casesPerPallet || 0), 0)
                              const mixed = cfg.contents.filter(c => (c.casesPerPallet || 0) > 0).length > 1
                              return (
                                <div key={cfg.id} className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
                                  <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-semibold text-sm shrink-0">×{cfg.count}</div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-[#1A1D2E] truncate">
                                      {cfg.count} pallet{cfg.count !== 1 ? 's' : ''} · {dimsStr(cfg.lengthIn, cfg.widthIn, cfg.heightIn) || 'no size'} · {cfg.weightLb || 0} lb ea
                                      {mixed && <span className="ml-1.5 text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full">mixed</span>}
                                      {cfg.freightClass && <span className="ml-1.5 text-[10px] text-gray-500">class {cfg.freightClass}</span>}
                                      {!cfg.stackable && <span className="ml-1.5 text-[10px] text-gray-400">no stack</span>}
                                    </p>
                                    <p className="text-[11px] text-gray-500 truncate">{cfg.contents.filter(c => (c.casesPerPallet || 0) > 0).map(c => `${c.casesPerPallet} × ${c.sku}`).join('  +  ') || '(empty)'}</p>
                                  </div>
                                  <span className="text-[11px] text-gray-400 shrink-0">{cfg.count * casesEach} cases</span>
                                  <button onClick={() => openConfig(cfg)} className="text-gray-400 hover:text-indigo-600 shrink-0" title="Edit configuration">✎</button>
                                  <button onClick={() => deleteConfig(cfg.id)} className="text-gray-300 hover:text-red-500 shrink-0" title="Delete configuration">✕</button>
                                </div>
                              )
                            })}
                          </div>

                          <button onClick={() => openConfig()} className={`${btn} w-full justify-center border-dashed border-gray-300 bg-white text-gray-600 hover:border-indigo-400 hover:text-indigo-600`}>+ Add pallet — pick the SKUs</button>

                          {anyUnallocated && <div className="text-xs bg-amber-50 border-l-4 border-amber-400 text-amber-800 p-2 mt-3">Every SKU should be fully assigned — the chips above turn green when a SKU&apos;s cases are all on pallets.</div>}
                          {!anyUnallocated && anyPalletMissingWeight && <div className="text-xs bg-amber-50 border-l-4 border-amber-400 text-amber-800 p-2 mt-3">Enter a <b>weight per pallet</b> on each configuration so the BOL and labels are accurate.</div>}
                        </div>

                        {/* STEP 2 — Bill of lading */}
                        <div className="rounded-xl border border-gray-200 bg-white p-4 mb-3 shadow-sm">
                          <div className="flex items-center gap-2 mb-3">
                            <span className="w-6 h-6 rounded-full bg-indigo-50 text-indigo-600 text-xs flex items-center justify-center font-semibold shrink-0">2</span>
                            <span className="text-sm font-semibold text-[#1A1D2E]">Bill of lading</span>
                            {finalized && !parcel && <span className="text-xs text-emerald-600">✓ finalized</span>}
                            {!parcel && <div className="ml-auto">{!bolForm
                              ? <button onClick={reviewBol} disabled={busy === 'bol'} className={`${btn} bg-emerald-600 text-white border-emerald-600`}>{busy === 'bol' ? 'Preparing…' : '📄 Review BOL'}</button>
                              : <button onClick={() => { setBolForm(null); setFinalized(false) }} className={`${btn} bg-white border-gray-300`}>Cancel</button>}</div>}
                          </div>
                          <label className="flex items-center gap-2 text-xs mb-2 select-none">
                            <input type="checkbox" checked={parcel} onChange={e => { setParcel(e.target.checked); if (e.target.checked) { setBolForm(null); setFinalized(false) } }} />
                            <span>This is a <b>parcel shipment</b> — no BOL needed (unlocks labels directly)</span>
                          </label>
                          {!parcel && !bolForm && <p className="text-xs text-gray-500">Review generates the BOL from your pallets — edit any field, watch the live preview, then finalize.</p>}
                          {!parcel && bolForm && (
                              <div className="grid md:grid-cols-2 gap-4">
                                {/* Editable fields */}
                                <div className="space-y-2 text-xs">
                                  <div className="grid grid-cols-2 gap-2">
                                    <div><label className="text-gray-400 block mb-0.5">BOL #</label><input value={bolForm.bolNumber} onChange={e => updBol({ bolNumber: e.target.value })} className={inp} /></div>
                                    <div><label className="text-gray-400 block mb-0.5">Date</label><input value={bolForm.date} onChange={e => updBol({ date: e.target.value })} className={inp} /></div>
                                    <div><label className="text-gray-400 block mb-0.5">Carrier</label><input value={bolForm.carrierName} onChange={e => updBol({ carrierName: e.target.value })} className={inp} /></div>
                                    <div><label className="text-gray-400 block mb-0.5">SCAC</label><input value={bolForm.scac} onChange={e => updBol({ scac: e.target.value })} className={inp} /></div>
                                    <div><label className="text-gray-400 block mb-0.5">Freight terms</label><input value={bolForm.freightTerms} onChange={e => updBol({ freightTerms: e.target.value })} className={inp} /></div>
                                    <div><label className="text-gray-400 block mb-0.5">Declared value</label><input type="number" value={bolForm.declaredValue} onChange={e => updBol({ declaredValue: Number(e.target.value) })} className={inp} /></div>
                                    <div><label className="text-gray-400 block mb-0.5">Pro #</label><input value={bolForm.proNumber} onChange={e => updBol({ proNumber: e.target.value })} className={inp} /></div>
                                    <div><label className="text-gray-400 block mb-0.5">PO #</label><input value={bolForm.poNumber} onChange={e => updBol({ poNumber: e.target.value })} className={inp} /></div>
                                    <div><label className="text-gray-400 block mb-0.5">Trailer #</label><input value={bolForm.trailerNo} onChange={e => updBol({ trailerNo: e.target.value })} className={inp} /></div>
                                    <div><label className="text-gray-400 block mb-0.5">Seal #</label><input value={bolForm.sealNumber} onChange={e => updBol({ sealNumber: e.target.value })} className={inp} /></div>
                                  </div>
                                  <div><label className="text-gray-400 block mb-0.5">Ship to</label><input value={bolForm.shipToName} onChange={e => updBol({ shipToName: e.target.value })} className={inp} /></div>
                                  <div><label className="text-gray-400 block mb-0.5">Ship-to address</label><textarea value={bolForm.shipToAddress} onChange={e => updBol({ shipToAddress: e.target.value })} rows={2} className={inp} /></div>
                                  <div><label className="text-gray-400 block mb-0.5">Special instructions</label><textarea value={bolForm.specialInstructions} onChange={e => updBol({ specialInstructions: e.target.value })} rows={3} className={inp} /></div>
                                  <div className="border-t pt-2">
                                    <label className="text-gray-400 block mb-1">Commodity lines (per pallet)</label>
                                    {bolForm.lines.map((l, i) => (
                                      <div key={i} className="mb-2 border rounded p-2">
                                        <div className="flex items-center gap-2 mb-1">
                                          <span className="font-semibold w-14">Pallet {i + 1}</span>
                                          <label className="text-gray-400">Cases</label><input type="number" value={l.packageQty} onChange={e => updBolLine(i, { packageQty: Number(e.target.value) })} className={num} />
                                          <label className="text-gray-400">Wt</label><input type="number" value={l.weight} onChange={e => updBolLine(i, { weight: Number(e.target.value) })} className={num} />
                                          <label className="text-gray-400">NMFC</label><input value={l.nmfcNumber} onChange={e => updBolLine(i, { nmfcNumber: e.target.value })} className="w-16 border rounded px-1 py-0.5 text-xs" />
                                          <label className="text-gray-400">Class</label><input value={l.freightClass} onChange={e => updBolLine(i, { freightClass: e.target.value })} className="w-14 border rounded px-1 py-0.5 text-xs" />
                                        </div>
                                        <textarea value={l.commodityDescription} onChange={e => updBolLine(i, { commodityDescription: e.target.value })} rows={2} className={inp} />
                                      </div>
                                    ))}
                                  </div>
                                  <button onClick={finalizeBol} disabled={busy === 'finalize'} className={`${btn} bg-emerald-600 text-white border-emerald-600 w-full`}>{busy === 'finalize' ? 'Finalizing…' : finalized ? 'Re-finalize BOL' : '✓ Finalize BOL & Download'}</button>
                                </div>
                                {/* Live preview */}
                                <div className="min-h-[420px] border rounded bg-gray-100">
                                  {previewUrl ? <iframe title="BOL preview" src={previewUrl} className="w-full h-[520px] rounded" /> : <div className="flex items-center justify-center h-[420px] text-xs text-gray-400">Rendering preview…</div>}
                                </div>
                              </div>
                          )}
                        </div>

                        {/* STEP 3 — Print labels */}
                        <div className="rounded-xl border border-gray-200 bg-white p-4 mb-3 shadow-sm">
                          <div className="flex items-center gap-2 mb-3">
                            <span className="w-6 h-6 rounded-full text-xs flex items-center justify-center font-semibold shrink-0 bg-indigo-50 text-indigo-600">3</span>
                            <span className="text-sm font-semibold text-[#1A1D2E]">Print labels</span>
                            {!labelsUnlocked && <span className="ml-auto text-xs text-gray-400">Case labels are ready now · pallet labels unlock after the BOL</span>}
                          </div>
                          {plan.length > 0 && (
                            <div className="text-xs border border-gray-200 rounded-lg p-3 mb-3 bg-gray-50/60">
                              <div className="flex items-center justify-between gap-2 mb-2">
                                <span className="font-semibold text-[#1A1D2E]">GTIN barcode images</span>
                                <span className="text-gray-400 truncate">Upload or replace the image printed on each case label — saved to Inventory for next time</span>
                              </div>
                              <div className="space-y-1.5">
                                {[...new Map(plan.map(r => [r.sku, r] as const)).values()].map(r => {
                                  const isMissing = missing.includes(r.sku)
                                  return (
                                    <div key={r.sku} className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 ${isMissing ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
                                      <span className="font-mono font-semibold text-[#1A1D2E] w-28 truncate">{r.sku}</span>
                                      {r.gtinImageUrl
                                        ? <span className="text-emerald-600 shrink-0 whitespace-nowrap">● Custom image</span>
                                        : (r.upc ? <span className="text-gray-500 shrink-0 whitespace-nowrap">UPC barcode</span> : <span className="text-amber-600 shrink-0 whitespace-nowrap">● No barcode</span>)}
                                      <span className="text-gray-400 flex-1 truncate">{r.description || ''}</span>
                                      <label className={`${btn} shrink-0 cursor-pointer ${r.gtinImageUrl ? 'bg-white border-gray-300' : 'bg-amber-600 text-white border-amber-600'} ${busy === 'gtin-' + r.sku ? 'opacity-60' : ''}`}>
                                        {busy === 'gtin-' + r.sku ? 'Uploading…' : (r.gtinImageUrl ? '↻ Replace' : '⬆ Upload GTIN')}
                                        <input type="file" accept="image/*" className="hidden" disabled={busy === 'gtin-' + r.sku}
                                          onChange={e => { const f = e.target.files?.[0]; if (f) uploadGtin(r.sku, f); e.currentTarget.value = '' }} />
                                      </label>
                                    </div>
                                  )
                                })}
                              </div>
                              {missing.length > 0 && <p className="text-amber-700 mt-2">Missing a barcode for {missing.length} SKU{missing.length !== 1 ? 's' : ''}. Upload above, then click <b>Case Labels</b>.</p>}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <button onClick={genCaseLabels} disabled={busy === 'labels' || plan.length === 0} title={plan.length === 0 ? 'Configure packing first' : ''} className={`${btn} bg-white border-gray-300`}>🏷️ Case Labels</button>
                            <button onClick={genPalletLabels} disabled={!labelsUnlocked} title={!labelsUnlocked ? 'Unlocks after the BOL is finalized' : ''} className={`${btn} bg-white border-gray-300`}>📦 Pallet Labels</button>
                            <button onClick={genPackingList} className={`${btn} bg-white border-gray-300`}>📋 Packing List</button>
                            <button onClick={genPickTickets} className={`${btn} bg-emerald-600 text-white border-emerald-600`} title="Save pallets & print a scannable pick ticket per pallet">🎫 Pick Tickets</button>
                          </div>
                        </div>

                        {/* STEP 4 — Ship it (close out & move to shipments) */}
                        <div className={`rounded-xl border p-4 mb-3 shadow-sm ${canMove ? 'border-emerald-300 bg-emerald-50/40' : 'border-gray-200 bg-white opacity-95'}`}>
                          <div className="flex items-center gap-2 mb-3">
                            <span className={`w-6 h-6 rounded-full text-xs flex items-center justify-center font-semibold shrink-0 ${canMove ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>4</span>
                            <span className="text-sm font-semibold text-[#1A1D2E]">Ship it</span>
                            {!canMove && <span className="ml-auto text-xs text-gray-400">Generate all required documents to unlock</span>}
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                            <div><label className="block text-[11px] text-gray-500 mb-0.5">Carrier</label><input list="dl-carriers" value={shipCarrier} onChange={e => setShipCarrier(e.target.value)} placeholder={parcel ? 'UPS, FedEx…' : 'e.g. XPO, Estes'} className={inp} /></div>
                            <div><label className="block text-[11px] text-gray-500 mb-0.5">{parcel ? 'Tracking #' : 'PRO / Tracking #'}</label><input value={shipTracking} onChange={e => setShipTracking(e.target.value)} className={inp} /></div>
                            <div><label className="block text-[11px] text-gray-500 mb-0.5">Shipping cost ($)</label><input type="number" min="0" step="0.01" value={shipCost} onChange={e => setShipCost(e.target.value)} className={inp} /></div>
                            {!parcel && <div><label className="block text-[11px] text-gray-500 mb-0.5">Broker cost ($)</label><input type="number" min="0" step="0.01" value={shipBrokerCost} onChange={e => setShipBrokerCost(e.target.value)} className={inp} /></div>}
                          </div>
                          <datalist id="dl-carriers"><option value="UPS" /><option value="FedEx" /><option value="USPS" /><option value="DHL" /><option value="XPO" /><option value="Old Dominion" /><option value="Estes" /><option value="R+L Carriers" /><option value="SAIA" /><option value="TForce Freight" /><option value="ABF Freight" /></datalist>
                          <p className="text-[11px] text-gray-400 mb-2">Documents below are optional — you can ship without generating labels or a BOL.</p>
                          <div className="flex flex-wrap gap-2 mb-3">
                            {requiredDocs.map(k => (
                              <span key={k} className={`text-xs px-2 py-1 rounded-full border ${shipPrep[k] ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-gray-50 border-gray-200 text-gray-500'}`}>
                                {shipPrep[k] ? '✓ ' : '○ '}{DOC_LABELS[k]}
                              </span>
                            ))}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button onClick={startCloseout} disabled={!canMove} className={`${btn} ${canMove ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white border-gray-300'}`}>🚚 Move to shipments</button>
                            <button onClick={doOverride} disabled={busy === 'override'} className={`${btn} bg-white border-amber-300 text-amber-700`}>🔒 Shipped Override</button>
                            <button onClick={doCancel} disabled={busy === 'cancel'} className={`${btn} bg-white border-red-300 text-red-600`}>✕ Cancel shipment</button>
                          </div>
                        </div>
                      </>
                    )}

                    <div className="border-t border-gray-100 pt-4">
                      <Comments recordType="sales_order" recordId={item.sales_order_id} currentUserEmail={userEmail} title="Activity Log" />
                    </div>
                    </div>{/* /mon-modal-body */}
                   </div>{/* /mon-modal */}
                  </div>
                )}
              </div>
            )
          })}
                  {gW.map(w => { const wi = w.w; return (
                    <div key={'w-' + w.id} className="rounded-xl border border-gray-200 bg-white shadow-sm mon-row">
                      <button onClick={() => setOpenW(openW === w.id ? null : w.id)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#0086C0]/10 text-[#0086C0] shrink-0">WALMART</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[#1A1D2E] truncate">{wi?.name || '—'}</p>
                          <p className="text-xs text-gray-500 truncate">{wi?.ship_to || ''}{wi?.po_number ? ' · PO ' + wi?.po_number : ''}</p>
                        </div>
                        <span className="hidden sm:inline-flex">{(() => { const c = statusColor(w.status); return (<span className="mon-pill" style={{ background: c.bg, color: c.fg }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: c.solid }} />{w.status}</span>) })()}</span>
                        <span className="text-xs text-gray-500 w-24 text-right hidden sm:block">{wi?.ship_due_date || ''}</span>
                        <span className="mon-btn !py-1.5 !px-3 whitespace-nowrap shrink-0">Open</span>
                      </button>
                    </div>
                  ) })}
                </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Walmart order (mirrored) drawer ─────────────────────────── */}
      {openW && activeW && (
        <div className="mon-backdrop" onClick={() => setOpenW(null)}>
          <div className="mon-modal" style={{ maxWidth: 720 }} onClick={e => e.stopPropagation()}>
            <div className="mon-modal-head">
              <div className="min-w-0">
                <h2 className="text-lg truncate">{activeW.w?.name || 'Walmart Order'}</h2>
                <p className="text-white/80 text-xs mt-0.5 truncate">{activeW.w?.ship_to || ''}{activeW.w?.po_number ? ' · PO ' + activeW.w?.po_number : ''}</p>
                {(() => { const c = statusColor(activeW.status); return (<span className="mon-pill mt-2" style={{ background: c.bg, color: c.fg }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: c.solid }} />{activeW.status}</span>) })()}
              </div>
              <button onClick={() => setOpenW(null)} className="mon-modal-close" aria-label="Close">×</button>
            </div>
            <div className="mon-modal-body bg-[#E9ECF2]">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-xs mb-4">
                <div><span className="text-gray-400 block">PO #</span>{activeW.w?.po_number || '—'}</div>
                <div><span className="text-gray-400 block">Ship To</span>{activeW.w?.ship_to || '—'}</div>
                <div><span className="text-gray-400 block">Status</span>{activeW.status}</div>
                <div><span className="text-gray-400 block">Order Value</span>{fmtMoney(activeW.w?.total_value)}</div>
                <div><span className="text-gray-400 block">Order Date</span>{activeW.w?.order_date || '—'}</div>
                <div><span className="text-gray-400 block">Ship Due</span>{activeW.w?.ship_due_date || '—'}</div>
                <div><span className="text-gray-400 block">Carrier</span>{activeW.w?.carrier || '—'}</div>
              </div>
              <div className="rounded-lg bg-[#0086C0]/5 border border-[#0086C0]/20 text-[11px] text-[#0086C0] px-3 py-2 mb-3">Mirrored from the Walmart Orders board. Comments here sync both ways with that board.</div>
              <div className="border-t border-gray-100 pt-4">
                <Comments recordType="walmart_order" recordId={activeW.id} currentUserEmail={userEmail} title="Activity Log" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Pallet configuration pop-up ─────────────────────────────── */}
      {cfgDraft && (() => {
        const d = cfgDraft
        const casesEach = d.contents.reduce((a, c) => a + (c.casesPerPallet || 0), 0)
        const cin = 'w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/40'
        const lbl = 'block text-[11px] font-medium text-gray-500 mb-1'
        return (
          <div className="fixed inset-0 z-[80] bg-black/50 flex items-start justify-center overflow-y-auto p-4" >
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg my-6">
              <div className="flex items-center justify-between px-5 py-4 text-white rounded-t-2xl bg-indigo-600">
                <h3 className="font-bold text-base">{configs.some(c => c.id === d.id) ? 'Edit pallet configuration' : 'New pallet configuration'}</h3>
                <button onClick={() => setCfgDraft(null)} className="text-white/80 hover:text-white text-2xl leading-none">&times;</button>
              </div>
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <label><span className={lbl}># of identical pallets</span><input type="number" min={1} value={d.count} onChange={e => patchDraft({ count: Math.max(1, Number(e.target.value) || 1) })} className={cin} /></label>
                  <label><span className={lbl}>Weight / pallet (lb)</span><input type="number" min={0} value={d.weightLb || ''} placeholder="0" onChange={e => patchDraft({ weightLb: Math.max(0, Number(e.target.value) || 0) })} className={cin} /></label>
                  <label className="col-span-2"><span className={lbl}>Dimensions L × W × H (in)</span>
                    <div className="flex items-center gap-1">
                      <input type="number" min={0} value={d.lengthIn || ''} placeholder="L" onChange={e => patchDraft({ lengthIn: Number(e.target.value) || 0 })} className={cin} />
                      <span className="text-gray-400">×</span>
                      <input type="number" min={0} value={d.widthIn || ''} placeholder="W" onChange={e => patchDraft({ widthIn: Number(e.target.value) || 0 })} className={cin} />
                      <span className="text-gray-400">×</span>
                      <input type="number" min={0} value={d.heightIn || ''} placeholder="H" onChange={e => patchDraft({ heightIn: Number(e.target.value) || 0 })} className={cin} />
                    </div>
                  </label>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <label><span className={lbl}>Freight class</span><input value={d.freightClass} placeholder="e.g. 92.5" onChange={e => patchDraft({ freightClass: e.target.value })} className={cin} /></label>
                  <label><span className={lbl}>NMFC code</span><input value={d.nmfc} placeholder="optional" onChange={e => patchDraft({ nmfc: e.target.value })} className={cin} /></label>
                  <label className="flex items-end pb-1.5"><span className="inline-flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={d.stackable} onChange={e => patchDraft({ stackable: e.target.checked })} className="w-4 h-4 accent-indigo-600" /> Stackable</span></label>
                </div>

                <div>
                  <span className={lbl}>Contents on each pallet <span className="text-gray-400">(add more than one SKU for a mixed pallet)</span></span>
                  <div className="space-y-2">
                    {d.contents.map((c, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <select value={c.sku} onChange={e => patchContent(idx, { sku: e.target.value })} className={cin + ' flex-1'}>
                          <option value="">— choose SKU —</option>
                          {plan.map(r => <option key={r.sku} value={r.sku}>{r.sku} — {r.description} ({remainingForSku(r.sku, r.cases)} left)</option>)}
                        </select>
                        <input type="number" min={0} value={c.casesPerPallet || ''} placeholder="cases" onChange={e => patchContent(idx, { casesPerPallet: Math.max(0, Number(e.target.value) || 0) })} className={cin + ' w-24 text-right'} />
                        <button onClick={() => removeContentRow(idx)} className="text-gray-300 hover:text-red-500 text-lg leading-none">×</button>
                      </div>
                    ))}
                  </div>
                  <button onClick={addContentRow} className="mt-2 text-xs font-semibold text-indigo-600 hover:underline">+ Add SKU to this pallet</button>
                </div>

                <label><span className={lbl}>Handling notes <span className="text-gray-400">(optional)</span></span><input value={d.notes} placeholder="e.g. top-load only, do not double-stack" onChange={e => patchDraft({ notes: e.target.value })} className={cin} /></label>

                <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                  <span className="text-xs text-gray-500">{d.count} × {casesEach} = <strong>{d.count * casesEach} cases</strong>{d.weightLb ? `, ${(d.count * d.weightLb).toLocaleString()} lb total` : ''}</span>
                  <div className="flex gap-2">
                    <button onClick={() => setCfgDraft(null)} className="text-sm font-medium text-gray-600 px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200">Cancel</button>
                    <button onClick={saveConfig} className="text-sm font-semibold text-white px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700">Save configuration</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Close-out modal ─────────────────────────────────────────── */}
      {closeout && activeItem && o && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-start justify-center overflow-y-auto p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-6">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-base font-bold text-[#1A1D2E]">Close out & move to shipments</h2>
                <p className="text-xs text-gray-500">{o.order_number} · PO {o.po_number || '—'} · {st.name}</p>
              </div>
              <button onClick={() => setCloseout(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>

            <div className="p-5 space-y-5">
              {/* Signed docs */}
              <div>
                <div className="text-sm font-semibold text-[#1A1D2E] mb-2">Signed documents</div>
                <div className="grid grid-cols-2 gap-3">
                  <label className={`flex flex-col items-start gap-1 border rounded-xl p-3 cursor-pointer ${coSlipUrl ? 'border-emerald-300 bg-emerald-50/50' : 'border-gray-200'}`}>
                    <span className="text-xs font-semibold">Signed Packing Slip <span className="text-red-500">*</span></span>
                    <span className="text-[11px] text-gray-500">{coSlipUrl ? '✓ Uploaded' : coBusy === 'slip' ? 'Uploading…' : 'PDF or photo'}</span>
                    <input type="file" accept="image/*,application/pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadDoc(f, 'slip') }} />
                  </label>
                  {needBolDoc && (
                    <label className={`flex flex-col items-start gap-1 border rounded-xl p-3 cursor-pointer ${coBolUrl ? 'border-emerald-300 bg-emerald-50/50' : 'border-gray-200'}`}>
                      <span className="text-xs font-semibold">Signed BOL <span className="text-red-500">*</span></span>
                      <span className="text-[11px] text-gray-500">{coBolUrl ? '✓ Uploaded' : coBusy === 'bol' ? 'Uploading…' : 'PDF or photo'}</span>
                      <input type="file" accept="image/*,application/pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadDoc(f, 'bol') }} />
                    </label>
                  )}
                </div>
              </div>

              {/* Photos */}
              <div>
                <div className="text-sm font-semibold text-[#1A1D2E] mb-2">Shipment photos</div>
                <div className="grid grid-cols-3 gap-3">
                  {photoSlots.map(slot => {
                    const shot = coPhotos.find(p => p.type === slot.type)
                    return (
                      <label key={slot.type} className={`relative flex flex-col items-center justify-center gap-1 border rounded-xl h-24 cursor-pointer overflow-hidden ${shot ? 'border-emerald-300' : 'border-dashed border-gray-300'}`}>
                        {shot ? <img src={shot.url} alt={slot.label} className="absolute inset-0 w-full h-full object-cover" /> : <span className="text-lg text-gray-300">＋</span>}
                        <span className={`relative text-[10px] text-center px-1 ${shot ? 'text-white bg-black/40 rounded absolute bottom-1' : 'text-gray-500'}`}>{slot.label}{slot.req && !shot ? ' *' : ''}</span>
                        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadPhoto(f, slot.type) }} />
                      </label>
                    )
                  })}
                </div>
                {coBusy === 'photo' && <p className="text-[11px] text-gray-500 mt-1">Uploading photo…</p>}
              </div>

              {/* AI summary */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold text-[#1A1D2E]">AI shipment summary <span className="text-red-500">*</span></div>
                  <button onClick={genSummary} disabled={coBusy === 'ai' || coPhotos.length === 0} className={`${btn} bg-indigo-600 text-white border-indigo-600`}>{coBusy === 'ai' ? 'Analyzing…' : coSummary ? 'Regenerate' : '✨ Generate summary'}</button>
                </div>
                {coSummary
                  ? <textarea value={coSummary} onChange={e => setCoSummary(e.target.value)} className="w-full text-xs border border-gray-200 rounded-lg p-3 h-28" />
                  : <p className="text-[11px] text-gray-400">Add photos, then generate an AI review of the shipment condition for the record.</p>}
              </div>
            </div>

            <div className="flex items-center justify-between px-5 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
              <button onClick={() => setCloseout(false)} className={`${btn} bg-white border-gray-300`}>Cancel</button>
              <button onClick={confirmMove} disabled={!canConfirm || coBusy === 'move'} className={`${btn} ${canConfirm ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-gray-200 border-gray-200 text-gray-400'}`}>{coBusy === 'move' ? 'Moving…' : 'Confirm & move to shipments'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
