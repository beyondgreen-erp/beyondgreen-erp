import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM = process.env.FROM_EMAIL || 'erp@beyondgreenbiotech.com'
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c])
const money = (n: unknown) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtD = (d: string | null | undefined) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'

export async function POST(req: NextRequest) {
  try {
    const { orderId } = await req.json() as { orderId?: string }
    if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 })
    const sb = createSupabaseAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: order } = await sb.from('sales_orders').select('*, customers(company_name, email)').eq('id', orderId).maybeSingle() as any
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    const to = order.customer_email || order.customers?.email || ''
    if (!to) return NextResponse.json({ error: 'No customer email on this order' }, { status: 400 })
    if (!RESEND_API_KEY) return NextResponse.json({ error: 'Email is not configured (RESEND_API_KEY)' }, { status: 500 })

    const { data: lines } = await sb.from('sales_order_lines').select('*').eq('sales_order_id', orderId).order('line_number', { ascending: true })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ls = (lines as any[]) || []
    const computed = ls.reduce((a, l) => a + (Number(l.quantity ?? l.qty) || 0) * (Number(l.unit_price) || 0), 0)
    const total = Number(order.total_amount ?? order.total ?? order.subtotal ?? computed) || computed
    const company = order.customers?.company_name || 'Customer'

    const rows = ls.map(l => `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF0F4;font-family:monospace;color:#0F7A4E">${esc(l.sku || '')}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF0F4;color:#1A1D2E">${esc(l.description || '')}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF0F4;text-align:right;color:#334">${esc(l.quantity ?? l.qty ?? '')}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF0F4;text-align:right;color:#334">${l.unit_price != null ? money(l.unit_price) : '—'}</td>
    </tr>`).join('')

    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#F7F8FA;padding:32px 16px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #E2E8F0">
    <div style="background:#0F7A4E;padding:24px 28px"><p style="margin:0;color:#fff;font-weight:800;font-size:18px">beyondGREEN biotech</p><p style="margin:4px 0 0;color:rgba(255,255,255,.85);font-size:14px">Order Confirmation</p></div>
    <div style="padding:28px">
      <p style="font-size:15px;color:#0F1C2E;margin:0 0 6px">Hi ${esc(company)},</p>
      <p style="font-size:14px;color:#5A6E8A;line-height:1.6;margin:0 0 20px">Thank you for your order. Here are the details we have on file — please review and let us know if anything needs to change.</p>
      <table style="width:100%;border-collapse:collapse;background:#F9FAFB;border-radius:10px;overflow:hidden;margin-bottom:20px">
        <tr><td style="padding:8px 12px;color:#5A6E8A;font-size:13px">Order #</td><td style="padding:8px 12px;color:#0F1C2E;font-weight:600;font-size:13px">${esc(order.order_number || '')}</td></tr>
        <tr><td style="padding:8px 12px;color:#5A6E8A;font-size:13px">PO #</td><td style="padding:8px 12px;color:#0F1C2E;font-size:13px">${esc(order.po_number || '—')}</td></tr>
        <tr><td style="padding:8px 12px;color:#5A6E8A;font-size:13px">Order Date</td><td style="padding:8px 12px;color:#0F1C2E;font-size:13px">${fmtD(order.order_date)}</td></tr>
        <tr><td style="padding:8px 12px;color:#5A6E8A;font-size:13px">Ship Date</td><td style="padding:8px 12px;color:#0F1C2E;font-size:13px">${fmtD(order.ship_date || order.required_ship_date)}</td></tr>
        <tr><td style="padding:8px 12px;color:#5A6E8A;font-size:13px;vertical-align:top">Ship To</td><td style="padding:8px 12px;color:#0F1C2E;font-size:13px;white-space:pre-wrap">${esc(order.shipping_address || '—')}</td></tr>
      </table>
      ${ls.length ? `<table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#FBFCFE"><th style="text-align:left;padding:8px 10px;color:#5A6E8A;font-size:11px;text-transform:uppercase">SKU</th><th style="text-align:left;padding:8px 10px;color:#5A6E8A;font-size:11px;text-transform:uppercase">Description</th><th style="text-align:right;padding:8px 10px;color:#5A6E8A;font-size:11px;text-transform:uppercase">Qty</th><th style="text-align:right;padding:8px 10px;color:#5A6E8A;font-size:11px;text-transform:uppercase">Unit</th></tr></thead>
        <tbody>${rows}</tbody></table>` : ''}
      <div style="text-align:right;margin-top:16px;padding-top:12px;border-top:2px solid #E4E6EE"><span style="color:#5A6E8A;font-size:13px;margin-right:12px">Order Total</span><span style="color:#0F7A4E;font-weight:800;font-size:18px">${money(total)}</span></div>
      <p style="font-size:12px;color:#8A9FC0;margin:24px 0 0;line-height:1.6">beyondGREEN biotech, Inc. · 1202 E. Wakeham Ave., Santa Ana, CA 92705 · (866) 364-9466</p>
    </div>
  </div>
</div>`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `beyondGREEN biotech <${FROM}>`, to: [to], subject: `Order Confirmation — ${order.order_number || 'beyondGREEN'}`, html }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return NextResponse.json({ error: (body as { message?: string })?.message || 'Email send failed' }, { status: 502 })
    try { await sb.from('sales_orders').update({ order_confirmation_sent_at: new Date().toISOString() }).eq('id', orderId) } catch { /* column may not exist; non-fatal */ }
    return NextResponse.json({ ok: true, id: (body as { id?: string })?.id || null })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
