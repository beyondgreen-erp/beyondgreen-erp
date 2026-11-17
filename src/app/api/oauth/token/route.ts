/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest } from 'next/server'
import { createHash } from 'crypto'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import {
  ACCESS_TTL_S, REFRESH_TTL_S, CORS, encrypt, jsonRes, newSecret, oauthError, openUserSession, revokeConnection, sha,
} from '@/lib/mcp/oauth'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function params(req: NextRequest): Promise<Record<string, string>> {
  const ct = req.headers.get('content-type') || ''
  if (ct.includes('application/json')) { const j = await req.json().catch(() => ({})); return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, String(v)])) }
  const t = await req.text()
  return Object.fromEntries(new URLSearchParams(t))
}

function pkceOk(verifier: string, challenge: string) {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false
  return createHash('sha256').update(verifier).digest('base64url') === challenge
}

export async function POST(req: NextRequest) {
  const p = await params(req)
  const admin = createSupabaseAdminClient()

  // Token revocation (RFC 7009) shares this endpoint: POST token=... with no grant_type.
  if (!p.grant_type && p.token) {
    const h = sha(p.token)
    const { data: t } = await admin.from('mcp_tokens').select('id').or(`access_hash.eq.${h},refresh_hash.eq.${h}`).maybeSingle()
    if (t) await revokeConnection(t.id, 'client')
    return new Response(null, { status: 200, headers: CORS })
  }

  if (p.grant_type === 'authorization_code') {
    const { data: c } = await admin.from('mcp_auth_codes').select('*').eq('code_hash', sha(p.code || '')).maybeSingle()
    if (!c || c.used_at || new Date(c.expires_at).getTime() < Date.now()) return oauthError('invalid_grant', 'Code is invalid or expired')
    await admin.from('mcp_auth_codes').update({ used_at: new Date().toISOString() }).eq('code_hash', c.code_hash)
    if (p.client_id && p.client_id !== c.client_id) return oauthError('invalid_grant', 'Client mismatch')
    if (p.redirect_uri && p.redirect_uri !== c.redirect_uri) return oauthError('invalid_grant', 'Redirect mismatch')
    if (!pkceOk(p.code_verifier || '', c.code_challenge)) return oauthError('invalid_grant', 'PKCE check failed')

    let sess
    try { sess = await openUserSession(c.email, c.user_id) } catch (e: any) { return oauthError('server_error', e.message, 500) }
    const { data: cl } = await admin.from('mcp_clients').select('client_name').eq('client_id', c.client_id).maybeSingle()
    const access = 'bga_' + newSecret(32), refresh = 'bgr_' + newSecret(32)
    const { error } = await admin.from('mcp_tokens').insert({
      client_id: c.client_id, client_name: cl?.client_name || 'Claude', user_id: c.user_id, email: c.email,
      access_hash: sha(access), access_expires_at: new Date(Date.now() + ACCESS_TTL_S * 1000).toISOString(),
      refresh_hash: sha(refresh), refresh_expires_at: new Date(Date.now() + REFRESH_TTL_S * 1000).toISOString(),
      sb_session_id: sess.sid, sb_access_token: encrypt(sess.session.access_token),
      sb_access_expires_at: new Date((sess.session.expires_at || 0) * 1000).toISOString(),
      sb_refresh_enc: encrypt(sess.session.refresh_token),
    })
    if (error) return oauthError('server_error', error.message, 500)
    return jsonRes({ access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: c.scope || 'erp' })
  }

  if (p.grant_type === 'refresh_token') {
    const { data: t } = await admin.from('mcp_tokens').select('*').eq('refresh_hash', sha(p.refresh_token || '')).maybeSingle()
    if (!t || t.revoked_at || !t.refresh_expires_at || new Date(t.refresh_expires_at).getTime() < Date.now()) return oauthError('invalid_grant', 'Refresh token is invalid, expired or revoked')
    if (p.client_id && p.client_id !== t.client_id) return oauthError('invalid_grant', 'Client mismatch')
    const access = 'bga_' + newSecret(32), refresh = 'bgr_' + newSecret(32)
    await admin.from('mcp_tokens').update({
      access_hash: sha(access), access_expires_at: new Date(Date.now() + ACCESS_TTL_S * 1000).toISOString(),
      refresh_hash: sha(refresh), refresh_expires_at: new Date(Date.now() + REFRESH_TTL_S * 1000).toISOString(),
    }).eq('id', t.id)
    return jsonRes({ access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: 'erp' })
  }

  return oauthError('unsupported_grant_type', 'Use authorization_code or refresh_token')
}
export async function OPTIONS() { return new Response(null, { status: 204, headers: CORS }) }
