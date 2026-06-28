'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import type { ReportLineItem } from '@/lib/types/production'

// Only base (non-generated) columns are writable; computed columns are DB-generated.
const WRITABLE: (keyof ReportLineItem)[] = [
  'sku', 'order_qty', 'pieces_per_unit',
  'mat1_requirement', 'mat1_on_hand', 'mat2_requirement', 'mat2_on_hand',
  'unit_packaging_required', 'unit_packaging_on_hand',
  'srp_packaging_required', 'srp_packaging_on_hand',
  'is_manual_adjustment', 'manual_fields', 'notes', 'sales_order_line_id',
]

export function useReportLineItems({ reportId }: { reportId?: string }) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [items, setItems] = useState<ReportLineItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    if (!reportId) { setItems([]); return }
    setLoading(true); setError(null)
    const { data, error: err } = await sb
      .from('report_line_items')
      .select('*')
      .eq('report_id', reportId)
      .order('created_at', { ascending: true })
    if (err) setError(err.message)
    setItems((data as ReportLineItem[]) || [])
    setLoading(false)
  }, [sb, reportId])

  useEffect(() => { refetch() }, [refetch])

  const updateItem = useCallback(async (itemId: string, updates: Partial<ReportLineItem>) => {
    const patch: Record<string, unknown> = {}
    for (const k of WRITABLE) if (k in updates) patch[k as string] = (updates as Record<string, unknown>)[k as string]
    patch.updated_at = new Date().toISOString()
    const { error: err } = await sb.from('report_line_items').update(patch).eq('id', itemId)
    if (err) { setError(err.message); return }
    await refetch()
  }, [sb, refetch])

  const deleteItem = useCallback(async (itemId: string) => {
    const { error: err } = await sb.from('report_line_items').delete().eq('id', itemId)
    if (err) { setError(err.message); return }
    await refetch()
  }, [sb, refetch])

  return { items, loading, error, updateItem, deleteItem, refetch }
}
