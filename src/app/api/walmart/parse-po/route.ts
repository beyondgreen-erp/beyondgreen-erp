import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function firstJson(text: string): any {
  const a = text.indexOf('{'); const b = text.lastIndexOf('}')
  if (a === -1 || b === -1 || b < a) return {}
  try { return JSON.parse(text.slice(a, b + 1)) } catch { return {} }
}
const s = (v: unknown) => { const t = String(v ?? '').trim(); return t && t.toLowerCase() !== 'null' ? t : '' }
const digits = (v: unknown) => s(v).replace(/\D/g, '')
const num = (v: unknown) => { const n = Number(String(v ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n > 0 ? n : null }

export async function POST(req: NextRequest) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 })
    const { storagePath, fileName } = await req.json() as { storagePath?: string; fileName?: string }
    if (!storagePath) return NextResponse.json({ error: 'storagePath required' }, { status: 400 })

    const sb = createSupabaseAdminClient()
    const { data: blob, error: dlErr } = await sb.storage.from('erp-files').download(storagePath)
    if (dlErr || !blob) return NextResponse.json({ error: 'Could not read the uploaded PO file' }, { status: 400 })
    const buf = Buffer.from(await blob.arrayBuffer())
    const ext = (fileName || storagePath).split('.').pop()?.toLowerCase() || ''
    const isImg = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)

    const content: Anthropic.MessageParam['content'] = []
    if (isImg) {
      content.push({ type: 'image', source: { type: 'base64', media_type: (`image/${ext === 'jpg' ? 'jpeg' : ext}`) as 'image/png', data: buf.toString('base64') } })
    } else {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } } as Anthropic.DocumentBlockParam)
    }
    content.push({ type: 'text', text: `You are reading a WALMART PURCHASE ORDER for the vendor beyondGREEN (a maker of compostable disposable cutlery). Extract every field you can. If a field is genuinely not present on the document, return an empty string "" (or null for numbers) — do NOT guess or invent values. Dates must be YYYY-MM-DD. Return ONLY raw JSON in exactly this shape:
{
  "po_number": "the Purchase Order number, else ''",
  "order_date": "PO / order date as YYYY-MM-DD, else ''",
  "ship_due_date": "the Must-Arrive-By Date (MABD) or ship/cancel/delivery date; if a window, use the latest date; YYYY-MM-DD, else ''",
  "carrier": "carrier / SCAC / routing carrier name if shown, else ''",
  "load_number": "load number / routing load / trip ID if shown, else ''",
  "dc_number": "the ship-to Walmart Distribution Center number, else ''",
  "ship_to": "the full ship-to name and address (single line, comma-separated), else ''",
  "commodity_description": "a short commodity description of the goods, else ''",
  "total_srp": number or null (total cases/SRPs ordered across all lines, if a total is printed),
  "total_units": number or null (total eaches/units ordered, if printed),
  "lines": [
    {
      "supplier_item": "vendor/supplier stock or item number for this line, else ''",
      "upc": "UPC for this line (digits only), else ''",
      "gtin": "GTIN for this line (digits only), else ''",
      "walmart_item": "Walmart Item Number (WIN) for this line, else ''",
      "description": "the item description printed on the PO, else ''",
      "qty": number (quantity ordered for this line in CASES / SRP shippers; if only eaches are given, still return the case quantity when derivable, else the number shown),
      "unit_price": number or null (the price Walmart PAYS US per case/SRP for this line — the PO unit cost/price; our selling price),
      "uom": "the order UOM shown (e.g. CA, EA), else ''",
      "units_per_srp": number or null (eaches per case/SRP if derivable)
    }
  ]
}
Read ALL line items. Capture UPC/GTIN carefully (they are the most reliable way to identify the product). Numbers only for numeric fields.` })

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content }],
    })
    const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : '{}'
    const j = firstJson(raw)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawLines: any[] = Array.isArray(j.lines) ? j.lines : []

    // Resolve each PO line to one of our inventory SKUs (by UPC/GTIN, supplier part #, our part #, or SKU).
    const upcs = Array.from(new Set(rawLines.map(l => digits(l.upc)).filter(Boolean)))
    const gtins = Array.from(new Set(rawLines.map(l => digits(l.gtin)).filter(Boolean)))
    const parts = Array.from(new Set(rawLines.map(l => s(l.supplier_item)).filter(Boolean)))
    const codes = Array.from(new Set([...upcs, ...gtins]))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let prods: any[] = []
    const { data: pAll } = await sb.from('products').select('id, sku, product_name, upc_gtin, our_part_number, supplier_part_number, on_hand_qty')
    prods = pAll || []
    const byCode: Record<string, any> = {}
    const byPart: Record<string, any> = {}
    for (const p of prods) {
      const c = digits(p.upc_gtin); if (c) byCode[c] = p
      for (const pn of [p.our_part_number, p.supplier_part_number, p.sku]) { const k = s(pn).toUpperCase(); if (k) byPart[k] = p }
    }
    const matchCode = (code: string) => byCode[code] || byCode[code.replace(/^0+/, '')] || (code.length === 12 ? byCode['0' + code] : null) || (code.length === 13 ? byCode[code.slice(1)] : null)

    const lines = rawLines.map(l => {
      const upc = digits(l.upc), gtin = digits(l.gtin)
      let prod = (upc && matchCode(upc)) || (gtin && matchCode(gtin)) || null
      if (!prod) { const k = s(l.supplier_item).toUpperCase(); if (k && byPart[k]) prod = byPart[k] }
      return {
        sku: prod?.sku || '',
        matched: !!prod,
        product_name: prod?.product_name || s(l.description),
        on_hand: prod ? Number(prod.on_hand_qty || 0) : null,
        qty: num(l.qty),
        upc: upc || gtin || '',
        supplier_item: s(l.supplier_item),
        walmart_item: s(l.walmart_item),
        description: s(l.description),
        unit_price: num(l.unit_price),
      }
    })

    const order = {
      po_number: s(j.po_number),
      order_date: /^\d{4}-\d{2}-\d{2}$/.test(s(j.order_date)) ? s(j.order_date) : '',
      ship_due_date: /^\d{4}-\d{2}-\d{2}$/.test(s(j.ship_due_date)) ? s(j.ship_due_date) : '',
      carrier: s(j.carrier),
      load_number: s(j.load_number),
      dc_number: s(j.dc_number),
      ship_to: s(j.ship_to),
      commodity_description: s(j.commodity_description),
      total_srp: num(j.total_srp),
      total_units: num(j.total_units),
    }

    return NextResponse.json({ order, lines })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
