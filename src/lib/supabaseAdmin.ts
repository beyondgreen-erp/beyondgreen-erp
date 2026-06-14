import { createClient } from "@supabase/supabase-js";

// Server-only client using the service-role key. Bypasses RLS.
// NEVER import this into a client component.
export function createSupabaseAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
