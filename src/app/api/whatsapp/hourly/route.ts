import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const revalidate = 0
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
const SITE = process.env.NEXT_PUBLIC_APP_URL || 'https://beyondgreen-erp.vercel.app'
const fmtClock = (t: string | null) => { if (!t) return ''; const m = /^(\d{1,2}):(\d{2})/.exec(t); if (!m) return ''; let h = +m[1]; const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${m[2]} ${ap}` }

// Vercel cron (hourly): queue an hourly log reminder for each in-flight work order today.
export async function GET(_req: NextRequest) {
  const { data: en } = await admin.from('erp_settings').select('value').eq('key', 'whatsapp_enabled').maybeSingle()
  if (((en as any)?.value || 'off') !== 'on') return NextResponse.json({ skipped: 'whatsapp disabled' })

  // Only ping during working hours (~6am–9pm Pacific ≈ 13:00–04:00 UTC).
  const hUTC = new Date().getUTCHours()
  if (!(hUTC >= 13 || hUTC < 4)) return NextResponse.json({ skipped: 'outside hours' })

  const today = new Date().toISOString().slice(0, 10)
  const { data: wos } = await admin.from('work_orders')
    .select('id, wo_code, wo_number, item_part_number, qty_ordered, uom, machine_id, scheduled_start, op_token, status')
    .eq('scheduled_date', today).in('status', ['Queued', 'In Progress'])
  const list = (wos as any[]) || []
  if (!list.length) return NextResponse.json({ queued: 0, note: 'no jobs today' })

  // machine names
  const mids = Array.from(new Set(list.map(w => w.machine_id).filter(Boolean)))
  const mName: Record<string, string> = {}
  if (mids.length) {
    const { data: ms } = await admin.from('machines').select('id, machine_code, name').in('id', mids)
    ;(ms as any[] || []).forEach(m => { mName[m.id] = m.machine_code || m.name })
  }
  // skip WOs already pinged in the last 55 minutes
  const since = new Date(Date.now() - 55 * 60 * 1000).toISOString()
  const { data: recent } = await admin.from('whatsapp_outbox').select('wo_id').eq('kind', 'ping').gte('created_at', since)
  const pinged = new Set(((recent as any[]) || []).map(r => r.wo_id))

  const rows = list.filter(w => !pinged.has(w.id)).map(w => {
    const code = w.wo_code || `WO-${w.wo_number}`
    const mc = w.machine_id ? (mName[w.machine_id] || '') : ''
    const body = `⏰ Hourly check — *${code}*${mc ? ` on ${mc}` : ''}\n${w.item_part_number || ''}${w.qty_ordered != null ? ` · ${Number(w.qty_ordered).toLocaleString()} ${w.uom || ''}` : ''}\nLog the last hour ▶ ${SITE}/wo/${w.op_token}`
    return { wo_id: w.id, kind: 'ping', body, plan_date: today }
  })
  if (!rows.length) return NextResponse.json({ queued: 0, note: 'all recently pinged' })
  const { error } = await admin.from('whatsapp_outbox').insert(rows)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ queued: rows.length })
}
