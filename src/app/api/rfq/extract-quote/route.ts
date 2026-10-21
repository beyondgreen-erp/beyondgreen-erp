/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import * as XLSX from 'xlsx'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { createSupabaseServerClient } from '@/lib/supabase'
import { aiErrorMessage } from '@/lib/aiError'

/**
 * Reads a supplier's quote out of everything attached to it — the email thread
 * (saved as a .txt/.eml copy) plus the PDFs, spreadsheets and photos they sent —
 * and returns the terms and per-line prices for the quote form to fill in.
 * Nothing is saved here; the person reviews the result and presses Save.
 */
export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const NL = String.fromCharCode(10)
const MAX_FILES = 10
const MAX_BYTES = 15 * 1024 * 1024

function firstJson(text: string): any {
  const a = text.indexOf('{'); const b = text.lastIndexOf('}')
  if (a === -1 || b === -1 || b < a) return {}
  try { return JSON.parse(text.slice(a, b + 1)) } catch { return {} }
}

// Outlook .msg files are binary; pull out the readable runs so the body still gets read.
function msgText(buf: Buffer): string {
  const utf16 = buf.toString('utf16le').replace(/[^\x09\x0A\x0D\x20-\x7E -ɏ一-鿿]+/g, ' ')
  const ascii = buf.toString('latin1').replace(/[^\x09\x0A\x0D\x20-\x7E]+/g, ' ')
  const keep = (s: string) => s.split(/\s{3,}/).filter(x => x.trim().length > 3).join(NL)
  return (keep(utf16) + NL + keep(ascii)).slice(0, 60000)
}

// Strip MIME noise from .eml so the model sees the conversation, not base64.
function emlText(raw: string): string {
  return raw
    .replace(/^Content-Transfer-Encoding: base64[\s\S]*?(?=\n--)/gim, '[attachment omitted]')
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/<[^>]+>/g, ' ')
    .slice(0, 60000)
}

export async function POST(req: NextRequest) {
  try {
    const s = await createSupabaseServerClient()
    const { data: { user } } = await s.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })

    const { responseId, quotationId, vendorName } = await req.json() as { responseId?: string; quotationId?: string; vendorName?: string }
    if (!responseId || !quotationId) return NextResponse.json({ error: 'responseId and quotationId required' }, { status: 400 })

    const sb = createSupabaseAdminClient()
    const [{ data: atts }, { data: lines }] = await Promise.all([
      sb.from('file_attachments').select('id, file_name, file_type, file_size, storage_path, created_at')
        .eq('record_type', 'rfq_response').eq('record_id', responseId).order('created_at', { ascending: true }),
      sb.from('quotation_lines').select('id, sku, product_name, description, quantity')
        .eq('quotation_id', quotationId).order('line_number', { ascending: true, nullsFirst: false }),
    ])
    const files = ((atts || []) as any[]).slice(-MAX_FILES)
    if (!files.length) return NextResponse.json({ error: 'Attach the email or at least one file first.' }, { status: 400 })

    const content: any[] = []
    const read: string[] = []
    const skipped: string[] = []
    for (const f of files) {
      if (Number(f.file_size) > MAX_BYTES) { skipped.push(`${f.file_name} (too large)`); continue }
      const { data: blob } = await sb.storage.from('erp-files').download(f.storage_path)
      if (!blob) { skipped.push(f.file_name); continue }
      const buf = Buffer.from(await blob.arrayBuffer())
      const ext = String(f.file_name).split('.').pop()?.toLowerCase() || ''
      const head = `=== FILE: ${f.file_name} ===`
      if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
        content.push({ type: 'text', text: head })
        content.push({ type: 'image', source: { type: 'base64', media_type: `image/${ext === 'jpg' ? 'jpeg' : ext}`, data: buf.toString('base64') } })
      } else if (ext === 'pdf') {
        content.push({ type: 'text', text: head })
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } })
      } else if (['xlsx', 'xls', 'csv', 'tsv', 'xlsm'].includes(ext)) {
        let t = ''
        try {
          const wb = XLSX.read(buf, { type: 'buffer' })
          t = wb.SheetNames.map(n => `--- Sheet: ${n} ---${NL}${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join(NL + NL)
        } catch { t = buf.toString('utf8') }
        content.push({ type: 'text', text: `${head}${NL}${t.slice(0, 80000)}` })
      } else if (ext === 'msg') {
        content.push({ type: 'text', text: `${head} (Outlook message, readable text extracted)${NL}${msgText(buf)}` })
      } else if (ext === 'eml') {
        content.push({ type: 'text', text: `${head}${NL}${emlText(buf.toString('utf8'))}` })
      } else if (['txt', 'html', 'htm', 'md'].includes(ext)) {
        const t = buf.toString('utf8')
        content.push({ type: 'text', text: `${head}${NL}${(ext.startsWith('htm') ? t.replace(/<[^>]+>/g, ' ') : t).slice(0, 60000)}` })
      } else { skipped.push(`${f.file_name} (file type not readable)`); continue }
      read.push(f.file_name)
    }
    if (!read.length) return NextResponse.json({ error: 'None of the attached files could be read. Use PDF, Excel/CSV, images, .eml, .msg or pasted email text.', skipped }, { status: 400 })

    const lineList = ((lines || []) as any[]).map(l =>
      `- id=${l.id} | sku=${l.sku || ''} | item=${l.product_name || l.description || ''} | qty=${l.quantity ?? ''}`).join(NL)

    content.push({ type: 'text', text: [
      `These are the email thread and attachments from supplier "${vendorName || 'the supplier'}" replying to our RFQ (request for quote).`,
      'Our RFQ line items:',
      lineList || '(none)',
      '',
      'Extract their quote. Return ONLY a JSON object with these keys (use null when not stated; never invent numbers):',
      '{ "contact_name", "contact_email", "currency" (ISO code), "incoterm", "payment_terms", "lead_time_days" (number, convert weeks to days),',
      '  "moq_note", "validity_days" (number), "plate_die_charges", "overrun_tolerance", "certifications", "sample_available" (true/false/null),',
      '  "exclusions", "notes" (short bullet summary of anything else important: tiers, conditions, open questions, latest reply in the thread),',
      '  "lines": [ { "quotation_line_id" (one of the ids above, matched by sku/description/size), "unit_price" (number per piece), "pcs_per_case" (number), "case_price" (number), "notes" } ],',
      '  "unmatched": [ "price lines they quoted that do not match any of our items, as short text" ] }',
      'If they quote several quantity tiers, use the tier matching our quantity and put the others in that line\'s notes.',
      'If prices are per 1,000 pcs, convert unit_price to per piece and say so in notes. If the thread has revised prices, use the latest.',
    ].join(NL) })

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content }],
    })
    const text = msg.content.map((b: any) => (b.type === 'text' ? b.text : '')).join('')
    const data = firstJson(text)
    const valid = new Set(((lines || []) as any[]).map(l => l.id))
    data.lines = (Array.isArray(data.lines) ? data.lines : []).filter((l: any) => l && valid.has(l.quotation_line_id))
    return NextResponse.json({ ok: true, data, read, skipped })
  } catch (e) {
    return NextResponse.json({ error: aiErrorMessage(e, 'Could not read the supplier email/files.') }, { status: 500 })
  }
}
