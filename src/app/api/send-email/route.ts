import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createSupabaseServerClient } from '@/lib/supabase'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM_EMAIL = process.env.FROM_EMAIL || 'erp@beyondgreenbiotech.com'
const FROM_NAME = process.env.FROM_NAME || 'beyondGREEN ERP'

// Company domains. Unauthenticated callers (legacy edge functions on the cron) may only
// reach these — anything external needs a signed-in user or the internal key.
const INTERNAL_DOMAINS = ['beyondgreenbiotech.com', 'byndgrn.com']

/* ──────────────────────────────────────────────────────────────────────────
   Who may send?
   1. Server-to-server: header x-erp-key equal to erp_config.internal_key
      (DB triggers via pg_net, edge functions). Key is cached for 5 minutes.
   2. A signed-in ERP user (session cookie).
   3. Legacy: no credentials but every recipient is on a company domain.
   Everything else is refused — this endpoint used to be fully open.
   ────────────────────────────────────────────────────────────────────────── */
let keyCache: { value: string | null; at: number } = { value: null, at: 0 }
async function internalKey(): Promise<string | null> {
  if (keyCache.value && Date.now() - keyCache.at < 5 * 60_000) return keyCache.value
  try {
    const admin = createSupabaseAdminClient()
    const { data } = await admin.from('erp_config').select('value').eq('key', 'internal_key').maybeSingle()
    keyCache = { value: data?.value || null, at: Date.now() }
  } catch { /* leave cache as-is */ }
  return keyCache.value
}
function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a), bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}
const list = (v: unknown): string[] => !v ? [] : Array.isArray(v) ? v.map(String) : [String(v)]
const isInternal = (addr: string) => {
  const m = addr.toLowerCase().match(/<([^>]+)>/)
  const e = (m ? m[1] : addr).trim().toLowerCase()
  return INTERNAL_DOMAINS.some(d => e.endsWith('@' + d))
}

async function authorize(req: NextRequest, recipients: string[]): Promise<{ ok: true; via: string } | { ok: false; status: number; error: string }> {
  const headerKey = req.headers.get('x-erp-key')
  if (headerKey) {
    const k = await internalKey()
    if (k && safeEqual(headerKey, k)) return { ok: true, via: 'internal-key' }
    return { ok: false, status: 401, error: 'Invalid internal key' }
  }
  try {
    const sb = await createSupabaseServerClient()
    const { data } = await sb.auth.getUser()
    if (data.user) return { ok: true, via: 'session:' + (data.user.email || data.user.id) }
  } catch { /* no session */ }
  if (recipients.length && recipients.every(isInternal)) {
    console.warn('[send-email] legacy unauthenticated internal send to', recipients.join(', '))
    return { ok: true, via: 'legacy-internal' }
  }
  return { ok: false, status: 401, error: 'Sign in to send email, or supply the internal key.' }
}

export async function POST(req: NextRequest) {
  try {
    if (!RESEND_API_KEY) return NextResponse.json({ error: 'Email service not configured' }, { status: 500 })
    const { to, cc, bcc, subject, html, text, reply_to, attachments } = await req.json()
    if (!to || !subject || (!html && !text)) return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })

    const recipients = [...list(to), ...list(cc), ...list(bcc)]
    const auth = await authorize(req, recipients)
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const body: Record<string, unknown> = {
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: list(to),
      subject,
    }
    if (html) body.html = html
    if (text) body.text = text
    if (cc) body.cc = list(cc)
    if (reply_to) body.reply_to = list(reply_to)
    if (Array.isArray(attachments) && attachments.length) body.attachments = attachments
    if (bcc) body.bcc = list(bcc)

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) return NextResponse.json({ error: data.message || 'Failed to send email' }, { status: res.status })
    return NextResponse.json({ success: true, id: data.id, via: auth.via })
  } catch (err) {
    console.error('[send-email]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
