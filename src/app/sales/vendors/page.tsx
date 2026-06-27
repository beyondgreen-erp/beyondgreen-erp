'use client'
import ShareLink from '@/components/ShareLink'
import { useItemDeepLink } from '@/components/useItemDeepLink'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import TagInput, { TagInputHandle } from '@/components/TagInput'
import ImportExportBar from '@/components/ImportExportBar'
import FileUpload from '@/components/FileUpload'
import Comments from '@/components/Comments'

type PaymentTerms = 'Net 15' | 'Net 30' | 'Net 45' | 'COD'

interface Vendor {
  id: string
  company_name: string
  contact_name: string | null
  email: string | null
  phone: string | null
  address: string | null
  payment_terms: PaymentTerms | null
  lead_time_days: number | null
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
  address: '',
  payment_terms: 'Net 30' as PaymentTerms,
  lead_time_days: '',
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

export default function VendorsPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])

  const [vendors, setVendors] = useState<Vendor[]>([])
  useItemDeepLink(vendors, openEdit)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  const [panelOpen, setPanelOpen] = useState(false)
  const [editing, setEditing] = useState<Vendor | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [formError, setFormError] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const tagRef = useRef<TagInputHandle>(null)

  // ── Fetch ──────────────────────────────────────────────────
  async function fetchVendors() {
    setLoading(true)
    const { data, error } = await supabase
      .from('vendors')
      .select('*')
      .order('company_name', { ascending: true })

    if (error) {
      console.error('[fetchVendors]', error)
    } else if (data) {
      setVendors(data as Vendor[])
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchVendors()
    supabase.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email) })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Filtering ─────────────────────────────────────────────
  const filtered = vendors.filter((v) => {
    if (!showArchived && !v.is_active) return false
    if (showArchived && v.is_active) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (
      v.company_name.toLowerCase().includes(q) ||
      (v.contact_name ?? '').toLowerCase().includes(q) ||
      (v.email ?? '').toLowerCase().includes(q) ||
      (v.phone ?? '').toLowerCase().includes(q)
    )
  })

  // ── Panel helpers ──────────────────────────────────────────
  function openAdd() {
    setEditing(null)
    setForm(emptyForm)
    setFormError('')
    setPanelOpen(true)
  }

  function openEdit(vendor: Vendor) {
    setEditing(vendor)
    setForm({
      company_name: vendor.company_name,
      contact_name: vendor.contact_name ?? '',
      email: vendor.email ?? '',
      phone: vendor.phone ?? '',
      address: vendor.address ?? '',
      payment_terms: vendor.payment_terms ?? 'Net 30',
      lead_time_days: vendor.lead_time_days !== null ? String(vendor.lead_time_days) : '',
      notes: vendor.notes ?? '',
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

    const leadDays = form.lead_time_days !== '' ? parseInt(form.lead_time_days, 10) : null

    const payload = {
      company_name: form.company_name.trim(),
      contact_name: form.contact_name.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      payment_terms: form.payment_terms,
      lead_time_days: isNaN(leadDays as number) ? null : leadDays,
      notes: form.notes.trim() || null,
    }

    if (editing) {
      const { error } = await supabase
        .from('vendors')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', editing.id)
      if (error) { setFormError(supabaseError(error)); setSaving(false); return }
    } else {
      const { error } = await supabase.from('vendors').insert({ ...payload, is_active: true })
      if (error) { setFormError(supabaseError(error)); setSaving(false); return }
    }

    setSaving(false)
    await tagRef.current?.sendNotifications()
    closePanel()
    fetchVendors()
  }

  // ── Delete ────────────────────────────────────────────────
  async function handleDelete() {
    if (!editing) return
    if (!confirm('Permanently delete this vendor? This cannot be undone.')) return
    const { error } = await supabase.from('vendors').delete().eq('id', editing.id)
    if (error) { alert('Delete failed: ' + error.message); return }
    closePanel()
    fetchVendors()
  }

  // ── Archive / Restore ─────────────────────────────────────
  async function handleArchive() {
    if (!editing) return
    setArchiving(true)
    await supabase
      .from('vendors')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', editing.id)
    setArchiving(false)
    closePanel()
    fetchVendors()
  }

  async function handleRestore() {
    if (!editing) return
    setArchiving(true)
    await supabase
      .from('vendors')
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq('id', editing.id)
    setArchiving(false)
    closePanel()
    fetchVendors()
  }

  // ── Field helper ──────────────────────────────────────────
  function field(
    key: keyof FormState,
    label: string,
    opts?: { type?: string; required?: boolean; textarea?: boolean; dropdown?: boolean }
  ) {
    const base =
      'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition'

    return (
      <div>
        <label className="block text-xs text-gray-400 mb-1.5">
          {label}{opts?.required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
        {opts?.dropdown ? (
          <select
            value={form[key]}
            onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            className={base + ' cursor-pointer'}
          >
            {PAYMENT_TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        ) : opts?.textarea ? (
          <textarea
            rows={3}
            value={form[key]}
            onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            className={base + ' resize-none'}
          />
        ) : (
          <input
            type={opts?.type ?? 'text'}
            value={form[key]}
            onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            className={base}
          />
        )}
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-8 min-h-screen">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-blue-500/20 text-blue-300 border-blue-500/30">
              SALES
            </span>
          </div>
          <h1 className="text-2xl font-semibold text-[#1A1D2E]">Vendors</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {loading
              ? 'Loading…'
              : `${filtered.length} ${showArchived ? 'archived' : 'active'} vendor${filtered.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ImportExportBar
            table="vendors"
            filename="vendors"
            columns={[
              { header: 'Company Name', dbKey: 'company_name', example: 'Global Packaging Inc', required: true },
              { header: 'Contact Name', dbKey: 'contact_name', example: 'Bob Lee' },
              { header: 'Email', dbKey: 'email', example: 'bob@globalpkg.com' },
              { header: 'Phone', dbKey: 'phone', example: '555-987-6543' },
              { header: 'Address', dbKey: 'address', example: '456 Industrial Blvd, Hamilton ON' },
              { header: 'Payment Terms', dbKey: 'payment_terms', example: 'Net 30' },
              { header: 'Lead Time (Days)', dbKey: 'lead_time_days', example: '14' },
              { header: 'Notes', dbKey: 'notes', example: 'Primary supplier' },
            ]}
            onImportDone={fetchVendors}
          />
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-[#1A1D2E] text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Vendor
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
            placeholder="Search vendors…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
          />
        </div>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <div
            onClick={() => setShowArchived((v) => !v)}
            className={`w-9 h-5 rounded-full transition-colors relative ${showArchived ? 'bg-blue-600' : 'bg-[#F5F6FA]'}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${showArchived ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </div>
          <span className="text-sm text-gray-400">Show Archived</span>
        </label>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-[#E4E6EE] bg-white overflow-x-auto">
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
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            <p className="text-gray-500 text-sm">
              {search
                ? 'No vendors match your search.'
                : showArchived
                ? 'No archived vendors.'
                : 'No vendors yet. Add one to get started.'}
            </p>
          </div>
        ) : (
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-[#E4E6EE]">
                <th className="text-left text-xs font-semibold text-gray-500 px-5 py-3">Company Name</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-5 py-3">Contact Name</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-5 py-3">Email</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-5 py-3">Phone</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-5 py-3">Lead Time</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-5 py-3">Payment Terms</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v, i) => (
                <tr
                  key={v.id}
                  onClick={() => openEdit(v)}
                  className={`border-b border-[#E4E6EE]/60 last:border-0 cursor-pointer hover:bg-[#F9FAFB] transition-colors ${i % 2 === 0 ? '' : 'bg-[#F5F6FA]/10'}`}
                >
                  <td className="px-5 py-3.5 text-[#1A1D2E] font-medium">{v.company_name}</td>
                  <td className="px-5 py-3.5 text-gray-400">{v.contact_name || <span className="text-gray-700">—</span>}</td>
                  <td className="px-5 py-3.5 text-gray-400">{v.email || <span className="text-gray-700">—</span>}</td>
                  <td className="px-5 py-3.5 text-gray-400">{v.phone || <span className="text-gray-700">—</span>}</td>
                  <td className="px-5 py-3.5">
                    {v.lead_time_days !== null ? (
                      <span className="text-xs px-2 py-1 rounded-md bg-[#F9FAFB] text-gray-500 border border-[#E4E6EE]">
                        {v.lead_time_days} day{v.lead_time_days !== 1 ? 's' : ''}
                      </span>
                    ) : <span className="text-gray-700">—</span>}
                  </td>
                  <td className="px-5 py-3.5">
                    {v.payment_terms ? (
                      <span className="text-xs px-2 py-1 rounded-md bg-[#F9FAFB] text-gray-500 border border-[#E4E6EE]">
                        {v.payment_terms}
                      </span>
                    ) : <span className="text-gray-700">—</span>}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                      v.is_active
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                        : 'bg-[#F5F6FA]/40 text-gray-500 border border-[#E4E6EE]'
                    }`}>
                      {v.is_active ? 'Active' : 'Archived'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Overlay */}
      <div
        onClick={closePanel}
        className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${panelOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      />

      {/* Slide-out panel */}
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        className={`fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-full w-full md:max-w-md bg-white border-l border-[#E4E6EE] z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${panelOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E4E6EE] shrink-0">
          <h2 className="text-[#1A1D2E] font-semibold">
            {editing ? 'Edit Vendor' : 'Add Vendor'}
          </h2>
          {editing && <ShareLink id={editing.id} className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-[#6B7280] hover:text-[#1A1D2E] border border-[#E4E6EE] hover:border-[#D0D3E0] bg-white px-2.5 py-1.5 rounded-lg transition-colors shrink-0" />}
          <button
            onClick={closePanel}
            className="text-gray-500 hover:text-gray-700 transition-colors p-1 rounded-lg hover:bg-[#F5F6FA]"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {field('company_name', 'Company Name', { required: true })}
          {field('contact_name', 'Contact Name')}
          {field('email', 'Email', { type: 'email' })}
          {field('phone', 'Phone', { type: 'tel' })}
          {field('address', 'Address', { textarea: true })}
          {field('payment_terms', 'Payment Terms', { dropdown: true })}
          {field('lead_time_days', 'Lead Time (days)', { type: 'number' })}
          <TagInput ref={tagRef} value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} page="Vendors" className="w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition resize-none" />
          {editing && (<>
            <div className="border-t border-[#E4E6EE] pt-4"><FileUpload supabase={supabase} recordType="vendors" recordId={editing.id} currentUserEmail={userEmail}/></div>
            <div className="border-t border-[#E4E6EE] pt-4"><Comments recordType="vendor" recordId={editing.id} currentUserEmail={userEmail}/></div>
          </>)}
        </div>

        <div className="shrink-0 px-6 py-4 border-t border-[#E4E6EE] space-y-3">
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
                onClick={handleDelete}
                className="flex items-center gap-1.5 text-sm px-3 py-2.5 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                title="Permanently delete"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            )}
            {editing && (
              <button
                onClick={editing.is_active ? handleArchive : handleRestore}
                disabled={archiving}
                className="flex items-center gap-1.5 text-sm px-3 py-2.5 rounded-lg border border-[#E4E6EE] text-gray-400 hover:text-gray-700 hover:border-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
              className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-[#E4E6EE] text-gray-400 hover:text-gray-700 hover:border-gray-600 transition-colors"
            >
              Cancel
            </button>

            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-[#1A1D2E] text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
            >
              {saving ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Saving…
                </>
              ) : 'Save Vendor'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
