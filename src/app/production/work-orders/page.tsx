'use client'
import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const sb = createSupabaseBrowserClient()

interface WO {
  id: string
  wo_number: string
  sales_order_id: string
  status: string
  notes: string
  created_at: string
  sales_orders?: { order_number: string; customers?: { company_name: string } }
}

export default function WorkOrdersPage() {
  const [orders, setOrders] = useState<WO[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const { data } = await sb
      .from('work_orders')
      .select('*, sales_orders(order_number, customers(company_name))')
      .order('created_at', { ascending: false })
    setOrders(data || [])
    setLoading(false)
  }

  async function upd(id: string, status: string) {
    await sb.from('work_orders').update({ status }).eq('id', id)
    load()
  }

  useEffect(() => { load() }, [])

  const q = orders.filter(o => o.status === 'Queued')
  const ip = orders.filter(o => o.status === 'In Progress')
  const done = orders.filter(o => ['Complete', 'QC Passed'].includes(o.status))

  return (
    <div className="min-h-screen p-8 bg-gray-50">
      <p className="text-xs font-semibold text-emerald-600 uppercase tracking-widest mb-1">PRODUCTION</p>
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Work Orders</h1>
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Queued', count: q.length, cls: 'bg-yellow-50 border-yellow-200 text-yellow-700' },
          { label: 'In Progress', count: ip.length, cls: 'bg-blue-50 border-blue-200 text-blue-700' },
          { label: 'Complete', count: done.length, cls: 'bg-green-50 border-green-200 text-green-700' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl border p-5 ${s.cls}`}>
            <p className="text-sm font-medium">{s.label}</p>
            <p className="text-3xl font-bold mt-1">{s.count}</p>
          </div>
        ))}
      </div>
      {loading ? (
        <div className="text-center py-20 text-gray-400">Loading...</div>
      ) : (
        <div className="space-y-3">
          {orders.map(wo => (
            <div key={wo.id} className="bg-white rounded-xl border border-gray-100 p-5 flex items-center justify-between shadow-sm">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <span className="font-bold text-gray-900">{wo.wo_number}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    wo.status === 'Complete' || wo.status === 'QC Passed' ? 'bg-green-100 text-green-700' :
                    wo.status === 'In Progress' ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'
                  }`}>{wo.status}</span>
                </div>
                <p className="text-sm text-gray-500">SO: {wo.sales_orders?.order_number} &middot; {wo.sales_orders?.customers?.company_name}</p>
                {wo.notes && <p className="text-xs text-gray-400 mt-1">{wo.notes}</p>}
              </div>
              <div className="flex gap-2">
                {wo.status === 'Queued' && (
                  <button onClick={() => upd(wo.id, 'In Progress')} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">Start</button>
                )}
                {wo.status === 'In Progress' && (
                  <button onClick={() => upd(wo.id, 'Complete')} className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700">Complete</button>
                )}
              </div>
            </div>
          ))}
          {orders.length === 0 && <div className="text-center py-20 text-gray-400">No work orders yet.</div>}
        </div>
      )}
    </div>
  )
}
