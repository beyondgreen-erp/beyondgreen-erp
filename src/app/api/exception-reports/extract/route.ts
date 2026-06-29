import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface LineItem {
  po_number?: string
  po_freight_bill_qty?: number
  over_qty?: number
  short_qty?: number
  damaged_qty?: number
  comment?: string
}

function firstJson(text: string): any {
  const a = text.indexOf('{'); const b = text.lastIndexOf('}')
  if (a === -1 || b === -1 || b < a) return {}
  try { return JSON.parse(text.slice(a, b + 1)) } catch { return {} }
}
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

export async function POST(req: NextRequest) {
  try {
    const { storagePath, fileName, uploadedBy } = await req.json() as
      { storagePath?: string; fileName?: string; uploadedBy?: string }
    if (!storagePath) return NextResponse.json({ error: 'storagePath required' }, { status: 400 })

    const sb = createSupabaseAdminClient()
    const { data: blob, error: dlErr } = await sb.storage.from('erp-files').download(storagePath)
    if (dlErr || !blob) return NextResponse.json({ error: 'Could not read the uploaded file' }, { status: 400 })

    const buf = Buffer.from(await blob.arrayBuffer())
    const ext = (fileName || storagePath).split('.').pop()?.toLowerCase() || ''
    const isImg = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)

    const content: Anthropic.MessageParam['content'] = []
    if (isImg) {
      content.push({ type: 'image', source: { type: 'base64', media_type: (`image/${ext === 'jpg' ? 'jpeg' : ext}`) as 'image/png', data: buf.toString('base64') } })
    } else {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } } as Anthropic.DocumentBlockParam)
    }

    content.push({ type: 'text', text: `You are the exception-report intelligence engine for beyondGREEN (vendor "BEYONDGREEN BIOTECH, INC. DBA"). This is a Walmart OS&D / Delivery Confirmation EXCEPTION report. Extract the data that pertains to beyondGREEN and return ONLY raw JSON in exactly this shape:
{
  "delivery_no": "the Delivery Number (e.g. 43953537), else ''",
  "report_date": "the report/received date as YYYY-MM-DD, else ''",
  "centerpoint": "the CenterPoint / DC number (e.g. 6909), else ''",
  "carrier_name": "one of 'Walmart Fleet' or 'JB HUNT TRANSPORT  (HJBT)' (WM/Walmart = 'Walmart Fleet'), else ''",
  "trailer_number": "the Trailer Number, else ''",
  "new_seal": "the New Seal # if present, else ''",
  "comment": "any overall comments/notes on the report, else ''",
  "line_items": [
    {
      "po_number": "the PO # for this line",
      "po_freight_bill_qty": number (the PO Freight Bill Qty),
      "over_qty": number (Over quantity, 0 if none),
      "short_qty": number (Short quantity, 0 if none),
      "damaged_qty": number (Damage quantity, 0 if none),
      "comment": "any note for this line, else ''"
    }
  ]
}
Include EVERY PO line shown in the report's line-item table (one object per PO). Use 0 for blank quantities. Numbers only for quantity fields.` })

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content }],
    })
    const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : '{}'
    const j = firstJson(raw)

    const lines: LineItem[] = Array.isArray(j.line_items) ? j.line_items : []
    if (lines.length === 0) return NextResponse.json({ error: 'No PO line items could be read from the report.' }, { status: 422 })

    const report_date = typeof j.report_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(j.report_date) ? j.report_date : null
    const carrier = j.carrier_name === 'JB HUNT TRANSPORT  (HJBT)' ? j.carrier_name : (j.carrier_name ? 'Walmart Fleet' : null)

    const rows = lines.filter(li => li && (li.po_number || li.po_freight_bill_qty)).map(li => {
      const over_qty = num(li.over_qty), short_qty = num(li.short_qty), damaged_qty = num(li.damaged_qty)
      return {
        po_number: li.po_number ? String(li.po_number) : null,
        report_date,
        centerpoint: j.centerpoint ? String(j.centerpoint) : null,
        delivery_no: j.delivery_no ? String(j.delivery_no) : null,
        carrier_name: carrier,
        over: over_qty > 0, short: short_qty > 0, damaged: damaged_qty > 0,
        comment_in_report: (li.comment || j.comment || '') || null,
        po_freight_bill_qty: num(li.po_freight_bill_qty),
        over_qty, short_qty, damaged_qty,
        trailer_number: j.trailer_number ? String(j.trailer_number) : null,
        new_seal: j.new_seal ? String(j.new_seal) : null,
        exception_report_file: storagePath,
        source: 'ai_upload',
        created_by: uploadedBy || null,
      }
    })

    const { data: inserted, error: insErr } = await sb.from('exception_reports').insert(rows).select('id')
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

    return NextResponse.json({ inserted: inserted?.length ?? rows.length, delivery_no: j.delivery_no || '', report_date })
  } catch (err) {
    console.error('exception-reports/extract error:', err)
    return NextResponse.json({ error: (err as Error).message || 'Extraction failed' }, { status: 500 })
  }
}
