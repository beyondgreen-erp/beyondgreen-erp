'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PRODUCTION BOARD — the Straw board's workflow for the other sales-order pipeline groups:
 * Make to Stock (Bags, Cutlery), Private Label (Bags) and Contract Mfg (Molding). One component,
 * one board key (pb_boards.key). Lines land here when the order's pipeline group matches the board
 * and the SKU's product category matches.
 *
 *   Log production   ─▶ pb_record_production(): adds to On Hand, takes BOM materials out, lot code, work order progress
 *   Release to order ─▶ pb_release(): holds free stock for an order line (free = on hand − released, not shipped)
 *   Order ships      ─▶ shipping takes it off On Hand as it does today
 *
 * Everything counts in each SKU's own stocking unit (packs, rolls, cases, pieces).
 */
import WoMachinePicker, { machineFitsBoard } from '@/components/WoMachinePicker'
import WoDetailsModal from '@/components/WoDetailsModal'
import { applyWoDetails, loadWoDetails } from '@/lib/woDetails'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { usePermissions } from '@/lib/permissions'
import WalmartWeekCharts from '@/components/WalmartWeekCharts'
import WalmartWoSummary from '@/components/WalmartWoSummary'
import { buildPbWorkOrderPdf, buildPbCaseLabels, planPbLabels, caseMath, type PbPrint } from '@/lib/pbWoDocs'

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
const u = (s?: string | null) => (s || 'units')

export interface BoardCfg { key: string; title: string; route: string; sections: string[]; category: string; wo_prefix: string; accent: string }
interface WO { id: string; wo_code: string | null; status: string | null; start_date: string; due_date: string | null; qty_ordered: number | null; qty_completed: number | null; sales_order_id: string | null; machine_id: string | null; connected_from: string | null }
interface MachineOpt { id: string; machine_code: string; name: string; equipment_group: string | null }
interface Prog { work_order_id: string; sku: string; product_name: string | null; uom: string | null; case_qty: number | null; target_qty: number; made_qty: number }
interface Entry { id: string; work_order_id: string | null; production_date: string; sku: string; qty: number; kind: string; lot_number: string | null; note: string | null; entered_by: string | null; created_at: string; voided_at: string | null; voided_by: string | null; void_reason: string | null }
interface Stock { sku: string; product_name: string; uom: string | null; case_qty: number | null; on_hand: number; held: number; free: number; built: number; committed: number; short: number; made_7d: number }
interface WoOrder { work_order_id: string; sales_order_id: string; sales_orders: { order_number: string | null; po_number: string | null; notes: string | null; customers: { company_name: string | null } | null } | null }
interface OLine { work_order_id: string | null; wo_code: string | null; line_id: string; sales_order_id: string; order_number: string; order_name: string; customer: string | null; po_number: string | null; status: string; ship_date: string | null; sku: string; product_name: string | null; uom: string | null; ordered: number; released: number; shipped: number; built: number; open_qty: number; case_qty: number | null }
interface Rel { id: string; sales_order_id: string; line_id: string; sku: string; qty: number; status: string; source: string; note: string | null; released_by: string | null; released_at: string }
interface Act { id: number; at: string; actor: string | null; action: string; sku: string | null; qty: number | null; detail: string | null }

export default function ProductionBoard({ boardKey }: { boardKey: string }) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const perms = usePermissions()
  const [cfg, setCfg] = useState<BoardCfg | null>(null)
  const BOARD = cfg?.route || ''
  const ACCENT = cfg?.accent || '#0f7a4e'
  const canEdit = !!cfg && (perms.is_admin || !!perms.boards?.[BOARD]?.can_edit)
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
  const [woOrders, setWoOrders] = useState<WoOrder[]>([])
  const [showClosed, setShowClosed] = useState(false)
  const [newWo, setNewWo] = useState<{ order?: string; addTo?: string } | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  const [details, setDetails] = useState<{ id: string; code: string | null; isNew?: boolean } | null>(null)
  const [catalog, setCatalog] = useState<{ sku: string; product_name: string; unit_of_measure: string | null; case_qty: number | null }[]>([])
  const seq = useRef(0)

  useEffect(() => {
    sb.from('pb_boards').select('*').eq('key', boardKey).maybeSingle().then(({ data, error }: any) => {
      if (error || !data) { setLoadErr(error?.message || 'Unknown production board'); setLoading(false); return }
      setCfg(data as BoardCfg)
      sb.from('products').select('sku,product_name,unit_of_measure,case_qty').ilike('product_category', data.category).eq('category', 'Finished Goods').eq('is_active', true).order('sku')
        .then(({ data: p }: any) => setCatalog(p || []))
    })
  }, [sb, boardKey])

  const load = useCallback(async () => {
    if (!cfg) return
    const my = ++seq.current
    setLoadErr('')
    const [w, e, s, o, r, a] = await Promise.all([
      sb.from('work_orders').select('id,wo_code,status,start_date,due_date,qty_ordered,qty_completed,completed_at,sales_order_id,machine_id,connected_from')
        .eq('form_type', 'pb_' + cfg.key).neq('status', 'Cancelled')
        .or(`status.not.in.(${WO_DONE.join(',')}),completed_at.gte.${addDays(today, -30)}`).order('due_date', { ascending: true, nullsFirst: false }).order('created_at'),
      sb.from('pb_production_entries').select('*').eq('board', cfg.key).eq('kind', 'production').gte('production_date', week).lte('production_date', weekEnd)
        .order('production_date', { ascending: false }).order('created_at', { ascending: false }),
      sb.rpc('pb_stock_status', { p_board: cfg.key }),
      sb.rpc('pb_open_orders', { p_board: cfg.key }),
      sb.from('pb_releases').select('*').eq('board', cfg.key).order('released_at', { ascending: false }).limit(300),
      sb.from('pb_activity').select('*').eq('board', cfg.key).order('at', { ascending: false }).limit(200),
    ])
    if (my !== seq.current) return
    const err = w.error || e.error || s.error || o.error
    if (err) setLoadErr(err.message)
    const wl = (w.data as WO[]) || []
    setWos(wl); setEntries((e.data as Entry[]) || []); setStock(((s.data as Stock[]) || []).sort((a, b) => a.sku.localeCompare(b.sku)))
    setOrders((o.data as OLine[]) || []); setRels((r.data as Rel[]) || []); setActs((a.data as Act[]) || [])
    if (wl.length) {
      const [{ data: p }, { data: wo2 }] = await Promise.all([
        sb.from('v_pb_wo_progress').select('*').in('work_order_id', wl.map(x => x.id)),
        sb.from('pb_wo_orders').select('work_order_id,sales_order_id,sales_orders(order_number,po_number,notes,customers(company_name))').in('work_order_id', wl.map(x => x.id)),
      ])
      if (my === seq.current) { setProg((p as Prog[]) || []); setWoOrders((wo2 as any[]) || []) }
    } else { setProg([]); setWoOrders([]) }
    setLoading(false)
  }, [sb, cfg, week, weekEnd, today])
  const reload = useCallback(() => { load(); setTimeout(load, 900) }, [load])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!cfg) return
    const ch = sb.channel('pb-board-' + cfg.key + '-' + Math.random().toString(36).slice(2))
    let t: any
    const bump = () => { clearTimeout(t); t = setTimeout(load, 600) }
    for (const tb of ['pb_production_entries', 'pb_releases', 'pb_wo_targets', 'pb_wo_orders', 'sales_orders', 'sales_order_lines']) ch.on('postgres_changes', { event: '*', schema: 'public', table: tb }, bump)
    ch.subscribe()
    return () => { clearTimeout(t); sb.removeChannel(ch) }
  }, [sb, load, cfg])
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(''), flash.startsWith('⚠') ? 20000 : 7000); return () => clearTimeout(t) }, [flash])
  useEffect(() => { if (!justLogged) return; const t = setTimeout(() => setJustLogged(null), 10 * 60_000); return () => clearTimeout(t) }, [justLogged])

  const itemWord = cfg ? (cfg.category === 'CUTLERY' ? 'cutlery item' : cfg.category === 'MOLDING' ? 'molded part' : 'bag') : 'item'
  const info = useCallback((sku: string) => stock.find(s => s.sku === sku) || catalog.find(c => c.sku.toUpperCase() === sku) as any, [stock, catalog])
  const name = (sku: string) => info(sku)?.product_name || sku
  const uomOf = (sku: string) => info(sku)?.uom ?? info(sku)?.unit_of_measure ?? null
  const openWos = wos.filter(w => !WO_DONE.includes(w.status || ''))
  const shownWos = showClosed ? wos : openWos
  const orderLabel = (o: WoOrder) => { const so = o.sales_orders; const nm = so?.customers?.company_name || (so?.notes || '').split('|')[0].trim(); return `${nm ? nm + ' · ' : ''}SO ${so?.order_number || ''}${so?.po_number ? ' · PO ' + so.po_number : ''}` }
  const openProg = useMemo(() => { const m = new Map<string, Prog>(); for (const p of prog) if (openWos.some(w => w.id === p.work_order_id)) { const x = m.get(p.sku); m.set(p.sku, x ? { ...x, target_qty: num(x.target_qty) + num(p.target_qty), made_qty: num(x.made_qty) + num(p.made_qty) } : { ...p }) } return Array.from(m.values()) }, [prog, openWos])
  const live = entries.filter(e => !e.voided_at)
  const weekSkus = useMemo(() => {
    const set = new Set<string>([...live.map(e => e.sku), ...openProg.map(p => p.sku)])
    return Array.from(set).sort().map((sku, i) => ({ sku, short: sku, color: PALETTE[i % PALETTE.length] }))
  }, [live, openProg])
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
  const totals = useMemo(() => ({
    skus: stock.length, short: stock.filter(s => num(s.short) > 0).length, openLines: orders.filter(o => num(o.open_qty) > 0).length,
    made: live.length, ready: orders.filter(o => num(o.built) > 0).length,
  }), [stock, orders, live])
  const casesTxt = (sku: string, units: number) => { const i = info(sku); if (!i) return ''; const cm = caseMath({ uom: uomOf(sku), case_qty: i.case_qty }, units); return cm.perCase > 1 || /^(CASE|CS)/i.test(String(uomOf(sku))) ? `${fmtN(cm.cases)} cs` : '' }

  async function run<T>(fn: () => Promise<{ data: T; error: any }>, ok: (d: T) => string) {
    setBusy(true)
    const { data, error } = await fn()
    setBusy(false)
    if (error) { setFlash('⚠ ' + error.message); return false }
    setFlash(ok(data)); reload(); return true
  }
  const setTarget = (wo: string, sku: string, qty: number) => run(() => sb.rpc('pb_wo_set_target', { p_wo: wo, p_sku: sku, p_qty: qty }) as any, () => `✓ Target for ${sku} set to ${fmtN(qty)} ${u(uomOf(sku))}.`)
  const delWo = (wo: WO) => { if (!window.confirm(`Delete work order ${wo.wo_code}? Nothing has been logged on it. Its POs go back to "no work order".`)) return; run(() => sb.rpc('pb_wo_delete', { p_wo: wo.id }) as any, () => `🗑 ${wo.wo_code} deleted.`) }
  async function loadPrint(wo: WO): Promise<PbPrint | null> {
    const { data, error } = await sb.rpc('pb_wo_print', { p_wo: wo.id })
    if (error) { setFlash('⚠ ' + error.message); return null }
    return applyWoDetails(data as PbPrint, await loadWoDetails(sb, wo.id))
  }
  async function printWo(wo: WO) {
    setBusy(true)
    try { const d = await loadPrint(wo); if (d) { buildPbWorkOrderPdf(d).save(`Work-Order-${wo.wo_code || 'production'}.pdf`); setFlash(`📄 ${wo.wo_code} work order downloaded — print it on letter paper.`) } }
    catch (e: any) { setFlash('⚠ Could not build the work order: ' + (e?.message || e)) }
    setBusy(false)
  }
  async function printLabels(wo: WO) {
    setBusy(true)
    try {
      const d = await loadPrint(wo)
      if (d) {
        const total = planPbLabels(d).reduce((t, p) => t + p.cases, 0)
        if (!total) setFlash('⚠ No cases to label on this work order yet.')
        else if (total <= 300 || window.confirm(`That is ${total} labels. Download them all?`)) {
          const missing = d.lines.filter(l => !l.upc && !l.gtin_image_url).map(l => l.sku)
          ;(await buildPbCaseLabels(d)).save(`Case-Labels-${wo.wo_code || 'production'}.pdf`)
          setFlash(`🏷 ${total} case label(s) downloaded (4×6).${missing.length ? ` No UPC/GTIN on file for ${missing.join(', ')} — those labels carry the SKU barcode instead.` : ''}`)
        }
      }
    } catch (e: any) { setFlash('⚠ Could not build the labels: ' + (e?.message || e)) }
    setBusy(false)
  }
  const reopen = (wo: WO) => run(() => sb.rpc('pb_wo_set_status', { p_wo: wo.id, p_status: 'In Progress' }) as any, () => `✓ ${wo.wo_code} reopened.`)
  async function undoEntries(ids: string[], label: string, ask = true) {
    const reason = ask ? window.prompt(`Undo ${label}?\n\nWhy? (e.g. "Logged by mistake", "Wrong SKU")`, 'Logged by mistake') : 'Logged by mistake (undo right after logging)'
    if (reason == null) return
    if (!reason.trim()) { setFlash('⚠ Give a reason to undo.'); return }
    if (!ask && !window.confirm(`Undo ${label}? It comes off the log and inventory, and the materials go back.`)) return
    setBusy(true)
    const done: string[] = []; const bad: string[] = []
    for (const id of ids) { const { data, error } = await sb.rpc('pb_void_production', { p_id: id, p_reason: reason.trim() }); if (error) bad.push(error.message); else done.push(`${fmtN((data as any)?.qty)} × ${(data as any)?.sku}`) }
    setBusy(false); setJustLogged(null)
    setFlash(bad.length ? `⚠ ${done.length ? 'Undone: ' + done.join(', ') + '. ' : ''}Not undone: ${bad.join(' · ')}` : `↩ Undone: ${done.join(', ')} — off the log and inventory, materials put back.`)
    reload()
  }
  async function undoRelease(r: Rel) {
    const reason = window.prompt(`Undo the release of ${fmtN(r.qty)} ${u(uomOf(r.sku))} of ${r.sku}? They go back to free stock.\n\nWhy?`, 'Released to the wrong order')
    if (!reason) return
    await run(() => sb.rpc('pb_release_undo', { p_id: r.id, p_reason: reason }) as any, () => `↩ Release undone — ${fmtN(r.qty)} of ${r.sku} back in free stock.`)
  }

  const card = 'bg-white rounded-xl shadow-sm border border-[#ECEEF3]'
  const th = 'text-[10px] uppercase tracking-wide text-gray-400 font-semibold px-3 py-2'
  const td = 'px-3 py-2 border-t border-[#F0F2F6]'

  if (!cfg) return <div className="max-w-6xl mx-auto px-5 py-10 text-sm text-gray-500">{loadErr ? <span className="text-red-600">{loadErr}</span> : 'Loading…'}</div>

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-5 py-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border" style={{ background: ACCENT + '14', color: ACCENT, borderColor: ACCENT + '55' }}>PRODUCTION · {cfg.sections.join(', ').toUpperCase()}</span>
          <h1 className="text-2xl font-semibold text-[#1A1D2E] mt-1">{cfg.title}</h1>
          <p className="text-gray-500 text-sm">Week of {fmtDay(week)} – {fmtDay(weekEnd)} · counts in each item&apos;s own unit</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border border-[#E4E6EE] bg-white overflow-hidden">
            <button onClick={() => setWeek(addDays(week, -7))} className="px-3 h-10 text-gray-500 hover:bg-gray-50" aria-label="Previous week" data-ro-ok>‹</button>
            <button onClick={() => setWeek(mondayOf(today))} className="px-3 h-10 text-sm font-semibold text-gray-600 hover:bg-gray-50 border-x border-[#E4E6EE]" data-ro-ok>This week</button>
            <button onClick={() => setWeek(addDays(week, 7))} className="px-3 h-10 text-gray-500 hover:bg-gray-50" aria-label="Next week" data-ro-ok>›</button>
          </div>
          {canEdit && <button onClick={() => setNewWo({})} className="h-10 px-4 rounded-lg border text-sm font-bold bg-white" style={{ borderColor: ACCENT, color: ACCENT }}>+ New work order</button>}
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

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
        {[['Open work orders', openWos.length, ACCENT], ['Order lines still to release', totals.openLines, '#a25ddc'], ['Lines ready to ship', totals.ready, '#fdab3d'], ['Items short for open orders', totals.short, totals.short > 0 ? '#e2445c' : '#00c875'], ['Logs this week', totals.made, '#0071ce']].map(([l, v, c]) =>
          <div key={String(l)} className={card + ' px-3 py-2.5'} style={{ borderTop: `4px solid ${c}` }}>
            <p className="text-[10px] uppercase tracking-wide text-gray-400">{l}</p>
            <p className="text-xl font-extrabold text-[#1A1D2E]">{loading ? '…' : fmtN(v)}</p>
          </div>)}
      </div>

      {tab === 'production' && <>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold text-[#1A1D2E]">Work orders <span className="text-xs font-normal text-gray-400">— one per PO, or a stock build</span></h2>
          <label className="text-xs text-gray-500 flex items-center gap-1.5"><input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} data-ro-ok /> Show closed (30 days)</label>
        </div>
        {!loading && openWos.length === 0 && <div className={card + ' p-4 mb-3 flex flex-wrap items-center gap-3'}>
          <p className="text-sm text-gray-600 flex-1">No open work orders. {canEdit ? 'Create one for a PO (you can add other POs that need the same items), or a stock build with your own targets.' : ''}</p>
          {canEdit && <button onClick={() => setNewWo({})} className="h-10 px-4 rounded-lg text-white text-sm font-bold" style={{ background: ACCENT }}>+ New work order</button>}
        </div>}
        {(() => { const fw = fresh && wos.find(w => w.id === fresh); return fw ? (
          <div className="rounded-xl border-2 p-3 mb-3 flex flex-wrap items-center gap-2" style={{ borderColor: ACCENT, background: ACCENT + '0D' }}>
            <p className="flex-1 text-sm text-[#1A1D2E]"><b>{fw.wo_code}</b> is ready. Add the job details (print, specs, operator…), then print the work order and the 4×6 case labels.</p>
            <button onClick={() => setDetails({ id: fw.id, code: fw.wo_code })} className="h-9 px-3 rounded-lg text-xs font-bold border-2 bg-white" style={{ borderColor: ACCENT, color: ACCENT }}>✎ Details</button>
            <button onClick={() => printWo(fw)} disabled={busy} className="h-9 px-3 rounded-lg text-xs font-bold text-white" style={{ background: ACCENT }}>🖨 Download work order</button>
            <button onClick={() => printLabels(fw)} disabled={busy} className="h-9 px-3 rounded-lg text-xs font-bold text-white" style={{ background: ACCENT }}>🏷 Download case labels</button>
            <button onClick={() => setFresh(null)} className="text-gray-400 text-xl px-1" aria-label="Dismiss">&times;</button>
          </div>) : null })()}
        {shownWos.map(wo => {
          const rows = prog.filter(p => p.work_order_id === wo.id).sort((a, b) => a.sku.localeCompare(b.sku))
          const allMade = rows.length > 0 && rows.every(r => num(r.made_qty) >= num(r.target_qty))
          const anyMade = rows.some(r => num(r.made_qty) > 0)
          const done = WO_DONE.includes(wo.status || '')
          const pos = woOrders.filter(o => o.work_order_id === wo.id)
          return (
            <div key={wo.id} className={card + ' p-4 mb-3'} style={{ borderLeft: `5px solid ${done ? '#9699a6' : ACCENT}` }}>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
                <div className="flex-1">
                  <p className="font-bold text-[#1A1D2E]">{wo.wo_code} <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full ml-1" style={{ background: done ? '#ECEEF3' : ACCENT + '1A', color: done ? '#676879' : ACCENT }}>{wo.status}</span>
                    {wo.due_date && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full ml-1 bg-[#F2F4F8] text-gray-600">{pos.length ? 'ship' : 'due'} {fmtDay(wo.due_date)}</span>}
                    {!pos.length && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full ml-1 bg-[#FFF4E5] text-[#B26A00]">stock build</span>}
                    {allMade && !done && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full ml-1 bg-emerald-50 text-emerald-700">all made</span>}</p>
                  <div className="flex flex-wrap gap-1 mt-1">{pos.map(o => <a key={o.sales_order_id} href={`/sales/orders?item=${o.sales_order_id}`} className="text-[11px] px-2 py-0.5 rounded-full bg-[#EEF2FB] text-[#3A4A6B] hover:underline">{orderLabel(o)}</a>)}</div>
                  {!done && <WoMachinePicker sb={sb} woId={wo.id} woCode={wo.wo_code} value={wo.machine_id} board={boardKey} canEdit={canEdit} onSaved={m => setFlash(m)} />}
                </div>
                <div className="flex flex-wrap gap-2">
                  {canEdit && !done && pos.length > 0 && <button onClick={() => setNewWo({ addTo: wo.id })} className="h-9 px-3 rounded-lg border border-[#E4E6EE] text-xs font-semibold text-gray-600">+ Add PO</button>}
                  {canEdit && !done && <button onClick={() => setEditTargets(editTargets === wo.id ? null : wo.id)} className="h-9 px-3 rounded-lg border border-[#E4E6EE] text-xs font-semibold text-gray-600">{editTargets === wo.id ? 'Done editing' : '✎ Targets'}</button>}
                  <button onClick={() => setDetails({ id: wo.id, code: wo.wo_code })} className="h-9 px-3 rounded-lg border border-[#E4E6EE] text-xs font-semibold text-gray-600" data-ro-ok>✎ Details</button>
                  <button onClick={() => printWo(wo)} disabled={busy} className="h-9 px-3 rounded-lg border border-[#E4E6EE] text-xs font-semibold text-gray-600" data-ro-ok>🖨 Work order</button>
                  <button onClick={() => printLabels(wo)} disabled={busy} className="h-9 px-3 rounded-lg border border-[#E4E6EE] text-xs font-semibold text-gray-600" data-ro-ok>🏷 Case labels</button>
                  <button onClick={() => setSum({ id: wo.id, mode: 'view' })} className="h-9 px-3 rounded-lg border border-[#E4E6EE] text-xs font-semibold text-gray-600" data-ro-ok>📄 Summary</button>
                  {canEdit && !done && <button onClick={() => setSum({ id: wo.id, mode: 'close' })} className="h-9 px-3 rounded-lg text-xs font-bold text-white bg-[#00a85a]">Close out</button>}
                  {canEdit && !done && !anyMade && <button onClick={() => delWo(wo)} disabled={busy} className="h-9 px-3 rounded-lg border border-red-200 text-xs font-semibold text-red-600">Delete</button>}
                  {canEdit && done && <button onClick={() => reopen(wo)} disabled={busy} className="h-9 px-3 rounded-lg border border-[#E4E6EE] text-xs font-semibold text-gray-600">Reopen</button>}
                </div>
              </div>
              {rows.length === 0 && <p className="text-sm text-gray-400">No targets{canEdit && !done ? ' — click ✎ Targets to add.' : '.'}</p>}
              <div className="space-y-2">
                {rows.map(r => {
                  const pct = num(r.target_qty) ? Math.min(100, (num(r.made_qty) / num(r.target_qty)) * 100) : 100
                  const cs = casesTxt(r.sku, num(r.target_qty))
                  return (
                    <div key={r.sku} className="flex items-center gap-3">
                      <div className="w-40 sm:w-56 min-w-0"><p className="font-mono text-[12px] font-semibold text-[#1A1D2E] truncate">{r.sku}</p><p className="text-[10px] text-gray-400 truncate">{r.product_name}</p></div>
                      <div className="flex-1 h-2.5 bg-[#F0F2F6] rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: pct + '%', background: num(r.made_qty) >= num(r.target_qty) && num(r.target_qty) > 0 ? '#00c875' : ACCENT }} /></div>
                      {editTargets === wo.id
                        ? <input type="number" min={0} defaultValue={+num(r.target_qty).toFixed(3)} onBlur={e => { const v = Number(e.target.value); if (Math.abs(v - num(r.target_qty)) > 1e-6) setTarget(wo.id, r.sku, v) }} className="w-24 h-8 border border-[#E4E6EE] rounded px-2 text-sm text-right" />
                        : <p className="w-44 text-right text-sm"><b>{fmtN(r.made_qty)}</b><span className="text-gray-400"> / {fmtN(r.target_qty)} {u(r.uom)}</span>{cs ? <span className="block text-[10px] text-gray-400">{cs} to make</span> : null}</p>}
                    </div>)
                })}
                {editTargets === wo.id && <AddTarget accent={ACCENT} unit="qty" skus={catalog.map(s => s.sku.toUpperCase()).filter(s => !rows.some(r => r.sku === s))} onAdd={(sku, q) => setTarget(wo.id, sku, q)} />}
              </div>
            </div>)
        })}

        <WalmartWeekCharts skus={weekSkus} entries={live} week={week} prog={openProg} woCode={openWos.length === 1 ? openWos[0].wo_code : `${openWos.length} open work orders`} unit="units" reportsHref="/production/reports" />

        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold text-[#1A1D2E]">Daily log</h2>
          <label className="text-xs text-gray-500 flex items-center gap-1.5"><input type="checkbox" checked={showVoided} onChange={e => setShowVoided(e.target.checked)} data-ro-ok /> Show removed</label>
        </div>
        <div className="space-y-3 mb-5">
          {days.map(([d, rows]) => {
            const color = d === today ? ACCENT : '#9699a6'
            return (
              <div key={d} className={card + ' overflow-hidden'}>
                <div className="flex items-center gap-2.5 px-4 py-2.5" style={{ borderLeft: '5px solid ' + color }}>
                  <span className="font-bold text-sm" style={{ color }}>{d === today ? 'Today · ' : ''}{fmtDay(d)}</span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: color + '22', color }}>{rows.filter(r => !r.voided_at).length} log(s)</span>
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
                        <p className="text-lg font-extrabold text-[#1A1D2E] shrink-0 text-right">{fmtN(r.qty)} <span className="text-[10px] font-normal text-gray-400">{u(uomOf(r.sku))}</span>{casesTxt(r.sku, num(r.qty)) ? <span className="block text-[10px] font-normal text-gray-400">{casesTxt(r.sku, num(r.qty))}</span> : null}</p>
                        {canUndo ? <button onClick={() => undoEntries([r.id], `${fmtN(r.qty)} ${u(uomOf(r.sku))} × ${r.sku} (${fmtTime(r.created_at)})`)} disabled={busy} className="shrink-0 h-9 px-3 rounded-lg border border-[#ECEEF3] text-xs font-semibold text-gray-500 hover:text-red-600 hover:border-red-200 bg-white disabled:opacity-50">↩ Undo</button> : <span className="w-3 shrink-0" />}
                      </div>)
                  })}
                </div>
              </div>)
          })}
          {!loading && days.length === 0 && <div className={card + ' p-8 text-center text-sm text-gray-500'}>No production logged on this board this week.</div>}
        </div>

        <div className={card + ' overflow-x-auto mb-5'}>
          <p className="px-4 pt-3 font-bold text-[#1A1D2E] text-sm">Finished goods <span className="font-normal text-gray-400 text-xs">— each in its own stocking unit</span></p>
          <table className="w-full text-sm min-w-[880px] mt-2">
            <thead><tr className="border-b border-[#EEF0F4]">
              <th className={th + ' text-left'}>SKU</th>
              <th className={th + ' text-left'}>Unit</th>
              <th className={th + ' text-right'} title="On hand on the Inventory board">On hand</th>
              <th className={th + ' text-right'} title="Released to open orders, not shipped yet">Released</th>
              <th className={th + ' text-right'} title="On hand minus released — what can still go to an order">Free</th>
              <th className={th + ' text-right'} title="Released on orders that are Ready to Ship / Will Call">Built</th>
              <th className={th + ' text-right'} title="Still to ship on this board's open orders">Committed</th>
              <th className={th + ' text-right'}>Short</th>
              <th className={th + ' text-right'}>Made (7 days)</th>
            </tr></thead>
            <tbody>
              {stock.map(s => (
                <tr key={s.sku}>
                  <td className={td}><p className="font-mono text-[12px] font-semibold">{s.sku}</p><p className="text-[10px] text-gray-400 truncate max-w-[260px]">{s.product_name}</p></td>
                  <td className={td + ' text-[12px] text-gray-600 whitespace-nowrap'}>{u(s.uom)}{num(s.case_qty) > 1 ? <span className="block text-[10px] text-gray-400">{fmtN(s.case_qty)}/case</span> : null}</td>
                  <td className={td + ' text-right font-semibold'}>{fmtN(s.on_hand)}</td>
                  <td className={td + ' text-right'}>{num(s.held) ? fmtN(s.held) : '—'}</td>
                  <td className={td + ' text-right ' + (num(s.free) < 0 ? 'text-red-600 font-bold' : '')}>{fmtN(s.free)}</td>
                  <td className={td + ' text-right text-amber-700 font-semibold'}>{num(s.built) ? fmtN(s.built) : '—'}</td>
                  <td className={td + ' text-right'}>{num(s.committed) ? fmtN(s.committed) : '—'}</td>
                  <td className={td + ' text-right font-bold ' + (num(s.short) > 0 ? 'text-red-600' : 'text-gray-300')}>{num(s.short) > 0 ? fmtN(s.short) : '—'}</td>
                  <td className={td + ' text-right'}>{num(s.made_7d) ? fmtN(s.made_7d) : '—'}</td>
                </tr>))}
              {!loading && stock.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-gray-400">No {itemWord}s with open orders or production on this board yet.</td></tr>}
            </tbody>
          </table>
          <p className="px-4 py-2 text-[11px] text-gray-400">Shows items with open orders, open work orders or production logged here. <b>On hand</b> is the Inventory board number (today&apos;s count was the starting balance). Logging production adds to it and takes the BOM materials out; shipping takes it off as it does today. <b>Free</b> = on hand − released to open orders.</p>
        </div>
      </>}

      {tab === 'orders' && <div className="space-y-3">
        {ordersGrouped.length === 0 && !loading && <div className={card + ' p-8 text-center text-sm text-gray-500'}>No open {cfg.sections.join(' / ')} orders with {itemWord}s.</div>}
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
                {o.wo_code ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: ACCENT + '1A', color: ACCENT }}>{o.wo_code}</span>
                  : canEdit && <button onClick={() => setNewWo({ order: o.sales_order_id })} className="h-8 px-3 rounded-lg text-xs font-bold text-white" style={{ background: ACCENT }}>Create work order</button>}
              </div>
              <div className="overflow-x-auto"><table className="w-full text-sm min-w-[720px]">
                <thead><tr><th className={th + ' text-left'}>Item</th><th className={th + ' text-right'}>Ordered</th><th className={th + ' text-right'}>Released</th><th className={th + ' text-right'}>Built</th><th className={th + ' text-right'}>Shipped</th><th className={th + ' text-right'}>Still to release</th><th className={th}></th></tr></thead>
                <tbody>{lines.map(l => {
                  const free = num(stock.find(s => s.sku === l.sku)?.free)
                  return (
                    <tr key={l.line_id}>
                      <td className={td}><p className="font-mono text-[12px] font-semibold">{l.sku}</p><p className="text-[10px] text-gray-400 truncate max-w-[280px]">{l.product_name}</p></td>
                      <td className={td + ' text-right'}>{fmtN(l.ordered)} <span className="text-[10px] text-gray-400">{u(l.uom)}</span>{casesTxt(l.sku, num(l.ordered)) ? <span className="block text-[10px] text-gray-400">{casesTxt(l.sku, num(l.ordered))}</span> : null}</td>
                      <td className={td + ' text-right'}>{fmtN(l.released)}</td>
                      <td className={td + ' text-right text-amber-700'}>{num(l.built) ? fmtN(l.built) : '—'}</td>
                      <td className={td + ' text-right'}>{num(l.shipped) ? fmtN(l.shipped) : '—'}</td>
                      <td className={td + ' text-right font-bold ' + (num(l.open_qty) > 0 ? 'text-red-600' : 'text-emerald-600')}>{num(l.open_qty) > 0 ? fmtN(l.open_qty) : '✓'}</td>
                      <td className={td + ' text-right'}>{canEdit && num(l.open_qty) > 0 && <button onClick={() => setReleaseFor(l)} disabled={free <= 0} title={free <= 0 ? 'Nothing free for this item — log production first' : ''} className="h-8 px-3 rounded-lg text-xs font-bold text-white disabled:opacity-40" style={{ background: ACCENT }}>Release {free > 0 ? `(${fmtN(free)} free)` : ''}</button>}</td>
                    </tr>)
                })}</tbody>
              </table></div>
              {orderRels.length > 0 && <div className="px-4 py-2 bg-[#FAFBFD] text-[12px] space-y-1">
                {orderRels.map(r => <div key={r.id} className="flex items-center gap-2"><span className="flex-1 text-gray-600"><b>{fmtN(r.qty)}</b> × {r.sku} released by {who(r.released_by)} · {new Date(r.released_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{r.note ? ` · ${r.note}` : ''}</span>
                  {canEdit && <button onClick={() => undoRelease(r)} disabled={busy} className="text-[11px] text-gray-400 hover:text-red-600">Undo</button>}</div>)}
              </div>}
            </div>)
        })}
      </div>}

      {tab === 'activity' && <div className={card + ' overflow-x-auto'}>
        <table className="w-full text-sm min-w-[640px]">
          <thead><tr><th className={th + ' text-left'}>When</th><th className={th + ' text-left'}>Who</th><th className={th + ' text-left'}>What</th><th className={th + ' text-left'}>SKU</th><th className={th + ' text-right'}>Qty</th><th className={th + ' text-left'}>Detail</th></tr></thead>
          <tbody>{acts.map(a => (
            <tr key={a.id}><td className={td + ' whitespace-nowrap text-gray-500'}>{new Date(a.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
              <td className={td}>{who(a.actor)}</td><td className={td}>{ACTION[a.action] || a.action}</td><td className={td + ' font-mono text-[12px]'}>{a.sku || ''}</td>
              <td className={td + ' text-right'}>{a.qty != null ? fmtN(a.qty) : ''}</td><td className={td + ' text-gray-500'}>{a.detail || ''}</td></tr>))}
            {acts.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-gray-400">No activity yet.</td></tr>}
          </tbody>
        </table>
      </div>}

      {showLog && <LogSheet sb={sb} cfg={cfg} catalog={catalog} stock={stock} wos={openWos} prog={prog} today={today} itemWord={itemWord} onClose={() => setShowLog(false)}
        onSaved={(msg, ids, label) => { setFlash(msg); setShowLog(false); setTab('production'); if (ids.length) setJustLogged({ ids, label }); reload() }} />}
      {releaseFor && <ReleaseModal sb={sb} cfg={cfg} line={releaseFor} free={num(stock.find(s => s.sku === releaseFor.sku)?.free)} onClose={() => setReleaseFor(null)}
        onDone={m => { setReleaseFor(null); setFlash(m); reload() }} />}
      {newWo && <NewWoModal sb={sb} cfg={cfg} orders={orders} wos={openWos} start={newWo.order} addTo={newWo.addTo} prog={prog} onClose={() => setNewWo(null)}
        onDone={(m, id) => { setNewWo(null); setFlash(m); setTab('production'); if (id) { const stockBuild = m.toLowerCase().includes('stock build'); setFresh(id); setEditTargets(stockBuild ? id : null); if (!stockBuild) setDetails({ id, code: null, isNew: true }) } reload() }} />}
      {details && cfg && <WoDetailsModal sb={sb} kind="pb" boardKey={cfg.key} woId={details.id} woCode={details.code || wos.find(w => w.id === details.id)?.wo_code || null} accent={ACCENT} canEdit={canEdit} isNew={details.isNew} onClose={() => setDetails(null)} onSaved={m => { setDetails(null); setFlash(m); reload() }} />}
      {sum && <WalmartWoSummary kind="pb" sb={sb} woId={sum.id} mode={sum.mode} canEdit={canEdit} userEmail={me} onClose={() => setSum(null)} onClosedOut={m => { setSum(null); setFlash(m); reload() }} />}
    </div>
  )
}

const ACTION: Record<string, string> = {
  logged: 'Logged production', voided: 'Removed a log', released: 'Released to order', release_undone: 'Undid a release',
  wo_created: 'Created work order', wo_closed: 'Closed out work order', wo_reopened: 'Reopened work order', wo_deleted: 'Deleted work order',
  wo_order_added: 'Added PO to work order', target_set: 'Set target',
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-[110] bg-black/50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>{children}</div>
    </div>, document.body)
}

function AddTarget({ skus, onAdd, accent, unit }: { skus: string[]; onAdd: (sku: string, q: number) => void; accent: string; unit: string }) {
  const [sku, setSku] = useState(''); const [q, setQ] = useState('')
  return (
    <div className="flex items-center gap-2 pt-1">
      <select value={sku} onChange={e => setSku(e.target.value)} className="h-8 border border-[#E4E6EE] rounded px-2 text-sm flex-1"><option value="">+ Add an item…</option>{skus.map(s => <option key={s} value={s}>{s}</option>)}</select>
      <input type="number" min={1} value={q} onChange={e => setQ(e.target.value)} placeholder={unit} className="w-24 h-8 border border-[#E4E6EE] rounded px-2 text-sm text-right" />
      <button onClick={() => { if (sku && Number(q) > 0) { onAdd(sku, Number(q)); setSku(''); setQ('') } }} className="h-8 px-3 rounded text-xs font-bold text-white" style={{ background: accent }}>Add</button>
    </div>)
}

function LogSheet({ sb, cfg, catalog, stock, wos, prog, today, itemWord, onClose, onSaved }: {
  sb: any; cfg: BoardCfg; catalog: { sku: string; product_name: string; unit_of_measure: string | null; case_qty: number | null }[]; stock: Stock[]; wos: WO[]; prog: Prog[]; today: string; itemWord: string
  onClose: () => void; onSaved: (msg: string, ids: string[], label: string) => void
}) {
  const [date, setDate] = useState(today)
  const [woId, setWoId] = useState('')
  const [rows, setRows] = useState<{ sku: string; qty: string }[]>([{ sku: '', qty: '' }])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (i: number, p: Partial<{ sku: string; qty: string }>) => setRows(r => r.map((x, j) => j === i ? { ...x, ...p } : x))
  // items on the chosen work order first, then the rest of the category
  // only the items on the chosen work order (or on any open work order when Auto)
  const onWo = new Set(prog.filter(p => (woId ? p.work_order_id === woId : wos.some(w => w.id === p.work_order_id))).map(p => p.sku))
  const opts = catalog.filter(c => onWo.has(c.sku.toUpperCase()))
  useEffect(() => { setRows(rs => rs.map(r => (r.sku && !onWo.has(r.sku.toUpperCase()) ? { ...r, sku: '' } : r))) }, [woId]) // eslint-disable-line
  async function save() {
    setErr('')
    const good = rows.filter(r => r.sku && Number(r.qty) > 0)
    if (!good.length) { setErr(`Pick a ${itemWord} and enter how many were made.`); return }
    setBusy(true)
    const ids: string[] = []; const ok: string[] = []; const bad: string[] = []
    for (const r of good) {
      const { data, error } = await sb.rpc('pb_record_production', { p_board: cfg.key, p_sku: r.sku, p_qty: Number(r.qty), p_date: date, p_wo: woId || null, p_note: note.trim() || null })
      if (error) bad.push(`${r.sku}: ${error.message}`); else { ok.push(`${r.qty} ${(data as any)?.uom || ''} × ${r.sku}`); if ((data as any)?.id) ids.push((data as any).id) }
    }
    setBusy(false)
    if (bad.length) { setErr((ok.length ? `Saved: ${ok.join(', ')}. ` : '') + 'Not saved — ' + bad.join(' · ')); setRows(rows.filter(r => bad.some(b => b.startsWith(r.sku + ':')))); return }
    onSaved(`✓ Saved ${ok.join(', ')} for ${fmtDay(date)} — inventory updated, materials taken out.`, ids, ok.join(', '))
  }
  const inp = 'h-11 border border-[#E4E6EE] rounded-lg px-3 text-sm w-full'
  return (
    <Overlay onClose={() => !busy && onClose()}>
      <div className="px-5 pt-4 pb-3 border-b border-[#EEF0F4] flex items-center justify-between">
        <div><p className="text-[11px] uppercase tracking-wide text-gray-400">{cfg.title}</p><h2 className="text-lg font-bold text-[#1A1D2E]">Log production</h2></div>
        <button onClick={onClose} className="text-gray-400 text-3xl leading-none px-2" aria-label="Close">&times;</button>
      </div>
      <div className="px-5 py-4 space-y-3 overflow-y-auto">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs text-gray-500">Date made</label><input type="date" value={date} max={today} onChange={e => setDate(e.target.value)} className={inp} /></div>
          <div><label className="text-xs text-gray-500">Work order</label><select value={woId} onChange={e => setWoId(e.target.value)} className={inp}><option value="">Auto — the open work order for that item</option>{wos.map(w => <option key={w.id} value={w.id}>{w.wo_code}</option>)}</select></div>
        </div>
        {rows.map((r, i) => {
          const c = catalog.find(x => x.sku === r.sku)
          const cm = c ? caseMath({ uom: c.unit_of_measure, case_qty: c.case_qty }, Number(r.qty) || 0) : null
          const st = stock.find(s => s.sku === r.sku.toUpperCase())
          return (
            <div key={i} className="rounded-xl border border-[#ECEEF3] p-3 space-y-2">
              <select value={r.sku} onChange={e => set(i, { sku: e.target.value })} className={inp}>
                <option value="">{opts.length ? `Pick a ${itemWord} on this work order…` : `No ${itemWord}s on this work order`}</option>
                {opts.map(s => <option key={s.sku} value={s.sku}>{s.sku} — {s.product_name}</option>)}
              </select>
              <div className="flex items-center gap-2">
                <input inputMode="decimal" value={r.qty} onChange={e => set(i, { qty: e.target.value.replace(/[^0-9.]/g, '') })} placeholder={c ? `${u(c.unit_of_measure)} made` : 'Quantity made'} className={inp} />
                {c && <span className="text-sm text-gray-500 shrink-0">{u(c.unit_of_measure)}</span>}
                {rows.length > 1 && <button onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} className="text-gray-400 text-xl px-2">&times;</button>}
              </div>
              {c && <p className="text-[11px] text-gray-500">{Number(r.qty) > 0 ? `→ +${fmtN(r.qty)} ${u(c.unit_of_measure)} into inventory${cm && (cm.perCase > 1) ? ` (${fmtN(cm.cases)} cases of ${fmtN(cm.perCase)})` : ''}` : `Counted in ${u(c.unit_of_measure)}${num(c.case_qty) > 1 ? ` · ${fmtN(c.case_qty)} per case` : ''}`}{st ? ` · on hand now ${fmtN(st.on_hand)}` : ''}</p>}
            </div>)
        })}
        <button onClick={() => setRows(r => [...r, { sku: '', qty: '' }])} className="text-sm font-semibold" style={{ color: cfg.accent }}>+ Another item</button>
        <div><label className="text-xs text-gray-500">Note (optional)</label><input value={note} onChange={e => setNote(e.target.value)} placeholder="Machine, shift, anything worth knowing" className={inp} /></div>
        {err && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
      </div>
      <div className="px-5 py-3 border-t border-[#EEF0F4] flex gap-2">
        <button onClick={onClose} disabled={busy} className="flex-1 h-11 rounded-lg border border-[#E4E6EE] text-sm">Cancel</button>
        <button onClick={save} disabled={busy} className="flex-1 h-11 rounded-lg text-white text-sm font-bold disabled:opacity-50" style={{ background: cfg.accent }}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </Overlay>)
}

function ReleaseModal({ sb, cfg, line, free, onClose, onDone }: { sb: any; cfg: BoardCfg; line: OLine; free: number; onClose: () => void; onDone: (m: string) => void }) {
  const max = Math.max(0, Math.min(num(line.open_qty), free))
  const [qty, setQty] = useState(String(+max.toFixed(3)))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function go() {
    setErr('')
    const q = Number(qty)
    if (!(q > 0)) { setErr('Enter how many to release.'); return }
    setBusy(true)
    const { error } = await sb.rpc('pb_release', { p_board: cfg.key, p_line: line.line_id, p_qty: q, p_note: note.trim() || null })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onDone(`✓ Released ${fmtN(q)} ${u(line.uom)} of ${line.sku} to ${line.order_name} (SO #${line.order_number}).`)
  }
  const inp = 'h-11 border border-[#E4E6EE] rounded-lg px-3 text-sm w-full'
  return (
    <Overlay onClose={() => !busy && onClose()}>
      <div className="px-5 pt-4 pb-3 border-b border-[#EEF0F4]">
        <p className="text-[11px] uppercase tracking-wide text-gray-400">Release to order</p>
        <h2 className="text-lg font-bold text-[#1A1D2E]">{line.order_name} · SO #{line.order_number}</h2>
        <p className="text-xs text-gray-500"><span className="font-mono">{line.sku}</span> · {fmtN(line.open_qty)} {u(line.uom)} still to release · {fmtN(free)} free</p>
      </div>
      <div className="px-5 py-4 space-y-3">
        <div><label className="text-xs text-gray-500">{u(line.uom)} to release</label><input inputMode="decimal" value={qty} onChange={e => setQty(e.target.value.replace(/[^0-9.]/g, ''))} className={inp} /></div>
        <div><label className="text-xs text-gray-500">Note (optional)</label><input value={note} onChange={e => setNote(e.target.value)} className={inp} /></div>
        {err && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
      </div>
      <div className="px-5 py-3 border-t border-[#EEF0F4] flex gap-2">
        <button onClick={onClose} disabled={busy} className="flex-1 h-11 rounded-lg border border-[#E4E6EE] text-sm">Cancel</button>
        <button onClick={go} disabled={busy || max <= 0} className="flex-1 h-11 rounded-lg text-white text-sm font-bold disabled:opacity-50" style={{ background: cfg.accent }}>{busy ? 'Releasing…' : 'Release'}</button>
      </div>
    </Overlay>)
}

function NewWoModal({ sb, cfg, orders, wos, start, addTo, prog, onClose, onDone }: {
  sb: any; cfg: BoardCfg; orders: OLine[]; wos: WO[]; start?: string; addTo?: string; prog: Prog[]; onClose: () => void; onDone: (m: string, newId?: string) => void
}) {
  const free = useMemo(() => {
    const m = new Map<string, OLine[]>()
    for (const l of orders) if (!l.work_order_id) { if (!m.has(l.sales_order_id)) m.set(l.sales_order_id, []); m.get(l.sales_order_id)!.push(l) }
    return m
  }, [orders])
  const [mode, setMode] = useState<'po' | 'stock'>(start || addTo ? 'po' : free.size ? 'po' : 'stock')
  const [primary, setPrimary] = useState<string>(start && free.has(start) ? start : '')
  const [extra, setExtra] = useState<Set<string>>(new Set())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [machineId, setMachineId] = useState('')
  const [machineChoices, setMachineChoices] = useState<MachineOpt[]>([])
  useEffect(() => {
    sb.from('machines').select('id,machine_code,name,equipment_group').eq('is_active', true).order('machine_code')
      .then(({ data }: any) => setMachineChoices(((data as MachineOpt[]) || []).filter(m => machineFitsBoard(cfg.key, m))))
  }, [sb])
  // Stamp the connection on the new work order so Machine Status picks it up.
  async function connectNew(newId: string) {
    if (!machineId) return
    const { error } = await sb.rpc('wo_set_machines', { p_wo: newId, p_board: cfg.key, p_machine_ids: [machineId] })
    if (error) window.alert(`Work order created, but the machine did not connect: ${error.message}. Pick the machine on the work order card.`)
  }
  const addWo = addTo ? wos.find(w => w.id === addTo) : null
  const skus = useMemo(() => new Set(addWo ? prog.filter(p => p.work_order_id === addWo.id).map(p => p.sku) : (free.get(primary) || []).map(l => l.sku)), [addWo, prog, free, primary])
  const candidates = Array.from(free.entries()).filter(([id, ls]) => id !== primary && ls.some(l => skus.has(l.sku)))
  const label = (ls: OLine[]) => `${ls[0].order_name} · SO ${ls[0].order_number}${ls[0].po_number ? ' · PO ' + ls[0].po_number : ''}`
  const toggle = (id: string) => setExtra(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  async function go() {
    setErr('')
    if (addWo) {
      if (!extra.size) { setErr('Pick at least one PO to add.'); return }
      setBusy(true)
      for (const id of Array.from(extra)) { const { error } = await sb.rpc('pb_wo_add_order', { p_wo: addWo.id, p_order: id }); if (error) { setBusy(false); setErr(error.message); return } }
      setBusy(false); onDone(`✓ Added ${extra.size} PO${extra.size === 1 ? '' : 's'} to ${addWo.wo_code} — targets updated.`); return
    }
    if (mode === 'stock') {
      setBusy(true)
      const { data: newId, error } = await sb.rpc('pb_wo_create', { p_board: cfg.key, p_orders: [], p_note: note.trim() || null })
      setBusy(false)
      if (error) { setErr(error.message); return }
      await connectNew(newId as string)
      onDone('✓ Stock build work order created — add the items and quantities to make (✎ Targets).', newId as string); return
    }
    if (!primary) { setErr('Pick the PO for this work order.'); return }
    setBusy(true)
    const { data: newId, error } = await sb.rpc('pb_wo_create', { p_board: cfg.key, p_orders: [primary, ...Array.from(extra)], p_note: note.trim() || null })
    setBusy(false)
    if (error) { setErr(error.message); return }
    await connectNew(newId as string)
    onDone(`✓ Work order created for SO ${free.get(primary)?.[0].order_number}${extra.size ? ` + ${extra.size} more PO${extra.size === 1 ? '' : 's'}` : ''} — targets set from the order.`, newId as string)
  }
  const inp = 'h-11 border border-[#E4E6EE] rounded-lg px-3 text-sm w-full'
  return (
    <Overlay onClose={() => !busy && onClose()}>
      <div className="px-5 pt-4 pb-3 border-b border-[#EEF0F4]">
        <p className="text-[11px] uppercase tracking-wide text-gray-400">{cfg.title}</p>
        <h2 className="text-lg font-bold text-[#1A1D2E]">{addWo ? `Add POs to ${addWo.wo_code}` : 'New work order'}</h2>
      </div>
      <div className="px-5 py-4 space-y-4 overflow-y-auto">
        {!addWo && <div className="flex gap-1 bg-[#F2F4F8] rounded-lg p-1">
          {([['po', 'For a PO'], ['stock', 'Stock build (no PO)']] as const).map(([k, l]) => <button key={k} onClick={() => setMode(k)} className={`flex-1 h-9 rounded-md text-sm font-semibold ${mode === k ? 'bg-white shadow-sm text-[#1A1D2E]' : 'text-gray-500'}`}>{l}</button>)}
        </div>}
        {!addWo && mode === 'stock' && <p className="text-sm text-gray-600">Creates an empty work order for building stock. Add the items and how many to make with <b>✎ Targets</b>, then print the work order and labels.</p>}
        {!addWo && mode === 'po' && <div>
          <label className="text-xs text-gray-500">PO</label>
          <select value={primary} onChange={e => { setPrimary(e.target.value); setExtra(new Set()) }} className={inp}>
            <option value="">Pick an open order…</option>
            {Array.from(free.entries()).map(([id, ls]) => <option key={id} value={id}>{label(ls)}</option>)}
          </select>
          {free.size === 0 && <p className="text-xs text-gray-400 mt-1">Every open order on this board is already on a work order.</p>}
          {primary && <div className="mt-2 rounded-lg bg-[#FAFBFD] border border-[#ECEEF3] p-2 text-[12px] space-y-0.5">
            {(free.get(primary) || []).map(l => <div key={l.line_id} className="flex justify-between gap-2"><span className="font-mono">{l.sku}</span><span className="text-gray-500">{fmtN(l.open_qty)} {u(l.uom)} to make</span></div>)}
          </div>}
        </div>}
        {(addWo || (mode === 'po' && primary)) && <div>
          <p className="text-xs text-gray-500 mb-1">{addWo ? 'POs that need the same items' : 'Also include other POs with the same items (optional)'}</p>
          {candidates.length === 0 && <p className="text-xs text-gray-400">No other open POs need these items.</p>}
          <div className="space-y-1.5">
            {candidates.map(([id, ls]) => (
              <label key={id} className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer ${extra.has(id) ? 'border-emerald-400 bg-emerald-50' : 'border-[#ECEEF3]'}`}>
                <input type="checkbox" checked={extra.has(id)} onChange={() => toggle(id)} className="mt-1" />
                <span className="text-[13px]"><b>{label(ls)}</b>{ls[0].ship_date ? <span className="text-gray-400"> · ship {fmtDay(ls[0].ship_date)}</span> : null}
                  <span className="block text-[11px] text-gray-500">{ls.filter(l => skus.has(l.sku)).map(l => `${l.sku}: ${fmtN(l.open_qty)}`).join(' · ')}</span></span>
              </label>))}
          </div>
        </div>}
        {!addWo && (
          <div>
            <label className="text-xs text-gray-500">Machine (optional)</label>
            <select value={machineId} onChange={e => setMachineId(e.target.value)} className={inp}>
              <option value="">Not connected yet</option>
              {machineChoices.map(m => <option key={m.id} value={m.id}>{m.machine_code} · {m.name}</option>)}
            </select>
          </div>
        )}
        {!addWo && <div><label className="text-xs text-gray-500">Note (optional)</label><input value={note} onChange={e => setNote(e.target.value)} className={inp} /></div>}
        {err && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
      </div>
      <div className="px-5 py-3 border-t border-[#EEF0F4] flex gap-2">
        <button onClick={onClose} disabled={busy} className="flex-1 h-11 rounded-lg border border-[#E4E6EE] text-sm">Cancel</button>
        <button onClick={go} disabled={busy} className="flex-1 h-11 rounded-lg text-white text-sm font-bold disabled:opacity-50" style={{ background: cfg.accent }}>{busy ? 'Saving…' : addWo ? 'Add to work order' : 'Create work order'}</button>
      </div>
    </Overlay>)
}
