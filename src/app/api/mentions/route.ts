import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM_EMAIL = process.env.FROM_EMAIL || 'erp@beyondgreenbiotech.com'
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://beyondgreen-erp.vercel.app'

export async function POST(req: NextRequest) {
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { authorUserId, authorName, mentionedEmails, contextType, contextId, contextLabel, commentSnippet, url } = await req.json()
    if (!mentionedEmails?.length) return NextResponse.json({ success: true })

    await sb.from('mentions').insert(
      mentionedEmails.map((email: string) => ({
        author_user_id: authorUserId, mentioned_email: email,
        context_type: contextType, context_id: contextId, context_label: contextLabel,
        comment_snippet: commentSnippet, url: url || SITE_URL, notified: true
      }))
    )

    if (RESEND_API_KEY) {
      for (const email of mentionedEmails) {
        const html = '<div style="font-family:-apple-system,sans-serif;background:#F7F8FA;padding:32px"><div style="max-width:480px;margin:0 auto;background:white;border-radius:14px;border:1px solid #E2E8F0"><div style="background:#1A2035;padding:24px 28px;border-radius:14px 14px 0 0"><span style="background:#3B6FE0;border-radius:8px;padding:6px 10px;color:white;font-weight:800;font-size:13px">bG</span>&nbsp;<span style="color:rgba(255,255,255,0.8);font-size:14px;font-weight:600">beyondGREEN ERP</span></div><div style="padding:28px"><p style="font-size:15px;font-weight:700;color:#0F1C2E;margin:0 0 6px">You were mentioned by ' + (authorName || 'a teammate') + '</p><p style="font-size:13px;color:#5A6E8A;margin:0 0 16px">in <strong>' + (contextLabel || contextType || 'a comment') + '</strong></p>' + (commentSnippet ? '<div style="background:#F7F8FA;border-left:3px solid #3B6FE0;padding:12px 14px;border-radius:0 8px 8px 0;font-size:13px;color:#0F1C2E;margin-bottom:20px">' + commentSnippet + '</div>' : '') + '<a href="' + (url || SITE_URL) + '" style="display:inline-block;background:#3B6FE0;color:white;padding:11px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">View in ERP →</a></div><div style="background:#F7F8FA;padding:16px 28px;font-size:11px;color:#8A9FC0;border-radius:0 0 14px 14px">beyondGREEN Biotech · Internal ERP · Do not reply</div></div></div>'
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'beyondGREEN ERP <' + FROM_EMAIL + '>',
            to: [email],
            subject: (authorName || 'Someone') + ' mentioned you in ' + (contextLabel || contextType || 'a comment'),
            html
          })
        })
      }
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[mentions]', err)
    return NextResponse.json({ error: 'Failed to send mention' }, { status: 500 })
  }
}