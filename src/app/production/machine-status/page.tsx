'use client'
import ShareLink from '@/components/ShareLink'
import { useItemDeepLink } from '@/components/useItemDeepLink'
export const dynamic = 'force-dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import ImportExportBar from '@/components/ImportExportBar'
import RatesPage from '../rates/page'

interface SetupRow { machine_id: string; work_order_id: string | null; started_at: string; ended_at: string | null; minutes: number | null; operator: string | null }
interface Machine { id: string; name: string; machine_code: string; status: string; location: string | null; notes: string | null; is_active: boolean;
  make: string | null; model: string | null; description: string | null; serial_number: string | null; equipment_type: string | null; equipment_group: string | null;
  run_wo_id: string | null; run_rate: number | null; run_started_at: string | null; run_elapsed_sec: number | null; run_opened_at?: string | null; run_pause_count?: number | null; run_paused_at?: string | null; setup_started_at?: string | null; setup_wo_id?: string | null }

interface Rate { pieces_per_hour: number; basis: string; efficiency_pct: number | null }
interface OpInfo { id: string; qty_produced: number | null; qty_uom: string | null }
// Only work orders connected from a production board (connected_from set) appear here.
interface OpenWo { id: string; wo_number: number; wo_code: string | null; status: string; machine_id: string; scheduled_hours: number | null; qty_required: number | null; qty_ordered: number | null; qty_produced: number | null; qty_completed: number | null; uom: string | null; due_date: string | null; scheduled_date: string | null; scheduled_start: string | null; item_part_number: string | null; sku: string | null; group_name: string | null; customer: string | null; connected_from: string; op: OpInfo | null; rate: Rate | null }

const CAPACITY_HOURS = 22
const CLOSED = ['Complete', 'QC Passed', 'Cancelled']

// Machine states. Running pulses green, Paused blinks amber, everything else (Idle, Down, Maintenance) is red.
const STATE = {
  Running: { label: 'Running', text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-300', dot: 'bg-emerald-500 animate-pulse', glow: 'run-glow', color: '#1E9E6A' },
  Setup: { label: 'Setup', text: 'text-sky-800', bg: 'bg-sky-50', border: 'border-sky-300', dot: 'bg-sky-500 blink', glow: 'pause-blink', color: '#2B8BD6' },
  Paused: { label: 'Paused', text: 'text-amber-800', bg: 'bg-amber-50', border: 'border-amber-300', dot: 'bg-amber-500 blink', glow: 'pause-blink', color: '#E0A21B' },
  Off: { label: 'Off / down', text: 'text-red-700', bg: 'bg-red-50', border: 'border-red-300', dot: 'bg-red-500', glow: 'off-glow', color: '#E5231B' },
} as const
type StateKey = keyof typeof STATE
function stateOf(status: string): StateKey { return status === 'Running' ? 'Running' : status === 'Paused' ? 'Paused' : status === 'Setup' ? 'Setup' : 'Off' }

// Production boards. Each board draws from one machine section.
const SECTIONS = [
  { key: 'cut', name: 'Cutlery Molding', flow: 'Injection molding, then kitting or secondary', boards: ['walmart', 'mts_cutlery', 'cm_molding'],
    match: (m: Machine) => m.equipment_group === 'MOLDING' && !m.machine_code.startsWith('MLD') },
  { key: 'pla', name: 'PLA Injection Molding', flow: 'Molded parts, then secondary operations', boards: ['cm_molding'],
    match: (m: Machine) => m.machine_code.startsWith('MLD') },
  { key: 'straw', name: 'Straw Extrusion', flow: 'Extrusion, then wrapper or crimping', boards: ['straw'],
    match: (m: Machine) => m.equipment_group === 'STRAWS' },
  { key: 'bag', name: 'Bag Extrusion', flow: 'Blown film, then bag conversion', boards: ['mts_bags', 'pl_bags'],
    match: (m: Machine) => m.equipment_group === 'EXTRUDER' || m.equipment_group === 'CONVERSION' },
]
const BOARDS = [
  { key: 'all', label: 'All production boards' },
  { key: 'walmart', label: 'Walmart Production' },
  { key: 'straw', label: 'Straw Production' },
  { key: 'mts_bags', label: 'MTS Bags' },
  { key: 'mts_cutlery', label: 'MTS Cutlery' },
  { key: 'pl_bags', label: 'Private Label Bags' },
  { key: 'cm_molding', label: 'Contract Molding' },
]

// Icon artwork for each machine type (64 x 48 viewBox).
const ICONS: Record<string, string> = {
  inj: '<rect x="2" y="36" width="60" height="8" rx="2"/><rect x="5" y="40" width="4" height="8"/><rect x="55" y="40" width="4" height="8"/><rect x="5" y="18" width="5" height="18" rx="1"/><rect x="12" y="20" width="12" height="16" rx="1"/><rect x="24" y="23" width="32" height="9" rx="4"/><path d="M40 4h14l-5 13h-4z"/><rect x="45" y="17" width="4" height="7"/><rect x="56" y="22" width="6" height="12" rx="1"/>',
  blown: '<rect x="14" y="2" width="40" height="3" rx="1"/><rect x="14" y="2" width="3" height="40"/><rect x="51" y="2" width="3" height="40"/><path d="M28 30 C24 20 26 9 34 6 C42 9 44 20 40 30z"/><rect x="27" y="30" width="14" height="6" rx="1"/><rect x="2" y="32" width="26" height="6" rx="3"/><rect x="10" y="42" width="48" height="5" rx="1"/>',
  conv: '<circle cx="12" cy="20" r="10"/><rect x="2" y="31" width="60" height="6" rx="1"/><rect x="5" y="37" width="4" height="10"/><rect x="55" y="37" width="4" height="10"/><rect x="30" y="12" width="14" height="19" rx="2"/><rect x="48" y="24" width="14" height="3" rx="1"/><rect x="48" y="28" width="14" height="3" rx="1"/>',
  straw: '<path d="M6 2h13l-5 12h-3z"/><rect x="2" y="15" width="28" height="10" rx="4"/><rect x="30" y="13" width="6" height="14" rx="1"/><rect x="36" y="19" width="26" height="3"/><rect x="2" y="36" width="60" height="7" rx="2"/><rect x="5" y="43" width="4" height="5"/><rect x="55" y="43" width="4" height="5"/>',
  wrap: '<rect x="16" y="8" width="32" height="22" rx="3"/><rect x="24" y="2" width="16" height="6" rx="1"/><rect x="2" y="30" width="60" height="5" rx="2"/><circle cx="6" cy="32.5" r="3"/><circle cx="58" cy="32.5" r="3"/><rect x="8" y="38" width="48" height="6" rx="1"/><rect x="10" y="44" width="4" height="4"/><rect x="50" y="44" width="4" height="4"/>',
  bend: '<circle cx="34" cy="18" r="14"/><rect x="2" y="16" width="18" height="4" rx="1"/><rect x="2" y="22" width="18" height="4" rx="1"/><rect x="48" y="12" width="14" height="4" rx="1"/><rect x="48" y="20" width="14" height="4" rx="1"/><rect x="4" y="34" width="56" height="8" rx="2"/><rect x="8" y="42" width="4" height="6"/><rect x="52" y="42" width="4" height="6"/>',
}
function kindOf(m: Machine): string {
  const c = m.machine_code.toUpperCase()
  if (c.startsWith('STR-EXT')) return 'straw'
  if (c.startsWith('WRP')) return 'wrap'
  if (c.startsWith('BEDR')) return 'bend'
  if (m.equipment_group === 'CONVERSION') return 'conv'
  if (m.equipment_group === 'EXTRUDER') return 'blown'
  return 'inj'
}

function MachineIcon({ kind, pct, color, size = 52 }: { kind: string; pct: number; color: string; size?: number }) {
  const h = Math.round(size * 0.75)
  const svg = (fill: string) => (
    <svg width={size} height={h} viewBox="0 0 64 48" fill={fill} aria-hidden="true" style={{ position: 'absolute', left: 0, bottom: 0 }} dangerouslySetInnerHTML={{ __html: ICONS[kind] || ICONS.inj }} />
  )
  return (
    <div style={{ position: 'relative', width: size, height: h }}>
      {svg('#C3CEC6')}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${pct}%`, overflow: 'hidden', transition: 'height .6s ease' }}>
        <svg width={size} height={h} viewBox="0 0 64 48" fill={color} aria-hidden="true" style={{ position: 'absolute', left: 0, bottom: 0 }} dangerouslySetInnerHTML={{ __html: ICONS[kind] || ICONS.inj }} />
      </div>
    </div>
  )
}

const empty = { name: '', machine_code: '', status: 'Idle', location: '', notes: '',
  make: '', model: '', description: '', serial_number: '', equipment_type: '', equipment_group: '' }
type F = typeof empty
function fmtHms(sec: number) {
  const s = Math.floor(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`
}
function dbErr(e: { code?: string; message: string; hint?: string }) { console.error(e); return [e.message, e.code && `(${e.code})`, e.hint && `Hint: ${e.hint}`].filter(Boolean).join(' — ') }
type DayRun = { run_date: string; machine_id: string; work_order_id: string; hours: number | null; start_time: string | null; created_at: string }
type PlanLine = { run_date: string; machine_id: string; work_order_id: string; sku: string; product_name: string | null; uom: string | null; left_units: number; pcs_per_unit: number | null; pcs_known: boolean; pph: number | null; rate_basis: string | null; rate_known: boolean; child_sku: string | null }
type BuildLine = PlanLine & { build_units: number; build_pcs: number; hrs: number }
type SchedRun = { run: DayRun; wo: OpenWo | undefined; start: number; end: number; hours: number; lines: BuildLine[]; target_pcs: number; noRate: boolean; basis: string | null }
const DAY_START = 6 * 60 // 6:00 AM when no start time is set
const fmtNum = (n: number) => Math.round(n).toLocaleString()
function fmtClock(min: number) {
  const day = Math.floor(min / 1440), m = ((Math.round(min) % 1440) + 1440) % 1440
  const h = Math.floor(m / 60), mm = m % 60, ap = h < 12 ? 'AM' : 'PM', h12 = h % 12 || 12
  return `${h12}:${String(mm).padStart(2, '0')} ${ap}${day > 0 ? ' (next day)' : ''}`
}
const toMin = (t: string | null) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0) }
const toTime = (min: number) => { const m = ((Math.round(min) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` }

// The runs planned on one machine for one date, in order, with start and end times and what to build.
// Hours default to an even split of the 22 hour day. Each run starts when the one before it ends unless a start time is set.
function scheduleFor(date: string, mid: string, runs: DayRun[], lines: PlanLine[], wos: OpenWo[]): SchedRun[] {
  const mine = runs.filter(r => r.run_date === date && r.machine_id === mid)
    .sort((a, b) => (toMin(a.start_time) ?? 1e9) - (toMin(b.start_time) ?? 1e9) || a.created_at.localeCompare(b.created_at))
  let clock = DAY_START
  return mine.map((run, i) => {
    const hours = run.hours != null ? Number(run.hours) : CAPACITY_HOURS / mine.length
    const set = toMin(run.start_time)
    const start = set != null ? (set < clock - 720 && i > 0 ? set + 1440 : set) : clock
    const end = start + hours * 60
    clock = end
    let left = hours
    let noRate = false
    const built: BuildLine[] = lines.filter(l => l.run_date === date && l.machine_id === mid && l.work_order_id === run.work_order_id && Number(l.left_units) > 0)
      .map(l => {
        const pph = l.rate_known && l.pph ? Number(l.pph) : null
        const per = l.pcs_known && l.pcs_per_unit ? Number(l.pcs_per_unit) : null
        if (!pph || !per) { noRate = noRate || !pph; return { ...l, build_units: 0, build_pcs: 0, hrs: 0 } }
        const needPcs = Number(l.left_units) * per
        const hrs = Math.min(left, needPcs / pph)
        left -= hrs
        const units = Math.floor(hrs * pph / per)
        return { ...l, build_units: units, build_pcs: units * per, hrs }
      })
    return { run, wo: wos.find(w => w.id === run.work_order_id && w.machine_id === mid), start, end, hours, lines: built,
      target_pcs: built.reduce((t, l) => t + l.build_pcs, 0), noRate, basis: built.find(l => l.rate_basis)?.rate_basis ?? null }
  })
}

// One planned run: time window, spec rate and the build list for the day.
function PlanRunCard({ sr, canEdit, onTime, onHours }: { sr: SchedRun; canEdit: boolean; onTime?: (v: string) => void; onHours?: (v: number | null) => void }) {
  const label = sr.wo ? (sr.wo.wo_code || `WO-${sr.wo.wo_number}`) : 'Work order'
  const building = sr.lines.filter(l => l.build_units > 0)
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 text-xs flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-sm text-[#1A1D2E]">{label}{sr.wo?.customer ? ` · ${sr.wo.customer}` : ''}</span>
        <span className="font-mono font-semibold text-emerald-800">{fmtClock(sr.start)} to {fmtClock(sr.end)}</span>
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-gray-600">Start
            <input type="time" defaultValue={toTime(sr.start)} key={'t' + sr.start} onBlur={e => onTime?.(e.target.value)} className="h-8 rounded-lg border border-[#E4E6EE] px-2 bg-white text-[#1A1D2E]" />
          </label>
          <label className="flex items-center gap-1.5 text-gray-600">Run hours
            <input type="number" min={0.5} max={24} step={0.5} defaultValue={Number(sr.hours.toFixed(2))} key={'h' + sr.hours} onBlur={e => onHours?.(e.target.value ? Number(e.target.value) : null)} className="h-8 w-20 rounded-lg border border-[#E4E6EE] px-2 bg-white text-[#1A1D2E]" />
          </label>
        </div>
      )}
      {sr.lines.length === 0 ? <p className="text-gray-500">Nothing left to build on this work order.</p> : (
        <>
          {sr.lines[0]?.child_sku && <p className="text-[#1A1D2E]">Mold makes <b className="font-mono">{sr.lines[0].child_sku}</b> pieces. Finished goods below are what those pieces build.</p>}
          <p className="text-[#1A1D2E]"><b>Target: {fmtNum(sr.target_pcs)} {sr.lines[0]?.child_sku ? sr.lines[0].child_sku + ' ' : ''}pcs</b> in {sr.hours.toFixed(1)} h{sr.basis ? <span className="text-gray-500"> · {sr.basis}</span> : null}</p>
          {sr.noRate && <p className="text-amber-800">Some items have no spec rate for this machine. Add it in <a href="/production/machine-status?tab=rates" className="underline font-semibold">Production Rates</a>.</p>}
          <table className="w-full text-left">
            <thead><tr className="text-[10px] uppercase tracking-wide text-gray-500"><th className="py-1">Build</th><th className="text-right">Today</th><th className="text-right">Left on WO</th></tr></thead>
            <tbody>
              {(building.length ? building : sr.lines).map(l => (
                <tr key={l.sku} className="border-t border-emerald-100">
                  <td className="py-1 pr-2"><span className="font-mono font-semibold">{l.sku}</span><span className="block text-[10px] text-gray-500 truncate max-w-[220px]">{l.product_name}</span></td>
                  <td className="text-right font-semibold whitespace-nowrap">{fmtNum(l.build_units)} {(l.uom || '').toLowerCase()}<span className="block text-[10px] font-normal text-gray-500">{fmtNum(l.build_pcs)} {l.child_sku ? l.child_sku + ' ' : ''}pcs</span></td>
                  <td className="text-right whitespace-nowrap text-gray-600">{fmtNum(Number(l.left_units))} {(l.uom || '').toLowerCase()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {building.length > 0 && building.length < sr.lines.length && <p className="text-[10px] text-gray-500">{sr.lines.length - building.length} more item(s) on this work order after these.</p>}
        </>
      )}
    </div>
  )
}

type Mold = { machine_id: string; mold_name: string | null; child_sku: string; cavities: number; cycle_sec: number; notes: string | null }
// Mold in an injection molding machine: which child piece it makes, cavities and cycle time. Output is child pieces per hour;
// the run plan turns those pieces into finished goods through each parent's BOM.
function MoldEditor({ sb, machine, mold, pieces, onSaved }: { sb: any; machine: Machine; mold: Mold | undefined; pieces: string[]; onSaved: () => void }) {
  const [f, setF] = useState({ mold_name: mold?.mold_name || '', child_sku: mold?.child_sku || '', cavities: String(mold?.cavities ?? ''), cycle_sec: String(mold?.cycle_sec ?? '') })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => { setF({ mold_name: mold?.mold_name || '', child_sku: mold?.child_sku || '', cavities: String(mold?.cavities ?? ''), cycle_sec: String(mold?.cycle_sec ?? '') }) }, [mold, machine.id])
  const cav = Number(f.cavities), cyc = Number(f.cycle_sec)
  const pph = cav > 0 && cyc > 0 ? cav * 3600 / cyc : null
  async function save() {
    if (!f.child_sku.trim() || !(cav > 0) || !(cyc > 0)) { setMsg('Enter the child SKU, cavities and cycle time.'); return }
    setBusy(true); setMsg('')
    const { error } = await sb.from('machine_molds').upsert({ machine_id: machine.id, mold_name: f.mold_name.trim() || null, child_sku: f.child_sku.trim().toUpperCase(), cavities: Math.round(cav), cycle_sec: cyc, updated_at: new Date().toISOString() })
    setBusy(false)
    if (error) { setMsg(error.message); return }
    setMsg('Saved.'); onSaved()
  }
  async function clear() {
    if (!mold || !confirm(`Remove the mold from ${machine.machine_code}?`)) return
    setBusy(true)
    const { error } = await sb.from('machine_molds').delete().eq('machine_id', machine.id)
    setBusy(false)
    if (error) { setMsg(error.message); return }
    setMsg('Mold removed.'); onSaved()
  }
  const inp = 'mt-1 w-full h-10 rounded-lg border border-[#E4E6EE] px-2 text-sm text-[#1A1D2E] bg-white'
  return (
    <div className="rounded-xl border border-[#E4E6EE] p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between"><p className="text-sm font-semibold text-[#1A1D2E]">Mold in this machine</p>{mold && <span className="text-[11px] text-gray-500">{mold.child_sku} · {mold.cavities} cav</span>}</div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-gray-600 col-span-2">Mold name (optional)<input value={f.mold_name} onChange={e => setF(p => ({ ...p, mold_name: e.target.value }))} placeholder="e.g. Fork 24 cav" className={inp} /></label>
        <label className="text-xs text-gray-600 col-span-2">Child SKU it makes
          <input list={'pieces-' + machine.id} value={f.child_sku} onChange={e => setF(p => ({ ...p, child_sku: e.target.value }))} placeholder="e.g. BGFRK" className={inp + ' font-mono'} />
          <datalist id={'pieces-' + machine.id}>{pieces.map(x => <option key={x} value={x} />)}</datalist>
        </label>
        <label className="text-xs text-gray-600">Cavities<input inputMode="numeric" value={f.cavities} onChange={e => setF(p => ({ ...p, cavities: e.target.value }))} className={inp} /></label>
        <label className="text-xs text-gray-600">Cycle time (sec)<input inputMode="decimal" value={f.cycle_sec} onChange={e => setF(p => ({ ...p, cycle_sec: e.target.value }))} className={inp} /></label>
      </div>
      <p className="text-xs text-gray-600">{pph ? <>Output: <b>{fmtNum(pph)} {f.child_sku || 'child'} pcs/hr</b> ({fmtNum(pph * CAPACITY_HOURS)} in {CAPACITY_HOURS} h)</> : 'Output is cavities × 3600 ÷ cycle seconds, in child pieces per hour.'}</p>
      <div className="flex gap-2">
        <button disabled={busy} onClick={save} className="flex-1 h-10 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50">Save mold</button>
        {mold && <button disabled={busy} onClick={clear} className="h-10 px-3 rounded-lg border border-[#E4E6EE] text-sm text-gray-600">Remove</button>}
      </div>
      {msg && <p className="text-xs text-gray-600">{msg}</p>}
    </div>
  )
}

// One connected work order on the operator panel: what it needs and what the spec says it should make.
function JobCard({ w, qh }: { w: OpenWo; qh?: { need_pcs: number; pph: number | null; hours: number | null; basis: string } }) {
  const req = w.qty_required ?? w.qty_ordered
  const done = Math.max(Number(w.op?.qty_produced ?? 0), Number(w.qty_produced ?? 0), Number(w.qty_completed ?? 0))
  const remaining = req == null ? null : Math.max(0, Number(req) - done)
  const pph = w.rate ? w.rate.pieces_per_hour : null
  const sched = Number(w.scheduled_hours || 0)
  const unit = w.op?.qty_uom || w.uom || 'pcs'
  return (
    <li className="rounded-xl border border-[#E4E6EE] p-4 text-sm flex flex-col gap-3">
      <div className="flex justify-between gap-2">
        <span className="font-semibold">{w.wo_code || `WO-${w.wo_number}`}{w.customer ? ` · ${w.customer}` : ''}</span>
        <span className="text-xs text-gray-500">{w.status}</span>
      </div>
      <div className="text-xs text-gray-600">{w.sku || w.item_part_number || 'No item'}{w.due_date ? ` · due ${w.due_date}` : ''}</div>

      <dl className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-[#F5F6FA] p-2"><dt className="text-[10px] uppercase tracking-wide text-gray-500">Needs</dt><dd className="font-bold">{req ?? '—'} <span className="text-[10px] font-normal text-gray-500">{unit}</span></dd></div>
        <div className="rounded-lg bg-[#F5F6FA] p-2"><dt className="text-[10px] uppercase tracking-wide text-gray-500">Done</dt><dd className="font-bold">{done}</dd></div>
        <div className="rounded-lg bg-[#F5F6FA] p-2"><dt className="text-[10px] uppercase tracking-wide text-gray-500">Left</dt><dd className="font-bold">{remaining ?? '—'}</dd></div>
      </dl>

      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
        {pph != null ? (
          <>
            <p className="font-semibold">Expected at spec: {Math.round(pph).toLocaleString()} pcs/hr</p>
            {sched > 0 && <p>{Math.round(pph * sched).toLocaleString()} pcs over {sched} scheduled h</p>}
            {remaining != null && remaining > 0 && <p>About {(remaining / pph).toFixed(1)} h to finish at spec</p>}
            <p className="text-emerald-800/70 mt-0.5">{w.rate?.basis}</p>
          </>
        ) : <p className="text-amber-800">No spec rate for this machine and product yet.</p>}
      </div>

      {qh && <p className="text-[11px] text-gray-600">Queued on this machine: <b>{Number(qh.hours ?? 0).toFixed(1)} h</b> for {Math.round(Number(qh.need_pcs)).toLocaleString()} pcs{qh.pph ? ` at ${Math.round(Number(qh.pph)).toLocaleString()}/hr (${qh.basis})` : ' · no rate'}</p>}
      <p className="text-[11px] text-gray-500">Booked so far: {done} {unit}</p>
    </li>
  )
}

export default function MachineStatusPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<Machine[]>([])
  const [loading, setLoading] = useState(true)
  const [board, setBoard] = useState('all')
  const [selected, setSelected] = useState<Machine | null>(null)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Machine | null>(null)
  const [form, setForm] = useState<F>(empty)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [wos, setWos] = useState<OpenWo[]>([])
  const [operator, setOperator] = useState('')
  // Operators come from the employee directory: active floor staff (warehouse, manufacturing, shipping/receiving).
  const [staff, setStaff] = useState<{ id: string; name: string; department: string | null }[]>([])
  useEffect(() => {
    sb.from('employees').select('id,name,department').eq('status', 'Active').is('end_date', null)
      .in('department', ['Warehouse Operations', 'Manufacturing', 'Shipping/Receiving']).order('name')
      .then(({ data }: any) => setStaff((data || []).filter((e: any) => e.name)))
  }, [sb])
  const [now, setNow] = useState(() => Date.now())
  const [startWo, setStartWo] = useState('')
  const [stopOpen, setStopOpen] = useState(false)
  const [stopQty, setStopQty] = useState('')
  // Board work orders: the operator reports actual per SKU (or child pieces when a mold is set).
  const [stopLines, setStopLines] = useState<{ sku: string; product_name: string | null; uom: string | null; left_units: number }[]>([])
  const [stopLineQty, setStopLineQty] = useState<Record<string, string>>({})
  const [stopNote, setStopNote] = useState('')
  const [stopBusy, setStopBusy] = useState(false)
  const [stopMsg, setStopMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [setups, setSetups] = useState<SetupRow[]>([])
  const setupSec = (m: Machine) => (m.setup_started_at ? Math.max(0, (now - Date.parse(m.setup_started_at)) / 1000) : 0)
  async function startSetup(m: Machine) {
    const { error } = await sb.rpc('machine_setup_start', { p_machine_id: m.id, p_wo: startWo || null, p_operator: operator.trim() || null })
    if (error) { setStopMsg({ ok: false, text: error.message }); return }
    setStopMsg({ ok: true, text: `Setup started on ${m.machine_code}. Tap Stop setup when it is ready to run.` }); load()
  }
  async function stopSetup(m: Machine, quiet = false) {
    const { data, error } = await sb.rpc('machine_setup_stop', { p_machine_id: m.id, p_note: null })
    if (error) { if (!quiet) setStopMsg({ ok: false, text: error.message }); return false }
    const min = Number((data as any)?.minutes || 0)
    setStopMsg({ ok: true, text: `Setup on ${m.machine_code} recorded: ${fmtHms(min * 60)}.` })
    if (!quiet) load()
    return true
  }
  const ymdLocal = (d: Date) => d.toLocaleDateString('en-CA')
  const todayStr = ymdLocal(new Date())
  const [planDate, setPlanDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); return ymdLocal(d) })
  // Day plan: which connected work orders each machine runs on a given date (machine_day_runs).
  const [dayRuns, setDayRuns] = useState<DayRun[]>([])
  const [planLines, setPlanLines] = useState<PlanLine[]>([])
  const [tab, setTab] = useState<'machines' | 'schedule' | 'rates'>('machines')
  useEffect(() => { const t = new URLSearchParams(window.location.search).get('tab'); if (t === 'schedule' || t === 'rates') setTab(t) }, [])
  const [openPlan, setOpenPlan] = useState<string | null>(null)
  const [molds, setMolds] = useState<Mold[]>([])
  const [queue, setQueue] = useState<{ machine_id: string; work_order_id: string; need_pcs: number; pph: number | null; hours: number | null; basis: string }[]>([])
  // What each machine actually did over its last runs (from reported actuals). Used for estimates and plan targets.
  const [learned, setLearned] = useState<{ machine_id: string; child_sku: string | null; runs: number; pph: number; spec_pph: number | null }[]>([])
  const learnedFor = (mid: string) => { const md = molds.find(x => x.machine_id === mid); return learned.find(l => l.machine_id === mid && (l.child_sku || '') === (md?.child_sku || '')) }
  const [pieces, setPieces] = useState<string[]>([])
  async function loadMolds() {
    const { data } = await sb.from('machine_molds').select('machine_id,mold_name,child_sku,cavities,cycle_sec,notes')
    setMolds((data ?? []) as Mold[])
    const { data: lr } = await sb.from('v_machine_learned_rate').select('machine_id,child_sku,runs,pph,spec_pph')
    setLearned(((lr ?? []) as any[]).map(x => ({ ...x, pph: Number(x.pph), spec_pph: x.spec_pph == null ? null : Number(x.spec_pph) })))
  }
  useEffect(() => {
    loadMolds()
    sb.from('product_bom').select('component_sku').eq('uom_type', 'pcs').limit(5000).then(({ data }: any) => {
      setPieces([...new Set(((data || []) as any[]).map(r => String(r.component_sku || '').trim()).filter(Boolean))].sort())
    })
  }, [sb]) // eslint-disable-line
  const [planBusy, setPlanBusy] = useState('')
  const anyRunning = rows.some(r => !!r.run_started_at)
  useEffect(() => {
    if (!anyRunning) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [anyRunning])

  async function load() {
    setLoading(true)
    const { data } = await sb.from('machines').select('*').order('name')
    if (data) setRows(data as Machine[])
    sb.from('machine_setup_log').select('machine_id,work_order_id,started_at,ended_at,minutes,operator').order('started_at', { ascending: false }).limit(200)
      .then(({ data: sl }: any) => setSetups((sl || []) as SetupRow[]))
    // Only work orders connected from a production board (connected_from set) are shown.
    // A work order can be connected to several machines (wo_machines). Older single connections still count.
    const WO_COLS = 'id,wo_number,wo_code,status,machine_id,product_id,scheduled_hours,scheduled_date,scheduled_start,qty_required,qty_ordered,qty_produced,qty_completed,uom,due_date,item_part_number,group_name,connected_from,sales_orders!work_orders_sales_order_id_fkey(customers(company_name))'
    const { data: lk } = await sb.from('wo_machines').select('work_order_id,machine_id,board')
    const links = (lk ?? []) as { work_order_id: string; machine_id: string; board: string | null }[]
    const linkIds = [...new Set(links.map(l => l.work_order_id))]
    const [{ data: w }, linkedRes] = await Promise.all([
      sb.from('work_orders').select(WO_COLS).not('machine_id', 'is', null).not('connected_from', 'is', null).order('created_at', { ascending: false }),
      linkIds.length ? sb.from('work_orders').select(WO_COLS).in('id', linkIds) : Promise.resolve({ data: [] as any[] }),
    ])
    const byId = new Map<string, any>()
    for (const x of [...((w ?? []) as any[]), ...(((linkedRes as any).data ?? []) as any[])]) byId.set(x.id, x)
    const openBase = [...byId.values()].filter(x => !CLOSED.includes(x.status))
    // One row per work order per machine.
    const open: any[] = []
    for (const x of openBase) {
      const ms = links.filter(l => l.work_order_id === x.id).map(l => l.machine_id)
      const set = ms.length ? ms : x.machine_id ? [x.machine_id] : []
      for (const mid of set) open.push({ ...x, machine_id: mid, connected_from: x.connected_from || links.find(l => l.work_order_id === x.id)?.board || 'board' })
    }
    const { data: dr } = await sb.from('machine_day_runs').select('run_date,machine_id,work_order_id,hours,start_time,created_at').gte('run_date', todayStr)
    setDayRuns((dr ?? []) as any[])
    sb.rpc('machine_queue_load').then(({ data: ql }: any) => setQueue((ql ?? []) as any[]))
    loadPlanLines()
    const ids = open.map(x => x.id)
    const pids = [...new Set(open.map(x => x.product_id).filter(Boolean))] as string[]
    const [opsRes, prodRes] = await Promise.all([
      ids.length ? sb.from('work_order_operations').select('id,work_order_id,machine_id,qty_produced,qty_uom').in('work_order_id', ids) : null,
      pids.length ? sb.from('products').select('id,sku').in('id', pids) : null,
    ])
    const ops = (opsRes?.data ?? []) as any[]
    const skuOf = new Map(((prodRes?.data ?? []) as any[]).map(p => [p.id, p.sku as string]))
    // Spec rate per work order: machine rate for this product, from the database.
    const rateEntries = await Promise.all(open.filter(x => x.product_id).map(async x => {
      const { data: r } = await sb.rpc('rate_pieces_per_hour', { p_machine_id: x.machine_id, p_product_id: x.product_id })
      const row: any = Array.isArray(r) ? r[0] : r
      const rate: Rate | null = row && row.known ? { pieces_per_hour: Number(row.pieces_per_hour), basis: String(row.basis), efficiency_pct: row.efficiency_pct ?? null } : null
      return [x.id + ':' + x.machine_id, rate] as [string, Rate | null]
    }))
    const rateOf = new Map(rateEntries)
    setWos(open.map(x => {
      const op = ops.find(o => o.work_order_id === x.id && o.machine_id === x.machine_id) ?? null
      return {
        id: x.id, wo_number: x.wo_number, wo_code: x.wo_code ?? null, status: x.status, machine_id: x.machine_id, scheduled_hours: x.scheduled_hours,
        qty_required: x.qty_required, qty_ordered: x.qty_ordered, qty_produced: x.qty_produced, qty_completed: x.qty_completed ?? null, uom: x.uom, due_date: x.due_date,
        scheduled_date: x.scheduled_date, scheduled_start: x.scheduled_start,
        item_part_number: x.item_part_number, sku: x.product_id ? (skuOf.get(x.product_id) ?? null) : null, group_name: x.group_name,
        connected_from: x.connected_from,
        customer: x.sales_orders?.customers?.company_name ?? null,
        op: op ? { id: op.id, qty_produced: op.qty_produced, qty_uom: op.qty_uom } : null,
        rate: rateOf.get(x.id + ':' + x.machine_id) ?? null,
      }
    }))
    setLoading(false)
  }
  async function loadPlanLines(date?: string) {
    const { data } = await sb.rpc('machine_day_plan_lines', { p_dates: [todayStr, date || planDateRef.current] })
    setPlanLines((data ?? []) as PlanLine[])
  }
  const planDateRef = useRef(planDate)
  useEffect(() => { planDateRef.current = planDate; loadPlanLines(planDate) }, [planDate]) // eslint-disable-line
  useEffect(() => { load() }, []) // eslint-disable-line
  useEffect(() => {
    let t: any
    const bump = () => { clearTimeout(t); t = setTimeout(load, 600) }
    const ch = sb.channel('machine-status-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'machines' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wo_machines' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'machine_day_runs' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'machine_molds' }, () => { loadMolds(); loadPlanLines() })
      .subscribe()
    return () => { clearTimeout(t); sb.removeChannel(ch) }
  }, [sb]) // eslint-disable-line

  const active = rows.filter(r => r.is_active)
  const woByMachine = useMemo(() => {
    const map: Record<string, OpenWo[]> = {}
    for (const w of wos) (map[w.machine_id] ||= []).push(w)
    return map
  }, [wos])
  // Booked hours: scheduled hours when set, otherwise what's left on the work order divided by the machine's rate (machine_queue_load).
  const queueHrs = (mid: string, wid: string) => queue.find(q => q.machine_id === mid && q.work_order_id === wid)
  const hoursOf = (id: string) => (woByMachine[id] || []).reduce((s, w) => s + (Number(w.scheduled_hours) || Number(queueHrs(id, w.id)?.hours) || 0), 0)

  const shownSections = SECTIONS.filter(s => board === 'all' || s.boards.includes(board))
  const counts = { Running: 0, Setup: 0, Paused: 0, Off: 0 }
  active.forEach(m => { counts[stateOf(m.status)]++ })
  const totalOpen = new Set(wos.map(w => w.id)).size
  const woLabel = (w: OpenWo) => w.wo_code || `WO-${w.wo_number}`
  const isPlanned = (date: string, mid: string, wid: string) => dayRuns.some(r => r.run_date === date && r.machine_id === mid && r.work_order_id === wid)
  async function togglePlan(date: string, mid: string, wid: string) {
    const k = date + mid + wid
    setPlanBusy(k)
    const on = isPlanned(date, mid, wid)
    const { error } = on
      ? await sb.from('machine_day_runs').delete().eq('run_date', date).eq('machine_id', mid).eq('work_order_id', wid)
      : await sb.from('machine_day_runs').insert({ run_date: date, machine_id: mid, work_order_id: wid })
    setPlanBusy('')
    if (error) { alert('Could not update the day plan: ' + error.message); return }
    setDayRuns(prev => on ? prev.filter(r => !(r.run_date === date && r.machine_id === mid && r.work_order_id === wid)) : [...prev, { run_date: date, machine_id: mid, work_order_id: wid, hours: null, start_time: null, created_at: new Date().toISOString() }])
    loadPlanLines()
  }
  async function updateRun(r: DayRun, patch: Partial<Pick<DayRun, 'hours' | 'start_time'>>) {
    const { error } = await sb.from('machine_day_runs').update(patch).eq('run_date', r.run_date).eq('machine_id', r.machine_id).eq('work_order_id', r.work_order_id)
    if (error) { alert('Could not save: ' + error.message); return }
    setDayRuns(prev => prev.map(x => (x.run_date === r.run_date && x.machine_id === r.machine_id && x.work_order_id === r.work_order_id ? { ...x, ...patch } : x)))
  }
  const sched = (date: string, mid: string) => scheduleFor(date, mid, dayRuns, planLines, wos)
  const totalBooked = active.reduce((s, m) => s + hoursOf(m.id), 0)

  function openAdd() { setEditing(null); setForm(empty); setErr(''); setOpen(true) }
  function openEdit(r: Machine) {
    setEditing(r)
    setForm({ name: r.name, machine_code: r.machine_code, status: r.status, location: r.location ?? '', notes: r.notes ?? '',
      make: r.make ?? '', model: r.model ?? '', description: r.description ?? '', serial_number: r.serial_number ?? '', equipment_type: r.equipment_type ?? '', equipment_group: r.equipment_group ?? '' })
    setErr(''); setOpen(true)
  }
  function close() { setOpen(false); setTimeout(() => { setEditing(null); setForm(empty) }, 300) }
  useItemDeepLink(rows, openEdit)

  // Run time so far, in seconds, including the current running stretch.
  function elapsedSec(m: Machine) {
    return Number(m.run_elapsed_sec || 0) + (m.run_started_at ? Math.max(0, (now - Date.parse(m.run_started_at)) / 1000) : 0)
  }
  // Downtime = time since the run opened minus run time (the paused stretches).
  function downSec(m: Machine) {
    if (!m.run_wo_id || !m.run_opened_at) return 0
    return Math.max(0, (now - Date.parse(m.run_opened_at)) / 1000 - elapsedSec(m))
  }
  function uptimePct(m: Machine) { const r = elapsedSec(m), d = downSec(m); return r + d > 0 ? Math.round((r / (r + d)) * 100) : 100 }
  async function startRun(m: Machine, woId: string, rate: number | null) {
    const resuming = !!m.run_wo_id && m.run_wo_id === woId
    if (m.run_wo_id && !resuming) { alert('Stop the current run before starting another work order.'); return }
    if (!resuming && m.setup_started_at) await stopSetup(m, true)
    const t = new Date().toISOString()
    // Rate for the running estimate: the mold (cavities x 3600 / cycle) wins, then the product rate, then the machine's own rate.
    let r = rate
    const md = molds.find(x => x.machine_id === m.id)
    const lr = learnedFor(m.id)
    if (lr) r = lr.pph
    else if (md) r = md.cavities * 3600 / Number(md.cycle_sec)
    else if (r == null) {
      const { data } = await sb.rpc('rate_pieces_per_hour', { p_machine_id: m.id, p_product_id: null })
      const row: any = Array.isArray(data) ? data[0] : data
      if (row?.known) r = Number(row.pieces_per_hour)
    }
    const t2 = new Date().toISOString()
    const patch: Record<string, unknown> = { run_started_at: t2, status: 'Running', updated_at: t2 }
    if (!resuming) { patch.run_wo_id = woId; patch.run_rate = r; patch.run_elapsed_sec = 0 }
    const { error } = await sb.from('machines').update(patch).eq('id', m.id)
    if (error) { alert('Could not start the run: ' + error.message); return }
    load()
  }
  // Cancel a run (test or mistake): clears the run and books nothing to inventory, the boards or the learned rate.
  async function cancelRun(m: Machine) {
    if (!confirm(`Cancel the run on ${m.machine_code}? Nothing will be booked.`)) return
    const { error } = await sb.from('machines').update({ run_wo_id: null, run_rate: null, run_started_at: null, run_elapsed_sec: 0, status: 'Idle', updated_at: new Date().toISOString() }).eq('id', m.id)
    if (error) { alert('Could not cancel the run: ' + error.message); return }
    setStopOpen(false); setStopMsg({ ok: true, text: `Run on ${m.machine_code} cancelled. Nothing was booked.` }); load()
  }
  async function pauseRun(m: Machine) {
    const { error } = await sb.from('machines').update({ run_elapsed_sec: elapsedSec(m), run_started_at: null, status: 'Paused', updated_at: new Date().toISOString() }).eq('id', m.id)
    if (error) { alert('Could not pause the run: ' + error.message); return }
    load()
  }
  // Stop books the operator's actual number to the work order and to inventory, converted to the finished good unit.
  async function openStop(m: Machine) {
    const next = !stopOpen
    setStopOpen(next); setStopMsg(null); setStopLineQty({}); setStopQty('')
    if (next && m.run_wo_id) {
      const { data } = await sb.rpc('wo_open_lines', { p_wo: m.run_wo_id })
      setStopLines(((data ?? []) as any[]).map(x => ({ sku: x.sku, product_name: x.product_name, uom: x.uom, left_units: Number(x.left_units) })))
    }
  }
  async function stopRun(m: Machine) {
    const md = molds.find(x => x.machine_id === m.id)
    if (md || stopLines.length) {
      const lines = md ? [{ sku: md.child_sku, qty: Number(stopQty) }] : stopLines.map(l => ({ sku: l.sku, qty: Number(stopLineQty[l.sku] || 0) })).filter(l => l.qty > 0)
      if (!lines.length || !(lines[0].qty > 0)) { setStopMsg({ ok: false, text: md ? `Enter the actual ${md.child_sku} pieces produced.` : 'Enter the actual quantity for at least one SKU.' }); return }
      setStopBusy(true); setStopMsg(null)
      const { data, error } = await sb.rpc('machine_run_stop_board', { p_machine_id: m.id, p_lines: lines, p_operator: operator.trim() || null, p_note: stopNote.trim() || null })
      setStopBusy(false)
      if (error) { setStopMsg({ ok: false, text: error.message }); return }
      setStopMsg({ ok: true, text: String(data ?? 'Booked.') })
      setStopQty(''); setStopNote(''); setStopLineQty({}); setStopOpen(false); load(); loadMolds()
      return
    }
    const q = Number(stopQty)
    if (!(q > 0)) { setStopMsg({ ok: false, text: 'Enter the actual quantity produced, greater than zero.' }); return }
    setStopBusy(true); setStopMsg(null)
    const job = wos.find(w => w.id === m.run_wo_id)
    const uom = job?.op?.qty_uom || job?.uom || null
    const { data, error } = await sb.rpc('machine_run_stop', { p_machine_id: m.id, p_qty: q, p_uom: uom, p_operator: operator.trim() || null, p_note: stopNote.trim() || null } as any)
    setStopBusy(false)
    if (error) { setStopMsg({ ok: false, text: error.message }); return }
    const text = String(data ?? '')
    const ok = text.startsWith('Booked')
    setStopMsg({ ok, text })
    if (ok) { setStopQty(''); setStopNote(''); setStopOpen(false); load() }
  }

  async function save() {
    if (!form.name.trim() || !form.machine_code.trim()) { setErr('Machine Name and Code are required.'); return }
    setErr(''); setSaving(true)
    const t = (v: string) => v.trim() || null
    const p = { name: form.name.trim(), machine_code: form.machine_code.trim(), status: form.status, location: t(form.location), notes: t(form.notes),
      make: t(form.make), model: t(form.model), description: t(form.description), serial_number: t(form.serial_number),
      equipment_type: t(form.equipment_type), equipment_group: t(form.equipment_group) }
    const { error } = editing ? await sb.from('machines').update({ ...p, updated_at: new Date().toISOString() }).eq('id', editing.id) : await sb.from('machines').insert({ ...p, is_active: true })
    if (error) { setErr(dbErr(error)); setSaving(false); return }
    setSaving(false); close(); load()
  }
  async function toggleArchive() {
    if (!editing) return
    await sb.from('machines').update({ is_active: !editing.is_active, updated_at: new Date().toISOString() }).eq('id', editing.id)
    close(); load()
  }
  async function handleDelete() {
    if (!editing) return
    if (!confirm('Permanently delete this machine? This cannot be undone.')) return
    const { error } = await sb.from('machines').delete().eq('id', editing.id)
    if (error) { alert('Delete failed: ' + error.message); return }
    close(); load()
  }

  const inp = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] placeholder-[#9CA3AF] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition'

  return (
    <div className="p-4 md:p-8 min-h-screen">
      <style>{`
        @keyframes runGlow{0%,100%{filter:drop-shadow(0 0 0 rgba(30,158,106,0))}50%{filter:drop-shadow(0 0 7px rgba(30,158,106,.95))}}
        @keyframes blinkAmber{0%,100%{opacity:1}50%{opacity:.15}}
        .run-glow{animation:runGlow 1.2s ease-in-out infinite}
        .pause-blink{animation:blinkAmber .9s steps(2,start) infinite}
        .off-glow{filter:drop-shadow(0 0 4px rgba(229,35,27,.95))}
        .blink{animation:blinkAmber .9s steps(2,start) infinite}
      `}</style>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-emerald-500/20 text-emerald-300 border-emerald-500/30">PRODUCTION</span>
          <h1 className="text-2xl font-semibold text-[#1A1D2E] mt-1">Machine Status</h1>
          <p className="text-gray-500 text-sm mt-0.5">Each machine shows how much of its 22 hour day is booked. Only work orders connected from a production board appear here.</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportExportBar table="machines" filename="machines" columns={[
            { header: 'Name', dbKey: 'name', example: 'Injection Molder 1', required: true },
            { header: 'Machine Code', dbKey: 'machine_code', example: 'IM-01', required: true },
            { header: 'Status', dbKey: 'status', example: 'Idle' },
            { header: 'Department', dbKey: 'equipment_group', example: 'MOLDING' },
            { header: 'Equipment Type', dbKey: 'equipment_type', example: 'Injection Molding' },
            { header: 'Location', dbKey: 'location', example: 'Bay A' },
            { header: 'Make', dbKey: 'make', example: 'Hwamda' },
            { header: 'Model', dbKey: 'model', example: 'HMD270M8-SPV' },
            { header: 'Serial Number', dbKey: 'serial_number', example: 'WM029AA' },
            { header: 'Description', dbKey: 'description', example: 'Molding M/C' },
            { header: 'Notes', dbKey: 'notes', example: '' },
          ]} onImportDone={load} />
          <button onClick={openAdd} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-[#1A1D2E] text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">Add Machine</button>
        </div>
      </div>

      <div className="flex gap-1 mb-5 border-b border-[#E4E6EE]" role="tablist">
        {([['machines', 'Machines'], ['schedule', 'Schedule'], ['rates', 'Spec rates']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`px-4 py-2.5 text-sm font-semibold -mb-px border-b-2 ${tab === k ? 'border-emerald-600 text-[#1A1D2E]' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>{l}</button>
        ))}
      </div>

      {tab === 'rates' && <div className="-mx-4 md:-mx-8 -mt-4"><RatesPage /></div>}

      <div className={`flex flex-wrap items-center gap-2 mb-6 ${tab === 'rates' ? 'hidden' : ''}`}>
        <span className="text-xs font-semibold text-gray-500 mr-1">Show production board</span>
        {BOARDS.map(b => (
          <button key={b.key} onClick={() => setBoard(b.key)} aria-pressed={board === b.key}
            className={`text-sm font-medium px-3.5 py-2 rounded-full border transition-colors ${board === b.key ? 'bg-[#13201A] text-white border-[#13201A]' : 'bg-white text-[#1A1D2E] border-[#D5DED7] hover:border-gray-400'}`}>{b.label}</button>
        ))}
      </div>

      {tab === 'machines' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-white border border-[#E4E6EE] rounded-xl p-4"><span className="text-xs text-gray-500">Running</span><p className="text-2xl font-bold text-emerald-600">{counts.Running} / {active.length}</p></div>
          <div className="bg-white border border-[#E4E6EE] rounded-xl p-4"><span className="text-xs text-gray-500">Paused · in setup</span><p className="text-2xl font-bold text-amber-600">{counts.Paused} <span className="text-sky-600">· {counts.Setup}</span></p></div>
          <div className="bg-white border border-[#E4E6EE] rounded-xl p-4"><span className="text-xs text-gray-500">Off or down</span><p className="text-2xl font-bold text-red-600">{counts.Off}</p></div>
          <div className="bg-white border border-[#E4E6EE] rounded-xl p-4"><span className="text-xs text-gray-500">Connected work orders</span><p className="text-2xl font-bold text-[#1A1D2E]">{totalOpen} <span className="text-sm font-medium text-gray-500">· {totalBooked.toFixed(1)} h booked</span></p></div>
        </div>
      )}

      {tab === 'schedule' && (() => {
        const sectionMachines = active.filter(m => shownSections.some(sec => sec.match(m)))
        const withJobs = sectionMachines.filter(m => (woByMachine[m.id] || []).length > 0)
        const onIds = new Set(dayRuns.filter(r => r.run_date === planDate).map(r => r.machine_id))
        const onCount = sectionMachines.filter(m => onIds.has(m.id)).length
        const shift = (d: number) => { const x = new Date(planDate + 'T12:00:00'); x.setDate(x.getDate() + d); const v = ymdLocal(x); if (v >= todayStr) setPlanDate(v) }
        const dayLabel = planDate === todayStr ? 'Today' : new Date(planDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
        return (
          <section className="bg-white border border-[#E4E6EE] rounded-2xl overflow-hidden mb-6">
            <div className="px-5 py-4 border-b border-[#E4E6EE] flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[#1A1D2E]">Run plan · {dayLabel}</h2>
                <p className="text-xs text-gray-500">Pick the work orders each machine runs, then tap the machine for times and what to build. {onCount} machine{onCount === 1 ? '' : 's'} on.</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => shift(-1)} className="w-9 h-9 rounded-lg border border-[#E4E6EE] text-sm" aria-label="Previous day">‹</button>
                <input type="date" value={planDate} min={todayStr} onChange={e => e.target.value && setPlanDate(e.target.value)} className="h-9 rounded-lg border border-[#E4E6EE] px-2 text-sm" />
                <button onClick={() => shift(1)} className="w-9 h-9 rounded-lg border border-[#E4E6EE] text-sm" aria-label="Next day">›</button>
              </div>
            </div>
            {withJobs.length === 0 ? <p className="px-5 py-6 text-sm text-gray-500">No work orders are connected to these machines yet. Connect them from the production boards.</p> : (
              <ul className="divide-y divide-[#E4E6EE]">
                {withJobs.map(m => {
                  const runs = sched(planDate, m.id)
                  const on = runs.length > 0
                  const expanded = openPlan === m.id
                  const target = runs.reduce((t, r) => t + r.target_pcs, 0)
                  return (
                    <li key={m.id} className="px-5 py-3">
                      <button onClick={() => setOpenPlan(expanded ? null : m.id)} aria-expanded={expanded} className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 text-left">
                        <span className="font-mono font-bold text-[#1A1D2E] w-24">{m.machine_code}</span>
                        {(() => { const md = molds.find(x => x.machine_id === m.id); return md ? <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-[#EEF2FB] text-[#3A4A6B]">{md.child_sku} · {md.cavities} cav</span> : null })()}
                        {on ? (
                          <>
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">Turn on {fmtClock(runs[0].start)}</span>
                            <span className="text-xs text-gray-600">off {fmtClock(runs[runs.length - 1].end)}</span>
                            <span className="text-xs font-semibold text-[#1A1D2E]">{target > 0 ? `target ${fmtNum(target)} pcs` : 'no target yet'}</span>
                          </>
                        ) : <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#F2F4F8] text-gray-500">Off this day</span>}
                        <span className="ml-auto text-xs text-gray-400">{expanded ? 'Hide' : 'Details'}</span>
                      </button>
                      {expanded && (
                        <div className="mt-3 flex flex-col gap-3">
                          <div>
                            <p className="text-[11px] font-semibold text-gray-600 mb-1.5">Work orders to run on {m.machine_code}</p>
                            <div className="flex flex-wrap gap-2">
                              {(woByMachine[m.id] || []).map(w => {
                                const sel = isPlanned(planDate, m.id, w.id)
                                const k = planDate + m.id + w.id
                                return (
                                  <button key={w.id} disabled={planBusy === k} onClick={() => togglePlan(planDate, m.id, w.id)} aria-pressed={sel}
                                    className={`min-h-[36px] px-3 rounded-lg border text-xs font-semibold text-left disabled:opacity-50 ${sel ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-[#1A1D2E] border-[#D5DED7] hover:border-gray-400'}`}>
                                    {sel ? '✓ ' : '+ '}{woLabel(w)}{w.customer ? ` · ${w.customer}` : ''}{w.due_date ? ` · due ${w.due_date}` : ''}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                          {runs.length === 0 ? <p className="text-xs text-gray-500">Tap a work order above to run it on this day.</p> :
                            runs.map(sr => <PlanRunCard key={sr.run.work_order_id} sr={sr} canEdit
                              onTime={v => v && updateRun(sr.run, { start_time: v })}
                              onHours={v => updateRun(sr.run, { hours: v })} />)}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )
      })()}

      {/* Today's schedule: which machines to turn on, and when. Only connected work orders with a scheduled date appear. */}
      {tab === 'schedule' && (() => {
        const today = todayStr
        const todays = wos.filter(w => w.scheduled_date === today || isPlanned(today, w.machine_id, w.id))
          .sort((a, b) => String(a.scheduled_start ?? '99:99').localeCompare(String(b.scheduled_start ?? '99:99')))
        return (
          <section className="bg-white border border-[#E4E6EE] rounded-2xl overflow-hidden mb-6">
            <div className="px-5 py-4 border-b border-[#E4E6EE]">
              <h2 className="text-lg font-semibold text-[#1A1D2E]">Today's schedule</h2>
              <p className="text-xs text-gray-500">{today} · tap a line to open that machine</p>
            </div>
            {todays.length === 0 ? <p className="px-5 py-6 text-sm text-gray-500">Nothing scheduled for today on the connected machines.</p> : (
              <ul className="divide-y divide-[#E4E6EE]">
                {todays.map(w => {
                  const mc = rows.find(r => r.id === w.machine_id)
                  const running = mc?.run_wo_id === w.id && !!mc?.run_started_at
                  const paused = mc?.run_wo_id === w.id && !mc?.run_started_at
                  return (
                    <li key={w.id + w.machine_id}>
                      <button onClick={() => mc && setSelected(mc)} className="w-full text-left px-5 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 hover:bg-[#F5F6FA]">
                        <span className="font-mono font-bold text-[#1A1D2E] w-14">{w.scheduled_start ? w.scheduled_start.slice(0, 5) : 'No time'}</span>
                        <span className="font-mono font-semibold text-[#1A1D2E] w-24">{mc?.machine_code ?? '—'}</span>
                        <span className="text-sm text-[#1A1D2E] flex-1 min-w-[160px]">{woLabel(w)} · {w.sku || w.item_part_number || 'no item'}</span>
                        <span className="text-xs text-gray-600">{Number(w.scheduled_hours || 0).toFixed(1)} h</span>
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${running ? 'bg-emerald-50 text-emerald-700' : paused ? 'bg-amber-50 text-amber-800' : 'bg-[#F2F4F8] text-gray-600'}`}>
                          {running ? 'Running' : paused ? 'Paused' : 'Turn on'}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )
      })()}

      {tab === 'machines' && (loading ? <div className="py-20 text-center text-sm text-gray-500">Loading…</div> : shownSections.map(section => {
        const machines = active.filter(section.match)
        const booked = machines.reduce((s, m) => s + hoursOf(m.id), 0)
        const total = machines.length * CAPACITY_HOURS
        return (
          <section key={section.key} className="bg-white border border-[#E4E6EE] rounded-2xl overflow-hidden mb-6">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-[#E4E6EE]">
              <div>
                <h2 className="text-lg font-semibold text-[#1A1D2E]">{section.name}</h2>
                <p className="text-xs text-gray-500">{section.flow}</p>
              </div>
              <p className="text-xs text-gray-600">Open <span className="font-mono font-semibold">{Math.max(0, total - booked).toFixed(1)} h</span> of {total} h</p>
            </div>
            {machines.length === 0 ? <p className="px-5 py-8 text-sm text-gray-500">No machines in this section yet.</p> : (
              <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                {machines.map(m => {
                  const st = STATE[stateOf(m.status)]
                  const h = hoursOf(m.id)
                  const pctRaw = Math.round(h / CAPACITY_HOURS * 100)
                  const pct = Math.min(100, pctRaw)
                  const jobs = woByMachine[m.id] || []
                  const barColor = pct >= 90 ? '#E5541B' : pct >= 70 ? '#E0A21B' : '#1E9E6A'
                  return (
                    <button key={m.id} onClick={() => setSelected(m)} aria-label={`Open operator panel for ${m.machine_code}`}
                      className={`text-left rounded-xl border ${st.border} ${st.bg} p-3 flex flex-col gap-2 hover:shadow-md transition-shadow`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm font-bold text-[#1A1D2E] truncate">{m.machine_code}</span>
                        <span className={`flex items-center gap-1 text-[11px] font-semibold ${st.text}`}><span className={`w-2 h-2 rounded-full ${st.dot}`} />{st.label}</span>
                      </div>
                      <div className="flex items-center justify-center py-1 relative">
                        <div className={st.glow}><MachineIcon kind={kindOf(m)} pct={pct} color={barColor} size={64} /></div>
                        {jobs.length > 0 && <span className="absolute -top-1 right-2 min-w-[22px] h-[22px] px-1.5 rounded-full bg-[#13201A] text-white text-[11px] font-bold flex items-center justify-center font-mono">{jobs.length}</span>}
                      </div>
                      {!m.run_wo_id && m.setup_started_at && (
                        <div className="rounded-lg bg-white/80 border border-sky-200 px-2 py-1 text-center" title="Setup time before the work order starts">
                          <p className="font-mono font-bold text-sm text-sky-800">🔧 Setup {fmtHms(setupSec(m))}</p>
                        </div>
                      )}
                      {m.run_wo_id && (
                        <div className="rounded-lg bg-white/80 border border-amber-200 px-2 py-1 text-center" title="Estimate from the spec rate. Not added to inventory or the boards.">
                          <p className="font-mono font-bold text-sm text-[#1A1D2E]">≈ {m.run_rate ? fmtNum(Number(m.run_rate) * elapsedSec(m) / 3600) : '—'} <span className="text-[10px] font-normal text-gray-500">{molds.find(x => x.machine_id === m.id)?.child_sku || ''} pcs est.</span></p>
                          <p className="font-mono text-[10px] text-gray-500"><span className="text-emerald-700">▶ {fmtHms(elapsedSec(m))}</span>{downSec(m) >= 1 ? <span className="text-amber-700"> · ⏸ {fmtHms(downSec(m))}</span> : null}{m.run_rate ? '' : ' · no rate'}</p>
                        </div>
                      )}
                      <div>
                        <div className="flex justify-between text-[11px] text-gray-600"><span className={pctRaw > 100 ? 'text-red-600 font-semibold' : ''}>{pctRaw}% booked</span><span className="font-mono">{h > CAPACITY_HOURS ? `${(h / CAPACITY_HOURS).toFixed(1)} days queued` : `${Math.max(0, CAPACITY_HOURS - h).toFixed(1)} h open`}</span></div>
                        <div className="h-2 rounded-full bg-[#E6ECE7] overflow-hidden mt-1"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: barColor }} /></div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        )
      }))}

      {/* Operator panel */}
      {selected && (() => {
        const m = rows.find(r => r.id === selected.id) || selected
        const st = STATE[stateOf(m.status)]
        const jobs = woByMachine[m.id] || []
        const h = hoursOf(m.id)
        return (
          <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={() => setSelected(null)}>
            <aside role="dialog" aria-label="Operator panel" onClick={e => e.stopPropagation()}
              className="w-full max-w-md h-full overflow-y-auto bg-white p-6 flex flex-col gap-5 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">Operator panel · {m.equipment_group || 'Machine'}</p>
                  <h2 className="text-2xl font-bold text-[#1A1D2E] font-mono">{m.machine_code}</h2>
                  <p className="text-sm text-gray-500">{m.equipment_type || m.name}</p>
                </div>
                <button onClick={() => setSelected(null)} aria-label="Close" className="w-10 h-10 rounded-lg border border-[#E4E6EE] text-xl">×</button>
              </div>

              <div className={`rounded-2xl border ${st.border} ${st.bg} p-4 flex items-center gap-4`}>
                <div className={st.glow}><MachineIcon kind={kindOf(m)} pct={Math.min(100, Math.round(h / CAPACITY_HOURS * 100))} color={st.color} size={72} /></div>
                <div>
                  <p className={`text-sm font-bold ${st.text} flex items-center gap-2`}><span className={`w-2.5 h-2.5 rounded-full ${st.dot}`} />{st.label}</p>
                  <p className="text-xs text-gray-600 mt-1">{h.toFixed(1)} h queued of {CAPACITY_HOURS} h a day{h > CAPACITY_HOURS ? ` (about ${(h / CAPACITY_HOURS).toFixed(1)} days)` : ''}</p>
                  <p className="text-[11px] text-gray-500">From what's left on the connected work orders at the {learnedFor(m.id) ? 'actual' : 'spec'} rate.</p>
                </div>
              </div>

              {(() => {
                const runWo = jobs.find(w => w.id === m.run_wo_id) ?? wos.find(w => w.id === m.run_wo_id) ?? null
                const mState = m.run_wo_id ? (m.run_started_at ? 'running' : 'paused') : 'idle'
                const estPcs = m.run_rate && m.run_wo_id ? Number(m.run_rate) * elapsedSec(m) / 3600 : null
                const runUnit = runWo?.op?.qty_uom || runWo?.uom || 'units'
                return (
                  <div className="rounded-xl border border-[#E4E6EE] p-4 flex flex-col gap-3">
                    <p className="text-sm font-semibold text-[#1A1D2E]">Run</p>
                    {mState === 'idle' ? (
                      <div className="flex flex-col gap-2">
                        <select value={startWo} onChange={e => setStartWo(e.target.value)} className="min-h-[44px] rounded-lg border border-[#E4E6EE] px-3 text-sm bg-white">
                          <option value="">Choose a connected work order</option>
                          {jobs.map(w => <option key={w.id} value={w.id}>{woLabel(w)} · {w.sku || w.item_part_number || 'no item'}</option>)}
                        </select>
                        {m.setup_started_at ? (
                          <div className="rounded-lg bg-sky-50 border border-sky-200 p-3">
                            <p className="text-[11px] text-sky-900">Setup in progress{m.setup_wo_id ? ` for ${(() => { const w = jobs.find(j => j.id === m.setup_wo_id) ?? wos.find(j => j.id === m.setup_wo_id); return w ? woLabel(w) : 'a work order' })()}` : ''}</p>
                            <p className="text-2xl font-bold font-mono text-sky-900">🔧 {fmtHms(setupSec(m))}</p>
                            <button onClick={() => stopSetup(m)} className="mt-2 w-full min-h-[48px] rounded-xl bg-sky-600 text-white font-bold">Stop setup</button>
                            <p className="text-[11px] text-sky-800 mt-1">Starting the run also stops the setup clock.</p>
                          </div>
                        ) : (
                          <button onClick={() => startSetup(m)} className="min-h-[48px] rounded-xl border-2 border-sky-500 text-sky-700 font-bold bg-white">🔧 Start setup{startWo ? '' : ' (pick the work order above first, optional)'}</button>
                        )}
                        <button disabled={!startWo} onClick={() => { const w = jobs.find(j => j.id === startWo); if (w) startRun(m, w.id, w.rate ? w.rate.pieces_per_hour : null) }} className="min-h-[52px] rounded-xl bg-emerald-600 text-white font-bold disabled:opacity-40">Start run</button>
                        {(() => { const last = setups.find(x => x.machine_id === m.id && x.ended_at); return last ? <p className="text-[11px] text-gray-500">Last setup: {fmtHms(Number(last.minutes || 0) * 60)} · {new Date(last.started_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{last.operator ? ` · ${last.operator}` : ''}</p> : null })()}
                        {jobs.length === 0 && <p className="text-xs text-gray-500">No work orders connected to this machine. Connect one from its production board.</p>}
                      </div>
                    ) : (
                      <>
                        <p className="text-sm text-[#1A1D2E]">{runWo ? woLabel(runWo) : 'WO-?'} · {runWo?.sku || runWo?.item_part_number || ''}</p>
                        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                          <p className="text-[11px] text-amber-900">Estimate from the spec rate, for information only. Not in inventory.</p>
                          <p className="text-2xl font-bold font-mono text-[#1A1D2E]">{estPcs == null ? '—' : Math.floor(estPcs).toLocaleString()} <span className="text-xs font-normal text-gray-500">{molds.find(x => x.machine_id === m.id)?.child_sku ? molds.find(x => x.machine_id === m.id)!.child_sku + ' ' : ''}pcs</span></p>
                          <p className="text-xs text-gray-600 font-mono">{m.run_rate ? `${Math.round(Number(m.run_rate)).toLocaleString()} pcs/hr spec` : 'No spec rate'}</p>
                        </div>
                        <div className="rounded-lg border border-[#E4E6EE] p-3">
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div><p className="text-[10px] uppercase tracking-wide text-gray-400">Production time</p><p className="font-mono font-bold text-emerald-700">{fmtHms(elapsedSec(m))}</p></div>
                            <div><p className="text-[10px] uppercase tracking-wide text-gray-400">Downtime</p><p className="font-mono font-bold text-amber-700">{fmtHms(downSec(m))}</p></div>
                            <div><p className="text-[10px] uppercase tracking-wide text-gray-400">Uptime</p><p className="font-mono font-bold text-[#1A1D2E]">{uptimePct(m)}%</p></div>
                          </div>
                          <div className="mt-2 h-2.5 rounded-full bg-amber-200 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: uptimePct(m) + '%' }} /></div>
                          {(() => { const su = setups.filter(x => x.machine_id === m.id && x.ended_at && m.run_opened_at && Date.parse(x.ended_at) <= Date.parse(m.run_opened_at) + 60000 && Date.parse(x.ended_at) > Date.parse(m.run_opened_at) - 12 * 3600000); const mins = su.reduce((t, x) => t + Number(x.minutes || 0), 0); return mins > 0 ? <p className="text-[11px] text-sky-800 mt-1.5">🔧 Setup before this run: {fmtHms(mins * 60)}</p> : null })()}
                          <p className="text-[11px] text-gray-500 mt-1.5">
                            {m.run_opened_at ? `Started ${new Date(m.run_opened_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}
                            {` · ${m.run_pause_count || 0} pause${(m.run_pause_count || 0) === 1 ? '' : 's'}`}
                            {mState === 'paused' && m.run_paused_at ? ` · paused for ${fmtHms(Math.max(0, (now - Date.parse(m.run_paused_at)) / 1000))}` : ''}
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {mState === 'running'
                            ? <button onClick={() => pauseRun(m)} className="min-h-[52px] rounded-xl bg-amber-500 text-[#13201A] font-bold">Pause</button>
                            : <button onClick={() => startRun(m, m.run_wo_id as string, m.run_rate)} className="min-h-[52px] rounded-xl bg-emerald-600 text-white font-bold">Resume</button>}
                          <button onClick={() => openStop(m)} className="min-h-[52px] rounded-xl bg-red-600 text-white font-bold">Stop and book output</button>
                        </div>
                        {stopOpen && (
                          <div className="flex flex-col gap-2 border-t border-[#E4E6EE] pt-3">
                            {(() => {
                              const md = molds.find(x => x.machine_id === m.id)
                              if (md) return (
                                <label className="text-xs text-gray-600">Actual {md.child_sku} pieces produced (counted, not the estimate)
                                  <input inputMode="numeric" value={stopQty} onChange={e => setStopQty(e.target.value)} className="mt-1 w-full min-h-[44px] rounded-lg border border-[#E4E6EE] px-3 text-base text-[#1A1D2E]" />
                                  <span className="block mt-1 text-[11px] text-gray-500">Goes to {md.child_sku} on the inventory board. Pack-out into finished goods is logged on the production board.</span>
                                </label>)
                              if (stopLines.length) return (
                                <div className="flex flex-col gap-2">
                                  <p className="text-xs text-gray-600">Actual produced per SKU (counted, not the estimate). This is recorded on the production board and added to inventory.</p>
                                  {stopLines.map(l => (
                                    <label key={l.sku} className="text-xs text-gray-600 flex items-center gap-2">
                                      <span className="flex-1"><span className="font-mono font-semibold text-[#1A1D2E]">{l.sku}</span><span className="block text-[10px] text-gray-500">{fmtNum(l.left_units)} {(l.uom || '').toLowerCase()} left</span></span>
                                      <input inputMode="decimal" value={stopLineQty[l.sku] || ''} onChange={e => setStopLineQty(p => ({ ...p, [l.sku]: e.target.value }))} placeholder={(l.uom || 'qty').toLowerCase()} className="w-28 min-h-[40px] rounded-lg border border-[#E4E6EE] px-2 text-base text-[#1A1D2E]" />
                                    </label>
                                  ))}
                                </div>)
                              return (
                                <label className="text-xs text-gray-600">Actual produced ({runUnit})
                                  <input inputMode="decimal" value={stopQty} onChange={e => setStopQty(e.target.value)} className="mt-1 w-full min-h-[44px] rounded-lg border border-[#E4E6EE] px-3 text-base text-[#1A1D2E]" />
                                </label>)
                            })()}
                            <label className="text-xs text-gray-600">Note (optional)
                              <input value={stopNote} onChange={e => setStopNote(e.target.value)} className="mt-1 w-full min-h-[44px] rounded-lg border border-[#E4E6EE] px-3 text-base text-[#1A1D2E]" />
                            </label>
                            <button disabled={stopBusy} onClick={() => stopRun(m)} className="min-h-[48px] rounded-xl bg-[#1A1D2E] text-white font-bold disabled:opacity-40">
                              {stopBusy ? 'Booking…' : 'Confirm actual and book to inventory'}
                            </button>
                          </div>
                        )}
 <button onClick={() => cancelRun(m)} className="text-xs font-semibold text-gray-500 underline self-start">Cancel run (test or mistake, books nothing)</button>
                        {stopMsg && <p role="status" className={`text-xs ${stopMsg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{stopMsg.text}</p>}
                      </>
                    )}
                  </div>
                )
              })()}

              {(() => {
                const lr = learnedFor(m.id)
                const md = molds.find(x => x.machine_id === m.id)
                const spec = md ? md.cavities * 3600 / Number(md.cycle_sec) : lr?.spec_pph ?? null
                return (
                  <div className="rounded-xl border border-[#E4E6EE] p-4 text-xs text-gray-600">
                    <p className="text-sm font-semibold text-[#1A1D2E] mb-1">Actual output rate</p>
                    {lr ? <p><b className="text-[#1A1D2E]">{fmtNum(lr.pph)} {md?.child_sku ? md.child_sku + ' ' : ''}pcs/hr</b> over the last {lr.runs} run{lr.runs === 1 ? '' : 's'}{spec ? ` · ${Math.round(lr.pph / spec * 100)}% of spec (${fmtNum(spec)}/hr)` : ''}. Estimates and plan targets use this.</p>
                      : <p>No reported runs yet. Estimates use the spec rate until the operator books an actual. Each Stop updates this from the last 5 runs.</p>}
                  </div>
                )
              })()}

              {m.equipment_group === 'MOLDING' && <MoldEditor sb={sb} machine={m} mold={molds.find(x => x.machine_id === m.id)} pieces={pieces} onSaved={() => { loadMolds(); loadPlanLines() }} />}

              {(() => {
                const runs = sched(todayStr, m.id)
                return (
                  <div>
                    <h3 className="text-sm font-semibold text-[#1A1D2E] mb-2">Today's plan</h3>
                    {runs.length === 0 ? <p className="text-sm text-gray-500">Not on today's run plan. Plan it in the Schedule tab.</p> :
                      <div className="flex flex-col gap-2">{runs.map(sr => <PlanRunCard key={sr.run.work_order_id} sr={sr} canEdit={false} />)}</div>}
                  </div>
                )
              })()}

              <label className="text-xs text-gray-600">Operator
                <select value={operator} onChange={e => setOperator(e.target.value)} className="mt-1 w-full min-h-[44px] rounded-lg border border-[#E4E6EE] px-3 text-base text-[#1A1D2E] bg-white">
                  <option value="">Who is running this machine?</option>
                  {['Warehouse Operations', 'Manufacturing', 'Shipping/Receiving'].map(d => {
                    const people = staff.filter(e => e.department === d)
                    return people.length ? <optgroup key={d} label={d}>{people.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}</optgroup> : null
                  })}
                  {operator && !staff.some(e => e.name === operator) && <option value={operator}>{operator}</option>}
                </select>
              </label>

              <div>
                <h3 className="text-sm font-semibold text-[#1A1D2E] mb-2">Connected work orders ({jobs.length})</h3>
                {jobs.length === 0 ? <p className="text-sm text-gray-500">None connected. Connect a work order from its production board.</p> : (
                  <ul className="flex flex-col gap-3">
                    {jobs.map(w => <JobCard key={w.id} w={w} qh={queueHrs(m.id, w.id)} />)}
                  </ul>
                )}
              </div>

              <button onClick={() => { setSelected(null); openEdit(m) }} className="mt-auto text-sm font-semibold border border-[#E4E6EE] rounded-lg py-2.5 text-gray-600 hover:text-gray-900">Edit machine details</button>
            </aside>
          </div>
        )
      })()}

      {/* Add / edit machine */}
      <div className={`fixed inset-0 bg-black/50 z-50 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={close} />
      <div onClick={e => e.stopPropagation()} className={`fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] md:w-full md:max-w-[560px] max-h-[90vh] bg-white rounded-2xl border border-[#E4E6EE] flex flex-col shadow-2xl overflow-hidden transition-all duration-200 ease-out ${open ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E4E6EE] shrink-0"><h2 className="text-[#1A1D2E] font-semibold">{editing ? 'Edit Machine' : 'Add Machine'}</h2><div className="flex items-center gap-2">{editing && <ShareLink id={editing.id} />}<button onClick={close} className="text-gray-500 hover:text-gray-700 p-1 rounded-lg hover:bg-[#F5F6FA]">×</button></div></div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div><label className="block text-xs text-gray-400 mb-1.5">Machine Name <span className="text-red-400">*</span></label><input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className={inp} /></div>
          <div><label className="block text-xs text-gray-400 mb-1.5">Machine Code <span className="text-red-400">*</span></label><input value={form.machine_code} onChange={e => setForm(p => ({ ...p, machine_code: e.target.value }))} className={inp} /></div>
          <div><label className="block text-xs text-gray-400 mb-1.5">Status</label><select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))} className={inp + ' cursor-pointer'}>{['Running', 'Paused', 'Idle', 'Maintenance', 'Down'].map(s => <option key={s} value={s}>{s}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-gray-400 mb-1.5">Department</label><input value={form.equipment_group} onChange={e => setForm(p => ({ ...p, equipment_group: e.target.value }))} placeholder="e.g. MOLDING" className={inp} /></div>
            <div><label className="block text-xs text-gray-400 mb-1.5">Equipment Type</label><input value={form.equipment_type} onChange={e => setForm(p => ({ ...p, equipment_type: e.target.value }))} placeholder="e.g. Injection Molding" className={inp} /></div>
          </div>
          <div><label className="block text-xs text-gray-400 mb-1.5">Location</label><input value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} className={inp} /></div>
          <div className="bg-[#F5F6FA] rounded-xl border border-[#E4E6EE] p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Equipment Details</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs text-gray-400 mb-1.5">Make</label><input value={form.make} onChange={e => setForm(p => ({ ...p, make: e.target.value }))} placeholder="e.g. Hwamda" className={inp} /></div>
              <div><label className="block text-xs text-gray-400 mb-1.5">Model</label><input value={form.model} onChange={e => setForm(p => ({ ...p, model: e.target.value }))} placeholder="e.g. HMD270M8-SPV" className={inp} /></div>
            </div>
            <div><label className="block text-xs text-gray-400 mb-1.5">Serial Number</label><input value={form.serial_number} onChange={e => setForm(p => ({ ...p, serial_number: e.target.value }))} className={inp + ' font-mono'} /></div>
            <div><label className="block text-xs text-gray-400 mb-1.5">Description</label><input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="e.g. 180 TN Molding Machine" className={inp} /></div>
          </div>
          <div><label className="block text-xs text-gray-400 mb-1.5">Notes</label><textarea rows={3} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} className={inp + ' resize-none'} /></div>
        </div>
        <div className="shrink-0 px-6 py-4 border-t border-[#E4E6EE] space-y-3">
          {err && <p className="text-red-500 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">{err}</p>}
          <div className="flex gap-3">
            {editing && <button onClick={handleDelete} className="text-sm px-3 py-2.5 rounded-lg border border-red-300 bg-red-50 text-red-600">Delete</button>}
            {editing && <button onClick={toggleArchive} className="text-sm px-3 py-2.5 rounded-lg border border-[#E4E6EE] text-gray-500">{editing.is_active ? 'Archive' : 'Restore'}</button>}
            <button onClick={close} className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-[#E4E6EE] text-gray-500">Cancel</button>
            <button onClick={save} disabled={saving} className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 text-[#1A1D2E] text-sm font-medium px-4 py-2.5 rounded-lg">{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
