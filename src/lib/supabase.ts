import { createClient } from '@supabase/supabase-js'
import { createBrowserClient } from '@supabase/ssr'

// Provide fallback strings so module init never throws during SSR prerender.
// Actual API calls happen inside useEffect (browser-only) where real env vars are present.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co'
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key'

// Browser client (use inside Client Components and login actions)
export function createSupabaseBrowserClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY)
}

// Legacy singleton
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
