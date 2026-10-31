// Client portal self-service API.
//   Client (portal session cookie): account, orders, catalog, projects, quotes, slots, bookings, documents,
//     signup, reset, onboarding-save, upload-url, order-request, order-cancel, project-create,
//     quote-accept, quote-changes, book, booking-cancel
//   Staff (ERP login): staff-approve, staff-link, order-convert, order-decline, booking-confirm
import { NextRequest, NextResponse } from 'next/server'
import { clientStage } from '@/lib/portalStages'
import {
  admin, accountFromRequest, staffEmail, token, emailClient, notifyTeam, companyOf, esc, button, sendEmail,
  NOTIFY, NOTIFY_ORDERS, NOTIFY_PROJECTS, NOTIFY_SIGNUPS, PORTAL_URL, safeFileName, signedUpload,
  signedDownload, objectExists, BUCKET, likeExact, type PortalAccount,
} from '@/lib/portalServer'
import {
  BOOKING_HOST, SLOT_MINUTES, BOOKING_TZ, candidateSlots, outlookBusy, freeSlots, createZoomMeeting,
  createOutlookEvent, cancelOutlookEvent, fmtSlot,
} from '@/lib/portalBooking'

export const dynamic = 'force-dynamic'
export const revalidate = 0
/* eslint-disable @typescript-eslint/no-explicit-any */

const J = (body: any, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
const bad = (msg: string, status = 400) => J({ error: msg }, status)
const str = (v: any, max = 500) => String(v ?? '').trim().slice(0, max)
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const isUuid = (v: any) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''))
const CLOSED_SO = new Set(['Shipped', 'Closed', 'Cancelled', 'Completed', 'Delivered'])
const fmtDay = (d: string | null) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

async function nextQuoteNumber(): Promise<string> {
  const year = new Date().getFullYear()
  const { data } = await admin.from('quotations').select('quote_number').ilike('quote_number', `Q-${year}-%`)
  const re = new RegExp(`^Q-${year}-(\\d+)$`)
  let max = 0
  for (const r of (data || []) as any[]) { const m = re.exec(String(r.quote_number || '')); if (m) max = Math.max(max, Number(m[1])) }
  return `Q-${year}-${String(max + 1).padStart(4, '0')}`
}

function ownsPath(acct: PortalAccount, path: string, kind?: string): boolean {
  const p = String(path || '')
  if (p.includes('..')) return false
  return p.startsWith(`portal/${acct.id}/${kind ? kind + '/' : ''}`)
}

// Sales orders that belong to this customer (all of them, not only ones flagged for the portal).
async function customerOrders(customerId: string) {
  const { data } = await admin.from('sales_orders')
    .select('id, order_number, po_number, order_date, required_ship_date, ship_date, status, client_portal_name, total, carrier, tracking_number, created_at, archived, is_active')
    .eq('customer_id', customerId).not('archived', 'is', true).not('is_active', 'is', false)
    .order('created_at', { ascending: false }).limit(200)
  return ((data || []) as any[]).filter(o => String(o.status || '').toLowerCase() !== 'draft')
}

// ═══════════════════════════════ GET ═══════════════════════════════
export async function GET(req: NextRequest, { params }: { params: { action: string } }) {
  const action = params.action
  const acct = await accountFromRequest(req)
  if (!acct) return bad('unauthorized', 401)
  const company = await companyOf(acct)
  const approved = !!acct.approved_at && !!acct.customer_id

  if (action === 'account') {
    let customer: any = null
    if (acct.customer_id) {
      const { data } = await admin.from('customers').select('company_name, billing_address, shipping_address, payment_terms, phone, website, customer_status').eq('id', acct.customer_id).maybeSingle()
      customer = data
    }
    const [{ count: openReq }, { count: upcoming }] = await Promise.all([
      admin.from('portal_order_requests').select('id', { count: 'exact', head: true }).eq('portal_client_id', acct.id).eq('status', 'Submitted'),
      admin.from('portal_bookings').select('id', { count: 'exact', head: true }).eq('portal_client_id', acct.id).in('status', ['Confirmed', 'Requested']).gte('start_at', new Date().toISOString()),
    ])
    return J({
      account: { name: acct.name, email: acct.email, phone: acct.phone, title: acct.title, company, approved, verified: !!acct.email_verified_at, linked: !!acct.customer_id, onboarding: acct.onboarding || {}, onboarding_submitted_at: acct.onboarding_submitted_at },
      customer: customer ? { company_name: customer.company_name, billing_address: customer.billing_address, shipping_address: customer.shipping_address, payment_terms: customer.payment_terms, status: customer.customer_status } : null,
      counts: { open_order_requests: openReq || 0, upcoming_calls: upcoming || 0 },
    })
  }

  if (action === 'orders') {
    const requests = ((await admin.from('portal_order_requests').select('id, request_number, po_number, po_file_name, requested_ship_date, status, lines, notes, decline_reason, sales_order_id, created_at').eq('portal_client_id', acct.id).order('created_at', { ascending: false }).limit(100)).data || []) as any[]
    if (!acct.customer_id) return J({ approved, orders: [], past_shipments: [], invoices: [], requests })
    const orders = await customerOrders(acct.customer_id)
    const ids = orders.map(o => o.id)
    const linesBy: Record<string, any[]> = {}, shipsBy: Record<string, any[]> = {}
    let invoices: any[] = []
    if (ids.length) {
      const [{ data: lns }, { data: shs }, { data: inv }] = await Promise.all([
        admin.from('sales_order_lines').select('sales_order_id, line_number, sku, description, quantity, qty, quantity_shipped, unit_of_measure, unit_price, product_id').in('sales_order_id', ids).order('line_number', { ascending: true }),
        admin.from('shipments').select('sales_order_id, ship_date, carrier, tracking_number, delivery_status, status, bol_number').in('sales_order_id', ids).order('ship_date', { ascending: false }),
        admin.from('invoices').select('sales_order_id, invoice_number_display, invoice_number, invoice_date, due_date, total_amount, balance_due, status, po_number').eq('customer_id', acct.customer_id).not('is_active', 'is', false).order('invoice_date', { ascending: false }).limit(200),
      ])
      for (const l of (lns || []) as any[]) (linesBy[l.sales_order_id] ||= []).push({ sku: l.sku, description: l.description, quantity: num(l.quantity ?? l.qty), shipped: num(l.quantity_shipped), unit: l.unit_of_measure, unit_price: l.unit_price != null ? Number(l.unit_price) : null, product_id: l.product_id })
      for (const s of (shs || []) as any[]) (shipsBy[s.sales_order_id] ||= []).push({ date: s.ship_date, carrier: s.carrier, tracking: s.tracking_number, status: s.status || s.delivery_status, bol: s.bol_number })
      invoices = ((inv || []) as any[]).map(i => ({ number: i.invoice_number_display || (i.invoice_number ? String(i.invoice_number) : ''), date: i.invoice_date, due: i.due_date, total: num(i.total_amount), balance: num(i.balance_due), status: i.status, po: i.po_number, sales_order_id: i.sales_order_id }))
    }
    const mapped = orders.map(o => {
      const st = clientStage('so', o.status)
      return { id: o.id, number: o.order_number, po: o.po_number, name: o.client_portal_name || null, date: o.order_date || o.created_at, ship_by: o.required_ship_date, shipped_on: o.ship_date, stage: st, open: !CLOSED_SO.has(o.status || ''), total: num(o.total), carrier: o.carrier, tracking: o.tracking_number, lines: linesBy[o.id] || [], shipments: shipsBy[o.id] || [] }
    })
    // Older history imported from QuickBooks lives in shipments with only a customer name.
    let past_shipments: any[] = []
    const { data: cust } = await admin.from('customers').select('company_name, merged_from_names').eq('id', acct.customer_id).maybeSingle()
    const names = [(cust as any)?.company_name, ...(((cust as any)?.merged_from_names || []) as string[])].filter(Boolean)
    if (names.length) {
      const { data: ps } = await admin.from('shipments').select('ship_date, order_date, po_number, carrier, tracking_number, delivery_status, total_value').is('sales_order_id', null).in('customer_name', names).order('ship_date', { ascending: false, nullsFirst: false }).limit(150)
      past_shipments = ((ps || []) as any[]).map(s => ({ date: s.ship_date || s.order_date, po: s.po_number, carrier: s.carrier, tracking: s.tracking_number, status: s.delivery_status, total: num(s.total_value) }))
    }
    return J({ approved, orders: mapped, past_shipments, invoices, requests })
  }

  if (action === 'catalog') {
    const q = str(req.nextUrl.searchParams.get('q'), 60)
    const items: Record<string, any> = {}
    if (acct.customer_id) {
      const orders = await customerOrders(acct.customer_id)
      const ids = orders.map(o => o.id)
      const dateBy: Record<string, string> = {}
      orders.forEach(o => { dateBy[o.id] = o.order_date || o.created_at })
      if (ids.length) {
        const { data: lns } = await admin.from('sales_order_lines').select('sales_order_id, sku, description, unit_of_measure, unit_price, product_id, quantity, qty').in('sales_order_id', ids)
        for (const l of (lns || []) as any[]) {
          const key = (l.sku || l.description || '').trim().toUpperCase()
          if (!key) continue
          const when = dateBy[l.sales_order_id] || ''
          const cur = items[key]
          if (!cur || when > cur.last_ordered) items[key] = { sku: l.sku, description: l.description, unit: l.unit_of_measure, last_price: l.unit_price != null ? Number(l.unit_price) : null, product_id: l.product_id, last_qty: num(l.quantity ?? l.qty), last_ordered: when, times: (cur?.times || 0) + 1 }
          else cur.times = (cur.times || 0) + 1
        }
      }
    }
    const pids = Object.values(items).map((i: any) => i.product_id).filter(Boolean)
    if (pids.length) {
      const { data: ps } = await admin.from('products').select('id, product_name, case_qty, pieces_per_pack, packs_per_case, product_image_url, is_discontinued').in('id', pids)
      const byId: Record<string, any> = {}; (ps || []).forEach((p: any) => { byId[p.id] = p })
      Object.values(items).forEach((i: any) => { const p = byId[i.product_id]; if (p) { i.name = p.product_name; i.case_qty = p.case_qty; i.image = p.product_image_url; i.discontinued = !!p.is_discontinued } })
    }
    let search: any[] = []
    if (q.length >= 2) {
      const { data } = await admin.from('products').select('id, sku, product_name, unit_of_measure, case_qty, product_image_url, product_category').eq('is_active', true).not('is_discontinued', 'is', true).or(`product_name.ilike.%${q.replace(/[,()%]/g, ' ')}%,sku.ilike.%${q.replace(/[,()%]/g, ' ')}%`).limit(25)
      search = ((data || []) as any[]).map(p => ({ product_id: p.id, sku: p.sku, name: p.product_name, description: p.product_name, unit: p.unit_of_measure, case_qty: p.case_qty, image: p.product_image_url, category: p.product_category }))
    }
    const list = Object.values(items).sort((a: any, b: any) => (b.last_ordered || '').localeCompare(a.last_ordered || ''))
    return J({ approved, items: list, search })
  }

  if (action === 'projects') {
    if (!acct.customer_id) return J({ projects: [] })
    const { data: rfqs } = await admin.from('quotations').select('id, quote_number, client_portal_name, status, notes, created_at, updated_at').eq('customer_id', acct.customer_id).eq('type', 'rfq').not('is_active', 'is', false).order('created_at', { ascending: false }).limit(100)
    const list = (rfqs || []) as any[]
    const ids = list.map(r => r.id)
    const filesBy: Record<string, any[]> = {}, quotesBy: Record<string, any[]> = {}
    if (ids.length) {
      const { data: fa } = await admin.from('file_attachments').select('record_id, file_name, storage_path').eq('record_type', 'quotation_art').in('record_id', ids)
      for (const f of (fa || []) as any[]) (filesBy[f.record_id] ||= []).push({ name: f.file_name, url: await signedDownload(f.storage_path) })
    }
    const { data: hist } = ids.length ? await admin.from('portal_status_history').select('source_id, status, created_at').eq('source_type', 'quotation').in('source_id', ids).order('created_at', { ascending: true }) : { data: [] as any[] }
    const histBy: Record<string, any[]> = {}
    for (const h of (hist || []) as any[]) (histBy[h.source_id] ||= []).push(h)
    // Formal quotes the team issued for this customer after each project was opened
    const { data: qs } = await admin.from('quotations').select('id, quote_number, status, created_at').eq('customer_id', acct.customer_id).neq('type', 'rfq').in('status', ['Sent', 'Accepted', 'Converted']).order('created_at', { ascending: false }).limit(50)
    const formal = (qs || []) as any[]
    for (const r of list) quotesBy[r.id] = formal.filter(q => q.created_at >= r.created_at).map(q => ({ id: q.id, number: q.quote_number, status: q.status }))
    const projects = list.map(r => {
      const projStage = (() => {
        const s = String(r.status || '').toLowerCase()
        if (s.includes('accept') || s.includes('convert') || s.includes('won')) return { label: 'Approved', tone: 'green' }
        if (s.includes('sent') || s.includes('quoted')) return { label: 'Quote Ready', tone: 'blue' }
        if (s.includes('reject') || s.includes('lost') || s.includes('declin')) return { label: 'Closed', tone: 'red' }
        if (s.includes('expire')) return { label: 'Expired', tone: 'gray' }
        return { label: 'In Review', tone: 'amber' }
      })()
      return { id: r.id, number: r.quote_number, name: r.client_portal_name || r.quote_number, stage: projStage, created: r.created_at, updated: r.updated_at, details: r.notes, files: filesBy[r.id] || [], quotes: quotesBy[r.id] || [], history: (histBy[r.id] || []).map(h => ({ status: h.status, date: h.created_at })) }
    })
    return J({ projects })
  }

  if (action === 'quotes') {
    if (!acct.customer_id) return J({ quotes: [] })
    const { data: qs } = await admin.from('quotations')
      .select('id, quote_number, status, quote_date, expiry_date, subtotal, total, total_value, payment_terms, price_term, notes, client_portal_name, client_portal_visible, doc_style, type')
      .eq('customer_id', acct.customer_id).neq('type', 'rfq').not('is_active', 'is', false)
      .order('created_at', { ascending: false }).limit(100)
    // Only quotes that were actually sent (or explicitly shared) — never drafts.
    const list = ((qs || []) as any[]).filter(q => q.client_portal_visible || ['Sent', 'Accepted', 'Converted', 'Expired', 'Rejected', 'Quoted'].includes(q.status))
      .filter(q => !['Draft', 'Quoting'].includes(q.status))
    const ids = list.map(q => q.id)
    const linesBy: Record<string, any[]> = {}
    if (ids.length) {
      const { data: lns } = await admin.from('quotation_lines').select('quotation_id, quote_id, line_number, sku, description, product_name, quantity, qty, unit_of_measure, unit_price, line_total, pcs_per_case, case_price').or(`quotation_id.in.(${ids.join(',')}),quote_id.in.(${ids.join(',')})`).order('line_number', { ascending: true })
      for (const l of (lns || []) as any[]) {
        const k = l.quotation_id || l.quote_id
        const qty = num(l.quantity ?? l.qty)
        ;(linesBy[k] ||= []).push({ sku: l.sku, description: l.description || l.product_name, quantity: qty, unit: l.unit_of_measure, unit_price: l.unit_price != null ? Number(l.unit_price) : null, line_total: l.line_total != null ? Number(l.line_total) : (l.unit_price != null ? qty * Number(l.unit_price) : null), pcs_per_case: l.pcs_per_case, case_price: l.case_price })
      }
    }
    const today = new Date().toISOString().slice(0, 10)
    const quotes = list.map(q => {
      const expired = q.expiry_date && q.expiry_date < today && q.status === 'Sent'
      const isEstimate = q.doc_style === 'estimate'
      return { id: q.id, number: q.quote_number, name: q.client_portal_name, status: expired ? 'Expired' : q.status, stage: clientStage('quote', expired ? 'expired' : q.status), date: q.quote_date, expires: q.expiry_date, total: isEstimate ? null : num(q.total || q.total_value), terms: q.payment_terms, price_term: q.price_term, notes: q.notes, estimate: isEstimate, can_accept: q.status === 'Sent' && !expired && !isEstimate, lines: linesBy[q.id] || [] }
    })
    return J({ quotes })
  }

  if (action === 'slots') {
    const cands = candidateSlots()
    if (!cands.length) return J({ mode: 'request', tz: BOOKING_TZ, slots: [] })
    const busy = await outlookBusy(cands[0].start, cands[cands.length - 1].end)
    // Also remove slots already booked through the portal
    const { data: booked } = await admin.from('portal_bookings').select('start_at, end_at').eq('host_email', BOOKING_HOST).eq('status', 'Confirmed').gte('start_at', cands[0].start.toISOString())
    const portalBusy = ((booked || []) as any[]).map(b => ({ start: Date.parse(b.start_at), end: Date.parse(b.end_at) }))
    const mode = busy ? 'live' : 'request'
    const free = freeSlots(cands, [...(busy || []), ...portalBusy])
    return J({ mode, tz: BOOKING_TZ, minutes: SLOT_MINUTES, slots: free.map(s => s.start.toISOString()) })
  }

  if (action === 'bookings') {
    const { data } = await admin.from('portal_bookings').select('id, topic, start_at, end_at, status, zoom_join_url, preferred_times, notes, created_at').eq('portal_client_id', acct.id).order('start_at', { ascending: false, nullsFirst: true }).limit(50)
    return J({ bookings: data || [] })
  }

  if (action === 'documents') {
    const { data } = await admin.from('portal_shared_documents').select('id, name, category, description, storage_path, url, sort').eq('is_active', true).order('sort', { ascending: true })
    const docs = []
    for (const d of (data || []) as any[]) docs.push({ id: d.id, name: d.name, category: d.category, description: d.description, url: d.url || (d.storage_path ? await signedDownload(d.storage_path, 900) : null) })
    return J({ documents: docs })
  }

  return bad('not found', 404)
}

// ═══════════════════════════════ POST ══════════════════════════════
// Public website forms (byndgrn.com / beyondgreenbiotech.com / the new site) post here cross-origin.
const FORM_ORIGINS = ['https://byndgrn.com', 'https://www.byndgrn.com', 'https://beyondgreenbiotech.com', 'https://www.beyondgreenbiotech.com', 'https://beyondgreen-site.vercel.app', 'http://localhost:3123']
function corsHeaders(req: NextRequest): Record<string, string> {
  const o = req.headers.get('origin') || ''
  const ok = FORM_ORIGINS.includes(o) || /^https:\/\/beyondgreen-site-[a-z0-9-]+\.vercel\.app$/.test(o)
  return ok ? { 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' } : {}
}
export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) })
}

const TOPIC_ROUTE: Record<string, string[]> = {}
const SALES_TOPICS = ['Buy for my business', 'Contract manufacturing', 'Private label', 'Custom printing', 'Order support', 'Samples', 'Distributor or reseller', 'Spec sheet request']

async function websiteForm(req: NextRequest, body: any): Promise<NextResponse> {
  const h = corsHeaders(req)
  const out = (b: any, status = 200) => NextResponse.json(b, { status, headers: { ...h, 'Cache-Control': 'no-store' } })
  if (str(body.website_url)) return out({ ok: true })
  // Internal page-by-page site review notes (review mode on the website). Stored only: no emails, no leads.
  if (body.kind === 'site-review') {
    const key = str(body.review_key, 100)
    const { data: cfg } = await admin.from('portal_config').select('value').eq('key', 'site_review_key').maybeSingle()
    if (!key || !cfg || key !== String((cfg as any).value)) return out({ error: 'Review link expired. Ask Claude for a new one.' }, 403)
    if (body.list) {
      const { data } = await admin.from('website_inquiries').select('id, page, message, details, status, created_at').eq('kind', 'site-review').order('created_at', { ascending: true }).limit(500)
      return out({ ok: true, notes: data || [] })
    }
    const message = str(body.message, 5000)
    if (!message && !(Array.isArray(body.changes) && body.changes.length)) return out({ error: 'Add a change first.' }, 400)
    const details: Record<string, string> = {}
    for (const k of ['element', 'status', 'viewport', 'batch', 'tag']) if (str(body[k])) details[k] = str(body[k], 600)
    // A page submission sends several changes at once; each change is its own row (status Submitted) so it can be tracked to Done.
    const items: any[] = Array.isArray(body.changes) ? body.changes.slice(0, 40) : [{ message, element: body.element, tag: body.tag }]
    const rows = items.map((c: any) => ({ kind: 'site-review', topic: 'Site review', name: str(body.name, 120) || 'Rudy Patel', email: 'rudyp@beyondgreenbiotech.com', message: str(c.message, 5000) || message, details: { ...details, element: str(c.element, 600), tag: str(c.tag, 80) }, page: str(body.page, 200) || null, status: str(body.status, 20) === 'approved' ? 'Approved' : 'Submitted' }))
    await admin.from('website_inquiries').insert(rows)
    return out({ ok: true })
  }
  if (num(body.t) && Date.now() - num(body.t) < 2500) return out({ ok: true })
  const name = str(body.name, 120), email = str(body.email, 200).toLowerCase(), company = str(body.company, 200)
  const message = str(body.message, 5000), topic = str(body.topic, 80) || str(body.kind, 40) || 'General'
  if (!name) return out({ error: 'Please enter your name.' }, 400)
  if (!EMAIL_RE.test(email)) return out({ error: 'Please enter a valid email.' }, 400)
  if (!message && body.kind !== 'careers') return out({ error: 'Please add a short message.' }, 400)
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
  if (ip) {
    const { count } = await admin.from('website_inquiries').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', new Date(Date.now() - 3600000).toISOString())
    if ((count || 0) >= 8) return out({ error: 'Too many messages from this network. Please email info@byndgrn.com.' }, 429)
  }
  const extra: Record<string, string> = {}
  for (const k of ['phone', 'role', 'volume', 'products', 'location', 'zip', 'linkedin', 'interest', 'timeline']) if (str(body[k])) extra[k] = str(body[k], 300)
  // Sales-type inquiries become (or attach to) a Lead on Customer/Leads.
  let customerId: string | null = null
  if (SALES_TOPICS.includes(topic) || body.kind === 'contact') {
    const { data: hit } = await admin.from('customers').select('id').ilike('email', likeExact(email)).not('is_merged', 'is', true).limit(1)
    if (hit && hit.length) customerId = (hit[0] as any).id
    else if (SALES_TOPICS.includes(topic)) {
      const { data: created } = await admin.from('customers').insert({ company_name: company || name, contact_name: name, email, phone: extra.phone || null, board: 'customer', customer_status: 'Lead', lead_source: `Website: ${topic}`, is_active: true, is_scraped_lead: false, notes: `Website inquiry (${topic}): ${message.slice(0, 900)}` }).select('id').single()
      customerId = (created as any)?.id || null
    }
  }
  await admin.from('website_inquiries').insert({ kind: str(body.kind, 40) || 'contact', topic, name, company: company || null, email, phone: extra.phone || null, message: message || null, details: extra, page: str(body.page, 200) || null, ip: ip || null, customer_id: customerId })
  const to = topic === 'Order support' ? NOTIFY_ORDERS : NOTIFY_SIGNUPS
  const rows = Object.entries(extra).map(([k, v]) => `<br><strong>${esc(k)}:</strong> ${esc(v)}`).join('')
  await notifyTeam({ to, from: email, subject: `Website: ${topic} · ${company || name}`, message: `Website inquiry (${topic}) from ${name}${company ? ' at ' + company : ''}: ${message.slice(0, 200)}`, html: `<p style="margin:0 0 6px;font-size:16px;font-weight:700">New website inquiry: ${esc(topic)}</p><p style="margin:0 0 8px;font-size:14px;line-height:1.6"><strong>${esc(name)}</strong>${company ? ' · ' + esc(company) : ''}<br>${esc(email)}${rows}</p>${message ? `<div style="background:#f5f6fa;border-left:3px solid #037f4c;padding:12px 16px;font-size:14px;white-space:pre-wrap;line-height:1.5">${esc(message)}</div>` : ''}<p style="font-size:12px;color:#6b7280">Sent from ${esc(str(body.page, 200) || 'the website')}.${customerId ? ' Linked to Customer/Leads.' : ''}</p>`, contextPath: customerId ? `/sales/customers?item=${customerId}` : '/bizdev/client-portals', replyTo: email })
  await sendEmail({ to: [email], subject: 'We received your message', html: `<p style="margin:0 0 10px;font-size:17px;font-weight:700">Thank you, ${esc(name.split(' ')[0])}</p><p style="margin:0 0 8px;font-size:14px;line-height:1.6">We received your message about <strong>${esc(topic)}</strong>. Someone from our team in Santa Ana will reply within one business day.</p><p style="margin:0;font-size:14px;line-height:1.6">If you buy from us regularly, the client portal lets you track orders, upload POs and book a call any time.</p>${button(`${PORTAL_URL}/portal/signup`, 'Open a portal account')}` })
  void TOPIC_ROUTE
  return out({ ok: true })
}

export async function POST(req: NextRequest, { params }: { params: { action: string } }) {
  const action = params.action
  const body = await req.json().catch(() => ({})) as any

  if (action === 'contact') return websiteForm(req, body)

  // ── Public: create an account (verified by the emailed link) ──
  if (action === 'signup') {
    if (str(body.website_url)) return J({ ok: true })                         // honeypot
    if (num(body.t) && Date.now() - num(body.t) < 2500) return J({ ok: true })  // filled in by a bot
    const email = str(body.email, 200).toLowerCase()
    const company = str(body.company, 200)
    const name = str(body.name, 120)
    if (!company) return bad('Please enter your company name.')
    if (!name) return bad('Please enter your name.')
    if (!EMAIL_RE.test(email)) return bad('Please enter a valid work email.')
    const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    if (ip) {
      const { count } = await admin.from('portal_clients').select('id', { count: 'exact', head: true }).eq('signup_ip', ip).gte('created_at', new Date(Date.now() - 3600000).toISOString())
      if ((count || 0) >= 5) return bad('Too many sign-ups from this network. Please try again later or email info@byndgrn.com.', 429)
    }
    const { data: existing } = await admin.from('portal_clients').select('id, email_verified_at, password_hash, is_active').ilike('email', likeExact(email)).maybeSingle()
    let clientId = (existing as any)?.id as string | undefined
    if (existing && ((existing as any).password_hash || !(existing as any).is_active)) {
      // Already has an account: don't reveal anything, just point them to sign in / reset.
      return J({ ok: true })
    }
    const onboarding = { business_type: str(body.business_type, 80), interest: Array.isArray(body.interest) ? body.interest.map((x: any) => str(x, 60)).slice(0, 8) : [], website: str(body.website, 200), legal_name: company, how_heard: str(body.how_heard, 120) }
    if (!clientId) {
      const { data: ins, error } = await admin.from('portal_clients').insert({ name, company_name: company, email, phone: str(body.phone, 40) || null, title: str(body.title, 80) || null, is_active: true, signup_source: 'self', signup_ip: ip || null, onboarding, created_by: 'self-signup' }).select('id').single()
      if (error) return bad('Could not create the account. Please try again.', 500)
      clientId = (ins as any).id
    }
    const t = token()
    await admin.from('portal_password_tokens').insert({ token: t, portal_client_id: clientId, expires_at: new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString() })
    const link = `${PORTAL_URL}/portal/set-password?token=${t}&welcome=1`
    await emailClient(email, 'Confirm your email to open your beyondGREEN portal',
      `<p style="margin:0 0 10px;font-size:17px;font-weight:700">Welcome to beyondGREEN</p>`
      + `<p style="margin:0 0 12px;font-size:14px;line-height:1.6">Hi ${esc(name)}, confirm your email and set a password to open your portal. From there you can start a project, book a call with our team, upload documents, and track quotes and orders.</p>`
      + button(link, 'Confirm email and set password')
      + `<p style="margin:0;font-size:12px;color:#6b7280">This link expires in 48 hours. If you didn't sign up, you can ignore this email.</p>`)
    await notifyTeam({ to: NOTIFY_SIGNUPS, from: email, subject: `New portal sign-up: ${company}`, message: `New portal sign-up: ${company} (${name}, ${email}) — waiting for email confirmation.`, html: `<p style="margin:0 0 6px;font-size:16px;font-weight:700">New portal sign-up</p><p style="margin:0;font-size:14px;line-height:1.6"><strong>${esc(company)}</strong><br>${esc(name)}${body.title ? ' · ' + esc(body.title) : ''}<br>${esc(email)}${body.phone ? ' · ' + esc(body.phone) : ''}<br>Type: ${esc(onboarding.business_type || '—')} · Interested in: ${esc(onboarding.interest.join(', ') || '—')}</p>`, contextPath: '/bizdev/client-portals', replyTo: email })
    return J({ ok: true })
  }

  // ── Public: forgot password ──
  if (action === 'reset') {
    const email = str(body.email, 200).toLowerCase()
    if (!EMAIL_RE.test(email)) return bad('Please enter a valid email.')
    const { data: c } = await admin.from('portal_clients').select('id, name, is_active').ilike('email', likeExact(email)).maybeSingle()
    if (c && (c as any).is_active) {
      const t = token()
      await admin.from('portal_password_tokens').insert({ token: t, portal_client_id: (c as any).id, expires_at: new Date(Date.now() + 1000 * 60 * 60 * 2).toISOString() })
      await emailClient(email, 'Reset your beyondGREEN portal password', `<p style="margin:0 0 10px;font-size:17px;font-weight:700">Reset your password</p><p style="margin:0 0 12px;font-size:14px;line-height:1.6">Use the button below to choose a new password. This link expires in 2 hours.</p>${button(`${PORTAL_URL}/portal/set-password?token=${t}`, 'Choose a new password')}`)
    }
    return J({ ok: true })   // same answer either way
  }

  // ── Staff actions ──
  if (action.startsWith('staff-') || action === 'order-convert' || action === 'order-decline' || action === 'booking-confirm') {
    const staff = await staffEmail(req)
    if (!staff) return bad('unauthorized', 401)
    return staffAction(action, body, staff)
  }

  // ── Everything else needs a client session ──
  const acct = await accountFromRequest(req)
  if (!acct) return bad('unauthorized', 401)
  const company = await companyOf(acct)
  const approved = !!acct.approved_at && !!acct.customer_id

  if (action === 'upload-url') {
    const kind = ['onboarding', 'po', 'project'].includes(body.kind) ? body.kind : null
    const name = safeFileName(body.name)
    if (!kind) return bad('Unknown upload type.')
    if (!name) return bad('That file type is not supported. Use PDF, images, AI/EPS/SVG, CAD, Office files or ZIP.')
    if (num(body.size) > 50 * 1024 * 1024) return bad('Files must be under 50 MB.')
    const path = `portal/${acct.id}/${kind}/${Date.now()}_${name}`
    const up = await signedUpload(path)
    if (!up) return bad('Upload is unavailable right now. Please try again.', 500)
    return J({ ok: true, url: up.url, path: up.path, name })
  }

  if (action === 'onboarding-save') {
    const ob = body.onboarding && typeof body.onboarding === 'object' ? body.onboarding : {}
    const clean: any = {}
    for (const [k, v] of Object.entries(ob)) {
      if (k === 'files' && Array.isArray(v)) { clean.files = (v as any[]).filter(f => f && ownsPath(acct, f.path, 'onboarding')).slice(0, 20).map(f => ({ slot: str(f.slot, 40), name: str(f.name, 160), path: str(f.path, 400) })); continue }
      if (k === 'trade_refs' && Array.isArray(v)) { clean.trade_refs = (v as any[]).slice(0, 4).map(r => ({ company: str(r?.company, 120), contact: str(r?.contact, 120), phone: str(r?.phone, 40), email: str(r?.email, 160) })); continue }
      if (['suggested_customer_id', 'suggested_customer_name'].includes(k)) continue
      if (typeof v === 'boolean') clean[k] = v
      else if (Array.isArray(v)) clean[k] = v.map(x => str(x, 80)).slice(0, 12)
      else clean[k] = str(v, 1000)
    }
    const merged = { ...(acct.onboarding || {}), ...clean }
    const patch: any = { onboarding: merged, updated_at: new Date().toISOString() }
    if (str(body.phone)) patch.phone = str(body.phone, 40)
    const submit = !!body.submit
    if (submit) {
      if (!merged.agree) return bad('Please confirm the information is accurate to submit.')
      if (!merged.signature) return bad('Please type your name as a signature to submit.')
      patch.onboarding_submitted_at = new Date().toISOString()
    }
    await admin.from('portal_clients').update(patch).eq('id', acct.id)
    if (submit && acct.customer_id) {
      // Fill in blanks on the ERP customer card (never overwrite what the team entered).
      const { data: cust } = await admin.from('customers').select('billing_address, shipping_address, phone, website, contact_name').eq('id', acct.customer_id).maybeSingle()
      const c = (cust || {}) as any
      const cp: any = {}
      if (!c.billing_address && merged.billing_address) cp.billing_address = merged.billing_address
      if (!c.shipping_address && merged.shipping_address) cp.shipping_address = merged.shipping_address
      if (!c.phone && (merged.main_phone || acct.phone)) cp.phone = merged.main_phone || acct.phone
      if (!c.website && merged.website) cp.website = merged.website
      if (!c.contact_name && acct.name) cp.contact_name = acct.name
      if (Object.keys(cp).length) await admin.from('customers').update({ ...cp, updated_at: new Date().toISOString() }).eq('id', acct.customer_id)
      if (merged.ap_email) {
        const { data: hit } = await admin.from('customer_contacts').select('id').eq('customer_id', acct.customer_id).ilike('email', likeExact(merged.ap_email)).limit(1)
        if (!hit || !hit.length) await admin.from('customer_contacts').insert({ customer_id: acct.customer_id, full_name: merged.ap_name || null, title: 'Accounts Payable', email: merged.ap_email, phone: merged.ap_phone || null, is_primary: false }).then(() => {}, () => {})
      }
      for (const f of (merged.files || []) as any[]) {
        const { data: dup } = await admin.from('file_attachments').select('id').eq('record_type', 'customers').eq('record_id', acct.customer_id).eq('storage_path', f.path).limit(1)
        if (!dup || !dup.length) await admin.from('file_attachments').insert({ record_type: 'customers', record_id: acct.customer_id, file_name: `${f.slot ? f.slot + ' - ' : ''}${f.name}`, file_type: f.name.split('.').pop() || null, storage_path: f.path, uploaded_by: acct.email }).then(() => {}, () => {})
      }
      await notifyTeam({ to: NOTIFY_SIGNUPS, from: acct.email, subject: `Onboarding submitted: ${company}`, message: `${company} submitted their onboarding packet${approved ? '' : ' — review and approve to unlock ordering'}.`, html: `<p style="margin:0 0 6px;font-size:16px;font-weight:700">Onboarding packet submitted</p><p style="margin:0;font-size:14px;line-height:1.6"><strong>${esc(company)}</strong> (${esc(acct.email)}) submitted company, billing, shipping, tax and credit details${(merged.files || []).length ? ` with ${(merged.files || []).length} document(s)` : ''}. Files are attached to the customer card.</p>`, contextPath: '/bizdev/client-portals', replyTo: acct.email })
    }
    return J({ ok: true, submitted: submit })
  }

  if (action === 'order-request') {
    if (!approved) return bad('Your account is waiting for approval. You can still send us your PO by message, or finish onboarding so we can approve you faster.', 403)
    const lines = (Array.isArray(body.lines) ? body.lines : []).slice(0, 60).map((l: any) => ({ product_id: isUuid(l.product_id) ? l.product_id : null, sku: str(l.sku, 60) || null, description: str(l.description, 300) || null, quantity: num(l.quantity), unit: str(l.unit, 20) || null, last_price: l.last_price != null ? num(l.last_price) : null })).filter((l: any) => l.quantity > 0 && l.quantity <= 10_000_000 && (l.sku || l.description || l.product_id))
    const poPath = str(body.po_path, 400)
    if (!lines.length && !poPath) return bad('Add at least one item or attach your PO.')
    if (poPath && (!ownsPath(acct, poPath, 'po') || !(await objectExists(poPath)))) return bad('The PO upload did not finish. Please attach it again.')
    const shipDate = /^\d{4}-\d{2}-\d{2}$/.test(str(body.requested_ship_date)) ? str(body.requested_ship_date) : null
    const { data: ins, error } = await admin.from('portal_order_requests').insert({
      portal_client_id: acct.id, customer_id: acct.customer_id, po_number: str(body.po_number, 80) || null, po_storage_path: poPath || null, po_file_name: poPath ? str(body.po_name, 160) : null,
      requested_ship_date: shipDate, ship_to: str(body.ship_to, 600) || null, delivery_notes: str(body.delivery_notes, 600) || null, lines, notes: str(body.notes, 2000) || null,
    }).select('id, request_number').single()
    if (error || !ins) return bad('Could not submit the order. Please try again.', 500)
    const r = ins as any
    const rows = lines.map((l: any) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${esc(l.sku || '')}</td><td style="padding:4px 8px;border-bottom:1px solid #eee">${esc(l.description || '')}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${l.quantity.toLocaleString('en-US')} ${esc(l.unit || '')}</td></tr>`).join('')
    const table = rows ? `<table style="border-collapse:collapse;font-size:13px;width:100%;margin:8px 0">${rows}</table>` : ''
    await notifyTeam({ to: NOTIFY_ORDERS, from: acct.email, subject: `New portal order ${r.request_number}: ${company}${body.po_number ? ' · PO ' + str(body.po_number, 80) : ''}`, message: `${company} placed order ${r.request_number}${body.po_number ? ' (PO ' + str(body.po_number, 80) + ')' : ''} in the portal — convert it to a sales order.`, html: `<p style="margin:0 0 6px;font-size:16px;font-weight:700">New order from the client portal</p><p style="margin:0 0 8px;font-size:14px"><strong>${esc(company)}</strong> · ${esc(r.request_number)}${body.po_number ? ' · PO ' + esc(body.po_number) : ''}${shipDate ? ' · ship by ' + esc(fmtDay(shipDate)) : ''}${poPath ? ' · PO file attached' : ''}</p>${table}${body.notes ? `<p style="margin:8px 0 0;font-size:13px;white-space:pre-wrap">${esc(body.notes)}</p>` : ''}`, contextPath: '/bizdev/client-portals?tab=orders', replyTo: acct.email })
    await emailClient(acct.email, `We received your order ${r.request_number}`, `<p style="margin:0 0 10px;font-size:17px;font-weight:700">Order received</p><p style="margin:0 0 8px;font-size:14px;line-height:1.6">Thanks, ${esc(acct.name || company)}. We received order <strong>${esc(r.request_number)}</strong>${body.po_number ? ` (PO ${esc(body.po_number)})` : ''}. Our team will confirm it and send your sales order number, usually within one business day.</p>${table}${button(`${PORTAL_URL}/portal/orders`, 'Track your orders')}`)
    return J({ ok: true, request_number: r.request_number })
  }

  if (action === 'order-cancel') {
    const { data: r } = await admin.from('portal_order_requests').select('id, status, request_number').eq('id', str(body.id, 60)).eq('portal_client_id', acct.id).maybeSingle()
    if (!r) return bad('not found', 404)
    if ((r as any).status !== 'Submitted') return bad('This order is already being processed. Message us to change it.')
    await admin.from('portal_order_requests').update({ status: 'Cancelled', updated_at: new Date().toISOString() }).eq('id', (r as any).id)
    await notifyTeam({ to: NOTIFY_ORDERS, from: acct.email, subject: `Portal order cancelled: ${(r as any).request_number}`, message: `${company} cancelled portal order ${(r as any).request_number} before it was converted.`, html: `<p style="margin:0;font-size:14px">${esc(company)} cancelled order <strong>${esc((r as any).request_number)}</strong> before it was converted.</p>`, contextPath: '/bizdev/client-portals?tab=orders' })
    return J({ ok: true })
  }

  if (action === 'project-create') {
    if (!acct.customer_id) return bad('Your account is still being set up. Please try again in a minute.', 409)
    const name = str(body.name, 140)
    if (!name) return bad('Give your project a name.')
    const description = str(body.description, 4000)
    if (description.length < 10) return bad('Tell us a little about the project.')
    const files = (Array.isArray(body.files) ? body.files : []).filter((f: any) => f && ownsPath(acct, f.path, 'project')).slice(0, 25)
    const products = (Array.isArray(body.products) ? body.products : []).slice(0, 30).map((p: any) => ({ description: str(p.description, 300), quantity: num(p.quantity), unit: str(p.unit, 20) || 'pcs' })).filter((p: any) => p.description)
    const certs = Array.isArray(body.certifications) ? body.certifications.map((x: any) => str(x, 60)).slice(0, 10) : []
    const notes = [
      `Submitted through the client portal by ${acct.name || ''} <${acct.email}>`,
      `Project type: ${str(body.type, 80) || '—'}`,
      `Description:\n${description}`,
      products.length ? `Items:\n${products.map((p: any) => `- ${p.description}${p.quantity ? ` · ${p.quantity.toLocaleString('en-US')} ${p.unit}` : ''}`).join('\n')}` : '',
      `First order quantity: ${str(body.first_qty, 120) || '—'} · Annual volume: ${str(body.annual_qty, 120) || '—'}`,
      `Target price: ${str(body.target_price, 120) || '—'} · Target date: ${str(body.target_date, 40) || '—'}`,
      `Certifications needed: ${certs.join(', ') || '—'}`,
      `Packaging / printing: ${str(body.packaging, 1000) || '—'}`,
      `Ship to: ${str(body.ship_to, 300) || '—'}`,
      body.want_call ? 'Client asked for a kickoff call.' : '',
    ].filter(Boolean).join('\n\n')
    let quote: any = null
    for (let attempt = 0; attempt < 4 && !quote; attempt++) {
      const number = await nextQuoteNumber()
      const qn = attempt ? number.replace(/(\d+)$/, m => String(Number(m) + attempt).padStart(4, '0')) : number
      const { data, error } = await admin.from('quotations').insert({ quote_number: qn, customer_id: acct.customer_id, type: 'rfq', status: 'Quoting', notes, client_portal_visible: true, client_portal_name: name, is_active: true, shipping_address: str(body.ship_to, 300) || null }).select('id, quote_number').single()
      if (!error) quote = data
      else if (!/duplicate|unique/i.test(error.message)) return bad('Could not create the project. Please try again.', 500)
    }
    if (!quote) return bad('Could not create the project. Please try again.', 500)
    if (products.length) await admin.from('quotation_lines').insert(products.map((p: any, i: number) => ({ quotation_id: quote.id, line_number: i + 1, description: p.description, quantity: p.quantity || 0, unit_of_measure: p.unit, unit_price: 0, line_total: 0 }))).then(() => {}, () => {})
    for (const f of files) await admin.from('file_attachments').insert({ record_type: 'quotation_art', record_id: quote.id, file_name: str(f.name, 160), file_type: String(f.name || '').split('.').pop() || null, storage_path: f.path, uploaded_by: acct.email }).then(() => {}, () => {})
    await notifyTeam({ to: NOTIFY_PROJECTS, from: acct.email, subject: `New project from ${company}: ${name}`, message: `${company} started a project in the portal: ${name} (${quote.quote_number}).`, html: `<p style="margin:0 0 6px;font-size:16px;font-weight:700">New project request</p><p style="margin:0 0 8px;font-size:14px"><strong>${esc(company)}</strong> · ${esc(name)} · ${esc(quote.quote_number)}${files.length ? ` · ${files.length} file(s)` : ''}</p><div style="background:#f5f6fa;border-left:3px solid #037f4c;padding:12px 16px;border-radius:0 8px 8px 0;font-size:13px;white-space:pre-wrap;line-height:1.5">${esc(notes)}</div>`, contextPath: `/sales/quotations?item=${quote.id}`, replyTo: acct.email })
    await emailClient(acct.email, `Project received: ${name}`, `<p style="margin:0 0 10px;font-size:17px;font-weight:700">We have your project</p><p style="margin:0 0 8px;font-size:14px;line-height:1.6">Thanks for sending <strong>${esc(name)}</strong> (${esc(quote.quote_number)}). Our team is reviewing it and will follow up with questions or a quote. You can add files, message us, or book a call from your portal anytime.</p>${button(`${PORTAL_URL}/portal/projects`, 'View your project')}`)
    return J({ ok: true, id: quote.id, number: quote.quote_number })
  }

  if (action === 'quote-accept' || action === 'quote-changes') {
    const id = str(body.id, 60)
    const { data: q } = await admin.from('quotations').select('id, quote_number, status, customer_id, type, expiry_date, doc_style, client_portal_name').eq('id', id).maybeSingle()
    const qq = q as any
    if (!qq || qq.customer_id !== acct.customer_id || qq.type === 'rfq') return bad('not found', 404)
    const label = qq.client_portal_name || qq.quote_number
    if (action === 'quote-changes') {
      const msg = str(body.message, 4000)
      if (!msg) return bad('Tell us what you would like changed.')
      await admin.from('comments').insert({ record_type: 'quotation', record_id: qq.id, author_email: acct.email, content: `Change request from client: ${msg}`, client_visible: true })
      await notifyTeam({ to: NOTIFY_PROJECTS, from: acct.email, subject: `Quote change request: ${label}`, message: `${company} asked for changes to quote ${qq.quote_number}: ${msg.slice(0, 200)}`, html: `<p style="margin:0 0 6px;font-size:16px;font-weight:700">Quote change request</p><p style="margin:0 0 8px;font-size:14px">${esc(company)} · ${esc(qq.quote_number)}</p><div style="background:#f5f6fa;border-left:3px solid #037f4c;padding:12px 16px;font-size:14px;white-space:pre-wrap">${esc(msg)}</div>`, contextPath: `/sales/quotations?item=${qq.id}`, replyTo: acct.email })
      return J({ ok: true })
    }
    if (!approved) return bad('Your account is waiting for approval before quotes can be accepted. Our team has been notified.', 403)
    const today = new Date().toISOString().slice(0, 10)
    if (qq.status !== 'Sent') return bad('This quote can no longer be accepted online. Message us and we will help.')
    if (qq.expiry_date && qq.expiry_date < today) return bad('This quote has expired. Ask us for a refreshed quote.')
    if (qq.doc_style === 'estimate') return bad('This is an estimate. Ask us for an official quote to accept.')
    const po = str(body.po_number, 80)
    const sig = str(body.signature, 120)
    if (!sig) return bad('Type your name to accept.')
    const { error } = await admin.from('quotations').update({ status: 'Accepted', updated_at: new Date().toISOString() }).eq('id', qq.id).eq('status', 'Sent')
    if (error) return bad('Could not accept the quote. Please try again.', 500)
    await admin.from('comments').insert({ record_type: 'quotation', record_id: qq.id, author_email: acct.email, content: `Accepted online by ${sig} (${acct.email}) on ${new Date().toISOString()}${po ? ` · PO ${po}` : ''}.`, client_visible: true })
    await notifyTeam({ to: Array.from(new Set([...NOTIFY_PROJECTS, ...NOTIFY_ORDERS])), from: acct.email, subject: `Quote accepted: ${qq.quote_number} · ${company}`, message: `${company} accepted quote ${qq.quote_number} in the portal${po ? ' (PO ' + po + ')' : ''}. The ERP converts it to a sales order automatically.`, html: `<p style="margin:0 0 6px;font-size:16px;font-weight:700">Quote accepted</p><p style="margin:0;font-size:14px;line-height:1.6"><strong>${esc(company)}</strong> accepted <strong>${esc(qq.quote_number)}</strong>${po ? ` with PO ${esc(po)}` : ''}. Signed: ${esc(sig)}. The ERP auto-converts accepted quotes to a sales order; check the quote for any missing details it is waiting on.</p>`, contextPath: `/sales/quotations?item=${qq.id}`, replyTo: acct.email })
    await emailClient(acct.email, `Quote ${qq.quote_number} accepted`, `<p style="margin:0 0 10px;font-size:17px;font-weight:700">Thank you</p><p style="margin:0 0 8px;font-size:14px;line-height:1.6">You accepted quote <strong>${esc(qq.quote_number)}</strong>. We are turning it into an order now and will confirm the schedule shortly.</p>${button(`${PORTAL_URL}/portal/orders`, 'Track your orders')}`)
    return J({ ok: true })
  }

  if (action === 'book') {
    const topic = str(body.topic, 160) || 'Call with beyondGREEN'
    const notes = str(body.notes, 2000)
    const quotationId = isUuid(body.quotation_id) ? body.quotation_id : null
    if (quotationId) {
      const { data: q } = await admin.from('quotations').select('customer_id').eq('id', quotationId).maybeSingle()
      if (!q || (q as any).customer_id !== acct.customer_id) return bad('not found', 404)
    }
    // Request mode: client offers up to 3 times, team confirms
    if (Array.isArray(body.preferred) && body.preferred.length) {
      const prefs = body.preferred.map((x: any) => str(x, 40)).filter((x: string) => !Number.isNaN(Date.parse(x))).slice(0, 3)
      if (!prefs.length) return bad('Pick at least one time that works.')
      const { data: b } = await admin.from('portal_bookings').insert({ portal_client_id: acct.id, customer_id: acct.customer_id, topic, quotation_id: quotationId, preferred_times: prefs, status: 'Requested', host_email: BOOKING_HOST, notes }).select('id').single()
      const list = prefs.map((p: string) => `<li>${esc(fmtSlot(new Date(p)))}</li>`).join('')
      await notifyTeam({ to: [BOOKING_HOST], from: acct.email, subject: `Call request: ${company}`, message: `${company} asked for a call (${topic}). Pick one of their times in Client Portals > Calls.`, html: `<p style="margin:0 0 6px;font-size:16px;font-weight:700">Call request</p><p style="margin:0 0 6px;font-size:14px"><strong>${esc(company)}</strong> · ${esc(topic)}</p><ul style="font-size:14px">${list}</ul>${notes ? `<p style="font-size:13px;white-space:pre-wrap">${esc(notes)}</p>` : ''}`, contextPath: '/bizdev/client-portals?tab=calls', replyTo: acct.email })
      return J({ ok: true, id: (b as any)?.id, status: 'Requested' })
    }
    const start = new Date(str(body.start, 40))
    if (Number.isNaN(start.getTime())) return bad('Pick a time.')
    const valid = candidateSlots().some(s => s.start.getTime() === start.getTime())
    if (!valid) return bad('That time is no longer available. Please pick another.')
    const end = new Date(start.getTime() + SLOT_MINUTES * 60000)
    const busy = await outlookBusy(start, end)
    if (busy && busy.some(b => start.getTime() < b.end && b.start < end.getTime())) return bad('That time was just taken. Please pick another.', 409)
    const { data: b, error } = await admin.from('portal_bookings').insert({ portal_client_id: acct.id, customer_id: acct.customer_id, topic, quotation_id: quotationId, start_at: start.toISOString(), end_at: end.toISOString(), status: 'Confirmed', host_email: BOOKING_HOST, notes }).select('id').single()
    if (error) return bad(/duplicate|unique/i.test(error.message) ? 'That time was just taken. Please pick another.' : 'Could not book the call. Please try again.', 409)
    const bookingId = (b as any).id
    const result = await confirmBooking({ id: bookingId, acct, company, topic, notes, start, end })
    return J({ ok: true, id: bookingId, status: 'Confirmed', when: fmtSlot(start), zoom: result.zoom, invite_sent: result.invite })
  }

  if (action === 'booking-cancel') {
    const { data: bk } = await admin.from('portal_bookings').select('id, status, start_at, outlook_event_id, topic').eq('id', str(body.id, 60)).eq('portal_client_id', acct.id).maybeSingle()
    const k = bk as any
    if (!k) return bad('not found', 404)
    if (k.status === 'Cancelled') return J({ ok: true })
    await admin.from('portal_bookings').update({ status: 'Cancelled', updated_at: new Date().toISOString() }).eq('id', k.id)
    if (k.outlook_event_id) await cancelOutlookEvent(k.outlook_event_id, `Cancelled by ${company} in the client portal.`)
    await notifyTeam({ to: [BOOKING_HOST], from: acct.email, subject: `Call cancelled: ${company}`, message: `${company} cancelled their call${k.start_at ? ' on ' + fmtSlot(new Date(k.start_at)) : ''}.`, html: `<p style="margin:0;font-size:14px">${esc(company)} cancelled <strong>${esc(k.topic)}</strong>${k.start_at ? ' on ' + esc(fmtSlot(new Date(k.start_at))) : ''}.</p>`, contextPath: '/bizdev/client-portals?tab=calls' })
    return J({ ok: true })
  }

  return bad('not found', 404)
}

// Create the Zoom meeting + Outlook invite for a confirmed booking, then email the client.
async function confirmBooking(o: { id: string; acct: { email: string; name: string | null }; company: string; topic: string; notes: string; start: Date; end: Date }): Promise<{ zoom: string | null; invite: boolean }> {
  const zoom = await createZoomMeeting(`${o.company} · ${o.topic}`, o.start, SLOT_MINUTES)
  const html = `<p>${esc(o.company)} booked this call from the beyondGREEN client portal.</p><p><strong>Topic:</strong> ${esc(o.topic)}</p>${o.notes ? `<p><strong>Notes:</strong><br>${esc(o.notes).replace(/\n/g, '<br>')}</p>` : ''}${zoom ? `<p><strong>Join Zoom:</strong> <a href="${esc(zoom.join_url)}">${esc(zoom.join_url)}</a></p>` : '<p>A Zoom link will follow.</p>'}`
  const eventId = await createOutlookEvent({ subject: `beyondGREEN x ${o.company}: ${o.topic}`, html, start: o.start, end: o.end, attendee: { email: o.acct.email, name: o.acct.name }, joinUrl: zoom?.join_url || null })
  await admin.from('portal_bookings').update({ zoom_join_url: zoom?.join_url || null, zoom_meeting_id: zoom?.id || null, outlook_event_id: eventId, updated_at: new Date().toISOString() }).eq('id', o.id)
  if (!eventId) {
    // No calendar write: still confirm by email so the client has the time and link.
    await emailClient(o.acct.email, `Call confirmed: ${fmtSlot(o.start)}`, `<p style="margin:0 0 10px;font-size:17px;font-weight:700">Your call is booked</p><p style="margin:0 0 8px;font-size:14px;line-height:1.6"><strong>${esc(o.topic)}</strong><br>${esc(fmtSlot(o.start))} (${SLOT_MINUTES} min)</p>${zoom ? button(zoom.join_url, 'Join on Zoom') : '<p style="font-size:14px">We will send the Zoom link before the call.</p>'}${button(`${PORTAL_URL}/portal/book`, 'Manage your calls')}`)
  }
  await notifyTeam({ to: [BOOKING_HOST], from: o.acct.email, subject: `Call booked: ${o.company} · ${fmtSlot(o.start)}`, message: `${o.company} booked a call for ${fmtSlot(o.start)}: ${o.topic}.`, html: `<p style="margin:0 0 6px;font-size:16px;font-weight:700">Call booked</p><p style="margin:0;font-size:14px;line-height:1.6"><strong>${esc(o.company)}</strong> · ${esc(o.topic)}<br>${esc(fmtSlot(o.start))}${zoom ? `<br>Zoom: <a href="${esc(zoom.join_url)}">${esc(zoom.join_url)}</a>` : ''}${eventId ? '<br>Added to your Outlook calendar with an invite to the client.' : '<br><strong>Not on your calendar yet</strong> (calendar permission missing): add it manually.'}</p>`, contextPath: '/bizdev/client-portals?tab=calls' })
  return { zoom: zoom?.join_url || null, invite: !!eventId }
}

// ═══════════════════════════ Staff actions ═══════════════════════════
async function staffAction(action: string, body: any, staff: string): Promise<NextResponse> {
  if (action === 'staff-approve') {
    const id = str(body.clientId, 60)
    const approve = body.approve !== false
    const { data: c } = await admin.from('portal_clients').select('id, email, name, company_name, customer_id').eq('id', id).maybeSingle()
    const cl = c as any
    if (!cl) return bad('not found', 404)
    if (approve && !cl.customer_id) return bad('Link this account to a customer first.')
    await admin.from('portal_clients').update({ approved_at: approve ? new Date().toISOString() : null, approved_by: approve ? staff : null, updated_at: new Date().toISOString() }).eq('id', id)
    if (approve) await emailClient(cl.email, 'Your beyondGREEN account is approved', `<p style="margin:0 0 10px;font-size:17px;font-weight:700">You're all set</p><p style="margin:0 0 8px;font-size:14px;line-height:1.6">Hi ${esc(cl.name || cl.company_name || '')}, your account is approved. You can now place orders and upload POs, accept quotes, and see your order history in the portal.</p>${button(`${PORTAL_URL}/portal/orders`, 'Place an order')}`)
    return J({ ok: true })
  }

  if (action === 'staff-link') {
    const id = str(body.clientId, 60), customerId = str(body.customerId, 60)
    if (!isUuid(customerId)) return bad('Pick a customer.')
    const { data: c } = await admin.from('portal_clients').select('id, customer_id, onboarding').eq('id', id).maybeSingle()
    const cl = c as any
    if (!cl) return bad('not found', 404)
    const old = cl.customer_id
    if (old && old !== customerId) {
      // If the old customer was auto-created by the portal sign-up, fold it into the real one.
      const { data: oc } = await admin.from('customers').select('id, lead_source, company_name, customer_status').eq('id', old).maybeSingle()
      const { count: soCount } = await admin.from('sales_orders').select('id', { count: 'exact', head: true }).eq('customer_id', old)
      if ((oc as any)?.lead_source === 'Client portal' && !soCount) {
        await admin.from('quotations').update({ customer_id: customerId }).eq('customer_id', old)
        await admin.from('portal_order_requests').update({ customer_id: customerId }).eq('customer_id', old)
        await admin.from('portal_bookings').update({ customer_id: customerId }).eq('customer_id', old)
        await admin.from('file_attachments').update({ record_id: customerId }).eq('record_type', 'customers').eq('record_id', old)
        await admin.from('customers').update({ is_merged: true, merged_into: customerId, is_active: false, updated_at: new Date().toISOString() }).eq('id', old)
      }
    }
    const ob = { ...(cl.onboarding || {}) }; delete ob.suggested_customer_id; delete ob.suggested_customer_name
    await admin.from('portal_clients').update({ customer_id: customerId, onboarding: ob, updated_at: new Date().toISOString() }).eq('id', id)
    return J({ ok: true })
  }

  if (action === 'order-decline') {
    const { data: r } = await admin.from('portal_order_requests').select('id, request_number, status, portal_client_id').eq('id', str(body.id, 60)).maybeSingle()
    const rr = r as any
    if (!rr || rr.status !== 'Submitted') return bad('Only submitted orders can be declined.')
    const reason = str(body.reason, 1000)
    await admin.from('portal_order_requests').update({ status: 'Declined', decline_reason: reason || null, updated_at: new Date().toISOString(), converted_by: staff }).eq('id', rr.id)
    const { data: c } = await admin.from('portal_clients').select('email, name').eq('id', rr.portal_client_id).maybeSingle()
    if ((c as any)?.email) await emailClient((c as any).email, `Update on order ${rr.request_number}`, `<p style="margin:0 0 10px;font-size:17px;font-weight:700">We couldn't process this order as submitted</p><p style="margin:0 0 8px;font-size:14px;line-height:1.6">Order <strong>${esc(rr.request_number)}</strong> needs a change before we can confirm it.${reason ? `<br><br>${esc(reason)}` : ''}</p>${button(`${PORTAL_URL}/portal`, 'Message our team')}`)
    return J({ ok: true })
  }

  if (action === 'order-convert') {
    const { data: r } = await admin.from('portal_order_requests').select('*').eq('id', str(body.id, 60)).maybeSingle()
    const rr = r as any
    if (!rr) return bad('not found', 404)
    if (rr.status !== 'Submitted') return bad('This order was already handled.')
    if (!rr.customer_id) return bad('Link the account to a customer first.')
    const { data: cust } = await admin.from('customers').select('company_name, email, phone, billing_address, shipping_address, payment_terms').eq('id', rr.customer_id).maybeSingle()
    const cu = (cust || {}) as any
    const { data: cl } = await admin.from('portal_clients').select('email, phone').eq('id', rr.portal_client_id).maybeSingle()
    let orderNumber: string | null = null
    try { const { data: n } = await admin.rpc('next_so_number'); if (n) orderNumber = String(n) } catch { /* let the default sequence assign it */ }
    let poUrl: string | null = null
    if (rr.po_storage_path) poUrl = await signedDownload(rr.po_storage_path, 60 * 60 * 24 * 365)
    const lines = (rr.lines || []) as any[]
    const prodIds = lines.map(l => l.product_id).filter(Boolean)
    const prodBy: Record<string, any> = {}
    if (prodIds.length) { const { data: ps } = await admin.from('products').select('id, sku, product_name, unit_of_measure, case_price, unit_price').in('id', prodIds); (ps || []).forEach((p: any) => { prodBy[p.id] = p }) }
    const total = lines.reduce((s, l) => s + (l.last_price != null ? Number(l.last_price) * Number(l.quantity || 0) : 0), 0)
    const insert: any = {
      status: 'New Order', customer_id: rr.customer_id, po_number: rr.po_number, required_ship_date: rr.requested_ship_date,
      shipping_address: rr.ship_to || cu.shipping_address || null, billing_address: cu.billing_address || null,
      customer_email: (cl as any)?.email || cu.email || null, customer_phone: (cl as any)?.phone || cu.phone || null,
      payment_terms: cu.payment_terms || undefined, terms: cu.payment_terms || null,
      notes: `Placed in the client portal (${rr.request_number}).${rr.notes ? '\n' + rr.notes : ''}`,
      additional_comments: rr.delivery_notes || null, purchase_order_url: poUrl,
      client_portal_visible: true, client_portal_name: rr.po_number ? `PO ${rr.po_number}` : rr.request_number,
      subtotal: total, total, tax_pct: 0,
    }
    if (orderNumber) insert.order_number = orderNumber
    Object.keys(insert).forEach(k => insert[k] === undefined && delete insert[k])
    const { data: so, error } = await admin.from('sales_orders').insert(insert).select('id, order_number').single()
    if (error || !so) return bad('Could not create the sales order: ' + (error?.message || 'unknown error'), 500)
    const soId = (so as any).id
    if (lines.length) {
      const rows = lines.map((l, i) => {
        const p = l.product_id ? prodBy[l.product_id] : null
        const qty = Number(l.quantity) || 0
        const price = l.last_price != null ? Number(l.last_price) : 0
        return { sales_order_id: soId, order_id: soId, line_number: i + 1, product_id: l.product_id || null, sku: l.sku || p?.sku || null, description: l.description || p?.product_name || null, quantity: qty, qty, unit_of_measure: l.unit || p?.unit_of_measure || null, unit_price: price }
      })
      const { error: le } = await admin.from('sales_order_lines').insert(rows)
      if (le) await admin.from('comments').insert({ record_type: 'sales_order', record_id: soId, author_email: 'client-portal@beyondgreenbiotech.com', content: `Portal order lines could not be copied automatically (${le.message}). See ${rr.request_number} in Client Portals.` }).then(() => {}, () => {})
    }
    if (rr.po_storage_path) await admin.from('file_attachments').insert({ record_type: 'sales_order_po_copy', record_id: soId, file_name: rr.po_file_name || 'Customer PO.pdf', file_type: (rr.po_file_name || '').split('.').pop() || 'pdf', storage_path: rr.po_storage_path, uploaded_by: staff }).then(() => {}, () => {})
    await admin.from('portal_order_requests').update({ status: 'Converted', sales_order_id: soId, converted_at: new Date().toISOString(), converted_by: staff, updated_at: new Date().toISOString() }).eq('id', rr.id)
    const { data: c } = await admin.from('portal_clients').select('email, name').eq('id', rr.portal_client_id).maybeSingle()
    if ((c as any)?.email) await emailClient((c as any).email, `Order confirmed: SO ${(so as any).order_number}`, `<p style="margin:0 0 10px;font-size:17px;font-weight:700">Your order is confirmed</p><p style="margin:0 0 8px;font-size:14px;line-height:1.6">Order ${esc(rr.request_number)}${rr.po_number ? ` (PO ${esc(rr.po_number)})` : ''} is now sales order <strong>${esc((so as any).order_number)}</strong>. You'll get updates as it moves through production and shipping.</p>${button(`${PORTAL_URL}/portal/orders`, 'Track this order')}`)
    return J({ ok: true, sales_order_id: soId, order_number: (so as any).order_number })
  }

  if (action === 'booking-confirm') {
    const { data: bk } = await admin.from('portal_bookings').select('*').eq('id', str(body.id, 60)).maybeSingle()
    const k = bk as any
    if (!k || k.status !== 'Requested') return bad('Only requested calls can be confirmed.')
    const start = new Date(str(body.start, 40))
    if (Number.isNaN(start.getTime())) return bad('Pick a time.')
    const end = new Date(start.getTime() + SLOT_MINUTES * 60000)
    const { error } = await admin.from('portal_bookings').update({ start_at: start.toISOString(), end_at: end.toISOString(), status: 'Confirmed', updated_at: new Date().toISOString() }).eq('id', k.id)
    if (error) return bad(/duplicate|unique/i.test(error.message) ? 'You already have a call at that time.' : 'Could not confirm.', 409)
    const { data: c } = await admin.from('portal_clients').select('id, email, name, company_name, customer_id').eq('id', k.portal_client_id).maybeSingle()
    const cl = c as any
    const company = cl?.company_name || cl?.email || 'Client'
    const res = await confirmBooking({ id: k.id, acct: { email: cl.email, name: cl.name }, company, topic: k.topic, notes: k.notes || '', start, end })
    return J({ ok: true, zoom: res.zoom, invite_sent: res.invite })
  }

  return bad('not found', 404)
}

// Keep the unused import list honest for bundlers that tree-shake aggressively.
void NOTIFY; void BUCKET
