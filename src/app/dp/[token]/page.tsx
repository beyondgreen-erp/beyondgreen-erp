'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

const UNITS = ['cases', 'pieces', 'lbs', 'rolls', 'boxes']
const STATUS = [
  { k: 'Running', bg: '#00854a', label: '▶ Running' },
  { k: 'Down', bg: '#df2f4a', label: '■ Down' },
  { k: 'Offline', bg: '#6b7280', label: '○ Offline' },
]
const fmtDate = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : ''
const fmtTime = (d: string | null) => d ? new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''

export default function DailyPlanPortal() {
  const params = useParams()
  const token = Array.isArray(params.token) ? params.token[0] : (params.token as string)
  const [data, setData] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [forms, setForms] = useState<Record<string, any>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/dp/${token}?t=${Date.now()}`, { cache: 'no-store' })
      if (!r.ok) { setErr((await r.json()).error || 'Not found'); setLoading(false); return }
      setData(await r.json())
    } catch { setErr('Could not load.') }
    setLoading(false)
  }, [token])
  useEffect(() => { load() }, [load])

  function openForm(ln: any) {
    setOpenId(openId === ln.id ? null : ln.id)
    setForms(f => f[ln.id] ? f : ({ ...f, [ln.id]: { output_qty: '', unit: 'cases', running_status: 'Running', note: '', operator: ln.operator || '' } }))
  }
  function setField(id: string, patch: any) { setForms(f => ({ ...f, [id]: { ...f[id], ...patch } })) }

  async function submit(ln: any) {
    const form = forms[ln.id]
    setSaving(ln.id)
    try {
      const r = await fetch(`/api/dp/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ line_id: ln.id, ...form }) })
      const j = await r.json()
      if (!r.ok) { alert(j.error || 'Could not save.'); setSaving(null); return }
      setSaving(null); setOpenId(null); setSavedId(ln.id); setTimeout(() => setSavedId(null), 2500)
      setForms(f => ({ ...f, [ln.id]: { ...f[ln.id], output_qty: '', note: '' } }))
      load()
    } catch { alert('Could not save.'); setSaving(null) }
  }

  if (loading) return <div className="min-h-screen grid place-items-center text-gray-400">Loading…</div>
  if (err && !data) return <div className="min-h-screen grid place-items-center p-6 text-center"><div><p className="text-2xl mb-2">🚫</p><p className="text-gray-600">{err}</p></div></div>

  const lines = data.lines || []
  return (
    <div className="min-h-screen" style={{ background: '#F1F3F7' }}>
      <div className="mx-auto max-w-md">
        <div className="px-5 pt-6 pb-5 text-white" style={{ background: '#00854a' }}>
          <p className="text-white/80 text-xs uppercase tracking-wide">beyondGREEN · Production</p>
          <h1 className="text-2xl font-black leading-tight">{fmtDate(data.plan?.plan_date)}</h1>
          <p className="text-white/90 text-sm mt-0.5">Log your machine&rsquo;s output every 2 hours</p>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between px-1">
            <p className="text-xs font-semibold text-gray-400 uppercase">Tap your machine to log</p>
            <button onClick={() => { setLoading(true); load() }} className="text-xs font-semibold text-emerald-700">↻ Refresh</button>
          </div>

          {lines.map((ln: any) => {
            const st = STATUS.find(s => s.k === (ln.last_status || ln.planned_status)) || null
            const isOpen = openId === ln.id
            const f = forms[ln.id] || {}
            const offlinePlan = (ln.product || '').toLowerCase() === 'offline'
            return (
              <div key={ln.id} className="rounded-xl border bg-white overflow-hidden" style={{ borderColor: '#E4E6EE' }}>
                <button onClick={() => openForm(ln)} className="w-full flex items-stretch text-left active:bg-gray-50">
                  <div className="w-1.5 shrink-0" style={{ background: st?.bg || '#c9ced8' }} />
                  <div className="flex-1 min-w-0 px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-black text-gray-800 text-lg">{ln.machine_code}</span>
                      {!offlinePlan && <span className="text-sm text-gray-600">{ln.product}</span>}
                      {offlinePlan && <span className="text-xs font-semibold text-gray-400">Offline</span>}
                    </div>
                    <p className="text-[12px] text-gray-500 mt-0.5">
                      {ln.operator ? `Operator: ${ln.operator}` : 'No operator set'}
                      {ln.log_count > 0 && <> · <span className="font-semibold text-gray-700">{ln.actual_qty} {ln.unit}</span> so far · last {fmtTime(ln.last_log_at)}</>}
                    </p>
                  </div>
                  <div className="shrink-0 self-center pr-3">
                    {savedId === ln.id ? <span className="text-emerald-600 text-sm font-bold">Saved ✓</span>
                      : st ? <span className="text-[10px] font-bold text-white rounded-full px-2 py-0.5" style={{ background: st.bg }}>{ln.last_status || ln.planned_status}</span>
                      : <span className="text-2xl text-gray-300">›</span>}
                  </div>
                </button>

                {isOpen && (
                  <div className="px-4 pb-4 pt-1 border-t border-[#EEF0F4]">
                    <div className="grid grid-cols-3 gap-2 mt-3">
                      {STATUS.map(s => (
                        <button key={s.k} onClick={() => setField(ln.id, { running_status: s.k })}
                          className="text-xs font-bold rounded-lg py-2 border"
                          style={f.running_status === s.k ? { background: s.bg, color: '#fff', borderColor: s.bg } : { background: '#fff', color: '#6b7280', borderColor: '#E4E6EE' }}>
                          {s.label}
                        </button>
                      ))}
                    </div>
                    {f.running_status !== 'Running' ? null : (
                      <div className="flex gap-2 mt-3">
                        <input type="number" inputMode="decimal" value={f.output_qty} onChange={e => setField(ln.id, { output_qty: e.target.value })}
                          placeholder="Output made" className="flex-1 border border-[#E4E6EE] rounded-lg px-3 py-2.5 text-base" />
                        <select value={f.unit} onChange={e => setField(ln.id, { unit: e.target.value })} className="border border-[#E4E6EE] rounded-lg px-2 py-2.5 text-sm bg-white">
                          {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </div>
                    )}
                    <input value={f.operator} onChange={e => setField(ln.id, { operator: e.target.value })} placeholder="Your name" className="w-full border border-[#E4E6EE] rounded-lg px-3 py-2.5 text-base mt-2" />
                    <input value={f.note} onChange={e => setField(ln.id, { note: e.target.value })} placeholder="Note (optional — e.g. reason if down)" className="w-full border border-[#E4E6EE] rounded-lg px-3 py-2.5 text-sm mt-2" />
                    <button onClick={() => submit(ln)} disabled={saving === ln.id} className="w-full mt-3 rounded-lg py-3 text-white font-bold disabled:opacity-50" style={{ background: '#00854a' }}>
                      {saving === ln.id ? 'Saving…' : 'Submit log'}
                    </button>
                    {ln.logs && ln.logs.length > 0 && (
                      <div className="mt-3">
                        <p className="text-[10px] uppercase font-bold text-gray-400 mb-1">Recent logs</p>
                        {ln.logs.map((lg: any, i: number) => (
                          <p key={i} className="text-[11px] text-gray-500">{fmtTime(lg.logged_at)} · {lg.running_status}{lg.output_qty != null ? ` · ${lg.output_qty} ${lg.unit}` : ''}{lg.operator ? ` · ${lg.operator}` : ''}{lg.note ? ` · ${lg.note}` : ''}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {lines.length === 0 && <div className="rounded-xl bg-white border border-[#E4E6EE] px-4 py-10 text-center text-gray-400">No machines in this plan.</div>}
          <p className="text-center text-[11px] text-gray-400 pt-3">Bookmark this page · beyondGREEN Production</p>
        </div>
      </div>
    </div>
  )
}
