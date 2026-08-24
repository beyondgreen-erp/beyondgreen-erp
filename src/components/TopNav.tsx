'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { useBoards, groupBoards, Board } from '@/lib/boards'
import NotificationBell from './NotificationBell'
import UserAvatar from './UserAvatar'

interface Props {
  pageTitle: string
  userEmail: string
  userName: string
  userInitials: string
  avatarColor: string
}

interface SearchHit { kind: string; label: string; sub?: string; href: string; icon: string; color: string }

// Groups whose dropdown is locked behind a "undergoing sprints" notice.
const LOCKED_GROUPS = new Set<string>([])

export default function TopNav({ pageTitle, userEmail, userName, userInitials, avatarColor }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const { boards } = useBoards()
  // Dashboard, beyondWORLD and Settings are promoted to dedicated buttons,
  // so drop the "Overview" group and those two items from the dropdown nav.
  const groups = useMemo(() => {
    const PROMOTED = new Set(['/beyondworld', '/settings'])
    return groupBoards(boards)
      .filter(g => g.group !== 'Overview')
      .map(g => ({ ...g, items: g.items.filter(it => !PROMOTED.has(it.href || '')) }))
      .filter(g => g.items.length > 0)
  }, [boards])

  // Header title reflects the current board's (possibly renamed) label.
  const activeTitle = useMemo(() => {
    let best: Board | null = null
    for (const b of boards) {
      const h = b.href || `/board/${b.board_key}`
      if (h === '/' ? pathname === '/' : pathname.startsWith(h)) {
        if (!best || (h.length > (best.href || `/board/${best.board_key}`).length)) best = b
      }
    }
    return best?.label || pageTitle
  }, [boards, pathname, pageTitle])

  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const [sprintNotice, setSprintNotice] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const navRef = useRef<HTMLDivElement>(null)

  // ── close dropdowns on outside click ──
  useEffect(() => {
    const h = (e: MouseEvent) => { if (navRef.current && !navRef.current.contains(e.target as Node)) { setOpenGroup(null); setMenuOpen(false) } }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // ── global search ──
  const [searchOpen, setSearchOpen] = useState(false)
  const [q, setQ] = useState('')
  const [records, setRecords] = useState<SearchHit[]>([])
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true) }
      if (e.key === 'Escape') setSearchOpen(false)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  useEffect(() => { if (searchOpen) setTimeout(() => inputRef.current?.focus(), 40); else { setQ(''); setRecords([]); setActive(0) } }, [searchOpen])

  const boardHits: SearchHit[] = useMemo(() => {
    const term = q.toLowerCase().trim()
    return boards
      .filter(b => !b.is_hidden && b.href && (!term || b.label.toLowerCase().includes(term) || b.nav_group.toLowerCase().includes(term)))
      .slice(0, term ? 8 : 6)
      .map(b => ({ kind: 'Board', label: b.label, sub: b.nav_group, href: b.href as string, icon: b.icon || 'ti-layout-board', color: '#579BFC' }))
  }, [boards, q])

  // best-effort record search across key tables
  const runRecordSearch = useCallback(async (term: string) => {
    if (term.trim().length < 2) { setRecords([]); return }
    const sb = createSupabaseBrowserClient()
    const like = `%${term}%`
    const out: SearchHit[] = []
    const tries: Promise<void>[] = []
    tries.push((async () => { try {
      const { data } = await sb.from('sales_orders').select('id, order_number, customer_name').or(`order_number.ilike.${like},customer_name.ilike.${like}`).limit(5)
      ;(data || []).forEach((r: any) => out.push({ kind: 'Order', label: r.order_number || r.customer_name || 'Order', sub: r.customer_name || '', href: `/sales/orders?item=${r.id}`, icon: 'ti-shopping-cart', color: '#00A84F' }))
    } catch {} })())
    tries.push((async () => { try {
      const { data } = await sb.from('customers').select('id, name').ilike('name', like).limit(5)
      ;(data || []).forEach((r: any) => out.push({ kind: 'Customer', label: r.name || 'Customer', href: `/sales/customers?item=${r.id}`, icon: 'ti-users', color: '#0086C0' }))
    } catch {} })())
    tries.push((async () => { try {
      const { data } = await sb.from('vault_items').select('id, name, group_name').ilike('name', like).limit(5)
      ;(data || []).forEach((r: any) => out.push({ kind: 'Vault', label: r.name || 'Entry', sub: r.group_name || '', href: `/bizdev/vault`, icon: 'ti-lock', color: '#A25DDC' }))
    } catch {} })())
    tries.push((async () => { try {
      const { data } = await sb.from('leads').select('id, name').ilike('name', like).limit(5)
      ;(data || []).forEach((r: any) => out.push({ kind: 'Lead', label: r.name || 'Lead', href: `/sales/leads?item=${r.id}`, icon: 'ti-user-search', color: '#FDAB3D' }))
    } catch {} })())
    await Promise.all(tries)
    setRecords(out)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => runRecordSearch(q), 220)
    return () => clearTimeout(t)
  }, [q, runRecordSearch])

  const allHits = useMemo(() => [...boardHits, ...records], [boardHits, records])
  useEffect(() => { setActive(0) }, [q])

  function go(href: string) { setSearchOpen(false); router.push(href) }
  function onSearchKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, allHits.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const h = allHits[active]; if (h) go(h.href) }
  }

  return (
    <header className="shrink-0 sticky top-0 z-30" style={{ background: '#FFFFFF', borderBottom: '1px solid #E4E6EE', paddingTop: 'env(safe-area-inset-top)' }}>
      <div ref={navRef} className="flex items-center gap-2 px-3 sm:px-5" style={{ height: 64 }}>
        {/* brand logo -> dashboard */}
        <Link href="/" className="flex items-center shrink-0" title="beyondGREEN — Dashboard">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bG-logo-clean.png" alt="beyondGREEN" className="w-auto" style={{ height: 34 }} />
        </Link>

        {/* Dashboard quick button */}
        <Link
          href="/"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors shrink-0"
          style={pathname === '/' ? { color: '#00A84F', background: 'rgba(0,168,79,0.10)', border: '1px solid rgba(0,168,79,0.25)' } : { color: '#3A4056', background: '#F7F8FB', border: '1px solid #E4E6EE' }}
        >
          <i className="ti ti-layout-dashboard text-base" />
          <span className="hidden sm:inline">Dashboard</span>
        </Link>

        {pathname !== '/' && (
          <h1 className="font-bold text-base sm:text-lg truncate shrink-0 max-w-[28vw] md:max-w-none" style={{ color: '#1A1D2E' }}>{activeTitle}</h1>
        )}

        {/* group dropdowns */}
        <nav className="hidden lg:flex items-center gap-0.5 ml-2">
          {groups.map(g => (
            <div key={g.group} className="relative">
              <button
                onClick={() => { if (LOCKED_GROUPS.has(g.group)) { setOpenGroup(null); setSprintNotice(true); return } setOpenGroup(o => o === g.group ? null : g.group) }}
                onMouseEnter={() => { if (LOCKED_GROUPS.has(g.group)) return; if (openGroup) setOpenGroup(g.group) }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors"
                style={{ color: openGroup === g.group ? '#1A1D2E' : '#5A6072', background: openGroup === g.group ? '#F0F1F5' : 'transparent' }}
              >
                {g.group}
                <i className="ti ti-chevron-down text-xs opacity-60" />
              </button>
              {openGroup === g.group && (
                <div className="absolute left-0 top-full mt-1 w-60 bg-white rounded-xl shadow-xl border border-[#E4E6EE] py-1.5 z-50 max-h-[70vh] overflow-y-auto">
                  {g.items.map(it => (
                    <Link
                      key={it.board_key}
                      href={it.href || `/board/${it.board_key}`}
                      onClick={() => setOpenGroup(null)}
                      className="flex items-center gap-2.5 px-3 py-2 text-sm text-[#3A4056] hover:bg-[#F5F6FA]"
                    >
                      <i className={`ti ${it.icon || 'ti-layout-board'} text-base w-5 text-center`} style={{ color: '#8A93A8' }} />
                      <span className="truncate flex-1">{it.label}</span>
                      {it.is_custom && <span className="text-[9px] font-bold text-[#A25DDC]">BOARD</span>}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* right cluster */}
        <div className="flex items-center gap-2 ml-auto shrink-0">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 rounded-lg pl-3 pr-2 py-2 text-sm text-gray-400 border border-[#E4E6EE] bg-[#F7F8FB] hover:bg-[#F0F1F5] min-w-0"
            title="Search (Cmd/Ctrl + K)"
          >
            <i className="ti ti-search text-base" />
            <span className="hidden sm:inline">Search anything…</span>
            <span className="hidden md:inline text-[10px] font-semibold px-1.5 py-0.5 rounded bg-white border border-[#E4E6EE] text-gray-400">⌘K</span>
          </button>
          <NotificationBell />

          {/* promoted quick-access buttons: beyondWORLD + Settings */}
          <Link
            href="/beyondworld"
            title="beyondWORLD"
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium whitespace-nowrap border transition-colors shrink-0"
            style={pathname.startsWith('/beyondworld')
              ? { color: '#00A84F', background: 'rgba(0,168,79,0.10)', borderColor: 'rgba(0,168,79,0.25)' }
              : { color: '#5A6072', background: '#F7F8FB', borderColor: '#E4E6EE' }}
          >
            <i className="ti ti-device-gamepad-2 text-base" />
            <span className="hidden md:inline">beyondWORLD</span>
          </Link>
          <Link
            href="/settings"
            title="Settings"
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium whitespace-nowrap border transition-colors shrink-0"
            style={pathname === '/settings' || pathname.startsWith('/settings/')
              ? { color: '#00A84F', background: 'rgba(0,168,79,0.10)', borderColor: 'rgba(0,168,79,0.25)' }
              : { color: '#5A6072', background: '#F7F8FB', borderColor: '#E4E6EE' }}
          >
            <i className="ti ti-settings text-base" />
            <span className="hidden md:inline">Settings</span>
          </Link>

          <div className="relative">
            <button onClick={() => setMenuOpen(m => !m)} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-[#F0F1F5]">
              <UserAvatar email={userEmail} initials={userInitials} color={avatarColor} size={32} />
              {userName && <span className="text-sm font-semibold hidden sm:block text-[#374151]">{userName}</span>}
              <i className="ti ti-chevron-down text-xs text-gray-400 hidden sm:block" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-xl shadow-xl border border-[#E4E6EE] py-1.5 z-50">
                <Link href="/settings/profile" onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5 px-3 py-2 text-sm text-[#3A4056] hover:bg-[#F5F6FA]"><i className="ti ti-user w-5 text-center text-gray-400" />My Profile</Link>
                <Link href="/settings" onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5 px-3 py-2 text-sm text-[#3A4056] hover:bg-[#F5F6FA]"><i className="ti ti-settings w-5 text-center text-gray-400" />Settings</Link>
                <Link href="/settings/dev-center" onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5 px-3 py-2 text-sm text-[#3A4056] hover:bg-[#F5F6FA]"><i className="ti ti-code w-5 text-center text-[#A25DDC]" />Dev Center</Link>
                <div className="my-1 border-t border-[#F0F1F5]" />
                <button
                  onClick={async () => { const sb = createSupabaseBrowserClient(); await sb.auth.signOut(); window.location.href = '/login' }}
                  className="flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 w-full"
                ><i className="ti ti-logout w-5 text-center" />Sign out</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Global search palette ── */}
      {sprintNotice && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center px-4" style={{ background: 'rgba(20,24,40,0.5)' }} >
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-[#E4E6EE] p-6 text-center" onClick={e => e.stopPropagation()}>
            <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-[#FDAB3D]/15 flex items-center justify-center"><i className="ti ti-tools text-2xl text-[#E39A2B]" /></div>
            <h2 className="text-lg font-bold text-[#1A1D2E]">Undergoing Sprints</h2>
            <p className="text-sm text-[#5A6072] mt-2 leading-relaxed">Sorry, this function of the beyondGREEN ERP is undergoing sprints. Check back later or reach out to the admin team for more information.</p>
            <button onClick={() => setSprintNotice(false)} className="mt-5 w-full rounded-xl bg-[#1A1D2E] text-white text-sm font-semibold py-2.5 hover:bg-[#2A2F45] transition-colors">Got it</button>
          </div>
        </div>
      )}
      {searchOpen && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4" style={{ background: 'rgba(20,24,40,0.45)' }} onClick={() => setSearchOpen(false)}>
          <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-[#E4E6EE] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-4 border-b border-[#F0F1F5]">
              <i className="ti ti-search text-lg text-gray-400" />
              <input
                ref={inputRef}
                value={q}
                onChange={e => setQ(e.target.value)}
                onKeyDown={onSearchKey}
                placeholder="Search boards, orders, customers, vault…"
                className="flex-1 py-3.5 text-sm outline-none bg-transparent text-[#1A1D2E]"
              />
              <kbd className="text-[10px] text-gray-400 border border-[#E4E6EE] rounded px-1.5 py-0.5">esc</kbd>
            </div>
            <div className="max-h-[55vh] overflow-y-auto py-1.5">
              {allHits.length === 0 && <p className="text-center text-sm text-gray-400 py-8">{q ? 'No matches.' : 'Type to search across the ERP.'}</p>}
              {boardHits.length > 0 && <p className="px-4 pt-2 pb-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Pages &amp; Boards</p>}
              {boardHits.map((h, i) => <HitRow key={'b' + i} h={h} active={active === i} onClick={() => go(h.href)} onHover={() => setActive(i)} />)}
              {records.length > 0 && <p className="px-4 pt-2 pb-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Records</p>}
              {records.map((h, i) => { const idx = boardHits.length + i; return <HitRow key={'r' + i} h={h} active={active === idx} onClick={() => go(h.href)} onHover={() => setActive(idx)} /> })}
            </div>
          </div>
        </div>
      )}
    </header>
  )
}

function HitRow({ h, active, onClick, onHover }: { h: SearchHit; active: boolean; onClick: () => void; onHover: () => void }) {
  return (
    <button onClick={onClick} onMouseEnter={onHover} className="w-full flex items-center gap-3 px-4 py-2 text-left" style={{ background: active ? '#F0F1F5' : 'transparent' }}>
      <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: h.color + '1A', color: h.color }}><i className={`ti ${h.icon} text-base`} /></span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-[#1A1D2E] truncate">{h.label}</span>
        {h.sub && <span className="block text-[11px] text-gray-400 truncate">{h.sub}</span>}
      </span>
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0" style={{ background: h.color + '1A', color: h.color }}>{h.kind}</span>
    </button>
  )
}
