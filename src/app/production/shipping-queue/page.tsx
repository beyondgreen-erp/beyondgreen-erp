'use client'
import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const sb = createSupabaseBrowserClient()

interface QueueItem {
  id: string
  sales_order_id: string
  status: string
  sales_orders?: { order_number: string; total_amount?: number; customer_id?: string; customers?: { company_name: string } }
}

export default function ShippingQueuePage() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const { data } = await sb
      .from('shipping_queue')
      .select('*, sales_orders(order_number, total_amount, customer_id, customers(company_name))')
      .in('status', ['Pending', 'Packing'])
      .order('created_at', { ascending: false })
    setItems(data || [])
    setLoading(false)
  }

  async function ship(item: QueueItem) {
    const { data: sh } = await sb
      .from('shipments')
      .insert({ sales_order_id: item.sales_order_id, status: 'Shipped', shipped_at: new Date().toISOString() })
      .select().single()
    if (sh) {
      const { data: so } = await sb
        .from('sales_orders').select('*, sales_order_lines(*)')
        .eq('id', item.sales_order_id).single()
      if (so) {
        const { data: inv } = await sb.from('invoices').insert({
          customer_id: so.customer_id, sales_order_id: so.id, status: 'unpaid',
          invoice_date: new Date().toISOString().split('T')[0],
          due_date: new Date(Date.now() + 30 * 864e5).toISOString().split('T')[0],
          total_amount: so.total_amount || 0,
        }).select().single()
        if (inv && so.sales_order_lines?.length) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await sb.from('invoice_lines').insert(so.sales_order_lines.map((l: any) => ({
            invoice_id: inv.id, product_id: l.product_id, description: l.description || '',
            quantity: l.quantity, unit_price: l.unit_price, total_price: l.total_price,
          })))
        }
      }
    }
    await sb.from('sales_orders').update({ status: 'Shipped' }).eq('id', item.sales_order_id)
    await sb.from('shipping_queue').update({ status: 'Shipped' }).eq('id', item.id)
    load()
  }

  useEffect(() => { load() }, [])

  return (
    <div className="min-h-screen p-8 bg-gray-50">
      <p className="text-xs font-semibold text-emerald-600 uppercase tracking-widest mb-1">SHIPPING</p>
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Shipping Queue</h1>
      <p className="text-gray-500 mb-6">{items.length} orders ready to ship</p>
      {loading ? (
        <div className="text-center py-20 text-gray-400">Loading...</div>
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <div key={item.id} className="bg-white rounded-xl border border-gray-100 p-5 flex items-center justify-between shadow-sm">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <span className="font-bold text-gray-900">{item.sales_orders?.order_number}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 font-medium">{item.status}</span>
                </div>
                <p className="text-sm text-gray-500">{item.sales_orders?.customers?.company_name}</p>
              </div>
              <button onClick={() => ship(item)} className="px-4 py-2 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-700">
                Mark Shipped &rarr; Invoice
              </button>
            </div>
          ))}
          {items.length === 0 && <div className="text-center py-20 text-gray-400">No orders in shipping queue.</div>}
        </div>
      )}
    </div>
  )
}
