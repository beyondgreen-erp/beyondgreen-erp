'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
// Sales Order ▸ Customer proof approval: email a mockup / proof from this order's files to the customer,
// who approves it or asks for changes on a public page. Every round and decision is kept here.
import { useCallback, useEffect, useState } from 'react'

const PROOF_ORIGIN = (process.env.NEXT_PUBLIC_PROOF_ORIGIN || 'https://beyondgreen-proofs.vercel.app').replace(/\/$/, '')
const STATUS: Record<string, { t: string; c: string }> = {
  sent: { t: 'Waiting on customer', c: 'bg-blue-50 text-blue-700 border-blue-200' },
  approved: { t: 'Approved', c: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  changes_requested: { t: 'Changes requested', c: 'bg-amber-50 text-amber-700 border-amber-200' },
  cancelled: { t: 'Replaced / withdrawn', c: 'bg-gray-100 text-gray-500 border-gray-200' },
}
const fmt = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''

export default function CustomerProofPanel({ supabase, orderId, defaultEmail, defaultName, defaultTitle }: {
  supabase: any; orderId: string; defaultEmail?: string | null; defaultName?: string | null; defaultTitle?: string | null
}) {
  const [proofs, setProofs] = useState<any[]>([])
  const [files, setFiles] = useState<any[]>([])
  const [form, setForm] = useState({ file_attachment_id: '', recipient_email: defaultEmail || '', recipient_name: defaultName || '', cc: '', title: defaultTitle || '', message: '' })
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [r, { data: f }] = await Promise.all([
      fetch(`/api/customer-proofs?order=${orderId}`, { cache: 'no-store' }).then(x => x.json()).catch(() => ({})),
      supabase.from('file_attachments').select('id, file_name, record_type, created_at').eq('record_id', orderId)
        .in('record_type', ['sales_order_artwork', 'sales_order_other']).order('created_at', { ascending: false }),
    ])
    setProofs(r.proofs || [])
    setFiles(f || [])
    setForm(prev => ({ ...prev, file_attachment_id: prev.file_attachment_id || (f?.find((x: any) => /\.(png|jpe?g|webp|gif|pdf)$/i.test(x.file_name))?.id || '') }))
  }, [supabase, orderId])
  useEffect(() => { load() }, [load])

  const send = async () => {
    setMsg('')
    if (!form.file_attachment_id) { setMsg('Upload the proof under Artwork files first, then pick it here.'); return }
    if (!form.recipient_email.trim()) { setMsg('Enter the customer email.'); return }
    const f = files.find(x => x.id === form.file_attachment_id)
    if (!confirm(`Email "${f?.file_name}" to ${form.recipient_email} for approval?`)) return
    setBusy('send')
    const r = await fetch('/api/customer-proofs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sales_order_id: orderId, ...form }) })
    const j = await r.json().catch(() => ({}))
    setBusy(null)
    if (!r.ok) { setMsg(j.error || 'Could not send.'); return }
    setMsg(j.emailed ? `Sent to ${form.recipient_email}.` : 'Saved, but the email did not go out. Copy the link below and send it yourself.')
    setForm(prev => ({ ...prev, message: '' }))
    load()
  }
  const act = async (id: string, what: 'cancel' | 'remind') => {
    if (what === 'cancel' && !confirm('Withdraw this proof? The customer link will stop working.')) return
    setBusy(id)
    const r = await fetch('/api/customer-proofs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, [what]: true }) })
    const j = await r.json().catch(() => ({}))
    setBusy(null)
    setMsg(r.ok ? (what === 'remind' ? (j.emailed ? 'Reminder sent.' : 'Reminder email did not go out.') : 'Withdrawn.') : (j.error || 'Failed.'))
    load()
  }
  const copy = async (token: string) => {
    const url = `${PROOF_ORIGIN}/proof/approve/${token}`
    try { await navigator.clipboard.writeText(url); setCopied(token); setTimeout(() => setCopied(null), 2000) } catch { prompt('Copy this link', url) }
  }

  const input = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500'
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Customer proof approval</p>
        <button type="button" onClick={load} className="text-[11px] text-blue-600 hover:underline">Refresh</button>
      </div>

      {proofs.length > 0 && (
        <div className="space-y-2">
          {proofs.map(p => {
            const s = STATUS[p.status] || STATUS.sent
            return (
              <div key={p.id} className="border border-[#E4E6EE] rounded-lg p-2.5 text-xs space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-800">Round {p.round_no}</span>
                  <span className={`px-2 py-0.5 rounded-full border text-[11px] ${s.c}`}>{s.t}</span>
                  <span className="text-gray-500 truncate max-w-[220px]">{p.file_name}</span>
                  <span className="ml-auto text-gray-400">{p.recipient_email} · {fmt(p.sent_at)}{p.view_count ? ` · viewed ${p.view_count}x` : ''}</span>
                </div>
                {p.decided_at && <p className="text-gray-700">{p.status === 'approved' ? '✓ Approved' : 'Changes requested'} by {p.decided_name} on {fmt(p.decided_at)}{p.decision_note ? `: ${p.decision_note}` : ''}</p>}
                {!p.email_sent && p.status === 'sent' && <p className="text-amber-700">Email did not go out. Copy the link and send it yourself.</p>}
                <div className="flex gap-2">
                  <button type="button" onClick={() => copy(p.token)} className="px-2 py-1 rounded border border-gray-300 hover:bg-gray-50">{copied === p.token ? '✓ Copied' : 'Copy customer link'}</button>
                  {p.status === 'sent' && <button type="button" disabled={busy === p.id} onClick={() => act(p.id, 'remind')} className="px-2 py-1 rounded border border-gray-300 hover:bg-gray-50">Send reminder</button>}
                  {p.status === 'sent' && <button type="button" disabled={busy === p.id} onClick={() => act(p.id, 'cancel')} className="px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50">Withdraw</button>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="bg-gray-50 border border-[#E4E6EE] rounded-lg p-3 space-y-2">
        <label className="block text-[11px] text-gray-500">Proof file (from Artwork files / Other documents)
          <select value={form.file_attachment_id} onChange={e => setForm({ ...form, file_attachment_id: e.target.value })} className={`${input} mt-1`}>
            <option value="">— pick a file —</option>
            {files.map(f => <option key={f.id} value={f.id}>{f.file_name}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <input value={form.recipient_name} onChange={e => setForm({ ...form, recipient_name: e.target.value })} placeholder="Customer name" className={input} />
          <input value={form.recipient_email} onChange={e => setForm({ ...form, recipient_email: e.target.value })} placeholder="Customer email *" className={input} />
        </div>
        <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="What it is, e.g. Custom printed kraft bags 10x7x12, navy logo" className={input} />
        <input value={form.cc} onChange={e => setForm({ ...form, cc: e.target.value })} placeholder="CC (optional, comma separated)" className={input} />
        <textarea value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} rows={2} placeholder="Note to the customer (optional)" className={input} />
        <div className="flex items-center gap-2">
          <button type="button" disabled={busy === 'send'} onClick={send} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50">{busy === 'send' ? 'Sending…' : 'Send proof for approval'}</button>
          {msg && <span className="text-[11px] text-gray-600">{msg}</span>}
        </div>
      </div>
    </div>
  )
}
