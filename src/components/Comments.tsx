'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Comment {
  id: string
  record_id: string
  record_type: string
  author_email: string
  content: string
  is_edited: boolean
  created_at: string
  updated_at: string
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

function parseMentions(text: string): string[] {
  const matches = text.match(/@(\w+)/g) ?? []
  return Array.from(new Set(matches.map(m => m.slice(1).toLowerCase())))
}

function renderContent(text: string) {
  const parts = text.split(/(@\w+)/g)
  return parts.map((part, i) =>
    part.startsWith('@')
      ? <span key={i} className="font-semibold rounded px-0.5" style={{ color: '#3B6FE0', background: '#EFF6FF' }}>{part}</span>
      : <span key={i}>{part}</span>
  )
}

export default function Comments({ recordId, recordType, currentUserEmail, title = 'Comments' }: Props) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [comments, setComments] = useState<Comment[]>([])
  const [profiles, setProfiles] = useState<Record<string, TeamMember>>({})
  const [team, setTeam] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [body, setBody] = useState('')
  const [posting, setPosting] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')
  const [showMention, setShowMention] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionStart, setMentionStart] = useState(0)
  const [mentionIdx, setMentionIdx] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const editRef = useRef<HTMLTextAreaElement>(null)

  const fetchComments = useCallback(async () => {
    if (!recordId) return
    const { data } = await sb
      .from('comments')
      .select('*')
      .eq('record_type', recordType)
      .eq('record_id', recordId)
      .order('created_at', { ascending: true })
    setComments((data ?? []) as Comment[])
    setLoading(false)
  }, [sb, recordId, recordType])

  const loadTeam = useCallback(async () => {
    const { data } = await sb
      .from('user_profiles')
      .select('email, full_name, avatar_color, avatar_initials')
      .order('full_name')
    if (data) {
      const members = (data as TeamMember[]).filter(m => m.email && m.full_name)
      setTeam(members)
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
      .channel(`comments:${recordType}:${recordId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'comments',
        filter: `record_id=eq.${recordId}`,
      }, () => fetchComments())
      .subscribe()

    return () => { sb.removeChannel(channel) }
  }, [recordId, recordType, fetchComments, loadTeam, sb])

  // Filtered mention suggestions
  const mentionSuggestions = useMemo(() => {
    if (!mentionQuery && !showMention) return []
    const q = mentionQuery.toLowerCase()
    return team.filter(m =>
      m.full_name.toLowerCase().replace(/\s+/g, '').includes(q) ||
      m.full_name.toLowerCase().includes(q) ||
      m.email.toLowerCase().includes(q)
    ).slice(0, 6)
  }, [team, mentionQuery, showMention])

  function handleBodyChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    setBody(val)

    const cursor = e.target.selectionStart
    const before = val.slice(0, cursor)
    const atMatch = before.match(/@(\w*)$/)
    if (atMatch) {
      setMentionQuery(atMatch[1].toLowerCase())
      setMentionStart(cursor - atMatch[0].length)
      setMentionIdx(0)
      setShowMention(true)
    } else {
      setShowMention(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!showMention || mentionSuggestions.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx(i => Math.min(i + 1, mentionSuggestions.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(mentionSuggestions[mentionIdx]) }
    else if (e.key === 'Escape') setShowMention(false)
  }

  function insertMention(member: TeamMember, ref = textareaRef, setter = setBody) {
    const cur = ref.current
    if (!cur) return
    const currentVal = ref === textareaRef ? body : editBody
    const cursor = cur.selectionStart
    const before = currentVal.slice(0, mentionStart)
    const after = currentVal.slice(cursor)
    const tag = '@' + member.full_name.replace(/\s+/g, '') + ' '
    const newVal = before + tag + after
    setter(newVal)
    setShowMention(false)
    setTimeout(() => {
      if (cur) {
        const pos = before.length + tag.length
        cur.setSelectionRange(pos, pos)
        cur.focus()
      }
    }, 0)
  }

  function handleEditChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    setEditBody(val)
    const cursor = e.target.selectionStart
    const before = val.slice(0, cursor)
    const atMatch = before.match(/@(\w*)$/)
    if (atMatch) {
      setMentionQuery(atMatch[1].toLowerCase())
      setMentionStart(cursor - atMatch[0].length)
      setMentionIdx(0)
      setShowMention(true)
    } else {
      setShowMention(false)
    }
  }

  async function handlePost() {
    if (!body.trim() || !recordId || posting) return
    setPosting(true)
    try {
      const { data: { user } } = await sb.auth.getUser()
      if (!user) return

      const { error } = await sb.from('comments').insert({
        record_type: recordType,
        record_id: recordId,
        author_email: user.email!,
        content: body.trim(),
      })
      if (error) { alert('Error: ' + error.message); return }

      // Send @mention notifications
      const mentions = parseMentions(body)
      if (mentions.length > 0) {
        const profile = profiles[user.email!]
        const authorName = profile?.full_name || user.email!.split('@')[0]
        fetch('/api/notify-mentions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mentions,
            body: body.trim(),
            authorName,
            authorEmail: user.email,
            recordId,
            recordType,
            recordUrl: window.location.href,
          }),
        }).catch(() => {})
      }

      setBody('')
      fetchComments()
    } finally {
      setPosting(false)
    }
  }

  async function handlePostKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      await handlePost()
    }
  }

  function startEdit(c: Comment) {
    setEditId(c.id)
    setEditBody(c.content)
    setShowMention(false)
  }

  async function saveEdit() {
    if (!editId || !editBody.trim()) return
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
          comments.map(c => {
            const p = profileFor(c.author_email)
            const displayName = p?.full_name || c.author_email.split('@')[0]
            const isOwn = c.author_email === currentUserEmail
            const isEditing = editId === c.id
            const bgColor = p?.avatar_color || avatarColor(c.author_email)
            const initials = p?.avatar_initials || avatarInitials(displayName)

            return (
              <div key={c.id} className="flex gap-2.5">
                {/* Avatar */}
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0 mt-0.5"
                  style={{ background: bgColor }}
                >
                  {initials}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold" style={{ color: '#1A1D2E' }}>{displayName}</span>
                    <span className="text-[10px]" style={{ color: '#9CA3AF' }}>{timeAgo(c.created_at)}</span>
                    {c.is_edited && <span className="text-[10px] italic" style={{ color: '#9CA3AF' }}>(edited)</span>}
                  </div>

                  {isEditing ? (
                    <div className="space-y-2">
                      <div className="relative">
                        <textarea
                          ref={editRef}
                          value={editBody}
                          onChange={handleEditChange}
                          onKeyDown={e => {
                            if (!showMention || mentionSuggestions.length === 0) return
                            if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx(i => Math.min(i + 1, mentionSuggestions.length - 1)) }
                            else if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx(i => Math.max(i - 1, 0)) }
                            else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(mentionSuggestions[mentionIdx], editRef, setEditBody) }
                            else if (e.key === 'Escape') setShowMention(false)
                          }}
                          rows={3}
                          className="w-full px-3 py-2 rounded-lg border text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                          style={{ borderColor: '#E4E6EE', color: '#1A1D2E' }}
                        />
                        {showMention && editId && mentionSuggestions.length > 0 && (
                          <MentionDropdown
                            members={mentionSuggestions}
                            activeIdx={mentionIdx}
                            onSelect={m => insertMention(m, editRef, setEditBody)}
                          />
                        )}
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
                          onClick={() => { setEditId(null); setEditBody(''); setShowMention(false) }}
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
              <textarea
                ref={textareaRef}
                value={body}
                onChange={handleBodyChange}
                onKeyDown={e => {
                  handleKeyDown(e)
                  handlePostKeyDown(e)
                }}
                placeholder="Add a comment… Type @ to mention someone"
                rows={2}
                className="w-full px-3 py-2 rounded-lg border text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                style={{ borderColor: '#E4E6EE', color: '#1A1D2E' }}
              />

              {/* Mention dropdown */}
              {showMention && !editId && mentionSuggestions.length > 0 && (
                <MentionDropdown
                  members={mentionSuggestions}
                  activeIdx={mentionIdx}
                  onSelect={m => insertMention(m)}
                />
              )}
            </div>
          </div>

          <div className="flex items-center justify-between mt-2 ml-9">
            <p className="text-[10px]" style={{ color: '#9CA3AF' }}>
              Type @ to mention · ⌘↵ to post
            </p>
            <button
              onClick={handlePost}
              disabled={posting || !body.trim()}
              className="text-xs px-3 py-1.5 rounded-lg font-medium text-white disabled:opacity-40 transition-colors"
              style={{ background: '#3B6FE0' }}
            >
              {posting ? 'Posting…' : 'Post'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function MentionDropdown({
  members,
  activeIdx,
  onSelect,
}: {
  members: TeamMember[]
  activeIdx: number
  onSelect: (m: TeamMember) => void
}) {
  return (
    <div
      className="absolute left-0 bottom-full mb-1 w-64 bg-white rounded-xl border shadow-xl z-50 overflow-hidden"
      style={{ borderColor: '#E4E6EE' }}
    >
      <div className="px-2 py-1.5 border-b text-[10px] font-semibold uppercase tracking-wider" style={{ borderColor: '#F0F2F7', color: '#9CA3AF' }}>
        Mention a teammate
      </div>
      {members.map((m, i) => (
        <button
          key={m.email}
          onMouseDown={e => { e.preventDefault(); onSelect(m) }}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors"
          style={{ background: i === activeIdx ? '#F0F2F7' : 'transparent' }}
        >
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0"
            style={{ background: m.avatar_color || '#6B7280' }}
          >
            {m.avatar_initials || avatarInitials(m.full_name)}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium truncate" style={{ color: '#1A1D2E' }}>{m.full_name}</p>
            <p className="text-[10px] truncate" style={{ color: '#9CA3AF' }}>{m.email}</p>
          </div>
        </button>
      ))}
    </div>
  )
}
