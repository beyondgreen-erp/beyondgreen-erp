import { createClient } from '@supabase/supabase-js'
import { createBrowserClient, createServerClient } from '@supabase/ssr'

// Fallback strings prevent SSR prerender from throwing on module init.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co'
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key'

// Browser client — a single memoized instance shared across all Client Components,
// so the app doesn't spin up a new GoTrueClient per component (which triggers the
// "Multiple GoTrueClient instances" warning and can race on the shared auth token).
// makeBrowserClient() is a concrete (non-generic) factory so the returned type stays
// fully inferred — annotating with ReturnType<typeof createBrowserClient> would widen it.
function makeBrowserClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY)
}
let browserClient: ReturnType<typeof makeBrowserClient> | undefined
export function createSupabaseBrowserClient() {
  // On the server each request is isolated — never reuse a cached client there.
  if (typeof window === 'undefined') return makeBrowserClient()
  if (!browserClient) browserClient = makeBrowserClient()
  return browserClient
}

// Server client — use inside Server Components and Route Handlers
export async function createSupabaseServerClient() {
  const { cookies } = await import('next/headers')
  const cookieStore = await cookies()
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() { return cookieStore.getAll() },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        } catch {
          // Server Component — cookie writes are no-ops
        }
      },
    },
  })
}

// Legacy singleton (for non-Next.js contexts)
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
