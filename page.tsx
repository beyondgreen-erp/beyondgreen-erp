'use client'
import { useEffect, useMemo, useState } from 'react'
import nextDynamic from 'next/dynamic'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const WorkOrdersMap = nextDynamic(() => import('@/components/WorkOrdersMap'), { ssr: false })

interface WO {
  id: string
  wo_number: string
  sales_order_id: string
  status: string
  notes: string
  created_at: string
  sales_orders?: { 
    order_number: string
    customers?: { 
      company_name: string
      id: string
    }
  }
}

interface WorkOrderMapPoint {
  id: string
  wo_number: string
  customer_name: string
  status: string
  city: string | null
  state: string | null
  customer_id: string | null
}

export default function WorkOrdersPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [orders, setOrders] = useState<WO[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'table' | 'map'>('table')

  async function load() {
    setLoading(true)
    const { data } = await sb
      .from('work_orders')
      .select('*, sales_orders(order_number, customers(company_name, id))')
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

  // Fetch ship locations for all customers in work orders
  const [mapPoints, setMapPoints] = useState<WorkOrderMapPoint[]>([])
  const [mapLoading, setMapLoading] = useState(false)

  useEffect(() => {
    if (tab === 'map' && orders.length > 0) {
      loadMapData()
    }
  }, [tab, orders])

  async function loadMapData() {
    setMapLoading(true)
    try {
      const customerIds = [...new Set(orders
        .map(o => o.sales_orders?.customers?.id)
        .filter(Boolean))]

      if (customerIds.length === 0) {
        setMapPoints([])
        setMapLoading(false)
        return
      }

      const { data: shipLocations } = await sb
        .from('ship_locations')
        .select('*')
        .in('customer_id', customerIds as string[])

      // Build map of customer_id -> ship locations
      const locsByCustomer: Record<string, any[]> = {}
      shipLocations?.forEach(loc => {
        if (!locsByCustomer[loc.customer_id]) {
          locsByCustomer[loc.customer_id] = []
        }
        locsByCustomer[loc.customer_id].push(loc)
      })

      // For each work order, find a ship location (prefer default, then first)
      const points = orders.map(wo => {
        const customerId = wo.sales_orders?.customers?.id
        const locs = customerId ? locsByCustomer[customerId] : undefined
        const loc = locs?.find(l => l.is_default) || locs?.[0]

        return {
          id: wo.id,
          wo_number: wo.wo_number,
          customer_name: wo.sales_orders?.customers?.company_name || 'Unknown',
          status: wo.status,
          city: loc?.city || null,
          state: loc?.state || null,
          customer_id: customerId || null,
        }
      })

      setMapPoints(points)
    } catch (err) {
      console.error('Error loading map data:', err)
    } finally {
      setMapLoading(false)
    }
  }

  return (
    <div className="min-h-screen p-8 bg-gray-50">
      <p className="text-xs font-semibold text-emerald-600 uppercase tracking-widest mb-1">PRODUCTION</p>
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Work Orders</h1>
      
      {/* View toggle */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setTab('table')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            tab === 'table'
              ? 'bg-blue-600 text-white'
              : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          Table
        </button>
        <button
          onClick={() => setTab('map')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            tab === 'map'
              ? 'bg-blue-600 text-white'
              : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          Map
        </button>
      </div>

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

      {tab === 'table' ? (
        loading ? (
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
        )
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {mapLoading ? (
            <div className="flex items-center justify-center h-[500px] text-gray-400">Loading map data...</div>
          ) : mapPoints.length === 0 ? (
            <div className="flex items-center justify-center h-[500px] text-gray-400">No location data available for work orders</div>
          ) : (
            <WorkOrdersMap workOrders={mapPoints} />
          )}
        </div>
      )}
    </div>
  )
}
