// GET /api/outlook/status — returns the Microsoft mailbox connected for the logged-in ERP user.
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase'
import { outlookConfigured } from '@/lib/outlook'

export const dynamic = 'force-dynamic'

export async function GET() {
  const sb = await createSupabaseServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ connected: false, configured: outlookConfigured() })
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data } = await admin.from('user_email_connections')
    .select('email, connected_at, is_protected, is_outreach_default').eq('user_id', user.id).eq('provider', 'microsoft').order('connected_at', { ascending: false })
  const mailboxes = data || []
  return NextResponse.json({ connected: mailboxes.length > 0, configured: outlookConfigured(), mailboxes })
}
