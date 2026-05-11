export const dynamic = 'force-dynamic'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

function getSb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export async function POST() {
  try {
    const sb = getSb()

    // Get all shipments with a customer name
    const { data: shipments, error: shipErr } = await sb
      .from('shipments')
      .select('*')
      .not('customer_name', 'is', null)
      .order('ship_date', { ascending: true })

    if (shipErr) return NextResponse.json({ error: shipErr.message }, { status: 500 })
    if (!shipments || shipments.length === 0) {
      return NextResponse.json({ imported: 0, message: 'No shipments found.' })
    }

    // Get all existing real invoices (non-zero amount) linked to shipments
    const { data: existingInvoices } = await sb
      .from('invoices')
      .select('shipment_id, total_amount')
      .not('shipment_id', 'is', null)
      .gt('total_amount', 0)

    const reallyInvoicedIds = new Set(
      (existingInvoices ?? []).map((i: { shipment_id: string }) => i.shipment_id)
    )

    // Only process shipments that don't already have a real (non-zero) invoice
    const toImport = shipments.filter(s => !reallyInvoicedIds.has(s.id))

    if (toImport.length === 0) {
      return NextResponse.json({ imported: 0, message: 'All shipments already have invoices.' })
    }

    // Get current invoice count to start sequential numbering
    const year = new Date().getFullYear()
    const prefix = `INV-${year}-`
    const { count } = await sb
      .from('invoices')
      .select('*', { count: 'exact', head: true })
      .like('invoice_number_display', `${prefix}%`)

    let seq = (count ?? 0) + 1

    // Build customer lookup map
    const { data: customers } = await sb
      .from('customers')
      .select('id,company_name')
      .eq('is_active', true)

    const customerMap: Record<string, string> = {}
    if (customers) {
      customers.forEach((c: { id: string; company_name: string }) => {
        customerMap[c.company_name.trim().toLowerCase()] = c.id
      })
    }

    const todayStr = new Date().toISOString().slice(0, 10)
    const imported: string[] = []
    const skipped: string[] = []

    for (const ship of toImport) {
      const invoiceNumber = `${prefix}${String(seq).padStart(4, '0')}`
      const invoiceDate = ship.ship_date ?? ship.order_date ?? todayStr

      const due = new Date(invoiceDate + 'T00:00:00')
      due.setDate(due.getDate() + 30)
      const dueDate = due.toISOString().slice(0, 10)

      const amount = ship.ship_cost ?? 0
      const customerName = (ship.customer_name ?? '').trim()
      const customerId = customerMap[customerName.toLowerCase()] ?? null

      const { data: inv, error: invErr } = await sb.from('invoices').insert({
        invoice_number: invoiceNumber,
        invoice_number_display: invoiceNumber,
        invoice_type: 'invoice',
        shipment_id: ship.id,
        customer_id: customerId,
        invoice_date: invoiceDate,
        due_date: dueDate,
        subtotal: amount,
        tax_rate: 0,
        tax_amount: 0,
        total_amount: amount,
        amount,
        amount_paid: 0,
        balance_due: amount,
        payment_terms: 'Net 30',
        payment_type: 'standard',
        deposit_percent: 0,
        deposit_amount: 0,
        deposit_paid: false,
        production_blocked: false,
        shipping_blocked: false,
        po_number: ship.po_number ?? null,
        status: 'pending',
        reminder_count: 0,
        sent_to_finance: false,
        is_active: true,
        notes: 'Imported from shipment record. Default status: Unpaid. Please verify amount and update payment status.',
      }).select('id,invoice_number_display').single()

      if (invErr || !inv) {
        skipped.push(ship.id)
        continue
      }

      // Add line item for the shipping cost
      const lineDesc = [
        'Shipping',
        ship.carrier ? `· ${ship.carrier}` : '',
        ship.tracking_number ? `· ${ship.tracking_number}` : '',
        ship.city && ship.state ? `· ${ship.city}, ${ship.state}` : '',
      ].filter(Boolean).join(' ')

      await sb.from('invoice_line_items').insert({
        invoice_id: inv.id,
        sku: null,
        description: lineDesc,
        quantity: 1,
        unit_price: amount,
        uom: 'EA',
        line_total: amount,
      })

      // Link the shipment back to the invoice
      await sb.from('shipments').update({
        invoice_id: inv.id,
        invoice_number: inv.invoice_number_display,
      }).eq('id', ship.id)

      imported.push(inv.invoice_number_display)
      seq++
    }

    return NextResponse.json({
      imported: imported.length,
      skipped: skipped.length,
      invoices: imported,
    })
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
