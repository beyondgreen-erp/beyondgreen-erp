import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const revalidate = 0
const NO_STORE = { 'Cache-Control': 'no-store' }
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })

async function checkSecret(req: NextRequest): Promise<boolean> {
  const given = req.nextUrl.searchParams.get('secret') || req.headers.get('x-bridge-secret') || ''
  if (!given) return false
  const { data } = await admin.from('erp_settings').select('value').eq('key', 'whatsapp_bridge_secret').maybeSingle()
  return !!(data as any)?.value && given === (data as any).value
}

// GET: the bridge pulls pending messages to post to the group.
export async function GET(req: NextRequest) {
  if (!(await checkSecret(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE })
  const { data } = await admin.from('whatsapp_outbox').select('id, body, target, kind').eq('status', 'pending').order('created_at').limit(25)
  return NextResponse.json({ messages: (data as any[]) || [] }, { headers: NO_STORE })
}

// POST: the bridge reports results. { id, status: 'sent'|'failed', error? }  (or { ids:[...], status })
export async function POST(req: NextRequest) {
  if (!(await checkSecret(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE })
  const body = await req.json().catch(() => ({}))
  const ids: string[] = body.ids || (body.id ? [body.id] : [])
  if (!ids.length) return NextResponse.json({ error: 'id(s) required' }, { status: 400, headers: NO_STORE })
  const status = body.status === 'failed' ? 'failed' : 'sent'
  const patch: any = { status, error: body.error ? String(body.error).slice(0, 300) : null }
  if (status === 'sent') patch.sent_at = new Date().toISOString()
  const { error } = await admin.from('whatsapp_outbox').update(patch).in('id', ids)
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })
  return NextResponse.json({ ok: true, updated: ids.length }, { headers: NO_STORE })
}
