import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { email, password, to, subject, body, replyTo } = await req.json()
    if (!email || !password || !to || !subject) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const nodemailer = await import('nodemailer')

    const transporter = nodemailer.createTransport({
      host: 'smtp.office365.com',
      port: 587,
      secure: false,
      auth: { user: email, pass: password },
      tls: { ciphers: 'SSLv3', rejectUnauthorized: false },
    })

    const mailOptions: Record<string, unknown> = {
      from: email,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      html: body || '',
    }
    if (replyTo) mailOptions.inReplyTo = replyTo

    await transporter.sendMail(mailOptions)
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    console.error('[inbox/send]', err)
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: 'Failed to send: ' + msg }, { status: 500 })
  }
}
