export const dynamic = 'force-dynamic'
import { Resend } from 'resend'
import { NextRequest, NextResponse } from 'next/server'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const FINANCE_EMAIL = 'finance@beyondgreenbiotech.com'
const APP_URL = 'https://beyondgreen-erp.vercel.app'

export async function POST(req: NextRequest) {
  try {
    const {
      invoice_number, invoice_type = 'invoice', customer_name,
      po_number, total_amount, payment_terms, due_date,
    } = await req.json()

    const typeLabel = invoice_type === 'proforma' ? 'Proforma Invoice' : 'Invoice'
    const subject = `New ${typeLabel} Entry — ${customer_name} — ${invoice_number} — Action Required`
    const fmtAmt = `$${Number(total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
    const fmtDate = due_date ? new Date(due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'

    await resend?.emails.send({
      from: 'beyondGREEN ERP <erp@beyondgreenbiotech.com>',
      to: FINANCE_EMAIL,
      subject,
      html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:560px;margin:40px auto;background:#111;border:1px solid #222;border-radius:16px;overflow:hidden">
  <div style="background:#10b981;padding:28px 32px">
    <p style="margin:0;color:#fff;font-weight:700;font-size:20px">beyondGREEN ERP</p>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.75);font-size:13px">Invoice Notification</p>
  </div>
  <div style="padding:32px">
    <h2 style="color:#fff;font-size:18px;margin:0 0 6px">New Invoice — Action Required</h2>
    <p style="color:#6b7280;font-size:13px;margin:0 0 24px">A new invoice has been created and requires your attention.</p>
    <table style="width:100%;border-collapse:collapse;background:#1a1a1a;border-radius:10px;overflow:hidden">
      <tr><td style="padding:10px 16px;color:#9ca3af;font-size:12px;border-bottom:1px solid #2a2a2a">Invoice #</td><td style="padding:10px 16px;color:#fff;font-weight:600;font-size:13px;border-bottom:1px solid #2a2a2a">${invoice_number}</td></tr>
      <tr><td style="padding:10px 16px;color:#9ca3af;font-size:12px;border-bottom:1px solid #2a2a2a">Type</td><td style="padding:10px 16px;color:#e5e7eb;font-size:13px;border-bottom:1px solid #2a2a2a">${typeLabel}</td></tr>
      <tr><td style="padding:10px 16px;color:#9ca3af;font-size:12px;border-bottom:1px solid #2a2a2a">Customer</td><td style="padding:10px 16px;color:#e5e7eb;font-size:13px;border-bottom:1px solid #2a2a2a">${customer_name ?? '—'}</td></tr>
      <tr><td style="padding:10px 16px;color:#9ca3af;font-size:12px;border-bottom:1px solid #2a2a2a">PO Number</td><td style="padding:10px 16px;color:#e5e7eb;font-size:13px;border-bottom:1px solid #2a2a2a">${po_number ?? '—'}</td></tr>
      <tr><td style="padding:10px 16px;color:#9ca3af;font-size:12px;border-bottom:1px solid #2a2a2a">Amount</td><td style="padding:10px 16px;color:#10b981;font-weight:700;font-size:14px;border-bottom:1px solid #2a2a2a">${fmtAmt}</td></tr>
      <tr><td style="padding:10px 16px;color:#9ca3af;font-size:12px;border-bottom:1px solid #2a2a2a">Payment Terms</td><td style="padding:10px 16px;color:#e5e7eb;font-size:13px;border-bottom:1px solid #2a2a2a">${payment_terms ?? '—'}</td></tr>
      <tr><td style="padding:10px 16px;color:#9ca3af;font-size:12px">Due Date</td><td style="padding:10px 16px;color:#f59e0b;font-weight:600;font-size:13px">${fmtDate}</td></tr>
    </table>
    <p style="color:#9ca3af;font-size:13px;margin:20px 0 16px">Please log into the ERP to confirm this invoice entry and update the payment status once payment is received.</p>
    <a href="${APP_URL}/sales/invoices" style="display:inline-block;background:#10b981;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:10px">View Invoice in ERP →</a>
  </div>
  <div style="padding:16px 32px;border-top:1px solid #1f1f1f">
    <p style="color:#4b5563;font-size:11px;margin:0">Automated notification from beyondGREEN ERP · <a href="${APP_URL}/sales/invoices" style="color:#6b7280">${APP_URL}/sales/invoices</a></p>
  </div>
</div>
</body></html>`,
    })

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    console.error('invoice notify error', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
