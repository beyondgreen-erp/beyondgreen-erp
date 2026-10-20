'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
/*
  Walmart Production — weekly work order + daily finished-goods log (phone first).

  Ultron flow:
    Walmart orders (Thursday) ─▶ weekly Walmart WO (targets per SKU, linked orders)
    Daily log (Laura, phone) ─▶ walmart_record_production():
        + finished goods (SRPs) into inventory
        − every BOM component (printed packs, SRP tray, cutlery pieces)
        one inventory_movements row each → Inventory Ledger / Live Activity
    The WO's made / left / status update themselves; the Work Orders board shows the same WO.
  All writes go through database functions that check board access, so the page can't drift
  from inventory.
*/
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { planSnippet, copyText } from '@/lib/planSnippet'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { usePermissions } from '@/lib/permissions'
import Comments from '@/components/Comments'

const BOARD = '/production/walmart'
const SKUS = [
  { sku: '22GVA24', short: 'Assorted 24', color: '#a25ddc' },
  { sku: '22GVA48', short: 'Assorted 48', color: '#784bd1' },
  { sku: '22GVF24', short: 'Fork 24', color: '#579bfc' },
  { sku: '22GVF48', short: 'Fork 48', color: '#0086c0' },
  { sku: '22GVK48', short: 'Knife 48', color: '#e2445c' },
  { sku: '22GVS24', short: 'Spoon 24', color: '#00c875' },
  { sku: '22GVS48', short: 'Spoon 48', color: '#037f4c' },
] as const
const SKU_SET = new Set<string>(SKUS.map(s => s.sku))
const meta = (sku: string) => SKUS.find(s => s.sku === sku) || { sku, short: sku, color: '#9699a6' }
const ACCENT = '#0071ce'   // Walmart blue
const CLOSED = ['Shipped', 'Delivered', 'Cancelled', 'Canceled', 'Closed', 'Invoiced', 'Paid', 'Complete', 'Completed']

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parse = (s: string) => new Date(s + 'T00:00:00')
const addDays = (s: string, n: number) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d) }
const mondayOf = (s: string) => { const d = parse(s); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return ymd(d) }
const fmtDay = (s: string) => parse(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const fmtShort = (s: string) => parse(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const fmtTime = (s: string) => new Date(s).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const fmtN = (v: any) => num(v).toLocaleString('en-US', { maximumFractionDigits: 2 })
const nameOf = (email: string | null) => (email || '').split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || '—'

const PICK_COLS = ['22GVF24', '22GVA24', '22GVK48', '22GVA48', '22GVS48', '22GVS24', '22GVF48'] as const   // same order as the pick-up sheet
const isRealLoad = (t?: string | null) => !!t && t.trim() !== '' && !/^(pending|pndg|not assigned|unassigned|tbd|n\/?a|none)/i.test(t.trim())
const PRIO_COLORS = ['#e2445c', '#fdab3d', '#579bfc', '#a25ddc', '#00c875', '#9699a6']
const prioColor = (rank: number) => rank ? PRIO_COLORS[Math.min(rank, PRIO_COLORS.length) - 1] : '#c4c4c4'
const normSku = (v: any) => String(v || '').trim().toUpperCase()
const PIECES = [{ sku: 'BGFRK', name: 'Fork', color: '#579bfc' }, { sku: 'BGSPN', name: 'Spoon', color: '#00c875' }, { sku: 'BGKNF', name: 'Knife', color: '#e2445c' }] as const
interface MRun { id: string; work_order_id: string; run_date: string; machine_id: string; piece: string; skus: string[]; target_pcs: number | null; hours: number | null; operator: string | null; notes: string | null }
interface Mach { id: string; machine_code: string; status: string | null; oph: number }
interface Load { id: string; load_number: string; pickup_date: string | null; priority: number | null; status: string; notes: string | null }
interface WoOrder { id: string; po_number: string | null; name: string | null; group_name: string | null; status: string | null; load_number: string | null; pallets: string | null; archived: boolean | null; walmart_board_lines: { part_number: string | null; qty: number | null }[] }
interface WoRel { walmart_order_id: string; sku: string; qty: number; status: string }
interface SkuPlan { need: number; done: number; covered: number }
interface PlanGroup { key: string; load: Load | null; rank: number; orders: WoOrder[]; bySku: Record<string, SkuPlan>; orderSku: Record<string, Record<string, 'done' | 'covered' | 'partial' | 'open'>> }

function buildPlan(woOrders: WoOrder[], loads: Load[], woRel: WoRel[], progBySku: Record<string, Prog>): PlanGroup[] {
  if (!woOrders.length) return []
  const loadBy = new Map(loads.map(l => [l.load_number, l]))
  const relBy: Record<string, number> = {}
  for (const r of woRel) relBy[r.walmart_order_id + '|' + normSku(r.sku)] = (relBy[r.walmart_order_id + '|' + normSku(r.sku)] || 0) + num(r.qty)
  const relQty: Record<string, number> = {}
  for (const r of woRel) relQty[normSku(r.sku)] = (relQty[normSku(r.sku)] || 0) + num(r.qty)
  const pool: Record<string, number> = {}
  for (const sk of SKUS) pool[sk.sku] = Math.max(0, num(progBySku[sk.sku]?.made_qty) - (relQty[sk.sku] || 0))
  const gm = new Map<string, PlanGroup>()
  for (const o of woOrders) {
    const ln = isRealLoad(o.load_number) ? o.load_number!.trim() : ''
    const key = ln || '__none'
    if (!gm.has(key)) gm.set(key, { key, load: ln ? (loadBy.get(ln) || { id: '', load_number: ln, pickup_date: null, priority: null, status: 'Open', notes: null }) : null, rank: 0, orders: [], bySku: {}, orderSku: {} })
    gm.get(key)!.orders.push(o)
  }
  const groups = Array.from(gm.values()).sort((a, b) => {
    if (!a.load) return 1
    if (!b.load) return -1
    const da = a.load.pickup_date || '9999-12-31', db = b.load.pickup_date || '9999-12-31'
    if (da !== db) return da < db ? -1 : 1
    const pa = a.load.priority ?? 999, pb = b.load.priority ?? 999
    if (pa !== pb) return pa - pb
    return a.load.load_number.localeCompare(b.load.load_number)
  })
  let r = 0
  for (const g of groups) {
    g.rank = g.load ? ++r : 0
    g.orders.sort((a, b) => (a.po_number || '').localeCompare(b.po_number || ''))
    for (const o of g.orders) {
      const built = !['Walmart Orders', 'Building Order'].includes(o.group_name || 'Walmart Orders')   // past the build step = done
      const os: Record<string, 'done' | 'covered' | 'partial' | 'open'> = {}
      for (const l of o.walmart_board_lines || []) {
        const sku = normSku(l.part_number), q = num(l.qty)
        if (!q || !SKU_SET.has(sku)) continue
        const b = g.bySku[sku] || (g.bySku[sku] = { need: 0, done: 0, covered: 0 })
        b.need += q
        const rq = built ? q : Math.min(q, relBy[o.id + '|' + sku] || 0)   // released / claimed so far
        b.done += rq
        if (rq >= q) { os[sku] = 'done'; continue }
        const c = Math.min(pool[sku] || 0, q - rq)
        pool[sku] = (pool[sku] || 0) - c
        b.covered += c
        os[sku] = rq + c >= q ? 'covered' : rq + c > 0 ? 'partial' : 'open'
      }
      g.orderSku[o.id] = os
    }
  }
  return groups
}

interface WO { id: string; wo_code: string | null; wo_number: number; status: string | null; start_date: string; due_date: string | null; notes: string | null; qty_ordered: number | null; qty_completed: number | null }
interface Prog { work_order_id?: string; sku: string; product_name: string | null; target_qty: number; made_qty: number; left_qty: number; on_hand_qty: number | null }
interface Entry { id: string; work_order_id: string | null; production_date: string; sku: string; qty: number; lot_number: string | null; note: string | null; entered_by: string | null; created_at: string; voided_at: string | null; voided_by: string | null; void_reason: string | null }
interface Move { id: string; ref_id: string; ref_table: string; sku: string; movement_type: string; qty: number; created_at: string }
interface Release { id: string; walmart_order_id: string; work_order_id: string | null; sku: string; qty: number; status: string; released_by: string | null; released_at: string; claimed_by: string | null; claimed_at: string | null; note: string | null; walmart_board_orders: { po_number: string | null; name: string | null; group_name: string | null; ship_due_date: string | null } | null }
interface Prod { sku: string; product_name: string | null; on_hand_qty: number | null; unit_of_measure: string | null }

function Bar({ value, total, color }: { value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0
  return (
    <div className="h-2.5 w-full rounded-full bg-[#EEF0F4] overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: pct + '%', background: pct >= 100 ? '#00c875' : color }} />
    </div>
  )
}

export default function WalmartProductionPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const perms = usePermissions()
  const canEdit = perms.canEdit(BOARD)
  const me = perms.email || ''
  const today = ymd(new Date())

  const [week, setWeek] = useState(mondayOf(today))
  const weekEnd = addDays(week, 6)
  const [wo, setWo] = useState<WO | null>(null)
  const [prog, setProg] = useState<Prog[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [moves, setMoves] = useState<Move[]>([])
  const [prods, setProds] = useState<Record<string, Prod>>({})
  const [alloc, setAlloc] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [showLog, setShowLog] = useState(false)
  const [showWo, setShowWo] = useState(false)
  const [detail, setDetail] = useState<Entry | null>(null)
  const [showVoided, setShowVoided] = useState(false)
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const [flash, setFlash] = useState('')
  const [tab, setTab] = useState<'production' | 'build'>('production')
  const [safety, setSafety] = useState<WO[]>([])
  const [safetyProg, setSafetyProg] = useState<Prog[]>([])
  const [releases, setReleases] = useState<Release[]>([])
  const [showSafety, setShowSafety] = useState(false)
  const [loads, setLoads] = useState<Load[]>([])
  const [woOrders, setWoOrders] = useState<WoOrder[]>([])
  const [woRel, setWoRel] = useState<WoRel[]>([])
  const [showLoads, setShowLoads] = useState(false)
  const [runs, setRuns] = useState<MRun[]>([])
  const [machs, setMachs] = useState<Mach[]>([])
  const [bomPcs, setBomPcs] = useState<Record<string, Record<string, number>>>({})
  const loadSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoadErr('')
    const [woR, entR, prodR, allocR] = await Promise.all([
      sb.from('work_orders').select('id,wo_code,wo_number,status,start_date,due_date,notes,qty_ordered,qty_completed')
        .eq('form_type', 'walmart_weekly').eq('start_date', week).neq('status', 'Cancelled').maybeSingle(),
      sb.from('walmart_production_entries').select('*').gte('production_date', week).lte('production_date', addDays(week, 6))
        .order('production_date', { ascending: false }).order('created_at', { ascending: false }),
      sb.from('products').select('sku,product_name,on_hand_qty,unit_of_measure').in('sku', SKUS.map(s => s.sku)),
      sb.from('v_fg_allocation_totals').select('sku_key,allocated_qty').in('sku_key', SKUS.map(s => s.sku)),
    ])
    if (seq !== loadSeq.current) return
    const err = woR.error || entR.error || prodR.error
    if (err) { setLoadErr(err.message); setLoading(false); return }
    const w = (woR.data as WO) || null
    setWo(w)
    const ents = (entR.data as Entry[]) || []
    setEntries(ents)
    setProds(Object.fromEntries(((prodR.data as Prod[]) || []).map(p => [p.sku, p])))
    setAlloc(Object.fromEntries(((allocR.data as any[]) || []).map(a => [a.sku_key, num(a.allocated_qty)])))
    if (w) {
      const [pgR, woR2, relR2, ldR, runR] = await Promise.all([
        sb.from('v_walmart_wo_progress').select('*').eq('work_order_id', w.id),
        sb.from('walmart_wo_orders').select('walmart_board_orders(id,po_number,name,group_name,status,load_number,pallets,archived,walmart_board_lines(part_number,qty))').eq('work_order_id', w.id),
        sb.from('walmart_releases').select('walmart_order_id,sku,qty,status').eq('work_order_id', w.id).neq('status', 'Cancelled'),
        sb.from('walmart_loads').select('*').neq('status', 'Cancelled').order('pickup_date', { ascending: true, nullsFirst: false }),
        sb.from('walmart_machine_runs').select('*').eq('work_order_id', w.id).order('run_date'),
      ])
      if (seq !== loadSeq.current) return
      setProg((pgR.data as Prog[]) || [])
      setWoOrders((((woR2.data as any[]) || []).map(r => r.walmart_board_orders).filter((o: any) => o && !o.archived)) as WoOrder[])
      setWoRel((relR2.data as WoRel[]) || [])
      setLoads((ldR.data as Load[]) || [])
      setRuns((runR.data as MRun[]) || [])
    } else { setProg([]); setWoOrders([]); setWoRel([]); setRuns([]) }
    const [ssR, relR] = await Promise.all([
      sb.from('work_orders').select('id,wo_code,wo_number,status,start_date,due_date,notes,qty_ordered,qty_completed')
        .eq('form_type', 'walmart_safety').not('status', 'in', '("Complete","Cancelled")').order('created_at'),
      sb.from('walmart_releases').select('*, walmart_board_orders(po_number,name,group_name,ship_due_date)')
        .or(`status.eq.Released,and(status.eq.Claimed,claimed_at.gte.${addDays(today, -14)})`).order('released_at', { ascending: false }),
    ])
    if (seq !== loadSeq.current) return
    const ssList = (ssR.data as WO[]) || []
    setSafety(ssList)
    if (ssList.length) {
      const { data: sp } = await sb.from('v_walmart_wo_progress').select('*').in('work_order_id', ssList.map(x => x.id))
      if (seq === loadSeq.current) setSafetyProg((sp as Prog[]) || [])
    } else setSafetyProg([])
    setReleases((relR.data as Release[]) || [])
    const ids = ents.map(e => e.id)
    if (ids.length) {
      const { data: mv } = await sb.from('inventory_movements').select('id,ref_id,ref_table,sku,movement_type,qty,created_at')
        .in('ref_table', ['walmart_production_entries', 'walmart_production_void']).in('ref_id', ids)
      if (seq === loadSeq.current) setMoves((mv as Move[]) || [])
    } else setMoves([])
    setLoading(false)
  }, [sb, week, today])

  useEffect(() => {   // deep link from the Work Orders board: ?week=YYYY-MM-DD
    const w = new URLSearchParams(window.location.search).get('week')
    if (w && /^\d{4}-\d{2}-\d{2}$/.test(w)) setWeek(mondayOf(w))
  }, [])
  useEffect(() => { setLoading(true); load() }, [load])
  useEffect(() => { (async () => {
    const [mR, rR, bR] = await Promise.all([
      sb.from('machines').select('id,machine_code,status,is_active,equipment_group').eq('equipment_group', 'MOLDING').eq('is_active', true),
      sb.from('machine_rates').select('machine_id,output_per_hour,is_active,updated_at').eq('is_active', true),
      sb.from('product_bom').select('finished_good_sku,component_sku,qty_value').like('finished_good_sku', '22GV%').in('component_sku', PIECES.map(x => x.sku)),
    ])
    const rate: Record<string, number> = {}
    for (const r of ((rR.data as any[]) || []).sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)))) rate[r.machine_id] = num(r.output_per_hour)
    setMachs(((mR.data as any[]) || []).map(m => ({ id: m.id, machine_code: m.machine_code, status: m.status, oph: rate[m.id] || 0 }))
      .sort((a, b) => a.machine_code.localeCompare(b.machine_code, undefined, { numeric: true })))
    const bm: Record<string, Record<string, number>> = {}
    for (const b of (bR.data as any[]) || []) { const k = normSku(b.finished_good_sku); (bm[k] ||= {})[normSku(b.component_sku)] = num(b.qty_value) }
    setBomPcs(bm)
  })() }, [sb])
  useEffect(() => {
    let t: any
    const bump = () => { clearTimeout(t); t = setTimeout(load, 300) }
    const ch = sb.channel('walmart-production-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'walmart_production_entries' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'walmart_wo_targets' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'walmart_releases' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'walmart_loads' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'walmart_machine_runs' }, bump)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'walmart_board_orders' }, bump)
      .subscribe()
    return () => { clearTimeout(t); sb.removeChannel(ch) }
  }, [sb, load])
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(''), flash.startsWith('⚠') ? 20000 : 6000); return () => clearTimeout(t) }, [flash])

  const live = entries.filter(e => !e.voided_at)
  const madeBySku = useMemo(() => {
    const m: Record<string, number> = {}
    for (const e of live) if (!wo || e.work_order_id === wo.id || !e.work_order_id) m[e.sku] = (m[e.sku] || 0) + num(e.qty)
    return m
  }, [live, wo])
  const progBySku = useMemo(() => Object.fromEntries(prog.map(p => [p.sku, p])), [prog])

  // Pick-up priority plan: loads ordered by pick-up date then priority; this WO's unreleased
  // production is credited to the earliest load first, so each SKU shows what to finish next.
  const plan = useMemo(() => buildPlan(woOrders, loads, woRel, progBySku), [woOrders, loads, woRel, progBySku])
  const rankByOrder = useMemo(() => {
    const m: Record<string, { rank: number; label: string }> = {}
    for (const g of plan) for (const o of g.orders) m[o.id] = { rank: g.rank, label: g.load ? `P${g.rank} · ${g.load.pickup_date ? 'PU ' + fmtShort(g.load.pickup_date) + ' · ' : ''}Load ${g.load.load_number}` : 'No load' }
    return m
  }, [plan])
  const totalTarget = prog.reduce((s, p) => s + num(p.target_qty), 0)
  const totalMade = prog.reduce((s, p) => s + Math.min(num(p.made_qty), num(p.target_qty)), 0)
  const weekMade = live.reduce((s, e) => s + num(e.qty), 0)

  const days = useMemo(() => {
    const shown = showVoided ? entries : live
    const map = new Map<string, Entry[]>()
    for (const e of shown) { if (!map.has(e.production_date)) map.set(e.production_date, []); map.get(e.production_date)!.push(e) }
    if (today >= week && today <= weekEnd && !map.has(today)) map.set(today, [])
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [entries, live, showVoided, today, week, weekEnd])

  const ledger = useMemo(() => {
    // per day → per SKU net movement
    const byEntry = new Map(entries.map(e => [e.id, e]))
    const out = new Map<string, Map<string, number>>()
    for (const m of moves) {
      const e = byEntry.get(m.ref_id); if (!e) continue
      const d = e.production_date
      if (!out.has(d)) out.set(d, new Map())
      const row = out.get(d)!
      row.set(m.sku, (row.get(m.sku) || 0) + num(m.qty))
    }
    return Array.from(out.entries()).sort((a, b) => b[0].localeCompare(a[0]))
      .map(([d, row]) => [d, Array.from(row.entries()).filter(([, q]) => Math.abs(q) > 0.0001).sort((a, b) => (b[1] > 0 ? 1 : 0) - (a[1] > 0 ? 1 : 0) || a[0].localeCompare(b[0]))] as const)
  }, [moves, entries])
  const [compNames, setCompNames] = useState<Record<string, string>>({})
  useEffect(() => {
    const need = Array.from(new Set(moves.map(m => m.sku))).filter(s => !prods[s] && !compNames[s])
    if (!need.length) return
    sb.from('products').select('sku,product_name').in('sku', need).then(({ data }) => {
      if (data) setCompNames(c => ({ ...c, ...Object.fromEntries((data as any[]).map(p => [p.sku, p.product_name])) }))
    })
  }, [moves, prods, compNames, sb])
  const itemName = (sku: string) => prods[sku]?.product_name || compNames[sku] || sku

  const isThisWeek = week === mondayOf(today)

  return (
    <div className="min-h-screen mon-page py-4 sm:py-6 pb-10">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-4">
        <div>
          <span className="mon-tag" style={{ background: ACCENT + '1f', color: ACCENT }}>🛒 Walmart</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">Walmart Production</h1>
          <p className="text-gray-500 text-sm mt-0.5">{loading ? 'Loading…' : `${fmtN(weekMade)} SRP made this week${wo ? ` · ${wo.wo_code}` : ''}`}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setWeek(addDays(week, -7))} className="h-10 w-10 rounded-xl border border-[#E4E6EE] bg-white text-lg" aria-label="Previous week">‹</button>
          <div className="flex-1 sm:flex-none text-center px-3 h-10 rounded-xl border border-[#E4E6EE] bg-white flex flex-col justify-center min-w-[150px]">
            <span className="text-[10px] uppercase tracking-wide text-gray-400 leading-none">{isThisWeek ? 'This week' : 'Week of'}</span>
            <span className="text-sm font-semibold text-[#1A1D2E] leading-tight">{fmtShort(week)} – {fmtShort(weekEnd)}</span>
          </div>
          <button onClick={() => setWeek(addDays(week, 7))} className="h-10 w-10 rounded-xl border border-[#E4E6EE] bg-white text-lg" aria-label="Next week">›</button>
          {!isThisWeek && <button onClick={() => setWeek(mondayOf(today))} className="h-10 px-3 rounded-xl text-sm font-semibold text-white" style={{ background: ACCENT }}>Today</button>}
        </div>
      </div>

      {canEdit && (
        <button onClick={() => setShowLog(true)} className="w-full sm:w-auto sm:px-8 h-14 mb-4 rounded-2xl text-white text-base font-bold shadow-md active:scale-[.99]" style={{ background: ACCENT }}>+ Log production</button>
      )}

      <div className="flex gap-1 p-1 mb-4 rounded-xl bg-[#EEF0F4] w-full sm:w-auto sm:inline-flex">
        {([['production', 'Production'], ['build', 'Build team']] as const).map(([k, l]) => {
          const n = k === 'build' ? releases.filter(r => r.status === 'Released').length : 0
          return <button key={k} onClick={() => setTab(k)} data-ro-ok className={`flex-1 sm:flex-none h-10 px-5 rounded-lg text-sm font-semibold ${tab === k ? 'bg-white shadow-sm text-[#1A1D2E]' : 'text-gray-500'}`}>{l}{n ? <span className="ml-1.5 text-[11px] text-white rounded-full px-1.5 py-0.5" style={{ background: '#e2445c' }}>{n}</span> : null}</button>
        })}
      </div>

      {tab === 'build' && flash && <div className={`mb-3 rounded-xl border text-sm px-4 py-3 font-medium ${flash.startsWith('⚠') ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>{flash}</div>}
      {tab === 'build' ? <BuildTeam sb={sb} releases={releases} canEdit={canEdit} onDone={(m) => { setFlash(m); load() }} /> : <>
      <div className="mb-4 rounded-lg bg-[#10B981]/10 border border-[#10B981]/25 text-[12px] text-[#0f7a5a] px-3 py-2">🔗 Ultron — each entry adds the finished SRPs to inventory, takes out every packaging part and cutlery piece used, posts to the Inventory Ledger, and updates this week&apos;s Walmart work order.</div>

      {flash && <div className={`mb-3 rounded-xl border text-sm px-4 py-3 font-medium ${flash.startsWith('⚠') ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>{flash}</div>}
      {loadErr && <div className="mb-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">Could not load: {loadErr}</div>}

      {/* Weekly work order */}
      <div className="bg-white rounded-2xl shadow-sm border border-[#ECEEF3] mb-4 overflow-hidden">
        <div className="px-4 py-3 flex items-center justify-between gap-2" style={{ borderLeft: '5px solid ' + ACCENT }}>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-gray-400">Work order · what to make this week</p>
            {wo ? (
              <p className="font-bold text-[#1A1D2E] truncate">{wo.wo_code} <span className="ml-1 text-[11px] font-semibold text-white rounded-full px-2 py-0.5 align-middle" style={{ background: wo.status === 'Complete' ? '#00c875' : wo.status === 'In Progress' ? '#fdab3d' : '#579bfc' }}>{wo.status}</span></p>
            ) : <p className="font-semibold text-gray-500">No work order for this week yet</p>}
          </div>
          {canEdit && <div className="flex gap-1.5 shrink-0">
            <button onClick={() => setShowSafety(true)} className="text-sm font-semibold rounded-xl px-3 py-2 border border-[#E4E6EE] text-gray-600">+ Safety stock</button>
            <button onClick={() => setShowWo(true)} className="text-sm font-semibold rounded-xl px-3 py-2 border" style={{ borderColor: ACCENT, color: ACCENT }}>{wo ? '✎ Targets' : '+ Create WO'}</button>
          </div>}
        </div>
        {wo && totalTarget > 0 && (
          <div className="px-4 pb-3">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1"><span>{fmtN(totalMade)} of {fmtN(totalTarget)} SRP</span><span className="font-semibold text-[#1A1D2E]">{fmtN(Math.max(totalTarget - totalMade, 0))} left</span></div>
            <Bar value={totalMade} total={totalTarget} color={ACCENT} />
          </div>
        )}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 p-3 pt-1">
          {SKUS.map(s => {
            const p = progBySku[s.sku]
            const target = num(p?.target_qty), made = wo ? num(p?.made_qty) : num(madeBySku[s.sku]), left = Math.max(target - made, 0)
            if (wo && !p && !made) return null
            return (
              <div key={s.sku} className="rounded-xl border border-[#ECEEF3] p-3" style={{ borderTop: '4px solid ' + s.color }}>
                <div className="flex items-baseline justify-between gap-1">
                  <span className="font-bold text-[#1A1D2E] text-sm leading-tight">{s.short}</span>
                  <span className="font-mono text-[10px] text-gray-400">{s.sku}</span>
                </div>
                {target > 0 ? (
                  <>
                    <div className="mt-1.5 flex items-baseline gap-1"><span className="text-2xl font-extrabold" style={{ color: left === 0 ? '#00a85a' : '#1A1D2E' }}>{left === 0 ? '✓' : fmtN(left)}</span><span className="text-xs text-gray-500">{left === 0 ? 'done' : 'left'}</span></div>
                    <p className="text-[11px] text-gray-500 mb-1.5">{fmtN(made)} made of {fmtN(target)}</p>
                    <Bar value={made} total={target} color={s.color} />
                    {plan.some(g => g.bySku[s.sku]) && (
                      <div className="mt-2 pt-2 border-t border-[#F0F2F6] space-y-1.5">
                        {plan.filter(g => g.bySku[s.sku]).map(g => {
                          const b = g.bySku[s.sku], todo = Math.max(b.need - b.done - b.covered, 0)
                          return (
                            <div key={g.key} className="text-[11px] leading-tight">
                              <div className="flex items-center gap-1 min-w-0">
                                <span className="shrink-0 font-bold text-white rounded px-1" style={{ background: prioColor(g.rank) }}>{g.rank ? 'P' + g.rank : '—'}</span>
                                <span className="truncate text-gray-600">{g.load ? `${g.load.pickup_date ? fmtShort(g.load.pickup_date) + ' · ' : ''}${g.load.load_number}` : 'No load yet'}</span>
                              </div>
                              <div className="flex justify-between gap-1 mt-0.5">
                                <span className="text-gray-400">{fmtN(b.need)}</span>
                                <span className={`font-semibold ${todo ? 'text-[#e2445c]' : 'text-[#00a85a]'}`}>{todo ? `${fmtN(todo)} to make` : b.done >= b.need ? '✓ released' : '✓ covered'}</span>
                              </div>
                            </div>)
                        })}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="mt-1.5 text-sm text-gray-500"><span className="text-xl font-extrabold text-[#1A1D2E]">{fmtN(made)}</span> made</p>
                )}
              </div>
            )
          })}
        </div>
        {wo?.notes && <p className="px-4 pb-3 text-xs text-gray-500">📝 {wo.notes}</p>}
      </div>

      {wo && (plan.length > 0 || canEdit) && <PickupSchedule plan={plan} canEdit={canEdit} onManage={() => setShowLoads(true)} />}

      {wo && <MachinePlan sb={sb} wo={wo} week={week} today={today} canEdit={canEdit} progBySku={progBySku} plan={plan} runs={runs} machs={machs} bomPcs={bomPcs} onSaved={(m) => { setFlash(m); load() }} />}

      {safety.map(ss => {
        const rows = safetyProg.filter(p => p.work_order_id === ss.id)
        const t = rows.reduce((a, p) => a + num(p.target_qty), 0), m = rows.reduce((a, p) => a + Math.min(num(p.made_qty), num(p.target_qty)), 0)
        return (
          <div key={ss.id} className="bg-white rounded-2xl shadow-sm border border-[#ECEEF3] mb-4 overflow-hidden">
            <div className="px-4 py-3" style={{ borderLeft: '5px solid #9699a6' }}>
              <p className="text-[11px] uppercase tracking-wide text-gray-400">Safety stock work order · no POs</p>
              <p className="font-bold text-[#1A1D2E]">{ss.wo_code} <span className="ml-1 text-[11px] font-semibold text-white rounded-full px-2 py-0.5 align-middle" style={{ background: ss.status === 'In Progress' ? '#fdab3d' : '#579bfc' }}>{ss.status}</span>{ss.notes ? <span className="ml-2 text-xs font-normal text-gray-500">{ss.notes}</span> : null}</p>
              <div className="flex items-center justify-between text-xs text-gray-500 mt-2 mb-1"><span>{fmtN(m)} of {fmtN(t)} SRP</span><span className="font-semibold text-[#1A1D2E]">{fmtN(Math.max(t - m, 0))} left</span></div>
              <Bar value={m} total={t} color="#9699a6" />
              <div className="flex flex-wrap gap-2 mt-2">{rows.map(p => <span key={p.sku} className="text-[11px] rounded-full px-2 py-0.5 bg-[#F2F4F8]"><b style={{ color: meta(p.sku).color }}>{meta(p.sku).short}</b> {fmtN(p.made_qty)}/{fmtN(p.target_qty)}</span>)}</div>
            </div>
          </div>)
      })}

      {/* Daily log — record board */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-bold text-[#1A1D2E]">Daily log</h2>
        <label className="text-xs text-gray-500 flex items-center gap-1.5"><input type="checkbox" checked={showVoided} onChange={e => setShowVoided(e.target.checked)} data-ro-ok /> Show removed</label>
      </div>
      <div className="space-y-3">
        {days.map(([d, rows]) => {
          const total = rows.filter(r => !r.voided_at).reduce((s, r) => s + num(r.qty), 0)
          const color = d === today ? ACCENT : '#9699a6'
          return (
            <div key={d} className="bg-white rounded-xl shadow-sm border border-[#ECEEF3] overflow-hidden">
              <div className="flex items-center gap-2.5 px-4 py-2.5" style={{ borderLeft: '5px solid ' + color }}>
                <span className="font-bold text-sm" style={{ color }}>{d === today ? 'Today · ' : ''}{fmtDay(d)}</span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: color + '22', color }}>{fmtN(total)} SRP</span>
              </div>
              {rows.length === 0 ? (
                <p className="px-4 pb-3 text-sm text-gray-400">Nothing logged yet{canEdit ? ' — tap “Log production” above.' : '.'}</p>
              ) : (
                <div className="divide-y divide-[#F0F2F6]">
                  {rows.map(r => {
                    const m = meta(r.sku)
                    return (
                      <button key={r.id} onClick={() => setDetail(r)} className={`w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-[#F2F6FF] ${r.voided_at ? 'opacity-50' : ''}`} data-ro-ok>
                        <span className="w-2.5 h-9 rounded-full shrink-0" style={{ background: m.color }} />
                        <div className="min-w-0 flex-1">
                          <p className={`font-semibold text-[#1A1D2E] text-sm ${r.voided_at ? 'line-through' : ''}`}>{m.short} <span className="font-mono text-[10px] text-gray-400 ml-1">{r.sku}</span></p>
                          <p className="text-[11px] text-gray-500 truncate">{nameOf(r.entered_by)} · {fmtTime(r.created_at)}{r.note ? ' · ' + r.note : ''}{r.voided_at ? ' · removed' : ''}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-lg font-extrabold text-[#1A1D2E] leading-none">{fmtN(r.qty)}</p>
                          <p className="text-[10px] text-gray-400">SRP · {fmtN(num(r.qty) * 6)} packs</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
        {!loading && days.length === 0 && <div className="bg-white rounded-xl border border-[#ECEEF3] p-8 text-center text-sm text-gray-500">No production logged this week.</div>}
      </div>

      {/* Ledger */}
      <div className="mt-5 bg-white rounded-xl shadow-sm border border-[#ECEEF3] overflow-hidden">
        <button onClick={() => setLedgerOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-3" data-ro-ok>
          <span className="font-bold text-[#1A1D2E] text-sm">📒 Inventory ledger — finished goods in, parts out</span>
          <span className="text-gray-400 text-xs">{ledgerOpen ? 'Hide' : 'Show'}</span>
        </button>
        {ledgerOpen && (
          <div className="px-4 pb-4 space-y-4">
            {ledger.length === 0 && <p className="text-sm text-gray-400">No ledger rows this week.</p>}
            {ledger.map(([d, rows]) => (
              <div key={d}>
                <p className="text-xs font-semibold text-gray-500 mb-1">{fmtDay(d)}</p>
                <table className="w-full text-sm">
                  <tbody>
                    {rows.map(([sku, q]) => (
                      <tr key={sku} className="border-t border-[#F0F2F6]">
                        <td className="py-1.5 pr-2"><span className="font-mono text-[11px] text-gray-500 mr-2">{sku}</span><span className="text-[#1A1D2E]">{itemName(sku)}</span></td>
                        <td className={`py-1.5 text-right font-semibold whitespace-nowrap ${q > 0 ? 'text-emerald-600' : 'text-red-600'}`}>{q > 0 ? '+' : '−'}{fmtN(Math.abs(q))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            <a href="/inventory/ledger" className="inline-block text-xs font-semibold" style={{ color: ACCENT }}>Open full Inventory Ledger →</a>
          </div>
        )}
      </div>

      {/* Allocation check (office) */}
      <div className="mt-4 bg-white rounded-xl shadow-sm border border-[#ECEEF3] overflow-x-auto">
        <p className="px-4 pt-3 font-bold text-[#1A1D2E] text-sm">Stock vs. open Walmart orders</p>
        <table className="w-full text-sm min-w-[520px] mt-2">
          <thead><tr className="text-[11px] uppercase text-gray-400 border-b border-[#EEF0F4]">
            <th className="text-left px-4 py-2">SKU</th><th className="text-right px-3 py-2">On hand</th><th className="text-right px-3 py-2">Allocated</th><th className="text-right px-3 py-2">Short</th><th className="text-right px-4 py-2">Left this week</th>
          </tr></thead>
          <tbody>
            {SKUS.map(s => {
              const oh = num(prods[s.sku]?.on_hand_qty), al = num(alloc[s.sku]), short = Math.max(al - oh, 0)
              const p = progBySku[s.sku]
              return (
                <tr key={s.sku} className="border-b border-[#F4F5F8]">
                  <td className="px-4 py-2"><span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: s.color }} />{s.short} <span className="font-mono text-[10px] text-gray-400">{s.sku}</span></td>
                  <td className="px-3 py-2 text-right">{fmtN(oh)}</td>
                  <td className="px-3 py-2 text-right">{fmtN(al)}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${short > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{short > 0 ? fmtN(short) : '✓'}</td>
                  <td className="px-4 py-2 text-right">{p ? fmtN(p.left_qty) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="px-4 py-2 text-[11px] text-gray-400">SRP = 1 case of 6 packs. Allocated = open Walmart order lines not yet shipped.</p>
      </div>

      </>}

      {showLoads && wo && <LoadsModal sb={sb} loads={loads} orders={woOrders} rankByOrder={rankByOrder} onClose={() => setShowLoads(false)} onChanged={load} />}
      {showSafety && <SafetyModal sb={sb} onClose={() => setShowSafety(false)} onSaved={(m) => { setFlash(m); setShowSafety(false); load() }} />}
      {showLog && <LogSheet sb={sb} wo={wo} rankByOrder={rankByOrder} safety={safety} safetyProg={safetyProg} progBySku={progBySku} today={today} onClose={() => setShowLog(false)}
        onSaved={(msg) => { setFlash(msg); setShowLog(false); setTab('production'); load(); requestAnimationFrame(() => { document.querySelector('main')?.scrollTo({ top: 0 }); window.scrollTo({ top: 0 }) }) }} />}
      {showWo && <WoModal sb={sb} wo={wo} week={week} prods={prods} alloc={alloc} prog={prog} onClose={() => setShowWo(false)}
        onSaved={(msg) => { setFlash(msg); setShowWo(false); load() }} />}
      {detail && <EntryDetail sb={sb} entry={detail} wo={wo} moves={moves.filter(m => m.ref_id === detail.id)} itemName={itemName} me={me}
        canEdit={canEdit} isAdmin={perms.is_admin} onClose={() => setDetail(null)} onChanged={(msg) => { setFlash(msg); setDetail(null); load() }} />}
    </div>
  )
}

/** Pop-ups render straight into <body>. Inside the app's scrolling <main>, iOS Safari clips
 *  position:fixed children to the scroller, which cut off the bottom buttons on phones. */
function Overlay({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])
  return mounted ? createPortal(children, document.body) : null
}

/* ───────────────── Log production (whiteboard-style: one row per SKU) ───────────────── */
function LogSheet({ sb, wo, rankByOrder, safety, safetyProg, progBySku, today, onClose, onSaved }: {
  sb: ReturnType<typeof createSupabaseBrowserClient>; wo: WO | null; rankByOrder: Record<string, { rank: number; label: string }>; safety: WO[]; safetyProg: Prog[]; progBySku: Record<string, Prog>; today: string
  onClose: () => void; onSaved: (msg: string) => void
}) {
  const [woId, setWoId] = useState<string>(wo?.id || safety[0]?.id || '')
  const [releaseMode, setReleaseMode] = useState(false)
  const [poId, setPoId] = useState('')
  const [pos, setPos] = useState<{ id: string; po_number: string | null; skus: string[] }[]>([])
  const isSafety = !!safety.find(s => s.id === woId)
  const progFor: Record<string, Prog> = isSafety ? Object.fromEntries(safetyProg.filter(p => p.work_order_id === woId).map(p => [p.sku, p])) : progBySku
  useEffect(() => {
    setPoId(''); setPos([])
    if (!woId || isSafety) return
    sb.from('walmart_wo_orders').select('walmart_order_id, walmart_board_orders(id,po_number,group_name,walmart_board_lines(part_number,qty))').eq('work_order_id', woId).then(({ data }) => {
      setPos(((data as any[]) || []).map(r => r.walmart_board_orders).filter((o: any) => o && ['Walmart Orders', 'Building Order'].includes(o.group_name || 'Walmart Orders'))
        .map((o: any) => ({ id: o.id, po_number: o.po_number, skus: (o.walmart_board_lines || []).filter((l: any) => num(l.qty) > 0).map((l: any) => String(l.part_number || '').trim().toUpperCase()) })))
    })
  }, [woId, isSafety, sb])
  const [date, setDate] = useState(today)
  const [qty, setQty] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')
  const minDate = addDays(today, -14)
  const total = Object.values(qty).reduce((s, v) => s + (Number(v) > 0 ? Number(v) : 0), 0)
  const step = (sku: string, d: number) => setQty(q => ({ ...q, [sku]: String(Math.max(0, (Number(q[sku]) || 0) + d)) }))

  async function save() {
    setErr(''); setErrs({})
    const rows = Object.entries(qty).filter(([, v]) => v.trim() !== '' && Number(v) > 0)
    if (!rows.length) { setErr('Enter how many SRPs were made for at least one SKU.'); return }
    const bad = rows.find(([, v]) => !/^\d+$/.test(v.trim()))
    if (bad) { setErr(`${meta(bad[0]).short}: enter a whole number.`); return }
    if (date < minDate || date > today) { setErr('Pick a date within the last 14 days.'); return }
    if (releaseMode && !poId) { setErr('Pick the PO this production is for, or tap “Log only”.'); return }
    const po = pos.find(x => x.id === poId)
    if (releaseMode && po && !rows.some(([sku]) => po.skus.includes(sku))) { setErr(`PO ${po.po_number} has none of the SKUs you entered.`); return }
    setBusy(true)
    const failed: Record<string, string> = {}
    const okRows: string[] = []
    const okSkus: string[] = []
    let firstEntry: string | null = null
    for (const [sku, v] of rows) {
      const { data, error } = await sb.rpc('walmart_record_production', { p_sku: sku, p_qty: Number(v), p_date: date, p_wo: woId || null, p_note: note.trim() || null })
      if (error) failed[sku] = error.message
      else { okRows.push(`${v} ${meta(sku).short}`); okSkus.push(sku); firstEntry = firstEntry || (data as any)?.id || null }
    }
    let relMsg = ''
    if (releaseMode && po && okSkus.length) {
      const relQty = Object.fromEntries(rows.filter(([k]) => okSkus.includes(k)).map(([k, v]) => [k, Number(v)]))
      const { data: rel, error: rErr } = await sb.rpc('walmart_release_po', { p_walmart_order: po.id, p_skus: okSkus, p_entry: firstEntry, p_note: note.trim() || null, p_qty: relQty })
      if (rErr) { setBusy(false); onSaved(`⚠ Production saved (${okRows.join(', ')}) — but the release to PO ${po.po_number} did NOT go through: ${rErr.message}. Do not log it again; ask the office to release it.`); return }
      const rr = ((rel as any)?.rows || []) as { sku: string; qty: number; line_qty: number; released_total: number }[]
      relMsg = rr.length ? ` Released to PO ${po.po_number}: ${rr.map(x => `${fmtN(x.qty)} ${meta(x.sku).short} (${fmtN(x.released_total)} of ${fmtN(x.line_qty)})`).join(', ')}.` : ''
      if (((rel as any)?.already || []).length) relMsg += ` ${(rel as any).already.map((k: string) => meta(k).short).join(', ')} already fully released on PO ${po.po_number} — that production stays in stock.`
    }
    setBusy(false)
    if (Object.keys(failed).length) {
      setErrs(failed)
      setQty(q => Object.fromEntries(Object.entries(q).filter(([k]) => failed[k])))
      setErr(okRows.length ? `Saved: ${okRows.join(', ')}. The rows in red did NOT save.` : 'Nothing was saved — see the rows in red.')
      return
    }
    onSaved(`✓ Saved ${okRows.join(', ')} for ${fmtDay(date)} — inventory updated.${relMsg}`)
  }

  return (
    <Overlay>
    <div className="fixed inset-0 z-[110] overflow-y-auto overscroll-contain flex flex-col sm:p-4" style={{ background: 'rgba(26,32,53,0.55)', WebkitOverflowScrolling: 'touch' }}>
      <div className="w-full sm:max-w-lg mt-auto sm:my-auto sm:mx-auto shrink-0 bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl sm:max-h-[90vh] flex flex-col pb-[calc(env(safe-area-inset-bottom)+72px)] sm:pb-0">
        <div className="sticky top-0 z-10 bg-white rounded-t-3xl sm:rounded-t-2xl px-5 pt-4 pb-3 border-b border-[#EEF0F4] flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-gray-400">Finished SRPs (cases of 6 packs)</p>
            <h2 className="text-lg font-bold text-[#1A1D2E]">Log production</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 text-3xl leading-none px-2" aria-label="Close"><span className="sm:hidden text-sm font-semibold align-middle mr-1">Back</span>&times;</button>
        </div>
        <div className="sm:flex-1 sm:min-h-0 sm:overflow-y-auto px-5 py-3 space-y-3">
          <label className="block">
            <span className="text-xs font-semibold text-gray-500">Date made</span>
            <input type="date" value={date} min={minDate} max={today} onChange={e => setDate(e.target.value)} className="mt-1 w-full h-12 rounded-xl border border-[#E4E6EE] px-3 text-base" />
          </label>
          {(wo || safety.length > 0) ? (
            <label className="block">
              <span className="text-xs font-semibold text-gray-500">Work order</span>
              <select value={woId} onChange={e => setWoId(e.target.value)} className="mt-1 w-full h-12 rounded-xl border border-[#E4E6EE] px-3 text-base bg-white">
                {wo && <option value={wo.id}>{wo.wo_code} — this week&apos;s Walmart POs</option>}
                {safety.map(s => <option key={s.id} value={s.id}>{s.wo_code} — safety stock</option>)}
              </select>
            </label>
          ) : <p className="text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">No Walmart work order covers this week yet — production still goes into inventory, but ask the office to create the week&apos;s WO.</p>}
          <div className="space-y-2">
            {SKUS.map(s => {
              const p = progFor[s.sku]
              const left = p ? Math.max(num(p.target_qty) - num(p.made_qty), 0) : null
              return (
                <div key={s.sku} className={`rounded-xl border px-3 py-2.5 flex items-center gap-3 ${errs[s.sku] ? 'border-red-300 bg-red-50' : 'border-[#ECEEF3]'}`}>
                  <span className="w-2.5 h-10 rounded-full shrink-0" style={{ background: s.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-[#1A1D2E] text-[15px] leading-tight">{s.short}</p>
                    <p className="text-[11px] text-gray-400"><span className="font-mono">{s.sku}</span>{left !== null ? ` · ${fmtN(left)} left` : ''}</p>
                    {errs[s.sku] && <p className="text-[11px] text-red-600 mt-0.5">{errs[s.sku]}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button type="button" onClick={() => step(s.sku, -1)} className="w-10 h-11 rounded-xl bg-[#F2F4F8] text-xl font-bold text-gray-600" aria-label={`Less ${s.short}`}>−</button>
                    <input inputMode="numeric" pattern="[0-9]*" value={qty[s.sku] ?? ''} placeholder="0"
                      onChange={e => setQty(q => ({ ...q, [s.sku]: e.target.value.replace(/[^\d]/g, '') }))}
                      className="w-16 h-11 rounded-xl border border-[#E4E6EE] text-center text-lg font-bold" aria-label={`${s.short} SRPs`} />
                    <button type="button" onClick={() => step(s.sku, 1)} className="w-10 h-11 rounded-xl text-xl font-bold text-white" style={{ background: s.color }} aria-label={`More ${s.short}`}>+</button>
                  </div>
                </div>
              )
            })}
          </div>
          <label className="block">
            <span className="text-xs font-semibold text-gray-500">Note (optional)</span>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Shift, line, anything unusual…" className="mt-1 w-full rounded-xl border border-[#E4E6EE] px-3 py-2 text-base" />
          </label>
          {releaseMode && (
            <div className="rounded-xl border-2 border-[#00a85a] bg-emerald-50 p-3">
              <p className="text-xs font-bold text-emerald-800 mb-1">Release to which PO?</p>
              {isSafety ? <p className="text-xs text-emerald-800">Safety stock has no POs — use “Log only”.</p> : pos.length === 0 ? <p className="text-xs text-emerald-800">No open POs on this work order.</p> : (
                <select value={poId} onChange={e => setPoId(e.target.value)} className="w-full h-12 rounded-xl border border-emerald-300 px-3 text-base bg-white">
                  <option value="">Choose a PO…</option>
                  {[...pos].sort((a, b) => ((rankByOrder[a.id]?.rank || 999) - (rankByOrder[b.id]?.rank || 999)) || String(a.po_number).localeCompare(String(b.po_number))).map(o => { const has = Object.entries(qty).some(([k, v]) => Number(v) > 0 && o.skus.includes(k)); return <option key={o.id} value={o.id} disabled={!has}>{rankByOrder[o.id] ? rankByOrder[o.id].label + ' — ' : ''}PO {o.po_number} · {o.skus.map(k => meta(k).short).join(', ')}{has ? '' : ' (none of these SKUs)'}</option> })}
                </select>)}
              <p className="text-[11px] text-emerald-700 mt-1">The build team sees it on their tab and claims it; the PO then moves to Building Order.</p>
            </div>
          )}
          {err && <p className="text-sm rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2">{err}</p>}
        </div>
        <div className="shrink-0 px-5 py-3 border-t border-[#EEF0F4] pb-[max(12px,env(safe-area-inset-bottom))] flex gap-2">
          {!releaseMode ? <>
            <button onClick={save} disabled={busy || total <= 0} className="flex-1 h-14 rounded-2xl text-white text-base font-bold disabled:opacity-40" style={{ background: ACCENT }}>
              {busy ? 'Saving…' : total > 0 ? `Log ${fmtN(total)} SRP` : 'Enter quantities'}
            </button>
            <button onClick={() => { setReleaseMode(true); setErr('') }} disabled={busy || total <= 0 || isSafety} className="flex-1 h-14 rounded-2xl text-white text-base font-bold disabled:opacity-40" style={{ background: '#00a85a' }}>Log &amp; release</button>
          </> : <>
            <button onClick={() => { setReleaseMode(false); setPoId('') }} disabled={busy} className="h-14 px-4 rounded-2xl border border-[#E4E6EE] text-sm font-semibold text-gray-600">Log only</button>
            <button onClick={save} disabled={busy || total <= 0 || !poId} className="flex-1 h-14 rounded-2xl text-white text-base font-bold disabled:opacity-40" style={{ background: '#00a85a' }}>
              {busy ? 'Saving…' : poId ? `Log & release to PO ${pos.find(x => x.id === poId)?.po_number || ''}` : 'Pick a PO'}
            </button>
          </>}
        </div>
      </div>
    </div>
    </Overlay>
  )
}

/* ───────────────── Weekly work order: targets from Thursday's Walmart orders ───────────────── */
function WoModal({ sb, wo, week, prods, alloc, prog, onClose, onSaved }: {
  sb: ReturnType<typeof createSupabaseBrowserClient>; wo: WO | null; week: string; prods: Record<string, Prod>; alloc: Record<string, number>; prog: Prog[]
  onClose: () => void; onSaved: (msg: string) => void
}) {
  const [orders, setOrders] = useState<any[]>([])
  const [taken, setTaken] = useState<Record<string, string>>({})
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [targets, setTargets] = useState<Record<string, string>>({})
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [notes, setNotes] = useState(wo?.notes || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      const [oR, aR] = await Promise.all([
        sb.from('walmart_board_orders').select('id,name,po_number,status,group_name,order_date,ship_due_date,archived,walmart_board_lines(part_number,qty)').eq('archived', false).eq('group_name', 'Walmart Orders').order('order_date', { ascending: false }).limit(200),
        sb.from('walmart_wo_orders').select('work_order_id,walmart_order_id,work_orders(wo_code,status)'),
      ])
      if (oR.error) { setErr(oR.error.message); setLoading(false); return }
      const open = ((oR.data as any[]) || []).filter(o => !CLOSED.includes(o.status || ''))
      const tk: Record<string, string> = {}
      const mine = new Set<string>()
      for (const a of (aR.data as any[]) || []) {
        if (wo && a.work_order_id === wo.id) mine.add(a.walmart_order_id)
        else if (a.work_orders?.status !== 'Cancelled') tk[a.walmart_order_id] = a.work_orders?.wo_code || 'another WO'
      }
      setOrders(open); setTaken(tk)
      setPicked(wo ? mine : new Set(open.filter(o => !tk[o.id]).map(o => o.id)))
      if (wo) setTargets(Object.fromEntries(prog.map(p => [p.sku, String(num(p.target_qty))])))
      if (wo) setTouched(new Set(prog.map(p => p.sku)))
      setLoading(false)
    })()
  }, [sb, wo, prog])

  const fromOrders = useMemo(() => {
    const m: Record<string, number> = {}
    for (const o of orders) if (picked.has(o.id)) for (const l of o.walmart_board_lines || []) {
      const k = String(l.part_number || '').trim().toUpperCase()
      if (SKU_SET.has(k)) m[k] = (m[k] || 0) + num(l.qty)
    }
    return m
  }, [orders, picked])
  const val = (sku: string) => touched.has(sku) ? (targets[sku] ?? '') : String(fromOrders[sku] || 0)

  async function save() {
    setErr('')
    const t: Record<string, number> = {}
    for (const s of SKUS) {
      const v = val(s.sku).trim()
      if (v === '') { t[s.sku] = 0; continue }
      if (!/^\d+$/.test(v)) { setErr(`${s.short}: enter a whole number.`); return }
      t[s.sku] = Number(v)
    }
    if (!Object.values(t).some(v => v > 0)) { setErr('Set a target for at least one SKU.'); return }
    setBusy(true)
    const { error } = await sb.rpc('walmart_wo_save', { p_week_start: week, p_targets: t, p_order_ids: Array.from(picked), p_notes: notes.trim() || null, p_wo: wo?.id ?? null })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onSaved(wo ? '✓ Work order targets updated.' : '✓ Weekly Walmart work order created — it also shows on the Work Orders board.')
  }

  return (
    <Overlay>
    <div className="fixed inset-0 z-[110] overflow-y-auto overscroll-contain flex flex-col sm:p-4" style={{ background: 'rgba(26,32,53,0.55)', WebkitOverflowScrolling: 'touch' }}>
      <div className="w-full sm:max-w-3xl mt-auto sm:my-auto sm:mx-auto shrink-0 bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl sm:max-h-[90vh] flex flex-col pb-[calc(env(safe-area-inset-bottom)+72px)] sm:pb-0">
        <div className="px-5 py-4 text-white rounded-t-3xl sm:rounded-t-2xl flex items-start justify-between" style={{ background: ACCENT }}>
          <div>
            <p className="text-white/70 text-xs uppercase tracking-wide">Weekly Walmart work order</p>
            <h2 className="text-lg font-bold">{wo?.wo_code || 'New'} · {fmtShort(week)} – {fmtShort(addDays(week, 6))}</h2>
          </div>
          <button onClick={onClose} className="text-white/80 text-3xl leading-none px-2" aria-label="Close"><span className="sm:hidden text-sm font-semibold align-middle mr-1">Back</span>&times;</button>
        </div>
        <div className="sm:flex-1 sm:min-h-0 sm:overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">1 · Walmart orders this WO covers</p>
            {loading ? <p className="text-sm text-gray-400">Loading orders…</p> : orders.length === 0 ? <p className="text-sm text-gray-400">No open Walmart orders.</p> : (
              <div className="max-h-56 overflow-y-auto rounded-xl border border-[#ECEEF3] divide-y divide-[#F0F2F6]">
                {orders.map(o => {
                  const dis = !!taken[o.id]
                  const sum = (o.walmart_board_lines || []).filter((l: any) => SKU_SET.has(String(l.part_number || '').toUpperCase()))
                    .map((l: any) => `${meta(String(l.part_number).toUpperCase()).short} ${fmtN(l.qty)}`).join(' · ')
                  return (
                    <label key={o.id} className={`flex items-start gap-3 px-3 py-2 text-sm ${dis ? 'opacity-50' : 'cursor-pointer hover:bg-[#F7F9FC]'}`}>
                      <input type="checkbox" className="mt-1 w-4 h-4" disabled={dis} checked={picked.has(o.id)} onChange={e => setPicked(p => { const n = new Set(p); if (e.target.checked) n.add(o.id); else n.delete(o.id); return n })} />
                      <span className="min-w-0">
                        <span className="font-semibold text-[#1A1D2E]">PO {o.po_number || o.name}</span>
                        <span className="text-gray-400 text-xs ml-2">{o.order_date ? fmtShort(o.order_date) : ''} · {o.status}{dis ? ` · in ${taken[o.id]}` : ''}</span>
                        <span className="block text-[11px] text-gray-500">{sum || 'no Walmart SKUs'}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">2 · Targets (SRP) — pre-filled from the orders above</p>
            <div className="overflow-x-auto rounded-xl border border-[#ECEEF3]">
              <table className="w-full text-sm min-w-[560px]">
                <thead><tr className="text-[11px] uppercase text-gray-400 bg-[#FBFCFE]">
                  <th className="text-left px-3 py-2">SKU</th><th className="text-right px-2 py-2">From orders</th><th className="text-right px-2 py-2">On hand</th><th className="text-right px-2 py-2">All open alloc.</th><th className="text-right px-3 py-2 w-28">Target</th>
                </tr></thead>
                <tbody>
                  {SKUS.map(s => (
                    <tr key={s.sku} className="border-t border-[#F0F2F6]">
                      <td className="px-3 py-1.5"><span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: s.color }} />{s.short} <span className="font-mono text-[10px] text-gray-400">{s.sku}</span></td>
                      <td className="px-2 py-1.5 text-right">{fmtN(fromOrders[s.sku] || 0)}</td>
                      <td className="px-2 py-1.5 text-right text-gray-500">{fmtN(prods[s.sku]?.on_hand_qty)}</td>
                      <td className="px-2 py-1.5 text-right text-gray-500">{fmtN(alloc[s.sku])}</td>
                      <td className="px-3 py-1.5 text-right">
                        <input inputMode="numeric" value={val(s.sku)} onChange={e => { const v = e.target.value.replace(/[^\d]/g, ''); setTouched(t => new Set(t).add(s.sku)); setTargets(x => ({ ...x, [s.sku]: v })) }}
                          className="w-24 h-9 rounded-lg border border-[#E4E6EE] text-right px-2 font-semibold" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {touched.size > 0 && <button onClick={() => { setTouched(new Set()); setTargets({}) }} className="mt-2 text-xs font-semibold" style={{ color: ACCENT }}>↺ Reset targets to the order totals</button>}
          </div>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Notes for the floor</span>
            <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} className="mt-1 w-full rounded-xl border border-[#E4E6EE] px-3 py-2 text-sm" placeholder="Priorities, pallets due, etc." />
          </label>
          {err && <p className="text-sm rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2">{err}</p>}
        </div>
        <div className="shrink-0 px-5 py-3 border-t border-[#EEF0F4] flex justify-end gap-2 pb-[max(12px,env(safe-area-inset-bottom))]">
          <button onClick={onClose} className="h-11 px-4 rounded-xl border border-[#E4E6EE] text-sm text-gray-600">Cancel</button>
          <button onClick={save} disabled={busy || loading} className="h-11 px-5 rounded-xl text-white text-sm font-bold disabled:opacity-50" style={{ background: ACCENT }}>{busy ? 'Saving…' : wo ? 'Save targets' : 'Create work order'}</button>
        </div>
      </div>
    </div>
    </Overlay>
  )
}

/* ───────────────── Entry detail: what it posted + remove ───────────────── */
function EntryDetail({ sb, entry, wo, moves, itemName, me, canEdit, isAdmin, onClose, onChanged }: {
  sb: ReturnType<typeof createSupabaseBrowserClient>; entry: Entry; wo: WO | null; moves: Move[]; itemName: (s: string) => string; me: string
  canEdit: boolean; isAdmin: boolean; onClose: () => void; onChanged: (msg: string) => void
}) {
  const m = meta(entry.sku)
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const own = (entry.entered_by || '').toLowerCase() === me.toLowerCase() && Date.now() - new Date(entry.created_at).getTime() < 48 * 3600_000
  const canVoid = canEdit && !entry.voided_at && (isAdmin || own)
  const posted = moves.filter(x => x.ref_table === 'walmart_production_entries').sort((a, b) => num(b.qty) - num(a.qty))

  async function doVoid() {
    setErr('')
    if (!reason.trim()) { setErr('Say why this entry is being removed.'); return }
    setBusy(true)
    const { error } = await sb.rpc('walmart_void_production', { p_id: entry.id, p_reason: reason.trim() })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onChanged(`Removed ${fmtN(entry.qty)} ${m.short} — inventory put back.`)
  }

  return (
    <Overlay>
    <div className="fixed inset-0 z-[110] overflow-y-auto overscroll-contain flex flex-col sm:p-4" style={{ background: 'rgba(26,32,53,0.55)', WebkitOverflowScrolling: 'touch' }}>
      <div className="w-full sm:max-w-xl mt-auto sm:my-auto sm:mx-auto shrink-0 bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl sm:max-h-[90vh] flex flex-col overflow-hidden pb-[calc(env(safe-area-inset-bottom)+72px)] sm:pb-0">
        <div className="px-5 py-4 text-white flex items-start justify-between" style={{ background: m.color }}>
          <div>
            <p className="text-white/75 text-xs uppercase tracking-wide">Walmart production · {fmtDay(entry.production_date)}</p>
            <h2 className="text-xl font-bold">{fmtN(entry.qty)} SRP · {m.short}</h2>
            <p className="text-white/80 text-xs mt-0.5">{entry.sku} · {fmtN(num(entry.qty) * 6)} packs</p>
          </div>
          <button onClick={onClose} className="text-white/80 text-3xl leading-none px-2" aria-label="Close"><span className="sm:hidden text-sm font-semibold align-middle mr-1">Back</span>&times;</button>
        </div>
        <div className="sm:flex-1 sm:min-h-0 sm:overflow-y-auto px-5 py-4 space-y-4">
          {entry.voided_at && <p className="text-sm rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2">Removed by {nameOf(entry.voided_by)} on {new Date(entry.voided_at).toLocaleString()} — {entry.void_reason}. Inventory was put back.</p>}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-[11px] uppercase text-gray-400">Entered by</p><p className="text-gray-800">{nameOf(entry.entered_by)}</p></div>
            <div><p className="text-[11px] uppercase text-gray-400">Logged</p><p className="text-gray-800">{new Date(entry.created_at).toLocaleString()}</p></div>
            <div><p className="text-[11px] uppercase text-gray-400">Lot</p><p className="text-gray-800 font-mono text-xs">{entry.lot_number || '—'}</p></div>
            <div><p className="text-[11px] uppercase text-gray-400">Work order</p><p className="text-gray-800">{entry.work_order_id ? (wo?.id === entry.work_order_id ? wo.wo_code : 'Linked') : 'None'}</p></div>
            {entry.note && <div className="col-span-2"><p className="text-[11px] uppercase text-gray-400">Note</p><p className="text-gray-800">{entry.note}</p></div>}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">What this posted to inventory</p>
            <table className="w-full text-sm">
              <tbody>
                {posted.map(x => (
                  <tr key={x.id} className="border-t border-[#F0F2F6]">
                    <td className="py-1.5 pr-2"><span className="font-mono text-[11px] text-gray-500 mr-2">{x.sku}</span>{itemName(x.sku)}</td>
                    <td className={`py-1.5 text-right font-semibold whitespace-nowrap ${num(x.qty) > 0 ? 'text-emerald-600' : 'text-red-600'}`}>{num(x.qty) > 0 ? '+' : '−'}{fmtN(Math.abs(num(x.qty)))}</td>
                  </tr>
                ))}
                {posted.length === 0 && <tr><td className="py-2 text-gray-400">No ledger rows found.</td></tr>}
              </tbody>
            </table>
          </div>
          {canVoid && !voiding && <button onClick={() => setVoiding(true)} className="text-sm font-semibold text-red-600">Remove this entry…</button>}
          {voiding && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 space-y-2">
              <p className="text-sm text-red-800">This takes the {fmtN(entry.qty)} SRP back out of inventory and returns the parts.</p>
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (e.g. typed 40 instead of 4)" className="w-full h-11 rounded-lg border border-red-200 px-3 text-base bg-white" />
              <div className="flex gap-2">
                <button onClick={() => setVoiding(false)} className="flex-1 h-11 rounded-lg border border-[#E4E6EE] bg-white text-sm">Keep it</button>
                <button onClick={doVoid} disabled={busy} className="flex-1 h-11 rounded-lg bg-red-600 text-white text-sm font-bold disabled:opacity-50">{busy ? 'Removing…' : 'Remove entry'}</button>
              </div>
            </div>
          )}
          {err && <p className="text-sm rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2">{err}</p>}
          <div className="border-t border-[#EEF0F4] pt-3">
            <Comments recordId={entry.id} recordType="walmart_production_entry" currentUserEmail={me} title="Notes & Comments" />
          </div>
        </div>
      </div>
    </div>
    </Overlay>
  )
}


/* ───────────────── Build team: claim released POs ───────────────── */
function BuildTeam({ sb, releases, canEdit, onDone }: {
  sb: ReturnType<typeof createSupabaseBrowserClient>; releases: Release[]; canEdit: boolean; onDone: (m: string) => void
}) {
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [moveRel, setMoveRel] = useState<Release | null>(null)
  const group = (st: string) => {
    const m = new Map<string, Release[]>()
    for (const r of releases.filter(x => x.status === st)) { if (!m.has(r.walmart_order_id)) m.set(r.walmart_order_id, []); m.get(r.walmart_order_id)!.push(r) }
    return Array.from(m.entries())
  }
  const open = group('Released'), done = group('Claimed')
  async function claim(id: string, po: string) {
    setErr(''); setBusy(id)
    const { error } = await sb.rpc('walmart_claim_po', { p_walmart_order: id })
    setBusy('')
    if (error) { setErr(error.message); return }
    onDone(`✓ PO ${po} claimed — moved to Building Order; its SKUs show Completed on the Order Pipeline.`)
  }
  async function undo(r: Release) {
    const reason = window.prompt('Why undo this release?'); if (!reason) return
    const { error } = await sb.rpc('walmart_unrelease', { p_release: r.id, p_reason: reason })
    if (error) { setErr(error.message); return }
    onDone('Release undone.')
  }
  const Card = ({ id, rows, claimed }: { id: string; rows: Release[]; claimed?: boolean }) => {
    const o = rows[0].walmart_board_orders
    return (
      <div className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${claimed ? 'border-[#ECEEF3] opacity-70' : 'border-[#00a85a]/40'}`}>
        <div className="px-4 py-3 flex items-start justify-between gap-3" style={{ borderLeft: '5px solid ' + (claimed ? '#9699a6' : '#00a85a') }}>
          <div className="min-w-0">
            <p className="font-bold text-[#1A1D2E]">PO {o?.po_number || '—'}</p>
            <p className="text-[11px] text-gray-500">{o?.ship_due_date ? 'Due ' + fmtShort(o.ship_due_date) + ' · ' : ''}{claimed ? `Claimed by ${nameOf(rows[0].claimed_by)} ${rows[0].claimed_at ? new Date(rows[0].claimed_at).toLocaleString() : ''}` : `Released by ${nameOf(rows[0].released_by)} · ${new Date(rows[0].released_at).toLocaleString()}`}</p>
          </div>
          {!claimed && canEdit && <button onClick={() => claim(id, o?.po_number || '')} disabled={busy === id} className="shrink-0 h-11 px-4 rounded-xl text-white text-sm font-bold disabled:opacity-50" style={{ background: '#00a85a' }}>{busy === id ? 'Claiming…' : 'Claim'}</button>}
        </div>
        <div className="divide-y divide-[#F0F2F6]">
          {rows.map(r => (
            <div key={r.id} className="px-4 py-2 flex items-center gap-3 text-sm">
              <span className="w-2 h-6 rounded-full" style={{ background: meta(r.sku).color }} />
              <span className="flex-1"><b>{meta(r.sku).short}</b> <span className="font-mono text-[10px] text-gray-400">{r.sku}</span></span>
              <span className="font-bold">{fmtN(r.qty)} SRP</span>
              {canEdit && <button onClick={() => setMoveRel(r)} className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-[#E4E6EE] text-[#0071ce] hover:bg-[#F2F7FD]">Change PO</button>}
              {!claimed && canEdit && <button onClick={() => undo(r)} className="text-[11px] text-gray-400 hover:text-red-600">Undo</button>}
            </div>))}
        </div>
      </div>)
  }
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-[#10B981]/10 border border-[#10B981]/25 text-[12px] text-[#0f7a5a] px-3 py-2">Production released for a Walmart PO shows up here. <b>Claim</b> it when you start building — the PO moves to <b>Building Order</b> on the Walmart board and Order Pipeline, and its SKUs are marked Completed.</div>
      {err && <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">{err}</div>}
      <h2 className="font-bold text-[#1A1D2E]">Ready to claim <span className="text-gray-400 font-normal">({open.length})</span></h2>
      {open.length === 0 && <div className="bg-white rounded-xl border border-[#ECEEF3] p-6 text-center text-sm text-gray-500">Nothing released yet.</div>}
      {open.map(([id, rows]) => <Card key={id} id={id} rows={rows} />)}
      {done.length > 0 && <h2 className="font-bold text-[#1A1D2E] pt-3">Claimed — last 14 days</h2>}
      {done.map(([id, rows]) => <Card key={id} id={id} rows={rows} claimed />)}
      {moveRel && <MovePoModal sb={sb} rel={moveRel} onClose={() => setMoveRel(null)} onDone={(m) => { setMoveRel(null); onDone(m) }} />}
    </div>)
}

/* ───────────────── Safety stock WO (no POs) ───────────────── */
function SafetyModal({ sb, onClose, onSaved }: { sb: ReturnType<typeof createSupabaseBrowserClient>; onClose: () => void; onSaved: (m: string) => void }) {
  const [t, setT] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function save() {
    setErr('')
    const targets: Record<string, number> = {}
    for (const s of SKUS) { const v = (t[s.sku] || '').trim(); if (v && Number(v) > 0) targets[s.sku] = Number(v) }
    if (!Object.keys(targets).length) { setErr('Enter a quantity for at least one SKU.'); return }
    setBusy(true)
    const { error } = await sb.rpc('walmart_safety_wo_create', { p_targets: targets, p_notes: notes.trim() || null })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onSaved('✓ Safety stock work order created — it shows on this board and the Work Orders board.')
  }
  return (
    <Overlay>
    <div className="fixed inset-0 z-[110] overflow-y-auto overscroll-contain flex flex-col sm:p-4" style={{ background: 'rgba(26,32,53,0.55)', WebkitOverflowScrolling: 'touch' }}>
      <div className="w-full sm:max-w-md mt-auto sm:my-auto sm:mx-auto shrink-0 bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl sm:max-h-[90vh] flex flex-col pb-[calc(env(safe-area-inset-bottom)+72px)] sm:pb-0">
        <div className="sticky top-0 z-10 bg-white rounded-t-3xl sm:rounded-t-2xl px-5 pt-4 pb-3 border-b border-[#EEF0F4] flex items-center justify-between">
          <div><p className="text-[11px] uppercase tracking-wide text-gray-400">No POs — builds stock ahead</p><h2 className="text-lg font-bold text-[#1A1D2E]">Safety stock work order</h2></div>
          <button onClick={onClose} className="text-gray-400 text-3xl leading-none px-2" aria-label="Close"><span className="sm:hidden text-sm font-semibold align-middle mr-1">Back</span>&times;</button>
        </div>
        <div className="sm:flex-1 sm:min-h-0 sm:overflow-y-auto px-5 py-3 space-y-2">
          {SKUS.map(s => (
            <div key={s.sku} className="flex items-center gap-3 rounded-xl border border-[#ECEEF3] px-3 py-2">
              <span className="w-2.5 h-8 rounded-full" style={{ background: s.color }} />
              <span className="flex-1 text-sm"><b>{s.short}</b> <span className="font-mono text-[10px] text-gray-400">{s.sku}</span></span>
              <input inputMode="numeric" value={t[s.sku] || ''} placeholder="0" onChange={e => setT(x => ({ ...x, [s.sku]: e.target.value.replace(/[^\d]/g, '') }))} className="w-24 h-10 rounded-lg border border-[#E4E6EE] text-right px-2 font-bold" />
            </div>))}
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Reason / notes" className="w-full rounded-xl border border-[#E4E6EE] px-3 py-2 text-sm" />
          {err && <p className="text-sm rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2">{err}</p>}
        </div>
        <div className="shrink-0 px-5 py-3 border-t border-[#EEF0F4]"><button onClick={save} disabled={busy} className="w-full h-12 rounded-2xl text-white font-bold disabled:opacity-50" style={{ background: ACCENT }}>{busy ? 'Creating…' : 'Create safety stock WO'}</button></div>
      </div>
    </div>
    </Overlay>)
}


/* ───────────────── Pick-up schedule (loads → POs → SKUs) ───────────────── */
function PickupSchedule({ plan, canEdit, onManage }: { plan: PlanGroup[]; canEdit: boolean; onManage: () => void }) {
  const [open, setOpen] = useState(true)
  const lineQ = (o: WoOrder, sku: string) => (o.walmart_board_lines || []).filter(l => normSku(l.part_number) === sku).reduce((a, l) => a + num(l.qty), 0)
  const srpOf = (o: WoOrder) => (o.walmart_board_lines || []).filter(l => SKU_SET.has(normSku(l.part_number))).reduce((a, l) => a + num(l.qty), 0)
  const grand: Record<string, number> = {}
  let gSrp = 0, gPlt = 0
  const cell = (st?: string) => st === 'done' ? 'bg-emerald-50 text-emerald-700' : st === 'covered' ? 'bg-sky-50 text-sky-700' : st === 'partial' ? 'bg-amber-50 text-amber-800' : st === 'open' ? 'text-[#1A1D2E]' : ''
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-[#ECEEF3] mb-4 overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between gap-2" style={{ borderLeft: '5px solid #e2445c' }}>
        <button onClick={() => setOpen(o => !o)} data-ro-ok className="min-w-0 text-left">
          <p className="text-[11px] uppercase tracking-wide text-gray-400">Pick-up schedule · finish in this order</p>
          <p className="font-bold text-[#1A1D2E]">🚚 {plan.filter(g => g.load).length} load{plan.filter(g => g.load).length === 1 ? '' : 's'}{plan.some(g => !g.load) ? ` · ${plan.find(g => !g.load)!.orders.length} PO not on a load` : ''} <span className="text-gray-400 font-normal text-sm">{open ? '▾' : '▸'}</span></p>
        </button>
        {canEdit && <button onClick={onManage} className="shrink-0 text-sm font-semibold rounded-xl px-3 py-2 border border-[#e2445c] text-[#e2445c]">Loads &amp; POs</button>}
      </div>
      {open && (plan.length === 0 ? <p className="px-4 pb-4 text-sm text-gray-500">No POs on this work order yet.</p> : (
        <div className="overflow-x-auto border-t border-[#F0F2F6]">
          <table className="w-full text-[12px] whitespace-nowrap">
            <thead className="bg-[#F7F8FB] text-gray-500">
              <tr>
                <th className="text-left font-semibold px-3 py-2">Priority</th>
                <th className="text-left font-semibold px-2 py-2">PO</th>
                {PICK_COLS.map(c => <th key={c} className="text-right font-semibold px-2 py-2" style={{ color: meta(c).color }}>{c.slice(4)}</th>)}
                <th className="text-right font-semibold px-2 py-2">SRP</th>
                <th className="text-right font-semibold px-2 py-2">Units</th>
                <th className="text-right font-semibold px-3 py-2">PLT</th>
              </tr>
            </thead>
            <tbody>
              {plan.map(g => {
                const tot: Record<string, number> = {}
                let tSrp = 0, tPlt = 0
                const todo = Object.values(g.bySku).reduce((a, b) => a + Math.max(b.need - b.done - b.covered, 0), 0)
                return [
                  <tr key={g.key + '-h'} className="border-t-2 border-[#E4E6EE]" style={{ background: prioColor(g.rank) + '14' }}>
                    <td colSpan={PICK_COLS.length + 5} className="px-3 py-1.5">
                      <span className="font-bold text-white rounded px-1.5 py-0.5 mr-2" style={{ background: prioColor(g.rank) }}>{g.rank ? 'Priority ' + g.rank : 'Not assigned'}</span>
                      {g.load ? <><b>Load {g.load.load_number}</b><span className="text-gray-500"> · PU {g.load.pickup_date ? fmtDay(g.load.pickup_date) : <i>no date</i>}</span></> : <span className="text-gray-500">PNDG — needs a load &amp; pick-up date</span>}
                      <span className={`ml-2 font-semibold ${todo ? 'text-[#e2445c]' : 'text-[#00a85a]'}`}>{todo ? `${fmtN(todo)} SRP still to make` : '✓ all covered'}</span>
                    </td>
                  </tr>,
                  ...g.orders.map(o => {
                    const srp = srpOf(o), plt = num(o.pallets)
                    tSrp += srp; tPlt += plt
                    const built = (o.group_name || 'Walmart Orders') !== 'Walmart Orders'
                    return (
                      <tr key={o.id} className="border-t border-[#F0F2F6]">
                        <td className="px-3 py-1.5 text-gray-400">{built ? <span className="text-emerald-700 font-semibold">{o.group_name}</span> : ''}</td>
                        <td className="px-2 py-1.5 font-mono">{o.po_number}</td>
                        {PICK_COLS.map(c => { const q = lineQ(o, c); if (q) tot[c] = (tot[c] || 0) + q; return <td key={c} className={`text-right px-2 py-1.5 ${cell(q ? g.orderSku[o.id]?.[c] : undefined)}`}>{q ? fmtN(q) : ''}</td> })}
                        <td className="text-right px-2 py-1.5 font-semibold">{fmtN(srp)}</td>
                        <td className="text-right px-2 py-1.5 text-gray-500">{fmtN(srp * 6)}</td>
                        <td className="text-right px-3 py-1.5 text-gray-500">{plt || ''}</td>
                      </tr>)
                  }),
                  (() => { for (const c of PICK_COLS) grand[c] = (grand[c] || 0) + (tot[c] || 0); gSrp += tSrp; gPlt += tPlt
                    return <tr key={g.key + '-t'} className="border-t border-[#E4E6EE] bg-[#FAFBFD] font-semibold">
                      <td className="px-3 py-1.5" colSpan={2}>{g.load ? g.load.load_number : 'Not assigned'} total</td>
                      {PICK_COLS.map(c => <td key={c} className="text-right px-2 py-1.5">{tot[c] ? fmtN(tot[c]) : ''}</td>)}
                      <td className="text-right px-2 py-1.5">{fmtN(tSrp)}</td><td className="text-right px-2 py-1.5">{fmtN(tSrp * 6)}</td><td className="text-right px-3 py-1.5">{tPlt || ''}</td>
                    </tr> })(),
                ]
              })}
              <tr className="border-t-2 border-[#1A1D2E] font-bold">
                <td className="px-3 py-2" colSpan={2}>Grand total</td>
                {PICK_COLS.map(c => <td key={c} className="text-right px-2 py-2">{grand[c] ? fmtN(grand[c]) : ''}</td>)}
                <td className="text-right px-2 py-2">{fmtN(gSrp)}</td><td className="text-right px-2 py-2">{fmtN(gSrp * 6)}</td><td className="text-right px-3 py-2">{gPlt || ''}</td>
              </tr>
            </tbody>
          </table>
          <p className="px-3 py-2 text-[11px] text-gray-500 border-t border-[#F0F2F6]">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-100 align-middle mr-1" />released / building
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-sky-100 align-middle ml-3 mr-1" />made, waiting to release
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-100 align-middle ml-3 mr-1" />partly made / partly released
            <span className="ml-3">plain = still to make</span>
          </p>
        </div>
      ))}
    </div>)
}

/* ───────────────── Loads & POs: create loads, set pick-up date/priority, assign POs ───────────────── */
function LoadsModal({ sb, loads, orders, rankByOrder, onClose, onChanged }: {
  sb: ReturnType<typeof createSupabaseBrowserClient>; loads: Load[]; orders: WoOrder[]; rankByOrder: Record<string, { rank: number; label: string }>
  onClose: () => void; onChanged: () => void
}) {
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [edit, setEdit] = useState<Record<string, { load_number: string; pickup_date: string; priority: string }>>({})
  const [nl, setNl] = useState({ load_number: '', pickup_date: '', priority: '' })
  const used = new Set(orders.map(o => (o.load_number || '').trim()))
  const shown = loads.filter(l => used.has(l.load_number) || l.status === 'Open').sort((a, b) => (a.pickup_date || '9999').localeCompare(b.pickup_date || '9999') || (a.priority ?? 999) - (b.priority ?? 999))
  const val = (l: Load) => edit[l.id] || { load_number: l.load_number, pickup_date: l.pickup_date || '', priority: l.priority ? String(l.priority) : '' }
  const set = (l: Load, k: string, v: string) => setEdit(e => ({ ...e, [l.id]: { ...val(l), [k]: v } }))
  async function run(key: string, fn: () => Promise<{ error: any }>) {
    setErr(''); setBusy(key)
    const { error } = await fn()
    setBusy('')
    if (error) { setErr(error.message); return false }
    onChanged(); return true
  }
  const saveLoad = (l: Load) => { const v = val(l); return run(l.id, () => sb.rpc('walmart_load_save', { p_load_number: v.load_number, p_pickup_date: v.pickup_date || null, p_priority: v.priority ? Number(v.priority) : null, p_notes: null, p_id: l.id }) as any).then(ok => { if (ok) setEdit(e => { const n = { ...e }; delete n[l.id]; return n }) }) }
  const addLoad = () => run('new', () => sb.rpc('walmart_load_save', { p_load_number: nl.load_number, p_pickup_date: nl.pickup_date || null, p_priority: nl.priority ? Number(nl.priority) : null, p_notes: null, p_id: null }) as any).then(ok => { if (ok) setNl({ load_number: '', pickup_date: '', priority: '' }) })
  const delLoad = (l: Load) => { if (window.confirm(`Delete load ${l.load_number}? Its POs go back to "Not assigned".`)) run(l.id, () => sb.rpc('walmart_load_delete', { p_id: l.id }) as any) }
  const assign = (o: WoOrder, loadId: string) => run(o.id, () => sb.rpc('walmart_load_assign', { p_orders: [o.id], p_load: loadId || null }) as any)
  const loadIdOf = (o: WoOrder) => loads.find(l => l.load_number === (o.load_number || '').trim())?.id || ''
  const srpOf = (o: WoOrder) => (o.walmart_board_lines || []).filter(l => SKU_SET.has(normSku(l.part_number))).reduce((a, l) => a + num(l.qty), 0)
  const sorted = [...orders].sort((a, b) => ((rankByOrder[a.id]?.rank || 999) - (rankByOrder[b.id]?.rank || 999)) || String(a.po_number).localeCompare(String(b.po_number)))
  const inp = 'h-10 rounded-lg border border-[#E4E6EE] px-2 text-sm bg-white'
  return (
    <Overlay>
    <div className="fixed inset-0 z-[110] overflow-y-auto overscroll-contain flex flex-col sm:p-4" style={{ background: 'rgba(26,32,53,0.55)', WebkitOverflowScrolling: 'touch' }}>
      <div className="w-full sm:max-w-3xl mt-auto sm:my-auto sm:mx-auto shrink-0 bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col pb-[calc(env(safe-area-inset-bottom)+72px)] sm:pb-0">
        <div className="sticky top-0 z-10 bg-white rounded-t-3xl sm:rounded-t-2xl px-5 pt-4 pb-3 border-b border-[#EEF0F4] flex items-center justify-between">
          <div><p className="text-[11px] uppercase tracking-wide text-gray-400">Earliest pick-up is made first · same date → lower priority # first</p><h2 className="text-lg font-bold text-[#1A1D2E]">Loads &amp; pick-up dates</h2></div>
          <button onClick={onClose} className="text-gray-400 text-3xl leading-none px-2" aria-label="Close"><span className="sm:hidden text-sm font-semibold align-middle mr-1">Back</span>&times;</button>
        </div>
        <div className="px-5 py-4 space-y-5">
          {err && <p className="text-sm rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2">{err}</p>}
          <section>
            <h3 className="text-sm font-bold text-[#1A1D2E] mb-2">Loads</h3>
            <div className="space-y-2">
              {shown.map(l => { const v = val(l), dirty = !!edit[l.id], n = orders.filter(o => (o.load_number || '').trim() === l.load_number).length
                return (
                  <div key={l.id} className="rounded-xl border border-[#ECEEF3] p-2.5 flex flex-wrap items-end gap-2">
                    <label className="flex-1 min-w-[120px]"><span className="block text-[11px] text-gray-500">Load #</span><input value={v.load_number} onChange={e => set(l, 'load_number', e.target.value)} className={inp + ' w-full font-mono'} /></label>
                    <label><span className="block text-[11px] text-gray-500">Pick-up date</span><input type="date" value={v.pickup_date} onChange={e => set(l, 'pickup_date', e.target.value)} className={inp} /></label>
                    <label><span className="block text-[11px] text-gray-500">Priority</span><input inputMode="numeric" value={v.priority} placeholder="—" onChange={e => set(l, 'priority', e.target.value.replace(/[^\d]/g, ''))} className={inp + ' w-16 text-center'} /></label>
                    <span className="text-[11px] text-gray-500 pb-2.5">{n} PO{n === 1 ? '' : 's'}</span>
                    <div className="flex gap-1.5 ml-auto">
                      {dirty && <button onClick={() => saveLoad(l)} disabled={busy === l.id} className="h-10 px-3 rounded-lg text-white text-sm font-semibold disabled:opacity-50" style={{ background: ACCENT }}>{busy === l.id ? '…' : 'Save'}</button>}
                      <button onClick={() => delLoad(l)} className="h-10 px-3 rounded-lg text-sm text-gray-400 hover:text-red-600 border border-[#ECEEF3]">Delete</button>
                    </div>
                  </div>)
              })}
              <div className="rounded-xl border-2 border-dashed border-[#DCE0EA] p-2.5 flex flex-wrap items-end gap-2">
                <label className="flex-1 min-w-[120px]"><span className="block text-[11px] text-gray-500">New load #</span><input value={nl.load_number} onChange={e => setNl(x => ({ ...x, load_number: e.target.value }))} placeholder="e.g. 46721131" className={inp + ' w-full font-mono'} /></label>
                <label><span className="block text-[11px] text-gray-500">Pick-up date</span><input type="date" value={nl.pickup_date} onChange={e => setNl(x => ({ ...x, pickup_date: e.target.value }))} className={inp} /></label>
                <label><span className="block text-[11px] text-gray-500">Priority</span><input inputMode="numeric" value={nl.priority} placeholder="—" onChange={e => setNl(x => ({ ...x, priority: e.target.value.replace(/[^\d]/g, '') }))} className={inp + ' w-16 text-center'} /></label>
                <button onClick={addLoad} disabled={busy === 'new' || !nl.load_number.trim()} className="ml-auto h-10 px-4 rounded-lg text-white text-sm font-semibold disabled:opacity-40" style={{ background: '#e2445c' }}>+ Add load</button>
              </div>
            </div>
          </section>
          <section>
            <h3 className="text-sm font-bold text-[#1A1D2E] mb-2">POs on this work order</h3>
            <div className="rounded-xl border border-[#ECEEF3] divide-y divide-[#F0F2F6]">
              {sorted.map(o => {
                const r = rankByOrder[o.id]
                return (
                  <div key={o.id} className="px-3 py-2 flex flex-wrap items-center gap-2">
                    <span className="shrink-0 text-[11px] font-bold text-white rounded px-1.5 py-0.5" style={{ background: prioColor(r?.rank || 0) }}>{r?.rank ? 'P' + r.rank : '—'}</span>
                    <span className="font-mono text-sm">{o.po_number}</span>
                    <span className="text-[11px] text-gray-500 flex-1 min-w-[140px] truncate">{fmtN(srpOf(o))} SRP · {(o.walmart_board_lines || []).filter(l => num(l.qty) > 0 && SKU_SET.has(normSku(l.part_number))).map(l => meta(normSku(l.part_number)).short).join(', ')}{(o.group_name || 'Walmart Orders') !== 'Walmart Orders' ? ` · ${o.group_name}` : ''}</span>
                    <select value={loadIdOf(o)} disabled={busy === o.id || o.status === 'Shipped'} onChange={e => assign(o, e.target.value)} className={inp + ' min-w-[170px]'}>
                      <option value="">Not assigned (PNDG)</option>
                      {shown.map(l => <option key={l.id} value={l.id}>{l.load_number}{l.pickup_date ? ' · PU ' + fmtShort(l.pickup_date) : ''}</option>)}
                    </select>
                  </div>)
              })}
            </div>
            <p className="text-[11px] text-gray-500 mt-2">Assigning a PO sets its Load ID and ship date on the Walmart board and the Order Pipeline, so the Master BOL groups it automatically.</p>
          </section>
        </div>
      </div>
    </div>
    </Overlay>)
}


/* ───────────────── Move a release (released or claimed) to a different PO ───────────────── */
function MovePoModal({ sb, rel, onClose, onDone }: { sb: ReturnType<typeof createSupabaseBrowserClient>; rel: Release; onClose: () => void; onDone: (m: string) => void }) {
  const [opts, setOpts] = useState<{ id: string; po: string | null; group: string; load: string | null; line: number; released: number; left: number }[] | null>(null)
  const [pick, setPick] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    (async () => {
      const { data, error } = await sb.from('walmart_board_orders').select('id,po_number,group_name,load_number,archived,walmart_board_lines(part_number,qty)')
        .eq('archived', false).in('group_name', ['Walmart Orders', 'Building Order'])
      if (error) { setErr(error.message); setOpts([]); return }
      const os = ((data as any[]) || []).map(o => ({ o, line: (o.walmart_board_lines || []).filter((l: any) => normSku(l.part_number) === rel.sku).reduce((a: number, l: any) => a + num(l.qty), 0) })).filter(x => x.line > 0)
      const ids = os.map(x => x.o.id)
      const relBy: Record<string, number> = {}
      if (ids.length) {
        const { data: rs } = await sb.from('walmart_releases').select('walmart_order_id,qty').eq('sku', rel.sku).in('status', ['Released', 'Claimed']).in('walmart_order_id', ids)
        for (const r of (rs as any[]) || []) relBy[r.walmart_order_id] = (relBy[r.walmart_order_id] || 0) + num(r.qty)
      }
      setOpts(os.map(x => ({ id: x.o.id, po: x.o.po_number, group: x.o.group_name || 'Walmart Orders', load: isRealLoad(x.o.load_number) ? x.o.load_number : null, line: x.line, released: relBy[x.o.id] || 0, left: Math.max(0, x.line - (relBy[x.o.id] || 0)) }))
        .sort((a, b) => (b.left > 0 ? 1 : 0) - (a.left > 0 ? 1 : 0) || String(a.po).localeCompare(String(b.po))))
    })()
  }, [sb, rel.sku])
  const target = opts?.find(o => o.id === pick)
  const moving = target ? Math.min(num(rel.qty), target.left) : 0
  async function go() {
    setErr('')
    if (!target) { setErr('Pick the PO this production belongs to.'); return }
    setBusy(true)
    const { data, error } = await sb.rpc('walmart_reassign_release', { p_release: rel.id, p_new_order: target.id, p_reason: reason.trim() || null })
    setBusy(false)
    if (error) { setErr(error.message); return }
    const d = data as any
    onDone(`✓ Moved ${fmtN(d.moved)} ${meta(d.sku).short} from PO ${d.from} to PO ${d.to}.` + (d.kept > 0 ? ` ${fmtN(d.kept)} stays on PO ${d.from} (PO ${d.to} only needed ${fmtN(d.moved)}).` : '') + (d.old_back_to_orders ? ` PO ${d.from} went back to Walmart Orders.` : '') + (d.new_to_building ? ` PO ${d.to} moved to Building Order.` : ''))
  }
  const from = rel.walmart_board_orders?.po_number || '—'
  return (
    <Overlay>
    <div className="fixed inset-0 z-[110] overflow-y-auto overscroll-contain flex flex-col sm:p-4" style={{ background: 'rgba(26,32,53,0.55)', WebkitOverflowScrolling: 'touch' }}>
      <div className="w-full sm:max-w-lg mt-auto sm:my-auto sm:mx-auto shrink-0 bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col pb-[calc(env(safe-area-inset-bottom)+72px)] sm:pb-0">
        <div className="sticky top-0 z-10 bg-white rounded-t-3xl sm:rounded-t-2xl px-5 pt-4 pb-3 border-b border-[#EEF0F4] flex items-center justify-between">
          <div><p className="text-[11px] uppercase tracking-wide text-gray-400">{rel.status === 'Claimed' ? 'Claimed' : 'Released'} · {fmtN(rel.qty)} SRP {meta(rel.sku).short}</p><h2 className="text-lg font-bold text-[#1A1D2E]">Change PO {from} → ?</h2></div>
          <button onClick={onClose} className="text-gray-400 text-3xl leading-none px-2" aria-label="Close"><span className="sm:hidden text-sm font-semibold align-middle mr-1">Back</span>&times;</button>
        </div>
        <div className="px-5 py-4 space-y-3">
          {opts === null ? <p className="text-sm text-gray-400">Loading POs…</p> : (
            <div className="rounded-xl border border-[#ECEEF3] divide-y divide-[#F0F2F6] max-h-[50vh] overflow-y-auto">
              {opts.length === 0 && <p className="px-3 py-3 text-sm text-gray-500">No other open PO has a {meta(rel.sku).short} line.</p>}
              {opts.map(o => { const cur = o.id === rel.walmart_order_id, dis = cur || o.left <= 0
                return (
                  <label key={o.id} className={`flex items-center gap-3 px-3 py-2.5 text-sm ${dis ? 'opacity-45' : 'cursor-pointer hover:bg-[#F7F9FC]'}`}>
                    <input type="radio" name="newpo" disabled={dis} checked={pick === o.id} onChange={() => setPick(o.id)} className="w-4 h-4" />
                    <span className="flex-1 min-w-0">
                      <span className="font-mono font-semibold">PO {o.po}</span>{cur && <span className="ml-1 text-[11px] text-gray-500">(current)</span>}
                      <span className="block text-[11px] text-gray-500">{o.group}{o.load ? ` · Load ${o.load}` : ' · no load'} · line {fmtN(o.line)}, released {fmtN(o.released)}</span>
                    </span>
                    <span className={`text-xs font-semibold ${o.left > 0 ? 'text-[#1A1D2E]' : 'text-gray-400'}`}>{o.left > 0 ? `needs ${fmtN(o.left)}` : 'full'}</span>
                  </label>)
              })}
            </div>
          )}
          {target && <p className="text-xs rounded-lg bg-sky-50 border border-sky-200 text-sky-900 px-3 py-2">Moves <b>{fmtN(moving)}</b> SRP to PO {target.po}{moving < num(rel.qty) ? `; ${fmtN(num(rel.qty) - moving)} stays on PO ${from}` : ''}.{rel.status === 'Claimed' ? ' Done quantities on both POs update.' : ''}</p>}
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (e.g. released to wrong PO, load booked)" className="w-full h-11 rounded-xl border border-[#E4E6EE] px-3 text-sm" />
          {err && <p className="text-sm rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2">{err}</p>}
        </div>
        <div className="shrink-0 px-5 py-3 border-t border-[#EEF0F4] flex justify-end gap-2">
          <button onClick={onClose} className="h-11 px-4 rounded-xl border border-[#E4E6EE] text-sm text-gray-600">Cancel</button>
          <button onClick={go} disabled={busy || !target} className="h-11 px-5 rounded-xl text-white text-sm font-bold disabled:opacity-40" style={{ background: ACCENT }}>{busy ? 'Moving…' : 'Move to new PO'}</button>
        </div>
      </div>
    </div>
    </Overlay>)
}


/* ───────────────── Machine plan: which molding machine runs which mold, per day ───────────────── */
const pieceName = (k: string) => PIECES.find(x => x.sku === k)?.name || k
function piecesFor(skuQty: Record<string, number>, bomPcs: Record<string, Record<string, number>>) {
  const out: Record<string, number> = {}
  for (const [sku, q] of Object.entries(skuQty)) for (const [pc, per] of Object.entries(bomPcs[sku] || {})) out[pc] = (out[pc] || 0) + Math.max(0, q) * per
  return out
}
function MachinePlan({ sb, wo, week, today, canEdit, progBySku, plan, runs, machs, bomPcs, onSaved }: {
  sb: ReturnType<typeof createSupabaseBrowserClient>; wo: WO; week: string; today: string; canEdit: boolean
  progBySku: Record<string, Prog>; plan: PlanGroup[]; runs: MRun[]; machs: Mach[]; bomPcs: Record<string, Record<string, number>>; onSaved: (m: string) => void
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i))
  const linked = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('week') : null   // Daily Plan deep link carries the day
  const [day, setDay] = useState(linked && days.includes(linked) ? linked : days.includes(today) ? today : week)
  useEffect(() => { setDay(d => days.includes(d) ? d : (linked && days.includes(linked) ? linked : days.includes(today) ? today : week)) }, [week]) // eslint-disable-line
  const [open, setOpen] = useState(false)
  const left: Record<string, number> = {}
  for (const s of SKUS) { const p = progBySku[s.sku]; if (p) left[s.sku] = Math.max(num(p.target_qty) - num(p.made_qty), 0) }
  const p1 = plan.find(g => g.rank === 1)
  const p1Left: Record<string, number> = {}
  if (p1) for (const [sku, b] of Object.entries(p1.bySku)) p1Left[sku] = Math.max(b.need - b.done - b.covered, 0)
  const needWo = piecesFor(left, bomPcs), needP1 = piecesFor(p1Left, bomPcs)
  const dayRuns = runs.filter(r => r.run_date === day)
  const planned: Record<string, number> = {}
  for (const r of dayRuns) planned[r.piece] = (planned[r.piece] || 0) + num(r.target_pcs)
  const mcode = (id: string) => machs.find(m => m.id === id)?.machine_code || '—'
  const [copied, setCopied] = useState(false)
  async function copyDay() {
    const { data: pl } = await sb.from('production_day_plans').select('id,share_token').eq('plan_date', day).maybeSingle()
    if (!pl) { alert(`No Daily Plan for ${fmtDay(day)} yet — plan the machines first.`); return }
    const { data: ln } = await sb.from('production_plan_lines').select('machine_code,product,operator,status').eq('plan_id', (pl as any).id)
    const ok = await copyText(planSnippet(day, (ln as any[]) || [], `${window.location.origin}/dp/${(pl as any).share_token}`))
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2500) } else alert('Could not copy on this device.')
  }
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-[#ECEEF3] mb-4 overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between gap-2" style={{ borderLeft: '5px solid #784bd1' }}>
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-gray-400">Machine plan · molds per day</p>
          <p className="font-bold text-[#1A1D2E]">{dayRuns.length ? `${dayRuns.length} machine${dayRuns.length === 1 ? '' : 's'} on ${fmtDay(day)}` : `Nothing planned for ${fmtDay(day)}`}</p>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button data-ro-ok onClick={copyDay} className="text-sm font-semibold rounded-xl px-3 py-2 bg-[#25D366] text-white" title="Copy the whole day's plan (all machines) + operator link for WhatsApp">{copied ? 'Copied ✓' : 'Copy for WhatsApp'}</button>
          {canEdit && <button onClick={() => setOpen(true)} className="text-sm font-semibold rounded-xl px-3 py-2 border border-[#784bd1] text-[#784bd1]">{dayRuns.length ? 'Edit machines' : 'Plan machines'}</button>}
        </div>
      </div>
      <div className="flex gap-1 px-3 pb-2 overflow-x-auto">
        {days.map(d => { const n = runs.filter(r => r.run_date === d).length
          return <button key={d} data-ro-ok onClick={() => setDay(d)} className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold border ${d === day ? 'bg-[#784bd1] text-white border-[#784bd1]' : 'bg-white text-gray-600 border-[#E4E6EE]'}`}>{fmtDay(d).split(',')[0]} {d.slice(8)}{n ? <span className="ml-1 opacity-80">· {n}</span> : null}{d === today ? ' •' : ''}</button> })}
      </div>
      <div className="grid grid-cols-3 gap-2 px-3 pb-3">
        {PIECES.map(pc => { const need = needWo[pc.sku] || 0, pl = planned[pc.sku] || 0
          return (
            <div key={pc.sku} className="rounded-xl border border-[#ECEEF3] p-2.5" style={{ borderTop: '4px solid ' + pc.color }}>
              <p className="text-xs font-bold text-[#1A1D2E]">{pc.name}s <span className="font-mono text-[10px] text-gray-400">{pc.sku}</span></p>
              <p className="text-[11px] text-gray-500 mt-1">WO still needs <b className="text-[#1A1D2E]">{fmtN(need)}</b></p>
              {p1 && <p className="text-[11px] text-gray-500">P1 load needs <b className="text-[#e2445c]">{fmtN(needP1[pc.sku] || 0)}</b></p>}
              <p className="text-[11px] text-gray-500">Planned {fmtDay(day).split(',')[0]} <b style={{ color: pl ? pc.color : undefined }}>{fmtN(pl)}</b></p>
            </div>)
        })}
      </div>
      {dayRuns.length > 0 && (
        <div className="border-t border-[#F0F2F6] divide-y divide-[#F0F2F6]">
          {dayRuns.sort((a, b) => mcode(a.machine_id).localeCompare(mcode(b.machine_id), undefined, { numeric: true })).map(r => (
            <div key={r.id} className="px-4 py-2 flex items-center gap-3 text-sm">
              <span className="font-bold w-14">{mcode(r.machine_id)}</span>
              <span className="text-[11px] font-semibold text-white rounded px-1.5 py-0.5" style={{ background: PIECES.find(x => x.sku === r.piece)?.color }}>{pieceName(r.piece)} mold</span>
              <span className="flex-1 min-w-0 truncate text-xs text-gray-500">{r.skus?.length ? 'for ' + r.skus.map(k => meta(k).short).join(', ') : ''}{r.operator ? ` · ${r.operator}` : ''}</span>
              <span className="text-xs font-semibold">{fmtN(r.target_pcs)} pcs{r.hours ? ` · ${fmtN(r.hours)} h` : ''}</span>
            </div>))}
          <p className="px-4 py-2 text-[11px] text-gray-400">Also on the Daily Plan for {fmtDay(day)} — the operator link and WhatsApp send include these machines.</p>
        </div>
      )}
      {open && <MachinePlanModal sb={sb} wo={wo} day={day} runs={dayRuns} machs={machs} bomPcs={bomPcs} needWo={needWo} needP1={needP1} left={left} onClose={() => setOpen(false)} onSaved={(m) => { setOpen(false); onSaved(m) }} />}
    </div>)
}

function MachinePlanModal({ sb, wo, day, runs, machs, bomPcs, needWo, needP1, left, onClose, onSaved }: {
  sb: ReturnType<typeof createSupabaseBrowserClient>; wo: WO; day: string; runs: MRun[]; machs: Mach[]; bomPcs: Record<string, Record<string, number>>
  needWo: Record<string, number>; needP1: Record<string, number>; left: Record<string, number>; onClose: () => void; onSaved: (m: string) => void
}) {
  type Row = { on: boolean; piece: string; skus: string[]; hours: string; target: string; touched: boolean; operator: string }
  const [rows, setRows] = useState<Record<string, Row>>(() => {
    const m: Record<string, Row> = {}
    for (const mc of machs) { const r = runs.find(x => x.machine_id === mc.id)
      m[mc.id] = r ? { on: true, piece: r.piece, skus: r.skus || [], hours: r.hours != null ? String(r.hours) : '24', target: r.target_pcs != null ? String(r.target_pcs) : '', touched: true, operator: r.operator || '' }
                   : { on: false, piece: '', skus: [], hours: '24', target: '', touched: false, operator: '' } }
    return m
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (id: string, patch: Partial<Row>) => setRows(r => ({ ...r, [id]: { ...r[id], ...patch } }))
  const auto = (mc: Mach, row: Row) => Math.round(mc.oph * (Number(row.hours) || 0))
  const tgt = (mc: Mach, row: Row) => row.touched ? (Number(row.target) || 0) : auto(mc, row)
  const skusFor = (piece: string) => SKUS.filter(s => (bomPcs[s.sku] || {})[piece] && (left[s.sku] || 0) > 0)
  const planned: Record<string, number> = {}
  for (const mc of machs) { const r = rows[mc.id]; if (r?.on && r.piece) planned[r.piece] = (planned[r.piece] || 0) + tgt(mc, r) }
  async function save() {
    setErr('')
    const sel = machs.filter(mc => rows[mc.id]?.on)
    const bad = sel.find(mc => !rows[mc.id].piece)
    if (bad) { setErr(`Pick the mold for ${bad.machine_code}.`); return }
    const payload = sel.map(mc => { const r = rows[mc.id]; return { machine_id: mc.id, piece: r.piece, skus: r.skus, hours: Number(r.hours) || null, target_pcs: tgt(mc, r) || null, operator: r.operator.trim() || null } })
    setBusy(true)
    const { error } = await sb.rpc('walmart_machine_plan_save', { p_date: day, p_wo: wo.id, p_runs: payload })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onSaved(`✓ Machine plan saved for ${fmtDay(day)} — ${payload.length} machine${payload.length === 1 ? '' : 's'}${payload.length ? ': ' + sel.map(m => `${m.machine_code} ${pieceName(rows[m.id].piece)}`).join(', ') : ''}. It's on the Daily Plan too.`)
  }
  return (
    <Overlay>
    <div className="fixed inset-0 z-[110] overflow-y-auto overscroll-contain flex flex-col sm:p-4" style={{ background: 'rgba(26,32,53,0.55)', WebkitOverflowScrolling: 'touch' }}>
      <div className="w-full sm:max-w-3xl mt-auto sm:my-auto sm:mx-auto shrink-0 bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col pb-[calc(env(safe-area-inset-bottom)+72px)] sm:pb-0">
        <div className="sticky top-0 z-10 bg-white rounded-t-3xl sm:rounded-t-2xl px-5 pt-4 pb-3 border-b border-[#EEF0F4] flex items-center justify-between">
          <div><p className="text-[11px] uppercase tracking-wide text-gray-400">{wo.wo_code} · tick the machines running and their mold</p><h2 className="text-lg font-bold text-[#1A1D2E]">Machine plan · {fmtDay(day)}</h2></div>
          <button onClick={onClose} className="text-gray-400 text-3xl leading-none px-2" aria-label="Close"><span className="sm:hidden text-sm font-semibold align-middle mr-1">Back</span>&times;</button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {PIECES.map(pc => { const pl = planned[pc.sku] || 0, need = needWo[pc.sku] || 0
              return (
                <div key={pc.sku} className="rounded-xl border border-[#ECEEF3] p-2.5" style={{ borderTop: '4px solid ' + pc.color }}>
                  <p className="text-xs font-bold">{pc.name}s</p>
                  <p className="text-[11px] text-gray-500">Planned <b className="text-[#1A1D2E]">{fmtN(pl)}</b> / WO needs {fmtN(need)}</p>
                  {needP1[pc.sku] ? <p className="text-[11px] text-gray-500">P1 load needs {fmtN(needP1[pc.sku])}</p> : null}
                  <div className="h-1.5 rounded-full bg-[#EEF0F4] mt-1 overflow-hidden"><div className="h-full" style={{ width: `${need ? Math.min(100, pl / need * 100) : 0}%`, background: pc.color }} /></div>
                </div>)
            })}
          </div>
          <div className="rounded-xl border border-[#ECEEF3] divide-y divide-[#F0F2F6]">
            {machs.length === 0 && <p className="px-3 py-3 text-sm text-gray-500">No active molding machines found.</p>}
            {machs.map(mc => { const r = rows[mc.id]; if (!r) return null
              return (
                <div key={mc.id} className={`px-3 py-2.5 ${r.on ? 'bg-[#FAF8FF]' : ''}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 w-28 shrink-0 cursor-pointer">
                      <input type="checkbox" className="w-4 h-4" checked={r.on} onChange={e => set(mc.id, { on: e.target.checked })} />
                      <span className="font-bold text-sm">{mc.machine_code}</span>
                    </label>
                    <span className="text-[11px] text-gray-400 w-24">{mc.oph ? `${fmtN(mc.oph)} pcs/h` : 'no rate'}</span>
                    {r.on && <>
                      <div className="flex gap-1">{PIECES.map(pc => <button key={pc.sku} type="button" onClick={() => set(mc.id, { piece: pc.sku, skus: skusFor(pc.sku).map(s => s.sku) })} className={`h-9 px-3 rounded-lg text-xs font-semibold border ${r.piece === pc.sku ? 'text-white' : 'text-gray-600 bg-white border-[#E4E6EE]'}`} style={r.piece === pc.sku ? { background: pc.color, borderColor: pc.color } : undefined}>{pc.name}</button>)}</div>
                      <label className="flex items-center gap-1 text-[11px] text-gray-500">h<input inputMode="decimal" value={r.hours} onChange={e => set(mc.id, { hours: e.target.value.replace(/[^\d.]/g, '') })} className="w-12 h-9 rounded-lg border border-[#E4E6EE] text-center text-sm" /></label>
                      <label className="flex items-center gap-1 text-[11px] text-gray-500">pcs<input inputMode="numeric" value={r.touched ? r.target : String(auto(mc, r))} onChange={e => set(mc.id, { target: e.target.value.replace(/[^\d]/g, ''), touched: true })} className="w-24 h-9 rounded-lg border border-[#E4E6EE] text-right px-2 text-sm font-semibold" /></label>
                      <input value={r.operator} onChange={e => set(mc.id, { operator: e.target.value })} placeholder="Operator" className="w-28 h-9 rounded-lg border border-[#E4E6EE] px-2 text-sm" />
                    </>}
                  </div>
                  {r.on && r.piece && (
                    <div className="flex flex-wrap gap-1 mt-2 ml-0 sm:ml-28">
                      <span className="text-[11px] text-gray-400 mr-1">For SKUs:</span>
                      {SKUS.filter(s => (bomPcs[s.sku] || {})[r.piece]).map(s => { const on = r.skus.includes(s.sku)
                        return <button key={s.sku} type="button" onClick={() => set(mc.id, { skus: on ? r.skus.filter(x => x !== s.sku) : [...r.skus, s.sku] })} className={`text-[11px] px-2 py-0.5 rounded-full border ${on ? 'text-white' : 'text-gray-500 bg-white border-[#E4E6EE]'}`} style={on ? { background: s.color, borderColor: s.color } : undefined}>{s.short}{left[s.sku] ? ` · ${fmtN(left[s.sku])} SRP left` : ''}</button> })}
                    </div>)}
                </div>)
            })}
          </div>
          <p className="text-[11px] text-gray-500">Pieces default to the machine's rate × hours; type a number to override. Saving adds these machines to the Daily Plan for {fmtDay(day)}; untick a machine to take it off.</p>
          {err && <p className="text-sm rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2">{err}</p>}
        </div>
        <div className="shrink-0 px-5 py-3 border-t border-[#EEF0F4] flex justify-end gap-2">
          <button onClick={onClose} className="h-11 px-4 rounded-xl border border-[#E4E6EE] text-sm text-gray-600">Cancel</button>
          <button onClick={save} disabled={busy} className="h-11 px-5 rounded-xl text-white text-sm font-bold disabled:opacity-50" style={{ background: '#784bd1' }}>{busy ? 'Saving…' : 'Save machine plan'}</button>
        </div>
      </div>
    </div>
    </Overlay>)
}
