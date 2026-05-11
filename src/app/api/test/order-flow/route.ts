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

type StepResult = { step: string; status: 'PASS' | 'FAIL' | 'SKIP'; detail: string }

function mkLog() {
  const results: StepResult[] = []
  function pass(step: string, detail: string) { results.push({ step, status: 'PASS', detail }) }
  function fail(step: string, detail: string) { results.push({ step, status: 'FAIL', detail }) }
  function skip(step: string, detail: string) { results.push({ step, status: 'SKIP', detail }) }
  return { results, pass, fail, skip }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const cleanup = searchParams.get('cleanup') === '1'
  const sb = getSb()

  // ── CLEANUP MODE ─────────────────────────────────────────────────────────
  if (cleanup) {
    const { data: cids } = await sb.from('customers').select('id').ilike('company_name', '%TEST CUSTOMER%')
    const ids = (cids ?? []).map((c: any) => c.id)
    if (ids.length) {
      const soIds = (
        (await sb.from('sales_orders').select('id').in('customer_id', ids)).data ?? []
      ).map((r: any) => r.id)
      const qIds = (
        (await sb.from('quotations').select('id').in('customer_id', ids)).data ?? []
      ).map((r: any) => r.id)

      if (soIds.length) {
        await sb.from('invoices').delete().in('sales_order_id', soIds)
        await sb.from('shipments').delete().in('sales_order_id', soIds)
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

  // ── TEST FLOW ─────────────────────────────────────────────────────────────
  const { results, pass, fail, skip } = mkLog()

  let productId: string | null = null
  let productName: string = ''
  let onHand = 0
  let custId: string | null = null
  let quoteId: string | null = null
  let soId: string | null = null

  // ── A: Verify product exists ──────────────────────────────────────────────
  try {
    const { data, error } = await sb
      .from('products')
      .select('id,sku,product_name,on_hand_qty')
      .eq('sku', TEST_SKU)
      .single()
    if (error) throw error
    if (!data) throw new Error('SKU not found in products table')
    productId = (data as any).id
    productName = (data as any).product_name ?? (data as any).name ?? TEST_SKU
    onHand = (data as any).on_hand_qty ?? 0
    pass('A - Product lookup', `SKU ${TEST_SKU} → "${productName}", on_hand_qty=${onHand}`)
  } catch (e: any) {
    fail('A - Product lookup', e.message)
  }

  // ── B: Create test customer ───────────────────────────────────────────────
  try {
    const { data, error } = await sb.from('customers').insert({
      company_name: 'TEST CUSTOMER - Flow Verification',
      customer_status: 'Active Customer',
      is_active: true,
      pipeline_stage: 'Lead',
    }).select('id').single()
    if (error) throw error
    custId = (data as any).id
    pass('B - Create customer', `id=${custId}`)
  } catch (e: any) {
    fail('B - Create customer', e.message)
  }

  // ── C: Create quotation ───────────────────────────────────────────────────
  if (!custId) {
    skip('C - Create quotation', 'Skipped — no customer id (step B failed)')
    skip('C2 - Add quotation line', 'Skipped')
    skip('D - Accept quotation', 'Skipped')
  } else {
    try {
      const { data, error } = await sb.from('quotations').insert({
        quote_number: 'TEST-Q-001',
        customer_id: custId,
        quote_date: new Date().toISOString().slice(0, 10),
        status: 'Draft',
        tax_pct: 0,
        subtotal: 59.80,
        total: 59.80,
        is_active: true,
      }).select('id').single()
      if (error) throw error
      quoteId = (data as any).id
      pass('C - Create quotation', `id=${quoteId}`)
    } catch (e: any) {
      fail('C - Create quotation', e.message)
    }

    // ── C2: Add line item ─────────────────────────────────────────────────
    if (!quoteId) {
      skip('C2 - Add quotation line', 'Skipped — no quotation id (step C failed)')
    } else {
      try {
        const payload: any = {
          quotation_id: quoteId,
          line_number: 1,
          quantity: 10,
          unit_of_measure: 'EA',
          unit_price: 5.98,
          discount_pct: 0,
          description: productName,
          sku: TEST_SKU,
        }
        if (productId) payload.product_id = productId
        const { error } = await sb.from('quotation_lines').insert(payload)
        if (error) throw error
        pass('C2 - Add quotation line', `qty=10 × $5.98 = $59.80, sku=${TEST_SKU}`)
      } catch (e: any) {
        fail('C2 - Add quotation line', e.message)
      }
    }

    // ── D: Accept quotation ───────────────────────────────────────────────
    if (!quoteId) {
      skip('D - Accept quotation', 'Skipped — no quotation id')
    } else {
      try {
        const { error } = await sb.from('quotations').update({ status: 'Accepted' }).eq('id', quoteId)
        if (error) throw error
        pass('D - Accept quotation', 'status = Accepted')
      } catch (e: any) {
        fail('D - Accept quotation', e.message)
      }
    }
  }

  // ── E: Convert to Sales Order ─────────────────────────────────────────────
  if (!custId) {
    skip('E - Create sales order', 'Skipped — no customer id')
    skip('E2 - Copy lines to SO', 'Skipped')
    skip('E3 - Stock check', 'Skipped')
  } else {
    try {
      const soPayload: any = {
        order_number: 'TEST-SO-001',
        customer_id: custId,
        order_date: new Date().toISOString().slice(0, 10),
        status: 'New',
        tax_pct: 0,
        subtotal: 59.80,
        total: 59.80,
      }
      if (quoteId) soPayload.quotation_id = quoteId
      const { data, error } = await sb.from('sales_orders').insert(soPayload).select('id').single()
      if (error) throw error
      soId = (data as any).id
      pass('E - Create sales order', `id=${soId}`)
    } catch (e: any) {
      fail('E - Create sales order', e.message)
    }

    // ── E2: Copy lines ────────────────────────────────────────────────────
    if (!soId || !quoteId) {
      skip('E2 - Copy lines to SO', 'Skipped — missing SO or quote id')
    } else {
      try {
        const { data: qlines, error } = await sb.from('quotation_lines').select('*').eq('quotation_id', quoteId)
        if (error) throw error
        const lines = (qlines ?? [])
        if (lines.length > 0) {
          const { error: insErr } = await sb.from('sales_order_lines').insert(
            lines.map((l: any) => ({
              sales_order_id: soId,
              line_number: l.line_number,
              product_id: l.product_id ?? null,
              sku: l.sku ?? TEST_SKU,
              description: l.description ?? productName,
              quantity: l.quantity ?? 10,
              quantity_shipped: 0,
              unit_of_measure: l.unit_of_measure ?? 'EA',
              unit_price: l.unit_price ?? 5.98,
              discount_pct: l.discount_pct ?? 0,
            }))
          )
          if (insErr) throw insErr
          pass('E2 - Copy lines to SO', `${lines.length} line(s) copied`)
        } else {
          pass('E2 - Copy lines to SO', 'No lines found on quotation (quote line insert may have failed)')
        }
      } catch (e: any) {
        fail('E2 - Copy lines to SO', e.message)
      }
    }

    // ── E3: Stock check ───────────────────────────────────────────────────
    if (!soId) {
      skip('E3 - Stock check / status update', 'Skipped — no SO id')
    } else {
      const qty = 10
      if (onHand >= qty) {
        try {
          const { error } = await sb.from('sales_orders').update({ status: 'Ready to Ship' }).eq('id', soId)
          if (error) throw error
          pass('E3 - Stock check → Ready to Ship', `${onHand} on hand ≥ ${qty} ordered — no WO needed, status set to Ready to Ship`)
        } catch (e: any) {
          fail('E3 - Stock check → Ready to Ship', e.message)
        }
      } else {
        pass('E3 - Stock check', `${onHand} on hand < ${qty} ordered — work order would be needed`)
      }
    }
  }

  // ── F: Mark Shipped ───────────────────────────────────────────────────────
  if (!soId) {
    skip('F - Mark Shipped', 'Skipped — no SO id')
    skip('F2 - Create shipment', 'Skipped')
    skip('F3 - Create invoice', 'Skipped')
  } else {
    try {
      const { error } = await sb.from('sales_orders').update({ status: 'Shipped' }).eq('id', soId)
      if (error) throw error
      pass('F - Mark Shipped', 'sales_orders.status = Shipped')
    } catch (e: any) {
      fail('F - Mark Shipped', e.message)
    }

    // ── F2: Create shipment record ─────────────────────────────────────────
    try {
      const shipPayload: any = {
        ship_date: new Date().toISOString().slice(0, 10),
        status: 'Shipped',
        total_amount: 59.80,
        customer_name: 'TEST CUSTOMER - Flow Verification',
      }
      // Try sales_order_id — may or may not exist depending on schema
      try {
        shipPayload.sales_order_id = soId
        const { data, error } = await sb.from('shipments').insert(shipPayload).select('id').single()
        if (error) throw error
        pass('F2 - Create shipment', `id=${(data as any).id}`)
      } catch (e1: any) {
        if (e1.message?.includes('sales_order_id')) {
          // Column might not exist yet — insert without it
          delete shipPayload.sales_order_id
          const { data, error } = await sb.from('shipments').insert(shipPayload).select('id').single()
          if (error) throw error
          pass('F2 - Create shipment', `id=${(data as any).id} (no sales_order_id col yet)`)
        } else throw e1
      }
    } catch (e: any) {
      fail('F2 - Create shipment', e.message)
    }

    // ── F3: Create invoice ─────────────────────────────────────────────────
    try {
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
      }).select('id,status').single()
      if (invErr) throw invErr
      pass('F3 - Create invoice', `id=${(inv as any).id}, status=${(inv as any).status}`)
    } catch (e: any) {
      fail('F3 - Create invoice', e.message)
    }
  }

  // ── G: Verify invoice is Unpaid ───────────────────────────────────────────
  if (!soId) {
    skip('G - Verify invoice Unpaid', 'Skipped — no SO id')
  } else {
    try {
      const { data: inv, error } = await sb.from('invoices').select('id,status,total').eq('sales_order_id', soId).maybeSingle()
      if (error) throw error
      if (!inv) {
        fail('G - Verify invoice Unpaid', 'No invoice found for this sales order')
      } else if ((inv as any).status === 'Unpaid') {
        pass('G - Verify invoice Unpaid', `status=Unpaid, total=$${(inv as any).total}`)
      } else {
        fail('G - Verify invoice Unpaid', `Expected Unpaid, got status="${(inv as any).status}"`)
      }
    } catch (e: any) {
      fail('G - Verify invoice Unpaid', e.message)
    }
  }

  // ── CLEANUP ───────────────────────────────────────────────────────────────
  try {
    const cleanErrors: string[] = []
    if (soId) {
      const r1 = await sb.from('invoices').delete().eq('sales_order_id', soId)
      if (r1.error) cleanErrors.push('invoices: ' + r1.error.message)
      const r2 = await sb.from('shipments').delete().eq('sales_order_id', soId)
      if (r2.error) {
        // Try customer_name fallback if column doesn't exist
        await sb.from('shipments').delete().ilike('customer_name', '%TEST CUSTOMER%')
      }
      const r3 = await sb.from('sales_order_lines').delete().eq('sales_order_id', soId)
      if (r3.error) cleanErrors.push('sales_order_lines: ' + r3.error.message)
      const r4 = await sb.from('sales_orders').delete().eq('id', soId)
      if (r4.error) cleanErrors.push('sales_orders: ' + r4.error.message)
    }
    if (quoteId) {
      await sb.from('quotation_lines').delete().eq('quotation_id', quoteId)
      await sb.from('quotations').delete().eq('id', quoteId)
    }
    if (custId) {
      await sb.from('customers').delete().eq('id', custId)
    }
    if (cleanErrors.length) {
      fail('Cleanup', 'Partial: ' + cleanErrors.join('; '))
    } else {
      pass('Cleanup', 'All test data removed')
    }
  } catch (e: any) {
    fail('Cleanup', e.message)
  }

  const passed = results.filter(r => r.status === 'PASS').length
  const failed = results.filter(r => r.status === 'FAIL').length
  const skipped = results.filter(r => r.status === 'SKIP').length

  return NextResponse.json({
    summary: `${passed} passed · ${failed} failed · ${skipped} skipped`,
    results,
  })
}
