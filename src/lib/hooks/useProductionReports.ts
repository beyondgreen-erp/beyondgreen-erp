'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import type { ProductionReport } from '@/lib/types/production'

export function useProductionReports({ type }: { type: string }) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [reports, setReports] = useState<ProductionReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    setLoading(true); setError(null)
    const { data, error: err } = await sb
      .from('production_reports')
      .select('*')
      .eq('type', type)
      .order('date', { ascending: false })
    if (err) setError(err.message)
    setReports((data as ProductionReport[]) || [])
    setLoading(false)
  }, [sb, type])

  useEffect(() => { refetch() }, [refetch])

  return { reports, loading, error, refetch }
}
