'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface PkgComment {
  id: string; design_id: string; share_link_id: string | null; parent_id: string | null; pin_no: number | null
  x: number | null; y: number | null; w: number | null; h: number | null
  body: string; author_name: string | null; author_email: string | null; author_type: 'team' | 'printer'
  status: 'open' | 'resolved'; resolved_by: string | null; resolved_at: string | null; created_at: string
}

const when = (d: string) => {
  const t = new Date(d), diff = (Date.now() - t.getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function CommentsPanel({ comments, draft, onSubmitDraft, onCancelDraft, onReply, onResolve, onDelete, onFocus, focusId, showResolved, setShowResolved, canDelete, hint, teamLabel = 'beyondGREEN' }: {
  comments: PkgComment[]
  draft: { x: number; y: number; w?: number; h?: number } | null
  onSubmitDraft: (body: string) => Promise<void> | void
  onCancelDraft: () => void
  onReply: (parent: PkgComment, body: string) => Promise<void> | void
  onResolve?: (c: PkgComment, resolved: boolean) => void
  onDelete?: (c: PkgComment) => void
  onFocus: (id: string) => void
  focusId: string | null
  showResolved: boolean
  setShowResolved: (v: boolean) => void
  canDelete?: boolean
  hint?: ReactNode
  teamLabel?: string
}) {
  const [draftText, setDraftText] = useState('')
  const [busy, setBusy] = useState(false)
  const draftRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (draft) setTimeout(() => draftRef.current?.focus(), 30) }, [draft])
  const threads = comments.filter(c => !c.parent_id).sort((a, b) => (a.pin_no || 0) - (b.pin_no || 0))
  const visible = threads.filter(t => showResolved || t.status === 'open')
  const replies = (id: string) => comments.filter(c => c.parent_id === id)
  const resolvedCount = threads.filter(t => t.status === 'resolved').length

  return (
    <div className="space-y-3">
      {draft && (
        <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-2 space-y-2">
          <p className="text-[11px] font-semibold text-amber-800">New comment {draft.w ? 'on selected area' : 'at pin'}</p>
          <textarea ref={draftRef} value={draftText} onChange={e => setDraftText(e.target.value)} rows={3} placeholder="Describe the change or ask a question…"
            onKeyDown={async e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { setBusy(true); await onSubmitDraft(draftText); setDraftText(''); setBusy(false) } }}
            className="w-full text-sm border border-amber-300 rounded p-2 bg-white" />
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setDraftText(''); onCancelDraft() }} className="text-xs px-3 py-1.5 rounded text-gray-600 hover:bg-white">Cancel</button>
            <button disabled={busy || !draftText.trim()} onClick={async () => { setBusy(true); await onSubmitDraft(draftText); setDraftText(''); setBusy(false) }}
              className="text-xs px-3 py-1.5 rounded bg-amber-500 text-white font-medium disabled:opacity-50">{busy ? 'Posting…' : 'Post comment'}</button>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{threads.length - resolvedCount} open{resolvedCount ? ` · ${resolvedCount} resolved` : ''}</span>
        {resolvedCount > 0 && <label className="text-[11px] text-gray-500 flex items-center gap-1"><input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)} /> Show resolved</label>}
      </div>
      {!visible.length && !draft && <p className="text-xs text-gray-500">{hint || 'No comments yet.'}</p>}
      {visible.map(t => (
        <Thread key={t.id} t={t} replies={replies(t.id)} focused={focusId === t.id} onFocus={() => onFocus(t.id)} onReply={b => onReply(t, b)}
          onResolve={onResolve ? r => onResolve(t, r) : undefined} onDelete={canDelete && onDelete ? () => { if (confirm('Delete this comment thread?')) onDelete(t) } : undefined} teamLabel={teamLabel} />
      ))}
    </div>
  )
}

function Thread({ t, replies, focused, onFocus, onReply, onResolve, onDelete, teamLabel }: {
  t: PkgComment; replies: PkgComment[]; focused: boolean; onFocus: () => void; onReply: (b: string) => void | Promise<void>
  onResolve?: (resolved: boolean) => void; onDelete?: () => void; teamLabel: string
}) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (focused) { ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); setOpen(true) } }, [focused])
  const color = t.status === 'resolved' ? '#9CA3AF' : t.author_type === 'printer' ? '#8B5CF6' : '#F59E0B'
  const Msg = ({ c }: { c: PkgComment }) => (
    <div>
      <div className="flex items-center gap-1.5 text-[11px]">
        <span className="font-semibold text-gray-800">{c.author_name || (c.author_type === 'printer' ? 'Printer' : teamLabel)}</span>
        <span className={`px-1 rounded text-[10px] ${c.author_type === 'printer' ? 'bg-violet-100 text-violet-700' : 'bg-emerald-100 text-emerald-700'}`}>{c.author_type === 'printer' ? 'Printer' : teamLabel}</span>
        <span className="text-gray-400 ml-auto">{when(c.created_at)}</span>
      </div>
      <p className="text-[13px] text-gray-700 whitespace-pre-wrap mt-0.5">{c.body}</p>
    </div>
  )
  return (
    <div ref={ref} onClick={onFocus} className={`rounded-lg border p-2.5 space-y-2 cursor-pointer ${focused ? 'border-gray-800 shadow-sm' : 'border-gray-200 hover:border-gray-300'}`}>
      <div className="flex gap-2">
        <span className="shrink-0 w-6 h-6 rounded-full rounded-bl-none text-white text-[11px] font-bold grid place-items-center" style={{ background: color }}>{t.pin_no ?? '•'}</span>
        <div className="flex-1 min-w-0"><Msg c={t} /></div>
      </div>
      {replies.length > 0 && <div className="pl-8 space-y-2 border-l-2 border-gray-100 ml-3">{replies.map(r => <Msg key={r.id} c={r} />)}</div>}
      <div className="flex items-center gap-3 pl-8 text-[11px]" onClick={e => e.stopPropagation()}>
        <button onClick={() => setOpen(o => !o)} className="text-gray-500 hover:text-gray-900"><i className="ti ti-corner-down-right" /> Reply</button>
        {onResolve && <button onClick={() => onResolve(t.status !== 'resolved')} className="text-gray-500 hover:text-emerald-700">{t.status === 'resolved' ? <><i className="ti ti-refresh" /> Reopen</> : <><i className="ti ti-check" /> Resolve</>}</button>}
        {onDelete && <button onClick={onDelete} className="text-gray-400 hover:text-red-600 ml-auto"><i className="ti ti-trash" /></button>}
      </div>
      {open && (
        <div className="pl-8 flex gap-1.5" onClick={e => e.stopPropagation()}>
          <input value={text} onChange={e => setText(e.target.value)} placeholder="Write a reply…"
            onKeyDown={async e => { if (e.key === 'Enter' && text.trim()) { await onReply(text); setText('') } }}
            className="flex-1 min-w-0 text-xs border border-gray-300 rounded px-2 py-1.5" />
          <button disabled={!text.trim()} onClick={async () => { await onReply(text); setText('') }} className="text-xs px-2 rounded bg-gray-900 text-white disabled:opacity-40">Send</button>
        </div>
      )}
    </div>
  )
}
