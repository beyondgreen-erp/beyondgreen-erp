'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const WALMART_SKUS = [
  { sku: '22GVF24', name: 'GreenVet Fly 24oz', target: 5000 },
  { sku: '22GVS24', name: 'GreenVet Shampoo 24oz', target: 5000 },
  { sku: '22GVA24', name: 'GreenVet All-Purpose 24oz', target: 2000 },
  { sku: '22GVF48', name: 'GreenVet Fly 48oz', target: 3000 },
  { sku: '22GVS48', name: 'GreenVet Shampoo 48oz', target: 3000 },
  { sku: '22GVA48', name: 'GreenVet All-Purpose 48oz', target: 1500 },
  { sku: '22GVK48', name: 'GreenVet Kennel Kit 48oz', target: 500 },
]

const PKG_SKUS = ['22GVF24-P','22GVS24-P','22GVA24-P','22GVF48-P','22GVS48-P','22GVA48-P','22GVK48-P']

interface SalesOrder {
  id: string
  order_number: string | null
  customer_po: string | null
  order_date: string | null
  ship_date: string | null
  status: string | null
  total_value: number | null
}

interface Shipment {
  id: string
  ship_date: string | null
  customer_po: string | null
  tracking_number: string | null
  carrier: string | null
  total_amount: number | null
  delivery_status: string | null
}

interface StockItem {
  sku: string
  name: string
  target: number
  on_hand: number
}

interface PkgItem {
  sku: string
  name: string
  on_hand: number
  daily_usage: number
}

const fmt = (n: number) => n.toLocaleString()
const fmtMoney = (n: number) => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

function daysDiff(dateStr: string | null): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr + 'T00:00:00')
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - now.getTime()) / 86400000)
}

function StatusBadge({ status }: { status: string | null }) {
  const s = status ?? ''
  const cls = s === 'Shipped' || s === 'Delivered'
    ? 'bg-[#00C89615] text-[#00C896] border-[#00C89630]'
    : s === 'Ready to Ship'
    ? 'bg-blue-500/15 text-blue-400 border-blue-500/25'
    : s === 'New' || s === 'In Progress'
    ? 'bg-amber-500/15 text-amber-400 border-amber-500/25'
    : 'bg-[#2A2A35] text-[#9898A8] border-[#3A3A45]'
  return <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium border ${cls}`}>{s || '—'}</span>
}

export default function WalmartPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [orders, setOrders] = useState<SalesOrder[]>([])
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [stock, setStock] = useState<StockItem[]>([])
  const [packaging, setPackaging] = useState<PkgItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [ordRes, shipRes, prodRes, pkgRes] = await Promise.all([
        sb.from('sales_orders').select('id,order_number,customer_po,order_date,ship_date,status,total_value').ilike('customer_name', '%walmart%').order('order_date', { ascending: false }),
        sb.from('shipments').select('id,ship_date,customer_po,tracking_number,carrier,total_amount,delivery_status').ilike('customer_name', '%walmart%').order('ship_date', { ascending: false }).limit(20),
        sb.from('products').select('sku,product_name,on_hand_qty').in('sku', WALMART_SKUS.map(s => s.sku)),
        sb.from('products').select('sku,product_name,on_hand_qty').in('sku', PKG_SKUS),
      ])

      setOrders(ordRes.data ?? [])
      setShipments(shipRes.data ?? [])

      const prodMap = Object.fromEntries((prodRes.data ?? []).map((p: any) => [p.sku, p]))
      setStock(WALMART_SKUS.map(s => ({
        sku: s.sku,
        name: s.name,
        target: s.target,
        on_hand: Number(prodMap[s.sku]?.on_hand_qty ?? 0),
      })))

      const pkgData = pkgRes.data ?? []
      setPackaging(pkgData.map((p: any) => ({
        sku: p.sku,
        name: p.product_name ?? p.sku,
        on_hand: Number(p.on_hand_qty ?? 0),
        daily_usage: 50,
      })))
    } catch (e: any) {
      setError(e.message)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, []) // eslint-disable-line

  const openOrders = orders.filter(o => !['Shipped', 'Delivered', 'Cancelled'].includes(o.status ?? ''))
  const mtdShipments = shipments.filter(s => s.ship_date?.startsWith(new Date().toISOString().slice(0, 7)) ?? false)
  const mtdRevenue = mtdShipments.reduce((sum, s) => sum + (s.total_amount ?? 0), 0)
  const onTimePct = shipments.length > 0
    ? Math.round(shipments.filter(s => s.delivery_status === 'Delivered').length / shipments.length * 100)
    : 0

  const stats = [
    { label: 'Open Orders', value: fmt(openOrders.length), color: 'text-amber-400' },
    { label: 'MTD Shipments', value: fmt(mtdShipments.length), color: 'text-[#00C896]' },
    { label: 'MTD Revenue', value: fmtMoney(mtdRevenue), color: 'text-[#00C896]' },
    { label: 'On-Time %', value: `${onTimePct}%`, color: onTimePct >= 95 ? 'text-[#00C896]' : onTimePct >= 80 ? 'text-amber-400' : 'text-red-400' },
  ]

  return (
    <div className="p-5 md:p-8 min-h-screen space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-blue-500/20 text-blue-300 border-blue-500/30">RETAIL PORTAL</span>
          <h1 className="text-2xl font-bold text-white mt-1.5 tracking-tight">Walmart Operations Center</h1>
          <p className="text-[#5A5A6A] text-sm mt-0.5">Live Walmart order & inventory management</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 bg-[#18181C] border border-[#2A2A35] text-[#9898A8] hover:text-white text-sm px-4 py-2.5 rounded-xl transition-all self-start">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-red-400 text-sm">{error}</div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map(s => (
          <div key={s.label} className="bg-[#111113] border border-[#2A2A35] rounded-2xl p-4">
            <p className={`text-2xl font-bold ${s.color}`}>{loading ? '—' : s.value}</p>
            <p className="text-[#5A5A6A] text-xs mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Open Orders */}
      <section>
        <h2 className="text-white font-semibold mb-3 flex items-center gap-2">
          <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
          Open Orders
          <span className="ml-1 text-xs bg-amber-500/15 text-amber-400 border border-amber-500/25 px-2 py-0.5 rounded-full">{openOrders.length}</span>
        </h2>
        <div className="bg-[#111113] border border-[#2A2A35] rounded-2xl overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16"><svg className="w-5 h-5 animate-spin text-[#3A3A45]" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div>
          ) : openOrders.length === 0 ? (
            <div className="text-center py-16 text-[#5A5A6A] text-sm">No open Walmart orders</div>
          ) : (
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="border-b border-[#2A2A35]">
                  {['Order #','PO #','Order Date','Ship Date','Status','Days Until Ship','Value'].map(h => (
                    <th key={h} className="text-left text-xs font-medium text-[#5A5A6A] uppercase tracking-wider py-3 px-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {openOrders.map((o, i) => {
                  const days = daysDiff(o.ship_date)
                  const urgency = days != null && days < 0 ? 'text-red-400' : days != null && days < 3 ? 'text-amber-400' : 'text-white'
                  const rowBg = days != null && days < 0 ? 'bg-red-500/5' : days != null && days < 3 ? 'bg-amber-500/5' : i % 2 === 1 ? 'bg-[#18181C]/30' : ''
                  return (
                    <tr key={o.id} className={`border-b border-[#2A2A35]/60 last:border-0 ${rowBg}`}>
                      <td className="px-4 py-3 text-[#00C896] font-mono text-xs">{o.order_number ?? '—'}</td>
                      <td className="px-4 py-3 text-white text-xs">{o.customer_po ?? '—'}</td>
                      <td className="px-4 py-3 text-[#9898A8] text-xs">{o.order_date ? new Date(o.order_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}</td>
                      <td className={`px-4 py-3 text-xs font-medium ${urgency}`}>{o.ship_date ? new Date(o.ship_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}</td>
                      <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
                      <td className={`px-4 py-3 text-xs font-semibold ${urgency}`}>
                        {days == null ? '—' : days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Today' : `${days}d`}
                      </td>
                      <td className="px-4 py-3 text-white text-xs">{o.total_value != null ? fmtMoney(o.total_value) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Safety Stock */}
      <section>
        <h2 className="text-white font-semibold mb-3 flex items-center gap-2">
          <svg className="w-4 h-4 text-[#00C896]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
          Safety Stock Monitor
        </h2>
        <div className="bg-[#111113] border border-[#2A2A35] rounded-2xl overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-[#2A2A35]">
                {['SKU','Product','On Hand','Target','% of Target','Status'].map(h => (
                  <th key={h} className="text-left text-xs font-medium text-[#5A5A6A] uppercase tracking-wider py-3 px-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stock.map((s, i) => {
                const pct = s.target > 0 ? Math.round(s.on_hand / s.target * 100) : 0
                const statusLabel = pct >= 80 ? 'OK' : pct >= 40 ? 'Low' : 'Critical'
                const statusCls = pct >= 80 ? 'bg-[#00C89615] text-[#00C896] border-[#00C89630]' : pct >= 40 ? 'bg-amber-500/15 text-amber-400 border-amber-500/25' : 'bg-red-500/15 text-red-400 border-red-500/25'
                const barCls = pct >= 80 ? 'bg-[#00C896]' : pct >= 40 ? 'bg-amber-400' : 'bg-red-400'
                return (
                  <tr key={s.sku} className={`border-b border-[#2A2A35]/60 last:border-0 ${i % 2 === 1 ? 'bg-[#18181C]/30' : ''}`}>
                    <td className="px-4 py-3 text-[#00C896] font-mono text-xs">{s.sku}</td>
                    <td className="px-4 py-3 text-white text-xs">{s.name}</td>
                    <td className="px-4 py-3 text-white text-xs font-semibold">{loading ? '—' : fmt(s.on_hand)}</td>
                    <td className="px-4 py-3 text-[#9898A8] text-xs">{fmt(s.target)}</td>
                    <td className="px-4 py-3 min-w-[140px]">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-[#1E1E24] rounded-full h-1.5">
                          <div className={`h-1.5 rounded-full transition-all ${barCls}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                        </div>
                        <span className="text-xs text-[#9898A8] w-10 text-right">{loading ? '—' : `${pct}%`}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium border ${statusCls}`}>{statusLabel}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Recent Shipments */}
      <section>
        <h2 className="text-white font-semibold mb-3 flex items-center gap-2">
          <svg className="w-4 h-4 text-[#00C896]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" /></svg>
          Recent Shipments
        </h2>
        <div className="bg-[#111113] border border-[#2A2A35] rounded-2xl overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12"><svg className="w-5 h-5 animate-spin text-[#3A3A45]" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div>
          ) : shipments.length === 0 ? (
            <div className="text-center py-12 text-[#5A5A6A] text-sm">No Walmart shipments found</div>
          ) : (
            <table className="w-full min-w-[600px] text-sm">
              <thead>
                <tr className="border-b border-[#2A2A35]">
                  {['Date','PO #','Tracking','Carrier','Amount','Status'].map(h => (
                    <th key={h} className="text-left text-xs font-medium text-[#5A5A6A] uppercase tracking-wider py-3 px-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shipments.map((s, i) => (
                  <tr key={s.id} className={`border-b border-[#2A2A35]/60 last:border-0 ${i % 2 === 1 ? 'bg-[#18181C]/30' : ''}`}>
                    <td className="px-4 py-3 text-[#9898A8] text-xs">{s.ship_date ? new Date(s.ship_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}</td>
                    <td className="px-4 py-3 text-white text-xs">{s.customer_po ?? '—'}</td>
                    <td className="px-4 py-3 text-[#00C896] font-mono text-xs">{s.tracking_number ?? '—'}</td>
                    <td className="px-4 py-3 text-[#9898A8] text-xs">{s.carrier ?? '—'}</td>
                    <td className="px-4 py-3 text-white text-xs">{s.total_amount != null ? fmtMoney(s.total_amount) : '—'}</td>
                    <td className="px-4 py-3"><StatusBadge status={s.delivery_status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Packaging Burn Rate */}
      {packaging.length > 0 && (
        <section>
          <h2 className="text-white font-semibold mb-3 flex items-center gap-2">
            <svg className="w-4 h-4 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
            Packaging Burn Rate
          </h2>
          <div className="bg-[#111113] border border-[#2A2A35] rounded-2xl overflow-x-auto">
            <table className="w-full min-w-[500px] text-sm">
              <thead>
                <tr className="border-b border-[#2A2A35]">
                  {['SKU','Product','On Hand','Est. Daily Usage','Days Remaining'].map(h => (
                    <th key={h} className="text-left text-xs font-medium text-[#5A5A6A] uppercase tracking-wider py-3 px-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {packaging.map((p, i) => {
                  const days = p.daily_usage > 0 ? Math.round(p.on_hand / p.daily_usage) : null
                  const dayCls = days == null ? 'text-[#9898A8]' : days < 7 ? 'text-red-400 font-semibold' : days < 30 ? 'text-amber-400' : 'text-[#00C896]'
                  return (
                    <tr key={p.sku} className={`border-b border-[#2A2A35]/60 last:border-0 ${i % 2 === 1 ? 'bg-[#18181C]/30' : ''}`}>
                      <td className="px-4 py-3 text-[#00C896] font-mono text-xs">{p.sku}</td>
                      <td className="px-4 py-3 text-white text-xs">{p.name}</td>
                      <td className="px-4 py-3 text-white text-xs">{fmt(p.on_hand)}</td>
                      <td className="px-4 py-3 text-[#9898A8] text-xs">{p.daily_usage}/day</td>
                      <td className={`px-4 py-3 text-xs ${dayCls}`}>{days == null ? '—' : `${days} days`}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
