'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import TagInput, { TagInputHandle } from '@/components/TagInput'
import ImportExportBar from '@/components/ImportExportBar'
import FileUpload from '@/components/FileUpload'
import CommentSection from '@/components/CommentSection'

type PaymentTerms = 'Net 15' | 'Net 30' | 'Net 45' | 'COD'

interface Customer {
  id: string
  company_name: string
  contact_name: string | null
  email: string | null
  phone: string | null
  billing_address: string | null
  shipping_address: string | null
  payment_terms: PaymentTerms | null
  notes: string | null
  is_active: boolean
  created_at: string
}

const PAYMENT_TERMS: PaymentTerms[] = ['Net 15', 'Net 30', 'Net 45', 'COD']

const emptyForm = {
  company_name: '',
  contact_name: '',
  email: '',
  phone: '',
  billing_address: '',
  shipping_address: '',
  payment_terms: 'Net 30' as PaymentTerms,
  notes: '',
}

type FormState = typeof emptyForm

function supabaseError(error: { code?: string; message: string; details?: string; hint?: string }) {
  const parts = [error.message]
  if (error.code) parts.push(`(code: ${error.code})`)
  if (error.details) parts.push(error.details)
  if (error.hint) parts.push(`Hint: ${error.hint}`)
  console.error('[Supabase error]', error)
  return parts.join(' — ')
}

export default function CustomersPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])

  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  // Panel state
  const [panelOpen, setPanelOpen] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [formError, setFormError] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const tagRef = useRef<TagInputHandle>(null)

  // ── Fetch ──────────────────────────────────────────────────
  async function fetchCustomers() {
    setLoading(true)
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .order('company_name', { ascending: true })

    if (error) {
      console.error('[fetchCustomers]', error)
    } else if (data) {
      setCustomers(data as Customer[])
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchCustomers()
    supabase.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email) })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Filtering ─────────────────────────────────────────────
  const filtered = customers.filter((c) => {
    if (!showArchived && !c.is_active) return false
    if (showArchived && c.is_active) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (
      c.company_name.toLowerCase().includes(q) ||
      (c.contact_name ?? '').toLowerCase().includes(q) ||
      (c.email ?? '').toLowerCase().includes(q) ||
      (c.phone ?? '').toLowerCase().includes(q)
    )
  })

  // ── Panel helpers ──────────────────────────────────────────
  function openAdd() {
    setEditing(null)
    setForm(emptyForm)
    setFormError('')
    setPanelOpen(true)
  }

  function openEdit(customer: Customer) {
    setEditing(customer)
    setForm({
      company_name: customer.company_name,
      contact_name: customer.contact_name ?? '',
      email: customer.email ?? '',
      phone: customer.phone ?? '',
      billing_address: customer.billing_address ?? '',
      shipping_address: customer.shipping_address ?? '',
      payment_terms: customer.payment_terms ?? 'Net 30',
      notes: customer.notes ?? '',
    })
    setFormError('')
    setPanelOpen(true)
  }

  function closePanel() {
    setPanelOpen(false)
    setTimeout(() => { setEditing(null); setForm(emptyForm) }, 300)
  }


  // ── Save ──────────────────────────────────────────────────
  async function handleSave() {
    if (!form.company_name.trim()) {
      setFormError('Company Name is required.')
      return
    }
    setFormError('')
    setSaving(true)

    const payload = {
      company_name: form.company_name.trim(),
      contact_name: form.contact_name.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      billing_address: form.billing_address.trim() || null,
      shipping_address: form.shipping_address.trim() || null,
      payment_terms: form.payment_terms,
      notes: form.notes.trim() || null,
    }

    if (editing) {
      const { error } = await supabase
        .from('customers')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', editing.id)
      if (error) { setFormError(supabaseError(error)); setSaving(false); return }
    } else {
      const { error } = await supabase.from('customers').insert({ ...payload, is_active: true })
      if (error) { setFormError(supabaseError(error)); setSaving(false); return }
    }

    setSaving(false)
    await tagRef.current?.sendNotifications()
    closePanel()
    fetchCustomers()
  }

  // ── Archive ───────────────────────────────────────────────
  async function handleArchive() {
    if (!editing) return
    setArchiving(true)
    await supabase
      .from('customers')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', editing.id)
    setArchiving(false)
    closePanel()
    fetchCustomers()
  }

  // ── Restore ───────────────────────────────────────────────
  async function handleRestore() {
    if (!editing) return
    setArchiving(true)
    await supabase
      .from('customers')
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq('id', editing.id)
    setArchiving(false)
    closePanel()
    fetchCustomers()
  }

  // ── Field helper ──────────────────────────────────────────
  function field(key: keyof FormState, label: string, opts?: {
    type?: string
    required?: boolean
    textarea?: boolean
    dropdown?: boolean
  }) {
    const isTextarea = opts?.textarea
    const isDropdown = opts?.dropdown
    const baseClass =
      'w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition'

    return (
      <div>
        <label className="block text-xs text-gray-400 mb-1.5">
          {label}{opts?.required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
        {isDropdown ? (
          <select
            value={form[key]}
            onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value as PaymentTerms }))}
            className={baseClass + ' cursor-pointer'}
          >
            {PAYMENT_TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        ) : isTextarea ? (
          <textarea
            rows={3}
            value={form[key]}
            onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            className={baseClass + ' resize-none'}
          />
        ) : (
          <input
            type={opts?.type ?? 'text'}
            value={form[key]}
            onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            className={baseClass}
          />
        )}
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-8 min-h-screen">
      {/* Page header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-blue-500/20 text-blue-300 border-blue-500/30">
              SALES
            </span>
          </div>
          <h1 className="text-2xl font-semibold text-white">Customers</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {loading ? 'Loading…' : `${filtered.length} ${showArchived ? 'archived' : 'active'} customer${filtered.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ImportExportBar
            table="customers"
            filename="customers"
            columns={[
              { header: 'Company Name', dbKey: 'company_name', example: 'Acme Corp', required: true },
              { header: 'Contact Name', dbKey: 'contact_name', example: 'Jane Smith' },
              { header: 'Email', dbKey: 'email', example: 'jane@acme.com' },
              { header: 'Phone', dbKey: 'phone', example: '555-123-4567' },
              { header: 'Billing Address', dbKey: 'billing_address', example: '123 Main St, Toronto ON' },
              { header: 'Shipping Address', dbKey: 'shipping_address', example: '123 Main St, Toronto ON' },
              { header: 'Payment Terms', dbKey: 'payment_terms', example: 'Net 30' },
              { header: 'Notes', dbKey: 'notes', example: 'Key account' },
            ]}
            onImportDone={fetchCustomers}
          />
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Customer
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search customers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-gray-900 border border-gray-800 text-white placeholder-gray-600 rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
          />
        </div>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <div
            onClick={() => setShowArchived((v) => !v)}
            className={`w-9 h-5 rounded-full transition-colors relative ${showArchived ? 'bg-blue-600' : 'bg-gray-700'}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${showArchived ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </div>
          <span className="text-sm text-gray-400">Show Archived</span>
        </label>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <svg className="w-5 h-5 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <svg className="w-8 h-8 text-gray-700 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p className="text-gray-500 text-sm">
              {search ? 'No customers match your search.' : showArchived ? 'No archived customers.' : 'No customers yet. Add one to get started.'}
            </p>
          </div>
        ) : (
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left text-xs font-semibold text-gray-500 px-5 py-3">Company Name</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-5 py-3">Contact Name</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-5 py-3">Email</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-5 py-3">Phone</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-5 py-3">Payment Terms</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => (
                <tr
                  key={c.id}
                  onClick={() => openEdit(c)}
                  className={`border-b border-gray-800/60 last:border-0 cursor-pointer hover:bg-gray-800/40 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-800/10'}`}
                >
                  <td className="px-5 py-3.5 text-white font-medium">{c.company_name}</td>
                  <td className="px-5 py-3.5 text-gray-400">{c.contact_name || <span className="text-gray-700">—</span>}</td>
                  <td className="px-5 py-3.5 text-gray-400">{c.email || <span className="text-gray-700">—</span>}</td>
                  <td className="px-5 py-3.5 text-gray-400">{c.phone || <span className="text-gray-700">—</span>}</td>
                  <td className="px-5 py-3.5">
                    {c.payment_terms ? (
                      <span className="text-xs px-2 py-1 rounded-md bg-gray-800 text-gray-300 border border-gray-700">
                        {c.payment_terms}
                      </span>
                    ) : <span className="text-gray-700">—</span>}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                      c.is_active
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                        : 'bg-gray-700/40 text-gray-500 border border-gray-700'
                    }`}>
                      {c.is_active ? 'Active' : 'Archived'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Slide-out panel overlay */}
      <div
        onClick={closePanel}
        className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${panelOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      />

      {/* Slide-out panel */}
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        className={`fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-full w-full md:max-w-md bg-gray-900 border-l border-gray-800 z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${panelOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Panel header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-800 shrink-0">
          <h2 className="text-white font-semibold">
            {editing ? 'Edit Customer' : 'Add Customer'}
          </h2>
          <button
            onClick={closePanel}
            className="text-gray-500 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-800"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Panel body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {field('company_name', 'Company Name', { required: true })}
          {field('contact_name', 'Contact Name')}
          {field('email', 'Email', { type: 'email' })}
          {field('phone', 'Phone', { type: 'tel' })}
          {field('billing_address', 'Billing Address', { textarea: true })}
          {field('shipping_address', 'Shipping Address', { textarea: true })}
          {field('payment_terms', 'Payment Terms', { dropdown: true })}
          <TagInput ref={tagRef} value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} page="Customers" className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition resize-none" />
          {editing && (<>
            <div className="border-t border-gray-800 pt-4"><FileUpload supabase={supabase} recordType="customers" recordId={editing.id} currentUserEmail={userEmail}/></div>
            <div className="border-t border-gray-800 pt-4"><CommentSection recordType="customers" recordId={editing.id} currentUserEmail={userEmail}/></div>
          </>)}
        </div>

        {/* Panel footer */}
        <div className="shrink-0 px-6 py-4 border-t border-gray-800 space-y-3">
          {formError && (
            <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5">
              <svg className="w-4 h-4 text-red-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-red-400 text-xs">{formError}</p>
            </div>
          )}

          <div className="flex items-center gap-3">
            {editing && (
              <button
                onClick={editing.is_active ? handleArchive : handleRestore}
                disabled={archiving}
                className="flex items-center gap-1.5 text-sm px-3 py-2.5 rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-gray-400 border-gray-700 hover:text-white hover:border-gray-600"
              >
                {archiving ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : editing.is_active ? (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8l1 12a2 2 0 002 2h8a2 2 0 002-2L19 8m-9 4v6m4-6v6" />
                    </svg>
                    Archive
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    Restore
                  </>
                )}
              </button>
            )}

            <button
              onClick={closePanel}
              className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
            >
              Cancel
            </button>

            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
            >
              {saving ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Saving…
                </>
              ) : 'Save Customer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
