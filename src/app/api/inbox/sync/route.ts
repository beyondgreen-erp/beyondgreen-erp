import { NextRequest, NextResponse } from 'next/server'

// Uses IMAP to read Outlook/Microsoft 365 inbox
// Works with email + password directly, no OAuth required
// For accounts with MFA: user needs an App Password from account.microsoft.com/security

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json()
    if (!email || !password) {
      return NextResponse.json({ error: 'Missing credentials' }, { status: 400 })
    }

    // Dynamically import imap-simple (server-side only)
    const imaps = await import('imap-simple')

    const config = {
      imap: {
        user: email,
        password: password,
        host: 'outlook.office365.com',
        port: 993,
        tls: true,
        authTimeout: 10000,
        connTimeout: 15000,
        tlsOptions: { rejectUnauthorized: false },
      }
    }

    let connection: Awaited<ReturnType<typeof imaps.connect>>
    try {
      connection = await imaps.connect(config)
    } catch (connErr: unknown) {
      const msg = connErr instanceof Error ? connErr.message : String(connErr)
      if (msg.includes('Invalid credentials') || msg.includes('Authentication failed') || msg.includes('AUTHENTICATIONFAILED')) {
        return NextResponse.json({
          error: 'Incorrect email or password. If your account has 2-step verification (MFA) enabled, you need to use an App Password — tap the blue button below to create one on Microsoft\'s website.'
        }, { status: 401 })
      }
      if (msg.includes('WEAKTLS') || msg.includes('TLS') || msg.includes('SSL')) {
        return NextResponse.json({ error: 'Secure connection failed. Please try again.' }, { status: 401 })
      }
      return NextResponse.json({ error: 'Could not connect to mailbox: ' + msg }, { status: 401 })
    }

    await connection.openBox('INBOX')

    // Fetch last 50 messages
    const searchCriteria = ['ALL']
    const fetchOptions = {
      bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)', 'TEXT'],
      markSeen: false,
      struct: true,
    }

    const messages = await connection.search(searchCriteria, fetchOptions)
    connection.end()

    // Sort newest first and take last 50
    const sorted = messages
      .sort((a: { attributes: { date: Date } }, b: { attributes: { date: Date } }) =>
        new Date(b.attributes.date).getTime() - new Date(a.attributes.date).getTime()
      )
      .slice(0, 50)

    const parsed = sorted.map((msg: { parts: Array<{ which: string; body: Record<string, string[]> | string }>; attributes: { uid: number; date: Date; flags: string[] } }) => {
      const header = msg.parts.find((p: { which: string }) => p.which.includes('HEADER'))
      const text = msg.parts.find((p: { which: string }) => p.which === 'TEXT')
      const h = (header?.body || {}) as Record<string, string[]>

      const fromRaw = (h['from']?.[0] || '')
      const fromMatch = fromRaw.match(/^(.*?)\s*<(.+?)>$/)
      const fromName = fromMatch ? fromMatch[1].replace(/"/g, '').trim() : fromRaw
      const fromEmail = fromMatch ? fromMatch[2] : fromRaw

      const toRaw = (h['to']?.[0] || '').split(',').map((t: string) => t.trim())
      const bodyText = (typeof text?.body === 'string' ? text.body : '').substring(0, 500)
      const bodyPreview = bodyText.replace(/[\r\n\t]+/g, ' ').trim().substring(0, 200)

      return {
        id: String(msg.attributes.uid),
        conversationId: h['message-id']?.[0] || String(msg.attributes.uid),
        subject: h['subject']?.[0] || '(no subject)',
        from: { emailAddress: { name: fromName, address: fromEmail } },
        toRecipients: toRaw.map((t: string) => ({ emailAddress: { address: t } })),
        bodyPreview,
        body: { content: bodyText, contentType: 'text' },
        receivedDateTime: new Date(msg.attributes.date).toISOString(),
        isRead: msg.attributes.flags.includes('\\Seen'),
      }
    })

    return NextResponse.json({ success: true, messages: parsed })
  } catch (err) {
    console.error('[inbox/sync]', err)
    return NextResponse.json({ error: 'Failed to read inbox. Please check your credentials.' }, { status: 500 })
  }
}
