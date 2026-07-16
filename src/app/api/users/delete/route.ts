import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Server-only admin client (service role). Never import into a client component.
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export async function POST(req: NextRequest) {
  try {
    const { id, requesterId } = await req.json()
    if (!id) return NextResponse.json({ error: 'User id required' }, { status: 400 })

    // Look up the profile being deleted.
    const { data: prof, error: pErr } = await admin
      .from('user_profiles')
      .select('id, user_id, email, is_admin, full_name')
      .eq('id', id)
      .maybeSingle()
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })
    if (!prof) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Guard: can't delete yourself.
    if (requesterId && (requesterId === prof.user_id || requesterId === prof.id)) {
      return NextResponse.json({ error: "You can't delete your own account." }, { status: 400 })
    }

    // Guard: don't delete the last remaining admin.
    if (prof.is_admin) {
      const { count } = await admin.from('user_profiles').select('id', { count: 'exact', head: true }).eq('is_admin', true)
      if ((count ?? 0) <= 1) {
        return NextResponse.json({ error: 'Cannot delete the last admin account.' }, { status: 400 })
      }
    }

    // Delete the auth user (tolerate "not found" — auth record may already be gone).
    if (prof.user_id) {
      const { error: aErr } = await admin.auth.admin.deleteUser(prof.user_id)
      if (aErr && !/not.*found|does not exist/i.test(aErr.message)) {
        return NextResponse.json({ error: `Auth delete failed: ${aErr.message}` }, { status: 500 })
      }
    }

    // Clean up the profile + presence rows.
    await admin.from('user_profiles').delete().eq('id', id)
    if (prof.email) await admin.from('user_presence').delete().eq('email', prof.email)

    return NextResponse.json({ success: true, email: prof.email })
  } catch (err) {
    console.error('[users/delete]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
