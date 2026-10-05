'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import UserAvatar from '@/components/UserAvatar'
import RichTextEditor from '@/components/RichTextEditor'

interface Comment {
  id: string
  record_id: string
  record_type: string
  author_email: string
  content: string
  is_edited: boolean
  created_at: string
  updated_at: string
  parent_id?: string | null
  attachments?: { name: string; url: string }[]
}

interface TeamMember {
  email: string
  full_name: string
  avatar_color: string
  avatar_initials: string | null
}

interface Props {
  recordId: string | undefined
  recordType: string
  currentUserEmail: string
  title?: string
}

const AVATAR_COLORS = ['#3B6FE0', '#059669', '#D97706', '#DC2626', '#7C3AED', '#0891B2', '#DB2777', '#EA580C']

function avatarColor(email: string) {
  let h = 0
  for (const c of email) h = c.charCodeAt(0) + ((h << 5) - h)
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function timeAgo(iso: string): string {
  const secs = (Date.now() - new Date(iso).getTime()) / 1000
  if (secs < 60) return 'just now'
  if (secs < 3600) return Math.floor(secs / 60) + 'm ago'
  if (secs < 86400) return Math.floor(secs / 3600) + 'h ago'
  if (secs < 604800) return Math.floor(secs / 86400) + 'd ago'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * The editor writes a mention as <span data-type="mention" data-id="<email>">, so the address is
 * exact rather than guessed from a display name. Plain @handles are still read as a fallback,
 * which is what every existing comment uses. /api/notify-mentions resolves either form.
 */
function parseMentions(text: string): string[] {
  const tokens = new Set<string>()
  if (looksLikeHtml(text) && typeof document !== 'undefined') {
    const doc = new DOMParser().parseFromString(text, 'text/html')
    for (const el of Array.from(doc.querySelectorAll('[data-type="mention"]'))) {
      const id = el.getAttribute('data-id')
      if (id) tokens.add(id.toLowerCase())
    }
  }
  for (const m of htmlToPlain(text).match(/@([\w.]+)/g) ?? []) tokens.add(m.slice(1).toLowerCase())
  return Array.from(tokens)
}

/**
 * Comments used to be a plain textarea, so a paste arrived as one unbroken string and the
 * renderer below collapsed even its newlines — the "wall of text" the team reported. Comments
 * are now written with the rich editor and stored as HTML. Older comments are still plain text
 * and are left exactly as they were in the database, so both shapes have to render correctly.
 */
const looksLikeHtml = (s: string) => /<\/?[a-z][\s\S]*>/i.test(s)

/** An empty editor still serialises to markup like "<p></p>" — that must not count as a comment. */
function isBlankHtml(s: string): boolean {
  if (!s) return true
  if (!looksLikeHtml(s)) return !s.trim()
  const stripped = s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
  return !stripped && !/<(img|table|hr)\b/i.test(s)
}

function htmlToPlain(html: string): string {
  if (typeof document === 'undefined') return html.replace(/<[^>]+>/g, '')
  const d = new DOMParser().parseFromString(html, 'text/html')
  return d.body.textContent || ''
}

/**
 * Anything a person can paste ends up here, so the markup is rebuilt against an allowlist
 * rather than trusted: unknown elements are unwrapped and every attribute outside the list
 * below — including any inline event handler or javascript: URL — is dropped.
 */
const ALLOWED_TAGS = new Set(['P','BR','STRONG','B','EM','I','U','S','CODE','PRE','BLOCKQUOTE',
  'H1','H2','H3','H4','H5','H6','UL','OL','LI','A','TABLE','THEAD','TBODY','TR','TH','TD',
  'SPAN','IMG','HR','DIV'])
const DROP_ENTIRELY = new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','LINK','META','FORM','INPUT','BUTTON'])
const ALLOWED_ATTRS: Record<string, string[]> = {
  A: ['href', 'target', 'rel'],
  IMG: ['src', 'alt'],
  TD: ['colspan', 'rowspan'],
  TH: ['colspan', 'rowspan'],
  SPAN: ['class', 'data-type', 'data-id', 'data-label'],
}
function sanitizeCommentHtml(html: string): string {
  if (typeof document === 'undefined') return ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (DROP_ENTIRELY.has(child.tagName)) { child.remove(); continue }
      walk(child)
      if (!ALLOWED_TAGS.has(child.tagName)) { child.replaceWith(...Array.from(child.childNodes)); continue }
      const keep = ALLOWED_ATTRS[child.tagName] || []
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase()
        if (!keep.includes(name)) { child.removeAttribute(attr.name); continue }
        if (name === 'href' && !/^(https?:|mailto:|tel:|#|\/)/i.test(attr.value.trim())) child.removeAttribute(attr.name)
        if (name === 'src' && !/^(https?:|data:image\/)/i.test(attr.value.trim())) child.removeAttribute(attr.name)
        if (name === 'class' && attr.value !== 'mention-tag') child.removeAttribute(attr.name)
      }
      if (child.tagName === 'A') { child.setAttribute('target', '_blank'); child.setAttribute('rel', 'noopener noreferrer') }
    }
  }
  walk(doc.body)
  return doc.body.innerHTML
}

/** Highlights @handles in the legacy plain-text comments, and keeps their line breaks. */
function renderPlain(text: string) {
  const parts = text.split(/(@\w+)/g)
  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((part, i) =>
        part.startsWith('@')
          ? <span key={i} className="font-semibold rounded px-0.5" style={{ color: '#3B6FE0', background: '#EFF6FF' }}>{part}</span>
          : <span key={i}>{part}</span>
      )}
    </span>
  )
}

function renderContent(text: string) {
  if (!looksLikeHtml(text)) return renderPlain(text)
  return <div className="rte-view break-words" dangerouslySetInnerHTML={{ __html: sanitizeCommentHtml(text) }} />
}

export default function Comments({ recordId, recordType, currentUserEmail, title = 'Comments' }: Props) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [comments, setComments] = useState<Comment[]>([])
  const [likes, setLikes] = useState<Record<string, string[]>>({})
  const [replyTo, setReplyTo] = useState<Comment | null>(null)
  // Roots in their existing order, each followed by its replies oldest-first.
  const threaded = (() => {
    const roots = comments.filter(c => !c.parent_id)
    const byParent = new Map<string, Comment[]>()
    for (const c of comments) {
      if (!c.parent_id) continue
      const list = byParent.get(c.parent_id) ?? []
      list.push(c); byParent.set(c.parent_id, list)
    }
    // A reply whose parent was deleted would otherwise vanish — keep it as a root.
    const seen = new Set(roots.map(r => r.id))
    const orphans = comments.filter(c => c.parent_id && !seen.has(c.parent_id))
    const out: Comment[] = []
    for (const r of [...roots, ...orphans]) {
      out.push(r)
      for (const child of (byParent.get(r.id) ?? [])) out.push(child)
    }
    return out
  })()
  const [profiles, setProfiles] = useState<Record<string, TeamMember>>({})
  const [loading, setLoading] = useState(true)
  const [body, setBody] = useState('')
  const [posting, setPosting] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')
  // Bumped after a post so the editor remounts empty.
  const [resetKey, setResetKey] = useState(0)
  /**
   * Realtime channel name, unique to this mount.
   *
   * Two comment panels can be open on the same record at once — the Activity Log on an
   * expanded order row and the one inside that order's edit drawer. `channel(name)` hands
   * back the channel it already holds for a name, so the second panel was calling `.on()`
   * on a channel that had already subscribed. That throws, nothing catches it, and the
   * whole page goes to "Application error" rather than one panel failing quietly.
   */
  const channelKey = useRef(Math.random().toString(36).slice(2))
  const [flashId, setFlashId] = useState<string | null>(null)
  const deepLinkDone = useRef(false)

  const fetchComments = useCallback(async () => {
    if (!recordId) return
    const { data } = await sb
      .from('comments')
      .select('*')
      .eq('record_type', recordType)
      .eq('record_id', recordId)
      .order('created_at', { ascending: true })
    const rows = (data ?? []) as Comment[]
    setComments(rows)
    setLoading(false)
    const ids = rows.map(r => r.id)
    if (ids.length) {
      const { data: lk } = await sb.from('comment_likes').select('comment_id, user_email').in('comment_id', ids)
      const m: Record<string, string[]> = {}
      for (const r of ((lk ?? []) as any[])) { (m[r.comment_id] ||= []).push(r.user_email) }
      setLikes(m)
    } else setLikes({})
  }, [sb, recordId, recordType])

  async function toggleLike(c: Comment) {
    if (!currentUserEmail) return
    const mine = (likes[c.id] || []).includes(currentUserEmail)
    setLikes(prev => {
      const set = new Set(prev[c.id] || [])
      if (mine) set.delete(currentUserEmail); else set.add(currentUserEmail)
      return { ...prev, [c.id]: Array.from(set) }
    })
    if (mine) {
      await sb.from('comment_likes').delete().eq('comment_id', c.id).eq('user_email', currentUserEmail)
    } else {
      const { error } = await sb.from('comment_likes').insert({ comment_id: c.id, user_email: currentUserEmail })
      if (!error && c.author_email !== currentUserEmail) {
        fetch('/api/comment-like', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ commentId: c.id, likerEmail: currentUserEmail, recordType, recordId, recordUrl: window.location.href }),
        }).catch(() => {})
      }
    }
  }

  const loadTeam = useCallback(async () => {
    const { data } = await sb
      .from('user_profiles')
      .select('email, full_name, avatar_color, avatar_initials')
      .order('full_name')
    if (data) {
      const members = (data as TeamMember[]).filter(m => m.email && m.full_name)
      const map: Record<string, TeamMember> = {}
      for (const m of members) map[m.email] = m
      setProfiles(map)
    }
  }, [sb])

  useEffect(() => {
    if (!recordId) return
    fetchComments()
    loadTeam()

    const channel = sb
      .channel(`comments:${recordType}:${recordId}:${channelKey.current}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'comments',
        filter: `record_id=eq.${recordId}`,
      }, () => fetchComments())
      .subscribe()

    return () => { sb.removeChannel(channel) }
  }, [recordId, recordType, fetchComments, loadTeam, sb])

  // Deep-link: when opened from a mention notification (URL has ?comment=<id>), scroll to
  // and briefly highlight that exact comment once comments have loaded.
  useEffect(() => {
    if (loading || deepLinkDone.current || typeof window === 'undefined') return
    const cid = new URLSearchParams(window.location.search).get('comment')
    if (!cid || !comments.some(c => String(c.id) === cid)) return
    deepLinkDone.current = true
    setFlashId(cid)
    // One scroll is not enough. The thread sits inside a record drawer that is still
    // growing as line items, files and avatars load, so the comment moves after the
    // scroll and ends up below the fold — which is how a "go straight to the message
    // you were tagged in" link still leaves you scrolling. Re-aim until it is really
    // on screen, then stop, and give up after a couple of seconds either way.
    let tries = 0
    let timer: ReturnType<typeof setTimeout>
    const settle = () => {
      const el = document.getElementById('comment-' + cid)
      if (el) {
        const r = el.getBoundingClientRect()
        const onScreen = r.top >= 0 && r.bottom <= window.innerHeight
        if (!onScreen) el.scrollIntoView({ behavior: tries === 0 ? 'auto' : 'smooth', block: 'center' })
        else if (tries > 1) return
      }
      if (++tries < 10) timer = setTimeout(settle, 250)
    }
    settle()
    const clear = setTimeout(() => setFlashId(null), 4500)
    return () => { clearTimeout(timer); clearTimeout(clear) }
  }, [loading, comments])

  async function uploadToStorage(file: File): Promise<{ name: string; url: string } | null> {
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `comments/${recordType}/${recordId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safe}`
    const { error } = await sb.storage.from('record-board').upload(path, file)
    if (error) { alert('Upload failed: ' + error.message); return null }
    const { data } = sb.storage.from('record-board').getPublicUrl(path)
    return { name: file.name, url: data.publicUrl }
  }

  async function handlePost() {
    if ((isBlankHtml(body) && pendingFiles.length === 0) || !recordId || posting) return
    setPosting(true)
    try {
      // Resolve the author email robustly. Prefer the known-good prop (same value the rest of
      // the app writes with); only fall back to a fresh auth lookup. Never silently drop the
      // comment when the session read hiccups — that was losing user-typed comments.
      let authorEmail = (currentUserEmail || '').trim()
      if (!authorEmail) {
        const { data: { user } } = await sb.auth.getUser()
        authorEmail = user?.email || ''
      }
      if (!authorEmail) {
        alert('Could not verify your account. Please refresh the page and try again — your text has been kept.')
        return
      }

      const uploaded: { name: string; url: string }[] = []
      for (const f of pendingFiles) { const r = await uploadToStorage(f); if (r) uploaded.push(r) }

      const { data: inserted, error } = await sb.from('comments').insert({
        record_type: recordType,
        record_id: recordId,
        author_email: authorEmail,
        content: body.trim(),
        attachments: uploaded,
        parent_id: replyTo?.id ?? null,
      }).select('id').single()
      if (error) { alert('Could not post comment: ' + error.message + '\n\nYour text has been kept — please try again.'); return }

      // Notify: @mentioned users get "mentioned you", and everyone following this record's
      // thread (anyone tagged on it before, or who has commented) gets a "new comment" notice.
      {
        const mentions = parseMentions(body)
        const profile = profiles[authorEmail]
        const authorName = profile?.full_name || authorEmail.split('@')[0]
        fetch('/api/notify-mentions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mentions,
            body: body.trim(),
            authorName,
            authorEmail,
            recordId,
            recordType,
            commentId: inserted?.id,
            recordUrl: window.location.href,
          }),
        }).catch(() => {})
      }

      setBody('')
      setResetKey(k => k + 1)
      setPendingFiles([])
      setReplyTo(null)
      fetchComments()
    } finally {
      setPosting(false)
    }
  }

  function startEdit(c: Comment) {
    setEditId(c.id)
    setEditBody(c.content)
  }

  async function saveEdit() {
    if (!editId || isBlankHtml(editBody)) return
    await sb.from('comments').update({
      content: editBody.trim(),
      is_edited: true,
      updated_at: new Date().toISOString(),
    }).eq('id', editId)
    setEditId(null)
    setEditBody('')
    fetchComments()
  }

  async function deleteComment(id: string) {
    await sb.from('comments').delete().eq('id', id)
    fetchComments()
  }

  if (!recordId) return null

  const profileFor = (email: string) => profiles[email] ?? null

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#6B7280' }}>{title}</p>
        {comments.length > 0 && (
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: '#F0F2F7', color: '#6B7280' }}>
            {comments.length}
          </span>
        )}
      </div>

      {/* Comment list */}
      <div className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-4">
            <div className="w-4 h-4 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : comments.length === 0 ? (
          <p className="text-xs italic py-2" style={{ color: '#9CA3AF' }}>No comments yet.</p>
        ) : (
          threaded.map(c => {
            const p = profileFor(c.author_email)
            const displayName = p?.full_name || c.author_email.split('@')[0]
            const isOwn = c.author_email === currentUserEmail
            const isEditing = editId === c.id
            const bgColor = p?.avatar_color || avatarColor(c.author_email)
            const initials = p?.avatar_initials || avatarInitials(displayName)

            return (
              <div key={c.id} id={`comment-${c.id}`} style={c.parent_id ? { marginLeft: 30, borderLeft: '2px solid #E4E6EE', paddingLeft: 10 } : undefined} className={`flex gap-2.5 scroll-mt-24 rounded-lg transition-colors ${flashId === c.id ? 'ring-2 ring-amber-400 bg-amber-50 -mx-1 px-1 py-1' : ''}`}>
                {/* Avatar */}
                <UserAvatar email={c.author_email} initials={initials} color={p?.avatar_color || '#374151'} size={28} className="mt-0.5" />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold" style={{ color: '#1A1D2E' }}>{displayName}</span>
                    <span className="text-[10px]" style={{ color: '#9CA3AF' }}>{timeAgo(c.created_at)}</span>
                    {c.is_edited && <span className="text-[10px] italic" style={{ color: '#9CA3AF' }}>(edited)</span>}
                  </div>

                  {isEditing ? (
                    <div className="space-y-2">
                      <div className="relative">
                        <div className="rounded-lg border" style={{ borderColor: '#E4E6EE' }}>
                          <RichTextEditor
                            key={`edit-${editId}`}
                            content={editBody}
                            onChange={setEditBody}
                            placeholder="Edit your comment…"
                            minHeight="64px"
                            supabase={sb}
                          />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={saveEdit}
                          className="text-xs px-3 py-1.5 rounded-lg text-white font-medium transition-colors"
                          style={{ background: '#059669' }}
                        >
                          Save
                        </button>
                        <button
                          onClick={() => { setEditId(null); setEditBody('') }}
                          className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
                          style={{ borderColor: '#E4E6EE', color: '#6B7280' }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div
                        className="text-sm rounded-lg px-3 py-2 leading-relaxed"
                        style={{ background: '#F5F6FA', color: '#374151' }}
                      >
                        {renderContent(c.content)}
                      </div>
                      {c.attachments && c.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {c.attachments.map((a, ai) => (
                            <a key={ai} href={a.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11px] bg-white border rounded-md px-2 py-1 hover:bg-gray-50" style={{ borderColor: '#E4E6EE', color: '#374151' }}>
                              <span>📎</span><span className="truncate max-w-[200px]">{a.name}</span>
                            </a>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-3 mt-1 items-center">
                        <button
                          onClick={() => toggleLike(c)}
                          className="text-[10px] flex items-center gap-1 transition-colors hover:underline"
                          style={{ color: (likes[c.id] || []).includes(currentUserEmail) ? '#3B6FE0' : '#9CA3AF' }}
                          title={(likes[c.id] || []).includes(currentUserEmail) ? 'Remove your like' : 'Like / acknowledge this comment'}
                        >
                          {(likes[c.id] || []).includes(currentUserEmail) ? '👍 Liked' : '👍 Like'}{(likes[c.id]?.length || 0) > 0 ? ' · ' + likes[c.id].length : ''}
                        </button>
                        {!c.parent_id && (
                          <button
                            onClick={() => setReplyTo(c)}
                            className="text-[10px] transition-colors hover:underline"
                            style={{ color: '#3B6FE0' }}
                          >
                            Reply
                          </button>
                        )}
                      </div>
                      {isOwn && (
                        <div className="flex gap-3 mt-1">
                          <button
                            onClick={() => startEdit(c)}
                            className="text-[10px] transition-colors hover:underline"
                            style={{ color: '#9CA3AF' }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteComment(c.id)}
                            className="text-[10px] transition-colors hover:underline"
                            style={{ color: '#9CA3AF' }}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* New comment input */}
      {currentUserEmail && (
        <div className="relative">
          <div className="flex gap-2.5">
            {/* Current user avatar */}
            {(() => {
              const p = profileFor(currentUserEmail)
              const name = p?.full_name || currentUserEmail.split('@')[0]
              return (
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0 mt-1"
                  style={{ background: p?.avatar_color || avatarColor(currentUserEmail) }}
                >
                  {p?.avatar_initials || avatarInitials(name)}
                </div>
              )
            })()}

            <div className="flex-1 relative">
              {replyTo && (
                <div className="flex items-center gap-2 mb-1.5 text-[11px] rounded-lg px-2.5 py-1.5" style={{ background: '#EEF3FF', color: '#3B6FE0' }}>
                  <span>Replying to <strong>{(profileFor(replyTo.author_email)?.full_name) || replyTo.author_email.split('@')[0]}</strong></span>
                  <button onClick={() => setReplyTo(null)} className="ml-auto hover:underline" style={{ color: '#6B7280' }}>Cancel</button>
                </div>
              )}
              {/* The editor brings its own @mention list, so the textarea's custom one is gone. */}
              <div
                className="rounded-lg border transition-colors focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500"
                style={{ borderColor: '#E4E6EE' }}
                onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void handlePost() } }}
              >
                <RichTextEditor
                  key={`new-${replyTo?.id ?? 'root'}-${resetKey}`}
                  content={body}
                  onChange={setBody}
                  placeholder="Add a comment… paste keeps its formatting. Type @ to mention someone"
                  minHeight="64px"
                  supabase={sb}
                />
              </div>
            </div>
          </div>

          <div className="ml-9 mt-2 space-y-2">
            {pendingFiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {pendingFiles.map((f, i) => (
                  <span key={i} className="flex items-center gap-1 text-[11px] bg-blue-50 border border-blue-200 rounded-md px-2 py-1" style={{ color: '#1D4ED8' }}>
                    <span className="truncate max-w-[160px]">{f.name}</span>
                    <button onClick={() => setPendingFiles(pf => pf.filter((_, j) => j !== i))} className="text-blue-400 hover:text-blue-700 leading-none">×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={e => { const fs = Array.from(e.target.files || []); setPendingFiles(pf => [...pf, ...fs]); if (e.target) e.target.value = '' }} />
                <button onClick={() => fileInputRef.current?.click()} className="text-[11px] flex items-center gap-1 transition-colors" style={{ color: '#6B7280' }}>📎 Attach</button>
                <p className="text-[10px]" style={{ color: '#9CA3AF' }}>@ to mention · ⌘↵ to post</p>
              </div>
              <button
                onClick={handlePost}
                disabled={posting || (isBlankHtml(body) && pendingFiles.length === 0)}
                className="text-xs px-3 py-1.5 rounded-lg font-medium text-white disabled:opacity-40 transition-colors"
                style={{ background: '#3B6FE0' }}
              >
                {posting ? 'Posting…' : 'Post'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

