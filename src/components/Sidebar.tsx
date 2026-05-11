'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { ChatTrigger } from './Chat'

interface UserProfile { full_name: string; role: string; avatar_color: string; avatar_initials: string | null }

const NAV = [
  {
    group: 'OVERVIEW',
    items: [{ label: 'Dashboard', href: '/', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' }],
  },
  {
    group: 'SALES',
    items: [
      { label: 'Customers', href: '/sales/customers', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
      { label: 'Quotations', href: '/sales/quotations', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
      { label: 'Sales Orders', href: '/sales/orders', icon: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z' },
      { label: 'Purchase Orders', href: '/sales/purchase-orders', icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4' },
      { label: 'Invoices', href: '/sales/invoices', icon: 'M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z' },
      { label: 'Vendors', href: '/sales/vendors', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
    ],
  },
  {
    group: 'OPERATIONS',
    items: [
      { label: 'Inventory', href: '/sales/inventory', icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4' },
      { label: 'Production', href: '/production', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z' },
      { label: 'Quality Control', href: '/production/qc', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
      { label: 'Shipping Queue', href: '/sales/shipping-queue', icon: 'M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0' },
      { label: 'Shipments', href: '/sales/shipments', icon: 'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z' },
    ],
  },
  {
    group: 'BUSINESS',
    items: [
      { label: 'Tasks', href: '/bizdev/tasks', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01' },
      { label: 'Certifications', href: '/bizdev/certifications', icon: 'M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z' },
      { label: 'Documents', href: '/bizdev/documents', icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z' },
    ],
  },
  {
    group: 'INTELLIGENCE',
    items: [
      { label: 'BERG AI', href: '/settings/berg-brain', icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2' },
      { label: 'Alerts', href: '/settings/berg-alerts', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' },
    ],
  },
  {
    group: 'SETTINGS',
    items: [
      { label: 'Settings', href: '/settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z' },
    ],
  },
]

function NavIcon({ d }: { d: string }) {
  return (
    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      {d.includes('M15 11') ? (
        <>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </>
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={d} />
      )}
    </svg>
  )
}

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    supabase.auth.getUser().then(({ data }) => {
      const email = data.user?.email ?? null
      setUserEmail(email)
      if (email) {
        supabase.from('user_profiles').select('full_name,role,avatar_color,avatar_initials').eq('email', email).single()
          .then(({ data: pData }) => { if (pData) setUserProfile(pData as UserProfile) })
      }
    })
  }, [])

  async function handleLogout() {
    setLoggingOut(true)
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const isActive = (href: string) => href === '/' ? pathname === '/' : pathname.startsWith(href)

  const initials = userProfile?.avatar_initials ?? (userEmail ? userEmail[0].toUpperCase() : '?')
  const avatarColor = userProfile?.avatar_color ?? '#00C896'

  if (collapsed) {
    return (
      <aside className="w-14 min-h-screen bg-[#111113] border-r border-[#2A2A35] flex flex-col items-center py-4 gap-1">
        <Link href="/" className="w-8 h-8 rounded-lg bg-[#00C896] flex items-center justify-center mb-4 shrink-0">
          <span className="text-black font-bold text-xs">bG</span>
        </Link>
        {NAV.flatMap(s => s.items).map(item => (
          <Link
            key={item.href}
            href={item.href}
            title={item.label}
            className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
              isActive(item.href)
                ? 'bg-[#00C89620] text-[#00C896]'
                : 'text-[#5A5A6A] hover:text-white hover:bg-[#18181C]'
            }`}
          >
            <NavIcon d={item.icon} />
          </Link>
        ))}
        <div className="mt-auto flex flex-col items-center gap-3">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-black text-xs font-bold cursor-pointer"
            style={{ backgroundColor: avatarColor }}
            title={userProfile?.full_name ?? userEmail ?? ''}
          >
            {initials}
          </div>
          <button
            onClick={() => setCollapsed(false)}
            className="w-8 h-8 rounded-lg bg-[#18181C] border border-[#2A2A35] flex items-center justify-center text-[#5A5A6A] hover:text-white transition-colors"
            title="Expand sidebar"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </aside>
    )
  }

  return (
    <aside className="w-60 min-h-screen bg-[#111113] border-r border-[#2A2A35] flex flex-col">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-[#2A2A35] flex items-center justify-between shrink-0">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-[#00C896] flex items-center justify-center brand-glow shrink-0">
            <span className="text-black font-bold text-xs tracking-tight">bG</span>
          </div>
          <div>
            <p className="text-white font-bold text-sm leading-none tracking-tight">
              beyond<span className="text-[#00C896]">GREEN</span>
            </p>
            <p className="text-[#5A5A6A] text-[10px] mt-0.5 tracking-wider">ERP PLATFORM v2.0</p>
          </div>
        </Link>
        <button
          onClick={() => setCollapsed(true)}
          className="w-6 h-6 rounded-lg flex items-center justify-center text-[#3A3A4A] hover:text-[#9898A8] hover:bg-[#18181C] transition-colors"
          title="Collapse sidebar"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
        {NAV.map(section => (
          <div key={section.group}>
            <p className="text-[10px] font-semibold tracking-[0.12em] text-[#3A3A4A] px-3 mb-1.5 uppercase">{section.group}</p>
            <ul className="space-y-0.5">
              {section.items.map(item => {
                const active = isActive(item.href)
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all relative ${
                        active
                          ? 'bg-[#00C89612] text-white'
                          : 'text-[#9898A8] hover:text-white hover:bg-[#18181C]'
                      }`}
                    >
                      {active && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-[#00C896] rounded-r-full" />
                      )}
                      <span className={active ? 'text-[#00C896]' : 'text-[#5A5A6A]'}>
                        <NavIcon d={item.icon} />
                      </span>
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Chat */}
      <div className="px-2 pb-2 shrink-0">
        <ChatTrigger />
      </div>

      {/* User footer */}
      <div className="px-3 py-3 border-t border-[#2A2A35] shrink-0">
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-[#18181C] transition-colors cursor-pointer" onClick={() => router.push('/settings/profile')}>
          <div className="relative shrink-0">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-black text-xs font-bold"
              style={{ backgroundColor: avatarColor }}
            >
              {initials}
            </div>
            <span className="absolute bottom-0 right-0 w-2 h-2 bg-[#00C896] rounded-full border-2 border-[#111113]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-white text-xs font-semibold truncate leading-none">{userProfile?.full_name ?? userEmail?.split('@')[0] ?? '—'}</p>
            <p className="text-[#5A5A6A] text-[10px] mt-0.5 truncate">{userProfile?.role ?? 'User'}</p>
          </div>
          <button
            onClick={e => { e.stopPropagation(); handleLogout() }}
            disabled={loggingOut}
            className="p-1 rounded-lg text-[#3A3A4A] hover:text-[#9898A8] hover:bg-[#2A2A35] transition-colors disabled:opacity-50"
            title="Sign out"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  )
}
