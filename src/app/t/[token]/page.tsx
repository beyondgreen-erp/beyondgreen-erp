'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

export default function WarehouseTicketPage() {
  const params = useParams()
  const token = Array.isArray(params.token) ? params.token[0] : (params.token as string)
  const [data, setData] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/ct/${token}`, { cache: 'no-store' })
      if (!r.ok) { setErr((await r.json()).error || 'Not found'); setLoading(false); return }
      setData(await r.json())
    } catch (e: any) { setErr('Could not load ticket.') }
    setLoading(false)
  }, [token])
  useEffect(() => { load() }, [load])

  async function post(bodyObj: any) {
    setBusy(true)
    try { const r = await fetch(`/api/ct/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyObj) }); const j = await r.json(); if (r.ok) setData(j); else setErr(j.error || 'Error') } catch (e) { setErr('Network error') }
    setBusy(false)
  }

  if (loading) return <div className="min-h-screen grid place-items-center text-gray-400">Loading…</div>
  if (err && !data) return <div className="min-h-screen grid place-items-center p-6 text-center"><div><p className="text-2xl mb-2">🚫</p><p className="text-gray-600">{err}</p></div></div>

  const t = data.ticket
  const c = data.container
  const isPull = t.type === 'pull'
  const lines = t.lines || []
  const doneCount = lines.filter((l: any) => l.done).length
  const allDone = lines.length > 0 && doneCount === lines.length
  const completed = t.status === 'completed'
  const accent = isPull ? '#df2f4a' : '#00854a'

  return (
    <div className="min-h-screen" style={{ background: '#F1F3F7' }}>
      <div className="mx-auto max-w-md">
        <div className="px-5 pt-6 pb-5 text-white" style={{ background: accent }}>
          <p className="text-white/80 text-xs uppercase tracking-wide">{isPull ? 'Pull from container' : 'Add to container'}</p>
          <h1 className="text-2xl font-black leading-tight">{c?.name}</h1>
          <p className="text-white/90 text-sm mt-0.5">{t.ticket_no}{c?.label ? ` · ${c.label}` : ''}</p>
        </div>

        <div className="p-4 space-y-3">
          {completed && <div className="rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-3 text-center font-semibold">✓ This ticket is complete. Thank you!</div>}
          {t.note && <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3"><span className="font-semibold">Note: </span>{t.note}</div>}

          <p className="text-xs font-semibold text-gray-400 uppercase px-1">{isPull ? 'Pull these items' : 'Add these items'} · {doneCount}/{lines.length} done</p>

          {lines.map((l: any) => (
            <button key={l.id} disabled={completed || busy} onClick={() => post({ action: 'toggle', lineId: l.id, done: !l.done })}
              className="w-full flex items-center gap-3 rounded-xl border bg-white px-4 py-4 text-left active:scale-[0.99] transition disabled:opacity-70"
              style={{ borderColor: l.done ? accent : '#E4E6EE' }}>
              <span className="shrink-0 w-8 h-8 rounded-full grid place-items-center text-white text-lg font-bold" style={{ background: l.done ? accent : '#cbd2dc' }}>{l.done ? '✓' : ''}</span>
              <span className="flex-1 min-w-0">
                <span className={`block font-semibold ${l.done ? 'line-through text-gray-400' : 'text-gray-800'}`}>{l.item_name || l.sku}</span>
                {l.sku && l.item_name ? <span className="block text-[11px] font-mono text-gray-400">{l.sku}</span> : null}
              </span>
              <span className="shrink-0 text-right"><span className="block text-xl font-black" style={{ color: accent }}>{Number(l.quantity)}</span><span className="block text-[11px] text-gray-400">{l.uom || 'units'}</span></span>
            </button>
          ))}

          {!completed && (
            <div className="pt-2 space-y-2">
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name (optional)" className="w-full bg-white border border-[#E4E6EE] rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2" style={{}} />
              <button disabled={busy || lines.length === 0} onClick={() => { if (confirm(isPull ? 'Confirm items pulled and update the container?' : 'Confirm items added and update the container?')) post({ action: 'complete', by: name }) }}
                className="w-full rounded-xl py-4 text-white text-lg font-bold disabled:opacity-50" style={{ background: allDone ? accent : '#9aa3b2' }}>
                {allDone ? (isPull ? 'Confirm all pulled ✓' : 'Confirm all added ✓') : `Mark done (${doneCount}/${lines.length})`}
              </button>
              {!allDone && <p className="text-center text-[11px] text-gray-400">Tap each item as you {isPull ? 'pull' : 'load'} it. You can still confirm early.</p>}
              {err && <p className="text-center text-xs text-red-500">{err}</p>}
            </div>
          )}
          <p className="text-center text-[11px] text-gray-400 pt-4">beyondGREEN · Containers</p>
        </div>
      </div>
    </div>
  )
}
