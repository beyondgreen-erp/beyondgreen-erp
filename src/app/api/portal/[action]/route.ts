import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { clientStage, type StageTone } from '@/lib/portalStages'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/* eslint-disable @typescript-eslint/no-explicit-any */

const COOKIE = 'bg_portal'
const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://beyondgreen-erp.vercel.app'
const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM_EMAIL = process.env.FROM_EMAIL || 'erp@beyondgreenbiotech.com'
const NOTIFY = 'Rudyp@beyondgreenbiotech.com'
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

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

async function companyName(client: PortalClient): Promise<string | null> {
  if (client.company_name) return client.company_name
  if (client.customer_id) {
    const { data } = await admin.from('customers').select('company_name').eq('id', client.customer_id).maybeSingle()
    return (data as any)?.company_name || null
  }
  return null
}

export async function GET(req: NextRequest, { params }: { params: { action: string } }) {
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
