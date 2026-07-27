'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import Comments from '@/components/Comments'

interface Row {
  id: string; name: string | null; channel: string | null; status: string | null; ship_date: string | null
  inbound_shipment_id: string | null; quantity_requested: number | null; quantity_shipped: number | null
  comments: string | null; position: number | null
  product_id?: string | null; inventory_deducted?: boolean | null; inventory_deducted_qty?: number | null
  products?: { sku: string | null; product_name: string | null; on_hand_qty: number | null } | null
}

const STATUSES = [
  { label: 'Ready to Ship', hex: '#00c875' },
  { label: 'Pallet Prep', hex: '#cab641' },
  { label: 'Waiting LTL Pickup', hex: '#333333' },
  { label: 'Shipped', hex: '#037f4c' },
  { label: 'HOLD', hex: '#579bfc' },
  { label: 'Low Stock', hex: '#fdab3d' },
  { label: 'Out of Stock', hex: '#df2f4a' },
  { label: 'Inactive SKU', hex: '#9d50dd' },
]
const statusHex = (s: string | null) => STATUSES.find(x => x.label === s)?.hex || '#c4c4c4'
const GROUPS = [
  { key: 'FBA Shipments', color: '#0086C0' },
  { key: 'WFS Shipment', color: '#A25DDC' },
  { key: 'Shipped', color: '#00A84F' },
]
const fmtD = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

function Stat({ label, value, c }: { label: string; value: string; c?: string }) {
  return (
    <div className="mon-stat stat-card" style={c ? ({ ['--c']: c } as any) : undefined}>
      <p className="text-xs font-semibold text-gray-400">{label}</p>
      <p className="mon-stat-val mt-0.5">{value}</p>
    </div>
  )
}

export default function FbaBoard() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [userEmail, setUserEmail] = useState('')
  const dragId = useRef<string | null>(null)

  const [prodSearch, setProdSearch] = useState('')
  const [prodResults, setProdResults] = useState<any[]>([])
  const [detail, setDetail] = useState<Row | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<any>({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await sb.from('fba_shipments').select('*, products(sku, product_name, on_hand_qty)').order('position', { ascending: true, nullsFirst: false })
    setRows((data as Row[]) || [])
    setLoading(false)
  }, [sb])
  useEffect(() => { load() }, [load])
  useEffect(() => { sb.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email) }) }, [sb])

  const q = search.trim().toLowerCase()
  const match = (r: Row) => !q || [r.name, r.inbound_shipment_id, r.status, r.comments].some(v => (v || '').toLowerCase().includes(q))
  const groupRows = (key: string) => rows.filter(r => (r.channel || '') === key && match(r)).sort((a, b) => (a.position || 0) - (b.position || 0))
  const extraGroups = Array.from(new Set(rows.map(r => r.channel || '').filter(k => k && !GROUPS.some(g => g.key === k))))
  const allGroups = [...GROUPS, ...extraGroups.map(k => ({ key: k, color: '#9699A6' }))]

  const stats = useMemo(() => ({
    total: rows.length,
    ready: rows.filter(r => r.status === 'Ready to Ship').length,
    low: rows.filter(r => r.status === 'Low Stock').length,
    out: rows.filter(r => r.status === 'Out of Stock').length,
    req: rows.reduce((a, r) => a + (r.quantity_requested || 0), 0),
    ship: rows.reduce((a, r) => a + (r.quantity_shipped || 0), 0),
  }), [rows])

  async function patch(id: string, obj: Partial<Row>) {
    setRows(rs => rs.map(r => r.id === id ? { ...r, ...obj } : r))
    await sb.from('fba_shipments').update({ ...obj, updated_at: new Date().toISOString() }).eq('id', id)
  }

  // Ultron: link FBA/WFS rows to the Inventory board (products) and deduct on ship.
  async function searchProducts(term: string) {
    setProdSearch(term)
    if (!term.trim()) { setProdResults([]); return }
    const { data } = await sb.from('products').select('id, sku, product_name, on_hand_qty').or(`sku.ilike.%${term}%,product_name.ilike.%${term}%`).limit(8)
    setProdResults((data as any[]) || [])
  }
  function selectProduct(pr: any) {
    setForm((f: any) => ({ ...f, product_id: pr.id, product_sku: pr.sku, product_name: pr.product_name, on_hand_qty: pr.on_hand_qty, name: (f.name || '').trim() ? f.name : (pr.product_name || pr.sku || '') }))
    setProdSearch(''); setProdResults([])
  }
  async function adjustInventory(productId: string, delta: number) {
    const { data } = await sb.from('products').select('on_hand_qty').eq('id', productId).single()
    const cur = Number((data as any)?.on_hand_qty || 0)
    await sb.from('products').update({ on_hand_qty: cur + delta }).eq('id', productId)
  }

  function formFrom(r: Row) {
    return {
      name: r.name ?? '', status: r.status ?? '', channel: r.channel ?? '', ship_date: r.ship_date ?? '',
      inbound_shipment_id: r.inbound_shipment_id ?? '',
      quantity_requested: r.quantity_requested ?? '', quantity_shipped: r.quantity_shipped ?? '',
      comments: r.comments ?? '',
      product_id: r.product_id ?? null, product_sku: r.products?.sku ?? '', product_name: r.products?.product_name ?? '', on_hand_qty: r.products?.on_hand_qty ?? null,
    }
  }
  function openDetail(r: Row) { setEditing(false); setDetail(r) }
  function closeDetail() { setDetail(null); setEditing(false) }
  function startEdit() { if (!detail) return; setForm(formFrom(detail)); setEditing(true) }

  async function addItem(channel: string) {
    const max = Math.max(0, ...rows.filter(r => (r.channel || '') === channel).map(r => r.position || 0))
    const { data } = await sb.from('fba_shipments').insert({ channel, name: '', status: null, position: max + 1000 }).select('*').single()
    if (data) { const r = data as Row; setRows(rs => [...rs, r]); setDetail(r); setForm(formFrom(r)); setEditing(true) }
  }

  async function saveDetail() {
    if (!detail) return
    setSaving(true)
    const qtyShipped = form.quantity_shipped === '' || form.quantity_shipped == null ? null : Number(form.quantity_shipped)
    const pid = form.product_id || null
    const newStatus = form.status || null

    // Ultron inventory sync: reverse any prior deduction, then deduct if now Shipped.
    try {
      if (detail.inventory_deducted && detail.product_id && Number(detail.inventory_deducted_qty || 0) > 0) {
        await adjustInventory(detail.product_id, Number(detail.inventory_deducted_qty))
      }
    } catch { /* ignore */ }
    let invDeducted = false, invQty = 0
    try {
      if (newStatus === 'Shipped' && pid && Number(qtyShipped || 0) > 0) {
        await adjustInventory(pid, -Number(qtyShipped))
        invDeducted = true; invQty = Number(qtyShipped)
      }
    } catch { /* ignore */ }

    const payload: Partial<Row> = {
      name: (form.name || '').trim() || null,
      status: newStatus,
      channel: form.channel || null,
      ship_date: form.ship_date || null,
      inbound_shipment_id: (form.inbound_shipment_id || '').trim() || null,
      quantity_requested: form.quantity_requested === '' || form.quantity_requested == null ? null : Number(form.quantity_requested),
      quantity_shipped: qtyShipped,
      comments: (form.comments || '').trim() || null,
      product_id: pid,
      inventory_deducted: invDeducted,
      inventory_deducted_qty: invQty,
    }
    await sb.from('fba_shipments').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', detail.id)
    setEditing(false); setSaving(false)
    setDetail(null)
    load()
  }

  async function deleteDetail() {
    if (!detail) return
    if (!confirm('Delete this item?')) return
    setDeleting(true)
    await sb.from('fba_shipments').delete().eq('id', detail.id)
    setRows(rs => rs.filter(x => x.id !== detail.id))
    setDeleting(false); closeDetail()
  }

  function onDrop(targetChannel: string, beforeId: string | null) {
    const id = dragId.current; dragId.current = null
    if (!id) return
    const list = rows.filter(r => r.channel === targetChannel && r.id !== id).sort((a, b) => (a.position || 0) - (b.position || 0))
    let idx = beforeId ? list.findIndex(r => r.id === beforeId) : list.length
    if (idx < 0) idx = list.length
    const prev = list[idx - 1]?.position, next = list[idx]?.position
    let pos: number
    if (prev != null && next != null) pos = (prev + next) / 2
    else if (prev != null) pos = prev + 1000
    else if (next != null) pos = next - 1000
    else pos = 1000
    patch(id, { channel: targetChannel, position: pos })
  }

  const deepLinkOpenedRef = useRef<string | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const openId = new URLSearchParams(window.location.search).get('item')
    if (!openId || deepLinkOpenedRef.current === openId) return
    const target = rows.find(x => x.id === openId)
    if (target) { deepLinkOpenedRef.current = openId; openDetail(target) }
  }, [rows]) // eslint-disable-line react-hooks/exhaustive-deps

  const inputCls = 'w-full bg-white border border-[#E4E6EE] rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3B6FE0]/40'
  const cols = [
    { h: 'Item', w: 'min-w-[240px]' }, { h: 'Status', w: 'w-[150px]' }, { h: 'Ship Date', w: 'w-[120px]' },
    { h: 'Inbound Shipment ID', w: 'w-[170px]' }, { h: 'Qty Req', w: 'w-[90px]' }, { h: 'Qty Shipped', w: 'w-[100px]' },
    { h: 'Comments', w: 'min-w-[150px]' },
  ]

  return (
    <div className="min-h-screen mon-page p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <span className="mon-tag">🚚 FBA / WFS</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">FBA / WFS</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${rows.length} items`}</p>
        </div>
        <button onClick={() => addItem('FBA Shipments')} className="mon-btn">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          New item
        </button>
      </div>

      {!loading && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
          <Stat label="Total Items" value={String(stats.total)} c="#0086C0" />
          <Stat label="Ready to Ship" value={String(stats.ready)} c="#00C7C7" />
          <Stat label="Low Stock" value={String(stats.low)} c={stats.low > 0 ? '#FDAB3D' : '#9699A6'} />
          <Stat label="Out of Stock" value={String(stats.out)} c={stats.out > 0 ? '#E2445C' : '#9699A6'} />
          <Stat label="Qty Requested" value={stats.req.toLocaleString()} c="#A25DDC" />
          <Stat label="Qty Shipped" value={stats.ship.toLocaleString()} c="#00A84F" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input placeholder="Search item, shipment ID, status…" value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition" />
        </div>
        {search && <button onClick={() => setSearch('')} className="text-xs text-gray-500 hover:text-[#1A1D2E] px-2 py-1">Clear</button>}
        <div className="flex items-center gap-1.5 ml-auto text-xs">
          <button onClick={() => setCollapsed(Object.fromEntries(allGroups.map(g => [g.key, true])))} className="px-2.5 py-1.5 rounded-md text-gray-500 hover:text-[#1A1D2E] hover:bg-[#F0F2F7] transition-colors">Collapse all</button>
          <button onClick={() => setCollapsed({})} className="px-2.5 py-1.5 rounded-md text-gray-500 hover:text-[#1A1D2E] hover:bg-[#F0F2F7] transition-colors">Expand all</button>
        </div>
      </div>

      <div className="mb-4 rounded-lg bg-[#10B981]/10 border border-[#10B981]/25 text-[12px] text-[#0f7a5a] px-3 py-2">🔗 Inventory-linked (Ultron). Link each item to an Inventory SKU. When an item&rsquo;s status is set to <b>Shipped</b>, the shipped quantity is automatically deducted from that SKU&rsquo;s on-hand inventory. Inventory is the source of truth for product data.</div>
      {loading ? <p className="text-gray-400 text-sm">Loading…</p> : (
        <div className="space-y-2.5 mb-6">
          {allGroups.map(group => {
            const gr = groupRows(group.key)
            const isCol = collapsed[group.key]
            const totReq = gr.reduce((a, r) => a + (r.quantity_requested || 0), 0)
            const totShip = gr.reduce((a, r) => a + (r.quantity_shipped || 0), 0)
            return (
              <div key={group.key} className="bg-white rounded-xl overflow-hidden shadow-sm border border-[#ECEEF3]" onDragOver={e => e.preventDefault()} onDrop={() => onDrop(group.key, null)}>
                <div className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none sticky top-0 z-30 rounded-t-xl" style={{ background: '#fff', borderLeft: '5px solid ' + group.color }} onClick={() => setCollapsed(c => ({ ...c, [group.key]: !c[group.key] }))}>
                  <span className="text-[10px]" style={{ color: group.color, display: 'inline-block', transition: 'transform .15s', transform: isCol ? 'none' : 'rotate(90deg)' }}>&#9654;</span>
                  <span className="font-bold text-sm" style={{ color: group.color }}>{group.key}</span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: group.color + '26', color: group.color }}>{gr.length}</span>
                  {(totReq > 0 || totShip > 0) && <span className="ml-auto text-xs font-semibold text-gray-500 shrink-0">Req {totReq.toLocaleString()} · Ship {totShip.toLocaleString()}</span>}
                </div>
                {!isCol && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[#EEF0F4] text-[11px] uppercase tracking-wide text-gray-400 bg-[#FBFCFE]">
                          <th className="w-6" />
                          {cols.map(c => <th key={c.h} className={`text-left font-semibold px-3 py-2 ${c.w}`}>{c.h}</th>)}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EAECF2]">
                        {gr.map((r, i) => (
                          <tr key={r.id} id={'item-' + r.id} className={`group cursor-pointer hover:bg-[#F2F6FF] ${i % 2 ? 'bg-[#F6F8FB]' : 'bg-white'}`} onClick={() => openDetail(r)} onDragOver={e => e.preventDefault()} onDrop={e => { e.stopPropagation(); onDrop(group.key, r.id) }}>
                            <td className="text-center text-gray-300 group-hover:text-gray-500 cursor-grab select-none" draggable onDragStart={e => { dragId.current = r.id; e.stopPropagation() }} onClick={e => e.stopPropagation()} title="Drag to reorder or move">&#8942;&#8942;</td>
                            <td className="px-3 py-2.5 text-[13px] font-semibold text-[#1A1D2E]"><span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle" style={{ background: r.product_id ? '#10B981' : '#F59E0B' }} title={r.product_id ? `Linked to Inventory${r.products?.sku ? ' · ' + r.products.sku : ''}` : 'Not linked to an Inventory SKU'} />{r.name || <span className="text-gray-300">Untitled</span>}</td>
                            <td className="px-3 py-2.5"><span className="text-white text-[11px] font-semibold rounded-full px-2.5 py-1 inline-block" style={{ background: r.status ? statusHex(r.status) : '#c4c4c4' }}>{r.status || '—'}</span></td>
                            <td className="px-3 py-2.5 text-[13px] text-gray-600">{fmtD(r.ship_date)}</td>
                            <td className="px-3 py-2.5 text-[13px] font-mono text-gray-500">{r.inbound_shipment_id || '—'}</td>
                            <td className="px-3 py-2.5 text-[13px] text-right tabular-nums text-gray-700">{r.quantity_requested != null ? Number(r.quantity_requested).toLocaleString() : '—'}</td>
                            <td className="px-3 py-2.5 text-[13px] text-right tabular-nums text-gray-700">{r.quantity_shipped != null ? Number(r.quantity_shipped).toLocaleString() : '—'}</td>
                            <td className="px-3 py-2.5 text-[13px] text-gray-600 truncate max-w-[220px]">{r.comments || '—'}</td>
                          </tr>
                        ))}
                        {gr.length === 0 && <tr><td colSpan={8} className="px-4 py-3 text-center text-gray-400 text-xs italic">Drop items here or add one below</td></tr>}
                        <tr>
                          <td />
                          <td colSpan={7} className="px-3 py-2"><button onClick={() => addItem(group.key)} className="text-[13px] text-gray-400 hover:text-[#0086C0]">+ Add item</button></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: 'rgba(26,32,53,0.5)' }} onClick={closeDetail}>
          <div className="relative w-full max-w-[760px] my-6 bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between px-6 py-4 text-white" style={{ background: statusHex(detail.status) === '#c4c4c4' ? '#0086C0' : statusHex(detail.status) }}>
              <div className="min-w-0">
                <p className="text-white/70 text-xs uppercase tracking-wide">FBA / WFS · {detail.channel || '—'}</p>
                <h2 className="text-xl font-bold leading-tight">{detail.name || 'Untitled'}</h2>
                {detail.status && <span className="inline-block mt-1.5 text-[11px] font-semibold rounded-full px-2.5 py-0.5" style={{ background: 'rgba(255,255,255,0.25)' }}>{detail.status}</span>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!editing && (
                  <>
                    <button onClick={startEdit} className="text-xs font-semibold rounded-lg px-3 py-1.5 bg-white/15 hover:bg-white/25 transition-colors">✎ Edit</button>
                    <button onClick={deleteDetail} disabled={deleting} className="text-xs font-semibold rounded-lg px-3 py-1.5 bg-white/15 hover:bg-red-500 disabled:opacity-50 transition-colors">{deleting ? 'Deleting…' : '🗑 Delete'}</button>
                  </>
                )}
                <button onClick={closeDetail} className="text-white/80 hover:text-white text-2xl leading-none pl-1">&times;</button>
              </div>
            </div>

            <div className="px-6 py-4 max-h-[75vh] overflow-y-auto space-y-5">
              {editing ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  <label className="col-span-2 sm:col-span-3"><span className="text-[11px] uppercase tracking-wide text-gray-400">Item name</span><input className={inputCls} value={form.name} onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))} /></label>
                  <div className="col-span-2 sm:col-span-3">
                    <span className="text-[11px] uppercase tracking-wide text-gray-400">🔗 Inventory SKU (Ultron)</span>
                    {form.product_id ? (
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[13px] font-mono px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">{form.product_sku || 'Linked SKU'}</span>
                        {form.product_name && <span className="text-xs text-gray-500 truncate">{form.product_name}</span>}
                        {form.on_hand_qty != null && <span className="text-[11px] text-gray-400 shrink-0">on hand {Number(form.on_hand_qty).toLocaleString()}</span>}
                        <button type="button" onClick={() => setForm((f: any) => ({ ...f, product_id: null, product_sku: '', product_name: '', on_hand_qty: null }))} className="ml-auto text-xs text-gray-400 hover:text-red-500">Unlink</button>
                      </div>
                    ) : (
                      <div className="relative">
                        <input className={inputCls} placeholder="Search Inventory by SKU or name…" value={prodSearch} onChange={e => searchProducts(e.target.value)} />
                        {prodResults.length > 0 && (
                          <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-[#E4E6EE] rounded-lg shadow-lg divide-y max-h-44 overflow-y-auto">
                            {prodResults.map((pr: any) => (
                              <button type="button" key={pr.id} onClick={() => selectProduct(pr)} className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#F2F6FF]"><span className="font-mono">{pr.sku}</span> · {pr.product_name} <span className="text-gray-400">(on hand {Number(pr.on_hand_qty || 0).toLocaleString()})</span></button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <p className="text-[10px] text-gray-400 mt-1">Set status to <b>Shipped</b> to deduct Qty Shipped from this SKU&rsquo;s on-hand inventory.</p>
                  </div>
                  <label><span className="text-[11px] uppercase tracking-wide text-gray-400">Status</span>
                    <select className={inputCls} value={form.status} onChange={e => setForm((f: any) => ({ ...f, status: e.target.value }))}>
                      <option value="">—</option>{STATUSES.map(s => <option key={s.label} value={s.label}>{s.label}</option>)}
                    </select></label>
                  <label><span className="text-[11px] uppercase tracking-wide text-gray-400">Group</span>
                    <select className={inputCls} value={form.channel} onChange={e => setForm((f: any) => ({ ...f, channel: e.target.value }))}>
                      {allGroups.map(g => <option key={g.key} value={g.key}>{g.key}</option>)}
                    </select></label>
                  <label><span className="text-[11px] uppercase tracking-wide text-gray-400">Ship Date</span><input type="date" className={inputCls} value={form.ship_date} onChange={e => setForm((f: any) => ({ ...f, ship_date: e.target.value }))} /></label>
                  <label className="col-span-2"><span className="text-[11px] uppercase tracking-wide text-gray-400">Inbound Shipment ID</span><input className={inputCls} value={form.inbound_shipment_id} onChange={e => setForm((f: any) => ({ ...f, inbound_shipment_id: e.target.value }))} /></label>
                  <label><span className="text-[11px] uppercase tracking-wide text-gray-400">Qty Requested</span><input type="number" className={inputCls} value={form.quantity_requested} onChange={e => setForm((f: any) => ({ ...f, quantity_requested: e.target.value }))} /></label>
                  <label><span className="text-[11px] uppercase tracking-wide text-gray-400">Qty Shipped</span><input type="number" className={inputCls} value={form.quantity_shipped} onChange={e => setForm((f: any) => ({ ...f, quantity_shipped: e.target.value }))} /></label>
                  <label className="col-span-2 sm:col-span-3"><span className="text-[11px] uppercase tracking-wide text-gray-400">Comments</span><textarea rows={3} className={inputCls + ' resize-none'} value={form.comments} onChange={e => setForm((f: any) => ({ ...f, comments: e.target.value }))} /></label>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                  <div><p className="text-[11px] uppercase tracking-wide text-gray-400">Group</p><p className="text-gray-800 mt-0.5">{detail.channel || <span className="text-gray-300">—</span>}</p></div>
                  <div className="col-span-2 sm:col-span-3"><p className="text-[11px] uppercase tracking-wide text-gray-400">🔗 Inventory SKU</p>{detail.product_id ? (<p className="text-gray-800 mt-0.5"><span className="font-mono">{detail.products?.sku || 'Linked'}</span>{detail.products?.product_name ? ' · ' + detail.products.product_name : ''} <span className="text-gray-400 text-xs">(on hand {Number(detail.products?.on_hand_qty || 0).toLocaleString()})</span>{detail.inventory_deducted ? <span className="ml-2 text-[11px] font-semibold text-emerald-600">✓ {Number(detail.inventory_deducted_qty || 0).toLocaleString()} deducted</span> : null}</p>) : (<p className="text-amber-600 mt-0.5 text-xs">Not linked to Inventory</p>)}</div>
                  <div><p className="text-[11px] uppercase tracking-wide text-gray-400">Ship Date</p><p className="text-gray-800 mt-0.5">{fmtD(detail.ship_date)}</p></div>
                  <div><p className="text-[11px] uppercase tracking-wide text-gray-400">Inbound Shipment ID</p><p className="text-gray-800 mt-0.5 font-mono break-words">{detail.inbound_shipment_id || <span className="text-gray-300">—</span>}</p></div>
                  <div><p className="text-[11px] uppercase tracking-wide text-gray-400">Qty Requested</p><p className="text-gray-800 mt-0.5 tabular-nums">{detail.quantity_requested != null ? Number(detail.quantity_requested).toLocaleString() : <span className="text-gray-300">—</span>}</p></div>
                  <div><p className="text-[11px] uppercase tracking-wide text-gray-400">Qty Shipped</p><p className="text-gray-800 mt-0.5 tabular-nums">{detail.quantity_shipped != null ? Number(detail.quantity_shipped).toLocaleString() : <span className="text-gray-300">—</span>}</p></div>
                  <div className="col-span-2 sm:col-span-3"><p className="text-[11px] uppercase tracking-wide text-gray-400">Comments</p><p className="text-gray-800 mt-0.5 whitespace-pre-line break-words">{detail.comments || <span className="text-gray-300">—</span>}</p></div>
                </div>
              )}

              {editing && (
                <div className="flex items-center justify-between gap-3 border-t border-[#EEF0F4] pt-4">
                  <button onClick={deleteDetail} disabled={deleting || saving} className="text-xs font-semibold rounded-lg px-3 py-2 text-red-600 hover:bg-red-50 disabled:opacity-50">{deleting ? 'Deleting…' : '🗑 Delete record'}</button>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setEditing(false)} disabled={saving} className="text-sm px-4 py-2 rounded-lg border border-[#E4E6EE] text-gray-600 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
                    <button onClick={saveDetail} disabled={saving} className="text-sm px-4 py-2 rounded-lg text-white font-semibold disabled:opacity-50" style={{ background: '#0086C0' }}>{saving ? 'Saving…' : 'Save changes'}</button>
                  </div>
                </div>
              )}

              <div className="border-t border-[#EEF0F4] pt-4">
                <Comments recordId={detail.id} recordType="fba_shipment" currentUserEmail={userEmail} title="Notes & Comments" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
