'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
// Approvals: printer submissions → confirmation by every approver → approval sent to the printer.
// Plus the full activity trail for the design (beyondGREEN and printer side).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import type { DesignRow } from '@/lib/packaging/doc'
import { APPROVERS, ACTIVITY_LABELS } from '@/lib/packaging/activity'
import type { EditorHandle } from './Editor'
import SpecSheet from './SpecSheet'

const stamp = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
const ROUND_BADGE: Record<string, string> = {
  awaiting_team: 'bg-amber-100 text-amber-800', approved: 'bg-emerald-100 text-emerald-800', changes_requested: 'bg-orange-100 text-orange-800', cancelled: 'bg-gray-200 text-gray-600',
}
const ROUND_LABEL: Record<string, string> = { awaiting_team: 'Waiting for beyondGREEN confirmations', approved: 'Approved for production', changes_requested: 'Changes requested', cancelled: 'Canceled' }
const TEAM_LABEL: Record<string, string> = { awaiting_team: 'Waiting for approvals', approved: 'Fully approved', changes_requested: 'Changes requested', cancelled: 'Canceled' }
const ICON: Record<string, string> = {
  portal_opened: 'ti-eye', downloaded: 'ti-download', comment: 'ti-message-circle', reply: 'ti-message-reply', comment_resolved: 'ti-circle-check',
  submitted: 'ti-send', confirmed: 'ti-user-check', changes_requested: 'ti-alert-triangle', approved: 'ti-rosette-discount-check', approval_sent: 'ti-mail-forward',
  link_created: 'ti-link', link_revoked: 'ti-link-off', link_extended: 'ti-clock-plus', original_uploaded: 'ti-file-upload', artwork_replaced: 'ti-replace',
  final_files_saved: 'ti-files', round_cancelled: 'ti-ban',
  team_review_requested: 'ti-users-group', team_confirmed: 'ti-user-check', team_changes: 'ti-alert-triangle', team_approved: 'ti-rosette-discount-check',
  team_reminder: 'ti-bell-ringing', team_review_cancelled: 'ti-ban',
}

export default function ApprovalsTab({ design, editor, user, openRequest, onRequestOpened, onDesign }: { design: DesignRow; editor: React.RefObject<EditorHandle>; user: { email: string; name: string }; openRequest?: boolean; onRequestOpened?: () => void; onDesign?: (patch: Partial<DesignRow>) => void }) {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rounds, setRounds] = useState<any[]>([])
  const [conf, setConf] = useState<any[]>([])
  const [acts, setActs] = useState<any[]>([])
  const [links, setLinks] = useState<any[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [who, setWho] = useState<'all' | 'team' | 'printer'>('all')
  const [asking, setAsking] = useState(false)
  useEffect(() => { if (openRequest) { setAsking(true); onRequestOpened?.() } }, [openRequest, onRequestOpened])

  const load = useCallback(async () => {
    const [r, a, l] = await Promise.all([
      sb.from('packaging_approval_rounds').select('*').eq('design_id', design.id).order('created_at', { ascending: false }),
      sb.from('packaging_activity').select('*').eq('design_id', design.id).order('created_at', { ascending: false }).limit(500),
      sb.from('packaging_share_links').select('id, printer_company, printer_contact, printer_email, token').eq('design_id', design.id),
    ])
    const rs = (r.data || []) as any[]
    setRounds(rs); setActs((a.data || []) as any[]); setLinks((l.data || []) as any[])
    if (rs.length) {
      const { data: c } = await sb.from('packaging_approval_confirmations').select('*').in('round_id', rs.map(x => x.id))
      setConf((c || []) as any[])
    } else setConf([])
  }, [sb, design.id])
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t) }, [load])

  const act = async (roundId: string, decision: 'confirmed' | 'changes') => {
    if (decision === 'changes' && !note.trim()) { setMsg('Write what needs to change first.'); return }
    setBusy(true); setMsg('')
    const r = await fetch('/api/packaging/approvals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ round_id: roundId, decision, note }) })
    const j = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) { setMsg(j.error || 'Something went wrong'); load(); return }
    setNote('')
    const team = rounds.find(x => x.id === roundId)?.kind === 'team'
    setMsg(j.status === 'approved' ? (team ? 'Everyone has approved. The design is now Fully Approved.' : 'All confirmations received — the approval and exact file were sent to the printer.') : decision === 'changes' ? (team ? 'Changes requested. Everyone on the request has been notified.' : 'Changes requested — the printer has been notified.') : `Approved (${j.confirmed} of ${j.total}).`)
    if (j.status === 'approved') onDesign?.({ status: 'Fully Approved' })
    else if (decision === 'changes' && team) onDesign?.({ status: 'In Review' })
    load()
  }
  const followUp = async (roundId: string, kind: 'remind' | 'cancel') => {
    if (kind === 'cancel' && !window.confirm('Cancel this approval request?')) return
    setBusy(true); setMsg('')
    const r = await fetch('/api/packaging/approvals/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ round_id: roundId, [kind]: true }) })
    const j = await r.json().catch(() => ({}))
    setBusy(false)
    setMsg(!r.ok ? (j.error || 'Something went wrong') : kind === 'remind' ? `Reminder sent to ${(j.to || []).join(', ')}.` : 'Request canceled.')
    load()
  }

  const linkName = (id: string | null) => links.find(l => l.id === id)?.printer_company || 'Printer'
  const spec = (editor.current?.getDoc() as any)?.spec
  const src = (editor.current?.getDoc() as any)?.source
  const shown = acts.filter(a => who === 'all' || (who === 'team' ? a.actor_type === 'team' : a.actor_type === 'printer'))

  return (
    <div className="flex-1 overflow-y-auto bg-[#F5F6FA]">
      <div className="max-w-6xl mx-auto p-6 grid lg:grid-cols-[1fr_380px] gap-6">
        <div className="space-y-5">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Approvals</h2>
            <p className="text-sm text-gray-500">Ask your team to approve this design, or confirm a proof the printer sent back. When the printer sends the proof back, every approver must confirm before the approval and the exact original file go to the printer.</p>
            <p className="text-xs text-gray-500 mt-1">Printer approvers: {APPROVERS.map(a => a.name).join(' · ')}</p>
            <button onClick={() => setAsking(true)} className="mt-3 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#3B6FE0] hover:bg-[#2f5bc0]"><i className="ti ti-users-group" /> Request team approval</button>
            <span className="ml-3 text-xs text-gray-500">Pick team members and email them a link to approve this design.</span>
          </div>
          {!rounds.length && <div className="bg-white rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">No submissions yet. The printer sends the proof back from their portal with <b>Submit for approval</b>.</div>}
          {rounds.map((r, i) => {
            const list = (r.approvers?.length ? r.approvers : APPROVERS).map((a: any) => ({ ...a, c: conf.find(c => c.round_id === r.id && c.approver_email.toLowerCase() === a.email.toLowerCase()) }))
            const done = list.filter((a: any) => a.c?.decision === 'confirmed').length
            const mine = list.find((a: any) => a.email.toLowerCase() === user.email.toLowerCase())
            const team = r.kind === 'team'
            return (
              <div key={r.id} className={`bg-white rounded-xl border ${i === 0 ? 'border-gray-300 shadow-sm' : 'border-gray-200 opacity-80'} overflow-hidden`}>
                <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-900">Round {r.round_no}</span>
                  {team && <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">Team approval</span>}
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${ROUND_BADGE[r.status]}`}>{(team ? TEAM_LABEL : ROUND_LABEL)[r.status]}</span>
                  <span className="ml-auto text-xs text-gray-500">{team ? `requested by ${r.submitted_by_name}` : `${linkName(r.share_link_id)} · submitted by ${r.submitted_by_name}`} · {stamp(r.submitted_at)}</span>
                </div>
                {r.status === 'approved' && (
                  <div className="mx-4 mt-3 border-4 border-emerald-600 rounded-lg px-4 py-3 text-emerald-800 inline-block -rotate-1">
                    <div className="font-extrabold tracking-[0.2em] text-sm">{team ? 'FULLY APPROVED' : 'APPROVED FOR PRODUCTION'}</div>
                    <div className="text-xs mt-0.5">{stamp(r.approved_at)}{team ? ` · ${list.length} of ${list.length} approved` : ` · sent to printer ${r.approval_sent_at ? stamp(r.approval_sent_at) : '(portal only — no printer email on file)'}`}</div>
                  </div>
                )}
                <div className="p-4 space-y-3">
                  {r.printer_note && <div className={`text-sm ${team ? 'bg-blue-50 border-blue-400' : 'bg-violet-50 border-violet-400'} border-l-4 rounded p-3 whitespace-pre-wrap`}><span className={`text-[11px] font-semibold ${team ? 'text-blue-700' : 'text-violet-700'} block mb-1`}>{team ? `Message from ${r.submitted_by_name}` : 'Printer note'}</span>{r.printer_note}</div>}
                  {r.status === 'changes_requested' && r.closed_note && <div className="text-sm bg-orange-50 border-l-4 border-orange-400 rounded p-3 whitespace-pre-wrap"><span className="text-[11px] font-semibold text-orange-700 block mb-1">Changes requested</span>{r.closed_note}</div>}
                  {r.source_name && <p className="text-xs text-gray-600">File under approval: <b>{r.source_name}</b> <span className="font-mono text-[10px] text-gray-400 break-all">SHA-256 {r.source_sha256}</span></p>}
                  <div className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
                    {list.map((a: any) => (
                      <div key={a.email} className="flex items-center gap-3 px-3 py-2 text-sm">
                        <i className={`ti ${a.c?.decision === 'confirmed' ? 'ti-circle-check text-emerald-600' : a.c?.decision === 'changes' ? 'ti-alert-triangle text-orange-500' : 'ti-circle-dashed text-gray-300'} text-lg`} />
                        <span className="font-medium w-32">{a.name}</span>
                        <span className="text-xs text-gray-500 flex-1">{a.c ? `${a.c.decision === 'confirmed' ? (team ? 'Approved' : 'Confirmed') : 'Requested changes'} · ${stamp(a.c.decided_at)}` : 'Pending'}{a.c?.note ? ` — ${a.c.note}` : ''}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500">{done} of {list.length} {team ? 'approved' : 'confirmed'}</p>
                  {i === 0 && r.status === 'awaiting_team' && team && (
                    <div className="flex gap-2">
                      <button disabled={busy} onClick={() => followUp(r.id, 'remind')} className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50"><i className="ti ti-bell-ringing" /> Email a reminder to anyone pending</button>
                      <button disabled={busy} onClick={() => followUp(r.id, 'cancel')} className="text-xs px-3 py-1.5 rounded-lg text-gray-500 hover:text-red-600 disabled:opacity-50"><i className="ti ti-x" /> Cancel request</button>
                    </div>
                  )}
                  {i === 0 && r.status === 'awaiting_team' && (
                    mine ? (
                      mine?.c?.decision === 'confirmed' ? <p className="text-sm text-emerald-700"><i className="ti ti-check" /> You {team ? 'approved' : 'confirmed'} on {stamp(mine.c.decided_at)}.</p> : (
                        <div className="space-y-2 pt-1">
                          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Note (required if requesting changes)" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                          <div className="flex gap-2">
                            <button disabled={busy} onClick={() => act(r.id, 'confirmed')} className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"><i className="ti ti-circle-check" /> {team ? 'Approve this design' : 'Confirm — sizes, colors & file are correct'}</button>
                            <button disabled={busy} onClick={() => act(r.id, 'changes')} className="px-4 py-2 rounded-lg text-sm font-medium border border-orange-300 text-orange-700 hover:bg-orange-50 disabled:opacity-50"><i className="ti ti-alert-triangle" /> Request changes</button>
                          </div>
                        </div>
                      )
                    ) : <p className="text-xs text-gray-500">Only the people listed above can {team ? 'approve' : 'confirm'}.</p>
                  )}
                  {i === 0 && msg && <p className="text-sm text-gray-700">{msg}</p>}
                </div>
              </div>
            )
          })}
          {spec && <div className="bg-white rounded-xl border border-gray-200 p-4"><h3 className="font-semibold text-gray-900 mb-2">Specification the printer sees</h3><SpecSheet spec={spec} source={src} /></div>}
        </div>
        <div>
          <div className="bg-white rounded-xl border border-gray-200 sticky top-4">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center">
              <h3 className="font-semibold text-gray-900">Activity</h3>
              <div className="ml-auto flex text-[11px] bg-gray-100 rounded-md p-0.5">
                {(['all', 'team', 'printer'] as const).map(k => <button key={k} onClick={() => setWho(k)} className={`px-2 py-0.5 rounded ${who === k ? 'bg-white shadow-sm font-semibold' : 'text-gray-500'}`}>{k === 'all' ? 'All' : k === 'team' ? 'beyondGREEN' : 'Printer'}</button>)}
              </div>
            </div>
            <ol className="max-h-[70vh] overflow-y-auto p-3 space-y-2.5">
              {!shown.length && <li className="text-sm text-gray-400">No activity yet.</li>}
              {shown.map(a => (
                <li key={a.id} className="flex gap-2.5 text-sm">
                  <span className={`w-7 h-7 shrink-0 rounded-full grid place-items-center ${a.actor_type === 'printer' ? 'bg-violet-100 text-violet-700' : a.actor_type === 'system' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}><i className={`ti ${ICON[a.action] || 'ti-point'}`} /></span>
                  <div className="min-w-0">
                    <p className="text-gray-900"><b>{a.actor_type === 'system' ? 'ERP' : a.actor_name || (a.actor_type === 'printer' ? linkName(a.share_link_id) : 'Team')}</b> · {ACTIVITY_LABELS[a.action] || a.action}{a.details?.round ? ` (round ${a.details.round})` : ''}</p>
                    {(a.details?.text || a.details?.note || a.details?.file) && <p className="text-xs text-gray-500 truncate">{a.details.text || a.details.note || a.details.file}</p>}
                    <p className="text-[11px] text-gray-400">{stamp(a.created_at)}{a.actor_type === 'printer' ? ` · ${linkName(a.share_link_id)}` : ''}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
      {asking && <RequestModal sb={sb} design={design} me={user} onClose={() => setAsking(false)} onSent={(names, emailed) => { setAsking(false); setMsg(`Approval request sent to ${names.join(', ')}${emailed ? ' by email and ERP notification' : ' (ERP notification only — email is not set up)'}.`); onDesign?.({ status: 'In Review' }); load() }} />}
    </div>
  )
}

/** Pick team members (everyone checked in one go) and email them a link to approve this design. */
function RequestModal({ sb, design, me, onClose, onSent }: { sb: any; design: DesignRow; me: { email: string; name: string }; onClose: () => void; onSent: (names: string[], emailed: boolean) => void }) {
  const [people, setPeople] = useState<{ email: string; name: string; title: string }[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    sb.from('user_profiles').select('email, full_name, display_name, job_title, is_active').order('full_name').then(({ data }: any) => {
      const list = (data || []).filter((p: any) => p.email && p.is_active !== false).map((p: any) => ({ email: p.email, name: p.full_name || p.display_name || p.email.split('@')[0], title: p.job_title || '' }))
      setPeople(list)
      // default: the packaging approvers
      setPicked(new Set(list.filter((p: any) => APPROVERS.some(a => a.email.toLowerCase() === p.email.toLowerCase())).map((p: any) => p.email.toLowerCase())))
    })
  }, [sb])
  const toggle = (e: string) => setPicked(s => { const n = new Set(s); const k = e.toLowerCase(); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const send = async () => {
    if (!picked.size) { setErr('Choose at least one person.'); return }
    setBusy(true); setErr('')
    const r = await fetch('/api/packaging/approvals/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ design_id: design.id, emails: Array.from(picked), message }) })
    const j = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) { setErr(j.error || 'Could not send the request.'); return }
    onSent(people.filter(p => picked.has(p.email.toLowerCase())).map(p => p.name), !!j.emailed)
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center"><h2 className="text-lg font-bold">Request team approval</h2><button onClick={onClose} className="ml-auto text-gray-400 hover:text-black"><i className="ti ti-x" /></button></div>
        <p className="text-sm text-gray-600">Everyone you check gets an email and an ERP notification with a link to approve <b>{design.name}</b>. When all of them approve, the design becomes <b>Fully Approved</b>.</p>
        <div className="flex items-center text-xs">
          <span className="text-gray-500">{picked.size} selected</span>
          <button onClick={() => setPicked(new Set(people.map(p => p.email.toLowerCase())))} className="ml-auto text-blue-600 hover:underline">Select all</button>
          <span className="mx-2 text-gray-300">|</span>
          <button onClick={() => setPicked(new Set())} className="text-blue-600 hover:underline">Clear</button>
        </div>
        <div className="border border-gray-200 rounded-lg max-h-64 overflow-y-auto divide-y divide-gray-100">
          {!people.length && <p className="p-3 text-sm text-gray-400">Loading team…</p>}
          {people.map(p => (
            <label key={p.email} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
              <input type="checkbox" checked={picked.has(p.email.toLowerCase())} onChange={() => toggle(p.email)} />
              <span className="flex-1 min-w-0"><span className="font-medium text-gray-900">{p.name}</span>{p.email.toLowerCase() === me.email.toLowerCase() && <span className="text-xs text-gray-400"> (you)</span>}<span className="block text-xs text-gray-500 truncate">{[p.title, p.email].filter(Boolean).join(' · ')}</span></span>
            </label>
          ))}
        </div>
        <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3} placeholder="Message (optional), e.g. Could you please check the dimensions and colors?" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border border-gray-300">Cancel</button>
          <button disabled={busy || !picked.size} onClick={send} className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#3B6FE0] disabled:opacity-50"><i className="ti ti-mail" /> {busy ? 'Sending…' : `Send to ${picked.size} ${picked.size === 1 ? 'person' : 'people'}`}</button>
        </div>
      </div>
    </div>
  )
}
