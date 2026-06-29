'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { ChatTrigger } from './Chat'

interface NavItem { href: string; label: string; icon: string; badgeKey?: string }
interface NavSection { label: string; items: NavItem[] }

const NAV: NavSection[] = [
{ label: 'Overview', items: [
{ href: '/', label: 'Dashboard', icon: 'ti-layout-dashboard' },
]},
{ label: 'CRM', items: [
{ href: '/sales/customers', label: 'Customers', icon: 'ti-users' },
{ href: '/operations/samples', label: 'Sample Submissions', icon: 'ti-flask' },
]},
{ label: 'Sales', items: [
{ href: '/sales/quotations', label: 'Quotations', icon: 'ti-file-invoice' },
{ href: '/sales/costing', label: 'Quote Costing', icon: 'ti-calculator' },
{ href: '/sales/orders', label: 'Sales Orders', icon: 'ti-shopping-cart' },
{ href: '/production/shipping-queue', label: 'Shipping Queue', icon: 'ti-truck', badgeKey: 'shippingQueue' },
{ href: '/shipments', label: 'Shipments', icon: 'ti-package-export' },
{ href: '/operations/fba', label: 'FBA / WFS', icon: 'ti-brand-amazon' },
]},
{ label: 'Production', items: [
{ href: '/production/reports', label: 'Production Reports', icon: 'ti-chart-line' },
{ href: '/production/daily-plan', label: 'Daily Plan', icon: 'ti-calendar-week' },
{ href: '/production/work-orders', label: 'Work Orders', icon: 'ti-tool', badgeKey: 'workOrders' },
{ href: '/production/quality-control', label: 'Quality Control', icon: 'ti-checkup-list' },
{ href: '/production/lots', label: 'Lot Codes', icon: 'ti-barcode' },
{ href: '/production/machine-status', label: 'Machine Status', icon: 'ti-settings-cog' },
{ href: '/production/capacity-plan', label: 'Capacity Plan', icon: 'ti-chart-bar' },
]},
{ label: 'Inventory', items: [
{ href: '/sales/inventory', label: 'Products & Inventory', icon: 'ti-box' },
{ href: '/operations/private-label-stock', label: 'Warehouse Stock', icon: 'ti-tag' },
{ href: '/imports', label: 'Import Tracker', icon: 'ti-ship' },
{ href: '/sales/purchase-orders', label: 'Purchase Order Request', icon: 'ti-clipboard-list' },
]},
{ label: 'Business', items: [
{ href: '/bizdev/tasks', label: 'Tasks', icon: 'ti-checkbox' },
{ href: '/bizdev/certifications', label: 'Certifications', icon: 'ti-rosette' },
{ href: '/bizdev/documents', label: 'Documents & Knowledge', icon: 'ti-folder' },
{ href: '/bizdev/business-reports', label: 'Business Reports', icon: 'ti-report-analytics' },
{ href: '/bizdev/university', label: 'beyondGREEN University', icon: 'ti-school' },
{ href: '/beyondworld', label: 'beyondWorld', icon: 'ti-device-gamepad-2' },
{ href: '/settings', label: 'Settings', icon: 'ti-settings' },
]},
{ label: 'Finance', items: [
{ href: '/sales/vendors', label: 'Vendors', icon: 'ti-building-store' },
{ href: '/sales/invoices', label: 'Invoices', icon: 'ti-receipt', badgeKey: 'invoices' },
]},
]

interface Badges { workOrders: number; shippingQueue: number; invoices: number }

export default function Sidebar() {
const pathname = usePathname()
const [collapsed, setCollapsed] = useState(false)
const [userEmail, setUserEmail] = useState('')
const [fullName, setFullName] = useState('')
const [avatarColor, setAvatarColor] = useState('#3B6FE0')
const [badges, setBadges] = useState<Badges>({ workOrders: 0, shippingQueue: 0, invoices: 0 })
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

useEffect(() => {
async function loadBadges() {
const today = new Date().toISOString().split('T')[0]
const [wo, sq, inv] = await Promise.all([
sb.from('work_orders').select('id', { count: 'exact', head: true }).eq('status', 'Queued'),
sb.from('shipping_queue').select('id', { count: 'exact', head: true }).eq('status', 'Pending'),
sb.from('invoices').select('id', { count: 'exact', head: true }).neq('status', 'paid').neq('status', 'void').lt('due_date', today),
])
setBadges({
workOrders: wo.count ?? 0,
shippingQueue: sq.count ?? 0,
invoices: inv.count ?? 0,
})
}
loadBadges()
}, [pathname, sb])

const displayName = fullName || userEmail.split('@')[0].replace(/\./g, ' ').replace(/\b\w/g, c => c.toUpperCase())
const initials = displayName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() || 'U'
const isActive = (href: string) => href === '/' ? pathname === '/' : pathname.startsWith(href)

if (pathname === '/login') return null

const W = collapsed ? 68 : 264

return (
<>
<aside
className="fixed top-0 left-0 h-full z-40 flex flex-col transition-all duration-300 overflow-hidden hidden md:flex"
style={{ width: W, background: '#1A2035', borderRight: '1px solid rgba(255,255,255,0.07)' }}
>
<div
className="flex items-center gap-3 px-4 shrink-0"
style={{ height: 64, borderBottom: '1px solid rgba(255,255,255,0.07)' }}
>
<div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: '#3B6FE0' }}>
<span className="text-white font-bold text-base">bG</span>
</div>
{!collapsed && (
<div className="min-w-0 flex-1">
<p className="text-white font-bold text-base leading-tight truncate">beyondGREEN</p>
<p className="text-xs truncate" style={{ color: '#6B7E9F' }}>ERP Platform</p>
</div>
)}
<button
onClick={() => setCollapsed(!collapsed)}
className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
style={{ color: 'rgba(255,255,255,0.3)' }}
onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.8)'; (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.3)'; (e.currentTarget as HTMLElement).style.background = 'transparent' }}
>
<i className={`ti ${collapsed ? 'ti-chevron-right' : 'ti-chevron-left'} text-sm`}/>
</button>
</div>

<nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
{NAV.map((section, si) => (
<div key={section.label} className={si > 0 ? 'mt-4' : ''}>
{!collapsed && (
<p className="text-xs font-semibold px-2 mb-1.5 select-none" style={{ color: '#4D6080', letterSpacing: '0.05em' }}>
{section.label}
</p>
)}
{collapsed && si > 0 && (
<div className="mx-2 mb-2" style={{ height: 1, background: 'rgba(255,255,255,0.06)' }}/>
)}
{section.items.map(item => {
const active = isActive(item.href)
const badgeCount = item.badgeKey ? badges[item.badgeKey as keyof Badges] : 0
const badgeColor = item.badgeKey === 'workOrders'
? { bg: '#FDE68A', text: '#92400E' }
: item.badgeKey === 'invoices'
? { bg: '#FECACA', text: '#991B1B' }
: { bg: '#BFDBFE', text: '#1E40AF' }
return (
<Link
key={item.href}
href={item.href}
title={collapsed ? item.label : undefined}
className="flex items-center gap-3 px-3 py-2.5 rounded-xl mb-0.5 relative transition-all group"
style={{ background: active ? 'rgba(59,111,224,0.18)' : 'transparent', color: active ? '#FFFFFF' : '#8A9FC0' }}
onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLElement).style.color = '#C8D5E8' } }}
onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#8A9FC0' } }}
>
{active && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full" style={{ background: '#3B6FE0' }}/>}
<i className={`ti ${item.icon} text-lg shrink-0`} style={{ width: 22, textAlign: 'center' }}/>
{!collapsed && <span className="flex-1 text-sm font-medium truncate">{item.label}</span>}
{!collapsed && badgeCount > 0 && (
<span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0" style={{ background: badgeColor.bg, color: badgeColor.text }}>{badgeCount}</span>
)}
{collapsed && badgeCount > 0 && <span className="absolute top-1 right-1 w-2 h-2 rounded-full" style={{ background: badgeColor.bg }}/>}
</Link>
)
})}
</div>
))}
<div className="mt-4 px-0"><ChatTrigger /></div>
</nav>

<div className="shrink-0 p-3" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
{!collapsed ? (
<div className="rounded-xl p-3 mb-2" style={{ background: 'rgba(255,255,255,0.05)' }}>
<div className="flex items-center gap-3">
<div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-sm font-bold text-white" style={{ background: avatarColor }}>{initials}</div>
<div className="flex-1 min-w-0">
<p className="text-sm font-semibold text-white truncate">{displayName}</p>
<p className="text-xs truncate" style={{ color: '#5A6E8A' }}>{userEmail}</p>
</div>
</div>
</div>
) : (
<div className="w-9 h-9 rounded-full flex items-center justify-center mx-auto mb-2 text-sm font-bold text-white" style={{ background: avatarColor }}>{initials}</div>
)}
<button
onClick={async () => { await sb.auth.signOut(); window.location.href = '/login' }}
className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium transition-all"
style={{ color: '#5A6E8A' }}
onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#EF4444'; (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.1)' }}
onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#5A6E8A'; (e.currentTarget as HTMLElement).style.background = 'transparent' }}
>
<i className="ti ti-logout text-base shrink-0" style={{ width: 22, textAlign: 'center' }}/>
{!collapsed && <span>Sign out</span>}
</button>
</div>
</aside>
<div className="hidden md:block shrink-0 transition-all duration-300" style={{ width: W }}/>
</>
)
}
