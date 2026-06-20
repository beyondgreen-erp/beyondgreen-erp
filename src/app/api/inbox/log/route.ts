import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { userId, messageId, threadId, fromEmail, subject, bodySnippet, logType, linkedId, linkedLabel, note } = await req.json()
    if (!userId || !logType || !linkedId) return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })

    const { data, error } = await sb.from('email_logs').insert({
      user_id: userId, message_id: messageId, thread_id: threadId,
      from_email: fromEmail, subject, body_snippet: bodySnippet,
      log_type: logType, linked_id: linkedId, linked_label: linkedLabel, note
    }).select().single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, log: data })
  } catch (err) {
    console.error('[inbox/log]', err)
    return NextResponse.json({ error: 'Failed to log email' }, { status: 500 })
  }
}