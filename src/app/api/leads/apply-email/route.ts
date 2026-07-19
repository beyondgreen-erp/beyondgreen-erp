/**
 * POST /api/leads/apply-email  { customer_id, email }
 * Applies a corrected email to a previously-bounced lead:
 *   - saves the new email, sets the lead active again, clears the dead flag,
 *   - notes the fix on the lead,
 *   - re-activates its bounced sequence enrollment (back to step 0, due now)
 *     so the corrected address gets emailed in the next batch.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

export const maxDuration = 30
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i

export async function POST(req: NextRequest) {
  const { customer_id, email } = await req.json().catch(() => ({}))
  if (!customer_id) return NextResponse.json({ error: 'customer_id required' }, { status: 400 })
  const clean = String(email || '').trim().toLowerCase()
  if (!EMAIL_RE.test(clean)) return NextResponse.json({ error: 'valid email required' }, { status: 400 })

  const sb = createSupabaseAdminClient()
  const nowIso = new Date().toISOString()
  const today = nowIso.slice(0, 10)

  const { data: lead } = await sb.from('customers').select('id, email, notes').eq('id', customer_id).maybeSingle()
  if (!lead) return NextResponse.json({ error: 'lead not found' }, { status: 404 })

  const note = `[Email fixed ${today}] ${lead.email || '(none)'} → ${clean}; reactivated & re-enrolled.`
  const { error: cErr } = await sb.from('customers').update({
    email: clean, is_active: true, is_dead_lead: false,
    notes: lead.notes ? `${lead.notes}\n${note}` : note,
    updated_at: nowIso,
  }).eq('id', customer_id)
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })

  // Re-activate the bounced enrollment (prefer the one stopped for 'bounced').
  let reenrolled = false
  const { data: enrs } = await sb.from('sequence_enrollments')
    .select('id, status, stop_reason, updated_at')
    .eq('customer_id', customer_id).order('updated_at', { ascending: false })
  const list = (enrs as any[]) || []
  const target = list.find(e => e.status === 'stopped' && e.stop_reason === 'bounced') || list.find(e => e.status !== 'active') || null
  if (target) {
    const { error: eErr } = await sb.from('sequence_enrollments').update({
      status: 'active', current_step: 0, next_send_at: nowIso, stop_reason: null, updated_at: nowIso,
    }).eq('id', target.id)
    if (!eErr) reenrolled = true
  }

  return NextResponse.json({
    ok: true, email: clean, reenrolled,
    message: reenrolled ? `Saved ${clean}, reactivated the lead, and re-enrolled it in the sequence.` : `Saved ${clean} and reactivated the lead (no prior enrollment to resume).`,
  })
}
