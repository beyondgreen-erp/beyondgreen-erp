'use client'
import { useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

export interface CsvCol {
  header: string
  dbKey: string
  example: string
  required?: boolean
  lookup?: {
    fromTable: string
    matchField: string
    storeAs: string
  }
}

interface Props {
  table: string
  filename: string
  columns: CsvCol[]
  onImportDone: () => void
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const cols: string[] = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++ }
        else inQ = !inQ
      } else if (ch === ',' && !inQ) { cols.push(cur); cur = '' }
      else cur += ch
    }
    cols.push(cur)
    rows.push(cols)
  }
  return rows
}

export default function ImportExportBar({ table, filename, columns, onImportDone }: Props) {
  const sb = createSupabaseBrowserClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(null)
  const [busy, setBusy] = useState(false)

  function downloadTemplate() {
    const headers = columns.map(c => c.header)
    const example = columns.map(c => c.example)
    const csv = [headers, example].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${filename}_template.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setNotice(null)
    setBusy(true)
    try {
      const rows = parseCSV(await file.text())
      if (rows.length < 2) { setNotice({ ok: false, msg: 'File has no data rows.' }); setBusy(false); return }

      const headers = rows[0].map(h => h.trim())
      const dataRows = rows.slice(1)
      const colMap = new Map(columns.map(c => [c.header, c]))

      // Pre-fetch lookup tables and build name→id maps
      const lookupMaps: Record<string, Map<string, string>> = {}
      for (const col of columns) {
        if (!col.lookup || lookupMaps[col.header]) continue
        const { data } = await sb.from(col.lookup.fromTable).select(`id,${col.lookup.matchField}`)
        if (data) {
          const m = new Map<string, string>()
          const mf = col.lookup.matchField
          for (const item of data) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const rec = item as any
            m.set(String(rec[mf] ?? '').toLowerCase(), String(rec['id'] ?? ''))
          }
          lookupMaps[col.header] = m
        }
      }

      const payloads: Record<string, unknown>[] = []
      const skipped: string[] = []

      for (let ri = 0; ri < dataRows.length; ri++) {
        const row = dataRows[ri]
        const payload: Record<string, unknown> = { is_active: true }
        let rowErr = ''

        for (let hi = 0; hi < headers.length; hi++) {
          const col = colMap.get(headers[hi])
          if (!col) continue
          const val = (row[hi] ?? '').trim()

          if (col.lookup) {
            if (!val) { if (col.required) { rowErr = `Row ${ri + 2}: "${col.header}" is required.`; break }; continue }
            const id = lookupMaps[col.header]?.get(val.toLowerCase())
            if (!id) { rowErr = `Row ${ri + 2}: "${val}" not found in ${col.lookup.fromTable}.`; break }
            payload[col.lookup.storeAs] = id
          } else {
            if (!val && col.required) { rowErr = `Row ${ri + 2}: "${col.header}" is required.`; break }
            payload[col.dbKey] = val
          }
        }

        if (rowErr) { skipped.push(rowErr); continue }
        payloads.push(payload)
      }

      if (payloads.length === 0) {
        setNotice({ ok: false, msg: skipped[0] ?? 'No valid rows to import.' })
        setBusy(false); return
      }

      const { error } = await sb.from(table).insert(payloads)
      if (error) { setNotice({ ok: false, msg: error.message }); setBusy(false); return }

      const tail = skipped.length > 0 ? ` (${skipped.length} row${skipped.length > 1 ? 's' : ''} skipped)` : ''
      setNotice({ ok: true, msg: `${payloads.length} record${payloads.length !== 1 ? 's' : ''} imported${tail}.` })
      onImportDone()
    } catch {
      setNotice({ ok: false, msg: 'Failed to parse file. Ensure it is a valid CSV.' })
    }
    setBusy(false)
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <button
          onClick={downloadTemplate}
          title="Download CSV template"
          className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-[#E4E6EE] text-gray-400 hover:text-gray-700 hover:border-gray-500 transition-colors"
        >
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span className="hidden sm:inline">Template</span>
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          title="Import CSV"
          className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-[#E4E6EE] text-gray-400 hover:text-gray-700 hover:border-gray-500 transition-colors disabled:opacity-50"
        >
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l4-4m0 0l4 4m-4-4v12" />
          </svg>
          <span className="hidden sm:inline">{busy ? 'Importing…' : 'Import'}</span>
        </button>
        <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
      </div>
      {notice && (
        <span className={`text-xs px-2.5 py-1.5 rounded-lg border max-w-[220px] truncate ${notice.ok ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}
          title={notice.msg}>
          {notice.msg}
        </span>
      )}
    </div>
  )
}
