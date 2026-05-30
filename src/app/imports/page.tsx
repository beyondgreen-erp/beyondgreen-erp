'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useEffect } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface ImportShipment {
  id: string
  bg_po_number: string | null
  description: string
  case_qty: number | null
  freight_method: string
  etd: string | null
  eta_los_angeles: string | null
  vessel_name: string | null
  vessel_number: string | null
  flight_number: string | null
  booking_number: string | null
  bl_number: string | null
  hbl_number: string | null
  container_number: string | null
  shipper: string | null
  broker: string | null
  status: string
  arrival_notice: string | null
  exw_price: number | null
  comm_inv_amt: number | null
  china_tariff_25pct: number | null
  duty_10pct: number | null
  mpf: number | null
  hmf: number | null
  total_duties: number | null
  broker_inv_amount: number | null
  total_landed_cost: number | null
  broker_invoice_number: string | null
  broker_inv_date: string | null
  payment_ref: string | null
  payment_date: string | null
  notes: string | null
  created_at: string
}

const EMPTY_NEW_FORM = {
  bg_po_number: '',
  description: '',
  case_qty: '',
  freight_method: 'OCEAN',
  etd: '',
  eta_los_angeles: '',
  vessel_name: '',
  vessel_number: '',
  booking_number: '',
  bl_number: '',
  hbl_number: '',
  container_number: '',
  shipper: '',
  broker: 'OEC LOGISTICS INC.',
  status: 'Pending',
  exw_price: '',
  comm_inv_amt: '',
  china_tariff_25pct: '',
  duty_10pct: '',
  mpf: '',
  hmf: '',
  total_duties: '',
  broker_inv_amount: '',
  total_landed_cost: '',
  broker_invoice_number: '',
  broker_inv_date: '',
  notes: '',
}

function getTrackingUrl(s: ImportShipment): string | null {
  if (s.freight_method === 'AIR' && s.container_number) {
    return 'https://www.flightradar24.com'
  }
  if (s.container_number) {
    return 'https://www.track-trace.com/container?id=' + s.container_number
  }
  if (s.bl_number) {
    return 'https://www.track-trace.com/bill-of-lading?id=' + s.bl_number
  }
  if (s.vessel_name) {
    return 'https://www.marinetraffic.com/en/ais/index/search/all/keyword:' +
      encodeURIComponent(s.vessel_name)
  }
  return null
}

export default function ImportsPage() {
  const supabase = createSupabaseBrowserClient()
  const [shipments, setShipments] = useState<ImportShipment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('all')
  const [search, setSearch] = useState('')

  // Edit panel
  const [panelOpen, setPanelOpen] = useState(false)
  const [editing, setEditing] = useState<ImportShipment | null>(null)
  const [editForm, setEditForm] = useState<any>({})
  const [saving, setSaving] = useState(false)

  // Add new panel
  const [showAddForm, setShowAddForm] = useState(false)
  const [newForm, setNewForm] = useState<any>({ ...EMPTY_NEW_FORM })

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchShipments() }, [])

  async function fetchShipments() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('import_shipments')
      .select('*')
      .order('eta_los_angeles', { ascending: true })
    if (error) {
      console.error('Import tracker error:', error)
      setError(error.message)
      setLoading(false)
      return
    }
    setShipments(data || [])
    setLoading(false)
  }

  function openEdit(item: ImportShipment) {
    setEditing(item)
    setEditForm({ ...item })
    setPanelOpen(true)
  }

  function handleEditChange(key: string, value: any) {
    setEditForm((prev: any) => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    setSaving(true)
    const updateData = {
      bg_po_number: editForm.bg_po_number,
      description: editForm.description,
      case_qty: editForm.case_qty ? parseInt(editForm.case_qty) : null,
      status: editForm.status,
      etd: editForm.etd || null,
      eta_los_angeles: editForm.eta_los_angeles || null,
      vessel_name: editForm.vessel_name,
      booking_number: editForm.booking_number,
      bl_number: editForm.bl_number,
      hbl_number: editForm.hbl_number,
      container_number: editForm.container_number,
      shipper: editForm.shipper,
      broker: editForm.broker,
      exw_price: editForm.exw_price ? parseFloat(editForm.exw_price) : null,
      comm_inv_amt: editForm.comm_inv_amt ? parseFloat(editForm.comm_inv_amt) : null,
      china_tariff_25pct: editForm.china_tariff_25pct ? parseFloat(editForm.china_tariff_25pct) : null,
      duty_10pct: editForm.duty_10pct ? parseFloat(editForm.duty_10pct) : null,
      mpf: editForm.mpf ? parseFloat(editForm.mpf) : null,
      hmf: editForm.hmf ? parseFloat(editForm.hmf) : null,
      total_duties: editForm.total_duties ? parseFloat(editForm.total_duties) : null,
      broker_inv_amount: editForm.broker_inv_amount ? parseFloat(editForm.broker_inv_amount) : null,
      total_landed_cost: editForm.total_landed_cost ? parseFloat(editForm.total_landed_cost) : null,
      broker_invoice_number: editForm.broker_invoice_number,
      broker_inv_date: editForm.broker_inv_date || null,
      payment_ref: editForm.payment_ref,
      notes: editForm.notes,
    }
    const { error } = await supabase
      .from('import_shipments')
      .update(updateData)
      .eq('id', editForm.id)
    setSaving(false)
    if (error) {
      console.error('Save error:', error)
      alert('Save failed: ' + error.message)
      return
    }
    setPanelOpen(false)
    setEditForm({})
    setEditing(null)
    fetchShipments()
  }

  async function handleAddNew() {
    if (!newForm.description.trim()) {
      alert('Description is required')
      return
    }
    setSaving(true)
    const insertData = {
      bg_po_number: newForm.bg_po_number || null,
      description: newForm.description,
      case_qty: newForm.case_qty ? parseInt(newForm.case_qty) : null,
      freight_method: newForm.freight_method,
      etd: newForm.etd || null,
      eta_los_angeles: newForm.eta_los_angeles || null,
      vessel_name: newForm.vessel_name || null,
      vessel_number: newForm.vessel_number || null,
      booking_number: newForm.booking_number || null,
      bl_number: newForm.bl_number || null,
      hbl_number: newForm.hbl_number || null,
      container_number: newForm.container_number || null,
      shipper: newForm.shipper || null,
      broker: newForm.broker || null,
      status: newForm.status,
      exw_price: newForm.exw_price ? parseFloat(newForm.exw_price) : null,
      comm_inv_amt: newForm.comm_inv_amt ? parseFloat(newForm.comm_inv_amt) : null,
      china_tariff_25pct: newForm.china_tariff_25pct ? parseFloat(newForm.china_tariff_25pct) : null,
      duty_10pct: newForm.duty_10pct ? parseFloat(newForm.duty_10pct) : null,
      mpf: newForm.mpf ? parseFloat(newForm.mpf) : null,
      hmf: newForm.hmf ? parseFloat(newForm.hmf) : null,
      total_duties: newForm.total_duties ? parseFloat(newForm.total_duties) : null,
      broker_inv_amount: newForm.broker_inv_amount ? parseFloat(newForm.broker_inv_amount) : null,
      total_landed_cost: newForm.total_landed_cost ? parseFloat(newForm.total_landed_cost) : null,
      broker_invoice_number: newForm.broker_invoice_number || null,
      broker_inv_date: newForm.broker_inv_date || null,
      notes: newForm.notes || null,
    }
    const { error } = await supabase.from('import_shipments').insert(insertData)
    setSaving(false)
    if (error) {
      alert('Failed to add: ' + error.message)
      return
    }
    setShowAddForm(false)
    setNewForm({ ...EMPTY_NEW_FORM })
    fetchShipments()
  }

  const filtered = shipments.filter(s => {
    const q = search.toLowerCase()
    const matchSearch = !q ||
      (s.description || '').toLowerCase().includes(q) ||
      (s.bg_po_number || '').toLowerCase().includes(q) ||
      (s.vessel_name || '').toLowerCase().includes(q) ||
      (s.booking_number || '').toLowerCase().includes(q) ||
      (s.bl_number || '').toLowerCase().includes(q) ||
      (s.status || '').toLowerCase().includes(q)
    const matchTab =
      activeTab === 'all' ? true :
      activeTab === 'ocean' ? s.freight_method === 'OCEAN' :
      activeTab === 'air' ? s.freight_method === 'AIR' :
      activeTab === 'received' ? s.status === 'Received' :
      activeTab === 'active' ? s.status !== 'Received' :
      activeTab === 'financials' ? (s.comm_inv_amt || 0) > 0 : true
    return matchSearch && matchTab
  })

  const grouped = filtered.reduce((acc, s) => {
    const key = s.booking_number || s.id
    if (!acc[key]) acc[key] = []
    acc[key].push(s)
    return acc
  }, {} as Record<string, ImportShipment[]>)

  function getStatusStyle(status: string) {
    switch (status) {
      case 'Received': return 'bg-emerald-500/15 text-emerald-400'
      case 'In Transit': return 'bg-blue-500/15 text-blue-400'
      case 'Gated': return 'bg-blue-500/15 text-blue-400'
      case 'At Port of Dispatch': return 'bg-amber-500/15 text-amber-400'
      case 'Air Cargo Warehouse': return 'bg-cyan-500/15 text-cyan-400'
      case 'Arriving Today': return 'bg-red-500/15 text-red-400 animate-pulse'
      case 'Arriving Tomorrow': return 'bg-amber-500/15 text-amber-400 animate-pulse'
      default: return 'bg-gray-500/15 text-gray-400'
    }
  }

  function getFreightIcon(method: string) { return method === 'AIR' ? '✈' : '🚢' }

  function getEtaCountdown(eta: string | null) {
    if (!eta) return null
    const days = Math.ceil((new Date(eta).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    if (days === 0) return { label: 'Today', color: 'text-red-400 font-bold animate-pulse' }
    if (days === 1) return { label: 'Tomorrow', color: 'text-amber-400' }
    if (days > 0) return { label: `${days} days`, color: 'text-blue-400' }
    return { label: `${Math.abs(days)}d late`, color: 'text-gray-500' }
  }

  function fmt(n: number | null) {
    if (!n || n === 0) return '—'
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  function fmtDate(d: string | null) {
    if (!d) return '—'
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  function fmtDateFull(d: string | null) {
    if (!d) return '—'
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
  }

  const totalCommInv = shipments.reduce((s, r) => s + (r.comm_inv_amt || 0), 0)
  const totalLanded = shipments.reduce((s, r) => s + (r.total_landed_cost || 0), 0)
  const activeCount = shipments.filter(s => s.status !== 'Received').length
  const receivedCount = shipments.filter(s => s.status === 'Received').length

  const tabs = [
    { id: 'all', label: `All (${shipments.length})` },
    { id: 'active', label: `Active (${activeCount})` },
    { id: 'ocean', label: '🚢 Ocean' },
    { id: 'air', label: '✈ Air' },
    { id: 'received', label: `✅ Received (${receivedCount})` },
    { id: 'financials', label: '💰 Financials' },
  ]

  const inp = 'w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500'

  const statusOptions = ['Pending', 'Gated', 'In Transit', 'At Port of Dispatch', 'Air Cargo Warehouse', 'Arriving Tomorrow', 'Arriving Today', 'Received', 'Cleared', 'Delivered']

  // Shared form section renderer for edit and add panels
  function FormFields({ form, onChange }: { form: any; onChange: (k: string, v: any) => void }) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-400 uppercase tracking-wider block mb-1.5">BG PO#</label>
            <input type="text" value={form.bg_po_number || ''} onChange={e => onChange('bg_po_number', e.target.value)} className={inp} />
          </div>
          <div>
            <label className="text-xs text-gray-400 uppercase tracking-wider block mb-1.5">Status</label>
            <select value={form.status || 'Pending'} onChange={e => onChange('status', e.target.value)} className={inp}>
              {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-400 uppercase tracking-wider block mb-1.5">Description *</label>
          <textarea value={form.description || ''} onChange={e => onChange('description', e.target.value)} rows={2} className={inp + ' resize-none'} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-400 uppercase tracking-wider block mb-1.5">Cases</label>
            <input type="number" value={form.case_qty || ''} onChange={e => onChange('case_qty', e.target.value)} className={inp} />
          </div>
          <div>
            <label className="text-xs text-gray-400 uppercase tracking-wider block mb-1.5">Freight Method</label>
            <select value={form.freight_method || 'OCEAN'} onChange={e => onChange('freight_method', e.target.value)} className={inp}>
              <option value="OCEAN">OCEAN</option>
              <option value="AIR">AIR</option>
            </select>
          </div>
        </div>

        <div className="border-t border-gray-800 pt-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Voyage Details</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">ETD</label>
              <input type="date" value={form.etd || ''} onChange={e => onChange('etd', e.target.value)} className={inp} />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">ETA Los Angeles</label>
              <input type="date" value={form.eta_los_angeles || ''} onChange={e => onChange('eta_los_angeles', e.target.value)} className={inp} />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Vessel Name</label>
              <input type="text" value={form.vessel_name || ''} onChange={e => onChange('vessel_name', e.target.value)} className={inp} />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Booking #</label>
              <input type="text" value={form.booking_number || ''} onChange={e => onChange('booking_number', e.target.value)} className={inp} />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">BL Number</label>
              <input type="text" value={form.bl_number || ''} onChange={e => onChange('bl_number', e.target.value)} className={inp} />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">HBL Number</label>
              <input type="text" value={form.hbl_number || ''} onChange={e => onChange('hbl_number', e.target.value)} className={inp} />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Container #</label>
              <input type="text" value={form.container_number || ''} onChange={e => onChange('container_number', e.target.value)} className={inp} />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Shipper</label>
              <input type="text" value={form.shipper || ''} onChange={e => onChange('shipper', e.target.value)} className={inp} />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-400 block mb-1">Broker</label>
              <input type="text" value={form.broker || ''} onChange={e => onChange('broker', e.target.value)} className={inp} />
            </div>
          </div>
        </div>

        <div className="border-t border-gray-800 pt-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Financial Details</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'EXW Price', key: 'exw_price' },
              { label: 'Comm Inv Amt', key: 'comm_inv_amt' },
              { label: 'China 25%', key: 'china_tariff_25pct' },
              { label: 'Duty 10%', key: 'duty_10pct' },
              { label: 'MPF', key: 'mpf' },
              { label: 'HMF', key: 'hmf' },
              { label: 'Total Duties', key: 'total_duties' },
              { label: 'Broker Fee', key: 'broker_inv_amount' },
              { label: 'Total Landed Cost', key: 'total_landed_cost' },
            ].map(field => (
              <div key={field.key}>
                <label className="text-xs text-gray-400 block mb-1">{field.label}</label>
                <input
                  type="number"
                  step="0.01"
                  value={form[field.key] ?? ''}
                  onChange={e => onChange(field.key, e.target.value)}
                  className={inp}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-gray-800 pt-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Broker Invoice</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Invoice #</label>
              <input type="text" value={form.broker_invoice_number || ''} onChange={e => onChange('broker_invoice_number', e.target.value)} className={inp} />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Invoice Date</label>
              <input type="date" value={form.broker_inv_date || ''} onChange={e => onChange('broker_inv_date', e.target.value)} className={inp} />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Payment Ref</label>
              <input type="text" value={form.payment_ref || ''} onChange={e => onChange('payment_ref', e.target.value)} className={inp} />
            </div>
          </div>
        </div>

        <div className="border-t border-gray-800 pt-4">
          <label className="text-xs text-gray-400 uppercase tracking-wider block mb-1.5">Notes</label>
          <textarea value={form.notes || ''} onChange={e => onChange('notes', e.target.value)} rows={3} className={inp + ' resize-none'} />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen p-6 bg-[#0C0C0E]">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            🚢 Import Tracker
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {shipments.length} shipments across {Object.keys(grouped).length} bookings
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Add Shipment
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Shipments', value: shipments.length.toString(), color: 'text-white' },
          { label: 'Active', value: activeCount.toString(), color: 'text-blue-400' },
          { label: 'Total Comm Inv', value: totalCommInv > 0 ? '$' + (totalCommInv / 1000).toFixed(1) + 'K' : '—', color: 'text-amber-400' },
          { label: 'Total Landed Cost', value: totalLanded > 0 ? '$' + (totalLanded / 1000).toFixed(1) + 'K' : '—', color: 'text-emerald-400' },
        ].map(stat => (
          <div key={stat.label} className="bg-[#111113] border border-[#2A2A35] rounded-xl p-4">
            <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
            <p className="text-gray-500 text-xs mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by PO#, description, vessel, BL#, status…"
          className="w-full bg-[#111113] border border-[#2A2A35] rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
              activeTab === tab.id
                ? 'bg-emerald-600 text-white'
                : 'bg-[#111113] border border-[#2A2A35] text-gray-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-4">
          <p className="text-red-400 text-sm font-medium mb-1">Failed to load shipments</p>
          <p className="text-red-300 text-xs font-mono">{error}</p>
          <button onClick={fetchShipments} className="text-red-400 text-xs underline mt-2">Retry</button>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-[#111113] rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && filtered.length === 0 && (
        <div className="text-center py-20">
          <p className="text-4xl mb-4">🚢</p>
          <p className="text-gray-400 font-medium">No shipments found</p>
          <p className="text-gray-600 text-sm mt-1">
            {search ? 'Try a different search term' : 'No import shipments in the database yet'}
          </p>
        </div>
      )}

      {/* Grouped shipments */}
      {!loading && !error && filtered.length > 0 && (
        <div className="space-y-4">
          {Object.entries(grouped).map(([bookingKey, items]) => {
            const first = items[0]
            const eta = getEtaCountdown(first.eta_los_angeles)
            const totalInv = items.reduce((s, i) => s + (i.comm_inv_amt || 0), 0)

            return (
              <div key={bookingKey} className="bg-[#111113] border border-[#2A2A35] rounded-2xl overflow-hidden">

                {/* Booking header */}
                <div className="flex items-center gap-3 px-5 py-4 bg-[#18181C] border-b border-[#2A2A35]">
                  <span className="text-xl">{getFreightIcon(first.freight_method)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-semibold text-sm">
                        {first.vessel_name || first.flight_number || 'Unknown Vessel'}
                      </span>
                      {first.booking_number && (
                        <span className="text-gray-500 text-xs">Booking: {first.booking_number}</span>
                      )}
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getStatusStyle(first.status)}`}>
                        {first.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                      <span>{items.length} item{items.length !== 1 ? 's' : ''}</span>
                      {first.etd && <span>ETD: {fmtDate(first.etd)}</span>}
                      {first.eta_los_angeles && <span>ETA: {fmtDate(first.eta_los_angeles)}</span>}
                      {eta && <span className={eta.color}>{eta.label}</span>}
                      {totalInv > 0 && <span className="text-amber-400">Comm Inv: {fmt(totalInv)}</span>}
                    </div>
                  </div>
                  <div className="text-right text-xs text-gray-500 shrink-0">
                    <div>{first.shipper?.split(' ').slice(0, 3).join(' ')}</div>
                    <div>{first.broker}</div>
                  </div>
                </div>

                {/* Items table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[#2A2A35]">
                        {['PO#', 'Description', 'Cases', 'ETD', 'ETA', 'Status', 'BL#', 'HBL#', 'Container', 'EXW', 'Comm Inv', 'China 25%', 'Duty 10%', 'MPF', 'HMF', 'Total Duties', 'Broker Fee', 'Landed Cost', 'Broker Inv#', 'Inv Date', 'Actions'].map(col => (
                          <th key={col} className="text-left text-gray-500 uppercase tracking-wider py-2.5 px-3 whitespace-nowrap font-medium">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(item => {
                        const trackUrl = getTrackingUrl(item)
                        return (
                          <tr key={item.id} className="border-b border-[#2A2A35]/50 last:border-0 hover:bg-[#18181C] transition-colors">
                            <td className="py-3 px-3 text-gray-400 whitespace-nowrap font-mono">{item.bg_po_number || '—'}</td>
                            <td className="py-3 px-3 text-white max-w-xs">
                              <div className="truncate max-w-[200px]" title={item.description}>{item.description}</div>
                            </td>
                            <td className="py-3 px-3 text-gray-300 text-center">{item.case_qty ?? '—'}</td>
                            <td className="py-3 px-3 text-gray-400 whitespace-nowrap">{fmtDate(item.etd)}</td>
                            <td className="py-3 px-3 whitespace-nowrap text-gray-400">{fmtDate(item.eta_los_angeles)}</td>
                            <td className="py-3 px-3">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${getStatusStyle(item.status)}`}>{item.status}</span>
                            </td>
                            <td className="py-3 px-3 text-gray-400 whitespace-nowrap font-mono">{item.bl_number || '—'}</td>
                            <td className="py-3 px-3 text-gray-400 whitespace-nowrap font-mono">{item.hbl_number || '—'}</td>
                            <td className="py-3 px-3 text-gray-400 whitespace-nowrap font-mono">{item.container_number || '—'}</td>
                            <td className="py-3 px-3 text-right text-gray-300">{fmt(item.exw_price)}</td>
                            <td className="py-3 px-3 text-right text-amber-400 font-medium">{fmt(item.comm_inv_amt)}</td>
                            <td className="py-3 px-3 text-right text-red-400">{fmt(item.china_tariff_25pct)}</td>
                            <td className="py-3 px-3 text-right text-red-400">{fmt(item.duty_10pct)}</td>
                            <td className="py-3 px-3 text-right text-gray-400">{fmt(item.mpf)}</td>
                            <td className="py-3 px-3 text-right text-gray-400">{fmt(item.hmf)}</td>
                            <td className="py-3 px-3 text-right text-red-400 font-medium">{fmt(item.total_duties)}</td>
                            <td className="py-3 px-3 text-right text-gray-400">{fmt(item.broker_inv_amount)}</td>
                            <td className="py-3 px-3 text-right text-emerald-400 font-bold">{fmt(item.total_landed_cost)}</td>
                            <td className="py-3 px-3 text-gray-400 whitespace-nowrap font-mono">{item.broker_invoice_number || '—'}</td>
                            <td className="py-3 px-3 text-gray-400 whitespace-nowrap">{fmtDateFull(item.broker_inv_date)}</td>
                            <td className="py-3 px-3">
                              <div className="flex items-center gap-1">
                                {trackUrl && (
                                  <a
                                    href={trackUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title="Track shipment"
                                    className="px-1.5 py-1 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-xs font-medium whitespace-nowrap transition-colors"
                                  >
                                    Track ↗
                                  </a>
                                )}
                                <button
                                  onClick={() => openEdit(item)}
                                  title="Edit"
                                  className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-500 hover:text-white transition-colors"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                </button>
                                <button
                                  onClick={async () => {
                                    if (!confirm('Delete this shipment record?')) return
                                    await supabase.from('import_shipments').delete().eq('id', item.id)
                                    fetchShipments()
                                  }}
                                  title="Delete"
                                  className="p-1.5 rounded-lg hover:bg-red-500/20 text-gray-500 hover:text-red-400 transition-colors"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Tracking note */}
      <div className="mt-6 p-4 bg-[#111113] border border-[#2A2A35] rounded-xl text-xs text-gray-500">
        📍 Positions are estimated based on ETD/ETA. For live tracking visit{' '}
        <a href="https://www.marinetraffic.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">MarineTraffic.com</a>
        {' '}or{' '}
        <a href="https://www.vesselfinder.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">VesselFinder.com</a>
      </div>

      {/* ── EDIT PANEL ── */}
      <div
        className={`fixed inset-0 bg-black/60 z-40 transition-opacity ${panelOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setPanelOpen(false)}
      />
      <div
        onClick={e => e.stopPropagation()}
        className={`fixed top-0 right-0 h-full w-full max-w-xl bg-[#0A0A0B] border-l border-[#2A2A35] z-50 flex flex-col shadow-2xl transition-transform duration-300 ${panelOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#2A2A35] shrink-0">
          <h2 className="text-lg font-semibold text-white">Edit Shipment</h2>
          <button
            onClick={() => setPanelOpen(false)}
            className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center justify-center text-gray-400"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {editing && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="text-xs text-gray-500 truncate mb-4">{editing.description}</div>
            <FormFields form={editForm} onChange={handleEditChange} />
            <div className="flex gap-3 pt-6">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium text-sm py-2.5 rounded-xl transition-colors"
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
              <button
                onClick={() => setPanelOpen(false)}
                className="px-5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-xl transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── ADD NEW PANEL ── */}
      <div
        className={`fixed inset-0 bg-black/60 z-40 transition-opacity ${showAddForm ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setShowAddForm(false)}
      />
      <div
        onClick={e => e.stopPropagation()}
        className={`fixed top-0 right-0 h-full w-full max-w-xl bg-[#0A0A0B] border-l border-[#2A2A35] z-50 flex flex-col shadow-2xl transition-transform duration-300 ${showAddForm ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#2A2A35] shrink-0">
          <h2 className="text-lg font-semibold text-white">Add New Shipment</h2>
          <button
            onClick={() => setShowAddForm(false)}
            className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center justify-center text-gray-400"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <FormFields form={newForm} onChange={(k, v) => setNewForm((prev: any) => ({ ...prev, [k]: v }))} />
          <div className="flex gap-3 pt-6">
            <button
              onClick={handleAddNew}
              disabled={saving}
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium text-sm py-2.5 rounded-xl transition-colors"
            >
              {saving ? 'Saving…' : 'Add Shipment'}
            </button>
            <button
              onClick={() => setShowAddForm(false)}
              className="px-5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-xl transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>

    </div>
  )
}
