'use client'

import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import ImportExportBar from '@/components/ImportExportBar'
import { useItemDeepLink } from '@/components/useItemDeepLink'
import MachineModal, { Machine, STATUSES, SC, DOT } from './MachineModal'

export const dynamic = 'force-dynamic'

type Job = { wo: string; status: string | null; customer: string | null }

// The board is grouped by department, the way the floor is actually laid out.
// Anything without a department falls into its own group at the end rather than
// disappearing, because a machine nobody has filed is exactly the one worth seeing.
const GROUP_COLOR: Record<string, string> = {
  MOLDING: '#7C3AED',
  EXTRUDER: '#2563EB',
  CONVERSION: '#2ABF06',
  STRAWS: '#F59E0B',
}
const UNFILED = 'No department'

const COLS = [
  { header: 'Name', dbKey: 'name', example: 'Injection Molder 1', required: true },
  { header: 'Machine Code', dbKey: 'machine_code', example: 'IM-01', required: true },
  { header: 'Status', dbKey: 'status', example: 'Idle' },
  { header: 'Department', dbKey: 'equipment_group', example: 'MOLDING' },
  { header: 'Equipment Type', dbKey: 'equipment_type', example: 'Injection Molding' },
  { header: 'Location', dbKey: 'location', example: 'MLD DEPT 1' },
  { header: 'Make', dbKey: 'make', example: 'Haitian' },
  { header: 'Model', dbKey: 'model', example: 'MA2800' },
  { header: 'Serial Number', dbKey: 'serial_number', example: '1234567' },
  { header: 'Notes', dbKey: 'notes', example: '' },
]

const inp = 'w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500'

export default function MachineStatusPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<Machine[]>([])
  const [jobs, setJobs] = useState<Record<string, Job>>({})
  const [today, setToday] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [archived, setArchived] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [open, setOpen] = useState<Machine | null>(null)
  const [adding, setAdding] = useState(false)
  const [newForm, setNewForm] = useState({ name: '', machine_code: '', equipment_group: '', status: 'Idle' })
  const [err, setErr] = useState('')

  async function load() {
    setLoading(true)
    const { data } = await sb.from('machines').select('*').order('name')
    const list = (data ?? []) as Machine[]
    setRows(list)

    const { data: wos } = await sb
      .from('work_orders')
      .select('wo_code,wo_number,status,machine_id,customers(company_name)')
      .not('machine_id', 'is', null)
      .order('created_at', { ascending: false })
    const CLOSED = ['Complete', 'QC Passed', 'Cancelled']
    const map: Record<string, Job> = {}
    for (const w of ((wos ?? []) as any[])) {
      if (CLOSED.includes(w.status)) continue
      const mid = w.machine_id as string
      const j: Job = {
        wo: w.wo_code || (w.wo_number ? 'WO-' + w.wo_number : 'Work order'),
        status: w.status ?? null,
        customer: w.customers?.company_name ?? null,
      }
      // Keep the one somebody started if there is one, otherwise the newest seen.
      if (!map[mid] || (j.status === 'In Progress' && map[mid].status !== 'In Progress')) map[mid] = j
    }
    setJobs(map)

    const since = new Date(); since.setHours(0, 0, 0, 0)
    const { data: reads } = await sb
      .from('machine_readings').select('machine_id, produced_delta')
      .gte('recorded_at', since.toISOString())
    const t: Record<string, number> = {}
    for (const r of ((reads ?? []) as any[])) {
      t[r.machine_id] = (t[r.machine_id] || 0) + (Number(r.produced_delta) || 0)
    }
    setToday(t)
    setLoading(false)
  }

  useEffect(() => { load() }, []) // eslint-disable-line

  useItemDeepLink(rows as any, (m: any) => setOpen(m))

  const filtered = rows.filter((r) => {
    if (!archived && !r.is_active) return false
    if (archived && r.is_active) return false
    if (!search) return true
    const q = search.toLowerCase()
    return [r.name, r.machine_code, r.location, r.status, r.make, r.model, r.serial_number, r.equipment_type, r.equipment_group, r.description]
      .some((v) => (v || '').toLowerCase().includes(q))
  })

  const counts = STATUSES.map((s) => ({ s, n: filtered.filter((r) => (r.status || 'Idle') === s).length }))

  const groups = useMemo(() => {
    const by: Record<string, Machine[]> = {}
    for (const m of filtered) {
      const k = (m.equipment_group || '').trim() || UNFILED
      ;(by[k] = by[k] || []).push(m)
    }
    const names = Object.keys(by).sort((a, b) => {
      if (a === UNFILED) return 1
      if (b === UNFILED) return -1
      return a.localeCompare(b)
    })
    return names.map((n) => ({ name: n, items: by[n] }))
  }, [filtered])

  async function createMachine() {
    setErr('')
    if (!newForm.name.trim()) { setErr('Give the machine a name.'); return }
    const { data, error } = await sb.from('machines').insert({
      name: newForm.name.trim(),
      machine_code: newForm.machine_code.trim() || null,
      equipment_group: newForm.equipment_group.trim() || null,
      status: newForm.status,
      is_active: true,
    }).select('*').maybeSingle()
    if (error) { setErr(error.message); return }
    setAdding(false)
    setNewForm({ name: '', machine_code: '', equipment_group: '', status: 'Idle' })
    await load()
    if (data) setOpen(data as Machine)
  }

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <span className="inline-block text-[10px] font-semibold tracking-wide bg-emerald-50 text-emerald-700 px-2 py-1 rounded">PRODUCTION</span>
          <h1 className="text-2xl font-semibold text-[#1A1D2E] mt-2">Machine Status</h1>
          <p className="text-xs text-gray-400 mt-1">{filtered.length} machines</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportExportBar table="machines" filename="machines" columns={COLS} onImportDone={load} />
          <button onClick={() => setAdding(true)}
                  className="px-4 py-2 rounded-lg text-sm bg-emerald-600 text-white hover:bg-emerald-700">+ Add Machine</button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
        {counts.map(({ s, n }) => (
          <div key={s} className="bg-white border border-[#E2E8F0] rounded-xl px-4 py-3 border-l-4"
               style={{ borderLeftColor: s === 'Running' ? '#2ABF06' : s === 'Down' ? '#E2445C' : s === 'Maintenance' ? '#F59E0B' : '#94A3B8' }}>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className={'w-1.5 h-1.5 rounded-full ' + DOT[s]} />{s}
            </div>
            <div className="text-2xl font-semibold mt-1 text-[#1A1D2E]">{n}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-4 mt-5 flex-wrap">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search machines..."
               className="w-full sm:w-80 border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
        <label className="flex items-center gap-2 text-sm text-gray-500">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
          Show archived
        </label>
        <div className="ml-auto flex gap-3 text-sm text-gray-500">
          <button onClick={() => setCollapsed(Object.fromEntries(groups.map((g) => [g.name, true])))} className="hover:text-gray-800">Collapse all</button>
          <button onClick={() => setCollapsed({})} className="hover:text-gray-800">Expand all</button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 mt-8">Loading machines...</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-gray-400 mt-8">{archived ? 'No archived machines.' : 'No machines yet.'}</p>
      ) : (
        <div className="mt-5 space-y-5">
          {groups.map((g) => {
            const color = GROUP_COLOR[g.name] || '#94A3B8'
            const running = g.items.filter((m) => (m.status || 'Idle') === 'Running').length
            const isShut = !!collapsed[g.name]
            return (
              <div key={g.name} className="rounded-xl border border-[#E2E8F0] overflow-hidden bg-white">
                <button onClick={() => setCollapsed({ ...collapsed, [g.name]: !isShut })}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50">
                  <span className="w-1 h-5 rounded-full" style={{ background: color }} />
                  <span className="text-xs text-gray-400">{isShut ? '▶' : '▼'}</span>
                  <span className="font-semibold text-sm" style={{ color }}>{g.name}</span>
                  <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">{g.items.length}</span>
                  <span className="ml-auto text-xs text-gray-500">{running} running</span>
                </button>

                {!isShut && (
                  <div className="overflow-x-auto border-t border-[#E2E8F0]">
                    <table className="w-full min-w-[900px]">
                      <thead>
                        <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 bg-[#F8FAFC]">
                          {['Machine', 'Status', 'Current job', 'Made today', 'Location', 'Notes'].map((h) => (
                            <th key={h} className="font-semibold px-4 py-2">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {g.items.map((m) => {
                          const st = m.status || 'Idle'
                          const job = jobs[m.id]
                          return (
                            <tr key={m.id} onClick={() => setOpen(m)}
                                className="border-t border-[#E2E8F0] cursor-pointer hover:bg-[#F8FAFC] transition-colors">
                              <td className="px-4 py-3">
                                <div className="font-medium text-sm text-[#1A1D2E]">{m.name}</div>
                                <div className="text-[11px] text-gray-400">{m.machine_code || '-'}{m.equipment_type ? ' · ' + m.equipment_type : ''}</div>
                              </td>
                              <td className="px-4 py-3">
                                <span className={'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border ' + (SC[st] || SC.Idle)}>
                                  <span className={'w-1.5 h-1.5 rounded-full ' + (DOT[st] || DOT.Idle)} />{st}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-sm">
                                {job ? (
                                  <>
                                    <div className="text-[#1A1D2E]">{job.customer || job.wo}</div>
                                    <div className="text-[11px] text-gray-400">
                                      {[job.customer ? job.wo : null, job.status].filter(Boolean).join(' · ') || '—'}
                                    </div>
                                  </>
                                ) : <span className="text-gray-300">-</span>}
                              </td>
                              <td className="px-4 py-3 text-sm">
                                {m.telemetry_enabled
                                  ? <span className="font-medium">{(today[m.id] || 0).toLocaleString()}</span>
                                  : <span className="text-gray-300" title="Live data is not switched on for this machine">-</span>}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-500">{m.location || <span className="text-gray-300">-</span>}</td>
                              <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">{m.notes || <span className="text-gray-300">-</span>}</td>
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

      {open && (
        <MachineModal machine={open} onClose={() => setOpen(null)}
                      onChanged={() => { setOpen(null); load() }} />
      )}

      {adding && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black/50" onClick={() => setAdding(false)} aria-hidden />
          <div className="relative min-h-full flex items-start justify-center p-4 sm:p-8">
            <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6" role="dialog" aria-modal="true">
              <h2 className="text-lg font-semibold text-[#1A1D2E]">Add a machine</h2>
              <p className="text-xs text-gray-400 mt-1">The rest of the detail can be filled in once it is on the board.</p>
              <div className="space-y-4 mt-4">
                <div><label className="block text-xs text-gray-400 mb-1.5">Machine name</label>
                  <input className={inp} value={newForm.name} onChange={(e) => setNewForm({ ...newForm, name: e.target.value })} /></div>
                <div><label className="block text-xs text-gray-400 mb-1.5">Code</label>
                  <input className={inp} value={newForm.machine_code} onChange={(e) => setNewForm({ ...newForm, machine_code: e.target.value })} /></div>
                <div><label className="block text-xs text-gray-400 mb-1.5">Department</label>
                  <input className={inp} value={newForm.equipment_group} placeholder="e.g. CONVERSION"
                         onChange={(e) => setNewForm({ ...newForm, equipment_group: e.target.value })} /></div>
                <div><label className="block text-xs text-gray-400 mb-1.5">Status</label>
                  <select className={inp} value={newForm.status} onChange={(e) => setNewForm({ ...newForm, status: e.target.value })}>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select></div>
              </div>
              {err && <p className="text-xs text-red-600 mt-3">{err}</p>}
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => setAdding(false)} className="px-4 py-2 rounded-lg text-sm border border-[#E2E8F0]">Cancel</button>
                <button onClick={createMachine} className="px-5 py-2 rounded-lg text-sm bg-emerald-600 text-white">Create</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
