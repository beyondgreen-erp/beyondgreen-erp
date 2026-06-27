// Microsoft 365 / Outlook (Microsoft Graph) helper.
// Sends outreach through the user's own mailbox (so it lands in their Sent folder)
// and supports reading the inbox to auto-detect replies.
//
// Env required (set in Vercel): AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_CLIENT_SECRET.
// Optional: AZURE_REDIRECT_URI (defaults to the production callback URL).
import { createClient } from '@supabase/supabase-js'

const TENANT = process.env.AZURE_TENANT_ID || ''
const CLIENT_ID = process.env.AZURE_CLIENT_ID || ''
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || ''
export const OUTLOOK_REDIRECT_URI =
  process.env.AZURE_REDIRECT_URI || 'https://beyondgreen-erp.vercel.app/api/outlook/callback'
export const OUTLOOK_SCOPES = 'openid profile offline_access User.Read Mail.Send Mail.Read'

export function outlookConfigured(): boolean {
  return Boolean(TENANT && CLIENT_ID && CLIENT_SECRET)
}

function tokenEndpoint(): string {
  return `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`
}

export function authorizeUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: OUTLOOK_REDIRECT_URI,
    response_mode: 'query',
    scope: OUTLOOK_SCOPES,
    state,
  })
  return `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize?${p.toString()}`
}

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function exchangeCodeForTokens(code: string): Promise<any> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code,
    redirect_uri: OUTLOOK_REDIRECT_URI,
    grant_type: 'authorization_code',
    scope: OUTLOOK_SCOPES,
  })
  const r = await fetch(tokenEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  return r.json()
}

async function refreshTokens(refresh_token: string): Promise<any> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token,
    grant_type: 'refresh_token',
    scope: OUTLOOK_SCOPES,
  })
  const r = await fetch(tokenEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  return r.json()
}

// Returns a valid Graph access token for the given ERP user's connected mailbox, or null.
export async function getOutlookAccessToken(userEmail: string): Promise<string | null> {
  if (!outlookConfigured() || !userEmail) return null
  const sb = admin()
  const { data: conn } = await sb
    .from('user_email_connections')
    .select('*')
    .eq('provider', 'microsoft')
    .ilike('email', userEmail)
    .limit(1)
    .maybeSingle()
  if (!conn) return null

  const exp = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0
  if (conn.access_token && exp - Date.now() > 120000) return conn.access_token
  if (!conn.refresh_token) return null

  const t = await refreshTokens(conn.refresh_token)
  if (!t.access_token) return null
  await sb
    .from('user_email_connections')
    .update({
      access_token: t.access_token,
      refresh_token: t.refresh_token || conn.refresh_token,
      token_expires_at: new Date(Date.now() + (t.expires_in || 3600) * 1000).toISOString(),
    })
    .eq('id', conn.id)
  return t.access_token
}

export async function getMe(accessToken: string): Promise<any> {
  const r = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  return r.json()
}

// Send an HTML email via Graph as the signed-in user. saveToSentItems => appears in Sent.
export async function sendViaGraph(
  accessToken: string,
  opts: { to: string; subject: string; html: string }
): Promise<boolean> {
  const payload = {
    message: {
      subject: opts.subject,
      body: { contentType: 'HTML', content: opts.html },
      toRecipients: [{ emailAddress: { address: opts.to } }],
    },
    saveToSentItems: true,
  }
  const r = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (r.status !== 202 && !r.ok) {
    const txt = await r.text()
    throw new Error(`Graph sendMail failed: ${r.status} ${txt}`)
  }
  return true
}

// Look for a reply from `fromAddress` received after `sinceIso`. Returns true if found.
export async function inboxHasReplyFrom(
  accessToken: string,
  fromAddress: string,
  sinceIso: string
): Promise<boolean> {
  const filter = `receivedDateTime ge ${sinceIso} and from/emailAddress/address eq '${fromAddress.replace(/'/g, "''")}'`
  const url =
    `https://graph.microsoft.com/v1.0/me/messages?$select=id,receivedDateTime&$top=1&$filter=` +
    encodeURIComponent(filter)
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, ConsistencyLevel: 'eventual' },
  })
  if (!r.ok) return false
  const j = await r.json()
  return Array.isArray(j.value) && j.value.length > 0
}
