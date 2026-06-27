'use client'

import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import UserAvatar from '@/components/UserAvatar'
import RichTextEditor from './RichTextEditor'

interface Comment {
  id: string
  record_type: string
  record_id: string
  author_email: string
  content: string
  is_edited: boolean
  created_at: string
  updated_at: string
}

interface Profile {
  email: string
  full_name: string
  avatar_color: string
  avatar_initials: string | null
}

interface Props {
  recordType: string
  recordId: string | undefined
  currentUserEmail: string
}

function fmtTime(ts: string) {
  const d = new Date(ts)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function CommentSection({ recordType, recordId, currentUserEmail }: Props) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [comments, setComments] = useState<Comment[]>([])
  const [profiles, setProfiles] = useState<Record<string, Profile>>({})
  const [newContent, setNewContent] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [posting, setPosting] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  async function loadComments() {
    if (!recordId) return
    const { data } = await sb
      .from('comments')
      .select('*')
      .eq('record_type', recordType)
      .eq('record_id', recordId)
      .order('created_at', { ascending: true })
    if (data) setComments(data as Comment[])
  }

  async function loadProfiles() {
    const { data } = await sb
      .from('user_profiles')
      .select('email,full_name,avatar_color,avatar_initials')
    if (data) {
      const map: Record<string, Profile> = {}
      for (const p of data as Profile[]) map[p.email] = p
      setProfiles(map)
    }
  }

  useEffect(() => {
    if (!recordId) return
    loadComments()
    loadProfiles()

    const channel = sb
      .channel(`comments_${recordType}_${recordId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter: `record_id=eq.${recordId}` }, () => {
        loadComments()
      })
      .subscribe()

    return () => { sb.removeChannel(channel) }
  }, [recordId, recordType]) // eslint-disable-line

  async function postComment() {
    if (!newContent.trim() || newContent === '<p></p>' || !recordId) return
    setPosting(true)
    await sb.from('comments').insert({
      record_type: recordType,
      record_id: recordId,
      author_email: currentUserEmail,
      content: newContent,
    })
    setNewContent('')
    setPosting(false)
    loadComments()
  }

  async function saveEdit() {
    if (!editId || !editContent.trim() || editContent === '<p></p>') return
    await sb.from('comments').update({
      content: editContent,
      is_edited: true,
      updated_at: new Date().toISOString(),
    }).eq('id', editId)
    setEditId(null)
    setEditContent('')
    loadComments()
  }

  async function deleteComment(id: string) {
    setDeleting(id)
    await sb.from('comments').delete().eq('id', id)
    setDeleting(null)
    loadComments()
  }

  function startEdit(c: Comment) {
    setEditId(c.id)
    setEditContent(c.content)
  }

  if (!recordId) return null

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold text-gray-500 tracking-widest uppercase">Comments</p>

      {comments.length === 0 && (
        <p className="text-xs text-gray-600 italic">No comments yet. Be the first to add one.</p>
      )}

      <div className="space-y-3">
        {comments.map((c) => {
          const profile = profiles[c.author_email]
          const isOwn = c.author_email === currentUserEmail
          const isEditing = editId === c.id

          return (
            <div key={c.id} className="flex gap-2.5">
              <UserAvatar email={c.author_email} initials={profile?.avatar_initials || c.author_email[0].toUpperCase()} color={profile?.avatar_color || '#374151'} size={28} className="mt-0.5" />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold text-[#1A1D2E]">
                    {profile?.full_name || c.author_email.split('@')[0]}
                  </span>
                  <span className="text-xs text-gray-600">{fmtTime(c.created_at)}</span>
                  {c.is_edited && <span className="text-xs text-gray-700 italic">(edited)</span>}
                </div>

                {isEditing ? (
                  <div className="space-y-2">
                    <RichTextEditor
                      content={editContent}
                      onChange={setEditContent}
                      minHeight="80px"
                      supabase={sb}
                    />
                    <div className="flex gap-2">
                      <button onClick={saveEdit} className="text-xs px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors">
                        Save
                      </button>
                      <button onClick={() => { setEditId(null); setEditContent('') }} className="text-xs px-3 py-1.5 text-gray-400 hover:text-gray-700 border border-[#E4E6EE] rounded-lg transition-colors">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-[#F5F6FA]/60 rounded-lg px-3 py-2.5 text-sm">
                    <div className="rte-view" dangerouslySetInnerHTML={{ __html: c.content }} />
                  </div>
                )}

                {isOwn && !isEditing && (
                  <div className="flex gap-2 mt-1">
                    <button onClick={() => startEdit(c)} className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
                      Edit
                    </button>
                    <button
                      onClick={() => deleteComment(c.id)}
                      disabled={deleting === c.id}
                      className="text-xs text-gray-600 hover:text-red-400 transition-colors disabled:opacity-50"
                    >
                      {deleting === c.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* New comment editor */}
      {currentUserEmail && (
        <div className="space-y-2 pt-2">
          <RichTextEditor
            content={newContent}
            onChange={setNewContent}
            placeholder="Add a comment… (paste emails, tables, images)"
            minHeight="80px"
            supabase={sb}
          />
          <div className="flex justify-end">
            <button
              onClick={postComment}
              disabled={posting || !newContent.trim() || newContent === '<p></p>'}
              className="text-xs px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg transition-colors font-medium"
            >
              {posting ? 'Posting…' : 'Post Comment'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
