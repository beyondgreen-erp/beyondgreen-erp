'use client'
import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { ChatTrigger } from './Chat'
import { useBoards, groupBoards, renameBoard, BADGE_BY_KEY, Board } from '@/lib/boards'

interface Badges { workOrders: number; shippingQueue: number; invoices: number }

export default function Sidebar() {
  const pathname = usePathname()
  const { boards } = useBoards()
  const groups = useMemo(() => groupBoards(boards), [boards])

  const [collapsed, setCollapsed] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [avatarColor, setAvatarColor] = useState('#3B6FE0')
  const [badges, setBadges] = useState<Badges>({ workOrders: 0, shippingQueue: 0, invoices: 0 })
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const sb = createSupabaseBrowserClient()

  // collapse state persists + syncs with the TopNav toggle button
  useEffect(() => {
    if (typeof window === 'undefined') return
    setCollapsed(localStorage.getItem('sidebarCollapsed') === '1')
    const toggle = () => setCollapsed(c => { const n = !c; localStorage.setItem('sidebarCollapsed', n ? '1' : '0'); return n })
    window.addEventListener('toggle-sidebar', toggle)
    return () => window.removeEventListener('toggle-sidebar', toggle)
  }, [])
  function setCollapse(v: boolean) { setCollapsed(v); if (typeof window !== 'undefined') localStorage.setItem('sidebarCollapsed', v ? '1' : '0') }

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
      setBadges({ workOrders: wo.count ?? 0, shippingQueue: sq.count ?? 0, invoices: inv.count ?? 0 })
    }
    loadBadges()
  }, [pathname, sb])

  const displayName = fullName || (userEmail ? userEmail.split('@')[0].replace(/\./g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'User')
  const initials = displayName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() || 'U'
  const isActive = (href: string) => href === '/' ? pathname === '/' : pathname.startsWith(href)

  async function commitRename(b: Board) {
    const val = draft.trim()
    setEditingKey(null)
    if (val && val !== b.label) await renameBoard(b.board_key, val)
  }

  if (pathname === '/login') return null
  const W = collapsed ? 68 : 264

  return (
    <>
      <aside className="fixed top-0 left-0 h-full z-40 flex flex-col transition-all duration-300 overflow-hidden hidden md:flex"
        style={{ width: W, background: '#1A2035', borderRight: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="flex items-center gap-2 px-3 shrink-0" style={{ height: 64, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          {!collapsed && (
            <>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: '#3B6FE0' }}>
                <span className="text-white font-bold text-base">bG</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-white font-bold text-base leading-tight truncate">beyondGREEN</p>
                <p className="text-xs truncate" style={{ color: '#6B7E9F' }}>ERP Platform</p>
              </div>
            </>
          )}
          <button onClick={() => setCollapse(!collapsed)}
            className={(collapsed ? 'mx-auto ' : 'ml-auto ') + 'shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-colors'}
            style={{ color: 'rgba(255,255,255,0.55)' }} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.9)'; (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.55)'; (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
            <i className={`ti ${collapsed ? 'ti-menu-2' : 'ti-chevron-left'} text-base`} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
          {groups.map((section, si) => (
            <div key={section.group} className={si > 0 ? 'mt-4' : ''}>
              {!collapsed && (
                <p className="text-xs font-semibold px-2 mb-1.5 select-none" style={{ color: '#4D6080', letterSpacing: '0.05em' }}>{section.group}</p>
              )}
              {collapsed && si > 0 && <div className="mx-2 mb-2" style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />}
              {section.items.map(item => {
                const href = item.href || `/board/${item.board_key}`
                const active = isActive(href)
                const badgeKey = BADGE_BY_KEY[item.board_key]
                const badgeCount = badgeKey ? badges[badgeKey as keyof Badges] : 0
                const badgeColor = badgeKey === 'workOrders' ? { bg: '#FDE68A', text: '#92400E' } : badgeKey === 'invoices' ? { bg: '#FECACA', text: '#991B1B' } : { bg: '#BFDBFE', text: '#1E40AF' }
                if (editingKey === item.board_key && !collapsed) {
                  return (
                    <div key={item.board_key} className="flex items-center gap-2 px-3 py-1.5 mb-0.5">
                      <i className={`ti ${item.icon || 'ti-layout-board'} text-lg shrink-0`} style={{ width: 22, textAlign: 'center', color: '#8A9FC0' }} />
                      <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
                        onBlur={() => commitRename(item)}
                        onKeyDown={e => { if (e.key === 'Enter') commitRename(item); if (e.key === 'Escape') setEditingKey(null) }}
                        className="flex-1 min-w-0 text-sm bg-[#0F1424] text-white rounded px-2 py-1 outline-none border border-[#3B6FE0]" />
                    </div>
                  )
                }
                return (
                  <div key={item.board_key} className="relative group/navrow">
                    <Link href={href} title={collapsed ? item.label : undefined}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl mb-0.5 relative transition-all"
                      style={{ background: active ? 'rgba(59,111,224,0.18)' : 'transparent', color: active ? '#FFFFFF' : '#8A9FC0' }}
                      onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLElement).style.color = '#C8D5E8' } }}
                      onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#8A9FC0' } }}>
                      {active && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full" style={{ background: '#3B6FE0' }} />}
                      <i className={`ti ${item.icon || 'ti-layout-board'} text-lg shrink-0`} style={{ width: 22, textAlign: 'center' }} />
                      {!collapsed && <span className="flex-1 text-sm font-medium truncate">{item.label}</span>}
                      {!collapsed && badgeCount > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0" style={{ background: badgeColor.bg, color: badgeColor.text }}>{badgeCount}</span>}
                      {collapsed && badgeCount > 0 && <span className="absolute top-1 right-1 w-2 h-2 rounded-full" style={{ background: badgeColor.bg }} />}
                    </Link>
                    {!collapsed && (
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditingKey(item.board_key); setDraft(item.label) }}
                        title="Rename"
                        className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md items-center justify-center hidden group-hover/navrow:flex"
                        style={{ color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.08)' }}>
                        <i className="ti ti-pencil text-xs" />
                      </button>
                    )}
                  </div>
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
          <button onClick={async () => { await sb.auth.signOut(); window.location.href = '/login' }}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium transition-all" style={{ color: '#5A6E8A' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#EF4444'; (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.1)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#5A6E8A'; (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
            <i className="ti ti-logout text-base shrink-0" style={{ width: 22, textAlign: 'center' }} />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>
      <div className="hidden md:block shrink-0 transition-all duration-300" style={{ width: W }} />
    </>
  )
}
