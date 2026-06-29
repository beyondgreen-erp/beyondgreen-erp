'use client'
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { getFileUrl } from '@/lib/fileHelpers'

interface ExRow {
  id: string
  po_number: string | null
  report_date: string | null
  centerpoint: string | null
  delivery_no: string | null
  carrier_name: string | null
  over: boolean | null
  short: boolean | null
  damaged: boolean | null
  comment_in_report: string | null
  po_freight_bill_qty: number | null
  over_qty: number | null
  short_qty: number | null
  damaged_qty: number | null
  claim_penalty: string | null
  exception_report_file: string | null
  source: string | null
}

const CLAIM = ['', 'Filing Claim', 'No', 'Yes']
const claimStyle = (c: string | null) =>
  c === 'Yes' ? 'bg-red-50 text-red-700 border-red-200'
  : c === 'Filing Claim' ? 'bg-amber-50 text-amber-700 border-amber-200'
  : c === 'No' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
  : 'bg-gray-50 text-gray-500 border-gray-200'
const fmtD = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

export default function BusinessReportsPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<ExRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await sb.from('exception_reports').select('*')
      .order('report_date', { ascending: false, nullsFirst: false }).order('delivery_no', { ascending: false })
    setRows((data as ExRow[]) || [])
    setLoading(false)
  }, [sb])
  useEffect(() => { load(); sb.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email) }) }, [load, sb])

  const filtered = rows.filter(r => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (r.po_number || '').toLowerCase().includes(q) || (r.delivery_no || '').toLowerCase().includes(q)
      || (r.carrier_name || '').toLowerCase().includes(q) || (r.comment_in_report || '').toLowerCase().includes(q)
  })

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (file) await handleUpload(file)
    if (fileRef.current) fileRef.current.value = ''
  }
  async function handleUpload(file: File) {
    setUploading(true); setErr(''); setMsg('')
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `exception_reports/_inbox/${Date.now()}_${safe}`
      const { error: upErr } = await sb.storage.from('erp-files').upload(path, file, { cacheControl: '3600', upsert: true })
      if (upErr) throw new Error(upErr.message)
      const res = await fetch('/api/exception-reports/extract', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storagePath: path, fileName: file.name, uploadedBy: userEmail }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'AI extraction failed')
      setMsg(`Added ${j.inserted} line item${j.inserted === 1 ? '' : 's'}${j.delivery_no ? ` from delivery ${j.delivery_no}` : ''}.`)
      await load()
    } catch (e) { setErr((e as Error).message) }
    setUploading(false)
  }

  async function viewFile(path: string | null) {
    if (!path) return
    const url = await getFileUrl(sb, path); if (url) window.open(url, '_blank')
  }
  async function updateClaim(id: string, claim: string) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, claim_penalty: claim || null } : r))
    await sb.from('exception_reports').update({ claim_penalty: claim || null, updated_at: new Date().toISOString() }).eq('id', id)
  }
  async function deleteRow(r: ExRow) {
    if (!confirm(`Delete exception line for PO ${r.po_number || ''}? It will move to the Recycle Bin and can be restored.`)) return
    const { error } = await sb.from('exception_reports').delete().eq('id', r.id)
    if (error) { alert(error.message); return }
    load()
  }

  const th = 'text-left text-xs font-semibold text-gray-500 px-3 py-2.5 whitespace-nowrap'
  const td = 'px-3 py-2.5 text-sm text-gray-700 whitespace-nowrap'
  const flag = (on: boolean | null) => on
    ? <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
    : <span className="inline-block w-2 h-2 rounded-full bg-gray-200" />

  return (
    <div className="min-h-screen p-8" style={{ background: '#F5F6FA' }}>
      <div className="mb-6">
        <p className="text-xs font-semibold text-indigo-600 uppercase tracking-widest mb-1">BUSINESS REPORTS</p>
        <h1 className="text-3xl font-bold text-gray-900 mb-1">Business Reports</h1>
        <p className="text-gray-500 text-sm">Reports and analytics for beyondGREEN operations.</p>
      </div>

      {/* Exception Reports report */}
      <div className="bg-white rounded-2xl border border-[#E4E6EE] overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4 border-b border-[#E4E6EE]">
          <div>
            <h2 className="text-lg font-bold text-[#1A1D2E]">Exception Reports</h2>
            <p className="text-xs text-gray-500 mt-0.5">{loading ? 'Loading…' : `${filtered.length} line${filtered.length === 1 ? '' : 's'}`} · Walmart OS&amp;D / delivery exceptions</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <i className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
              <input placeholder="Search PO, delivery…" value={search} onChange={e => setSearch(e.target.value)}
                className="bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <input ref={fileRef} type="file" accept=".pdf,image/*" onChange={onFile} className="hidden" />
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
              {uploading ? <><i className="ti ti-loader-2 animate-spin" />Reading…</> : <><i className="ti ti-upload" />Upload Exception Report</>}
            </button>
          </div>
        </div>

        {(msg || err) && (
          <div className={`mx-6 mt-3 text-sm px-3 py-2 rounded-lg border ${err ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
            {err || msg}
          </div>
        )}

        <div className="overflow-x-auto">
          {loading ? <div className="flex justify-center py-16"><i className="ti ti-loader-2 animate-spin text-gray-300 text-2xl" /></div>
          : filtered.length === 0 ? <div className="text-center py-16 text-gray-400 text-sm">No exception reports yet — upload one to get started.</div>
          : <table className="w-full min-w-[1100px]">
              <thead><tr className="bg-[#FAFBFC] border-b border-[#E4E6EE]">
                {['PO #', 'Date', 'Delivery No.', 'CenterPoint', 'Carrier', 'Over', 'Short', 'Damaged', 'Freight Qty', 'Over Qty', 'Short Qty', 'Dmg Qty', 'Claim Penalty', 'Comment', 'File', ''].map(h =>
                  <th key={h} className={th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={r.id} className={`border-b border-[#F3F4F6] hover:bg-[#F9FAFB] ${i % 2 ? 'bg-[#FCFCFD]' : ''}`}>
                    <td className={td + ' font-mono font-semibold text-[#1A1D2E]'}>{r.po_number || '—'}</td>
                    <td className={td}>{fmtD(r.report_date)}</td>
                    <td className={td + ' font-mono'}>{r.delivery_no || '—'}</td>
                    <td className={td}>{r.centerpoint || '—'}</td>
                    <td className={td}>{r.carrier_name || '—'}</td>
                    <td className={td}>{flag(r.over)}</td>
                    <td className={td}>{flag(r.short)}</td>
                    <td className={td}>{flag(r.damaged)}</td>
                    <td className={td + ' text-right tabular-nums'}>{r.po_freight_bill_qty ?? '—'}</td>
                    <td className={td + ' text-right tabular-nums'}>{r.over_qty ?? 0}</td>
                    <td className={td + ' text-right tabular-nums font-semibold ' + ((r.short_qty || 0) > 0 ? 'text-red-600' : '')}>{r.short_qty ?? 0}</td>
                    <td className={td + ' text-right tabular-nums'}>{r.damaged_qty ?? 0}</td>
                    <td className={td}>
                      <select value={r.claim_penalty || ''} onChange={e => updateClaim(r.id, e.target.value)}
                        className={`text-xs font-medium border rounded-full px-2 py-1 cursor-pointer focus:outline-none ${claimStyle(r.claim_penalty)}`}>
                        {CLAIM.map(c => <option key={c} value={c}>{c || '—'}</option>)}
                      </select>
                    </td>
                    <td className={td + ' max-w-[160px] truncate text-gray-500'} title={r.comment_in_report || ''}>{r.comment_in_report || '—'}</td>
                    <td className={td}>
                      {r.exception_report_file
                        ? <button onClick={() => viewFile(r.exception_report_file)} className="text-indigo-600 hover:text-indigo-800" title="View source file"><i className="ti ti-file-text text-base" /></button>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className={td}>
                      <button onClick={() => deleteRow(r)} className="text-gray-400 hover:text-red-600" title="Delete (to Recycle Bin)"><i className="ti ti-trash text-base" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>}
        </div>
      </div>
    </div>
  )
}
