'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

// ─────────────────────────── shared helpers ───────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_KEYS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const MONTH_HEX: Record<string, string> = { Jan: '#0086C0', Feb: '#9D50DD', Mar: '#00C875', Apr: '#FDAB3D', May: '#E2445C', Jun: '#2B76E5', Jul: '#00A89D', Aug: '#FF9900', Sep: '#037f4c', Oct: '#df2f4a', Nov: '#579bfc', Dec: '#9d50dd' }
const money = (n: number, dec = 2) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
const fmtD = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
function monthIdx(title: string) { const t = (title || '').trim().toLowerCase(); return MONTH_KEYS.findIndex(k => t.includes(k)) }
function monthColorFromTitle(title: string) { const i = monthIdx(title); return i >= 0 ? MONTH_HEX[MONTHS[i]] : '#9699A6' }

// Known Monday status label colors; anything else gets a stable hashed color.
const STATUS_HEX: Record<string, string> = {
  'Complete': '#216edf', 'Shipped': '#00c875', 'Customer Canceled': '#df2f4a', 'Shipment Returned': '#fdab3d',
  'Will Call Pick-Up': '#9d50dd', 'Additional Task Required': '#bb3354', 'Close Lost': '#ff007f',
  'Paid': '#00c875', 'Invoice Sent': '#fdab3d', 'Overdue': '#df2f4a', 'Partial Payment': '#9cd326', 'Void': '#333333',
}
const HASH_PALETTE = ['#0086C0', '#00A84F', '#A25DDC', '#FDAB3D', '#E2445C', '#2B76E5', '#00A89D', '#9d50dd', '#579bfc', '#cab641', '#037f4c', '#bb3354']
function statusColor(v: string | null): string {
  if (!v) return '#c4c4c4'
  if (STATUS_HEX[v]) return STATUS_HEX[v]
  let h = 0; for (let i = 0; i < v.length; i++) h = (h * 31 + v.charCodeAt(i)) >>> 0
  return HASH_PALETTE[h % HASH_PALETTE.length]
}

function Stat({ label, value, c }: { label: string; value: string | number; c?: string }) {
  return (
    <div className="mon-stat stat-card" style={c ? ({ ['--c']: c } as any) : undefined}>
      <p className="text-xs font-semibold text-gray-400">{label}</p>
      <p className="mon-stat-val mt-0.5">{typeof value === 'number' ? value.toLocaleString() : value}</p>
    </div>
  )
}

// ─────────────────────────── config ───────────────────────────
type Col = { key: string; label: string; type: 'text' | 'date' | 'num' | 'money' | 'status'; w?: string; mono?: boolean; options?: { label: string; hex: string }[] }
type PipelineCfg = { boardKey: string; title: string; tag: string; year: string; columns: Col[]; money?: string }

const STATUS3: { label: string; hex: string }[] = [
  { label: 'Shipped', hex: '#00c875' }, { label: 'Complete', hex: '#216edf' }, { label: 'Will Call Pick-Up', hex: '#9d50dd' },
  { label: 'Customer Canceled', hex: '#df2f4a' }, { label: 'Shipment Returned', hex: '#fdab3d' },
  { label: 'Additional Task Required', hex: '#bb3354' }, { label: 'Close Lost', hex: '#ff007f' },
]
const PAY: { label: string; hex: string }[] = [
  { label: 'Paid', hex: '#00c875' }, { label: 'Invoice Sent', hex: '#fdab3d' }, { label: 'Overdue', hex: '#df2f4a' },
  { label: 'Partial Payment', hex: '#9cd326' }, { label: 'Void', hex: '#333333' },
]
const baseCols: Col[] = [
  { key: 'name', label: 'Order / Customer', type: 'text', w: 'min-w-[220px]' },
  { key: 'status', label: 'Status', type: 'status', w: 'w-[170px]', options: STATUS3 },
  { key: 'order_date', label: 'Order Date', type: 'date', w: 'w-[120px]' },
  { key: 'ship_date', label: 'Ship Date', type: 'date', w: 'w-[120px]' },
  { key: 'po', label: 'PO #', type: 'text', w: 'w-[110px]', mono: true },
  { key: 'email', label: 'Customer Email', type: 'text', w: 'min-w-[170px]' },
  { key: 'tracking', label: 'Tracking #', type: 'text', w: 'w-[150px]', mono: true },
  { key: 'payment_status', label: 'Payment', type: 'status', w: 'w-[140px]', options: PAY },
]
const shipCostCol: Col = { key: 'ship_cost', label: 'Ship Cost', type: 'money', w: 'w-[110px]' }

const PIPELINES: Record<string, PipelineCfg> = {
  'pipeline-2025': { boardKey: 'pipeline-2025', title: '2025 Pipeline', tag: '📚 2025 Pipeline', year: '2025', columns: [...baseCols, shipCostCol], money: 'ship_cost' },
  'pipeline-2024': { boardKey: 'pipeline-2024', title: '2024 Pipeline', tag: '📚 2024 Pipeline', year: '2024', columns: [...baseCols, shipCostCol], money: 'ship_cost' },
  'pipeline-2023': { boardKey: 'pipeline-2023', title: '2023 Pipeline', tag: '📚 2023 Pipeline', year: '2023', columns: [...baseCols, shipCostCol], money: 'ship_cost' },
  'pipeline-2022': { boardKey: 'pipeline-2022', title: '2022 Pipeline', tag: '📚 2022 Pipeline', year: '2022', columns: baseCols },
  'pipeline-2021': { boardKey: 'pipeline-2021', title: '2021 Pipeline', tag: '📚 2021 Pipeline', year: '2021', columns: baseCols },
  'pipeline-2020': {
    boardKey: 'pipeline-2020', title: '2020 Pipeline', tag: '📚 2020 Pipeline', year: '2020',
    columns: [...baseCols, { key: 'invoice_total', label: 'Invoice Total', type: 'money', w: 'w-[120px]' }, { key: 'ship_cost', label: 'Open Amt', type: 'money', w: 'w-[110px]' }],
    money: 'invoice_total',
  },
}

// ─────────────────────────── Pipeline board ───────────────────────────
function PipelineBoard({ cfg }: { cfg: PipelineCfg }) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [edit, setEdit] = useState<{ id: string; field: string } | null>(null)
  const [statusOpen, setStatusOpen] = useState<{ id: string; field: string } | null>(null)
  const dragId = useRef<string | null>(null)
  const inited = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    const all: any[] = []
    for (let from = 0; ; from += 1000) {
      const { data } = await sb.from('pipeline_orders').select('*').eq('board_key', cfg.boardKey).order('position', { ascending: true, nullsFirst: false }).range(from, from + 999)
      const batch = data || []; all.push(...batch)
      if (batch.length < 1000) break
    }
    setRows(all); setLoading(false)
  }, [sb, cfg.boardKey])
  useEffect(() => { load() }, [load])

  async function patch(id: string, obj: any) {
    setRows(rs => rs.map(r => r.id === id ? { ...r, ...obj } : r))
    await sb.from('pipeline_orders').update({ ...obj, updated_at: new Date().toISOString() }).eq('id', id)
  }
  async function addItem(group: string) {
    const max = Math.max(0, ...rows.filter(r => (r.group_name || '') === group).map(r => r.position || 0))
    const { data } = await sb.from('pipeline_orders').insert({ board_key: cfg.boardKey, group_name: group, position: max + 1000 }).select('*').single()
    if (data) { setRows(rs => [...rs, data]); setEdit({ id: (data as any).id, field: 'name' }) }
  }
  async function del(id: string) {
    if (!confirm('Delete this order?')) return
    setRows(rs => rs.filter(r => r.id !== id)); await sb.from('pipeline_orders').delete().eq('id', id)
  }
  function onDrop(group: string, beforeId: string | null) {
    const id = dragId.current; dragId.current = null; if (!id) return
    const list = rows.filter(r => (r.group_name || '') === group && r.id !== id).sort((a, b) => (a.position || 0) - (b.position || 0))
    let idx = beforeId ? list.findIndex(r => r.id === beforeId) : list.length; if (idx < 0) idx = list.length
    const prev = list[idx - 1]?.position, next = list[idx]?.position
    const pos = prev != null && next != null ? (prev + next) / 2 : prev != null ? prev + 1000 : next != null ? next - 1000 : 1000
    patch(id, { group_name: group, position: pos })
  }

  const q = search.trim().toLowerCase()
  const match = (r: any) => !q || cfg.columns.some(c => String(r[c.key] ?? '').toLowerCase().includes(q))
  const groupRows = (key: string) => rows.filter(r => (r.group_name || '') === key && match(r)).sort((a, b) => (a.position || 0) - (b.position || 0))

  // month groups, newest month on top
  const groups = useMemo(() => {
    const keys = Array.from(new Set(rows.map(r => r.group_name || '(no month)')))
    return keys.map(k => ({ key: k, color: monthColorFromTitle(k), idx: monthIdx(k) }))
      .sort((a, b) => (b.idx - a.idx) || a.key.localeCompare(b.key))
  }, [rows])

  // default: collapse all but the newest month (perf on big boards)
  useEffect(() => {
    if (!inited.current && groups.length) {
      inited.current = true
      setCollapsed(Object.fromEntries(groups.slice(1).map(g => [g.key, true])))
    }
  }, [groups])

  // stats: total orders + top statuses + money sum
  const stats = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const r of rows) { const s = r.status || '—'; counts[s] = (counts[s] || 0) + 1 }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4)
    const out: { label: string; value: string | number; c: string }[] = [{ label: 'Total Orders', value: rows.length, c: '#0086C0' }]
    for (const [label, n] of top) out.push({ label, value: n, c: statusColor(label === '—' ? null : label) })
    if (cfg.money) out.push({ label: cfg.money === 'invoice_total' ? 'Invoice Total' : 'Ship Cost', value: money(rows.reduce((a, r) => a + (Number(r[cfg.money as string]) || 0), 0), 0), c: '#00A84F' })
    return out
  }, [rows, cfg.money])

  const shown = groups.reduce((a, g) => a + groupRows(g.key).length, 0)
  const inpCls = 'w-full bg-white border border-[#0086C0] rounded px-2 py-1 text-[13px] focus:outline-none'

  const Cell = ({ r, col }: { r: any; col: Col }) => {
    const val = r[col.key]
    if (col.type === 'status') {
      const opts = col.options || []
      const isOpen = statusOpen?.id === r.id && statusOpen?.field === col.key
      return (
        <div className="relative">
          <button onClick={() => setStatusOpen(isOpen ? null : { id: r.id, field: col.key })} className="w-full text-white text-[11px] font-semibold rounded-full px-2 py-1 text-center truncate" style={{ background: val ? statusColor(val) : '#c4c4c4' }}>{val || '—'}</button>
          {isOpen && (<>
            <div className="fixed inset-0 z-10" onClick={() => setStatusOpen(null)} />
            <div className="absolute z-20 mt-1 left-0 w-48 bg-white rounded-lg shadow-xl border border-[#E4E6EE] p-1 max-h-64 overflow-y-auto">
              {opts.map(s => <button key={s.label} onClick={() => { patch(r.id, { [col.key]: s.label }); setStatusOpen(null) }} className="block w-full text-white text-[11px] font-semibold rounded px-2 py-1.5 mb-1 text-center" style={{ background: s.hex }}>{s.label}</button>)}
              <button onClick={() => { patch(r.id, { [col.key]: null }); setStatusOpen(null) }} className="block w-full text-gray-500 text-[11px] rounded px-2 py-1.5 hover:bg-gray-100">Clear</button>
            </div></>)}
        </div>
      )
    }
    const editing = edit?.id === r.id && edit?.field === col.key
    if (editing) {
      const t = col.type === 'date' ? 'date' : (col.type === 'money' ? 'number' : 'text')
      return <input type={t} step="0.01" autoFocus defaultValue={val ?? ''}
        onBlur={e => { const v = e.target.value; patch(r.id, { [col.key]: v === '' ? null : col.type === 'money' ? Number(v) : v.trim() }); setEdit(null) }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEdit(null) }}
        className={inpCls + (col.type === 'money' ? ' text-right' : '')} />
    }
    const show = col.type === 'date' ? fmtD(val) : col.type === 'money' ? (val == null ? '' : money(Number(val))) : (val || '')
    return <div onClick={() => setEdit({ id: r.id, field: col.key })} className={`cursor-text min-h-[22px] rounded px-1 hover:bg-[#F0F4F9] ${col.type === 'money' ? 'text-right tabular-nums' : ''} ${col.mono ? 'font-mono text-xs text-gray-500' : ''}`}>{show || <span className="text-gray-300">+</span>}</div>
  }

  const NC = cfg.columns.length + 1
  return (
    <div className="min-h-screen mon-page p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <span className="mon-tag">{cfg.tag}</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">{cfg.title}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${shown} of ${rows.length} orders`}</p>
        </div>
        <button onClick={() => addItem(groups[0]?.key || 'December')} className="mon-btn">+ New order</button>
      </div>

      {!loading && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
          {stats.map(s => <Stat key={s.label} {...s} />)}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input placeholder="Search order, customer, PO, tracking…" value={search} onChange={e => setSearch(e.target.value)} className="flex-1 min-w-[240px] max-w-md bg-white border border-[#E4E6EE] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <div className="flex items-center gap-1.5 ml-auto text-xs">
          <button onClick={() => setCollapsed(Object.fromEntries(groups.map(g => [g.key, true])))} className="px-2.5 py-1.5 rounded-md text-gray-500 hover:bg-[#F0F2F7]">Collapse all</button>
          <button onClick={() => setCollapsed({})} className="px-2.5 py-1.5 rounded-md text-gray-500 hover:bg-[#F0F2F7]">Expand all</button>
        </div>
      </div>

      {loading ? <p className="text-gray-400 text-sm">Loading…</p> : (
        <div className="space-y-2.5 mb-6">
          {groups.map(group => {
            const gr = groupRows(group.key); const isCol = collapsed[group.key]
            const cost = cfg.money ? gr.reduce((a, r) => a + (Number(r[cfg.money as string]) || 0), 0) : 0
            return (
              <div key={group.key} className="bg-white rounded-xl overflow-hidden shadow-sm border border-[#ECEEF3]" onDragOver={e => e.preventDefault()} onDrop={() => onDrop(group.key, null)}>
                <div className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none" style={{ background: group.color + '14', borderLeft: '5px solid ' + group.color }} onClick={() => setCollapsed(c => ({ ...c, [group.key]: !c[group.key] }))}>
                  <span className="text-[10px]" style={{ color: group.color, display: 'inline-block', transform: isCol ? 'none' : 'rotate(90deg)' }}>&#9654;</span>
                  <span className="font-bold text-sm" style={{ color: group.color }}>{group.key}</span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: group.color + '26', color: group.color }}>{gr.length}</span>
                  {cost > 0 && <span className="ml-auto text-[11px] text-gray-400">{money(cost, 0)}</span>}
                </div>
                {!isCol && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[1000px]">
                      <thead>
                        <tr className="border-b border-[#EEF0F4] text-[11px] uppercase tracking-wide text-gray-400 bg-[#FBFCFE]">
                          <th className="w-6" />
                          {cfg.columns.map(c => <th key={c.key} className={`text-left font-semibold px-3 py-2 ${c.w || ''} ${c.type === 'money' ? 'text-right' : ''}`}>{c.label}</th>)}
                          <th className="w-8" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EAECF2]">
                        {gr.map((r, i) => (
                          <tr key={r.id} className={`group mon-row ${i % 2 ? 'bg-[#F6F8FB]' : 'bg-white'}`} onDragOver={e => e.preventDefault()} onDrop={() => onDrop(group.key, r.id)}>
                            <td className="text-center text-gray-300 group-hover:text-gray-500 cursor-grab" draggable onDragStart={() => { dragId.current = r.id }}>&#8942;&#8942;</td>
                            {cfg.columns.map(c => <td key={c.key} className="px-3 py-2.5 text-[13px] text-gray-700 align-top">{c.key === 'name' ? <span className="font-medium text-gray-800"><Cell r={r} col={c} /></span> : <Cell r={r} col={c} />}</td>)}
                            <td className="text-center"><button onClick={() => del(r.id)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"><i className="ti ti-trash" /></button></td>
                          </tr>
                        ))}
                        {gr.length === 0 && <tr><td colSpan={NC + 1} className="px-4 py-3 text-center text-gray-400 text-xs italic">Drop orders here or add one below</td></tr>}
                        <tr><td /><td colSpan={NC} className="px-3 py-2"><button onClick={() => addItem(group.key)} className="text-[13px] text-gray-400 hover:text-[#0086C0]">+ Add order</button></td></tr>
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

// ─────────────────────────── Daily Ship 2025 ───────────────────────────
const DS_CHANNELS: { field: string; label: string; color: string }[] = [
  { field: 'amazon', label: 'Amazon', color: '#FF9900' },
  { field: 'shopify', label: 'Shopify', color: '#00A84F' },
  { field: 'wayfair', label: 'Wayfair', color: '#7B2FBE' },
  { field: 'faire', label: 'Faire', color: '#E2445C' },
  { field: 'chewy', label: 'Chewy', color: '#2B76E5' },
  { field: 'b2b', label: 'B2B', color: '#A25DDC' },
]
const dsTotal = (r: any) => DS_CHANNELS.reduce((a, c) => a + (Number(r[c.field]) || 0), 0)

function DailyShip2025() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [statMode, setStatMode] = useState<'channel' | 'month'>('channel')
  const [edit, setEdit] = useState<{ id: string; field: string } | null>(null)
  const dragId = useRef<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await sb.from('historical_daily_ship').select('*').eq('board_key', 'daily-ship-2025').order('position', { ascending: true, nullsFirst: false })
    setRows(data || []); setLoading(false)
  }, [sb])
  useEffect(() => { load() }, [load])

  async function patch(id: string, obj: any) {
    setRows(rs => rs.map(r => r.id === id ? { ...r, ...obj } : r))
    await sb.from('historical_daily_ship').update({ ...obj, updated_at: new Date().toISOString() }).eq('id', id)
  }
  async function addItem(group: string) {
    const max = Math.max(0, ...rows.filter(r => (r.group_name || '') === group).map(r => r.position || 0))
    const { data } = await sb.from('historical_daily_ship').insert({ board_key: 'daily-ship-2025', group_name: group, position: max + 1000, amazon: 0, shopify: 0, wayfair: 0, faire: 0, chewy: 0, b2b: 0 }).select('*').single()
    if (data) { setRows(rs => [...rs, data]); setEdit({ id: (data as any).id, field: 'name' }) }
  }
  async function del(id: string) {
    if (!confirm('Delete this row?')) return
    setRows(rs => rs.filter(r => r.id !== id)); await sb.from('historical_daily_ship').delete().eq('id', id)
  }
  function onDrop(group: string, beforeId: string | null) {
    const id = dragId.current; dragId.current = null; if (!id) return
    const list = rows.filter(r => (r.group_name || '') === group && r.id !== id).sort((a, b) => (a.position || 0) - (b.position || 0))
    let idx = beforeId ? list.findIndex(r => r.id === beforeId) : list.length; if (idx < 0) idx = list.length
    const prev = list[idx - 1]?.position, next = list[idx]?.position
    const pos = prev != null && next != null ? (prev + next) / 2 : prev != null ? prev + 1000 : next != null ? next - 1000 : 1000
    patch(id, { group_name: group, position: pos })
  }

  const q = search.trim().toLowerCase()
  const match = (r: any) => !q || (r.name || '').toLowerCase().includes(q) || (r.group_name || '').toLowerCase().includes(q) || (r.ship_date || '').includes(q)
  const groupRows = (key: string) => rows.filter(r => (r.group_name || '') === key && match(r)).sort((a, b) => (a.position || 0) - (b.position || 0))

  const groups = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const r of rows) { const key = r.group_name || '(no week)'; const d = r.ship_date || null; const cur = m.get(key); if (cur === undefined) m.set(key, d); else if (d && (!cur || d < cur)) m.set(key, d) }
    return [...m.entries()].map(([key, minDate]) => ({ key, color: monthColorFromTitle(key), minDate }))
      .sort((a, b) => (b.minDate || '0000').localeCompare(a.minDate || '0000') || b.key.localeCompare(a.key))
  }, [rows])

  const monthAgg = useMemo(() => {
    const m = new Map<string, { label: string; sort: number; total: number }>()
    for (const r of rows) {
      let label = 'Other', sort = 9999
      if (r.ship_date) { const d = new Date(r.ship_date + 'T00:00:00'); sort = d.getFullYear() * 12 + d.getMonth(); label = MONTHS[d.getMonth()] }
      else { const i = monthIdx(r.group_name || ''); if (i >= 0) { sort = 2025 * 12 + i; label = MONTHS[i] } }
      const cur = m.get(label) || { label, sort, total: 0 }; cur.total += dsTotal(r); m.set(label, cur)
    }
    return [...m.values()].sort((a, b) => a.sort - b.sort)
  }, [rows])

  const grand = rows.reduce((a, r) => a + dsTotal(r), 0)
  const shown = groups.reduce((a, g) => a + groupRows(g.key).length, 0)
  const inpCls = 'w-full bg-white border border-[#0086C0] rounded px-2 py-1 text-[13px] focus:outline-none'

  const Cell = ({ r, field, type = 'text', isMoney = false }: { r: any; field: string; type?: 'text' | 'date' | 'num'; isMoney?: boolean }) => {
    const editing = edit?.id === r.id && edit?.field === field
    const val = r[field]
    if (editing) {
      const t = type === 'date' ? 'date' : type === 'num' ? 'number' : 'text'
      return <input type={t} step="0.01" autoFocus defaultValue={val ?? ''}
        onBlur={e => { const v = e.target.value; patch(r.id, { [field]: v === '' ? (type === 'num' ? 0 : null) : type === 'num' ? Number(v) : v.trim() }); setEdit(null) }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEdit(null) }}
        className={inpCls + (type === 'num' ? ' text-right' : '')} />
    }
    const show = type === 'date' ? fmtD(val) : isMoney ? money(Number(val) || 0) : (val || '')
    return <div onClick={() => setEdit({ id: r.id, field })} className={`cursor-text min-h-[22px] rounded px-1 hover:bg-[#F0F4F9] ${type === 'num' ? 'text-right tabular-nums' : ''}`}>{show || <span className="text-gray-300">+</span>}</div>
  }
  const NC = 3 + DS_CHANNELS.length

  return (
    <div className="min-h-screen mon-page p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <span className="mon-tag">📦 Daily Ship 2025</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">Daily Ship Value 2025</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${shown} of ${rows.length} days · ${money(grand, 0)} shipped`}</p>
        </div>
        <button onClick={() => addItem(groups[0]?.key || '(no week)')} className="mon-btn">+ New day</button>
      </div>

      {!loading && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{statMode === 'channel' ? 'Total sales by channel' : 'Total sales by month'}</p>
            <div className="inline-flex rounded-lg border border-[#E4E6EE] bg-white p-0.5 text-xs">
              <button onClick={() => setStatMode('channel')} className={`px-3 py-1.5 rounded-md ${statMode === 'channel' ? 'bg-[#00A84F] text-white font-semibold' : 'text-gray-500 hover:bg-[#F0F2F7]'}`}>By Channel</button>
              <button onClick={() => setStatMode('month')} className={`px-3 py-1.5 rounded-md ${statMode === 'month' ? 'bg-[#00A84F] text-white font-semibold' : 'text-gray-500 hover:bg-[#F0F2F7]'}`}>By Month</button>
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <Stat label="Total Shipped" value={money(grand, 0)} c="#00A84F" />
            {statMode === 'channel'
              ? DS_CHANNELS.map(c => <Stat key={c.field} label={c.label} value={money(rows.reduce((a, r) => a + (Number(r[c.field]) || 0), 0), 0)} c={c.color} />)
              : monthAgg.map(mo => <Stat key={mo.label} label={mo.label} value={money(mo.total, 0)} c={MONTH_HEX[mo.label] || '#9699A6'} />)}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input placeholder="Search day, week, date…" value={search} onChange={e => setSearch(e.target.value)} className="flex-1 min-w-[240px] max-w-md bg-white border border-[#E4E6EE] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <div className="flex items-center gap-1.5 ml-auto text-xs">
          <button onClick={() => setCollapsed(Object.fromEntries(groups.map(g => [g.key, true])))} className="px-2.5 py-1.5 rounded-md text-gray-500 hover:bg-[#F0F2F7]">Collapse all</button>
          <button onClick={() => setCollapsed({})} className="px-2.5 py-1.5 rounded-md text-gray-500 hover:bg-[#F0F2F7]">Expand all</button>
        </div>
      </div>

      {loading ? <p className="text-gray-400 text-sm">Loading…</p> : (
        <div className="space-y-2.5 mb-6">
          {groups.map(group => {
            const gr = groupRows(group.key); const isCol = collapsed[group.key]
            const wk = gr.reduce((a, r) => a + dsTotal(r), 0)
            return (
              <div key={group.key} className="bg-white rounded-xl overflow-hidden shadow-sm border border-[#ECEEF3]" onDragOver={e => e.preventDefault()} onDrop={() => onDrop(group.key, null)}>
                <div className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none" style={{ background: group.color + '14', borderLeft: '5px solid ' + group.color }} onClick={() => setCollapsed(c => ({ ...c, [group.key]: !c[group.key] }))}>
                  <span className="text-[10px]" style={{ color: group.color, display: 'inline-block', transform: isCol ? 'none' : 'rotate(90deg)' }}>&#9654;</span>
                  <span className="font-bold text-sm" style={{ color: group.color }}>{group.key}</span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: group.color + '26', color: group.color }}>{gr.length}</span>
                  <span className="ml-auto text-[12px] font-bold" style={{ color: group.color }}>{money(wk)}</span>
                </div>
                {!isCol && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[880px]">
                      <thead>
                        <tr className="border-b border-[#EEF0F4] text-[11px] uppercase tracking-wide text-gray-400 bg-[#FBFCFE]">
                          <th className="w-6" />
                          <th className="text-left font-semibold px-3 py-2 w-[130px]">Day</th>
                          <th className="text-left font-semibold px-3 py-2 w-[120px]">Date</th>
                          {DS_CHANNELS.map(c => <th key={c.field} className="text-right font-semibold px-3 py-2 w-[100px]">{c.label}</th>)}
                          <th className="text-right font-semibold px-3 py-2 w-[120px]">Total</th>
                          <th className="w-8" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EAECF2]">
                        {gr.map((r, i) => (
                          <tr key={r.id} className={`group mon-row ${i % 2 ? 'bg-[#F6F8FB]' : 'bg-white'}`} onDragOver={e => e.preventDefault()} onDrop={() => onDrop(group.key, r.id)}>
                            <td className="text-center text-gray-300 group-hover:text-gray-500 cursor-grab" draggable onDragStart={() => { dragId.current = r.id }}>&#8942;&#8942;</td>
                            <td className="px-3 py-2.5 text-[13px] font-medium text-gray-800"><Cell r={r} field="name" /></td>
                            <td className="px-3 py-2.5 text-[13px] text-gray-600"><Cell r={r} field="ship_date" type="date" /></td>
                            {DS_CHANNELS.map(c => <td key={c.field} className="px-3 py-2.5 text-[13px] text-gray-700"><Cell r={r} field={c.field} type="num" isMoney /></td>)}
                            <td className="px-3 py-2.5 text-[13px] text-right font-bold tabular-nums" style={{ color: group.color }}>{money(dsTotal(r))}</td>
                            <td className="text-center"><button onClick={() => del(r.id)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"><i className="ti ti-trash" /></button></td>
                          </tr>
                        ))}
                        {gr.length === 0 && <tr><td colSpan={NC + 1} className="px-4 py-3 text-center text-gray-400 text-xs italic">Drop days here or add one below</td></tr>}
                        <tr><td /><td colSpan={NC} className="px-3 py-2"><button onClick={() => addItem(group.key)} className="text-[13px] text-gray-400 hover:text-[#0086C0]">+ Add day</button></td></tr>
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

// ─────────────────────────── dispatcher ───────────────────────────
export default function HistoricalBoard({ boardKey }: { boardKey: string }) {
  if (boardKey === 'daily-ship-2025') return <DailyShip2025 />
  const cfg = PIPELINES[boardKey]
  if (!cfg) return <div className="min-h-screen mon-page p-8"><p className="text-gray-500">Unknown board: {boardKey}</p></div>
  return <PipelineBoard cfg={cfg} />
}
