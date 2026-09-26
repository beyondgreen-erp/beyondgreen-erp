'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface RfqLine {
  id: string
  sku: string | null
  description: string
  quantity: number | null
}

interface ArtFile {
  id: string
  name: string
  size: number | null
  type: string | null
  url: string
}

interface RfqData {
  rfq_number: string
  rfq_date: string | null
  due_date: string | null
  notes: string | null
  price_term: string | null
  payment_terms: string | null
  deliver_to: string | null
  vendor_name: string
  contact_name: string | null
  contact_email: string | null
  already_responded: boolean
  art_files?: ArtFile[]
  lines: RfqLine[]
}

function fileSize(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return Math.round(bytes / 1024) + ' KB'
  return (bytes / 1048576).toFixed(1) + ' MB'
}

const GREEN = '#1F9A3A'
const DEEP = '#14532D'

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-gray-700 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-gray-400 mt-1">{hint}</span>}
    </label>
  )
}

const inputCls =
  'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500'

export default function SupplierRfqPage() {
  const params = useParams()
  const token = params?.token as string

  const [data, setData] = useState<RfqData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const [form, setForm] = useState({
    contact_name: '',
    contact_email: '',
    currency: 'USD',
    incoterm: 'DDP',
    payment_terms: '',
    lead_time_days: '',
    moq_note: '',
    validity_days: '',
    plate_die_charges: '',
    overrun_tolerance: '',
    exclusions: '',
    certifications: '',
    sample_available: false,
    notes: '',
  })
  const [prices, setPrices] = useState<Record<string, { unit_price: string; pcs_per_case: string; case_price: string; notes: string }>>({})

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/rfq/vendor-response/${token}`)
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'This link is not valid.')
        return
      }
      setData(json)
      setForm(f => ({ ...f, contact_name: json.contact_name || '', contact_email: json.contact_email || '' }))
      const seeded: Record<string, any> = {}
      for (const l of json.lines || []) seeded[l.id] = { unit_price: '', pcs_per_case: '', case_price: '', notes: '' }
      setPrices(seeded)
    } catch {
      setError('We could not load this RFQ. Please try again in a moment.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { if (token) load() }, [token, load])

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))
  const setPrice = (id: string, k: string, v: string) =>
    setPrices(p => ({ ...p, [id]: { ...p[id], [k]: v } }))

  const total = (data?.lines ?? []).reduce((sum, l) => {
    const up = parseFloat(prices[l.id]?.unit_price || '')
    return sum + (isFinite(up) ? up * (Number(l.quantity) || 0) : 0)
  }, 0)

  async function submit() {
    if (!data) return
    if (!form.contact_name.trim()) { alert('Please tell us who we are speaking with.'); return }
    const priced = (data.lines || []).filter(l => parseFloat(prices[l.id]?.unit_price || '') > 0)
    if (priced.length === 0) { alert('Please enter a unit price for at least one item.'); return }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/rfq/vendor-response/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          lead_time_days: form.lead_time_days ? parseInt(form.lead_time_days, 10) : null,
          validity_days: form.validity_days ? parseInt(form.validity_days, 10) : null,
          lines: (data.lines || []).map(l => ({
            quotation_line_id: l.id,
            sku: l.sku,
            description: l.description,
            quantity: l.quantity,
            unit_price: parseFloat(prices[l.id]?.unit_price || '') || null,
            pcs_per_case: parseInt(prices[l.id]?.pcs_per_case || '', 10) || null,
            case_price: parseFloat(prices[l.id]?.case_price || '') || null,
            notes: prices[l.id]?.notes || null,
          })),
        }),
      })
      const json = await res.json()
      if (!res.ok) { alert(json.error || 'Something went wrong. Please try again.'); return }
      setSubmitted(true)
    } catch {
      alert('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500 text-sm">Loading…</div>
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-10 max-w-md text-center">
          <h1 className="text-lg font-semibold text-gray-900 mb-2">We could not open this RFQ</h1>
          <p className="text-sm text-gray-500">{error}</p>
          <p className="text-sm text-gray-500 mt-4">
            Email <a className="text-emerald-700 underline" href="mailto:rudyp@beyondgreenbiotech.com">rudyp@beyondgreenbiotech.com</a> and we will send a fresh link.
          </p>
        </div>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-10 max-w-md text-center">
          <div className="w-12 h-12 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: '#E7F2EA' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          </div>
          <h1 className="text-lg font-semibold text-gray-900 mb-2">Thank you — we have your quote</h1>
          <p className="text-sm text-gray-500">
            It is logged against {data?.rfq_number}. We will come back to you shortly, and we may ask for samples or a certificate copy.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <div style={{ background: DEEP }} className="px-6 py-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-white/70 text-xs tracking-widest uppercase">beyondGREEN biotech</div>
          <h1 className="text-white text-2xl font-bold mt-1">Request for Quotation — {data?.rfq_number}</h1>
          <p className="text-white/70 text-sm mt-1">For {data?.vendor_name}</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mt-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><div className="text-[11px] text-gray-400 uppercase tracking-wide">RFQ</div><div className="font-semibold">{data?.rfq_number}</div></div>
            <div><div className="text-[11px] text-gray-400 uppercase tracking-wide">Issued</div><div className="font-semibold">{data?.rfq_date || '—'}</div></div>
            <div><div className="text-[11px] text-gray-400 uppercase tracking-wide">Quote by</div><div className="font-semibold">{data?.due_date || 'At your earliest'}</div></div>
            <div><div className="text-[11px] text-gray-400 uppercase tracking-wide">Price term</div><div className="font-semibold">{data?.price_term || 'DDP preferred'}</div></div>
          </div>
          {data?.deliver_to && (
            <div className="mt-4 pt-4 border-t border-gray-100 text-sm">
              <div className="text-[11px] text-gray-400 uppercase tracking-wide mb-1">Deliver to</div>
              <div className="text-gray-700 whitespace-pre-line">{data.deliver_to}</div>
            </div>
          )}
          {data?.notes && (
            <div className="mt-4 pt-4 border-t border-gray-100 text-sm">
              <div className="text-[11px] text-gray-400 uppercase tracking-wide mb-1">Specification notes</div>
              <div className="text-gray-700 whitespace-pre-line">{data.notes}</div>
            </div>
          )}
        </div>

        {!!data?.art_files?.length && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mt-6">
            <h2 className="font-semibold text-gray-900 mb-1">Artwork and dielines</h2>
            <p className="text-xs text-gray-500 mb-4">
              Quote against these files. If anything is unreadable or you need a different format, say so in
              &ldquo;Anything else&rdquo; below and we will resend it.
            </p>
            <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
              {data.art_files.map(f => (
                <li key={f.id} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{f.name}</div>
                    {!!f.size && <div className="text-[11px] text-gray-400">{fileSize(f.size)}</div>}
                  </div>
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-md text-white"
                    style={{ background: GREEN }}
                  >
                    Download
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {data?.already_responded && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            We already have a quote from you on this RFQ. Submitting again will add a revised quote — your earlier one is kept.
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mt-6">
          <h2 className="font-semibold text-gray-900 mb-1">Your pricing</h2>
          <p className="text-xs text-gray-500 mb-4">Unit price per piece in your quoted currency. Leave a line blank if you cannot make it.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: DEEP }} className="text-white text-xs">
                  <th className="text-left px-3 py-2 font-semibold">Item</th>
                  <th className="text-right px-3 py-2 font-semibold w-24">Qty</th>
                  <th className="text-right px-3 py-2 font-semibold w-32">Unit price</th>
                  <th className="text-right px-3 py-2 font-semibold w-28">Pcs / case</th>
                  <th className="text-right px-3 py-2 font-semibold w-32">Case price</th>
                  <th className="text-left px-3 py-2 font-semibold w-48">Notes</th>
                </tr>
              </thead>
              <tbody>
                {(data?.lines ?? []).map(l => (
                  <tr key={l.id} className="border-b border-gray-100">
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-900">{l.description}</div>
                      {l.sku && <div className="text-[11px] text-gray-400">{l.sku}</div>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{Number(l.quantity || 0).toLocaleString()}</td>
                    <td className="px-2 py-2"><input className={inputCls + ' text-right'} inputMode="decimal" placeholder="0.0000" value={prices[l.id]?.unit_price ?? ''} onChange={e => setPrice(l.id, 'unit_price', e.target.value)} /></td>
                    <td className="px-2 py-2"><input className={inputCls + ' text-right'} inputMode="numeric" placeholder="—" value={prices[l.id]?.pcs_per_case ?? ''} onChange={e => setPrice(l.id, 'pcs_per_case', e.target.value)} /></td>
                    <td className="px-2 py-2"><input className={inputCls + ' text-right'} inputMode="decimal" placeholder="—" value={prices[l.id]?.case_price ?? ''} onChange={e => setPrice(l.id, 'case_price', e.target.value)} /></td>
                    <td className="px-2 py-2"><input className={inputCls} placeholder="optional" value={prices[l.id]?.notes ?? ''} onChange={e => setPrice(l.id, 'notes', e.target.value)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > 0 && (
            <div className="flex justify-end mt-4 text-sm">
              <div className="bg-emerald-50 border border-emerald-100 rounded-lg px-4 py-2">
                <span className="text-gray-500 mr-3">Indicative total</span>
                <span className="font-bold text-gray-900 tabular-nums">{form.currency} {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mt-6">
          <h2 className="font-semibold text-gray-900 mb-4">Commercial terms</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Your name"><input className={inputCls} value={form.contact_name} onChange={e => set('contact_name', e.target.value)} /></Field>
            <Field label="Your email"><input className={inputCls} value={form.contact_email} onChange={e => set('contact_email', e.target.value)} /></Field>
            <Field label="Currency">
              <select className={inputCls} value={form.currency} onChange={e => set('currency', e.target.value)}>
                {['USD', 'CNY', 'EUR'].map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Incoterm" hint="DDP preferred, delivered to Santa Ana">
              <select className={inputCls} value={form.incoterm} onChange={e => set('incoterm', e.target.value)}>
                {['DDP', 'DAP', 'CIF', 'FOB', 'EXW'].map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Lead time (days)" hint="From artwork and PO approval to delivery"><input className={inputCls} inputMode="numeric" value={form.lead_time_days} onChange={e => set('lead_time_days', e.target.value)} /></Field>
            <Field label="Payment terms"><input className={inputCls} placeholder="e.g. 30% deposit, balance against BL copy" value={form.payment_terms} onChange={e => set('payment_terms', e.target.value)} /></Field>
            <Field label="MOQ" hint="Per size, if different from what we asked for"><input className={inputCls} value={form.moq_note} onChange={e => set('moq_note', e.target.value)} /></Field>
            <Field label="Quote valid for (days)"><input className={inputCls} inputMode="numeric" value={form.validity_days} onChange={e => set('validity_days', e.target.value)} /></Field>
            <Field label="Plate / die charges"><input className={inputCls} placeholder="one-off tooling or plate cost" value={form.plate_die_charges} onChange={e => set('plate_die_charges', e.target.value)} /></Field>
            <Field label="Overrun / underrun tolerance"><input className={inputCls} placeholder="e.g. +/- 10%" value={form.overrun_tolerance} onChange={e => set('overrun_tolerance', e.target.value)} /></Field>
            <div className="md:col-span-2">
              <Field label="Certifications you hold" hint="Food contact and compostability — BPI, TÜV OK compost, DIN CERTCO, FSC, FDA, BRC">
                <input className={inputCls} value={form.certifications} onChange={e => set('certifications', e.target.value)} />
              </Field>
            </div>
            <div className="md:col-span-3">
              <Field label="Assumptions and exclusions" hint="Duties, freight surcharges, anything not in the price">
                <textarea className={inputCls} rows={2} value={form.exclusions} onChange={e => set('exclusions', e.target.value)} />
              </Field>
            </div>
            <div className="md:col-span-3">
              <Field label="Anything else">
                <textarea className={inputCls} rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} />
              </Field>
            </div>
            <div className="md:col-span-3">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" className="rounded border-gray-300" checked={form.sample_available} onChange={e => set('sample_available', e.target.checked)} />
                We can send samples before the full run
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between mt-6 pt-5 border-t border-gray-100">
            <p className="text-xs text-gray-400">Your quote goes directly to our sourcing team. Nothing here is shared with other suppliers.</p>
            <button
              onClick={submit}
              disabled={submitting}
              className="px-6 py-2.5 rounded-lg text-white text-sm font-semibold disabled:opacity-50"
              style={{ background: GREEN }}
            >
              {submitting ? 'Sending…' : 'Submit quote'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
