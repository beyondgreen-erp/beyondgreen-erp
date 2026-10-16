'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import ShareLink from '@/components/ShareLink'
import ItemHistory from '@/components/ItemHistory'
import MachineMimic from '@/components/MachineMimic'

export type Machine = {
  id: string
  name: string
  machine_code: string | null
  status: string | null
  location: string | null
  notes: string | null
  is_active: boolean
  make: string | null
  model: string | null
  description: string | null
  serial_number: string | null
  equipment_type: string | null
  equipment_group: string | null
  telemetry_enabled?: boolean | null
  ip_address?: string | null
  modbus_port?: number | null
  modbus_unit_id?: number | null
  last_seen_at?: string | null
}

export const STATUSES = ['Running', 'Idle', 'Maintenance', 'Down']

export const SC: Record<string, string> = {
  Running: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Idle: 'bg-gray-100 text-gray-600 border-gray-200',
  Maintenance: 'bg-amber-50 text-amber-700 border-amber-200',
  Down: 'bg-red-50 text-red-700 border-red-200',
}

export const DOT: Record<string, string> = {
  Running: 'bg-emerald-500',
  Idle: 'bg-gray-400',
  Maintenance: 'bg-amber-500',
  Down: 'bg-red-500',
}

// A job in one of these states is finished with, so it is not what the machine is on now.
const CLOSED = ['Complete', 'QC Passed', 'Cancelled']

type Job = {
  id: string
  wo_code: string | null
  wo_number: number | null
  status: string | null
  priority: string | null
  due_date: string | null
  item_part_number: string | null
  uom: string | null
  qty_required: number | null
  qty_ordered: number | null
  qty_completed: number | null
  qty_produced: number | null
  customer_id: string | null
  product_id: string | null
  customer?: string | null
  product?: string | null
}

type CrewMember = { id: string; role: string | null; name: string }

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function ago(iso: string | null | undefined) {
  if (!iso) return null
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return s + 's ago'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  return Math.floor(s / 86400) + 'd ago'
}

const inp = 'w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500'
const lbl = 'block text-xs text-gray-400 mb-1.5'

export default function MachineModal({
  machine,
  onClose,
  onChanged,
}: {
  machine: Machine
  onClose: () => void
  onChanged: () => void
}) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [tab, setTab] = useState<'live' | 'details' | 'history'>('live')
  const [form, setForm] = useState<Machine>(machine)
  const [job, setJob] = useState<Job | null>(null)
  const [crew, setCrew] = useState<CrewMember[]>([])
  const [people, setPeople] = useState<{ id: string; name: string }[]>([])
  const [addId, setAddId] = useState('')
  const [reading, setReading] = useState<{ counter_total: number | null; recorded_at: string } | null>(null)
  const [madeToday, setMadeToday] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => setForm(machine), [machine])

  // Escape closes, the same as clicking away. A floor screen gets poked at.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: wos } = await sb
        .from('work_orders').select('*')
        .eq('machine_id', machine.id)
        .order('created_at', { ascending: false }).limit(30)
      const open = ((wos ?? []) as any[]).filter((w) => !CLOSED.includes(w.status || ''))
      // Prefer the job somebody actually started over the newest one sitting in the queue.
      const j = (open.find((w) => w.status === 'In Progress') ?? open[0] ?? null) as Job | null

      if (j) {
        if (j.customer_id) {
          const { data } = await sb.from('customers').select('company_name').eq('id', j.customer_id).maybeSingle()
          j.customer = (data as any)?.company_name ?? null
        }
        if (j.product_id) {
          const { data } = await sb.from('products').select('name,sku').eq('id', j.product_id).maybeSingle()
          j.product = (data as any) ? ((data as any).name || (data as any).sku) : null
        }
        const { data: ops } = await sb
          .from('work_order_operators').select('id, role, employees(name)')
          .eq('work_order_id', j.id)
        setCrew(((ops ?? []) as any[]).map((o) => ({
          id: o.id, role: o.role, name: o.employees?.name ?? 'Unknown',
        })))
      } else {
        setCrew([])
      }
      setJob(j)

      if (machine.telemetry_enabled) {
        const { data: last } = await sb
          .from('machine_readings').select('counter_total, recorded_at')
          .eq('machine_id', machine.id)
          .order('recorded_at', { ascending: false }).limit(1)
        setReading(((last ?? []) as any[])[0] ?? null)
        const since = new Date(); since.setHours(0, 0, 0, 0)
        const { data: today } = await sb
          .from('machine_readings').select('produced_delta')
          .eq('machine_id', machine.id).gte('recorded_at', since.toISOString())
        setMadeToday(((today ?? []) as any[]).reduce((n, r) => n + (Number(r.produced_delta) || 0), 0))
      } else {
        setReading(null); setMadeToday(null)
      }
    } finally {
      setLoading(false)
    }
  }, [sb, machine])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    sb.from('employees').select('id,name').eq('status', 'Active').order('name')
      .then(({ data }) => setPeople(((data ?? []) as any[]).map((p) => ({ id: p.id, name: p.name }))))
  }, [sb])

  // Live numbers only refresh while the machine is actually reporting.
  useEffect(() => {
    if (!machine.telemetry_enabled) return
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [machine.telemetry_enabled, load])

  const required = num(job?.qty_required) ?? num(job?.qty_ordered)
  const requiredIsFallback = num(job?.qty_required) === null && num(job?.qty_ordered) !== null
  const done = num(job?.qty_completed) ?? num(job?.qty_produced) ?? 0
  const remaining = required !== null ? Math.max(0, required - done) : null
  const pct = required && required > 0 ? Math.min(100, Math.round((done / required) * 100)) : 0

  const status = form.status || 'Idle'

  async function save() {
    setSaving(true); setErr('')
    const { error } = await sb.from('machines').update({
      name: form.name,
      machine_code: form.machine_code,
      status: form.status,
      location: form.location,
      notes: form.notes,
      make: form.make,
      model: form.model,
      description: form.description,
      serial_number: form.serial_number,
      equipment_type: form.equipment_type,
      equipment_group: form.equipment_group,
      telemetry_enabled: !!form.telemetry_enabled,
      ip_address: form.ip_address,
      modbus_port: num(form.modbus_port),
      modbus_unit_id: num(form.modbus_unit_id),
    }).eq('id', machine.id)
    setSaving(false)
    if (error) { setErr(error.message); return }
    onChanged()
  }

  async function addOperator() {
    if (!addId || !job) return
    const { error } = await sb.from('work_order_operators')
      .insert({ work_order_id: job.id, employee_id: addId })
    if (error) { setErr(error.message); return }
    setAddId(''); load()
  }

  async function removeOperator(id: string) {
    const { error } = await sb.from('work_order_operators').delete().eq('id', id)
    if (error) { setErr(error.message); return }
    load()
  }

  const Tile = ({ label, value, tone }: { label: string; value: string; tone?: string }) => (
    <div className="border border-[#E2E8F0] rounded-xl px-4 py-3 bg-white">
      <div className="text-[11px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className={'text-xl font-semibold mt-0.5 ' + (tone || 'text-[#1A1D2E]')}>{value}</div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div className="relative min-h-full flex items-start justify-center p-4 sm:p-8">
        <div className="w-full max-w-5xl bg-white rounded-2xl shadow-2xl"
             role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>

          <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-[#E2E8F0]">
            <div className="min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-lg font-semibold text-[#1A1D2E] truncate">{form.name}</h2>
                <span className={'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border ' + (SC[status] || SC.Idle)}>
                  <span className={'w-1.5 h-1.5 rounded-full ' + (DOT[status] || DOT.Idle)} />
                  {status}
                </span>
                <ShareLink id={machine.id} />
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {form.machine_code || 'No code'}
                {form.equipment_group ? ' · ' + form.equipment_group : ''}
                {form.location ? ' · ' + form.location : ''}
              </p>
            </div>
            <button onClick={onClose} aria-label="Close"
                    className="text-gray-400 hover:text-gray-700 text-xl leading-none px-2">&times;</button>
          </div>

          <div className="px-6 pt-4 flex gap-1 border-b border-[#E2E8F0]">
            {([['live', 'Live'], ['details', 'Details'], ['history', 'History']] as const).map(([k, t]) => (
              <button key={k} onClick={() => setTab(k)}
                      className={'px-4 py-2 text-sm rounded-t-lg border-b-2 -mb-px transition-colors ' +
                        (tab === k ? 'border-emerald-600 text-emerald-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800')}>
                {t}
              </button>
            ))}
          </div>

          <div className="p-6 space-y-6">
            {err && <p className="text-xs text-red-600">{err}</p>}

            {tab === 'live' && (
              <>
                <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                  <MachineMimic status={status} code={form.machine_code || form.name}
                                counter={reading?.counter_total ?? null}
                                live={!!form.telemetry_enabled && !!reading} />
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <Tile label="Status" value={status}
                        tone={status === 'Running' ? 'text-emerald-600' : status === 'Down' ? 'text-red-600' : ''} />
                  <Tile label="Counter" value={reading?.counter_total != null ? reading.counter_total.toLocaleString() : 'No feed'} />
                  <Tile label="Made today" value={madeToday != null ? madeToday.toLocaleString() : 'No feed'} />
                  <Tile label="Last seen" value={ago(machine.last_seen_at) || 'Never'} />
                </div>

                {!form.telemetry_enabled && (
                  <div className="rounded-xl border border-dashed border-[#E2E8F0] p-4 text-sm text-gray-500">
                    Live data is not switched on for this machine, so the status above is the one somebody typed.
                    Turn it on under Details once the machine is wired up.
                  </div>
                )}

                <div className="rounded-xl border border-[#E2E8F0] p-4">
                  <h3 className="text-xs uppercase tracking-wide text-gray-400 mb-3">Current job</h3>
                  {loading ? (
                    <p className="text-sm text-gray-400">Loading...</p>
                  ) : !job ? (
                    <p className="text-sm text-gray-500">No open work order is assigned to this machine.</p>
                  ) : (
                    <>
                      <div className="flex items-baseline justify-between gap-3 flex-wrap">
                        <div className="font-medium text-[#1A1D2E]">
                          {job.wo_code || (job.wo_number ? 'WO-' + job.wo_number : 'Work order')}
                          {job.product ? ' · ' + job.product : job.item_part_number ? ' · ' + job.item_part_number : ''}
                        </div>
                        <div className="text-xs text-gray-500">
                          {job.customer || 'No customer'}
                          {job.status ? ' · ' + job.status : ''}
                          {job.due_date ? ' · due ' + job.due_date : ''}
                        </div>
                      </div>

                      <div className="mt-3 h-2 rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-full bg-emerald-500 transition-all" style={{ width: pct + '%' }} />
                      </div>

                      <div className="grid grid-cols-3 gap-3 mt-3 text-sm">
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-gray-400">Required</div>
                          <div className="font-semibold">{required != null ? required.toLocaleString() : 'Not set'}</div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-gray-400">Completed</div>
                          <div className="font-semibold">{done.toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-gray-400">Remaining</div>
                          <div className="font-semibold">{remaining != null ? remaining.toLocaleString() : '-'}</div>
                        </div>
                      </div>
                      {requiredIsFallback && (
                        <p className="text-[11px] text-amber-600 mt-2">
                          This work order has no required quantity set, so the ordered quantity is being shown instead.
                        </p>
                      )}
                    </>
                  )}
                </div>

                <div className="rounded-xl border border-[#E2E8F0] p-4">
                  <h3 className="text-xs uppercase tracking-wide text-gray-400 mb-3">On this machine</h3>
                  {!job ? (
                    <p className="text-sm text-gray-500">A crew is assigned to a work order, and there is no open one here yet.</p>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-2">
                        {crew.length === 0 && <span className="text-sm text-gray-500">Nobody assigned yet.</span>}
                        {crew.map((c) => (
                          <span key={c.id} className="inline-flex items-center gap-2 bg-gray-100 rounded-full pl-3 pr-1.5 py-1 text-sm">
                            {c.name}{c.role ? <span className="text-gray-400 text-xs">{c.role}</span> : null}
                            <button onClick={() => removeOperator(c.id)} aria-label={'Remove ' + c.name}
                                    className="text-gray-400 hover:text-red-600 px-1">&times;</button>
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-2 mt-3">
                        <select value={addId} onChange={(e) => setAddId(e.target.value)} className={inp + ' max-w-xs'}>
                          <option value="">Add somebody...</option>
                          {people.filter((p) => !crew.some((c) => c.name === p.name)).map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        <button onClick={addOperator} disabled={!addId}
                                className="px-4 py-2 rounded-lg text-sm bg-[#1A1D2E] text-white disabled:opacity-40">Add</button>
                      </div>
                      {job.customer === undefined && null}
                      {(job as any).assigned_operator && crew.length === 0 && (
                        <p className="text-[11px] text-gray-400 mt-2">
                          The old single operator field on this work order says {(job as any).assigned_operator}. Add them above to move it across.
                        </p>
                      )}
                    </>
                  )}
                </div>
              </>
            )}

            {tab === 'details' && (
              <>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div><label className={lbl}>Machine name</label>
                    <input className={inp} value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                  <div><label className={lbl}>Code</label>
                    <input className={inp} value={form.machine_code || ''} onChange={(e) => setForm({ ...form, machine_code: e.target.value })} /></div>
                  <div><label className={lbl}>Status</label>
                    <select className={inp} value={form.status || 'Idle'} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select></div>
                  <div><label className={lbl}>Department</label>
                    <input className={inp} value={form.equipment_group || ''} onChange={(e) => setForm({ ...form, equipment_group: e.target.value })} placeholder="e.g. CONVERSION" /></div>
                  <div><label className={lbl}>Equipment type</label>
                    <input className={inp} value={form.equipment_type || ''} onChange={(e) => setForm({ ...form, equipment_type: e.target.value })} /></div>
                  <div><label className={lbl}>Location</label>
                    <input className={inp} value={form.location || ''} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
                  <div><label className={lbl}>Make</label>
                    <input className={inp} value={form.make || ''} onChange={(e) => setForm({ ...form, make: e.target.value })} /></div>
                  <div><label className={lbl}>Model</label>
                    <input className={inp} value={form.model || ''} onChange={(e) => setForm({ ...form, model: e.target.value })} /></div>
                  <div><label className={lbl}>Serial number</label>
                    <input className={inp} value={form.serial_number || ''} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} /></div>
                  <div><label className={lbl}>Description</label>
                    <input className={inp} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
                </div>

                <div>
                  <label className={lbl}>Notes</label>
                  <textarea rows={3} className={inp + ' resize-none'} value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>

                <div className="rounded-xl border border-[#E2E8F0] p-4">
                  <label className="flex items-center gap-2 text-sm font-medium text-[#1A1D2E]">
                    <input type="checkbox" checked={!!form.telemetry_enabled}
                           onChange={(e) => setForm({ ...form, telemetry_enabled: e.target.checked })} />
                    Read this machine live
                  </label>
                  <p className="text-xs text-gray-500 mt-1">
                    With this on, the status above is set by what the machine reports instead of by hand.
                    Maintenance is never overwritten, so taking a machine out of service still sticks.
                  </p>
                  <div className="grid sm:grid-cols-3 gap-4 mt-4">
                    <div><label className={lbl}>PLC address</label>
                      <input className={inp} value={form.ip_address || ''} placeholder="192.168.1.88"
                             onChange={(e) => setForm({ ...form, ip_address: e.target.value })} /></div>
                    <div><label className={lbl}>Modbus port</label>
                      <input className={inp} value={form.modbus_port ?? ''} placeholder="502"
                             onChange={(e) => setForm({ ...form, modbus_port: e.target.value as any })} /></div>
                    <div><label className={lbl}>Unit ID</label>
                      <input className={inp} value={form.modbus_unit_id ?? ''} placeholder="1"
                             onChange={(e) => setForm({ ...form, modbus_unit_id: e.target.value as any })} /></div>
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border border-[#E2E8F0]">Cancel</button>
                  <button onClick={save} disabled={saving}
                          className="px-5 py-2 rounded-lg text-sm bg-emerald-600 text-white disabled:opacity-50">
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </>
            )}

            {tab === 'history' && <ItemHistory table="machines" recordId={machine.id} defaultOpen />}
          </div>
        </div>
      </div>
    </div>
  )
}
