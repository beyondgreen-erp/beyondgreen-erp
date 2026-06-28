'use client'
import { useMemo } from 'react'
import type { ReportLineItem, ReportCalculations } from '@/lib/types/production'

export function formatNumber(value: number | null | undefined): string {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return '0'
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export function formatDelta(value: number | null | undefined): { text: string; isNegative: boolean } {  const n = Number(value ?? 0)
  const isNegative = n < 0
  const sign = n > 0 ? '+' : ''
    return { text: `${sign}${formatNumber(n)}`, isNegative }}

export function useReportCalculations(items: ReportLineItem[]): ReportCalculations {
  return useMemo(() => {
    const list = items || []
    const sum = (f: (i: ReportLineItem) => number) =>
      list.reduce((acc, i) => acc + (Number(f(i)) || 0), 0)

    const total_order_qty       = sum(i => i.order_qty)
    const total_pieces_required = sum(i => i.total_pieces)

    const mat1_total   = sum(i => i.mat1_requirement)
    const mat1_on_hand = sum(i => i.mat1_on_hand)
    const mat2_total   = sum(i => i.mat2_requirement)
    const mat2_on_hand = sum(i => i.mat2_on_hand)
    const mat1_delta = mat1_on_hand - mat1_total
    const mat2_delta = mat2_on_hand - mat2_total

    const unit_packaging_total   = sum(i => i.unit_packaging_required)
    const unit_packaging_on_hand = sum(i => i.unit_packaging_on_hand)
    const srp_packaging_total    = sum(i => i.srp_packaging_required)
    const srp_packaging_on_hand  = sum(i => i.srp_packaging_on_hand)
    const unit_packaging_delta = unit_packaging_on_hand - unit_packaging_total
    const srp_packaging_delta  = srp_packaging_on_hand - srp_packaging_total

    const critical_shortages = list
      .filter(i =>
        (Number(i.mat1_delta) || 0) < 0 ||
        (Number(i.mat2_delta) || 0) < 0 ||
        (Number(i.unit_packaging_delta) || 0) < 0 ||
        (Number(i.srp_packaging_delta) || 0) < 0)
      .map(i => i.sku)

    const days_to_complete = total_pieces_required > 0
      ? Math.max(1, Math.ceil(total_pieces_required / 100000))
      : 0

    return {
      total_order_qty,
      total_pieces_required,
      material_requirements: {
        mat1_total, mat1_on_hand, mat1_delta, mat1_shortage: mat1_delta < 0,
        mat2_total, mat2_on_hand, mat2_delta, mat2_shortage: mat2_delta < 0,
      },
      packaging_requirements: {
        unit_packaging_total, unit_packaging_on_hand, unit_packaging_delta, unit_packaging_shortage: unit_packaging_delta < 0,
        srp_packaging_total, srp_packaging_on_hand, srp_packaging_delta, srp_packaging_shortage: srp_packaging_delta < 0,
      },
      days_to_complete,
      critical_shortages,
    }
  }, [items])
}
