import { NextRequest, NextResponse } from 'next/server'

// Discover the tenant ID for a given email domain
async function getTenantId(email: string): Promise<string> {
  const domain = email.split('@')[1]
  try {
    const res = await fetch(
      `https://login.microsoftonline.com/${domain}/v2.0/.well-known/openid-configuration`
    )
    if (res.ok) {
      const data = await res.json()
      // issuer = https://login.microsoftonline.com/{tenant_id}/v2.0
      const tenantId = data.issuer?.split('/')[3]
      if (tenantId && tenantId !== 'common') return tenantId
    }
  } catch { /* fall through */ }
  return 'organizations' // fallback for org accounts
}

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json()
    if (!email || !password) {
      return NextResponse.json({ error: 'Missing credentials' }, { status: 400 })
    }

    // Use tenant-specific endpoint (required for org accounts like @beyondgreenbiotech.com)
    const tenantId = await getTenantId(email)

    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: '14d82eec-204b-4c2f-b7e8-296a70dab67e',
          scope: 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.ReadWrite offline_access',
          username: email,
          password: password,
        })
      }
    )

    if (!tokenRes.ok) {
      const err = await tokenRes.json().catch(() => ({}))
      const code = err.error || ''
      const desc = err.error_description || 'Authentication failed'

      // Give user-friendly messages for common errors
      if (code === 'invalid_grant' || desc.includes('Invalid username or password')) {
        return NextResponse.json({ error: 'Incorrect email or password. If you have 2-step verification enabled, use an App Password instead of your regular password.' }, { status: 401 })
      }
      if (desc.includes('AADSTS50076') || desc.includes('multi-factor')) {
        return NextResponse.json({ error: 'Your account requires 2-step verification. Please create an App Password at account.microsoft.com/security and use that instead.' }, { status: 401 })
      }
      if (code === 'invalid_client' || desc.includes('AADSTS7000218')) {
        return NextResponse.json({ error: 'This Microsoft account does not allow direct sign-in. Please contact your IT admin or try an App Password.' }, { status: 401 })
      }

      return NextResponse.json({ error: desc.split('.')[0] || 'Authentication failed' }, { status: 401 })
    }

    const { access_token } = await tokenRes.json()

    const msgsRes = await fetch(
      'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=50&$orderby=receivedDateTime desc&$select=id,subject,from,toRecipients,bodyPreview,receivedDateTime,isRead,conversationId,body',
      { headers: { 'Authorization': 'Bearer ' + access_token } }
    )

    const msgsData = await msgsRes.json()
    return NextResponse.json({ success: true, messages: msgsData.value || [], accessToken: access_token })
  } catch (err) {
    console.error('[inbox/sync]', err)
    return NextResponse.json({ error: 'Failed to sync inbox' }, { status: 500 })
  }
}
