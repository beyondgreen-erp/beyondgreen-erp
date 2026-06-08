import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

function getSb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase env vars not configured')
  return createClient(url, key)
}

export async function POST(req: Request) {
  try {
    const { mentions, body, authorName, authorEmail, recordId, recordType, recordUrl } = await req.json()

    if (!mentions?.length || !authorEmail) {
      return Response.json({ ok: true, skipped: true })
    }

    const sb = getSb()

    // Look up all user profiles to match mention tokens to real users
    const { data: profiles } = await sb
      .from('user_profiles')
      .select('email, full_name')
      .not('email', 'is', null)

    if (!profiles?.length) return Response.json({ ok: true, notified: 0 })

    // Build name→email lookup (normalized)
    const nameToEmail: Record<string, string> = {}
    for (const p of profiles) {
      if (!p.email || !p.full_name) continue
      const normalized = p.full_name.toLowerCase().replace(/\s+/g, '')
      nameToEmail[normalized] = p.email
      // Also map first name alone for single-word matches
      const first = p.full_name.split(' ')[0].toLowerCase()
      if (!nameToEmail[first]) nameToEmail[first] = p.email
    }

    // Resolve mention tokens to emails (skip self-mentions)
    const recipientEmails = new Set<string>()
    for (const token of mentions) {
      const normalized = token.toLowerCase().replace(/\s+/g, '')
      const email = nameToEmail[normalized]
      if (email && email !== authorEmail) {
        recipientEmails.add(email)
      }
    }

    if (recipientEmails.size === 0) return Response.json({ ok: true, notified: 0 })

    const year = new Date().getFullYear()
    const pageLabel = recordType.charAt(0).toUpperCase() + recordType.slice(1)
    const bodyEscaped = body
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // Highlight @mentions
      .replace(/@(\w+)/g, '<strong style="color:#3B6FE0">@$1</strong>')

    const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:520px;margin:40px auto;background:#fff;border:1px solid #e4e6ee;border-radius:16px;overflow:hidden">
    <div style="background:#1a1d2e;padding:24px 32px">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:32px;height:32px;background:#3B6FE0;border-radius:8px;display:flex;align-items:center;justify-content:center">
          <span style="color:#fff;font-weight:700;font-size:13px">bG</span>
        </div>
        <div>
          <p style="margin:0;color:#fff;font-weight:700;font-size:16px">beyondGREEN ERP</p>
          <p style="margin:0;color:#9ca3af;font-size:11px">Mention notification</p>
        </div>
      </div>
    </div>
    <div style="padding:32px">
      <p style="color:#6b7280;font-size:13px;margin:0 0 6px">New mention</p>
      <h2 style="color:#1a1d2e;font-size:18px;font-weight:600;margin:0 0 20px">
        <span style="color:#3B6FE0">${authorName}</span> mentioned you in a ${pageLabel} comment
      </h2>
      <div style="background:#f5f6fa;border:1px solid #e4e6ee;border-radius:12px;padding:16px;margin-bottom:24px">
        <p style="color:#9ca3af;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin:0 0 8px">${pageLabel} · ${recordId}</p>
        <p style="color:#374151;font-size:15px;margin:0;line-height:1.6">${bodyEscaped}</p>
      </div>
      ${recordUrl ? `<a href="${recordUrl}" style="display:inline-block;background:#3B6FE0;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px">View comment →</a>` : ''}
    </div>
    <div style="padding:16px 32px;border-top:1px solid #f0f2f7">
      <p style="color:#9ca3af;font-size:11px;margin:0">beyondGREEN ERP &copy; ${year} · You received this because you were @mentioned</p>
    </div>
  </div>
</body>
</html>`

    // Send notifications concurrently
    const results = await Promise.allSettled(
      Array.from(recipientEmails).map(async (recipientEmail) => {
        // Insert notification row
        await sb.from('notifications').insert({
          recipient_email: recipientEmail,
          sender_email: authorEmail,
          message: body,
          page: pageLabel,
          record_id: recordId,
          record_type: recordType,
          is_read: false,
          type: 'mention',
          title: `${authorName} mentioned you`,
          link: recordUrl ?? null,
          user_email: authorEmail,
        }).then(() => {})

        // Send email
        if (resend) {
          await resend.emails.send({
            from: 'beyondGREEN ERP <onboarding@resend.dev>',
            to: recipientEmail,
            subject: `${authorName} mentioned you in ${pageLabel}`,
            html: emailHtml,
          })
        }
      })
    )

    const succeeded = results.filter(r => r.status === 'fulfilled').length
    return Response.json({ ok: true, notified: succeeded })
  } catch (err) {
    console.error('notify-mentions error', err)
    return Response.json({ error: 'Failed to send mention notifications' }, { status: 500 })
  }
}
