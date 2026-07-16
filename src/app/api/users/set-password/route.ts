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
    const { id, password, requesterId } = await req.json()
    if (!id || !password) return NextResponse.json({ error: 'User id and password are required' }, { status: 400 })
    if (String(password).length < 8) return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })

    // Only an admin may change another user's password.
    if (!requesterId) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
    const { data: reqProf } = await admin.from('user_profiles').select('is_admin').eq('user_id', requesterId).maybeSingle()
    if (!reqProf?.is_admin) return NextResponse.json({ error: 'Only admins can change passwords.' }, { status: 403 })

    // Resolve the target user's auth id.
    const { data: target, error: tErr } = await admin.from('user_profiles').select('user_id, email').eq('id', id).maybeSingle()
    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })
    if (!target?.user_id) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const { error } = await admin.auth.admin.updateUserById(target.user_id, { password: String(password) })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true, email: target.email })
  } catch (err) {
    console.error('[users/set-password]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
