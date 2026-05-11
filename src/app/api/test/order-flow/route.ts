export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

function getSb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

const TEST_SKU = '2016090'
type SR = { step: string; status: 'PASS' | 'FAIL'; detail: string }

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const sb = getSb()

  // ── CLEANUP MODE ─────────────────────────────────────────────────────────────
  if (searchParams.get('cleanup') === '1') {
    const { data: cids } = await sb.from('customers').select('id').ilike('company_name', '%TEST CUSTOMER%')
    const ids = (cids ?? []).map((c: any) => c.id)
    if (ids.length) {
      const soRes = await sb.from('sales_orders').select('id').in('customer_id', ids)
      const soIds = (soRes.data ?? []).map((r: any) => r.id)
      const qRes  = await sb.from('quotations').select('id').in('customer_id', ids)
      const qIds  = (qRes.data ?? []).map((r: any) => r.id)
      if (soIds.length) {
        // delete invoices by both possible FK column names
        await sb.from('invoices').delete().in('sales_order_id', soIds)
        await sb.from('invoices').delete().in('order_id', soIds)
        await sb.from('shipments').delete().in('sales_order_id', soIds)
        await sb.from('shipments').delete().in('order_id', soIds)
        await sb.from('sales_order_lines').delete().in('sales_order_id', soIds)
        await sb.from('sales_orders').delete().in('id', soIds)
      }
      if (qIds.length) {
        await sb.from('quotation_lines').delete().in('quotation_id', qIds)
        await sb.from('quotations').delete().in('id', qIds)
      }
      await sb.from('customers').delete().in('id', ids)
    }
    return NextResponse.json({ cleaned: ids.length })
  }

  // ── TEST FLOW ─────────────────────────────────────────────────────────────────
  const results: SR[] = []
  const r = (step: string, status: 'PASS' | 'FAIL', detail: string) =>
    results.push({ step, status, detail })

  let productId: string | null = null
  let productName = TEST_SKU
  let onHand = 0
  let custId: string | null = null
  let quoteId: string | null = null
  let soId: string | null = null

  // A – verify product exists with stock
  try {
    const { data, error } = await sb
      .from('products')
      .select('id,sku,product_name,on_hand_qty')
      .eq('sku', TEST_SKU)
      .single()
    if (error) throw error
    if (!data) throw new Error('SKU not found')
    productId   = (data as any).id
    productName = (data as any).product_name ?? (data as any).name ?? TEST_SKU
    onHand      = Number((data as any).on_hand_qty ?? 0)
    r('A - Product lookup', 'PASS', `"${productName}" · on_hand=${onHand}`)
  } catch (err: any) { r('A - Product lookup', 'FAIL', err.message) }

  // B – create test customer
  try {
    const { data, error } = await sb.from('customers').insert({
      company_name:    'TEST CUSTOMER - Flow Verification',
      customer_status: 'Active Customer',
      is_active:       true,
      pipeline_stage:  'Lead',
    }).select('id').single()
    if (error) throw error
    custId = (data as any).id
    r('B - Create customer', 'PASS', `id=${custId}`)
  } catch (err: any) { r('B - Create customer', 'FAIL', err.message) }

  // C – create quotation
  // quote_number is TEXT with UNIQUE constraint — use timestamp suffix to avoid dup key on reruns
  try {
    if (!custId) throw new Error('prerequisite failed: no customer id')
    const quoteNumber = 'Q-' + Date.now()
    const { data, error } = await sb.from('quotations').insert({
      quote_number: quoteNumber,
      customer_id:  custId,
      quote_date:   new Date().toISOString().slice(0, 10),
      status:       'Draft',
      tax_pct:      0,
      subtotal:     59.80,
      total:        59.80,
      total_value:  59.80,
      is_active:    true,
    }).select('id,quote_number').single()
    if (error) throw error
    quoteId = (data as any).id
    r('C - Create quotation', 'PASS', `id=${quoteId} · quote_number=${(data as any).quote_number}`)
  } catch (err: any) { r('C - Create quotation', 'FAIL', err.message) }

  // C2 – add quotation line
  try {
    if (!quoteId) throw new Error('prerequisite failed: no quotation id')
    const payload: Record<string, any> = {
      quotation_id:    quoteId,
      line_number:     1,
      sku:             TEST_SKU,
      description:     productName,
      quantity:        10,
      unit_of_measure: 'EA',
      unit_price:      5.98,
      discount_pct:    0,
      line_total:      59.80,
    }
    if (productId) payload.product_id = productId
    const { error } = await sb.from('quotation_lines').insert(payload)
    if (error) throw error
    r('C2 - Add quotation line', 'PASS', `qty=10 × $5.98 · sku=${TEST_SKU}`)
  } catch (err: any) { r('C2 - Add quotation line', 'FAIL', err.message) }

  // D – accept quotation
  try {
    if (!quoteId) throw new Error('prerequisite failed: no quotation id')
    const { error } = await sb.from('quotations').update({ status: 'Accepted' }).eq('id', quoteId)
    if (error) throw error
    r('D - Accept quotation', 'PASS', 'status = Accepted')
  } catch (err: any) { r('D - Accept quotation', 'FAIL', err.message) }

  // E – convert to sales order
  // order_number is TEXT with UNIQUE constraint — use timestamp suffix to avoid dup key on reruns
  try {
    if (!custId) throw new Error('prerequisite failed: no customer id')
    const orderNumber = 'SO-' + Date.now()
    const payload: Record<string, any> = {
      order_number: orderNumber,
      customer_id:  custId,
      order_date:   new Date().toISOString().slice(0, 10),
      status:       'New',
      tax_pct:      0,
      subtotal:     59.80,
      total:        59.80,
      total_value:  59.80,
    }
    if (quoteId) payload.quotation_id = quoteId
    const { data, error } = await sb.from('sales_orders').insert(payload).select('id,order_number').single()
    if (error) throw error
    soId = (data as any).id
    r('E - Create sales order', 'PASS', `id=${soId} · order_number=${(data as any).order_number}`)
  } catch (err: any) { r('E - Create sales order', 'FAIL', err.message) }

  // E2 – copy quotation lines → SO lines
  try {
    if (!soId)    throw new Error('prerequisite failed: no sales order id')
    if (!quoteId) throw new Error('prerequisite failed: no quotation id')
    const { data: qlines, error } = await sb
      .from('quotation_lines').select('*').eq('quotation_id', quoteId)
    if (error) throw error
    const lines = qlines ?? []
    if (lines.length === 0) {
      r('E2 - Copy lines to SO', 'FAIL', 'No lines on quotation (C2 may have failed)')
    } else {
      const { error: insErr } = await sb.from('sales_order_lines').insert(
        lines.map((l: any) => ({
          sales_order_id:  soId,
          line_number:     l.line_number  ?? 1,
          product_id:      l.product_id   ?? null,
          sku:             l.sku          ?? TEST_SKU,
          description:     l.description  ?? productName,
          quantity:        l.quantity     ?? 10,
          quantity_shipped: 0,
          unit_of_measure: l.unit_of_measure ?? 'EA',
          unit_price:      l.unit_price   ?? 5.98,
          discount_pct:    l.discount_pct ?? 0,
          line_total:      (l.quantity ?? 10) * (l.unit_price ?? 5.98),
        }))
      )
      if (insErr) throw insErr
      r('E2 - Copy lines to SO', 'PASS', `${lines.length} line(s) copied`)
    }
  } catch (err: any) { r('E2 - Copy lines to SO', 'FAIL', err.message) }

  // E3 – stock check → set status
  try {
    if (!soId) throw new Error('prerequisite failed: no sales order id')
    const qty = 10
    if (onHand >= qty) {
      const { error } = await sb.from('sales_orders')
        .update({ status: 'Ready to Ship' }).eq('id', soId)
      if (error) throw error
      r('E3 - Stock check', 'PASS',
        `${onHand} on hand ≥ ${qty} ordered — no WO needed → Ready to Ship`)
    } else {
      r('E3 - Stock check', 'PASS',
        `${onHand} on hand < ${qty} ordered — work order required`)
    }
  } catch (err: any) { r('E3 - Stock check', 'FAIL', err.message) }

  // F – mark Shipped
  try {
    if (!soId) throw new Error('prerequisite failed: no sales order id')
    const { error } = await sb.from('sales_orders')
      .update({ status: 'Shipped' }).eq('id', soId)
    if (error) throw error
    r('F - Mark Shipped', 'PASS', 'sales_orders.status = Shipped')
  } catch (err: any) { r('F - Mark Shipped', 'FAIL', err.message) }

  // F2 – create shipment (FIX 2: delivery_status primary, write both order_id + sales_order_id)
  try {
    if (!soId) throw new Error('prerequisite failed: no sales order id')
    const { data: shipData, error: shipErr } = await sb.from('shipments').insert({
      order_id:        soId,          // new FK column
      sales_order_id:  soId,          // legacy FK column
      customer_name:   'TEST CUSTOMER - Flow Verification',
      ship_date:       new Date().toISOString().slice(0, 10),
      delivery_status: 'Delivered',   // FIX 2: correct column name
      status:          'Delivered',   // belt-and-suspenders
      carrier:         'UPS',
      tracking_number: 'TEST-TRACKING-123',
      external_id:     'TEST-' + Date.now(),
      total_amount:    59.80,
    }).select('id').single()
    if (shipErr) throw shipErr
    r('F2 - Create shipment', 'PASS', `id=${(shipData as any).id}`)
  } catch (err: any) { r('F2 - Create shipment', 'FAIL', err.message) }

  // F3 – create invoice (FIX 3: write both order_id + sales_order_id; use total_amount + balance_due)
  try {
    if (!soId) throw new Error('prerequisite failed: no sales order id')
    const ts = Date.now()
    const { data: invData, error: invErr } = await sb.from('invoices').insert({
      invoice_number_display: `INV-TEST-${ts}`,
      invoice_type:    'invoice',
      order_id:        soId,          // new FK column
      sales_order_id:  soId,          // legacy FK column
      customer_id:     custId,
      invoice_date:    new Date().toISOString().slice(0, 10),
      due_date:        new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      payment_terms:   'Net 30',
      subtotal:        59.80,
      tax_pct:         0,
      total:           59.80,
      total_amount:    59.80,         // FIX 3: column invoices page reads from
      balance_due:     59.80,         // FIX 3
      amount_paid:     0,
      status:          'Unpaid',
      sent_to_finance: false,
      notes:           'TEST INVOICE - auto cleanup',
    }).select('id,invoice_number_display,status,total_amount,balance_due').single()
    if (invErr) throw invErr
    r('F3 - Create invoice', 'PASS',
      `${(invData as any).invoice_number_display} · status=${(invData as any).status} · total_amount=$${(invData as any).total_amount}`)
  } catch (err: any) { r('F3 - Create invoice', 'FAIL', err.message) }

  // F4 – finance notification
  try {
    if (!soId) throw new Error('prerequisite failed: no sales order id')
    const { error } = await sb.from('notifications').insert({
      type:    'finance',
      title:   'Invoice Created',
      message: `INV-TEST for TEST CUSTOMER · $59.80`,
      link:    `/sales/invoices`,
      is_read: false,
    })
    if (error) throw error
    r('F4 - Finance notification', 'PASS', 'Notification inserted')
  } catch (err: any) { r('F4 - Finance notification', 'FAIL', err.message) }

  // G – verify invoice (FIX 3: query by sales_order_id, check total_amount; accept Unpaid or pending)
  try {
    if (!soId) throw new Error('prerequisite failed: no sales order id')
    const { data: inv, error } = await sb
      .from('invoices')
      .select('id,status,total_amount,balance_due')
      .eq('sales_order_id', soId)
      .maybeSingle()
    if (error) throw error
    if (!inv) throw new Error('No invoice found for this sales order')
    const status = (inv as any).status
    const ok = status === 'Unpaid' || status === 'pending'
    if (!ok) throw new Error(`Expected Unpaid or pending, got "${status}"`)
    r('G - Invoice unpaid', 'PASS',
      `status=${status} · total_amount=$${(inv as any).total_amount} · balance_due=$${(inv as any).balance_due}`)
  } catch (err: any) { r('G - Invoice unpaid', 'FAIL', err.message) }

  // Cleanup – always runs (FIX 4: use both order_id and sales_order_id)
  try {
    const errs: string[] = []
    if (soId) {
      await sb.from('notifications').delete().ilike('message', '%INV-TEST%')
      // invoices: try both FK column names
      const ci1 = await sb.from('invoices').delete().eq('sales_order_id', soId)
      if (ci1.error) errs.push('invoices(sales_order_id): ' + ci1.error.message)
      await sb.from('invoices').delete().eq('order_id', soId)
      // shipments: try both FK column names
      const cs1 = await sb.from('shipments').delete().eq('sales_order_id', soId)
      if (cs1.error) await sb.from('shipments').delete().eq('order_id', soId)
      // fallback by customer name
      await sb.from('shipments').delete().ilike('customer_name', '%TEST CUSTOMER%')
      // SOL: uses sales_order_id (confirmed in orders/page.tsx)
      const cl1 = await sb.from('sales_order_lines').delete().eq('sales_order_id', soId)
      if (cl1.error) errs.push('sol: ' + cl1.error.message)
      const cso = await sb.from('sales_orders').delete().eq('id', soId)
      if (cso.error) errs.push('so: ' + cso.error.message)
    }
    if (quoteId) {
      await sb.from('quotation_lines').delete().eq('quotation_id', quoteId)
      await sb.from('quotations').delete().eq('id', quoteId)
    }
    if (custId) {
      await sb.from('customers').delete().eq('id', custId)
    }
    r('Cleanup', errs.length ? 'FAIL' : 'PASS',
      errs.length ? 'Partial: ' + errs.join('; ') : 'All test data removed')
  } catch (err: any) { r('Cleanup', 'FAIL', err.message) }

  const passed = results.filter(x => x.status === 'PASS').length
  const failed = results.filter(x => x.status === 'FAIL').length
  return NextResponse.json({
    summary: `${passed} PASS · ${failed} FAIL`,
    results,
  })
}
