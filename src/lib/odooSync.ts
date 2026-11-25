/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * One sync run for one Civil Doody Odoo database: pull, resend unsent shipments, save a report row,
 * and (when asked) email the report. Server only.
 * The report email is plain data: order numbers, items, carrier, tracking. It carries no link into the
 * ERP and no login, so the customer sees only what was pulled from them and what was pushed back.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { odooWritesOn, type OdooTarget } from '@/lib/odoo'
import { pullOdooOrders, pushShipment } from '@/lib/odooOrders'
import { reportEmail } from '@/lib/odooReportEmail'

const itemsText = (lines: any[], shipped?: any[] | null) =>
  (lines || []).map((l: any) => {
    const s = shipped?.find((x: any) => x.move_id === l.move_id)
    return { qty: Number(s ? s.qty : l.qty) || 0, name: l.name }
  }).filter(x => x.qty > 0).map(x => `${x.qty} x ${x.name}`).join(', ')

export async function runOdooSync(sb: SupabaseClient, target: OdooTarget, trigger: string) {
  // The reporting window always starts at the last automatic run, so a Sync now by hand never shortens the daily report.
  const { data: prev } = await sb.from('odoo_sync_runs').select('ran_at').eq('target', target).eq('trigger', 'daily').order('ran_at', { ascending: false }).limit(1).maybeSingle()
  const periodStart = prev?.ran_at || new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const problems: any[] = []
  let pulled: any = null
  try { pulled = await pullOdooOrders(sb, target) } catch (e: any) { problems.push({ what: 'Pull from Odoo failed', detail: e?.message || String(e) }) }

  if (odooWritesOn(target)) {
    const { data: unsent } = await sb.from('odoo_orders').select('id').eq('target', target).in('status', ['Shipped', 'Partial'])
      .or('sync_status.is.null,sync_status.in.(failed,blocked)').limit(50)
    for (const o of unsent || []) await pushShipment(sb, o.id)
  }

  const { data: all } = await sb.from('odoo_orders').select('picking_name, sale_order_name, customer_name, lines, shipped_lines, status, carrier, tracking_number, shipped_at, sync_status, sync_message, synced_at, scheduled_date, created_at').eq('target', target).limit(5000)
  const rows = all || []
  const newOrders = rows.filter(r => r.created_at > periodStart)
    .map(r => ({ order: r.picking_name, sale_order: r.sale_order_name, customer: r.customer_name, items: itemsText(r.lines), status: r.status }))
  const shipments = rows.filter(r => r.sync_status === 'sent' && r.synced_at && r.synced_at > periodStart)
    .map(r => ({ order: r.picking_name, sale_order: r.sale_order_name, customer: r.customer_name, items: itemsText(r.lines, r.shipped_lines), carrier: r.carrier, tracking: r.tracking_number, shipped_at: r.shipped_at, partial: r.status === 'Partial' }))
  for (const r of rows.filter(r => ['Shipped', 'Partial'].includes(r.status) && r.sync_status !== 'sent')) {
    problems.push({ what: `Shipment for ${r.picking_name} not recorded in Odoo yet`, detail: r.sync_message || 'waiting to be sent' })
  }
  const count = (s: string[]) => rows.filter(r => s.includes(r.status)).length
  const totals = { to_pack: count(['New', 'Packed']), on_hold: count(['On Hold']), waiting_on_stock: count(['Waiting on Stock']), shipped: count(['Shipped', 'Partial']) }

  const { data: run, error } = await sb.from('odoo_sync_runs').insert({ target, trigger, period_start: periodStart, pulled, new_orders: newOrders, shipments, problems, totals }).select('*').single()
  if (error) throw new Error('Saving the sync report failed: ' + error.message)
  return run
}

export async function sendReport(sb: SupabaseClient, run: any, to: string[], cc: string[], opts: { preview?: boolean; test?: boolean } = {}) {
  const key = process.env.RESEND_API_KEY
  if (!key) return { ok: false, error: 'Email is not configured (RESEND_API_KEY missing)' }
  const { subject, html } = reportEmail(run, opts)
  // Sent to a customer, so the sender shows the company name rather than "ERP".
  const from = `beyondGREEN biotech <${process.env.FROM_EMAIL || 'erp@beyondgreenbiotech.com'}>`
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, cc: cc.length ? cc : undefined, reply_to: 'rudyp@beyondgreenbiotech.com', subject, html }),
  })
  const ok = r.ok
  const error = ok ? undefined : (await r.text()).slice(0, 300)
  // A test does not count as the day's report, so emailed_at stays empty and the daily email still goes out.
  if (opts.test) await sb.from('odoo_sync_runs').update({ email_status: ok ? 'test sent' : 'test failed: ' + error, email_to: to.join(', '), email_cc: cc.join(', ') }).eq('id', run.id)
  else if (!opts.preview) {
    await sb.from('odoo_sync_runs').update({ email_status: ok ? 'sent' : 'failed: ' + error, email_to: to.join(', '), email_cc: cc.join(', '), emailed_at: ok ? new Date().toISOString() : null }).eq('id', run.id)
  }
  return { ok, error }
}
