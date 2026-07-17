'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

export default function WarehousePortalPage() {
  const params = useParams()
  const token = Array.isArray(params.token) ? params.token[0] : (params.token as string)
  const [data, setData] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/wh/${token}`, { cache: 'no-store' })
      if (!r.ok) { setErr((await r.json()).error || 'Not found'); setLoading(false); return }
      setData(await r.json())
    } catch (e) { setErr('Could not load.') }
    setLoading(false)
  }, [token])
  useEffect(() => { load() }, [load])

  if (loading) return <div className="min-h-screen grid place-items-center text-gray-400">Loading…</div>
  if (err && !data) return <div className="min-h-screen grid place-items-center p-6 text-center"><div><p className="text-2xl mb-2">🚫</p><p className="text-gray-600">{err}</p></div></div>

  const tickets = data.tickets || []

  return (
    <div className="min-h-screen" style={{ background: '#F1F3F7' }}>
      <div className="mx-auto max-w-md">
        <div className="px-5 pt-6 pb-5 text-white" style={{ background: '#00854a' }}>
          <p className="text-white/80 text-xs uppercase tracking-wide">beyondGREEN · Warehouse</p>
          <h1 className="text-2xl font-black leading-tight">Open Tickets</h1>
          <p className="text-white/90 text-sm mt-0.5">{tickets.length} ticket{tickets.length === 1 ? '' : 's'} to work</p>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between px-1">
            <p className="text-xs font-semibold text-gray-400 uppercase">Tap a ticket to start</p>
            <button onClick={() => { setLoading(true); load() }} className="text-xs font-semibold text-emerald-700">↻ Refresh</button>
          </div>

          {tickets.length === 0 && (
            <div className="rounded-xl bg-white border border-[#E4E6EE] px-4 py-10 text-center text-gray-400">
              <p className="text-3xl mb-2">✅</p>No open tickets right now.
            </div>
          )}

          {tickets.map((t: any) => {
            const isPull = t.type === 'pull'
            const accent = isPull ? '#df2f4a' : '#00854a'
            return (
              <a key={t.token} href={`/t/${t.token}`} className="block rounded-xl border bg-white overflow-hidden active:scale-[0.99] transition" style={{ borderColor: '#E4E6EE' }}>
                <div className="flex items-stretch">
                  <div className="w-1.5 shrink-0" style={{ background: accent }} />
                  <div className="flex-1 min-w-0 px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-white rounded-full px-2 py-0.5" style={{ background: accent }}>{isPull ? 'PULL' : 'ADD'}</span>
                      <span className="font-black text-gray-800">{t.container?.name || 'Container'}</span>
                      <span className="text-[11px] text-gray-400">{t.ticket_no}</span>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">{t.line_count} item{t.line_count === 1 ? '' : 's'}{t.done_count ? ` · ${t.done_count} done` : ''}{t.note ? ' · has note' : ''}</p>
                  </div>
                  <div className="shrink-0 self-center pr-4 text-2xl text-gray-300">›</div>
                </div>
              </a>
            )
          })}
          <p className="text-center text-[11px] text-gray-400 pt-4">Bookmark this page · beyondGREEN Containers</p>
        </div>
      </div>
    </div>
  )
}
