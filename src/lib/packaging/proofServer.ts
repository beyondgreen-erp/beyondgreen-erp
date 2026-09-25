/* eslint-disable @typescript-eslint/no-explicit-any */
// Server-only helpers for the public printer-proof portal.
import type { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

export async function loadLink(admin: ReturnType<typeof createSupabaseAdminClient>, token: string): Promise<{ link?: any; error?: string; status?: number }> {
  if (!token || token.length < 20 || token.length > 64) return { error: 'This link is not valid.', status: 404 }
  const { data: link } = await admin.from('packaging_share_links').select('*').eq('token', token).maybeSingle()
  if (!link) return { error: 'This link is not valid.', status: 404 }
  if (link.revoked_at) return { error: 'This proof link has been turned off by beyondGREEN.', status: 410 }
  if (link.expires_at && new Date(link.expires_at) < new Date()) return { error: 'This proof link has expired. Please ask beyondGREEN for a new one.', status: 410 }
  return { link }
}

