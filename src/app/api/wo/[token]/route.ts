import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'
const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })

const woFields = 'id, wo_code, wo_number, item_part_number, qty_ordered, uom, group_name, status, machine_id, scheduled_date, scheduled_start, scheduled_hours, assigned_operator'

// GET: one work order for the operator, plus its run logs so far.
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const { data: wo } = await admin.from('work_orders').select(woFields).eq('op_token', params.token).maybeSingle()
  if (!wo) return NextResponse.json({ error: 'Work order not found' }, { status: 404, headers: NO_STORE })
  let machine = null
  if ((wo as any).machine_id) {
    const { data: m } = await admin.from('machines').select('machine_code,name').eq('id', (wo as any).machine_id).maybeSingle()
    machine = (m as any)?.machine_code || (m as any)?.name || null
  }
  const { data: logs } = await admin.from('wo_run_logs').select('output_qty, unit, running_status, note, operator, logged_at').eq('wo_id', (wo as any).id).order('logged_at', { ascending: false }).limit(12)
  const ls = (logs as any[]) || []
  const total = ls.reduce((s, x) => s + (Number(x.output_qty) || 0), 0)
  return NextResponse.json({
    wo: {
      code: (wo as any).wo_code || `WO-${(wo as any).wo_number}`,
      item: (wo as any).item_part_number, qty: (wo as any).qty_ordered, uom: (wo as any).uom,
      group: (wo as any).group_name, status: (wo as any).status, machine,
      scheduled_date: (wo as any).scheduled_date, scheduled_start: (wo as any).scheduled_start,
      scheduled_hours: (wo as any).scheduled_hours, operator: (wo as any).assigned_operator,
    },
    actual_qty: total, unit: ls[0]?.unit || 'cases',
    last_status: ls[0]?.running_status || null, last_log_at: ls[0]?.logged_at || null,
    log_count: ls.length, logs: ls,
  }, { headers: NO_STORE })
}

// POST: operator logs the last hour — output qty + running/down status + note.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const body = await req.json().catch(() => ({}))
  const { output_qty, unit, running_status, note, operator } = body
  const { data: wo } = await admin.from('work_orders').select('id, status').eq('op_token', params.token).maybeSingle()
  if (!wo) return NextResponse.json({ error: 'Work order not found' }, { status: 404, headers: NO_STORE })
  const status = ['Running', 'Down', 'Offline'].includes(running_status) ? running_status : 'Running'
  const qty = (output_qty === '' || output_qty == null) ? null : Number(output_qty)
  const { error } = await admin.from('wo_run_logs').insert({
    wo_id: (wo as any).id,
    output_qty: Number.isFinite(qty as number) ? qty : null,
    unit: (unit || 'cases').toString().slice(0, 20),
    running_status: status,
    note: (note || '').toString().slice(0, 500) || null,
    operator: (operator || '').toString().slice(0, 120) || null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })
  // Move a queued job into production once the operator starts logging it running.
  if (status === 'Running' && (wo as any).status === 'Queued') {
    await admin.from('work_orders').update({ status: 'In Progress' }).eq('id', (wo as any).id)
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
