import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { getOutlookAccessToken, findReplyFrom } from '@/lib/outlook'

export const maxDuration = 60
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

type Intent = 'interested' | 'meeting' | 'question' | 'not_interested' | 'unsubscribe' | 'auto_reply' | 'other'

async function classify(subject: string, preview: string): Promise<{ intent: Intent; reason: string }> {
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `You classify replies to a cold B2B sales email (compostable packaging). Return ONLY raw JSON: {"intent":"<one of: interested, meeting, question, not_interested, unsubscribe, auto_reply, other>","reason":"<6 words max>"}.
- interested = positive / wants info / samples / pricing
- meeting = wants a call/demo/meeting
- question = asking a clarifying question but not clearly positive
- not_interested = polite no / not now / already have a vendor
- unsubscribe = asks to stop, remove, do not contact, take me off
- auto_reply = out-of-office / auto-responder / bounce
- other = anything else

Subject: ${subject}
Body: ${preview}`,
      }],
    })
    const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : '{}'
    const a = raw.indexOf('{'); const b = raw.lastIndexOf('}')
    const j = JSON.parse(raw.slice(a, b + 1))
    const ok: Intent[] = ['interested', 'meeting', 'question', 'not_interested', 'unsubscribe', 'auto_reply', 'other']
    return { intent: ok.includes(j.intent) ? j.intent : 'other', reason: String(j.reason || '') }
  } catch { return { intent: 'other', reason: 'unclassified' } }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const need = process.env.REPLY_SCAN_KEY
  if (need && url.searchParams.get('key') !== need) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = createSupabaseAdminClient()

  // Use the connected outreach mailbox (most recently connected Microsoft account).
  const { data: conn } = await sb.from('user_email_connections').select('email').eq('provider', 'microsoft').order('connected_at', { ascending: false }).limit(1).maybeSingle()
  if (!conn?.email) return NextResponse.json({ error: 'No connected mailbox. Connect one in Settings → Email Connection.' }, { status: 400 })
  const token = await getOutlookAccessToken(conn.email as string)
  if (!token) return NextResponse.json({ error: 'Mailbox token unavailable (reconnect the mailbox).' }, { status: 400 })

  // Active enrollments that have been emailed at least once.
  const { data: enrolls } = await sb.from('sequence_enrollments')
    .select('id, customer_id, sequence_id, last_step_sent_at, enrolled_at')
    .eq('status', 'active').not('last_step_sent_at', 'is', null).limit(60)
  const rows = enrolls || []
  if (!rows.length) return NextResponse.json({ scanned: 0, replies: 0, message: 'No active enrollments with sent emails yet. Replies are scanned once sequences start sending.' })

  const custIds = rows.map(r => r.customer_id)
  const { data: custs } = await sb.from('customers').select('id, email, company_name').in('id', custIds)
  const byId: Record<string, any> = {}; (custs || []).forEach(c => { byId[c.id] = c })

  let replies = 0, interested = 0, unsub = 0, stopped = 0
  for (const e of rows) {
    const c = byId[e.customer_id]
    if (!c?.email) continue
    const since = (e.last_step_sent_at || e.enrolled_at) as string
    const hit = await findReplyFrom(token, c.email, since)
    if (!hit) continue
    replies++
    const { intent, reason } = await classify(hit.subject, hit.preview)
    if (intent === 'auto_reply') { replies--; continue } // ignore OOO/bounces, keep sequence running

    const now = new Date().toISOString()
    // Any genuine reply means the lead is alive again — clear any dead flag.
    const custPatch: Record<string, unknown> = { last_reply_intent: intent, last_reply_at: now, updated_at: now, is_dead_lead: false }
    let enrStatus = 'replied'

    if (intent === 'interested' || intent === 'meeting' || intent === 'question') {
      enrStatus = 'interested'; interested++
      custPatch.auto_outreach_paused = true
      custPatch.customer_status = 'Interested'
      custPatch.pipeline_stage = intent === 'meeting' ? 'Meeting' : 'Engaged'
    } else if (intent === 'unsubscribe') {
      enrStatus = 'dnc'; unsub++
      custPatch.do_not_contact = true
      await sb.from('lead_list_members').delete().eq('customer_id', e.customer_id)
    } else { stopped++ }

    await sb.from('sequence_enrollments').update({ status: enrStatus, replied_at: now, stop_reason: `${intent}: ${reason}`, updated_at: now }).eq('id', e.id)
    await sb.from('customers').update(custPatch).eq('id', e.customer_id)
    try {
      await sb.from('email_logs').insert({ from_email: c.email, subject: hit.subject, body_snippet: hit.preview.slice(0, 400), log_type: 'reply', linked_id: e.customer_id, linked_label: `Lead reply · ${intent}`, note: reason, logged_at: hit.receivedDateTime })
    } catch { /* ignore */ }
  }

  return NextResponse.json({
    scanned: rows.length, replies, interested, unsubscribed: unsub, stopped,
    message: `Scanned ${rows.length} · ${replies} replies (${interested} interested, ${unsub} unsubscribed, ${stopped} declined).`,
  })
}
