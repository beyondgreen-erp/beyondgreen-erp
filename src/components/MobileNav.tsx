'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

export default function MobileNav() {
  const pathname = usePathname()
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    const iv = setInterval(() => {
      setUnread((window as Window & { __chatUnread?: number }).__chatUnread ?? 0)
    }, 1000)
    return () => clearInterval(iv)
  }, [])

  function openChat() {
    ;(window as Window & { __openChat?: () => void }).__openChat?.()
  }
  function openBERG() {
    ;(window as Window & { __openBERG?: () => void }).__openBERG?.()
  }

  const isActive = (path: string) =>
    path === '/' ? pathname === '/' : pathname.startsWith(path)

  const activeColor = '#1D9E75'
  const inactiveColor = '#444'

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around"
      style={{
        height: 'calc(56px + env(safe-area-inset-bottom))',
        background: '#0d0d0d',
        borderTop: '0.5px solid #1e1e1e',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* Home */}
      <Link href="/" className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
          style={{ color: isActive('/') ? activeColor : inactiveColor }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
        <span className="text-[9px] font-medium" style={{ color: isActive('/') ? activeColor : inactiveColor }}>Home</span>
      </Link>

      {/* Sales */}
      <Link href="/sales/orders" className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
          style={{ color: isActive('/sales') ? activeColor : inactiveColor }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
        <span className="text-[9px] font-medium" style={{ color: isActive('/sales') ? activeColor : inactiveColor }}>Sales</span>
      </Link>

      {/* Production */}
      <Link href="/production" className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
          style={{ color: isActive('/production') ? activeColor : inactiveColor }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span className="text-[9px] font-medium" style={{ color: isActive('/production') ? activeColor : inactiveColor }}>Production</span>
      </Link>

      {/* Chat */}
      <button onClick={openChat} className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full relative">
        <div className="relative">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
            style={{ color: inactiveColor }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </div>
        <span className="text-[9px] font-medium" style={{ color: inactiveColor }}>Chat</span>
      </button>

      {/* BERG */}
      <button onClick={openBERG} className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full">
        <div className="w-7 h-7 rounded-full flex items-center justify-center"
          style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)' }}>
          <span className="font-black text-xs" style={{ color: activeColor, fontFamily: 'monospace' }}>B</span>
        </div>
        <span className="text-[9px] font-medium" style={{ color: inactiveColor }}>BERG</span>
      </button>
    </nav>
  )
}
