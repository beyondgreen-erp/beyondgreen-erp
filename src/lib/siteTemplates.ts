/* eslint-disable @typescript-eslint/no-explicit-any */
// Server helpers for the public website's die line template library
// (beyondgreen-site /templates). Members sign up on the website; everything that
// touches accounts, private PDFs or download logs runs here with the service role.
import { NextRequest } from 'next/server'
import { createHash, randomBytes } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { admin, sendEmail, button, esc, NOTIFY_SIGNUPS } from '@/lib/portalServer'

export { admin }
export const PDF_BUCKET = 'site-templates'
export const THUMB_BUCKET = 'site-template-thumbs'
export const SITE_PUBLIC = (process.env.SITE_PUBLIC_URL || 'https://beyondgreen-site.vercel.app').replace(/\/$/, '')
export const API_PUBLIC = (process.env.SITE_TEMPLATES_API_URL || 'https://byndgrn-portal.vercel.app').replace(/\/$/, '')
export const SESSION_DAYS = 30
export const RATE_LIMIT_PER_HOUR = 50
export const RATE_LIMIT_PER_DAY = 200
export const IP_LIMIT_PER_HOUR = 120
export const PRO_BUCKET = 'site-templates-pro'
export const BUSINESS_TYPES = ['Restaurant / QSR', 'Cafe / Coffee', 'Grocery / Retail', 'Pet Brand', 'Distributor', 'Brand / CPG', 'Agency / Designer', 'Other']
export const CATEGORY_ORDER = ['Pet Waste Bags', 'Grocery & Produce Bags', 'Trash & Kitchen Liners', 'Paper Bags', 'SOS Paper Bags', 'Paper Cups', 'Coffee Bags', 'Pouches', 'Straw Wrappers', 'Food Trays', 'Clamshells', 'Tuck End Boxes', 'Folding Boxes', 'Tray Boxes', 'Display Boxes', 'Shipping Boxes', 'Envelopes', 'Header Cards & Labels', 'Pet & Home Packaging', 'Film Bags']

const SITE_ORIGINS = ['https://byndgrn.com', 'https://www.byndgrn.com', 'https://beyondgreenbiotech.com', 'https://www.beyondgreenbiotech.com', 'https://beyondgreen-site.vercel.app', 'http://localhost:3123']
export function cors(req: NextRequest): Record<string, string> {
  const o = req.headers.get('origin') || ''
  const extra = (process.env.SITE_PUBLIC_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
  const ok = SITE_ORIGINS.includes(o) || extra.includes(o) || /^https:\/\/beyondgreen-site-[a-z0-9-]+\.vercel\.app$/.test(o)
  return ok ? { 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Expose-Headers': 'Content-Disposition', 'Access-Control-Max-Age': '86400', Vary: 'Origin' } : {}
}

export const sha = (s: string) => createHash('sha256').update(s).digest('hex')
export const newToken = () => randomBytes(32).toString('base64url')
export const str = (v: unknown, max = 300) => String(v ?? '').trim().slice(0, max)
export const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)
export function slugify(s: string): string {
  return String(s || '').toLowerCase().replace(/(\d)\s*x\s*(?=\d)/g, '$1x').replace(/(\d)\.(\d)/g, '$1-$2').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90)
}
// Only allow returning members to pages inside the template library.
export function safeNext(n: unknown): string {
  const s = String(n || '')
  return /^\/templates(\/[a-z0-9\-/]*)?(\?[a-z0-9=&%\-_.]*)?$/i.test(s) ? s : '/templates'
}

export async function createSession(memberId: string): Promise<string> {
  const token = newToken()
  await admin.from('site_member_sessions').insert({ token_hash: sha(token), member_id: memberId, expires_at: new Date(Date.now() + SESSION_DAYS * 864e5).toISOString() })
  return token
}

export async function memberFromReq(req: NextRequest): Promise<any | null> {
  const h = req.headers.get('authorization') || ''
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : ''
  if (!token || token.length < 20) return null
  const { data: s } = await admin.from('site_member_sessions').select('member_id, expires_at').eq('token_hash', sha(token)).maybeSingle()
  if (!s || new Date((s as any).expires_at).getTime() < Date.now()) return null
  const { data: m } = await admin.from('site_members').select('*').eq('id', (s as any).member_id).maybeSingle()
  if (!m) return null
  admin.from('site_member_sessions').update({ last_used_at: new Date().toISOString() }).eq('token_hash', sha(token)).then(() => {}, () => {})
  return m
}

export function publicMember(m: any) {
  return { id: m.id, email: m.email, first_name: m.first_name, last_name: m.last_name, company: m.company, business_type: m.business_type, phone: m.phone, marketing_consent: !!m.marketing_consent, profile_complete: !!m.profile_complete, verified: !!m.email_verified_at }
}

// Plain anon client for checking a member's password (never persists anything).
export function anonClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
}

export async function makeToken(memberId: string, purpose: 'verify' | 'reset', next: string, hours: number): Promise<string> {
  const t = newToken()
  await admin.from('site_member_tokens').insert({ token_hash: sha(t), member_id: memberId, purpose, next_path: next, expires_at: new Date(Date.now() + hours * 3600e3).toISOString() })
  return t
}

export async function sendVerifyEmail(m: any, next: string): Promise<boolean> {
  const t = await makeToken(m.id, 'verify', next, 48)
  const link = `${API_PUBLIC}/api/site/templates/verify?t=${encodeURIComponent(t)}`
  return sendEmail({
    to: [m.email],
    subject: 'Confirm your email to download beyondGREEN die line templates',
    html: `<p style="margin:0 0 12px">Hi ${esc(m.first_name || 'there')},</p><p style="margin:0 0 12px">Thanks for joining the beyondGREEN template library. Please confirm your email to start downloading free die line templates.</p>${button(link, 'Confirm my email')}<p style="margin:0;font-size:13px;color:#6b7280">This link expires in 48 hours. If you did not sign up, you can ignore this email.</p>`,
  })
}

export async function sendResetEmail(m: any): Promise<boolean> {
  const t = await makeToken(m.id, 'reset', '/templates', 2)
  const link = `${SITE_PUBLIC}/templates/reset#t=${encodeURIComponent(t)}`
  return sendEmail({
    to: [m.email],
    subject: 'Reset your beyondGREEN template library password',
    html: `<p style="margin:0 0 12px">Hi ${esc(m.first_name || 'there')},</p><p style="margin:0 0 12px">We got a request to reset your password. Use the button below to choose a new one.</p>${button(link, 'Choose a new password')}<p style="margin:0;font-size:13px;color:#6b7280">This link expires in 2 hours. If you did not ask for this, you can ignore this email.</p>`,
  })
}

// Tell the team and the CRM about a new member. The CRM hook is optional and set by env.
export async function announceMember(m: any) {
  const row = { first_name: m.first_name, last_name: m.last_name, email: m.email, company: m.company, business_type: m.business_type, phone: m.phone, marketing_consent: !!m.marketing_consent, provider: m.provider, created_at: m.created_at, source: 'beyondGREEN die line template library' }
  try {
    await admin.from('website_inquiries').insert({ kind: 'template-signup', topic: 'Template library sign-up', name: [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email, company: m.company || null, email: m.email, phone: m.phone || null, message: null, details: row, page: '/templates' })
  } catch { /* logging only */ }
  const hook = process.env.SITE_SIGNUP_WEBHOOK_URL
  if (hook) {
    try {
      await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(process.env.SITE_SIGNUP_WEBHOOK_SECRET ? { 'X-Webhook-Secret': process.env.SITE_SIGNUP_WEBHOOK_SECRET } : {}) }, body: JSON.stringify({ event: 'template_member.created', member: row }) })
    } catch { /* never block sign-up on the CRM */ }
  }
  if (process.env.SITE_SIGNUP_NOTIFY !== 'off') {
    await sendEmail({ to: NOTIFY_SIGNUPS, subject: `New template library member: ${m.company || m.email}`, html: `<p style="margin:0 0 8px"><b>${esc([m.first_name, m.last_name].filter(Boolean).join(' '))}</b> (${esc(m.email)}) joined the die line template library.</p><p style="margin:0">Company: ${esc(m.company || '-')}<br>Business type: ${esc(m.business_type || '-')}<br>Phone: ${esc(m.phone || '-')}<br>Marketing emails: ${m.marketing_consent ? 'Yes' : 'No'}</p>` })
  }
}

export async function downloadsLastHour(memberId: string): Promise<number> {
  const { count } = await admin.from('site_template_downloads').select('id', { count: 'exact', head: true }).eq('member_id', memberId).gte('created_at', new Date(Date.now() - 3600e3).toISOString())
  return count || 0
}

export function clientIp(req: NextRequest): string {
  return (req.headers.get('x-forwarded-for') || '').split(',')[0].trim().slice(0, 60)
}

export async function syncKeyOk(req: NextRequest): Promise<boolean> {
  const k = req.headers.get('x-sync-key') || ''
  if (k.length < 20) return false
  const { data } = await admin.from('portal_config').select('value').eq('key', 'site_templates_sync_key_sha256').maybeSingle()
  const want = String((data as any)?.value || '').replace(/"/g, '')
  return !!want && want === sha(k)
}

// ── Minimal ZIP writer (store, no compression: PDFs are already compressed) ──
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
function crc32(buf: Uint8Array): number { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
export function buildZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const chunks: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0
  const d = new Date(); const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1); const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  for (const f of files) {
    const name = new TextEncoder().encode(f.name); const crc = crc32(f.data); const size = f.data.length
    const lh = new DataView(new ArrayBuffer(30))
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true)
    lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true)
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true)
    chunks.push(new Uint8Array(lh.buffer), name, f.data)
    const ch = new DataView(new ArrayBuffer(46))
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true)
    ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true)
    ch.setUint16(28, name.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, offset, true)
    central.push(new Uint8Array(ch.buffer), name)
    offset += 30 + name.length + size
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true)
  const all = [...chunks, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0)); let p = 0
  for (const c of all) { out.set(c, p); p += c.length }
  return out
}

// ── Settings (prices etc.) ──
export async function getSettings(): Promise<Record<string, any>> {
  const { data } = await admin.from('site_template_settings').select('key, value')
  const o: Record<string, any> = { price_single: 4.99, price_pack: 19, price_pro_month: 9.99, price_pro_year: 59, print_credit_months: 12, checkout_enabled: true }
  for (const r of (data || []) as any[]) o[r.key] = r.value
  return o
}
export const shopOn = () => !!(process.env.SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_ADMIN_TOKEN)

// ── Entitlements: what editable (Pro) files a member may download ──
export async function proAccess(memberId: string): Promise<{ all: boolean; packs: string[]; templates: string[]; sub: any | null }> {
  const { data } = await admin.from('site_template_purchases').select('*').eq('member_id', memberId).in('status', ['paid', 'active', 'canceled'])
  const rows = (data || []) as any[]
  const now = Date.now()
  const sub = rows.filter(r => (r.kind === 'pro_month' || r.kind === 'pro_year')).sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0] || null
  // A canceled plan keeps access until the paid period ends.
  const all = rows.some(r => (r.kind === 'pro_month' || r.kind === 'pro_year') && (r.status === 'active' || r.status === 'canceled') && r.current_period_end && +new Date(r.current_period_end) > now)
  return {
    all,
    packs: rows.filter(r => r.kind === 'pack' && r.status === 'paid').map(r => r.category_slug),
    templates: rows.filter(r => r.kind === 'single' && r.status === 'paid').map(r => r.template_id),
    sub,
  }
}
export function canPro(acc: { all: boolean; packs: string[]; templates: string[] }, t: any): boolean {
  return acc.all || acc.packs.includes(t.category_slug) || acc.templates.includes(t.id)
}
export async function creditBalance(memberId: string): Promise<number> {
  const { data } = await admin.from('site_print_credits').select('amount, used_amount, expires_at').eq('member_id', memberId)
  return ((data || []) as any[]).filter(c => +new Date(c.expires_at) > Date.now()).reduce((a, c) => a + Number(c.amount) - Number(c.used_amount), 0)
}

// ── Shopify (Admin GraphQL) ──
export const SHOP_PUBLIC = (process.env.SHOPIFY_PUBLIC_URL || 'https://byndgrn.com').replace(/\/$/, '')
export async function shopify(query: string, variables: Record<string, any> = {}): Promise<any> {
  const r = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN || '', 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  const j = await r.json()
  if (!r.ok || j.errors) throw new Error(JSON.stringify(j.errors || j).slice(0, 300))
  return j.data
}
/** One-time checkout: a draft order at the exact price; returns Shopify's hosted checkout link. */
export async function shopifyCheckout(o: { email: string; title: string; price: number; quantity?: number; purchaseId: string; note: string; tags: string[]; attrs?: Record<string, string> }) {
  const d = await shopify(`mutation($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { id invoiceUrl } userErrors { field message } } }`, {
    input: {
      email: o.email, note: o.note, tags: o.tags,
      customAttributes: [{ key: 'purchase_id', value: o.purchaseId }, ...Object.entries(o.attrs || {}).map(([key, value]) => ({ key, value }))],
      lineItems: [{ title: o.title, originalUnitPrice: (Math.round(o.price * 100) / 100).toFixed(2), quantity: o.quantity || 1, requiresShipping: false, taxable: false, customAttributes: [{ key: 'purchase_id', value: o.purchaseId }] }],
    },
  })
  const res = d.draftOrderCreate
  if (res.userErrors?.length) throw new Error(res.userErrors[0].message)
  return { id: res.draftOrder.id as string, url: res.draftOrder.invoiceUrl as string }
}
/** Pro plans run through the Shopify Subscriptions app: a product variant with a selling plan. */
export function proCartUrl(kind: 'pro_month' | 'pro_year', email: string, purchaseId: string): string | null {
  const v = kind === 'pro_year' ? process.env.SHOPIFY_PRO_YEAR_VARIANT_ID : process.env.SHOPIFY_PRO_MONTH_VARIANT_ID
  const sp = kind === 'pro_year' ? process.env.SHOPIFY_PRO_YEAR_SELLING_PLAN_ID : process.env.SHOPIFY_PRO_MONTH_SELLING_PLAN_ID
  if (!v || !sp) return null
  const q = new URLSearchParams({ selling_plan: sp, 'checkout[email]': email, 'attributes[purchase_id]': purchaseId, note: `Template Pro ${purchaseId}` })
  return `${SHOP_PUBLIC}/cart/${v}:1?${q.toString()}`
}
export function shopifySigOk(raw: string, header: string | null): boolean {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET
  if (!secret || !header) return false
  const mac = require('crypto').createHmac('sha256', secret).update(raw, 'utf8').digest('base64')
  try { return require('crypto').timingSafeEqual(Buffer.from(mac), Buffer.from(header)) } catch { return false }
}

export async function grantPurchase(p: any, info: { order_id?: string; order_name?: string; period_end?: number }) {
  if (p.status === 'paid' || p.status === 'active') return
  const sub = p.kind === 'pro_month' || p.kind === 'pro_year'
  await admin.from('site_template_purchases').update({
    status: sub ? 'active' : 'paid', paid_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    shopify_order_id: info.order_id || null, shopify_order_name: info.order_name || null,
    current_period_end: info.period_end ? new Date(info.period_end * 1000).toISOString() : (sub ? new Date(Date.now() + (p.kind === 'pro_year' ? 366 : 31) * 864e5).toISOString() : null),
  }).eq('id', p.id)
  const settings = await getSettings()
  const months = Number(settings.print_credit_months) || 12
  await admin.from('site_print_credits').insert({ member_id: p.member_id, purchase_id: p.id, amount: p.amount, expires_at: new Date(Date.now() + months * 30.44 * 864e5).toISOString(), note: `Print credit from ${p.kind.replace('_', ' ')} purchase` })
  // receipt
  let what = 'All-access Pro'
  let link = `${SITE_PUBLIC}/account`
  if (p.kind === 'single' && p.template_id) {
    const { data: t } = await admin.from('site_templates').select('item, slug, category_slug').eq('id', p.template_id).maybeSingle()
    if (t) { what = `${(t as any).item} (editable)`; link = `${SITE_PUBLIC}/templates/${(t as any).category_slug}/${(t as any).slug}` }
  } else if (p.kind === 'pack') { what = `${p.category_slug} category pack (editable)`; link = `${SITE_PUBLIC}/templates/${p.category_slug}` }
  else what = p.kind === 'pro_year' ? 'All-access Pro, yearly' : 'All-access Pro, monthly'
  if (p.email) await sendEmail({ to: [p.email], subject: `Your beyondGREEN receipt: ${what}`, html: `<p style="margin:0 0 12px">Thank you for your purchase.</p><p style="margin:0 0 12px"><b>${esc(what)}</b><br>Amount paid: $${Number(p.amount).toFixed(2)}</p><p style="margin:0 0 12px">You also received a <b>$${Number(p.amount).toFixed(2)} print credit</b>, good on a printed order from beyondGREEN for ${months} months.</p>${button(link, 'Download your files')}<p style="margin:0;font-size:13px;color:#6b7280">Downloads are available any time from your account. Questions? Call (866) 364-9466.</p>` })
  const hook = process.env.SITE_SIGNUP_WEBHOOK_URL
  if (hook) { try { await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'template_purchase.paid', purchase: { kind: p.kind, amount: p.amount, email: p.email, company: p.company, category: p.category_slug } }) }) } catch { /* optional */ } }
}
