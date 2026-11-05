// Walmart weekly report (bG Weekly Update) — shared types.
// All quantities are UNITS (Walmart eaches) unless a field name says SRP. 1 SRP = 6 units.

export const SKUS = ['22GVS24', '22GVS48', '22GVF24', '22GVA24', '22GVA48', '22GVF48', '22GVK48'] as const
export type Sku = typeof SKUS[number]
export const SKU_NAME: Record<Sku, string> = {
  '22GVS24': 'Spoon 24CT', '22GVS48': 'Spoon 48CT', '22GVF24': 'Fork 24CT', '22GVA24': 'F/S/K 24CT',
  '22GVA48': 'F/S/K 48CT', '22GVF48': 'Fork 48CT', '22GVK48': 'Knife 48CT',
}
export const SKU_DESC: Record<Sku, string> = Object.fromEntries(SKUS.map(k => [k, 'GV Comp ' + SKU_NAME[k]])) as Record<Sku, string>
export const WM_ITEM: Record<Sku, number> = {
  '22GVS24': 658820866, '22GVS48': 658819910, '22GVF24': 658819594, '22GVA24': 658819677,
  '22GVA48': 658819907, '22GVF48': 658820878, '22GVK48': 658819720,
}
export const ITEM_SKU: Record<number, Sku> = Object.fromEntries(Object.entries(WM_ITEM).map(([k, v]) => [v, k])) as Record<number, Sku>
export type BySku<T = number> = Record<Sku, T>
export const zeroBySku = (): BySku => Object.fromEntries(SKUS.map(k => [k, 0])) as BySku

export type StoreGroup = 'base' | 'comp48' | 'comp24'

export interface Settings {
  usw: BySku                                   // units per store per week
  stores: { base: number; comp48: number; comp24: number }
  storeGroup: BySku<StoreGroup>
  resetDate: string                            // 'YYYY-MM-DD' FY28 WK20 modular reset
  recipients: { to: string[]; cc: string[] }
  certifications: { name: string; status: string }[]
  srpOnOrder: BySku                            // SRP pieces on order by SKU
  srpPoNote: string
  unitPkgOnOrder: BySku                        // Unit Packaging pieces on order by SKU
  unitPkgNote: string
  palletSrp: BySku                             // SRP per full pallet
  greeting: string                             // "Hi Cora,"
  programName: string
}

export interface WeeklyInputs {
  reportDate: string                           // 'YYYY-MM-DD' (Wednesday)
  openingPosition?: BySku                      // defaults to prior report closing
  priorReportDate?: string                     // start of the production window (exclusive)
  notes: {
    certifications?: string                    // extra sentence(s) after the certification list
    shipping?: string                          // pickup / routing narrative
    production?: string
    forecast?: string
    asks?: string                              // questions for Walmart (one per line)
    packaging?: string
    meeting?: string
    closing?: string
  }
  manualOrders?: Record<string, Partial<BySku>> // date -> sku -> units (defaults from the forecast batch)
}

export interface PoRow {
  po: string
  orderDate: string
  wkOrdered: number                            // fiscal week number
  fy: number                                   // fiscal year (2026 = FY27 for Walmart naming; we keep calendar-based "2026")
  shipDate: string | null                      // BOL date (actual) or scheduled pickup
  shipped: boolean
  pickupDate: string | null
  mabd: string | null
  load: string | null
  comment: string | null
  status: string | null
  pallets: number | null
  srp: BySku
  units: number
  unitsShipped: number
  source: 'board' | 'history' | 'both'
}

export interface WeekRow { wk: number; orderDate: string; pos: number; units: number; shipped: number; sku: BySku; reset: boolean; status: string }
export interface ProdDay { date: string; wk: number; srp: BySku; tot: number }
export interface ForecastRow { date: string; wk: number; label: string; sku: BySku; plan: boolean; orig: BySku | null }

export interface Results {
  reportDate: string
  wmWeek: number                               // current Walmart week (the week containing reportDate)
  weekSpan: string                             // "11/1 to 11/7"
  orderWeek: number                            // week of the order being shipped (last Thursday order)
  orderDate: string
  weeks: WeekRow[]
  ytd: { ordered: number; shipped: number; posShipped: number; posOpen: number; fullWeeks: number }
  loads: { load: string; pos: number; units: number; pallets: number | null; pickup: string | null; mabdMin: string | null; mabdMax: string | null; wk: number; status: string }[]
  pushbacks: { wk: number; orderDate: string; pos: number; units: number; what: string; picked: string; mabd: string; late: boolean }[]
  thisOrder: { pos: number; units: number; sku: BySku; forecast: BySku | null; forecastTotal: number }
  prodDays: ProdDay[]
  prodWeeks: { wk: number; span: string; dates: string; srp: number; days: number; units: number; ordered: number | null }[]
  prodWindow: { from: string; to: string; units: BySku; total: number }
  position: { opening: BySku; production: BySku; shipping: BySku; closing: BySku; openingTotal: number; productionTotal: number; shippingTotal: number; closingTotal: number }
  requirement: { sku: Sku; usw: number; storesNow: number; avgWeek: number; req3: number; position: number; vsReq: number; weeksSupply: number | null; spAvg: number; req3Sp: number; storesAfter: number; req3After: number; build: number }[]
  reqTotals: { req3: number; spAvg: number; req3Sp: number; req3After: number; build: number; weeksSupply: number | null; weeksSupplySp: number | null }
  forecast: { rows: ForecastRow[]; manual: Record<string, Partial<BySku>>; manualTotal: number; totalUnits: number; window: string[]; spAvg: BySku; spAvgTotal: number; runDate: string | null; planTotal: Partial<BySku>; batchName: string | null }
  packaging: { resetDate: string; weeksToReset: number; asOf: string; unit: { sku: Sku; onHand: number; onOrder: number; committed: number; usage: number; weeks: number | null; status: string; atReset: number }[]; unitTotals: { onHand: number; onOrder: number; committed: number; usage: number }; srp: { sku: Sku; onHand: number; onOrder: number; usage: number; weeks: number | null; weeksWithOrder: number | null; status: string }[]; srpTotals: { onHand: number; onOrder: number } }
  pos: PoRow[]                                 // POs from the last ~5 order weeks (for the Order vs Ship tab)
}
