/**
 * What a production booking takes out of inventory, BEFORE and AFTER it is posted.
 *
 * The math lives in the database (bom_requirements), the same function every booking
 * path deducts through, so a preview here is exactly what will come off. Percentage
 * rows are % of the material weight of the stock unit being made
 * (qty x pieces per unit x grams per piece), not of one piece.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export type BomLine = {
  component_sku: string
  component_name: string | null
  component_uom: string | null
  uom_type: string | null
  qty: number
  basis: string | null
  warning: string | null
}

/** 'none' no BOM rows · 'no_weight' % rows but no weight per piece · 'no_material' piece rows only · 'ok' */
export type BomStatus = 'none' | 'no_weight' | 'no_material' | 'ok'

export const fmtQty = (n: number) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })

export async function bomPreview(sb: any, productId: string | null | undefined, qty: number): Promise<BomLine[]> {
  if (!productId || !(qty > 0)) return []
  const { data, error } = await sb.rpc('bom_requirements', { p_product_id: productId, p_qty: qty })
  if (error) throw new Error(error.message)
  return ((data as any[]) || []).map(r => ({ ...r, qty: Number(r.qty) || 0 }))
}

export async function bomStatus(sb: any, sku: string | null | undefined): Promise<BomStatus | null> {
  if (!sku) return null
  const { data, error } = await sb.rpc('bom_status', { p_sku: sku })
  if (error) return null
  return (data as BomStatus) ?? null
}

export const BOM_STATUS_TEXT: Record<BomStatus, string> = {
  none: 'No BOM: booking this production will not deduct any raw material.',
  no_weight: 'BOM has material % rows but no weight per piece on the item, so no resin or colour will be deducted.',
  no_material: 'BOM has packaging/parts only (no resin % rows). Fine for assembled items; molded or extruded items need their material rows.',
  ok: '',
}

/** Plain-text list for a confirm() / alert(). */
export function bomLinesText(lines: BomLine[], { header }: { header?: string } = {}): string {
  if (!lines.length) return (header ? header + '\n' : '') + '  (no BOM on file: nothing will be deducted)'
  const rows = lines.map(l =>
    `  - ${l.component_sku}: ${fmtQty(l.qty)} ${l.component_uom || ''}`
    + (l.warning ? `  [${l.warning}]` : ''))
  return (header ? header + '\n' : '') + rows.join('\n')
}

/** What actually came off for one reference (work order, production entry, ...), summed by SKU. */
export async function consumedFor(sb: any, refTable: string, refId: string, sinceIso?: string) {
  let q = sb.from('inventory_movements').select('sku, qty, uom, movement_type, created_at')
    .eq('ref_table', refTable).eq('ref_id', refId).in('movement_type', ['consume', 'scrap'])
  if (sinceIso) q = q.gte('created_at', sinceIso)
  const { data } = await q
  const by: Record<string, { sku: string; qty: number; uom: string | null }> = {}
  for (const m of (data as any[]) || []) {
    const k = m.sku
    by[k] = by[k] || { sku: k, qty: 0, uom: m.uom }
    by[k].qty += Math.abs(Number(m.qty) || 0)
  }
  return Object.values(by)
}
