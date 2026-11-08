/* eslint-disable @typescript-eslint/no-explicit-any */
// Website "digital services": compliance packs, the gated state law map, and the switch planner.
//   GET  families           public list of packs and what is in each (no file paths)
//   POST request            public: request a compliance pack; the team approves or declines from the email link
//   GET  review?t=          team: confirm page for one request (buttons post to decide)
//   POST decide             team: approve (emails a 7-day download link) or decline
//   POST pack               retired: packs now need a request and approval
//   POST law-access         member: unlock full state law detail, logged as a lead (once a day)
//   POST planner            public: switch planner submission, becomes a lead
import { NextRequest, NextResponse } from 'next/server'
import { admin, cors, str, memberFromReq, clientIp, emailOk, API_PUBLIC } from '@/lib/siteTemplates'
import { randomBytes } from 'crypto'
import { notifyTeam, NOTIFY_SIGNUPS } from '@/lib/portalServer'
import { listFamilies, packUrl, logLead, sendEmail } from '@/lib/compliancePacks'
import { esc } from '@/lib/portalServer'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
type Ctx = { params: Promise<{ action: string }> | { action: string } }

export async function OPTIONS(req: NextRequest) { return new NextResponse(null, { status: 204, headers: cors(req) }) }
const out = (req: NextRequest, b: any, status = 200) => NextResponse.json(b, { status, headers: { ...cors(req), 'Cache-Control': 'no-store' } })
const who = (m: any) => [m.first_name, m.last_name].filter(Boolean).join(' ')

export async function GET(req: NextRequest, ctx: Ctx) {
  const { action } = await (ctx.params as any)
  if (action === 'families') {
    return NextResponse.json({ families: await listFamilies(true) }, { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 's-maxage=300, stale-while-revalidate=3600' } })
  }
  if (action === 'review') {
    const r = await reqByToken(req.nextUrl.searchParams.get('t'))
    if (!r) return page('Request not found', '<p>This link is not valid.</p>', 404)
    const fam = await famName(r.family_key)
    const done = r.status !== 'Pending'
    return page(`Compliance pack request`, `<p style="margin:0 0 14px;color:#4b5563">${esc(fam)}</p>
<table style="border-collapse:collapse;font-size:15px;line-height:1.6;margin-bottom:18px">${[['Name', r.name], ['Company', r.company], ['Email', r.email], ['Phone', r.phone], ['Role', r.role], ['What it is for', r.use_case], ['Requested', new Date(r.created_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })], ['Status', r.status + (r.decided_at ? ' · ' + new Date(r.decided_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }) : '')]].map(([k, v]) => `<tr><td style="padding:2px 16px 2px 0;color:#6b7280;vertical-align:top">${k}</td><td>${esc(String(v || '-'))}</td></tr>`).join('')}</table>
${done ? '<p><b>This request has already been handled.</b></p>' : `<form method="post" action="${API_PUBLIC}/api/site/compliance/decide" style="display:flex;gap:10px;flex-wrap:wrap"><input type="hidden" name="t" value="${esc(r.token)}"><button name="d" value="approve" style="background:#037f4c;color:#fff;border:0;border-radius:8px;padding:12px 20px;font-size:15px;font-weight:700;cursor:pointer">Approve and email the pack</button><button name="d" value="decline" style="background:#fff;color:#b91c1c;border:1px solid #b91c1c;border-radius:8px;padding:12px 20px;font-size:15px;font-weight:700;cursor:pointer">Decline</button></form>`}`)
  }
  return out(req, { error: 'Not found' }, 404)
}

const reqByToken = async (t: string | null | undefined) => {
  const tok = String(t || '')
  if (!/^[a-f0-9]{40}$/.test(tok)) return null
  const { data } = await admin.from('site_compliance_requests').select('*').eq('token', tok).maybeSingle()
  return data as any
}
const famName = async (k: string) => ((await admin.from('site_compliance_families').select('name').eq('key', k).maybeSingle()).data as any)?.name || k
const page = (title: string, body: string, status = 200) => new NextResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title></head><body style="margin:0;background:#f5f6fa;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#111827"><div style="max-width:640px;margin:40px auto;background:#fff;border-radius:14px;padding:28px 24px;box-shadow:0 1px 3px rgba(0,0,0,.08)"><div style="color:#037f4c;font-weight:800;letter-spacing:.04em;font-size:13px;margin-bottom:6px">beyondGREEN</div><h1 style="margin:0 0 8px;font-size:22px">${esc(title)}</h1>${body}</div></body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })

export async function POST(req: NextRequest, ctx: Ctx) {
  const { action } = await (ctx.params as any)
  const ip = clientIp(req)

  if (action === 'decide') {
    const fd = await req.formData().catch(() => null)
    const r = await reqByToken(fd?.get('t') as string)
    const d = String(fd?.get('d') || '')
    if (!r) return page('Request not found', '<p>This link is not valid.</p>', 404)
    if (r.status !== 'Pending') return page('Already handled', `<p>This request was already marked <b>${esc(r.status)}</b>.</p>`)
    const fam = await famName(r.family_key)
    const first = esc(String(r.name || '').split(' ')[0] || 'there')
    if (d === 'approve') {
      const p = await packUrl(r.family_key, 7 * 86400)
      if (!p) return page('Pack not available', '<p>That pack could not be built right now. Nothing was sent. Please try again in a few minutes.</p>', 500)
      const sent = await sendEmail({ to: [r.email], subject: `Your beyondGREEN compliance pack: ${fam}`, html: `<p style="margin:0 0 10px;font-size:17px;font-weight:700">Hi ${first},</p><p style="margin:0 0 12px;font-size:14px;line-height:1.6">Your request for the <b>${esc(fam)}</b> compliance pack is approved. The pack is one ZIP file with a cover sheet that lists exactly which items each certificate covers.</p><p style="margin:0 0 14px"><a href="${p.url}" style="display:inline-block;background:#037f4c;color:#fff;text-decoration:none;font-weight:700;border-radius:8px;padding:12px 20px">Download the pack</a></p><p style="margin:0 0 8px;font-size:13px;color:#6b7280">The link works for 7 days. Documents marked "on request" in the cover sheet can be shared under NDA. Just reply to this email.</p><p style="margin:0;font-size:13px;color:#6b7280">Questions? Call (866) 364-9466.</p>` }).then(() => true).catch(() => false)
      await admin.from('site_compliance_requests').update({ status: 'Approved', decided_at: new Date().toISOString() }).eq('id', r.id)
      await admin.from('site_compliance_downloads').insert({ family_key: r.family_key, member_id: null, email: r.email, source: 'website-request', page: r.page || null, ip: r.ip || null })
      return page('Approved', `<p>${sent ? `The ${esc(fam)} pack was emailed to <b>${esc(r.email)}</b>. The link works for 7 days.` : `Marked approved, but the email did not send. Send this link to ${esc(r.email)} yourself (works for 7 days):</p><p style="word-break:break-all;font-size:13px"><a href="${p.url}">${esc(p.url)}</a>`}</p>`)
    }
    if (d === 'decline') {
      await admin.from('site_compliance_requests').update({ status: 'Declined', decided_at: new Date().toISOString() }).eq('id', r.id)
      await sendEmail({ to: [r.email], subject: 'Your beyondGREEN compliance pack request', html: `<p style="margin:0 0 10px;font-size:17px;font-weight:700">Hi ${first},</p><p style="margin:0 0 8px;font-size:14px;line-height:1.6">Thanks for your interest in our ${esc(fam)} documents. We were not able to approve this request as submitted. If you are evaluating our products for a purchase or a bid, reply to this email with a few details and our team will follow up.</p><p style="margin:0;font-size:13px;color:#6b7280">Questions? Call (866) 364-9466.</p>` }).catch(() => {})
      return page('Declined', `<p>The request from ${esc(r.email)} was declined and they were sent a short note.</p>`)
    }
    return page('Choose an action', '<p>Please use the Approve or Decline button.</p>', 400)
  }

  const b = await req.json().catch(() => ({} as any))

  if (action === 'request') {
    if (str(b.website_url)) return out(req, { ok: true })
    if (Number(b.t) && Date.now() - Number(b.t) < 2500) return out(req, { ok: true })
    const email = str(b.email, 200).toLowerCase(), name = str(b.name, 120), company = str(b.company, 200), family = str(b.family, 60)
    if (!name) return out(req, { error: 'Please enter your name.' }, 400)
    if (!company) return out(req, { error: 'Please enter your company.' }, 400)
    if (!emailOk(email)) return out(req, { error: 'Please enter a valid work email.' }, 400)
    const { data: f } = await admin.from('site_compliance_families').select('key, name').eq('key', family).eq('is_active', true).maybeSingle()
    if (!f) return out(req, { error: 'Please pick a product line.' }, 400)
    if (ip) {
      const { count } = await admin.from('site_compliance_requests').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', new Date(Date.now() - 3600000).toISOString())
      if ((count || 0) >= 6) return out(req, { error: 'Too many requests from this network. Please email info@byndgrn.com.' }, 429)
    }
    const role = str(b.role, 120), use_case = str(b.use_case, 1000), phone = str(b.phone, 40)
    const token = randomBytes(20).toString('hex')
    const fname = (f as any).name
    const customerId = await logLead({ kind: 'compliance-pack', topic: 'Compliance pack request', email, name, company, phone, message: `Requested the compliance pack for ${fname}.${role ? `\nRole: ${role}` : ''}${use_case ? `\nFor: ${use_case}` : ''}`, details: { family, role, use_case }, page: str(b.page, 200), ip, leadSource: 'Website: Compliance pack', notify: false })
    const { error } = await admin.from('site_compliance_requests').insert({ family_key: family, name, company, email, phone: phone || null, role: role || null, use_case: use_case || null, token, customer_id: customerId, ip: ip || null, page: str(b.page, 200) || null })
    if (error) return out(req, { error: 'Please try again, or email info@byndgrn.com.' }, 500)
    const link = `${API_PUBLIC}/api/site/compliance/review?t=${token}`
    await notifyTeam({ to: NOTIFY_SIGNUPS, from: email, subject: `Approve? Compliance pack request · ${company} · ${fname}`, message: `${name} at ${company} requested the ${fname} compliance pack.`, html: `<p style="margin:0 0 6px;font-size:16px;font-weight:700">Compliance pack request: ${esc(fname)}</p><p style="margin:0 0 8px;font-size:14px;line-height:1.6"><strong>${esc(name)}</strong> · ${esc(company)}<br>${esc(email)}${phone ? '<br>' + esc(phone) : ''}${role ? '<br>Role: ' + esc(role) : ''}</p>${use_case ? `<div style="background:#f5f6fa;border-left:3px solid #037f4c;padding:12px 16px;font-size:14px;white-space:pre-wrap;line-height:1.5">${esc(use_case)}</div>` : ''}<p style="margin:14px 0"><a href="${link}" style="display:inline-block;background:#037f4c;color:#fff;text-decoration:none;font-weight:700;border-radius:8px;padding:12px 20px">Review and approve</a></p><p style="font-size:12px;color:#6b7280">Nothing is sent until someone approves. Approving emails them a download link that works for 7 days.</p>`, contextPath: customerId ? `/sales/customers?item=${customerId}` : '/bizdev/client-portals', replyTo: email }).catch(() => {})
    await sendEmail({ to: [email], subject: 'We received your compliance pack request', html: `<p style="margin:0 0 10px;font-size:17px;font-weight:700">Thanks, ${esc(name.split(' ')[0])}</p><p style="margin:0 0 8px;font-size:14px;line-height:1.6">We received your request for the <b>${esc(fname)}</b> compliance pack. Our team reviews each request and usually replies within one business day.</p><p style="margin:0;font-size:13px;color:#6b7280">Questions? Call (866) 364-9466.</p>` }).catch(() => {})
    return out(req, { ok: true })
  }

  if (action === 'planner') {
    if (str(b.website_url)) return out(req, { ok: true })
    if (Number(b.t) && Date.now() - Number(b.t) < 2500) return out(req, { ok: true })
    const email = str(b.email, 200).toLowerCase(), name = str(b.name, 120), company = str(b.company, 200)
    if (!name) return out(req, { error: 'Please enter your name.' }, 400)
    if (!emailOk(email)) return out(req, { error: 'Please enter a valid work email.' }, 400)
    if (ip) {
      const { count } = await admin.from('website_inquiries').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', new Date(Date.now() - 3600000).toISOString())
      if ((count || 0) >= 8) return out(req, { error: 'Too many requests from this network. Please email info@byndgrn.com.' }, 429)
    }
    const list = (v: any) => (Array.isArray(v) ? v : []).map((x: any) => str(x, 120)).filter(Boolean).slice(0, 30)
    const items = list(b.items), kit = list(b.kit)
    const wants = [b.sample_box ? 'Free sample box' : '', b.pilot ? 'A pilot program conversation (terms agreed in writing)' : ''].filter(Boolean)
    const message = [`Business type: ${str(b.business_type, 80) || 'Not given'}`, `Locations: ${str(b.locations, 20) || 'Not given'}`, `ZIP: ${str(b.zip, 12) || 'Not given'}`, `Menu: ${items.join(', ') || 'Not given'}`, `Recommended starter kit: ${kit.join('; ') || 'None'}`, `Wants: ${wants.join(', ') || 'Info only'}`, str(b.notes, 1000) ? `Notes: ${str(b.notes, 1000)}` : ''].filter(Boolean).join('\n')
    await logLead({ kind: 'switch-planner', topic: 'Switch planner', email, name, company, phone: str(b.phone, 40), message, details: { business_type: str(b.business_type, 80), locations: str(b.locations, 20), zip: str(b.zip, 12), items, kit, sample_box: !!b.sample_box, pilot: !!b.pilot }, page: str(b.page, 200), ip, leadSource: 'Website: Switch planner', notify: true })
    await sendEmail({ to: [email], subject: 'Your beyondGREEN starter kit', html: `<p style="margin:0 0 10px;font-size:17px;font-weight:700">Thanks, ${esc(name.split(' ')[0])}</p><p style="margin:0 0 8px;font-size:14px;line-height:1.6">Here is the starter kit we recommended:</p><ul style="margin:0 0 10px;padding-left:18px;font-size:14px;line-height:1.6">${kit.map((k: string) => `<li>${esc(k)}</li>`).join('')}</ul><p style="margin:0 0 8px;font-size:14px;line-height:1.6">${wants.length ? `You asked for: ${esc(wants.join(' and '))}. Someone from our team in Santa Ana will reach out within one business day to confirm the details.` : 'Someone from our team in Santa Ana will reach out within one business day.'}</p><p style="margin:0;font-size:13px;color:#6b7280">Questions? Call (866) 364-9466.</p>` }).catch(() => {})
    return out(req, { ok: true })
  }

  const m = await memberFromReq(req)
  if (!m) return out(req, { error: 'Please sign in first.', code: 'auth' }, 401)

  if (action === 'pack') {
    return out(req, { error: 'Please use the request form. Our team approves each pack request.', code: 'request' }, 403)
  }
  if (action === 'pack-legacy') {
    const family = str(b.family, 60)
    const { count } = await admin.from('site_compliance_downloads').select('id', { count: 'exact', head: true }).eq('member_id', m.id).gte('created_at', new Date(Date.now() - 3600000).toISOString())
    if ((count || 0) >= 30) return out(req, { error: 'Download limit reached. Please try again in an hour.' }, 429)
    const p = await packUrl(family)
    if (!p) return out(req, { error: 'That pack is not available right now. Please contact us.' }, 404)
    await admin.from('site_compliance_downloads').insert({ family_key: family, member_id: m.id, email: m.email, source: 'website', page: str(b.page, 200) || null, ip: ip || null })
    const { data: f } = await admin.from('site_compliance_families').select('name').eq('key', family).maybeSingle()
    await logLead({ kind: 'compliance-pack', topic: 'Compliance pack download', email: m.email, name: who(m), company: m.company, phone: m.phone, message: `Downloaded the compliance pack for ${(f as any)?.name || family}.`, details: { family, business_type: m.business_type }, page: str(b.page, 200), ip, leadSource: 'Website: Compliance pack' })
    return out(req, { ok: true, url: p.url, name: p.name })
  }

  if (action === 'law-access') {
    const state = str(b.state, 4).toUpperCase()
    const since = new Date(Date.now() - 86400000).toISOString()
    const { count } = await admin.from('website_inquiries').select('id', { count: 'exact', head: true }).eq('kind', 'regulations').ilike('email', m.email).gte('created_at', since)
    if (!count) await logLead({ kind: 'regulations', topic: 'State law map', email: m.email, name: who(m), company: m.company, phone: m.phone, message: `Opened full state law detail${state ? ` (first state: ${state})` : ''}.`, details: { state, business_type: m.business_type }, page: str(b.page, 200), ip, leadSource: 'Website: State law map' })
    return out(req, { ok: true, member: { first_name: m.first_name, email: m.email } })
  }

  return out(req, { error: 'Not found' }, 404)
}
