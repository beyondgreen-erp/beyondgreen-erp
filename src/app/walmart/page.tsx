'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import Comments from '@/components/Comments'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line,
} from 'recharts'

const WALMART_SKUS = [
  { sku: '22GVF24', name: 'Fork 24ct', short: 'F24' },
  { sku: '22GVA24', name: 'Assorted 24ct', short: 'A24' },
  { sku: '22GVK48', name: 'Knife 48ct', short: 'K48' },
  { sku: '22GVA48', name: 'Assorted 48ct', short: 'A48' },
  { sku: '22GVS48', name: 'Spoon 48ct', short: 'S48' },
  { sku: '22GVS24', name: 'Spoon 24ct', short: 'S24' },
  { sku: '22GVF48', name: 'Fork 48ct', short: 'F48' },
]

const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString()
const today = () => new Date().toISOString().slice(0, 10)
const fmtDate = (d: string) => {
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

type Tab = 'dashboard' | 'production' | 'inventory' | 'orders' | 'bom' | 'ai' | 'comments'

interface WalmartInventory {
  id: string; sku: string; product_name: string
  srps_available: number; packs_available: number
  safety_stock_srps: number; last_updated: string
}
interface WalmartOrder {
  id: string; po_number: string | null; order_date: string; ship_date: string | null
  status: string; sku: string; product_name: string | null
  srps_ordered: number; packs_ordered: number; notes: string | null
}
interface WalmartProduction {
  id: string; production_date: string; shift: string; logged_by: string
  srp_22GVF24: number; srp_22GVA24: number; srp_22GVK48: number
  srp_22GVA48: number; srp_22GVS48: number; srp_22GVS24: number; srp_22GVF48: number
  packs_22GVF24: number; packs_22GVA24: number; packs_22GVK48: number
  packs_22GVA48: number; packs_22GVS48: number; packs_22GVS24: number; packs_22GVF48: number
  total_srps: number; total_packs: number; notes: string | null
}
interface WalmartBom {
  id: string; finished_sku: string; component_sku: string; component_name: string | null
  quantity_per_srp: number; quantity_per_pack: number; component_type: string | null; notes: string | null
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

// ─── DASHBOARD TAB ────────────────────────────────────────────────────────────

function DashboardTab({ production, inventory, orders }: {
  production: WalmartProduction[]
  inventory: WalmartInventory[]
  orders: WalmartOrder[]
}) {
  const todayStr = today()
  const todayProd = production.filter(p => p.production_date === todayStr)
  const todaySRPs = todayProd.reduce((s, p) => s + p.total_srps, 0)
  const todayPacks = todayProd.reduce((s, p) => s + p.total_packs, 0)

  const now = new Date()
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay())
  const weekStr = weekStart.toISOString().slice(0, 10)
  const monthStr = todayStr.slice(0, 7)
  const weekSRPs = production.filter(p => p.production_date >= weekStr).reduce((s, p) => s + p.total_srps, 0)
  const monthSRPs = production.filter(p => p.production_date.startsWith(monthStr)).reduce((s, p) => s + p.total_srps, 0)
  const totalInvSRPs = inventory.reduce((s, i) => s + i.srps_available, 0)
  const openOrders = orders.filter(o => o.status === 'Open').length

  const kpis = [
    { label: "Today's SRPs", value: fmt(todaySRPs), color: 'text-[#0071CE]' },
    { label: "Today's Packs", value: fmt(todayPacks), color: 'text-[#00C896]' },
    { label: 'This Week SRPs', value: fmt(weekSRPs), color: 'text-[#0071CE]' },
    { label: 'This Month SRPs', value: fmt(monthSRPs), color: 'text-[#00C896]' },
    { label: 'Total Inventory SRPs', value: fmt(totalInvSRPs), color: 'text-amber-400' },
    { label: 'Open Orders', value: fmt(openOrders), color: openOrders > 0 ? 'text-amber-400' : 'text-[#5A5A6A]' },
  ]

  // Last 30 days chart data
  const last30: string[] = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    last30.push(d.toISOString().slice(0, 10))
  }

  const chartData = last30.map(date => {
    const dayProd = production.filter(p => p.production_date === date)
    const entry: any = { date: fmtDate(date), total: dayProd.reduce((s, p) => s + p.total_srps, 0) }
    WALMART_SKUS.forEach(({ sku, short }) => {
      const key = `srp_${sku}` as keyof WalmartProduction
      entry[short] = dayProd.reduce((s, p) => s + ((p[key] as number) ?? 0), 0)
    })
    return entry
  })

  // 7-day rolling average
  const rollingData = chartData.map((d, i) => {
    const slice = chartData.slice(Math.max(0, i - 6), i + 1)
    const avg = Math.round(slice.reduce((s, x) => s + x.total, 0) / slice.length)
    return { ...d, rolling7: avg }
  })

  // SKU table
  const invMap = Object.fromEntries(inventory.map(i => [i.sku, i]))
  const todayBySku = Object.fromEntries(WALMART_SKUS.map(({ sku }) => {
    const key = `srp_${sku}` as keyof WalmartProduction
    const packKey = `packs_${sku}` as keyof WalmartProduction
    return [sku, {
      srps: todayProd.reduce((s, p) => s + ((p[key] as number) ?? 0), 0),
      packs: todayProd.reduce((s, p) => s + ((p[packKey] as number) ?? 0), 0),
    }]
  }))

  const getStatus = (avail: number, safety: number) => {
    if (avail === 0) return { icon: '⚫', label: 'Empty', cls: 'text-[#5A5A6A]' }
    if (avail < safety) return { icon: '🔴', label: 'Critical', cls: 'text-red-400' }
    if (avail < safety * 1.5) return { icon: '🟡', label: 'Low', cls: 'text-amber-400' }
    return { icon: '🟢', label: 'Good', cls: 'text-[#00C896]' }
  }

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map(k => (
          <div key={k.label} className="bg-white border border-[#E4E6EE] rounded-2xl p-4">
            <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
            <p className="text-[#5A5A6A] text-xs mt-1">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Production Chart */}
      <div className="bg-white border border-[#E4E6EE] rounded-2xl p-5">
        <h3 className="text-[#1A1D2E] font-semibold mb-4">Daily SRP Production — Last 30 Days</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={rollingData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E4E6EE" />
            <XAxis dataKey="date" tick={{ fill: '#5A5A6A', fontSize: 11 }} interval={4} />
            <YAxis tick={{ fill: '#5A5A6A', fontSize: 11 }} />
            <Tooltip
              contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E4E6EE', borderRadius: 12 }}
              labelStyle={{ color: '#1A1D2E' }}
              itemStyle={{ color: '#9898A8' }}
            />
            <Bar dataKey="total" fill="#0071CE" radius={[3, 3, 0, 0]} name="Total SRPs" />
          </BarChart>
        </ResponsiveContainer>
        <h3 className="text-[#1A1D2E] font-semibold mb-4 mt-6">7-Day Rolling Average</h3>
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={rollingData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E4E6EE" />
            <XAxis dataKey="date" tick={{ fill: '#5A5A6A', fontSize: 11 }} interval={4} />
            <YAxis tick={{ fill: '#5A5A6A', fontSize: 11 }} />
            <Tooltip contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E4E6EE', borderRadius: 12 }} labelStyle={{ color: '#1A1D2E' }} />
            <Line type="monotone" dataKey="rolling7" stroke="#00C896" strokeWidth={2} dot={false} name="7-day avg" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* SKU Breakdown Table */}
      <div className="bg-white border border-[#E4E6EE] rounded-2xl overflow-x-auto">
        <div className="px-5 py-3 border-b border-[#E4E6EE]">
          <h3 className="text-[#1A1D2E] font-semibold">Today&apos;s Production by SKU</h3>
        </div>
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="border-b border-[#E4E6EE]">
              {['SKU', 'Name', 'SRPs Today', 'Packs Today', 'Available SRPs', 'Available Packs', 'Safety Stock', 'Status'].map(h => (
                <th key={h} className="text-left text-xs font-medium text-[#5A5A6A] uppercase tracking-wider py-3 px-4">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WALMART_SKUS.map(({ sku, name }) => {
              const inv = invMap[sku]
              const t = todayBySku[sku]
              const status = getStatus(inv?.srps_available ?? 0, inv?.safety_stock_srps ?? 0)
              return (
                <tr key={sku} className="border-b border-[#E4E6EE]/50 last:border-0 hover:bg-[#F5F6FA]/50">
                  <td className="px-4 py-3 font-mono text-xs text-[#0071CE]">{sku}</td>
                  <td className="px-4 py-3 text-[#1A1D2E] text-xs">{name}</td>
                  <td className="px-4 py-3 text-[#1A1D2E] text-xs font-semibold">{fmt(t?.srps)}</td>
                  <td className="px-4 py-3 text-[#9898A8] text-xs">{fmt(t?.packs)}</td>
                  <td className="px-4 py-3 text-[#1A1D2E] text-xs">{fmt(inv?.srps_available)}</td>
                  <td className="px-4 py-3 text-[#9898A8] text-xs">{fmt(inv?.packs_available)}</td>
                  <td className="px-4 py-3 text-[#9898A8] text-xs">{fmt(inv?.safety_stock_srps)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium ${status.cls}`}>{status.icon} {status.label}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── LOG PRODUCTION TAB ───────────────────────────────────────────────────────

type ShiftId = '1st Shift' | '2nd Shift' | '3rd Shift'
const SHIFTS: { id: ShiftId; icon: string; label: string }[] = [
  { id: '1st Shift', icon: '🌅', label: '1st Shift' },
  { id: '2nd Shift', icon: '☀️', label: '2nd Shift' },
  { id: '3rd Shift', icon: '🌙', label: '3rd Shift' },
]

function ProductionTab({ inventory, onRefresh, showToast }: {
  inventory: WalmartInventory[]
  onRefresh: () => void
  showToast: (msg: string, type: 'success' | 'error') => void
}) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [selectedDate, setSelectedDate] = useState(today())
  const [shift, setShift] = useState<ShiftId>('1st Shift')
  const [srps, setSrps] = useState<Record<string, number>>(Object.fromEntries(WALMART_SKUS.map(s => [s.sku, 0])))
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [recent, setRecent] = useState<WalmartProduction[]>([])
  const [recentLoading, setRecentLoading] = useState(true)
  const [userEmail, setUserEmail] = useState('unknown')
  const [existingEntry, setExistingEntry] = useState<WalmartProduction | null>(null)
  const [checkingExisting, setCheckingExisting] = useState(false)

  const invMap = Object.fromEntries(inventory.map(i => [i.sku, i]))

  useEffect(() => {
    sb.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? 'unknown'))
    loadRecent()
  }, []) // eslint-disable-line

  // Check for existing entry whenever date or shift changes
  useEffect(() => {
    let cancelled = false
    async function checkExisting() {
      setCheckingExisting(true)
      const { data } = await sb
        .from('walmart_production')
        .select('*')
        .eq('production_date', selectedDate)
        .eq('shift', shift)
        .maybeSingle()
      if (cancelled) return
      if (data) {
        setExistingEntry(data as WalmartProduction)
        // Pre-fill inputs from existing entry
        const filled: Record<string, number> = {}
        WALMART_SKUS.forEach(({ sku }) => {
          filled[sku] = (data as any)[`srp_${sku}`] ?? 0
        })
        setSrps(filled)
        setNotes(data.notes ?? '')
      } else {
        setExistingEntry(null)
        setSrps(Object.fromEntries(WALMART_SKUS.map(s => [s.sku, 0])))
        setNotes('')
      }
      setCheckingExisting(false)
    }
    checkExisting()
    return () => { cancelled = true }
  }, [selectedDate, shift]) // eslint-disable-line

  async function loadRecent() {
    setRecentLoading(true)
    const { data } = await sb.from('walmart_production').select('*').order('production_date', { ascending: false }).order('shift').limit(15)
    setRecent(data ?? [])
    setRecentLoading(false)
  }

  function adjust(sku: string, delta: number) {
    setSrps(prev => ({ ...prev, [sku]: Math.max(0, (prev[sku] ?? 0) + delta) }))
  }

  const totalSRPs = Object.values(srps).reduce((s, v) => s + v, 0)
  const totalPacks = totalSRPs * 6

  async function handleSubmit() {
    setSubmitting(true)
    const row: any = {
      production_date: selectedDate,
      shift,
      logged_by: userEmail,
      notes: notes || null,
    }
    WALMART_SKUS.forEach(({ sku }) => { row[`srp_${sku}`] = srps[sku] ?? 0 })

    const { error } = await sb
      .from('walmart_production')
      .upsert(row, { onConflict: 'production_date,shift' })

    if (error) {
      showToast('Failed to save production: ' + error.message, 'error')
    } else {
      const action = existingEntry ? 'Updated' : 'Logged'
      showToast(`${action} ${fmt(totalSRPs)} SRPs (${fmt(totalPacks)} packs) — ${shift} · ${selectedDate}`, 'success')
      setExistingEntry(null)
      setSrps(Object.fromEntries(WALMART_SKUS.map(s => [s.sku, 0])))
      setNotes('')
      loadRecent()
      onRefresh()
    }
    setSubmitting(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this production entry?')) return
    const { error } = await sb.from('walmart_production').delete().eq('id', id)
    if (error) showToast('Delete failed: ' + error.message, 'error')
    else { showToast('Entry deleted', 'success'); loadRecent(); onRefresh() }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border border-[#E4E6EE] rounded-2xl p-6 space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-xl font-bold text-[#1A1D2E]">Log Production Entry</h2>
          <p className="text-[#5A5A6A] text-sm mt-1">
            Select a date and shift below — you can log or update entries for past shifts.
          </p>
        </div>

        {/* Date + Shift row */}
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Date picker */}
          <div className="flex-1">
            <p className="text-[#9898A8] text-xs font-semibold uppercase tracking-wider mb-2">Production Date</p>
            <input
              type="date"
              value={selectedDate}
              max={today()}
              onChange={e => setSelectedDate(e.target.value)}
              className="w-full bg-white border border-[#E4E6EE] rounded-xl px-4 py-2.5 text-[#1A1D2E] text-sm focus:outline-none focus:border-[#0071CE]"
            />
          </div>

          {/* Shift selector */}
          <div className="flex-1">
            <p className="text-[#9898A8] text-xs font-semibold uppercase tracking-wider mb-2">Select Shift</p>
            <div className="flex gap-2">
              {SHIFTS.map(s => (
                <button
                  key={s.id}
                  onClick={() => setShift(s.id)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold transition-all border ${
                    shift === s.id
                      ? 'bg-[#0071CE] border-[#0071CE] text-white'
                      : 'bg-white border-[#E4E6EE] text-[#9898A8] hover:text-gray-700'
                  }`}
                >
                  {s.icon} {s.id}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Existing entry banner */}
        {checkingExisting ? (
          <div className="flex items-center gap-2 text-[#5A5A6A] text-sm">
            <Spinner /> Checking for existing entry…
          </div>
        ) : existingEntry ? (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-start gap-2">
            <span className="text-amber-400 text-base">⚠</span>
            <div>
              <p className="text-amber-400 text-sm font-medium">Entry exists for {selectedDate} · {shift}</p>
              <p className="text-amber-400/70 text-xs mt-0.5">Values have been pre-filled. Saving will update this entry.</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            <span className="text-emerald-400 text-xs font-medium">New entry — no data exists for {selectedDate} · {shift}</span>
          </div>
        )}

        {/* SKU Input Grid */}
        <div>
          <p className="text-[#9898A8] text-xs font-semibold uppercase tracking-wider mb-3">SRPs Produced This Shift</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {WALMART_SKUS.map(({ sku, name }) => {
              const inv = invMap[sku]
              const val = srps[sku] ?? 0
              return (
                <div key={sku} className="bg-white border border-[#E4E6EE] rounded-xl p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-xs text-[#0071CE] font-bold">{sku}</span>
                    <span className="text-[#5A5A6A] text-[10px]">Stock: {fmt(inv?.srps_available)} SRPs</span>
                  </div>
                  <p className="text-[#9898A8] text-xs mb-3">{name}</p>
                  <div className="flex items-center gap-2">
                    <button onClick={() => adjust(sku, -1)} className="w-9 h-9 rounded-xl bg-white border border-[#E4E6EE] text-[#1A1D2E] font-bold hover:bg-[#2A2A35] transition-colors flex items-center justify-center">−</button>
                    <input
                      type="number"
                      min={0}
                      value={val}
                      onChange={e => setSrps(prev => ({ ...prev, [sku]: Math.max(0, parseInt(e.target.value) || 0) }))}
                      className="flex-1 bg-white border border-[#E4E6EE] rounded-xl text-center text-[#1A1D2E] text-lg font-bold py-1.5 focus:outline-none focus:border-[#0071CE] min-w-0"
                    />
                    <button onClick={() => adjust(sku, 1)} className="w-9 h-9 rounded-xl bg-[#0071CE] text-[#1A1D2E] font-bold hover:bg-[#0071CE]/80 transition-colors flex items-center justify-center">+</button>
                  </div>
                  <p className="text-[#5A5A6A] text-xs mt-2 text-center">= {fmt(val * 6)} packs ({val} × 6)</p>
                </div>
              )
            })}
          </div>
        </div>

        {/* Summary */}
        {totalSRPs > 0 && (
          <div className="bg-[#F9FAFB] border border-[#0071CE]/30 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[#1A1D2E] font-semibold">Entry Summary</span>
              <div className="flex gap-6">
                <div><span className="text-[#5A5A6A] text-xs">Total SRPs</span><p className="text-[#0071CE] font-bold text-lg">{fmt(totalSRPs)}</p></div>
                <div><span className="text-[#5A5A6A] text-xs">Total Packs</span><p className="text-[#00C896] font-bold text-lg">{fmt(totalPacks)}</p></div>
              </div>
            </div>
            <table className="w-full text-xs">
              <thead><tr>{['SKU', 'SRPs', 'Packs'].map(h => <th key={h} className="text-left text-[#5A5A6A] pb-1 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {WALMART_SKUS.filter(({ sku }) => (srps[sku] ?? 0) > 0).map(({ sku, name }) => (
                  <tr key={sku}>
                    <td className="text-[#9898A8] py-0.5">{sku} – {name}</td>
                    <td className="text-[#1A1D2E] font-semibold">{fmt(srps[sku])}</td>
                    <td className="text-[#9898A8]">{fmt((srps[sku] ?? 0) * 6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Notes */}
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Optional notes for this production run..."
          rows={2}
          className="w-full bg-white border border-[#E4E6EE] rounded-xl px-4 py-3 text-[#1A1D2E] text-sm placeholder-[#3A3A4A] focus:outline-none focus:border-[#0071CE] resize-none"
        />

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={submitting || totalSRPs === 0}
          className="w-full py-4 rounded-2xl bg-[#00C896] hover:bg-[#00C896]/90 text-black font-bold text-base transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {submitting ? <Spinner /> : '✓'}
          {existingEntry ? 'Update Entry' : 'Log Production'}
        </button>
      </div>

      {/* Recent Entries */}
      <div className="bg-white border border-[#E4E6EE] rounded-2xl overflow-x-auto">
        <div className="px-5 py-3 border-b border-[#E4E6EE] flex items-center justify-between">
          <h3 className="text-[#1A1D2E] font-semibold">Recent Entries</h3>
          <p className="text-[#5A5A6A] text-xs">Click a row to load it for editing</p>
        </div>
        {recentLoading ? (
          <div className="flex items-center justify-center py-12"><Spinner /></div>
        ) : recent.length === 0 ? (
          <div className="text-center py-12 text-[#5A5A6A] text-sm">No production entries yet</div>
        ) : (
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-[#E4E6EE]">
                {['Date', 'Shift', 'Total SRPs', 'Total Packs', 'Logged By', 'Notes', 'Actions'].map(h => (
                  <th key={h} className="text-left text-xs font-medium text-[#5A5A6A] uppercase tracking-wider py-3 px-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recent.map(entry => (
                <tr
                  key={entry.id}
                  className="border-b border-[#E4E6EE]/50 last:border-0 hover:bg-[#F5F6FA]/50 cursor-pointer"
                  onClick={() => {
                    setSelectedDate(entry.production_date)
                    setShift(entry.shift as ShiftId)
                    window.scrollTo({ top: 0, behavior: 'smooth' })
                  }}
                >
                  <td className="px-4 py-3 text-[#9898A8] text-xs">{fmtDate(entry.production_date)}</td>
                  <td className="px-4 py-3 text-[#1A1D2E] text-xs">{entry.shift}</td>
                  <td className="px-4 py-3 text-[#0071CE] font-semibold text-xs">{fmt(entry.total_srps)}</td>
                  <td className="px-4 py-3 text-[#9898A8] text-xs">{fmt(entry.total_packs)}</td>
                  <td className="px-4 py-3 text-[#9898A8] text-xs truncate max-w-[140px]">{entry.logged_by}</td>
                  <td className="px-4 py-3 text-[#5A5A6A] text-xs truncate max-w-[160px]">{entry.notes ?? '—'}</td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <button onClick={() => handleDelete(entry.id)} className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded-lg hover:bg-red-500/10 transition-colors">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ─── INVENTORY TAB ────────────────────────────────────────────────────────────

function InventoryTab({ inventory, production, onRefresh, showToast }: {
  inventory: WalmartInventory[]
  production: WalmartProduction[]
  onRefresh: () => void
  showToast: (msg: string, type: 'success' | 'error') => void
}) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [view, setView] = useState<'daily' | 'weekly' | 'monthly'>('daily')
  const [adjustSku, setAdjustSku] = useState<string | null>(null)
  const [adjAmt, setAdjAmt] = useState(0)
  const [adjReason, setAdjReason] = useState('Correction')
  const [adjNotes, setAdjNotes] = useState('')
  const [adjSubmitting, setAdjSubmitting] = useState(false)

  const invMap = Object.fromEntries(inventory.map(i => [i.sku, i]))

  const getStatus = (avail: number, safety: number) => {
    if (avail === 0) return { icon: '⚫', cls: 'text-[#5A5A6A]', label: 'Empty' }
    if (avail < safety) return { icon: '🔴', cls: 'text-red-400', label: 'Critical' }
    if (avail < safety * 1.5) return { icon: '🟡', cls: 'text-amber-400', label: 'Low' }
    return { icon: '🟢', cls: 'text-[#00C896]', label: 'Good' }
  }

  async function applyAdjustment() {
    if (!adjustSku || adjAmt === 0) return
    setAdjSubmitting(true)
    const inv = invMap[adjustSku]
    const newSrps = Math.max(0, (inv?.srps_available ?? 0) + adjAmt)
    const newPacks = newSrps * 6
    const { error } = await sb.from('walmart_inventory').update({
      srps_available: newSrps, packs_available: newPacks, last_updated: new Date().toISOString()
    }).eq('sku', adjustSku)
    if (error) showToast('Adjustment failed: ' + error.message, 'error')
    else {
      showToast(`Adjusted ${adjustSku} by ${adjAmt > 0 ? '+' : ''}${adjAmt} SRPs (${adjReason})`, 'success')
      setAdjustSku(null); setAdjAmt(0); setAdjNotes('')
      onRefresh()
    }
    setAdjSubmitting(false)
  }

  // Group production by day with per-shift columns
  const dailyData = (() => {
    type DayRow = {
      date: string
      '1st Shift': number; '2nd Shift': number; '3rd Shift': number
      total_srps: number; total_packs: number
    }
    const map: Record<string, DayRow> = {}
    production.forEach(p => {
      if (!map[p.production_date]) {
        map[p.production_date] = { date: p.production_date, '1st Shift': 0, '2nd Shift': 0, '3rd Shift': 0, total_srps: 0, total_packs: 0 }
      }
      const shiftKey = p.shift as '1st Shift' | '2nd Shift' | '3rd Shift'
      if (shiftKey in map[p.production_date]) {
        map[p.production_date][shiftKey] += p.total_srps
      }
      map[p.production_date].total_srps += p.total_srps
      map[p.production_date].total_packs += p.total_packs
    })
    return Object.values(map).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30) as DayRow[]
  })()

  const weeklyData = (() => {
    const map: Record<string, { week: string; start: string; total_srps: number; total_packs: number; days: string[] }> = {}
    production.forEach(p => {
      const d = new Date(p.production_date + 'T00:00:00')
      const day = d.getDay()
      const ws = new Date(d); ws.setDate(d.getDate() - day)
      const wk = ws.toISOString().slice(0, 10)
      if (!map[wk]) map[wk] = { week: wk, start: wk, total_srps: 0, total_packs: 0, days: [] }
      map[wk].total_srps += p.total_srps
      map[wk].total_packs += p.total_packs
      if (!map[wk].days.includes(p.production_date)) map[wk].days.push(p.production_date)
    })
    return Object.values(map).sort((a, b) => b.week.localeCompare(a.week)).slice(0, 12).map(w => ({
      ...w,
      end: (() => { const e = new Date(w.start + 'T00:00:00'); e.setDate(e.getDate() + 6); return e.toISOString().slice(0, 10) })(),
      avg_daily: w.days.length > 0 ? Math.round(w.total_srps / w.days.length) : 0,
    }))
  })()

  const monthlyData = (() => {
    const map: Record<string, { month: string; total_srps: number; total_packs: number; days: string[]; best_day: number }> = {}
    production.forEach(p => {
      const m = p.production_date.slice(0, 7)
      if (!map[m]) map[m] = { month: m, total_srps: 0, total_packs: 0, days: [], best_day: 0 }
      map[m].total_srps += p.total_srps
      map[m].total_packs += p.total_packs
      if (!map[m].days.includes(p.production_date)) map[m].days.push(p.production_date)
      if (p.total_srps > map[m].best_day) map[m].best_day = p.total_srps
    })
    return Object.values(map).sort((a, b) => b.month.localeCompare(a.month)).slice(0, 12).map(m => ({
      ...m,
      avg_daily: m.days.length > 0 ? Math.round(m.total_srps / m.days.length) : 0,
      label: new Date(m.month + '-01T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    }))
  })()

  return (
    <div className="space-y-6">
      {/* Inventory Table */}
      <div className="bg-white border border-[#E4E6EE] rounded-2xl overflow-x-auto">
        <div className="px-5 py-3 border-b border-[#E4E6EE]">
          <h3 className="text-[#1A1D2E] font-semibold">Current Inventory</h3>
        </div>
        <table className="w-full text-sm min-w-[800px]">
          <thead>
            <tr className="border-b border-[#E4E6EE]">
              {['SKU', 'Product', 'SRPs Available', 'Packs Available', 'Safety Stock', 'Status', 'Last Updated', 'Adjust'].map(h => (
                <th key={h} className="text-left text-xs font-medium text-[#5A5A6A] uppercase tracking-wider py-3 px-4">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WALMART_SKUS.map(({ sku, name }) => {
              const inv = invMap[sku]
              const status = getStatus(inv?.srps_available ?? 0, inv?.safety_stock_srps ?? 0)
              return (
                <tr key={sku} className="border-b border-[#E4E6EE]/50 last:border-0 hover:bg-[#F5F6FA]/50">
                  <td className="px-4 py-3 font-mono text-xs text-[#0071CE]">{sku}</td>
                  <td className="px-4 py-3 text-[#1A1D2E] text-xs">{inv?.product_name ?? name}</td>
                  <td className="px-4 py-3 text-[#1A1D2E] font-semibold text-xs">{fmt(inv?.srps_available)}</td>
                  <td className="px-4 py-3 text-[#9898A8] text-xs">{fmt(inv?.packs_available)}</td>
                  <td className="px-4 py-3 text-[#9898A8] text-xs">{fmt(inv?.safety_stock_srps)}</td>
                  <td className="px-4 py-3"><span className={`text-xs font-medium ${status.cls}`}>{status.icon} {status.label}</span></td>
                  <td className="px-4 py-3 text-[#5A5A6A] text-xs">{inv?.last_updated ? new Date(inv.last_updated).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => { setAdjustSku(sku); setAdjAmt(0) }} className="text-xs text-[#0071CE] hover:text-[#0071CE]/80 px-2 py-1 rounded-lg hover:bg-[#0071CE]/10 transition-colors border border-[#0071CE]/30">Adjust</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Adjust Modal */}
      {adjustSku && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white border border-[#E4E6EE] rounded-2xl p-6 w-full max-w-md mx-4">
            <h3 className="text-[#1A1D2E] font-bold text-lg mb-4">Adjust Inventory — {adjustSku}</h3>
            <div className="space-y-4">
              <div>
                <label className="text-[#9898A8] text-xs uppercase tracking-wider mb-2 block">Reason</label>
                <select value={adjReason} onChange={e => setAdjReason(e.target.value)} className="w-full bg-white border border-[#E4E6EE] rounded-xl px-4 py-2.5 text-[#1A1D2E] text-sm focus:outline-none focus:border-[#0071CE]">
                  {['Correction', 'Damage', 'Lost', 'Count', 'Order', 'Other'].map(r => <option key={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[#9898A8] text-xs uppercase tracking-wider mb-2 block">Adjustment (SRPs, + or -)</label>
                <input type="number" value={adjAmt} onChange={e => setAdjAmt(parseInt(e.target.value) || 0)} className="w-full bg-white border border-[#E4E6EE] rounded-xl px-4 py-2.5 text-[#1A1D2E] text-sm focus:outline-none focus:border-[#0071CE]" />
                <p className="text-[#5A5A6A] text-xs mt-1">New total: {fmt(Math.max(0, (invMap[adjustSku]?.srps_available ?? 0) + adjAmt))} SRPs</p>
              </div>
              <div>
                <label className="text-[#9898A8] text-xs uppercase tracking-wider mb-2 block">Notes</label>
                <input type="text" value={adjNotes} onChange={e => setAdjNotes(e.target.value)} placeholder="Optional notes..." className="w-full bg-white border border-[#E4E6EE] rounded-xl px-4 py-2.5 text-[#1A1D2E] text-sm focus:outline-none focus:border-[#0071CE]" />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setAdjustSku(null)} className="flex-1 py-2.5 rounded-xl border border-[#E4E6EE] text-[#9898A8] hover:text-[#1A1D2E] text-sm transition-colors">Cancel</button>
                <button onClick={applyAdjustment} disabled={adjSubmitting || adjAmt === 0} className="flex-1 py-2.5 rounded-xl bg-[#0071CE] text-[#1A1D2E] font-semibold text-sm hover:bg-[#0071CE]/80 transition-colors disabled:opacity-40">
                  {adjSubmitting ? 'Applying...' : 'Apply Adjustment'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* History Toggle */}
      <div className="bg-white border border-[#E4E6EE] rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-[#E4E6EE] flex items-center justify-between">
          <h3 className="text-[#1A1D2E] font-semibold">Production History</h3>
          <div className="flex gap-1">
            {(['daily', 'weekly', 'monthly'] as const).map(v => (
              <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${view === v ? 'bg-[#0071CE] text-white' : 'bg-white text-[#9898A8] hover:text-gray-700'}`}>
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          {view === 'daily' && (
            <table className="w-full text-sm min-w-[700px]">
              <thead><tr className="border-b border-[#E4E6EE]">
                {['Date', '1st Shift', '2nd Shift', '3rd Shift', 'Daily Total'].map(h => (
                  <th key={h} className="text-left text-xs font-medium text-[#5A5A6A] uppercase tracking-wider py-3 px-4">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {dailyData.map(d => (
                  <tr key={d.date} className="border-b border-[#E4E6EE]/50 last:border-0 hover:bg-[#F5F6FA]/50">
                    <td className="px-4 py-2.5 text-[#9898A8] text-xs font-medium">{fmtDate(d.date)}</td>
                    {(['1st Shift', '2nd Shift', '3rd Shift'] as const).map(sh => (
                      <td key={sh} className="px-4 py-2.5 text-xs">
                        {d[sh] > 0
                          ? <span className="text-[#1A1D2E] font-semibold">{fmt(d[sh])} SRPs</span>
                          : <span className="text-[#3A3A45]">—</span>
                        }
                      </td>
                    ))}
                    <td className="px-4 py-2.5 text-[#0071CE] font-bold text-xs">{fmt(d.total_srps)} SRPs</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {view === 'weekly' && (
            <table className="w-full text-sm min-w-[600px]">
              <thead><tr className="border-b border-[#E4E6EE]">
                {['Week', 'Start', 'End', 'Total SRPs', 'Total Packs', 'Avg Daily'].map(h => (
                  <th key={h} className="text-left text-xs font-medium text-[#5A5A6A] uppercase tracking-wider py-3 px-4">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {weeklyData.map((w, i) => (
                  <tr key={w.week} className={`border-b border-[#E4E6EE]/50 last:border-0 hover:bg-[#F5F6FA]/50 ${i === 0 ? 'bg-[#0071CE]/5' : ''}`}>
                    <td className="px-4 py-2.5 text-[#9898A8] text-xs font-mono">Wk {i + 1}</td>
                    <td className="px-4 py-2.5 text-[#9898A8] text-xs">{fmtDate(w.start)}</td>
                    <td className="px-4 py-2.5 text-[#9898A8] text-xs">{fmtDate(w.end)}</td>
                    <td className="px-4 py-2.5 text-[#0071CE] font-semibold text-xs">{fmt(w.total_srps)}</td>
                    <td className="px-4 py-2.5 text-[#9898A8] text-xs">{fmt(w.total_packs)}</td>
                    <td className="px-4 py-2.5 text-[#1A1D2E] text-xs">{fmt(w.avg_daily)}/day</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {view === 'monthly' && (
            <table className="w-full text-sm min-w-[600px]">
              <thead><tr className="border-b border-[#E4E6EE]">
                {['Month', 'Total SRPs', 'Total Packs', 'Best Day', 'Avg Daily'].map(h => (
                  <th key={h} className="text-left text-xs font-medium text-[#5A5A6A] uppercase tracking-wider py-3 px-4">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {monthlyData.map((m, i) => (
                  <tr key={m.month} className={`border-b border-[#E4E6EE]/50 last:border-0 hover:bg-[#F5F6FA]/50 ${i === 0 ? 'bg-[#0071CE]/5' : ''}`}>
                    <td className="px-4 py-2.5 text-[#1A1D2E] text-xs font-semibold">{m.label}</td>
                    <td className="px-4 py-2.5 text-[#0071CE] font-semibold text-xs">{fmt(m.total_srps)}</td>
                    <td className="px-4 py-2.5 text-[#9898A8] text-xs">{fmt(m.total_packs)}</td>
                    <td className="px-4 py-2.5 text-[#00C896] text-xs">{fmt(m.best_day)}</td>
                    <td className="px-4 py-2.5 text-[#1A1D2E] text-xs">{fmt(m.avg_daily)}/day</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── ORDERS TAB ───────────────────────────────────────────────────────────────

function OrdersTab({ inventory, orders, onRefresh, showToast }: {
  inventory: WalmartInventory[]
  orders: WalmartOrder[]
  onRefresh: () => void
  showToast: (msg: string, type: 'success' | 'error') => void
}) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ po_number: '', order_date: today(), ship_date: '', sku: '22GVF24', srps_ordered: 0, notes: '' })
  const [submitting, setSubmitting] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const invMap = Object.fromEntries(inventory.map(i => [i.sku, i]))

  async function handleAddOrder() {
    if (!form.sku || form.srps_ordered <= 0) { showToast('Fill in all required fields', 'error'); return }
    setSubmitting(true)
    const inv = invMap[form.sku]
    const insufficient = inv && inv.srps_available < form.srps_ordered
    if (insufficient && !confirm(`Warning: Only ${fmt(inv?.srps_available)} SRPs available for ${form.sku}, but ${fmt(form.srps_ordered)} ordered. Continue?`)) {
      setSubmitting(false); return
    }

    const { error } = await sb.from('walmart_orders').insert([{
      po_number: form.po_number || null,
      order_date: form.order_date,
      ship_date: form.ship_date || null,
      sku: form.sku,
      product_name: WALMART_SKUS.find(s => s.sku === form.sku)?.name ?? null,
      srps_ordered: form.srps_ordered,
      packs_ordered: form.srps_ordered * 6,
      notes: form.notes || null,
      status: 'Open',
    }])

    if (!error) {
      // Deduct inventory
      await sb.rpc('decrement_walmart_srps', { p_sku: form.sku, p_amount: form.srps_ordered })
      showToast(`Order added — ${fmt(form.srps_ordered)} SRPs deducted from inventory`, 'success')
      setForm({ po_number: '', order_date: today(), ship_date: '', sku: '22GVF24', srps_ordered: 0, notes: '' })
      setShowForm(false)
      onRefresh()
    } else {
      showToast('Failed to add order: ' + error.message, 'error')
    }
    setSubmitting(false)
  }

  async function updateStatus(id: string, status: string) {
    setUpdatingId(id)
    const { error } = await sb.from('walmart_orders').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) showToast('Update failed: ' + error.message, 'error')
    else { showToast(`Order marked as ${status}`, 'success'); onRefresh() }
    setUpdatingId(null)
  }

  async function cancelOrder(id: string) {
    if (!confirm('Cancel this order?')) return
    const order = orders.find(o => o.id === id)
    if (order && order.status === 'Open') {
      // Restore inventory when cancelling
      await sb.rpc('decrement_walmart_srps', { p_sku: order.sku, p_amount: -order.srps_ordered })
    }
    await updateStatus(id, 'Cancelled')
  }

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      'Open': 'bg-amber-500/15 text-amber-400 border-amber-500/25',
      'In Production': 'bg-[#0071CE]/15 text-[#0071CE] border-[#0071CE]/25',
      'Ready to Ship': 'bg-violet-500/15 text-violet-400 border-violet-500/25',
      'Shipped': 'bg-[#00C89615] text-[#00C896] border-[#00C89630]',
      'Cancelled': 'bg-[#2A2A35] text-[#5A5A6A] border-[#3A3A45]',
    }
    return `inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium border ${map[status] ?? map.Open}`
  }

  return (
    <div className="space-y-6">
      {/* Add Order Button */}
      <div className="flex items-center justify-between">
        <h3 className="text-[#1A1D2E] font-semibold">Walmart Orders</h3>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0071CE] text-[#1A1D2E] text-sm font-semibold hover:bg-[#0071CE]/80 transition-colors">
          {showForm ? '✕ Close' : '+ Add Order'}
        </button>
      </div>

      {/* Add Order Form */}
      {showForm && (
        <div className="bg-white border border-[#0071CE]/30 rounded-2xl p-6 space-y-4">
          <h3 className="text-[#1A1D2E] font-semibold">New Walmart Order</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="text-[#9898A8] text-xs uppercase tracking-wider mb-1.5 block">PO Number</label>
              <input value={form.po_number} onChange={e => setForm(f => ({ ...f, po_number: e.target.value }))} placeholder="WM-12345" className="w-full bg-white border border-[#E4E6EE] rounded-xl px-4 py-2.5 text-[#1A1D2E] text-sm focus:outline-none focus:border-[#0071CE]" />
            </div>
            <div>
              <label className="text-[#9898A8] text-xs uppercase tracking-wider mb-1.5 block">Order Date</label>
              <input type="date" value={form.order_date} onChange={e => setForm(f => ({ ...f, order_date: e.target.value }))} className="w-full bg-white border border-[#E4E6EE] rounded-xl px-4 py-2.5 text-[#1A1D2E] text-sm focus:outline-none focus:border-[#0071CE]" />
            </div>
            <div>
              <label className="text-[#9898A8] text-xs uppercase tracking-wider mb-1.5 block">Required Ship Date</label>
              <input type="date" value={form.ship_date} onChange={e => setForm(f => ({ ...f, ship_date: e.target.value }))} className="w-full bg-white border border-[#E4E6EE] rounded-xl px-4 py-2.5 text-[#1A1D2E] text-sm focus:outline-none focus:border-[#0071CE]" />
            </div>
            <div>
              <label className="text-[#9898A8] text-xs uppercase tracking-wider mb-1.5 block">SKU</label>
              <select value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} className="w-full bg-white border border-[#E4E6EE] rounded-xl px-4 py-2.5 text-[#1A1D2E] text-sm focus:outline-none focus:border-[#0071CE]">
                {WALMART_SKUS.map(s => <option key={s.sku} value={s.sku}>{s.sku} — {s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[#9898A8] text-xs uppercase tracking-wider mb-1.5 block">SRPs Ordered</label>
              <input type="number" min={0} value={form.srps_ordered} onChange={e => setForm(f => ({ ...f, srps_ordered: parseInt(e.target.value) || 0 }))} className="w-full bg-white border border-[#E4E6EE] rounded-xl px-4 py-2.5 text-[#1A1D2E] text-sm focus:outline-none focus:border-[#0071CE]" />
              <p className="text-[#5A5A6A] text-xs mt-1">= {fmt(form.srps_ordered * 6)} packs · Available: {fmt(invMap[form.sku]?.srps_available)} SRPs</p>
            </div>
            <div>
              <label className="text-[#9898A8] text-xs uppercase tracking-wider mb-1.5 block">Notes</label>
              <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional..." className="w-full bg-white border border-[#E4E6EE] rounded-xl px-4 py-2.5 text-[#1A1D2E] text-sm focus:outline-none focus:border-[#0071CE]" />
            </div>
          </div>
          <button onClick={handleAddOrder} disabled={submitting} className="px-8 py-2.5 rounded-xl bg-[#0071CE] text-[#1A1D2E] font-semibold text-sm hover:bg-[#0071CE]/80 transition-colors disabled:opacity-40">
            {submitting ? 'Adding...' : '+ Add Order'}
          </button>
        </div>
      )}

      {/* Orders Table */}
      <div className="bg-white border border-[#E4E6EE] rounded-2xl overflow-x-auto">
        {orders.length === 0 ? (
          <div className="text-center py-16 text-[#5A5A6A] text-sm">No Walmart orders yet</div>
        ) : (
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-[#E4E6EE]">
                {['PO Number', 'SKU', 'Product', 'SRPs', 'Packs', 'Order Date', 'Ship Date', 'Status', 'Actions'].map(h => (
                  <th key={h} className="text-left text-xs font-medium text-[#5A5A6A] uppercase tracking-wider py-3 px-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map(order => (
                <tr key={order.id} className="border-b border-[#E4E6EE]/50 last:border-0 hover:bg-[#F5F6FA]/50">
                  <td className="px-4 py-3 font-mono text-xs text-[#0071CE]">{order.po_number ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-[#1A1D2E]">{order.sku}</td>
                  <td className="px-4 py-3 text-[#9898A8] text-xs">{order.product_name ?? '—'}</td>
                  <td className="px-4 py-3 text-[#1A1D2E] font-semibold text-xs">{fmt(order.srps_ordered)}</td>
                  <td className="px-4 py-3 text-[#9898A8] text-xs">{fmt(order.packs_ordered)}</td>
                  <td className="px-4 py-3 text-[#9898A8] text-xs">{order.order_date ? fmtDate(order.order_date) : '—'}</td>
                  <td className="px-4 py-3 text-[#9898A8] text-xs">{order.ship_date ? fmtDate(order.ship_date) : '—'}</td>
                  <td className="px-4 py-3"><span className={statusBadge(order.status)}>{order.status}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {updatingId === order.id ? <Spinner /> : (
                        <>
                          {order.status === 'Open' && (
                            <button onClick={() => updateStatus(order.id, 'Ready to Ship')} className="text-xs text-[#00C896] px-2 py-1 rounded-lg hover:bg-[#00C896]/10 transition-colors">Ship</button>
                          )}
                          {order.status === 'Ready to Ship' && (
                            <button onClick={() => updateStatus(order.id, 'Shipped')} className="text-xs text-[#00C896] px-2 py-1 rounded-lg hover:bg-[#00C896]/10 transition-colors">Mark Shipped</button>
                          )}
                          {!['Shipped', 'Cancelled'].includes(order.status) && (
                            <button onClick={() => cancelOrder(order.id)} className="text-xs text-red-400 px-2 py-1 rounded-lg hover:bg-red-500/10 transition-colors">Cancel</button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ─── BOM TAB ──────────────────────────────────────────────────────────────────

function BomTab({ bom, onRefresh, showToast }: {
  bom: WalmartBom[]
  onRefresh: () => void
  showToast: (msg: string, type: 'success' | 'error') => void
}) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [selectedSku, setSelectedSku] = useState('22GVF24')
  const [calcQty, setCalcQty] = useState(0)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newComp, setNewComp] = useState({ component_sku: '', component_name: '', component_type: 'packaging', quantity_per_srp: 1, quantity_per_pack: 0.1667 })
  const [addSubmitting, setAddSubmitting] = useState(false)

  const bomForSku = bom.filter(b => b.finished_sku === selectedSku)

  const typeBadge = (type: string | null) => {
    const map: Record<string, string> = {
      packaging: 'bg-[#0071CE]/15 text-[#0071CE] border-[#0071CE]/25',
      raw_material: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
      label: 'bg-violet-500/15 text-violet-400 border-violet-500/25',
      box: 'bg-[#00C896]/15 text-[#00C896] border-[#00C896]/25',
    }
    return `inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${map[type ?? ''] ?? 'bg-[#2A2A35] text-[#9898A8] border-[#3A3A45]'}`
  }

  async function handleAddComponent() {
    if (!newComp.component_sku) { showToast('Component SKU required', 'error'); return }
    setAddSubmitting(true)
    const { error } = await sb.from('walmart_bom').insert([{
      finished_sku: selectedSku,
      component_sku: newComp.component_sku,
      component_name: newComp.component_name || null,
      component_type: newComp.component_type,
      quantity_per_srp: newComp.quantity_per_srp,
      quantity_per_pack: newComp.quantity_per_pack,
    }])
    if (error) showToast('Failed to add component: ' + error.message, 'error')
    else { showToast('Component added to BOM', 'success'); setShowAddForm(false); onRefresh() }
    setAddSubmitting(false)
  }

  async function handleDeleteComp(id: string) {
    if (!confirm('Remove this component from BOM?')) return
    const { error } = await sb.from('walmart_bom').delete().eq('id', id)
    if (error) showToast('Delete failed: ' + error.message, 'error')
    else { showToast('Component removed', 'success'); onRefresh() }
  }

  const skuBomCounts = Object.fromEntries(WALMART_SKUS.map(({ sku }) => [sku, bom.filter(b => b.finished_sku === sku).length]))

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left: SKU Selector */}
      <div className="space-y-2">
        <h3 className="text-[#9898A8] text-xs font-semibold uppercase tracking-wider mb-3">Select SKU</h3>
        {WALMART_SKUS.map(({ sku, name }) => (
          <button
            key={sku}
            onClick={() => setSelectedSku(sku)}
            className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${selectedSku === sku ? 'bg-[#0071CE]/15 border-[#0071CE]/40 text-[#1A1D2E]' : 'bg-white border-[#E4E6EE] text-[#9898A8] hover:text-gray-700 hover:border-gray-400'}`}
          >
            <p className="font-mono text-xs font-bold text-[#0071CE]">{sku}</p>
            <div className="flex items-center justify-between mt-0.5">
              <span className="text-xs">{name}</span>
              <span className="text-[#5A5A6A] text-xs">{skuBomCounts[sku] ?? 0} components</span>
            </div>
          </button>
        ))}
      </div>

      {/* Right: BOM Detail */}
      <div className="lg:col-span-2 space-y-5">
        <div className="bg-white border border-[#E4E6EE] rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-[#E4E6EE] flex items-center justify-between">
            <div>
              <h3 className="text-[#1A1D2E] font-semibold">BOM for {selectedSku} — {WALMART_SKUS.find(s => s.sku === selectedSku)?.name}</h3>
              <p className="text-[#5A5A6A] text-xs mt-0.5">Components per SRP (6-pack)</p>
            </div>
            <button onClick={() => setShowAddForm(!showAddForm)} className="text-xs px-3 py-1.5 rounded-lg bg-[#0071CE] text-[#1A1D2E] font-semibold hover:bg-[#0071CE]/80 transition-colors">
              {showAddForm ? 'Cancel' : '+ Add Component'}
            </button>
          </div>

          {showAddForm && (
            <div className="px-5 py-4 border-b border-[#E4E6EE] bg-[#0071CE]/5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#9898A8] text-xs mb-1 block">Component SKU</label>
                  <input value={newComp.component_sku} onChange={e => setNewComp(p => ({ ...p, component_sku: e.target.value }))} placeholder="e.g. 22GVF-P" className="w-full bg-white border border-[#E4E6EE] rounded-xl px-3 py-2 text-[#1A1D2E] text-sm focus:outline-none focus:border-[#0071CE]" />
                </div>
                <div>
                  <label className="text-[#9898A8] text-xs mb-1 block">Component Name</label>
                  <input value={newComp.component_name} onChange={e => setNewComp(p => ({ ...p, component_name: e.target.value }))} placeholder="Display name..." className="w-full bg-white border border-[#E4E6EE] rounded-xl px-3 py-2 text-[#1A1D2E] text-sm focus:outline-none focus:border-[#0071CE]" />
                </div>
                <div>
                  <label className="text-[#9898A8] text-xs mb-1 block">Type</label>
                  <select value={newComp.component_type} onChange={e => setNewComp(p => ({ ...p, component_type: e.target.value }))} className="w-full bg-white border border-[#E4E6EE] rounded-xl px-3 py-2 text-[#1A1D2E] text-sm focus:outline-none focus:border-[#0071CE]">
                    {['packaging', 'raw_material', 'label', 'box', 'other'].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[#9898A8] text-xs mb-1 block">Qty per SRP</label>
                  <input type="number" step="0.0001" value={newComp.quantity_per_srp} onChange={e => setNewComp(p => ({ ...p, quantity_per_srp: parseFloat(e.target.value) || 0, quantity_per_pack: (parseFloat(e.target.value) || 0) / 6 }))} className="w-full bg-white border border-[#E4E6EE] rounded-xl px-3 py-2 text-[#1A1D2E] text-sm focus:outline-none focus:border-[#0071CE]" />
                </div>
              </div>
              <button onClick={handleAddComponent} disabled={addSubmitting} className="px-5 py-2 rounded-xl bg-[#0071CE] text-[#1A1D2E] text-sm font-semibold disabled:opacity-40 hover:bg-[#0071CE]/80 transition-colors">
                {addSubmitting ? 'Adding...' : 'Add to BOM'}
              </button>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[500px]">
              <thead><tr className="border-b border-[#E4E6EE]">
                {['Component SKU', 'Name', 'Type', 'Qty/SRP', 'Qty/Pack', 'Actions'].map(h => (
                  <th key={h} className="text-left text-xs font-medium text-[#5A5A6A] uppercase tracking-wider py-3 px-4">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {bomForSku.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-[#5A5A6A] text-sm">No BOM components for this SKU</td></tr>
                ) : bomForSku.map(comp => (
                  <tr key={comp.id} className="border-b border-[#E4E6EE]/50 last:border-0 hover:bg-[#F5F6FA]/50">
                    <td className="px-4 py-3 font-mono text-xs text-[#0071CE]">{comp.component_sku}</td>
                    <td className="px-4 py-3 text-[#1A1D2E] text-xs">{comp.component_name ?? '—'}</td>
                    <td className="px-4 py-3"><span className={typeBadge(comp.component_type)}>{comp.component_type ?? 'other'}</span></td>
                    <td className="px-4 py-3 text-[#1A1D2E] text-xs font-semibold">{comp.quantity_per_srp}</td>
                    <td className="px-4 py-3 text-[#9898A8] text-xs">{Number(comp.quantity_per_pack).toFixed(4)}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => handleDeleteComp(comp.id)} className="text-xs text-red-400 px-2 py-1 rounded-lg hover:bg-red-500/10 transition-colors">Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Usage Calculator */}
        <div className="bg-white border border-[#E4E6EE] rounded-2xl p-5">
          <h3 className="text-[#1A1D2E] font-semibold mb-3">Usage Calculator</h3>
          <div className="flex items-center gap-3 mb-4">
            <span className="text-[#9898A8] text-sm">If I produce</span>
            <input
              type="number"
              min={0}
              value={calcQty}
              onChange={e => setCalcQty(parseInt(e.target.value) || 0)}
              className="w-28 bg-white border border-[#E4E6EE] rounded-xl px-3 py-2 text-[#1A1D2E] text-sm text-center focus:outline-none focus:border-[#0071CE]"
            />
            <span className="text-[#9898A8] text-sm">SRPs of {selectedSku}, I need:</span>
          </div>
          {calcQty > 0 && (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[#E4E6EE]">
                {['Component', 'Type', 'Qty Needed'].map(h => (
                  <th key={h} className="text-left text-xs font-medium text-[#5A5A6A] uppercase tracking-wider pb-2">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {bomForSku.map(comp => {
                  const needed = Math.ceil(comp.quantity_per_srp * calcQty)
                  return (
                    <tr key={comp.id} className="border-b border-[#E4E6EE]/30 last:border-0">
                      <td className="py-2">
                        <p className="text-[#1A1D2E] text-xs font-semibold">{comp.component_sku}</p>
                        <p className="text-[#5A5A6A] text-xs">{comp.component_name}</p>
                      </td>
                      <td className="py-2"><span className={typeBadge(comp.component_type)}>{comp.component_type}</span></td>
                      <td className="py-2 text-[#1A1D2E] font-bold text-sm">{fmt(needed)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── AI INSIGHTS TAB ──────────────────────────────────────────────────────────

function AiInsightsTab({ showToast }: { showToast: (msg: string, type: 'success' | 'error') => void }) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<any>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [actioned, setActioned] = useState<Set<number>>(new Set())

  async function generateInsights() {
    setLoading(true)
    try {
      const res = await fetch('/api/walmart/insights', { method: 'POST' })
      const json = await res.json()
      if (json.ok) {
        setData(json.data)
        setGeneratedAt(json.generated_at)
        setActioned(new Set())
      } else {
        showToast('AI analysis failed: ' + (json.error ?? 'Unknown error'), 'error')
      }
    } catch (e: any) {
      showToast('Failed to connect to AI: ' + e.message, 'error')
    }
    setLoading(false)
  }

  const urgencyBadge = (urgency: string) => {
    const map: Record<string, string> = {
      critical: 'bg-red-500/15 text-red-400 border-red-500/30 animate-pulse',
      low: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
      ok: 'bg-[#0071CE]/15 text-[#0071CE] border-[#0071CE]/25',
      good: 'bg-[#00C896]/15 text-[#00C896] border-[#00C896]/25',
    }
    return `inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium border ${map[urgency] ?? map.ok}`
  }

  const trendColor = (trend: string) => trend === 'improving' ? 'text-[#00C896]' : trend === 'declining' ? 'text-red-400' : 'text-amber-400'
  const trendArrow = (trend: string) => trend === 'improving' ? '↑' : trend === 'declining' ? '↓' : '→'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[#1A1D2E] font-bold text-lg">AI Supply Chain Insights</h2>
          {generatedAt && <p className="text-[#5A5A6A] text-xs mt-0.5">Generated {new Date(generatedAt).toLocaleString()}</p>}
        </div>
        <button
          onClick={generateInsights}
          disabled={loading}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0071CE] text-[#1A1D2E] text-sm font-semibold hover:bg-[#0071CE]/80 transition-all disabled:opacity-60"
        >
          {loading ? <><Spinner /> Analyzing...</> : '🤖 Generate AI Insights'}
        </button>
      </div>

      {!data && !loading && (
        <div className="bg-white border border-[#E4E6EE] rounded-2xl p-16 text-center">
          <div className="text-4xl mb-4">🤖</div>
          <h3 className="text-[#1A1D2E] font-semibold mb-2">AI Analysis Ready</h3>
          <p className="text-[#5A5A6A] text-sm">Click &quot;Generate AI Insights&quot; to analyze your production data with Claude AI</p>
        </div>
      )}

      {loading && (
        <div className="bg-white border border-[#E4E6EE] rounded-2xl p-16 text-center">
          <div className="flex items-center justify-center mb-4"><Spinner /></div>
          <p className="text-[#9898A8] text-sm">Claude is analyzing your production data...</p>
        </div>
      )}

      {data && !loading && (
        <>
          {/* Run Rate & Forecast */}
          {data.run_rate && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-white border border-[#E4E6EE] rounded-2xl p-4">
                <p className="text-[#5A5A6A] text-xs mb-1">Daily Avg SRPs</p>
                <p className="text-[#0071CE] text-2xl font-bold">{fmt(data.run_rate.daily_avg_srps)}</p>
              </div>
              <div className="bg-white border border-[#E4E6EE] rounded-2xl p-4">
                <p className="text-[#5A5A6A] text-xs mb-1">Weekly Avg SRPs</p>
                <p className="text-[#00C896] text-2xl font-bold">{fmt(data.run_rate.weekly_avg_srps)}</p>
              </div>
              <div className="bg-white border border-[#E4E6EE] rounded-2xl p-4">
                <p className="text-[#5A5A6A] text-xs mb-1">Trend</p>
                <p className={`text-2xl font-bold ${trendColor(data.run_rate.trend)}`}>
                  {trendArrow(data.run_rate.trend)} {data.run_rate.trend_pct > 0 ? '+' : ''}{data.run_rate.trend_pct}%
                </p>
                <p className="text-[#5A5A6A] text-xs capitalize">{data.run_rate.trend}</p>
              </div>
              <div className="bg-white border border-[#E4E6EE] rounded-2xl p-4">
                <p className="text-[#5A5A6A] text-xs mb-1">Confidence</p>
                <p className={`text-2xl font-bold capitalize ${data.forecast?.confidence === 'high' ? 'text-[#00C896]' : data.forecast?.confidence === 'medium' ? 'text-amber-400' : 'text-red-400'}`}>
                  {data.forecast?.confidence ?? '—'}
                </p>
              </div>
            </div>
          )}

          {/* Forecast */}
          {data.forecast && (
            <div className="bg-white border border-[#E4E6EE] rounded-2xl p-5">
              <h3 className="text-[#1A1D2E] font-semibold mb-4">Production Forecast</h3>
              <div className="space-y-3">
                {[{ label: 'Next 30 Days', val: data.forecast.next_30_days_srps, pct: 33 },
                  { label: 'Next 60 Days', val: data.forecast.next_60_days_srps, pct: 66 },
                  { label: 'Next 90 Days', val: data.forecast.next_90_days_srps, pct: 100 }].map(({ label, val, pct }) => (
                  <div key={label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[#9898A8] text-xs">{label}</span>
                      <span className="text-[#1A1D2E] text-xs font-semibold">{fmt(val)} SRPs</span>
                    </div>
                    <div className="h-2 bg-white rounded-full">
                      <div className="h-2 bg-[#0071CE] rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SKU Analysis */}
          {data.sku_analysis && data.sku_analysis.length > 0 && (
            <div className="bg-white border border-[#E4E6EE] rounded-2xl overflow-x-auto">
              <div className="px-5 py-3 border-b border-[#E4E6EE]">
                <h3 className="text-[#1A1D2E] font-semibold">SKU Analysis</h3>
              </div>
              <table className="w-full text-sm min-w-[700px]">
                <thead><tr className="border-b border-[#E4E6EE]">
                  {['SKU', 'Weeks Coverage', 'Urgency', 'Weekly Target', 'AI Insight'].map(h => (
                    <th key={h} className="text-left text-xs font-medium text-[#5A5A6A] uppercase tracking-wider py-3 px-4">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {data.sku_analysis.map((row: any) => (
                    <tr key={row.sku} className="border-b border-[#E4E6EE]/50 last:border-0 hover:bg-[#F5F6FA]/50">
                      <td className="px-4 py-3 font-mono text-xs text-[#0071CE] font-bold">{row.sku}</td>
                      <td className="px-4 py-3 text-[#1A1D2E] text-xs font-semibold">{row.weeks_coverage}w</td>
                      <td className="px-4 py-3"><span className={urgencyBadge(row.urgency)}>{row.urgency}</span></td>
                      <td className="px-4 py-3 text-[#1A1D2E] text-xs">{fmt(row.recommended_weekly_target)} SRPs/wk</td>
                      <td className="px-4 py-3 text-[#9898A8] text-xs max-w-xs">{row.insight}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Alerts */}
          {data.alerts && data.alerts.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-[#1A1D2E] font-semibold">Alerts</h3>
              {data.alerts.map((alert: string, i: number) => (
                <div key={i} className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                  <span className="text-red-400 mt-0.5">⚠</span>
                  <p className="text-red-300 text-sm">{alert}</p>
                </div>
              ))}
            </div>
          )}

          {/* Recommendations */}
          {data.recommendations && data.recommendations.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-[#1A1D2E] font-semibold">Recommendations</h3>
              {data.recommendations.map((rec: string, i: number) => (
                <div key={i} className={`flex items-start gap-3 border rounded-xl px-4 py-3 transition-all ${actioned.has(i) ? 'bg-[#00C896]/5 border-[#00C896]/20 opacity-60' : 'bg-[#00C896]/10 border-[#00C896]/20'}`}>
                  <input
                    type="checkbox"
                    checked={actioned.has(i)}
                    onChange={() => setActioned(prev => { const n = new Set(prev); if (n.has(i)) { n.delete(i) } else { n.add(i) } return n })}
                    className="mt-0.5 accent-[#00C896]"
                  />
                  <p className={`text-sm ${actioned.has(i) ? 'line-through text-[#5A5A6A]' : 'text-[#00C896]'}`}>{rec}</p>
                </div>
              ))}
            </div>
          )}

          {/* Performance Summary */}
          {data.performance_summary && (
            <div className="bg-white border border-[#E4E6EE] rounded-2xl p-5">
              <h3 className="text-[#1A1D2E] font-semibold mb-3">Performance Summary</h3>
              <p className="text-[#9898A8] text-sm leading-relaxed">{data.performance_summary}</p>
            </div>
          )}

          {/* Packaging Analysis */}
          {data.packaging_analysis && (
            <div className="bg-white border border-[#E4E6EE] rounded-2xl p-5">
              <h3 className="text-[#1A1D2E] font-semibold mb-3">Packaging Analysis</h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-[#5A5A6A] text-xs mb-1">Tightest Component</p>
                  <p className="text-amber-400 font-mono text-sm font-bold">{data.packaging_analysis.tightest_component}</p>
                </div>
                <div>
                  <p className="text-[#5A5A6A] text-xs mb-1">Days Remaining</p>
                  <p className={`text-sm font-bold ${data.packaging_analysis.days_remaining < 15 ? 'text-red-400' : data.packaging_analysis.days_remaining < 30 ? 'text-amber-400' : 'text-[#00C896]'}`}>
                    {data.packaging_analysis.days_remaining} days
                  </p>
                </div>
                <div>
                  <p className="text-[#5A5A6A] text-xs mb-1">Burn Rate/Day</p>
                  <p className="text-[#1A1D2E] text-sm font-bold">{fmt(data.packaging_analysis.burn_rate_per_day)}</p>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function WalmartPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [tab, setTab] = useState<Tab>('dashboard')
  const [production, setProduction] = useState<WalmartProduction[]>([])
  const [inventory, setInventory] = useState<WalmartInventory[]>([])
  const [orders, setOrders] = useState<WalmartOrder[]>([])
  const [bom, setBom] = useState<WalmartBom[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [userEmail, setUserEmail] = useState('')
  const toastClearRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((msg: string, type: 'success' | 'error') => {
    if (toastClearRef.current) clearTimeout(toastClearRef.current)
    setToast({ msg, type })
    toastClearRef.current = setTimeout(() => setToast(null), 4500)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90)
    const cutoffStr = cutoff.toISOString().slice(0, 10)

    const [prodRes, invRes, ordRes, bomRes] = await Promise.all([
      sb.from('walmart_production').select('*').gte('production_date', cutoffStr).order('production_date', { ascending: true }),
      sb.from('walmart_inventory').select('*'),
      sb.from('walmart_orders').select('*').order('created_at', { ascending: false }),
      sb.from('walmart_bom').select('*').order('finished_sku'),
    ])

    setProduction((prodRes.data ?? []) as WalmartProduction[])
    setInventory((invRes.data ?? []) as WalmartInventory[])
    setOrders((ordRes.data ?? []) as WalmartOrder[])
    setBom((bomRes.data ?? []) as WalmartBom[])
    setLoading(false)
  }, [sb])

  useEffect(() => {
    load()
    sb.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email) })
  }, [load, sb])

  // Realtime subscription
  useEffect(() => {
    const channel = sb.channel('walmart-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'walmart_production' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'walmart_inventory' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'walmart_orders' }, () => load())
      .subscribe()
    return () => { sb.removeChannel(channel) }
  }, [sb, load])

  const openOrderCount = orders.filter(o => o.status === 'Open').length

  const tabs = [
    { id: 'dashboard' as Tab, label: 'Dashboard', icon: '📊' },
    { id: 'production' as Tab, label: 'Log Production', icon: '🏭' },
    { id: 'inventory' as Tab, label: 'Inventory', icon: '📦' },
    { id: 'orders' as Tab, label: 'Orders', icon: '📋', badge: openOrderCount },
    { id: 'bom' as Tab, label: 'BOM', icon: '🔧' },
    { id: 'ai' as Tab, label: 'AI Insights', icon: '🤖' },
    { id: 'comments' as Tab, label: 'Comments', icon: '💬' },
  ]

  return (
    <div className="min-h-screen bg-[#F9FAFB] p-5 md:p-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-[#0071CE]/20 text-[#0071CE] border-[#0071CE]/30">WALMART PORTAL</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5 tracking-tight" style={{ color: '#0071CE' }}>
            Walmart Production Portal
          </h1>
          <p className="text-[#5A5A6A] text-sm mt-0.5">SRP tracking · BOM · Inventory · AI Analytics</p>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-2 bg-white border border-[#E4E6EE] text-[#9898A8] hover:text-[#1A1D2E] text-sm px-4 py-2.5 rounded-xl transition-all self-start disabled:opacity-50">
          {loading ? <Spinner /> : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          )}
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 mb-6 bg-white border border-[#E4E6EE] rounded-2xl p-1.5">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all relative ${tab === t.id ? 'bg-[#0071CE] text-white' : 'text-[#9898A8] hover:text-gray-700 hover:bg-[#F5F6FA]'}`}
          >
            <span>{t.icon}</span>
            <span className="hidden sm:inline">{t.label}</span>
            {t.badge != null && t.badge > 0 && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-0.5 ${tab === t.id ? 'bg-white/20 text-white' : 'bg-amber-500/20 text-amber-400'}`}>{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {loading && tab !== 'ai' ? (
        <div className="flex items-center justify-center py-24"><Spinner /></div>
      ) : (
        <>
          {tab === 'dashboard' && <DashboardTab production={production} inventory={inventory} orders={orders} />}
          {tab === 'production' && <ProductionTab inventory={inventory} onRefresh={load} showToast={showToast} />}
          {tab === 'inventory' && <InventoryTab inventory={inventory} production={production} onRefresh={load} showToast={showToast} />}
          {tab === 'orders' && <OrdersTab inventory={inventory} orders={orders} onRefresh={load} showToast={showToast} />}
          {tab === 'bom' && <BomTab bom={bom} onRefresh={load} showToast={showToast} />}
          {tab === 'ai' && <AiInsightsTab showToast={showToast} />}
          {tab === 'comments' && (
            <div className="bg-white border border-[#E4E6EE] rounded-2xl p-6">
              <Comments recordId="walmart-portal" recordType="walmart_order" currentUserEmail={userEmail} title="Walmart Portal Comments"/>
            </div>
          )}
        </>
      )}

      {/* Toast */}
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
