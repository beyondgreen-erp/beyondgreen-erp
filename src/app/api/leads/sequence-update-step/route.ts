/**
 * POST /api/leads/sequence-update-step
 * Updates one sequence step's subject/body template, and (optionally) re-renders
 * every pending review send for that same step so the whole batch reflects the fix.
 *
 * Body:
 *   { step_id: string, subject: string, body: string, apply_to_pending?: boolean }
 * Response: { updated_pending: number }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

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

// Also need to include customer id column in the fetch below

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const stepId: string = body.step_id
  const subject: string = String(body.subject ?? '')
  const bodyText: string = String(body.body ?? '')
  const apply: boolean = body.apply_to_pending !== false // default true
  if (!stepId) return NextResponse.json({ error: 'step_id required' }, { status: 400 })

  const sb = createSupabaseAdminClient()

  const { data: step } = await sb.from('sequence_steps').select('*').eq('id', stepId).maybeSingle()
  if (!step) return NextResponse.json({ error: 'step not found' }, { status: 404 })

  await sb.from('sequence_steps').update({ subject, body: bodyText, updated_at: new Date().toISOString() }).eq('id', stepId)

  let updatedPending = 0
  if (apply) {
    // Re-render every pending review send that maps to this step (same sequence + step_number)
    const { data: pending } = await sb.from('sequence_sends')
      .select('id,customer_id,to_email')
      .eq('sequence_id', step.sequence_id).eq('step_number', step.step_number).eq('status', 'review')
    const rows = (pending as any[]) || []
    if (rows.length) {
      const { data: seq } = await sb.from('sequences').select('from_name').eq('id', step.sequence_id).single()
      const fromName = seq?.from_name || ''
      const custIds = rows.map(r => r.customer_id)
      const { data: custs } = await sb.from('customers').select('id,email,company_name,contact_name,city,state,industry,website').in('id', custIds)
      // (id is included so {{customer_id}} substitution works in landing-page URLs)
      const byId: Record<string, any> = {}; (custs || []).forEach((c: any) => { byId[c.id] = c })
      for (const r of rows) {
        const c = byId[r.customer_id]; if (!c) continue
        const newSubject = render(subject, c, fromName)
        const newBody = render(bodyText, c, fromName)
        await sb.from('sequence_sends').update({ subject: newSubject, body: newBody }).eq('id', r.id)
        updatedPending++
      }
    }
  }
  return NextResponse.json({ updated_pending: updatedPending })
}
