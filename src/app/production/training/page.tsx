'use client'
// Operator Training board — who is trained on which production line, through when.
// A work order can only be assigned to an operator trained on its line (supervisor override, logged).
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface LineCell { valid_through: string | null; trained_on: string | null }
interface Hist { id: string; line: string; trained_on: string; valid_through: string; trainer: string | null; notes: string | null; by: string | null; revoked_at: string | null; revoke_reason: string | null }
interface Person { id: string; name: string; department: string | null; lines: Record<string, LineCell | null>; history: Hist[] }
interface Matrix { lines: { key: string; label: string }[]; enforce_from: string | null; can_edit: boolean; people: Person[]; overrides: { wo: string; operator: string; line: string; reason: string; by: string; at: string }[] }

const DAY = 86400000
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }
const parse = (s: string) => new Date(s + 'T00:00:00')
const fmt = (s: string | null) => s ? parse(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const plus3y = (s: string) => { const d = parse(s); d.setFullYear(d.getFullYear() + 3); return iso(d) }

function state(c: LineCell | null | undefined): 'ok' | 'soon' | 'expired' | 'none' {
  if (!c || !c.valid_through) return 'none'
  const left = (parse(c.valid_through).getTime() - today().getTime()) / DAY
  return left < 0 ? 'expired' : left <= 60 ? 'soon' : 'ok'
}
const CELL: Record<string, string> = {
  ok: 'bg-emerald-50 text-emerald-800 border-emerald-200', soon: 'bg-amber-50 text-amber-800 border-amber-200',
  expired: 'bg-red-50 text-red-700 border-red-200', none: 'bg-white text-gray-300 border-[#ECEEF3]',
}

export default function TrainingPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [m, setM] = useState<Matrix | null>(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [onlyGaps, setOnlyGaps] = useState(false)
  const [form, setForm] = useState<{ person: Person; line: string; trained_on: string; valid_through: string; trainer: string; notes: string } | null>(null)
  const [hist, setHist] = useState<Person | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await sb.rpc('training_matrix')
    if (error) setErr(error.message); else { setErr(''); setM(data as Matrix) }
  }, [sb])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) }, [toast])

  const people = useMemo(() => (m?.people || []).filter(p => {
    if (q && !`${p.name} ${p.department || ''}`.toLowerCase().includes(q.toLowerCase())) return false
    if (onlyGaps && m && m.lines.every(l => state(p.lines?.[l.key]) === 'ok')) return false
    return true
  }), [m, q, onlyGaps])

  const totals = useMemo(() => {
    const t = { trained: 0, soon: 0, expired: 0, untrained: 0 }
    for (const p of m?.people || []) {
      const s = (m?.lines || []).map(l => state(p.lines?.[l.key]))
      if (s.some(x => x === 'ok' || x === 'soon')) t.trained++; else t.untrained++
      if (s.includes('soon')) t.soon++
      if (s.includes('expired')) t.expired++
    }
    return t
  }, [m])

  const enforce = m?.enforce_from ? parse(m.enforce_from) : null
  const graceDays = enforce ? Math.ceil((enforce.getTime() - today().getTime()) / DAY) : 0

  function openForm(person: Person, line: string) {
    if (!m?.can_edit) return
    const d = iso(today())
    setForm({ person, line, trained_on: d, valid_through: plus3y(d), trainer: '', notes: '' })
  }
  async function save() {
    if (!form) return
    setBusy(true)
    const { error } = await sb.rpc('training_log', {
      p_employee: form.person.id, p_line: form.line, p_trained_on: form.trained_on, p_valid_through: form.valid_through || null,
      p_trainer: form.trainer, p_notes: form.notes, p_attachment: null,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setToast(`✓ ${form.person.name} trained on ${m?.lines.find(l => l.key === form.line)?.label} through ${fmt(form.valid_through)}`)
    setForm(null); load()
  }
  async function revoke(h: Hist) {
    const reason = window.prompt('Why remove this training record? (kept in history)')
    if (reason === null) return
    const { error } = await sb.rpc('training_revoke', { p_id: h.id, p_reason: reason })
    if (error) { setErr(error.message); return }
    setToast('Training record removed'); setHist(null); load()
  }

  const inp = 'h-10 border border-[#E4E6EE] rounded-lg px-3 text-sm w-full'
  return (
    <div className="min-h-screen mon-page p-4 sm:p-6 lg:p-8">
      {toast && <div className="fixed top-4 right-4 z-[70] bg-[#1A1D2E] text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-lg">{toast}</div>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
        <div>
          <span className="mon-tag" style={{ background: '#00A84F22', color: '#037f4c' }}>🏭 Production</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1">Operator Training</h1>
          <p className="text-sm text-gray-500">Who is trained on each production line, and through when. Training is good for 3 years. Click a cell to log or renew training.</p>
        </div>
      </div>

      {enforce && (
        <div className={`rounded-xl border px-4 py-3 mb-4 text-sm ${graceDays > 0 ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-emerald-50 border-emerald-200 text-emerald-900'}`}>
          {graceDays > 0
            ? <>Training goal: <b>{fmt(m!.enforce_from)}</b> ({graceDays} days left). Until then, untrained operators can still be assigned but are flagged on the work order. From that date, work orders can only be assigned to trained operators (supervisor override allowed).</>
            : <>Training is enforced. Work orders can only be assigned to operators trained on that line, or with a supervisor override.</>}
        </div>)}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[['Trained on at least one line', totals.trained, '#037f4c'], ['Not trained on any line', totals.untrained, '#e2445c'], ['Expiring in 60 days', totals.soon, '#fdab3d'], ['Expired', totals.expired, '#e2445c']].map(([l, v, c]) => (
          <div key={String(l)} className="bg-white rounded-xl border border-[#ECEEF3] p-3"><p className="text-[11px] text-gray-500">{l}</p><p className="text-2xl font-bold" style={{ color: String(c) }}>{v as number}</p></div>))}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search operator…" className="h-10 w-64 border border-[#E4E6EE] rounded-lg px-3 text-sm bg-white" />
        <label className="text-sm text-gray-600 flex items-center gap-2"><input type="checkbox" checked={onlyGaps} onChange={e => setOnlyGaps(e.target.checked)} /> Only show gaps</label>
        {!m?.can_edit && <span className="text-xs text-gray-400">View only. Supervisors and managers can log training.</span>}
      </div>
      {err && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{err}</p>}

      <div className="bg-white rounded-xl border border-[#ECEEF3] shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-[#F8FAFF] text-[11px] uppercase tracking-wide text-gray-500">
            <th className="text-left px-3 py-2">Operator</th>
            {(m?.lines || []).map(l => <th key={l.key} className="text-left px-3 py-2 whitespace-nowrap">{l.label}</th>)}
            <th className="px-3 py-2"></th>
          </tr></thead>
          <tbody>
            {!m && <tr><td className="px-3 py-6 text-center text-gray-400" colSpan={9}>Loading…</td></tr>}
            {people.map(p => (
              <tr key={p.id} className="border-t border-[#F0F2F6]">
                <td className="px-3 py-2"><p className="font-semibold text-[#1A1D2E]">{p.name}</p><p className="text-[11px] text-gray-400">{p.department || '—'}</p></td>
                {m!.lines.map(l => {
                  const c = p.lines?.[l.key], s = state(c)
                  return (
                    <td key={l.key} className="px-2 py-1.5">
                      <button onClick={() => openForm(p, l.key)} disabled={!m!.can_edit}
                        className={`w-full min-w-[120px] text-left rounded-lg border px-2 py-1.5 text-[12px] ${CELL[s]} ${m!.can_edit ? 'hover:ring-2 hover:ring-[#037f4c33]' : 'cursor-default'}`}>
                        {s === 'none' ? (m!.can_edit ? '+ Log training' : 'Not trained')
                          : <><b>{s === 'expired' ? 'Expired' : 'Trained'}</b> <span className="block text-[11px]">thru {fmt(c!.valid_through)}</span></>}
                      </button>
                    </td>)
                })}
                <td className="px-3 py-2 text-right"><button onClick={() => setHist(p)} className="text-[11px] text-[#3B6FE0] hover:underline whitespace-nowrap">History ({p.history.length})</button></td>
              </tr>))}
          </tbody>
        </table>
      </div>

      {!!m?.overrides?.length && (
        <div className="bg-white rounded-xl border border-[#ECEEF3] shadow-sm mt-4">
          <p className="px-4 py-3 border-b border-[#EEF0F4] text-sm font-bold text-[#1A1D2E]">Supervisor overrides (latest 50)</p>
          <table className="w-full text-sm"><tbody>
            {m.overrides.map((o, i) => <tr key={i} className="border-t border-[#F0F2F6]"><td className="px-3 py-2 font-mono text-[12px]">{o.wo}</td><td className="px-3 py-2">{o.operator}</td><td className="px-3 py-2 text-gray-500">{m.lines.find(l => l.key === o.line)?.label || o.line}</td><td className="px-3 py-2">{o.reason}</td><td className="px-3 py-2 text-[11px] text-gray-400">{o.by} · {new Date(o.at).toLocaleDateString()}</td></tr>)}
          </tbody></table>
        </div>)}

      {form && (
        <div className="fixed inset-0 z-[110] bg-black/50 flex items-center justify-center p-4" onClick={() => !busy && setForm(null)}>
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 pt-4 pb-3 border-b border-[#EEF0F4]">
              <p className="text-[11px] uppercase tracking-wide text-gray-400">Log training</p>
              <h2 className="text-lg font-bold text-[#1A1D2E]">{form.person.name}</h2>
            </div>
            <div className="px-5 py-4 space-y-3">
              <label className="block"><span className="text-[11px] text-gray-500">Production line</span>
                <select value={form.line} onChange={e => setForm({ ...form, line: e.target.value })} className={inp}>{m!.lines.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}</select></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="text-[11px] text-gray-500">Trained on</span>
                  <input type="date" value={form.trained_on} onChange={e => setForm({ ...form, trained_on: e.target.value, valid_through: e.target.value ? plus3y(e.target.value) : form.valid_through })} className={inp} /></label>
                <label className="block"><span className="text-[11px] text-gray-500">Valid through (3 years)</span>
                  <input type="date" value={form.valid_through} onChange={e => setForm({ ...form, valid_through: e.target.value })} className={inp} /></label>
              </div>
              <label className="block"><span className="text-[11px] text-gray-500">Trainer</span><input value={form.trainer} onChange={e => setForm({ ...form, trainer: e.target.value })} placeholder="Who trained them" className={inp} /></label>
              <label className="block"><span className="text-[11px] text-gray-500">Notes (what was covered, signed log on file, etc.)</span><textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className={inp.replace('h-10', 'min-h-[60px] py-2')} /></label>
            </div>
            <div className="px-5 py-3 border-t border-[#EEF0F4] flex gap-2">
              <button onClick={() => setForm(null)} disabled={busy} className="flex-1 h-11 rounded-lg border border-[#E4E6EE] text-sm">Cancel</button>
              <button onClick={save} disabled={busy || !form.trained_on} className="flex-1 h-11 rounded-lg text-white text-sm font-bold bg-[#037f4c] disabled:opacity-50">{busy ? 'Saving…' : 'Save training'}</button>
            </div>
          </div>
        </div>)}

      {hist && (
        <div className="fixed inset-0 z-[110] bg-black/50 flex items-center justify-center p-4" onClick={() => setHist(null)}>
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 pt-4 pb-3 border-b border-[#EEF0F4] flex justify-between"><div><p className="text-[11px] uppercase tracking-wide text-gray-400">Training history</p><h2 className="text-lg font-bold text-[#1A1D2E]">{hist.name}</h2></div>
              <button onClick={() => setHist(null)} className="text-gray-400 text-3xl leading-none px-2">&times;</button></div>
            <div className="overflow-y-auto">
              {hist.history.length === 0 ? <p className="px-5 py-6 text-sm text-gray-400">No training logged yet.</p> :
                <table className="w-full text-sm"><tbody>
                  {hist.history.map(h => (
                    <tr key={h.id} className={`border-t border-[#F0F2F6] ${h.revoked_at ? 'opacity-50 line-through' : ''}`}>
                      <td className="px-3 py-2">{m!.lines.find(l => l.key === h.line)?.label || h.line}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmt(h.trained_on)} → {fmt(h.valid_through)}</td>
                      <td className="px-3 py-2">{h.trainer || ''}<span className="block text-[11px] text-gray-400">{h.notes || ''}{h.revoke_reason ? ` · removed: ${h.revoke_reason}` : ''}</span></td>
                      <td className="px-3 py-2 text-[11px] text-gray-400">{h.by}</td>
                      <td className="px-3 py-2 text-right">{m!.can_edit && !h.revoked_at && <button onClick={() => revoke(h)} className="text-[11px] text-red-600 hover:underline">Remove</button>}</td>
                    </tr>))}
                </tbody></table>}
            </div>
          </div>
        </div>)}
    </div>
  )
}
