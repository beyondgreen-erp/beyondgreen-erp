'use client'
/* eslint-disable @typescript-eslint/no-explicit-any, @next/next/no-img-element */
// Public customer proof page (proof host, no login): view the proof, approve it or ask for changes.
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

export const dynamic = 'force-dynamic'

const fmt = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''

export default function CustomerProofPage() {
  const { token } = useParams() as { token: string }
  const [p, setP] = useState<any>(null)
  const [err, setErr] = useState('')
  const [mode, setMode] = useState<'approved' | 'changes_requested' | null>(null)
  const [form, setForm] = useState({ name: '', email: '', note: '', confirmed: false })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await fetch(`/api/proof/approve/${token}`, { cache: 'no-store' })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setErr(j.error || 'This proof link is not valid.'); return }
    setP(j)
    if (j.recipient_name) setForm(f => ({ ...f, name: f.name || j.recipient_name }))
  }, [token])
  useEffect(() => { load() }, [load])

  const submit = async () => {
    if (!mode) return
    setBusy(true); setErr('')
    const r = await fetch(`/api/proof/approve/${token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: mode, ...form }) })
    const j = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) { setErr(j.error || 'Something went wrong. Please try again.'); return }
    setDone(mode); load()
  }

  if (err && !p) return <Shell><p className="text-gray-600 text-center py-16">{err}</p></Shell>
  if (!p) return <Shell><p className="text-gray-400 text-center py-16">Loading your proof…</p></Shell>

  const open = p.status === 'sent'
  return (
    <Shell>
      <div className="space-y-5">
        <div>
          <p className="text-xs uppercase tracking-wide text-green-700 font-semibold">Proof {p.round_no > 1 ? `round ${p.round_no}` : ''} for your approval</p>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">{p.title || 'Your custom order'}</h1>
          {p.order_ref && <p className="text-sm text-gray-500">Order {p.order_ref}</p>}
        </div>

        {p.message && <div className="border-l-4 border-green-600 bg-gray-50 rounded-lg px-4 py-3 text-sm whitespace-pre-wrap">{p.message}</div>}

        <div className="bg-white border border-gray-200 rounded-2xl p-3">
          {p.is_image && p.image_url
            ? <img src={p.image_url} alt="Proof" className="w-full h-auto rounded-xl" />
            : <p className="text-sm text-gray-600 p-4">Your proof is a file: <a className="text-green-700 underline" href={p.download_url} target="_blank" rel="noreferrer">{p.file_name}</a></p>}
          {p.download_url && <p className="text-right mt-2"><a href={p.download_url} target="_blank" rel="noreferrer" className="text-xs text-gray-500 underline">Open full size</a></p>}
        </div>
        <p className="text-xs text-gray-500">This is a digital mockup. Colors on screen can look slightly different from the printed bag.</p>

        {!open && (
          <div className={`rounded-2xl p-5 ${p.status === 'approved' ? 'bg-green-50 border border-green-200' : p.status === 'changes_requested' ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50 border border-gray-200'}`}>
            {p.status === 'approved' && <p className="font-semibold text-green-800">✓ Approved{p.decided_name ? ` by ${p.decided_name}` : ''} on {fmt(p.decided_at)}. Thank you! We will start printing.</p>}
            {p.status === 'changes_requested' && <p className="font-semibold text-amber-800">Thank you{p.decided_name ? `, ${p.decided_name}` : ''}. We received your changes on {fmt(p.decided_at)} and will send you an updated proof.</p>}
            {p.status === 'cancelled' && <p className="font-semibold text-gray-700">This proof was replaced by a newer one. Please use the latest email from beyondGREEN.</p>}
            {p.decision_note && <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{p.decision_note}</p>}
            {done && <p className="text-sm text-gray-600 mt-2">You can close this page.</p>}
          </div>
        )}

        {open && (
          <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setMode('approved')} className={`py-3 rounded-xl font-semibold border ${mode === 'approved' ? 'bg-green-600 text-white border-green-600' : 'border-green-600 text-green-700'}`}>Approve proof</button>
              <button onClick={() => setMode('changes_requested')} className={`py-3 rounded-xl font-semibold border ${mode === 'changes_requested' ? 'bg-amber-500 text-white border-amber-500' : 'border-amber-500 text-amber-700'}`}>Request changes</button>
            </div>
            {mode && (
              <div className="space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <label className="text-sm"><span className="text-gray-600">Your name *</span><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" /></label>
                  <label className="text-sm"><span className="text-gray-600">Email</span><input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" /></label>
                </div>
                <label className="text-sm block"><span className="text-gray-600">{mode === 'approved' ? 'Comments (optional)' : 'What would you like changed? *'}</span>
                  <textarea rows={3} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" /></label>
                {mode === 'approved' && (
                  <label className="flex items-start gap-2 text-sm text-gray-700"><input type="checkbox" className="mt-1" checked={form.confirmed} onChange={e => setForm({ ...form, confirmed: e.target.checked })} />
                    I checked the spelling, colors, size and placement, and I approve this proof for printing.</label>
                )}
                {err && <p className="text-sm text-red-600">{err}</p>}
                <button disabled={busy} onClick={submit} className={`w-full py-3 rounded-xl text-white font-semibold disabled:opacity-60 ${mode === 'approved' ? 'bg-green-600' : 'bg-amber-500'}`}>
                  {busy ? 'Sending…' : mode === 'approved' ? 'Submit approval' : 'Send my changes'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F5F6FA]">
      <header className="bg-[#14532D] text-white"><div className="max-w-3xl mx-auto px-4 py-4 font-bold text-lg">beyondGREEN <span className="font-normal text-sm opacity-80 ml-2">Proof approval</span></div></header>
      <main className="max-w-3xl mx-auto px-4 py-6">{children}</main>
      <footer className="max-w-3xl mx-auto px-4 pb-8 text-xs text-gray-400">beyondGREEN biotech, Inc. · 1202 E. Wakeham Ave., Santa Ana, CA 92705 · (866) 364-9466</footer>
    </div>
  )
}
