'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import RichTextEditor from '@/components/RichTextEditor'
import { useToast } from '@/components/Toast'

/* ═══════════════════════════════════════════════════════════════════════════
   Team Chat — groups + direct messages with rich text, @mentions, files and
   images. Lives on the dashboard (embedded) and behind the floating bubble on
   every page (floating). Realtime via Supabase; read state per member.
   ═══════════════════════════════════════════════════════════════════════ */

const ACCENT = '#0F7A4E'
const GENERAL_ID = '00000000-0000-0000-0000-00000000c0a1'

interface Profile { email: string; full_name: string | null; avatar_color: string | null; avatar_initials: string | null; is_active: boolean | null }
interface Conv { id: string; kind: 'group' | 'dm'; name: string | null; members: string[]; last_message_at: string | null; last_message_preview: string | null; last_message_by: string | null; last_read_at: string | null; muted: boolean; unread: number; is_archived?: boolean }
interface Attachment { name: string; size: number; type: string; url: string; path: string; bucket: string; is_image: boolean }
interface Msg { id: string; conversation_id: string; sender_email: string; body_html: string | null; body_text: string | null; attachments: Attachment[]; mentions: string[]; edited_at: string | null; deleted_at: string | null; created_at: string }

const PALETTE = ['#5559df', '#00c875', '#579bfc', '#a25ddc', '#fdab3d', '#037f4c', '#ff6d3b', '#bb3354', '#00a89b', '#7e3b8a']
const colorFor = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return PALETTE[h % PALETTE.length] }
const initialsOf = (name: string) => name.split(/[\s@._]+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase()
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const fmtDay = (iso: string) => {
  const d = new Date(iso); const t = new Date(); t.setHours(0, 0, 0, 0)
  const diff = Math.round((t.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000)
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}
const ago = (iso: string | null) => {
  if (!iso) return ''
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'now'; if (s < 3600) return `${Math.floor(s / 60)}m`; if (s < 86400) return `${Math.floor(s / 3600)}h`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
const fmtSize = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`
const htmlToText = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return (d.textContent || '').replace(/\s+/g, ' ').trim() }
const mentionsIn = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return Array.from(d.querySelectorAll('.mention-tag, [data-type="mention"]')).map(el => (el.getAttribute('data-id') || '').toLowerCase()).filter(Boolean) }
/** Allow-list sanitizer: our editor emits clean HTML, but a message body is still other people's content. */
function sanitize(html: string) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  doc.querySelectorAll('script,style,iframe,object,embed,link,meta,form,input,button').forEach(el => el.remove())
  doc.querySelectorAll('*').forEach(el => {
    for (const a of Array.from(el.attributes)) {
      const n = a.name.toLowerCase(), v = a.value.trim().toLowerCase()
      if (n.startsWith('on') || ((n === 'href' || n === 'src') && (v.startsWith('javascript:') || v.startsWith('data:text')))) el.removeAttribute(a.name)
    }
    if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer') }
  })
  return doc.body.firstElementChild?.innerHTML || ''
}

const Avatar = ({ email, profiles, size = 28 }: { email: string; profiles: Record<string, Profile>; size?: number }) => {
  const p = profiles[email.toLowerCase()]; const name = p?.full_name || email
  return <span title={name} className="rounded-full inline-flex items-center justify-center text-white font-bold shrink-0" style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: p?.avatar_color || colorFor(name) }}>{p?.avatar_initials || initialsOf(name)}</span>
}

export default function TeamChat({ mode = 'embedded', height = 560, initialConversationId, onUnread, onClose }: {
  mode?: 'embedded' | 'floating'; height?: number | string; initialConversationId?: string | null; onUnread?: (n: number) => void; onClose?: () => void
}) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const { toast } = useToast()
  const [me, setMe] = useState('')
  const [profiles, setProfiles] = useState<Record<string, Profile>>({})
  const [convs, setConvs] = useState<Conv[]>([])
  const [browse, setBrowse] = useState<{ id: string; name: string | null; members: number }[]>([])
  const [activeId, setActiveId] = useState<string | null>(initialConversationId || null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [html, setHtml] = useState('')
  const [clearKey, setClearKey] = useState(0)
  const [pending, setPending] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [sending, setSending] = useState(false)
  const [editing, setEditing] = useState<Msg | null>(null)
  const [search, setSearch] = useState('')
  const [panel, setPanel] = useState<'none' | 'new-dm' | 'new-group' | 'members' | 'browse'>('none')
  const [groupName, setGroupName] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [pickQ, setPickQ] = useState('')
  const [mobileList, setMobileList] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const activeRef = useRef<string | null>(null)
  const overviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { activeRef.current = activeId }, [activeId])

  const active = convs.find(c => c.id === activeId) || null
  const team = useMemo(() => Object.values(profiles).filter(p => p.is_active !== false && p.email.toLowerCase() !== me.toLowerCase()).sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email)), [profiles, me])
  const nameOf = useCallback((email: string) => profiles[email.toLowerCase()]?.full_name || email.split('@')[0], [profiles])
  const convTitle = useCallback((c: Conv) => c.kind === 'group' ? (c.name || 'Group') : nameOf(c.members.find(m => m.toLowerCase() !== me.toLowerCase()) || c.members[0] || ''), [nameOf, me])
  const totalUnread = convs.reduce((s, c) => s + (c.muted ? 0 : Number(c.unread || 0)), 0)
  useEffect(() => { onUnread?.(totalUnread) }, [totalUnread, onUnread])

  const loadOverview = useCallback(async () => {
    const [{ data }, { data: groups }] = await Promise.all([sb.rpc('chat_overview'), sb.from('chat_conversations').select('id,name,chat_members(email)').eq('kind', 'group').eq('is_archived', false)])
    const list = ((data as Conv[]) || []).map(c => ({ ...c, unread: Number(c.unread || 0) }))
    setConvs(list)
    const mine = new Set(list.map(c => c.id))
    setBrowse(((groups as any[]) || []).filter(g => !mine.has(g.id)).map(g => ({ id: g.id, name: g.name, members: (g.chat_members || []).length })))
  }, [sb])

  useEffect(() => {
    sb.auth.getUser().then(({ data }: any) => setMe((data.user?.email || '').toLowerCase()))
    sb.from('user_profiles').select('email,full_name,avatar_color,avatar_initials,is_active').then(({ data }: any) => {
      const map: Record<string, Profile> = {}; (data || []).forEach((p: Profile) => { map[p.email.toLowerCase()] = p }); setProfiles(map)
    })
    loadOverview()
  }, [sb, loadOverview])

  // realtime: new messages anywhere I'm a member; conversation list changes
  useEffect(() => {
    const ch = sb.channel('team-chat')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload: any) => {
        const m = payload.new as Msg
        if (m.conversation_id === activeRef.current) {
          setMsgs(prev => prev.some(x => x.id === m.id) ? prev : [...prev, m])
          sb.rpc('chat_mark_read', { p_conv: m.conversation_id }).then(() => {})
        }
        if (overviewTimer.current) clearTimeout(overviewTimer.current)
        overviewTimer.current = setTimeout(loadOverview, 300)
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages' }, (payload: any) => {
        const m = payload.new as Msg
        setMsgs(prev => prev.map(x => x.id === m.id ? { ...x, ...m } : x))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_members' }, () => {
        if (overviewTimer.current) clearTimeout(overviewTimer.current)
        overviewTimer.current = setTimeout(loadOverview, 300)
      })
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [sb, loadOverview])

  // open a conversation
  const open = useCallback(async (id: string) => {
    setActiveId(id); setMobileList(false); setPanel('none'); setEditing(null)
    setLoadingMsgs(true)
    const { data } = await sb.from('chat_messages').select('*').eq('conversation_id', id).order('created_at', { ascending: true }).limit(300)
    setMsgs((data as Msg[]) || []); setLoadingMsgs(false)
    await sb.rpc('chat_mark_read', { p_conv: id })
    setConvs(cs => cs.map(c => c.id === id ? { ...c, unread: 0, last_read_at: new Date().toISOString() } : c))
    setTimeout(() => bottomRef.current?.scrollIntoView({ block: 'end' }), 30)
  }, [sb])
  useEffect(() => { if (initialConversationId && convs.some(c => c.id === initialConversationId) && activeId !== initialConversationId) open(initialConversationId) }, [initialConversationId, convs]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!activeId && convs.length && mode === 'embedded' && typeof window !== 'undefined' && window.innerWidth >= 768) open(convs.find(c => c.id === GENERAL_ID)?.id || convs[0].id) }, [convs.length]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [msgs.length])

  // uploads
  async function addFiles(files: FileList | File[]) {
    if (!activeId) return
    setUploading(true)
    const out: Attachment[] = []
    for (const f of Array.from(files)) {
      if (f.size > 50 * 1024 * 1024) { toast(`${f.name} is over 50 MB`, 'error'); continue }
      const isImage = f.type.startsWith('image/')
      const id = (globalThis.crypto?.randomUUID?.() || Date.now().toString(36))
      const safe = f.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
      try {
        if (isImage) {
          const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')
          const path = `chat/${activeId}/${id}.${ext}`
          const { error } = await sb.storage.from('erp-images').upload(path, f, { upsert: false, contentType: f.type })
          if (error) throw error
          const { data: pub } = sb.storage.from('erp-images').getPublicUrl(path)
          out.push({ name: f.name, size: f.size, type: f.type, url: pub.publicUrl, path, bucket: 'erp-images', is_image: true })
        } else {
          const path = `chat/${activeId}/${id}-${safe}`
          const { error } = await sb.storage.from('erp-files').upload(path, f, { upsert: false, contentType: f.type || 'application/octet-stream' })
          if (error) throw error
          const { data: signed } = await sb.storage.from('erp-files').createSignedUrl(path, 60 * 60 * 24 * 365)
          out.push({ name: f.name, size: f.size, type: f.type, url: signed?.signedUrl || '', path, bucket: 'erp-files', is_image: false })
        }
      } catch (e: any) { toast(`Upload failed: ${e.message || e}`, 'error') }
    }
    setPending(p => [...p, ...out]); setUploading(false)
  }

  async function send() {
    if (!activeId || sending) return
    const text = htmlToText(html)
    if (!text && pending.length === 0) return
    setSending(true)
    try {
      if (editing) {
        const { error } = await sb.from('chat_messages').update({ body_html: html, body_text: text, mentions: mentionsIn(html), edited_at: new Date().toISOString() }).eq('id', editing.id)
        if (error) throw error
        setMsgs(ms => ms.map(m => m.id === editing.id ? { ...m, body_html: html, body_text: text, edited_at: new Date().toISOString() } : m))
        setEditing(null)
      } else {
        const row = { conversation_id: activeId, sender_email: me, body_html: html || null, body_text: text || null, attachments: pending, mentions: mentionsIn(html) }
        const { data, error } = await sb.from('chat_messages').insert(row).select('*').single()
        if (error) throw error
        if (data) setMsgs(ms => ms.some(x => x.id === data.id) ? ms : [...ms, data as Msg])
      }
      setHtml(''); setPending([]); setClearKey(k => k + 1)
    } catch (e: any) { toast('Could not send: ' + (e.message || e), 'error') }
    finally { setSending(false) }
  }
  async function removeMsg(m: Msg) {
    if (!confirm('Delete this message?')) return
    const { error } = await sb.from('chat_messages').update({ deleted_at: new Date().toISOString(), body_html: null, body_text: null, attachments: [] }).eq('id', m.id)
    if (error) toast(error.message, 'error'); else setMsgs(ms => ms.map(x => x.id === m.id ? { ...x, deleted_at: new Date().toISOString(), body_html: null, body_text: null, attachments: [] } : x))
  }
  async function startDm(email: string) {
    const { data, error } = await sb.rpc('chat_start_dm', { p_other: email })
    if (error) { toast(error.message, 'error'); return }
    await loadOverview(); open(data as string)
  }
  async function createGroup() {
    if (!groupName.trim()) { toast('Give the group a name', 'warning'); return }
    const { data, error } = await sb.rpc('chat_create_group', { p_name: groupName.trim(), p_members: picked })
    if (error) { toast(error.message, 'error'); return }
    setGroupName(''); setPicked([]); await loadOverview(); open(data as string); toast('Group created')
  }
  async function addMembers(emails: string[]) {
    if (!active || !emails.length) return
    const { error } = await sb.from('chat_members').insert(emails.map(e => ({ conversation_id: active.id, email: e.toLowerCase() })))
    if (error) { toast(error.message, 'error'); return }
    setPicked([]); await loadOverview(); toast(`${emails.length} added`)
  }
  async function leave(c: Conv) {
    if (c.id === GENERAL_ID) { toast('Everyone stays in General', 'warning'); return }
    if (!confirm(`Leave ${convTitle(c)}?`)) return
    await sb.from('chat_members').delete().eq('conversation_id', c.id).eq('email', me)
    if (activeId === c.id) { setActiveId(null); setMsgs([]) }
    loadOverview()
  }
  async function joinGroup(id: string) {
    const { error } = await sb.from('chat_members').insert({ conversation_id: id, email: me })
    if (error) { toast(error.message, 'error'); return }
    await loadOverview(); open(id)
  }
  async function rename(c: Conv) {
    const n = prompt('Group name', c.name || ''); if (n === null || !n.trim()) return
    const { error } = await sb.from('chat_conversations').update({ name: n.trim() }).eq('id', c.id)
    if (error) toast(error.message, 'error'); else loadOverview()
  }
  async function toggleMute(c: Conv) {
    await sb.from('chat_members').update({ muted: !c.muted }).eq('conversation_id', c.id).eq('email', me)
    loadOverview()
  }

  const filtered = convs.filter(c => !search || convTitle(c).toLowerCase().includes(search.toLowerCase()) || (c.last_message_preview || '').toLowerCase().includes(search.toLowerCase()))
  const groups = filtered.filter(c => c.kind === 'group'), dms = filtered.filter(c => c.kind === 'dm')

  const ConvRow = ({ c }: { c: Conv }) => {
    const other = c.kind === 'dm' ? (c.members.find(m => m !== me) || c.members[0] || '') : ''
    const isActive = c.id === activeId
    return (
      <button onClick={() => open(c.id)} className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-xl transition-colors ${isActive ? 'bg-white shadow-sm border border-[#E4E6EE]' : 'hover:bg-white/70 border border-transparent'}`}>
        {c.kind === 'dm' ? <Avatar email={other} profiles={profiles} size={32} /> : <span className="w-8 h-8 rounded-lg inline-flex items-center justify-center text-white font-bold text-sm shrink-0" style={{ background: c.id === GENERAL_ID ? ACCENT : colorFor(c.name || c.id) }}>#</span>}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2"><span className={`text-[13px] truncate ${c.unread ? 'font-bold text-[#1A1D2E]' : 'font-semibold text-[#1A1D2E]'}`}>{convTitle(c)}</span><span className="ml-auto text-[10px] text-gray-400 shrink-0">{ago(c.last_message_at)}</span></span>
          <span className="flex items-center gap-2"><span className={`text-[11px] truncate ${c.unread ? 'text-[#1A1D2E] font-medium' : 'text-gray-400'}`}>{c.last_message_by && c.last_message_preview ? `${c.last_message_by === me ? 'You' : nameOf(c.last_message_by).split(' ')[0]}: ${c.last_message_preview}` : c.kind === 'group' ? `${c.members.length} member${c.members.length === 1 ? '' : 's'}` : 'Say hello'}</span>{c.unread > 0 && !c.muted && <span className="ml-auto shrink-0 text-[10px] font-bold text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center" style={{ background: ACCENT }}>{c.unread}</span>}{c.muted && <span className="ml-auto text-[10px] text-gray-300">🔕</span>}</span>
        </span>
      </button>
    )
  }

  // Rendered as a plain function (not <PeoplePicker/>) so parent re-renders — picking a person,
  // a new message arriving — don't remount it and wipe the search box.
  const PeoplePicker = ({ multi, onPick, exclude = [] }: { multi: boolean; onPick: (emails: string[]) => void; exclude?: string[] }) => {
    const q = pickQ, setQ = setPickQ
    const list = team.filter(p => !exclude.includes(p.email.toLowerCase()) && (!q || (p.full_name || p.email).toLowerCase().includes(q.toLowerCase())))
    return (
      <div>
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search people…" className="w-full bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-[#0F7A4E]/30" />
        <div className="max-h-56 overflow-y-auto space-y-0.5">
          {list.map(p => {
            const on = picked.includes(p.email.toLowerCase())
            return (
              <button key={p.email} onClick={() => multi ? setPicked(ps => on ? ps.filter(x => x !== p.email.toLowerCase()) : [...ps, p.email.toLowerCase()]) : onPick([p.email.toLowerCase()])}
                className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm hover:bg-[#F3F4F8] ${on ? 'bg-[#ECF7F1]' : ''}`}>
                {multi && <span className={`w-4 h-4 rounded border inline-flex items-center justify-center text-[10px] ${on ? 'bg-[#0F7A4E] border-[#0F7A4E] text-white' : 'border-gray-300'}`}>{on ? '✓' : ''}</span>}
                <Avatar email={p.email} profiles={profiles} size={24} /><span className="text-[#1A1D2E]">{p.full_name || p.email}</span>
              </button>
            )
          })}
          {list.length === 0 && <p className="text-xs text-gray-400 px-2 py-3">No one matches.</p>}
        </div>
        {multi && <button onClick={() => onPick(picked)} disabled={!picked.length} className="mt-2 w-full text-white text-sm font-semibold rounded-lg py-2 disabled:opacity-50" style={{ background: ACCENT }}>Add {picked.length || ''}</button>}
      </div>
    )
  }

  const shell = mode === 'floating' ? 'rounded-2xl border border-[#E4E6EE] shadow-2xl bg-white' : 'rounded-2xl border border-[#E4E6EE] bg-white shadow-sm'
  return (
    <div className={`${shell} overflow-hidden flex flex-col`} style={{ height }}>
      {/* title bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#EEF0F4] bg-white shrink-0">
        <span className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-white text-sm" style={{ background: ACCENT }}>💬</span>
        <span className="font-bold text-[#1A1D2E] text-sm">Team Chat</span>
        {totalUnread > 0 && <span className="text-[10px] font-bold text-white rounded-full px-1.5 py-0.5" style={{ background: '#e2445c' }}>{totalUnread}</span>}
        <span className="ml-auto flex items-center gap-1.5">
          <button data-ro-ok onClick={() => { setPanel(p => p === 'new-dm' ? 'none' : 'new-dm'); setPicked([]); setPickQ('') }} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-[#E4E6EE] hover:bg-[#F6F7FB]">✉ New message</button>
          <button data-ro-ok onClick={() => { setPanel(p => p === 'new-group' ? 'none' : 'new-group'); setPicked([]); setPickQ('') }} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-[#E4E6EE] hover:bg-[#F6F7FB]">+ Group</button>
          {mode === 'embedded' && <a href="/?chat=full" className="hidden" aria-hidden />}
          {onClose && <button data-ro-ok onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none pl-1">&times;</button>}
        </span>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* conversation list */}
        <aside className={`${mobileList ? 'flex' : 'hidden'} md:flex w-full md:w-[260px] shrink-0 flex-col border-r border-[#EEF0F4] bg-[#F6F7FB]`}>
          <div className="p-2.5"><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search chats…" className="w-full bg-white border border-[#E4E6EE] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F7A4E]/30" /></div>
          <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-3">
            <div>
              <div className="flex items-center justify-between px-2 pb-1"><p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Groups</p>{browse.length > 0 && <button onClick={() => setPanel(p => p === 'browse' ? 'none' : 'browse')} className="text-[10px] text-gray-400 hover:text-gray-700">Browse {browse.length}</button>}</div>
              <div className="space-y-0.5">{groups.map(c => <ConvRow key={c.id} c={c} />)}{groups.length === 0 && <p className="text-xs text-gray-400 px-2 py-2">No groups yet.</p>}</div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold px-2 pb-1">Direct messages</p>
              <div className="space-y-0.5">{dms.map(c => <ConvRow key={c.id} c={c} />)}{dms.length === 0 && <p className="text-xs text-gray-400 px-2 py-2">No conversations yet — start one with ✉ New message.</p>}</div>
            </div>
          </div>
        </aside>

        {/* conversation */}
        <section className={`${mobileList ? 'hidden' : 'flex'} md:flex flex-1 min-w-0 flex-col bg-white`}>
          {panel !== 'none' && (
            <div className="border-b border-[#EEF0F4] bg-[#FAFBFD] p-3">
              <div className="flex items-center justify-between mb-2"><p className="text-sm font-semibold text-[#1A1D2E]">{panel === 'new-dm' ? 'Message someone' : panel === 'new-group' ? 'New group' : panel === 'members' ? `Members · ${active ? convTitle(active) : ''}` : 'Groups you can join'}</p><button onClick={() => setPanel('none')} className="text-gray-400 hover:text-gray-700 text-lg leading-none">&times;</button></div>
              {panel === 'new-dm' && PeoplePicker({ multi: false, onPick: ([e]) => startDm(e) })}
              {panel === 'new-group' && (<div><input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Group name — e.g. Production Floor, Shipping, Managers" className="w-full bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-[#0F7A4E]/30" />{PeoplePicker({ multi: true, onPick: () => createGroup() })}</div>)}
              {panel === 'members' && active && (
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="space-y-1 max-h-56 overflow-y-auto">
                    {active.members.map(m => <div key={m} className="flex items-center gap-2 text-sm px-2 py-1"><Avatar email={m} profiles={profiles} size={24} /><span className="text-[#1A1D2E]">{nameOf(m)}{m === me ? ' (you)' : ''}</span></div>)}
                  </div>
                  {active.kind === 'group' && <div><p className="text-[11px] text-gray-400 mb-1">Add people</p>{PeoplePicker({ multi: true, onPick: addMembers, exclude: active.members.map(x => x.toLowerCase()) })}</div>}
                </div>
              )}
              {panel === 'browse' && <div className="space-y-1">{browse.map(g => <div key={g.id} className="flex items-center gap-2 text-sm px-2 py-1.5 bg-white rounded-lg border border-[#E4E6EE]"><span className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-white font-bold text-xs" style={{ background: colorFor(g.name || g.id) }}>#</span><span className="font-medium text-[#1A1D2E]">{g.name}</span><span className="text-xs text-gray-400">{g.members} members</span><button onClick={() => joinGroup(g.id)} className="ml-auto text-xs font-semibold text-white rounded-lg px-2.5 py-1" style={{ background: ACCENT }}>Join</button></div>)}</div>}
            </div>
          )}

          {!active ? (
            <div className="flex-1 flex items-center justify-center text-center p-8">
              <div><p className="text-3xl mb-2">💬</p><p className="font-semibold text-[#1A1D2E]">Pick a conversation</p><p className="text-sm text-gray-400 mt-1">Or start one — message a teammate or make a group for a department, a shift, a project.</p></div>
            </div>
          ) : (
            <>
              <header className="flex items-center gap-2 px-4 py-2 border-b border-[#EEF0F4] shrink-0">
                <button onClick={() => setMobileList(true)} className="md:hidden text-gray-500 hover:text-gray-800 pr-1">←</button>
                {active.kind === 'dm' ? <Avatar email={active.members.find(m => m !== me) || active.members[0] || ''} profiles={profiles} size={28} /> : <span className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-white font-bold text-sm" style={{ background: active.id === GENERAL_ID ? ACCENT : colorFor(active.name || active.id) }}>#</span>}
                <div className="min-w-0"><p className="text-sm font-bold text-[#1A1D2E] truncate">{convTitle(active)}</p><p className="text-[11px] text-gray-400 truncate">{active.kind === 'group' ? `${active.members.length} members · ${active.members.slice(0, 4).map(m => nameOf(m).split(' ')[0]).join(', ')}${active.members.length > 4 ? '…' : ''}` : profiles[(active.members.find(m => m !== me) || '').toLowerCase()]?.email || ''}</p></div>
                <span className="ml-auto flex items-center gap-1">
                  <button onClick={() => { setPanel(p => p === 'members' ? 'none' : 'members'); setPicked([]); setPickQ('') }} className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1 rounded-lg hover:bg-[#F6F7FB]">👥 {active.members.length}</button>
                  <button onClick={() => toggleMute(active)} title={active.muted ? 'Unmute' : 'Mute'} className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1 rounded-lg hover:bg-[#F6F7FB]">{active.muted ? '🔕' : '🔔'}</button>
                  {active.kind === 'group' && active.id !== GENERAL_ID && <button onClick={() => rename(active)} className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1 rounded-lg hover:bg-[#F6F7FB]">✎</button>}
                  {active.kind === 'group' && active.id !== GENERAL_ID && <button onClick={() => leave(active)} className="text-xs text-gray-500 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-[#F6F7FB]">Leave</button>}
                </span>
              </header>

              <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files) }}>
                {loadingMsgs && <p className="text-xs text-gray-400 text-center py-6">Loading…</p>}
                {!loadingMsgs && msgs.length === 0 && <p className="text-xs text-gray-400 text-center py-10">No messages yet. Say something 👋</p>}
                {msgs.map((m, i) => {
                  const prev = msgs[i - 1]
                  const newDay = !prev || fmtDay(prev.created_at) !== fmtDay(m.created_at)
                  const grouped = !!prev && !newDay && prev.sender_email === m.sender_email && (new Date(m.created_at).getTime() - new Date(prev.created_at).getTime()) < 5 * 60000
                  const mine = m.sender_email.toLowerCase() === me
                  return (
                    <div key={m.id}>
                      {newDay && <div className="flex items-center gap-3 my-3"><span className="flex-1 h-px bg-[#EEF0F4]" /><span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{fmtDay(m.created_at)}</span><span className="flex-1 h-px bg-[#EEF0F4]" /></div>}
                      <div className={`group flex gap-2.5 ${grouped ? 'mt-0.5' : 'mt-3'}`}>
                        <div className="w-8 shrink-0">{!grouped && <Avatar email={m.sender_email} profiles={profiles} size={32} />}</div>
                        <div className="min-w-0 flex-1">
                          {!grouped && <div className="flex items-baseline gap-2"><span className="text-[13px] font-bold text-[#1A1D2E]">{nameOf(m.sender_email)}</span><span className="text-[10px] text-gray-400">{fmtTime(m.created_at)}</span></div>}
                          {m.deleted_at ? <p className="text-xs text-gray-300 italic">Message deleted</p> : (
                            <>
                              {m.body_html && <div className="rte-view text-sm text-gray-800 break-words [&_p]:mb-1 [&_p:last-child]:mb-0" dangerouslySetInnerHTML={{ __html: sanitize(m.body_html) }} />}
                              {m.attachments?.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-1.5">
                                  {m.attachments.map((a, k) => a.is_image
                                    ? <a key={k} href={a.url} target="_blank" rel="noreferrer" className="block"><img src={a.url} alt={a.name} className="max-h-56 max-w-[320px] rounded-xl border border-[#E4E6EE] object-cover" /></a>
                                    : <a key={k} href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 bg-[#F6F7FB] border border-[#E4E6EE] rounded-xl px-3 py-2 text-xs text-[#1A1D2E] hover:border-[#C7CBE0]"><span>📎</span><span className="font-semibold truncate max-w-[200px]">{a.name}</span><span className="text-gray-400">{fmtSize(a.size)}</span></a>)}
                                </div>
                              )}
                              {m.edited_at && <span className="text-[10px] text-gray-300">(edited)</span>}
                            </>
                          )}
                        </div>
                        {mine && !m.deleted_at && (
                          <div className="opacity-0 group-hover:opacity-100 flex items-start gap-1 shrink-0">
                            {m.body_html && <button onClick={() => { setEditing(m); setHtml(m.body_html || ''); }} className="text-[11px] text-gray-400 hover:text-gray-700">Edit</button>}
                            <button onClick={() => removeMsg(m)} className="text-[11px] text-gray-400 hover:text-red-600">Delete</button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
                <div ref={bottomRef} />
              </div>

              {/* composer */}
              <div className="border-t border-[#EEF0F4] p-2.5 shrink-0 bg-white">
                {editing && <div className="flex items-center justify-between text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 mb-2"><span>Editing your message</span><button onClick={() => { setEditing(null); setHtml(''); setClearKey(k => k + 1) }} className="font-semibold">Cancel</button></div>}
                {pending.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {pending.map((a, i) => <span key={i} className="inline-flex items-center gap-1.5 bg-[#F6F7FB] border border-[#E4E6EE] rounded-lg pl-1 pr-2 py-1 text-xs">{a.is_image ? <img src={a.url} alt="" className="w-7 h-7 rounded object-cover" /> : <span className="px-1">📎</span>}<span className="truncate max-w-[160px]">{a.name}</span><button onClick={() => setPending(p => p.filter((_, k) => k !== i))} className="text-gray-400 hover:text-red-600">×</button></span>)}
                  </div>
                )}
                <div className="chat-composer">
                  <RichTextEditor content={html} onChange={setHtml} supabase={sb} compact minHeight="44px" placeholder={`Message ${active ? convTitle(active) : ''} — Enter to send, Shift+Enter for a new line, @ to mention`} onEnter={send} clearKey={clearKey} />
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <input ref={fileRef} type="file" multiple className="hidden" onChange={e => { if (e.target.files) addFiles(e.target.files); e.currentTarget.value = '' }} />
                  <button onClick={() => fileRef.current?.click()} disabled={uploading} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-[#E4E6EE] hover:bg-[#F6F7FB] disabled:opacity-50">{uploading ? 'Uploading…' : '📎 Attach'}</button>
                  <button onClick={() => { if (fileRef.current) { fileRef.current.accept = 'image/*'; fileRef.current.click(); setTimeout(() => { if (fileRef.current) fileRef.current.accept = '' }, 1000) } }} disabled={uploading} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-[#E4E6EE] hover:bg-[#F6F7FB] disabled:opacity-50">🖼 Photo</button>
                  <span className="text-[10px] text-gray-400 hidden sm:inline">Paste a screenshot straight into the box · drop files anywhere in the chat</span>
                  <button onClick={send} disabled={sending || uploading || (!htmlToText(html) && pending.length === 0)} className="ml-auto text-white text-sm font-semibold rounded-lg px-4 py-1.5 disabled:opacity-50" style={{ background: ACCENT }}>{sending ? 'Sending…' : editing ? 'Save' : 'Send'}</button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

/* Floating launcher — replaces the old channel bubble + DM windows on every page. */
export function ChatLauncher() {
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const isDashboard = usePathname() === '/'   // re-evaluated on every client-side navigation
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey) }, [])
  if (isDashboard) return <HiddenUnreadProbe onUnread={setUnread} />
  return (
    <>
      {open && (
        <div className="fixed z-[70] bottom-20 right-4 left-4 sm:left-auto sm:w-[760px] max-w-[calc(100vw-2rem)]">
          <TeamChat mode="floating" height="min(640px, calc(100vh - 7rem))" onUnread={setUnread} onClose={() => setOpen(false)} />
        </div>
      )}
      {!open && <HiddenUnreadProbe onUnread={setUnread} />}
      <button data-ro-ok onClick={() => setOpen(o => !o)} className="fixed z-[70] bottom-5 right-4 w-12 h-12 rounded-full text-white shadow-xl flex items-center justify-center text-xl hover:scale-105 transition-transform" style={{ background: ACCENT }} title="Team chat">
        {open ? '×' : '💬'}
        {!open && unread > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">{unread > 99 ? '99+' : unread}</span>}
      </button>
    </>
  )
}

/* Keeps the unread badge honest while the panel is closed (cheap: one RPC + realtime). */
function HiddenUnreadProbe({ onUnread }: { onUnread: (n: number) => void }) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const refresh = () => sb.rpc('chat_overview').then(({ data }: any) => onUnread(((data as Conv[]) || []).reduce((s, c) => s + (c.muted ? 0 : Number(c.unread || 0)), 0)))
    refresh()
    const ch = sb.channel('team-chat-badge').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, () => { if (timer) clearTimeout(timer); timer = setTimeout(refresh, 400) }).subscribe()
    return () => { sb.removeChannel(ch); if (timer) clearTimeout(timer) }
  }, [sb, onUnread])
  return null
}
