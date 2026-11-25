/* eslint-disable @typescript-eslint/no-explicit-any */
// Server-only helpers for customer proof approval (Sales Order ▸ Customer proof approval).
// The customer opens a tokenised page on the proof host (no login) and approves or asks for changes.
import { Resend } from 'resend'
import { esc, fmtStamp } from '@/lib/packaging/approvalServer'

export { esc, fmtStamp }
export const PROOF_HOST = (process.env.NEXT_PUBLIC_PROOF_ORIGIN || 'https://beyondgreen-proofs.vercel.app').replace(/\/$/, '')
export const ERP_HOST = 'https://beyondgreen-erp.vercel.app'
export const FILE_BUCKET = 'erp-files'
export const IMAGE_TTL = 60 * 60 * 24 * 30 // proof image links in emails last 30 days

export const approveUrl = (token: string) => `${PROOF_HOST}/proof/approve/${token}`
export const orderUrl = (orderId: string) => `${ERP_HOST}/sales/orders?item=${orderId}`

export function newToken() {
  const b = new Uint8Array(24)
  crypto.getRandomValues(b)
  return Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const isImage = (name?: string | null) => /\.(png|jpe?g|gif|webp)$/i.test(name || '')

// Customer-facing email shell (beyondGREEN branding, no internal wording).
export function customerShell(title: string, bodyHtml: string, button?: { href: string; label: string }) {
  return `<!DOCTYPE html><html><body style="margin:0;background:#F5F6FA;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:600px;margin:28px auto;background:#fff;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden">
  <div style="background:#14532D;padding:18px 26px;color:#fff"><span style="font-weight:700;font-size:17px">beyondGREEN</span>
    <span style="font-size:13px;margin-left:10px;opacity:.85">Proof for your approval</span></div>
  <div style="padding:24px 26px;color:#111827;font-size:14px;line-height:1.5">
    <h2 style="margin:0 0 14px;font-size:19px">${esc(title)}</h2>
    ${bodyHtml}
    ${button ? `<p style="margin:22px 0 0"><a href="${button.href}" style="display:inline-block;background:#16A34A;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:8px">${esc(button.label)}</a></p>` : ''}
  </div>
  <div style="padding:12px 26px;border-top:1px solid #F3F4F6;color:#9CA3AF;font-size:12px">beyondGREEN biotech, Inc. · 1202 E. Wakeham Ave., Santa Ana, CA 92705 · (866) 364-9466</div>
</div></body></html>`
}

// Team-facing note (ERP shell).
export function teamShell(title: string, bodyHtml: string, href: string) {
  return `<!DOCTYPE html><html><body style="margin:0;background:#F5F6FA;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:580px;margin:28px auto;background:#fff;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden">
  <div style="background:#111827;padding:16px 24px;color:#fff;font-weight:700">beyondGREEN ERP · Customer proof</div>
  <div style="padding:22px 24px;color:#111827;font-size:14px;line-height:1.5">
    <h2 style="margin:0 0 12px;font-size:18px">${esc(title)}</h2>${bodyHtml}
    <p style="margin:20px 0 0"><a href="${href}" style="display:inline-block;background:#3B6FE0;color:#fff;text-decoration:none;font-weight:600;padding:10px 20px;border-radius:8px">Open the order in the ERP</a></p>
  </div></div></body></html>`
}

export async function sendMail(opts: { to: string[]; cc?: string[]; subject: string; html: string; replyTo?: string }) {
  const key = process.env.RESEND_API_KEY
  const to = opts.to.filter(Boolean)
  if (!key || !to.length) return false
  try {
    const resend = new Resend(key)
    const r: any = await resend.emails.send({
      from: 'beyondGREEN <erp@beyondgreenbiotech.com>', to, subject: opts.subject, html: opts.html,
      ...(opts.cc?.length ? { cc: opts.cc } : {}), ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
    })
    return !r?.error
  } catch (e) { console.error('customer proof email failed', e); return false }
}

// Signed link to the proof image (service-role client).
export async function signedImage(admin: any, path: string, ttl = IMAGE_TTL) {
  const { data } = await admin.storage.from(FILE_BUCKET).createSignedUrl(path, ttl)
  return data?.signedUrl || null
}

export async function orderLabel(admin: any, orderId: string) {
  const { data } = await admin.from('sales_orders').select('id, order_number, po_number, notes, customer_id, customer_email, sales_rep').eq('id', orderId).maybeSingle()
  return data
}
