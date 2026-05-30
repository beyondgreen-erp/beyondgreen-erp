'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useEffect, useCallback, memo } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import dynamic from 'next/dynamic'

const ImportMap = dynamic(
  () => import('@/components/ImportMap'),
  {
    ssr: false,
    loading: () => (
      <div className="h-[520px] bg-[#0a1628] rounded-2xl border border-[#2A2A35] flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Loading map...</p>
        </div>
      </div>
    ),
  }
)

const supabase = createSupabaseBrowserClient()

// ─── Field definitions ────────────────────────────────────────────────────────

const FIELDS = [
  { key: 'bg_po_number',        label: 'BG PO#',               type: 'text' },
  { key: 'description',         label: 'Description *',         type: 'textarea' },
  { key: 'case_qty',            label: 'Cases',                 type: 'number' },
  { key: 'freight_method',      label: 'Freight',               type: 'select', options: ['OCEAN','AIR'] },
  { key: 'etd',                 label: 'ETD',                   type: 'date' },
  { key: 'eta_los_angeles',     label: 'ETA Los Angeles',       type: 'date' },
  { key: 'vessel_name',         label: 'Vessel / Flight',       type: 'text' },
  { key: 'vessel_number',       label: 'Vessel #',              type: 'text' },
  { key: 'booking_number',      label: 'Booking #',             type: 'text' },
  { key: 'bl_number',           label: 'BL #',                  type: 'text' },
  { key: 'hbl_number',          label: 'HBL #',                 type: 'text' },
  { key: 'container_number',    label: 'Container / Flight #',  type: 'text' },
  { key: 'shipper',             label: 'Shipper',               type: 'text' },
  { key: 'broker',              label: 'Broker',                type: 'text' },
  { key: 'status',              label: 'Status',                type: 'select', options: [
    'Pending','Gated','In Transit','At Port of Dispatch',
    'Air Cargo Warehouse','Arriving Tomorrow','Arriving Today',
    'Received','Cleared','Delivered',
  ]},
  { key: 'arrival_notice',      label: 'Arrival Notice',        type: 'text' },
  { key: 'exw_price',           label: 'EXW Price',             type: 'number' },
  { key: 'comm_inv_amt',        label: 'Comm Inv Amt',          type: 'number' },
  { key: 'china_tariff_25pct',  label: 'China 25%',             type: 'number' },
  { key: 'duty_10pct',          label: 'Duty 10%',              type: 'number' },
  { key: 'mpf',                 label: 'MPF',                   type: 'number' },
  { key: 'hmf',                 label: 'HMF',                   type: 'number' },
  { key: 'total_duties',        label: 'Total Duties',          type: 'number' },
  { key: 'broker_inv_amount',   label: 'Broker Fee',            type: 'number' },
  { key: 'total_landed_cost',   label: 'Total Landed Cost',     type: 'number' },
  { key: 'broker_invoice_number', label: 'Broker Invoice #',    type: 'text' },
  { key: 'broker_inv_date',     label: 'Invoice Date',          type: 'date' },
  { key: 'payment_ref',         label: 'Payment Ref',           type: 'text' },
  { key: 'payment_date',        label: 'Payment Date',          type: 'date' },
  { key: 'notes',               label: 'Notes',                 type: 'textarea' },
]

// ─── Download config ──────────────────────────────────────────────────────────

const COLUMN_LABELS: Record<string, string> = {
  bg_po_number:         'BG PO#',
  description:          'Description',
  case_qty:             'Cases',
  freight_method:       'Freight Method',
  etd:                  'ETD',
  eta_los_angeles:      'ETA Los Angeles',
  vessel_name:          'Vessel/Flight',
  vessel_number:        'Vessel #',
  booking_number:       'Booking #',
  bl_number:            'BL #',
  hbl_number:           'HBL #',
  container_number:     'Container/Flight #',
  shipper:              'Shipper',
  broker:               'Broker',
  status:               'Status',
  arrival_notice:       'Arrival Notice',
  exw_price:            'EXW Price',
  comm_inv_amt:         'Comm Inv Amount',
  china_tariff_25pct:   'China 25%',
  duty_10pct:           'Duty 10%',
  mpf:                  'MPF',
  hmf:                  'HMF',
  total_duties:         'Total Duties',
  broker_inv_amount:    'Broker Fee',
  total_landed_cost:    'Total Landed Cost',
  broker_invoice_number:'Broker Invoice #',
  broker_inv_date:      'Invoice Date',
  payment_ref:          'Payment Ref',
  payment_date:         'Payment Date',
  notes:                'Notes',
}

const COL_GROUPS = [
  { label: 'Basic Info',      keys: ['bg_po_number','description','case_qty','freight_method'] },
  { label: 'Dates & Voyage',  keys: ['etd','eta_los_angeles','vessel_name','booking_number','bl_number','hbl_number','container_number'] },
  { label: 'Parties',         keys: ['shipper','broker'] },
  { label: 'Status',          keys: ['status','arrival_notice'] },
  { label: 'Financials',      keys: ['exw_price','comm_inv_amt','china_tariff_25pct','duty_10pct','mpf','hmf','total_duties','broker_inv_amount','total_landed_cost'] },
  { label: 'Payment',         keys: ['broker_invoice_number','broker_inv_date','payment_ref','payment_date','notes'] },
]

const ALL_COLS = COL_GROUPS.flatMap(g => g.keys)

function downloadCSV(rows: any[], selectedCols: string[]) {
  const headers = selectedCols.map(c => COLUMN_LABELS[c] || c)
  const csvRows = rows.map(row =>
    selectedCols.map(col => {
      const val = row[col]
      if (val === null || val === undefined) return ''
      const s = String(val)
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? '"' + s.replace(/"/g, '""') + '"'
        : s
    }).join(',')
  )
  const csv = [headers.join(','), ...csvRows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'beyondGREEN_imports_' + new Date().toISOString().split('T')[0] + '.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// ─── DownloadModal — module-level memo so it owns its own checkbox state ──────

const DownloadModal = memo(({
  rows,
  onClose,
}: {
  rows: any[]
  onClose: () => void
}) => {
  const [selected, setSelected] = useState<Set<string>>(new Set(ALL_COLS))
  const [filter, setFilter] = useState<'all'|'ocean'|'air'|'received'|'active'>('all')

  const toggle = useCallback((key: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }, [])

  const toggleGroup = useCallback((keys: string[]) => {
    setSelected(prev => {
      const allOn = keys.every(k => prev.has(k))
      const next = new Set(prev)
      if (allOn) keys.forEach(k => next.delete(k))
      else keys.forEach(k => next.add(k))
      return next
    })
  }, [])

  const filteredRows = rows.filter(r => {
    if (filter === 'all')      return true
    if (filter === 'ocean')    return r.freight_method === 'OCEAN'
    if (filter === 'air')      return r.freight_method === 'AIR'
    if (filter === 'received') return r.status === 'Received'
    if (filter === 'active')   return r.status !== 'Received'
    return true
  })

  function handleDownload() {
    const cols = ALL_COLS.filter(c => selected.has(c))
    if (cols.length === 0) { alert('Select at least one column'); return }
    downloadCSV(filteredRows, cols)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[#111113] border border-[#2A2A35] rounded-2xl w-full max-w-xl max-h-[90vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2A2A35] shrink-0">
          <h2 className="text-white font-semibold">Download Shipments Data</h2>
          <button onClick={onClose} className="w-8 h-8 bg-gray-800 hover:bg-gray-700 rounded-lg flex items-center justify-center text-gray-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Format */}
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Format</p>
            <div className="flex gap-2">
              <button className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-xl font-medium">CSV</button>
              <button className="px-4 py-2 bg-[#18181C] border border-[#2A2A35] text-gray-500 text-sm rounded-xl cursor-not-allowed" disabled>Excel (coming soon)</button>
            </div>
          </div>

          {/* Filter */}
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Download</p>
            <div className="flex flex-wrap gap-2">
              {[
                { id: 'all',      label: `All (${rows.length})` },
                { id: 'active',   label: 'Active only' },
                { id: 'ocean',    label: '🚢 Ocean only' },
                { id: 'air',      label: '✈ Air only' },
                { id: 'received', label: '✅ Received only' },
              ].map(f => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id as any)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
                    filter === f.id ? 'bg-emerald-600 text-white' : 'bg-[#18181C] border border-[#2A2A35] text-gray-400 hover:text-white'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-600 mt-1.5">{filteredRows.length} rows will be exported</p>
          </div>

          {/* Column selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Select Columns</p>
              <div className="flex gap-2">
                <button onClick={() => setSelected(new Set(ALL_COLS))} className="text-xs text-emerald-400 hover:text-emerald-300">Select All</button>
                <span className="text-gray-700">·</span>
                <button onClick={() => setSelected(new Set())} className="text-xs text-gray-500 hover:text-gray-300">Deselect All</button>
              </div>
            </div>
            <div className="space-y-4">
              {COL_GROUPS.map(group => {
                const allOn = group.keys.every(k => selected.has(k))
                return (
                  <div key={group.label}>
                    <button
                      onClick={() => toggleGroup(group.keys)}
                      className="flex items-center gap-2 mb-1.5 text-xs text-gray-400 hover:text-white font-medium"
                    >
                      <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${allOn ? 'bg-emerald-600 border-emerald-600' : 'border-gray-600'}`}>
                        {allOn && <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                      </div>
                      {group.label}
                    </button>
                    <div className="flex flex-wrap gap-2 pl-5">
                      {group.keys.map(k => (
                        <button
                          key={k}
                          onClick={() => toggle(k)}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors ${
                            selected.has(k)
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : 'bg-[#18181C] text-gray-500 border border-[#2A2A35] hover:text-gray-300'
                          }`}
                        >
                          {COLUMN_LABELS[k]}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#2A2A35] shrink-0 flex gap-3">
          <button
            onClick={handleDownload}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm py-2.5 rounded-xl flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download CSV ({filteredRows.length} rows, {selected.size} cols)
          </button>
          <button onClick={onClose} className="px-5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-xl">Cancel</button>
        </div>
      </div>
    </div>
  )
})
DownloadModal.displayName = 'DownloadModal'

// ─── ShipmentForm — module-level memo keeps a stable identity across renders ──
// If defined inside ImportsPage it would get a new function reference on every
// parent render, causing React to unmount+remount it → focus lost after 1 char.

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

  // useCallback keeps the reference stable so memo never re-renders from set changes
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
                {f.options?.map(o => <option key={o} value={o}>{o}</option>)}
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(s: string) {
  const m: Record<string, string> = {
    'Received':            'bg-emerald-500/15 text-emerald-400',
    'In Transit':          'bg-blue-500/15 text-blue-400',
    'Gated':               'bg-blue-500/15 text-blue-400',
    'At Port of Dispatch': 'bg-amber-500/15 text-amber-400',
    'Air Cargo Warehouse': 'bg-cyan-500/15 text-cyan-400',
    'Arriving Today':      'bg-red-500/15 text-red-400',
    'Arriving Tomorrow':   'bg-amber-500/15 text-amber-400',
  }
  return m[s] || 'bg-gray-500/15 text-gray-400'
}

function etaLabel(eta: string | null) {
  if (!eta) return null
  const d = Math.ceil((new Date(eta).getTime() - Date.now()) / 86400000)
  if (d === 0) return { text: 'Today',   cls: 'text-red-400 font-bold' }
  if (d === 1) return { text: 'Tomorrow', cls: 'text-amber-400' }
  if (d > 0)  return { text: d + ' days', cls: 'text-blue-400' }
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

function buildPayload(form: Record<string, any>) {
  const numFields = ['case_qty','exw_price','comm_inv_amt','china_tariff_25pct','duty_10pct','mpf','hmf','total_duties','broker_inv_amount','total_landed_cost']
  const dateFields = ['etd','eta_los_angeles','broker_inv_date','payment_date']
  const payload: Record<string, any> = {}
  FIELDS.forEach(f => {
    if (f.key === 'id') return
    const v = form[f.key]
    if (numFields.includes(f.key)) {
      payload[f.key] = v !== '' && v !== null && v !== undefined ? parseFloat(v) : null
    } else if (dateFields.includes(f.key)) {
      payload[f.key] = v || null
    } else {
      payload[f.key] = v || null
    }
  })
  return payload
}

// ─── VesselEditPanel — module-level memo, edits all items in a booking group ──

const VESSEL_STATUSES = [
  'Pending','Gated','In Transit','At Port of Dispatch',
  'Air Cargo Warehouse','Arriving Tomorrow','Arriving Today',
  'Received','Cleared','Delivered',
]

const VesselEditPanel = memo(({
  vessel,
  onSave,
  onClose,
}: {
  vessel: any
  onSave: (data: any) => Promise<void>
  onClose: () => void
}) => {
  const [form, setForm] = useState<any>({ ...vessel })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = useCallback((k: string, v: any) => {
    setForm((p: any) => ({ ...p, [k]: v }))
  }, [])

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      await onSave(form)
    } catch (e: any) {
      setError(e.message)
      setSaving(false)
    }
  }

  const cls = 'w-full bg-[#18181C] border border-[#2A2A35] rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500'

  const fields = [
    { key: 'vessel_name',      label: 'Vessel / Flight Name',  type: 'text' },
    { key: 'vessel_number',    label: 'Vessel / Voyage #',      type: 'text' },
    { key: 'booking_number',   label: 'Booking Number',         type: 'text' },
    { key: 'bl_number',        label: 'BL Number',              type: 'text' },
    { key: 'hbl_number',       label: 'HBL Number',             type: 'text' },
    { key: 'container_number', label: 'Container / Flight #',   type: 'text' },
    { key: 'etd',              label: 'ETD (Departure)',         type: 'date' },
    { key: 'eta_los_angeles',  label: 'ETA Los Angeles',        type: 'date' },
    { key: 'status',           label: 'Status',                 type: 'select', options: VESSEL_STATUSES },
    { key: 'shipper',          label: 'Shipper',                type: 'text' },
    { key: 'broker',           label: 'Broker / Agent',         type: 'text' },
    { key: 'notes',            label: 'Notes',                  type: 'textarea' },
  ]

  return (
    <div
      className="fixed top-0 right-0 h-full w-full max-w-lg bg-[#0A0A0B] border-l border-[#2A2A35] z-50 flex flex-col shadow-2xl"
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-6 py-5 border-b border-[#2A2A35] shrink-0">
        <div>
          <h2 className="text-lg font-semibold text-white">Edit Vessel Details</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Updates all {vessel.item_ids?.length} items in this shipment group
          </p>
        </div>
        <button onClick={onClose} className="w-8 h-8 bg-gray-800 hover:bg-gray-700 rounded-lg flex items-center justify-center text-gray-400">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-3">
          <p className="text-blue-400 text-xs">
            Changes apply to all {vessel.item_ids?.length} line items in booking {vessel.booking_number || '—'}
          </p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-red-400 text-sm">{error}</div>
        )}

        {fields.map(f => (
          <div key={f.key}>
            <label className="text-xs text-gray-400 uppercase tracking-wider block mb-1.5">{f.label}</label>
            {f.type === 'textarea' ? (
              <textarea value={form[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} rows={3} className={cls + ' resize-none'} />
            ) : f.type === 'select' ? (
              <select value={form[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} className={cls}>
                {f.options?.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input type={f.type} value={form[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} className={cls} />
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
          {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : null}
          {saving ? 'Updating all items…' : 'Update All Items in Group'}
        </button>
        <button onClick={onClose} className="px-5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-xl">Cancel</button>
      </div>
    </div>
  )
})
VesselEditPanel.displayName = 'VesselEditPanel'

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ImportsPage() {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<any>(null)
  const [adding, setAdding] = useState(false)
  const [showDownload, setShowDownload] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [trackingResult, setTrackingResult] = useState<{ tracked: number; estimated: number; total: number; timestamp: string } | null>(null)
  const [editingVessel, setEditingVessel] = useState<any>(null)
  const [vesselPanelOpen, setVesselPanelOpen] = useState(false)

  async function load() {
    setLoading(true)
    setError('')
    const { data, error: err } = await supabase
      .from('import_shipments')
      .select('*')
      .order('eta_los_angeles', { ascending: true })
    if (err) setError(err.message)
    else setRows(data || [])
    setLoading(false)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])

  // useCallback keeps onSave stable so ShipmentForm memo doesn't re-render unnecessarily
  const handleSave = useCallback(async (form: Record<string, any>) => {
    const payload = buildPayload(form)
    if (form.id) {
      const { error: e } = await supabase
        .from('import_shipments')
        .update(payload)
        .eq('id', form.id)
      if (e) throw new Error(e.message)
    } else {
      const { error: e } = await supabase
        .from('import_shipments')
        .insert(payload)
      if (e) throw new Error(e.message)
    }
    setEditing(null)
    setAdding(false)
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Delete this shipment?')) return
    await supabase.from('import_shipments').delete().eq('id', id)
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleVesselSave = useCallback(async (form: any) => {
    const ids: string[] = form.item_ids ?? []
    if (!ids.length) return
    const { error } = await supabase
      .from('import_shipments')
      .update({
        vessel_name:      form.vessel_name      || null,
        vessel_number:    form.vessel_number    || null,
        booking_number:   form.booking_number   || null,
        bl_number:        form.bl_number        || null,
        hbl_number:       form.hbl_number       || null,
        container_number: form.container_number || null,
        etd:              form.etd              || null,
        eta_los_angeles:  form.eta_los_angeles  || null,
        status:           form.status           || 'Pending',
        shipper:          form.shipper          || null,
        broker:           form.broker           || null,
        notes:            form.notes            || null,
      })
      .in('id', ids)
    if (error) throw new Error(error.message)
    setVesselPanelOpen(false)
    setEditingVessel(null)
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Derived ────────────────────────────────────────────────────────────────

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
      tab === 'fin'      ? (r.comm_inv_amt || 0) > 0 :
      tab === 'map'      ? true : true
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

  const COLS = [
    'PO#','Description','Cases','Method','ETD','ETA',
    'Status','BL#','HBL#','Container',
    'EXW','Comm Inv','China 25%','Duty 10%',
    'MPF','HMF','Duties','Broker Fee','Landed',
    'Broker Inv#','Inv Date','Actions',
  ]

  // ── Render ─────────────────────────────────────────────────────────────────

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
        <div className="flex items-center gap-2">
          <button
            onClick={() => downloadCSV(filtered, ALL_COLS)}
            className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm px-4 py-2.5 rounded-xl flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export CSV
          </button>
          <button
            onClick={() => setShowDownload(true)}
            className="bg-[#111113] border border-[#2A2A35] hover:border-gray-500 text-gray-300 text-sm font-medium px-4 py-2.5 rounded-xl flex items-center gap-2 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download
          </button>
          <button
            onClick={() => setAdding(true)}
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2.5 rounded-xl flex items-center gap-2 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Shipment
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total',             value: rows.length,                                                     cls: 'text-white' },
          { label: 'Active',            value: activeCount,                                                     cls: 'text-blue-400' },
          { label: 'Comm Inv Total',    value: totalInv    > 0 ? '$' + (totalInv    / 1000).toFixed(1) + 'K' : '—', cls: 'text-amber-400' },
          { label: 'Landed Cost Total', value: totalLanded > 0 ? '$' + (totalLanded / 1000).toFixed(1) + 'K' : '—', cls: 'text-emerald-400' },
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
          { id: 'map',      label: '🗺 Map' },
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

      {/* ── Map tab ── */}
      {!loading && tab === 'map' && (
        <div className="space-y-3">
          {/* Tracking controls */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={async () => {
                setRefreshing(true)
                try {
                  const res = await fetch('/api/imports/track')
                  const data = await res.json()
                  setTrackingResult(data)
                  load()
                } catch (e) { console.error(e) }
                setRefreshing(false)
              }}
              disabled={refreshing}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors"
            >
              {refreshing ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              {refreshing ? 'Tracking…' : 'Refresh Live Positions'}
            </button>
            {trackingResult && (
              <p className="text-xs text-gray-500">
                {trackingResult.tracked > 0
                  ? <><span className="text-green-400 font-medium">🟢 {trackingResult.tracked} live</span> · </>
                  : null}
                {trackingResult.estimated > 0
                  ? <><span className="text-amber-400">🟡 {trackingResult.estimated} estimated</span> · </>
                  : null}
                {trackingResult.total} containers checked ·{' '}
                {new Date(trackingResult.timestamp).toLocaleTimeString()}
              </p>
            )}
          </div>

          <div className="bg-[#111113] border border-[#2A2A35] rounded-2xl overflow-hidden p-3">
            <ImportMap shipments={rows} />
          </div>
        </div>
      )}

      {/* ── Empty state (non-map tabs) ── */}
      {!loading && !error && tab !== 'map' && filtered.length === 0 && (
        <div className="text-center py-20">
          <p className="text-5xl mb-4">🚢</p>
          <p className="text-gray-400 font-medium text-lg">No shipments found</p>
          <p className="text-gray-600 text-sm mt-2">
            {search ? 'Try a different search term' : 'Click "Add Shipment" to get started'}
          </p>
        </div>
      )}

      {/* ── Data table ── */}
      {!loading && !error && tab !== 'map' && filtered.length > 0 && (
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
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-xs text-gray-500 text-right hidden md:block">
                      <div>{first.shipper?.split(',')[0]}</div>
                      <div>{first.broker}</div>
                    </div>
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        setEditingVessel({
                          vessel_name:      first.vessel_name,
                          vessel_number:    first.vessel_number,
                          booking_number:   first.booking_number,
                          bl_number:        first.bl_number,
                          hbl_number:       first.hbl_number,
                          container_number: first.container_number,
                          etd:              first.etd,
                          eta_los_angeles:  first.eta_los_angeles,
                          status:           first.status,
                          shipper:          first.shipper,
                          broker:           first.broker,
                          notes:            first.notes,
                          item_ids:         items.map((i: any) => i.id),
                        })
                        setVesselPanelOpen(true)
                      }}
                      className="flex items-center gap-1.5 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-400 text-xs px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                      Edit Vessel
                    </button>
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
                          <td className="py-3 px-3 text-gray-400 font-mono whitespace-nowrap">{row.bg_po_number || '—'}</td>
                          <td className="py-3 px-3 text-white">
                            <div className="max-w-[180px] truncate" title={row.description}>{row.description}</div>
                          </td>
                          <td className="py-3 px-3 text-gray-300 text-center">{row.case_qty ?? '—'}</td>
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
                          <td className="py-3 px-3 text-gray-400 font-mono whitespace-nowrap">{row.bl_number || '—'}</td>
                          <td className="py-3 px-3 text-gray-400 font-mono whitespace-nowrap">{row.hbl_number || '—'}</td>
                          <td className="py-3 px-3 text-gray-400 font-mono whitespace-nowrap">{row.container_number || '—'}</td>
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

      {/* ── Overlays ── */}
      {(editing || adding) && (
        <div
          className="fixed inset-0 bg-black/60 z-40"
          onClick={() => { setEditing(null); setAdding(false) }}
        />
      )}

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

      {showDownload && (
        <DownloadModal
          rows={rows}
          onClose={() => setShowDownload(false)}
        />
      )}

      {vesselPanelOpen && editingVessel && (
        <>
          <div
            className="fixed inset-0 bg-black/60 z-40"
            onClick={() => { setVesselPanelOpen(false); setEditingVessel(null) }}
          />
          <VesselEditPanel
            key={editingVessel.booking_number ?? 'vessel'}
            vessel={editingVessel}
            onSave={handleVesselSave}
            onClose={() => { setVesselPanelOpen(false); setEditingVessel(null) }}
          />
        </>
      )}
    </div>
  )
}
