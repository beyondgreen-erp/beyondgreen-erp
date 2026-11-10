/* eslint-disable @typescript-eslint/no-explicit-any */
// Per-work-order details (print, wrapper, specs, operator, schedule...).
// Saved on work_orders.spec.wo_details as { wo: {...}, skus: { SKU: {...} } } by wo_save_details().
// Each SKU value overrides the product default only for this work order; blank = use the product default.

export type WoKind = 'straw' | 'pb'
export interface WoField { key: string; label: string; type?: 'text' | 'number' | 'select' | 'textarea' | 'date' | 'time'; options?: string[]; wide?: boolean }
export interface WoDetails { wo?: Record<string, any>; skus?: Record<string, Record<string, any>> }

export const WO_FIELDS: WoField[] = [
  { key: 'operator', label: 'Operator' },
  { key: 'supervisor', label: 'Supervisor' },
  { key: 'scheduled_date', label: 'Scheduled date', type: 'date' },
  { key: 'scheduled_start', label: 'Scheduled start time', type: 'time' },
  { key: 'shift', label: 'Shift', type: 'select', options: ['', '1st', '2nd', '3rd'] },
  { key: 'notes', label: 'Notes / set-up instructions', type: 'textarea', wide: true },
]

const STRAW_FIELDS: WoField[] = [
  { key: 'color', label: 'Straw color' },
  { key: 'wrapped', label: 'Wrapped', type: 'select', options: ['', 'Yes', 'No'] },
  { key: 'wrapper_print', label: 'Wrapper print' },
  { key: 'print_color', label: 'Print color' },
  { key: 'print_plate', label: 'Print plate' },
  { key: 'inner_diameter_mm', label: 'Inner diameter (mm)', type: 'number' },
  { key: 'wall_thickness_mm', label: 'Wall thickness (mm)', type: 'number' },
  { key: 'straw_length_in', label: 'Straw length (in)', type: 'number' },
  { key: 'straw_weight_g', label: 'Straw weight (g)', type: 'number' },
  { key: 'case_size', label: 'Case size' },
  { key: 'case_weight', label: 'Case weight (lb)', type: 'number' },
  { key: 'cases_per_pallet', label: 'Cases per pallet', type: 'number' },
  { key: 'customer_part', label: 'Customer part #' },
  { key: 'upc', label: 'UPC / GTIN' },
  { key: 'special', label: 'Special instructions', type: 'textarea', wide: true },
]

const PB_COMMON: WoField[] = [
  { key: 'size', label: 'Size' },
  { key: 'thickness', label: 'Thickness' },
  { key: 'color', label: 'Color' },
  { key: 'print_color', label: 'Print' },
  { key: 'print_plate', label: 'Artwork / plate #' },
  { key: 'weight_g', label: 'Unit weight (g)', type: 'number' },
]
const PB_BAGS: WoField[] = [
  { key: 'pcs_per_case', label: 'Pieces per case', type: 'number' },
  { key: 'bag_length_in', label: 'Bag length (in) for extruder meters', type: 'number' },
  { key: 'scrap_pct', label: 'Extrusion scrap allowance (%)', type: 'number' },
  { key: 'material', label: 'Material / film' },
  { key: 'gusset', label: 'Gusset' },
  { key: 'seal_type', label: 'Seal type' },
  { key: 'perforation', label: 'Perforation' },
]
const PB_PACK: WoField[] = [
  { key: 'case_size', label: 'Case size' },
  { key: 'case_weight', label: 'Case weight (lb)', type: 'number' },
  { key: 'cases_per_pallet', label: 'Cases per pallet', type: 'number' },
  { key: 'customer_part', label: 'Customer part #' },
  { key: 'upc', label: 'UPC / GTIN' },
  { key: 'special', label: 'Special instructions', type: 'textarea', wide: true },
]

export function skuFields(kind: WoKind, boardKey?: string): WoField[] {
  if (kind === 'straw') return STRAW_FIELDS
  const bags = /bag/i.test(boardKey || '')
  return [...PB_COMMON, ...(bags ? PB_BAGS : [{ key: 'material', label: 'Material' }]), ...PB_PACK]
}

/** product default for a field, read from the print line (straw "wrapped" comes from the name) */
export function defaultOf(kind: WoKind, line: any, key: string): string {
  if (!line) return ''
  if (kind === 'straw' && key === 'wrapped') { const nm = String(line.name || '').toLowerCase(); return /unwrapped/.test(nm) ? 'No' : /wrapped/.test(nm) ? 'Yes' : '' }
  const v = line[key]
  return v === null || v === undefined ? '' : String(v)
}

const NUMERIC = new Set(['pcs_per_case', 'bag_length_in', 'scrap_pct', 'inner_diameter_mm', 'wall_thickness_mm', 'straw_length_in', 'straw_weight_g', 'case_weight', 'cases_per_pallet', 'weight_g'])
const clean = (k: string, v: any) => (v === '' || v === null || v === undefined ? undefined : NUMERIC.has(k) ? Number(v) : v)

/** merge saved details into the print data (in place) */
export function applyWoDetails<T extends { wo: any; lines: any[] }>(print: T, details: WoDetails | null | undefined): T {
  if (!print || !details) return print
  const w = details.wo || {}
  for (const k of Object.keys(w)) { const v = clean(k, w[k]); if (v !== undefined) print.wo[k] = v }
  if (w.operator) print.wo.operator = w.operator
  const s = details.skus || {}
  for (const l of print.lines || []) {
    const o = s[String(l.sku).toUpperCase()] || s[l.sku]
    if (!o) continue
    for (const k of Object.keys(o)) {
      if (k === 'bom') {
        // per work order material values: replace the qty on the matching BOM rows
        const ov = (o as any).bom || {}
        if (Array.isArray(l.bom)) l.bom = l.bom.map((b: any) => { const v = ov[String(b.component || '').toUpperCase()]; return v === undefined || v === '' ? b : { ...b, qty: Number(v), override: true } })
        continue
      }
      const v = clean(k, o[k]); if (v !== undefined) l[k] = v
    }
  }
  return print
}

export async function loadWoDetails(sb: any, woId: string): Promise<WoDetails | null> {
  const { data } = await sb.from('work_orders').select('spec').eq('id', woId).maybeSingle()
  return (data?.spec?.wo_details as WoDetails) || null
}
