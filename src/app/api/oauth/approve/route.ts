/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Called by the ERP "Allow Claude?" page. Needs the person's normal, device-verified ERP login.
 * GET  ?client_id&redirect_uri  -> who is signed in + which app is asking
 * POST {client_id, redirect_uri, code_challenge, code_challenge_method, state, scope, decision}
 *      -> { redirect } back to Claude with ?code= (or ?error=access_denied)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { createSupabaseServerClient } from '@/lib/supabase'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { ALLOWED_DOMAINS, CODE_TTL_S, newSecret, sha, sessionIdOf } from '@/lib/mcp/oauth'
export const dynamic = 'force-dynamic'

const json = (d: any, status = 200) => NextResponse.json(d, { status })

async function signedIn(req: NextRequest) {
  const sb = await createSupabaseServerClient()
  const { data: u } = await sb.auth.getUser()
  if (!u.user?.email) return null
  const email = u.user.email.toLowerCase()
  if (!ALLOWED_DOMAINS.includes(email.split('@')[1] || '')) return null
  // Same device check as the rest of the ERP (bg_sv cookie bound to this session).
  const { data: s } = await sb.auth.getSession()
  const sid = sessionIdOf(s.session?.access_token)
  const sv = req.cookies.get('bg_sv')?.value || ''
  const sig = createHmac('sha256', process.env.SUPABASE_SERVICE_ROLE_KEY || 'bg').update('sv:' + sid).digest('hex')
  if (!sid || sv !== `${sid}.${sig}`) return { id: u.user.id, email, verified: false }
  return { id: u.user.id, email, verified: true }
}

async function client(client_id: string, redirect_uri: string) {
  const admin = createSupabaseAdminClient()
  const { data } = await admin.from('mcp_clients').select('client_id,client_name,redirect_uris').eq('client_id', client_id).maybeSingle()
  if (!data || !(data.redirect_uris || []).includes(redirect_uri)) return null
  return data
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const me = await signedIn(req)
  if (!me) return json({ error: 'not_signed_in' }, 401)
  const c = await client(p.get('client_id') || '', p.get('redirect_uri') || '')
  if (!c) return json({ error: 'This connection request is not valid. Remove the connector in Claude and add it again.' }, 400)
  return json({ email: me.email, verified: me.verified, client_name: c.client_name })
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({} as any))
  const me = await signedIn(req)
  if (!me) return json({ error: 'not_signed_in' }, 401)
  if (!me.verified) return json({ error: 'Please confirm this device first (emailed code), then try again.' }, 403)
  const c = await client(String(b.client_id || ''), String(b.redirect_uri || ''))
  if (!c) return json({ error: 'This connection request is not valid.' }, 400)
  const ru = new URL(String(b.redirect_uri))
  if (b.state) ru.searchParams.set('state', String(b.state))
  if (b.decision !== 'allow') {
    ru.searchParams.set('error', 'access_denied')
    return json({ redirect: ru.toString() })
  }
  if (String(b.code_challenge_method || 'S256') !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(String(b.code_challenge || ''))) {
    return json({ error: 'Missing or invalid PKCE code challenge.' }, 400)
  }
  const code = newSecret(32)
  const admin = createSupabaseAdminClient()
  const { error } = await admin.from('mcp_auth_codes').insert({
    code_hash: sha(code), client_id: c.client_id, user_id: me.id, email: me.email,
    redirect_uri: String(b.redirect_uri), code_challenge: String(b.code_challenge), scope: String(b.scope || 'erp'),
    expires_at: new Date(Date.now() + CODE_TTL_S * 1000).toISOString(),
  })
  if (error) return json({ error: error.message }, 500)
  ru.searchParams.set('code', code)
  return json({ redirect: ru.toString() })
}
