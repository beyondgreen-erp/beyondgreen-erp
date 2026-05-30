'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useEffect, useCallback, memo } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const supabase = createSupabaseBrowserClient()

const FIELDS = [
  { key: 'bg_po_number', label: 'BG PO#', type: 'text' },
  { key: 'description', label: 'Description *', type: 'textarea' },
  { key: 'case_qty', label: 'Cases', type: 'number' },
  { key: 'freight_method', label: 'Freight', type: 'select',
    options: ['OCEAN','AIR'] },
  { key: 'etd', label: 'ETD', type: 'date' },
  { key: 'eta_los_angeles', label: 'ETA Los Angeles', type: 'date' },
  { key: 'vessel_name', label: 'Vessel / Flight', type: 'text' },
  { key: 'vessel_number', label: 'Vessel #', type: 'text' },
  { key: 'booking_number', label: 'Booking #', type: 'text' },
  { key: 'bl_number', label: 'BL #', type: 'text' },
  { key: 'hbl_number', label: 'HBL #', type: 'text' },
  { key: 'container_number', label: 'Container / Flight #', type: 'text' },
  { key: 'shipper', label: 'Shipper', type: 'text' },
  { key: 'broker', label: 'Broker', type: 'text' },
  { key: 'status', label: 'Status', type: 'select', options: [
    'Pending','Gated','In Transit','At Port of Dispatch',
    'Air Cargo Warehouse','Arriving Tomorrow','Arriving Today',
    'Received','Cleared','Delivered'
  ]},
  { key: 'arrival_notice', label: 'Arrival Notice', type: 'text' },
  { key: 'exw_price', label: 'EXW Price', type: 'number' },
  { key: 'comm_inv_amt', label: 'Comm Inv Amt', type: 'number' },
  { key: 'china_tariff_25pct', label: 'China 25%', type: 'number' },
  { key: 'duty_10pct', label: 'Duty 10%', type: 'number' },
  { key: 'mpf', label: 'MPF', type: 'number' },
  { key: 'hmf', label: 'HMF', type: 'number' },
  { key: 'total_duties', label: 'Total Duties', type: 'number' },
  { key: 'broker_inv_amount', label: 'Broker Fee', type: 'number' },
  { key: 'total_landed_cost', label: 'Total Landed Cost', type: 'number' },
  { key: 'broker_invoice_number', label: 'Broker Invoice #', type: 'text' },
  { key: 'broker_inv_date', label: 'Invoice Date', type: 'date' },
  { key: 'payment_ref', label: 'Payment Ref', type: 'text' },
  { key: 'notes', label: 'Notes', type: 'textarea' },
]

// ShipmentForm is a module-level memo'd component — giving it a stable identity
// so parent state changes never unmount it (which would kill focus mid-typing).
const ShipmentForm = memo(({
  initial,
  onSave,
  onClose,
  title,
  saveLabel,
}: {
  initial: Record<string, any>
  onSave: (data: Record<string, any>) => Promise<void>
  onClose: () => void
  title: string
  saveLabel: string
}) => {
  const [form, setForm] = useState<Record<string, any>>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = useCallback((k: string, v: any) => {
    setForm(prev => ({ ...prev, [k]: v }))
  }, [])

  async function handleSave() {
    if (!form.description?.trim()) {
      setError('Description is required')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave(form)
    } catch (e: any) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const cls = 'w-full bg-[#18181C] border border-[#2A2A35] rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500'

  return (
    <div
      className="fixed top-0 right-0 h-full w-full max-w-lg bg-[#0A0A0B] border-l border-[#2A2A35] z-50 flex flex-col shadow-2xl"
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-6 py-5 border-b border-[#2A2A35] shrink-0">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        <button
          onClick={onClose}
          className="w-8 h-8 bg-gray-800 hover:bg-gray-700 rounded-lg flex items-center justify-center text-gray-400"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        {FIELDS.map(f => (
          <div key={f.key}>
            <label className="text-xs text-gray-400 uppercase tracking-wider block mb-1.5">
              {f.label}
            </label>
            {f.type === 'textarea' ? (
              <textarea
                value={form[f.key] ?? ''}
                onChange={e => set(f.key, e.target.value)}
                rows={2}
                className={cls + ' resize-none'}
              />
            ) : f.type === 'select' ? (
              <select
                value={form[f.key] ?? ''}
                onChange={e => set(f.key, e.target.value)}
                className={cls}
              >
                {f.options?.map(o => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input
                type={f.type}
                value={form[f.key] ?? ''}
                onChange={e => set(f.key, e.target.value)}
                className={cls}
              />
            )}
          </div>
        ))}
      </div>

      <div className="p-6 border-t border-[#2A2A35] flex gap-3 shrink-0">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium text-sm py-2.5 rounded-xl flex items-center justify-center gap-2"
        >
          {saving ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Saving...
            </>
          ) : saveLabel}
        </button>
        <button
          onClick={onClose}
          className="px-5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-xl"
        >
          Cancel
        </button>
      </div>
    </div>
  )
})
ShipmentForm.displayName = 'ShipmentForm'

function statusColor(s: string) {
  const m: Record<string, string> = {
    'Received': 'bg-emerald-500/15 text-emerald-400',
    'In Transit': 'bg-blue-500/15 text-blue-400',
    'Gated': 'bg-blue-500/15 text-blue-400',
    'At Port of Dispatch': 'bg-amber-500/15 text-amber-400',
    'Air Cargo Warehouse': 'bg-cyan-500/15 text-cyan-400',
    'Arriving Today': 'bg-red-500/15 text-red-400',
    'Arriving Tomorrow': 'bg-amber-500/15 text-amber-400',
  }
  return m[s] || 'bg-gray-500/15 text-gray-400'
}

function etaLabel(eta: string | null) {
  if (!eta) return null
  const d = Math.ceil((new Date(eta).getTime() - Date.now()) / 86400000)
  if (d === 0) return { text: 'Today', cls: 'text-red-400' }
  if (d === 1) return { text: 'Tomorrow', cls: 'text-amber-400' }
  if (d > 0) return { text: d + ' days', cls: 'text-blue-400' }
  return { text: Math.abs(d) + 'd ago', cls: 'text-gray-500' }
}

function fmt(n: any) {
  const v = parseFloat(n)
  if (!n || isNaN(v)) return '—'
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  const dt = new Date(d + 'T12:00:00')
  if (isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function ImportsPage() {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<any>(null)
  const [adding, setAdding] = useState(false)

  async function load() {
    setLoading(true)
    setError('')
    const { data, error: err } = await supabase
      .from('import_shipments')
      .select('*')
      .order('eta_los_angeles', { ascending: true })
    if (err) {
      setError(err.message)
    } else {
      setRows(data || [])
    }
    setLoading(false)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])

  const filtered = rows.filter(r => {
    const q = search.toLowerCase()
    const ms = !q ||
      (r.description || '').toLowerCase().includes(q) ||
      (r.bg_po_number || '').toLowerCase().includes(q) ||
      (r.vessel_name || '').toLowerCase().includes(q) ||
      (r.booking_number || '').toLowerCase().includes(q) ||
      (r.status || '').toLowerCase().includes(q)
    const mt =
      tab === 'all'      ? true :
      tab === 'ocean'    ? r.freight_method === 'OCEAN' :
      tab === 'air'      ? r.freight_method === 'AIR' :
      tab === 'received' ? r.status === 'Received' :
      tab === 'active'   ? r.status !== 'Received' :
      tab === 'fin'      ? (r.comm_inv_amt || 0) > 0 : true
    return ms && mt
  })

  const groups: Record<string, any[]> = {}
  filtered.forEach(r => {
    const k = r.booking_number || r.id
    if (!groups[k]) groups[k] = []
    groups[k].push(r)
  })

  const activeCount   = rows.filter(r => r.status !== 'Received').length
  const receivedCount = rows.filter(r => r.status === 'Received').length
  const totalInv      = rows.reduce((s, r) => s + (r.comm_inv_amt || 0), 0)
  const totalLanded   = rows.reduce((s, r) => s + (r.total_landed_cost || 0), 0)

  async function handleSave(form: Record<string, any>) {
    const clean: Record<string, any> = {}
    FIELDS.forEach(f => {
      const v = form[f.key]
      if (f.type === 'number') {
        clean[f.key] = v !== '' && v !== null && v !== undefined ? parseFloat(v) : null
      } else if (f.type === 'date') {
        clean[f.key] = v || null
      } else {
        clean[f.key] = v || null
      }
    })

    if (form.id) {
      const { error: e } = await supabase
        .from('import_shipments')
        .update(clean)
        .eq('id', form.id)
      if (e) throw new Error(e.message)
    } else {
      const { error: e } = await supabase
        .from('import_shipments')
        .insert(clean)
      if (e) throw new Error(e.message)
    }
    setEditing(null)
    setAdding(false)
    load()
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this shipment?')) return
    await supabase.from('import_shipments').delete().eq('id', id)
    load()
  }

  const COLS = [
    'PO#','Description','Cases','Method','ETD','ETA',
    'Status','BL#','HBL#','Container',
    'EXW','Comm Inv','China 25%','Duty 10%',
    'MPF','HMF','Duties','Broker Fee','Landed',
    'Broker Inv#','Inv Date','Actions'
  ]

  return (
    <div className="min-h-screen p-4 md:p-6">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">🚢 Import Tracker</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {rows.length} shipments · {Object.keys(groups).length} bookings
          </p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2.5 rounded-xl flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Shipment
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total',              value: rows.length,                                                    cls: 'text-white' },
          { label: 'Active',             value: activeCount,                                                    cls: 'text-blue-400' },
          { label: 'Comm Inv Total',     value: totalInv    > 0 ? '$' + (totalInv    / 1000).toFixed(1) + 'K' : '—', cls: 'text-amber-400' },
          { label: 'Landed Cost Total',  value: totalLanded > 0 ? '$' + (totalLanded / 1000).toFixed(1) + 'K' : '—', cls: 'text-emerald-400' },
        ].map(s => (
          <div key={s.label} className="bg-[#111113] border border-[#2A2A35] rounded-xl p-4">
            <p className={`text-2xl font-bold ${s.cls}`}>{s.value}</p>
            <p className="text-gray-500 text-xs mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search PO#, description, vessel, status..."
          className="w-full bg-[#111113] border border-[#2A2A35] rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {[
          { id: 'all',      label: `All (${rows.length})` },
          { id: 'active',   label: `Active (${activeCount})` },
          { id: 'ocean',    label: '🚢 Ocean' },
          { id: 'air',      label: '✈ Air' },
          { id: 'received', label: `✅ Received (${receivedCount})` },
          { id: 'fin',      label: '💰 Financials' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
              tab === t.id
                ? 'bg-emerald-600 text-white'
                : 'bg-[#111113] border border-[#2A2A35] text-gray-400 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-4 flex items-center justify-between">
          <p className="text-red-400 text-sm">Error: {error}</p>
          <button onClick={load} className="text-red-400 text-xs underline">Retry</button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 bg-[#111113] rounded-xl animate-pulse border border-[#2A2A35]" />
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && !error && filtered.length === 0 && (
        <div className="text-center py-20">
          <p className="text-5xl mb-4">🚢</p>
          <p className="text-gray-400 font-medium text-lg">No shipments found</p>
          <p className="text-gray-600 text-sm mt-2">
            {search ? 'Try a different search term' : 'Click "Add Shipment" to get started'}
          </p>
        </div>
      )}

      {/* Data */}
      {!loading && !error && filtered.length > 0 && (
        <div className="space-y-4">
          {Object.entries(groups).map(([key, items]) => {
            const first = items[0]
            const eta = etaLabel(first.eta_los_angeles)
            const groupInv = items.reduce((s, i) => s + (i.comm_inv_amt || 0), 0)

            return (
              <div key={key} className="bg-[#111113] border border-[#2A2A35] rounded-2xl overflow-hidden">

                {/* Group header */}
                <div className="flex items-center gap-3 px-5 py-3.5 bg-[#18181C] border-b border-[#2A2A35]">
                  <span className="text-lg">{first.freight_method === 'AIR' ? '✈' : '🚢'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-semibold text-sm">
                        {first.vessel_name || first.flight_number || 'Unknown'}
                      </span>
                      {first.booking_number && (
                        <span className="text-gray-500 text-xs">Bkg: {first.booking_number}</span>
                      )}
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(first.status)}`}>
                        {first.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                      <span>{items.length} item{items.length !== 1 ? 's' : ''}</span>
                      {first.etd && <span>ETD {fmtDate(first.etd)}</span>}
                      {first.eta_los_angeles && <span>ETA {fmtDate(first.eta_los_angeles)}</span>}
                      {eta && <span className={eta.cls}>{eta.text}</span>}
                      {groupInv > 0 && <span className="text-amber-400">Inv: {fmt(groupInv)}</span>}
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 text-right shrink-0 hidden md:block">
                    <div>{first.shipper?.split(',')[0]}</div>
                    <div>{first.broker}</div>
                  </div>
                </div>

                {/* Items table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[#2A2A35]">
                        {COLS.map(c => (
                          <th key={c} className="text-left text-gray-500 uppercase tracking-wider py-2.5 px-3 whitespace-nowrap font-medium">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(row => (
                        <tr key={row.id} className="border-b border-[#2A2A35]/50 last:border-0 hover:bg-[#18181C] transition-colors">
                          <td className="py-3 px-3 text-gray-400">{row.bg_po_number || '—'}</td>
                          <td className="py-3 px-3 text-white">
                            <div className="max-w-[180px] truncate" title={row.description}>{row.description}</div>
                          </td>
                          <td className="py-3 px-3 text-gray-300 text-center">{row.case_qty || '—'}</td>
                          <td className="py-3 px-3">
                            <span className={`px-1.5 py-0.5 rounded text-xs ${row.freight_method === 'AIR' ? 'bg-cyan-500/15 text-cyan-400' : 'bg-blue-500/15 text-blue-400'}`}>
                              {row.freight_method}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-gray-400 whitespace-nowrap">{fmtDate(row.etd)}</td>
                          <td className="py-3 px-3 text-gray-400 whitespace-nowrap">{fmtDate(row.eta_los_angeles)}</td>
                          <td className="py-3 px-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${statusColor(row.status)}`}>
                              {row.status}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-gray-400 font-mono">{row.bl_number || '—'}</td>
                          <td className="py-3 px-3 text-gray-400 font-mono">{row.hbl_number || '—'}</td>
                          <td className="py-3 px-3 text-gray-400 font-mono">{row.container_number || '—'}</td>
                          <td className="py-3 px-3 text-right text-gray-300">{fmt(row.exw_price)}</td>
                          <td className="py-3 px-3 text-right text-amber-400 font-medium">{fmt(row.comm_inv_amt)}</td>
                          <td className="py-3 px-3 text-right text-red-400">{fmt(row.china_tariff_25pct)}</td>
                          <td className="py-3 px-3 text-right text-red-400">{fmt(row.duty_10pct)}</td>
                          <td className="py-3 px-3 text-right text-gray-400">{fmt(row.mpf)}</td>
                          <td className="py-3 px-3 text-right text-gray-400">{fmt(row.hmf)}</td>
                          <td className="py-3 px-3 text-right text-red-400 font-medium">{fmt(row.total_duties)}</td>
                          <td className="py-3 px-3 text-right text-gray-400">{fmt(row.broker_inv_amount)}</td>
                          <td className="py-3 px-3 text-right text-emerald-400 font-bold">{fmt(row.total_landed_cost)}</td>
                          <td className="py-3 px-3 text-gray-400 font-mono whitespace-nowrap">{row.broker_invoice_number || '—'}</td>
                          <td className="py-3 px-3 text-gray-400 whitespace-nowrap">{fmtDate(row.broker_inv_date)}</td>
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-1">
                              {(row.container_number || row.bl_number || row.vessel_name) && (
                                <a
                                  href={
                                    row.container_number
                                      ? `https://www.track-trace.com/container?id=${row.container_number}`
                                      : `https://www.marinetraffic.com/en/ais/index/search/all/keyword:${encodeURIComponent(row.vessel_name || '')}`
                                  }
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="p-1.5 rounded-lg hover:bg-blue-500/20 text-gray-500 hover:text-blue-400 transition-colors"
                                  title="Track"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                  </svg>
                                </a>
                              )}
                              <button
                                onClick={() => setEditing(row)}
                                className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-500 hover:text-white transition-colors"
                                title="Edit"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                              </button>
                              <button
                                onClick={() => handleDelete(row.id)}
                                className="p-1.5 rounded-lg hover:bg-red-500/20 text-gray-500 hover:text-red-400 transition-colors"
                                title="Delete"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
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

      {/* Overlay */}
      {(editing || adding) && (
        <div
          className="fixed inset-0 bg-black/60 z-40"
          onClick={() => { setEditing(null); setAdding(false) }}
        />
      )}

      {/* Edit panel */}
      {editing && (
        <ShipmentForm
          key={editing.id}
          initial={editing}
          title="Edit Shipment"
          saveLabel="Save Changes"
          onSave={handleSave}
          onClose={() => setEditing(null)}
        />
      )}

      {/* Add panel */}
      {adding && (
        <ShipmentForm
          key="new"
          initial={{ freight_method: 'OCEAN', status: 'Pending', broker: 'OEC LOGISTICS INC.' }}
          title="Add New Shipment"
          saveLabel="Add Shipment"
          onSave={handleSave}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  )
}
