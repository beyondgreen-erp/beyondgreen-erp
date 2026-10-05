import { createClient } from '@supabase/supabase-js'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://beyondgreen-erp.vercel.app'

function getSb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Notify a comment's author that someone acknowledged (liked) their comment.
// The like row itself is written client-side; this only sends the "X liked your comment" notice.
export async function POST(req: Request) {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { commentId, likerEmail, recordType, recordId, recordUrl } = await req.json()
    if (!commentId || !likerEmail) return Response.json({ ok: true, skipped: true })

    const sb = getSb()
    const { data: comment } = await sb
      .from('comments')
      .select('author_email, content, record_type, record_id')
      .eq('id', commentId)
      .maybeSingle()
    if (!comment) return Response.json({ ok: true, skipped: true })

    const authorEmail = (comment as any).author_email as string
    if (!authorEmail || authorEmail === likerEmail) return Response.json({ ok: true, selfLike: true })

    // Liker display name
    const { data: prof } = await sb.from('user_profiles').select('full_name').eq('email', likerEmail).maybeSingle()
    const likerName = (prof as any)?.full_name || String(likerEmail).split('@')[0]

    const rt = recordType || (comment as any).record_type
    const rid = recordId || (comment as any).record_id
    const pageLabel = rt ? (String(rt).charAt(0).toUpperCase() + String(rt).slice(1).replace(/_/g, ' ')) : 'ERP'
    const snippet = (comment as any).content ? String((comment as any).content).replace(/<[^>]+>/g, '').substring(0, 160) : ''
    const base = recordUrl || `${SITE_URL}/${rt || ''}`
    const contextUrl = `${base}${base.includes('?') ? '&' : '?'}comment=${commentId}`

    try {
      await sb.from('notifications').insert({
        recipient_email: authorEmail,
        sender_email: likerEmail,
        title: `${likerName} liked your comment`,
        message: snippet ? `\u{1F44D} ${snippet}` : `${likerName} liked your comment`,
        page: pageLabel,
        record_type: rt || null,
        record_id: rid || null,
        is_read: false,
        context_url: contextUrl,
      })
    } catch (e) { console.error('[comment-like] notification insert failed', e) }

    return Response.json({ ok: true })
  } catch (err) {
    console.error('[comment-like]', err)
    return Response.json({ error: 'Failed' }, { status: 500 })
  }
}
