'use client'
import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import OrdersMirror from '@/components/OrdersMirror'
import { checkOrderReadyToShip } from '@/lib/orderFlow'

const sb = createSupabaseBrowserClient()

interface WO {
  id: string
  wo_number: string
  status: string
  sales_order_id: string
  sales_orders?: { order_number: string; customers?: { company_name: string } }
}

export default function QCPage() {
  const [items, setItems] = useState<WO[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const { data } = await sb
      .from('work_orders')
      .select('*, sales_orders!work_orders_sales_order_id_fkey(order_number, customers(company_name))')
      .in('status', ['QC', 'Complete'])
      .order('created_at', { ascending: false })
    setItems(data || [])
    setLoading(false)
  }

  const [busyId, setBusyId] = useState<string | null>(null)
  async function passQC(id: string, soId: string | null) {
    if (busyId) return
    setBusyId(id)
    try {
      // A job passed straight from QC has never been asked how much was made. Ask once, so
      // finished goods go into inventory (QC Passed books them — see wo_book_fg_on_complete).
      const wo: any = items.find(i => i.id === id) || {}
      const patch: Record<string, any> = { status: 'QC Passed', updated_at: new Date().toISOString() }
      if (!Number(wo.qty_completed)) {
        const { data: mv } = await sb.from('inventory_movements').select('qty').eq('ref_table', 'work_orders').eq('ref_id', id).eq('movement_type', 'produce')
        const booked = ((mv as any[]) || []).reduce((t, m) => t + Number(m.qty || 0), 0)
        const label = wo.wo_code || 'WO-' + wo.wo_number
        const input = window.prompt(`How many ${wo.item_part_number || 'units'} were produced IN TOTAL on ${label}?\n\nPlanned: ${wo.qty_ordered ?? '—'} ${wo.uom || ''}\nAlready in inventory: ${booked}\n\nOnly this total is counted into inventory.`, String(booked || wo.qty_ordered || ''))
        if (input == null) return
        const total = Number(input)
        if (!isFinite(total) || total < booked) { alert(`Enter a number of at least ${booked}.`); return }
        patch.qty_completed = total
      }
      const { error } = await sb.from('work_orders').update(patch).eq('id', id)
      if (error) { alert('Could not pass QC: ' + error.message); return }
      // Advance the order only when every work order on it is finished, and never backwards
      // (checkOrderReadyToShip handles both, and queues it for shipping).
      if (soId) { try { await checkOrderReadyToShip(soId) } catch (e: any) { alert('QC passed, but the order could not be moved to Ready to Ship: ' + (e?.message || e)) } }
      await load()
    } finally { setBusyId(null) }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="min-h-screen p-8 bg-gray-50">
      <p className="text-xs font-semibold text-emerald-600 uppercase tracking-widest mb-1">PRODUCTION</p>
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Quality Control</h1>

      {/* Sales orders currently in QC (mirrored from Sales Orders) */}
      <OrdersMirror statuses={['QC']} title="Sales Orders in QC" tagClass="t-purple" emoji="🔬" />

      <p className="text-gray-500 mb-6">{items.length} items awaiting QC</p>
      {loading ? (
        <div className="text-center py-20 text-gray-400">Loading...</div>
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <div key={item.id} className="bg-white rounded-xl border border-gray-100 p-5 flex items-center justify-between shadow-sm">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <span className="font-bold text-gray-900">{(item as any).wo_code || 'WO-' + item.wo_number}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">Ready for QC</span>
                </div>
                <p className="text-sm text-gray-500">{item.sales_orders?.order_number ? <>SO: {item.sales_orders.order_number} &mdash; {item.sales_orders?.customers?.company_name}</> : 'Not tied to a sales order (stock run)'}</p>
              </div>
              <button onClick={() => passQC(item.id, item.sales_order_id || null)} disabled={!!busyId} className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                {busyId === item.id ? 'Passing…' : <>Pass QC &rarr; Ship Queue</>}
              </button>
            </div>
          ))}
          {items.length === 0 && <div className="text-center py-20 text-gray-400">No items awaiting QC.</div>}
        </div>
      )}
    </div>
  )
}
