// One rule for "how much are we billing on this line", shared by the invoice page
// and the PDF so the screen, the print-out and the customer's copy cannot drift.
//
// invoice_line_items.quantity is a snapshot taken when the bill was created. For
// most shipments that snapshot came from the ORDERED quantity, so a short shipment
// was billed in full: order 31683 billed 500 cups against 488 actually shipped.
// The order line is the record of what left the building, so it wins.

export interface QtyLine {
  sku?: string | null
  quantity: number
  unit_price: number
  line_total?: number | null
  ordered_quantity?: number | null
  shipped_quantity?: number | null
}

export interface OrderQtyRow {
  sku?: string | null
  quantity?: number | null
  quantity_shipped?: number | null
  completed_qty?: number | null
}

const key = (s: unknown) => String(s ?? '').trim().toUpperCase()
const num = (v: unknown) => (v === null || v === undefined || v === '') ? null : Number(v)

/** Quantity to bill: what shipped when we know it, otherwise what was ordered. */
export function billedQty(l: QtyLine): number {
  const shipped = num(l.shipped_quantity)
  if (shipped !== null && shipped > 0) return shipped
  return Number(l.quantity) || 0
}

/** Line amount, always derived from the billed quantity, never a stale stored total. */
export function billedAmount(l: QtyLine): number {
  return billedQty(l) * (Number(l.unit_price) || 0)
}

/**
 * Attach ordered and shipped quantities to each invoice line from its order line.
 * Only an unambiguous SKU match counts: if an order carries two lines with the same
 * SKU there is no way to tell which one a bill line refers to, so we leave shipped
 * unset and fall back to the stored quantity rather than guess at a number that
 * ends up in front of a customer.
 */
export function withBilledQty<T extends QtyLine>(lines: T[], orderLines: OrderQtyRow[]): T[] {
  const bySku = new Map<string, OrderQtyRow[]>()
  for (const o of orderLines || []) {
    const k = key(o.sku)
    if (!k) continue
    bySku.set(k, [...(bySku.get(k) ?? []), o])
  }
  return (lines || []).map(l => {
    const matches = bySku.get(key(l.sku)) ?? []
    if (matches.length !== 1) return { ...l, ordered_quantity: null, shipped_quantity: null }
    const o = matches[0]
    const shipped = num(o.quantity_shipped) ?? num(o.completed_qty)
    return { ...l, ordered_quantity: num(o.quantity), shipped_quantity: shipped }
  })
}
