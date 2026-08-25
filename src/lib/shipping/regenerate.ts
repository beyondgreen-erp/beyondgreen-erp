/* eslint-disable @typescript-eslint/no-explicit-any */
// Rebuild shipping documents (BOL, packing list, pallet/case labels) from the
// packing payload saved on a finalized BOL (bols.payload) or a pack draft.
// Used by the Shipments page so documents stay downloadable after an order ships.
import { buildBOL, buildPackingList, loadImageDataUrl, type BolData, type BolLine, type PackListCase, type PackListPallet } from './bol'
import { buildCaseLabels, buildPalletLabels, type CaseLabel, type PalletLabel } from './labels'
import type { jsPDF } from 'jspdf'

const GRAMS_PER_LB = 453.59237
export interface DocMeta {
  poNumber?: string; orderNumber?: string
  shipToName?: string; shipToAddress?: string
  shipFromName?: string; shipFromAddress?: string; date?: string
}
interface PlanLine { sku: string; description?: string; cases: number; unitsPerCase?: number; upc?: string | null; customerPart?: string | null; gramsPerUnit?: number; caseWeightLb?: number }
interface Content { sku: string; casesPerPallet: number }
interface Config { id?: string; count: number; weightLb?: number; lengthIn?: number; widthIn?: number; heightIn?: number; freightClass?: string; nmfc?: string; stackable?: boolean; contents: Content[] }
export interface DocPayload { configs?: Config[]; plan?: PlanLine[]; lines?: PlanLine[]; bol?: any }

const dims = (l?: number, w?: number, h?: number) => (l || w || h) ? `${l || 0}×${w || 0}×${h || 0} in` : ''
const planOf = (p: DocPayload): PlanLine[] => (p.plan && p.plan.length ? p.plan : (p.lines || []))

interface EP { number: number; weightLb: number; lengthIn: number; widthIn: number; heightIn: number; freightClass?: string; lines: { sku: string; cases: number; unitsPerCase: number; description?: string; upc?: string | null; customerPart?: string | null; caseWeightLb: number }[] }
function expand(p: DocPayload): EP[] {
  const plan = planOf(p); const bySku = new Map(plan.map(r => [r.sku, r]))
  const out: EP[] = []; let n = 0
  for (const cfg of (p.configs || [])) {
    for (let k = 0; k < Math.max(0, cfg.count || 0); k++) {
      n++
      out.push({
        number: n, weightLb: cfg.weightLb || 0, lengthIn: cfg.lengthIn || 0, widthIn: cfg.widthIn || 0, heightIn: cfg.heightIn || 0, freightClass: cfg.freightClass,
        lines: (cfg.contents || []).filter(c => (c.casesPerPallet || 0) > 0).map(c => {
          const r = bySku.get(c.sku)
          return { sku: c.sku, cases: c.casesPerPallet, unitsPerCase: r?.unitsPerCase || 1, description: r?.description, upc: r?.upc ?? null, customerPart: r?.customerPart ?? null, caseWeightLb: r?.caseWeightLb || 0 }
        }),
      })
    }
  }
  return out
}

function packCases(p: DocPayload): PackListCase[] {
  const expanded = expand(p); const plan = planOf(p)
  const bySku = new Map<string, PackListCase>()
  if (expanded.length) {
    expanded.forEach(pl => {
      const palletCases = pl.lines.reduce((a, l) => a + l.cases, 0)
      pl.lines.forEach(l => {
        const alloc = l.caseWeightLb > 0 ? l.cases * l.caseWeightLb : (palletCases > 0 ? (pl.weightLb || 0) * (l.cases / palletCases) : 0)
        const cur = bySku.get(l.sku) || { sku: l.sku, description: l.description, caseCount: 0, casesOrdered: 0, unitsInCase: l.unitsPerCase, weight: 0 }
        cur.caseCount += l.cases; cur.casesOrdered = (cur.casesOrdered || 0) + l.cases; cur.weight = (cur.weight || 0) + alloc
        bySku.set(l.sku, cur)
      })
    })
  } else {
    plan.forEach(r => {
      if (!r.sku && !r.description) return
      const key = r.sku || (r.description || '')
      const cur = bySku.get(key) || { sku: r.sku || '', description: r.description, caseCount: 0, casesOrdered: 0, unitsInCase: r.unitsPerCase, weight: 0 }
      cur.caseCount += r.cases; cur.casesOrdered = (cur.casesOrdered || 0) + r.cases
      cur.weight = (cur.weight || 0) + (r.caseWeightLb || 0) * r.cases
      bySku.set(key, cur)
    })
  }
  return [...bySku.values()]
}

function packPallets(p: DocPayload): PackListPallet[] {
  return expand(p).map(pl => ({ number: pl.number, dims: dims(pl.lengthIn, pl.widthIn, pl.heightIn) || undefined, weight: pl.weightLb, lines: pl.lines.map(l => ({ sku: l.sku, description: l.description, cases: l.cases, units: l.cases * l.unitsPerCase })) }))
}

export function hasBol(p: DocPayload | null | undefined): boolean { return !!(p && p.bol && Array.isArray(p.bol.lines) && p.bol.lines.length) }
export function hasPacking(p: DocPayload | null | undefined): boolean { const pl = p ? planOf(p) : []; return pl.length > 0 || !!(p && p.configs && p.configs.length) }
export function hasPallets(p: DocPayload | null | undefined): boolean { return !!(p && p.configs && p.configs.some(c => (c.count || 0) > 0)) }

export async function regenPackingList(p: DocPayload, meta: DocMeta): Promise<jsPDF> {
  const cases = packCases(p); const plts = packPallets(p)
  const totals = plts.length
    ? { pallets: plts.length, cases: cases.reduce((a, c) => a + c.caseCount, 0), weight: Math.round(plts.reduce((a, x) => a + (x.weight || 0), 0)) }
    : { pallets: 0, cases: cases.reduce((a, c) => a + c.caseCount, 0), weight: Math.round(cases.reduce((a, c) => a + (c.weight || 0), 0)) }
  const logo = await loadImageDataUrl('/bG-logo-clean.png')
  return buildPackingList({ poNumber: meta.poNumber || '', orderNumber: meta.orderNumber || '', shipToName: meta.shipToName || '', shipToAddress: meta.shipToAddress || '', date: meta.date || new Date().toLocaleDateString(), shipFromName: meta.shipFromName, shipFromAddress: meta.shipFromAddress }, cases, totals, logo, plts.length ? plts : undefined)
}

export function regenPalletLabels(p: DocPayload, meta: DocMeta): jsPDF {
  const expanded = expand(p)
  const labels: PalletLabel[] = expanded.map(pl => ({ palletNumber: pl.number, totalPallets: expanded.length, caseCount: pl.lines.reduce((a, l) => a + l.cases, 0), weight: pl.weightLb, skus: pl.lines.map(l => l.sku), dims: dims(pl.lengthIn, pl.widthIn, pl.heightIn) || undefined }))
  return buildPalletLabels({ poNumber: meta.poNumber || '', shipToName: meta.shipToName || '', shipToAddress: meta.shipToAddress || '' }, labels, null)
}

export function regenCaseLabels(p: DocPayload, meta: DocMeta): jsPDF {
  const cases: CaseLabel[] = []
  // Number cases continuously across the WHOLE order (1..grandTotal),
  // grouped by SKU so each case keeps its own part number.
  const plan = planOf(p)
  const grandTotalCases = plan.reduce((s, r) => s + (r.cases || 0), 0)
  let runningCase = 0
  for (const r of plan) for (let n = 1; n <= (r.cases || 0); n++) { runningCase++; cases.push({ sku: r.sku, description: r.description, upcGtin: r.upc ?? null, customerPartNumber: r.customerPart ?? null, vendorPartNumber: r.sku, caseNumber: runningCase, totalCases: grandTotalCases, unitsInCase: r.unitsPerCase }) }
  return buildCaseLabels({ poNumber: meta.poNumber || '', shipToName: meta.shipToName || '', shipToAddress: meta.shipToAddress || '' }, cases)
}

export async function regenBol(p: DocPayload): Promise<jsPDF | null> {
  if (!hasBol(p)) return null
  const f: any = p.bol
  const lines: BolLine[] = (f.lines || []).map((l: any, idx: number) => ({ handlingQty: l.handlingQty, handlingType: 'Pallet', packageQty: l.packageQty, packageType: 'Case', weight: +(+l.weight).toFixed(0), commodityDescription: `Pallet ${idx + 1}: ${l.commodityDescription}`, nmfcNumber: l.nmfcNumber, freightClass: l.freightClass }))
  if (f.poNumber) lines.push({ kind: 'note', commodityDescription: `All items listed as part of PO# ${f.poNumber}` } as any)
  const data: BolData = {
    bolNumber: f.bolNumber, date: f.date, shipFromName: f.shipFromName, shipFromAddress: f.shipFromAddress,
    shipToName: f.shipToName, shipToAddress: f.shipToAddress, carrierName: f.carrierName, scac: f.scac, freightTerms: f.freightTerms,
    proNumber: f.proNumber, trailerNo: f.trailerNo, sealNumber: f.sealNumber,
    specialInstructions: (f.specialInstructions || '').split('\n').filter(Boolean),
    totalPallets: (f.lines || []).length, totalCases: (f.lines || []).reduce((a: number, l: any) => a + (+l.packageQty || 0), 0),
    totalWeight: (f.lines || []).reduce((a: number, l: any) => a + (+l.weight || 0), 0), declaredValue: f.declaredValue,
  }
  const logo = await loadImageDataUrl('/bG-logo-clean.png')
  return buildBOL(data, lines, logo)
}
void GRAMS_PER_LB
