/**
 * POST /api/leads/sequence-approve
 * Approves one or more pending sequence_sends (status='review') and dispatches them via Graph.
 * Advances the enrollment step counter and schedules the next step.
 *
 * Body: { send_ids: string[] }  — the sequence_sends rows to release.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { getOutlookAccessToken, sendViaGraph } from '@/lib/outlook'
import { composeHtml } from '../sequence-run/route'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body.send_ids) ? body.send_ids : []
  if (!ids.length) return NextResponse.json({ error: 'no send_ids provided' }, { status: 400 })

  const sb = createSupabaseAdminClient()
  const nowIso = new Date().toISOString()

  const { data: rows } = await sb.from('sequence_sends').select('*').in('id', ids).eq('status', 'review')
  if (!rows || !rows.length) return NextResponse.json({ sent: 0, message: 'Nothing to approve — those sends may have already been actioned.' })

  // Cache sequences, enrollments, signatures, tokens across the batch so we don't re-fetch per row.
  const seqIds = [...new Set(rows.map((r: any) => r.sequence_id))]
  const enrIds = [...new Set(rows.map((r: any) => r.enrollment_id))]
  const [{ data: seqs }, { data: enrs }, { data: sigs }] = await Promise.all([
    sb.from('sequences').select('id,name,from_email,from_name').in('id', seqIds),
    sb.from('sequence_enrollments').select('*').in('id', enrIds),
    sb.from('user_email_signatures').select('user_email,signature_html'),
  ])
  const seqBy: Record<string, any> = {}; (seqs || []).forEach((s: any) => { seqBy[s.id] = s })
  const enrBy: Record<string, any> = {}; (enrs || []).forEach((e: any) => { enrBy[e.id] = e })
  const sigBy: Record<string, string> = {}; (sigs || []).forEach((s: any) => { sigBy[String(s.user_email).toLowerCase()] = s.signature_html || '' })

  // Get step counts (needed to know if there's a next step to schedule)
  const { data: steps } = await sb.from('sequence_steps').select('sequence_id,step_number,delay_days').in('sequence_id', seqIds).order('step_number')
  const stepsBySeq: Record<string, any[]> = {}
  ;(steps || []).forEach((s: any) => { (stepsBySeq[s.sequence_id] ||= []).push(s) })

  // Cache Graph tokens per mailbox
  const tokenBy: Record<string, string | null> = {}
  async function getToken(from: string) {
    if (tokenBy[from] !== undefined) return tokenBy[from]
    tokenBy[from] = await getOutlookAccessToken(from)
    return tokenBy[from]
  }

  let sent = 0
  const errors: string[] = []

  for (const row of rows) {
    const seq = seqBy[row.sequence_id]
    const enr = enrBy[row.enrollment_id]
    if (!seq || !enr) { errors.push(`send ${row.id}: missing seq/enr`); continue }
    if (!seq.from_email) { errors.push(`send ${row.id}: sequence has no from_email`); continue }

    const token = await getToken(seq.from_email)
    if (!token) { errors.push(`send ${row.id}: mailbox ${seq.from_email} not connected`); continue }

    const html = composeHtml(row.body || '', sigBy[String(seq.from_email).toLowerCase()] || '')
    try {
      await sendViaGraph(token, { to: row.to_email, subject: row.subject, html })
      await sb.from('sequence_sends').update({ status: 'sent', sent_at: nowIso }).eq('id', row.id)

      // Log to customer_outreach for the customer timeline
      try {
        await sb.from('customer_outreach').insert({
          customer_id: row.customer_id, subject: row.subject, body: row.body,
          to_email: row.to_email, delivered_via: 'sequence', status: 'sent',
          sent_by: seq.from_email, sent_at: nowIso, sequence_active: true, sequence_step: row.step_number,
        })
      } catch { /* ignore */ }
      try { await sb.from('customers').update({ contacted_at: nowIso, pipeline_stage: 'Contacted' }).eq('id', row.customer_id) } catch { /* ignore */ }

      // Advance the enrollment counter and schedule the next step
      const stepList = stepsBySeq[row.sequence_id] || []
      const nextIdx = enr.current_step + 1 // row.step_number == enr.current_step + 1
      const nextStep = stepList[nextIdx]
      if (nextStep) {
        const next = new Date(Date.now() + (nextStep.delay_days || 1) * 86400000).toISOString()
        await sb.from('sequence_enrollments').update({ current_step: nextIdx, last_step_sent_at: nowIso, next_send_at: next, updated_at: nowIso }).eq('id', enr.id)
      } else {
        await sb.from('sequence_enrollments').update({ current_step: nextIdx, last_step_sent_at: nowIso, status: 'finished', updated_at: nowIso }).eq('id', enr.id)
        try { await sb.from('customers').update({ is_dead_lead: true, pipeline_stage: 'Dead' }).eq('id', row.customer_id) } catch { /* ignore */ }
      }
      enr.current_step = nextIdx // in-memory update in case another send for same enrollment is later in the batch
      sent++
    } catch (err) {
      const msg = (err as Error).message || 'send failed'
      await sb.from('sequence_sends').update({ status: 'failed', error: msg }).eq('id', row.id)
      errors.push(`send ${row.id}: ${msg}`)
    }
  }

  return NextResponse.json({ sent, errors, message: `Sent ${sent} email(s).` })
}
