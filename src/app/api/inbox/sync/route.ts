import { NextRequest, NextResponse } from 'next/server'

// beyondgreenbiotech.com Microsoft 365 tenant
const TENANT_ID = '39779d03-9880-4483-9d9b-72ad90bfda4e'
const TOKEN_URL = 'https://login.microsoftonline.com/' + TENANT_ID + '/oauth2/v2.0/token'

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json()
    if (!email || !password) {
      return NextResponse.json({ error: 'Missing credentials' }, { status: 400 })
    }

    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: '14d82eec-204b-4c2f-b7e8-296a70dab67e',
        scope: 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.ReadWrite offline_access',
        username: email,
        password: password,
      })
    })

    if (!tokenRes.ok) {
      const err = await tokenRes.json().catch(() => ({}))
      const code = (err.error || '') as string
      const desc = (err.error_description || '') as string

      if (code === 'invalid_grant' || desc.includes('Invalid username or password')) {
        return NextResponse.json({
          error: 'Incorrect password. If MFA is enabled on your account, create an App Password from the button below and use that instead.'
        }, { status: 401 })
      }
      if (desc.includes('AADSTS50076') || desc.includes('multi-factor') || desc.includes('MFA')) {
        return NextResponse.json({
          error: 'Your account has 2-step verification. Create an App Password using the button below, then use that as your password.'
        }, { status: 401 })
      }
      if (desc.includes('AADSTS7000218') || desc.includes('public client')) {
        return NextResponse.json({
          error: 'Direct sign-in is blocked by your IT admin. Ask your Microsoft 365 admin to allow password grant flow, or use an App Password.'
        }, { status: 401 })
      }

      return NextResponse.json({
        error: (desc.split('.')[0] || 'Authentication failed') + '. Try using an App Password from the button below.'
      }, { status: 401 })
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
