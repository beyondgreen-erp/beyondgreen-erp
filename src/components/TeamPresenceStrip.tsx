'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import CollapsibleCard from '@/components/CollapsibleCard'

interface Member { email: string; name: string; color: string; initials: string; role?: string; online: boolean; lastSeen?: string | null }
const FALLBACK_COLORS = ['#059669', '#2563EB', '#7C3AED', '#D97706', '#DC2626', '#0D9488', '#DB2777']
function colorFor(email: string) { return FALLBACK_COLORS[email.charCodeAt(0) % FALLBACK_COLORS.length] }
function initialsFor(name?: string, email?: string) {
  if (name && name.trim()) return name.trim().split(/\s+/).map(n => n[0]).join('').slice(0, 2).toUpperCase()
  return (email || '?').slice(0, 2).toUpperCase()
}
const ONLINE_WINDOW_MS = 90 * 1000
function isOnline(p: { is_online?: boolean; last_seen?: string | null }) {
  if (!p?.is_online || !p.last_seen) return false
  return Date.now() - new Date(p.last_seen).getTime() < ONLINE_WINDOW_MS
}
function lastSeenLabel(iso?: string | null) {
  if (!iso) return 'Offline'
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'Active now'
  if (s < 3600) return `Active ${Math.floor(s / 60)}m ago`
  if (s < 86400) return `Active ${Math.floor(s / 3600)}h ago`
  return `Active ${Math.floor(s / 86400)}d ago`
}

export default function TeamPresenceStrip() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [members, setMembers] = useState<Member[]>([])
  const [myEmail, setMyEmail] = useState<string | null>(null)
  const [, force] = useState(0)

  async function refresh() {
    const [{ data: profiles }, { data: presence }] = await Promise.all([
      sb.from('user_profiles').select('email,full_name,display_name,role,avatar_color,avatar_initials,is_active'),
      sb.from('user_presence').select('email,is_online,last_seen'),
    ])
    const pmap = new Map<string, any>()
    ;(presence || []).forEach((p: any) => pmap.set(p.email, p))
    const list: Member[] = (profiles || [])
      .filter((p: any) => p.is_active !== false)
      .map((p: any) => {
        const pres = pmap.get(p.email)
        const name = p.display_name || p.full_name || p.email.split('@')[0]
        return {
          email: p.email, name, role: p.role,
          color: p.avatar_color || colorFor(p.email),
          initials: p.avatar_initials || initialsFor(name, p.email),
          online: isOnline(pres || {}), lastSeen: pres?.last_seen ?? null,
        }
      })
      .sort((a, b) => (Number(b.online) - Number(a.online)) || a.name.localeCompare(b.name))
    setMembers(list)
  }

  useEffect(() => {
    sb.auth.getUser().then(({ data }) => setMyEmail(data.user?.email ?? null))
    refresh()
    const ch = sb.channel('presence_strip')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_presence' }, () => refresh())
      .subscribe()
    const tick = setInterval(() => force(n => n + 1), 30_000)
    const poll = setInterval(refresh, 60_000)
    return () => { sb.removeChannel(ch); clearInterval(tick); clearInterval(poll) }
  }, []) // eslint-disable-line

  function openDM(m: Member) {
    if (m.email === myEmail) return
    ;(window as any).__openDM?.({ email: m.email, name: m.name, color: m.color, initials: m.initials })
  }

  if (members.length === 0) return null
  const onlineCount = members.filter(m => m.online).length
  const headerRight = <span className="text-xs text-gray-500">{onlineCount} online · click to message</span>

  return (
    <CollapsibleCard title="Team" storageKey="team" headerRight={headerRight}>
      <div className="flex flex-wrap gap-4">
        {members.map(m => {
          const isMe = m.email === myEmail
          return (
            <button key={m.email} onClick={() => openDM(m)} disabled={isMe}
              title={isMe ? 'This is you' : `Message ${m.name} · ${m.online ? 'Active now' : lastSeenLabel(m.lastSeen)}`}
              className={`group flex flex-col items-center gap-1.5 w-16 ${isMe ? 'cursor-default' : 'cursor-pointer'}`}>
              <div className="relative">
                <div className="w-12 h-12 rounded-full flex items-center justify-center text-white text-sm font-bold transition-transform group-hover:scale-105"
                  style={{ backgroundColor: m.color }}>{m.initials}</div>
                <span className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-white ${m.online ? 'bg-emerald-500' : 'bg-gray-300'}`} />
              </div>
              <span className="text-[11px] text-gray-600 truncate w-full text-center leading-tight">{isMe ? 'You' : m.name.split(' ')[0]}</span>
            </button>
          )
        })}
      </div>
    </CollapsibleCard>
  )
}
