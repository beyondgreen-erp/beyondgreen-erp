'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import ShareLink from '@/components/ShareLink'
import { useItemDeepLink } from '@/components/useItemDeepLink'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import TagInput, { TagInputHandle } from '@/components/TagInput'
import ImportExportBar from '@/components/ImportExportBar'
import FileUpload from '@/components/FileUpload'
import Comments from '@/components/Comments'
import RecordModal, { StatusCell } from '@/components/RecordModal'

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
  company_name: '', contact_name: '', email: '', phone: '', address: '',
  payment_terms: 'Net 30' as PaymentTerms, lead_time_days: '', notes: '',
}
type FormState = typeof emptyForm

// ── Supplier-name → vendor matching ────────────────────────────────
// Purchase requests store the supplier as free text. Vendors were de-duplicated,
// so a few supplier spellings need to be aliased onto their canonical vendor.
const loose = (s: any) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
const VENDOR_ALIASES: Record<string, string> = {
  homedeport: 'Home Depot', thehomedepot: 'Home Depot',
  kcphoto: 'KC Photo Engraving', kcpe: 'KC Photo Engraving',
  natureworks: 'NatureWorks LLC',
  modifiedplastics: 'Modified Plastics Inc',
  krishmetro: 'Krish Biotech - Metro Biogreen', krishbiotechmetro: 'Krish Biotech - Metro Biogreen',
  krishumiya: 'Krish Biotech - Umiya Packaging', umiyakrish: 'Krish Biotech - Umiya Packaging',
  paraswebcoatkrish: 'Krish Biotech - Paras Webcoat', paraswebcoatpvtltd: 'Krish Biotech - Paras Webcoat',
  rossari: 'Krish Biotech - Rossari', rumitkrish: 'Krish Biotech - Rumit',
}

const fmtDate = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
const money = (n: any) => (n === null || n === undefined || n === '') ? '' : '$' + Number(n).toFixed(2)

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
  const [products, setProducts] = useState<any[]>([])
  const [requests, setRequests] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  // modal state
  const [openVendor, setOpenVendor] = useState<Vendor | null>(null)
  const [mode, setMode] = useState<'' | 'view' | 'edit' | 'create'>('')
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [formError, setFormError] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const tagRef = useRef<TagInputHandle>(null)

  useItemDeepLink(vendors, (v: Vendor) => { setOpenVendor(v); setMode('view') })

  // ── Fetch ──────────────────────────────────────────────────
  async function fetchAll() {
    setLoading(true)
    const [{ data: v }, { data: p }, { data: r }] = await Promise.all([
      supabase.from('vendors').select('*').order('company_name', { ascending: true }),
      supabase.from('products').select('id,sku,product_name,unit_cost,case_cost,unit_of_measure').order('product_name', { ascending: true }),
      supabase.from('purchasing_requests').select('id,name,supplier,supplier_pn,po_number,qty_ordered,po_date,status,location,group_title,date_received').order('po_date', { ascending: false, nullsFirst: false }),
    ])
    if (v) setVendors(v as Vendor[])
    setProducts(p || [])
    setRequests(r || [])
    setLoading(false)
  }
  useEffect(() => {
    fetchAll()
    supabase.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email) })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived: link purchase requests + inventory price to each vendor ──
  const productIndex = useMemo(() => {
    const bySku: Record<string, any> = {}, byName: Record<string, any> = {}
    for (const p of products) { if (p.sku) bySku[loose(p.sku)] = p; if (p.product_name) byName[loose(p.product_name)] = p }
    return { bySku, byName }
  }, [products])

  const priceFor = (name: any, pn: any) => {
    const p = (pn && productIndex.bySku[loose(pn)]) || (name && productIndex.byName[loose(name)])
    return p ? p.unit_cost : null
  }

  const requestsByVendorId = useMemo(() => {
    const byLoose: Record<string, Vendor> = {}
    for (const v of vendors) byLoose[loose(v.company_name)] = v
    const findVendor = (supplier: any): Vendor | undefined => {
      const k = loose(supplier)
      if (!k) return undefined
      if (byLoose[k]) return byLoose[k]
      const canon = VENDOR_ALIASES[k]
      if (canon) return byLoose[loose(canon)]
      return undefined
    }
    const map: Record<string, any[]> = {}
    for (const r of requests) {
      const v = findVendor(r.supplier)
      if (v) (map[v.id] ||= []).push(r)
    }
    return map
  }, [requests, vendors])

  // Distinct items purchased from a vendor (grouped from the purchase request board)
  const itemsForVendor = (vid: string) => {
    const rows = requestsByVendorId[vid] || []
    const groups: Record<string, any> = {}
    for (const r of rows) {
      const key = loose(r.name) || loose(r.supplier_pn) || r.id
      if (!groups[key]) groups[key] = { name: r.name || r.supplier_pn || '—', pn: r.supplier_pn || '', count: 0, lastDate: null as string | null, lastStatus: null as string | null }
      const g = groups[key]
      g.count++
      if (!g.pn && r.supplier_pn) g.pn = r.supplier_pn
      if (r.po_date && (!g.lastDate || r.po_date > g.lastDate)) { g.lastDate = r.po_date; g.lastStatus = r.status }
    }
    return Object.values(groups).sort((a: any, b: any) => (b.lastDate || '').localeCompare(a.lastDate || ''))
  }

  // ── Filtering ─────────────────────────────────────────────
  const filtered = vendors.filter((v) => {
    if (v.is_active === showArchived) return false
    if (!search) return true
    const q = search.toLowerCase()
    return v.company_name.toLowerCase().includes(q)
      || (v.contact_name ?? '').toLowerCase().includes(q)
      || (v.email ?? '').toLowerCase().includes(q)
      || (v.phone ?? '').toLowerCase().includes(q)
      || (requestsByVendorId[v.id] || []).some((r: any) => String(r.name ?? '').toLowerCase().includes(q))
  })

  // ── Modal helpers ─────────────────────────────────────────
  function openRecord(v: Vendor) { setOpenVendor(v); setMode('view'); setFormError('') }
  function openAdd() { setOpenVendor(null); setForm(emptyForm); setFormError(''); setMode('create') }
  function startEdit() {
    if (!openVendor) return
    const v = openVendor
    setForm({
      company_name: v.company_name, contact_name: v.contact_name ?? '', email: v.email ?? '',
      phone: v.phone ?? '', address: v.address ?? '', payment_terms: v.payment_terms ?? 'Net 30',
      lead_time_days: v.lead_time_days !== null ? String(v.lead_time_days) : '', notes: v.notes ?? '',
    })
    setFormError(''); setMode('edit')
  }
  function closeModal() { setMode(''); setTimeout(() => setOpenVendor(null), 50) }

  // ── Save ──────────────────────────────────────────────────
  async function handleSave() {
    if (!form.company_name.trim()) { setFormError('Company Name is required.'); return }
    setFormError(''); setSaving(true)
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
    if (mode === 'edit' && openVendor) {
      const { error } = await supabase.from('vendors').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', openVendor.id)
      if (error) { setFormError(supabaseError(error)); setSaving(false); return }
    } else {
      const { error } = await supabase.from('vendors').insert({ ...payload, is_active: true })
      if (error) { setFormError(supabaseError(error)); setSaving(false); return }
    }
    setSaving(false)
    await tagRef.current?.sendNotifications()
    closeModal()
    fetchAll()
  }

  async function handleDelete() {
    if (!openVendor) return
    if (!confirm('Permanently delete this vendor? This cannot be undone.')) return
    const { error } = await supabase.from('vendors').delete().eq('id', openVendor.id)
    if (error) { alert('Delete failed: ' + error.message); return }
    closeModal(); fetchAll()
  }
  async function handleArchiveToggle() {
    if (!openVendor) return
    setArchiving(true)
    await supabase.from('vendors').update({ is_active: !openVendor.is_active, updated_at: new Date().toISOString() }).eq('id', openVendor.id)
    setArchiving(false); closeModal(); fetchAll()
  }

  // ── Field helper (edit/create form) ───────────────────────
  function field(key: keyof FormState, label: string, opts?: { type?: string; required?: boolean; textarea?: boolean; dropdown?: boolean }) {
    const base = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3B6FE0]/40 focus:border-transparent transition'
    return (
      <div>
        <label className="block text-xs text-gray-400 mb-1.5">{label}{opts?.required && <span className="text-red-400 ml-0.5">*</span>}</label>
        {opts?.dropdown ? (
          <select value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} className={base + ' cursor-pointer'}>
            {PAYMENT_TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        ) : opts?.textarea ? (
          <textarea rows={2} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} className={base + ' resize-none'} />
        ) : (
          <input type={opts?.type ?? 'text'} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} className={base} />
        )}
      </div>
    )
  }

  const activeCount = vendors.filter(v => v.is_active).length
  const detailItems = openVendor ? itemsForVendor(openVendor.id) : []
  const detailPurchases = openVendor ? (requestsByVendorId[openVendor.id] || []) : []

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="min-h-screen mon-page p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <span className="mon-tag t-teal">🏭 Vendors</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">Vendors</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${activeCount} active vendor${activeCount !== 1 ? 's' : ''}`}</p>
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
              { header: 'Address', dbKey: 'address', example: '456 Industrial Blvd' },
              { header: 'Payment Terms', dbKey: 'payment_terms', example: 'Net 30' },
              { header: 'Lead Time (Days)', dbKey: 'lead_time_days', example: '14' },
              { header: 'Notes', dbKey: 'notes', example: 'Primary supplier' },
            ]}
            onImportDone={fetchAll}
          />
          <button onClick={openAdd} className="flex items-center gap-1.5 whitespace-nowrap bg-[#3B6FE0] hover:bg-[#2f5bc0] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors shadow-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
            Add Vendor
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search vendor, contact, or item purchased…" className="bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm w-full sm:w-96 focus:outline-none focus:ring-2 focus:ring-[#3B6FE0]/40" />
        <label className="flex items-center gap-2 cursor-pointer select-none shrink-0">
          <div onClick={() => setShowArchived(v => !v)} className={`w-9 h-5 rounded-full transition-colors relative ${showArchived ? 'bg-[#3B6FE0]' : 'bg-gray-200'}`}>
            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${showArchived ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </div>
          <span className="text-sm text-gray-500">Show Archived</span>
        </label>
      </div>

      {/* Record board group */}
      <div className="bg-white rounded-xl overflow-hidden shadow-sm border border-[#ECEEF3]">
        <div className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none sticky top-0 z-30 rounded-t-xl" style={{ background: '#00C7C714', borderLeft: '5px solid #00C7C7' }} onClick={() => setCollapsed(c => !c)}>
          <span className="text-[10px]" style={{ color: '#017070', display: 'inline-block', transform: collapsed ? 'none' : 'rotate(90deg)' }}>&#9654;</span>
          <span className="font-bold text-sm" style={{ color: '#017070' }}>{showArchived ? 'Archived Vendors' : 'Vendors'}</span>
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#00C7C726', color: '#017070' }}>{filtered.length}</span>
        </div>
        {!collapsed && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="text-[11px] uppercase text-gray-400 border-b border-[#EEF0F4]">
                  <th className="text-left px-4 py-2 font-semibold">Vendor</th>
                  <th className="text-left px-3 py-2 font-semibold w-[150px]">Contact</th>
                  <th className="text-left px-3 py-2 font-semibold w-[200px]">Email</th>
                  <th className="text-left px-3 py-2 font-semibold w-[80px]">Items</th>
                  <th className="text-left px-3 py-2 font-semibold w-[90px]">Purchases</th>
                  <th className="text-left px-3 py-2 font-semibold w-[110px]">Terms</th>
                  <th className="text-left px-3 py-2 font-semibold w-[100px]">Lead Time</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-sm">Loading…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-sm">{search ? 'No vendors match your search.' : showArchived ? 'No archived vendors.' : 'No vendors yet. Add one to get started.'}</td></tr>
                ) : filtered.map((v, i) => {
                  const rows = requestsByVendorId[v.id] || []
                  const nItems = itemsForVendor(v.id).length
                  return (
                    <tr key={v.id} className={`cursor-pointer hover:bg-[#F2F6FF] ${i % 2 ? 'bg-[#F8FAFC]' : 'bg-white'}`} onClick={() => openRecord(v)}>
                      <td className="px-4 py-2.5 font-semibold text-[#1A1D2E]">{v.company_name}</td>
                      <td className="px-3 py-2.5 text-gray-600">{v.contact_name || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-600">{v.email || '—'}</td>
                      <td className="px-3 py-2.5">{nItems ? <span className="text-[#017070] bg-[#00C7C71a] text-xs font-semibold rounded-full px-2 py-0.5">{nItems}</span> : <span className="text-gray-300">—</span>}</td>
                      <td className="px-3 py-2.5">{rows.length ? <span className="text-[#3B6FE0] text-xs font-semibold">🧾 {rows.length}</span> : <span className="text-gray-300">—</span>}</td>
                      <td className="px-3 py-2.5 text-gray-600">{v.payment_terms || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-600">{v.lead_time_days != null ? `${v.lead_time_days} day${v.lead_time_days !== 1 ? 's' : ''}` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Record modal */}
      <RecordModal
        open={mode !== ''}
        onClose={closeModal}
        title={mode === 'create' ? 'Add Vendor' : (openVendor?.company_name || 'Vendor')}
        subtitle={mode === 'create' ? 'New vendor' : (mode === 'edit' ? 'Editing vendor' : (openVendor?.contact_name || 'Vendor'))}
        maxWidth={mode === 'view' ? 820 : 560}
        headerRight={mode === 'view' && openVendor ? <ShareLink id={openVendor.id} className="inline-flex items-center gap-1.5 text-xs font-medium text-white/90 hover:text-white border border-white/30 hover:border-white/50 px-2.5 py-1.5 rounded-lg transition-colors" /> : undefined}
        footer={
          mode === 'view' && openVendor ? (
            <>
              <button onClick={handleDelete} className="text-sm px-3 py-2 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors mr-auto">Delete</button>
              <button onClick={handleArchiveToggle} disabled={archiving} className="text-sm px-3 py-2 rounded-lg border border-[#E4E6EE] text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-50">{openVendor.is_active ? 'Archive' : 'Restore'}</button>
              <button onClick={startEdit} className="text-sm font-semibold px-4 py-2 rounded-lg bg-[#3B6FE0] hover:bg-[#2f5bc0] text-white transition-colors">Edit</button>
            </>
          ) : (
            <>
              <button onClick={closeModal} className="text-sm px-4 py-2 rounded-lg border border-[#E4E6EE] text-gray-500 hover:text-gray-700 transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg bg-[#3B6FE0] hover:bg-[#2f5bc0] text-white transition-colors disabled:opacity-60">
                {saving ? 'Saving…' : 'Save Vendor'}
              </button>
            </>
          )
        }
      >
        {mode === 'view' && openVendor ? (
          <div className="space-y-5">
            {/* Info */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <Info label="Contact" value={openVendor.contact_name} />
              <Info label="Email" value={openVendor.email} />
              <Info label="Phone" value={openVendor.phone} />
              <Info label="Payment Terms" value={openVendor.payment_terms} />
              <Info label="Lead Time" value={openVendor.lead_time_days != null ? `${openVendor.lead_time_days} days` : null} />
              <Info label="Status" value={openVendor.is_active ? 'Active' : 'Archived'} />
              {openVendor.address && <div className="col-span-2 sm:col-span-3"><Info label="Address" value={openVendor.address} /></div>}
              {openVendor.notes && <div className="col-span-2 sm:col-span-3"><Info label="Notes" value={openVendor.notes} /></div>}
            </div>

            {/* Items from this vendor */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Items From This Vendor <span className="text-gray-300 normal-case font-normal">({detailItems.length})</span></p>
              {detailItems.length === 0 ? <p className="text-sm text-gray-400">No purchases recorded for this vendor yet.</p> : (
                <div className="border border-[#EEF0F4] rounded-lg overflow-x-auto">
                  <table className="w-full text-sm min-w-[560px]">
                    <thead><tr className="bg-[#FBFCFE] text-[11px] uppercase text-gray-400">
                      <th className="text-left px-3 py-2">Item</th>
                      <th className="text-left px-3 py-2">Part #</th>
                      <th className="text-right px-3 py-2">Times Ordered</th>
                      <th className="text-left px-3 py-2">Last Ordered</th>
                      <th className="text-right px-3 py-2">Last Price</th>
                    </tr></thead>
                    <tbody>
                      {detailItems.map((it: any, idx: number) => {
                        const price = priceFor(it.name, it.pn)
                        return (
                          <tr key={idx} className="border-t border-[#F0F2F6]">
                            <td className="px-3 py-2 font-medium text-[#1A1D2E]">{it.name}</td>
                            <td className="px-3 py-2 font-mono text-emerald-700 text-xs">{it.pn || '—'}</td>
                            <td className="px-3 py-2 text-right text-gray-600">{it.count}</td>
                            <td className="px-3 py-2 text-gray-600">{fmtDate(it.lastDate) || '—'}</td>
                            <td className="px-3 py-2 text-right text-gray-700">{money(price) || <span className="text-gray-300">—</span>}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-[11px] text-gray-400 mt-1.5">Items &amp; purchases are pulled from the Purchasing Requests board. Last Price shows the matching Inventory unit cost where the item exists on the Inventory board.</p>
            </div>

            {/* Purchase history */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Purchase History <span className="text-gray-300 normal-case font-normal">({detailPurchases.length})</span></p>
              {detailPurchases.length === 0 ? <p className="text-sm text-gray-400">No purchase requests found for this vendor.</p> : (
                <div className="border border-[#EEF0F4] rounded-lg overflow-x-auto max-h-72 overflow-y-auto">
                  <table className="w-full text-sm min-w-[620px]">
                    <thead className="sticky top-0"><tr className="bg-[#FBFCFE] text-[11px] uppercase text-gray-400">
                      <th className="text-left px-3 py-2">Item</th>
                      <th className="text-left px-3 py-2">PO #</th>
                      <th className="text-right px-3 py-2">Qty</th>
                      <th className="text-left px-3 py-2">PO Date</th>
                      <th className="text-left px-3 py-2">Status</th>
                    </tr></thead>
                    <tbody>
                      {detailPurchases.map((r: any) => (
                        <tr key={r.id} className="border-t border-[#F0F2F6]">
                          <td className="px-3 py-2 text-[#1A1D2E]">{r.name || '—'}</td>
                          <td className="px-3 py-2 text-gray-600">{r.po_number || '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-600">{r.qty_ordered || '—'}</td>
                          <td className="px-3 py-2 text-gray-600">{fmtDate(r.po_date) || '—'}</td>
                          <td className="px-3 py-2">{r.status ? <StatusCell status={r.status} /> : <span className="text-gray-300">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Files + Comments */}
            <div className="border-t border-[#EEF0F4] pt-4"><FileUpload supabase={supabase} recordType="vendors" recordId={openVendor.id} currentUserEmail={userEmail} /></div>
            <div className="border-t border-[#EEF0F4] pt-4"><Comments recordType="vendor" recordId={openVendor.id} currentUserEmail={userEmail} /></div>
          </div>
        ) : (
          <div className="space-y-4">
            {field('company_name', 'Company Name', { required: true })}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {field('contact_name', 'Contact Name')}
              {field('email', 'Email', { type: 'email' })}
              {field('phone', 'Phone', { type: 'tel' })}
              {field('payment_terms', 'Payment Terms', { dropdown: true })}
              {field('lead_time_days', 'Lead Time (days)', { type: 'number' })}
            </div>
            {field('address', 'Address', { textarea: true })}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Notes</label>
              <TagInput ref={tagRef} value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} page="Vendors" className="w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3B6FE0]/40 transition resize-none" />
            </div>
            {formError && (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5">
                <svg className="w-4 h-4 text-red-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <p className="text-red-600 text-xs">{formError}</p>
              </div>
            )}
          </div>
        )}
      </RecordModal>
    </div>
  )
}

function Info({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-gray-800 mt-0.5 break-words">{value || <span className="text-gray-300">—</span>}</p>
    </div>
  )
}
