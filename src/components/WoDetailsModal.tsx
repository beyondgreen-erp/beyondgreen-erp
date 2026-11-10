'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Work order details: everything that prints on the work order and can change per job
 * (operator, supervisor, schedule, notes, and per-SKU specs like print, wrapper, color, case pack).
 * Fields start filled with the product's defaults; whatever is changed here applies to this work order only.
 */
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { WO_FIELDS, skuFields, defaultOf, loadWoDetails, type WoKind, type WoField } from '@/lib/woDetails'

interface Props { sb: any; kind: WoKind; boardKey?: string; woId: string; woCode: string | null; accent: string; canEdit: boolean; isNew?: boolean; onClose: () => void; onSaved: (msg: string) => void }

export default function WoDetailsModal({ sb, kind, boardKey, woId, woCode, accent, canEdit, isNew, onClose, onSaved }: Props) {
  const [lines, setLines] = useState<any[]>([])
  const [woBase, setWoBase] = useState<Record<string, string>>({})
  const [wo, setWo] = useState<Record<string, string>>({})
  const [skus, setSkus] = useState<Record<string, Record<string, string>>>({})
  const [staff, setStaff] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<string>('')
  // fields filled from the product/BOM start locked; the Override button unlocks one for this work order
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set())
  const fields = useMemo(() => skuFields(kind, boardKey), [kind, boardKey])

  useEffect(() => {
    let live = true
    ;(async () => {
      const [{ data: p, error }, saved, { data: w }, { data: emp }] = await Promise.all([
        sb.rpc(kind === 'straw' ? 'straw_wo_print' : 'pb_wo_print', { p_wo: woId }),
        loadWoDetails(sb, woId),
        sb.from('work_orders').select('assigned_operator,notes,scheduled_date,scheduled_start').eq('id', woId).maybeSingle(),
        sb.from('employees').select('name,department').eq('status', 'Active').is('end_date', null).in('department', ['Warehouse Operations', 'Manufacturing', 'Shipping/Receiving']).order('name'),
      ])
      if (!live) return
      if (error) { setErr(error.message); setLoading(false); return }
      const ls = (p?.lines || []) as any[]
      setLines(ls); setOpen(ls[0]?.sku || '')
      setStaff(((emp as any[]) || []).map(e => e.name).filter(Boolean))
      const base: Record<string, string> = {
        operator: w?.assigned_operator || '', notes: w?.notes || '', scheduled_date: w?.scheduled_date || '',
        scheduled_start: w?.scheduled_start ? String(w.scheduled_start).slice(0, 5) : '',
      }
      setWoBase(base)
      setWo({ ...base, ...Object.fromEntries(Object.entries(saved?.wo || {}).map(([k, v]) => [k, v == null ? '' : String(v)])) })
      const s: Record<string, Record<string, string>> = {}
      for (const l of ls) {
        const ov = saved?.skus?.[String(l.sku).toUpperCase()] || {}
        s[l.sku] = Object.fromEntries(fields.map(f => [f.key, ov[f.key] != null && ov[f.key] !== '' ? String(ov[f.key]) : defaultOf(kind, l, f.key)]))
      }
      setSkus(s); setLoading(false)
    })()
    return () => { live = false }
  }, [sb, woId, kind, fields])

  async function save() {
    setErr(''); setBusy(true)
    // keep only what differs from the product default, so later product changes still flow through
    const outSkus: Record<string, Record<string, string>> = {}
    for (const l of lines) {
      const diff: Record<string, string> = {}
      for (const f of fields) { const v = (skus[l.sku]?.[f.key] ?? '').trim(); if (v !== defaultOf(kind, l, f.key)) diff[f.key] = v }
      if (Object.keys(diff).length) outSkus[String(l.sku).toUpperCase()] = diff
    }
    const outWo: Record<string, string> = {}
    for (const f of WO_FIELDS) outWo[f.key] = (wo[f.key] ?? '').trim()
    const { error } = await sb.rpc('wo_save_details', { p_wo: woId, p_details: { wo: outWo, skus: outSkus } })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onSaved(`✓ ${woCode || 'Work order'} details saved. They print on the work order and labels.`)
  }

  const inp = 'h-10 border border-[#E4E6EE] rounded-lg px-3 text-sm w-full disabled:bg-[#F7F8FA]'
  const input = (f: WoField, val: string, set: (v: string) => void, def?: string, list?: string, lockKey?: string) => {
    const changed = def !== undefined && val.trim() !== def
    const locked = !!lockKey && !!def && !changed && !unlocked.has(lockKey)
    const cls = inp + (changed ? ' border-amber-400 bg-amber-50' : '')
    if (locked) return (
      <div key={f.key} className={f.wide ? 'col-span-2' : ''}>
        <span className="text-[11px] text-gray-500">{f.label} <span className="text-emerald-700 font-semibold">· from BOM / product</span></span>
        <div className="flex items-center gap-2">
          <div className="h-10 flex-1 min-w-0 rounded-lg border border-[#E4E6EE] bg-[#F7F8FA] px-3 text-sm flex items-center truncate" title={def}>{def}</div>
          {canEdit && <button type="button" onClick={() => setUnlocked(u => new Set(u).add(lockKey!))} className="h-10 px-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 text-xs font-bold whitespace-nowrap hover:bg-amber-100">✎ Override</button>}
        </div>
      </div>)
    return (
      <label key={f.key} className={f.wide ? 'col-span-2 block' : 'block'}>
        <span className="text-[11px] text-gray-500">{f.label}{changed ? <span className="text-amber-700 font-semibold"> · this WO only</span> : null}
          {lockKey && def && canEdit && (changed || unlocked.has(lockKey)) ? <button type="button" onClick={e => { e.preventDefault(); set(def); setUnlocked(u => { const n = new Set(u); n.delete(lockKey); return n }) }} className="ml-2 text-[11px] font-semibold text-emerald-700 hover:underline">↺ Use default</button> : null}</span>
        {f.type === 'select' ? <select value={val} disabled={!canEdit} onChange={e => set(e.target.value)} className={cls}>{(f.options || []).map(o => <option key={o} value={o}>{o || '—'}</option>)}</select>
          : f.type === 'textarea' ? <textarea value={val} disabled={!canEdit} onChange={e => set(e.target.value)} rows={2} className={cls.replace('h-10', 'min-h-[60px] py-2')} />
            : <input type={f.type === 'number' ? 'text' : f.type || 'text'} inputMode={f.type === 'number' ? 'decimal' : undefined} list={list} value={val} disabled={!canEdit}
                onChange={e => set(f.type === 'number' ? e.target.value.replace(/[^0-9.]/g, '') : e.target.value)} placeholder={def ? `Default: ${def}` : ''} className={cls} />}
      </label>)
  }

  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-[110] bg-black/50 flex items-end sm:items-center justify-center sm:p-4" onClick={() => !busy && onClose()}>
      <div className="w-full sm:max-w-2xl bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-4 pb-3 border-b border-[#EEF0F4] flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-gray-400">{isNew ? 'New work order · step 2' : 'Work order details'}</p>
            <h2 className="text-lg font-bold text-[#1A1D2E]">{woCode || 'Work order'}</h2>
            <p className="text-xs text-gray-500">Filled in from each product and its BOM. Click Override to change a value for this job only; it prints on the work order and case labels.</p>
          </div>
          <button onClick={onClose} disabled={busy} className="text-gray-400 text-3xl leading-none px-2" aria-label="Close">&times;</button>
        </div>
        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          {loading ? <p className="text-sm text-gray-400 py-6 text-center">Loading…</p> : <>
            <section>
              <h3 className="text-sm font-bold text-[#1A1D2E] mb-2">Job</h3>
              <datalist id="wo-staff">{staff.map(s => <option key={s} value={s} />)}</datalist>
              <div className="grid grid-cols-2 gap-3">
                {WO_FIELDS.map(f => input(f, wo[f.key] ?? '', v => setWo(x => ({ ...x, [f.key]: v })), undefined, f.key === 'operator' || f.key === 'supervisor' ? 'wo-staff' : undefined))}
              </div>
            </section>
            {lines.length === 0 && <p className="text-sm text-gray-400">This work order has no SKUs yet. Add targets first, then the specs show here.</p>}
            {lines.map(l => (
              <section key={l.sku} className="rounded-xl border border-[#ECEEF3]">
                <button type="button" onClick={() => setOpen(open === l.sku ? '' : l.sku)} className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left">
                  <span><span className="font-mono text-[13px] font-bold text-[#1A1D2E]">{l.sku}</span><span className="block text-[11px] text-gray-500">{l.name}</span></span>
                  <span className="text-gray-400 text-sm">{open === l.sku ? '▲' : '▼'}</span>
                </button>
                {open === l.sku && <div className="grid grid-cols-2 gap-3 px-3 pb-3">
                  {fields.map(f => input(f, skus[l.sku]?.[f.key] ?? '', v => setSkus(x => ({ ...x, [l.sku]: { ...x[l.sku], [f.key]: v } })), defaultOf(kind, l, f.key), undefined, `${l.sku}:${f.key}`))}
                </div>}
              </section>))}
          </>}
          {err && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
        </div>
        <div className="px-5 py-3 border-t border-[#EEF0F4] flex gap-2">
          <button onClick={onClose} disabled={busy} className="flex-1 h-11 rounded-lg border border-[#E4E6EE] text-sm">{canEdit ? (isNew ? 'Skip for now' : 'Cancel') : 'Close'}</button>
          {canEdit && <button onClick={save} disabled={busy || loading} className="flex-1 h-11 rounded-lg text-white text-sm font-bold disabled:opacity-50" style={{ background: accent }}>{busy ? 'Saving…' : 'Save details'}</button>}
        </div>
      </div>
    </div>, document.body)
}
