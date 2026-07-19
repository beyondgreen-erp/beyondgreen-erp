/**
 * POST /api/leads/sequence-blast
 * On-demand "send the next N unsent" for a single sequence.
 *
 * Unlike /sequence-run this DELIBERATELY bypasses the daily cap and the
 * send-day restriction — it's the endpoint behind the "Send next 250 unsent"
 * button, where the user is explicitly asking to dispatch a batch right now.
 * It sends directly via Graph (no review hold) and advances each enrollment.
 *
 * To stay under the serverless timeout it sends at most a bounded chunk per
 * call (see CHUNK_MAX); the caller loops until it has sent the total it wants.
 *
 * Body: { sequence_id: string, limit?: number }
 * Returns: { sent, remaining, errors, message }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { getOutlookAccessToken, sendViaGraph } from '@/lib/outlook'
import { composeHtml } from '../sequence-run/route'

export const maxDuration = 60

// Hard ceiling per request so a single call can't run past the timeout mid-batch.
const CHUNK_MAX = 60

/** Render {{merge}} tags for a specific customer. Mirrors sequence-run. */
function render(t: string, c: any, fromName: string): string {
  const first = (c.contact_name || '').trim().split(/\s+/)[0] || 'there'
  return (t || '')
    .replace(/\{\{\s*company\s*\}\}/gi, c.company_name || 'your team')
    .replace(/\{\{\s*customer\s*\}\}/gi, c.company_name || 'your team')
    .replace(/\{\{\s*contact\s*\}\}/gi, c.contact_name || 'there')
    .replace(/\{\{\s*first_name\s*\}\}/gi, first)
    .replace(/\{\{\s*city\s*\}\}/gi, c.city || '')
    .replace(/\{\{\s*state\s*\}\}/gi, c.state || '')
    .replace(/\{\{\s*industry\s*\}\}/gi, c.industry || 'your industry')
    .replace(/\{\{\s*website\s*\}\}/gi, c.website || '')
    .replace(/\{\{\s*my_name\s*\}\}/gi, fromName || '')
    .replace(/\{\{\s*customer_id\s*\}\}/gi, c.id || '')
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const sequenceId: string = body.sequence_id
  const wantN = parseInt(String(body.limit ?? 50), 10)
  const limit = Math.min(Math.max(Number.isFinite(wantN) ? wantN : 50, 1), CHUNK_MAX)
  if (!sequenceId) return NextResponse.json({ error: 'sequence_id required' }, { status: 400 })

  const sb = createSupabaseAdminClient()
  const nowIso = new Date().toISOString()

  const { data: seq } = await sb.from('sequences').select('*').eq('id', sequenceId).maybeSingle()
  if (!seq) return NextResponse.json({ error: 'sequence not found' }, { status: 404 })
  if (!seq.from_email) return NextResponse.json({ error: 'sequence has no from_email set' }, { status: 400 })

  // Never send from a mailbox flagged protected (e.g. the primary business inbox).
  const { data: mb } = await sb.from('user_email_connections')
    .select('is_protected').eq('provider', 'microsoft').ilike('email', seq.from_email).limit(1).maybeSingle()
  if (mb?.is_protected) return NextResponse.json({ error: `mailbox ${seq.from_email} is protected — cold outreach blocked` }, { status: 400 })

  const token = await getOutlookAccessToken(seq.from_email)
  if (!token) return NextResponse.json({ error: `mailbox ${seq.from_email} not connected` }, { status: 400 })

  const { data: steps } = await sb.from('sequence_steps').select('*').eq('sequence_id', seq.id).order('step_number')
  if (!steps || !steps.length) return NextResponse.json({ error: 'sequence has no steps' }, { status: 400 })

  const { data: sigRow } = await sb.from('user_email_signatures').select('signature_html').ilike('user_email', seq.from_email).maybeSingle()
  const sigHtml = sigRow?.signature_html || ''

  // Next due enrollments (unsent / due for their current step).
  const { data: due } = await sb.from('sequence_enrollments')
    .select('*').eq('sequence_id', seq.id).eq('status', 'active').lte('next_send_at', nowIso)
    .order('next_send_at').limit(limit)
  const dueRows = (due as any[]) || []
  if (!dueRows.length) return NextResponse.json({ sent: 0, remaining: 0, message: 'Nothing due to send.' })

  const custIds = dueRows.map(d => d.customer_id)
  const { data: custs } = await sb.from('customers')
    .select('id,email,company_name,contact_name,city,state,industry,website,do_not_contact,auto_outreach_paused')
    .in('id', custIds)
  const byId: Record<string, any> = {}; (custs || []).forEach((c: any) => { byId[c.id] = c })

  let sent = 0
  const errors: string[] = []

  for (const enr of dueRows) {
    const c = byId[enr.customer_id]
    if (!c || c.do_not_contact || c.auto_outreach_paused) {
      await sb.from('sequence_enrollments').update({ status: c?.do_not_contact ? 'dnc' : 'stopped', updated_at: nowIso }).eq('id', enr.id)
      continue
    }
    if (!c.email) { await sb.from('sequence_enrollments').update({ status: 'stopped', stop_reason: 'no email', updated_at: nowIso }).eq('id', enr.id); continue }

    const step = steps[enr.current_step]
    if (!step) { await sb.from('sequence_enrollments').update({ status: 'finished', updated_at: nowIso }).eq('id', enr.id); continue }

    const subject = render(step.subject || '', c, seq.from_name)
    const bodyText = render(step.body || '', c, seq.from_name)
    const html = composeHtml(bodyText, sigHtml)

    const ins = await sb.from('sequence_sends').insert({
      enrollment_id: enr.id, sequence_id: seq.id, customer_id: c.id,
      step_number: enr.current_step + 1, to_email: c.email, subject, body: bodyText, status: 'queued',
    }).select('id').single()

    try {
      await sendViaGraph(token, { to: c.email, subject, html })
      await sb.from('sequence_sends').update({ status: 'sent', sent_at: nowIso }).eq('id', (ins.data as any)?.id)
      try {
        await sb.from('customer_outreach').insert({
          customer_id: c.id, subject, body: bodyText, to_email: c.email, delivered_via: 'sequence',
          status: 'sent', sent_by: seq.from_email, sent_at: nowIso, sequence_active: true, sequence_step: enr.current_step + 1,
        })
      } catch { /* ignore */ }
      try { await sb.from('customers').update({ contacted_at: nowIso, pipeline_stage: 'Contacted' }).eq('id', c.id) } catch { /* ignore */ }

      const nextStep = steps[enr.current_step + 1]
      if (nextStep) {
        const next = new Date(Date.now() + (nextStep.delay_days || 1) * 86400000).toISOString()
        await sb.from('sequence_enrollments').update({ current_step: enr.current_step + 1, last_step_sent_at: nowIso, next_send_at: next, updated_at: nowIso }).eq('id', enr.id)
      } else {
        await sb.from('sequence_enrollments').update({ current_step: enr.current_step + 1, last_step_sent_at: nowIso, status: 'finished', updated_at: nowIso }).eq('id', enr.id)
        try { await sb.from('customers').update({ is_dead_lead: true, pipeline_stage: 'Dead' }).eq('id', c.id) } catch { /* ignore */ }
      }
      sent++
    } catch (err) {
      await sb.from('sequence_sends').update({ status: 'failed', error: (err as Error).message }).eq('id', (ins.data as any)?.id)
      errors.push(`${c.email}: ${(err as Error).message}`)
    }
  }

  const { count: remaining } = await sb.from('sequence_enrollments')
    .select('id', { count: 'exact', head: true }).eq('sequence_id', seq.id).eq('status', 'active').lte('next_send_at', nowIso)

  return NextResponse.json({ sent, remaining: remaining || 0, errors, message: `Sent ${sent} email(s).` })
}
