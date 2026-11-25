/* eslint-disable @typescript-eslint/no-explicit-any */
// Customer proof approval (staff only).
//   GET  ?order=<sales_order_id>                         → proofs sent for this order
//   POST { sales_order_id, file_attachment_id, recipient_email, recipient_name?, cc?, message?, title? }
//                                                        → email the proof to the customer
//   POST { id, cancel: true }                            → withdraw an open proof
//   POST { id, remind: true }                            → re-send the email for an open proof
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { createSupabaseServerClient } from '@/lib/supabase'
import { approveUrl, customerShell, esc, isImage, newToken, orderLabel, orderUrl, sendMail, signedImage } from '@/lib/customerProof'

export const dynamic = 'force-dynamic'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function staff() {
  const s = await createSupabaseServerClient()
  const { data: { user } } = await s.auth.getUser()
  const email = user?.email?.toLowerCase() || ''
  if (!email || !/@(beyondgreenbiotech\.com|byndgrn\.com)$/.test(email)) return null
  return email
}

function proofEmail(p: any, order: any, senderName: string, img: string | null, reminder = false) {
  const first = (p.recipient_name || '').trim().split(/\s+/)[0]
  const what = p.title || 'your custom order'
  const subject = `${reminder ? 'Reminder: ' : ''}Please approve your proof: ${what}`
  const html = customerShell(reminder ? `Your proof is still waiting for approval` : `Your proof is ready`, `
    <p style="margin:0 0 12px">Hi${first ? ' ' + esc(first) : ''},</p>
    <p style="margin:0 0 12px">Thank you for your order${order?.po_number ? ` (${esc(order.po_number)})` : ''}! Here is the proof for <b>${esc(what)}</b>. We will not print until you approve it.</p>
    ${p.message ? `<div style="border-left:4px solid #16A34A;background:#F9FAFB;border-radius:8px;padding:12px 14px;margin:0 0 14px;white-space:pre-wrap">${esc(p.message)}</div>` : ''}
    ${img ? `<p style="margin:0 0 12px"><img src="${img}" alt="Proof" style="max-width:100%;border:1px solid #E5E7EB;border-radius:8px"></p>` : ''}
    <p style="margin:0 0 6px">Please click below to <b>approve</b> it or <b>ask for changes</b>.</p>
    <p style="margin:0;color:#6B7280;font-size:13px">Colors on screen can look slightly different from the printed bag. If you have any questions, just reply to this email.</p>
    <p style="margin:14px 0 0">Thank you,<br>${esc(senderName)}<br>beyondGREEN biotech</p>`,
    { href: approveUrl(p.token), label: 'Review and approve the proof' })
  return { subject, html }
}

export async function GET(req: NextRequest) {
  const me = await staff()
  if (!me) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })
  const order = req.nextUrl.searchParams.get('order')
  if (!order) return NextResponse.json({ error: 'order is required' }, { status: 400 })
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.from('customer_proofs').select('*').eq('sales_order_id', order).order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ proofs: data || [] })
}

export async function POST(req: NextRequest) {
  const me = await staff()
  if (!me) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })
  const admin = createSupabaseAdminClient()
  const { data: prof } = await admin.from('user_profiles').select('full_name, display_name').ilike('email', me).maybeSingle()
  const myName = prof?.full_name || prof?.display_name || me.split('@')[0]
  const b = await req.json().catch(() => ({}))

  // ── cancel / remind an existing proof ──
  if (b.id) {
    const { data: p } = await admin.from('customer_proofs').select('*').eq('id', b.id).maybeSingle()
    if (!p) return NextResponse.json({ error: 'Proof not found.' }, { status: 404 })
    if (p.status !== 'sent') return NextResponse.json({ error: `This proof is already ${p.status.replace('_', ' ')}.` }, { status: 409 })
    if (b.cancel) {
      await admin.from('customer_proofs').update({ status: 'cancelled' }).eq('id', p.id)
      if (p.sales_order_id) await admin.from('comments').insert({ record_type: 'sales_order', record_id: p.sales_order_id, author_email: me, content: `<p>Withdrew customer proof round ${p.round_no} (${esc(p.file_name || '')}).</p>` })
      return NextResponse.json({ ok: true })
    }
    if (b.remind) {
      const order = p.sales_order_id ? await orderLabel(admin, p.sales_order_id) : null
      const img = isImage(p.file_name) ? await signedImage(admin, p.storage_path) : null
      const m = proofEmail(p, order, myName, img, true)
      const ok = await sendMail({ to: [p.recipient_email], cc: p.cc_emails || [], subject: m.subject, html: m.html, replyTo: me })
      return NextResponse.json({ ok, emailed: ok })
    }
    return NextResponse.json({ error: 'Nothing to do.' }, { status: 400 })
  }

  // ── send a new proof ──
  const orderId = String(b.sales_order_id || '')
  const recipient = String(b.recipient_email || '').trim().toLowerCase()
  if (!orderId) return NextResponse.json({ error: 'sales_order_id is required' }, { status: 400 })
  if (!EMAIL_RE.test(recipient)) return NextResponse.json({ error: 'Enter a valid customer email.' }, { status: 400 })
  const cc = (Array.isArray(b.cc) ? b.cc : String(b.cc || '').split(/[,;\s]+/)).map((e: string) => e.trim().toLowerCase()).filter((e: string) => EMAIL_RE.test(e)).slice(0, 5)

  const order = await orderLabel(admin, orderId)
  if (!order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
  const { data: file } = await admin.from('file_attachments').select('id, file_name, storage_path, record_id').eq('id', b.file_attachment_id || '').maybeSingle()
  if (!file || file.record_id !== orderId) return NextResponse.json({ error: 'Pick a proof file attached to this order.' }, { status: 400 })

  // A new round replaces any proof still waiting on the customer.
  await admin.from('customer_proofs').update({ status: 'cancelled' }).eq('sales_order_id', orderId).eq('status', 'sent')
  const { count } = await admin.from('customer_proofs').select('id', { count: 'exact', head: true }).eq('sales_order_id', orderId)

  const row = {
    sales_order_id: orderId, customer_id: order.customer_id || null, token: newToken(), round_no: (count || 0) + 1,
    title: String(b.title || '').trim().slice(0, 160) || null, file_attachment_id: file.id, storage_path: file.storage_path, file_name: file.file_name,
    recipient_name: String(b.recipient_name || '').trim().slice(0, 120) || null, recipient_email: recipient, cc_emails: cc,
    message: String(b.message || '').trim().slice(0, 2000) || null, sent_by: me,
  }
  const { data: p, error } = await admin.from('customer_proofs').insert(row).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const img = isImage(file.file_name) ? await signedImage(admin, file.storage_path) : null
  const m = proofEmail(p, order, myName, img)
  const ok = await sendMail({ to: [recipient], cc, subject: m.subject, html: m.html, replyTo: me })
  await admin.from('customer_proofs').update({ email_sent: ok }).eq('id', p.id)
  await admin.from('comments').insert({
    record_type: 'sales_order', record_id: orderId, author_email: me,
    content: `<p>Sent customer proof round ${p.round_no} (<b>${esc(file.file_name)}</b>) to ${esc(recipient)}${cc.length ? ` (cc ${esc(cc.join(', '))})` : ''} for approval.${ok ? '' : ' <b>The email did not go out</b>; copy the link from the Customer proof section and send it yourself.'}</p>`,
  })
  return NextResponse.json({ ok: true, emailed: ok, proof: { ...p, email_sent: ok }, link: approveUrl(p.token), order_link: orderUrl(orderId) })
}
