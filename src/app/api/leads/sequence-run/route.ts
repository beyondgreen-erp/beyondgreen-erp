import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { getOutlookAccessToken, sendViaGraph } from '@/lib/outlook'

export const maxDuration = 60

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Render {{merge}} tags for a specific customer.  */
function render(t: string, c: any, fromName: string): string {
  const first = (c.contact_name || '').trim().split(/\s+/)[0] || 'there'
  return (t || '')
    .replace(/\{\{\s*company\s*\}\}/gi, c.company_name || 'your team')
    .replace(/\{\{\s*contact\s*\}\}/gi, c.contact_name || 'there')
    .replace(/\{\{\s*first_name\s*\}\}/gi, first)
    .replace(/\{\{\s*city\s*\}\}/gi, c.city || '')
    .replace(/\{\{\s*state\s*\}\}/gi, c.state || '')
    .replace(/\{\{\s*industry\s*\}\}/gi, c.industry || 'your industry')
    .replace(/\{\{\s*website\s*\}\}/gi, c.website || '')
    .replace(/\{\{\s*my_name\s*\}\}/gi, fromName || '')
}

/**
 * Wraps the body text in a branded HTML shell with beyondGREEN header + footer,
 * and appends the sender's global signature. The bodyText is user-authored plain
 * text with newlines; we escape it, then split on blank lines into paragraphs.
 * signatureHtml comes from user_email_signatures and is trusted HTML.
 */
export function composeHtml(bodyText: string, signatureHtml: string): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  // Split the plain-text body on blank lines → paragraphs; single \n inside a
  // paragraph becomes <br>. Also auto-link https:// URLs so they're clickable.
  const linkify = (s: string) => s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#00A84F;text-decoration:underline;">$1</a>')
  const paragraphs = (bodyText || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  const bodyHtml = paragraphs.map(p => `<p style="margin:0 0 14px;line-height:1.55;color:#1A1D2E;font-size:15px;">${linkify(escape(p)).replace(/\n/g, '<br>')}</p>`).join('')

  const sig = signatureHtml
    ? `<div style="margin-top:22px;padding-top:14px;border-top:1px solid #E4E6EE;">${signatureHtml}</div>`
    : ''

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#F5F7FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F7FA;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,0.05);">
      <tr>
        <td style="background:linear-gradient(135deg,#00A84F 0%,#037f4c 100%);padding:24px 28px;">
          <table role="presentation" width="100%"><tr>
            <td>
              <img src="https://beyondgreenbiotech.com/cdn/shop/files/beyondgreenlogo.png" alt="beyondGREEN" style="height:44px;display:block;filter:brightness(0) invert(1);" />
            </td>
            <td align="right" style="color:#FFFFFF;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">
              Made in USA · Certified Compostable
            </td>
          </tr></table>
        </td>
      </tr>
      <tr><td style="padding:32px 32px 24px;">
        ${bodyHtml}
        ${sig}
      </td></tr>
      <tr>
        <td style="background:#0F1C2E;padding:18px 28px;color:#B8C3D2;font-size:11px;line-height:1.5;">
          <table role="presentation" width="100%"><tr>
            <td>
              <div style="color:#00E68C;font-weight:bold;font-size:12px;margin-bottom:4px;">beyondGREEN biotech</div>
              1202 E. Wakeham Ave., Santa Ana, CA 92705 · (866) 364-9466
            </td>
            <td align="right">
              <a href="https://beyondgreenbiotech.com" style="color:#00E68C;text-decoration:none;font-weight:600;">beyondgreenbiotech.com</a>
            </td>
          </tr></table>
        </td>
      </tr>
    </table>
    <p style="color:#8A9FC0;font-size:10px;text-align:center;margin:12px 0 0;font-family:Arial,sans-serif;">You received this email because we thought beyondGREEN could be a fit for your organization. Not interested? Reply "unsubscribe" and we'll stop.</p>
  </td></tr>
</table>
</body></html>`
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const need = process.env.REPLY_SCAN_KEY
  if (need && url.searchParams.get('key') !== need) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const onlySeq = url.searchParams.get('sequence_id') // optional: run one sequence now

  const sb = createSupabaseAdminClient()
  const today = DOW[new Date().getDay()]
  const nowIso = new Date().toISOString()

  let seqQ = sb.from('sequences').select('*').eq('status', 'active')
  if (onlySeq) seqQ = seqQ.eq('id', onlySeq)
  const { data: seqs } = await seqQ
  if (!seqs || !seqs.length) return NextResponse.json({ sent: 0, queued: 0, message: 'No active sequences.' })

  // Preload signatures for the mailboxes involved (one lookup per unique from_email)
  const fromEmails = [...new Set(seqs.map((s: any) => s.from_email).filter(Boolean))] as string[]
  const sigMap: Record<string, string> = {}
  if (fromEmails.length) {
    const { data: sigRows } = await sb.from('user_email_signatures').select('user_email,signature_html').in('user_email', fromEmails)
    ;(sigRows || []).forEach((r: any) => { sigMap[String(r.user_email).toLowerCase()] = r.signature_html || '' })
  }
  const sigFor = (email: string | null) => (email && sigMap[email.toLowerCase()]) || ''

  const results: any[] = []
  let totalSent = 0
  let totalQueued = 0

  for (const seq of seqs) {
    const sendDays: string[] = seq.send_days || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
    if (!onlySeq && !sendDays.includes(today)) { results.push({ sequence: seq.name, skipped: `not a send day (${today})` }); continue }
    if (!seq.from_email) { results.push({ sequence: seq.name, skipped: 'no from_email set' }); continue }

    const requireReview: boolean = !!seq.review_before_send

    // Hard guard: never let a sequence send from a mailbox flagged as protected
    // (e.g. the primary business inbox). This backstops the UI even if a sequence
    // was created another way. Flip is_protected in Settings → Email to override.
    const { data: mb } = await sb.from('user_email_connections')
      .select('is_protected').eq('provider', 'microsoft').ilike('email', seq.from_email).limit(1).maybeSingle()
    if (mb?.is_protected) { results.push({ sequence: seq.name, skipped: `mailbox ${seq.from_email} is protected — cold outreach blocked` }); continue }

    // If review-before-send is on, we don't need a Graph token to queue up previews.
    // (We only need it when we actually approve+dispatch later.)
    let token: string | null = null
    if (!requireReview) {
      token = await getOutlookAccessToken(seq.from_email)
      if (!token) { results.push({ sequence: seq.name, skipped: `mailbox ${seq.from_email} not connected` }); continue }
    }

    const { data: steps } = await sb.from('sequence_steps').select('*').eq('sequence_id', seq.id).order('step_number')
    if (!steps || !steps.length) { results.push({ sequence: seq.name, skipped: 'no steps' }); continue }

    // How many already sent today for this sequence (respect the daily cap)
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
    const { count: sentToday } = await sb.from('sequence_sends').select('id', { count: 'exact', head: true }).eq('sequence_id', seq.id).eq('status', 'sent').gte('sent_at', startOfDay.toISOString())
    let budget = Math.max(0, (seq.daily_cap || 40) - (sentToday || 0))
    if (budget === 0) { results.push({ sequence: seq.name, skipped: 'daily cap reached' }); continue }

    // In review mode, don't create duplicate pending sends. Count what's already waiting
    // in the queue for this sequence and skip the same enrollments.
    let alreadyPending = new Set<string>()
    if (requireReview) {
      const { data: pend } = await sb.from('sequence_sends').select('enrollment_id').eq('sequence_id', seq.id).eq('status', 'review')
      alreadyPending = new Set(((pend as any[]) || []).map(x => x.enrollment_id))
    }

    const { data: due } = await sb.from('sequence_enrollments')
      .select('*').eq('sequence_id', seq.id).eq('status', 'active').lte('next_send_at', nowIso)
      .order('next_send_at').limit(budget * 2)
    const dueRows = (due || []).filter((d: any) => !alreadyPending.has(d.id)).slice(0, budget)
    if (!dueRows.length) { results.push({ sequence: seq.name, sent: 0, queued: 0, note: 'nothing due' }); continue }

    const custIds = dueRows.map((d: any) => d.customer_id)
    const { data: custs } = await sb.from('customers').select('id,email,company_name,contact_name,city,state,industry,website,do_not_contact,auto_outreach_paused').in('id', custIds)
    const byId: Record<string, any> = {}; (custs || []).forEach((c: any) => { byId[c.id] = c })

    let sent = 0
    let queued = 0
    for (const enr of dueRows) {
      if (budget <= 0) break
      const c = byId[enr.customer_id]
      // Never email suppressed leads — close out the enrollment instead.
      if (!c || c.do_not_contact || c.auto_outreach_paused) {
        await sb.from('sequence_enrollments').update({ status: c?.do_not_contact ? 'dnc' : 'stopped', updated_at: nowIso }).eq('id', enr.id)
        continue
      }
      if (!c.email) { await sb.from('sequence_enrollments').update({ status: 'stopped', stop_reason: 'no email', updated_at: nowIso }).eq('id', enr.id); continue }

      const step = steps[enr.current_step]
      if (!step) { await sb.from('sequence_enrollments').update({ status: 'finished', updated_at: nowIso }).eq('id', enr.id); continue }

      const subject = render(step.subject || '', c, seq.from_name)
      const bodyText = render(step.body || '', c, seq.from_name)
      const html = composeHtml(bodyText, sigFor(seq.from_email))

      if (requireReview) {
        // Queue in the review inbox and hold the enrollment step where it is.
        // Approval in the review UI dispatches + advances the step counter.
        const { error } = await sb.from('sequence_sends').insert({
          enrollment_id: enr.id, sequence_id: seq.id, customer_id: c.id,
          step_number: enr.current_step + 1, to_email: c.email,
          subject, body: bodyText, status: 'review',
        })
        if (!error) queued++
        continue
      }

      // Auto-send path (unchanged behavior)
      const send = await sb.from('sequence_sends').insert({ enrollment_id: enr.id, sequence_id: seq.id, customer_id: c.id, step_number: enr.current_step + 1, to_email: c.email, subject, body: bodyText, status: 'queued' }).select('id').single()
      try {
        await sendViaGraph(token!, { to: c.email, subject, html })
        await sb.from('sequence_sends').update({ status: 'sent', sent_at: nowIso }).eq('id', (send.data as any)?.id)
        try { await sb.from('customer_outreach').insert({ customer_id: c.id, subject, body: bodyText, to_email: c.email, delivered_via: 'sequence', status: 'sent', sent_by: seq.from_email, sent_at: nowIso, sequence_active: true, sequence_step: enr.current_step + 1 }) } catch { /* ignore */ }
        try { await sb.from('customers').update({ contacted_at: nowIso, pipeline_stage: 'Contacted' }).eq('id', c.id) } catch { /* ignore */ }

        const nextStep = steps[enr.current_step + 1]
        if (nextStep) {
          const next = new Date(Date.now() + (nextStep.delay_days || 1) * 86400000).toISOString()
          await sb.from('sequence_enrollments').update({ current_step: enr.current_step + 1, last_step_sent_at: nowIso, next_send_at: next, updated_at: nowIso }).eq('id', enr.id)
        } else {
          await sb.from('sequence_enrollments').update({ current_step: enr.current_step + 1, last_step_sent_at: nowIso, status: 'finished', updated_at: nowIso }).eq('id', enr.id)
          try { await sb.from('customers').update({ is_dead_lead: true, pipeline_stage: 'Dead' }).eq('id', c.id) } catch { /* ignore */ }
        }
        sent++; budget--; totalSent++
      } catch (err) {
        await sb.from('sequence_sends').update({ status: 'failed', error: (err as Error).message }).eq('id', (send.data as any)?.id)
      }
    }
    totalQueued += queued
    results.push({ sequence: seq.name, sent, queued, review: requireReview })
  }

  return NextResponse.json({
    sent: totalSent, queued: totalQueued, day: today, results,
    message: totalQueued > 0
      ? `Queued ${totalQueued} email(s) for review${totalSent ? `, sent ${totalSent} auto-approved` : ''}.`
      : `Sent ${totalSent} email(s).`
  })
}
