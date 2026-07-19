/**
 * POST /api/lp/track — records a landing-page visit for analytics.
 * Public: called from the /lp/[slug] client on load. No auth required.
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
  const slug: string = String(body.slug || '').slice(0, 200)
  if (!slug) return NextResponse.json({ ok: false, error: 'missing slug' }, { status: 400 })

  const row = {
    slug,
    session_id: body.session_id ? String(body.session_id).slice(0, 80) : null,
    recipient_id: isUuid(body.recipient_id) ? body.recipient_id : null,
    utm_source: body.utm_source ? String(body.utm_source).slice(0, 80) : null,
    utm_medium: body.utm_medium ? String(body.utm_medium).slice(0, 80) : null,
    utm_campaign: body.utm_campaign ? String(body.utm_campaign).slice(0, 120) : null,
    referrer: body.referrer ? String(body.referrer).slice(0, 500) : null,
    user_agent: req.headers.get('user-agent')?.slice(0, 300) || null,
  }
  await sb.from('landing_page_views').insert(row)
  return NextResponse.json({ ok: true })
}
