import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

// Every weekly-report route needs a signed-in ERP user; data access then uses the admin client.
export async function requireUser(): Promise<{ email: string; admin: ReturnType<typeof createSupabaseAdminClient> } | NextResponse> {
  try {
    const sb = await createSupabaseServerClient()
    const { data } = await sb.auth.getUser()
    if (data.user?.email) return { email: data.user.email, admin: createSupabaseAdminClient() }
  } catch { /* no session */ }
  return NextResponse.json({ error: 'Sign in to use the Walmart weekly report.' }, { status: 401 })
}
export const isResp = (x: unknown): x is NextResponse => x instanceof NextResponse
