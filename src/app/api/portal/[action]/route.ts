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
// Client-facing base URL. Set NEXT_PUBLIC_PORTAL_URL to the dedicated portal host
// (e.g. https://portal.byndgrn.com) so client emails never reveal the ERP domain.
// Falls back to SITE until configured.
const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL || 'https://byndgrn-portal.vercel.app'
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

// ── Client-facing team roster (shown in the portal) ──
const PORTAL_TEAM: { email: string; name: string; role: string }[] = [
  { email: 'rudyp@beyondgreenbiotech.com', name: 'Rudy P.', role: 'Project Oversight Manager 1' },
  { email: 'manish@beyondgreenbiotech.com', name: 'Manish P.', role: 'Project Manager 1' },
  { email: 'dhanush.k@beyondgreenbiotech.com', name: 'Dhanush K.', role: 'Certifications & Compliance (BPI/TUV)' },
  { email: 'shea@beyondgreenbiotech.com', name: 'Shea F.', role: 'Logistics Oversight Manager' },
  { email: 'tiya@beyondgreenbiotech.com', name: 'Tiya P.', role: 'Content Creator' },
]
const TEAM_EMAILS = new Set(PORTAL_TEAM.map(m => m.email.toLowerCase()))

// Build a /api/avatar URL from a player's avatar_config (mirrors the ERP UserAvatar renderer).
function avatarPathFromConfig(cfg: any): string {
  cfg = cfg || {}
  const p = new URLSearchParams()
  p.set('seed', cfg.seed || 'beyondGREEN')
  p.set('skinColor', cfg.skinColor || 'edb98a')
  p.set('top', cfg.top || 'shortFlat')
  p.set('hairColor', cfg.hairColor || '4a312c')
  p.set('eyes', cfg.eyes || 'default')
  p.set('eyebrows', cfg.eyebrows || 'default')
  p.set('mouth', cfg.mouth || 'smile')
  p.set('clothing', cfg.clothing || 'shirtCrewNeck')
  p.set('clothesColor', cfg.clothesColor || '5199e4')
  if (cfg.clothingGraphic) p.set('clothingGraphic', cfg.clothingGraphic)
  if (cfg.hatColor) p.set('hatColor', cfg.hatColor)
  const bg = cfg.backgroundColor || 'b6e3f4'
  if (cfg.bgGradient) { p.set('backgroundColor', bg + ',' + cfg.bgGradient); p.set('backgroundType', 'gradientLinear') } else p.set('backgroundColor', bg)
  if (cfg.facialHair) { p.set('facialHair', cfg.facialHair); p.set('facialHairProbability', '100'); p.set('facialHairColor', cfg.facialHairColor || '2c1b18') } else p.set('facialHairProbability', '0')
  if (cfg.accessories) { p.set('accessories', cfg.accessories); p.set('accessoriesProbability', '100'); p.set('accessoriesColor', cfg.accessoriesColor || '3c4f5c') } else p.set('accessoriesProbability', '0')
  return `/api/avatar?${p.toString()}`
}

async function buildTeam(): Promise<any[]> {
  const { data: profs } = await admin.from('player_profiles').select('user_email, avatar_config').in('user_email', PORTAL_TEAM.map(m => m.email))
  const cfgByEmail: Record<string, any> = {}
  for (const p of (profs || []) as any[]) cfgByEmail[String(p.user_email).toLowerCase()] = p.avatar_config
  return PORTAL_TEAM.map(m => ({ email: m.email, name: m.name, role: m.role, avatar: avatarPathFromConfig(cfgByEmail[m.email.toLowerCase()]) }))
}

// Verify a record belongs to this portal client; return a display label.
async function ownsRecord(client: PortalClient, rt: string, rid: string): Promise<{ ok: boolean; label: string | null }> {
  if (!rid) return { ok: false, label: null }
  if (rt === 'sales_order') {
    const { data } = await admin.from('sales_orders').select('customer_id, client_portal_name, order_number, po_number').eq('id', rid).maybeSingle()
    const s = data as any
    if (s && s.customer_id === client.customer_id) return { ok: true, label: s.client_portal_name || s.order_number || s.po_number || 'Order' }
  } else if (rt === 'quotation') {
    const { data } = await admin.from('quotations').select('customer_id, client_portal_name, quote_number').eq('id', rid).maybeSingle()
    const s = data as any
    if (s && s.customer_id === client.customer_id) return { ok: true, label: s.client_portal_name || s.quote_number || 'RFQ' }
  } else if (rt === 'shipment') {
    const { data } = await admin.from('shipments').select('customer_name, broker_portal_client, po_number').eq('id', rid).maybeSingle()
    const s = data as any
    if (s && s.broker_portal_client) return { ok: true, label: s.customer_name || s.po_number || 'Shipment' }
  }
  return { ok: false, label: null }
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
      body: JSON.stringify({ from: `beyondGREEN <${FROM_EMAIL}>`, to: [to], cc: [NOTIFY], reply_to: [NOTIFY], bcc: ['info@byndgrn.com'], subject, html: shell(inner) }),
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
    + `<div style="margin:0"><a href="${PORTAL_URL}/portal" style="display:inline-block;background:#037f4c;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;font-size:14px;font-weight:600">View progress</a></div>`
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

  // Eco Maven broker portal: grouped projects (Open RFQs / Open Orders / Completed) with PO docs + commission status
  let broker: any = null
  if ((company || '').toLowerCase().includes('eco maven') && client.customer_id) {
    const COMPLETED = new Set(['Shipped', 'Closed', 'Cancelled', 'Completed', 'Delivered'])
    const RFQ_CLOSED = new Set(['won', 'lost', 'converted', 'closed', 'archived', 'expired', 'ordered'])
    const STATUS_LABEL: Record<string, string> = { paid_by_bg: 'Paid by beyondGREEN', waiting_customer: 'Waiting on Customer Payment' }
    const [{ data: bdeals }, { data: brfqs }, { data: bships }] = await Promise.all([
      admin.from('sales_orders').select('id, order_number, po_number, status, client_portal_name, total, total_amount, subtotal, purchase_order_url, broker_cost, broker_commission_basis, broker_commission_status, broker_commission_paid, created_at').eq('customer_id', client.customer_id).eq('archived', false).order('created_at', { ascending: false }),
      admin.from('quotations').select('id, quote_number, client_portal_name, status, is_active, created_at, notes, price_term, export_country').eq('customer_id', client.customer_id).eq('type', 'rfq').order('created_at', { ascending: false }),
      admin.from('shipments').select('id, customer_name, po_number, status, delivery_status, total_value, packing_slip_url, pod_file_url, ship_date, order_date, broker_cost, broker_commission_basis, broker_commission_status').not('broker_portal_client', 'is', null).order('ship_date', { ascending: false, nullsFirst: false }),
    ])
    const rfqIds = ((brfqs || []) as any[]).map(r => r.id)
    const linesByRfq: Record<string, any[]> = {}
    const artByRfq: Record<string, any[]> = {}
    if (rfqIds.length) {
      const { data: lns } = await admin.from('quotation_lines').select('quotation_id, sku, description, quantity, unit_of_measure, unit_price, line_total, pcs_per_case, case_price').in('quotation_id', rfqIds)
      for (const l of (lns || []) as any[]) { (linesByRfq[l.quotation_id] ||= []).push({ sku: l.sku, description: l.description, quantity: l.quantity, unit: l.unit_of_measure, unit_price: l.unit_price != null ? Number(l.unit_price) : null, line_total: l.line_total != null ? Number(l.line_total) : null, pcs_per_case: l.pcs_per_case != null ? Number(l.pcs_per_case) : null, case_price: l.case_price != null ? Number(l.case_price) : null }) }
      const { data: atts } = await admin.from('file_attachments').select('record_id, file_name, file_type, storage_path').eq('record_type', 'quotation_art').in('record_id', rfqIds)
      for (const a of (atts || []) as any[]) {
        const { data: signed } = await admin.storage.from('erp-files').createSignedUrl(a.storage_path, 3600)
        ;(artByRfq[a.record_id] ||= []).push({ name: a.file_name, type: a.file_type, url: signed?.signedUrl || null })
      }
    }
    // Line items for the client's sales orders (shown when an order row is expanded)
    const soIds = ((bdeals || []) as any[]).map(o => o.id)
    const linesBySo: Record<string, any[]> = {}
    if (soIds.length) {
      const { data: solns } = await admin.from('sales_order_lines').select('sales_order_id, sku, description, quantity, quantity_shipped, unit_of_measure, unit_price, production_status, qty_per_case, line_number').in('sales_order_id', soIds).order('line_number', { ascending: true })
      for (const l of (solns || []) as any[]) { (linesBySo[l.sales_order_id] ||= []).push({ sku: l.sku, description: l.description, quantity: l.quantity != null ? Number(l.quantity) : null, shipped: l.quantity_shipped != null ? Number(l.quantity_shipped) : null, unit: l.unit_of_measure, unit_price: l.unit_price != null ? Number(l.unit_price) : null, status: l.production_status || null, qty_per_case: l.qty_per_case != null ? Number(l.qty_per_case) : null }) }
    }
    const commissionOf = (selling: number, cost: number | null, basis: string) => basis === 'none' ? 0 : basis === 'profit_50' ? Math.max(0, selling - (cost || 0)) * 0.5 : selling * 0.07
    const mapOrder = (o: any, selling: number, po_url: string | null, source: string) => {
      const cost = o.broker_cost != null ? Number(o.broker_cost) : null
      const basis = o.broker_commission_basis || 'po_7'
      const commission = commissionOf(selling, cost, basis)
      const cstatus = o.broker_commission_status || (o.broker_commission_paid ? 'paid_by_bg' : 'waiting_customer')
      const profit = cost != null ? selling - cost : null
      return { id: o.id, source, name: o.client_portal_name || o.order_number || o.po_number || o.customer_name || 'Project', po_number: o.po_number || null, po_url, status: o.status || o.delivery_status || null, cost, selling, profit, basis, commission, commission_status: cstatus, commission_status_label: STATUS_LABEL[cstatus] || 'Waiting on Customer Payment', lines: source === 'sales_order' ? (linesBySo[o.id] || []) : [] }
    }
    const allSo = ((bdeals || []) as any[]).map(o => mapOrder(o, Number(o.total_amount ?? o.total ?? o.subtotal ?? 0), o.purchase_order_url || null, 'sales_order'))
    const shipMapped = ((bships || []) as any[]).map(s => mapOrder(s, Number(s.total_value ?? 0), s.packing_slip_url || s.pod_file_url || null, 'shipment'))
    const openOrders = allSo.filter(o => !COMPLETED.has(o.status || ''))
    const completedOrders = [...allSo.filter(o => COMPLETED.has(o.status || '')), ...shipMapped]
    const openRfqs = ((brfqs || []) as any[])
      .filter(r => (r.is_active === undefined || r.is_active) && !RFQ_CLOSED.has(String(r.status || '').toLowerCase()))
      .map(r => ({ id: r.id, number: r.quote_number || 'RFQ', name: r.client_portal_name || r.quote_number || 'RFQ', status: r.status || null, date: r.created_at, notes: r.notes || null, price_term: r.price_term || null, export_country: r.export_country || null, art_files: artByRfq[r.id] || [], lines: linesByRfq[r.id] || [] }))
    const ar = [...openOrders, ...completedOrders].filter(o => o.commission_status !== 'paid_by_bg').reduce((s, o) => s + o.commission, 0)
    const sum = (arr: any[], f: (o: any) => number) => arr.reduce((s, o) => s + (f(o) || 0), 0)
    const revenueActive = sum(openOrders, o => o.selling)
    const revenueCompleted = sum(completedOrders, o => o.selling)
    const totalRevenue = revenueActive + revenueCompleted
    const totalCost = sum([...openOrders, ...completedOrders], o => o.cost || 0)
    const totalProfit = totalRevenue - totalCost
    broker = { ar, openRfqs, openOrders, completedOrders, revenueActive, revenueCompleted, totalRevenue, totalProfit }
  }

  const team = await buildTeam()

  return NextResponse.json(
    { client: { name: client.name, company }, projects, broker, team },
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
    const link = `${PORTAL_URL}/portal/set-password?token=${token}`
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
      await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: `beyondGREEN <${FROM_EMAIL}>`, to: [NOTIFY], reply_to: client.email || undefined, bcc: ['info@byndgrn.com'], subject: `Client message — ${company || client.name || client.email}`, html }) }).catch(() => {})
    }
    return NextResponse.json({ ok: true })
  }

  // ── Portal: list comments on one record (client + team thread) ──
  if (action === 'comments') {
    const client = await clientFromRequest(req)
    if (!client) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const body = await req.json().catch(() => ({})) as any
    const rt = String(body.record_type || ''); const rid = String(body.record_id || '')
    const own = await ownsRecord(client, rt, rid)
    if (!own.ok) return NextResponse.json({ error: 'not found' }, { status: 404 })
    const { data } = await admin.from('comments').select('id, author_email, content, created_at').eq('record_type', rt).eq('record_id', rid).eq('client_visible', true).order('created_at', { ascending: true })
    const clientEmail = (client.email || '').toLowerCase()
    const items = ((data || []) as any[]).map(c => {
      const email = String(c.author_email || '').toLowerCase()
      const isStaff = STAFF_DOMAINS.includes(email.split('@')[1] || '')
      return { id: c.id, content: c.content, date: c.created_at, mine: email === clientEmail && !isStaff, staff: isStaff, author: isStaff ? 'beyondGREEN team' : (email === clientEmail ? 'You' : (c.author_email || 'Client')) }
    })
    return NextResponse.json({ comments: items })
  }

  // ── Portal: post a comment on one record; notifies + emails Rudy ──
  if (action === 'comment-add') {
    const client = await clientFromRequest(req)
    if (!client) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const body = await req.json().catch(() => ({})) as any
    const rt = String(body.record_type || ''); const rid = String(body.record_id || '')
    const content = String(body.content || '').trim()
    if (!content) return NextResponse.json({ error: 'Please enter a comment.' }, { status: 400 })
    if (content.length > 5000) return NextResponse.json({ error: 'Comment is too long.' }, { status: 400 })
    const own = await ownsRecord(client, rt, rid)
    if (!own.ok) return NextResponse.json({ error: 'not found' }, { status: 404 })
    const { data: ins, error } = await admin.from('comments').insert({ record_type: rt, record_id: rid, author_email: client.email, content, client_visible: true }).select('id, created_at').single()
    if (error) return NextResponse.json({ error: 'Could not post comment.' }, { status: 500 })
    const company = await companyName(client)
    await admin.from('notifications').insert({ recipient_email: NOTIFY, sender_email: client.email || 'client-portal', message: `${company || client.name || 'Client'} commented on ${own.label}: ${content.slice(0, 200)}`, page: 'Client Portal', is_read: false, context_url: `${SITE}/bizdev/client-portals` }).then(() => {}, () => {})
    if (RESEND_API_KEY) {
      const html = shell(`<p style="margin:0 0 6px;font-size:16px;font-weight:700">New client comment</p><p style="margin:0 0 10px;font-size:14px">${esc(company || client.name || 'A client')} commented on <strong>${esc(own.label || 'a record')}</strong>:</p><div style="background:#f5f6fa;border-left:3px solid #037f4c;padding:12px 16px;border-radius:0 8px 8px 0;font-size:14px;white-space:pre-wrap">${esc(content)}</div><div style="margin:16px 0"><a href="${SITE}/bizdev/client-portals" style="display:inline-block;background:#037f4c;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600">Open in the ERP</a></div>`)
      await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: `beyondGREEN <${FROM_EMAIL}>`, to: [NOTIFY], reply_to: client.email || undefined, bcc: ['info@byndgrn.com'], subject: `Client comment — ${own.label || company || client.email}`, html }) }).catch(() => {})
    }
    return NextResponse.json({ ok: true, id: (ins as any)?.id, date: (ins as any)?.created_at })
  }

  // ── Portal: client edits the line items of an OPEN (non-accepted) RFQ ──
  if (action === 'rfq-update') {
    const client = await clientFromRequest(req)
    if (!client) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const body = await req.json().catch(() => ({})) as any
    const rfqId = String(body.rfq_id || '')
    const lines = Array.isArray(body.lines) ? body.lines : []
    const { data: q } = await admin.from('quotations').select('customer_id, type, status').eq('id', rfqId).maybeSingle()
    const qq = q as any
    if (!qq || qq.customer_id !== client.customer_id || qq.type !== 'rfq') return NextResponse.json({ error: 'not found' }, { status: 404 })
    if (String(qq.status || '').toLowerCase() === 'accepted') return NextResponse.json({ error: 'This RFQ is accepted and can no longer be edited.' }, { status: 400 })
    // Preserve our quoted prices (client can't change pricing): map existing prices by line id
    const { data: existing } = await admin.from('quotation_lines').select('id, unit_price, case_price').eq('quotation_id', rfqId)
    const priceById: Record<string, any> = {}
    for (const l of (existing || []) as any[]) priceById[l.id] = l
    await admin.from('quotation_lines').delete().eq('quotation_id', rfqId)
    const rows = lines
      .filter((l: any) => l && (l.description || l.sku || (Number(l.quantity) || 0) > 0))
      .map((l: any) => {
        const prev = l.id ? priceById[l.id] : null
        const qty = Number(l.quantity) || 0
        const unit = prev ? (Number(prev.unit_price) || 0) : 0
        return { quotation_id: rfqId, sku: l.sku || null, description: l.description || null, quantity: qty, unit_of_measure: l.unit_of_measure || null, pcs_per_case: l.pcs_per_case != null && l.pcs_per_case !== '' ? Number(l.pcs_per_case) : null, case_price: prev ? prev.case_price : null, unit_price: unit, line_total: qty * unit }
      })
    if (rows.length) { const { error } = await admin.from('quotation_lines').insert(rows); if (error) return NextResponse.json({ error: 'Could not save changes.' }, { status: 500 }) }
    const company = await companyName(client)
    await admin.from('notifications').insert({ recipient_email: NOTIFY, sender_email: client.email || 'client-portal', message: `${company || client.name || 'Client'} edited RFQ line items — please review.`, page: 'Client Portal', is_read: false, context_url: `${SITE}/sales/quotations` }).then(() => {}, () => {})
    if (RESEND_API_KEY) {
      const html = shell(`<p style="margin:0 0 6px;font-size:16px;font-weight:700">Client updated an RFQ</p><p style="margin:0 0 10px;font-size:14px">${esc(company || client.name || 'A client')} made changes to the items on an open RFQ. Review the updated line items in the ERP.</p><div style="margin:16px 0"><a href="${SITE}/sales/quotations" style="display:inline-block;background:#037f4c;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600">Open RFQs</a></div>`)
      await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: `beyondGREEN <${FROM_EMAIL}>`, to: [NOTIFY], reply_to: client.email || undefined, bcc: ['info@byndgrn.com'], subject: `RFQ edited by ${company || client.name || 'client'}`, html }) }).catch(() => {})
    }
    return NextResponse.json({ ok: true })
  }

  // ── Portal: message a specific team member (DM in the ERP + email) ──
  if (action === 'message-user') {
    const client = await clientFromRequest(req)
    if (!client) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const body = await req.json().catch(() => ({})) as any
    const kind = String(body.kind || 'direct')
    const content = String(body.content || '').trim()
    if (!content) return NextResponse.json({ error: 'Please enter a message.' }, { status: 400 })
    if (content.length > 5000) return NextResponse.json({ error: 'Message is too long.' }, { status: 400 })
    const targets: string[] = kind === 'group' ? PORTAL_TEAM.map(m => m.email.toLowerCase()) : [String(body.recipient_email || '').toLowerCase().trim()]
    if (kind !== 'group' && !TEAM_EMAILS.has(targets[0])) return NextResponse.json({ error: 'Unknown recipient.' }, { status: 400 })
    const company = await companyName(client)
    const senderName = `${company || 'Client'}${client.name ? ` (${client.name})` : ''}`
    const threadKey = kind === 'group' ? `grp:${client.id}` : `dm:${client.id}:${targets[0]}`
    const rows = targets.map(t => ({ sender_email: client.email || 'client-portal', sender_name: senderName, recipient_email: t, content, thread_key: threadKey }))
    await admin.from('direct_messages').insert(rows)
    for (const t of targets) { await admin.from('notifications').insert({ recipient_email: t, sender_email: client.email || 'client-portal', message: `New message from ${company || client.name || 'a client'}: ${content.slice(0, 200)}`, page: 'Messages', is_read: false, type: 'message' }).then(() => {}, () => {}) }
    if (RESEND_API_KEY) {
      const isGroup = kind === 'group'
      const html = shell(`<p style="margin:0 0 6px;font-size:16px;font-weight:700">New message from ${esc(company || 'a client')}</p><p style="margin:0 0 10px;font-size:14px">You received a new ${isGroup ? 'team ' : ''}message from <strong>${esc(company || client.name || 'a client')}</strong> in the client portal:</p><div style="background:#f5f6fa;border-left:3px solid #037f4c;padding:12px 16px;border-radius:0 8px 8px 0;font-size:14px;white-space:pre-wrap">${esc(content)}</div><div style="margin:16px 0"><a href="${SITE}/messages" style="display:inline-block;background:#037f4c;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600">Open your messages</a></div>`)
      await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: `beyondGREEN <${FROM_EMAIL}>`, to: targets, cc: [NOTIFY], reply_to: client.email || undefined, bcc: ['info@byndgrn.com'], subject: isGroup ? `New team message from ${company || client.name || 'client'}` : `New message from ${company || client.name || 'client'}`, html }) }).catch(() => {})
    }
    return NextResponse.json({ ok: true })
  }

  // ── Portal: fetch a persistent message thread (1:1 with a member, or the whole-team group) ──
  if (action === 'thread') {
    const client = await clientFromRequest(req)
    if (!client) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const body = await req.json().catch(() => ({})) as any
    const kind = String(body.kind || 'direct')
    const me = client.email || 'client-portal'
    const meLower = me.toLowerCase()
    const nameFor = (email: string) => { const e = (email || '').toLowerCase(); if (e === meLower) return 'You'; const m = PORTAL_TEAM.find(x => x.email.toLowerCase() === e); return m ? m.name : 'beyondGREEN team' }
    let msgs: any[] = []
    if (kind === 'group') {
      const grpKey = `grp:${client.id}`
      const { data: a } = await admin.from('direct_messages').select('id, sender_email, content, created_at').eq('thread_key', grpKey)
      const { data: b } = await admin.from('direct_messages').select('id, sender_email, content, created_at').eq('recipient_email', me).is('thread_key', null)
      const teamReplies = ((b || []) as any[]).filter(r => TEAM_EMAILS.has(String(r.sender_email).toLowerCase()))
      const seen = new Set<string>()
      msgs = [...((a || []) as any[]), ...teamReplies].filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true })
    } else {
      const to = String(body.recipient_email || '').toLowerCase().trim()
      if (!TEAM_EMAILS.has(to)) return NextResponse.json({ error: 'Unknown recipient.' }, { status: 400 })
      const { data } = await admin.from('direct_messages').select('id, sender_email, content, created_at, thread_key').or(`and(sender_email.eq.${me},recipient_email.eq.${to}),and(sender_email.eq.${to},recipient_email.eq.${me})`)
      msgs = ((data || []) as any[]).filter(r => !String(r.thread_key || '').startsWith('grp:'))
    }
    msgs.sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)))
    const items = msgs.map(r => ({ id: r.id, content: r.content, date: r.created_at, mine: String(r.sender_email).toLowerCase() === meLower, author: nameFor(r.sender_email) }))
    return NextResponse.json({ messages: items })
  }

  // ── Staff: when a staff comment is posted in the ERP, email the connected portal client ──
  if (action === 'notify-comment') {
    const staff = await staffEmail(req)
    if (!staff) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    // Internal ERP comments are private to staff and must never be emailed to the client
    // portal. Client-facing communication goes through the portal message / DM channels.
    return NextResponse.json({ ok: true, disabled: true })
    // eslint-disable-next-line no-unreachable
    const body = await req.json().catch(() => ({})) as any
    const rt = String(body.record_type || ''); const rid = String(body.record_id || '')
    const content = String(body.content || '').trim()
    if (!rt || !rid || !content) return NextResponse.json({ ok: false })
    let customerId: string | null = null; let label: string | null = null
    if (rt === 'sales_order') { const { data } = await admin.from('sales_orders').select('customer_id, client_portal_name, order_number, po_number').eq('id', rid).maybeSingle(); const s = data as any; if (s) { customerId = s.customer_id; label = s.client_portal_name || s.order_number || s.po_number || 'your order' } }
    else if (rt === 'quotation') { const { data } = await admin.from('quotations').select('customer_id, client_portal_name, quote_number').eq('id', rid).maybeSingle(); const s = data as any; if (s) { customerId = s.customer_id; label = s.client_portal_name || s.quote_number || 'your RFQ' } }
    if (!customerId) return NextResponse.json({ ok: false })
    const { data: c } = await admin.from('portal_clients').select('email, name, company_name, is_active').eq('customer_id', customerId).maybeSingle()
    const cl = c as any
    if (!cl || !cl.is_active || !cl.email) return NextResponse.json({ ok: false })
    if (RESEND_API_KEY) {
      const inner = `<p style="margin:0 0 6px;font-size:16px;font-weight:700">New reply from the beyondGREEN team</p><p style="margin:0 0 10px;font-size:14px">There's a new comment on <strong>${esc(label || 'your project')}</strong>:</p><div style="background:#f5f6fa;border-left:3px solid #037f4c;padding:12px 16px;border-radius:0 8px 8px 0;font-size:14px;white-space:pre-wrap">${esc(content)}</div><div style="margin:16px 0"><a href="${PORTAL_URL}/portal" style="display:inline-block;background:#037f4c;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600">View in your portal</a></div>`
      await sendClientEmail(cl.email, `New reply on ${label || 'your project'}`, inner)
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'not found' }, { status: 404 })
}
