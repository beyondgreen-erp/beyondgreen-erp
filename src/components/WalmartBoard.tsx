'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import ShareLink from '@/components/ShareLink'
import { useItemDeepLink } from '@/components/useItemDeepLink'
import Comments from '@/components/Comments'
import FileUpload from '@/components/FileUpload'
import { statusColor } from '@/lib/statusColors'

interface WLine {
  id?: string; _new?: boolean; part_number: string | null; qty: number | null; qty_per_case: number | null
  completed_qty: number | null; uom: string | null; packaging: string | null; production_status: string | null
  cost_each: string | null; total_cost: string | null; added_details: string | null; line_number?: number | null
}
interface WOrder {
  id: string; monday_item_id: string | null; name: string; group_name: string | null; status: string | null
  order_date: string | null; ship_due_date: string | null; load_number: string | null; facility: string | null
  srp: number | null; units: number | null; pallets: string | null; work_order: string | null; lot: string | null
  po_number: string | null; ship_to: string | null; ship_from: string | null; bol_date: string | null; bol2: string | null
  carrier: string | null; trailer_no: string | null; seal_number: string | null; special_instructions: string | null
  qty: number | null; pkg_type: string | null; qty2: number | null; pkg_type2: string | null; weight: number | null
  commodity_description: string | null; total_value: number | null; do_not_delete: string | null; board_position: number | null
}
interface Product { id: string; sku: string; product_name: string | null; on_hand_qty: number | null; case_qty: number | null; weight_per_unit_grams: number | null; unit_cost: number | null }
interface BomRow { finished_good_sku: string; component_sku: string; uom_type: string | null; qty_value: number | null; percentage: number | null; is_case_level: boolean | null }
interface Pallet { id: string; order_id: string; pallet_number: number; total_pallets: number; token: string; status: string; completed_by: string | null; completed_at: string | null }
interface PalletItem { id: string; pallet_id: string; order_id: string; sku: string; qty: number }

const UNITS_PER_SRP = 6
const DEFAULT_COMMODITY = 'Disposable Cutlery'

const GROUPS = [
  { key: 'Walmart Orders', color: '#0086C0' },
  { key: 'Building Order', color: '#FDAB3D' },
  { key: 'Ready for Shipment', color: '#00A84F' },
  { key: 'Prepped & Ready for Dispatch', color: '#A25DDC' },
  { key: 'Cancelled', color: '#E2445C' },
]
// One shared status vocabulary with the Sales Order board.
const STATUS_OPTIONS = ['Pending', 'Confirmed', 'Awaiting BOM Components', 'Production Queue', 'Building Order', 'In Production', 'QC', 'Ready to Ship', 'Prepped & Ready for Dispatch', 'Ready at Will Call', 'Partially Shipped', 'Shipped', 'On Hold', 'Cancelled', 'Closed']

// Status ⇄ Group are kept in lock-step so the board never drifts from the workflow.
function groupForStatus(status: string | null): string {
  const s = (status || '').toLowerCase()
  if (s === 'building order') return 'Building Order'
  if (s === 'ready to ship') return 'Ready for Shipment'
  if (s === 'prepped & ready for dispatch') return 'Prepped & Ready for Dispatch'
  if (s === 'cancel' || s === 'cancelled' || s === 'canceled') return 'Cancelled'
  return 'Walmart Orders'
}
function statusForGroup(group: string): string | null {
  switch (group) {
    case 'Building Order': return 'Building Order'
    case 'Ready for Shipment': return 'Ready to Ship'
    case 'Prepped & Ready for Dispatch': return 'Prepped & Ready for Dispatch'
    case 'Cancelled': return 'Cancelled'
    case 'Walmart Orders': return 'Confirmed'
    default: return null
  }
}

const fmtD = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const fmt$ = (n: number | null) => (n == null ? '—' : '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const fmtN = (n: number | null) => (n == null ? '—' : Number(n).toLocaleString())
const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c])

type FKind = 'text' | 'date' | 'num' | 'money' | 'status' | 'longtext'
const FIELDS: { key: keyof WOrder; label: string; kind: FKind; wide?: boolean }[] = [
  { key: 'status', label: 'Status', kind: 'status' },
  { key: 'order_date', label: 'Order Date', kind: 'date' },
  { key: 'ship_due_date', label: 'Ship Due Date', kind: 'date' },
  { key: 'facility', label: 'Facility', kind: 'text' },
  { key: 'po_number', label: 'PO #', kind: 'text' },
  { key: 'load_number', label: 'Load #', kind: 'text' },
  { key: 'carrier', label: 'Carrier', kind: 'text' },
  { key: 'bol2', label: 'BOL #', kind: 'text' },
  { key: 'bol_date', label: 'BOL Date', kind: 'date' },
  { key: 'trailer_no', label: 'Trailer No', kind: 'text' },
  { key: 'seal_number', label: 'Seal Number', kind: 'text' },
  { key: 'srp', label: 'SRP', kind: 'num' },
  { key: 'units', label: 'Units', kind: 'num' },
  { key: 'pallets', label: 'Pallets', kind: 'text' },
  { key: 'qty', label: 'Qty (PLT)', kind: 'num' },
  { key: 'qty2', label: 'Qty 2 (CS)', kind: 'num' },
  { key: 'weight', label: 'Weight (lbs)', kind: 'num' },
  { key: 'total_value', label: 'Total Value', kind: 'money' },
  { key: 'work_order', label: 'Work Order #', kind: 'text' },
  { key: 'lot', label: 'Lot #', kind: 'text' },
  { key: 'ship_from', label: 'Ship From', kind: 'text', wide: true },
  { key: 'ship_to', label: 'Ship To', kind: 'text', wide: true },
  { key: 'commodity_description', label: 'Commodity Description', kind: 'longtext', wide: true },
  { key: 'special_instructions', label: 'Special Instructions', kind: 'longtext', wide: true },
]

export default function WalmartBoard() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<WOrder[]>([])
  const [lines, setLines] = useState<Record<string, WLine[]>>({})
  const [products, setProducts] = useState<Product[]>([])
  const [bom, setBom] = useState<BomRow[]>([])
  const [pallets, setPallets] = useState<Record<string, Pallet[]>>({})
  const [palletItems, setPalletItems] = useState<Record<string, PalletItem[]>>({})
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({})
  const [fileCounts, setFileCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [userEmail, setUserEmail] = useState('')
  const [showReq, setShowReq] = useState(true)
  const [reqExpand, setReqExpand] = useState<Record<string, boolean>>({})

  const [detail, setDetail] = useState<WOrder | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<any>({})
  const [lineForms, setLineForms] = useState<WLine[]>([])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [genBusy, setGenBusy] = useState(false)
  const navRef = useRef<HTMLDivElement>(null)

  // New-order modal
  const [showNew, setShowNew] = useState(false)
  const [creating, setCreating] = useState(false)
  const [nf, setNf] = useState<any>({})
  const [nfTouched, setNfTouched] = useState<{ name?: boolean; srp?: boolean; units?: boolean }>({})
  const [nLines, setNLines] = useState<WLine[]>([])
  const [poParsing, setPoParsing] = useState(false)
  const [poError, setPoError] = useState('')
  const [poFileName, setPoFileName] = useState('')
  const [flagged, setFlagged] = useState<Set<string>>(new Set())

  // drag & drop
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)

  const productBySku = useMemo(() => {
    const m: Record<string, Product> = {}
    for (const p of products) m[p.sku.toUpperCase()] = p
    return m
  }, [products])
  const skuInfo = (sku: string | null | undefined) => sku ? productBySku[String(sku).trim().toUpperCase()] : undefined

  const load = useCallback(async () => {
    setLoading(true)
    const { data: o } = await sb.from('walmart_board_orders').select('*').eq('archived', false).order('board_position', { ascending: true, nullsFirst: false }).order('name', { ascending: true })
    const orders = (o as WOrder[]) || []
    setRows(orders)
    const { data: l } = await sb.from('walmart_board_lines').select('*').order('line_number', { ascending: true })
    const lm: Record<string, WLine[]> = {}
    ;((l as any[]) || []).forEach(r => { (lm[r.order_id] ||= []).push(r) })
    setLines(lm)
    const { data: pr } = await sb.from('products').select('id, sku, product_name, on_hand_qty, case_qty, weight_per_unit_grams, unit_cost').order('sku', { ascending: true })
    setProducts((pr as Product[]) || [])
    const { data: bm } = await sb.from('product_bom').select('finished_good_sku, component_sku, uom_type, qty_value, percentage, is_case_level')
    setBom((bm as BomRow[]) || [])
    const { data: pl } = await sb.from('walmart_pallets').select('*').order('pallet_number', { ascending: true })
    const pm: Record<string, Pallet[]> = {}
    ;((pl as Pallet[]) || []).forEach(p => { (pm[p.order_id] ||= []).push(p) })
    setPallets(pm)
    const { data: pi } = await sb.from('walmart_pallet_items').select('*')
    const pim: Record<string, PalletItem[]> = {}
    ;((pi as PalletItem[]) || []).forEach(p => { (pim[p.pallet_id] ||= []).push(p) })
    setPalletItems(pim)
    const ids = orders.map(r => r.id)
    if (ids.length) {
      const cc: Record<string, number> = {}; const fc: Record<string, number> = {}
      for (let i = 0; i < ids.length; i += 200) {
        const slice = ids.slice(i, i + 200)
        const { data: cm } = await sb.from('comments').select('record_id').eq('record_type', 'walmart_order').in('record_id', slice)
        ;((cm as any[]) || []).forEach(c => { cc[c.record_id] = (cc[c.record_id] || 0) + 1 })
        const { data: fm } = await sb.from('file_attachments').select('record_id').eq('record_type', 'walmart_order').in('record_id', slice)
        ;((fm as any[]) || []).forEach(f => { fc[f.record_id] = (fc[f.record_id] || 0) + 1 })
      }
      setCommentCounts(cc); setFileCounts(fc)
    }
    setLoading(false)
    sb.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email) })
  }, [sb])
  useEffect(() => { load() }, [load])

  function openDetail(r: WOrder) { setEditing(false); setDetail(r) }
  useItemDeepLink(rows, (r) => openDetail(r as WOrder))
  function closeDetail() { setDetail(null); setEditing(false) }
  const detailLines = detail ? (lines[detail.id] || []) : []
  const detailPallets = detail ? (pallets[detail.id] || []) : []

  function startEdit() {
    if (!detail) return
    const f: any = { name: detail.name ?? '' }
    for (const fld of FIELDS) f[fld.key] = (detail as any)[fld.key] ?? ''
    setForm(f)
    setLineForms(detailLines.map(l => ({ ...l })))
    setEditing(true)
  }
  const setLine = (i: number, patch: Partial<WLine>) => setLineForms(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  const addLine = () => setLineForms(ls => [...ls, { _new: true, part_number: '', qty: null, qty_per_case: null, completed_qty: null, uom: 'SRPs', packaging: 'Packed', production_status: null, cost_each: '', total_cost: '', added_details: '' }])
  const removeLine = (i: number) => setLineForms(ls => ls.filter((_, idx) => idx !== i))

  async function saveRecord() {
    if (!detail) return
    setSaving(true)
    try {
      const clean = (v: any) => { const s = String(v ?? '').trim(); return s === '' ? null : s }
      const patch: any = { name: clean(form.name) ?? detail.name, updated_at: new Date().toISOString() }
      for (const fld of FIELDS) {
        if (fld.kind === 'date') patch[fld.key] = form[fld.key] || null
        else if (fld.kind === 'num' || fld.kind === 'money') { const n = Number(form[fld.key]); patch[fld.key] = form[fld.key] === '' || form[fld.key] == null || isNaN(n) ? null : n }
        else patch[fld.key] = clean(form[fld.key])
      }
      // keep the group in lock-step with the chosen status
      patch.group_name = groupForStatus(patch.status)
      if (lineForms.length) {
        const srpSum = lineForms.reduce((a, l) => a + (Number(l.qty) || 0), 0)
        patch.srp = srpSum
        patch.units = srpSum * UNITS_PER_SRP
        patch.total_value = linesTotalOf(lineForms)
      }
      const { error } = await sb.from('walmart_board_orders').update(patch).eq('id', detail.id)
      if (error) { alert('Save failed: ' + error.message); return }
      const keptIds = lineForms.filter(l => l.id && !l._new).map(l => l.id)
      const toDelete = detailLines.map(l => l.id).filter(id => id && !keptIds.includes(id)) as string[]
      if (toDelete.length) await sb.from('walmart_board_lines').delete().in('id', toDelete)
      for (let i = 0; i < lineForms.length; i++) {
        const l = lineForms[i]
        const num = (v: any) => { const n = Number(v); return v === '' || v == null || isNaN(n) ? null : n }
        const row: any = { order_id: detail.id, part_number: (String(l.part_number ?? '').trim() || null), qty: num(l.qty), qty_per_case: num(l.qty_per_case), completed_qty: num(l.completed_qty), uom: (String(l.uom ?? '').trim() || null), packaging: (String(l.packaging ?? '').trim() || null), production_status: (String(l.production_status ?? '').trim() || null), cost_each: (String(l.cost_each ?? '').trim() || null), total_cost: (String(l.total_cost ?? '').trim() || null), added_details: (String(l.added_details ?? '').trim() || null), line_number: i + 1 }
        if (l._new || !l.id) await sb.from('walmart_board_lines').insert(row)
        else await sb.from('walmart_board_lines').update(row).eq('id', l.id)
      }
      const updated = { ...detail, ...patch }
      setRows(rs => rs.map(r => r.id === detail.id ? updated : r))
      setDetail(updated); setEditing(false)
      await load()
    } finally { setSaving(false) }
  }

  async function deleteRecord() {
    if (!detail) return
    if (!confirm(`Delete "${detail.name}"?\n\nThis permanently removes the order, its line items, pallets and all of its comments. This cannot be undone.`)) return
    setDeleting(true)
    try {
      await sb.from('walmart_pallets').delete().eq('order_id', detail.id)
      await sb.from('walmart_board_lines').delete().eq('order_id', detail.id)
      try { await sb.rpc('delete_record_comments', { p_record_type: 'walmart_order', p_record_id: detail.id }) } catch { /* */ }
      const { error } = await sb.from('walmart_board_orders').delete().eq('id', detail.id)
      if (error) { alert('Delete failed: ' + error.message); return }
      setRows(rs => rs.filter(r => r.id !== detail.id)); closeDetail()
    } finally { setDeleting(false) }
  }

  // ── New order (smart defaults) ─────────────────────────────────────────────
  const pastCarriers = useMemo(() => Array.from(new Set(rows.map(r => (r.carrier || '').trim()).filter(Boolean))).sort(), [rows])
  const nSrpAuto = useMemo(() => nLines.reduce((a, l) => a + (Number(l.qty) || 0), 0), [nLines])
  const nUnitsAuto = useMemo(() => nLines.reduce((a, l) => a + (Number(l.qty) || 0) * UNITS_PER_SRP, 0), [nLines])
  function openNew() {
    setNf({ name: '', po_number: '', carrier: '', commodity_description: DEFAULT_COMMODITY, facility: 'bG - SACA', order_date: new Date().toISOString().slice(0, 10), ship_due_date: '', load_number: '', ship_to: '', pallets: '', srp: '', units: '' })
    setNfTouched({}); setNLines([]); setPoError(''); setPoFileName(''); setFlagged(new Set()); setShowNew(true)
  }

  async function uploadPO(file: File) {
    if (!file) return
    setPoError(''); setPoParsing(true); setPoFileName(file.name)
    try {
      const path = `walmart-po/${Date.now()}_${file.name.replace(/[^A-Za-z0-9._-]/g, '_')}`
      const { error: upErr } = await sb.storage.from('erp-files').upload(path, file, { upsert: true })
      if (upErr) { setPoError('Upload failed: ' + upErr.message); return }
      const r = await fetch('/api/walmart/parse-po', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storagePath: path, fileName: file.name }) })
      const j = await r.json()
      if (!r.ok) { setPoError(j.error || 'Could not read the PO'); return }
      const o = j.order || {}
      const shipTo = o.ship_to || (o.dc_number ? ('Walmart DC ' + o.dc_number) : '')
      setNf((f: any) => ({
        ...f,
        po_number: o.po_number || f.po_number,
        name: nfTouched.name ? f.name : (o.po_number ? `WALMART|${o.po_number}` : f.name),
        order_date: o.order_date || f.order_date,
        ship_due_date: o.ship_due_date || f.ship_due_date,
        carrier: o.carrier || f.carrier,
        commodity_description: o.commodity_description || f.commodity_description || DEFAULT_COMMODITY,
        ship_to: shipTo || f.ship_to,
        load_number: o.load_number || 'Pending Load Assignment',
      }))
      const pls: any[] = Array.isArray(j.lines) ? j.lines : []
      setNLines(pls.map((l: any) => ({ _new: true, part_number: l.sku || l.supplier_item || l.upc || '', qty: l.qty ?? null, qty_per_case: null, completed_qty: null, uom: 'SRPs', packaging: 'Packed', production_status: null, cost_each: '', total_cost: '', added_details: l.description || '' })))
      const flags = new Set<string>()
      if (!o.po_number) flags.add('po_number')
      if (!o.order_date) flags.add('order_date')
      if (!o.ship_due_date) flags.add('ship_due_date')
      if (!o.carrier) flags.add('carrier')
      if (!shipTo) flags.add('ship_to')
      if (pls.length === 0) flags.add('lines')
      else if (pls.some((l: any) => !l.matched)) flags.add('lines_unmatched')
      setFlagged(flags)
    } catch (e) { setPoError('Error reading PO: ' + String(e)) }
    finally { setPoParsing(false) }
  }
  const setNLine = (i: number, patch: Partial<WLine>) => setNLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  const addNLine = () => setNLines(ls => [...ls, { _new: true, part_number: '', qty: null, qty_per_case: null, completed_qty: null, uom: 'SRPs', packaging: 'Packed', production_status: null, cost_each: '', total_cost: '', added_details: '' }])
  const removeNLine = (i: number) => setNLines(ls => ls.filter((_, idx) => idx !== i))
  function onPoChange(v: string) {
    setNf((f: any) => ({ ...f, po_number: v, name: nfTouched.name ? f.name : (v.trim() ? `WALMART|${v.trim()}` : '') }))
  }
  async function createOrder() {
    const name = (nf.name || '').trim() || (nf.po_number ? `WALMART|${String(nf.po_number).trim()}` : '')
    if (!name) { alert('Enter a PO # or an order name.'); return }
    setCreating(true)
    try {
      const srp = nfTouched.srp ? Number(nf.srp) : nSrpAuto
      const units = nfTouched.units ? Number(nf.units) : nUnitsAuto
      const ins: any = {
        name, group_name: 'Walmart Orders', status: 'Pending',
        po_number: (nf.po_number || '').trim() || null, carrier: (nf.carrier || '').trim() || null,
        commodity_description: (nf.commodity_description || '').trim() || DEFAULT_COMMODITY,
        facility: (nf.facility || '').trim() || 'bG - SACA',
        order_date: nf.order_date || null, ship_due_date: nf.ship_due_date || null,
        load_number: (nf.load_number || '').trim() || 'Pending Load Assignment', ship_to: (nf.ship_to || '').trim() || null,
        pallets: (nf.pallets || '').toString().trim() || null,
        srp: isNaN(srp) ? null : srp, units: isNaN(units) ? null : units,
        total_value: linesTotalOf(nLines) || null,
      }
      const { data, error } = await sb.from('walmart_board_orders').insert(ins).select('*').single()
      if (error) { alert('Create failed: ' + error.message); return }
      const oid = (data as WOrder).id
      const toInsert = nLines.filter(l => (l.part_number || '').trim() || Number(l.qty)).map((l, i) => ({
        order_id: oid, part_number: (l.part_number || '').trim() || null, qty: Number(l.qty) || null,
        uom: (l.uom || 'SRPs'), packaging: (l.packaging || 'Packed'), line_number: i + 1,
      }))
      if (toInsert.length) await sb.from('walmart_board_lines').insert(toInsert)
      setShowNew(false)
      await load()
      if (data) openDetail(data as WOrder)
    } finally { setCreating(false) }
  }

  // ── Pallet QR generation ───────────────────────────────────────────────────
  async function generatePallets(order: WOrder) {
    const parsed = parseInt(String(order.pallets || '').match(/\d+/)?.[0] || '0', 10)
    let count = parsed
    const existing = pallets[order.id] || []
    if (!count) {
      const v = prompt('How many pallets to generate QR codes for?', '1')
      count = parseInt(v || '0', 10)
    } else if (existing.length) {
      const v = prompt(`This order already has ${existing.length} pallet(s). How many MORE to add? (leave blank to cancel)`, '')
      count = parseInt(v || '0', 10)
    }
    if (!count || count < 1) return
    setGenBusy(true)
    try {
      const base = existing.length
      const totalAfter = base + count
      const toIns = Array.from({ length: count }, (_, i) => ({ order_id: order.id, pallet_number: base + i + 1, total_pallets: totalAfter }))
      const { error } = await sb.from('walmart_pallets').insert(toIns)
      if (error) { alert('Could not generate pallets: ' + error.message); return }
      if (base) await sb.from('walmart_pallets').update({ total_pallets: totalAfter }).eq('order_id', order.id)
      await load()
    } finally { setGenBusy(false) }
  }
  async function deletePallet(p: Pallet) {
    if (!confirm(`Remove Pallet #${p.pallet_number}? ${p.status === 'complete' ? 'This pallet is already complete; inventory already deducted will NOT be restored.' : ''}`)) return
    await sb.from('walmart_pallets').delete().eq('id', p.id)
    await load()
  }
  async function printPalletQRs(order: WOrder) {
    const pls = pallets[order.id] || []
    if (!pls.length) { alert('Generate pallet QR codes first.'); return }
    const origin = window.location.origin
    const qr: any = await import('qrcode')
    const labels = await Promise.all(pls.map(async p => {
      const url = `${origin}/p/${p.token}`
      let img = ''
      try { img = await qr.toDataURL(url, { width: 600, margin: 1 }) } catch { /* */ }
      return `<div class="label"><div class="hd">Pallet #${p.pallet_number} <span class="of">of ${p.total_pallets}</span></div><div class="nm">${esc(order.name)}</div>${order.po_number ? `<div class="po">PO ${esc(order.po_number)}${order.load_number ? ' · Load ' + esc(order.load_number) : ''}</div>` : ''}<img src="${img}"/><div class="url">Scan to report pallet contents</div></div>`
    }))
    // One QR per 4in x 6in thermal label (portrait), each on its own page.
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(order.name)} — Pallet QR Labels</title>
<style>
@page { size: 4in 6in; margin: 0; }
* { box-sizing: border-box; }
html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif}
.label{width:4in;height:6in;padding:0.22in 0.18in;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;page-break-after:always;break-after:page;overflow:hidden}
.label:last-child{page-break-after:auto;break-after:auto}
.hd{font-size:30px;font-weight:800;line-height:1.05}
.hd .of{font-weight:500;color:#555;font-size:18px}
.nm{font-size:15px;color:#222;margin:4px 6px 0;word-break:break-word}
.po{font-size:13px;color:#555;margin-top:2px}
.label img{width:3.1in;height:3.1in;margin:0.12in 0}
.url{font-size:13px;color:#444}
.toolbar{padding:12px;text-align:center}
@media print{.toolbar{display:none}}
</style></head>
<body><div class="toolbar noprint"><button onclick="window.print()" style="padding:8px 16px;font-size:14px">Print labels (4\u00d76)</button></div>${labels.join('')}</body></html>`
    const w = window.open('', '_blank', 'width=520,height=820'); if (!w) { alert('Allow pop-ups to print the QR labels.'); return }
    w.document.write(html); w.document.close()
  }

  // ── Drag & drop between groups ─────────────────────────────────────────────
  async function moveToGroup(id: string, targetGroup: string) {
    const r = rows.find(x => x.id === id); if (!r) return
    if ((r.group_name || 'Walmart Orders') === targetGroup) return
    let newStatus = r.status
    if (groupForStatus(r.status) !== targetGroup) newStatus = statusForGroup(targetGroup) || r.status
    const patch: any = { group_name: targetGroup, status: newStatus, updated_at: new Date().toISOString() }
    setRows(rs => rs.map(x => x.id === id ? { ...x, ...patch } : x))
    const { error } = await sb.from('walmart_board_orders').update(patch).eq('id', id)
    if (error) { alert('Move failed: ' + error.message); await load() }
  }

  // ── Requirements roll-up ───────────────────────────────────────────────────
  const req = useMemo(() => {
    const included = rows.filter(r => (r.group_name || 'Walmart Orders') !== 'Cancelled')
    const orderById: Record<string, WOrder> = {}
    included.forEach(o => { orderById[o.id] = o })
    // required + by-load, per finished sku
    const required: Record<string, number> = {}
    const byLoad: Record<string, Record<string, number>> = {}
    for (const o of included) {
      const load = (o.load_number || '').trim() || '—'
      for (const l of (lines[o.id] || [])) {
        const sku = (l.part_number || '').trim().toUpperCase()
        const q = Number(l.qty) || 0
        if (!sku || !q) continue
        required[sku] = (required[sku] || 0) + q
        ;(byLoad[sku] ||= {})[load] = (byLoad[sku][load] || 0) + q
      }
    }
    // completed, per finished sku (from pallet items on included orders)
    const completed: Record<string, number> = {}
    for (const [, items] of Object.entries(palletItems)) {
      for (const it of items) {
        if (!orderById[it.order_id]) continue
        const sku = (it.sku || '').trim().toUpperCase()
        completed[sku] = (completed[sku] || 0) + (Number(it.qty) || 0)
      }
    }
    const skus = Array.from(new Set([...Object.keys(required), ...Object.keys(completed)])).sort()
    const fg = skus.map(sku => ({ sku, required: required[sku] || 0, completed: completed[sku] || 0, delta: (required[sku] || 0) - (completed[sku] || 0), byLoad: byLoad[sku] || {} }))
    // components requirement (packaging / BOM) from walmart_bom
    const compReq: Record<string, number> = {}
    for (const [sku, qty] of Object.entries(required)) {
      const fp = productBySku[sku]
      for (const b of bom) {
        if ((b.finished_good_sku || '').trim().toUpperCase() !== sku) continue
        const cs = (b.component_sku || '').trim().toUpperCase()
        if (!cs) continue
        let perUnit = 0
        if (b.uom_type === 'percentage') perUnit = ((Number(b.qty_value ?? b.percentage) || 0) / 100) * (Number(fp?.weight_per_unit_grams) || 0) / 453.592
        else if (b.is_case_level) { const cq = Number(fp?.case_qty) || 0; perUnit = cq > 0 ? (Number(b.qty_value) || 0) / cq : 0 }
        else perUnit = Number(b.qty_value) || 0
        const need = perUnit * qty
        if (need <= 0) continue
        compReq[cs] = (compReq[cs] || 0) + need
      }
    }
    const comps = Object.entries(compReq).map(([sku, reqv]) => {
      const p = productBySku[sku]
      const avail = Number(p?.on_hand_qty ?? NaN)
      const rr = Math.round(reqv * 100) / 100
      return { sku, name: p?.product_name ?? null, req: rr, avail, short: isNaN(avail) ? null : Math.round((avail - rr) * 100) / 100 }
    }).sort((a, b) => a.sku.localeCompare(b.sku))
    return { fg, comps }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, lines, palletItems, bom, products])

  const q = search.trim().toLowerCase()
  const match = (r: WOrder) => !q || [r.name, r.po_number, r.ship_to, r.status, r.load_number, r.bol2].some(v => (v || '').toLowerCase().includes(q))
  const groupRows = (key: string) => rows.filter(r => (r.group_name || 'Walmart Orders') === key && match(r))
  const extra = Array.from(new Set(rows.map(r => r.group_name || 'Walmart Orders').filter(k => k && !GROUPS.some(g => g.key === k))))
  const allGroups = [...GROUPS, ...extra.map(k => ({ key: k, color: '#9699A6' }))]
  const shown = allGroups.reduce((a, g) => a + groupRows(g.key).length, 0)
  const totalVal = rows.reduce((a, r) => a + (Number(r.total_value) || 0), 0)

  const inputCls = 'w-full bg-white border border-[#E4E6EE] rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3B6FE0]/40'
  const cellCls = 'w-full bg-white border border-[#E4E6EE] rounded px-1.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#3B6FE0]/40'
  const fcls = (k: string) => inputCls + (flagged.has(k) ? ' ring-2 ring-red-400 border-red-400' : '')
  const unitCostOf = (sku?: string | null) => { const c = Number(skuInfo(sku)?.unit_cost); return Number.isFinite(c) ? c : null }
  const lineTotalOf = (l: WLine) => { const c = unitCostOf(l.part_number); return c == null ? null : c * (Number(l.qty) || 0) }
  const linesTotalOf = (ls: WLine[]) => ls.reduce((a, l) => a + (unitCostOf(l.part_number) ?? 0) * (Number(l.qty) || 0), 0)
  const completedForOrderSku = (orderId: string, sku?: string | null) => {
    const pls = pallets[orderId] || []
    const key = (sku || '').trim().toUpperCase()
    let t = 0
    for (const p of pls) for (const it of (palletItems[p.id] || [])) if ((it.sku || '').trim().toUpperCase() === key) t += Number(it.qty) || 0
    return t
  }

  function lineWarn(l: WLine) {
    const sku = (l.part_number || '').trim()
    if (!sku) return null
    const p = skuInfo(sku)
    if (!p) return <span className="text-[11px] text-red-500">not in inventory</span>
    const oh = Number(p.on_hand_qty || 0)
    const need = Number(l.qty) || 0
    if (need > oh) return <span className="text-[11px] text-amber-600">on hand {fmtN(oh)} · short {fmtN(need - oh)}</span>
    return <span className="text-[11px] text-emerald-600">on hand {fmtN(oh)}</span>
  }

  function editControl(fld: typeof FIELDS[number]) {
    if (fld.kind === 'status') return <select className={inputCls} value={form.status || ''} onChange={e => setForm((f: any) => ({ ...f, status: e.target.value }))}><option value="">—</option>{STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}</select>
    if (fld.kind === 'date') return <input type="date" className={inputCls} value={form[fld.key] || ''} onChange={e => setForm((f: any) => ({ ...f, [fld.key]: e.target.value }))} />
    if (fld.kind === 'num' || fld.kind === 'money') return <input type="number" step="any" className={inputCls} value={form[fld.key] ?? ''} onChange={e => setForm((f: any) => ({ ...f, [fld.key]: e.target.value }))} />
    if (fld.kind === 'longtext') return <textarea rows={2} className={inputCls + ' resize-none'} value={form[fld.key] ?? ''} onChange={e => setForm((f: any) => ({ ...f, [fld.key]: e.target.value }))} />
    return <input className={inputCls} value={form[fld.key] ?? ''} onChange={e => setForm((f: any) => ({ ...f, [fld.key]: e.target.value }))} />
  }
  const showVal = (fld: typeof FIELDS[number], r: WOrder) => {
    const v = (r as any)[fld.key]
    if (fld.kind === 'date') return fmtD(v)
    if (fld.kind === 'money') return v != null ? fmt$(Number(v)) : <span className="text-gray-300">—</span>
    if (fld.kind === 'num') return v != null ? fmtN(Number(v)) : <span className="text-gray-300">—</span>
    return v || <span className="text-gray-300">—</span>
  }

  const detailIsBuilding = detail ? ((detail.group_name === 'Building Order') || ((detail.status || '').toLowerCase() === 'building order')) : false

  return (
    <div ref={navRef}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div>
          <span className="mon-tag">🛒 Walmart Orders</span>
          <p className="text-gray-500 text-sm mt-1">{loading ? 'Loading…' : `${shown} of ${rows.length} orders · ${fmt$(totalVal)} total value`}</p>
        </div>
        <button onClick={openNew} className="mon-btn">+ New Walmart order</button>
      </div>

      {/* Requirements roll-up */}
      {!loading && (req.fg.length > 0 || req.comps.length > 0) && (
        <div className="bg-white rounded-xl border border-[#ECEEF3] shadow-sm mb-4 overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none bg-[#0F172A]" onClick={() => setShowReq(s => !s)}>
            <span className="text-[10px] text-white" style={{ display: 'inline-block', transform: showReq ? 'rotate(90deg)' : 'none' }}>&#9654;</span>
            <span className="font-bold text-sm text-white">📊 Production Requirements</span>
            <span className="text-[11px] text-white/60 ml-auto">across all active orders · required vs. reported by production</span>
          </div>
          {showReq && (
            <div className="p-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5 px-1">Finished Goods (SRPs)</p>
                <div className="border border-[#EEF0F4] rounded-lg overflow-x-auto">
                  <table className="w-full text-sm min-w-[420px]">
                    <thead><tr className="bg-[#FBFCFE] text-[11px] uppercase text-gray-400"><th className="text-left px-3 py-2">SKU</th><th className="text-right px-3 py-2">Required</th><th className="text-right px-3 py-2">Completed</th><th className="text-right px-3 py-2">Delta</th></tr></thead>
                    <tbody>
                      {req.fg.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-400 text-xs">No line items yet.</td></tr>}
                      {req.fg.map(r => {
                        const loads = Object.entries(r.byLoad)
                        const open = reqExpand[r.sku]
                        return (
                          <FragmentRow key={r.sku}>
                            <tr className="border-t border-[#F0F2F6] hover:bg-[#F8FAFC] cursor-pointer" onClick={() => setReqExpand(x => ({ ...x, [r.sku]: !x[r.sku] }))}>
                              <td className="px-3 py-2 font-mono font-semibold text-[#0F7A4E]"><span className="text-gray-400 mr-1 text-[10px]" style={{ display: 'inline-block', transform: open ? 'rotate(90deg)' : 'none' }}>&#9654;</span>{r.sku}</td>
                              <td className="px-3 py-2 text-right text-gray-700">{fmtN(r.required)}</td>
                              <td className="px-3 py-2 text-right text-emerald-600 font-semibold">{fmtN(r.completed)}</td>
                              <td className={`px-3 py-2 text-right font-semibold ${r.delta > 0 ? 'text-amber-600' : 'text-gray-400'}`}>{r.delta > 0 ? fmtN(r.delta) : '✓ 0'}</td>
                            </tr>
                            {open && loads.map(([load, qv]) => (
                              <tr key={r.sku + load} className="bg-[#FBFCFE] text-[12px]"><td className="px-3 py-1.5 pl-9 text-gray-500">Load {load}</td><td className="px-3 py-1.5 text-right text-gray-500">{fmtN(qv)}</td><td colSpan={2}></td></tr>
                            ))}
                          </FragmentRow>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5 px-1">Packaging / BOM Components</p>
                <div className="border border-[#EEF0F4] rounded-lg overflow-x-auto">
                  <table className="w-full text-sm min-w-[420px]">
                    <thead><tr className="bg-[#FBFCFE] text-[11px] uppercase text-gray-400"><th className="text-left px-3 py-2">Component</th><th className="text-right px-3 py-2">Required</th><th className="text-right px-3 py-2">On Hand</th><th className="text-right px-3 py-2">Status</th></tr></thead>
                    <tbody>
                      {req.comps.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-400 text-xs">No BOM components mapped.</td></tr>}
                      {req.comps.map(c => (
                        <tr key={c.sku} className="border-t border-[#F0F2F6]">
                          <td className="px-3 py-2 font-mono text-gray-700" title={c.name || ''}>{c.sku}</td>
                          <td className="px-3 py-2 text-right text-gray-700">{fmtN(c.req)}</td>
                          <td className="px-3 py-2 text-right text-gray-600">{c.avail == null || isNaN(c.avail) ? '—' : fmtN(c.avail)}</td>
                          <td className="px-3 py-2 text-right">{c.short == null ? <span className="text-gray-300">n/a</span> : c.short >= 0 ? <span className="text-[11px] font-semibold text-emerald-600">OK</span> : <span className="text-[11px] font-semibold text-red-500">short {fmtN(Math.abs(c.short))}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input placeholder="Search name, PO#, ship-to, status, load#…" value={search} onChange={e => setSearch(e.target.value)} className="flex-1 min-w-[240px] max-w-md bg-white border border-[#E4E6EE] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <div className="flex items-center gap-1.5 ml-auto text-xs">
          <span className="text-gray-400 mr-1 hidden sm:inline">Drag an order onto a group to change its status</span>
          <button onClick={() => setCollapsed(Object.fromEntries(allGroups.map(g => [g.key, true])))} className="px-2.5 py-1.5 rounded-md text-gray-500 hover:bg-[#F0F2F7]">Collapse all</button>
          <button onClick={() => setCollapsed({})} className="px-2.5 py-1.5 rounded-md text-gray-500 hover:bg-[#F0F2F7]">Expand all</button>
        </div>
      </div>

      {loading ? <p className="text-gray-400 text-sm">Loading…</p> : (
        <div className="space-y-2.5 mb-6">
          {allGroups.map(group => {
            const gr = groupRows(group.key); const isCol = collapsed[group.key]
            const val = gr.reduce((a, r) => a + (Number(r.total_value) || 0), 0)
            const isDropTarget = dragOver === group.key
            return (
              <div key={group.key} className="bg-white rounded-xl overflow-hidden shadow-sm border" style={{ borderColor: isDropTarget ? group.color : '#ECEEF3', boxShadow: isDropTarget ? `0 0 0 2px ${group.color}55` : undefined }}
                onDragOver={e => { if (draggedId) { e.preventDefault(); setDragOver(group.key) } }}
                onDragLeave={() => setDragOver(d => d === group.key ? null : d)}
                onDrop={e => { e.preventDefault(); if (draggedId) moveToGroup(draggedId, group.key); setDraggedId(null); setDragOver(null) }}>
                <div className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none" style={{ background: group.color + '14', borderLeft: '5px solid ' + group.color }} onClick={() => setCollapsed(c => ({ ...c, [group.key]: !c[group.key] }))}>
                  <span className="text-[10px]" style={{ color: group.color, display: 'inline-block', transform: isCol ? 'none' : 'rotate(90deg)' }}>&#9654;</span>
                  <span className="font-bold text-sm" style={{ color: group.color }}>{group.key}</span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: group.color + '26', color: group.color }}>{gr.length}</span>
                  {val > 0 && <span className="ml-auto text-[11px] text-gray-400">{fmt$(val)}</span>}
                </div>
                {!isCol && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[1040px]">
                      <thead>
                        <tr className="border-b border-[#EEF0F4] text-[11px] uppercase tracking-wide text-gray-400 bg-[#FBFCFE]">
                          <th className="text-left font-semibold px-4 py-2 min-w-[180px]">Order</th>
                          <th className="text-left font-semibold px-3 py-2 w-[190px]">Status</th>
                          <th className="text-left font-semibold px-3 py-2 w-[110px]">PO #</th>
                          <th className="text-left font-semibold px-3 py-2 min-w-[220px]">Ship To</th>
                          <th className="text-left font-semibold px-3 py-2 w-[110px]">Ship Due</th>
                          <th className="text-left font-semibold px-3 py-2 w-[100px]">Carrier</th>
                          <th className="text-right font-semibold px-3 py-2 w-[110px]">Total Value</th>
                          <th className="text-left font-semibold px-3 py-2 w-[70px]">Files</th>
                          <th className="text-left font-semibold px-3 py-2 w-[80px]">Comments</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EAECF2]">
                        {gr.map((r, i) => {
                          const sc = statusColor(r.status)
                          const nf2 = fileCounts[r.id] || 0; const nc = commentCounts[r.id] || 0
                          const dragging = draggedId === r.id
                          return (
                            <tr key={r.id} id={'item-' + r.id} draggable
                              onDragStart={e => { setDraggedId(r.id); e.dataTransfer.effectAllowed = 'move' }}
                              onDragEnd={() => { setDraggedId(null); setDragOver(null) }}
                              className={`cursor-pointer hover:bg-[#F2F6FF] ${i % 2 ? 'bg-[#F8FAFC]' : 'bg-white'} ${dragging ? 'opacity-40' : ''}`} onClick={() => openDetail(r)}>
                              <td className="px-4 py-2.5 text-[13px] font-semibold text-[#1A1D2E]"><span className="text-gray-300 mr-1.5 cursor-grab" title="Drag to another group">⠿</span>{r.name}</td>
                              <td className="px-3 py-2.5"><span className="text-[11px] font-semibold rounded-full px-2.5 py-1 inline-block" style={{ background: sc.bg, color: sc.fg }}>{r.status || '—'}</span></td>
                              <td className="px-3 py-2.5 text-[13px] font-mono text-gray-600">{r.po_number || '—'}</td>
                              <td className="px-3 py-2.5 text-[12px] text-gray-500 truncate max-w-[260px]">{r.ship_to || '—'}</td>
                              <td className="px-3 py-2.5 text-[13px] text-gray-600">{fmtD(r.ship_due_date)}</td>
                              <td className="px-3 py-2.5 text-[13px] text-gray-600">{r.carrier || '—'}</td>
                              <td className="px-3 py-2.5 text-[13px] text-gray-700 text-right font-semibold">{r.total_value != null ? fmt$(Number(r.total_value)) : '—'}</td>
                              <td className="px-3 py-2.5">{nf2 ? <span className="text-[#3B6FE0] text-xs font-semibold">📎 {nf2}</span> : <span className="text-gray-300">—</span>}</td>
                              <td className="px-3 py-2.5">{nc ? <span className="text-emerald-600 text-xs font-semibold">💬 {nc}</span> : <span className="text-gray-300">—</span>}</td>
                            </tr>
                          )
                        })}
                        {gr.length === 0 && <tr><td colSpan={9} className="px-4 py-4 text-center text-gray-400 text-xs italic">{draggedId ? 'Drop here to move the order into this group' : 'No orders'}</td></tr>}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* New order modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: 'rgba(26,32,53,0.5)' }} onClick={() => !creating && setShowNew(false)}>
          <div className="relative w-full max-w-[720px] my-6 bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 text-white" style={{ background: '#0086C0' }}>
              <h2 className="text-lg font-bold">New Walmart Order</h2>
              <button onClick={() => !creating && setShowNew(false)} className="text-white/80 hover:text-white text-2xl leading-none">&times;</button>
            </div>
            <div className="px-6 py-4 max-h-[76vh] overflow-y-auto space-y-4">
              <div className="rounded-lg border-2 border-dashed border-[#CBD5E1] bg-[#F8FAFC] p-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <label className={`text-sm font-semibold px-3 py-1.5 rounded-lg ${poParsing ? 'bg-gray-100 text-gray-400 cursor-wait' : 'bg-[#EAF0FC] text-[#0086C0] hover:bg-[#DCE7FB] cursor-pointer'}`}>
                    {poParsing ? 'Reading PO…' : '📄 Upload Walmart PO'}
                    <input type="file" accept=".pdf,image/*" className="hidden" disabled={poParsing} onChange={e => { const fl = e.target.files?.[0]; if (fl) uploadPO(fl); e.currentTarget.value = '' }} />
                  </label>
                  <span className="text-xs text-gray-500">{poFileName || 'PDF or image — auto-fills the fields below'}</span>
                </div>
                {poError && <p className="text-xs text-red-500 mt-2">{poError}</p>}
              </div>
              {flagged.size > 0 && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">
                  Couldn&apos;t read everything from the PO — please review the fields highlighted in red: {[
                    flagged.has('po_number') && 'PO #',
                    flagged.has('order_date') && 'Order Date',
                    flagged.has('ship_due_date') && 'Ship Due',
                    flagged.has('carrier') && 'Carrier',
                    flagged.has('ship_to') && 'Ship To',
                    flagged.has('lines') && 'Line items (none found)',
                    flagged.has('lines_unmatched') && 'some SKUs not matched to inventory',
                  ].filter(Boolean).join(', ')}.
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <label><span className="text-[11px] uppercase tracking-wide text-gray-400">PO #</span><input className={fcls('po_number')} value={nf.po_number} onChange={e => onPoChange(e.target.value)} placeholder="e.g. 1234567890" /></label>
                <label className="col-span-1 sm:col-span-2"><span className="text-[11px] uppercase tracking-wide text-gray-400">Order Name <span className="text-gray-300 normal-case">(auto from PO#)</span></span><input className={inputCls} value={nf.name} onChange={e => { setNfTouched(t => ({ ...t, name: true })); setNf((f: any) => ({ ...f, name: e.target.value })) }} placeholder="WALMART|…" /></label>
                <label><span className="text-[11px] uppercase tracking-wide text-gray-400">Carrier</span><input list="wm-carriers" className={fcls('carrier')} value={nf.carrier} onChange={e => setNf((f: any) => ({ ...f, carrier: e.target.value }))} placeholder="Pick or type" /><datalist id="wm-carriers">{pastCarriers.map(c => <option key={c} value={c} />)}</datalist></label>
                <label><span className="text-[11px] uppercase tracking-wide text-gray-400">Order Date</span><input type="date" className={fcls('order_date')} value={nf.order_date} onChange={e => setNf((f: any) => ({ ...f, order_date: e.target.value }))} /></label>
                <label><span className="text-[11px] uppercase tracking-wide text-gray-400">Ship Due</span><input type="date" className={fcls('ship_due_date')} value={nf.ship_due_date} onChange={e => setNf((f: any) => ({ ...f, ship_due_date: e.target.value }))} /></label>
                <label><span className="text-[11px] uppercase tracking-wide text-gray-400">Load #</span><input className={inputCls} value={nf.load_number} onChange={e => setNf((f: any) => ({ ...f, load_number: e.target.value }))} /></label>
                <label><span className="text-[11px] uppercase tracking-wide text-gray-400"># Pallets</span><input className={inputCls} value={nf.pallets} onChange={e => setNf((f: any) => ({ ...f, pallets: e.target.value }))} placeholder="e.g. 3" /></label>
                <label><span className="text-[11px] uppercase tracking-wide text-gray-400">Facility</span><input className={inputCls} value={nf.facility} onChange={e => setNf((f: any) => ({ ...f, facility: e.target.value }))} /></label>
                <label className="col-span-2 sm:col-span-3"><span className="text-[11px] uppercase tracking-wide text-gray-400">Ship To</span><input className={fcls('ship_to')} value={nf.ship_to} onChange={e => setNf((f: any) => ({ ...f, ship_to: e.target.value }))} /></label>
                <label className="col-span-2 sm:col-span-3"><span className="text-[11px] uppercase tracking-wide text-gray-400">Commodity Description</span><input className={inputCls} value={nf.commodity_description} onChange={e => setNf((f: any) => ({ ...f, commodity_description: e.target.value }))} /></label>
                <label><span className="text-[11px] uppercase tracking-wide text-gray-400">SRP <span className="text-gray-300 normal-case">(auto)</span></span><input type="number" className={inputCls} value={nfTouched.srp ? nf.srp : nSrpAuto} onChange={e => { setNfTouched(t => ({ ...t, srp: true })); setNf((f: any) => ({ ...f, srp: e.target.value })) }} /></label>
                <label><span className="text-[11px] uppercase tracking-wide text-gray-400">Units <span className="text-gray-300 normal-case">(SRP×{UNITS_PER_SRP})</span></span><input type="number" className={inputCls} value={nfTouched.units ? nf.units : nUnitsAuto} onChange={e => { setNfTouched(t => ({ ...t, units: true })); setNf((f: any) => ({ ...f, units: e.target.value })) }} /></label>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Line Items (SKUs)</p>
                  <button onClick={addNLine} className="text-xs px-2.5 py-1 rounded-lg bg-[#EAF0FC] text-[#3B6FE0] font-semibold hover:bg-[#DCE7FB]">＋ Add line</button>
                </div>
                <div className="border border-[#EEF0F4] rounded-lg overflow-x-auto">
                  <table className="w-full text-sm min-w-[520px]">
                    <thead><tr className="bg-[#FBFCFE] text-[11px] uppercase text-gray-400"><th className="text-left px-2 py-2">SKU</th><th className="text-left px-2 py-2 w-[100px]">Qty (SRPs)</th><th className="text-right px-2 py-2 w-[90px]">Unit Cost</th><th className="text-right px-2 py-2 w-[100px]">Line Total</th><th className="text-left px-2 py-2">Inventory</th><th className="px-1 py-2 w-[32px]"></th></tr></thead>
                    <tbody>
                      {nLines.map((l, i) => (
                        <tr key={'n' + i} className="border-t border-[#F0F2F6]">
                          <td className="px-2 py-1.5"><input list="wm-skus" className={cellCls + ' font-mono'} value={l.part_number ?? ''} onChange={e => setNLine(i, { part_number: e.target.value })} placeholder="Pick SKU" /></td>
                          <td className="px-2 py-1.5"><input type="number" className={cellCls} value={l.qty ?? ''} onChange={e => setNLine(i, { qty: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                          <td className="px-2 py-1.5 text-right text-gray-600">{fmt$(unitCostOf(l.part_number))}</td>
                          <td className="px-2 py-1.5 text-right font-semibold text-gray-700">{fmt$(lineTotalOf(l))}</td>
                          <td className="px-2 py-1.5">{lineWarn(l) || <span className="text-gray-300 text-[11px]">—</span>}</td>
                          <td className="px-1 py-1.5 text-center"><button onClick={() => removeNLine(i)} className="text-gray-300 hover:text-red-500 text-base leading-none">×</button></td>
                        </tr>
                      ))}
                      {nLines.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-400 text-sm">Add SKUs — SRP &amp; Units auto-calculate.</td></tr>}
                    </tbody>
                    {nLines.length > 0 && <tfoot><tr className="border-t-2 border-[#E4E6EE] bg-[#FBFCFE] font-semibold"><td className="px-2 py-2 text-right text-gray-500" colSpan={3}>Order Total</td><td className="px-2 py-2 text-right text-emerald-700">{fmt$(linesTotalOf(nLines))}</td><td colSpan={2}></td></tr></tfoot>}
                  </table>
                </div>
                <datalist id="wm-skus">{products.map(p => <option key={p.id} value={p.sku}>{p.product_name || ''}</option>)}</datalist>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[#EEF0F4]">
              <button onClick={() => setShowNew(false)} disabled={creating} className="text-sm px-4 py-2 rounded-lg border border-[#E4E6EE] text-gray-600 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
              <button onClick={createOrder} disabled={creating} className="text-sm px-4 py-2 rounded-lg text-white font-semibold disabled:opacity-50" style={{ background: '#0086C0' }}>{creating ? 'Creating…' : 'Create order'}</button>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: 'rgba(26,32,53,0.5)' }} >
          <div className="relative w-full max-w-[900px] my-6 bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between px-6 py-4 text-white" style={{ background: statusColor(detail.status).solid || '#0086C0' }}>
              <div className="min-w-0">
                <p className="text-white/70 text-xs uppercase tracking-wide">Walmart Order · {detail.group_name || '—'}</p>
                <h2 className="text-xl font-bold leading-tight">{detail.name}</h2>
                {detail.status && <span className="inline-block mt-1.5 text-[11px] font-semibold rounded-full px-2.5 py-0.5" style={{ background: 'rgba(255,255,255,0.25)' }}>{detail.status}</span>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!editing && (
                  <>
                    <button onClick={startEdit} className="text-xs font-semibold rounded-lg px-3 py-1.5 bg-white/15 hover:bg-white/25 transition-colors">✎ Edit</button>
                    <button onClick={deleteRecord} disabled={deleting} className="text-xs font-semibold rounded-lg px-3 py-1.5 bg-white/15 hover:bg-red-500 disabled:opacity-50 transition-colors">{deleting ? 'Deleting…' : '🗑 Delete'}</button>
                  </>
                )}
                <button onClick={closeDetail} className="text-white/80 hover:text-white text-2xl leading-none pl-1">&times;</button>
              </div>
            </div>

            <div className="px-6 py-4 max-h-[76vh] overflow-y-auto space-y-5">
              <div className="-mt-1"><ShareLink id={detail.id} /></div>

              {editing ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  <label className="col-span-2 sm:col-span-3"><span className="text-[11px] uppercase tracking-wide text-gray-400">Order Name</span><input className={inputCls} value={form.name} onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))} /></label>
                  {FIELDS.map(fld => (<label key={String(fld.key)} className={fld.wide ? 'col-span-2 sm:col-span-3' : ''}><span className="text-[11px] uppercase tracking-wide text-gray-400">{fld.label}</span>{editControl(fld)}</label>))}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                  {FIELDS.map(fld => (
                    <div key={String(fld.key)} className={fld.wide ? 'col-span-2 sm:col-span-3' : ''}>
                      <p className="text-[11px] uppercase tracking-wide text-gray-400">{fld.label}</p>
                      <p className="text-gray-800 mt-0.5 break-words whitespace-pre-wrap">{showVal(fld, detail)}</p>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Order Details (SKUs)</p>
                  {editing && <button onClick={addLine} className="text-xs px-2.5 py-1 rounded-lg bg-[#EAF0FC] text-[#3B6FE0] font-semibold hover:bg-[#DCE7FB]">＋ Add line</button>}
                </div>
                {editing ? (
                  <div className="border border-[#EEF0F4] rounded-lg overflow-x-auto">
                    <table className="w-full text-sm min-w-[680px]">
                      <thead><tr className="bg-[#FBFCFE] text-[11px] uppercase text-gray-400"><th className="text-left px-2 py-2">SKU</th><th className="text-left px-2 py-2 w-[70px]">Qty</th><th className="text-left px-2 py-2 w-[70px]">UOM</th><th className="text-left px-2 py-2 w-[80px]">Packaging</th><th className="text-right px-2 py-2 w-[80px]">Unit Cost</th><th className="text-right px-2 py-2 w-[90px]">Line Total</th><th className="text-left px-2 py-2">Inventory</th><th className="px-1 py-2 w-[32px]"></th></tr></thead>
                      <tbody>
                        {lineForms.map((l, i) => (
                          <tr key={l.id || 'n' + i} className="border-t border-[#F0F2F6]">
                            <td className="px-2 py-1.5"><input list="wm-skus" className={cellCls + ' font-mono'} value={l.part_number ?? ''} onChange={e => setLine(i, { part_number: e.target.value })} /></td>
                            <td className="px-2 py-1.5"><input type="number" className={cellCls} value={l.qty ?? ''} onChange={e => setLine(i, { qty: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                            <td className="px-2 py-1.5"><input className={cellCls} value={l.uom ?? ''} onChange={e => setLine(i, { uom: e.target.value })} /></td>
                            <td className="px-2 py-1.5"><input className={cellCls} value={l.packaging ?? ''} onChange={e => setLine(i, { packaging: e.target.value })} /></td>
                            <td className="px-2 py-1.5 text-right text-gray-600">{fmt$(unitCostOf(l.part_number))}</td>
                            <td className="px-2 py-1.5 text-right font-semibold text-gray-700">{fmt$(lineTotalOf(l))}</td>
                            <td className="px-2 py-1.5">{lineWarn(l) || <span className="text-gray-300 text-[11px]">—</span>}</td>
                            <td className="px-1 py-1.5 text-center"><button onClick={() => removeLine(i)} className="text-gray-300 hover:text-red-500 text-base leading-none" title="Remove">×</button></td>
                          </tr>
                        ))}
                        {lineForms.length === 0 && <tr><td colSpan={8} className="px-3 py-4 text-center text-gray-400 text-sm">No lines. Click “＋ Add line”.</td></tr>}
                      </tbody>
                      {lineForms.length > 0 && <tfoot><tr className="border-t-2 border-[#E4E6EE] bg-[#FBFCFE] font-semibold"><td className="px-2 py-2 text-right text-gray-500" colSpan={5}>Order Total</td><td className="px-2 py-2 text-right text-emerald-700">{fmt$(linesTotalOf(lineForms))}</td><td colSpan={2}></td></tr></tfoot>}
                    </table>
                    <datalist id="wm-skus">{products.map(p => <option key={p.id} value={p.sku}>{p.product_name || ''}</option>)}</datalist>
                  </div>
                ) : detailLines.length === 0 ? <p className="text-sm text-gray-400">No order detail lines.</p> : (
                  <div className="border border-[#EEF0F4] rounded-lg overflow-x-auto">
                    <table className="w-full text-sm min-w-[720px]">
                      <thead><tr className="bg-[#FBFCFE] text-[11px] uppercase text-gray-400"><th className="text-left px-3 py-2">SKU</th><th className="text-right px-3 py-2">Ordered</th><th className="text-right px-3 py-2">Completed</th><th className="text-right px-3 py-2">Remaining</th><th className="text-left px-3 py-2">UOM</th><th className="text-right px-3 py-2">Unit Cost</th><th className="text-right px-3 py-2">Line Total</th><th className="text-right px-3 py-2">On Hand</th></tr></thead>
                      <tbody>
                        {detailLines.map(l => { const p = skuInfo(l.part_number); const done = completedForOrderSku(detail.id, l.part_number); const ordered = Number(l.qty) || 0; const remaining = Math.max(0, ordered - done); return (<tr key={l.id} className="border-t border-[#F0F2F6]"><td className="px-3 py-2 font-mono text-emerald-600">{l.part_number || '—'}</td><td className="px-3 py-2 text-right text-gray-700">{l.qty ?? '—'}</td><td className="px-3 py-2 text-right font-semibold text-emerald-600">{fmtN(done)}</td><td className={`px-3 py-2 text-right font-semibold ${remaining > 0 ? 'text-amber-600' : 'text-gray-400'}`}>{remaining > 0 ? fmtN(remaining) : '✓ 0'}</td><td className="px-3 py-2 text-gray-600">{l.uom || '—'}</td><td className="px-3 py-2 text-right text-gray-600">{fmt$(unitCostOf(l.part_number))}</td><td className="px-3 py-2 text-right font-semibold text-gray-700">{fmt$(lineTotalOf(l))}</td><td className="px-3 py-2 text-right text-gray-500">{p ? fmtN(p.on_hand_qty) : <span className="text-red-400">not in inv</span>}</td></tr>) })}
                      </tbody>
                      <tfoot><tr className="border-t-2 border-[#E4E6EE] bg-[#FBFCFE] font-semibold"><td className="px-3 py-2 text-right text-gray-500" colSpan={6}>Order Total</td><td className="px-3 py-2 text-right text-emerald-700">{fmt$(linesTotalOf(detailLines))}</td><td></td></tr></tfoot>
                    </table>
                  </div>
                )}
              </div>

              {/* Pallet build — only in Building Order */}
              {detailIsBuilding && (
                <div className="border border-[#FDE9CC] bg-[#FFFBF3] rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#9A5B00]">🏗 Pallet Build &amp; QR Codes</p>
                    <div className="flex items-center gap-2">
                      <button onClick={() => generatePallets(detail)} disabled={genBusy} className="text-xs px-2.5 py-1 rounded-lg bg-[#FDAB3D] text-white font-semibold hover:bg-[#E89B2E] disabled:opacity-50">{genBusy ? 'Working…' : '＋ Generate pallet QR codes'}</button>
                      {detailPallets.length > 0 && <button onClick={() => printPalletQRs(detail)} className="text-xs px-2.5 py-1 rounded-lg bg-white border border-[#E4C48A] text-[#9A5B00] font-semibold hover:bg-[#FFF3E0]">🖨 Print QR labels (4×6)</button>}
                    </div>
                  </div>
                  {detailPallets.length === 0 ? (
                    <p className="text-sm text-gray-500">No pallets yet. Enter the pallet count in the “Pallets” field, then generate QR codes for the production team to scan.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {detailPallets.map(p => {
                        const its = palletItems[p.id] || []
                        const tot = its.reduce((a, it) => a + Number(it.qty || 0), 0)
                        return (
                          <div key={p.id} className="bg-white border border-[#EFE3CC] rounded-lg px-3 py-2 text-sm">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-[#1A1D2E]">Pallet #{p.pallet_number} <span className="text-gray-400 font-normal">of {p.total_pallets}</span></span>
                              {p.status === 'complete'
                                ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">COMPLETE{p.completed_by ? ' · ' + p.completed_by : ''}</span>
                                : <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">PENDING</span>}
                              <a href={`/p/${p.token}`} target="_blank" rel="noreferrer" className="text-[11px] text-[#3B6FE0] hover:underline ml-1">open scan page ↗</a>
                              <button onClick={() => deletePallet(p)} className="ml-auto text-gray-300 hover:text-red-500 text-base leading-none" title="Remove pallet">×</button>
                            </div>
                            {its.length > 0 && (
                              <div className="mt-1 text-[12px] text-gray-600">
                                {its.map(it => <span key={it.id} className="inline-block mr-3"><span className="font-mono text-[#0F7A4E]">{it.sku}</span> ×{fmtN(it.qty)}</span>)}
                                <span className="text-gray-400">· {fmtN(tot)} SRPs</span>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {editing && (
                <div className="flex items-center justify-between gap-3 border-t border-[#EEF0F4] pt-4">
                  <button onClick={deleteRecord} disabled={deleting || saving} className="text-xs font-semibold rounded-lg px-3 py-2 text-red-600 hover:bg-red-50 disabled:opacity-50">{deleting ? 'Deleting…' : '🗑 Delete order'}</button>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setEditing(false)} disabled={saving} className="text-sm px-4 py-2 rounded-lg border border-[#E4E6EE] text-gray-600 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
                    <button onClick={saveRecord} disabled={saving} className="text-sm px-4 py-2 rounded-lg text-white font-semibold disabled:opacity-50" style={{ background: '#0086C0' }}>{saving ? 'Saving…' : 'Save changes'}</button>
                  </div>
                </div>
              )}

              <div className="border-t border-[#EEF0F4] pt-4">
                <FileUpload supabase={sb} recordType="walmart_order" recordId={detail.id} currentUserEmail={userEmail} />
              </div>
              <div className="border-t border-[#EEF0F4] pt-4">
                <Comments recordId={detail.id} recordType="walmart_order" currentUserEmail={userEmail} title="Notes & Comments" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FragmentRow({ children }: { children: React.ReactNode }) { return <>{children}</> }
