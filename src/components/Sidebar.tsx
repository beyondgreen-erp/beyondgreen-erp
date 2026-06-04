'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { ChatTrigger } from './Chat'

interface NavItem { href: string; label: string; icon: string }
interface NavSection { label: string; items: NavItem[] }

const NAV: NavSection[] = [
  { label: 'OVERVIEW', items: [
    { href: '/', label: 'Dashboard', icon: 'ti-layout-dashboard' },
  ]},
  { label: 'SALES', items: [
    { href: '/sales/customers', label: 'Customers', icon: 'ti-users' },
    { href: '/sales/quotations', label: 'Quotations', icon: 'ti-file-invoice' },
    { href: '/sales/costing', label: 'Quick Quote', icon: 'ti-calculator' },
    { href: '/sales/orders', label: 'Sales Orders', icon: 'ti-shopping-cart' },
    { href: '/sales/invoices', label: 'Invoices', icon: 'ti-receipt' },
  ]},
  { label: 'FULFILLMENT', items: [
    { href: '/sales/shipping-queue', label: 'Shipping Queue', icon: 'ti-truck' },
    { href: '/sales/shipments', label: 'Shipments', icon: 'ti-package-export' },
  ]},
  { label: 'INVENTORY', items: [
    { href: '/sales/inventory', label: 'Products', icon: 'ti-box' },
    { href: '/imports', label: 'Import Tracker', icon: 'ti-ship' },
  ]},
  { label: 'PRODUCTION', items: [
    { href: '/production', label: 'Work Orders', icon: 'ti-tool' },
    { href: '/production/qc', label: 'Quality Control', icon: 'ti-checkup-list' },
    { href: '/production/lots', label: 'Lot Codes', icon: 'ti-barcode' },
  ]},
  { label: 'PURCHASING', items: [
    { href: '/sales/purchase-orders', label: 'Purchase Orders', icon: 'ti-clipboard-list' },
    { href: '/sales/vendors', label: 'Vendors', icon: 'ti-building-store' },
  ]},
  { label: 'BUSINESS', items: [
    { href: '/bizdev/tasks', label: 'Tasks', icon: 'ti-checkbox' },
    { href: '/bizdev/forecasting', label: 'Forecasting', icon: 'ti-trending-up' },
    { href: '/bizdev/certifications', label: 'Certifications', icon: 'ti-rosette' },
    { href: '/bizdev/documents', label: 'Documents', icon: 'ti-folder' },
  ]},
  { label: 'WALMART', items: [
    { href: '/walmart', label: 'Walmart Portal', icon: 'ti-building' },
  ]},
  { label: 'INTELLIGENCE', items: [
    { href: '/settings/berg-brain', label: 'BERG AI', icon: 'ti-brain' },
    { href: '/settings/berg-alerts', label: 'Alerts', icon: 'ti-bell' },
  ]},
  { label: 'SYSTEM', items: [
    { href: '/settings', label: 'Settings', icon: 'ti-settings' },
  ]},
]

export default function Sidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [avatarColor, setAvatarColor] = useState('#3B6FE0')
  const sb = createSupabaseBrowserClient()

  useEffect(() => {
    sb.auth.getUser().then(({ data: { user } }) => {
      if (!user?.email) return
      setUserEmail(user.email)
      sb.from('user_profiles').select('full_name,avatar_color').eq('email', user.email).single()
        .then(({ data: p }) => {
          if (p?.full_name) setFullName(p.full_name)
          if (p?.avatar_color) setAvatarColor(p.avatar_color)
        })
    })
  }, [sb])

  const displayName = fullName || userEmail.split('@')[0].replace(/\./g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  const initials = displayName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() || 'U'
  const isActive = (href: string) => href === '/' ? pathname === '/' : pathname.startsWith(href)

  if (pathname === '/login') return null

  const W = collapsed ? 64 : 240

  return (
    <>
      <aside
        className="fixed top-0 left-0 h-full z-40 flex flex-col transition-all duration-300 overflow-hidden hidden md:flex"
        style={{ width: W, background: '#1A2035', borderRight: '1px solid rgba(255,255,255,0.06)' }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#3B6FE0' }}>
            <span className="text-white font-bold text-sm">bG</span>
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="text-white font-semibold text-sm leading-tight truncate">beyondGREEN</p>
              <p className="text-[11px] truncate" style={{ color: '#7B8DB0' }}>ERP Platform</p>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="shrink-0 p-1 rounded transition-colors"
            style={{ color: 'rgba(255,255,255,0.25)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.7)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.25)' }}
          >
            <i className={`ti ${collapsed ? 'ti-chevron-right' : 'ti-chevron-left'} text-sm`}/>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2">
          {NAV.map(section => (
            <div key={section.label} className="mb-1">
              {!collapsed && (
                <p className="text-[10px] font-semibold px-3 py-2 select-none" style={{ color: '#4A5A7A', letterSpacing: '0.08em' }}>
                  {section.label}
                </p>
              )}
              {section.items.map(item => {
                const active = isActive(item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg mb-0.5 relative transition-all"
                    style={{ background: active ? 'rgba(59,111,224,0.15)' : 'transparent', color: active ? '#FFFFFF' : '#8A9BC0' }}
                    onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; (e.currentTarget as HTMLElement).style.color = '#FFFFFF' } }}
                    onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#8A9BC0' } }}
                  >
                    {active && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r" style={{ background: '#3B6FE0' }}/>}
                    <i className={`ti ${item.icon} text-base shrink-0`}/>
                    {!collapsed && <span className="text-sm font-medium truncate">{item.label}</span>}
                  </Link>
                )
              })}
            </div>
          ))}
          <div className="mb-1 px-2">
            <ChatTrigger />
          </div>
        </nav>

        {/* User */}
        <div className="shrink-0 p-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          {!collapsed ? (
            <div className="rounded-lg p-2.5 mb-2" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold text-white" style={{ background: avatarColor }}>
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs font-medium truncate">{displayName}</p>
                  <p className="text-[10px] truncate" style={{ color: '#5A6A8A' }}>{userEmail}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="w-8 h-8 rounded-full flex items-center justify-center mx-auto mb-2 text-xs font-bold text-white" style={{ background: avatarColor }}>
              {initials}
            </div>
          )}
          <button
            onClick={async () => { await sb.auth.signOut(); window.location.href = '/login' }}
            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-colors"
            style={{ color: '#5A6A8A' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#EF4444'; (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.08)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#5A6A8A'; (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >
            <i className="ti ti-logout text-base shrink-0"/>
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>
      <div className="hidden md:block shrink-0 transition-all duration-300" style={{ width: W }}/>
    </>
  )
}
