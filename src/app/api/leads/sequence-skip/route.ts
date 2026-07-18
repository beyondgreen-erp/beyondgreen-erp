/**
 * POST /api/leads/sequence-skip
 * Skips one or more pending sequence_sends (status='review') without sending them,
 * and advances the enrollment step counter so the sequence keeps moving.
 * Body: { send_ids: string[] }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body.send_ids) ? body.send_ids : []
  if (!ids.length) return NextResponse.json({ error: 'no send_ids provided' }, { status: 400 })

  const sb = createSupabaseAdminClient()
  const nowIso = new Date().toISOString()

  const { data: rows } = await sb.from('sequence_sends').select('id,enrollment_id,sequence_id,step_number').in('id', ids).eq('status', 'review')
  if (!rows || !rows.length) return NextResponse.json({ skipped: 0 })

  const enrIds = [...new Set(rows.map((r: any) => r.enrollment_id))]
  const seqIds = [...new Set(rows.map((r: any) => r.sequence_id))]
  const [{ data: enrs }, { data: steps }] = await Promise.all([
    sb.from('sequence_enrollments').select('*').in('id', enrIds),
    sb.from('sequence_steps').select('sequence_id,step_number,delay_days').in('sequence_id', seqIds).order('step_number'),
  ])
  const enrBy: Record<string, any> = {}; (enrs || []).forEach((e: any) => { enrBy[e.id] = e })
  const stepsBySeq: Record<string, any[]> = {}
  ;(steps || []).forEach((s: any) => { (stepsBySeq[s.sequence_id] ||= []).push(s) })

  await sb.from('sequence_sends').update({ status: 'skipped' }).in('id', ids)

  for (const r of rows) {
    const enr = enrBy[r.enrollment_id]
    if (!enr) continue
    const stepList = stepsBySeq[r.sequence_id] || []
    const nextIdx = enr.current_step + 1
    const nextStep = stepList[nextIdx]
    if (nextStep) {
      const next = new Date(Date.now() + (nextStep.delay_days || 1) * 86400000).toISOString()
      await sb.from('sequence_enrollments').update({ current_step: nextIdx, next_send_at: next, updated_at: nowIso }).eq('id', enr.id)
    } else {
      await sb.from('sequence_enrollments').update({ current_step: nextIdx, status: 'finished', updated_at: nowIso }).eq('id', enr.id)
    }
    enr.current_step = nextIdx
  }
  return NextResponse.json({ skipped: rows.length })
}
