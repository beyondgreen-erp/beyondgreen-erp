import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import * as XLSX from 'xlsx'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface LineItem {
  po_number?: string
  vendor_name?: string
  po_freight_bill_qty?: number
  over_qty?: number
  short_qty?: number
  damaged_qty?: number
  comment?: string
}

// beyondGREEN goes by "BEYONDGREEN BIOTECH, INC. DBA" on Walmart reports.
const isBeyondGreen = (v?: string | null) => !!v && /beyond\s*green|byndgrn/i.test(v)

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
    const isSheet = ['xlsx', 'xls', 'csv', 'tsv'].includes(ext)

    const content: Anthropic.MessageParam['content'] = []
    if (isImg) {
      content.push({ type: 'image', source: { type: 'base64', media_type: (`image/${ext === 'jpg' ? 'jpeg' : ext}`) as 'image/png', data: buf.toString('base64') } })
    } else if (isSheet) {
      let sheetText = ''
      try {
        const wb = XLSX.read(buf, { type: 'buffer' })
        sheetText = wb.SheetNames.map((n) => '--- Sheet: ' + n + ' ---' + String.fromCharCode(10) + XLSX.utils.sheet_to_csv(wb.Sheets[n])).join(String.fromCharCode(10) + String.fromCharCode(10))
      } catch { sheetText = buf.toString('utf8') }
      content.push({ type: 'text', text: 'Exception report spreadsheet contents (converted to CSV):' + String.fromCharCode(10) + String.fromCharCode(10) + sheetText })
    } else {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } } as Anthropic.DocumentBlockParam)
    }

    content.push({ type: 'text', text: `You are the exception-report intelligence engine for beyondGREEN (vendor "BEYONDGREEN BIOTECH, INC. DBA"). This is a Walmart OS&D / Delivery Confirmation EXCEPTION report for vendor beyondGREEN. IMPORTANT ABOUT THE FORMAT: the file may be MULTIPLE PAGES - a cover sheet plus one or more line-item tables that are often scanned SIDEWAYS / rotated 90 degrees (landscape); read EVERY page and mentally rotate any sideways page upright before reading it. The Over, Short, and Damage quantities are frequently HANDWRITTEN (circled or scrawled by hand) on top of the printed grid - read that handwriting carefully; treat a blank/empty cell as 0. Columns you will see per row: PO #, Bill Of Lading #, Vendor Name, PO Type, Total Cases Received, PO Freight Bill Qty, Over, Short, Damage. Extract ALL line-item rows from the report and return ONLY raw JSON in exactly this shape:
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
      "vendor_name": "the Vendor Name printed for THIS row, exactly as written (e.g. 'BEYONDGREEN BIOTECH, INC. DBA'), else ''",
      "po_freight_bill_qty": number (the PO Freight Bill Qty),
      "over_qty": number (Over quantity, 0 if none),
      "short_qty": number (Short quantity, 0 if none),
      "damaged_qty": number (Damage quantity, 0 if none),
      "comment": "any note for this line, else ''"
    }
  ]
}
Include EVERY PO line shown across ALL pages of the report's line-item table (one object per PO row) and ALWAYS capture the printed Vendor Name for each row — do not skip any row (the system filters by vendor afterward). Use 0 for blank quantities. Numbers only for quantity fields. The over_qty / short_qty / damaged_qty values are the handwritten numbers in the Over / Short / Damage columns.` })

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{ role: 'user', content }],
    })
    const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : '{}'
    const j = firstJson(raw)

    const lines: LineItem[] = Array.isArray(j.line_items) ? j.line_items : []
    if (lines.length === 0) return NextResponse.json({ error: 'No PO line items could be read from the report.' }, { status: 422 })

    const report_date = typeof j.report_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(j.report_date) ? j.report_date : null
    const carrier = j.carrier_name === 'JB HUNT TRANSPORT  (HJBT)' ? j.carrier_name : (j.carrier_name ? 'Walmart Fleet' : null)

    // Only keep beyondGREEN's own PO lines — the Walmart report lists many vendors per delivery.
    const bgLines = lines.filter(li => li && (li.po_number || li.po_freight_bill_qty) && isBeyondGreen(li.vendor_name))
    const skippedOther = lines.filter(li => li && (li.po_number || li.po_freight_bill_qty) && !isBeyondGreen(li.vendor_name)).length
    if (bgLines.length === 0) {
      return NextResponse.json({ error: `No beyondGREEN PO lines found on this report (skipped ${skippedOther} line(s) for other vendors). Make sure this is a beyondGREEN exception report.` }, { status: 422 })
    }

    const rows = bgLines.map(li => {
      const over_qty = num(li.over_qty), short_qty = num(li.short_qty), damaged_qty = num(li.damaged_qty)
      return {
        po_number: li.po_number ? String(li.po_number) : null,
        vendor_name: li.vendor_name ? String(li.vendor_name) : null,
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

    const exLines = rows.filter((r: any) => r.short_qty > 0 || r.over_qty > 0 || r.damaged_qty > 0)
    const NL = String.fromCharCode(10)
    const fmtLine = (r: any) => 'PO ' + (r.po_number || '-') + ': ' + [r.short_qty > 0 ? ('SHORT ' + r.short_qty) : '', r.over_qty > 0 ? ('OVER ' + r.over_qty) : '', r.damaged_qty > 0 ? ('DAMAGED ' + r.damaged_qty) : ''].filter(Boolean).join(', ')
    const record = [
      'EXCEPTION REPORT - Delivery ' + (j.delivery_no || '-'),
      'Date: ' + (report_date || '-') + '  |  CenterPoint: ' + (j.centerpoint || '-') + '  |  Carrier: ' + (carrier || '-') + '  |  Trailer: ' + (j.trailer_number || '-'),
      'File: ' + (fileName || ''),
      'Uploaded by ' + (uploadedBy || 'unknown') + ' on ' + new Date().toISOString().slice(0, 10),
      'Total PO lines: ' + rows.length + '  |  Lines with exceptions: ' + exLines.length,
      '',
      'EXCEPTIONS:',
      exLines.length ? exLines.map(fmtLine).join(NL) : '(none)',
    ].join(NL)
    return NextResponse.json({ inserted: inserted?.length ?? rows.length, skipped_other_vendors: skippedOther, delivery_no: j.delivery_no || '', report_date, record })
  } catch (err) {
    console.error('exception-reports/extract error:', err)
    return NextResponse.json({ error: (err as Error).message || 'Extraction failed' }, { status: 500 })
  }
}
