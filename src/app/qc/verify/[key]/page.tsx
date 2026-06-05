'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface QCInspection {
  id: string
  lot_number: string | null
  sku: string | null
  product_name: string | null
  batch_number: string | null
  qty_inspected: number
  qty_passed: number
  qty_failed: number
  overall_result: string
  inspection_date: string | null
  inspector_email: string | null
  inspection_type: string
  notes: string | null
}

const RESULT_CFG: Record<string, { label: string; cls: string; icon: string }> = {
  Pass: { label: 'PASSED', cls: 'text-[#00C896] border-[#00C89630] bg-[#00C89610]', icon: '✓' },
  'Pass with Conditions': { label: 'PASSED WITH CONDITIONS', cls: 'text-amber-400 border-amber-500/25 bg-amber-500/10', icon: '~' },
  Fail: { label: 'FAILED', cls: 'text-red-400 border-red-500/25 bg-red-500/10', icon: '✗' },
  'Rework Required': { label: 'REWORK REQUIRED', cls: 'text-orange-400 border-orange-500/25 bg-orange-500/10', icon: '⚑' },
  Pending: { label: 'PENDING', cls: 'text-[#6B7280] border-[#E4E6EE] bg-[#F5F6FA]', icon: '○' },
}

export default function QCVerifyPage() {
  const params = useParams()
  const key = params?.key as string
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [inspection, setInspection] = useState<QCInspection | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!key) return
    sb.from('qc_inspections')
      .select('id,lot_number,sku,product_name,batch_number,qty_inspected,qty_passed,qty_failed,overall_result,inspection_date,inspector_email,inspection_type,notes')
      .or(`id.eq.${key},batch_number.eq.${key}`)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error || !data) { setNotFound(true); setLoading(false); return }
        setInspection(data as any)
        setLoading(false)
      })
  }, [key]) // eslint-disable-line

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F6FA] flex items-center justify-center">
        <svg className="w-8 h-8 animate-spin text-[#00C896]" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
      </div>
    )
  }

  if (notFound || !inspection) {
    return (
      <div className="min-h-screen bg-[#F5F6FA] flex items-center justify-center p-8">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 bg-red-500/15 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <h1 className="text-[#1A1D2E] font-bold text-xl mb-2">QC Record Not Found</h1>
          <p className="text-[#9898A8] text-sm">No inspection found for key: <code className="text-[#00C896]">{key}</code></p>
        </div>
      </div>
    )
  }

  const cfg = RESULT_CFG[inspection.overall_result] ?? RESULT_CFG.Pending

  return (
    <div className="min-h-screen bg-[#F5F6FA] flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-[#E4E6EE] rounded-2xl overflow-hidden shadow-sm">
        {/* Header */}
        <div className="px-6 py-5 border-b border-[#E4E6EE]">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-7 h-7 rounded-lg bg-[#00C896] flex items-center justify-center">
              <span className="text-black font-bold text-xs">bG</span>
            </div>
            <span className="text-[#1A1D2E] font-bold text-sm">beyondGREEN ERP</span>
          </div>
          <p className="text-[#5A5A6A] text-xs">QC Verification Certificate</p>
        </div>

        {/* Result banner */}
        <div className={`mx-6 mt-6 mb-4 border rounded-2xl p-5 text-center ${cfg.cls}`}>
          <div className="text-4xl font-bold mb-1">{cfg.icon}</div>
          <div className="text-xl font-bold tracking-wide">{cfg.label}</div>
        </div>

        {/* Details */}
        <div className="px-6 pb-6 space-y-3">
          {[
            { label: 'SKU', value: inspection.sku ?? '—' },
            { label: 'Product', value: inspection.product_name ?? '—' },
            { label: 'Batch Number', value: inspection.batch_number ?? '—' },
            { label: 'Inspection Type', value: inspection.inspection_type },
            { label: 'Date', value: inspection.inspection_date ? new Date(inspection.inspection_date + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—' },
            { label: 'Inspector', value: inspection.inspector_email?.split('@')[0] ?? '—' },
            { label: 'Qty Inspected', value: inspection.qty_inspected?.toLocaleString() ?? '0' },
            { label: 'Qty Passed', value: inspection.qty_passed?.toLocaleString() ?? '0' },
            { label: 'Qty Failed', value: inspection.qty_failed?.toLocaleString() ?? '0' },
          ].map(f => (
            <div key={f.label} className="flex items-center justify-between py-2 border-b border-[#E4E6EE] last:border-0">
              <span className="text-[#9898A8] text-xs">{f.label}</span>
              <span className="text-[#1A1D2E] text-xs font-medium">{f.value}</span>
            </div>
          ))}
          {inspection.notes && (
            <div className="bg-[#F5F6FA] border border-[#E4E6EE] rounded-xl p-3 mt-2">
              <p className="text-[#5A5A6A] text-[11px] uppercase tracking-wider mb-1">Notes</p>
              <p className="text-[#1A1D2E] text-xs">{inspection.notes}</p>
            </div>
          )}
        </div>

        <div className="px-6 pb-4 text-center">
          <p className="text-[#9CA3AF] text-[10px]">Verified by beyondGREEN ERP · ID: {inspection.id.slice(0, 8).toUpperCase()}</p>
        </div>
      </div>
    </div>
  )
}
