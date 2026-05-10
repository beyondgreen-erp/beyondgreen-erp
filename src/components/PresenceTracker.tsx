'use client'
import { useEffect, useMemo } from 'react'
import { usePathname } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase'

export default function PresenceTracker() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const pathname = usePathname()

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>
    let email: string | null = null

    async function upsertSimple(online: boolean) {
      if (!email) return
      await sb.from('user_presence').upsert(
        { email, current_page: pathname, last_seen: new Date().toISOString(), is_online: online },
        { onConflict: 'email', ignoreDuplicates: false }
      )
      if (online) {
        await sb.rpc('increment_presence_activity', { user_email: email }).maybeSingle()
      }
    }

    async function init() {
      const { data } = await sb.auth.getUser()
      email = data.user?.email ?? null
      if (!email) return
      await upsertSimple(true)
      interval = setInterval(() => upsertSimple(true), 30_000)
    }

    async function offline() {
      if (!email) return
      await sb.from('user_presence').upsert(
        { email, is_online: false, last_seen: new Date().toISOString() },
        { onConflict: 'email', ignoreDuplicates: false }
      )
    }

    init()

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') offline()
      else upsertSimple(true)
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibility)
      offline()
    }
  }, [pathname]) // eslint-disable-line

  return null
}
