/**
 * GET/POST /api/leads/reply-scan
 *
 * Scans each connected Outlook mailbox for the LAST 3 DAYS of inbound messages,
 * classifies them, and:
 *   - bounce   → mark customer is_dead_lead, pause all their enrollments
 *   - ooo      → record only (transient, don't act)
 *   - decline  → auto_outreach_paused=TRUE, last_reply_intent='declined', pause enrollments
 *   - unsub    → auto_outreach_paused=TRUE, do_not_contact=TRUE, pause enrollments
 *   - interested → pipeline_stage='Replied', pause enrollments (human takes over)
 *   - replied (ambiguous) → pipeline_stage='Replied', pause enrollments
 *
 * Writes a full row to reply_scan_runs with per-classification counts.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { getOutlookAccessToken } from '@/lib/outlook'

export const maxDuration = 60

// ---------- classifier ---------------------------------------------------

type Kind = 'bounce' | 'ooo' | 'unsub' | 'decline' | 'interested' | 'replied'

const BOUNCE_SUBJECT = /(undeliverable|delivery (status notification|failed|failure)|mail delivery failed|returned mail|address not found|550 |recipient rejected|non[- ]?delivery)/i
const BOUNCE_FROM    = /(mailer[- ]?daemon|postmaster|noreply@|no-?reply@|bounces?@|mailerdaemon)/i
const OOO_SUBJECT    = /(out of (the )?office|out of office|auto[- ]?reply|automatic reply|automatic response|currently (away|out|unavailable)|on vacation|on leave|maternity leave|paternity leave|holiday reply|is out today|away from (my|the) (desk|office))/i
const OOO_HEADER_KEYS = ['auto-submitted', 'x-autoreply', 'x-autorespond', 'x-auto-response-suppress', 'precedence']

const UNSUB_BODY     = /(please )?(unsubscribe|remove me (from|from your)|take me off (your |the )?list|opt[- ]?out|do not (contact|email) (me|us)( again)?|stop (emailing|contacting|sending))/i
const DECLINE_BODY   = /(not interested|no thanks|no thank you|not (a )?(good )?fit|not (at )?(this|the) time|not (right )?now|circle back (later|next)|not (currently|actively) looking|we (already have|are all set|have a (provider|vendor|supplier))|please stop|we (don'?t|do not) need|no need|pass on this|move on|remove (us|our|me) from|not for us|we'?ll pass)/i
const INTEREST_BODY  = /\b(yes[!, .]|sounds (great|good|interesting)|(would )?love to (learn more|see|hear|chat|talk|discuss)|(please )?send (over |along )?(more info|samples|the (deck|catalog|pricing|quote|spec sheet))|(let'?s |can we )?(schedule|set up|book|hop on|jump on) (a call|time|a meeting|something)|interested( in|,)|tell me more|(happy|available) to (chat|talk|discuss|meet)|when (can|are) you (available|free)|what('?s| is) (the )?(next step|pricing)|please share)/i

function extractPlainBody(msg: any): string {
  const b = msg?.body?.content || ''
  if (msg?.body?.contentType === 'html') {
    return b.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 4000)
  }
  return String(b).slice(0, 4000)
}

function classify(msg: any): Kind {
  const from = (msg?.from?.emailAddress?.address || '').toLowerCase()
  const subj = String(msg?.subject || '')
  const headers: any[] = msg?.internetMessageHeaders || []
  const hdrMap: Record<string, string> = {}
  headers.forEach((h: any) => { if (h?.name) hdrMap[String(h.name).toLowerCase()] = String(h.value || '').toLowerCase() })

  // 1. Hard bounce: DSN
  if (BOUNCE_FROM.test(from) || BOUNCE_SUBJECT.test(subj)) return 'bounce'
  if ((hdrMap['content-type'] || '').includes('multipart/report')) return 'bounce'

  // 2. Auto-reply / OOO
  const autoSub = hdrMap['auto-submitted'] || ''
  if (autoSub && autoSub !== 'no' && autoSub !== '') return 'ooo'
  if (OOO_HEADER_KEYS.some(k => (hdrMap[k] || '').match(/(auto[- ]?repl|auto[- ]?respond|auto_reply|bulk)/i))) return 'ooo'
  if (OOO_SUBJECT.test(subj)) return 'ooo'

  // 3. Body-based classification — real human replies
  const body = extractPlainBody(msg)
  const lowSubj = subj.toLowerCase()
  if (UNSUB_BODY.test(body) || UNSUB_BODY.test(lowSubj)) return 'unsub'
  if (DECLINE_BODY.test(body) || DECLINE_BODY.test(lowSubj)) return 'decline'
  if (INTEREST_BODY.test(body) || INTEREST_BODY.test(lowSubj)) return 'interested'
  return 'replied'
}

// ---------- Graph fetch --------------------------------------------------

async function fetchInbox(token: string, sinceIso: string) {
  const url = new URL('https://graph.microsoft.com/v1.0/me/messages')
  url.searchParams.set('$top', '250')
  url.searchParams.set('$select', 'id,from,subject,body,internetMessageHeaders,receivedDateTime,isRead,conversationId')
  url.searchParams.set('$filter', `receivedDateTime ge ${sinceIso}`)
  url.searchParams.set('$orderby', 'receivedDateTime desc')
  const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="text"' } })
  if (!r.ok) throw new Error(`Graph ${r.status}: ${await r.text().catch(() => '')}`)
  const j = await r.json()
  return (j.value || []) as any[]
}

// ---------- shared handler ----------------------------------------------

async function runScan(triggeredBy: 'manual' | 'cron') {
  const sb = createSupabaseAdminClient()
  const nowIso = new Date().toISOString()
  const sinceIso = new Date(Date.now() - 3 * 86400000).toISOString() // last 3 days

  // Connected mailboxes
  const { data: mailboxes } = await sb.from('user_email_connections')
    .select('email,provider').eq('provider', 'microsoft')

  const boxes = (mailboxes || []).map((m: any) => String(m.email || '').toLowerCase()).filter(Boolean)
  if (!boxes.length) {
    await sb.from('reply_scan_runs').insert({ ran_at: nowIso, triggered_by: triggeredBy, mailboxes: [], scanned: 0, error: 'no mailboxes connected' })
    return { scanned: 0, error: 'no mailboxes connected' }
  }

  // Aggregate counts
  const counts = { scanned: 0, bounce: 0, ooo: 0, replied: 0, interested: 0, unsub: 0, decline: 0, already_bounced: 0, already_ooo: 0 }
  const auditPerCust: Record<string, { kind: Kind; subject: string; from: string; mailbox: string }> = {}
  const errs: string[] = []

  // ---- Pull messages FIRST, then look up only the leads we need. ----
  // Old code did `sb.from('customers').select(...)` which Supabase caps at
  // 1,000 rows server-side. With 14k+ customers that meant ~93% of replies
  // silently failed the leadByEmail lookup and were dropped. See:
  // reply for rick@zumaandsons.com Jul 20 2026 that never registered.
  type FetchedMsg = { mbox: string; msg: any }
  const allMessages: FetchedMsg[] = []

  for (const mbox of boxes) {
    try {
      const token = await getOutlookAccessToken(mbox)
      if (!token) { errs.push(`${mbox}: no token`); continue }
      const messages = await fetchInbox(token, sinceIso)
      counts.scanned += messages.length
      for (const m of messages) allMessages.push({ mbox, msg: m })
    } catch (e: any) {
      errs.push(`${mbox}: ${e?.message || String(e)}`)
    }
  }

  // Collect every email address we need to resolve to a lead:
  //   - direct from-address on every message
  //   - for probable bounces (from address looks like a daemon), also parse
  //     the ORIGINAL recipient out of the body/headers
  const needed = new Set<string>()
  for (const { msg } of allMessages) {
    const fromEmail = String(msg?.from?.emailAddress?.address || '').toLowerCase()
    if (fromEmail) needed.add(fromEmail)
    if (BOUNCE_FROM.test(fromEmail) || BOUNCE_SUBJECT.test(String(msg?.subject || ''))) {
      const body = extractPlainBody(msg)
      const found = body.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []
      for (const cand of found) needed.add(cand.toLowerCase())
    }
  }

  // Chunked lookup — .in() with too many items also truncates via URL length,
  // so keep batches conservative.
  const leadByEmail: Record<string, any> = {}
  if (needed.size) {
    const emails = [...needed]
    const CHUNK = 200
    for (let i = 0; i < emails.length; i += CHUNK) {
      const batch = emails.slice(i, i + CHUNK)
      const { data: rows, error } = await sb.from('customers')
        .select('id,email,company_name,is_dead_lead,auto_outreach_paused,do_not_contact,pipeline_stage')
        .in('email', batch)
      if (error) { errs.push(`lookup: ${error.message}`); continue }
      ;(rows || []).forEach((c: any) => { if (c.email) leadByEmail[String(c.email).toLowerCase()] = c })
    }
  }

  // Now walk messages and apply the classification.
  for (const { mbox, msg: m } of allMessages) {
    const fromEmail = String(m?.from?.emailAddress?.address || '').toLowerCase()
    if (!fromEmail) continue

    const kind = classify(m)

    let lead = leadByEmail[fromEmail]
    if (!lead && kind === 'bounce') {
      const body = extractPlainBody(m)
      const found = body.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []
      for (const cand of found) {
        const c = leadByEmail[cand.toLowerCase()]
        if (c) { lead = c; break }
      }
    }
    if (!lead) continue

    if (kind === 'bounce' && lead.is_dead_lead) { counts.already_bounced++; continue }
    if (kind === 'ooo' && lead.pipeline_stage === 'OOO') { counts.already_ooo++; continue }

    if (kind === 'bounce') counts.bounce++
    else if (kind === 'ooo') counts.ooo++
    else if (kind === 'unsub') counts.unsub++
    else if (kind === 'decline') counts.decline++
    else if (kind === 'interested') { counts.interested++; counts.replied++ }
    else counts.replied++

    auditPerCust[lead.id] = { kind, subject: String(m.subject || '').slice(0, 120), from: fromEmail, mailbox: mbox }

    const upd: any = { updated_at: nowIso }
    if (kind === 'bounce') {
      upd.is_dead_lead = true
      upd.pipeline_stage = 'Dead'
    } else if (kind === 'ooo') {
      upd.pipeline_stage = 'OOO'
    } else if (kind === 'unsub') {
      upd.auto_outreach_paused = true
      upd.do_not_contact = true
      upd.last_reply_at = nowIso
      upd.last_reply_intent = 'unsubscribed'
      upd.pipeline_stage = 'Unsubscribed'
    } else if (kind === 'decline') {
      upd.auto_outreach_paused = true
      upd.last_reply_at = nowIso
      upd.last_reply_intent = 'declined'
      upd.pipeline_stage = 'Declined'
    } else if (kind === 'interested') {
      upd.last_reply_at = nowIso
      upd.last_reply_intent = 'interested'
      upd.pipeline_stage = 'Replied'
    } else {
      upd.last_reply_at = nowIso
      upd.last_reply_intent = 'replied'
      upd.pipeline_stage = 'Replied'
    }
    await sb.from('customers').update(upd).eq('id', lead.id)

    if (kind === 'bounce' || kind === 'unsub' || kind === 'decline' || kind === 'interested' || kind === 'replied') {
      await sb.from('sequence_enrollments')
        .update({ status: 'paused', stop_reason: `Auto-paused by reply-scan: ${kind}`, updated_at: nowIso })
        .eq('customer_id', lead.id).eq('status', 'active')
      const { data: pending } = await sb.from('sequence_sends').select('id').eq('customer_id', lead.id).eq('status', 'review')
      if (pending && pending.length) {
        await sb.from('sequence_sends').update({ status: 'skipped' }).in('id', pending.map((r: any) => r.id))
      }
    }
  }

  // Write log row
  await sb.from('reply_scan_runs').insert({
    ran_at: nowIso,
    triggered_by: triggeredBy,
    mailboxes: boxes,
    scanned: counts.scanned,
    bounced: counts.bounce,
    ooo: counts.ooo,
    replies: counts.replied,
    interested: counts.interested,
    unsubscribed: counts.unsub,
    declined: counts.decline,
    already_bounced: counts.already_bounced,
    already_ooo: counts.already_ooo,
    details: { audit: auditPerCust, errors: errs },
    error: errs.length ? errs.join(' | ').slice(0, 1000) : null,
  })

  const message = `Scanned ${counts.scanned} message(s) across ${boxes.length} mailbox(es) · ${counts.bounce} new bounce${counts.bounce === 1 ? '' : 's'} marked inactive (${counts.already_bounced} already inactive), ${counts.ooo} new out-of-office noted (${counts.already_ooo} already noted), ${counts.replied} real repl${counts.replied === 1 ? 'y' : 'ies'} (${counts.interested} interested, ${counts.decline} declined, ${counts.unsub} unsubscribed).`
  return { ...counts, mailboxes: boxes, errors: errs, message }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const need = process.env.REPLY_SCAN_KEY
  const isCron = url.searchParams.get('cron') === '1'
  if (isCron && need && url.searchParams.get('key') !== need) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const res = await runScan(isCron ? 'cron' : 'manual')
  return NextResponse.json(res)
}

export async function POST() {
  const res = await runScan('manual')
  return NextResponse.json(res)
}
