'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import Link from 'next/link'

interface Stats {
  activeWOs: number; overdueWOs: number
  machinesRunning: number; machinesDown: number; totalMachines: number
  plansToday: number; plansComplete: number
  lowStockItems: number
}

function StatCard({ label, value, sub, color, href }: { label: string; value: string | number; sub?: string; color: string; href?: string }) {
  const content = (
    <div className={`bg-white border border-[#E4E6EE] rounded-xl p-5 hover:border-[#E4E6EE] transition-colors ${href?'cursor-pointer':''}`}>
      <p className="text-gray-500 text-xs font-medium mb-3">{label}</p>
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
      {sub&&<p className="text-gray-600 text-xs mt-2">{sub}</p>}
    </div>
  )
  return href ? <Link href={href}>{content}</Link> : content
}

export default function OverviewPage() {
  const sb=useMemo(()=>createSupabaseBrowserClient(),[])
  const [stats,setStats]=useState<Stats|null>(null)
  const [loading,setLoading]=useState(true)

  useEffect(()=>{
    async function load(){
      setLoading(true)
      const today=new Date().toISOString().slice(0,10)
      const now=new Date(); now.setHours(0,0,0,0)

      const [{data:wos},{data:machines},{data:plans},{data:products}]=await Promise.all([
        sb.from('work_orders').select('status,due_date').eq('is_active',true),
        sb.from('machines').select('status').eq('is_active',true),
        sb.from('daily_plan').select('status,plan_date').eq('is_active',true).eq('plan_date',today),
        sb.from('products').select('on_hand_qty,reorder_point').eq('is_active',true),
      ])

      const activeWOs=(wos||[]).filter(w=>w.status!=='Complete').length
      const overdueWOs=(wos||[]).filter(w=>w.due_date&&new Date(w.due_date+'T00:00:00')<now&&w.status!=='Complete').length
      const machinesRunning=(machines||[]).filter(m=>m.status==='Running').length
      const machinesDown=(machines||[]).filter(m=>m.status==='Down').length
      const totalMachines=(machines||[]).length
      const plansToday=(plans||[]).length
      const plansComplete=(plans||[]).filter(p=>p.status==='Complete').length
      const lowStockItems=(products||[]).filter(p=>p.reorder_point>0&&p.on_hand_qty<=p.reorder_point).length

      setStats({activeWOs,overdueWOs,machinesRunning,machinesDown,totalMachines,plansToday,plansComplete,lowStockItems})
      setLoading(false)
    }
    load()
  },[]) // eslint-disable-line

  const completionRate=stats&&stats.plansToday>0?Math.round((stats.plansComplete/stats.plansToday)*100):null

  return (
    <div className="p-4 md:p-8 min-h-screen">
      <div className="mb-8">
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-emerald-500/20 text-emerald-300 border-emerald-500/30">PRODUCTION</span>
        <h1 className="text-2xl font-semibold text-[#1A1D2E] mt-1">Production Overview</h1>
        <p className="text-gray-500 text-sm mt-0.5">Live summary across all production data</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><svg className="w-5 h-5 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div>
      ) : stats ? (
        <div className="space-y-6">
          <div>
            <h2 className="text-xs font-semibold text-emerald-400 tracking-widest mb-3">WORK ORDERS</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Active Work Orders" value={stats.activeWOs} color="text-[#1A1D2E]" href="/production" sub="Not yet complete"/>
              <StatCard label="Overdue" value={stats.overdueWOs} color={stats.overdueWOs>0?'text-red-400':'text-gray-400'} href="/production" sub="Past due date"/>
              <StatCard label="Completed Today" value={(stats.plansComplete)} color="text-emerald-400" href="/production/daily-plan" sub="Daily plan entries"/>
              <StatCard label="Plan Completion" value={completionRate!==null?`${completionRate}%`:'—'} color={completionRate!==null&&completionRate>=80?'text-emerald-400':completionRate!==null&&completionRate>=50?'text-amber-400':'text-red-400'} sub={`${stats.plansComplete} of ${stats.plansToday} plans today`}/>
            </div>
          </div>
          <div>
            <h2 className="text-xs font-semibold text-emerald-400 tracking-widest mb-3">MACHINES</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Running" value={stats.machinesRunning} color="text-emerald-400" href="/production/machine-status"/>
              <StatCard label="Down" value={stats.machinesDown} color={stats.machinesDown>0?'text-red-400':'text-gray-400'} href="/production/machine-status"/>
              <StatCard label="Total Machines" value={stats.totalMachines} color="text-[#1A1D2E]" href="/production/machine-status"/>
              <StatCard label="Uptime Rate" value={stats.totalMachines>0?`${Math.round(((stats.totalMachines-stats.machinesDown)/stats.totalMachines)*100)}%`:'—'} color="text-[#1A1D2E]" sub="Machines not down"/>
            </div>
          </div>
          <div>
            <h2 className="text-xs font-semibold text-emerald-400 tracking-widest mb-3">INVENTORY</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Low Stock Items" value={stats.lowStockItems} color={stats.lowStockItems>0?'text-amber-400':'text-gray-400'} href="/sales/inventory" sub="At or below reorder point"/>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
