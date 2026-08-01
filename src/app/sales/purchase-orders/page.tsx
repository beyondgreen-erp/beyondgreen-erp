'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { getFileUrl } from '@/lib/fileHelpers'
import Comments from '@/components/Comments'

const GROUPS = [
  { key: 'group_mkr363e4', title: 'Imports', color: '#007eb5' },
  { key: 'group_mkzk3jaa', title: '2026 - PO & Receiving Log', color: '#00c875' },
  { key: 'new_group_mkkttdvf', title: '2025 - PO & Receiving Log', color: '#fdab3d' },
  { key: 'group_mkq991my', title: 'Receiving Log', color: '#5559df' },
]

const STATUS_COLORS: Record<string, string> = {
  'PO Issued': '#fdab3d', 'Received': '#00c875', 'In Transit - Ocean / Air': '#df2f4a', 'Delayed': '#bb3354',
  'Short Ship': '#9d50dd', 'PO Canceled': '#7f5347', 'Partial Received': '#579bfc', "Verification Req'd": '#ff007f',
  'Awaiting Shipment': '#ffcb00', 'Pending Review': '#333333', 'Ready for Pick-Up': '#4eccc6', 'Order Placed': '#cab641',
  'Pending Order': '#ff6d3b', 'Missing Item': '#784bd1', 'Return': '#ff5ac4', 'Vendor Shipped': '#66ccff',
  'In Transit - Domestic Road': '#7e3b8a', 'In Making': '#037f4c', 'PO Merged with Export Invoice': '#9cd326',
  'ON HOLD': '#ff7575', 'Awaiting Release': '#faa1f1', 'Arrived at Port': '#ffadad', 'Released awaiting to ship': '#bda8f9',
}
const LOC_COLORS: Record<string, string> = {
  'SAN ANTONIO, TX': '#5559df', 'SANTA ANA, CA': '#00c875', 'SNA -> SATX': '#df2f4a', 'SNA & SATX': '#007eb5',
}
const STATUS_OPTIONS = Object.keys(STATUS_COLORS)
const LOCATION_OPTIONS = Object.keys(LOC_COLORS)
const PO_REQUIRED_OPTIONS = ['Yes', 'No', 'Unsure']
const statusColor = (s: string | null) => (s && STATUS_COLORS[s]) || '#c4c4c4'
const fmtDate = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

type LineItem = {
  key: string
  mode: 'search' | 'new'
  productId: string
  itemName: string
  partNumber: string
  description: string
  qty: string
  addToInventory: boolean
}
function newKey() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}
function blankItem(): LineItem {
  return { key: newKey(), mode: 'search', productId: '', itemName: '', partNumber: '', description: '', qty: '', addToInventory: true }
}

const emptyCreate = {
  group_key: 'group_mkzk3jaa',
  location: 'SAN ANTONIO, TX',
  status: 'Pending Order',
  person_requesting: '',
  po_required: 'Yes',
  po_number: '',
  customer_project: '',
  po_date: '',
  // vendor
  vendorMode: 'search' as 'search' | 'new',
  vendorId: '',
  vendorName: '',
  // one or more line items
  items: [blankItem()] as LineItem[],
}
type CreateForm = typeof emptyCreate

function supabaseError(error: { code?: string; message: string; details?: string; hint?: string }) {
  const parts = [error.message]
  if (error.code) parts.push(`(code: ${error.code})`)
  if (error.details) parts.push(error.details)
  if (error.hint) parts.push(`Hint: ${error.hint}`)
  console.error('[Supabase error]', error)
  return parts.join(' — ')
}

export default function PurchasingRequestsPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<any[]>([])
  const [items, setItems] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [vendors, setVendors] = useState<any[]>([])
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [detail, setDetail] = useState<any | null>(null)
  const [editForm, setEditForm] = useState<any>({})
  const [savingDetail, setSavingDetail] = useState(false)
  const [userEmail, setUserEmail] = useState('')

  // create-modal state
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<CreateForm>(emptyCreate)
  const [saving, setSaving] = useState(false)
  const [createError, setCreateError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: o }, { data: it }, { data: cm }, { data: pr }, { data: vn }] = await Promise.all([
      sb.from('purchasing_requests').select('*').order('position', { nullsFirst: false }),
      sb.from('purchasing_request_items').select('*').order('position', { nullsFirst: false }),
      sb.from('comments').select('record_id').eq('record_type', 'purchasing_request'),
      sb.from('products').select('id,sku,product_name,unit_cost,vendor_id').order('product_name', { ascending: true }),
      sb.from('vendors').select('id,company_name,is_active').order('company_name', { ascending: true }),
    ])
    setRows(o || []); setItems(it || [])
    setProducts(pr || []); setVendors(vn || [])
    const counts: Record<string, number> = {}
    ;(cm || []).forEach((c: any) => { counts[c.record_id] = (counts[c.record_id] || 0) + 1 })
    setCommentCounts(counts)
    setLoading(false)
    sb.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email) })
  }, [sb])
  useEffect(() => { load() }, [load])

  const itemsOf = (oid: string) => items.filter(i => i.parent_id === oid).sort((a, b) => (a.position || 0) - (b.position || 0))
  useEffect(() => { setEditForm(detail ? { ...detail } : {}) }, [detail])
  const DETAIL_KEYS = ['person_requesting','po_required','po_number','customer_project','supplier','supplier_pn','po_date','qty_ordered','date_received','qty_received','balance','pkgs_received','condition_received','received_by','batch_lot','location'] as const
  async function saveDetail() {
    if (!detail) return
    setSavingDetail(true)
    const patch: any = {}
    for (const k of DETAIL_KEYS) { const v = editForm[k]; patch[k] = (v === '' || v === undefined) ? null : v }
    const { error } = await sb.from('purchasing_requests').update(patch).eq('id', detail.id)
    setSavingDetail(false)
    if (error) { alert('Save failed: ' + error.message); return }
    setRows((rs: any[]) => rs.map(r => r.id === detail.id ? { ...r, ...patch } : r))
    setDetail((d: any) => ({ ...d, ...patch }))
  }
  const updateStatus = async (id: string, status: string) => {
    // When an item is marked "Received" or "PO Canceled", auto-file it under the Receiving Log group.
    const RECEIVING_LOG = GROUPS.find(g => g.title === 'Receiving Log')!
    const moveToLog = status === 'Received' || status === 'PO Canceled' || status === 'PO Cancelled'
    const patch: any = { status: status || null }
    if (moveToLog) {
      const posBase = Math.max(0, ...rows.filter(r => r.group_key === RECEIVING_LOG.key).map(r => Number(r.position) || 0)) + 1
      patch.group_key = RECEIVING_LOG.key
      patch.group_title = RECEIVING_LOG.title
      patch.position = posBase
    }
    setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r))
    setDetail((d: any) => d && d.id === id ? { ...d, ...patch } : d)
    await sb.from('purchasing_requests').update(patch).eq('id', id)
    if (moveToLog) setCollapsed(c => ({ ...c, [RECEIVING_LOG.key]: false }))
  }
  const match = (r: any) => {
    if (!q) return true
    const s = q.toLowerCase()
    return ['name', 'status', 'location', 'po_number', 'supplier', 'supplier_pn', 'person_requesting', 'customer_project', 'batch_lot', 'received_by'].some(k => String(r[k] ?? '').toLowerCase().includes(s))
      || itemsOf(r.id).some(i => [i.part_number, i.description].some(v => String(v ?? '').toLowerCase().includes(s)))
  }
  const groupRows = (key: string) => rows
    .filter(r => r.group_key === key && match(r))
    // Newest PO date first; entries without a PO date sink to the bottom.
    .sort((a, b) => {
      const da = a.po_date || '', db = b.po_date || ''
      if (!da && !db) return (Number(a.position) || 0) - (Number(b.position) || 0)
      if (!da) return 1
      if (!db) return -1
      return db.localeCompare(da)
    })
  const filesOf = (r: any) => [...((r.receiving_docs || []) as any[]).map((f: any) => ({ ...f, tag: 'Receiving Doc' })), ...((r.attachments || []) as any[]).map((f: any) => ({ ...f, tag: 'From Comments' }))]

  async function openFile(f: any) {
    const url = await getFileUrl(sb, f.path)
    if (url) window.open(url, '_blank'); else alert('Could not open the file.')
  }

  // ── Create request ─────────────────────────────────────────
  function openCreate() {
    setForm({ ...emptyCreate, po_date: new Date().toISOString().slice(0, 10), items: [blankItem()] })
    setCreateError('')
    setShowCreate(true)
  }

  function updateItem(key: string, patch: Partial<LineItem>) {
    setForm(f => ({ ...f, items: f.items.map(it => it.key === key ? { ...it, ...patch } : it) }))
  }
  function addItem() { setForm(f => ({ ...f, items: [...f.items, blankItem()] })) }
  function removeItem(key: string) { setForm(f => ({ ...f, items: f.items.length > 1 ? f.items.filter(it => it.key !== key) : f.items })) }
  function pickProduct(key: string, p: any) {
    updateItem(key, { productId: p.id, itemName: p.product_name || '', partNumber: p.sku || '' })
  }

  async function createRequest() {
    // Resolve every line item from its mode (inventory pick vs. new item)
    const resolved = form.items.map(it => {
      const prod = it.mode === 'search' ? products.find(p => p.id === it.productId) : null
      return {
        it,
        name: (it.mode === 'search' ? (prod?.product_name || '') : it.itemName).trim(),
        partNumber: (it.mode === 'search' ? (prod?.sku || '') : it.partNumber).trim(),
        description: it.description.trim(),
        qty: it.qty.trim(),
      }
    }).filter(r => r.name)
    if (resolved.length === 0) { setCreateError('Add at least one item — choose from inventory or enter a new item name.'); return }

    const vendorName = form.vendorName.trim()
    if (form.vendorMode === 'new' && !vendorName) { setCreateError('Enter the new vendor / supplier name, or switch to "Existing vendor".'); return }

    setCreateError('')
    setSaving(true)

    // 1) New vendor → add to vendor board
    let vendorId: string | null = form.vendorId || null
    if (form.vendorMode === 'new' && vendorName) {
      const { data, error } = await sb.from('vendors')
        .insert({ company_name: vendorName, is_active: true, notes: 'Added from Purchasing Requests' })
        .select('id, company_name').single()
      if (error) { setCreateError('Vendor: ' + supabaseError(error)); setSaving(false); return }
      vendorId = data?.id || null
    }

    // 2) New items → optionally add each to the Inventory board (needs a part number for the SKU)
    for (const r of resolved) {
      if (r.it.mode === 'new' && r.it.addToInventory && r.partNumber) {
        const { error } = await sb.from('products').insert({
          sku: r.partNumber, product_name: r.name, vendor_id: vendorId, is_active: true, category: 'Uncategorized',
        })
        if (error && error.code !== '23505') { // ignore duplicate-SKU conflicts, otherwise surface
          setCreateError('Inventory item: ' + supabaseError(error)); setSaving(false); return
        }
      }
    }

    // Require a PO date; default to the entry date when none was provided.
    const poDate = form.po_date || new Date().toISOString().slice(0, 10)
    // 3) The purchasing request (header) row — one per request
    const group = GROUPS.find(g => g.key === form.group_key) || GROUPS[1]
    const posBase = Math.max(0, ...rows.filter(r => r.group_key === group.key).map(r => Number(r.position) || 0)) + 1
    const reqId = newKey()
    const first = resolved[0]
    const headerName = resolved.length === 1 ? first.name : `${first.name} + ${resolved.length - 1} more item${resolved.length - 1 === 1 ? '' : 's'}`
    const { error: reqErr } = await sb.from('purchasing_requests').insert({
      id: reqId,
      name: headerName,
      group_key: group.key,
      group_title: group.title,
      position: posBase,
      location: form.location || null,
      status: form.status || null,
      person_requesting: form.person_requesting.trim() || null,
      po_required: form.po_required || null,
      po_number: form.po_number.trim() || null,
      customer_project: form.customer_project.trim() || null,
      supplier: vendorName || null,
      supplier_pn: resolved.length === 1 ? (first.partNumber || null) : null,
      po_date: poDate,
      qty_ordered: resolved.length === 1 ? (first.qty || null) : null,
    })
    if (reqErr) { setCreateError(supabaseError(reqErr)); setSaving(false); return }

    // 4) One line item per resolved item
    const lineRows = resolved.map((r, i) => ({
      id: newKey(),
      parent_id: reqId,
      name: r.name,
      part_number: r.partNumber || null,
      description: r.description || null,
      qty_ordered: r.qty || null,
      date_ordered: poDate,
      position: i,
    }))
    const { error: itemsErr } = await sb.from('purchasing_request_items').insert(lineRows)
    if (itemsErr) { setCreateError('Items: ' + supabaseError(itemsErr)); setSaving(false); return }

    setSaving(false)
    setShowCreate(false)
    setCollapsed(c => ({ ...c, [group.key]: false }))
    load()
  }

  const total = rows.length
  const detailItems = detail ? itemsOf(detail.id) : []
  const detailFiles = detail ? filesOf(detail) : []

  return (
    <div className="min-h-screen mon-page p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <span className="mon-tag t-blue">🧾 Purchasing</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">Purchasing Requests</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${total} requests`}</p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search item, PO#, supplier, person…" className="bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm flex-1 sm:w-72 focus:outline-none focus:ring-2 focus:ring-[#3B6FE0]/40" />
          <button onClick={openCreate} className="flex items-center gap-1.5 whitespace-nowrap bg-[#3B6FE0] hover:bg-[#2f5bc0] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors shadow-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
            New Request
          </button>
        </div>
      </div>

      <div className="mb-4 rounded-lg bg-[#10B981]/10 border border-[#10B981]/25 text-[12px] text-[#0f7a5a] px-3 py-2">🔗 Ultron — status is editable inline and on each record; notes &amp; comments sync two-way with the Sales / Walmart boards.</div>
      <div className="space-y-4">
        {GROUPS.map(group => {
          const gr = groupRows(group.key)
          const isCol = collapsed[group.key]
          return (
            <div key={group.key} className="bg-white rounded-xl shadow-sm border border-[#ECEEF3]">
              <div className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none sticky top-0 z-30 bg-white rounded-t-xl border-b border-[#EEF0F4]" style={{ borderLeft: '5px solid ' + group.color }} onClick={() => setCollapsed(c => ({ ...c, [group.key]: !c[group.key] }))}>
                <span className="text-[10px]" style={{ color: group.color, display: 'inline-block', transform: isCol ? 'none' : 'rotate(90deg)' }}>&#9654;</span>
                <span className="font-bold text-sm" style={{ color: group.color }}>{group.title}</span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: group.color + '26', color: group.color }}>{gr.length}</span>
              </div>
              {!isCol && (
                  <table className="w-full text-sm">
                    <thead className="sticky top-[47px] z-20">
                      <tr className="text-[11px] uppercase text-gray-400 border-b border-[#EEF0F4] bg-[#FBFCFE]">
                        <th className="text-left px-4 py-2 font-semibold">Item</th>
                        <th className="text-left px-3 py-2 font-semibold w-[140px]">Location</th>
                        <th className="text-left px-3 py-2 font-semibold w-[200px]">Status</th>
                        <th className="text-left px-3 py-2 font-semibold w-[130px]">Requested By</th>
                        <th className="text-left px-3 py-2 font-semibold w-[110px]">PO #</th>
                        <th className="text-left px-3 py-2 font-semibold w-[140px]">Supplier</th>
                        <th className="text-left px-3 py-2 font-semibold w-[100px]">PO Date</th>
                        <th className="text-left px-3 py-2 font-semibold w-[110px]">Receiving Date</th>
                        <th className="text-left px-3 py-2 font-semibold w-[70px]">Details</th>
                        <th className="text-left px-3 py-2 font-semibold w-[70px]">Files</th>
                        <th className="text-left px-3 py-2 font-semibold w-[80px]">Comments</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gr.map((r, i) => {
                        const its = itemsOf(r.id)
                        const nFiles = filesOf(r).length
                        const nc = commentCounts[r.id] || 0
                        return (
                          <tr key={r.id} className={`cursor-pointer hover:bg-[#F2F6FF] ${i % 2 ? 'bg-[#F8FAFC]' : 'bg-white'}`} onClick={() => setDetail(r)}>
                            <td className="px-4 py-2.5 font-semibold text-[#1A1D2E]">{r.name}</td>
                            <td className="px-3 py-2.5">{r.location ? <span className="text-white text-[10px] font-semibold rounded-full px-2 py-0.5 inline-block whitespace-nowrap" style={{ background: LOC_COLORS[r.location] || '#c4c4c4' }}>{r.location}</span> : <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                              <select value={r.status || ''} onChange={e => updateStatus(r.id, e.target.value)} className="text-white text-[11px] font-semibold rounded-full px-2.5 py-1 border-0 cursor-pointer appearance-none focus:outline-none focus:ring-2 focus:ring-black/10 max-w-[180px]" style={{ background: statusColor(r.status) }}>
                                <option value="" style={{ color: '#111' }}>— Set status —</option>
                                {STATUS_OPTIONS.map(o => <option key={o} value={o} style={{ background: '#fff', color: '#111' }}>{o}</option>)}
                              </select>
                            </td>
                            <td className="px-3 py-2.5 text-gray-600">{r.person_requesting || '—'}</td>
                            <td className="px-3 py-2.5 text-gray-600">{r.po_number || '—'}</td>
                            <td className="px-3 py-2.5 text-gray-600">{r.supplier || '—'}</td>
                            <td className="px-3 py-2.5 text-gray-600">{fmtDate(r.po_date) || '—'}</td>
                            <td className="px-3 py-2.5 text-gray-600">{fmtDate(r.date_received) || '—'}</td>
                            <td className="px-3 py-2.5 text-gray-600">{its.length ? `${its.length} item${its.length > 1 ? 's' : ''}` : '—'}</td>
                            <td className="px-3 py-2.5">{nFiles ? <span className="text-[#3B6FE0] text-xs font-semibold">📎 {nFiles}</span> : <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-2.5">{nc ? <span className="text-emerald-600 text-xs font-semibold">💬 {nc}</span> : <span className="text-gray-300">—</span>}</td>
                          </tr>
                        )
                      })}
                      {gr.length === 0 && <tr><td colSpan={11} className="px-4 py-6 text-center text-gray-400 text-sm">No requests</td></tr>}
                    </tbody>
                  </table>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Create modal ─────────────────────────────────────── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: 'rgba(26,32,53,0.5)' }} >
          <div className="relative w-full max-w-[640px] my-6 bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between px-6 py-4 text-white" style={{ background: '#3B6FE0' }}>
              <div>
                <p className="text-white/70 text-xs uppercase tracking-wide">New</p>
                <h2 className="text-xl font-bold leading-tight">New Purchase Request</h2>
              </div>
              <button onClick={() => !saving && setShowCreate(false)} className="text-white/80 hover:text-white text-2xl leading-none">&times;</button>
            </div>

            <div className="px-6 py-4 max-h-[75vh] overflow-y-auto space-y-5">
              {/* Items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Items <span className="text-gray-300 normal-case font-normal">({form.items.length})</span></p>
                  <button type="button" onClick={addItem} className="text-xs font-semibold text-[#3B6FE0] hover:text-[#2f5bc0]">+ Add item</button>
                </div>
                <div className="space-y-3">
                  {form.items.map((it, idx) => (
                    <div key={it.key} className="rounded-xl border border-[#E4E6EE] p-3 bg-[#FAFBFC]">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-semibold text-gray-400">Item {idx + 1}</span>
                        <div className="flex items-center gap-2">
                          <ModeToggle value={it.mode} onChange={(m) => updateItem(it.key, { mode: m, productId: '', itemName: '', partNumber: '' })} a="search" aLabel="From inventory" b="new" bLabel="New item" />
                          {form.items.length > 1 && <button type="button" onClick={() => removeItem(it.key)} title="Remove item" className="text-gray-400 hover:text-red-500 text-xl leading-none px-1">&times;</button>}
                        </div>
                      </div>
                      {it.mode === 'search' ? (
                        <ProductPicker products={products} selectedId={it.productId} onPick={(p) => pickProduct(it.key, p)} onClear={() => updateItem(it.key, { productId: '', itemName: '', partNumber: '' })} />
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <TextField label="Item name" required value={it.itemName} onChange={v => updateItem(it.key, { itemName: v })} placeholder="e.g. 18x12x12 Kraft Box" />
                          <TextField label="Part # / SKU" value={it.partNumber} onChange={v => updateItem(it.key, { partNumber: v })} placeholder="e.g. 99181212" />
                          <div className="sm:col-span-2">
                            <TextField label="Description" value={it.description} onChange={v => updateItem(it.key, { description: v })} placeholder="Optional" />
                          </div>
                          <label className="sm:col-span-2 flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                            <input type="checkbox" checked={it.addToInventory} onChange={e => updateItem(it.key, { addToInventory: e.target.checked })} className="w-4 h-4 accent-[#3B6FE0]" />
                            Also add this item to the Inventory board {it.addToInventory && !it.partNumber.trim() && <span className="text-amber-500 text-xs">(needs a Part # / SKU)</span>}
                          </label>
                        </div>
                      )}
                      <div className="mt-3 max-w-[220px]">
                        <TextField label="Qty Ordered" value={it.qty} onChange={v => updateItem(it.key, { qty: v })} />
                      </div>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={addItem} className="mt-3 w-full text-sm font-semibold text-[#3B6FE0] border border-dashed border-[#3B6FE0]/40 rounded-lg py-2 hover:bg-[#3B6FE0]/5 transition-colors">+ Add another item</button>
              </div>

              {/* Vendor */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Vendor / Supplier</p>
                  <ModeToggle value={form.vendorMode} onChange={(m) => setForm(f => ({ ...f, vendorMode: m, vendorId: '', vendorName: '' }))} a="search" aLabel="Existing" b="new" bLabel="New vendor" />
                </div>
                {form.vendorMode === 'search' ? (
                  <VendorPicker vendors={vendors} selectedId={form.vendorId} onPick={(v) => setForm(f => ({ ...f, vendorId: v.id, vendorName: v.company_name }))} onClear={() => setForm(f => ({ ...f, vendorId: '', vendorName: '' }))} />
                ) : (
                  <TextField label="New vendor / supplier name" required value={form.vendorName} onChange={v => setForm(f => ({ ...f, vendorName: v }))} placeholder="e.g. Acme Packaging Co." hint="This will be added to the Vendor board." />
                )}
              </div>

              {/* Details */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Request Details</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <SelectField label="Group" value={form.group_key} onChange={v => setForm(f => ({ ...f, group_key: v }))} options={GROUPS.map(g => ({ value: g.key, label: g.title }))} />
                  <SelectField label="Location" value={form.location} onChange={v => setForm(f => ({ ...f, location: v }))} options={LOCATION_OPTIONS.map(o => ({ value: o, label: o }))} />
                  <SelectField label="Status" value={form.status} onChange={v => setForm(f => ({ ...f, status: v }))} options={STATUS_OPTIONS.map(o => ({ value: o, label: o }))} />
                  <TextField label="Requested By" value={form.person_requesting} onChange={v => setForm(f => ({ ...f, person_requesting: v }))} />
                  <SelectField label="PO Required?" value={form.po_required} onChange={v => setForm(f => ({ ...f, po_required: v }))} options={PO_REQUIRED_OPTIONS.map(o => ({ value: o, label: o }))} />
                  <TextField label="PO Number" value={form.po_number} onChange={v => setForm(f => ({ ...f, po_number: v }))} />
                  <TextField label="Customer / Project" value={form.customer_project} onChange={v => setForm(f => ({ ...f, customer_project: v }))} />
                  <TextField label="PO Date" type="date" value={form.po_date} onChange={v => setForm(f => ({ ...f, po_date: v }))} />
                </div>
              </div>

              {createError && (
                <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5">
                  <svg className="w-4 h-4 text-red-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <p className="text-red-600 text-xs">{createError}</p>
                </div>
              )}
            </div>

            <div className="shrink-0 px-6 py-4 border-t border-[#EEF0F4] flex items-center justify-end gap-3">
              <button onClick={() => !saving && setShowCreate(false)} className="text-sm px-4 py-2.5 rounded-lg border border-[#E4E6EE] text-gray-500 hover:text-gray-700 hover:border-gray-400 transition-colors">Cancel</button>
              <button onClick={createRequest} disabled={saving} className="flex items-center justify-center gap-2 bg-[#3B6FE0] hover:bg-[#2f5bc0] disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors">
                {saving ? (<><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Creating…</>) : 'Create Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: 'rgba(26,32,53,0.5)' }} >
          <div className="relative w-full max-w-[860px] my-6 bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between px-6 py-4 text-white" style={{ background: (GROUPS.find(g => g.key === detail.group_key)?.color) || '#5559df' }}>
              <div className="min-w-0">
                <p className="text-white/70 text-xs uppercase tracking-wide">{detail.group_title}</p>
                <h2 className="text-xl font-bold leading-tight">{detail.name}</h2>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  <select value={detail.status || ''} onChange={e => updateStatus(detail.id, e.target.value)} className="inline-block text-[11px] font-semibold rounded-full px-2.5 py-0.5 border-0 cursor-pointer appearance-none focus:outline-none text-white" style={{ background: statusColor(detail.status) }}>
                    <option value="" style={{ color: '#111' }}>— Set status —</option>
                    {STATUS_OPTIONS.map(o => <option key={o} value={o} style={{ background: '#fff', color: '#111' }}>{o}</option>)}
                  </select>
                  {detail.location && <span className="inline-block text-[11px] font-semibold rounded-full px-2.5 py-0.5 bg-white/20">{detail.location}</span>}
                </div>
              </div>
              <button onClick={() => setDetail(null)} className="text-white/80 hover:text-white text-2xl leading-none">&times;</button>
            </div>

            <div className="px-6 py-4 max-h-[75vh] overflow-y-auto space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {([['person_requesting','Requested By','text'],['po_required','PO Required?','text'],['po_number','PO Number','text'],['customer_project','Customer / Project','text'],['supplier','Supplier','text'],['supplier_pn','Supplier P/N','text'],['po_date','PO Date','date'],['qty_ordered','Qty Ordered','text'],['date_received','Date Received','date'],['qty_received','Qty Received','text'],['balance','Balance','text'],['pkgs_received',"# of Pkgs Rec'd",'text'],['condition_received',"Condition Rec'd",'text'],['received_by','Received By','text'],['batch_lot','Batch / Lot No.','text']] as const).map(([k,label,type]) => (
                  <div key={k}>
                    <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">{label}</p>
                    <input type={type} value={editForm[k] ?? ''} onChange={e => setEditForm((ff: any) => ({ ...ff, [k]: e.target.value }))} className="w-full text-sm border border-[#E4E6EE] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[#3B6FE0]" />
                  </div>
                ))}
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Order Details</p>
                {detailItems.length === 0 ? <p className="text-sm text-gray-400">No line items.</p> : (
                  <div className="border border-[#EEF0F4] rounded-lg overflow-x-auto">
                    <table className="w-full text-sm min-w-[640px]">
                      <thead><tr className="bg-[#FBFCFE] text-[11px] uppercase text-gray-400">
                        <th className="text-left px-3 py-2">P/N</th>
                        <th className="text-left px-3 py-2">Description</th>
                        <th className="text-right px-3 py-2">Qty Ordered</th>
                        <th className="text-left px-3 py-2">Date Ordered</th>
                        <th className="text-right px-3 py-2">Total Received</th>
                        <th className="text-left px-3 py-2">Date Received</th>
                        <th className="text-right px-3 py-2">Balance</th>
                      </tr></thead>
                      <tbody>
                        {detailItems.map(it => (
                          <tr key={it.id} className="border-t border-[#F0F2F6]">
                            <td className="px-3 py-2 font-mono text-emerald-700">{it.part_number || it.name || '—'}</td>
                            <td className="px-3 py-2 text-gray-600">{it.description || '—'}</td>
                            <td className="px-3 py-2 text-right">{it.qty_ordered || '—'}</td>
                            <td className="px-3 py-2">{fmtDate(it.date_ordered) || '—'}</td>
                            <td className="px-3 py-2 text-right">{it.total_received || '—'}</td>
                            <td className="px-3 py-2">{fmtDate(it.date_received) || '—'}</td>
                            <td className="px-3 py-2 text-right">{it.balance || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {detailFiles.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Files ({detailFiles.length})</p>
                  <div className="flex flex-wrap gap-2">
                    {detailFiles.map((f: any, idx: number) => (
                      <button key={idx} onClick={() => openFile(f)} className="flex items-center gap-2 text-xs bg-[#F5F7FB] border border-[#E4E6EE] rounded-lg px-3 py-2 hover:bg-[#EAF0FC] text-left">
                        <span className="text-[#3B6FE0]">📄</span>
                        <span className="min-w-0"><span className="block font-semibold text-gray-700 truncate max-w-[240px]">{f.name}</span><span className="text-[10px] text-gray-400">{f.tag}</span></span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t border-[#EEF0F4] pt-4">
                <Comments recordId={detail.id} recordType="purchasing_request" currentUserEmail={userEmail} title="Notes & Comments" />
              </div>
            </div>
            <div className="shrink-0 px-6 py-3 border-t border-[#EEF0F4] flex items-center justify-end gap-3">
              <button onClick={() => setDetail(null)} className="text-sm px-4 py-2 rounded-lg border border-[#E4E6EE] text-gray-500 hover:text-gray-700 hover:border-gray-400 transition-colors">Close</button>
              <button onClick={saveDetail} disabled={savingDetail} className="text-sm font-semibold px-5 py-2 rounded-lg bg-[#3B6FE0] hover:bg-[#2f5bc0] text-white disabled:opacity-60 transition-colors">{savingDetail ? 'Saving…' : 'Save changes'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, wide }: { label: string; value: any; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2 sm:col-span-3' : ''}>
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-gray-800 mt-0.5">{value || <span className="text-gray-300">—</span>}</p>
    </div>
  )
}

const inputBase = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3B6FE0]/40 focus:border-transparent transition'

function TextField({ label, value, onChange, placeholder, type, required, hint }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; required?: boolean; hint?: string }) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1.5">{label}{required && <span className="text-red-400 ml-0.5">*</span>}</label>
      <input type={type || 'text'} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={inputBase} />
      {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
    </div>
  )
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1.5">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} className={inputBase + ' cursor-pointer'}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

function ModeToggle({ value, onChange, a, aLabel, b, bLabel }: { value: string; onChange: (m: any) => void; a: string; aLabel: string; b: string; bLabel: string }) {
  return (
    <div className="inline-flex rounded-lg border border-[#E4E6EE] overflow-hidden text-xs">
      <button type="button" onClick={() => onChange(a)} className={`px-3 py-1.5 font-medium transition-colors ${value === a ? 'bg-[#3B6FE0] text-white' : 'bg-white text-gray-500 hover:bg-[#F5F7FB]'}`}>{aLabel}</button>
      <button type="button" onClick={() => onChange(b)} className={`px-3 py-1.5 font-medium transition-colors ${value === b ? 'bg-[#3B6FE0] text-white' : 'bg-white text-gray-500 hover:bg-[#F5F7FB]'}`}>{bLabel}</button>
    </div>
  )
}

function ProductPicker({ products, selectedId, onPick, onClear }: { products: any[]; selectedId: string; onPick: (p: any) => void; onClear: () => void }) {
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const selected = products.find(p => p.id === selectedId) || null
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc); return () => document.removeEventListener('mousedown', onDoc)
  }, [])
  const filtered = useMemo(() => {
    const s = term.trim().toLowerCase()
    const list = !s ? products : products.filter(p => String(p.product_name ?? '').toLowerCase().includes(s) || String(p.sku ?? '').toLowerCase().includes(s))
    return list.slice(0, 30)
  }, [term, products])

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-2 bg-[#F5F7FB] border border-[#E4E6EE] rounded-lg px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#1A1D2E] truncate">{selected.product_name}</p>
          <p className="text-[11px] text-gray-400 font-mono">{selected.sku}</p>
        </div>
        <button type="button" onClick={onClear} className="text-xs text-[#3B6FE0] hover:underline shrink-0">Change</button>
      </div>
    )
  }
  return (
    <div className="relative" ref={boxRef}>
      <input value={term} onChange={e => { setTerm(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} placeholder="Search inventory by name or SKU…" className={inputBase} />
      {open && (
        <div className="absolute z-10 mt-1 w-full bg-white border border-[#E4E6EE] rounded-lg shadow-lg max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-3 py-3 text-sm text-gray-400">No matching inventory items.</p>
          ) : filtered.map(p => (
            <button type="button" key={p.id} onClick={() => { onPick(p); setOpen(false); setTerm('') }} className="w-full text-left px-3 py-2 hover:bg-[#F2F6FF] border-b border-[#F4F5F8] last:border-0">
              <p className="text-sm text-[#1A1D2E] truncate">{p.product_name}</p>
              <p className="text-[11px] text-gray-400 font-mono">{p.sku}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function VendorPicker({ vendors, selectedId, onPick, onClear }: { vendors: any[]; selectedId: string; onPick: (v: any) => void; onClear: () => void }) {
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const selected = vendors.find(v => v.id === selectedId) || null
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc); return () => document.removeEventListener('mousedown', onDoc)
  }, [])
  const filtered = useMemo(() => {
    const s = term.trim().toLowerCase()
    const list = !s ? vendors : vendors.filter(v => String(v.company_name ?? '').toLowerCase().includes(s))
    return list.slice(0, 30)
  }, [term, vendors])

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-2 bg-[#F5F7FB] border border-[#E4E6EE] rounded-lg px-3 py-2.5">
        <p className="text-sm font-semibold text-[#1A1D2E] truncate">{selected.company_name}</p>
        <button type="button" onClick={onClear} className="text-xs text-[#3B6FE0] hover:underline shrink-0">Change</button>
      </div>
    )
  }
  return (
    <div className="relative" ref={boxRef}>
      <input value={term} onChange={e => { setTerm(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} placeholder="Search vendors…" className={inputBase} />
      {open && (
        <div className="absolute z-10 mt-1 w-full bg-white border border-[#E4E6EE] rounded-lg shadow-lg max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-3 py-3 text-sm text-gray-400">No matching vendors. Switch to “New vendor” to add one.</p>
          ) : filtered.map(v => (
            <button type="button" key={v.id} onClick={() => { onPick(v); setOpen(false); setTerm('') }} className="w-full text-left px-3 py-2 hover:bg-[#F2F6FF] border-b border-[#F4F5F8] last:border-0">
              <p className="text-sm text-[#1A1D2E] truncate">{v.company_name}{v.is_active === false && <span className="text-[10px] text-gray-400 ml-1.5">(archived)</span>}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
