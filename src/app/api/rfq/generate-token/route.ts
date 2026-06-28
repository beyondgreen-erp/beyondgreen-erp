import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://beyondgreen-erp.vercel.app'
const NOTIF_EMAIL = 'rudyp@beyondgreenbiotech.com'

// Generate a secure random token
function generateToken(): string {
  const bytes = new Uint8Array(32)
  if (typeof window === 'undefined') {
    // Node.js environment
    const crypto = require('crypto')
    return crypto.randomBytes(32).toString('hex')
  }
  // Fallback (shouldn't reach here in API route)
  return Math.random().toString(36).substring(2)
}

interface GenerateTokenRequest {
  quote_costing_id: string
  recipient: 'Ameer' | 'Veejay'
  recipient_email?: string
  send_email?: boolean
}

export async function POST(req: NextRequest) {
  try {
    const body: GenerateTokenRequest = await req.json()
    const { quote_costing_id, recipient, recipient_email, send_email = true } = body

    if (!quote_costing_id || !recipient || !['Ameer', 'Veejay'].includes(recipient)) {
      return NextResponse.json(
        { error: 'Missing or invalid quote_costing_id or recipient' },
        { status: 400 }
      )
    }

    // Fetch quote details
    const { data: quote, error: quoteErr } = await supabase
      .from('quote_costing')
      .select('*')
      .eq('id', quote_costing_id)
      .single()

    if (quoteErr || !quote) {
      return NextResponse.json(
        { error: 'Quote not found' },
        { status: 404 }
      )
    }

    // Generate token
    const token = generateToken()
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

    // Store token
    const { data: tokenRecord, error: tokenErr } = await supabase
      .from('rfq_tokens')
      .insert({
        quote_costing_id,
        token,
        recipient_name: recipient,
        recipient_email: recipient_email || null,
        expires_at: expiresAt.toISOString(),
        created_by: 'system',
      })
      .select()
      .single()

    if (tokenErr) {
      console.error('Token creation error:', tokenErr)
      return NextResponse.json(
        { error: 'Failed to create token' },
        { status: 500 }
      )
    }

    const rfqLink = `${APP_URL}/rfq/${token}`

    // Send email if requested
    if (send_email && resend && recipient_email) {
      const formattedDate = new Date(quote.quote_date).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })

      await resend.emails.send({
        from: 'beyondGREEN ERP <onboarding@resend.dev>',
        to: recipient_email,
        subject: `RFQ Required — Quote ${quote.quote_number} — Price Input Needed`,
        html: generateRfqEmailHtml(
          recipient,
          quote.quote_number,
          quote.customer_name,
          formattedDate,
          rfqLink
        ),
      })
    }

    // Send notification to Rudy
    if (resend) {
      await resend.emails.send({
        from: 'beyondGREEN ERP <onboarding@resend.dev>',
        to: NOTIF_EMAIL,
        subject: `RFQ Token Generated — ${quote.quote_number} — ${recipient}`,
        html: generateNotificationEmailHtml(
          quote.quote_number,
          quote.customer_name,
          recipient,
          recipient_email,
          rfqLink
        ),
      })
    }

    return NextResponse.json({
      ok: true,
      token: tokenRecord.token,
      rfqLink,
      expiresAt: tokenRecord.expires_at,
    })
  } catch (err: unknown) {
    console.error('Generate token error:', err)
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    )
  }
}

function generateRfqEmailHtml(
  recipient: string,
  quoteNum: string,
  customerName: string | null,
  quoteDate: string,
  rfqLink: string
): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:560px;margin:40px auto;background:#111;border:1px solid #222;border-radius:16px;overflow:hidden">
  <div style="background:#10b981;padding:28px 32px">
    <p style="margin:0;color:#fff;font-weight:700;font-size:20px">beyondGREEN ERP</p>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.75);font-size:13px">Request for Quote</p>
  </div>
  <div style="padding:32px">
    <h2 style="color:#fff;font-size:18px;margin:0 0 6px">Price Input Required</h2>
    <p style="color:#6b7280;font-size:13px;margin:0 0 24px">Hi ${recipient}, we need your pricing for the following quote:</p>
    <table style="width:100%;border-collapse:collapse;background:#1a1a1a;border-radius:10px;overflow:hidden;margin-bottom:24px">
      <tr><td style="padding:10px 16px;color:#9ca3af;font-size:12px;border-bottom:1px solid #2a2a2a">Quote #</td><td style="padding:10px 16px;color:#fff;font-weight:600;font-size:13px;border-bottom:1px solid #2a2a2a">${quoteNum}</td></tr>
      <tr><td style="padding:10px 16px;color:#9ca3af;font-size:12px;border-bottom:1px solid #2a2a2a">Customer</td><td style="padding:10px 16px;color:#e5e7eb;font-size:13px;border-bottom:1px solid #2a2a2a">${customerName || '—'}</td></tr>
      <tr><td style="padding:10px 16px;color:#9ca3af;font-size:12px">Quote Date</td><td style="padding:10px 16px;color:#e5e7eb;font-size:13px">${quoteDate}</td></tr>
    </table>
    <p style="color:#9ca3af;font-size:13px;margin:0 0 16px">Please review the line items and submit your pricing using the form below. You can submit pricing multiple times—we'll use the latest submission.</p>
    <a href="${rfqLink}" style="display:inline-block;background:#10b981;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:10px">Open RFQ Form →</a>
    <p style="color:#6b7280;font-size:12px;margin:20px 0 0">This link expires in 30 days.</p>
  </div>
  <div style="padding:16px 32px;border-top:1px solid #1f1f1f">
    <p style="color:#4b5563;font-size:11px;margin:0">Automated notification from beyondGREEN ERP · <a href="${process.env.NEXT_PUBLIC_APP_URL}/sales/costing" style="color:#6b7280">Return to ERP</a></p>
  </div>
</div>
</body></html>`
}

function generateNotificationEmailHtml(
  quoteNum: string,
  customerName: string | null,
  recipient: string,
  recipientEmail: string | undefined,
  rfqLink: string
): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:560px;margin:40px auto;background:#111;border:1px solid #222;border-radius:16px;overflow:hidden">
  <div style="background:#6366f1;padding:28px 32px">
    <p style="margin:0;color:#fff;font-weight:700;font-size:20px">beyondGREEN ERP</p>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.75);font-size:13px">RFQ Generated</p>
  </div>
  <div style="padding:32px">
    <h2 style="color:#fff;font-size:18px;margin:0 0 6px">RFQ Token Generated</h2>
    <p style="color:#6b7280;font-size:13px;margin:0 0 24px">An RFQ token has been created and is ready to send to the supplier.</p>
    <table style="width:100%;border-collapse:collapse;background:#1a1a1a;border-radius:10px;overflow:hidden;margin-bottom:24px">
      <tr><td style="padding:10px 16px;color:#9ca3af;font-size:12px;border-bottom:1px solid #2a2a2a">Quote #</td><td style="padding:10px 16px;color:#fff;font-weight:600;font-size:13px;border-bottom:1px solid #2a2a2a">${quoteNum}</td></tr>
      <tr><td style="padding:10px 16px;color:#9ca3af;font-size:12px;border-bottom:1px solid #2a2a2a">Customer</td><td style="padding:10px 16px;color:#e5e7eb;font-size:13px;border-bottom:1px solid #2a2a2a">${customerName || '—'}</td></tr>
      <tr><td style="padding:10px 16px;color:#9ca3af;font-size:12px;border-bottom:1px solid #2a2a2a">Recipient</td><td style="padding:10px 16px;color:#e5e7eb;font-size:13px;border-bottom:1px solid #2a2a2a">${recipient}${recipientEmail ? ` (${recipientEmail})` : ''}</td></tr>
    </table>
    <p style="color:#9ca3af;font-size:13px;margin:0 0 16px"><strong>RFQ Link:</strong></p>
    <code style="display:block;background:#1a1a1a;padding:12px 16px;border-radius:8px;color:#10b981;font-family:monospace;font-size:12px;word-break:break-all;margin-bottom:16px">${rfqLink}</code>
    <p style="color:#9ca3af;font-size:13px;margin:0">You can resend or share this link with the supplier as needed.</p>
  </div>
  <div style="padding:16px 32px;border-top:1px solid #1f1f1f">
    <p style="color:#4b5563;font-size:11px;margin:0">Automated notification from beyondGREEN ERP</p>
  </div>
</div>
</body></html>`
}
