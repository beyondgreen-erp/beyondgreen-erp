/* eslint-disable @typescript-eslint/no-explicit-any */
// POST: ask chosen team members to approve a packaging design (team review — never shown to printers).
//   { design_id, emails: string[], message? }  → create the request, email + notify everyone chosen
//   { round_id, remind: true }                  → re-send the email to whoever has not approved yet
//   { round_id, cancel: true }                  → withdraw an open request
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { createSupabaseServerClient } from '@/lib/supabase'
import { log, loadDoc, notifyTeam, sendEmail, emailShell, esc, ERP_URL, BUCKET_THUMB_TTL } from '@/lib/packaging/approvalServer'
import { BUCKET } from '@/lib/packaging/doc'

export const dynamic = 'force-dynamic'

function requestEmail(design: any, requester: string, message: string, names: string[], thumb: string | null, reminder = false) {
  const href = `${ERP_URL}/packaging/${design.id}?tab=approvals`
  const title = reminder ? `Reminder: please approve ${design.name}` : `${requester} asked for your approval: ${design.name}`
  return {
    title,
    html: emailShell(title, `
      <p style="margin:0 0 12px;color:#374151;font-size:14px">${reminder ? 'This design is still waiting for your approval.' : `${esc(requester)} added this packaging design and would like your approval.`}</p>
      ${thumb ? `<p style="margin:0 0 12px"><img src="${thumb}" alt="" style="max-width:100%;border:1px solid #E5E7EB;border-radius:8px"></p>` : ''}
      <p style="margin:0 0 4px;font-size:14px"><b>${esc(design.name)}</b></p>
      <p style="margin:0 0 12px;font-size:13px;color:#6B7280">${esc([design.customer_name, design.sku, design.product_type].filter(Boolean).join(' · '))}</p>
      ${message ? `<div style="border-left:4px solid #3B6FE0;background:#F9FAFB;border-radius:8px;padding:12px 14px;margin:0 0 12px;font-size:14px;white-space:pre-wrap">${esc(message)}</div>` : ''}
      <p style="margin:0;color:#374151;font-size:13px">Approvers: ${names.map(esc).join(', ')}. The design becomes <b>Fully Approved</b> once everyone has approved.</p>`,
      { href, label: 'Review & approve in the ERP' }),
  }
}

export async function POST(req: NextRequest) {
  const s = await createSupabaseServerClient()
  const { data: { user } } = await s.auth.getUser()
  const email = user?.email?.toLowerCase() || ''
  if (!email) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })
  const admin = createSupabaseAdminClient()
  const { data: me } = await admin.from('user_profiles').select('full_name, display_name').ilike('email', email).maybeSingle()
  const myName = me?.full_name || me?.display_name || email.split('@')[0]
  const b = await req.json().catch(() => ({}))
  const thumbFor = async (design: any) => {
    if (!design?.thumb_path) return null
    const { data } = await admin.storage.from(BUCKET).createSignedUrl(design.thumb_path, BUCKET_THUMB_TTL)
    return data?.signedUrl || null
  }

  // ── reminder / cancel on an existing request ──
  if (b.round_id) {
    const { data: round } = await admin.from('packaging_approval_rounds').select('*').eq('id', b.round_id).maybeSingle()
    if (!round || round.kind !== 'team') return NextResponse.json({ error: 'Request not found.' }, { status: 404 })
    if (round.status !== 'awaiting_team') return NextResponse.json({ error: 'This request is already closed.' }, { status: 409 })
    const { data: design } = await admin.from('packaging_designs').select('*').eq('id', round.design_id).maybeSingle()
    if (b.cancel) {
      await admin.from('packaging_approval_rounds').update({ status: 'cancelled', closed_by: email, closed_note: 'Withdrawn by ' + myName }).eq('id', round.id)
      await log(admin, { design_id: round.design_id, actor_type: 'team', actor_name: myName, actor_email: email, action: 'team_review_cancelled', details: { round: round.round_no } })
      return NextResponse.json({ ok: true })
    }
    const { data: conf } = await admin.from('packaging_approval_confirmations').select('approver_email, decision').eq('round_id', round.id)
    const pending = (round.approvers || []).filter((a: any) => !(conf || []).some((c: any) => c.approver_email.toLowerCase() === a.email.toLowerCase() && c.decision === 'confirmed'))
    if (!pending.length) return NextResponse.json({ error: 'Everyone has already approved.' }, { status: 409 })
    const m = requestEmail(design, myName, round.printer_note || '', round.approvers.map((a: any) => a.name), await thumbFor(design), true)
    const sent = await sendEmail(pending.map((a: any) => a.email), m.title, m.html, email)
    await notifyTeam(admin, round.design_id, m.title, `Waiting on ${pending.map((a: any) => a.name).join(', ')}.`, email, pending)
    await log(admin, { design_id: round.design_id, actor_type: 'team', actor_name: myName, actor_email: email, action: 'team_reminder', details: { round: round.round_no, to: pending.map((a: any) => a.name).join(', ') } })
    return NextResponse.json({ ok: true, emailed: sent, to: pending.map((a: any) => a.name) })
  }

  // ── new request ──
  const emails: string[] = Array.isArray(b.emails) ? Array.from(new Set(b.emails.map((e: any) => String(e).trim().toLowerCase()).filter(Boolean))) : []
  if (!emails.length) return NextResponse.json({ error: 'Choose at least one person.' }, { status: 400 })
  const message = String(b.message || '').trim().slice(0, 4000)
  const { data: design } = await admin.from('packaging_designs').select('*').eq('id', b.design_id).maybeSingle()
  if (!design) return NextResponse.json({ error: 'Design not found.' }, { status: 404 })
  const { data: open } = await admin.from('packaging_approval_rounds').select('id, kind').eq('design_id', design.id).eq('status', 'awaiting_team').limit(1)
  if (open?.length) return NextResponse.json({ error: open[0].kind === 'team' ? 'An approval request is already open for this design. Send a reminder or cancel it first.' : 'A printer submission is waiting for confirmation on this design. Finish that first.' }, { status: 409 })
  // only real, active team members
  const { data: people } = await admin.from('user_profiles').select('email, full_name, display_name, is_active')
  const approvers = emails.map(e => {
    const p = (people || []).find((x: any) => (x.email || '').toLowerCase() === e && x.is_active !== false)
    return p ? { email: p.email, name: p.full_name || p.display_name || p.email.split('@')[0] } : null
  }).filter(Boolean) as { email: string; name: string }[]
  if (approvers.length !== emails.length) return NextResponse.json({ error: 'One or more people are not active ERP users.' }, { status: 400 })

  const doc = await loadDoc(admin, design)
  const { count } = await admin.from('packaging_approval_rounds').select('id', { count: 'exact', head: true }).eq('design_id', design.id)
  const { data: round, error } = await admin.from('packaging_approval_rounds').insert({
    design_id: design.id, share_link_id: null, kind: 'team', round_no: (count || 0) + 1, status: 'awaiting_team',
    submitted_by_name: myName, submitted_by_email: email, printer_note: message || null,
    source_name: doc?.source?.name || null, source_sha256: doc?.source?.sha256 || null, source_path: doc?.source?.path || null, approvers,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!['Fully Approved', 'Final'].includes(design.status)) await admin.from('packaging_designs').update({ status: 'In Review', updated_at: design.updated_at }).eq('id', design.id)
  await log(admin, { design_id: design.id, actor_type: 'team', actor_name: myName, actor_email: email, action: 'team_review_requested', details: { round: round.round_no, text: approvers.map(a => a.name).join(', '), note: message } })
  const m = requestEmail(design, myName, message, approvers.map(a => a.name), await thumbFor(design))
  const sent = await sendEmail(approvers.map(a => a.email), m.title, m.html, email)
  await notifyTeam(admin, design.id, m.title, message ? message.slice(0, 200) : `Please review and approve. ${approvers.length} approvals needed.`, email, approvers)
  return NextResponse.json({ ok: true, round_id: round.id, emailed: sent })
}
