/**
 * POST /api/leads/sequence-blast
 * On-demand "queue the next N unsent into the Review queue" for one sequence.
 *
 * This does NOT send. It renders the next N due enrollments and drops them into
 * the review queue (sequence_sends.status='review') so Rudy can preview and
 * release them from /sales/sequences/review. It deliberately bypasses the daily
 * cap (that's the whole point of the "Send next 250 to review" button) and does
 * not advance the enrollment — approval in the review UI advances the step.
 *
 * Body: { sequence_id: string, limit?: number }
 * Returns: { queued, remaining, skipped, message }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

export const maxDuration = 60

// Queuing is just DB work (no email send), so we can safely do a big batch per call.
const MAX_PER_CALL = 300

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
  const wantN = parseInt(String(body.limit ?? 250), 10)
  const limit = Math.min(Math.max(Number.isFinite(wantN) ? wantN : 250, 1), MAX_PER_CALL)
  if (!sequenceId) return NextResponse.json({ error: 'sequence_id required' }, { status: 400 })

  const sb = createSupabaseAdminClient()
  const nowIso = new Date().toISOString()

  const { data: seq } = await sb.from('sequences').select('*').eq('id', sequenceId).maybeSingle()
  if (!seq) return NextResponse.json({ error: 'sequence not found' }, { status: 404 })

  const { data: steps } = await sb.from('sequence_steps').select('*').eq('sequence_id', seq.id).order('step_number')
  if (!steps || !steps.length) return NextResponse.json({ error: 'sequence has no steps' }, { status: 400 })

  // Don't double-queue enrollments already waiting in review.
  const { data: pend } = await sb.from('sequence_sends').select('enrollment_id').eq('sequence_id', seq.id).eq('status', 'review')
  const alreadyPending = new Set(((pend as any[]) || []).map(x => x.enrollment_id))

  // Pull more than we need so we can skip pending/suppressed and still fill the batch.
  const { data: due } = await sb.from('sequence_enrollments')
    .select('*').eq('sequence_id', seq.id).eq('status', 'active').lte('next_send_at', nowIso)
    .order('next_send_at').limit(limit * 2 + 50)
  const candidates = ((due as any[]) || []).filter(d => !alreadyPending.has(d.id)).slice(0, limit)
  if (!candidates.length) return NextResponse.json({ queued: 0, remaining: 0, skipped: 0, message: 'Nothing new to queue.' })

  const custIds = candidates.map(d => d.customer_id)
  const { data: custs } = await sb.from('customers')
    .select('id,email,company_name,contact_name,city,state,industry,website,do_not_contact,auto_outreach_paused,is_active')
    .in('id', custIds)
  const byId: Record<string, any> = {}; (custs || []).forEach((c: any) => { byId[c.id] = c })

  const rowsToInsert: any[] = []
  let skipped = 0

  for (const enr of candidates) {
    const c = byId[enr.customer_id]
    if (!c || c.do_not_contact || c.auto_outreach_paused || c.is_active === false) {
      await sb.from('sequence_enrollments').update({ status: c?.do_not_contact ? 'dnc' : 'stopped', updated_at: nowIso }).eq('id', enr.id)
      skipped++; continue
    }
    if (!c.email) { await sb.from('sequence_enrollments').update({ status: 'stopped', stop_reason: 'no email', updated_at: nowIso }).eq('id', enr.id); skipped++; continue }
    const step = steps[enr.current_step]
    if (!step) { await sb.from('sequence_enrollments').update({ status: 'finished', updated_at: nowIso }).eq('id', enr.id); skipped++; continue }

    rowsToInsert.push({
      enrollment_id: enr.id, sequence_id: seq.id, customer_id: c.id,
      step_number: enr.current_step + 1, to_email: c.email,
      subject: render(step.subject || '', c, seq.from_name),
      body: render(step.body || '', c, seq.from_name),
      status: 'review',
    })
  }

  let queued = 0
  if (rowsToInsert.length) {
    const { error } = await sb.from('sequence_sends').insert(rowsToInsert)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    queued = rowsToInsert.length
  }

  // How many due enrollments still aren't queued (so the UI can say "more available").
  const { data: pend2 } = await sb.from('sequence_sends').select('enrollment_id').eq('sequence_id', seq.id).eq('status', 'review')
  const pendingSet = new Set(((pend2 as any[]) || []).map(x => x.enrollment_id))
  const { data: dueAll } = await sb.from('sequence_enrollments')
    .select('id').eq('sequence_id', seq.id).eq('status', 'active').lte('next_send_at', nowIso).limit(2000)
  const remaining = ((dueAll as any[]) || []).filter(d => !pendingSet.has(d.id)).length

  return NextResponse.json({
    queued, remaining, skipped,
    message: `Queued ${queued} email(s) to the review queue.`,
  })
}
