import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// GET: return the day's plan, its machine lines, and each line's actual output so far.
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const { data: plan } = await admin.from('production_day_plans')
    .select('id, plan_date, title, status, notes').eq('share_token', params.token).maybeSingle()
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404, headers: NO_STORE })

  const { data: lines } = await admin.from('production_plan_lines')
    .select('id, machine_code, product, operator, status, sort_order')
    .eq('plan_id', plan.id).order('sort_order').order('machine_code')

  const { data: logs } = await admin.from('production_output_logs')
    .select('plan_line_id, output_qty, unit, running_status, note, operator, logged_at')
    .eq('plan_id', plan.id).order('logged_at', { ascending: false })

  const byLine: Record<string, any[]> = {}
  ;(logs || []).forEach((l: any) => { (byLine[l.plan_line_id] ||= []).push(l) })

  const out = (lines || []).map((ln: any) => {
    const ls = byLine[ln.id] || []
    const total = ls.reduce((s: number, x: any) => s + (Number(x.output_qty) || 0), 0)
    const last = ls[0] || null
    return {
      id: ln.id, machine_code: ln.machine_code, product: ln.product, operator: ln.operator,
      planned_status: ln.status,
      actual_qty: total, unit: (last?.unit) || 'cases',
      last_status: last?.running_status || null,
      last_log_at: last?.logged_at || null,
      log_count: ls.length,
      logs: ls.slice(0, 6),
    }
  })

  return NextResponse.json({
    plan: { plan_date: plan.plan_date, title: plan.title, status: plan.status, notes: plan.notes },
    lines: out,
  }, { headers: NO_STORE })
}

// POST: an operator logs output for one machine line.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const body = await req.json().catch(() => ({}))
  const { line_id, output_qty, unit, running_status, note, operator } = body
  if (!line_id) return NextResponse.json({ error: 'line_id required' }, { status: 400, headers: NO_STORE })

  const { data: plan } = await admin.from('production_day_plans').select('id').eq('share_token', params.token).maybeSingle()
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404, headers: NO_STORE })

  const { data: line } = await admin.from('production_plan_lines').select('id, plan_id').eq('id', line_id).maybeSingle()
  if (!line || line.plan_id !== plan.id) return NextResponse.json({ error: 'Invalid machine for this plan' }, { status: 400, headers: NO_STORE })

  const status = ['Running', 'Down', 'Offline'].includes(running_status) ? running_status : 'Running'
  const qty = (output_qty === '' || output_qty == null) ? null : Number(output_qty)

  const { error } = await admin.from('production_output_logs').insert({
    plan_line_id: line_id, plan_id: plan.id,
    output_qty: Number.isFinite(qty as number) ? qty : null,
    unit: (unit || 'cases').toString().slice(0, 20),
    running_status: status,
    note: (note || '').toString().slice(0, 500) || null,
    operator: (operator || '').toString().slice(0, 120) || null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })

  // Reflect the latest running status on the line so the board shows live state.
  await admin.from('production_plan_lines').update({ status, updated_at: new Date().toISOString() }).eq('id', line_id)

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
