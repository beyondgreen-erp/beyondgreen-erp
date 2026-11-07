/* eslint-disable @typescript-eslint/no-explicit-any */
// Website die line template library API (members-only downloads).
// Public:  GET list, GET verify, GET settings
// Members: POST signup | login | resend | forgot | reset | oauth | me | profile | logout | download | download-zip
// Staff:   GET admin-data | admin-csv, POST admin-upload, admin-toggle (ERP session, staff domain)
// Loader:  POST admin-upload with X-Sync-Key (key hash lives in portal_config)
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase'
import { STAFF_DOMAINS } from '@/lib/portalServer'
import {
  admin, cors, str, emailOk, sha, slugify, safeNext, createSession, memberFromReq, publicMember, anonClient,
  sendVerifyEmail, sendResetEmail, announceMember, downloadsLastHour, clientIp, syncKeyOk, buildZip,
  PDF_BUCKET, THUMB_BUCKET, SITE_PUBLIC, RATE_LIMIT_PER_HOUR, BUSINESS_TYPES, CATEGORY_ORDER,
} from '@/lib/siteTemplates'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Ctx = { params: Promise<{ action: string }> | { action: string } }

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(req) })
}

function out(req: NextRequest, body: any, status = 200) {
  return NextResponse.json(body, { status, headers: { ...cors(req), 'Cache-Control': 'no-store' } })
}

const PUBLIC_COLS = 'id, slug, category, category_slug, item, size, flat_size, thumb_url, sort_order'

async function listTemplates() {
  const { data } = await admin.from('site_templates').select(PUBLIC_COLS).eq('is_active', true).order('sort_order').order('item')
  const rows = (data || []) as any[]
  const cats = Array.from(new Set(rows.map(r => r.category)))
  cats.sort((a, b) => { const ia = CATEGORY_ORDER.indexOf(a), ib = CATEGORY_ORDER.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b) })
  return { templates: rows, categories: cats.map(c => ({ name: c, slug: rows.find(r => r.category === c).category_slug, count: rows.filter(r => r.category === c).length })) }
}

async function staffEmail(): Promise<string | null> {
  try {
    const s = await createSupabaseServerClient()
    const { data: { user } } = await s.auth.getUser()
    const e = (user?.email || '').toLowerCase()
    return e && STAFF_DOMAINS.some(d => e.endsWith('@' + d)) ? e : null
  } catch { return null }
}

async function googleEnabled(): Promise<boolean> {
  try {
    const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '' }, cache: 'no-store' })
    const j = await r.json(); return !!j?.external?.google
  } catch { return false }
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { action } = await (ctx.params as any)
  const url = new URL(req.url)

  if (action === 'list') {
    const res = NextResponse.json(await listTemplates(), { headers: { ...cors(req), 'Cache-Control': 's-maxage=60, stale-while-revalidate=600' } })
    return res
  }
  if (action === 'settings') {
    return out(req, { google: await googleEnabled(), business_types: BUSINESS_TYPES, rate_limit_per_hour: RATE_LIMIT_PER_HOUR })
  }
  if (action === 'verify') {
    const t = url.searchParams.get('t') || ''
    const { data: tok } = await admin.from('site_member_tokens').select('*').eq('token_hash', sha(t)).eq('purpose', 'verify').maybeSingle()
    if (!tok || (tok as any).used_at || new Date((tok as any).expires_at).getTime() < Date.now()) {
      return NextResponse.redirect(`${SITE_PUBLIC}/templates/login?expired=1`, 302)
    }
    const m: any = tok
    await admin.auth.admin.updateUserById(m.member_id, { email_confirm: true })
    await admin.from('site_member_tokens').update({ used_at: new Date().toISOString() }).eq('token_hash', sha(t))
    await admin.from('site_members').update({ email_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', m.member_id)
    const session = await createSession(m.member_id)
    return NextResponse.redirect(`${SITE_PUBLIC}/templates/welcome#s=${encodeURIComponent(session)}&next=${encodeURIComponent(safeNext(m.next_path))}`, 302)
  }

  // ── Staff admin (ERP) ──
  if (action === 'admin-data' || action === 'admin-csv') {
    const who = await staffEmail()
    if (!who) return NextResponse.json({ error: 'Staff only' }, { status: 403 })
    const from = url.searchParams.get('from'), to = url.searchParams.get('to')
    const tpl = url.searchParams.get('template') || '', company = url.searchParams.get('company') || ''
    const kind = url.searchParams.get('kind') || 'downloads'
    if (kind === 'members') {
      let q = admin.from('site_members').select('*').order('created_at', { ascending: false }).limit(5000)
      if (from) q = q.gte('created_at', from)
      if (to) q = q.lte('created_at', to + 'T23:59:59')
      if (company) q = q.ilike('company', `%${company}%`)
      const { data } = await q
      const rows = (data || []) as any[]
      if (action === 'admin-csv') return csv('template_members', ['created_at', 'first_name', 'last_name', 'email', 'company', 'business_type', 'phone', 'marketing_consent', 'provider', 'email_verified_at'], rows)
      return NextResponse.json({ rows })
    }
    let q = admin.from('site_template_downloads').select('*').order('created_at', { ascending: false }).limit(10000)
    if (from) q = q.gte('created_at', from)
    if (to) q = q.lte('created_at', to + 'T23:59:59')
    if (tpl) q = q.ilike('template_item', `%${tpl}%`)
    if (company) q = q.ilike('company', `%${company}%`)
    const { data } = await q
    const rows = (data || []) as any[]
    if (action === 'admin-csv') return csv('template_downloads', ['created_at', 'email', 'company', 'template_item', 'category', 'kind', 'member_id'], rows)
    const { data: tplRows } = await admin.from('site_templates').select('*').order('category').order('sort_order')
    return NextResponse.json({ rows, templates: tplRows || [] })
  }
  return out(req, { error: 'Not found' }, 404)
}

function csv(name: string, cols: string[], rows: any[]) {
  const e = (v: any) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
  const body = [cols.join(','), ...rows.map(r => cols.map(c => e(r[c])).join(','))].join('\n')
  return new NextResponse(body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}_${new Date().toISOString().slice(0, 10)}.csv"` } })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { action } = await (ctx.params as any)
  if (action === 'admin-upload') return adminUpload(req)
  if (action === 'admin-toggle') {
    const who = await staffEmail(); if (!who) return NextResponse.json({ error: 'Staff only' }, { status: 403 })
    const b = await req.json().catch(() => ({}))
    await admin.from('site_templates').update({ is_active: !!b.is_active, updated_at: new Date().toISOString() }).eq('id', b.id)
    return NextResponse.json({ ok: true })
  }
  const b = await req.json().catch(() => ({} as any))
  if (str(b.website_url)) return out(req, { ok: true }) // honeypot

  if (action === 'signup') {
    const email = str(b.email, 200).toLowerCase()
    const first = str(b.first_name, 80), last = str(b.last_name, 80), company = str(b.company, 160)
    const btype = BUSINESS_TYPES.includes(b.business_type) ? b.business_type : ''
    const phone = str(b.phone, 40), password = String(b.password || '')
    if (!first || !last || !company || !btype) return out(req, { error: 'Please fill in every required field.' }, 400)
    if (!emailOk(email)) return out(req, { error: 'Please enter a valid work email.' }, 400)
    if (password.length < 8) return out(req, { error: 'Please use a password with at least 8 characters.' }, 400)
    if (!b.agree_terms) return out(req, { error: 'Please agree to the Terms and Privacy Policy.' }, 400)
    const { data: existing } = await admin.from('site_members').select('id, email_verified_at').eq('email', email).maybeSingle()
    if (existing) return out(req, { error: 'You already have an account. Please sign in instead.', code: 'exists' }, 409)
    const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: false, app_metadata: { site_member: true }, user_metadata: { first_name: first, last_name: last, company } })
    if (error || !created?.user) {
      if (/already|registered|exists/i.test(error?.message || '')) return out(req, { error: 'This email already has a beyondGREEN account. Please sign in with that password.', code: 'exists' }, 409)
      return out(req, { error: 'We could not create your account. Please try again.' }, 500)
    }
    const consent = !!b.marketing_consent
    const row = { id: created.user.id, email, first_name: first, last_name: last, company, business_type: btype, phone: phone || null, marketing_consent: consent, consent_at: consent ? new Date().toISOString() : null, provider: 'email', profile_complete: true }
    await admin.from('site_members').insert(row)
    const sent = await sendVerifyEmail(row, safeNext(b.next))
    await announceMember({ ...row, created_at: new Date().toISOString() })
    return out(req, { ok: true, verify_sent: sent })
  }

  if (action === 'login') {
    const email = str(b.email, 200).toLowerCase(), password = String(b.password || '')
    if (!emailOk(email) || !password) return out(req, { error: 'Please enter your email and password.' }, 400)
    const { data, error } = await anonClient().auth.signInWithPassword({ email, password })
    if (error || !data?.user) {
      if (/confirm/i.test(error?.message || '')) return out(req, { error: 'Please confirm your email first. We can send the link again.', code: 'unverified' }, 403)
      return out(req, { error: 'That email and password do not match.' }, 401)
    }
    const uid = data.user.id
    let { data: m } = await admin.from('site_members').select('*').eq('id', uid).maybeSingle()
    if (!m) {
      const meta: any = data.user.user_metadata || {}
      const ins = { id: uid, email, first_name: meta.first_name || null, last_name: meta.last_name || null, company: meta.company || null, provider: 'email', email_verified_at: new Date().toISOString(), profile_complete: false }
      await admin.from('site_members').insert(ins); m = ins as any
    } else if (!(m as any).email_verified_at) {
      await admin.from('site_members').update({ email_verified_at: new Date().toISOString() }).eq('id', uid)
    }
    const session = await createSession(uid)
    return out(req, { ok: true, session, member: publicMember(m) })
  }

  if (action === 'resend') {
    const email = str(b.email, 200).toLowerCase()
    const { data: m } = await admin.from('site_members').select('*').eq('email', email).maybeSingle()
    if (m && !(m as any).email_verified_at) await sendVerifyEmail(m, safeNext(b.next))
    return out(req, { ok: true })
  }

  if (action === 'forgot') {
    const email = str(b.email, 200).toLowerCase()
    const { data: m } = await admin.from('site_members').select('*').eq('email', email).maybeSingle()
    if (m) await sendResetEmail(m)
    return out(req, { ok: true }) // same answer either way
  }

  if (action === 'reset') {
    const t = String(b.t || ''), password = String(b.password || '')
    if (password.length < 8) return out(req, { error: 'Please use a password with at least 8 characters.' }, 400)
    const { data: tok } = await admin.from('site_member_tokens').select('*').eq('token_hash', sha(t)).eq('purpose', 'reset').maybeSingle()
    if (!tok || (tok as any).used_at || new Date((tok as any).expires_at).getTime() < Date.now()) return out(req, { error: 'This reset link has expired. Please ask for a new one.' }, 400)
    const mid = (tok as any).member_id
    await admin.auth.admin.updateUserById(mid, { password, email_confirm: true })
    await admin.from('site_member_tokens').update({ used_at: new Date().toISOString() }).eq('token_hash', sha(t))
    await admin.from('site_members').update({ email_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', mid).is('email_verified_at', null)
    const session = await createSession(mid)
    return out(req, { ok: true, session })
  }

  if (action === 'oauth') {
    // Google sign-in happens on the website through Supabase Auth; we only trust a token Supabase verifies.
    const token = String(b.access_token || '')
    const { data, error } = await admin.auth.getUser(token)
    if (error || !data?.user?.email) return out(req, { error: 'Google sign-in did not work. Please try again.' }, 401)
    const u = data.user, email = u.email!.toLowerCase(), meta: any = u.user_metadata || {}
    let { data: m } = await admin.from('site_members').select('*').eq('id', u.id).maybeSingle()
    let isNew = false
    if (!m) {
      const full = String(meta.full_name || meta.name || '').trim().split(/\s+/)
      const ins = { id: u.id, email, first_name: meta.given_name || full[0] || null, last_name: meta.family_name || full.slice(1).join(' ') || null, provider: 'google', email_verified_at: new Date().toISOString(), profile_complete: false }
      await admin.from('site_members').insert(ins); m = ins as any; isNew = true
    }
    const session = await createSession(u.id)
    return out(req, { ok: true, session, member: publicMember(m), is_new: isNew })
  }

  // Everything below needs a member session.
  const m = await memberFromReq(req)
  if (!m) return out(req, { error: 'Please sign in to continue.', code: 'auth' }, 401)

  if (action === 'me') {
    const { data: dl } = await admin.from('site_template_downloads').select('created_at, template_item, template_slug, category, kind, template_id').eq('member_id', m.id).order('created_at', { ascending: false }).limit(200)
    const ids = Array.from(new Set((dl || []).map((d: any) => d.template_id).filter(Boolean)))
    const { data: tpls } = ids.length ? await admin.from('site_templates').select('id, slug, category_slug, thumb_url, size').in('id', ids) : { data: [] as any[] }
    const map = Object.fromEntries((tpls || []).map((t: any) => [t.id, t]))
    return out(req, { member: publicMember(m), downloads: (dl || []).map((d: any) => ({ ...d, path: map[d.template_id] ? `/templates/${map[d.template_id].category_slug}/${map[d.template_id].slug}` : null, thumb_url: map[d.template_id]?.thumb_url || null, size: map[d.template_id]?.size || null })) })
  }

  if (action === 'profile') {
    const first = str(b.first_name, 80), last = str(b.last_name, 80), company = str(b.company, 160)
    const btype = BUSINESS_TYPES.includes(b.business_type) ? b.business_type : ''
    if (!first || !last || !company || !btype) return out(req, { error: 'Please fill in every required field.' }, 400)
    const wasComplete = !!m.profile_complete
    const consent = !!b.marketing_consent
    const upd = { first_name: first, last_name: last, company, business_type: btype, phone: str(b.phone, 40) || null, marketing_consent: consent, consent_at: consent ? (m.marketing_consent ? m.consent_at : new Date().toISOString()) : null, profile_complete: true, updated_at: new Date().toISOString() }
    await admin.from('site_members').update(upd).eq('id', m.id)
    if (!wasComplete) await announceMember({ ...m, ...upd })
    return out(req, { ok: true, member: publicMember({ ...m, ...upd }) })
  }

  if (action === 'logout') {
    const tok = (req.headers.get('authorization') || '').slice(7).trim()
    await admin.from('site_member_sessions').delete().eq('token_hash', sha(tok))
    return out(req, { ok: true })
  }

  if (action === 'download' || action === 'download-zip') {
    if (!m.profile_complete) return out(req, { error: 'Please finish your profile first.', code: 'profile' }, 403)
    let tpls: any[] = []
    if (action === 'download') {
      const { data } = await admin.from('site_templates').select('*').eq('is_active', true).eq('category_slug', str(b.category, 80)).eq('slug', str(b.slug, 120)).maybeSingle()
      if (data) tpls = [data]
    } else {
      const { data } = await admin.from('site_templates').select('*').eq('is_active', true).eq('category_slug', str(b.category, 80)).order('sort_order')
      tpls = data || []
    }
    if (!tpls.length) return out(req, { error: 'Template not found.' }, 404)
    const used = await downloadsLastHour(m.id)
    if (used + (action === 'download' ? 1 : tpls.length) > RATE_LIMIT_PER_HOUR) return out(req, { error: `You have reached the limit of ${RATE_LIMIT_PER_HOUR} downloads per hour. Please try again a little later.`, code: 'rate' }, 429)
    const ip = clientIp(req)
    await admin.from('site_template_downloads').insert(tpls.map(t => ({ member_id: m.id, email: m.email, company: m.company, template_id: t.id, template_item: t.item, template_slug: t.slug, category: t.category, kind: action === 'download' ? 'single' : 'zip', ip })))
    if (action === 'download') {
      const t = tpls[0]
      const fname = t.pdf_path.split('/').pop()
      const { data: signed, error } = await admin.storage.from(PDF_BUCKET).createSignedUrl(t.pdf_path, 300, { download: fname })
      if (error || !signed?.signedUrl) return out(req, { error: 'Download is not available right now. Please try again.' }, 500)
      return out(req, { ok: true, url: signed.signedUrl, filename: fname, expires_in: 300 })
    }
    const files: { name: string; data: Uint8Array }[] = []
    for (const t of tpls) {
      const { data: blob } = await admin.storage.from(PDF_BUCKET).download(t.pdf_path)
      if (blob) files.push({ name: t.pdf_path.split('/').pop(), data: new Uint8Array(await blob.arrayBuffer()) })
    }
    const zip = buildZip(files)
    const zname = `beyondGREEN_DieLines_${tpls[0].category.replace(/[^A-Za-z0-9]+/g, '_')}.zip`
    return new NextResponse(zip as any, { headers: { ...cors(req), 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${zname}"`, 'Cache-Control': 'no-store' } })
  }

  return out(req, { error: 'Not found' }, 404)
}

// Add or replace a template: PDF + thumbnail + its index fields. Staff (ERP session) or the bulk loader key.
async function adminUpload(req: NextRequest) {
  const who = (await staffEmail()) || ((await syncKeyOk(req)) ? 'loader' : null)
  if (!who) return NextResponse.json({ error: 'Staff only' }, { status: 403 })
  const fd = await req.formData()
  const category = str(fd.get('category'), 80), item = str(fd.get('item'), 160)
  if (!category || !item) return NextResponse.json({ error: 'Category and item are required.' }, { status: 400 })
  const category_slug = slugify(category)
  const slug = str(fd.get('slug'), 120) || slugify(item)
  const pdf = fd.get('pdf') as File | null, thumb = fd.get('thumb') as File | null
  const { data: existing } = await admin.from('site_templates').select('*').eq('category_slug', category_slug).eq('slug', slug).maybeSingle()
  if (!existing && (!pdf || !pdf.size)) return NextResponse.json({ error: 'A PDF is required for a new template.' }, { status: 400 })
  let pdf_path = (existing as any)?.pdf_path || ''
  if (pdf && pdf.size) {
    if (!/pdf$/i.test(pdf.type) && !/\.pdf$/i.test(pdf.name)) return NextResponse.json({ error: 'The template file must be a PDF.' }, { status: 400 })
    const folder = category.replace(/[^A-Za-z0-9]+/g, '_')
    const fname = (str(fd.get('pdf_name'), 160) || pdf.name).replace(/[^A-Za-z0-9._-]+/g, '_')
    pdf_path = `${folder}/${fname}`
    const { error } = await admin.storage.from(PDF_BUCKET).upload(pdf_path, Buffer.from(await pdf.arrayBuffer()), { contentType: 'application/pdf', upsert: true })
    if (error) return NextResponse.json({ error: 'PDF upload failed: ' + error.message }, { status: 500 })
  }
  let thumb_url = (existing as any)?.thumb_url || null
  if (thumb && thumb.size) {
    const ext = (thumb.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z]/g, '') || 'png'
    const tpath = `${category_slug}/${slug}-${Date.now().toString(36)}.${ext}`
    const { error } = await admin.storage.from(THUMB_BUCKET).upload(tpath, Buffer.from(await thumb.arrayBuffer()), { contentType: thumb.type || 'image/png', upsert: true, cacheControl: '31536000' })
    if (error) return NextResponse.json({ error: 'Thumbnail upload failed: ' + error.message }, { status: 500 })
    thumb_url = admin.storage.from(THUMB_BUCKET).getPublicUrl(tpath).data.publicUrl
  }
  const rec: any = { slug, category, category_slug, item, size: str(fd.get('size'), 80) || (existing as any)?.size || null, flat_size: str(fd.get('flat_size'), 80) || (existing as any)?.flat_size || null, pdf_path, thumb_url, is_active: true, updated_at: new Date().toISOString() }
  const so = Number(fd.get('sort_order')); if (Number.isFinite(so) && fd.get('sort_order') !== null) rec.sort_order = so
  if (existing) await admin.from('site_templates').update(rec).eq('id', (existing as any).id)
  else await admin.from('site_templates').insert(rec)
  return NextResponse.json({ ok: true, slug, category_slug, replaced: !!existing, by: who })
}
