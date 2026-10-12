/**
 * Costing a SKU that is itself built from a bill of materials.
 *
 * A component is a child SKU: BGFRK holds the resin blend, and 22GVA24 is built from
 * BGFRK plus packaging rather than from the resin directly. Without this, the parent
 * costs that child at the flat unit_cost typed on the product, so a resin price change
 * stops one level short of the finished good. This works the child's cost out from its
 * own BOM instead, by the same arithmetic the BOM editor uses one level up.
 */

export const GRAMS_PER_LB = 453.592

type BomRow = {
  finished_good_sku: string
  component_sku: string
  qty_value: number | null
  percentage: number | null
  uom_type: string | null
  is_case_level: boolean | null
}

type ProdRow = {
  sku: string
  unit_cost: number | null
  weight_per_unit_grams: number | null
  production_cost: number | null
  case_qty: number | null
}

/**
 * Returns a cost per unit for each SKU in `skus` that has a BOM of its own. A SKU with
 * no BOM is left out, so the caller keeps using its stored unit_cost.
 *
 * Two things are deliberately conservative. A basis this cannot price exactly, such as
 * a pack-level line whose pack size lives in the UOM ladder, makes the whole SKU fall
 * back to its stored cost rather than be priced on a guess. And a BOM that works out to
 * nothing is a half-filled build sheet, not a free part, so it falls back too.
 *
 * Loops cannot spin it: the walk down never revisits a SKU, and the costing refuses to
 * re-enter a SKU it is already pricing.
 */
export async function rolledCostMap(
  sb: any,
  skus: string[],
  maxDepth = 6,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  const wanted = Array.from(new Set(skus.filter(Boolean)))
  if (!wanted.length) return out

  const rows: BomRow[] = []
  const everySku = new Set<string>(wanted)
  const visited = new Set<string>()
  let frontier = wanted
  for (let d = 0; d < maxDepth && frontier.length; d++) {
    const ask = frontier.filter(s => !visited.has(s))
    ask.forEach(s => visited.add(s))
    if (!ask.length) break
    const { data } = await sb.from('product_bom')
      .select('finished_good_sku,component_sku,qty_value,percentage,uom_type,is_case_level')
      .in('finished_good_sku', ask)
    const got = ((data || []) as BomRow[]).filter(r => r.component_sku)
    rows.push(...got)
    got.forEach(r => everySku.add(r.component_sku))
    frontier = got.map(r => r.component_sku)
  }
  if (!rows.length) return out

  const { data: pdata } = await sb.from('products')
    .select('sku,unit_cost,weight_per_unit_grams,production_cost,case_qty')
    .in('sku', Array.from(everySku))
  const prod: Record<string, ProdRow> = {}
  for (const p of ((pdata || []) as ProdRow[])) prod[p.sku] = p

  const kidsOf: Record<string, BomRow[]> = {}
  for (const r of rows) (kidsOf[r.finished_good_sku] ||= []).push(r)

  const memo: Record<string, number> = {}
  const pricing = new Set<string>()

  function costOf(sku: string, depth: number): number {
    const flat = Number(prod[sku]?.unit_cost ?? 0)
    const kids = kidsOf[sku]
    if (!kids || !kids.length) return flat
    if (depth >= maxDepth) return flat
    if (pricing.has(sku)) return flat
    if (memo[sku] !== undefined) return memo[sku]
    pricing.add(sku)
    const wG = Number(prod[sku]?.weight_per_unit_grams ?? 0)
    const caseQty = Number(prod[sku]?.case_qty ?? 0) || 1
    let total = 0
    let priceable = true
    for (const k of kids) {
      const qty = Number(k.qty_value ?? k.percentage ?? 0)
      const unit = costOf(k.component_sku, depth + 1)
      if (k.uom_type === 'percentage') total += (qty / 100) * wG * (unit / GRAMS_PER_LB)
      else if (k.is_case_level) total += (qty * unit) / caseQty
      else if (k.uom_type === 'pcs_pack') priceable = false
      else total += qty * unit
    }
    total += Number(prod[sku]?.production_cost ?? 0)
    pricing.delete(sku)
    memo[sku] = priceable && total > 0 ? total : flat
    return memo[sku]
  }

  for (const s of wanted) {
    const kids = kidsOf[s]
    if (!kids || !kids.length) continue
    out[s] = costOf(s, 0)
  }
  return out
}
