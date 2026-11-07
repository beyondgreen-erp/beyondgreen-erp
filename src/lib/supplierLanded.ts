/* eslint-disable @typescript-eslint/no-explicit-any */
// Landed cost to beyondGREEN, 1202 E. Wakeham Ave., Santa Ana, CA 92705, and suggested selling
// price tiers for supplier quoted items. Everything here is an ESTIMATE driven by the editable
// assumptions in supplier_landed_settings; supplier DDP quotes are taken as already landed.

export interface OriginCost {
  country: string
  duty_pct: number          // total extra US duty for this origin (e.g. China 37.5 = 25 Sec 301 + 12.5)
  ocean_40hq: number        // ocean freight per 40HQ to LA / Long Beach
}

export interface PriceTier {
  name: string
  qty_note: string
  gpm_pct: number           // gross profit margin; price = landed / (1 - gpm)
}

export interface LandedSettings {
  destination: string
  origins: OriginCost[]
  default_origin: OriginCost   // used when the country is not listed
  drayage_40hq: number         // port to Santa Ana door
  broker_isf_bond: number      // customs broker, ISF and bond per entry
  exw_to_fob_40hq: number      // export clearance + trucking to port when a quote is EXW
  mpf_pct: number
  mpf_min: number
  mpf_max: number
  hmf_pct: number
  family_kg_per_40hq: Record<string, number>  // practical load per 40HQ by product family
  tiers: PriceTier[]
}

export const DEFAULT_LANDED_SETTINGS: LandedSettings = {
  destination: '1202 E. Wakeham Ave., Santa Ana, CA 92705',
  origins: [
    { country: 'China', duty_pct: 37.5, ocean_40hq: 4500 },
    { country: 'Indonesia', duty_pct: 10, ocean_40hq: 5000 },
    { country: 'Vietnam', duty_pct: 10, ocean_40hq: 4800 },
    { country: 'India', duty_pct: 10, ocean_40hq: 5500 },
  ],
  default_origin: { country: 'Other', duty_pct: 10, ocean_40hq: 5000 },
  drayage_40hq: 950,
  broker_isf_bond: 500,
  exw_to_fob_40hq: 830,
  mpf_pct: 0.3464,
  mpf_min: 33.58,
  mpf_max: 651.5,
  hmf_pct: 0.125,
  family_kg_per_40hq: {
    'Paper Bag': 15000,
    'Corrugated Box': 8000,
    'Tape': 20000,
    'Slip Sheet': 18000,
    'Corner Board': 18000,
    'Kraft Paper': 18000,
  },
  tiers: [
    { name: 'Tier 1', qty_note: 'Under 1 pallet (from stock)', gpm_pct: 30 },
    { name: 'Tier 2', qty_note: '1 to 5 pallets', gpm_pct: 25 },
    { name: 'Tier 3', qty_note: '6+ pallets', gpm_pct: 20 },
    { name: 'Tier 4', qty_note: 'Full container, direct', gpm_pct: 15 },
  ],
}

export function mergeSettings(raw: any): LandedSettings {
  const d = DEFAULT_LANDED_SETTINGS
  if (!raw || typeof raw !== 'object') return d
  return {
    ...d,
    ...raw,
    default_origin: { ...d.default_origin, ...(raw.default_origin || {}) },
    family_kg_per_40hq: { ...d.family_kg_per_40hq, ...(raw.family_kg_per_40hq || {}) },
    origins: Array.isArray(raw.origins) && raw.origins.length ? raw.origins : d.origins,
    tiers: Array.isArray(raw.tiers) && raw.tiers.length ? raw.tiers : d.tiers,
  }
}

export interface LandedInput {
  product_type: string
  country: string | null
  unit_price: number | null
  incoterm: string | null
  unit_weight_g?: number | null
  units_per_container?: number | null
  duty_pct_override?: number | null
}

export interface LandedResult {
  ok: boolean
  reason?: string
  basis: 'DDP quote' | 'Estimated'
  landed: number | null
  unitsPerContainer: number | null
  duty: number
  fees: number
  freight: number
  dutyPct: number
}

export function familyOf(productType: string, s: LandedSettings): string | null {
  const t = productType.toLowerCase()
  return Object.keys(s.family_kg_per_40hq).find(f => t.includes(f.toLowerCase())) || null
}

export function originFor(country: string | null, s: LandedSettings): OriginCost {
  const c = (country || '').trim().toLowerCase()
  return s.origins.find(o => o.country.toLowerCase() === c) || s.default_origin
}

export function unitsPerContainer(i: LandedInput, s: LandedSettings): number | null {
  if (i.units_per_container && i.units_per_container > 0) return i.units_per_container
  const fam = familyOf(i.product_type, s)
  if (!fam || !i.unit_weight_g || i.unit_weight_g <= 0) return null
  return Math.floor((s.family_kg_per_40hq[fam] * 1000) / i.unit_weight_g)
}

export function landedCost(i: LandedInput, s: LandedSettings): LandedResult {
  const empty = { duty: 0, fees: 0, freight: 0, dutyPct: 0, unitsPerContainer: null }
  if (i.unit_price == null) return { ok: false, reason: 'No price', basis: 'Estimated', landed: null, ...empty }
  const term = (i.incoterm || '').toUpperCase()
  if (term === 'DDP') return { ok: true, basis: 'DDP quote', landed: i.unit_price, ...empty }
  const upc = unitsPerContainer(i, s)
  if (!upc) return { ok: false, reason: 'Add unit weight or units per container', basis: 'Estimated', landed: null, ...empty }
  const o = originFor(i.country, s)
  const dutyPct = i.duty_pct_override != null ? i.duty_pct_override : o.duty_pct
  const ctrValue = i.unit_price * upc
  const mpf = Math.min(Math.max(ctrValue * s.mpf_pct / 100, s.mpf_min), s.mpf_max)
  const hmf = ctrValue * s.hmf_pct / 100
  const fixed = o.ocean_40hq + s.drayage_40hq + s.broker_isf_bond + (term === 'EXW' ? s.exw_to_fob_40hq : 0)
  const duty = i.unit_price * dutyPct / 100
  const fees = (mpf + hmf) / upc
  const freight = fixed / upc
  return { ok: true, basis: 'Estimated', landed: i.unit_price + duty + fees + freight, unitsPerContainer: upc, duty, fees, freight, dutyPct }
}

export function tierPrice(landed: number, t: PriceTier): number {
  return landed / (1 - t.gpm_pct / 100)
}
