'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

// ── Types ──────────────────────────────────────────────────────────────────
interface SalesOrder {
  id: string
  order_number: string
  status: string
  notes: string | null
  po_number: string | null
  monday_item_id: string | null
  order_section: string | null
  facility: string | null
  carrier: string | null
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
  customer?: { id: string; company_name: string; email?: string | null; phone?: string | null } | null
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
  quantity_shipped: number | null
  qty_per_case: number | null
  unit_of_measure: string | null
  unit_price: number
  packaging: string | null
  production_status: string | null
  sku_flagged: boolean | null
  line_number: number | null
}

interface Product { id: string; sku: string; product_name: string; unit_cost: number | null; unit_of_measure: string | null }
interface Customer { id: string; company_name: string }

// ── Constants ──────────────────────────────────────────────────────────────
const SECTIONS = ['Make To Stock','Private Label','Straw Orders','Customer DropShip','Injection Molding','Paper Products','Outsourced']
const SECTION_TABS = ['All', ...SECTIONS]
const STATUSES = ['Pending','Confirmed','In Production','Ready to Ship','Shipped','On Hold','Partially Shipped','Closed']
const STATUS_COLORS: Record<string,string> = {
  Pending:             'bg-gray-700/50 text-gray-400 border-gray-700',
  Confirmed:           'bg-blue-500/15 text-blue-400 border-blue-500/20',
  'In Production':     'bg-amber-500/15 text-amber-400 border-amber-500/20',
  'Ready to Ship':     'bg-teal-500/15 text-teal-400 border-teal-500/20',
  Shipped:             'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  'On Hold':           'bg-red-500/15 text-red-400 border-red-500/20',
  'Partially Shipped': 'bg-violet-500/15 text-violet-400 border-violet-500/20',
  Closed:              'bg-gray-800/60 text-gray-600 border-gray-800',
}
const fmt$ = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
const fmtD = (d: string | null) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const inp = 'w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition'

// ── Helpers ────────────────────────────────────────────────────────────────
function orderCustomerName(o: SalesOrder): string {
  if (o.customer?.company_name) return o.customer.company_name
  const notes = o.notes ?? o.order_number
  return notes.split('|')[0].trim()
}
function orderRef(o: SalesOrder): string | null {
  const notes = o.notes ?? ''
  const parts = notes.split('|')
  return parts.length > 1 ? parts.slice(1).join('|').trim() : null
}
function orderValue(o: SalesOrder): number {
  return o.total_amount ?? o.total ?? o.subtotal ?? 0
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] ?? STATUS_COLORS.Pending
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium border whitespace-nowrap ${cls}`}>
      {status === 'In Production' && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"/>}
      {status}
    </span>
  )
}

function Stat({ label, value, accent, sub }: { label: string; value: string; accent?: string; sub?: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
      <p className="text-xs text-gray-500 font-medium">{label}</p>
      <p className={`text-xl font-bold mt-0.5 ${accent ?? 'text-white'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-600 mt-0.5">{sub}</p>}
    </div>
  )
}

// ── Inline SKU assignment ──────────────────────────────────────────────────
function SkuAssign({ lineId, onAssigned }: { lineId: string; onAssigned: (sku: string, productId: string | null) => void }) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Product[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (q.length < 1) { setResults([]); return }
    const t = setTimeout(async () => {
      const { data } = await sb.from('products').select('id,sku,product_name,unit_cost,unit_of_measure').or(`sku.ilike.%${q}%,product_name.ilike.%${q}%`).limit(8)
      setResults((data ?? []) as Product[])
      setOpen(true)
    }, 200)
    return () => clearTimeout(t)
  }, [q, sb])

  useEffect(() => {
    function h(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  async function assign(p: Product) {
    await sb.from('sales_order_lines').update({ sku: p.sku, product_id: p.id, sku_flagged: false, description: p.product_name, unit_price: p.unit_cost ?? 0 }).eq('id', lineId)
    onAssigned(p.sku, p.id)
    setQ(''); setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search SKU…"
        onFocus={() => q && setOpen(true)}
        className="bg-gray-800 border border-amber-500/40 text-white placeholder-gray-600 rounded px-2 py-1 text-xs w-36 focus:outline-none focus:ring-1 focus:ring-amber-500 transition"/>
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-20 w-72 overflow-hidden">
          {results.map(p => (
            <button key={p.id} onMouseDown={() => assign(p)}
              className="w-full text-left px-3 py-2 text-xs border-b border-gray-700 last:border-0 hover:bg-gray-700 transition-colors">
              <span className="text-emerald-400 font-mono font-bold">{p.sku}</span>
              <span className="text-gray-300 ml-2">{p.product_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Line items sub-table ───────────────────────────────────────────────────
function LinesTable({ orderId, onLineUpdated }: { orderId: string; onLineUpdated: () => void }) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [lines, setLines] = useState<OrderLine[]>([])
  const [loading, setLoading] = useState(true)
  const [assigningId, setAssigningId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await sb.from('sales_order_lines').select('*').eq('sales_order_id', orderId).order('line_number', { ascending: true })
    setLines((data ?? []) as OrderLine[])
    setLoading(false)
  }, [sb, orderId])

  useEffect(() => { load() }, [load])

  if (loading) return <tr><td colSpan={13} className="px-6 py-4 text-center text-gray-600 text-xs">Loading lines…</td></tr>
  if (lines.length === 0) return <tr><td colSpan={13} className="px-6 py-4 text-center text-gray-600 text-xs">No line items.</td></tr>

  return (
    <>
      {lines.map(line => {
        const qty = line.quantity ?? 0
        const done = line.completed_qty ?? line.quantity_shipped ?? 0
        const pct = qty > 0 ? Math.min(100, Math.round((done / qty) * 100)) : 0
        return (
          <tr key={line.id} className="bg-gray-950/60 border-b border-gray-800/40 last:border-0">
            <td className="pl-12 pr-2 py-2.5 w-8">
              {line.sku_flagged
                ? <span className="text-amber-400 text-xs" title="Needs SKU assignment">⚠</span>
                : <span className="text-gray-700 text-xs">—</span>
              }
            </td>
            <td className="px-2 py-2.5 text-gray-600 text-xs">{line.line_number ?? '—'}</td>
            <td className="px-2 py-2.5">
              {line.sku_flagged && assigningId === line.id ? (
                <SkuAssign lineId={line.id} onAssigned={(sku) => {
                  setLines(ls => ls.map(l => l.id === line.id ? { ...l, sku, sku_flagged: false } : l))
                  setAssigningId(null)
                  onLineUpdated()
                }}/>
              ) : line.sku ? (
                <span className="text-emerald-400 font-mono font-bold text-xs">{line.sku}</span>
              ) : (
                <button onClick={() => setAssigningId(line.id)}
                  className="text-xs px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20 hover:bg-amber-500/25 transition-colors">
                  Assign SKU
                </button>
              )}
            </td>
            <td className="px-2 py-2.5 text-gray-300 text-xs max-w-[180px] truncate">{line.description ?? line.added_details ?? '—'}</td>
            <td className="px-2 py-2.5 text-gray-300 text-xs font-semibold">{qty}</td>
            <td className={`px-2 py-2.5 text-xs font-medium ${pct === 100 ? 'text-emerald-400' : pct > 0 ? 'text-blue-400' : 'text-gray-600'}`}>{done}</td>
            <td className="px-2 py-2.5 text-gray-500 text-xs">{line.unit_of_measure ?? '—'}</td>
            <td className="px-2 py-2.5 text-gray-500 text-xs">{line.packaging ?? '—'}</td>
            <td className="px-2 py-2.5">
              {line.production_status && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-400 border border-gray-700 whitespace-nowrap">{line.production_status}</span>
              )}
            </td>
            <td className="px-2 py-2.5 text-gray-600 text-xs max-w-[160px] truncate">{line.added_details ?? '—'}</td>
            <td className="px-2 py-2.5 w-24">
              <div className="flex items-center gap-1.5">
                <div className="flex-1 bg-gray-800 rounded-full h-1.5 overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-400' : pct > 0 ? 'bg-blue-500' : 'bg-gray-700'}`}
                    style={{ width: `${pct}%` }}/>
                </div>
                <span className={`text-xs font-medium w-8 text-right ${pct === 100 ? 'text-emerald-400' : 'text-gray-500'}`}>{pct}%</span>
              </div>
            </td>
          </tr>
        )
      })}
    </>
  )
}

// ── Edit form ──────────────────────────────────────────────────────────────
const emptyForm = {
  notes: '', order_section: '', order_number: '', status: 'Pending', facility: '',
  monday_item_id: '', order_date: '', production_start: '', estimated_completion: '',
  ship_date: '', customer_id: '', customer_email: '', customer_phone: '',
  shipping_address: '', total_amount: '', purchase_order_url: '', packing_slip_url: '',
  bol: '', additional_comments: '',
}
type F = typeof emptyForm

interface EditLineState {
  _key: string
  id?: string
  sku: string
  description: string
  quantity: string
  completed_qty: string
  unit_of_measure: string
  packaging: string
  production_status: string
  added_details: string
  sku_flagged: boolean
  product_id: string | null
}

function EditPanel({
  open, editing, form, setForm, editLines, setEditLines,
  customers, products, err, saving, onClose, onSave, onDelete,
}: {
  open: boolean
  editing: SalesOrder | null
  form: F
  setForm: React.Dispatch<React.SetStateAction<F>>
  editLines: EditLineState[]
  setEditLines: React.Dispatch<React.SetStateAction<EditLineState[]>>
  customers: Customer[]
  products: Product[]
  err: string
  saving: boolean
  onClose: () => void
  onSave: () => void
  onDelete: () => void
}) {
  const [skuDropdown, setSkuDropdown] = useState<number | null>(null)
  const [skuQ, setSkuQ] = useState('')
  const skuMatches = products.filter(p =>
    skuQ.length > 0 && (p.sku.toLowerCase().includes(skuQ.toLowerCase()) || p.product_name.toLowerCase().includes(skuQ.toLowerCase()))
  ).slice(0, 8)

  function addLine() {
    setEditLines(ls => [...ls, { _key: Math.random().toString(36).slice(2), sku: '', description: '', quantity: '1', completed_qty: '0', unit_of_measure: '', packaging: '', production_status: '', added_details: '', sku_flagged: false, product_id: null }])
  }
  function removeLine(key: string) { setEditLines(ls => ls.filter(l => l._key !== key)) }
  function updateLine(key: string, patch: Partial<EditLineState>) { setEditLines(ls => ls.map(l => l._key === key ? { ...l, ...patch } : l)) }

  return (
    <>
      <div onClick={onClose} className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}/>
      <div onClick={e => e.stopPropagation()}
        className={`fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-full w-full md:w-[600px] bg-gray-900 border-l border-gray-800 z-50 flex flex-col shadow-2xl transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-800 shrink-0">
          <div>
            <h2 className="text-white font-semibold">{editing ? 'Edit Order' : 'New Order'}</h2>
            {editing && <p className="text-xs text-gray-500 mt-0.5">{editing.order_number}</p>}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-gray-800">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Order Info */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Order Info</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Order Name / Customer <span className="text-red-400">*</span></label>
                <input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} className={inp} placeholder="Customer Name | PO Reference"/>
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
                  <input value={form.order_number} onChange={e => setForm(p => ({ ...p, order_number: e.target.value }))} className={inp}/>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Facility</label>
                  <input value={form.facility} onChange={e => setForm(p => ({ ...p, facility: e.target.value }))} className={inp} placeholder="Santa Ana"/>
                </div>
              </div>
              {editing && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Monday Item ID</label>
                  <input value={form.monday_item_id} readOnly className={inp + ' opacity-60 cursor-not-allowed'}/>
                </div>
              )}
            </div>
          </div>

          {/* Dates */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Dates</p>
            <div className="grid grid-cols-2 gap-3">
              {([['order_date','Order Date'],['production_start','Production Start'],['estimated_completion','Est. Completion'],['ship_date','Ship Date']] as const).map(([key, label]) => (
                <div key={key}>
                  <label className="block text-xs text-gray-400 mb-1.5">{label}</label>
                  <input type="date" value={(form as any)[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} className={inp}/>
                </div>
              ))}
            </div>
          </div>

          {/* Customer */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Customer Info</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Link to Customer</label>
                <select value={form.customer_id} onChange={e => setForm(p => ({ ...p, customer_id: e.target.value }))} className={inp + ' cursor-pointer'}>
                  <option value="">— None —</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Email</label>
                  <input type="email" value={form.customer_email} onChange={e => setForm(p => ({ ...p, customer_email: e.target.value }))} className={inp}/>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Phone</label>
                  <input value={form.customer_phone} onChange={e => setForm(p => ({ ...p, customer_phone: e.target.value }))} className={inp}/>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Shipping Address</label>
                <textarea rows={2} value={form.shipping_address} onChange={e => setForm(p => ({ ...p, shipping_address: e.target.value }))} className={inp + ' resize-none'}/>
              </div>
            </div>
          </div>

          {/* Financial */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Financial</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Total Value ($)</label>
                <input type="number" min="0" step="0.01" value={form.total_amount} onChange={e => setForm(p => ({ ...p, total_amount: e.target.value }))} className={inp}/>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">PO Document URL</label>
                <input value={form.purchase_order_url} onChange={e => setForm(p => ({ ...p, purchase_order_url: e.target.value }))} className={inp} placeholder="https://…"/>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Packing Slip URL</label>
                  <input value={form.packing_slip_url} onChange={e => setForm(p => ({ ...p, packing_slip_url: e.target.value }))} className={inp}/>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">BOL</label>
                  <input value={form.bol} onChange={e => setForm(p => ({ ...p, bol: e.target.value }))} className={inp}/>
                </div>
              </div>
            </div>
          </div>

          {/* Comments */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Additional Comments</label>
            <textarea rows={2} value={form.additional_comments} onChange={e => setForm(p => ({ ...p, additional_comments: e.target.value }))} className={inp + ' resize-none'}/>
          </div>

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Line Items</p>
              <button onClick={addLine} className="text-xs px-2.5 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors">+ Add Line</button>
            </div>
            <div className="space-y-2">
              {editLines.map((line, i) => (
                <div key={line._key} className={`rounded-lg p-3 border space-y-2 ${line.sku_flagged ? 'border-amber-500/30 bg-amber-950/10' : 'border-gray-700 bg-gray-800/30'}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-600 w-5 shrink-0">{i + 1}</span>
                    {/* SKU with typeahead */}
                    <div className="relative flex-1">
                      <input value={skuDropdown === i ? skuQ : (line.sku || '')}
                        onFocus={() => { setSkuDropdown(i); setSkuQ(line.sku || '') }}
                        onBlur={() => setTimeout(() => setSkuDropdown(null), 200)}
                        onChange={e => { setSkuQ(e.target.value); updateLine(line._key, { sku: e.target.value, sku_flagged: !e.target.value }) }}
                        placeholder="SKU"
                        className={`w-full bg-gray-900 border ${line.sku_flagged ? 'border-amber-500/40' : 'border-gray-700'} text-emerald-400 placeholder-gray-600 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500 transition`}/>
                      {skuDropdown === i && skuMatches.length > 0 && (
                        <div className="absolute top-full left-0 right-0 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-10 overflow-hidden mt-0.5 max-h-40 overflow-y-auto">
                          {skuMatches.map(p => (
                            <button key={p.id} onMouseDown={() => {
                              updateLine(line._key, { sku: p.sku, description: p.product_name, product_id: p.id, sku_flagged: false })
                              setSkuDropdown(null)
                            }} className="w-full text-left px-3 py-2 text-xs border-b border-gray-700 last:border-0 hover:bg-gray-700 transition-colors">
                              <span className="text-emerald-400 font-mono font-bold">{p.sku}</span>
                              <span className="text-gray-300 ml-2">{p.product_name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <input value={line.description} onChange={e => updateLine(line._key, { description: e.target.value })}
                      placeholder="Description" className="flex-1 bg-gray-900 border border-gray-700 text-white placeholder-gray-600 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 transition"/>
                    <button onClick={() => removeLine(line._key)} className="text-red-400 hover:text-red-300 p-1 rounded hover:bg-red-500/10 transition-colors shrink-0">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {([['quantity','Qty'],['completed_qty','Done'],['unit_of_measure','UOM'],['packaging','Packaging']] as const).map(([key, label]) => (
                      <input key={key} value={(line as any)[key]} onChange={e => updateLine(line._key, { [key]: e.target.value })}
                        placeholder={label} className="bg-gray-900 border border-gray-700 text-white placeholder-gray-600 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 transition"/>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input value={line.production_status} onChange={e => updateLine(line._key, { production_status: e.target.value })}
                      placeholder="Production Status" className="bg-gray-900 border border-gray-700 text-white placeholder-gray-600 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 transition"/>
                    <input value={line.added_details} onChange={e => updateLine(line._key, { added_details: e.target.value })}
                      placeholder="Details / Specs" className="bg-gray-900 border border-gray-700 text-white placeholder-gray-600 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 transition"/>
                  </div>
                </div>
              ))}
              {editLines.length === 0 && (
                <p className="text-gray-600 text-xs text-center py-4">No line items. Click &quot;+ Add Line&quot; to add products.</p>
              )}
            </div>
          </div>
        </div>

        <div className="shrink-0 px-6 py-4 border-t border-gray-800 space-y-3">
          {err && <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2"><p className="text-red-400 text-xs">{err}</p></div>}
          <div className="flex gap-3">
            {editing && (
              <button onClick={onDelete} className="text-sm px-3 py-2.5 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors" title="Delete">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            )}
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
}

// ── Page ──────────────────────────────────────────────────────────────────
export default function OrdersPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [orders, setOrders] = useState<SalesOrder[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [flaggedMap, setFlaggedMap] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sectionTab, setSectionTab] = useState('All')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [editOpen, setEditOpen] = useState(false)
  const [editingOrder, setEditingOrder] = useState<SalesOrder | null>(null)
  const [form, setForm] = useState<F>(emptyForm)
  const [editLines, setEditLines] = useState<EditLineState[]>([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [loadError, setLoadError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setLoadError('')
    const [{ data: o, error: oErr }, { data: c }, { data: p }, { data: fl }] = await Promise.all([
      sb.from('sales_orders').select('*, customer:customers(id,company_name,email,phone)').order('created_at', { ascending: false }),
      sb.from('customers').select('id,company_name').eq('is_active', true).order('company_name'),
      sb.from('products').select('id,sku,product_name,unit_cost,unit_of_measure').eq('is_active', true).order('sku'),
      sb.from('sales_order_lines').select('sales_order_id').eq('sku_flagged', true),
    ])
    if (oErr) setLoadError('Failed to load orders: ' + oErr.message)
    else if (o) setOrders(o as SalesOrder[])
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

  // Pools + stats
  const tabPool = useMemo(() =>
    sectionTab === 'All' ? orders : orders.filter(o => (o.order_section ?? '') === sectionTab),
    [orders, sectionTab])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return tabPool
    return tabPool.filter(o =>
      orderCustomerName(o).toLowerCase().includes(q) ||
      (o.notes ?? '').toLowerCase().includes(q) ||
      (o.order_number ?? '').toLowerCase().includes(q) ||
      (o.po_number ?? '').toLowerCase().includes(q) ||
      (o.customer_email ?? '').toLowerCase().includes(q)
    )
  }, [tabPool, search])

  const stats = useMemo(() => {
    const inProd = tabPool.filter(o => o.status === 'In Production').length
    const ready  = tabPool.filter(o => o.status === 'Ready to Ship').length
    const onHold = tabPool.filter(o => o.status === 'On Hold').length
    const totalVal = tabPool.reduce((s, o) => s + orderValue(o), 0)
    const flaggedTotal = Object.values(flaggedMap).reduce((s, v) => s + v, 0)
    return { inProd, ready, onHold, totalVal, flaggedTotal }
  }, [tabPool, flaggedMap])

  const sectionCounts = useMemo(() => {
    const c: Record<string,number> = { All: orders.length }
    for (const o of orders) { const s = o.order_section ?? 'Other'; c[s] = (c[s] ?? 0) + 1 }
    return c
  }, [orders])

  function toggleExpand(id: string) {
    setExpandedIds(prev => {
      const n = new Set(prev)
      if (n.has(id)) { n.delete(id) } else { n.add(id) }
      return n
    })
  }

  // Form helpers
  function openAdd() {
    setEditingOrder(null); setForm(emptyForm); setEditLines([]); setErr(''); setEditOpen(true)
  }

  async function openEdit(order: SalesOrder) {
    // Load lines for this order
    const { data: lines } = await sb.from('sales_order_lines').select('*').eq('sales_order_id', order.id).order('line_number')
    setEditLines((lines ?? []).map((l: any) => ({
      _key: l.id,
      id: l.id,
      sku: l.sku ?? '',
      description: l.description ?? '',
      quantity: String(l.quantity ?? 1),
      completed_qty: String(l.completed_qty ?? l.quantity_shipped ?? 0),
      unit_of_measure: l.unit_of_measure ?? '',
      packaging: l.packaging ?? '',
      production_status: l.production_status ?? '',
      added_details: l.added_details ?? '',
      sku_flagged: l.sku_flagged ?? false,
      product_id: l.product_id ?? null,
    })))
    setEditingOrder(order)
    setForm({
      notes: order.notes ?? '',
      order_section: order.order_section ?? '',
      order_number: order.order_number ?? order.po_number ?? '',
      status: order.status,
      facility: order.facility ?? order.carrier ?? '',
      monday_item_id: order.monday_item_id ?? '',
      order_date: order.order_date ?? '',
      production_start: order.production_start ?? '',
      estimated_completion: order.estimated_completion ?? '',
      ship_date: order.ship_date ?? order.required_ship_date ?? '',
      customer_id: order.customer_id ?? '',
      customer_email: order.customer_email ?? '',
      customer_phone: order.customer_phone ?? '',
      shipping_address: order.shipping_address ?? '',
      total_amount: orderValue(order) ? String(orderValue(order)) : '',
      purchase_order_url: order.purchase_order_url ?? '',
      packing_slip_url: order.packing_slip_url ?? '',
      bol: order.bol ?? '',
      additional_comments: order.additional_comments ?? '',
    })
    setErr(''); setEditOpen(true)
  }

  async function save() {
    if (!form.notes.trim()) { setErr('Order name is required.'); return }
    setErr(''); setSaving(true)

    const basePayload: Record<string,any> = {
      notes: form.notes.trim(),
      order_number: form.order_number.trim() || ('SO-' + Date.now()),
      status: form.status,
      po_number: form.order_number.trim() || null,
      order_date: form.order_date || null,
      required_ship_date: form.ship_date || null,
      carrier: form.facility || null,
      customer_id: form.customer_id || null,
      subtotal: form.total_amount ? parseFloat(form.total_amount) : 0,
      total: form.total_amount ? parseFloat(form.total_amount) : 0,
      tax_pct: 0,
      shipping_address: form.shipping_address || null,
    }
    const extPayload: Record<string,any> = {
      order_section: form.order_section || null,
      facility: form.facility || null,
      production_start: form.production_start || null,
      estimated_completion: form.estimated_completion || null,
      ship_date: form.ship_date || null,
      customer_email: form.customer_email || null,
      customer_phone: form.customer_phone || null,
      additional_comments: form.additional_comments || null,
      purchase_order_url: form.purchase_order_url || null,
      packing_slip_url: form.packing_slip_url || null,
      bol: form.bol || null,
      total_amount: form.total_amount ? parseFloat(form.total_amount) : 0,
      monday_item_id: form.monday_item_id || null,
    }

    let orderId = editingOrder?.id
    if (editingOrder) {
      const { error: e1 } = await sb.from('sales_orders').update({ ...basePayload, ...extPayload }).eq('id', editingOrder.id)
      if (e1?.message?.includes('column')) {
        const fb = await sb.from('sales_orders').update(basePayload).eq('id', editingOrder.id)
        if (fb.error) { setErr(fb.error.message); setSaving(false); return }
      } else if (e1) { setErr(e1.message); setSaving(false); return }
    } else {
      const { data: d0, error: e2 } = await sb.from('sales_orders').insert({ ...basePayload, ...extPayload }).select('id').single()
      let data = d0
      if (e2?.message?.includes('column')) {
        const fb = await sb.from('sales_orders').insert(basePayload).select('id').single()
        if (fb.error) { setErr(fb.error.message); setSaving(false); return }
        data = fb.data
      } else if (e2) { setErr(e2.message); setSaving(false); return }
      orderId = data?.id
    }

    if (!orderId) { setErr('Could not get order ID'); setSaving(false); return }

    // Delete existing lines for this order (will re-insert all)
    if (editingOrder) {
      await sb.from('sales_order_lines').delete().eq('sales_order_id', orderId)
    }

    // Insert all lines
    for (let i = 0; i < editLines.length; i++) {
      const line = editLines[i]
      if (!line.sku && !line.description) continue
      const prod = products.find(p => p.sku === line.sku)
      const baseLine: Record<string,any> = {
        sales_order_id: orderId,
        product_id: line.product_id ?? prod?.id ?? null,
        sku: line.sku || null,
        description: line.description || prod?.product_name || null,
        quantity: parseFloat(line.quantity) || 1,
        quantity_shipped: parseFloat(line.completed_qty) || 0,
        unit_of_measure: line.unit_of_measure || null,
        unit_price: prod?.unit_cost ?? 0,
        line_number: i + 1,
        discount_pct: 0,
      }
      const extLine: Record<string,any> = {
        completed_qty: parseFloat(line.completed_qty) || 0,
        packaging: line.packaging || null,
        production_status: line.production_status || null,
        added_details: line.added_details || null,
        sku_flagged: !line.sku,
      }
      const lRes = await sb.from('sales_order_lines').insert({ ...baseLine, ...extLine })
      if (lRes.error?.message?.includes('column')) {
        await sb.from('sales_order_lines').insert(baseLine)
      }
    }

    setSaving(false); setEditOpen(false); setEditingOrder(null); load()
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this order and all line items?')) return
    await sb.from('sales_order_lines').delete().eq('sales_order_id', id)
    await sb.from('sales_orders').delete().eq('id', id)
    setEditOpen(false); load()
  }

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
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${orders.length} orders`}</p>
        </div>
        <button onClick={openAdd}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
          New Order
        </button>
      </div>

      {/* Stats bar */}
      {!loading && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
          <Stat label="Total Orders" value={String(tabPool.length)}/>
          <Stat label="In Production" value={String(stats.inProd)} accent="text-amber-400"/>
          <Stat label="Ready to Ship" value={String(stats.ready)} accent="text-teal-400"/>
          <Stat label="On Hold" value={String(stats.onHold)} accent={stats.onHold > 0 ? 'text-red-400' : 'text-white'}/>
          <Stat label="Total Value" value={fmt$(stats.totalVal) ?? '—'} accent="text-emerald-400"/>
          <Stat label="Flagged Lines" value={String(stats.flaggedTotal)} accent={stats.flaggedTotal > 0 ? 'text-amber-400' : 'text-white'} sub="need SKU"/>
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
        <input placeholder="Search customer, PO#, order name…" value={search} onChange={e => setSearch(e.target.value)}
          className="w-full bg-gray-900 border border-gray-800 text-white placeholder-gray-600 rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"/>
        {search && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">{filtered.length}</span>}
      </div>

      {/* Orders table */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <svg className="w-5 h-5 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-gray-500 py-20 text-sm">No orders found.</p>
        ) : (
          <table className="w-full min-w-[1200px] text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="w-8 px-3 py-3"/>
                {['Customer / Order','Section','PO #','Status','Facility','Order Date','Est. Complete','Ship Date','Value','Lines','⚠','Actions'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 px-3 py-3 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((order, i) => {
                const expanded = expandedIds.has(order.id)
                const flagged = flaggedMap[order.id] ?? 0
                const custName = orderCustomerName(order)
                const ref = orderRef(order)
                return (
                  <>
                    <tr key={order.id}
                      className={`border-b border-gray-800/60 transition-colors cursor-pointer ${expanded ? 'bg-gray-800/30' : i % 2 === 1 ? 'bg-gray-800/10 hover:bg-gray-800/30' : 'hover:bg-gray-800/30'}`}
                      onClick={() => toggleExpand(order.id)}>
                      {/* Expand toggle */}
                      <td className="px-3 py-3.5">
                        <svg className={`w-3.5 h-3.5 text-gray-500 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
                      </td>
                      {/* Customer / Order Name */}
                      <td className="px-3 py-3.5 max-w-[200px]">
                        <p className="text-white font-semibold text-sm truncate">{custName}</p>
                        {ref && <p className="text-gray-500 text-xs truncate mt-0.5">{ref}</p>}
                      </td>
                      <td className="px-3 py-3.5">
                        {order.order_section && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-400 border border-gray-700 whitespace-nowrap">{order.order_section}</span>
                        )}
                      </td>
                      <td className="px-3 py-3.5 text-gray-400 text-xs font-mono whitespace-nowrap">{order.po_number ?? '—'}</td>
                      <td className="px-3 py-3.5"><StatusBadge status={order.status}/></td>
                      <td className="px-3 py-3.5 text-gray-500 text-xs whitespace-nowrap">{order.facility ?? order.carrier ?? '—'}</td>
                      <td className="px-3 py-3.5 text-gray-400 text-xs whitespace-nowrap">{fmtD(order.order_date)}</td>
                      <td className="px-3 py-3.5 text-gray-400 text-xs whitespace-nowrap">{fmtD(order.estimated_completion)}</td>
                      <td className="px-3 py-3.5 text-gray-400 text-xs whitespace-nowrap">{fmtD(order.ship_date ?? order.required_ship_date)}</td>
                      <td className="px-3 py-3.5 text-gray-300 text-xs font-medium whitespace-nowrap">{fmt$(orderValue(order))}</td>
                      <td className="px-3 py-3.5 text-gray-600 text-xs">—</td>
                      <td className="px-3 py-3.5">
                        {flagged > 0 && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20 font-medium whitespace-nowrap" title={`${flagged} line items need SKU`}>
                            ⚠ {flagged}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3.5" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEdit(order)}
                            className="text-xs px-2 py-1 rounded bg-blue-700/50 hover:bg-blue-700 text-blue-300 transition-colors">Edit</button>
                          <button onClick={() => handleDelete(order.id)}
                            className="text-xs px-2 py-1 rounded bg-red-900/40 hover:bg-red-900/70 text-red-400 transition-colors">Del</button>
                        </div>
                      </td>
                    </tr>

                    {/* Expanded line items */}
                    {expanded && (
                      <>
                        <tr className="border-b border-gray-800/40 bg-gray-950/40">
                          <td colSpan={13} className="px-0 py-0">
                            <div className="ml-8 mr-2 my-1">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="bg-gray-800/40">
                                    {['⚠','#','SKU','Product / Description','Qty','Done','UOM','Packaging','Prod. Status','Details','Progress'].map(h => (
                                      <th key={h} className="text-left text-gray-600 px-2 py-2 font-medium first:pl-12">{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  <LinesTable orderId={order.id} onLineUpdated={() => {
                                    load() // refresh flagged counts
                                  }}/>
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      </>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <EditPanel
        open={editOpen}
        editing={editingOrder}
        form={form} setForm={setForm}
        editLines={editLines} setEditLines={setEditLines}
        customers={customers} products={products}
        err={err} saving={saving}
        onClose={() => { setEditOpen(false); setEditingOrder(null) }}
        onSave={save}
        onDelete={() => editingOrder && handleDelete(editingOrder.id)}
      />
    </div>
  )
}
