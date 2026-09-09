/**
 * Unit of measure — canonical names, normalisation, and the pack/case ladder.
 *
 * A product's `unit_of_measure` is its BASE (stocking) unit: what one unit of
 * on_hand_qty represents. That base can sit at any rung of the ladder —
 * 2016015 is stocked in ROLLS, 2016045 in PKS, bG23SPN-1000 in EA — so a
 * conversion is always relative to where the base sits:
 *
 *     PIECE --pieces_per_pack--> PACK --packs_per_case--> CASE --cases_per_pallet--> PALLET
 *
 * 2016045 is stocked in PKS with pieces_per_pack 45 and packs_per_case 60, so
 * one CASE is 60 base units (packs), not 2,700. Everything that moves stock
 * must convert through `toBaseUnits` so a line in CASE and a line in EA
 * deplete the same inventory in the same units.
 */

/** Units offered by default. The picker unions these with whatever is already in use. */
export const CANONICAL_UOMS = [
  'EA', 'PCS', 'PKS', 'CASE', 'PALLET', 'ROLLS',
  'LBS', 'KG', 'OZ', 'M', 'FT', 'GAL', 'SET', 'SRPS', 'BAGS', 'BUNDLE',
] as const

/** Spellings we fold away. Keys are already upper-cased and dot-stripped. */
const ALIASES: Record<string, string> = {
  EACH: 'EA', E: 'EA',
  PIECE: 'PCS', PIECES: 'PCS', PC: 'PCS',
  PACK: 'PKS', PACKS: 'PKS', PK: 'PKS',
  CASES: 'CASE', CS: 'CASE', CTN: 'CASE', CARTON: 'CASE',
  ROLL: 'ROLLS', RL: 'ROLLS',
  LB: 'LBS', POUND: 'LBS', POUNDS: 'LBS',
  PALLETS: 'PALLET', PLT: 'PALLET',
  SRP: 'SRPS',
  BAG: 'BAGS',
}

/**
 * Upper-case, trim, drop a trailing period, and fold known aliases.
 * Returns null for empty input so callers can store NULL rather than ''.
 */
export function normalizeUom(value: string | null | undefined): string | null {
  if (value == null) return null
  const cleaned = String(value).trim().replace(/\.+$/, '').toUpperCase()
  if (!cleaned) return null
  return ALIASES[cleaned] ?? cleaned
}

/** Rungs of the ladder, lowest first. */
export const LADDER = ['PIECE', 'PACK', 'CASE', 'PALLET'] as const
export type Rung = (typeof LADDER)[number]

/**
 * Which rung a unit name sits on. Anything that is not explicitly a pack,
 * case or pallet counts as the piece rung — EA, PCS, ROLLS, LBS, SRPS all
 * describe "one of the thing this product is counted in".
 */
export function rungOf(uom: string | null | undefined): Rung {
  switch (normalizeUom(uom)) {
    case 'PKS': return 'PACK'
    case 'CASE': return 'CASE'
    case 'PALLET': return 'PALLET'
    default: return 'PIECE'
  }
}

export interface UomLadder {
  unit_of_measure?: string | null
  pieces_per_pack?: number | null
  packs_per_case?: number | null
  cases_per_pallet?: number | null
  /** Legacy column. Inconsistent across the catalogue — used only as a last resort. */
  case_qty?: number | null
}

const positive = (n: unknown): number | null => {
  const v = Number(n)
  return Number.isFinite(v) && v > 0 ? v : null
}

export interface ConversionResult {
  /** How many base units one `uom` contains. Never 0. */
  factor: number
  /**
   * False when the ladder does not define the step and we fell back to 1.
   * Callers should surface this rather than quietly moving the wrong quantity.
   */
  known: boolean
  /** Human-readable explanation, for tooltips and warnings. */
  note: string
}

/**
 * How many base units are in one `uom` of this product.
 *
 * Never throws and never returns 0. A ladder that does not define the step
 * yields factor 1 with `known: false`, which preserves today's behaviour for
 * the products that have no ladder filled in yet.
 */
export function conversionFactor(product: UomLadder, uom: string | null | undefined): ConversionResult {
  const base = normalizeUom(product.unit_of_measure)
  const want = normalizeUom(uom)
  const baseLabel = base ?? 'EA'

  if (!want || want === base) {
    return { factor: 1, known: true, note: `1 ${baseLabel} = 1 ${baseLabel}` }
  }

  const from = LADDER.indexOf(rungOf(base))
  const to = LADDER.indexOf(rungOf(want))

  // Same rung under a different name (EA vs PCS vs ROLLS) — one for one.
  if (from === to) {
    return { factor: 1, known: true, note: `1 ${want} = 1 ${baseLabel}` }
  }

  // Multipliers for each step of the ladder: piece->pack, pack->case, case->pallet.
  const steps: (number | null)[] = [
    positive(product.pieces_per_pack),
    positive(product.packs_per_case),
    positive(product.cases_per_pallet),
  ]
  const stepNames = ['Pieces per pack', 'Packs per case', 'Cases per pallet']

  // Legacy fallback: a piece-based product with only case_qty set.
  if (from === 0 && to === 2 && steps[0] == null && steps[1] == null) {
    const legacy = positive(product.case_qty)
    if (legacy && legacy > 1) {
      return { factor: legacy, known: true, note: `1 CASE = ${legacy.toLocaleString('en-US')} ${baseLabel} (from case qty)` }
    }
  }

  const lo = Math.min(from, to)
  const hi = Math.max(from, to)
  let product_ = 1
  for (let i = lo; i < hi; i++) {
    const step = steps[i]
    if (step == null) {
      return { factor: 1, known: false, note: `${stepNames[i]} is not set on this product.` }
    }
    product_ *= step
  }

  const factor = to > from ? product_ : 1 / product_
  const shown = Number.isInteger(factor) ? factor.toLocaleString('en-US') : factor.toFixed(4).replace(/0+$/, '')
  return { factor, known: true, note: `1 ${want} = ${shown} ${baseLabel}` }
}

/** Convert a transacted quantity into the product's base units. */
export function toBaseUnits(
  product: UomLadder,
  quantity: number | string | null | undefined,
  uom?: string | null,
): ConversionResult & { quantity: number } {
  const qty = Number(quantity) || 0
  const conv = conversionFactor(product, uom ?? product.unit_of_measure)
  return { ...conv, quantity: qty * conv.factor }
}

/** Convert base units back into `uom`. May return a fraction. */
export function fromBaseUnits(
  product: UomLadder,
  baseQuantity: number | string | null | undefined,
  uom?: string | null,
): ConversionResult & { quantity: number } {
  const qty = Number(baseQuantity) || 0
  const conv = conversionFactor(product, uom ?? product.unit_of_measure)
  return { ...conv, quantity: conv.factor ? qty / conv.factor : qty }
}

/**
 * One-line description of the ladder for the product editor, expressed in the
 * product's own base unit, e.g. "1 CASE = 60 PKS  ·  1 PALLET = 40 CASE".
 * Returns null when nothing above the base is defined.
 */
export function describeLadder(product: UomLadder): string | null {
  const base = normalizeUom(product.unit_of_measure) ?? 'EA'
  const from = LADDER.indexOf(rungOf(base))
  const n = (v: number) => (Number.isInteger(v) ? v.toLocaleString('en-US') : v.toFixed(2))

  const parts: string[] = []
  for (let to = from + 1; to < LADDER.length; to++) {
    const label = LADDER[to] === 'PACK' ? 'PKS' : LADDER[to]
    const conv = conversionFactor(product, label)
    if (!conv.known) break
    parts.push(`1 ${label} = ${n(conv.factor)} ${base}`)
  }
  return parts.length ? parts.join('  ·  ') : null
}

/** Merge the canonical list with values already stored, so nothing is ever lost. */
export function uomOptions(...seen: (string | null | undefined)[]): string[] {
  const out = new Set<string>(CANONICAL_UOMS as readonly string[])
  for (const v of seen) {
    const n = normalizeUom(v)
    if (n) out.add(n)
  }
  return Array.from(out)
}
