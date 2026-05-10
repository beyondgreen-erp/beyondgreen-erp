'use client'
import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Profile {
  id: string
  email: string
  full_name: string
  display_name: string | null
  role: string
  department: string | null
  phone: string | null
  avatar_color: string
  avatar_initials: string | null
  is_active: boolean
}

interface Presence {
  email: string
  is_online: boolean
  last_seen: string
  activity_count: number
}

const ROLE_COLORS: Record<string, string> = {
  Admin: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  Manager: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  Member: 'bg-gray-700/40 text-gray-400 border-gray-700',
}

const DEPT_COLORS: Record<string, string> = {
  Management: 'bg-emerald-500/10 text-emerald-400',
  Sustainability: 'bg-teal-500/10 text-teal-400',
  Marketing: 'bg-violet-500/10 text-violet-400',
  Sales: 'bg-amber-500/10 text-amber-400',
  'R&D': 'bg-blue-500/10 text-blue-400',
  Finance: 'bg-cyan-500/10 text-cyan-400',
  Warehouse: 'bg-orange-500/10 text-orange-400',
}

export default function TeamPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [presence, setPresence] = useState<Record<string, Presence>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString()
      const [{ data: pData }, { data: presData }] = await Promise.all([
        sb.from('user_profiles').select('*').eq('is_active', true).order('full_name'),
        sb.from('user_presence').select('*').eq('is_online', true).gte('last_seen', cutoff),
      ])
      if (pData) setProfiles(pData as Profile[])
      if (presData) {
        const map: Record<string, Presence> = {}
        for (const p of presData as Presence[]) map[p.email] = p
        setPresence(map)
      }
      setLoading(false)
    }
    load()

    const ch = sb.channel('team_presence')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_presence' }, async () => {
        const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString()
        const { data } = await sb.from('user_presence').select('*').eq('is_online', true).gte('last_seen', cutoff)
        if (data) {
          const map: Record<string, Presence> = {}
          for (const p of data as Presence[]) map[p.email] = p
          setPresence(map)
        }
      })
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, []) // eslint-disable-line

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <svg className="w-5 h-5 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
      </svg>
    </div>
  )

  return (
    <div className="p-4 md:p-8 min-h-screen">
      <div className="mb-8">
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-emerald-500/20 text-emerald-300 border-emerald-500/30">SETTINGS</span>
        <h1 className="text-2xl font-semibold text-white mt-1">Team Directory</h1>
        <p className="text-gray-500 text-sm mt-0.5">{profiles.length} active team member{profiles.length !== 1 ? 's' : ''}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {profiles.map(p => {
          const online = !!presence[p.email]
          const pres = presence[p.email]
          const roleColor = ROLE_COLORS[p.role] ?? ROLE_COLORS.Member
          const deptColor = p.department ? (DEPT_COLORS[p.department] ?? 'bg-gray-700/40 text-gray-400') : ''

          return (
            <div key={p.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex flex-col gap-4">
              <div className="flex items-start gap-4">
                <div className="relative shrink-0">
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-base"
                    style={{ backgroundColor: p.avatar_color }}
                  >
                    {p.avatar_initials || p.full_name[0]}
                  </div>
                  {online && (
                    <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-400 rounded-full border-2 border-gray-900" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-white font-semibold text-sm truncate">{p.full_name}</p>
                  {p.display_name && <p className="text-gray-500 text-xs">{p.display_name}</p>}
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full border font-medium ${roleColor}`}>{p.role}</span>
                    {p.department && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${deptColor}`}>{p.department}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5 text-xs text-gray-500">
                <div className="flex items-center gap-1.5 truncate">
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                  </svg>
                  <span className="truncate">{p.email}</span>
                </div>
                {p.phone && (
                  <div className="flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/>
                    </svg>
                    <span>{p.phone}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-gray-800 text-xs">
                <span className={`flex items-center gap-1.5 ${online ? 'text-emerald-400' : 'text-gray-600'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-gray-700'}`} />
                  {online ? 'Online now' : 'Offline'}
                </span>
                {pres && (
                  <span className="text-gray-600">{pres.activity_count} actions</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
