// GET /api/outlook/callback — Microsoft redirects here after the user authorizes.
// Exchanges the code for tokens and stores them against the logged-in ERP user.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase'
import { exchangeCodeForTokens, getMe } from '@/lib/outlook'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const origin = url.origin
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const oauthErr = url.searchParams.get('error')

  if (oauthErr) return NextResponse.redirect(`${origin}/settings/email?outlook=error`)
  if (!code) return NextResponse.redirect(`${origin}/settings/email?outlook=error`)

  const cookieState = req.cookies.get('ms_oauth_state')?.value
  if (!cookieState || cookieState !== state) {
    return NextResponse.redirect(`${origin}/settings/email?outlook=state_mismatch`)
  }

  const sb = await createSupabaseServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.redirect(`${origin}/login`)

  const tokens = await exchangeCodeForTokens(code)
  if (!tokens || !tokens.access_token) {
    return NextResponse.redirect(`${origin}/settings/email?outlook=token_error`)
  }

  const me = await getMe(tokens.access_token)
  const mailbox = String(me.mail || me.userPrincipalName || user.email || '').toLowerCase()

  // If the connect flow pinned a specific mailbox, make sure Microsoft actually returned
  // that identity. If a different signed-in session was used, reject instead of silently
  // saving the wrong mailbox.
  const wanted = (req.cookies.get('ms_oauth_hint')?.value || '').trim().toLowerCase()
  if (wanted && mailbox !== wanted) {
    const bad = NextResponse.redirect(
      `${origin}/settings/email?outlook=wrong_account&got=${encodeURIComponent(mailbox)}&wanted=${encodeURIComponent(wanted)}`
    )
    bad.cookies.set('ms_oauth_state', '', { maxAge: 0, path: '/' })
    bad.cookies.set('ms_oauth_hint', '', { maxAge: 0, path: '/' })
    return bad
  }

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  // Keep other connected mailboxes; only refresh this same address if reconnecting.
  await adminClient
    .from('user_email_connections')
    .delete()
    .eq('user_id', user.id)
    .eq('provider', 'microsoft')
    .eq('email', mailbox)
  await adminClient.from('user_email_connections').insert({
    user_id: user.id,
    email: mailbox,
    provider: 'microsoft',
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || null,
    token_expires_at: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
    connected_at: new Date().toISOString(),
  })

  const res = NextResponse.redirect(`${origin}/settings/email?outlook=connected`)
  res.cookies.set('ms_oauth_state', '', { maxAge: 0, path: '/' })
  res.cookies.set('ms_oauth_hint', '', { maxAge: 0, path: '/' })
  return res
}
