import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * The supplier side of an outbound RFQ.
 *
 * GET  — loads the RFQ header and its line items for the tokenised form, and stamps
 *        opened_at the first time the supplier looks at it.
 * POST — writes the supplier's quote into rfq_vendor_responses (+ lines), flips the
 *        send to Responded, and emails Rudy that a quote has landed.
 *
 * No auth: the token IS the credential, so it is long, single-vendor and expiring.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM_EMAIL = process.env.FROM_EMAIL || 'erp@beyondgreenbiotech.com'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://beyondgreen-erp.vercel.app'
const NOTIF_EMAIL = 'rudyp@beyondgreenbiotech.com'

const ART_BUCKET = 'erp-files'
/** Long enough that a factory can come back to the link mid-quote. */
const ART_LINK_TTL = 60 * 60 * 24 * 45

/**
 * Artwork for this RFQ, as short-lived signed download links. Large print files
 * never survive email, so the quote form is the reliable way to hand them over.
 */
async function loadArtFiles(quotationId: string) {
  const { data, error } = await supabase
    .from('file_attachments')
    .select('id, file_name, file_size, file_type, storage_path')
    .eq('record_type', 'quotation_art')
    .eq('record_id', quotationId)
    .order('created_at')
  if (error || !data?.length) return []

  const out: { id: string; name: string; size: number | null; type: string | null; url: string }[] = []
  for (const a of data) {
    const { data: signed } = await supabase.storage
      .from(ART_BUCKET)
      .createSignedUrl(a.storage_path as string, ART_LINK_TTL)
    if (signed?.signedUrl) {
      out.push({
        id: a.id as string,
        name: a.file_name as string,
        size: (a.file_size as number) ?? null,
        type: (a.file_type as string) ?? null,
        url: signed.signedUrl,
      })
    }
  }
  return out
}

async function loadSend(token: string) {
  const { data, error } = await supabase
    .from('rfq_sends')
    .select('id, quotation_id, vendor_id, vendor_name, recipient_name, recipient_email, status, expires_at, responded_at')
    .eq('token', token)
    .single()
  if (error || !data) return null
  return data
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const send = await loadSend(params.token)
    if (!send) return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 })

    if (send.expires_at && new Date(send.expires_at) < new Date()) {
      return NextResponse.json({ error: 'This link has expired. Please contact us for a new one.' }, { status: 410 })
    }

    const { data: rfq } = await supabase
      .from('quotations')
      .select('id, quote_number, quote_date, expiry_date, notes, payment_terms, price_term, shipping_address')
      .eq('id', send.quotation_id)
      .single()

    if (!rfq) return NextResponse.json({ error: 'This RFQ is no longer available.' }, { status: 404 })

    const { data: lines } = await supabase
      .from('quotation_lines')
      .select('id, sku, product_name, description, quantity, line_number')
      .eq('quotation_id', send.quotation_id)
      .order('line_number', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })

    const art_files = await loadArtFiles(send.quotation_id)

    await supabase
      .from('rfq_sends')
      .update({ opened_at: new Date().toISOString(), status: send.status === 'Sent' ? 'Opened' : send.status })
      .eq('id', send.id)
      .is('opened_at', null)

    return NextResponse.json({
      rfq_number: rfq.quote_number,
      rfq_date: rfq.quote_date,
      due_date: rfq.expiry_date,
      notes: rfq.notes,
      price_term: rfq.price_term,
      payment_terms: rfq.payment_terms,
      deliver_to: rfq.shipping_address,
      vendor_name: send.vendor_name,
      contact_name: send.recipient_name,
      contact_email: send.recipient_email,
      already_responded: !!send.responded_at,
      art_files,
      lines: (lines ?? []).map(l => ({
        id: l.id,
        sku: l.sku,
        description: l.product_name || l.description || '',
        quantity: l.quantity,
      })),
    })
  } catch (err) {
    console.error('[rfq/vendor-response GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

interface ResponseLine {
  quotation_line_id?: string | null
  sku?: string | null
  description?: string | null
  quantity?: number | null
  unit_price?: number | null
  pcs_per_case?: number | null
  case_price?: number | null
  notes?: string | null
}

interface SubmitBody {
  contact_name?: string
  contact_email?: string
  currency?: string
  incoterm?: string
  payment_terms?: string
  lead_time_days?: number | null
  moq_note?: string
  validity_days?: number | null
  plate_die_charges?: string
  overrun_tolerance?: string
  exclusions?: string
  certifications?: string
  sample_available?: boolean
  notes?: string
  lines?: ResponseLine[]
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const send = await loadSend(params.token)
    if (!send) return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 })
    if (send.expires_at && new Date(send.expires_at) < new Date()) {
      return NextResponse.json({ error: 'This link has expired.' }, { status: 410 })
    }

    const body: SubmitBody = await req.json()
    const lines = Array.isArray(body.lines) ? body.lines : []

    const total = lines.reduce((sum, l) => {
      const q = Number(l.quantity) || 0
      const p = Number(l.unit_price) || 0
      return sum + q * p
    }, 0)

    const { data: resp, error: respErr } = await supabase
      .from('rfq_vendor_responses')
      .insert({
        rfq_send_id: send.id,
        quotation_id: send.quotation_id,
        vendor_id: send.vendor_id,
        vendor_name: send.vendor_name,
        method: 'portal',
        contact_name: body.contact_name || send.recipient_name || null,
        contact_email: body.contact_email || send.recipient_email || null,
        currency: body.currency || 'USD',
        incoterm: body.incoterm || null,
        payment_terms: body.payment_terms || null,
        lead_time_days: body.lead_time_days ?? null,
        moq_note: body.moq_note || null,
        validity_days: body.validity_days ?? null,
        plate_die_charges: body.plate_die_charges || null,
        overrun_tolerance: body.overrun_tolerance || null,
        exclusions: body.exclusions || null,
        certifications: body.certifications || null,
        sample_available: body.sample_available ?? null,
        notes: body.notes || null,
        total_value: total || null,
      })
      .select('id')
      .single()

    if (respErr || !resp) {
      console.error('[rfq/vendor-response POST] insert', respErr)
      return NextResponse.json({ error: 'Could not save your quote. Please try again.' }, { status: 500 })
    }

    if (lines.length) {
      const payload = lines.map((l, i) => {
        const q = Number(l.quantity) || 0
        const p = Number(l.unit_price) || 0
        return {
          response_id: resp.id,
          quotation_line_id: l.quotation_line_id || null,
          sku: l.sku || null,
          description: l.description || null,
          quantity: q || null,
          unit_price: p || null,
          pcs_per_case: l.pcs_per_case ?? null,
          case_price: l.case_price ?? null,
          line_total: q && p ? q * p : null,
          notes: l.notes || null,
          sort_order: i,
        }
      })
      const { error: lineErr } = await supabase.from('rfq_response_lines').insert(payload)
      if (lineErr) console.error('[rfq/vendor-response POST] lines', lineErr)
    }

    await supabase
      .from('rfq_sends')
      .update({ status: 'Responded', responded_at: new Date().toISOString() })
      .eq('id', send.id)

    const { data: rfq } = await supabase
      .from('quotations')
      .select('quote_number')
      .eq('id', send.quotation_id)
      .single()

    if (RESEND_API_KEY) {
      const rows = lines
        .map(l => `<tr>
            <td style="padding:6px 10px;border:1px solid #E4EAE6;">${l.description || l.sku || ''}</td>
            <td style="padding:6px 10px;border:1px solid #E4EAE6;text-align:right;">${l.quantity ?? ''}</td>
            <td style="padding:6px 10px;border:1px solid #E4EAE6;text-align:right;">${l.unit_price != null ? (body.currency || 'USD') + ' ' + l.unit_price : ''}</td>
          </tr>`)
        .join('')

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `beyondGREEN ERP <${FROM_EMAIL}>`,
          to: [NOTIF_EMAIL],
          subject: `Quote received — ${send.vendor_name} — ${rfq?.quote_number || 'RFQ'}`,
          html: `
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#17202A;">
              <p><strong>${send.vendor_name}</strong> has submitted a quote for ${rfq?.quote_number || 'this RFQ'}.</p>
              <p style="color:#4A5568;">
                ${body.incoterm ? `Incoterm: ${body.incoterm}<br>` : ''}
                ${body.lead_time_days ? `Lead time: ${body.lead_time_days} days<br>` : ''}
                ${body.payment_terms ? `Payment terms: ${body.payment_terms}<br>` : ''}
                ${body.moq_note ? `MOQ: ${body.moq_note}` : ''}
              </p>
              ${rows ? `<table style="border-collapse:collapse;font-size:13px;margin-top:10px;">
                <tr><th style="padding:6px 10px;border:1px solid #E4EAE6;background:#14532D;color:#fff;text-align:left;">Item</th>
                    <th style="padding:6px 10px;border:1px solid #E4EAE6;background:#14532D;color:#fff;">Qty</th>
                    <th style="padding:6px 10px;border:1px solid #E4EAE6;background:#14532D;color:#fff;">Unit price</th></tr>
                ${rows}</table>` : ''}
              <p style="margin-top:18px;">
                <a href="${APP_URL}/sales/quotations" style="color:#1F9A3A;">Open it in the ERP</a>
              </p>
            </div>`,
        }),
      }).catch(e => console.error('[rfq/vendor-response] notify', e))
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[rfq/vendor-response POST]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
