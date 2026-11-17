/* eslint-disable @typescript-eslint/no-explicit-any */
/** Settings ▸ Claude Connector: list and disconnect Claude connections (own; admins see everyone's). */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { revokeConnection } from '@/lib/mcp/oauth'
export const dynamic = 'force-dynamic'

async function me() {
  const sb = await createSupabaseServerClient()
  const { data } = await sb.auth.getUser()
  const email = data.user?.email?.toLowerCase()
  if (!email) return null
  const admin = createSupabaseAdminClient()
  const { data: isAdmin } = await admin.rpc('erp_is_admin', { p_email: email })
  return { email, isAdmin: !!isAdmin }
}

export async function GET() {
  const u = await me()
  if (!u) return NextResponse.json({ error: 'not_signed_in' }, { status: 401 })
  const admin = createSupabaseAdminClient()
  let q = admin.from('mcp_tokens').select('id,email,client_name,created_at,last_used_at,last_tool,call_count,revoked_at,revoked_by,refresh_expires_at').order('created_at', { ascending: false }).limit(200)
  if (!u.isAdmin) q = q.ilike('email', u.email)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ me: u.email, isAdmin: u.isAdmin, connections: data })
}

export async function POST(req: NextRequest) {
  const u = await me()
  if (!u) return NextResponse.json({ error: 'not_signed_in' }, { status: 401 })
  const { id } = await req.json().catch(() => ({} as any))
  const admin = createSupabaseAdminClient()
  const { data: t } = await admin.from('mcp_tokens').select('id,email').eq('id', String(id || '')).maybeSingle()
  if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!u.isAdmin && t.email.toLowerCase() !== u.email) return NextResponse.json({ error: 'You can only disconnect your own connections.' }, { status: 403 })
  await revokeConnection(t.id, u.email)
  return NextResponse.json({ ok: true })
}
