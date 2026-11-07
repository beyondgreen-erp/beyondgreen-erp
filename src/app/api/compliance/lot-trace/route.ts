/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// Lot trace for recalls and mock recalls.
// Backward: raw material lots used. Production: when, where, how much. Forward: who received it.
// Shipments in the ERP do not all carry lot numbers yet, so forward trace also lists every shipment of the
// same SKU after the lot was made ("possible exposure"), which is how a recall is scoped when lot capture is incomplete.
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  const windowDays = Math.min(365, Math.max(7, Number(req.nextUrl.searchParams.get('days')) || 90))
  if (!q) return NextResponse.json({ error: 'Enter a lot number or SKU' }, { status: 400 })
  try {
    // 1) find the lot
    const { data: lotRows } = await sb.from('lot_codes').select('*').ilike('lot_number', q).limit(1)
    let lot: any = lotRows?.[0] || null
    const { data: wpeExact } = await sb.from('walmart_production_entries').select('id,production_date,sku,qty,lot_number,entered_by,work_order_id,voided_at').ilike('lot_number', q).is('voided_at', null)
    if (!lot && wpeExact?.length) {
      const first = wpeExact.reduce((a: any, b: any) => (String(a.production_date) < String(b.production_date) ? a : b))
      lot = { lot_number: first.lot_number, sku: first.sku, produced_date: first.production_date, qty_produced: wpeExact.reduce((a: number, r: any) => a + (Number(r.qty) || 0), 0), qty_remaining: null, lot_type: 'Finished Goods', work_order_id: first.work_order_id }
    }
    if (!lot) {
      // Treat the query as a SKU: offer its recent lots to pick from
      const { data: bySku } = await sb.from('lot_codes').select('lot_number,sku,product_name,produced_date,qty_produced,qty_remaining').ilike('sku', q).order('produced_date', { ascending: false }).limit(25)
      const { data: rcv } = await sb.from('receiving').select('lot_number,sku,product_name,supplier,received_date,qty_received').or(`lot_number.ilike.${q},sku.ilike.${q}`).order('received_date', { ascending: false }).limit(25)
      return NextResponse.json({ found: false, candidates: bySku || [], rawLots: rcv || [] })
    }

    const sku = String(lot.sku || '')
    const produced = lot.produced_date ? String(lot.produced_date).slice(0, 10) : null
    const until = produced ? new Date(new Date(produced).getTime() + windowDays * 86400000).toISOString().slice(0, 10) : null

    // 2) production detail
    const production = (wpeExact || []).map((r: any) => ({ date: r.production_date, qty: Number(r.qty) || 0, by: r.entered_by, work_order_id: r.work_order_id }))
    let workOrder: any = null
    if (lot.work_order_id) {
      const { data: wo } = await sb.from('work_orders').select('*').eq('id', lot.work_order_id).maybeSingle()
      workOrder = wo ? { id: wo.id, number: wo.wo_number || wo.wo_code || null, machine: wo.assigned_machine || lot.machine || null, operator: wo.assigned_operator || null, status: wo.status || null, qty: wo.qty_produced ?? wo.qty_completed ?? null } : null
    }

    // 3) backward: raw material lots
    let inputLots: string[] = []
    try { inputLots = (Array.isArray(lot.input_lots) ? lot.input_lots : JSON.parse(lot.input_lots || '[]')).map((x: any) => (typeof x === 'string' ? x : x?.lot_number || x?.lot)).filter(Boolean) } catch { inputLots = [] }
    let rawMaterials: any[] = []
    if (inputLots.length) {
      const { data: rcv } = await sb.from('receiving').select('lot_number,sku,product_name,supplier,received_date,qty_received,qty_remaining').in('lot_number', inputLots)
      rawMaterials = rcv || []
    }

    // 4) forward: exact lot shipments
    const { data: exactShip } = await sb.from('shipment_lines').select('qty_shipped,lot_number,shipment_id,sku').ilike('lot_number', lot.lot_number)
    let exact: any[] = []
    if (exactShip?.length) {
      const ids = exactShip.map((x: any) => x.shipment_id)
      const { data: sh } = await sb.from('shipments').select('id,ship_date,customer_name,po_number,city,state').in('id', ids)
      exact = exactShip.map((x: any) => ({ ...x, ...(sh || []).find((s: any) => s.id === x.shipment_id) }))
    }

    // 5) forward: possible exposure, same SKU shipped after the lot was made
    const exposure: any[] = []
    if (sku && produced) {
      const { data: lines } = await sb.from('sales_order_lines').select('sku,quantity_shipped,sales_order_id,order_id').ilike('sku', sku).gt('quantity_shipped', 0).limit(2000)
      const orderIds = Array.from(new Set((lines || []).map((l: any) => l.sales_order_id || l.order_id).filter(Boolean)))
      if (orderIds.length) {
        const { data: orders } = await sb.from('sales_orders').select('id,order_number,ship_date,customer_id,po_number,shipping_address').in('id', orderIds).gte('ship_date', produced).lte('ship_date', until!)
        const custIds = Array.from(new Set((orders || []).map((o: any) => o.customer_id).filter(Boolean)))
        const { data: custs } = custIds.length ? await sb.from('customers').select('id,company_name,email,phone').in('id', custIds) : { data: [] as any[] }
        for (const o of orders || []) {
          const qty = (lines || []).filter((l: any) => (l.sales_order_id || l.order_id) === o.id).reduce((a: number, l: any) => a + (Number(l.quantity_shipped) || 0), 0)
          const c = (custs || []).find((x: any) => x.id === o.customer_id)
          exposure.push({ channel: 'Order', ref: o.order_number, po: o.po_number, date: o.ship_date, customer: c?.company_name || 'Customer', contact: c?.email || c?.phone || '', destination: o.shipping_address || '', qty })
        }
      }
      const { data: wl } = await sb.from('walmart_board_lines').select('order_id,part_number,qty').ilike('part_number', sku)
      const wIds = Array.from(new Set((wl || []).map((x: any) => x.order_id)))
      if (wIds.length) {
        const { data: wo } = await sb.from('walmart_board_orders').select('id,name,po_number,bol_date,facility,load_number,ship_to,lot').in('id', wIds).gte('bol_date', produced).lte('bol_date', until!)
        for (const o of wo || []) {
          const qty = (wl || []).filter((x: any) => x.order_id === o.id).reduce((a: number, x: any) => a + (Number(x.qty) || 0), 0)
          exposure.push({ channel: 'Walmart load', ref: o.load_number || o.name, po: o.po_number, date: o.bol_date, customer: `Walmart ${o.facility || ''}`.trim(), contact: '', destination: o.ship_to || o.facility || '', qty, lot_on_bol: o.lot || '' })
        }
      }
      exposure.sort((a, b) => String(a.date).localeCompare(String(b.date)))
    }

    // 6) quantities: produced, on hand, shipped, accounted for
    const qtyProduced = Number(lot.qty_produced) || production.reduce((a: number, r: any) => a + r.qty, 0)
    const onHand = lot.qty_remaining === null || lot.qty_remaining === undefined ? null : Number(lot.qty_remaining) || 0
    const shippedExact = exact.reduce((a, r) => a + (Number(r.qty_shipped) || 0), 0)
    // FIFO estimate when shipments do not carry the lot: the lot left on the earliest shipments after it was made
    let remaining = Math.max(0, qtyProduced - (onHand || 0) - shippedExact)
    const fifo = exposure.map(e => { const take = Math.min(remaining, e.qty || 0); remaining -= take; return { ...e, estimatedFromLot: take } })
    const estimatedShipped = fifo.reduce((a, e) => a + e.estimatedFromLot, 0)
    const accounted = (onHand || 0) + shippedExact + (shippedExact ? 0 : estimatedShipped)
    const pct = qtyProduced ? Math.min(100, (accounted / qtyProduced) * 100) : null

    const gaps: string[] = []
    if (!inputLots.length) gaps.push('No raw material (resin / film) lots are recorded on this lot, so the backward trace stops at production.')
    if (!exact.length) gaps.push('Shipments do not carry this lot number, so the forward trace is estimated from shipments of the same SKU after the lot was made (first in, first out).')
    if (onHand === null) gaps.push('On-hand quantity for this lot is not recorded.')

    return NextResponse.json({
      found: true,
      lot: { lot_number: lot.lot_number, sku, product_name: lot.product_name || '', produced_date: produced, lot_type: lot.lot_type || '', machine: lot.machine || workOrder?.machine || '', operator: lot.operator || '', status: lot.status || '', qty_produced: qtyProduced, qty_on_hand: onHand },
      workOrder, production, rawMaterials, inputLots, exact, exposure: fifo,
      totals: { qtyProduced, onHand, shippedExact, estimatedShipped, accounted, pct, customers: Array.from(new Set(fifo.filter(e => e.estimatedFromLot > 0 || shippedExact === 0).map(e => e.customer))).length },
      windowDays, gaps,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Trace failed' }, { status: 500 })
  }
}
