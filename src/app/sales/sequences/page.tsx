'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Step { id?: string; step_number: number; delay_days: number; subject: string; body: string }
interface Sequence {
  id: string; name: string; description: string | null; status: string
  from_email: string | null; from_name: string | null; reply_to: string | null; daily_cap: number
  send_days: string[] | null; created_at: string
}
interface Enr { sequence_id: string; status: string }

const VARS = ['{{company}}', '{{contact}}', '{{first_name}}', '{{city}}', '{{state}}', '{{industry}}', '{{website}}', '{{my_name}}']
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DEFAULT_STEPS: Step[] = [
  { step_number: 1, delay_days: 0, subject: 'Compostable packaging for {{company}}', body: 'Hi {{first_name}},\n\nI came across {{company}} and thought our certified-compostable cutlery and packaging could be a great fit. Would you be open to a quick look?\n\nBest,\n{{my_name}}\nbeyondGREEN' },
  { step_number: 2, delay_days: 2, subject: 'Re: Compostable packaging for {{company}}', body: 'Hi {{first_name}},\n\nJust floating this back to the top — happy to send samples so your team can see the quality first-hand.\n\n{{my_name}}' },
  { step_number: 3, delay_days: 3, subject: 'A quick idea for {{company}}', body: 'Hi {{first_name}},\n\nMany {{industry}} businesses are switching to compostable to meet customer demand and local mandates. Worth a 10-minute call?\n\n{{my_name}}' },
  { step_number: 4, delay_days: 4, subject: 'Still worth a look?', body: 'Hi {{first_name}},\n\nNo worries if the timing is off — should I circle back next quarter, or is there a better person at {{company}} to talk to?\n\n{{my_name}}' },
]

export default function SequencesPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [seqs, setSeqs] = useState<Sequence[]>([])
  const [stepsBySeq, setStepsBySeq] = useState<Record<string, Step[]>>({})
  const [counts, setCounts] = useState<Record<string, Record<string, number>>>({})
  const [loading, setLoading] = useState(true)
  const [userEmail, setUserEmail] = useState('')

  const [editing, setEditing] = useState<Sequence | null>(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<any>({})
  const [steps, setSteps] = useState<Step[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => { sb.auth.getUser().then(({ data }) => setUserEmail(data.user?.email || '')) }, [sb])

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: s }, { data: st }, { data: en }] = await Promise.all([
      sb.from('sequences').select('*').order('created_at', { ascending: false }),
      sb.from('sequence_steps').select('*').order('step_number'),
      sb.from('sequence_enrollments').select('sequence_id,status'),
    ])
    setSeqs((s as Sequence[]) || [])
    const bs: Record<string, Step[]> = {}
    ;(st as Step[] || []).forEach((x: any) => { (bs[x.sequence_id] ||= []).push(x) })
    setStepsBySeq(bs)
    const c: Record<string, Record<string, number>> = {}
    ;(en as Enr[] || []).forEach(e => { (c[e.sequence_id] ||= {}); c[e.sequence_id][e.status] = (c[e.sequence_id][e.status] || 0) + 1 })
    setCounts(c)
    setLoading(false)
  }, [sb])
  useEffect(() => { load() }, [load])

  function openNew() {
    setEditing(null)
    setForm({ name: '', description: '', from_name: 'Rudy Perrier', from_email: '', reply_to: '', daily_cap: 40, send_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], status: 'draft' })
    setSteps(DEFAULT_STEPS.map(s => ({ ...s })))
    setOpen(true)
  }
  function openEdit(s: Sequence) {
    setEditing(s); setForm({ ...s, send_days: s.send_days || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] })
    setSteps((stepsBySeq[s.id] || []).map(x => ({ ...x })).sort((a, b) => a.step_number - b.step_number))
    setOpen(true)
  }
  function close() { setOpen(false); setTimeout(() => setEditing(null), 150) }

  function addStep() {
    if (steps.length >= 7) return
    setSteps(s => [...s, { step_number: s.length + 1, delay_days: 3, subject: '', body: '' }])
  }
  function removeStep(i: number) { setSteps(s => s.filter((_, idx) => idx !== i).map((x, idx) => ({ ...x, step_number: idx + 1 }))) }
  function updateStep(i: number, patch: Partial<Step>) { setSteps(s => s.map((x, idx) => idx === i ? { ...x, ...patch } : x)) }

  async function save() {
    if (!form.name?.trim()) { alert('Give the sequence a name.'); return }
    setSaving(true)
    const payload = {
      name: form.name.trim(), description: form.description || null, from_email: form.from_email || null,
      from_name: form.from_name || null, reply_to: form.reply_to || null, daily_cap: Number(form.daily_cap) || 40,
      send_days: form.send_days, status: form.status || 'draft', updated_at: new Date().toISOString(),
    }
    let seqId = editing?.id
    if (editing?.id) await sb.from('sequences').update(payload).eq('id', editing.id)
    else { const { data } = await sb.from('sequences').insert({ ...payload, created_by: userEmail }).select('id').single(); seqId = (data as any)?.id }
    if (seqId) {
      await sb.from('sequence_steps').delete().eq('sequence_id', seqId)
      const rows = steps.filter(s => s.subject || s.body).map((s, idx) => ({ sequence_id: seqId, step_number: idx + 1, delay_days: Number(s.delay_days) || 0, subject: s.subject, body: s.body }))
      if (rows.length) await sb.from('sequence_steps').insert(rows)
    }
    setSaving(false); close(); load()
  }
  async function setStatus(s: Sequence, status: string) { await sb.from('sequences').update({ status, updated_at: new Date().toISOString() }).eq('id', s.id); load() }
  async function del(s: Sequence) { if (!confirm(`Delete sequence "${s.name}"? Enrollments will be removed.`)) return; await sb.from('sequences').delete().eq('id', s.id); load() }

  const inp = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0086C0]/30'
  const pill = (st: string) => st === 'active' ? { bg: '#E6F7EE', fg: '#036B34', label: 'Active' } : st === 'paused' ? { bg: '#FFF3E0', fg: '#9A5B00', label: 'Paused' } : { bg: '#EDEEF2', fg: '#5A5E6B', label: 'Draft' }

  return (
    <div className="min-h-screen bg-[#F5F6FA] p-4 md:p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-white text-[#0086C0] border-[#CDE6F5]">SEQUENCES</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5 flex items-center gap-2"><i className="ti ti-mail-forward text-[#0086C0]" />Outreach Sequences</h1>
          <p className="text-gray-500 text-sm mt-0.5">Multi-step follow-up cadences. Enroll leads from the Lead Prospector.</p>
        </div>
        <button onClick={openNew} className="text-sm px-4 py-2.5 rounded-lg bg-[#0086C0] text-white hover:bg-[#0074a6] font-medium">+ New Sequence</button>
      </div>

      {loading ? <p className="text-gray-400 text-sm">Loading…</p> : seqs.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#ECEEF3] p-12 text-center">
          <i className="ti ti-mail-forward text-4xl text-gray-300" />
          <p className="text-gray-500 mt-2 text-sm">No sequences yet. Create your first follow-up cadence.</p>
          <button onClick={openNew} className="mt-3 text-sm px-4 py-2 rounded-lg bg-[#0086C0] text-white">+ New Sequence</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {seqs.map(s => {
            const p = pill(s.status); const c = counts[s.id] || {}; const nSteps = (stepsBySeq[s.id] || []).length
            const active = c.active || 0, replied = (c.replied || 0) + (c.interested || 0), finished = c.finished || 0
            return (
              <div key={s.id} className="bg-white rounded-xl border border-[#ECEEF3] shadow-sm p-4">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-[#1A1D2E] truncate">{s.name}</h3>
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: p.bg, color: p.fg }}>{p.label}</span>
                    </div>
                    <p className="text-xs text-gray-500 truncate">{s.from_email ? `From ${s.from_email}` : 'No sending address set'} · {nSteps} step{nSteps !== 1 ? 's' : ''} · cap {s.daily_cap}/day</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {s.status !== 'active' ? <button onClick={() => setStatus(s, 'active')} title="Activate" className="w-8 h-8 rounded-lg border border-[#DCEFE3] text-[#00A84F] hover:bg-[#F2FBF6]"><i className="ti ti-player-play text-sm" /></button>
                      : <button onClick={() => setStatus(s, 'paused')} title="Pause" className="w-8 h-8 rounded-lg border border-[#F3E5C0] text-[#9A5B00] hover:bg-[#FFF8E7]"><i className="ti ti-player-pause text-sm" /></button>}
                    <button onClick={() => openEdit(s)} title="Edit" className="w-8 h-8 rounded-lg border border-[#E4E6EE] text-gray-500 hover:text-[#1A1D2E]"><i className="ti ti-pencil text-sm" /></button>
                    <button onClick={() => del(s)} title="Delete" className="w-8 h-8 rounded-lg border border-red-200 text-red-500 hover:bg-red-50"><i className="ti ti-trash text-sm" /></button>
                  </div>
                </div>
                <div className="flex gap-4 mt-3 text-xs">
                  <span><b className="text-[#0086C0] text-base">{active}</b> <span className="text-gray-500">active</span></span>
                  <span><b className="text-[#00A84F] text-base">{replied}</b> <span className="text-gray-500">replied</span></span>
                  <span><b className="text-gray-500 text-base">{finished}</b> <span className="text-gray-500">finished</span></span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(20,24,40,0.4)' }} onClick={close}>
          <div className="w-[640px] max-w-full bg-white h-full overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-[#EEF0F4] px-5 py-3 flex items-center justify-between z-10">
              <h2 className="font-bold text-[#1A1D2E]">{editing ? 'Edit sequence' : 'New sequence'}</h2>
              <div className="flex gap-2">
                <button onClick={close} className="text-sm px-3 py-1.5 rounded-lg border border-[#E4E6EE] text-gray-500">Cancel</button>
                <button onClick={save} disabled={saving} className="text-sm px-4 py-1.5 rounded-lg bg-[#0086C0] text-white">{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><label className="block text-xs text-gray-500 mb-1">Sequence name</label><input value={form.name || ''} onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))} className={inp} placeholder="e.g. Restaurant cold outreach" /></div>
                <div><label className="block text-xs text-gray-500 mb-1">From name</label><input value={form.from_name || ''} onChange={e => setForm((f: any) => ({ ...f, from_name: e.target.value }))} className={inp} /></div>
                <div><label className="block text-xs text-gray-500 mb-1">From email (dedicated mailbox)</label><input value={form.from_email || ''} onChange={e => setForm((f: any) => ({ ...f, from_email: e.target.value }))} className={inp} placeholder="rudy@trybyndgrn.com" /></div>
                <div><label className="block text-xs text-gray-500 mb-1">Reply-to (optional)</label><input value={form.reply_to || ''} onChange={e => setForm((f: any) => ({ ...f, reply_to: e.target.value }))} className={inp} /></div>
                <div><label className="block text-xs text-gray-500 mb-1">Daily cap (per mailbox)</label><input type="number" value={form.daily_cap ?? 40} onChange={e => setForm((f: any) => ({ ...f, daily_cap: e.target.value }))} className={inp} /></div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Send days</label>
                <div className="flex gap-1">{DAYS.map(d => { const on = (form.send_days || []).includes(d); return <button key={d} onClick={() => setForm((f: any) => ({ ...f, send_days: on ? f.send_days.filter((x: string) => x !== d) : [...(f.send_days || []), d] }))} className={`text-xs px-2.5 py-1.5 rounded-md border ${on ? 'bg-[#0086C0] text-white border-[#0086C0]' : 'border-[#E4E6EE] text-gray-500'}`}>{d}</button> })}</div>
              </div>

              <div className="rounded-lg bg-[#FFF8E7] border border-[#F3E5C0] px-3 py-2 text-[11px] text-[#8A6D3B]">
                Sends go out from the <b>From email</b> above. Use a dedicated outreach mailbox on a lookalike domain — never your primary <b>byndgrn.com</b>.
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Steps ({steps.length}/7)</label>
                  <span className="text-[10px] text-gray-400">Variables: {VARS.join('  ')}</span>
                </div>
                <div className="space-y-3">
                  {steps.map((st, i) => (
                    <div key={i} className="border border-[#ECEEF3] rounded-lg p-3 bg-[#FBFCFE]">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-6 h-6 rounded-full bg-[#0086C0] text-white text-xs font-bold flex items-center justify-center">{i + 1}</span>
                        <span className="text-xs text-gray-500">{i === 0 ? 'Sent on enrollment' : <>Wait <input type="number" value={st.delay_days} onChange={e => updateStep(i, { delay_days: Number(e.target.value) })} className="w-12 border border-[#E4E6EE] rounded px-1 py-0.5 text-xs mx-1" /> day(s) after previous</>}</span>
                        <button onClick={() => removeStep(i)} className="ml-auto text-gray-400 hover:text-red-600"><i className="ti ti-x text-sm" /></button>
                      </div>
                      <input value={st.subject} onChange={e => updateStep(i, { subject: e.target.value })} placeholder="Subject" className={inp + ' mb-2'} />
                      <textarea rows={4} value={st.body} onChange={e => updateStep(i, { body: e.target.value })} placeholder="Email body…" className={inp + ' resize-y font-mono text-xs'} />
                    </div>
                  ))}
                </div>
                {steps.length < 7 && <button onClick={addStep} className="mt-2 text-xs text-[#0086C0] font-semibold">+ Add step (up to 7)</button>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
