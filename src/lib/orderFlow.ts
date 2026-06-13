/* eslint-disable @typescript-eslint/no-explicit-any */
import { createSupabaseBrowserClient } from '@/lib/supabase'

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
    .select('id, sku, quantity, sku_flagged, description')
    .eq('sales_order_id', orderId)

  const shortages: ShortageItem[] = []
  const sufficient: SufficientItem[] = []

  for (const line of (lines ?? []) as any[]) {
    if (!line.sku || line.sku_flagged) continue
    const { data: prod } = await sb
      .from('products')
      .select('product_name, on_hand_qty')
      .eq('sku', line.sku)
      .maybeSingle()

    const onHand: number = (prod as any)?.on_hand_qty ?? 0
    const required: number = line.quantity ?? 0
    const productName: string = (prod as any)?.product_name ?? line.description ?? line.sku

    if (onHand < required) {
      shortages.push({
        sku: line.sku,
        product_name: productName,
        qty_required: required,
        qty_on_hand: onHand,
        qty_short: required - onHand,
        order_line_id: line.id,
      })
    } else {
      sufficient.push({ sku: line.sku, product_name: productName, qty_required: required, qty_on_hand: onHand })
    }
  }

  return { shortages, sufficient, allSufficient: shortages.length === 0 }
}

// ─── Create Work Orders for Shortages ────────────────────────────────────────

export async function createWorkOrdersForShortages(
  orderId: string,
  shortages: ShortageItem[]
): Promise<{ created: string[]; count: number }> {
  const sb = createSupabaseBrowserClient()

  const { data: order } = await sb
    .from('sales_orders')
    .select('order_number, customer_id')
    .eq('id', orderId)
    .maybeSingle()

  const orderRef = (order as any)?.order_number ?? orderId.slice(0, 8)
  const created: string[] = []

  for (const shortage of shortages) {
    const { data: wo, error } = await sb
      .from('work_orders')
      .insert({
        sales_order_id: orderId,
        qty_ordered: shortage.qty_short,
        qty_produced: 0,
        status: 'Queued',
        notes: `AUTO|${shortage.product_name}|SOREF:${orderId}|Need ${shortage.qty_short} of ${shortage.sku} for ${orderRef}. On hand: ${shortage.qty_on_hand}`,
      })
      .select('id')
      .single()

    if (error) { console.error('WO insert error:', error.message); continue }
    if (wo) created.push((wo as any).id)
  }

  await sb.from('sales_orders').update({ status: 'Awaiting Production' }).eq('id', orderId)

  return { created, count: created.length }
}

// ─── Check if All Work Orders Complete → auto-move to shipping ───────────────

export async function checkOrderReadyToShip(orderId: string): Promise<{ readyToShip: boolean; pending: number }> {
  const sb = createSupabaseBrowserClient()

  const { data: wos } = await sb
    .from('work_orders')
    .select('id, status')
    .eq('sales_order_id', orderId)

  if (!wos || wos.length === 0) return { readyToShip: false, pending: 0 }

  const pending = (wos as any[]).filter(w => !['Complete', 'Cancelled'].includes(w.status)).length

  if (pending === 0) {
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

  // Update inventory
  if (sku) {
    const { data: prod } = await sb.from('products').select('on_hand_qty').eq('sku', sku).maybeSingle()
    if (prod) {
      await sb.from('products')
        .update({ on_hand_qty: ((prod as any).on_hand_qty ?? 0) + qtyProduced })
        .eq('sku', sku)
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

  // ── READY TO SHIP / WILL CALL → auto-add to shipping queue ──────────────
  if (newStatus === 'Ready to Ship' || newStatus === 'Ready at Will Call') {
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
      message: `Order added to Shipping Queue`,
      undoData: { action: 'remove_from_queue', orderId, prevStatus },
    }
  }

  // ── SHIPPED → shipment + invoice + inventory deduction ──────────────────
  if (newStatus === 'Shipped') {
    const today = new Date().toISOString().split('T')[0]

    const { data: order } = await sb
      .from('sales_orders')
      .select('*, customers(company_name, email), sales_order_lines(*)')
      .eq('id', orderId)
      .maybeSingle()

    const customerName =
      (order?.customers as any)?.company_name ||
      (order?.notes ?? '').split('|')[0].trim() || ''
    const lines: any[] = (order as any)?.sales_order_lines ?? []

    // 1. Create shipment record
    const { data: shipment, error: shipErr } = await sb.from('shipments').insert({
      customer_name: customerName,
      po_number: order?.order_number ?? null,
      order_date: order?.order_date ?? null,
      ship_date: shipDetails?.shipDate ?? today,
      carrier: shipDetails?.carrier ?? null,
      tracking_number: shipDetails?.trackingNumber ?? null,
      delivery_status: 'Shipped',
      notes: `Auto-created from Sales Order ${order?.order_number ?? ''}`,
    }).select('id').maybeSingle()

    if (shipErr) console.error('shipment insert error:', shipErr.message)

    // 2. Deduct inventory per SKU
    const inventoryChanges: { sku: string; qty: number; prevQty: number }[] = []
    for (const line of lines) {
      if (!line.sku || !line.quantity) continue
      const { data: prod } = await sb
        .from('products')
        .select('on_hand_qty')
        .eq('sku', line.sku)
        .maybeSingle()
      if (prod) {
        const prevQty = (prod as any).on_hand_qty ?? 0
        const newQty = Math.max(0, prevQty - (line.quantity ?? 0))
        await sb.from('products').update({ on_hand_qty: newQty }).eq('sku', line.sku)
        inventoryChanges.push({ sku: line.sku, qty: line.quantity, prevQty })
      }
    }

    // 3. Auto-create invoice
    const invNum = 'INV-' + new Date().getFullYear() + '-' + Date.now().toString().slice(-5)
    const totalAmt = (order as any)?.total_amount ?? (order as any)?.total ?? 0

    const { data: invoice, error: invErr } = await sb.from('invoices').insert({
      invoice_number: invNum,
      invoice_number_display: invNum,
      invoice_type: 'invoice',
      customer_id: order?.customer_id ?? null,
      sales_order_id: orderId,
      invoice_date: today,
      due_date: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      status: 'pending',
      subtotal: totalAmt,
      total_amount: totalAmt,
      balance_due: totalAmt,
      amount_paid: 0,
      payment_terms: 'Net 30',
      po_number: order?.order_number ?? null,
      notes: `Auto-created when order shipped on ${today}`,
    }).select('id').maybeSingle()

    if (invErr) console.error('invoice insert error:', invErr.message)

    // 4. Copy line items to invoice_line_items
    if ((invoice as any)?.id && lines.length > 0) {
      const lineRows = lines
        .filter(l => l.sku || l.description)
        .map((l: any) => ({
          invoice_id: (invoice as any).id,
          sku: l.sku ?? null,
          description: l.description ?? '',
          quantity: l.quantity ?? 1,
          unit_price: l.unit_price ?? 0,
          uom: l.unit_of_measure ?? null,
          line_total: (l.quantity ?? 1) * (l.unit_price ?? 0),
        }))
      if (lineRows.length > 0) await sb.from('invoice_line_items').insert(lineRows)
    }

    // 5. Update order + remove from shipping queue
    await sb.from('sales_orders')
      .update({ ship_date: shipDetails?.shipDate ?? today })
      .eq('id', orderId)
    await sb.from('shipping_queue').delete().eq('order_id', orderId)

    return {
      success: true,
      message: `Shipped ✓  Invoice ${invNum} created`,
      undoData: {
        action: 'undo_ship',
        orderId,
        prevStatus,
        invoiceId: (invoice as any)?.id,
        shipmentId: (shipment as any)?.id,
        inventoryChanges,
      },
    }
  }

  return { success: true, message: `Status → ${newStatus}` }
}

// ─── Activity Log ─────────────────────────────────────────────────────────────

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
      await sb.from('products').update({ on_hand_qty: change.prevQty }).eq('sku', change.sku)
    }

    return { success: true, message: 'Ship undone — inventory restored, invoice voided' }
  }

  return { success: false, message: 'Nothing to undo' }
}
