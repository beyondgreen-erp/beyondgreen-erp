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

const TagInput = forwardRef<TagInputHandle, Props>(function TagInput({ value, onChange, page, className }, ref) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [users, setUsers] = useState<string[]>([])
  const [showDrop, setShowDrop] = useState(false)
  const [dropIdx, setDropIdx] = useState(0)
  const [atPos, setAtPos] = useState(-1)
  const [query, setQuery] = useState('')
  const [senderEmail, setSenderEmail] = useState<string | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    sb.auth.getUser().then(({ data }) => setSenderEmail(data.user?.email ?? null))
    sb.from('user_presence').select('email').then(({ data }) => {
      if (data) setUsers(data.map((u: { email: string }) => u.email))
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

  const filtered = users.filter(u => u.toLowerCase().includes(query.toLowerCase()) && u !== senderEmail)

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
    if (e.key === 'Enter' && showDrop) { e.preventDefault(); selectUser(filtered[dropIdx]) }
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
                key={u}
                type="button"
                onMouseDown={() => selectUser(u)}
                className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 transition-colors ${i === dropIdx ? 'bg-emerald-600/20 text-emerald-300' : 'text-gray-300 hover:bg-gray-700'}`}
              >
                <div className="w-6 h-6 rounded-full bg-gray-600 flex items-center justify-center shrink-0">
                  <span className="text-xs font-semibold uppercase text-gray-300">{u[0]}</span>
                </div>
                <span className="truncate">{u}</span>
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
