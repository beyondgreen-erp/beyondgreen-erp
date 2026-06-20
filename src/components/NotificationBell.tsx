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
  context_url?: string
}

function timeAgo(iso: string) {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

const PAGE_ROUTES: Record<string, string> = {
  Customers: '/sales/customers', Vendors: '/sales/vendors',
  'Sales Orders': '/sales/orders', 'Work Orders': '/production',
  Tasks: '/bizdev/tasks', Certifications: '/bizdev/certifications',
  Documents: '/bizdev/documents',
}

export default function NotificationBell() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const router = useRouter()
  const [notifs, setNotifs] = useState<Notif[]>([])
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [actionNotifId, setActionNotifId] = useState<string | null>(null)
  const [toast, setToast] = useState('')
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
        .limit(30)
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
      if (open && ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setActionNotifId(null)
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function markAllRead() {
    if (!email) return
    await sb.from('notifications').update({ is_read: true }).eq('recipient_email', email).eq('is_read', false)
    setNotifs(n => n.map(x => ({ ...x, is_read: true })))
  }

  async function clickNotif(n: Notif) {
    await sb.from('notifications').update({ is_read: true }).eq('id', n.id)
    setNotifs(ns => ns.map(x => x.id === n.id ? { ...x, is_read: true } : x))
    if (actionNotifId === n.id) { setActionNotifId(null); return }
    setActionNotifId(n.id)
  }

  async function addToReminders(n: Notif) {
    const { error } = await sb.from('reminders').insert({
      user_email: email,
      title: `${n.sender_email.split('@')[0]} mentioned you in ${n.page}`,
      notes: n.message,
      priority: 'medium',
      reminder_type: 'follow_up',
      color: '#3B6FE0',
      is_completed: false,
    })
    if (error) { showToast('Could not add reminder'); return }
    showToast('Added to My Reminders')
    setActionNotifId(null)
  }

  async function addToTasks(n: Notif) {
    const { error } = await sb.from('tasks').insert({
      name: `Follow up: ${n.sender_email.split('@')[0]} mentioned you in ${n.page}`,
      description: n.message,
      status: 'To Do',
      priority: 'Medium',
      assigned_to: email,
    })
    if (error) { showToast('Could not add task'); return }
    showToast('Added to Open Tasks')
    setActionNotifId(null)
  }

  async function goToContext(n: Notif) {
    await sb.from('notifications').update({ is_read: true }).eq('id', n.id)
    setNotifs(ns => ns.map(x => x.id === n.id ? { ...x, is_read: true } : x))
    setOpen(false)
    setActionNotifId(null)
    const url = n.context_url || PAGE_ROUTES[n.page]
    if (url) router.push(url)
  }

  if (!email) return null

  return (
    <>
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#1A1D2E] text-white text-sm px-4 py-2.5 rounded-xl shadow-xl z-[200] font-medium">
          {toast}
        </div>
      )}
      <div ref={ref} className="relative">
        <button
          onClick={() => { setOpen(v => !v); setActionNotifId(null) }}
          className="relative p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-[#F5F6FA] transition-colors"
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
          <div className="absolute right-0 top-full mt-2 w-[340px] bg-white border border-[#E4E6EE] rounded-xl shadow-2xl z-50 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#E4E6EE]">
              <span className="text-[#1A1D2E] font-semibold text-sm">
                Notifications {unread > 0 && <span className="ml-1 bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">{unread}</span>}
              </span>
              {unread > 0 && (
                <button onClick={markAllRead} className="text-xs text-[#3B6FE0] hover:underline">
                  Mark all read
                </button>
              )}
            </div>

            <div className="max-h-[460px] overflow-y-auto divide-y divide-[#F1F3F9]">
              {notifs.length === 0 ? (
                <div className="px-4 py-10 text-center text-[#8A9FC0] text-sm">No notifications yet</div>
              ) : notifs.map(n => (
                <div key={n.id} className={`${!n.is_read ? 'bg-blue-50/40' : ''}`}>
                  <button
                    onClick={() => clickNotif(n)}
                    className="w-full text-left px-4 py-3 hover:bg-[#F7F8FA] transition-colors"
                  >
                    <div className="flex items-start gap-2.5">
                      {!n.is_read && <span className="w-2 h-2 rounded-full bg-[#3B6FE0] mt-1.5 shrink-0" />}
                      <div className={`flex-1 min-w-0 ${n.is_read ? 'pl-4' : ''}`}>
                        <p className="text-xs font-semibold text-[#0F1C2E]">
                          <span className="text-[#3B6FE0]">{n.sender_email.split('@')[0]}</span>
                          {' mentioned you in '}
                          <span className="text-[#0F1C2E]">{n.page}</span>
                        </p>
                        <p className="text-xs text-[#5A6E8A] mt-0.5 line-clamp-2 leading-relaxed">{n.message}</p>
                        <p className="text-[10px] text-[#8A9FC0] mt-1">{timeAgo(n.created_at)}</p>
                      </div>
                    </div>
                  </button>

                  {actionNotifId === n.id && (
                    <div className="px-4 pb-3 flex gap-2">
                      <button
                        onClick={() => goToContext(n)}
                        className="flex-1 text-xs py-1.5 bg-[#F1F4F9] hover:bg-[#E4E9F5] text-[#0F1C2E] font-semibold rounded-lg transition-colors"
                      >
                        View
                      </button>
                      <button
                        onClick={() => addToReminders(n)}
                        className="flex-1 text-xs py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 font-semibold rounded-lg transition-colors"
                      >
                        + Reminder
                      </button>
                      <button
                        onClick={() => addToTasks(n)}
                        className="flex-1 text-xs py-1.5 bg-blue-50 hover:bg-blue-100 text-[#3B6FE0] font-semibold rounded-lg transition-colors"
                      >
                        + Task
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="px-4 py-2.5 border-t border-[#E4E6EE] bg-[#F7F8FA]">
              <p className="text-[10px] text-[#8A9FC0] text-center">
                Tap a notification to see actions
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
