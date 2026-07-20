/**
 * POST /api/leads/sequence-unpause-lead
 * Unpauses one or more leads: sets customers.auto_outreach_paused=FALSE,
 * resumes any enrollments that were paused by the "Lead paused" action.
 * Body: { customer_ids: string[] }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const customerIds: string[] = Array.isArray(body.customer_ids) ? body.customer_ids : []
  if (!customerIds.length) return NextResponse.json({ error: 'no customer_ids provided' }, { status: 400 })

  const sb = createSupabaseAdminClient()
  const nowIso = new Date().toISOString()

  // 1. Unpause customers (keep last_reply_intent for audit history)
  const { data: unpausedCust } = await sb.from('customers')
    .update({ auto_outreach_paused: false })
    .in('id', customerIds)
    .select('id')

  // 2. Find enrollments that were paused by "Lead paused: ..."
  const { data: enrsToResume } = await sb.from('sequence_enrollments')
    .select('id')
    .in('customer_id', customerIds)
    .eq('status', 'paused')
    .like('stop_reason', 'Lead paused%')
  const resumeIds = (enrsToResume || []).map((e: any) => e.id)

  if (resumeIds.length) {
    await sb.from('sequence_enrollments')
      .update({ status: 'active', stop_reason: null, next_send_at: nowIso, updated_at: nowIso })
      .in('id', resumeIds)
  }

  return NextResponse.json({
    unpaused_leads: (unpausedCust || []).length,
    resumed_enrollments: resumeIds.length,
  })
}
