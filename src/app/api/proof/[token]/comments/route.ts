/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { loadLink } from '@/lib/packaging/proofServer'
import { Resend } from 'resend'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' }
const num = (v: any) => (v === null || v === undefined || v === '' || !isFinite(Number(v))) ? null : Math.round(Number(v) * 100) / 100
const ALLOWED = /@(beyondgreenbiotech\.com|byndgrn\.com)$/i
// Always told about printer comments (ERP bell + email), on every design
const PACKAGING_TEAM = ['rudyp@beyondgreenbiotech.com', 'tiya@beyondgreenbiotech.com', 'dhanush.k@beyondgreenbiotech.com']
const ERP_URL = 'https://beyondgreen-erp.vercel.app'
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

// POST: a printer adds a pinned comment / area comment, or replies to one of this link's threads.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const admin = createSupabaseAdminClient()
  const r = await loadLink(admin, params.token)
  if (!r.link) return NextResponse.json({ error: r.error }, { status: r.status, headers: NO_STORE })
  const link = r.link
  if (!link.allow_comments) return NextResponse.json({ error: 'Comments are turned off for this link.' }, { status: 403, headers: NO_STORE })

  const b = await req.json().catch(() => ({}))
  const body = String(b.body || '').trim().slice(0, 4000)
  const author_name = String(b.author_name || '').trim().slice(0, 120)
  const author_email = String(b.author_email || '').trim().slice(0, 200)
  if (!body) return NextResponse.json({ error: 'Write a comment first.' }, { status: 400, headers: NO_STORE })
  if (!author_name) return NextResponse.json({ error: 'Please enter your name.' }, { status: 400, headers: NO_STORE })

  const row: any = { design_id: link.design_id, share_link_id: link.id, body, author_name, author_email: author_email || null, author_type: 'printer' }
  if (b.parent_id) {
    const { data: parent } = await admin.from('packaging_comments').select('id, design_id, share_link_id, parent_id').eq('id', b.parent_id).maybeSingle()
    if (!parent || parent.design_id !== link.design_id || parent.share_link_id !== link.id || parent.parent_id) return NextResponse.json({ error: 'Invalid thread.' }, { status: 400, headers: NO_STORE })
    row.parent_id = parent.id
  } else {
    const x = num(b.x), y = num(b.y)
    if (x === null || y === null) return NextResponse.json({ error: 'Click on the artwork to place your comment.' }, { status: 400, headers: NO_STORE })
    const { data: maxRow } = await admin.from('packaging_comments').select('pin_no').eq('design_id', link.design_id).not('pin_no', 'is', null).order('pin_no', { ascending: false }).limit(1)
    row.pin_no = ((maxRow?.[0] as any)?.pin_no || 0) + 1
    row.x = x; row.y = y; row.w = num(b.w); row.h = num(b.h)
  }
  const { data, error } = await admin.from('packaging_comments').insert(row).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })

  try { await admin.from('packaging_activity').insert({ design_id: link.design_id, share_link_id: link.id, actor_type: 'printer', actor_name: author_name, actor_email: author_email || null, action: row.parent_id ? 'reply' : 'comment', details: { pin: row.pin_no || null, text: body.slice(0, 300) } }) } catch { /* best effort */ }
  // notify the team: ERP bell + email
  const { data: design } = await admin.from('packaging_designs').select('id, name, sku, customer_name, created_by, updated_by').eq('id', link.design_id).maybeSingle()
  const recipients = Array.from(new Set([...PACKAGING_TEAM, design?.created_by, design?.updated_by, link.created_by]
    .filter((e): e is string => !!e && ALLOWED.test(e)).map(e => e.toLowerCase())))
  if (recipients.length && design) {
    const who = link.printer_company || 'Printer'
    const title = `${who} ${row.parent_id ? 'replied' : 'commented'} on ${design.name}`
    const url = `${ERP_URL}/packaging/${design.id}`
    await admin.from('notifications').insert(recipients.map(email => ({
      recipient_email: email, sender_email: author_email || null, type: 'info', is_read: false,
      title, message: `${author_name}: ${body.slice(0, 180)}`, page: 'Packaging Design', record_type: 'packaging_design', record_id: design.id,
      context_url: `/packaging/${design.id}`,
    })))
    if (process.env.RESEND_API_KEY) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY)
        const meta = [design.customer_name, design.sku].filter(Boolean).join(' · ')
        await resend.emails.send({
          from: 'beyondGREEN ERP <erp@beyondgreenbiotech.com>',
          to: recipients,
          subject: `[Packaging] ${title}`,
          html: `<!DOCTYPE html><html><body style="margin:0;background:#F5F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:560px;margin:32px auto;background:#fff;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden">
  <div style="background:#111827;padding:20px 28px;color:#fff"><span style="display:inline-block;background:#2ABF06;border-radius:6px;padding:4px 8px;font-weight:700;font-size:13px">bG</span>
    <span style="font-weight:700;font-size:16px;margin-left:10px">Packaging Design · Printer feedback</span></div>
  <div style="padding:26px 28px">
    <p style="margin:0 0 4px;color:#6B7280;font-size:13px">${esc(meta || 'Packaging design')}</p>
    <h2 style="margin:0 0 18px;font-size:19px;color:#111827">${esc(title)}</h2>
    <div style="border-left:4px solid #8B5CF6;background:#F9FAFB;border-radius:8px;padding:14px 16px;margin-bottom:22px">
      <p style="margin:0 0 6px;font-size:12px;color:#6B7280"><b style="color:#374151">${esc(author_name)}</b>${author_email ? ' · ' + esc(author_email) : ''}${row.pin_no ? ' · Pin #' + row.pin_no : ''}</p>
      <p style="margin:0;font-size:15px;line-height:1.55;color:#111827;white-space:pre-wrap">${esc(body)}</p>
    </div>
    <a href="${url}" style="display:inline-block;background:#3B6FE0;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px">Open in the ERP &amp; reply</a>
  </div>
  <div style="padding:14px 28px;border-top:1px solid #F3F4F6;color:#9CA3AF;font-size:12px">Sent by the beyondGREEN ERP to the packaging team.</div>
</div></body></html>`,
        })
      } catch (e) { console.error('packaging comment email failed', e) }
    }
  }
  return NextResponse.json({ comment: { ...data } }, { headers: NO_STORE })
}
