/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Claude connector (remote MCP) — OAuth 2.1 helpers.
 *
 * A teammate adds the connector URL in Claude, signs in to the ERP with their own login
 * (plus the emailed device code), and clicks Approve. We then open a separate ERP session for
 * that person on the server and keep it for the connection. Every tool call runs as that person,
 * so row security, board permissions, the off-site rules and the activity logs all apply exactly
 * as if they were using the ERP themselves. Connections can be revoked in Settings ▸ Claude Connector.
 */
import { NextRequest } from 'next/server'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
export const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
export const ACCESS_TTL_S = 60 * 60            // 1 hour
export const REFRESH_TTL_S = 60 * 60 * 24 * 30 // 30 days
export const CODE_TTL_S = 5 * 60
export const ALLOWED_DOMAINS = ['beyondgreenbiotech.com', 'byndgrn.com']

/** Public base URL of the ERP for this request (e.g. https://beyondgreen-erp.vercel.app). */
export function baseUrl(req: NextRequest): string {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'beyondgreen-erp.vercel.app'
  const proto = (req.headers.get('x-forwarded-proto') || 'https').split(',')[0].trim()
  return `${proto}://${host.split(',')[0].trim()}`
}

export const sha = (s: string) => createHash('sha256').update('mcp:' + s).digest('hex')
export const newSecret = (bytes = 32) => randomBytes(bytes).toString('base64url')

function encKey() {
  return createHash('sha256').update('mcp-enc:' + (process.env.SUPABASE_SERVICE_ROLE_KEY || 'bg')).digest()
}
export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', encKey(), iv)
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return [iv.toString('base64url'), c.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.')
}
export function decrypt(blob: string): string {
  const [iv, tag, enc] = blob.split('.')
  const d = createDecipheriv('aes-256-gcm', encKey(), Buffer.from(iv, 'base64url'))
  d.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8')
}

/** Only Claude's own callback addresses (and local tools on this computer) may receive codes. */
export function redirectAllowed(uri: string): boolean {
  try {
    const u = new URL(uri)
    if (u.protocol === 'https:' && ['claude.ai', 'claude.com', 'www.claude.ai', 'www.claude.com'].includes(u.hostname)) return true
    if (u.protocol === 'https:' && u.hostname.endsWith('.anthropic.com')) return true
    if (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return true
    return false
  } catch { return false }
}

export function sessionIdOf(accessToken?: string | null): string | null {
  try {
    const p = JSON.parse(Buffer.from((accessToken || '').split('.')[1], 'base64url').toString('utf8'))
    return typeof p.session_id === 'string' ? p.session_id : null
  } catch { return null }
}

export function anonClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
}

/** Supabase client that acts as the signed-in person (row security applies). */
export function userClient(accessToken: string) {
  return createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}

/** Open a brand-new ERP session for this person (separate from their browser) and mark it verified. */
export async function openUserSession(email: string, userId: string) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error || !data?.properties?.hashed_token) throw new Error('Could not open an ERP session: ' + (error?.message || 'no token'))
  const { data: v, error: e2 } = await anonClient().auth.verifyOtp({ token_hash: data.properties.hashed_token, type: 'magiclink' })
  if (e2 || !v?.session) throw new Error('Could not open an ERP session: ' + (e2?.message || 'no session'))
  if (v.session.user.id !== userId) throw new Error('Session user mismatch')
  const sid = sessionIdOf(v.session.access_token)
  if (sid) {
    await admin.from('staff_verified_sessions').upsert({
      session_id: sid, user_id: userId, email, device_id: null, method: 'claude_connector',
      verified_at: new Date().toISOString(), revoked_at: null,
    })
  }
  return { session: v.session, sid }
}

export interface Conn { id: string; email: string; user_id: string; client_name: string | null; sbAccess: string }

/** Look up the connection behind a bearer token and return a fresh ERP access token for that person. */
export async function connectionForBearer(bearer: string | null): Promise<Conn | null> {
  if (!bearer) return null
  const admin = createSupabaseAdminClient()
  const { data: t } = await admin.from('mcp_tokens').select('*').eq('access_hash', sha(bearer)).maybeSingle()
  if (!t || t.revoked_at || new Date(t.access_expires_at).getTime() < Date.now()) return null
  const domain = String(t.email).split('@')[1]?.toLowerCase()
  if (!ALLOWED_DOMAINS.includes(domain)) return null
  const { data: prof } = await admin.from('user_profiles').select('is_active').ilike('email', t.email).maybeSingle()
  if (prof && prof.is_active === false) return null

  let sbAccess = t.sb_access_token ? decrypt(t.sb_access_token) : ''
  const exp = t.sb_access_expires_at ? new Date(t.sb_access_expires_at).getTime() : 0
  if (!sbAccess || exp - Date.now() < 90_000) {
    const { data: r, error } = await anonClient().auth.refreshSession({ refresh_token: decrypt(t.sb_refresh_enc) })
    if (error || !r?.session) return null
    sbAccess = r.session.access_token
    await admin.from('mcp_tokens').update({
      sb_access_token: encrypt(sbAccess),
      sb_access_expires_at: new Date((r.session.expires_at || Math.floor(Date.now() / 1000) + 3000) * 1000).toISOString(),
      sb_refresh_enc: encrypt(r.session.refresh_token),
    }).eq('id', t.id)
  }
  return { id: t.id, email: t.email, user_id: t.user_id, client_name: t.client_name, sbAccess }
}

/** Revoke a connection: token, its verified ERP session, and the server-side sign-in. */
export async function revokeConnection(id: string, by: string) {
  const admin = createSupabaseAdminClient()
  const { data: t } = await admin.from('mcp_tokens').select('id,sb_session_id,sb_access_token').eq('id', id).maybeSingle()
  if (!t) return false
  await admin.from('mcp_tokens').update({ revoked_at: new Date().toISOString(), revoked_by: by, refresh_hash: null }).eq('id', id)
  if (t.sb_session_id) await admin.from('staff_verified_sessions').update({ revoked_at: new Date().toISOString() }).eq('session_id', t.sb_session_id)
  try { if (t.sb_access_token) await admin.auth.admin.signOut(decrypt(t.sb_access_token), 'local') } catch { /* best effort */ }
  return true
}

export function oauthError(error: string, description: string, status = 400) {
  return new Response(JSON.stringify({ error, error_description: description }), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
  })
}
export function jsonRes(d: any, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(d), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', ...extra },
  })
}
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, WWW-Authenticate',
}
