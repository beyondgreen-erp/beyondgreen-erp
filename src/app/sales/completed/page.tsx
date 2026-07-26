'use client'

import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Row {
  id: string; order_number: string | null; po_number: string | null; status: string;
  ship_date: string | null; required_ship_date: string | null; total: number | null; subtotal: number | null;
  purchase_order_url: string | null; packing_slip_url: string | null; bol: string | null;
  customers?: { company_name: string } | null;
  inv?: { display: string; url: string | null } | null;
  photos?: number;
}

const fmtD = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const fmt$ = (n: number | null | undefined) => (n || n === 0) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n) : '—'

function DocPill({ label, href, present }: { label: string; href?: string | null; present: boolean }) {
  const base = 'text-[11px] px-2 py-0.5 rounded-full border inline-flex items-center gap-1 '
  if (present && href) return <a href={href} target="_blank" rel="noreferrer" className={base + 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 hover:bg-emerald-500/20'}>{label} ✓</a>
  if (present) return <span className={base + 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20'}>{label} ✓</span>
  return <span className={base + 'bg-[#F3F4F6] text-gray-400 border-[#E4E6EE]'}>{label} —</span>
}

export default function CompletedOrdersPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')

  async function load() {
    setLoading(true)
    const { data: orders } = await sb.from('sales_orders')
      .select('id, order_number, po_number, status, ship_date, required_ship_date, total, subtotal, purchase_order_url, packing_slip_url, bol, customers(company_name)')
      .in('status', ['Shipped', 'Completed', 'Closed', 'Ready for Invoice'])
      .order('ship_date', { ascending: false, nullsFirst: false })
      .limit(500)
    const list = (orders ?? []) as any[]
    const ids = list.map(o => o.id)
    const invMap: Record<string, { display: string; url: string | null }> = {}
    const photoMap: Record<string, number> = {}
    if (ids.length) {
      const { data: invs } = await sb.from('invoices').select('sales_order_id, invoice_number, invoice_number_display').in('sales_order_id', ids)
      for (const iv of (invs ?? []) as any[]) {
        if (iv.sales_order_id && !invMap[iv.sales_order_id]) invMap[iv.sales_order_id] = { display: iv.invoice_number_display || iv.invoice_number || 'Invoice', url: null }
      }
      try {
        const { data: files } = await sb.from('file_attachments').select('record_id').eq('record_type', 'sales_order').in('record_id', ids)
        for (const f of (files ?? []) as any[]) photoMap[f.record_id] = (photoMap[f.record_id] || 0) + 1
      } catch { /* file_attachments optional */ }
    }
    setRows(list.map(o => ({ ...o, inv: invMap[o.id] || null, photos: photoMap[o.id] || 0 })))
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const filtered = rows.filter(r => {
    const s = q.trim().toLowerCase()
    if (!s) return true
    return [r.order_number, r.po_number, r.customers?.company_name].some(v => (v || '').toLowerCase().includes(s))
  })

  const docsComplete = (r: Row) => !!(r.packing_slip_url || r.bol) && !!r.inv

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-[#1A1D2E]">Completed Orders</h1>
          <p className="text-sm text-gray-500 mt-1">Shipped &amp; completed orders with every document in one place. Green = ready for invoice (all shipping docs present).</p>
        </div>
        <div className="flex items-center gap-2">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search order, PO, customer…"
            className="bg-white border border-[#E4E6EE] rounded-xl px-3 py-2 text-sm w-56 focus:outline-none focus:border-[#3B6FE0]" />
          <button onClick={load} className="text-sm border border-[#E4E6EE] text-[#6B7280] hover:text-[#1A1D2E] px-3 py-2 rounded-xl">Refresh</button>
        </div>
      </div>

      {loading ? <p className="text-sm text-gray-400">Loading…</p> : filtered.length === 0 ? (
        <div className="bg-white border border-[#E4E6EE] rounded-2xl p-10 text-center text-sm text-gray-400">No completed orders yet.</div>
      ) : (
        <div className="bg-white border border-[#E4E6EE] rounded-2xl overflow-hidden">
          <div className="grid grid-cols-[1.3fr_1.5fr_auto_auto_2.4fr_auto] gap-3 px-4 py-2.5 bg-[#F5F6FA] text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
            <span>Order</span><span>Customer</span><span>Shipped</span><span className="text-right">Total</span><span>Documents</span><span>Invoice-ready</span>
          </div>
          <div className="divide-y divide-[#F0F1F5]">
            {filtered.map(r => (
              <div key={r.id} className="grid grid-cols-[1.3fr_1.5fr_auto_auto_2.4fr_auto] gap-3 px-4 py-3 items-center">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[#1A1D2E] truncate">{r.order_number || r.po_number || '—'}</div>
                  <div className="text-[11px] text-gray-400">{r.status}{r.po_number && r.order_number !== r.po_number ? ` · PO ${r.po_number}` : ''}</div>
                </div>
                <span className="text-sm text-gray-600 truncate">{r.customers?.company_name || '—'}</span>
                <span className="text-xs text-gray-500 whitespace-nowrap">{fmtD(r.ship_date || r.required_ship_date)}</span>
                <span className="text-sm text-right tabular-nums text-[#1A1D2E]">{fmt$(r.total ?? r.subtotal)}</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <DocPill label="PO" href={r.purchase_order_url} present={!!r.purchase_order_url} />
                  <DocPill label="Slip" href={r.packing_slip_url} present={!!r.packing_slip_url} />
                  <DocPill label="BOL" present={!!r.bol} />
                  <DocPill label={r.photos ? `Photos (${r.photos})` : 'Photos'} present={!!r.photos} />
                  <DocPill label={r.inv ? r.inv.display : 'Invoice'} present={!!r.inv} />
                </div>
                <span className={'text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap ' + (docsComplete(r) ? 'bg-emerald-500/15 text-emerald-600 border-emerald-500/20' : 'bg-amber-500/15 text-amber-600 border-amber-500/20')}>
                  {docsComplete(r) ? 'Ready' : 'Missing docs'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
