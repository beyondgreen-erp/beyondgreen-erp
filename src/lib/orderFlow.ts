/* eslint-disable @typescript-eslint/no-explicit-any */
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { WORK_ORDER_APPROVERS } from '@/lib/partNumber'

export type OrderStatus =
  | 'Pending' | 'New' | 'Confirmed' | 'Awaiting Production'
  | 'Awaiting BOM Components' | 'Production Queue' | 'In Production'
  | 'Production Complete' | 'QC' | 'Ready to Ship'
  | 'Ready at Will Call' | 'Shipped'
  | 'Partially Shipped' | 'On Hold' | 'Cancelled' | 'Closed'

// ─── Inventory Check ──────────────────────────────────────────────────────────

export interface ShortageItem {
  sku: string
  product_name: string
  qty_required: number
  qty_on_hand: number
  qty_short: number
  order_line_id: string
  /** Carried onto the work order so the finished goods can actually be booked. */
  product_id?: string | null
  uom?: string | null
}

export interface SufficientItem {
  sku: string
  product_name: string
  qty_required: number
  qty_on_hand: number
}

export interface InventoryCheckResult {
  shortages: ShortageItem[]
  sufficient: SufficientItem[]
  allSufficient: boolean
}

export async function checkInventoryForOrder(orderId: string): Promise<InventoryCheckResult> {
  const sb = createSupabaseBrowserClient()
  const { data: lines } = await sb
    .from('sales_order_lines')
    .select('id, sku, quantity, sku_flagged, description, product_id, unit_of_measure')
    .eq('sales_order_id', orderId)

  const rows = ((lines ?? []) as any[]).filter(l => l.sku && !l.sku_flagged)
  if (!rows.length) return { shortages: [], sufficient: [], allSufficient: true }

  // One lookup for the whole order rather than one round trip per line.
  const skus = Array.from(new Set(rows.map(l => String(l.sku).trim())))
  const { data: prods } = await sb
    .from('products')
    .select('id, sku, product_name, on_hand_qty, unit_of_measure')
    .in('sku', skus)
  const bySku: Record<string, any> = {}
  for (const p of (prods ?? []) as any[]) bySku[String(p.sku).trim().toLowerCase()] = p

  const shortages: ShortageItem[] = []
  const sufficient: SufficientItem[] = []

  for (const line of rows) {
    const prod = bySku[String(line.sku).trim().toLowerCase()]
    const onHand = Number(prod?.on_hand_qty ?? 0)
    const required = Number(line.quantity ?? 0)
    const productName: string = prod?.product_name ?? line.description ?? line.sku

    if (onHand < required) {
      shortages.push({
        sku: line.sku,
        product_name: productName,
        qty_required: required,
        qty_on_hand: onHand,
        qty_short: required - onHand,
        order_line_id: line.id,
        product_id: line.product_id ?? prod?.id ?? null,
        uom: line.unit_of_measure ?? prod?.unit_of_measure ?? null,
      })
    } else {
      sufficient.push({ sku: line.sku, product_name: productName, qty_required: required, qty_on_hand: onHand })
    }
  }

  return { shortages, sufficient, allSufficient: shortages.length === 0 }
}

// ─── Create Work Orders for Shortages ────────────────────────────────────────

/**
 * Raise one work order per short line — one order with two short items gets two work orders,
 * because they are two different things to make on two different machines.
 *
 * Nothing goes straight into the production queue. Each one is created `pending` and waits in
 * the Waiting for Approval bucket at the top of the Work Orders board until somebody gives it
 * a production group, a machine and an operator and approves it. The part number, product link
 * and UOM are carried over from the sales order line, so an approved job can actually book its
 * finished goods; without the product link a completion posts nothing.
 */
export async function createWorkOrdersForShortages(
  orderId: string,
  shortages: ShortageItem[],
  requestedBy?: string | null,
): Promise<{ created: string[]; count: number; skipped: number; emailed: boolean }> {
  const sb = createSupabaseBrowserClient()

  const { data: order } = await sb
    .from('sales_orders')
    .select('order_number, customer_id, required_ship_date, customers(company_name)')
    .eq('id', orderId)
    .maybeSingle()

  const o: any = order
  const orderRef = o?.order_number ?? orderId.slice(0, 8)
  const customer = o?.customers?.company_name ?? ''

  // Do not raise a second work order for something already being made. An open work order
  // against the same order and part is the same job.
  const { data: existing } = await sb
    .from('work_orders')
    .select('id, item_part_number, status')
    .eq('sales_order_id', orderId)
    .not('status', 'in', '("Complete","QC Passed","Cancelled")')
  const openParts = new Set(
    ((existing ?? []) as any[]).map(w => String(w.item_part_number ?? '').trim().toLowerCase()).filter(Boolean))

  const created: string[] = []
  const madeRows: { code: string; sku: string; qty: number; name: string; id: string }[] = []
  let skipped = 0

  for (const s of shortages) {
    if (openParts.has(String(s.sku).trim().toLowerCase())) { skipped++; continue }
    const { data: wo, error } = await sb
      .from('work_orders')
      .insert({
        sales_order_id: orderId,
        order_id: orderId,
        item_part_number: s.sku,
        product_id: s.product_id ?? null,
        uom: s.uom ?? null,
        qty_ordered: s.qty_short,
        qty_produced: 0,
        status: 'Queued',
        approval_state: 'pending',
        due_date: o?.required_ship_date ?? null,
        auto_reason: `Short ${s.qty_short} of ${s.sku} for ${orderRef}${customer ? ` (${customer})` : ''} — ordered ${s.qty_required}, on hand ${s.qty_on_hand}.`,
        notes: `AUTO|${s.product_name}|SOREF:${orderId}|Need ${s.qty_short} of ${s.sku} for ${orderRef}. On hand: ${s.qty_on_hand}`,
      })
      .select('id, wo_number')
      .single()

    if (error) { console.error('WO insert error:', error.message); continue }
    if (wo) {
      created.push((wo as any).id)
      madeRows.push({
        code: `WO-${(wo as any).wo_number}`, sku: s.sku, qty: s.qty_short,
        name: s.product_name, id: (wo as any).id,
      })
    }
  }

  // The order is queued for production, not in production — nobody has approved anything yet.
  if (created.length) await sb.from('sales_orders').update({ status: 'Production Queue' }).eq('id', orderId)

  let emailed = false
  if (madeRows.length) {
    try {
      const rows = madeRows.map(r => `<tr>
        <td style="border:1px solid #e5e7eb;padding:6px"><a href="https://beyondgreen-erp.vercel.app/production/work-orders?item=${r.id}">${r.code}</a></td>
        <td style="border:1px solid #e5e7eb;padding:6px">${r.sku}</td>
        <td style="border:1px solid #e5e7eb;padding:6px">${r.name}</td>
        <td style="border:1px solid #e5e7eb;padding:6px">${r.qty.toLocaleString()}</td></tr>`).join('')
      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111">
          <p><strong>${madeRows.length} work order${madeRows.length > 1 ? 's' : ''}</strong> raised for order
             <strong>${orderRef}</strong>${customer ? ` (${customer})` : ''} because the stock is not on the shelf.</p>
          <p>They are waiting for approval at the top of the Work Orders board. None of them will run
             until somebody gives them a production group, a machine and an operator and approves them.</p>
          <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:14px 0">
            <tr>
              <td style="border:1px solid #e5e7eb;padding:6px;background:#f9fafb;font-weight:600">Work order</td>
              <td style="border:1px solid #e5e7eb;padding:6px;background:#f9fafb;font-weight:600">Part #</td>
              <td style="border:1px solid #e5e7eb;padding:6px;background:#f9fafb;font-weight:600">Item</td>
              <td style="border:1px solid #e5e7eb;padding:6px;background:#f9fafb;font-weight:600">To make</td>
            </tr>
            ${rows}
          </table>
          ${skipped ? `<p>${skipped} line${skipped > 1 ? 's were' : ' was'} skipped — already being made on an open work order.</p>` : ''}
          <p>Raised by ${requestedBy || 'the Order Pipeline'}.<br>
             <a href="https://beyondgreen-erp.vercel.app/production/work-orders">Open the Work Orders board</a></p>
          <p style="color:#6b7280;font-size:12px">Sent from the beyondGREEN ERP when the stock check on ${orderRef} found a shortage.</p>
        </div>`
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: WORK_ORDER_APPROVERS,
          reply_to: requestedBy || undefined,
          subject: `${madeRows.length} work order${madeRows.length > 1 ? 's' : ''} awaiting approval — ${orderRef}${customer ? ` (${customer})` : ''}`,
          html,
        }),
      })
      emailed = res.ok
    } catch (e) { console.error('WO approval email failed:', e) }
  }

  return { created, count: created.length, skipped, emailed }
}

// ─── BOM component shortages → Purchase Request ──────────────────────────────

export interface ComponentShortage {
  component_sku: string
  component_name: string
  qty_required: number
  qty_on_hand: number
  qty_short: number
  uom: string
  product_id: string | null
  from_fgs: string[]
}

/**
 * For the finished-good shortages we must PRODUCE (qty_short each), explode each FG's BOM to its
 * components and report the components that are themselves short on hand. Same explosion the
 * Walmart/Chewy requirement boards use.
 */
export async function checkComponentShortages(shortages: ShortageItem[]): Promise<ComponentShortage[]> {
  const sb = createSupabaseBrowserClient()
  if (!shortages.length) return []

  const { data: boms } = await sb
    .from('product_bom')
    .select('finished_good_sku, component_sku, uom_type, qty_value, percentage, is_case_level')
  const bomByFg: Record<string, any[]> = {}
  for (const b of (boms ?? []) as any[]) {
    const k = String(b.finished_good_sku || '').trim().toUpperCase()
    if (!k) continue
    ;(bomByFg[k] ||= []).push(b)
  }

  const { data: fgProds } = await sb
    .from('products')
    .select('sku, weight_per_unit_grams, case_qty')
    .in('sku', shortages.map(s => s.sku))
  const fgAttr: Record<string, any> = {}
  for (const pr of (fgProds ?? []) as any[]) fgAttr[String(pr.sku || '').trim().toUpperCase()] = pr

  const need: Record<string, { qty: number; fgs: Set<string> }> = {}
  for (const sh of shortages) {
    const fsku = String(sh.sku).trim().toUpperCase()
    const rows = bomByFg[fsku]
    if (!rows || !rows.length) continue
    const fp = fgAttr[fsku] || {}
    for (const bb of rows) {
      const cs = String(bb.component_sku || '').trim().toUpperCase()
      if (!cs) continue
      let perUnit = 0
      if (bb.uom_type === 'percentage') perUnit = ((Number(bb.qty_value ?? bb.percentage) || 0) / 100) * (Number(fp.weight_per_unit_grams) || 0) / 453.592
      else if (bb.is_case_level) { const cq = Number(fp.case_qty) || 0; perUnit = cq > 0 ? (Number(bb.qty_value) || 0) / cq : 0 }
      else perUnit = Number(bb.qty_value) || 0
      const q = perUnit * sh.qty_short
      if (q <= 0) continue
      const e = (need[cs] ||= { qty: 0, fgs: new Set<string>() })
      e.qty += q
      e.fgs.add(sh.sku)
    }
  }

  const out: ComponentShortage[] = []
  for (const [cs, info] of Object.entries(need)) {
    const { data: cp } = await sb
      .from('products')
      .select('id, product_name, on_hand_qty, unit_of_measure')
      .eq('sku', cs)
      .maybeSingle()
    const onHand = Number((cp as any)?.on_hand_qty ?? 0)
    const req = Math.round(info.qty * 100) / 100
    if (onHand < req) {
      out.push({
        component_sku: cs,
        component_name: (cp as any)?.product_name ?? cs,
        qty_required: req,
        qty_on_hand: onHand,
        qty_short: Math.round((req - onHand) * 100) / 100,
        uom: (cp as any)?.unit_of_measure ?? 'lb',
        product_id: (cp as any)?.id ?? null,
        from_fgs: [...info.fgs],
      })
    }
  }
  return out
}

/** Finance-approval bucket on the Purchasing Requests board. */
export const PR_FINANCE_GROUP = { key: 'group_finance_approval', title: 'Waiting on Finance Approval' }

/**
 * Raise ONE purchasing request (with a line per short component) into the
 * "Waiting on Finance Approval" group, sourced from the sales order.
 */
export async function createPurchaseRequestForShortages(
  orderId: string,
  components: ComponentShortage[],
  requestedBy?: string | null,
): Promise<{ id: string | null; count: number }> {
  const sb = createSupabaseBrowserClient()
  if (!components.length) return { id: null, count: 0 }

  const { data: order } = await sb
    .from('sales_orders')
    .select('order_number, customers(company_name)')
    .eq('id', orderId)
    .maybeSingle()
  const o: any = order
  const orderRef = o?.order_number ?? orderId.slice(0, 8)
  const customer = o?.customers?.company_name ?? ''

  const names = components.map(c => c.component_sku)
  const headerName = names.length === 1 ? names[0] : `${names[0]} + ${names.length - 1} more`

  const { data: header, error: hErr } = await sb
    .from('purchasing_requests')
    .insert({
      name: `${headerName} — for ${orderRef}${customer ? ` (${customer})` : ''}`,
      group_key: PR_FINANCE_GROUP.key,
      group_title: PR_FINANCE_GROUP.title,
      status: 'Pending Review',
      person_requesting: requestedBy || 'system',
      order_ref: orderRef,
      customer_project: customer || null,
      source: 'auto_shortage',
      source_sales_order_id: orderId,
    })
    .select('id')
    .single()

  if (hErr) { console.error('PR header insert error:', hErr.message); return { id: null, count: 0 } }
  const reqId = (header as any)?.id
  if (!reqId) return { id: null, count: 0 }

  const lineRows = components.map((c, i) => ({
    parent_id: reqId,
    name: c.component_name,
    part_number: c.component_sku,
    description: `Short ${c.qty_short} ${c.uom} for ${orderRef} (need ${c.qty_required}, on hand ${c.qty_on_hand}). Used in: ${c.from_fgs.join(', ')}`,
    qty_ordered: String(c.qty_short),
    position: i,
    product_id: c.product_id ?? null,
  }))
  const { error: iErr } = await sb.from('purchasing_request_items').insert(lineRows)
  if (iErr) console.error('PR items insert error:', iErr.message)

  return { id: reqId, count: components.length }
}

// ─── Check if All Work Orders Complete → auto-move to shipping ───────────────

export async function checkOrderReadyToShip(orderId: string): Promise<{ readyToShip: boolean; pending: number }> {
  const sb = createSupabaseBrowserClient()

  const { data: wos } = await sb
    .from('work_orders')
    .select('id, status')
    .eq('sales_order_id', orderId)

  if (!wos || wos.length === 0) return { readyToShip: false, pending: 0 }

  const pending = (wos as any[]).filter(w => !['Complete', 'QC Passed', 'Cancelled'].includes(w.status)).length

  if (pending === 0) {
    // Actually advance the order's status (onStatusChange only queues + notifies, it does not
    // set the status field), so every caller — QC screen, work-orders board — moves it forward.
    await sb.from('sales_orders').update({ status: 'Ready to Ship', updated_at: new Date().toISOString() }).eq('id', orderId)
    await onStatusChange(orderId, 'Ready to Ship', 'Awaiting Production')
    return { readyToShip: true, pending: 0 }
  }

  return { readyToShip: false, pending }
}

// ─── Work Order Approval ──────────────────────────────────────────────────────

export async function approveWorkOrder(
  workOrderId: string,
  approvedBy: string,
  machine: string,
  scheduledDate: string,
  operator: string,
  priority: string
): Promise<{ success: boolean; message: string }> {
  const sb = createSupabaseBrowserClient()

  const { data: wo } = await sb.from('work_orders').select('notes').eq('id', workOrderId).single()
  const existingNotes = (wo as any)?.notes ?? ''

  await sb.from('work_orders').update({
    status: 'In Progress',
    due_date: scheduledDate || null,
    notes: `${existingNotes}\nAPPROVED by ${approvedBy} | Machine: ${machine} | Operator: ${operator} | Priority: ${priority}`,
  }).eq('id', workOrderId)

  return { success: true, message: 'Work order approved and scheduled' }
}

// ─── Complete Work Order → inventory + lot + check order ─────────────────────

export async function completeWorkOrder(
  workOrderId: string,
  lotNumber: string,
  qtyProduced: number
): Promise<{ success: boolean; message: string }> {
  const sb = createSupabaseBrowserClient()

  const { data: wo } = await sb.from('work_orders').select('*').eq('id', workOrderId).single()
  if (!wo) return { success: false, message: 'Work order not found' }

  await sb.from('work_orders')
    .update({ status: 'Complete', qty_produced: qtyProduced })
    .eq('id', workOrderId)

  // Parse product info from notes (format: AUTO|product_name|SOREF:id|...)
  const notes: string = (wo as any).notes ?? ''
  const noteParts = notes.split('|')
  const productName = noteParts[1] ?? ''
  const skuMatch = notes.match(/Need \d+ of ([^\s]+) for/)
  const sku = skuMatch?.[1] ?? null

  // Create lot code (silent fail if table doesn't exist)
  try {
    await sb.from('lot_codes').insert({
      lot_number: lotNumber,
      sku,
      product_name: productName || sku,
      qty_produced: qtyProduced,
      qty_remaining: qtyProduced,
      produced_date: new Date().toISOString().split('T')[0],
      work_order_id: workOrderId,
      sales_order_id: (wo as any).sales_order_id,
      status: 'Active',
    })
  } catch { /* lot_codes table optional */ }

  // Update inventory. Closing a lot was the one stock-writing path that moved the
  // quantity without recording a movement, so the item's Activity showed nothing and
  // the on-hand figure appeared to change by itself.
  if (sku) {
    const { data: prod } = await sb.from('products').select('id, on_hand_qty, unit_of_measure').eq('sku', sku).maybeSingle()
    if (prod) {
      await sb.from('products')
        .update({ on_hand_qty: ((prod as any).on_hand_qty ?? 0) + qtyProduced })
        .eq('sku', sku)
      try {
        await sb.from('inventory_movements').insert({
          product_id: (prod as any).id, sku, movement_type: 'produce', qty: qtyProduced,
          uom: (prod as any).unit_of_measure || null, lot_number: lotNumber,
          ref_table: 'production', ref_id: workOrderId,
          note: `Lot ${lotNumber} closed`, created_by: null,
        })
      } catch { /* never block the lot close on activity logging */ }
    }
  }

  // Check if linked sales order is now fully complete
  const soId = (wo as any).sales_order_id
  if (soId) await checkOrderReadyToShip(soId)

  return { success: true, message: `Lot ${lotNumber} created · Inventory updated` }
}

// ─── Add to Shipping Queue (standalone helper used by WorkflowMover) ─────────

export async function addToShippingQueue(orderId: string): Promise<void> {
  const sb = createSupabaseBrowserClient()
  const { data: existing } = await sb
    .from('shipping_queue')
    .select('id')
    .eq('order_id', orderId)
    .maybeSingle()
  if (existing) return

  const { data: order } = await sb
    .from('sales_orders')
    .select('order_number, notes, customer_id, customers(company_name)')
    .eq('id', orderId)
    .maybeSingle()

  const customerName =
    (order?.customers as any)?.company_name ||
    (order?.notes ?? '').split('|')[0].trim() || ''

  await sb.from('shipping_queue').insert({
    order_id: orderId,
    carrier: null,
    tracking_number: null,
    scheduled_ship_date: null,
    actual_ship_date: null,
    status: 'Pending',
    notes: `Auto-added: ${customerName} — ${(order as any)?.order_number ?? ''}`,
  })
}

// ─── Main Status Change Handler ───────────────────────────────────────────────

export interface FlowResult {
  success: boolean
  message: string
  undoData?: any
}

export async function onStatusChange(
  orderId: string,
  newStatus: OrderStatus,
  prevStatus: OrderStatus,
  shipDetails?: { carrier?: string; trackingNumber?: string; shipDate?: string }
): Promise<FlowResult> {
  const sb = createSupabaseBrowserClient()

  // ── Notify + log every real status transition so nothing slips silently ──
  if (newStatus !== prevStatus) {
    try {
      const { data: o } = await sb.from('sales_orders').select('order_number').eq('id', orderId).maybeSingle()
      const ref = (o as any)?.order_number || orderId.slice(0, 8)
      await sb.from('comments').insert({ record_type: 'sales_order', record_id: orderId, author_email: 'system', content: `Status: ${prevStatus} → ${newStatus}` })
      for (const r of ['rudyp@beyondgreenbiotech.com', 'accounting@byndgrn.com']) {
        await sb.from('notifications').insert({ recipient_email: r, sender_email: 'system', message: `Order ${ref}: ${prevStatus} → ${newStatus}`, page: 'Sales Orders', is_read: false, context_url: `/sales/orders?item=${orderId}` })
      }
    } catch { /* notifications are best-effort */ }
  }

  // ── Customer confirmation email (flag-gated; off by default) ──
  if (newStatus === 'Confirmed' && prevStatus !== 'Confirmed') { try { await emailCustomerOnStatus(orderId, 'confirmed') } catch { /* */ } }

  // ── IN PRODUCTION / READY TO SHIP / WILL CALL → auto-add to shipping queue ──
  // "In Production" is included so operators/packers can print Case Labels DURING
  // production (the Label Wizard lives on the Shipping Queue), not only at the end.
  if (newStatus === 'In Production' || newStatus === 'Ready to Ship' || newStatus === 'Ready at Will Call') {
    const { data: existing } = await sb
      .from('shipping_queue')
      .select('id')
      .eq('order_id', orderId)
      .maybeSingle()

    if (!existing) {
      const { data: order } = await sb
        .from('sales_orders')
        .select('order_number, notes, customer_id, customers(company_name)')
        .eq('id', orderId)
        .maybeSingle()

      const customerName =
        (order?.customers as any)?.company_name ||
        (order?.notes ?? '').split('|')[0].trim() || ''

      await sb.from('shipping_queue').insert({
        order_id: orderId,
        carrier: null,
        tracking_number: null,
        scheduled_ship_date: null,
        actual_ship_date: null,
        status: 'Pending',
        notes: `Auto-added: ${customerName} — ${order?.order_number ?? ''}`,
      })
    }

    return {
      success: true,
      message: newStatus === 'In Production'
        ? `Order added to Shipping Queue — Case Labels now available`
        : `Order added to Shipping Queue`,
      undoData: { action: 'remove_from_queue', orderId, prevStatus },
    }
  }

  // ── SHIPPED → delegate to shipOrder so there is ONE shipping code path ──
  // Previously this branch shipped the FULL ordered quantity of every line and
  // invoiced the FULL order total, ignoring anything already shipped. Flipping the
  // status to Shipped after a partial therefore double-billed the customer and
  // reported the whole order as gone. It now ships only the outstanding balance.
  if (newStatus === 'Shipped') {
    const { data: soLines } = await sb
      .from('sales_order_lines')
      .select('id, sku, description, quantity, quantity_shipped, unit_price, unit_of_measure')
      .eq('sales_order_id', orderId)

    const shipLines: ShipLineInput[] = ((soLines ?? []) as any[]).map(l => {
      const quantity = Number(l.quantity) || 0
      const already = Number(l.quantity_shipped) || 0
      return {
        id: l.id,
        sku: l.sku,
        description: l.description,
        unit_price: l.unit_price != null ? Number(l.unit_price) : 0,
        unit_of_measure: l.unit_of_measure,
        quantity,
        quantity_shipped: already,
        qtyToShip: Math.max(0, quantity - already),
      }
    })

    const outstanding = shipLines.reduce((s, l) => s + l.qtyToShip, 0)
    if (outstanding <= 0) {
      await sb.from('sales_orders').update({ status: 'Shipped', updated_at: new Date().toISOString() }).eq('id', orderId)
      await sb.from('shipping_queue').delete().eq('order_id', orderId)
      return { success: true, message: 'Order closed — every line was already shipped and invoiced.' }
    }

    return await shipOrder(orderId, shipLines, {
      carrier: shipDetails?.carrier,
      trackingNumber: shipDetails?.trackingNumber,
      shipDate: shipDetails?.shipDate,
      notes: 'Closed out from the order pipeline',
    })
  }

  return { success: true, message: `Status → ${newStatus}` }
}

// ─── Activity Log ─────────────────────────────────────────────────────────────

// ─── Ship Order (partial or full) ─────────────────────────────────────────────

export interface ShipLineInput {
  id: string
  sku: string | null
  description: string | null
  unit_price: number | null
  unit_of_measure?: string | null
  quantity: number
  quantity_shipped: number
  qtyToShip: number
}

export async function shipOrder(
  orderId: string,
  shipLines: ShipLineInput[],
  shipDetails?: { carrier?: string; trackingNumber?: string; shipDate?: string; notes?: string }
): Promise<FlowResult> {
  const sb = createSupabaseBrowserClient()
  const today = new Date().toISOString().split('T')[0]
  const shipDate = shipDetails?.shipDate ?? today

  const toShip = shipLines.filter(l => (l.qtyToShip ?? 0) > 0)
  if (toShip.length === 0) return { success: false, message: 'Nothing to ship — enter a quantity greater than zero.' }

  const { data: order } = await sb
    .from('sales_orders')
    .select('*, customers(company_name, email)')
    .eq('id', orderId)
    .maybeSingle()
  const customerName = (order?.customers as any)?.company_name || ((order as any)?.notes ?? '').split('|')[0].trim() || ''
  const orderRef = (order as any)?.order_number ?? orderId.slice(0, 8)
  const shippedSummary = toShip.map(l => `${l.qtyToShip}× ${l.sku || l.description || ''}`.trim()).join(', ')

  // Value of THIS shipment only — not the order's. The Daily Ship Report and billing
  // both read it, and it has to be known before the shipment row is written.
  const shippedValue = toShip.reduce((sum, l) => sum + l.qtyToShip * (l.unit_price ?? 0), 0)

  // 1. Shipment record
  //
  // This row is what the order's Shipment Log lists, and what the packing list counts to
  // work out which partial it is printing. Both look the shipment up by sales_order_id.
  // That column was never set, so every shipment was orphaned: the log stayed empty, and
  // "prior shipments" counted 0 every time, which is why every packing list came out as
  // PARTIAL SHIPMENT #1.
  const { data: shipment, error: shipErr } = await sb.from('shipments').insert({
    sales_order_id: orderId,
    order_id: orderId,
    customer_name: customerName,
    customer_email: (order as any)?.customer_email ?? (order as any)?.customers?.email ?? null,
    ship_to_address: (order as any)?.shipping_address ?? null,
    po_number: orderRef,
    order_date: (order as any)?.order_date ?? null,
    ship_date: shipDate,
    carrier: shipDetails?.carrier ?? null,
    tracking_number: shipDetails?.trackingNumber ?? null,
    delivery_status: 'Shipped',
    // This function creates its own invoice below (step 3) for exactly this shipment's
    // value — app_billed tells the DB's auto-bill trigger to skip it, or every shipment
    // from this flow would get billed twice (once here, once by the trigger).
    app_billed: true,
    total_value: shippedValue,
    notes: `Shipment for ${orderRef}: ${shippedSummary}${shipDetails?.notes ? ' — ' + shipDetails.notes : ''}`,
  }).select('id').maybeSingle()
  if (shipErr) console.error('shipment insert error:', shipErr.message)
  const shipmentId = (shipment as any)?.id as string | undefined

  // 1b. What actually went in this shipment.
  //
  // Without these rows the log can say a shipment happened but not what was in it, which
  // is the difference between a tracker and a record. Best-effort: a failure here must not
  // cost the stock movement and invoice below.
  if (shipmentId) {
    const lineRows = toShip.map(l => ({
      shipment_id: shipmentId,
      order_line_id: l.id,
      sku: l.sku ?? null,
      product_name: l.description ?? null,
      qty_shipped: l.qtyToShip,
    }))
    const { error: slErr } = await sb.from('shipment_lines').insert(lineRows)
    if (slErr) console.error('shipment_lines insert error:', slErr.message)
  }

  // 2. Increment quantity_shipped + deduct inventory (shipped qty only)
  const inventoryChanges: { sku: string; qty: number; prevQty: number }[] = []
  for (const l of toShip) {
    const newShipped = (l.quantity_shipped ?? 0) + l.qtyToShip
    // completed_qty is what the order form shows as "Done" and what the Partially Shipped
    // banner totals. It was never advanced on a shipment, so both read zero however much
    // had gone out. Worse, saving the order writes quantity_shipped back FROM the Done box,
    // so an untouched save after a partial used to reset the shipped quantity to zero.
    // Keeping the two in step is what makes the figure survive an edit.
    await sb.from('sales_order_lines').update({ quantity_shipped: newShipped, completed_qty: newShipped }).eq('id', l.id)
    if (l.sku) {
      const { data: prod } = await sb.from('products').select('id, on_hand_qty, unit_of_measure').eq('sku', l.sku).maybeSingle()
      if (prod) {
        const prevQty = (prod as any).on_hand_qty ?? 0
        await sb.from('products').update({ on_hand_qty: Math.max(0, prevQty - l.qtyToShip) }).eq('sku', l.sku)
        await sb.from('inventory_movements').insert({ product_id: (prod as any).id, sku: l.sku, movement_type: 'ship', qty: -l.qtyToShip, uom: (prod as any).unit_of_measure ?? null, ref_table: 'sales_orders', ref_id: orderId, created_by: 'system', note: `Partial shipment on order ${orderRef}` })
        inventoryChanges.push({ sku: l.sku, qty: l.qtyToShip, prevQty })
      }
    }
  }

  // 3. Partial invoice for the shipped value only
  const invNum = 'INV-' + new Date().getFullYear() + '-' + Date.now().toString().slice(-5)
  const { data: invoice, error: invErr } = await sb.from('invoices').insert({
    invoice_number: invNum, invoice_number_display: invNum, invoice_type: 'invoice',
    customer_id: (order as any)?.customer_id ?? null, sales_order_id: orderId,
    invoice_date: today, due_date: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
    status: 'pending', subtotal: shippedValue, total_amount: shippedValue, balance_due: shippedValue,
    amount_paid: 0, payment_terms: 'Net 30', po_number: orderRef,
    notes: `Auto-created for shipment on ${shipDate}: ${shippedSummary}`,
  }).select('id').maybeSingle()
  if (invErr) console.error('invoice insert error:', invErr.message)
  if ((invoice as any)?.id) {
    const rows = toShip.map(l => ({
      invoice_id: (invoice as any).id, sku: l.sku ?? null, description: l.description ?? '',
      quantity: l.qtyToShip, unit_price: l.unit_price ?? 0, uom: l.unit_of_measure ?? null,
      line_total: l.qtyToShip * (l.unit_price ?? 0),
    }))
    if (rows.length) await sb.from('invoice_line_items').insert(rows)
  }

  // 4. Fully vs partially shipped (re-read all lines)
  const { data: allLines } = await sb.from('sales_order_lines').select('quantity, quantity_shipped').eq('sales_order_id', orderId)
  const fullyShipped = (allLines ?? []).length > 0 && (allLines as any[]).every(l => (l.quantity_shipped ?? 0) >= (l.quantity ?? 0))
  const newStatus = fullyShipped ? 'Shipped' : 'Partially Shipped'
  await sb.from('sales_orders').update({ status: newStatus, ship_date: shipDate, updated_at: new Date().toISOString() }).eq('id', orderId)
  // The log badges a shipment Final or Partial from this.
  if (shipmentId) await sb.from('shipments').update({ status: fullyShipped ? 'Shipped' : 'Partially Shipped' }).eq('id', shipmentId)
  if (fullyShipped) {
    await sb.from('shipping_queue').delete().eq('order_id', orderId)
  } else {
    await sb.from('shipping_queue').update({
      status: 'Partially Shipped',
      carrier: shipDetails?.carrier ?? null,
      tracking_number: shipDetails?.trackingNumber ?? null,
      actual_ship_date: shipDate,
    }).eq('order_id', orderId)
  }

  // 5. Log + notify
  try {
    await sb.from('comments').insert({ record_type: 'sales_order', record_id: orderId, author_email: 'system', content: `${fullyShipped ? 'Shipped' : 'Partially shipped'}: ${shippedSummary} · Invoice ${invNum}` })
    for (const r of ['rudyp@beyondgreenbiotech.com', 'accounting@byndgrn.com']) {
      await sb.from('notifications').insert({ recipient_email: r, sender_email: 'system', message: `Order ${orderRef} ${fullyShipped ? 'shipped' : 'partially shipped'}: ${shippedSummary}`, page: 'Shipping Queue', is_read: false, context_url: `/sales/orders?item=${orderId}` })
    }
  } catch { /* best-effort */ }

  if (fullyShipped) { try { await emailCustomerOnStatus(orderId, 'shipped', { carrier: shipDetails?.carrier, tracking: shipDetails?.trackingNumber, shipDate }) } catch { /* */ } }

  return {
    success: true,
    message: fullyShipped ? `Shipped ✓  Invoice ${invNum} created` : `Partial shipment ✓  Invoice ${invNum} · order stays in queue`,
    undoData: { action: 'undo_ship', orderId, prevStatus: ((order as any)?.status ?? 'Ready to Ship'), invoiceId: (invoice as any)?.id, shipmentId: (shipment as any)?.id, inventoryChanges, shippedLines: toShip.map(l => ({ id: l.id, qty: l.qtyToShip })) },
  }
}

// ─── Customer status emails (flag-gated; OFF by default via erp_settings.customer_emails) ───

async function emailCustomerOnStatus(orderId: string, kind: 'confirmed' | 'shipped', opts?: { carrier?: string | null; tracking?: string | null; shipDate?: string | null }): Promise<void> {
  const sb = createSupabaseBrowserClient()
  const { data: flag } = await sb.from('erp_settings').select('value').eq('key', 'customer_emails').maybeSingle()
  if ((((flag as any)?.value) || 'off') !== 'on') return
  const { data: order } = await sb.from('sales_orders').select('order_number, po_number, customer_email, customers(company_name, email)').eq('id', orderId).maybeSingle()
  const to = (order as any)?.customer_email || (order as any)?.customers?.email
  if (!to) return
  const ref = (order as any)?.order_number || (order as any)?.po_number || 'your order'
  const company = (order as any)?.customers?.company_name || 'there'
  let subject = ''
  let html = ''
  if (kind === 'confirmed') {
    subject = `Order confirmed — ${ref}`
    html = `<p>Hi ${company},</p><p>Thank you for your order. We have confirmed <b>${ref}</b> and it is now in our production queue. We will follow up with lead time and shipping details.</p><p>— beyondGREEN</p>`
  } else {
    const track = opts?.tracking ? ` Tracking: <b>${opts.tracking}</b>${opts?.carrier ? ' (' + opts.carrier + ')' : ''}.` : ''
    subject = `Your order has shipped — ${ref}`
    html = `<p>Hi ${company},</p><p>Good news — your order <b>${ref}</b> has shipped${opts?.shipDate ? ' on ' + opts.shipDate : ''}.${track}</p><p>— beyondGREEN</p>`
  }
  try {
    await fetch('/api/send-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, cc: 'accounting@byndgrn.com', subject, html }) })
    await sb.from('comments').insert({ record_type: 'sales_order', record_id: orderId, author_email: 'system', content: `Customer email sent (${kind}) to ${to}` })
  } catch { /* email is best-effort */ }
}

export async function logActivity(soId: string, userEmail: string, message: string): Promise<void> {
  const sb = createSupabaseBrowserClient()
  await sb.from('comments').insert({
    record_type: 'sales_order',
    record_id: soId,
    author_email: userEmail || 'system',
    content: message,
  })
}

// ─── Undo Engine ──────────────────────────────────────────────────────────────

export async function undoFlow(undoData: any): Promise<FlowResult> {
  const sb = createSupabaseBrowserClient()

  if (undoData.action === 'remove_from_queue') {
    await sb.from('shipping_queue').delete().eq('order_id', undoData.orderId)
    await sb.from('sales_orders')
      .update({ status: undoData.prevStatus, updated_at: new Date().toISOString() })
      .eq('id', undoData.orderId)
    return { success: true, message: 'Removed from Shipping Queue — status restored' }
  }

  if (undoData.action === 'undo_ship') {
    await sb.from('sales_orders')
      .update({ status: undoData.prevStatus, ship_date: null, updated_at: new Date().toISOString() })
      .eq('id', undoData.orderId)

    if (undoData.invoiceId) {
      await sb.from('invoices').update({ status: 'void' }).eq('id', undoData.invoiceId)
    }

    if (undoData.shipmentId) {
      await sb.from('shipments').delete().eq('id', undoData.shipmentId)
    }

    for (const change of (undoData.inventoryChanges ?? [])) {
      if (!change.sku) continue
      const { data: prod } = await sb.from('products').select('id, unit_of_measure').eq('sku', change.sku).maybeSingle()
      await sb.from('products').update({ on_hand_qty: change.prevQty }).eq('sku', change.sku)
      if (prod) await sb.from('inventory_movements').insert({ product_id: (prod as any).id, sku: change.sku, movement_type: 'adjust', qty: change.qty, uom: (prod as any).unit_of_measure ?? null, ref_table: 'sales_orders', ref_id: undoData.orderId ?? null, created_by: 'system', note: 'Reversed shipment (undo)' })
    }

    // Reverse per-line shipped quantities (partial shipments)
    for (const sl of (undoData.shippedLines ?? [])) {
      if (!sl.id) continue
      const { data: ln } = await sb.from('sales_order_lines').select('quantity_shipped').eq('id', sl.id).maybeSingle()
      if (ln) {
        const back = Math.max(0, ((ln as any).quantity_shipped ?? 0) - (sl.qty ?? 0))
        // Both, or the Done box would keep claiming the undone units.
        await sb.from('sales_order_lines').update({ quantity_shipped: back, completed_qty: back }).eq('id', sl.id)
      }
    }

    return { success: true, message: 'Ship undone — inventory restored, invoice voided' }
  }

  return { success: false, message: 'Nothing to undo' }
}
