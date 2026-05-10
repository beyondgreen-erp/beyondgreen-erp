'use client'
import { usePathname } from 'next/navigation'
import Sidebar from './Sidebar'
import BERG from './BERG'
import PresenceTracker from './PresenceTracker'
import NotificationBell from './NotificationBell'
import Chat from './Chat'
import MobileNav from './MobileNav'
import InstallPrompt from './InstallPrompt'

export default function ClientShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  if (pathname === '/login') return <>{children}</>

  return (
    <>
      <InstallPrompt />
      <div className="flex min-h-screen">
        <div className="hidden md:flex">
          <Sidebar />
        </div>
        <div className="flex-1 flex flex-col overflow-hidden">
          <header className="shrink-0 bg-gray-950 border-b border-gray-800" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
            <div className="h-12 flex items-center justify-end px-5 gap-2">
              <NotificationBell />
            </div>
          </header>
          <main className="flex-1 overflow-auto bg-gray-950 pb-[max(64px,calc(56px+env(safe-area-inset-bottom)))] md:pb-0">
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
    </>
  )
}
