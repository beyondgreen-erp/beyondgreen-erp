/* eslint-disable @typescript-eslint/no-explicit-any */
import { createSupabaseBrowserClient } from '@/lib/supabase'

export type OrderStatus =
  | 'Pending' | 'New' | 'Confirmed' | 'Awaiting Production'
  | 'Awaiting BOM Components' | 'In Production'
  | 'Production Complete' | 'QC' | 'Ready to Ship'
  | 'Ready at Will Call' | 'Shipped'
  | 'Partially Shipped' | 'On Hold' | 'Cancelled' | 'Closed'

export interface InventoryCheckResult {
  sufficient: boolean
  shortages: Array<{ sku: string; needed: number; available: number }>
}

export async function checkInventoryForOrder(orderId: string): Promise<InventoryCheckResult> {
  const sb = createSupabaseBrowserClient()
  const { data: lines } = await sb.from('sales_order_lines').select('sku, quantity').eq('sales_order_id', orderId)
  if (!lines?.length) return { sufficient: true, shortages: [] }
  const shortages: InventoryCheckResult['shortages'] = []
  for (const line of lines as any[]) {
    if (!line.sku || !line.quantity) continue
    const { data: prod } = await sb.from('products').select('on_hand_qty').eq('sku', line.sku).maybeSingle()
    const available = (prod as any)?.on_hand_qty ?? 0
    if (available < line.quantity) shortages.push({ sku: line.sku, needed: line.quantity, available })
  }
  return { sufficient: shortages.length === 0, shortages }
}

export async function addToShippingQueue(orderId: string): Promise<void> {
  const sb = createSupabaseBrowserClient()
  const { data: existing } = await sb.from('shipping_queue').select('id').eq('sales_order_id', orderId).eq('is_active', true).maybeSingle()
  if (existing) return
  const { data: order } = await sb.from('sales_orders').select('order_number, notes, customer_id').eq('id', orderId).maybeSingle()
  await sb.from('shipping_queue').insert({
    sales_order_id: orderId,
    carrier: null,
    tracking_number: null,
    scheduled_ship_date: null,
    actual_ship_date: null,
    status: 'Pending',
    notes: `Auto-added: ${order?.order_number ?? ''}`,
    is_active: true,
  })
}

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
      .eq('sales_order_id', orderId)
      .maybeSingle()

    if (!existing) {
      const { data: order } = await sb
        .from('sales_orders')
        .select('order_number, notes, customer_id, customers(company_name)')
        .eq('id', orderId)
        .maybeSingle()

      const customerName =
        (order?.customers as any)?.company_name ||
        (order?.notes ?? '').split('|')[0].trim() ||
        ''

      await sb.from('shipping_queue').insert({
        sales_order_id: orderId,
        carrier: null,
        tracking_number: null,
        scheduled_ship_date: null,
        actual_ship_date: null,
        status: 'Pending',
        notes: `Auto-added: ${customerName} — ${order?.order_number ?? ''}`,
        is_active: true,
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

    // 1. Create shipment record in shipments table
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

    // 2. Deduct inventory
    const inventoryChanges: { sku: string; qty: number; prevQty: number }[] = []
    for (const line of lines) {
      if (!line.sku || !line.quantity) continue
      const { data: prod } = await sb
        .from('products')
        .select('on_hand_qty')
        .eq('sku', line.sku)
        .maybeSingle()
      if (prod) {
        const prevQty = prod.on_hand_qty ?? 0
        const newQty = Math.max(0, prevQty - (line.quantity ?? 0))
        await sb.from('products').update({ on_hand_qty: newQty }).eq('sku', line.sku)
        inventoryChanges.push({ sku: line.sku, qty: line.quantity, prevQty })
      }
    }

    // 3. Auto-create invoice
    const invNum = 'INV-' + new Date().getFullYear() + '-' + Date.now().toString().slice(-5)
    const totalAmt = order?.total_amount ?? order?.total ?? 0

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

    // Copy line items to invoice_line_items
    if (invoice?.id && lines.length > 0) {
      const lineRows = lines
        .filter(l => l.sku || l.description)
        .map((l: any) => ({
          invoice_id: invoice.id,
          sku: l.sku ?? null,
          description: l.description ?? '',
          quantity: l.quantity ?? 1,
          unit_price: l.unit_price ?? 0,
          uom: l.unit_of_measure ?? null,
          line_total: (l.quantity ?? 1) * (l.unit_price ?? 0) * (1 - (l.discount_pct ?? 0) / 100),
        }))
      if (lineRows.length > 0) {
        await sb.from('invoice_line_items').insert(lineRows)
      }
    }

    // 4. Update order with ship date
    await sb.from('sales_orders')
      .update({ ship_date: shipDetails?.shipDate ?? today })
      .eq('id', orderId)

    // 5. Remove from shipping queue
    await sb.from('shipping_queue').delete().eq('sales_order_id', orderId)

    return {
      success: true,
      message: `Shipped ✓  Invoice ${invNum} created`,
      undoData: {
        action: 'undo_ship',
        orderId,
        prevStatus,
        invoiceId: invoice?.id,
        shipmentId: (shipment as any)?.id,
        inventoryChanges,
      },
    }
  }

  return { success: true, message: `Status → ${newStatus}` }
}

export async function undoFlow(undoData: any): Promise<FlowResult> {
  const sb = createSupabaseBrowserClient()

  if (undoData.action === 'remove_from_queue') {
    await sb.from('shipping_queue').delete().eq('sales_order_id', undoData.orderId)
    await sb.from('sales_orders')
      .update({ status: undoData.prevStatus, updated_at: new Date().toISOString() })
      .eq('id', undoData.orderId)
    return { success: true, message: 'Removed from Shipping Queue — status restored' }
  }

  if (undoData.action === 'undo_ship') {
    // Restore order status
    await sb.from('sales_orders')
      .update({ status: undoData.prevStatus, ship_date: null, updated_at: new Date().toISOString() })
      .eq('id', undoData.orderId)

    // Void invoice
    if (undoData.invoiceId) {
      await sb.from('invoices').update({ status: 'void' }).eq('id', undoData.invoiceId)
    }

    // Delete shipment
    if (undoData.shipmentId) {
      await sb.from('shipments').delete().eq('id', undoData.shipmentId)
    }

    // Restore inventory
    for (const change of (undoData.inventoryChanges ?? [])) {
      if (!change.sku) continue
      await sb.from('products')
        .update({ on_hand_qty: change.prevQty })
        .eq('sku', change.sku)
    }

    return { success: true, message: 'Ship undone — inventory restored, invoice voided' }
  }

  return { success: false, message: 'Nothing to undo' }
}
