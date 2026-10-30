'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * STRAW PRODUCTION — same shape as the Walmart Production board, for straw sales orders.
 *
 *   Log production (cases) ─▶ straw_record_production(): finished cases into stock, BOM out, lot, weekly WO
 *   Release to an order    ─▶ straw_release(): free cases → a straw line on a sales order
 *   Order moves to Ready   ─▶ those cases count as BUILT (Inventory board "Built" column)
 *   Order ships            ─▶ Built drops; shipping beyond what was released draws from free stock
 *
 * On hand (Inventory board) = free + released-not-ready. Built = released on Ready orders.
 * Everything here counts in CASES; each straw's "1 case = X" converts to its stocking unit.
 * Weekly work orders (STR-YYYY-Www) roll over until closed out, like Walmart.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { usePermissions } from '@/lib/permissions'
import WalmartWeekCharts from '@/components/WalmartWeekCharts'
import WalmartWoSummary from '@/components/WalmartWoSummary'

const BOARD = '/production/straw'
const ACCENT = '#0f7a4e'
const PALETTE = ['#0071ce', '#00c875', '#e2445c', '#a25ddc', '#fdab3d', '#579bfc', '#037f4c', '#784bd1', '#ff642e', '#66ccff', '#9cd326', '#bb3354']
const WO_DONE = ['Complete', 'Completed', 'Closed', 'Cancelled']

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const addDays = (s: string, n: number) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d) }
const mondayOf = (s: string) => { const d = parse(s); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return ymd(d) }
const num = (v: any) => Number(v) || 0
const fmtN = (v: any) => num(v).toLocaleString('en-US', { maximumFractionDigits: 2 })
const fmtDay = (s: string) => parse(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const fmtTime = (s: string) => new Date(s).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const who = (e?: string | null) => (e || 'unknown').split('@')[0]

interface WO { id: string; wo_code: string | null; status: string | null; start_date: string; due_date: string | null; qty_ordered: number | null; qty_completed: number | null }
interface Prog { work_order_id: string; sku: string; product_name: string | null; target_qty: number; made_qty: number }
interface Entry { id: string; work_order_id: string | null; production_date: string; sku: string; qty: number; kind: string; lot_number: string | null; note: string | null; entered_by: string | null; created_at: string; voided_at: string | null; voided_by: string | null; void_reason: string | null }
interface Stock { sku: string; product_name: string; uom: string | null; per_case: number | null; free: number; released: number; built: number; on_hand_cases: number; total_cases: number; committed: number; short: number; erp_on_hand: number; erp_built: number }
interface OLine { line_id: string; sales_order_id: string; order_number: string; order_name: string; customer: string | null; po_number: string | null; status: string; ship_date: string | null; sku: string; product_name: string | null; ordered: number; released: number; shipped: number; built: number; open_cases: number }
interface Rel { id: string; sales_order_id: string; line_id: string; sku: string; qty: number; status: string; source: string; note: string | null; released_by: string | null; released_at: string }
interface Act { id: number; at: string; actor: string | null; action: string; sku: string | null; qty: number | null; detail: string | null }

export default function StrawProductionPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const perms = usePermissions()
  const canEdit = perms.is_admin || !!perms.boards?.[BOARD]?.can_edit
  const me = (perms.email || '').toLowerCase()
  const today = ymd(new Date())
  const [week, setWeek] = useState(mondayOf(today))
  const weekEnd = addDays(week, 6)
  const [tab, setTab] = useState<'production' | 'orders' | 'activity'>('production')
  const [wos, setWos] = useState<WO[]>([])
  const [prog, setProg] = useState<Prog[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [stock, setStock] = useState<Stock[]>([])
  const [orders, setOrders] = useState<OLine[]>([])
  const [rels, setRels] = useState<Rel[]>([])
  const [acts, setActs] = useState<Act[]>([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [flash, setFlash] = useState('')
  const [busy, setBusy] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [showVoided, setShowVoided] = useState(false)
  const [sum, setSum] = useState<{ id: string; mode: 'view' | 'close' } | null>(null)
  const [releaseFor, setReleaseFor] = useState<OLine | null>(null)
  const [justLogged, setJustLogged] = useState<{ ids: string[]; label: string } | null>(null)
  const [editTargets, setEditTargets] = useState<string | null>(null)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const my = ++seq.current
    setLoadErr('')
    const [w, e, s, o, r, a] = await Promise.all([
      sb.from('work_orders').select('id,wo_code,status,start_date,due_date,qty_ordered,qty_completed')
        .eq('form_type', 'straw_weekly').lte('start_date', week).neq('status', 'Cancelled')
        .or(`start_date.eq.${week},status.not.in.(${WO_DONE.join(',')})`).order('start_date'),
      sb.from('straw_production_entries').select('*').eq('kind', 'production').gte('production_date', week).lte('production_date', weekEnd)
        .order('production_date', { ascending: false }).order('created_at', { ascending: false }),
      sb.rpc('straw_stock_status'),
      sb.rpc('straw_open_orders'),
      sb.from('straw_releases').select('*').order('released_at', { ascending: false }).limit(300),
      sb.from('straw_activity').select('*').order('at', { ascending: false }).limit(200),
    ])
    if (my !== seq.current) return
    const err = w.error || e.error || s.error || o.error
    if (err) setLoadErr(err.message)
    const wl = (w.data as WO[]) || []
    setWos(wl); setEntries((e.data as Entry[]) || []); setStock(((s.data as Stock[]) || []).sort((a, b) => a.sku.localeCompare(b.sku)))
    setOrders((o.data as OLine[]) || []); setRels((r.data as Rel[]) || []); setActs((a.data as Act[]) || [])
    if (wl.length) {
      const { data: p } = await sb.from('v_straw_wo_progress').select('*').in('work_order_id', wl.map(x => x.id))
      if (my === seq.current) setProg((p as Prog[]) || [])
    } else setProg([])
    setLoading(false)
  }, [sb, week, weekEnd])
  const reload = useCallback(() => { load(); setTimeout(load, 900) }, [load])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const ch = sb.channel('straw-board-' + Math.random().toString(36).slice(2))
    let t: any
    const bump = () => { clearTimeout(t); t = setTimeout(load, 600) }
    for (const tb of ['straw_production_entries', 'straw_releases', 'straw_wo_targets', 'sales_orders', 'sales_order_lines']) ch.on('postgres_changes', { event: '*', schema: 'public', table: tb }, bump)
    ch.subscribe()
    return () => { clearTimeout(t); sb.removeChannel(ch) }
  }, [sb, load])
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(''), flash.startsWith('⚠') ? 20000 : 7000); return () => clearTimeout(t) }, [flash])
  useEffect(() => { if (!justLogged) return; const t = setTimeout(() => setJustLogged(null), 10 * 60_000); return () => clearTimeout(t) }, [justLogged])

  const name = useCallback((sku: string) => stock.find(s => s.sku === sku)?.product_name || sku, [stock])
  const thisWo = wos.find(w => w.start_date === week) || null
  const live = entries.filter(e => !e.voided_at)
  const weekSkus = useMemo(() => {
    const set = new Set<string>([...live.map(e => e.sku), ...prog.filter(p => wos.some(w => w.id === p.work_order_id)).map(p => p.sku)])
    return Array.from(set).sort().map((sku, i) => ({ sku, short: sku, color: PALETTE[i % PALETTE.length] }))
  }, [live, prog, wos])
  const days = useMemo(() => {
    const shown = showVoided ? entries : live
    const m = new Map<string, Entry[]>()
    for (const e of shown) { if (!m.has(e.production_date)) m.set(e.production_date, []); m.get(e.production_date)!.push(e) }
    return Array.from(m.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [entries, live, showVoided])
  const ordersGrouped = useMemo(() => {
    const m = new Map<string, OLine[]>()
    for (const l of orders) { if (!m.has(l.sales_order_id)) m.set(l.sales_order_id, []); m.get(l.sales_order_id)!.push(l) }
    return Array.from(m.values()).sort((a, b) => String(a[0].ship_date || '9999').localeCompare(String(b[0].ship_date || '9999')))
  }, [orders])
  const totals = useMemo(() => stock.reduce((t, s) => ({ free: t.free + num(s.free), rel: t.rel + num(s.released), built: t.built + num(s.built), committed: t.committed + num(s.committed), short: t.short + num(s.short) }), { free: 0, rel: 0, built: 0, committed: 0, short: 0 }), [stock])

  async function run<T>(fn: () => Promise<{ data: T; error: any }>, ok: (d: T) => string) {
    setBusy(true)
    const { data, error } = await fn()
    setBusy(false)
    if (error) { setFlash('⚠ ' + error.message); return false }
    setFlash(ok(data)); reload(); return true
  }
  const createWo = () => run(() => sb.rpc('straw_wo_ensure', { p_week: week }) as any, () => `✓ Straw work order for the week of ${fmtDay(week)} created — targets filled from the open straw orders.`)
  const setTarget = (wo: string, sku: string, qty: number) => run(() => sb.rpc('straw_wo_set_target', { p_wo: wo, p_sku: sku, p_qty: qty }) as any, () => `✓ Target for ${sku} set to ${fmtN(qty)} cases.`)
  const reopen = (wo: WO) => run(() => sb.rpc('straw_wo_set_status', { p_wo: wo.id, p_status: 'In Progress' }) as any, () => `✓ ${wo.wo_code} reopened.`)
  async function undoEntries(ids: string[], label: string, ask = true) {
    const reason = ask ? window.prompt(`Undo ${label}?\n\nWhy? (e.g. "Logged by mistake", "Wrong SKU")`, 'Logged by mistake') : 'Logged by mistake (undo right after logging)'
    if (reason == null) return
    if (!reason.trim()) { setFlash('⚠ Give a reason to undo.'); return }
    if (!ask && !window.confirm(`Undo ${label}? It comes off the log and the materials go back to inventory.`)) return
    setBusy(true)
    const done: string[] = []; const bad: string[] = []
    for (const id of ids) { const { data, error } = await sb.rpc('straw_void_production', { p_id: id, p_reason: reason.trim() }); if (error) bad.push(error.message); else done.push(`${fmtN((data as any)?.qty)} × ${(data as any)?.sku}`) }
    setBusy(false); setJustLogged(null)
    setFlash(bad.length ? `⚠ ${done.length ? 'Undone: ' + done.join(', ') + '. ' : ''}Not undone: ${bad.join(' · ')}` : `↩ Undone: ${done.join(', ')} — off the log, materials put back.`)
    reload()
  }
  async function undoRelease(r: Rel) {
    const reason = window.prompt(`Undo the release of ${fmtN(r.qty)} case(s) of ${r.sku}? They go back to free stock.\n\nWhy?`, 'Released to the wrong order')
    if (!reason) return
    await run(() => sb.rpc('straw_release_undo', { p_id: r.id, p_reason: reason }) as any, () => `↩ Release undone — ${fmtN(r.qty)} case(s) of ${r.sku} back in free stock.`)
  }
  async function setCaseSize(s: Stock) {
    const v = window.prompt(`How many ${s.uom || 'units'} are in ONE case of ${s.sku}?\n${s.product_name}`, s.per_case ? String(s.per_case) : '')
    if (v == null) return
    const n = Number(String(v).replace(/[,\s]/g, ''))
    if (!(n > 0)) { setFlash('⚠ Enter a number greater than zero.'); return }
    await run(() => sb.rpc('straw_set_case_size', { p_sku: s.sku, p_per_case: n }) as any, () => `✓ ${s.sku}: 1 case = ${fmtN(n)} ${s.uom || ''}.`)
  }

  const card = 'bg-white rounded-xl shadow-sm border border-[#ECEEF3]'
  const th = 'text-[10px] uppercase tracking-wide text-gray-400 font-semibold px-3 py-2'
  const td = 'px-3 py-2 border-t border-[#F0F2F6]'

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-5 py-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">PRODUCTION</span>
          <h1 className="text-2xl font-semibold text-[#1A1D2E] mt-1">Straw Production</h1>
          <p className="text-gray-500 text-sm">Week of {fmtDay(week)} – {fmtDay(weekEnd)} · counts in cases</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border border-[#E4E6EE] bg-white overflow-hidden">
            <button onClick={() => setWeek(addDays(week, -7))} className="px-3 h-10 text-gray-500 hover:bg-gray-50" aria-label="Previous week" data-ro-ok>‹</button>
            <button onClick={() => setWeek(mondayOf(today))} className="px-3 h-10 text-sm font-semibold text-gray-600 hover:bg-gray-50 border-x border-[#E4E6EE]" data-ro-ok>This week</button>
            <button onClick={() => setWeek(addDays(week, 7))} className="px-3 h-10 text-gray-500 hover:bg-gray-50" aria-label="Next week" data-ro-ok>›</button>
          </div>
          {canEdit && <button onClick={() => setShowLog(true)} className="h-10 px-4 rounded-lg text-white text-sm font-bold" style={{ background: ACCENT }}>+ Log production</button>}
        </div>
      </div>

      <div className="flex gap-1 bg-[#F2F4F8] rounded-xl p-1 mb-4 w-full sm:w-auto sm:inline-flex">
        {([['production', 'Production'], ['orders', `Orders (${ordersGrouped.length})`], ['activity', 'Activity']] as const).map(([k, l]) =>
          <button key={k} onClick={() => setTab(k)} data-ro-ok className={`flex-1 sm:flex-none h-10 px-5 rounded-lg text-sm font-semibold ${tab === k ? 'bg-white shadow-sm text-[#1A1D2E]' : 'text-gray-500'}`}>{l}</button>)}
      </div>

      {flash && <div className={`mb-3 rounded-xl border text-sm px-4 py-3 font-medium ${flash.startsWith('⚠') ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>{flash}</div>}
      {justLogged && canEdit && <div className="mb-3 rounded-xl border border-[#DCE6FA] bg-[#F5F8FF] px-4 py-3 flex items-center gap-3">
        <p className="text-sm text-[#1A1D2E] flex-1">Just logged <b>{justLogged.label}</b>. Made a mistake?</p>
        <button onClick={() => undoEntries(justLogged.ids, justLogged.label, false)} disabled={busy} className="h-10 px-4 rounded-lg bg-red-600 text-white text-sm font-bold disabled:opacity-50">↩ Undo</button>
        <button onClick={() => setJustLogged(null)} className="text-gray-400 text-xl leading-none px-1" aria-label="Dismiss">&times;</button>
      </div>}
      {loadErr && <div className="mb-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">Could not load: {loadErr}</div>}

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
        {[['Free (made, not on an order)', totals.free, '#0071ce'], ['Released to orders', totals.rel, '#a25ddc'], ['Built (orders ready)', totals.built, '#fdab3d'], ['Committed to open orders', totals.committed, '#1A1D2E'], ['Short — still to make', totals.short, totals.short > 0 ? '#e2445c' : '#00c875']].map(([l, v, c]) =>
          <div key={String(l)} className={card + ' px-3 py-2.5'} style={{ borderTop: `4px solid ${c}` }}>
            <p className="text-[10px] uppercase tracking-wide text-gray-400">{l}</p>
            <p className="text-xl font-extrabold text-[#1A1D2E]">{loading ? '…' : fmtN(v)}</p>
            <p className="text-[10px] text-gray-400">cases</p>
          </div>)}
      </div>

      {tab === 'production' && <>
        {/* Work orders */}
        {!loading && !thisWo && <div className={card + ' p-4 mb-3 flex flex-wrap items-center gap-3'}>
          <p className="text-sm text-gray-600 flex-1">No straw work order for the week of {fmtDay(week)} yet. {canEdit ? 'Create one — targets fill in from the open straw orders. (Logging production also creates it.)' : ''}</p>
          {canEdit && <button onClick={createWo} disabled={busy} className="h-10 px-4 rounded-lg text-white text-sm font-bold disabled:opacity-50" style={{ background: ACCENT }}>Create this week&apos;s work order</button>}
        </div>}
        {wos.map(wo => {
          const rows = prog.filter(p => p.work_order_id === wo.id).sort((a, b) => a.sku.localeCompare(b.sku))
          const tgt = rows.reduce((t, r) => t + num(r.target_qty), 0), made = rows.reduce((t, r) => t + num(r.made_qty), 0)
          const done = WO_DONE.includes(wo.status || '')
          const carried = wo.start_date < week
          return (
            <div key={wo.id} className={card + ' p-4 mb-3'} style={{ borderLeft: `5px solid ${done ? '#9699a6' : ACCENT}` }}>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
                <div className="flex-1">
                  <p className="font-bold text-[#1A1D2E]">{wo.wo_code} <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full ml-1" style={{ background: done ? '#ECEEF3' : '#E6F6EE', color: done ? '#676879' : ACCENT }}>{wo.status}</span>
                    {carried && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full ml-1 bg-amber-50 text-amber-700">rolled over from week of {fmtDay(wo.start_date)}</span>}</p>
                  <p className="text-xs text-gray-500">{fmtN(made)} of {fmtN(tgt)} cases made{tgt ? ` · ${Math.round((made / tgt) * 100)}%` : ''}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canEdit && !done && <button onClick={() => setEditTargets(editTargets === wo.id ? null : wo.id)} className="h-9 px-3 rounded-lg border border-[#E4E6EE] text-xs font-semibold text-gray-600">{editTargets === wo.id ? 'Done editing' : '✎ Targets'}</button>}
                  <button onClick={() => setSum({ id: wo.id, mode: 'view' })} className="h-9 px-3 rounded-lg border border-[#E4E6EE] text-xs font-semibold text-gray-600" data-ro-ok>📄 Summary</button>
                  {canEdit && !done && <button onClick={() => setSum({ id: wo.id, mode: 'close' })} className="h-9 px-3 rounded-lg text-xs font-bold text-white bg-[#00a85a]">Close out</button>}
                  {canEdit && done && <button onClick={() => reopen(wo)} disabled={busy} className="h-9 px-3 rounded-lg border border-[#E4E6EE] text-xs font-semibold text-gray-600">Reopen</button>}
                </div>
              </div>
              {rows.length === 0 && <p className="text-sm text-gray-400">No targets yet{canEdit && !done ? ' — click ✎ Targets to add, or just log production.' : '.'}</p>}
              <div className="space-y-2">
                {rows.map(r => {
                  const pct = num(r.target_qty) ? Math.min(100, (num(r.made_qty) / num(r.target_qty)) * 100) : 100
                  return (
                    <div key={r.sku} className="flex items-center gap-3">
                      <div className="w-40 sm:w-56 min-w-0"><p className="font-mono text-[12px] font-semibold text-[#1A1D2E] truncate">{r.sku}</p><p className="text-[10px] text-gray-400 truncate">{r.product_name}</p></div>
                      <div className="flex-1 h-2.5 bg-[#F0F2F6] rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: pct + '%', background: num(r.made_qty) >= num(r.target_qty) && num(r.target_qty) > 0 ? '#00c875' : ACCENT }} /></div>
                      {editTargets === wo.id
                        ? <input type="number" min={0} defaultValue={num(r.target_qty)} onBlur={e => { const v = Number(e.target.value); if (v !== num(r.target_qty)) setTarget(wo.id, r.sku, v) }} className="w-24 h-8 border border-[#E4E6EE] rounded px-2 text-sm text-right" />
                        : <p className="w-28 text-right text-sm"><b>{fmtN(r.made_qty)}</b><span className="text-gray-400"> / {fmtN(r.target_qty)}</span></p>}
                    </div>)
                })}
                {editTargets === wo.id && <AddTarget skus={stock.map(s => s.sku).filter(s => !rows.some(r => r.sku === s))} onAdd={(sku, q) => setTarget(wo.id, sku, q)} />}
              </div>
            </div>)
        })}

        <WalmartWeekCharts skus={weekSkus} entries={live} week={week} prog={prog.filter(p => p.work_order_id === (thisWo?.id || wos[wos.length - 1]?.id))} woCode={thisWo?.wo_code || wos[wos.length - 1]?.wo_code} />

        {/* Daily log */}
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold text-[#1A1D2E]">Daily log</h2>
          <label className="text-xs text-gray-500 flex items-center gap-1.5"><input type="checkbox" checked={showVoided} onChange={e => setShowVoided(e.target.checked)} data-ro-ok /> Show removed</label>
        </div>
        <div className="space-y-3 mb-5">
          {days.map(([d, rows]) => {
            const total = rows.filter(r => !r.voided_at).reduce((s, r) => s + num(r.qty), 0)
            const color = d === today ? ACCENT : '#9699a6'
            return (
              <div key={d} className={card + ' overflow-hidden'}>
                <div className="flex items-center gap-2.5 px-4 py-2.5" style={{ borderLeft: '5px solid ' + color }}>
                  <span className="font-bold text-sm" style={{ color }}>{d === today ? 'Today · ' : ''}{fmtDay(d)}</span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: color + '22', color }}>{fmtN(total)} cases</span>
                </div>
                <div className="divide-y divide-[#F0F2F6]">
                  {rows.map(r => {
                    const canUndo = canEdit && !r.voided_at && (perms.is_admin || ((r.entered_by || '').toLowerCase() === me && Date.now() - new Date(r.created_at).getTime() < 48 * 3600_000))
                    return (
                      <div key={r.id} className={`flex items-center gap-3 px-4 py-3 ${r.voided_at ? 'opacity-50' : ''}`}>
                        <div className="min-w-0 flex-1">
                          <p className={`font-semibold text-[#1A1D2E] text-sm ${r.voided_at ? 'line-through' : ''}`}><span className="font-mono">{r.sku}</span> <span className="text-[11px] font-normal text-gray-400">{name(r.sku)}</span></p>
                          <p className="text-[11px] text-gray-500 truncate">{who(r.entered_by)} · {fmtTime(r.created_at)}{r.lot_number ? ' · lot ' + r.lot_number : ''}{r.note ? ' · ' + r.note : ''}{r.voided_at ? ` · removed by ${who(r.voided_by)}: ${r.void_reason || ''}` : ''}</p>
                        </div>
                        <p className="text-lg font-extrabold text-[#1A1D2E] shrink-0">{fmtN(r.qty)} <span className="text-[10px] font-normal text-gray-400">cases</span></p>
                        {canUndo ? <button onClick={() => undoEntries([r.id], `${fmtN(r.qty)} × ${r.sku} (${fmtTime(r.created_at)})`)} disabled={busy} className="shrink-0 h-9 px-3 rounded-lg border border-[#ECEEF3] text-xs font-semibold text-gray-500 hover:text-red-600 hover:border-red-200 bg-white disabled:opacity-50">↩ Undo</button> : <span className="w-3 shrink-0" />}
                      </div>)
                  })}
                </div>
              </div>)
          })}
          {!loading && days.length === 0 && <div className={card + ' p-8 text-center text-sm text-gray-500'}>No straw production logged this week.</div>}
        </div>

        {/* Finished goods */}
        <div className={card + ' overflow-x-auto mb-5'}>
          <p className="px-4 pt-3 font-bold text-[#1A1D2E] text-sm">Straw finished goods <span className="font-normal text-gray-400 text-xs">— cases</span></p>
          <table className="w-full text-sm min-w-[860px] mt-2">
            <thead><tr className="border-b border-[#EEF0F4]">
              <th className={th + ' text-left'}>SKU</th>
              <th className={th + ' text-right'} title="How many stocking units are in one case — click to change">1 case =</th>
              <th className={th + ' text-right'} title="Made and not on any order yet">Free</th>
              <th className={th + ' text-right'} title="Released to an order that is not ready yet">Released</th>
              <th className={th + ' text-right'} title="Free + Released — this is On Hand on the Inventory board">On hand</th>
              <th className={th + ' text-right'} title="Released to orders that are Ready to Ship / Will Call — Built on the Inventory board">Built</th>
              <th className={th + ' text-right'}>Total</th>
              <th className={th + ' text-right'} title="Still to ship on open orders">Committed</th>
              <th className={th + ' text-right'}>Short</th>
            </tr></thead>
            <tbody>
              {stock.filter(s => num(s.total_cases) || num(s.committed) || !s.per_case).map(s => (
                <tr key={s.sku}>
                  <td className={td}><p className="font-mono text-[12px] font-semibold">{s.sku}</p><p className="text-[10px] text-gray-400 truncate max-w-[260px]">{s.product_name}</p></td>
                  <td className={td + ' text-right whitespace-nowrap'}>{canEdit
                    ? <button onClick={() => setCaseSize(s)} className={`text-[12px] underline decoration-dotted ${s.per_case ? 'text-gray-600' : 'text-red-600 font-bold'}`}>{s.per_case ? `${fmtN(s.per_case)} ${s.uom || ''}` : 'Set case size'}</button>
                    : <span className="text-[12px] text-gray-600">{s.per_case ? `${fmtN(s.per_case)} ${s.uom || ''}` : '—'}</span>}</td>
                  <td className={td + ' text-right'}>{fmtN(s.free)}</td>
                  <td className={td + ' text-right'}>{fmtN(s.released)}</td>
                  <td className={td + ' text-right font-semibold'}>{fmtN(s.on_hand_cases)}</td>
                  <td className={td + ' text-right text-amber-700 font-semibold'}>{fmtN(s.built)}</td>
                  <td className={td + ' text-right font-bold'}>{fmtN(s.total_cases)}</td>
                  <td className={td + ' text-right'}>{fmtN(s.committed)}</td>
                  <td className={td + ' text-right font-bold ' + (num(s.short) > 0 ? 'text-red-600' : 'text-gray-300')}>{num(s.short) > 0 ? fmtN(s.short) : '—'}</td>
                </tr>))}
            </tbody>
          </table>
          <p className="px-4 py-2 text-[11px] text-gray-400">Straws with no stock and no open orders are hidden. <b>On hand</b> = free + released (what the Inventory board shows). When an order moves to <b>Ready to Ship</b> or <b>Ready at Will Call</b>, its released cases move to <b>Built</b>; shipping takes them from Built. Shipping straws that were never released takes them from free stock automatically.</p>
        </div>
      </>}

      {tab === 'orders' && <div className="space-y-3">
        {ordersGrouped.length === 0 && !loading && <div className={card + ' p-8 text-center text-sm text-gray-500'}>No open sales orders with straws.</div>}
        {ordersGrouped.map(lines => {
          const o = lines[0]
          const orderRels = rels.filter(r => r.sales_order_id === o.sales_order_id && r.status === 'Released')
          return (
            <div key={o.sales_order_id} className={card + ' overflow-hidden'}>
              <div className="px-4 py-3 border-b border-[#F0F2F6] flex flex-wrap items-center gap-2">
                <div className="flex-1 min-w-0">
                  <a href={`/sales/orders?item=${o.sales_order_id}`} className="font-bold text-[#1A1D2E] hover:underline">{o.order_name}</a>
                  <p className="text-xs text-gray-500">SO #{o.order_number}{o.po_number ? ` · PO ${o.po_number}` : ''}{o.ship_date ? ` · ship ${fmtDay(o.ship_date)}` : ''}</p>
                </div>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#F2F4F8] text-gray-600">{o.status}</span>
              </div>
              <div className="overflow-x-auto"><table className="w-full text-sm min-w-[700px]">
                <thead><tr><th className={th + ' text-left'}>Straw</th><th className={th + ' text-right'}>Ordered</th><th className={th + ' text-right'}>Released</th><th className={th + ' text-right'}>Built</th><th className={th + ' text-right'}>Shipped</th><th className={th + ' text-right'}>Still to release</th><th className={th}></th></tr></thead>
                <tbody>{lines.map(l => {
                  const free = num(stock.find(s => s.sku === l.sku)?.free)
                  return (
                    <tr key={l.line_id}>
                      <td className={td}><p className="font-mono text-[12px] font-semibold">{l.sku}</p><p className="text-[10px] text-gray-400 truncate max-w-[280px]">{l.product_name}</p></td>
                      <td className={td + ' text-right'}>{fmtN(l.ordered)}</td>
                      <td className={td + ' text-right'}>{fmtN(l.released)}</td>
                      <td className={td + ' text-right text-amber-700'}>{num(l.built) ? fmtN(l.built) : '—'}</td>
                      <td className={td + ' text-right'}>{num(l.shipped) ? fmtN(l.shipped) : '—'}</td>
                      <td className={td + ' text-right font-bold ' + (num(l.open_cases) > 0 ? 'text-red-600' : 'text-emerald-600')}>{num(l.open_cases) > 0 ? fmtN(l.open_cases) : '✓'}</td>
                      <td className={td + ' text-right'}>{canEdit && num(l.open_cases) > 0 && <button onClick={() => setReleaseFor(l)} disabled={free <= 0} title={free <= 0 ? 'No free cases of this straw — log production first' : ''} className="h-8 px-3 rounded-lg text-xs font-bold text-white disabled:opacity-40" style={{ background: ACCENT }}>Release {free > 0 ? `(${fmtN(free)} free)` : ''}</button>}</td>
                    </tr>)
                })}</tbody>
              </table></div>
              {orderRels.length > 0 && <div className="px-4 py-2 bg-[#FAFBFD] text-[12px] space-y-1">
                {orderRels.map(r => <div key={r.id} className="flex items-center gap-2"><span className="flex-1 text-gray-600"><b>{fmtN(r.qty)}</b> × {r.sku} released by {who(r.released_by)} · {new Date(r.released_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{r.source === 'ship' ? ' · auto at shipping' : ''}{r.note ? ` · ${r.note}` : ''}</span>
                  {canEdit && r.source !== 'ship' && <button onClick={() => undoRelease(r)} disabled={busy} className="text-[11px] text-gray-400 hover:text-red-600">Undo</button>}</div>)}
              </div>}
            </div>)
        })}
      </div>}

      {tab === 'activity' && <div className={card + ' overflow-x-auto'}>
        <table className="w-full text-sm min-w-[640px]">
          <thead><tr><th className={th + ' text-left'}>When</th><th className={th + ' text-left'}>Who</th><th className={th + ' text-left'}>What</th><th className={th + ' text-left'}>SKU</th><th className={th + ' text-right'}>Cases</th><th className={th + ' text-left'}>Detail</th></tr></thead>
          <tbody>{acts.map(a => (
            <tr key={a.id}><td className={td + ' whitespace-nowrap text-gray-500'}>{new Date(a.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
              <td className={td}>{who(a.actor)}</td><td className={td}>{ACTION[a.action] || a.action}</td><td className={td + ' font-mono text-[12px]'}>{a.sku || ''}</td>
              <td className={td + ' text-right'}>{a.qty != null ? fmtN(a.qty) : ''}</td><td className={td + ' text-gray-500'}>{a.detail || ''}</td></tr>))}
            {acts.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-gray-400">No activity yet.</td></tr>}
          </tbody>
        </table>
      </div>}

      {showLog && <LogSheet sb={sb} stock={stock} wos={wos.filter(w => !WO_DONE.includes(w.status || ''))} today={today} onClose={() => setShowLog(false)}
        onSaved={(msg, ids, label) => { setFlash(msg); setShowLog(false); setTab('production'); if (ids.length) setJustLogged({ ids, label }); reload() }} />}
      {releaseFor && <ReleaseModal sb={sb} line={releaseFor} free={num(stock.find(s => s.sku === releaseFor.sku)?.free)} onClose={() => setReleaseFor(null)}
        onDone={m => { setReleaseFor(null); setFlash(m); reload() }} />}
      {sum && <WalmartWoSummary kind="straw" sb={sb} woId={sum.id} mode={sum.mode} canEdit={canEdit} userEmail={me} onClose={() => setSum(null)} onClosedOut={m => { setSum(null); setFlash(m); reload() }} />}
    </div>
  )
}

const ACTION: Record<string, string> = {
  logged: 'Logged production', voided: 'Removed a log', released: 'Released to order', release_undone: 'Undid a release',
  auto_release_on_ship: 'Shipped from free stock', wo_created: 'Created work order', wo_closed: 'Closed out work order',
  wo_reopened: 'Reopened work order', target_set: 'Set target', case_size_set: 'Set case size',
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-[110] bg-black/50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>{children}</div>
    </div>, document.body)
}

function AddTarget({ skus, onAdd }: { skus: string[]; onAdd: (sku: string, q: number) => void }) {
  const [sku, setSku] = useState(''); const [q, setQ] = useState('')
  return (
    <div className="flex items-center gap-2 pt-1">
      <select value={sku} onChange={e => setSku(e.target.value)} className="h-8 border border-[#E4E6EE] rounded px-2 text-sm flex-1"><option value="">+ Add a straw…</option>{skus.map(s => <option key={s} value={s}>{s}</option>)}</select>
      <input type="number" min={1} value={q} onChange={e => setQ(e.target.value)} placeholder="cases" className="w-24 h-8 border border-[#E4E6EE] rounded px-2 text-sm text-right" />
      <button onClick={() => { if (sku && Number(q) > 0) { onAdd(sku, Number(q)); setSku(''); setQ('') } }} className="h-8 px-3 rounded text-xs font-bold text-white" style={{ background: ACCENT }}>Add</button>
    </div>)
}

function LogSheet({ sb, stock, wos, today, onClose, onSaved }: {
  sb: any; stock: Stock[]; wos: WO[]; today: string; onClose: () => void; onSaved: (msg: string, ids: string[], label: string) => void
}) {
  const [date, setDate] = useState(today)
  const [woId, setWoId] = useState(wos[wos.length - 1]?.id || '')
  const [rows, setRows] = useState<{ sku: string; qty: string }[]>([{ sku: '', qty: '' }])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (i: number, p: Partial<{ sku: string; qty: string }>) => setRows(r => r.map((x, j) => j === i ? { ...x, ...p } : x))
  async function save() {
    setErr('')
    const good = rows.filter(r => r.sku && Number(r.qty) > 0)
    if (!good.length) { setErr('Pick a straw and enter how many cases were made.'); return }
    setBusy(true)
    const ids: string[] = []; const ok: string[] = []; const bad: string[] = []
    for (const r of good) {
      const { data, error } = await sb.rpc('straw_record_production', { p_sku: r.sku, p_qty: Number(r.qty), p_date: date, p_wo: woId || null, p_note: note.trim() || null })
      if (error) bad.push(`${r.sku}: ${error.message}`); else { ok.push(`${r.qty} × ${r.sku}`); if ((data as any)?.id) ids.push((data as any).id) }
    }
    setBusy(false)
    if (bad.length) { setErr((ok.length ? `Saved: ${ok.join(', ')}. ` : '') + 'Not saved — ' + bad.join(' · ')); setRows(rows.filter(r => bad.some(b => b.startsWith(r.sku + ':')))); return }
    onSaved(`✓ Saved ${ok.join(', ')} case(s) for ${fmtDay(date)} — inventory updated.`, ids, ok.join(', '))
  }
  const inp = 'h-11 border border-[#E4E6EE] rounded-lg px-3 text-sm w-full'
  return (
    <Overlay onClose={() => !busy && onClose()}>
      <div className="px-5 pt-4 pb-3 border-b border-[#EEF0F4] flex items-center justify-between">
        <div><p className="text-[11px] uppercase tracking-wide text-gray-400">Finished straws — in cases</p><h2 className="text-lg font-bold text-[#1A1D2E]">Log production</h2></div>
        <button onClick={onClose} className="text-gray-400 text-3xl leading-none px-2" aria-label="Close">&times;</button>
      </div>
      <div className="px-5 py-4 space-y-3 overflow-y-auto">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs text-gray-500">Date made</label><input type="date" value={date} max={today} onChange={e => setDate(e.target.value)} className={inp} /></div>
          <div><label className="text-xs text-gray-500">Work order</label><select value={woId} onChange={e => setWoId(e.target.value)} className={inp}><option value="">Auto (this week)</option>{wos.map(w => <option key={w.id} value={w.id}>{w.wo_code}</option>)}</select></div>
        </div>
        {rows.map((r, i) => {
          const st = stock.find(s => s.sku === r.sku)
          return (
            <div key={i} className="rounded-xl border border-[#ECEEF3] p-3 space-y-2">
              <select value={r.sku} onChange={e => set(i, { sku: e.target.value })} className={inp}>
                <option value="">Pick a straw…</option>
                {stock.map(s => <option key={s.sku} value={s.sku}>{s.sku} — {s.product_name}</option>)}
              </select>
              <div className="flex items-center gap-2">
                <input inputMode="decimal" value={r.qty} onChange={e => set(i, { qty: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="Cases made" className={inp} />
                {rows.length > 1 && <button onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} className="text-gray-400 text-xl px-2">&times;</button>}
              </div>
              {st && <p className={`text-[11px] ${st.per_case ? 'text-gray-500' : 'text-red-600 font-semibold'}`}>{st.per_case ? `1 case = ${fmtN(st.per_case)} ${st.uom || ''}${Number(r.qty) > 0 ? ` → ${fmtN(Number(r.qty) * num(st.per_case))} ${st.uom || ''} into inventory` : ''}` : 'Case size not set — set it on the finished goods table first.'}</p>}
            </div>)
        })}
        <button onClick={() => setRows(r => [...r, { sku: '', qty: '' }])} className="text-sm font-semibold" style={{ color: ACCENT }}>+ Another straw</button>
        <div><label className="text-xs text-gray-500">Note (optional)</label><input value={note} onChange={e => setNote(e.target.value)} placeholder="Machine, shift, anything worth knowing" className={inp} /></div>
        {err && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
      </div>
      <div className="px-5 py-3 border-t border-[#EEF0F4] flex gap-2">
        <button onClick={onClose} disabled={busy} className="flex-1 h-11 rounded-lg border border-[#E4E6EE] text-sm">Cancel</button>
        <button onClick={save} disabled={busy} className="flex-1 h-11 rounded-lg text-white text-sm font-bold disabled:opacity-50" style={{ background: ACCENT }}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </Overlay>)
}

function ReleaseModal({ sb, line, free, onClose, onDone }: { sb: any; line: OLine; free: number; onClose: () => void; onDone: (m: string) => void }) {
  const max = Math.max(0, Math.min(num(line.open_cases), free))
  const [qty, setQty] = useState(String(max))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function go() {
    setErr('')
    const q = Number(qty)
    if (!(q > 0)) { setErr('Enter how many cases to release.'); return }
    setBusy(true)
    const { error } = await sb.rpc('straw_release', { p_line: line.line_id, p_qty: q, p_note: note.trim() || null })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onDone(`✓ Released ${fmtN(q)} case(s) of ${line.sku} to ${line.order_name} (SO #${line.order_number}).`)
  }
  const inp = 'h-11 border border-[#E4E6EE] rounded-lg px-3 text-sm w-full'
  return (
    <Overlay onClose={() => !busy && onClose()}>
      <div className="px-5 pt-4 pb-3 border-b border-[#EEF0F4]">
        <p className="text-[11px] uppercase tracking-wide text-gray-400">Release to order</p>
        <h2 className="text-lg font-bold text-[#1A1D2E]">{line.order_name} · SO #{line.order_number}</h2>
        <p className="text-xs text-gray-500"><span className="font-mono">{line.sku}</span> · {fmtN(line.open_cases)} case(s) still to release · {fmtN(free)} free</p>
      </div>
      <div className="px-5 py-4 space-y-3">
        <div><label className="text-xs text-gray-500">Cases to release</label><input inputMode="decimal" value={qty} onChange={e => setQty(e.target.value.replace(/[^0-9.]/g, ''))} className={inp} /></div>
        <div><label className="text-xs text-gray-500">Note (optional)</label><input value={note} onChange={e => setNote(e.target.value)} className={inp} /></div>
        {err && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
      </div>
      <div className="px-5 py-3 border-t border-[#EEF0F4] flex gap-2">
        <button onClick={onClose} disabled={busy} className="flex-1 h-11 rounded-lg border border-[#E4E6EE] text-sm">Cancel</button>
        <button onClick={go} disabled={busy || max <= 0} className="flex-1 h-11 rounded-lg text-white text-sm font-bold disabled:opacity-50" style={{ background: ACCENT }}>{busy ? 'Releasing…' : 'Release'}</button>
      </div>
    </Overlay>)
}
