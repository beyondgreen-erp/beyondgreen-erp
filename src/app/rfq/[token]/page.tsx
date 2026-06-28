'use client'

import { useEffect, useState, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface RfqToken {
  id: string
  quote_costing_id: string
  token: string
  recipient_name: string
  expires_at: string
  is_expired: boolean
}

interface QuoteLine {
  id: string
  line_number: number
  description: string
  product_type: string
  specs: string
  uom: string
  moq_qty: number
  order_qty: number
  packing_per_case: number
  exw_cost_per_case: number
  freight_cost_per_case: number
  packaging_cost_per_case: number
  other_cost_1_label: string
  other_cost_1_amount: number
  other_cost_2_label: string
  other_cost_2_amount: number
  other_cost_3_label: string
  other_cost_3_amount: number
  broker_inv_amount: number
  markup_pct: number
  total_cost_per_case: number
  cost_per_piece: number
  selling_price_per_case: number
  selling_price_per_piece: number
}

interface Quote {
  id: string
  quote_number: string
  customer_name: string
  quote_date: string
  valid_until: string
}

interface LineFormData {
  [lineId: string]: {
    exw_cost_per_case: string
    freight_cost_per_case: string
    packaging_cost_per_case: string
    other_cost_1_amount: string
    other_cost_2_amount: string
    other_cost_3_amount: string
    broker_inv_amount: string
    markup_pct: string
  }
}

export default function RfqFormPage() {
  const params = useParams()
  const token = params.token as string
  const sb = useMemo(() => createSupabaseBrowserClient(), [])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tokenData, setTokenData] = useState<RfqToken | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [lines, setLines] = useState<QuoteLine[]>([])
  const [formData, setFormData] = useState<LineFormData>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submissionNotes, setSubmissionNotes] = useState('')

  useEffect(() => {
    const loadData = async () => {
      try {
        // Fetch token
        const { data: tData, error: tErr } = await sb
          .from('rfq_tokens')
          .select('*')
          .eq('token', token)
          .single()

        if (tErr || !tData) {
          setError('Invalid or expired token')
          setLoading(false)
          return
        }

        if (tData.is_expired || (tData.expires_at && new Date(tData.expires_at) < new Date())) {
          setError('This RFQ link has expired (30 day limit)')
          setLoading(false)
          return
        }

        setTokenData(tData)

        // Fetch quote
        const { data: qData, error: qErr } = await sb
          .from('quote_costing')
          .select('*')
          .eq('id', tData.quote_costing_id)
          .single()

        if (qErr || !qData) {
          setError('Quote not found')
          setLoading(false)
          return
        }

        setQuote(qData)

        // Fetch lines
        const { data: lData, error: lErr } = await sb
          .from('quote_costing_lines')
          .select('*')
          .eq('quote_costing_id', tData.quote_costing_id)
          .order('line_number')

        if (lErr) {
          setError('Failed to load quote details')
          setLoading(false)
          return
        }

        setLines(lData || [])

        // Initialize form with existing values
        const initialForm: LineFormData = {}
        ;(lData || []).forEach((line) => {
          initialForm[line.id] = {
            exw_cost_per_case: String(line.exw_cost_per_case || 0),
            freight_cost_per_case: String(line.freight_cost_per_case || 0),
            packaging_cost_per_case: String(line.packaging_cost_per_case || 0),
            other_cost_1_amount: String(line.other_cost_1_amount || 0),
            other_cost_2_amount: String(line.other_cost_2_amount || 0),
            other_cost_3_amount: String(line.other_cost_3_amount || 0),
            broker_inv_amount: String(line.broker_inv_amount || 0),
            markup_pct: String(line.markup_pct || 45),
          }
        })
        setFormData(initialForm)

        setLoading(false)
      } catch (err: unknown) {
        setError(String(err))
        setLoading(false)
      }
    }

    loadData()
  }, [token, sb])

  const handleLineChange = (
    lineId: string,
    field: keyof LineFormData[string],
    value: string
  ) => {
    setFormData((prev) => ({
      ...prev,
      [lineId]: {
        ...prev[lineId],
        [field]: value,
      },
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token || !tokenData) return

    setSubmitting(true)
    try {
      const lineItems = lines.map((line) => ({
        quote_costing_line_id: line.id,
        exw_cost_per_case: formData[line.id]?.exw_cost_per_case ? parseFloat(formData[line.id].exw_cost_per_case) : undefined,
        freight_cost_per_case: formData[line.id]?.freight_cost_per_case ? parseFloat(formData[line.id].freight_cost_per_case) : undefined,
        packaging_cost_per_case: formData[line.id]?.packaging_cost_per_case ? parseFloat(formData[line.id].packaging_cost_per_case) : undefined,
        other_cost_1_amount: formData[line.id]?.other_cost_1_amount ? parseFloat(formData[line.id].other_cost_1_amount) : undefined,
        other_cost_2_amount: formData[line.id]?.other_cost_2_amount ? parseFloat(formData[line.id].other_cost_2_amount) : undefined,
        other_cost_3_amount: formData[line.id]?.other_cost_3_amount ? parseFloat(formData[line.id].other_cost_3_amount) : undefined,
        broker_inv_amount: formData[line.id]?.broker_inv_amount ? parseFloat(formData[line.id].broker_inv_amount) : undefined,
        markup_pct: formData[line.id]?.markup_pct ? parseFloat(formData[line.id].markup_pct) : undefined,
      }))

      const response = await fetch(`/api/rfq/submit/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient_name: tokenData.recipient_name,
          line_items: lineItems,
          submission_notes: submissionNotes,
        }),
      })

      if (!response.ok) {
        const errData = await response.json()
        throw new Error(errData.error || 'Failed to submit')
      }

      setSubmitted(true)
    } catch (err: unknown) {
      setError(String(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mb-4"></div>
          <p className="text-slate-300">Loading RFQ form...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-red-500/10 border border-red-500/30 rounded-lg p-6">
          <h1 className="text-xl font-bold text-red-400 mb-2">Error</h1>
          <p className="text-red-200">{error}</p>
        </div>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <div className="inline-block rounded-full bg-emerald-500/20 p-3 mb-4">
            <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-emerald-400 mb-2">Pricing Submitted</h1>
          <p className="text-slate-300 mb-6">
            Thank you for submitting your pricing. We will review it and follow up soon.
          </p>
          <p className="text-sm text-slate-400">
            You can submit updated pricing anytime by visiting this link again.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="inline-block px-3 py-1 bg-emerald-500/20 border border-emerald-500/30 rounded-full mb-4">
            <p className="text-xs font-medium text-emerald-400">RFQ FORM</p>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
            Quote Request — {quote?.quote_number}
          </h1>
          <p className="text-slate-400">
            Please review the line items below and provide your pricing. You can update this at any time.
          </p>
        </div>

        {/* Quote Info */}
        {quote && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Customer</p>
              <p className="text-lg font-semibold text-white">{quote.customer_name || 'N/A'}</p>
            </div>
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Quote Date</p>
              <p className="text-lg font-semibold text-white">
                {new Date(quote.quote_date).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
            </div>
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Valid Until</p>
              <p className="text-lg font-semibold text-white">
                {new Date(quote.valid_until).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
            </div>
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Recipient</p>
              <p className="text-lg font-semibold text-emerald-400">{tokenData?.recipient_name}</p>
            </div>
          </div>
        )}

        {/* Lines Form */}
        <form onSubmit={handleSubmit}>
          <div className="space-y-6 mb-8">
            {lines.map((line, idx) => (
              <div key={line.id} className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 pb-6 border-b border-slate-700">
                  <div>
                    <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Line {line.line_number}</p>
                    <p className="text-sm font-medium text-white">{line.product_type}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Description</p>
                    <p className="text-sm text-slate-200">{line.description}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Specs</p>
                    <p className="text-sm text-slate-200">{line.specs || 'N/A'}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs text-slate-400 uppercase tracking-wide mb-2">
                      EXW Cost per {line.uom}
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-slate-400">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={formData[line.id]?.exw_cost_per_case || ''}
                        onChange={(e) => handleLineChange(line.id, 'exw_cost_per_case', e.target.value)}
                        className="w-full bg-slate-700/50 border border-slate-600 rounded px-3 py-2 pl-7 text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
                        placeholder="0.00"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 uppercase tracking-wide mb-2">
                      Freight Cost per {line.uom}
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-slate-400">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={formData[line.id]?.freight_cost_per_case || ''}
                        onChange={(e) => handleLineChange(line.id, 'freight_cost_per_case', e.target.value)}
                        className="w-full bg-slate-700/50 border border-slate-600 rounded px-3 py-2 pl-7 text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
                        placeholder="0.00"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 uppercase tracking-wide mb-2">
                      Packaging Cost per {line.uom}
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-slate-400">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={formData[line.id]?.packaging_cost_per_case || ''}
                        onChange={(e) => handleLineChange(line.id, 'packaging_cost_per_case', e.target.value)}
                        className="w-full bg-slate-700/50 border border-slate-600 rounded px-3 py-2 pl-7 text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
                        placeholder="0.00"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 uppercase tracking-wide mb-2">
                      Broker Invoice Amount
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-slate-400">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={formData[line.id]?.broker_inv_amount || ''}
                        onChange={(e) => handleLineChange(line.id, 'broker_inv_amount', e.target.value)}
                        className="w-full bg-slate-700/50 border border-slate-600 rounded px-3 py-2 pl-7 text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
                        placeholder="0.00"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 uppercase tracking-wide mb-2">
                      Markup %
                    </label>
                    <div className="relative">
                      <span className="absolute right-3 top-2.5 text-slate-400">%</span>
                      <input
                        type="number"
                        step="0.1"
                        value={formData[line.id]?.markup_pct || ''}
                        onChange={(e) => handleLineChange(line.id, 'markup_pct', e.target.value)}
                        className="w-full bg-slate-700/50 border border-slate-600 rounded px-3 py-2 pr-7 text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
                        placeholder="45"
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Notes */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 mb-8">
            <label className="block text-xs text-slate-400 uppercase tracking-wide mb-2">
              Additional Notes (Optional)
            </label>
            <textarea
              value={submissionNotes}
              onChange={(e) => setSubmissionNotes(e.target.value)}
              className="w-full bg-slate-700/50 border border-slate-600 rounded px-3 py-2 text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition h-24 resize-none"
              placeholder="Add any additional information or notes..."
            />
          </div>

          {/* Submit Button */}
          <div className="flex gap-4">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-500/50 text-white font-semibold py-3 rounded-lg transition flex items-center justify-center gap-2"
            >
              {submitting && <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <circle cx="12" cy="12" r="10" strokeWidth="2" opacity="0.25" />
                <path d="M4 12a8 8 0 018-8v4" strokeWidth="2" />
              </svg>}
              {submitting ? 'Submitting...' : 'Submit Pricing'}
            </button>
          </div>
        </form>

        {/* Footer */}
        <div className="mt-8 text-center text-xs text-slate-500">
          <p>beyondGREEN ERP • RFQ System</p>
          {tokenData?.expires_at && (
            <p className="mt-1">
              Expires: {new Date(tokenData.expires_at).toLocaleDateString('en-US')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
