'use client'
import ShareLink from '@/components/ShareLink'
import { useItemDeepLink } from '@/components/useItemDeepLink'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import FileUpload from '@/components/FileUpload'
import Comments from '@/components/Comments'
import { generateInvoicePDF } from '@/lib/generateInvoice'
import { downloadFile, getFileUrl } from '@/lib/fileHelpers'
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
  commission_status: string | null
  ship_to_address: string | null
  bill_to_address: string | null
  reminder_count: number
  notes: string | null
  is_active: boolean
  customer_name?: string | null
  customers?: { company_name: string } | null
  sales_orders?: { order_number: string } | null
}
interface Customer { id: string; company_name: string }

const STATUS_CFG: Record<string,{label:string;cls:string;pulse?:boolean}> = {
  proforma: { label:'PROFORMA', cls:'bg-[#F5F6FA]/50 text-gray-500 border-gray-600' },
  pending:  { label:'PENDING INVOICE SUBMISSION', cls:'bg-amber-500/15 text-amber-600 border-amber-500/25' },
  unpaid:   { label:'PENDING INVOICE SUBMISSION', cls:'bg-amber-500/15 text-amber-600 border-amber-500/25' },
  'pending invoice submission': { label:'PENDING INVOICE SUBMISSION', cls:'bg-amber-500/15 text-amber-600 border-amber-500/25' },
  'invoice sent to customer': { label:'SENT TO CUSTOMER', cls:'bg-blue-500/15 text-blue-600 border-blue-500/20' },
  partial:  { label:'PARTIAL',  cls:'bg-blue-500/15 text-blue-500 border-blue-500/20' },
  overdue:  { label:'OVERDUE',  cls:'bg-red-600/20 text-red-600 border-red-600/30', pulse: true },
  paid:     { label:'PAYMENT RECEIVED', cls:'bg-emerald-500/15 text-emerald-600 border-emerald-500/20' },
  'payment received': { label:'PAYMENT RECEIVED', cls:'bg-emerald-500/15 text-emerald-600 border-emerald-500/20' },
  void:     { label:'VOID',     cls:'bg-[#F3F4F6] text-gray-500 border-[#E4E6EE]' },
}
const INVOICE_STATUS_OPTIONS = ['Pending Invoice Submission', 'Invoice Sent to Customer', 'Payment Received']
const COMMISSION_STATUS_OPTIONS = ['Pending Customer Payment', 'Commission Paid']
const PAID_STATUSES = ['paid', 'payment received']
const isPaidStatus = (s?: string | null) => PAID_STATUSES.includes((s || '').toLowerCase())
// "Open" = not paid, not void, not proforma (i.e. still owed / in progress)
const isOpenStatus = (s?: string | null) => { const x = (s || '').toLowerCase(); return x !== 'void' && x !== 'proforma' && !isPaidStatus(x) }

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

  // Deep-link: open the item referenced by ?item=<id> in the URL (used by @mention notifications).
  const deepLinkOpenedRef = useRef<string | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const openId = new URLSearchParams(window.location.search).get('item')
    if (!openId || deepLinkOpenedRef.current === openId) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const target = (rows as any[]).find((x) => x && x.id === openId)
    if (target) { deepLinkOpenedRef.current = openId; openPanel(target) }
  }, [rows]) // eslint-disable-line react-hooks/exhaustive-deps
  useItemDeepLink(rows, openPanel)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')
  const [sel, setSel] = useState<Invoice|null>(null)
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [shipInfo, setShipInfo] = useState<{ carrier?: string | null; tracking_number?: string | null } | null>(null)
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

  // Editable billing details (invoice #, status, commission, addresses)
  const [editInvNum, setEditInvNum] = useState('')
  const [editStatus, setEditStatus] = useState('Pending Invoice Submission')
  const [editCommission, setEditCommission] = useState('Pending Customer Payment')
  const [editShipTo, setEditShipTo] = useState('')
  const [editBillTo, setEditBillTo] = useState('')
  const [savingBilling, setSavingBilling] = useState(false)
  const [billingSaved, setBillingSaved] = useState(false)

  async function saveBilling() {
    if (!sel) return
    setSavingBilling(true)
    const patch = {
      invoice_number_display: editInvNum.trim() || 'Invoice Number Pending',
      status: editStatus,
      commission_status: editCommission,
      ship_to_address: editShipTo.trim() || null,
      bill_to_address: editBillTo.trim() || null,
      updated_at: new Date().toISOString(),
    }
    await sb.from('invoices').update(patch).eq('id', sel.id)
    setSel(s => s ? { ...s, ...patch } as Invoice : s)
    setSavingBilling(false); setBillingSaved(true); setTimeout(() => setBillingSaved(false), 2500)
    load()
  }

  const panelRef = useRef<HTMLDivElement>(null)
  // Documents connected to the source order / shipment (shown on the bill)
  const [connectedDocs, setConnectedDocs] = useState<any[]>([])
  const [srcThread, setSrcThread] = useState<{ type: string; id: string } | null>(null)
  const [shipDocs, setShipDocs] = useState<{ packing_slip_url: string | null; pod_file_url: string | null; bol_number: string | null } | null>(null)

  async function openDoc(storage_path: string) {
    const url = await getFileUrl(sb, storage_path)
    if (url) window.open(url, '_blank')
    else alert('Could not open document — file not found in storage.')
  }
  async function downloadDoc(storage_path: string, file_name: string) {
    await downloadFile(sb, storage_path, file_name)
  }
  // Packing slip / POD are saved as public-style URLs, but the 'erp-files' bucket is
  // private — those links are dead. Pull the object path out and open a fresh signed URL.
  async function openStoredUrl(u: string | null) {
    if (!u) return
    const m = u.match(/\/erp-files\/([^?]+)/)
    if (m && m[1]) { await openDoc(decodeURIComponent(m[1])); return }
    if (u.startsWith('http')) { window.open(u, '_blank'); return }
    await openDoc(u)
  }

  async function load() {
    setLoading(true)
    const [{ data: inv }, { data: c }] = await Promise.all([
      sb.from('invoices')
        .select('*,customers(company_name),sales_orders!invoices_sales_order_id_fkey(order_number)')
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
    // Fire any pending finance emails for shipment-derived bills (idempotent).
    fetch('/api/invoices/notify-unsent', { method: 'POST' }).catch(() => {})
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
    setEditInvNum(inv.invoice_number_display && inv.invoice_number_display !== 'Invoice Number Pending' ? inv.invoice_number_display : '')
    setEditStatus(INVOICE_STATUS_OPTIONS.includes(inv.status) ? inv.status : (inv.status?.toLowerCase() === 'paid' ? 'Payment Received' : 'Pending Invoice Submission'))
    setEditCommission(inv.commission_status ?? 'Pending Customer Payment')
    setEditShipTo(inv.ship_to_address ?? '')
    setEditBillTo(inv.bill_to_address ?? '')
    setBillingSaved(false)
    setOpen(true)
    const { data } = await sb.from('invoice_line_items').select('*').eq('invoice_id', inv.id).order('id')
    setLineItems((data ?? []) as LineItem[])
    // Load documents connected to the source order + shipment
    setConnectedDocs([]); setShipDocs(null); setShipInfo(null); setSrcThread(null)
    // Resolve the originating order thread (Walmart/Chewy board order, else the sales order) so the
    // invoice shows the same SKUs, documents and team comments as the source order.
    let src: { type: string; id: string } | null = null
    if (inv.shipment_id) {
      const { data: wmo } = await sb.from('walmart_board_orders').select('id').eq('shipment_id', inv.shipment_id).maybeSingle()
      if (wmo) src = { type: 'walmart_order', id: (wmo as any).id }
      if (!src) { const { data: cho } = await sb.from('chewy_board_orders').select('id').eq('shipment_id', inv.shipment_id).maybeSingle(); if (cho) src = { type: 'chewy_order', id: (cho as any).id } }
    }
    if (!src && inv.sales_order_id) src = { type: 'sales_order', id: inv.sales_order_id }
    setSrcThread(src)
    const linkedIds = [inv.id, inv.sales_order_id, inv.shipment_id, src?.id].filter(Boolean) as string[]
    if (linkedIds.length) {
      const { data: fa } = await sb.from('file_attachments')
        .select('id,file_name,file_type,storage_path,record_type,created_at')
        .in('record_id', linkedIds).order('created_at', { ascending: true })
      const seen = new Set<string>()
      const deduped = ((fa ?? []) as any[]).filter(d => { const k = d.storage_path || d.id; if (seen.has(k)) return false; seen.add(k); return true })
      setConnectedDocs(deduped)
    }
    if (inv.shipment_id) {
      const { data: sh } = await sb.from('shipments').select('packing_slip_url,pod_file_url,bol_number,carrier,tracking_number').eq('id', inv.shipment_id).maybeSingle()
      setShipDocs((sh as any) ?? null)
      if (sh) setShipInfo({ carrier: (sh as any).carrier, tracking_number: (sh as any).tracking_number })
    } else if (inv.sales_order_id) {
      const { data: so } = await sb.from('sales_orders').select('carrier,tracking_number').eq('id', inv.sales_order_id).maybeSingle()
      if (so) setShipInfo({ carrier: (so as any).carrier, tracking_number: (so as any).tracking_number })
    }
  }

  function close() {
    setOpen(false)
    setTimeout(() => { setSel(null); setLineItems([]) }, 300)
  }

  const cmap = Object.fromEntries(customers.map(c => [c.id, c.company_name]))

  function getCustomerName(inv: Invoice) {
    return (inv.customers as any)?.company_name ?? (inv.customer_id ? cmap[inv.customer_id] : null) ?? (inv.customer_name || null) ?? '—'
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
    const overdue = !isPaidStatus(status) && status !== 'void' && !!r.due_date && r.due_date < todayStr()
    if (tab === 'unpaid' && !isOpenStatus(r.status)) return false
    if (tab === 'paid' && !isPaidStatus(r.status)) return false
    if (tab === 'overdue' && !overdue) return false
    if (tab === 'proforma' && !(status === 'proforma' || r.invoice_type === 'proforma')) return false
    if (!search) return true
    const q = search.toLowerCase()
    return displayNum(r).toLowerCase().includes(q) ||
      getCustomerName(r).toLowerCase().includes(q) ||
      (r.po_number ?? '').toLowerCase().includes(q)
  })

  // Stats
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10)

  const outstanding = rows.filter(r => isOpenStatus(r.status))
  const outstandingAmt = outstanding.reduce((s, r) => s + (r.balance_due ?? 0), 0)
  const overdueRows = rows.filter(r => !isPaidStatus(r.status) && r.status.toLowerCase() !== 'void' && r.due_date && r.due_date < todayStr())
  const overdueAmt = overdueRows.reduce((s, r) => s + (r.balance_due ?? 0), 0)
  const paidMonth = rows.filter(r => isPaidStatus(r.status) && (r.invoice_date ?? '') >= monthStart)
  const paidMonthAmt = paidMonth.reduce((s, r) => s + (r.total_amount ?? r.amount ?? 0), 0)
  const totalInvoiced = rows.reduce((s, r) => s + (r.total_amount ?? r.amount ?? 0), 0)

  const tabCounts: Record<Tab, number> = {
    all: rows.length,
    unpaid: rows.filter(r => isOpenStatus(r.status)).length,
    overdue: overdueRows.length,
    paid: rows.filter(r => isPaidStatus(r.status)).length,
    proforma: rows.filter(r => r.status === 'proforma' || r.invoice_type === 'proforma').length,
  }

  // Actions
  async function markPaid() {
    if (!sel) return
    setBusy(true)
    const total = sel.total_amount ?? sel.amount ?? 0
    await sb.from('invoices').update({
      status: 'Payment Received', amount_paid: total, balance_due: 0,
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
    const newStatus = newBalance <= 0 ? 'Payment Received' : 'partial'
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
    const newStatus = newBalance <= 0 ? 'Payment Received' : (isPaidStatus(sel.status) ? 'Pending Invoice Submission' : sel.status)
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

  const inp = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition'
  const inpSm = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 transition'
  const selSm = inpSm + ' cursor-pointer'

  return (
    <div className="min-h-screen mon-page">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <span className="mon-tag t-teal">🧾 Billing</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">Invoices & Billing</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${rows.length} invoice${rows.length !== 1 ? 's' : ''}`}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button onClick={importShipments} disabled={importing}
            className="flex items-center gap-2 bg-[#F9FAFB] hover:bg-[#F5F6FA] disabled:opacity-50 border border-[#E4E6EE] text-gray-500 hover:text-[#1A1D2E] text-xs font-medium px-3 py-2 rounded-lg transition-colors">
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
          <div className="bg-white border border-red-900/40 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">Total Outstanding</p>
            <p className="text-lg font-bold text-red-400">{fmt$(outstandingAmt)}</p>
            <p className="text-xs text-gray-600 mt-0.5">{outstanding.length} unpaid invoice{outstanding.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="bg-white border border-red-900/60 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">Overdue</p>
            <p className="text-lg font-bold text-red-500">{fmt$(overdueAmt)}</p>
            <p className="text-xs text-gray-600 mt-0.5">{overdueRows.length} overdue</p>
          </div>
          <div className="bg-white border border-emerald-900/30 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">Paid This Month</p>
            <p className="text-lg font-bold text-emerald-400">{fmt$(paidMonthAmt)}</p>
            <p className="text-xs text-gray-600 mt-0.5">{paidMonth.length} paid</p>
          </div>
          <div className="bg-white border border-blue-900/30 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">Total Invoiced</p>
            <p className="text-lg font-bold text-blue-400">{fmt$(totalInvoiced)}</p>
            <p className="text-xs text-gray-600 mt-0.5">{rows.length} invoices</p>
          </div>
        </div>
      )}

      {/* Tabs + Search */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex gap-1 bg-[#F0F2F7] rounded-lg p-1 overflow-x-auto">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${tab === t ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-700'}`}>
              {t === 'unpaid' ? 'Pending' : t.charAt(0).toUpperCase() + t.slice(1)}{tabCounts[t] > 0 ? ` (${tabCounts[t]})` : ''}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-sm ml-auto">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          <input placeholder="Search customer, invoice #, PO #…" value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"/>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-x-auto" style={{border:"1px solid #E4E6EE",background:"#FFFFFF"}}>
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
              <tr className="border-b border-[#E4E6EE]">
                <th className="w-10 px-4 py-3"><input type="checkbox" checked={ms.isAllSelected(filtered)} onChange={()=>ms.toggleAll(filtered)} className="accent-emerald-500 w-4 h-4 cursor-pointer"/></th>
                {['Invoice #','Customer','PO #','Invoice Date','Due Date','Amount','Status','Days Overdue','Source','Actions'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const status = r.status.toLowerCase()
                const isOverdue = !isPaidStatus(status) && status !== 'void' && !!r.due_date && r.due_date < todayStr()
                const cfg = STATUS_CFG[status] ?? STATUS_CFG.pending
                const days = isOverdue ? daysOverdue(r.due_date) : 0
                return (
                  <tr key={r.id}
                    className={`border-b border-[#F3F4F6] last:border-0 hover:bg-[#F9FAFB] transition-colors ${ms.isSelected(r.id) ? 'bg-blue-500/5' : isOverdue ? 'bg-red-950/10' : isOpenStatus(r.status) ? 'bg-amber-500/5' : i % 2 === 1 ? 'bg-[#FAFAFA]' : ''}`}>
                    <td className="px-4 py-3.5" onClick={e=>e.stopPropagation()}><input type="checkbox" checked={ms.isSelected(r.id)} onChange={()=>ms.toggle(r.id)} className="accent-emerald-500 w-4 h-4 cursor-pointer"/></td>
                    <td className="px-4 py-3.5 text-[#1A1D2E] font-mono text-xs font-medium cursor-pointer" onClick={() => openPanel(r)}>{displayNum(r)}</td>
                    <td className="px-4 py-3.5 text-gray-500" onClick={() => openPanel(r)}>{getCustomerName(r)}</td>
                    <td className="px-4 py-3.5 text-gray-400 font-mono text-xs" onClick={() => openPanel(r)}>{r.po_number ?? '—'}</td>
                    <td className="px-4 py-3.5 text-gray-400 whitespace-nowrap" onClick={() => openPanel(r)}>{fmtD(r.invoice_date)}</td>
                    <td className={`px-4 py-3.5 whitespace-nowrap font-medium ${isOverdue ? 'text-red-400' : 'text-gray-400'}`} onClick={() => openPanel(r)}>{fmtD(r.due_date)}</td>
                    <td className="px-4 py-3.5 text-gray-500 font-medium" onClick={() => openPanel(r)}>{fmt$(r.total_amount ?? r.amount ?? 0)}</td>
                    <td className="px-4 py-3.5" onClick={() => openPanel(r)}>
                      <span className={`text-xs px-2 py-1 rounded-full font-semibold border ${cfg.cls} ${cfg.pulse ? 'animate-pulse' : ''}`}>{cfg.label}</span>
                    </td>
                    <td className="px-4 py-3.5" onClick={() => openPanel(r)}>
                      {days > 0 ? <span className="text-xs text-red-400 font-medium">{days}d</span> : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-3.5" onClick={() => openPanel(r)}>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium border ${r.shipment_id ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : r.sales_order_id ? 'bg-violet-500/10 text-violet-400 border-violet-500/20' : 'bg-[#F3F4F6] text-gray-500 border-[#E4E6EE]'}`}>
                        {getSource(r)}
                      </span>
                    </td>
                    <td className="px-4 py-3.5" onClick={e=>e.stopPropagation()}>
                      <div className="flex items-center gap-1.5">
                        {!isPaidStatus(status) && status !== 'void' && (
                          <button onClick={e => { e.stopPropagation(); openPanel(r); setTimeout(() => setShowPayFull(true), 200) }}
                            className="text-xs px-2 py-1 rounded bg-emerald-700/50 hover:bg-emerald-700 text-emerald-300 transition-colors whitespace-nowrap">
                            Mark Paid
                          </button>
                        )}
                        <WorkflowMover recordId={r.id} recordType="invoice" currentStatus={r.status} onMoved={load}/>
                        <button onClick={e => { e.stopPropagation(); openPanel(r) }}
                          className="text-xs px-2 py-1 rounded bg-[#F5F6FA]/50 hover:bg-[#F5F6FA] text-gray-500 transition-colors">
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
      <div className={`fixed inset-0 z-40 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} style={{ background:'rgba(26,32,53,0.48)', backdropFilter:'blur(3px)' }} />

      {/* Centered pop-up */}
      <div ref={panelRef} onClick={e => e.stopPropagation()}
        className={`fixed left-1/2 top-6 -translate-x-1/2 w-[calc(100%-2rem)] max-w-[720px] z-50 flex flex-col shadow-2xl rounded-2xl overflow-hidden transition-all duration-200 ${open ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}
        style={{ background: '#FFFFFF', maxHeight: 'calc(100vh - 48px)' }}>
        {sel && (
          <>
            {/* Panel header */}
            <div className="flex items-start justify-between px-6 py-5 border-b border-[#E4E6EE] shrink-0">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium border ${sel.invoice_type === 'proforma' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' : 'bg-blue-500/10 text-blue-400 border-blue-500/20'}`}>
                    {sel.invoice_type === 'proforma' ? 'PROFORMA' : 'INVOICE'}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${(STATUS_CFG[sel.status.toLowerCase()] ?? STATUS_CFG.pending).cls}`}>
                    {(STATUS_CFG[sel.status.toLowerCase()] ?? STATUS_CFG.pending).label}
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium border ${sel.shipment_id ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : sel.sales_order_id ? 'bg-violet-500/10 text-violet-400 border-violet-500/20' : 'bg-[#F3F4F6] text-gray-500 border-[#E4E6EE]'}`}>
                    {getSource(sel)}
                  </span>
                </div>
                <h2 className="text-[#1A1D2E] font-semibold text-lg font-mono">{displayNum(sel)}</h2>
                <p className="text-gray-500 text-sm">{getCustomerName(sel)}</p>
              </div>
              {sel && <ShareLink id={sel.id} className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-[#6B7280] hover:text-[#1A1D2E] border border-[#E4E6EE] hover:border-[#D0D3E0] bg-white px-2.5 py-1.5 rounded-lg transition-colors shrink-0" />}
              <button onClick={close} className="text-gray-500 hover:text-gray-700 p-1 rounded-lg hover:bg-[#F5F6FA] transition-colors">
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
                  <p className="text-xs font-semibold uppercase tracking-wider mb-3">Customer & Reference</p>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      ['Customer', getCustomerName(sel)],
                      ['PO Number', sel.po_number ?? '—'],
                      ['Invoice Date', fmtD(sel.invoice_date)],
                      ['Due Date', fmtD(sel.due_date)],
                      ['Payment Terms', sel.payment_terms ?? '—'],
                      ['Source', getSource(sel)],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-lg bg-[#F9FAFB] px-3 py-2.5">
                        <p className="text-xs text-gray-500">{label}</p>
                        <p className="text-sm text-[#1A1D2E] mt-0.5">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Shipping & Tracking — carrier + tracking for finance to relay to the customer */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-3">Shipping &amp; Tracking</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg bg-[#F9FAFB] px-3 py-2.5">
                     <p className="text-xs text-gray-500">Carrier</p>
                      <p className="text-sm text-[#1A1D2E] mt-0.5">{shipInfo?.carrier || '—'}</p>
                    </div>
                    <div className="rounded-lg bg-[#F9FAFB] px-3 py-2.5">
                      <p className="text-xs text-gray-500">Tracking #</p>
                       {shipInfo?.tracking_number
                        ? <div className="flex items-center gap-2 mt-0.5"><p className="text-sm font-mono text-[#1A1D2E] break-all">{shipInfo.tracking_number}</p><button type="button" onClick={() => { try { navigator.clipboard?.writeText(shipInfo!.tracking_number!) } catch { /* ignore */ } }} className="text-[11px] text-[#3B6FE0] hover:underline shrink-0">Copy</button></div>
                        : <p className="text-sm text-[#1A1D2E] mt-0.5">—</p>}
                    </div>
                  </div>
                </div>

                {/* Billing details — editable */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-semibold uppercase tracking-wider">Billing Details</p>
                    <button onClick={saveBilling} disabled={savingBilling} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#3B6FE0] hover:bg-[#2f5bc0] text-white disabled:opacity-50 transition-colors">{savingBilling ? 'Saving…' : billingSaved ? 'Saved ✓' : 'Save'}</button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Invoice # <span className="text-gray-400">(accounting)</span></label>
                      <input value={editInvNum} onChange={e => setEditInvNum(e.target.value)} placeholder="Invoice Number Pending" className={inp}/>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Status</label>
                      <select value={editStatus} onChange={e => setEditStatus(e.target.value)} className={inp}>{INVOICE_STATUS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}</select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Commission Status</label>
                      <select value={editCommission} onChange={e => setEditCommission(e.target.value)} className={inp}>{COMMISSION_STATUS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}</select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Bill To</label>
                      <textarea rows={3} value={editBillTo} onChange={e => setEditBillTo(e.target.value)} placeholder="Billing name & address" className={inp + ' resize-none'}/>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Ship To</label>
                      <textarea rows={3} value={editShipTo} onChange={e => setEditShipTo(e.target.value)} placeholder="Shipping address" className={inp + ' resize-none'}/>
                    </div>
                  </div>
                </div>

                {/* Financials */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-3">Financials</p>
                  <div className="bg-[#F9FAFB]/30 rounded-xl overflow-hidden">
                    {[
                      ['Invoice Amount', fmt$(sel.total_amount ?? sel.amount ?? 0), true],
                      ['Amount Paid', fmt$(sel.amount_paid ?? 0), false],
                      ['Balance Due', fmt$(sel.balance_due ?? 0), true],
                    ].map(([label, value, bold], i, arr) => (
                      <div key={label as string} className={`flex justify-between px-4 py-3 ${i < arr.length - 1 ? 'border-b border-[#E4E6EE]/50' : ''}`}>
                        <span className={`text-sm ${bold ? 'text-[#1A1D2E] font-semibold' : 'text-gray-400'}`}>{label}</span>
                        <span className={`text-sm font-medium ${label === 'Balance Due' ? ((sel.balance_due ?? 0) > 0 ? 'text-red-400' : 'text-emerald-400') : label === 'Amount Paid' ? 'text-emerald-400' : 'text-[#1A1D2E]'}`}>{value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-3">Actions</p>
                  <div className="flex flex-wrap gap-2">
                    {!isPaidStatus(sel.status) && sel.status.toLowerCase() !== 'void' && (
                      <button onClick={() => { setShowPayFull(v => !v); setShowPartial(false); setShowUpdateAmt(false) }}
                        className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
                        Mark as Fully Paid
                      </button>
                    )}
                    {!isPaidStatus(sel.status) && sel.status.toLowerCase() !== 'void' && (
                      <button onClick={() => { setShowPartial(v => !v); setShowPayFull(false); setShowUpdateAmt(false) }}
                        className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors">
                        Record Partial Payment
                      </button>
                    )}
                    {!isPaidStatus(sel.status) && sel.status.toLowerCase() !== 'void' && (
                      <button onClick={() => { setShowUpdateAmt(v => !v); setShowPayFull(false); setShowPartial(false) }}
                        className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors">
                        Update Amount
                      </button>
                    )}
                    {sel.invoice_type === 'proforma' && (
                      <button onClick={convertToInvoice} disabled={busy}
                        className="flex items-center gap-1.5 bg-[#F5F6FA] hover:bg-gray-600 disabled:opacity-50 text-[#1A1D2E] text-xs font-medium px-3 py-2 rounded-lg transition-colors">
                        Convert to Invoice
                      </button>
                    )}
                    {isOpenStatus(sel.status) && (
                      <button onClick={sendReminder} disabled={busy}
                        className="flex items-center gap-1.5 bg-[#F5F6FA] hover:bg-gray-600 disabled:opacity-50 text-[#1A1D2E] text-xs font-medium px-3 py-2 rounded-lg transition-colors">
                        Send Reminder
                      </button>
                    )}
                    <button onClick={downloadPDF} className="flex items-center gap-1.5 bg-[#F5F6FA] hover:bg-gray-600 text-[#1A1D2E] text-xs font-medium px-3 py-2 rounded-lg transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                      Download PDF
                    </button>
                    {!isPaidStatus(sel.status) && sel.status.toLowerCase() !== 'void' && (
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
                        <button onClick={() => setShowPayFull(false)} className="flex-1 text-xs px-3 py-2 rounded-lg border border-[#E4E6EE] text-gray-400 hover:text-gray-700 transition-colors">Cancel</button>
                        <button onClick={markPaid} disabled={busy} className="flex-1 text-xs px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold transition-colors">
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
                        <button onClick={() => setShowPartial(false)} className="flex-1 text-xs px-3 py-2 rounded-lg border border-[#E4E6EE] text-gray-400 hover:text-gray-700 transition-colors">Cancel</button>
                        <button onClick={recordPartial} disabled={busy || !partialAmt} className="flex-1 text-xs px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold transition-colors">
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
                        <button onClick={() => setShowUpdateAmt(false)} className="flex-1 text-xs px-3 py-2 rounded-lg border border-[#E4E6EE] text-gray-400 hover:text-gray-700 transition-colors">Cancel</button>
                        <button onClick={updateAmount} disabled={updatingAmt || !updateAmt} className="flex-1 text-xs px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-semibold transition-colors">
                          {updatingAmt ? 'Saving…' : 'Update Amount'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Void confirm */}
                  {showVoidConfirm && (
                    <div className="mt-3 bg-red-950/30 border border-red-800/40 rounded-xl p-3 flex gap-3 items-center">
                      <p className="text-red-300 text-sm flex-1">Void this invoice? This cannot be undone.</p>
                      <button onClick={() => setShowVoidConfirm(false)} className="text-xs text-gray-400 hover:text-gray-700 transition-colors">Cancel</button>
                      <button onClick={voidInvoice} disabled={busy} className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors">
                        {busy ? 'Voiding…' : 'Confirm Void'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Line items */}
                {lineItems.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider mb-3">Line Items</p>
                    <div className="rounded-xl border border-[#E4E6EE] overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-[#F9FAFB] border-b border-[#E4E6EE]">
                            {['SKU','Description','Qty','Unit Price','Total'].map(h => (
                              <th key={h} className="text-left text-gray-400 px-3 py-2 font-medium">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {lineItems.map((l, i) => (
                            <tr key={l.id} className={`border-b border-[#E4E6EE]/50 last:border-0 ${i % 2 === 1 ? 'bg-[#F5F6FA]/20' : ''}`}>
                              <td className="px-3 py-2 text-gray-400 font-mono">{l.sku ?? '—'}</td>
                              <td className="px-3 py-2 text-gray-500">{l.description}</td>
                              <td className="px-3 py-2 text-gray-400 text-right">{l.quantity}</td>
                              <td className="px-3 py-2 text-gray-400 text-right">{fmt$(l.unit_price)}</td>
                              <td className="px-3 py-2 text-[#1A1D2E] font-medium text-right">{fmt$(l.line_total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Connected documents — from the source order & shipment */}
                {(connectedDocs.length > 0 || shipDocs?.packing_slip_url || shipDocs?.pod_file_url || shipDocs?.bol_number) && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider mb-3">Connected Documents <span className="text-gray-300 normal-case font-normal">(from order &amp; shipment)</span></p>
                    <div className="rounded-xl border border-[#E4E6EE] divide-y divide-[#E4E6EE]/60">
                      {shipDocs?.packing_slip_url && (
                        <button onClick={() => openStoredUrl(shipDocs.packing_slip_url)} className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-[#3B6FE0] hover:bg-[#F8FAFF] text-left">📄 Packing List <span className="ml-auto text-xs text-gray-400 hover:text-[#3B6FE0]">View</span></button>
                      )}
                      {shipDocs?.pod_file_url && (
                        <button onClick={() => openStoredUrl(shipDocs.pod_file_url)} className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-[#3B6FE0] hover:bg-[#F8FAFF] text-left">📄 Proof of Delivery <span className="ml-auto text-xs text-gray-400 hover:text-[#3B6FE0]">View</span></button>
                      )}
                      {shipDocs?.bol_number && (
                        <div className="flex items-center gap-2 px-3 py-2.5 text-sm text-gray-500">🚚 BOL #: <span className="font-mono text-[#1A1D2E]">{shipDocs.bol_number}</span></div>
                      )}
                      {connectedDocs.map(d => (
                        <div key={d.id} className="flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-[#F8FAFF]">
                          <span className="text-[#3B6FE0]">📎</span>
                          <button onClick={() => openDoc(d.storage_path)} className="text-[#3B6FE0] text-left truncate" title="View">{d.file_name}</button>
                          <span className="ml-auto text-[10px] uppercase tracking-wide text-gray-400 shrink-0">{String(d.record_type || '').replace(/_/g, ' ')}</span>
                          <button onClick={() => openDoc(d.storage_path)} className="shrink-0 text-xs text-gray-500 hover:text-[#3B6FE0] px-1.5 py-0.5" title="View">View</button>
                          <button onClick={() => downloadDoc(d.storage_path, d.file_name)} className="shrink-0 text-xs text-gray-500 hover:text-[#3B6FE0] px-1.5 py-0.5" title="Download">Download</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Notes */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-3">Internal Notes</p>
                  <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add internal notes…" className={inp + ' resize-none'}/>
                  <button onClick={saveNotes} disabled={savingNotes} className="mt-2 text-xs text-gray-400 hover:text-gray-700 transition-colors disabled:opacity-50">
                    {savingNotes ? 'Saved ✓' : 'Save Notes'}
                  </button>
                </div>

                {/* Files */}
                <div className="border-t border-[#E4E6EE] pt-5">
                  <FileUpload supabase={sb} recordType="invoices" recordId={sel.id} currentUserEmail={userEmail}/>
                </div>

                {/* Comments */}
                <div className="border-t border-[#E4E6EE] pt-5 pb-6">
                  <Comments recordType={srcThread?.type ?? 'invoice'} recordId={srcThread?.id ?? sel.id} currentUserEmail={userEmail}/>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
