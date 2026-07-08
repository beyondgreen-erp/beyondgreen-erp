'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import Comments from '@/components/Comments'
import { statusColor } from '@/lib/statusColors'
import { buildCaseLabels, buildPalletLabels, missingUpcSkus, type CaseLabel, type PalletLabel } from '@/lib/shipping/labels'
import { buildBOL, buildMasterBOL, buildPackingList, loadImageDataUrl, type BolLine, type BolData, type PackListCase } from '@/lib/shipping/bol'

const sb = createSupabaseBrowserClient()
const GRAMS_PER_LB = 453.592
const SHIP_FROM_NAME = 'beyondGREEN biotech, Inc.'
const SHIP_FROM_ADDR = '1202 E Wakeham Ave.,\nSanta Ana, CA 92705 USA'
const SHIPPABLE = ['Ready to Ship', 'PU Date Assigned', 'Partially Shipped']
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
interface PlanRow {
  sku: string; description: string; units: number; unitsPerCase: number; cases: number
  caseWeightLb: number; gramsPerUnit: number; upc: string | null; customerPart: string | null
  gtinImageUrl: string | null; uom: string; packaging: string; done: number
  alloc: Record<number, number>   // cases of this line on each pallet id (supports splitting a SKU across pallets)
}
interface Pallet { id: number; weightLb: number }   // manual total pallet weight
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
function sumAlloc(a: Record<number, number>) { return Object.values(a).reduce((s, v) => s + (v || 0), 0) }

export default function ShippingQueuePage() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [plan, setPlan] = useState<PlanRow[]>([])
  const [pallets, setPallets] = useState<Pallet[]>([{ id: 1, weightLb: 0 }])
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
  const [coBusy, setCoBusy] = useState('')

  useEffect(() => { sb.auth.getUser().then(({ data }) => setUserEmail(data.user?.email || '')) }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await sb.from('sales_orders')
      .select('id, order_number, po_number, shipping_address, total, total_amount, total_value, customer_id, status, order_date, required_ship_date, carrier, tracking_number, additional_comments, ship_prep, customers(company_name, shipping_address)')
      .in('status', SHIPPABLE).order('required_ship_date', { ascending: true, nullsFirst: false })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (data as any[]) || []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setItems(rows.map((o: any) => ({ id: o.id, sales_order_id: o.id, status: o.status, sales_orders: o })))
    setLoading(false)
  }, [])

  const loadBols = useCallback(async () => {
    const { data } = await sb.from('bols').select('id, bol_number, po_number, ship_to_name, pallet_qty, case_qty, weight, declared_value, commodity_description, status')
      .eq('status', 'Draft').order('created_at', { ascending: false })
    setBols((data as BolRow[]) || [])
  }, [])

  useEffect(() => { load(); loadBols() }, [load, loadBols])

  function resetPackState() {
    setPlan([]); setPallets([{ id: 1, weightLb: 0 }]); setParcel(false)
    setBolForm(null); setFinalized(false); setMissing([]); setNotes('')
    if (prevUrlRef.current) { URL.revokeObjectURL(prevUrlRef.current); prevUrlRef.current = '' }
    setPreviewUrl('')
    setShipPrep({}); setCloseout(false); setCoShipId(''); setCoSlipUrl(''); setCoBolUrl(''); setCoPhotos([]); setCoSummary(''); setCoBusy('')
  }

  async function openOrder(item: QueueItem) {
    if (openId === item.id) { setOpenId(null); resetPackState(); return }
    setOpenId(item.id); resetPackState(); setBusy('load')
    setShipPrep(item.sales_orders?.ship_prep || {})
    const { data: lines } = await sb.from('sales_order_lines').select('*').eq('sales_order_id', item.sales_order_id).order('line_number', { ascending: true })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ls = (lines as any[]) || []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pids = [...new Set(ls.map((l: any) => l.product_id).filter(Boolean))]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prodMap: Record<string, any> = {}
    if (pids.length) {
      const { data: prods } = await sb.from('products').select('id, case_qty, weight_per_unit_grams, upc_gtin, gtin_image_url, customer_part_number, product_name').in('id', pids)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;((prods as any[]) || []).forEach((p: any) => { prodMap[p.id] = p })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rowsOut: PlanRow[] = ls.map((l: any) => {
      const prod = l.product_id ? prodMap[l.product_id] : null
      const upc = l.qty_per_case || prod?.case_qty || 1
      const units = l.quantity ?? l.qty ?? 0
      const gpu = prod?.weight_per_unit_grams || 0
      const cs = Math.max(1, Math.ceil(units / (upc || 1)))
      return {
        sku: l.sku || '(no sku)', description: l.description || prod?.product_name || '',
        units, unitsPerCase: upc || 1, cases: cs,
        caseWeightLb: +(((upc || 1) * gpu) / GRAMS_PER_LB).toFixed(2), gramsPerUnit: gpu,
        upc: prod?.upc_gtin || null, customerPart: prod?.customer_part_number || null, gtinImageUrl: prod?.gtin_image_url || null,
        uom: l.unit_of_measure || '', packaging: l.packaging || '', done: l.quantity_shipped || l.completed_qty || 0,
        alloc: { 1: cs },   // default: all of this line's cases on Pallet 1
      }
    })
    setPlan(rowsOut); setBusy('')
  }

  // Editing packing after the BOL was reviewed/finalized invalidates it (labels must come from a fresh BOL).
  function invalidateBol() { if (finalized) setFinalized(false); if (bolForm) setBolForm(null) }

  const firstPalletId = () => pallets[0]?.id ?? 1
  function removeLine(i: number) { setPlan(p => p.filter((_, idx) => idx !== i)); invalidateBol() }
  // Set total cases for a line, resetting its allocation onto the first pallet.
  function setCases(i: number, v: number) {
    const cs = Math.max(1, v || 1)
    setPlan(p => p.map((r, idx) => idx === i ? { ...r, cases: cs, alloc: { [firstPalletId()]: cs } } : r)); invalidateBol()
  }
  function setUnitsPerCase(i: number, v: number) {
    setPlan(p => p.map((r, idx) => {
      if (idx !== i) return r
      const upc = Math.max(1, v || 1)
      const cs = Math.max(1, Math.ceil(r.units / upc))
      return { ...r, unitsPerCase: upc, cases: cs, alloc: { [firstPalletId()]: cs }, caseWeightLb: r.gramsPerUnit ? +((upc * r.gramsPerUnit) / GRAMS_PER_LB).toFixed(2) : r.caseWeightLb }
    }))
    invalidateBol()
  }
  // Set how many of a line's cases sit on a given pallet (this is what enables splitting a SKU across pallets).
  function setAlloc(i: number, palletId: number, v: number) {
    setPlan(p => p.map((r, idx) => idx === i ? { ...r, alloc: { ...r.alloc, [palletId]: Math.max(0, v || 0) } } : r)); invalidateBol()
  }

  function addPallet() { setPallets(ps => [...ps, { id: (ps.reduce((m, p) => Math.max(m, p.id), 0) + 1), weightLb: 0 }]); invalidateBol() }
  function removePallet(id: number) {
    if (pallets.length <= 1) return
    const first = pallets.find(p => p.id !== id)!.id
    setPlan(p => p.map(r => {
      const moved = r.alloc[id] || 0
      if (!moved) return r
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _drop, ...rest } = r.alloc
      return { ...r, alloc: { ...rest, [first]: (rest[first] || 0) + moved } }
    }))
    setPallets(ps => ps.filter(p => p.id !== id))
    invalidateBol()
  }
  function setPalletWeight(id: number, w: number) { setPallets(ps => ps.map(p => p.id === id ? { ...p, weightLb: Math.max(0, w || 0) } : p)); invalidateBol() }

  const activeItem = items.find(i => i.id === openId)
  const o = activeItem?.sales_orders
  const st = o ? shipTo(o) : { name: '', addr: '' }

  const casesOnPallet = (id: number) => plan.reduce((a, r) => a + (r.alloc[id] || 0), 0)
  const skusOnPallet = (id: number) => plan.filter(r => (r.alloc[id] || 0) > 0).map(r => r.sku)
  const remaining = (r: PlanRow) => r.cases - sumAlloc(r.alloc)
  const anyUnallocated = plan.some(r => remaining(r) !== 0)

  const totals = {
    cases: plan.reduce((a, r) => a + r.cases, 0),
    pallets: pallets.length,
    weight: +(pallets.reduce((a, p) => a + (p.weightLb || 0), 0)).toFixed(0),
  }
  const anyPalletMissingWeight = pallets.some(p => !p.weightLb)

  async function aiSuggest() {
    setBusy('ai')
    try {
      const res = await fetch('/api/shipping/pack-suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxCasesPerPallet: 40, lines: plan.map(r => ({ sku: r.sku, description: r.description, units: r.units, unitsPerCase: r.unitsPerCase, weightPerUnitGrams: r.gramsPerUnit })) }),
      })
      const j = await res.json()
      if (j.skuPlan) setPlan(p => p.map(r => { const s = j.skuPlan.find((x: { sku: string }) => x.sku === r.sku); return s ? { ...r, cases: s.cases, alloc: { [firstPalletId()]: s.cases } } : r }))
      if (j.notes) setNotes(j.notes)
      invalidateBol()
    } catch { setNotes('AI suggestion unavailable; using computed plan.') }
    setBusy('')
  }

  // ---- BOL review / preview / finalize -------------------------------------
  function buildBolLines(): BolLineForm[] {
    return pallets.map(p => {
      const rows = plan.filter(r => (r.alloc[p.id] || 0) > 0)
      const cases = rows.reduce((a, r) => a + (r.alloc[p.id] || 0), 0)
      const desc = rows.map(r => `${r.description || r.sku} — ${r.unitsPerCase}pcs/cs × ${r.alloc[p.id]}cs`).join('; ') || '(empty pallet)'
      return { palletId: p.id, handlingQty: 1, packageQty: cases, weight: p.weightLb, commodityDescription: desc, nmfcNumber: '', freightClass: '' }
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
    const si = ['"DO NOT STACK"', po ? `PU# ${po}` : '', po ? `Load# ${po}` : ''].filter(Boolean).join('\n')
    const lines = buildBolLines().map(l => ({ ...l, nmfcNumber: fill.nmfcNumber || '', freightClass: fill.freightClass || '' }))
    setBolForm({
      bolNumber, date: new Date().toLocaleDateString(), carrierName: o?.carrier || 'SINGLE (Walmart FLEET)', scac: 'WALM', freightTerms: '3rd Party',
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
    const payload = { pallets, plan: plan.map(r => ({ sku: r.sku, description: r.description, cases: r.cases, unitsPerCase: r.unitsPerCase, alloc: r.alloc, upc: r.upc, customerPart: r.customerPart })), bol: bolForm }
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
    await Promise.all(urls.map(async u => { const d = await loadImageDataUrl(u); if (d) map[u] = d }))
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

  function genPalletLabels() {
    const labels: PalletLabel[] = pallets.map((p, idx) => ({ palletNumber: idx + 1, totalPallets: pallets.length, caseCount: casesOnPallet(p.id), weight: p.weightLb, skus: skusOnPallet(p.id) }))
    buildPalletLabels({ poNumber: bolForm?.poNumber || o?.po_number || '', shipToName: st.name, shipToAddress: st.addr }, labels).save(`pallet-labels-${o?.order_number || 'order'}.pdf`)
    markDoc('palletLabels')
  }

  function genPackingList() {
    if (!activeItem) return
    const cases: PackListCase[] = []
    pallets.forEach((p, idx) => {
      plan.filter(r => (r.alloc[p.id] || 0) > 0).forEach(r => {
        const n = r.alloc[p.id] || 0
        for (let k = 1; k <= n; k++) cases.push({ sku: r.sku, description: r.description, caseNumber: k, totalCases: r.cases, unitsInCase: r.unitsPerCase, weight: r.caseWeightLb, palletNumber: idx + 1 })
      })
    })
    const meta = { poNumber: o?.po_number || '', orderNumber: o?.order_number || '', shipToName: st.name, shipToAddress: st.addr, date: new Date().toLocaleDateString() }
    loadImageDataUrl('/bG-logo-clean.png').then(logo => buildPackingList(meta, cases, totals, logo).save(`packing-list-${o?.order_number || 'order'}.pdf`))
      .catch(() => buildPackingList(meta, cases, totals, null).save(`packing-list-${o?.order_number || 'order'}.pdf`))
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
  const canMove = requiredDocs.every(k => shipPrep[k])
  const requiredPhotoTypes = parcel ? ['package', 'shipping_label'] : ['packed_pallet', 'shipping_label', 'sealed_cases', 'bol_document']

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
  const photosOk = requiredPhotoTypes.every(t => coPhotos.some(p => p.type === t))
  const canConfirm = !!coSlipUrl && (!needBolDoc || !!coBolUrl) && photosOk && !!coSummary

  async function createShipment(extra: Record<string, unknown>) {
    if (!activeItem || !o) return
    const now = new Date()
    await sb.from('shipments').insert({
      id: coShipId || undefined, sales_order_id: activeItem.sales_order_id, order_id: activeItem.sales_order_id,
      customer_name: st.name, po_number: o.po_number || null, carrier: o.carrier || null,
      ship_date: now.toISOString().slice(0, 10), shipped_at: now.toISOString(), order_date: o.order_date || null,
      total_value: o.total_amount ?? o.total ?? o.total_value ?? null, ship_to_address: st.addr || null,
      bol_number: bolForm?.bolNumber || null, packing_slip_url: coSlipUrl || null, pod_file_url: coBolUrl || null,
      month_group: now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      ...extra,
    })
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
      await sb.from('sales_orders').update({ status: 'Shipped' }).eq('id', activeItem.sales_order_id)
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
      await sb.from('sales_orders').update({ status: 'Shipped' }).eq('id', activeItem.sales_order_id)
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
      shipToName: chosen[0].ship_to_name || 'Consolidation', shipToAddress: '', carrierName: 'SINGLE (Walmart FLEET)', scac: 'WALM', freightTerms: '3rd Party',
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

  const photoSlots: { type: string; label: string; req: boolean }[] = parcel
    ? [{ type: 'package', label: 'Sealed package', req: true }, { type: 'shipping_label', label: 'Shipping label', req: true }, { type: 'other', label: 'Other', req: false }]
    : [{ type: 'packed_pallet', label: 'Packed pallet(s)', req: true }, { type: 'shipping_label', label: 'Pallet / shipping label', req: true }, { type: 'sealed_cases', label: 'Sealed cases', req: true }, { type: 'bol_document', label: 'BOL on shipment', req: true }, { type: 'truck_loaded', label: 'Loaded on truck', req: false }]

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold">Shipping Queue</h1>
        <button onClick={() => setShowMaster(s => !s)} className={`${btn} bg-indigo-600 text-white border-indigo-600`}>{showMaster ? 'Hide' : 'Merge BOLs → Master BOL'}</button>
      </div>
      <p className="text-xs text-gray-400 mb-4">Mirrors the Sales Orders board. Showing: {SHIPPABLE.join(', ')}.</p>

      {/* Search + filter */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search order #, PO #, or customer…" className="flex-1 min-w-[220px] border rounded-lg px-3 py-2 text-sm" />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
          <option>All</option>{SHIPPABLE.map(s => <option key={s}>{s}</option>)}
        </select>
        <span className="text-xs text-gray-400">{visible.length} of {items.length}</span>
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

      {loading ? <p className="text-gray-400">Loading…</p> : visible.length === 0 ? <p className="text-gray-400">No matching orders.</p> : (
        <div className="space-y-2">
          {visible.map(item => {
            const io = item.sales_orders; const open = openId === item.id
            return (
              <div key={item.id} className="rounded-xl border border-gray-200 bg-white shadow-sm mon-row">
                <button onClick={() => openOrder(item)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#1A1D2E] truncate">{io?.order_number || '—'}</p>
                    <p className="text-xs text-gray-500 truncate">{io?.customers?.company_name || ''}{io?.po_number ? ' · PO ' + io?.po_number : ''}</p>
                  </div>
                  {(() => { const c = statusColor(item.status); return (
                    <span className="mon-pill" style={{ background: c.bg, color: c.fg }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: c.solid }} />{item.status}</span>
                  ) })()}
                  <span className="text-xs text-gray-500 w-24 text-right hidden sm:block">{io?.required_ship_date || ''}</span>
                  <span className="mon-btn !py-1.5 !px-3 whitespace-nowrap">{open ? 'Close' : '🚚 Pack & Ship'}</span>
                </button>

                {open && (
                  <div className="mon-backdrop" onClick={() => { setOpenId(null); resetPackState() }}>
                   <div className="mon-modal" style={{ maxWidth: 1000 }} onClick={e => e.stopPropagation()}>
                    <div className="mon-modal-head">
                      <div className="min-w-0">
                        <h2 className="text-lg truncate">{io?.order_number || 'Order'}</h2>
                        <p className="text-white/80 text-xs mt-0.5 truncate">{io?.customers?.company_name || ''}{io?.po_number ? ' · PO ' + io?.po_number : ''}</p>
                        {(() => { const c = statusColor(item.status); return (
                          <span className="mon-pill mt-2" style={{ background: c.bg, color: c.fg }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: c.solid }} />{item.status}</span>
                        ) })()}
                      </div>
                      <button onClick={() => { setOpenId(null); resetPackState() }} className="mon-modal-close" aria-label="Close">×</button>
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
                        {/* STEP 1 — Pack the pallets */}
                        <div className="rounded-xl border border-gray-200 bg-white p-4 mb-3 shadow-sm">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="w-6 h-6 rounded-full bg-indigo-50 text-indigo-600 text-xs flex items-center justify-center font-semibold shrink-0">1</span>
                            <span className="text-sm font-semibold text-[#1A1D2E]">Pack the pallets</span>
                            <span className="ml-auto text-xs text-gray-400">{totals.pallets} pallet{totals.pallets !== 1 ? 's' : ''} · {totals.cases} cases · {totals.weight} lb</span>
                            <button onClick={aiSuggest} disabled={busy === 'ai'} className={`${btn} bg-violet-600 text-white border-violet-600`}>{busy === 'ai' ? 'Thinking…' : '✨ AI Suggest'}</button>
                          </div>
                          <p className="text-xs text-gray-500 mb-2">Enter how many cases of each line go on each pallet — split a SKU by filling more than one pallet box.</p>
                        <div className="overflow-x-auto">
                        <table className="w-full text-xs mb-4">
                          <thead><tr className="text-left text-gray-500 border-b bg-gray-50">
                            <th className="py-1.5 px-2">SKU</th><th className="px-2">Product / Description</th><th className="text-right px-2">Qty</th>
                            <th className="px-2">UOM</th><th className="text-right px-2">Units/Case</th><th className="text-right px-2">Cases</th>
                            <th className="px-2">Cases per pallet</th><th className="text-center px-2">UPC</th><th className="px-2"></th>
                          </tr></thead>
                          <tbody>
                            {plan.map((r, i) => (
                              <tr key={i} className="border-b border-gray-50 align-top">
                                <td className="py-1.5 px-2 font-mono">{r.sku}</td>
                                <td className="px-2 text-gray-600">{r.description}</td>
                                <td className="text-right px-2">{r.units}</td>
                                <td className="px-2 text-gray-500">{r.uom || '—'}</td>
                                <td className="text-right px-2"><input type="number" value={r.unitsPerCase} onChange={e => setUnitsPerCase(i, Number(e.target.value))} className={num} /></td>
                                <td className="text-right px-2"><input type="number" value={r.cases} onChange={e => setCases(i, Number(e.target.value))} className={num} /></td>
                                <td className="px-2">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {pallets.map((p, idx) => (
                                      <span key={p.id} className="inline-flex items-center gap-0.5" title={`Cases of ${r.sku} on Pallet ${idx + 1}`}>
                                        <span className="text-gray-400">P{idx + 1}</span>
                                        <input type="number" min={0} value={r.alloc[p.id] || 0} onChange={e => setAlloc(i, p.id, Number(e.target.value))} className="w-12 border rounded px-1 py-0.5 text-right text-xs" />
                                      </span>
                                    ))}
                                    {remaining(r) !== 0 && <span className={`text-[10px] font-semibold ${remaining(r) > 0 ? 'text-amber-600' : 'text-red-600'}`}>{remaining(r) > 0 ? `${remaining(r)} unassigned` : `${-remaining(r)} over`}</span>}
                                  </div>
                                </td>
                                <td className="text-center px-2">{r.upc ? '✓' : <span className="text-red-500 font-bold">!</span>}</td>
                                <td className="px-2 text-center"><button onClick={() => removeLine(i)} title="Remove this line from the shipment" className="text-gray-300 hover:text-red-500">✕</button></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        </div>

                        {/* Pallets → manual total weight each */}
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-semibold text-gray-600">Pallets</p>
                          <button onClick={addPallet} className={`${btn} bg-white border-gray-300`}>+ Add pallet</button>
                        </div>
                        <div className="space-y-1.5 mb-3">
                          {pallets.map((p, idx) => (
                            <div key={p.id} className="flex items-center gap-3 text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                              <span className="font-semibold w-16">Pallet {idx + 1}</span>
                              <span className="text-gray-500 flex-1 truncate">{casesOnPallet(p.id)} cases · {skusOnPallet(p.id).join(', ') || '—'}</span>
                              <label className="text-gray-500">Total weight (lb)</label>
                              <input type="number" value={p.weightLb || ''} placeholder="0" onChange={e => setPalletWeight(p.id, Number(e.target.value))} className={`${num} w-20 ${!p.weightLb ? 'ring-1 ring-red-300' : ''}`} />
                              {pallets.length > 1 && <button onClick={() => removePallet(p.id)} className="text-red-400 hover:text-red-600" title="Remove pallet">✕</button>}
                            </div>
                          ))}
                        </div>

                          {anyUnallocated && <div className="text-xs bg-amber-50 border-l-4 border-amber-400 text-amber-800 p-2 mt-3">Some cases aren&apos;t assigned to a pallet — the “Cases per pallet” columns for each line should add up to that line&apos;s <b>Cases</b> total.</div>}
                          {anyPalletMissingWeight && <div className="text-xs bg-amber-50 border-l-4 border-amber-400 text-amber-800 p-2 mt-2">Enter the <b>total weight</b> for each pallet so the BOL and labels are accurate.</div>}
                          {notes && <div className="text-xs bg-violet-50 border-l-4 border-violet-400 p-2 mt-2 whitespace-pre-line">{notes}</div>}
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
                        <div className={`rounded-xl border border-gray-200 bg-white p-4 mb-3 shadow-sm ${!labelsUnlocked ? 'opacity-60' : ''}`}>
                          <div className="flex items-center gap-2 mb-3">
                            <span className={`w-6 h-6 rounded-full text-xs flex items-center justify-center font-semibold shrink-0 ${labelsUnlocked ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-100 text-gray-400'}`}>3</span>
                            <span className="text-sm font-semibold text-[#1A1D2E]">Print labels</span>
                            {!labelsUnlocked && <span className="ml-auto text-xs text-gray-400">Unlocks after the BOL is finalized</span>}
                          </div>
                          {missing.length > 0 && (
                            <div className="text-xs bg-red-50 border-l-4 border-red-400 text-red-700 p-3 mb-3">
                              <b>UPC or GTIN is missing in the Inventory board</b> for: {missing.join(', ')}.<br />Please add the UPC/GTIN (and product image) in Inventory before generating labels.
                            </div>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <button onClick={genCaseLabels} disabled={!labelsUnlocked || busy === 'labels'} className={`${btn} bg-white border-gray-300`}>🏷️ Case Labels</button>
                            <button onClick={genPalletLabels} disabled={!labelsUnlocked} className={`${btn} bg-white border-gray-300`}>📦 Pallet Labels</button>
                            <button onClick={genPackingList} className={`${btn} bg-white border-gray-300`}>📋 Packing List</button>
                          </div>
                        </div>

                        {/* STEP 4 — Ship it (close out & move to shipments) */}
                        <div className={`rounded-xl border p-4 mb-3 shadow-sm ${canMove ? 'border-emerald-300 bg-emerald-50/40' : 'border-gray-200 bg-white opacity-95'}`}>
                          <div className="flex items-center gap-2 mb-3">
                            <span className={`w-6 h-6 rounded-full text-xs flex items-center justify-center font-semibold shrink-0 ${canMove ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>4</span>
                            <span className="text-sm font-semibold text-[#1A1D2E]">Ship it</span>
                            {!canMove && <span className="ml-auto text-xs text-gray-400">Generate all required documents to unlock</span>}
                          </div>
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
        </div>
      )}

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
