// beyondGREEN Broker Portal — Landed-Cost Engine
// Mirrors the "LANDED COST ENGINE" tab in the Master SKU workbook.
// All rates live in one object so updating is a single edit (or wire to a live feed).

import raw from "@/data/brokerSkuData.json";

export type Origin = "USA" | "CHINA" | "INDIA";

export interface EngineRates {
  usableCuFt: number;
  oceanChina: number;
  oceanIndia: number;
  inlandChina: number;
  inlandIndia: number;
  drayage: number;
  broker: number;
  mpfPct: number;
  hmfPct: number;
  adcvd: Record<string, Record<string, number>>;
  duty: Record<string, Record<string, number>>;
  maxPalletWt: number;
  maxStackH: number;
  undercutPct: number;
  asOf: string;
}

export interface SkuItem {
  sku: string;
  category: string;
  description: string;
  upc: string | null;
  variation: string | null;
  qtyCase: number | null;
  caseGrossWt: number | null;
  caseDims: string | null;
  caseCuFt: number | null;
  casesPallet: number | null;
  palletNetWt: number | null;
  palletHt: number | null;
  material: string | null;
  hts: string | null;
  dutyCat: string;
  adcvdScope: string;
  origin: Origin | string | null;
  mfgType: string | null;
  fob: number | null;
  landed: number | null;
  landedUnit: number | null;
  winLikelihood: string | null;
  moq: number | string | null;
  notes: string | null;
}

export const ENGINE: EngineRates = (raw as any).engine;
export const ITEMS: SkuItem[] = (raw as any).items;

export interface LandedBreakdown {
  fob: number;
  originInland: number;
  ocean: number;
  drayage: number;
  dutyPct: number;
  adcvdPct: number;
  dutiesTariffs: number;
  customsFees: number;
  landed: number;
  landedUnit: number;
}

/**
 * Compute full landed cost for one case. USA origin pays no import costs.
 * Freight is allocated per case by cubic feet (usable container volume / case cu ft).
 */
export function computeLanded(opts: {
  fob: number;
  origin: Origin;
  caseCuFt: number | null;
  dutyCat: string;
  adcvdScope: string;
  qtyCase?: number | null;
  rates?: EngineRates;
}): LandedBreakdown {
  const e = opts.rates ?? ENGINE;
  const { fob, origin, caseCuFt, dutyCat, adcvdScope } = opts;
  const qty = opts.qtyCase ?? 1;

  if (origin === "USA" || !origin) {
    return {
      fob, originInland: 0, ocean: 0, drayage: 0,
      dutyPct: 0, adcvdPct: 0, dutiesTariffs: 0, customsFees: 0,
      landed: fob, landedUnit: qty ? fob / qty : fob,
    };
  }

  const casesPerContainer = caseCuFt && caseCuFt > 0 ? e.usableCuFt / caseCuFt : 0;
  const oceanRate = origin === "CHINA" ? e.oceanChina : e.oceanIndia;
  const inlandRate = origin === "CHINA" ? e.inlandChina : e.inlandIndia;

  const originInland = casesPerContainer ? inlandRate / casesPerContainer : 0;
  const ocean = casesPerContainer ? oceanRate / casesPerContainer : 0;
  const drayage = casesPerContainer ? (e.drayage + e.broker) / casesPerContainer : 0;

  const dutyPct = e.duty[dutyCat]?.[origin] ?? 0;
  const adcvdPct = e.adcvd[adcvdScope]?.[origin] ?? 0;
  const dutiesTariffs = fob * (dutyPct + adcvdPct) / 100;
  const customsFees = fob * (e.mpfPct + e.hmfPct) / 100;

  const landed = fob + originInland + ocean + drayage + dutiesTariffs + customsFees;
  return {
    fob, originInland, ocean, drayage, dutyPct, adcvdPct,
    dutiesTariffs, customsFees, landed,
    landedUnit: qty ? landed / qty : landed,
  };
}

/** Sell price per case at a target gross margin %. */
export function sellAtMargin(landed: number, marginPct: number): number {
  return landed / (1 - marginPct / 100);
}

/** Gross margin % achieved at a given sell price. */
export function marginAtPrice(landed: number, sell: number): number {
  if (!sell) return 0;
  return ((sell - landed) / sell) * 100;
}

/** Bid-to-win = competitor benchmark undercut by the engine's undercut %. */
export function bidToWin(benchmark: number, rates: EngineRates = ENGINE): number {
  return benchmark * (1 - rates.undercutPct / 100);
}

/** What a China-sourced competitor's landed cost would be (same FOB, China duties + AD/CVD). */
export function competitorChinaLanded(opts: {
  fob: number;
  caseCuFt: number | null;
  dutyCat: string;
  adcvdScope: string;
  rates?: EngineRates;
}): number {
  return computeLanded({ ...opts, origin: "CHINA" }).landed;
}

export const MARGIN_TIERS = [10, 15, 20, 25, 35, 40, 50, 60];

export function fmtUSD(n: number | null | undefined, dp = 2): string {
  if (n === null || n === undefined || isNaN(n as number)) return "—";
  return "$" + (n as number).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
