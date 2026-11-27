/* eslint-disable @typescript-eslint/no-explicit-any */
// Inquiry Reply builder: the data behind the "Inquiry Replies" tab on Quotes & RFQs.
// The form captures what a private label / pet waste bag prospect asked for, the costing is worked
// here (never by the AI), and the email and the next-steps PDF are built from this one object.

export type Channel = 'Amazon' | 'Online store' | 'Retail stores' | 'Wholesale / distribution' | 'Municipality / HOA' | 'Pet business' | 'Other'
export type BagFormat = 'Folded rolls (leash dispenser refills)' | 'Rolls on core' | 'Lay-flat single pull' | 'Cat litter bags (gusseted handle)' | 'Kitchen / food waste bags' | 'Other'
export type Packaging = 'Custom printed retail box' | 'Standard retail box with their logo' | 'Plain retail box' | 'Bulk case (no retail packaging)' | 'Poly bag / pouch' | 'Not decided yet'
export type Dispenser = 'None' | 'Recycled plastic leash dispenser' | 'Compostable leash dispenser' | 'Silicone leash dispenser' | 'Custom molded dispenser (new mold)'
export type StepStatus = 'done' | 'next' | 'later'

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
  { key: 'astm', label: 'ASTM D6400', detail: 'Industrial compostability (US standard)' },
  { key: 'en', label: 'EN 13432', detail: 'Industrial compostability (EU standard)' },
  { key: 'okhome', label: 'TUV AUSTRIA OK compost HOME', detail: 'Certificate TA8011601456 (S560)' },
  { key: 'okind', label: 'TUV AUSTRIA OK compost INDUSTRIAL', detail: 'Certificate TA8011601456 (S560)' },
  { key: 'usda', label: 'USDA Certified Biobased', detail: 'Biobased content certification' },
]
export const BPI_NOTE = 'BPI does not certify pet waste bags, so there is no BPI certificate for this product.'
export const MATERIAL_NOTE = 'Certified compostable biopolymer film, a blend of PBAT and PLA (BASF ecovio), made at our facility in Santa Ana, California.'

// Reference costs from the products board (9 x 12 in, 18 micron folded rolls, cost per bag). Used to scale a
// starting cost for other sizes by film area x thickness. Dhanush can overwrite the cost at any time.
export const BASE_BAG = { widthIn: 9, lengthIn: 12, micron: 18, costPerBag: 0.039 }
// Pricing Calculator rules: resale at 20% gross margin, and private label tiers on bag volume.
export const BASE_GPM = 0.2
export function tierMarkup(bags: number): number { return bags >= 1_000_000 ? 0 : bags >= 500_000 ? 0.15 : 0.35 }

export const emptyForm = (preparedBy = ''): InquiryForm => ({
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

export const unitName = (f: InquiryForm) =>
  f.packaging === 'Bulk case (no retail packaging)' ? 'case' : f.packaging === 'Poly bag / pouch' ? 'pouch' : 'retail box'

export function specLines(f: InquiryForm): [string, string][] {
  const rows: [string, string][] = []
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
export function pricingTableHtml(f: InquiryForm): string {
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
  return tierRows(f).map(r => `${int(r.units)} x ${un}: ${money(r.pricePerUnit)} per ${un}${r.pricePerRoll != null ? ` (${money4(r.pricePerRoll)} per roll)` : ''}, total ${money(r.total)}`).join('\n')
}

export interface Step { title: string; who: 'You' | 'beyondGREEN' | 'Both'; detail: string; status: StepStatus }

/** The customer's road to launch, worked out from what is already done. */
export function buildSteps(f: InquiryForm): Step[] {
  const un = unitName(f)
  const city = f.sampleAddress ? (f.sampleAddress.split(/\n|,/).map(s => s.trim()).filter(Boolean).slice(-2).join(', ')) : ''
  const steps: Step[] = []
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
  const rows = tierRows(f)
  return {
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
