// GET /api/outlook/connect — starts the Microsoft sign-in so the logged-in ERP user
// can authorize the app to send mail from their mailbox.
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase'
import { authorizeUrl, outlookConfigured } from '@/lib/outlook'

export async function GET(req: NextRequest) {
  const origin = new URL(req.url).origin
  if (!outlookConfigured()) {
    return NextResponse.redirect(`${origin}/sales/customers?outlook=not_configured`)
  }

  const sb = await createSupabaseServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) {
    return NextResponse.redirect(`${origin}/login`)
  }

  const state = crypto.randomUUID()
  const res = NextResponse.redirect(authorizeUrl(state))
  res.cookies.set('ms_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })
  return res
}
