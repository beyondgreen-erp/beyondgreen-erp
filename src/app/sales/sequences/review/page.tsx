'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface PendingSend {
  id: string
  sequence_id: string
  enrollment_id: string
  customer_id: string
  step_number: number
  to_email: string
  subject: string
  body: string
  created_at: string | null
}
interface SeqLite { id: string; name: string; from_email: string | null }
interface StepLite { id: string; sequence_id: string; step_number: number; subject: string; body: string }
interface CustomerLite { id: string; company_name: string | null; contact_name: string | null; email: string | null }

const inp = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3B6FE0]/30'

export default function SequenceReviewPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [rows, setRows] = useState<PendingSend[] | null>(null)
  const [seqBy, setSeqBy] = useState<Record<string, SeqLite>>({})
  const [stepBy, setStepBy] = useState<Record<string, StepLite>>({}) // key: `${sequence_id}:${step_number}`
  const [custBy, setCustBy] = useState<Record<string, CustomerLite>>({})
  const [sig, setSig] = useState('')
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, { subject: string; body: string }>>({})
  const [busy, setBusy] = useState('')

  const [templateEdit, setTemplateEdit] = useState<{ stepKey: string; subject: string; body: string } | null>(null)

  const load = useCallback(async () => {
    const [{ data: r }, { data: s }, { data: st }, { data: userAuth }] = await Promise.all([
      sb.from('sequence_sends').select('id,sequence_id,enrollment_id,customer_id,step_number,to_email,subject,body,created_at').eq('status', 'review').order('created_at', { ascending: true }),
      sb.from('sequences').select('id,name,from_email'),
      sb.from('sequence_steps').select('id,sequence_id,step_number,subject,body'),
      sb.auth.getUser(),
    ])
    const list = (r as PendingSend[]) || []
    setRows(list)
    const sm: Record<string, SeqLite> = {}; (s as SeqLite[] || []).forEach(x => { sm[x.id] = x }); setSeqBy(sm)
    const smk: Record<string, StepLite> = {}; (st as StepLite[] || []).forEach(x => { smk[`${x.sequence_id}:${x.step_number}`] = x }); setStepBy(smk)
    // Fetch customers for the pending recipients
    const custIds = [...new Set(list.map(x => x.customer_id))]
    if (custIds.length) {
      const { data: cs } = await sb.from('customers').select('id,company_name,contact_name,email').in('id', custIds)
      const cm: Record<string, CustomerLite> = {}; (cs as CustomerLite[] || []).forEach(c => { cm[c.id] = c }); setCustBy(cm)
    }
    // Load user's global signature for the preview
    const em = userAuth?.user?.email
    if (em) {
      const { data: sigRow } = await sb.from('user_email_signatures').select('signature_html').eq('user_email', em).maybeSingle()
      setSig(sigRow?.signature_html || '')
    }
  }, [sb])
  useEffect(() => { load() }, [load])

  // Group pending sends by sequence, then by step within each sequence
  const grouped = useMemo(() => {
    const g: Record<string, Record<number, PendingSend[]>> = {}
    ;(rows || []).forEach(r => { (g[r.sequence_id] ||= {})[r.step_number] = [...((g[r.sequence_id] || {})[r.step_number] || []), r] })
    return g
  }, [rows])

  const draftFor = (r: PendingSend) => drafts[r.id] || { subject: r.subject, body: r.body }
  const setDraft = (r: PendingSend, patch: { subject?: string; body?: string }) => setDrafts(d => ({ ...d, [r.id]: { ...draftFor(r), ...patch } }))
  const hasDraftChanges = (r: PendingSend) => {
    const d = drafts[r.id]; if (!d) return false
    return d.subject !== r.subject || d.body !== r.body
  }
  async function saveDraftOnly(r: PendingSend) {
    const d = draftFor(r)
    setBusy('save:' + r.id)
    await sb.from('sequence_sends').update({ subject: d.subject, body: d.body }).eq('id', r.id)
    setBusy(''); setDrafts(dd => { const n = { ...dd }; delete n[r.id]; return n }); load()
  }

  async function approve(ids: string[]) {
    if (!ids.length) return
    if (!confirm(`Send ${ids.length} email${ids.length !== 1 ? 's' : ''} now?`)) return
    setBusy('approve')
    // Save any unsaved per-recipient drafts first
    const dirtyRows = (rows || []).filter(r => ids.includes(r.id) && hasDraftChanges(r))
    for (const r of dirtyRows) {
      const d = draftFor(r)
      await sb.from('sequence_sends').update({ subject: d.subject, body: d.body }).eq('id', r.id)
    }
    const res = await fetch('/api/leads/sequence-approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ send_ids: ids }) })
    const j = await res.json()
    alert(j.message || j.error || 'Done')
    setBusy(''); setSelected({}); setDrafts({}); load()
  }
  async function skip(ids: string[]) {
    if (!ids.length) return
    if (!confirm(`Skip ${ids.length} email${ids.length !== 1 ? 's' : ''} (marks step as done, no email sent)?`)) return
    setBusy('skip')
    await fetch('/api/leads/sequence-skip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ send_ids: ids }) })
    setBusy(''); setSelected({}); load()
  }
  function openTemplateEditor(stepKey: string) {
    const step = stepBy[stepKey]; if (!step) return
    setTemplateEdit({ stepKey, subject: step.subject, body: step.body })
  }
  async function saveTemplate() {
    if (!templateEdit) return
    const step = stepBy[templateEdit.stepKey]; if (!step) return
    setBusy('tpl')
    const res = await fetch('/api/leads/sequence-update-step', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step_id: step.id, subject: templateEdit.subject, body: templateEdit.body, apply_to_pending: true })
    })
    const j = await res.json()
    alert(`Template saved. ${j.updated_pending || 0} pending emails re-rendered.`)
    setBusy(''); setTemplateEdit(null); setDrafts({}); load()
  }

  const totalPending = rows?.length ?? 0
  const selectedIds = Object.keys(selected).filter(k => selected[k])
  const setAllInStep = (list: PendingSend[], on: boolean) => setSelected(s => { const n = { ...s }; list.forEach(r => n[r.id] = on); return n })

  const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  // Mirrors composeHtml() in the sequence-run route so the preview matches
  // what actually goes out (branded header, footer, signature block).
  const previewHtml = (r: PendingSend) => {
    const d = draftFor(r)
    const linkify = (s: string) => s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#00A84F;text-decoration:underline;">$1</a>')
    const paragraphs = (d.body || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
    const bodyHtml = paragraphs.map(p => `<p style="margin:0 0 14px;line-height:1.55;color:#1A1D2E;font-size:15px;">${linkify(escHtml(p)).replace(/\n/g, '<br>')}</p>`).join('')
    const sigBlock = sig ? `<div style="margin-top:22px;padding-top:14px;border-top:1px solid #E4E6EE;">${sig}</div>` : ''
    return `<div style="background:#F5F7FA;padding:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFF;border-radius:12px;overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,0.05);">
<tr><td style="background:linear-gradient(135deg,#00A84F 0%,#037f4c 100%);padding:18px 20px;">
  <table role="presentation" width="100%"><tr>
    <td>
      <div style="color:#FFF;font-weight:800;font-size:22px;letter-spacing:-0.5px;line-height:1;font-family:Arial,Helvetica,sans-serif;">beyondGREEN</div>
      <div style="color:#B6F0D0;font-size:9px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;margin-top:3px;font-family:Arial,Helvetica,sans-serif;">biotech · professional</div>
    </td>
    <td align="right" style="color:#FFF;font-size:10px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif;">Made in USA<br>Compostable</td>
  </tr></table>
</td></tr>
<tr><td style="padding:24px 24px 20px;">${bodyHtml}${sigBlock}</td></tr>
<tr><td style="background:#0F1C2E;padding:14px 20px;color:#B8C3D2;font-size:10px;line-height:1.4;">
  <table role="presentation" width="100%"><tr>
    <td><div style="color:#00E68C;font-weight:bold;margin-bottom:2px;">beyondGREEN biotech</div>1202 E. Wakeham Ave., Santa Ana, CA 92705</td>
    <td align="right"><a href="https://beyondgreenbiotech.com" style="color:#00E68C;text-decoration:none;font-weight:600;">beyondgreenbiotech.com</a></td>
  </tr></table>
</td></tr>
</table></td></tr></table></div>`
  }

  return (
    <div className="min-h-screen mon-page p-4 md:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div>
          <span className="mon-tag t-blue">📧 Sequence Review</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">Review before send</h1>
          <p className="text-gray-500 text-sm mt-0.5">Each sequence email waits here for you to approve. Edit one recipient, or fix the template to update every pending copy.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/settings/email-signature" className="text-sm px-3 py-2 rounded-lg border border-[#E4E6EE] text-gray-600 hover:text-[#1A1D2E]">Edit signature</Link>
          <Link href="/sales/sequences" className="text-sm px-3 py-2 rounded-lg border border-[#E4E6EE] text-gray-600 hover:text-[#1A1D2E]">Back to Sequences</Link>
          <button onClick={() => approve(rows?.map(r => r.id) || [])} disabled={!totalPending || !!busy} className="text-sm px-3 py-2 rounded-lg bg-emerald-600 text-white font-semibold disabled:opacity-50">
            Approve all {totalPending ? `(${totalPending})` : ''}
          </button>
        </div>
      </div>

      {rows == null ? <p className="text-gray-400 text-sm">Loading…</p> : rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#ECEEF3] p-10 text-center">
          <p className="text-sm text-gray-500">No pending emails to review.</p>
          <p className="text-xs text-gray-400 mt-1">When a sequence's next step comes due, it will appear here for approval.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([seqId, byStep]) => {
            const seq = seqBy[seqId]
            return (
              <div key={seqId} className="bg-white rounded-xl border border-[#ECEEF3] shadow-sm overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-[#EEF0F4] bg-[#F8FAFF]">
                  <p className="text-sm font-bold text-[#1A1D2E]">{seq?.name || 'Unknown sequence'}</p>
                  <span className="text-[11px] text-gray-500">from {seq?.from_email || 'no sender'}</span>
                  <span className="ml-auto text-[11px] font-bold text-indigo-600">{Object.values(byStep).flat().length} pending</span>
                </div>
                {Object.entries(byStep).sort(([a], [b]) => Number(a) - Number(b)).map(([stepNum, list]) => {
                  const stepKey = `${seqId}:${stepNum}`
                  const step = stepBy[stepKey]
                  const stepSelected = list.filter(r => selected[r.id])
                  return (
                    <div key={stepNum} className="border-b border-[#EEF0F4] last:border-0">
                      <div className="flex items-center gap-2 px-4 py-2.5 bg-[#FAFBFD]">
                        <input type="checkbox" checked={stepSelected.length === list.length && list.length > 0} onChange={e => setAllInStep(list, e.target.checked)} />
                        <span className="text-xs font-bold text-[#1A1D2E]">Step {stepNum}</span>
                        <span className="text-[11px] text-gray-500 truncate max-w-[400px]">{step?.subject || '(no template subject)'}</span>
                        <span className="text-[11px] text-gray-400 ml-1">· {list.length} recipient{list.length !== 1 ? 's' : ''}</span>
                        <div className="ml-auto flex gap-1">
                          <button onClick={() => openTemplateEditor(stepKey)} className="text-[11px] px-2 py-1 rounded border border-[#E4E6EE] text-[#3B6FE0] font-semibold hover:bg-[#F2F6FF]">✎ Edit template</button>
                          <button onClick={() => approve(list.map(r => r.id))} disabled={!!busy} className="text-[11px] px-2 py-1 rounded border border-emerald-200 text-emerald-600 font-semibold hover:bg-emerald-50">Send all in this step</button>
                          <button onClick={() => skip(list.map(r => r.id))} disabled={!!busy} className="text-[11px] px-2 py-1 rounded border border-amber-200 text-amber-600 font-semibold hover:bg-amber-50">Skip all</button>
                        </div>
                      </div>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-[10px] uppercase text-gray-400 border-b border-[#EEF0F4]">
                            <th className="px-3 py-2 w-8"></th>
                            <th className="text-left px-3 py-2 w-[220px]">Recipient</th>
                            <th className="text-left px-3 py-2">Subject preview</th>
                            <th className="text-right px-3 py-2 w-[220px]"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.map(r => {
                            const c = custBy[r.customer_id]
                            const d = draftFor(r)
                            const dirty = hasDraftChanges(r)
                            const isOpen = expandedId === r.id
                            return (
                              <>
                                <tr key={r.id} className={`border-b border-[#EEF0F4] ${isOpen ? 'bg-[#F8FAFF]' : ''} hover:bg-[#F2F6FF] cursor-pointer`} onClick={() => setExpandedId(isOpen ? null : r.id)}>
                                  <td className="px-3 py-2" onClick={e => e.stopPropagation()}><input type="checkbox" checked={!!selected[r.id]} onChange={e => setSelected(s => ({ ...s, [r.id]: e.target.checked }))} /></td>
                                  <td className="px-3 py-2">
                                    <p className="font-semibold text-[#1A1D2E]">{c?.company_name || '(no name)'}</p>
                                    <p className="text-[10px] text-gray-400 truncate max-w-[200px]">{r.to_email}</p>
                                  </td>
                                  <td className="px-3 py-2">
                                    <p className="text-[#1A1D2E] truncate max-w-[560px]">{d.subject}</p>
                                    {dirty && <span className="text-[10px] font-bold text-amber-600">● unsaved edits</span>}
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <button onClick={e => { e.stopPropagation(); approve([r.id]) }} disabled={!!busy} className="text-[11px] px-2 py-1 rounded bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50">Send</button>
                                    <button onClick={e => { e.stopPropagation(); skip([r.id]) }} disabled={!!busy} className="text-[11px] ml-1 px-2 py-1 rounded border border-amber-200 text-amber-600 font-semibold hover:bg-amber-50">Skip</button>
                                  </td>
                                </tr>
                                {isOpen && (
                                  <tr>
                                    <td colSpan={4} className="bg-white px-4 py-3 border-b border-[#EEF0F4]">
                                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                        <div>
                                          <p className="text-[10px] uppercase font-bold text-gray-400 mb-1">Subject (for this recipient only)</p>
                                          <input value={d.subject} onChange={e => setDraft(r, { subject: e.target.value })} className={inp} />
                                          <p className="text-[10px] uppercase font-bold text-gray-400 mb-1 mt-2">Body</p>
                                          <textarea rows={10} value={d.body} onChange={e => setDraft(r, { body: e.target.value })} className={inp + ' font-mono text-xs resize-y'} />
                                          {dirty && (
                                            <div className="flex gap-2 mt-2">
                                              <button onClick={() => saveDraftOnly(r)} disabled={!!busy} className="text-[11px] px-3 py-1.5 rounded bg-[#3B6FE0] text-white font-semibold hover:bg-[#2E5CC7] disabled:opacity-50">Save this recipient's edits</button>
                                              <button onClick={() => setDrafts(dd => { const n = { ...dd }; delete n[r.id]; return n })} className="text-[11px] px-3 py-1.5 rounded border border-[#E4E6EE] text-gray-500">Revert</button>
                                              <span className="text-[10px] text-gray-400 self-center">Or fix the template above to update every recipient at once.</span>
                                            </div>
                                          )}
                                        </div>
                                        <div>
                                          <p className="text-[10px] uppercase font-bold text-gray-400 mb-1">Live preview (with your signature)</p>
                                          <div className="border border-[#E4E6EE] rounded-lg bg-white p-4 max-h-[420px] overflow-y-auto text-xs">
                                            <p className="text-[10px] text-gray-400 mb-1">From: {seq?.from_email} → {r.to_email}</p>
                                            <p className="font-bold text-[#1A1D2E] mb-2">{d.subject || '(no subject)'}</p>
                                            <div dangerouslySetInnerHTML={{ __html: previewHtml(r) }} />
                                          </div>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      {selectedIds.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-white border border-[#E4E6EE] shadow-2xl rounded-full px-4 py-2 flex items-center gap-2 text-sm">
          <span className="font-semibold text-[#1A1D2E]">{selectedIds.length} selected</span>
          <button onClick={() => approve(selectedIds)} disabled={!!busy} className="px-3 py-1 rounded bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50">Send selected</button>
          <button onClick={() => skip(selectedIds)} disabled={!!busy} className="px-3 py-1 rounded border border-amber-200 text-amber-600 text-xs font-semibold hover:bg-amber-50">Skip selected</button>
          <button onClick={() => setSelected({})} className="px-2 py-1 text-xs text-gray-500">Clear</button>
        </div>
      )}

      {templateEdit && (() => {
        const step = stepBy[templateEdit.stepKey]
        const cnt = (grouped[step?.sequence_id]?.[step?.step_number] || []).length
        return (
          <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(20,24,40,0.4)' }} onClick={() => setTemplateEdit(null)}>
            <div className="w-[640px] max-w-full bg-white h-full overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="sticky top-0 bg-white border-b border-[#EEF0F4] px-5 py-3 flex items-center justify-between">
                <div><p className="text-[10px] uppercase font-bold text-gray-400">Template edit</p><h2 className="font-bold text-[#1A1D2E]">Step {step?.step_number} template</h2></div>
                <div className="flex gap-2">
                  <button onClick={() => setTemplateEdit(null)} className="text-sm px-3 py-1.5 rounded-lg border border-[#E4E6EE] text-gray-500">Cancel</button>
                  <button onClick={saveTemplate} disabled={!!busy} className="text-sm px-4 py-1.5 rounded-lg bg-[#3B6FE0] text-white">{busy === 'tpl' ? 'Saving…' : `Save & re-render ${cnt}`}</button>
                </div>
              </div>
              <div className="p-5 space-y-3">
                <div className="rounded-lg bg-[#FFF8E7] border border-[#F3E5C0] px-3 py-2 text-[11px] text-[#8A6D3B]">
                  Saving will overwrite this step's template AND re-render every one of the <b>{cnt}</b> pending emails for this step, so the {'{'}{'{'}<i>merge tags</i>{'}'}{'}'} pick up the fix per recipient.
                </div>
                <div><p className="text-[10px] uppercase font-bold text-gray-400 mb-1">Subject</p><input value={templateEdit.subject} onChange={e => setTemplateEdit(t => t ? { ...t, subject: e.target.value } : t)} className={inp} /></div>
                <div><p className="text-[10px] uppercase font-bold text-gray-400 mb-1">Body</p><textarea rows={14} value={templateEdit.body} onChange={e => setTemplateEdit(t => t ? { ...t, body: e.target.value } : t)} className={inp + ' font-mono text-xs resize-y'} /></div>
                <p className="text-[10px] text-gray-400">Variables: {'{{company}}'} {'{{contact}}'} {'{{first_name}}'} {'{{city}}'} {'{{state}}'} {'{{industry}}'} {'{{website}}'} {'{{my_name}}'}</p>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
