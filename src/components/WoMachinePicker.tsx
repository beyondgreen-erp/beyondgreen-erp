'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * "Machines" picker for a work order card on any production board (Walmart, Straw, Bags, Cutlery, Molding).
 * Shows only the machines that belong to that board and lets you tap as many as you need.
 * Saves through wo_set_machines, which also stamps connected_from so Machine Status picks the work order up.
 */
import { useEffect, useState } from 'react'

export interface MachineOpt { id: string; machine_code: string; name: string; equipment_group: string | null }

// Which machines each production board can use. Same split as the sections on Machine Status.
export function machineFitsBoard(board: string, m: { machine_code: string; equipment_group: string | null }): boolean {
  const g = (m.equipment_group || '').toUpperCase()
  const pla = m.machine_code.toUpperCase().startsWith('MLD')
  switch (board) {
    case 'walmart':
    case 'mts_cutlery': return g === 'MOLDING' && !pla
    case 'cm_molding': return g === 'MOLDING'
    case 'straw': return g === 'STRAWS'
    case 'mts_bags':
    case 'pl_bags': return g === 'EXTRUDER' || g === 'CONVERSION'
    default: return true
  }
}

let cache: MachineOpt[] | null = null
let pending: Promise<MachineOpt[]> | null = null
export function loadMachines(sb: any): Promise<MachineOpt[]> {
  if (cache) return Promise.resolve(cache)
  pending = pending || sb.from('machines').select('id,machine_code,name,equipment_group').eq('is_active', true).order('machine_code')
    .then(({ data }: any) => { cache = (data as MachineOpt[]) || []; return cache })
  return pending!
}

export default function WoMachinePicker({ sb, woId, woCode, value, board, canEdit, onSaved }: {
  sb: any; woId: string; woCode?: string | null; value?: string | null; board: string; canEdit: boolean; onSaved?: (msg: string) => void
}) {
  const [opts, setOpts] = useState<MachineOpt[]>((cache || []).filter(m => machineFitsBoard(board, m)))
  const [sel, setSel] = useState<string[]>(value ? [value] : [])
  const [busy, setBusy] = useState(false)
  useEffect(() => { loadMachines(sb).then(list => setOpts(list.filter(m => machineFitsBoard(board, m)))) }, [sb, board])
  useEffect(() => {
    let live = true
    sb.from('wo_machines').select('machine_id').eq('work_order_id', woId).then(({ data }: any) => {
      if (!live) return
      const ids = ((data || []) as any[]).map(r => r.machine_id as string)
      setSel(ids.length ? ids : value ? [value] : [])
    })
    return () => { live = false }
  }, [sb, woId, value])

  const codeOf = (id: string) => opts.find(m => m.id === id)?.machine_code || (cache || []).find(m => m.id === id)?.machine_code || '?'
  if (!canEdit) return sel.length ? <p className="text-[11px] text-gray-500 mt-1">Machines: <b className="text-[#1A1D2E]">{sel.map(codeOf).join(', ')}</b></p> : null

  async function save(next: string[], msg: string) {
    const prev = sel
    setSel(next); setBusy(true)
    const { error } = await sb.rpc('wo_set_machines', { p_wo: woId, p_board: board, p_machine_ids: next })
    setBusy(false)
    if (error) { setSel(prev); onSaved?.(`⚠ Could not update machines on ${woCode || 'the work order'}: ${error.message}`); return }
    onSaved?.(msg)
  }
  function toggle(id: string) {
    const on = sel.includes(id)
    const next = on ? sel.filter(x => x !== id) : [...sel, id]
    save(next, on ? `${woCode || 'Work order'} removed from ${codeOf(id)}.` : `✓ ${woCode || 'Work order'} connected to ${codeOf(id)}.`)
  }
  const allOn = opts.length > 0 && opts.every(m => sel.includes(m.id))
  return (
    <div className="mt-2" data-ro-ok>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[11px] font-semibold text-gray-600">Machines{sel.length ? ` (${sel.length})` : ''}</span>
        {opts.length > 1 && (
          <button type="button" disabled={busy} onClick={() => save(allOn ? [] : opts.map(m => m.id), allOn ? `${woCode || 'Work order'} disconnected from all machines.` : `✓ ${woCode || 'Work order'} connected to all ${opts.length} machines.`)}
            className="text-[11px] font-semibold text-emerald-700 hover:underline disabled:opacity-50">{allOn ? 'Clear all' : 'Select all'}</button>
        )}
      </div>
      {opts.length === 0 ? <p className="text-[11px] text-gray-500">No machines set up for this board yet.</p> : (
        <div className="flex flex-wrap gap-1.5">
          {opts.map(m => {
            const on = sel.includes(m.id)
            return (
              <button key={m.id} type="button" disabled={busy} onClick={() => toggle(m.id)} aria-pressed={on} title={m.name}
                className={`min-h-[30px] px-2.5 rounded-full border text-[11px] font-mono font-semibold transition-colors disabled:opacity-50 ${on ? 'bg-[#13201A] text-white border-[#13201A]' : 'bg-white text-[#1A1D2E] border-[#D5DED7] hover:border-gray-400'}`}>
                {on ? '✓ ' : ''}{m.machine_code}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
