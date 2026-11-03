/* eslint-disable @typescript-eslint/no-explicit-any */
/** Odoo connector endpoints (read-only for now). GET ?action=ping */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase'
import { ODOO, odooCall, odooWritesOn } from '@/lib/odoo'

export const dynamic = 'force-dynamic'
const json = (d: any, status = 200) => NextResponse.json(d, { status })

export async function GET(req: NextRequest) {
  const sb = await createSupabaseServerClient()
  const { data: u } = await sb.auth.getUser()
  if (!u.user) return json({ error: 'Sign in first' }, 401)
  const action = req.nextUrl.searchParams.get('action') || 'ping'
  try {
    if (action === 'ping') {
      const ctx = await odooCall('res.users', 'context_get')
      const types = await odooCall('stock.picking.type', 'search_read', { domain: [], fields: ['name', 'code', 'sequence_code', 'warehouse_id'] })
      const pickings = await odooCall('stock.picking', 'search_read', {
        domain: [], fields: ['name', 'state', 'picking_type_code', 'partner_id', 'origin', 'scheduled_date', 'date_done', 'note'], limit: 20, order: 'id desc',
      })
      const products = await odooCall('product.product', 'search_read', { domain: [], fields: ['display_name', 'default_code', 'barcode'], limit: 50 })
      return json({ ok: true, server: ODOO.url, db: ODOO.db, writes: odooWritesOn() ? 'ON' : 'blocked', tz: ctx?.tz, types, pickings, products })
    }
    if (action === 'fields') {
      const model = req.nextUrl.searchParams.get('model') || 'stock.picking'
      const f = await odooCall(model, 'fields_get', { attributes: ['string', 'type', 'relation', 'readonly'] })
      return json({ ok: true, model, count: Object.keys(f || {}).length, fields: f })
    }
    if (action === 'modules') {
      const m = await odooCall('ir.module.module', 'search_read', { domain: [['state', '=', 'installed']], fields: ['name', 'shortdesc'] })
      return json({ ok: true, modules: m })
    }
    return json({ error: 'unknown action' }, 400)
  } catch (e: any) {
    return json({ ok: false, error: e?.message || String(e) }, 500)
  }
}
