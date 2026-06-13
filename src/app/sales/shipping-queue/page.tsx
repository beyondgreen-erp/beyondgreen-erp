'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { onStatusChange, undoFlow, type OrderStatus } from '@/lib/orderFlow'
import UndoToast from '@/components/UndoToast'
import { useMultiSelect } from '@/hooks/useMultiSelect'
import BulkActionBar from '@/components/BulkActionBar'
import Comments from '@/components/Comments'
import LabelWizard from '@/components/LabelWizard'

interface ShipQItem {
  id: string
  sales_order_id: string | null
  carrier: string | null
  tracking_number: string | null
  scheduled_ship_date: string | null
  actual_ship_date: string | null
  status: string
  notes: string | null
  is_active: boolean
}
interface SalesOrder {
  id: string
  order_number: string
  customer_id: string | null
  status: string
  total_amount: number | null
  notes: string | null
  customers?: { company_name: string } | null
}

const CARRIERS = ['UPS', 'FedEx', 'USPS', 'LTL / Freight', 'Will Call', 'DHL', 'Other']
const STATUS_COLORS: Record<string, string> = {
  Pending: 'bg-[#F3F4F6] text-gray-600 border-[#E4E6EE]',
  Packed: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  'Picked Up': 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  'In Transit': 'bg-teal-500/15 text-teal-400 border-teal-500/20',
}
const fmtD = (d: string | null) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const fmt$ = (n: number | null | undefined) =>
  n ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n) : '—'

export default function ShippingQueuePage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<ShipQItem[]>([])
  const [orderMap, setOrderMap] = useState<Record<string, SalesOrder>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [toast, setToast] = useState<{ message: string; undoData?: any } | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Ship Now modal
  const [shipModal, setShipModal] = useState<ShipQItem | null>(null)
  const [shipForm, setShipForm] = useState({ carrier: 'UPS', tracking: '', shipDate: new Date().toISOString().slice(0, 10), notes: '' })
  const [shipping, setShipping] = useState(false)

  // Label Wizard
  const [labelOrderId, setLabelOrderId] = useState<string | null>(null)
  const [labelCarrier, setLabelCarrier] = useState<string | null>(null)

  // Edit panel
  const [userEmail, setUserEmail] = useState('')
  const [editItem, setEditItem] = useState<ShipQItem | null>(null)
  const [editForm, setEditForm] = useState({ carrier: '', tracking_number: '', scheduled_ship_date: '', notes: '' })
  const [saving, setSaving] = useState(false)

  const ms = useMultiSelect<ShipQItem>()

  async function load() {
    setLoading(true)
    const { data: q } = await sb
      .from('shipping_queue')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
    if (!q) { setLoading(false); return }
    setRows(q as ShipQItem[])

    // Load linked orders
    const orderIds = Array.from(new Set(q.map((r: ShipQItem) => r.sales_order_id).filter(Boolean))) as string[]
    if (orderIds.length > 0) {
      const { data: orders } = await sb
        .from('sales_orders')
        .select('id, order_number, customer_id, status, total_amount, notes, customers(company_name)')
        .in('id', orderIds)
      if (orders) {
        const map: Record<string, SalesOrder> = {}
        for (const o of orders as any[]) map[o.id] = o
        setOrderMap(map)
      }
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    sb.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email) })
  }, []) // eslint-disable-line

  const filtered = rows.filter(r => {
    const order = r.sales_order_id ? orderMap[r.sales_order_id] : null
    const custName = (order?.customers as any)?.company_name ?? (order?.notes ?? '').split('|')[0]
    if (statusFilter !== 'all' && r.status !== statusFilter) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (
      (order?.order_number ?? '').toLowerCase().includes(q) ||
      custName.toLowerCase().includes(q) ||
      (r.carrier ?? '').toLowerCase().includes(q) ||
      (r.tracking_number ?? '').toLowerCase().includes(q)
    )
  })

  const stats = {
    total: rows.length,
    pending: rows.filter(r => r.status === 'Pending').length,
    packed: rows.filter(r => r.status === 'Packed').length,
    transit: rows.filter(r => r.status === 'In Transit' || r.status === 'Picked Up').length,
  }

  async function openShipModal(item: ShipQItem) {
    setShipModal(item)
    setShipForm({ carrier: 'UPS', tracking: '', shipDate: new Date().toISOString().slice(0, 10), notes: '' })
  }

  async function confirmShip() {
    if (!shipModal?.sales_order_id) return
    setShipping(true)
    const orderId = shipModal.sales_order_id

    // Get current order status for undo
    const { data: order } = await sb.from('sales_orders').select('status').eq('id', orderId).single()
    const prevStatus = (order?.status ?? 'Ready to Ship') as OrderStatus

    // Update order status to Shipped
    await sb.from('sales_orders')
      .update({ status: 'Shipped', updated_at: new Date().toISOString() })
      .eq('id', orderId)

    // Update shipping queue item
    await sb.from('shipping_queue').update({
      carrier: shipForm.carrier || null,
      tracking_number: shipForm.tracking || null,
      actual_ship_date: shipForm.shipDate,
      status: 'In Transit',
      notes: shipForm.notes || null,
      updated_at: new Date().toISOString(),
    }).eq('id', shipModal.id)

    // Run auto-flow (creates shipment + invoice + deducts inventory)
    const result = await onStatusChange(orderId, 'Shipped', prevStatus, {
      carrier: shipForm.carrier,
      trackingNumber: shipForm.tracking,
      shipDate: shipForm.shipDate,
    })

    setShipping(false)
    setShipModal(null)
    setToast({ message: result.message, undoData: result.undoData })
    load()
  }

  async function removeFromQueue(item: ShipQItem) {
    if (!confirm('Remove this order from the shipping queue?')) return
    await sb.from('shipping_queue').update({ is_active: false }).eq('id', item.id)
    load()
  }

  async function saveEdit() {
    if (!editItem) return
    setSaving(true)
    await sb.from('shipping_queue').update({
      carrier: editForm.carrier || null,
      tracking_number: editForm.tracking_number || null,
      scheduled_ship_date: editForm.scheduled_ship_date || null,
      notes: editForm.notes || null,
      updated_at: new Date().toISOString(),
    }).eq('id', editItem.id)
    setSaving(false)
    setEditItem(null)
    load()
  }

  async function bulkDelete() {
    if (!confirm(`Remove ${ms.count} items from the shipping queue?`)) return
    setDeleting(true)
    await sb.from('shipping_queue').update({ is_active: false }).in('id', Array.from(ms.selected))
    ms.clear(); setDeleting(false); load()
  }

  async function handleUndo(undoData: any) {
    const result = await undoFlow(undoData)
    setToast({ message: result.message })
    load()
  }

  const inp = 'w-full bg-white border border-[#E4E6EE] focus:border-[#3B6FE0] rounded-xl px-4 py-2.5 text-sm text-[#1A1D2E] placeholder-[#9CA3AF] focus:outline-none transition-colors'

  return (
    <div className="p-6 min-h-screen">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-teal-500/15 text-teal-400 border border-teal-500/20">SALES</span>
          </div>
          <h1 className="text-2xl font-bold text-[#1A1D2E]">Shipping Queue</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {loading ? 'Loading…' : `${filtered.length} order${filtered.length !== 1 ? 's' : ''} ready to ship`}
          </p>
        </div>
        <button
          onClick={() => load()}
          className="flex items-center gap-2 text-sm text-[#6B7280] hover:text-[#1A1D2E] border border-[#E4E6EE] hover:border-[#D0D3E0] bg-white px-4 py-2.5 rounded-xl transition-colors self-start"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
          </svg>
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'In Queue', value: stats.total, color: 'text-[#1A1D2E]' },
          { label: 'Pending', value: stats.pending, color: 'text-gray-400' },
          { label: 'Packed', value: stats.packed, color: 'text-blue-400' },
          { label: 'In Transit', value: stats.transit, color: 'text-teal-400' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-[#E4E6EE] rounded-2xl px-4 py-3.5">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-gray-500 text-xs mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
          </svg>
          <input
            placeholder="Search by order, customer, carrier…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-[#3B6FE0] transition-colors"
          />
        </div>
        <div className="flex items-center gap-1 bg-white border border-[#E4E6EE] rounded-xl p-1">
          {['all', 'Pending', 'Packed', 'In Transit'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${statusFilter === s ? 'bg-[#F0F1F5] text-[#1A1D2E]' : 'text-gray-500 hover:text-[#1A1D2E]'}`}
            >
              {s === 'all' ? 'All' : s}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-[#E4E6EE] rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <svg className="w-5 h-5 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <svg className="w-12 h-12 text-gray-800" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0"/>
            </svg>
            <p className="text-gray-500 text-sm">{search ? 'No matches.' : 'Queue is empty — orders marked "Ready to Ship" appear here.'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E4E6EE]">
                  <th className="w-10 px-4 py-3">
                    <input type="checkbox" checked={ms.isAllSelected(filtered)} onChange={() => ms.toggleAll(filtered)} className="accent-emerald-500 w-4 h-4 cursor-pointer"/>
                  </th>
                  {['Order #', 'Customer', 'Value', 'Sched. Ship', 'Carrier / Tracking', 'Status', 'Actions'].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => {
                  const order = row.sales_order_id ? orderMap[row.sales_order_id] : null
                  const custName = (order?.customers as any)?.company_name ?? (order?.notes ?? '').split('|')[0].trim() ?? '—'
                  return (
                    <tr key={row.id}
                      className={`border-b border-[#E4E6EE]/50 last:border-0 transition-colors ${ms.isSelected(row.id) ? 'bg-blue-500/5' : i % 2 === 0 ? 'hover:bg-[#F5F6FA]' : 'bg-[#FAFAFA] hover:bg-[#F5F6FA]'}`}>
                      <td className="px-4 py-3.5" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={ms.isSelected(row.id)} onChange={() => ms.toggle(row.id)} className="accent-emerald-500 w-4 h-4 cursor-pointer"/>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="text-[#1A1D2E] font-mono font-semibold text-xs">{order?.order_number ?? '—'}</span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="text-[#1A1D2E] font-medium">{custName}</span>
                      </td>
                      <td className="px-4 py-3.5 text-gray-400 text-xs">{fmt$(order?.total_amount)}</td>
                      <td className="px-4 py-3.5 text-gray-400 text-xs whitespace-nowrap">{fmtD(row.scheduled_ship_date)}</td>
                      <td className="px-4 py-3.5">
                        {row.carrier ? (
                          <div>
                            <p className="text-[#374151] text-xs">{row.carrier}</p>
                            {row.tracking_number && (
                              <p className="text-[#6B7280] text-xs font-mono mt-0.5 truncate max-w-[120px]">{row.tracking_number}</p>
                            )}
                          </div>
                        ) : (
                          <span className="text-[#9CA3AF] text-xs">Not assigned</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${STATUS_COLORS[row.status] ?? STATUS_COLORS.Pending}`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="px-4 py-3.5" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => openShipModal(row)}
                            className="flex items-center gap-1 text-xs bg-emerald-600 hover:bg-emerald-500 text-[#1A1D2E] font-medium px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
                            </svg>
                            Ship
                          </button>
                          <button
                            onClick={() => {
                              setEditItem(row)
                              setEditForm({ carrier: row.carrier ?? '', tracking_number: row.tracking_number ?? '', scheduled_ship_date: row.scheduled_ship_date ?? '', notes: row.notes ?? '' })
                            }}
                            className="text-xs border border-[#E4E6EE] hover:border-[#D0D3E0] text-[#6B7280] hover:text-[#1A1D2E] px-2.5 py-1.5 rounded-lg transition-colors"
                          >
                            Edit
                          </button>
                          {row.sales_order_id && (
                            <button
                              onClick={() => { setLabelOrderId(row.sales_order_id); setLabelCarrier(row.carrier ?? null) }}
                              className="flex items-center gap-1 text-xs bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-400 px-2.5 py-1.5 rounded-lg transition-colors font-medium whitespace-nowrap"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/>
                              </svg>
                              Labels
                            </button>
                          )}
                          <button
                            onClick={() => removeFromQueue(row)}
                            className="text-xs text-gray-600 hover:text-red-400 px-2 py-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                            </svg>
                          </button>
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

      <BulkActionBar
        count={ms.count}
        onDelete={bulkDelete}
        onClear={ms.clear}
        deleting={deleting}
        extraActions={
          <span className="text-gray-500 text-xs">Remove from queue</span>
        }
      />

      {/* ── SHIP NOW MODAL ── */}
      {shipModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={() => !shipping && setShipModal(null)}>
          <div className="bg-white border border-[#E4E6EE] rounded-2xl w-full max-w-md shadow-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-5 border-b border-[#E4E6EE]">
              <div>
                <h2 className="text-[#1A1D2E] font-semibold">Confirm Shipment</h2>
                {shipModal.sales_order_id && orderMap[shipModal.sales_order_id] && (
                  <p className="text-gray-500 text-xs mt-0.5">
                    {orderMap[shipModal.sales_order_id].order_number} · {(orderMap[shipModal.sales_order_id].customers as any)?.company_name ?? (orderMap[shipModal.sales_order_id].notes ?? '').split('|')[0].trim()}
                  </p>
                )}
              </div>
              <button onClick={() => setShipModal(null)} className="text-[#6B7280] hover:text-[#1A1D2E] p-1.5 rounded-lg hover:bg-[#F5F6FA] transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3">
                <p className="text-amber-400 text-xs font-medium">This will automatically:</p>
                <ul className="text-amber-300/80 text-xs mt-1.5 space-y-0.5 list-disc list-inside">
                  <li>Mark the order as Shipped</li>
                  <li>Create a shipment record</li>
                  <li>Deduct inventory for all line items</li>
                  <li>Generate an invoice (Net 30)</li>
                </ul>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">Carrier</label>
                <select value={shipForm.carrier} onChange={e => setShipForm(p => ({ ...p, carrier: e.target.value }))} className={inp + ' cursor-pointer'}>
                  {CARRIERS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">Tracking Number</label>
                <input
                  value={shipForm.tracking}
                  onChange={e => setShipForm(p => ({ ...p, tracking: e.target.value }))}
                  placeholder="Optional"
                  className={inp}
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">Ship Date</label>
                <input
                  type="date"
                  value={shipForm.shipDate}
                  onChange={e => setShipForm(p => ({ ...p, shipDate: e.target.value }))}
                  className={inp}
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">Notes</label>
                <textarea
                  rows={2}
                  value={shipForm.notes}
                  onChange={e => setShipForm(p => ({ ...p, notes: e.target.value }))}
                  placeholder="Optional"
                  className={inp + ' resize-none'}
                />
              </div>
            </div>

            <div className="px-6 pb-5 flex gap-3">
              <button
                onClick={() => setShipModal(null)}
                className="flex-1 text-sm border border-[#E4E6EE] text-[#6B7280] hover:text-[#1A1D2E] py-2.5 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmShip}
                disabled={shipping}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-[#1A1D2E] font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm"
              >
                {shipping ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                    Shipping…
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
                    Confirm Shipment
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT PANEL ── */}
      {editItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={() => setEditItem(null)}>
          <div className="bg-white border border-[#E4E6EE] rounded-2xl w-full max-w-sm shadow-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-5 border-b border-[#E4E6EE]">
              <h2 className="text-[#1A1D2E] font-semibold">Edit Queue Item</h2>
              <button onClick={() => setEditItem(null)} className="text-[#6B7280] hover:text-[#1A1D2E] p-1.5 rounded-lg hover:bg-[#F5F6FA] transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Carrier</label>
                <select value={editForm.carrier} onChange={e => setEditForm(p => ({ ...p, carrier: e.target.value }))} className={inp + ' cursor-pointer'}>
                  <option value="">— None —</option>
                  {CARRIERS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Tracking Number</label>
                <input value={editForm.tracking_number} onChange={e => setEditForm(p => ({ ...p, tracking_number: e.target.value }))} className={inp}/>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Scheduled Ship Date</label>
                <input type="date" value={editForm.scheduled_ship_date} onChange={e => setEditForm(p => ({ ...p, scheduled_ship_date: e.target.value }))} className={inp}/>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Notes</label>
                <textarea rows={2} value={editForm.notes} onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))} className={inp + ' resize-none'}/>
              </div>
            </div>
            <div className="px-6 pb-4 border-t border-[#E4E6EE] pt-4">
              <Comments recordId={editItem.id} recordType="shipping_queue" currentUserEmail={userEmail}/>
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <button onClick={() => setEditItem(null)} className="flex-1 text-sm border border-[#E4E6EE] text-[#6B7280] hover:text-[#1A1D2E] py-2.5 rounded-xl transition-colors">Cancel</button>
              <button onClick={saveEdit} disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-[#1A1D2E] text-sm font-medium py-2.5 rounded-xl transition-colors">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {labelOrderId && (
        <LabelWizard
          orderId={labelOrderId}
          initialCarrier={labelCarrier}
          onClose={() => { setLabelOrderId(null); setLabelCarrier(null) }}
        />
      )}

      {toast && (
        <UndoToast
          message={toast.message}
          onUndo={toast.undoData ? () => handleUndo(toast.undoData) : undefined}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  )
}
