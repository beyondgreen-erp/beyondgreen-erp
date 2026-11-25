/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Civil Doody consumer orders: Odoo delivery orders -> public.odoo_orders, and shipments back to Odoo.
 * Server only. Pull is read-only on Odoo. Ship writes the shipped quantity on each stock move, leaves
 * carrier and tracking on the delivery (a field when Odoo has one, always a chatter note) and validates
 * the delivery so Odoo closes it (or opens a backorder for the remainder on a partial shipment).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { odooCall, odooWritesOn, type OdooTarget } from '@/lib/odoo'

export const OPEN_STATUSES = ['New', 'On Hold', 'Waiting on Stock']
const odooDate = (s: any): string | null => (s && typeof s === 'string' ? new Date(s.replace(' ', 'T') + 'Z').toISOString() : null)
const m2oId = (v: any): number | null => (Array.isArray(v) ? v[0] : typeof v === 'number' ? v : null)
const m2oName = (v: any): string | null => (Array.isArray(v) ? v[1] : null)
const chunk = <T,>(a: T[], n: number) => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }

async function fieldNames(target: OdooTarget, model: string): Promise<Set<string>> {
  const f = await odooCall(target, model, 'fields_get', { attributes: ['type'] })
  return new Set(Object.keys(f || {}))
}
const pick = (have: Set<string>, ...cands: string[]) => cands.find(c => have.has(c))

/** The status a row should have while nobody has touched it yet. */
function openStatus(odooState: string, scheduled: string | null): string {
  if (odooState === 'cancel') return 'Cancelled'
  if (odooState === 'done') return 'Closed in Odoo'
  if (odooState !== 'assigned') return 'Waiting on Stock'
  // A delivery scheduled more than a day out is a pre-order: hold it until its release date.
  if (scheduled && new Date(scheduled).getTime() - Date.now() > 24 * 3600 * 1000) return 'On Hold'
  return 'New'
}

export async function pullOdooOrders(sb: SupabaseClient, target: OdooTarget) {
  const pf = await fieldNames(target, 'stock.picking')
  const mf = await fieldNames(target, 'stock.move')
  const fEmail = pick(pf, 'x_studio_related_email_1')
  const fPhone = pick(pf, 'x_studio_related_phone_1')
  const fAddr = pick(pf, 'x_studio_related_address_1')
  const fPrint = pick(mf, 'x_studio_related_x_studio_print_file_1_1', 'x_studio_related_x_studio_print_file_1_2', 'x_studio_print_file')
  const fSticker = pick(mf, 'x_studio_sticker', 'x_studio_related_x_studio_sticker_1')

  const pickFields = ['name', 'state', 'partner_id', 'origin', 'scheduled_date', 'sale_id', 'backorder_id', fEmail, fPhone, fAddr].filter(Boolean) as string[]
  const open: any[] = await odooCall(target, 'stock.picking', 'search_read', {
    domain: [['picking_type_code', '=', 'outgoing'], ['state', 'in', ['assigned', 'confirmed', 'waiting']]],
    fields: pickFields, limit: 1000, order: 'id asc',
  })

  // Rows we already hold that are no longer open in Odoo (cancelled or closed there): refresh their state.
  const { data: mine } = await sb.from('odoo_orders').select('id, picking_id, status, odoo_state').eq('target', target)
  const known = new Map<number, any>((mine || []).map(r => [r.picking_id, r]))
  const openIds = new Set(open.map(p => p.id))
  const goneIds = (mine || []).filter(r => !openIds.has(r.picking_id) && !['Cancelled', 'Closed in Odoo'].includes(r.status)).map(r => r.picking_id)
  let gone: any[] = []
  for (const ids of chunk(goneIds, 200)) gone = gone.concat(await odooCall(target, 'stock.picking', 'read', { fields: ['name', 'state'] }, ids))

  const ids = open.map(p => p.id)
  let moves: any[] = []
  const moveFields = ['picking_id', 'product_id', 'product_uom_qty', 'quantity', 'state', fPrint, fSticker].filter(Boolean) as string[]
  for (const c of chunk(ids, 200)) moves = moves.concat(await odooCall(target, 'stock.move', 'search_read', { domain: [['picking_id', 'in', c]], fields: moveFields, limit: 5000 }))

  const prodIds = Array.from(new Set(moves.map(m => m2oId(m.product_id)).filter(Boolean))) as number[]
  const skuById = new Map<number, string>()
  for (const c of chunk(prodIds, 200)) {
    const ps: any[] = await odooCall(target, 'product.product', 'read', { fields: ['default_code'] }, c)
    for (const p of ps) skuById.set(p.id, p.default_code || '')
  }

  const partnerIds = Array.from(new Set(open.map(p => m2oId(p.partner_id)).filter(Boolean))) as number[]
  const partnerById = new Map<number, any>()
  for (const c of chunk(partnerIds, 200)) {
    try {
      const ps: any[] = await odooCall(target, 'res.partner', 'read', { fields: ['name', 'street', 'street2', 'city', 'state_id', 'zip', 'country_id', 'email', 'phone'] }, c)
      for (const p of ps) partnerById.set(p.id, p)
    } catch { /* contact details are optional: the delivery order carries its own copy */ }
  }

  const saleIds = Array.from(new Set(open.map(p => m2oId(p.sale_id)).filter(Boolean))) as number[]
  const saleById = new Map<number, any>()
  for (const c of chunk(saleIds, 200)) {
    try {
      const ss: any[] = await odooCall(target, 'sale.order', 'read', { fields: ['name', 'date_order', 'is_subscription'] }, c)
      for (const s of ss) saleById.set(s.id, s)
    } catch { /* subscription flag is optional */ }
  }

  const linesByPick = new Map<number, any[]>()
  for (const m of moves) {
    const pid = m2oId(m.picking_id); if (!pid) continue
    const prodId = m2oId(m.product_id)
    const name = (m2oName(m.product_id) || '').replace(/^\[[^\]]*\]\s*/, '')
    const arr = linesByPick.get(pid) || []
    arr.push({
      move_id: m.id, product_id: prodId, sku: (prodId && skuById.get(prodId)) || '', name,
      qty: Number(m.product_uom_qty) || 0, reserved: Number(m.quantity) || 0, state: m.state,
      print_file: (fPrint && m[fPrint]) || null, sticker: (fSticker && m[fSticker]) || null,
    })
    linesByPick.set(pid, arr)
  }

  const now = new Date().toISOString()
  let added = 0, updated = 0
  const rows: any[] = []
  for (const p of open) {
    const partner = partnerById.get(m2oId(p.partner_id) || 0)
    const sale = saleById.get(m2oId(p.sale_id) || 0)
    const builtAddr = partner ? [partner.street, partner.street2, [partner.city, m2oName(partner.state_id), partner.zip].filter(Boolean).join(', '), m2oName(partner.country_id)].filter(Boolean).join('\n') : ''
    const scheduled = odooDate(p.scheduled_date)
    const prev = known.get(p.id)
    const row: any = {
      target, picking_id: p.id, picking_name: p.name, sale_order_name: p.origin || m2oName(p.sale_id),
      odoo_state: p.state,
      customer_name: partner?.name || m2oName(p.partner_id),
      customer_email: (fEmail && p[fEmail]) || partner?.email || null,
      customer_phone: (fPhone && p[fPhone]) || partner?.phone || null,
      ship_address: (fAddr && p[fAddr]) || builtAddr || null,
      scheduled_date: scheduled, order_date: odooDate(sale?.date_order), is_subscription: sale ? !!sale.is_subscription : null,
      lines: linesByPick.get(p.id) || [], pulled_at: now, updated_at: now,
    }
    // Only move the status while nobody on our side has acted on the order.
    if (!prev) { row.status = openStatus(p.state, scheduled); added++ }
    else { if (OPEN_STATUSES.includes(prev.status)) row.status = openStatus(p.state, scheduled); updated++ }
    rows.push(row)
  }
  // Rows that carry a status and rows that leave it alone have different columns, so upsert them apart.
  for (const group of [rows.filter(r => 'status' in r), rows.filter(r => !('status' in r))]) {
    for (const c of chunk(group, 200)) {
      const { error } = await sb.from('odoo_orders').upsert(c, { onConflict: 'target,picking_id' })
      if (error) throw new Error('Saving orders failed: ' + error.message)
    }
  }

  let closed = 0
  for (const g of gone) {
    const prev = known.get(g.id); if (!prev) continue
    const patch: any = { odoo_state: g.state, updated_at: now }
    if (g.state === 'cancel') patch.status = 'Cancelled'
    else if (g.state === 'done' && [...OPEN_STATUSES, 'Packed'].includes(prev.status)) patch.status = 'Closed in Odoo'
    await sb.from('odoo_orders').update(patch).eq('id', prev.id)
    closed++
  }
  return { target, open_in_odoo: open.length, added, updated, closed_or_cancelled: closed }
}

/** Send one shipped order back to Odoo. Safe to run again: a delivery Odoo already closed is left alone. */
export async function pushShipment(sb: SupabaseClient, id: string) {
  const { data: o, error } = await sb.from('odoo_orders').select('*').eq('id', id).single()
  if (error || !o) throw new Error('Order not found')
  const target = o.target as OdooTarget
  const stamp = async (sync_status: string, sync_message: string, extra: any = {}) => {
    await sb.from('odoo_orders').update({ sync_status, sync_message: sync_message.slice(0, 600), synced_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...extra }).eq('id', id)
    return { ok: sync_status === 'sent', sync_status, sync_message }
  }
  if (!odooWritesOn(target)) return stamp('blocked', 'Live Odoo is read-only from the ERP for now, so nothing was sent. Turn on live writes when Civil Doody goes live.')
  try {
    const cur: any[] = await odooCall(target, 'stock.picking', 'read', { fields: ['state', 'name'] }, [o.picking_id])
    const state = cur?.[0]?.state
    if (state === 'done') return stamp('sent', 'Odoo already shows this delivery as done.', { odoo_state: 'done' })
    if (state === 'cancel') return stamp('failed', 'Odoo shows this delivery as cancelled, so the shipment was not recorded there.', { odoo_state: 'cancel' })

    const shipped: any[] = Array.isArray(o.shipped_lines) && o.shipped_lines.length ? o.shipped_lines : (o.lines || []).map((l: any) => ({ move_id: l.move_id, qty: l.qty }))
    for (const l of shipped) {
      await odooCall(target, 'stock.move', 'write', { vals: { quantity: Number(l.qty) || 0, picked: true } }, [l.move_id])
    }

    const pf = await fieldNames(target, 'stock.picking')
    const fTrack = pick(pf, 'carrier_tracking_ref', 'x_studio_tracking_number', 'x_studio_tracking')
    const fCarrier = pick(pf, 'x_studio_carrier', 'x_studio_carrier_name')
    const vals: any = {}
    if (fTrack && o.tracking_number) vals[fTrack] = o.tracking_number
    if (fCarrier && o.carrier) vals[fCarrier] = o.carrier
    if (Object.keys(vals).length) await odooCall(target, 'stock.picking', 'write', { vals }, [o.picking_id])

    const qtyText = shipped.map(l => { const ln = (o.lines || []).find((x: any) => x.move_id === l.move_id); return `${l.qty} x ${ln?.name || 'item'}` }).join(', ')
    const shipDate = (o.shipped_at ? new Date(o.shipped_at) : new Date()).toISOString().slice(0, 10)
    await odooCall(target, 'stock.picking', 'message_post', {
      body: `Shipped by beyondGREEN on ${shipDate}. Carrier: ${o.carrier || 'n/a'}. Tracking: ${o.tracking_number || 'n/a'}. Shipped: ${qtyText}.`,
    }, [o.picking_id])

    // skip_backorder validates without the wizard; the delivery is left out of picking_ids_not_to_backorder,
    // so a short shipment makes Odoo open a backorder for what is still owed.
    await odooCall(target, 'stock.picking', 'button_validate', { context: { skip_backorder: true, picking_ids_not_to_backorder: [] } }, [o.picking_id])

    const after: any[] = await odooCall(target, 'stock.picking', 'read', { fields: ['state'] }, [o.picking_id])
    const st = after?.[0]?.state
    if (st !== 'done') return stamp('failed', `Odoo took the shipment details but the delivery is still "${st}", not done. It may need a manual validate in Odoo.`, { odoo_state: st })
    const back: any[] = await odooCall(target, 'stock.picking', 'search_read', { domain: [['backorder_id', '=', o.picking_id]], fields: ['name'], limit: 5 })
    const where = fTrack ? 'tracking field and delivery notes' : 'delivery notes (Odoo has no tracking field yet)'
    return stamp('sent', `Odoo delivery ${o.picking_name} is done. Carrier and tracking saved in the ${where}.${back.length ? ' Backorder opened: ' + back.map(b => b.name).join(', ') + '.' : ''}`, { odoo_state: 'done' })
  } catch (e: any) {
    return stamp('failed', e?.message || String(e))
  }
}
