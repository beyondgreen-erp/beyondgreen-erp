'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Step { id?: string; step_number: number; delay_days: number; subject: string; body: string }
interface Sequence {
  id: string; name: string; description: string | null; status: string
  from_email: string | null; from_name: string | null; reply_to: string | null; daily_cap: number
  send_days: string[] | null; created_at: string; review_before_send?: boolean
}
interface Enrollment {
  id: string; sequence_id: string; customer_id: string; status: string; current_step: number
  next_send_at: string | null; last_step_sent_at: string | null; enrolled_at: string | null
}
interface Send {
  id: string; enrollment_id: string; sequence_id: string; customer_id: string
  step_number: number; to_email: string; subject: string; status: string; sent_at: string | null; error: string | null
}
interface Mailbox { email: string; connected_at?: string; is_protected?: boolean; is_outreach_default?: boolean }

const VARS = ['{{company}}', '{{contact}}', '{{first_name}}', '{{city}}', '{{state}}', '{{industry}}', '{{website}}', '{{my_name}}']
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DEFAULT_STEPS: Step[] = [
  { step_number: 1, delay_days: 0, subject: 'Compostable packaging for {{company}}', body: 'Hi {{first_name}},\n\nI came across {{company}} and thought our certified-compostable cutlery and packaging could be a great fit. Would you be open to a quick look?\n\nBest,\n{{my_name}}\nbeyondGREEN' },
  { step_number: 2, delay_days: 2, subject: 'Re: Compostable packaging for {{company}}', body: 'Hi {{first_name}},\n\nJust floating this back to the top â happy to send samples so your team can see the quality first-hand.\n\n{{my_name}}' },
  { step_number: 3, delay_days: 3, subject: 'A quick idea for {{company}}', body: 'Hi {{first_name}},\n\nMany {{industry}} businesses are switching to compostable to meet customer demand and local mandates. Worth a 10-minute call?\n\n{{my_name}}' },
  { step_number: 4, delay_days: 4, subject: 'Still worth a look?', body: 'Hi {{first_name}},\n\nNo worries if the timing is off â should I circle back next quarter, or is there a better person at {{company}} to talk to?\n\n{{my_name}}' },
]

const STATUS_GROUPS = [
  { key: 'active', title: 'Active', color: '#00C875', dotBg: '#E6F7EE', dotFg: '#036B34' },
  { key: 'paused', title: 'Paused', color: '#FDAB3D', dotBg: '#FFF3E0', dotFg: '#9A5B00' },
  { key: 'draft',  title: 'Draft',  color: '#9699A6', dotBg: '#EDEEF2', dotFg: '#5A5E6B' },
]
const ENR_COLOR: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  finished: 'bg-gray-100 text-gray-600',
  replied: 'bg-blue-100 text-blue-700',
  interested: 'bg-emerald-100 text-emerald-700',
  stopped: 'bg-amber-100 text-amber-700',
  dnc: 'bg-red-100 text-red-700',
}
const SEND_COLOR: Record<string, string> = {
  sent: 'bg-emerald-100 text-emerald-700',
  queued: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-700',
}

const fmtD = (d?: string | null) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'â'
const fmtDT = (d?: string | null) => d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'â'

async function fetchAllPaginated<T>(query: (from: number, to: number) => Promise<{ data: T[] | null }>) {
  const PAGE = 1000; const all: T[] = []; let from = 0
  while (true) {
    const { data } = await query(from, from + PAGE - 1)
    if (!data || !data.length) break
    all.push(...data)
    if (data.length < PAGE) break
    from += PAGE
    if (from > 200000) break // hard safety
  }
  return all
}

export default function SequencesPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [seqs, setSeqs] = useState<Sequence[]>([])
  const [stepsBySeq, setStepsBySeq] = useState<Record<string, Step[]>>({})
  const [enrollmentsBySeq, setEnrollmentsBySeq] = useState<Record<string, Enrollment[]>>({})
  const [customerNames, setCustomerNames] = useState<Record<string, { name: string; email: string }>>({})
  const [sendsBySeq, setSendsBySeq] = useState<Record<string, Send[]>>({})
  const [sentTodayBySeq, setSentTodayBySeq] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [userEmail, setUserEmail] = useState('')
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([])
  const [allowProtected, setAllowProtected] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const [detail, setDetail] = useState<Sequence | null>(null)
  const [detailTab, setDetailTab] = useState<'enrollments' | 'sends'>('enrollments')
  const [pendingCount, setPendingCount] = useState(0)

  const [editing, setEditing] = useState<Sequence | null>(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<any>({})
  const [steps, setSteps] = useState<Step[]>([])
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState('')

  useEffect(() => { sb.auth.getUser().then(({ data }) => setUserEmail(data.user?.email || '')) }, [sb])
  useEffect(() => { fetch('/api/outlook/status').then(r => r.json()).then(d => setMailboxes(d.mailboxes || [])).catch(() => {}) }, [])

  const outreachDefault = useMemo(() => mailboxes.find(m => m.is_outreach_default) || mailboxes.find(m => !m.is_protected), [mailboxes])
  const selectedMailbox = useMemo(() => mailboxes.find(m => m.email === form.from_email), [mailboxes, form.from_email])
  const protectedChosen = !!selectedMailbox?.is_protected

  async function scanReplies() {
    setRunning('Scanning repliesâ¦')
    try { const r = await fetch('/api/leads/reply-scan'); const j = await r.json(); alert(j.message || j.error || 'Done') } catch { alert('Reply scan failed.') }
    setRunning(''); load()
  }
  async function runNow() {
    setRunning('Sending due emailsâ¦')
    try { const r = await fetch('/api/leads/sequence-run'); const j = await r.json(); alert(j.message || j.error || 'Done') } catch { alert('Send run failed.') }
    setRunning(''); load()
  }

  const load = useCallback(async () => {
    setLoading(true)
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
    const [{ data: s }, { data: st }, en, { data: sends }] = await Promise.all([
      sb.from('sequences').select('*').order('created_at', { ascending: false }),
      sb.from('sequence_steps').select('*').order('step_number'),
      fetchAllPaginated<Enrollment>((from, to) => sb.from('sequence_enrollments').select('*').range(from, to)),
      sb.from('sequence_sends').select('id,enrollment_id,sequence_id,customer_id,step_number,to_email,subject,status,sent_at,error').order('sent_at', { ascending: false, nullsFirst: false }).limit(500),
    ])
    setSeqs((s as Sequence[]) || [])
    const bs: Record<string, Step[]> = {}
    ;((st as Step[]) || []).forEach((x: any) => { (bs[x.sequence_id] ||= []).push(x) })
    setStepsBySeq(bs)

    const enrByS: Record<string, Enrollment[]> = {}
    const custIds = new Set<string>()
    ;((en as Enrollment[]) || []).forEach(e => { (enrByS[e.sequence_id] ||= []).push(e); custIds.add(e.customer_id) })
    setEnrollmentsBySeq(enrByS)

    if (custIds.size) {
      const idsArr = [...custIds]
      const CHUNK = 500
      const m: Record<string, { name: string; email: string }> = {}
      for (let i = 0; i < idsArr.length; i += CHUNK) {
        const batch = idsArr.slice(i, i + CHUNK)
        const { data: cs } = await sb.from('customers').select('id,company_name,contact_name,email').in('id', batch)
        ;((cs as any[]) || []).forEach(c => { m[c.id] = { name: c.company_name || c.contact_name || '(no name)', email: c.email || '' } })
      }
      setCustomerNames(m)
    }

    const sendsBy: Record<string, Send[]> = {}
    const todayCount: Record<string, number> = {}
    ;((sends as Send[]) || []).forEach(sd => {
      (sendsBy[sd.sequence_id] ||= []).push(sd)
      if (sd.status === 'sent' && sd.sent_at && sd.sent_at >= startOfDay.toISOString()) todayCount[sd.sequence_id] = (todayCount[sd.sequence_id] || 0) + 1
    })
    setSendsBySeq(sendsBy)
    setSentTodayBySeq(todayCount)
    const { count: pending } = await sb.from('sequence_sends').select('id', { count: 'exact', head: true }).eq('status', 'review')
    setPendingCount(pending || 0)
    setLoading(false)
  }, [sb])
  useEffect(() => { load() }, [load])

  function openNew() {
    setEditing(null); setAllowProtected(false)
    setForm({ name: '', description: '', from_name: 'Rudy Patel', from_email: outreachDefault?.email || '', reply_to: '', daily_cap: 40, send_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], status: 'draft', review_before_send: true })
    setSteps(DEFAULT_STEPS.map(s => ({ ...s })))
    setOpen(true)
  }
  function openEdit(s: Sequence) {
    setEditing(s); setForm({ ...s, send_days: s.send_days || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] })
    setAllowProtected(!!mailboxes.find(m => m.email === s.from_email)?.is_protected)
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
    if (!form.from_email) { alert('Choose a sending mailbox (From email).'); return }
    if (!mailboxes.find(m => m.email === form.from_email)) { alert('That sending mailbox isnât connected. Connect it in Settings â Email first.'); return }
    if (protectedChosen && !allowProtected) { alert('That mailbox is marked as protected. Tick the confirm box if you really want to send from it.'); return }
    setSaving(true)
    const payload = {
      name: form.name.trim(), description: form.description || null, from_email: form.from_email || null,
      from_name: form.from_name || null, reply_to: form.reply_to || null, daily_cap: Number(form.daily_cap) || 40,
      send_days: form.send_days, status: form.status || 'draft',
      review_before_send: form.review_before_send !== false, // default ON
      updated_at: new Date().toISOString(),
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

  async function stopEnrollment(enr: Enrollment) {
    if (!confirm('Stop this enrollment? No further steps will be sent.')) return
    await sb.from('sequence_enrollments').update({ status: 'stopped', updated_at: new Date().toISOString() }).eq('id', enr.id)
    load()
  }
  async function pauseLead(customerId: string) {
    const reason = prompt('Reason for pausing this lead? (e.g. "not now", "wrong contact", "asked to stop")', 'not now')
    if (reason === null) return
    await fetch('/api/leads/sequence-pause-lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_ids: [customerId], reason }) })
    load()
  }
  async function unpauseLead(customerId: string) {
    if (!confirm('Unpause this lead and resume their sequences?')) return
    await fetch('/api/leads/sequence-unpause-lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_ids: [customerId] }) })
    load()
  }
  async function sendNext(enr: Enrollment) {
    // Prefer approving an existing pending review send. Otherwise force-run
    // this sequence bypassing the send-day check (via sequence_id param).
    setRunning('Sendingâ¦')
    try {
      const { data: pending } = await sb.from('sequence_sends').select('id').eq('enrollment_id', enr.id).eq('status', 'review').limit(1)
      if (pending && pending.length) {
        const r = await fetch('/api/leads/sequence-approve', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ send_ids: [pending[0].id] }),
        })
        const j = await r.json(); alert(j.message || j.error || 'Sent.')
      } else {
        await sb.from('sequence_enrollments').update({ next_send_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', enr.id)
        const r = await fetch(`/api/leads/sequence-run?sequence_id=${encodeURIComponent(enr.sequence_id)}`)
        const j = await r.json(); alert(j.message || j.error || 'Sent.')
      }
    } catch { alert('Send failed.') }
    setRunning(''); load()
  }

  const grouped = useMemo(() => {
    const g: Record<string, Sequence[]> = { active: [], paused: [], draft: [] }
    seqs.forEach(s => { const k = s.status === 'active' ? 'active' : s.status === 'paused' ? 'paused' : 'draft'; g[k].push(s) })
    return g
  }, [seqs])

  const inp = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0086C0]/30'

  return (
    <div className="min-h-screen mon-page p-4 md:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div>
          <span className="mon-tag t-blue">ð§ CRM Â· Sequences</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">Outreach Sequences</h1>
          <p className="text-gray-500 text-sm mt-0.5">Multi-step follow-up cadences. Sends run every 10 min via cron â no manual trigger needed.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {running && <span className="text-xs text-gray-500">{running}</span>}
          <Link href="/sales/sequences/review" className={`text-sm px-3 py-2 rounded-lg font-semibold flex items-center gap-1.5 ${pendingCount ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 border border-amber-200' : 'border border-[#E4E6EE] text-gray-600 hover:text-[#1A1D2E]'}`}>
            ð¥ Review queue{pendingCount ? ` (${pendingCount})` : ''}
          </Link>
          <Link href="/settings/email-signature" className="text-sm px-3 py-2 rounded-lg border border-[#E4E6EE] text-gray-600 hover:text-[#1A1D2E]">Signature</Link>
          <button onClick={scanReplies} disabled={!!running} className="text-sm px-3 py-2 rounded-lg border border-[#E4E6EE] text-gray-600 hover:text-[#1A1D2E] disabled:opacity-50">Scan replies</button>
          <button onClick={runNow} disabled={!!running} className="text-sm px-3 py-2 rounded-lg border border-[#E4E6EE] text-gray-600 hover:text-[#1A1D2E] disabled:opacity-50">Send due now</button>
          <button onClick={openNew} className="text-sm px-4 py-2 rounded-lg bg-[#3B6FE0] text-white hover:bg-[#2E5CC7] font-semibold">+ New Sequence</button>
        </div>
      </div>

      {loading ? <p className="text-gray-400 text-sm">Loadingâ¦</p> : (
        <div className="space-y-4">
          {STATUS_GROUPS.map(group => {
            const list = grouped[group.key] || []
            const isCol = collapsed[group.key]
            return (
              <div key={group.key} className="bg-white rounded-xl overflow-hidden shadow-sm border border-[#ECEEF3]">
                <div className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none" style={{ background: group.color + '14', borderLeft: '5px solid ' + group.color }} onClick={() => setCollapsed(c => ({ ...c, [group.key]: !c[group.key] }))}>
                  <span className="text-[10px]" style={{ color: group.color, display: 'inline-block', transform: isCol ? 'none' : 'rotate(90deg)' }}>&#9654;</span>
                  <span className="font-bold text-sm" style={{ color: group.color }}>{group.title}</span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: group.color + '26', color: group.color }}>{list.length}</span>
                </div>
                {!isCol && (
                  <div className="overflow-x-auto">
                    {list.length === 0 ? (
                      <p className="text-center text-xs text-gray-400 py-6">No sequences in this state.</p>
                    ) : (
                      <table className="w-full text-sm min-w-[1000px]">
                        <thead>
                          <tr className="text-[11px] uppercase text-gray-400 border-b border-[#EEF0F4]">
                            <th className="text-left px-4 py-2 font-semibold">Name</th>
                            <th className="text-left px-3 py-2 font-semibold w-[220px]">From / Steps</th>
                            <th className="text-right px-3 py-2 font-semibold w-[110px]">Enrolled</th>
                            <th className="text-right px-3 py-2 font-semibold w-[110px]">Sent today</th>
                            <th className="text-right px-3 py-2 font-semibold w-[100px]">Replied</th>
                            <th className="text-right px-3 py-2 font-semibold w-[100px]">Finished</th>
                            <th className="text-right px-3 py-2 font-semibold w-[130px]"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.map((s, i) => {
                            const stepsN = (stepsBySeq[s.id] || []).length
                            const enr = enrollmentsBySeq[s.id] || []
                            const active = enr.filter(e => e.status === 'active').length
                            const replied = enr.filter(e => e.status === 'replied' || e.status === 'interested').length
                            const finished = enr.filter(e => e.status === 'finished').length
                            const todayCount = sentTodayBySeq[s.id] || 0
                            return (
                              <tr key={s.id} className={`cursor-pointer hover:bg-[#F2F6FF] ${i % 2 ? 'bg-[#F8FAFC]' : 'bg-white'}`} onClick={() => { setDetail(s); setDetailTab('enrollments') }}>
                                <td className="px-4 py-2.5">
                                  <p className="font-semibold text-[#1A1D2E]">{s.name}</p>
                                  {s.description && <p className="text-[11px] text-gray-400 truncate max-w-[420px]">{s.description}</p>}
                                </td>
                                <td className="px-3 py-2.5 text-xs text-gray-500">
                                  <p className="truncate max-w-[220px]">{s.from_email || 'no from set'}</p>
                                  <p className="text-[11px] text-gray-400">{stepsN} step{stepsN !== 1 ? 's' : ''} Â· cap {s.daily_cap}/day</p>
                                </td>
                                <td className="px-3 py-2.5 text-right font-bold text-indigo-600">{active}</td>
                                <td className="px-3 py-2.5 text-right"><span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${todayCount ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{todayCount}</span></td>
                                <td className="px-3 py-2.5 text-right text-emerald-600 font-semibold">{replied}</td>
                                <td className="px-3 py-2.5 text-right text-gray-500">{finished}</td>
                                <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                                  <div className="flex justify-end gap-1">
                                    {s.status !== 'active' ? <button onClick={() => setStatus(s, 'active')} title="Activate" className="w-7 h-7 rounded-lg border border-[#DCEFE3] text-[#00A84F] hover:bg-[#F2FBF6] text-sm">â¶</button>
                                      : <button onClick={() => setStatus(s, 'paused')} title="Pause" className="w-7 h-7 rounded-lg border border-[#F3E5C0] text-[#9A5B00] hover:bg-[#FFF8E7] text-sm">â¸</button>}
                                    <button onClick={() => openEdit(s)} title="Edit" className="w-7 h-7 rounded-lg border border-[#E4E6EE] text-gray-500 hover:text-[#1A1D2E] text-sm">â</button>
                                    <button onClick={() => del(s)} title="Delete" className="w-7 h-7 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 text-sm">ð</button>
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Sequence detail modal */}
      {detail && (() => {
        const enr = (enrollmentsBySeq[detail.id] || []).sort((a, b) => (b.enrolled_at || '').localeCompare(a.enrolled_at || ''))
        const sends = (sendsBySeq[detail.id] || [])
        const stepsN = (stepsBySeq[detail.id] || []).length
        return (
          <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(20,24,40,0.4)' }} onClick={() => setDetail(null)}>
            <div className="w-[880px] max-w-full bg-white h-full overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="sticky top-0 bg-white border-b border-[#EEF0F4] px-5 py-3 flex items-center justify-between z-10">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase font-bold text-gray-400">Sequence</p>
                  <h2 className="font-bold text-[#1A1D2E] truncate">{detail.name}</h2>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openEdit(detail)} className="text-xs px-3 py-1.5 rounded-lg border border-[#E4E6EE] text-gray-600 hover:text-[#1A1D2E]">Edit</button>
                  <button onClick={() => setDetail(null)} className="text-xs px-3 py-1.5 rounded-lg border border-[#E4E6EE] text-gray-500">Close</button>
                </div>
              </div>
              <div className="px-5 py-4 grid grid-cols-4 gap-3 border-b border-[#EEF0F4] text-xs">
                <div><p className="text-gray-400 uppercase text-[10px]">From</p><p className="font-semibold truncate">{detail.from_email || 'â'}</p></div>
                <div><p className="text-gray-400 uppercase text-[10px]">Steps</p><p className="font-semibold">{stepsN}</p></div>
                <div><p className="text-gray-400 uppercase text-[10px]">Cap</p><p className="font-semibold">{detail.daily_cap}/day</p></div>
                <div><p className="text-gray-400 uppercase text-[10px]">Send days</p><p className="font-semibold truncate">{(detail.send_days || []).join(', ') || 'â'}</p></div>
              </div>
              <div className="flex gap-1 border-b border-[#EEF0F4] px-5">
                <button onClick={() => setDetailTab('enrollments')} className={`text-xs px-3 py-2 font-semibold ${detailTab === 'enrollments' ? 'text-[#3B6FE0] border-b-2 border-[#3B6FE0]' : 'text-gray-400'}`}>Enrolled leads ({enr.length})</button>
                <button onClick={() => setDetailTab('sends')} className={`text-xs px-3 py-2 font-semibold ${detailTab === 'sends' ? 'text-[#3B6FE0] border-b-2 border-[#3B6FE0]' : 'text-gray-400'}`}>Send history ({sends.length})</button>
              </div>
              {detailTab === 'enrollments' ? (
                <div className="p-5">
                  {enr.length === 0 ? <p className="text-center text-xs text-gray-400 py-6">Nobody enrolled yet. Add leads from the Leads page.</p> : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-[10px] uppercase text-gray-400 border-b border-[#EEF0F4]">
                          <th className="text-left py-2">Lead</th>
                          <th className="text-left py-2">Status</th>
                          <th className="text-left py-2">Step</th>
                          <th className="text-left py-2">Last sent</th>
                          <th className="text-left py-2">Next send</th>
                          <th className="text-right py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {enr.map(e => {
                          const cn = customerNames[e.customer_id]
                          return (
                            <tr key={e.id} className="border-b border-[#EEF0F4] last:border-0">
                              <td className="py-2">
                                <Link href={`/sales/leads?item=${e.customer_id}`} className="text-[#3B6FE0] font-semibold hover:underline">{cn?.name || '(unknown)'}</Link>
                                {cn?.email && <p className="text-[10px] text-gray-400 truncate max-w-[220px]">{cn.email}</p>}
                              </td>
                              <td className="py-2"><span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${ENR_COLOR[e.status] || 'bg-gray-100 text-gray-500'}`}>{e.status}</span></td>
                              <td className="py-2 text-gray-600">{e.current_step + 1} / {stepsN}</td>
                              <td className="py-2 text-gray-500">{fmtD(e.last_step_sent_at)}</td>
                              <td className="py-2 text-gray-500">{fmtDT(e.next_send_at)}</td>
                              <td className="py-2 text-right">
                                <div className="flex gap-1 justify-end">
                                  {e.status === 'active' && (
                                    <>
                                      <button onClick={() => sendNext(e)} title="Send next step now" className="text-[10px] px-2 py-0.5 rounded border border-emerald-200 text-emerald-600 hover:bg-emerald-50">Send now</button>
                                      <button onClick={() => pauseLead(e.customer_id)} title="Pause lead (stops all their sequences)" className="text-[10px] px-2 py-0.5 rounded border border-amber-200 text-amber-600 hover:bg-amber-50">â¸ Pause lead</button>
                                      <button onClick={() => stopEnrollment(e)} title="Stop just this sequence" className="text-[10px] px-2 py-0.5 rounded border border-red-200 text-red-500 hover:bg-red-50">Stop</button>
                                    </>
                                  )}
                                  {e.status === 'paused' && (
                                    <button onClick={() => unpauseLead(e.customer_id)} title="Unpause lead (resumes their sequences)" className="text-[10px] px-2 py-0.5 rounded border border-emerald-200 text-emerald-600 hover:bg-emerald-50">â¶ Unpause</button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              ) : (
                <div className="p-5">
                  {sends.length === 0 ? <p className="text-center text-xs text-gray-400 py-6">No sends yet.</p> : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-[10px] uppercase text-gray-400 border-b border-[#EEF0F4]">
                          <th className="text-left py-2">When</th>
                          <th className="text-left py-2">Status</th>
                          <th className="text-left py-2">Step</th>
                          <th className="text-left py-2">To</th>
                          <th className="text-left py-2">Subject</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sends.map(sd => (
                          <tr key={sd.id} className="border-b border-[#EEF0F4] last:border-0">
                            <td className="py-2 text-gray-500 whitespace-nowrap">{fmtDT(sd.sent_at)}</td>
                            <td className="py-2"><span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${SEND_COLOR[sd.status] || 'bg-gray-100 text-gray-500'}`}>{sd.status}</span>{sd.error && <p className="text-[10px] text-red-500 mt-0.5">{sd.error}</p>}</td>
                            <td className="py-2">#{sd.step_number}</td>
                            <td className="py-2 text-gray-500 truncate max-w-[180px]">{sd.to_email}</td>
                            <td className="py-2 truncate max-w-[280px]">{sd.subject}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* Edit / New sequence sidebar */}
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(20,24,40,0.4)' }} onClick={close}>
          <div className="w-[640px] max-w-full bg-white h-full overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-[#EEF0F4] px-5 py-3 flex items-center justify-between z-10">
              <h2 className="font-bold text-[#1A1D2E]">{editing ? 'Edit sequence' : 'New sequence'}</h2>
              <div className="flex gap-2">
                <button onClick={close} className="text-sm px-3 py-1.5 rounded-lg border border-[#E4E6EE] text-gray-500">Cancel</button>
                <button onClick={save} disabled={saving} className="text-sm px-4 py-1.5 rounded-lg bg-[#3B6FE0] text-white">{saving ? 'Savingâ¦' : 'Save'}</button>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><label className="block text-xs text-gray-500 mb-1">Sequence name</label><input value={form.name || ''} onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))} className={inp} placeholder="e.g. Restaurant cold outreach" /></div>
                <div><label className="block text-xs text-gray-500 mb-1">From name</label><input value={form.from_name || ''} onChange={e => setForm((f: any) => ({ ...f, from_name: e.target.value }))} className={inp} /></div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Send from mailbox</label>
                  {mailboxes.length === 0 ? (
                    <div className="text-xs rounded-lg bg-[#FCE8EC] text-[#A11B30] border border-[#F3C6CF] px-3 py-2">No mailboxes connected. Connect one in <b>Settings â Email</b> first.</div>
                  ) : (
                    <select value={form.from_email || ''} onChange={e => { setForm((f: any) => ({ ...f, from_email: e.target.value })); setAllowProtected(false) }} className={inp}>
                      <option value="">â choose a mailbox â</option>
                      {mailboxes.map(m => (
                        <option key={m.email} value={m.email}>
                          {m.email}{m.is_outreach_default ? '  â outreach (recommended)' : ''}{m.is_protected ? '  â  primary â not for cold outreach' : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div><label className="block text-xs text-gray-500 mb-1">Reply-to (optional)</label><input value={form.reply_to || ''} onChange={e => setForm((f: any) => ({ ...f, reply_to: e.target.value }))} className={inp} /></div>
                <div><label className="block text-xs text-gray-500 mb-1">Daily cap</label><input type="number" value={form.daily_cap ?? 40} onChange={e => setForm((f: any) => ({ ...f, daily_cap: e.target.value }))} className={inp} /></div>
              </div>

              {protectedChosen && (
                <div className="rounded-lg bg-[#FCE8EC] border-2 border-[#E0244B] px-3 py-2.5">
                  <p className="text-sm font-bold text-[#A11B30]">â  {form.from_email} is your primary business mailbox</p>
                  <p className="text-[12px] text-[#A11B30] mt-0.5">Sending cold outreach from here can hurt deliverability. Use your dedicated outreach mailbox instead.</p>
                  <label className="flex items-center gap-2 mt-2 text-[12px] text-[#A11B30] font-medium">
                    <input type="checkbox" checked={allowProtected} onChange={e => setAllowProtected(e.target.checked)} />
                    Send from this mailbox anyway.
                  </label>
                </div>
              )}

              <div>
                <label className="block text-xs text-gray-500 mb-1">Send days</label>
                <div className="flex gap-1">{DAYS.map(d => { const on = (form.send_days || []).includes(d); return <button key={d} onClick={() => setForm((f: any) => ({ ...f, send_days: on ? f.send_days.filter((x: string) => x !== d) : [...(f.send_days || []), d] }))} className={`text-xs px-2.5 py-1.5 rounded-md border ${on ? 'bg-[#3B6FE0] text-white border-[#3B6FE0]' : 'border-[#E4E6EE] text-gray-500'}`}>{d}</button> })}</div>
              </div>

              <div className="rounded-lg border border-[#E4E6EE] p-3 bg-[#F8FAFF]">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={form.review_before_send !== false} onChange={e => setForm((f: any) => ({ ...f, review_before_send: e.target.checked }))} className="mt-0.5 accent-[#3B6FE0]" />
                  <div>
                    <p className="text-sm font-semibold text-[#1A1D2E]">Require review before sending</p>
                    <p className="text-xs text-gray-500 mt-0.5">Each email waits in the <Link href="/sales/sequences/review" className="text-[#3B6FE0] underline">Review queue</Link> for you to preview per recipient. Fix a name once and it re-renders every pending copy.</p>
                  </div>
                </label>
              </div>
              <p className="text-[11px] text-gray-500">Your <Link href="/settings/email-signature" className="text-[#3B6FE0] underline">global signature</Link> is auto-appended to every email â you don't paste it into the step body.</p>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Steps ({steps.length}/7)</label>
                  <span className="text-[10px] text-gray-400">Variables: {VARS.join('  ')}</span>
                </div>
                <div className="space-y-3">
                  {steps.map((st, i) => (
                    <div key={i} className="border border-[#ECEEF3] rounded-lg p-3 bg-[#FBFCFE]">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-6 h-6 rounded-full bg-[#3B6FE0] text-white text-xs font-bold flex items-center justify-center">{i + 1}</span>
                        <span className="text-xs text-gray-500">{i === 0 ? 'Sent on enrollment' : <>Wait <input type="number" value={st.delay_days} onChange={e => updateStep(i, { delay_days: Number(e.target.value) })} className="w-12 border border-[#E4E6EE] rounded px-1 py-0.5 text-xs mx-1" /> day(s) after previous</>}</span>
                        <button onClick={() => removeStep(i)} className="ml-auto text-gray-400 hover:text-red-600 text-sm">Ã</button>
                      </div>
                      <input value={st.subject} onChange={e => updateStep(i, { subject: e.target.value })} placeholder="Subject" className={inp + ' mb-2'} />
                      <textarea rows={4} value={st.body} onChange={e => updateStep(i, { body: e.target.value })} placeholder="Email bodyâ¦" className={inp + ' resize-y font-mono text-xs'} />
                    </div>
                  ))}
                </div>
                {steps.length < 7 && <button onClick={addStep} className="mt-2 text-xs text-[#3B6FE0] font-semibold">+ Add step (up to 7)</button>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
