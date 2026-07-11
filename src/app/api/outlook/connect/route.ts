// GET /api/outlook/connect — starts the Microsoft sign-in so the logged-in ERP user
// can authorize the app to send mail from their mailbox.
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase'
import { authorizeUrl, outlookConfigured } from '@/lib/outlook'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const origin = url.origin
  if (!outlookConfigured()) {
    return NextResponse.redirect(`${origin}/settings/email?outlook=not_configured`)
  }

  const sb = await createSupabaseServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) {
    return NextResponse.redirect(`${origin}/login`)
  }

  // Optional: ?hint=address pins Microsoft to a specific mailbox so it can't return
  // another signed-in session's token. The callback verifies the result matches.
  const hint = (url.searchParams.get('hint') || '').trim().toLowerCase()

  const state = crypto.randomUUID()
  const res = NextResponse.redirect(authorizeUrl(state, hint || undefined))
  res.cookies.set('ms_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })
  if (hint) {
    res.cookies.set('ms_oauth_hint', hint, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 600,
      path: '/',
    })
  }
  return res
}
