'use client'

import React from 'react'
import { useState } from 'react'
import { useParams } from 'next/navigation'

interface LineItem {
  quote_costing_line_id: string
  description?: string
  order_qty?: number
  uom?: string
  exw_cost_per_case?: number
  freight_cost_per_case?: number
  packaging_cost_per_case?: number
  other_cost_1_amount?: number
  other_cost_2_amount?: number
  other_cost_3_amount?: number
  broker_inv_amount?: number
  markup_pct?: number
}

interface QuoteData {
  quote_number: string
  customer_name: string
  line_items: LineItem[]
}

export default function RFQPage() {
  const params = useParams()
  const token = params?.token as string

  const [quoteData, setQuoteData] = useState<QuoteData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const [lineItemData, setLineItemData] = useState<Record<string, Record<string, any>>>({})
  const [recipientName, setRecipientName] = useState('')
  const [notes, setNotes] = useState('')

  // Fetch quote data on mount
  React.useEffect(() => {
    const fetchQuote = async () => {
      try {
        setLoading(true)
        // In a real implementation, you'd fetch from an API endpoint
        // that validates the token and returns the quote data
        const response = await fetch(`/api/rfq/quote/${token}`)
        if (!response.ok) throw new Error('Failed to load quote')
        const data = await response.json()
        setQuoteData(data)
      } catch (err) {
        setError('Unable to load quote. The link may have expired.')
        console.error('Quote fetch error:', err)
      } finally {
        setLoading(false)
      }
    }

    if (token) fetchQuote()
  }, [token])

  const handleLineItemChange = (lineItemId: string, field: string, value: any) => {
    setLineItemData(prev => ({
      ...prev,
      [lineItemId]: {
        ...prev[lineItemId],
        [field]: value ? parseFloat(value) : undefined
      }
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!quoteData) return

    try {
      setSubmitting(true)
      setError(null)

      // Prepare submission data
      const submission = {
        recipient_name: recipientName || 'Supplier',
        line_items: quoteData.line_items.map(item => ({
          quote_costing_line_id: item.quote_costing_line_id,
          exw_cost_per_case: lineItemData[item.quote_costing_line_id]?.exw_cost_per_case,
          freight_cost_per_case: lineItemData[item.quote_costing_line_id]?.freight_cost_per_case,
          packaging_cost_per_case: lineItemData[item.quote_costing_line_id]?.packaging_cost_per_case,
          other_cost_1_amount: lineItemData[item.quote_costing_line_id]?.other_cost_1_amount,
          other_cost_2_amount: lineItemData[item.quote_costing_line_id]?.other_cost_2_amount,
          other_cost_3_amount: lineItemData[item.quote_costing_line_id]?.other_cost_3_amount,
          broker_inv_amount: lineItemData[item.quote_costing_line_id]?.broker_inv_amount,
          markup_pct: lineItemData[item.quote_costing_line_id]?.markup_pct,
          notes: lineItemData[item.quote_costing_line_id]?.notes,
        })),
        submission_notes: notes,
      }

      // Submit to API
      const response = await fetch(`/api/rfq/submit/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submission),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Submission failed')
      }

      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit pricing')
      console.error('Submission error:', err)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb' }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '16px', color: '#666' }}>Loading quote...</p>
        </div>
      </div>
    )
  }

  if (error && !quoteData) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb' }}>
        <div style={{ textAlign: 'center', maxWidth: '400px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '12px', color: '#1f2937' }}>Error</h1>
          <p style={{ fontSize: '14px', color: '#666', marginBottom: '24px' }}>{error}</p>
          <a href="/" style={{ color: '#8b5cf6', textDecoration: 'none', fontSize: '14px', fontWeight: 500 }}>
            Return home
          </a>
        </div>
      </div>
    )
  }

  if (submitted) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb', padding: '20px' }}>
        <div style={{ textAlign: 'center', maxWidth: '450px', background: 'white', padding: '40px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>✓</div>
          <h1 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '12px', color: '#1f2937' }}>Pricing submitted</h1>
          <p style={{ fontSize: '14px', color: '#666', marginBottom: '24px' }}>
            Thank you for submitting your pricing for quote {quoteData?.quote_number}. The beyondGREEN team will review your submission.
          </p>
          <p style={{ fontSize: '12px', color: '#999' }}>You can close this window.</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', padding: '40px 20px' }}>
      <div style={{ maxWidth: '600px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', color: 'white', padding: '32px 24px', borderRadius: '12px 12px 0 0', textAlign: 'center' }}>
          <p style={{ margin: '0 0 8px', fontSize: '13px', opacity: 0.9 }}>beyondGREEN ERP</p>
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 600 }}>Submit Pricing</h1>
        </div>

        {/* Main Form */}
        <div style={{ background: 'white', padding: '32px 24px', borderRadius: '0 0 12px 12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <form onSubmit={handleSubmit}>
            {/* Quote Info */}
            {quoteData && (
              <div style={{ marginBottom: '28px', paddingBottom: '24px', borderBottom: '1px solid #e5e7eb' }}>
                <div style={{ marginBottom: '16px' }}>
                  <p style={{ margin: '0 0 4px', fontSize: '13px', color: '#6b7280' }}>Quote number</p>
                  <p style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#1f2937' }}>{quoteData.quote_number}</p>
                </div>
                <div>
                  <p style={{ margin: '0 0 4px', fontSize: '13px', color: '#6b7280' }}>Customer</p>
                  <p style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#1f2937' }}>{quoteData.customer_name}</p>
                </div>
              </div>
            )}

            {/* Line Items */}
            {quoteData?.line_items && quoteData.line_items.length > 0 && (
              <div style={{ marginBottom: '28px' }}>
                <h2 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '16px', color: '#1f2937' }}>Line items</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {quoteData.line_items.map((item, idx) => (
                    <div key={item.quote_costing_line_id} style={{ background: '#f9fafb', padding: '16px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                      <p style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 500, color: '#1f2937' }}>
                        Item {idx + 1}: {item.description}
                      </p>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                        <label>
                          <span style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '4px', color: '#374151' }}>EXW cost per case</span>
                          <input
                            type="number"
                            placeholder="$"
                            step="0.01"
                            onChange={(e) => handleLineItemChange(item.quote_costing_line_id, 'exw_cost_per_case', e.target.value)}
                            style={{
                              width: '100%',
                              padding: '8px',
                              border: '1px solid #d1d5db',
                              borderRadius: '6px',
                              fontSize: '13px',
                              boxSizing: 'border-box',
                            }}
                          />
                        </label>
                        <label>
                          <span style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '4px', color: '#374151' }}>Freight cost per case</span>
                          <input
                            type="number"
                            placeholder="$"
                            step="0.01"
                            onChange={(e) => handleLineItemChange(item.quote_costing_line_id, 'freight_cost_per_case', e.target.value)}
                            style={{
                              width: '100%',
                              padding: '8px',
                              border: '1px solid #d1d5db',
                              borderRadius: '6px',
                              fontSize: '13px',
                              boxSizing: 'border-box',
                            }}
                          />
                        </label>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <label>
                          <span style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '4px', color: '#374151' }}>Packaging cost</span>
                          <input
                            type="number"
                            placeholder="$"
                            step="0.01"
                            onChange={(e) => handleLineItemChange(item.quote_costing_line_id, 'packaging_cost_per_case', e.target.value)}
                            style={{
                              width: '100%',
                              padding: '8px',
                              border: '1px solid #d1d5db',
                              borderRadius: '6px',
                              fontSize: '13px',
                              boxSizing: 'border-box',
                            }}
                          />
                        </label>
                        <label>
                          <span style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '4px', color: '#374151' }}>Markup %</span>
                          <input
                            type="number"
                            placeholder="45"
                            step="0.1"
                            onChange={(e) => handleLineItemChange(item.quote_costing_line_id, 'markup_pct', e.target.value)}
                            style={{
                              width: '100%',
                              padding: '8px',
                              border: '1px solid #d1d5db',
                              borderRadius: '6px',
                              fontSize: '13px',
                              boxSizing: 'border-box',
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Supplier Info */}
            <div style={{ marginBottom: '28px', paddingBottom: '24px', borderBottom: '1px solid #e5e7eb' }}>
              <label style={{ display: 'block' }}>
                <span style={{ display: 'block', fontSize: '14px', fontWeight: 500, marginBottom: '8px', color: '#374151' }}>Your name</span>
                <input
                  type="text"
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  placeholder="Supplier name"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                  }}
                />
              </label>
            </div>

            {/* Notes */}
            <div style={{ marginBottom: '28px' }}>
              <label style={{ display: 'block' }}>
                <span style={{ display: 'block', fontSize: '14px', fontWeight: 500, marginBottom: '8px', color: '#374151' }}>Notes (optional)</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any special requirements or comments..."
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                    minHeight: '80px',
                    resize: 'vertical',
                  }}
                />
              </label>
            </div>

            {/* Error Message */}
            {error && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '12px', borderRadius: '6px', fontSize: '13px', marginBottom: '16px' }}>
                {error}
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={submitting}
              style={{
                width: '100%',
                padding: '12px',
                background: '#8b5cf6',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: submitting ? 'not-allowed' : 'pointer',
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? 'Submitting...' : 'Submit pricing'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
