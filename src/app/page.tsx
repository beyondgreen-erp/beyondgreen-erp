'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import RemindersWidget from '@/components/RemindersWidget'

interface KPI { openOrders: number; revenueMTD: number; shipmentsMTD: number; invoicesDue: number; openTasks: number; lowStock: number; openWorkOrders: number; overdueInvoices: number; overdueAmount: number; totalCustomers: number }
const INIT: KPI = { openOrders:0, revenueMTD:0, shipmentsMTD:0, invoicesDue:0, openTasks:0, lowStock:0, openWorkOrders:0, overdueInvoices:0, overdueAmount:0, totalCustomers:0 }

const fmt$ = (n: number) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n)
const fmtD = (d: string|null|undefined) => d ? new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '—'

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

const STATUS_PIPELINE = [
  { label: 'New', color: '#3B82F6', href: '/sales/orders' },
  { label: 'In Production', color: '#F59E0B', href: '/production' },
  { label: 'QC', color: '#8B5CF6', href: '/production/qc' },
  { label: 'Ready to Ship', color: '#F97316', href: '/sales/shipping-queue' },
  { label: 'Shipped', color: '#14B8A6', href: '/sales/shipments' },
  { label: 'Invoiced', color: '#00C896', href: '/sales/invoices' },
]

function SkeletonRow() {
  return (
    <div className="flex gap-3 items-center px-5 py-3 border-b border-[#1E1E24] last:border-0">
      <div className="skeleton h-2.5 w-20 rounded" />
      <div className="skeleton h-2.5 w-28 rounded" />
      <div className="skeleton h-2.5 w-12 rounded ml-auto" />
    </div>
  )
}

interface KpiCardProps { label: string; value: string | number; icon: string; iconColor: string; iconBg: string; href: string; alert?: boolean }
function KpiCard({ label, value, icon, iconColor, iconBg, href, alert }: KpiCardProps) {
  return (
    <Link href={href} className="stat-card bg-[#111113] border border-[#2A2A35] rounded-2xl p-5 hover:border-[#3A3A45] transition-all group cursor-pointer block">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${iconBg}`}>
          <svg className={`${iconColor}`} style={{width:'18px',height:'18px'}} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={icon} />
          </svg>
        </div>
        {alert && <span className="w-2 h-2 rounded-full bg-red-500 alert-pulse mt-1" />}
      </div>
      <p className={`text-2xl font-bold tracking-tight ${alert ? 'text-red-400' : 'text-white'} group-hover:text-[#00C896] transition-colors`}>{value}</p>
      <p className="text-[#5A5A6A] text-xs mt-1">{label}</p>
    </Link>
  )
}

const SO_STATUS: Record<string,string> = {
  New:'bg-blue-500/15 text-blue-400 border-blue-500/25',
  'In Production':'bg-amber-500/15 text-amber-400 border-amber-500/25',
  'QC':'bg-violet-500/15 text-violet-400 border-violet-500/25',
  'Ready to Ship':'bg-orange-500/15 text-orange-400 border-orange-500/25',
  Shipped:'bg-teal-500/15 text-teal-400 border-teal-500/25',
  Invoiced:'bg-[#00C89615] text-[#00C896] border-[#00C89630]',
  Closed:'bg-gray-700/30 text-gray-500 border-gray-700',
}

export default function DashboardPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [loading, setLoading] = useState(true)
  const [kpi, setKpi] = useState<KPI>(INIT)
  const [recentOrders, setRecentOrders] = useState<any[]>([])
  const [recentTasks, setRecentTasks] = useState<any[]>([])
  const [overdueInvoiceList, setOverdueInvoiceList] = useState<any[]>([])
  const [pipelineCounts, setPipelineCounts] = useState<Record<string,number>>({})
  const [userName, setUserName] = useState('there')
  const today = new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) {
        supabase.from('user_profiles').select('full_name').eq('email', data.user.email).single()
          .then(({ data: p }) => { if (p?.full_name) setUserName(p.full_name.split(' ')[0]) })
      }
    })
    loadData()
  }, []) // eslint-disable-line

  async function loadData() {
    setLoading(true)
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10)
    const todayStr = now.toISOString().slice(0,10)

    try {
      const [
        ordersRes, shipmentsCountRes, invoicesRes, tasksRes,
        productsRes, workOrdersRes, customersRes,
        recentOrdersRes, recentTasksRes, overdueRes, pipelineRes,
      ] = await Promise.all([
        supabase.from('sales_orders').select('id,status').not('status','in','("Closed","Cancelled")'),
        supabase.from('shipments').select('id',{count:'exact',head:true}).gte('ship_date', monthStart),
        supabase.from('invoices').select('id,status,total_amount,due_date').not('status','in','("paid","void")'),
        supabase.from('tasks').select('id',{count:'exact',head:true}).not('status','in','("Done","Cancelled")'),
        supabase.from('products').select('id,stock_qty,reorder_point'),
        supabase.from('work_orders').select('id',{count:'exact',head:true}).not('status','in','("Complete","Cancelled")'),
        supabase.from('customers').select('id',{count:'exact',head:true}),
        supabase.from('sales_orders').select('id,order_number,status,total,created_at,customer_id,customers(company_name)').order('created_at',{ascending:false}).limit(5),
        supabase.from('tasks').select('id,title,status,due_date,assigned_to').order('created_at',{ascending:false}).limit(5),
        supabase.from('invoices').select('id,invoice_number_display,total_amount,due_date,customers(company_name)').in('status',['overdue','pending']).lte('due_date', todayStr).order('due_date').limit(5),
        supabase.from('sales_orders').select('status').not('status','in','("Closed","Cancelled")'),
      ])

      const orders = ordersRes.data ?? []
      const invs = invoicesRes.data ?? []
      const prods = productsRes.data ?? []

      const overdueInvs = invs.filter(i => i.status === 'overdue' || (i.due_date && i.due_date < todayStr))
      const invoicesDue = invs.filter(i => ['pending','partial','overdue'].includes(i.status)).length
      const lowStock = prods.filter(p => p.reorder_point != null && (p.stock_qty ?? 0) <= p.reorder_point).length

      const paidRes = await supabase.from('invoices').select('total_amount').eq('status','paid').gte('invoice_date', monthStart)
      const revenueMTD = (paidRes.data ?? []).reduce((a,r) => a + (r.total_amount ?? 0), 0)

      const pipeline: Record<string,number> = {}
      for (const o of orders) pipeline[o.status] = (pipeline[o.status] ?? 0) + 1
      for (const o of (pipelineRes.data ?? [])) pipeline[o.status] = (pipeline[o.status] ?? 0)

      setKpi({
        openOrders: orders.length,
        revenueMTD,
        shipmentsMTD: shipmentsCountRes.count ?? 0,
        invoicesDue,
        openTasks: tasksRes.count ?? 0,
        lowStock,
        openWorkOrders: workOrdersRes.count ?? 0,
        overdueInvoices: overdueInvs.length,
        overdueAmount: overdueInvs.reduce((a,r) => a + (r.total_amount ?? 0), 0),
        totalCustomers: customersRes.count ?? 0,
      })
      setPipelineCounts(pipeline)
      setRecentOrders(recentOrdersRes.data ?? [])
      setRecentTasks(recentTasksRes.data ?? [])
      setOverdueInvoiceList(overdueRes.data ?? [])
    } catch { /* ignore */ }
    setLoading(false)
  }

  const kpiCards: KpiCardProps[] = [
    { label: 'Open Orders', value: kpi.openOrders, href: '/sales/orders', icon: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z', iconColor: 'text-blue-400', iconBg: 'bg-blue-500/15' },
    { label: 'Revenue MTD', value: fmt$(kpi.revenueMTD), href: '/sales/invoices', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 8v1m0-9V5m0 12v2m6-2a9 9 0 11-18 0 9 9 0 0118 0z', iconColor: 'text-[#00C896]', iconBg: 'bg-[#00C89615]' },
    { label: 'Shipping Queue', value: pipelineCounts['Ready to Ship'] ?? 0, href: '/sales/shipping-queue', icon: 'M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0', iconColor: 'text-teal-400', iconBg: 'bg-teal-500/15', alert: (pipelineCounts['Ready to Ship'] ?? 0) > 0 },
    { label: 'Overdue Invoices', value: kpi.overdueInvoices, href: '/sales/invoices', icon: 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z', iconColor: kpi.overdueInvoices > 0 ? 'text-red-400' : 'text-[#5A5A6A]', iconBg: kpi.overdueInvoices > 0 ? 'bg-red-500/15' : 'bg-[#1E1E24]', alert: kpi.overdueInvoices > 0 },
    { label: 'Invoices Due', value: kpi.invoicesDue, href: '/sales/invoices', icon: 'M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z', iconColor: 'text-amber-400', iconBg: 'bg-amber-500/15' },
    { label: 'Open Tasks', value: kpi.openTasks, href: '/bizdev/tasks', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4', iconColor: 'text-violet-400', iconBg: 'bg-violet-500/15' },
    { label: 'Low Stock Items', value: kpi.lowStock, href: '/sales/inventory', icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4', iconColor: kpi.lowStock > 0 ? 'text-orange-400' : 'text-[#5A5A6A]', iconBg: kpi.lowStock > 0 ? 'bg-orange-500/15' : 'bg-[#1E1E24]', alert: kpi.lowStock > 0 },
    { label: 'Active Work Orders', value: kpi.openWorkOrders, href: '/production', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z', iconColor: 'text-sky-400', iconBg: 'bg-sky-500/15' },
  ]

  return (
    <div className="p-5 md:p-8 space-y-6 max-w-[1600px] mx-auto">
      {/* Welcome bar */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">{greeting()}, {userName} 👋</h1>
          <p className="text-[#5A5A6A] text-sm mt-0.5">{today}</p>
        </div>
        <button onClick={loadData} className="p-2 rounded-xl bg-[#18181C] border border-[#2A2A35] text-[#5A5A6A] hover:text-white hover:bg-[#22222A] transition-all" title="Refresh">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2">
        <Link href="/sales/orders" className="flex items-center gap-1.5 bg-[#00C896] hover:bg-[#00B085] text-black font-semibold text-xs px-3.5 py-2 rounded-xl transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4"/></svg>
          New Order
        </Link>
        <Link href="/sales/quotations" className="flex items-center gap-1.5 bg-[#111113] border border-[#2A2A35] hover:border-[#3A3A45] text-gray-300 hover:text-white text-xs px-3.5 py-2 rounded-xl transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
          New Quote
        </Link>
        <Link href="/sales/shipping-queue" className="flex items-center gap-1.5 bg-[#111113] border border-[#2A2A35] hover:border-[#3A3A45] text-gray-300 hover:text-white text-xs px-3.5 py-2 rounded-xl transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1"/></svg>
          Shipping Queue
          {(pipelineCounts['Ready to Ship'] ?? 0) > 0 && (
            <span className="bg-teal-500/20 text-teal-400 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{pipelineCounts['Ready to Ship']}</span>
          )}
        </Link>
        <Link href="/sales/inventory" className="flex items-center gap-1.5 bg-[#111113] border border-[#2A2A35] hover:border-[#3A3A45] text-gray-300 hover:text-white text-xs px-3.5 py-2 rounded-xl transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
          Inventory
        </Link>
        <Link href="/production" className="flex items-center gap-1.5 bg-[#111113] border border-[#2A2A35] hover:border-[#3A3A45] text-gray-300 hover:text-white text-xs px-3.5 py-2 rounded-xl transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
          Production
        </Link>
      </div>

      {/* Alert banner */}
      {!loading && kpi.overdueInvoices > 0 && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl px-5 py-3.5 flex items-center gap-4">
          <span className="w-2 h-2 rounded-full bg-red-500 alert-pulse shrink-0" />
          <div className="flex-1">
            <span className="text-red-400 font-semibold text-sm">{kpi.overdueInvoices} overdue invoice{kpi.overdueInvoices !== 1 ? 's' : ''}</span>
            <span className="text-[#9898A8] text-sm"> — {fmt$(kpi.overdueAmount)} outstanding</span>
          </div>
          <Link href="/sales/invoices" className="text-xs text-red-400 hover:text-red-300 font-medium border border-red-500/30 px-3 py-1.5 rounded-lg transition-colors">View Invoices</Link>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {loading
          ? Array.from({length:8}).map((_,i) => <div key={i} className="skeleton h-[110px] rounded-2xl" />)
          : kpiCards.map(c => <KpiCard key={c.label} {...c} />)
        }
      </div>

      {/* Pipeline + Recent Orders */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Order Pipeline */}
        <div className="lg:col-span-3 bg-[#111113] border border-[#2A2A35] rounded-2xl p-5">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-white font-semibold">Order Pipeline</h2>
            <Link href="/sales/orders" className="text-xs text-[#00C896] hover:text-[#00B085] transition-colors">View all →</Link>
          </div>
          <div className="flex gap-2 items-end" style={{height:'120px'}}>
            {STATUS_PIPELINE.map(stage => {
              const count = pipelineCounts[stage.label] ?? 0
              const max = Math.max(...STATUS_PIPELINE.map(s => pipelineCounts[s.label] ?? 0), 1)
              const pct = count > 0 ? Math.max(8, Math.round((count / max) * 100)) : 4
              return (
                <Link key={stage.label} href={stage.href} className="flex-1 flex flex-col items-center gap-1.5 group cursor-pointer h-full">
                  <span className="text-white font-bold text-base group-hover:scale-110 transition-transform">{count}</span>
                  <div className="w-full flex-1 bg-[#1E1E24] rounded-lg overflow-hidden flex items-end">
                    <div className="w-full rounded-lg transition-all duration-700 group-hover:brightness-110" style={{ height: `${pct}%`, background: stage.color, opacity: 0.85 }} />
                  </div>
                  <span className="text-[10px] text-[#5A5A6A] group-hover:text-[#9898A8] transition-colors text-center leading-tight">{stage.label}</span>
                </Link>
              )
            })}
          </div>
        </div>

        {/* Recent Orders */}
        <div className="lg:col-span-2 bg-[#111113] border border-[#2A2A35] rounded-2xl">
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <h2 className="text-white font-semibold">Recent Orders</h2>
            <Link href="/sales/orders" className="text-xs text-[#00C896] hover:text-[#00B085] transition-colors">View all →</Link>
          </div>
          <div>
            {loading
              ? Array.from({length:5}).map((_,i) => <SkeletonRow key={i} />)
              : recentOrders.length === 0
                ? <p className="text-[#5A5A6A] text-sm py-8 text-center">No orders yet</p>
                : recentOrders.map(o => (
                  <Link key={o.id} href="/sales/orders" className="flex items-center gap-3 px-5 py-3 border-t border-[#1E1E24] hover:bg-[#18181C] transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-xs font-mono font-medium">{o.order_number}</p>
                      <p className="text-[#5A5A6A] text-[11px] truncate">{(o.customers as any)?.company_name ?? '—'}</p>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${SO_STATUS[o.status] ?? 'bg-[#1E1E24] text-[#9898A8] border-[#2A2A35]'}`}>{o.status}</span>
                  </Link>
                ))
            }
          </div>
        </div>
      </div>

      {/* Reminders */}
      <RemindersWidget />

      {/* Bottom row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Tasks */}
        <div className="bg-[#111113] border border-[#2A2A35] rounded-2xl">
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <h2 className="text-white font-semibold text-sm">Open Tasks</h2>
            <Link href="/bizdev/tasks" className="text-xs text-[#00C896] hover:text-[#00B085] transition-colors">View all →</Link>
          </div>
          {loading
            ? Array.from({length:4}).map((_,i) => <SkeletonRow key={i} />)
            : recentTasks.length === 0
              ? <p className="text-[#5A5A6A] text-sm py-8 text-center">No open tasks</p>
              : recentTasks.map(t => (
                <Link key={t.id} href="/bizdev/tasks" className="flex items-center gap-3 px-5 py-3 border-t border-[#1E1E24] hover:bg-[#18181C] transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs truncate">{t.title}</p>
                    <p className="text-[#5A5A6A] text-[11px]">{t.assigned_to ? t.assigned_to.split('@')[0] : '—'}{t.due_date ? ` · ${fmtD(t.due_date)}` : ''}</p>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${t.status === 'Done' ? 'bg-[#00C89615] text-[#00C896] border-[#00C89630]' : 'bg-[#1E1E24] text-[#9898A8] border-[#2A2A35]'}`}>{t.status}</span>
                </Link>
              ))
          }
        </div>

        {/* Overdue Invoices */}
        <div className="bg-[#111113] border border-[#2A2A35] rounded-2xl">
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <h2 className="text-white font-semibold text-sm">Overdue Invoices</h2>
            <Link href="/sales/invoices" className="text-xs text-[#00C896] hover:text-[#00B085] transition-colors">View all →</Link>
          </div>
          {loading
            ? Array.from({length:4}).map((_,i) => <SkeletonRow key={i} />)
            : overdueInvoiceList.length === 0
              ? <p className="text-[#5A5A6A] text-sm py-8 text-center">None overdue ✓</p>
              : overdueInvoiceList.map(inv => (
                <Link key={inv.id} href="/sales/invoices" className="flex items-center gap-3 px-5 py-3 border-t border-[#1E1E24] hover:bg-[#18181C] transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-mono">{inv.invoice_number_display ?? inv.id?.slice(0,8)}</p>
                    <p className="text-[#5A5A6A] text-[11px] truncate">{(inv.customers as any)?.company_name ?? '—'}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-red-400 text-xs font-semibold">{fmt$(inv.total_amount ?? 0)}</p>
                    <p className="text-[#5A5A6A] text-[11px]">{fmtD(inv.due_date)}</p>
                  </div>
                </Link>
              ))
          }
        </div>

        {/* Quick Actions */}
        <div className="bg-[#111113] border border-[#2A2A35] rounded-2xl p-5">
          <h2 className="text-white font-semibold text-sm mb-4">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Quotations', href: '/sales/quotations', color: 'text-violet-400', bg: 'bg-violet-500/10 hover:bg-violet-500/15' },
              { label: 'Sales Orders', href: '/sales/orders', color: 'text-blue-400', bg: 'bg-blue-500/10 hover:bg-blue-500/15' },
              { label: 'Production', href: '/production', color: 'text-amber-400', bg: 'bg-amber-500/10 hover:bg-amber-500/15' },
              { label: 'Quality Control', href: '/production/qc', color: 'text-[#00C896]', bg: 'bg-[#00C89610] hover:bg-[#00C89620]' },
              { label: 'Shipping', href: '/sales/shipping-queue', color: 'text-teal-400', bg: 'bg-teal-500/10 hover:bg-teal-500/15' },
              { label: 'Customers', href: '/sales/customers', color: 'text-sky-400', bg: 'bg-sky-500/10 hover:bg-sky-500/15' },
            ].map(a => (
              <Link key={a.label} href={a.href} className={`${a.bg} border border-[#2A2A35] rounded-xl p-3 text-center hover:border-[#3A3A45] transition-all`}>
                <p className={`text-xs font-medium ${a.color}`}>{a.label}</p>
              </Link>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-[#2A2A35] grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-white text-xl font-bold">{kpi.totalCustomers}</p>
              <p className="text-[#5A5A6A] text-[10px] mt-0.5">Customers</p>
            </div>
            <div>
              <p className="text-white text-xl font-bold">{kpi.openWorkOrders}</p>
              <p className="text-[#5A5A6A] text-[10px] mt-0.5">Work Orders</p>
            </div>
            <div>
              <p className="text-white text-xl font-bold">{kpi.openTasks}</p>
              <p className="text-[#5A5A6A] text-[10px] mt-0.5">Open Tasks</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
