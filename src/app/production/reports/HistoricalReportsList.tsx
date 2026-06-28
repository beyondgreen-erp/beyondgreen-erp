'use client'
import React from 'react'
import type { ProductionReport } from '@/lib/types/production'
import { formatNumber } from '@/lib/hooks/useReportCalculations'

interface HistoricalReportsListProps {
  reports: ProductionReport[]
  loading: boolean
  onSelectReport: (report: ProductionReport) => void
  selectedReportId?: string
}

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  Draft: { bg: '#F3F4F6', text: '#6B7280', border: '#E4E6EE' },
  Submitted: { bg: '#EFF6FF', text: '#2563EB', border: '#BFDBFE' },
  Completed: { bg: '#ECFDF5', text: '#059669', border: '#A7F3D0' },
  Archived: { bg: '#F5F3FF', text: '#7C3AED', border: '#DDD6FE' },
}

function StatusBadge({ status }: { status: ProductionReport['status'] }) {
  const s = STATUS_COLORS[status] || { bg: '#F3F4F6', text: '#6B7280', border: '#E4E6EE' }
  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border"
      style={{ background: s.bg, color: s.text, borderColor: s.border }}
    >
      {status}
    </span>
  )
}

export default React.memo(function HistoricalReportsList({
  reports,
  loading,
  onSelectReport,
  selectedReportId,
}: HistoricalReportsListProps) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-16 bg-gray-100 rounded animate-pulse" />
        ))}
      </div>
    )
  }

  if (reports.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 text-sm">No reports found.</p>
      </div>
    )
  }

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-[#E4E6EE] bg-gray-50">
            <th className="px-4 py-3 text-left font-semibold text-gray-700">Date</th>
            <th className="px-4 py-3 text-center font-semibold text-gray-700">Type</th>
            <th className="px-4 py-3 text-center font-semibold text-gray-700">Week</th>
            <th className="px-4 py-3 text-center font-semibold text-gray-700">Total Orders</th>
            <th className="px-4 py-3 text-center font-semibold text-gray-700">Total Pieces</th>
            <th className="px-4 py-3 text-center font-semibold text-gray-700">Status</th>
            <th className="px-4 py-3 text-center font-semibold text-gray-700">Updated</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {reports.map((report) => {
            const isSelected = selectedReportId === report.id
            const updated = new Date(report.updated_at)
            const updatedStr = updated.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })

            return (
              <tr
                key={report.id}
                className={`border-b border-[#E4E6EE] transition-colors ${
                  isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                }`}
              >
                <td className="px-4 py-3">
                  <p className="font-mono font-semibold text-[#1A1D2E]">{report.date}</p>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className="inline-block px-2 py-1 bg-gray-200 text-gray-700 text-xs font-semibold rounded capitalize">
                    {report.type}
                  </span>
                </td>
                <td className="px-4 py-3 text-center text-gray-600">
                  Week {report.week_number}
                </td>
                <td className="px-4 py-3 text-center font-semibold text-[#1A1D2E]">
                  {formatNumber(report.summary_data.total_order_qty)}
                </td>
                <td className="px-4 py-3 text-center font-semibold text-[#1A1D2E]">
                  {formatNumber(report.summary_data.total_pieces_required)}
                </td>
                <td className="px-4 py-3 text-center">
                  <StatusBadge status={report.status} />
                </td>
                <td className="px-4 py-3 text-center text-xs text-gray-500">{updatedStr}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => onSelectReport(report)}
                    className="px-3 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 transition-colors"
                  >
                    View
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
})
