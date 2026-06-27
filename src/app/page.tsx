'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import RemindersWidget from '@/components/RemindersWidget'
import TeamPresenceStrip from '@/components/TeamPresenceStrip'

const sb = createSupabaseBrowserClient()

// Only these statuses count as "open" — matches what Sales Orders page shows
const OPEN_STATUSES = [
  'New', 'Confirmed', 'Awaiting BOM Components', 'Awaiting Production',
  'Production Queue', 'In Production', 'QC', 'Ready to Ship', 'Partially Shipped', 'On Hold'
]

interface KPI { openOrders: number; revenueMTD: number; shipmentsMTD: number; invoicesDue: number; openTasks: number; lowStock: number; openWorkOrders: number; overdueInvoices: number; overdueAmount: number; totalCustomers: number }
const INIT: KPI = { openOrders:0, revenueMTD:0, shipmentsMTD:0, invoicesDue:0, openTasks:0, lowStock:0, openWorkOrders:0, overdueInvoices:0, overdueAmount:0, totalCustomers:0 }

const fmt$ = (n: number) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n)
const fmtD = (d: string|null|undefined) => d ? new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '—'

const PIPELINE = [
  { label: 'New', color: '#6366F1', href: '/sales/orders' },
  { label: 'In Production', color: '#F59E0B', href: '/sales/orders' },
  { label: 'QC', color: '#8B5CF6', href: '/production/quality-control' },
  { label: 'Ready to Ship', color: '#F97316', href: '/production/shipping-queue' },
  { label: 'Shipped', color: '#14B8A6', href: '/shipments' },
  { label: 'Invoiced', color: '#00C896', href: '/sales/invoices' },
]

function SkeletonRow() {
  return (
    <div className="flex gap-3 items-center px-5 py-3 border-b border-[#E4E6EE] last:border-0">
      <div className="skeleton h-2.5 w-20 rounded" />
      <div className="skeleton h-2.5 w-28 rounded" />
      <div className="skeleton h-2.5 w-12 rounded ml-auto" />
    </div>
  )
}

export default function DashboardPage() {
  const [kpi, setKpi] = useState<KPI>(INIT)
  const [loading, setLoading] = useState(true)
  const [recentOrders, setRecentOrders] = useState<any[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  const [overdueInvoicesList, setOverdueInvoicesList] = useState<any[]>([])
  const [greeting, setGreeting] = useState('')
  const [userName, setUserName] = useState('')
  const [pipelineCounts, setPipelineCounts] = useState<Record<string,number>>({})

  useEffect(() => {
    const h = new Date().getHours()
    setGreeting(h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening')
    sb.auth.getUser().then(({ data }) => {
      if (data.user?.email) {
        sb.from('user_profiles').select('full_name').eq('email', data.user.email).single()
          .then(({ data: p }) => setUserName(p?.full_name || data.user!.email!.split('@')[0]))
      }
    })
  }, [])

  useEffect(() => {
    async function load() {
      setLoading(true)
      const today = new Date().toISOString().split('T')[0]
      const monthStart = today.substring(0,7) + '-01'

      const [
        { count: openOrders },
        { data: soData },
        { count: openTasks },
        { count: openWorkOrders },
        { count: totalCustomers },
        { data: invoiceData },
        { data: recentSO },
        { data: taskData },
      ] = await Promise.all([
        // OPEN ORDERS: only count statuses that are genuinely open
        sb.from('sales_orders').select('id', { count: 'exact', head: true }).in('status', OPEN_STATUSES),
        // Revenue MTD: from shipped/invoiced orders this month
        sb.from('sales_orders').select('total_amount').in('status', ['Shipped','Closed']).gte('updated_at', monthStart),
        sb.from('tasks').select('id', { count: 'exact', head: true }).not('status', 'in', '("Done","Archived","Cancelled")'),
        sb.from('work_orders').select('id', { count: 'exact', head: true }).eq('status', 'Queued'),
        sb.from('customers').select('id', { count: 'exact', head: true }),
        sb.from('invoices').select('id,total_amount,due_date,status,customers(company_name)').neq('status','paid').neq('status','void').neq('status','Paid'),
        sb.from('sales_orders').select('id,order_number,status,total_amount,customers(company_name),updated_at').order('updated_at',{ascending:false}).limit(5),
        sb.from('tasks').select('id,name,status,priority,assigned_to,due_date').not('status','in','("Done","Archived")').order('due_date',{ascending:true}).limit(5),
      ])

      const revenueMTD = (soData || []).reduce((s:number, r:any) => s + (r.total_amount || 0), 0)
      const overdue = (invoiceData || []).filter((i:any) => i.due_date && i.due_date < today)
      const overdueAmount = overdue.reduce((s:number, i:any) => s + (i.total_amount || 0), 0)
      const invoicesDue = (invoiceData || []).length

      // Pipeline counts
      const pCounts: Record<string,number> = {}
      for (const stage of PIPELINE) {
        const { count } = await sb.from('sales_orders').select('id',{count:'exact',head:true}).eq('status', stage.label)
        pCounts[stage.label] = count || 0
      }
      setPipelineCounts(pCounts)

      setKpi({ openOrders: openOrders || 0, revenueMTD, shipmentsMTD: 0, invoicesDue, openTasks: openTasks || 0, lowStock: 0, openWorkOrders: openWorkOrders || 0, overdueInvoices: overdue.length, overdueAmount, totalCustomers: totalCustomers || 0 })
      setRecentOrders(recentSO || [])
      setTasks(taskData || [])
      setOverdueInvoicesList(overdue)
      setLoading(false)
    }
    load()
  }, [])

  const totalPipeline = useMemo(() => Object.values(pipelineCounts).reduce((a,b) => a+b, 0) || 1, [pipelineCounts])

  const priorityColor = (p: string) => ({ Critical:'text-red-600', High:'text-orange-500', Medium:'text-yellow-600', Low:'text-gray-400' }[p] || 'text-gray-400')
  const statusChip = (s: string) => {
    const map: Record<string,string> = { Shipped:'bg-teal-100 text-teal-700', 'Ready to Ship':'bg-orange-100 text-orange-700', 'In Production':'bg-blue-100 text-blue-700', QC:'bg-purple-100 text-purple-700', New:'bg-indigo-100 text-indigo-700', Confirmed:'bg-indigo-100 text-indigo-700' }
    return (map[s] || 'bg-gray-100 text-gray-600') + ' text-xs px-2 py-0.5 rounded-full font-medium'
  }

  return (
    <div className="min-h-screen bg-[#F7F8FA] p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-sm text-[#8A9FC0]">{new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}</p>
          <h1 className="text-2xl font-bold text-[#0F1C2E]">{greeting}{userName ? ', ' + userName : ''} 👋</h1>
        </div>
        <div className="flex gap-2">
          <Link href="/sales/orders?new=1" className="px-4 py-2 bg-[#3B6FE0] text-white text-sm rounded-lg font-semibold hover:bg-[#2D5CC8]">+ New Order</Link>
          <Link href="/sales/quotations?new=1" className="px-4 py-2 bg-white border border-[#E2E8F0] text-[#0F1C2E] text-sm rounded-lg font-semibold hover:bg-[#F1F4F9]">+ New Quote</Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Open Orders', value: kpi.openOrders, fmt: (v:number) => v.toString(), color: 'text-indigo-600', bg: 'bg-indigo-50', href: '/sales/orders' },
          { label: 'Revenue MTD', value: kpi.revenueMTD, fmt: fmt$, color: 'text-emerald-600', bg: 'bg-emerald-50', href: '/sales/invoices' },
          { label: 'Shipping Queue', value: kpi.openWorkOrders, fmt: (v:number) => v.toString(), color: 'text-orange-600', bg: 'bg-orange-50', href: '/production/shipping-queue' },
          { label: 'Overdue Invoices', value: kpi.overdueInvoices, fmt: (v:number) => v > 0 ? `${v} (${fmt$(kpi.overdueAmount)})` : '0', color: kpi.overdueInvoices > 0 ? 'text-red-600' : 'text-gray-600', bg: kpi.overdueInvoices > 0 ? 'bg-red-50' : 'bg-gray-50', href: '/sales/invoices' },
        ].map(card => (
          <Link key={card.label} href={card.href} className={`block rounded-xl border border-[#E2E8F0] bg-white p-5 hover:shadow-sm transition-shadow`}>
            <p className="text-xs font-semibold text-[#8A9FC0] uppercase tracking-wide mb-2">{card.label}</p>
            {loading ? <div className="skeleton h-7 w-16 rounded" /> : <p className={`text-2xl font-bold ${card.color}`}>{card.fmt(card.value)}</p>}
          </Link>
        ))}
      </div>

      <TeamPresenceStrip />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        {/* Pipeline */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-[#E2E8F0] p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-[#0F1C2E]">Order Pipeline</h2>
            <Link href="/sales/orders" className="text-xs text-[#3B6FE0] font-semibold hover:underline">View all →</Link>
          </div>
          <div className="flex h-3 rounded-full overflow-hidden mb-4 gap-0.5">
            {PIPELINE.map(s => (
              <div key={s.label} style={{ width: `${((pipelineCounts[s.label]||0)/totalPipeline)*100}%`, background: s.color, minWidth: pipelineCounts[s.label] ? 4 : 0 }} title={`${s.label}: ${pipelineCounts[s.label]||0}`} />
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            {PIPELINE.map(s => (
              <Link key={s.label} href={s.href} className="flex items-center gap-1.5 text-xs text-[#5A6E8A] hover:text-[#3B6FE0]">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background:s.color}} />
                {s.label} <span className="font-bold text-[#0F1C2E]">{pipelineCounts[s.label]||0}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Quick Stats */}
        <div className="bg-white rounded-xl border border-[#E2E8F0] p-5">
          <h2 className="font-bold text-[#0F1C2E] mb-4">Quick Stats</h2>
          <div className="space-y-3">
            {[
              { label: 'Total Customers', value: kpi.totalCustomers, href: '/sales/customers' },
              { label: 'Active Work Orders', value: kpi.openWorkOrders, href: '/production/work-orders' },
              { label: 'Open Tasks', value: kpi.openTasks, href: '/bizdev/tasks' },
              { label: 'Invoices Outstanding', value: kpi.invoicesDue, href: '/sales/invoices' },
            ].map(item => (
              <Link key={item.label} href={item.href} className="flex items-center justify-between py-1.5 border-b border-[#F1F4F9] last:border-0 hover:text-[#3B6FE0] group">
                <span className="text-sm text-[#5A6E8A] group-hover:text-[#3B6FE0]">{item.label}</span>
                {loading ? <div className="skeleton h-4 w-8 rounded" /> : <span className="text-sm font-bold text-[#0F1C2E]">{item.value}</span>}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent Orders */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-[#E2E8F0] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#E4E6EE]">
            <h2 className="font-bold text-[#0F1C2E]">Recent Orders</h2>
            <Link href="/sales/orders" className="text-xs text-[#3B6FE0] font-semibold hover:underline">View all →</Link>
          </div>
          {loading ? [1,2,3].map(i => <SkeletonRow key={i} />) : (
            recentOrders.length === 0
              ? <p className="text-center py-10 text-sm text-[#8A9FC0]">No orders yet</p>
              : recentOrders.map((o:any) => (
                <Link key={o.id} href={`/sales/orders/${o.id}`} className="flex items-center justify-between px-5 py-3 border-b border-[#E4E6EE] last:border-0 hover:bg-[#F7F8FA]">
                  <div>
                    <p className="text-sm font-semibold text-[#0F1C2E]">{o.order_number || o.id.substring(0,8)}</p>
                    <p className="text-xs text-[#8A9FC0]">{o.customers?.company_name || '—'}</p>
                  </div>
                  <div className="text-right">
                    <span className={statusChip(o.status)}>{o.status}</span>
                    <p className="text-xs text-[#8A9FC0] mt-1">{fmtD(o.updated_at?.split('T')[0])}</p>
                  </div>
                </Link>
              ))
          )}
        </div>

        {/* Right column: Tasks + Reminders + Overdue */}
        <div className="space-y-4">
          {/* Tasks */}
          <div className="bg-white rounded-xl border border-[#E2E8F0] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E4E6EE]">
              <h2 className="font-bold text-[#0F1C2E]">Open Tasks</h2>
              <Link href="/bizdev/tasks" className="text-xs text-[#3B6FE0] font-semibold hover:underline">View all →</Link>
            </div>
            {loading ? [1,2,3].map(i => <SkeletonRow key={i} />) : (
              tasks.length === 0
                ? <p className="text-center py-6 text-sm text-[#8A9FC0]">All caught up ✓</p>
                : tasks.map((t:any) => (
                  <div key={t.id} className="flex items-center justify-between px-4 py-3 border-b border-[#E4E6EE] last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[#0F1C2E] truncate">{t.name}</p>
                      <p className="text-xs text-[#8A9FC0]">{t.due_date ? fmtD(t.due_date) : 'No due date'}</p>
                    </div>
                    <span className={`text-xs font-bold ml-2 ${priorityColor(t.priority)}`}>{t.priority}</span>
                  </div>
                ))
            )}
          </div>

          {/* Reminders */}
          <RemindersWidget />

          {/* Overdue Invoices */}
          {kpi.overdueInvoices > 0 && (
            <div className="bg-red-50 rounded-xl border border-red-200 p-4">
              <h3 className="font-bold text-red-700 mb-2 text-sm">⚠ Overdue Invoices ({kpi.overdueInvoices})</h3>
              {overdueInvoicesList.slice(0,3).map((inv:any) => (
                <div key={inv.id} className="flex justify-between text-xs py-1">
                  <span className="text-red-600 truncate">{inv.customers?.company_name || '—'}</span>
                  <span className="text-red-700 font-bold ml-2">{fmt$(inv.total_amount || 0)}</span>
                </div>
              ))}
              <Link href="/sales/invoices" className="text-xs text-red-600 font-semibold hover:underline mt-2 block">View all overdue →</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
