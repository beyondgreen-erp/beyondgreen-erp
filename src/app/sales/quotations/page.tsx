'use client'
import ShareLink from '@/components/ShareLink'
import { useItemDeepLink } from '@/components/useItemDeepLink'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback, useMemo, useRef} from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import Comments from '@/components/Comments'
import FileUpload from '@/components/FileUpload'
import { generateQuotePDF, generateRFQPDF, type PDFLine } from '@/lib/pdfHelpers'

interface Quote {
  id: string
  quote_number: string
  customer_id: string | null
  status: string
  quote_date: string | null
  expiry_date: string | null
  subtotal: number | null
  tax_pct: number | null
  total: number | null
  payment_terms: string | null
  notes: string | null
  price_term?: string | null
  export_country?: string | null
  client_portal_visible?: boolean | null
  client_portal_name?: string | null
  created_at: string
  type?: 'quote' | 'rfq' | null
  customers?: { company_name: string } | null
  quotation_lines?: QuoteLine[]
}

interface QuoteLine {
  id?: string
  quotation_id?: string
  sku: string | null
  product_name: string | null
  description: string | null
  quantity: number
  unit_price: number
  line_total: number
  pcs_per_case?: number | null
  case_price?: number | null
  product_id: string | null
}

interface Customer {
  id: string
  company_name: string
  board?: string | null
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  'Draft':     { bg: '#F3F4F6', text: '#6B7280' },
  'Sent':      { bg: '#EFF6FF', text: '#2563EB' },
  'Accepted':  { bg: '#ECFDF5', text: '#059669' },
  'Rejected':  { bg: '#FEF2F2', text: '#DC2626' },
  'Converted': { bg: '#F5F3FF', text: '#7C3AED' },
  'Expired':   { bg: '#FFF7ED', text: '#EA580C' },
}

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS['Draft']
  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
      style={{ background: c.bg, color: c.text }}
    >
      {status}
    </span>
  )
}

function fmt$(n: number | null | undefined) {
  if (n == null) return '—'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const STATUSES = ['All', 'Draft', 'Sent', 'Accepted', 'Rejected', 'Converted']
const PAYMENT_TERMS = ['Net 15', 'Net 30', 'Net 45', 'Net 60', 'COD', 'Upfront', '50/50']

interface PortalClient { id: string; customer_id: string | null; company_name: string | null; name: string | null; email: string | null }
function portalCustomerOptions(portals: PortalClient[]): { customer_id: string; label: string }[] {
  const seen = new Set<string>(); const out: { customer_id: string; label: string }[] = []
  for (const p of portals) { if (!p.customer_id || seen.has(p.customer_id)) continue; seen.add(p.customer_id); out.push({ customer_id: p.customer_id, label: p.company_name || p.name || p.email || 'Client' }) }
  return out.sort((a, b) => a.label.localeCompare(b.label))
}

export default function QuotationsPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const router = useRouter()
  const [quotes, setQuotes] = useState<Quote[]>([])

  // Deep-link: open the item referenced by ?item=<id> in the URL (used by @mention notifications).
  const deepLinkOpenedRef = useRef<string | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const openId = new URLSearchParams(window.location.search).get('item')
    if (!openId || deepLinkOpenedRef.current === openId) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const target = (quotes as any[]).find((x) => x && x.id === openId)
    if (target) { deepLinkOpenedRef.current = openId; openEdit(target) }
  }, [quotes]) // eslint-disable-line react-hooks/exhaustive-deps
  useItemDeepLink(quotes, openEdit)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [portals, setPortals] = useState<PortalClient[]>([])
  const [lineCounts, setLineCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [confirmConvert, setConfirmConvert] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState('')

  // Panel state
  const [panelOpen, setPanelOpen] = useState(false)
  const [editing, setEditing] = useState<Quote | null>(null)
  const [panelTab, setPanelTab] = useState<'overview' | 'lines' | 'notes' | 'comments'>('overview')
  const [saving, setSaving] = useState(false)
  const [rfqModalOpen, setRfqModalOpen] = useState(false)
  const [rfqSending, setRfqSending] = useState(false)
  const [selectedRecipients, setSelectedRecipients] = useState<Set<string>>(new Set())
  // Record Board: collapsed state per status group
  const [rbCollapsedState, rbSetCollapsed] = useState<Record<string, boolean>>({ Rejected: true, Expired: true })
  // Tab: 'quote' or 'rfq'
  const [activeTab, setActiveTab] = useState<'quote' | 'rfq'>('quote')
  // Customer typeahead
  const [customerSearch, setCustomerSearch] = useState('')
  const [showCustomerList, setShowCustomerList] = useState(false)

  // Form state
  const [form, setForm] = useState({
    customer_id: '',
    status: 'Draft',
    quote_date: new Date().toISOString().split('T')[0],
    expiry_date: '',
    payment_terms: 'Net 30',
    notes: '',
    tax_rate: '0',
    type: 'quote' as 'quote' | 'rfq',
    price_term: 'ddp',
    export_country: 'China',
    client_portal_visible: false,
    client_portal_name: '',
    billing_address: '',
    shipping_address: '',
  })
  const [lines, setLines] = useState<Partial<QuoteLine>[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState<any[]>([])

  // Custom payment methods (added inline; persisted per-browser and via saved quotes)
  const [customTerms, setCustomTerms] = useState<string[]>([])
  const [addingTerm, setAddingTerm] = useState(false)
  const [newTerm, setNewTerm] = useState('')

  const fetchQuotes = useCallback(async () => {
    setLoading(true)
    const [{ data: qData }, { data: lData }] = await Promise.all([
      supabase.from('quotations').select('*').order('created_at', { ascending: false }),
      supabase.from('quotation_lines').select('quotation_id'),
    ])
    setQuotes((qData ?? []) as Quote[])
    if (lData) {
      const counts: Record<string, number> = {}
      for (const l of lData as any[]) counts[l.quotation_id] = (counts[l.quotation_id] ?? 0) + 1
      setLineCounts(counts)
    }
    setLoading(false)
  }, [supabase])

  const fetchCustomers = useCallback(async () => {
    // Initial load: real customers only (there are ~14k leads, so we search those on demand)
    const { data } = await supabase
      .from('customers')
      .select('id, company_name, board')
      .eq('board', 'customer')
      .order('company_name')
      .limit(500)
    setCustomers(data ?? [])
    const { data: pc } = await supabase
      .from('portal_clients')
      .select('id, customer_id, company_name, name, email')
      .eq('is_active', true)
    setPortals((pc ?? []) as PortalClient[])
  }, [supabase])

  // Live search across BOTH customers and leads once user types ≥ 2 chars.
  const [customerMatches, setCustomerMatches] = useState<Customer[]>([])
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false)
  useEffect(() => {
    const term = customerSearch.trim()
    if (term.length < 2) { setCustomerMatches([]); return }
    let cancelled = false
    setCustomerSearchLoading(true)
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('customers')
        .select('id, company_name, board')
        .ilike('company_name', `%${term}%`)
        .order('board', { ascending: true }) // 'customer' comes before 'Leads'
        .order('company_name')
        .limit(20)
      if (!cancelled) { setCustomerMatches((data ?? []) as Customer[]); setCustomerSearchLoading(false) }
    }, 200)
    return () => { cancelled = true; clearTimeout(t) }
  }, [customerSearch, supabase])

  async function createLead(name: string): Promise<Customer | null> {
    const clean = name.trim()
    if (!clean) return null
    const { data, error } = await supabase
      .from('customers')
      .insert({ company_name: clean, board: 'Leads', is_active: true, pipeline_stage: 'New' })
      .select('id, company_name, board')
      .single()
    if (error) { alert('Could not add as lead: ' + error.message); return null }
    // add to local list so it shows immediately
    setCustomers(prev => [...prev, data as Customer])
    return data as Customer
  }

  useEffect(() => {
    fetchQuotes()
    fetchCustomers()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.email) setUserEmail(user.email)
    })
  }, [fetchQuotes, fetchCustomers, supabase])

  const cmap = useMemo(() => Object.fromEntries(customers.map(c => [c.id, c.company_name])), [customers])

  const filtered = quotes.filter(q => {
    const q2 = search.toLowerCase()
    const matchSearch = !search ||
      (q.quote_number ?? '').toLowerCase().includes(q2) ||
      (cmap[q.customer_id ?? ''] ?? '').toLowerCase().includes(q2)
    const matchStatus = statusFilter === 'All' || q.status === statusFilter
    return matchSearch && matchStatus
  })

  // Load custom payment methods; reset the inline add-field when the panel closes
  useEffect(() => {
    try { if (typeof window !== 'undefined') { const raw = localStorage.getItem('bg_payment_terms'); if (raw) setCustomTerms(JSON.parse(raw)) } } catch { /* ignore */ }
  }, [])
  useEffect(() => { if (!panelOpen) { setAddingTerm(false); setNewTerm('') } }, [panelOpen])
  const paymentTermOptions = useMemo(() => {
    const used = quotes.map(q => (q.payment_terms || '').trim()).filter(Boolean)
    const seen = new Set<string>(); const out: string[] = []
    for (const t of [...PAYMENT_TERMS, ...used, ...customTerms, (form.payment_terms || '').trim()]) {
      const v = (t || '').trim(); if (v && !seen.has(v)) { seen.add(v); out.push(v) }
    }
    return out
  }, [quotes, customTerms, form.payment_terms])
  function addPaymentTerm() {
    const t = newTerm.trim()
    if (!t) { setAddingTerm(false); return }
    setCustomTerms(prev => {
      const next = prev.includes(t) ? prev : [...prev, t]
      try { if (typeof window !== 'undefined') localStorage.setItem('bg_payment_terms', JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
    setForm(p => ({ ...p, payment_terms: t }))
    setNewTerm(''); setAddingTerm(false)
  }

  function openNew(kind: 'quote' | 'rfq' = 'quote') {
    setEditing(null)
    setCustomerSearch('')
    setForm({
      customer_id: '',
      status: kind === 'rfq' ? 'Quoting' : 'Draft',
      quote_date: new Date().toISOString().split('T')[0],
      expiry_date: new Date(Date.now() + 30 * 864e5).toISOString().split('T')[0],
      payment_terms: 'Net 30',
      notes: '',
      tax_rate: '0',
      type: kind,
      price_term: 'ddp',
      export_country: 'China',
      client_portal_visible: false,
      client_portal_name: '',
      billing_address: '',
      shipping_address: '',
    })
    setLines([{ sku: '', product_name: '', description: '', quantity: 1, unit_price: 0, line_total: 0, product_id: null }])
    setPanelTab('overview')
    setPanelOpen(true)
  }

  async function openEdit(q: Quote) {
    setEditing(q)
    // If the linked customer/lead isn't in our initial cache, fetch it by id so the field pre-fills.
    let displayName = cmap[q.customer_id ?? ''] || ''
    if (!displayName && q.customer_id) {
      const { data: c } = await supabase.from('customers').select('id, company_name, board').eq('id', q.customer_id).maybeSingle()
      if (c) {
        setCustomers(prev => prev.some(x => x.id === c.id) ? prev : [...prev, c as Customer])
        displayName = (c as any).company_name || ''
      }
    }
    setCustomerSearch(displayName)
    setForm({
      customer_id: q.customer_id ?? '',
      status: q.status ?? 'Draft',
      quote_date: q.quote_date ?? '',
      expiry_date: q.expiry_date ?? '',
      payment_terms: q.payment_terms ?? 'Net 30',
      notes: q.notes ?? '',
      tax_rate: '0',
      type: (q.type as 'quote' | 'rfq') || 'quote',
      price_term: (q as any).price_term ?? 'ddp',
      export_country: (q as any).export_country ?? 'China',
      client_portal_visible: q.client_portal_visible ?? false,
      client_portal_name: q.client_portal_name ?? '',
      billing_address: (q as any).billing_address ?? '',
      shipping_address: (q as any).shipping_address ?? '',
    })
    setLines([])
    setPanelTab('overview')
    setPanelOpen(true)
    const { data: lData } = await supabase
      .from('quotation_lines')
      .select('*')
      .eq('quotation_id', q.id)
      .order('id')
    setLines((lData ?? []) as QuoteLine[])
  }

  function closePanel() {
    setPanelOpen(false)
    setEditing(null)
    setProductSearch('')
    setProductResults([])
    setConfirmConvert(null)
    setRfqModalOpen(false)
    setSelectedRecipients(new Set())
  }

  async function handleSendRfq() {
    if (!editing || selectedRecipients.size === 0) return
    setRfqSending(true)
    try {
      const recipients = Array.from(selectedRecipients)
      for (const recipient of recipients) {
        const response = await fetch('/api/rfq/generate-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            quote_costing_id: editing.id,
            recipient: recipient,
          }),
        })
        if (!response.ok) {
          const err = await response.json()
          throw new Error(err.error || 'Failed to generate RFQ token')
        }
      }
      setRfqModalOpen(false)
      setSelectedRecipients(new Set())
      alert('RFQ sent successfully to ' + Array.from(selectedRecipients).join(' and '))
    } catch (err: any) {
      alert('Error sending RFQ: ' + err.message)
    } finally {
      setRfqSending(false)
    }
  }

  function updateLine(i: number, field: string, value: any) {
    setLines(prev => {
      const next = [...prev]
      next[i] = { ...next[i], [field]: value }
      if (field === 'quantity' || field === 'unit_price') {
        const qty = field === 'quantity' ? value : (next[i].quantity ?? 0)
        const price = field === 'unit_price' ? value : (next[i].unit_price ?? 0)
        next[i].line_total = qty * price
      }
      return next
    })
  }

  function addLine() {
    setLines(prev => [...prev, { sku: '', product_name: '', description: '', quantity: 1, unit_price: 0, line_total: 0, product_id: null }])
  }

  function removeLine(i: number) {
    setLines(prev => prev.filter((_, idx) => idx !== i))
  }

  const subtotal = lines.reduce((s, l) => s + (l.line_total ?? 0), 0)
  const taxRate = parseFloat(form.tax_rate) || 0
  const taxAmount = subtotal * taxRate / 100
  const total = subtotal + taxAmount

  async function searchProducts(q: string) {
    if (q.length < 2) { setProductResults([]); return }
    const { data } = await supabase
      .from('products')
      .select('id, sku, product_name, unit_cost, msrp, wholesale_price, case_qty, upc_gtin')
      .or(`sku.ilike.%${q}%,product_name.ilike.%${q}%`)
      .limit(8)
    setProductResults(data ?? [])
  }

  function selectProduct(lineIdx: number, product: any) {
    setLines(prev => {
      const next = [...prev]
      const price = product.wholesale_price ?? product.msrp ?? product.unit_cost ?? 0
      next[lineIdx] = {
        ...next[lineIdx],
        sku: product.sku,
        product_name: product.product_name,
        product_id: product.id,
        unit_price: price,
        pcs_per_case: product.case_qty ?? next[lineIdx].pcs_per_case ?? null,
        line_total: (next[lineIdx].quantity ?? 1) * price,
      }
      return next
    })
    setProductSearch('')
    setProductResults([])
  }

  // ── ULTRON: Inventory board is the single source of truth ─────────────────
  // Resolve every quote line to a real Inventory product: link existing SKUs,
  // auto-create brand-new SKUs in Inventory, and push name/price edits back.
  async function ultronSyncLines(validLines: Partial<QuoteLine>[]): Promise<Partial<QuoteLine>[]> {
    const out: Partial<QuoteLine>[] = []
    for (const l of validLines) {
      let pid = l.product_id ?? null
      const sku = (l.sku ?? '').trim()
      const name = (l.product_name ?? '').trim()
      const price = l.unit_price ?? 0
      // Inventory prices are the set default and are NEVER overwritten from a quote/RFQ.
      // The quote keeps its own (possibly negotiated) price on its line.
      if (pid) {
        // Already linked to an Inventory product — read-only, leave Inventory untouched.
      } else if (sku) {
        const { data: found } = await supabase.from('products').select('id').ilike('sku', sku).limit(1)
        if (found && found.length) {
          pid = (found[0] as any).id // link only — do not modify the existing product
        } else {
          // Brand-new SKU: add it to the Inventory board so it stays the complete source of truth.
          // Seed its default price from this first quote (nothing is being overwritten).
          const { data: created, error: cErr } = await supabase.from('products').insert({
            sku, product_name: name || sku,
            wholesale_price: price > 0 ? price : null,
            unit_of_measure: 'EA', is_active: true, inventory_status: 'Active',
            case_qty: l.pcs_per_case ?? null,
          }).select('id').single()
          if (!cErr && created) pid = (created as any).id
          else { const { data: again } = await supabase.from('products').select('id').ilike('sku', sku).limit(1); pid = (again?.[0] as any)?.id ?? null }
        }
      }
      out.push({ ...l, product_id: pid })
    }
    return out
  }

  async function handleSave() {
    setSaving(true)
    try {
      const quoteData = {
        customer_id: form.customer_id || null,
        status: form.status,
        quote_date: form.quote_date || null,
        expiry_date: form.expiry_date || null,
        payment_terms: form.payment_terms || 'Net 30',
        notes: form.notes || null,
        subtotal,
        tax_pct: taxRate,
        total: total,
        type: form.type,
        price_term: form.price_term || null,
        export_country: form.export_country || null,
        client_portal_visible: !!form.client_portal_visible,
        client_portal_name: form.client_portal_name || null,
        billing_address: form.billing_address || null,
        shipping_address: form.shipping_address || null,
      }

      let quoteId = editing?.id

      if (editing) {
        const { error: updateErr } = await supabase.from('quotations').update(quoteData).eq('id', editing.id)
        if (updateErr) { alert('Save failed: ' + updateErr.message); setSaving(false); return }
        await supabase.from('quotation_lines').delete().eq('quotation_id', editing.id)
      } else {
        const year = new Date().getFullYear()
        const { count } = await supabase.from('quotations').select('*', { count: 'exact', head: true })
        const qNum = `Q-${year}-${String((count ?? 0) + 1).padStart(4, '0')}`
        const { data: newQ, error: insertErr } = await supabase.from('quotations').insert({ ...quoteData, quote_number: qNum }).select('id').single()
        if (insertErr) { alert('Save failed: ' + insertErr.message); setSaving(false); return }
        quoteId = (newQ as any)?.id
      }

      if (quoteId && lines.length > 0) {
        const validLines = lines.filter(l => l.product_name || l.sku || l.description || (l.unit_price ?? 0) > 0)
        if (validLines.length > 0) {
          const syncedLines = await ultronSyncLines(validLines)
          const { error: linesErr } = await supabase.from('quotation_lines').insert(
            syncedLines.map(l => ({
              quotation_id: quoteId,
              product_id: l.product_id ?? null,
              sku: l.sku ?? null,
              product_name: l.product_name ?? null,
              description: l.description ?? null,
              quantity: l.quantity ?? 1,
              unit_price: l.unit_price ?? 0,
              line_total: l.line_total ?? 0,
              pcs_per_case: l.pcs_per_case ?? null,
              case_price: l.case_price ?? null,
            }))
          )
          if (linesErr) { alert('Quote saved but line items failed: ' + linesErr.message); setSaving(false); fetchQuotes(); return }
        }
      }

      closePanel()
      fetchQuotes()
    } catch (e: any) {
      alert('Error: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  function handleDownloadPdf() {
    if (!editing) return
    const customer = customers.find(c => c.id === form.customer_id)
    const pdfLines: PDFLine[] = lines.map((l, i) => ({
      line_number: i + 1,
      sku: l.sku ?? null,
      description: l.product_name ?? l.description ?? '',
      quantity: l.quantity ?? 1,
      unit_of_measure: null,
      unit_price: l.unit_price ?? 0,
      discount_pct: 0,
    }))
    generateQuotePDF(
      {
        quote_number: editing.quote_number,
        quote_date: form.quote_date || null,
        expiry_date: form.expiry_date || null,
        status: form.status,
        tax_pct: taxRate,
        subtotal,
        total,
        notes: form.notes || null,
      },
      pdfLines,
      customer ? { company_name: customer.company_name } : null
    )
  }

  function handleDownloadRfq() {
    const src = editing || (form as any)
    const rfqNumber = editing?.quote_number || `RFQ-${Date.now().toString().slice(-6)}`
    const customer = customers.find(c => c.id === form.customer_id)
    const pdfLines: PDFLine[] = lines
      .filter(l => l.product_name || l.sku || l.description)
      .map((l, i) => ({
        line_number: i + 1,
        sku: l.sku ?? null,
        description: l.product_name ?? l.description ?? '',
        quantity: l.quantity ?? 1,
        unit_of_measure: (l as any).uom ?? (l as any).unit_of_measure ?? null,
        unit_price: 0,
        discount_pct: 0,
      }))
    if (pdfLines.length === 0) {
      alert('Add at least one line item before downloading an RFQ.')
      return
    }
    // RFQs are sent OUT to suppliers on our behalf, so the buyer and ship-to are
    // always beyondGREEN. We do NOT expose the end customer to the supplier.
    // reply_to is a shared sourcing inbox, not the current user's email.
    generateRFQPDF(
      {
        quote_number: rfqNumber,
        quote_date: form.quote_date || new Date().toISOString().split('T')[0],
        expiry_date: form.expiry_date || null,
        notes: form.notes || null,
        delivery_address: null,   // pdfHelpers hard-fills beyondGREEN warehouse address for RFQ
        delivery_by: (src as any)?.required_by || null,
        reply_to_email: 'sourcing@beyondgreenbiotech.com',
        reply_to_name: null,
      },
      pdfLines,
      null   // never send the end customer to suppliers
    )
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this quotation?')) return
    await supabase.from('quotation_lines').delete().eq('quotation_id', id)
    await supabase.from('quotations').delete().eq('id', id)
    fetchQuotes()
  }

  async function doConvertToSO(quote: Quote) {
    if (quote.status !== 'Accepted') { alert('This quote must be Accepted (customer-approved) before it can be converted to a sales order.'); setConfirmConvert(null); return }
    setSaving(true)
    try {
      const { data: quoteLines } = await supabase
        .from('quotation_lines').select('*').eq('quotation_id', quote.id)
      const { data: order, error: orderErr } = await supabase.from('sales_orders').insert({
        customer_id: quote.customer_id,
        order_number: 'SO-' + Date.now().toString().slice(-6),
        status: 'Confirmed',
        total: quote.total ?? 0,
        notes: 'Converted from ' + quote.quote_number,
      }).select('id').single()

      if (orderErr) { alert('Conversion error: ' + orderErr.message); return }
      if (order) {
        for (const line of (quoteLines ?? [])) {
          await supabase.from('sales_order_lines').insert({
            sales_order_id: (order as any).id,
            product_id: (line as any).product_id ?? null,
            sku: (line as any).sku ?? null,
            description: (line as any).product_name ?? (line as any).description ?? '',
            quantity: (line as any).quantity ?? 1,
            unit_price: (line as any).unit_price ?? 0,
          })
        }
        await supabase.from('quotations').update({ status: 'Converted' }).eq('id', quote.id)
        setConfirmConvert(null)
        closePanel()
        fetchQuotes()
        router.push('/sales/orders')
      }
    } catch (e: any) {
      alert('Conversion error: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function bulkDelete() {
    if (!confirm(`Delete ${selected.size} quotations?`)) return
    setDeleting(true)
    const ids = Array.from(selected)
    for (const id of ids) await supabase.from('quotation_lines').delete().eq('quotation_id', id)
    await supabase.from('quotations').delete().in('id', ids)
    setSelected(new Set())
    setDeleting(false)
    fetchQuotes()
  }

  const inp = 'w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors'
  const inpStyle = { borderColor: '#E4E6EE', color: '#1A1D2E', background: '#fff' }

  // Record Board groups by status (matches PLS / Purchasing Requests / Employee Directory look)
  const RB_GROUPS: { key: string; title: string; color: string }[] = [
    { key: 'Draft',     title: 'Draft',      color: '#5559df' },
    { key: 'Sent',      title: 'Sent',       color: '#007eb5' },
    { key: 'Accepted',  title: 'Accepted',   color: '#00c875' },
    { key: 'Converted', title: 'Converted',  color: '#a25ddc' },
    { key: 'Rejected',  title: 'Rejected',   color: '#df2f4a' },
    { key: 'Expired',   title: 'Expired',    color: '#fdab3d' },
  ]
  // RFQs use a simple 3-status pipeline
  const RFQ_RB_GROUPS: { key: string; title: string; color: string }[] = [
    { key: 'Quoting',  title: 'Quoting',  color: '#fdab3d' },
    { key: 'Quoted',   title: 'Quoted',   color: '#007eb5' },
    { key: 'Accepted', title: 'Accepted', color: '#00c875' },
  ]
  const rbGroups = activeTab === 'rfq' ? RFQ_RB_GROUPS : RB_GROUPS
  const rbStatusColor = (s: string | null) => [...RB_GROUPS, ...RFQ_RB_GROUPS].find(g => g.key === s)?.color || '#c4c4c4'
  const rbMatch = (q: Quote) => {
    const t = search.toLowerCase()
    if (!t) return true
    return (q.quote_number ?? '').toLowerCase().includes(t) || (cmap[q.customer_id ?? ''] ?? '').toLowerCase().includes(t)
  }
  const rbGroupRows = (key: string) => quotes.filter(q => ((q.type || 'quote') === activeTab) && (q.status || 'Draft') === key && rbMatch(q))
  const tabQuotes = quotes.filter(q => (q.type || 'quote') === activeTab)
  const tabPipeline = tabQuotes.filter(q => !['Rejected','Converted'].includes(q.status)).reduce((s, q) => s + (q.total ?? 0), 0)
  const [collapsed, setCollapsed] = [rbCollapsedState, rbSetCollapsed] as const

  return (
    <div className="min-h-screen mon-page p-4 sm:p-6 lg:p-8">

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-3">
        <div>
          <span className="mon-tag t-pink">💬 Sales</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">Quotes &amp; RFQs</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${tabQuotes.length} ${activeTab === 'rfq' ? 'RFQ' : 'quote'}${tabQuotes.length !== 1 ? 's' : ''} · ${fmt$(tabPipeline)} pipeline`}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={`Search ${activeTab === 'rfq' ? 'RFQ' : 'quote'} # or customer…`}
            className="bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-[#3B6FE0]/40"
          />
          {selected.size > 0 && (
            <button onClick={bulkDelete} disabled={deleting} className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              Delete {selected.size}
            </button>
          )}
          <button
            onClick={() => openNew('quote')}
            className="flex items-center gap-1.5 bg-[#3B6FE0] hover:bg-[#2E5CC7] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            New Quote
          </button>
          <button
            onClick={() => openNew('rfq')}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            New RFQ
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 bg-white border border-[#E4E6EE] rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveTab('quote')}
          className={`flex items-center gap-1.5 text-sm font-medium px-4 py-1.5 rounded-md transition-colors ${activeTab === 'quote' ? 'bg-[#3B6FE0] text-white' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
          Quotes
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${activeTab === 'quote' ? 'bg-white/25' : 'bg-[#F0F2F7] text-gray-500'}`}>
            {quotes.filter(q => (q.type || 'quote') === 'quote').length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('rfq')}
          className={`flex items-center gap-1.5 text-sm font-medium px-4 py-1.5 rounded-md transition-colors ${activeTab === 'rfq' ? 'bg-emerald-600 text-white' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
          RFQs
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${activeTab === 'rfq' ? 'bg-white/25' : 'bg-[#F0F2F7] text-gray-500'}`}>
            {quotes.filter(q => q.type === 'rfq').length}
          </span>
        </button>
      </div>

      {loading ? (
        <div className="rounded-xl border border-[#E4E6EE] bg-white flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-[#3B6FE0]/30 border-t-[#3B6FE0] rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          {rbGroups.map(group => {
            const gr = rbGroupRows(group.key)
            const isCol = collapsed[group.key]
            const groupTotal = gr.reduce((s, q) => s + (q.total ?? 0), 0)
            return (
              <div key={group.key} className="bg-white rounded-xl shadow-sm border border-[#ECEEF3]">
                <div className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none sticky top-0 z-30 rounded-t-xl" style={{ background: '#fff', borderLeft: '5px solid ' + group.color }} onClick={() => setCollapsed(c => ({ ...c, [group.key]: !c[group.key] }))}>
                  <span className="text-[10px]" style={{ color: group.color, display: 'inline-block', transform: isCol ? 'none' : 'rotate(90deg)' }}>&#9654;</span>
                  <span className="font-bold text-sm" style={{ color: group.color }}>{group.title}</span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: group.color + '26', color: group.color }}>{gr.length}</span>
                  {gr.length > 0 && <span className="ml-auto text-[11px] font-semibold text-gray-500">{fmt$(groupTotal)}</span>}
                </div>
                {!isCol && (
                  <div>
                    <table className="w-full text-sm min-w-[900px]">
                      <thead className="sticky top-[47px] z-20 [&_th]:bg-[#FBFCFE]">
                        <tr className="text-[11px] uppercase text-gray-400 border-b border-[#EEF0F4]">
                          <th className="text-left px-3 py-2 font-semibold w-[36px]">
                            <input
                              type="checkbox"
                              checked={gr.length > 0 && gr.every(q => selected.has(q.id))}
                              onChange={() => {
                                const next = new Set(selected)
                                const allSelected = gr.every(q => selected.has(q.id))
                                if (allSelected) gr.forEach(q => next.delete(q.id))
                                else gr.forEach(q => next.add(q.id))
                                setSelected(next)
                              }}
                              className="w-4 h-4 rounded cursor-pointer accent-blue-600"
                              onClick={e => e.stopPropagation()}
                            />
                          </th>
                          <th className="text-left px-3 py-2 font-semibold">Quote #</th>
                          <th className="text-left px-3 py-2 font-semibold">Customer</th>
                          <th className="text-left px-3 py-2 font-semibold w-[110px]">Date</th>
                          <th className="text-left px-3 py-2 font-semibold w-[110px]">Expiry</th>
                          <th className="text-left px-3 py-2 font-semibold w-[120px]">Status</th>
                          <th className="text-left px-3 py-2 font-semibold w-[70px]">Lines</th>
                          <th className="text-right px-3 py-2 font-semibold w-[110px]">Total</th>
                          <th className="text-right px-3 py-2 font-semibold w-[110px]"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {gr.map((quote, i) => (
                          <tr key={quote.id} className={`group cursor-pointer hover:bg-[#F2F6FF] ${i % 2 ? 'bg-[#F8FAFC]' : 'bg-white'}`} onClick={() => openEdit(quote)}>
                            <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selected.has(quote.id)}
                                onChange={() => {
                                  const next = new Set(selected)
                                  if (next.has(quote.id)) next.delete(quote.id); else next.add(quote.id)
                                  setSelected(next)
                                }}
                                className="w-4 h-4 rounded cursor-pointer accent-blue-600"
                              />
                            </td>
                            <td className="px-3 py-2.5 font-semibold text-[#3B6FE0]">{quote.quote_number || '—'}</td>
                            <td className="px-3 py-2.5 text-[#1A1D2E] truncate max-w-[280px]">{cmap[quote.customer_id ?? ''] || '—'}</td>
                            <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{quote.quote_date ? new Date(quote.quote_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                            <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{quote.expiry_date ? new Date(quote.expiry_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                            <td className="px-3 py-2.5">
                              <span className="text-white text-[11px] font-semibold rounded-full px-2.5 py-1 inline-block whitespace-nowrap" style={{ background: rbStatusColor(quote.status) }}>{quote.status || 'Draft'}</span>
                            </td>
                            <td className="px-3 py-2.5 text-gray-600">{lineCounts[quote.id] ?? 0}</td>
                            <td className="px-3 py-2.5 text-right font-semibold text-[#1A1D2E]">{fmt$(quote.total)}</td>
                            <td className="px-3 py-2.5 text-right" onClick={e => e.stopPropagation()}>
                              <div className="inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                {quote.status === 'Accepted' && (
                                  <button
                                    onClick={() => { openEdit(quote); setConfirmConvert(quote.id) }}
                                    className="px-2 py-1 rounded-md text-[11px] font-semibold border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 transition-colors"
                                    title="Convert to Sales Order"
                                  >
                                    → SO
                                  </button>
                                )}
                                <button
                                  onClick={() => handleDelete(quote.id)}
                                  className="p-1 rounded-md text-red-500 hover:bg-red-50 transition-colors"
                                  title="Delete"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {gr.length === 0 && <tr><td colSpan={9} className="px-4 py-6 text-center text-gray-400 text-sm">{search ? 'No matches.' : `No ${group.title.toLowerCase()} quotes`}</td></tr>}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* OVERLAY */}
      <div
        className="fixed inset-0 z-40 transition-opacity duration-200"
        style={{
          background: 'rgba(26,32,53,0.48)',
          backdropFilter: 'blur(3px)',
          opacity: panelOpen ? 1 : 0,
          pointerEvents: panelOpen ? 'auto' : 'none',
        }}
        onClick={closePanel}
      />

      {/* CENTERED POP-UP */}
      <div
        onClick={e => e.stopPropagation()}
        className="fixed left-1/2 top-6 z-50 flex flex-col overflow-hidden transition-all duration-200"
        style={{
          width: 720,
          maxWidth: 'calc(100% - 2rem)',
          maxHeight: 'calc(100vh - 48px)',
          background: '#FFFFFF',
          borderRadius: 16,
          boxShadow: '0 24px 70px rgba(3,44,22,0.30)',
          transform: panelOpen ? 'translateX(-50%) scale(1)' : 'translateX(-50%) scale(0.95)',
          opacity: panelOpen ? 1 : 0,
          pointerEvents: panelOpen ? 'auto' : 'none',
        }}
      >
        {/* Panel Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0" style={{ borderColor: '#E4E6EE' }}>
          <div>
            <h2 className="font-semibold text-base" style={{ color: '#1A1D2E' }}>
              {(() => {
                const isRfq = (editing?.type || form.type) === 'rfq'
                const label = isRfq ? 'RFQ' : 'Quote'
                if (editing) return `${label} ${editing.quote_number}`
                return `New ${label}`
              })()}
            </h2>
            {editing && <div className="mt-1"><StatusBadge status={editing.status ?? 'Draft'} /></div>}
          </div>
          {editing && <ShareLink id={editing.id} className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-[#6B7280] hover:text-[#1A1D2E] border border-[#E4E6EE] hover:border-[#D0D3E0] bg-white px-2.5 py-1.5 rounded-lg transition-colors shrink-0" />}
          <button
            onClick={closePanel}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-gray-100"
            style={{ background: '#F0F2F7', color: '#6B7280' }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Panel Tabs */}
        <div className="flex border-b px-6 shrink-0" style={{ borderColor: '#E4E6EE' }}>
          {(['overview', 'lines', 'notes', 'comments'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setPanelTab(tab)}
              className="px-4 py-3 text-sm font-medium capitalize border-b-2 transition-colors -mb-px"
              style={{
                borderColor: panelTab === tab ? '#3B6FE0' : 'transparent',
                color: panelTab === tab ? '#3B6FE0' : '#9CA3AF',
              }}
            >
              {tab === 'lines' ? 'Line Items' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Panel Body */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* OVERVIEW TAB */}
          {panelTab === 'overview' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 relative">
                  <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>Customer</label>
                  <input
                    type="text"
                    value={customerSearch}
                    onChange={e => { setCustomerSearch(e.target.value); setShowCustomerList(true); if (!e.target.value) setForm(p => ({ ...p, customer_id: '' })) }}
                    onFocus={() => setShowCustomerList(true)}
                    onBlur={() => setTimeout(() => setShowCustomerList(false), 150)}
                    placeholder="Type to search customers (optional)…"
                    className={inp}
                    style={inpStyle}
                  />
                  {showCustomerList && customerSearch.length > 0 && (() => {
                    const q = customerSearch.trim().toLowerCase()
                    // Combine local recent customers + server search results, dedupe by id
                    const seen = new Set<string>()
                    const combined: Customer[] = []
                    for (const c of [...customerMatches, ...customers.filter(c => c.company_name.toLowerCase().includes(q))]) {
                      if (seen.has(c.id)) continue
                      seen.add(c.id); combined.push(c)
                    }
                    combined.sort((a, b) => (a.board === 'customer' ? 0 : 1) - (b.board === 'customer' ? 0 : 1))
                    const list = combined.slice(0, 12)
                    const exact = list.some(c => c.company_name.trim().toLowerCase() === q)
                    const showCreate = q.length >= 2 && !exact
                    return (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-[#E4E6EE] rounded-lg shadow-lg overflow-hidden max-h-72 overflow-y-auto">
                        {customerSearchLoading && list.length === 0 && (
                          <div className="px-3 py-2 text-sm text-gray-400">Searching customers &amp; leads…</div>
                        )}
                        {list.map(c => {
                          const isCustomer = c.board === 'customer'
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onMouseDown={e => e.preventDefault()}
                              onClick={() => {
                                setForm(p => ({ ...p, customer_id: c.id }))
                                setCustomerSearch(c.company_name)
                                setShowCustomerList(false)
                              }}
                              className={`w-full flex items-center justify-between gap-2 text-left px-3 py-2 text-sm hover:bg-[#F2F6FF] transition-colors ${form.customer_id === c.id ? 'bg-[#EFF6FF] text-[#3B6FE0]' : 'text-[#1A1D2E]'}`}
                            >
                              <span className="truncate">{c.company_name}</span>
                              <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 shrink-0 ${isCustomer ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                {isCustomer ? 'Customer' : 'Lead'}
                              </span>
                            </button>
                          )
                        })}
                        {showCreate && (
                          <button
                            type="button"
                            onMouseDown={e => e.preventDefault()}
                            onClick={async () => {
                              const created = await createLead(customerSearch)
                              if (created) {
                                setForm(p => ({ ...p, customer_id: created.id }))
                                setCustomerSearch(created.company_name)
                                setShowCustomerList(false)
                              }
                            }}
                            className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm border-t border-[#E4E6EE] bg-[#F9FAFB] hover:bg-emerald-50 text-emerald-700 font-medium"
                          >
                            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                            Add as new lead: “{customerSearch.trim()}”
                          </button>
                        )}
                        {!customerSearchLoading && list.length === 0 && !showCreate && (
                          <div className="px-3 py-2 text-sm text-gray-400">No matches</div>
                        )}
                      </div>
                    )
                  })()}
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>Quote Date</label>
                  <input type="date" value={form.quote_date} onChange={e => setForm(p => ({ ...p, quote_date: e.target.value }))} className={inp} style={inpStyle} />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>Expiry Date</label>
                  <input type="date" value={form.expiry_date} onChange={e => setForm(p => ({ ...p, expiry_date: e.target.value }))} className={inp} style={inpStyle} />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>Status</label>
                  <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))} className={inp} style={inpStyle}>
                    {(form.type === 'rfq' ? ['Quoting', 'Quoted', 'Accepted'] : ['Draft', 'Sent', 'Accepted', 'Rejected', 'Converted', 'Expired']).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                {form.type === 'rfq' && (
                  <>
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>Price term</label>
                      <select value={form.price_term} onChange={e => setForm(p => ({ ...p, price_term: e.target.value }))} className={inp} style={{ ...inpStyle, cursor: 'pointer' }}>
                        <option value="ddp">DDP (Delivered Duty Paid)</option>
                        <option value="exworks">ExWorks</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>Export country</label>
                      <select value={form.export_country} onChange={e => setForm(p => ({ ...p, export_country: e.target.value }))} className={inp} style={{ ...inpStyle, cursor: 'pointer' }}>
                        <option value="China">China</option>
                        <option value="India">India</option>
                      </select>
                    </div>
                  </>
                )}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-medium" style={{ color: '#374151' }}>Payment Terms</label>
                    <button type="button" onClick={() => { setAddingTerm(v => !v); setNewTerm('') }} className="text-[11px] font-semibold text-[#3B6FE0] hover:underline">{addingTerm ? 'Cancel' : '+ Add new'}</button>
                  </div>
                  {addingTerm ? (
                    <div className="flex items-center gap-2">
                      <input autoFocus value={newTerm} onChange={e => setNewTerm(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addPaymentTerm() } }} placeholder="e.g. Net 90, 2/10 Net 30, Wire…" className={inp} style={inpStyle} />
                      <button type="button" onClick={addPaymentTerm} className="shrink-0 text-sm font-semibold px-3 py-2 rounded-lg bg-[#3B6FE0] hover:bg-[#2E5CC7] text-white transition-colors">Add</button>
                    </div>
                  ) : (
                    <select value={form.payment_terms} onChange={e => setForm(p => ({ ...p, payment_terms: e.target.value }))} className={inp} style={inpStyle}>
                      {paymentTermOptions.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  )}
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>Notes / Scope</label>
                  <textarea
                    value={form.notes}
                    onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                    rows={4}
                    placeholder="Add notes or scope of work…"
                    className={inp}
                    style={{ ...inpStyle, resize: 'vertical' }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>Billing Address</label>
                  <textarea value={form.billing_address} onChange={e => setForm(p => ({ ...p, billing_address: e.target.value }))} rows={3} placeholder="Bill-to address…" className={inp} style={{ ...inpStyle, resize: 'vertical' }} />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>Shipping Address</label>
                  <textarea value={form.shipping_address} onChange={e => setForm(p => ({ ...p, shipping_address: e.target.value }))} rows={3} placeholder="Ship-to address…" className={inp} style={{ ...inpStyle, resize: 'vertical' }} />
                </div>
                <div className="col-span-2 rounded-xl border border-[#CDE9DA] bg-[#F0FBF5] p-3">
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
                          setForm(p => ({ ...p, client_portal_visible: true, customer_id: cid }))
                          if (opt) setCustomerSearch(opt.label)
                        }}
                        className={inp}
                        style={{ ...inpStyle, cursor: 'pointer' }}
                      >
                        <option value="">— Not shared to a portal —</option>
                        {showCurrent && <option value={form.customer_id}>{(cmap[form.customer_id] || customerSearch || 'Current customer') + ' (current)'}</option>}
                        {portalOpts.map(o => <option key={o.customer_id} value={o.customer_id}>{o.label}</option>)}
                      </select>
                    )
                  })()}
                  {portalCustomerOptions(portals).length === 0 && (
                    <p className="text-[11px] mt-1.5" style={{ color: '#6B7280' }}>No client portals yet. Create one under <span style={{ fontWeight: 600 }}>Client Portals</span>, then connect quotes here.</p>
                  )}
                  {form.client_portal_visible && (
                    <div className="mt-2.5">
                      <label className="block text-xs mb-1.5" style={{ color: '#6B7280' }}>Client-facing project name <span style={{ color: '#9CA3AF' }}>(optional)</span></label>
                      <input value={form.client_portal_name} onChange={e => setForm(p => ({ ...p, client_portal_name: e.target.value }))} className={inp} style={inpStyle} placeholder="Defaults to the quote #" />
                      <p className="text-[11px] mt-1" style={{ color: '#6B7280' }}>Connecting a quote links it to that client&rsquo;s portal. They see this name, its live status, and a progress timeline — never pricing, internal notes, or comments.</p>
                    </div>
                  )}
                </div>
              </div>

              {lines.length > 0 && (
                <div className="rounded-xl p-4" style={{ background: '#F0F2F7' }}>
                  <p className="text-xs font-semibold mb-3 uppercase tracking-wider" style={{ color: '#9CA3AF' }}>Quote Summary</p>
                  <div className="flex justify-between text-sm mb-2">
                    <span style={{ color: '#6B7280' }}>Subtotal ({lines.length} line{lines.length !== 1 ? 's' : ''})</span>
                    <span style={{ color: '#1A1D2E' }}>{fmt$(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm mb-2">
                    <span style={{ color: '#6B7280' }}>Tax ({form.tax_rate}%)</span>
                    <span style={{ color: '#1A1D2E' }}>{fmt$(taxAmount)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold border-t pt-2 mt-2" style={{ borderColor: '#E4E6EE' }}>
                    <span style={{ color: '#1A1D2E' }}>Total</span>
                    <span style={{ color: '#3B6FE0' }}>{fmt$(total)}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* LINE ITEMS TAB */}
          {panelTab === 'lines' && (
            <div className="space-y-4">
              <div className="flex items-start gap-2 text-[11px] rounded-lg px-3 py-2 bg-[#EFF6FF] border border-[#DBEAFE] text-[#1D4ED8]">
                <span>🔗</span>
                <span><b>Inventory-linked (Ultron).</b> Lines pull live from the Inventory board (prices are the set default). Change a price here and it stays on this quote only — Inventory is never overwritten. Brand-new SKUs get added to Inventory on save.</span>
              </div>
              {/* Product quick-add search */}
              <div className="relative">
                <svg className="absolute left-3 top-2.5 w-4 h-4" style={{ color: '#9CA3AF' }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                <input
                  value={productSearch}
                  onChange={e => { setProductSearch(e.target.value); searchProducts(e.target.value) }}
                  placeholder="Quick-add: search by SKU or product name…"
                  className="w-full pl-9 pr-4 py-2 rounded-lg border text-sm focus:outline-none focus:border-blue-500 transition-colors"
                  style={{ borderColor: '#E4E6EE', color: '#1A1D2E' }}
                />
                {productResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 z-10 bg-white rounded-xl border shadow-lg overflow-hidden" style={{ borderColor: '#E4E6EE' }}>
                    {productResults.map(p => (
                      <button
                        key={p.id}
                        onClick={() => selectProduct(lines.length - 1 < 0 ? 0 : lines.length - 1, p)}
                        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#F9FAFB] text-left transition-colors"
                      >
                        <div>
                          <span className="text-xs font-semibold" style={{ color: '#3B6FE0' }}>{p.sku}</span>
                          <span className="text-xs ml-2" style={{ color: '#6B7280' }}>{p.product_name}</span>
                        </div>
                        <span className="text-xs font-medium" style={{ color: '#1A1D2E' }}>
                          {fmt$(p.wholesale_price ?? p.msrp ?? p.unit_cost)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Lines table */}
              <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#E4E6EE' }}>
                <table className="w-full">
                  <thead>
                    <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #E4E6EE' }}>
                      {['SKU', 'Description', 'Qty', 'Pcs/Case', 'Case Price', 'Unit Price', 'Total', ''].map(h => (
                        <th key={h} className="text-left px-3 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: '#9CA3AF' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-sm" style={{ color: '#9CA3AF' }}>
                          No line items yet. Search above or click Add Line Item.
                        </td>
                      </tr>
                    ) : lines.map((line, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #F3F4F6' }}>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <input value={line.sku ?? ''} onChange={e => updateLine(i, 'sku', e.target.value)} placeholder="SKU"
                              className="w-24 px-2 py-1.5 rounded-lg border text-xs focus:outline-none focus:border-blue-500"
                              style={{ borderColor: '#E4E6EE', color: '#1A1D2E' }} />
                            {line.product_id
                              ? <span title="Linked to Inventory" style={{ color: '#10B981', fontSize: '11px' }}>●</span>
                              : (line.sku ? <span title="New SKU — added to Inventory when you save" style={{ color: '#F59E0B', fontSize: '11px' }}>●</span> : null)}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <input value={line.product_name ?? line.description ?? ''} onChange={e => updateLine(i, 'product_name', e.target.value)} placeholder="Product / description"
                            className="w-full px-2 py-1.5 rounded-lg border text-xs focus:outline-none focus:border-blue-500"
                            style={{ borderColor: '#E4E6EE', color: '#1A1D2E' }} />
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" value={line.quantity ?? ''} onChange={e => updateLine(i, 'quantity', parseFloat(e.target.value) || 0)}
                            className="w-16 px-2 py-1.5 rounded-lg border text-xs focus:outline-none text-right focus:border-blue-500"
                            style={{ borderColor: '#E4E6EE', color: '#1A1D2E' }} />
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" value={line.pcs_per_case ?? ''} onChange={e => updateLine(i, 'pcs_per_case', e.target.value === '' ? null : parseFloat(e.target.value))}
                            placeholder="—"
                            className="w-16 px-2 py-1.5 rounded-lg border text-xs focus:outline-none text-right focus:border-blue-500"
                            style={{ borderColor: '#E4E6EE', color: '#1A1D2E' }} />
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" step="0.01" value={line.case_price ?? ''} onChange={e => updateLine(i, 'case_price', e.target.value === '' ? null : parseFloat(e.target.value))}
                            placeholder="—"
                            className="w-24 px-2 py-1.5 rounded-lg border text-xs focus:outline-none text-right focus:border-blue-500"
                            style={{ borderColor: '#E4E6EE', color: '#1A1D2E' }} />
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" value={line.unit_price ?? ''} onChange={e => updateLine(i, 'unit_price', parseFloat(e.target.value) || 0)}
                            className="w-24 px-2 py-1.5 rounded-lg border text-xs focus:outline-none text-right focus:border-blue-500"
                            style={{ borderColor: '#E4E6EE', color: '#1A1D2E' }} />
                        </td>
                        <td className="px-3 py-2 text-xs font-semibold text-right" style={{ color: '#1A1D2E' }}>
                          {fmt$(line.line_total)}
                        </td>
                        <td className="px-3 py-2">
                          <button onClick={() => removeLine(i)} className="p-1 rounded-lg transition-colors hover:bg-red-50" style={{ color: '#DC2626' }}>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between">
                <button
                  onClick={addLine}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors border hover:bg-gray-50"
                  style={{ borderColor: '#E4E6EE', color: '#6B7280' }}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                  Add Line Item
                </button>
                <div className="flex items-center gap-3">
                  <label className="text-sm" style={{ color: '#6B7280' }}>Tax Rate (%)</label>
                  <input type="number" value={form.tax_rate} onChange={e => setForm(p => ({ ...p, tax_rate: e.target.value }))}
                    className="w-20 px-3 py-1.5 rounded-lg border text-sm text-right focus:outline-none focus:border-blue-500"
                    style={{ borderColor: '#E4E6EE', color: '#1A1D2E' }} />
                </div>
              </div>

              <div className="rounded-xl p-4" style={{ background: '#F0F2F7' }}>
                <div className="flex justify-between text-sm mb-2">
                  <span style={{ color: '#6B7280' }}>Subtotal</span>
                  <span style={{ color: '#1A1D2E' }}>{fmt$(subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm mb-2">
                  <span style={{ color: '#6B7280' }}>Tax ({form.tax_rate}%)</span>
                  <span style={{ color: '#1A1D2E' }}>{fmt$(taxAmount)}</span>
                </div>
                <div className="flex justify-between text-sm font-bold border-t pt-2 mt-2" style={{ borderColor: '#E4E6EE' }}>
                  <span style={{ color: '#1A1D2E' }}>Total</span>
                  <span style={{ color: '#3B6FE0' }}>{fmt$(total)}</span>
                </div>
              </div>
            </div>
          )}

          {/* NOTES TAB */}
          {panelTab === 'notes' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-2" style={{ color: '#374151' }}>Notes {form.type === 'rfq' && <span className="text-[11px] text-gray-400">(shown in the Eco Maven portal)</span>}</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                  rows={8}
                  placeholder="Add notes, terms, or conditions…"
                  className={inp}
                  style={{ ...inpStyle, resize: 'vertical' }}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-2" style={{ color: '#374151' }}>Art files {form.type === 'rfq' && <span className="text-[11px] text-gray-400">(shown in the Eco Maven portal)</span>}</label>
                {editing?.id ? (
                  <FileUpload supabase={supabase} recordType="quotation_art" recordId={editing.id} currentUserEmail={userEmail} accept="image/*,application/pdf,.ai,.eps,.psd" />
                ) : (
                  <p className="text-[11px] text-gray-400">Save the {form.type === 'rfq' ? 'RFQ' : 'quote'} first, then upload art files here.</p>
                )}
              </div>
            </div>
          )}

          {panelTab === 'comments' && (
            <Comments
              recordId={editing?.id}
              recordType="quotation"
              currentUserEmail={userEmail}
              title="Comments"
            />
          )}
        </div>

        {/* Panel Footer */}
        <div className="px-4 py-3 border-t shrink-0" style={{ borderColor: '#E4E6EE', background: '#F9FAFB' }}>
          {editing && editing.status !== 'Converted' && confirmConvert === editing.id ? (
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-sm font-medium whitespace-nowrap" style={{ color: '#374151' }}>
                Convert {editing.quote_number} → Sales Order?
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setConfirmConvert(null)}
                  className="h-9 px-3 rounded-lg text-sm font-medium whitespace-nowrap transition-colors border"
                  style={{ borderColor: '#E4E6EE', color: '#6B7280' }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => doConvertToSO(editing)}
                  disabled={saving}
                  className="h-9 px-4 rounded-lg text-sm font-semibold text-white whitespace-nowrap disabled:opacity-50 transition-colors"
                  style={{ background: '#059669' }}
                >
                  {saving ? 'Converting…' : 'Confirm'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              {/* Cancel — left */}
              <button
                onClick={closePanel}
                className="h-9 px-4 rounded-lg text-sm font-medium whitespace-nowrap border transition-colors hover:bg-gray-100"
                style={{ borderColor: '#E4E6EE', color: '#6B7280' }}
              >
                Cancel
              </button>

              {/* Spacer pushes primary actions to the right */}
              <div className="flex-1" />

              {/* Secondary action group — icon buttons with tooltips */}
              {editing && (
                <button
                  onClick={() => setRfqModalOpen(true)}
                  className="h-9 px-3 rounded-lg text-sm font-medium whitespace-nowrap border transition-colors hover:bg-emerald-50 flex items-center gap-1.5"
                  style={{ borderColor: '#10B981', color: '#10B981' }}
                  title="Send RFQ to suppliers via email"
                >
                  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                  <span>Send RFQ</span>
                </button>
              )}

              {editing && editing.status !== 'Converted' && (
                <button
                  onClick={() => setConfirmConvert(editing.id)}
                  className="h-9 px-3 rounded-lg text-sm font-medium whitespace-nowrap transition-colors hover:opacity-90 flex items-center gap-1.5"
                  style={{ background: '#ECFDF5', color: '#059669' }}
                  title="Convert this quote into a Sales Order"
                >
                  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                  <span>Convert to SO</span>
                </button>
              )}

              <button
                onClick={handleDownloadRfq}
                className="h-9 px-3 rounded-lg text-sm font-medium whitespace-nowrap border transition-colors hover:bg-emerald-50 flex items-center gap-1.5"
                style={{ borderColor: '#10B981', color: '#10B981' }}
                title="Download as RFQ PDF (no pricing) to send to suppliers"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                <span>RFQ PDF</span>
              </button>

              {editing && (
                <button
                  onClick={handleDownloadPdf}
                  className="h-9 px-3 rounded-lg text-sm font-medium whitespace-nowrap border transition-colors hover:bg-gray-100 flex items-center gap-1.5"
                  style={{ borderColor: '#1A2035', color: '#1A2035' }}
                  title="Download customer-ready quote PDF (with pricing)"
                >
                  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
                  <span>Quote PDF</span>
                </button>
              )}

              {/* Primary — Save */}
              <button
                onClick={handleSave}
                disabled={saving}
                className="h-9 px-5 rounded-lg text-sm font-semibold text-white whitespace-nowrap transition-colors disabled:opacity-50 hover:opacity-90"
                style={{ background: '#3B6FE0' }}
              >
                {saving ? 'Saving…' : editing ? 'Save' : `Create ${form.type === 'rfq' ? 'RFQ' : 'Quote'}`}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* RFQ MODAL */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-300"
        style={{
          background: 'rgba(0,0,0,0.5)',
          opacity: rfqModalOpen ? 1 : 0,
          pointerEvents: rfqModalOpen ? 'auto' : 'none',
        }}
        onClick={() => setRfqModalOpen(false)}
      >
        <div
          className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4"
          onClick={e => e.stopPropagation()}
          style={{ background: '#FFFFFF' }}
        >
          <div className="mb-4">
            <h3 className="text-lg font-semibold mb-2" style={{ color: '#1A1D2E' }}>
              Send RFQ
            </h3>
            <p className="text-sm" style={{ color: '#6B7280' }}>
              Select suppliers to send pricing request for {editing?.quote_number}
            </p>
          </div>

          <div className="space-y-3 mb-6">
            {['Ameer', 'Veejay'].map(supplier => (
              <label key={supplier} className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors hover:bg-blue-50" style={{ borderColor: '#E4E6EE' }}>
                <input
                  type="checkbox"
                  checked={selectedRecipients.has(supplier)}
                  onChange={() => {
                    const next = new Set(selectedRecipients)
                    if (next.has(supplier)) next.delete(supplier)
                    else next.add(supplier)
                    setSelectedRecipients(next)
                  }}
                  className="w-4 h-4 rounded accent-blue-600"
                />
                <span className="text-sm font-medium" style={{ color: '#1A1D2E' }}>
                  {supplier}
                </span>
              </label>
            ))}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setRfqModalOpen(false)}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium border transition-colors hover:bg-gray-50"
              style={{ borderColor: '#E4E6EE', color: '#6B7280' }}
            >
              Cancel
            </button>
            <button
              onClick={handleSendRfq}
              disabled={rfqSending || selectedRecipients.size === 0}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50"
              style={{ background: '#10b981' }}
            >
              {rfqSending ? 'Sending…' : 'Send RFQ'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
