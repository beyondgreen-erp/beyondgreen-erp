'use client'
import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase'

export default function AuthWatcher() {
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createSupabaseBrowserClient()

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'SIGNED_OUT') {
          router.push('/login')
          return
        }
        // Session gone on any non-initial event → redirect
        if (!session && event !== 'INITIAL_SESSION' && pathname !== '/login') {
          router.push('/login?expired=1')
        }
      }
    )
    return () => subscription.unsubscribe()
  }, [supabase, router, pathname])

  return null
}
