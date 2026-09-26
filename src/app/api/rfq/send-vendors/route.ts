import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

/**
 * Outbound supplier RFQ.
 *
 * Takes one RFQ (a row in `quotations` with type = 'rfq'), a list of vendors, the
 * email body, and the already-rendered RFQ PDF, then:
 *   1. mints a per-vendor token and logs a row in `rfq_sends`
 *   2. sends the email with the RFQ attached, personalised per vendor
 *   3. records the Resend message id (or the error) against that row
 *
 * Every reply lands back under the same RFQ via /rfq/supplier/<token>.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM_EMAIL = process.env.FROM_EMAIL || 'erp@beyondgreenbiotech.com'
const FROM_NAME = 'beyondGREEN biotech'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://beyondgreen-erp.vercel.app'
const DEFAULT_REPLY_TO = 'rudyp@beyondgreenbiotech.com'

/**
 * Suppliers get their quote form on a host of its own — never an ERP URL, and the
 * ERP is unreachable from it (see the RFQ_HOSTS block in middleware). Same
 * deployment underneath, so a submitted quote still lands under this RFQ.
 */
const RFQ_PORTAL_URL = (process.env.NEXT_PUBLIC_RFQ_PORTAL_URL || 'https://beyondgreen-rfq.vercel.app').replace(/\/+$/, '')

/** Rudy is copied on every outbound RFQ, so the thread is never only in the ERP. */
const ALWAYS_CC = 'rudy@beyondgreenbiotech.com'

interface VendorTarget {
  vendor_id?: string | null
  vendor_name: string
  email: string
  contact_name?: string | null
}

interface SendRequest {
  quotation_id: string
  vendors: VendorTarget[]
  subject: string
  body_html: string
  pdf_base64?: string | null
  pdf_filename?: string | null
  attachments?: { filename: string; content: string }[]
  reply_to?: string
  cc?: string[]
  created_by?: string | null
}

/** First name only, so "Dear Lily Chen" reads as "Hi Lily". */
function firstName(name?: string | null) {
  if (!name) return ''
  return String(name).trim().split(/\s+/)[0]
}

/**
 * Merge fields. Kept deliberately small and obvious so the body stays editable
 * by hand in the ERP without anyone needing to learn a template language.
 */
function personalise(html: string, v: VendorTarget, portalLink: string) {
  const greetingName = firstName(v.contact_name) || v.vendor_name
  return html
    .replace(/\{\{\s*contact\s*\}\}/gi, greetingName)
    .replace(/\{\{\s*contact_full\s*\}\}/gi, v.contact_name || v.vendor_name)
    .replace(/\{\{\s*company\s*\}\}/gi, v.vendor_name)
    .replace(/\{\{\s*portal_link\s*\}\}/gi, portalLink)
}

/** The response-portal call to action appended under the body. */
function portalBlock(portalLink: string, rfqNumber: string) {
  return `
  <div style="margin:28px 0 8px 0;padding:18px 20px;border:1px solid #D6E3DA;border-radius:8px;background:#F4F9F6;font-family:Arial,Helvetica,sans-serif;">
    <div style="font-size:14px;font-weight:bold;color:#14532D;margin-bottom:6px;">Reply with your pricing online</div>
    <div style="font-size:13px;color:#374151;line-height:1.5;margin-bottom:14px;">
      The fastest way to quote ${rfqNumber} is the form below &mdash; unit price by size, MOQ, lead time and terms.
      It goes straight into our system under this RFQ number. You are welcome to reply to this email with your own
      quote sheet instead if that is easier.
    </div>
    <a href="${portalLink}"
       style="display:inline-block;background:#1F9A3A;color:#ffffff;text-decoration:none;font-size:13px;font-weight:bold;padding:11px 22px;border-radius:6px;">
      Submit your quote
    </a>
    <div style="font-size:11px;color:#6B7280;margin-top:12px;word-break:break-all;">${portalLink}</div>
  </div>`
}

export async function POST(req: NextRequest) {
  try {
    if (!RESEND_API_KEY) {
      return NextResponse.json({ error: 'Email service not configured (RESEND_API_KEY missing)' }, { status: 500 })
    }

    const body: SendRequest = await req.json()
    const { quotation_id, vendors, subject, body_html, pdf_base64, pdf_filename, attachments, reply_to, cc, created_by } = body

    if (!quotation_id || !Array.isArray(vendors) || vendors.length === 0 || !subject || !body_html) {
      return NextResponse.json({ error: 'quotation_id, vendors, subject and body_html are all required' }, { status: 400 })
    }

    const { data: rfq, error: rfqErr } = await supabase
      .from('quotations')
      .select('id, quote_number, type, status')
      .eq('id', quotation_id)
      .single()

    if (rfqErr || !rfq) {
      return NextResponse.json({ error: 'RFQ not found' }, { status: 404 })
    }

    const results: { vendor_name: string; email: string; ok: boolean; error?: string; token?: string }[] = []

    for (const v of vendors) {
      if (!v.email) {
        results.push({ vendor_name: v.vendor_name, email: '', ok: false, error: 'No email address on file' })
        continue
      }

      const token = crypto.randomBytes(24).toString('hex')
      const portalLink = `${RFQ_PORTAL_URL}/rfq/supplier/${token}`
      const html = personalise(body_html, v, portalLink) + portalBlock(portalLink, rfq.quote_number)

      const { data: sendRow, error: sendErr } = await supabase
        .from('rfq_sends')
        .insert({
          quotation_id,
          vendor_id: v.vendor_id || null,
          vendor_name: v.vendor_name,
          recipient_email: v.email,
          recipient_name: v.contact_name || null,
          token,
          subject,
          body_html: html,
          status: 'Sent',
          created_by: created_by || null,
        })
        .select('id')
        .single()

      if (sendErr || !sendRow) {
        results.push({ vendor_name: v.vendor_name, email: v.email, ok: false, error: sendErr?.message || 'Could not log the send' })
        continue
      }

      const payload: Record<string, unknown> = {
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to: [v.email],
        reply_to: [reply_to || DEFAULT_REPLY_TO],
        subject,
        html,
      }
      const ccList = Array.from(new Set(
        [...(cc ?? []), ALWAYS_CC]
          .map(e => String(e || '').trim().toLowerCase())
          .filter(Boolean)
      )).filter(e => e !== String(v.email).trim().toLowerCase())
      if (ccList.length) payload.cc = ccList

      const files: { filename: string; content: string }[] = []
      if (pdf_base64) files.push({ filename: pdf_filename || `${rfq.quote_number}.pdf`, content: pdf_base64 })
      if (Array.isArray(attachments)) files.push(...attachments.filter(a => a?.filename && a?.content))
      if (files.length) payload.attachments = files

      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await res.json()

        if (!res.ok) {
          await supabase.from('rfq_sends').update({ status: 'Failed', error: data?.message || 'Send failed' }).eq('id', sendRow.id)
          results.push({ vendor_name: v.vendor_name, email: v.email, ok: false, error: data?.message || 'Send failed' })
          continue
        }

        await supabase.from('rfq_sends').update({ email_id: data?.id || null }).eq('id', sendRow.id)
        results.push({ vendor_name: v.vendor_name, email: v.email, ok: true, token })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Send failed'
        await supabase.from('rfq_sends').update({ status: 'Failed', error: msg }).eq('id', sendRow.id)
        results.push({ vendor_name: v.vendor_name, email: v.email, ok: false, error: msg })
      }
    }

    const sent = results.filter(r => r.ok).length
    // Once anything has gone out the RFQ is no longer a draft.
    if (sent > 0 && rfq.status !== 'Quoted' && rfq.status !== 'Accepted') {
      await supabase.from('quotations').update({ status: 'Quoting' }).eq('id', quotation_id)
    }

    return NextResponse.json({ success: true, sent, failed: results.length - sent, results })
  } catch (err) {
    console.error('[rfq/send-vendors]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
