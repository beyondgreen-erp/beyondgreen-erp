import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const { data: portal } = await admin.from('warehouse_portal').select('id,label').eq('token', params.token).maybeSingle()
  if (!portal) return NextResponse.json({ error: 'Portal not found' }, { status: 404 })

  const { data: tickets } = await admin
    .from('container_tickets')
    .select('id, ticket_no, type, status, token, note, created_at, container_id, lines:container_ticket_lines(id, done)')
    .eq('status', 'open')
    .order('created_at', { ascending: true })

  const cids = Array.from(new Set((tickets || []).map((t: any) => t.container_id)))
  const { data: containers } = cids.length
    ? await admin.from('containers').select('id,name,label').in('id', cids)
    : { data: [] as any[] }
  const cmap: Record<string, any> = {}
  ;(containers || []).forEach((c: any) => { cmap[c.id] = c })

  const out = (tickets || []).map((t: any) => {
    const lines = t.lines || []
    return {
      ticket_no: t.ticket_no,
      type: t.type,
      token: t.token,
      note: t.note,
      created_at: t.created_at,
      container: cmap[t.container_id] || null,
      line_count: lines.length,
      done_count: lines.filter((l: any) => l.done).length,
    }
  })
  return NextResponse.json({ label: portal.label, tickets: out })
}
