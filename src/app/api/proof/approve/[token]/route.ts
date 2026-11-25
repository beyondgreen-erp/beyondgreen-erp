/* eslint-disable @typescript-eslint/no-explicit-any */
// Public (proof host, no login): the customer views a proof and approves it or asks for changes.
//   GET                                                   → proof details + image link
//   POST { decision: 'approved' | 'changes_requested', name, email?, note?, confirmed? }
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { esc, fmtStamp, isImage, orderLabel, orderUrl, sendMail, signedImage, teamShell } from '@/lib/customerProof'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' }
const TEAM_CC = ['dhanush.k@beyondgreenbiotech.com']

async function load(admin: any, token: string) {
  if (!token || token.length < 20) return null
  const { data } = await admin.from('customer_proofs').select('*').eq('token', token).maybeSingle()
  return data
}

function publicView(p: any, order: any, img: string | null, download: string | null) {
  return {
    title: p.title, round_no: p.round_no, status: p.status, file_name: p.file_name, is_image: isImage(p.file_name),
    image_url: img, download_url: download, message: p.message, recipient_name: p.recipient_name,
    sent_at: p.sent_at, decided_at: p.decided_at, decided_name: p.decided_name, decision_note: p.decision_note,
    order_ref: order?.po_number || order?.order_number || null,
  }
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const admin = createSupabaseAdminClient()
  const p = await load(admin, params.token)
  if (!p) return NextResponse.json({ error: 'This proof link is not valid.' }, { status: 404, headers: NO_STORE })
  const order = p.sales_order_id ? await orderLabel(admin, p.sales_order_id) : null
  const img = isImage(p.file_name) ? await signedImage(admin, p.storage_path, 60 * 60) : null
  const download = await signedImage(admin, p.storage_path, 60 * 60)
  if (p.status === 'sent') await admin.from('customer_proofs').update({ view_count: (p.view_count || 0) + 1, viewed_at: new Date().toISOString() }).eq('id', p.id)
  return NextResponse.json(publicView(p, order, img, download), { headers: NO_STORE })
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const admin = createSupabaseAdminClient()
  const p = await load(admin, params.token)
  if (!p) return NextResponse.json({ error: 'This proof link is not valid.' }, { status: 404, headers: NO_STORE })
  if (p.status === 'cancelled') return NextResponse.json({ error: 'This proof was replaced by a newer one. Please use the latest email from beyondGREEN.' }, { status: 409, headers: NO_STORE })
  if (p.status !== 'sent') return NextResponse.json({ error: `This proof was already ${p.status === 'approved' ? 'approved' : 'sent back for changes'}.` }, { status: 409, headers: NO_STORE })

  const b = await req.json().catch(() => ({}))
  const decision = b.decision === 'approved' ? 'approved' : b.decision === 'changes_requested' ? 'changes_requested' : ''
  const name = String(b.name || '').trim().slice(0, 120)
  const email = String(b.email || '').trim().slice(0, 200)
  const note = String(b.note || '').trim().slice(0, 4000)
  if (!decision) return NextResponse.json({ error: 'Please choose approve or request changes.' }, { status: 400, headers: NO_STORE })
  if (!name) return NextResponse.json({ error: 'Please enter your name.' }, { status: 400, headers: NO_STORE })
  if (decision === 'approved' && !b.confirmed) return NextResponse.json({ error: 'Please confirm you checked the spelling, colors and placement.' }, { status: 400, headers: NO_STORE })
  if (decision === 'changes_requested' && !note) return NextResponse.json({ error: 'Please tell us what you would like changed.' }, { status: 400, headers: NO_STORE })

  const now = new Date().toISOString()
  const { data: upd, error } = await admin.from('customer_proofs')
    .update({ status: decision, decided_at: now, decided_name: name, decided_email: email || null, decision_note: note || null })
    .eq('id', p.id).eq('status', 'sent').select().maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })
  if (!upd) return NextResponse.json({ error: 'This proof was already answered.' }, { status: 409, headers: NO_STORE })

  const order = p.sales_order_id ? await orderLabel(admin, p.sales_order_id) : null
  const label = order ? (order.notes || order.po_number || order.order_number) : (p.title || 'custom order')
  const verdict = decision === 'approved' ? 'APPROVED' : 'asked for changes on'
  const title = `${name} ${verdict} proof round ${p.round_no}: ${label}`
  if (p.sales_order_id) {
    await admin.from('comments').insert({
      record_type: 'sales_order', record_id: p.sales_order_id, author_email: email || p.recipient_email,
      content: `<p><b>Customer proof round ${p.round_no} ${decision === 'approved' ? 'approved' : 'needs changes'}</b> by ${esc(name)}${email ? ` (${esc(email)})` : ''} on ${esc(fmtStamp(now))}. File: ${esc(p.file_name || '')}.</p>${note ? `<p>${esc(note)}</p>` : ''}`,
    })
  }
  const team = Array.from(new Set([p.sent_by, ...TEAM_CC].filter(Boolean))) as string[]
  for (const r of team) {
    try {
      await admin.from('notifications').insert({
        recipient_email: r, sender_email: 'erp@beyondgreenbiotech.com', message: title, page: 'Sales Orders',
        is_read: false, context_url: p.sales_order_id ? `/sales/orders?item=${p.sales_order_id}` : null,
      })
    } catch { /* non-fatal */ }
  }
  await sendMail({
    to: team, subject: `[Proof ${decision === 'approved' ? 'approved' : 'changes'}] ${label}`,
    html: teamShell(title, `
      <p style="margin:0 0 10px">${esc(name)}${email ? ` (${esc(email)})` : ''} ${decision === 'approved' ? '<b>approved</b>' : '<b>asked for changes on</b>'} proof round ${p.round_no} (${esc(p.file_name || '')}) on ${esc(fmtStamp(now))}.</p>
      ${note ? `<div style="border-left:4px solid ${decision === 'approved' ? '#16A34A' : '#F59E0B'};background:#F9FAFB;border-radius:8px;padding:12px 14px;white-space:pre-wrap">${esc(note)}</div>` : ''}
      ${decision === 'approved' ? '<p style="margin:12px 0 0">This file is the approved proof for printing.</p>' : '<p style="margin:12px 0 0">Update the proof and send a new round from the order.</p>'}`,
      p.sales_order_id ? orderUrl(p.sales_order_id) : 'https://beyondgreen-erp.vercel.app'),
  })
  return NextResponse.json({ ok: true, status: decision }, { headers: NO_STORE })
}
