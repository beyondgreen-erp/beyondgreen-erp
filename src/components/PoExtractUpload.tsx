'use client'

import { useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface PoExtracted {
  po_number?: string | null
  customer_name?: string | null
  customer_email?: string | null
  order_date?: string | null
  ship_date?: string | null
  ship_to_address?: string | null
  payment_terms?: string | null
  currency?: string | null
  subtotal?: number | null
  tax?: number | null
  total?: number | null
  line_items?: { sku?: string | null; description?: string | null; quantity?: number | null; unit_price?: number | null; line_total?: number | null }[]
  raw?: string
}

interface Props {
  salesOrderId: string
  onExtracted?: (data: PoExtracted, path: string) => void
}

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp'

export default function PoExtractUpload({ salesOrderId, onExtracted }: Props) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState('')
  const [err, setErr] = useState('')
  const [data, setData] = useState<PoExtracted | null>(null)
  const [path, setPath] = useState('')
  const [fileName, setFileName] = useState('')

  async function handleFile(file: File) {
    setErr(''); setData(null); setBusy(true); setFileName(file.name)
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const p = `${salesOrderId}/${Date.now()}_${safe}`
      setStage('Uploading...')
      const up = await sb.storage.from('po-documents').upload(p, file, { upsert: true, contentType: file.type || undefined })
      if (up.error) throw new Error('Upload failed: ' + up.error.message)
      setPath(p)
      setStage('Reading the PO with AI...')
      const { data: res, error: fnErr } = await sb.functions.invoke('extract-po', { body: { path: p, salesOrderId } })
      if (fnErr) throw new Error('Extraction failed: ' + fnErr.message)
      if ((res as any)?.error) throw new Error((res as any).error)
      const extracted = (res as any)?.extracted as PoExtracted
      if (!extracted) throw new Error('No data returned from extractor.')
      setData(extracted)
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setBusy(false); setStage('')
    }
  }

  const fmt$ = (n: number | null | undefined) =>
    n == null ? '-' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

  return (
    <div className="rounded-lg border border-[#E4E6EE] bg-[#F9FAFB]/40 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
          Upload PO &amp; Extract
        </p>
        <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
          className="text-xs px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-blue-300 text-white font-medium transition-colors">
          {busy ? 'Working...' : 'Choose file'}
        </button>
        <input ref={inputRef} type="file" accept={ACCEPT} className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}/>
      </div>

      <p className="text-[11px] text-gray-500">PDF or image of the customer PO. We&apos;ll store it and auto-read the key fields.</p>

      {busy && <p className="text-xs text-blue-600 flex items-center gap-2"><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>{stage}</p>}

      {err && <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}

      {data && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
            Extracted from {fileName}
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs bg-white rounded-lg border border-[#E4E6EE] p-2.5">
            <Field label="PO #" value={data.po_number}/>
            <Field label="Customer" value={data.customer_name}/>
            <Field label="Email" value={data.customer_email}/>
            <Field label="Order Date" value={data.order_date}/>
            <Field label="Ship Date" value={data.ship_date}/>
            <Field label="Total" value={data.total == null ? null : fmt$(data.total)}/>
            <div className="col-span-2"><Field label="Ship To" value={data.ship_to_address}/></div>
          </div>
          {Array.isArray(data.line_items) && data.line_items.length > 0 && (
            <div className="bg-white rounded-lg border border-[#E4E6EE] overflow-hidden">
              <table className="w-full text-[11px]">
                <thead><tr className="border-b border-[#E4E6EE] text-gray-500"><th className="text-left px-2 py-1.5">SKU</th><th className="text-left px-2 py-1.5">Description</th><th className="text-right px-2 py-1.5">Qty</th><th className="text-right px-2 py-1.5">Unit</th></tr></thead>
                <tbody>
                  {data.line_items.slice(0, 25).map((li, i) => (
                    <tr key={i} className="border-b border-[#F3F4F6] last:border-0">
                      <td className="px-2 py-1.5 font-mono text-emerald-600">{li.sku || '-'}</td>
                      <td className="px-2 py-1.5 text-gray-700">{li.description || '-'}</td>
                      <td className="px-2 py-1.5 text-right text-gray-600">{li.quantity ?? '-'}</td>
                      <td className="px-2 py-1.5 text-right text-gray-600">{li.unit_price == null ? '-' : fmt$(li.unit_price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {onExtracted && (
            <button type="button" onClick={() => onExtracted(data, path)}
              className="w-full text-xs px-3 py-2 rounded-lg border border-blue-500/40 bg-blue-50 text-blue-600 hover:bg-blue-100 font-medium transition-colors">
              Apply to order fields
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <span className="text-gray-400">{label}: </span>
      <span className="text-gray-800 break-words">{value || '-'}</span>
    </div>
  )
}
