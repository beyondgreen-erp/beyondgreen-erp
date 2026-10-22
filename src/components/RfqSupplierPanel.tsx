'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { generateRFQPDF, type PDFLine } from '@/lib/pdfHelpers'
import FileUpload from '@/components/FileUpload'
import { downloadFile, formatFileSize, uploadFile } from '@/lib/fileHelpers'

/**
 * Outbound supplier RFQ, from inside the quotations page.
 *
 *  - pick suppliers out of the vendor directory (filtered by category, e.g. "China Cup Manufacturers")
 *  - edit the covering email once; {{contact}} and {{company}} merge per supplier
 *  - preview exactly what each supplier will receive, then send with the RFQ PDF attached
 *  - every reply comes back under this RFQ number and shows in the comparison table
 */

const GREEN = '#1F9A3A'
const DEEP = '#14532D'

export interface RfqVendor {
  id: string
  company_name: string
  contact_name: string | null
  email: string | null
  phone: string | null
  category: string | null
  city_province: string | null
  website: string | null
  certifications: string | null
  product_scope: string | null
  moq: string | null
  tier: number | null
  us_export: string | null
  source_notes: string | null
}

export interface SendRow {
  id: string
  vendor_id: string | null
  vendor_name: string
  recipient_email: string
  status: string
  sent_at: string
  opened_at: string | null
  responded_at: string | null
  error: string | null
  selection?: 'talking' | 'working' | 'won' | 'declined' | null
  selected_at?: string | null
  selected_by?: string | null
}

/* ------------------------------------------------- Who we're going with */

export type Selection = 'talking' | 'working' | 'won' | 'declined'
export const SELECTION_META: Record<Selection, { label: string; icon: string; bg: string; text: string; row: string }> = {
  won: { label: 'Won', icon: '🏆', bg: '#FEF3C7', text: '#92400E', row: 'bg-amber-50' },
  working: { label: 'Working with', icon: '🤝', bg: '#E0E7FF', text: '#3730A3', row: 'bg-indigo-50/50' },
  talking: { label: 'In conversation', icon: '💬', bg: '#E0F2FE', text: '#075985', row: 'bg-sky-50/60' },
  declined: { label: 'RFQ rejected', icon: '✖', bg: '#FEE2E2', text: '#B91C1C', row: 'bg-red-50' },
}
const isSel = (v: unknown): v is Selection => v === 'won' || v === 'working' || v === 'talking' || v === 'declined'
export const selectionRow = (v: unknown) => (isSel(v) ? SELECTION_META[v].row : '')

export function SelectionBadge({ selection, at, by }: { selection?: string | null; at?: string | null; by?: string | null }) {
  if (!isSel(selection)) return null
  const m = SELECTION_META[selection]
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap border"
      style={{ background: m.bg, color: m.text, borderColor: m.text + '33' }}
      title={[at ? `Set ${new Date(at).toLocaleString()}` : '', by ? `by ${by}` : ''].filter(Boolean).join(' ')}>
      {m.icon} {m.label}
    </span>
  )
}

/** Small picker: Not chosen / Working with / Won. Only one winner per RFQ (enforced in the DB). */
export function SelectionPicker({ send, onChanged }: { send: SendRow; onChanged: () => void }) {
  const supabase = createSupabaseBrowserClient()
  const [busy, setBusy] = useState(false)
  async function pick(v: string) {
    setBusy(true)
    const { error } = await supabase.rpc('rfq_set_selection', { p_send: send.id, p_selection: v || null })
    setBusy(false)
    if (error) { alert(error.message); return }
    onChanged()
  }
  return (
    <select
      value={send.selection || ''}
      disabled={busy}
      onChange={e => pick(e.target.value)}
      onClick={e => e.stopPropagation()}
      title="Mark who you're working with, or who won this RFQ"
      className={`text-[11px] border rounded-md px-1.5 py-0.5 disabled:opacity-50 ${send.selection === 'declined' ? 'border-red-300 bg-red-50 text-red-700 font-semibold' : 'border-gray-300 bg-white text-gray-700'}`}
    >
      <option value="">Pick supplier…</option>
      <option value="talking">💬 In conversation</option>
      <option value="working">🤝 Working with</option>
      <option value="won">🏆 Won (awarded)</option>
      <option value="declined">✖ RFQ rejected (supplier said no)</option>
    </select>
  )
}

/** Summary for an RFQ, strongest first: Won, then Working with, then In conversation. */
export function selectionSummary(sends: { vendor_name: string; selection?: string | null }[]): { kind: Selection; text: string } | null {
  const won = sends.find(s => s.selection === 'won')
  if (won) return { kind: 'won', text: won.vendor_name }
  for (const k of ['working', 'talking'] as const) {
    const names = sends.filter(s => s.selection === k).map(s => s.vendor_name)
    if (names.length) return { kind: k, text: names.join(', ') }
  }
  return null
}

/** Every non-empty group, e.g. [🤝 Working with A] [💬 In conversation B, C]. */
export function selectionGroups(sends: { vendor_name: string; selection?: string | null }[]): { kind: Selection; names: string[] }[] {
  return (['won', 'working', 'talking', 'declined'] as const)
    .map(k => ({ kind: k, names: sends.filter(s => s.selection === k).map(s => s.vendor_name) }))
    .filter(g => g.names.length > 0)
}
export const selectionVerb = (k: Selection) => (k === 'won' ? 'Awarded to' : k === 'working' ? 'Working with' : k === 'talking' ? 'In conversation with' : 'RFQ rejected by')

interface RespLine {
  id: string
  description: string | null
  sku: string | null
  quantity: number | null
  unit_price: number | null
  pcs_per_case: number | null
  case_price: number | null
  notes: string | null
}

export interface Resp {
  id: string
  vendor_name: string | null
  contact_name: string | null
  currency: string | null
  incoterm: string | null
  payment_terms: string | null
  lead_time_days: number | null
  moq_note: string | null
  validity_days: number | null
  plate_die_charges: string | null
  overrun_tolerance: string | null
  exclusions: string | null
  certifications: string | null
  sample_available: boolean | null
  notes: string | null
  total_value: number | null
  submitted_at: string
  method?: string | null
  rfq_send_id?: string | null
  vendor_id?: string | null
  contact_email?: string | null
  rfq_response_lines?: RespLine[]
}

interface RespFile {
  id: string
  record_id: string
  file_name: string
  file_size: number | null
  storage_path: string
}

interface QLine {
  id: string
  sku: string | null
  product_name: string | null
  description: string | null
  quantity: number | null
}

/** The house RFQ covering note. Editable before every send. */
export function defaultRfqBody(opts: {
  rfqNumber: string
  summary?: string
  deliverTo?: string
}) {
  const { rfqNumber, summary, deliverTo } = opts
  return `<p>Hi {{contact}},</p>

<p>Thank you for your time. Could you please quote us at your earliest for the attached RFQ, <strong>${rfqNumber}</strong>? If possible we would like DDP pricing.</p>

${summary ? `<p>${summary}</p>` : ''}

<p><strong>What we need from you</strong></p>
<ul>
  <li>DDP unit price per piece, by size, delivered to ${deliverTo || 'beyondGREEN biotech, 1202 E Wakeham Ave, Santa Ana, CA 92705'}</li>
  <li>MOQ per size, and confirmation that the run sizes in the RFQ are workable</li>
  <li>Lead time from artwork and PO approval to delivery</li>
  <li>Packaging — pieces per case, case dimensions and weight</li>
  <li>Coating and construction confirmation for each item as specified</li>
  <li>Food-contact and compostability certifications you hold, with certificate numbers</li>
  <li>Print registration tolerance on any multi-color print</li>
</ul>

<p>Two more things while you are pricing it: please send a digital proof for approval before any full run, and flag any assumptions or exclusions in your quote — duties, freight surcharges, plate or die charges, and overrun or underrun tolerance.</p>

<p>Please also confirm your payment terms.</p>

<p>This program is live and moving, so we would appreciate your response as soon as you can. Reply however is easiest — use the form below, send your own quote sheet, or just answer by email.</p>

<p>Thank you,<br>
<strong>Rudy Patel</strong><br>
Co-Founder &amp; Chief Business Development Officer<br>
beyondGREEN biotech, Inc.<br>
Direct (949) 606-4667 &nbsp;|&nbsp; rudyp@beyondgreenbiotech.com</p>`
}

function firstName(n?: string | null) {
  if (!n) return ''
  return String(n).trim().split(/\s+/)[0]
}

function money(n: number | null | undefined, ccy = 'USD') {
  if (n == null) return '—'
  return `${ccy} ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
}

const TIER_LABEL: Record<number, string> = {
  1: 'Certificate names the exact product',
  2: 'Verified factory, scope to confirm',
  3: 'Chase or specialist',
}

/* ------------------------------------------------------------------ Send modal */

export function RfqSendModal({
  open,
  onClose,
  quotationId,
  rfqNumber,
  rfqDate,
  notes,
  shippingAddress,
  paymentTerms,
  exportCountry,
  lines,
  onSent,
}: {
  open: boolean
  onClose: () => void
  quotationId: string
  rfqNumber: string
  rfqDate: string | null
  notes: string | null
  shippingAddress: string | null
  paymentTerms: string | null
  exportCountry: string | null
  lines: PDFLine[]
  onSent: () => void
}) {
  const supabase = createSupabaseBrowserClient()
  const [vendors, setVendors] = useState<RfqVendor[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [category, setCategory] = useState<string>('China Cup Manufacturers')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [summary, setSummary] = useState('')
  const [previewFor, setPreviewFor] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ sent: number; failed: number; results: any[]; art?: { total: number; attached: number; link_only: string[] } } | null>(null)
  const [artCount, setArtCount] = useState<number | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('vendors')
      .select('id, company_name, contact_name, email, phone, category, city_province, website, certifications, product_scope, moq, tier, us_export, source_notes')
      .eq('is_active', true)
      .order('tier', { ascending: true, nullsFirst: false })
      .order('company_name')
    const rows = (data ?? []) as RfqVendor[]
    setVendors(rows)
    setCategories(Array.from(new Set(rows.map(v => v.category).filter(Boolean) as string[])).sort())
  }, [supabase])

  useEffect(() => { if (open) load() }, [open, load])

  // Show up front how much artwork will go out, so nobody has to guess.
  useEffect(() => {
    if (!open || !quotationId) return
    let cancelled = false
    supabase
      .from('file_attachments')
      .select('id', { count: 'exact', head: true })
      .eq('record_type', 'quotation_art')
      .eq('record_id', quotationId)
      .then(({ count }) => { if (!cancelled) setArtCount(count ?? 0) })
    return () => { cancelled = true }
  }, [open, quotationId, supabase])

  useEffect(() => {
    if (!open) return
    setSubject(`RFQ ${rfqNumber} — beyondGREEN biotech — please quote`)
    setBody(defaultRfqBody({ rfqNumber, deliverTo: shippingAddress || undefined }))
    setResult(null)
  }, [open, rfqNumber, shippingAddress])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return vendors.filter(v => {
      if (category !== 'All' && v.category !== category) return false
      if (!q) return true
      return [v.company_name, v.city_province, v.certifications, v.product_scope].some(f => (f || '').toLowerCase().includes(q))
    })
  }, [vendors, category, search])

  const chosen = useMemo(() => vendors.filter(v => selected.has(v.id)), [vendors, selected])
  const noEmail = chosen.filter(v => !v.email)

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function selectTier(tier: number) {
    setSelected(prev => {
      const next = new Set(prev)
      shown.filter(v => v.tier === tier && v.email).forEach(v => next.add(v.id))
      return next
    })
  }

  const previewVendor = previewFor ? vendors.find(v => v.id === previewFor) : chosen[0]
  const previewHtml = previewVendor
    ? body
        .replace(/\{\{\s*contact\s*\}\}/gi, firstName(previewVendor.contact_name) || previewVendor.company_name)
        .replace(/\{\{\s*company\s*\}\}/gi, previewVendor.company_name)
        .replace(/\{\{\s*portal_link\s*\}\}/gi, '#')
    : ''

  async function send() {
    if (chosen.length === 0) return
    const withEmail = chosen.filter(v => v.email)
    if (withEmail.length === 0) { alert('None of the selected suppliers has an email address on file.'); return }
    if (!confirm(`Send RFQ ${rfqNumber} to ${withEmail.length} supplier${withEmail.length === 1 ? '' : 's'}?`)) return

    setSending(true)
    try {
      const pdf_base64 = (await generateRFQPDF(
        {
          quote_number: rfqNumber,
          quote_date: rfqDate || new Date().toISOString().split('T')[0],
          expiry_date: null,
          notes,
          delivery_address: shippingAddress,
          delivery_by: null,
          reply_to_email: 'rudyp@beyondgreenbiotech.com',
          reply_to_name: 'Rudy Patel',
          billing_address: null,
          shipping_address: shippingAddress,
          export_country: exportCountry,
          payment_terms: paymentTerms,
        },
        lines,
        null,
        { output: 'base64' }
      )) as string

      const res = await fetch('/api/rfq/send-vendors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quotation_id: quotationId,
          subject,
          body_html: summary ? body.replace('<p><strong>What we need from you</strong></p>', `<p>${summary}</p>\n<p><strong>What we need from you</strong></p>`) : body,
          pdf_base64,
          pdf_filename: `${rfqNumber.replace(/[^\w.-]+/g, '_')}.pdf`,
          reply_to: 'rudyp@beyondgreenbiotech.com',
          vendors: withEmail.map(v => ({
            vendor_id: v.id,
            vendor_name: v.company_name,
            email: v.email,
            contact_name: v.contact_name,
          })),
        }),
      })
      const json = await res.json()
      if (!res.ok) { alert(json.error || 'Send failed'); return }
      setResult(json)
      onSent()
    } catch (e: any) {
      alert('Send failed: ' + (e?.message || e))
    } finally {
      setSending(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-6xl max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Send RFQ to suppliers</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {rfqNumber} · {lines.length} line{lines.length === 1 ? '' : 's'} · the RFQ PDF is attached automatically
              {artCount !== null && (
                artCount > 0
                  ? ` · ${artCount} artwork file${artCount === 1 ? '' : 's'} included`
                  : ' · no artwork uploaded yet'
              )}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {result ? (
          <div className="p-8 overflow-y-auto">
            <h3 className="font-semibold text-gray-900 mb-1">
              Sent to {result.sent} supplier{result.sent === 1 ? '' : 's'}{result.failed ? `, ${result.failed} failed` : ''}
            </h3>
            <p className="text-sm text-gray-500 mb-4">Each one has its own response link. Replies land under {rfqNumber}.</p>
            {!!result.art?.total && (
              <p className="text-sm text-gray-600 mb-4">
                Artwork: {result.art.attached} of {result.art.total} file{result.art.total === 1 ? '' : 's'} attached to the email
                {result.art.link_only.length > 0 && (
                  <> · too large to attach, downloadable from the quote form: {result.art.link_only.join(', ')}</>
                )}
              </p>
            )}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              {result.results.map((r: any, i: number) => (
                <div key={i} className="flex items-center justify-between px-4 py-2 text-sm border-b border-gray-100 last:border-0">
                  <span className="font-medium text-gray-800">{r.vendor_name}</span>
                  <span className={r.ok ? 'text-emerald-600' : 'text-red-600'}>{r.ok ? 'Sent' : r.error}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-6">
              <button onClick={onClose} className="px-5 py-2 rounded-lg text-white text-sm font-semibold" style={{ background: GREEN }}>Done</button>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-2">
            {/* Supplier picker */}
            <div className="border-r border-gray-200 flex flex-col overflow-hidden">
              <div className="p-4 border-b border-gray-100 space-y-2">
                <div className="flex gap-2">
                  <select value={category} onChange={e => setCategory(e.target.value)} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm flex-1">
                    <option value="All">All categories</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="border border-gray-300 rounded-md px-2 py-1.5 text-sm flex-1" />
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-400">Quick add:</span>
                  {[1, 2, 3].map(t => (
                    <button key={t} onClick={() => selectTier(t)} className="px-2 py-0.5 rounded border border-gray-200 text-gray-600 hover:bg-gray-50">Tier {t}</button>
                  ))}
                  <button onClick={() => setSelected(new Set())} className="px-2 py-0.5 rounded border border-gray-200 text-gray-600 hover:bg-gray-50">Clear</button>
                  <span className="ml-auto font-semibold text-gray-700">{selected.size} selected</span>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {shown.map(v => (
                  <label key={v.id} className={`flex gap-3 px-4 py-3 border-b border-gray-100 cursor-pointer hover:bg-gray-50 ${selected.has(v.id) ? 'bg-emerald-50/50' : ''}`}>
                    <input type="checkbox" className="mt-1 rounded border-gray-300" checked={selected.has(v.id)} onChange={() => toggle(v.id)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-gray-900 truncate">{v.company_name}</span>
                        {v.tier && <span title={TIER_LABEL[v.tier]} className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: v.tier === 1 ? '#E7F2EA' : v.tier === 2 ? '#F3F8F4' : '#F3F4F6', color: v.tier === 1 ? DEEP : '#6B7280' }}>T{v.tier}</span>}
                      </div>
                      <div className="text-[11px] text-gray-500 truncate">{v.city_province}{v.email ? ` · ${v.email}` : ' · no email on file'}</div>
                      {v.certifications && <div className="text-[11px] text-gray-400 truncate mt-0.5">{v.certifications}</div>}
                    </div>
                  </label>
                ))}
                {shown.length === 0 && <div className="p-6 text-sm text-gray-400 text-center">No suppliers match.</div>}
              </div>
            </div>

            {/* Email + preview */}
            <div className="flex flex-col overflow-y-auto">
              <div className="p-4 space-y-3">
                <label className="block">
                  <span className="block text-xs font-semibold text-gray-700 mb-1">Subject</span>
                  <input value={subject} onChange={e => setSubject(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="block text-xs font-semibold text-gray-700 mb-1">Program summary <span className="font-normal text-gray-400">(optional — the brands, sizes and quantities in plain words)</span></span>
                  <textarea value={summary} onChange={e => setSummary(e.target.value)} rows={2} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" placeholder="Everything here is aqueous barrier coated — no PE liner on any item…" />
                </label>
                <label className="block">
                  <span className="block text-xs font-semibold text-gray-700 mb-1">Body <span className="font-normal text-gray-400">— {'{{contact}}'} and {'{{company}}'} merge per supplier</span></span>
                  <textarea value={body} onChange={e => setBody(e.target.value)} rows={10} className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs font-mono" />
                </label>
              </div>
              <div className="px-4 pb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-gray-700">Preview</span>
                  {chosen.length > 1 && (
                    <select value={previewFor ?? chosen[0]?.id ?? ''} onChange={e => setPreviewFor(e.target.value)} className="border border-gray-200 rounded px-2 py-1 text-xs">
                      {chosen.map(v => <option key={v.id} value={v.id}>{v.company_name}</option>)}
                    </select>
                  )}
                </div>
                <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 max-h-64 overflow-y-auto text-sm">
                  {previewVendor
                    ? <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                    : <div className="text-gray-400 text-xs">Select a supplier to see what they will receive.</div>}
                </div>
              </div>
            </div>
          </div>
        )}

        {!result && (
          <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
            <div className="text-xs text-gray-500">
              From erp@beyondgreenbiotech.com · replies go to rudyp@beyondgreenbiotech.com · rudy@beyondgreenbiotech.com is copied
              {noEmail.length > 0 && <span className="text-amber-600"> · {noEmail.length} selected supplier{noEmail.length === 1 ? ' has' : 's have'} no email and will be skipped</span>}
            </div>
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700">Cancel</button>
              <button onClick={send} disabled={sending || chosen.length === 0} className="px-5 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-50" style={{ background: GREEN }}>
                {sending ? 'Sending…' : `Send to ${chosen.filter(v => v.email).length || ''} supplier${chosen.filter(v => v.email).length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------- Manual quote entry (emailed replies) */

const inputCls = 'w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm'

function Field({ label, children, span2 }: { label: string; children: any; span2?: boolean }) {
  return (
    <label className={`block ${span2 ? 'sm:col-span-2' : ''}`}>
      <span className="block text-xs font-semibold text-gray-700 mb-1">{label}</span>
      {children}
    </label>
  )
}

export function RfqManualQuoteModal({
  send,
  existing,
  quotationId,
  currentUserEmail,
  onClose,
  onSaved,
}: {
  send: SendRow
  existing: Resp | null
  quotationId: string
  currentUserEmail: string
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createSupabaseBrowserClient()
  // Pre-minted so files can be attached before the quote is saved.
  const [responseId] = useState<string>(() => existing?.id || crypto.randomUUID())
  const [qlines, setQlines] = useState<QLine[]>([])
  const [prices, setPrices] = useState<Record<string, { unit_price: string; pcs_per_case: string; case_price: string; notes: string }>>({})
  const [f, setF] = useState({
    contact_name: existing?.contact_name || '',
    contact_email: existing?.contact_email || send.recipient_email || '',
    currency: existing?.currency || 'USD',
    incoterm: existing?.incoterm || '',
    payment_terms: existing?.payment_terms || '',
    lead_time_days: existing?.lead_time_days != null ? String(existing.lead_time_days) : '',
    moq_note: existing?.moq_note || '',
    validity_days: existing?.validity_days != null ? String(existing.validity_days) : '',
    plate_die_charges: existing?.plate_die_charges || '',
    overrun_tolerance: existing?.overrun_tolerance || '',
    certifications: existing?.certifications || '',
    sample_available: existing?.sample_available == null ? '' : existing.sample_available ? 'yes' : 'no',
    exclusions: existing?.exclusions || '',
    notes: existing?.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  // "Read their email" — paste the thread / drop what they sent, AI fills the form.
  const [emailText, setEmailText] = useState('')
  const [picked, setPicked] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [reading, setReading] = useState(false)
  const [aiNote, setAiNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [replaceTyped, setReplaceTyped] = useState(false)
  const [filesKey, setFilesKey] = useState(0)
  const [declinedHint, setDeclinedHint] = useState(false)
  const [savedOnce, setSavedOnce] = useState(false)
  const fState = f
  const pricesState = prices
  // Closing after an automatic save still refreshes the RFQ behind it.
  const close = () => (savedOnce ? onSaved() : onClose())
  const [dropMsg, setDropMsg] = useState('')

  // Files can be dropped anywhere on the window, pasted, or picked. Outlook often
  // drags an email as text/link rather than a file — catch that and say so.
  function takeTransfer(dt: DataTransfer | null) {
    if (!dt) return
    const files = Array.from(dt.files || [])
    if (files.length) {
      setDropMsg(`Attaching ${files.length} file${files.length === 1 ? '' : 's'} and reading them…`)
      readWithAI(files)
      return
    }
    const txt = dt.getData('text/plain') || ''
    if (txt.trim()) {
      setEmailText(t => (t.trim() ? t + '\n\n' : '') + txt)
      setDropMsg('Outlook sent text, not a file, so it went into the email box. For attachments, save them to your computer first, then drag them here.')
      return
    }
    setDropMsg('Nothing came through. Outlook can’t drag attachments straight into a browser — save them to your Desktop/Downloads first, then drag them in or use 📎 Add files.')
  }

  async function markDeclined() {
    const { error } = await supabase.rpc('rfq_set_selection', { p_send: send.id, p_selection: 'declined' })
    if (error) { setErr(error.message); return }
    setDeclinedHint(false)
    setAiNote({ ok: true, text: 'Marked ✖ RFQ rejected for this supplier. Save the quote to keep their notes.' })
  }

  async function readWithAI(newFiles?: File[]) {
    if (reading) { if (newFiles?.length) setPicked(p => [...p, ...newFiles]); return }
    setReading(true); setAiNote(null); setErr('')
    try {
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
      const safeVendor = (send.vendor_name || 'supplier').replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 40)
      const uploads: File[] = [...picked, ...(newFiles || [])]
      if (emailText.trim()) {
        uploads.unshift(new File([emailText], `email-${safeVendor}-${stamp}.txt`, { type: 'text/plain' }))
      }
      for (const file of uploads) {
        const r = await uploadFile(supabase, file, 'rfq_response', responseId, currentUserEmail)
        if (!r.success) throw new Error(`Could not attach ${file.name}: ${r.error}`)
      }
      if (uploads.length) { setPicked([]); setEmailText(''); setFilesKey(k => k + 1); setDropMsg('') }

      const res = await fetch('/api/rfq/extract-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responseId, quotationId, vendorName: send.vendor_name }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) throw new Error(j.error || 'Could not read the email/files.')
      const d = j.data || {}
      setDeclinedHint(d.supplier_declined === true && send.selection !== 'declined')
      const filled: string[] = []
      const str = (v: any) => (v === null || v === undefined || v === '' ? null : String(v))

      // Merge into the current form synchronously so we can save exactly what is shown.
      const prev: any = f
      const nextF: any = { ...prev }
      const keys = ['contact_name', 'contact_email', 'currency', 'incoterm', 'payment_terms', 'lead_time_days', 'moq_note',
        'validity_days', 'plate_die_charges', 'overrun_tolerance', 'certifications', 'exclusions'] as const
      keys.forEach(k => {
        const v = str(d[k]); if (v == null) return
        if (replaceTyped || !String(prev[k] ?? '').trim() || (k === 'currency' && prev[k] === 'USD')) {
          if (nextF[k] !== v) { nextF[k] = v; filled.push(k.replace(/_/g, ' ')) }
        }
      })
      if (d.sample_available === true || d.sample_available === false) {
        const v = d.sample_available ? 'yes' : 'no'
        if (replaceTyped || !prev.sample_available) { nextF.sample_available = v; filled.push('samples') }
      }
      const extra = [str(d.notes), Array.isArray(d.unmatched) && d.unmatched.length ? `Also quoted (not on our RFQ): ${d.unmatched.join('; ')}` : null]
        .filter(Boolean).join('\n')
      if (extra && !String(prev.notes || '').includes(extra)) {
        nextF.notes = prev.notes?.trim() ? `${prev.notes.trim()}\n\n— From their email (${new Date().toLocaleDateString()}) —\n${extra}` : extra
        filled.push('notes')
      }

      let linesFilled = 0
      const nextP: Record<string, any> = { ...prices }
      for (const l of (d.lines || []) as any[]) {
        const cur = nextP[l.quotation_line_id] || { unit_price: '', pcs_per_case: '', case_price: '', notes: '' }
        const row = { ...cur }
        let touched = false
        ;(['unit_price', 'pcs_per_case', 'case_price', 'notes'] as const).forEach(k => {
          const v = str(l[k]); if (v == null) return
          if (replaceTyped || !String(cur[k] ?? '').trim()) { row[k] = v; touched = true }
        })
        if (touched) { nextP[l.quotation_line_id] = row; linesFilled++ }
      }
      setF(nextF)
      setPrices(nextP)
      // Log it straight away — the quote is on the RFQ as soon as the AI has read it.
      const savedOk = await save({ f: nextF, prices: nextP, stayOpen: true })
      const nLines = linesFilled
      const parts = [
        nLines ? `${nLines} line price${nLines === 1 ? '' : 's'}` : null,
        filled.length ? filled.join(', ') : null,
      ].filter(Boolean)
      setAiNote({
        ok: true,
        text: (parts.length ? `Filled in: ${parts.join(' · ')}.` : 'Read it, but found nothing new to fill in.')
          + ` Read ${j.read?.length || 0} file${j.read?.length === 1 ? '' : 's'}.`
          + (j.skipped?.length ? ` Skipped: ${j.skipped.join(', ')}.` : '')
          + (savedOk ? ' ✓ Saved to the RFQ. Edit anything below and press Save changes if needed.' : ' Could not save automatically — check the fields and press Save quote.'),
      })
    } catch (e: any) {
      setAiNote({ ok: false, text: e?.message || 'Could not read the email/files.' })
    } finally {
      setReading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    supabase
      .from('quotation_lines')
      .select('id, sku, product_name, description, quantity, line_number')
      .eq('quotation_id', quotationId)
      .order('line_number', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .then(({ data }: any) => {
        if (cancelled) return
        const rows = (data ?? []) as QLine[]
        setQlines(rows)
        const init: Record<string, any> = {}
        rows.forEach(l => {
          const prev = (existing?.rfq_response_lines ?? []).find((x: any) => x.quotation_line_id === l.id)
          init[l.id] = {
            unit_price: prev?.unit_price != null ? String(prev.unit_price) : '',
            pcs_per_case: prev?.pcs_per_case != null ? String(prev.pcs_per_case) : '',
            case_price: prev?.case_price != null ? String(prev.case_price) : '',
            notes: prev?.notes || '',
          }
        })
        setPrices(init)
      })
    return () => { cancelled = true }
  }, [supabase, quotationId, existing])

  const set = (k: keyof typeof f) => (e: any) => setF(p => ({ ...p, [k]: e.target.value }))
  const setLine = (id: string, k: string, v: string) =>
    setPrices(p => ({ ...p, [id]: { ...p[id], [k]: v } }))

  const num = (v: string) => (v.trim() === '' || isNaN(Number(v)) ? null : Number(v))

  async function save(opts?: { f?: typeof f; prices?: typeof prices; stayOpen?: boolean }): Promise<boolean> {
    const f = opts?.f ?? fState
    const prices = opts?.prices ?? pricesState
    setSaving(true); setErr('')
    try {
      // Anything picked or pasted but not yet attached is saved with the quote.
      const pending: File[] = [...picked]
      if (emailText.trim()) {
        const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
        const safeVendor = (send.vendor_name || 'supplier').replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 40)
        pending.unshift(new File([emailText], `email-${safeVendor}-${stamp}.txt`, { type: 'text/plain' }))
      }
      for (const file of pending) {
        const r = await uploadFile(supabase, file, 'rfq_response', responseId, currentUserEmail)
        if (!r.success) throw new Error(`Could not attach ${file.name}: ${r.error}`)
      }
      if (pending.length) { setPicked([]); setEmailText(''); setFilesKey(k => k + 1) }
      const lineRows = qlines.map((l, i) => {
        const pr = prices[l.id] || { unit_price: '', pcs_per_case: '', case_price: '', notes: '' }
        const unit = num(pr.unit_price)
        const qty = l.quantity != null ? Number(l.quantity) : null
        return {
          response_id: responseId,
          quotation_line_id: l.id,
          sku: l.sku,
          description: l.product_name || l.description || null,
          quantity: qty,
          unit_price: unit,
          pcs_per_case: num(pr.pcs_per_case),
          case_price: num(pr.case_price),
          line_total: unit != null && qty ? unit * qty : null,
          notes: pr.notes.trim() || null,
          sort_order: i,
        }
      }).filter(r => r.unit_price != null || r.case_price != null || r.notes)

      const total = lineRows.reduce((sum, r) => sum + (r.line_total || 0), 0)

      const payload: any = {
        contact_name: f.contact_name.trim() || null,
        contact_email: f.contact_email.trim() || null,
        currency: f.currency.trim() || 'USD',
        incoterm: f.incoterm.trim() || null,
        payment_terms: f.payment_terms.trim() || null,
        lead_time_days: num(f.lead_time_days),
        moq_note: f.moq_note.trim() || null,
        validity_days: num(f.validity_days),
        plate_die_charges: f.plate_die_charges.trim() || null,
        overrun_tolerance: f.overrun_tolerance.trim() || null,
        certifications: f.certifications.trim() || null,
        sample_available: f.sample_available === '' ? null : f.sample_available === 'yes',
        exclusions: f.exclusions.trim() || null,
        notes: f.notes.trim() || null,
        total_value: total || null,
      }

      if (existing || savedOnce) {
        const { error } = await supabase.from('rfq_vendor_responses').update(payload).eq('id', responseId)
        if (error) throw error
        const { error: delErr } = await supabase.from('rfq_response_lines').delete().eq('response_id', responseId)
        if (delErr) throw delErr
      } else {
        const { error } = await supabase.from('rfq_vendor_responses').insert({
          ...payload,
          id: responseId,
          rfq_send_id: send.id,
          quotation_id: quotationId,
          vendor_id: send.vendor_id,
          vendor_name: send.vendor_name,
          method: 'email',
        })
        if (error) throw error
      }

      if (lineRows.length) {
        const { error } = await supabase.from('rfq_response_lines').insert(lineRows)
        if (error) throw error
      }

      if (send.status !== 'Responded') {
        await supabase.from('rfq_sends')
          .update({ status: 'Responded', responded_at: new Date().toISOString() })
          .eq('id', send.id)
      }
      setSavedOnce(true)
      if (!opts?.stayOpen) onSaved()
      return true
    } catch (e: any) {
      setErr(e?.message || 'Could not save the quote.')
      return false
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDragOver(false) }}
      onDrop={e => { e.preventDefault(); setDragOver(false); takeTransfer(e.dataTransfer) }}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{existing ? 'Edit' : 'Enter'} quote — {send.vendor_name}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {existing
                ? `Logged ${existing.method === 'portal' ? 'from their form' : 'by hand'} · edits replace what is shown on the RFQ`
                : 'Type in what they sent by email and attach their files. It shows up in the comparison table like a form response.'}
            </p>
          </div>
          <button onClick={close} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <section
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); e.stopPropagation(); setDragOver(false); takeTransfer(e.dataTransfer) }}
            className={`rounded-lg border-2 border-dashed p-4 ${dragOver ? 'border-emerald-500 bg-emerald-50' : 'border-emerald-200 bg-emerald-50/40'}`}
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wide" style={{ color: DEEP }}>✨ Read their email &amp; files</h3>
                <p className="text-[11px] text-gray-500 mt-0.5">Paste the email thread and/or drop what they sent (PDF, Excel, photos, .eml or .msg). A copy is saved to this quote and the form below fills itself in.</p>
              </div>
            </div>
            <textarea
              rows={4}
              value={emailText}
              onChange={e => setEmailText(e.target.value)}
              onPaste={e => { if (e.clipboardData?.files?.length) { e.preventDefault(); takeTransfer(e.clipboardData) } }}
              onDrop={e => { if (e.dataTransfer?.files?.length) { e.preventDefault(); e.stopPropagation(); setDragOver(false); takeTransfer(e.dataTransfer) } }}
              placeholder="Paste the whole email thread here (Ctrl/Cmd+A, Ctrl/Cmd+C in the email, then paste)"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <label className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-xs font-medium text-gray-700 cursor-pointer hover:bg-gray-50">
                📎 Add files
                <input
                  type="file"
                  multiple
                  accept=".pdf,.xlsx,.xls,.xlsm,.csv,.tsv,.png,.jpg,.jpeg,.webp,.gif,.eml,.msg,.txt,.html,.htm"
                  className="hidden"
                  onChange={e => { const arr = Array.from(e.target.files || []); e.target.value = ''; if (arr.length) readWithAI(arr) }}
                />
              </label>
              {picked.map((p, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-[11px] bg-white border border-gray-200 rounded-full px-2 py-0.5">
                  {p.name}
                  <button type="button" onClick={() => setPicked(x => x.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600">×</button>
                </span>
              ))}
              <div className="flex-1" />
              <label className="flex items-center gap-1 text-[11px] text-gray-500">
                <input type="checkbox" checked={replaceTyped} onChange={e => setReplaceTyped(e.target.checked)} />
                Overwrite what&apos;s already typed
              </label>
              <button
                type="button"
                onClick={() => readWithAI()}
                disabled={reading}
                className="px-4 py-1.5 rounded-lg text-white text-xs font-semibold disabled:opacity-50"
                style={{ background: GREEN }}
              >
                {reading ? 'Reading…' : (emailText.trim() || picked.length) ? 'Attach & fill in' : 'Fill in from attached files'}
              </button>
            </div>
            {dropMsg && <div className="mt-2 text-[12px] text-gray-600">{dropMsg}</div>}
            {declinedHint && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] rounded-md px-3 py-2 bg-red-50 text-red-700 border border-red-200">
                It looks like {send.vendor_name} said no to this RFQ.
                <button type="button" onClick={markDeclined} className="px-2.5 py-1 rounded-md bg-red-600 text-white font-semibold">✖ Mark RFQ rejected</button>
              </div>
            )}
            {aiNote && (
              <div className={`mt-2 text-[12px] rounded-md px-3 py-2 ${aiNote.ok ? 'bg-white text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                {aiNote.text}
              </div>
            )}
          </section>

          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">Item pricing</h3>
            {qlines.length === 0 ? (
              <p className="text-xs text-gray-400">This RFQ has no line items yet. You can still log terms and attach files below.</p>
            ) : (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                {qlines.map(l => (
                  <div key={l.id} className="px-3 py-3 border-b border-gray-100 last:border-0">
                    <div className="text-sm font-medium text-gray-900">{l.product_name || l.description || l.sku}</div>
                    <div className="text-[11px] text-gray-400 mb-2">{l.sku ? `${l.sku} · ` : ''}Qty {l.quantity ?? '—'}</div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <input inputMode="decimal" placeholder={`Unit price (${f.currency || 'USD'})`} value={prices[l.id]?.unit_price ?? ''} onChange={e => setLine(l.id, 'unit_price', e.target.value)} className={inputCls} />
                      <input inputMode="numeric" placeholder="Pcs / case" value={prices[l.id]?.pcs_per_case ?? ''} onChange={e => setLine(l.id, 'pcs_per_case', e.target.value)} className={inputCls} />
                      <input inputMode="decimal" placeholder="Case price" value={prices[l.id]?.case_price ?? ''} onChange={e => setLine(l.id, 'case_price', e.target.value)} className={inputCls} />
                      <input placeholder="Line note" value={prices[l.id]?.notes ?? ''} onChange={e => setLine(l.id, 'notes', e.target.value)} className={inputCls} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">Terms</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Contact name"><input value={f.contact_name} onChange={set('contact_name')} className={inputCls} /></Field>
              <Field label="Contact email"><input value={f.contact_email} onChange={set('contact_email')} className={inputCls} /></Field>
              <Field label="Currency"><input value={f.currency} onChange={set('currency')} className={inputCls} /></Field>
              <Field label="Incoterm"><input value={f.incoterm} onChange={set('incoterm')} placeholder="FOB, DDP, EXW…" className={inputCls} /></Field>
              <Field label="Lead time (days)"><input inputMode="numeric" value={f.lead_time_days} onChange={set('lead_time_days')} className={inputCls} /></Field>
              <Field label="Quote valid (days)"><input inputMode="numeric" value={f.validity_days} onChange={set('validity_days')} className={inputCls} /></Field>
              <Field label="MOQ"><input value={f.moq_note} onChange={set('moq_note')} className={inputCls} /></Field>
              <Field label="Payment terms"><input value={f.payment_terms} onChange={set('payment_terms')} className={inputCls} /></Field>
              <Field label="Plate / die charges"><input value={f.plate_die_charges} onChange={set('plate_die_charges')} className={inputCls} /></Field>
              <Field label="Over / under run"><input value={f.overrun_tolerance} onChange={set('overrun_tolerance')} className={inputCls} /></Field>
              <Field label="Certifications"><input value={f.certifications} onChange={set('certifications')} className={inputCls} /></Field>
              <Field label="Samples available">
                <select value={f.sample_available} onChange={set('sample_available')} className={inputCls}>
                  <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
                </select>
              </Field>
              <Field label="Exclusions" span2><textarea rows={2} value={f.exclusions} onChange={set('exclusions')} className={inputCls} /></Field>
              <Field label="Notes" span2><textarea rows={3} value={f.notes} onChange={set('notes')} placeholder="Anything else from their email" className={inputCls} /></Field>
            </div>
          </section>

          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">Files from {send.vendor_name}</h3>
            <p className="text-[11px] text-gray-400 mb-2">Quote sheets, PDFs, proofs, certificates and saved email copies. Files added here are read too when you press “Fill in from attached files”.</p>
            <FileUpload key={filesKey} supabase={supabase} recordType="rfq_response" recordId={responseId} currentUserEmail={currentUserEmail} />
          </section>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
          <div className="text-xs text-red-600">{err}</div>
          <div className="flex gap-2">
            <button onClick={close} className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700">Cancel</button>
            <button onClick={() => save()} disabled={saving} className="px-5 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-50" style={{ background: GREEN }}>
              {saving ? 'Saving…' : existing || savedOnce ? 'Save changes' : 'Save quote'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------- Sends + responses, in-panel */

export function RfqResponses({ quotationId, refreshKey, currentUserEmail = '' }: { quotationId: string; refreshKey: number; currentUserEmail?: string }) {
  const supabase = createSupabaseBrowserClient()
  const [sends, setSends] = useState<SendRow[]>([])
  const [responses, setResponses] = useState<Resp[]>([])
  const [files, setFiles] = useState<RespFile[]>([])
  const [loading, setLoading] = useState(true)
  const [entering, setEntering] = useState<SendRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: s }, { data: r }] = await Promise.all([
      supabase.from('rfq_sends')
        .select('id, vendor_id, vendor_name, recipient_email, status, sent_at, opened_at, responded_at, error, selection, selected_at, selected_by')
        .eq('quotation_id', quotationId).order('sent_at', { ascending: false }),
      supabase.from('rfq_vendor_responses')
        .select('*, rfq_response_lines(*)')
        .eq('quotation_id', quotationId).order('submitted_at', { ascending: false }),
    ])
    const resp = (r ?? []) as Resp[]
    setSends((s ?? []) as SendRow[])
    setResponses(resp)
    if (resp.length) {
      const { data: fl } = await supabase
        .from('file_attachments')
        .select('id, record_id, file_name, file_size, storage_path')
        .eq('record_type', 'rfq_response')
        .in('record_id', resp.map(x => x.id))
        .order('created_at')
      setFiles((fl ?? []) as RespFile[])
    } else {
      setFiles([])
    }
    setLoading(false)
  }, [supabase, quotationId])

  useEffect(() => { if (quotationId) load() }, [quotationId, refreshKey, load])

  if (loading) return <div className="text-xs text-gray-400 py-4">Loading supplier activity…</div>
  if (sends.length === 0) return <div className="text-xs text-gray-400 py-4">No suppliers contacted on this RFQ yet.</div>

  const statusColor = (s: string) =>
    s === 'Responded' ? { bg: '#E7F2EA', text: DEEP }
    : s === 'Opened' ? { bg: '#EFF6FF', text: '#2563EB' }
    : s === 'Failed' ? { bg: '#FEF2F2', text: '#DC2626' }
    : { bg: '#F3F4F6', text: '#6B7280' }

  // One row per item across every responding supplier, for a like-for-like read.
  const items = Array.from(new Set(responses.flatMap(r => (r.rfq_response_lines ?? []).map(l => l.description || l.sku || '')))).filter(Boolean)

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500">Suppliers contacted <span className="normal-case font-normal text-gray-400">— click a name to enter a quote they emailed</span></h4>
          <button onClick={load} className="text-[11px] text-emerald-700 hover:underline">Refresh</button>
        </div>
        {selectionGroups(sends).length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {selectionGroups(sends).map(g => {
              const m = SELECTION_META[g.kind]
              return (
                <div key={g.kind} className="rounded-lg px-3 py-1.5 text-sm font-semibold border" style={{ background: m.bg, color: m.text, borderColor: m.text + '33' }}>
                  {m.icon} {selectionVerb(g.kind)} {g.names.join(', ')}
                </div>
              )
            })}
          </div>
        )}
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          {sends.map(s => {
            const c = statusColor(s.status)
            const logged = responses.find(r => r.rfq_send_id === s.id) || responses.find(r => !!r.vendor_id && r.vendor_id === s.vendor_id)
            return (
              <div key={s.id} className={`flex items-center justify-between gap-2 px-3 py-2 text-sm border-b border-gray-100 last:border-0 ${selectionRow(s.selection)}`}>
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => setEntering(s)}
                    title="Enter or edit this supplier's quote"
                    className="font-medium text-gray-900 truncate text-left hover:text-emerald-700 hover:underline"
                  >
                    {s.vendor_name}
                  </button>
                  <div className="text-[11px] text-gray-400 truncate">{s.recipient_email} · sent {new Date(s.sent_at).toLocaleDateString()}</div>
                  {s.error && <div className="text-[11px] text-red-600">{s.error}</div>}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
                  <SelectionBadge selection={s.selection} at={s.selected_at} by={s.selected_by} />
                  <SelectionPicker send={s} onChanged={load} />
                  <button type="button" onClick={() => setEntering(s)} className="text-[11px] text-emerald-700 hover:underline">
                    {logged ? 'Edit quote' : 'Enter quote'}
                  </button>
                  {s.selection === 'declined' ? null : logged ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white" style={{ background: GREEN }}
                      title={logged.submitted_at ? `Quote logged ${new Date(logged.submitted_at).toLocaleString()}` : 'Quote logged'}>
                      ✓ Completed{logged.submitted_at ? ` · ${new Date(logged.submitted_at).toLocaleDateString()}` : ''}
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: c.bg, color: c.text }}>{s.status === 'Sent' ? 'Waiting' : s.status}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {responses.length > 0 && (
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">Quotes received ({responses.length})</h4>
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: DEEP }} className="text-white text-xs">
                  <th className="text-left px-3 py-2 font-semibold sticky left-0" style={{ background: DEEP }}>Item</th>
                  {responses.map(r => {
                    const sel = sends.find(x => x.id === r.rfq_send_id)?.selection
                    return <th key={r.id} className="text-right px-3 py-2 font-semibold whitespace-nowrap">{isSel(sel) ? SELECTION_META[sel].icon + ' ' : ''}{r.vendor_name}</th>
                  })}
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item} className="border-b border-gray-100">
                    <td className="px-3 py-2 font-medium text-gray-800 sticky left-0 bg-white">{item}</td>
                    {responses.map(r => {
                      const l = (r.rfq_response_lines ?? []).find(x => (x.description || x.sku || '') === item)
                      return <td key={r.id} className="px-3 py-2 text-right tabular-nums">{l?.unit_price != null ? money(l.unit_price, r.currency || 'USD') : '—'}</td>
                    })}
                  </tr>
                ))}
                {[
                  ['Incoterm', (r: Resp) => r.incoterm || '—'],
                  ['Lead time', (r: Resp) => r.lead_time_days ? `${r.lead_time_days} days` : '—'],
                  ['MOQ', (r: Resp) => r.moq_note || '—'],
                  ['Payment terms', (r: Resp) => r.payment_terms || '—'],
                  ['Plate / die', (r: Resp) => r.plate_die_charges || '—'],
                  ['Over / under run', (r: Resp) => r.overrun_tolerance || '—'],
                  ['Certifications', (r: Resp) => r.certifications || '—'],
                  ['Samples', (r: Resp) => r.sample_available == null ? '—' : r.sample_available ? 'Yes' : 'No'],
                  ['Quote valid', (r: Resp) => r.validity_days ? `${r.validity_days} days` : '—'],
                ].map(([label, fn]) => (
                  <tr key={label as string} className="border-b border-gray-100 bg-gray-50/50">
                    <td className="px-3 py-2 text-gray-500 sticky left-0 bg-gray-50">{label as string}</td>
                    {responses.map(r => <td key={r.id} className="px-3 py-2 text-right text-gray-700">{(fn as (r: Resp) => string)(r)}</td>)}
                  </tr>
                ))}
                <tr className="border-t-2" style={{ borderColor: GREEN }}>
                  <td className="px-3 py-2 font-bold sticky left-0 bg-white">Indicative total</td>
                  {responses.map(r => <td key={r.id} className="px-3 py-2 text-right font-bold tabular-nums">{money(r.total_value, r.currency || 'USD')}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
          {files.length > 0 && (
            <div className="mt-3 space-y-2">
              {responses.filter(r => files.some(x => x.record_id === r.id)).map(r => (
                <div key={r.id} className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  <span className="font-semibold text-gray-800">{r.vendor_name}</span>
                  <span className="text-gray-400"> · files{r.method === 'email' ? ' (received by email)' : ''}</span>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                    {files.filter(x => x.record_id === r.id).map(x => (
                      <button key={x.id} type="button" onClick={() => downloadFile(supabase, x.storage_path, x.file_name)} className="text-emerald-700 hover:underline">
                        {x.file_name}{x.file_size ? ` (${formatFileSize(x.file_size)})` : ''}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {responses.some(r => r.exclusions || r.notes) && (
            <div className="mt-3 space-y-2">
              {responses.filter(r => r.exclusions || r.notes).map(r => (
                <div key={r.id} className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  <span className="font-semibold text-gray-800">{r.vendor_name}</span>
                  {r.exclusions && <div className="text-gray-600 mt-0.5"><span className="text-gray-400">Exclusions: </span>{r.exclusions}</div>}
                  {r.notes && <div className="text-gray-600 mt-0.5">{r.notes}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {entering && (
        <RfqManualQuoteModal
          send={entering}
          existing={
            responses.find(r => r.rfq_send_id === entering.id) ||
            responses.find(r => r.vendor_id && r.vendor_id === entering.vendor_id) ||
            null
          }
          quotationId={quotationId}
          currentUserEmail={currentUserEmail}
          onClose={() => setEntering(null)}
          onSaved={() => { setEntering(null); load() }}
        />
      )}
    </div>
  )
}
