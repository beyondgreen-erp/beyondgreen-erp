'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * "Machine" dropdown for a work order card on any production board (Walmart, Straw, …).
 * Saves straight to work_orders.machine_id (+ connected_from = the board) so the work order
 * shows up on Machine Status and can be started there.
 */
import { useEffect, useState } from 'react'

interface MachineOpt { id: string; machine_code: string; name: string }
let cache: MachineOpt[] | null = null
let pending: Promise<MachineOpt[]> | null = null

export default function WoMachinePicker({ sb, woId, woCode, value, board, canEdit, onSaved }: {
  sb: any; woId: string; woCode?: string | null; value: string | null | undefined; board: string; canEdit: boolean; onSaved?: (msg: string) => void
}) {
  const [opts, setOpts] = useState<MachineOpt[]>(cache || [])
  const [val, setVal] = useState<string>(value || '')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setVal(value || '') }, [value, woId])
  useEffect(() => {
    if (cache) return
    pending = pending || sb.from('machines').select('id,machine_code,name').eq('is_active', true).order('machine_code')
      .then(({ data }: any) => { cache = (data as MachineOpt[]) || []; return cache })
    pending!.then(list => setOpts(list))
  }, [sb])
  const name = opts.find(m => m.id === val)
  if (!canEdit) return val ? <p className="text-[11px] text-gray-500 mt-1">Machine: <b className="text-[#1A1D2E]">{name ? `${name.machine_code} · ${name.name}` : '—'}</b></p> : null
  async function change(id: string) {
    const prev = val
    setVal(id); setBusy(true)
    const mid = id || null
    const { error } = await sb.from('work_orders').update({ machine_id: mid, connected_from: mid ? board : null, updated_at: new Date().toISOString() }).eq('id', woId)
    setBusy(false)
    if (error) { setVal(prev); onSaved?.(`⚠ Could not connect ${woCode || 'the work order'}: ${error.message}`); return }
    const m = opts.find(x => x.id === id)
    onSaved?.(mid ? `✓ ${woCode || 'Work order'} connected to ${m ? m.machine_code : 'the machine'}.` : `${woCode || 'Work order'} disconnected from its machine.`)
  }
  return (
    <label className="flex items-center gap-2 mt-2 text-[11px] font-semibold text-gray-600" data-ro-ok>
      Machine
      <select value={val} disabled={busy} onChange={e => change(e.target.value)} className="h-8 rounded-lg border border-[#E4E6EE] bg-white px-2 text-xs text-[#1A1D2E] disabled:opacity-50">
        <option value="">Not connected</option>
        {opts.map(m => <option key={m.id} value={m.id}>{m.machine_code} · {m.name}</option>)}
      </select>
    </label>)
}
