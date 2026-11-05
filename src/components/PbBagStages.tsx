'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
// Bag work orders (MTS Bags + Private Label Bags): Extrusion -> Conversion -> Packing on one work order,
// case packing plan with the partial case flagged, extruder meters, and the digital work order.
import { useMemo, useState } from 'react'
import { pcsPerUnit, bagLengthIn, pcsPerCase, packPlan, metersFor, stepsOf, stageOf, STEP_LABEL, type BagProduct, type PackPlan } from '@/lib/bagMath'

const num = (v: any) => Number(v) || 0
const fmtN = (v: any, d = 0) => num(v).toLocaleString('en-US', { maximumFractionDigits: d })
const who = (e?: string | null) => (e || 'unknown').split('@')[0]
const fmtWhen = (s: string) => new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export interface StageEntry { id: string; work_order_id: string; sku: string; stage: string; pcs: number; meters: number | null; production_date: string; note: string | null; entered_by: string | null; created_at: string; voided_at: string | null; voided_by: string | null; void_reason: string | null }
export interface ProdEntry { id: string; work_order_id: string | null; production_date: string; sku: string; qty: number; note: string | null; entered_by: string | null; created_at: string; voided_at: string | null; voided_by?: string | null; void_reason: string | null; lot_number?: string | null }
export interface BagRow {
  sku: string; name: string; uom: string; targetUnits: number; madeUnits: number; ppu: number; targetPcs: number; madePcs: number
  casePcs: number | null; lenIn: number | null; scrap: number; metersReq: number | null; extrudedPcs: number; extrudedM: number; convertedPcs: number
  plan: PackPlan; madePlan: PackPlan
}
export interface BagWo { id: string; wo_code: string | null; status: string | null; due_date: string | null; spec?: any }

export function buildBagRows(wo: BagWo, prog: { work_order_id: string; sku: string; product_name: string | null; uom: string | null; target_qty: number; made_qty: number }[],
  products: Record<string, BagProduct>, soPcs: Record<string, number>, stages: StageEntry[]): BagRow[] {
  const ovAll = wo.spec?.wo_details?.skus || {}
  return prog.filter(p => p.work_order_id === wo.id).sort((a, b) => a.sku.localeCompare(b.sku)).map(p => {
    const pr = products[p.sku], ov = ovAll[p.sku] || {}
    const ppu = pcsPerUnit(pr), lenIn = bagLengthIn(pr, ov), casePcs = pcsPerCase(pr, ov, soPcs[p.sku])
    const targetPcs = num(p.target_qty) * ppu, madePcs = num(p.made_qty) * ppu
    const live = stages.filter(s => s.work_order_id === wo.id && s.sku === p.sku && !s.voided_at)
    const ex = live.filter(s => s.stage === 'extrusion'), cv = live.filter(s => s.stage === 'conversion')
    return {
      sku: p.sku, name: p.product_name || pr?.product_name || p.sku, uom: p.uom || pr?.unit_of_measure || 'units',
      targetUnits: num(p.target_qty), madeUnits: num(p.made_qty), ppu, targetPcs, madePcs, casePcs, lenIn, scrap: num(ov.scrap_pct),
      metersReq: metersFor(targetPcs, lenIn, ov.scrap_pct), extrudedPcs: ex.reduce((t, s) => t + num(s.pcs), 0), extrudedM: ex.reduce((t, s) => t + num(s.meters), 0),
      convertedPcs: cv.reduce((t, s) => t + num(s.pcs), 0), plan: packPlan(targetPcs, casePcs), madePlan: packPlan(madePcs, casePcs),
    }
  })
}

// ── step strip on the work order card ─────────────────────────────────────────
export function BagStepStrip({ wo, rows, accent, canEdit, busy, onMove, onLog, onOpen }: {
  wo: BagWo; rows: BagRow[]; accent: string; canEdit: boolean; busy: boolean
  onMove: (stage: string) => void; onLog: (stage: string) => void; onOpen: () => void
}) {
  const steps = [...stepsOf(wo.spec), 'packing'], cur = stageOf(wo.spec), ci = steps.indexOf(cur)
  const done = ['Complete', 'Completed', 'Closed', 'Cancelled'].includes(wo.status || '')
  const qtyAt = (s: string) => s === 'extrusion' ? rows.reduce((t, r) => t + r.extrudedPcs, 0) : s === 'conversion' ? rows.reduce((t, r) => t + r.convertedPcs, 0) : rows.reduce((t, r) => t + r.madePcs, 0)
  const tgt = rows.reduce((t, r) => t + r.targetPcs, 0)
  const next = steps[ci + 1]
  return (
    <div className="mb-3 rounded-lg border border-[#ECEEF3] bg-[#FAFBFD] p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {steps.map((s, i) => {
          const on = s === cur && !done, past = i < ci || done
          return (
            <div key={s} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-gray-300">▸</span>}
              <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full border" style={on ? { background: accent, color: '#fff', borderColor: accent } : past ? { background: '#E8F8EF', color: '#00804a', borderColor: '#BFE8D0' } : { background: '#fff', color: '#676879', borderColor: '#E4E6EE' }}>
                {past && !on ? '✓ ' : ''}{STEP_LABEL[s].replace(' (finished cases)', '')} · {fmtN(qtyAt(s))}{tgt ? ` / ${fmtN(tgt)}` : ''} pcs
              </span>
            </div>)
        })}
        <span className="flex-1" />
        <button onClick={onOpen} className="h-8 px-3 rounded-lg border border-[#E4E6EE] bg-white text-xs font-semibold text-gray-600" data-ro-ok>📋 Open work order</button>
        {canEdit && !done && <button onClick={() => onLog(cur)} disabled={busy} className="h-8 px-3 rounded-lg text-xs font-bold text-white disabled:opacity-50" style={{ background: accent }}>+ Log {cur === 'packing' ? 'finished cases' : STEP_LABEL[cur].toLowerCase()}</button>}
        {canEdit && !done && next && <button onClick={() => onMove(next)} disabled={busy} className="h-8 px-3 rounded-lg border-2 text-xs font-bold bg-white disabled:opacity-50" style={{ borderColor: accent, color: accent }}>Move to {STEP_LABEL[next].replace(' (finished cases)', '')} ▸</button>}
      </div>
      <div className="mt-2 space-y-1">
        {rows.map(r => (
          <p key={r.sku} className="text-[11px] text-gray-600">
            <span className="font-mono font-semibold text-[#1A1D2E]">{r.sku}</span>
            {' · '}{fmtN(r.targetPcs)} pcs
            {r.metersReq != null ? <> · extruder <b>{fmtN(r.metersReq)} m</b> ({r.lenIn}&quot; bags{r.scrap ? ` + ${r.scrap}% scrap` : ''})</> : <span className="text-amber-700"> · bag length not set, can&apos;t work out meters</span>}
            {' · '}pack <b>{r.plan.text}</b>
            {r.plan.partial > 0 && <span className="ml-1 font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded px-1">⚠ partial case {fmtN(r.plan.partial)} pcs</span>}
          </p>))}
      </div>
    </div>)
}

// ── log a step ────────────────────────────────────────────────────────────────
export function BagStageLog({ sb, wo, rows, stage: startStage, accent, boardKey, today, onClose, onDone }: {
  sb: any; wo: BagWo; rows: BagRow[]; stage: string; accent: string; boardKey: string; today: string
  onClose: () => void; onDone: (msg: string) => void
}) {
  const steps = [...stepsOf(wo.spec), 'packing']
  const [stage, setStage] = useState(steps.includes(startStage) ? startStage : steps[0])
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')
  const [vals, setVals] = useState<Record<string, { a: string; b: string }>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (sku: string, k: 'a' | 'b', v: string) => setVals(x => ({ ...x, [sku]: { a: x[sku]?.a || '', b: x[sku]?.b || '', [k]: v } }))
  const inp = 'h-10 w-full border border-[#E4E6EE] rounded-lg px-2 text-sm'
  // per-row derived numbers
  const calc = (r: BagRow) => {
    const a = num(vals[r.sku]?.a), b = num(vals[r.sku]?.b)
    if (stage === 'extrusion') { const pcs = r.lenIn ? Math.floor(a / (r.lenIn * 0.0254)) : b; return { pcs: a && r.lenIn ? pcs : b, meters: a, units: 0 } }
    if (stage === 'conversion') return { pcs: a, meters: 0, units: 0 }
    const pcs = a * (r.casePcs || 0) + b
    return { pcs, meters: 0, units: pcs / r.ppu }
  }
  async function save() {
    setErr('')
    const todo = rows.map(r => ({ r, c: calc(r) })).filter(x => x.c.pcs > 0 || x.c.meters > 0)
    if (!todo.length) { setErr('Enter a quantity for at least one SKU.'); return }
    if (stage === 'packing' && todo.some(x => !x.r.casePcs)) { setErr('Set "Pieces per case" in ✎ Details first, so cases can be converted.'); return }
    setBusy(true)
    const ok: string[] = [], bad: string[] = []
    for (const { r, c } of todo) {
      const { error } = stage === 'packing'
        ? await sb.rpc('pb_record_production', { p_board: boardKey, p_sku: r.sku, p_qty: +c.units.toFixed(6), p_date: date, p_wo: wo.id,
            p_note: [note.trim(), `${fmtN(Math.floor(c.pcs / (r.casePcs || 1)))} × ${fmtN(r.casePcs)} pcs${c.pcs % (r.casePcs || 1) ? ` + partial case ${fmtN(c.pcs % (r.casePcs || 1))} pcs` : ''}`].filter(Boolean).join(' · ') })
        : await sb.rpc('pb_record_stage', { p_wo: wo.id, p_sku: r.sku, p_stage: stage, p_pcs: c.pcs || null, p_meters: c.meters || null, p_date: date, p_note: note.trim() || null })
      if (error) bad.push(`${r.sku}: ${error.message}`); else ok.push(`${r.sku} ${fmtN(c.pcs)} pcs${c.meters ? ` (${fmtN(c.meters)} m)` : ''}`)
    }
    setBusy(false)
    if (bad.length) { setErr(bad.join(' · ')); if (!ok.length) return }
    onDone(`✓ ${STEP_LABEL[stage]} logged on ${wo.wo_code}: ${ok.join(', ')}.${stage === 'packing' ? ' Added to inventory, packaging taken out.' : stage === 'extrusion' ? ' Resin and dye taken out; nothing added to inventory yet.' : ' No inventory change until packing.'}`)
  }
  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => !busy && onClose()}>
      <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-4 pb-3 border-b border-[#EEF0F4]">
          <p className="text-[11px] uppercase tracking-wide text-gray-400">{wo.wo_code}</p>
          <h2 className="text-lg font-bold text-[#1A1D2E]">Log production</h2>
          <div className="flex gap-1 bg-[#F2F4F8] rounded-lg p-1 mt-2">
            {steps.map(s => <button key={s} onClick={() => { setStage(s); setVals({}) }} className={`flex-1 h-9 rounded-md text-sm font-semibold ${stage === s ? 'bg-white shadow-sm text-[#1A1D2E]' : 'text-gray-500'}`}>{STEP_LABEL[s].replace(' (finished cases)', '')}</button>)}
          </div>
          <p className="text-[12px] text-gray-500 mt-2">{stage === 'extrusion' ? 'Enter the meters run. Bags are worked out from the bag length. Resin and dye come out of inventory now; nothing is added yet.'
            : stage === 'conversion' ? 'Enter the bags converted (pieces). No inventory change at this step.'
            : 'Enter full cases and any partial case. Finished goods go into inventory and the packaging comes out.'}</p>
        </div>
        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          {rows.map(r => {
            const c = calc(r)
            return (
              <div key={r.sku} className="rounded-lg border border-[#ECEEF3] p-3">
                <div className="flex items-baseline gap-2 mb-2"><span className="font-mono text-sm font-bold">{r.sku}</span><span className="text-[11px] text-gray-400 truncate">{r.name}</span></div>
                {stage === 'extrusion' && <div className="grid grid-cols-2 gap-2">
                  <label className="text-[11px] text-gray-500">Meters extruded<input type="number" min={0} value={vals[r.sku]?.a || ''} onChange={e => set(r.sku, 'a', e.target.value)} className={inp} /></label>
                  {r.lenIn ? <p className="text-[12px] text-gray-600 self-end pb-2">= <b>{fmtN(c.pcs)}</b> bags at {r.lenIn}&quot;<br /><span className="text-gray-400">done {fmtN(r.extrudedM)} of {fmtN(r.metersReq)} m</span></p>
                    : <label className="text-[11px] text-gray-500">Bags (no bag length on file)<input type="number" min={0} value={vals[r.sku]?.b || ''} onChange={e => set(r.sku, 'b', e.target.value)} className={inp} /></label>}
                </div>}
                {stage === 'conversion' && <label className="text-[11px] text-gray-500 block">Bags converted (pcs) <span className="text-gray-400">· done {fmtN(r.convertedPcs)} of {fmtN(r.targetPcs)}</span>
                  <input type="number" min={0} value={vals[r.sku]?.a || ''} onChange={e => set(r.sku, 'a', e.target.value)} className={inp} /></label>}
                {stage === 'packing' && <>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-[11px] text-gray-500">Full cases{r.casePcs ? ` (${fmtN(r.casePcs)} pcs each)` : ''}<input type="number" min={0} value={vals[r.sku]?.a || ''} onChange={e => set(r.sku, 'a', e.target.value)} className={inp} /></label>
                    <label className="text-[11px] text-gray-500">Partial case (pcs)<input type="number" min={0} value={vals[r.sku]?.b || ''} onChange={e => set(r.sku, 'b', e.target.value)} className={inp} /></label>
                  </div>
                  <p className="text-[12px] text-gray-600 mt-1.5">Plan: <b>{r.plan.text}</b>{r.plan.partial > 0 && <span className="ml-1 text-amber-800 font-semibold">⚠ partial case</span>} · packed so far {r.madePlan.text}</p>
                  {c.pcs > 0 && <p className="text-[12px] mt-1">= <b>{fmtN(c.pcs)} pcs</b> = <b>{fmtN(c.units, 3)} {r.uom}</b> into inventory
                    {r.casePcs && c.pcs % r.casePcs ? <span className="ml-1 text-amber-800 font-semibold">⚠ includes a partial case of {fmtN(c.pcs % r.casePcs)} pcs</span> : null}
                    {Math.abs(c.units - Math.round(c.units)) > 1e-6 && r.ppu > 1 ? <span className="block text-amber-700">Not a whole number of {r.uom} ({fmtN(r.ppu)} pcs each). Check the count.</span> : null}</p>}
                </>}
              </div>)
          })}
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-gray-500">Date<input type="date" value={date} onChange={e => setDate(e.target.value)} className={inp} /></label>
            <label className="text-[11px] text-gray-500">Note (optional)<input value={note} onChange={e => setNote(e.target.value)} className={inp} /></label>
          </div>
          {err && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
        </div>
        <div className="px-5 py-3 border-t border-[#EEF0F4] flex gap-2">
          <button onClick={onClose} disabled={busy} className="flex-1 h-11 rounded-lg border border-[#E4E6EE] text-sm">Cancel</button>
          <button onClick={save} disabled={busy} className="flex-1 h-11 rounded-lg text-white text-sm font-bold disabled:opacity-50" style={{ background: accent }}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>)
}

// ── digital work order ────────────────────────────────────────────────────────
export function DigitalWo({ sb, wo, rows, isBags, orders, stages, prods, accent, canEdit, me, isAdmin, onClose, onChanged, onDetails, onTargets, onPrint, onLog }: {
  sb: any; wo: BagWo & { start_date?: string | null; machine_id?: string | null }; rows: BagRow[]; isBags: boolean; orders: string[]
  stages: StageEntry[]; prods: ProdEntry[]; accent: string; canEdit: boolean; me: string; isAdmin: boolean
  onClose: () => void; onChanged: (msg: string) => void; onDetails: () => void; onTargets: () => void; onPrint: () => void; onLog: (stage: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const done = ['Complete', 'Completed', 'Closed', 'Cancelled'].includes(wo.status || '')
  const steps = stepsOf(wo.spec), cur = stageOf(wo.spec)
  const d = wo.spec?.wo_details?.wo || {}
  const log = useMemo(() => [
    ...stages.filter(s => s.work_order_id === wo.id).map(s => ({ kind: 'stage' as const, id: s.id, at: s.created_at, step: s.stage, sku: s.sku, qty: `${fmtN(s.pcs)} pcs${s.meters ? ` · ${fmtN(s.meters)} m` : ''}`, by: s.entered_by, note: s.note, voided: s.voided_at, vr: s.void_reason })),
    ...prods.filter(p => p.work_order_id === wo.id).map(p => ({ kind: 'prod' as const, id: p.id, at: p.created_at, step: 'packing', sku: p.sku, qty: `${fmtN(p.qty, 3)} ${rows.find(r => r.sku === p.sku)?.uom || 'units'}`, by: p.entered_by, note: p.note, voided: p.voided_at, vr: p.void_reason })),
  ].sort((a, b) => b.at.localeCompare(a.at)), [stages, prods, wo.id, rows])
  async function toggleStep(s: string) {
    const nextSteps = steps.includes(s) ? steps.filter(x => x !== s) : ['extrusion', 'conversion'].filter(x => x === s || steps.includes(x))
    setBusy(true)
    const { error } = await sb.rpc('pb_wo_set_steps', { p_wo: wo.id, p_steps: nextSteps })
    setBusy(false)
    onChanged(error ? '⚠ ' + error.message : `✓ Steps for ${wo.wo_code}: ${[...nextSteps, 'packing'].map(x => STEP_LABEL[x].replace(' (finished cases)', '')).join(' ▸ ')}.`)
  }
  async function move(s: string) {
    setBusy(true); const { error } = await sb.rpc('pb_wo_set_stage', { p_wo: wo.id, p_stage: s }); setBusy(false)
    onChanged(error ? '⚠ ' + error.message : `✓ ${wo.wo_code} moved to ${STEP_LABEL[s]}.`)
  }
  async function undo(e: (typeof log)[number]) {
    const reason = window.prompt(`Undo ${e.qty} of ${e.sku} (${STEP_LABEL[e.step] || e.step})?\n\nWhy?`, 'Logged by mistake')
    if (!reason?.trim()) return
    setBusy(true)
    const { error } = await sb.rpc(e.kind === 'stage' ? 'pb_void_stage' : 'pb_void_production', { p_id: e.id, p_reason: reason.trim() })
    setBusy(false)
    onChanged(error ? '⚠ ' + error.message : `↩ Undone: ${e.qty} of ${e.sku}.`)
  }
  const th = 'text-[10px] uppercase tracking-wide text-gray-400 font-semibold px-2 py-1.5 text-right'
  const td = 'px-2 py-1.5 border-t border-[#F0F2F6] text-right'
  return (
    <div className="fixed inset-0 z-[85] bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => !busy && onClose()}>
      <div className="bg-white w-full sm:max-w-4xl rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[94vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-4 pb-3 border-b border-[#EEF0F4] flex items-start gap-3" style={{ borderTop: `5px solid ${accent}`, borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-gray-400">Digital work order</p>
            <h2 className="text-xl font-bold text-[#1A1D2E]">{wo.wo_code} <span className="text-xs font-semibold px-2 py-0.5 rounded-full align-middle" style={{ background: accent + '1A', color: accent }}>{wo.status}</span>
              {isBags && !done && <span className="text-xs font-semibold px-2 py-0.5 rounded-full align-middle ml-1 bg-[#F2F4F8] text-gray-600">at {STEP_LABEL[cur].replace(' (finished cases)', '')}</span>}</h2>
            <p className="text-[12px] text-gray-500 mt-0.5">{orders.length ? orders.join(' · ') : 'Stock build'}{wo.due_date ? ` · due ${wo.due_date}` : ''}{d.operator ? ` · operator ${d.operator}` : ''}{d.shift ? ` · ${d.shift} shift` : ''}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none" aria-label="Close">&times;</button>
        </div>
        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          <div className="flex flex-wrap gap-2">
            {canEdit && <button onClick={onDetails} className="h-9 px-3 rounded-lg border border-[#E4E6EE] text-xs font-semibold text-gray-600">✎ Edit details</button>}
            {canEdit && !done && <button onClick={onTargets} className="h-9 px-3 rounded-lg border border-[#E4E6EE] text-xs font-semibold text-gray-600">✎ Edit quantities</button>}
            <button onClick={onPrint} className="h-9 px-3 rounded-lg border border-[#E4E6EE] text-xs font-semibold text-gray-600" data-ro-ok>🖨 Download</button>
            {canEdit && !done && <button onClick={() => onLog(cur)} className="h-9 px-3 rounded-lg text-xs font-bold text-white" style={{ background: accent }}>+ Log production</button>}
          </div>

          {isBags && <div className="rounded-lg border border-[#ECEEF3] p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Steps</p>
            <div className="flex flex-wrap items-center gap-2">
              {['extrusion', 'conversion'].map(s => (
                <label key={s} className={`flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-lg border ${steps.includes(s) ? 'border-emerald-300 bg-emerald-50' : 'border-[#E4E6EE] text-gray-400'}`}>
                  <input type="checkbox" checked={steps.includes(s)} disabled={!canEdit || done || busy} onChange={() => toggleStep(s)} /> {STEP_LABEL[s]}</label>))}
              <span className="text-sm text-gray-500">▸ Packing (always last)</span>
              <span className="flex-1" />
              {canEdit && !done && [...steps, 'packing'].map(s => s !== cur && <button key={s} onClick={() => move(s)} disabled={busy} className="h-8 px-2.5 rounded-lg border text-xs font-semibold bg-white" style={{ borderColor: accent, color: accent }}>Move to {STEP_LABEL[s].replace(' (finished cases)', '')}</button>)}
            </div>
            {!steps.includes('extrusion') && <p className="text-[11px] text-gray-500 mt-1.5">No extrusion on this work order (bought film): the resin and packaging both come out when finished cases are logged.</p>}
          </div>}

          <div className="overflow-x-auto rounded-lg border border-[#ECEEF3]">
            <table className="w-full text-sm min-w-[760px]">
              <thead><tr className="bg-[#FAFBFD]"><th className={th + ' text-left'}>SKU</th><th className={th}>Order</th>
                {isBags && <><th className={th}>Meters needed</th><th className={th}>Extruded</th><th className={th}>Converted</th></>}
                <th className={th}>Packed</th><th className={th + ' text-left'}>Case plan</th></tr></thead>
              <tbody>{rows.map(r => (
                <tr key={r.sku}>
                  <td className={td + ' text-left'}><p className="font-mono text-[12px] font-semibold">{r.sku}</p><p className="text-[10px] text-gray-400 truncate max-w-[200px]">{r.name}</p></td>
                  <td className={td}>{fmtN(r.targetPcs)} pcs<span className="block text-[10px] text-gray-400">{fmtN(r.targetUnits, 3)} {r.uom}</span></td>
                  {isBags && <>
                    <td className={td}>{r.metersReq != null ? `${fmtN(r.metersReq)} m` : <span className="text-amber-700 text-[11px]">set bag length</span>}<span className="block text-[10px] text-gray-400">{r.lenIn ? `${r.lenIn}" bag${r.scrap ? ` · +${r.scrap}%` : ''}` : ''}</span></td>
                    <td className={td}>{fmtN(r.extrudedPcs)} pcs<span className="block text-[10px] text-gray-400">{fmtN(r.extrudedM)} m</span></td>
                    <td className={td}>{fmtN(r.convertedPcs)} pcs</td></>}
                  <td className={td}>{fmtN(r.madePcs)} pcs<span className="block text-[10px] text-gray-400">{r.madePlan.casePcs ? r.madePlan.text : `${fmtN(r.madeUnits, 3)} ${r.uom}`}</span></td>
                  <td className={td + ' text-left text-[12px]'}>{r.plan.text}{r.plan.partial > 0 && <span className="block font-semibold text-amber-800">⚠ partial case: {fmtN(r.plan.partial)} pcs</span>}</td>
                </tr>))}
                {rows.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-gray-400">No SKUs yet. Use ✎ Edit quantities.</td></tr>}
              </tbody>
            </table>
          </div>

          {(d.notes || wo.spec?.wo_details?.wo?.notes) && <div className="rounded-lg bg-[#FAFBFD] border border-[#ECEEF3] p-3"><p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Notes</p><p className="text-sm whitespace-pre-wrap">{d.notes}</p></div>}

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Production log</p>
            <div className="rounded-lg border border-[#ECEEF3] divide-y divide-[#F0F2F6]">
              {log.map(e => {
                const canUndo = canEdit && !e.voided && (isAdmin || ((e.by || '').toLowerCase() === me && Date.now() - new Date(e.at).getTime() < 48 * 3600_000))
                return (
                  <div key={e.kind + e.id} className={`flex items-center gap-3 px-3 py-2 ${e.voided ? 'opacity-50' : ''}`}>
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#F2F4F8] text-gray-600 w-24 text-center">{STEP_LABEL[e.step]?.replace(' (finished cases)', '') || e.step}</span>
                    <p className={`flex-1 text-sm ${e.voided ? 'line-through' : ''}`}><span className="font-mono font-semibold">{e.sku}</span> · <b>{e.qty}</b><span className="text-[11px] text-gray-500"> · {who(e.by)} · {fmtWhen(e.at)}{e.note ? ' · ' + e.note : ''}{e.voided ? ` · removed: ${e.vr || ''}` : ''}</span></p>
                    {canUndo && <button onClick={() => undo(e)} disabled={busy} className="h-8 px-2.5 rounded-lg border border-[#ECEEF3] text-xs text-gray-500 hover:text-red-600">↩ Undo</button>}
                  </div>)
              })}
              {log.length === 0 && <p className="p-4 text-center text-sm text-gray-400">Nothing logged yet.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>)
}
