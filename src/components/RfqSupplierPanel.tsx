'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { generateRFQPDF, type PDFLine } from '@/lib/pdfHelpers'

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

interface SendRow {
  id: string
  vendor_id: string | null
  vendor_name: string
  recipient_email: string
  status: string
  sent_at: string
  opened_at: string | null
  responded_at: string | null
  error: string | null
}

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

interface Resp {
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
  rfq_response_lines?: RespLine[]
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
  <li>Print registration tolerance on any multi-colour print</li>
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

/* ------------------------------------------------- Sends + responses, in-panel */

export function RfqResponses({ quotationId, refreshKey }: { quotationId: string; refreshKey: number }) {
  const supabase = createSupabaseBrowserClient()
  const [sends, setSends] = useState<SendRow[]>([])
  const [responses, setResponses] = useState<Resp[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: s }, { data: r }] = await Promise.all([
      supabase.from('rfq_sends')
        .select('id, vendor_id, vendor_name, recipient_email, status, sent_at, opened_at, responded_at, error')
        .eq('quotation_id', quotationId).order('sent_at', { ascending: false }),
      supabase.from('rfq_vendor_responses')
        .select('*, rfq_response_lines(*)')
        .eq('quotation_id', quotationId).order('submitted_at', { ascending: false }),
    ])
    setSends((s ?? []) as SendRow[])
    setResponses((r ?? []) as Resp[])
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
          <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500">Suppliers contacted</h4>
          <button onClick={load} className="text-[11px] text-emerald-700 hover:underline">Refresh</button>
        </div>
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          {sends.map(s => {
            const c = statusColor(s.status)
            return (
              <div key={s.id} className="flex items-center justify-between px-3 py-2 text-sm border-b border-gray-100 last:border-0">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 truncate">{s.vendor_name}</div>
                  <div className="text-[11px] text-gray-400 truncate">{s.recipient_email} · sent {new Date(s.sent_at).toLocaleDateString()}</div>
                  {s.error && <div className="text-[11px] text-red-600">{s.error}</div>}
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: c.bg, color: c.text }}>{s.status}</span>
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
                  {responses.map(r => <th key={r.id} className="text-right px-3 py-2 font-semibold whitespace-nowrap">{r.vendor_name}</th>)}
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
    </div>
  )
}
