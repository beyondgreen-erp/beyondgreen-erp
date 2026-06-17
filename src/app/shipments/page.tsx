'use client'
import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const sb = createSupabaseBrowserClient()

interface Shipment {
  id: string
  sales_order_id: string
  status: string
  shipped_at: string
  tracking_number?: string
  carrier?: string
  sales_orders?: { order_number: string; customers?: { company_name: string } }
}

export default function ShipmentsPage() {
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const { data } = await sb
      .from('shipments')
      .select('*, sales_orders(order_number, customers(company_name))')
      .order('shipped_at', { ascending: false })
    setShipments(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const shipped = shipments.filter(s => s.status === 'Shipped').length
  const inTransit = shipments.filter(s => s.status === 'In Transit').length

  return (
    <div className="min-h-screen p-8 bg-gray-50">
      <p className="text-xs font-semibold text-emerald-600 uppercase tracking-widest mb-1">SHIPPING</p>
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Shipments</h1>
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Total', count: shipments.length, cls: 'bg-white border-gray-200 text-gray-700' },
          { label: 'Shipped', count: shipped, cls: 'bg-green-50 border-green-200 text-green-700' },
          { label: 'In Transit', count: inTransit, cls: 'bg-blue-50 border-blue-200 text-blue-700' },
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
          {shipments.map(s => (
            <div key={s.id} className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm flex items-center justify-between">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <span className="font-bold text-gray-900">{s.sales_orders?.order_number}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">{s.status}</span>
                </div>
                <p className="text-sm text-gray-500">{s.sales_orders?.customers?.company_name}</p>
                {s.tracking_number && <p className="text-xs text-gray-400 mt-1">Tracking: {s.tracking_number}</p>}
              </div>
              <p className="text-sm text-gray-400">{s.shipped_at ? new Date(s.shipped_at).toLocaleDateString() : ''}</p>
            </div>
          ))}
          {shipments.length === 0 && <div className="text-center py-20 text-gray-400">No shipments yet.</div>}
        </div>
      )}
    </div>
  )
}
