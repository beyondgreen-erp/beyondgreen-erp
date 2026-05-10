export const dynamic = 'force-dynamic'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { NextResponse } from 'next/server'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const FINANCE_EMAIL = 'finance@beyondgreenbiotech.com'
const APP_URL = 'https://beyondgreen-erp.vercel.app'

function getSb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export async function GET() {
  try {
    const sb = getSb()
    const today = new Date().toISOString().slice(0, 10)
    const results = { overdue_updated: 0, reminders_sent: 0, errors: [] as string[] }

    // 1. Mark overdue — pending invoices past due date
    const { data: nowOverdue } = await sb.from('invoices')
      .select('id,invoice_number_display,due_date,total_amount,reminder_count')
      .in('status', ['pending', 'partial'])
      .lt('due_date', today)
      .eq('is_active', true)

    for (const inv of nowOverdue ?? []) {
      await sb.from('invoices').update({
        status: 'overdue',
        reminder_count: (inv.reminder_count ?? 0) + 1,
        reminder_sent_at: new Date().toISOString(),
      }).eq('id', inv.id)
      results.overdue_updated++
    }

    // 2. Send reminders for all overdue invoices
    const { data: overdueInvs } = await sb.from('invoices')
      .select('id,invoice_number_display,due_date,total_amount,balance_due,reminder_count,customers(company_name)')
      .eq('status', 'overdue')
      .eq('is_active', true)

    for (const inv of overdueInvs ?? []) {
      const dueDate = new Date(inv.due_date + 'T00:00:00')
      const daysOverdue = Math.floor((Date.now() - dueDate.getTime()) / 86400000)
      const customerName = (inv.customers as unknown as { company_name: string } | null)?.company_name ?? 'Unknown'
      const balance = `$${Number(inv.balance_due ?? inv.total_amount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`

      try {
        await resend?.emails.send({
          from: 'beyondGREEN ERP <onboarding@resend.dev>',
          to: FINANCE_EMAIL,
          subject: `PAYMENT REMINDER — ${customerName} — ${inv.invoice_number_display} — ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} overdue`,
          html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a0a;font-family:sans-serif">
<div style="max-width:520px;margin:40px auto;background:#111;border:1px solid #ef4444;border-radius:16px;overflow:hidden">
  <div style="background:#ef4444;padding:24px 32px">
    <p style="margin:0;color:#fff;font-weight:700;font-size:18px">⚠ Payment Overdue — Action Required</p>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.8);font-size:13px">beyondGREEN ERP Reminder #${(inv.reminder_count ?? 1)}</p>
  </div>
  <div style="padding:28px 32px">
    <p style="color:#e5e7eb;font-size:15px;margin:0 0 20px">The following invoice is <strong style="color:#ef4444">${daysOverdue} days overdue</strong> and requires immediate attention.</p>
    <table style="width:100%;background:#1a1a1a;border-radius:10px;overflow:hidden;border-collapse:collapse">
      <tr><td style="padding:10px 16px;color:#9ca3af;font-size:12px;border-bottom:1px solid #2a2a2a">Invoice #</td><td style="padding:10px 16px;color:#fff;font-weight:600;border-bottom:1px solid #2a2a2a">${inv.invoice_number_display}</td></tr>
      <tr><td style="padding:10px 16px;color:#9ca3af;font-size:12px;border-bottom:1px solid #2a2a2a">Customer</td><td style="padding:10px 16px;color:#e5e7eb;border-bottom:1px solid #2a2a2a">${customerName}</td></tr>
      <tr><td style="padding:10px 16px;color:#9ca3af;font-size:12px;border-bottom:1px solid #2a2a2a">Due Date</td><td style="padding:10px 16px;color:#ef4444;font-weight:600;border-bottom:1px solid #2a2a2a">${inv.due_date}</td></tr>
      <tr><td style="padding:10px 16px;color:#9ca3af;font-size:12px">Balance Due</td><td style="padding:10px 16px;color:#ef4444;font-weight:700;font-size:15px">${balance}</td></tr>
    </table>
    <a href="${APP_URL}/sales/invoices" style="display:inline-block;margin-top:20px;background:#ef4444;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:10px">Review Invoice →</a>
  </div>
</div>
</body></html>`,
        })
        results.reminders_sent++
      } catch (e) {
        results.errors.push(String(e))
      }
    }

    // 3. Notify about 50/50 deposits not received (production blocked)
    const { data: blockedOrders } = await sb.from('invoices')
      .select('id,invoice_number_display,total_amount,deposit_amount,customers(company_name)')
      .eq('production_blocked', true)
      .eq('deposit_paid', false)
      .in('status', ['pending', 'proforma'])
      .eq('is_active', true)

    for (const inv of blockedOrders ?? []) {
      const name = (inv.customers as unknown as { company_name: string } | null)?.company_name ?? 'Unknown'
      try {
        await sb.from('notifications').insert({
          recipient_email: FINANCE_EMAIL,
          sender_email: 'erp@beyondgreenbiotech.com',
          message: `Production blocked on ${inv.invoice_number_display} for ${name} — deposit of $${Number(inv.deposit_amount ?? 0).toFixed(2)} not yet confirmed`,
          page: 'invoices',
          record_type: 'invoices',
          is_read: false,
        })
      } catch { /* non-fatal */ }
    }

    return NextResponse.json({ ok: true, ...results })
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
