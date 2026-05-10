'use client'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Props {
  value: string
  onChange: (val: string) => void
  page: string
  className?: string
}

export interface TagInputHandle {
  sendNotifications: () => Promise<void>
}

interface TeamUser { email: string; full_name: string; department: string | null; avatar_color: string; avatar_initials: string | null }

const TagInput = forwardRef<TagInputHandle, Props>(function TagInput({ value, onChange, page, className }, ref) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [users, setUsers] = useState<TeamUser[]>([])
  const [showDrop, setShowDrop] = useState(false)
  const [dropIdx, setDropIdx] = useState(0)
  const [atPos, setAtPos] = useState(-1)
  const [query, setQuery] = useState('')
  const [senderEmail, setSenderEmail] = useState<string | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    sb.auth.getUser().then(({ data }) => setSenderEmail(data.user?.email ?? null))
    sb.from('user_profiles').select('email,full_name,department,avatar_color,avatar_initials').eq('is_active', true).then(({ data }) => {
      if (data) setUsers(data as TeamUser[])
    })
  }, []) // eslint-disable-line

  useImperativeHandle(ref, () => ({
    async sendNotifications() {
      if (!senderEmail || !value) return
      const raw = Array.from(value.matchAll(/@([\w.@+-]+)/g)).map(m => m[1]).filter(e => e.includes('@') && e !== senderEmail)
      const mentions = Array.from(new Set(raw))
      for (const recipient of mentions) {
        await fetch('/api/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipientEmail: recipient, senderEmail, message: value, page, recordType: page }),
        }).catch(() => {})
      }
    },
  }))

  const filtered = users.filter(u => (u.full_name.toLowerCase().includes(query.toLowerCase()) || u.email.toLowerCase().includes(query.toLowerCase())) && u.email !== senderEmail)

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value
    onChange(v)
    const pos = e.target.selectionStart ?? 0
    const textBefore = v.slice(0, pos)
    const atMatch = textBefore.match(/@([\w.]*)$/)
    if (atMatch) {
      setAtPos(pos - atMatch[0].length)
      setQuery(atMatch[1])
      setShowDrop(true)
      setDropIdx(0)
    } else {
      setShowDrop(false)
      setAtPos(-1)
      setQuery('')
    }
  }

  function selectUser(email: string) {
    if (atPos < 0) return
    const before = value.slice(0, atPos)
    const afterAt = value.slice(atPos)
    const spaceIdx = afterAt.search(/\s/)
    const after = spaceIdx >= 0 ? afterAt.slice(spaceIdx) : ''
    const next = `${before}@${email} ${after}`
    onChange(next)
    setShowDrop(false)
    setAtPos(-1)
    setQuery('')
    setTimeout(() => {
      textRef.current?.focus()
      const p = before.length + email.length + 2
      textRef.current?.setSelectionRange(p, p)
    }, 0)
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!showDrop || filtered.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setDropIdx(i => (i + 1) % filtered.length) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setDropIdx(i => (i - 1 + filtered.length) % filtered.length) }
    if (e.key === 'Enter' && showDrop) { e.preventDefault(); selectUser(filtered[dropIdx].email) }
    if (e.key === 'Escape') setShowDrop(false)
  }

  function renderHighlighted(text: string) {
    const parts = text.split(/(@[\w.@+-]+)/g)
    return parts.map((part, i) =>
      part.startsWith('@') ? <span key={i} className="text-emerald-400 font-medium">{part}</span> : part
    )
  }

  return (
    <div className="relative">
      <label className="block text-xs text-gray-400 mb-1.5">Notes &amp; Tags</label>
      <div className="relative">
        <textarea
          ref={textRef}
          rows={3}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKey}
          onBlur={() => setTimeout(() => setShowDrop(false), 150)}
          placeholder="Add a note or @tag a teammate…"
          className={className || 'w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition resize-none'}
        />
        {showDrop && filtered.length > 0 && (
          <div className="absolute z-50 left-0 bottom-full mb-1 w-64 bg-gray-800 border border-gray-700 rounded-xl shadow-xl overflow-hidden">
            {filtered.slice(0, 6).map((u, i) => (
              <button
                key={u.email}
                type="button"
                onMouseDown={() => selectUser(u.email)}
                className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2.5 transition-colors ${i === dropIdx ? 'bg-emerald-600/20 text-emerald-300' : 'text-gray-300 hover:bg-gray-700'}`}
              >
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-white text-xs font-bold"
                  style={{ backgroundColor: u.avatar_color }}
                >
                  {u.avatar_initials ?? u.full_name[0]}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{u.full_name}</p>
                  {u.department && <p className="text-xs text-gray-500 truncate">{u.department}</p>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      {value && value.includes('@') && (
        <p className="text-xs text-gray-600 mt-1">{renderHighlighted(value)}</p>
      )}
    </div>
  )
})

export default TagInput
