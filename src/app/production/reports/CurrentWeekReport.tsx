'use client'
import React, { useState, useMemo } from 'react'
import type { ReportLineItem } from '@/lib/types/production'
import { formatNumber, formatDelta } from '@/lib/hooks/useReportCalculations'

interface CurrentWeekReportProps {
  reportId: string
  items: ReportLineItem[]
  loading: boolean
  onUpdateItem: (itemId: string, updates: Partial<ReportLineItem>) => Promise<void>
  onDeleteItem: (itemId: string) => Promise<void>
}

export default React.memo(function CurrentWeekReport({
  reportId,
  items,
  loading,
  onUpdateItem,
  onDeleteItem,
}: CurrentWeekReportProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<Partial<ReportLineItem>>({})
  const [saving, setSaving] = useState(false)

  const handleEdit = (item: ReportLineItem) => {
    setEditingId(item.id)
    setEditValues({ ...item })
  }

  const handleSave = async () => {
    if (!editingId) return
    setSaving(true)
    try {
      await onUpdateItem(editingId, editValues)
      setEditingId(null)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (itemId: string) => {
    if (!confirm('Remove this line item?')) return
    await onDeleteItem(itemId)
  }

  const handleCancel = () => {
    setEditingId(null)
    setEditValues({})
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-16 bg-gray-100 rounded animate-pulse" />
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 text-sm">No line items yet. Add items to this report.</p>
      </div>
    )
  }

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-[#E4E6EE] bg-gray-50">
            <th className="px-4 py-3 text-left font-semibold text-gray-700">SKU</th>
            <th className="px-4 py-3 text-center font-semibold text-gray-700">Order Qty</th>
            <th className="px-4 py-3 text-center font-semibold text-gray-700">Pieces/Unit</th>
            <th className="px-4 py-3 text-center font-semibold text-gray-700">Total Pieces</th>
            <th className="px-4 py-3 text-center font-semibold text-gray-700">Mat 1 (Req)</th>
            <th className="px-4 py-3 text-center font-semibold text-gray-700">Mat 1 (On Hand)</th>
            <th className="px-4 py-3 text-center font-semibold text-gray-700">Mat 1 (Delta)</th>
            <th className="px-4 py-3 text-center font-semibold text-gray-700">Unit Pkg (Delta)</th>
            <th className="px-4 py-3 text-center font-semibold text-gray-700">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const isEditing = editingId === item.id
            const mat1Delta = formatDelta(item.mat1_delta)
            const unitPkgDelta = formatDelta(item.unit_packaging_delta)

            return (
              <tr
                key={item.id}
                className="border-b border-[#E4E6EE] hover:bg-gray-50 transition-colors"
              >
                <td className="px-4 py-3">
                  <div>
                    <p className="font-mono font-semibold text-[#1A1D2E]">{item.sku}</p>
                    {item.is_manual_adjustment && (
                      <span className="inline-block mt-1 px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-semibold rounded">
                        MANUAL
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  {isEditing ? (
                    <input
                      type="number"
                      value={editValues.order_qty ?? item.order_qty}
                      onChange={(e) =>
                        setEditValues({ ...editValues, order_qty: parseInt(e.target.value) })
                      }
                      className="w-16 px-2 py-1 border border-[#E4E6EE] rounded text-center"
                    />
                  ) : (
                    formatNumber(item.order_qty)
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  {isEditing ? (
                    <input
                      type="number"
                      value={editValues.pieces_per_unit ?? item.pieces_per_unit}
                      onChange={(e) =>
                        setEditValues({
                          ...editValues,
                          pieces_per_unit: parseInt(e.target.value),
                        })
                      }
                      className="w-16 px-2 py-1 border border-[#E4E6EE] rounded text-center"
                    />
                  ) : (
                    formatNumber(item.pieces_per_unit)
                  )}
                </td>
                <td className="px-4 py-3 text-center font-semibold text-[#1A1D2E]">
                  {formatNumber(item.total_pieces)}
                </td>
                <td className="px-4 py-3 text-center">
                  {isEditing ? (
                    <input
                      type="number"
                      value={editValues.mat1_requirement ?? item.mat1_requirement}
                      onChange={(e) =>
                        setEditValues({
                          ...editValues,
                          mat1_requirement: parseInt(e.target.value),
                        })
                      }
                      className="w-20 px-2 py-1 border border-[#E4E6EE] rounded text-center"
                    />
                  ) : (
                    formatNumber(item.mat1_requirement)
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  {isEditing ? (
                    <input
                      type="number"
                      value={editValues.mat1_on_hand ?? item.mat1_on_hand}
                      onChange={(e) =>
                        setEditValues({
                          ...editValues,
                          mat1_on_hand: parseInt(e.target.value),
                        })
                      }
                      className="w-20 px-2 py-1 border border-[#E4E6EE] rounded text-center"
                    />
                  ) : (
                    formatNumber(item.mat1_on_hand)
                  )}
                </td>
                <td className={`px-4 py-3 text-center font-semibold ${mat1Delta.isNegative ? 'text-red-600' : 'text-green-600'}`}>
                  {mat1Delta.text}
                </td>
                <td className={`px-4 py-3 text-center font-semibold ${unitPkgDelta.isNegative ? 'text-red-600' : 'text-green-600'}`}>
                  {unitPkgDelta.text}
                </td>
                <td className="px-4 py-3 text-center space-x-2">
                  {isEditing ? (
                    <>
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-2 py-1 bg-green-500 text-white text-xs rounded hover:bg-green-600 disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        onClick={handleCancel}
                        className="px-2 py-1 bg-gray-300 text-gray-700 text-xs rounded hover:bg-gray-400"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => handleEdit(item)}
                        className="px-2 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="px-2 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
})
