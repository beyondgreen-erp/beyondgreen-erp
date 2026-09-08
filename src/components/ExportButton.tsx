'use client'
import * as XLSX from 'xlsx'

/* Generic, ERP-wide record export.
   - Auto-derives columns from the row objects (scalars + one level of nested
     scalar fields, e.g. sales_orders.order_number).
   - `variant="bar"` renders the compact button used inside BulkActionBar.
   - Otherwise renders a fixed bottom-right "Export" pill for the whole view. */

type Col = { key: string; label?: string; map?: (row: any) => any }

function humanize(k: string) {
  return k
    .replace(/\./g, ' ')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim()
}

function isScalar(v: any) {
  return v === null || v === undefined || ['string', 'number', 'boolean'].includes(typeof v)
}

// Look at up to 100 rows so we don't miss columns that are null on the first row.
function deriveColumns(rows: any[]): Col[] {
  const seen = new Set<string>()
  const cols: Col[] = []
  for (const r of rows.slice(0, 100)) {
    if (!r || typeof r !== 'object') continue
    for (const k of Object.keys(r)) {
      const v = (r as any)[k]
      if (isScalar(v)) {
        if (!seen.has(k)) { seen.add(k); cols.push({ key: k, label: humanize(k) }) }
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        // flatten one level of scalar children
        for (const ck of Object.keys(v)) {
          const cv = (v as any)[ck]
          if (!isScalar(cv)) continue
          const kk = `${k}.${ck}`
          if (!seen.has(kk)) {
            seen.add(kk)
            cols.push({ key: kk, label: humanize(ck), map: (row: any) => row?.[k]?.[ck] })
          }
        }
      }
      // arrays are skipped
    }
  }
  return cols
}

function cellValue(row: any, c: Col) {
  const v = c.map ? c.map(row) : (row as any)[c.key]
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return v
}

export function exportRowsToXlsx(name: string, rows: any[], columns?: Col[]) {
  const list = Array.isArray(rows) ? rows : []
  const cols = columns && columns.length ? columns : deriveColumns(list)
  const header = cols.map(c => c.label ?? humanize(c.key))
  const body = list.map(r => cols.map(c => cellValue(r, c)))
  const ws = XLSX.utils.aoa_to_sheet([header, ...body])
  const wb = XLSX.utils.book_new()
  const sheet = (name || 'Export').slice(0, 31)
  XLSX.utils.book_append_sheet(wb, ws, sheet)
  const date = new Date().toISOString().slice(0, 10)
  const file = `beyondGREEN_${(name || 'Export').replace(/[^A-Za-z0-9]+/g, '_')}_${date}.xlsx`
  XLSX.writeFile(wb, file)
}

export default function ExportButton({
  rows,
  name,
  columns,
  label,
  variant = 'fixed',
}: {
  rows: any[]
  name: string
  columns?: Col[]
  label?: string
  variant?: 'fixed' | 'bar'
}) {
  const count = Array.isArray(rows) ? rows.length : 0
  const doExport = () => { if (count) exportRowsToXlsx(name, rows, columns) }

  const icon = (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  )

  if (variant === 'bar') {
    return (
      <button
        onClick={doExport}
        disabled={!count}
        className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
        style={{ background: '#F0FDF4', color: '#16A34A', border: '1px solid #BBF7D0' }}
      >
        {icon}
        {label ?? `Export ${count}`}
      </button>
    )
  }

  if (!count) return null
  return (
    <button
      onClick={doExport}
      title={`Export ${count} record${count !== 1 ? 's' : ''} to Excel`}
      className="fixed bottom-6 right-6 z-40 flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl shadow-lg transition-colors"
      style={{ background: '#FFFFFF', color: '#16A34A', border: '1px solid #BBF7D0' }}
    >
      {icon}
      {label ?? 'Export'}
    </button>
  )
}
