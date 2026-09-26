/* eslint-disable @typescript-eslint/no-explicit-any */
// POST: the printer sends the proof back to beyondGREEN for final approval.
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { loadLink } from '@/lib/packaging/proofServer'
import { APPROVERS } from '@/lib/packaging/activity'
import { log, loadDoc, notifyTeam, sendEmail, emailShell, esc, fmtStamp, ERP_URL } from '@/lib/packaging/approvalServer'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const admin = createSupabaseAdminClient()
  const r = await loadLink(admin, params.token)
  if (!r.link) return NextResponse.json({ error: r.error }, { status: r.status, headers: NO_STORE })
  const link = r.link
  const b = await req.json().catch(() => ({}))
  const name = String(b.name || '').trim().slice(0, 120)
  const email = String(b.email || '').trim().slice(0, 200)
  const note = String(b.note || '').trim().slice(0, 4000)
  if (!name) return NextResponse.json({ error: 'Please enter your name.' }, { status: 400, headers: NO_STORE })
  if (!b.checked_sizes || !b.checked_colours) return NextResponse.json({ error: 'Please confirm you have checked the sizes and colour codes.' }, { status: 400, headers: NO_STORE })

  const { data: open } = await admin.from('packaging_approval_rounds').select('id').eq('design_id', link.design_id).eq('share_link_id', link.id).eq('status', 'awaiting_team').limit(1)
  if (open?.length) return NextResponse.json({ error: 'This proof is already waiting for beyondGREEN to confirm.' }, { status: 409, headers: NO_STORE })

  const { data: design } = await admin.from('packaging_designs').select('*').eq('id', link.design_id).maybeSingle()
  if (!design) return NextResponse.json({ error: 'Design not found.' }, { status: 404, headers: NO_STORE })
  const doc = await loadDoc(admin, design)
  if (!doc?.source?.sha256) return NextResponse.json({ error: 'The original artwork file is not attached yet — please ask beyondGREEN.' }, { status: 409, headers: NO_STORE })
  const { count } = await admin.from('packaging_approval_rounds').select('id', { count: 'exact', head: true }).eq('design_id', design.id)

  const { data: round, error } = await admin.from('packaging_approval_rounds').insert({
    design_id: design.id, share_link_id: link.id, round_no: (count || 0) + 1, status: 'awaiting_team',
    submitted_by_name: name, submitted_by_email: email || null, printer_note: note || null,
    source_name: doc.source.name, source_sha256: doc.source.sha256, source_path: doc.source.path, approvers: APPROVERS,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })
  await admin.from('packaging_designs').update({ status: 'In Review', updated_at: design.updated_at }).eq('id', design.id)
  await log(admin, { design_id: design.id, share_link_id: link.id, actor_type: 'printer', actor_name: name, actor_email: email || null, action: 'submitted', details: { round: round.round_no, note, file: doc.source.name, sha256: doc.source.sha256, checked_sizes: true, checked_colours: true } })

  const who = link.printer_company || name
  const title = `${who} submitted ${design.name} for approval`
  await notifyTeam(admin, design.id, title, `Round ${round.round_no} — all 5 confirmations are needed before the approval goes to the printer.${note ? ' Note: ' + note.slice(0, 140) : ''}`, email)
  await sendEmail(APPROVERS.map(a => a.email), `[Approval needed] ${title}`, emailShell(title, `
    <p style="margin:0 0 10px;color:#374151;font-size:14px">${esc(name)}${link.printer_company ? ' (' + esc(link.printer_company) + ')' : ''} reviewed the proof and sent it back for final approval on <b>${esc(fmtStamp(round.submitted_at))}</b>.</p>
    ${note ? `<div style="border-left:4px solid #8B5CF6;background:#F9FAFB;border-radius:8px;padding:12px 14px;margin:12px 0;font-size:14px;white-space:pre-wrap">${esc(note)}</div>` : ''}
    <p style="margin:0;color:#374151;font-size:14px">File: <b>${esc(doc.source.name)}</b><br><span style="font-family:monospace;font-size:11px;color:#6B7280">SHA-256 ${esc(doc.source.sha256)}</span></p>
    <p style="margin:12px 0 0;color:#374151;font-size:14px">Approval goes to the printer only after all of: ${APPROVERS.map(a => esc(a.name)).join(', ')} confirm.</p>`,
    { href: `${ERP_URL}/packaging/${design.id}?tab=approvals`, label: 'Review & confirm in the ERP' }), email || undefined)
  return NextResponse.json({ ok: true, round_id: round.id }, { headers: NO_STORE })
}
