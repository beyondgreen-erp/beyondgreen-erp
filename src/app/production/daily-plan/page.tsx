'use client'
// daily-plan record board — Day / Week / Month views with click-a-day scheduling
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { queuesByMachine, fmtClock, woLabel, todayISO, type SchedulableWO } from '@/lib/productionSchedule'

interface Plan { id: string; plan_date: string; share_token: string; title: string | null; status: string; notes: string | null }
interface Line { id: string; plan_id: string; machine_code: string; product: string | null; operator: string | null; status: string; sort_order: number }
interface Stat { qty: number; unit: string; lastAt: string | null; lastStatus: string | null; count: number }

const LINE_SC: Record<string, string> = {
  Planned: 'bg-gray-100 text-gray-600', Running: 'bg-emerald-100 text-emerald-700',
  Down: 'bg-red-100 text-red-700', Offline: 'bg-gray-200 text-gray-500', Complete: 'bg-blue-100 text-blue-700',
}
const p2 = (n: number) => String(n).padStart(2, '0')
const toISO = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
const parseISO = (s: string) => new Date(s + 'T00:00:00')
const addDays = (iso: string, n: number) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d) }
const addMonths = (iso: string, n: number) => { const d = parseISO(iso); d.setMonth(d.getMonth() + n); return toISO(d) }
const startOfWeek = (iso: string) => { const d = parseISO(iso); d.setDate(d.getDate() - d.getDay()); return toISO(d) }
const weekDates = (iso: string) => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(iso), i))
function monthCells(iso: string) {
  const d = parseISO(iso); const first = new Date(d.getFullYear(), d.getMonth(), 1)
  const start = new Date(first); start.setDate(1 - first.getDay())
  const cells: { iso: string; inMonth: boolean }[] = []
  for (let i = 0; i < 42; i++) { const c = new Date(start); c.setDate(start.getDate() + i); cells.push({ iso: toISO(c), inMonth: c.getMonth() === d.getMonth() }) }
  return cells
}
const fmtDate = (d: string) => parseISO(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
const fmtDow = (d: string) => parseISO(d).toLocaleDateString('en-US', { weekday: 'short' })
const fmtDay = (d: string) => parseISO(d).getDate()
const fmtMonthYear = (d: string) => parseISO(d).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
const fmtRange = (a: string, b: string) => `${parseISO(a).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${parseISO(b).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
const fmtTime = (d: string | null) => d ? new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—'
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function parsePlanText(text: string): { planDate: string; lines: { machine: string; product: string; operator: string }[] } {
  const raw = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  let planDate = ''
  const lines: { machine: string; product: string; operator: string }[] = []
  for (const line of raw) {
    if (/production plan/i.test(line) || (/^\d{1,2}\/\d{1,2}/.test(line) && line.indexOf('-') === -1)) {
      const dm = line.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/)
      if (dm) { const y = dm[3] ? (dm[3].length === 2 ? '20' + dm[3] : dm[3]) : String(new Date().getFullYear()); planDate = `${y}-${String(+dm[1]).padStart(2, '0')}-${String(+dm[2]).padStart(2, '0')}` }
      continue
    }
    const dash = line.indexOf('-')
    if (dash === -1) continue
    const machine = line.slice(0, dash).trim()
    const rest = line.slice(dash + 1).trim()
    if (!machine) continue
    const parts = rest.split(/\s+-\s+/)
    lines.push({ machine, product: (parts[0] || '').trim(), operator: parts.slice(1).join(' - ').trim() })
  }
  return { planDate, lines }
}

export default function DailyPlanPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [plans, setPlans] = useState<Plan[]>([])
  const [linesByPlan, setLinesByPlan] = useState<Record<string, Line[]>>({})
  const [statByLine, setStatByLine] = useState<Record<string, Stat>>({})
  const [woByDate, setWoByDate] = useState<Record<string, SchedulableWO[]>>({})
  const [machineNames, setMachineNames] = useState<Record<string, string>>({})
  const [machineList, setMachineList] = useState<{ id: string; machine_code: string }[]>([])
  const [openWOs, setOpenWOs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  // view state
  const [view, setView] = useState<'day' | 'week' | 'month'>('day')
  const [anchor, setAnchor] = useState<string>(todayISO())
  // New-plan drawer
  const [newOpen, setNewOpen] = useState(false)
  const [paste, setPaste] = useState('')
  const [planDate, setPlanDate] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [machines, setMachines] = useState<{ machine_code: string }[]>([])
  const [products, setProducts] = useState<{ id: string; product_name: string; sku: string }[]>([])
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([])
  const [addForm, setAddForm] = useState<Record<string, { machine: string; product: string; operator: string }>>({})
  // assign (schedule a work order) modal
  const [assignOpen, setAssignOpen] = useState(false)
  const [assign, setAssign] = useState({ wo_id: '', machine_id: '', date: '', start: '', hours: '', operator: '' })
  const [assignSaving, setAssignSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: wos }, { data: mach }] = await Promise.all([
      sb.from('work_orders')
        .select('id,wo_code,wo_number,group_name,form_type,item_part_number,qty_ordered,uom,status,machine_id,scheduled_date,scheduled_start,scheduled_hours,assigned_operator,spec')
        .not('scheduled_date', 'is', null),
      sb.from('machines').select('id,machine_code,name'),
    ])
    const woList = ((wos as SchedulableWO[]) || [])
    const mNames: Record<string, string> = {}
    const mList: { id: string; machine_code: string }[] = []
    ;((mach as any[]) || []).forEach(m => { mNames[m.id] = m.machine_code || m.name; mList.push({ id: m.id, machine_code: m.machine_code || m.name }) })
    setMachineNames(mNames); setMachineList(mList.sort((a, b) => a.machine_code.localeCompare(b.machine_code)))
    const byDate: Record<string, SchedulableWO[]> = {}
    woList.forEach(w => { if (w.scheduled_date) (byDate[w.scheduled_date] ||= []).push(w) })
    setWoByDate(byDate)
    const woDates = Object.keys(byDate)
    if (woDates.length) {
      const { data: have } = await sb.from('production_day_plans').select('plan_date').in('plan_date', woDates)
      const known = new Set(((have as any[]) || []).map(r => r.plan_date))
      const missing = woDates.filter(d => !known.has(d))
      if (missing.length) await sb.from('production_day_plans').insert(missing.map(d => ({ plan_date: d, title: `Production Plan ${d}` })))
    }
    const { data: pl } = await sb.from('production_day_plans').select('*').order('plan_date', { ascending: false }).limit(180)
    const planList = (pl as Plan[]) || []
    setPlans(planList)
    const ids = planList.map(p => p.id)
    if (ids.length) {
      const [{ data: ln }, { data: lg }] = await Promise.all([
        sb.from('production_plan_lines').select('*').in('plan_id', ids).order('sort_order').order('machine_code'),
        sb.from('production_output_logs').select('plan_line_id, output_qty, unit, running_status, logged_at').in('plan_id', ids).order('logged_at', { ascending: false }),
      ])
      const byPlan: Record<string, Line[]> = {}
      ;(ln as Line[] || []).forEach(l => { (byPlan[l.plan_id] ||= []).push(l) })
      setLinesByPlan(byPlan)
      const stat: Record<string, Stat> = {}
      ;(lg as any[] || []).forEach(l => {
        const s = stat[l.plan_line_id] ||= { qty: 0, unit: 'cases', lastAt: null, lastStatus: null, count: 0 }
        s.qty += Number(l.output_qty) || 0; s.count += 1
        if (!s.lastAt) { s.lastAt = l.logged_at; s.lastStatus = l.running_status; s.unit = l.unit || 'cases' }
      })
      setStatByLine(stat)
    } else { setLinesByPlan({}); setStatByLine({}) }
    setLoading(false)
  }, [sb])
  useEffect(() => { load() }, [load])
  useEffect(() => { (async () => {
    const [{ data: m }, { data: pr }, { data: emp }, { data: ow }] = await Promise.all([
      sb.from('machines').select('machine_code').order('machine_code'),
      sb.from('products').select('id,product_name,sku').eq('is_active', true).order('product_name').limit(1000),
      sb.from('employees').select('id,name').order('name'),
      sb.from('work_orders').select('id,wo_code,wo_number,item_part_number,qty_ordered,uom,status,scheduled_date').limit(1000),
    ])
    setMachines((m as any[]) || []); setProducts((pr as any[]) || []); setEmployees((emp as any[]) || [])
    const CLOSED = ['Complete', 'QC Passed', 'Cancelled']
    setOpenWOs(((ow as any[]) || []).filter(w => !CLOSED.includes(w.status)).sort((a, b) => (b.wo_number || 0) - (a.wo_number || 0)))
  })() }, [sb])

  const preview = useMemo(() => parsePlanText(paste), [paste])
  useEffect(() => { if (preview.planDate && !planDate) setPlanDate(preview.planDate) }, [preview.planDate]) // eslint-disable-line

  function flash(m: string) { setToast(m); setTimeout(() => setToast(''), 2500) }
  function publicUrl(token: string) { return `${typeof window !== 'undefined' ? window.location.origin : ''}/dp/${token}` }
  function copyLink(p: Plan) { navigator.clipboard?.writeText(publicUrl(p.share_token)); flash('Operator link copied — paste it into WhatsApp') }

  function openAssign(date?: string) { setAssign({ wo_id: '', machine_id: '', date: date || anchor, start: '', hours: '', operator: '' }); setAssignOpen(true); setErr('') }
  async function saveAssign() {
    if (!assign.wo_id || !assign.date) { setErr('Pick a work order and a date.'); return }
    setAssignSaving(true)
    const patch: any = {
      scheduled_date: assign.date,
      machine_id: assign.machine_id || null,
      scheduled_start: assign.start || null,
      scheduled_hours: assign.hours ? Number(assign.hours) : null,
      assigned_operator: assign.operator || null,
    }
    const { error } = await sb.from('work_orders').update(patch).eq('id', assign.wo_id)
    setAssignSaving(false)
    if (error) { setErr(error.message); return }
    setAssignOpen(false); await load(); flash('Work order scheduled — it now shows on the plan')
  }

  async function createPlan() {
    setErr('')
    const date = planDate || preview.planDate
    if (!date) { setErr('Pick a plan date.'); return }
    setSaving(true)
    const { data: plan, error } = await sb.from('production_day_plans').insert({ plan_date: date, title: `Production Plan ${date}` }).select('*').single()
    if (error) { setSaving(false); setErr(error.code === '23505' ? 'A plan for that date already exists — delete it first or pick another date.' : error.message); return }
    if (preview.lines.length) {
      const rows = preview.lines.map((l, i) => ({ plan_id: (plan as Plan).id, machine_code: l.machine, product: l.product || null, operator: l.operator || null, sort_order: i, status: (l.product || '').toLowerCase() === 'offline' ? 'Offline' : 'Planned' }))
      const { error: le } = await sb.from('production_plan_lines').insert(rows)
      if (le) { setSaving(false); setErr(le.message); return }
    }
    setSaving(false)
    setNewOpen(false); setPaste(''); setPlanDate(''); setAnchor(date); setView('day'); await load(); flash('Plan created')
  }

  async function deletePlan(p: Plan) {
    if (!confirm(`Delete the ${fmtDate(p.plan_date)} plan and all its logs?`)) return
    await sb.from('production_day_plans').delete().eq('id', p.id); load()
  }
  async function delLine(l: Line) { if (!confirm(`Remove ${l.machine_code} from this plan?`)) return; await sb.from('production_plan_lines').delete().eq('id', l.id); load() }
  function setAddField(planId: string, patch: any) { setAddForm(a => { const cur = a[planId] || { machine: '', product: '', operator: '' }; return { ...a, [planId]: { ...cur, ...patch } } }) }
  async function addLine(p: Plan) {
    const f = addForm[p.id] || { machine: '', product: '', operator: '' }
    if (!f.machine) { flash('Pick a machine first.'); return }
    const existing = linesByPlan[p.id] || []
    const { error } = await sb.from('production_plan_lines').insert({ plan_id: p.id, machine_code: f.machine, product: f.product || null, operator: f.operator || null, sort_order: existing.length, status: (f.product || '').toLowerCase() === 'offline' ? 'Offline' : 'Planned' })
    if (error) { flash(error.message); return }
    setAddForm(a => ({ ...a, [p.id]: { machine: '', product: '', operator: '' } })); load()
  }

  const inp = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00A84F]/30'
  const jobsFor = (date: string) => Object.values(queuesByMachine(woByDate[date] || [])).flat().sort((a, b) => {
    if (a.startMins === null && b.startMins === null) return 0
    if (a.startMins === null) return 1
    if (b.startMins === null) return -1
    return a.startMins - b.startMins
  })

  // ---- one full day card (used in Day view) ----
  function renderPlanCard(p: Plan) {
    const lines = linesByPlan[p.id] || []
    const loggedCount = lines.filter(l => (statByLine[l.id]?.count || 0) > 0).length
    return (
      <div className="bg-white rounded-xl border border-[#ECEEF3] shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#EEF0F4] bg-[#F8FAFF] flex-wrap">
          <p className="text-sm font-bold text-[#1A1D2E]">{fmtDate(p.plan_date)}</p>
          <span className="text-[11px] text-gray-500">
            {(woByDate[p.plan_date] || []).length > 0 && <>{(woByDate[p.plan_date] || []).length} work order{(woByDate[p.plan_date] || []).length === 1 ? '' : 's'} · </>}
            {lines.length} machines · {loggedCount} reporting
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => openAssign(p.plan_date)} className="text-[11px] px-2.5 py-1 rounded-lg bg-[#3B6FE0] text-white font-semibold hover:opacity-90">+ Schedule work order</button>
            <button onClick={() => copyLink(p)} className="text-[11px] px-2.5 py-1 rounded-lg bg-[#037f4c] text-white font-semibold hover:opacity-90">Copy operator link</button>
            <a href={publicUrl(p.share_token)} target="_blank" rel="noreferrer" className="text-[11px] px-2 py-1 rounded-lg border border-[#E4E6EE] text-gray-600 hover:bg-gray-50">Open ↗</a>
            <button onClick={() => deletePlan(p)} className="text-[11px] px-2 py-1 rounded-lg border border-red-200 text-red-500 hover:bg-red-50">Delete</button>
          </div>
        </div>
        {(() => {
          const wos = woByDate[p.plan_date] || []
          if (!wos.length) return null
          const queues = queuesByMachine(wos)
          return (
            <div className="px-4 py-3 border-b border-[#EEF0F4] bg-[#FBFDFF]">
              <p className="text-[10px] font-bold uppercase text-gray-400 mb-2">Scheduled work orders</p>
              <div className="space-y-2">
                {Object.entries(queues).map(([mid, jobs]) => (
                  <div key={mid} className="rounded-lg border border-[#E9EDF5] bg-white overflow-hidden">
                    <div className="px-3 py-1.5 bg-[#F6F8FD] text-[11px] font-bold text-[#1A1D2E]">
                      {machineNames[mid] || <span className="text-amber-600">No machine assigned</span>}
                      <span className="ml-2 font-normal text-gray-400">{jobs.length} job{jobs.length === 1 ? '' : 's'}</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs min-w-[720px]"><tbody>
                        {jobs.map(j => (
                          <tr key={j.wo.id} className="border-t border-[#EEF0F4]">
                            <td className="px-3 py-2 whitespace-nowrap font-semibold text-[#1A1D2E]">
                              {j.startMins === null ? <span className="text-amber-600">no start time</span> : <>{fmtClock(j.startMins)} <span className="text-gray-300">→</span> {fmtClock(j.endMins)}</>}
                              {j.overlapsPrevious && <span className="ml-2 text-red-600 font-normal">overlaps</span>}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap"><a href={`/production/work-orders?item=${j.wo.id}`} className="font-semibold text-[#037f4c] hover:underline">{woLabel(j.wo)}</a></td>
                            <td className="px-3 py-2 text-gray-700">{j.wo.item_part_number || '—'}{j.wo.qty_ordered != null ? ` · ${Number(j.wo.qty_ordered).toLocaleString()} ${j.wo.uom || ''}` : ''}</td>
                            <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{j.wo.assigned_operator || <span className="text-amber-600">no operator</span>}</td>
                            <td className="px-3 py-2 text-gray-400 whitespace-nowrap">{j.wo.group_name || '—'}</td>
                            <td className="px-3 py-2 text-right whitespace-nowrap"><button onClick={() => { setAssign({ wo_id: j.wo.id, machine_id: j.wo.machine_id || '', date: p.plan_date, start: (j.wo.scheduled_start || '').slice(0, 5), hours: j.wo.scheduled_hours ? String(j.wo.scheduled_hours) : '', operator: j.wo.assigned_operator || '' }); setAssignOpen(true) }} className="text-[11px] text-[#3B6FE0] hover:underline">edit</button></td>
                          </tr>
                        ))}
                      </tbody></table>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })()}
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead><tr className="text-[10px] uppercase text-gray-400 border-b border-[#EEF0F4]">
              <th className="text-left px-4 py-2 font-semibold">Machine</th><th className="text-left px-3 py-2 font-semibold">What to run</th><th className="text-left px-3 py-2 font-semibold">Operator</th><th className="text-left px-3 py-2 font-semibold">Live status</th><th className="text-right px-3 py-2 font-semibold">Actual output</th><th className="text-left px-3 py-2 font-semibold">Last log</th><th className="px-3 py-2"></th>
            </tr></thead>
            <tbody>
              {lines.map(l => {
                const s = statByLine[l.id]; const live = s?.lastStatus || l.status
                return (
                  <tr key={l.id} className="border-b border-[#EEF0F4] last:border-0">
                    <td className="px-4 py-2.5 font-bold text-[#1A1D2E]">{l.machine_code}</td>
                    <td className="px-3 py-2.5 text-gray-700">{l.product || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-500">{l.operator || '—'}</td>
                    <td className="px-3 py-2.5"><span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${LINE_SC[live] || 'bg-gray-100 text-gray-500'}`}>{live}</span></td>
                    <td className="px-3 py-2.5 text-right font-semibold text-[#1A1D2E]">{s && s.count ? `${s.qty} ${s.unit}` : <span className="text-gray-300">no logs</span>}</td>
                    <td className="px-3 py-2.5 text-gray-500 text-xs">{s?.lastAt ? `${fmtTime(s.lastAt)} · ${s.count} log${s.count === 1 ? '' : 's'}` : '—'}</td>
                    <td className="px-3 py-2.5 text-right"><button onClick={() => delLine(l)} className="text-[11px] text-gray-400 hover:text-red-500">remove</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-t border-[#EEF0F4] bg-[#FBFCFE]">
          <span className="text-[10px] font-bold uppercase text-gray-400">Add machine</span>
          <select value={(addForm[p.id]?.machine) || ''} onChange={e => setAddField(p.id, { machine: e.target.value })} className="border border-[#E4E6EE] rounded-lg px-2 py-1.5 text-xs bg-white">
            <option value="">Machine…</option>{machines.map(m => <option key={m.machine_code} value={m.machine_code}>{m.machine_code}</option>)}
          </select>
          <input list="dl-products" value={(addForm[p.id]?.product) || ''} onChange={e => setAddField(p.id, { product: e.target.value })} placeholder="What to run (inventory)…" className="border border-[#E4E6EE] rounded-lg px-2 py-1.5 text-xs w-48" />
          <input list="dl-employees" value={(addForm[p.id]?.operator) || ''} onChange={e => setAddField(p.id, { operator: e.target.value })} placeholder="Operator…" className="border border-[#E4E6EE] rounded-lg px-2 py-1.5 text-xs w-40" />
          <button onClick={() => addLine(p)} className="text-[11px] px-3 py-1.5 rounded-lg bg-[#037f4c] text-white font-semibold hover:opacity-90">Add</button>
        </div>
      </div>
    )
  }

  const navLabel = view === 'day' ? fmtDate(anchor) : view === 'week' ? fmtRange(weekDates(anchor)[0], weekDates(anchor)[6]) : fmtMonthYear(anchor)
  const step = (dir: number) => setAnchor(a => view === 'day' ? addDays(a, dir) : view === 'week' ? addDays(a, dir * 7) : addMonths(a, dir))

  return (
    <div className="min-h-screen mon-page p-4 sm:p-6 lg:p-8">
      <datalist id="dl-products">{products.map(pr => <option key={pr.id} value={pr.product_name} />)}</datalist>
      <datalist id="dl-employees">{employees.map(e => <option key={e.id} value={e.name} />)}</datalist>
      {toast && <div className="fixed top-4 right-4 z-[70] bg-[#1A1D2E] text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-lg">{toast}</div>}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
        <div>
          <span className="mon-tag" style={{ background: '#00A84F22', color: '#037f4c' }}>🏭 Production</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">Production Plan</h1>
          <p className="text-gray-500 text-sm mt-0.5">Schedule work by day, week or month. Click a day to schedule a job; share the operator link for any day in WhatsApp.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => openAssign(anchor)} className="text-white font-semibold rounded-lg px-4 py-2 text-sm shadow-sm hover:opacity-90 whitespace-nowrap" style={{ background: '#3B6FE0' }}>+ Schedule work order</button>
          <button onClick={() => { setNewOpen(true); setErr('') }} className="text-white font-semibold rounded-lg px-4 py-2 text-sm shadow-sm hover:opacity-90 whitespace-nowrap" style={{ background: '#037f4c' }}>+ Paste WhatsApp plan</button>
        </div>
      </div>

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="inline-flex rounded-lg border border-[#E4E6EE] bg-white overflow-hidden">
          {(['day', 'week', 'month'] as const).map(v => (
            <button key={v} onClick={() => setView(v)} className={`px-3.5 py-1.5 text-sm font-semibold capitalize ${view === v ? 'bg-[#037f4c] text-white' : 'text-gray-600 hover:bg-gray-50'}`}>{v}</button>
          ))}
        </div>
        <div className="inline-flex items-center gap-1">
          <button onClick={() => step(-1)} className="w-8 h-8 rounded-lg border border-[#E4E6EE] bg-white text-gray-600 hover:bg-gray-50">‹</button>
          <button onClick={() => setAnchor(todayISO())} className="px-3 h-8 rounded-lg border border-[#E4E6EE] bg-white text-sm text-gray-700 hover:bg-gray-50">Today</button>
          <button onClick={() => step(1)} className="w-8 h-8 rounded-lg border border-[#E4E6EE] bg-white text-gray-600 hover:bg-gray-50">›</button>
        </div>
        <input type="date" value={anchor} onChange={e => e.target.value && setAnchor(e.target.value)} className="border border-[#E4E6EE] rounded-lg px-2 py-1.5 text-sm bg-white" />
        <p className="text-sm font-bold text-[#1A1D2E]">{navLabel}</p>
      </div>

      {loading ? <p className="text-gray-400 text-sm">Loading…</p> : (
        <>
          {/* DAY VIEW */}
          {view === 'day' && (() => {
            const p = plans.find(pp => pp.plan_date === anchor)
            if (p) return renderPlanCard(p)
            return (
              <div className="bg-white rounded-xl border border-[#ECEEF3] p-10 text-center">
                <p className="text-sm text-gray-500">Nothing scheduled for {fmtDate(anchor)}.</p>
                <button onClick={() => openAssign(anchor)} className="mt-3 text-sm px-4 py-2 rounded-lg bg-[#3B6FE0] text-white font-semibold">+ Schedule a work order</button>
              </div>
            )
          })()}

          {/* WEEK VIEW */}
          {view === 'week' && (
            <div className="grid grid-cols-1 sm:grid-cols-7 gap-2">
              {weekDates(anchor).map(d => {
                const jobs = jobsFor(d)
                const isToday = d === todayISO()
                return (
                  <div key={d} className={`bg-white rounded-xl border ${isToday ? 'border-[#037f4c]' : 'border-[#ECEEF3]'} overflow-hidden flex flex-col min-h-[160px]`}>
                    <div className="flex items-center justify-between px-2.5 py-2 border-b border-[#EEF0F4] bg-[#F8FAFF]">
                      <button onClick={() => { setAnchor(d); setView('day') }} className="text-left">
                        <p className="text-[10px] uppercase text-gray-400 font-semibold">{fmtDow(d)}</p>
                        <p className={`text-sm font-bold ${isToday ? 'text-[#037f4c]' : 'text-[#1A1D2E]'}`}>{fmtDay(d)}</p>
                      </button>
                      <button onClick={() => openAssign(d)} title="Schedule a work order" className="w-6 h-6 rounded-md bg-[#3B6FE0]/10 text-[#3B6FE0] font-bold hover:bg-[#3B6FE0]/20">+</button>
                    </div>
                    <div className="p-1.5 space-y-1 flex-1">
                      {jobs.length === 0 ? <p className="text-[11px] text-gray-300 px-1 py-2">—</p> : jobs.map(j => (
                        <a key={j.wo.id} href={`/production/work-orders?item=${j.wo.id}`} className="block rounded-md border border-[#E9EDF5] bg-[#FBFDFF] px-2 py-1.5 hover:bg-[#F2F6FF]">
                          <p className="text-[11px] font-bold text-[#1A1D2E] leading-tight">{j.startMins === null ? <span className="text-amber-600">no time</span> : fmtClock(j.startMins)} · {woLabel(j.wo)}</p>
                          <p className="text-[10px] text-gray-500 leading-tight truncate">{j.wo.item_part_number || '—'} · {machineNames[j.wo.machine_id ?? ''] || 'no machine'}</p>
                          <p className="text-[10px] text-gray-400 leading-tight truncate">{j.wo.assigned_operator || 'no operator'}</p>
                        </a>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* MONTH VIEW */}
          {view === 'month' && (
            <div className="bg-white rounded-xl border border-[#ECEEF3] overflow-hidden">
              <div className="grid grid-cols-7 border-b border-[#EEF0F4] bg-[#F8FAFF]">
                {DOW.map(d => <div key={d} className="px-2 py-2 text-[10px] uppercase font-bold text-gray-400 text-center">{d}</div>)}
              </div>
              <div className="grid grid-cols-7">
                {monthCells(anchor).map(({ iso, inMonth }) => {
                  const jobs = jobsFor(iso)
                  const isToday = iso === todayISO()
                  return (
                    <div key={iso} className={`min-h-[110px] border-b border-r border-[#EEF0F4] p-1.5 ${inMonth ? 'bg-white' : 'bg-[#FAFBFD]'} group`}>
                      <div className="flex items-center justify-between">
                        <button onClick={() => { setAnchor(iso); setView('day') }} className={`text-xs font-bold ${isToday ? 'text-white bg-[#037f4c] rounded-full w-6 h-6 flex items-center justify-center' : inMonth ? 'text-[#1A1D2E]' : 'text-gray-300'}`}>{fmtDay(iso)}</button>
                        <button onClick={() => openAssign(iso)} title="Schedule" className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded bg-[#3B6FE0]/10 text-[#3B6FE0] text-xs font-bold">+</button>
                      </div>
                      <div className="mt-1 space-y-0.5">
                        {jobs.slice(0, 3).map(j => (
                          <a key={j.wo.id} href={`/production/work-orders?item=${j.wo.id}`} className="block text-[10px] leading-tight truncate rounded px-1 py-0.5 bg-[#EEF4FF] text-[#2b4c9b] hover:bg-[#dfe9ff]" title={`${woLabel(j.wo)} · ${j.wo.item_part_number || ''}`}>
                            {j.startMins !== null ? fmtClock(j.startMins).replace(':00', '') + ' ' : ''}{woLabel(j.wo)}
                          </a>
                        ))}
                        {jobs.length > 3 && <button onClick={() => { setAnchor(iso); setView('day') }} className="text-[10px] text-gray-400 hover:text-[#037f4c] px-1">+{jobs.length - 3} more</button>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Assign / schedule modal */}
      {assignOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(20,24,40,0.45)' }} onClick={() => setAssignOpen(false)}>
          <div className="w-[480px] max-w-full bg-white rounded-xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-[#EEF0F4] flex items-center justify-between">
              <h2 className="font-bold text-[#1A1D2E]">Schedule a work order</h2>
              <button onClick={() => setAssignOpen(false)} className="text-sm px-2.5 py-1 rounded-lg border border-[#E4E6EE] text-gray-500">Close</button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-500">Work order</label>
                <select value={assign.wo_id} onChange={e => setAssign(a => ({ ...a, wo_id: e.target.value }))} className={inp}>
                  <option value="">Choose a work order…</option>
                  {openWOs.map(w => <option key={w.id} value={w.id}>{woLabel(w)} — {w.item_part_number || 'no part'}{w.qty_ordered != null ? ` (${Number(w.qty_ordered).toLocaleString()} ${w.uom || ''})` : ''}{w.scheduled_date ? ' • scheduled ' + w.scheduled_date : ''}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-semibold text-gray-500">Date</label><input type="date" value={assign.date} onChange={e => setAssign(a => ({ ...a, date: e.target.value }))} className={inp} /></div>
                <div><label className="text-xs font-semibold text-gray-500">Machine</label>
                  <select value={assign.machine_id} onChange={e => setAssign(a => ({ ...a, machine_id: e.target.value }))} className={inp}>
                    <option value="">— unassigned —</option>{machineList.map(m => <option key={m.id} value={m.id}>{m.machine_code}</option>)}
                  </select>
                </div>
                <div><label className="text-xs font-semibold text-gray-500">Start time</label><input type="time" value={assign.start} onChange={e => setAssign(a => ({ ...a, start: e.target.value }))} className={inp} /></div>
                <div><label className="text-xs font-semibold text-gray-500">Run hours</label><input type="number" min="0" step="0.5" value={assign.hours} onChange={e => setAssign(a => ({ ...a, hours: e.target.value }))} placeholder="e.g. 5.5" className={inp} /></div>
              </div>
              <div><label className="text-xs font-semibold text-gray-500">Operator</label><input list="dl-employees" value={assign.operator} onChange={e => setAssign(a => ({ ...a, operator: e.target.value }))} placeholder="Assign staff…" className={inp} /></div>
              <p className="text-[11px] text-gray-400">Start time + run hours place the job in its machine&rsquo;s timeline. Leave them blank to schedule the day only.</p>
              {err && <p className="text-xs text-red-600">{err}</p>}
              <button onClick={saveAssign} disabled={assignSaving} className="w-full rounded-lg py-2.5 text-white font-semibold disabled:opacity-50" style={{ background: '#3B6FE0' }}>{assignSaving ? 'Scheduling…' : 'Schedule work order'}</button>
            </div>
          </div>
        </div>
      )}

      {/* New (paste) plan drawer */}
      {newOpen && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(20,24,40,0.4)' }} onClick={() => setNewOpen(false)}>
          <div className="w-[600px] max-w-full bg-white h-full overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-[#EEF0F4] px-5 py-3 flex items-center justify-between z-10">
              <h2 className="font-bold text-[#1A1D2E]">Paste WhatsApp plan</h2>
              <button onClick={() => setNewOpen(false)} className="text-sm px-3 py-1.5 rounded-lg border border-[#E4E6EE] text-gray-500">Close</button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-gray-500">Paste your WhatsApp production plan (auto-detected), <strong>or</strong> just pick a date and click Create — then add machines with the dropdowns on the board.</p>
              <textarea value={paste} onChange={e => setPaste(e.target.value)} rows={14} placeholder={"7/20 Production Plan\nMM1 - Knife\nEXT 1 - 8x13 BG - Florentino/Ramon\n..."} className={inp + ' font-mono text-xs'} />
              <div className="flex items-center gap-3">
                <label className="text-xs text-gray-500">Plan date</label>
                <input type="date" value={planDate} onChange={e => setPlanDate(e.target.value)} className={inp + ' max-w-[180px]'} />
                <span className="text-[11px] text-gray-400">{preview.lines.length} machine line{preview.lines.length === 1 ? '' : 's'} detected</span>
              </div>
              {preview.lines.length > 0 && (
                <div className="border border-[#EEF0F4] rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead><tr className="text-[10px] uppercase text-gray-400 border-b border-[#EEF0F4] bg-[#F8FAFF]"><th className="text-left px-3 py-1.5">Machine</th><th className="text-left px-3 py-1.5">Product</th><th className="text-left px-3 py-1.5">Operator</th></tr></thead>
                    <tbody>{preview.lines.map((l, i) => (<tr key={i} className="border-b border-[#EEF0F4] last:border-0"><td className="px-3 py-1.5 font-semibold">{l.machine}</td><td className="px-3 py-1.5">{l.product || '—'}</td><td className="px-3 py-1.5 text-gray-500">{l.operator || '—'}</td></tr>))}</tbody>
                  </table>
                </div>
              )}
              {err && <p className="text-xs text-red-600">{err}</p>}
              <button onClick={createPlan} disabled={saving} className="w-full rounded-lg py-2.5 text-white font-semibold disabled:opacity-50" style={{ background: '#037f4c' }}>{saving ? 'Creating…' : 'Create plan'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
