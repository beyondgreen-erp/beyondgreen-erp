'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState, useMemo, ReactNode } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { statusColor } from '@/lib/statusColors'

interface MirrorOrder {
  id: string
  order_number: string | null
  po_number: string | null
  status: string | null
  required_ship_date: string | null
  total: number | null
  total_amount: number | null
  total_value: number | null
  notes: string | null
  customers?: { company_name: string } | null
}

const fmt$ = (n: number | null | undefined) =>
  n == null ? '' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

function RowWrap({ id, onRowClick, className, children }: { id: string; onRowClick?: (orderId: string) => void; className: string; children: ReactNode }) {
  if (onRowClick) return <button type="button" onClick={() => onRowClick(id)} className={className}>{children}</button>
  return <a href={`/sales/orders?item=${id}`} className={className}>{children}</a>
}

/**
 * Live, read-through mirror of Sales Orders filtered by status. Renders an exact
 * copy of the order rows on another page (Work Orders, QC, etc.); clicking a row
 * opens the full order window on the Sales Orders page via ?item=<id>.
 */
export default function OrdersMirror({ statuses, title, tagClass = '', emoji = '', onRowClick }: { statuses: string[]; title: string; tagClass?: string; emoji?: string; onRowClick?: (orderId: string) => void }) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<MirrorOrder[]>([])
  const [loading, setLoading] = useState(true)
  const key = statuses.join(',')

  useEffect(() => {
    let alive = true
    setLoading(true)
    sb.from('sales_orders')
      .select('id, order_number, po_number, status, required_ship_date, total, total_amount, total_value, notes, customers(company_name)')
      .in('status', statuses)
      .order('required_ship_date', { ascending: true, nullsFirst: false })
      .then(({ data }) => { if (alive) { setRows((data as any[]) || []); setLoading(false) } })
    return () => { alive = false }
  }, [sb, key]) // eslint-disable-line react-hooks/exhaustive-deps

  const name = (o: MirrorOrder) => o.customers?.company_name || (o.notes ? o.notes.split('|')[0].trim() : '') || o.order_number || 'Order'
  const val = (o: MirrorOrder) => o.total_amount ?? o.total ?? o.total_value ?? null

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-[#ECEEF3] overflow-hidden mb-6">
      <div className="flex items-center gap-2 px-4 py-3" style={{ background: '#00A84F14', borderLeft: '5px solid #00A84F' }}>
        <span className={`mon-tag ${tagClass}`}>{emoji ? emoji + ' ' : ''}{title}</span>
        <span className="text-xs text-gray-500 ml-auto">{rows.length} order{rows.length !== 1 ? 's' : ''} · synced from Sales Orders</span>
      </div>
      {loading ? (
        <p className="px-4 py-4 text-xs text-gray-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-4 text-xs text-gray-400 italic">No sales orders in this stage.</p>
      ) : (
        <div className="divide-y divide-[#F4F5F8]">
          {rows.map(o => {
            const c = statusColor(o.status)
            return (
              <RowWrap key={o.id} id={o.id} onRowClick={onRowClick} className="flex items-center gap-2.5 px-4 py-2.5 mon-row no-underline w-full text-left">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#1A1D2E] truncate">{o.order_number || name(o)}</p>
                  <p className="text-xs text-gray-500 truncate">{name(o)}{o.po_number ? ' · PO ' + o.po_number : ''}</p>
                </div>
                <span className="mon-pill" style={{ background: c.bg, color: c.fg }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.solid }} />{o.status}
                </span>
                <span className="text-xs text-gray-500 w-24 text-right hidden sm:block">{o.required_ship_date || ''}</span>
                <span className="text-xs font-semibold text-gray-700 w-20 text-right shrink-0">{fmt$(val(o))}</span>
              </RowWrap>
            )
          })}
        </div>
      )}
    </div>
  )
}
