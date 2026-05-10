'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { ChatTrigger } from './Chat'

const ADMIN_EMAIL = 'rperrier171991@gmail.com'
interface Presence { email: string; current_page: string | null; last_seen: string; activity_count: number }

const navigation = [
  {
    group: 'PRODUCTION',
    color: 'text-emerald-400',
    items: [
      { label: 'Machine Status', href: '/production/machine-status' },
      { label: 'Daily Plan', href: '/production/daily-plan' },
      { label: 'Production Overview', href: '/production/overview' },
      { label: 'Production', href: '/production' },
      { label: 'Capacity Plan', href: '/production/capacity-plan' },
    ],
  },
  {
    group: 'SALES',
    color: 'text-blue-400',
    items: [
      { label: 'Quotations', href: '/sales/quotations' },
      { label: 'Sales Orders', href: '/sales/orders' },
      { label: 'Customers', href: '/sales/customers' },
      { label: 'Shipping Queue', href: '/sales/shipping-queue' },
      { label: 'Shipments', href: '/sales/shipments' },
      { label: 'Invoices', href: '/sales/invoices' },
      { label: 'Inventory', href: '/sales/inventory' },
      { label: 'Purchase Orders', href: '/sales/purchase-orders' },
      { label: 'Vendors', href: '/sales/vendors' },
    ],
  },
  {
    group: 'BUSINESS DEV',
    color: 'text-violet-400',
    items: [
      { label: 'Task Board', href: '/bizdev/tasks' },
      { label: 'Certifications', href: '/bizdev/certifications' },
      { label: 'Document Pool', href: '/bizdev/documents' },
    ],
  },
  {
    group: 'BERG SETTINGS',
    color: 'text-emerald-300',
    adminOnly: true,
    items: [
      { label: 'BERG Brain', href: '/settings/berg-brain' },
      { label: 'BERG Alerts', href: '/settings/berg-alerts' },
    ],
  },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)
  const [onlineUsers, setOnlineUsers] = useState<Presence[]>([])
  const [topUser, setTopUser] = useState<Presence | null>(null)

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? null)
    })

    function loadPresence() {
      const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString()
      supabase.from('user_presence').select('*').eq('is_online', true).gte('last_seen', cutoff)
        .then(({ data }) => {
          if (data) {
            setOnlineUsers(data as Presence[])
            const top = (data as Presence[]).sort((a, b) => (b.activity_count || 0) - (a.activity_count || 0))[0]
            setTopUser(top ?? null)
          }
        })
    }
    loadPresence()

    const supabase2 = createSupabaseBrowserClient()
    const channel = supabase2.channel('presence_sidebar')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_presence' }, () => loadPresence())
      .subscribe()
    return () => { supabase2.removeChannel(channel) }
  }, [])

  async function handleLogout() {
    setLoggingOut(true)
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="w-64 min-h-screen bg-gray-950 border-r border-gray-800 flex flex-col">
      {/* Header */}
      <div className="px-5 py-5 border-b border-gray-800">
        <Link href="/" className="block">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-emerald-500 flex items-center justify-center">
              <span className="text-white font-bold text-xs">bG</span>
            </div>
            <div>
              <p className="text-white font-semibold text-sm leading-tight">beyondGREEN</p>
              <p className="text-gray-500 text-xs">ERP Platform</p>
            </div>
          </div>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {/* Dashboard link */}
        <Link
          href="/"
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            pathname === '/'
              ? 'bg-gray-800 text-white'
              : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
          Dashboard
        </Link>

        {navigation.filter(s => !('adminOnly' in s && s.adminOnly) || userEmail?.toLowerCase() === ADMIN_EMAIL).map((section) => (
          <div key={section.group}>
            <p className={`text-xs font-semibold tracking-widest px-3 mb-2 ${section.color}`}>
              {section.group}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = pathname === item.href
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                        active
                          ? 'bg-gray-800 text-white font-medium'
                          : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-emerald-400' : 'bg-gray-700'}`} />
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Chat */}
      <div className="px-3 pb-3">
        <ChatTrigger />
      </div>

      {/* Online now */}
      {onlineUsers.length > 0 && (
        <div className="px-4 py-3 border-t border-gray-800">
          <p className="text-xs font-semibold text-gray-600 tracking-widest mb-2">ONLINE NOW</p>
          <div className="space-y-1.5">
            {onlineUsers.slice(0, 5).map(u => (
              <div key={u.email} className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                <span className="text-xs text-gray-500 truncate">{u.email.split('@')[0]}</span>
              </div>
            ))}
          </div>
          {topUser && (
            <div className="mt-2.5 flex items-center gap-1.5">
              <span className="text-xs">🏆</span>
              <span className="text-xs text-gray-600 truncate">{topUser.email.split('@')[0]}</span>
              <span className="text-xs text-gray-700">most active</span>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="px-4 py-4 border-t border-gray-800 space-y-3">
        {/* User info */}
        {userEmail && (
          <div className="flex items-center gap-2.5 px-1">
            <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center shrink-0">
              <span className="text-gray-300 text-xs font-semibold uppercase">
                {userEmail[0]}
              </span>
            </div>
            <p className="text-gray-400 text-xs truncate">{userEmail}</p>
          </div>
        )}

        {/* Logout button */}
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-500 hover:text-white hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          {loggingOut ? 'Signing out…' : 'Sign out'}
        </button>

        <p className="text-xs text-gray-700 px-1">beyondGREEN ERP &copy; 2025</p>
      </div>
    </aside>
  )
}
