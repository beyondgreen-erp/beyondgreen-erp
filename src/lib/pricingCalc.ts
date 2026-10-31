/**
 * Pricing Calculator math (replaces the May 2019 beyond_GREEN_Pricing_Table workbook).
 *
 * Everything is worked per PIECE (one bag, one fork) and then multiplied up to a pack:
 *   pack price  = price per piece x pieces in pack
 *   pack cost   = cost per piece  x pieces in pack
 *   profit      = pack price - pack cost
 *   commission = commission % x profit (sales rep commission is paid on profit; none on a loss)
 *   bG profit   = profit - commission
 *
 * Product price fields (distribution_price, wholesale_price, map_price, msrp) are stored the way
 * the rest of the ERP reads them: per STOCK UNIT (the product's unit_of_measure), the same unit as
 * unit_cost. Sales Orders drop wholesale_price straight into a line priced in the stock unit, and the
 * BOM editor's suggested prices are unit_cost x a multiplier. `piecesPerStockUnit` converts between
 * the two.
 */
import { conversionFactor, rungOf, type UomLadder } from './uom'

export interface PricingProduct extends UomLadder {
  unit_cost?: number | null
}

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** How many pieces one stock unit holds (PKS of 45 -> 45, CASE of 60 x 45 -> 2,700, EA -> 1). */
export function piecesPerStockUnit(p: UomLadder): { pieces: number; known: boolean; note: string } {
  if (rungOf(p.unit_of_measure) === 'PIECE') return { pieces: 1, known: true, note: 'Stocked by the piece' }
  const conv = conversionFactor(p, 'PCS') // base units per piece, e.g. 1/45
  if (!conv.known || !(conv.factor > 0)) return { pieces: 1, known: false, note: conv.note }
  const pieces = 1 / conv.factor
  return { pieces: Math.round(pieces * 1e6) / 1e6, known: true, note: `1 ${String(p.unit_of_measure || '').toUpperCase()} = ${pieces.toLocaleString('en-US')} pieces` }
}

/** unit_cost brought down to one piece via the UOM ladder. */
export function costPerPiece(p: PricingProduct): { value: number; known: boolean; note: string } {
  const per = piecesPerStockUnit(p)
  return { value: num(p.unit_cost) / per.pieces, known: per.known, note: per.note }
}

/** Stored (per stock unit) -> per piece. Null in, null out. */
export function stockToPiece(stored: number | null | undefined, p: UomLadder): number | null {
  if (stored == null || !Number.isFinite(Number(stored))) return null
  return Number(stored) / piecesPerStockUnit(p).pieces
}

/** Per piece -> stored (per stock unit). */
export function pieceToStock(perPiece: number, p: UomLadder): number {
  return perPiece * piecesPerStockUnit(p).pieces
}

export interface PackRow {
  pieces: number
  price: number
  cost: number
  profit: number
  commission: number
  bgProfit: number
  /** Profit as a share of price, 0..1. Null when price is 0. */
  marginPct: number | null
  /** bG profit (after commission) as a share of price, 0..1. */
  bgMarginPct: number | null
}

/** One column of the "Item at Distribution / Wholesale Price" tables. */
export function packRow(pieces: number, pricePerPiece: number, costPerPc: number, commissionPct: number): PackRow {
  const price = pricePerPiece * pieces
  const cost = costPerPc * pieces
  const profit = price - cost
  const commission = profit > 0 ? profit * (commissionPct / 100) : 0
  const bgProfit = profit - commission
  return { pieces, price, cost, profit, commission, bgProfit, marginPct: price ? profit / price : null, bgMarginPct: price ? bgProfit / price : null }
}

export interface PlTier {
  label: string
  /** Markup over the base (1M+) price, 0.15 = 15%. */
  markup: number
  pricePerPiece: number
  profitPerPiece: number
  commission: number
  bgProfit: number
}

/** Private label tiers: 1M+ at base, 500K-999,999 at base x (1 + m1), 50K-499,999 at base x (1 + m2). */
export function privateLabelTiers(base: number, costPerPc: number, commissionPct: number, markups: [number, number] = [0.15, 0.35]): PlTier[] {
  const defs: [string, number][] = [
    ['1,000,000+ pieces', 0],
    ['500,000 to 999,999 pieces', markups[0]],
    ['50,000 to 499,999 pieces', markups[1]],
  ]
  return defs.map(([label, markup]) => {
    const pricePerPiece = base * (1 + markup)
    const profitPerPiece = pricePerPiece - costPerPc
    const commission = profitPerPiece > 0 ? profitPerPiece * (commissionPct / 100) : 0
    return { label, markup, pricePerPiece, profitPerPiece, commission, bgProfit: profitPerPiece - commission }
  })
}

/** MAP per piece = wholesale per piece x multiplier (sheet default 2). */
export const mapPerPiece = (wholesalePerPiece: number, multiplier = 2) => wholesalePerPiece * multiplier

/** Default pack sizes: the product's own pack plus a full case, de-duplicated. */
export function defaultPackSizes(p: UomLadder): number[] {
  const ppp = num(p.pieces_per_pack) > 0 ? num(p.pieces_per_pack) : 1
  const ppc = num(p.packs_per_case)
  const out = [ppp]
  if (ppc > 1) out.push(ppp * ppc)
  return out
}

/** Build the modification_log line written on save. */
export function priceLogLine(dateIso: string, email: string | null | undefined): string {
  return `${dateIso}: prices set from Pricing Calculator by ${email || 'unknown user'}`
}
