import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { getOutlookAccessToken, sendViaGraph } from '@/lib/outlook'

export const maxDuration = 60

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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
  if (!seqs || !seqs.length) return NextResponse.json({ sent: 0, message: 'No active sequences.' })

  const results: any[] = []
  let totalSent = 0

  for (const seq of seqs) {
    const sendDays: string[] = seq.send_days || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
    if (!onlySeq && !sendDays.includes(today)) { results.push({ sequence: seq.name, skipped: `not a send day (${today})` }); continue }
    if (!seq.from_email) { results.push({ sequence: seq.name, skipped: 'no from_email set' }); continue }

    const token = await getOutlookAccessToken(seq.from_email)
    if (!token) { results.push({ sequence: seq.name, skipped: `mailbox ${seq.from_email} not connected` }); continue }

    const { data: steps } = await sb.from('sequence_steps').select('*').eq('sequence_id', seq.id).order('step_number')
    if (!steps || !steps.length) { results.push({ sequence: seq.name, skipped: 'no steps' }); continue }

    // How many already sent today for this sequence (respect the daily cap)
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
    const { count: sentToday } = await sb.from('sequence_sends').select('id', { count: 'exact', head: true }).eq('sequence_id', seq.id).eq('status', 'sent').gte('sent_at', startOfDay.toISOString())
    let budget = Math.max(0, (seq.daily_cap || 40) - (sentToday || 0))
    if (budget === 0) { results.push({ sequence: seq.name, skipped: 'daily cap reached' }); continue }

    const { data: due } = await sb.from('sequence_enrollments')
      .select('*').eq('sequence_id', seq.id).eq('status', 'active').lte('next_send_at', nowIso)
      .order('next_send_at').limit(budget)
    const dueRows = due || []
    if (!dueRows.length) { results.push({ sequence: seq.name, sent: 0, note: 'nothing due' }); continue }

    const custIds = dueRows.map(d => d.customer_id)
    const { data: custs } = await sb.from('customers').select('id,email,company_name,contact_name,city,state,industry,website,do_not_contact,auto_outreach_paused').in('id', custIds)
    const byId: Record<string, any> = {}; (custs || []).forEach(c => { byId[c.id] = c })

    let sent = 0
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
      const html = bodyText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')

      const send = await sb.from('sequence_sends').insert({ enrollment_id: enr.id, sequence_id: seq.id, customer_id: c.id, step_number: enr.current_step + 1, to_email: c.email, subject, body: bodyText, status: 'queued' }).select('id').single()
      try {
        await sendViaGraph(token, { to: c.email, subject, html })
        await sb.from('sequence_sends').update({ status: 'sent', sent_at: nowIso }).eq('id', (send.data as any)?.id)
        try { await sb.from('customer_outreach').insert({ customer_id: c.id, subject, body: bodyText, to_email: c.email, delivered_via: 'sequence', status: 'sent', sent_by: seq.from_email, sent_at: nowIso, sequence_active: true, sequence_step: enr.current_step + 1 }) } catch { /* ignore */ }
        try { await sb.from('customers').update({ contacted_at: nowIso, pipeline_stage: 'Contacted' }).eq('id', c.id) } catch { /* ignore */ }

        const nextStep = steps[enr.current_step + 1]
        if (nextStep) {
          const next = new Date(Date.now() + (nextStep.delay_days || 1) * 86400000).toISOString()
          await sb.from('sequence_enrollments').update({ current_step: enr.current_step + 1, last_step_sent_at: nowIso, next_send_at: next, updated_at: nowIso }).eq('id', enr.id)
        } else {
          await sb.from('sequence_enrollments').update({ current_step: enr.current_step + 1, last_step_sent_at: nowIso, status: 'finished', updated_at: nowIso }).eq('id', enr.id)
        }
        sent++; budget--; totalSent++
      } catch (err) {
        await sb.from('sequence_sends').update({ status: 'failed', error: (err as Error).message }).eq('id', (send.data as any)?.id)
      }
    }
    results.push({ sequence: seq.name, sent })
  }

  return NextResponse.json({ sent: totalSent, day: today, results, message: `Sent ${totalSent} email(s).` })
}
