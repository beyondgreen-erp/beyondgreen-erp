'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
// Next-day planner for the Walmart work order: which machines run, for how long, making what,
// and what gets packed on each shift — first priority (earliest pick-up) first, then the next.
// Everything is editable: mold set-up, pack rates, settings, and the draft plan itself.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { planDay, suggest, PIECE_LIST, PIECE_NAME, type Piece, type PlannerInput, type PlannerResult, type Suggestion } from '@/lib/walmartPlanner'

type SB = any
const ACCENT = '#0071ce'
const PRIO = ['#e2445c', '#fdab3d', '#579bfc', '#a25ddc', '#00c875', '#9699a6']
const prioColor = (r: number) => (r ? PRIO[Math.min(r, PRIO.length) - 1] : '#c4c4c4')
const PIECE_COLOR: Record<Piece, string> = { BGFRK: '#579bfc', BGSPN: '#00c875', BGKNF: '#e2445c' }
const SKU_NAME: Record<string, string> = { '22GVA24': 'Assorted 24', '22GVA48': 'Assorted 48', '22GVF24': 'Fork 24', '22GVF48': 'Fork 48', '22GVK48': 'Knife 48', '22GVS24': 'Spoon 24', '22GVS48': 'Spoon 48' }
const short = (s: string) => SKU_NAME[s] || s
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const fmtN = (v: any, d = 0) => num(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 })
const pad = (n: number) => String(n).padStart(2, '0')
const addDays = (s: string, n: number) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const fmtDay = (s: string) => new Date(s + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
const clock = (start: string, h: number) => {
  const [hh, mm] = (start || '06:00').split(':').map(Number)
  const t = Math.round(((hh || 0) * 60 + (mm || 0) + h * 60)) % (24 * 60)
  const H = Math.floor(t / 60), M = t % 60
  return `${((H + 11) % 12) + 1}:${pad(M)} ${H < 12 ? 'AM' : 'PM'}`
}

export interface PlannerGroup { key: string; label: string; rank: number; pickup: string | null; todo: Record<string, number> }
export interface PlannerMach { id: string; machine_code: string; status: string | null }

interface Settings { shifts: number; shift_hours: number; overlap_hours: number; packers_per_shift: number; manual_packing: boolean; efficiency_pct: number; mold_ahead: boolean; start_time: string; strategy: 'fewest' | 'fastest' }
interface MoldRow { machine_code: string; piece: Piece; cavities: number; cycle_sec: number; available: boolean; notes: string | null; _new?: boolean }
interface RateRow { sku: string; srp_per_hour: number; people: number; notes: string | null; _new?: boolean }
interface DraftRun { key: string; machine_id: string; code: string; piece: Piece; hours: number; target_pcs: number; skus: string[]; operator: string; notes: string }
interface DraftPack { key: string; shift: number; sku: string; srps: number; people: number; hours: number; notes: string }

const DEFAULT_SETTINGS: Settings = { shifts: 2, shift_hours: 12, overlap_hours: 1, packers_per_shift: 1, manual_packing: true, efficiency_pct: 100, mold_ahead: true, start_time: '06:00', strategy: 'fewest' }
const inputCls = 'h-9 rounded-lg border border-[#E4E6EE] px-2 text-sm bg-white w-full'
const uid = () => Math.random().toString(36).slice(2, 10)

export default function WalmartDayPlanner({ sb, wo, groups, machs, bomPcs, today, canEdit, onClose, onSaved }: {
  sb: SB; wo: { id: string; wo_code: string | null }; groups: PlannerGroup[]; machs: PlannerMach[]
  bomPcs: Record<string, Record<string, number>>; today: string; canEdit: boolean
  onClose: () => void; onSaved: (msg: string) => void
}) {
  const [tab, setTab] = useState<'plan' | 'molds' | 'rates' | 'settings'>('plan')
  const [date, setDate] = useState(addDays(today, 1))
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [molds, setMolds] = useState<MoldRow[]>([])
  const [rates, setRates] = useState<RateRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')
  // per-day choices (not saved as defaults)
  const [incl, setIncl] = useState<Record<string, boolean>>({})
  const [todoEdit, setTodoEdit] = useState<Record<string, string>>({})
  const [dayAvail, setDayAvail] = useState<Record<string, boolean>>({})
  const [dayPiece, setDayPiece] = useState<Record<string, Piece>>({})
  const [stockIn, setStockIn] = useState<Record<string, string>>({})
  const [askedPacking, setAskedPacking] = useState(false)
  // draft that gets sent to the Daily Plan
  const [draftRuns, setDraftRuns] = useState<DraftRun[] | null>(null)
  const [draftPack, setDraftPack] = useState<DraftPack[] | null>(null)
  const [saved, setSaved] = useState<{ runs: any[]; pack: any[] }>({ runs: [], pack: [] })

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    const [sR, mR, rR] = await Promise.all([
      sb.from('walmart_planner_settings').select('*').eq('id', 1).maybeSingle(),
      sb.from('walmart_mold_config').select('*').order('machine_code'),
      sb.from('walmart_pack_rates').select('*').order('sku'),
    ])
    if (sR.error || mR.error || rR.error) setErr((sR.error || mR.error || rR.error).message)
    if (sR.data) setSettings({ ...DEFAULT_SETTINGS, ...sR.data, shifts: num(sR.data.shifts), shift_hours: num(sR.data.shift_hours), overlap_hours: num(sR.data.overlap_hours), packers_per_shift: num(sR.data.packers_per_shift), efficiency_pct: num(sR.data.efficiency_pct) })
    setMolds(((mR.data as any[]) || []).map(m => ({ ...m, cavities: num(m.cavities), cycle_sec: num(m.cycle_sec) }))
      .sort((a, b) => a.machine_code.localeCompare(b.machine_code, undefined, { numeric: true })))
    setRates(((rR.data as any[]) || []).map(r => ({ ...r, srp_per_hour: num(r.srp_per_hour), people: num(r.people) })))
    setLoading(false)
  }, [sb])
  useEffect(() => { load() }, [load])

  const loadSaved = useCallback(async () => {
    const [rR, pR] = await Promise.all([
      sb.from('walmart_machine_runs').select('*').eq('work_order_id', wo.id).eq('run_date', date),
      sb.from('walmart_pack_runs').select('*').eq('work_order_id', wo.id).eq('run_date', date).order('shift'),
    ])
    setSaved({ runs: (rR.data as any[]) || [], pack: (pR.data as any[]) || [] })
  }, [sb, wo.id, date])
  useEffect(() => { loadSaved() }, [loadSaved])

  const machByCode = useMemo(() => Object.fromEntries(machs.map(m => [m.machine_code.toUpperCase(), m])), [machs])
  const horizon = Math.max(0, settings.shifts * settings.shift_hours - settings.overlap_hours * Math.max(0, settings.shifts - 1))

  const input: PlannerInput = useMemo(() => ({
    groups: groups.filter(g => incl[g.key] !== false).map(g => ({
      key: g.key, label: g.label, rank: g.rank,
      todo: Object.fromEntries(Object.entries(g.todo).map(([s, q]) => [s, Math.max(0, todoEdit[g.key + '|' + s] !== undefined ? num(todoEdit[g.key + '|' + s]) : q)])),
    })),
    bom: bomPcs,
    machines: molds.filter(m => machByCode[m.machine_code.toUpperCase()]).map(m => {
      const mc = machByCode[m.machine_code.toUpperCase()]
      const avail = dayAvail[m.machine_code] ?? (m.available && (mc.status || '') !== 'Down')
      return { id: mc.id, code: m.machine_code, piece: dayPiece[m.machine_code] || m.piece, rate: m.cavities * 3600 / Math.max(1, m.cycle_sec) * settings.efficiency_pct / 100, available: avail }
    }),
    horizonH: horizon,
    pieceStock: Object.fromEntries(PIECE_LIST.map(p => [p, num(stockIn[p])])),
    manualPacking: settings.manual_packing,
    packRates: Object.fromEntries(rates.map(r => [r.sku, { perHour: r.srp_per_hour, people: r.people }])),
    shifts: Array.from({ length: settings.shifts }, (_, i) => ({ n: i + 1, hours: settings.shift_hours, packers: settings.packers_per_shift })),
    moldAhead: settings.mold_ahead,
    strategy: settings.strategy,
  }), [groups, incl, todoEdit, bomPcs, molds, machByCode, dayAvail, dayPiece, settings, horizon, stockIn, rates])

  const result: PlannerResult = useMemo(() => planDay(input), [input])
  const tips: Suggestion[] = useMemo(() => (molds.length ? suggest(input, result) : []), [input, result, molds.length])

  // draft from the result (re-made whenever the user presses "Use this plan")
  const buildDraft = () => {
    const byM: Record<string, DraftRun> = {}
    for (const sg of result.segments) {
      const d = byM[sg.machineId] || (byM[sg.machineId] = { key: uid(), machine_id: sg.machineId, code: sg.code, piece: sg.piece, hours: 0, target_pcs: 0, skus: [], operator: '', notes: '' })
      d.hours += sg.end - sg.start; d.target_pcs += sg.pcs
      for (const s of sg.skus) if (!d.skus.includes(s)) d.skus.push(s)
      const tag = `${sg.ahead ? 'ahead for ' : ''}P${groups.find(g => g.key === sg.groupKey)?.rank || '–'} ${sg.label}: ${fmtN(sg.end - sg.start, 1)} h`
      d.notes = d.notes ? `${d.notes}; ${tag}` : tag
    }
    setDraftRuns(Object.values(byM).map(d => ({ ...d, hours: Math.round(d.hours * 4) / 4 || 0.25 }))
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })))
    const pk: Record<string, DraftPack> = {}
    for (const l of result.pack) {
      const k = l.shift + '|' + l.sku
      const d = pk[k] || (pk[k] = { key: uid(), shift: l.shift, sku: l.sku, srps: 0, people: l.people, hours: 0, notes: '' })
      d.srps += l.srps; d.hours += l.hours
    }
    setDraftPack(Object.values(pk).sort((a, b) => a.shift - b.shift))
    setMsg('Draft ready — edit anything below, then send it to the Daily Plan.')
  }

  const rateOf = (code: string) => { const m = molds.find(x => x.machine_code === code); return m ? m.cavities * 3600 / Math.max(1, m.cycle_sec) * settings.efficiency_pct / 100 : 0 }
  const packRate = (sku: string) => rates.find(r => r.sku === sku)

  async function sendToDailyPlan() {
    if (!draftRuns || !draftPack) return
    if (!window.confirm(`This replaces ${wo.wo_code || 'this WO'}'s machine and packing plan for ${fmtDay(date)} on the Daily Plan. Continue?`)) return
    setBusy('send'); setErr('')
    const runs = draftRuns.filter(r => r.hours > 0).map(r => ({ machine_id: r.machine_id, piece: r.piece, skus: r.skus, target_pcs: Math.round(r.target_pcs), hours: r.hours, operator: r.operator || null, notes: r.notes || null }))
    const { error: e1 } = await sb.rpc('walmart_machine_plan_save', { p_date: date, p_wo: wo.id, p_runs: runs })
    if (e1) { setBusy(''); setErr(e1.message); return }
    const lines = draftPack.filter(p => p.srps > 0).map(p => ({ shift: p.shift, sku: p.sku, srps: Math.round(p.srps), people: p.people, hours: Math.round(p.hours * 10) / 10, notes: p.notes || null }))
    const { error: e2 } = await sb.rpc('walmart_pack_plan_save', { p_date: date, p_wo: wo.id, p_lines: settings.manual_packing ? lines : [] })
    setBusy('')
    if (e2) { setErr(e2.message); return }
    await loadSaved()
    onSaved(`✓ Plan for ${fmtDay(date)} sent to the Daily Plan — ${runs.length} machine${runs.length === 1 ? '' : 's'}${settings.manual_packing ? `, ${lines.length} packing line${lines.length === 1 ? '' : 's'}` : ''}.`)
  }
  async function clearSaved() {
    if (!window.confirm(`Remove ${wo.wo_code || 'this WO'}'s saved machine and packing plan for ${fmtDay(date)} from the Daily Plan?`)) return
    setBusy('clear')
    const a = await sb.rpc('walmart_machine_plan_save', { p_date: date, p_wo: wo.id, p_runs: [] })
    const b = await sb.rpc('walmart_pack_plan_save', { p_date: date, p_wo: wo.id, p_lines: [] })
    setBusy('')
    if (a.error || b.error) { setErr((a.error || b.error).message); return }
    await loadSaved(); setMsg('Saved plan for that day removed.')
  }
  function loadSavedIntoDraft() {
    const byId = Object.fromEntries(machs.map(m => [m.id, m.machine_code]))
    setDraftRuns(saved.runs.map(r => ({ key: uid(), machine_id: r.machine_id, code: byId[r.machine_id] || '?', piece: r.piece, hours: num(r.hours), target_pcs: num(r.target_pcs), skus: r.skus || [], operator: r.operator || '', notes: r.notes || '' })))
    setDraftPack(saved.pack.map(p => ({ key: uid(), shift: p.shift, sku: p.sku, srps: num(p.srps), people: num(p.people), hours: num(p.hours), notes: p.notes || '' })))
    setMsg('Loaded the saved plan into the draft.')
  }

  // ── settings / molds / rates persistence
  async function saveSettings() {
    setBusy('settings')
    const { error } = await sb.from('walmart_planner_settings').upsert({ id: 1, ...settings, updated_at: new Date().toISOString() })
    setBusy(''); if (error) setErr(error.message); else setMsg('Settings saved as the default.')
  }
  async function saveMold(m: MoldRow) {
    if (!m.machine_code.trim()) { setErr('Pick a machine.'); return }
    setBusy('mold' + m.machine_code)
    const { error } = await sb.from('walmart_mold_config').upsert({ machine_code: m.machine_code.trim().toUpperCase(), piece: m.piece, cavities: Math.max(1, Math.round(m.cavities)), cycle_sec: Math.max(1, m.cycle_sec), available: m.available, notes: m.notes, updated_at: new Date().toISOString() })
    setBusy(''); if (error) { setErr(error.message); return }
    setDayPiece(d => { const n = { ...d }; delete n[m.machine_code]; return n })
    setMsg(`${m.machine_code} saved.`); load()
  }
  async function deleteMold(m: MoldRow) {
    if (m._new) { setMolds(x => x.filter(y => y !== m)); return }
    if (!window.confirm(`Remove ${m.machine_code} from the Walmart mold set-up? The planner will stop using it.`)) return
    const { error } = await sb.from('walmart_mold_config').delete().eq('machine_code', m.machine_code)
    if (error) setErr(error.message); else { setMsg(`${m.machine_code} removed.`); load() }
  }
  async function saveRate(r: RateRow) {
    if (!r.sku.trim()) { setErr('Enter the SKU.'); return }
    setBusy('rate' + r.sku)
    const { error } = await sb.from('walmart_pack_rates').upsert({ sku: r.sku.trim().toUpperCase(), srp_per_hour: Math.max(0.1, r.srp_per_hour), people: Math.max(1, Math.round(r.people)), notes: r.notes, updated_at: new Date().toISOString() })
    setBusy(''); if (error) setErr(error.message); else { setMsg(`${r.sku} packing rate saved.`); load() }
  }
  async function deleteRate(r: RateRow) {
    if (r._new) { setRates(x => x.filter(y => y !== r)); return }
    if (!window.confirm(`Delete the packing rate for ${r.sku}?`)) return
    const { error } = await sb.from('walmart_pack_rates').delete().eq('sku', r.sku)
    if (error) setErr(error.message); else load()
  }
  function applyTip(t: Suggestion) {
    const code = molds.find(m => machByCode[m.machine_code.toUpperCase()]?.id === t.machineId)?.machine_code
    if (t.kind === 'swap' && code && t.piece) setDayPiece(d => ({ ...d, [code]: t.piece! }))
    if (t.kind === 'start' && code) setDayAvail(d => ({ ...d, [code]: true }))
    if (t.kind === 'packer') setSettings(s => ({ ...s, packers_per_shift: s.packers_per_shift + 1 }))
    setMsg(`Applied for ${fmtDay(date)}: ${t.text}. (Save it on the Molds tab to make it permanent.)`)
  }

  const g1 = result.groups.find(g => g.totalTodo > 0)
  const usedMachines = new Set(result.segments.map(s => s.machineId))

  const body = (
    <div className="fixed inset-0 z-[110] overflow-y-auto overscroll-contain flex flex-col sm:p-4" style={{ background: 'rgba(26,32,53,0.55)', paddingTop: 'max(10px, env(safe-area-inset-top))' }}>
      <div className="w-full sm:max-w-6xl mt-auto sm:my-auto sm:mx-auto bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col">
        {/* header */}
        <div className="sticky top-0 z-10 bg-white rounded-t-3xl sm:rounded-t-2xl px-5 pt-4 pb-3 border-b border-[#EEF0F4]" style={{ top: 'env(safe-area-inset-top)' }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-400">{wo.wo_code || 'Walmart WO'} · next-day planner</p>
              <h2 className="text-lg font-bold text-[#1A1D2E]">Production plan for {fmtDay(date)}</h2>
            </div>
            <button onClick={onClose} className="text-gray-400 text-3xl leading-none px-2" aria-label="Close"><span className="text-sm font-semibold align-middle mr-1">Back</span>&times;</button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {(['plan', 'molds', 'rates', 'settings'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} className={`h-9 px-4 rounded-full text-sm font-semibold ${tab === t ? 'text-white' : 'bg-[#F2F4F8] text-gray-600'}`} style={tab === t ? { background: ACCENT } : undefined}>
                {t === 'plan' ? 'Plan' : t === 'molds' ? 'Machines & molds' : t === 'rates' ? 'Packing rates' : 'Shift settings'}
              </button>))}
            <div className="flex-1" />
            <label className="text-xs text-gray-500 flex items-center gap-2">Plan date
              <input type="date" value={date} min={today} onChange={e => { setDate(e.target.value); setDraftRuns(null); setDraftPack(null) }} className="h-9 rounded-lg border border-[#E4E6EE] px-2 text-sm" />
            </label>
          </div>
          {(err || msg) && <p className={`mt-2 text-sm rounded-lg px-3 py-2 ${err ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}`} onClick={() => { setErr(''); setMsg('') }}>{err || msg}</p>}
        </div>

        <div className="px-5 py-4 space-y-5">
          {loading ? <p className="text-sm text-gray-400">Loading…</p> : tab === 'plan' ? <>
            {/* manual packing question */}
            <div className={`rounded-2xl border-2 p-4 ${askedPacking ? 'border-[#ECEEF3]' : 'border-[#fdab3d] bg-amber-50/40'}`}>
              <p className="font-bold text-[#1A1D2E]">Is manual packing required on {fmtDay(date)}?</p>
              <p className="text-xs text-gray-500 mt-0.5">If yes, the plan only schedules what the packers can pack ({settings.shifts} shift{settings.shifts === 1 ? '' : 's'} × {settings.packers_per_shift} packer{settings.packers_per_shift === 1 ? '' : 's'} × {settings.shift_hours} h = {fmtN(settings.shifts * settings.packers_per_shift * settings.shift_hours)} packer-hours).</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {[true, false].map(v => (
                  <button key={String(v)} onClick={() => { setSettings(s => ({ ...s, manual_packing: v })); setAskedPacking(true) }}
                    className={`h-10 px-5 rounded-xl text-sm font-bold border-2 ${settings.manual_packing === v ? 'text-white' : 'bg-white text-gray-600 border-[#E4E6EE]'}`}
                    style={settings.manual_packing === v ? { background: ACCENT, borderColor: ACCENT } : undefined}>{v ? 'Yes — plan the packers' : 'No — molding only'}</button>))}
                {settings.manual_packing && <label className="text-xs text-gray-500 flex items-center gap-2 ml-2">Packers per shift
                  <input type="number" min={0} value={settings.packers_per_shift} onChange={e => setSettings(s => ({ ...s, packers_per_shift: Math.max(0, Math.round(num(e.target.value))) }))} className="w-16 h-9 rounded-lg border border-[#E4E6EE] px-2 text-sm" /></label>}
              </div>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Kpi label="Priority 1 covered" value={g1 ? `${fmtN(g1.totalPlanned)} / ${fmtN(g1.totalTodo)} SRP` : 'Nothing open'} sub={g1 ? `${Math.round(100 * g1.totalPlanned / Math.max(1, g1.totalTodo))}% · slowest SKU ${Math.round(g1.z * 100)}%` : ''} color={g1 && g1.totalPlanned >= g1.totalTodo ? '#00a85a' : '#e2445c'} />
              <Kpi label="Machine run time" value={`${horizon} h available`} sub={`${usedMachines.size} of ${input.machines.filter(m => m.available).length} machines used`} color={ACCENT} />
              <Kpi label="Packing" value={settings.manual_packing ? `${fmtN(result.packHoursUsed, 1)} / ${fmtN(result.packHoursAvail, 0)} h` : 'Not planned'} sub={settings.manual_packing ? 'packer-hours used' : 'molding only'} color="#a25ddc" />
              <Kpi label="Pieces to mold" value={PIECE_LIST.filter(p => result.piecesMade[p] > 0).map(p => `${PIECE_NAME[p]} ${fmtN(result.piecesMade[p] / 1000, 0)}k`).join(' · ') || '—'} sub="incl. molding ahead" color="#0086c0" />
            </div>

            {(result.bottlenecks.length > 0 || result.warnings.length > 0) && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 space-y-1">
                {result.bottlenecks.map(b => <p key={b}><b>Holding back priority 1:</b> {b}</p>)}
                {result.warnings.map(w => <p key={w} className="text-amber-800">⚠ {w}</p>)}
              </div>)}

            {tips.length > 0 && (
              <div className="rounded-2xl border border-[#ECEEF3] overflow-hidden">
                <div className="px-4 py-2 bg-[#F7F9FC] text-sm font-bold text-[#1A1D2E]">Suggestions</div>
                {tips.map((t, i) => (
                  <div key={i} className="px-4 py-2.5 border-t border-[#F0F2F6] flex flex-wrap items-center gap-3 text-sm">
                    <span className="flex-1 min-w-[200px]">💡 {t.text}</span>
                    <span className="text-xs font-semibold text-emerald-700">{t.gainP1 > 0 ? `+${fmtN(t.gainP1)} SRP for priority 1` : ''}{t.gainP2 > 0 ? ` · +${fmtN(t.gainP2)} for priority 2` : ''}</span>
                    <button onClick={() => applyTip(t)} className="h-8 px-3 rounded-lg text-xs font-bold border" style={{ borderColor: ACCENT, color: ACCENT }}>Try it</button>
                  </div>))}
              </div>)}

            {/* demand by priority */}
            <section>
              <h3 className="text-sm font-bold text-[#1A1D2E] mb-2">What has to be made — by pick-up priority</h3>
              {groups.length === 0 ? <p className="text-sm text-gray-400">No open POs on this work order.</p> : groups.map(g => {
                const rg = result.groups.find(x => x.key === g.key)
                const on = incl[g.key] !== false
                return (
                  <div key={g.key} className={`rounded-2xl border border-[#ECEEF3] mb-2 overflow-hidden ${on ? '' : 'opacity-50'}`} style={{ borderLeft: `5px solid ${prioColor(g.rank)}` }}>
                    <div className="px-4 py-2 flex flex-wrap items-center gap-3 bg-[#FAFBFD]">
                      <label className="flex items-center gap-2 text-sm font-bold text-[#1A1D2E]">
                        <input type="checkbox" checked={on} onChange={e => setIncl(x => ({ ...x, [g.key]: e.target.checked }))} />
                        {g.rank ? `P${g.rank} · ` : ''}{g.label}
                      </label>
                      {g.pickup && <span className="text-xs text-gray-500">pick-up {fmtDay(g.pickup)}</span>}
                      <div className="flex-1" />
                      {rg && rg.totalTodo > 0 && <span className={`text-xs font-bold ${rg.totalPlanned >= rg.totalTodo ? 'text-emerald-700' : 'text-amber-700'}`}>{fmtN(rg.totalPlanned)} of {fmtN(rg.totalTodo)} SRP planned</span>}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[560px]">
                        <thead><tr className="text-[10px] uppercase text-gray-400"><th className="text-left px-4 py-1.5">SKU</th><th className="text-right px-2">Still to make (SRP)</th><th className="text-right px-2">Planned</th><th className="text-right px-2">Short</th><th className="text-left px-3">Pieces per SRP</th></tr></thead>
                        <tbody>{Object.keys(g.todo).filter(s => g.todo[s] > 0 || todoEdit[g.key + '|' + s] !== undefined).map(s => {
                          const t = todoEdit[g.key + '|' + s] !== undefined ? num(todoEdit[g.key + '|' + s]) : g.todo[s]
                          const p = rg?.planned[s] || 0
                          return (
                            <tr key={s} className="border-t border-[#F0F2F6]">
                              <td className="px-4 py-1.5 font-semibold">{short(s)} <span className="text-[10px] text-gray-400 font-mono">{s}</span></td>
                              <td className="px-2 text-right"><input inputMode="numeric" value={todoEdit[g.key + '|' + s] ?? String(g.todo[s])} onChange={e => setTodoEdit(x => ({ ...x, [g.key + '|' + s]: e.target.value.replace(/[^\d]/g, '') }))} className="w-20 h-8 rounded-lg border border-[#E4E6EE] text-right px-2" /></td>
                              <td className="px-2 text-right font-bold">{fmtN(p)}</td>
                              <td className={`px-2 text-right ${t - p > 0 ? 'text-red-600 font-semibold' : 'text-gray-300'}`}>{t - p > 0 ? fmtN(t - p) : '—'}</td>
                              <td className="px-3 text-xs text-gray-500">{PIECE_LIST.filter(pc => num(bomPcs[s]?.[pc]) > 0).map(pc => `${num(bomPcs[s][pc])} ${PIECE_NAME[pc].toLowerCase()}`).join(' + ') || '—'}</td>
                            </tr>)
                        })}</tbody>
                      </table>
                    </div>
                  </div>)
              })}
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                Loose pieces already molded (not yet packed):
                {PIECE_LIST.map(p => <label key={p} className="flex items-center gap-1">{PIECE_NAME[p]}<input inputMode="numeric" value={stockIn[p] ?? ''} placeholder="0" onChange={e => setStockIn(x => ({ ...x, [p]: e.target.value.replace(/[^\d]/g, '') }))} className="w-24 h-8 rounded-lg border border-[#E4E6EE] px-2 text-right" /></label>)}
              </div>
            </section>

            {/* machine timeline */}
            <section>
              <h3 className="text-sm font-bold text-[#1A1D2E] mb-1">Suggested machine schedule</h3>
              <p className="text-xs text-gray-500 mb-2">{settings.shifts} × {settings.shift_hours} h shifts{settings.shifts > 1 && settings.overlap_hours ? ` with ${settings.overlap_hours} h overlap` : ''} → {horizon} h of run time from {clock(settings.start_time, 0)}. 20-second cycles unless changed on Machines &amp; molds. Striped = molding ahead for later.</p>
              <div className="rounded-2xl border border-[#ECEEF3] overflow-hidden">
                {input.machines.map(m => {
                  const segs = result.segments.filter(s => s.machineId === m.id)
                  const hrs = result.machineHours[m.id] || 0
                  return (
                    <div key={m.id} className="flex items-center gap-3 px-3 py-2 border-t first:border-t-0 border-[#F0F2F6]">
                      <div className="w-28 shrink-0">
                        <p className="text-sm font-bold">{m.code}</p>
                        <p className="text-[11px]" style={{ color: PIECE_COLOR[m.piece] }}>{PIECE_NAME[m.piece]} · {fmtN(m.rate)}/h{dayPiece[m.code] ? ' (swapped)' : ''}</p>
                      </div>
                      <label className="text-[11px] text-gray-500 flex items-center gap-1 shrink-0"><input type="checkbox" checked={m.available} onChange={e => setDayAvail(d => ({ ...d, [m.code]: e.target.checked }))} />on</label>
                      <div className="flex-1 relative h-7 rounded-md bg-[#F2F4F8] overflow-hidden">
                        {segs.map((s, i) => {
                          const rank = groups.find(g => g.key === s.groupKey)?.rank || 0
                          return <div key={i} title={`${s.label}${s.ahead ? ' (ahead)' : ''}: ${clock(settings.start_time, s.start)}–${clock(settings.start_time, s.end)} · ${fmtN(s.pcs)} pcs`}
                            className="absolute top-0 bottom-0 text-[10px] text-white font-bold flex items-center justify-center overflow-hidden"
                            style={{ left: `${(s.start / Math.max(horizon, 0.01)) * 100}%`, width: `${((s.end - s.start) / Math.max(horizon, 0.01)) * 100}%`, background: prioColor(rank), backgroundImage: s.ahead ? 'repeating-linear-gradient(45deg, rgba(255,255,255,.35) 0 6px, transparent 6px 12px)' : undefined }}>
                            {s.end - s.start > horizon * 0.08 ? `P${rank || '–'}` : ''}</div>
                        })}
                        {settings.shifts > 1 && <div className="absolute top-0 bottom-0 w-px bg-gray-400" style={{ left: `${(settings.shift_hours - settings.overlap_hours) / Math.max(horizon, 0.01) * 100}%` }} />}
                      </div>
                      <div className="w-28 text-right shrink-0 text-xs">{hrs > 0 ? <><b>{fmtN(hrs, 1)} h</b><br /><span className="text-gray-500">{fmtN(segs.reduce((a, s) => a + s.pcs, 0))} pcs</span></> : <span className="text-gray-400">{m.available ? 'not needed' : 'off'}</span>}</div>
                    </div>)
                })}
              </div>
            </section>

            {/* packing */}
            {settings.manual_packing && (
              <section>
                <h3 className="text-sm font-bold text-[#1A1D2E] mb-2">Suggested packing by shift</h3>
                <div className="grid sm:grid-cols-2 gap-2">
                  {Array.from({ length: settings.shifts }, (_, i) => i + 1).map(n => {
                    const ls = result.pack.filter(p => p.shift === n)
                    const used = ls.reduce((a, l) => a + l.hours * l.people, 0)
                    return (
                      <div key={n} className="rounded-2xl border border-[#ECEEF3] p-3">
                        <p className="text-sm font-bold">Shift {n} <span className="text-xs font-normal text-gray-500">· {clock(settings.start_time, (n - 1) * (settings.shift_hours - settings.overlap_hours))} – {clock(settings.start_time, (n - 1) * (settings.shift_hours - settings.overlap_hours) + settings.shift_hours)} · {fmtN(used, 1)} of {fmtN(settings.shift_hours * settings.packers_per_shift)} packer-h</span></p>
                        {ls.length ? ls.map((l, i) => <p key={i} className="text-sm mt-1">{short(l.sku)}: <b>{fmtN(l.srps)} SRP</b> <span className="text-xs text-gray-500">({fmtN(l.hours, 1)} h{l.people > 1 ? `, ${l.people} people` : ''} · P{groups.find(g => g.key === l.groupKey)?.rank || '–'})</span></p>) : <p className="text-sm text-gray-400 mt-1">Nothing to pack.</p>}
                      </div>)
                  })}
                </div>
              </section>)}

            {/* draft */}
            <section className="rounded-2xl border-2 p-4" style={{ borderColor: ACCENT }}>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-bold text-[#1A1D2E] flex-1">Plan to send to the Daily Plan</h3>
                <button onClick={buildDraft} disabled={!canEdit} className="h-9 px-4 rounded-xl text-white text-sm font-bold disabled:opacity-40" style={{ background: ACCENT }}>{draftRuns ? '↻ Rebuild from suggestion' : 'Use this plan'}</button>
                {(saved.runs.length > 0 || saved.pack.length > 0) && <button onClick={loadSavedIntoDraft} className="h-9 px-3 rounded-xl border border-[#E4E6EE] text-sm font-semibold text-gray-600">Load saved plan</button>}
                {(saved.runs.length > 0 || saved.pack.length > 0) && canEdit && <button onClick={clearSaved} disabled={!!busy} className="h-9 px-3 rounded-xl border border-red-200 text-sm font-semibold text-red-600">Delete saved plan</button>}
              </div>
              <p className="text-xs text-gray-500 mt-1">{saved.runs.length || saved.pack.length ? `Already on the Daily Plan for ${fmtDay(date)}: ${saved.runs.length} machine line(s), ${saved.pack.length} packing line(s). Sending again overwrites them.` : `Nothing saved for ${fmtDay(date)} yet.`}</p>
              {draftRuns && draftPack && <>
                <div className="overflow-x-auto mt-3">
                  <table className="w-full text-sm min-w-[820px]">
                    <thead><tr className="text-[10px] uppercase text-gray-400 text-left"><th className="py-1">Machine</th><th>Mold</th><th className="w-20">Hours</th><th className="w-28">Target pcs</th><th>For SKUs</th><th className="w-32">Operator</th><th>Notes</th><th /></tr></thead>
                    <tbody>{draftRuns.map(r => (
                      <tr key={r.key} className="border-t border-[#F0F2F6] align-top">
                        <td className="py-1.5 pr-2"><select value={r.machine_id} onChange={e => { const m = machs.find(x => x.id === e.target.value); setDraftRuns(d => d!.map(x => x.key === r.key ? { ...x, machine_id: e.target.value, code: m?.machine_code || '?' } : x)) }} className={inputCls}>
                          {molds.map(m => machByCode[m.machine_code.toUpperCase()]).filter(Boolean).map((m: any) => <option key={m.id} value={m.id}>{m.machine_code}</option>)}</select></td>
                        <td className="pr-2"><select value={r.piece} onChange={e => setDraftRuns(d => d!.map(x => x.key === r.key ? { ...x, piece: e.target.value as Piece } : x))} className={inputCls}>{PIECE_LIST.map(p => <option key={p} value={p}>{PIECE_NAME[p]}</option>)}</select></td>
                        <td className="pr-2"><input inputMode="decimal" value={r.hours} onChange={e => { const h = num(e.target.value); setDraftRuns(d => d!.map(x => x.key === r.key ? { ...x, hours: h, target_pcs: Math.round(h * rateOf(x.code)) } : x)) }} className={inputCls} /></td>
                        <td className="pr-2"><input inputMode="numeric" value={r.target_pcs} onChange={e => setDraftRuns(d => d!.map(x => x.key === r.key ? { ...x, target_pcs: num(e.target.value) } : x))} className={inputCls} /></td>
                        <td className="pr-2"><input value={r.skus.join(', ')} onChange={e => setDraftRuns(d => d!.map(x => x.key === r.key ? { ...x, skus: e.target.value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) } : x))} className={inputCls} /></td>
                        <td className="pr-2"><input value={r.operator} placeholder="Name" onChange={e => setDraftRuns(d => d!.map(x => x.key === r.key ? { ...x, operator: e.target.value } : x))} className={inputCls} /></td>
                        <td className="pr-2"><input value={r.notes} onChange={e => setDraftRuns(d => d!.map(x => x.key === r.key ? { ...x, notes: e.target.value } : x))} className={inputCls} /></td>
                        <td><button onClick={() => setDraftRuns(d => d!.filter(x => x.key !== r.key))} className="h-9 px-2 text-red-500 text-lg" title="Remove">×</button></td>
                      </tr>))}</tbody>
                  </table>
                  <button onClick={() => { const m = molds.map(x => machByCode[x.machine_code.toUpperCase()]).find(Boolean); if (m) setDraftRuns(d => [...(d || []), { key: uid(), machine_id: m.id, code: m.machine_code, piece: (molds.find(x => x.machine_code === m.machine_code)?.piece || 'BGFRK'), hours: 12, target_pcs: Math.round(12 * rateOf(m.machine_code)), skus: [], operator: '', notes: '' }]) }} className="mt-2 text-xs font-semibold" style={{ color: ACCENT }}>+ Add machine line</button>
                </div>
                {settings.manual_packing && (
                  <div className="overflow-x-auto mt-4">
                    <table className="w-full text-sm min-w-[640px]">
                      <thead><tr className="text-[10px] uppercase text-gray-400 text-left"><th className="py-1 w-24">Shift</th><th>SKU</th><th className="w-24">SRPs</th><th className="w-20">People</th><th className="w-24">Hours</th><th>Notes</th><th /></tr></thead>
                      <tbody>{draftPack.map(p => (
                        <tr key={p.key} className="border-t border-[#F0F2F6]">
                          <td className="py-1.5 pr-2"><select value={p.shift} onChange={e => setDraftPack(d => d!.map(x => x.key === p.key ? { ...x, shift: num(e.target.value) } : x))} className={inputCls}>{Array.from({ length: Math.max(settings.shifts, p.shift) }, (_, i) => <option key={i} value={i + 1}>Shift {i + 1}</option>)}</select></td>
                          <td className="pr-2"><select value={p.sku} onChange={e => { const r = packRate(e.target.value); setDraftPack(d => d!.map(x => x.key === p.key ? { ...x, sku: e.target.value, people: r?.people || x.people, hours: r ? x.srps / r.srp_per_hour : x.hours } : x)) }} className={inputCls}>{Object.keys(SKU_NAME).map(s => <option key={s} value={s}>{short(s)} ({s})</option>)}</select></td>
                          <td className="pr-2"><input inputMode="numeric" value={p.srps} onChange={e => { const q = num(e.target.value), r = packRate(p.sku); setDraftPack(d => d!.map(x => x.key === p.key ? { ...x, srps: q, hours: r ? q / r.srp_per_hour : x.hours } : x)) }} className={inputCls} /></td>
                          <td className="pr-2"><input inputMode="numeric" value={p.people} onChange={e => setDraftPack(d => d!.map(x => x.key === p.key ? { ...x, people: Math.max(1, num(e.target.value)) } : x))} className={inputCls} /></td>
                          <td className="pr-2"><input inputMode="decimal" value={Math.round(p.hours * 10) / 10} onChange={e => setDraftPack(d => d!.map(x => x.key === p.key ? { ...x, hours: num(e.target.value) } : x))} className={inputCls} /></td>
                          <td className="pr-2"><input value={p.notes} onChange={e => setDraftPack(d => d!.map(x => x.key === p.key ? { ...x, notes: e.target.value } : x))} className={inputCls} /></td>
                          <td><button onClick={() => setDraftPack(d => d!.filter(x => x.key !== p.key))} className="h-9 px-2 text-red-500 text-lg" title="Remove">×</button></td>
                        </tr>))}</tbody>
                    </table>
                    <button onClick={() => setDraftPack(d => [...(d || []), { key: uid(), shift: 1, sku: '22GVS24', srps: 0, people: 1, hours: 0, notes: '' }])} className="mt-2 text-xs font-semibold" style={{ color: ACCENT }}>+ Add packing line</button>
                  </div>)}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button onClick={sendToDailyPlan} disabled={!canEdit || busy === 'send'} className="h-11 px-5 rounded-xl text-white text-sm font-bold disabled:opacity-40" style={{ background: '#00a85a' }}>{busy === 'send' ? 'Sending…' : `Send to Daily Plan for ${fmtDay(date)}`}</button>
                  <button onClick={() => { setDraftRuns(null); setDraftPack(null) }} className="h-11 px-4 rounded-xl border border-[#E4E6EE] text-sm font-semibold text-gray-600">Discard draft</button>
                </div>
              </>}
            </section>
          </> : tab === 'molds' ? (
            <section>
              <p className="text-sm text-gray-500 mb-3">Locked mold set-up the planner uses. Output per hour = cavities × 3,600 ÷ cycle seconds{settings.efficiency_pct < 100 ? ` × ${settings.efficiency_pct}% efficiency` : ''}. Changes here also update the machine rate sheet.</p>
              <div className="overflow-x-auto rounded-2xl border border-[#ECEEF3]">
                <table className="w-full text-sm min-w-[760px]">
                  <thead><tr className="text-[10px] uppercase text-gray-400 bg-[#FAFBFD] text-left"><th className="px-3 py-2">Machine</th><th>Mold</th><th className="w-24">Cavities</th><th className="w-24">Cycle (s)</th><th className="text-right pr-3">Pcs / hour</th><th>Status</th><th>Use in plans</th><th>Notes</th><th /></tr></thead>
                  <tbody>{molds.map((m, i) => {
                    const mc = machByCode[m.machine_code.toUpperCase()]
                    const set = (k: keyof MoldRow, v: any) => setMolds(x => x.map((y, j) => j === i ? { ...y, [k]: v } : y))
                    return (
                      <tr key={m.machine_code + i} className="border-t border-[#F0F2F6]">
                        <td className="px-3 py-1.5">{m._new ? <select value={m.machine_code} onChange={e => set('machine_code', e.target.value)} className={inputCls}><option value="">Pick…</option>{machs.filter(x => !molds.some(y => !y._new && y.machine_code === x.machine_code)).map(x => <option key={x.id} value={x.machine_code}>{x.machine_code}</option>)}</select> : <b>{m.machine_code}</b>}</td>
                        <td className="pr-2"><select value={m.piece} onChange={e => set('piece', e.target.value)} className={inputCls}>{PIECE_LIST.map(p => <option key={p} value={p}>{PIECE_NAME[p]}</option>)}</select></td>
                        <td className="pr-2"><input inputMode="numeric" value={m.cavities} onChange={e => set('cavities', num(e.target.value))} className={inputCls} /></td>
                        <td className="pr-2"><input inputMode="decimal" value={m.cycle_sec} onChange={e => set('cycle_sec', num(e.target.value))} className={inputCls} /></td>
                        <td className="text-right pr-3 font-semibold">{fmtN(m.cavities * 3600 / Math.max(1, m.cycle_sec))}</td>
                        <td className="text-xs">{mc ? <span className={mc.status === 'Down' ? 'text-red-600 font-semibold' : 'text-gray-600'}>{mc.status || '—'}</span> : <span className="text-amber-700">not in machine list</span>}</td>
                        <td><input type="checkbox" checked={m.available} onChange={e => set('available', e.target.checked)} /></td>
                        <td className="pr-2"><input value={m.notes || ''} onChange={e => set('notes', e.target.value)} className={inputCls} /></td>
                        <td className="whitespace-nowrap pr-2">{canEdit && <><button onClick={() => saveMold(m)} disabled={!!busy} className="h-8 px-3 rounded-lg text-xs font-bold text-white" style={{ background: ACCENT }}>Save</button><button onClick={() => deleteMold(m)} className="h-8 px-2 text-red-500 text-lg" title="Delete">×</button></>}</td>
                      </tr>)
                  })}</tbody>
                </table>
              </div>
              {canEdit && <button onClick={() => setMolds(x => [...x, { machine_code: '', piece: 'BGFRK', cavities: 24, cycle_sec: 20, available: true, notes: null, _new: true }])} className="mt-2 text-sm font-semibold" style={{ color: ACCENT }}>+ Add machine</button>}
            </section>
          ) : tab === 'rates' ? (
            <section>
              <p className="text-sm text-gray-500 mb-3">How fast SRPs get packed. “People” is how many packers one SKU ties up (assorted packs take two).</p>
              <div className="overflow-x-auto rounded-2xl border border-[#ECEEF3]">
                <table className="w-full text-sm min-w-[620px]">
                  <thead><tr className="text-[10px] uppercase text-gray-400 bg-[#FAFBFD] text-left"><th className="px-3 py-2">SKU</th><th className="w-28">SRP / hour</th><th className="w-24">People</th><th className="text-right pr-3">SRP per 12 h</th><th>Notes</th><th /></tr></thead>
                  <tbody>{rates.map((r, i) => {
                    const set = (k: keyof RateRow, v: any) => setRates(x => x.map((y, j) => j === i ? { ...y, [k]: v } : y))
                    return (
                      <tr key={r.sku + i} className="border-t border-[#F0F2F6]">
                        <td className="px-3 py-1.5">{r._new ? <input value={r.sku} placeholder="22GV…" onChange={e => set('sku', e.target.value.toUpperCase())} className={inputCls} /> : <><b>{short(r.sku)}</b> <span className="text-[10px] font-mono text-gray-400">{r.sku}</span></>}</td>
                        <td className="pr-2"><input inputMode="decimal" value={r.srp_per_hour} onChange={e => set('srp_per_hour', num(e.target.value))} className={inputCls} /></td>
                        <td className="pr-2"><input inputMode="numeric" value={r.people} onChange={e => set('people', num(e.target.value))} className={inputCls} /></td>
                        <td className="text-right pr-3 font-semibold">{fmtN(r.srp_per_hour * settings.shift_hours)}</td>
                        <td className="pr-2"><input value={r.notes || ''} onChange={e => set('notes', e.target.value)} className={inputCls} /></td>
                        <td className="whitespace-nowrap pr-2">{canEdit && <><button onClick={() => saveRate(r)} disabled={!!busy} className="h-8 px-3 rounded-lg text-xs font-bold text-white" style={{ background: ACCENT }}>Save</button><button onClick={() => deleteRate(r)} className="h-8 px-2 text-red-500 text-lg" title="Delete">×</button></>}</td>
                      </tr>)
                  })}</tbody>
                </table>
              </div>
              {canEdit && <button onClick={() => setRates(x => [...x, { sku: '', srp_per_hour: 10, people: 1, notes: null, _new: true }])} className="mt-2 text-sm font-semibold" style={{ color: ACCENT }}>+ Add SKU rate</button>}
            </section>
          ) : (
            <section className="grid sm:grid-cols-2 gap-3 max-w-3xl">
              <Field label="Shifts per day"><select value={settings.shifts} onChange={e => setSettings(s => ({ ...s, shifts: num(e.target.value) }))} className={inputCls}>{[1, 2, 3].map(n => <option key={n} value={n}>{n}</option>)}</select></Field>
              <Field label="Hours per shift"><input inputMode="decimal" value={settings.shift_hours} onChange={e => setSettings(s => ({ ...s, shift_hours: num(e.target.value) }))} className={inputCls} /></Field>
              <Field label="Overlap between shifts (h)"><input inputMode="decimal" value={settings.overlap_hours} onChange={e => setSettings(s => ({ ...s, overlap_hours: num(e.target.value) }))} className={inputCls} /></Field>
              <Field label="First shift starts"><input type="time" value={settings.start_time} onChange={e => setSettings(s => ({ ...s, start_time: e.target.value }))} className={inputCls} /></Field>
              <Field label="Packers per shift"><input inputMode="numeric" value={settings.packers_per_shift} onChange={e => setSettings(s => ({ ...s, packers_per_shift: Math.max(0, Math.round(num(e.target.value))) }))} className={inputCls} /></Field>
              <Field label="Manual packing required (default)"><select value={settings.manual_packing ? 'y' : 'n'} onChange={e => setSettings(s => ({ ...s, manual_packing: e.target.value === 'y' }))} className={inputCls}><option value="y">Yes</option><option value="n">No</option></select></Field>
              <Field label="Machine efficiency %"><input inputMode="decimal" value={settings.efficiency_pct} onChange={e => setSettings(s => ({ ...s, efficiency_pct: Math.min(100, Math.max(1, num(e.target.value))) }))} className={inputCls} /></Field>
              <Field label="Machine layout"><select value={settings.strategy} onChange={e => setSettings(s => ({ ...s, strategy: e.target.value as any }))} className={inputCls}><option value="fewest">Fewest machines that fit the day</option><option value="fastest">All machines in parallel (finish soonest)</option></select></Field>
              <Field label="Use spare machine time to mold ahead"><select value={settings.mold_ahead ? 'y' : 'n'} onChange={e => setSettings(s => ({ ...s, mold_ahead: e.target.value === 'y' }))} className={inputCls}><option value="y">Yes — build pieces for the next priorities</option><option value="n">No — only what gets packed</option></select></Field>
              <div className="sm:col-span-2 flex items-center gap-3">
                <p className="text-xs text-gray-500 flex-1">Machine run time per day = shifts × hours − overlap = <b>{horizon} h</b>. Packer time = {fmtN(settings.shifts * settings.packers_per_shift * settings.shift_hours)} packer-hours.</p>
                {canEdit && <button onClick={saveSettings} disabled={!!busy} className="h-10 px-4 rounded-xl text-white text-sm font-bold" style={{ background: ACCENT }}>Save as default</button>}
              </div>
            </section>
          )}
        </div>
        <div className="sm:hidden px-5 pb-[max(12px,env(safe-area-inset-bottom))]"><button onClick={onClose} className="w-full h-12 rounded-2xl border border-[#E4E6EE] text-sm font-semibold text-gray-600">← Back to the board</button></div>
      </div>
    </div>
  )
  return typeof document === 'undefined' ? null : createPortal(body, document.body)
}

function Kpi({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="rounded-xl border border-[#ECEEF3] bg-white px-3 py-2.5" style={{ borderTop: `3px solid ${color}` }}>
      <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-[15px] font-extrabold text-[#1A1D2E] leading-tight mt-0.5">{value}</p>
      {sub && <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>}
    </div>)
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-xs font-semibold text-gray-500">{label}</span><div className="mt-1">{children}</div></label>
}
