'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TiptapImage from '@tiptap/extension-image'
import { Table as TiptapTable } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import TiptapLink from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import Mention from '@tiptap/extension-mention'
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Props {
  content: string
  onChange: (html: string) => void
  placeholder?: string
  readOnly?: boolean
  minHeight?: string
  supabase?: any
}

interface Profile {
  email: string
  full_name: string
  avatar_color: string
  avatar_initials: string | null
}

interface MentionState {
  items: Profile[]
  command: (item: { id: string; label: string }) => void
  rect: DOMRect | null
  selectedIndex: number
}

function MentionDropdown({ state, onSelect }: { state: MentionState; onSelect: (p: Profile, idx: number) => void }) {
  if (!state.rect || state.items.length === 0) return null
  return createPortal(
    <div
      style={{ position: 'fixed', top: state.rect.bottom + 6, left: state.rect.left, zIndex: 99999 }}
      className="bg-white border border-[#E4E6EE] rounded-xl shadow-lg py-1.5 min-w-52 overflow-hidden"
    >
      {state.items.map((p, i) => (
        <button
          key={p.email}
          onMouseDown={e => { e.preventDefault(); onSelect(p, i) }}
          className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${i === state.selectedIndex ? 'bg-[#F0F1F5]' : 'hover:bg-[#F5F6FA]'}`}
        >
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0"
            style={{ backgroundColor: p.avatar_color || '#374151' }}
          >
            {p.avatar_initials || p.email[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white font-medium truncate">{p.full_name || p.email.split('@')[0]}</p>
            <p className="text-[11px] text-[#5A5A6A] truncate">{p.email}</p>
          </div>
        </button>
      ))}
    </div>,
    document.body
  )
}

function Divider() {
  return <span className="w-px h-4 bg-[#F5F6FA] mx-1 shrink-0" />
}

function Btn({
  onClick,
  active,
  title,
  children,
  disabled,
}: {
  onClick: () => void
  active?: boolean
  title: string
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      title={title}
      disabled={disabled}
      className={`p-1.5 rounded text-xs transition-colors shrink-0 ${
        active ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-700 hover:bg-[#F5F6FA]'
      } disabled:opacity-40`}
    >
      {children}
    </button>
  )
}

export default function RichTextEditor({ content, onChange, placeholder, readOnly, minHeight = '120px', supabase }: Props) {
  const pasteRef = useRef<((src: string) => void) | null>(null)
  const profilesRef = useRef<Profile[]>([])
  const mentionStateRef = useRef<MentionState | null>(null)
  const [mentionState, setMentionState] = useState<MentionState | null>(null)

  useEffect(() => {
    mentionStateRef.current = mentionState
  }, [mentionState])

  useEffect(() => {
    if (!supabase) return
    supabase
      .from('user_profiles')
      .select('email,full_name,avatar_color,avatar_initials')
      .then(({ data }: { data: Profile[] | null }) => {
        if (data) profilesRef.current = data
      })
  }, [supabase])

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TiptapImage.configure({ allowBase64: true, inline: false }),
      TiptapTable.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      TiptapLink.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: placeholder || 'Write a comment…' }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Mention.configure({
        HTMLAttributes: { class: 'mention-tag' },
        suggestion: {
          items: ({ query }: { query: string }) =>
            profilesRef.current
              .filter(p => (p.full_name || p.email).toLowerCase().includes(query.toLowerCase()))
              .slice(0, 6),
          render: () => ({
            onStart: (props: any) => {
              const state: MentionState = {
                items: props.items,
                command: props.command,
                rect: props.clientRect?.() || null,
                selectedIndex: 0,
              }
              mentionStateRef.current = state
              setMentionState(state)
            },
            onUpdate: (props: any) => {
              const prev = mentionStateRef.current
              const state: MentionState = {
                items: props.items,
                command: props.command,
                rect: props.clientRect?.() || null,
                selectedIndex: prev?.selectedIndex ?? 0,
              }
              mentionStateRef.current = state
              setMentionState(state)
            },
            onExit: () => {
              mentionStateRef.current = null
              setMentionState(null)
            },
            onKeyDown: ({ event }: { event: KeyboardEvent }) => {
              const state = mentionStateRef.current
              if (!state || state.items.length === 0) return false

              if (event.key === 'ArrowDown') {
                const next: MentionState = { ...state, selectedIndex: (state.selectedIndex + 1) % state.items.length }
                mentionStateRef.current = next
                setMentionState(next)
                return true
              }
              if (event.key === 'ArrowUp') {
                const next: MentionState = { ...state, selectedIndex: (state.selectedIndex - 1 + state.items.length) % state.items.length }
                mentionStateRef.current = next
                setMentionState(next)
                return true
              }
              if (event.key === 'Enter' || event.key === 'Tab') {
                const item = state.items[state.selectedIndex]
                if (item) {
                  state.command({ id: item.email, label: item.full_name || item.email.split('@')[0] })
                  mentionStateRef.current = null
                  setMentionState(null)
                }
                return true
              }
              if (event.key === 'Escape') {
                mentionStateRef.current = null
                setMentionState(null)
                return true
              }
              return false
            },
          }),
        },
      }),
    ],
    content,
    editable: !readOnly,
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getHTML())
    },
    editorProps: {
      handlePaste: (view, event) => {
        const items = Array.from(event.clipboardData?.items || [])
        const imageItem = items.find((item) => item.type.startsWith('image/'))
        if (!imageItem) return false
        event.preventDefault()
        const file = imageItem.getAsFile()
        if (!file) return true
        const reader = new FileReader()
        reader.onload = () => { pasteRef.current?.(reader.result as string) }
        reader.readAsDataURL(file)
        return true
      },
    },
  })

  useEffect(() => {
    if (!editor) return
    pasteRef.current = async (base64: string) => {
      if (supabase) {
        try {
          const arr = base64.split(',')
          const mimeMatch = arr[0].match(/:(.*?);/)
          const mime = mimeMatch?.[1] || 'image/png'
          const ext = mime.split('/')[1] || 'png'
          const bstr = atob(arr[1])
          const u8 = new Uint8Array(bstr.length)
          for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i)
          const blob = new Blob([u8], { type: mime })
          const path = `editor/${Date.now()}.${ext}`
          const { data, error } = await supabase.storage.from('erp-images').upload(path, blob, { upsert: false })
          if (!error && data) {
            const { data: urlData } = supabase.storage.from('erp-images').getPublicUrl(data.path)
            editor.chain().focus().setImage({ src: urlData.publicUrl }).run()
            return
          }
        } catch {
          // fall through to base64
        }
      }
      editor.chain().focus().setImage({ src: base64 }).run()
    }
  }, [editor, supabase])

  useEffect(() => {
    if (editor && !editor.isDestroyed && content !== editor.getHTML()) {
      editor.commands.setContent(content || '')
    }
  }, [content]) // eslint-disable-line

  if (readOnly) {
    return (
      <div
        className="rte-view"
        dangerouslySetInnerHTML={{ __html: content || '<p class="text-gray-600 text-sm italic">No content</p>' }}
      />
    )
  }

  return (
    <div className="border border-[#E4E6EE] rounded-lg overflow-hidden bg-[#F5F6FA]">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 bg-white border-b border-[#E4E6EE]">
        <Btn onClick={() => editor?.chain().focus().toggleBold().run()} active={editor?.isActive('bold')} title="Bold">
          <strong>B</strong>
        </Btn>
        <Btn onClick={() => editor?.chain().focus().toggleItalic().run()} active={editor?.isActive('italic')} title="Italic">
          <em>I</em>
        </Btn>
        <Btn onClick={() => editor?.chain().focus().toggleUnderline().run()} active={editor?.isActive('underline')} title="Underline">
          <span className="underline">U</span>
        </Btn>
        <Btn onClick={() => editor?.chain().focus().toggleStrike().run()} active={editor?.isActive('strike')} title="Strikethrough">
          <span className="line-through">S</span>
        </Btn>
        <Divider />
        <Btn onClick={() => editor?.chain().focus().toggleBulletList().run()} active={editor?.isActive('bulletList')} title="Bullet list">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16"/><circle cx="1.5" cy="6" r="1.5" fill="currentColor"/><circle cx="1.5" cy="12" r="1.5" fill="currentColor"/><circle cx="1.5" cy="18" r="1.5" fill="currentColor"/></svg>
        </Btn>
        <Btn onClick={() => editor?.chain().focus().toggleOrderedList().run()} active={editor?.isActive('orderedList')} title="Numbered list">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6h11M10 12h11M10 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>
        </Btn>
        <Divider />
        <Btn onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="Insert table">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 6h18M3 14h18M3 18h18M8 6v12M16 6v12"/></svg>
        </Btn>
        <Btn onClick={() => { const url = prompt('Image URL:'); if (url) editor?.chain().focus().setImage({ src: url }).run() }} title="Insert image from URL">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
        </Btn>
        <Btn
          onClick={() => {
            const prev = editor?.getAttributes('link').href || ''
            const url = prompt('Link URL:', prev)
            if (url === null) return
            if (url === '') { editor?.chain().focus().unsetLink().run() }
            else { editor?.chain().focus().setLink({ href: url }).run() }
          }}
          active={editor?.isActive('link')}
          title="Insert link"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>
        </Btn>
        <Divider />
        <Btn onClick={() => editor?.chain().focus().setTextAlign('left').run()} active={editor?.isActive({ textAlign: 'left' })} title="Align left">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h10M4 18h16"/></svg>
        </Btn>
        <Btn onClick={() => editor?.chain().focus().setTextAlign('center').run()} active={editor?.isActive({ textAlign: 'center' })} title="Align center">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M7 12h10M4 18h16"/></svg>
        </Btn>
        <Btn onClick={() => editor?.chain().focus().setTextAlign('right').run()} active={editor?.isActive({ textAlign: 'right' })} title="Align right">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M10 12h10M4 18h16"/></svg>
        </Btn>
        <Divider />
        <Btn onClick={() => editor?.chain().focus().unsetAllMarks().clearNodes().run()} title="Clear formatting">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
        </Btn>
        {supabase && (
          <>
            <Divider />
            <span className="text-[10px] text-gray-600 px-1">@ to mention</span>
          </>
        )}
      </div>
      <EditorContent editor={editor} style={{ minHeight }} />
      {mentionState && (
        <MentionDropdown
          state={mentionState}
          onSelect={(p) => {
            mentionState.command({ id: p.email, label: p.full_name || p.email.split('@')[0] })
            setMentionState(null)
          }}
        />
      )}
    </div>
  )
}
