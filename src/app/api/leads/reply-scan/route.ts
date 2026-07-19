/**
 * GET /api/leads/reply-scan
 * Scans the outreach mailbox(es) — the from_email of active sequences (e.g.
 * rudy.patel@byndgrn.com) — and reacts to what actually landed in the inbox:
 *
 *   • Bounce / NDR (undeliverable)  -> mark the matched lead INACTIVE, stop the
 *     enrollment, and note it on the lead.
 *   • Out-of-office / auto-reply     -> append a note to the lead, keep sending.
 *   • Genuine human reply            -> AI-classify (interested / not / unsub …)
 *     and update the lead + enrollment exactly like before.
 *
 * Idempotent-ish: bounces only fire while a lead is still active; OOO notes are
 * de-duped by a timestamp stamp; replies only fire while the enrollment is active.
 */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { getOutlookAccessToken } from '@/lib/outlook'

export const maxDuration = 60
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const LOOKBACK_DAYS = 14
const MAX_MESSAGES = 200
const MAX_BODY_FETCHES = 40 // cap Graph body lookups for bounces so we stay under the timeout

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi
const BOUNCE_SENDER_RE = /postmaster|mailer-daemon|mail delivery (subsystem|system)|microsoftexchange|no[-.]?reply@.*(mail|exchange)/i
const BOUNCE_SUBJECT_RE = /undeliverable|delivery (has )?failed|delivery status notification|delivery failure|returned mail|address (not found|couldn'?t be found|rejected)|recipient.*(not found|reject)|mailbox (full|unavailable|not found)|550 5\.|message not delivered/i
const OOO_SUBJECT_RE = /^(automatic reply|auto:|auto reply|autoreply|out of office|out-of-office)\b|out of (the )?office|automatic reply|on (vacation|leave|holiday|pto)|away from (the )?office|currently (out|away|unavailable)/i

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

async function fetchInbox(token: string, sinceIso: string): Promise<any[]> {
  const filter = `receivedDateTime ge ${sinceIso}`
  const url =
    `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$select=id,subject,from,toRecipients,bodyPreview,receivedDateTime&$top=${MAX_MESSAGES}&$orderby=receivedDateTime desc&$filter=` +
    encodeURIComponent(filter)
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: 'eventual' } })
  if (!r.ok) return []
  const j = await r.json()
  return Array.isArray(j.value) ? j.value : []
}

async function fetchBody(token: string, id: string): Promise<string> {
  try {
    const r = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${id}?$select=body`, { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) return ''
    const j = await r.json()
    return (j.body?.content || '').replace(/<[^>]+>/g, ' ')
  } catch { return '' }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const need = process.env.REPLY_SCAN_KEY
  if (need && url.searchParams.get('key') !== need) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = createSupabaseAdminClient()

  // Which mailboxes to scan: the from_email of every active sequence (that's the
  // inbox replies/bounces land in). This targets rudy.patel@byndgrn.com directly.
  const { data: activeSeqs } = await sb.from('sequences').select('id, from_email').eq('status', 'active')
  let mailboxes = [...new Set(((activeSeqs as any[]) || []).map(s => s.from_email).filter(Boolean))] as string[]
  if (!mailboxes.length) {
    const { data: conn } = await sb.from('user_email_connections').select('email').eq('provider', 'microsoft').order('connected_at', { ascending: false }).limit(1).maybeSingle()
    if (conn?.email) mailboxes = [conn.email as string]
  }
  if (!mailboxes.length) return NextResponse.json({ error: 'No outreach mailbox found. Connect one in Settings → Email Connection.' }, { status: 400 })

  const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString()
  const nowIso = new Date().toISOString()
  const today = nowIso.slice(0, 10)

  // ---- Diagnostic mode: ?debug=1 categorizes the inbox WITHOUT mutating anything ----
  if (url.searchParams.get('debug') === '1') {
    const dbg: any[] = []
    for (const mailbox of mailboxes) {
      const token = await getOutlookAccessToken(mailbox)
      if (!token) { dbg.push({ mailbox, error: 'no token' }); continue }
      const seqIds = ((activeSeqs as any[]) || []).filter(s => s.from_email === mailbox).map(s => s.id)
      let enrRows: any[] = []
      if (seqIds.length) { const { data } = await sb.from('sequence_enrollments').select('id, customer_id, status').in('sequence_id', seqIds).limit(5000); enrRows = (data as any[]) || [] }
      const custIds = [...new Set(enrRows.map(e => e.customer_id))]
      const custById: Record<string, any> = {}
      for (let i = 0; i < custIds.length; i += 300) { const { data: cs } = await sb.from('customers').select('id, email').in('id', custIds.slice(i, i + 300)); (cs as any[] || []).forEach(c => { custById[c.id] = c }) }
      const byEmail: Record<string, boolean> = {}
      for (const e of enrRows) { const c = custById[e.customer_id]; if (c?.email) byEmail[String(c.email).toLowerCase()] = true }
      // subject -> to_email map from outgoing sends (for subject-based bounce matching)
      let sentSubjMap: Record<string, string> = {}
      if (seqIds.length) {
        const { data: sends } = await sb.from('sequence_sends').select('subject,to_email').in('sequence_id', seqIds).limit(5000)
        for (const sd of (sends as any[]) || []) { const k = String(sd.subject || '').trim().toLowerCase(); if (k && sd.to_email) sentSubjMap[k] = String(sd.to_email).toLowerCase() }
      }
      const stripPrefix = (subj: string) => subj.replace(/^(undeliverable|automatic reply|auto:|re|fwd?|delivery status notification|mail delivery)\s*:?\s*/i, '').trim()
      const msgs = await fetchInbox(token, sinceIso)
      let matchPreview = 0, matchBody = 0, matchSubject = 0, stillUnmatched = 0, bodyFetches = 0
      const unmatchedSamples: any[] = []
      for (const m of msgs) {
        const sender = String(m.from?.emailAddress?.address || '').toLowerCase()
        const subject = String(m.subject || '').trim()
        const preview = String(m.bodyPreview || '')
        const looksBounce = BOUNCE_SENDER_RE.test(sender) || BOUNCE_SUBJECT_RE.test(subject)
        if (!looksBounce) continue
        // 1) preview
        let matches = [...new Set(((subject + ' ' + preview).toLowerCase().match(EMAIL_RE) || []))].filter(e => byEmail[e])
        if (matches.length) { matchPreview++; continue }
        // 2) body
        if (bodyFetches < 200) { bodyFetches++; const full = (await fetchBody(token, m.id)).toLowerCase(); matches = [...new Set((full.match(EMAIL_RE) || []))].filter(e => byEmail[e]) }
        if (matches.length) { matchBody++; continue }
        // 3) subject vs outgoing sends
        const key = stripPrefix(subject).toLowerCase()
        if (sentSubjMap[key] && byEmail[sentSubjMap[key]]) { matchSubject++; continue }
        stillUnmatched++
        if (unmatchedSamples.length < 10) unmatchedSamples.push({ from: sender, subject: subject.slice(0, 80), strippedKey: key.slice(0, 60), hadSentMatch: !!sentSubjMap[key] })
      }
      dbg.push({ mailbox, total: msgs.length, sentSubjCount: Object.keys(sentSubjMap).length, bounce: { matchPreview, matchBody, matchSubject, stillUnmatched }, unmatchedSamples })
    }
    return NextResponse.json({ debug: true, mailboxes: dbg })
  }


  let scanned = 0, bounced = 0, ooo = 0, replies = 0, interested = 0, unsub = 0, declined = 0
  let alreadyBounced = 0, alreadyOoo = 0
  const perMailbox: any[] = []
  const detBounced: any[] = [], detOoo: any[] = [], detReplies: any[] = []
  const triggeredBy = (url.searchParams.get('src') === 'cron') ? 'cron' : 'manual'

  for (const mailbox of mailboxes) {
    const token = await getOutlookAccessToken(mailbox)
    if (!token) { perMailbox.push({ mailbox, error: 'token unavailable (reconnect mailbox)' }); continue }

    // Sequences that send from this mailbox, and their enrollments -> lead lookup by email.
    const seqIds = ((activeSeqs as any[]) || []).filter(s => s.from_email === mailbox).map(s => s.id)
    let enrRows: any[] = []
    if (seqIds.length) {
      const { data: enrolls } = await sb.from('sequence_enrollments').select('id, customer_id, sequence_id, status').in('sequence_id', seqIds).limit(5000)
      enrRows = (enrolls as any[]) || []
    }
    const custIds = [...new Set(enrRows.map(e => e.customer_id))]
    const custById: Record<string, any> = {}
    for (let i = 0; i < custIds.length; i += 300) {
      const { data: cs } = await sb.from('customers').select('id, email, company_name, is_active, notes').in('id', custIds.slice(i, i + 300))
      ;(cs as any[] || []).forEach(c => { custById[c.id] = c })
    }
    // email -> { customer, enrollment }
    const byEmail: Record<string, { cust: any; enr: any }> = {}
    for (const e of enrRows) {
      const c = custById[e.customer_id]
      if (!c?.email) continue
      const key = String(c.email).toLowerCase()
      if (!byEmail[key]) byEmail[key] = { cust: c, enr: e }
    }

    const msgs = await fetchInbox(token, sinceIso)
    let bodyFetches = 0
    const mb = { mailbox, scanned: msgs.length, bounced: 0, ooo: 0, replies: 0 }

    for (const m of msgs) {
      scanned++
      const sender = String(m.from?.emailAddress?.address || '').toLowerCase()
      const subject = String(m.subject || '').trim()
      const preview = String(m.bodyPreview || '').replace(/\s+/g, ' ')
      const received = m.receivedDateTime || nowIso

      const looksBounce = BOUNCE_SENDER_RE.test(sender) || BOUNCE_SUBJECT_RE.test(subject)

      // ---- Bounce / NDR: find the failed lead address and mark it inactive ----
      if (looksBounce) {
        let hay = (subject + ' ' + preview).toLowerCase()
        let matches = (hay.match(EMAIL_RE) || []).map(x => x.toLowerCase()).filter(x => byEmail[x])
        if (!matches.length && bodyFetches < MAX_BODY_FETCHES) {
          bodyFetches++
          const full = (await fetchBody(token, m.id)).toLowerCase()
          matches = (full.match(EMAIL_RE) || []).map(x => x.toLowerCase()).filter(x => byEmail[x])
        }
        const uniq = [...new Set(matches)]
        for (const addr of uniq) {
          const { cust, enr } = byEmail[addr]
          if (cust.is_active === false) { alreadyBounced++; continue } // already handled on a prior scan
          const note = `[Bounced ${today}] Email to ${addr} was undeliverable — marked inactive.`
          await sb.from('customers').update({
            is_active: false, is_dead_lead: true,
            notes: cust.notes ? `${cust.notes}\n${note}` : note,
            updated_at: nowIso,
          }).eq('id', cust.id)
          cust.is_active = false
          if (enr) await sb.from('sequence_enrollments').update({ status: 'stopped', stop_reason: 'bounced', updated_at: nowIso }).eq('id', enr.id)
          try { await sb.from('email_logs').insert({ from_email: addr, subject, body_snippet: preview.slice(0, 400), log_type: 'bounce', linked_id: cust.id, linked_label: 'Lead bounced · inactive', note: 'undeliverable', logged_at: received }) } catch { /* ignore */ }
          detBounced.push({ email: addr, company: cust.company_name || null, customer_id: cust.id })
          bounced++; mb.bounced++
        }
        continue
      }

      // From here we only care about messages sent by a known lead.
      const lead = byEmail[sender]
      if (!lead) continue

      // ---- Out-of-office / auto-reply: note it, keep sending ----
      if (OOO_SUBJECT_RE.test(subject)) {
        const stamp = `[Out of office ${received.slice(0, 16)}]`
        const existing = lead.cust.notes || ''
        if (!existing.includes(stamp)) {
          const note = `${stamp} ${preview.slice(0, 200)}`
          await sb.from('customers').update({ notes: existing ? `${existing}\n${note}` : note, updated_at: nowIso }).eq('id', lead.cust.id)
          lead.cust.notes = existing ? `${existing}\n${note}` : note
          try { await sb.from('email_logs').insert({ from_email: sender, subject, body_snippet: preview.slice(0, 400), log_type: 'auto_reply', linked_id: lead.cust.id, linked_label: 'Out of office', note: 'ooo', logged_at: received }) } catch { /* ignore */ }
          detOoo.push({ email: sender, company: lead.cust.company_name || null, customer_id: lead.cust.id })
          ooo++; mb.ooo++
        } else { alreadyOoo++ }
        continue
      }

      // ---- Genuine human reply: classify and act (only while still active) ----
      if (lead.enr && lead.enr.status !== 'active') continue
      const { intent, reason } = await classify(subject, preview)
      if (intent === 'auto_reply') continue // treat like OOO/bounce noise, keep going

      replies++; mb.replies++
      const custPatch: Record<string, unknown> = { last_reply_intent: intent, last_reply_at: nowIso, updated_at: nowIso, is_dead_lead: false }
      let enrStatus = 'replied'
      if (intent === 'interested' || intent === 'meeting' || intent === 'question') {
        enrStatus = 'interested'; interested++
        custPatch.auto_outreach_paused = true
        custPatch.customer_status = 'Interested'
        custPatch.pipeline_stage = intent === 'meeting' ? 'Meeting' : 'Engaged'
      } else if (intent === 'unsubscribe') {
        enrStatus = 'dnc'; unsub++
        custPatch.do_not_contact = true
        await sb.from('lead_list_members').delete().eq('customer_id', lead.cust.id)
      } else { declined++ }

      if (lead.enr) await sb.from('sequence_enrollments').update({ status: enrStatus, replied_at: nowIso, stop_reason: `${intent}: ${reason}`, updated_at: nowIso }).eq('id', lead.enr.id)
      await sb.from('customers').update(custPatch).eq('id', lead.cust.id)
      try { await sb.from('email_logs').insert({ from_email: sender, subject, body_snippet: preview.slice(0, 400), log_type: 'reply', linked_id: lead.cust.id, linked_label: `Lead reply · ${intent}`, note: reason, logged_at: received }) } catch { /* ignore */ }
      detReplies.push({ email: sender, company: lead.cust.company_name || null, customer_id: lead.cust.id, intent, reason })
    }
    perMailbox.push(mb)
  }

  const bMore = alreadyBounced ? ` (${alreadyBounced} already inactive from earlier)` : ''
  const oMore = alreadyOoo ? ` (${alreadyOoo} already noted)` : ''
  const message = `Scanned ${scanned} message(s) across ${mailboxes.length} mailbox(es) · ${bounced} new bounce${bounced === 1 ? '' : 's'} marked inactive${bMore}, ${ooo} new out-of-office noted${oMore}, ${replies} real repl${replies === 1 ? 'y' : 'ies'} (${interested} interested, ${unsub} unsubscribed).`

  // Record this run so it shows up in CRM → Inbox Scans.
  let runId: string | null = null
  try {
    const { data: run } = await sb.from('reply_scan_runs').insert({
      triggered_by: triggeredBy,
      mailboxes,
      scanned, bounced, ooo, replies, interested, unsubscribed: unsub, declined,
      already_bounced: alreadyBounced, already_ooo: alreadyOoo,
      details: { bounced: detBounced, ooo: detOoo, replies: detReplies, message },
    }).select('id').single()
    runId = (run as any)?.id ?? null
  } catch { /* ignore logging failures */ }

  return NextResponse.json({
    runId, scanned, bounced, ooo, replies, interested, unsubscribed: unsub, declined, alreadyBounced, alreadyOoo,
    mailboxes: perMailbox, message,
  })
}
