import { createClient } from '@supabase/supabase-js'
import { POST as notifyMentions } from '@/app/api/notify-mentions/route'

/**
 * Posts a comment as the ERP owner (Rudy) on behalf of his Command Center, and sends the usual
 * @mention emails. Called server to server with the hub secret; nothing here is reachable without it.
 *
 * Body: { secret, content, mentions?: string[] (emails), link?: "View in ERP" URL with comment=<id>,
 *         record_type?, record_id?, parent_id? }
 * With a link that carries comment=<id>, the reply lands in that comment's thread.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request) {
  let b: any = {}
  try { b = await req.json() } catch { return Response.json({ error: 'Bad request' }, { status: 400 }) }
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: ok } = await sb.rpc('hub_ok', { p_secret: String(b.secret || '') })
  if (ok !== true) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const content = String(b.content || '').replace(/\r/g, '').trim()
  if (!content || content.length > 4000) return Response.json({ error: 'Comment text is required, up to 4000 characters.' }, { status: 400 })
  const { data: own } = await sb.from('hub_access').select('value').eq('key', 'owner_email').maybeSingle()
  const author = String(own?.value || '').toLowerCase()
  if (!author) return Response.json({ error: 'The owner is not set.' }, { status: 500 })

  let recordType = String(b.record_type || ''), recordId = String(b.record_id || ''), parentId: string | null = UUID.test(String(b.parent_id || '')) ? String(b.parent_id) : null
  if (b.link) {
    try {
      const u = new URL(String(b.link))
      const cid = u.searchParams.get('comment') || ''
      if (UUID.test(cid)) {
        const { data: c } = await sb.from('comments').select('id, record_type, record_id, parent_id').eq('id', cid).maybeSingle()
        if (c) { recordType = c.record_type; recordId = c.record_id; parentId = c.parent_id || c.id }
      }
    } catch { /* fall back to record_type and record_id */ }
  }
  if (!recordType || !UUID.test(recordId)) return Response.json({ error: 'Which ERP record? Pass a link with comment=<id>, or record_type and record_id.' }, { status: 400 })

  const { data: row, error } = await sb.from('comments').insert({ record_type: recordType, record_id: recordId, author_email: author, content, parent_id: parentId }).select('id').single()
  if (error || !row) return Response.json({ error: error?.message || 'The comment could not be saved.' }, { status: 500 })

  const { data: prof } = await sb.from('user_profiles').select('full_name').ilike('email', author).maybeSingle()
  const mentions = (Array.isArray(b.mentions) ? b.mentions : []).map((x: any) => String(x).toLowerCase().trim()).filter(Boolean).slice(0, 10)
  let notified: any = null
  try {
    const r = await notifyMentions(new Request('http://hub.local/api/notify-mentions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mentions, body: content, authorName: prof?.full_name || author.split('@')[0], authorEmail: author, recordId, recordType, commentId: row.id }),
    }))
    notified = await r.json().catch(() => null)
  } catch { /* the comment is saved either way */ }
  return Response.json({ ok: true, id: row.id, record_type: recordType, record_id: recordId, parent_id: parentId, notified })
}
