'use client'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import Sidebar from './Sidebar'
import TopNav from './TopNav'
import PresenceTracker from './PresenceTracker'
import Chat from './Chat'
import DirectMessages from './DirectMessages'
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
  const [userInitials, setUserInitials] = useState('?')
  const [userName, setUserName] = useState('')
  const [avatarColor, setAvatarColor] = useState('#3B6FE0')
  const [userEmail, setUserEmail] = useState('')

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
      setUserEmail(email)
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
          {/* Sticky top navigation: group dropdowns + global search + user menu */}
          <TopNav
            pageTitle={pageTitle}
            userEmail={userEmail}
            userName={userName}
            userInitials={userInitials}
            avatarColor={avatarColor}
          />

          {/* Content */}
          <main className="flex-1 overflow-auto pb-[max(64px,calc(56px+env(safe-area-inset-bottom)))] md:pb-0" style={{ background: '#F5F6FA' }}>
            {children}
          </main>
        </div>
      </div>

      <Chat />
      <DirectMessages />
      <PresenceTracker />
      <div className="md:hidden">
        <MobileNav />
      </div>
    </ToastProvider>
  )
}
