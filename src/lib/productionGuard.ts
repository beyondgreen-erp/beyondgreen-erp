// A production entry that is far outside the normal range for an item is refused by the
// posting function with an OUTSIZED_ENTRY message. A case of some items is 1,000 pieces,
// so one extra digit in the case count moves tons of raw material. Show the person what
// the figure looks like against the item's history, and only post it if they say it is
// right. Confirming records a short-lived, single-use override and posts again.

type Rpc = 'inventory_record_production' | 'inventory_post_daily_production'

export async function rpcWithSizeCheck(
  sb: any,
  fn: Rpc,
  args: Record<string, any>,
  productId: string,
  qty: number,
): Promise<any> {
  const first = await sb.rpc(fn, args)
  const msg = String(first?.error?.message || '')
  if (!msg.includes('OUTSIZED_ENTRY')) return first

  const detail = msg.slice(msg.indexOf('OUTSIZED_ENTRY:') + 'OUTSIZED_ENTRY:'.length).trim()
  if (typeof window === 'undefined') return first
  if (!window.confirm(detail + '\n\nPost it anyway?')) {
    return { data: null, error: { message: 'Entry not posted. Please correct the figure and try again.' } }
  }

  const confirmed = await sb.rpc('production_entry_confirm', { p_product_id: productId, p_qty: qty })
  if (confirmed?.error) return confirmed
  return await sb.rpc(fn, args)
}
