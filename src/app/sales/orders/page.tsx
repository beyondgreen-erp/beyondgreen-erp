'use client'
import ShareLink from '@/components/ShareLink'
import { useItemDeepLink } from '@/components/useItemDeepLink'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { buildCaseLabels, loadBarcodePng, type CaseLabel } from '@/lib/shipping/labels'
import { useMultiSelect } from '@/hooks/useMultiSelect'
import BulkActionBar from '@/components/BulkActionBar'
import { WorkflowProgressBar } from '@/components/WorkflowMover'
import { onStatusChange, undoFlow, logActivity, type OrderStatus } from '@/lib/orderFlow'
import UndoToast from '@/components/UndoToast'
import Comments from '@/components/Comments'
import FileUpload from '@/components/FileUpload'
import InventoryCheckModal from '@/components/InventoryCheckModal'
import { statusColor } from '@/lib/statusColors'
import { generateOrderPDF, generatePackingSlip, type PDFLine, type PDFOrder, type PDFCustomer } from '@/lib/pdfHelpers'
import PoExtractUpload from '@/components/PoExtractUpload'
import WalmartBoard from '@/components/WalmartBoard'
import { orderDisplayName } from '@/lib/orderName'

// ── Types ──────────────────────────────────────────────────────────────────
interface SalesOrder {
  id: string
  order_number: string
  status: string
  notes: string | null
  po_number: string | null
  monday_item_id: string | null
  order_section: string | null
  board_position?: number | null
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
  billing_address: string | null
  additional_comments: string | null
  purchase_order_url: string | null
  packing_slip_url: string | null
  bol: string | null
  total_amount: number | null
  total: number | null
  subtotal: number | null
  terms?: string | null
  payment_terms?: string | null
  fob?: string | null
  sales_rep?: string | null
  client_portal_visible?: boolean | null
  client_portal_name?: string | null
  broker_cost?: number | null
  broker_commission_basis?: string | null
  broker_commission_paid?: boolean | null
  broker_commission_status?: string | null
  customer?: { id: string; company_name: string; email?: string | null; phone?: string | null; city?: string | null; state?: string | null } | null
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

interface Product { id: string; sku: string; product_name: string; unit_cost: number | null; wholesale_price: number | null; msrp: number | null; unit_of_measure: string | null; our_part_number: string | null; supplier_part_number: string | null }
interface Customer { id: string; company_name: string }

// ── Constants ──────────────────────────────────────────────────────────────
const SECTIONS = ['Walmart','Chewy','Make To Stock','Private Label','Straw Orders','Customer DropShip','Injection Molding','Paper Products','Outsourced']
const SECTION_TABS = ['All', ...SECTIONS]
const SECTION_COLORS: Record<string,string> = { 'Walmart':'#0071CE','Chewy':'#1C49C2','Make To Stock':'#037f4c','Private Label':'#784bd1','Straw Orders':'#ff6d3b','Customer DropShip':'#216edf','Injection Molding':'#bb3354','Paper Products':'#cab641','Outsourced':'#7e3b8a' }
const STATUSES = [
  'Pending','Pending Lead Time','Confirmed','Awaiting BOM Components',
  'Production Queue','In Production','QC','Ready for Packing Slip',
  'Ready to Ship','Ready at Will Call',
  'Partially Shipped','Ready for Invoice','Shipped','Completed',
  'On Hold','Cancelled','Closed',
]
const STATUS_COLORS: Record<string,string> = {
  Pending:             'bg-[#F3F4F6] text-gray-600 border-[#E4E6EE]',
  Confirmed:           'bg-blue-500/15 text-blue-400 border-blue-500/20',
  'Production Queue':  'bg-orange-500/15 text-orange-500 border-orange-500/20',
  'In Production':     'bg-amber-500/15 text-amber-500 border-amber-500/20',
  QC:                  'bg-violet-500/15 text-violet-500 border-violet-500/20',
  'Ready to Ship':     'bg-teal-500/15 text-teal-400 border-teal-500/20',
  Shipped:             'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  'On Hold':           'bg-red-500/15 text-red-400 border-red-500/20',
  'Partially Shipped': 'bg-violet-500/15 text-violet-400 border-violet-500/20',
  'Pending Lead Time': 'bg-amber-500/15 text-amber-500 border-amber-500/20',
  'Ready for Packing Slip': 'bg-cyan-500/15 text-cyan-500 border-cyan-500/20',
  'Ready for Invoice': 'bg-indigo-500/15 text-indigo-500 border-indigo-500/20',
  Completed:           'bg-emerald-500/15 text-emerald-500 border-emerald-500/20',
  Closed:              'bg-[#F3F4F6] text-gray-500 border-[#E4E6EE]',
}
const fmt$ = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
const fmtD = (d: string | null) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const inp = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition'

interface PortalClient { id: string; customer_id: string | null; company_name: string | null; name: string | null; email: string | null }
function portalCustomerOptions(portals: PortalClient[]): { customer_id: string; label: string }[] {
  const seen = new Set<string>(); const out: { customer_id: string; label: string }[] = []
  for (const p of portals) { if (!p.customer_id || seen.has(p.customer_id)) continue; seen.add(p.customer_id); out.push({ customer_id: p.customer_id, label: p.company_name || p.name || p.email || 'Client' }) }
  return out.sort((a, b) => a.label.localeCompare(b.label))
}

// ── Helpers ────────────────────────────────────────────────────────────────
function orderCustomerName(o: SalesOrder): string {
  const typed = (o.notes ?? '').trim()
  if (typed) return typed.split('|')[0].trim()
  if (o.customer?.company_name) return o.customer.company_name
  return (o.order_number ?? '').split('|')[0].trim()
}
function orderRef(o: SalesOrder): string | null {
  const notes = o.notes ?? ''
  const parts = notes.split('|')
  return parts.length > 1 ? parts.slice(1).join('|').trim() : null
}
// Full order name for the board/table title: the whole typed name (kept intact, not split on "|").
function orderTitle(o: SalesOrder): string {
  // Composed board/table name: linked customer · PO # · Ship City (fallbacks handled in helper).
  return orderDisplayName(o)
}
function orderValue(o: SalesOrder): number {
  return o.total_amount ?? o.total ?? o.subtotal ?? 0
}
// Ship-date urgency: within 7 days -> amber→red gradient; past due -> overdue (blink + critical banner).
function shipUrgency(o: SalesOrder): { level: 'overdue' | 'soon'; days: number } | null {
  const d = (o as any).required_ship_date || (o as any).ship_date
  if (!d) return null
  const t = new Date(); t.setHours(0, 0, 0, 0)
  const ship = new Date(String(d) + 'T00:00:00'); if (isNaN(ship.getTime())) return null
  const days = Math.round((ship.getTime() - t.getTime()) / 86400000)
  if (days < 0) return { level: 'overdue', days }
  if (days <= 7) return { level: 'soon', days }
  return null
}
function urgencyStyle(u: { level: string; days: number } | null): React.CSSProperties {
  if (!u) return {}
  if (u.level === 'overdue') return { background: 'rgba(226,68,92,0.14)', borderLeft: '4px solid #E2445C' }
  const frac = Math.max(0, Math.min(1, u.days / 7)) // 1 => 7 days out (amber), 0 => due today (red)
  const hue = 45 * frac
  return { background: `hsla(${hue}, 92%, 50%, 0.13)`, borderLeft: `4px solid hsl(${hue}, 90%, 48%)` }
}

function StatusBadge({ status }: { status: string }) {
  const c = statusColor(status)
  const pulse = status === 'Production Queue' || status === 'In Production' || status === 'QC'
  return (
    <span className="mon-pill" style={{ background: c.bg, color: c.fg }}>
      <span className={`w-1.5 h-1.5 rounded-full ${pulse ? 'animate-pulse' : ''}`} style={{ background: c.solid }} />
      {status}
    </span>
  )
}

function Stat({ label, value, c, sub }: { label: string; value: string; c?: string; sub?: string }) {
  return (
    <div className="mon-stat stat-card" style={c ? ({ ['--c']: c } as any) : undefined}>
      <p className="text-xs font-semibold text-gray-400">{label}</p>
      <p className="mon-stat-val mt-0.5">{value}</p>
      {sub && <p className="text-xs mt-0.5 text-gray-400">{sub}</p>}
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
      const { data } = await sb.from('products').select('id,sku,product_name,unit_cost,wholesale_price,msrp,unit_of_measure,our_part_number,supplier_part_number').or(`sku.ilike.%${q}%,product_name.ilike.%${q}%`).limit(8)
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
    await sb.from('sales_order_lines').update({ sku: p.sku, product_id: p.id, sku_flagged: false, description: p.product_name, unit_price: (p.wholesale_price ?? p.msrp ?? p.unit_cost) ?? 0 }).eq('id', lineId)
    onAssigned(p.sku, p.id)
    setQ(''); setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search SKU…"
        onFocus={() => q && setOpen(true)}
        className="bg-[#F9FAFB] border border-amber-500/40 text-[#1A1D2E] placeholder-[#9CA3AF] rounded px-2 py-1 text-xs w-36 focus:outline-none focus:ring-1 focus:ring-amber-500 transition"/>
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-[#E4E6EE] rounded-lg shadow-xl z-20 w-72 overflow-hidden">
          {results.map(p => (
            <button key={p.id} onMouseDown={() => assign(p)}
              className="w-full text-left px-3 py-2 text-xs border-b border-[#E4E6EE] last:border-0 hover:bg-[#F5F6FA] transition-colors">
              <span className="text-emerald-400 font-mono font-bold">{p.sku}</span>
              <span className="text-[#374151] ml-2">{p.product_name}</span>
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
          <tr key={line.id} className="bg-[#F0F2F7] border-b border-[#E4E6EE]/40 last:border-0">
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
            <td className="px-2 py-2.5 text-gray-500 text-xs max-w-[180px] truncate">{line.description ?? line.added_details ?? '—'}</td>
            <td className="px-2 py-2.5 text-gray-500 text-xs font-semibold">{qty}</td>
            <td className={`px-2 py-2.5 text-xs font-medium ${pct === 100 ? 'text-emerald-400' : pct > 0 ? 'text-blue-400' : 'text-gray-600'}`}>{done}</td>
            <td className="px-2 py-2.5 text-gray-500 text-xs">{line.unit_of_measure ?? '—'}</td>
            <td className="px-2 py-2.5 text-gray-500 text-xs">{line.packaging ?? '—'}</td>
            <td className="px-2 py-2.5">
              {line.production_status && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-[#F5F6FA]/50 text-gray-400 border border-[#E4E6EE] whitespace-nowrap">{line.production_status}</span>
              )}
            </td>
            <td className="px-2 py-2.5 text-gray-600 text-xs max-w-[160px] truncate">{line.added_details ?? '—'}</td>
            <td className="px-2 py-2.5 w-24">
              <div className="flex items-center gap-1.5">
                <div className="flex-1 bg-[#F9FAFB] rounded-full h-1.5 overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-400' : pct > 0 ? 'bg-blue-500' : 'bg-[#F5F6FA]'}`}
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
  notes: '', order_section: '', order_number: '', po_number: '', status: 'Pending', facility: '',
  monday_item_id: '', order_date: '', production_start: '', estimated_completion: '',
  ship_date: '', customer_id: '', customer_label: '', customer_email: '', customer_phone: '',
  shipping_address: '', billing_address: '', total_amount: '', purchase_order_url: '', packing_slip_url: '',
  bol: '', additional_comments: '',
  terms: 'Net 30', fob: 'Santa Ana', sales_rep: 'RP',
  client_portal_visible: false, client_portal_name: '',
  broker_cost: '', broker_commission_basis: 'po_7', broker_commission_paid: false, broker_commission_status: 'waiting_customer',
}
type F = typeof emptyForm

// Draft autosave key for new (unsaved) orders.
const DRAFT_KEY = 'bg_neworder_draft_v1'

// Format a US phone as (xxx) xxx-xxxx, progressively while typing.
function fmtPhone(v: string): string {
  const d = (v || '').replace(/\D/g, '').slice(0, 10)
  if (d.length < 4) return d
  if (d.length < 7) return `(${d.slice(0,3)}) ${d.slice(3)}`
  return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
}

interface EditLineState {
  _key: string
  id?: string
  sku: string
  our_part_number: string
  supplier_part_number: string
  description: string
  quantity: string
  completed_qty: string
  unit_of_measure: string
  unit_price: string
  packaging: string
  production_status: string
  added_details: string
  sku_flagged: boolean
  product_id: string | null
}

function PriceHint({ sku }: { sku: string }) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [hist, setHist] = useState<{ order_number: string; customer_name: string | null; order_date: string | null; unit_price: number }[]>([])
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const s = (sku || '').trim()
    if (!s) { setHist([]); return }
    let active = true
    const t = setTimeout(async () => {
      const { data } = await sb.rpc('sku_price_history', { p_sku: s, p_limit: 5 })
      if (active) setHist((data as any[]) || [])
    }, 350)
    return () => { active = false; clearTimeout(t) }
  }, [sku, sb])
  if (!hist.length) return null
  const last = hist[0]
  const fmtD = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
  return (
    <div className="text-[11px] text-gray-500 flex items-center gap-2 flex-wrap">
      <span>Last sold: <span className="font-semibold text-[#00863F]">${Number(last.unit_price).toFixed(2)}</span>{last.customer_name ? ` · ${last.customer_name}` : ''}{last.order_date ? ` · ${fmtD(last.order_date)}` : ''}</span>
      {hist.length > 1 && <button type="button" onClick={() => setOpen(o => !o)} className="text-[#3B6FE0] hover:underline">{open ? 'hide' : `+${hist.length - 1} more`}</button>}
      {open && (
        <div className="w-full mt-0.5 space-y-0.5">
          {hist.slice(1).map((h, i) => (
            <div key={i} className="text-gray-400">${Number(h.unit_price).toFixed(2)} · {h.customer_name || '—'} · {fmtD(h.order_date)} · {h.order_number}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function VersionHistory({ orderId }: { orderId: string }) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [vers, setVers] = useState<{ version_no: number; total: number | null; status: string | null; changed_by: string | null; created_at: string }[]>([])
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!orderId) return
    sb.from('sales_order_versions').select('version_no,total,status,changed_by,created_at').eq('sales_order_id', orderId).order('version_no', { ascending: false })
      .then(({ data }) => setVers((data as any[]) || []))
  }, [orderId, sb, open])
  if (!vers.length) return null
  const fmt = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const money = (n: number | null) => n != null ? '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
  return (
    <div className="pt-4 border-t border-[#E4E6EE]">
      <button type="button" onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-[#1A1D2E]">
        <span>Version history</span>
        <span className="text-[10px] font-normal normal-case text-gray-400">({vers.length} · latest V{vers[0].version_no})</span>
        <svg className={"w-3 h-3 transition-transform " + (open ? "rotate-90" : "")} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
      </button>
      {open && (
        <div className="mt-2 space-y-1">
          {vers.map(v => (
            <div key={v.version_no} className="grid grid-cols-[auto_1fr_1fr_1fr_auto] gap-2 items-center text-[11px] text-gray-500 border border-[#E4E6EE] rounded-lg px-3 py-1.5">
              <span className="font-semibold text-[#1A1D2E]">V{v.version_no}</span>
              <span className="tabular-nums">{money(v.total)}</span>
              <span className="truncate">{v.status || "—"}</span>
              <span className="text-gray-400 truncate">{v.changed_by ? v.changed_by.split("@")[0] : "—"}</span>
              <span className="text-gray-400 whitespace-nowrap">{fmt(v.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function LastInvoice({ customerId }: { customerId: string }) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [inv, setInv] = useState<{ invoice_display: string; invoice_date: string | null; total_amount: number | null; status: string | null } | null>(null)
  useEffect(() => {
    if (!customerId) { setInv(null); return }
    sb.rpc('last_customer_invoice', { p_customer: customerId }).then(({ data }) => setInv((data && (data as any[])[0]) || null))
  }, [customerId, sb])
  if (!inv) return null
  const fmtD = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
  const money = (n: number | null) => n != null ? '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''
  return (
    <div className="text-[11px] text-gray-500 border border-[#E4E6EE] rounded-lg px-3 py-2 bg-[#F9FAFB]/60">
      Last invoice: <span className="font-semibold text-[#1A1D2E]">{inv.invoice_display}</span>{inv.total_amount != null ? ' · ' + money(inv.total_amount) : ''}{inv.invoice_date ? ' · ' + fmtD(inv.invoice_date) : ''}{inv.status ? ' · ' + inv.status : ''}
    </div>
  )
}

function EditPanel({
  open, editing, form, setForm, editLines, setEditLines,
  customers, products, portals, err, saving, onClose, onSave, onDelete, onDuplicate, onDownloadSalesOrder, onSearchLeads, userEmail,
}: {
  open: boolean
  editing: SalesOrder | null
  form: F
  setForm: React.Dispatch<React.SetStateAction<F>>
  editLines: EditLineState[]
  setEditLines: React.Dispatch<React.SetStateAction<EditLineState[]>>
  customers: Customer[]
  products: Product[]
  portals: PortalClient[]
  err: string
  saving: boolean
  onClose: () => void
  onSave: () => void
  onDelete: () => void
  onDuplicate: () => void
  onDownloadSalesOrder: () => void
  onSearchLeads: (q: string) => Promise<{ id: string; company_name: string }[]>
  userEmail: string
}) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [skuDropdown, setSkuDropdown] = useState<number | null>(null)
  const [skuQ, setSkuQ] = useState('')
  // Customer / lead linking
  const [custMode, setCustMode] = useState<'customer' | 'lead'>('customer')
  const [custQ, setCustQ] = useState('')
  const [custOpen, setCustOpen] = useState(false)
  const [leadQ, setLeadQ] = useState('')
  const [leadResults, setLeadResults] = useState<{ id: string; company_name: string }[]>([])
  const [leadSearching, setLeadSearching] = useState(false)
  const [pickedLead, setPickedLead] = useState(false)
  useEffect(() => {
    if (open) { setCustMode('customer'); setCustQ(''); setCustOpen(false); setLeadQ(''); setLeadResults([]); setPickedLead(false) }
  }, [open, editing])
  useEffect(() => {
    if (custMode !== 'lead') return
    const q = leadQ.trim()
    if (q.length < 2) { setLeadResults([]); setLeadSearching(false); return }
    let active = true
    setLeadSearching(true)
    const t = setTimeout(async () => {
      const res = await onSearchLeads(q)
      if (active) { setLeadResults(res); setLeadSearching(false) }
    }, 250)
    return () => { active = false; clearTimeout(t) }
  }, [leadQ, custMode, onSearchLeads])
  const custMatches = customers.filter(c => c.company_name.toLowerCase().includes(custQ.toLowerCase())).slice(0, 50)
  async function pickCustomer(c: Customer) {
    setForm(p => ({ ...p, customer_id: c.id, customer_label: c.company_name })); setPickedLead(false); setCustOpen(false); setCustQ('')
    // Autofill contact + address from the saved customer record (only fills fields left blank).
    const { data: cd } = await sb.from('customers').select('email,phone,billing_address,shipping_address').eq('id', c.id).maybeSingle()
    if (cd) setForm(p => ({
      ...p,
      customer_email: p.customer_email || (cd as any).email || '',
      customer_phone: p.customer_phone || fmtPhone((cd as any).phone || ''),
      billing_address: p.billing_address || (cd as any).billing_address || '',
      shipping_address: p.shipping_address || (cd as any).shipping_address || '',
    }))
  }
  function pickLead(l: { id: string; company_name: string }) { setForm(p => ({ ...p, customer_id: l.id, customer_label: l.company_name })); setPickedLead(true); setLeadQ(''); setLeadResults([]) }
  function clearLinkedCustomer() { setForm(p => ({ ...p, customer_id: '', customer_label: '' })); setPickedLead(false) }
  const skuMatches = products.filter(p => {
    if (skuQ.length === 0) return false
    const q = skuQ.toLowerCase()
    return p.sku.toLowerCase().includes(q)
      || (p.product_name || '').toLowerCase().includes(q)
      || (p.our_part_number || '').toLowerCase().includes(q)
      || (p.supplier_part_number || '').toLowerCase().includes(q)
  }).slice(0, 8)

  // ── Autosave draft (new orders only) ─────────────────────────
  const [draftAvail, setDraftAvail] = useState<{ savedAt: number } | null>(null)
  const orderHasContent = !!(form.customer_label || form.customer_email || form.customer_phone || form.billing_address || form.shipping_address || form.notes || form.po_number) || editLines.some(l => l.sku || l.description || (l.unit_price && l.unit_price !== ''))
  useEffect(() => {
    if (!open || editing) { setDraftAvail(null); return }
    try { const raw = localStorage.getItem(DRAFT_KEY); if (raw) { const d = JSON.parse(raw); if (d && d.form) setDraftAvail({ savedAt: d.savedAt || Date.now() }) } } catch { /* ignore */ }
  }, [open, editing])
  useEffect(() => {
    if (!open || editing || !orderHasContent) return
    const t = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ form, editLines, savedAt: Date.now() })) } catch { /* ignore */ } }, 600)
    return () => clearTimeout(t)
  }, [form, editLines, open, editing, orderHasContent])
  function restoreDraft() {
    try { const raw = localStorage.getItem(DRAFT_KEY); if (raw) { const d = JSON.parse(raw); if (d && d.form) { setForm({ ...d.form, order_number: form.order_number }); if (Array.isArray(d.editLines)) setEditLines(d.editLines) } } } catch { /* ignore */ }
    setDraftAvail(null)
  }
  function discardDraft() { try { localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ } setDraftAvail(null) }

  function addLine(preset?: Partial<EditLineState>) {
    setEditLines(ls => [...ls, { _key: Math.random().toString(36).slice(2), sku: '', our_part_number: '', supplier_part_number: '', description: '', quantity: '1', completed_qty: '0', unit_of_measure: '', unit_price: '', packaging: '', production_status: '', added_details: '', sku_flagged: false, product_id: null, ...preset }])
  }
  function removeLine(key: string) { setEditLines(ls => ls.filter(l => l._key !== key)) }
  function updateLine(key: string, patch: Partial<EditLineState>) { setEditLines(ls => ls.map(l => l._key === key ? { ...l, ...patch } : l)) }
  // Auto-calculate the order total from the line items (qty × unit price).
  const linesTotal = editLines.reduce((sum, l) => sum + (parseFloat(l.quantity) || 0) * (parseFloat(l.unit_price) || 0), 0)
  const autoTotalRef = useRef<string>('')
  useEffect(() => {
    const v = linesTotal > 0 ? String(Number(linesTotal.toFixed(2))) : ''
    setForm(p => {
      // Only auto-fill when the user hasn't manually diverged from the auto value.
      if (p.total_amount === '' || p.total_amount === autoTotalRef.current) { autoTotalRef.current = v; return { ...p, total_amount: v } }
      return p
    })
  }, [linesTotal, setForm])
  // Ship-To: saved addresses for the selected customer (email suggestion — multi-location dropdown).
  const [shipAddrs, setShipAddrs] = useState<{ id: string; label: string | null; address: string }[]>([])
  useEffect(() => {
    if (!form.customer_id) { setShipAddrs([]); return }
    sb.from('customer_ship_addresses').select('id,label,address').eq('customer_id', form.customer_id).order('created_at', { ascending: true })
      .then(({ data }) => setShipAddrs((data as any[]) || []))
  }, [form.customer_id])
  async function saveShipAddr() {
    const addr = (form.shipping_address || '').trim()
    if (!addr || !form.customer_id) return
    if (shipAddrs.some(a => (a.address || '').trim() === addr)) return
    const { data } = await sb.from('customer_ship_addresses').insert({ customer_id: form.customer_id, address: addr }).select('id,label,address').single()
    if (data) setShipAddrs(a => [...a, data as any])
  }
  const dragLineKey = useRef<string | null>(null)
  function reorderLine(toKey: string) {
    const from = dragLineKey.current; dragLineKey.current = null
    if (!from || from === toKey) return
    setEditLines(ls => {
      const arr = [...ls]
      const fi = arr.findIndex(l => l._key === from)
      const ti = arr.findIndex(l => l._key === toKey)
      if (fi < 0 || ti < 0) return ls
      const [m] = arr.splice(fi, 1)
      arr.splice(ti, 0, m)
      return arr
    })
  }

  return (
    <>
      <div onClick={onClose}
        className={`fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        style={{ background: 'rgba(26,32,53,0.48)', backdropFilter: 'blur(3px)' }}>
      <div onClick={e => e.stopPropagation()}
        className={`relative w-full max-w-[660px] my-4 bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden transition-all duration-200 ${open ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-3 scale-95 pointer-events-none'}`}
        style={{ maxHeight: 'calc(100vh - 32px)' }}>
        <div className="mon-modal-head shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg truncate">{editing ? (editing.order_number || 'Order') : 'New Order'}</h2>
            {editing && <p className="text-white/80 text-xs mt-0.5 truncate">{orderCustomerName(editing)}</p>}
            {editing && <StatusBadge status={editing.status} />}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {editing && <ShareLink id={editing.id} className="inline-flex items-center gap-1.5 text-xs font-medium text-white/90 hover:text-white border border-white/30 hover:border-white/60 bg-white/10 px-2.5 py-1.5 rounded-lg transition-colors shrink-0" />}
            <button onClick={onClose} className="mon-modal-close" aria-label="Close">×</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {draftAvail && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <span>Unsaved draft from {new Date(draftAvail.savedAt).toLocaleString()}. Restore it?</span>
              <span className="flex gap-2 shrink-0">
                <button type="button" onClick={restoreDraft} className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-600 text-white font-semibold">Restore</button>
                <button type="button" onClick={discardDraft} className="px-2.5 py-1 rounded bg-white border border-amber-300 hover:bg-amber-100 text-amber-700 font-semibold">Discard</button>
              </span>
            </div>
          )}
          {/* Workflow Progress */}
          {editing && (
            <div className="bg-[#F5F6FA] rounded-xl px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider mb-3">Workflow</p>
              <WorkflowProgressBar status={editing.status}/>
            </div>
          )}

          {/* Awaiting BOM Components → link to the Purchase Order Request board */}
          {editing && form.status === 'Awaiting BOM Components' && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-xs font-semibold text-amber-800 mb-1">⏳ Awaiting BOM Components</p>
              <p className="text-xs text-amber-700 mb-2">Components for this order are on the Purchase Order Request board.</p>
              <a href={`/sales/purchase-orders?q=${encodeURIComponent(editing.po_number || editing.order_number || '')}`}
                className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800 underline hover:text-amber-900">
                View ordered items on the Purchase Order Request board →
              </a>
            </div>
          )}

          {/* Partially Shipped → note with the partial shipped quantity */}
          {editing && form.status === 'Partially Shipped' && (() => {
            const ordered = editLines.reduce((s, l) => s + (parseFloat(l.quantity) || 0), 0)
            const shipped = editLines.reduce((s, l) => s + (parseFloat(l.completed_qty) || 0), 0)
            const remaining = Math.max(0, ordered - shipped)
            return (
              <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
                <p className="text-xs font-semibold text-violet-800 mb-1">📦 Partially Shipped</p>
                <p className="text-xs text-violet-700">
                  {shipped.toLocaleString()} of {ordered.toLocaleString()} units shipped
                  {remaining > 0 ? ` — ${remaining.toLocaleString()} remaining to ship.` : '.'}
                </p>
              </div>
            )
          })()}

          {/* Order Info */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-3">Order Info</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Order Name / Customer <span className="text-gray-300">(optional)</span></label>
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
                    {(STATUSES.includes(form.status) ? STATUSES : [...STATUSES, form.status]).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">SO # <span className="normal-case text-gray-300">(auto if blank)</span></label>
                  <input value={form.order_number} onChange={e => setForm(p => ({ ...p, order_number: e.target.value }))} className={inp} placeholder="Auto-generated"/>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">PO # <span className="normal-case text-gray-300">(customer)</span></label>
                  <input value={form.po_number} onChange={e => setForm(p => ({ ...p, po_number: e.target.value }))} className={inp} placeholder="Customer PO #"/>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Facility</label>
                  <input value={form.facility} onChange={e => setForm(p => ({ ...p, facility: e.target.value }))} className={inp} placeholder="Santa Ana"/>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Terms</label>
                  <input value={form.terms} onChange={e => setForm(p => ({ ...p, terms: e.target.value }))} className={inp} placeholder="Net 30"/>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">FOB</label>
                  <input value={form.fob} onChange={e => setForm(p => ({ ...p, fob: e.target.value }))} className={inp} placeholder="Santa Ana"/>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Sales Rep</label>
                  <input value={form.sales_rep} onChange={e => setForm(p => ({ ...p, sales_rep: e.target.value }))} className={inp} placeholder="RP"/>
                </div>
              </div>
              <div className="rounded-xl border border-[#CDE9DA] bg-[#F0FBF5] p-3">
                <label className="block text-sm font-semibold text-[#0F5132] mb-1.5">Client portal</label>
                {(() => {
                  const portalOpts = portalCustomerOptions(portals)
                  const selVal = form.client_portal_visible ? (form.customer_id || '') : ''
                  const showCurrent = form.client_portal_visible && !!form.customer_id && !portalOpts.some(o => o.customer_id === form.customer_id)
                  return (
                    <select
                      value={selVal}
                      onChange={e => {
                        const cid = e.target.value
                        if (!cid) { setForm(p => ({ ...p, client_portal_visible: false })); return }
                        const opt = portalOpts.find(o => o.customer_id === cid)
                        setForm(p => ({ ...p, client_portal_visible: true, customer_id: cid, customer_label: opt?.label ?? p.customer_label }))
                      }}
                      className={inp + ' cursor-pointer'}
                    >
                      <option value="">— Not shared to a portal —</option>
                      {showCurrent && <option value={form.customer_id}>{(form.customer_label || 'Current customer') + ' (current)'}</option>}
                      {portalOpts.map(o => <option key={o.customer_id} value={o.customer_id}>{o.label}</option>)}
                    </select>
                  )
                })()}
                {portalCustomerOptions(portals).length === 0 && (
                  <p className="text-[11px] text-gray-500 mt-1.5">No client portals yet. Create one under <span className="font-medium">Client Portals</span>, then connect orders here.</p>
                )}
                {form.client_portal_visible && (
                  <div className="mt-2.5">
                    <label className="block text-xs text-gray-500 mb-1.5">Client-facing project name <span className="text-gray-400">(optional)</span></label>
                    <input value={form.client_portal_name} onChange={e => setForm(p => ({ ...p, client_portal_name: e.target.value }))} className={inp} placeholder={`Defaults to ${form.order_number || 'the SO #'}`}/>
                    <p className="text-[11px] text-gray-500 mt-1">Connecting an order links it to that client&rsquo;s portal. They see this name, its live status, and a progress timeline — never internal notes, costs, or comments.</p>
                  </div>
                )}
              </div>
              {(() => {
                const isEco = form.customer_id === '78fd09a2-1e2f-4181-91d7-2b8f44840a74' || (form.customer_label || '').toLowerCase().includes('eco maven')
                if (!isEco) return null
                const selling = parseFloat(form.total_amount || '0') || 0
                const cost = parseFloat(form.broker_cost || '0') || 0
                const commission = form.broker_commission_basis === 'none' ? 0 : form.broker_commission_basis === 'profit_50' ? Math.max(0, selling - cost) * 0.5 : selling * 0.07
                const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                return (
                  <div className="rounded-xl border border-[#CDD9F0] bg-[#F0F5FF] p-3">
                    <label className="block text-sm font-semibold text-[#1E40AF] mb-1.5">💼 Eco Maven broker commission</label>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] text-gray-500 mb-1">Cost we closed at</label>
                        <input type="number" step="0.01" value={form.broker_cost} onChange={e => setForm(p => ({ ...p, broker_cost: e.target.value }))} className={inp} placeholder="0.00" />
                      </div>
                      <div>
                        <label className="block text-[11px] text-gray-500 mb-1">Selling price (order total)</label>
                        <input value={selling ? fmt(selling) : '—'} readOnly className={inp + ' opacity-70'} />
                      </div>
                    </div>
                    <label className="block text-[11px] text-gray-500 mb-1 mt-2">Commission basis</label>
                    <select value={form.broker_commission_basis} onChange={e => setForm(p => ({ ...p, broker_commission_basis: e.target.value }))} className={inp + ' cursor-pointer'}>
                      <option value="po_7">7% of the PO ({fmt(selling * 0.07)})</option>
                      <option value="profit_50">50% of profit ({fmt(Math.max(0, selling - cost) * 0.5)})</option>
                      <option value="none">No commission ($0.00)</option>
                    </select>
                    <div className="mt-2.5">
                      <span className="text-sm text-gray-600">Commission owed: <strong className="text-[#1E40AF]">{fmt(commission)}</strong></span>
                    </div>
                    <label className="block text-[11px] text-gray-500 mb-1 mt-2">Commission status</label>
                    <select value={form.broker_commission_status} onChange={e => setForm(p => ({ ...p, broker_commission_status: e.target.value }))} className={inp + ' cursor-pointer'}>
                      <option value="waiting_customer">Waiting on Customer Payment</option>
                      <option value="paid_by_bg">Paid by beyondGREEN</option>
                    </select>
                    <p className="text-[11px] text-gray-500 mt-1.5">Shows in Eco Maven&rsquo;s portal. Commission still &ldquo;Waiting on Customer Payment&rdquo; adds to their open A/R.</p>
                  </div>
                )
              })()}
            </div>
          </div>

          {/* Dates */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-3">Dates</p>
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
            <p className="text-xs font-semibold uppercase tracking-wider mb-3">Customer Info</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Customer</label>
                {form.customer_id ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 flex items-center gap-2 bg-white border border-[#E4E6EE] rounded-lg px-3 py-2.5 text-sm text-[#1A1D2E] min-w-0">
                      <span className="truncate">{form.customer_label || 'Linked customer'}</span>
                      {pickedLead && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 whitespace-nowrap">Lead → Customer on save</span>}
                    </div>
                    <button type="button" onClick={clearLinkedCustomer} className="text-xs px-3 py-2.5 rounded-lg border border-[#E4E6EE] text-gray-500 hover:text-gray-700 transition-colors whitespace-nowrap">Change</button>
                  </div>
                ) : (
                  <>
                    <div className="inline-flex rounded-lg border border-[#E4E6EE] p-0.5 mb-2">
                      <button type="button" onClick={() => setCustMode('customer')} className={`text-xs px-3 py-1.5 rounded-md transition-colors ${custMode === 'customer' ? 'bg-[#037f4c] text-white' : 'text-gray-500 hover:text-gray-700'}`}>Existing customer</button>
                      <button type="button" onClick={() => setCustMode('lead')} className={`text-xs px-3 py-1.5 rounded-md transition-colors ${custMode === 'lead' ? 'bg-[#037f4c] text-white' : 'text-gray-500 hover:text-gray-700'}`}>Convert a lead (first order)</button>
                    </div>
                    {custMode === 'customer' ? (
                      <div className="relative">
                        <input value={custQ} onChange={e => { setCustQ(e.target.value); setCustOpen(true) }} onFocus={() => setCustOpen(true)} onBlur={() => setTimeout(() => setCustOpen(false), 150)} placeholder="Search customers…" className={inp}/>
                        {custOpen && custQ && (
                          <div className="absolute z-20 mt-1 w-full max-h-56 overflow-auto bg-white border border-[#E4E6EE] rounded-lg shadow-lg">
                            {custMatches.length ? custMatches.map(c => (
                              <button type="button" key={c.id} onMouseDown={e => e.preventDefault()} onClick={() => pickCustomer(c)} className="block w-full text-left px-3 py-2 text-sm text-[#1A1D2E] hover:bg-gray-50 truncate">{c.company_name}</button>
                            )) : <div className="px-3 py-2 text-sm text-gray-400">No matching customers</div>}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="relative">
                        <input value={leadQ} onChange={e => setLeadQ(e.target.value)} placeholder="Search leads to convert…" className={inp}/>
                        {leadQ.trim().length >= 2 && (
                          <div className="absolute z-20 mt-1 w-full max-h-56 overflow-auto bg-white border border-[#E4E6EE] rounded-lg shadow-lg">
                            {leadSearching ? <div className="px-3 py-2 text-sm text-gray-400">Searching…</div>
                              : leadResults.length ? leadResults.map(l => (
                                <button type="button" key={l.id} onMouseDown={e => e.preventDefault()} onClick={() => pickLead(l)} className="block w-full text-left px-3 py-2 text-sm text-[#1A1D2E] hover:bg-gray-50 truncate">{l.company_name}</button>
                              )) : <div className="px-3 py-2 text-sm text-gray-400">No matching leads</div>}
                          </div>
                        )}
                        <p className="text-[11px] text-amber-600 mt-1">Pick a lead — it moves from the Leads board to Customers when you save this order.</p>
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Email</label>
                  <input type="email" value={form.customer_email} onChange={e => setForm(p => ({ ...p, customer_email: e.target.value }))} className={inp}/>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Phone</label>
                  <input value={form.customer_phone} onChange={e => setForm(p => ({ ...p, customer_phone: fmtPhone(e.target.value) }))} inputMode="tel" placeholder="(555) 123-4567" className={inp}/>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Billing Address</label>
                  <textarea rows={2} value={form.billing_address} onChange={e => setForm(p => ({ ...p, billing_address: e.target.value }))} className={inp + ' resize-none'} placeholder="Bill-to address"/>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Shipping Address</label>
                  {form.customer_id && shipAddrs.length > 0 && (
                    <select value="" onChange={e => { if (e.target.value) setForm(p => ({ ...p, shipping_address: e.target.value })) }} className={inp + ' mb-1.5 cursor-pointer'}>
                      <option value="">📍 Choose a saved ship-to address…</option>
                      {shipAddrs.map(a => <option key={a.id} value={a.address}>{(a.label ? a.label + ' — ' : '') + (a.address || '').replace(/\n+/g, ', ').slice(0, 70)}</option>)}
                    </select>
                  )}
                  <textarea rows={2} value={form.shipping_address} onChange={e => setForm(p => ({ ...p, shipping_address: e.target.value }))} className={inp + ' resize-none'} placeholder="Ship-to address"/>
                  {form.customer_id && (form.shipping_address || '').trim() && !shipAddrs.some(a => (a.address || '').trim() === (form.shipping_address || '').trim()) && (
                    <button type="button" onClick={saveShipAddr} className="text-[11px] font-semibold text-[#00863F] hover:underline mt-1">＋ Save this as a ship-to address for this customer</button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Financial */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-3">Financial</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Total Value ($)</label>
                <input type="number" min="0" step="0.01" value={form.total_amount} onChange={e => { autoTotalRef.current = '__manual__'; setForm(p => ({ ...p, total_amount: e.target.value })) }} className={inp}/>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[11px] text-gray-400">Line items total: {fmt$(linesTotal)}</span>
                  <button type="button" onClick={() => { const v = String(Number(linesTotal.toFixed(2))); autoTotalRef.current = v; setForm(p => ({ ...p, total_amount: v })) }} className="text-[11px] font-semibold text-[#00863F] hover:underline">Use line total</button>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">PO Document URL</label>
                <input value={form.purchase_order_url} onChange={e => setForm(p => ({ ...p, purchase_order_url: e.target.value }))} className={inp} placeholder="https://…"/>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">📎 Upload Purchase Order <span className="normal-case text-gray-300">(PDF or image — we&rsquo;ll store it &amp; auto-read the fields)</span></label>
                <PoExtractUpload salesOrderId={editing?.id} onExtracted={(d, p) => setForm(prev => ({
                  ...prev,
                  purchase_order_url: p || prev.purchase_order_url,
                  order_number: d.po_number || prev.order_number,
                  customer_email: d.customer_email || prev.customer_email,
                  shipping_address: d.ship_to_address || prev.shipping_address,
                  order_date: d.order_date || prev.order_date,
                  ship_date: d.ship_date || prev.ship_date,
                  total_amount: (d.total != null ? String(d.total) : prev.total_amount),
                }))}/>
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
            <div className="flex items-center justify-between mb-3 flex-wrap gap-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider">Line Items</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button onClick={() => addLine({ description: 'Freight & Delivery', unit_of_measure: 'ea' })} className="text-xs px-2.5 py-1 rounded bg-[#EEF4FF] hover:bg-[#E0EAFE] text-[#3B6FE0] font-medium transition-colors">+ Freight &amp; Delivery</button>
                <button onClick={() => addLine({ description: 'Sales Tax', unit_of_measure: 'ea' })} className="text-xs px-2.5 py-1 rounded bg-[#EEF4FF] hover:bg-[#E0EAFE] text-[#3B6FE0] font-medium transition-colors">+ Sales Tax</button>
                <button onClick={() => addLine()} className="text-xs px-2.5 py-1 rounded bg-[#F5F6FA] hover:bg-gray-600 text-gray-500 transition-colors">+ Add Line</button>
              </div>
            </div>
            <div className="flex items-start gap-2 text-[11px] rounded-lg px-3 py-2 mb-2 bg-[#EFF6FF] border border-[#DBEAFE] text-[#1D4ED8]">
              <span>🔗</span>
              <span><b>Inventory-linked (Ultron).</b> SKUs pull live from the Inventory board (prices are the set default). A price you set here stays on this order only — Inventory is never overwritten. Brand-new SKUs are added to Inventory on save.</span>
            </div>
            <div className="space-y-2">
              {editLines.map((line, i) => (
                <div key={line._key} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); reorderLine(line._key) }} className={`rounded-lg p-3 border space-y-2 ${line.sku_flagged ? 'border-amber-500/30 bg-amber-950/10' : 'border-[#E4E6EE] bg-[#F9FAFB]/30'}`}>
                  <div className="flex items-center gap-2">
                    <span draggable onDragStart={() => { dragLineKey.current = line._key }} className="text-gray-400 cursor-grab active:cursor-grabbing select-none shrink-0 text-xs" title="Drag to reorder line">&#8942;&#8942;</span>
                    <span className="text-xs text-gray-600 w-4 shrink-0">{i + 1}</span>
                    {/* SKU with typeahead */}
                    <div className="relative flex-1">
                      <input value={skuDropdown === i ? skuQ : (line.sku || '')}
                        onFocus={() => { setSkuDropdown(i); setSkuQ(line.sku || '') }}
                        onBlur={() => setTimeout(() => setSkuDropdown(null), 200)}
                        onChange={e => { setSkuQ(e.target.value); updateLine(line._key, { sku: e.target.value, sku_flagged: !e.target.value }) }}
                        placeholder="SKU"
                        className={`w-full bg-white border ${line.sku_flagged ? 'border-amber-500/40' : 'border-[#E4E6EE]'} text-emerald-400 placeholder-gray-600 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500 transition`}/>
                      {line.product_id
                        ? <span title="Linked to Inventory" className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#10B981', fontSize: '10px' }}>●</span>
                        : (line.sku ? <span title="New SKU — added to Inventory on save" className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#F59E0B', fontSize: '10px' }}>●</span> : null)}
                      {skuDropdown === i && skuMatches.length > 0 && (
                        <div className="absolute top-full left-0 right-0 bg-white border border-[#E4E6EE] rounded-lg shadow-xl z-10 overflow-hidden mt-0.5 max-h-40 overflow-y-auto">
                          {skuMatches.map(p => (
                            <button key={p.id} onMouseDown={() => {
                              updateLine(line._key, { sku: p.sku, description: p.product_name, product_id: p.id, sku_flagged: false, our_part_number: p.our_part_number || line.our_part_number, supplier_part_number: p.supplier_part_number || line.supplier_part_number, unit_price: (() => { const px = p.wholesale_price ?? p.msrp ?? p.unit_cost; return (px != null && !line.unit_price) ? String(px) : line.unit_price })() })
                              setSkuDropdown(null)
                            }} className="w-full text-left px-3 py-2 text-xs border-b border-[#E4E6EE] last:border-0 hover:bg-[#F5F6FA] transition-colors">
                              <span className="text-emerald-400 font-mono font-bold">{p.sku}</span>
                              <span className="text-[#374151] ml-2">{p.product_name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <input value={line.description} onChange={e => updateLine(line._key, { description: e.target.value })}
                      placeholder="Description" className="flex-1 bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 transition"/>
                    <button onClick={() => removeLine(line._key)} className="text-red-400 hover:text-red-300 p-1 rounded hover:bg-red-500/10 transition-colors shrink-0">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {([['quantity','Qty'],['completed_qty','Done'],['unit_of_measure','UOM'],['packaging','Packaging']] as const).map(([key, label]) => (
                      <input key={key} value={(line as any)[key]} onChange={e => updateLine(line._key, { [key]: e.target.value })}
                        placeholder={label} className="bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 transition"/>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2 items-center">
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">$</span>
                      <input value={line.unit_price} onChange={e => updateLine(line._key, { unit_price: e.target.value })} inputMode="decimal"
                        placeholder="Unit price" className="w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded pl-5 pr-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 transition"/>
                    </div>
                    <div className="text-right text-xs text-gray-500 pr-1">
                      Line total: <span className="font-semibold text-[#1A1D2E]">{(() => { const q = parseFloat(line.quantity) || 0; const u = parseFloat(line.unit_price) || 0; return u ? '$' + (q * u).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'; })()}</span>
                    </div>
                  </div>
                  {line.sku && <PriceHint sku={line.sku} />}
                  <div className="grid grid-cols-2 gap-2">
                    <input value={line.production_status} onChange={e => updateLine(line._key, { production_status: e.target.value })}
                      placeholder="Production Status" className="bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 transition"/>
                    <input value={line.added_details} onChange={e => updateLine(line._key, { added_details: e.target.value })}
                      placeholder="Details / Specs" className="bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 transition"/>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input value={line.our_part_number} onChange={e => updateLine(line._key, { our_part_number: e.target.value })}
                      placeholder="Our Part #" className="bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 transition"/>
                    <input value={line.supplier_part_number} onChange={e => updateLine(line._key, { supplier_part_number: e.target.value })}
                      placeholder="Supplier Part #" className="bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 transition"/>
                  </div>
                </div>
              ))}
              {editLines.length === 0 && (
                <p className="text-gray-600 text-xs text-center py-4">No line items. Click &quot;+ Add Line&quot; to add products.</p>
              )}
            </div>
          </div>

          {editing && (
            <div className="pt-4 border-t border-[#E4E6EE]">
              <Comments recordType="sales_order" recordId={editing.id} currentUserEmail={userEmail} title="Comments & @mentions" />
            </div>
          )}
          {editing && (
            <div className="pt-4 border-t border-[#E4E6EE]">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Documents</p>
              <div className="space-y-4">
                {[
                  { rt: 'sales_order_po_copy', label: 'Customer PO' },
                  { rt: 'sales_order_so_copy', label: 'Sales Order copy' },
                  { rt: 'sales_order_artwork', label: 'Artwork files' },
                  { rt: 'sales_order_other', label: 'Other documents' },
                ].map(d => (
                  <div key={d.rt}>
                    <label className="block text-[11px] font-medium text-gray-500 mb-1">{d.label}</label>
                    <FileUpload supabase={sb} recordType={d.rt} recordId={editing.id} currentUserEmail={userEmail} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {editing && <VersionHistory orderId={editing.id} />}
          {form.customer_id && <div className="pt-3"><LastInvoice customerId={form.customer_id} /></div>}
        </div>

        <div className="shrink-0 px-6 py-4 border-t border-[#E4E6EE] space-y-3">
          {err && <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2"><p className="text-red-400 text-xs">{err}</p></div>}
          <div className="flex gap-3">
            {editing && (
              <button onClick={onDelete} className="text-sm px-3 py-2.5 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors" title="Delete">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            )}
            {editing && (
              <button onClick={onDuplicate} disabled={saving} className="text-sm px-3 py-2.5 rounded-lg border border-[#E4E6EE] text-gray-600 hover:bg-[#F0F2F7] disabled:opacity-50 transition-colors inline-flex items-center gap-1.5" title="Duplicate this order">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"/></svg>
                Duplicate
              </button>
            )}
            <button onClick={onClose} className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-[#E4E6EE] text-gray-400 hover:text-gray-700 transition-colors">Cancel</button>
            <button onClick={onDownloadSalesOrder} disabled={!(editing || form.notes.trim() || editLines.some(l => l.sku || l.description))}
              title={(editing || form.notes.trim() || editLines.some(l => l.sku || l.description)) ? 'Download a customer-ready Sales Order PDF' : 'Add an order name or a line item to enable download'}
              className="flex-1 justify-center inline-flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg border border-emerald-600/40 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"/></svg>
              Sales Order
            </button>
            <button onClick={onSave} disabled={saving}
              className="mon-btn flex-1 justify-center !py-2.5">
              {saving ? 'Saving…' : 'Save Order'}
            </button>
          </div>
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
  const [walmartTotal, setWalmartTotal] = useState(0)
  useEffect(() => {
    // Include open Walmart order value in the board's Total Value stat.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sb.from('walmart_board_orders').select('total_value, group_name, archived').eq('archived', false).then(({ data }: any) => {
      const t = ((data as any[]) || []).filter(r => (r.group_name || '') !== 'Cancelled').reduce((s: number, r: any) => s + (Number(r.total_value) || 0), 0)
      setWalmartTotal(t)
    })
  }, [sb])

  // Deep-link: open the item referenced by ?item=<id> in the URL (used by @mention notifications).
  const deepLinkOpenedRef = useRef<string | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const openId = new URLSearchParams(window.location.search).get('item')
    if (!openId || deepLinkOpenedRef.current === openId) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const target = (orders as any[]).find((x) => x && x.id === openId)
    if (target) { deepLinkOpenedRef.current = openId; openEdit(target) }
  }, [orders]) // eslint-disable-line react-hooks/exhaustive-deps
  const [view, setView] = useState<'board'|'table'|'walmart'>('board')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [showEmpty, setShowEmpty] = useState(false)
  const [groupBy, setGroupBy] = useState<'section'|'status'>('section')
  const dragId = useRef<string | null>(null)
  const autoSORef = useRef<string>('')
  const moveOrder = async (id: string, targetSection: string, targetIndex: number) => {
    const moving = orders.find(o => o.id === id); if (!moving) return
    const rest = orders.filter(o => o.id !== id)
    const inSec = (o: SalesOrder) => (o.order_section || 'Make To Stock') === targetSection
    const targetItems = rest.filter(inSec).sort((a,b) => (a.board_position ?? 0) - (b.board_position ?? 0))
    const others = rest.filter(o => !inSec(o))
    targetItems.splice(Math.min(targetIndex, targetItems.length), 0, { ...moving, order_section: targetSection })
    const reindexed = targetItems.map((o, i) => ({ ...o, order_section: targetSection, board_position: i }))
    setOrders([...others, ...reindexed])
    dragId.current = null
    try { await Promise.all(reindexed.map(o => sb.from('sales_orders').update({ order_section: o.order_section, board_position: o.board_position }).eq('id', o.id))) } catch (e) {}
  }
  // Inline edits from the board rows (no modal needed) — route status through the real workflow.
  async function inlineStatus(o: SalesOrder, newStatus: string) {
    if (!newStatus || newStatus === o.status) return
    const prev = o.status
    setOrders(prevOrders => prevOrders.map(x => x.id === o.id ? { ...x, status: newStatus } : x))
    try {
      await sb.from('sales_orders').update({ status: newStatus }).eq('id', o.id)
      const result = await onStatusChange(o.id, newStatus as OrderStatus, prev as OrderStatus)
      if (result?.message) setFlowToast({ message: result.message, undoData: result.undoData })
    } catch { /* keep optimistic state */ }
  }
  async function inlineField(id: string, field: 'required_ship_date', value: string) {
    const prevVal = (orders.find(o => o.id === id) as any)?.[field] ?? null
    setOrders(prevOrders => prevOrders.map(x => x.id === id ? { ...x, [field]: value } : x))
    try {
      const { data, error } = await sb.from('sales_orders')
        .update({ [field]: value || null, updated_at: new Date().toISOString() })
        .eq('id', id).select('id')
      if (error || !data || data.length === 0) throw error || new Error('no rows updated')
    } catch (e) {
      // Revert the optimistic change so the board always reflects what actually saved.
      setOrders(prevOrders => prevOrders.map(x => x.id === id ? ({ ...x, [field]: prevVal } as any) : x))
      setInlineErr('Could not save the ship date — please try again.')
      setTimeout(() => setInlineErr(''), 5000)
      console.error('inlineField save failed', e)
    }
  }
  // ── Change audit: notify when an order is edited after production has started ──
  const POST_PROCESSING = ['In Production','QC','Ready for Packing Slip','Ready to Ship','Ready at Will Call','Partially Shipped','Ready for Invoice','Shipped','Completed']
  async function auditOrderChange(orig: SalesOrder) {
    if (!POST_PROCESSING.includes(orig.status)) return
    const changes: string[] = []
    const cmp = (label: string, oldV: any, newV: any) => { const a = String(oldV ?? '').trim(); const b = String(newV ?? '').trim(); if (a !== b) changes.push(`${label}: "${a || '—'}" → "${b || '—'}"`) }
    cmp('Status', orig.status, form.status)
    cmp('PO #', orig.po_number, form.po_number)
    cmp('Ship date', (orig as any).required_ship_date, form.ship_date)
    cmp('Total', orderValue(orig), form.total_amount)
    cmp('Ship-to', orig.shipping_address, form.shipping_address)
    if (!changes.length) return
    const who = userEmail || 'someone'
    try { await logActivity(orig.id, userEmail, `⚠️ Edited after production started by ${who} — ${changes.join('; ')}`) } catch { /* */ }
    const recips = ['rudyp@beyondgreenbiotech.com', 'accounting@byndgrn.com']
    for (const r of recips) {
      try { await sb.from('notifications').insert({ recipient_email: r, sender_email: userEmail || 'system', message: `Order ${orig.order_number || ''} changed after production: ${changes.slice(0, 3).join('; ')}`, page: 'Sales Orders', is_read: false, context_url: `/sales/orders?item=${orig.id}` }) } catch { /* */ }
    }
  }
  // ── Custom columns (fully user-defined) ───────────────────
  async function addColumn() {
    const label = window.prompt('New column name:')
    if (!label || !label.trim()) return
    const raw = (window.prompt('Column type — text, number, or date:', 'text') || 'text').trim().toLowerCase()
    const ftype = ['text', 'number', 'date'].includes(raw) ? raw : 'text'
    const pos = (columns.length ? Math.max(...columns.map(c => c.position)) : 0) + 1000
    const { data } = await sb.from('so_columns').insert({ label: label.trim(), ftype, position: pos }).select('*').single()
    if (data) setColumns(cs => [...cs, data as any])
  }
  async function deleteColumn(id: string) {
    if (!window.confirm('Delete this column? (Order values are kept but hidden.)')) return
    await sb.from('so_columns').delete().eq('id', id)
    setColumns(cs => cs.filter(c => c.id !== id))
  }
  async function setCell(orderId: string, colId: string, value: string) {
    const o = orders.find(x => x.id === orderId)
    const cf = { ...(((o as any)?.custom_fields) || {}), [colId]: value }
    setOrders(prev => prev.map(x => x.id === orderId ? ({ ...x, custom_fields: cf } as any) : x))
    try { await sb.from('sales_orders').update({ custom_fields: cf }).eq('id', orderId) } catch { /* */ }
  }
  useItemDeepLink(orders, openEdit)
  // Deep-link a status from the dashboard workflow tiles (e.g. /sales/orders?status=On%20Hold).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const s = new URLSearchParams(window.location.search).get('status')
    if (s) { setStatusFilter(s); setView('board') }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [portals, setPortals] = useState<PortalClient[]>([])
  const [flaggedMap, setFlaggedMap] = useState<Record<string, number>>({})
  const [columns, setColumns] = useState<{ id: string; label: string; ftype: string; position: number }[]>([])
  const [inlineErr, setInlineErr] = useState('')
  const [woMap, setWoMap] = useState<Record<string, number>>({}) // soId → wo_number
  const [userEmail, setUserEmail] = useState('')
  const [userRole, setUserRole] = useState('')
  const [verifySlip, setVerifySlip] = useState<SalesOrder | null>(null)
  const [slipChecks, setSlipChecks] = useState({ qty: false, desc: false, po: false })
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string|null>(null)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [flowToast, setFlowToast] = useState<{message:string; undoData?:any} | null>(null)
  const [inventoryCheckOrder, setInventoryCheckOrder] = useState<SalesOrder | null>(null)
  const ms = useMultiSelect<SalesOrder>()
  const [search, setSearch] = useState('')
  const [sectionTab, setSectionTab] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [expandedCompletedIds, setExpandedCompletedIds] = useState<Set<string>>(new Set())
  const [completedOpen, setCompletedOpen] = useState(false)
  const [shippedOrderIds, setShippedOrderIds] = useState<Set<string>>(new Set())
  const [editOpen, setEditOpen] = useState(false)
  const [editingOrder, setEditingOrder] = useState<SalesOrder | null>(null)
  const [form, setForm] = useState<F>(emptyForm)
  const [editLines, setEditLines] = useState<EditLineState[]>([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [loadError, setLoadError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setLoadError('')
    const [{ data: o, error: oErr }, { data: c }, { data: p }, { data: fl }, { data: wo }, { data: sh }, { data: pc }] = await Promise.all([
      sb.from('sales_orders').select('*, customer:customers(id,company_name,email,phone,city,state)').eq('archived', false).order('created_at', { ascending: false }),
      sb.from('customers').select('id,company_name').eq('board', 'customer').eq('is_active', true).order('company_name'),
      sb.from('products').select('id,sku,product_name,unit_cost,wholesale_price,msrp,unit_of_measure,our_part_number,supplier_part_number').eq('is_active', true).order('sku'),
      sb.from('sales_order_lines').select('sales_order_id, sku, product_id'),
      sb.from('work_orders').select('wo_number,notes').order('wo_number'),
      sb.from('shipments').select('sales_order_id').not('sales_order_id', 'is', null),
      sb.from('portal_clients').select('id, customer_id, company_name, name, email').eq('is_active', true),
    ])
    if (!userEmail) { sb.auth.getUser().then(({ data }) => { if (data.user?.email) { setUserEmail(data.user.email); sb.from('erp_user_roles').select('role').eq('email', data.user.email).maybeSingle().then(({ data: r }) => setUserRole((r as any)?.role || '')) } }) }
    if (oErr) setLoadError('Failed to load orders: ' + oErr.message)
    else if (o) setOrders(o as SalesOrder[])
    if (c) setCustomers(c as Customer[])
    if (p) setProducts(p as Product[])
    if (fl) {
      const fm: Record<string, number> = {}
      for (const r of fl as any[]) { if (r.sales_order_id && !r.product_id && !String(r.sku ?? '').trim()) fm[r.sales_order_id] = (fm[r.sales_order_id] ?? 0) + 1 }
      setFlaggedMap(fm)
    }
    if (wo) {
      const wm: Record<string, number> = {}
      for (const r of wo as any[]) {
        const soId = r.notes?.startsWith('SOREF:') ? r.notes.slice(6) : null
        if (soId) wm[soId] = r.wo_number
      }
      setWoMap(wm)
    }
    if (sh) {
      setShippedOrderIds(new Set((sh as any[]).map(r => r.sales_order_id).filter(Boolean)))
    }
    if (pc) setPortals(pc as PortalClient[])
    setLoading(false)
  }, [sb])

  useEffect(() => {
    load()
    // Realtime: reflect SO status changes from any page instantly
    const channel = sb.channel('so-live')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sales_orders' }, payload => {
        setOrders(prev => prev.map(o => o.id === (payload.new as any).id ? { ...o, ...(payload.new as any) } : o))
      })
      .subscribe()
    return () => { sb.removeChannel(channel) }
  }, [load, sb])

  // Load user-defined custom board columns.
  useEffect(() => { sb.from('so_columns').select('*').order('position', { ascending: true }).then(({ data }) => setColumns((data as any[]) || [])) }, [sb])

  // Pools + stats
  const tabPool = useMemo(() =>
    sectionTab === 'All' ? orders : orders.filter(o => (o.order_section ?? '') === sectionTab),
    [orders, sectionTab])

  const COMPLETED_STATUSES = ['Shipped', 'Completed', 'Closed', 'Cancelled']

  const isCompleted = useCallback((o: SalesOrder) =>
    COMPLETED_STATUSES.includes(o.status) || shippedOrderIds.has(o.id),
  [shippedOrderIds]) // eslint-disable-line

  const orderMatches = useCallback((o: SalesOrder) => {
    if (statusFilter !== 'All' && o.status !== statusFilter) return false
    const q = search.toLowerCase().trim()
    if (!q) return true
    return orderCustomerName(o).toLowerCase().includes(q) ||
      (o.notes ?? '').toLowerCase().includes(q) ||
      (o.order_number ?? '').toLowerCase().includes(q) ||
      (o.po_number ?? '').toLowerCase().includes(q) ||
      (o.customer_email ?? '').toLowerCase().includes(q)
  }, [search, statusFilter])

  const filtered = useMemo(() => tabPool.filter(o => !isCompleted(o) && orderMatches(o)), [tabPool, isCompleted, orderMatches])

  const completedOrders = useMemo(() => tabPool.filter(o => isCompleted(o) && orderMatches(o)), [tabPool, isCompleted, orderMatches])

  // Stats reflect the SAME set shown on the board/table: active (non-completed) orders that match the current search/filter.
  const stats = useMemo(() => {
    const active = orders.filter(o => !isCompleted(o) && orderMatches(o))
    const inProd = active.filter(o => o.status === 'In Production').length
    const ready  = active.filter(o => o.status === 'Ready to Ship' || o.status === 'Ready at Will Call').length
    const onHold = active.filter(o => o.status === 'On Hold').length
    const totalVal = active.reduce((s, o) => s + orderValue(o), 0)
    const flaggedTotal = Object.values(flaggedMap).reduce((s, v) => s + v, 0)
    return { total: active.length, inProd, ready, onHold, totalVal, flaggedTotal }
  }, [orders, isCompleted, orderMatches, flaggedMap])

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

  function toggleExpandCompleted(id: string) {
    setExpandedCompletedIds(prev => {
      const n = new Set(prev)
      if (n.has(id)) { n.delete(id) } else { n.add(id) }
      return n
    })
  }

  async function fetchOrderLinesForPdf(orderId: string): Promise<PDFLine[]> {
    const { data } = await sb.from('sales_order_lines').select('*').eq('sales_order_id', orderId).order('line_number')
    return ((data ?? []) as OrderLine[]).map((l, i) => ({
      line_number: l.line_number ?? i + 1,
      sku: l.sku,
      description: l.description ?? l.added_details ?? '',
      quantity: l.quantity,
      quantity_shipped: l.quantity_shipped ?? undefined,
      unit_of_measure: l.unit_of_measure,
      unit_price: l.unit_price,
      discount_pct: 0,
    }))
  }

  function buildPdfOrder(order: SalesOrder): PDFOrder {
    const val = orderValue(order)
    return {
      order_number: order.order_number,
      order_date: order.order_date,
      required_ship_date: order.required_ship_date ?? order.ship_date,
      status: order.status,
      po_number: order.po_number,
      shipping_address: order.shipping_address,
      billing_address: order.billing_address,
      carrier: order.carrier,
      subtotal: val,
      tax_pct: 0,
      total: val,
      notes: order.notes,
      terms: order.terms || order.payment_terms || 'Net 30',
      fob: order.fob ?? 'Santa Ana',
      sales_rep: order.sales_rep ?? 'RP',
    }
  }

  async function fetchCustomerForPdf(id: string | null | undefined): Promise<PDFCustomer | null> {
    if (!id) return null
    const { data } = await sb.from('customers').select('company_name,contact_name,email,phone,billing_address,shipping_address').eq('id', id).maybeSingle()
    if (!data) return null
    const d = data as any
    return { company_name: d.company_name, contact_name: d.contact_name, email: d.email, phone: d.phone, billing_address: d.billing_address, shipping_address: d.shipping_address }
  }

  async function handleDownloadOrderPdf(order: SalesOrder) {
    const lines = await fetchOrderLinesForPdf(order.id)
    const customer = (await fetchCustomerForPdf(order.customer_id)) ?? (order.customer ? { company_name: order.customer.company_name, email: order.customer.email, phone: order.customer.phone } : null)
    await generateOrderPDF(buildPdfOrder(order), lines, customer)
  }

  // Print case labels straight from the order lines: one label per case
  // (qty ÷ case pack), barcode generated from the product UPC/GTIN.
  async function handleCaseLabels(order: SalesOrder) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: lines } = await sb.from('sales_order_lines').select('*').eq('sales_order_id', order.id).order('line_number', { ascending: true })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ls = ((lines as any[]) || []).filter(l => (l.sku || '').trim())
    if (!ls.length) { alert('This order has no line items with a SKU.'); return }
    const skus = Array.from(new Set(ls.map(l => String(l.sku).trim().toUpperCase())))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prodMap: Record<string, any> = {}
    for (let i = 0; i < skus.length; i += 200) {
      const { data: prods } = await sb.from('products').select('sku, product_name, upc_gtin, case_qty, gtin_image_url').in('sku', skus.slice(i, i + 200))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const p of ((prods as any[]) || [])) prodMap[String(p.sku).toUpperCase()] = p
    }
    const cases: CaseLabel[] = []
    for (const l of ls) {
      const sku = String(l.sku).trim()
      const p = prodMap[sku.toUpperCase()]
      const per = Number(p?.case_qty) || Number(l.qty_per_case) || 0
      const qty = Number(l.quantity ?? l.qty) || 0
      const totalCases = per > 0 ? Math.max(1, Math.ceil(qty / per)) : 1
      let gtinImg: string | null = null
      if (p?.gtin_image_url) { try { gtinImg = await loadBarcodePng(p.gtin_image_url) } catch { gtinImg = null } }
      for (let c = 1; c <= totalCases; c++) {
        cases.push({ sku, description: p?.product_name || l.description || sku, upcGtin: p?.upc_gtin || null, customerPartNumber: l.our_part_number || null, caseNumber: c, totalCases, unitsInCase: per || undefined, gtinImageDataUrl: gtinImg })
      }
    }
    const doc = buildCaseLabels({ poNumber: order.po_number || order.order_number || '', shipToName: order.customer?.company_name || '', shipToAddress: order.shipping_address || '' }, cases)
    doc.save(`case-labels-${order.order_number || 'order'}.pdf`)
  }

  const [sendingConf, setSendingConf] = useState<string | null>(null)
  async function handleSendOrderConfirmation(order: SalesOrder) {
    const to = order.customer_email || order.customer?.email || ''
    if (!to) { alert('This order has no customer email. Add one first.'); return }
    if (!confirm(`Send an order confirmation for ${order.order_number || 'this order'} to ${to}?`)) return
    setSendingConf(order.id)
    try {
      const res = await fetch('/api/orders/send-confirmation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: order.id }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { alert('Could not send: ' + (j.error || res.statusText)); return }
      alert(`Order confirmation sent to ${to}.`)
    } catch (e) { alert('Send failed: ' + String(e)) }
    finally { setSendingConf(null) }
  }

  async function searchLeads(q: string): Promise<{ id: string; company_name: string }[]> {
    const term = q.trim()
    if (term.length < 2) return []
    const { data } = await sb.from('customers')
      .select('id,company_name')
      .eq('board', 'Leads')
      .ilike('company_name', `%${term}%`)
      .order('company_name')
      .limit(25)
    return (data ?? []) as { id: string; company_name: string }[]
  }

  // Build a customer-ready Sales Order straight from the current form (usable before saving)
  async function downloadFromForm() {
    const cust = await fetchCustomerForPdf(form.customer_id)
    const pdfLines: PDFLine[] = editLines
      .filter(l => l.sku || l.description)
      .map((l, i) => {
        const prod = products.find(pr => pr.sku === l.sku)
        return {
          line_number: i + 1,
          sku: l.sku || null,
          description: l.description || prod?.product_name || '',
          quantity: parseFloat(l.quantity) || 0,
          unit_of_measure: l.unit_of_measure || prod?.unit_of_measure || null,
          unit_price: (parseFloat(l.unit_price) > 0 ? parseFloat(l.unit_price) : (prod?.unit_cost ?? 0)),
          discount_pct: 0,
        }
      })
    const computed = pdfLines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0)
    const total = computed || (parseFloat(form.total_amount) || 0)
    const pdfOrder: PDFOrder = {
      order_number: form.order_number.trim() || 'SO',
      order_date: form.order_date || null,
      required_ship_date: form.ship_date || null,
      status: form.status,
      po_number: form.po_number.trim() || null,
      shipping_address: form.shipping_address || null,
      billing_address: form.billing_address || null,
      carrier: form.facility || null,
      subtotal: total,
      tax_pct: 0,
      total,
      notes: form.notes,
      terms: form.terms || 'Net 30',
      fob: form.fob || 'Santa Ana',
      sales_rep: form.sales_rep || 'RP',
    }
    await generateOrderPDF(pdfOrder, pdfLines, cust)
  }

  async function handleDownloadPackingListPdf(order: SalesOrder) {
    const lines = await fetchOrderLinesForPdf(order.id)
    const customer = order.customer ? { company_name: order.customer.company_name, email: order.customer.email, phone: order.customer.phone } : null
    generatePackingSlip(buildPdfOrder(order), lines, customer)
  }

  // Form helpers
  async function openAdd() {
    setEditingOrder(null); setEditLines([]); setErr('')
    // Auto-assign the next SO number in the 31487+ sequence (ignores legacy/oversized refs).
    let next = 31487
    try {
      const { data } = await sb.from('sales_orders').select('order_number')
      const nums = (data || [])
        .map((r: any) => String(r.order_number ?? '').trim())
        .filter((s: string) => /^[0-9]+$/.test(s))
        .map(Number)
        .filter((n: number) => n >= 31487 && n <= 999999)
      next = Math.max(31486, ...nums) + 1
    } catch { /* fall back to 31487 */ }
    autoSORef.current = String(next)
    setForm({ ...emptyForm, order_number: String(next) })
    setEditOpen(true)
  }

  async function openEdit(order: SalesOrder) {
    // Load lines for this order
    const { data: lines } = await sb.from('sales_order_lines').select('*').eq('sales_order_id', order.id).order('line_number')
    setEditLines((lines ?? []).map((l: any) => ({
      _key: l.id,
      id: l.id,
      sku: l.sku ?? '',
      our_part_number: l.our_part_number ?? '',
      supplier_part_number: l.supplier_part_number ?? '',
      description: l.description ?? '',
      quantity: String(l.quantity ?? 1),
      completed_qty: String(l.completed_qty ?? l.quantity_shipped ?? 0),
      unit_of_measure: l.unit_of_measure ?? '',
      unit_price: (l.unit_price && Number(l.unit_price) > 0) ? String(l.unit_price) : '',
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
      order_number: order.order_number ?? '',
      po_number: order.po_number ?? '',
      status: order.status,
      facility: order.facility ?? order.carrier ?? '',
      monday_item_id: order.monday_item_id ?? '',
      order_date: order.order_date ?? '',
      production_start: order.production_start ?? '',
      estimated_completion: order.estimated_completion ?? '',
      ship_date: order.ship_date ?? order.required_ship_date ?? '',
      customer_id: order.customer_id ?? '',
      customer_label: order.customer?.company_name ?? '',
      customer_email: order.customer_email ?? '',
      customer_phone: order.customer_phone ?? '',
      shipping_address: order.shipping_address ?? '',
      billing_address: order.billing_address ?? '',
      total_amount: orderValue(order) ? String(orderValue(order)) : '',
      purchase_order_url: order.purchase_order_url ?? '',
      packing_slip_url: order.packing_slip_url ?? '',
      bol: order.bol ?? '',
      additional_comments: order.additional_comments ?? '',
      terms: order.terms ?? order.payment_terms ?? 'Net 30',
      fob: order.fob ?? 'Santa Ana',
      sales_rep: order.sales_rep ?? 'RP',
      client_portal_visible: order.client_portal_visible ?? false,
      client_portal_name: order.client_portal_name ?? '',
      broker_cost: order.broker_cost != null ? String(order.broker_cost) : '',
      broker_commission_basis: order.broker_commission_basis || 'po_7',
      broker_commission_paid: !!order.broker_commission_paid,
      broker_commission_status: order.broker_commission_status || (order.broker_commission_paid ? 'paid_by_bg' : 'waiting_customer'),
    })
    setErr(''); setEditOpen(true)
  }

  async function save() {
    if (saving) return
    if (!editingOrder && !form.notes.trim() && !form.order_number.trim()) { setErr('Enter an order name or SO#.'); return }
    setErr(''); setSaving(true)

    let soNum = form.order_number.trim()
    // Prevent duplicate SO# from concurrent entry: if the number is the one we auto-suggested
    // (user didn't type a custom one), reserve a guaranteed-unique number atomically in the DB.
    if (!editingOrder && soNum && soNum === autoSORef.current) {
      try { const { data: fresh } = await sb.rpc('next_so_number'); if (fresh) { soNum = String(fresh); setForm(p => ({ ...p, order_number: soNum })) } } catch { /* keep suggested */ }
    }

    // SO# is unique in the database. If this number is already taken — even by an
    // order that was deleted/archived and no longer shows on the board — reusing it
    // would fail. Detect the conflict, name the existing order, and let the user
    // override: an archived/deleted holder is removed, an active one is renamed so
    // its data is kept, freeing the number for this order.
    if (soNum) {
      const { data: dupes } = await sb.from('sales_orders')
        .select('id, order_number, notes, archived, status, customer:customers(company_name)')
        .eq('order_number', soNum)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dup = ((dupes as any[]) || []).find(d => d.id !== editingOrder?.id)
      if (dup) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dupName = (dup.notes && String(dup.notes).trim())
          || (dup as any).customer?.company_name
          || dup.order_number || '(unnamed order)'
        const gone = !!dup.archived
        const ok = window.confirm(
          `Sales Order ${soNum} was already assigned to "${dupName}"${gone ? ' (deleted/archived)' : ` — status ${dup.status || 'unknown'}`}.\n\nAllow override and reuse this SO # for this order?`
        )
        if (!ok) { setSaving(false); return }
        if (gone) {
          // Fully remove the archived/deleted holder so the number is free.
          await sb.from('sales_order_lines').delete().eq('sales_order_id', dup.id)
          await sb.from('work_orders').delete().eq('sales_order_id', dup.id)
          await sb.from('shipments').delete().eq('sales_order_id', dup.id)
          await sb.from('sales_orders').delete().eq('id', dup.id)
        } else {
          // Keep the active order's data — just move its number aside.
          await sb.from('sales_orders').update({ order_number: `${soNum}~replaced-${Date.now().toString(36)}` }).eq('id', dup.id)
        }
      }
    }

    const basePayload: Record<string,any> = {
      notes: form.notes.trim() || null,
      status: form.status,
      po_number: form.po_number.trim() || null,
      order_date: form.order_date || null,
      required_ship_date: form.ship_date || null,
      carrier: form.facility || null,
      customer_id: form.customer_id || null,
      subtotal: form.total_amount ? parseFloat(form.total_amount) : 0,
      total: form.total_amount ? parseFloat(form.total_amount) : 0,
      tax_pct: 0,
      shipping_address: form.shipping_address || null,
      billing_address: form.billing_address || null,
    }
    // SO# (order_number): use what was typed; if blank keep the existing number when editing,
    // or leave it off for a new order so the database assigns the next sequence value.
    if (soNum) basePayload.order_number = soNum
    else if (editingOrder) basePayload.order_number = editingOrder.order_number
    const extPayload: Record<string,any> = {
      order_section: form.order_section || null,
      facility: form.facility || null,
      production_start: form.production_start || null,
      estimated_completion: form.estimated_completion || null,
      customer_email: form.customer_email || null,
      customer_phone: form.customer_phone || null,
      additional_comments: form.additional_comments || null,
      purchase_order_url: form.purchase_order_url || null,
      packing_slip_url: form.packing_slip_url || null,
      bol: form.bol || null,
      monday_item_id: form.monday_item_id || null,
      terms: form.terms || null,
      payment_terms: form.terms || null,
      fob: form.fob || null,
      sales_rep: form.sales_rep || null,
      client_portal_visible: !!form.client_portal_visible,
      client_portal_name: form.client_portal_name || null,
      broker_cost: form.broker_cost ? parseFloat(form.broker_cost) : null,
      broker_commission_basis: form.broker_commission_basis || null,
      broker_commission_status: form.broker_commission_status || 'waiting_customer',
      broker_commission_paid: form.broker_commission_status === 'paid_by_bg',
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

    if (editingOrder) { await auditOrderChange(editingOrder) }

    if (!orderId) { setErr('Could not get order ID'); setSaving(false); return }

    // Always clear this order's existing lines before re-inserting, so saving never duplicates them.
    await sb.from('sales_order_lines').delete().eq('sales_order_id', orderId)

    // Insert all lines
    for (let i = 0; i < editLines.length; i++) {
      const line = editLines[i]
      if (!line.sku && !line.description) continue
      const prod = products.find(p => p.sku === line.sku)
      // ULTRON: link to the Inventory product; auto-create brand-new SKUs so Inventory stays the
      // source of truth. Inventory prices are the set default and are never overwritten from an order.
      let pid: string | null = line.product_id ?? prod?.id ?? null
      const skuT = (line.sku || '').trim()
      if (!pid && skuT) {
        const { data: found } = await sb.from('products').select('id').ilike('sku', skuT).limit(1)
        if (found && found.length) pid = (found[0] as any).id
        else {
          const upx = parseFloat(line.unit_price)
          const { data: created, error: cErr } = await sb.from('products').insert({ sku: skuT, product_name: line.description || skuT, wholesale_price: upx > 0 ? upx : null, unit_of_measure: line.unit_of_measure || 'EA', is_active: true, inventory_status: 'Active' }).select('id').single()
          if (!cErr && created) pid = (created as any).id
          else { const { data: again } = await sb.from('products').select('id').ilike('sku', skuT).limit(1); pid = (again?.[0] as any)?.id ?? null }
        }
      }
      const baseLine: Record<string,any> = {
        sales_order_id: orderId,
        product_id: pid,
        sku: line.sku || null,
        description: line.description || prod?.product_name || null,
        quantity: parseFloat(line.quantity) || 1,
        quantity_shipped: parseFloat(line.completed_qty) || 0,
        unit_of_measure: line.unit_of_measure || null,
        unit_price: (parseFloat(line.unit_price) > 0 ? parseFloat(line.unit_price) : ((prod?.wholesale_price ?? prod?.msrp ?? prod?.unit_cost) ?? 0)),
        line_number: i + 1,
        discount_pct: 0,
      }
      const extLine: Record<string,any> = {
        completed_qty: parseFloat(line.completed_qty) || 0,
        our_part_number: line.our_part_number.trim() || null,
        supplier_part_number: line.supplier_part_number.trim() || null,
        packaging: line.packaging || null,
        production_status: line.production_status || null,
        added_details: line.added_details || null,
        sku_flagged: !!skuT && !pid,
      }
      const lRes = await sb.from('sales_order_lines').insert({ ...baseLine, ...extLine })
      if (lRes.error?.message?.includes('column')) {
        await sb.from('sales_order_lines').insert(baseLine)
      }
    }

    // Snapshot a version (V1, V2…) so prior pricing/status is tracked
    if (orderId) { try { await sb.rpc('snapshot_order_version', { p_order: orderId, p_by: userEmail || 'system', p_note: null }) } catch { /* best-effort */ } }

    setSaving(false); setEditOpen(false)
    try { if (!editingOrder) localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }

    // Auto-flow: detect status change and trigger side-effects
    if (editingOrder && orderId && form.status !== editingOrder.status) {
      const result = await onStatusChange(
        orderId,
        form.status as OrderStatus,
        editingOrder.status as OrderStatus
      )
      setFlowToast({ message: result.message, undoData: result.undoData })
    }

    setEditingOrder(null); load()
  }

  async function duplicateOrder(order: SalesOrder) {
    setSaving(true); setErr('')
    try {
      const { data: full, error: fe } = await sb.from('sales_orders').select('*').eq('id', order.id).single()
      if (fe || !full) { setErr(fe?.message || 'Could not load order to duplicate'); setSaving(false); return }
      const src: any = full
      const { id: _id, created_at: _c, updated_at: _u, total_amount: _ta, order_number: origNum, monday_item_id: _mid, docs_token: _dt, board_position: _bp, ...rest } = src
      const copyNum = `${origNum || 'ORDER'} (COPY ${Date.now().toString().slice(-4)})`
      const { data: ins, error: ie } = await sb.from('sales_orders').insert({ ...rest, order_number: copyNum, monday_item_id: null, archived: false }).select('id').single()
      if (ie || !ins) { setErr(ie?.message || 'Duplicate failed'); setSaving(false); return }
      const { data: lines } = await sb.from('sales_order_lines').select('*').eq('sales_order_id', order.id)
      if (lines && (lines as any[]).length) {
        const newLines = (lines as any[]).map(l => { const { id, created_at, updated_at, ...rl } = l; return { ...rl, sales_order_id: ins.id } })
        await sb.from('sales_order_lines').insert(newLines)
      }
      setSaving(false); setEditOpen(false); setEditingOrder(null)
      await load()
    } catch (e: any) { setErr(e?.message || 'Duplicate failed'); setSaving(false) }
  }

  async function handleUndoFlow(undoData: any) {
    const result = await undoFlow(undoData)
    setFlowToast({ message: result.message })
    load()
  }

  async function handleDelete(id: string) {
      setConfirmDeleteId(id)
    }


    async function executeDelete(id: string) {
      await sb.from('work_orders').delete().eq('sales_order_id', id)
      await sb.from('shipments').delete().eq('sales_order_id', id)
      await sb.from('sales_order_lines').delete().eq('sales_order_id', id)
      await sb.from('sales_orders').delete().eq('id', id)
      setConfirmDeleteId(null); load()
    }
    async function bulkDelete() {
      if (ms.count === 0) return
      setConfirmBulkDelete(true)
    }

    async function executeBulkDelete() {
      setDeleting(true)
      const ids = Array.from(ms.selected)
        await sb.from('work_orders').delete().in('sales_order_id', ids)
        await sb.from('shipments').delete().in('sales_order_id', ids)
      await sb.from('sales_order_lines').delete().in('sales_order_id', ids)
      await sb.from('sales_orders').delete().in('id', ids)
      ms.clear(); setDeleting(false); setConfirmBulkDelete(false); load()
    }

  return (
    <div className="min-h-screen mon-page">
      {loadError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-4 flex items-center gap-3">
          <span className="text-red-400 text-sm flex-1">{loadError}</span>
          <button onClick={load} className="text-xs text-red-400 border border-red-500/30 rounded-lg px-3 py-1">Retry</button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <span className="mon-tag">📦 Orders</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">Sales Orders</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${orders.length} orders`}</p>
        </div>
        {userRole !== 'accounting' && (
        <button onClick={openAdd} className="mon-btn">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
          New Order
        </button>
        )}
      </div>

      {/* Stats bar */}
      {inlineErr && (
        <div className="fixed bottom-5 right-5 z-[130] rounded-lg bg-[#E2445C] text-white text-sm font-semibold px-4 py-2.5 shadow-lg">{inlineErr}</div>
      )}
      {!loading && view !== 'walmart' && (<>
        <style>{`@keyframes soBlink{0%,100%{opacity:1}50%{opacity:.4}} .so-blink{animation:soBlink 1s ease-in-out infinite}`}</style>
        {(() => {
          const overdue = orders.filter(o => !isCompleted(o) && orderMatches(o) && shipUrgency(o)?.level === 'overdue')
          if (!overdue.length) return null
          const names = overdue.slice(0, 4).map(o => orderTitle(o)).join(', ')
          return (
            <div className="so-blink mb-4 rounded-lg border-2 border-[#E2445C] bg-[#E2445C]/12 px-4 py-3 flex items-center gap-3">
              <span className="text-xl">🚨</span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-[#E2445C]">CRITICAL — {overdue.length} order{overdue.length > 1 ? 's' : ''} past ship date</p>
                <p className="text-xs text-[#B23048] truncate">{names}{overdue.length > 4 ? ` +${overdue.length - 4} more` : ''} — ship immediately or update the date.</p>
              </div>
            </div>
          )
        })()}
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
          <Stat label="Active Orders" value={String(stats.total)} c="#0086C0"/>
          <Stat label="In Production" value={String(stats.inProd)} c="#FDAB3D"/>
          <Stat label="Ready to Ship" value={String(stats.ready)} c="#00C7C7"/>
          <Stat label="On Hold" value={String(stats.onHold)} c={stats.onHold > 0 ? '#E2445C' : '#9699A6'}/>
          <Stat label="Total Value" value={fmt$((stats.totalVal || 0) + walmartTotal) ?? '—'} c="#00A84F"/>
          <Stat label="Flagged Lines" value={String(stats.flaggedTotal)} c={stats.flaggedTotal > 0 ? '#A25DDC' : '#9699A6'} sub="need SKU"/>
        </div>
      </>)}

      {/* Search + status filter — applies to both Board and Table */}
      {view !== 'walmart' && (
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          <input placeholder="Search customer, PO#, order #…" value={search} onChange={e => setSearch(e.target.value)}
            className="w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"/>
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="bg-white border border-[#E4E6EE] text-[#1A1D2E] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer">
          <option value="All">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {(search || statusFilter !== 'All') && (
          <button onClick={() => { setSearch(''); setStatusFilter('All') }} className="text-xs text-gray-500 hover:text-[#1A1D2E] px-2 py-1">Clear</button>
        )}
        <span className="text-xs text-gray-400 ml-auto">{(view === 'board' ? orders.filter(orderMatches).length : filtered.length)} shown</span>
      </div>
      )}

      {/* View toggle + board grouping */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-1 bg-[#F0F2F7] rounded-lg p-1 w-fit">
          <button onClick={() => setView('board')} className={"px-3 py-1.5 rounded-md text-xs font-medium transition-colors " + (view === 'board' ? 'bg-white text-[#1A1D2E] shadow-sm' : 'text-gray-500')}>Board</button>
          <button onClick={() => setView('table')} className={"px-3 py-1.5 rounded-md text-xs font-medium transition-colors " + (view === 'table' ? 'bg-white text-[#1A1D2E] shadow-sm' : 'text-gray-500')}>Table</button>
          <button onClick={() => setView('walmart')} className={"px-3 py-1.5 rounded-md text-xs font-medium transition-colors " + (view === 'walmart' ? 'bg-white text-[#1A1D2E] shadow-sm' : 'text-gray-500')}>Walmart Orders</button>
        </div>
        {view === 'board' && (
          <div className="flex items-center gap-1 bg-[#F0F2F7] rounded-lg p-1 w-fit">
            <span className="text-[11px] text-gray-400 pl-2 pr-1">Group by</span>
            <button onClick={() => setGroupBy('section')} className={"px-3 py-1.5 rounded-md text-xs font-medium transition-colors " + (groupBy === 'section' ? 'bg-white text-[#1A1D2E] shadow-sm' : 'text-gray-500')}>Customer</button>
            <button onClick={() => setGroupBy('status')} className={"px-3 py-1.5 rounded-md text-xs font-medium transition-colors " + (groupBy === 'status' ? 'bg-white text-[#1A1D2E] shadow-sm' : 'text-gray-500')}>Status</button>
          </div>
        )}
        {view === 'board' && (
          <div className="flex items-center gap-1.5 ml-auto text-xs">
            <button onClick={() => setCollapsed(Object.fromEntries((groupBy === 'status' ? STATUSES : SECTIONS).map(g => [g, true])))}
              className="px-2.5 py-1.5 rounded-md text-gray-500 hover:text-[#1A1D2E] hover:bg-[#F0F2F7] transition-colors">Collapse all</button>
            <button onClick={() => setCollapsed({})}
              className="px-2.5 py-1.5 rounded-md text-gray-500 hover:text-[#1A1D2E] hover:bg-[#F0F2F7] transition-colors">Expand all</button>
            <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-gray-500 hover:bg-[#F0F2F7] cursor-pointer select-none">
              <input type="checkbox" checked={showEmpty} onChange={e => setShowEmpty(e.target.checked)} className="accent-[#00A84F] w-3.5 h-3.5" />
              Show empty
            </label>
          </div>
        )}
      </div>

      {view === 'walmart' && <WalmartBoard />}

      {view === 'board' && (() => {
        // Include any status present on active orders that isn't in the canonical list,
        // so no order can ever hide from the status board (defensive against stray statuses).
        const extraStatuses = groupBy === 'status'
          ? [...new Set(orders.filter(o => !isCompleted(o) && o.status && !STATUSES.includes(o.status)).map(o => o.status as string))]
          : []
        const baseGroups = groupBy === 'status' ? [...STATUSES, ...extraStatuses] : SECTIONS
        const groupData = baseGroups.map(grp => {
          const items = (groupBy === 'status'
            ? orders.filter(o => o.status === grp && !isCompleted(o) && orderMatches(o))
            : orders.filter(o => (o.order_section || 'Make To Stock') === grp && !isCompleted(o) && orderMatches(o)).sort((a,b) => (a.board_position ?? 0) - (b.board_position ?? 0)))
          return { grp, items }
        }).filter(g => showEmpty || g.items.length > 0)
        return (
        <div className="space-y-2.5 mb-6">
          {groupData.length === 0 && <p className="text-center text-gray-400 py-16 text-sm">No orders match your filters.</p>}
          {groupData.map(({ grp, items }) => {
            const isColl = collapsed[grp]
            const color = groupBy === 'status' ? statusColor(grp).solid : (SECTION_COLORS[grp] || statusColor(grp).solid)
            const groupTotal = items.reduce((s, o) => s + orderValue(o), 0)
            const dropInto = (idx: number) => {
              const id = dragId.current; dragId.current = null; if (!id) return
              if (groupBy === 'status') { const mo = orders.find(o => o.id === id); if (mo) inlineStatus(mo, grp) }
              else { moveOrder(id, grp, idx) }
            }
            return (
              <div key={grp} className="bg-white rounded-xl overflow-hidden shadow-sm border border-[#ECEEF3]" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); dropInto(items.length) }}>
                <div className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none sticky top-0 z-[5]"
                  style={{ background: color + '14', borderLeft: '5px solid ' + color }}
                  onClick={() => setCollapsed(c => ({ ...c, [grp]: !c[grp] }))}>
                  <span className="text-[10px]" style={{ color, display: 'inline-block', transition: 'transform .15s', transform: isColl ? 'none' : 'rotate(90deg)' }}>&#9654;</span>
                  <span className="font-bold text-sm truncate" style={{ color }}>{grp}</span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: color + '26', color }}>{items.length}</span>
                  {groupTotal > 0 && <span className="ml-auto text-xs font-semibold text-gray-500 shrink-0">{fmt$(groupTotal)}</span>}
                </div>
                {!isColl && (
                  <div>
                    <div className="flex items-center gap-2.5 px-3 py-1.5 border-b border-[#EEF0F4] bg-[#FBFCFE] text-[10px] font-semibold uppercase tracking-wide text-gray-400 select-none">
                      <span className="w-3 shrink-0" />
                      <span className="flex-1 min-w-0">Order</span>
                      {columns.map(col => (
                        <span key={col.id} className="w-[110px] shrink-0 hidden md:flex items-center gap-1 group/col">
                          <span className="truncate">{col.label}</span>
                          <button onClick={(e) => { e.stopPropagation(); deleteColumn(col.id) }} className="opacity-0 group-hover/col:opacity-100 text-gray-300 hover:text-red-500" title="Delete column">&times;</button>
                        </span>
                      ))}
                      <span className="w-[110px] shrink-0 hidden sm:block">Status</span>
                      <span className="w-[120px] shrink-0 hidden sm:block">Ship Date</span>
                      <span className="w-20 text-right shrink-0">Value</span>
                      <button onClick={(e) => { e.stopPropagation(); addColumn() }} className="ml-1 text-[#0086C0] hover:underline shrink-0 normal-case" title="Add a custom column">+ Col</button>
                    </div>
                  <div className="divide-y divide-[#F4F5F8]">
                    {items.length === 0 && <div className="px-4 py-3 text-xs text-gray-400 italic">Drop orders here</div>}
                    {items.map((o, idx) => {
                      const sc = statusColor(o.status)
                      const u = shipUrgency(o)
                      return (
                      <div key={o.id} draggable onDragStart={() => { dragId.current = o.id }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dropInto(idx) }} style={urgencyStyle(u)} className={`group flex items-center gap-2 sm:gap-2.5 px-2.5 sm:px-3 py-2.5 mon-row ${u?.level === 'overdue' ? 'so-blink' : ''}`}>
                        <span className="text-gray-300 group-hover:text-gray-500 cursor-grab active:cursor-grabbing select-none text-xs shrink-0" title="Drag to reorder or move">&#8942;&#8942;</span>
                        <div className="flex-1 min-w-0" onClick={() => openEdit(o)}>
                          <p className="text-sm font-semibold text-[#1A1D2E] truncate">{orderTitle(o)}</p>
                          <p className="text-xs text-gray-500 truncate">{o.po_number ? 'PO ' + o.po_number : (o.order_number && o.order_number !== orderTitle(o) ? o.order_number : '')}</p>
                        </div>
                        {columns.map(col => { const cf = ((o as any).custom_fields) || {}; return (
                          <input key={col.id} type={col.ftype === 'number' ? 'number' : col.ftype === 'date' ? 'date' : 'text'} value={cf[col.id] ?? ''} onClick={e => e.stopPropagation()} onChange={e => setCell(o.id, col.id, e.target.value)} onDragStart={e => e.stopPropagation()} placeholder="—"
                            className="w-[110px] shrink-0 hidden md:block text-xs text-gray-600 bg-transparent border border-transparent hover:border-[#E4E6EE] rounded px-1 py-0.5 focus:outline-none focus:border-[#00A84F]" />
                        ) })}
                        {u && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${u.level === 'overdue' ? 'bg-[#E2445C] text-white' : 'bg-amber-400/20 text-amber-700'}`} title="Ship-date urgency">{u.level === 'overdue' ? `${Math.abs(u.days)}d late` : `${u.days}d`}</span>}
                        <select value={o.status} onClick={e => e.stopPropagation()} onChange={e => { e.stopPropagation(); inlineStatus(o, e.target.value) }} onDragStart={e => e.stopPropagation()}
                          style={{ background: sc.bg, color: sc.fg, borderColor: 'transparent' }}
                          className="text-xs rounded-full border px-2.5 py-1 font-semibold cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#00A84F]/30 shrink-0 max-w-[104px] sm:max-w-[170px] truncate">
                          {(STATUSES.includes(o.status) ? STATUSES : [o.status, ...STATUSES]).map(s => <option key={s} value={s} style={{ color: '#1A1D2E' }}>{s}</option>)}
                        </select>
                        <input type="date" value={o.required_ship_date || ''} onClick={e => e.stopPropagation()} onChange={e => inlineField(o.id, 'required_ship_date', e.target.value)} onDragStart={e => e.stopPropagation()}
                          className="text-xs text-gray-600 bg-transparent border border-transparent hover:border-[#E4E6EE] rounded px-1 py-0.5 w-[120px] hidden sm:block focus:outline-none focus:border-[#00A84F]" title="Required ship date"/>
                        <span className="text-xs font-semibold text-gray-700 w-14 sm:w-20 text-right shrink-0">{fmt$(orderValue(o)) ?? ''}</span>
                      </div>
                    )})}
                  </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        )
      })()}
      
            {/* Section tabs */}
      <div className="flex gap-1 bg-[#F0F2F7] rounded-lg p-1 overflow-x-auto mb-4" style={{ display: view === 'table' ? undefined : 'none' }}>
        {SECTION_TABS.map(t => (
          <button key={t} onClick={() => setSectionTab(t)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${sectionTab === t ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-700'}`}>
            {t}{sectionCounts[t] != null ? ` (${sectionCounts[t]})` : ''}
          </button>
        ))}
      </div>

      {/* (search + status filter moved to the top bar, shared by Board and Table) */}

      {/* Orders table */}
      <div className="rounded-xl overflow-x-auto" style={{border:"1px solid #E4E6EE",background:"#FFFFFF", display: view === 'table' ? undefined : 'none'}}>
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <svg className="w-5 h-5 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-gray-500 py-20 text-sm">No orders found.</p>
        ) : (
          <table className="w-full min-w-[1200px] text-sm">
            <thead>
              <tr className="border-b border-[#E4E6EE]">
                <th className="w-10 px-3 py-3"><input type="checkbox" checked={ms.isAllSelected(filtered)} onChange={()=>ms.toggleAll(filtered)} className="accent-emerald-500 w-4 h-4 cursor-pointer"/></th>
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
                const custName = orderTitle(order)
                const ref = orderRef(order)
                return (
                  <>
                    <tr key={order.id}
                      className={`border-b border-[#F3F4F6] transition-colors ${ms.isSelected(order.id) ? 'bg-blue-500/5' : expanded ? 'bg-[#F5F6FA]/30' : i % 2 === 1 ? 'bg-[#FAFAFA] hover:bg-[#F9FAFB]' : 'hover:bg-[#F9FAFB]'}`}>
                      {/* Checkbox */}
                      <td className="px-3 py-3.5" onClick={e=>e.stopPropagation()}>
                        <input type="checkbox" checked={ms.isSelected(order.id)} onChange={()=>ms.toggle(order.id)} className="accent-emerald-500 w-4 h-4 cursor-pointer"/>
                  <button onClick={e => { e.stopPropagation(); handleDelete(order.id) }} className="mt-1 text-xs text-red-400 hover:text-red-300 opacity-0 group-hover:opacity-100 transition-opacity">del</button>
                      </td>
                      {/* Expand toggle */}
                      <td className="px-3 py-3.5 cursor-pointer" onClick={() => toggleExpand(order.id)}>
                        <svg className={`w-3.5 h-3.5 text-gray-500 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
                      </td>
                      {/* Customer / Order Name — click opens the record window */}
                      <td className="px-3 py-3.5 max-w-[200px] cursor-pointer mon-row" onClick={() => openEdit(order)}>
                        <p className="text-[#1A1D2E] font-semibold text-sm truncate">{custName}</p>
                        {ref && <p className="text-gray-500 text-xs truncate mt-0.5">{ref}</p>}
                      </td>
                      <td className="px-3 py-3.5">
                        {order.order_section && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-[#F5F6FA]/50 text-gray-400 border border-[#E4E6EE] whitespace-nowrap">{order.order_section}</span>
                        )}
                      </td>
                      <td className="px-3 py-3.5 text-gray-400 text-xs font-mono whitespace-nowrap">{order.po_number ?? '—'}</td>
                      <td className="px-3 py-3.5">
                        <div className="flex flex-col gap-1">
                          <StatusBadge status={order.status}/>
                          {woMap[order.id] != null && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-600 border border-indigo-500/20 font-mono whitespace-nowrap w-fit">
                              WO-{woMap[order.id]}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3.5 text-gray-500 text-xs whitespace-nowrap">{order.facility ?? order.carrier ?? '—'}</td>
                      <td className="px-3 py-3.5 text-gray-400 text-xs whitespace-nowrap">{fmtD(order.order_date)}</td>
                      <td className="px-3 py-3.5 text-gray-400 text-xs whitespace-nowrap">{fmtD(order.estimated_completion)}</td>
                      <td className="px-3 py-3.5 text-gray-400 text-xs whitespace-nowrap">{fmtD(order.ship_date ?? order.required_ship_date)}</td>
                      <td className="px-3 py-3.5 text-gray-500 text-xs font-medium whitespace-nowrap">{fmt$(orderValue(order))}</td>
                      <td className="px-3 py-3.5 text-gray-600 text-xs">—</td>
                      <td className="px-3 py-3.5">
                        {flagged > 0 && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20 font-medium whitespace-nowrap" title={`${flagged} line items need SKU`}>
                            ⚠ {flagged}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3.5" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1 flex-wrap">
                          <button onClick={() => openEdit(order)}
                            className="text-xs px-2 py-1 rounded bg-blue-700/50 hover:bg-blue-700 text-blue-300 transition-colors">Edit</button>
                      <button
                        onClick={e => { e.stopPropagation(); handleDelete(order.id) }}
                        className="text-xs px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white font-medium transition-colors"
                        title="Delete order">
                        Delete
                      </button>
                          <button
                            onClick={e => { e.stopPropagation(); setInventoryCheckOrder(order) }}
                            className="text-xs px-2 py-1 rounded transition-colors"
                            style={{ background: '#EFF6FF', color: '#2563EB' }}
                            title="Check inventory and route order">
                            Check Stock
                          </button>
                          <button onClick={() => handleDelete(order.id)}
                            className="text-xs px-2 py-1 rounded bg-red-900/40 hover:bg-red-900/70 text-red-400 transition-colors">Del</button>
                        </div>
                      </td>
                    </tr>

                    {/* Expanded line items + activity log */}
                    {expanded && (
                      <>
                        <tr className="border-b border-[#E4E6EE]/40 bg-[#F9FAFB]/40">
                          <td colSpan={14} className="px-0 py-0">
                            <div className="ml-8 mr-2 my-1">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="bg-[#F5F6FA]">
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
                            <div className="ml-8 mr-2 mt-2 mb-1 flex items-center gap-2">
                              <button
                                onClick={e => { e.stopPropagation(); handleDownloadOrderPdf(order) }}
                                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors hover:bg-gray-50"
                                style={{ borderColor: '#1A2035', color: '#1A2035' }}
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
                                Sales Order PDF
                              </button>
                              <button
                                onClick={e => { e.stopPropagation(); setSlipChecks({ qty: false, desc: false, po: false }); setVerifySlip(order) }}
                                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors hover:bg-gray-50"
                                style={{ borderColor: '#3B6FE0', color: '#3B6FE0' }}
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                                Packing List PDF
                              </button>
                              <button
                                onClick={e => { e.stopPropagation(); handleCaseLabels(order) }}
                                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors hover:bg-gray-50"
                                style={{ borderColor: '#8A5A0B', color: '#8A5A0B' }}
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.99 1.99 0 013 12V7a4 4 0 014-4z" /></svg>
                                Case Labels
                              </button>
                              <button
                                onClick={e => { e.stopPropagation(); handleSendOrderConfirmation(order) }}
                                disabled={sendingConf === order.id}
                                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors hover:bg-gray-50 disabled:opacity-50"
                                style={{ borderColor: '#00A84F', color: '#00863F' }}
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                                {sendingConf === order.id ? 'Sending…' : 'Send Order Confirmation'}
                              </button>
                            </div>
                            <div className="ml-8 mr-2 mb-4 mt-2 border-t border-[#E4E6EE] pt-4">
                              <Comments recordType="sales_order" recordId={order.id} currentUserEmail={userEmail ?? ''} title="Activity Log"/>
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

      {/* ── Completed / Shipped Group — REMOVED. Shipped/Closed/Cancelled orders live only on the Shipments page. ── */}
      {false && completedOrders.length > 0 && (
        <div className="mt-4 rounded-xl overflow-hidden" style={{ border: '1px solid #E4E6EE' }}>
          <button
            onClick={() => setCompletedOpen(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 bg-[#F9FAFB] hover:bg-[#F3F4F6] transition-colors"
          >
            <div className="flex items-center gap-2">
              <svg className={`w-4 h-4 text-gray-400 transition-transform ${completedOpen ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
              <span className="text-sm font-semibold text-gray-500">Completed & Shipped</span>
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 font-medium">{completedOrders.length}</span>
            </div>
            <span className="text-xs text-gray-400">{completedOpen ? 'hide' : 'show'}</span>
          </button>
          {completedOpen && (
            <div className="bg-white overflow-x-auto">
              <table className="w-full min-w-[1100px] text-sm">
                <thead>
                  <tr className="border-b border-[#E4E6EE] bg-[#F9FAFB]">
                    <th className="w-8 px-3 py-2.5"/>
                    {['Customer / Order','PO #','Status','Ship Date','Value','Actions'].map(h => (
                      <th key={h} className="text-left text-xs font-semibold text-gray-500 px-3 py-2.5 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {completedOrders.map((order, i) => {
                    const expanded = expandedCompletedIds.has(order.id)
                    const custName = orderTitle(order)
                    const ref = orderRef(order)
                    return (
                      <>
                        <tr key={order.id}
                          className={`border-b border-[#F3F4F6] transition-colors cursor-pointer ${expanded ? 'bg-[#F5F6FA]/30' : i % 2 === 1 ? 'bg-[#FAFAFA] hover:bg-[#F9FAFB]' : 'hover:bg-[#F9FAFB]'}`}
                          onClick={() => toggleExpandCompleted(order.id)}>
                          <td className="px-3 py-3">
                            <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
                          </td>
                          <td className="px-3 py-3 max-w-[220px]">
                            <p className="text-gray-600 font-medium text-sm truncate">{custName}</p>
                            {ref && <p className="text-gray-400 text-xs truncate mt-0.5">{ref}</p>}
                          </td>
                          <td className="px-3 py-3 text-gray-400 text-xs font-mono whitespace-nowrap">{order.po_number ?? '—'}</td>
                          <td className="px-3 py-3">
                            <div className="flex flex-col gap-1">
                              <StatusBadge status={order.status}/>
                              {woMap[order.id] != null && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-600 border border-indigo-500/20 font-mono whitespace-nowrap w-fit">
                                  WO-{woMap[order.id]}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtD(order.ship_date ?? order.required_ship_date)}</td>
                          <td className="px-3 py-3 text-gray-500 text-xs font-medium whitespace-nowrap">{fmt$(orderValue(order))}</td>
                          <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center gap-1">
                              <button onClick={() => openEdit(order)}
                                className="text-xs px-2 py-1 rounded bg-blue-700/50 hover:bg-blue-700 text-blue-300 transition-colors">Edit</button>
                            </div>
                          </td>
                        </tr>

                        {/* Expanded: line items + activity log */}
                        {expanded && (
                          <tr key={order.id + '-exp'} className="border-b border-[#E4E6EE]/40 bg-[#F9FAFB]/40">
                            <td colSpan={7} className="px-0 py-0">
                              <div className="ml-6 mr-2 my-1">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="bg-[#F5F6FA]">
                                      {['⚠','#','SKU','Product / Description','Qty','Done','UOM','Packaging','Prod. Status','Details','Progress'].map(h => (
                                        <th key={h} className="text-left text-gray-600 px-2 py-2 font-medium first:pl-12">{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    <LinesTable orderId={order.id} onLineUpdated={load}/>
                                  </tbody>
                                </table>
                              </div>
                              <div className="ml-6 mr-2 mt-2 mb-1 flex items-center gap-2">
                                <button
                                  onClick={e => { e.stopPropagation(); handleDownloadOrderPdf(order) }}
                                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors hover:bg-gray-50"
                                  style={{ borderColor: '#1A2035', color: '#1A2035' }}
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
                                  Sales Order PDF
                                </button>
                                <button
                                  onClick={e => { e.stopPropagation(); setSlipChecks({ qty: false, desc: false, po: false }); setVerifySlip(order) }}
                                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors hover:bg-gray-50"
                                  style={{ borderColor: '#3B6FE0', color: '#3B6FE0' }}
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                                  Packing List PDF
                                </button>
                              </div>
                              <div className="ml-6 mr-2 mb-4 mt-2 border-t border-[#E4E6EE] pt-4">
                                <Comments recordType="sales_order" recordId={order.id} currentUserEmail={userEmail ?? ''} title="Activity Log"/>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <BulkActionBar count={ms.count} onDelete={bulkDelete} onClear={ms.clear} deleting={deleting}/>

      {inventoryCheckOrder && (
        <InventoryCheckModal
          orderId={inventoryCheckOrder.id}
          orderNumber={inventoryCheckOrder.order_number}
          onClose={() => setInventoryCheckOrder(null)}
          onDone={result => {
            setInventoryCheckOrder(null)
            if (result === 'shipped') {
              setFlowToast({ message: '✓ Order moved to Shipping Queue' })
            } else if (result === 'production') {
              setFlowToast({ message: '✓ Work orders created — pending approval from Shea/Veejay' })
            }
            load()
          }}
        />
      )}

      {flowToast && (
        <UndoToast
          message={flowToast.message}
          onUndo={flowToast.undoData ? () => handleUndoFlow(flowToast.undoData) : undefined}
          onDismiss={() => setFlowToast(null)}
        />
      )}

      {verifySlip && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" >
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-[#1A1D2E] mb-1">Verify before generating</h3>
            <p className="text-sm text-gray-500 mb-4">Confirm the packing slip matches the order.</p>
            <div className="space-y-2 mb-5">
              {([['qty', 'Quantities match the order'], ['desc', 'Descriptions are correct'], ['po', 'PO number matches']] as const).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 text-sm text-[#1A1D2E] cursor-pointer">
                  <input type="checkbox" checked={(slipChecks as any)[k]} onChange={e => setSlipChecks(sc => ({ ...sc, [k]: e.target.checked }))} className="accent-[#00A84F] w-4 h-4" />
                  {label}
                </label>
              ))}
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setVerifySlip(null)} className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">Cancel</button>
              <button disabled={!(slipChecks.qty && slipChecks.desc && slipChecks.po)} onClick={() => { const o = verifySlip; setVerifySlip(null); if (o) handleDownloadPackingListPdf(o) }} className="px-4 py-2 text-sm rounded-lg bg-[#00854a] text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed">Generate packing slip</button>
            </div>
          </div>
        </div>
      )}
      <EditPanel
        open={editOpen}
        editing={editingOrder}
        form={form} setForm={setForm}
        editLines={editLines} setEditLines={setEditLines}
        customers={customers} products={products} portals={portals}
        err={err} saving={saving}
        onClose={() => { setEditOpen(false); setEditingOrder(null) }}
        onSave={save}
        onDelete={() => editingOrder && handleDelete(editingOrder.id)}
        onDuplicate={() => editingOrder && duplicateOrder(editingOrder)}
        onDownloadSalesOrder={downloadFromForm}
        onSearchLeads={searchLeads}
        userEmail={userEmail ?? ''}
      />
      {confirmDeleteId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-[#1A1D2E] mb-2">Delete Order?</h3>
            <p className="text-sm text-gray-500 mb-5">This will permanently delete this order and all its line items.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmDeleteId(null)} className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">Cancel</button>
              <button onClick={() => executeDelete(confirmDeleteId)} className="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium">Delete</button>
            </div>
          </div>
        </div>
      )}
      {confirmBulkDelete && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-[#1A1D2E] mb-2">Delete {ms.count} Orders?</h3>
            <p className="text-sm text-gray-500 mb-5">This will permanently delete all selected orders and their line items.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmBulkDelete(false)} className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">Cancel</button>
              <button onClick={executeBulkDelete} className="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium">Delete All</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// redeploy: ensure terms/fob/sales_rep save fix is live
