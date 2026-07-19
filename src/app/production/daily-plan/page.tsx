'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Plan { id: string; plan_date: string; share_token: string; title: string | null; status: string; notes: string | null }
interface Line { id: string; plan_id: string; machine_code: string; product: string | null; operator: string | null; status: string; sort_order: number }
interface Stat { qty: number; unit: string; lastAt: string | null; lastStatus: string | null; count: number }

const LINE_SC: Record<string, string> = {
  Planned: 'bg-gray-100 text-gray-600', Running: 'bg-emerald-100 text-emerald-700',
  Down: 'bg-red-100 text-red-700', Offline: 'bg-gray-200 text-gray-500', Complete: 'bg-blue-100 text-blue-700',
}
const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
const fmtTime = (d: string | null) => d ? new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—'

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
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [toast, setToast] = useState('')
  // New-plan drawer
  const [newOpen, setNewOpen] = useState(false)
  const [paste, setPaste] = useState('')
  const [planDate, setPlanDate] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: pl } = await sb.from('production_day_plans').select('*').order('plan_date', { ascending: false }).limit(60)
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

  const preview = useMemo(() => parsePlanText(paste), [paste])
  useEffect(() => { if (preview.planDate && !planDate) setPlanDate(preview.planDate) }, [preview.planDate]) // eslint-disable-line

  function flash(m: string) { setToast(m); setTimeout(() => setToast(''), 2500) }
  function publicUrl(token: string) { return `${typeof window !== 'undefined' ? window.location.origin : ''}/dp/${token}` }
  function copyLink(p: Plan) { navigator.clipboard?.writeText(publicUrl(p.share_token)); flash('Operator link copied — paste it into WhatsApp') }

  async function createPlan() {
    setErr('')
    const date = planDate || preview.planDate
    if (!date) { setErr('Pick a plan date.'); return }
    if (!preview.lines.length) { setErr('Paste the plan text — no machine lines detected.'); return }
    setSaving(true)
    const { data: plan, error } = await sb.from('production_day_plans').insert({ plan_date: date, title: `Production Plan ${date}` }).select('*').single()
    if (error) { setSaving(false); setErr(error.code === '23505' ? 'A plan for that date already exists — delete it first or pick another date.' : error.message); return }
    const rows = preview.lines.map((l, i) => ({ plan_id: (plan as Plan).id, machine_code: l.machine, product: l.product || null, operator: l.operator || null, sort_order: i, status: (l.product || '').toLowerCase() === 'offline' ? 'Offline' : 'Planned' }))
    const { error: le } = await sb.from('production_plan_lines').insert(rows)
    setSaving(false)
    if (le) { setErr(le.message); return }
    setNewOpen(false); setPaste(''); setPlanDate(''); await load(); flash('Plan created — copy the link and send it in WhatsApp')
  }

  async function deletePlan(p: Plan) {
    if (!confirm(`Delete the ${fmtDate(p.plan_date)} plan and all its logs?`)) return
    await sb.from('production_day_plans').delete().eq('id', p.id); load()
  }
  async function delLine(l: Line) { if (!confirm(`Remove ${l.machine_code} from this plan?`)) return; await sb.from('production_plan_lines').delete().eq('id', l.id); load() }

  const inp = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00A84F]/30'

  return (
    <div className="min-h-screen mon-page p-4 sm:p-6 lg:p-8">
      {toast && <div className="fixed top-4 right-4 z-[70] bg-[#1A1D2E] text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-lg">{toast}</div>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
        <div>
          <span className="mon-tag" style={{ background: '#00A84F22', color: '#037f4c' }}>🏭 Production</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">Daily Production Plan</h1>
          <p className="text-gray-500 text-sm mt-0.5">Build tomorrow&rsquo;s plan, share the link in WhatsApp, and watch actual output come back every 2 hours.</p>
        </div>
        <button onClick={() => { setNewOpen(true); setErr(''); }} className="text-white font-semibold rounded-lg px-4 py-2 text-sm shadow-sm hover:opacity-90 whitespace-nowrap" style={{ background: '#037f4c' }}>+ New day plan</button>
      </div>

      <div className="bg-[#F0FBF5] border border-[#CDE9DA] rounded-lg px-4 py-2.5 mb-4 text-[13px] text-[#0F5132]">
        Create a plan (paste your WhatsApp &ldquo;Production Plan&rdquo; text), then <strong>Copy operator link</strong> and drop it in the WhatsApp group. Each operator taps their machine and logs output, running/down status, and a note every 2 hours — the actuals show up here live.
      </div>

      {loading ? <p className="text-gray-400 text-sm">Loading…</p> : plans.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#ECEEF3] p-10 text-center">
          <p className="text-sm text-gray-500">No plans yet.</p>
          <p className="text-xs text-gray-400 mt-1">Click &ldquo;New day plan&rdquo; and paste your production plan to get started.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {plans.map(p => {
            const lines = linesByPlan[p.id] || []
            const loggedCount = lines.filter(l => (statByLine[l.id]?.count || 0) > 0).length
            const isColl = collapsed[p.id]
            return (
              <div key={p.id} className="bg-white rounded-xl border border-[#ECEEF3] shadow-sm overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-[#EEF0F4] bg-[#F8FAFF] flex-wrap">
                  <button onClick={() => setCollapsed(c => ({ ...c, [p.id]: !c[p.id] }))} className="text-gray-400 text-xs">{isColl ? '▸' : '▾'}</button>
                  <p className="text-sm font-bold text-[#1A1D2E]">{fmtDate(p.plan_date)}</p>
                  <span className="text-[11px] text-gray-500">{lines.length} machines · {loggedCount} reporting</span>
                  <div className="ml-auto flex items-center gap-2">
                    <button onClick={() => copyLink(p)} className="text-[11px] px-2.5 py-1 rounded-lg bg-[#037f4c] text-white font-semibold hover:opacity-90">Copy operator link</button>
                    <a href={publicUrl(p.share_token)} target="_blank" rel="noreferrer" className="text-[11px] px-2 py-1 rounded-lg border border-[#E4E6EE] text-gray-600 hover:bg-gray-50">Open ↗</a>
                    <button onClick={() => deletePlan(p)} className="text-[11px] px-2 py-1 rounded-lg border border-red-200 text-red-500 hover:bg-red-50">Delete</button>
                  </div>
                </div>
                {!isColl && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[720px]">
                      <thead><tr className="text-[10px] uppercase text-gray-400 border-b border-[#EEF0F4]">
                        <th className="text-left px-4 py-2 font-semibold">Machine</th>
                        <th className="text-left px-3 py-2 font-semibold">What to run</th>
                        <th className="text-left px-3 py-2 font-semibold">Operator</th>
                        <th className="text-left px-3 py-2 font-semibold">Live status</th>
                        <th className="text-right px-3 py-2 font-semibold">Actual output</th>
                        <th className="text-left px-3 py-2 font-semibold">Last log</th>
                        <th className="px-3 py-2"></th>
                      </tr></thead>
                      <tbody>
                        {lines.map(l => {
                          const s = statByLine[l.id]
                          const live = s?.lastStatus || l.status
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
                )}
              </div>
            )
          })}
        </div>
      )}

      {newOpen && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(20,24,40,0.4)' }} onClick={() => setNewOpen(false)}>
          <div className="w-[600px] max-w-full bg-white h-full overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-[#EEF0F4] px-5 py-3 flex items-center justify-between z-10">
              <h2 className="font-bold text-[#1A1D2E]">New day plan</h2>
              <button onClick={() => setNewOpen(false)} className="text-sm px-3 py-1.5 rounded-lg border border-[#E4E6EE] text-gray-500">Close</button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-gray-500">Paste your WhatsApp production plan below. The machine, product and operator are detected automatically.</p>
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
                    <tbody>
                      {preview.lines.map((l, i) => (
                        <tr key={i} className="border-b border-[#EEF0F4] last:border-0"><td className="px-3 py-1.5 font-semibold">{l.machine}</td><td className="px-3 py-1.5">{l.product || '—'}</td><td className="px-3 py-1.5 text-gray-500">{l.operator || '—'}</td></tr>
                      ))}
                    </tbody>
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
