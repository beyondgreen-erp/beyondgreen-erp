'use client'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import Sidebar from './Sidebar'
import BERG from './BERG'
import PresenceTracker from './PresenceTracker'
import NotificationBell from './NotificationBell'
import Chat from './Chat'
import MobileNav from './MobileNav'
import InstallPrompt from './InstallPrompt'
import { ToastProvider } from './Toast'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import AuthWatcher from './AuthWatcher'

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/sales/customers': 'Customers',
  '/sales/quotations': 'Quotations',
  '/sales/costing': 'Quick Quote',
  '/sales/orders': 'Sales Orders',
  '/sales/purchase-orders': 'Purchase Orders',
  '/sales/invoices': 'Invoices',
  '/sales/vendors': 'Vendors',
  '/sales/inventory': 'Inventory',
  '/sales/shipments': 'Shipments',
  '/sales/shipping-queue': 'Shipping Queue',
  '/production': 'Work Orders',
  '/production/qc': 'Quality Control',
  '/production/lots': 'Lot Tracking',
  '/production/capacity-plan': 'Capacity Plan',
  '/production/daily-plan': 'Daily Plan',
  '/production/overview': 'Production Overview',
  '/production/machine-status': 'Machine Status',
  '/imports': 'Import Tracker',
  '/walmart': 'Walmart Portal',
  '/bizdev/tasks': 'Tasks',
  '/bizdev/forecasting': 'Forecasting',
  '/bizdev/certifications': 'Certifications',
  '/bizdev/documents': 'Documents',
  '/settings': 'Settings',
  '/settings/profile': 'My Profile',
  '/settings/team': 'Team',
  '/settings/users': 'Users',
  '/settings/company': 'Company',
  '/settings/notifications': 'Notifications',
  '/settings/berg-brain': 'BERG AI',
  '/settings/berg-alerts': 'Alerts',
}

function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname]
  for (const [key, val] of Object.entries(PAGE_TITLES)) {
    if (pathname.startsWith(key) && key !== '/') return val
  }
  return 'beyondGREEN ERP'
}

export default function ClientShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [userInitials, setUserInitials] = useState('?')
  const [userName, setUserName] = useState('')
  const [avatarColor, setAvatarColor] = useState('#00C896')

  useEffect(() => {
    if (pathname === '/login') return
    const sb = createSupabaseBrowserClient()
    sb.auth.getUser().then(({ data }) => {
      const email = data.user?.email ?? ''
      if (!email) return
      setUserInitials(email[0].toUpperCase())
      setUserName(email.split('@')[0])
      sb.from('user_profiles')
        .select('full_name, avatar_color, avatar_initials')
        .eq('email', email)
        .single()
        .then(({ data: p }) => {
          if (p) {
            if (p.avatar_initials) setUserInitials(p.avatar_initials)
            else if (p.full_name) setUserInitials(p.full_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase())
            if (p.avatar_color) setAvatarColor(p.avatar_color)
            if (p.full_name) setUserName(p.full_name.split(' ')[0])
          }
        })
    })
  }, [pathname])

  if (pathname === '/login') return <>{children}<AuthWatcher /></>

  const pageTitle = getPageTitle(pathname)

  return (
    <ToastProvider>
      <AuthWatcher />
      <InstallPrompt />
      <div className="flex min-h-screen bg-[#0A0A0B]">
        {/* Sidebar */}
        <div className="hidden md:flex shrink-0">
          <Sidebar />
        </div>

        {/* Main */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Top bar */}
          <header
            className="shrink-0 bg-[#0A0A0B]/90 backdrop-blur-xl border-b border-[#1E1E24] sticky top-0 z-30"
            style={{ paddingTop: 'env(safe-area-inset-top)' }}
          >
            <div className="h-14 flex items-center justify-between px-6 gap-4">
              {/* Page title */}
              <div className="flex items-center gap-2 min-w-0">
                <h1 className="text-white font-semibold text-sm truncate">{pageTitle}</h1>
              </div>

              {/* Right controls */}
              <div className="flex items-center gap-2 shrink-0">
                <NotificationBell />

                <button
                  onClick={() => router.push('/settings')}
                  className="w-9 h-9 rounded-xl bg-[#111113] border border-[#1E1E24] flex items-center justify-center text-gray-500 hover:text-white hover:border-[#2A2A35] transition-colors"
                  title="Settings"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                  </svg>
                </button>

                {/* User pill */}
                <button
                  onClick={() => router.push('/settings/profile')}
                  className="flex items-center gap-2 bg-[#111113] border border-[#1E1E24] hover:border-[#2A2A35] rounded-xl px-3 py-1.5 transition-colors"
                >
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                    style={{ backgroundColor: avatarColor }}
                  >
                    {userInitials}
                  </div>
                  {userName && (
                    <span className="text-gray-300 text-xs font-medium hidden sm:block">{userName}</span>
                  )}
                </button>
              </div>
            </div>
          </header>

          {/* Content */}
          <main className="flex-1 overflow-auto bg-[#0A0A0B] pb-[max(64px,calc(56px+env(safe-area-inset-bottom)))] md:pb-0">
            {children}
          </main>
        </div>
      </div>

      <BERG />
      <Chat />
      <PresenceTracker />
      <div className="md:hidden">
        <MobileNav />
      </div>
    </ToastProvider>
  )
}
