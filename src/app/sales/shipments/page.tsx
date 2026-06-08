'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useMemo, useState } from 'react'
import nextDynamic from 'next/dynamic'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import FileUpload from '@/components/FileUpload'
import Comments from '@/components/Comments'
import { useMultiSelect } from '@/hooks/useMultiSelect'
import BulkActionBar from '@/components/BulkActionBar'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'

/* eslint-disable @typescript-eslint/no-explicit-any */

const ShipmentMap = nextDynamic(() => import('@/components/ShipmentMap'), { ssr: false })

interface Shipment {
  id: string
  customer_name: string | null
  po_number: string | null
  order_date: string | null
  ship_date: string | null
  carrier: string | null
  tracking_number: string | null
  ship_cost: number | null
  delivery_status: string
  month_group: string | null
  facility: string | null
  external_id: string | null
  city: string | null
  state: string | null
  notes: string | null
  is_active: boolean
  created_at: string
  invoice_id: string | null
  invoice_number: string | null
}

const STATUS_COLORS: Record<string, string> = {
  Delivered: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  'In Transit': 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  Exception: 'bg-red-500/15 text-red-400 border-red-500/20',
  Pending: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
}
const CARRIER_PIE_COLORS = ['#8B4513','#4B0082','#0071CE','#CC0000','#1D9E75','#6B7280']
const fmtD = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const fmtC = (n: number | null) => `$${(n || 0).toFixed(2)}`

const MONTH_ORDER = ['January 2026','February 2026','March 2026','April 2026','May 2026']

function trackingUrl(carrier: string | null, tracking: string | null): string | null {
  if (!tracking || !carrier) return null
  const c = carrier.toLowerCase()
  if (c.includes('ups')) return `https://www.ups.com/track?tracknum=${tracking}`
  if (c.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${tracking}`
  if (c.includes('usps')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${tracking}`
  return null
}

export default function ShipmentsPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<Shipment[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'table' | 'map' | 'heatmap' | 'analytics'>('table')
  const [search, setSearch] = useState('')
  const [filterMonth, setFilterMonth] = useState('all')
  const [filterCarrier, setFilterCarrier] = useState('all')
  const [filterState, setFilterState] = useState('all')
  const [sortCol, setSortCol] = useState<'ship_date' | 'ship_cost' | 'customer_name'>('ship_date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Shipment | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Partial<Shipment>>({})
  const [userEmail, setUserEmail] = useState('')
  const [drillMonth, setDrillMonth] = useState<string | null>(null)
  const [drillWeek, setDrillWeek] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const ms = useMultiSelect<Shipment>()

  useEffect(() => {
    sb.from('shipments').select('*').order('ship_date', { ascending: false })
      .then(({ data }) => { if (data) setRows(data as Shipment[]); setLoading(false) })
    sb.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email) })
  }, []) // eslint-disable-line

  // ── Derived filter options ───────────────────────────────
  const months = useMemo(() => {
    const set = new Set(rows.map(r => r.month_group).filter(Boolean) as string[])
    return MONTH_ORDER.filter(m => set.has(m))
  }, [rows])

  const carriers = useMemo(() => {
    const set = new Set(rows.map(r => r.carrier).filter(Boolean) as string[])
    return Array.from(set).sort()
  }, [rows])

  const states = useMemo(() => {
    const set = new Set(rows.map(r => r.state).filter(Boolean) as string[])
    return Array.from(set).sort()
  }, [rows])

  // ── Filtered + sorted rows ────────────────────────────────
  const filtered = useMemo(() => {
    let r = rows
    if (search) {
      const q = search.toLowerCase()
      r = r.filter(s => (s.customer_name || '').toLowerCase().includes(q) || (s.tracking_number || '').toLowerCase().includes(q) || (s.po_number || '').toLowerCase().includes(q))
    }
    if (filterMonth !== 'all') r = r.filter(s => s.month_group === filterMonth)
    if (filterCarrier !== 'all') r = r.filter(s => s.carrier === filterCarrier)
    if (filterState !== 'all') r = r.filter(s => s.state === filterState)
    return [...r].sort((a, b) => {
      let av: any = a[sortCol] ?? ''
      let bv: any = b[sortCol] ?? ''
      if (sortCol === 'ship_cost') { av = a.ship_cost || 0; bv = b.ship_cost || 0 }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, search, filterMonth, filterCarrier, filterState, sortCol, sortDir])

  // ── Panel open/save ───────────────────────────────────────
  function openEdit(s: Shipment) {
    setEditing(s); setForm({ ...s }); setOpen(true)
  }
  async function save() {
    if (!editing) return
    setSaving(true)
    await sb.from('shipments').update({
      customer_name: form.customer_name, po_number: form.po_number,
      order_date: form.order_date || null, ship_date: form.ship_date || null,
      carrier: form.carrier, tracking_number: form.tracking_number,
      ship_cost: form.ship_cost, delivery_status: form.delivery_status,
      city: form.city, state: form.state, notes: form.notes,
    }).eq('id', editing.id)
    setSaving(false)
    setRows(prev => prev.map(r => r.id === editing.id ? { ...r, ...form } as Shipment : r))
    setOpen(false)
  }

  async function bulkDelete() {
    if (!confirm(`Delete ${ms.count} shipments? This cannot be undone.`)) return
    setDeleting(true)
    await sb.from('shipments').delete().in('id', Array.from(ms.selected))
    setRows(prev => prev.filter(r => !ms.selected.has(r.id)))
    ms.clear()
    setDeleting(false)
  }

  function toggleSort(col: typeof sortCol) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  // ── Analytics data ────────────────────────────────────────
  const monthlyData = useMemo(() => {
    const agg: Record<string, { month: string; cost: number; count: number }> = {}
    rows.forEach(r => {
      const m = r.month_group || 'Unknown'
      if (!agg[m]) agg[m] = { month: m.replace(' 2026', ''), cost: 0, count: 0 }
      agg[m].cost += r.ship_cost || 0
      agg[m].count++
    })
    return MONTH_ORDER.map(m => agg[m] || { month: m.replace(' 2026', ''), cost: 0, count: 0 }).filter(d => d.count > 0)
  }, [rows])

  const weeklyData = useMemo(() => {
    if (!drillMonth) return []
    const monthRows = rows.filter(r => r.month_group === drillMonth + ' 2026' || r.month_group === drillMonth)
    const agg: Record<string, { week: string; cost: number; count: number }> = {}
    monthRows.forEach(r => {
      if (!r.ship_date) return
      const d = new Date(r.ship_date + 'T00:00:00')
      const week = `Week ${Math.ceil(d.getDate() / 7)}`
      if (!agg[week]) agg[week] = { week, cost: 0, count: 0 }
      agg[week].cost += r.ship_cost || 0; agg[week].count++
    })
    return Object.values(agg).sort((a, b) => a.week.localeCompare(b.week))
  }, [rows, drillMonth])

  const dailyData = useMemo(() => {
    if (!drillMonth || !drillWeek) return []
    const weekNum = parseInt(drillWeek.replace('Week ', ''))
    const monthRows = rows.filter(r => r.month_group === drillMonth + ' 2026' || r.month_group === drillMonth)
    const agg: Record<string, { day: string; cost: number; count: number }> = {}
    monthRows.forEach(r => {
      if (!r.ship_date) return
      const d = new Date(r.ship_date + 'T00:00:00')
      if (Math.ceil(d.getDate() / 7) !== weekNum) return
      const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      if (!agg[day]) agg[day] = { day, cost: 0, count: 0 }
      agg[day].cost += r.ship_cost || 0; agg[day].count++
    })
    return Object.values(agg)
  }, [rows, drillMonth, drillWeek])

  const carrierData = useMemo(() => {
    const agg: Record<string, number> = {}
    rows.forEach(r => { const c = r.carrier || 'Unknown'; agg[c] = (agg[c] || 0) + 1 })
    return Object.entries(agg).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [rows])

  const stateData = useMemo(() => {
    const agg: Record<string, number> = {}
    rows.forEach(r => { if (r.state) agg[r.state] = (agg[r.state] || 0) + 1 })
    return Object.entries(agg).map(([state, count]) => ({ state, count })).sort((a, b) => b.count - a.count).slice(0, 10)
  }, [rows])

  const totalCost = rows.reduce((s, r) => s + (r.ship_cost || 0), 0)
  const avgCost = rows.length ? totalCost / rows.length : 0
  const topCustomer = useMemo(() => {
    const agg: Record<string, number> = {}
    rows.forEach(r => { const c = r.customer_name || 'Unknown'; agg[c] = (agg[c] || 0) + 1 })
    return Object.entries(agg).sort((a, b) => b[1] - a[1])[0]?.[0] || '—'
  }, [rows])
  const topCarrier = useMemo(() => {
    const agg: Record<string, number> = {}
    rows.forEach(r => { const c = r.carrier || 'Unknown'; agg[c] = (agg[c] || 0) + 1 })
    return Object.entries(agg).sort((a, b) => b[1] - a[1])[0]?.[0] || '—'
  }, [rows])
  const topMonth = useMemo(() => {
    const agg: Record<string, number> = {}
    rows.forEach(r => { const m = r.month_group || 'Unknown'; agg[m] = (agg[m] || 0) + 1 })
    return Object.entries(agg).sort((a, b) => b[1] - a[1])[0]?.[0] || '—'
  }, [rows])

  const inp = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 transition'
  const tabCls = (t: string) => `px-4 py-2 text-xs font-medium rounded-lg transition-colors ${tab === t ? 'bg-[#1A1D2E] text-white' : 'text-gray-500 hover:text-gray-600'}`

  // ── Geo-filtered shipments for map (only those with coords) ─
  const mapShipments = useMemo(() => {
    if (filterMonth !== 'all' || filterCarrier !== 'all' || filterState !== 'all' || search)
      return filtered
    return rows
  }, [rows, filtered, filterMonth, filterCarrier, filterState, search])

  return (
    <div className="min-h-screen" style={{background:"#F5F6FA"}}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#1A1D2E]">Shipments</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${rows.length} total shipments`}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white border border-[#E4E6EE] rounded-xl p-1 mb-5 w-fit">
        <button onClick={() => setTab('table')} className={tabCls('table')}>Table</button>
        <button onClick={() => setTab('map')} className={tabCls('map')}>Live Map</button>
        <button onClick={() => setTab('heatmap')} className={tabCls('heatmap')}>Heat Map</button>
        <button onClick={() => setTab('analytics')} className={tabCls('analytics')}>Analytics</button>
      </div>

      {/* ── TABLE TAB ── */}
      {tab === 'table' && (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customer, tracking, PO…"
              className="bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 w-64" />
            <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
              className="bg-white border border-[#E4E6EE] text-gray-500 rounded-lg px-3 py-2 text-xs cursor-pointer">
              <option value="all">All Months</option>
              {months.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={filterCarrier} onChange={e => setFilterCarrier(e.target.value)}
              className="bg-white border border-[#E4E6EE] text-gray-500 rounded-lg px-3 py-2 text-xs cursor-pointer">
              <option value="all">All Carriers</option>
              {carriers.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={filterState} onChange={e => setFilterState(e.target.value)}
              className="bg-white border border-[#E4E6EE] text-gray-500 rounded-lg px-3 py-2 text-xs cursor-pointer">
              <option value="all">All States</option>
              {states.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <span className="text-gray-600 text-xs self-center ml-1">{filtered.length} results</span>
          </div>

          <div className="bg-white border border-[#E4E6EE] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#E4E6EE]">
                    <th className="w-10 px-4 py-3"><input type="checkbox" checked={ms.isAllSelected(filtered)} onChange={()=>ms.toggleAll(filtered)} className="accent-emerald-500 w-4 h-4 cursor-pointer"/></th>
                    {[['customer_name','Customer'],['ship_date','Ship Date'],['ship_cost','Cost']].map(([col,label]) => (
                      <th key={col} onClick={() => toggleSort(col as any)}
                        className="px-4 py-3 text-left text-gray-500 font-medium cursor-pointer hover:text-gray-600 select-none whitespace-nowrap">
                        {label} {sortCol === col ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-left text-gray-500 font-medium whitespace-nowrap">PO #</th>
                    <th className="px-4 py-3 text-left text-gray-500 font-medium whitespace-nowrap">Carrier</th>
                    <th className="px-4 py-3 text-left text-gray-500 font-medium whitespace-nowrap">Tracking</th>
                    <th className="px-4 py-3 text-left text-gray-500 font-medium whitespace-nowrap">City / State</th>
                    <th className="px-4 py-3 text-left text-gray-500 font-medium whitespace-nowrap">Invoice</th>
                    <th className="px-4 py-3 text-left text-gray-500 font-medium whitespace-nowrap">Month</th>
                    <th className="px-4 py-3 text-left text-gray-500 font-medium whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={11} className="px-4 py-10 text-center text-gray-600">Loading…</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={11} className="px-4 py-10 text-center text-gray-600 italic">No shipments found.</td></tr>
                  ) : filtered.map(s => {
                    const tUrl = trackingUrl(s.carrier, s.tracking_number)
                    return (
                      <tr key={s.id}
                        className={`border-t border-[#F3F4F6] hover:bg-[#F9FAFB] transition-colors ${ms.isSelected(s.id) ? 'bg-blue-500/5' : ''}`}>
                        <td className="px-4 py-3" onClick={e=>e.stopPropagation()}><input type="checkbox" checked={ms.isSelected(s.id)} onChange={()=>ms.toggle(s.id)} className="accent-emerald-500 w-4 h-4 cursor-pointer"/></td>
                        <td className="px-4 py-3 text-[#1A1D2E] font-medium max-w-[160px] truncate cursor-pointer" onClick={()=>openEdit(s)}>{s.customer_name || '—'}</td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap cursor-pointer" onClick={()=>openEdit(s)}>{fmtD(s.ship_date)}</td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap cursor-pointer" onClick={()=>openEdit(s)}>{fmtC(s.ship_cost)}</td>
                        <td className="px-4 py-3 text-gray-400 cursor-pointer" onClick={()=>openEdit(s)}>{s.po_number || '—'}</td>
                        <td className="px-4 py-3 text-gray-400 cursor-pointer" onClick={()=>openEdit(s)}>{s.carrier || '—'}</td>
                        <td className="px-4 py-3" onClick={e => { if (tUrl) e.stopPropagation() }}>
                          {s.tracking_number ? (
                            tUrl ? (
                              <a href={tUrl} target="_blank" rel="noopener noreferrer"
                                className="text-blue-400 hover:text-blue-300 font-mono text-xs max-w-[140px] truncate block">
                                {s.tracking_number}
                              </a>
                            ) : (
                              <span className="text-gray-400 font-mono text-xs max-w-[140px] truncate block">{s.tracking_number}</span>
                            )
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{[s.city, s.state].filter(Boolean).join(', ') || '—'}</td>
                        <td className="px-4 py-3 whitespace-nowrap" onClick={e => { if (s.invoice_number) e.stopPropagation() }}>
                          {s.invoice_number ? (
                            <span className="text-xs px-1.5 py-0.5 rounded font-mono font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">{s.invoice_number}</span>
                          ) : (
                            <span className="text-gray-600 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{s.month_group || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[s.delivery_status] || STATUS_COLORS['In Transit']}`}>
                            {s.delivery_status}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── MAP TAB ── */}
      {tab === 'map' && (
        <div className="bg-white border border-[#E4E6EE] rounded-xl p-4" style={{ height: 580 }}>
          <ShipmentMap shipments={mapShipments} mode="map" />
        </div>
      )}

      {/* ── HEAT MAP TAB ── */}
      {tab === 'heatmap' && (
        <div className="bg-white border border-[#E4E6EE] rounded-xl p-4" style={{ height: 580 }}>
          <div className="flex gap-3 mb-3">
            <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
              className="bg-white border border-[#E4E6EE] text-gray-500 rounded-lg px-3 py-1.5 text-xs cursor-pointer">
              <option value="all">All Months</option>
              {months.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <span className="text-gray-600 text-xs self-center">{filtered.length} shipments plotted</span>
          </div>
          <ShipmentMap shipments={filtered} mode="heatmap" />
        </div>
      )}

      {/* ── ANALYTICS TAB ── */}
      {tab === 'analytics' && (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'Total Shipments', value: rows.length.toLocaleString() },
              { label: 'Total Ship Cost', value: `$${totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
              { label: 'Avg Cost / Shipment', value: `$${avgCost.toFixed(2)}` },
              { label: 'Top Customer', value: topCustomer, small: true },
              { label: 'Top Carrier', value: topCarrier, small: true },
              { label: 'Most Active Month', value: topMonth.replace(' 2026', ''), small: true },
            ].map(c => (
              <div key={c.label} className="bg-white border border-[#E4E6EE] rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">{c.label}</p>
                <p className={`font-semibold text-[#1A1D2E] ${c.small ? 'text-xs leading-tight mt-1' : 'text-lg'}`}>{c.value}</p>
              </div>
            ))}
          </div>

          {/* Chart 1 — Monthly */}
          <div className="bg-white border border-[#E4E6EE] rounded-xl p-5">
            <p className="text-sm font-medium text-[#1A1D2E] mb-4">Monthly Shipping Cost {drillMonth && <span className="text-gray-500 font-normal text-xs ml-2">→ click bar to drill down</span>}</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyData} onClick={(d: any) => { if (d?.activePayload) { setDrillMonth(d.activePayload[0].payload.month); setDrillWeek(null) } }}>
                <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toLocaleString()}`} />
                <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }} labelStyle={{ color: '#f9fafb', fontSize: 12 }} formatter={(v: any) => [`$${Number(v).toFixed(2)}`, 'Ship Cost']} />
                <Bar dataKey="cost" fill="#1D9E75" radius={[4, 4, 0, 0]} cursor="pointer" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Chart 2 — Weekly drill-down */}
          {drillMonth && (
            <div className="bg-white border border-[#E4E6EE] rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-medium text-[#1A1D2E]">{drillMonth} — Weekly Breakdown</p>
                <button onClick={() => { setDrillMonth(null); setDrillWeek(null) }} className="text-xs text-gray-500 hover:text-gray-600">✕ Clear</button>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={weeklyData} onClick={(d: any) => { if (d?.activePayload) setDrillWeek(d.activePayload[0].payload.week) }}>
                  <XAxis dataKey="week" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                  <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }} labelStyle={{ color: '#f9fafb', fontSize: 12 }} formatter={(v: any) => [`$${Number(v).toFixed(2)}`, 'Ship Cost']} />
                  <Bar dataKey="cost" fill="#3b82f6" radius={[4, 4, 0, 0]} cursor="pointer" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Chart 3 — Daily drill-down */}
          {drillWeek && (
            <div className="bg-white border border-[#E4E6EE] rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-medium text-[#1A1D2E]">{drillMonth} {drillWeek} — Daily Breakdown</p>
                <button onClick={() => setDrillWeek(null)} className="text-xs text-gray-500 hover:text-gray-600">✕ Clear</button>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={dailyData}>
                  <XAxis dataKey="day" tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                  <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }} labelStyle={{ color: '#f9fafb', fontSize: 12 }} formatter={(v: any) => [`$${Number(v).toFixed(2)}`, 'Ship Cost']} />
                  <Bar dataKey="cost" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Charts 4 + 5 side by side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Carrier pie */}
            <div className="bg-white border border-[#E4E6EE] rounded-xl p-5">
              <p className="text-sm font-medium text-[#1A1D2E] mb-4">Shipments by Carrier</p>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={carrierData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }: any) => `${name} ${((percent || 0) * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                    {carrierData.map((_, i) => <Cell key={i} fill={CARRIER_PIE_COLORS[i % CARRIER_PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }} labelStyle={{ color: '#f9fafb', fontSize: 12 }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Top 10 states */}
            <div className="bg-white border border-[#E4E6EE] rounded-xl p-5">
              <p className="text-sm font-medium text-[#1A1D2E] mb-4">Top 10 States by Shipments</p>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={stateData} layout="vertical">
                  <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis dataKey="state" type="category" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} width={30} />
                  <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }} labelStyle={{ color: '#f9fafb', fontSize: 12 }} />
                  <Bar dataKey="count" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      <BulkActionBar count={ms.count} onDelete={bulkDelete} onClear={ms.clear} deleting={deleting}/>

      {/* ── SLIDE-OUT PANEL ── */}
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setOpen(false)}>
          <div className="fixed inset-0 bg-black/50" />
          <div className="relative w-full max-w-lg bg-[#F9FAFB] border-l border-[#E4E6EE] h-full overflow-y-auto flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E4E6EE] shrink-0">
              <div>
                <h2 className="text-base font-semibold text-[#1A1D2E] truncate max-w-xs">{editing?.customer_name || 'Shipment'}</h2>
                <p className="text-xs text-gray-500 mt-0.5">{editing?.month_group}</p>
              </div>
              <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-gray-700 p-1.5 rounded-lg hover:bg-[#F5F6FA] transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Customer</label>
                  <input value={form.customer_name || ''} onChange={e => setForm(p => ({ ...p, customer_name: e.target.value }))} className={inp} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">PO #</label>
                  <input value={form.po_number || ''} onChange={e => setForm(p => ({ ...p, po_number: e.target.value }))} className={inp} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Order Date</label>
                  <input type="date" value={form.order_date || ''} onChange={e => setForm(p => ({ ...p, order_date: e.target.value }))} className={inp} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Ship Date</label>
                  <input type="date" value={form.ship_date || ''} onChange={e => setForm(p => ({ ...p, ship_date: e.target.value }))} className={inp} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Carrier</label>
                  <input value={form.carrier || ''} onChange={e => setForm(p => ({ ...p, carrier: e.target.value }))} className={inp} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Ship Cost ($)</label>
                  <input type="number" step="0.01" value={form.ship_cost ?? ''} onChange={e => setForm(p => ({ ...p, ship_cost: parseFloat(e.target.value) || 0 }))} className={inp} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">City</label>
                  <input value={form.city || ''} onChange={e => setForm(p => ({ ...p, city: e.target.value }))} className={inp} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">State</label>
                  <input value={form.state || ''} onChange={e => setForm(p => ({ ...p, state: e.target.value }))} className={inp} maxLength={2} placeholder="CA" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Tracking Number</label>
                  <input value={form.tracking_number || ''} onChange={e => setForm(p => ({ ...p, tracking_number: e.target.value }))} className={inp} />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Status</label>
                  <select value={form.delivery_status || 'Delivered'} onChange={e => setForm(p => ({ ...p, delivery_status: e.target.value }))} className={inp + ' cursor-pointer'}>
                    {['Delivered','In Transit','Exception','Pending'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Notes</label>
                  <textarea rows={3} value={form.notes || ''} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} className={inp + ' resize-none'} />
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <button onClick={() => setOpen(false)} className="flex-1 text-xs px-3 py-2 rounded-lg border border-[#E4E6EE] text-gray-400 hover:text-gray-700 transition-colors">Cancel</button>
                <button onClick={save} disabled={saving} className="flex-1 text-xs px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-[#1A1D2E] font-medium transition-colors">{saving ? 'Saving…' : 'Save Changes'}</button>
              </div>

              {editing && (
                <>
                  {/* Invoice info */}
                  <div className="border-t border-[#E4E6EE] pt-4">
                    <p className="text-xs font-semibold uppercase tracking-wider mb-2">Invoice</p>
                    {editing.invoice_number ? (
                      <div className="rounded-lg bg-[#F9FAFB] px-3 py-2.5 flex items-center justify-between">
                        <span className="text-xs text-gray-400">Invoice #</span>
                        <span className="font-mono text-xs text-blue-400 font-medium">{editing.invoice_number}</span>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-600 italic">No invoice linked to this shipment.</p>
                    )}
                  </div>
                  <div className="border-t border-[#E4E6EE] pt-4">
                    <FileUpload supabase={sb} recordType="shipments" recordId={editing.id} currentUserEmail={userEmail} />
                  </div>
                  <div className="border-t border-[#E4E6EE] pt-4">
                    <Comments recordType="shipment" recordId={editing.id} currentUserEmail={userEmail}/>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
