export const dynamic = 'force-dynamic'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

function getSb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

const UOM_MAP: Record<string, string> = {
  'Ea':'EA','Ea.':'EA','ea':'EA','Each':'EA','each':'EA',
  'Pcs':'EA','pcs':'EA','PC':'EA','Pc':'EA',
  'Pks':'PKS','Packs':'PKS','packs':'PKS','Pack':'PKS',
  'Lbs':'LBS','Lbs.':'LBS','lbs':'LBS','lb':'LBS',
  'Rolls':'ROLLS','rolls':'ROLLS','Roll':'ROLLS',
  'CS':'CASE','cs':'CASE','Case':'CASE',
  'Meters':'M','meters':'M',
  'Ft':'FT','ft':'FT','Feet':'FT',
  'Oz':'OZ','oz':'OZ',
  'Gal':'GAL','gal':'GAL','Gallon':'GAL',
  'Kg':'KG','kg':'KG',
  'Set':'SET','Sets':'SET',
}

function normalizeUOM(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = String(raw).trim()
  return UOM_MAP[s] ?? (s && s !== 'nan' && s !== 'None' ? s : null)
}

function safeStr(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  if (['nan','NaT','None','undefined','null',''].includes(s)) return null
  return s
}

function safeNum(v: unknown): number | null {
  if (v == null) return null
  const n = parseFloat(String(v).replace(/,/g, ''))
  if (isNaN(n) || n < 0) return null
  return n
}

interface ProductRow {
  sku: string | null
  product_name: string | null
  category: string | null
  unit_of_measure: string | null
  on_hand_qty: number | null
  unit_cost: number | null
  pack_price: number | null
  reorder_point: number | null
  location: string | null
  is_active: boolean
  is_discontinued: boolean
  external_id: string | null
  modification_log: string | null
}

function parseXlsx(buffer: ArrayBuffer): ProductRow[] {
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  // Skip first 3 rows (header=3 in pandas means row index 3 = 4th row)
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][]

  // Find header row: look for row containing 'SKU' or 'sku'
  let headerIdx = 3
  for (let i = 0; i < Math.min(10, raw.length); i++) {
    const row = raw[i] as unknown[]
    if (row && row.some(c => String(c ?? '').toLowerCase().includes('sku'))) {
      headerIdx = i
      break
    }
  }

  const headers = (raw[headerIdx] as unknown[]).map(h => String(h ?? '').trim().toLowerCase())

  // Column mapping by header name
  function col(names: string[]): number {
    for (const n of names) {
      const idx = headers.findIndex(h => h.includes(n))
      if (idx >= 0) return idx
    }
    return -1
  }

  const nameCol = col(['name','product name','description'])
  const skuCol = col(['sku','part','part #','part number'])
  const typeCol = col(['type','category'])
  const stockCol = col(['stock','qty','on hand','quantity'])
  const uomCol = col(['uom','unit of measure','unit'])
  const costCol = col(['cost','unit cost','price'])
  const reorderCol = col(['reorder','min','minimum'])
  const locCol = col(['location','loc','bin'])
  const discCol = col(['discontinued','active','status'])
  const logCol = col(['log','modification','notes'])
  const idCol = col(['id','item id','external'])

  const seen = new Set<string>()
  const rows: ProductRow[] = []

  for (let i = headerIdx + 1; i < raw.length; i++) {
    const row = raw[i] as unknown[]
    if (!row || row.length === 0) continue

    const sku = safeStr(skuCol >= 0 ? row[skuCol] : null)
    const name = safeStr(nameCol >= 0 ? row[nameCol] : null)

    if (!sku || ['sku','nan',''].includes(sku.toLowerCase())) continue
    if (!name || ['name','nan',''].includes(name.toLowerCase())) continue
    if (seen.has(sku)) continue
    seen.add(sku)

    const discRaw = safeStr(discCol >= 0 ? row[discCol] : null)
    const isDisc = discRaw ? discRaw.toLowerCase() === 'yes' || discRaw.toLowerCase() === 'discontinued' : false

    rows.push({
      sku,
      product_name: name,
      category: safeStr(typeCol >= 0 ? row[typeCol] : null),
      unit_of_measure: normalizeUOM(safeStr(uomCol >= 0 ? row[uomCol] : null)),
      on_hand_qty: safeNum(stockCol >= 0 ? row[stockCol] : null),
      unit_cost: safeNum(costCol >= 0 ? row[costCol] : null),
      pack_price: safeNum(costCol >= 0 ? row[costCol] : null),
      reorder_point: safeNum(reorderCol >= 0 ? row[reorderCol] : null),
      location: safeStr(locCol >= 0 ? row[locCol] : null),
      is_active: !isDisc,
      is_discontinued: isDisc,
      external_id: safeStr(idCol >= 0 ? row[idCol] : null),
      modification_log: safeStr(logCol >= 0 ? row[logCol] : null),
    })
  }

  return rows
}

async function upsertBatch(sb: ReturnType<typeof getSb>, rows: ProductRow[]) {
  const payload = rows.map(r => ({
    sku: r.sku!,
    product_name: r.product_name!,
    category: r.category,
    unit_of_measure: r.unit_of_measure,
    on_hand_qty: r.on_hand_qty ?? 0,
    unit_cost: r.unit_cost,
    pack_price: r.pack_price,
    reorder_point: r.reorder_point ?? 0,
    location: r.location,
    is_active: r.is_active,
    is_discontinued: r.is_discontinued,
    external_id: r.external_id,
    modification_log: r.modification_log,
  }))

  const { error } = await sb.from('products').upsert(payload, {
    onConflict: 'sku',
    ignoreDuplicates: false,
  })
  return error
}

// POST: accepts multipart form-data with file OR JSON body with records array
export async function POST(req: Request) {
  try {
    const sb = getSb()
    const contentType = req.headers.get('content-type') ?? ''
    let rows: ProductRow[] = []

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      const file = form.get('file') as File | null
      if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

      const buffer = await file.arrayBuffer()
      const ext = file.name.split('.').pop()?.toLowerCase()

      if (ext === 'xlsx' || ext === 'xls') {
        rows = parseXlsx(buffer)
      } else {
        return NextResponse.json({ error: 'Only .xlsx/.xls files supported' }, { status: 400 })
      }
    } else {
      // JSON body: { records: ProductRow[] }
      const body = await req.json()
      rows = body.records ?? []
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No valid product rows found in file' }, { status: 400 })
    }

    // Upsert in chunks of 50
    const CHUNK = 50
    let inserted = 0
    const errors: string[] = []

    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK)
      const err = await upsertBatch(sb, chunk)
      if (err) {
        errors.push(`Chunk ${Math.floor(i / CHUNK) + 1}: ${err.message}`)
      } else {
        inserted += chunk.length
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      imported: inserted,
      total: rows.length,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// GET: return import status / product count
export async function GET() {
  try {
    const sb = getSb()
    const { count } = await sb.from('products').select('*', { count: 'exact', head: true })
    const { count: dupeCount } = await sb.from('products')
      .select('*', { count: 'exact', head: true })
      .eq('duplicate_flag', true)
      .eq('duplicate_reviewed', false)
    return NextResponse.json({ product_count: count ?? 0, pending_duplicates: dupeCount ?? 0 })
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
