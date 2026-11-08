/* eslint-disable @typescript-eslint/no-explicit-any */
// POST /api/track/outlook-send
// Called by the beyondGREEN Outlook add-in the moment a beyondGREEN user hits Send.
// Creates a tracked outreach row (open pixel + click links) and returns its token,
// which the add-in writes into the email before it leaves.
// Internal-only emails (all recipients on our own domains) are not tracked.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const INTERNAL = ['beyondgreenbiotech.com', 'byndgrn.com', 'bgpro.net']
const SENDER_DOMAINS = ['beyondgreenbiotech.com', 'byndgrn.com']
const FREE = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'live.com', 'msn.com', 'me.com']

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

type Rcpt = { email?: string; name?: string }
const clean = (r: Rcpt[] | undefined) =>
  (Array.isArray(r) ? r : [])
    .map(x => ({ email: String(x?.email || '').trim().toLowerCase(), name: String(x?.name || '').slice(0, 200) }))
    .filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x.email))
    .slice(0, 50)
const domainOf = (e: string) => e.split('@')[1] || ''
const isInternal = (e: string) => INTERNAL.includes(domainOf(e))

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function POST(req: NextRequest) {
  const no = (why: string) => NextResponse.json({ track: false, why }, { headers: CORS })
  let body: any
  try { body = await req.json() } catch { return no('bad json') }

  const from = String(body?.from || '').trim().toLowerCase()
  if (!SENDER_DOMAINS.includes(domainOf(from))) return no('sender not tracked')

  const to = clean(body?.to)
  const cc = clean(body?.cc)
  const external = [...to, ...cc].filter(r => !isInternal(r.email))
  if (external.length === 0) return no('internal only')
  const primary = to.find(r => !isInternal(r.email)) || external[0]
  const subject = String(body?.subject || '').slice(0, 500)

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // Simple abuse guard: at most 60 tracked sends per sender per 10 minutes.
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { count } = await admin.from('customer_outreach').select('id', { count: 'exact', head: true })
    .eq('sent_by', from).eq('kind', 'outlook').gte('sent_at', since)
  if ((count || 0) >= 60) return no('rate limited')

  // Link to the customer record when we know them (exact email first, then company domain).
  let customerId: string | null = null
  const { data: byEmail } = await admin.from('customers').select('id').ilike('email', primary.email).limit(1)
  if (byEmail && byEmail[0]) customerId = byEmail[0].id
  const dom = domainOf(primary.email)
  if (!customerId && dom && !FREE.includes(dom)) {
    const { data: byDom } = await admin.from('customers').select('id').ilike('email', `%@${dom}`).limit(1)
    if (byDom && byDom[0]) customerId = byDom[0].id
  }

  const others = external.filter(r => r.email !== primary.email).map(r => r.email)
  const { data, error } = await admin.from('customer_outreach').insert({
    customer_id: customerId,
    to_email: primary.email,
    sent_at: new Date().toISOString(),
    sent_by: from,
    subject,
    body: `Sent from Outlook (tracking add-in).${others.length ? ' Also to: ' + others.join(', ') : ''}`.slice(0, 2000),
    status: 'sent',
    kind: 'outlook',
    delivered_via: 'outlook-addin',
    tracked: true,
    campaign: 'Outlook (sent by hand)',
    follow_up_days: 0,
    sequence_step: 0,
    max_follow_ups: 0,
  }).select('track_token').single()

  if (error || !data) return no(error?.message || 'insert failed')
  return NextResponse.json({ track: true, token: data.track_token }, { headers: CORS })
}
