import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'
const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })

async function ok(token: string) {
  const { data } = await admin.from('erp_settings').select('value').eq('key', 'shift_board_token').maybeSingle()
  return !!(data as any)?.value && token === (data as any).value
}
const CLOSED = ['Complete', 'QC Passed', 'Cancelled']

// GET: today's jobs (by machine) + the team feed.
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  if (!(await ok(params.token))) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })
  const today = new Date().toISOString().slice(0, 10)
  const { data: wos } = await admin.from('work_orders')
    .select('id, wo_code, wo_number, item_part_number, qty_ordered, uom, group_name, status, machine_id, scheduled_start, scheduled_hours, assigned_operator, op_token')
    .eq('scheduled_date', today).not('status', 'in', `(${CLOSED.map(s => `"${s}"`).join(',')})`)
  const list = (wos as any[]) || []
  const mids = Array.from(new Set(list.map(w => w.machine_id).filter(Boolean)))
  const mName: Record<string, string> = {}
  if (mids.length) {
    const { data: ms } = await admin.from('machines').select('id, machine_code, name').in('id', mids)
    ;(ms as any[] || []).forEach(m => { mName[m.id] = m.machine_code || m.name })
  }
  const ids = list.map(w => w.id)
  const logAgg: Record<string, { qty: number; last: string | null; status: string | null; unit: string }> = {}
  if (ids.length) {
    const { data: logs } = await admin.from('wo_run_logs').select('wo_id, output_qty, unit, running_status, logged_at').in('wo_id', ids).order('logged_at', { ascending: false })
    ;(logs as any[] || []).forEach(l => {
      const a = logAgg[l.wo_id] ||= { qty: 0, last: null, status: null, unit: 'cases' }
      a.qty += Number(l.output_qty) || 0
      if (!a.last) { a.last = l.logged_at; a.status = l.running_status; a.unit = l.unit || 'cases' }
    })
  }
  const jobs = list.map(w => ({
    code: w.wo_code || `WO-${w.wo_number}`, op_token: w.op_token,
    item: w.item_part_number, qty: w.qty_ordered, uom: w.uom, group: w.group_name, status: w.status,
    machine: w.machine_id ? (mName[w.machine_id] || null) : null,
    scheduled_start: w.scheduled_start, operator: w.assigned_operator,
    actual_qty: logAgg[w.id]?.qty || 0, unit: logAgg[w.id]?.unit || 'cases',
    last_status: logAgg[w.id]?.status || null, last_log_at: logAgg[w.id]?.last || null,
  })).sort((a, b) => (a.machine || '~').localeCompare(b.machine || '~'))

  const { data: feed } = await admin.from('shift_feed').select('author, body, kind, created_at').order('created_at', { ascending: false }).limit(120)
  return NextResponse.json({ date: today, jobs, feed: ((feed as any[]) || []).reverse() }, { headers: NO_STORE })
}

// POST: { type:'message', author, body }  OR  { type:'log', op_token, output_qty, unit, running_status, note, operator }
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  if (!(await ok(params.token))) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })
  const b = await req.json().catch(() => ({}))
  if (b.type === 'message') {
    const body = (b.body || '').toString().trim().slice(0, 1000)
    if (!body) return NextResponse.json({ error: 'Empty message' }, { status: 400, headers: NO_STORE })
    const { error } = await admin.from('shift_feed').insert({ author: (b.author || 'Someone').toString().slice(0, 80), body, kind: 'message' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })
    return NextResponse.json({ ok: true }, { headers: NO_STORE })
  }
  if (b.type === 'log') {
    const { data: wo } = await admin.from('work_orders').select('id, wo_code, wo_number, machine_id, status').eq('op_token', b.op_token).maybeSingle()
    if (!wo) return NextResponse.json({ error: 'Job not found' }, { status: 404, headers: NO_STORE })
    const status = ['Running', 'Down', 'Offline'].includes(b.running_status) ? b.running_status : 'Running'
    const qty = (b.output_qty === '' || b.output_qty == null) ? null : Number(b.output_qty)
    const operator = (b.operator || '').toString().slice(0, 120) || null
    const unit = (b.unit || 'cases').toString().slice(0, 20)
    const { error } = await admin.from('wo_run_logs').insert({
      wo_id: (wo as any).id, output_qty: Number.isFinite(qty as number) ? qty : null,
      unit, running_status: status, note: (b.note || '').toString().slice(0, 500) || null, operator,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })
    if (status === 'Running' && (wo as any).status === 'Queued') await admin.from('work_orders').update({ status: 'In Progress' }).eq('id', (wo as any).id)
    const code = (wo as any).wo_code || `WO-${(wo as any).wo_number}`
    const summary = `${code}: ${status}${qty != null ? ` · ${Number(qty).toLocaleString()} ${unit}` : ''}${(b.note ? ` · ${(b.note || '').toString().slice(0, 120)}` : '')}`
    await admin.from('shift_feed').insert({ author: operator || 'Operator', body: summary, kind: 'log', wo_id: (wo as any).id })
    return NextResponse.json({ ok: true }, { headers: NO_STORE })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400, headers: NO_STORE })
}
