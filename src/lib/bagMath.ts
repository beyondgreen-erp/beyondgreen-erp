/* eslint-disable @typescript-eslint/no-explicit-any */
// Bag work-order math: pieces per stocking unit, pieces per case, case packing plan and extruder meters.
// Mirrors the DB helpers pb_pcs_per_unit / pb_bag_length_in so the screen, the PDF and the log agree.

export interface BagProduct {
  sku: string; product_name?: string | null; product_size?: string | null; unit_of_measure?: string | null
  case_qty?: number | null; pieces_per_pack?: number | null; packs_per_case?: number | null; bag_length_in?: any
}
export interface BagOverrides { pcs_per_case?: any; bag_length_in?: any; scrap_pct?: any }

const n = (v: any) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
const PIECE_UOMS = new Set(['PCS', 'PC', 'EA', 'EACH', 'BAG', 'BAGS', 'PIECE', 'PIECES', 'UNIT', 'UNITS', ''])
const CASE_UOMS = new Set(['CASE', 'CASES', 'CS', 'CTN', 'CARTON'])

/** bags in one stocking unit (PCS = 1, PKS/ROLLS = pieces per pack, CASE = pieces per pack x packs per case) */
export function pcsPerUnit(p?: BagProduct | null): number {
  if (!p) return 1
  const u = String(p.unit_of_measure || '').trim().toUpperCase()
  if (PIECE_UOMS.has(u)) return 1
  if (CASE_UOMS.has(u)) return Math.max((n(p.pieces_per_pack) || 1) * (n(p.packs_per_case) || 1), 1)
  return Math.max(n(p.pieces_per_pack) || 1, 1)
}

/** bag length in inches: product field, else the second number of "W x L" in size or name */
export function bagLengthIn(p?: BagProduct | null, ov?: BagOverrides | null): number | null {
  if (n(ov?.bag_length_in) > 0) return n(ov!.bag_length_in)
  if (!p) return null
  if (/^\s*\d+(\.\d+)?\s*$/.test(String(p.bag_length_in ?? ''))) return n(p.bag_length_in)
  const re = /(\d+(?:\.\d+)?)\s*"?\s*[xX×]\s*(\d+(?:\.\d+)?)/
  const m = String(p.product_size || '').match(re) || String(p.product_name || '').match(re)
  return m ? n(m[2]) : null
}

/** pieces in one shipping case: WO override, else the sales order line's qty per case, else the product's pack x packs/case */
export function pcsPerCase(p?: BagProduct | null, ov?: BagOverrides | null, soPcsPerCase?: number | null): number | null {
  if (n(ov?.pcs_per_case) > 0) return n(ov!.pcs_per_case)
  if (n(soPcsPerCase) > 0) return n(soPcsPerCase)
  if (!p) return null
  if (n(p.pieces_per_pack) > 0 && n(p.packs_per_case) > 0) return n(p.pieces_per_pack) * n(p.packs_per_case)
  const u = String(p.unit_of_measure || '').trim().toUpperCase()
  if (CASE_UOMS.has(u)) return pcsPerUnit(p)
  if (n(p.case_qty) > 1) return n(p.case_qty) * pcsPerUnit(p)
  return null
}

export interface PackPlan { totalPcs: number; casePcs: number | null; full: number; partial: number; text: string }
/** 3,600 pcs at 500/case -> 7 full cases of 500 + 1 partial case of 100 */
export function packPlan(totalPcs: number, casePcs: number | null): PackPlan {
  const t = Math.max(0, Math.round(totalPcs))
  if (!casePcs || casePcs <= 0) return { totalPcs: t, casePcs: null, full: 0, partial: 0, text: `${t.toLocaleString()} pcs (no case size set)` }
  const full = Math.floor(t / casePcs), partial = t - full * casePcs
  const text = `${full.toLocaleString()} case${full === 1 ? '' : 's'} × ${casePcs.toLocaleString()}${partial ? ` + 1 partial case × ${partial.toLocaleString()}` : ''}`
  return { totalPcs: t, casePcs, full, partial, text }
}

/** film the extruder must run for this many bags (one bag length per bag, plus scrap) */
export function metersFor(pcs: number, lengthIn: number | null, scrapPct?: any): number | null {
  if (!lengthIn || lengthIn <= 0) return null
  return pcs * lengthIn * 0.0254 * (1 + Math.max(0, n(scrapPct)) / 100)
}

export const BAG_STEPS = ['extrusion', 'conversion'] as const
export type BagStep = 'extrusion' | 'conversion' | 'packing'
export const STEP_LABEL: Record<string, string> = { extrusion: 'Extrusion', conversion: 'Conversion', packing: 'Packing (finished cases)' }
export const stepsOf = (spec: any): string[] => Array.isArray(spec?.pb_steps) ? spec.pb_steps.filter((s: string) => s === 'extrusion' || s === 'conversion') : ['extrusion', 'conversion']
export const stageOf = (spec: any): BagStep => {
  const st = stepsOf(spec); const s = spec?.pb_stage
  return (s && (s === 'packing' || st.includes(s)) ? s : (st[0] || 'packing')) as BagStep
}
