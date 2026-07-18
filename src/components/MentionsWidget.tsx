'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Notif {
  id: string
  sender_email: string
  message: string
  page: string
  is_read: boolean
  created_at: string
  context_url?: string | null
}

const PAGE_ROUTES: Record<string, string> = {
  Customers: '/sales/customers', Vendors: '/sales/vendors',
  'Sales Orders': '/sales/orders', 'Work Orders': '/production',
  Tasks: '/bizdev/tasks', Certifications: '/bizdev/certifications',
  Documents: '/bizdev/documents',
}

function timeAgo(iso: string) {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

export default function MentionsWidget() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const router = useRouter()
  const [email, setEmail] = useState<string | null>(null)
  const [notifs, setNotifs] = useState<Notif[]>([])
  const [loading, setLoading] = useState(true)

  const unread = notifs.filter(n => !n.is_read).length

  useEffect(() => {
    sb.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null))
  }, []) // eslint-disable-line

  useEffect(() => {
    if (!email) return
    function load() {
      sb.from('notifications')
        .select('*')
        .eq('recipient_email', email!)
        .order('created_at', { ascending: false })
        .limit(8)
        .then(({ data }) => { setNotifs((data as Notif[]) || []); setLoading(false) })
    }
    load()
    const channel = sb
      .channel('dash_notifs_' + email)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_email=eq.${email}` }, () => load())
      .subscribe()
    return () => { sb.removeChannel(channel) }
  }, [email]) // eslint-disable-line

  async function markAllRead() {
    if (!email) return
    await sb.from('notifications').update({ is_read: true }).eq('recipient_email', email).eq('is_read', false)
    setNotifs(n => n.map(x => ({ ...x, is_read: true })))
  }

  async function open(n: Notif) {
    await sb.from('notifications').update({ is_read: true }).eq('id', n.id)
    setNotifs(ns => ns.map(x => x.id === n.id ? { ...x, is_read: true } : x))
    const url = n.context_url || PAGE_ROUTES[n.page]
    if (url) {
      if (/^https?:\/\//.test(url)) { try { const u = new URL(url); router.push(u.pathname + u.search) } catch { router.push(url) } }
      else router.push(url)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-[#E2E8F0] overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#E4E6EE]">
        <h2 className="font-bold text-[#0F1C2E] flex items-center gap-2">
          Mentions
          {unread > 0 && <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">{unread}</span>}
        </h2>
        {unread > 0 && <button onClick={markAllRead} className="text-xs text-[#3B6FE0] font-semibold hover:underline">Mark all read</button>}
      </div>
      {loading ? (
        <div className="px-5 py-6 text-center text-sm text-[#8A9FC0]">Loading…</div>
      ) : notifs.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-[#8A9FC0]">No mentions yet — when a teammate @tags you it shows up here.</div>
      ) : (
        <div className="divide-y divide-[#F1F3F9] max-h-[320px] overflow-y-auto">
          {notifs.map(n => (
            <button key={n.id} onClick={() => open(n)} className={`w-full text-left px-5 py-3 hover:bg-[#F7F8FA] transition-colors ${!n.is_read ? 'bg-blue-50/40' : ''}`}>
              <div className="flex items-start gap-2.5">
                {!n.is_read && <span className="w-2 h-2 rounded-full bg-[#3B6FE0] mt-1.5 shrink-0" />}
                <div className={`flex-1 min-w-0 ${n.is_read ? 'pl-[18px]' : ''}`}>
                  <p className="text-xs font-semibold text-[#0F1C2E]">
                    <span className="text-[#3B6FE0]">{(n.sender_email || '').split('@')[0]}</span>
                    {' mentioned you in '}
                    <span>{n.page}</span>
                  </p>
                  {n.message && <p className="text-xs text-[#5A6E8A] mt-0.5 line-clamp-2 leading-relaxed">{n.message}</p>}
                  <p className="text-[10px] text-[#8A9FC0] mt-1">{timeAgo(n.created_at)}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
