import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { accessToken, to, subject, body, replyToId } = await req.json()
    if (!accessToken || !to || !subject) return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })

    const toArr = (Array.isArray(to) ? to : [to]).map((email: string) => ({ emailAddress: { address: email.trim() } }))

    let url: string
    let payload: Record<string, unknown>

    if (replyToId) {
      url = 'https://graph.microsoft.com/v1.0/me/messages/' + replyToId + '/reply'
      payload = { message: { body: { contentType: 'HTML', content: body || '' } } }
    } else {
      url = 'https://graph.microsoft.com/v1.0/me/sendMail'
      payload = { message: { subject, body: { contentType: 'HTML', content: body || '' }, toRecipients: toArr }, saveToSentItems: true }
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return NextResponse.json({ error: err.error?.message || 'Failed to send' }, { status: res.status })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[inbox/send]', err)
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
  }
}