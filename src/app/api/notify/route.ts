import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'

const resend = new Resend(process.env.RESEND_API_KEY)
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(req: Request) {
  try {
    const { recipientEmail, senderEmail, message, page, recordType } = await req.json()
    if (!recipientEmail || !senderEmail) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 })
    }

    await sb.from('notifications').insert({
      recipient_email: recipientEmail,
      sender_email: senderEmail,
      message,
      page,
      record_type: recordType,
      is_read: false,
    })

    await resend.emails.send({
      from: 'beyondGREEN ERP <onboarding@resend.dev>',
      to: recipientEmail,
      subject: `You were tagged in ${page} by ${senderEmail}`,
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:520px;margin:40px auto;background:#111;border:1px solid #222;border-radius:16px;overflow:hidden">
    <div style="background:#10b981;padding:28px 32px">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:36px;height:36px;background:rgba(255,255,255,0.2);border-radius:8px;display:flex;align-items:center;justify-content:center">
          <span style="color:#fff;font-weight:700;font-size:14px">bG</span>
        </div>
        <div>
          <p style="margin:0;color:#fff;font-weight:700;font-size:18px">beyondGREEN ERP</p>
          <p style="margin:0;color:rgba(255,255,255,0.7);font-size:12px">Enterprise Resource Platform</p>
        </div>
      </div>
    </div>
    <div style="padding:32px">
      <p style="color:#9ca3af;font-size:13px;margin:0 0 8px">You have a new mention</p>
      <h2 style="color:#fff;font-size:20px;margin:0 0 20px">You were tagged in <span style="color:#10b981">${page}</span></h2>
      <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:16px;margin-bottom:24px">
        <p style="color:#6b7280;font-size:12px;margin:0 0 6px">From <strong style="color:#9ca3af">${senderEmail}</strong> in ${recordType || page}</p>
        <p style="color:#e5e7eb;font-size:15px;margin:0;line-height:1.6">${message}</p>
      </div>
      <a href="${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace('.supabase.co', '') || 'http://localhost:3000'}"
         style="display:inline-block;background:#10b981;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px">
        View in ERP
      </a>
    </div>
    <div style="padding:20px 32px;border-top:1px solid #1f1f1f">
      <p style="color:#4b5563;font-size:12px;margin:0">beyondGREEN ERP &copy; ${new Date().getFullYear()}</p>
    </div>
  </div>
</body>
</html>`,
    })

    return Response.json({ ok: true })
  } catch (err) {
    console.error('notify error', err)
    return Response.json({ error: 'Failed to send notification' }, { status: 500 })
  }
}
