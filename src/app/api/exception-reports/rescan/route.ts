import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import * as XLSX from 'xlsx'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

/* One-time admin cleanup: re-reads each already-uploaded exception report and,
   using the printed Vendor Name column, removes the AI-uploaded rows that are
   NOT beyondGREEN. Processes ONE source file per call (pass ?i=<index>).
   Guard with ?key=<secret>. Dry-run unless &commit=true. */

export const maxDuration = 60
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const RESCAN_KEY = 'bg-rescan-2026'
const isBeyondGreen = (v?: string | null) => !!v && /beyond\s*green|byndgrn/i.test(v)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function firstJson(text: string): any {
  const a = text.indexOf('{'); const b = text.lastIndexOf('}')
  if (a === -1 || b === -1 || b < a) return {}
  try { return JSON.parse(text.slice(a, b + 1)) } catch { return {} }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  if (url.searchParams.get('key') !== RESCAN_KEY) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const commit = url.searchParams.get('commit') === 'true'
  const i = Number(url.searchParams.get('i') ?? '0')

  const sb = createSupabaseAdminClient()
  const { data: fileRows } = await sb.from('exception_reports')
    .select('exception_report_file').eq('source', 'ai_upload').not('exception_report_file', 'is', null)
  const files = [...new Set(((fileRows as { exception_report_file: string }[]) || []).map(f => f.exception_report_file))]
  if (i >= files.length) return NextResponse.json({ done: true, totalFiles: files.length, message: 'no file at index ' + i })
  const path = files[i]

  const { data: blob, error: dlErr } = await sb.storage.from('erp-files').download(path)
  if (dlErr || !blob) return NextResponse.json({ error: 'download failed for ' + path }, { status: 400 })
  const buf = Buffer.from(await blob.arrayBuffer())
  const ext = path.split('.').pop()?.toLowerCase() || ''
  const isImg = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)
  const isSheet = ['xlsx', 'xls', 'csv', 'tsv'].includes(ext)

  const content: Anthropic.MessageParam['content'] = []
  if (isImg) {
    content.push({ type: 'image', source: { type: 'base64', media_type: (`image/${ext === 'jpg' ? 'jpeg' : ext}`) as 'image/png', data: buf.toString('base64') } })
  } else if (isSheet) {
    let sheetText = ''
    try {
      const wb = XLSX.read(buf, { type: 'buffer' })
      sheetText = wb.SheetNames.map((n) => '--- Sheet: ' + n + ' ---\n' + XLSX.utils.sheet_to_csv(wb.Sheets[n])).join('\n\n')
    } catch { sheetText = buf.toString('utf8') }
    content.push({ type: 'text', text: 'Exception report spreadsheet (CSV):\n\n' + sheetText })
  } else {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } } as Anthropic.DocumentBlockParam)
  }
  content.push({ type: 'text', text: `This is a Walmart OS&D / delivery EXCEPTION report. It may be multiple pages, sometimes scanned sideways (rotate mentally). Each line-item row has: PO #, Bill Of Lading #, Vendor Name, PO Type, Total Cases Received, PO Freight Bill Qty, Over, Short, Damage. Return ONLY raw JSON: {"line_items":[{"po_number":"...","vendor_name":"the Vendor Name printed for this row, exactly"}]}. Include EVERY row across ALL pages, one object per PO row, and always include the printed Vendor Name.` })

  const msg = await anthropic.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 8192, messages: [{ role: 'user', content }] })
  const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : '{}'
  const j = firstJson(raw)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lines: any[] = Array.isArray(j.line_items) ? j.line_items : []
  const bgByPo = new Map<string, string>()
  for (const li of lines) {
    if (li?.po_number && isBeyondGreen(li.vendor_name)) bgByPo.set(String(li.po_number), String(li.vendor_name))
  }

  const { data: dbRows } = await sb.from('exception_reports')
    .select('id, po_number, vendor_name').eq('source', 'ai_upload').eq('exception_report_file', path)
  const rows = (dbRows as { id: string; po_number: string | null; vendor_name: string | null }[]) || []
  const toRemove = rows.filter(r => !bgByPo.has(String(r.po_number)))
  const toKeep = rows.filter(r => bgByPo.has(String(r.po_number)))

  if (commit) {
    if (toRemove.length) await sb.from('exception_reports').delete().in('id', toRemove.map(r => r.id))
    for (const r of toKeep) {
      const v = bgByPo.get(String(r.po_number))
      if (v && r.vendor_name !== v) await sb.from('exception_reports').update({ vendor_name: v }).eq('id', r.id)
    }
  }

  return NextResponse.json({
    mode: commit ? 'COMMIT' : 'DRY-RUN',
    fileIndex: i, totalFiles: files.length, file: path,
    linesReadFromFile: lines.length,
    beyondGreenPOsOnFile: [...bgByPo.keys()],
    dbRowsForFile: rows.length,
    kept: toKeep.length,
    removed: toRemove.length,
    removedPOs: toRemove.map(r => r.po_number),
    next: i + 1 < files.length ? `?key=${RESCAN_KEY}&i=${i + 1}${commit ? '&commit=true' : ''}` : 'DONE',
  })
}
