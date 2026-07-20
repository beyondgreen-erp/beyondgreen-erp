/**
 * POST /api/leads/sequence-pause-lead
 * Pauses one or more leads: sets customers.auto_outreach_paused=TRUE,
 * pauses all their active enrollments, cancels all their review-queue sends.
 * Body: { customer_ids: string[], reason?: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const customerIds: string[] = Array.isArray(body.customer_ids) ? body.customer_ids : []
  const reason: string = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : ''
  if (!customerIds.length) return NextResponse.json({ error: 'no customer_ids provided' }, { status: 400 })

  const sb = createSupabaseAdminClient()
  const nowIso = new Date().toISOString()

  // 1. Mark customers paused
  const { data: pausedCust } = await sb.from('customers')
    .update({ auto_outreach_paused: true, last_reply_intent: reason || 'paused_manual', last_reply_at: nowIso })
    .in('id', customerIds)
    .select('id')

  // 2. Pause active enrollments
  const { data: pausedEnr } = await sb.from('sequence_enrollments')
    .update({ status: 'paused', stop_reason: 'Lead paused: ' + (reason || 'manual'), updated_at: nowIso })
    .in('customer_id', customerIds)
    .eq('status', 'active')
    .select('id')

  // 3. Cancel review-queue sends
  const { data: reviewSends } = await sb.from('sequence_sends')
    .select('id')
    .in('customer_id', customerIds)
    .eq('status', 'review')
  const reviewIds = (reviewSends || []).map((r: any) => r.id)
  if (reviewIds.length) {
    await sb.from('sequence_sends').update({ status: 'skipped' }).in('id', reviewIds)
  }

  return NextResponse.json({
    paused_leads: (pausedCust || []).length,
    paused_enrollments: (pausedEnr || []).length,
    cancelled_sends: reviewIds.length,
  })
}
