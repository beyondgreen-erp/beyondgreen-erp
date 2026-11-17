/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { jsonRes, oauthError, redirectAllowed, newSecret, CORS } from '@/lib/mcp/oauth'
export const dynamic = 'force-dynamic'

/** Dynamic client registration (RFC 7591). Only Claude callback addresses are accepted. */
export async function POST(req: NextRequest) {
  let body: any = {}
  try { body = await req.json() } catch { return oauthError('invalid_client_metadata', 'Body must be JSON') }
  const uris: string[] = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : []
  if (!uris.length) return oauthError('invalid_redirect_uri', 'redirect_uris is required')
  const bad = uris.find(u => !redirectAllowed(u))
  if (bad) return oauthError('invalid_redirect_uri', 'Redirect address not allowed: ' + bad)
  const client_id = 'bgc_' + newSecret(18)
  const client_name = String(body.client_name || 'Claude').slice(0, 120)
  const admin = createSupabaseAdminClient()
  const { error } = await admin.from('mcp_clients').insert({ client_id, client_name, redirect_uris: uris })
  if (error) return oauthError('server_error', error.message, 500)
  return jsonRes({
    client_id, client_name, redirect_uris: uris,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }, 201)
}
export async function OPTIONS() { return new Response(null, { status: 204, headers: CORS }) }
