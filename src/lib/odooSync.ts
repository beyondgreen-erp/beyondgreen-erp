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

const itemsText = (lines: any[], shipped?: any[] | null) =>
  (lines || []).map((l: any) => {
    const s = shipped?.find((x: any) => x.move_id === l.move_id)
    return `${s ? s.qty : l.qty} x ${l.name}`
  }).join(', ')

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

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const day = (d: string) => new Date(d).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric' })
const dayTime = (d: string) => new Date(d).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function reportEmail(run: any, opts: { preview?: boolean } = {}) {
  const testing = run.target === 'test'
  const subject = `${opts.preview ? '[PREVIEW] ' : ''}Civil Doody order report, ${day(run.ran_at)}${testing ? ' (testing database)' : ''}`
  const th = 'text-align:left;padding:6px 10px;background:#F3F4F6;font-size:12px;color:#374151;border-bottom:1px solid #E5E7EB'
  const td = 'padding:6px 10px;font-size:13px;color:#111827;border-bottom:1px solid #F0F1F3;vertical-align:top'
  const table = (heads: string[], body: string[][]) => `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;margin:6px 0 18px"><tr>${heads.map(h => `<th style="${th}">${h}</th>`).join('')}</tr>${body.map(r => `<tr>${r.map(c => `<td style="${td}">${c}</td>`).join('')}</tr>`).join('')}</table>`
  const h2 = (t: string) => `<p style="font-size:14px;font-weight:bold;color:#111827;margin:18px 0 4px">${t}</p>`
  const none = (t: string) => `<p style="font-size:13px;color:#6B7280;margin:4px 0 16px">${t}</p>`
  const p = run.pulled || {}
  const t = run.totals || {}
  const newO: any[] = run.new_orders || [], ship: any[] = run.shipments || [], prob: any[] = run.problems || []
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:720px;color:#111827">
<p style="font-size:14px">Hi Shannan,</p>
<p style="font-size:14px">Here is the daily order report between the Civil Doody Odoo store and beyondGREEN for ${day(run.ran_at)}.${testing ? ' <b>This report is from the Odoo testing database, so these are test orders.</b>' : ''}</p>
${h2('Summary')}
${table(['Pulled from Odoo', 'New orders received', 'Shipments sent back to Odoo', 'To pack', 'On hold (pre-orders)', 'Waiting on stock'], [[
    run.pulled ? `${esc(p.open_in_odoo)} open orders` : 'Pull did not run', String(newO.length), String(ship.length), String(t.to_pack ?? 0), String(t.on_hold ?? 0), String(t.waiting_on_stock ?? 0)]])}
${h2(`New orders received from Odoo (${newO.length})`)}
${newO.length ? table(['Odoo delivery', 'Sale order', 'Customer', 'Items', 'Status'], newO.slice(0, 200).map(o => [esc(o.order), esc(o.sale_order), esc(o.customer), esc(o.items), esc(o.status)])) + (newO.length > 200 ? none(`Showing the first 200 of ${newO.length}.`) : '') : none('No new orders since the last report.')}
${h2(`Shipments sent back to Odoo (${ship.length})`)}
${ship.length ? table(['Odoo delivery', 'Sale order', 'Customer', 'Shipped', 'Carrier', 'Tracking number', 'Ship date'], ship.map(s => [esc(s.order), esc(s.sale_order), esc(s.customer), esc(s.items) + (s.partial ? ' (partial, backorder open)' : ''), esc(s.carrier), esc(s.tracking), s.shipped_at ? esc(day(s.shipped_at)) : ''])) : none('No shipments since the last report.')}
${prob.length ? h2(`Needs attention (${prob.length})`) + table(['Item', 'Detail'], prob.map(x => [esc(x.what), esc(x.detail)])) : ''}
<p style="font-size:12px;color:#6B7280">Report time: ${esc(dayTime(run.ran_at))} Pacific. Covers activity since ${esc(dayTime(run.period_start || run.ran_at))} Pacific. This is an automated message from beyondGREEN biotech. Please reply to Rudy Patel with any questions.</p>
<p style="font-size:14px">Thank you,<br/>beyondGREEN biotech</p>
</div>`
  return { subject, html }
}

export async function sendReport(sb: SupabaseClient, run: any, to: string[], cc: string[], opts: { preview?: boolean } = {}) {
  const key = process.env.RESEND_API_KEY
  if (!key) return { ok: false, error: 'Email is not configured (RESEND_API_KEY missing)' }
  const { subject, html } = reportEmail(run, opts)
  const from = `${process.env.FROM_NAME || 'beyondGREEN ERP'} <${process.env.FROM_EMAIL || 'erp@beyondgreenbiotech.com'}>`
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, cc: cc.length ? cc : undefined, reply_to: 'rudyp@beyondgreenbiotech.com', subject, html }),
  })
  const ok = r.ok
  const error = ok ? undefined : (await r.text()).slice(0, 300)
  if (!opts.preview) {
    await sb.from('odoo_sync_runs').update({ email_status: ok ? 'sent' : 'failed: ' + error, email_to: to.join(', '), email_cc: cc.join(', '), emailed_at: ok ? new Date().toISOString() : null }).eq('id', run.id)
  }
  return { ok, error }
}
