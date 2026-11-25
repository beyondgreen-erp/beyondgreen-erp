/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GET /api/odoo/sync  — daily job (Vercel cron, see vercel.json) for the Civil Doody Odoo link.
 * For each database (testing, live): pull open delivery orders into odoo_orders, then resend any
 * shipment Odoo has not accepted yet. Live resends are skipped while live writes are switched off.
 * Safe to run any number of times: the pull is an upsert and a delivery Odoo already closed is left alone.
 * Open to the cron (no staff session there), so it only ever does those two idempotent things.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { odooInfo, odooWritesOn, type OdooTarget } from '@/lib/odoo'
import { pullOdooOrders, pushShipment } from '@/lib/odooOrders'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function allowed(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (secret) { if (bearer === secret || req.headers.get('x-cron-secret') === secret) return true }
  else if ((req.headers.get('user-agent') || '').toLowerCase().includes('vercel-cron')) return true
  try {
    const sb = await createSupabaseServerClient()
    const { data } = await sb.auth.getUser()
    return /@(beyondgreenbiotech\.com|byndgrn\.com)$/i.test(data.user?.email || '')
  } catch { return false }
}

export async function GET(req: NextRequest) {
  if (!(await allowed(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const admin = createSupabaseAdminClient()
  const out: any = { ran_at: new Date().toISOString(), targets: {} }
  for (const target of ['test', 'live'] as OdooTarget[]) {
    const r: any = {}
    if (!odooInfo(target).hasKey) { out.targets[target] = { skipped: 'no API key set' }; continue }
    try { r.pull = await pullOdooOrders(admin, target) } catch (e: any) { r.pull_error = e?.message || String(e) }
    if (odooWritesOn(target)) {
      const { data: unsent } = await admin.from('odoo_orders').select('id, picking_name, sync_status')
        .eq('target', target).in('status', ['Shipped', 'Partial']).or('sync_status.is.null,sync_status.in.(failed,blocked)').limit(50)
      r.resent = []
      for (const o of unsent || []) {
        const res = await pushShipment(admin, o.id)
        r.resent.push({ order: o.picking_name, ok: res.ok, message: res.sync_message })
      }
    } else r.resend = 'skipped: live writes are off'
    out.targets[target] = r
  }
  return NextResponse.json({ ok: true, ...out })
}
