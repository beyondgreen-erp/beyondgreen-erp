// Shared server helpers for the client portal self-service features
// (sign-up, onboarding, order requests, projects, quotes, bookings, documents).
// The original /api/portal/[action] route keeps its own copies of the basics; this module
// is used by /api/portal/self/[action] so the two can evolve without stepping on each other.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { randomUUID } from 'crypto'

export const STAFF_DOMAINS = ['beyondgreenbiotech.com', 'byndgrn.com']
export const COOKIE = 'bg_portal'
export const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://beyondgreen-erp.vercel.app'
export const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL || 'https://byndgrn-portal.vercel.app'
export const RESEND_API_KEY = process.env.RESEND_API_KEY
export const FROM_EMAIL = process.env.FROM_EMAIL || 'erp@beyondgreenbiotech.com'
export const NOTIFY = 'Rudyp@beyondgreenbiotech.com'
// Who hears about what. Orders also go to the person who enters orders in the ERP.
export const NOTIFY_ORDERS = (process.env.PORTAL_NOTIFY_ORDERS || 'Rudyp@beyondgreenbiotech.com,manish@beyondgreenbiotech.com').split(',').map(s => s.trim()).filter(Boolean)
export const NOTIFY_PROJECTS = (process.env.PORTAL_NOTIFY_PROJECTS || 'Rudyp@beyondgreenbiotech.com').split(',').map(s => s.trim()).filter(Boolean)
export const NOTIFY_SIGNUPS = (process.env.PORTAL_NOTIFY_SIGNUPS || 'Rudyp@beyondgreenbiotech.com').split(',').map(s => s.trim()).filter(Boolean)
export const BUCKET = 'erp-files'

// Exact, case-insensitive match for ilike (escape the LIKE wildcards).
export const likeExact = (v: string) => String(v || '').replace(/[\\%_]/g, m => '\\' + m)
export const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export interface PortalAccount {
  id: string
  customer_id: string | null
  name: string | null
  company_name: string | null
  email: string
  phone: string | null
  title: string | null
  signup_source: string | null
  email_verified_at: string | null
  approved_at: string | null
  onboarding: any
  onboarding_submitted_at: string | null
}

const ACCOUNT_COLS = 'id, customer_id, name, company_name, email, phone, title, signup_source, email_verified_at, approved_at, onboarding, onboarding_submitted_at, is_active'

export async function accountFromRequest(req: NextRequest): Promise<PortalAccount | null> {
  const token = req.cookies.get(COOKIE)?.value
  if (!token) return null
  const { data: sess } = await admin.from('portal_sessions').select('portal_client_id, expires_at').eq('token', token).maybeSingle()
  if (!sess) return null
  if (new Date((sess as any).expires_at).getTime() < Date.now()) return null
  const { data: c } = await admin.from('portal_clients').select(ACCOUNT_COLS).eq('id', (sess as any).portal_client_id).maybeSingle()
  if (!c || !(c as any).is_active) return null
  return c as any
}

export async function staffEmail(req: NextRequest): Promise<string | null> {
  const supa = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll() { return req.cookies.getAll() }, setAll() {} },
  })
  const { data: { user } } = await supa.auth.getUser()
  const domain = user?.email?.split('@')[1]?.toLowerCase() || ''
  if (!user || !STAFF_DOMAINS.includes(domain)) return null
  return user.email || null
}

export function token(): string {
  return (randomUUID() + randomUUID()).replace(/-/g, '')
}

// ── Email ────────────────────────────────────────────────────
export function shell(inner: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;border:1px solid #ECEEF3;border-radius:12px;overflow:hidden">`
    + `<div style="background:#037f4c;padding:16px 22px"><span style="color:#ffffff;font-weight:700;font-size:16px">beyondGREEN</span></div>`
    + `<div style="padding:22px;color:#1A1D2E">${inner}</div>`
    + `<div style="padding:0 22px 20px"><p style="margin:0;font-size:12px;color:#9ca3af">beyondGREEN biotech · 1202 E. Wakeham Ave., Santa Ana, CA 92705 · Questions? Reply to this email.</p></div></div>`
}

export function button(href: string, label: string): string {
  return `<div style="margin:16px 0"><a href="${esc(href)}" style="display:inline-block;background:#037f4c;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;font-size:14px;font-weight:600">${esc(label)}</a></div>`
}

export async function sendEmail(opts: { to: string[]; subject: string; html: string; replyTo?: string | null; cc?: string[] }): Promise<boolean> {
  if (!RESEND_API_KEY || !opts.to.length) return false
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `beyondGREEN <${FROM_EMAIL}>`,
        to: opts.to,
        cc: opts.cc && opts.cc.length ? opts.cc : undefined,
        reply_to: opts.replyTo ? [opts.replyTo] : [NOTIFY],
        subject: opts.subject,
        html: shell(opts.html),
      }),
    })
    return res.ok
  } catch { return false }
}

// Client-facing email: always CC Rudyp, like the rest of the portal.
export async function emailClient(to: string, subject: string, inner: string): Promise<boolean> {
  return sendEmail({ to: [to], cc: [NOTIFY], subject, html: inner })
}

// ERP bell notification + email to the team.
export async function notifyTeam(opts: { to: string[]; from: string; subject: string; message: string; html: string; contextPath: string; replyTo?: string | null }) {
  for (const r of opts.to) {
    await admin.from('notifications').insert({
      recipient_email: r, sender_email: opts.from || 'client-portal', message: opts.message.slice(0, 400),
      page: 'Client Portal', is_read: false, context_url: `${SITE}${opts.contextPath}`,
    }).then(() => {}, () => {})
  }
  await sendEmail({ to: opts.to, subject: opts.subject, html: opts.html + button(`${SITE}${opts.contextPath}`, 'Open in the ERP'), replyTo: opts.replyTo || undefined })
}

export async function companyOf(acct: PortalAccount): Promise<string> {
  if (acct.company_name) return acct.company_name
  if (acct.customer_id) {
    const { data } = await admin.from('customers').select('company_name').eq('id', acct.customer_id).maybeSingle()
    if ((data as any)?.company_name) return (data as any).company_name
  }
  return acct.name || acct.email
}

const FREE_MAIL = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'live.com', 'msn.com', 'me.com', 'proton.me', 'protonmail.com', 'comcast.net', 'att.net', 'sbcglobal.net'])

// Called after a self sign-up sets their password through the emailed link.
// Marks the email verified, then links (or creates) the ERP customer:
//  - exact email match to a customer on the Customer/Leads board -> link; auto-approve if Active Customer
//  - otherwise create a Lead on Customer/Leads (lead_source 'Client portal')
//  - same company email domain as an existing customer -> flag it for staff to merge
export async function finalizeVerification(email: string): Promise<void> {
  const { data: c } = await admin.from('portal_clients').select(ACCOUNT_COLS).ilike('email', likeExact(email)).maybeSingle()
  const acct = c as any
  if (!acct) return
  const patch: any = { updated_at: new Date().toISOString() }
  if (!acct.email_verified_at) patch.email_verified_at = new Date().toISOString()

  if (!acct.customer_id) {
    const { data: hits } = await admin.from('customers')
      .select('id, company_name, customer_status, board')
      .ilike('email', likeExact(email)).eq('board', 'customer').not('is_merged', 'is', true).limit(5)
    const list = (hits || []) as any[]
    const exact = list.find(h => h.customer_status === 'Active Customer') || list[0]
    if (exact) {
      patch.customer_id = exact.id
      if (exact.customer_status === 'Active Customer' && !acct.approved_at) { patch.approved_at = new Date().toISOString(); patch.approved_by = 'auto: email matches active customer' }
    } else {
      const ob = acct.onboarding || {}
      const { data: created } = await admin.from('customers').insert({
        company_name: acct.company_name || ob.legal_name || email,
        contact_name: acct.name || null,
        email,
        phone: acct.phone || null,
        website: ob.website || null,
        board: 'customer',
        customer_status: 'Lead',
        lead_source: 'Client portal',
        industry: ob.business_type || null,
        is_active: true,
        is_scraped_lead: false,
        notes: 'Created by client portal sign-up.',
      }).select('id').single()
      if (created) patch.customer_id = (created as any).id
      // Same company domain as an existing customer? Suggest a merge to staff.
      const domain = email.split('@')[1]?.toLowerCase() || ''
      if (domain && !FREE_MAIL.has(domain)) {
        const { data: sib } = await admin.from('customers').select('id, company_name').ilike('email', `%@${likeExact(domain)}`).eq('board', 'customer').neq('id', (created as any)?.id || '00000000-0000-0000-0000-000000000000').not('is_merged', 'is', true).limit(1)
        if (sib && sib.length) patch.onboarding = { ...(acct.onboarding || {}), suggested_customer_id: (sib[0] as any).id, suggested_customer_name: (sib[0] as any).company_name }
      }
    }
  }
  await admin.from('portal_clients').update(patch).eq('id', acct.id)
}

// ── Storage ──────────────────────────────────────────────────
const ALLOWED_EXT = /\.(pdf|png|jpe?g|webp|gif|heic|ai|eps|svg|psd|zip|dxf|dwg|step|stp|stl|igs|iges|xlsx?|csv|docx?|txt)$/i
export function safeFileName(name: string): string | null {
  const base = String(name || '').split(/[\\/]/).pop() || ''
  if (!ALLOWED_EXT.test(base)) return null
  return base.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120)
}

export async function signedUpload(path: string): Promise<{ url: string; path: string } | null> {
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path)
  if (error || !data) return null
  return { url: (data as any).signedUrl, path }
}

export async function signedDownload(path: string, seconds = 3600): Promise<string | null> {
  const { data } = await admin.storage.from(BUCKET).createSignedUrl(path, seconds)
  return data?.signedUrl || null
}

export async function objectExists(path: string): Promise<boolean> {
  const dir = path.split('/').slice(0, -1).join('/')
  const file = path.split('/').pop() || ''
  const { data } = await admin.storage.from(BUCKET).list(dir, { search: file, limit: 5 })
  return !!(data || []).find((o: any) => o.name === file)
}
