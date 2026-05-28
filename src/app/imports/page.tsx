'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useState } from 'react'
import nextDynamic from 'next/dynamic'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { PieChart, Pie, Cell, Tooltip as ReTooltip, ResponsiveContainer, Legend } from 'recharts'

// ─── Dynamic map import (no SSR) ─────────────────────────────────────────────
const ImportMap = nextDynamic(() => import('@/components/ImportMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[520px] bg-[#0d1117] rounded-2xl flex items-center justify-center border border-[#2A2A35]">
      <div className="text-center">
        <div className="text-3xl mb-3">🗺️</div>
        <p className="text-[#5A5A6A] text-sm">Loading live map…</p>
      </div>
    </div>
  ),
})

// ─── Types ────────────────────────────────────────────────────────────────────
interface ImportShipment {
  id: string
  bg_po_number: string | null
  description: string
  case_qty: number
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
  good_to_clear_by: string | null
  exw_price: number
  comm_inv_amt: number
  china_tariff_25pct: number
  duty_10pct: number
  mpf: number
  hmf: number
  total_duties: number
  broker_inv_amount: number
  total_landed_cost: number
  selling_price: number
  profit_margin_pct: number
  profit_amount: number
  broker_invoice_number: string | null
  broker_inv_date: string | null
  payment_ref: string | null
  payment_date: string | null
  current_lat: number | null
  current_lng: number | null
  last_tracked: string | null
  notes: string | null
}

type Tab = 'map' | 'all' | 'air' | 'ocean' | 'financials' | 'new'

// ─── Status config ─────────────────────────────────────────────────────────────
const STATUS_OPTS = [
  'Pending', 'Gated', 'In Transit', 'At Port of Dispatch',
  'Air Cargo Warehouse', 'Arriving Tomorrow', 'Arriving Today',
  'Received', 'Cleared', 'Delivered',
]

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    'Pending': 'bg-[#2A2A35] text-[#9898A8]',
    'Gated': 'bg-blue-500/20 text-blue-400',
    'In Transit': 'bg-blue-500/20 text-blue-400 animate-pulse',
    'At Port of Dispatch': 'bg-amber-500/20 text-amber-400',
    'Air Cargo Warehouse': 'bg-cyan-500/20 text-cyan-400',
    'Arriving Tomorrow': 'bg-amber-500/20 text-amber-400 animate-pulse',
    'Arriving Today': 'bg-red-500/20 text-red-400 animate-pulse',
    'Received': 'bg-[#00C896]/20 text-[#00C896]',
    'Cleared': 'bg-teal-500/20 text-teal-400',
    'Delivered': 'bg-emerald-700/30 text-emerald-400',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium whitespace-nowrap ${cfg[status] ?? 'bg-gray-500/20 text-gray-400'}`}>
      {status}
    </span>
  )
}

function EtaBadge({ eta }: { eta: string | null }) {
  if (!eta) return <span className="text-[#5A5A6A]">—</span>
  const diff = Math.round((new Date(eta).getTime() - Date.now()) / 86400000)
  if (diff < 0) return <span className="text-red-400 text-xs font-medium">{Math.abs(diff)}d late</span>
  if (diff === 0) return <span className="text-red-400 text-xs font-bold animate-pulse">TODAY</span>
  if (diff === 1) return <span className="text-amber-400 text-xs font-medium">Tomorrow</span>
  return <span className="text-blue-400 text-xs">{diff} days</span>
}

function Spinner() {
  return (
    <svg className="w-5 h-5 animate-spin text-[#3A3A45]" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function Toast({ msg, type, onClose }: { msg: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t) }, [onClose])
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl shadow-xl text-sm font-medium border ${type === 'success' ? 'bg-[#00C89615] border-[#00C89640] text-[#00C896]' : 'bg-red-500/15 border-red-500/30 text-red-400'}`}>
      {type === 'success' ? '✓' : '✗'} {msg}
      <button onClick={onClose} className="ml-2 opacity-60 hover:opacity-100">✕</button>
    </div>
  )
}

const fmt$ = (n: number) => n > 0 ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
const fmtDate = (d: string | null) => {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

// ─── Shipment Table (reused across tabs) ──────────────────────────────────────
function ShipmentsTable({
  shipments,
  onEdit,
  onDelete,
  grouped = true,
}: {
  shipments: ImportShipment[]
  onEdit: (s: ImportShipment) => void
  onDelete: (id: string) => void
  grouped?: boolean
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const filtered = useMemo(() => {
    return shipments.filter(s => {
      const matchSearch = !search || [s.bg_po_number, s.description, s.vessel_name, s.bl_number, s.booking_number, s.container_number]
        .some(v => v?.toLowerCase().includes(search.toLowerCase()))
      const matchStatus = statusFilter === 'All' || s.status === statusFilter
      return matchSearch && matchStatus
    })
  }, [shipments, search, statusFilter])

  const groups = useMemo(() => {
    if (!grouped) return { '': filtered }
    const g: Record<string, ImportShipment[]> = {}
    for (const s of filtered) {
      const key = s.booking_number ?? s.vessel_name ?? '—'
      if (!g[key]) g[key] = []
      g[key].push(s)
    }
    return g
  }, [filtered, grouped])

  function exportCSV() {
    const headers = ['BG PO#','Description','Cases','Method','ETD','ETA','Vessel/Flight','Booking#','Status','BL#','HBL#','Container','Shipper','Broker','EXW','Comm Inv','China 25%','Duty 10%','MPF','HMF','Total Duties','Broker Inv','Total Landed']
    const rows = filtered.map(s => [
      s.bg_po_number ?? '', s.description, s.case_qty, s.freight_method,
      s.etd ?? '', s.eta_los_angeles ?? '',
      s.vessel_name ?? s.flight_number ?? '', s.booking_number ?? '',
      s.status, s.bl_number ?? '', s.hbl_number ?? '', s.container_number ?? '',
      s.shipper ?? '', s.broker ?? '',
      s.exw_price, s.comm_inv_amt, s.china_tariff_25pct, s.duty_10pct,
      s.mpf, s.hmf, s.total_duties, s.broker_inv_amount, s.total_landed_cost,
    ])
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = 'import_shipments.csv'; a.click()
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search PO#, vessel, BL#, description…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-48 bg-[#18181C] border border-[#2A2A35] rounded-xl px-4 py-2 text-sm text-white placeholder-[#5A5A6A] focus:outline-none focus:border-[#00C896]/50"
        />
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="bg-[#18181C] border border-[#2A2A35] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C896]/50"
        >
          <option value="All">All Statuses</option>
          {STATUS_OPTS.map(s => <option key={s}>{s}</option>)}
        </select>
        <button onClick={exportCSV} className="px-4 py-2 bg-[#18181C] border border-[#2A2A35] rounded-xl text-sm text-[#9898A8] hover:text-white hover:border-[#3A3A4A] transition-all">
          ↓ Export CSV
        </button>
        <span className="text-xs text-[#5A5A6A] ml-auto">{filtered.length} shipments</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-[#2A2A35]">
        <table className="w-full text-sm min-w-[1200px]">
          <thead>
            <tr className="bg-[#18181C] border-b border-[#2A2A35]">
              <th className="px-3 py-3 text-left text-[10px] font-semibold text-[#5A5A6A] uppercase tracking-wider w-8">
                <input type="checkbox" className="rounded" onChange={e => {
                  if (e.target.checked) setSelected(new Set(filtered.map(s => s.id)))
                  else setSelected(new Set())
                }} />
              </th>
              {['BG PO#','Description','Cases','Method','ETD','ETA','Vessel/Flight','Status','ETA Days','BL#','Container','Shipper','Comm Inv $','Total Landed','Actions'].map(h => (
                <th key={h} className="px-3 py-3 text-left text-[10px] font-semibold text-[#5A5A6A] uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(groups).map(([groupKey, items]) => (
              <>
                {grouped && groupKey !== '' && (
                  <tr
                    key={`g-${groupKey}`}
                    className="bg-[#18181C]/60 border-b border-[#2A2A35] cursor-pointer hover:bg-[#1E1E28]"
                    onClick={() => setCollapsed(c => ({ ...c, [groupKey]: !c[groupKey] }))}
                  >
                    <td colSpan={15} className="px-4 py-2">
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-[#9898A8]">{collapsed[groupKey] ? '▶' : '▼'}</span>
                        <span className="font-semibold text-white">
                          {items[0].freight_method === 'AIR' ? '✈️' : '🚢'}{' '}
                          Booking: {groupKey}
                        </span>
                        {items[0].vessel_name && (
                          <span className="text-[#5A5A6A]">— {items[0].vessel_name}</span>
                        )}
                        <span className="text-[#5A5A6A]">— {items.length} items</span>
                        {items[0].eta_los_angeles && (
                          <span className="text-[#5A5A6A]">— ETA {fmtDate(items[0].eta_los_angeles)}</span>
                        )}
                        {items.some(s => s.comm_inv_amt > 0) && (
                          <span className="text-[#00C896] ml-auto">
                            Total: {fmt$(items.reduce((a, s) => a + (s.comm_inv_amt ?? 0), 0))}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                {!collapsed[groupKey] && items.map(s => (
                  <tr key={s.id} className="border-b border-[#1E1E28] hover:bg-[#18181C] transition-colors">
                    <td className="px-3 py-2.5">
                      <input type="checkbox" className="rounded" checked={selected.has(s.id)}
                        onChange={e => setSelected(prev => { const n = new Set(prev); if (e.target.checked) { n.add(s.id) } else { n.delete(s.id) }; return n })} />
                    </td>
                    <td className="px-3 py-2.5 text-[#9898A8] whitespace-nowrap font-mono text-xs">{s.bg_po_number ?? '—'}</td>
                    <td className="px-3 py-2.5 text-white max-w-xs">
                      <div className="truncate" title={s.description}>{s.description}</div>
                    </td>
                    <td className="px-3 py-2.5 text-[#9898A8] text-center">{s.case_qty}</td>
                    <td className="px-3 py-2.5">
                      <span className={`text-xs font-medium ${s.freight_method === 'AIR' ? 'text-cyan-400' : 'text-blue-400'}`}>
                        {s.freight_method === 'AIR' ? '✈' : '🚢'} {s.freight_method}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[#9898A8] whitespace-nowrap text-xs">{fmtDate(s.etd)}</td>
                    <td className="px-3 py-2.5 text-[#9898A8] whitespace-nowrap text-xs">{fmtDate(s.eta_los_angeles)}</td>
                    <td className="px-3 py-2.5 text-[#9898A8] whitespace-nowrap text-xs max-w-[160px]">
                      <div className="truncate" title={s.vessel_name ?? s.flight_number ?? ''}>{s.vessel_name ?? s.flight_number ?? '—'}</div>
                    </td>
                    <td className="px-3 py-2.5"><StatusBadge status={s.status} /></td>
                    <td className="px-3 py-2.5 whitespace-nowrap"><EtaBadge eta={s.eta_los_angeles} /></td>
                    <td className="px-3 py-2.5 text-[#5A5A6A] text-xs font-mono whitespace-nowrap">{s.bl_number ?? '—'}</td>
                    <td className="px-3 py-2.5 text-[#5A5A6A] text-xs font-mono whitespace-nowrap">{s.container_number ?? '—'}</td>
                    <td className="px-3 py-2.5 text-[#9898A8] text-xs max-w-[160px]">
                      <div className="truncate" title={s.shipper ?? ''}>{s.shipper ?? '—'}</div>
                    </td>
                    <td className="px-3 py-2.5 text-[#9898A8] text-xs whitespace-nowrap">{fmt$(s.comm_inv_amt)}</td>
                    <td className="px-3 py-2.5 text-[#9898A8] text-xs whitespace-nowrap">{fmt$(s.total_landed_cost)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1">
                        <button onClick={() => onEdit(s)} className="px-2 py-1 rounded-lg bg-[#2A2A35] text-[#9898A8] hover:text-white text-xs transition-colors">Edit</button>
                        <button onClick={() => onDelete(s.id)} className="px-2 py-1 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs transition-colors">Del</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={15} className="px-4 py-12 text-center text-[#5A5A6A]">No shipments found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Map Sidebar Card ──────────────────────────────────────────────────────────
function MapSidebarCard({ shipment }: { shipment: ImportShipment }) {
  const diff = shipment.eta_los_angeles
    ? Math.round((new Date(shipment.eta_los_angeles).getTime() - Date.now()) / 86400000)
    : null
  return (
    <div className="bg-[#18181C] border border-[#2A2A35] rounded-xl p-3 hover:border-[#3A3A4A] transition-all">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <div className="text-xs font-semibold text-white truncate">
            {shipment.freight_method === 'AIR' ? '✈️' : '🚢'} {shipment.vessel_name ?? 'Unknown'}
          </div>
          <div className="text-[10px] text-[#5A5A6A] mt-0.5">{shipment.booking_number ?? '—'}</div>
        </div>
        <StatusBadge status={shipment.status} />
      </div>
      <div className="text-[10px] text-[#9898A8] truncate mb-1">{shipment.description}</div>
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-[#5A5A6A]">ETA {fmtDate(shipment.eta_los_angeles)}</span>
        {diff !== null && (
          <span className={diff < 0 ? 'text-red-400' : diff === 0 ? 'text-red-400 animate-pulse font-bold' : diff <= 3 ? 'text-amber-400' : 'text-blue-400'}>
            {diff < 0 ? `${Math.abs(diff)}d late` : diff === 0 ? 'TODAY' : `${diff}d`}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Financials Edit Modal ─────────────────────────────────────────────────────
function FinancialsModal({
  shipment,
  onClose,
  onSave,
}: {
  shipment: ImportShipment
  onClose: () => void
  onSave: (updates: Partial<ImportShipment>) => Promise<void>
}) {
  const [form, setForm] = useState({
    exw_price: shipment.exw_price,
    comm_inv_amt: shipment.comm_inv_amt,
    selling_price: shipment.selling_price,
    broker_inv_amount: shipment.broker_inv_amount,
    broker_invoice_number: shipment.broker_invoice_number ?? '',
    broker_inv_date: shipment.broker_inv_date ?? '',
    payment_ref: shipment.payment_ref ?? '',
    payment_date: shipment.payment_date ?? '',
  })
  const [saving, setSaving] = useState(false)

  const duties25 = form.comm_inv_amt * 0.25
  const duties10 = form.comm_inv_amt * 0.10
  const totalDuties = duties25 + duties10 + 21.40 + 1.28
  const totalLanded = form.comm_inv_amt + totalDuties + form.broker_inv_amount

  async function handleSave() {
    setSaving(true)
    await onSave(form)
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-[#111113] border border-[#2A2A35] rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-white font-semibold">Edit Financials</h3>
          <button onClick={onClose} className="text-[#5A5A6A] hover:text-white">✕</button>
        </div>
        <p className="text-xs text-[#5A5A6A] mb-4 truncate">{shipment.description}</p>
        <div className="grid grid-cols-2 gap-3 mb-5">
          {[
            { label: 'EXW Price', key: 'exw_price' },
            { label: 'Commercial Invoice ($)', key: 'comm_inv_amt' },
            { label: 'Selling Price ($)', key: 'selling_price' },
            { label: 'Broker Invoice ($)', key: 'broker_inv_amount' },
          ].map(({ label, key }) => (
            <div key={key}>
              <label className="text-[10px] text-[#5A5A6A] uppercase tracking-wider block mb-1">{label}</label>
              <input
                type="number"
                step="0.01"
                value={(form as any)[key]}
                onChange={e => setForm(f => ({ ...f, [key]: parseFloat(e.target.value) || 0 }))}
                className="w-full bg-[#18181C] border border-[#2A2A35] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C896]/50"
              />
            </div>
          ))}
          {[
            { label: 'Broker Invoice #', key: 'broker_invoice_number' },
            { label: 'Broker Inv Date', key: 'broker_inv_date', type: 'date' },
            { label: 'Payment Ref', key: 'payment_ref' },
            { label: 'Payment Date', key: 'payment_date', type: 'date' },
          ].map(({ label, key, type }) => (
            <div key={key}>
              <label className="text-[10px] text-[#5A5A6A] uppercase tracking-wider block mb-1">{label}</label>
              <input
                type={type ?? 'text'}
                value={(form as any)[key]}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                className="w-full bg-[#18181C] border border-[#2A2A35] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C896]/50"
              />
            </div>
          ))}
        </div>
        {/* Live duty calc */}
        <div className="bg-[#18181C] border border-[#2A2A35] rounded-xl p-4 mb-4 text-sm space-y-1">
          <div className="flex justify-between text-[#9898A8]"><span>China 25%</span><span>{fmt$(duties25)}</span></div>
          <div className="flex justify-between text-[#9898A8]"><span>Duty 10%</span><span>{fmt$(duties10)}</span></div>
          <div className="flex justify-between text-[#9898A8]"><span>MPF</span><span>$21.40</span></div>
          <div className="flex justify-between text-[#9898A8]"><span>HMF</span><span>$1.28</span></div>
          <div className="flex justify-between text-white font-semibold border-t border-[#2A2A35] pt-1 mt-1"><span>Total Duties</span><span>{fmt$(totalDuties)}</span></div>
          <div className="flex justify-between text-[#00C896] font-bold"><span>Total Landed</span><span>{fmt$(totalLanded)}</span></div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-2.5 bg-[#00C896] hover:bg-[#00B384] text-black font-semibold rounded-xl text-sm transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}

// ─── Edit Shipment Modal ───────────────────────────────────────────────────────
function EditModal({
  shipment,
  onClose,
  onSave,
}: {
  shipment: ImportShipment
  onClose: () => void
  onSave: (updates: Partial<ImportShipment>) => Promise<void>
}) {
  const [form, setForm] = useState<Partial<ImportShipment>>({
    bg_po_number: shipment.bg_po_number ?? '',
    description: shipment.description,
    case_qty: shipment.case_qty,
    freight_method: shipment.freight_method,
    etd: shipment.etd ?? '',
    eta_los_angeles: shipment.eta_los_angeles ?? '',
    vessel_name: shipment.vessel_name ?? '',
    vessel_number: shipment.vessel_number ?? '',
    flight_number: shipment.flight_number ?? '',
    booking_number: shipment.booking_number ?? '',
    bl_number: shipment.bl_number ?? '',
    hbl_number: shipment.hbl_number ?? '',
    container_number: shipment.container_number ?? '',
    shipper: shipment.shipper ?? '',
    broker: shipment.broker ?? '',
    status: shipment.status,
    arrival_notice: shipment.arrival_notice ?? '',
    notes: shipment.notes ?? '',
  })
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    await onSave(form)
    setSaving(false)
    onClose()
  }

  const F = ({ label, k, type = 'text', full = false }: { label: string; k: keyof typeof form; type?: string; full?: boolean }) => (
    <div className={full ? 'col-span-2' : ''}>
      <label className="text-[10px] text-[#5A5A6A] uppercase tracking-wider block mb-1">{label}</label>
      <input
        type={type}
        value={(form[k] as any) ?? ''}
        onChange={e => setForm(f => ({ ...f, [k]: type === 'number' ? parseInt(e.target.value) || 0 : e.target.value }))}
        className="w-full bg-[#18181C] border border-[#2A2A35] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C896]/50"
      />
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-[#111113] border border-[#2A2A35] rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-white font-semibold">Edit Shipment</h3>
          <button onClick={onClose} className="text-[#5A5A6A] hover:text-white">✕</button>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <F label="BG PO#" k="bg_po_number" />
          <F label="Cases" k="case_qty" type="number" />
          <F label="Description" k="description" full />
          <div>
            <label className="text-[10px] text-[#5A5A6A] uppercase tracking-wider block mb-1">Freight Method</label>
            <select value={form.freight_method} onChange={e => setForm(f => ({ ...f, freight_method: e.target.value }))}
              className="w-full bg-[#18181C] border border-[#2A2A35] rounded-xl px-3 py-2 text-sm text-white focus:outline-none">
              <option>OCEAN</option><option>AIR</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-[#5A5A6A] uppercase tracking-wider block mb-1">Status</label>
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
              className="w-full bg-[#18181C] border border-[#2A2A35] rounded-xl px-3 py-2 text-sm text-white focus:outline-none">
              {STATUS_OPTS.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <F label="ETD" k="etd" type="date" />
          <F label="ETA Los Angeles" k="eta_los_angeles" type="date" />
          <F label="Vessel/Airline Name" k="vessel_name" />
          <F label="Vessel/Voyage Number" k="vessel_number" />
          <F label="Booking Number" k="booking_number" />
          <F label="BL Number" k="bl_number" />
          <F label="HBL Number" k="hbl_number" />
          <F label="Container Number" k="container_number" />
          <F label="Shipper" k="shipper" full />
          <F label="Broker" k="broker" />
          <F label="Arrival Notice" k="arrival_notice" />
          <F label="Notes" k="notes" full />
        </div>
        <button onClick={handleSave} disabled={saving}
          className="w-full py-2.5 bg-[#00C896] hover:bg-[#00B384] text-black font-semibold rounded-xl text-sm transition-colors disabled:opacity-50">
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}

// ─── New Shipment Form ─────────────────────────────────────────────────────────
function NewShipmentForm({
  shipments,
  onSave,
}: {
  shipments: ImportShipment[]
  onSave: (data: any) => Promise<void>
}) {
  const blankForm = {
    bg_po_number: '', description: '', case_qty: 0,
    freight_method: 'OCEAN',
    etd: '', eta_los_angeles: '',
    vessel_name: '', vessel_number: '', flight_number: '',
    booking_number: '', bl_number: '', hbl_number: '', container_number: '',
    shipper: '', broker: 'OEC LOGISTICS INC.',
    status: 'Pending', arrival_notice: '', good_to_clear_by: '',
    exw_price: 0, comm_inv_amt: 0, selling_price: 0, broker_inv_amount: 0,
    broker_invoice_number: '', broker_inv_date: '', payment_ref: '', payment_date: '',
    notes: '',
  }
  const [form, setForm] = useState(blankForm)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const existingBookings = useMemo(() => {
    const bks = Array.from(new Set(shipments.map(s => s.booking_number).filter(Boolean))) as string[]
    return bks
  }, [shipments])

  const liveCalc = useMemo(() => {
    const amt = form.comm_inv_amt
    const duties25 = amt * 0.25
    const duties10 = amt * 0.10
    const total = duties25 + duties10 + 21.40 + 1.28
    const landed = amt + total + form.broker_inv_amount
    const profit = form.selling_price > 0 ? form.selling_price - landed : 0
    const margin = form.selling_price > 0 ? (profit / form.selling_price) * 100 : 0
    return { duties25, duties10, total, landed, profit, margin }
  }, [form.comm_inv_amt, form.broker_inv_amount, form.selling_price])

  function fillFromBooking(bk: string) {
    const ref = shipments.find(s => s.booking_number === bk)
    if (!ref) return
    setForm(f => ({
      ...f,
      booking_number: bk,
      vessel_name: ref.vessel_name ?? '',
      vessel_number: ref.vessel_number ?? '',
      etd: ref.etd ?? '',
      eta_los_angeles: ref.eta_los_angeles ?? '',
      shipper: ref.shipper ?? '',
      broker: ref.broker ?? '',
      freight_method: ref.freight_method,
    }))
  }

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))

  async function handleSave() {
    if (!form.description.trim()) return
    setSaving(true)
    await onSave(form)
    setSaved(true)
    setForm(blankForm)
    setSaving(false)
    setTimeout(() => setSaved(false), 3000)
  }

  const F = ({ label, k, type = 'text', placeholder = '' }: { label: string; k: string; type?: string; placeholder?: string }) => (
    <div>
      <label className="text-[10px] text-[#5A5A6A] uppercase tracking-wider block mb-1">{label}</label>
      <input type={type} placeholder={placeholder}
        value={(form as any)[k] ?? ''}
        onChange={e => set(k, type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)}
        className="w-full bg-[#18181C] border border-[#2A2A35] rounded-xl px-3 py-2 text-sm text-white placeholder-[#3A3A4A] focus:outline-none focus:border-[#00C896]/50"
      />
    </div>
  )

  return (
    <div className="max-w-3xl space-y-6">
      {saved && (
        <div className="bg-[#00C896]/15 border border-[#00C896]/30 rounded-xl px-4 py-3 text-[#00C896] text-sm">
          ✓ Shipment saved successfully
        </div>
      )}

      {/* Duplicate from booking */}
      <div className="bg-[#18181C] border border-[#2A2A35] rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-white mb-3">Add to Existing Booking</h3>
        <div className="flex gap-3">
          <select
            defaultValue=""
            onChange={e => e.target.value && fillFromBooking(e.target.value)}
            className="flex-1 bg-[#111113] border border-[#2A2A35] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C896]/50"
          >
            <option value="">Select booking to pre-fill…</option>
            {existingBookings.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
      </div>

      {/* Section 1 */}
      <div className="bg-[#18181C] border border-[#2A2A35] rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Basic Info</h3>
        <div className="grid grid-cols-2 gap-3">
          <F label="BG PO Number" k="bg_po_number" placeholder="1831775" />
          <F label="Case Quantity" k="case_qty" type="number" />
          <div className="col-span-2">
            <label className="text-[10px] text-[#5A5A6A] uppercase tracking-wider block mb-1">Description</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={2}
              className="w-full bg-[#111113] border border-[#2A2A35] rounded-xl px-3 py-2 text-sm text-white placeholder-[#3A3A4A] focus:outline-none focus:border-[#00C896]/50 resize-none"
              placeholder="Product description…" />
          </div>
          <div className="col-span-2">
            <label className="text-[10px] text-[#5A5A6A] uppercase tracking-wider block mb-2">Freight Method</label>
            <div className="flex gap-2">
              {['OCEAN', 'AIR'].map(m => (
                <button key={m} onClick={() => set('freight_method', m)}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${form.freight_method === m ? 'bg-[#00C896] text-black' : 'bg-[#111113] border border-[#2A2A35] text-[#9898A8] hover:border-[#3A3A4A]'}`}>
                  {m === 'OCEAN' ? '🚢' : '✈️'} {m}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Section 2 */}
      <div className="bg-[#18181C] border border-[#2A2A35] rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Dates & Transport</h3>
        <div className="grid grid-cols-2 gap-3">
          <F label="ETD" k="etd" type="date" />
          <F label="ETA Los Angeles" k="eta_los_angeles" type="date" />
          {form.freight_method === 'OCEAN' ? (
            <>
              <F label="Vessel Name" k="vessel_name" placeholder="CMA CGM PETRA" />
              <F label="Voyage Number" k="vessel_number" placeholder="0P507N1MA" />
              <F label="Booking Number" k="booking_number" />
              <F label="BL Number" k="bl_number" />
              <F label="HBL Number" k="hbl_number" />
              <F label="Container Number" k="container_number" />
            </>
          ) : (
            <>
              <F label="Airline / Route" k="vessel_name" placeholder="KLM AIRLINES" />
              <F label="Flight Number" k="flight_number" placeholder="KL0872" />
              <F label="Booking / AWB Number" k="booking_number" />
              <F label="HBL Number" k="hbl_number" />
            </>
          )}
        </div>
      </div>

      {/* Section 3 */}
      <div className="bg-[#18181C] border border-[#2A2A35] rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Parties</h3>
        <div className="grid grid-cols-2 gap-3">
          <F label="Shipper" k="shipper" placeholder="PARAS WEBCOAT PVT.LTD" />
          <F label="Broker" k="broker" placeholder="OEC LOGISTICS INC." />
        </div>
      </div>

      {/* Section 4 */}
      <div className="bg-[#18181C] border border-[#2A2A35] rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Status</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-[#5A5A6A] uppercase tracking-wider block mb-1">Status</label>
            <select value={form.status} onChange={e => set('status', e.target.value)}
              className="w-full bg-[#111113] border border-[#2A2A35] rounded-xl px-3 py-2 text-sm text-white focus:outline-none">
              {STATUS_OPTS.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <F label="Arrival Notice" k="arrival_notice" placeholder="Received / Pending" />
          <F label="Good to Clear By" k="good_to_clear_by" type="date" />
        </div>
      </div>

      {/* Section 5 — Financials */}
      <div className="bg-[#18181C] border border-[#2A2A35] rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Financials (optional)</h3>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <F label="EXW Price ($)" k="exw_price" type="number" />
          <F label="Commercial Invoice ($)" k="comm_inv_amt" type="number" />
          <F label="Selling Price ($)" k="selling_price" type="number" />
          <F label="Broker Invoice ($)" k="broker_inv_amount" type="number" />
          <F label="Broker Invoice #" k="broker_invoice_number" />
          <F label="Broker Inv Date" k="broker_inv_date" type="date" />
          <F label="Payment Reference" k="payment_ref" />
          <F label="Payment Date" k="payment_date" type="date" />
        </div>
        {/* Live calc */}
        {form.comm_inv_amt > 0 && (
          <div className="bg-[#111113] border border-[#2A2A35] rounded-xl p-4 text-sm space-y-1">
            <div className="flex justify-between text-[#9898A8]"><span>China 25%</span><span>{fmt$(liveCalc.duties25)}</span></div>
            <div className="flex justify-between text-[#9898A8]"><span>Duty 10%</span><span>{fmt$(liveCalc.duties10)}</span></div>
            <div className="flex justify-between text-[#9898A8]"><span>MPF</span><span>$21.40</span></div>
            <div className="flex justify-between text-[#9898A8]"><span>HMF</span><span>$1.28</span></div>
            <div className="flex justify-between text-white font-semibold border-t border-[#2A2A35] pt-1 mt-1"><span>Total Duties</span><span>{fmt$(liveCalc.total)}</span></div>
            <div className="flex justify-between text-[#00C896] font-bold"><span>Total Landed</span><span>{fmt$(liveCalc.landed)}</span></div>
            {form.selling_price > 0 && (
              <div className="flex justify-between text-amber-400 font-semibold"><span>Profit / Margin</span><span>{fmt$(liveCalc.profit)} / {liveCalc.margin.toFixed(1)}%</span></div>
            )}
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="bg-[#18181C] border border-[#2A2A35] rounded-2xl p-5">
        <label className="text-[10px] text-[#5A5A6A] uppercase tracking-wider block mb-2">Notes</label>
        <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3}
          className="w-full bg-[#111113] border border-[#2A2A35] rounded-xl px-3 py-2 text-sm text-white placeholder-[#3A3A4A] focus:outline-none focus:border-[#00C896]/50 resize-none"
          placeholder="Any additional notes…" />
      </div>

      <button onClick={handleSave} disabled={saving || !form.description.trim()}
        className="w-full py-3 bg-[#00C896] hover:bg-[#00B384] text-black font-bold rounded-xl text-sm transition-colors disabled:opacity-50">
        {saving ? 'Saving…' : '+ Save Shipment'}
      </button>
    </div>
  )
}

// ─── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-[#18181C] border border-[#2A2A35] rounded-2xl p-4">
      <p className="text-[10px] text-[#5A5A6A] uppercase tracking-wider mb-1">{label}</p>
      <p className="text-xl font-bold text-white leading-none">{value}</p>
      {sub && <p className="text-xs text-[#5A5A6A] mt-1">{sub}</p>}
    </div>
  )
}

// ─── Duty Calculator ──────────────────────────────────────────────────────────
function DutyCalculator() {
  const [amt, setAmt] = useState(0)
  const [broker, setBroker] = useState(0)
  const duties25 = amt * 0.25
  const duties10 = amt * 0.10
  const total = duties25 + duties10 + 21.40 + 1.28
  const landed = amt + total + broker

  return (
    <div className="bg-[#18181C] border border-[#2A2A35] rounded-2xl p-5">
      <h3 className="text-sm font-semibold text-white mb-4">Duty Calculator</h3>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="text-[10px] text-[#5A5A6A] uppercase tracking-wider block mb-1">Commercial Invoice Value ($)</label>
          <input type="number" step="0.01" value={amt || ''} onChange={e => setAmt(parseFloat(e.target.value) || 0)}
            className="w-full bg-[#111113] border border-[#2A2A35] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C896]/50"
            placeholder="0.00" />
        </div>
        <div>
          <label className="text-[10px] text-[#5A5A6A] uppercase tracking-wider block mb-1">Broker Fee Est. ($)</label>
          <input type="number" step="0.01" value={broker || ''} onChange={e => setBroker(parseFloat(e.target.value) || 0)}
            className="w-full bg-[#111113] border border-[#2A2A35] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C896]/50"
            placeholder="0.00" />
        </div>
      </div>
      {amt > 0 && (
        <div className="bg-[#111113] border border-[#2A2A35] rounded-xl p-4 space-y-1.5 text-sm">
          <div className="flex justify-between text-[#9898A8]"><span>China 25% Tariff</span><span className="font-mono">{fmt$(duties25)}</span></div>
          <div className="flex justify-between text-[#9898A8]"><span>Duty 10%</span><span className="font-mono">{fmt$(duties10)}</span></div>
          <div className="flex justify-between text-[#9898A8]"><span>MPF (fixed)</span><span className="font-mono">$21.40</span></div>
          <div className="flex justify-between text-[#9898A8]"><span>HMF (fixed)</span><span className="font-mono">$1.28</span></div>
          <div className="flex justify-between text-white font-semibold border-t border-[#2A2A35] pt-2 mt-2"><span>Total Duties</span><span className="font-mono">{fmt$(total)}</span></div>
          {broker > 0 && <div className="flex justify-between text-[#9898A8]"><span>+ Broker Fee</span><span className="font-mono">{fmt$(broker)}</span></div>}
          <div className="flex justify-between text-[#00C896] font-bold text-base"><span>Total Landed Cost</span><span className="font-mono">{fmt$(landed)}</span></div>
        </div>
      )}
    </div>
  )
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function ImportsPage() {
  const [shipments, setShipments] = useState<ImportShipment[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('map')
  const [editShipment, setEditShipment] = useState<ImportShipment | null>(null)
  const [finShipment, setFinShipment] = useState<ImportShipment | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const supabase = createSupabaseBrowserClient()

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('import_shipments').select('*').order('created_at', { ascending: false })
    if (!error && data) setShipments(data as ImportShipment[])
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  async function handleSave(id: string, updates: Partial<ImportShipment>) {
    const { error } = await supabase.from('import_shipments').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) { setToast({ msg: error.message, type: 'error' }); return }
    setToast({ msg: 'Saved', type: 'success' })
    load()
  }

  async function handleCreate(data: any) {
    const { error } = await supabase.from('import_shipments').insert([{ ...data, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }])
    if (error) { setToast({ msg: error.message, type: 'error' }); return }
    setToast({ msg: 'Shipment added', type: 'success' })
    load()
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this shipment?')) return
    const { error } = await supabase.from('import_shipments').delete().eq('id', id)
    if (error) { setToast({ msg: error.message, type: 'error' }); return }
    setToast({ msg: 'Deleted', type: 'success' })
    load()
  }

  // Derived data
  const airShipments = useMemo(() => shipments.filter(s => s.freight_method === 'AIR'), [shipments])
  const oceanShipments = useMemo(() => shipments.filter(s => s.freight_method === 'OCEAN'), [shipments])
  const activeShipments = useMemo(() => shipments.filter(s => !['Received', 'Cleared', 'Delivered'].includes(s.status)), [shipments])
  const financialShipments = useMemo(() => shipments.filter(s => s.comm_inv_amt > 0), [shipments])

  const totals = useMemo(() => ({
    commInv: shipments.reduce((a, s) => a + s.comm_inv_amt, 0),
    duties: shipments.reduce((a, s) => a + s.total_duties, 0),
    broker: shipments.reduce((a, s) => a + s.broker_inv_amount, 0),
    landed: shipments.reduce((a, s) => a + s.total_landed_cost, 0),
    selling: shipments.reduce((a, s) => a + s.selling_price, 0),
    profit: shipments.reduce((a, s) => a + s.profit_amount, 0),
  }), [shipments])

  const avgMargin = totals.selling > 0 ? (totals.profit / totals.selling) * 100 : 0

  // Unique vessels for ocean tab
  const vessels = useMemo(() => {
    const v: Record<string, { rep: ImportShipment; items: ImportShipment[] }> = {}
    for (const s of oceanShipments) {
      const key = s.vessel_name ?? 'Unknown'
      if (!v[key]) v[key] = { rep: s, items: [] }
      v[key].items.push(s)
    }
    return v
  }, [oceanShipments])

  // Pie chart data for financials
  const pieData = useMemo(() => {
    const t = totals
    if (t.commInv === 0) return []
    return [
      { name: 'Product Cost', value: t.commInv, color: '#3B82F6' },
      { name: 'China 25%', value: financialShipments.reduce((a, s) => a + s.china_tariff_25pct, 0), color: '#EF4444' },
      { name: 'Duty 10%', value: financialShipments.reduce((a, s) => a + s.duty_10pct, 0), color: '#F59E0B' },
      { name: 'MPF/HMF', value: financialShipments.reduce((a, s) => a + s.mpf + s.hmf, 0), color: '#8B5CF6' },
      { name: 'Broker Fees', value: t.broker, color: '#06B6D4' },
    ].filter(d => d.value > 0)
  }, [totals, financialShipments])

  const TABS: { id: Tab; label: string }[] = [
    { id: 'map', label: '🗺 Live Map' },
    { id: 'all', label: '📋 All Shipments' },
    { id: 'air', label: '✈ Air Cargo' },
    { id: 'ocean', label: '🚢 Ocean Freight' },
    { id: 'financials', label: '💰 Financials' },
    { id: 'new', label: '➕ New Shipment' },
  ]

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-3">
          <Spinner />
          <p className="text-[#5A5A6A] text-sm">Loading import tracker…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-screen bg-[#0C0C0E] px-6 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-1">Import Tracker</h1>
        <p className="text-[#5A5A6A] text-sm">Track all import shipments, costs, duties, and live vessel positions</p>
        <div className="flex items-center gap-4 mt-3">
          <span className="text-xs text-[#5A5A6A]">{shipments.length} total shipments</span>
          <span className="text-xs text-[#5A5A6A]">•</span>
          <span className="text-xs text-amber-400">{activeShipments.length} active</span>
          <span className="text-xs text-[#5A5A6A]">•</span>
          <span className="text-xs text-[#00C896]">{shipments.filter(s => s.status === 'Received').length} received</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-[#18181C] border border-[#2A2A35] rounded-2xl p-1 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
              tab === t.id ? 'bg-[#00C896] text-black' : 'text-[#9898A8] hover:text-white hover:bg-[#2A2A35]'
            }`}
          >
            {t.label}
            {t.id === 'air' && airShipments.length > 0 && (
              <span className="ml-1.5 bg-cyan-500/20 text-cyan-400 text-[10px] px-1.5 py-0.5 rounded-full">{airShipments.length}</span>
            )}
            {t.id === 'ocean' && oceanShipments.length > 0 && (
              <span className="ml-1.5 bg-blue-500/20 text-blue-400 text-[10px] px-1.5 py-0.5 rounded-full">{oceanShipments.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── TAB: MAP ─────────────────────────────────────────────── */}
      {tab === 'map' && (
        <div className="flex gap-4">
          <div className="flex-1 min-w-0" style={{ height: 560 }}>
            <ImportMap shipments={shipments} />
          </div>
          {/* Sidebar cards */}
          <div className="w-72 shrink-0 overflow-y-auto" style={{ maxHeight: 560 }}>
            <p className="text-[10px] font-semibold text-[#5A5A6A] uppercase tracking-wider mb-3">Active Shipments</p>
            <div className="space-y-2">
              {activeShipments.length === 0 ? (
                <p className="text-[#5A5A6A] text-xs">No active shipments</p>
              ) : (
                Array.from(new Map(activeShipments.map(s => [s.booking_number ?? s.id, s])).values()).map(s => (
                  <MapSidebarCard key={s.id} shipment={s} />
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: ALL SHIPMENTS ────────────────────────────────────── */}
      {tab === 'all' && (
        <ShipmentsTable
          shipments={shipments}
          onEdit={setEditShipment}
          onDelete={handleDelete}
          grouped
        />
      )}

      {/* ── TAB: AIR CARGO ───────────────────────────────────────── */}
      {tab === 'air' && (
        <div className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Air Shipments" value={airShipments.length.toString()} />
            <StatCard label="Active Air" value={airShipments.filter(s => !['Received','Cleared','Delivered'].includes(s.status)).length.toString()} />
            <StatCard label="Arriving This Week" value={airShipments.filter(s => {
              if (!s.eta_los_angeles) return false
              const d = Math.round((new Date(s.eta_los_angeles).getTime() - Date.now()) / 86400000)
              return d >= 0 && d <= 7
            }).length.toString()} />
            <StatCard label="Total Air Comm Inv" value={fmt$(airShipments.reduce((a, s) => a + s.comm_inv_amt, 0))} />
          </div>
          <ShipmentsTable
            shipments={airShipments}
            onEdit={setEditShipment}
            onDelete={handleDelete}
            grouped
          />
        </div>
      )}

      {/* ── TAB: OCEAN FREIGHT ───────────────────────────────────── */}
      {tab === 'ocean' && (
        <div className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Active Vessels" value={Object.keys(vessels).length.toString()} />
            <StatCard label="In Transit" value={oceanShipments.filter(s => s.status === 'In Transit').length.toString()} />
            <StatCard label="Arriving This Month" value={oceanShipments.filter(s => {
              if (!s.eta_los_angeles) return false
              const d = Math.round((new Date(s.eta_los_angeles).getTime() - Date.now()) / 86400000)
              return d >= 0 && d <= 31
            }).length.toString()} />
            <StatCard label="Total Ocean Comm Inv" value={fmt$(oceanShipments.reduce((a, s) => a + s.comm_inv_amt, 0))} />
          </div>

          {/* Vessel cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {Object.entries(vessels).map(([name, { rep, items }]) => {
              const diff = rep.eta_los_angeles
                ? Math.round((new Date(rep.eta_los_angeles).getTime() - Date.now()) / 86400000)
                : null
              return (
                <div key={name} className="bg-[#18181C] border border-[#2A2A35] rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div>
                      <div className="text-sm font-semibold text-white">🚢 {name}</div>
                      {rep.vessel_number && <div className="text-xs text-[#5A5A6A] font-mono">{rep.vessel_number}</div>}
                    </div>
                    <StatusBadge status={rep.status} />
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                    <div>
                      <div className="text-[#5A5A6A]">ETD</div>
                      <div className="text-[#9898A8]">{fmtDate(rep.etd)}</div>
                    </div>
                    <div>
                      <div className="text-[#5A5A6A]">ETA</div>
                      <div className="text-[#9898A8]">{fmtDate(rep.eta_los_angeles)}</div>
                    </div>
                    <div>
                      <div className="text-[#5A5A6A]">Days</div>
                      <div>{diff !== null ? (
                        <span className={diff < 0 ? 'text-red-400' : diff === 0 ? 'text-red-400 font-bold' : diff <= 5 ? 'text-amber-400' : 'text-blue-400'}>
                          {diff < 0 ? `${Math.abs(diff)}d late` : diff === 0 ? 'TODAY' : `${diff}d`}
                        </span>
                      ) : '—'}</div>
                    </div>
                  </div>
                  <div className="text-xs text-[#5A5A6A]">
                    {items.length} line items · {items.reduce((a, s) => a + s.case_qty, 0)} cases
                  </div>
                  {rep.booking_number && (
                    <div className="text-[10px] text-[#3A3A4A] mt-1 font-mono">{rep.booking_number}</div>
                  )}
                </div>
              )
            })}
          </div>

          <ShipmentsTable
            shipments={oceanShipments}
            onEdit={setEditShipment}
            onDelete={handleDelete}
            grouped
          />
        </div>
      )}

      {/* ── TAB: FINANCIALS ──────────────────────────────────────── */}
      {tab === 'financials' && (
        <div className="space-y-6">
          {/* Summary row */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
            <StatCard label="Total Comm Inv" value={fmt$(totals.commInv)} />
            <StatCard label="Total Duties" value={fmt$(totals.duties)} />
            <StatCard label="Total Broker Fees" value={fmt$(totals.broker)} />
            <StatCard label="Total Landed Cost" value={fmt$(totals.landed)} />
            <StatCard label="Total Selling Price" value={fmt$(totals.selling)} />
            <StatCard label="Total Profit" value={fmt$(totals.profit)} />
            <StatCard label="Avg Margin" value={`${avgMargin.toFixed(1)}%`} sub={avgMargin > 40 ? '↑ Above target' : avgMargin > 20 ? 'On target' : '↓ Below target'} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Financials table */}
            <div className="overflow-x-auto rounded-2xl border border-[#2A2A35]">
              <table className="w-full text-xs min-w-[900px]">
                <thead>
                  <tr className="bg-[#18181C] border-b border-[#2A2A35]">
                    {['BG PO#','Description','EXW','Comm Inv','China 25%','Duty 10%','MPF','HMF','Total Duties','Broker Inv','Total Landed','Selling $','Profit','Margin','Edit'].map(h => (
                      <th key={h} className="px-3 py-3 text-left text-[10px] font-semibold text-[#5A5A6A] uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {financialShipments.map(s => {
                    const margin = s.profit_margin_pct
                    const marginColor = margin > 40 ? 'text-[#00C896]' : margin > 20 ? 'text-amber-400' : margin > 0 ? 'text-red-400' : 'text-[#5A5A6A]'
                    return (
                      <tr key={s.id} className="border-b border-[#1E1E28] hover:bg-[#18181C]">
                        <td className="px-3 py-2.5 text-[#5A5A6A] font-mono">{s.bg_po_number ?? '—'}</td>
                        <td className="px-3 py-2.5 text-white max-w-[180px]"><div className="truncate text-xs" title={s.description}>{s.description}</div></td>
                        <td className="px-3 py-2.5 text-[#9898A8] whitespace-nowrap">{fmt$(s.exw_price)}</td>
                        <td className="px-3 py-2.5 text-[#9898A8] whitespace-nowrap">{fmt$(s.comm_inv_amt)}</td>
                        <td className="px-3 py-2.5 text-red-400 whitespace-nowrap">{fmt$(s.china_tariff_25pct)}</td>
                        <td className="px-3 py-2.5 text-amber-400 whitespace-nowrap">{fmt$(s.duty_10pct)}</td>
                        <td className="px-3 py-2.5 text-[#9898A8]">{fmt$(s.mpf)}</td>
                        <td className="px-3 py-2.5 text-[#9898A8]">{fmt$(s.hmf)}</td>
                        <td className="px-3 py-2.5 text-red-400 whitespace-nowrap font-semibold">{fmt$(s.total_duties)}</td>
                        <td className="px-3 py-2.5 text-cyan-400 whitespace-nowrap">{fmt$(s.broker_inv_amount)}</td>
                        <td className="px-3 py-2.5 text-white whitespace-nowrap font-semibold">{fmt$(s.total_landed_cost)}</td>
                        <td className="px-3 py-2.5 text-[#00C896] whitespace-nowrap">{fmt$(s.selling_price)}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap font-semibold" style={{ color: margin > 0 ? '#00C896' : '#EF4444' }}>{fmt$(s.profit_amount)}</td>
                        <td className={`px-3 py-2.5 whitespace-nowrap font-bold ${marginColor}`}>
                          {margin > 0 ? `${margin.toFixed(1)}%` : <span className="text-[#3A3A4A]">—</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          <button onClick={() => setFinShipment(s)} className="px-2 py-1 rounded-lg bg-[#00C896]/10 text-[#00C896] hover:bg-[#00C896]/20 text-xs">Edit $</button>
                        </td>
                      </tr>
                    )
                  })}
                  {financialShipments.length === 0 && (
                    <tr><td colSpan={15} className="px-4 py-8 text-center text-[#5A5A6A]">No financial data yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pie chart + duty calc */}
            <div className="space-y-4">
              {pieData.length > 0 && (
                <div className="bg-[#18181C] border border-[#2A2A35] rounded-2xl p-5">
                  <h3 className="text-sm font-semibold text-white mb-4">Cost Breakdown</h3>
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" outerRadius={90} dataKey="value" label={({ name, percent }: any) => `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false}>
                        {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Pie>
                      <ReTooltip formatter={(v: any) => fmt$(v)} contentStyle={{ background: '#18181C', border: '1px solid #2A2A35', borderRadius: 8, fontSize: 12 }} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: '#9898A8' }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
              <DutyCalculator />
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: NEW SHIPMENT ─────────────────────────────────────── */}
      {tab === 'new' && (
        <NewShipmentForm shipments={shipments} onSave={handleCreate} />
      )}

      {/* Edit Modal */}
      {editShipment && (
        <EditModal
          shipment={editShipment}
          onClose={() => setEditShipment(null)}
          onSave={async (updates) => { await handleSave(editShipment.id, updates) }}
        />
      )}

      {/* Financials Modal */}
      {finShipment && (
        <FinancialsModal
          shipment={finShipment}
          onClose={() => setFinShipment(null)}
          onSave={async (updates) => { await handleSave(finShipment.id, updates) }}
        />
      )}

      {/* Toast */}
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
