'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { generateCustomerCostingPDF, generateInternalCostingPDF } from '@/lib/generateCostingQuotePDF'

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface QuoteCosting {
  id: string
  quote_number: string
  customer_id: string | null
  customer_name: string | null
  quote_date: string | null
  valid_until: string | null
  prepared_by: string | null
  status: string
  total_exw_cost: number
  total_landed_cost: number
  total_selling_price: number
  total_profit: number
  avg_margin_pct: number
  default_markup_pct: number
  default_duty_pct: number
  freight_method: string
  include_freight_disclaimer: boolean
  notes: string | null
  internal_notes: string | null
  created_at: string
}

interface QuoteLine {
  id?: string
  line_number: number
  description: string
  product_type: string
  specs: string
  country_of_origin: string
  hs_code: string
  freight_method: string
  uom: string
  moq_qty: string
  order_qty: string
  packing_per_case: string
  exw_cost: string
  freight_cost: string
  mpf: string
  hmf: string
  packaging_cost: string
  other_cost_1_label: string
  other_cost_1_amount: string
  other_cost_2_label: string
  other_cost_2_amount: string
  broker_fee: string
  markup_pct: string
  has_retail_packaging: boolean
  retail_packaging_desc: string
  sku: string
  product_id: string | null
  needs_freight_disclaimer: boolean
}

interface Customer { id: string; company_name: string; contact_name?: string | null; email?: string | null; phone?: string | null }

// ─────────────────────────────────────────────
// Calculations
// ─────────────────────────────────────────────
function calcLine(l: QuoteLine) {
  const exw = parseFloat(l.exw_cost) || 0
  const freight = parseFloat(l.freight_cost) || 0
  const mpf = parseFloat(l.mpf) || 0
  const hmf = parseFloat(l.hmf) || 0
  const packing = parseInt(l.packing_per_case) || 0
  const orderQty = parseInt(l.order_qty) || 0
  const markup = parseFloat(l.markup_pct) || 0
  const packaging = parseFloat(l.packaging_cost) || 0
  const other1 = parseFloat(l.other_cost_1_amount) || 0
  const other2 = parseFloat(l.other_cost_2_amount) || 0
  const broker = parseFloat(l.broker_fee) || 0

  const isDomestic = l.freight_method === 'DOMESTIC' || l.country_of_origin === 'USA'
  const china25 = !isDomestic && l.country_of_origin === 'CHINA' ? exw * 0.25 : 0
  const duty10 = !isDomestic ? exw * 0.10 : 0
  const effectiveHmf = !isDomestic && l.freight_method === 'OCEAN' ? hmf : 0
  const totalDuties = isDomestic ? 0 : china25 + duty10 + mpf + effectiveHmf
  const totalCost = exw + freight + totalDuties + packaging + other1 + other2 + broker
  const costPerPiece = packing > 0 ? totalCost / packing : 0
  const selling = totalCost * (1 + markup / 100)
  const sellPiece = packing > 0 ? selling / packing : 0
  const profit = selling - totalCost
  const margin = selling > 0 ? (profit / selling) * 100 : 0
  const totalProfit = orderQty * profit
  const totalIncome = orderQty * selling

  return { exw, freight, china25, duty10, totalDuties, mpf, hmf: effectiveHmf, packaging, other1, other2, broker, totalCost, costPerPiece, selling, sellPiece, profit, margin, totalProfit, totalIncome, packing, orderQty, markup, isDomestic }
}

function marginColor(pct: number) {
  if (pct >= 40) return 'text-emerald-400'
  if (pct >= 25) return 'text-amber-400'
  return 'text-red-400'
}

function marginBg(pct: number) {
  if (pct >= 40) return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'
  if (pct >= 25) return 'bg-amber-500/15 text-amber-400 border-amber-500/20'
  return 'bg-red-500/15 text-red-400 border-red-500/20'
}

const STATUSES = ['Draft', 'Sent', 'Accepted', 'Rejected', 'Expired']
const SC: Record<string, string> = {
  Draft: 'bg-[#F3F4F6] text-gray-600 border-[#E4E6EE]',
  Sent: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  Accepted: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  Rejected: 'bg-red-500/15 text-red-400 border-red-500/20',
  Expired: 'bg-gray-600/20 text-gray-500 border-gray-600',
}

const ORIGINS = ['CHINA', 'INDIA', 'USA', 'MEXICO', 'VIETNAM', 'TAIWAN', 'OTHER']
const FREIGHTS = ['OCEAN', 'AIR', 'DOMESTIC']
const PRODUCT_TYPES = ['Liner Wrap', 'Burger Bag', 'Fry Cup', 'Sandwich Wrap', 'Deli Sheet', 'Hot Dog Bag', 'Tray Liner', 'Tray Cover', 'Napkin', 'Tissue Paper', 'Food Box', 'Sleeve', 'Other']

const fmt$ = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
const fmtPct = (n: number) => n.toFixed(1) + '%'
const dbErr = (e: any) => e?.message || 'Unknown error'

const emptyLine = (): QuoteLine => ({
  line_number: 1, description: '', product_type: '', specs: '',
  country_of_origin: 'CHINA', hs_code: '', freight_method: 'OCEAN',
  uom: 'Case', moq_qty: '0', order_qty: '0', packing_per_case: '0',
  exw_cost: '0', freight_cost: '0', mpf: '0', hmf: '0',
  packaging_cost: '0', other_cost_1_label: '', other_cost_1_amount: '0',
  other_cost_2_label: '', other_cost_2_amount: '0', broker_fee: '0',
  markup_pct: '45', has_retail_packaging: false, retail_packaging_desc: '',
  sku: '', product_id: null, needs_freight_disclaimer: true,
})

const emptyQuoteForm = {
  quote_number: '', customer_id: '', customer_name: '',
  quote_date: new Date().toISOString().slice(0, 10),
  valid_until: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  prepared_by: '', status: 'Draft',
  default_markup_pct: '45', default_duty_pct: '35', freight_method: 'OCEAN',
  include_freight_disclaimer: true, notes: '', internal_notes: '',
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────
export default function QuoteCostingPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])

  const [quotes, setQuotes] = useState<QuoteCosting[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'list' | 'editor'>('list')
  const [editingQuote, setEditingQuote] = useState<QuoteCosting | null>(null)
  const [quoteForm, setQuoteForm] = useState(emptyQuoteForm)
  const [lines, setLines] = useState<QuoteLine[]>([])
  const [lineFormOpen, setLineFormOpen] = useState(false)
  const [editingLineIdx, setEditingLineIdx] = useState<number | null>(null)
  const [lineForm, setLineForm] = useState<QuoteLine>(emptyLine())
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [inlineCustomer, setInlineCustomer] = useState(false)
  const [newCust, setNewCust] = useState({ company_name: '', contact_name: '', email: '', phone: '' })

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: q }, { data: c }] = await Promise.all([
      sb.from('quote_costing').select('*').order('created_at', { ascending: false }),
      sb.from('customers').select('id,company_name,contact_name,email,phone').eq('is_active', true).order('company_name'),
    ])
    if (q) setQuotes(q as QuoteCosting[])
    if (c) setCustomers(c as Customer[])
    setLoading(false)
  }, [sb])

  useEffect(() => {
    load()
    sb.auth.getUser().then(({ data }) => {
      if (data.user?.email) setUserEmail(data.user.email)
    })
  }, [load, sb])

  // Next quote number
  const nextQCNum = useCallback(() => {
    const nums = quotes.map(q => {
      const m = q.quote_number?.match(/QC-\d{4}-(\d+)/)
      return m ? parseInt(m[1]) : 0
    }).filter(Boolean)
    const next = nums.length > 0 ? Math.max(...nums) + 1 : 1001
    return `QC-${new Date().getFullYear()}-${String(next).padStart(4, '0')}`
  }, [quotes])

  function openNew() {
    setEditingQuote(null)
    setQuoteForm({ ...emptyQuoteForm, quote_number: nextQCNum(), prepared_by: userEmail })
    setLines([])
    setErr('')
    setView('editor')
  }

  async function openEdit(q: QuoteCosting) {
    setEditingQuote(q)
    setQuoteForm({
      quote_number: q.quote_number || '',
      customer_id: q.customer_id || '',
      customer_name: q.customer_name || '',
      quote_date: q.quote_date || new Date().toISOString().slice(0, 10),
      valid_until: q.valid_until || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      prepared_by: q.prepared_by || '',
      status: q.status,
      default_markup_pct: String(q.default_markup_pct ?? 45),
      default_duty_pct: String(q.default_duty_pct ?? 35),
      freight_method: q.freight_method || 'OCEAN',
      include_freight_disclaimer: q.include_freight_disclaimer ?? true,
      notes: q.notes || '',
      internal_notes: q.internal_notes || '',
    })
    const { data: ls } = await sb.from('quote_costing_lines').select('*').eq('quote_costing_id', q.id).order('line_number')
    if (ls) {
      setLines(ls.map((l: any) => ({
        id: l.id,
        line_number: l.line_number,
        description: l.description || '',
        product_type: l.product_type || '',
        specs: l.specs || '',
        country_of_origin: l.country_of_origin || 'CHINA',
        hs_code: l.hs_code || '',
        freight_method: l.freight_method || 'OCEAN',
        uom: l.uom || 'Case',
        moq_qty: String(l.moq_qty ?? 0),
        order_qty: String(l.order_qty ?? 0),
        packing_per_case: String(l.packing_per_case ?? 0),
        exw_cost: String(l.exw_cost_per_case ?? 0),
        freight_cost: String(l.freight_cost_per_case ?? 0),
        mpf: String(l.mpf ?? 21.40),
        hmf: String(l.hmf ?? 1.28),
        packaging_cost: String(l.packaging_cost_per_case ?? 0),
        other_cost_1_label: l.other_cost_1_label || '',
        other_cost_1_amount: String(l.other_cost_1_amount ?? 0),
        other_cost_2_label: l.other_cost_2_label || '',
        other_cost_2_amount: String(l.other_cost_2_amount ?? 0),
        broker_fee: String(l.broker_inv_amount ?? 0),
        markup_pct: String(l.markup_pct ?? 45),
        has_retail_packaging: l.has_retail_packaging || false,
        retail_packaging_desc: l.retail_packaging_desc || '',
        sku: l.sku || '',
        product_id: l.product_id || null,
        needs_freight_disclaimer: l.needs_freight_disclaimer ?? true,
      })))
    } else {
      setLines([])
    }
    setErr('')
    setView('editor')
  }

  function backToList() {
    setView('list')
    setEditingQuote(null)
    setLines([])
    setLineFormOpen(false)
  }

  // ── Line form ──
  function openAddLine() {
    setEditingLineIdx(null)
    setLineForm({ ...emptyLine(), markup_pct: quoteForm.default_markup_pct, freight_method: quoteForm.freight_method })
    setLineFormOpen(true)
  }

  function openEditLine(idx: number) {
    setEditingLineIdx(idx)
    setLineForm({ ...lines[idx] })
    setLineFormOpen(true)
  }

  function setLF(patch: Partial<QuoteLine>) {
    setLineForm(prev => ({ ...prev, ...patch }))
  }

  // Auto-calculate MPF and HMF when EXW, freight method, or origin changes
  useEffect(() => {
    const exw = parseFloat(lineForm.exw_cost) || 0
    const isDom = lineForm.freight_method === 'DOMESTIC' || lineForm.country_of_origin === 'USA'
    if (exw > 0 && !isDom) {
      const mpf = parseFloat((exw * 0.003464).toFixed(4))
      const hmf = lineForm.freight_method === 'OCEAN' ? parseFloat((exw * 0.00125).toFixed(4)) : 0
      setLineForm(f => ({ ...f, mpf: String(mpf), hmf: String(hmf) }))
    } else {
      setLineForm(f => ({ ...f, mpf: '0', hmf: '0' }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineForm.exw_cost, lineForm.freight_method, lineForm.country_of_origin])

  function commitLine() {
    if (!lineForm.description.trim()) { setErr('Description is required.'); return }
    setErr('')
    if (editingLineIdx !== null) {
      setLines(prev => prev.map((l, i) => i === editingLineIdx ? { ...lineForm, line_number: i + 1 } : l))
    } else {
      setLines(prev => [...prev, { ...lineForm, line_number: prev.length + 1 }])
    }
    setLineFormOpen(false)
  }

  function removeLine(idx: number) {
    setLines(prev => prev.filter((_, i) => i !== idx).map((l, i) => ({ ...l, line_number: i + 1 })))
  }

  // ── Create inline customer ──
  async function createCustomer() {
    if (!newCust.company_name.trim()) return
    const { data, error } = await sb.from('customers').insert({ company_name: newCust.company_name, contact_name: newCust.contact_name || null, email: newCust.email || null, phone: newCust.phone || null, is_active: true }).select('id,company_name').single()
    if (error || !data) { setErr('Failed to create customer: ' + dbErr(error)); return }
    setCustomers(prev => [...prev, { ...data as Customer }])
    setQuoteForm(p => ({ ...p, customer_id: (data as any).id, customer_name: (data as any).company_name }))
    setNewCust({ company_name: '', contact_name: '', email: '', phone: '' })
    setInlineCustomer(false)
  }

  // ── Save quote ──
  async function saveQuote(status?: string) {
    if (!quoteForm.quote_number.trim()) { setErr('Quote Number is required.'); return }
    setErr(''); setSaving(true)

    // Calculate totals from lines
    const calcs = lines.map(calcLine)
    const totalExw = calcs.reduce((s, c) => s + c.exw * c.orderQty, 0)
    const totalLanded = calcs.reduce((s, c) => s + c.totalCost * c.orderQty, 0)
    const totalSell = calcs.reduce((s, c) => s + c.selling * c.orderQty, 0)
    const totalProfit = calcs.reduce((s, c) => s + c.totalProfit, 0)
    const avgMargin = totalSell > 0 ? (totalProfit / totalSell) * 100 : 0

    const selectedCustomer = customers.find(c => c.id === quoteForm.customer_id)
    const payload = {
      quote_number: quoteForm.quote_number.trim(),
      customer_id: quoteForm.customer_id || null,
      customer_name: selectedCustomer?.company_name || quoteForm.customer_name || null,
      quote_date: quoteForm.quote_date || null,
      valid_until: quoteForm.valid_until || null,
      prepared_by: quoteForm.prepared_by || null,
      status: status || quoteForm.status,
      default_markup_pct: parseFloat(quoteForm.default_markup_pct) || 45,
      default_duty_pct: parseFloat(quoteForm.default_duty_pct) || 35,
      freight_method: quoteForm.freight_method,
      include_freight_disclaimer: quoteForm.include_freight_disclaimer,
      notes: quoteForm.notes || null,
      internal_notes: quoteForm.internal_notes || null,
      total_exw_cost: totalExw,
      total_landed_cost: totalLanded,
      total_selling_price: totalSell,
      total_profit: totalProfit,
      avg_margin_pct: avgMargin,
      updated_at: new Date().toISOString(),
    }

    let qcId = editingQuote?.id
    if (editingQuote) {
      const { error } = await sb.from('quote_costing').update(payload).eq('id', editingQuote.id)
      if (error) { setErr(dbErr(error)); setSaving(false); return }
    } else {
      const { data, error } = await sb.from('quote_costing').insert({ ...payload, created_by: userEmail }).select('id').single()
      if (error || !data) { setErr(dbErr(error)); setSaving(false); return }
      qcId = (data as any).id
    }

    // Delete existing lines and re-insert
    if (editingQuote) {
      await sb.from('quote_costing_lines').delete().eq('quote_costing_id', qcId!)
    }

    if (lines.length > 0) {
      const lineRows = lines.map((l, i) => ({
        quote_costing_id: qcId!,
        line_number: i + 1,
        description: l.description,
        product_type: l.product_type || null,
        specs: l.specs || null,
        country_of_origin: l.country_of_origin,
        hs_code: l.hs_code || null,
        freight_method: l.freight_method,
        uom: l.uom,
        moq_qty: parseInt(l.moq_qty) || 0,
        order_qty: parseInt(l.order_qty) || 0,
        packing_per_case: parseInt(l.packing_per_case) || 0,
        exw_cost_per_case: parseFloat(l.exw_cost) || 0,
        freight_cost_per_case: parseFloat(l.freight_cost) || 0,
        mpf: parseFloat(l.mpf) || 0,
        hmf: parseFloat(l.hmf) || 0,
        packaging_cost_per_case: parseFloat(l.packaging_cost) || 0,
        other_cost_1_label: l.other_cost_1_label || null,
        other_cost_1_amount: parseFloat(l.other_cost_1_amount) || 0,
        other_cost_2_label: l.other_cost_2_label || null,
        other_cost_2_amount: parseFloat(l.other_cost_2_amount) || 0,
        broker_inv_amount: parseFloat(l.broker_fee) || 0,
        markup_pct: parseFloat(l.markup_pct) || 45,
        has_retail_packaging: l.has_retail_packaging,
        retail_packaging_desc: l.retail_packaging_desc || null,
        sku: l.sku || null,
        product_id: l.product_id || null,
        needs_freight_disclaimer: l.needs_freight_disclaimer,
        sort_order: i,
      }))
      const { error: le } = await sb.from('quote_costing_lines').insert(lineRows)
      if (le) { setErr('Failed to save line items: ' + dbErr(le)); setSaving(false); return }

      // Inventory integration: auto-create Quoted-Not Launched products
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]
        if (!l.product_id && l.description.trim()) {
          const sku = l.sku.trim() || `QTD-${Date.now()}-${i}`
          const { data: prod } = await sb.from('products').insert({
            sku,
            product_name: l.description,
            category: l.product_type || 'Other',
            inventory_status: 'Quoted-Not Launched',
            is_active: true,
            on_hand_qty: 0,
            reorder_point: 0,
            unit_price: parseFloat(l.exw_cost) || 0,
          }).select('id').single()
          if (prod) {
            // Update the line with the product_id (fire-and-forget)
            await sb.from('quote_costing_lines')
              .update({ product_id: (prod as any).id, sku })
              .eq('quote_costing_id', qcId!)
              .eq('line_number', i + 1)
          }
        }
      }
    }

    setSaving(false)
    await load()
    // Refresh editing state
    if (!editingQuote) {
      backToList()
    } else {
      const { data: updated } = await sb.from('quote_costing').select('*').eq('id', qcId!).single()
      if (updated) setEditingQuote(updated as QuoteCosting)
    }
  }

  // ── Convert to Quotation ──
  async function convertToQuotation() {
    if (!editingQuote) return
    const calcs = lines.map(calcLine)
    const totalSell = calcs.reduce((s, c) => s + c.selling * c.orderQty, 0)
    const { data: q, error: qe } = await sb.from('quotations').insert({
      quote_number: editingQuote.quote_number,
      customer_id: editingQuote.customer_id,
      quote_date: editingQuote.quote_date,
      expiry_date: editingQuote.valid_until,
      status: 'Draft',
      subtotal: totalSell,
      total: totalSell,
      tax_pct: 0,
      notes: editingQuote.notes,
      is_active: true,
    }).select('id').single()
    if (qe || !q) { setErr('Failed to create quotation: ' + dbErr(qe)); return }
    const lineRows = lines.map((l, i) => {
      const c = calcLine(l)
      return {
        quotation_id: (q as any).id,
        line_number: i + 1,
        product_id: l.product_id || null,
        sku: l.sku || null,
        description: l.description,
        quantity: parseInt(l.order_qty) || 0,
        unit_of_measure: l.uom,
        unit_price: c.selling,
        discount_pct: 0,
      }
    })
    if (lineRows.length > 0) await sb.from('quotation_lines').insert(lineRows)
    // Link
    await sb.from('quote_costing').update({ quotation_id: (q as any).id, status: 'Accepted', updated_at: new Date().toISOString() }).eq('id', editingQuote.id)
    await load()
    backToList()
  }

  // ── PDF actions ──
  async function downloadCustomerPDF() {
    const cust = customers.find(c => c.id === quoteForm.customer_id)
    const header = {
      quote_number: quoteForm.quote_number,
      quote_date: quoteForm.quote_date,
      valid_until: quoteForm.valid_until,
      prepared_by: quoteForm.prepared_by || userEmail,
      customer_name: cust?.company_name || quoteForm.customer_name || '',
      customer_contact: cust?.contact_name || null,
      customer_email: cust?.email || null,
      notes: quoteForm.notes || null,
      include_freight_disclaimer: quoteForm.include_freight_disclaimer,
    }
    const pdfLines = lines.map(l => {
      const c = calcLine(l)
      return {
        line_number: l.line_number,
        description: l.description,
        specs: l.specs || null,
        country_of_origin: l.country_of_origin,
        freight_method: l.freight_method,
        uom: l.uom,
        moq_qty: parseInt(l.moq_qty) || 0,
        order_qty: parseInt(l.order_qty) || 0,
        packing_per_case: c.packing,
        selling_price_per_case: c.selling,
        selling_price_per_piece: c.sellPiece,
        needs_freight_disclaimer: l.needs_freight_disclaimer,
      }
    })
    generateCustomerCostingPDF(header, pdfLines)
  }

  async function downloadInternalPDF() {
    const cust = customers.find(c => c.id === quoteForm.customer_id)
    const header = {
      quote_number: quoteForm.quote_number,
      quote_date: quoteForm.quote_date,
      valid_until: quoteForm.valid_until,
      prepared_by: quoteForm.prepared_by || userEmail,
      customer_name: cust?.company_name || quoteForm.customer_name || '',
      notes: quoteForm.internal_notes || quoteForm.notes || null,
      include_freight_disclaimer: false,
    }
    const pdfLines = lines.map(l => {
      const c = calcLine(l)
      return {
        line_number: l.line_number,
        description: l.description,
        specs: l.specs || null,
        country_of_origin: l.country_of_origin,
        freight_method: l.freight_method,
        uom: l.uom,
        moq_qty: parseInt(l.moq_qty) || 0,
        order_qty: parseInt(l.order_qty) || 0,
        packing_per_case: c.packing,
        exw_cost_per_case: c.exw,
        freight_cost_per_case: c.freight,
        china_tariff_25_pct: c.china25,
        duty_10_pct: c.duty10,
        mpf: c.mpf,
        hmf: c.hmf,
        total_duties_per_case: c.totalDuties,
        total_cost_per_case: c.totalCost,
        cost_per_piece: c.costPerPiece,
        markup_pct: c.markup,
        selling_price_per_case: c.selling,
        selling_price_per_piece: c.sellPiece,
        profit_per_case: c.profit,
        profit_margin_pct: c.margin,
        total_profit: c.totalProfit,
        total_income: c.totalIncome,
        needs_freight_disclaimer: l.needs_freight_disclaimer,
      }
    })
    generateInternalCostingPDF(header, pdfLines)
  }

  // ── Styles ──
  const inp = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition'
  const inpSm = 'w-full bg-[#F9FAFB]/80 border border-[#E4E6EE]/60 text-[#1A1D2E] placeholder-[#9CA3AF] rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 transition'
  const label = 'block text-xs text-gray-400 mb-1'
  const sectionHead = 'text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2'

  const filtered = quotes.filter(q => {
    if (!search) return true
    const s = search.toLowerCase()
    return (q.quote_number || '').toLowerCase().includes(s) ||
      (q.customer_name || '').toLowerCase().includes(s) ||
      q.status.toLowerCase().includes(s)
  })

  // ── Summary calcs ──
  const allCalcs = lines.map(calcLine)
  const summaryExw = allCalcs.reduce((s, c) => s + c.exw * c.orderQty, 0)
  const summaryLanded = allCalcs.reduce((s, c) => s + c.totalCost * c.orderQty, 0)
  const summarySell = allCalcs.reduce((s, c) => s + c.selling * c.orderQty, 0)
  const summaryProfit = allCalcs.reduce((s, c) => s + c.totalProfit, 0)
  const summaryMargin = summarySell > 0 ? (summaryProfit / summarySell) * 100 : 0

  const liveCalc = calcLine(lineForm)

  // ═══════════════════════════════
  // LIST VIEW
  // ═══════════════════════════════
  if (view === 'list') return (
    <div className="p-4 md:p-8 min-h-screen">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-emerald-500/20 text-emerald-300 border-emerald-500/30">SALES</span>
          <h1 className="text-2xl font-semibold text-[#1A1D2E] mt-1">Quick Quote — Costing Tool</h1>
          <p className="text-gray-500 text-sm mt-0.5">Build customer quotes with full landed cost and margin analysis</p>
        </div>
        <button onClick={openNew} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-[#1A1D2E] text-sm font-medium px-4 py-2.5 rounded-lg transition-colors self-start">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          New Quote
        </button>
      </div>

      <div className="relative mb-4 max-w-sm">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        <input placeholder="Search quotes…" value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition" />
      </div>

      <div className="rounded-xl border border-[#E4E6EE] bg-white overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20"><svg className="w-5 h-5 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <svg className="w-10 h-10 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
            <p className="text-gray-500 text-sm">{search ? 'No matches.' : 'No costing quotes yet. Click New Quote to get started.'}</p>
          </div>
        ) : (
          <table className="w-full min-w-[800px] text-sm">
            <thead>
              <tr className="border-b border-[#E4E6EE]">
                {['Quote #', 'Customer', 'Date', 'Items', 'Total Cost', 'Selling Price', 'Profit', 'Margin', 'Status'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 px-5 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((q, i) => (
                <tr key={q.id} onClick={() => openEdit(q)} className={`border-b border-[#E4E6EE]/60 last:border-0 cursor-pointer hover:bg-[#F9FAFB] transition-colors ${i % 2 ? 'bg-[#F5F6FA]/10' : ''}`}>
                  <td className="px-5 py-3.5 text-[#1A1D2E] font-medium font-mono text-xs">{q.quote_number}</td>
                  <td className="px-5 py-3.5 text-gray-400">{q.customer_name || '—'}</td>
                  <td className="px-5 py-3.5 text-gray-400">{q.quote_date ? new Date(q.quote_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                  <td className="px-5 py-3.5 text-gray-400 tabular-nums">—</td>
                  <td className="px-5 py-3.5 text-gray-300 tabular-nums">{fmt$(q.total_landed_cost)}</td>
                  <td className="px-5 py-3.5 text-[#1A1D2E] font-medium tabular-nums">{fmt$(q.total_selling_price)}</td>
                  <td className="px-5 py-3.5 text-emerald-400 tabular-nums">{fmt$(q.total_profit)}</td>
                  <td className="px-5 py-3.5">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium border ${marginBg(q.avg_margin_pct)}`}>{fmtPct(q.avg_margin_pct)}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium border ${SC[q.status] || SC.Draft}`}>{q.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )

  // ═══════════════════════════════
  // EDITOR VIEW
  // ═══════════════════════════════
  return (
    <div className="min-h-screen bg-[#F9FAFB] flex flex-col">
      {/* Editor top bar */}
      <div className="sticky top-0 z-20 bg-white border-b border-[#E4E6EE] px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={backToList} className="text-gray-400 hover:text-gray-700 p-1.5 rounded-lg hover:bg-[#F5F6FA] transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div>
            <h2 className="text-[#1A1D2E] font-semibold text-sm">{editingQuote ? `Edit ${editingQuote.quote_number}` : 'New Costing Quote'}</h2>
            <p className="text-gray-500 text-xs">{lines.length} line item{lines.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {lines.length > 0 && <>
            <button onClick={downloadCustomerPDF} className="flex items-center gap-1.5 text-xs border border-[#E4E6EE] text-gray-400 hover:text-gray-700 hover:border-gray-600 px-2.5 py-1.5 rounded-lg transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
              Customer PDF
            </button>
            <button onClick={downloadInternalPDF} className="flex items-center gap-1.5 text-xs border border-[#E4E6EE] text-gray-400 hover:text-gray-700 hover:border-gray-600 px-2.5 py-1.5 rounded-lg transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              Internal PDF
            </button>
            {editingQuote && (
              <button onClick={convertToQuotation} className="flex items-center gap-1.5 text-xs bg-blue-700 hover:bg-blue-600 text-white px-2.5 py-1.5 rounded-lg transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                → Quotation
              </button>
            )}
          </>}
          <button onClick={() => saveQuote()} disabled={saving} className="flex items-center gap-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-[#1A1D2E] font-medium px-4 py-2 rounded-lg transition-colors">
            {saving ? 'Saving…' : editingQuote ? 'Save' : 'Save Draft'}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Main editor area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {err && <div className="flex gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3"><svg className="w-4 h-4 text-red-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg><p className="text-red-400 text-sm">{err}</p></div>}

          {/* ── Quote Header ── */}
          <div className="bg-white border border-[#E4E6EE] rounded-xl p-5">
            <p className={sectionHead}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              Quote Header
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <label className={label}>Quote Number <span className="text-red-400">*</span></label>
                <input value={quoteForm.quote_number} onChange={e => setQuoteForm(p => ({ ...p, quote_number: e.target.value }))} className={inp} />
              </div>
              <div>
                <label className={label}>Status</label>
                <select value={quoteForm.status} onChange={e => setQuoteForm(p => ({ ...p, status: e.target.value }))} className={inp + ' cursor-pointer'}>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={label}>Prepared By</label>
                <input value={quoteForm.prepared_by} onChange={e => setQuoteForm(p => ({ ...p, prepared_by: e.target.value }))} placeholder={userEmail} className={inp} />
              </div>
              <div>
                <label className={label}>Quote Date</label>
                <input type="date" value={quoteForm.quote_date} onChange={e => setQuoteForm(p => ({ ...p, quote_date: e.target.value }))} className={inp} />
              </div>
              <div>
                <label className={label}>Valid Until</label>
                <input type="date" value={quoteForm.valid_until} onChange={e => setQuoteForm(p => ({ ...p, valid_until: e.target.value }))} className={inp} />
              </div>
              <div className="col-span-2 md:col-span-1">
                <label className={label}>Customer</label>
                <select value={quoteForm.customer_id} onChange={e => setQuoteForm(p => ({ ...p, customer_id: e.target.value }))} className={inp + ' cursor-pointer'}>
                  <option value="">— Select Customer —</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                </select>
                <button onClick={() => setInlineCustomer(v => !v)} className="mt-1.5 text-xs text-emerald-400 hover:text-emerald-300">
                  {inlineCustomer ? '▲ Cancel' : '+ Create new customer'}
                </button>
              </div>
            </div>

            {inlineCustomer && (
              <div className="mt-4 p-4 bg-[#F0F2F7] border border-[#E4E6EE] rounded-lg">
                <p className="text-xs font-semibold text-gray-400 mb-3">New Customer</p>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={label}>Company Name *</label><input value={newCust.company_name} onChange={e => setNewCust(p => ({ ...p, company_name: e.target.value }))} className={inpSm} /></div>
                  <div><label className={label}>Contact Name</label><input value={newCust.contact_name} onChange={e => setNewCust(p => ({ ...p, contact_name: e.target.value }))} className={inpSm} /></div>
                  <div><label className={label}>Email</label><input value={newCust.email} onChange={e => setNewCust(p => ({ ...p, email: e.target.value }))} className={inpSm} /></div>
                  <div><label className={label}>Phone</label><input value={newCust.phone} onChange={e => setNewCust(p => ({ ...p, phone: e.target.value }))} className={inpSm} /></div>
                </div>
                <button onClick={createCustomer} className="mt-3 text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg">Create & Select</button>
              </div>
            )}
          </div>

          {/* ── Settings ── */}
          <div className="bg-white border border-[#E4E6EE] rounded-xl p-5">
            <p className={sectionHead}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
              Default Settings
            </p>
            <div className="flex flex-wrap gap-6">
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-400 whitespace-nowrap">Default Markup %</label>
                <input type="number" value={quoteForm.default_markup_pct} onChange={e => setQuoteForm(p => ({ ...p, default_markup_pct: e.target.value }))} min="0" max="500" step="1" className="w-20 bg-white border border-[#E4E6EE] text-[#1A1D2E] rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-400 whitespace-nowrap" title="Standard: 25% China tariff + 10% duty">Default Duty % ⓘ</label>
                <input type="number" value={quoteForm.default_duty_pct} onChange={e => setQuoteForm(p => ({ ...p, default_duty_pct: e.target.value }))} min="0" max="200" step="1" className="w-20 bg-white border border-[#E4E6EE] text-[#1A1D2E] rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-400">Freight Method</label>
                {FREIGHTS.map(f => (
                  <button key={f} onClick={() => setQuoteForm(p => ({ ...p, freight_method: f }))} className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${quoteForm.freight_method === f ? 'bg-emerald-600 border-emerald-500 text-white' : 'border-[#E4E6EE] text-gray-400 hover:border-gray-600'}`}>{f}</button>
                ))}
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={quoteForm.include_freight_disclaimer} onChange={e => setQuoteForm(p => ({ ...p, include_freight_disclaimer: e.target.checked }))} className="rounded border-gray-600" />
                <span className="text-xs text-gray-400">Include freight disclaimer on PDF</span>
              </label>
            </div>
          </div>

          {/* ── Line Items ── */}
          <div className="bg-white border border-[#E4E6EE] rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <p className={sectionHead + ' mb-0'}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                Line Items
              </p>
              <button onClick={openAddLine} className="flex items-center gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                Add Item
              </button>
            </div>

            {lines.length === 0 ? (
              <div className="border-2 border-dashed border-[#E4E6EE] rounded-lg py-12 flex flex-col items-center gap-3">
                <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" /></svg>
                <p className="text-gray-500 text-sm">No line items yet. Click Add Item to begin.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[900px]">
                  <thead>
                    <tr className="bg-[#F9FAFB]/80 border-b border-[#E4E6EE]">
                      {['#', 'Description', 'Origin', 'Freight', 'Cases', 'Pcs/Cs', 'EXW/Cs', 'Duties/Cs', 'Total Cost', 'Markup', 'Sell/Cs', 'Sell/Pc', 'Margin', 'Total Profit', ''].map(h => (
                        <th key={h} className="text-left text-gray-500 px-2 py-2 font-medium first:pl-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => {
                      const c = calcLine(l)
                      return (
                        <tr key={i} className="border-b border-[#E4E6EE]/60 last:border-0 hover:bg-[#F9FAFB] group">
                          <td className="pl-3 pr-1 py-2 text-gray-500">{i + 1}</td>
                          <td className="px-2 py-2">
                            <div className="text-[#1A1D2E] font-medium max-w-[180px] truncate">{l.description}</div>
                            {l.specs && <div className="text-gray-500 text-xs truncate max-w-[180px]">{l.specs}</div>}
                          </td>
                          <td className="px-2 py-2 text-gray-400">{l.country_of_origin}</td>
                          <td className="px-2 py-2 text-gray-400">{l.freight_method}</td>
                          <td className="px-2 py-2 text-gray-400 tabular-nums">{parseInt(l.order_qty).toLocaleString()}</td>
                          <td className="px-2 py-2 text-gray-400 tabular-nums">{parseInt(l.packing_per_case).toLocaleString()}</td>
                          <td className="px-2 py-2 text-gray-300 tabular-nums">{fmt$(c.exw)}</td>
                          <td className="px-2 py-2 text-gray-400 tabular-nums">{fmt$(c.totalDuties)}</td>
                          <td className="px-2 py-2 text-gray-200 font-medium tabular-nums">{fmt$(c.totalCost)}</td>
                          <td className="px-2 py-2 text-gray-400">{c.markup.toFixed(0)}%</td>
                          <td className="px-2 py-2 text-emerald-300 font-semibold tabular-nums">{fmt$(c.selling)}</td>
                          <td className="px-2 py-2 text-gray-400 tabular-nums">{fmt$(c.sellPiece)}</td>
                          <td className="px-2 py-2">
                            <span className={`font-semibold tabular-nums ${marginColor(c.margin)}`}>{fmtPct(c.margin)}</span>
                          </td>
                          <td className="px-2 py-2 text-gray-300 tabular-nums">{fmt$(c.totalProfit)}</td>
                          <td className="px-2 py-2">
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => openEditLine(i)} className="p-1 text-gray-500 hover:text-gray-700 rounded hover:bg-[#F5F6FA]"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></button>
                              <button onClick={() => removeLine(i)} className="p-1 text-gray-500 hover:text-red-400 rounded hover:bg-[#F5F6FA]"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  {/* Summary row */}
                  {lines.length > 1 && (
                    <tfoot>
                      <tr className="border-t-2 border-[#E4E6EE] bg-[#F9FAFB]/40">
                        <td colSpan={4} className="pl-3 pr-2 py-2 text-xs font-bold text-gray-400">TOTALS</td>
                        <td className="px-2 py-2 text-gray-300 font-semibold tabular-nums">{allCalcs.reduce((s, c) => s + c.orderQty, 0).toLocaleString()}</td>
                        <td></td>
                        <td className="px-2 py-2 text-gray-200 font-semibold tabular-nums">{fmt$(summaryExw)}</td>
                        <td></td>
                        <td className="px-2 py-2 text-[#1A1D2E] font-bold tabular-nums">{fmt$(summaryLanded)}</td>
                        <td></td>
                        <td className="px-2 py-2 text-emerald-300 font-bold tabular-nums">{fmt$(summarySell)}</td>
                        <td></td>
                        <td className="px-2 py-2">
                          <span className={`font-bold tabular-nums ${marginColor(summaryMargin)}`}>{fmtPct(summaryMargin)}</span>
                        </td>
                        <td className="px-2 py-2 text-gray-200 font-bold tabular-nums">{fmt$(summaryProfit)}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </div>

          {/* ── Notes ── */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white border border-[#E4E6EE] rounded-xl p-5">
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Customer Notes</label>
              <textarea rows={3} value={quoteForm.notes} onChange={e => setQuoteForm(p => ({ ...p, notes: e.target.value }))} placeholder="Notes visible on customer PDF…" className={inp + ' resize-none'} />
            </div>
            <div className="bg-white border border-[#E4E6EE] rounded-xl p-5">
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Internal Notes <span className="ml-1 text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded text-xs">Internal Only</span></label>
              <textarea rows={3} value={quoteForm.internal_notes} onChange={e => setQuoteForm(p => ({ ...p, internal_notes: e.target.value }))} placeholder="Internal notes (not on customer PDF)…" className={inp + ' resize-none'} />
            </div>
          </div>
        </div>

        {/* Right sidebar — Financial Summary */}
        <div className="w-72 shrink-0 border-l border-[#E4E6EE] bg-white p-5 overflow-y-auto hidden lg:block">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Financial Summary</p>
          <div className="space-y-3">
            {[
              { label: 'Total EXW Cost', val: summaryExw, color: 'text-gray-300' },
              { label: 'Total Landed Cost', val: summaryLanded, color: 'text-[#1A1D2E] font-medium' },
              { label: 'Total Selling Price', val: summarySell, color: 'text-emerald-400 font-semibold' },
              { label: 'Total Profit', val: summaryProfit, color: 'text-emerald-300 font-semibold' },
            ].map(row => (
              <div key={row.label} className="flex justify-between items-center">
                <span className="text-xs text-gray-500">{row.label}</span>
                <span className={`text-sm tabular-nums ${row.color}`}>{fmt$(row.val)}</span>
              </div>
            ))}
            <div className="border-t border-[#E4E6EE] pt-3 flex justify-between items-center">
              <span className="text-xs text-gray-400 font-medium">Overall Margin</span>
              <span className={`text-lg font-bold tabular-nums ${marginColor(summaryMargin)}`}>{fmtPct(summaryMargin)}</span>
            </div>
          </div>

          {lines.length > 0 && (
            <div className="mt-6 pt-4 border-t border-[#E4E6EE]">
              <p className="text-xs text-gray-500 mb-3">Margin by line</p>
              <div className="space-y-2">
                {lines.map((l, i) => {
                  const c = calcLine(l)
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-gray-600 text-xs w-4">{i + 1}</span>
                      <div className="flex-1 bg-[#F9FAFB] rounded-full h-1.5 overflow-hidden">
                        <div className={`h-full rounded-full ${c.margin >= 40 ? 'bg-emerald-500' : c.margin >= 25 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${Math.min(c.margin, 100)}%` }} />
                      </div>
                      <span className={`text-xs tabular-nums w-12 text-right ${marginColor(c.margin)}`}>{fmtPct(c.margin)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="mt-6 space-y-2">
            <button onClick={() => saveQuote()} disabled={saving} className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-[#1A1D2E] text-sm font-medium py-2.5 rounded-lg transition-colors">
              {saving ? 'Saving…' : 'Save Draft'}
            </button>
            {lines.length > 0 && (
              <button onClick={downloadCustomerPDF} className="w-full flex items-center justify-center gap-2 border border-[#E4E6EE] text-gray-400 hover:text-[#1A1D2E] text-sm py-2.5 rounded-lg transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                Download Customer PDF
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ═══ LINE ITEM FORM PANEL ═══ */}
      <div className={`fixed inset-0 bg-black/60 z-30 transition-opacity duration-300 ${lineFormOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={() => setLineFormOpen(false)} />
      <div className={`fixed top-0 right-0 h-full w-full max-w-[640px] bg-white border-l border-[#E4E6EE] z-40 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${lineFormOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E4E6EE] shrink-0">
          <h3 className="text-[#1A1D2E] font-semibold text-sm">{editingLineIdx !== null ? 'Edit Line Item' : 'Add Line Item'}</h3>
          <button onClick={() => setLineFormOpen(false)} className="text-gray-500 hover:text-gray-700 p-1 rounded-lg hover:bg-[#F5F6FA]">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Section A: Product Details */}
          <div>
            <p className={sectionHead}>
              <span className="w-5 h-5 rounded-full bg-emerald-600 flex items-center justify-center text-[#1A1D2E] text-xs font-bold">A</span>
              Product Details
            </p>
            <div className="space-y-3">
              <div>
                <label className={label}>Description <span className="text-red-400">*</span></label>
                <input value={lineForm.description} onChange={e => setLF({ description: e.target.value })} placeholder="e.g. Liner Wrap | Kraft | 12×12″" className={inp} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label}>Product Type</label>
                  <select value={lineForm.product_type} onChange={e => setLF({ product_type: e.target.value })} className={inp + ' cursor-pointer'}>
                    <option value="">— Select —</option>
                    {PRODUCT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label}>SKU (optional)</label>
                  <input value={lineForm.sku} onChange={e => setLF({ sku: e.target.value })} placeholder="e.g. LW-12X12-KFT" className={inp} />
                </div>
              </div>
              <div>
                <label className={label}>Specs / Size / Colors</label>
                <input value={lineForm.specs} onChange={e => setLF({ specs: e.target.value })} placeholder='e.g. 12×12" | 2 color | Orange 164C' className={inp} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label}>Country of Origin</label>
                  <select value={lineForm.country_of_origin} onChange={e => setLF({ country_of_origin: e.target.value })} className={inp + ' cursor-pointer'}>
                    {ORIGINS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label}>HS Code</label>
                  <input value={lineForm.hs_code} onChange={e => setLF({ hs_code: e.target.value })} placeholder="e.g. 4823.90.8000" className={inp} />
                </div>
              </div>
              <div>
                <label className={label}>Freight Method</label>
                <div className="flex gap-2">
                  {FREIGHTS.map(f => (
                    <button key={f} type="button" onClick={() => setLF({ freight_method: f, needs_freight_disclaimer: f !== 'DOMESTIC' })} className={`flex-1 py-2 rounded-lg border text-sm transition-colors ${lineForm.freight_method === f ? 'bg-emerald-600 border-emerald-500 text-[#1A1D2E] font-medium' : 'border-[#E4E6EE] text-gray-400 hover:border-gray-600'}`}>{f}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Section B: Quantities */}
          <div>
            <p className={sectionHead}>
              <span className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center text-[#1A1D2E] text-xs font-bold">B</span>
              Quantities
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>MOQ (Cases)</label>
                <input type="number" value={lineForm.moq_qty} onChange={e => setLF({ moq_qty: e.target.value })} min="0" className={inp} />
              </div>
              <div>
                <label className={label}>Order Quantity (Cases)</label>
                <input type="number" value={lineForm.order_qty} onChange={e => setLF({ order_qty: e.target.value })} min="0" className={inp} />
              </div>
              <div>
                <label className={label}>Packing per Case (Pieces)</label>
                <input type="number" value={lineForm.packing_per_case} onChange={e => setLF({ packing_per_case: e.target.value })} min="0" className={inp} />
              </div>
              <div>
                <label className={label}>UOM</label>
                <select value={lineForm.uom} onChange={e => setLF({ uom: e.target.value })} className={inp + ' cursor-pointer'}>
                  {['Case', 'Each', 'Box', 'Roll', 'Pallet', 'Sheet'].map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Section C: Costs (Internal) */}
          <div>
            <p className={sectionHead}>
              <span className="w-5 h-5 rounded-full bg-amber-600 flex items-center justify-center text-[#1A1D2E] text-xs font-bold">C</span>
              Cost Inputs
              <span className="ml-auto text-xs font-normal text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">🔒 Internal Only</span>
            </p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label}>EXW Cost per Case</label>
                  <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span><input type="number" value={lineForm.exw_cost} onChange={e => setLF({ exw_cost: e.target.value })} min="0" step="0.01" placeholder="Enter factory/supplier cost" className={inp + ' pl-7'} /></div>
                </div>
                <div>
                  <label className={label} title="Inbound freight to Santa Ana">Freight/Logistics per Case ⓘ</label>
                  <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span><input type="number" value={lineForm.freight_cost} onChange={e => setLF({ freight_cost: e.target.value })} min="0" step="0.01" className={inp + ' pl-7'} /></div>
                </div>
              </div>

              {/* Duty calculator */}
              {(lineForm.freight_method === 'DOMESTIC' || lineForm.country_of_origin === 'USA') ? (
                <div className="bg-[#F9FAFB]/40 border border-[#E4E6EE]/40 rounded-lg p-3 text-xs text-gray-500 text-center">
                  {lineForm.freight_method === 'DOMESTIC'
                    ? 'No import duties — domestic freight selected.'
                    : 'No import duties — USA origin product.'}
                </div>
              ) : (
                <div className="bg-[#F0F2F7] border border-[#E4E6EE]/60 rounded-lg p-4">
                  <p className="text-xs font-semibold text-gray-400 mb-3">Duty Calculator — Auto-Calculated from EXW</p>
                  <div className="space-y-2">
                    {lineForm.country_of_origin === 'CHINA' && (
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-gray-400">China 25% Tariff <span className="text-gray-600">(EXW × 25%)</span></span>
                        <span className={`tabular-nums font-medium ${liveCalc.exw > 0 ? 'text-amber-400' : 'text-gray-600'}`}>
                          {liveCalc.exw > 0 ? fmt$(liveCalc.china25) : '—'}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-gray-400">Duty 10% <span className="text-gray-600">(EXW × 10%)</span></span>
                      <span className={`tabular-nums ${liveCalc.exw > 0 ? 'text-gray-300' : 'text-gray-600'}`}>
                        {liveCalc.exw > 0 ? fmt$(liveCalc.duty10) : '—'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className={label}>
                          MPF <span className="text-gray-600 text-[10px]">auto: EXW × 0.3464%</span>
                        </label>
                        <div className="relative"><span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs">$</span><input type="number" value={lineForm.mpf} onChange={e => setLF({ mpf: e.target.value })} step="0.0001" className={inpSm + ' pl-5'} /></div>
                        <p className="text-[10px] text-gray-600 mt-0.5">Min $32.71/shipment entry (not per case)</p>
                      </div>
                      <div>
                        <label className={label}>
                          HMF <span className="text-gray-600 text-[10px]">{lineForm.freight_method === 'OCEAN' ? 'auto: EXW × 0.125%' : 'ocean only'}</span>
                        </label>
                        <div className="relative"><span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs">$</span><input type="number" value={lineForm.hmf} onChange={e => setLF({ hmf: e.target.value })} step="0.0001" disabled={lineForm.freight_method !== 'OCEAN'} className={inpSm + ' pl-5' + (lineForm.freight_method !== 'OCEAN' ? ' opacity-40 cursor-not-allowed' : '')} /></div>
                        <p className="text-[10px] text-gray-600 mt-0.5">Ocean freight only: 0.125% of EXW cost</p>
                      </div>
                    </div>
                    <div className="border-t border-[#E4E6EE] pt-2 flex justify-between items-center text-xs font-semibold">
                      <span className="text-gray-400">Total Duties per Case</span>
                      <span className={`tabular-nums ${liveCalc.exw > 0 ? 'text-[#1A1D2E]' : 'text-gray-400'}`}>
                        {liveCalc.exw > 0 ? fmt$(liveCalc.totalDuties) : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label}>Broker Fee per Case</label>
                  <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span><input type="number" value={lineForm.broker_fee} onChange={e => setLF({ broker_fee: e.target.value })} min="0" step="0.01" className={inp + ' pl-7'} /></div>
                </div>
                <div />
              </div>

              {/* Retail packaging */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={lineForm.has_retail_packaging} onChange={e => setLF({ has_retail_packaging: e.target.checked })} className="rounded border-gray-600" />
                <span className="text-xs text-gray-400">This item includes retail packaging</span>
              </label>
              {lineForm.has_retail_packaging && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={label}>Packaging Description</label>
                    <input value={lineForm.retail_packaging_desc} onChange={e => setLF({ retail_packaging_desc: e.target.value })} placeholder="e.g. Poly bag + label" className={inpSm} />
                  </div>
                  <div>
                    <label className={label}>Packaging Cost per Case</label>
                    <div className="relative"><span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs">$</span><input type="number" value={lineForm.packaging_cost} onChange={e => setLF({ packaging_cost: e.target.value })} step="0.01" className={inpSm + ' pl-5'} /></div>
                  </div>
                </div>
              )}

              {/* Additional costs */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label}>Additional Cost 1 — Label</label>
                  <input value={lineForm.other_cost_1_label} onChange={e => setLF({ other_cost_1_label: e.target.value })} placeholder="e.g. Testing fee" className={inpSm} />
                </div>
                <div>
                  <label className={label}>Amount</label>
                  <div className="relative"><span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs">$</span><input type="number" value={lineForm.other_cost_1_amount} onChange={e => setLF({ other_cost_1_amount: e.target.value })} step="0.01" className={inpSm + ' pl-5'} /></div>
                </div>
                <div>
                  <label className={label}>Additional Cost 2 — Label</label>
                  <input value={lineForm.other_cost_2_label} onChange={e => setLF({ other_cost_2_label: e.target.value })} placeholder="e.g. Label fee" className={inpSm} />
                </div>
                <div>
                  <label className={label}>Amount</label>
                  <div className="relative"><span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs">$</span><input type="number" value={lineForm.other_cost_2_amount} onChange={e => setLF({ other_cost_2_amount: e.target.value })} step="0.01" className={inpSm + ' pl-5'} /></div>
                </div>
              </div>
            </div>
          </div>

          {/* Section D: Live Cost Summary + Selling Price */}
          <div>
            <p className={sectionHead}>
              <span className="w-5 h-5 rounded-full bg-violet-600 flex items-center justify-center text-[#1A1D2E] text-xs font-bold">D</span>
              Live Cost & Selling Price
            </p>
            <div className="bg-[#F0F2F7] border border-[#E4E6EE]/60 rounded-xl overflow-hidden">
              {liveCalc.exw === 0 ? (
                /* Empty state — no EXW entered yet */
                <div className="px-4 py-8 text-center">
                  <svg className="w-8 h-8 text-gray-700 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <p className="text-gray-500 text-sm">Enter EXW cost above to see cost breakdown</p>
                </div>
              ) : (
                <>
                  {/* Cost breakdown */}
                  <div className="px-4 py-3 space-y-1.5">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Cost Breakdown (Internal)</p>
                    {[
                      { label: 'EXW Cost', val: liveCalc.exw },
                      liveCalc.freight > 0 ? { label: 'Freight/Logistics', val: liveCalc.freight } : null,
                      liveCalc.china25 > 0 ? { label: 'China 25% Tariff', val: liveCalc.china25 } : null,
                      liveCalc.duty10 > 0 ? { label: 'Duty 10%', val: liveCalc.duty10 } : null,
                      (liveCalc.mpf + liveCalc.hmf) > 0 ? { label: 'MPF + HMF', val: liveCalc.mpf + liveCalc.hmf } : null,
                      liveCalc.packaging > 0 ? { label: 'Packaging', val: liveCalc.packaging } : null,
                      liveCalc.other1 > 0 ? { label: lineForm.other_cost_1_label || 'Other Cost 1', val: liveCalc.other1 } : null,
                      liveCalc.other2 > 0 ? { label: lineForm.other_cost_2_label || 'Other Cost 2', val: liveCalc.other2 } : null,
                      liveCalc.broker > 0 ? { label: 'Broker Fee', val: liveCalc.broker } : null,
                    ].filter(Boolean).map((row, i) => (
                      <div key={i} className="flex justify-between items-center text-xs">
                        <span className="text-gray-400">{(row as any).label}</span>
                        <span className="text-gray-300 tabular-nums">{fmt$((row as any).val)}/case</span>
                      </div>
                    ))}
                  </div>

                  {/* Total landed */}
                  <div className="border-t border-[#E4E6EE] px-4 py-3 bg-[#F9FAFB]/50 flex justify-between items-center">
                    <span className="text-sm font-bold text-[#1A1D2E]">TOTAL LANDED COST</span>
                    <span className="text-sm font-bold text-[#1A1D2E] tabular-nums">{fmt$(liveCalc.totalCost)}/case</span>
                  </div>
                  {liveCalc.packing > 0 && (
                    <div className="px-4 pb-2 flex justify-between items-center text-xs">
                      <span className="text-gray-500">Cost per Piece</span>
                      <span className="text-gray-400 tabular-nums">{fmt$(liveCalc.costPerPiece)}/piece</span>
                    </div>
                  )}

                  {/* Selling price */}
                  <div className="border-t border-[#E4E6EE] px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-xs font-semibold text-gray-400">MARKUP %</span>
                      <div className="flex items-center gap-1">
                        <input type="number" value={lineForm.markup_pct} onChange={e => setLF({ markup_pct: e.target.value })} min="0" max="500" step="1" className="w-20 bg-white border border-[#E4E6EE] text-[#1A1D2E] rounded px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                        <span className="text-gray-400 text-sm">%</span>
                      </div>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Selling Price/Case</span>
                      <span className="text-emerald-400 font-bold tabular-nums">{fmt$(liveCalc.selling)}</span>
                    </div>
                    {liveCalc.packing > 0 && (
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-500">Selling Price/Piece</span>
                        <span className="text-emerald-300 tabular-nums">{fmt$(liveCalc.sellPiece)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Profit/Case</span>
                      <span className="text-gray-300 tabular-nums">{fmt$(liveCalc.profit)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-500">Profit Margin</span>
                      <span className={`text-base font-bold tabular-nums ${marginColor(liveCalc.margin)}`}>{fmtPct(liveCalc.margin)}</span>
                    </div>
                  </div>

                  {parseInt(lineForm.order_qty) > 0 && (
                    <div className="border-t border-[#E4E6EE] px-4 py-3 bg-emerald-900/20 space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-400">Total Income ({lineForm.order_qty} cases)</span>
                        <span className="text-emerald-300 font-semibold tabular-nums">{fmt$(liveCalc.totalIncome)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-400">Total Profit</span>
                        <span className="text-emerald-400 font-bold tabular-nums">{fmt$(liveCalc.totalProfit)}</span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Line form footer */}
        <div className="shrink-0 px-6 py-4 border-t border-[#E4E6EE] flex gap-3">
          <button onClick={() => setLineFormOpen(false)} className="flex-1 text-sm py-2.5 rounded-lg border border-[#E4E6EE] text-gray-400 hover:text-gray-700 transition-colors">Cancel</button>
          <button onClick={commitLine} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-[#1A1D2E] text-sm font-medium py-2.5 rounded-lg transition-colors">
            {editingLineIdx !== null ? 'Update Line' : 'Add Line'}
          </button>
        </div>
      </div>
    </div>
  )
}
