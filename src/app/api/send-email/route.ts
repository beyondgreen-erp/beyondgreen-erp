import { NextRequest, NextResponse } from 'next/server'

const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM_EMAIL = process.env.FROM_EMAIL || 'erp@beyondgreenbiotech.com'
const FROM_NAME = process.env.FROM_NAME || 'beyondGREEN ERP'

export async function POST(req: NextRequest) {
  try {
    if (!RESEND_API_KEY) return NextResponse.json({ error: 'Email service not configured' }, { status: 500 })
    const { to, cc, subject, html, text } = await req.json()
    if (!to || !subject || (!html && !text)) return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })

    const body: Record<string, unknown> = {
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: Array.isArray(to) ? to : [to],
      subject,
    }
    if (html) body.html = html
    if (text) body.text = text
    if (cc) body.cc = Array.isArray(cc) ? cc : [cc]

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) return NextResponse.json({ error: data.message || 'Failed to send email' }, { status: res.status })
    return NextResponse.json({ success: true, id: data.id })
  } catch (err) {
    console.error('[send-email]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
