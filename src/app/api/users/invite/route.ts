import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Server-only admin client (service role). Never import into a client component.
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const ALLOWED_DOMAINS = ['beyondgreenbiotech.com', 'byndgrn.com']

// Invite a new teammate: creates a Supabase Auth user (invite email) and lets the
// on_auth_user_created trigger provision their ERP profile, then sets role/department.
// Admin-only. No password is handled here — the invitee sets their own via the link.
export async function POST(req: NextRequest) {
  try {
    const { email, full_name, role, department, requesterId } = await req.json()
    const e = String(email || '').trim().toLowerCase()
    const name = String(full_name || '').trim()
    if (!e || !name) return NextResponse.json({ error: 'Full name and email are required.' }, { status: 400 })
    const domain = e.split('@')[1] || ''
    if (!ALLOWED_DOMAINS.includes(domain)) {
      return NextResponse.json({ error: `Email must be @${ALLOWED_DOMAINS.join(' or @')}` }, { status: 400 })
    }

    // Only an admin may invite.
    if (!requesterId) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
    const { data: reqProf } = await admin.from('user_profiles').select('is_admin').eq('user_id', requesterId).maybeSingle()
    if (!reqProf?.is_admin) return NextResponse.json({ error: 'Only admins can invite teammates.' }, { status: 403 })

    const origin = req.headers.get('origin') || process.env.NEXT_PUBLIC_SITE_URL || ''
    const { data, error } = await admin.auth.admin.inviteUserByEmail(e, {
      data: { full_name: name },
      ...(origin ? { redirectTo: `${origin}/login` } : {}),
    })
    if (error) {
      const msg = /already been registered|already exists/i.test(error.message)
        ? 'A user with that email already exists.'
        : error.message
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    // The on_auth_user_created trigger created the profile from the invite metadata —
    // set the chosen role / department / name on it.
    const uid = data?.user?.id
    const patch: Record<string, unknown> = {
      full_name: name,
      display_name: name,
      role: role || 'Member',
      is_admin: role === 'Admin',
      updated_at: new Date().toISOString(),
    }
    if (department) patch.department = department
    if (uid) await admin.from('user_profiles').update(patch).eq('user_id', uid)
    else await admin.from('user_profiles').update(patch).eq('email', e)

    return NextResponse.json({ success: true, email: e })
  } catch (err) {
    console.error('[users/invite]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
