'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Material on a work order: what booking this run has deducted (BOM consumption),
 * and start-up / shut-down / production rejects logged against it.
 *
 * Scrap is entered in lbs, either against one material (resin, colour, additive) or
 * against the finished good, which the database splits across the BOM's % rows.
 * Every entry deducts inventory through wo_log_scrap() and can be removed with a
 * reason (wo_void_scrap puts the material back).
 */

import { useCallback, useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { bomStatus, BOM_STATUS_TEXT, fmtQty, type BomStatus } from '@/lib/bomConsumption'

const sb = createSupabaseBrowserClient()

const TYPES: { v: 'startup' | 'shutdown' | 'reject'; label: string }[] = [
  { v: 'startup', label: 'Start-up' },
  { v: 'shutdown', label: 'Shut-down' },
  { v: 'reject', label: 'Production reject' },
]
const typeLabel = (t: string) => TYPES.find(x => x.v === t)?.label || t

type Entry = { id: string; scrap_type: string; basis: string; sku: string; lbs: number; note: string | null; entered_by: string | null; created_at: string; voided_at: string | null; void_reason: string | null }

export default function WorkOrderScrap({ woId, fgSku, refreshKey }: { woId: string; fgSku: string | null; refreshKey?: number }) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [used, setUsed] = useState<{ sku: string; consume: number; scrap: number; uom: string | null }[]>([])
  const [materials, setMaterials] = useState<string[]>([])
  const [status, setStatus] = useState<BomStatus | null>(null)
  const [type, setType] = useState<'startup' | 'shutdown' | 'reject'>('startup')
  const [sku, setSku] = useState('')
  const [lbs, setLbs] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [{ data: es }, { data: mv }] = await Promise.all([
      sb.from('wo_scrap_entries').select('*').eq('work_order_id', woId).order('created_at', { ascending: false }),
      sb.from('inventory_movements').select('sku, qty, uom, movement_type, ref_table, ref_id')
        .eq('ref_table', 'work_orders').eq('ref_id', woId).in('movement_type', ['consume', 'adjust']),
    ])
    const list = ((es as any[]) || []) as Entry[]
    setEntries(list)
    // Net BOM consumption for this WO (less any "WO material return" from an undone booking), plus scrap.
    const by: Record<string, { sku: string; consume: number; scrap: number; uom: string | null }> = {}
    for (const m of (mv as any[]) || []) {
      const k = m.sku
      by[k] = by[k] || { sku: k, consume: 0, scrap: 0, uom: m.uom }
      if (m.movement_type === 'consume') by[k].consume += Math.abs(Number(m.qty) || 0)
      else by[k].consume -= Math.abs(Number(m.qty) || 0)
    }
    const live = list.filter(e => !e.voided_at).map(e => e.id)
    if (live.length) {
      const { data: sm } = await sb.from('inventory_movements').select('sku, qty, uom').eq('ref_table', 'wo_scrap_entries').eq('movement_type', 'scrap').in('ref_id', live)
      for (const m of (sm as any[]) || []) {
        by[m.sku] = by[m.sku] || { sku: m.sku, consume: 0, scrap: 0, uom: m.uom }
        by[m.sku].scrap += Math.abs(Number(m.qty) || 0)
      }
    }
    setUsed(Object.values(by).filter(r => Math.abs(r.consume) > 1e-9 || r.scrap > 0).sort((a, b) => a.sku.localeCompare(b.sku)))
  }, [woId])

  useEffect(() => { load() }, [load, refreshKey])

  useEffect(() => {
    let off = false
    ;(async () => {
      setStatus(await bomStatus(sb, fgSku))
      if (!fgSku) { setMaterials([]); return }
      const { data } = await sb.from('product_bom').select('component_sku, uom_type').ilike('finished_good_sku', fgSku.trim())
      const mats = Array.from(new Set(((data as any[]) || []).filter(r => r.uom_type === 'percentage').map(r => String(r.component_sku).trim())))
      if (!off) { setMaterials(mats); setSku(s => s || fgSku) }
    })()
    return () => { off = true }
  }, [fgSku])

  async function logScrap() {
    const q = Number(lbs)
    if (!sku.trim()) { alert('Pick what was scrapped.'); return }
    if (!(q > 0)) { alert('Enter the scrap weight in lbs.'); return }
    const isFg = !!fgSku && sku.trim().toUpperCase() === fgSku.trim().toUpperCase()
    if (!window.confirm(`Log ${fmtQty(q)} lb of ${typeLabel(type).toLowerCase()} scrap on this work order?\n\n`
      + (isFg ? `It is split across ${fgSku}'s BOM materials and deducted from inventory.` : `${fmtQty(q)} lb is deducted from ${sku.trim()} in inventory.`))) return
    setBusy(true)
    try {
      const { data, error } = await sb.rpc('wo_log_scrap', { p_wo_id: woId, p_type: type, p_sku: sku.trim(), p_lbs: q, p_note: note.trim() || null })
      if (error) { alert('Could not log scrap: ' + error.message); return }
      const d = ((data as any)?.deducted as any[]) || []
      alert('Scrap logged. Deducted from inventory:\n\n' + d.map(x => `  - ${x.sku}: ${fmtQty(Number(x.qty))} ${x.uom || ''}`).join('\n'))
      setLbs(''); setNote('')
      await load()
    } finally { setBusy(false) }
  }

  async function voidEntry(e: Entry) {
    const reason = window.prompt(`Remove this scrap entry (${fmtQty(e.lbs)} lb ${e.sku})? The material goes back into inventory.\n\nReason:`)
    if (reason == null) return
    if (!reason.trim()) { alert('A reason is required.'); return }
    const { error } = await sb.rpc('wo_void_scrap', { p_id: e.id, p_reason: reason.trim() })
    if (error) { alert('Could not remove: ' + error.message); return }
    await load()
  }

  const totals = TYPES.map(t => ({ ...t, lbs: entries.filter(e => !e.voided_at && e.scrap_type === t.v).reduce((s, e) => s + Number(e.lbs || 0), 0) }))
  const inp = 'bg-white border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500'

  return (
    <div className="space-y-4">
      {status && status !== 'ok' && (
        <div className={`rounded-lg px-3 py-2 text-xs font-medium ${status === 'no_material' ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          <span className="inline-block mr-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide" style={{ background: status === 'no_material' ? '#F59E0B' : '#DC2626', color: '#fff' }}>
            {status === 'none' ? 'No BOM' : status === 'no_weight' ? 'No item weight' : 'No resin rows'}
          </span>
          {BOM_STATUS_TEXT[status]}
        </div>
      )}

      <div>
        <label className="block text-xs text-gray-400 mb-2">Materials deducted for this work order</label>
        {used.length === 0 ? (
          <p className="text-xs text-gray-400">Nothing yet. Booking finished goods deducts the BOM; scrap below deducts too.</p>
        ) : (
          <div className="rounded-lg border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 text-[11px] text-gray-400 uppercase"><th className="text-left px-3 py-1.5">Material</th><th className="text-right px-3 py-1.5">Used (BOM)</th><th className="text-right px-3 py-1.5">Scrap</th></tr></thead>
              <tbody>
                {used.map(r => (
                  <tr key={r.sku} className="border-t border-gray-50">
                    <td className="px-3 py-1.5 font-mono text-emerald-700">{r.sku}</td>
                    <td className="px-3 py-1.5 text-right">{fmtQty(r.consume)} {r.uom || ''}</td>
                    <td className="px-3 py-1.5 text-right" style={{ color: r.scrap > 0 ? '#B45309' : '#9CA3AF' }}>{r.scrap > 0 ? fmtQty(r.scrap) + ' ' + (r.uom || '') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-2">Scrap &amp; rejects (lbs)</label>
        <div className="flex flex-wrap gap-2 mb-2">
          {totals.map(t => (
            <span key={t.v} className="text-[11px] rounded-full px-2 py-0.5 bg-gray-50 border border-gray-100 text-gray-600">{t.label}: <b>{fmtQty(t.lbs)}</b> lb</span>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select value={type} onChange={e => setType(e.target.value as any)} className={inp}>
            {TYPES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
          </select>
          <input list={`scrap-skus-${woId}`} value={sku} onChange={e => setSku(e.target.value)} placeholder="Material or finished good SKU" className={inp + ' font-mono'} />
          <datalist id={`scrap-skus-${woId}`}>
            {fgSku && <option value={fgSku}>Finished good (split across BOM materials)</option>}
            {materials.map(m => <option key={m} value={m}>Material</option>)}
          </datalist>
          <input type="number" min={0} step="any" value={lbs} onChange={e => setLbs(e.target.value)} placeholder="lbs" className={inp} />
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" className={inp} />
        </div>
        <button onClick={logScrap} disabled={busy} className="mt-2 px-3 py-2 text-sm rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-500 disabled:opacity-50">{busy ? 'Logging…' : 'Log scrap'}</button>
        {entries.length > 0 && (
          <ul className="mt-3 text-xs text-gray-600 space-y-1">
            {entries.map(e => (
              <li key={e.id} className={`flex items-center justify-between gap-2 ${e.voided_at ? 'line-through text-gray-300' : ''}`}>
                <span>
                  {typeLabel(e.scrap_type)} · <span className="font-mono">{e.sku}</span>{e.basis === 'finished_good' ? ' (FG)' : ''} · <b>{fmtQty(e.lbs)} lb</b>
                  {e.note ? ' · ' + e.note : ''} · {new Date(e.created_at).toLocaleDateString()}{e.entered_by ? ' · ' + e.entered_by.split('@')[0] : ''}
                  {e.voided_at && e.void_reason ? ' · removed: ' + e.void_reason : ''}
                </span>
                {!e.voided_at && <button onClick={() => voidEntry(e)} className="text-red-500 hover:text-red-700 shrink-0">Remove</button>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
