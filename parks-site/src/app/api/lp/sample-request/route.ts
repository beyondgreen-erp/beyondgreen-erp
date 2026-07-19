/**
 * POST /api/lp/sample-request — receives the sample-request form from the public
 * landing page and files a new row in public.sample_submissions so the request
 * appears on /operations/samples exactly like a manually created one.
 * Also fires a landing_page_views record so the form fill is tracked.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

function isUuid(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

export async function POST(req: NextRequest) {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  let body: any = {}
  try { body = await req.json() } catch { /* ignore */ }

  const facility = String(body.facility || '').trim()
  const name = String(body.name || '').trim()
  const email = String(body.email || '').trim()
  const address = String(body.address || '').trim()
  const product = String(body.product || 'beyondGREEN Dog Waste Bags — 200ct roll + 100ct single-pull pack').trim()
  const note = String(body.note || '').trim()
  const slug = String(body.slug || '').trim()
  const recipient_id = isUuid(body.recipient_id) ? body.recipient_id : null

  if (!facility || !name || !email) return NextResponse.json({ ok: false, error: 'Missing required fields (organization, name, email).' }, { status: 400 })
  if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ ok: false, error: 'Please enter a valid email address.' }, { status: 400 })

  const insertNote = `Landing page: ${slug}\n${note}${recipient_id ? `\nRecipient ID: ${recipient_id}` : ''}`

  const { data, error } = await sb.from('sample_submissions').insert({
    name: name,
    requesting_facility: facility,
    requestor: name,
    customer_email: email,
    customer_type: 'Government',
    product,
    status: 'Sample Requested',
    group_name: 'Sample Requested',
    ship_to_address: address || null,
    note: insertNote,
    is_custom_request: false,
    tagged_people: [],
    attachments: [],
    created_by: `landing-page:${slug}`,
    position: Date.now(),
  }).select('id').single()

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  // Also record the conversion in landing_page_views with a distinguishing utm_medium
  try {
    await sb.from('landing_page_views').insert({
      slug,
      session_id: body.session_id || null,
      recipient_id,
      utm_source: 'landing-page',
      utm_medium: 'sample-request',
      utm_campaign: slug,
      referrer: 'sample-form',
    })
  } catch { /* ignore */ }

  return NextResponse.json({ ok: true, id: data?.id, message: 'Your sample request is in — expect an email within 1 business day.' })
}
