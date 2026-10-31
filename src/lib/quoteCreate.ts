/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Shared quote creation: the Q-<year>-#### numbering and the new-quote defaults the Quotations
 * page uses, so other screens (the Pricing Calculator) create quotes the same way.
 */

/** Quote statuses that are still open for new lines. Converted, Rejected and Expired are final. */
export const EDITABLE_QUOTE_STATUSES = ['Draft', 'Sent', 'Accepted']

/** Header fields a brand-new quote starts with (matches openNew on the Quotations page). */
export function newQuoteDefaults(): Record<string, any> {
  return {
    status: 'Draft',
    quote_date: new Date().toISOString().split('T')[0],
    expiry_date: new Date(Date.now() + 30 * 864e5).toISOString().split('T')[0],
    payment_terms: 'Net 30',
    notes: null,
    subtotal: 0,
    tax_pct: 0,
    total: 0,
    type: 'quote',
    doc_style: 'official',
    price_term: 'ddp',
    export_country: 'China',
    client_portal_visible: false,
    client_portal_name: null,
    billing_address: null,
    shipping_address: null,
  }
}

/**
 * Insert a quotation with the next free Q-<year>-#### number. Next number = highest existing
 * number this year + 1, retried on a unique-key clash so concurrent creates cannot collide.
 */
export async function insertQuotationWithNumber(
  sb: any,
  quoteData: Record<string, any>,
): Promise<{ id: string; quote_number: string } | { error: string }> {
  const year = new Date().getFullYear()
  const { data: existingNums } = await sb.from('quotations').select('quote_number').ilike('quote_number', `Q-${year}-%`)
  let maxN = 0
  const numRe = new RegExp(`^Q-${year}-(\\d+)$`)
  for (const r of (existingNums as any[] | null) || []) {
    const m = numRe.exec(String(r?.quote_number || ''))
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10))
  }
  for (let attempt = 0; attempt < 25; attempt++) {
    const qNum = `Q-${year}-${String(maxN + 1 + attempt).padStart(4, '0')}`
    const { data, error } = await sb.from('quotations').insert({ ...quoteData, quote_number: qNum }).select('id').single()
    if (!error && data) return { id: (data as any).id, quote_number: qNum }
    if (error && (error as any).code !== '23505') return { error: error.message }
  }
  return { error: 'could not assign a unique quote number, please try again.' }
}

/** Recompute a quote's subtotal and total from its lines (subtotal + tax_pct %). */
export async function recomputeQuoteTotals(sb: any, quoteId: string): Promise<{ subtotal: number; total: number } | { error: string }> {
  const [{ data: q }, { data: ls, error: lErr }] = await Promise.all([
    sb.from('quotations').select('tax_pct').eq('id', quoteId).maybeSingle(),
    sb.from('quotation_lines').select('line_total').or(`quotation_id.eq.${quoteId},quote_id.eq.${quoteId}`),
  ])
  if (lErr) return { error: lErr.message }
  const subtotal = Math.round(((ls as any[] | null) || []).reduce((s, l) => s + (Number(l.line_total) || 0), 0) * 100) / 100
  const tax = Number((q as any)?.tax_pct) || 0
  const total = Math.round((subtotal + subtotal * tax / 100) * 100) / 100
  const { error } = await sb.from('quotations').update({ subtotal, total }).eq('id', quoteId)
  if (error) return { error: error.message }
  return { subtotal, total }
}
