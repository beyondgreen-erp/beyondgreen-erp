export const dynamic = 'force-dynamic'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { CANONICAL_UOMS, normalizeUom } from '@/lib/uom'

/**
 * Import the pack/case conversion worklist.
 *
 * Deliberately narrow. The general product importer upserts a whole row and
 * defaults on_hand_qty to 0, which would wipe stock for any SKU whose quantity
 * column happened not to match. This one only ever writes five fields, only
 * where the person actually typed something, and only onto SKUs that already
 * exist — it never creates a product and never touches a quantity.
 *
 * POST with ?commit=1 to write. Without it you get the same report and nothing
 * is changed, so the sheet can always be checked before it lands.
 */

const FIELDS = {
  uom: 'CORRECT UOM',
  pieces_per_pack: 'PIECES PER PACK',
  packs_per_case: 'PACKS PER CASE',
  cases_per_pallet: 'CASES PER PALLET',
  unit_cost: 'UNIT COST',
} as const

function getSb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}

const norm = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().toUpperCase()

function blank(v: unknown): boolean {
  if (v == null) return true
  const s = String(v).trim()
  return s === '' || ['NAN', 'NONE', 'NULL', 'N/A', '-'].includes(s.toUpperCase())
}

function intAtLeastOne(v: unknown): { value?: number; error?: string } {
  const n = Number(String(v).replace(/,/g, ''))
  if (!Number.isFinite(n)) return { error: `"${v}" is not a number` }
  if (n === 0) return { error: 'cannot be 0 — a container that holds nothing makes every conversion return zero; use 1 where there is no inner pack' }
  if (n < 0) return { error: 'cannot be negative' }
  if (!Number.isInteger(n)) return { error: `must be a whole number, got ${n}` }
  return { value: n }
}

/**
 * Is the sheet value already what the product holds?
 *
 * Postgres hands numerics back as strings, and not always in the spelling the
 * sheet uses — a stored "3.0400" against a typed 3.04 is the same cost. Compared
 * as text every such row would show up as a change and rewrite itself, which
 * makes the preview untrustworthy exactly where it needs to be believed.
 */
function same(field: string, from: unknown, to: unknown): boolean {
  if (from == null) return false
  if (field === 'unit_of_measure') return String(from).trim().toUpperCase() === String(to).trim().toUpperCase()
  const a = Number(from), b = Number(to)
  if (Number.isFinite(a) && Number.isFinite(b)) return a === b
  return String(from) === String(to)
}

export interface RowChange {
  row: number
  sku: string
  changes: Record<string, { from: unknown; to: unknown }>
}

export interface Report {
  committed: boolean
  sheet: string
  rows_read: number
  rows_with_entries: number
  will_update: number
  unchanged: number
  unknown_skus: { row: number; sku: string }[]
  rejected: { row: number; sku: string; field: string; reason: string }[]
  by_field: Record<string, number>
  changes: RowChange[]
  errors?: string[]
}

export async function POST(req: Request) {
  try {
    const commit = new URL(req.url).searchParams.get('commit') === '1'
    const form = await req.formData()
    const file = form.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const sheetName = wb.SheetNames.find(n => norm(n) === 'WORKLIST') ?? wb.SheetNames[0]
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null }) as unknown[][]

    // The header row is the one carrying SKU. Above it sits the two-colour banner.
    let headerIdx = -1
    for (let i = 0; i < Math.min(12, grid.length); i++) {
      if ((grid[i] ?? []).some(c => norm(c) === 'SKU')) { headerIdx = i; break }
    }
    if (headerIdx < 0) {
      return NextResponse.json({ error: 'Could not find a header row containing "SKU". Is this the worklist file?' }, { status: 400 })
    }

    const headers = (grid[headerIdx] ?? []).map(norm)

    // Blue and yellow both carry headers like "PIECES PER PACK" — the blue block
    // shows what is stored now, the yellow block is what someone typed. Only the
    // yellow half may be read, so find where it starts from the banner above.
    let fillFrom = 0
    for (let i = 0; i < headerIdx; i++) {
      const j = (grid[i] ?? []).findIndex(c => norm(c).includes('FILL THESE IN'))
      if (j >= 0) { fillFrom = j; break }
    }

    const colOf = (label: string) => {
      const want = norm(label)
      // Prefer a match inside the fill-in block; otherwise take the last match,
      // since the editable columns always sit to the right of the read-only ones.
      for (let j = headers.length - 1; j >= 0; j--) {
        if (headers[j] === want && j >= fillFrom) return j
      }
      return headers.lastIndexOf(want)
    }

    const skuCol = headers.indexOf('SKU')
    const cols = Object.fromEntries(
      Object.entries(FIELDS).map(([k, label]) => [k, colOf(label)]),
    ) as Record<keyof typeof FIELDS, number>

    const missingCols = Object.entries(FIELDS).filter(([k]) => cols[k as keyof typeof FIELDS] < 0).map(([, l]) => l)
    if (missingCols.length === Object.keys(FIELDS).length) {
      return NextResponse.json({ error: `None of the fill-in columns were found (${missingCols.join(', ')}).` }, { status: 400 })
    }

    // ---------------------------------------------------------- read the sheet
    type Entry = { row: number; sku: string; vals: Record<string, number | string> }
    const entries: Entry[] = []
    const rejected: Report['rejected'] = []
    let rowsRead = 0

    for (let i = headerIdx + 1; i < grid.length; i++) {
      const row = grid[i] ?? []
      const sku = String(row[skuCol] ?? '').trim()
      if (!sku || norm(sku) === 'SKU' || norm(sku) === 'EXAMPLE') continue
      rowsRead++

      const vals: Record<string, number | string> = {}
      for (const [key, label] of Object.entries(FIELDS)) {
        const j = cols[key as keyof typeof FIELDS]
        if (j < 0) continue
        const raw = row[j]
        if (blank(raw)) continue

        if (key === 'uom') {
          const u = normalizeUom(String(raw))
          if (!u) continue
          if (!(CANONICAL_UOMS as readonly string[]).includes(u)) {
            rejected.push({ row: i + 1, sku, field: label, reason: `"${raw}" is not a unit the system knows` })
            continue
          }
          vals.unit_of_measure = u
        } else if (key === 'unit_cost') {
          const n = Number(String(raw).replace(/[$,]/g, ''))
          if (!Number.isFinite(n) || n < 0) {
            rejected.push({ row: i + 1, sku, field: label, reason: `"${raw}" is not a valid cost` })
            continue
          }
          vals.unit_cost = n
        } else {
          const { value, error } = intAtLeastOne(raw)
          if (error) { rejected.push({ row: i + 1, sku, field: label, reason: error }); continue }
          vals[key] = value!
        }
      }
      if (Object.keys(vals).length) entries.push({ row: i + 1, sku, vals })
    }

    // ------------------------------------------------------- compare to the ERP
    const sb = getSb()
    const skus = Array.from(new Set(entries.map(e => e.sku)))
    const existing = new Map<string, Record<string, unknown>>()
    for (let i = 0; i < skus.length; i += 200) {
      const { data, error } = await sb
        .from('products')
        .select('sku, unit_of_measure, pieces_per_pack, packs_per_case, cases_per_pallet, unit_cost')
        .in('sku', skus.slice(i, i + 200))
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      for (const p of data ?? []) existing.set(String(p.sku), p as Record<string, unknown>)
    }

    const unknown: Report['unknown_skus'] = []
    const changes: RowChange[] = []
    const byField: Record<string, number> = {}
    let unchanged = 0

    for (const e of entries) {
      const cur = existing.get(e.sku)
      if (!cur) { unknown.push({ row: e.row, sku: e.sku }); continue }
      const diff: RowChange['changes'] = {}
      for (const [field, to] of Object.entries(e.vals)) {
        const from = cur[field]
        if (same(field, from, to)) continue
        diff[field] = { from: from ?? null, to }
        byField[field] = (byField[field] ?? 0) + 1
      }
      if (Object.keys(diff).length) changes.push({ row: e.row, sku: e.sku, changes: diff })
      else unchanged++
    }

    // ------------------------------------------------------------------ write
    const errors: string[] = []
    if (commit) {
      for (const c of changes) {
        const patch = Object.fromEntries(Object.entries(c.changes).map(([f, v]) => [f, v.to]))
        const { error } = await sb.from('products').update(patch).eq('sku', c.sku)
        if (error) errors.push(`${c.sku}: ${error.message}`)
      }
    }

    const report: Report = {
      committed: commit && errors.length === 0,
      sheet: sheetName,
      rows_read: rowsRead,
      rows_with_entries: entries.length,
      will_update: changes.length,
      unchanged,
      unknown_skus: unknown,
      rejected,
      by_field: byField,
      changes: changes.slice(0, 500),
      errors: errors.length ? errors : undefined,
    }
    return NextResponse.json(report)
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
