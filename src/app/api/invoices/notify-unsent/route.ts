export const dynamic = 'force-dynamic'
import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const FINANCE_EMAIL = 'finance@beyondgreenbiotech.com'
const APP_URL = 'https://beyondgreen-erp.vercel.app'

function getSb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

const fmt$ = (n: number) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`

function emailHtml(inv: any, customerName: string) {
  const due = inv.due_date ? new Date(inv.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:560px;margin:40px auto;background:#111;border:1px solid #222;border-radius:16px;overflow:hidden">
  <div style="background:#10b981;padding:28px 32px">
    <p style="margin:0;color:#fff;font-weight:700;font-size:20px">beyondGREEN ERP</p>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.75);font-size:13px">New Bill — Shipped Order</p>
  </div>
  <div style="padding:32px">
    <h2 style="color:#fff;font-size:18px;margin:0 0 6px">A shipped order has been billed — Action Required</h2>
    <p style="color:#6b7280;font-size:13px;margin:0 0 24px">This bill was created automatically when the order moved to the Shipments board.</p>
    <table style="width:100%;border-collapse:collapse;background:#1a1a1a;border-radius:10px;overflow:hidden">
      <tr><td style="padding:10px 16px;color:#9ca3af;font-size:12px;border-bottom:1px solid #2a2a2a">Invoice #</td><td style="padding:10px 16px;color:#fff;font-weight:600;font-size:13px;border-bottom:1px solid #2a2a2a">${inv.invoice_number_display}</td></tr>
      <tr><td style="padding:10px 16px;color:#9ca3af;font-size:12px;border-bottom:1px solid #2a2a2a">Customer</td><td style="padding:10px 16px;color:#e5e7eb;font-size:13px;border-bottom:1px solid #2a2a2a">${customerName || '—'}</td></tr>
      <tr><td style="padding:10px 16px;color:#9ca3af;font-size:12px;border-bottom:1px solid #2a2a2a">PO Number</td><td style="padding:10px 16px;color:#e5e7eb;font-size:13px;border-bottom:1px solid #2a2a2a">${inv.po_number ?? '—'}</td></tr>
      <tr><td style="padding:10px 16px;color:#9ca3af;font-size:12px;border-bottom:1px solid #2a2a2a">Amount</td><td style="padding:10px 16px;color:#10b981;font-weight:700;font-size:14px;border-bottom:1px solid #2a2a2a">${fmt$(inv.total_amount)}</td></tr>
      <tr><td style="padding:10px 16px;color:#9ca3af;font-size:12px;border-bottom:1px solid #2a2a2a">Payment Terms</td><td style="padding:10px 16px;color:#e5e7eb;font-size:13px;border-bottom:1px solid #2a2a2a">${inv.payment_terms ?? 'Net 30'}</td></tr>
      <tr><td style="padding:10px 16px;color:#9ca3af;font-size:12px">Due Date</td><td style="padding:10px 16px;color:#f59e0b;font-weight:600;font-size:13px">${due}</td></tr>
    </table>
    <p style="color:#9ca3af;font-size:13px;margin:20px 0 16px">Open the ERP to review the full order, its documents, and update the payment status once received.</p>
    <a href="${APP_URL}/sales/invoices" style="display:inline-block;background:#10b981;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:10px">View Bill in ERP →</a>
  </div>
  <div style="padding:16px 32px;border-top:1px solid #1f1f1f">
    <p style="color:#4b5563;font-size:11px;margin:0">Automated notification from beyondGREEN ERP</p>
  </div>
</div>
</body></html>`
}

// Emails finance for every shipment-derived bill that hasn't been sent yet, then marks it sent.
// Idempotent: safe to call repeatedly (only unsent bills are emailed). Called by the Vercel cron
// and on the Invoices page load.
export async function POST() {
  try {
    const sb = getSb()
    const { data: invoices, error } = await sb
      .from('invoices')
      .select('id, invoice_number_display, customer_id, po_number, total_amount, payment_terms, due_date, shipment_id')
      .eq('sent_to_finance', false)
      .not('shipment_id', 'is', null)
      .neq('status', 'void')
      .order('invoice_number_display', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!invoices || invoices.length === 0) return NextResponse.json({ emailed: 0 })

    // customer name lookup
    const custIds = Array.from(new Set(invoices.map(i => i.customer_id).filter(Boolean))) as string[]
    const nameById: Record<string, string> = {}
    if (custIds.length) {
      const { data: cs } = await sb.from('customers').select('id, company_name').in('id', custIds)
      for (const c of (cs ?? []) as any[]) nameById[c.id] = c.company_name
    }
    // shipment customer_name fallback
    const shipIds = invoices.map(i => i.shipment_id).filter(Boolean) as string[]
    const shipNameById: Record<string, string> = {}
    if (shipIds.length) {
      const { data: ss } = await sb.from('shipments').select('id, customer_name').in('id', shipIds)
      for (const s of (ss ?? []) as any[]) shipNameById[s.id] = s.customer_name
    }

    let emailed = 0
    const errors: string[] = []
    for (const inv of invoices) {
      const customerName = (inv.customer_id && nameById[inv.customer_id]) || shipNameById[inv.shipment_id!] || 'Customer'
      try {
        if (resend) {
          const res = await resend.emails.send({
            from: 'beyondGREEN ERP <erp@beyondgreenbiotech.com>',
            to: FINANCE_EMAIL,
            subject: `New Bill — ${customerName} — ${inv.invoice_number_display} — Action Required`,
            html: emailHtml(inv, customerName),
          })
          if ((res as any)?.error) { errors.push(`${inv.invoice_number_display}: ${JSON.stringify((res as any).error)}`); continue }
        }
        await sb.from('invoices').update({ sent_to_finance: true, finance_notified_at: new Date().toISOString() }).eq('id', inv.id)
        emailed++
      } catch (e) {
        errors.push(`${inv.invoice_number_display}: ${String(e)}`)
      }
    }
    return NextResponse.json({ emailed, errors })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function GET() { return POST() }
