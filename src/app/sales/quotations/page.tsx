'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import Comments from '@/components/Comments'

interface Quote {
  id: string
  quote_number: string
  customer_id: string | null
  status: string
  quote_date: string | null
  expiry_date: string | null
  subtotal: number | null
  tax_amount: number | null
  total_amount: number | null
  payment_terms: string | null
  notes: string | null
  created_at: string
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
  product_id: string | null
}

interface Customer {
  id: string
  company_name: string
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

export default function QuotationsPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const router = useRouter()
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
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

  // Form state
  const [form, setForm] = useState({
    customer_id: '',
    status: 'Draft',
    quote_date: new Date().toISOString().split('T')[0],
    expiry_date: '',
    payment_terms: 'Net 30',
    notes: '',
    tax_rate: '0',
  })
  const [lines, setLines] = useState<Partial<QuoteLine>[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState<any[]>([])

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
    const { data } = await supabase
      .from('customers')
      .select('id, company_name')
      .order('company_name')
    setCustomers(data ?? [])
  }, [supabase])

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

  function openNew() {
    setEditing(null)
    setForm({
      customer_id: '',
      status: 'Draft',
      quote_date: new Date().toISOString().split('T')[0],
      expiry_date: new Date(Date.now() + 30 * 864e5).toISOString().split('T')[0],
      payment_terms: 'Net 30',
      notes: '',
      tax_rate: '0',
    })
    setLines([{ sku: '', product_name: '', description: '', quantity: 1, unit_price: 0, line_total: 0, product_id: null }])
    setPanelTab('overview')
    setPanelOpen(true)
  }

  async function openEdit(q: Quote) {
    setEditing(q)
    setForm({
      customer_id: q.customer_id ?? '',
      status: q.status ?? 'Draft',
      quote_date: q.quote_date ?? '',
      expiry_date: q.expiry_date ?? '',
      payment_terms: q.payment_terms ?? 'Net 30',
      notes: q.notes ?? '',
      tax_rate: '0',
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
      .select('id, sku, product_name, unit_cost, msrp, wholesale_price')
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
        line_total: (next[lineIdx].quantity ?? 1) * price,
      }
      return next
    })
    setProductSearch('')
    setProductResults([])
  }

  async function handleSave() {
    if (!form.customer_id) {
      alert('Please select a customer')
      return
    }
    setSaving(true)
    try {
      const quoteData = {
        customer_id: form.customer_id,
        status: form.status,
        quote_date: form.quote_date || null,
        expiry_date: form.expiry_date || null,
        notes: form.notes || null,
        subtotal,
        tax_amount: taxAmount,
        total_amount: total,
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
        const validLines = lines.filter(l => l.product_name || l.sku || l.description)
        if (validLines.length > 0) {
          const { error: linesErr } = await supabase.from('quotation_lines').insert(
            validLines.map(l => ({
              quotation_id: quoteId,
              product_id: l.product_id ?? null,
              sku: l.sku ?? null,
              product_name: l.product_name ?? null,
              description: l.description ?? null,
              quantity: l.quantity ?? 1,
              unit_price: l.unit_price ?? 0,
              line_total: l.line_total ?? 0,
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

  async function handleDelete(id: string) {
    if (!confirm('Delete this quotation?')) return
    await supabase.from('quotation_lines').delete().eq('quotation_id', id)
    await supabase.from('quotations').delete().eq('id', id)
    fetchQuotes()
  }

  async function doConvertToSO(quote: Quote) {
    setSaving(true)
    try {
      const { data: quoteLines } = await supabase
        .from('quotation_lines').select('*').eq('quotation_id', quote.id)
      const { data: order } = await supabase.from('sales_orders').insert({
        customer_id: quote.customer_id,
        order_number: 'SO-' + Date.now().toString().slice(-6),
        status: 'Confirmed',
        total_amount: quote.total_amount ?? 0,
        notes: 'Converted from ' + quote.quote_number,
      }).select('id').single()

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

  return (
    <div className="min-h-screen" style={{ background: '#F0F2F7' }}>

      {/* Page Header */}
      <div className="bg-white border-b px-8 py-5 flex items-center justify-between" style={{ borderColor: '#E4E6EE' }}>
        <div>
          <h1 className="text-lg font-semibold" style={{ color: '#1A1D2E' }}>Quotations</h1>
          <p className="text-sm mt-0.5" style={{ color: '#9CA3AF' }}>
            {loading ? 'Loading…' : `${filtered.length} quotation${filtered.length !== 1 ? 's' : ''}${statusFilter !== 'All' ? ` · ${statusFilter}` : ''}`}
          </p>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors hover:opacity-90"
          style={{ background: '#3B6FE0' }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          New Quote
        </button>
      </div>

      <div className="px-8 py-6">

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Total Quotes', value: quotes.length, color: '#3B6FE0' },
            { label: 'Pending / Sent', value: quotes.filter(q => q.status === 'Sent').length, color: '#D97706' },
            { label: 'Accepted', value: quotes.filter(q => q.status === 'Accepted').length, color: '#059669' },
            { label: 'Pipeline Value', value: fmt$(quotes.filter(q => !['Rejected','Converted'].includes(q.status)).reduce((s, q) => s + (q.total_amount ?? 0), 0)), color: '#7C3AED' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border p-5" style={{ borderColor: '#E4E6EE' }}>
              <p className="text-sm mb-1" style={{ color: '#9CA3AF' }}>{s.label}</p>
              <p className="text-2xl font-bold" style={{ color: s.color }}>{loading ? '—' : s.value}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl border p-4 mb-4 flex flex-wrap items-center gap-4" style={{ borderColor: '#E4E6EE' }}>
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <svg className="absolute left-3 top-2.5 w-4 h-4" style={{ color: '#9CA3AF' }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by quote # or customer…"
              className="w-full pl-9 pr-4 py-2 rounded-lg border text-sm focus:outline-none focus:border-blue-500 transition-colors"
              style={{ borderColor: '#E4E6EE', color: '#1A1D2E' }}
            />
          </div>
          <div className="flex gap-1 p-1 rounded-lg" style={{ background: '#F0F2F7' }}>
            {STATUSES.map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className="px-3 py-1.5 rounded-md text-sm font-medium transition-all"
                style={{
                  background: statusFilter === s ? '#fff' : 'transparent',
                  color: statusFilter === s ? '#1A1D2E' : '#9CA3AF',
                  boxShadow: statusFilter === s ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                {s}
              </button>
            ))}
          </div>
          {selected.size > 0 && (
            <button
              onClick={bulkDelete}
              disabled={deleting}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              style={{ background: '#FEF2F2', color: '#DC2626' }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              Delete {selected.size}
            </button>
          )}
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: '#E4E6EE' }}>
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-6 h-6 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <svg className="w-12 h-12 mb-4" style={{ color: '#D1D5DB' }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              <p className="text-sm font-medium mb-1" style={{ color: '#6B7280' }}>No quotations found</p>
              <p className="text-xs mb-4" style={{ color: '#9CA3AF' }}>
                {search ? 'Try a different search term' : 'Create your first quotation to get started'}
              </p>
              {!search && (
                <button onClick={openNew} className="px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-90" style={{ background: '#3B6FE0' }}>
                  New Quote
                </button>
              )}
            </div>
          ) : (
            <>
              <table className="w-full">
                <thead>
                  <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #E4E6EE' }}>
                    <th className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={selected.size === filtered.length && filtered.length > 0}
                        onChange={() => setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map(q => q.id)))}
                        className="w-4 h-4 rounded cursor-pointer accent-blue-600"
                      />
                    </th>
                    {['Quote #', 'Customer', 'Date', 'Expiry', 'Status', 'Lines', 'Total', ''].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: '#9CA3AF' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(quote => (
                    <tr
                      key={quote.id}
                      className="group cursor-pointer hover:bg-[#F9FAFB] transition-colors"
                      style={{ borderBottom: '1px solid #F3F4F6' }}
                      onClick={() => openEdit(quote)}
                    >
                      <td className="px-4 py-3.5" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(quote.id)}
                          onChange={() => {
                            const next = new Set(selected)
                            if (next.has(quote.id)) next.delete(quote.id)
                            else next.add(quote.id)
                            setSelected(next)
                          }}
                          className="w-4 h-4 rounded cursor-pointer accent-blue-600"
                        />
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="text-sm font-semibold" style={{ color: '#3B6FE0' }}>{quote.quote_number || '—'}</span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="text-sm font-medium" style={{ color: '#1A1D2E' }}>{cmap[quote.customer_id ?? ''] || '—'}</span>
                      </td>
                      <td className="px-4 py-3.5 text-sm" style={{ color: '#6B7280' }}>
                        {quote.quote_date ? new Date(quote.quote_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                      </td>
                      <td className="px-4 py-3.5 text-sm" style={{ color: '#6B7280' }}>
                        {quote.expiry_date ? new Date(quote.expiry_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusBadge status={quote.status ?? 'Draft'} />
                      </td>
                      <td className="px-4 py-3.5 text-sm" style={{ color: '#6B7280' }}>
                        {lineCounts[quote.id] ?? 0}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="text-sm font-semibold" style={{ color: '#1A1D2E' }}>{fmt$(quote.total_amount)}</span>
                      </td>
                      <td className="px-4 py-3.5" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => openEdit(quote)}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-gray-100"
                            style={{ background: '#F0F2F7', color: '#6B7280' }}
                          >
                            Edit
                          </button>
                          {quote.status !== 'Converted' && (
                            <button
                              onClick={() => { openEdit(quote); setConfirmConvert(quote.id) }}
                              className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1"
                              style={{ background: '#ECFDF5', color: '#059669' }}
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                              SO
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(quote.id)}
                            className="p-1.5 rounded-lg transition-colors hover:bg-red-50"
                            style={{ color: '#DC2626' }}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-4 py-3 flex items-center justify-between border-t" style={{ borderColor: '#F3F4F6', background: '#F9FAFB' }}>
                <p className="text-xs" style={{ color: '#9CA3AF' }}>{filtered.length} of {quotes.length} quotations</p>
                <p className="text-xs font-semibold" style={{ color: '#1A1D2E' }}>
                  Total: {fmt$(filtered.reduce((s, q) => s + (q.total_amount ?? 0), 0))}
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* OVERLAY */}
      <div
        className="fixed inset-0 z-40 transition-opacity duration-300"
        style={{
          background: 'rgba(0,0,0,0.3)',
          opacity: panelOpen ? 1 : 0,
          pointerEvents: panelOpen ? 'auto' : 'none',
        }}
        onClick={closePanel}
      />

      {/* SLIDE-OUT PANEL */}
      <div
        className="fixed top-0 right-0 h-full z-50 flex flex-col transition-transform duration-300 ease-in-out"
        style={{
          width: 700,
          background: '#FFFFFF',
          borderLeft: '1px solid #E4E6EE',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.12)',
          transform: panelOpen ? 'translateX(0)' : 'translateX(100%)',
        }}
      >
        {/* Panel Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0" style={{ borderColor: '#E4E6EE' }}>
          <div>
            <h2 className="font-semibold text-base" style={{ color: '#1A1D2E' }}>
              {editing ? `Quote ${editing.quote_number}` : 'New Quotation'}
            </h2>
            {editing && <div className="mt-1"><StatusBadge status={editing.status ?? 'Draft'} /></div>}
          </div>
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
                <div className="col-span-2">
                  <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>
                    Customer <span className="text-red-500">*</span>
                  </label>
                  <select value={form.customer_id} onChange={e => setForm(p => ({ ...p, customer_id: e.target.value }))} className={inp} style={inpStyle}>
                    <option value="">Select customer…</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                  </select>
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
                    {['Draft', 'Sent', 'Accepted', 'Rejected', 'Converted', 'Expired'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>Payment Terms</label>
                  <select value={form.payment_terms} onChange={e => setForm(p => ({ ...p, payment_terms: e.target.value }))} className={inp} style={inpStyle}>
                    {PAYMENT_TERMS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
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
                      {['SKU', 'Description', 'Qty', 'Unit Price', 'Total', ''].map(h => (
                        <th key={h} className="text-left px-3 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: '#9CA3AF' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: '#9CA3AF' }}>
                          No line items yet. Search above or click Add Line Item.
                        </td>
                      </tr>
                    ) : lines.map((line, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #F3F4F6' }}>
                        <td className="px-3 py-2">
                          <input value={line.sku ?? ''} onChange={e => updateLine(i, 'sku', e.target.value)} placeholder="SKU"
                            className="w-24 px-2 py-1.5 rounded-lg border text-xs focus:outline-none focus:border-blue-500"
                            style={{ borderColor: '#E4E6EE', color: '#1A1D2E' }} />
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
            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: '#374151' }}>Internal Notes</label>
              <textarea
                value={form.notes}
                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                rows={10}
                placeholder="Add internal notes, terms, or conditions…"
                className={inp}
                style={{ ...inpStyle, resize: 'vertical' }}
              />
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
        <div className="px-6 py-4 border-t flex items-center justify-between shrink-0" style={{ borderColor: '#E4E6EE', background: '#F9FAFB' }}>
          <div>
            {editing && editing.status !== 'Converted' && (
              confirmConvert === editing.id ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium" style={{ color: '#374151' }}>
                    Convert {editing.quote_number} → SO?
                  </span>
                  <button
                    onClick={() => doConvertToSO(editing)}
                    disabled={saving}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50 transition-colors"
                    style={{ background: '#059669' }}
                  >
                    {saving ? 'Converting…' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => setConfirmConvert(null)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                    style={{ background: '#F0F2F7', color: '#6B7280' }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmConvert(editing.id)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  style={{ background: '#ECFDF5', color: '#059669' }}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                  Convert to Sales Order
                </button>
              )
            )}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={closePanel} className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors hover:bg-gray-50" style={{ borderColor: '#E4E6EE', color: '#6B7280' }}>
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 hover:opacity-90"
              style={{ background: '#3B6FE0' }}
            >
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Quote'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
