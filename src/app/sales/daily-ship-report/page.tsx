'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Row {
  id: string; name: string | null; group_name: string | null; ship_date: string | null
  amazon: number | null; shopify: number | null; faire: number | null; chewy: number | null; b2b: number | null
  people: string | null; position: number | null
}

const CHANNELS: { field: keyof Row; label: string; color: string }[] = [
  { field: 'amazon', label: 'Amazon', color: '#FF9900' },
  { field: 'shopify', label: 'Shopify', color: '#00A84F' },
  { field: 'faire', label: 'Faire', color: '#E2445C' },
  { field: 'chewy', label: 'Chewy', color: '#2B76E5' },
  { field: 'b2b', label: 'B2B', color: '#A25DDC' },
]
const rowTotal = (r: Row) => (Number(r.amazon) || 0) + (Number(r.shopify) || 0) + (Number(r.faire) || 0) + (Number(r.chewy) || 0) + (Number(r.b2b) || 0)
const money = (n: number, dec = 2) => '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
const fmtD = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_KEYS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const MONTH_HEX: Record<string, string> = { Jan: '#0086C0', Feb: '#9D50DD', Mar: '#00C875', Apr: '#FDAB3D', May: '#E2445C', Jun: '#2B76E5', Jul: '#00A89D', Aug: '#FF9900', Sep: '#037f4c', Oct: '#df2f4a', Nov: '#579bfc', Dec: '#9d50dd' }
function monthColor(title: string): string {
  const t = (title || '').trim().toLowerCase()
  const idx = MONTH_KEYS.findIndex(k => t.startsWith(k))
  return idx >= 0 ? MONTH_HEX[MONTHS[idx]] : '#9699A6'
}

function Stat({ label, value, c }: { label: string; value: string | number; c?: string }) {
  return (
    <div className="mon-stat stat-card" style={c ? ({ ['--c']: c } as any) : undefined}>
      <p className="text-xs font-semibold text-gray-400">{label}</p>
      <p className="mon-stat-val mt-0.5">{typeof value === 'number' ? value.toLocaleString() : value}</p>
    </div>
  )
}

export default function DailyShipReportPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [statMode, setStatMode] = useState<'channel' | 'month'>('channel')
  const [edit, setEdit] = useState<{ id: string; field: string } | null>(null)
  const dragId = useRef<string | null>(null)
  // Sales totals are hidden behind a password (verified server-side). Reveal lasts for the session.
  const [revealed, setRevealed] = useState(false)
  const [pw, setPw] = useState('')
  const [pwErr, setPwErr] = useState('')
  const [pwBusy, setPwBusy] = useState(false)

  useEffect(() => { if (typeof window !== 'undefined' && sessionStorage.getItem('dsr_revealed') === '1') setRevealed(true) }, [])
  async function unlockTotals(e: React.FormEvent) {
    e.preventDefault(); setPwErr(''); setPwBusy(true)
    try {
      const res = await fetch('/api/reveal-ship-totals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) })
      const j = await res.json().catch(() => ({}))
      if (j.ok) { setRevealed(true); setPw(''); try { sessionStorage.setItem('dsr_revealed', '1') } catch { /* */ } }
      else setPwErr('Incorrect password.')
    } catch { setPwErr('Could not verify. Try again.') } finally { setPwBusy(false) }
  }
  function hideTotals() { setRevealed(false); try { sessionStorage.removeItem('dsr_revealed') } catch { /* */ } }

  const load = useCallback(async () => {
    setLoading(true)
    const all: Row[] = []
    for (let from = 0; ; from += 1000) {
      const { data } = await sb.from('daily_ship_report').select('*').order('position', { ascending: true, nullsFirst: false }).range(from, from + 999)
      const batch = (data as Row[]) || []
      all.push(...batch)
      if (batch.length < 1000) break
    }
    setRows(all); setLoading(false)
  }, [sb])
  useEffect(() => { load() }, [load])

  async function patch(id: string, obj: any) {
    setRows(rs => rs.map(r => r.id === id ? { ...r, ...obj } : r))
    await sb.from('daily_ship_report').update({ ...obj, updated_at: new Date().toISOString() }).eq('id', id)
  }
  async function addItem(group: string) {
    const max = Math.max(0, ...rows.filter(r => (r.group_name || '') === group).map(r => r.position || 0))
    const { data } = await sb.from('daily_ship_report').insert({ group_name: group, position: max + 1000, amazon: 0, shopify: 0, faire: 0, chewy: 0, b2b: 0 }).select('*').single()
    if (data) { setRows(rs => [...rs, data as Row]); setEdit({ id: (data as any).id, field: 'name' }) }
  }
  // Create a brand-new week group. Auto-suggests the next Mon–Fri after the most recent day,
  // in the same "Month M/D/YY-Month M/D/YY" label style, and seeds one blank day so it appears.
  async function addWeek() {
    const dates = rows.map(r => r.ship_date).filter(Boolean).sort() as string[]
    const latest = dates[dates.length - 1]
    let mon: Date
    if (latest) {
      const d = new Date(latest + 'T00:00:00')
      const daysToNextMon = ((8 - d.getDay()) % 7) || 7
      mon = new Date(d); mon.setDate(d.getDate() + daysToNextMon)
    } else {
      const t = new Date(); const add = ((8 - t.getDay()) % 7) || 7
      mon = new Date(t); mon.setDate(t.getDate() + add)
    }
    const fri = new Date(mon); fri.setDate(mon.getDate() + 4)
    const mn = (x: Date) => x.toLocaleDateString('en-US', { month: 'long' })
    const f = (x: Date) => `${x.getMonth() + 1}/${x.getDate()}/${String(x.getFullYear()).slice(2)}`
    const suggested = `${mn(mon)} ${f(mon)}-${mn(fri)} ${f(fri)}`
    const name = window.prompt('Name the new week group:', suggested)
    if (name == null || !name.trim()) return
    const monISO = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`
    const { data } = await sb.from('daily_ship_report').insert({ group_name: name.trim(), position: 1000, ship_date: monISO, amazon: 0, shopify: 0, faire: 0, chewy: 0, b2b: 0 }).select('*').single()
    if (data) { setRows(rs => [...rs, data as Row]); setCollapsed(c => ({ ...c, [name.trim()]: false })); setEdit({ id: (data as any).id, field: 'name' }) }
  }
  async function del(id: string) {
    if (!confirm('Delete this row?')) return
    setRows(rs => rs.filter(r => r.id !== id)); await sb.from('daily_ship_report').delete().eq('id', id)
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
  const match = (r: Row) => !q || (r.name || '').toLowerCase().includes(q) || (r.group_name || '').toLowerCase().includes(q) || (r.ship_date || '').includes(q)
  const groupRows = (key: string) => rows.filter(r => (r.group_name || '') === key && match(r)).sort((a, b) => (a.position || 0) - (b.position || 0))

  // Groups derived from data, ordered chronologically by earliest date in the week
  const groups = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const r of rows) {
      const key = r.group_name || '(no week)'
      const d = r.ship_date || null
      const cur = m.get(key)
      if (cur === undefined) m.set(key, d)
      else if (d && (!cur || d < cur)) m.set(key, d)
    }
    // newest week on top, oldest at the bottom
    return [...m.entries()]
      .map(([key, minDate]) => ({ key, color: monthColor(key), minDate }))
      .sort((a, b) => (b.minDate || '0000').localeCompare(a.minDate || '0000') || b.key.localeCompare(a.key))
  }, [rows])

  const shown = groups.reduce((a, g) => a + groupRows(g.key).length, 0)
  const grand = rows.reduce((a, r) => a + rowTotal(r), 0)

  // Monthly aggregation for the "By Month" tile view
  const monthAgg = useMemo(() => {
    const m = new Map<string, { label: string; sort: number; total: number }>()
    for (const r of rows) {
      let label = 'Other', sort = 9999
      if (r.ship_date) {
        const d = new Date(r.ship_date + 'T00:00:00')
        sort = d.getFullYear() * 12 + d.getMonth(); label = MONTHS[d.getMonth()]
      } else {
        const idx = MONTH_KEYS.findIndex(k => (r.group_name || '').trim().toLowerCase().startsWith(k))
        if (idx >= 0) { sort = 2026 * 12 + idx; label = MONTHS[idx] }
      }
      const cur = m.get(label) || { label, sort, total: 0 }
      cur.total += rowTotal(r); m.set(label, cur)
    }
    return [...m.values()].sort((a, b) => a.sort - b.sort)
  }, [rows])

  const inpCls = 'w-full bg-white border border-[#0086C0] rounded px-2 py-1 text-[13px] focus:outline-none'
  const Cell = ({ r, field, type = 'text', money: isMoney = false }: { r: Row; field: keyof Row; type?: 'text' | 'num' | 'date'; money?: boolean }) => {
    const editing = edit?.id === r.id && edit?.field === field
    const val = r[field] as any
    if (editing) {
      const t = type === 'num' ? 'number' : type === 'date' ? 'date' : 'text'
      return <input type={t} step="0.01" autoFocus defaultValue={val ?? ''}
        onBlur={e => { const v = e.target.value; patch(r.id, { [field]: v === '' ? (type === 'num' ? 0 : null) : type === 'num' ? Number(v) : v.trim() }); setEdit(null) }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEdit(null) }}
        className={inpCls + (type === 'num' ? ' text-right' : '')} />
    }
    const show = type === 'date' ? fmtD(val) : isMoney ? money(Number(val) || 0) : (val || '')
    return <div onClick={() => setEdit({ id: r.id, field: field as string })}
      className={`cursor-text min-h-[22px] rounded px-1 hover:bg-[#F0F4F9] ${type === 'num' ? 'text-right tabular-nums' : ''}`}>
      {show || <span className="text-gray-300">+</span>}</div>
  }

  const NCOLS = 3 + CHANNELS.length + 1 // drag + name + date + channels + total

  return (
    <div className="min-h-screen mon-page p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <span className="mon-tag">📦 Daily Ship</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">2026 Daily Ship Report</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : (revealed ? `${shown} of ${rows.length} days · ${money(grand, 0)} shipped YTD` : `${shown} of ${rows.length} days · ••••••• shipped YTD`)}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={addWeek} className="mon-btn" style={{ background: '#fff', color: '#00A84F', border: '1px solid #00A84F' }}>+ New week</button>
          <button onClick={() => addItem(groups[0]?.key || '(no week)')} className="mon-btn">+ New day</button>
        </div>
      </div>

      {!loading && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{statMode === 'channel' ? 'Total sales by channel' : 'Total sales by month'}</p>
            <div className="flex items-center gap-2">
              {revealed && <button onClick={hideTotals} className="text-xs text-gray-400 hover:text-gray-600" title="Hide totals again">🔒 Hide</button>}
              <div className="inline-flex rounded-lg border border-[#E4E6EE] bg-white p-0.5 text-xs">
                <button onClick={() => setStatMode('channel')} className={`px-3 py-1.5 rounded-md ${statMode === 'channel' ? 'bg-[#00A84F] text-white font-semibold' : 'text-gray-500 hover:bg-[#F0F2F7]'}`}>By Channel</button>
                <button onClick={() => setStatMode('month')} className={`px-3 py-1.5 rounded-md ${statMode === 'month' ? 'bg-[#00A84F] text-white font-semibold' : 'text-gray-500 hover:bg-[#F0F2F7]'}`}>By Month</button>
              </div>
            </div>
          </div>
          <div className="relative">
            <div className={`grid grid-cols-2 lg:grid-cols-6 gap-3 transition ${revealed ? '' : 'blur-md select-none pointer-events-none'}`} aria-hidden={!revealed}>
              <Stat label="Total Shipped" value={money(grand, 0)} c="#00A84F" />
              {statMode === 'channel'
                ? CHANNELS.map(c => <Stat key={c.field} label={c.label} value={money(rows.reduce((a, r) => a + (Number(r[c.field]) || 0), 0), 0)} c={c.color} />)
                : monthAgg.map(mo => <Stat key={mo.label} label={mo.label} value={money(mo.total, 0)} c={MONTH_HEX[mo.label] || '#9699A6'} />)}
            </div>
            {!revealed && (
              <div className="absolute inset-0 flex items-center justify-center">
                <form onSubmit={unlockTotals} className="flex flex-col items-center gap-2 bg-white/80 backdrop-blur-sm border border-[#E4E6EE] rounded-xl px-5 py-4 shadow-sm">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#1A1D2E]"><span>🔒</span> Enter password to view consolidated stats</div>
                  <div className="flex items-center gap-2">
                    <input type="password" value={pw} onChange={e => { setPw(e.target.value); setPwErr('') }} placeholder="Password" autoComplete="off"
                      className="bg-white border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-[#00A84F]/40" />
                    <button type="submit" disabled={pwBusy || !pw} className="bg-[#00A84F] text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50">{pwBusy ? '…' : 'Unlock'}</button>
                  </div>
                  {pwErr && <p className="text-xs text-red-500">{pwErr}</p>}
                </form>
              </div>
            )}
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
            const wkTotal = gr.reduce((a, r) => a + rowTotal(r), 0)
            return (
              <div key={group.key} className="bg-white rounded-xl overflow-hidden shadow-sm border border-[#ECEEF3]" onDragOver={e => e.preventDefault()} onDrop={() => onDrop(group.key, null)}>
                <div className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none sticky top-0 z-30 rounded-t-xl" style={{ background: '#fff', borderLeft: '5px solid ' + group.color }} onClick={() => setCollapsed(c => ({ ...c, [group.key]: !c[group.key] }))}>
                  <span className="text-[10px]" style={{ color: group.color, display: 'inline-block', transform: isCol ? 'none' : 'rotate(90deg)' }}>&#9654;</span>
                  <span className="font-bold text-sm" style={{ color: group.color }}>{group.key}</span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: group.color + '26', color: group.color }}>{gr.length}</span>
                  <span className="ml-auto text-[12px] font-bold" style={{ color: group.color }}>{money(wkTotal)}</span>
                </div>
                {!isCol && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[820px]">
                      <thead>
                        <tr className="border-b border-[#EEF0F4] text-[11px] uppercase tracking-wide text-gray-400 bg-[#FBFCFE]">
                          <th className="w-6" />
                          <th className="text-left font-semibold px-3 py-2 w-[130px]">Day</th>
                          <th className="text-left font-semibold px-3 py-2 w-[120px]">Date</th>
                          {CHANNELS.map(c => <th key={c.field} className="text-right font-semibold px-3 py-2 w-[110px]">{c.label}</th>)}
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
                            {CHANNELS.map(c => <td key={c.field} className="px-3 py-2.5 text-[13px] text-gray-700"><Cell r={r} field={c.field} type="num" money /></td>)}
                            <td className="px-3 py-2.5 text-[13px] text-right font-bold tabular-nums" style={{ color: group.color }}>{money(rowTotal(r))}</td>
                            <td className="text-center"><button onClick={() => del(r.id)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"><i className="ti ti-trash" /></button></td>
                          </tr>
                        ))}
                        {gr.length === 0 && <tr><td colSpan={NCOLS + 1} className="px-4 py-3 text-center text-gray-400 text-xs italic">Drop days here or add one below</td></tr>}
                        <tr><td /><td colSpan={NCOLS} className="px-3 py-2"><button onClick={() => addItem(group.key)} className="text-[13px] text-gray-400 hover:text-[#0086C0]">+ Add day</button></td></tr>
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
