/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Odoo connector endpoints.
 * GET  ?action=ping|fields|modules&target=test|live (default test)
 * POST { action: 'pull', target }                         pull Civil Doody delivery orders into odoo_orders
 * POST { action: 'ship', id, carrier, tracking_number, lines: [{ move_id, qty }] }   mark shipped + tell Odoo
 * POST { action: 'retry', id }                            resend a shipment Odoo did not accept
 * POST { action: 'report_setting', report_enabled, report_target }   daily report email on/off (Rudy only)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase'
import { odooCall, odooInfo, odooTarget } from '@/lib/odoo'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { pullOdooOrders, pushShipment } from '@/lib/odooOrders'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const json = (d: any, status = 200) => NextResponse.json(d, { status })

export async function GET(req: NextRequest) {
  const sb = await createSupabaseServerClient()
  const { data: u } = await sb.auth.getUser()
  if (!u.user) return json({ error: 'Sign in first' }, 401)
  const q = req.nextUrl.searchParams
  const action = q.get('action') || 'ping'
  const t = odooTarget(q.get('target'))
  try {
    if (action === 'ping') {
      const ctx = await odooCall(t, 'res.users', 'context_get')
      const types = await odooCall(t, 'stock.picking.type', 'search_read', { domain: [], fields: ['name', 'code', 'sequence_code', 'warehouse_id'] })
      const pickings = await odooCall(t, 'stock.picking', 'search_read', {
        domain: [['picking_type_code', '=', 'outgoing']], fields: ['name', 'state', 'partner_id', 'origin', 'scheduled_date', 'date_done', 'backorder_id'], limit: 25, order: 'id desc',
      })
      const products = await odooCall(t, 'product.product', 'search_read', { domain: [], fields: ['display_name', 'default_code', 'barcode', 'type'], limit: 80 })
      return json({ ok: true, ...odooInfo(t), tz: ctx?.tz, types, pickings, products })
    }
    if (action === 'fields') {
      const model = q.get('model') || 'stock.picking'
      const f = await odooCall(t, model, 'fields_get', { attributes: ['string', 'type', 'relation', 'readonly'] })
      return json({ ok: true, ...odooInfo(t), model, count: Object.keys(f || {}).length, fields: f })
    }
    if (action === 'modules') {
      const m = await odooCall(t, 'ir.module.module', 'search_read', { domain: [['state', '=', 'installed']], fields: ['name', 'shortdesc'] })
      return json({ ok: true, ...odooInfo(t), modules: m })
    }
    return json({ error: 'unknown action' }, 400)
  } catch (e: any) {
    return json({ ok: false, ...odooInfo(t), error: e?.message || String(e) }, 500)
  }
}

const STAFF = ['beyondgreenbiotech.com', 'byndgrn.com']

export async function POST(req: NextRequest) {
  const sb = await createSupabaseServerClient()
  const { data: u } = await sb.auth.getUser()
  const email = (u.user?.email || '').toLowerCase()
  if (!u.user) return json({ error: 'Sign in first' }, 401)
  if (!STAFF.includes(email.split('@')[1] || '')) return json({ error: 'Staff only' }, 403)
  const b = await req.json().catch(() => ({}))
  const admin = createSupabaseAdminClient()
  try {
    if (b.action === 'pull') {
      const res = await pullOdooOrders(admin, odooTarget(b.target))
      return json({ ok: true, ...res })
    }
    if (b.action === 'ship') {
      if (!b.id) return json({ error: 'id is required' }, 400)
      const carrier = String(b.carrier || '').trim(), tracking = String(b.tracking_number || '').trim()
      if (!carrier || !tracking) return json({ error: 'Carrier and tracking number are required' }, 400)
      const { data: o } = await admin.from('odoo_orders').select('id, lines, status').eq('id', b.id).single()
      if (!o) return json({ error: 'Order not found' }, 404)
      if (['Cancelled', 'Closed in Odoo'].includes(o.status)) return json({ error: `This order is ${o.status} and cannot be shipped` }, 400)
      const want = new Map<number, number>((Array.isArray(b.lines) ? b.lines : []).map((l: any) => [Number(l.move_id), Number(l.qty)]))
      const shipped = (o.lines || []).map((l: any) => {
        const q = want.has(l.move_id) ? want.get(l.move_id)! : Number(l.qty)
        return { move_id: l.move_id, qty: Math.max(0, Math.min(Number(l.qty) || 0, Number.isFinite(q) ? q : 0)) }
      })
      if (!shipped.some((l: any) => l.qty > 0)) return json({ error: 'Nothing to ship: every quantity is zero' }, 400)
      const partial = shipped.some((l: any, i: number) => l.qty < (Number(o.lines[i].qty) || 0))
      const now = new Date().toISOString()
      const { error } = await admin.from('odoo_orders').update({
        status: partial ? 'Partial' : 'Shipped', carrier, tracking_number: tracking, shipped_lines: shipped,
        shipped_at: now, shipped_by: email, sync_status: null, sync_message: null, updated_at: now,
      }).eq('id', b.id)
      if (error) return json({ error: error.message }, 500)
      const res = await pushShipment(admin, b.id)
      return json({ ...res, status: partial ? 'Partial' : 'Shipped' })
    }
    if (b.action === 'retry') {
      if (!b.id) return json({ error: 'id is required' }, 400)
      return json(await pushShipment(admin, b.id))
    }
    if (b.action === 'report_setting') {
      // Switching the customer email on or off is Rudy's call only.
      if (email !== 'rudyp@beyondgreenbiotech.com') return json({ error: 'Only Rudy can change the report email' }, 403)
      const patch: any = { updated_by: email, updated_at: new Date().toISOString() }
      if (typeof b.report_enabled === 'boolean') patch.report_enabled = b.report_enabled
      if (b.report_target === 'test' || b.report_target === 'live') patch.report_target = b.report_target
      const { error } = await admin.from('odoo_sync_settings').update(patch).eq('id', 1)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }
    return json({ error: 'unknown action' }, 400)
  } catch (e: any) {
    return json({ ok: false, error: e?.message || String(e) }, 500)
  }
}
