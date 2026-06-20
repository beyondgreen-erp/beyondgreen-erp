import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json()
    if (!email || !password) return NextResponse.json({ error: 'Missing credentials' }, { status: 400 })

    const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: '14d82eec-204b-4c2f-b7e8-296a70dab67e',
        scope: 'https://graph.microsoft.com/Mail.Read offline_access',
        username: email,
        password: password,
      })
    })

    if (!tokenRes.ok) {
      const err = await tokenRes.json().catch(() => ({}))
      return NextResponse.json({ error: err.error_description || 'Auth failed. Use your Microsoft 365 email and an App Password from account.microsoft.com/security' }, { status: 401 })
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