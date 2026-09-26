/* eslint-disable @typescript-eslint/no-explicit-any */
// POST: printer-side events the portal reports (file downloads).
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { loadLink } from '@/lib/packaging/proofServer'
import { log } from '@/lib/packaging/approvalServer'

export const dynamic = 'force-dynamic'
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const admin = createSupabaseAdminClient()
  const r = await loadLink(admin, params.token)
  if (!r.link) return NextResponse.json({ error: r.error }, { status: r.status })
  const b = await req.json().catch(() => ({}))
  if (b.action !== 'downloaded') return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  await log(admin, { design_id: r.link.design_id, share_link_id: r.link.id, actor_type: 'printer', actor_name: String(b.name || '').slice(0, 120) || null, actor_email: String(b.email || '').slice(0, 200) || null, action: 'downloaded', details: { file: String(b.file || '').slice(0, 300), kind: String(b.kind || '').slice(0, 40) } })
  return NextResponse.json({ ok: true })
}
