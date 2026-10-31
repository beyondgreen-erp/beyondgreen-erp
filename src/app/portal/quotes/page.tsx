'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useState } from 'react'
import PortalShell, { api, usePortal, GREEN, INK, cardCls, inputCls, labelCls, btnCls, btnGhostCls, fmtDate, money, qty, Pill, Empty } from '@/components/portal/PortalShell'

function QuotesBody() {
  const { account } = usePortal()
  const [list, setList] = useState<any[] | null>(null)
  const [accepting, setAccepting] = useState<any | null>(null)
  const [changing, setChanging] = useState<any | null>(null)
  const [sig, setSig] = useState('')
  const [po, setPo] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [toast, setToast] = useState('')
  const load = useCallback(async () => { const { data } = await api('quotes'); setList(data.quotes || []) }, [])
  useEffect(() => { load() }, [load])

  async function accept() {
    setErr(''); setBusy(true)
    try {
      const { ok, data } = await api('quote-accept', { id: accepting.id, signature: sig, po_number: po })
      if (!ok) { setErr(data.error || 'Could not accept.'); return }
      setAccepting(null); setSig(''); setPo(''); setToast(`Quote ${accepting.number} accepted. We are turning it into an order now.`); load()
    } finally { setBusy(false) }
  }
  async function requestChanges() {
    setErr(''); setBusy(true)
    try {
      const { ok, data } = await api('quote-changes', { id: changing.id, message: msg })
      if (!ok) { setErr(data.error || 'Could not send.'); return }
      setChanging(null); setMsg(''); setToast('Thanks. We will revise the quote and let you know.')
    } finally { setBusy(false) }
  }

  if (list === null) return <Empty>Loading…</Empty>
  return (
    <div className="space-y-3">
      {toast && <div className="rounded-xl bg-[#E4F7EE] border border-[#BFE6D0] text-[#0F5132] px-4 py-3 text-sm">{toast}</div>}
      {list.length === 0 && <Empty>No quotes yet. Start a project or message us and we will send one here.</Empty>}
      {list.map(q => (
        <div key={q.id} className={`${cardCls} p-4`}>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-bold" style={{ color: INK }}>{q.name || `Quote ${q.number}`}</p>
              <p className="text-xs text-gray-500 mt-0.5">{q.number} · {fmtDate(q.date)}{q.expires ? ` · valid until ${fmtDate(q.expires)}` : ''}{q.terms ? ` · ${q.terms}` : ''}{q.price_term ? ` · ${q.price_term}` : ''}</p>
            </div>
            <Pill tone={q.stage?.tone}>{q.estimate ? 'Estimate' : q.stage?.label}</Pill>
          </div>
          {q.lines.length > 0 && (
            <div className="overflow-x-auto mt-3"><table className="w-full text-xs min-w-[480px]">
              <thead><tr className="text-gray-400 text-[10px] uppercase"><th className="text-left py-1.5">Item</th><th className="text-right py-1.5">Qty</th><th className="text-right py-1.5">Unit price</th><th className="text-right py-1.5">Total</th></tr></thead>
              <tbody>{q.lines.map((l: any, i: number) => <tr key={i} className="border-t border-[#F3F4F8]"><td className="py-1.5 pr-2">{l.sku ? <b>{l.sku} </b> : null}{l.description}{l.pcs_per_case ? <span className="text-gray-400"> · {qty(l.pcs_per_case)}/case</span> : null}</td><td className="text-right">{qty(l.quantity)} {l.unit || ''}</td><td className="text-right">{l.unit_price != null ? money(l.unit_price) : ''}</td><td className="text-right">{l.line_total != null && !q.estimate ? money(l.line_total) : ''}</td></tr>)}</tbody>
            </table></div>
          )}
          {q.total != null && <p className="text-right text-sm font-bold mt-2" style={{ color: INK }}>Total {money(q.total)}</p>}
          {q.notes && <p className="text-xs text-gray-500 mt-2 whitespace-pre-wrap">{q.notes}</p>}
          <div className="flex flex-wrap gap-2 mt-3">
            {q.can_accept && <button onClick={() => { setAccepting(q); setErr('') }} disabled={!account?.approved} className={btnCls} style={{ background: GREEN }}>Accept quote</button>}
            {['Sent', 'Expired'].includes(q.status) && <button onClick={() => { setChanging(q); setErr('') }} className={btnGhostCls}>{q.status === 'Expired' ? 'Ask for a refreshed quote' : 'Request changes'}</button>}
          </div>
          {q.can_accept && !account?.approved && <p className="text-[11px] text-amber-700 mt-1">Accepting online unlocks once your account is approved.</p>}
        </div>
      ))}

      {(accepting || changing) && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 bg-black/40" onClick={() => { setAccepting(null); setChanging(null) }}>
          <div className="w-full max-w-md bg-white rounded-2xl p-5 space-y-3" onClick={e => e.stopPropagation()}>
            {accepting ? (<>
              <h3 className="font-bold text-lg" style={{ color: INK }}>Accept quote {accepting.number}</h3>
              <p className="text-sm text-gray-600">{accepting.total != null ? <>Total <b>{money(accepting.total)}</b>. </> : null}By accepting you authorize beyondGREEN to schedule this order under the quote terms.</p>
              <label className="block"><span className={labelCls}>Your PO number (optional)</span><input className={inputCls} value={po} onChange={e => setPo(e.target.value)} /></label>
              <label className="block"><span className={labelCls}>Type your full name to sign *</span><input className={inputCls} value={sig} onChange={e => setSig(e.target.value)} /></label>
              {err && <p className="text-sm text-red-600">{err}</p>}
              <div className="flex gap-2 justify-end"><button onClick={() => setAccepting(null)} className={btnGhostCls}>Cancel</button><button onClick={accept} disabled={busy || !sig.trim()} className={btnCls} style={{ background: GREEN }}>{busy ? 'Accepting…' : 'Accept and sign'}</button></div>
            </>) : (<>
              <h3 className="font-bold text-lg" style={{ color: INK }}>{changing.status === 'Expired' ? 'Refresh' : 'Changes to'} quote {changing.number}</h3>
              <textarea rows={5} className={inputCls} value={msg} onChange={e => setMsg(e.target.value)} placeholder="Quantities, items, pricing, delivery, terms…" />
              {err && <p className="text-sm text-red-600">{err}</p>}
              <div className="flex gap-2 justify-end"><button onClick={() => setChanging(null)} className={btnGhostCls}>Cancel</button><button onClick={requestChanges} disabled={busy || !msg.trim()} className={btnCls} style={{ background: GREEN }}>{busy ? 'Sending…' : 'Send'}</button></div>
            </>)}
          </div>
        </div>
      )}
    </div>
  )
}

export default function QuotesPage() {
  return <PortalShell title="Quotes" subtitle="Review pricing, accept online, or ask for changes."><QuotesBody /></PortalShell>
}
