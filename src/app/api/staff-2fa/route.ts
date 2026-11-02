/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Two-step sign-in for ERP staff.
 *
 * A code is emailed once per device. After it is entered, the device is remembered for 180 days
 * (httpOnly cookie bg_dev, stored hashed in staff_devices). Every new sign-in on a remembered device is
 * verified silently, so nobody gets logged out or asked again.
 *
 * Verification is recorded per Supabase session (staff_verified_sessions). The database checks it on
 * every API request (erp_pre_request) and in row security (erp_can_read_now / erp_can_write_now),
 * so a stolen password alone cannot read or change data.
 * Kill switch: erp_settings.staff_2fa = "off".
 */
import { NextRequest, NextResponse } from 'next/server'
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto'
import { createSupabaseServerClient } from '@/lib/supabase'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

const DEVICE_COOKIE = 'bg_dev'
const SV_COOKIE = 'bg_sv'
const DEVICE_DAYS = 180
const CODE_MINUTES = 10
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY || 'bg'
const hash = (s: string) => createHash('sha256').update(key().slice(-24) + ':' + s).digest('hex')
const svSig = (sid: string) => createHmac('sha256', key()).update('sv:' + sid).digest('hex')
const json = (d: any, status = 200) => NextResponse.json(d, { status })
const ipOf = (req: NextRequest) => (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null
const cookieOpts = (days: number) => ({ httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge: days * 86400 })

function sessionIdOf(accessToken?: string | null): string | null {
  try {
    const p = JSON.parse(Buffer.from((accessToken || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    return typeof p.session_id === 'string' ? p.session_id : null
  } catch { return null }
}

async function who() {
  const sb = await createSupabaseServerClient()
  const { data: u } = await sb.auth.getUser()
  if (!u.user) return null
  const { data: s } = await sb.auth.getSession()
  const sid = sessionIdOf(s.session?.access_token)
  return { id: u.user.id, email: (u.user.email || '').toLowerCase(), sid }
}

async function twoStepOn(admin: any) {
  const { data } = await admin.from('erp_settings').select('value').eq('key', 'staff_2fa').maybeSingle()
  return String(data?.value ?? 'on').replace(/"/g, '').trim() !== 'off'
}

async function markVerified(admin: any, u: { id: string; email: string; sid: string }, method: string, deviceId: string | null) {
  await admin.from('staff_verified_sessions').upsert({ session_id: u.sid, user_id: u.id, email: u.email, device_id: deviceId, method, verified_at: new Date().toISOString(), revoked_at: null })
}

function okResponse(sid: string, extra: any = {}) {
  const res = json({ ok: true, verified: true, ...extra })
  res.cookies.set(SV_COOKIE, `${sid}.${svSig(sid)}`, cookieOpts(DEVICE_DAYS))
  return res
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  const a = String(body.action || '')
  const u = await who()
  if (!u) return json({ error: 'Sign in first.' }, 401)
  if (!u.sid) return json({ error: 'Your sign-in is missing a session. Sign out and back in.' }, 400)
  const admin = createSupabaseAdminClient()
  const sess = { id: u.id, email: u.email, sid: u.sid }

  // Already verified this session, 2-step is off, or this device is remembered -> pass without a code.
  if (a === 'status') {
    if (!(await twoStepOn(admin))) { await markVerified(admin, sess, 'off', null); return okResponse(u.sid) }
    // Accounts with no real mailbox (made through the ERP / Resend) can never receive the code.
    const { data: prof } = await admin.from('user_profiles').select('skip_2fa').ilike('email', u.email).maybeSingle()
    if (prof?.skip_2fa) { await markVerified(admin, sess, 'no_mailbox', null); return okResponse(u.sid) }
    const { data: v } = await admin.from('staff_verified_sessions').select('session_id').eq('session_id', u.sid).is('revoked_at', null).maybeSingle()
    if (v) return okResponse(u.sid)
    const dev = req.cookies.get(DEVICE_COOKIE)?.value
    if (dev) {
      const { data: d } = await admin.from('staff_devices').select('id,user_id,revoked_at').eq('token_hash', hash(dev)).maybeSingle()
      if (d && !d.revoked_at && d.user_id === u.id) {
        await admin.from('staff_devices').update({ last_seen_at: new Date().toISOString() }).eq('id', d.id)
        await markVerified(admin, sess, 'device', d.id)
        return okResponse(u.sid)
      }
    }
    return json({ ok: true, verified: false, email: u.email.replace(/^(.{2}).*(@.*)$/, '$1•••$2') })
  }

  if (a === 'send-code') {
    const since = new Date(Date.now() - 15 * 60_000).toISOString()
    const { count } = await admin.from('staff_2fa_codes').select('id', { count: 'exact', head: true }).eq('user_id', u.id).gte('created_at', since)
    if ((count || 0) >= 5) return json({ error: 'Too many codes asked for. Wait 15 minutes and try again.' }, 429)
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    await admin.from('staff_2fa_codes').insert({ user_id: u.id, email: u.email, code_hash: hash(u.id + ':' + code), expires_at: new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(), ip: ipOf(req) })
    const rk = process.env.RESEND_API_KEY
    if (!rk) return json({ error: 'Email is not set up on the server.' }, 500)
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${rk}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${process.env.FROM_NAME || 'beyondGREEN ERP'} <${process.env.FROM_EMAIL || 'erp@beyondgreenbiotech.com'}>`, to: [u.email],
        subject: `${code} is your beyondGREEN ERP sign-in code`,
        html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1F2937"><p>Your code to confirm this device for the beyondGREEN ERP:</p><p style="font-size:30px;font-weight:700;letter-spacing:6px;color:#127a4a">${code}</p><p>It works for ${CODE_MINUTES} minutes. You only need it once on each device. If you did not try to sign in, please tell Rudy right away.</p></div>`,
        text: `Your beyondGREEN ERP code: ${code} (valid ${CODE_MINUTES} minutes). If you did not try to sign in, tell Rudy.`,
      }),
    })
    if (!r.ok) return json({ error: 'Could not send the email: ' + (await r.text()).slice(0, 200) }, 502)
    return json({ ok: true, to: u.email.replace(/^(.{2}).*(@.*)$/, '$1•••$2') })
  }

  if (a === 'verify') {
    const code = String(body.code || '').replace(/\D/g, '')
    if (code.length !== 6) return json({ error: 'Enter the 6-digit code.' }, 400)
    const { data: o } = await admin.from('staff_2fa_codes').select('*').eq('user_id', u.id).is('used_at', null)
      .gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!o) return json({ error: 'That code expired. Ask for a new one.' }, 400)
    if (o.attempts >= 5) return json({ error: 'Too many wrong tries. Ask for a new code.' }, 400)
    const x = Buffer.from(hash(u.id + ':' + code)), y = Buffer.from(o.code_hash)
    if (!(x.length === y.length && timingSafeEqual(x, y))) {
      await admin.from('staff_2fa_codes').update({ attempts: o.attempts + 1 }).eq('id', o.id)
      return json({ error: `Wrong code. ${4 - o.attempts} tries left.` }, 400)
    }
    await admin.from('staff_2fa_codes').update({ used_at: new Date().toISOString() }).eq('id', o.id)
    const token = randomBytes(32).toString('base64url')
    const label = (req.headers.get('user-agent') || '').slice(0, 160)
    const { data: d } = await admin.from('staff_devices').insert({ user_id: u.id, email: u.email, token_hash: hash(token), label, last_seen_at: new Date().toISOString() }).select('id').single()
    await markVerified(admin, sess, 'code', d?.id ?? null)
    const res = okResponse(u.sid)
    res.cookies.set(DEVICE_COOKIE, token, cookieOpts(DEVICE_DAYS))
    return res
  }

  // Sign this device out of "remembered" (used by Settings later; also handy for a lost phone).
  if (a === 'forget-device') {
    const dev = req.cookies.get(DEVICE_COOKIE)?.value
    if (dev) await admin.from('staff_devices').update({ revoked_at: new Date().toISOString() }).eq('token_hash', hash(dev)).eq('user_id', u.id)
    const res = json({ ok: true })
    res.cookies.set(DEVICE_COOKIE, '', { ...cookieOpts(0), maxAge: 0 })
    res.cookies.set(SV_COOKIE, '', { ...cookieOpts(0), maxAge: 0 })
    return res
  }

  return json({ error: 'Unknown action' }, 404)
}
