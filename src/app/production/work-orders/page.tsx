'use client'
import { useEffect, useState, useCallback } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import OrdersMirror from '@/components/OrdersMirror'
import Comments from '@/components/Comments'
import FileUpload from '@/components/FileUpload'
import { useItemDeepLink } from '@/components/useItemDeepLink'
import { checkOrderReadyToShip } from '@/lib/orderFlow'
import ExportButton from '@/components/ExportButton'
import RunEntry from '@/components/RunEntry'

const sb = createSupabaseBrowserClient()

const STATUS_OPTIONS = ['Queued', 'In Progress', 'QC', 'QC Passed', 'Complete', 'On Hold', 'Cancelled'] as const
const DONE_STATUSES = ['QC Passed', 'Complete']
const IDLE_AFTER = ['QC Passed', 'Complete', 'Cancelled', 'On Hold']

interface Machine { id: string; name: string; machine_code: string; status: string; equipment_group: string | null }

interface WO {
  id: string
  wo_number: string | number
  sales_order_id: string | null
  machine_id: string | null
  status: string
  notes: string | null
  created_at: string
  product_id?: string | null
  item_part_number?: string | null
  qty_required?: number | null
  qty_ordered?: number | null
  assigned_operator?: string | null
  assigned_machine?: string | null
  scheduled_date?: string | null
  auto_reason?: string | null
  sales_orders?: { order_number: string; customers?: { company_name: string } } | null
}

function statusClass(status: string) {
  if (DONE_STATUSES.includes(status)) return 'bg-green-100 text-green-700'
  if (status === 'In Progress') return 'bg-blue-100 text-blue-700'
  if (status === 'QC') return 'bg-purple-100 text-purple-700'
  if (status === 'On Hold') return 'bg-amber-100 text-amber-700'
  if (status === 'Cancelled') return 'bg-gray-200 text-gray-600'
  return 'bg-yellow-100 text-yellow-700'
}

export default function WorkOrdersPage() {
  const [orders, setOrders] = useState<WO[]>([])
  const [loading, setLoading] = useState(true)
  const [userEmail, setUserEmail] = useState('')
  const [detail, setDetail] = useState<WO | null>(null)
  const [woProduct, setWoProduct] = useState<{ sku: string; product_name: string | null; on_hand_qty: number | null; unit_of_measure: string | null } | null>(null)
  const [fgMoves, setFgMoves] = useState<{ created_at: string; qty: number; uom: string | null; created_by: string | null }[]>([])
  const [booking, setBooking] = useState(false)
  const [negStock, setNegStock] = useState<{ sku: string; product_name: string | null; on_hand_qty: number | null }[]>([])
  const [machines, setMachines] = useState<Machine[]>([])
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([])
  const [sched, setSched] = useState<Record<string, { machineId: string; operator: string; date: string }>>({})
  const [bom, setBom] = useState<{ component_sku: string; product_name: string | null; on_hand_qty: number | null; uom: string | null; lot: string | null }[]>([])
  const fmtN = (n: any) => (n === null || n === undefined || n === '') ? '\u2014' : Number(n).toLocaleString()
  const fgBooked = fgMoves.reduce((s, m) => s + Number(m.qty || 0), 0)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await sb
      .from('work_orders')
      .select('*, sales_orders!work_orders_sales_order_id_fkey(order_number, customers(company_name))')
      .order('created_at', { ascending: false })
    setOrders((data as WO[]) || [])
    const { data: neg } = await sb.from('products').select('sku,product_name,on_hand_qty').lt('on_hand_qty', 0).order('on_hand_qty', { ascending: true }).limit(50)
    setNegStock((neg as any[]) || [])
    const { data: mach } = await sb.from('machines').select('id,name,machine_code,status,equipment_group').eq('is_active', true).order('equipment_group').order('name')
    setMachines((mach as Machine[]) || [])
    const { data: emp } = await sb.from('employees').select('id,name').order('name')
    setEmployees((emp as { id: string; name: string }[]) || [])
    setLoading(false)
    sb.auth.getUser().then(({ data: u }) => { if (u.user?.email) setUserEmail(u.user.email) })
  }, [])

  useEffect(() => { load() }, [load])

  // Load the linked finished-goods product + any FG already booked from this work order.
  useEffect(() => {
    if (!detail) { setWoProduct(null); setFgMoves([]); setBom([]); return }
    const pid = (detail as any).product_id as string | null
    ;(async () => {
      let sku: string | null = null
      if (pid) {
        const { data: pr } = await sb.from('products').select('sku,product_name,on_hand_qty,unit_of_measure').eq('id', pid).maybeSingle()
        setWoProduct((pr as any) || null)
        sku = (pr as any)?.sku ?? null
      } else setWoProduct(null)
      const { data: mv } = await sb.from('inventory_movements').select('created_at,qty,uom,created_by,lot_number').eq('ref_table', 'work_orders').eq('ref_id', detail.id).eq('movement_type', 'produce').order('created_at')
      setFgMoves((mv as any[]) || [])
      // Pull the BOM components live from the material inventory board (on-hand + latest lot).
      if (sku) {
        const { data: brows } = await sb.from('product_bom').select('component_sku').eq('finished_good_sku', sku)
        const comps = Array.from(new Set(((brows as any[]) || []).map(b => (b.component_sku || '').trim().toUpperCase()).filter(Boolean)))
        const out: { component_sku: string; product_name: string | null; on_hand_qty: number | null; uom: string | null; lot: string | null }[] = []
        for (const cs of comps) {
          const { data: cp } = await sb.from('products').select('product_name,on_hand_qty,unit_of_measure').eq('sku', cs).maybeSingle()
          const { data: lot } = await sb.from('inventory_movements').select('lot_number').eq('sku', cs).not('lot_number', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle()
          out.push({ component_sku: cs, product_name: (cp as any)?.product_name ?? null, on_hand_qty: (cp as any)?.on_hand_qty ?? null, uom: (cp as any)?.unit_of_measure ?? null, lot: (lot as any)?.lot_number ?? null })
        }
        setBom(out)
      } else setBom([])
    })()
  }, [detail])

  // Confirm + schedule a work order: assign machine/operator/date, then drop it onto the Daily Plan.
  async function confirmSchedule(wo: WO) {
    const cur = sched[wo.id] || { machineId: wo.machine_id || '', operator: wo.assigned_operator || '', date: wo.scheduled_date || '' }
    if (!cur.machineId || !cur.operator || !cur.date) { alert('Pick a machine, an operator, and a date to schedule this work order.'); return }
    const machine = machines.find(m => m.id === cur.machineId)
    await sb.from('work_orders').update({
      status: 'Queued',
      machine_id: cur.machineId,
      assigned_machine: machine?.name ?? null,
      assigned_operator: cur.operator,
      scheduled_date: cur.date,
      approval_state: 'approved',
      approved_by: userEmail || null,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', wo.id)
    // Daily Plan linkage (Phase 5): ensure a plan for that date, then add a linked line.
    try {
      let planId: string | null = null
      const { data: plan } = await sb.from('production_day_plans').select('id').eq('plan_date', cur.date).maybeSingle()
      if (plan) planId = (plan as any).id
      else {
        const token = Math.random().toString(36).slice(2, 10)
        const { data: np } = await sb.from('production_day_plans').insert({ plan_date: cur.date, share_token: token, title: `Production Plan ${cur.date}`, status: 'active', created_by: userEmail || 'system' }).select('id').single()
        planId = (np as any)?.id ?? null
      }
      if (planId) {
        await sb.from('production_plan_lines').insert({
          plan_id: planId,
          work_order_id: wo.id,
          product_id: wo.product_id ?? null,
          machine_code: machine?.machine_code ?? machine?.name ?? '',
          product: wo.item_part_number ?? (wo.notes ?? '').slice(0, 40),
          operator: cur.operator,
          status: 'Scheduled',
          sort_order: 0,
        })
      }
    } catch (e) { console.error('daily plan link error', e) }
    load()
  }

  const openDetail = useCallback((wo: WO) => setDetail(wo), [])
  useItemDeepLink(orders, openDetail)

  // Ultron: clicking a production order opens (creating if needed) its work-order record in place.
  const openForOrder = useCallback(async (soId: string) => {
    let wo = orders.find(o => o.sales_order_id === soId)
    if (!wo) {
      const { data } = await sb
        .from('work_orders')
        .insert({ sales_order_id: soId, order_id: soId, status: 'Queued' })
        .select('*, sales_orders!work_orders_sales_order_id_fkey(order_number, customers(company_name))')
        .single()
      if (data) { wo = data as WO; setOrders(os => [wo as WO, ...os]) }
    }
    if (wo) setDetail(wo)
  }, [orders])

  // Ultron: the work order records which machine runs it.
  async function setMachine(wo: WO, machineId: string) {
    const mid = machineId || null
    setOrders(os => os.map(o => (o.id === wo.id ? { ...o, machine_id: mid } : o)))
    setDetail(d => (d && d.id === wo.id ? { ...d, machine_id: mid } : d))
    await sb.from('work_orders').update({ machine_id: mid, updated_at: new Date().toISOString() }).eq('id', wo.id)
    // A machine picked up mid-run should show as running straight away.
    if (mid && wo.status === 'In Progress') {
      await sb.from('machines').update({ status: 'Running', updated_at: new Date().toISOString() }).eq('id', mid)
      setMachines(ms => ms.map(m => (m.id === mid ? { ...m, status: 'Running' } : m)))
    }
  }

  async function setStatus(wo: WO, status: string) {
    if (!status || status === wo.status) return
    setOrders(os => os.map(o => (o.id === wo.id ? { ...o, status } : o)))
    setDetail(d => (d && d.id === wo.id ? { ...d, status } : d))
    await sb.from('work_orders').update({ status, updated_at: new Date().toISOString() }).eq('id', wo.id)
    // Ultron: keep the linked Sales Order in step — advance it when the work order is done.
    if (DONE_STATUSES.includes(status) && wo.sales_order_id) {
      try { await checkOrderReadyToShip(wo.sales_order_id) } catch { /* non-blocking */ }
    }
    // Ultron: and keep Machine Status honest — a machine is Running only while its work order is.
    const mid = wo.machine_id
    if (mid) {
      const ms = status === 'In Progress' ? 'Running' : IDLE_AFTER.includes(status) ? 'Idle' : null
      if (ms) {
        await sb.from('machines').update({ status: ms, updated_at: new Date().toISOString() }).eq('id', mid)
        setMachines(list => list.map(m => (m.id === mid ? { ...m, status: ms } : m)))
      }
    }
  }

  // Explicit “Close & Book FG” — books produced finished goods into inventory with a ledger entry (idempotent per booking).
  async function bookFG() {
    if (!detail) return
    const pid = (detail as any).product_id
    if (!pid) { alert('No finished-goods product is linked to this work order, so there is nothing to book. Link a product on the order first.'); return }
    const remaining = Math.max(0, Number((detail as any).qty_ordered || 0) - fgBooked)
    const suggested = remaining || Number((detail as any).qty_ordered || 0) || ''
    const input = window.prompt('Quantity of finished goods to book into inventory for WO-' + detail.wo_number + ':', String(suggested))
    if (input == null) return
    const qty = Number(input)
    if (!qty || qty <= 0) { alert('Enter a quantity greater than zero.'); return }
    setBooking(true)
    try {
      const { data, error } = await sb.rpc('post_wo_fg', { p_wo_id: detail.id, p_qty: qty, p_user: userEmail || null })
      if (error) { alert('Could not book finished goods: ' + error.message); return }
      const r: any = data
      alert('\u2713 Booked ' + qty + ' into inventory for ' + (r?.sku || 'item') + '. On-hand is now ' + (r?.on_hand ?? '\u2014') + '.')
      const { data: pr } = await sb.from('products').select('sku,product_name,on_hand_qty,unit_of_measure').eq('id', pid).maybeSingle()
      setWoProduct((pr as any) || null)
      const { data: mv } = await sb.from('inventory_movements').select('created_at,qty,uom,created_by').eq('ref_table', 'work_orders').eq('ref_id', detail.id).eq('movement_type', 'produce').order('created_at')
      setFgMoves((mv as any[]) || [])
      load()
    } catch (e: any) { alert('Could not book finished goods: ' + (e?.message || e)) }
    finally { setBooking(false) }
  }

  const awaiting = orders.filter(o => o.status === 'Awaiting Scheduling')
  const q = orders.filter(o => o.status === 'Queued')
  const ip = orders.filter(o => ['In Progress', 'QC', 'On Hold'].includes(o.status))
  const done = orders.filter(o => DONE_STATUSES.includes(o.status))

  const StatusSelect = ({ wo, full }: { wo: WO; full?: boolean }) => {
    const known = (STATUS_OPTIONS as readonly string[]).includes(wo.status)
    return (
      <select
        value={known ? wo.status : ''}
        onChange={e => setStatus(wo, e.target.value)}
        onClick={e => e.stopPropagation()}
        className={`${full ? 'w-full px-3 py-2' : 'px-2 py-1.5'} text-sm border border-gray-200 rounded-lg bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500`}
      >
        {!known && <option value="">{wo.status || '—'}</option>}
        {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
    )
  }

  return (
    <div className="min-h-screen p-8 bg-gray-50">
      <ExportButton rows={orders} name="Work Orders" />
      <p className="text-xs font-semibold text-emerald-600 uppercase tracking-widest mb-1">PRODUCTION</p>
      <h1 className="text-3xl font-bold text-gray-900 mb-4">Work Orders</h1>

      <div className="mb-4 rounded-lg bg-[#10B981]/10 border border-[#10B981]/25 text-[12px] text-[#0f7a5a] px-3 py-2">🔗 Ultron — status is editable inline and on each record; notes &amp; comments sync two-way with the Sales / Production boards.</div>

      {negStock.length > 0 && (
        <div className="mb-4 rounded-lg bg-amber-50 border border-amber-300 text-[12px] text-amber-800 px-3 py-2">
          <span className="font-semibold">⚠ {negStock.length} item{negStock.length > 1 ? 's' : ''} negative on-hand</span> — finished goods likely shipped but never booked from production. Open the item’s work order and use “Close &amp; Book FG” to correct it.
          <div className="mt-1 text-amber-700">{negStock.slice(0, 12).map(n => `${n.sku} (${n.on_hand_qty})`).join(', ')}{negStock.length > 12 ? ', …' : ''}</div>
        </div>
      )}

      {/* Sales orders currently in production (mirrored from Sales Orders) */}
      <OrdersMirror statuses={['Production Queue', 'In Production']} title="Sales Orders in Production" tagClass="t-orange" emoji="🏭" onRowClick={openForOrder} />

      {awaiting.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-bold text-gray-900 mb-1">⏳ Waiting Confirmation &amp; Scheduling <span className="text-sm font-medium text-amber-600">({awaiting.length})</span></h2>
          <p className="text-xs text-gray-500 mb-3">Auto-created from sales-order stock shortages. Assign a machine, an operator, and a date to confirm &amp; schedule — it then drops onto the Daily Plan.</p>
          <div className="space-y-3">
            {awaiting.map(wo => {
              const cur = sched[wo.id] || { machineId: wo.machine_id || '', operator: wo.assigned_operator || '', date: wo.scheduled_date || '' }
              const setS = (patch: Partial<{ machineId: string; operator: string; date: string }>) => setSched(prev => ({ ...prev, [wo.id]: { ...cur, ...patch } }))
              return (
                <div key={wo.id} id={`item-${wo.id}`} className="bg-amber-50/60 rounded-xl border border-amber-200 p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="min-w-0 cursor-pointer" onClick={() => openDetail(wo)}>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-900">WO-{wo.wo_number}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">Awaiting Scheduling</span>
                      </div>
                      <p className="text-sm text-gray-600 mt-0.5">{wo.item_part_number ?? '—'} · qty {fmtN(wo.qty_required ?? wo.qty_ordered)} · SO {wo.sales_orders?.order_number ?? '—'} · {wo.sales_orders?.customers?.company_name ?? '—'}</p>
                      {wo.auto_reason && <p className="text-[11px] text-amber-700 mt-0.5">{wo.auto_reason}</p>}
                    </div>
                    <button onClick={() => openDetail(wo)} className="px-3 py-1.5 text-sm border border-amber-200 rounded-lg hover:bg-amber-100 shrink-0">View</button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
                    <div>
                      <label className="block text-[11px] text-gray-500 mb-1">Machine</label>
                      <select value={cur.machineId} onChange={e => setS({ machineId: e.target.value })} className="w-full text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white">
                        <option value="">— machine —</option>
                        {Array.from(new Set(machines.map(m => m.equipment_group ?? 'Other'))).map(g => (
                          <optgroup key={g} label={g}>{machines.filter(m => (m.equipment_group ?? 'Other') === g).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] text-gray-500 mb-1">Operator</label>
                      <select value={cur.operator} onChange={e => setS({ operator: e.target.value })} className="w-full text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white">
                        <option value="">— operator —</option>
                        {employees.map(em => <option key={em.id} value={em.name}>{em.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] text-gray-500 mb-1">Date</label>
                      <input type="date" value={cur.date} onChange={e => setS({ date: e.target.value })} className="w-full text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white" />
                    </div>
                    <button onClick={() => confirmSchedule(wo)} className="px-3 py-2 text-sm rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-500">Confirm &amp; Schedule</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Queued', count: q.length, cls: 'bg-yellow-50 border-yellow-200 text-yellow-700' },
          { label: 'In Progress / QC', count: ip.length, cls: 'bg-blue-50 border-blue-200 text-blue-700' },
          { label: 'Done', count: done.length, cls: 'bg-green-50 border-green-200 text-green-700' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl border p-5 ${s.cls}`}>
            <p className="text-sm font-medium">{s.label}</p>
            <p className="text-3xl font-bold mt-1">{s.count}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">Loading...</div>
      ) : (
        <div className="space-y-3">
          {orders.filter(o => o.status !== 'Awaiting Scheduling').map(wo => (
            <div key={wo.id} id={`item-${wo.id}`} onClick={() => openDetail(wo)} className="bg-white rounded-xl border border-gray-100 p-5 flex items-center justify-between shadow-sm hover:border-gray-200 hover:shadow transition-all cursor-pointer">
              <div className="min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <span className="font-bold text-gray-900">WO-{wo.wo_number}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusClass(wo.status)}`}>{wo.status}</span>
                </div>
                <p className="text-sm text-gray-500">SO: {wo.sales_orders?.order_number ?? '—'} &middot; {wo.sales_orders?.customers?.company_name ?? '—'}</p>
                <p className="text-xs text-gray-400 mt-0.5">Machine: {machines.find(m => m.id === wo.machine_id)?.name ?? <span className="text-amber-600">not assigned</span>}</p>
                {wo.notes && <p className="text-xs text-gray-400 mt-1 truncate max-w-2xl">{wo.notes}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                <StatusSelect wo={wo} />
                <button onClick={() => openDetail(wo)} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">View</button>
              </div>
            </div>
          ))}
          {orders.length === 0 && <div className="text-center py-20 text-gray-400">No work orders yet.</div>}
        </div>
      )}

      {/* Detail record (Ultron) */}
      {detail && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setDetail(null)} />
          <div className="fixed inset-y-0 right-0 w-full md:w-[560px] bg-white z-50 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 shrink-0">
              <div>
                <h2 className="text-gray-900 font-semibold">WO-{detail.wo_number}</h2>
                <p className="text-xs text-gray-500 mt-0.5">SO: {detail.sales_orders?.order_number ?? '—'} · {detail.sales_orders?.customers?.company_name ?? '—'}</p>
              </div>
              <button onClick={() => setDetail(null)} className="text-gray-500 hover:text-gray-700 p-1 rounded-lg hover:bg-gray-50">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Status</label>
                <StatusSelect wo={detail} full />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Machine</label>
                <select
                  value={detail.machine_id ?? ''}
                  onChange={e => setMachine(detail, e.target.value)}
                  className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2.5 text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">— Not assigned —</option>
                  {Array.from(new Set(machines.map(m => m.equipment_group ?? 'Other'))).map(g => (
                    <optgroup key={g} label={g}>
                      {machines.filter(m => (m.equipment_group ?? 'Other') === g).map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <p className="text-[11px] text-gray-400 mt-1.5">
                  Setting this work order to In Progress marks the machine Running on Machine Status; closing it sets the machine back to Idle.
                </p>
              </div>
              <div className="border-t border-gray-100 pt-4">
                <label className="block text-xs text-gray-400 mb-2">Production Steps &amp; Actual Run Time</label>
                <RunEntry workOrderId={detail.id} productId={(detail as any).product_id} userEmail={userEmail} />
                <p className="text-[11px] text-gray-400 mt-2">
                  Run time is captured from the status buttons above. If a job was not clocked at the
                  time, enter the actual hours by hand — typed hours win, and the rate is learned either way.
                </p>
              </div>
              {detail.notes && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Work Order Notes</label>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg p-3">{detail.notes}</p>
                </div>
              )}
              <div className="border-t border-gray-100 pt-4">
                <label className="block text-xs text-gray-400 mb-1.5">Finished Goods → Inventory</label>
                {(detail as any).product_id ? (
                  <div className="text-sm text-gray-700 space-y-1">
                    <p><span className="font-mono text-emerald-700">{woProduct?.sku ?? '\u2014'}</span>{woProduct?.product_name ? ' \u00b7 ' + woProduct.product_name : ''}</p>
                    <p className="text-xs text-gray-500">Ordered {fmtN((detail as any).qty_ordered)} · Booked to inventory {fmtN(fgBooked)} · On hand {fmtN(woProduct?.on_hand_qty)}</p>
                    {fgMoves.length > 0 && (
                      <ul className="text-xs text-gray-500 mt-1 space-y-0.5">
                        {fgMoves.map((m, i) => (<li key={i}>+{fmtN(m.qty)} {m.uom || ''} · {new Date(m.created_at).toLocaleDateString()}{(m as any).lot_number ? ' · Lot ' + (m as any).lot_number : ''}{m.created_by ? ' \u00b7 ' + m.created_by : ''}</li>))}
                      </ul>
                    )}
                    <button onClick={bookFG} disabled={booking} className="mt-2 px-3 py-2 text-sm rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-500 disabled:opacity-50">{booking ? 'Booking\u2026' : 'Close & Book FG'}</button>
                  </div>
                ) : (
                  <p className="text-xs text-amber-600">No finished-goods product is linked to this work order, so FG can\u2019t be booked to inventory. Link a product on the order first.</p>
                )}
              </div>
              <div className="border-t border-gray-100 pt-4">
                <label className="block text-xs text-gray-400 mb-2">Materials / BOM · live from inventory</label>
                {bom.length > 0 ? (
                  <div className="rounded-lg border border-gray-100 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead><tr className="bg-gray-50 text-[11px] text-gray-400 uppercase"><th className="text-left px-3 py-1.5">Component</th><th className="text-right px-3 py-1.5">On hand</th><th className="text-left px-3 py-1.5">Lot</th></tr></thead>
                      <tbody>
                        {bom.map((c, i) => (
                          <tr key={i} className="border-t border-gray-50">
                            <td className="px-3 py-1.5 font-mono text-emerald-700">{c.component_sku}<div className="text-[10px] text-gray-400 font-sans truncate max-w-[190px]">{c.product_name}</div></td>
                            <td className="px-3 py-1.5 text-right" style={{ color: (Number(c.on_hand_qty) || 0) < 0 ? '#DC2626' : '#111827' }}>{fmtN(c.on_hand_qty)} {c.uom || ''}</td>
                            <td className="px-3 py-1.5 text-xs text-gray-500">{c.lot || '\u2014'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">No BOM components on file for this item.</p>
                )}
              </div>
              <div className="border-t border-gray-100 pt-4">
                <FileUpload supabase={sb} recordType="work_order" recordId={detail.id} currentUserEmail={userEmail} />
              </div>
              <div className="border-t border-gray-100 pt-4">
                {/* Two-way sync with the linked Sales Order thread (Ultron) */}
                <Comments recordId={detail.sales_order_id ?? detail.id} recordType={detail.sales_order_id ? 'sales_order' : 'work_order'} currentUserEmail={userEmail} title="Notes & Comments" />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
