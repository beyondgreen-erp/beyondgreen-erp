import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)
const RESEND_API_KEY = process.env.RESEND_API_KEY
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://beyondgreen-erp.vercel.app'
const FROM_EMAIL = process.env.FROM_EMAIL || 'erp@beyondgreenbiotech.com'

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()
    if (!email || !email.includes('@')) return NextResponse.json({ error: 'Valid email required' }, { status: 400 })

    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: email.toLowerCase().trim(),
      options: { redirectTo: `${SITE_URL}/auth/update-password` },
    })

    if (error) { console.error('[reset-password]', error.message); return NextResponse.json({ success: true }) }

    const resetLink = data?.properties?.action_link
    if (!resetLink || !RESEND_API_KEY) return NextResponse.json({ success: true })

    const html = `<div style="font-family:-apple-system,sans-serif;background:#F7F8FA;padding:40px 20px"><div style="max-width:520px;margin:0 auto"><div style="background:#1A2035;border-radius:16px 16px 0 0;padding:28px"><div style="display:flex;align-items:center;gap:12px"><div style="background:#3B6FE0;border-radius:10px;width:40px;height:40px;display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:14px">bG</div><div style="color:rgba(255,255,255,0.9);font-size:15px;font-weight:600">beyondGREEN ERP</div></div></div><div style="background:white;border-radius:0 0 16px 16px;padding:32px"><h2 style="font-size:22px;font-weight:800;color:#0F1C2E;margin:0 0 12px">Reset your password</h2><p style="color:#5A6E8A;font-size:14px;line-height:1.6;margin:0 0 24px">We received a request to reset the password for <strong>${email}</strong>. Click below to set a new password. Link expires in 1 hour.</p><a href="${resetLink}" style="display:inline-block;background:#3B6FE0;color:white;font-size:14px;font-weight:700;padding:12px 28px;border-radius:10px;text-decoration:none">Reset my password →</a><p style="color:#8A9FC0;font-size:12px;margin:24px 0 0;line-height:1.6">If you did not request this, you can safely ignore this email.</p></div></div></div>`

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `beyondGREEN ERP <${FROM_EMAIL}>`, to: [email], subject: 'Reset your beyondGREEN ERP password', html }),
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[reset-password]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
