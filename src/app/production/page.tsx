'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { approveWorkOrder, completeWorkOrder } from '@/lib/orderFlow'
import UndoToast from '@/components/UndoToast'

interface WO {
  id: string
  wo_number: number | null
  sales_order_id: string | null
  product_id: string | null
  machine_id: string | null
  qty_ordered: number
  qty_produced: number
  start_date: string | null
  due_date: string | null
  status: string
  notes: string | null
  created_at: string
}

interface SalesOrder { id: string; order_number: string; status: string }

const TABS = ['All', 'Queued', 'In Progress', 'QC', 'Complete', 'On Hold']

const STATUS_STYLE: Record<string, { bg: string; text: string; border: string }> = {
  Queued:        { bg: '#F3F4F6',      text: '#6B7280', border: '#E4E6EE' },
  'In Progress': { bg: '#EFF6FF',      text: '#2563EB', border: '#BFDBFE' },
  QC:            { bg: '#F5F3FF',      text: '#7C3AED', border: '#DDD6FE' },
  Complete:      { bg: '#ECFDF5',      text: '#059669', border: '#A7F3D0' },
  'On Hold':     { bg: '#FFFBEB',      text: '#D97706', border: '#FDE68A' },
  Cancelled:     { bg: '#FEF2F2',      text: '#DC2626', border: '#FECACA' },
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? { bg: '#F3F4F6', text: '#6B7280', border: '#E4E6EE' }
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border"
      style={{ background: s.bg, color: s.text, borderColor: s.border }}>
      {status}
    </span>
  )
}

function daysSince(dateStr: string) {
  const ms = Date.now() - new Date(dateStr).getTime()
  return Math.floor(ms / 86400000)
}

function parseMeta(notes: string | null) {
  if (!notes) return { productName: '', soId: '', isAuto: false }
  const parts = notes.split('|')
  const isAuto = parts[0] === 'AUTO'
  const productName = isAuto ? parts[1] : ''
  const soRef = parts.find(p => p.startsWith('SOREF:'))
  const soId = soRef ? soRef.slice(6) : ''
  return { productName, soId, isAuto }
}

function parseSku(notes: string | null) {
  if (!notes) return null
  const m = notes.match(/Need \d+ of ([^\s]+) for/)
  return m?.[1] ?? null
}

// ─── Approval Modal ───────────────────────────────────────────────────────────
function ApproveModal({ wo, userEmail, onClose, onDone }: {
  wo: WO; userEmail: string; onClose: () => void; onDone: () => void
}) {
  const [machine, setMachine] = useState('')
  const [scheduledDate, setScheduledDate] = useState('')
  const [operator, setOperator] = useState(userEmail)
  const [priority, setPriority] = useState('Normal')
  const [saving, setSaving] = useState(false)
  const { productName, soId } = parseMeta(wo.notes)
  const sku = parseSku(wo.notes)

  async function approve() {
    setSaving(true)
    await approveWorkOrder(wo.id, userEmail || 'system', machine, scheduledDate, operator, priority)
    onDone()
  }

  const inp = 'w-full border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-[#1A1D2E]'
  const sel = inp + ' bg-white'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="px-6 py-5 border-b flex items-center justify-between" style={{ borderColor: '#E4E6EE' }}>
          <div>
            <h2 className="font-semibold text-base text-[#1A1D2E]">Approve Work Order</h2>
            <p className="text-sm text-gray-400 mt-0.5">
              {sku && <span className="font-mono text-blue-500 mr-2">{sku}</span>}
              {productName || `WO-${wo.wo_number ?? wo.id.slice(0, 6)}`}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100">
            <i className="ti ti-x text-sm text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1.5">Qty Required</label>
              <p className="text-2xl font-bold text-[#1A1D2E]">{wo.qty_ordered.toLocaleString()}</p>
            </div>
            {soId && (
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1.5">Sales Order</label>
                <Link href="/sales/orders" className="text-sm font-medium text-blue-500 hover:text-blue-400">
                  View Order →
                </Link>
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1.5">Machine / Line</label>
            <input value={machine} onChange={e => setMachine(e.target.value)}
              placeholder="e.g. Line 3, Machine A" className={inp} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1.5">Scheduled Date</label>
              <input type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} className={inp} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1.5">Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value)} className={sel}>
                {['Normal', 'High', 'Urgent'].map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1.5">Operator</label>
            <input value={operator} onChange={e => setOperator(e.target.value)}
              placeholder="Assigned operator" className={inp} />
          </div>
        </div>

        <div className="px-6 py-4 border-t flex gap-3 justify-end" style={{ borderColor: '#E4E6EE', background: '#F9FAFB' }}>
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm border text-gray-500 hover:bg-gray-100 transition-colors"
            style={{ borderColor: '#E4E6EE' }}>
            Cancel
          </button>
          <button onClick={approve} disabled={saving}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 transition-colors"
            style={{ background: '#059669' }}>
            <i className="ti ti-check text-sm" />
            {saving ? 'Approving...' : 'Approve & Schedule'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── QC Complete Modal ────────────────────────────────────────────────────────
function QCModal({ wo, onClose, onDone }: { wo: WO; onClose: () => void; onDone: () => void }) {
  const sku = parseSku(wo.notes)
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '')
  const skuPart = (sku ?? 'PROD').replace(/[^A-Z0-9]/gi, '').slice(0, 6).toUpperCase()
  const [lotNumber, setLotNumber] = useState(`LOT-${skuPart}-${today}`)
  const [qtyProduced, setQtyProduced] = useState(wo.qty_ordered)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const { productName } = parseMeta(wo.notes)

  async function complete() {
    setSaving(true)
    const r = await completeWorkOrder(wo.id, lotNumber, qtyProduced)
    setResult(r.message)
    if (r.success) setTimeout(onDone, 1200)
    else setSaving(false)
  }

  const inp = 'w-full border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-[#1A1D2E]'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-5 border-b flex items-center justify-between" style={{ borderColor: '#E4E6EE' }}>
          <div>
            <h2 className="font-semibold text-base text-[#1A1D2E]">QC Complete — Close Work Order</h2>
            <p className="text-sm text-gray-400 mt-0.5">
              {sku && <span className="font-mono text-emerald-500 mr-2">{sku}</span>}
              {productName || `WO-${wo.wo_number ?? wo.id.slice(0, 6)}`}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100">
            <i className="ti ti-x text-sm text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {result ? (
            <div className="rounded-xl p-4 text-center" style={{ background: '#ECFDF5' }}>
              <i className="ti ti-circle-check text-3xl text-green-500 block mb-2" />
              <p className="text-sm font-semibold text-green-700">{result}</p>
            </div>
          ) : (
            <>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1.5">Lot Number</label>
                <input value={lotNumber} onChange={e => setLotNumber(e.target.value)} className={inp} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1.5">Qty Produced</label>
                <input type="number" min={1} value={qtyProduced}
                  onChange={e => setQtyProduced(parseInt(e.target.value) || 0)} className={inp} />
                <p className="text-xs text-gray-400 mt-1">Required: {wo.qty_ordered.toLocaleString()}</p>
              </div>
              <div className="rounded-xl p-3" style={{ background: '#EFF6FF', border: '1px solid #BFDBFE' }}>
                <p className="text-xs text-blue-600">
                  Completing this work order will:
                  update inventory for <strong>{sku ?? 'this SKU'}</strong>,
                  create lot code <strong>{lotNumber}</strong>,
                  and check if the linked sales order is ready to ship.
                </p>
              </div>
            </>
          )}
        </div>

        {!result && (
          <div className="px-6 py-4 border-t flex gap-3 justify-end" style={{ borderColor: '#E4E6EE', background: '#F9FAFB' }}>
            <button onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm border text-gray-500 hover:bg-gray-100 transition-colors"
              style={{ borderColor: '#E4E6EE' }}>
              Cancel
            </button>
            <button onClick={complete} disabled={saving || !lotNumber}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 transition-colors"
              style={{ background: '#059669' }}>
              <i className="ti ti-package text-sm" />
              {saving ? 'Completing...' : 'Complete & Update Inventory'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Progress Update Modal ────────────────────────────────────────────────────
function ProgressModal({ wo, onClose, onDone }: { wo: WO; onClose: () => void; onDone: () => void }) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [qty, setQty] = useState(wo.qty_produced)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const { productName } = parseMeta(wo.notes)
  const sku = parseSku(wo.notes)

  async function sendToQC() {
    setSaving(true)
    await sb.from('work_orders').update({ status: 'QC', qty_produced: qty, notes: wo.notes + (notes ? `\nProgress: ${notes}` : '') }).eq('id', wo.id)
    onDone()
  }

  async function updateProgress() {
    setSaving(true)
    await sb.from('work_orders').update({ qty_produced: qty, notes: wo.notes + (notes ? `\nProgress: ${notes}` : '') }).eq('id', wo.id)
    onDone()
  }

  const inp = 'w-full border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-[#1A1D2E]'
  const pct = wo.qty_ordered > 0 ? Math.round((qty / wo.qty_ordered) * 100) : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-5 border-b flex items-center justify-between" style={{ borderColor: '#E4E6EE' }}>
          <div>
            <h2 className="font-semibold text-base text-[#1A1D2E]">Update Production Progress</h2>
            <p className="text-sm text-gray-400 mt-0.5">
              {sku && <span className="font-mono text-blue-500 mr-2">{sku}</span>}
              {productName || `WO-${wo.wo_number ?? wo.id.slice(0, 6)}`}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100">
            <i className="ti ti-x text-sm text-gray-500" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1.5">
              Qty Completed <span className="text-gray-400">/ {wo.qty_ordered.toLocaleString()}</span>
            </label>
            <input type="number" min={0} max={wo.qty_ordered} value={qty}
              onChange={e => setQty(parseInt(e.target.value) || 0)} className={inp} />
            <div className="mt-2 h-2 rounded-full bg-gray-100 overflow-hidden">
              <div className="h-full rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, pct)}%`, background: pct >= 100 ? '#059669' : '#3B6FE0' }} />
            </div>
            <p className="text-xs text-gray-400 mt-1">{pct}% complete</p>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1.5">Notes (optional)</label>
            <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Any notes about this production run..." className={inp + ' resize-none'} />
          </div>
        </div>
        <div className="px-6 py-4 border-t flex gap-3 justify-end" style={{ borderColor: '#E4E6EE', background: '#F9FAFB' }}>
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm border text-gray-500 hover:bg-gray-100"
            style={{ borderColor: '#E4E6EE' }}>Cancel</button>
          <button onClick={updateProgress} disabled={saving}
            className="px-4 py-2 rounded-lg text-sm border font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50"
            style={{ borderColor: '#BFDBFE' }}>
            {saving ? '...' : 'Save Progress'}
          </button>
          {qty >= wo.qty_ordered && (
            <button onClick={sendToQC} disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
              style={{ background: '#7C3AED' }}>
              <i className="ti ti-checkup-list text-sm" />
              {saving ? '...' : 'Send to QC'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Work Order Card ──────────────────────────────────────────────────────────
function WOCard({ wo, soMap, onAction }: {
  wo: WO
  soMap: Record<string, SalesOrder>
  onAction: (action: 'approve' | 'progress' | 'qc' | 'start', wo: WO) => void
}) {
  const { productName, soId, isAuto } = parseMeta(wo.notes)
  const sku = parseSku(wo.notes)
  const so = soId ? soMap[soId] : null
  const days = daysSince(wo.created_at)
  const pct = wo.qty_ordered > 0 ? Math.round(((wo.qty_produced ?? 0) / wo.qty_ordered) * 100) : 0

  const priorityMatch = wo.notes?.match(/Priority: (\w+)/)
  const priority = priorityMatch?.[1]
  const machineMatch = wo.notes?.match(/Machine: ([^|]+)/)
  const machine = machineMatch?.[1]?.trim()

  return (
    <div className="bg-white rounded-xl border p-4 hover:border-gray-300 transition-all"
      style={{ borderColor: '#E4E6EE' }}>
      {/* Top row */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          {sku && (
            <p className="text-xs font-semibold font-mono mb-0.5" style={{ color: '#3B6FE0' }}>{sku}</p>
          )}
          <p className="text-sm font-semibold text-[#1A1D2E] leading-snug truncate">
            {productName || (isAuto ? `Auto WO` : `WO-${wo.wo_number ?? wo.id.slice(0, 6)}`)}
          </p>
          {wo.wo_number && (
            <p className="text-xs text-gray-400 font-mono mt-0.5">WO-{wo.wo_number}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <StatusBadge status={wo.status} />
          {priority && priority !== 'Normal' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
              style={{
                background: priority === 'Urgent' ? '#FEF2F2' : '#FFFBEB',
                color: priority === 'Urgent' ? '#DC2626' : '#D97706',
              }}>
              {priority}
            </span>
          )}
        </div>
      </div>

      {/* Meta */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="rounded-lg p-2 text-center" style={{ background: '#F9FAFB' }}>
          <p className="text-xs text-gray-400">Required</p>
          <p className="text-base font-bold text-[#1A1D2E]">{wo.qty_ordered.toLocaleString()}</p>
        </div>
        <div className="rounded-lg p-2 text-center" style={{ background: '#F9FAFB' }}>
          <p className="text-xs text-gray-400">Produced</p>
          <p className="text-base font-bold" style={{ color: pct >= 100 ? '#059669' : '#1A1D2E' }}>
            {(wo.qty_produced ?? 0).toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg p-2 text-center" style={{ background: '#F9FAFB' }}>
          <p className="text-xs text-gray-400">Age</p>
          <p className="text-base font-bold" style={{ color: days > 7 ? '#DC2626' : '#1A1D2E' }}>
            {days}d
          </p>
        </div>
      </div>

      {/* Progress bar (In Progress only) */}
      {wo.status === 'In Progress' && (
        <div className="mb-3">
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>Progress</span><span>{pct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full rounded-full transition-all"
              style={{ width: `${Math.min(100, pct)}%`, background: pct >= 100 ? '#059669' : '#3B6FE0' }} />
          </div>
        </div>
      )}

      {/* Machine / due date */}
      {(machine || wo.due_date) && (
        <div className="flex items-center gap-3 mb-3 text-xs text-gray-400">
          {machine && <span><i className="ti ti-tool mr-1" />{machine}</span>}
          {wo.due_date && <span><i className="ti ti-calendar mr-1" />{new Date(wo.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
        </div>
      )}

      {/* Sales Order link */}
      {so && (
        <div className="mb-3 text-xs">
          <Link href="/sales/orders" className="text-blue-500 hover:text-blue-400">
            <i className="ti ti-shopping-cart mr-1" />{so.order_number}
          </Link>
          <span className="ml-2 px-1.5 py-0.5 rounded text-[10px]"
            style={{ background: '#F3F4F6', color: '#6B7280' }}>{so.status}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2 border-t" style={{ borderColor: '#F3F4F6' }}>
        {wo.status === 'Queued' && (
          <button
            onClick={() => onAction('approve', wo)}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium text-white transition-colors"
            style={{ background: '#059669' }}>
            <i className="ti ti-check text-xs" />
            Approve & Schedule
          </button>
        )}
        {wo.status === 'In Progress' && (
          <button
            onClick={() => onAction('progress', wo)}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium text-white transition-colors"
            style={{ background: '#3B6FE0' }}>
            <i className="ti ti-chart-bar text-xs" />
            Update Progress
          </button>
        )}
        {wo.status === 'QC' && (
          <button
            onClick={() => onAction('qc', wo)}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium text-white transition-colors"
            style={{ background: '#7C3AED' }}>
            <i className="ti ti-package text-xs" />
            Complete & Close
          </button>
        )}
        {wo.status === 'Complete' && (
          <span className="flex-1 text-center text-xs text-gray-400 py-1.5">
            <i className="ti ti-check text-green-500 mr-1" />
            Completed · {(wo.qty_produced ?? 0).toLocaleString()} produced
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ProductionPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<WO[]>([])
  const [orders, setOrders] = useState<SalesOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('All')
  const [search, setSearch] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  // Modal state
  const [approveWO, setApproveWO] = useState<WO | null>(null)
  const [progressWO, setProgressWO] = useState<WO | null>(null)
  const [qcWO, setQcWO] = useState<WO | null>(null)

  async function load() {
    setLoading(true)
    const [wRes, oRes] = await Promise.all([
      sb.from('work_orders').select('*').order('created_at', { ascending: false }),
      sb.from('sales_orders').select('id, order_number, status').order('order_number'),
    ])
    setRows((wRes.data ?? []) as WO[])
    setOrders((oRes.data ?? []) as SalesOrder[])
    setLoading(false)
  }

  useEffect(() => {
    load()
    sb.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email) })
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, []) // eslint-disable-line

  const soMap = useMemo(() =>
    Object.fromEntries(orders.map(o => [o.id, o])),
  [orders])

  const tabRows = useMemo(() => {
    let pool = tab === 'All' ? rows : rows.filter(r => r.status === tab)
    if (search.trim()) {
      const q = search.toLowerCase()
      pool = pool.filter(r =>
        (r.notes ?? '').toLowerCase().includes(q) ||
        String(r.wo_number).includes(q)
      )
    }
    return pool
  }, [rows, tab, search])

  const counts = useMemo(() => {
    const c: Record<string, number> = { All: rows.length }
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1
    return c
  }, [rows])

  const pendingApproval = counts['Queued'] ?? 0

  function handleAction(action: string, wo: WO) {
    if (action === 'approve') setApproveWO(wo)
    else if (action === 'progress') setProgressWO(wo)
    else if (action === 'qc') setQcWO(wo)
  }

  function closeAll() {
    setApproveWO(null)
    setProgressWO(null)
    setQcWO(null)
  }

  function onModalDone(msg?: string) {
    closeAll()
    if (msg) setToast(msg)
    load()
  }

  return (
    <div className="min-h-screen p-5 md:p-8" style={{ background: '#F5F6FA' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-amber-500/20 text-amber-600 border-amber-500/30">PRODUCTION</span>
          <h1 className="text-2xl font-semibold text-[#1A1D2E] mt-1">Work Orders</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {loading ? 'Loading…' : `${rows.length} work orders`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/production/qc"
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors"
            style={{ borderColor: '#E4E6EE', color: '#374151' }}>
            <i className="ti ti-checkup-list text-sm" />
            QC Board
          </Link>
          <Link href="/production/lots"
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors"
            style={{ borderColor: '#E4E6EE', color: '#374151' }}>
            <i className="ti ti-barcode text-sm" />
            Lot Codes
          </Link>
        </div>
      </div>

      {/* Approval alert */}
      {!loading && pendingApproval > 0 && (
        <div className="rounded-xl px-5 py-3.5 flex items-center gap-4 mb-5"
          style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
          <div className="flex-1">
            <span className="text-amber-700 font-semibold text-sm">
              {pendingApproval} work order{pendingApproval !== 1 ? 's' : ''} awaiting approval
            </span>
            <span className="text-amber-600 text-sm"> — Shea or Veejay must approve before production begins</span>
          </div>
          <button onClick={() => setTab('Queued')}
            className="text-xs text-amber-700 border border-amber-400 px-3 py-1.5 rounded-lg hover:bg-amber-50 transition-colors">
            View {pendingApproval > 1 ? 'All' : 'It'}
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-[#F0F2F7] rounded-lg p-1 overflow-x-auto mb-5">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${tab === t ? 'bg-white text-[#1A1D2E] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t}
            {counts[t] != null && counts[t] > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${tab === t ? 'bg-blue-100 text-blue-600' : 'bg-gray-200 text-gray-500'}`}>
                {counts[t]}
              </span>
            )}
            {t === 'Queued' && (counts['Queued'] ?? 0) > 0 && tab !== 'Queued' && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            )}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-5 max-w-sm">
        <i className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search SKU, product, WO#…"
          className="w-full bg-white border border-[#E4E6EE] rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-[#1A1D2E] placeholder-gray-400"
        />
      </div>

      {/* Cards grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton h-48 rounded-xl" />
          ))}
        </div>
      ) : tabRows.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#E4E6EE] flex items-center justify-center py-20">
          <div className="text-center">
            <i className="ti ti-tool text-4xl text-gray-200 block mb-3" />
            <p className="text-gray-400 text-sm">No work orders{tab !== 'All' ? ` in "${tab}"` : ''}</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {tabRows.map(wo => (
            <WOCard key={wo.id} wo={wo} soMap={soMap} onAction={handleAction} />
          ))}
        </div>
      )}

      {/* Modals */}
      {approveWO && (
        <ApproveModal
          wo={approveWO}
          userEmail={userEmail}
          onClose={closeAll}
          onDone={() => onModalDone('Work order approved and scheduled')}
        />
      )}
      {progressWO && (
        <ProgressModal
          wo={progressWO}
          onClose={closeAll}
          onDone={() => onModalDone('Progress updated')}
        />
      )}
      {qcWO && (
        <QCModal
          wo={qcWO}
          onClose={closeAll}
          onDone={() => onModalDone('Work order complete · Inventory updated')}
        />
      )}

      {toast && (
        <UndoToast
          message={toast}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  )
}
