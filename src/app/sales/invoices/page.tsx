'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import FileUpload from '@/components/FileUpload'
import CommentSection from '@/components/CommentSection'
import { generateInvoicePDF } from '@/lib/generateInvoice'

interface LineItem { id: string; sku: string | null; description: string; quantity: number; unit_price: number; uom: string | null; line_total: number }
interface Invoice {
  id: string
  invoice_number: string
  invoice_number_display: string | null
  invoice_type: string
  sales_order_id: string | null
  shipment_id: string | null
  customer_id: string | null
  invoice_date: string | null
  due_date: string | null
  subtotal: number
  tax_rate: number
  tax_amount: number
  total_amount: number
  amount: number
  amount_paid: number
  balance_due: number
  payment_terms: string | null
  payment_type: string | null
  deposit_percent: number
  deposit_amount: number
  deposit_paid: boolean
  production_blocked: boolean
  shipping_blocked: boolean
  po_number: string | null
  status: string
  reminder_count: number
  notes: string | null
  is_active: boolean
  customers?: { company_name: string } | null
  sales_orders?: { order_number: string } | null
}
interface Customer { id: string; company_name: string }

const STATUS_CFG: Record<string,{label:string;cls:string}> = {
  proforma: { label:'Proforma', cls:'bg-gray-700/50 text-gray-300 border-gray-600' },
  pending:  { label:'Pending',  cls:'bg-blue-500/15 text-blue-400 border-blue-500/20' },
  partial:  { label:'Partial',  cls:'bg-amber-500/15 text-amber-400 border-amber-500/20' },
  overdue:  { label:'Overdue',  cls:'bg-red-500/15 text-red-400 border-red-500/20' },
  paid:     { label:'Paid',     cls:'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' },
  void:     { label:'Void',     cls:'bg-gray-700/30 text-gray-500 border-gray-700' },
}
const TABS = ['all','proforma','pending','overdue','partial','paid','void'] as const
type Tab = typeof TABS[number]

const fmtD = (d: string|null|undefined) => d ? new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'
const fmt$ = (n: number) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n)
const today = () => new Date().toISOString().slice(0,10)

export default function InvoicesPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<Invoice[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')
  const [sel, setSel] = useState<Invoice|null>(null)
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [open, setOpen] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [partialAmt, setPartialAmt] = useState('')
  const [showPartial, setShowPartial] = useState(false)
  const [showVoidConfirm, setShowVoidConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  async function load() {
    setLoading(true)
    const [{ data: inv }, { data: c }] = await Promise.all([
      sb.from('invoices')
        .select('*,customers(company_name),sales_orders(order_number)')
        .eq('is_active', true)
        .order('invoice_date', { ascending: false }),
      sb.from('customers').select('id,company_name').eq('is_active', true).order('company_name'),
    ])
    if (inv) setRows(inv as Invoice[])
    if (c) setCustomers(c as Customer[])
    setLoading(false)
  }

  useEffect(() => {
    load()
    sb.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email) })
  }, []) // eslint-disable-line

  async function openPanel(inv: Invoice) {
    setSel(inv)
    setNotes(inv.notes ?? '')
    setPartialAmt('')
    setShowPartial(false)
    setShowVoidConfirm(false)
    setOpen(true)
    const { data } = await sb.from('invoice_line_items').select('*').eq('invoice_id', inv.id).order('id')
    setLineItems((data ?? []) as LineItem[])
  }

  function close() {
    setOpen(false)
    setTimeout(() => { setSel(null); setLineItems([]) }, 300)
  }

  const cmap = Object.fromEntries(customers.map(c => [c.id, c.company_name]))

  function getCustomerName(inv: Invoice) {
    return (inv.customers as any)?.company_name ?? (inv.customer_id ? cmap[inv.customer_id] : null) ?? '—'
  }
  function getOrderNumber(inv: Invoice) {
    return (inv.sales_orders as any)?.order_number ?? '—'
  }
  function displayNum(inv: Invoice) {
    return inv.invoice_number_display ?? inv.invoice_number
  }

  const filtered = rows.filter(r => {
    if (tab !== 'all' && r.status.toLowerCase() !== tab) return false
    if (!search) return true
    const q = search.toLowerCase()
    return displayNum(r).toLowerCase().includes(q) ||
      getCustomerName(r).toLowerCase().includes(q) ||
      (r.po_number ?? '').toLowerCase().includes(q)
  })

  // Stats
  const now = new Date()
  const weekEnd = new Date(now); weekEnd.setDate(now.getDate() + 7)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10)
  const yearStart = `${now.getFullYear()}-01-01`

  const outstanding = rows.filter(r => ['pending','partial','overdue'].includes(r.status))
  const outstandingAmt = outstanding.reduce((s, r) => s + (r.balance_due ?? 0), 0)
  const overdueRows = rows.filter(r => r.status === 'overdue')
  const overdueAmt = overdueRows.reduce((s, r) => s + (r.balance_due ?? 0), 0)
  const dueWeek = rows.filter(r => r.due_date && r.due_date >= today() && r.due_date <= weekEnd.toISOString().slice(0,10) && ['pending','partial'].includes(r.status))
  const dueWeekAmt = dueWeek.reduce((s, r) => s + (r.balance_due ?? 0), 0)
  const paidMonth = rows.filter(r => r.status === 'paid' && (r.invoice_date ?? '') >= monthStart)
  const paidMonthAmt = paidMonth.reduce((s, r) => s + (r.total_amount ?? r.amount ?? 0), 0)
  const ytdAmt = rows.filter(r => r.status === 'paid' && (r.invoice_date ?? '') >= yearStart).reduce((s, r) => s + (r.total_amount ?? r.amount ?? 0), 0)

  const tabCounts = TABS.reduce((acc, t) => {
    acc[t] = t === 'all' ? rows.length : rows.filter(r => r.status.toLowerCase() === t).length
    return acc
  }, {} as Record<Tab, number>)

  async function markPaid() {
    if (!sel) return
    setBusy(true)
    const total = sel.total_amount ?? sel.amount ?? 0
    await sb.from('invoices').update({ status: 'paid', amount_paid: total, balance_due: 0, updated_at: new Date().toISOString() }).eq('id', sel.id)
    setBusy(false); close(); load()
  }

  async function markDepositPaid() {
    if (!sel) return
    setBusy(true)
    await sb.from('invoices').update({ deposit_paid: true, production_blocked: false, updated_at: new Date().toISOString() }).eq('id', sel.id)
    setBusy(false)
    const { data } = await sb.from('invoices').select('*,customers(company_name),sales_orders(order_number)').eq('id', sel.id).single()
    if (data) { setSel(data as Invoice); setRows(prev => prev.map(r => r.id === data.id ? data as Invoice : r)) }
  }

  async function recordPartial() {
    if (!sel || !partialAmt) return
    const amt = parseFloat(partialAmt)
    if (isNaN(amt) || amt <= 0) return
    setBusy(true)
    const total = sel.total_amount ?? sel.amount ?? 0
    const newPaid = (sel.amount_paid ?? 0) + amt
    const newBalance = Math.max(0, total - newPaid)
    const newStatus = newBalance <= 0 ? 'paid' : 'partial'
    await sb.from('invoices').update({ amount_paid: newPaid, balance_due: newBalance, status: newStatus, updated_at: new Date().toISOString() }).eq('id', sel.id)
    setBusy(false); close(); load()
  }

  async function sendReminder() {
    if (!sel) return
    setBusy(true)
    await fetch('/api/invoices/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invoice_number: displayNum(sel),
        invoice_type: sel.invoice_type,
        customer_name: getCustomerName(sel),
        po_number: sel.po_number,
        total_amount: sel.total_amount ?? sel.amount,
        payment_terms: sel.payment_terms,
        due_date: sel.due_date,
      }),
    })
    await sb.from('invoices').update({ reminder_count: (sel.reminder_count ?? 0) + 1, updated_at: new Date().toISOString() }).eq('id', sel.id)
    setBusy(false); close(); load()
  }

  async function convertToInvoice() {
    if (!sel) return
    setBusy(true)
    await sb.from('invoices').update({ invoice_type: 'invoice', status: 'pending', updated_at: new Date().toISOString() }).eq('id', sel.id)
    setBusy(false); close(); load()
  }

  async function voidInvoice() {
    if (!sel) return
    setBusy(true)
    await sb.from('invoices').update({ status: 'void', updated_at: new Date().toISOString() }).eq('id', sel.id)
    setBusy(false); close(); load()
  }

  async function saveNotes() {
    if (!sel) return
    setSavingNotes(true)
    await sb.from('invoices').update({ notes: notes.trim() || null, updated_at: new Date().toISOString() }).eq('id', sel.id)
    setSavingNotes(false)
  }

  function downloadPDF() {
    if (!sel) return
    const customer = sel.customer_id ? { company_name: getCustomerName(sel), email: null, phone: null, billing_address: null, contact_name: null } : null
    generateInvoicePDF(sel, customer, lineItems.map(l => ({ sku: l.sku, description: l.description, quantity: l.quantity, unit_price: l.unit_price, uom: l.uom, line_total: l.line_total })), getOrderNumber(sel))
  }

  async function importShipments() {
    setImporting(true)
    setImportMsg(null)
    try {
      const res = await fetch('/api/invoices/import-shipments', { method: 'POST' })
      const json = await res.json()
      if (json.error) {
        setImportMsg(`Error: ${json.error}`)
      } else if (json.imported === 0) {
        setImportMsg('All shipments are already invoiced.')
      } else {
        setImportMsg(`Imported ${json.imported} shipment${json.imported !== 1 ? 's' : ''} as pending invoices.`)
        load()
      }
    } catch {
      setImportMsg('Import failed. Check console.')
    }
    setImporting(false)
  }

  const inp = 'w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition'

  return (
    <div className="p-4 md:p-8 min-h-screen">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-blue-500/20 text-blue-300 border-blue-500/30">SALES</span>
          <h1 className="text-2xl font-semibold text-white mt-1">Invoices & Billing</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${rows.length} invoice${rows.length !== 1 ? 's' : ''}`}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button onClick={importShipments} disabled={importing}
            className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 border border-gray-700 text-gray-300 hover:text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">
            {importing
              ? <><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Importing…</>
              : <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>Import Shipments</>
            }
          </button>
          {importMsg && <p className="text-xs text-gray-400">{importMsg}</p>}
        </div>
      </div>

      {/* Stats */}
      {!loading && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">Outstanding</p>
            <p className="text-lg font-bold text-white">{fmt$(outstandingAmt)}</p>
            <p className="text-xs text-gray-600 mt-0.5">{outstanding.length} invoice{outstanding.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="bg-gray-900 border border-red-900/40 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">Overdue</p>
            <p className="text-lg font-bold text-red-400">{fmt$(overdueAmt)}</p>
            <p className="text-xs text-gray-600 mt-0.5">{overdueRows.length} overdue</p>
          </div>
          <div className="bg-gray-900 border border-amber-900/30 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">Due This Week</p>
            <p className="text-lg font-bold text-amber-400">{fmt$(dueWeekAmt)}</p>
            <p className="text-xs text-gray-600 mt-0.5">{dueWeek.length} invoice{dueWeek.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="bg-gray-900 border border-emerald-900/30 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">Paid This Month</p>
            <p className="text-lg font-bold text-emerald-400">{fmt$(paidMonthAmt)}</p>
            <p className="text-xs text-gray-600 mt-0.5">{paidMonth.length} paid</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">YTD Collected</p>
            <p className="text-lg font-bold text-white">{fmt$(ytdAmt)}</p>
            <p className="text-xs text-gray-600 mt-0.5">{now.getFullYear()}</p>
          </div>
        </div>
      )}

      {/* Tabs + Search */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1 overflow-x-auto">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${tab === t ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>
              {t.charAt(0).toUpperCase() + t.slice(1)}{tabCounts[t] > 0 ? ` (${tabCounts[t]})` : ''}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-sm ml-auto">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          <input placeholder="Search invoices…" value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-gray-900 border border-gray-800 text-white placeholder-gray-600 rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"/>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <svg className="w-5 h-5 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-gray-500 text-sm">{search ? 'No matches.' : 'No invoices.'}</p>
          </div>
        ) : (
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                {['Invoice #','Type','Customer','PO #','Date','Due Date','Total','Paid','Balance','Terms','Status'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const isOverdue = r.status === 'overdue'
                const cfg = STATUS_CFG[r.status.toLowerCase()] ?? STATUS_CFG.pending
                return (
                  <tr key={r.id} onClick={() => openPanel(r)}
                    className={`border-b border-gray-800/60 last:border-0 cursor-pointer hover:bg-gray-800/40 transition-colors ${isOverdue ? 'bg-red-950/10' : i % 2 === 1 ? 'bg-gray-800/10' : ''}`}>
                    <td className="px-4 py-3.5 text-white font-mono text-xs font-medium">{displayNum(r)}</td>
                    <td className="px-4 py-3.5">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium border ${r.invoice_type === 'proforma' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' : 'bg-blue-500/10 text-blue-400 border-blue-500/20'}`}>
                        {r.invoice_type === 'proforma' ? 'PF' : 'INV'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-gray-300">{getCustomerName(r)}</td>
                    <td className="px-4 py-3.5 text-gray-400 font-mono text-xs">{r.po_number ?? '—'}</td>
                    <td className="px-4 py-3.5 text-gray-400 whitespace-nowrap">{fmtD(r.invoice_date)}</td>
                    <td className={`px-4 py-3.5 whitespace-nowrap font-medium ${isOverdue ? 'text-red-400' : 'text-gray-400'}`}>{fmtD(r.due_date)}</td>
                    <td className="px-4 py-3.5 text-gray-300">{fmt$(r.total_amount ?? r.amount ?? 0)}</td>
                    <td className="px-4 py-3.5 text-emerald-400">{fmt$(r.amount_paid ?? 0)}</td>
                    <td className={`px-4 py-3.5 font-medium ${(r.balance_due ?? 0) > 0 ? (isOverdue ? 'text-red-400' : 'text-amber-400') : 'text-gray-500'}`}>{fmt$(r.balance_due ?? 0)}</td>
                    <td className="px-4 py-3.5 text-gray-500 text-xs">{r.payment_terms ?? '—'}</td>
                    <td className="px-4 py-3.5">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium border ${cfg.cls} ${isOverdue ? 'animate-pulse' : ''}`}>{cfg.label}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Backdrop */}
      <div className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={close}/>

      {/* Slide-out panel */}
      <div ref={panelRef} onClick={e => e.stopPropagation()}
        className={`fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-full w-full md:w-[660px] bg-gray-900 border-l border-gray-800 z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        {sel && (
          <>
            {/* Panel header */}
            <div className="flex items-start justify-between px-6 py-5 border-b border-gray-800 shrink-0">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium border ${sel.invoice_type === 'proforma' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' : 'bg-blue-500/10 text-blue-400 border-blue-500/20'}`}>
                    {sel.invoice_type === 'proforma' ? 'PROFORMA' : 'INVOICE'}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${(STATUS_CFG[sel.status.toLowerCase()] ?? STATUS_CFG.pending).cls}`}>
                    {(STATUS_CFG[sel.status.toLowerCase()] ?? STATUS_CFG.pending).label}
                  </span>
                  {sel.production_blocked && <span className="text-xs px-2 py-0.5 rounded-full font-medium border bg-red-500/15 text-red-400 border-red-500/20">PROD BLOCKED</span>}
                  {sel.shipping_blocked && !sel.production_blocked && <span className="text-xs px-2 py-0.5 rounded-full font-medium border bg-orange-500/15 text-orange-400 border-orange-500/20">SHIP BLOCKED</span>}
                </div>
                <h2 className="text-white font-semibold text-lg font-mono">{displayNum(sel)}</h2>
                <p className="text-gray-500 text-sm">{getCustomerName(sel)}</p>
              </div>
              <button onClick={close} className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-gray-800 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="px-6 py-5 space-y-6">

                {/* Overdue banner */}
                {sel.status === 'overdue' && (
                  <div className="bg-red-950/30 border border-red-800/50 rounded-xl p-4 flex gap-3">
                    <svg className="w-5 h-5 text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                    <div>
                      <p className="text-red-300 font-medium text-sm">Payment Overdue</p>
                      <p className="text-red-400/70 text-xs mt-0.5">Due {fmtD(sel.due_date)} · Reminder #{sel.reminder_count ?? 0} sent</p>
                    </div>
                  </div>
                )}

                {/* Production blocked banner */}
                {sel.production_blocked && !sel.deposit_paid && (
                  <div className="bg-orange-950/30 border border-orange-800/50 rounded-xl p-4 flex gap-3">
                    <svg className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/></svg>
                    <div>
                      <p className="text-orange-300 font-medium text-sm">Production & Shipping Blocked</p>
                      <p className="text-orange-400/70 text-xs mt-0.5">Awaiting deposit of {fmt$(sel.deposit_amount ?? 0)} ({sel.deposit_percent ?? 50}%)</p>
                    </div>
                  </div>
                )}

                {/* Customer & Order */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Customer & Order</p>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      ['Customer', getCustomerName(sel)],
                      ['Sales Order', getOrderNumber(sel)],
                      ['PO Number', sel.po_number ?? '—'],
                      ['Invoice Date', fmtD(sel.invoice_date)],
                      ['Due Date', fmtD(sel.due_date)],
                      ['Payment Terms', sel.payment_terms ?? '—'],
                    ].map(([label, value]) => (
                      <div key={label} className="bg-gray-800/50 rounded-lg px-3 py-2.5">
                        <p className="text-xs text-gray-500">{label}</p>
                        <p className="text-sm text-white mt-0.5">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 50/50 deposit */}
                {sel.payment_type === '50/50' && (
                  <div className="border border-gray-700 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">50/50 Deposit</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${sel.deposit_paid ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' : 'bg-amber-500/15 text-amber-400 border-amber-500/20'}`}>
                        {sel.deposit_paid ? 'Received' : 'Pending'}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm mb-3">
                      <span className="text-gray-400">Deposit Amount ({sel.deposit_percent ?? 50}%)</span>
                      <span className="text-white font-medium">{fmt$(sel.deposit_amount ?? 0)}</span>
                    </div>
                    {!sel.deposit_paid && (
                      <button onClick={markDepositPaid} disabled={busy}
                        className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
                        {busy ? 'Saving…' : 'Mark Deposit Received'}
                      </button>
                    )}
                  </div>
                )}

                {/* Financials */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Financials</p>
                  <div className="bg-gray-800/30 rounded-xl overflow-hidden">
                    {[
                      ['Subtotal', fmt$(sel.subtotal ?? sel.total_amount ?? sel.amount ?? 0), false],
                      [`Tax (${sel.tax_rate ?? 0}%)`, fmt$(sel.tax_amount ?? 0), false],
                      ['Total', fmt$(sel.total_amount ?? sel.amount ?? 0), true],
                      ['Amount Paid', fmt$(sel.amount_paid ?? 0), false],
                      ['Balance Due', fmt$(sel.balance_due ?? 0), true],
                    ].map(([label, value, bold], i, arr) => (
                      <div key={label as string} className={`flex justify-between px-4 py-2.5 ${i < arr.length - 1 ? 'border-b border-gray-700/50' : ''}`}>
                        <span className={`text-sm ${bold ? 'text-white font-semibold' : 'text-gray-400'}`}>{label}</span>
                        <span className={`text-sm font-medium ${label === 'Balance Due' ? ((sel.balance_due ?? 0) > 0 ? 'text-amber-400' : 'text-emerald-400') : bold ? 'text-white' : 'text-gray-300'}`}>{value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Line items */}
                {lineItems.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Line Items</p>
                    <div className="rounded-xl border border-gray-700 overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-gray-800 border-b border-gray-700">
                            {['SKU','Description','Qty','UOM','Unit Price','Total'].map(h => (
                              <th key={h} className="text-left text-gray-400 px-3 py-2 font-medium">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {lineItems.map((l, i) => (
                            <tr key={l.id} className={`border-b border-gray-700/50 last:border-0 ${i % 2 === 1 ? 'bg-gray-800/20' : ''}`}>
                              <td className="px-3 py-2 text-gray-400 font-mono">{l.sku ?? '—'}</td>
                              <td className="px-3 py-2 text-gray-300">{l.description}</td>
                              <td className="px-3 py-2 text-gray-400 text-right">{l.quantity}</td>
                              <td className="px-3 py-2 text-gray-500">{l.uom ?? 'EA'}</td>
                              <td className="px-3 py-2 text-gray-400 text-right">{fmt$(l.unit_price)}</td>
                              <td className="px-3 py-2 text-white font-medium text-right">{fmt$(l.line_total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Actions</p>
                  <div className="flex flex-wrap gap-2">
                    {sel.status !== 'paid' && sel.status !== 'void' && (
                      <button onClick={markPaid} disabled={busy}
                        className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
                        Mark Paid
                      </button>
                    )}
                    {sel.status !== 'paid' && sel.status !== 'void' && (
                      <button onClick={() => setShowPartial(v => !v)} className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">
                        Partial Payment
                      </button>
                    )}
                    {sel.invoice_type === 'proforma' && (
                      <button onClick={convertToInvoice} disabled={busy}
                        className="flex items-center gap-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">
                        Convert to Invoice
                      </button>
                    )}
                    {['pending','partial','overdue'].includes(sel.status) && (
                      <button onClick={sendReminder} disabled={busy}
                        className="flex items-center gap-1.5 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">
                        Send Reminder
                      </button>
                    )}
                    <button onClick={downloadPDF} className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                      Download PDF
                    </button>
                    {sel.status !== 'void' && sel.status !== 'paid' && (
                      <button onClick={() => setShowVoidConfirm(v => !v)} className="flex items-center gap-1.5 bg-red-900/50 hover:bg-red-800/50 text-red-400 text-xs font-medium px-3 py-2 rounded-lg transition-colors border border-red-800/50">
                        Void Invoice
                      </button>
                    )}
                  </div>

                  {/* Partial payment form */}
                  {showPartial && (
                    <div className="mt-3 flex gap-2 items-center">
                      <input type="number" placeholder="Amount received…" value={partialAmt} onChange={e => setPartialAmt(e.target.value)} className={inp + ' max-w-[180px]'}/>
                      <button onClick={recordPartial} disabled={busy || !partialAmt} className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors whitespace-nowrap">
                        {busy ? 'Saving…' : 'Record Payment'}
                      </button>
                    </div>
                  )}

                  {/* Void confirm */}
                  {showVoidConfirm && (
                    <div className="mt-3 bg-red-950/30 border border-red-800/40 rounded-xl p-3 flex gap-3 items-center">
                      <p className="text-red-300 text-sm flex-1">Void this invoice? This cannot be undone.</p>
                      <button onClick={voidInvoice} disabled={busy} className="bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">
                        {busy ? 'Voiding…' : 'Confirm Void'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Notes */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Internal Notes</p>
                  <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add internal notes…" className={inp + ' resize-none'}/>
                  <button onClick={saveNotes} disabled={savingNotes} className="mt-2 text-xs text-gray-400 hover:text-white transition-colors disabled:opacity-50">
                    {savingNotes ? 'Saved ✓' : 'Save Notes'}
                  </button>
                </div>

                {/* Files */}
                <div className="border-t border-gray-800 pt-5">
                  <FileUpload supabase={sb} recordType="invoices" recordId={sel.id} currentUserEmail={userEmail}/>
                </div>

                {/* Comments */}
                <div className="border-t border-gray-800 pt-5 pb-6">
                  <CommentSection recordType="invoices" recordId={sel.id} currentUserEmail={userEmail}/>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
