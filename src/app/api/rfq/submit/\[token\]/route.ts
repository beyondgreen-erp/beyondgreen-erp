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

interface SubmissionLineItem {
  quote_costing_line_id: string
  exw_cost_per_case?: number
  freight_cost_per_case?: number
  packaging_cost_per_case?: number
  other_cost_1_amount?: number
  other_cost_2_amount?: number
  other_cost_3_amount?: number
  broker_inv_amount?: number
  markup_pct?: number
  notes?: string
}

interface RfqSubmissionRequest {
  recipient_name: string
  line_items: SubmissionLineItem[]
  submission_notes?: string
}

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const token = params.token
    const body: RfqSubmissionRequest = await req.json()

    if (!token) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 400 }
      )
    }

    // Fetch token
    const { data: tokenRecord, error: tokenErr } = await supabase
      .from('rfq_tokens')
      .select('*')
      .eq('token', token)
      .single()

    if (tokenErr || !tokenRecord) {
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 404 }
      )
    }

    // Check expiry
    if (tokenRecord.expires_at && new Date(tokenRecord.expires_at) < new Date()) {
      await supabase.from('rfq_tokens').update({ is_expired: true }).eq('id', tokenRecord.id)
      return NextResponse.json(
        { error: 'Token has expired' },
        { status: 403 }
      )
    }

    // Update token access
    await supabase
      .from('rfq_tokens')
      .update({
        last_accessed_at: new Date().toISOString(),
        access_count: (tokenRecord.access_count || 0) + 1,
      })
      .eq('id', tokenRecord.id)

    const quoteId = tokenRecord.quote_costing_id
    const recipient = body.recipient_name || tokenRecord.recipient_name

    // Fetch quote
    const { data: quote, error: quoteErr } = await supabase
      .from('quote_costing')
      .select('*')
      .eq('id', quoteId)
      .single()

    if (quoteErr || !quote) {
      return NextResponse.json(
        { error: 'Quote not found' },
        { status: 404 }
      )
    }

    // Create submission record
    const { data: submission, error: submissionErr } = await supabase
      .from('rfq_submissions')
      .insert({
        rfq_token_id: tokenRecord.id,
        quote_costing_id: quoteId,
        recipient_name: recipient,
        submission_data: body,
      })
      .select()
      .single()

    if (submissionErr) {
      console.error('Submission creation error:', submissionErr)
      return NextResponse.json(
        { error: 'Failed to create submission' },
        { status: 500 }
      )
    }

    // Update line items with pricing
    if (body.line_items && Array.isArray(body.line_items)) {
      for (const lineItem of body.line_items) {
        const updates: Record<string, any> = {
          rfq_pricing_source: recipient,
          rfq_submitted_at: new Date().toISOString(),
          rfq_submission_id: submission.id,
        }

        if (lineItem.exw_cost_per_case !== undefined) {
          updates.exw_cost_per_case = lineItem.exw_cost_per_case
        }
        if (lineItem.freight_cost_per_case !== undefined) {
          updates.freight_cost_per_case = lineItem.freight_cost_per_case
        }
        if (lineItem.packaging_cost_per_case !== undefined) {
          updates.packaging_cost_per_case = lineItem.packaging_cost_per_case
        }
        if (lineItem.other_cost_1_amount !== undefined) {
          updates.other_cost_1_amount = lineItem.other_cost_1_amount
        }
        if (lineItem.other_cost_2_amount !== undefined) {
          updates.other_cost_2_amount = lineItem.other_cost_2_amount
        }
        if (lineItem.other_cost_3_amount !== undefined) {
          updates.other_cost_3_amount = lineItem.other_cost_3_amount
        }
        if (lineItem.broker_inv_amount !== undefined) {
          updates.broker_inv_amount = lineItem.broker_inv_amount
        }
        if (lineItem.markup_pct !== undefined) {
          updates.markup_pct = lineItem.markup_pct
        }

        await supabase
          .from('quote_costing_lines')
          .update(updates)
          .eq('id', lineItem.quote_costing_line_id)
      }
    }

    // Update quote status
    const statusColumnAmeer = 'rfq_recipient_ameer_status'
    const statusColumnVeejay = 'rfq_recipient_veejay_status'
    const submittedColumnAmeer = 'rfq_recipient_ameer_submitted_at'
    const submittedColumnVeejay = 'rfq_recipient_veejay_submitted_at'

    const statusUpdate: Record<string, any> = {}
    if (recipient === 'Ameer') {
      statusUpdate[statusColumnAmeer] = 'Submitted'
      statusUpdate[submittedColumnAmeer] = new Date().toISOString()
    } else if (recipient === 'Veejay') {
      statusUpdate[statusColumnVeejay] = 'Submitted'
      statusUpdate[submittedColumnVeejay] = new Date().toISOString()
    }

    await supabase
      .from('quote_costing')
      .update(statusUpdate)
      .eq('id', quoteId)

    // Send notification email
    if (resend) {
      const lineCount = body.line_items?.length || 0
      await resend.emails.send({
        from: 'beyondGREEN ERP <onboarding@resend.dev>',
        to: NOTIF_EMAIL,
        subject: `RFQ Pricing Submitted — ${quote.quote_number} — ${recipient}`,
        html: generateSubmissionNotificationHtml(
          quote.quote_number,
          quote.customer_name,
          recipient,
          lineCount,
          body.submission_notes
        ),
      })
    }

    return NextResponse.json({
      ok: true,
      submissionId: submission.id,
      message: 'Pricing submitted successfully',
    })
  } catch (err: unknown) {
    console.error('RFQ submit error:', err)
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    )
  }
}

function generateSubmissionNotificationHtml(
  quoteNum: string,
  customerName: string | null,
  recipient: string,
  lineCount: number,
  notes?: string
): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:560px;margin:40px auto;background:#111;border:1px solid #222;border-radius:16px;overflow:hidden">
  <div style="background:#8b5cf6;padding:28px 32px">
    <p style="margin:0;color:#fff;font-weight:700;font-size:20px">beyondGREEN ERP</p>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.75);font-size:13px">Pricing Submitted</p>
  </div>
  <div style="padding:32px">
    <h2 style="color:#fff;font-size:18px;margin:0 0 6px">RFQ Pricing Received</h2>
    <p style="color:#6b7280;font-size:13px;margin:0 0 24px">Pricing has been submitted for your review.</p>
    <table style="width:100%;border-collapse:collapse;background:#1a1a1a;border-radius:10px;overflow:hidden;margin-bottom:24px">
      <tr><td style="padding:10px 16px;color:#9ca3af;font-size:12px;border-bottom:1px solid #2a2a2a">Quote #</td><td style="padding:10px 16px;color:#fff;font-weight:600;font-size:13px;border-bottom:1px solid #2a2a2a">${quoteNum}</td></tr>
      <tr><td style="padding:10px 16px;color:#9ca3af;font-size:12px;border-bottom:1px solid #2a2a2a">Customer</td><td style="padding:10px 16px;color:#e5e7eb;font-size:13px;border-bottom:1px solid #2a2a2a">${customerName || '—'}</td></tr>
      <tr><td style="padding:10px 16px;color:#9ca3af;font-size:12px;border-bottom:1px solid #2a2a2a">Submitted By</td><td style="padding:10px 16px;color:#8b5cf6;font-weight:600;font-size:13px;border-bottom:1px solid #2a2a2a">${recipient}</td></tr>
      <tr><td style="padding:10px 16px;color:#9ca3af;font-size:12px">Line Items</td><td style="padding:10px 16px;color:#e5e7eb;font-size:13px">${lineCount} item${lineCount !== 1 ? 's' : ''}</td></tr>
    </table>
    ${notes ? `<p style="color:#9ca3af;font-size:13px;margin:0 0 16px"><strong>Notes:</strong><br /><span style="color:#d1d5db">${notes.replace(/\n/g, '<br />')}</span></p>` : ''}
    <a href="${APP_URL}/sales/costing" style="display:inline-block;background:#8b5cf6;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:10px">Review in ERP →</a>
  </div>
  <div style="padding:16px 32px;border-top:1px solid #1f1f1f">
    <p style="color:#4b5563;font-size:11px;margin:0">Automated notification from beyondGREEN ERP</p>
  </div>
</div>
</body></html>`
}
