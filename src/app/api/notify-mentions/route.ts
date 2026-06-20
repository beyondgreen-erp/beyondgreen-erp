import { createClient } from '@supabase/supabase-js'

const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM_EMAIL = process.env.FROM_EMAIL || 'erp@beyondgreenbiotech.com'
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://beyondgreen-erp.vercel.app'

function getSb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(req: Request) {
  try {
    const { mentions, body, authorName, authorEmail, recordId, recordType, recordUrl } = await req.json()

    if (!mentions?.length || !authorEmail) {
      return Response.json({ ok: true, skipped: true })
    }

    const sb = getSb()

    // Look up user profiles to resolve @mentions to real emails
    const { data: profiles } = await sb
      .from('user_profiles')
      .select('email, full_name')
      .not('email', 'is', null)

    if (!profiles?.length) return Response.json({ ok: true, notified: 0 })

    // Build name -> email lookup
    const nameToEmail: Record<string, string> = {}
    for (const p of profiles) {
      if (!p.email || !p.full_name) continue
      const normalized = p.full_name.toLowerCase().replace(/\s+/g, '')
      nameToEmail[normalized] = p.email
      const first = p.full_name.split(' ')[0].toLowerCase()
      if (!nameToEmail[first]) nameToEmail[first] = p.email
    }

    // Resolve mention tokens to recipient emails (skip self-mentions)
    const recipientEmails = new Set<string>()
    for (const token of mentions) {
      const normalized = token.toLowerCase().replace(/\s+/g, '')
      const recipEmail = nameToEmail[normalized]
      if (recipEmail && recipEmail !== authorEmail) {
        recipientEmails.add(recipEmail)
      }
    }

    if (recipientEmails.size === 0) return Response.json({ ok: true, notified: 0 })

    const pageLabel = recordType ? (recordType.charAt(0).toUpperCase() + recordType.slice(1).replace(/_/g, ' ')) : 'ERP'
    const contextUrl = recordUrl || `${SITE_URL}/${recordType || ''}`
    const snippet = body ? body.replace(/<[^>]+>/g, '').substring(0, 200) : ''

    let notified = 0
    for (const recipEmail of Array.from(recipientEmails)) {
      // 1. Write to notifications table (shows in bell)
      await sb.from('notifications').insert({
        recipient_email: recipEmail,
        sender_email: authorEmail,
        message: snippet,
        page: pageLabel,
        is_read: false,
        context_url: contextUrl,
      }).single()

      // 2. Send email via Resend
      if (RESEND_API_KEY) {
        const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#F7F8FA;margin:0;padding:32px 16px">
<div style="max-width:500px;margin:0 auto">
  <div style="background:#1A2035;border-radius:14px 14px 0 0;padding:24px 28px;display:flex;align-items:center;gap:12px">
    <div style="background:#3B6FE0;border-radius:8px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:13px;text-align:center">bG</div>
    <span style="color:rgba(255,255,255,0.85);font-size:14px;font-weight:600">beyondGREEN ERP</span>
  </div>
  <div style="background:white;border-radius:0 0 14px 14px;padding:32px 28px;border:1px solid #E2E8F0;border-top:none">
    <p style="font-size:16px;font-weight:700;color:#0F1C2E;margin:0 0 6px">
      ${authorName || authorEmail.split('@')[0]} mentioned you
    </p>
    <p style="font-size:13px;color:#5A6E8A;margin:0 0 20px">
      in <strong style="color:#0F1C2E">${pageLabel}</strong>
    </p>
    ${snippet ? `<div style="background:#F7F8FA;border-left:3px solid #3B6FE0;padding:12px 16px;border-radius:0 8px 8px 0;font-size:13px;color:#0F1C2E;margin-bottom:24px;line-height:1.6">${snippet}</div>` : ''}
    <a href="${contextUrl}" style="display:inline-block;background:#3B6FE0;color:white;padding:12px 24px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:700">
      View in ERP
    </a>
  </div>
  <p style="text-align:center;font-size:11px;color:#8A9FC0;margin-top:20px">beyondGREEN Biotech &middot; Internal ERP</p>
</div>
</body></html>`

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: `beyondGREEN ERP <${FROM_EMAIL}>`,
            to: [recipEmail],
            subject: `${authorName || authorEmail.split('@')[0]} mentioned you in ${pageLabel}`,
            html,
          }),
        })
      }

      notified++
    }

    return Response.json({ ok: true, notified })
  } catch (err) {
    console.error('[notify-mentions]', err)
    return Response.json({ error: 'Failed to send notifications' }, { status: 500 })
  }
}
