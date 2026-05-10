'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Stats {
  machinesOnline: number
  machinesDown: number
  openWorkOrders: number
  openOrders: number
  pendingShipments: number
  unpaidInvoices: number
  overdueInvoices: number
  lowStockItems: number
  totalCustomers: number
  openTasks: number
  activeCerts: number
  expiringCerts: number
  totalDocuments: number
}

const INIT: Stats = {
  machinesOnline: 0, machinesDown: 0, openWorkOrders: 0,
  openOrders: 0, pendingShipments: 0, unpaidInvoices: 0,
  overdueInvoices: 0, lowStockItems: 0, totalCustomers: 0,
  openTasks: 0, activeCerts: 0, expiringCerts: 0, totalDocuments: 0,
}

export default function DashboardPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<Stats>(INIT)
  const [recentOrders, setRecentOrders] = useState<Record<string, unknown>[]>([])
  const [recentTasks, setRecentTasks] = useState<Record<string, unknown>[]>([])
  const [alerts, setAlerts] = useState<string[]>([])

  useEffect(() => { loadData() }, []) // eslint-disable-line

  async function loadData() {
    setLoading(true)
    try {
      const [
        machinesRes,
        workOrdersRes,
        ordersRes,
        shipmentsRes,
        invoicesRes,
        productsRes,
        tasksRes,
        certsRes,
        docsRes,
        customersRes,
        recentOrdersRes,
        recentTasksRes,
      ] = await Promise.all([
        supabase.from('machines').select('status').eq('is_active', true),
        supabase.from('work_orders').select('id', { count: 'exact', head: true }).not('status', 'in', '("Complete","Cancelled")'),
        supabase.from('sales_orders').select('id', { count: 'exact', head: true }).eq('is_active', true).not('status', 'in', '("Closed","Cancelled")'),
        supabase.from('shipping_queue').select('id', { count: 'exact', head: true }).not('status', 'in', '("Delivered","Cancelled","Picked Up")'),
        supabase.from('invoices').select('status, due_date').eq('is_active', true),
        supabase.from('products').select('on_hand_qty, reorder_point').eq('is_active', true),
        supabase.from('tasks').select('id', { count: 'exact', head: true }).not('status', 'in', '("Done","Archived","Completed")'),
        supabase.from('certifications').select('status, expiry_date').eq('is_active', true),
        supabase.from('documents').select('id', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('customers').select('id', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('sales_orders').select('id, order_number, status, created_at, customers(company_name)').order('created_at', { ascending: false }).limit(5),
        supabase.from('tasks').select('id, task_name, status, priority, assigned_to').not('status', 'in', '("Done","Archived","Completed")').order('created_at', { ascending: false }).limit(5),
      ])

      const machines = machinesRes.data ?? []
      const invoices = invoicesRes.data ?? []
      const products = productsRes.data ?? []
      const certs = certsRes.data ?? []
      const today = new Date()
      const ninetyDays = new Date(today)
      ninetyDays.setDate(today.getDate() + 90)

      const machinesOnline = machines.filter(m => m.status === 'Running').length
      const machinesDown = machines.filter(m => m.status === 'Down' || m.status === 'Maintenance').length
      const unpaidInvoices = invoices.filter(i => i.status !== 'Paid').length
      const overdueInvoices = invoices.filter(i => i.status !== 'Paid' && i.due_date && new Date(i.due_date) < today).length
      const lowStockItems = products.filter(p => Number(p.on_hand_qty) <= Number(p.reorder_point)).length
      const activeCerts = certs.filter(c => c.status === 'Active').length
      const expiringCerts = certs.filter(c => c.expiry_date && new Date(c.expiry_date) < ninetyDays && new Date(c.expiry_date) > today).length

      const newAlerts: string[] = []
      if (overdueInvoices > 0) newAlerts.push(`${overdueInvoices} invoice${overdueInvoices > 1 ? 's' : ''} overdue`)
      if (expiringCerts > 0) newAlerts.push(`${expiringCerts} certification${expiringCerts > 1 ? 's' : ''} expiring within 90 days`)
      if (lowStockItems > 0) newAlerts.push(`${lowStockItems} item${lowStockItems > 1 ? 's' : ''} below reorder point`)

      setStats({
        machinesOnline,
        machinesDown,
        openWorkOrders: workOrdersRes.count ?? 0,
        openOrders: ordersRes.count ?? 0,
        pendingShipments: shipmentsRes.count ?? 0,
        unpaidInvoices,
        overdueInvoices,
        lowStockItems,
        totalCustomers: customersRes.count ?? 0,
        openTasks: tasksRes.count ?? 0,
        activeCerts,
        expiringCerts,
        totalDocuments: docsRes.count ?? 0,
      })
      setRecentOrders(recentOrdersRes.data ?? [])
      setRecentTasks(recentTasksRes.data ?? [])
      setAlerts(newAlerts)
    } catch (err) {
      console.error('Dashboard load error:', err)
    }
    setLoading(false)
  }

  const statCards = [
    { label: 'Open Orders', value: stats.openOrders, href: '/sales/orders', border: 'border-blue-500/30', bg: 'bg-blue-500/10', text: 'text-blue-400' },
    { label: 'Unpaid Invoices', value: stats.unpaidInvoices, href: '/sales/invoices', border: 'border-red-500/30', bg: 'bg-red-500/10', text: 'text-red-400' },
    { label: 'Pending Shipments', value: stats.pendingShipments, href: '/sales/shipping-queue', border: 'border-amber-500/30', bg: 'bg-amber-500/10', text: 'text-amber-400' },
    { label: 'Total Customers', value: stats.totalCustomers, href: '/sales/customers', border: 'border-emerald-500/30', bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
    { label: 'Machines Online', value: stats.machinesOnline, href: '/production/machine-status', border: 'border-emerald-500/30', bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
    { label: 'Machines Down', value: stats.machinesDown, href: '/production/machine-status', border: 'border-red-500/30', bg: 'bg-red-500/10', text: 'text-red-400' },
    { label: 'Open Work Orders', value: stats.openWorkOrders, href: '/production', border: 'border-blue-500/30', bg: 'bg-blue-500/10', text: 'text-blue-400' },
    { label: 'Low Stock Items', value: stats.lowStockItems, href: '/sales/inventory', border: 'border-amber-500/30', bg: 'bg-amber-500/10', text: 'text-amber-400' },
    { label: 'Open Tasks', value: stats.openTasks, href: '/bizdev/tasks', border: 'border-violet-500/30', bg: 'bg-violet-500/10', text: 'text-violet-400' },
    { label: 'Active Certs', value: stats.activeCerts, href: '/bizdev/certifications', border: 'border-emerald-500/30', bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
    { label: 'Expiring Soon', value: stats.expiringCerts, href: '/bizdev/certifications', border: 'border-amber-500/30', bg: 'bg-amber-500/10', text: 'text-amber-400' },
    { label: 'Documents', value: stats.totalDocuments, href: '/bizdev/documents', border: 'border-gray-700', bg: 'bg-gray-800/40', text: 'text-gray-400' },
  ]

  const orderStatusColors: Record<string, string> = {
    'New': 'bg-blue-500/20 text-blue-400',
    'In Production': 'bg-amber-500/20 text-amber-400',
    'Ready to Ship': 'bg-violet-500/20 text-violet-400',
    'Shipped': 'bg-emerald-500/20 text-emerald-400',
    'Invoiced': 'bg-gray-700 text-gray-400',
    'Closed': 'bg-gray-700 text-gray-500',
  }

  const priorityColors: Record<string, string> = {
    'Critical': 'bg-red-500/20 text-red-400',
    'High': 'bg-orange-500/20 text-orange-400',
    'Medium': 'bg-amber-500/20 text-amber-400',
    'Low': 'bg-gray-700 text-gray-400',
  }

  return (
    <div className="p-4 md:p-8 min-h-screen">

      {/* Alerts */}
      {!loading && alerts.length > 0 && (
        <div className="mb-6 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
          <p className="text-amber-400 font-medium text-sm mb-1">Attention required</p>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {alerts.map((a, i) => (
              <span key={i} className="text-amber-300 text-sm">• {a}</span>
            ))}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Welcome back to beyondGREEN ERP</p>
      </div>

      {/* Stats grid — 2 cols mobile, 4 cols desktop */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {statCards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className={`rounded-xl border ${card.border} ${card.bg} p-4 hover:opacity-80 transition-opacity`}
          >
            {loading ? (
              <div className="h-8 w-12 bg-gray-700 rounded animate-pulse mb-1" />
            ) : (
              <p className={`text-3xl font-bold ${card.text}`}>{card.value}</p>
            )}
            <p className="text-gray-500 text-xs mt-1">{card.label}</p>
          </Link>
        ))}
      </div>

      {/* Module quick-nav */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-8">
        {[
          {
            name: 'Production', color: 'text-emerald-400', border: 'border-emerald-500/30',
            links: [
              { label: 'Machine Status', href: '/production/machine-status' },
              { label: 'Daily Plan', href: '/production/daily-plan' },
              { label: 'Production Overview', href: '/production/overview' },
              { label: 'Capacity Plan', href: '/production/capacity-plan' },
            ],
          },
          {
            name: 'Sales', color: 'text-blue-400', border: 'border-blue-500/30',
            links: [
              { label: 'Sales Orders', href: '/sales/orders' },
              { label: 'Customers', href: '/sales/customers' },
              { label: 'Shipping Queue', href: '/sales/shipping-queue' },
              { label: 'Invoices', href: '/sales/invoices' },
              { label: 'Inventory', href: '/sales/inventory' },
            ],
          },
          {
            name: 'Business Dev', color: 'text-violet-400', border: 'border-violet-500/30',
            links: [
              { label: 'Task Board', href: '/bizdev/tasks' },
              { label: 'Certifications', href: '/bizdev/certifications' },
              { label: 'Document Pool', href: '/bizdev/documents' },
            ],
          },
        ].map((mod) => (
          <div key={mod.name} className={`bg-gray-900 border ${mod.border} rounded-xl p-5`}>
            <p className={`text-xs font-semibold tracking-widest mb-3 ${mod.color}`}>{mod.name.toUpperCase()}</p>
            <div className="space-y-0.5">
              {mod.links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors group"
                >
                  <span className="text-sm text-gray-400 group-hover:text-white transition-colors">{link.label}</span>
                  <svg className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Recent activity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Recent orders */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
            <h2 className="text-white font-medium text-sm">Recent Sales Orders</h2>
            <Link href="/sales/orders" className="text-xs text-emerald-400 hover:text-emerald-300">View all →</Link>
          </div>
          {loading ? (
            <div className="p-5 space-y-3">
              {[0, 1, 2].map(i => <div key={i} className="h-10 bg-gray-800 rounded animate-pulse" />)}
            </div>
          ) : recentOrders.length === 0 ? (
            <div className="p-8 text-center text-gray-600 text-sm">No orders yet</div>
          ) : (
            <div>
              {recentOrders.map((order) => (
                <Link
                  key={order.id as string}
                  href="/sales/orders"
                  className="flex items-center justify-between px-5 py-3 border-b border-gray-800/50 last:border-0 hover:bg-gray-800/40 transition-colors"
                >
                  <div>
                    <p className="text-sm text-white font-medium">{(order.customers as Record<string, unknown>)?.company_name as string ?? 'Unknown'}</p>
                    <p className="text-xs text-gray-500">Order #{order.order_number as string}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${orderStatusColors[order.status as string] ?? 'bg-gray-700 text-gray-400'}`}>
                    {order.status as string}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Open tasks */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
            <h2 className="text-white font-medium text-sm">Open Tasks</h2>
            <Link href="/bizdev/tasks" className="text-xs text-emerald-400 hover:text-emerald-300">View all →</Link>
          </div>
          {loading ? (
            <div className="p-5 space-y-3">
              {[0, 1, 2].map(i => <div key={i} className="h-10 bg-gray-800 rounded animate-pulse" />)}
            </div>
          ) : recentTasks.length === 0 ? (
            <div className="p-8 text-center text-gray-600 text-sm">No open tasks</div>
          ) : (
            <div>
              {recentTasks.map((task) => (
                <Link
                  key={task.id as string}
                  href="/bizdev/tasks"
                  className="flex items-center justify-between px-5 py-3 border-b border-gray-800/50 last:border-0 hover:bg-gray-800/40 transition-colors"
                >
                  <div className="flex-1 min-w-0 mr-3">
                    <p className="text-sm text-white font-medium truncate">{task.task_name as string}</p>
                    <p className="text-xs text-gray-500">{(task.assigned_to as string | null)?.split('@')[0] ?? 'Unassigned'}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium shrink-0 ${priorityColors[task.priority as string] ?? 'bg-gray-700 text-gray-400'}`}>
                    {task.priority as string}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
