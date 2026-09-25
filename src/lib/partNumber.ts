/* eslint-disable @typescript-eslint/no-explicit-any */
// One definition of "this has no usable part number", shared by the Order Pipeline and the
// Work Orders board so the two boards cannot disagree about it.
//
// The part number starts on the sales order line. A work order raised from that line inherits
// it, so a line that goes out without one carries the gap all the way to the floor and the
// finished goods are never booked into inventory. Both boards therefore flag the same thing
// the same way, and the flag clears the same way: when the number matches a real product.

/** A part number nobody has decided yet is not a SKU. These must never match a product. */
const PLACEHOLDER_PARTS = new Set([
  'tbd', 'tba', 'n/a', 'na', 'none', 'null', '-', '--', '?', 'x', 'xx', 'test', 'placeholder',
])

export const isPlaceholderPart = (v: any) =>
  PLACEHOLDER_PARTS.has(String(v ?? '').trim().toLowerCase())

/**
 * True when a line or work order still needs a part number.
 *
 * Missing means any of: nothing typed, a placeholder, or a number that is not linked to a
 * product. An unlinked number books no stock, so it is no better than a blank — which is why
 * the linked product, not the text, is what clears the flag.
 */
export const needsPartNumber = (row: { sku?: string | null; item_part_number?: string | null; product_id?: string | null }) => {
  const typed = String(row.sku ?? row.item_part_number ?? '').trim()
  return !row.product_id || !typed || isPlaceholderPart(typed)
}

// ── Who gets told ───────────────────────────────────────────────────────────
// Kept here rather than in the pages so there is one place to change a leaver or a new hire.

/** A part number is missing, on a sales order or on a work order. */
export const PART_NUMBER_APPROVERS = [
  'Shea@beyondgreenbiotech.com',
  'Finance@beyondgreenbiotech.com',
  'Veejay.patell@byndgrn.com',
  'Rudyp@beyondgreenbiotech.com',
]

/** A work order has been raised automatically and is waiting for someone to approve it. */
export const WORK_ORDER_APPROVERS = [
  'Veejay.patell@byndgrn.com',
  'Shea@beyondgreenbiotech.com',
  'Rudyp@beyondgreenbiotech.com',
  'robert@beyondgreenbiotech.com',
]

/** A purchase request has been raised automatically for a component that is not in stock.
 *  These people confirm & approve it (Vaishu / Finance, Rudy, Veejay). */
export const PURCHASE_REQUEST_APPROVERS = [
  'Finance@beyondgreenbiotech.com',
  'Rudyp@beyondgreenbiotech.com',
  'Veejay.patell@byndgrn.com',
]

/** A work order OR purchase request has been confirmed/approved — the whole group is told. */
export const FLOW_CONFIRMED_NOTIFY = [
  'Finance@beyondgreenbiotech.com',
  'robert@beyondgreenbiotech.com',
  'Shea@beyondgreenbiotech.com',
  'Veejay.patell@byndgrn.com',
  'Rudyp@beyondgreenbiotech.com',
]
