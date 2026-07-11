// POST /api/outlook/disconnect { email } — removes one connected mailbox for the logged-in user.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const sb = await createSupabaseServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { email } = (await req.json().catch(() => ({}))) as { email?: string }
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  await admin.from('user_email_connections').delete().eq('user_id', user.id).eq('provider', 'microsoft').ilike('email', email)
  return NextResponse.json({ ok: true })
}
