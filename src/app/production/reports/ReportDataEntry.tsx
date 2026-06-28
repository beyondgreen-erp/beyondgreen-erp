'use client'
import React, { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface ReportDataEntryProps {
  reportId: string
  reportType: 'walmart' | 'chewy' | 'amazon' | 'direct'
  onDataAdded: () => void
}

interface CSVRow {
  sku: string
  order_qty: string
  pieces_per_unit: string
  mat1_requirement: string
  mat1_on_hand: string
  mat2_requirement: string
  mat2_on_hand: string
  unit_packaging_required: string
  unit_packaging_on_hand: string
  srp_packaging_required: string
  srp_packaging_on_hand: string
}

export default function ReportDataEntry({
  reportId,
  reportType,
  onDataAdded,
}: ReportDataEntryProps) {
  const [tab, setTab] = useState<'manual' | 'csv'>('manual')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Manual entry form
  const [formData, setFormData] = useState({
    sku: '',
    order_qty: '',
    pieces_per_unit: '',
    mat1_requirement: '',
    mat1_on_hand: '',
    mat2_requirement: '',
    mat2_on_hand: '',
    unit_packaging_required: '',
    unit_packaging_on_hand: '',
    srp_packaging_required: '',
    srp_packaging_on_hand: '',
  })

  // CSV Upload
  const handleCSVUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setLoading(true)
    setError(null)

    try {
      const text = await file.text()
      const lines = text.split('\n').filter(l => l.trim())

      if (lines.length < 2) throw new Error('CSV must have header and at least one data row')

      // Parse CSV (basic implementation)
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
      const rows: CSVRow[] = []

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim())
        if (values.length < 2) continue

        const row: CSVRow = {
          sku: '',
          order_qty: '',
          pieces_per_unit: '',
          mat1_requirement: '',
          mat1_on_hand: '',
          mat2_requirement: '',
          mat2_on_hand: '',
          unit_packaging_required: '',
          unit_packaging_on_hand: '',
          srp_packaging_required: '',
          srp_packaging_on_hand: '',
        }

        headers.forEach((header, idx) => {
          if (values[idx]) {
            if (header === 'sku') row.sku = values[idx]
            else if (header === 'order_qty') row.order_qty = values[idx]
            else if (header === 'pieces_per_unit') row.pieces_per_unit = values[idx]
            else if (header === 'mat1_requirement') row.mat1_requirement = values[idx]
            else if (header === 'mat1_on_hand') row.mat1_on_hand = values[idx]
            else if (header === 'mat2_requirement') row.mat2_requirement = values[idx]
            else if (header === 'mat2_on_hand') row.mat2_on_hand = values[idx]
            else if (header === 'unit_packaging_required')
              row.unit_packaging_required = values[idx]
            else if (header === 'unit_packaging_on_hand')
              row.unit_packaging_on_hand = values[idx]
            else if (header === 'srp_packaging_required')
              row.srp_packaging_required = values[idx]
            else if (header === 'srp_packaging_on_hand')
              row.srp_packaging_on_hand = values[idx]
          }
        })

        if (row.sku) rows.push(row)
      }

      // Insert rows
      const sb = createSupabaseBrowserClient()
      const items = rows.map(r => ({
        report_id: reportId,
        sku: r.sku,
        order_qty: parseInt(r.order_qty) || 0,
        pieces_per_unit: parseInt(r.pieces_per_unit) || 1,
        mat1_requirement: parseInt(r.mat1_requirement) || 0,
        mat1_on_hand: parseInt(r.mat1_on_hand) || 0,
        mat2_requirement: parseInt(r.mat2_requirement) || 0,
        mat2_on_hand: parseInt(r.mat2_on_hand) || 0,
        unit_packaging_required: parseInt(r.unit_packaging_required) || 0,
        unit_packaging_on_hand: parseInt(r.unit_packaging_on_hand) || 0,
        srp_packaging_required: parseInt(r.srp_packaging_required) || 0,
        srp_packaging_on_hand: parseInt(r.srp_packaging_on_hand) || 0,
        is_manual_adjustment: false,
      }))

      const { error: err } = await sb.from('report_line_items').insert(items)
      if (err) throw err

      onDataAdded()
      e.target.value = ''
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload CSV')
    } finally {
      setLoading(false)
    }
  }

  // Manual form submission
  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      if (!formData.sku.trim()) throw new Error('SKU is required')

      const sb = createSupabaseBrowserClient()
      const { error: err } = await sb.from('report_line_items').insert({
        report_id: reportId,
        sku: formData.sku.trim(),
        order_qty: parseInt(formData.order_qty) || 0,
        pieces_per_unit: parseInt(formData.pieces_per_unit) || 1,
        mat1_requirement: parseInt(formData.mat1_requirement) || 0,
        mat1_on_hand: parseInt(formData.mat1_on_hand) || 0,
        mat2_requirement: parseInt(formData.mat2_requirement) || 0,
        mat2_on_hand: parseInt(formData.mat2_on_hand) || 0,
        unit_packaging_required: parseInt(formData.unit_packaging_required) || 0,
        unit_packaging_on_hand: parseInt(formData.unit_packaging_on_hand) || 0,
        srp_packaging_required: parseInt(formData.srp_packaging_required) || 0,
        srp_packaging_on_hand: parseInt(formData.srp_packaging_on_hand) || 0,
        is_manual_adjustment: false,
      })

      if (err) throw err

      setFormData({
        sku: '',
        order_qty: '',
        pieces_per_unit: '',
        mat1_requirement: '',
        mat1_on_hand: '',
        mat2_requirement: '',
        mat2_on_hand: '',
        unit_packaging_required: '',
        unit_packaging_on_hand: '',
        srp_packaging_required: '',
        srp_packaging_on_hand: '',
      })
      onDataAdded()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add line item')
    } finally {
      setLoading(false)
    }
  }

  const inp =
    'w-full border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-[#1A1D2E]'

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-2 border-b border-[#E4E6EE]">
        <button
          onClick={() => setTab('manual')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'manual'
              ? 'border-b-2 border-blue-500 text-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Manual Entry
        </button>
        <button
          onClick={() => setTab('csv')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'csv'
              ? 'border-b-2 border-blue-500 text-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          CSV Upload
        </button>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Manual Entry Form */}
      {tab === 'manual' && (
        <form onSubmit={handleManualSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">SKU *</label>
              <input
                type="text"
                value={formData.sku}
                onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                placeholder="e.g., STRAW-001"
                className={inp}
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Order Qty</label>
              <input
                type="number"
                value={formData.order_qty}
                onChange={(e) => setFormData({ ...formData, order_qty: e.target.value })}
                placeholder="0"
                className={inp}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Pieces/Unit</label>
              <input
                type="number"
                value={formData.pieces_per_unit}
                onChange={(e) => setFormData({ ...formData, pieces_per_unit: e.target.value })}
                placeholder="1"
                className={inp}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Mat1 Requirement</label>
              <input
                type="number"
                value={formData.mat1_requirement}
                onChange={(e) => setFormData({ ...formData, mat1_requirement: e.target.value })}
                placeholder="0"
                className={inp}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Mat1 On Hand</label>
              <input
                type="number"
                value={formData.mat1_on_hand}
                onChange={(e) => setFormData({ ...formData, mat1_on_hand: e.target.value })}
                placeholder="0"
                className={inp}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Unit Packaging Req</label>
              <input
                type="number"
                value={formData.unit_packaging_required}
                onChange={(e) =>
                  setFormData({ ...formData, unit_packaging_required: e.target.value })
                }
                placeholder="0"
                className={inp}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Unit Pkg On Hand</label>
              <input
                type="number"
                value={formData.unit_packaging_on_hand}
                onChange={(e) =>
                  setFormData({ ...formData, unit_packaging_on_hand: e.target.value })
                }
                placeholder="0"
                className={inp}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-2 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Adding...' : 'Add Line Item'}
          </button>
        </form>
      )}

      {/* CSV Upload */}
      {tab === 'csv' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg bg-blue-50 border border-blue-200">
            <p className="text-sm text-blue-700 mb-2">CSV columns required:</p>
            <code className="text-xs text-blue-600 block overflow-x-auto">
              sku, order_qty, pieces_per_unit, mat1_requirement, mat1_on_hand, mat2_requirement,
              mat2_on_hand, unit_packaging_required, unit_packaging_on_hand,
              srp_packaging_required, srp_packaging_on_hand
            </code>
          </div>

          <div className="flex items-center justify-center border-2 border-dashed border-[#E4E6EE] rounded-lg p-8 hover:border-blue-400 transition-colors">
            <label className="cursor-pointer text-center">
              <input
                type="file"
                accept=".csv"
                onChange={handleCSVUpload}
                disabled={loading}
                className="hidden"
              />
              <div>
                <i className="ti ti-upload text-2xl text-gray-400 mb-2 block" />
                <p className="text-sm font-medium text-gray-700">
                  {loading ? 'Uploading...' : 'Click to upload CSV or drag and drop'}
                </p>
                <p className="text-xs text-gray-500 mt-1">CSV file up to 10MB</p>
              </div>
            </label>
          </div>
        </div>
      )}
    </div>
  )
}
