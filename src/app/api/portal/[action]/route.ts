import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import crypto from 'crypto'
import { clientStage, type StageTone } from '@/lib/portalStages'

const STAFF_DOMAINS = ['beyondgreenbiotech.com', 'byndgrn.com']

export const dynamic = 'force-dynamic'
export const revalidate = 0

/* eslint-disable @typescript-eslint/no-explicit-any */

const COOKIE = 'bg_portal'
const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://beyondgreen-erp.vercel.app'
const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM_EMAIL = process.env.FROM_EMAIL || 'erp@beyondgreenbiotech.com'
const NOTIFY = 'Rudyp@beyondgreenbiotech.com'
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Client-facing statuses that are worth emailing a client about.
const MILESTONES = new Set<string>([
  'Order Confirmed', 'In Production', 'Ready to Ship', 'Ready for Pickup',
  'Partially Shipped', 'Shipped', 'Delivered', 'Completed', 'Quote Sent', 'Accepted',
])

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

interface PortalClient { id: string; customer_id: string | null; name: string | null; company_name: string | null; email: string }

async function clientFromRequest(req: NextRequest): Promise<PortalClient | null> {
  const token = req.cookies.get(COOKIE)?.value
  if (!token) return null
  const { data: sess } = await admin.from('portal_sessions').select('portal_client_id, expires_at').eq('token', token).maybeSingle()
  if (!sess) return null
  if (new Date((sess as any).expires_at).getTime() < Date.now()) { await admin.from('portal_sessions').delete().eq('token', token); return null }
  const { data: c } = await admin.from('portal_clients').select('id, customer_id, name, company_name, email, is_active').eq('id', (sess as any).portal_client_id).maybeSingle()
  if (!c || !(c as any).is_active) return null
  return c as any
}

async function staffEmail(req: NextRequest): Promise<string | null> {
  const supa = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll() { return req.cookies.getAll() }, setAll() {} },
  })
  const { data: { user } } = await supa.auth.getUser()
  const domain = user?.email?.split('@')[1]?.toLowerCase() || ''
  if (!user || !STAFF_DOMAINS.includes(domain)) return null
  return user.email || null
}

async function companyName(client: PortalClient): Promise<string | null> {
  if (client.company_name) return client.company_name
  if (client.customer_id) {
    const { data } = await admin.from('customers').select('company_name').eq('id', client.customer_id).maybeSingle()
    return (data as any)?.company_name || null
  }
  return null
}

// ── Email helpers ─────────────────────────────────────────────
function shell(inner: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;border:1px solid #ECEEF3;border-radius:12px;overflow:hidden">`
    + `<div style="background:#037f4c;padding:16px 22px"><span style="color:#ffffff;font-weight:700;font-size:16px">beyondGREEN</span></div>`
    + `<div style="padding:22px;color:#1A1D2E">${inner}</div>`
    + `<div style="padding:0 22px 20px"><p style="margin:0;font-size:12px;color:#9ca3af">beyondGREEN Biotech · This is a private link for your account. Questions? Just reply to this email.</p></div></div>`
}

// Always CC Rudyp on every client-facing email.
async function sendClientEmail(to: string, subject: string, inner: string): Promise<boolean> {
  if (!RESEND_API_KEY || !to) return false
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `beyondGREEN <${FROM_EMAIL}>`, to: [to], cc: [NOTIFY], reply_to: [NOTIFY], subject, html: shell(inner) }),
    })
    return res.ok
  } catch { return false }
}

function accessEmailInner(name: string | null, company: string | null, link: string): string {
  return `<p style="margin:0 0 10px;font-size:17px;font-weight:700">Your project portal is ready</p>`
    + `<p style="margin:0 0 14px;font-size:14px;line-height:1.6">Hi ${esc(name || company || 'there')} — we've set up a private portal where you can track your beyondGREEN projects and message us anytime.</p>`
    + `<p style="margin:0 0 16px;font-size:14px;line-height:1.6">Click below to set your password and sign in. This link expires in 48 hours.</p>`
    + `<div style="margin:0 0 18px"><a href="${esc(link)}" style="display:inline-block;background:#037f4c;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;font-size:14px;font-weight:600">Set my password</a></div>`
    + `<p style="margin:0;font-size:12px;color:#6b7280">Or paste this link into your browser:<br><span style="color:#037f4c">${esc(link)}</span></p>`
}

function milestoneEmailInner(project: string, prevLabel: string | null, label: string): string {
  const chip = (t: string, on: boolean) => `<span style="display:inline-block;background:${on ? '#E4F7EE' : '#EEF0F4'};color:${on ? '#037f4c' : '#5A6E8A'};font-size:13px;font-weight:${on ? 600 : 400};padding:5px 12px;border-radius:20px">${esc(t)}</span>`
  const flow = prevLabel && prevLabel !== label
    ? `${chip(prevLabel, false)} <span style="color:#9ca3af">&rarr;</span> ${chip(label, true)}`
    : chip(label, true)
  return `<p style="margin:0 0 4px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#9ca3af">Project update</p>`
    + `<p style="margin:0 0 14px;font-size:17px;font-weight:700">${esc(project)}</p>`
    + `<div style="margin:0 0 16px">${flow}</div>`
    + `<p style="margin:0 0 18px;font-size:14px;line-height:1.6">Your project has moved to <strong>${esc(label)}</strong>. You can see the full timeline anytime in your portal.</p>`
    + `<div style="margin:0"><a href="${SITE}/portal" style="display:inline-block;background:#037f4c;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;font-size:14px;font-weight:600">View progress</a></div>`
}

export async function GET(req: NextRequest, { params }: { params: { action: string } }) {
  // Staff-only: open the real client portal as a given client (preview via a short-lived session).
  if (params.action === 'impersonate') {
    const email = await staffEmail(req)
    if (!email) return NextResponse.redirect(new URL('/login', req.url))
    const clientId = req.nextUrl.searchParams.get('clientId') || ''
    const { data: c } = await admin.from('portal_clients').select('id').eq('id', clientId).maybeSingle()
    if (!c) return NextResponse.json({ error: 'client not found' }, { status: 404 })
    const token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '')
    await admin.from('portal_sessions').insert({ token, portal_client_id: clientId, expires_at: new Date(Date.now() + 1000 * 60 * 60 * 2).toISOString() })
    const res = NextResponse.redirect(new URL('/portal', req.url))
    res.cookies.set(COOKIE, token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 2 })
    return res
  }

  if (params.action !== 'me') return NextResponse.json({ error: 'not found' }, { status: 404 })
  const client = await clientFromRequest(req)
  if (!client) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const company = await companyName(client)
  const projects: any[] = []

  if (client.customer_id) {
    const [{ data: sos }, { data: qs }] = await Promise.all([
      admin.from('sales_orders').select('id, order_number, po_number, status, client_portal_name, created_at, updated_at').eq('customer_id', client.customer_id).eq('client_portal_visible', true),
      admin.from('quotations').select('id, quote_number, type, status, client_portal_name, created_at, updated_at').eq('customer_id', client.customer_id).eq('client_portal_visible', true).eq('is_active', true),
    ])
    const soList = (sos || []) as any[]
    const qList = (qs || []) as any[]
    const soIds = soList.map(o => o.id)
    const qIds = qList.map(q => q.id)

    const histMap: Record<string, any[]> = {}
    const collect = (rows: any[]) => rows.forEach((h: any) => { const k = h.source_type + ':' + h.source_id; if (!histMap[k]) histMap[k] = []; histMap[k].push(h) })
    if (soIds.length) { const { data } = await admin.from('portal_status_history').select('source_type, source_id, status, created_at').eq('source_type', 'sales_order').in('source_id', soIds).order('created_at', { ascending: true }); collect(data || []) }
    if (qIds.length) { const { data } = await admin.from('portal_status_history').select('source_type, source_id, status, created_at').eq('source_type', 'quotation').in('source_id', qIds).order('created_at', { ascending: true }); collect(data || []) }

    const build = (kind: 'so' | 'quote', srcType: string, rec: any) => {
      const hist = histMap[srcType + ':' + rec.id] || []
      const raw = hist.length ? hist : [{ status: rec.status, created_at: rec.created_at || rec.updated_at }]
      const timeline: { label: string; tone: StageTone; date: string }[] = []
      for (const h of raw) {
        const st = clientStage(kind, h.status)
        const last = timeline[timeline.length - 1]
        if (last && last.label === st.label) continue
        timeline.push({ label: st.label, tone: st.tone, date: h.created_at })
      }
      const cur = timeline[timeline.length - 1] || clientStage(kind, rec.status)
      return { current: { label: cur.label, tone: cur.tone }, timeline }
    }

    for (const o of soList) {
      const t = build('so', 'sales_order', o)
      projects.push({ id: o.id, kind: 'Order', name: o.client_portal_name || o.order_number || o.po_number || 'Order', current: t.current, timeline: t.timeline })
    }
    for (const q of qList) {
      const t = build('quote', 'quotation', q)
      projects.push({ id: q.id, kind: q.type === 'rfq' ? 'RFQ' : 'Quote', name: q.client_portal_name || q.quote_number || 'Quote', current: t.current, timeline: t.timeline })
    }
  }

  return NextResponse.json(
    { client: { name: client.name, company }, projects },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}

export async function POST(req: NextRequest, { params }: { params: { action: string } }) {
  const action = params.action

  if (action === 'login') {
    const body = await req.json().catch(() => ({})) as any
    const email = String(body.email || '').trim()
    const password = String(body.password || '')
    if (!email || !password) return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 })
    const { data, error } = await admin.rpc('portal_login', { p_email: email, p_password: password })
    if (error) return NextResponse.json({ error: 'Login is temporarily unavailable.' }, { status: 500 })
    const row = (Array.isArray(data) ? data[0] : data) as any
    if (!row) return NextResponse.json({ error: 'Incorrect email or password.' }, { status: 401 })
    const token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '')
    await admin.from('portal_sessions').insert({ token, portal_client_id: row.id, expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString() })
    await admin.from('portal_clients').update({ last_login_at: new Date().toISOString() }).eq('id', row.id)
    const res = NextResponse.json({ ok: true, name: row.name, company: row.company_name })
    res.cookies.set(COOKIE, token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 })
    return res
  }

  if (action === 'logout') {
    const token = req.cookies.get(COOKIE)?.value
    if (token) await admin.from('portal_sessions').delete().eq('token', token)
    const res = NextResponse.json({ ok: true })
    res.cookies.set(COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 })
    return res
  }

  // Public: set a password using a one-time token from an access email.
  if (action === 'set-password') {
    const body = await req.json().catch(() => ({})) as any
    const token = String(body.token || '').trim()
    const password = String(body.password || '')
    if (!token) return NextResponse.json({ error: 'Missing link token.' }, { status: 400 })
    if (password.length < 6) return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 })
    const { data, error } = await admin.rpc('portal_set_password_by_token', { p_token: token, p_password: password })
    if (error) return NextResponse.json({ error: error.message || 'This link is invalid or has expired.' }, { status: 400 })
    const row = (Array.isArray(data) ? data[0] : data) as any
    return NextResponse.json({ ok: true, email: row?.email || null })
  }

  // Staff-only: email a client their portal access (secure set-password link). CCs Rudyp.
  if (action === 'send-access') {
    const staff = await staffEmail(req)
    if (!staff) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    if (!RESEND_API_KEY) return NextResponse.json({ error: 'Email service is not configured.' }, { status: 500 })
    const body = await req.json().catch(() => ({})) as any
    const clientId = String(body.clientId || '')
    const { data: c } = await admin.from('portal_clients').select('id, name, company_name, email, customer_id').eq('id', clientId).maybeSingle()
    if (!c || !(c as any).email) return NextResponse.json({ error: 'Client not found or has no email.' }, { status: 404 })
    const cl = c as any
    let company = cl.company_name || null
    if (!company && cl.customer_id) { const { data: cust } = await admin.from('customers').select('company_name').eq('id', cl.customer_id).maybeSingle(); company = (cust as any)?.company_name || null }
    const token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '')
    await admin.from('portal_password_tokens').insert({ token, portal_client_id: cl.id, expires_at: new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString() })
    const link = `${SITE}/portal/set-password?token=${token}`
    const ok = await sendClientEmail(cl.email, 'Your beyondGREEN project portal', accessEmailInner(cl.name, company, link))
    if (!ok) return NextResponse.json({ error: 'Could not send the email. Try again.' }, { status: 502 })
    return NextResponse.json({ ok: true })
  }

  // Cron: send milestone update emails for un-emailed status changes. CCs Rudyp.
  if (action === 'notify-run') {
    const auth = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const { data: cfg } = await admin.from('portal_config').select('value').eq('key', 'cron_secret').maybeSingle()
    if (!cfg || !auth || auth !== (cfg as any).value) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const { data: rows } = await admin.from('portal_status_history')
      .select('id, source_type, source_id, status, created_at').is('emailed_at', null)
      .order('created_at', { ascending: true }).limit(100)
    const list = (rows || []) as any[]
    if (!list.length) return NextResponse.json({ ok: true, processed: 0, sent: 0 })

    const soIds = list.filter(r => r.source_type === 'sales_order').map(r => r.source_id)
    const qIds = list.filter(r => r.source_type === 'quotation').map(r => r.source_id)
    const srcMap: Record<string, any> = {}
    if (soIds.length) { const { data } = await admin.from('sales_orders').select('id, order_number, po_number, client_portal_visible, client_portal_name, customer_id').in('id', soIds); (data || []).forEach((s: any) => srcMap['sales_order:' + s.id] = s) }
    if (qIds.length) { const { data } = await admin.from('quotations').select('id, quote_number, type, client_portal_visible, client_portal_name, customer_id').in('id', qIds); (data || []).forEach((s: any) => srcMap['quotation:' + s.id] = s) }

    const custIds = Array.from(new Set(Object.values(srcMap).map((s: any) => s.customer_id).filter(Boolean)))
    const clientByCust: Record<string, any> = {}
    if (custIds.length) { const { data } = await admin.from('portal_clients').select('id, email, name, company_name, customer_id, is_active').in('customer_id', custIds as any); (data || []).forEach((c: any) => { if (c.is_active && c.email && !clientByCust[c.customer_id]) clientByCust[c.customer_id] = c }) }

    // Previous label per source, to render "prev -> new" in the email.
    const prevLabel: Record<string, string | null> = {}
    const handled: string[] = []
    let sent = 0

    for (const r of list) {
      const key = r.source_type + ':' + r.source_id
      const src = srcMap[key]
      const kind: 'so' | 'quote' = r.source_type === 'sales_order' ? 'so' : 'quote'
      const label = clientStage(kind, r.status).label
      const prev = prevLabel[key] ?? null
      prevLabel[key] = label

      if (!src || !src.client_portal_visible) { handled.push(r.id); continue }
      if (!MILESTONES.has(label)) { handled.push(r.id); continue }
      const client = src.customer_id ? clientByCust[src.customer_id] : null
      if (!client) { handled.push(r.id); continue }

      const project = src.client_portal_name || src.order_number || src.quote_number || src.po_number || (kind === 'so' ? 'Your order' : 'Your quote')
      const ok = await sendClientEmail(client.email, `Update: ${project} — ${label}`, milestoneEmailInner(project, prev, label))
      if (ok) { handled.push(r.id); sent++ }
      // on failure, leave un-emailed to retry next run
    }

    if (handled.length) await admin.from('portal_status_history').update({ emailed_at: new Date().toISOString() }).in('id', handled)
    return NextResponse.json({ ok: true, processed: list.length, sent })
  }

  if (action === 'message') {
    const client = await clientFromRequest(req)
    if (!client) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const body = await req.json().catch(() => ({})) as any
    const text = String(body.message || '').trim()
    if (!text) return NextResponse.json({ error: 'Please enter a message.' }, { status: 400 })
    if (text.length > 5000) return NextResponse.json({ error: 'Message is too long.' }, { status: 400 })
    const company = await companyName(client)
    await admin.from('portal_messages').insert({ portal_client_id: client.id, customer_id: client.customer_id, sender_name: client.name, sender_email: client.email, message: text })
    await admin.from('notifications').insert({ recipient_email: NOTIFY, sender_email: client.email || 'client-portal', message: `${company || client.name || 'A client'}: ${text.slice(0, 240)}`, page: 'Client Portal', is_read: false, context_url: `${SITE}/bizdev/client-portals` })
    if (RESEND_API_KEY) {
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1A1D2E">`
        + `<h2 style="color:#037f4c;margin:0 0 6px;font-size:18px">New client portal message</h2>`
        + `<p style="margin:0 0 12px;font-size:14px">From <strong>${esc(client.name || client.email || 'Client')}</strong>${company ? ` · ${esc(company)}` : ''} <span style="color:#6b7280">(${esc(client.email || '')})</span></p>`
        + `<div style="background:#f5f6fa;border-left:3px solid #037f4c;padding:12px 16px;border-radius:0 8px 8px 0;font-size:14px;white-space:pre-wrap;line-height:1.5">${esc(text)}</div>`
        + `<div style="margin:16px 0"><a href="${SITE}/bizdev/client-portals" style="display:inline-block;background:#037f4c;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:600">Open in the ERP</a></div>`
        + `<p style="margin:12px 0 0;font-size:12px;color:#9ca3af">Sent from the beyondGREEN client portal.</p></div>`
      await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: `beyondGREEN <${FROM_EMAIL}>`, to: [NOTIFY], reply_to: client.email || undefined, subject: `Client message — ${company || client.name || client.email}`, html }) }).catch(() => {})
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'not found' }, { status: 404 })
}
