export const dynamic = 'force-dynamic'
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function getSb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

function calcDueDate(invoiceDate: string, terms: string): string {
  const d = new Date(invoiceDate + 'T00:00:00')
  const days: Record<string, number> = { 'Net 15': 15, 'Net 30': 30, 'Net 45': 45, 'Net 60': 60 }
  if (days[terms]) d.setDate(d.getDate() + days[terms])
  return d.toISOString().slice(0, 10)
}

async function genNumber(type: 'proforma' | 'invoice'): Promise<string> {
  const sb = getSb()
  const year = new Date().getFullYear()
  const prefix = type === 'proforma' ? `PF-${year}-` : `INV-${year}-`
  const { count } = await sb.from('invoices')
    .select('*', { count: 'exact', head: true })
    .like('invoice_number_display', `${prefix}%`)
  const seq = String((count ?? 0) + 1).padStart(4, '0')
  return `${prefix}${seq}`
}

export async function POST(req: NextRequest) {
  try {
    const {
      order_id, shipment_id, customer_id,
      invoice_type = 'invoice',
      total_amount = 0, subtotal, tax_rate = 0,
      payment_terms = 'Net 30', payment_type = 'standard',
      deposit_percent = 0, po_number,
      line_items = [],
      invoice_date,
      customer_name,
    } = await req.json()

    const sb = getSb()
    const today = invoice_date ?? new Date().toISOString().slice(0, 10)
    const due = calcDueDate(today, payment_terms)
    const invoiceNumber = await genNumber(invoice_type as 'proforma' | 'invoice')
    const sub = subtotal ?? total_amount
    const taxAmt = sub * tax_rate / 100
    const totalCalc = sub + taxAmt
    const depositAmt = payment_type === '50/50' ? totalCalc * (deposit_percent || 50) / 100 : 0
    const balanceDue = payment_type === '50/50' ? totalCalc - depositAmt : totalCalc
    const blocked = payment_type === 'upfront' || payment_type === '50/50'

    const { data: inv, error } = await sb.from('invoices').insert({
      invoice_number: invoiceNumber,
      invoice_number_display: invoiceNumber,
      invoice_type,
      sales_order_id: order_id ?? null,
      shipment_id: shipment_id ?? null,
      customer_id: customer_id ?? null,
      invoice_date: today,
      due_date: due,
      subtotal: sub,
      tax_rate,
      tax_amount: taxAmt,
      total_amount: totalCalc,
      amount: totalCalc,
      amount_paid: 0,
      balance_due: balanceDue,
      payment_terms,
      payment_type,
      deposit_percent: deposit_percent || (payment_type === '50/50' ? 50 : 0),
      deposit_amount: depositAmt,
      deposit_paid: false,
      production_blocked: blocked,
      shipping_blocked: blocked,
      po_number: po_number ?? null,
      status: invoice_type === 'proforma' ? 'proforma' : 'pending',
      sent_to_finance: false,
      is_active: true,
    }).select('id,invoice_number_display').single()

    if (error || !inv) return NextResponse.json({ error: error?.message ?? 'insert failed' }, { status: 500 })

    if (line_items.length > 0) {
      await sb.from('invoice_line_items').insert(
        line_items.map((l: { product_id?: string; sku?: string; description: string; quantity?: number; unit_price?: number; uom?: string }) => ({
          invoice_id: inv.id,
          product_id: l.product_id ?? null,
          sku: l.sku ?? null,
          description: l.description,
          quantity: l.quantity ?? 1,
          unit_price: l.unit_price ?? 0,
          uom: l.uom ?? 'EA',
          line_total: (l.quantity ?? 1) * (l.unit_price ?? 0),
        }))
      )
    }

    // Notify finance
    try {
      await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? 'https://beyondgreen-erp.vercel.app'}/api/invoices/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice_id: inv.id,
          invoice_number: inv.invoice_number_display,
          invoice_type,
          customer_name: customer_name ?? 'Unknown',
          po_number,
          total_amount: totalCalc,
          payment_terms,
          due_date: due,
        }),
      })
    } catch { /* non-fatal */ }

    // Notifications table entry
    try {
      await sb.from('notifications').insert({
        recipient_email: 'finance@beyondgreenbiotech.com',
        sender_email: 'erp@beyondgreenbiotech.com',
        message: `New invoice ${inv.invoice_number_display} created for ${customer_name ?? ''} — $${totalCalc.toFixed(2)} due ${due}`,
        page: 'invoices',
        record_type: 'invoices',
        is_read: false,
      })
    } catch { /* non-fatal */ }

    return NextResponse.json({ invoice_id: inv.id, invoice_number: inv.invoice_number_display })
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
