/* eslint-disable @typescript-eslint/no-explicit-any */
// Website "digital services": compliance packs, the gated state law map, and the switch planner.
//   GET  families           public list of packs and what is in each (no file paths)
//   POST pack               member: build/reuse the family ZIP, log the download as a lead
//   POST law-access         member: unlock full state law detail, logged as a lead (once a day)
//   POST planner            public: switch planner submission, becomes a lead
import { NextRequest, NextResponse } from 'next/server'
import { admin, cors, str, memberFromReq, clientIp, emailOk } from '@/lib/siteTemplates'
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
  return out(req, { error: 'Not found' }, 404)
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { action } = await (ctx.params as any)
  const b = await req.json().catch(() => ({} as any))
  const ip = clientIp(req)

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
    const wants = [b.sample_box ? 'Free sample box' : '', b.pilot ? 'Free pilot (first case of each item)' : ''].filter(Boolean)
    const message = [`Business type: ${str(b.business_type, 80) || 'Not given'}`, `Locations: ${str(b.locations, 20) || 'Not given'}`, `ZIP: ${str(b.zip, 12) || 'Not given'}`, `Menu: ${items.join(', ') || 'Not given'}`, `Recommended starter kit: ${kit.join('; ') || 'None'}`, `Wants: ${wants.join(', ') || 'Info only'}`, str(b.notes, 1000) ? `Notes: ${str(b.notes, 1000)}` : ''].filter(Boolean).join('\n')
    await logLead({ kind: 'switch-planner', topic: 'Switch planner', email, name, company, phone: str(b.phone, 40), message, details: { business_type: str(b.business_type, 80), locations: str(b.locations, 20), zip: str(b.zip, 12), items, kit, sample_box: !!b.sample_box, pilot: !!b.pilot }, page: str(b.page, 200), ip, leadSource: 'Website: Switch planner', notify: true })
    await sendEmail({ to: [email], subject: 'Your beyondGREEN starter kit', html: `<p style="margin:0 0 10px;font-size:17px;font-weight:700">Thanks, ${esc(name.split(' ')[0])}</p><p style="margin:0 0 8px;font-size:14px;line-height:1.6">Here is the starter kit we recommended:</p><ul style="margin:0 0 10px;padding-left:18px;font-size:14px;line-height:1.6">${kit.map((k: string) => `<li>${esc(k)}</li>`).join('')}</ul><p style="margin:0 0 8px;font-size:14px;line-height:1.6">${wants.length ? `You asked for: ${esc(wants.join(' and '))}. Someone from our team in Santa Ana will reach out within one business day to confirm the details.` : 'Someone from our team in Santa Ana will reach out within one business day.'}</p><p style="margin:0;font-size:13px;color:#6b7280">Questions? Call (866) 364-9466.</p>` }).catch(() => {})
    return out(req, { ok: true })
  }

  const m = await memberFromReq(req)
  if (!m) return out(req, { error: 'Please sign in first.', code: 'auth' }, 401)

  if (action === 'pack') {
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
