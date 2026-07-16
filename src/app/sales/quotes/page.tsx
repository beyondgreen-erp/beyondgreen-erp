'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase'

type Src = 'quote' | 'costing'
interface Row {
  key: string
  id: string
  source: Src
  quote_number: string
  customer: string
  status: string
  date: string | null
  value: number
  margin: number | null
  lines: number | null
  created_at: string
  href: string
}

const STATUS_ORDER = ['Draft', 'Sent', 'Accepted', 'Converted', 'Rejected', 'Expired']
const STATUS_HEX: Record<string, string> = {
  Draft: '#9699A6', Sent: '#0086C0', Accepted: '#00A84F', Converted: '#A25DDC', Rejected: '#E2445C', Expired: '#FDAB3D',
}
const statusHex = (s: string | null) => (s && STATUS_HEX[s]) || '#c4c4c4'
const money = (n: number, dec = 2) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
const fmtD = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
const marginColor = (p: number) => p >= 40 ? '#00A84F' : p >= 25 ? '#FDAB3D' : '#E2445C'

function Stat({ label, value, c }: { label: string; value: string | number; c?: string }) {
  return (
    <div className="mon-stat stat-card" style={c ? ({ ['--c']: c } as any) : undefined}>
      <p className="text-xs font-semibold text-gray-400">{label}</p>
      <p className="mon-stat-val mt-0.5">{typeof value === 'number' ? value.toLocaleString() : value}</p>
    </div>
  )
}

export default function QuotesBoardPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [statusOpen, setStatusOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: qs }, { data: cs }, { data: custs }, { data: qLines }] = await Promise.all([
      sb.from('quotations').select('*').eq('is_active', true).order('created_at', { ascending: false }),
      sb.from('quote_costing').select('*').order('created_at', { ascending: false }),
      sb.from('customers').select('id, company_name'),
      sb.from('quotation_lines').select('quotation_id'),
    ])
    const custMap: Record<string, string> = {}
    for (const c of (custs as any[]) || []) custMap[c.id] = c.company_name
    const lineCounts: Record<string, number> = {}
    for (const l of (qLines as any[]) || []) lineCounts[l.quotation_id] = (lineCounts[l.quotation_id] || 0) + 1

    const out: Row[] = []
    for (const q of (qs as any[]) || []) {
      out.push({
        key: 'q-' + q.id, id: q.id, source: 'quote',
        quote_number: q.quote_number || '—',
        customer: custMap[q.customer_id] || '—',
        status: q.status || 'Draft',
        date: q.quote_date,
        value: Number(q.total ?? q.total_value ?? q.subtotal ?? 0),
        margin: null,
        lines: lineCounts[q.id] || 0,
        created_at: q.created_at,
        href: `/sales/quotations?item=${q.id}`,
      })
    }
    for (const c of (cs as any[]) || []) {
      out.push({
        key: 'c-' + c.id, id: c.id, source: 'costing',
        quote_number: c.quote_number || '—',
        customer: c.customer_name || custMap[c.customer_id] || '—',
        status: c.status || 'Draft',
        date: c.quote_date,
        value: Number(c.total_selling_price ?? 0),
        margin: c.avg_margin_pct != null ? Number(c.avg_margin_pct) : null,
        lines: null,
        created_at: c.created_at,
        href: `/sales/costing?item=${c.id}`,
      })
    }
    setRows(out); setLoading(false)
  }, [sb])
  useEffect(() => { load() }, [load])

  async function setStatus(row: Row, status: string) {
    setRows(rs => rs.map(r => r.key === row.key ? { ...r, status } : r))
    const table = row.source === 'costing' ? 'quote_costing' : 'quotations'
    await sb.from(table).update({ status, updated_at: new Date().toISOString() }).eq('id', row.id)
  }

  const q = search.trim().toLowerCase()
  const match = (r: Row) => !q || r.quote_number.toLowerCase().includes(q) || r.customer.toLowerCase().includes(q) || r.status.toLowerCase().includes(q)
  const shown = rows.filter(match)

  const groups = useMemo(() => {
    const present = Array.from(new Set(rows.map(r => r.status || 'Draft')))
    const ordered = [...STATUS_ORDER.filter(s => present.includes(s)), ...present.filter(s => !STATUS_ORDER.includes(s))]
    return ordered.map(key => ({ key, color: STATUS_HEX[key] || '#9699A6' }))
  }, [rows])

  const totalValue = rows.reduce((a, r) => a + r.value, 0)
  const pipelineValue = rows.filter(r => r.status === 'Draft' || r.status === 'Sent').reduce((a, r) => a + r.value, 0)
  const accepted = rows.filter(r => r.status === 'Accepted').length
  const costingRows = rows.filter(r => r.margin != null)
  const avgMargin = costingRows.length ? costingRows.reduce((a, r) => a + (r.margin || 0), 0) / costingRows.length : 0

  const StatusCell = ({ r }: { r: Row }) => (
    <div className="relative" onClick={e => e.stopPropagation()}>
      <button onClick={() => setStatusOpen(statusOpen === r.key ? null : r.key)} className="text-white text-[11px] font-semibold rounded-full px-2.5 py-1 text-center truncate min-w-[84px]" style={{ background: statusHex(r.status) }}>{r.status}</button>
      {statusOpen === r.key && (<>
        <div className="fixed inset-0 z-10" onClick={() => setStatusOpen(null)} />
        <div className="absolute z-20 mt-1 left-0 w-40 bg-white rounded-lg shadow-xl border border-[#E4E6EE] p-1">
          {STATUS_ORDER.map(s => <button key={s} onClick={() => { setStatus(r, s); setStatusOpen(null) }} className="block w-full text-white text-[11px] font-semibold rounded px-2 py-1.5 mb-1 text-center" style={{ background: STATUS_HEX[s] }}>{s}</button>)}
        </div></>)}
    </div>
  )

  return (
    <div className="min-h-screen mon-page p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <span className="mon-tag t-blue">📄 Quotes &amp; Costing</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">Quotes &amp; Costing</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${shown.length} of ${rows.length} quotes · simple quotations + cost-built quotes in one board`}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => router.push('/sales/costing')} className="mon-btn">+ New Costing Quote</button>
          <button onClick={() => router.push('/sales/quotations')} className="text-sm font-medium px-4 py-2.5 rounded-lg border border-[#E4E6EE] text-gray-600 hover:text-[#1A1D2E] hover:bg-[#F0F1F5]">+ Simple Quote</button>
        </div>
      </div>

      {!loading && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
          <Stat label="Total Quotes" value={rows.length} c="#0086C0" />
          <Stat label="Total Value" value={money(totalValue, 0)} c="#00A84F" />
          <Stat label="Pipeline (Draft+Sent)" value={money(pipelineValue, 0)} c="#FDAB3D" />
          <Stat label="Accepted" value={accepted} c="#00A84F" />
          <Stat label="Avg Costing Margin" value={avgMargin ? avgMargin.toFixed(1) + '%' : '—'} c="#A25DDC" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input placeholder="Search quote #, customer, status…" value={search} onChange={e => setSearch(e.target.value)} className="flex-1 min-w-[240px] max-w-md bg-white border border-[#E4E6EE] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <div className="flex items-center gap-1.5 ml-auto text-xs">
          <button onClick={() => setCollapsed(Object.fromEntries(groups.map(g => [g.key, true])))} className="px-2.5 py-1.5 rounded-md text-gray-500 hover:bg-[#F0F2F7]">Collapse all</button>
          <button onClick={() => setCollapsed({})} className="px-2.5 py-1.5 rounded-md text-gray-500 hover:bg-[#F0F2F7]">Expand all</button>
        </div>
      </div>

      {loading ? <p className="text-gray-400 text-sm">Loading…</p> : rows.length === 0 ? (
        <p className="text-gray-400 text-sm">No quotes yet.</p>
      ) : (
        <div className="space-y-2.5 mb-6">
          {groups.map(group => {
            const gr = shown.filter(r => (r.status || 'Draft') === group.key).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
            if (!gr.length) return null
            const isCol = collapsed[group.key]
            const gv = gr.reduce((a, r) => a + r.value, 0)
            return (
              <div key={group.key} className="bg-white rounded-xl overflow-hidden shadow-sm border border-[#ECEEF3]">
                <div className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none" style={{ background: group.color + '14', borderLeft: '5px solid ' + group.color }} onClick={() => setCollapsed(c => ({ ...c, [group.key]: !c[group.key] }))}>
                  <span className="text-[10px]" style={{ color: group.color, display: 'inline-block', transform: isCol ? 'none' : 'rotate(90deg)' }}>&#9654;</span>
                  <span className="font-bold text-sm" style={{ color: group.color }}>{group.key}</span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: group.color + '26', color: group.color }}>{gr.length}</span>
                  <span className="ml-auto text-[12px] font-bold" style={{ color: group.color }}>{money(gv)}</span>
                </div>
                {!isCol && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[880px]">
                      <thead>
                        <tr className="border-b border-[#EEF0F4] text-[11px] uppercase tracking-wide text-gray-400 bg-[#FBFCFE]">
                          <th className="text-left font-semibold px-4 py-2 w-[140px]">Quote #</th>
                          <th className="text-left font-semibold px-4 py-2 min-w-[200px]">Customer</th>
                          <th className="text-left font-semibold px-4 py-2 w-[110px]">Type</th>
                          <th className="text-left font-semibold px-4 py-2 w-[130px]">Status</th>
                          <th className="text-left font-semibold px-4 py-2 w-[120px]">Date</th>
                          <th className="text-right font-semibold px-4 py-2 w-[120px]">Value</th>
                          <th className="text-right font-semibold px-4 py-2 w-[100px]">Margin</th>
                          <th className="w-8" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EAECF2]">
                        {gr.map((r, i) => (
                          <tr key={r.key} className={`group mon-row cursor-pointer ${i % 2 ? 'bg-[#F6F8FB]' : 'bg-white'}`} onClick={() => router.push(r.href)}>
                            <td className="px-4 py-2.5 text-[13px] font-medium text-gray-800 font-mono">{r.quote_number}</td>
                            <td className="px-4 py-2.5 text-[13px] text-gray-700">{r.customer}</td>
                            <td className="px-4 py-2.5">
                              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={r.source === 'costing' ? { background: '#F4EAFB', color: '#6C2FA0' } : { background: '#E4F2FA', color: '#03567A' }}>{r.source === 'costing' ? 'Costing' : 'Quote'}</span>
                            </td>
                            <td className="px-4 py-2.5"><StatusCell r={r} /></td>
                            <td className="px-4 py-2.5 text-[13px] text-gray-600">{fmtD(r.date)}</td>
                            <td className="px-4 py-2.5 text-[13px] text-right font-bold tabular-nums text-emerald-600">{money(r.value)}</td>
                            <td className="px-4 py-2.5 text-[13px] text-right font-semibold tabular-nums" style={{ color: r.margin != null ? marginColor(r.margin) : '#C4C4C4' }}>{r.margin != null ? r.margin.toFixed(1) + '%' : '—'}</td>
                            <td className="text-center text-gray-300 group-hover:text-gray-500"><i className="ti ti-chevron-right" /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
