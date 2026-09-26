/* eslint-disable @typescript-eslint/no-explicit-any */
// Server-only helpers for the printer approval workflow (service-role client).
import { Resend } from 'resend'
import { APPROVERS } from './activity'
import { BUCKET } from './doc'

export const ERP_URL = 'https://beyondgreen-erp.vercel.app'
export const PROOF_URL = 'https://beyondgreen-proofs.vercel.app'
export const esc = (s: any) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
export const fmtStamp = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })

export async function log(admin: any, row: { design_id: string; share_link_id?: string | null; actor_type: 'team' | 'printer' | 'system'; actor_name?: string | null; actor_email?: string | null; action: string; details?: any }) {
  try { await admin.from('packaging_activity').insert({ details: {}, ...row }) } catch { /* best effort */ }
}

export async function loadDoc(admin: any, design: any): Promise<any | null> {
  if (!design?.doc_path) return null
  const { data } = await admin.storage.from(BUCKET).download(design.doc_path)
  if (!data) return null
  try { return JSON.parse(await data.text()) } catch { return null }
}

export function emailShell(title: string, bodyHtml: string, button?: { href: string; label: string }, accent = '#3B6FE0') {
  return `<!DOCTYPE html><html><body style="margin:0;background:#F5F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:580px;margin:32px auto;background:#fff;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden">
  <div style="background:#111827;padding:18px 26px;color:#fff"><span style="display:inline-block;background:#2ABF06;border-radius:6px;padding:4px 8px;font-weight:700;font-size:13px">bG</span>
    <span style="font-weight:700;font-size:15px;margin-left:10px">beyondGREEN · Packaging approval</span></div>
  <div style="padding:24px 26px;color:#111827">
    <h2 style="margin:0 0 14px;font-size:19px">${esc(title)}</h2>
    ${bodyHtml}
    ${button ? `<p style="margin:22px 0 0"><a href="${button.href}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px">${esc(button.label)}</a></p>` : ''}
  </div>
  <div style="padding:12px 26px;border-top:1px solid #F3F4F6;color:#9CA3AF;font-size:12px">beyondGREEN biotech, Inc. · Sent automatically by the beyondGREEN ERP</div>
</div></body></html>`
}

export async function sendEmail(to: string[], subject: string, html: string, replyTo?: string) {
  if (!process.env.RESEND_API_KEY || !to.length) return false
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    await resend.emails.send({ from: 'beyondGREEN ERP <erp@beyondgreenbiotech.com>', to, subject, html, ...(replyTo ? { replyTo } : {}) })
    return true
  } catch (e) { console.error('email failed', e); return false }
}

export async function notifyTeam(admin: any, designId: string, title: string, message: string, senderEmail?: string | null) {
  try {
    await admin.from('notifications').insert(APPROVERS.map(a => ({
      recipient_email: a.email, sender_email: senderEmail || null, type: 'info', is_read: false, title, message,
      page: 'Packaging Design', record_type: 'packaging_design', record_id: designId, context_url: `/packaging/${designId}?tab=approvals`,
    })))
  } catch { /* best effort */ }
}

/** Current approval state for a design (optionally a single printer link). */
export async function approvalState(admin: any, designId: string, linkId?: string) {
  let q = admin.from('packaging_approval_rounds').select('*').eq('design_id', designId).order('created_at', { ascending: false }).limit(1)
  if (linkId) q = q.eq('share_link_id', linkId)
  const { data: rounds } = await q
  const round = rounds?.[0] || null
  if (!round) return null
  const { data: conf } = await admin.from('packaging_approval_confirmations').select('*').eq('round_id', round.id)
  const list = (round.approvers?.length ? round.approvers : APPROVERS).map((a: any) => {
    const c = (conf || []).find((x: any) => x.approver_email.toLowerCase() === a.email.toLowerCase())
    return { name: a.name, email: a.email, decision: c?.decision || null, note: c?.note || null, decided_at: c?.decided_at || null }
  })
  return { round, approvers: list, confirmed: list.filter((a: any) => a.decision === 'confirmed').length, total: list.length }
}
