'use client'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import TopNav from './TopNav'
import { useBoards } from '@/lib/boards'
import { usePermissions, boardKeyForPath } from '@/lib/permissions'
import { installErrorReporter } from '@/lib/errorReporter'
import PresenceTracker from './PresenceTracker'
import TeamChat, { ChatLauncher } from './TeamChat'
import ChatAlerts from './ChatAlerts'
import MobileNav from './MobileNav'
import InstallPrompt from './InstallPrompt'
import { ToastProvider } from './Toast'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import AuthWatcher from './AuthWatcher'
import UpdateWatcher from './UpdateWatcher'

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/settings/health': 'System Health',
  '/sales/customers': 'Customer/Leads',
  '/sales/quotations': 'Quotations',
  '/sales/costing': 'Quick Quote',
  '/sales/orders': 'Order Pipeline',
  '/sales/purchase-orders': 'Purchase Orders',
  '/sales/invoices': 'Invoices',
  '/sales/vendors': 'Vendors',
  '/sales/inventory': 'Products',
  '/sales/shipments': 'Shipments',
  '/sales/shipping-queue': 'Shipping Queue',
  '/production': 'Work Orders',
  '/production/qc': 'Quality Control',
  '/production/walmart': 'Walmart Production',
  '/production/straw': 'Straw Production',
  '/production/lots': 'Lot Tracking',
  '/production/capacity-plan': 'Capacity Plan',
  '/production/daily-plan': 'Daily Plan',
  '/production/overview': 'Production Overview',
  '/production/machine-status': 'Machine Status',
  '/production/maintenance': 'Maintenance',
  '/production/rates': 'Production Rates',
  '/imports': 'Import Tracker',
  '/packaging': 'Packaging Design',
  '/walmart': 'Walmart Portal',
  '/bizdev/tasks': 'Tickets',
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
  const { boards } = useBoards()
  const perms = usePermissions()
  const boardKey = boardKeyForPath(pathname, boards)
  const noAccess = perms.loaded && !perms.failed && !perms.is_admin && !perms.canView(boardKey)
  const offMode = perms.loaded && !perms.failed ? (perms.access?.mode || 'onsite') : 'onsite'
  const offsiteReadOnly = offMode === 'readonly'
  const readOnly = offsiteReadOnly || (!noAccess && perms.loaded && !perms.failed && !perms.is_admin && !perms.canEdit(boardKey))
  const router = useRouter()
  // Floor accounts that can see exactly one board (e.g. Walmart Production) land on it instead of
  // the office dashboard — fewer taps on a phone.
  useEffect(() => {
    if (pathname !== '/' || !perms.loaded || perms.failed || perms.is_admin) return
    const keys = Object.entries(perms.boards).filter(([k, b]) => b.can_view && k !== '/').map(([k]) => k)
    if (keys.length === 1) router.replace(keys[0])
  }, [pathname, perms, router])
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
    if (pathname === '/login' || pathname.startsWith('/t/') || pathname.startsWith('/w/') || pathname.startsWith('/portal') || pathname.startsWith('/lp/') || pathname.startsWith('/proof') || pathname.startsWith('/rfq/supplier/')) return
    const sb = createSupabaseBrowserClient()
    sb.auth.getUser().then(({ data }) => {
      const email = data.user?.email ?? ''
      if (!email) return
      installErrorReporter()   // screen crashes + refused saves → watchdog (System Health)
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

  if (pathname.startsWith('/t/') || pathname.startsWith('/w/') || pathname.startsWith('/portal') || pathname.startsWith('/lp/') || pathname.startsWith('/proof') || pathname.startsWith('/rfq/supplier/')) return <>{children}</>
  // Packaging Studio editor is a full-screen app of its own
  if (pathname.startsWith('/packaging/')) return <ToastProvider>{children}<AuthWatcher /><PresenceTracker /></ToastProvider>
  if (pathname === '/login') return <>{children}<AuthWatcher /></>

  const pageTitle = getPageTitle(pathname)

  // Off the work network with a restricted account: the database already refuses the data;
  // this is the honest screen that goes with it.
  if (offMode === 'blocked' || offMode === 'chat_only') {
    return (
      <ToastProvider>
        <AuthWatcher />
        <UpdateWatcher />
        <div className="min-h-screen flex flex-col" style={{ background: '#F5F6FA' }}>
          <div className="flex items-center justify-between px-4 sm:px-6 py-3 bg-white border-b border-[#E3E7EE]">
            <div className="flex items-center gap-2"><span className="w-8 h-8 rounded-lg inline-flex items-center justify-center text-white font-bold" style={{ background: '#0F7A4E' }}>bG</span><span className="font-bold text-[#1A1D2E]">beyondGREEN ERP</span></div>
            <div className="flex items-center gap-3 text-sm text-gray-500"><span className="hidden sm:inline">{userName || userEmail}</span><button onClick={async () => { const sb = createSupabaseBrowserClient(); await sb.auth.signOut(); window.location.href = '/login' }} className="font-semibold text-[#0F7A4E]">Sign out</button></div>
          </div>
          <div className="flex-1 p-4 sm:p-6 max-w-5xl w-full mx-auto">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 text-amber-900 px-4 py-3 text-sm flex items-start gap-3 mb-4">
              <span className="text-xl leading-none">🔒</span>
              <div><p className="font-semibold">You&apos;re outside the work network{perms.access?.ip ? ` (${perms.access.ip})` : ''}.</p>
                <p className="mt-0.5">{offMode === 'chat_only' ? 'Boards and records are locked until you are back on the facility WiFi. Team chat stays open so you can reach the floor.' : 'This account can only use the ERP from the facility WiFi. Connect to it and reload, or ask an Admin to change your off-site access.'}</p></div>
            </div>
            {offMode === 'chat_only' && <TeamChat mode="embedded" height="calc(100vh - 190px)" />}
          </div>
        </div>
      </ToastProvider>
    )
  }

  return (
    <ToastProvider>
      <AuthWatcher />
      <UpdateWatcher />
      <InstallPrompt />
      <div className="flex h-screen" style={{ background: '#F5F6FA' }}>
        {/* Top-nav-only layout (sidebar removed) */}
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
          {readOnly && (
            <div className="px-3 sm:px-[5%] lg:px-[10%] pt-3">
              <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-sm px-4 py-2.5 flex items-center gap-2">
                {offsiteReadOnly
                  ? <><span className="font-semibold">View only — you&apos;re outside the work network.</span> Changes unlock when you&apos;re back on the facility WiFi.</>
                  : <><span className="font-semibold">View only.</span> You can look at this board but not change it. Ask an Admin for edit access.</>}
              </div>
            </div>
          )}
          {readOnly && <style>{`main[data-readonly] button:not([data-ro-ok]), main[data-readonly] select, main[data-readonly] textarea, main[data-readonly] [contenteditable], main[data-readonly] input:not([type="search"]):not([placeholder*="earch"]):not([placeholder*="ilter"]) { pointer-events: none !important; opacity: .55; }`}</style>}
          <main data-readonly={readOnly ? '' : undefined} className="flex-1 overflow-auto px-3 sm:px-[5%] lg:px-[10%] pb-[max(64px,calc(56px+env(safe-area-inset-bottom)))] md:pb-0" style={{ background: '#F5F6FA' }}>
            {noAccess ? (
              <div className="max-w-lg mx-auto mt-24 text-center rounded-2xl border border-[#E3E7EE] bg-white p-10">
                <div className="text-4xl mb-3">🔒</div>
                <h2 className="text-lg font-bold text-[#1A1D2E]">You don&apos;t have access to this board</h2>
                <p className="text-sm text-gray-500 mt-2">An Admin can grant you View or Edit access under Settings → Users.</p>
                <a href="/" className="inline-block mt-6 text-sm font-semibold text-[#0F7A4E] hover:underline">Back to Dashboard</a>
              </div>
            ) : children}
          </main>
        </div>
      </div>

      <ChatLauncher />
      <ChatAlerts />
      <PresenceTracker />
      <div className="md:hidden">
        <MobileNav />
      </div>
    </ToastProvider>
  )
}
