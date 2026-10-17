'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const sb = createSupabaseBrowserClient()

type Change = { from: any; to: any }
type Entry = {
  id: string
  created_at: string
  actor_email: string | null
  action: string
  record_label: string | null
  changes: Record<string, Change> | null
}

/**
 * The boards name records the way the comments box does ("sales_order"), while the log
 * stores the real table ("sales_orders"). This maps one to the other. A record type that
 * is missing here has no activity trigger behind it, and the panel renders nothing at all
 * rather than an empty box that would imply nothing has ever happened to the record.
 */
const RECORD_TABLES: Record<string, string> = {
  sales_order: 'sales_orders',
  purchase_order: 'purchase_orders',
  purchasing_request: 'purchase_orders',
  product: 'products',
  task: 'tasks',
  maintenance_request: 'maintenance_requests',
  customer: 'customers',
  shipment: 'shipments',
  sample_submission: 'sample_submissions',
  work_order: 'work_orders',
  qc_inspection: 'qc_inspections',
  fba_shipment: 'fba_shipments',
  pl_stock_order: 'private_label_stock',
  chewy_order: 'chewy_board_orders',
}

/** Fields nobody needs to read in a history line, even when they did change. */
const HIDE = new Set(['id', 'created_at', 'updated_at', 'board_position', 'monday_item_id'])

/** The handful of names that do not read well when they are just un-underscored. */
const LABELS: Record<string, string> = {
  sku: 'SKU', upc_gtin: 'UPC', uom: 'UOM', unit_of_measure: 'Unit of Measure',
  po_number: 'PO #', so_number: 'SO #', wo_number: 'WO #',
  total: 'Total', total_amount: 'Total', qty: 'Qty', on_hand_qty: 'On Hand',
  case_qty: 'Case Qty', packs_per_case: 'Packs per Case', pieces_per_pack: 'Pieces per Pack',
  pallet_ti_hi: 'Ti x Hi', is_active: 'Active', is_discontinued: 'Discontinued',
  group_name: 'Group', ship_due_date: 'Ship Due', required_ship_date: 'Required Ship Date',
}

function fieldLabel(k: string): string {
  if (LABELS[k]) return LABELS[k]
  return k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function showValue(v: any): string {
  if (v === null || v === undefined || v === '') return 'empty'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 120)
  const s = String(v)
  // An ISO timestamp in a history line is noise; a date is not.
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(T|$)/)
  if (m) {
    const d = new Date(s)
    if (!isNaN(d.getTime())) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  return s.length > 120 ? s.slice(0, 120) + '...' : s
}

function who(email: string | null): string {
  if (!email) return 'Someone'
  const name = email.split('@')[0].replace(/[._-]+/g, ' ')
  return name.replace(/\b\w/g, c => c.toUpperCase())
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  if (s < 2592000) return Math.floor(s / 86400) + 'd ago'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * The history of one record, the same on every board.
 *
 * Collapsed and unloaded until someone opens it, so putting it on a board costs
 * nothing until it is wanted. Entries written before Oct 14, 2026 carry no detail,
 * because the log recorded only that a row had been touched; those read as "updated
 * this record" and that is all anyone can honestly say about them.
 */
export default function ItemHistory({
  table, recordType, recordId, title = 'History', limit = 100, defaultOpen = false,
}: { table?: string; recordType?: string; recordId: string | null | undefined; title?: string; limit?: number; defaultOpen?: boolean }) {
  const tbl = table || (recordType ? RECORD_TABLES[recordType] : undefined)
  const [open, setOpen] = useState(defaultOpen)
  const [rows, setRows] = useState<Entry[] | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!recordId || !tbl) return
    setLoading(true); setErr('')
    const { data, error } = await sb.from('activity_log')
      .select('id,created_at,actor_email,action,record_label,changes')
      .eq('table_name', tbl).eq('record_id', recordId)
      .order('created_at', { ascending: false }).limit(limit)
    if (error) setErr(error.message)
    setRows((data as Entry[]) || [])
    setLoading(false)
  }, [tbl, recordId, limit])

  useEffect(() => { if (open && rows === null) load() }, [open, rows, load])
  useEffect(() => { setRows(null) }, [tbl, recordId])

  if (!recordId || !tbl) return null

  return (
    <div className="border border-[#E6E9EF] rounded-lg bg-white">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          {title}{rows ? ` (${rows.length})` : ''}
        </span>
        <span className="text-gray-400 text-xs">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="px-4 pb-3 border-t border-[#F0F2F6]">
          {loading && <p className="text-xs text-gray-400 py-3">Loading…</p>}
          {err && <p className="text-xs text-red-600 py-3">Could not load the history: {err}</p>}
          {!loading && !err && rows && rows.length === 0 && (
            <p className="text-xs text-gray-400 py-3">
              Nothing recorded yet. Changes made from here on will show up.
            </p>
          )}
          <ol className="divide-y divide-[#F0F2F6]">
            {(rows || []).map(e => {
              const fields = Object.entries(e.changes || {}).filter(([k]) => !HIDE.has(k))
              return (
                <li key={e.id} className="py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-xs font-semibold text-gray-700">{who(e.actor_email)}</span>
                    <span className="text-[11px] text-gray-400 whitespace-nowrap"
                      title={new Date(e.created_at).toLocaleString('en-US')}>{ago(e.created_at)}</span>
                  </div>
                  {e.action === 'insert' && (
                    <p className="text-xs text-gray-500 mt-0.5">Created this record</p>
                  )}
                  {e.action !== 'insert' && fields.length === 0 && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      Updated this record. No detail was kept for changes made before Oct 14, 2026.
                    </p>
                  )}
                  {fields.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {fields.map(([k, c]) => (
                        <li key={k} className="text-xs text-gray-600">
                          <span className="text-gray-500">{fieldLabel(k)}:</span>{' '}
                          <span className="text-gray-400 line-through">{showValue(c?.from)}</span>
                          <span className="text-gray-400"> → </span>
                          <span className="font-semibold text-gray-800">{showValue(c?.to)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </div>
  )
}
