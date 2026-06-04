'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import FileUpload from '@/components/FileUpload'
import CommentSection from '@/components/CommentSection'
import { generateInvoicePDF } from '@/lib/generateInvoice'
import { useMultiSelect } from '@/hooks/useMultiSelect'
import BulkActionBar from '@/components/BulkActionBar'
import WorkflowMover from '@/components/WorkflowMover'

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

const STATUS_CFG: Record<string,{label:string;cls:string;pulse?:boolean}> = {
  proforma: { label:'PROFORMA', cls:'bg-gray-700/50 text-gray-300 border-gray-600' },
  pending:  { label:'UNPAID',   cls:'bg-red-500/20 text-red-400 border-red-500/30' },
  partial:  { label:'PARTIAL',  cls:'bg-blue-500/15 text-blue-400 border-blue-500/20' },
  overdue:  { label:'OVERDUE',  cls:'bg-red-600/20 text-red-500 border-red-600/30', pulse: true },
  paid:     { label:'PAID',     cls:'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' },
  void:     { label:'VOID',     cls:'bg-gray-700/30 text-gray-500 border-gray-700' },
}

type Tab = 'all' | 'unpaid' | 'overdue' | 'paid' | 'proforma'
const TABS: Tab[] = ['all','unpaid','overdue','paid','proforma']

const PAY_METHODS = ['Check','ACH','Wire','Credit Card','Cash','Other']

const fmtD = (d: string|null|undefined) => d ? new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'
const fmt$ = (n: number) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n)
const todayStr = () => new Date().toISOString().slice(0,10)

function daysOverdue(dueDate: string | null): number {
  if (!dueDate) return 0
  const due = new Date(dueDate + 'T00:00:00')
  const now = new Date()
  now.setHours(0,0,0,0)
  const diff = Math.floor((now.getTime() - due.getTime()) / 86400000)
  return diff > 0 ? diff : 0
}

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
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const ms = useMultiSelect<Invoice>()
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)

  // Payment form state
  const [showPayFull, setShowPayFull] = useState(false)
  const [payDate, setPayDate] = useState(todayStr())
  const [payMethod, setPayMethod] = useState('Check')
  const [payRef, setPayRef] = useState('')
  const [payNotes, setPayNotes] = useState('')

  // Partial payment
  const [showPartial, setShowPartial] = useState(false)
  const [partialAmt, setPartialAmt] = useState('')
  const [partialDate, setPartialDate] = useState(todayStr())
  const [partialMethod, setPartialMethod] = useState('Check')
  const [partialRef, setPartialRef] = useState('')

  // Update amount
  const [showUpdateAmt, setShowUpdateAmt] = useState(false)
  const [updateAmt, setUpdateAmt] = useState('')
  const [updatingAmt, setUpdatingAmt] = useState(false)

  // Void confirm
  const [showVoidConfirm, setShowVoidConfirm] = useState(false)

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

  async function bulkDelete() {
    if (!confirm(`Delete ${ms.count} invoices? This cannot be undone.`)) return
    setDeleting(true)
    const ids = Array.from(ms.selected)
    await sb.from('invoice_line_items').delete().in('invoice_id', ids)
    await sb.from('invoices').delete().in('id', ids)
    ms.clear()
    setDeleting(false)
    load()
  }

  async function openPanel(inv: Invoice) {
    setSel(inv)
    setNotes(inv.notes ?? '')
    setPartialAmt('')
    setShowPartial(false)
    setShowPayFull(false)
    setShowVoidConfirm(false)
    setShowUpdateAmt(false)
    setPayDate(todayStr())
    setPayMethod('Check')
    setPayRef('')
    setPayNotes('')
    setPartialDate(todayStr())
    setPartialMethod('Check')
    setPartialRef('')
    setUpdateAmt(String(inv.total_amount ?? inv.amount ?? 0))
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
  function getSource(inv: Invoice) {
    if (inv.shipment_id) return 'Shipment'
    if (inv.sales_order_id) return 'Order'
    return 'Manual'
  }

  const filtered = rows.filter(r => {
    const status = r.status.toLowerCase()
    if (tab === 'unpaid' && !['pending','partial'].includes(status)) return false
    if (tab !== 'all' && tab !== 'unpaid' && status !== tab) return false
    if (!search) return true
    const q = search.toLowerCase()
    return displayNum(r).toLowerCase().includes(q) ||
      getCustomerName(r).toLowerCase().includes(q) ||
      (r.po_number ?? '').toLowerCase().includes(q)
  })

  // Stats
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10)

  const outstanding = rows.filter(r => ['pending','partial','overdue'].includes(r.status))
  const outstandingAmt = outstanding.reduce((s, r) => s + (r.balance_due ?? 0), 0)
  const overdueRows = rows.filter(r => r.status === 'overdue' || (r.status !== 'paid' && r.status !== 'void' && r.due_date && r.due_date < todayStr()))
  const overdueAmt = overdueRows.reduce((s, r) => s + (r.balance_due ?? 0), 0)
  const paidMonth = rows.filter(r => r.status === 'paid' && (r.invoice_date ?? '') >= monthStart)
  const paidMonthAmt = paidMonth.reduce((s, r) => s + (r.total_amount ?? r.amount ?? 0), 0)
  const totalInvoiced = rows.reduce((s, r) => s + (r.total_amount ?? r.amount ?? 0), 0)

  const tabCounts: Record<Tab, number> = {
    all: rows.length,
    unpaid: rows.filter(r => ['pending','partial'].includes(r.status.toLowerCase())).length,
    overdue: overdueRows.length,
    paid: rows.filter(r => r.status === 'paid').length,
    proforma: rows.filter(r => r.status === 'proforma' || r.invoice_type === 'proforma').length,
  }

  // Actions
  async function markPaid() {
    if (!sel) return
    setBusy(true)
    const total = sel.total_amount ?? sel.amount ?? 0
    await sb.from('invoices').update({
      status: 'paid', amount_paid: total, balance_due: 0,
      updated_at: new Date().toISOString(),
      notes: payNotes.trim() ? payNotes.trim() : sel.notes,
    }).eq('id', sel.id)
    setBusy(false); close(); load()
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

  async function updateAmount() {
    if (!sel || !updateAmt) return
    const amt = parseFloat(updateAmt)
    if (isNaN(amt) || amt < 0) return
    setUpdatingAmt(true)
    const paid = sel.amount_paid ?? 0
    const newBalance = Math.max(0, amt - paid)
    const newStatus = newBalance <= 0 ? 'paid' : sel.status === 'paid' ? 'pending' : sel.status
    await sb.from('invoices').update({
      total_amount: amt, amount: amt, subtotal: amt, balance_due: newBalance,
      status: newBalance <= 0 ? 'paid' : newStatus,
      updated_at: new Date().toISOString(),
    }).eq('id', sel.id)
    setUpdatingAmt(false); setShowUpdateAmt(false); close(); load()
  }

  async function voidInvoice() {
    if (!sel) return
    setBusy(true)
    await sb.from('invoices').update({ status: 'void', updated_at: new Date().toISOString() }).eq('id', sel.id)
    setBusy(false); close(); load()
  }

  async function convertToInvoice() {
    if (!sel) return
    setBusy(true)
    await sb.from('invoices').update({ invoice_type: 'invoice', status: 'pending', updated_at: new Date().toISOString() }).eq('id', sel.id)
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
  const inpSm = 'w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 transition'
  const selSm = inpSm + ' cursor-pointer'

  return (
    <div className="p-4 md:p-8 min-h-screen">
      {/* Amber warning banner */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-6">
        <p className="text-amber-400 font-medium text-sm">
          ⚠ These invoices were imported from shipment records. All are defaulted to UNPAID. Please review each invoice and update the payment status accordingly.
        </p>
      </div>

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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-gray-900 border border-red-900/40 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">Total Outstanding</p>
            <p className="text-lg font-bold text-red-400">{fmt$(outstandingAmt)}</p>
            <p className="text-xs text-gray-600 mt-0.5">{outstanding.length} unpaid invoice{outstanding.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="bg-gray-900 border border-red-900/60 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">Overdue</p>
            <p className="text-lg font-bold text-red-500">{fmt$(overdueAmt)}</p>
            <p className="text-xs text-gray-600 mt-0.5">{overdueRows.length} overdue</p>
          </div>
          <div className="bg-gray-900 border border-emerald-900/30 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">Paid This Month</p>
            <p className="text-lg font-bold text-emerald-400">{fmt$(paidMonthAmt)}</p>
            <p className="text-xs text-gray-600 mt-0.5">{paidMonth.length} paid</p>
          </div>
          <div className="bg-gray-900 border border-blue-900/30 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">Total Invoiced</p>
            <p className="text-lg font-bold text-blue-400">{fmt$(totalInvoiced)}</p>
            <p className="text-xs text-gray-600 mt-0.5">{rows.length} invoices</p>
          </div>
        </div>
      )}

      {/* Tabs + Search */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1 overflow-x-auto">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${tab === t ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>
              {t === 'unpaid' ? 'Unpaid' : t.charAt(0).toUpperCase() + t.slice(1)}{tabCounts[t] > 0 ? ` (${tabCounts[t]})` : ''}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-sm ml-auto">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          <input placeholder="Search customer, invoice #, PO #…" value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-gray-900 border border-gray-800 text-white placeholder-gray-600 rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"/>
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
          <table className="w-full min-w-[1000px] text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="w-10 px-4 py-3"><input type="checkbox" checked={ms.isAllSelected(filtered)} onChange={()=>ms.toggleAll(filtered)} className="accent-emerald-500 w-4 h-4 cursor-pointer"/></th>
                {['Invoice #','Customer','PO #','Invoice Date','Due Date','Amount','Status','Days Overdue','Source','Actions'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const status = r.status.toLowerCase()
                const isOverdue = status === 'overdue' || (status !== 'paid' && status !== 'void' && r.due_date && r.due_date < todayStr())
                const cfg = STATUS_CFG[status] ?? STATUS_CFG.pending
                const days = isOverdue ? daysOverdue(r.due_date) : 0
                return (
                  <tr key={r.id}
                    className={`border-b border-gray-800/60 last:border-0 hover:bg-gray-800/40 transition-colors ${ms.isSelected(r.id) ? 'bg-blue-500/5' : isOverdue ? 'bg-red-950/10' : status === 'pending' ? 'bg-red-950/5' : i % 2 === 1 ? 'bg-gray-800/10' : ''}`}>
                    <td className="px-4 py-3.5" onClick={e=>e.stopPropagation()}><input type="checkbox" checked={ms.isSelected(r.id)} onChange={()=>ms.toggle(r.id)} className="accent-emerald-500 w-4 h-4 cursor-pointer"/></td>
                    <td className="px-4 py-3.5 text-white font-mono text-xs font-medium cursor-pointer" onClick={() => openPanel(r)}>{displayNum(r)}</td>
                    <td className="px-4 py-3.5 text-gray-300" onClick={() => openPanel(r)}>{getCustomerName(r)}</td>
                    <td className="px-4 py-3.5 text-gray-400 font-mono text-xs" onClick={() => openPanel(r)}>{r.po_number ?? '—'}</td>
                    <td className="px-4 py-3.5 text-gray-400 whitespace-nowrap" onClick={() => openPanel(r)}>{fmtD(r.invoice_date)}</td>
                    <td className={`px-4 py-3.5 whitespace-nowrap font-medium ${isOverdue ? 'text-red-400' : 'text-gray-400'}`} onClick={() => openPanel(r)}>{fmtD(r.due_date)}</td>
                    <td className="px-4 py-3.5 text-gray-300 font-medium" onClick={() => openPanel(r)}>{fmt$(r.total_amount ?? r.amount ?? 0)}</td>
                    <td className="px-4 py-3.5" onClick={() => openPanel(r)}>
                      <span className={`text-xs px-2 py-1 rounded-full font-semibold border ${cfg.cls} ${cfg.pulse ? 'animate-pulse' : ''}`}>{cfg.label}</span>
                    </td>
                    <td className="px-4 py-3.5" onClick={() => openPanel(r)}>
                      {days > 0 ? <span className="text-xs text-red-400 font-medium">{days}d</span> : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-3.5" onClick={() => openPanel(r)}>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium border ${r.shipment_id ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : r.sales_order_id ? 'bg-violet-500/10 text-violet-400 border-violet-500/20' : 'bg-gray-700/30 text-gray-500 border-gray-700'}`}>
                        {getSource(r)}
                      </span>
                    </td>
                    <td className="px-4 py-3.5" onClick={e=>e.stopPropagation()}>
                      <div className="flex items-center gap-1.5">
                        {status !== 'paid' && status !== 'void' && (
                          <button onClick={e => { e.stopPropagation(); openPanel(r); setTimeout(() => setShowPayFull(true), 200) }}
                            className="text-xs px-2 py-1 rounded bg-emerald-700/50 hover:bg-emerald-700 text-emerald-300 transition-colors whitespace-nowrap">
                            Mark Paid
                          </button>
                        )}
                        <WorkflowMover recordId={r.id} recordType="invoice" currentStatus={r.status} onMoved={load}/>
                        <button onClick={e => { e.stopPropagation(); openPanel(r) }}
                          className="text-xs px-2 py-1 rounded bg-gray-700/50 hover:bg-gray-700 text-gray-300 transition-colors">
                          View
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <BulkActionBar count={ms.count} onDelete={bulkDelete} onClear={ms.clear} deleting={deleting}/>

      {/* Backdrop */}
      <div className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={close}/>

      {/* Slide-out panel */}
      <div ref={panelRef} onClick={e => e.stopPropagation()}
        className={`fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-full w-full md:w-[680px] bg-gray-900 border-l border-gray-800 z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        {sel && (
          <>
            {/* Panel header */}
            <div className="flex items-start justify-between px-6 py-5 border-b border-gray-800 shrink-0">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium border ${sel.invoice_type === 'proforma' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' : 'bg-blue-500/10 text-blue-400 border-blue-500/20'}`}>
                    {sel.invoice_type === 'proforma' ? 'PROFORMA' : 'INVOICE'}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${(STATUS_CFG[sel.status.toLowerCase()] ?? STATUS_CFG.pending).cls}`}>
                    {(STATUS_CFG[sel.status.toLowerCase()] ?? STATUS_CFG.pending).label}
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium border ${sel.shipment_id ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : sel.sales_order_id ? 'bg-violet-500/10 text-violet-400 border-violet-500/20' : 'bg-gray-700/30 text-gray-500 border-gray-700'}`}>
                    {getSource(sel)}
                  </span>
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

                {/* Import notice */}
                {sel.notes && sel.notes.includes('Imported from shipment') && (
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
                    <p className="text-amber-400 text-xs font-medium">⚠ Imported from shipment record — verify amount and mark payment status when received.</p>
                  </div>
                )}

                {/* Customer & Shipment */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Customer & Reference</p>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      ['Customer', getCustomerName(sel)],
                      ['PO Number', sel.po_number ?? '—'],
                      ['Invoice Date', fmtD(sel.invoice_date)],
                      ['Due Date', fmtD(sel.due_date)],
                      ['Payment Terms', sel.payment_terms ?? '—'],
                      ['Source', getSource(sel)],
                    ].map(([label, value]) => (
                      <div key={label} className="bg-gray-800/50 rounded-lg px-3 py-2.5">
                        <p className="text-xs text-gray-500">{label}</p>
                        <p className="text-sm text-white mt-0.5">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Financials */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Financials</p>
                  <div className="bg-gray-800/30 rounded-xl overflow-hidden">
                    {[
                      ['Invoice Amount', fmt$(sel.total_amount ?? sel.amount ?? 0), true],
                      ['Amount Paid', fmt$(sel.amount_paid ?? 0), false],
                      ['Balance Due', fmt$(sel.balance_due ?? 0), true],
                    ].map(([label, value, bold], i, arr) => (
                      <div key={label as string} className={`flex justify-between px-4 py-3 ${i < arr.length - 1 ? 'border-b border-gray-700/50' : ''}`}>
                        <span className={`text-sm ${bold ? 'text-white font-semibold' : 'text-gray-400'}`}>{label}</span>
                        <span className={`text-sm font-medium ${label === 'Balance Due' ? ((sel.balance_due ?? 0) > 0 ? 'text-red-400' : 'text-emerald-400') : label === 'Amount Paid' ? 'text-emerald-400' : 'text-white'}`}>{value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Actions</p>
                  <div className="flex flex-wrap gap-2">
                    {sel.status !== 'paid' && sel.status !== 'void' && (
                      <button onClick={() => { setShowPayFull(v => !v); setShowPartial(false); setShowUpdateAmt(false) }}
                        className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
                        Mark as Fully Paid
                      </button>
                    )}
                    {sel.status !== 'paid' && sel.status !== 'void' && (
                      <button onClick={() => { setShowPartial(v => !v); setShowPayFull(false); setShowUpdateAmt(false) }}
                        className="flex items-center gap-1.5 bg-blue-700 hover:bg-blue-600 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">
                        Record Partial Payment
                      </button>
                    )}
                    {sel.status !== 'paid' && sel.status !== 'void' && (
                      <button onClick={() => { setShowUpdateAmt(v => !v); setShowPayFull(false); setShowPartial(false) }}
                        className="flex items-center gap-1.5 bg-amber-700 hover:bg-amber-600 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">
                        Update Amount
                      </button>
                    )}
                    {sel.invoice_type === 'proforma' && (
                      <button onClick={convertToInvoice} disabled={busy}
                        className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">
                        Convert to Invoice
                      </button>
                    )}
                    {['pending','partial','overdue'].includes(sel.status) && (
                      <button onClick={sendReminder} disabled={busy}
                        className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">
                        Send Reminder
                      </button>
                    )}
                    <button onClick={downloadPDF} className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                      Download PDF
                    </button>
                    {sel.status !== 'void' && sel.status !== 'paid' && (
                      <button onClick={() => setShowVoidConfirm(v => !v)} className="flex items-center gap-1.5 bg-red-900/40 hover:bg-red-800/50 text-red-400 text-xs font-medium px-3 py-2 rounded-lg transition-colors border border-red-800/50">
                        Void Invoice
                      </button>
                    )}
                  </div>

                  {/* Mark as Fully Paid form */}
                  {showPayFull && (
                    <div className="mt-3 bg-emerald-950/30 border border-emerald-800/40 rounded-xl p-4 space-y-3">
                      <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Record Full Payment</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Payment Date</label>
                          <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className={inpSm}/>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Payment Method</label>
                          <select value={payMethod} onChange={e => setPayMethod(e.target.value)} className={selSm}>
                            {PAY_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Reference # (check/ACH)</label>
                          <input value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="e.g. 1042" className={inpSm}/>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Notes</label>
                          <input value={payNotes} onChange={e => setPayNotes(e.target.value)} placeholder="Optional note" className={inpSm}/>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => setShowPayFull(false)} className="flex-1 text-xs px-3 py-2 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors">Cancel</button>
                        <button onClick={markPaid} disabled={busy} className="flex-1 text-xs px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium transition-colors">
                          {busy ? 'Saving…' : `Confirm — ${fmt$(sel.total_amount ?? sel.amount ?? 0)} Paid`}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Partial payment form */}
                  {showPartial && (
                    <div className="mt-3 bg-blue-950/30 border border-blue-800/40 rounded-xl p-4 space-y-3">
                      <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider">Record Partial Payment</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Amount Received</label>
                          <input type="number" placeholder="0.00" value={partialAmt} onChange={e => setPartialAmt(e.target.value)} className={inpSm}/>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Payment Date</label>
                          <input type="date" value={partialDate} onChange={e => setPartialDate(e.target.value)} className={inpSm}/>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Method</label>
                          <select value={partialMethod} onChange={e => setPartialMethod(e.target.value)} className={selSm}>
                            {PAY_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Reference #</label>
                          <input value={partialRef} onChange={e => setPartialRef(e.target.value)} placeholder="Optional" className={inpSm}/>
                        </div>
                      </div>
                      {partialAmt && !isNaN(parseFloat(partialAmt)) && (
                        <div className="text-xs text-gray-400">
                          Remaining after payment: <span className="text-amber-400 font-medium">{fmt$(Math.max(0, (sel.total_amount ?? 0) - (sel.amount_paid ?? 0) - parseFloat(partialAmt)))}</span>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button onClick={() => setShowPartial(false)} className="flex-1 text-xs px-3 py-2 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors">Cancel</button>
                        <button onClick={recordPartial} disabled={busy || !partialAmt} className="flex-1 text-xs px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium transition-colors">
                          {busy ? 'Saving…' : 'Record Payment'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Update Amount form */}
                  {showUpdateAmt && (
                    <div className="mt-3 bg-amber-950/30 border border-amber-800/40 rounded-xl p-4 space-y-3">
                      <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Update Invoice Amount</p>
                      <p className="text-xs text-gray-500">Use this to correct the invoice amount if the ship cost was wrong.</p>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">New Amount ($)</label>
                        <input type="number" min="0" step="0.01" value={updateAmt} onChange={e => setUpdateAmt(e.target.value)} className={inpSm}/>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => setShowUpdateAmt(false)} className="flex-1 text-xs px-3 py-2 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors">Cancel</button>
                        <button onClick={updateAmount} disabled={updatingAmt || !updateAmt} className="flex-1 text-xs px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-medium transition-colors">
                          {updatingAmt ? 'Saving…' : 'Update Amount'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Void confirm */}
                  {showVoidConfirm && (
                    <div className="mt-3 bg-red-950/30 border border-red-800/40 rounded-xl p-3 flex gap-3 items-center">
                      <p className="text-red-300 text-sm flex-1">Void this invoice? This cannot be undone.</p>
                      <button onClick={() => setShowVoidConfirm(false)} className="text-xs text-gray-400 hover:text-white transition-colors">Cancel</button>
                      <button onClick={voidInvoice} disabled={busy} className="bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">
                        {busy ? 'Voiding…' : 'Confirm Void'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Line items */}
                {lineItems.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Line Items</p>
                    <div className="rounded-xl border border-gray-700 overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-gray-800 border-b border-gray-700">
                            {['SKU','Description','Qty','Unit Price','Total'].map(h => (
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
                              <td className="px-3 py-2 text-gray-400 text-right">{fmt$(l.unit_price)}</td>
                              <td className="px-3 py-2 text-white font-medium text-right">{fmt$(l.line_total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

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
