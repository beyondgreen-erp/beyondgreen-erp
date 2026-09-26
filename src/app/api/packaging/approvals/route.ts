/* eslint-disable @typescript-eslint/no-explicit-any */
// POST: a beyondGREEN approver confirms, or requests changes on, the printer's submission.
// When all approvers have confirmed, the approval (with the exact file) is sent to the printer.
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { createSupabaseServerClient } from '@/lib/supabase'
import { APPROVERS } from '@/lib/packaging/activity'
import { log, loadDoc, approvalState, notifyTeam, sendEmail, emailShell, esc, fmtStamp, PROOF_URL } from '@/lib/packaging/approvalServer'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const s = await createSupabaseServerClient()
  const { data: { user } } = await s.auth.getUser()
  const email = user?.email?.toLowerCase() || ''
  const me = APPROVERS.find(a => a.email.toLowerCase() === email)
  if (!me) return NextResponse.json({ error: 'Only the packaging approvers can confirm (' + APPROVERS.map(a => a.name).join(', ') + ').' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const decision = b.decision === 'changes' ? 'changes' : 'confirmed'
  const note = String(b.note || '').trim().slice(0, 4000)
  if (decision === 'changes' && !note) return NextResponse.json({ error: 'Please say what needs to change.' }, { status: 400 })
  const admin = createSupabaseAdminClient()
  const { data: round } = await admin.from('packaging_approval_rounds').select('*').eq('id', b.round_id).maybeSingle()
  if (!round) return NextResponse.json({ error: 'Approval round not found.' }, { status: 404 })
  if (round.status !== 'awaiting_team') return NextResponse.json({ error: 'This round is already ' + round.status.replace('_', ' ') + '.' }, { status: 409 })
  const { data: design } = await admin.from('packaging_designs').select('*').eq('id', round.design_id).maybeSingle()
  const doc = await loadDoc(admin, design)
  if (!doc?.source?.sha256 || doc.source.sha256 !== round.source_sha256) {
    await admin.from('packaging_approval_rounds').update({ status: 'cancelled', closed_by: email, closed_note: 'Artwork file changed after the printer submitted' }).eq('id', round.id)
    await log(admin, { design_id: round.design_id, share_link_id: round.share_link_id, actor_type: 'system', action: 'round_cancelled', details: { round: round.round_no, reason: 'Artwork file changed after submission' } })
    return NextResponse.json({ error: 'The artwork file changed after the printer submitted, so this round was cancelled. The printer needs to review and submit again.' }, { status: 409 })
  }
  const { error } = await admin.from('packaging_approval_confirmations').upsert({ round_id: round.id, approver_email: me.email, approver_name: me.name, decision, note: note || null, decided_at: new Date().toISOString() }, { onConflict: 'round_id,approver_email' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await log(admin, { design_id: round.design_id, share_link_id: round.share_link_id, actor_type: 'team', actor_name: me.name, actor_email: me.email, action: decision === 'changes' ? 'changes_requested' : 'confirmed', details: { round: round.round_no, note } })
  const { data: link } = round.share_link_id ? await admin.from('packaging_share_links').select('*').eq('id', round.share_link_id).maybeSingle() : { data: null }
  const portal = link ? `${PROOF_URL}/proof/${link.token}` : PROOF_URL

  if (decision === 'changes') {
    await admin.from('packaging_approval_rounds').update({ status: 'changes_requested', closed_by: me.email, closed_note: note }).eq('id', round.id)
    await admin.from('packaging_designs').update({ status: 'Printer Review' }).eq('id', round.design_id)
    await notifyTeam(admin, round.design_id, `${me.name} requested changes on ${design.name}`, note.slice(0, 200), me.email)
    if (link?.printer_email) await sendEmail([link.printer_email], `Changes requested — ${design.name}`, emailShell(`beyondGREEN requested changes on ${design.name}`, `
      <p style="font-size:14px;color:#374151;margin:0 0 10px">Before we can approve this proof for production, please review:</p>
      <div style="border-left:4px solid #F59E0B;background:#FFFBEB;border-radius:8px;padding:12px 14px;font-size:14px;white-space:pre-wrap">${esc(note)}</div>
      <p style="font-size:13px;color:#6B7280;margin:12px 0 0">— ${esc(me.name)}, beyondGREEN</p>`, { href: portal, label: 'Open the proof' }, '#F59E0B'), me.email)
    return NextResponse.json({ ok: true, status: 'changes_requested' })
  }

  const st = await approvalState(admin, round.design_id, round.share_link_id || undefined)
  if (st && st.round.id === round.id && st.confirmed === st.total) {
    const now = new Date().toISOString()
    await admin.from('packaging_approval_rounds').update({ status: 'approved', approved_at: now }).eq('id', round.id)
    await admin.from('packaging_designs').update({ status: 'Approved' }).eq('id', round.design_id)
    await log(admin, { design_id: round.design_id, share_link_id: round.share_link_id, actor_type: 'system', action: 'approved', details: { round: round.round_no, approvers: st.approvers.map((a: any) => ({ name: a.name, at: a.decided_at })), file: round.source_name, sha256: round.source_sha256 } })
    const list = st.approvers.map((a: any) => `<tr><td style="padding:4px 0">✔ ${esc(a.name)}</td><td style="padding:4px 0 4px 16px;color:#6B7280">${esc(fmtStamp(a.decided_at))}</td></tr>`).join('')
    const sent = link?.printer_email ? await sendEmail([link.printer_email], `APPROVED FOR PRODUCTION — ${design.name}`, emailShell(`Approved for production: ${design.name}`, `
      <div style="border:3px solid #16A34A;border-radius:10px;padding:14px 16px;margin:0 0 14px;color:#166534">
        <div style="font-weight:800;letter-spacing:2px;font-size:15px">APPROVED FOR PRODUCTION</div>
        <div style="font-size:13px;margin-top:4px">${esc(fmtStamp(now))} · Round ${round.round_no}</div>
      </div>
      <p style="font-size:14px;color:#374151;margin:0 0 8px">Print <b>only</b> from this exact file (download it from the proof page):</p>
      <p style="font-size:14px;margin:0"><b>${esc(round.source_name)}</b><br><span style="font-family:monospace;font-size:11px;color:#6B7280">SHA-256 ${esc(round.source_sha256)}</span></p>
      <p style="font-size:14px;color:#374151;margin:14px 0 4px">Confirmed by beyondGREEN:</p><table style="font-size:13px">${list}</table>`,
      { href: portal, label: 'Open approved proof & download file' }, '#16A34A'), APPROVERS[0].email) : false
    if (sent) await admin.from('packaging_approval_rounds').update({ approval_sent_at: new Date().toISOString() }).eq('id', round.id)
    await log(admin, { design_id: round.design_id, share_link_id: round.share_link_id, actor_type: 'system', action: 'approval_sent', details: { to: link?.printer_email || null, emailed: sent } })
    await notifyTeam(admin, round.design_id, `${design.name} approved for production`, `All ${st.total} confirmations received — approval ${sent ? 'emailed' : 'posted'} to ${link?.printer_company || 'the printer'}.`, me.email)
    return NextResponse.json({ ok: true, status: 'approved' })
  }
  return NextResponse.json({ ok: true, status: 'awaiting_team', confirmed: st?.confirmed, total: st?.total })
}
