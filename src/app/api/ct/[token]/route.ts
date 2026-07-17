import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

async function fetchFull(token: string) {
  const { data: t } = await admin.from('container_tickets').select('*, lines:container_ticket_lines(*)').eq('token', token).maybeSingle()
  if (!t) return null
  const { data: c } = await admin.from('containers').select('name,label').eq('id', (t as any).container_id).maybeSingle()
  return { ticket: t, container: c }
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const data = await fetchFull(params.token)
  if (!data) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const body = await req.json().catch(() => ({}))
  const { data: t } = await admin.from('container_tickets').select('id,status').eq('token', params.token).maybeSingle()
  if (!t) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
  if ((t as any).status === 'completed' && body.action !== 'noop') return NextResponse.json({ error: 'This ticket is already completed.' }, { status: 400 })

  if (body.action === 'toggle' && body.lineId) {
    await admin.from('container_ticket_lines').update({ done: !!body.done, done_at: body.done ? new Date().toISOString() : null }).eq('id', body.lineId).eq('ticket_id', (t as any).id)
  } else if (body.action === 'complete') {
    const { error } = await admin.rpc('complete_container_ticket', { p_ticket: (t as any).id, p_by: (body.by || 'Warehouse').toString().slice(0, 80) })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const data = await fetchFull(params.token)
  return NextResponse.json(data)
}
