'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Notif {
  id: string
  sender_email: string
  message: string
  page: string
  is_read: boolean
  created_at: string
}

function timeAgo(iso: string) {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

const PAGE_ROUTES: Record<string, string> = {
  Customers: '/sales/customers',
  Vendors: '/sales/vendors',
  'Sales Orders': '/sales/orders',
  'Work Orders': '/production',
  Tasks: '/bizdev/tasks',
  Certifications: '/bizdev/certifications',
  Documents: '/bizdev/documents',
}

export default function NotificationBell() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const router = useRouter()
  const [notifs, setNotifs] = useState<Notif[]>([])
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

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
        .limit(20)
        .then(({ data }) => { if (data) setNotifs(data as Notif[]) })
    }
    load()
    const channel = sb
      .channel('notifications_' + email)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_email=eq.${email}` }, () => load())
      .subscribe()
    return () => { sb.removeChannel(channel) }
  }, [email]) // eslint-disable-line

  useEffect(() => {
    function h(e: MouseEvent) {
      if (open && ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  async function markAllRead() {
    if (!email) return
    await sb.from('notifications').update({ is_read: true }).eq('recipient_email', email).eq('is_read', false)
    setNotifs(n => n.map(x => ({ ...x, is_read: true })))
  }

  async function clickNotif(n: Notif) {
    await sb.from('notifications').update({ is_read: true }).eq('id', n.id)
    setNotifs(ns => ns.map(x => x.id === n.id ? { ...x, is_read: true } : x))
    setOpen(false)
    const route = PAGE_ROUTES[n.page]
    if (route) router.push(route)
  }

  if (!email) return null

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="relative p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
        title="Notifications"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <span className="text-white font-semibold text-sm">Notifications</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifs.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-500 text-sm">No notifications yet</div>
            ) : (
              notifs.map(n => (
                <button
                  key={n.id}
                  onClick={() => clickNotif(n)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-800/60 last:border-0 hover:bg-gray-800/50 transition-colors ${!n.is_read ? 'bg-gray-800/20' : ''}`}
                >
                  <div className="flex items-start gap-2">
                    {!n.is_read && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 shrink-0" />}
                    <div className={`flex-1 min-w-0 ${n.is_read ? 'pl-3.5' : ''}`}>
                      <p className="text-xs text-gray-400 truncate">
                        <span className="text-gray-300 font-medium">{n.sender_email.split('@')[0]}</span>
                        {' tagged you in '}<span className="text-emerald-400">{n.page}</span>
                      </p>
                      <p className="text-sm text-gray-300 mt-0.5 line-clamp-2 leading-snug">{n.message}</p>
                      <p className="text-xs text-gray-600 mt-1">{timeAgo(n.created_at)}</p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
