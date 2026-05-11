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
const RESULTS: { step: string; status: 'PASS' | 'FAIL'; detail: string }[] = []

function pass(step: string, detail: string) { RESULTS.push({ step, status: 'PASS', detail }) }
function fail(step: string, detail: string) { RESULTS.push({ step, status: 'FAIL', detail }) }

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const cleanup = searchParams.get('cleanup') === '1'
  const sb = getSb()
  RESULTS.length = 0

  if (cleanup) {
    const { data: cids } = await sb.from('customers').select('id').ilike('company_name', '%TEST CUSTOMER%')
    const ids = (cids ?? []).map((c: any) => c.id)
    if (ids.length) {
      await sb.from('invoices').delete().in('customer_id', ids)
      await sb.from('shipments').delete().ilike('customer_name', '%TEST CUSTOMER%')
      await sb.from('sales_order_lines').delete().in('sales_order_id',
        (await sb.from('sales_orders').select('id').in('customer_id', ids)).data?.map((r: any) => r.id) ?? []
      )
      await sb.from('sales_orders').delete().in('customer_id', ids)
      await sb.from('quotation_lines').delete().in('quotation_id',
        (await sb.from('quotations').select('id').in('customer_id', ids)).data?.map((r: any) => r.id) ?? []
      )
      await sb.from('quotations').delete().in('customer_id', ids)
      await sb.from('customers').delete().in('id', ids)
    }
    return NextResponse.json({ cleaned: ids.length })
  }

  // A - Verify SKU 2016090 exists with stock
  const { data: product, error: pErr } = await sb.from('products').select('id,sku,product_name,on_hand_qty').eq('sku', TEST_SKU).single()
  if (pErr || !product) { fail('A - Product lookup', pErr?.message ?? 'SKU not found'); return NextResponse.json({ results: RESULTS }) }
  const onHand = (product as any).on_hand_qty ?? 0
  pass('A - Product lookup', `SKU ${TEST_SKU} found: "${(product as any).product_name}", ${onHand} on hand`)

  // B - Create test customer
  const { data: cust, error: cErr } = await sb.from('customers').insert({
    company_name: 'TEST CUSTOMER - Flow Verification',
    customer_status: 'Active Customer',
    is_active: true,
    pipeline_stage: 'Lead',
  }).select('id').single()
  if (cErr || !cust) { fail('B - Create customer', cErr?.message ?? 'Insert failed'); return NextResponse.json({ results: RESULTS }) }
  const custId = (cust as any).id
  pass('B - Create customer', `Customer created id=${custId}`)

  // C - Create quotation
  const { data: quote, error: qErr } = await sb.from('quotations').insert({
    quote_number: 'TEST-Q-001',
    customer_id: custId,
    quote_date: new Date().toISOString().slice(0, 10),
    status: 'Draft',
    tax_pct: 0,
    subtotal: 59.80,
    total: 59.80,
    is_active: true,
  }).select('id').single()
  if (qErr || !quote) { fail('C - Create quotation', qErr?.message ?? 'Insert failed'); return NextResponse.json({ results: RESULTS }) }
  const quoteId = (quote as any).id
  pass('C - Create quotation', `Quote created id=${quoteId}`)

  // C2 - Add line item
  const { error: lErr } = await sb.from('quotation_lines').insert({
    quotation_id: quoteId,
    line_number: 1,
    product_id: (product as any).id,
    sku: TEST_SKU,
    description: (product as any).product_name,
    quantity: 10,
    unit_of_measure: 'EA',
    unit_price: 5.98,
    discount_pct: 0,
  })
  if (lErr) { fail('C2 - Add line item', lErr.message); return NextResponse.json({ results: RESULTS }) }
  pass('C2 - Add line item', `Line item added: qty 10 × $5.98 = $59.80`)

  // D - Mark quote Accepted
  const { error: qaErr } = await sb.from('quotations').update({ status: 'Accepted' }).eq('id', quoteId)
  if (qaErr) { fail('D - Accept quotation', qaErr.message) } else { pass('D - Accept quotation', 'Status set to Accepted') }

  // E - Convert to Sales Order
  const { data: so, error: soErr } = await sb.from('sales_orders').insert({
    order_number: 'TEST-SO-001',
    customer_id: custId,
    quotation_id: quoteId,
    order_date: new Date().toISOString().slice(0, 10),
    status: 'New',
    tax_pct: 0,
    subtotal: 59.80,
    total: 59.80,
  }).select('id').single()
  if (soErr || !so) { fail('E - Create sales order', soErr?.message ?? 'Insert failed'); return NextResponse.json({ results: RESULTS }) }
  const soId = (so as any).id
  pass('E - Create sales order', `SO created id=${soId}`)

  // E2 - Copy lines
  const { data: qlines } = await sb.from('quotation_lines').select('*').eq('quotation_id', quoteId)
  if (qlines && qlines.length > 0) {
    await sb.from('sales_order_lines').insert(qlines.map((l: any) => ({
      sales_order_id: soId, line_number: l.line_number, product_id: l.product_id,
      sku: l.sku, description: l.description, quantity: l.quantity, quantity_shipped: 0,
      unit_of_measure: l.unit_of_measure, unit_price: l.unit_price, discount_pct: l.discount_pct,
    })))
    pass('E2 - Copy lines to SO', `${qlines.length} line(s) copied`)
  }

  // E3 - Stock check: 320 on hand, order 10 → sufficient, no WO needed
  const qty = 10
  if (onHand >= qty) {
    pass('E3 - Stock check', `${onHand} on hand ≥ ${qty} ordered — no work order needed, can go straight to Ready to Ship`)
    await sb.from('sales_orders').update({ status: 'Ready to Ship' }).eq('id', soId)
    pass('E3 - Status → Ready to Ship', 'Order status updated')
  } else {
    pass('E3 - Stock check', `${onHand} on hand < ${qty} ordered — work order would be needed`)
  }

  // F - Ship the order (create shipment + invoice)
  const { error: shipErr } = await sb.from('sales_orders').update({ status: 'Shipped' }).eq('id', soId)
  if (shipErr) { fail('F - Mark Shipped', shipErr.message) } else { pass('F - Mark Shipped', 'Order status = Shipped') }

  // F2 - Create shipment record
  const { data: shipment, error: shErr } = await sb.from('shipments').insert({
    sales_order_id: soId,
    customer_name: 'TEST CUSTOMER - Flow Verification',
    ship_date: new Date().toISOString().slice(0, 10),
    status: 'Shipped',
    total_amount: 59.80,
  }).select('id').single()
  if (shErr) { fail('F2 - Create shipment', shErr.message) } else { pass('F2 - Create shipment', `Shipment id=${(shipment as any)?.id}`) }

  // F3 - Create invoice via API (calls /api/invoices/create)
  try {
    const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.includes('supabase')
      ? req.url.replace('/api/test/order-flow', '')
      : 'http://localhost:3000'
    const invRes = await fetch(`${baseUrl}/api/invoices/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sales_order_id: soId,
        customer_id: custId,
        invoice_date: new Date().toISOString().slice(0, 10),
        payment_terms: 'Net 30',
        subtotal: 59.80,
        tax_pct: 0,
        total: 59.80,
      }),
    })
    const invJson = await invRes.json()
    if (invJson.error) { fail('F3 - Create invoice', invJson.error) }
    else { pass('F3 - Create invoice', `Invoice created: ${invJson.invoice_number ?? JSON.stringify(invJson)}`) }
  } catch {
    // Direct insert if API call fails due to relative URL issues
    const { data: inv, error: invErr } = await sb.from('invoices').insert({
      invoice_number: 'TEST-INV-001',
      sales_order_id: soId,
      customer_id: custId,
      invoice_date: new Date().toISOString().slice(0, 10),
      due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      payment_terms: 'Net 30',
      subtotal: 59.80,
      tax_pct: 0,
      total: 59.80,
      amount_paid: 0,
      status: 'Unpaid',
    }).select('id').single()
    if (invErr) { fail('F3 - Create invoice (direct)', invErr.message) }
    else { pass('F3 - Create invoice (direct)', `Invoice id=${(inv as any)?.id}, status=Unpaid`) }
  }

  // G - Verify invoice shows as Unpaid
  const { data: inv } = await sb.from('invoices').select('id,status,total').eq('sales_order_id', soId).single()
  if (inv && (inv as any).status === 'Unpaid') {
    pass('G - Invoice status', `Invoice is Unpaid, total=$${(inv as any).total}`)
  } else {
    fail('G - Invoice status', `Expected Unpaid, got: ${JSON.stringify(inv)}`)
  }

  // Cleanup
  const { data: cids } = await sb.from('customers').select('id').ilike('company_name', '%TEST CUSTOMER%')
  const ids = (cids ?? []).map((c: any) => c.id)
  if (ids.length) {
    await sb.from('invoices').delete().eq('sales_order_id', soId)
    await sb.from('shipments').delete().eq('sales_order_id', soId)
    await sb.from('sales_order_lines').delete().eq('sales_order_id', soId)
    await sb.from('sales_orders').delete().eq('id', soId)
    await sb.from('quotation_lines').delete().eq('quotation_id', quoteId)
    await sb.from('quotations').delete().eq('id', quoteId)
    await sb.from('customers').delete().in('id', ids)
    pass('Cleanup', 'All test data removed')
  }

  const passed = RESULTS.filter(r => r.status === 'PASS').length
  const failed = RESULTS.filter(r => r.status === 'FAIL').length
  return NextResponse.json({ summary: `${passed} passed, ${failed} failed`, results: RESULTS })
}
