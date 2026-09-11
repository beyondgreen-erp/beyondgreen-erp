'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

/**
 * Actual run hours on a work order.
 *
 * Run time is normally captured from the status buttons, but plenty of jobs never get
 * touched at the right moment — or ran before any of this existed. Typed hours override
 * the clock so a real run is never lost, and re-entering replaces the previous figure
 * rather than counting it twice.
 */

interface Op {
  id: string
  seq: number
  operation: string
  machine_id: string | null
  qty_planned: number | null
  qty_produced: number | null
  qty_uom: string | null
  status: string
  manual_run_hours: number | null
  manual_run_note: string | null
  learning_status: string | null
  machines?: { name: string } | null
}

const UOMS = ['EA', 'PCS', 'PKS', 'CASE', 'PALLET', 'ROLLS', 'BAGS']

export default function RunEntry({ workOrderId, productId, userEmail }: {
  workOrderId: string
  productId?: string | null
  userEmail?: string
}) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [ops, setOps] = useState<Op[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [hours, setHours] = useState('')
  const [qty, setQty] = useState('')
  const [uom, setUom] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [estimates, setEstimates] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await sb
      .from('work_order_operations')
      .select('*, machines(name)')
      .eq('work_order_id', workOrderId)
      .eq('is_active', true)
      .order('seq')
    const rows = (data as Op[]) || []
    setOps(rows)
    setLoading(false)

    // What the schedule thinks each step should take, and on what evidence.
    if (productId) {
      const next: Record<string, string> = {}
      for (const o of rows) {
        if (!o.machine_id || !o.qty_planned) continue
        const { data: e } = await sb.rpc('estimate_run_hours', {
          p_product_id: productId, p_machine_id: o.machine_id,
          p_qty: o.qty_planned, p_uom: o.qty_uom,
        })
        const r: any = Array.isArray(e) ? e[0] : e
        if (r?.hours) next[o.id] = `${Number(r.hours).toLocaleString('en-US', { maximumFractionDigits: 1 })} h planned · ${r.basis}`
        else if (r?.note) next[o.id] = r.note
      }
      setEstimates(next)
    }
  }, [sb, workOrderId, productId])

  useEffect(() => { load() }, [load])

  function startEdit(o: Op) {
    setEditing(o.id)
    setHours(o.manual_run_hours ? String(o.manual_run_hours) : '')
    setQty(o.qty_produced ? String(o.qty_produced) : o.qty_planned ? String(o.qty_planned) : '')
    setUom(o.qty_uom || 'CASE')
    setNote(o.manual_run_note || '')
    setMsg('')
  }

  async function saveRun(o: Op) {
    setBusy(true); setMsg('')
    if (uom && uom !== o.qty_uom) {
      await sb.from('work_order_operations').update({ qty_uom: uom }).eq('id', o.id)
    }
    const { data, error } = await sb.rpc('record_manual_run', {
      p_operation_id: o.id,
      p_run_hours: parseFloat(hours) || 0,
      p_qty_produced: parseFloat(qty) || 0,
      p_entered_by: userEmail || 'unknown',
      p_note: note.trim() || null,
    })
    setBusy(false)
    setMsg(error ? 'Could not save: ' + error.message : String(data))
    if (!error) { setEditing(null); load() }
  }

  async function setStatus(o: Op, status: string) {
    setBusy(true)
    await sb.from('work_order_operations').update({ status }).eq('id', o.id)
    setBusy(false); load()
  }

  if (loading) return <p className="text-xs text-gray-400">Loading run history…</p>
  if (ops.length === 0) {
    return <p className="text-xs text-gray-400">No operations yet. Assign a machine to this work order and one is created automatically.</p>
  }

  return (
    <div className="space-y-3">
      {ops.map(o => (
        <div key={o.id} className="rounded-lg border border-[#E4E6EE] p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-[#1A1D2E]">
                {o.seq}. {o.operation}
                <span className="text-gray-400 font-normal"> · {o.machines?.name ?? 'no machine'}</span>
              </p>
              {estimates[o.id] && <p className="text-[11px] text-gray-500 mt-0.5">{estimates[o.id]}</p>}
            </div>
            <select value={o.status} disabled={busy} onChange={e => setStatus(o, e.target.value)}
              className="text-[11px] border border-[#E4E6EE] rounded-lg px-2 py-1 bg-white cursor-pointer">
              {['Planned', 'In Progress', 'Paused', 'Complete', 'Cancelled'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {o.learning_status && (
            <p className={`text-[11px] mt-2 rounded px-2 py-1 ${o.learning_status.startsWith('recorded') ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
              {o.learning_status}
            </p>
          )}

          {editing === o.id ? (
            <div className="mt-3 space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] text-gray-400 mb-1">Actual run hours</label>
                  <input type="number" step="0.1" value={hours} onChange={e => setHours(e.target.value)}
                    className="w-full border border-[#E4E6EE] rounded-lg px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400 mb-1">Qty produced</label>
                  <input type="number" value={qty} onChange={e => setQty(e.target.value)}
                    className="w-full border border-[#E4E6EE] rounded-lg px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400 mb-1">In</label>
                  <select value={uom} onChange={e => setUom(e.target.value)}
                    className="w-full border border-[#E4E6EE] rounded-lg px-2 py-1.5 text-sm bg-white cursor-pointer">
                    {UOMS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              <p className="text-[10px] text-gray-400">Check the unit — entering cases as packs is the easy mistake, and it changes the learned rate by the pack size.</p>
              <input placeholder="Note (optional) — e.g. where the hours came from" value={note} onChange={e => setNote(e.target.value)}
                className="w-full border border-[#E4E6EE] rounded-lg px-2 py-1.5 text-sm" />
              <div className="flex gap-2">
                <button onClick={() => setEditing(null)} className="text-xs px-3 py-1.5 rounded-lg border border-[#E4E6EE] text-gray-500">Cancel</button>
                <button onClick={() => saveRun(o)} disabled={busy}
                  className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-300 text-white font-medium">
                  {busy ? 'Saving…' : 'Record run'}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-3 text-[11px]">
              <button onClick={() => startEdit(o)} className="text-emerald-700 hover:underline font-medium">
                {o.manual_run_hours ? 'Edit actual run' : 'Enter actual run'}
              </button>
              {o.manual_run_hours && <span className="text-gray-400">{o.manual_run_hours} h entered by hand</span>}
            </div>
          )}
        </div>
      ))}
      {msg && <p className="text-[11px] text-gray-600 bg-[#F5F6FA] rounded px-2 py-1.5">{msg}</p>}
    </div>
  )
}
