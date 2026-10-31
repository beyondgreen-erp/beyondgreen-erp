/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Private Cash Flow & Liability board — the only door into the cf_* tables.
 *
 * Every call must be (1) a signed-in ERP user, (2) on cf_members, and (3) holding a
 * 2-step session made by entering a 6-digit code emailed to them plus the board password (12 hours). The tables
 * have RLS on with no policies, so the browser can never read them directly.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'crypto'
import Anthropic from '@anthropic-ai/sdk'
import { createSupabaseServerClient } from '@/lib/supabase'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { aiErrorMessage } from '@/lib/aiError'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const COOKIE = 'cf_2fa'
const SESSION_HOURS = 12
const CODE_MINUTES = 10
const pepper = () => (process.env.SUPABASE_SERVICE_ROLE_KEY || 'cf').slice(-24)
const hash = (s: string) => createHash('sha256').update(pepper() + ':' + s).digest('hex')
const json = (d: any, status = 200) => NextResponse.json(d, { status })
const ipOf = (req: NextRequest) => (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null

async function whoAmI() {
  const sb = await createSupabaseServerClient()
  const { data } = await sb.auth.getUser()
  return (data.user?.email || '').toLowerCase() || null
}

async function gate(req: NextRequest, needVerified = true) {
  const email = await whoAmI()
  if (!email) return { ok: false as const, res: json({ error: 'Sign in first.' }, 401) }
  const admin = createSupabaseAdminClient()
  const { data: m } = await admin.from('cf_members').select('email,name').eq('email', email).maybeSingle()
  if (!m) return { ok: false as const, res: json({ error: 'This board is private.', member: false }, 403) }
  if (!needVerified) return { ok: true as const, email, name: m.name as string, admin }
  const tok = req.cookies.get(COOKIE)?.value
  if (!tok) return { ok: false as const, res: json({ error: 'Enter your 2-step code.', member: true, verified: false }, 401) }
  const { data: s } = await admin.from('cf_sessions').select('email,expires_at,revoked_at').eq('token_hash', hash(tok)).maybeSingle()
  if (!s || s.revoked_at || new Date(s.expires_at) < new Date() || s.email !== email) {
    return { ok: false as const, res: json({ error: 'Your 2-step session ended. Enter a new code.', member: true, verified: false }, 401) }
  }
  return { ok: true as const, email, name: m.name as string, admin }
}

async function audit(admin: any, email: string, action: string, detail: any = null) {
  try { await admin.from('cf_audit').insert({ email, action, detail }) } catch { /* best-effort */ }
}

// ── whitelisted writes ────────────────────────────────────────────────────────
const TABLES: Record<string, { table: string; fields: string[] }> = {
  liability: { table: 'cf_liabilities', fields: ['kind', 'name', 'account_code', 'balance', 'original_balance', 'apr', 'min_payment', 'min_frequency', 'due_date', 'priority', 'critical', 'negotiated_amount', 'contact', 'notes', 'status'] },
  expense: { table: 'cf_expenses', fields: ['name', 'category', 'amount', 'frequency', 'day_of_month', 'active', 'notes'] },
  income: { table: 'cf_income', fields: ['name', 'category', 'amount', 'frequency', 'expected_date', 'probability', 'active', 'notes'] },
}
const SETTINGS = ['cash_on_hand', 'cash_as_of', 'min_reserve', 'weekly_budget', 'quarterly_goal', 'strategy', 'collect_rate', 'collect_lag_days', 'plan_start']
const clean = (fields: string[], row: any) => Object.fromEntries(Object.entries(row || {}).filter(([k]) => fields.includes(k)).map(([k, v]) => [k, v === '' ? null : v]))

// ── ERP data the plan uses (read with the service role, summarized) ───────────
async function erpInflows(admin: any) {
  const [inv, so, wm, pay] = await Promise.all([
    admin.from('invoices').select('id,invoice_number_display,invoice_number,customer_name,due_date,invoice_date,balance_due,total_amount,amount_paid,status')
      .eq('is_active', true).limit(2000),
    admin.from('sales_orders').select('id,order_number,notes,status,required_ship_date,ship_date,total_amount,payment_terms,customers(company_name)')
      .eq('archived', false).eq('is_active', true).not('status', 'in', '("Shipped","Cancelled","Closed","Completed")').limit(1000),
    admin.from('walmart_board_orders').select('id,po_number,name,group_name,ship_due_date,total_value').eq('archived', false)
      .not('group_name', 'in', '("Shipped","Cancelled")').limit(500),
    admin.from('payments').select('amount,paid_on').is('voided_at', null).gte('paid_on', new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10)).limit(5000),
  ])
  const ar = ((inv.data || []) as any[]).map(i => ({ id: i.id, number: i.invoice_number_display || String(i.invoice_number || ''), customer: i.customer_name,
    due: i.due_date, issued: i.invoice_date, open: Number(i.balance_due ?? (Number(i.total_amount || 0) - Number(i.amount_paid || 0))) || 0, status: i.status }))
    .filter(i => i.open > 0.5)
  const pipeline = ((so.data || []) as any[]).map(o => ({ id: o.id, number: o.order_number, name: o.customers?.company_name || String(o.notes || '').split('|')[0].trim(),
    status: o.status, ship: o.required_ship_date || o.ship_date, value: Number(o.total_amount) || 0, terms: o.payment_terms })).filter(o => o.value > 0)
  const walmart = ((wm.data || []) as any[]).map(o => ({ id: o.id, po: o.po_number, group: o.group_name, ship: o.ship_due_date, value: Number(o.total_value) || 0 })).filter(o => o.value > 0)
  const collected = ((pay.data || []) as any[]).reduce((t, p) => t + (Number(p.amount) || 0), 0)
  return { ar, pipeline, walmart, collected180: collected }
}

async function loadAll(admin: any) {
  const [l, p, e, i, s, ai, au] = await Promise.all([
    admin.from('cf_liabilities').select('*').order('kind').order('balance', { ascending: false }),
    admin.from('cf_payments').select('*').order('paid_on', { ascending: false }).order('created_at', { ascending: false }).limit(500),
    admin.from('cf_expenses').select('*').order('created_at'),
    admin.from('cf_income').select('*').order('expected_date', { nullsFirst: false }),
    admin.from('cf_settings').select('key,value,updated_at,updated_by'),
    admin.from('cf_ai_runs').select('*').order('created_at', { ascending: false }).limit(12),
    admin.from('cf_audit').select('*').order('at', { ascending: false }).limit(150),
  ])
  return {
    liabilities: l.data || [], payments: p.data || [], expenses: e.data || [], income: i.data || [],
    settings: Object.fromEntries(((s.data || []) as any[]).map(r => [r.key, r.value])), ai: ai.data || [], audit: au.data || [],
    erp: await erpInflows(admin),
  }
}

// ── AI ────────────────────────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const textOf = (msg: any) => (msg.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim()
const sourcesOf = (msg: any) => {
  const out: { title: string; url: string }[] = []
  for (const b of msg.content || []) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const r of b.content) if (r?.url) out.push({ title: r.title || r.url, url: r.url })
    if (b.type === 'text' && Array.isArray(b.citations)) for (const c of b.citations) if (c?.url) out.push({ title: c.title || c.url, url: c.url })
  }
  const seen = new Set<string>()
  return out.filter(s => !seen.has(s.url) && seen.add(s.url)).slice(0, 25)
}
const COMPANY = `beyondGREEN biotech, Inc. — a Santa Ana, California manufacturer of compostable / bio-based foodservice packaging (cutlery, straws, film bags, pet waste bags) made from PLA/PBAT-type biopolymers; Walmart Great Value supplier; own injection molding, blown film extrusion and straw lines; small business (minority-owned).`

export async function GET(req: NextRequest, { params }: { params: { action: string } }) {
  const a = params.action
  if (a === 'me') {
    const email = await whoAmI()
    if (!email) return json({ signedIn: false })
    const g = await gate(req, true)
    if (g.ok) return json({ signedIn: true, member: true, verified: true, email, name: g.name })
    const body = await g.res.json()
    return json({ signedIn: true, member: body.member !== false, verified: false, email })
  }
  if (a === 'data') {
    const g = await gate(req); if (!g.ok) return g.res
    return json({ ...(await loadAll(g.admin)), me: { email: g.email, name: g.name } })
  }
  return json({ error: 'Unknown action' }, 404)
}

export async function POST(req: NextRequest, { params }: { params: { action: string } }) {
  const a = params.action
  const body = await req.json().catch(() => ({} as any))

  if (a === 'send-code') {
    const g = await gate(req, false); if (!g.ok) return g.res
    const since = new Date(Date.now() - 15 * 60_000).toISOString()
    const { count } = await g.admin.from('cf_otp').select('id', { count: 'exact', head: true }).eq('email', g.email).gte('created_at', since)
    if ((count || 0) >= 5) return json({ error: 'Too many codes asked for. Wait 15 minutes and try again.' }, 429)
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    await g.admin.from('cf_otp').insert({ email: g.email, code_hash: hash(g.email + ':' + code), expires_at: new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(), ip: ipOf(req) })
    const key = process.env.RESEND_API_KEY
    if (!key) return json({ error: 'Email is not set up on the server.' }, 500)
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${process.env.FROM_NAME || 'beyondGREEN ERP'} <${process.env.FROM_EMAIL || 'erp@beyondgreenbiotech.com'}>`, to: [g.email],
        subject: `${code} is your Cash Flow board code`,
        html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1F2937"><p>Your code for the private Cash Flow &amp; Liabilities board:</p><p style="font-size:30px;font-weight:700;letter-spacing:6px;color:#127a4a">${code}</p><p>It works for ${CODE_MINUTES} minutes. If you did not ask for it, please tell Rudy right away.</p></div>`,
        text: `Your Cash Flow board code: ${code} (valid ${CODE_MINUTES} minutes). If you did not ask for it, tell Rudy.`,
      }),
    })
    if (!r.ok) return json({ error: 'Could not send the email: ' + (await r.text()).slice(0, 200) }, 502)
    await audit(g.admin, g.email, 'code_sent', { ip: ipOf(req) })
    return json({ ok: true, to: g.email.replace(/^(.{2}).*(@.*)$/, '$1•••$2') })
  }

  if (a === 'verify') {
    const g = await gate(req, false); if (!g.ok) return g.res
    const code = String(body.code || '').replace(/\D/g, '')
    if (code.length !== 6) return json({ error: 'Enter the 6-digit code.' }, 400)
    const pw = String(body.password || '')
    if (!pw) return json({ error: 'Enter the board password.' }, 400)
    const { data: o } = await g.admin.from('cf_otp').select('*').eq('email', g.email).is('used_at', null)
      .gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!o) return json({ error: 'That code expired. Ask for a new one.' }, 400)
    if (o.attempts >= 5) return json({ error: 'Too many wrong tries. Ask for a new code.' }, 400)
    const ok = (() => { const x = Buffer.from(hash(g.email + ':' + code)), y = Buffer.from(o.code_hash); return x.length === y.length && timingSafeEqual(x, y) })()
    if (!ok) {
      await g.admin.from('cf_otp').update({ attempts: o.attempts + 1 }).eq('id', o.id)
      await audit(g.admin, g.email, 'code_wrong', { ip: ipOf(req) })
      return json({ error: `Wrong code. ${4 - o.attempts} tries left.` }, 400)
    }
    const { data: sec } = await g.admin.from('cf_secret').select('salt,hash').eq('key', 'board_password').maybeSingle()
    const pwOk = !!sec && (() => { const x = scryptSync(pw, sec.salt, 64), y = Buffer.from(sec.hash, 'hex'); return x.length === y.length && timingSafeEqual(x, y) })()
    if (!pwOk) {
      await g.admin.from('cf_otp').update({ attempts: o.attempts + 1 }).eq('id', o.id)
      await audit(g.admin, g.email, 'password_wrong', { ip: ipOf(req) })
      return json({ error: `Wrong board password. ${4 - o.attempts} tries left on this code.` }, 400)
    }
    await g.admin.from('cf_otp').update({ used_at: new Date().toISOString() }).eq('id', o.id)
    const tok = randomBytes(32).toString('hex')
    await g.admin.from('cf_sessions').insert({ token_hash: hash(tok), email: g.email, expires_at: new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString(), ip: ipOf(req), ua: (req.headers.get('user-agent') || '').slice(0, 200) })
    await audit(g.admin, g.email, 'signed_in', { ip: ipOf(req) })
    const res = json({ ok: true })
    res.cookies.set(COOKIE, tok, { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: SESSION_HOURS * 3600 })
    return res
  }

  if (a === 'lock') {
    const tok = req.cookies.get(COOKIE)?.value
    const admin = createSupabaseAdminClient()
    if (tok) await admin.from('cf_sessions').update({ revoked_at: new Date().toISOString() }).eq('token_hash', hash(tok))
    const res = json({ ok: true }); res.cookies.set(COOKIE, '', { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 0 })
    return res
  }

  const g = await gate(req); if (!g.ok) return g.res
  const { admin, email } = g

  if (a === 'save') {
    const t = TABLES[body.type]
    if (!t) return json({ error: 'Unknown type' }, 400)
    const row: any = clean(t.fields, body.row)
    if (body.type === 'liability') { row.updated_at = new Date().toISOString(); row.updated_by = email }
    else row.updated_by = email
    const q = body.row?.id ? admin.from(t.table).update(row).eq('id', body.row.id).select().single() : admin.from(t.table).insert(row).select().single()
    const { data, error } = await q
    if (error) return json({ error: error.message }, 400)
    await audit(admin, email, body.row?.id ? `edit_${body.type}` : `add_${body.type}`, { id: data.id, name: data.name, changes: row })
    return json({ ok: true, row: data })
  }
  if (a === 'delete') {
    const t = TABLES[body.type]
    if (!t || !body.id) return json({ error: 'Unknown type' }, 400)
    const { data: old } = await admin.from(t.table).select('*').eq('id', body.id).maybeSingle()
    const { error } = await admin.from(t.table).delete().eq('id', body.id)
    if (error) return json({ error: error.message }, 400)
    await audit(admin, email, `delete_${body.type}`, { row: old })
    return json({ ok: true })
  }
  if (a === 'settings') {
    const rows = Object.entries(body.values || {}).filter(([k]) => SETTINGS.includes(k)).map(([key, value]) => ({ key, value, updated_at: new Date().toISOString(), updated_by: email }))
    if (!rows.length) return json({ error: 'Nothing to save' }, 400)
    const { error } = await admin.from('cf_settings').upsert(rows)
    if (error) return json({ error: error.message }, 400)
    await audit(admin, email, 'settings', Object.fromEntries(rows.map(r => [r.key, r.value])))
    return json({ ok: true })
  }
  if (a === 'payment') {
    const amt = Number(body.amount)
    if (!body.liability_id || !(amt > 0)) return json({ error: 'Pick the liability and enter an amount.' }, 400)
    const { data: l } = await admin.from('cf_liabilities').select('id,name,balance').eq('id', body.liability_id).maybeSingle()
    if (!l) return json({ error: 'Liability not found' }, 404)
    const { data: p, error } = await admin.from('cf_payments').insert({ liability_id: l.id, amount: amt, paid_on: body.paid_on || new Date().toISOString().slice(0, 10), method: body.method || null, note: body.note || null, entered_by: email }).select().single()
    if (error) return json({ error: error.message }, 400)
    const nb = Math.round((Number(l.balance) - amt) * 100) / 100
    await admin.from('cf_liabilities').update({ balance: nb, status: nb <= 0.005 ? 'paid' : 'open', updated_at: new Date().toISOString(), updated_by: email }).eq('id', l.id)
    await audit(admin, email, 'payment', { liability: l.name, amount: amt, new_balance: nb })
    return json({ ok: true, payment: p, balance: nb })
  }
  if (a === 'void-payment') {
    const { data: p } = await admin.from('cf_payments').select('*').eq('id', body.id).is('voided_at', null).maybeSingle()
    if (!p) return json({ error: 'Payment not found' }, 404)
    const { data: l } = await admin.from('cf_liabilities').select('id,name,balance').eq('id', p.liability_id).maybeSingle()
    await admin.from('cf_payments').update({ voided_at: new Date().toISOString(), note: `${p.note ? p.note + ' · ' : ''}Voided by ${email}: ${body.reason || ''}` }).eq('id', p.id)
    if (l) await admin.from('cf_liabilities').update({ balance: Number(l.balance) + Number(p.amount), status: 'open', updated_at: new Date().toISOString(), updated_by: email }).eq('id', l.id)
    await audit(admin, email, 'payment_void', { liability: l?.name, amount: p.amount, reason: body.reason })
    return json({ ok: true })
  }

  if (a === 'ai') {
    const kind = body.kind === 'funding' ? 'funding' : 'plan'
    try {
      if (kind === 'plan') {
        const snap = body.snapshot || {}
        const msg = await anthropic.messages.create({
          model: 'claude-sonnet-4-6', max_tokens: 3500,
          messages: [{ role: 'user', content: `You are the CFO advisor for ${COMPANY}
Goal: become self-sustaining, grow revenue, and pay down liabilities on a steady schedule without starving operations or breaking supplier relationships needed to keep producing.

Here is the live snapshot from the company's ERP cash board (all amounts USD). It includes cash on hand, the minimum cash reserve, fixed monthly expenses, expected inflows (open receivables, open orders not yet invoiced, Walmart orders, other expected income), every liability with balance / aging / APR / minimum payment / negotiated settlement amount / critical flag / notes, recent payments, the weekly payoff budget, the quarterly paydown goal, and the 13-week forecast and payoff schedule the board computed:
${JSON.stringify(snap).slice(0, 60000)}
${body.question ? `\nThe team also asks: ${body.question}\n` : ''}
Write a practical plan in plain US English (no em dashes). Use these sections with short markdown headings:
1. Where we stand (3-5 bullets: total liabilities, AP over 90 days, free cash flow per week/month, runway, biggest risks).
2. This week's payments (a specific list: who, how much, why; stay inside the cash that is actually free after the reserve and fixed expenses).
3. Next 90 days (weekly payoff amount, which balances get cleared and when, whether the quarterly goal is realistic and what amount is).
4. Negotiation moves (which vendors to offer a settlement or payment plan, suggested offer amounts/terms, using the aging and any negotiated amounts; protect critical suppliers like resin/packaging needed for production).
5. Cash acceleration (collect receivables faster, which invoices/customers to chase, pricing, inventory, deposits on new orders).
6. Growth vs paydown balance (how much of each week's free cash should go to growth vs debt, and why).
7. Watch list (anything in the data that looks wrong or missing, e.g. loans with no rate or terms, negative balances).
Be specific with numbers from the data. Do not invent data; say when something is missing. This is guidance, not legal or tax advice.` }],
        })
        const content = textOf(msg)
        const { data } = await admin.from('cf_ai_runs').insert({ kind, content, created_by: email }).select().single()
        await audit(admin, email, 'ai_plan', null)
        return json({ ok: true, run: data })
      }
      const msg = await anthropic.messages.create({
        model: 'claude-sonnet-4-6', max_tokens: 4000,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 } as any],
        messages: [{ role: 'user', content: `Search the web for CURRENT funding opportunities (open now or opening in the next 6 months, as of ${new Date().toISOString().slice(0, 10)}) that ${COMPANY} could realistically apply for. Cover: federal grants (USDA BioPreferred / Biorefinery / REAP / VAPG, DOE, EPA, NSF/SBIR-STTR, EDA), California state programs (CalRecycle grants and loans incl. Recycling Market Development Zone loans, CEC, GO-Biz CalCompetes, IBank small business loans, CDFA), Orange County / Santa Ana programs, SBA loans (7(a), 504, Express, Community Advantage), CDFIs and revenue-based or inventory/PO financing suited to a Walmart supplier, minority-owned business programs, and corporate or foundation sustainability grants. For each item give: name, who offers it, type (grant / loan / tax credit / financing), typical amount, deadline or status, fit for beyondGREEN (high/medium/low and why), and the link. Put the best 5 first under "Apply first". Only list programs you actually find on current pages; if a deadline is unclear, say so. Plain US English, no em dashes, markdown with short headings and bullet lists.${body.question ? `\nAlso consider: ${body.question}` : ''}` }],
      })
      const content = textOf(msg)
      const sources = sourcesOf(msg)
      const { data } = await admin.from('cf_ai_runs').insert({ kind, content, sources, created_by: email }).select().single()
      await audit(admin, email, 'ai_funding', null)
      return json({ ok: true, run: data })
    } catch (e) {
      return json({ error: aiErrorMessage(e, 'The AI advisor could not run.') }, 500)
    }
  }
  return json({ error: 'Unknown action' }, 404)
}
