'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState, useCallback } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import Comments from '@/components/Comments'
import FileUpload from '@/components/FileUpload'
import { useItemDeepLink } from '@/components/useItemDeepLink'
import { checkOrderReadyToShip } from '@/lib/orderFlow'
import ExportButton from '@/components/ExportButton'
import RunEntry from '@/components/RunEntry'
import { GROUPS, FORMS, formFor, groupByName, nextWoCode, computeAll, type GroupDef, type Field, type FormDef } from '@/lib/workOrderForms'
import { buildMachineQueue, runHours, hoursAreCalculated, toMinutes, fmtClock, woLabel, tomorrowISO, type SchedulableWO } from '@/lib/productionSchedule'
import { isPlaceholderPart, needsPartNumber, PART_NUMBER_APPROVERS } from '@/lib/partNumber'

const sb = createSupabaseBrowserClient()

// Stored status values are unchanged — the Sidebar counter, WorkflowMover and the QC board
// all read them. Only the wording on this page follows the floor: queued vs in production.
const STATUS_OPTIONS = ['Queued', 'In Progress', 'QC', 'QC Passed', 'Complete', 'On Hold', 'Cancelled'] as const
const STATUS_LABEL: Record<string, string> = {
  Queued: 'In Queue',
  'In Progress': 'In Production',
  QC: 'QC',
  'QC Passed': 'QC Passed',
  Complete: 'Complete',
  'On Hold': 'On Hold',
  Cancelled: 'Cancelled',
}
// These two render the sheet and MUST stay at module scope. Declared inside the page
// component they were a new function identity on every render, so React threw the <input>
// away and built a fresh one after each keystroke — the caret went with it, which is why
// typing a part number meant one character, Enter, one character, Enter.
function FieldInput({ f, live, onChange }: { f: Field; live: Record<string, any>; onChange: (key: string, value: any) => void }) {
  const base = 'w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500'
  if (f.type === 'computed') {
    const v = f.compute ? f.compute(live) : ''
    const shown = typeof v === 'number' ? Number(v.toFixed(f.dp ?? 2)).toLocaleString() : v
    return <div className={`${base} bg-gray-50 text-gray-700 font-medium`}>{shown === '' || shown === '0' ? '—' : shown}</div>
  }
  if (f.type === 'textarea') {
    return <textarea rows={3} value={live[f.key] ?? ''} onChange={e => onChange(f.key, e.target.value)} className={base} />
  }
  if (f.type === 'select') {
    return (
      <select value={live[f.key] ?? ''} onChange={e => onChange(f.key, e.target.value)} className={`${base} cursor-pointer`}>
        <option value="">—</option>
        {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }
  // Numbers are typed into a text box on purpose. A controlled <input type="number"> reports
  // a half-typed "0." or "1." as an empty string, so React writes that empty string straight
  // back and the decimal point disappears as you type it — 0.42 becomes 42. Keeping the raw
  // text and filtering to digits and a point lets a decimal be typed left to right.
  if (f.type === 'number') {
    return (
      <input
        type="text"
        inputMode="decimal"
        value={live[f.key] ?? ''}
        placeholder={f.placeholder}
        onChange={e => onChange(f.key, e.target.value.replace(/[^0-9.\-]/g, ''))}
        className={base}
      />
    )
  }
  return (
    <input
      type={f.type === 'date' ? 'date' : 'text'}
      value={live[f.key] ?? ''}
      placeholder={f.placeholder}
      onChange={e => onChange(f.key, e.target.value)}
      className={base}
    />
  )
}

function FormBody({ form, live, onChange }: { form: FormDef; live: Record<string, any>; onChange: (key: string, value: any) => void }) {
  return (
    <div className="space-y-6">
      {form.sections.map((sec, si) => (
        <div key={si}>
          {sec.title && <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-2">{sec.title}</p>}
          <div className={`grid gap-3 ${sec.columns === 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
            {sec.fields.map(f => (
              <div key={f.key} className={f.wide ? 'sm:col-span-2' : ''}>
                <label className="block text-xs text-gray-400 mb-1">{f.label}</label>
                <FieldInput f={f} live={live} onChange={onChange} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

const DONE_STATUSES = ['QC Passed', 'Complete']
const IDLE_AFTER = ['QC Passed', 'Complete', 'Cancelled', 'On Hold']
const OPEN_STATUSES = ['Queued', 'In Progress', 'QC', 'On Hold']

// Green while it is running, red while it is waiting for a machine. Everything else is
// finished or parked, and is shown grey so the two live states stay the ones you notice.
function dotColor(status: string) {
  if (status === 'In Progress') return '#16a34a'
  if (status === 'Queued') return '#dc2626'
  if (status === 'QC') return '#7c3aed'
  if (status === 'On Hold') return '#d97706'
  return '#9ca3af'
}

interface Machine { id: string; name: string; machine_code: string; status: string; equipment_group: string | null }

interface WO {
  id: string
  wo_number: string | number
  wo_code: string | null
  group_name: string | null
  form_type: string | null
  item_part_number: string | null
  uom: string | null
  spec: Record<string, any> | null
  sales_order_id: string | null
  product_id: string | null
  machine_id: string | null
  qty_ordered: number | null
  status: string
  notes: string | null
  created_at: string
  scheduled_date: string | null
  scheduled_start: string | null
  scheduled_hours: number | null
  assigned_operator: string | null
  approval_state: string | null
  auto_reason: string | null
  approved_at: string | null
  approved_by: string | null
  sales_orders?: { order_number: string; customers?: { company_name: string } } | null
}

interface Employee { id: string; name: string; department: string | null }

interface SoLine {
  id: string
  sales_order_id: string
  sku: string | null
  description: string | null
  quantity: number | null
  unit_of_measure: string | null
  product_id: string | null
  order_number: string
  customer: string
}

export default function WorkOrdersPage() {
  const [orders, setOrders] = useState<WO[]>([])
  const [machines, setMachines] = useState<Machine[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [soLines, setSoLines] = useState<SoLine[]>([])
  const [loading, setLoading] = useState(true)
  const [userEmail, setUserEmail] = useState('')
  const [detail, setDetail] = useState<WO | null>(null)
  const [spec, setSpec] = useState<Record<string, any>>({})
  const [dirty, setDirty] = useState(false)
  const [hoursDraft, setHoursDraft] = useState('')
  const [requesting, setRequesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [creatingIn, setCreatingIn] = useState<GroupDef | null>(null)
  const [newMachine, setNewMachine] = useState('')
  const [newSoLine, setNewSoLine] = useState('')
  const [busy, setBusy] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [woProduct, setWoProduct] = useState<{ sku: string; product_name: string | null; on_hand_qty: number | null } | null>(null)
  const [fgMoves, setFgMoves] = useState<{ created_at: string; qty: number; uom: string | null; created_by: string | null }[]>([])
  const [booking, setBooking] = useState(false)
  const [negStock, setNegStock] = useState<{ sku: string; product_name: string | null; on_hand_qty: number | null }[]>([])

  const fmtN = (v: any) => (v === null || v === undefined || v === '') ? '—' : Number(v).toLocaleString()
  const fgBooked = fgMoves.reduce((s, m) => s + Number(m.qty || 0), 0)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: wos }, { data: mach }, { data: emps }, { data: neg }] = await Promise.all([
      sb.from('work_orders')
        .select('*, sales_orders!work_orders_sales_order_id_fkey(order_number, customers(company_name))')
        .order('created_at', { ascending: false }),
      sb.from('machines').select('id,name,machine_code,status,equipment_group').eq('is_active', true).order('name'),
      // Whoever could be put on a machine. Floor staff first; everyone else is still
      // pickable, because a supervisor covering a run is normal.
      sb.from('employees').select('id,name,department').eq('status', 'Active').is('end_date', null).order('name'),
      // Stock that has gone negative is production that was shipped but never booked in.
      sb.from('products').select('sku,product_name,on_hand_qty').lt('on_hand_qty', 0).order('on_hand_qty').limit(50),
    ])
    setOrders((wos as WO[]) || [])
    setMachines((mach as Machine[]) || [])
    setEmployees((emps as Employee[]) || [])
    setNegStock((neg as any[]) || [])
    setLoading(false)
    sb.auth.getUser().then(({ data: u }) => { if (u.user?.email) setUserEmail(u.user.email) })
  }, [])

  useEffect(() => { load() }, [load])

  // Open sales order lines, so a work order can be raised straight off what was sold
  // instead of retyping the part number and quantity.
  useEffect(() => {
    if (!creatingIn || soLines.length) return
    ;(async () => {
      const { data: sos } = await sb.from('sales_orders')
        .select('id, order_number, notes, customers(company_name)')
        .not('status', 'in', '("Shipped","Cancelled","Closed")')
        .order('order_date', { ascending: false })
        .limit(120)
      const ids = ((sos as any[]) || []).map(o => o.id)
      if (!ids.length) return
      const { data: lines } = await sb.from('sales_order_lines')
        .select('id, sales_order_id, sku, description, quantity, unit_of_measure, product_id')
        .in('sales_order_id', ids)
      const byId: Record<string, any> = {}
      ;((sos as any[]) || []).forEach(o => { byId[o.id] = o })
      setSoLines((((lines as any[]) || []).map(l => {
        const o = byId[l.sales_order_id] || {}
        return {
          ...l,
          order_number: o.order_number ?? '',
          customer: o.customers?.company_name || String(o.notes ?? '').split('|')[0].trim() || '',
        }
      })) as SoLine[])
    })()
  }, [creatingIn, soLines.length])

  // Detail extras: the finished-goods product and anything already booked from this run.
  // Keyed on the work order's id, not the object. Every control in the header — status,
  // machine, production day, start time, operator, run hours — replaces `detail` with a new
  // object, and this effect used to run on each of those and reload the sheet from the
  // database: it silently threw away everything typed but not yet saved and cleared `dirty`,
  // which greys out Save. So you filled the sheet in, set the machine, and Save went dead.
  // Now it only reloads when a different work order is opened.
  const detailId = detail?.id ?? null
  useEffect(() => {
    if (!detailId) { setWoProduct(null); setFgMoves([]); return }
    setSpec({ ...(detail?.spec || {}) })
    setHoursDraft(detail?.scheduled_hours == null ? '' : String(detail.scheduled_hours))
    setDirty(false)
    const pid = detail?.product_id ?? null
    ;(async () => {
      if (pid) {
        const { data: pr } = await sb.from('products').select('sku,product_name,on_hand_qty').eq('id', pid).maybeSingle()
        setWoProduct((pr as any) || null)
      } else setWoProduct(null)
      const { data: mv } = await sb.from('inventory_movements')
        .select('created_at,qty,uom,created_by')
        .eq('ref_table', 'work_orders').eq('ref_id', detailId).eq('movement_type', 'produce').order('created_at')
      setFgMoves((mv as any[]) || [])
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailId])

  const openDetail = useCallback((wo: WO) => setDetail(wo), [])
  useItemDeepLink(orders, openDetail)

  const machineName = useCallback((id: string | null) => machines.find(m => m.id === id)?.name ?? null, [machines])

  const machinesFor = useCallback((g: GroupDef) => {
    const inGroup = machines.filter(m => g.machineGroups.includes(m.equipment_group ?? ''))
    return inGroup.length ? inGroup : machines
  }, [machines])

  const byGroup = useMemo(() => {
    const map: Record<string, WO[]> = {}
    GROUPS.forEach(g => { map[g.name] = [] })
    const loose: WO[] = []
    orders.forEach(wo => {
      // Anything still waiting for approval lives in its own bucket at the top, not in a
      // group tile — it has no group yet, and that is the point of approving it.
      if (wo.approval_state === 'pending') return
      if (!showDone && !OPEN_STATUSES.includes(wo.status)) return
      if (wo.group_name && map[wo.group_name]) map[wo.group_name].push(wo)
      else loose.push(wo)
    })
    return { map, loose }
  }, [orders, showDone])

  /** Raised automatically off a stock shortage and not yet looked at by anyone. */
  const pendingApproval = useMemo(
    () => orders.filter(wo => wo.approval_state === 'pending'),
    [orders])

  // Open jobs still waiting on a part number. Finished and cancelled ones are left alone —
  // chasing a number for a job nobody is going to run is noise.
  const missingPart = useMemo(
    () => orders.filter(wo => OPEN_STATUSES.includes(wo.status) && needsPartNumber(wo) && wo.approval_state !== 'pending'),
    [orders])

  // ── Actions ────────────────────────────────────────────────────────────────

  /**
   * Approve a job the system raised. It only joins a group tile once it has a group, so the
   * group is what approval actually requires — the machine and the operator can follow, and a
   * job with no machine still shows on the board rather than disappearing.
   */
  async function approveWO(wo: WO) {
    if (!wo.group_name) {
      alert('Give this work order a production group first — open it and pick the group it runs in. Without one it has no tile to sit on.')
      setDetail(wo)
      return
    }
    const g = groupByName(wo.group_name)
    const label = wo.wo_code || `WO-${wo.wo_number}`
    if (!window.confirm(`Approve ${label} and put it in the ${wo.group_name} queue?`)) return
    const patch: Record<string, any> = {
      approval_state: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: userEmail || null,
      updated_at: new Date().toISOString(),
    }
    // Give it a proper code now the group is known — the codes read by group, so one could
    // not be issued while the job had no group.
    if (!wo.wo_code && g) patch.wo_code = nextWoCode(g, orders.map(o => o.wo_code).filter((c): c is string => !!c))
    if (!wo.form_type && g) patch.form_type = g.form
    const { error } = await sb.from('work_orders').update(patch).eq('id', wo.id)
    if (error) { alert('Could not approve: ' + error.message); return }
    setOrders(os => os.map(o => (o.id === wo.id ? { ...o, ...patch } as WO : o)))
    setDetail(d => (d && d.id === wo.id ? { ...d, ...patch } as WO : d))
  }

  /** Not needed after all — keep the row and the reason, take it off the floor's list. */
  async function rejectWO(wo: WO) {
    const label = wo.wo_code || `WO-${wo.wo_number}`
    if (!window.confirm(`Reject ${label}?\n\nIt will be cancelled and leave the approval list. The order it came from is not changed.`)) return
    const patch = {
      approval_state: 'rejected', status: 'Cancelled',
      approved_at: new Date().toISOString(), approved_by: userEmail || null,
      updated_at: new Date().toISOString(),
    }
    const { error } = await sb.from('work_orders').update(patch).eq('id', wo.id)
    if (error) { alert('Could not reject: ' + error.message); return }
    setOrders(os => os.map(o => (o.id === wo.id ? { ...o, ...patch } as WO : o)))
    setDetail(d => (d && d.id === wo.id ? { ...d, ...patch } as WO : d))
  }

  async function setStatus(wo: WO, status: string) {
    if (!status || status === wo.status) return
    setOrders(os => os.map(o => (o.id === wo.id ? { ...o, status } : o)))
    setDetail(d => (d && d.id === wo.id ? { ...d, status } : d))
    await sb.from('work_orders').update({ status, updated_at: new Date().toISOString() }).eq('id', wo.id)
    if (DONE_STATUSES.includes(status) && wo.sales_order_id) {
      try { await checkOrderReadyToShip(wo.sales_order_id) } catch { /* non-blocking */ }
    }
    const mid = wo.machine_id
    if (mid) {
      const ms = status === 'In Progress' ? 'Running' : IDLE_AFTER.includes(status) ? 'Idle' : null
      if (ms) {
        await sb.from('machines').update({ status: ms, updated_at: new Date().toISOString() }).eq('id', mid)
        setMachines(list => list.map(m => (m.id === mid ? { ...m, status: ms } : m)))
      }
    }
    // Completing books finished goods in the database, so re-read the stock figures
    // rather than leaving the panel showing what was on hand a moment ago.
    if (status === 'Complete') await refreshFG()
  }

  async function setMachineOn(wo: WO, machineId: string) {
    const mid = machineId || null
    const name = machines.find(m => m.id === mid)?.name ?? ''
    const nextSpec = { ...(wo.spec || {}), machine_no: name }
    setOrders(os => os.map(o => (o.id === wo.id ? { ...o, machine_id: mid, spec: nextSpec } : o)))
    setDetail(d => (d && d.id === wo.id ? { ...d, machine_id: mid, spec: nextSpec } : d))
    setSpec(s => (detail && detail.id === wo.id ? { ...s, machine_no: name } : s))
    await sb.from('work_orders').update({ machine_id: mid, spec: nextSpec, updated_at: new Date().toISOString() }).eq('id', wo.id)
    if (mid && wo.status === 'In Progress') {
      await sb.from('machines').update({ status: 'Running', updated_at: new Date().toISOString() }).eq('id', mid)
      setMachines(ms => ms.map(m => (m.id === mid ? { ...m, status: 'Running' } : m)))
    }
  }

  async function createWorkOrder() {
    if (!creatingIn) return
    setBusy(true)
    try {
      const g = creatingIn
      const line = soLines.find(l => l.id === newSoLine)
      const code = nextWoCode(g, orders.map(o => o.wo_code || ''))
      const mName = machines.find(m => m.id === newMachine)?.name ?? ''
      const initSpec: Record<string, any> = {
        date: new Date().toISOString().slice(0, 10),
        machine_no: mName,
        wo_code: code,
        item_part_number: line?.sku ?? '',
      }
      if (line?.quantity != null) { initSpec.wo_qty = line.quantity; initSpec.straw_quantity = String(line.quantity); initSpec.production_quantity = String(line.quantity) }
      if (line?.unit_of_measure) initSpec.uom = line.unit_of_measure
      const { data, error } = await sb.from('work_orders').insert({
        group_name: g.name,
        form_type: g.form,
        wo_code: code,
        status: 'Queued',
        machine_id: newMachine || null,
        item_part_number: line?.sku ?? null,
        uom: line?.unit_of_measure ?? null,
        qty_ordered: line?.quantity ?? null,
        product_id: line?.product_id ?? null,
        sales_order_id: line?.sales_order_id ?? null,
        order_id: line?.sales_order_id ?? null,
        spec: initSpec,
      }).select('*, sales_orders!work_orders_sales_order_id_fkey(order_number, customers(company_name))').single()
      if (error) { alert('Could not create the work order: ' + error.message); return }
      const wo = data as WO
      setOrders(os => [wo, ...os])
      setCreatingIn(null); setNewMachine(''); setNewSoLine('')
      setDetail(wo)
    } finally { setBusy(false) }
  }

  async function saveSpec() {
    if (!detail) return
    setSaving(true)
    try {
      const form = formFor(detail.group_name, detail.form_type)
      const merged = { ...spec, ...computeAll(form, spec) }
      const patch: Record<string, any> = {
        spec: merged,
        item_part_number: merged.item_part_number ?? null,
        uom: merged.uom ?? null,
        updated_at: new Date().toISOString(),
      }
      if (merged.wo_code) patch.wo_code = String(merged.wo_code)
      const qty = merged.wo_qty ?? merged.bags_needed ?? merged.straws_needed ?? merged.meter_quantity
      if (qty !== undefined && qty !== '' && qty !== null) patch.qty_ordered = Number(qty) || null
      // Link the finished-goods product from the item part number. Without a linked
      // product, completing the work order books nothing into inventory — and a work
      // order raised by hand on a tile has no product on it.
      // "TBD" is not a SKU. There is a real product in the catalogue whose SKU is literally
      // TBD, so a sheet filled in with a placeholder linked itself to it and a completion
      // booked the run into a print plate. A placeholder links nothing.
      if (!detail.product_id && merged.item_part_number && !isPlaceholderPart(merged.item_part_number)) {
        const { data: prod } = await sb.from('products').select('id').ilike('sku', String(merged.item_part_number).trim()).limit(1)
        const pid = (prod?.[0] as any)?.id
        if (pid) patch.product_id = pid
      }
      const { error } = await sb.from('work_orders').update(patch).eq('id', detail.id)
      if (error) { alert('Could not save: ' + error.message); return }
      setOrders(os => os.map(o => (o.id === detail.id ? { ...o, ...patch, spec: merged } as WO : o)))
      setDetail(d => (d ? { ...d, ...patch, spec: merged } as WO : d))
      setSpec(merged)
      setDirty(false)
      // The sheet no longer reloads on every change to `detail`, so when this save is what
      // linked the product, pull the finished-goods figures in explicitly.
      if (patch.product_id) await refreshFG(patch.product_id)
    } finally { setSaving(false) }
  }

  async function patchWO(wo: WO, patch: Record<string, any>) {
    const full = { ...patch, updated_at: new Date().toISOString() }
    setOrders(os => os.map(o => (o.id === wo.id ? { ...o, ...full } as WO : o)))
    setDetail(d => (d && d.id === wo.id ? { ...d, ...full } as WO : d))
    await sb.from('work_orders').update(full).eq('id', wo.id)
  }

  async function deleteWorkOrder(wo: WO) {
    if (!window.confirm(`Delete work order ${wo.wo_code || 'WO-' + wo.wo_number}? This cannot be undone.`)) return
    const { error } = await sb.from('work_orders').delete().eq('id', wo.id)
    if (error) { alert('Could not delete: ' + error.message); return }
    setOrders(os => os.filter(o => o.id !== wo.id))
    setDetail(d => (d && d.id === wo.id ? null : d))
  }

  async function bookFG() {
    if (!detail) return
    if (!detail.product_id) { alert('No finished-goods product is linked to this work order, so there is nothing to book. Put the SKU in Item Part # and save — the product links itself if the SKU is in Inventory.'); return }
    const ordered = Number(detail.qty_ordered || 0)
    const remaining = Math.max(0, ordered - fgBooked)
    const sku = woProduct?.sku || detail.item_part_number || 'this item'
    const input = window.prompt(
      `How many finished ${sku} to add to inventory for ${detail.wo_code || 'WO-' + detail.wo_number}?\n\n`
      + `This work order is for ${fmtN(ordered)}${detail.uom ? ' ' + detail.uom : ''}, and ${fmtN(fgBooked)} has been booked so far.\n`
      + `You only need this to book part of a run before the job is finished — setting the work order to Complete books the rest by itself.`,
      String(remaining || ordered || ''))
    if (input == null) return
    const qty = Number(input)
    if (!qty || qty <= 0) { alert('Enter a quantity greater than zero.'); return }
    // A slip of the keyboard here goes straight onto the shelf, so anything well over the
    // run asks first rather than quietly booking it.
    if (ordered > 0 && qty > ordered * 2) {
      const ok = window.confirm(
        `${fmtN(qty)} is a lot more than this work order's ${fmtN(ordered)}${detail.uom ? ' ' + detail.uom : ''}.\n\n`
        + `Book ${fmtN(qty)} of ${sku} into inventory anyway?`)
      if (!ok) return
    }
    setBooking(true)
    try {
      const { data, error } = await sb.rpc('post_wo_fg', { p_wo_id: detail.id, p_qty: qty, p_user: userEmail || null })
      if (error) { alert('Could not book finished goods: ' + error.message); return }
      const r: any = data
      alert('✓ Booked ' + qty + ' into inventory for ' + (r?.sku || 'item') + '. On-hand is now ' + (r?.on_hand ?? '—') + '.')
      await refreshFG()
      load()
    } finally { setBooking(false) }
  }

  /**
   * Ask the people who decide part numbers to fill this one in. The request is recorded on
   * the work order so the floor can see it has already been asked and does not chase it four
   * times, and so "Ask again" is a deliberate act rather than the only option.
   */
  async function requestPartNumber() {
    if (!detail) return
    const label = detail.wo_code || `WO-${detail.wo_number}`
    const so = detail.sales_orders?.order_number
    const customer = detail.sales_orders?.customers?.company_name
    if (!window.confirm(`Email Shea, Finance, Veejay and Rudy to ask for the part number on ${label}?`)) return
    setRequesting(true)
    try {
      const rows: [string, string][] = [
        ['Work order', label],
        ['Production group', detail.group_name || '—'],
        ['Machine', machineName(detail.machine_id) || 'not assigned'],
        ['Quantity', detail.qty_ordered != null ? `${fmtN(detail.qty_ordered)} ${detail.uom || ''}`.trim() : '—'],
        ['Sales order', so ? `${so}${customer ? ` — ${customer}` : ''}` : '—'],
        ['Scheduled', detail.scheduled_date || 'not scheduled'],
        ['Currently reads', String(detail.item_part_number ?? '').trim() || '(blank)'],
        ['Requested by', userEmail || 'the production floor'],
      ]
      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111">
          <p><strong>${label}</strong> is on the Work Orders board without a part number.</p>
          <p>The job can still run, but nothing goes into inventory when it finishes until a part
             number is on it that matches a SKU on the Inventory board.</p>
          <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;margin:14px 0">
            ${rows.map(([k, v]) => `<tr>
              <td style="border:1px solid #e5e7eb;background:#f9fafb;font-weight:600">${k}</td>
              <td style="border:1px solid #e5e7eb">${v}</td></tr>`).join('')}
          </table>
          <p>Please add the part number and item details on the work order:<br>
             <a href="https://beyondgreen-erp.vercel.app/production/work-orders?item=${detail.id}">Open ${label}</a></p>
          <p style="color:#6b7280;font-size:12px">Sent from the beyondGREEN ERP when the floor pressed “Request a part number”.</p>
        </div>`
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: PART_NUMBER_APPROVERS,
          reply_to: userEmail || undefined,
          subject: `Part number needed — ${label}${so ? ` (SO ${so})` : ''}`,
          html,
        }),
      })
      const out = await res.json().catch(() => ({}))
      if (!res.ok) { alert('Could not send the request: ' + (out?.error || res.statusText)); return }
      const stamp = { at: new Date().toISOString(), by: userEmail || null }
      const merged = { ...spec, part_number_request: stamp }
      await sb.from('work_orders').update({ spec: merged, updated_at: new Date().toISOString() }).eq('id', detail.id)
      setSpec(merged)
      setOrders(os => os.map(o => (o.id === detail.id ? { ...o, spec: merged } as WO : o)))
      setDetail(d => (d ? { ...d, spec: merged } as WO : d))
      alert(`✓ Asked Shea, Finance, Veejay and Rudy for the part number on ${label}.`)
    } finally { setRequesting(false) }
  }

  async function refreshFG(productId?: string) {
    if (!detail) return
    const { data: mv } = await sb.from('inventory_movements')
      .select('created_at,qty,uom,created_by')
      .eq('ref_table', 'work_orders').eq('ref_id', detail.id).eq('movement_type', 'produce').order('created_at')
    setFgMoves((mv as any[]) || [])
    const pid = productId || detail.product_id
    if (pid) {
      const { data: pr } = await sb.from('products').select('sku,product_name,on_hand_qty').eq('id', pid).maybeSingle()
      setWoProduct((pr as any) || null)
    }
  }

  // A status set by mistake should not leave phantom stock on the shelf.
  async function unbookFG() {
    if (!detail) return
    if (!window.confirm(`Take ${fmtN(fgBooked)} back off inventory for ${detail.wo_code || 'WO-' + detail.wo_number}? The booking stays in the ledger with a matching reversal.`)) return
    setBooking(true)
    try {
      const { data, error } = await sb.rpc('wo_unbook_fg', { p_wo_id: detail.id, p_user: userEmail || null })
      if (error) { alert('Could not reverse the booking: ' + error.message); return }
      const r: any = data
      if (r?.ok === false) { alert(r.message); return }
      alert('✓ Reversed ' + r?.reversed + '. On-hand is now ' + (r?.on_hand ?? '—') + '.')
      await refreshFG()
      load()
    } finally { setBooking(false) }
  }

  // ── Form rendering ─────────────────────────────────────────────────────────

  const setField = (key: string, value: any) => { setSpec(s => ({ ...s, [key]: value })); setDirty(true) }

  // FormBody is rendered straight from the sheet below. There is deliberately no wrapper
  // component declared here: one would be a new identity on every render and would remount
  // the whole form beneath it, which is the bug this is fixing.

  // ── Tiles ──────────────────────────────────────────────────────────────────

  function Tile({ g }: { g: GroupDef }) {
    const rows = byGroup.map[g.name] || []
    const running = rows.filter(r => r.status === 'In Progress').length
    const queued = rows.filter(r => r.status === 'Queued').length
    return (
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm flex flex-col overflow-hidden">
        <div className="px-4 pt-4 pb-3 border-b border-gray-100" style={{ borderTop: `3px solid ${g.accent}` }}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="font-semibold text-gray-900 truncate">{g.name}</h2>
              <p className="text-[11px] text-gray-400 mt-0.5">{FORMS[g.form].title} · {FORMS[g.form].docCode}</p>
            </div>
            <button
              onClick={() => { setCreatingIn(g); setNewMachine(''); setNewSoLine('') }}
              className="shrink-0 w-7 h-7 rounded-lg bg-emerald-600 text-white text-lg leading-none hover:bg-emerald-500"
              title={`New work order in ${g.name}`}
            >+</button>
          </div>
          <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-500">
            <span className="inline-flex items-center gap-1"><i className="w-2 h-2 rounded-full inline-block" style={{ background: '#16a34a' }} />{running} in production</span>
            <span className="inline-flex items-center gap-1"><i className="w-2 h-2 rounded-full inline-block" style={{ background: '#dc2626' }} />{queued} in queue</span>
          </div>
        </div>
        <div className="flex-1 p-3 space-y-2 min-h-[150px] max-h-[320px] overflow-y-auto">
          {rows.length === 0 && <p className="text-xs text-gray-300 text-center py-8">No work orders</p>}
          {rows.map(wo => (
            <button
              key={wo.id}
              id={`item-${wo.id}`}
              onClick={() => setDetail(wo)}
              className="w-full text-left rounded-xl border border-gray-100 hover:border-gray-300 hover:shadow-sm transition-all px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <i className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: dotColor(wo.status) }} />
                <span className="font-semibold text-sm text-gray-900 truncate">{wo.wo_code || `WO-${wo.wo_number}`}</span>
                <span className="ml-auto shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-gray-100 text-gray-700">
                  {machineName(wo.machine_id) || 'no machine'}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1 truncate">
                {needsPartNumber(wo)
                  ? <span className="wo-blink font-semibold">◆ Part number needed</span>
                  : wo.item_part_number}
                {wo.qty_ordered != null ? ` · ${fmtN(wo.qty_ordered)} ${wo.uom || ''}` : ''}
              </p>
              <p className="text-[11px] text-gray-400 truncate">
                {STATUS_LABEL[wo.status] ?? wo.status}
                {wo.sales_orders?.order_number ? ` · SO ${wo.sales_orders.order_number}` : ''}
              </p>
              {wo.scheduled_date && (() => {
                const s = toMinutes(wo.scheduled_start)
                const h = runHours(wo as unknown as SchedulableWO)
                const when = s === null ? wo.scheduled_date : `${wo.scheduled_date} · ${fmtClock(s)}${h !== null ? ` → ${fmtClock(Math.round(s + h * 60))}` : ''}`
                return (
                  <p className="text-[11px] text-emerald-700 truncate">
                    🗓 {when}{wo.assigned_operator ? ` · ${wo.assigned_operator}` : ''}
                  </p>
                )
              })()}
            </button>
          ))}
        </div>
      </div>
    )
  }

  const form = detail ? formFor(detail.group_name, detail.form_type) : null
  const detailGroup = detail ? groupByName(detail.group_name) : null
  const partRequest = (spec?.part_number_request ?? null) as { at: string; by: string | null } | null

  return (
    <div className="min-h-screen p-8 bg-gray-50">
      {/* .wo-blink lives in globals.css. The blue blink is reserved for one thing: a job with
          no usable part number on it. It stops when the number matches a SKU in Inventory. */}
      <ExportButton rows={orders} name="Work Orders" />
      <p className="text-xs font-semibold text-emerald-600 uppercase tracking-widest mb-1">PRODUCTION</p>
      <h1 className="text-3xl font-bold text-gray-900 mb-1">Work Orders</h1>
      <p className="text-sm text-gray-500 mb-5">
        One tile per production group. <span className="text-green-600 font-medium">Green</span> is running,
        <span className="text-red-600 font-medium"> red</span> is waiting in queue,
        <span className="text-blue-600 font-medium"> blinking blue</span> is waiting on a part number.
        Open a work order to fill in its sheet.
      </p>

      {/* Waiting for approval — raised by the stock check, nobody has looked at them yet.
          Sits above the group tiles because nothing here has a group until it is approved. */}
      {pendingApproval.length > 0 && (
        <div className="mb-5 rounded-xl border-2 border-violet-300 bg-violet-50 overflow-hidden">
          <div className="px-4 py-2.5 bg-violet-100 border-b border-violet-200 flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-widest text-violet-800">
              Waiting for approval
            </span>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-violet-600 text-white">
              {pendingApproval.length}
            </span>
            <span className="text-[11px] text-violet-700 ml-2">
              raised automatically because the stock was not on the shelf — none of these run until approved
            </span>
          </div>
          <div className="divide-y divide-violet-100">
            {pendingApproval.map(wo => (
              <div key={wo.id} className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 hover:bg-violet-100/40">
                <button onClick={() => setDetail(wo)} className="text-left min-w-[150px]">
                  <span className="font-semibold text-sm text-gray-900">{woLabel(wo)}</span>
                  <span className="block text-[11px] text-gray-500">
                    {wo.sales_orders?.order_number ? `SO ${wo.sales_orders.order_number}` : '—'}
                    {wo.sales_orders?.customers?.company_name ? ` · ${wo.sales_orders.customers.company_name}` : ''}
                  </span>
                </button>
                <div className="min-w-[160px]">
                  <span className="text-sm text-gray-900 font-medium">{wo.item_part_number || '—'}</span>
                  <span className="block text-[11px] text-gray-500">
                    make {fmtN(wo.qty_ordered)} {wo.uom || ''}
                  </span>
                </div>
                <div className="flex-1 min-w-[200px]">
                  <span className="text-[11px] text-gray-600">{wo.auto_reason || ''}</span>
                  {!wo.group_name && (
                    <span className="block text-[11px] font-semibold text-violet-700">
                      Needs a production group before it can be approved
                    </span>
                  )}
                  {wo.group_name && (
                    <span className="block text-[11px] text-violet-700">
                      {wo.group_name}{machineName(wo.machine_id) ? ` · ${machineName(wo.machine_id)}` : ' · no machine yet'}
                      {wo.assigned_operator ? ` · ${wo.assigned_operator}` : ''}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <button onClick={() => setDetail(wo)}
                    className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-50">
                    Open &amp; edit
                  </button>
                  <button onClick={() => rejectWO(wo)}
                    className="px-3 py-1.5 text-xs rounded-lg border border-red-200 text-red-600 font-medium hover:bg-red-50">
                    Reject
                  </button>
                  <button onClick={() => approveWO(wo)}
                    className="px-3 py-1.5 text-xs rounded-lg bg-violet-600 text-white font-semibold hover:bg-violet-500">
                    Approve
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {missingPart.length > 0 && (
        <div className="mb-4 rounded-lg bg-blue-50 border border-blue-300 text-[12px] text-blue-800 px-3 py-2">
          <span className="font-semibold wo-blink">◆ {missingPart.length} work order{missingPart.length > 1 ? 's' : ''} without a part number</span>
          {' '}— these will run, but nothing goes into inventory when they finish until the part number is in and matches a SKU on the Inventory board.
          Open one and use <span className="font-medium">Request a part number</span> if you do not know it.
        </div>
      )}

      {negStock.length > 0 && (
        <div className="mb-4 rounded-lg bg-amber-50 border border-amber-300 text-[12px] text-amber-800 px-3 py-2">
          <span className="font-semibold">⚠ {negStock.length} item{negStock.length > 1 ? 's' : ''} negative on-hand</span> — finished goods shipped but never booked in from production.
          Completing a work order against the SKU books its quantity in and clears this.
          <div className="mt-1 text-amber-700">{negStock.slice(0, 12).map(n => `${n.sku} (${n.on_hand_qty})`).join(', ')}{negStock.length > 12 ? ', …' : ''}</div>
        </div>
      )}

      <div className="flex items-center gap-3 mb-5">
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} className="rounded" />
          Show completed and cancelled
        </label>
        <span className="text-xs text-gray-400">{orders.length} work order{orders.length === 1 ? '' : 's'} on the board</span>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-4">
            {GROUPS.map(g => <Tile key={g.name} g={g} />)}
          </div>

          {byGroup.loose.length > 0 && (
            <div className="mt-6 bg-white rounded-2xl border border-amber-200 p-4">
              <p className="text-sm font-semibold text-amber-700 mb-2">Not in a group ({byGroup.loose.length})</p>
              <p className="text-xs text-gray-500 mb-3">These were raised elsewhere in the ERP — open one and set its group.</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {byGroup.loose.map(wo => (
                  <button key={wo.id} id={`item-${wo.id}`} onClick={() => setDetail(wo)} className="text-left rounded-xl border border-gray-100 hover:border-gray-300 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <i className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: dotColor(wo.status) }} />
                      <span className="font-semibold text-sm">{wo.wo_code || `WO-${wo.wo_number}`}</span>
                    </div>
                    <p className="text-[11px] text-gray-400 truncate">{wo.sales_orders?.order_number ? `SO ${wo.sales_orders.order_number}` : '—'}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* New work order */}
      {creatingIn && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setCreatingIn(null)} />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-lg bg-white rounded-2xl z-50 shadow-2xl p-6">
            <h2 className="font-semibold text-gray-900">New work order</h2>
            <p className="text-xs text-gray-500 mt-0.5">{creatingIn.name} · {FORMS[creatingIn.form].title}</p>

            <label className="block text-xs text-gray-400 mt-5 mb-1">Machine</label>
            <select value={newMachine} onChange={e => setNewMachine(e.target.value)} className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2.5 text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500">
              <option value="">— Assign later —</option>
              {machinesFor(creatingIn).map(m => (
                <option key={m.id} value={m.id}>{m.name}{m.status && m.status !== 'Idle' ? ` (${m.status})` : ''}</option>
              ))}
            </select>

            <label className="block text-xs text-gray-400 mt-4 mb-1">Sales order line (optional)</label>
            <select value={newSoLine} onChange={e => setNewSoLine(e.target.value)} className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2.5 text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500">
              <option value="">— Not tied to an order —</option>
              {soLines.map(l => (
                <option key={l.id} value={l.id}>
                  {l.order_number} · {l.sku || l.description || 'line'} · {l.quantity ?? ''} {l.unit_of_measure || ''}{l.customer ? ' — ' + l.customer : ''}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-gray-400 mt-1.5">Picking a line fills in the part number, quantity and UOM, and links the work order to that order.</p>

            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setCreatingIn(null)} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={createWorkOrder} disabled={busy} className="px-4 py-2 text-sm rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-500 disabled:opacity-50">
                {busy ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Work order sheet */}
      {detail && form && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setDetail(null)} />
          <div className="fixed inset-y-0 right-0 w-full md:w-[640px] bg-white z-50 shadow-2xl flex flex-col">
            <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 shrink-0" style={{ borderTop: `4px solid ${detailGroup?.accent ?? '#10b981'}` }}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <i className="w-2.5 h-2.5 rounded-full" style={{ background: dotColor(detail.status) }} />
                  <h2 className="text-gray-900 font-semibold truncate">{detail.wo_code || `WO-${detail.wo_number}`}</h2>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{form.title} · {form.docCode}</p>
                <p className="text-xs text-gray-400">
                  {detail.group_name || 'no group'}
                  {detail.sales_orders?.order_number ? ` · SO ${detail.sales_orders.order_number}` : ''}
                  {detail.sales_orders?.customers?.company_name ? ` · ${detail.sales_orders.customers.company_name}` : ''}
                </p>
              </div>
              <button onClick={() => setDetail(null)} className="text-gray-500 hover:text-gray-700 p-1 rounded-lg hover:bg-gray-50">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              {/* Raised by the stock check and not yet approved. */}
              {detail.approval_state === 'pending' && (
                <div className="rounded-lg bg-violet-50 border-2 border-violet-300 px-3 py-3">
                  <p className="text-[13px] font-semibold text-violet-900">⏸ Waiting for approval</p>
                  <p className="text-[12px] text-violet-900 mt-1">
                    {detail.auto_reason || 'Raised automatically from a stock shortage.'}
                  </p>
                  <p className="text-[12px] text-violet-900 mt-1">
                    Set the production group, machine and operator below, then approve. It will not appear
                    on a group tile or run until you do.
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <button onClick={() => approveWO(detail)}
                      className="px-3 py-2 text-sm rounded-lg bg-violet-600 text-white font-semibold hover:bg-violet-500">
                      Approve this work order
                    </button>
                    <button onClick={() => rejectWO(detail)}
                      className="px-3 py-2 text-sm rounded-lg border border-red-200 text-red-600 font-medium hover:bg-red-50">
                      Reject
                    </button>
                  </div>
                </div>
              )}
              {detail.approval_state === 'approved' && detail.approved_by && (
                <p className="text-[11px] text-gray-400">
                  ✓ Approved {detail.approved_at ? new Date(detail.approved_at).toLocaleString() : ''} by {detail.approved_by}
                </p>
              )}

              {/* Waiting on a part number. The job is not blocked — it says so and offers to ask. */}
              {needsPartNumber(detail) && (
                <div className="rounded-lg bg-blue-50 border border-blue-300 px-3 py-3">
                  <p className="text-[13px] font-semibold wo-blink">◆ This work order has no part number</p>
                  <p className="text-[12px] text-blue-900 mt-1">
                    It can still be run and completed, but nothing will go into inventory when it finishes.
                    Put the SKU in <span className="font-medium">Item Part #</span> below and save — this clears
                    once it matches a SKU on the Inventory board.
                  </p>
                  {partRequest ? (
                    <p className="text-[12px] text-blue-800 mt-2">
                      ✓ Requested {new Date(partRequest.at).toLocaleString()}
                      {partRequest.by ? ` by ${partRequest.by}` : ''} — Shea, Finance, Veejay and Rudy have been asked.
                      <button onClick={requestPartNumber} disabled={requesting} className="ml-2 underline hover:no-underline disabled:opacity-50">
                        {requesting ? 'Sending…' : 'Ask again'}
                      </button>
                    </p>
                  ) : (
                    <button
                      onClick={requestPartNumber}
                      disabled={requesting}
                      className="mt-2 px-3 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-500 disabled:opacity-50"
                    >{requesting ? 'Sending…' : 'Request a part number'}</button>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Status</label>
                  <select value={(STATUS_OPTIONS as readonly string[]).includes(detail.status) ? detail.status : ''} onChange={e => setStatus(detail, e.target.value)} className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500">
                    {!(STATUS_OPTIONS as readonly string[]).includes(detail.status) && <option value="">{detail.status || '—'}</option>}
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABEL[s] ?? s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Machine</label>
                  <select value={detail.machine_id ?? ''} onChange={e => setMachineOn(detail, e.target.value)} className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500">
                    <option value="">— Not assigned —</option>
                    {(detailGroup ? machinesFor(detailGroup) : machines).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Group</label>
                  <select
                    value={detail.group_name ?? ''}
                    onChange={async e => {
                      const gname = e.target.value
                      const g = groupByName(gname)
                      const patch = { group_name: gname || null, form_type: g?.form ?? null, updated_at: new Date().toISOString() }
                      setOrders(os => os.map(o => (o.id === detail.id ? { ...o, ...patch } as WO : o)))
                      setDetail(d => (d ? { ...d, ...patch } as WO : d))
                      await sb.from('work_orders').update(patch).eq('id', detail.id)
                    }}
                    className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">— None —</option>
                    {GROUPS.map(g => <option key={g.name} value={g.name}>{g.name}</option>)}
                  </select>
                </div>
              </div>
              <p className="text-[11px] text-gray-400 -mt-3">
                Setting a work order to In Production marks its machine Running on Machine Status; closing it sets the machine back to Idle.
              </p>

              {/* Scheduling — what puts this job on the Daily Production Plan */}
              <div className="border-t border-gray-100 pt-4">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-2">Scheduling</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="flex items-center justify-between text-xs text-gray-400 mb-1">
                      <span>Production day</span>
                      <button
                        type="button"
                        onClick={() => patchWO(detail, { scheduled_date: tomorrowISO() })}
                        className="text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5 hover:bg-emerald-100 font-medium"
                      >Set to tomorrow</button>
                    </label>
                    <input
                      type="date"
                      value={detail.scheduled_date ?? ''}
                      onChange={e => patchWO(detail, { scheduled_date: e.target.value || null })}
                      className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Start time</label>
                    <input
                      type="time"
                      value={(detail.scheduled_start ?? '').slice(0, 5)}
                      onChange={e => patchWO(detail, { scheduled_start: e.target.value || null })}
                      className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Operator</label>
                    <select
                      value={detail.assigned_operator ?? ''}
                      onChange={e => patchWO(detail, { assigned_operator: e.target.value || null })}
                      className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="">— Not assigned —</option>
                      <optgroup label="Manufacturing & floor">
                        {employees.filter(e => !e.department || e.department === 'Manufacturing' || e.department === 'Warehouse Operations').map(e => (
                          <option key={e.id} value={e.name}>{e.name}</option>
                        ))}
                      </optgroup>
                      <optgroup label="Everyone else">
                        {employees.filter(e => e.department && e.department !== 'Manufacturing' && e.department !== 'Warehouse Operations').map(e => (
                          <option key={e.id} value={e.name}>{e.name}</option>
                        ))}
                      </optgroup>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Run hours</label>
                    {hoursAreCalculated(detail as unknown as SchedulableWO) ? (
                      <div className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 font-medium">
                        {Number(detail.spec?.calc_production_hours).toFixed(2)}
                      </div>
                    ) : (
                      /* Held as text while it is being typed and written once on the way out.
                         Saving per keystroke put the value back through Number(), so "0." came
                         back as 0 and the decimal point was swallowed — 0.42 ended up as .42.
                         It is a text box rather than type=number for the same reason: a number
                         input reports a half-typed "0." as an empty string, so a controlled one
                         wipes the decimal point the moment you type it. */
                      <input
                        type="text"
                        inputMode="decimal"
                        value={hoursDraft}
                        onChange={e => setHoursDraft(e.target.value.replace(/[^0-9.]/g, ''))}
                        onBlur={() => {
                          const v = hoursDraft.trim() === '' ? null : Number(hoursDraft)
                          if (v !== null && !isFinite(v)) { setHoursDraft(detail.scheduled_hours == null ? '' : String(detail.scheduled_hours)); return }
                          if (v !== (detail.scheduled_hours ?? null)) patchWO(detail, { scheduled_hours: v })
                        }}
                        className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    )}
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs text-gray-400 mb-1">Runs</label>
                    <div className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700">
                      {(() => {
                        const s = toMinutes(detail.scheduled_start)
                        const h = runHours(detail as unknown as SchedulableWO)
                        if (s === null) return 'Set a start time to place this job on the plan'
                        if (h === null) return `${fmtClock(s)} — finish unknown until run hours are known`
                        return `${fmtClock(s)} → ${fmtClock(Math.round(s + h * 60))}`
                      })()}
                    </div>
                  </div>
                </div>

                <p className="text-[11px] text-gray-400 mt-2">
                  {hoursAreCalculated(detail as unknown as SchedulableWO)
                    ? 'Run hours come from this sheet’s production calculator, so changing the quantity moves the finish time and everything queued behind it.'
                    : 'This sheet has no production calculator, so enter the run hours by hand.'}
                  {' '}A work order with a production day appears on the Daily Production Plan for that day.
                </p>

                {detail.scheduled_date && detail.machine_id && (() => {
                  const sameMachine = orders.filter(o => o.machine_id === detail.machine_id && o.scheduled_date === detail.scheduled_date)
                  const queue = buildMachineQueue(sameMachine as unknown as SchedulableWO[])
                  const me = queue.findIndex(j => j.wo.id === detail.id)
                  const next = me >= 0 ? queue[me].next : undefined
                  const mName = machineName(detail.machine_id)
                  return (
                    <div className="mt-3 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
                      <p className="text-[11px] text-gray-500">
                        {mName} on {detail.scheduled_date} — {queue.length} job{queue.length === 1 ? '' : 's'} queued.
                      </p>
                      {next ? (
                        <p className="text-xs text-gray-700 mt-1">
                          Next on this machine: <span className="font-semibold">{woLabel(next.wo)}</span>
                          {next.wo.item_part_number ? ` · ${next.wo.item_part_number}` : ''} at {fmtClock(next.startMins)}
                          {next.overlapsPrevious && <span className="text-red-600"> — starts before this job finishes</span>}
                        </p>
                      ) : (
                        <p className="text-xs text-gray-500 mt-1">Nothing queued behind this job.</p>
                      )}
                    </div>
                  )
                })()}
              </div>

              {form.docCode === 'awaiting printed form' && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 text-[12px] text-amber-800 px-3 py-2">
                  No printed sheet has been supplied for this group yet, so this is the short form. Send the paper form and it will be built out field for field.
                </div>
              )}

              <FormBody form={form} live={spec} onChange={setField} />

              <div className="border-t border-gray-100 pt-4">
                <label className="block text-xs text-gray-400 mb-2">Production Steps &amp; Actual Run Time</label>
                <RunEntry workOrderId={detail.id} productId={detail.product_id} userEmail={userEmail} />
              </div>

              <div className="border-t border-gray-100 pt-4">
                <label className="block text-xs text-gray-400 mb-1.5">Finished Goods → Inventory</label>
                {detail.product_id ? (
                  <div className="text-sm text-gray-700 space-y-1">
                    <p className="text-[11px] text-gray-500 pb-1">
                      What this run adds to the Inventory board when it is finished.
                    </p>
                    <p><span className="font-mono text-emerald-700">{woProduct?.sku ?? '—'}</span>{woProduct?.product_name ? ' · ' + woProduct.product_name : ''}</p>
                    <p className="text-xs text-gray-500">
                      <span title="What this work order is for">Ordered {fmtN(detail.qty_ordered)}</span>
                      {' · '}<span title="How much of it has gone into inventory so far">Booked {fmtN(fgBooked)}</span>
                      {' · '}<span title="Total stock of this SKU on the Inventory board">On hand {fmtN(woProduct?.on_hand_qty)}</span>
                    </p>
                    {fgMoves.length > 0 && (
                      <ul className="text-xs text-gray-500 mt-1 space-y-0.5">
                        {fgMoves.map((m, i) => (
                          <li key={i}>{Number(m.qty) < 0 ? '−' : '+'}{fmtN(Math.abs(Number(m.qty)))} {m.uom || ''} · {new Date(m.created_at).toLocaleDateString()}{m.created_by ? ' · ' + (m.created_by === 'auto' ? 'automatic' : m.created_by) : ''}</li>
                        ))}
                      </ul>
                    )}
                    <p className="text-[11px] text-gray-400 pt-1">
                      You normally do not touch these buttons. Setting the work order to Complete adds the run to inventory by itself.
                      Use <span className="font-medium">Add part of this run</span> only to put some of it on the shelf before the job is finished — say the machine has made half the order and you want that half counted now.
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <button onClick={bookFG} disabled={booking} className="px-3 py-2 text-sm rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-500 disabled:opacity-50">{booking ? 'Working…' : 'Add part of this run'}</button>
                      {fgBooked > 0 && (
                        <button onClick={unbookFG} disabled={booking} className="px-3 py-2 text-sm rounded-lg border border-red-200 text-red-600 font-medium hover:bg-red-50 disabled:opacity-50">Undo booking</button>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-amber-600">
                    No finished-goods product is linked, so completing this work order will not move stock.
                    Put the SKU in <span className="font-medium">Item Part #</span> and save — if that SKU is on the Inventory board it links itself.
                  </p>
                )}
              </div>

              <div className="border-t border-gray-100 pt-4">
                <FileUpload supabase={sb} recordType="work_order" recordId={detail.id} currentUserEmail={userEmail} />
              </div>

              <div className="border-t border-gray-100 pt-4">
                <Comments recordId={detail.sales_order_id ?? detail.id} recordType={detail.sales_order_id ? 'sales_order' : 'work_order'} currentUserEmail={userEmail} title="Notes & Comments" />
              </div>
            </div>

            <div className="border-t border-gray-100 px-6 py-3 flex items-center justify-between shrink-0">
              <button onClick={() => deleteWorkOrder(detail)} className="text-sm text-red-600 hover:text-red-700">Delete</button>
              <div className="flex items-center gap-2">
                {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
                <button onClick={saveSpec} disabled={saving || !dirty} className="px-4 py-2 text-sm rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-500 disabled:opacity-40">
                  {saving ? 'Saving…' : 'Save work order'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
