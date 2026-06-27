'use client'
import React from 'react'
import type { ReportCalculations } from '@/lib/types/production'
import { formatNumber } from '@/lib/hooks/useReportCalculations'

interface ReportSummaryStatsProps {
  calculations: ReportCalculations
}

function StatBlock({
  label,
  value,
  delta,
  unit = '',
  isShortage = false,
}: {
  label: string
  value: number
  delta: number
  unit?: string
  isShortage: boolean
}) {
  const deltaColor = delta < 0 ? 'text-red-600' : 'text-green-600'
  const deltaBg = delta < 0 ? 'bg-red-50' : 'bg-green-50'

  return (
    <div className={`p-4 rounded-lg border border-[#E4E6EE] ${deltaBg}`}>
      <p className="text-xs font-medium text-gray-500 mb-1">{label}</p>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-2xl font-bold text-[#1A1D2E]">
          {formatNumber(value)}{unit}
        </p>
        <span className={`text-sm font-semibold ${deltaColor}`}>
          {delta < 0 ? '' : '+'}
          {formatNumber(delta)}{unit}
        </span>
      </div>
      {isShortage && delta < 0 && (
        <p className="text-xs text-red-600 mt-2 font-medium">SHORTAGE</p>
      )}
    </div>
  )
}

export default React.memo(function ReportSummaryStats({
  calculations,
}: ReportSummaryStatsProps) {
  return (
    <div className="space-y-6">
      {/* Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-lg border border-[#E4E6EE] bg-blue-50">
          <p className="text-xs font-medium text-gray-500 mb-1">Total Order Qty</p>
          <p className="text-3xl font-bold text-blue-600">
            {formatNumber(calculations.total_order_qty)}
          </p>
        </div>

        <div className="p-4 rounded-lg border border-[#E4E6EE] bg-blue-50">
          <p className="text-xs font-medium text-gray-500 mb-1">Total Pieces Required</p>
          <p className="text-3xl font-bold text-blue-600">
            {formatNumber(calculations.total_pieces_required)}
          </p>
        </div>

        <div className="p-4 rounded-lg border border-[#E4E6EE] bg-amber-50">
          <p className="text-xs font-medium text-gray-500 mb-1">Est. Days to Complete</p>
          <p className="text-3xl font-bold text-amber-600">
            {calculations.days_to_complete}
          </p>
        </div>
      </div>

      {/* Materials */}
      <div>
        <h3 className="text-sm font-semibold text-[#1A1D2E] mb-3">Material Requirements</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatBlock
            label="Material 1"
            value={calculations.material_requirements.mat1_total}
            delta={calculations.material_requirements.mat1_delta}
            isShortage={calculations.material_requirements.mat1_shortage}
          />
          <StatBlock
            label="Material 2"
            value={calculations.material_requirements.mat2_total}
            delta={calculations.material_requirements.mat2_delta}
            isShortage={calculations.material_requirements.mat2_shortage}
          />
        </div>
      </div>

      {/* Packaging */}
      <div>
        <h3 className="text-sm font-semibold text-[#1A1D2E] mb-3">Packaging Requirements</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatBlock
            label="Unit Packaging"
            value={calculations.packaging_requirements.unit_packaging_total}
            delta={calculations.packaging_requirements.unit_packaging_delta}
            isShortage={calculations.packaging_requirements.unit_packaging_shortage}
          />
          <StatBlock
            label="SRP Packaging"
            value={calculations.packaging_requirements.srp_packaging_total}
            delta={calculations.packaging_requirements.srp_packaging_delta}
            isShortage={calculations.packaging_requirements.srp_packaging_shortage}
          />
        </div>
      </div>

      {/* Critical Shortages Alert */}
      {calculations.critical_shortages.length > 0 && (
        <div className="p-4 rounded-lg border-l-4 border-l-red-500 bg-red-50">
          <h4 className="text-sm font-semibold text-red-700 mb-2">Critical Shortages</h4>
          <ul className="text-sm text-red-600 space-y-1">
            {calculations.critical_shortages.slice(0, 10).map((sku, i) => (
              <li key={i}>• {sku}</li>
            ))}
            {calculations.critical_shortages.length > 10 && (
              <li className="text-xs text-red-500 italic">
                +{calculations.critical_shortages.length - 10} more
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
})
