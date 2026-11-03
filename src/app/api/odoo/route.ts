/* eslint-disable @typescript-eslint/no-explicit-any */
/** Odoo connector endpoints. GET ?action=ping|fields|modules&target=test|live (default test) */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase'
import { odooCall, odooInfo, odooTarget } from '@/lib/odoo'

export const dynamic = 'force-dynamic'
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
