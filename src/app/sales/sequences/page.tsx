'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
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
  stop_reason?: string | null
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
  { step_number: 2, delay_days: 2, subject: 'Re: Compostable packaging for {{company}}', body: 'Hi {{first_name}},\n\nJust floating this back to the top — happy to send samples so your team can see the quality first-hand.\n\n{{my_name}}' },
  { step_number: 3, delay_days: 3, subject: 'A quick idea for {{company}}', body: 'Hi {{first_name}},\n\nMany {{industry}} businesses are switching to compostable to meet customer demand and local mandates. Worth a 10-minute call?\n\n{{my_name}}' },
  { step_number: 4, delay_days: 4, subject: 'Still worth a look?', body: 'Hi {{first_name}},\n\nNo worries if the timing is off — should I circle back next quarter, or is there a better person at {{company}} to talk to?\n\n{{my_name}}' },
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

const fmtD = (d?: string | null) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'
const fmtDT = (d?: string | null) => d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

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
  const [detailTab, setDetailTab] = useState<'enrollments' | 'emails' | 'sends'>('enrollments')
  const [pendingCount, setPendingCount] = useState(0)

  const [editing, setEditing] = useState<Sequence | null>(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<any>({})
  const [steps, setSteps] = useState<Step[]>([])
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState('')
  const [enrFilter, setEnrFilter] = useState<'all' | 'bounced' | 'active'>('all')
  const [fixOpen, setFixOpen] = useState<string | null>(null)
  const [fixBusy, setFixBusy] = useState<string | null>(null)
  const [fixSug, setFixSug] = useState<Record<string, any[]>>({})
  const [fixMsg, setFixMsg] = useState<Record<string, string>>({})

  useEffect(() => { sb.auth.getUser().then(({ data }) => setUserEmail(data.user?.email || '')) }, [sb])
  useEffect(() => { fetch('/api/outlook/status').then(r => r.json()).then(d => setMailboxes(d.mailboxes || [])).catch(() => {}) }, [])

  const outreachDefault = useMemo(() => mailboxes.find(m => m.is_outreach_default) || mailboxes.find(m => !m.is_protected), [mailboxes])
  const selectedMailbox = useMemo(() => mailboxes.find(m => m.email === form.from_email), [mailboxes, form.from_email])
  const protectedChosen = !!selectedMailbox?.is_protected

  async function scanReplies() {
    setRunning('Scanning replies…')
    try { const r = await fetch('/api/leads/reply-scan'); const j = await r.json(); alert(j.message || j.error || 'Done') } catch { alert('Reply scan failed.') }
    setRunning(''); load()
  }
  async function runNow() {
    setRunning('Sending due emails…')
    try { const r = await fetch('/api/leads/sequence-run'); const j = await r.json(); alert(j.message || j.error || 'Done') } catch { alert('Send run failed.') }
    setRunning(''); load()
  }

  const load = useCallback(async () => {
    setLoading(true)
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
    const [{ data: s }, { data: st }, { data: en }, { data: sends }] = await Promise.all([
      sb.from('sequences').select('*').order('created_at', { ascending: false }),
      sb.from('sequence_steps').select('*').order('step_number'),
      sb.from('sequence_enrollments').select('*'),
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
      const { data: cs } = await sb.from('customers').select('id,company_name,contact_name,email').in('id', [...custIds])
      const m: Record<string, { name: string; email: string }> = {}
      ;((cs as any[]) || []).forEach(c => { m[c.id] = { name: c.company_name || c.contact_name || '(no name)', email: c.email || '' } })
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
    if (!mailboxes.find(m => m.email === form.from_email)) { alert('That sending mailbox isn’t connected. Connect it in Settings → Email first.'); return }
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
  async function sendNext(enr: Enrollment) {
    // Prefer approving an existing pending review send. Otherwise force-run
    // this sequence bypassing the send-day check (via sequence_id param).
    setRunning('Sending…')
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

  async function blastNextUnsent(seq: Sequence, target = 250) {
    if (!confirm(`Queue the next ${target} unsent emails from "${seq.name}" into the Review queue?\n\nThey will NOT send yet \u2014 they go to the Review queue where you preview and approve them. This bypasses the daily cap.`)) return
    // "Start sequence": make sure it's active before queuing.
    if (seq.status !== 'active') { await sb.from('sequences').update({ status: 'active', updated_at: new Date().toISOString() }).eq('id', seq.id) }
    setRunning(`Queuing ${target}\u2026`)
    try {
      const r = await fetch('/api/leads/sequence-blast', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequence_id: seq.id, limit: target }),
      })
      const j = await r.json()
      setRunning('')
      if (!r.ok) { alert(j.error || 'Queue failed.'); return }
      const more = j.remaining ? ` (${j.remaining} more still available)` : ''
      if (confirm(`${j.queued} email(s) queued to the Review queue${more}.\n\nOpen the Review queue now to preview and send them?`)) {
        window.location.href = '/sales/sequences/review'; return
      }
    } catch { setRunning(''); alert('Queue failed.') }
    load()
  }

  const isBounced = (e: Enrollment) => e.status === 'stopped' && e.stop_reason === 'bounced'
  async function findFixEmail(e: Enrollment) {
    setFixOpen(e.id); setFixBusy(e.id); setFixMsg(m => ({ ...m, [e.id]: '' })); setFixSug(su => ({ ...su, [e.id]: [] }))
    try { await sb.from('customers').update({ is_active: false }).eq('id', e.customer_id) } catch { /* already inactive */ }
    try {
      const r = await fetch('/api/leads/find-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_id: e.customer_id }) })
      const j = await r.json()
      setFixSug(su => ({ ...su, [e.id]: j.suggestions || [] })); setFixMsg(m => ({ ...m, [e.id]: j.message || '' }))
    } catch { setFixMsg(m => ({ ...m, [e.id]: 'Search failed.' })) }
    setFixBusy(null)
  }
  async function applyFixEmail(e: Enrollment, email: string) {
    setFixBusy(e.id)
    try {
      const r = await fetch('/api/leads/apply-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_id: e.customer_id, email }) })
      const j = await r.json()
      if (!r.ok) { setFixMsg(m => ({ ...m, [e.id]: j.error || 'Apply failed.' })); setFixBusy(null); return }
      setFixBusy(null); setFixOpen(null); load()
    } catch { setFixMsg(m => ({ ...m, [e.id]: 'Apply failed.' })); setFixBusy(null) }
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
          <span className="mon-tag t-blue">📧 CRM · Sequences</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">Outreach Sequences</h1>
          <p className="text-gray-500 text-sm mt-0.5">Multi-step follow-up cadences. Sends run every 10 min via cron — no manual trigger needed.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {running && <span className="text-xs text-gray-500">{running}</span>}
          <Link href="/sales/sequences/review" className={`text-sm px-3 py-2 rounded-lg font-semibold flex items-center gap-1.5 ${pendingCount ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 border border-amber-200' : 'border border-[#E4E6EE] text-gray-600 hover:text-[#1A1D2E]'}`}>
            📥 Review queue{pendingCount ? ` (${pendingCount})` : ''}
          </Link>
          <Link href="/settings/email-signature" className="text-sm px-3 py-2 rounded-lg border border-[#E4E6EE] text-gray-600 hover:text-[#1A1D2E]">Signature</Link>
          <button onClick={scanReplies} disabled={!!running} className="text-sm px-3 py-2 rounded-lg border border-[#E4E6EE] text-gray-600 hover:text-[#1A1D2E] disabled:opacity-50">Scan replies</button>
          <button onClick={runNow} disabled={!!running} className="text-sm px-3 py-2 rounded-lg border border-[#E4E6EE] text-gray-600 hover:text-[#1A1D2E] disabled:opacity-50">Send due now</button>
          <button onClick={openNew} className="text-sm px-4 py-2 rounded-lg bg-[#3B6FE0] text-white hover:bg-[#2E5CC7] font-semibold">+ New Sequence</button>
        </div>
      </div>

      {loading ? <p className="text-gray-400 text-sm">Loading…</p> : (
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
                                  <p className="text-[11px] text-gray-400">{stepsN} step{stepsN !== 1 ? 's' : ''} · cap {s.daily_cap}/day</p>
                                </td>
                                <td className="px-3 py-2.5 text-right font-bold text-indigo-600">{active}</td>
                                <td className="px-3 py-2.5 text-right"><span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${todayCount ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{todayCount}</span></td>
                                <td className="px-3 py-2.5 text-right text-emerald-600 font-semibold">{replied}</td>
                                <td className="px-3 py-2.5 text-right text-gray-500">{finished}</td>
                                <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                                  <div className="flex justify-end gap-1">
                                    {s.status !== 'active' ? <button onClick={() => setStatus(s, 'active')} title="Activate" className="w-7 h-7 rounded-lg border border-[#DCEFE3] text-[#00A84F] hover:bg-[#F2FBF6] text-sm">▶</button>
                                      : <button onClick={() => setStatus(s, 'paused')} title="Pause" className="w-7 h-7 rounded-lg border border-[#F3E5C0] text-[#9A5B00] hover:bg-[#FFF8E7] text-sm">⏸</button>}
                                    <button onClick={() => openEdit(s)} title="Edit" className="w-7 h-7 rounded-lg border border-[#E4E6EE] text-gray-500 hover:text-[#1A1D2E] text-sm">✎</button>
                                    <button onClick={() => del(s)} title="Delete" className="w-7 h-7 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 text-sm">🗑</button>
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
        const bouncedCount = enr.filter(isBounced).length
        const activeCount = enr.filter(e => e.status === 'active').length
        const enrShown = enrFilter === 'bounced' ? enr.filter(isBounced) : enrFilter === 'active' ? enr.filter(e => e.status === 'active') : enr
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
                  <button onClick={() => blastNextUnsent(detail, 250)} disabled={!!running} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50">{running || 'Send next 250 to review'}</button>
                  <button onClick={() => openEdit(detail)} className="text-xs px-3 py-1.5 rounded-lg border border-[#E4E6EE] text-gray-600 hover:text-[#1A1D2E]">Edit</button>
                  <button onClick={() => setDetail(null)} className="text-xs px-3 py-1.5 rounded-lg border border-[#E4E6EE] text-gray-500">Close</button>
                </div>
              </div>
              <div className="px-5 py-4 grid grid-cols-4 gap-3 border-b border-[#EEF0F4] text-xs">
                <div><p className="text-gray-400 uppercase text-[10px]">From</p><p className="font-semibold truncate">{detail.from_email || '—'}</p></div>
                <div><p className="text-gray-400 uppercase text-[10px]">Steps</p><p className="font-semibold">{stepsN}</p></div>
                <div><p className="text-gray-400 uppercase text-[10px]">Cap</p><p className="font-semibold">{detail.daily_cap}/day</p></div>
                <div><p className="text-gray-400 uppercase text-[10px]">Send days</p><p className="font-semibold truncate">{(detail.send_days || []).join(', ') || '—'}</p></div>
              </div>
              <div className="flex gap-1 border-b border-[#EEF0F4] px-5">
                <button onClick={() => setDetailTab('enrollments')} className={`text-xs px-3 py-2 font-semibold ${detailTab === 'enrollments' ? 'text-[#3B6FE0] border-b-2 border-[#3B6FE0]' : 'text-gray-400'}`}>Enrolled leads ({enr.length})</button>
                <button onClick={() => setDetailTab('emails')} className={`text-xs px-3 py-2 font-semibold ${detailTab === 'emails' ? 'text-[#3B6FE0] border-b-2 border-[#3B6FE0]' : 'text-gray-400'}`}>Emails ({(stepsBySeq[detail.id] || []).length})</button>
                <button onClick={() => setDetailTab('sends')} className={`text-xs px-3 py-2 font-semibold ${detailTab === 'sends' ? 'text-[#3B6FE0] border-b-2 border-[#3B6FE0]' : 'text-gray-400'}`}>Send history ({sends.length})</button>
              </div>
              {detailTab === 'enrollments' ? (
                <div className="p-5">
                  {enr.length === 0 ? <p className="text-center text-xs text-gray-400 py-6">Nobody enrolled yet. Add leads from the Leads page.</p> : (
                    <>
                    <div className="flex items-center gap-1.5 mb-2.5">
                      <button onClick={() => setEnrFilter('all')} className={`text-[11px] px-2 py-1 rounded-full font-semibold ${enrFilter === 'all' ? 'bg-[#3B6FE0] text-white' : 'bg-gray-100 text-gray-600'}`}>All ({enr.length})</button>
                      <button onClick={() => setEnrFilter('active')} className={`text-[11px] px-2 py-1 rounded-full font-semibold ${enrFilter === 'active' ? 'bg-[#3B6FE0] text-white' : 'bg-gray-100 text-gray-600'}`}>Active ({activeCount})</button>
                      <button onClick={() => setEnrFilter('bounced')} className={`text-[11px] px-2 py-1 rounded-full font-semibold ${enrFilter === 'bounced' ? 'bg-red-600 text-white' : 'bg-red-50 text-red-600'}`}>Bounced ({bouncedCount})</button>
                      {enrFilter === 'bounced' && bouncedCount > 0 && <span className="text-[11px] text-gray-400 ml-1">Click &ldquo;Fix email&rdquo; to find a working address and resend email 1.</span>}
                    </div>
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
                        {enrShown.map(e => {
                          const cn = customerNames[e.customer_id]
                          return (
                            <Fragment key={e.id}>
                            <tr className="border-b border-[#EEF0F4] last:border-0">
                              <td className="py-2">
                                <Link href={`/sales/leads?item=${e.customer_id}`} className="text-[#3B6FE0] font-semibold hover:underline">{cn?.name || '(unknown)'}</Link>
                                {cn?.email && <p className="text-[10px] text-gray-400 truncate max-w-[220px]">{cn.email}</p>}
                              </td>
                              <td className="py-2">{isBounced(e)
                                ? <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 bg-red-100 text-red-700">Bounced</span>
                                : <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${ENR_COLOR[e.status] || 'bg-gray-100 text-gray-500'}`}>{e.status}</span>}</td>
                              <td className="py-2 text-gray-600">{e.current_step + 1} / {stepsN}</td>
                              <td className="py-2 text-gray-500">{fmtD(e.last_step_sent_at)}</td>
                              <td className="py-2 text-gray-500">{fmtDT(e.next_send_at)}</td>
                              <td className="py-2 text-right">
                                {e.status === 'active' && (
                                  <div className="flex gap-1 justify-end">
                                    <button onClick={() => sendNext(e)} title="Send next step now" className="text-[10px] px-2 py-0.5 rounded border border-emerald-200 text-emerald-600 hover:bg-emerald-50">Send now</button>
                                    <button onClick={() => stopEnrollment(e)} title="Stop" className="text-[10px] px-2 py-0.5 rounded border border-red-200 text-red-500 hover:bg-red-50">Stop</button>
                                  </div>
                                )}
                                {isBounced(e) && (
                                  <button onClick={() => findFixEmail(e)} disabled={fixBusy === e.id} title="Find a working email and resend email 1" className="text-[10px] px-2 py-0.5 rounded border border-blue-200 text-blue-600 hover:bg-blue-50 disabled:opacity-50">{fixBusy === e.id && fixOpen === e.id ? 'Searching\u2026' : 'Fix email'}</button>
                                )}
                              </td>
                            </tr>
                            {fixOpen === e.id && (
                              <tr>
                                <td colSpan={6} className="bg-[#F8FAFF] px-2 py-2 border-b border-[#EEF0F4]">
                                  {(!fixSug[e.id] || fixSug[e.id].length === 0) && fixBusy === e.id && <p className="text-[11px] text-gray-500">Searching the web for a working email\u2026</p>}
                                  {(!fixSug[e.id] || fixSug[e.id].length === 0) && fixBusy !== e.id && <p className="text-[11px] text-gray-500">{fixMsg[e.id] || 'No candidates found.'}</p>}
                                  <div className="space-y-1">
                                    {(fixSug[e.id] || []).map((sg: any, i: number) => (
                                      <div key={i} className="flex items-center gap-2 text-[11px] bg-white border border-[#E4E6EE] rounded px-2 py-1">
                                        <span className="font-mono text-[#1A1D2E]">{sg.email}</span>
                                        <span className={`px-1.5 py-0.5 rounded-full ${sg.confidence === 'high' ? 'bg-emerald-100 text-emerald-700' : sg.confidence === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>{sg.confidence}</span>
                                        <span className="text-gray-400 truncate max-w-[260px]" title={sg.source}>{sg.note || sg.source}</span>
                                        <button onClick={() => applyFixEmail(e, sg.email)} disabled={fixBusy === e.id} className="ml-auto text-[10px] px-2 py-0.5 rounded bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50">Apply &amp; resend</button>
                                      </div>
                                    ))}
                                  </div>
                                  <button onClick={() => setFixOpen(null)} className="text-[10px] text-gray-400 hover:underline mt-1">close</button>
                                </td>
                              </tr>
                            )}
                            </Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                    </>
                  )}
                </div>
              ) : detailTab === 'emails' ? (
                <div className="p-5 space-y-4">
                  {(stepsBySeq[detail.id] || []).length === 0 ? (
                    <p className="text-center text-xs text-gray-400 py-6">No emails defined yet. Click Edit to add the sequence steps.</p>
                  ) : (stepsBySeq[detail.id] || []).map((st, i) => (
                    <div key={st.id || i} className="border border-[#EEF0F4] rounded-lg overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-2 bg-[#F8FAFF] border-b border-[#EEF0F4]">
                        <span className="text-xs font-bold text-[#1A1D2E]">Step {st.step_number}</span>
                        <span className="text-[11px] text-gray-500">{i === 0 ? 'sends immediately' : `sends ${st.delay_days} day${st.delay_days === 1 ? '' : 's'} after the previous step`}</span>
                        <button onClick={() => openEdit(detail)} className="ml-auto text-[11px] px-2 py-1 rounded border border-[#E4E6EE] text-[#3B6FE0] font-semibold hover:bg-[#F2F6FF]">Edit templates</button>
                      </div>
                      <div className="px-3 py-2.5">
                        <p className="text-[10px] uppercase font-bold text-gray-400 mb-0.5">Subject</p>
                        <p className="text-sm text-[#1A1D2E] mb-2">{st.subject || <span className="text-gray-400">(no subject)</span>}</p>
                        <p className="text-[10px] uppercase font-bold text-gray-400 mb-0.5">Body</p>
                        <pre className="text-xs text-[#1A1D2E] whitespace-pre-wrap font-sans leading-relaxed">{st.body || '(empty)'}</pre>
                      </div>
                    </div>
                  ))}
                  <p className="text-[11px] text-gray-400">Merge tags like {'{{first_name}}'} and {'{{company}}'} are filled in per lead when the email is queued.</p>
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
                <button onClick={save} disabled={saving} className="text-sm px-4 py-1.5 rounded-lg bg-[#3B6FE0] text-white">{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><label className="block text-xs text-gray-500 mb-1">Sequence name</label><input value={form.name || ''} onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))} className={inp} placeholder="e.g. Restaurant cold outreach" /></div>
                <div><label className="block text-xs text-gray-500 mb-1">From name</label><input value={form.from_name || ''} onChange={e => setForm((f: any) => ({ ...f, from_name: e.target.value }))} className={inp} /></div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Send from mailbox</label>
                  {mailboxes.length === 0 ? (
                    <div className="text-xs rounded-lg bg-[#FCE8EC] text-[#A11B30] border border-[#F3C6CF] px-3 py-2">No mailboxes connected. Connect one in <b>Settings → Email</b> first.</div>
                  ) : (
                    <select value={form.from_email || ''} onChange={e => { setForm((f: any) => ({ ...f, from_email: e.target.value })); setAllowProtected(false) }} className={inp}>
                      <option value="">— choose a mailbox —</option>
                      {mailboxes.map(m => (
                        <option key={m.email} value={m.email}>
                          {m.email}{m.is_outreach_default ? '  ✓ outreach (recommended)' : ''}{m.is_protected ? '  ⚠ primary — not for cold outreach' : ''}
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
                  <p className="text-sm font-bold text-[#A11B30]">⚠ {form.from_email} is your primary business mailbox</p>
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
              <p className="text-[11px] text-gray-500">Your <Link href="/settings/email-signature" className="text-[#3B6FE0] underline">global signature</Link> is auto-appended to every email — you don't paste it into the step body.</p>

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
                        <button onClick={() => removeStep(i)} className="ml-auto text-gray-400 hover:text-red-600 text-sm">×</button>
                      </div>
                      <input value={st.subject} onChange={e => updateStep(i, { subject: e.target.value })} placeholder="Subject" className={inp + ' mb-2'} />
                      <textarea rows={4} value={st.body} onChange={e => updateStep(i, { body: e.target.value })} placeholder="Email body…" className={inp + ' resize-y font-mono text-xs'} />
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
