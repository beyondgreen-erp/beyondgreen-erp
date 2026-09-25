/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { loadLink } from '@/lib/packaging/proofServer'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' }
const num = (v: any) => (v === null || v === undefined || v === '' || !isFinite(Number(v))) ? null : Math.round(Number(v) * 100) / 100
const ALLOWED = /@(beyondgreenbiotech\.com|byndgrn\.com)$/i

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

  // notify the team
  const { data: design } = await admin.from('packaging_designs').select('id, name, created_by, updated_by').eq('id', link.design_id).maybeSingle()
  const recipients = Array.from(new Set([design?.created_by, design?.updated_by, link.created_by].filter((e): e is string => !!e && ALLOWED.test(e))))
  if (recipients.length && design) {
    await admin.from('notifications').insert(recipients.map(email => ({
      recipient_email: email, sender_email: author_email || null, type: 'info', is_read: false,
      title: `${link.printer_company || 'Printer'} ${row.parent_id ? 'replied' : 'commented'} on ${design.name}`,
      message: `${author_name}: ${body.slice(0, 180)}`, page: 'Packaging Design', record_type: 'packaging_design', record_id: design.id,
      context_url: `/packaging/${design.id}`,
    })))
  }
  return NextResponse.json({ comment: { ...data } }, { headers: NO_STORE })
}
