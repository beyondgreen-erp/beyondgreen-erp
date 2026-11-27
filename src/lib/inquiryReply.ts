/* eslint-disable @typescript-eslint/no-explicit-any */
// Inquiry Reply builder: the data behind the "Inquiry Replies" tab on Quotes & RFQs.
// The form captures what a prospect asked for (pet waste bags have a full bag form; every other product
// uses the general form with manual costing and tooling), the costing is worked here (never by the AI),
// and the email and the next-steps PDF are built from this one object.

export type Channel = 'Amazon' | 'Online store' | 'Retail stores' | 'Wholesale / distribution' | 'Municipality / HOA' | 'Pet business' | 'Other'
export type BagFormat = 'Folded rolls (leash dispenser refills)' | 'Rolls on core' | 'Lay-flat single pull' | 'Cat litter bags (gusseted handle)' | 'Kitchen / food waste bags' | 'Other'
export type Packaging = 'Custom printed retail box' | 'Standard retail box with their logo' | 'Plain retail box' | 'Bulk case (no retail packaging)' | 'Poly bag / pouch' | 'Not decided yet'
export type Dispenser = 'None' | 'Recycled plastic leash dispenser' | 'Compostable leash dispenser' | 'Silicone leash dispenser' | 'Custom molded dispenser (new mold)'
export type StepStatus = 'done' | 'next' | 'later'
export type ProductType = 'Pet waste bags' | 'Straws' | 'Cutlery' | 'Cups and lids' | 'Film bags (retail, produce, kitchen)' | 'Paper bags' | 'Containers and packaging' | 'Other or new product'
export const PRODUCT_TYPES: ProductType[] = ['Pet waste bags', 'Straws', 'Cutlery', 'Cups and lids', 'Film bags (retail, produce, kitchen)', 'Paper bags', 'Containers and packaging', 'Other or new product']
export const TOOLING_KINDS = ['Extrusion die', 'Injection mold', 'Thermoforming mold', 'Print plates', 'Cutting die', 'Other tooling'] as const
export interface GenTier { qty: number; price: number | null }
export interface Tooling { needed: boolean; kind: string; cost: number | null; moq: string; leadTime: string; note: string }

export interface Tier { units: number; pricePerBag: number | null; packagingEach: number | null; dispenserQty: number | null }

export interface InquiryForm {
  // who
  contactFirst: string
  contactFull: string
  company: string
  brand: string
  email: string
  phone: string
  location: string
  channel: Channel
  source: string
  launch: string
  // what they wrote (pasted) and what they asked, one question per line
  inquiryText: string
  questions: string
  // product
  format: BagFormat
  widthIn: number | null
  lengthIn: number | null
  micron: number | null
  bagsPerRoll: number | null
  rollsPerUnit: number | null
  color: string
  scent: string
  bagPrint: 'None' | '1 color print' | 'Not decided yet'
  packaging: Packaging
  dispenser: Dispenser
  dispenserLogo: 'None' | 'Printed' | 'Embossed (needs a mold)' | 'Not decided yet'
  // status of the things we need from them
  logoReceived: boolean
  artworkReceived: boolean
  dielineReceived: boolean
  samplesRequested: boolean
  sampleAddress: string
  // money
  basis: 'FOB Santa Ana, CA' | 'Delivered (DDP)'
  costPerBag: number | null
  tiers: Tier[]
  dispenserEach: number | null
  plateCharge: number | null
  moldCost: number | null
  freightNote: string
  paymentTerms: string
  leadTime: string
  quoteNumber: string
  // any product other than pet waste bags
  productType: ProductType
  productDesc: string
  specs: string
  unitLabel: string
  material: string
  madeInSantaAna: boolean
  printNote: string
  costEach: number | null
  genTiers: GenTier[]
  tooling: Tooling
  alternative: string
  // certifications to list
  certs: string[]
  // anything Dhanush wants said, his way
  notes: string
  preparedBy: string
}

export const CHANNELS: Channel[] = ['Amazon', 'Online store', 'Retail stores', 'Wholesale / distribution', 'Municipality / HOA', 'Pet business', 'Other']
export const FORMATS: BagFormat[] = ['Folded rolls (leash dispenser refills)', 'Rolls on core', 'Lay-flat single pull', 'Cat litter bags (gusseted handle)', 'Kitchen / food waste bags', 'Other']
export const PACKAGINGS: Packaging[] = ['Custom printed retail box', 'Standard retail box with their logo', 'Plain retail box', 'Bulk case (no retail packaging)', 'Poly bag / pouch', 'Not decided yet']
export const DISPENSERS: Dispenser[] = ['None', 'Recycled plastic leash dispenser', 'Compostable leash dispenser', 'Silicone leash dispenser', 'Custom molded dispenser (new mold)']

// Certifications as stated in the team's replies (Nov 2026). BPI does not certify pet waste bags.
export const CERTS: { key: string; label: string; detail: string }[] = [
  { key: 'bpi', label: 'BPI Certified Compostable', detail: 'For our listed stock items; a new custom item is certified separately' },
  { key: 'food', label: 'Food contact compliance', detail: 'Resin supplier food contact compliance documentation' },
  { key: 'astm', label: 'ASTM D6400', detail: 'Industrial compostability (US standard)' },
  { key: 'en', label: 'EN 13432', detail: 'Industrial compostability (EU standard)' },
  { key: 'okhome', label: 'TUV AUSTRIA OK compost HOME', detail: 'Certificate TA8011601456 (S560)' },
  { key: 'okind', label: 'TUV AUSTRIA OK compost INDUSTRIAL', detail: 'Certificate TA8011601456 (S560)' },
  { key: 'usda', label: 'USDA Certified Biobased', detail: 'Biobased content certification' },
]
export const BPI_NOTE = 'BPI does not certify pet waste bags, so there is no BPI certificate for this product.'
export const BAG_CERTS = ['astm', 'en', 'okhome', 'okind', 'usda']
export function defaultCerts(t: ProductType): string[] {
  if (t === 'Pet waste bags') return BAG_CERTS
  if (t === 'Straws' || t === 'Cutlery') return ['bpi', 'food', 'astm']
  if (t === 'Film bags (retail, produce, kitchen)') return ['bpi', 'astm']
  if (t === 'Other or new product') return ['food']
  return []
}
/** Material and where it is made, per product line (resins from the production notes). Editable on the form. */
export function defaultMaterial(t: ProductType): { material: string; santaAna: boolean; unit: string } {
  switch (t) {
    case 'Straws': return { material: 'Certified compostable biopolymer (BASF ecovio), profile extruded in Santa Ana, CA', santaAna: true, unit: 'straw' }
    case 'Cutlery': return { material: 'Certified compostable biopolymer (BASF ecovio), injection molded in Santa Ana, CA', santaAna: true, unit: 'piece' }
    case 'Film bags (retail, produce, kitchen)': return { material: 'Certified compostable PBAT and PLA blend (BASF ecovio), made in Santa Ana, CA', santaAna: true, unit: 'bag' }
    case 'Cups and lids': return { material: '', santaAna: false, unit: 'cup' }
    case 'Paper bags': return { material: '', santaAna: false, unit: 'bag' }
    default: return { material: '', santaAna: false, unit: 'piece' }
  }
}
/** Stock items to start from (cost per piece, FOB Santa Ana, from the SKU pricing sheet). */
export const CATALOG: { type: ProductType; label: string; unit: string; cost: number; specs: string }[] = [
  { type: 'Straws', label: '7.75 in jumbo straw, 6 mm, unwrapped (white)', unit: 'straw', cost: 0.013, specs: 'Length: 7.75 in\nDiameter: 6 mm\nWrap: unwrapped\nCase: 2,500' },
  { type: 'Straws', label: '7.75 in jumbo straw, 6 mm, unwrapped (green)', unit: 'straw', cost: 0.015, specs: 'Length: 7.75 in\nDiameter: 6 mm\nColor: green\nWrap: unwrapped\nCase: 2,500' },
  { type: 'Straws', label: '7.75 in jumbo straw, 6 mm, paper wrapped (green)', unit: 'straw', cost: 0.021, specs: 'Length: 7.75 in\nDiameter: 6 mm\nColor: green\nWrap: paper wrapped\nCase: 2,500' },
  { type: 'Straws', label: '8.25 in bendy straw, 6 mm, unwrapped', unit: 'straw', cost: 0.025, specs: 'Length: 8.25 in\nDiameter: 6 mm\nStyle: flexible (bendy)\nCase: 2,500' },
  { type: 'Straws', label: '10.25 in giant straw, unwrapped', unit: 'straw', cost: 0.018, specs: 'Length: 10.25 in\nCase: 1,850' },
  { type: 'Straws', label: '10.5 in smoothie straw, 9.25 mm, wrapped', unit: 'straw', cost: 0.025, specs: 'Length: 10.5 in\nDiameter: 9.25 mm\nWrap: wrapped\nCase: 1,500' },
  { type: 'Straws', label: '5.75 in cocktail straw, 5.75 mm', unit: 'straw', cost: 0.010, specs: 'Length: 5.75 in\nDiameter: 5.75 mm\nCase: 2,500' },
  { type: 'Cutlery', label: 'Fork (bulk)', unit: 'piece', cost: 0.037, specs: 'Item: fork' },
  { type: 'Cutlery', label: 'Knife (bulk)', unit: 'piece', cost: 0.036, specs: 'Item: knife' },
  { type: 'Cutlery', label: 'Spoon (bulk)', unit: 'piece', cost: 0.035, specs: 'Item: spoon' },
  { type: 'Cutlery', label: 'Fork, individually film wrapped', unit: 'piece', cost: 0.067, specs: 'Item: fork\nWrap: individually film wrapped' },
  { type: 'Cups and lids', label: '12 oz printed double wall paper cup', unit: 'cup', cost: 0.07, specs: 'Size: 12 oz\nWall: double wall, aqueous coated\nCase: 500' },
  { type: 'Cups and lids', label: '16 oz printed double wall paper cup', unit: 'cup', cost: 0.08, specs: 'Size: 16 oz\nWall: double wall, aqueous coated\nCase: 500' },
  { type: 'Cups and lids', label: '90 mm hot cup sipper lid', unit: 'lid', cost: 0.055, specs: 'Fits: 12 and 16 oz hot cups\nCase: 1,000' },
]
export const MATERIAL_NOTE = 'Certified compostable biopolymer film, a blend of PBAT and PLA (BASF ecovio), made at our facility in Santa Ana, California.'

// Reference costs from the products board (9 x 12 in, 18 micron folded rolls, cost per bag). Used to scale a
// starting cost for other sizes by film area x thickness. Dhanush can overwrite the cost at any time.
export const BASE_BAG = { widthIn: 9, lengthIn: 12, micron: 18, costPerBag: 0.039 }
// Pricing Calculator rules: resale at 20% gross margin, and private label tiers on bag volume.
export const BASE_GPM = 0.2
export function tierMarkup(bags: number): number { return bags >= 1_000_000 ? 0 : bags >= 500_000 ? 0.15 : 0.35 }

export const emptyForm = (preparedBy = ''): InquiryForm => ({
  productType: 'Pet waste bags', productDesc: '', specs: '', unitLabel: 'piece', material: '', madeInSantaAna: true, printNote: '', costEach: null,
  genTiers: [{ qty: 5000, price: null }], tooling: { needed: false, kind: 'Extrusion die', cost: null, moq: '', leadTime: '', note: '' }, alternative: '',
  contactFirst: '', contactFull: '', company: '', brand: '', email: '', phone: '', location: '', channel: 'Amazon', source: 'Website contact form', launch: '',
  inquiryText: '', questions: '',
  format: 'Folded rolls (leash dispenser refills)', widthIn: 9, lengthIn: 13, micron: 20, bagsPerRoll: 15, rollsPerUnit: 20, color: 'Green (our standard)', scent: 'Unscented', bagPrint: 'None',
  packaging: 'Custom printed retail box', dispenser: 'None', dispenserLogo: 'None',
  logoReceived: false, artworkReceived: false, dielineReceived: false, samplesRequested: true, sampleAddress: '',
  basis: 'FOB Santa Ana, CA', costPerBag: null, tiers: [{ units: 1000, pricePerBag: null, packagingEach: null, dispenserQty: null }],
  dispenserEach: null, plateCharge: 250, moldCost: null, freightNote: 'Freight is quoted at the time of shipment and billed at actual cost.',
  paymentTerms: 'Prepayment for new accounts', leadTime: '4 to 6 weeks after artwork approval', quoteNumber: '',
  certs: ['astm', 'en', 'okhome', 'okind', 'usda'], notes: '', preparedBy,
})

const n = (v: any) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
export const money = (v: number, dp = 2) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
export const money4 = (v: number) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
export const int = (v: number) => Math.round(v).toLocaleString('en-US')

export const bagsPerUnit = (f: InquiryForm) => Math.max(1, n(f.bagsPerRoll) || 1) * Math.max(1, n(f.rollsPerUnit) || 1)

/** Starting cost per bag: the reference cost scaled by film area x thickness. */
export function suggestedCost(f: InquiryForm): number {
  const area = (n(f.widthIn) || BASE_BAG.widthIn) * (n(f.lengthIn) || BASE_BAG.lengthIn) * (n(f.micron) || BASE_BAG.micron)
  const base = BASE_BAG.widthIn * BASE_BAG.lengthIn * BASE_BAG.micron
  return Math.round(BASE_BAG.costPerBag * (area / base) * 10000) / 10000
}
export const costPerBag = (f: InquiryForm) => (n(f.costPerBag) > 0 ? n(f.costPerBag) : suggestedCost(f))

/** Suggested selling price per bag for a tier: cost at 20% GPM, plus the private label volume markup. */
export function suggestedPrice(f: InquiryForm, units: number): number {
  const bags = units * bagsPerUnit(f)
  return Math.round((costPerBag(f) / (1 - BASE_GPM)) * (1 + tierMarkup(bags)) * 10000) / 10000
}

export interface TierRow {
  units: number; bags: number; pricePerBag: number; pricePerRoll: number | null; packagingEach: number | null
  pricePerUnit: number; bagsTotal: number; packagingTotal: number; dispenserQty: number; dispenserTotal: number; total: number
  // internal only, never shown to the customer
  costTotal: number; marginPct: number | null
}

export function tierRows(f: InquiryForm): TierRow[] {
  const bpu = bagsPerUnit(f)
  const rollBags = n(f.bagsPerRoll)
  return (f.tiers || []).filter(t => n(t.units) > 0).map(t => {
    const units = n(t.units)
    const pricePerBag = n(t.pricePerBag) > 0 ? n(t.pricePerBag) : suggestedPrice(f, units)
    const packagingEach = n(t.packagingEach) > 0 ? n(t.packagingEach) : null
    const pricePerUnit = pricePerBag * bpu + (packagingEach || 0)
    const bags = units * bpu
    const bagsTotal = pricePerBag * bags
    const packagingTotal = (packagingEach || 0) * units
    const dispenserQty = f.dispenser !== 'None' ? (n(t.dispenserQty) > 0 ? n(t.dispenserQty) : 0) : 0
    const dispenserTotal = dispenserQty * n(f.dispenserEach)
    const total = bagsTotal + packagingTotal + dispenserTotal
    const costTotal = costPerBag(f) * bags
    return {
      units, bags, pricePerBag, pricePerRoll: rollBags > 0 ? pricePerBag * rollBags : null, packagingEach, pricePerUnit,
      bagsTotal, packagingTotal, dispenserQty, dispenserTotal, total,
      costTotal, marginPct: bagsTotal > 0 ? (bagsTotal - costTotal) / bagsTotal : null,
    }
  })
}

export const plural = (word: string, count: number) => count === 1 ? word : /(x|ch|sh|s)$/.test(word) ? word + 'es' : word + 's'

export const isBags = (f: InquiryForm) => !f.productType || f.productType === 'Pet waste bags'

export const unitName = (f: InquiryForm) =>
  !isBags(f) ? ((f.unitLabel || 'piece').trim() || 'piece')
    : f.packaging === 'Bulk case (no retail packaging)' ? 'case' : f.packaging === 'Poly bag / pouch' ? 'pouch' : 'retail box'

/** General products: price per unit is typed in, or cost at 20% margin (resale rule on the SKU pricing sheet). */
export const genSuggestedPrice = (f: InquiryForm) => (n(f.costEach) > 0 ? Math.round((n(f.costEach) / (1 - BASE_GPM)) * 10000) / 10000 : null)
export interface GenRow { qty: number; price: number | null; total: number | null; costTotal: number | null; marginPct: number | null }
export function genRows(f: InquiryForm): GenRow[] {
  return (f.genTiers || []).filter(t => n(t.qty) > 0).map(t => {
    const price = n(t.price) > 0 ? n(t.price) : genSuggestedPrice(f)
    const total = price != null ? price * n(t.qty) : null
    const costTotal = n(f.costEach) > 0 ? n(f.costEach) * n(t.qty) : null
    return { qty: n(t.qty), price, total, costTotal, marginPct: total && costTotal != null ? (total - costTotal) / total : null }
  })
}
/** One view of the quote for any product: quantity, order total and margin (used for leads and the log). */
export function quoteSummary(f: InquiryForm): { units: number; total: number; marginPct: number | null }[] {
  return isBags(f) ? tierRows(f).map(r => ({ units: r.units, total: r.total, marginPct: r.marginPct }))
    : genRows(f).map(r => ({ units: r.qty, total: r.total || 0, marginPct: r.marginPct }))
}
export function toolingLine(f: InquiryForm): string | null {
  const t = f.tooling
  if (isBags(f) || !t?.needed) return null
  const parts = [`${t.kind || 'Tooling'}: ${n(t.cost) > 0 ? `${money(n(t.cost), 0)} one time` : 'quoted separately'}`]
  if (t.moq) parts.push(`minimum run ${t.moq}`)
  if (t.leadTime) parts.push(`tooling lead time ${t.leadTime}`)
  return parts.join(', ')
}

export function specLines(f: InquiryForm): [string, string][] {
  const rows: [string, string][] = []
  if (!isBags(f)) {
    rows.push(['Product', f.productType])
    if (f.productDesc.trim()) rows.push(['What you asked for', f.productDesc.trim()])
    for (const line of (f.specs || '').split('\n').map(x => x.trim()).filter(Boolean)) {
      const i = line.indexOf(':')
      rows.push(i > 0 ? [line.slice(0, i).trim(), line.slice(i + 1).trim()] : ['Detail', line])
    }
    if (f.printNote.trim()) rows.push(['Printing or branding', f.printNote.trim()])
    const tl = toolingLine(f); if (tl) rows.push(['Tooling', tl])
    if (f.material.trim()) rows.push(['Material', f.material.trim()])
    return rows
  }
  rows.push(['Product', f.format])
  if (n(f.widthIn) && n(f.lengthIn)) rows.push(['Bag size', `${n(f.widthIn)} x ${n(f.lengthIn)} in (${Math.round(n(f.widthIn) * 2.54)} x ${Math.round(n(f.lengthIn) * 2.54)} cm)`])
  if (n(f.micron)) rows.push(['Thickness', `${n(f.micron)} micron`])
  if (n(f.bagsPerRoll)) rows.push(['Bags per roll', String(n(f.bagsPerRoll))])
  if (n(f.rollsPerUnit)) rows.push([`Rolls per ${unitName(f)}`, `${n(f.rollsPerUnit)} (${int(bagsPerUnit(f))} bags)`])
  rows.push(['Color and scent', [f.color, f.scent].filter(Boolean).join(', ')])
  rows.push(['Print on bags', f.bagPrint])
  rows.push(['Packaging', f.packaging])
  if (f.dispenser !== 'None') rows.push(['Dispenser', `${f.dispenser}${f.dispenserLogo !== 'None' ? `, logo ${f.dispenserLogo.toLowerCase()}` : ''}`])
  rows.push(['Material', 'Certified compostable PBAT and PLA blend (BASF ecovio), made in Santa Ana, CA'])
  return rows
}

/** The pricing table that goes into the email, built here so the AI never touches a number. */
function genTableHtml(f: InquiryForm): string {
  const rows = genRows(f).filter(r => r.price != null)
  if (!rows.length) return ''
  const th = 'padding:6px 10px;border:1px solid #cfd6dd;background:#eef5ee;text-align:left;font-family:Arial,sans-serif;font-size:10pt'
  const td = 'padding:6px 10px;border:1px solid #cfd6dd;font-family:Arial,sans-serif;font-size:10pt'
  const un = unitName(f)
  const body = rows.map(r => `<tr><td style="${td}">${int(r.qty)} ${plural(un, r.qty)}</td><td style="${td}">${money4(r.price!)}</td><td style="${td}">${money(r.total!)}</td></tr>`).join('')
  const t = f.tooling
  const tool = t?.needed && n(t.cost) > 0 ? `<tr><td style="${td}">${t.kind || 'Tooling'} (one time)</td><td style="${td}"></td><td style="${td}">${money(n(t.cost), 0)}</td></tr>` : ''
  return `<table style="border-collapse:collapse;margin:6px 0 10px 0"><tr><th style="${th}">Quantity</th><th style="${th}">Price per ${un}</th><th style="${th}">Total</th></tr>${body}${tool}</table>`
}

export function pricingTableHtml(f: InquiryForm): string {
  if (!isBags(f)) return genTableHtml(f)
  const rows = tierRows(f)
  if (!rows.length) return ''
  const th = 'padding:6px 10px;border:1px solid #cfd6dd;background:#eef5ee;text-align:left;font-family:Arial,sans-serif;font-size:10pt'
  const td = 'padding:6px 10px;border:1px solid #cfd6dd;font-family:Arial,sans-serif;font-size:10pt'
  const un = unitName(f)
  const showRoll = rows.some(r => r.pricePerRoll != null)
  const showPkg = rows.some(r => r.packagingEach != null)
  const showDisp = rows.some(r => r.dispenserQty > 0)
  const head = [`Order size`, `Bags`, showRoll ? 'Price per roll' : 'Price per bag', showPkg ? `Packaging per ${un}` : null, `Price per ${un}`, showDisp ? 'Dispensers' : null, 'Order total']
    .filter(Boolean).map(h => `<th style="${th}">${h}</th>`).join('')
  const body = rows.map(r => {
    const cells = [
      `${int(r.units)} ${plural(un, r.units)}`,
      int(r.bags),
      showRoll ? money4(r.pricePerRoll || 0) : money4(r.pricePerBag),
      showPkg ? (r.packagingEach != null ? money(r.packagingEach) : 'TBC') : null,
      money(r.pricePerUnit),
      showDisp ? (r.dispenserQty ? `${int(r.dispenserQty)} at ${money(r.dispenserTotal / r.dispenserQty)}` : '') : null,
      money(r.total),
    ].filter(c => c !== null)
    return `<tr>${cells.map(c => `<td style="${td}">${c}</td>`).join('')}</tr>`
  }).join('')
  return `<table style="border-collapse:collapse;margin:6px 0 10px 0">${'<tr>' + head + '</tr>'}${body}</table>`
}

export function pricingTableText(f: InquiryForm): string {
  const un = unitName(f)
  if (!isBags(f)) return [...genRows(f).filter(r => r.price != null).map(r => `${int(r.qty)} ${plural(un, r.qty)}: ${money4(r.price!)} per ${un}, total ${money(r.total!)}`), f.tooling?.needed && n(f.tooling.cost) > 0 ? `${f.tooling.kind}: ${money(n(f.tooling.cost), 0)}` : ''].filter(Boolean).join('\n')
  return tierRows(f).map(r => `${int(r.units)} x ${un}: ${money(r.pricePerUnit)} per ${un}${r.pricePerRoll != null ? ` (${money4(r.pricePerRoll)} per roll)` : ''}, total ${money(r.total)}`).join('\n')
}

export interface Step { title: string; who: 'You' | 'beyondGREEN' | 'Both'; detail: string; status: StepStatus }

/** The customer's road to launch, worked out from what is already done. */
export function buildSteps(f: InquiryForm): Step[] {
  const un = unitName(f)
  const city = f.sampleAddress ? (f.sampleAddress.split(/\n|,/).map(s => s.trim()).filter(Boolean).slice(-2).join(', ')) : ''
  const steps: Step[] = []
  if (!isBags(f)) {
    const t = f.tooling
    if (f.samplesRequested) steps.push({ title: t?.needed ? 'Stock samples' : 'Samples', who: 'beyondGREEN', status: 'next', detail: `We ship complimentary samples${t?.needed ? ' of our closest stock item' : ''}${city ? ` to ${city}` : ''} so you can check size, feel and color.` })
    if (t?.needed) {
      steps.push({ title: 'Design and drawing', who: 'Both', status: 'next', detail: `You share the shape and sizes you want. We send a technical drawing of the ${un} for your approval.` })
      steps.push({ title: t.kind || 'Tooling', who: 'beyondGREEN', status: 'later', detail: `We make the ${(t.kind || 'tooling').toLowerCase()}${n(t.cost) > 0 ? ` (${money(n(t.cost), 0)} one time)` : ''}${t.leadTime ? `, about ${t.leadTime}` : ''}. It is built for your design only.` })
      steps.push({ title: 'First samples from the new tooling', who: 'Both', status: 'later', detail: 'We run a short trial and send you samples. Production starts only after you approve them in writing.' })
    }
    if (f.printNote.trim() || f.logoReceived) steps.push({ title: 'Logo and artwork', who: 'You', status: f.artworkReceived ? 'done' : 'next', detail: f.artworkReceived ? 'Received, thank you.' : 'Please send your logo as a vector file (AI, EPS or PDF), and we send a digital proof for approval.' })
    steps.push({ title: 'Purchase order and payment', who: 'You', status: 'later', detail: `Send your PO for the quantity you choose${t?.needed && t.moq ? ` (minimum run ${t.moq})` : ''}. Terms: ${f.paymentTerms || 'to be confirmed'}.` })
    steps.push({ title: 'Production', who: 'beyondGREEN', status: 'later', detail: `${f.madeInSantaAna ? 'Made at our Santa Ana, California facility. ' : ''}Lead time: ${f.leadTime || 'to be confirmed'}.` })
    steps.push({ title: 'Shipping', who: 'beyondGREEN', status: 'later', detail: `${f.basis}. ${f.freightNote}${f.channel === 'Amazon' ? ' We can pack and label cartons to Amazon FBA requirements.' : ''}`.trim() })
    if (f.certs.length) steps.push({ title: 'Certificates and documents', who: 'beyondGREEN', status: 'later', detail: `We send copies of the documents listed below${f.certs.includes('food') ? ', including food contact compliance' : ''}.` })
    return steps
  }
  if (f.samplesRequested) steps.push({ title: 'Samples', who: 'beyondGREEN', status: 'next', detail: `We ship complimentary samples${city ? ` to ${city}` : ''} and send you the tracking number.` })
  const needsArt = f.packaging !== 'Bulk case (no retail packaging)' && f.packaging !== 'Not decided yet'
  if (needsArt) {
    steps.push({
      title: 'Logo and artwork', who: 'You', status: f.logoReceived && f.artworkReceived ? 'done' : f.logoReceived ? 'next' : 'next',
      detail: f.logoReceived && f.artworkReceived ? 'Received, thank you.' : f.logoReceived ? `We have your logo. Next we need the final artwork for the ${un}.` : 'Please send your logo as a vector file (AI, EPS or PDF).',
    })
    steps.push({
      title: `${un.charAt(0).toUpperCase() + un.slice(1)} dieline`, who: 'beyondGREEN', status: f.dielineReceived ? 'done' : 'next',
      detail: f.dielineReceived ? 'Dieline in hand.' : `We send you the dieline for our standard ${un} sized for ${int(bagsPerUnit(f))} bags, so your designer can lay out the art.`,
    })
    steps.push({ title: 'Digital proof and approval', who: 'Both', status: 'later', detail: 'We send a digital proof of the printed packaging. Production starts only after you approve it in writing.' })
  }
  if (f.bagPrint === '1 color print') steps.push({ title: 'Bag print plate', who: 'beyondGREEN', status: 'later', detail: `One-time plate charge${n(f.plateCharge) ? ` of ${money(n(f.plateCharge))}` : ''} per design for printing on the bags.` })
  if (f.dispenser === 'Custom molded dispenser (new mold)' || f.dispenserLogo === 'Embossed (needs a mold)') steps.push({ title: 'Dispenser mold', who: 'beyondGREEN', status: 'later', detail: `A dedicated mold is made for your dispenser${n(f.moldCost) ? ` (${money(n(f.moldCost), 0)} one time)` : ''}. The mold is your property.` })
  steps.push({ title: 'Purchase order and payment', who: 'You', status: 'later', detail: `Send your PO for the quantity you choose. Terms: ${f.paymentTerms || 'to be confirmed'}.` })
  steps.push({ title: 'Production', who: 'beyondGREEN', status: 'later', detail: `Made at our Santa Ana, California facility. Lead time: ${f.leadTime || 'to be confirmed'}.` })
  steps.push({
    title: 'Shipping', who: 'beyondGREEN', status: 'later',
    detail: `${f.basis}. ${f.freightNote}${f.channel === 'Amazon' ? ' We can pack and label cartons to Amazon FBA requirements.' : ''}`.trim(),
  })
  steps.push({ title: 'Compliance paperwork', who: 'beyondGREEN', status: 'later', detail: 'Certificates and our Private Label Environmental Compliance Agreement, which covers the compostability claims on your packaging.' })
  return steps
}

/** Facts handed to the writer. Only these may appear in the email. */
export function factsForWriter(f: InquiryForm) {
  if (!isBags(f)) {
    const rows = genRows(f)
    const t = f.tooling
    return {
      product_type: f.productType,
      contact_first_name: f.contactFirst, contact_full_name: f.contactFull, company: f.company, brand: f.brand, location: f.location,
      sales_channel: f.channel, how_they_found_us: f.source, launch_timing: f.launch,
      their_questions_in_order: f.questions.split('\n').map(s => s.trim()).filter(Boolean),
      their_original_message: f.inquiryText.slice(0, 6000),
      what_they_want: f.productDesc, spec: Object.fromEntries(specLines(f)), unit: unitName(f),
      quantities: rows.map(r => ({ quantity: r.qty, priced: r.price != null })),
      pricing_table_placeholder: rows.some(r => r.price != null) ? '{{PRICING_TABLE}}' : null,
      pricing_status: rows.some(r => r.price != null) ? 'priced in the table' : 'no prices yet: say we will send pricing, and when (follow the lead time and notes)',
      tooling: t?.needed ? { type: t.kind, one_time_cost: n(t.cost) > 0 ? money(n(t.cost), 0) : 'to be quoted separately', minimum_run: t.moq || 'to be confirmed', tooling_lead_time: t.leadTime || 'to be confirmed', note: t.note || null } : null,
      requested_quantity_below_minimum_run: !!(t?.needed && t.moq && rows.length && rows.every(r => r.qty < Number(String(t.moq).replace(/[^0-9.]/g, '')) )),
      alternative_we_can_offer: f.alternative || null,
      printing_or_branding: f.printNote || null,
      price_basis: f.basis, freight: f.freightNote, payment_terms: f.paymentTerms, lead_time: f.leadTime,
      made_in: f.madeInSantaAna ? 'Santa Ana, California (our facility)' : null, material: f.material || null,
      samples: f.samplesRequested ? { complimentary: true, of: t?.needed ? 'our closest stock item' : 'the item', ship_to: f.sampleAddress || null } : null,
      certifications_and_documents: CERTS.filter(c => f.certs.includes(c.key)).map(c => `${c.label} (${c.detail})`),
      quote_number: f.quoteNumber || null,
      attachment: 'A one-page PDF with their project summary, pricing and next steps is attached to this email.',
      notes_from_sender: f.notes,
      sender_first_name: (f.preparedBy || '').split(' ')[0] || '',
    }
  }
  const rows = tierRows(f)
  return {
    product_type: 'Pet waste bags (private label)',
    contact_first_name: f.contactFirst, contact_full_name: f.contactFull, company: f.company, brand: f.brand, location: f.location,
    sales_channel: f.channel, how_they_found_us: f.source, launch_timing: f.launch,
    their_questions_in_order: f.questions.split('\n').map(s => s.trim()).filter(Boolean),
    their_original_message: f.inquiryText.slice(0, 6000),
    spec: Object.fromEntries(specLines(f)),
    quantities: rows.map(r => ({ units: r.units, unit: unitName(f), bags: r.bags })),
    pricing_table_placeholder: rows.length ? '{{PRICING_TABLE}}' : null,
    price_basis: f.basis, freight: f.freightNote, payment_terms: f.paymentTerms, lead_time: f.leadTime,
    plate_charge: f.bagPrint === '1 color print' && n(f.plateCharge) ? money(n(f.plateCharge)) + ' one time per design' : null,
    dispenser: f.dispenser === 'None' ? null : { style: f.dispenser, logo: f.dispenserLogo, price_each: n(f.dispenserEach) ? money(n(f.dispenserEach)) : null, mold_cost: n(f.moldCost) ? money(n(f.moldCost), 0) : null },
    what_we_already_have: { logo: f.logoReceived, artwork: f.artworkReceived, dieline: f.dielineReceived },
    samples: f.samplesRequested ? { complimentary: true, ship_to: f.sampleAddress || null } : null,
    certifications: CERTS.filter(c => f.certs.includes(c.key)).map(c => `${c.label} (${c.detail})`),
    bpi_note: BPI_NOTE, material: MATERIAL_NOTE,
    quote_number: f.quoteNumber || null,
    attachment: 'A one-page PDF titled "Your private label program: next steps" is attached to this email.',
    notes_from_sender: f.notes,
    sender_first_name: (f.preparedBy || '').split(' ')[0] || '',
  }
}
