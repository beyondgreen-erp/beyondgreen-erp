'use client'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import Sidebar from './Sidebar'
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
  '/sales/inventory': 'Products',
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
  const [avatarColor, setAvatarColor] = useState('#3B6FE0')

  // Auto-reload when a new service worker takes over, so stale cached JS never persists
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    // Unregister all old SWs immediately
    navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()))
    // If a new SW takes control mid-session, reload to get fresh bundles
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload())
  }, [])

  useEffect(() => {
    if (pathname === '/login') return
    const sb = createSupabaseBrowserClient()
    sb.auth.getUser().then(({ data }) => {
      const email = data.user?.email ?? ''
      if (!email) return
      setUserInitials(email[0].toUpperCase())
      setUserName(email.split('@')[0])
      sb.from('user_profiles').select('full_name,avatar_color,avatar_initials').eq('email', email).single()
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
      <div className="flex min-h-screen" style={{ background: '#F5F6FA' }}>
        {/* Sidebar renders itself as fixed + spacer */}
        <Sidebar />

        {/* Main area */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Top bar */}
          <header
            className="shrink-0 sticky top-0 z-30"
            style={{ background: '#FFFFFF', borderBottom: '1px solid #E4E6EE', paddingTop: 'env(safe-area-inset-top)' }}
          >
            <div className="flex items-center justify-between px-6 gap-4" style={{ height: 64 }}>
              <h1 className="font-bold text-lg truncate" style={{ color: '#1A1D2E' }}>{pageTitle}</h1>
              <div className="flex items-center gap-2 shrink-0">
                <NotificationBell />
                <button
                  onClick={() => router.push('/settings')}
                  className="w-10 h-10 rounded-xl flex items-center justify-center transition-colors"
                  style={{ background: '#F5F6FA', color: '#6B7280', border: '1px solid #E4E6EE' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#E4E6EE'; (e.currentTarget as HTMLElement).style.color = '#1A1D2E' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#F5F6FA'; (e.currentTarget as HTMLElement).style.color = '#6B7280' }}
                  title="Settings"
                >
                  <i className="ti ti-settings text-base"/>
                </button>
                <button
                  onClick={() => router.push('/settings/profile')}
                  className="flex items-center gap-2.5 rounded-xl px-3 py-2 transition-colors"
                  style={{ background: '#F5F6FA', border: '1px solid #E4E6EE' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#E4E6EE' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#F5F6FA' }}
                >
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ backgroundColor: avatarColor }}>{userInitials}</div>
                  {userName && <span className="text-sm font-semibold hidden sm:block" style={{ color: '#374151' }}>{userName}</span>}
                </button>
              </div>
            </div>
          </header>

          {/* Content */}
          <main className="flex-1 overflow-auto pb-[max(64px,calc(56px+env(safe-area-inset-bottom)))] md:pb-0" style={{ background: '#F5F6FA' }}>
            {children}
          </main>
        </div>
      </div>

      <Chat />
      <PresenceTracker />
      <div className="md:hidden">
        <MobileNav />
      </div>
    </ToastProvider>
  )
}
