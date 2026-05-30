'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState, memo } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────
interface SalesOrder {
  id: string
  order_number: string
  status: string
  notes: string | null
  po_number: string | null
  monday_item_id: string | null
  order_section: string | null
  facility: string | null
  order_date: string | null
  production_start: string | null
  estimated_completion: string | null
  ship_date: string | null
  required_ship_date: string | null
  customer_id: string | null
  customer_email: string | null
  customer_phone: string | null
  shipping_address: string | null
  additional_comments: string | null
  purchase_order_url: string | null
  packing_slip_url: string | null
  bol: string | null
  total_amount: number | null
  total: number | null
  subtotal: number | null
}

interface OrderLine {
  id: string
  sales_order_id: string | null
  product_id: string | null
  sku: string | null
  description: string | null
  added_details: string | null
  quantity: number
  completed_qty: number | null
  qty_per_case: number | null
  quantity_shipped: number | null
  unit_of_measure: string | null
  unit_price: number
  packaging: string | null
  production_status: string | null
  sku_flagged: boolean | null
  line_number: number | null
  detail_bom_url: string | null
}

interface Customer { id: string; company_name: string }
interface Product { id: string; sku: string; product_name: string; unit_cost: number | null; unit_of_measure: string | null }

// ── Constants ─────────────────────────────────────────────────────────────
const SECTION_TABS = ['All','Make To Stock','Private Label','Straw Orders','Customer DropShip','Injection Molding','Paper Products','Outsourced']
const SECTIONS = SECTION_TABS.slice(1)
const STATUSES = ['Pending','Confirmed','In Production','Ready to Ship','Shipped','On Hold','Partially Shipped','Closed']
const STATUS_COLORS: Record<string, string> = {
  Pending:            'bg-gray-700/50 text-gray-400 border-gray-700',
  Confirmed:          'bg-blue-500/15 text-blue-400 border-blue-500/20',
  'In Production':    'bg-amber-500/15 text-amber-400 border-amber-500/20',
  'Ready to Ship':    'bg-teal-500/15 text-teal-400 border-teal-500/20',
  Shipped:            'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  'On Hold':          'bg-red-500/15 text-red-400 border-red-500/20',
  'Partially Shipped':'bg-violet-500/15 text-violet-400 border-violet-500/20',
  Closed:             'bg-gray-800/50 text-gray-600 border-gray-800',
}

const fmt$ = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
const fmtD = (d: string | null) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const inp = 'w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition'

// ── Empty form ─────────────────────────────────────────────────────────────
const emptyForm = {
  notes: '', order_section: '', po_number: '', status: 'Pending', facility: '',
  order_date: '', production_start: '', estimated_completion: '', ship_date: '',
  customer_email: '', customer_phone: '', shipping_address: '',
  purchase_order_url: '', additional_comments: '', total_amount: '',
  customer_id: '',
}
type F = typeof emptyForm

const emptyLine = () => ({
  _key: Math.random().toString(36).slice(2),
  sku: '', description: '', quantity: '1', uom: '', packaging: '', production_status: '', added_details: '',
})
type DraftLine = ReturnType<typeof emptyLine>

// ── Status badge ───────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] ?? 'bg-gray-700/50 text-gray-400 border-gray-700'
  const pulse = status === 'In Production'
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium border ${cls}`}>
      {pulse && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"/>}
      {status}
    </span>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────
function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
      <p className="text-xs text-gray-500 font-medium">{label}</p>
      <p className={`text-xl font-bold mt-0.5 ${accent ?? 'text-white'}`}>{value}</p>
    </div>
  )
}

// ── Detail Panel ──────────────────────────────────────────────────────────
const DetailPanel = memo(function DetailPanel({
  order, lines, linesLoading, products, onClose, onEdit, onAssignSku, onRefreshLines,
}: {
  order: SalesOrder | null
  lines: OrderLine[]
  linesLoading: boolean
  products: Product[]
  onClose: () => void
  onEdit: () => void
  onAssignSku: (lineId: string, sku: string, productId: string | null) => Promise<void>
  onRefreshLines: () => void
}) {
  const [tab, setTab] = useState<'overview' | 'lines' | 'updates'>('overview')
  const [assigningLine, setAssigningLine] = useState<string | null>(null)
  const [skuQuery, setSkuQuery] = useState('')
  const [savingAssign, setSavingAssign] = useState(false)

  useEffect(() => { setTab('overview'); setAssigningLine(null) }, [order?.id])

  if (!order) return null

  const flaggedCount = lines.filter(l => l.sku_flagged).length
  const orderValue = order.total_amount ?? order.total ?? 0

  const matchedProducts = products.filter(p =>
    skuQuery.length > 0 &&
    (p.sku.toLowerCase().includes(skuQuery.toLowerCase()) ||
     p.product_name.toLowerCase().includes(skuQuery.toLowerCase()))
  ).slice(0, 8)

  async function doAssign(lineId: string, product: Product) {
    setSavingAssign(true)
    await onAssignSku(lineId, product.sku, product.id)
    setAssigningLine(null)
    setSkuQuery('')
    setSavingAssign(false)
    onRefreshLines()
  }

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/50 z-40"/>
      <div onClick={e => e.stopPropagation()}
        className="fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-full w-full md:w-[680px] bg-gray-900 border-l border-gray-800 z-50 flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-gray-800 shrink-0">
          <div className="flex-1 min-w-0 pr-4">
            <div className="flex items-center gap-2 mb-1">
              <StatusBadge status={order.status}/>
              {flaggedCount > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20 font-medium">
                  ⚠ {flaggedCount} SKU{flaggedCount !== 1 ? 's' : ''} unassigned
                </span>
              )}
            </div>
            <h2 className="text-white font-semibold text-sm truncate">{order.notes ?? order.order_number}</h2>
            <p className="text-xs text-gray-500 mt-0.5">PO: {order.po_number ?? '—'} · {order.order_section ?? '—'}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={onEdit} className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors">Edit</button>
            <button onClick={onClose} className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-gray-800">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 py-3 border-b border-gray-800 shrink-0">
          {(['overview','lines','updates'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors capitalize ${tab === t ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>
              {t}{t === 'lines' && lines.length > 0 ? ` (${lines.length})` : ''}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* ── Overview ── */}
          {tab === 'overview' && (
            <div className="px-6 py-5 space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  {[
                    ['PO Number', order.po_number],
                    ['Order Date', fmtD(order.order_date)],
                    ['Production Start', fmtD(order.production_start)],
                    ['Est. Completion', fmtD(order.estimated_completion)],
                    ['Ship Date', fmtD(order.ship_date ?? order.required_ship_date)],
                    ['Facility', order.facility],
                    ['Section', order.order_section],
                  ].map(([k, v]) => (
                    <div key={String(k)}>
                      <p className="text-xs text-gray-500">{k}</p>
                      <p className="text-sm text-white mt-0.5">{v ?? '—'}</p>
                    </div>
                  ))}
                </div>
                <div className="space-y-3">
                  {[
                    ['Customer Email', order.customer_email],
                    ['Customer Phone', order.customer_phone],
                    ['Total Value', fmt$(orderValue)],
                  ].map(([k, v]) => (
                    <div key={String(k)}>
                      <p className="text-xs text-gray-500">{k}</p>
                      <p className="text-sm text-white mt-0.5">{v ?? '—'}</p>
                    </div>
                  ))}
                  {order.purchase_order_url && (
                    <div>
                      <p className="text-xs text-gray-500">Purchase Order</p>
                      <a href={order.purchase_order_url} target="_blank" rel="noopener"
                        className="text-blue-400 text-xs underline hover:text-blue-300">View PO →</a>
                    </div>
                  )}
                  {order.shipping_address && (
                    <div>
                      <p className="text-xs text-gray-500">Shipping Address</p>
                      <p className="text-xs text-gray-300 mt-0.5 whitespace-pre-line">{order.shipping_address}</p>
                    </div>
                  )}
                </div>
              </div>
              {order.additional_comments && (
                <div className="bg-gray-800/40 rounded-lg p-3 border border-gray-700">
                  <p className="text-xs text-gray-500 mb-1">Additional Comments</p>
                  <p className="text-sm text-gray-300">{order.additional_comments}</p>
                </div>
              )}
            </div>
          )}

          {/* ── Line Items ── */}
          {tab === 'lines' && (
            <div className="px-6 py-5">
              {linesLoading ? (
                <p className="text-gray-600 text-sm">Loading…</p>
              ) : lines.length === 0 ? (
                <p className="text-gray-600 text-sm">No line items.</p>
              ) : (
                <div className="space-y-2">
                  {lines.map(line => {
                    const qty = line.quantity ?? 0
                    const done = line.completed_qty ?? line.quantity_shipped ?? 0
                    const pct = qty > 0 ? Math.min(100, Math.round((done / qty) * 100)) : 0
                    const isAssigning = assigningLine === line.id
                    return (
                      <div key={line.id} className={`border rounded-lg overflow-hidden ${line.sku_flagged ? 'border-amber-500/30 bg-amber-950/10' : 'border-gray-800 bg-gray-800/20'}`}>
                        <div className="px-3 py-2.5 flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              {line.sku_flagged && (
                                <span className="text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded font-medium" title="SKU needs assignment">⚠ No SKU</span>
                              )}
                              {line.sku && (
                                <span className="text-emerald-400 font-mono font-bold text-xs">{line.sku}</span>
                              )}
                              {line.production_status && (
                                <span className="text-xs bg-gray-700/50 text-gray-400 border border-gray-700 px-1.5 py-0.5 rounded">{line.production_status}</span>
                              )}
                            </div>
                            <p className="text-sm text-white font-medium mt-0.5 truncate">
                              {line.description ?? line.added_details ?? line.sku ?? '—'}
                            </p>
                            {line.added_details && line.added_details !== line.description && (
                              <p className="text-xs text-gray-500 mt-0.5">{line.added_details}</p>
                            )}
                            <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
                              <span>Qty: <span className="text-gray-300 font-medium">{qty}</span></span>
                              <span>Done: <span className={`font-medium ${pct === 100 ? 'text-emerald-400' : pct > 0 ? 'text-blue-400' : 'text-gray-400'}`}>{done}</span></span>
                              {line.unit_of_measure && <span>{line.unit_of_measure}</span>}
                              {line.packaging && <span>{line.packaging}</span>}
                              {line.qty_per_case && <span>/{line.qty_per_case} per case</span>}
                            </div>
                            {/* Progress bar */}
                            <div className="mt-2 h-1.5 bg-gray-700 rounded-full overflow-hidden w-full">
                              <div className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-400' : pct > 0 ? 'bg-blue-500' : 'bg-gray-700'}`}
                                style={{ width: `${pct}%` }}/>
                            </div>
                          </div>
                          <div className="text-right text-xs text-gray-500 shrink-0">
                            <div className={`font-semibold text-sm ${pct === 100 ? 'text-emerald-400' : 'text-gray-300'}`}>{pct}%</div>
                            {line.sku_flagged && (
                              <button onClick={() => { setAssigningLine(isAssigning ? null : line.id); setSkuQuery('') }}
                                className="mt-1 text-xs px-2 py-1 rounded bg-amber-600/50 hover:bg-amber-600 text-amber-300 transition-colors">
                                Assign SKU
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Inline SKU assignment */}
                        {isAssigning && (
                          <div className="border-t border-amber-500/20 px-3 py-3 bg-amber-950/10 space-y-2">
                            <input value={skuQuery} onChange={e => setSkuQuery(e.target.value)}
                              placeholder="Search SKU or product name…" autoFocus
                              className="w-full bg-gray-800 border border-amber-500/30 text-white placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 transition"/>
                            {matchedProducts.length > 0 && (
                              <div className="border border-gray-700 rounded-lg overflow-hidden">
                                {matchedProducts.map(p => (
                                  <button key={p.id} disabled={savingAssign}
                                    onClick={() => doAssign(line.id, p)}
                                    className="w-full text-left px-3 py-2 text-xs border-b border-gray-800 last:border-0 hover:bg-gray-800 transition-colors">
                                    <span className="text-emerald-400 font-mono font-bold">{p.sku}</span>
                                    <span className="text-gray-300 ml-2">{p.product_name}</span>
                                    {p.unit_cost != null && <span className="text-gray-500 ml-2">{fmt$(p.unit_cost)}/unit</span>}
                                  </button>
                                ))}
                              </div>
                            )}
                            <button onClick={() => setAssigningLine(null)} className="text-xs text-gray-500 hover:text-white">Cancel</button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Updates ── */}
          {tab === 'updates' && (
            <div className="px-6 py-5">
              {order.notes ? (
                <div className="bg-gray-800/40 rounded-lg p-4 border border-gray-700">
                  <p className="text-xs text-gray-500 mb-2">Order Notes / Name</p>
                  <p className="text-sm text-gray-200 whitespace-pre-line">{order.notes}</p>
                </div>
              ) : (
                <p className="text-gray-600 text-sm">No updates.</p>
              )}
              {order.additional_comments && (
                <div className="mt-4 bg-gray-800/40 rounded-lg p-4 border border-gray-700">
                  <p className="text-xs text-gray-500 mb-2">Additional Comments</p>
                  <p className="text-sm text-gray-200 whitespace-pre-line">{order.additional_comments}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
})

// ── Order Form (Add/Edit) ─────────────────────────────────────────────────
const OrderForm = memo(function OrderForm({
  open, editing, form, setForm, draftLines, setDraftLines,
  customers, products, err, saving, onClose, onSave,
}: {
  open: boolean
  editing: SalesOrder | null
  form: F
  setForm: React.Dispatch<React.SetStateAction<F>>
  draftLines: DraftLine[]
  setDraftLines: React.Dispatch<React.SetStateAction<DraftLine[]>>
  customers: Customer[]
  products: Product[]
  err: string
  saving: boolean
  onClose: () => void
  onSave: () => void
}) {
  const [skuDropdown, setSkuDropdown] = useState<number | null>(null)
  const [skuQ, setSkuQ] = useState('')
  const skuMatches = products.filter(p =>
    skuQ.length > 0 && (p.sku.toLowerCase().includes(skuQ.toLowerCase()) || p.product_name.toLowerCase().includes(skuQ.toLowerCase()))
  ).slice(0, 8)

  return (
    <>
      <div onClick={onClose} className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}/>
      <div onClick={e => e.stopPropagation()}
        className={`fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-full w-full md:w-[600px] bg-gray-900 border-l border-gray-800 z-50 flex flex-col shadow-2xl transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-800 shrink-0">
          <h2 className="text-white font-semibold">{editing ? 'Edit Order' : 'New Order'}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-gray-800">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Order Name <span className="text-red-400">*</span></label>
            <input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} className={inp} placeholder="Customer | Description"/>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Section</label>
              <select value={form.order_section} onChange={e => setForm(p => ({ ...p, order_section: e.target.value }))} className={inp + ' cursor-pointer'}>
                <option value="">— None —</option>
                {SECTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Status</label>
              <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))} className={inp + ' cursor-pointer'}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">PO Number</label>
              <input value={form.po_number} onChange={e => setForm(p => ({ ...p, po_number: e.target.value }))} className={inp}/>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Facility</label>
              <input value={form.facility} onChange={e => setForm(p => ({ ...p, facility: e.target.value }))} className={inp} placeholder="Santa Ana"/>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Customer</label>
            <select value={form.customer_id} onChange={e => setForm(p => ({ ...p, customer_id: e.target.value }))} className={inp + ' cursor-pointer'}>
              <option value="">— None —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {([['order_date','Order Date'],['production_start','Production Start'],['estimated_completion','Est. Completion'],['ship_date','Ship Date']] as const).map(([key, label]) => (
              <div key={key}>
                <label className="block text-xs text-gray-400 mb-1.5">{label}</label>
                <input type="date" value={(form as any)[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} className={inp}/>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Customer Email</label>
              <input type="email" value={form.customer_email} onChange={e => setForm(p => ({ ...p, customer_email: e.target.value }))} className={inp}/>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Customer Phone</label>
              <input value={form.customer_phone} onChange={e => setForm(p => ({ ...p, customer_phone: e.target.value }))} className={inp}/>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Shipping Address</label>
            <textarea rows={2} value={form.shipping_address} onChange={e => setForm(p => ({ ...p, shipping_address: e.target.value }))} className={inp + ' resize-none'}/>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Purchase Order URL</label>
            <input value={form.purchase_order_url} onChange={e => setForm(p => ({ ...p, purchase_order_url: e.target.value }))} className={inp} placeholder="https://…"/>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Total Value ($)</label>
            <input type="number" min="0" step="0.01" value={form.total_amount} onChange={e => setForm(p => ({ ...p, total_amount: e.target.value }))} className={inp}/>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Additional Comments</label>
            <textarea rows={2} value={form.additional_comments} onChange={e => setForm(p => ({ ...p, additional_comments: e.target.value }))} className={inp + ' resize-none'}/>
          </div>

          {/* Line items */}
          <div className="border-t border-gray-800 pt-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Line Items</p>
              <button onClick={() => setDraftLines(l => [...l, emptyLine()])}
                className="text-xs px-2.5 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors">+ Add Line</button>
            </div>
            <div className="space-y-3">
              {draftLines.map((line, i) => (
                <div key={line._key} className="bg-gray-800/40 rounded-lg p-3 border border-gray-700 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-600 w-4">{i + 1}</span>
                    <div className="flex-1 relative">
                      <input value={skuDropdown === i ? skuQ : line.sku}
                        onFocus={() => { setSkuDropdown(i); setSkuQ(line.sku) }}
                        onBlur={() => setTimeout(() => setSkuDropdown(null), 200)}
                        onChange={e => { setSkuQ(e.target.value); setDraftLines(dl => dl.map((d, j) => j === i ? { ...d, sku: e.target.value } : d)) }}
                        placeholder="SKU" className="w-full bg-gray-900 border border-gray-700 text-emerald-400 placeholder-gray-600 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500 transition"/>
                      {skuDropdown === i && skuMatches.length > 0 && (
                        <div className="absolute top-full left-0 right-0 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-10 overflow-hidden mt-1">
                          {skuMatches.map(p => (
                            <button key={p.id} onMouseDown={() => {
                              setDraftLines(dl => dl.map((d, j) => j === i ? { ...d, sku: p.sku, description: p.product_name } : d))
                              setSkuDropdown(null)
                            }} className="w-full text-left px-3 py-2 text-xs border-b border-gray-700 last:border-0 hover:bg-gray-700 transition-colors">
                              <span className="text-emerald-400 font-mono font-bold">{p.sku}</span>
                              <span className="text-gray-300 ml-2">{p.product_name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <input value={line.description} onChange={e => setDraftLines(dl => dl.map((d, j) => j === i ? { ...d, description: e.target.value } : d))}
                      placeholder="Description" className="flex-1 bg-gray-900 border border-gray-700 text-white placeholder-gray-600 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 transition"/>
                    <button onClick={() => setDraftLines(dl => dl.filter((_, j) => j !== i))}
                      className="text-red-400 hover:text-red-300 p-1 rounded hover:bg-red-500/10 transition-colors shrink-0">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {([['quantity','Qty'],['uom','UOM'],['packaging','Packaging'],['production_status','Prod. Status']] as const).map(([key, label]) => (
                      <div key={key}>
                        <input value={(line as any)[key]} onChange={e => setDraftLines(dl => dl.map((d, j) => j === i ? { ...d, [key]: e.target.value } : d))}
                          placeholder={label} className="w-full bg-gray-900 border border-gray-700 text-white placeholder-gray-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 transition"/>
                      </div>
                    ))}
                  </div>
                  <input value={line.added_details} onChange={e => setDraftLines(dl => dl.map((d, j) => j === i ? { ...d, added_details: e.target.value } : d))}
                    placeholder="Additional details" className="w-full bg-gray-900 border border-gray-700 text-white placeholder-gray-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 transition"/>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="shrink-0 px-6 py-4 border-t border-gray-800 space-y-3">
          {err && <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2"><p className="text-red-400 text-xs">{err}</p></div>}
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors">Cancel</button>
            <button onClick={onSave} disabled={saving}
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
              {saving ? 'Saving…' : 'Save Order'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
})

// ── Page ──────────────────────────────────────────────────────────────────
export default function OrdersPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<SalesOrder[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [flaggedMap, setFlaggedMap] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sectionTab, setSectionTab] = useState('All')
  const [detailOrder, setDetailOrder] = useState<SalesOrder | null>(null)
  const [detailLines, setDetailLines] = useState<OrderLine[]>([])
  const [linesLoading, setLinesLoading] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editingOrder, setEditingOrder] = useState<SalesOrder | null>(null)
  const [form, setForm] = useState<F>(emptyForm)
  const [draftLines, setDraftLines] = useState<DraftLine[]>([emptyLine()])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [loadError, setLoadError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    const [{ data: o, error: oErr }, { data: c }, { data: p }, { data: fl }] = await Promise.all([
      sb.from('sales_orders').select('*').order('created_at', { ascending: false }),
      sb.from('customers').select('id,company_name').eq('is_active', true).order('company_name'),
      sb.from('products').select('id,sku,product_name,unit_cost,unit_of_measure').eq('is_active', true).order('sku'),
      sb.from('sales_order_lines').select('sales_order_id').eq('sku_flagged', true),
    ])
    if (oErr) setLoadError(`Failed to load orders: ${oErr.message}`)
    else if (o) setRows(o as SalesOrder[])
    if (c) setCustomers(c as Customer[])
    if (p) setProducts(p as Product[])
    if (fl) {
      const fm: Record<string, number> = {}
      for (const r of fl as any[]) if (r.sales_order_id) fm[r.sales_order_id] = (fm[r.sales_order_id] ?? 0) + 1
      setFlaggedMap(fm)
    }
    setLoading(false)
  }, [sb])

  useEffect(() => { load() }, [load])

  async function loadLines(orderId: string) {
    setLinesLoading(true)
    setDetailLines([])
    const { data } = await sb.from('sales_order_lines').select('*')
      .or(`sales_order_id.eq.${orderId},order_id.eq.${orderId}`)
      .order('line_number', { ascending: true })
    if (data) setDetailLines(data as OrderLine[])
    setLinesLoading(false)
  }

  function openDetail(order: SalesOrder) {
    setDetailOrder(order)
    loadLines(order.id)
  }

  function openAdd() {
    setEditingOrder(null)
    setForm(emptyForm)
    setDraftLines([emptyLine()])
    setErr('')
    setFormOpen(true)
  }

  function openEdit(order: SalesOrder) {
    setEditingOrder(order)
    setForm({
      notes: order.notes ?? '',
      order_section: order.order_section ?? '',
      po_number: order.po_number ?? '',
      status: order.status,
      facility: order.facility ?? '',
      order_date: order.order_date ?? '',
      production_start: order.production_start ?? '',
      estimated_completion: order.estimated_completion ?? '',
      ship_date: order.ship_date ?? '',
      customer_email: order.customer_email ?? '',
      customer_phone: order.customer_phone ?? '',
      shipping_address: order.shipping_address ?? '',
      purchase_order_url: order.purchase_order_url ?? '',
      additional_comments: order.additional_comments ?? '',
      total_amount: order.total_amount != null ? String(order.total_amount) : '',
      customer_id: order.customer_id ?? '',
    })
    setDraftLines([])
    setErr('')
    setFormOpen(true)
  }

  async function save() {
    if (!form.notes.trim()) { setErr('Order Name is required.'); return }
    setErr(''); setSaving(true)

    const payload: Record<string, any> = {
      notes: form.notes.trim(),
      order_section: form.order_section || null,
      po_number: form.po_number.trim() || null,
      status: form.status,
      facility: form.facility.trim() || null,
      order_date: form.order_date || null,
      production_start: form.production_start || null,
      estimated_completion: form.estimated_completion || null,
      ship_date: form.ship_date || null,
      customer_email: form.customer_email.trim() || null,
      customer_phone: form.customer_phone.trim() || null,
      shipping_address: form.shipping_address.trim() || null,
      purchase_order_url: form.purchase_order_url.trim() || null,
      additional_comments: form.additional_comments.trim() || null,
      total_amount: form.total_amount ? parseFloat(form.total_amount) : 0,
      customer_id: form.customer_id || null,
      order_number: form.po_number.trim() || ('SO-' + Date.now()),
    }

    let orderId = editingOrder?.id
    if (editingOrder) {
      const { error } = await sb.from('sales_orders').update(payload).eq('id', editingOrder.id)
      if (error) { setErr(error.message); setSaving(false); return }
    } else {
      const { data, error } = await sb.from('sales_orders').insert(payload).select('id').single()
      if (error) { setErr(error.message); setSaving(false); return }
      orderId = data.id
    }

    // Insert new draft lines
    for (const line of draftLines) {
      if (!line.sku && !line.description) continue
      let productId: string | null = null
      let productName = line.description
      const prod = products.find(p => p.sku === line.sku)
      if (prod) { productId = prod.id; if (!productName) productName = prod.product_name }

      await sb.from('sales_order_lines').insert({
        sales_order_id: orderId,
        order_id: orderId,
        product_id: productId,
        sku: line.sku || null,
        description: productName || null,
        added_details: line.added_details || null,
        quantity: parseFloat(line.quantity) || 1,
        completed_qty: 0,
        quantity_shipped: 0,
        unit_of_measure: line.uom || null,
        unit_price: prod?.unit_cost ?? 0,
        packaging: line.packaging || null,
        production_status: line.production_status || null,
        sku_flagged: !line.sku,
        line_number: draftLines.indexOf(line) + 1,
        discount_pct: 0,
      })
    }

    setSaving(false)
    setFormOpen(false)
    setEditingOrder(null)
    if (detailOrder?.id === orderId) loadLines(orderId!)
    load()
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this order and all line items?')) return
    await sb.from('sales_order_lines').delete().or(`sales_order_id.eq.${id},order_id.eq.${id}`)
    await sb.from('sales_orders').delete().eq('id', id)
    if (detailOrder?.id === id) setDetailOrder(null)
    load()
  }

  async function assignSku(lineId: string, sku: string, productId: string | null) {
    await sb.from('sales_order_lines').update({ sku, product_id: productId, sku_flagged: false }).eq('id', lineId)
    load()
  }

  // Tab pool
  const tabPool = useMemo(() =>
    sectionTab === 'All' ? rows : rows.filter(r => (r.order_section ?? '') === sectionTab),
    [rows, sectionTab])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return tabPool
    return tabPool.filter(r =>
      (r.notes ?? '').toLowerCase().includes(q) ||
      (r.order_number ?? '').toLowerCase().includes(q) ||
      (r.po_number ?? '').toLowerCase().includes(q) ||
      (r.customer_email ?? '').toLowerCase().includes(q) ||
      (r.order_section ?? '').toLowerCase().includes(q)
    )
  }, [tabPool, search])

  // Stats
  const stats = useMemo(() => {
    const inProd = tabPool.filter(r => r.status === 'In Production').length
    const ready = tabPool.filter(r => r.status === 'Ready to Ship').length
    const onHold = tabPool.filter(r => r.status === 'On Hold').length
    const totalVal = tabPool.reduce((s, r) => s + (r.total_amount ?? r.total ?? 0), 0)
    return { inProd, ready, onHold, totalVal }
  }, [tabPool])

  const sectionCounts = useMemo(() => {
    const c: Record<string, number> = { All: rows.length }
    for (const r of rows) { const s = r.order_section ?? 'Uncategorized'; c[s] = (c[s] ?? 0) + 1 }
    return c
  }, [rows])

  return (
    <div className="p-4 md:p-8 min-h-screen">
      {loadError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-4 flex items-center gap-3">
          <span className="text-red-400 text-sm flex-1">{loadError}</span>
          <button onClick={load} className="text-xs text-red-400 border border-red-500/30 rounded-lg px-3 py-1">Retry</button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-blue-500/20 text-blue-300 border-blue-500/30">ORDERS</span>
          <h1 className="text-2xl font-semibold text-white mt-1">Sales Orders</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${rows.length} orders`}</p>
        </div>
        <button onClick={openAdd}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
          New Order
        </button>
      </div>

      {/* Stats */}
      {!loading && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
          <Stat label="Total Orders" value={String(tabPool.length)}/>
          <Stat label="In Production" value={String(stats.inProd)} accent="text-amber-400"/>
          <Stat label="Ready to Ship" value={String(stats.ready)} accent="text-teal-400"/>
          <Stat label="On Hold" value={String(stats.onHold)} accent={stats.onHold > 0 ? 'text-red-400' : 'text-white'}/>
          <Stat label="Total Value" value={new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(stats.totalVal)} accent="text-emerald-400"/>
        </div>
      )}

      {/* Section tabs */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1 overflow-x-auto mb-4">
        {SECTION_TABS.map(t => (
          <button key={t} onClick={() => setSectionTab(t)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${sectionTab === t ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>
            {t}{sectionCounts[t] != null ? ` (${sectionCounts[t]})` : ''}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-4 max-w-md">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        <input placeholder="Search order name, PO #, email…" value={search} onChange={e => setSearch(e.target.value)}
          className="w-full bg-gray-900 border border-gray-800 text-white placeholder-gray-600 rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"/>
        {search && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">{filtered.length}</span>}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <svg className="w-5 h-5 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-gray-500 py-20 text-sm">No orders found.</p>
        ) : (
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                {['#','Order Name','Section','PO #','Status','Facility','Order Date','Est. Complete','Ship Date','Value','Lines','⚠','Actions'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 px-3 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((order, i) => {
                const flagged = flaggedMap[order.id] ?? 0
                return (
                  <tr key={order.id}
                    className={`border-b border-gray-800/60 last:border-0 cursor-pointer transition-colors ${i % 2 === 1 ? 'bg-gray-800/10' : ''} hover:bg-gray-800/40`}
                    onClick={() => openDetail(order)}>
                    <td className="px-3 py-3.5 text-gray-600 text-xs">{i + 1}</td>
                    <td className="px-3 py-3.5 max-w-[240px]">
                      <p className="text-white font-medium text-xs truncate">{order.notes ?? order.order_number}</p>
                    </td>
                    <td className="px-3 py-3.5">
                      {order.order_section && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-400 border border-gray-700">{order.order_section}</span>
                      )}
                    </td>
                    <td className="px-3 py-3.5 text-gray-400 text-xs font-mono">{order.po_number ?? '—'}</td>
                    <td className="px-3 py-3.5"><StatusBadge status={order.status}/></td>
                    <td className="px-3 py-3.5 text-gray-500 text-xs">{order.facility ?? '—'}</td>
                    <td className="px-3 py-3.5 text-gray-400 text-xs">{fmtD(order.order_date)}</td>
                    <td className="px-3 py-3.5 text-gray-400 text-xs">{fmtD(order.estimated_completion)}</td>
                    <td className="px-3 py-3.5 text-gray-400 text-xs">{fmtD(order.ship_date ?? order.required_ship_date)}</td>
                    <td className="px-3 py-3.5 text-xs font-medium text-gray-300">{fmt$(order.total_amount ?? order.total)}</td>
                    <td className="px-3 py-3.5 text-gray-500 text-xs">—</td>
                    <td className="px-3 py-3.5">
                      {flagged > 0 && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20 font-medium" title={`${flagged} line items need SKU assignment`}>
                          ⚠ {flagged}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3.5" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <button onClick={() => openDetail(order)}
                          className="text-xs px-2 py-1 rounded bg-gray-700/50 hover:bg-gray-700 text-gray-300 transition-colors">View</button>
                        <button onClick={() => { openEdit(order) }}
                          className="text-xs px-2 py-1 rounded bg-blue-700/50 hover:bg-blue-700 text-blue-300 transition-colors">Edit</button>
                        <button onClick={() => handleDelete(order.id)}
                          className="text-xs px-2 py-1 rounded bg-red-900/40 hover:bg-red-900/70 text-red-400 transition-colors">Del</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <DetailPanel
        order={detailOrder}
        lines={detailLines}
        linesLoading={linesLoading}
        products={products}
        onClose={() => setDetailOrder(null)}
        onEdit={() => { if (detailOrder) { setDetailOrder(null); openEdit(detailOrder) } }}
        onAssignSku={assignSku}
        onRefreshLines={() => detailOrder && loadLines(detailOrder.id)}
      />

      <OrderForm
        open={formOpen}
        editing={editingOrder}
        form={form}
        setForm={setForm}
        draftLines={draftLines}
        setDraftLines={setDraftLines}
        customers={customers}
        products={products}
        err={err}
        saving={saving}
        onClose={() => { setFormOpen(false); setEditingOrder(null) }}
        onSave={save}
      />
    </div>
  )
}
