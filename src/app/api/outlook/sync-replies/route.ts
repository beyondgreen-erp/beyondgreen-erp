// GET /api/outlook/sync-replies — system job (called by cron). For each outreach that's
// been sent and is awaiting a reply, checks the sender's Outlook inbox for a reply from
// the recipient and, if found, marks the outreach as responded automatically.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getOutlookAccessToken, inboxHasReplyFrom, outlookConfigured } from '@/lib/outlook'

export const maxDuration = 60

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const provided =
      req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret')
    if (provided !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!outlookConfigured()) return NextResponse.json({ ok: true, note: 'outlook not configured' })

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Outreach that was sent, has a recipient, and is still awaiting a reply.
  const { data: open, error } = await admin
    .from('customer_outreach')
    .select('id, sent_by, sent_at, to_email')
    .eq('status', 'sent')
    .eq('response_received', false)
    .not('to_email', 'is', null)
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!open || open.length === 0) return NextResponse.json({ ok: true, checked: 0, marked: 0 })

  // Cache one access token per sender.
  const tokenBySender: Record<string, string | null> = {}
  let marked = 0
  for (const o of open as any[]) {
    const sender = (o.sent_by || '').toLowerCase()
    if (!sender || !o.to_email || !o.sent_at) continue
    if (!(sender in tokenBySender)) tokenBySender[sender] = await getOutlookAccessToken(sender)
    const token = tokenBySender[sender]
    if (!token) continue
    try {
      const found = await inboxHasReplyFrom(token, o.to_email, new Date(o.sent_at).toISOString())
      if (found) {
        await admin
          .from('customer_outreach')
          .update({
            response_received: true,
            response_at: new Date().toISOString(),
            response_notes: 'Auto-detected reply in Outlook',
            status: 'responded',
          })
          .eq('id', o.id)
        marked++
      }
    } catch {
      // skip on error, try again next run
    }
  }
  return NextResponse.json({ ok: true, checked: open.length, marked })
}
