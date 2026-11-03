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
 * Work orders are per PO (STR-<SO#>); a work order can also cover other POs that need the same straws.
 */
import WoMachinePicker from '@/components/WoMachinePicker'
import WoDetailsModal from '@/components/WoDetailsModal'
import { applyWoDetails, loadWoDetails } from '@/lib/woDetails'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { usePermissions } from '@/lib/permissions'
import WalmartWeekCharts from '@/components/WalmartWeekCharts'
import WalmartWoSummary from '@/components/WalmartWoSummary'
import { buildStrawWorkOrderPdf, buildStrawCaseLabels, planLabels, type StrawPrint } from '@/lib/strawWoDocs'

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
// std cases × k = the order's own cases (k = 1 when the order uses our standard case)
const kOf = (std: any, pack: any) => num(std) > 0 && num(pack) > 0 && Math.abs(num(std) - num(pack)) > 1e-6 ? num(std) / num(pack) : 1
const who = (e?: string | null) => (e || 'unknown').split('@')[0]

interface WO { id: string; wo_code: string | null; status: string | null; start_date: string; due_date: string | null; qty_ordered: number | null; qty_completed: number | null; machine_id?: string | null }
interface Prog { work_order_id: string; sku: string; product_name: string | null; target_qty: number; made_qty: number; std_pcs?: number | null; pack_pcs?: number | null }
interface Entry { id: string; work_order_id: string | null; production_date: string; sku: string; qty: number; kind: string; lot_number: string | null; note: string | null; entered_by: string | null; created_at: string; voided_at: string | null; voided_by: string | null; void_reason: string | null; pack_pcs?: number | null }
interface Stock { sku: string; product_name: string; uom: string | null; per_case: number | null; free: number; released: number; built: number; on_hand_cases: number; total_cases: number; committed: number; short: number; erp_on_hand: number; erp_built: number }
interface WoOrder { work_order_id: string; sales_order_id: string; sales_orders: { order_number: string | null; po_number: string | null; notes: string | null; customers: { company_name: string | null } | null } | null }
interface OLine { work_order_id: string | null; wo_code: string | null; line_id: string; sales_order_id: string; order_number: string; order_name: string; customer: string | null; po_number: string | null; status: string; ship_date: string | null; sku: string; product_name: string | null; ordered: number; released: number; shipped: number; built: number; open_cases: number; pack_pcs?: number | null; std_pcs?: number | null }
interface Rel { id: string; sales_order_id: string; line_id: string; sku: string; qty: number; status: string; source: string; note: string | null; released_by: string | null; released_at: string }
interface StageEntry { id: string; work_order_id: string; sku: string; stage: string; pcs: number; production_date: string; note: string | null; entered_by: string | null; created_at: string }
const STAGE_LABEL: Record<string, string> = { extrusion: 'Extrusion', bending: 'Bending', wrapping: 'Wrapping' }
const ALL_STEPS = ['extrusion', 'bending', 'wrapping']
/** best guess from the straws on the order: extrusion always, bending for bent/flex, wrapping for wrapped */
const isUnwrapped = (sku: string, name?: string | null) => /unwrap/i.test(name || '') || /-UW/i.test(sku)
/** unwrapped straws are extrusion only */
const allUnwrapped = (lines: { sku: string; product_name?: string | null }[]) => lines.length > 0 && lines.every(l => isUnwrapped(l.sku, l.product_name))
function suggestSteps(lines: { sku: string; product_name?: string | null }[]): string[] {
  if (allUnwrapped(lines)) return ['extrusion']
  const t = lines.map(l => `${l.sku} ${l.product_name || ''}`.toLowerCase())
  const wrap = t.some(x => (/wrapped/.test(x) && !/unwrapped/.test(x)) || /-w(\b|-|f\b|\d)/.test(x))
  const bend = t.some(x => /(bend|bent|flex)/.test(x))
  return ['extrusion', ...(bend ? ['bending'] : []), ...(wrap ? ['wrapping'] : [])]
}
function StepPicker({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const tog = (g: string) => onChange(value.includes(g) ? value.filter(x => x !== g) : ALL_STEPS.filter(x => x === g || value.includes(x)))
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {ALL_STEPS.map((g, i) => (
        <button key={g} type="button" disabled={disabled} onClick={() => tog(g)}
          className={`h-9 px-3 rounded-lg border text-xs font-semibold ${value.includes(g) ? 'text-white' : 'bg-white text-gray-500 border-[#E4E6EE]'}`}
          style={value.includes(g) ? { background: ACCENT, borderColor: ACCENT } : undefined}>{value.includes(g) ? '✓ ' : ''}{i + 1}. {g.charAt(0).toUpperCase() + g.slice(1)}</button>))}
    </div>)
}
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
  const [woOrders, setWoOrders] = useState<WoOrder[]>([])
  const [showClosed, setShowClosed] = useState(false)
  const [newWo, setNewWo] = useState<{ order?: string; addTo?: string } | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  const [stagesBy, setStagesBy] = useState<Record<string, string[]>>({})
  const [digital, setDigital] = useState<string | null>(null)
  const [digitalKey, setDigitalKey] = useState(0)
  const [editSteps, setEditSteps] = useState<{ wo: string; v: string[] } | null>(null)
  const [stageEntries, setStageEntries] = useState<StageEntry[]>([])
  const [details, setDetails] = useState<{ id: string; code: string | null; isNew?: boolean } | null>(null)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const my = ++seq.current
    setLoadErr('')
    const [w, e, s, o, r, a] = await Promise.all([
      // Per-PO work orders: all open ones, plus ones closed in the last 30 days
      sb.from('work_orders').select('id,wo_code,status,start_date,due_date,qty_ordered,qty_completed,completed_at,machine_id')
        .eq('form_type', 'straw_po').neq('status', 'Cancelled')
        .or(`status.not.in.(${WO_DONE.join(',')}),completed_at.gte.${addDays(today, -30)}`).order('due_date', { ascending: true, nullsFirst: false }).order('created_at'),
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
      const [{ data: p }, { data: wo2 }, { data: stg }, { data: se }] = await Promise.all([
        sb.from('v_straw_wo_progress').select('*').in('work_order_id', wl.map(x => x.id)),
        sb.from('straw_wo_orders').select('work_order_id,sales_order_id,sales_orders(order_number,po_number,notes,customers(company_name))').in('work_order_id', wl.map(x => x.id)),
        sb.rpc('straw_wo_stages_many', { p_wos: wl.map(x => x.id) }),
        sb.from('straw_stage_entries').select('id,work_order_id,sku,stage,pcs,production_date,note,entered_by,created_at').in('work_order_id', wl.map(x => x.id)).is('voided_at', null).order('created_at', { ascending: false }),
      ])
      if (my === seq.current) {
        setProg((p as Prog[]) || []); setWoOrders((wo2 as any[]) || [])
        setStagesBy(Object.fromEntries(((stg as any[]) || []).map(r => [r.work_order_id, (r.stages || []) as string[]])))
        setStageEntries((se as StageEntry[]) || [])
      }
    } else { setProg([]); setWoOrders([]); setStagesBy({}); setStageEntries([]) }
    setLoading(false)
  }, [sb, week, weekEnd, today])
  const reload = useCallback(() => { load(); setTimeout(load, 900); setDigitalKey(k => k + 1) }, [load])
  useEffect(() => { try { const q = new URLSearchParams(window.location.search).get('wo'); if (q) setDigital(q) } catch { /* ignore */ } }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const ch = sb.channel('straw-board-' + Math.random().toString(36).slice(2))
    let t: any
    const bump = () => { clearTimeout(t); t = setTimeout(load, 600) }
    for (const tb of ['straw_stage_entries', 'wo_machines', 'straw_production_entries', 'straw_releases', 'straw_wo_targets', 'straw_wo_orders', 'sales_orders', 'sales_order_lines']) ch.on('postgres_changes', { event: '*', schema: 'public', table: tb }, bump)
    ch.subscribe()
    return () => { clearTimeout(t); sb.removeChannel(ch) }
  }, [sb, load])
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(''), flash.startsWith('⚠') ? 20000 : 7000); return () => clearTimeout(t) }, [flash])
  useEffect(() => { if (!justLogged) return; const t = setTimeout(() => setJustLogged(null), 10 * 60_000); return () => clearTimeout(t) }, [justLogged])

  const name = useCallback((sku: string) => stock.find(s => s.sku === sku)?.product_name || sku, [stock])
  const openWos = wos.filter(w => !WO_DONE.includes(w.status || ''))
  const shownWos = showClosed ? wos : openWos
  const orderLabel = (o: WoOrder) => { const so = o.sales_orders; const nm = so?.customers?.company_name || (so?.notes || '').split('|')[0].trim(); return `${nm ? nm + ' · ' : ''}SO ${so?.order_number || ''}${so?.po_number ? ' · PO ' + so.po_number : ''}` }
  // progress across all open work orders, for the chart
  const openProg = useMemo(() => { const m = new Map<string, Prog>(); for (const p of prog) if (openWos.some(w => w.id === p.work_order_id)) { const x = m.get(p.sku); m.set(p.sku, x ? { ...x, target_qty: num(x.target_qty) + num(p.target_qty), made_qty: num(x.made_qty) + num(p.made_qty) } : { ...p }) } return Array.from(m.values()) }, [prog, openWos])
  const live = entries.filter(e => !e.voided_at)
  // per SKU: show the chart in the order's own cases when every open work order for it agrees
  const skuK = useMemo(() => { const m = new Map<string, number | null>(); for (const p of prog) if (openWos.some(w => w.id === p.work_order_id)) { const k = kOf(p.std_pcs, p.pack_pcs); const x = m.get(p.sku); m.set(p.sku, x === undefined ? k : (x === k ? x : null)) } return m }, [prog, openWos])
  const kSku = (sku: string) => skuK.get(sku) ?? 1
  const chartProg = useMemo(() => openProg.map(p => ({ ...p, target_qty: num(p.target_qty) * kSku(p.sku), made_qty: num(p.made_qty) * kSku(p.sku) })), [openProg, skuK]) // eslint-disable-line react-hooks/exhaustive-deps
  const chartEntries = useMemo(() => live.map(e => ({ ...e, qty: num(e.qty) * kSku(e.sku) })), [live, skuK]) // eslint-disable-line react-hooks/exhaustive-deps
  const stdOf = (sku: string) => num(stock.find(s => s.sku === sku)?.per_case)
  const entryCases = (e: Entry) => num(e.qty) * kOf(stdOf(e.sku), e.pack_pcs)
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
  const totals = useMemo(() => stock.reduce((t, s) => ({ free: t.free + num(s.free), rel: t.rel + num(s.released), built: t.built + num(s.built), committed: t.committed + num(s.committed), short: t.short + num(s.short) }), { free: 0, rel: 0, built: 0, committed: 0, short: 0 }), [stock])

  async function run<T>(fn: () => Promise<{ data: T; error: any }>, ok: (d: T) => string) {
    setBusy(true)
    const { data, error } = await fn()
    setBusy(false)
    if (error) { setFlash('⚠ ' + error.message); return false }
    setFlash(ok(data)); reload(); return true
  }
  const setTarget = (wo: string, sku: string, qty: number) => run(() => sb.rpc('straw_wo_set_target', { p_wo: wo, p_sku: sku, p_qty: qty }) as any, () => `✓ Target for ${sku} set to ${fmtN(qty)} cases.`)
  const delWo = (wo: WO) => { if (!window.confirm(`Delete work order ${wo.wo_code}? Nothing has been logged on it. Its POs go back to "no work order".`)) return; run(() => sb.rpc('straw_wo_delete', { p_wo: wo.id }) as any, () => `🗑 ${wo.wo_code} deleted.`) }
  async function loadPrint(wo: WO): Promise<StrawPrint | null> {
    const { data, error } = await sb.rpc('straw_wo_print', { p_wo: wo.id })
    if (error) { setFlash('⚠ ' + error.message); return null }
    return applyWoDetails(data as StrawPrint, await loadWoDetails(sb, wo.id))
  }
  async function printWo(wo: WO) {
    setBusy(true)
    try { const d = await loadPrint(wo); if (d) { buildStrawWorkOrderPdf(d).save(`Work-Order-${wo.wo_code || 'straw'}.pdf`); setFlash(`📄 ${wo.wo_code} work order downloaded — print it on letter paper.`) } }
    catch (e: any) { setFlash('⚠ Could not build the work order: ' + (e?.message || e)) }
    setBusy(false)
  }
  async function printLabels(wo: WO) {
    setBusy(true)
    try {
      const d = await loadPrint(wo)
      if (d) {
        const plan = planLabels(d); const total = plan.reduce((t, p) => t + p.cases, 0)
        if (!total) setFlash('⚠ No cases to label on this work order yet.')
        else if (total <= 300 || window.confirm(`That is ${total} labels. Download them all?`)) {
          const missing = d.lines.filter(l => !l.upc && !l.gtin_image_url).map(l => l.sku)
          ;(await buildStrawCaseLabels(d)).save(`Case-Labels-${wo.wo_code || 'straw'}.pdf`)
          setFlash(`🏷 ${total} case label(s) downloaded (4×6).${missing.length ? ` No UPC/GTIN on file for ${missing.join(', ')} — those labels carry the SKU barcode instead.` : ''}`)
        }
      }
    } catch (e: any) { setFlash('⚠ Could not build the labels: ' + (e?.message || e)) }
    setBusy(false)
  }
  const saveSteps = (wo: WO, v: string[]) => run(() => sb.rpc('straw_wo_set_steps', { p_wo: wo.id, p_steps: v }) as any,
    (d: any) => { setEditSteps(null); return `✓ ${wo.wo_code} steps: ${((d as string[]) || []).map(x => STAGE_LABEL[x] || x).join(' → ') || 'from its machines'}.` })
  // Fill part of the work order from free finished stock: releases it to the WO's orders and lowers the target.
  async function fillFromStock(wo: WO, r: Prog, st: Stock) {
    const k = kOf(r.std_pcs, r.pack_pcs)
    const need = Math.max(0, num(r.target_qty) - num(r.made_qty)), free = num(st.free)
    const def = +(Math.min(need, free) * k).toFixed(3)
    const ans = window.prompt(`${r.sku}: ${fmtN(free * k)} case(s) are in stock and free.\nThis work order still needs ${fmtN(need * k)}.\n\nHow many cases to fill from stock? They are released to this work order's order(s) and the target goes down by the same amount.`, String(def))
    if (ans == null) return
    const q = Number(ans)
    if (!(q > 0)) { setFlash('⚠ Enter a number of cases greater than zero.'); return }
    await run(() => sb.rpc('straw_wo_fill_from_stock', { p_wo: wo.id, p_sku: r.sku, p_qty: +(q / k).toFixed(6) }) as any,
      (d: any) => `📦 ${fmtN(num(d?.filled) * k)} case(s) of ${r.sku} filled from stock for ${wo.wo_code}. Target lowered to match.`)
  }
  async function undoStage(e: StageEntry) {
    const reason = window.prompt(`Remove ${fmtN(e.pcs)} pcs ${STAGE_LABEL[e.stage] || e.stage} for ${e.sku}? Materials taken out at this step go back to inventory. Reason:`)
    if (!reason || !reason.trim()) return
    await run(() => sb.rpc('straw_void_stage', { p_id: e.id, p_reason: reason.trim() }) as any, () => `↩ Removed ${fmtN(e.pcs)} pcs ${STAGE_LABEL[e.stage] || e.stage} (${e.sku}).`)
  }
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
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold text-[#1A1D2E]">Work orders <span className="text-xs font-normal text-gray-400">— one per PO</span></h2>
          <label className="text-xs text-gray-500 flex items-center gap-1.5"><input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} data-ro-ok /> Show closed (30 days)</label>
        </div>
        {!loading && openWos.length === 0 && <div className={card + ' p-4 mb-3 flex flex-wrap items-center gap-3'}>
          <p className="text-sm text-gray-600 flex-1">No open straw work orders. {canEdit ? 'Create one for a PO — you can add other POs that need the same straws.' : ''}</p>
          {canEdit && <button onClick={() => setNewWo({})} className="h-10 px-4 rounded-lg text-white text-sm font-bold" style={{ background: ACCENT }}>+ New work order</button>}
        </div>}
        {(() => { const fw = fresh && wos.find(w => w.id === fresh); return fw ? (
          <div className="rounded-xl border-2 p-3 mb-3 flex flex-wrap items-center gap-2" style={{ borderColor: ACCENT, background: '#F1FAF5' }}>
            <p className="flex-1 text-sm text-[#1A1D2E]"><b>{fw.wo_code}</b> is ready. Add the job details (print, wrapper, operator…), then print the work order and the 4×6 case labels.</p>
            <button onClick={() => setDetails({ id: fw.id, code: fw.wo_code })} className="h-9 px-3 rounded-lg text-xs font-bold border-2 bg-white" style={{ borderColor: ACCENT, color: ACCENT }}>✎ Details</button>
            <button onClick={() => printWo(fw)} disabled={busy} className="h-9 px-3 rounded-lg text-xs font-bold text-white" style={{ background: ACCENT }}>🖨 Download work order</button>
            <button onClick={() => printLabels(fw)} disabled={busy} className="h-9 px-3 rounded-lg text-xs font-bold text-white" style={{ background: ACCENT }}>🏷 Download case labels</button>
            <button onClick={() => setFresh(null)} className="text-gray-400 text-xl px-1" aria-label="Dismiss">&times;</button>
          </div>) : null })()}
        {shownWos.map(wo => {
          const rows = prog.filter(p => p.work_order_id === wo.id).sort((a, b) => a.sku.localeCompare(b.sku))
          const tgt = rows.reduce((t, r) => t + num(r.target_qty) * kOf(r.std_pcs, r.pack_pcs), 0), made = rows.reduce((t, r) => t + num(r.made_qty) * kOf(r.std_pcs, r.pack_pcs), 0)
          const done = WO_DONE.includes(wo.status || '')
          const pos = woOrders.filter(o => o.work_order_id === wo.id)
          return (
            <div key={wo.id} className={card + ' p-4 mb-3'} style={{ borderLeft: `5px solid ${done ? '#9699a6' : ACCENT}` }}>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
                <div className="flex-1">
                  <p className="font-bold text-[#1A1D2E]">{wo.wo_code} <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full ml-1" style={{ background: done ? '#ECEEF3' : '#E6F6EE', color: done ? '#676879' : ACCENT }}>{wo.status}</span>
                    {wo.due_date && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full ml-1 bg-[#F2F4F8] text-gray-600">ship {fmtDay(wo.due_date)}</span>}</p>
                  <div className="flex flex-wrap gap-1 mt-1">{pos.map(o => <a key={o.sales_order_id} href={`/sales/orders?item=${o.sales_order_id}`} className="text-[11px] px-2 py-0.5 rounded-full bg-[#EEF2FB] text-[#3A4A6B] hover:underline">{orderLabel(o)}</a>)}</div>
                  <p className="text-xs text-gray-500 mt-1">{fmtN(made)} of {fmtN(tgt)} cases made{tgt ? ` · ${Math.round((made / tgt) * 100)}%` : ''}</p>
                  {!done && <WoMachinePicker sb={sb} woId={wo.id} woCode={wo.wo_code} value={wo.machine_id} board="straw" canEdit={canEdit} onSaved={m => { setFlash(m); reload() }} />}
                  {editSteps?.wo === wo.id ? (
                    <div className="mt-2 rounded-lg border border-[#E4E6EE] p-2 bg-[#FAFBFD]">
                      <p className="text-[11px] text-gray-500 mb-1.5">Process steps for this work order. Extrusion takes the resin and color; the last step adds finished cases to inventory and takes the packaging.</p>
                      <StepPicker value={editSteps.v} onChange={v => setEditSteps({ wo: wo.id, v })} />
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => saveSteps(wo, editSteps.v)} disabled={busy || !editSteps.v.length} className="h-8 px-3 rounded-lg text-xs font-bold text-white disabled:opacity-50" style={{ background: ACCENT }}>Save steps</button>
                        <button onClick={() => setEditSteps(null)} className="h-8 px-3 rounded-lg border border-[#E4E6EE] text-xs text-gray-600">Cancel</button>
                      </div>
                    </div>
                  ) : !done && canEdit && (stagesBy[wo.id] || []).length <= 1 && !allUnwrapped(rows.map(r => ({ sku: r.sku, product_name: r.product_name }))) ? (
                    <button onClick={() => setEditSteps({ wo: wo.id, v: (stagesBy[wo.id] || []).length ? stagesBy[wo.id] : ['extrusion'] })} className="mt-2 text-[11px] font-semibold hover:underline" style={{ color: ACCENT }}>
                      Steps: {(stagesBy[wo.id] || []).map(x => STAGE_LABEL[x]).join(' → ') || 'one step'} · ✎ change</button>
                  ) : null}
                  {editSteps?.wo !== wo.id && (stagesBy[wo.id] || []).length > 1 && (() => {
                    const st = stagesBy[wo.id]; const se = stageEntries.filter(x => x.work_order_id === wo.id)
                    return (
                      <div className="mt-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {st.map((g, i) => {
                            const last = i === st.length - 1
                            const pcs = se.filter(x => x.stage === g).reduce((t, x) => t + num(x.pcs), 0)
                            return (
                              <span key={g} className="inline-flex items-center gap-1">
                                {i > 0 && <span className="text-gray-300">→</span>}
                                <span className={`text-[11px] font-semibold px-2 py-1 rounded-lg border ${last ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-[#E4E6EE] bg-[#FAFBFD] text-[#3A4A6B]'}`}
                                  title={i === 0 ? 'Resin, color and additives come out of inventory here. Straws are not in inventory yet.' : last ? 'Final step: packaging comes out and finished cases go into inventory.' : 'No materials taken, nothing added to inventory.'}>
                                  {i + 1}. {STAGE_LABEL[g] || g} · {last ? `${fmtN(made)} cases` : `${fmtN(pcs)} pcs`}{i === 0 ? ' · takes resin' : ''}{last ? ' · to inventory' : ''}
                                </span>
                              </span>)
                          })}
                          {!done && canEdit && <button onClick={() => setEditSteps({ wo: wo.id, v: st })} className="text-[11px] font-semibold ml-1 hover:underline" style={{ color: ACCENT }}>✎ steps</button>}
                        </div>
                        {se.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{se.slice(0, 6).map(x => (
                          <span key={x.id} className="text-[10px] text-gray-500 bg-[#F5F6FA] rounded px-1.5 py-0.5">{fmtDay(x.production_date)} · {STAGE_LABEL[x.stage]} {fmtN(x.pcs)} {x.sku}
                            {canEdit && <button onClick={() => undoStage(x)} className="ml-1 text-gray-400 hover:text-red-600" title="Remove this entry" data-ro-ok>↩</button>}</span>))}</div>}
                      </div>)
                  })()}
                </div>
                <div className="flex flex-wrap gap-2">
                  {canEdit && !done && <button onClick={() => setNewWo({ addTo: wo.id })} className="h-9 px-3 rounded-lg border border-[#E4E6EE] text-xs font-semibold text-gray-600">+ Add PO</button>}
                  {canEdit && !done && <button onClick={() => setEditTargets(editTargets === wo.id ? null : wo.id)} className="h-9 px-3 rounded-lg border border-[#E4E6EE] text-xs font-semibold text-gray-600">{editTargets === wo.id ? 'Done editing' : '✎ Targets'}</button>}
                  <button onClick={() => setDigital(wo.id)} className="h-9 px-3 rounded-lg text-xs font-bold text-white" style={{ background: ACCENT }} data-ro-ok>📋 Open</button>
                  <button onClick={() => setDetails({ id: wo.id, code: wo.wo_code })} className="h-9 px-3 rounded-lg border border-[#E4E6EE] text-xs font-semibold text-gray-600" data-ro-ok>✎ Details</button>
                  <button onClick={() => printWo(wo)} disabled={busy} className="h-9 px-3 rounded-lg border border-[#E4E6EE] text-xs font-semibold text-gray-600" data-ro-ok>🖨 Work order</button>
                  <button onClick={() => printLabels(wo)} disabled={busy} className="h-9 px-3 rounded-lg border border-[#E4E6EE] text-xs font-semibold text-gray-600" data-ro-ok>🏷 Case labels</button>
                  <button onClick={() => setSum({ id: wo.id, mode: 'view' })} className="h-9 px-3 rounded-lg border border-[#E4E6EE] text-xs font-semibold text-gray-600" data-ro-ok>📄 Summary</button>
                  {canEdit && !done && <button onClick={() => setSum({ id: wo.id, mode: 'close' })} className="h-9 px-3 rounded-lg text-xs font-bold text-white bg-[#00a85a]">Close out</button>}
                  {canEdit && !done && made === 0 && <button onClick={() => delWo(wo)} disabled={busy} className="h-9 px-3 rounded-lg border border-red-200 text-xs font-semibold text-red-600">Delete</button>}
                  {canEdit && done && <button onClick={() => reopen(wo)} disabled={busy} className="h-9 px-3 rounded-lg border border-[#E4E6EE] text-xs font-semibold text-gray-600">Reopen</button>}
                </div>
              </div>
              {rows.length === 0 && <p className="text-sm text-gray-400">No targets{canEdit && !done ? ' — click ✎ Targets to add.' : '.'}</p>}
              <div className="space-y-2">
                {rows.map(r => {
                  const pct = num(r.target_qty) ? Math.min(100, (num(r.made_qty) / num(r.target_qty)) * 100) : 100
                  const k = kOf(r.std_pcs, r.pack_pcs), st = stock.find(x => x.sku === r.sku)
                  return (
                    <div key={r.sku} className="flex items-center gap-3">
                      <div className="w-40 sm:w-56 min-w-0"><p className="font-mono text-[12px] font-semibold text-[#1A1D2E] truncate">{r.sku}</p><p className="text-[10px] text-gray-400 truncate">{r.product_name}</p></div>
                      <div className="flex-1 h-2.5 bg-[#F0F2F6] rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: pct + '%', background: num(r.made_qty) >= num(r.target_qty) && num(r.target_qty) > 0 ? '#00c875' : ACCENT }} /></div>
                      {editTargets === wo.id
                        ? <input type="number" min={0} defaultValue={+(num(r.target_qty) * k).toFixed(3)} onBlur={e => { const v = Number(e.target.value) / k; if (Math.abs(v - num(r.target_qty)) > 1e-6) setTarget(wo.id, r.sku, v) }} className="w-24 h-8 border border-[#E4E6EE] rounded px-2 text-sm text-right" />
                        : <>{canEdit && !done && st && num(st.free) > 0.0001 && num(r.target_qty) > num(r.made_qty) && (
                            <button onClick={() => fillFromStock(wo, r, st)} disabled={busy} title="Finished cases are sitting in inventory for this straw. Use them for this work order."
                              className="shrink-0 h-8 px-2 rounded-lg border border-emerald-300 bg-emerald-50 text-[11px] font-bold text-emerald-800 whitespace-nowrap">📦 Use stock ({fmtN(num(st.free) * k)})</button>)}
                          <p className="w-44 text-right text-sm"><b>{fmtN(num(r.made_qty) * k)}</b><span className="text-gray-400"> / {fmtN(num(r.target_qty) * k)} cases</span>{st?.per_case && num(st.per_case) !== 1 ? <span className="block text-[10px] text-gray-400">{fmtN(num(r.target_qty) * num(st.per_case))} {st.uom} · {fmtN(num(r.pack_pcs) || st.per_case)}/case{k !== 1 ? ' (order case)' : ''}</span> : null}</p></>}
                    </div>)
                })}
                {editTargets === wo.id && <AddTarget skus={stock.map(s => s.sku).filter(s => !rows.some(r => r.sku === s))} onAdd={(sku, q) => setTarget(wo.id, sku, q)} />}
              </div>
            </div>)
        })}

        <WalmartWeekCharts skus={weekSkus} entries={chartEntries} week={week} prog={chartProg} woCode={openWos.length === 1 ? openWos[0].wo_code : `${openWos.length} open work orders`} unit="cases" reportsHref="/production/reports?board=straw" />

        {/* Daily log */}
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold text-[#1A1D2E]">Daily log</h2>
          <label className="text-xs text-gray-500 flex items-center gap-1.5"><input type="checkbox" checked={showVoided} onChange={e => setShowVoided(e.target.checked)} data-ro-ok /> Show removed</label>
        </div>
        <div className="space-y-3 mb-5">
          {days.map(([d, rows]) => {
            const total = rows.filter(r => !r.voided_at).reduce((s, r) => s + entryCases(r), 0)
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
                        <p className="text-lg font-extrabold text-[#1A1D2E] shrink-0 text-right">{fmtN(entryCases(r))} <span className="text-[10px] font-normal text-gray-400">cases</span>{r.pack_pcs && kOf(stdOf(r.sku), r.pack_pcs) !== 1 ? <span className="block text-[10px] font-normal text-gray-400">{fmtN(r.pack_pcs)} pcs/case</span> : null}</p>
                        {canUndo ? <button onClick={() => undoEntries([r.id], `${fmtN(entryCases(r))} case(s) × ${r.sku} (${fmtTime(r.created_at)})`)} disabled={busy} className="shrink-0 h-9 px-3 rounded-lg border border-[#ECEEF3] text-xs font-semibold text-gray-500 hover:text-red-600 hover:border-red-200 bg-white disabled:opacity-50">↩ Undo</button> : <span className="w-3 shrink-0" />}
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
                {o.wo_code ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#E6F6EE', color: ACCENT }}>{o.wo_code}</span>
                  : canEdit && <button onClick={() => setNewWo({ order: o.sales_order_id })} className="h-8 px-3 rounded-lg text-xs font-bold text-white" style={{ background: ACCENT }}>Create work order</button>}
              </div>
              <div className="overflow-x-auto"><table className="w-full text-sm min-w-[700px]">
                <thead><tr><th className={th + ' text-left'}>Straw</th><th className={th + ' text-right'}>Ordered</th><th className={th + ' text-right'}>Released</th><th className={th + ' text-right'}>Built</th><th className={th + ' text-right'}>Shipped</th><th className={th + ' text-right'}>Still to release</th><th className={th}></th></tr></thead>
                <tbody>{lines.map(l => {
                  const free = num(stock.find(s => s.sku === l.sku)?.free)
                  const k = kOf(l.std_pcs, l.pack_pcs), st = stock.find(x => x.sku === l.sku)
                  return (
                    <tr key={l.line_id}>
                      <td className={td}><p className="font-mono text-[12px] font-semibold">{l.sku}</p><p className="text-[10px] text-gray-400 truncate max-w-[280px]">{l.product_name}</p></td>
                      <td className={td + ' text-right'}>{fmtN(num(l.ordered) * k)}{st?.per_case && num(st.per_case) !== 1 ? <span className="block text-[10px] text-gray-400">{fmtN(num(l.ordered) * num(st.per_case))} {st.uom} · {fmtN(num(l.pack_pcs) || st.per_case)}/case</span> : null}</td>
                      <td className={td + ' text-right'}>{fmtN(num(l.released) * k)}</td>
                      <td className={td + ' text-right text-amber-700'}>{num(l.built) ? fmtN(num(l.built) * k) : '—'}</td>
                      <td className={td + ' text-right'}>{num(l.shipped) ? fmtN(num(l.shipped) * k) : '—'}</td>
                      <td className={td + ' text-right font-bold ' + (num(l.open_cases) > 0 ? 'text-red-600' : 'text-emerald-600')}>{num(l.open_cases) > 0 ? fmtN(num(l.open_cases) * k) : '✓'}</td>
                      <td className={td + ' text-right'}>{canEdit && num(l.open_cases) > 0 && <button onClick={() => setReleaseFor(l)} disabled={free <= 0} title={free <= 0 ? 'No free cases of this straw — log production first' : ''} className="h-8 px-3 rounded-lg text-xs font-bold text-white disabled:opacity-40" style={{ background: ACCENT }}>Release {free > 0 ? `(${fmtN(free * k)} free)` : ''}</button>}</td>
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

      {showLog && <LogSheet sb={sb} stock={stock} wos={openWos} prog={prog} today={today} stagesBy={stagesBy} onClose={() => setShowLog(false)}
        onSaved={(msg, ids, label) => { setFlash(msg); setShowLog(false); setTab('production'); if (ids.length) setJustLogged({ ids, label }); reload() }} />}
      {releaseFor && <ReleaseModal sb={sb} line={releaseFor} free={num(stock.find(s => s.sku === releaseFor.sku)?.free)} onClose={() => setReleaseFor(null)}
        onDone={m => { setReleaseFor(null); setFlash(m); reload() }} />}
      {newWo && <NewWoModal sb={sb} orders={orders} wos={openWos} start={newWo.order} addTo={newWo.addTo} prog={prog} onClose={() => setNewWo(null)}
        onDone={(m, id) => { setNewWo(null); setFlash(m); setTab('production'); if (id) { setFresh(id); setDetails({ id, code: null, isNew: true }) } reload() }} />}
      {digital && (() => { const dw = wos.find(w => w.id === digital); return dw ? (
        <DigitalWo sb={sb} wo={dw} rows={prog.filter(p => p.work_order_id === dw.id).sort((a, b) => a.sku.localeCompare(b.sku))} pos={woOrders.filter(o => o.work_order_id === dw.id)}
          steps={stagesBy[dw.id] || []} stock={stock} canEdit={canEdit} busy={busy} refreshKey={digitalKey} orderLabel={orderLabel}
          onClose={() => { setDigital(null); try { const u = new URL(window.location.href); if (u.searchParams.has('wo')) { u.searchParams.delete('wo'); window.history.replaceState(null, '', u.toString()) } } catch { /* ignore */ } }}
          onDetails={() => setDetails({ id: dw.id, code: dw.wo_code })}
          onTargets={() => { setDigital(null); setTab('production'); setEditTargets(dw.id) }}
          onSteps={() => { setDigital(null); setTab('production'); setEditSteps({ wo: dw.id, v: (stagesBy[dw.id] || []).length ? stagesBy[dw.id] : ['extrusion'] }) }}
          onPrint={() => printWo(dw)} onLabels={() => printLabels(dw)}
          onUseStock={(r, st) => fillFromStock(dw, r, st)}
          onUndoEntry={(id, label) => undoEntries([id], label)} onUndoStage={e => undoStage(e)} />) : null })()}
      {details && <WoDetailsModal sb={sb} kind="straw" woId={details.id} woCode={details.code || wos.find(w => w.id === details.id)?.wo_code || null} accent={ACCENT} canEdit={canEdit} isNew={details.isNew} onClose={() => setDetails(null)} onSaved={m => { setDetails(null); setFlash(m); reload() }} />}
      {sum && <WalmartWoSummary kind="straw" sb={sb} woId={sum.id} mode={sum.mode} canEdit={canEdit} userEmail={me} onClose={() => setSum(null)} onClosedOut={m => { setSum(null); setFlash(m); reload() }} />}
    </div>
  )
}

const ACTION: Record<string, string> = {
  logged: 'Logged production', voided: 'Removed a log', released: 'Released to order', release_undone: 'Undid a release',
  auto_release_on_ship: 'Shipped from free stock', wo_created: 'Created work order', wo_closed: 'Closed out work order',
  wo_reopened: 'Reopened work order', wo_deleted: 'Deleted work order', wo_order_added: 'Added PO to work order', target_set: 'Set target', case_size_set: 'Set case size',
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

/** Digital work order: everything about one work order on screen, with the logged production, and the edit actions. */
function DigitalWo({ sb, wo, rows, pos, steps, stock, canEdit, busy, onClose, onDetails, onTargets, onSteps, onPrint, onLabels, onUseStock, onUndoEntry, onUndoStage, orderLabel, refreshKey }: {
  sb: any; wo: WO; rows: Prog[]; pos: WoOrder[]; steps: string[]; stock: Stock[]; canEdit: boolean; busy: boolean; refreshKey: number
  onClose: () => void; onDetails: () => void; onTargets: () => void; onSteps: () => void; onPrint: () => void; onLabels: () => void
  onUseStock: (r: Prog, st: Stock) => void; onUndoEntry: (id: string, label: string) => void; onUndoStage: (e: StageEntry) => void; orderLabel: (o: WoOrder) => string
}) {
  const [prodE, setProdE] = useState<Entry[]>([])
  const [stageE, setStageE] = useState<StageEntry[]>([])
  const [det, setDet] = useState<any>(null)
  const [woRow, setWoRow] = useState<any>(null)
  useEffect(() => {
    let live = true
    Promise.all([
      sb.from('straw_production_entries').select('*').eq('work_order_id', wo.id).order('production_date', { ascending: false }).order('created_at', { ascending: false }),
      sb.from('straw_stage_entries').select('id,work_order_id,sku,stage,pcs,production_date,note,entered_by,created_at,voided_at').eq('work_order_id', wo.id).order('created_at', { ascending: false }),
      sb.from('work_orders').select('assigned_operator,notes,scheduled_date,scheduled_start,spec,created_at,started_at,completed_at').eq('id', wo.id).maybeSingle(),
    ]).then(([a, b, c]: any[]) => {
      if (!live) return
      setProdE((a.data || []) as Entry[]); setStageE(((b.data || []) as any[]).filter(x => !x.voided_at)); setWoRow(c.data); setDet(c.data?.spec?.wo_details || null)
    })
    return () => { live = false }
  }, [sb, wo.id, refreshKey])
  const done = WO_DONE.includes(wo.status || '')
  const cap = (g: string) => g.charAt(0).toUpperCase() + g.slice(1)
  const liveProd = prodE.filter(e => !e.voided_at)
  const log = [
    ...liveProd.map(e => ({ key: 'p' + e.id, at: e.created_at, date: e.production_date, step: steps.length > 1 ? cap(steps[steps.length - 1]) : 'Production', sku: e.sku, qty: `${fmtN(e.qty)} case(s)`, who: e.entered_by, note: e.note, inv: true, undo: () => onUndoEntry(e.id, `${fmtN(e.qty)} case(s) of ${e.sku}`) })),
    ...stageE.map(e => ({ key: 's' + e.id, at: e.created_at, date: e.production_date, step: cap(e.stage), sku: e.sku, qty: `${fmtN(e.pcs)} pcs`, who: e.entered_by, note: e.note, inv: false, undo: () => onUndoStage(e) })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)))
  const w = det?.wo || {}
  const info: [string, string][] = [
    ['Operator', w.operator || woRow?.assigned_operator || ''], ['Supervisor', w.supervisor || ''],
    ['Scheduled', [woRow?.scheduled_date ? fmtDay(woRow.scheduled_date) : '', w.scheduled_start || (woRow?.scheduled_start ? String(woRow.scheduled_start).slice(0, 5) : ''), w.shift ? `${w.shift} shift` : ''].filter(Boolean).join(' · ')],
    ['Ship / due', wo.due_date ? fmtDay(wo.due_date) : ''], ['Started', woRow?.started_at ? new Date(woRow.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''],
    ['Steps', steps.length ? steps.map(cap).join(' → ') : 'One step'],
  ]
  const btn = 'h-9 px-3 rounded-lg border border-[#E4E6EE] text-xs font-semibold text-gray-600 bg-white'
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-[105] bg-black/50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-4xl bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[94vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-4 pb-3 border-b border-[#EEF0F4] flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-gray-400">Digital work order</p>
            <h2 className="text-xl font-bold text-[#1A1D2E]">{wo.wo_code} <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full align-middle" style={{ background: done ? '#ECEEF3' : '#E6F6EE', color: done ? '#676879' : ACCENT }}>{wo.status}</span></h2>
            <div className="flex flex-wrap gap-1 mt-1">{pos.map(o => <a key={o.sales_order_id} href={`/sales/orders?item=${o.sales_order_id}`} className="text-[11px] px-2 py-0.5 rounded-full bg-[#EEF2FB] text-[#3A4A6B] hover:underline">{orderLabel(o)}</a>)}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 text-3xl leading-none px-2" aria-label="Close">&times;</button>
        </div>
        <div className="px-5 py-4 space-y-5 overflow-y-auto">
          <div className="flex flex-wrap gap-2">
            {canEdit && !done && <button onClick={onDetails} className={btn}>✎ Edit details</button>}
            {canEdit && !done && <button onClick={onTargets} className={btn}>✎ Targets</button>}
            {canEdit && !done && <button onClick={onSteps} className={btn}>✎ Steps</button>}
            <button onClick={onPrint} disabled={busy} className={btn}>🖨 Download work order</button>
            <button onClick={onLabels} disabled={busy} className={btn}>🏷 Case labels</button>
          </div>
          <section className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {info.map(([k, v]) => <div key={k} className="rounded-lg border border-[#ECEEF3] px-3 py-2"><p className="text-[10px] uppercase tracking-wide text-gray-400">{k}</p><p className="text-sm font-semibold text-[#1A1D2E]">{v || '—'}</p></div>)}
            {(w.notes || woRow?.notes) && <div className="col-span-2 sm:col-span-3 rounded-lg border border-[#ECEEF3] px-3 py-2"><p className="text-[10px] uppercase tracking-wide text-gray-400">Notes</p><p className="text-sm text-[#1A1D2E] whitespace-pre-wrap">{w.notes || woRow?.notes}</p></div>}
          </section>
          <section>
            <h3 className="text-sm font-bold text-[#1A1D2E] mb-2">Progress by straw</h3>
            <div className="overflow-x-auto rounded-lg border border-[#ECEEF3]">
              <table className="w-full text-[12px]">
                <thead><tr className="text-left text-[10px] uppercase tracking-wide text-gray-400">
                  <th className="px-2 py-1.5">SKU</th>
                  {steps.length > 1 && steps.slice(0, -1).map(g => <th key={g} className="px-2 py-1.5 text-right">{cap(g)} pcs</th>)}
                  <th className="px-2 py-1.5 text-right">{steps.length > 1 ? cap(steps[steps.length - 1]) + ' · cases' : 'Cases made'}</th>
                  <th className="px-2 py-1.5 text-right">Target</th><th className="px-2 py-1.5 text-right">Left</th><th className="px-2 py-1.5 text-right">Free stock</th></tr></thead>
                <tbody>{rows.map(r => {
                  const k = kOf(r.std_pcs, r.pack_pcs), st = stock.find(x => x.sku === r.sku)
                  const left = Math.max(0, num(r.target_qty) - num(r.made_qty)) * k
                  return (
                    <tr key={r.sku} className="border-t border-[#F0F2F6]">
                      <td className="px-2 py-1.5"><span className="font-mono font-semibold">{r.sku}</span><span className="block text-[10px] text-gray-400">{r.product_name}</span>{(det?.skus?.[r.sku] && Object.keys(det.skus[r.sku]).length) ? <span className="block text-[10px] text-amber-700">{Object.entries(det.skus[r.sku]).map(([a, b]) => `${a.replace(/_/g, ' ')}: ${b}`).join(' · ')}</span> : null}</td>
                      {steps.length > 1 && steps.slice(0, -1).map(g => <td key={g} className="px-2 py-1.5 text-right font-mono">{fmtN(stageE.filter(x => x.sku === r.sku && x.stage === g).reduce((t, x) => t + num(x.pcs), 0))}</td>)}
                      <td className="px-2 py-1.5 text-right font-mono font-bold">{fmtN(num(r.made_qty) * k)}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{fmtN(num(r.target_qty) * k)}</td>
                      <td className={`px-2 py-1.5 text-right font-mono ${left > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{left > 0 ? fmtN(left) : '✓'}</td>
                      <td className="px-2 py-1.5 text-right">{st && num(st.free) > 0.0001 ? (canEdit && !done && left > 0 ? <button onClick={() => onUseStock(r, st)} className="text-[11px] font-bold text-emerald-800 hover:underline">📦 {fmtN(num(st.free) * k)} · use</button> : fmtN(num(st.free) * k)) : '—'}</td>
                    </tr>)
                })}</tbody>
              </table>
            </div>
          </section>
          <section>
            <h3 className="text-sm font-bold text-[#1A1D2E] mb-2">Logged production <span className="text-xs font-normal text-gray-400">({log.length})</span></h3>
            {log.length === 0 ? <p className="text-sm text-gray-400">Nothing logged on this work order yet.</p> : (
              <div className="overflow-x-auto rounded-lg border border-[#ECEEF3]">
                <table className="w-full text-[12px]">
                  <thead><tr className="text-left text-[10px] uppercase tracking-wide text-gray-400"><th className="px-2 py-1.5">Date</th><th className="px-2 py-1.5">Step</th><th className="px-2 py-1.5">SKU</th><th className="px-2 py-1.5 text-right">Qty</th><th className="px-2 py-1.5">Inventory</th><th className="px-2 py-1.5">By</th><th className="px-2 py-1.5">Note</th><th></th></tr></thead>
                  <tbody>{log.map(x => (
                    <tr key={x.key} className="border-t border-[#F0F2F6]">
                      <td className="px-2 py-1.5 whitespace-nowrap">{fmtDay(x.date)}</td><td className="px-2 py-1.5">{x.step}</td><td className="px-2 py-1.5 font-mono">{x.sku}</td>
                      <td className="px-2 py-1.5 text-right font-mono font-semibold">{x.qty}</td>
                      <td className="px-2 py-1.5">{x.inv ? <span className="text-emerald-700">added</span> : <span className="text-gray-400">in process</span>}</td>
                      <td className="px-2 py-1.5">{who(x.who)}</td><td className="px-2 py-1.5 text-gray-500 max-w-[220px] truncate" title={x.note || ''}>{x.note || ''}</td>
                      <td className="px-2 py-1.5">{canEdit && <button onClick={x.undo} className="text-gray-400 hover:text-red-600" title="Undo this entry">↩</button>}</td>
                    </tr>))}</tbody>
                </table>
              </div>)}
          </section>
        </div>
      </div>
    </div>, document.body)
}

function LogSheet({ sb, stock, wos, prog, today, stagesBy, onClose, onSaved }: {
  sb: any; stock: Stock[]; wos: WO[]; prog: Prog[]; today: string; stagesBy: Record<string, string[]>; onClose: () => void; onSaved: (msg: string, ids: string[], label: string) => void
}) {
  type Row = { sku: string; qty: string; sq: Record<string, string> }
  const [date, setDate] = useState(today)
  const [woId, setWoId] = useState('')
  const [rows, setRows] = useState<Row[]>([{ sku: '', qty: '', sq: {} }])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (i: number, p: Partial<Row>) => setRows(r => r.map((x, j) => j === i ? { ...x, ...p } : x))
  const setStep = (i: number, g: string, v: string) => setRows(r => r.map((x, j) => j === i ? { ...x, sq: { ...x.sq, [g]: v } } : x))
  // the case size the operator is packing: the work order's (customer's) case when it differs from our standard case
  const packFor = (sku: string): number | null => {
    const cands = prog.filter(p => p.sku === sku && (woId ? p.work_order_id === woId : wos.some(w => w.id === p.work_order_id)))
    const packs = Array.from(new Set(cands.map(p => num(p.pack_pcs) || num(p.std_pcs))))
    const std = num(stock.find(s => s.sku === sku)?.per_case)
    return packs.length === 1 && packs[0] > 0 && std > 0 && Math.abs(packs[0] - std) > 1e-6 ? packs[0] : null
  }
  // only the straws on the chosen work order (or on any open work order when Auto)
  const onWo = new Set(prog.filter(p => (woId ? p.work_order_id === woId : wos.some(w => w.id === p.work_order_id))).map(p => p.sku))
  const opts = stock.filter(s => onWo.has(s.sku))
  useEffect(() => { setRows(rs => rs.map(r => (r.sku && !onWo.has(r.sku) ? { ...r, sku: '' } : r))) }, [woId]) // eslint-disable-line
  // case config from Inventory → Pack & Case Conversion: pieces per pack × packs per case
  const [cfg, setCfg] = useState<Record<string, { ppp: number; ppc: number; uom: string }>>({})
  useEffect(() => {
    sb.from('products').select('sku,pieces_per_pack,packs_per_case,unit_of_measure').in('sku', stock.map(s => s.sku)).then(({ data }: any) => {
      setCfg(Object.fromEntries(((data as any[]) || []).map(p => [String(p.sku).toUpperCase(), { ppp: num(p.pieces_per_pack), ppc: num(p.packs_per_case) || 1, uom: String(p.unit_of_measure || '').toUpperCase() }])))
    })
  }, [sb, stock])
  const unitPcs = (sku: string) => { const c = cfg[sku.toUpperCase()]; if (!c) return 1; return /^(PCS|PC|EA|EACH|PIECES?|UNITS?|)$/.test(c.uom) ? 1 : /^(CASES?|CS|CTN|CARTONS?)$/.test(c.uom) ? (c.ppp || 1) * c.ppc : (c.ppp || 1) }
  /** pieces in one case for this line (the order's own case when it differs) */
  const casePcs = (sku: string) => {
    const pk = packFor(sku); if (pk) return pk * unitPcs(sku)
    const c = cfg[sku.toUpperCase()]; if (c && c.ppp > 0) return c.ppp * c.ppc
    return num(stock.find(s => s.sku === sku)?.per_case) * unitPcs(sku)
  }
  const [inPcs, setInPcs] = useState(true)
  // multi-step work orders (e.g. extrusion → bending → wrapping): each step gets its own count.
  // Earlier steps are straws (pcs) and never touch finished inventory; the last step adds the cases.
  const steps = woId ? (stagesBy[woId] || []) : []
  const multi = steps.length > 1
  const finalStep = multi ? steps[steps.length - 1] : ''
  const finalQty = (r: Row) => (multi ? r.sq[finalStep] || '' : r.qty)
  const casesOf = (sku: string, q: string) => (inPcs ? (casePcs(sku) > 0 ? Number(q) / casePcs(sku) : 0) : Number(q))
  const cap = (g: string) => g.charAt(0).toUpperCase() + g.slice(1)

  async function save() {
    setErr('')
    const picked = rows.filter(r => r.sku)
    const stageOps = multi ? picked.flatMap(r => steps.slice(0, -1).filter(g => Number(r.sq[g]) > 0).map(g => ({ r, g, pcs: Number(r.sq[g]) }))) : []
    const finals = picked.filter(r => Number(finalQty(r)) > 0)
    if (!stageOps.length && !finals.length) { setErr(multi ? 'Pick a straw and enter a count for at least one step.' : inPcs ? 'Pick a straw and enter how many straws (pcs) were made.' : 'Pick a straw and enter how many cases were made.'); return }
    const noCase = inPcs ? finals.find(r => !(casePcs(r.sku) > 0)) : null
    if (noCase) { setErr(`${noCase.sku} has no case size. Set Pieces Per Pack and Packs Per Case on the Inventory board, or enter cases instead.`); return }
    setBusy(true)
    const ids: string[] = []; const ok: string[] = []; const bad: string[] = []; let mats = 0
    for (const o of stageOps) {
      const { data, error } = await sb.rpc('straw_record_stage', { p_wo: woId, p_sku: o.r.sku, p_stage: o.g, p_pcs: o.pcs, p_date: date, p_note: note.trim() || null })
      if (error) bad.push(`${o.r.sku} ${o.g}: ${error.message}`); else { ok.push(`${cap(o.g)} ${fmtN(o.pcs)} pcs ${o.r.sku}`); mats += num((data as any)?.components) }
    }
    for (const r of finals) {
      const q = finalQty(r), pk = packFor(r.sku), c = +casesOf(r.sku, q).toFixed(6)
      const nt = (inPcs ? `${fmtN(q)} pcs. ` : '') + (note.trim() || '') || null
      const { data, error } = pk
        ? await sb.rpc('straw_record_production_pack', { p_sku: r.sku, p_packs: c, p_pack_pcs: pk, p_date: date, p_wo: woId || null, p_note: nt })
        : await sb.rpc('straw_record_production', { p_sku: r.sku, p_qty: c, p_date: date, p_wo: woId || null, p_note: nt })
      if (error) bad.push(`${r.sku}: ${error.message}`); else { ok.push(`${multi ? cap(finalStep) + ' ' : ''}${fmtN(c)} case(s)${inPcs ? ` (${fmtN(q)} pcs)` : ''} ${r.sku}`); if ((data as any)?.id) ids.push((data as any).id) }
    }
    setBusy(false)
    if (bad.length) { setErr((ok.length ? `Saved: ${ok.join(', ')}. ` : '') + 'Not saved — ' + bad.join(' · ')); return }
    const inv = finals.length ? ' Finished cases added to inventory.' : ' Nothing added to inventory yet.'
    onSaved(`✓ Logged for ${fmtDay(date)}: ${ok.join(' · ')}.${inv}${stageOps.some(o => o.g === steps[0]) ? (mats ? ` ${mats} material(s) taken out at ${steps[0]}.` : ' No materials could be taken out at extrusion (check the straw weight / BOM).') : ''}`, ids, ok.join(', '))
  }
  const inp = 'h-11 border border-[#E4E6EE] rounded-lg px-3 text-sm w-full'
  const convHint = (r: Row, q: string) => {
    const st = stock.find(s => s.sku === r.sku); if (!st) return null
    if (inPcs) { const cp = casePcs(r.sku); const c = cp > 0 ? Number(q) / cp : 0
      return <p className={`text-[11px] ${cp > 0 ? 'text-gray-600' : 'text-red-600 font-semibold'}`}>{cp > 0 ? `1 case = ${fmtN(cp)} pcs${packFor(r.sku) ? " (this order's case)" : ''}${Number(q) > 0 ? ` → ${fmtN(c)} case${c === 1 ? '' : 's'} into inventory${Math.abs(c - Math.round(c)) > 1e-6 ? ` (${Math.floor(c)} full + ${fmtN(Number(q) - Math.floor(c) * cp)} pcs)` : ''}` : ''}` : 'No case size: set Pieces Per Pack × Packs Per Case on the Inventory board.'}</p> }
    const pk = packFor(r.sku); const per = pk || num(st.per_case)
    return <p className={`text-[11px] ${st.per_case ? (pk ? 'text-amber-700 font-semibold' : 'text-gray-500') : 'text-red-600 font-semibold'}`}>{st.per_case ? `1 case = ${fmtN(per)} ${st.uom || ''}${pk ? " (this order's case)" : ''}${Number(q) > 0 ? ` → ${fmtN(Number(q) * per)} ${st.uom || ''} into inventory` : ''}` : 'Case size not set — set it on the finished goods table first.'}</p>
  }
  return (
    <Overlay onClose={() => !busy && onClose()}>
      <div className="px-5 pt-4 pb-3 border-b border-[#EEF0F4] flex items-center justify-between">
        <div><p className="text-[11px] uppercase tracking-wide text-gray-400">Straws by step · finished cases to inventory</p><h2 className="text-lg font-bold text-[#1A1D2E]">Log production</h2></div>
        <button onClick={onClose} className="text-gray-400 text-3xl leading-none px-2" aria-label="Close">&times;</button>
      </div>
      <div className="px-5 py-4 space-y-3 overflow-y-auto">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs text-gray-500">Date made</label><input type="date" value={date} max={today} onChange={e => setDate(e.target.value)} className={inp} /></div>
          <div><label className="text-xs text-gray-500">Work order</label><select value={woId} onChange={e => setWoId(e.target.value)} className={inp}><option value="">Auto — the PO work order for that straw</option>{wos.map(w => <option key={w.id} value={w.id}>{w.wo_code}</option>)}</select></div>
        </div>
        {multi && <p className="text-[11px] text-gray-600 rounded-lg bg-[#FAFBFD] border border-[#ECEEF3] px-3 py-2">
          Enter a count for each step that ran. Leave a step blank if it didn&apos;t run today. {cap(steps[0])} takes resin and color out of inventory. {steps.slice(1, -1).map(cap).join(', ')}{steps.length > 2 ? ' takes nothing. ' : ''}{cap(finalStep)} is the last step: it adds the finished cases to inventory and takes the packaging.
        </p>}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-500">{multi ? `${cap(finalStep)} entered in` : 'Enter in'}</span>
          {[['pcs', true], ['cases', false]].map(([lbl, v]) => (
            <button key={String(lbl)} type="button" onClick={() => setInPcs(v as boolean)} className={`h-8 px-3 rounded-lg border font-semibold ${inPcs === v ? 'text-white' : 'bg-white text-gray-600 border-[#E4E6EE]'}`} style={inPcs === v ? { background: ACCENT, borderColor: ACCENT } : undefined}>{lbl === 'pcs' ? 'Pieces' : 'Cases'}</button>))}
          {inPcs && <span className="text-gray-400">converted to cases with the Inventory case size</span>}
        </div>
        {rows.map((r, i) => (
          <div key={i} className="rounded-xl border border-[#ECEEF3] p-3 space-y-2">
            <div className="flex items-center gap-2">
              <select value={r.sku} onChange={e => set(i, { sku: e.target.value })} className={inp}>
                <option value="">{opts.length ? 'Pick a straw on this work order…' : 'No straws on this work order'}</option>
                {opts.map(s => <option key={s.sku} value={s.sku}>{s.sku} — {s.product_name}</option>)}
              </select>
              {rows.length > 1 && <button onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} className="text-gray-400 text-xl px-2" aria-label="Remove">&times;</button>}
            </div>
            {multi ? (
              <div className="space-y-2">
                {steps.map((g, si) => {
                  const last = si === steps.length - 1
                  return (
                    <div key={g}>
                      <label className="flex items-center gap-2">
                        <span className={`w-28 shrink-0 text-xs font-semibold ${last ? 'text-emerald-800' : 'text-[#3A4A6B]'}`}>{si + 1}. {cap(g)}</span>
                        <input inputMode="decimal" value={r.sq[g] || ''} onChange={e => setStep(i, g, e.target.value.replace(/[^0-9.]/g, ''))}
                          placeholder={last ? (inPcs ? 'Straws (pcs) → cases' : 'Cases') : 'Straws (pcs)'} className={inp} />
                      </label>
                      {!last && <p className="text-[10px] text-gray-400 ml-[7.5rem]">{si === 0 ? 'Takes resin + color · not in inventory' : 'No materials · not in inventory'}</p>}
                      {last && <div className="ml-[7.5rem]">{convHint(r, r.sq[g] || '')}</div>}
                    </div>)
                })}
              </div>
            ) : (
              <>
                <input inputMode="decimal" value={r.qty} onChange={e => set(i, { qty: e.target.value.replace(/[^0-9.]/g, '') })} placeholder={inPcs ? 'Straws made (pcs)' : 'Cases made'} className={inp} />
                {convHint(r, r.qty)}
              </>
            )}
          </div>))}
        <button onClick={() => setRows(r => [...r, { sku: '', qty: '', sq: {} }])} className="text-sm font-semibold" style={{ color: ACCENT }}>+ Another straw</button>
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
  const k = kOf(line.std_pcs, line.pack_pcs)
  const max = Math.max(0, Math.min(num(line.open_cases), free)) * k
  const [qty, setQty] = useState(String(+max.toFixed(3)))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function go() {
    setErr('')
    const q = Number(qty)
    if (!(q > 0)) { setErr('Enter how many cases to release.'); return }
    setBusy(true)
    const { error } = await sb.rpc('straw_release', { p_line: line.line_id, p_qty: +(q / k).toFixed(6), p_note: note.trim() || null })
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
        <p className="text-xs text-gray-500"><span className="font-mono">{line.sku}</span> · {fmtN(num(line.open_cases) * k)} case(s) still to release · {fmtN(free * k)} free{k !== 1 ? ` · counted in this order's ${fmtN(line.pack_pcs)}-pc cases` : ''}</p>
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

function NewWoModal({ sb, orders, wos, start, addTo, prog, onClose, onDone }: {
  sb: any; orders: OLine[]; wos: WO[]; start?: string; addTo?: string; prog: Prog[]; onClose: () => void; onDone: (m: string, newId?: string) => void
}) {
  // open orders not already on an open work order, one entry per order
  const free = useMemo(() => {
    const m = new Map<string, OLine[]>()
    for (const l of orders) if (!l.work_order_id) { if (!m.has(l.sales_order_id)) m.set(l.sales_order_id, []); m.get(l.sales_order_id)!.push(l) }
    return m
  }, [orders])
  const [primary, setPrimary] = useState<string>(start && free.has(start) ? start : '')
  const [steps, setSteps] = useState<string[]>(['extrusion'])
  const [stepsTouched, setStepsTouched] = useState(false)
  const [extra, setExtra] = useState<Set<string>>(new Set())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const addWo = addTo ? wos.find(w => w.id === addTo) : null
  // the straws this work order makes
  const skus = useMemo(() => new Set(addWo ? prog.filter(p => p.work_order_id === addWo.id).map(p => p.sku) : (free.get(primary) || []).map(l => l.sku)), [addWo, prog, free, primary])
  const candidates = Array.from(free.entries()).filter(([id, ls]) => id !== primary && ls.some(l => skus.has(l.sku)))
  const label = (ls: OLine[]) => `${ls[0].order_name} · SO ${ls[0].order_number}${ls[0].po_number ? ' · PO ' + ls[0].po_number : ''}`
  const toggle = (id: string) => setExtra(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  useEffect(() => { if (!stepsTouched && primary) setSteps(suggestSteps(free.get(primary) || [])) }, [primary]) // eslint-disable-line
  async function go() {
    setErr('')
    if (addWo) {
      if (!extra.size) { setErr('Pick at least one PO to add.'); return }
      setBusy(true)
      for (const id of Array.from(extra)) { const { error } = await sb.rpc('straw_wo_add_order', { p_wo: addWo.id, p_order: id }); if (error) { setBusy(false); setErr(error.message); return } }
      setBusy(false); onDone(`✓ Added ${extra.size} PO${extra.size === 1 ? '' : 's'} to ${addWo.wo_code} — targets updated.`); return
    }
    if (!primary) { setErr('Pick the PO for this work order.'); return }
    setBusy(true)
    const { data: newId, error } = await sb.rpc('straw_wo_create', { p_orders: [primary, ...Array.from(extra)], p_note: note.trim() || null })
    if (error) { setBusy(false); setErr(error.message); return }
    if (newId && steps.length) { const { error: se } = await sb.rpc('straw_wo_set_steps', { p_wo: newId, p_steps: steps }); if (se) { setBusy(false); setErr('Work order created, but the steps did not save: ' + se.message); return } }
    setBusy(false)
    onDone(`✓ Work order created for SO ${free.get(primary)?.[0].order_number}${extra.size ? ` + ${extra.size} more PO${extra.size === 1 ? '' : 's'}` : ''} — targets set from the open straws.`, newId as string)
  }
  const inp = 'h-11 border border-[#E4E6EE] rounded-lg px-3 text-sm w-full'
  return (
    <Overlay onClose={() => !busy && onClose()}>
      <div className="px-5 pt-4 pb-3 border-b border-[#EEF0F4]">
        <p className="text-[11px] uppercase tracking-wide text-gray-400">Straw work order</p>
        <h2 className="text-lg font-bold text-[#1A1D2E]">{addWo ? `Add POs to ${addWo.wo_code}` : 'New work order for a PO'}</h2>
      </div>
      <div className="px-5 py-4 space-y-4 overflow-y-auto">
        {!addWo && <div>
          <label className="text-xs text-gray-500">PO</label>
          <select value={primary} onChange={e => { setPrimary(e.target.value); setExtra(new Set()) }} className={inp}>
            <option value="">Pick an open order…</option>
            {Array.from(free.entries()).map(([id, ls]) => <option key={id} value={id}>{label(ls)}</option>)}
          </select>
          {free.size === 0 && <p className="text-xs text-gray-400 mt-1">Every open straw order is already on a work order.</p>}
          {primary && <div className="mt-2 rounded-lg bg-[#FAFBFD] border border-[#ECEEF3] p-2 text-[12px] space-y-0.5">
            {(free.get(primary) || []).map(l => <div key={l.line_id} className="flex justify-between gap-2"><span className="font-mono">{l.sku}</span><span className="text-gray-500">{fmtN(l.open_cases)} case(s) to make</span></div>)}
          </div>}
        </div>}
        {(addWo || primary) && <div>
          <p className="text-xs text-gray-500 mb-1">{addWo ? 'POs that need the same straws' : 'Also include other POs with the same straws (optional)'}</p>
          {candidates.length === 0 && <p className="text-xs text-gray-400">No other open POs need these straws.</p>}
          <div className="space-y-1.5">
            {candidates.map(([id, ls]) => (
              <label key={id} className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer ${extra.has(id) ? 'border-emerald-400 bg-emerald-50' : 'border-[#ECEEF3]'}`}>
                <input type="checkbox" checked={extra.has(id)} onChange={() => toggle(id)} className="mt-1" />
                <span className="text-[13px]"><b>{label(ls)}</b>{ls[0].ship_date ? <span className="text-gray-400"> · ship {fmtDay(ls[0].ship_date)}</span> : null}
                  <span className="block text-[11px] text-gray-500">{ls.filter(l => skus.has(l.sku)).map(l => `${l.sku}: ${fmtN(l.open_cases)}`).join(' · ')}</span></span>
              </label>))}
          </div>
        </div>}
        {!addWo && primary && <div>
          <p className="text-xs text-gray-500 mb-1">Process steps <span className="text-gray-400">(suggested from the straws; tap to change)</span></p>
          {allUnwrapped(free.get(primary) || [])
            ? <p className="text-sm text-[#1A1D2E] rounded-lg bg-[#FAFBFD] border border-[#ECEEF3] px-3 py-2">1. Extrusion only <span className="text-xs text-gray-500">(unwrapped straws)</span></p>
            : <StepPicker value={steps} onChange={v => { setStepsTouched(true); setSteps(v) }} />}
          <p className="text-[11px] text-gray-400 mt-1">{steps.length > 1 ? `Extrusion takes resin and color. ${STAGE_LABEL[steps[steps.length - 1]]} adds the finished cases to inventory.` : 'One step: logging cases takes all materials and adds the cases to inventory.'}</p>
        </div>}
        {!addWo && <div><label className="text-xs text-gray-500">Note (optional)</label><input value={note} onChange={e => setNote(e.target.value)} className={inp} /></div>}
        {err && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
      </div>
      <div className="px-5 py-3 border-t border-[#EEF0F4] flex gap-2">
        <button onClick={onClose} disabled={busy} className="flex-1 h-11 rounded-lg border border-[#E4E6EE] text-sm">Cancel</button>
        <button onClick={go} disabled={busy} className="flex-1 h-11 rounded-lg text-white text-sm font-bold disabled:opacity-50" style={{ background: ACCENT }}>{busy ? 'Saving…' : addWo ? 'Add to work order' : 'Create work order'}</button>
      </div>
    </Overlay>)
}
