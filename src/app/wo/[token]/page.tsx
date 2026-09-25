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
const fmtClock = (t: string | null) => { if (!t) return ''; const m = /^(\d{1,2}):(\d{2})/.exec(t); if (!m) return ''; let h = +m[1]; const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${m[2]} ${ap}` }

export default function WorkOrderPortal() {
  const params = useParams()
  const token = Array.isArray(params.token) ? params.token[0] : (params.token as string)
  const [data, setData] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [form, setForm] = useState<any>({ output_qty: '', unit: 'cases', running_status: 'Running', note: '', operator: '' })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/wo/${token}?t=${Date.now()}`, { cache: 'no-store' })
      if (!r.ok) { setErr((await r.json()).error || 'Not found'); setLoading(false); return }
      const j = await r.json(); setData(j)
      setForm((f: any) => ({ ...f, operator: f.operator || j.wo?.operator || '', unit: j.unit || 'cases' }))
    } catch { setErr('Could not load.') }
    setLoading(false)
  }, [token])
  useEffect(() => { load() }, [load])

  async function submit() {
    setSaving(true)
    try {
      const r = await fetch(`/api/wo/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const j = await r.json()
      if (!r.ok) { alert(j.error || 'Could not save.'); setSaving(false); return }
      setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2500)
      setForm((f: any) => ({ ...f, output_qty: '', note: '' })); load()
    } catch { alert('Could not save.'); setSaving(false) }
  }

  if (loading) return <div className="min-h-screen grid place-items-center text-gray-400">Loading…</div>
  if (err && !data) return <div className="min-h-screen grid place-items-center p-6 text-center"><div><p className="text-2xl mb-2">🚫</p><p className="text-gray-600">{err}</p></div></div>

  const w = data.wo || {}
  return (
    <div className="min-h-screen" style={{ background: '#F1F3F7' }}>
      <div className="mx-auto max-w-md">
        <div className="px-5 pt-6 pb-5 text-white" style={{ background: '#00854a' }}>
          <p className="text-white/80 text-xs uppercase tracking-wide">beyondGREEN · Production</p>
          <h1 className="text-2xl font-black leading-tight">{w.code}</h1>
          <p className="text-white/90 text-sm mt-0.5">{w.item}{w.qty != null ? ` · ${Number(w.qty).toLocaleString()} ${w.uom || ''}` : ''}</p>
          <p className="text-white/80 text-xs mt-1">{fmtDate(w.scheduled_date)}{w.scheduled_start ? ` · ${fmtClock(w.scheduled_start)}` : ''} · {w.machine || 'no machine'}{w.group ? ` · ${w.group}` : ''}</p>
          <p className="text-white/90 text-sm mt-2 font-semibold">Log output &amp; status every hour while this job runs</p>
        </div>

        <div className="p-4 space-y-4">
          {saved && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-xl px-4 py-2.5 font-semibold">✓ Logged — thank you. Please log again next hour.</div>}

          <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase">Running status</label>
              <div className="grid grid-cols-3 gap-2 mt-1.5">
                {STATUS.map(s => (
                  <button key={s.k} onClick={() => setForm((f: any) => ({ ...f, running_status: s.k }))}
                    className="rounded-xl py-2.5 text-sm font-bold text-white" style={{ background: form.running_status === s.k ? s.bg : '#cbd5e1' }}>{s.label}</button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase">Output this hour</label>
                <input inputMode="numeric" value={form.output_qty} onChange={e => setForm((f: any) => ({ ...f, output_qty: e.target.value }))} placeholder="e.g. 40" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-lg font-bold mt-1.5" />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase">Unit</label>
                <select value={form.unit} onChange={e => setForm((f: any) => ({ ...f, unit: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base mt-1.5 bg-white">
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase">Operator</label>
              <input value={form.operator} onChange={e => setForm((f: any) => ({ ...f, operator: e.target.value }))} placeholder="Your name" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-base mt-1.5" />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase">Note (optional)</label>
              <input value={form.note} onChange={e => setForm((f: any) => ({ ...f, note: e.target.value }))} placeholder="Anything to flag?" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-base mt-1.5" />
            </div>
            <button onClick={submit} disabled={saving} className="w-full rounded-xl py-3.5 text-white text-base font-black disabled:opacity-50" style={{ background: '#00854a' }}>{saving ? 'Saving…' : 'Log this hour'}</button>
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-gray-500 uppercase">Logged so far</p>
              <button onClick={() => { setLoading(true); load() }} className="text-xs font-semibold text-emerald-700">↻ Refresh</button>
            </div>
            <p className="text-2xl font-black text-[#1A1D2E] mt-1">{Number(data.actual_qty || 0).toLocaleString()} <span className="text-sm font-semibold text-gray-400">{data.unit}</span></p>
            <div className="mt-2 space-y-1.5">
              {(data.logs || []).length === 0 ? <p className="text-sm text-gray-400">No logs yet.</p> : (data.logs || []).map((l: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-sm border-t border-gray-100 pt-1.5">
                  <span className="text-gray-500">{fmtTime(l.logged_at)}</span>
                  <span className="font-semibold" style={{ color: l.running_status === 'Down' ? '#df2f4a' : l.running_status === 'Offline' ? '#6b7280' : '#00854a' }}>{l.running_status}</span>
                  <span className="text-[#1A1D2E] font-bold">{l.output_qty != null ? `${Number(l.output_qty).toLocaleString()} ${l.unit || ''}` : '—'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
