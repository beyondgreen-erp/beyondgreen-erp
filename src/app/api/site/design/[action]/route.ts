/* eslint-disable @typescript-eslint/no-explicit-any */
// Website Design Center: public catalog + live volume pricing (costs never leave the server),
// member design saves, printed orders (Shopify checkout when connected) and quote requests.
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase'
import { STAFF_DOMAINS, NOTIFY_SIGNUPS, NOTIFY_ORDERS, sendEmail, esc, button, likeExact } from '@/lib/portalServer'
import { admin, cors, str, memberFromReq, shopOn, shopifyCheckout, SITE_PUBLIC } from '@/lib/siteTemplates'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
type Ctx = { params: Promise<{ action: string }> | { action: string } }
const BUCKET = 'site-designs'

export async function OPTIONS(req: NextRequest) { return new NextResponse(null, { status: 204, headers: cors(req) }) }
const out = (req: NextRequest, b: any, status = 200) => NextResponse.json(b, { status, headers: { ...cors(req), 'Cache-Control': 'no-store' } })

async function settings() {
  const { data } = await admin.from('site_design_settings').select('key, value')
  const o: any = { gpm_tiers: [{ mult: 1, gpm: 0.45 }, { mult: 2.5, gpm: 0.38 }, { mult: 5, gpm: 0.3 }, { mult: 10, gpm: 0.24 }, { mult: 25, gpm: 0.18 }], plate_markup_gpm: 0.25, turnaround_us: '2 to 6 weeks', turnaround_intl: '75 to 90 days' }
  for (const r of (data || []) as any[]) o[r.key] = r.value
  return o
}
const r2 = (n: number) => Math.round(n * 100) / 100
const r4 = (n: number) => Math.round(n * 10000) / 10000
function tiersFor(p: any, st: any) {
  return (st.gpm_tiers as any[]).map(t => ({ qty: Math.ceil((p.moq * t.mult) / 50) * 50, gpm: Number(t.gpm) }))
}
function unitPrice(p: any, gpm: number, colors: number) {
  const c = Number(p.base_cost) + (p.full_color ? 0 : Number(p.print_cost_per_color || 0) * colors)
  return r4(c / (1 - gpm))
}
// US-made items print one color (any ink). Film bags: green and black are standard, white adds a premium,
// any other bag color adds a flat fee, and runs under the short-run quantity add a flat fee. Fees are spread per bag.
const BAG_CATS = ['grocery-and-produce-bags', 'pet-waste-bags', 'trash-and-kitchen-liners']
const STD_BAG = ['Green', 'Black']
function ruleOf(t: any, p: any) {
  if (p.origin !== 'US') return null
  if (t.category_slug === 'straw-wrappers') return 'straw_wrapper'
  return BAG_CATS.includes(t.category_slug) ? 'film_bag' : null
}
function bagRules(st: any) {
  return { white_premium: Number(st.bag_white_premium ?? 0.15), custom_color_fee: Number(st.bag_custom_color_fee ?? 500), short_run_fee: Number(st.bag_short_run_fee ?? 500), short_run_qty: Number(st.bag_short_run_qty ?? 125000) }
}
function priceFor(p: any, st: any, qty: number, colors: number, rule: string | null = null, productColor = '') {
  const tiers = tiersFor(p, st)
  const tier = [...tiers].reverse().find(t => qty >= t.qty) || null
  if (!tier) return null
  let unit = unitPrice(p, tier.gpm, colors)
  let customFee = 0, shortFee = 0
  if (rule === 'film_bag') {
    const br = bagRules(st)
    if (productColor === 'White') unit = r4(unit * (1 + br.white_premium))
    else if (!STD_BAG.includes(productColor)) customFee = br.custom_color_fee
    if (qty < br.short_run_qty) shortFee = br.short_run_fee
  }
  const plate = p.full_color ? 0 : r2((Number(p.plate_cost_per_color || 0) * colors) / (1 - Number(st.plate_markup_gpm)))
  const goods = unit * qty + customFee + shortFee
  return { unit: r4(goods / qty), base_unit: unit, custom_color_fee: customFee, short_run_fee: shortFee, plate_fee: plate, subtotal: r2(goods + plate), tier_qty: tier.qty }
}
function publicRow(t: any, p: any, st: any) {
  const buy = p.mode === 'buy' && p.base_cost != null
  const colorsList = p.full_color ? [1] : Array.from({ length: Math.max(1, p.max_colors) }, (_, i) => i + 1)
  const rule = ruleOf(t, p)
  return {
    rule, bag_rules: rule === 'film_bag' ? bagRules(st) : null,
    straw_sizes: rule === 'straw_wrapper' ? (st.straw_sizes || []) : null, straw_colors: rule === 'straw_wrapper' ? (st.straw_colors || []) : null,
    category_slug: t.category_slug, slug: t.slug, item: t.item, category: t.category, size: t.size, flat_size: t.flat_size, thumb_url: t.thumb_url,
    mode: buy ? 'buy' : 'quote', origin: p.origin, turnaround: p.origin === 'US' ? st.turnaround_us : st.turnaround_intl,
    moq: p.moq, max_colors: p.max_colors, full_color: p.full_color, product_colors: p.product_colors, panel_w: Number(p.panel_w) || 8, panel_h: Number(p.panel_h) || 10,
    tiers: buy ? tiersFor(p, st).map(tt => ({ qty: tt.qty, unit: Object.fromEntries(colorsList.map(c => [c, unitPrice(p, tt.gpm, c)])) })) : [],
    plate_fee_per_color: buy && !p.full_color ? r2(Number(p.plate_cost_per_color || 0) / (1 - Number(st.plate_markup_gpm))) : 0,
  }
}
async function loadOne(cat: string, slug: string) {
  const { data: t } = await admin.from('site_templates').select('id, slug, category, category_slug, item, size, flat_size, thumb_url').eq('is_active', true).eq('category_slug', cat).eq('slug', slug).maybeSingle()
  if (!t) return null
  const { data: p } = await admin.from('site_design_products').select('*').eq('template_id', (t as any).id).maybeSingle()
  return p && (p as any).is_active !== false ? { t: t as any, p: p as any } : null
}
async function staffEmail(): Promise<string | null> {
  try { const s = await createSupabaseServerClient(); const { data: { user } } = await s.auth.getUser(); const e = (user?.email || '').toLowerCase(); return e && STAFF_DOMAINS.some(d => e.endsWith('@' + d)) ? e : null } catch { return null }
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { action } = await (ctx.params as any)
  const url = new URL(req.url)
  if (action === 'catalog') {
    const st = await settings()
    const { data: ts } = await admin.from('site_templates').select('id, slug, category, category_slug, item, size, flat_size, thumb_url, sort_order').eq('is_active', true).order('sort_order')
    const { data: ps } = await admin.from('site_design_products').select('*')
    const pm = Object.fromEntries(((ps || []) as any[]).map(p => [p.template_id, p]))
    const items = ((ts || []) as any[]).filter(t => pm[t.id] && pm[t.id].is_active !== false).map(t => publicRow(t, pm[t.id], st))
    return NextResponse.json({ items, turnaround: { us: st.turnaround_us, intl: st.turnaround_intl }, checkout: shopOn() }, { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 's-maxage=60, stale-while-revalidate=600' } })
  }
  if (action === 'admin-orders') {
    if (!(await staffEmail())) return NextResponse.json({ error: 'Staff only' }, { status: 403 })
    const { data } = await admin.from('site_design_orders').select('*').order('created_at', { ascending: false }).limit(500)
    const rows = (data || []) as any[]
    for (const r of rows) if (r.proof_path) { const { data: s } = await admin.storage.from(BUCKET).createSignedUrl(r.proof_path, 3600); r.proof_url = s?.signedUrl || null }
    for (const r of rows) r.asset_urls = await Promise.all(((r.asset_paths || []) as string[]).map(async (a) => (await admin.storage.from(BUCKET).createSignedUrl(a, 3600)).data?.signedUrl || null))
    const { data: prods } = await admin.from('site_design_products').select('*, site_templates(item, category, category_slug, slug, is_active)')
    return NextResponse.json({ rows, products: prods || [], settings: await settings() })
  }
  return out(req, { error: 'Not found' }, 404)
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { action } = await (ctx.params as any)
  if (action === 'admin-status' || action === 'admin-product') {
    const who = await staffEmail(); if (!who) return NextResponse.json({ error: 'Staff only' }, { status: 403 })
    const b = await req.json().catch(() => ({}))
    if (action === 'admin-status') { await admin.from('site_design_orders').update({ status: str(b.status, 40), updated_at: new Date().toISOString() }).eq('id', b.id); return NextResponse.json({ ok: true }) }
    const upd: any = { updated_at: new Date().toISOString() }
    for (const k of ['mode', 'origin']) if (b[k]) upd[k] = b[k]
    for (const k of ['base_cost', 'print_cost_per_color', 'plate_cost_per_color', 'moq', 'max_colors']) if (b[k] !== undefined && b[k] !== '') upd[k] = Number(b[k])
    await admin.from('site_design_products').update(upd).eq('template_id', b.template_id)
    return NextResponse.json({ ok: true })
  }
  const b = await req.json().catch(() => ({} as any))
  if (action === 'price') {
    const x = await loadOne(str(b.category, 80), str(b.slug, 120))
    if (!x || x.p.mode !== 'buy') return out(req, { error: 'This item is quoted by our team.' }, 400)
    const st = await settings()
    const colors = x.p.full_color ? 1 : Math.min(Math.max(1, Number(b.colors) || 1), x.p.max_colors)
    const pr = priceFor(x.p, st, Math.floor(Number(b.qty) || 0), colors, ruleOf(x.t, x.p), str(b.product_color, 40))
    if (!pr) return out(req, { error: `Minimum order is ${x.p.moq.toLocaleString()}.`, moq: x.p.moq }, 400)
    return out(req, { ok: true, ...pr, colors })
  }

  const m = await memberFromReq(req)
  if (!m) return out(req, { error: 'Please sign in to continue.', code: 'auth' }, 401)

  if (action === 'upload-asset') {
    const data = String(b.data || ''), name = str(b.name, 120).replace(/[^A-Za-z0-9._-]+/g, '_') || 'artwork'
    const mt = data.match(/^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i)
    if (!mt) return out(req, { error: 'Please upload a PNG, JPG, SVG or PDF.' }, 400)
    if (!/^(image\/(png|jpe?g|svg\+xml|webp)|application\/pdf)$/i.test(mt[1])) return out(req, { error: 'Please upload a PNG, JPG, SVG or PDF.' }, 400)
    const buf = Buffer.from(mt[2], 'base64')
    if (buf.length > 3.5 * 1024 * 1024) return out(req, { error: 'Files up to 3.5 MB please. For bigger files, email them after you order.' }, 400)
    const path = `${m.id}/assets/${Date.now().toString(36)}-${name}`
    const { error } = await admin.storage.from(BUCKET).upload(path, buf, { contentType: mt[1], upsert: false })
    if (error) return out(req, { error: 'Upload failed. Please try again.' }, 500)
    return out(req, { ok: true, path })
  }

  if (action === 'my-orders') {
    const { data } = await admin.from('site_design_orders').select('id, template_item, category, kind, quantity, colors, product_color, subtotal, status, created_at, checkout_url, shopify_order_name, origin').eq('member_id', m.id).order('created_at', { ascending: false }).limit(100)
    return out(req, { orders: data || [] })
  }

  if (action === 'order') {
    if (!m.profile_complete) return out(req, { error: 'Please finish your profile first.', code: 'profile' }, 403)
    const x = await loadOne(str(b.category, 80), str(b.slug, 120))
    if (!x) return out(req, { error: 'Item not found.' }, 404)
    const st = await settings()
    const kind = b.kind === 'quote' || x.p.mode !== 'buy' ? 'quote' : 'order'
    const qty = Math.floor(Number(b.qty) || 0)
    const colors = x.p.full_color ? 1 : Math.min(Math.max(1, Number(b.colors) || 1), x.p.max_colors)
    let pr: any = null
    if (kind === 'order') { pr = priceFor(x.p, st, qty, colors, ruleOf(x.t, x.p), str(b.product_color, 40)); if (!pr) return out(req, { error: `Minimum order is ${x.p.moq.toLocaleString()}.` }, 400) }
    // print and product options (ink color, custom bag color, straw size and color)
    const rule = ruleOf(x.t, x.p)
    const opts: any = { ink_color: str(b.ink_color, 60) || null }
    if (rule === 'film_bag' && !['Green', 'Black', 'White'].includes(str(b.product_color, 40))) opts.bag_color = str(b.custom_color, 60) || str(b.product_color, 40)
    if (rule === 'straw_wrapper') { opts.wrapper = 'White'; opts.straw_size = str(b.straw_size, 60) || null; opts.straw_color = str(b.straw_color, 60) || null }
    if (pr) { opts.custom_color_fee = pr.custom_color_fee; opts.short_run_fee = pr.short_run_fee; opts.base_unit = pr.base_unit }
    const optTxt = [opts.ink_color && `Ink: ${opts.ink_color}`, opts.bag_color && `Bag color: ${opts.bag_color}`, opts.straw_size && `Straw: ${opts.straw_size}`, opts.straw_color && `Straw color: ${opts.straw_color}`, opts.wrapper && 'White wrapper', opts.custom_color_fee ? `Custom color fee $${opts.custom_color_fee}` : '', opts.short_run_fee ? `Short run fee $${opts.short_run_fee}` : ''].filter(Boolean).join(' · ')
    // proof image
    let proof_path: string | null = null
    const pm = String(b.proof || '').match(/^data:image\/(png|jpeg);base64,(.+)$/)
    if (pm) {
      proof_path = `${m.id}/proofs/${Date.now().toString(36)}.${pm[1] === 'png' ? 'png' : 'jpg'}`
      await admin.storage.from(BUCKET).upload(proof_path, Buffer.from(pm[2], 'base64'), { contentType: `image/${pm[1]}` })
    }
    const assets = (Array.isArray(b.assets) ? b.assets : []).map((a: any) => str(a, 300)).filter((a: string) => a.startsWith(`${m.id}/assets/`)).slice(0, 10)
    const design = b.design && typeof b.design === 'object' ? b.design : null
    if (design && JSON.stringify(design).length > 900000) return out(req, { error: 'Your design is too large to save. Try a smaller logo file.' }, 400)
    // Lead on Customer/Leads (same rule as other website inquiries)
    let customerId: string | null = null
    const { data: hit } = await admin.from('customers').select('id').ilike('email', likeExact(m.email)).not('is_merged', 'is', true).limit(1)
    if (hit && hit.length) customerId = (hit[0] as any).id
    else {
      const { data: c } = await admin.from('customers').insert({ company_name: m.company || m.email, contact_name: [m.first_name, m.last_name].filter(Boolean).join(' '), email: m.email, phone: m.phone || null, board: 'customer', customer_status: 'Lead', lead_source: 'Website: Design Center', is_active: true, is_scraped_lead: false, notes: `Design Center ${kind}: ${x.t.item}` }).select('id').single()
      customerId = (c as any)?.id || null
    }
    const row: any = {
      member_id: m.id, email: m.email, company: m.company, name: [m.first_name, m.last_name].filter(Boolean).join(' '), phone: str(b.phone, 40) || m.phone,
      template_id: x.t.id, template_item: x.t.item, category: x.t.category, kind, quantity: qty || null, colors, product_color: str(b.product_color, 40),
      unit_price: pr?.unit || null, plate_fee: pr?.plate_fee ?? null, subtotal: pr?.subtotal || null, origin: x.p.origin,
      design, proof_path, asset_paths: assets, notes: str(b.notes, 3000) || null, ship_zip: str(b.ship_zip, 12) || null,
      status: kind === 'quote' ? 'Quote requested' : 'Awaiting payment', customer_id: customerId, options: opts,
    }
    const { data: ord, error } = await admin.from('site_design_orders').insert(row).select('*').single()
    if (error || !ord) return out(req, { error: 'We could not save your order. Please try again.' }, 500)
    const o: any = ord
    let checkout: string | null = null
    if (kind === 'order' && shopOn()) {
      try {
        const d = await shopifyCheckout({ email: m.email, title: `Custom printed ${x.t.item} (${colors}${x.p.full_color ? ', full color' : ` color${colors > 1 ? 's' : ''}`}, ${row.product_color || 'standard'}${opts.ink_color ? `, ${opts.ink_color} ink` : ''})`, price: o.subtotal, quantity: 1, purchaseId: o.id, note: `Design Center order ${o.id}. ${qty.toLocaleString()} pcs at $${pr.unit} plus plate fee $${pr.plate_fee}. ${optTxt}. Turnaround ${x.p.origin === 'US' ? st.turnaround_us : st.turnaround_intl}. Shipping quoted separately.`, tags: ['design-center', x.t.category_slug], attrs: { quantity_pcs: String(qty) } })
        checkout = d.url
        await admin.from('site_design_orders').update({ checkout_url: d.url, shopify_draft_id: d.id }).eq('id', o.id)
      } catch { /* team follows up with a payment link */ }
    }
    await admin.from('website_inquiries').insert({ kind: 'design-center', topic: kind === 'quote' ? 'Design Center quote' : 'Design Center order', name: row.name || m.email, company: m.company || null, email: m.email, phone: row.phone || null, message: `${kind === 'quote' ? 'Quote request' : 'Order'}: ${x.t.item}${qty ? `, ${qty.toLocaleString()} pcs` : ''}${row.subtotal ? `, $${row.subtotal}` : ''}. ${row.notes || ''}`, details: { order_id: o.id, colors, product_color: row.product_color, origin: x.p.origin, ...opts }, page: `/design/${x.t.category_slug}/${x.t.slug}`, customer_id: customerId })
    const turn = x.p.origin === 'US' ? st.turnaround_us : st.turnaround_intl
    await sendEmail({ to: kind === 'quote' ? NOTIFY_SIGNUPS : Array.from(new Set([...NOTIFY_SIGNUPS, ...NOTIFY_ORDERS])), subject: `Design Center ${kind === 'quote' ? 'quote request' : 'order'}: ${x.t.item} for ${m.company || m.email}`, html: `<p style="margin:0 0 8px"><b>${esc(row.name)}</b> (${esc(m.email)}${row.phone ? `, ${esc(row.phone)}` : ''}), ${esc(m.company || '')}</p><p style="margin:0 0 8px">${esc(x.t.item)} · ${qty ? qty.toLocaleString() + ' pcs · ' : ''}${colors} color(s) · ${esc(row.product_color || '')}${row.subtotal ? ` · $${row.subtotal} (unit $${row.unit_price}, plates $${row.plate_fee})` : ''}</p>${optTxt ? `<p style="margin:0 0 8px">${esc(optTxt)}</p>` : ''}<p style="margin:0 0 8px">Made: ${x.p.origin === 'US' ? 'USA' : 'International'} · ${esc(turn)}${row.ship_zip ? ` · Ship to ZIP ${esc(row.ship_zip)}` : ''}</p>${row.notes ? `<p style="margin:0 0 8px">Notes: ${esc(row.notes)}</p>` : ''}<p style="margin:0">${checkout ? 'Shopify checkout link created.' : kind === 'order' ? 'No Shopify checkout yet: please send the customer a payment link.' : 'Please send a quote within 1 business day.'}</p>` })
    await sendEmail({ to: [m.email], subject: kind === 'quote' ? `We got your design for ${x.t.item}` : `Your beyondGREEN order: ${x.t.item}`, html: `<p style="margin:0 0 12px">Hi ${esc(m.first_name || 'there')},</p><p style="margin:0 0 12px">${kind === 'quote' ? `Thanks for designing your ${esc(x.t.item)}. Our team will send your quote within 1 business day.` : `Thanks for your order of ${qty.toLocaleString()} custom ${esc(x.t.item)}. Total $${o.subtotal} before shipping.`}</p><p style="margin:0 0 12px">Next, our prepress team checks your artwork and sends a digital proof for your approval. ${x.p.origin === 'US' ? `Made in the USA: ${esc(turn)} after proof approval. We confirm your date once the order is placed.` : `Made at our international facility: ${esc(turn)} after proof approval.`}</p>${checkout ? button(checkout, 'Complete payment') : kind === 'order' ? '<p style="margin:0 0 12px">We will email you a secure payment link shortly.</p>' : ''}<p style="margin:0;font-size:13px;color:#6b7280">Questions? Call (866) 364-9466.</p>` })
    return out(req, { ok: true, id: o.id, kind, checkout_url: checkout, subtotal: o.subtotal, turnaround: turn, origin: x.p.origin })
  }
  return out(req, { error: 'Not found' }, 404)
}
