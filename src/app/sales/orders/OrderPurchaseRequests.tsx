'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

// What the order sees of the Purchasing Requests board.
//
// A purchasing request is tied to a sales order by one field on the request, "Order #
// (Sales Order)". Almost nobody fills it in, so the old banner sent people to a board
// that looked empty with no explanation. This shows what is actually tagged before
// anybody clicks, says so plainly when nothing is, and gives a way to raise a request
// that is already tagged correctly.

// New requests land on the log the purchasing team actually works out of.
const LOG_GROUP_KEY = 'group_mkzk3jaa'
const LOG_GROUP_TITLE = '2026 - PO & Receiving Log'

const DONE = ['Received', 'Cancelled']

type Req = {
  id: string
  name: string | null
  custom_name: string | null
  supplier: string | null
  status: string | null
  qty_ordered: string | null
  po_number: string | null
}

export default function OrderPurchaseRequests({
  orderNumber,
  customer,
}: {
  orderNumber: string
  customer?: string | null
}) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<Req[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const num = (orderNumber || '').trim()

  const load = useCallback(async () => {
    if (!num) { setRows([]); return }
    const { data, error } = await sb
      .from('purchasing_requests')
      .select('id,name,custom_name,supplier,status,qty_ordered,po_number')
      .eq('is_active', true)
      .ilike('order_ref', '%' + num + '%')
      .order('created_at', { ascending: false })
    if (error) { setErr(error.message); setRows([]); return }
    setRows((data ?? []) as Req[])
  }, [sb, num])

  useEffect(() => { load() }, [load])

  async function raise() {
    setBusy(true)
    setErr('')
    const { error } = await sb.from('purchasing_requests').insert({
      name: 'BOM components for order ' + num,
      order_ref: num,
      customer_project: customer || null,
      status: 'Pending Order',
      group_key: LOG_GROUP_KEY,
      group_title: LOG_GROUP_TITLE,
      is_active: true,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    load()
  }

  const href = '/sales/purchase-orders?order=' + encodeURIComponent(num)

  if (rows === null) {
    return <p className="text-xs text-amber-700">Checking the Purchasing Requests board...</p>
  }

  return (
    <div className="text-xs">
      {rows.length === 0 ? (
        <p className="text-amber-700 mb-2">
          Nothing on the Purchasing Requests board is tagged to order {num || 'this order'} yet, so there is
          nothing to list here. A request only shows up once its{' '}
          <span className="font-semibold">Order # (Sales Order)</span> field holds the order number.
        </p>
      ) : (
        <div className="mb-2 space-y-1">
          {rows.map((r) => {
            const done = DONE.includes(r.status || '')
            return (
              <div key={r.id} className="flex items-baseline justify-between gap-3 bg-white/70 rounded px-2 py-1">
                <span className="text-amber-900 truncate">{r.custom_name || r.name || 'Untitled request'}</span>
                <span className="text-amber-700 whitespace-nowrap">
                  {r.supplier ? r.supplier + ' · ' : ''}
                  {r.qty_ordered ? 'qty ' + r.qty_ordered + ' · ' : ''}
                  {r.po_number ? 'PO ' + r.po_number + ' · ' : ''}
                  <span className={done ? 'text-emerald-700 font-semibold' : 'font-semibold'}>
                    {r.status || 'No status'}
                  </span>
                </span>
              </div>
            )
          })}
        </div>
      )}

      {err && <p className="text-red-600 mb-2">{err}</p>}

      <div className="flex items-center gap-3 flex-wrap">
        <a href={href} className="font-semibold text-amber-800 underline hover:text-amber-900">
          Open the Purchasing Requests board &rarr;
        </a>
        <button
          onClick={raise}
          disabled={busy || !num}
          className="px-2.5 py-1 rounded border border-amber-300 bg-white text-amber-900 font-semibold disabled:opacity-50"
        >
          {busy ? 'Creating...' : 'Raise a request for this order'}
        </button>
      </div>
    </div>
  )
}
