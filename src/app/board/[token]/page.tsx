'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
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
const dueBadge = (last: string | null) => {
  if (!last) return { t: 'no log yet', c: '#b45309', b: '#fef3c7' }
  const mins = (Date.now() - new Date(last).getTime()) / 60000
  if (mins >= 60) return { t: 'log due', c: '#b91c1c', b: '#fee2e2' }
  return { t: `logged ${Math.round(mins)}m ago`, c: '#047857', b: '#d1fae5' }
}

export default function ShiftBoard() {
  const params = useParams()
  const token = Array.isArray(params.token) ? params.token[0] : (params.token as string)
  const [data, setData] = useState<any | null>(null)
  const [err, setErr] = useState('')
  const [name, setName] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [forms, setForms] = useState<Record<string, any>>({})
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const feedRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/board/${token}?t=${Date.now()}`, { cache: 'no-store' })
      if (!r.ok) { setErr((await r.json()).error || 'Not found'); return }
      setData(await r.json())
    } catch { setErr('Could not load.') }
  }, [token])
  useEffect(() => { load() }, [load])
  useEffect(() => { const id = setInterval(load, 20000); return () => clearInterval(id) }, [load])
  useEffect(() => { try { const n = localStorage.getItem('bg_op_name'); if (n) setName(n) } catch {} }, [])
  useEffect(() => { try { if (name) localStorage.setItem('bg_op_name', name) } catch {} }, [name])

  async function sendMsg() {
    if (!msg.trim()) return
    setBusy(true)
    try {
      await fetch(`/api/board/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'message', author: name || 'Someone', body: msg }) })
      setMsg(''); await load(); setTimeout(() => feedRef.current?.scrollTo(0, feedRef.current.scrollHeight), 50)
    } catch {}
    setBusy(false)
  }
  async function logJob(job: any) {
    const f = forms[job.op_token] || {}
    setBusy(true)
    try {
      await fetch(`/api/board/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'log', op_token: job.op_token, output_qty: f.output_qty ?? '', unit: f.unit || 'cases', running_status: f.running_status || 'Running', note: f.note || '', operator: name || job.operator || '' }) })
      setOpenId(null); await load()
    } catch {}
    setBusy(false)
  }
  const setF = (id: string, patch: any) => setForms(s => ({ ...s, [id]: { ...(s[id] || { unit: 'cases', running_status: 'Running', output_qty: '', note: '' }), ...patch } }))

  if (err && !data) return <div className="min-h-screen grid place-items-center p-6 text-center"><div><p className="text-2xl mb-2">🚫</p><p className="text-gray-600">{err}</p></div></div>
  if (!data) return <div className="min-h-screen grid place-items-center text-gray-400">Loading…</div>

  return (
    <div className="min-h-screen" style={{ background: '#F1F3F7' }}>
      <div className="mx-auto max-w-md pb-40">
        <div className="px-5 pt-6 pb-4 text-white sticky top-0 z-20" style={{ background: '#00854a' }}>
          <p className="text-white/80 text-xs uppercase tracking-wide">beyondGREEN · Production</p>
          <h1 className="text-2xl font-black leading-tight">Shift Board</h1>
          <p className="text-white/90 text-sm">{fmtDate(data.date)}</p>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name (shown on your posts)" className="mt-2 w-full rounded-lg px-3 py-2 text-sm text-gray-900" />
        </div>

        <div className="p-4 space-y-3">
          <p className="text-xs font-bold text-gray-400 uppercase px-1">Today’s jobs — tap to log every hour</p>
          {data.jobs.length === 0 && <div className="bg-white rounded-xl p-6 text-center text-sm text-gray-400">Nothing scheduled for today yet.</div>}
          {data.jobs.map((j: any) => {
            const isOpen = openId === j.op_token
            const f = forms[j.op_token] || { unit: 'cases', running_status: 'Running', output_qty: '', note: '' }
            const due = dueBadge(j.last_log_at)
            return (
              <div key={j.op_token} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <button onClick={() => setOpenId(isOpen ? null : j.op_token)} className="w-full text-left px-4 py-3">
                  <div className="flex items-center justify-between">
                    <p className="font-black text-[#1A1D2E]">{j.machine || 'No machine'} · {j.code}</p>
                    <span className="text-[11px] font-bold rounded-full px-2 py-0.5" style={{ background: due.b, color: due.c }}>{due.t}</span>
                  </div>
                  <p className="text-sm text-gray-600">{j.item}{j.qty != null ? ` · ${Number(j.qty).toLocaleString()} ${j.uom || ''}` : ''}</p>
                  <p className="text-xs text-gray-400">{j.scheduled_start ? fmtClock(j.scheduled_start) + ' · ' : ''}{j.operator || 'unassigned'} · logged {Number(j.actual_qty || 0).toLocaleString()} {j.unit}</p>
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
                    <div className="grid grid-cols-3 gap-2">
                      {STATUS.map(s => <button key={s.k} onClick={() => setF(j.op_token, { running_status: s.k })} className="rounded-xl py-2.5 text-sm font-bold text-white" style={{ background: f.running_status === s.k ? s.bg : '#cbd5e1' }}>{s.label}</button>)}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <input inputMode="numeric" value={f.output_qty} onChange={e => setF(j.op_token, { output_qty: e.target.value })} placeholder="Output this hour" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-lg font-bold" />
                      <select value={f.unit} onChange={e => setF(j.op_token, { unit: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-3 text-base bg-white">{UNITS.map(u => <option key={u} value={u}>{u}</option>)}</select>
                    </div>
                    <input value={f.note} onChange={e => setF(j.op_token, { note: e.target.value })} placeholder="Note (optional)" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-base" />
                    <button onClick={() => logJob(j)} disabled={busy} className="w-full rounded-xl py-3 text-white font-black disabled:opacity-50" style={{ background: '#00854a' }}>{busy ? 'Saving…' : 'Log this hour'}</button>
                  </div>
                )}
              </div>
            )
          })}

          <p className="text-xs font-bold text-gray-400 uppercase px-1 pt-2">Team feed</p>
          <div ref={feedRef} className="bg-white rounded-2xl shadow-sm p-3 space-y-2 max-h-[340px] overflow-y-auto">
            {(data.feed || []).length === 0 ? <p className="text-sm text-gray-400 text-center py-4">No messages yet.</p> : (data.feed || []).map((m: any, i: number) => (
              <div key={i} className={`rounded-xl px-3 py-2 ${m.kind === 'log' ? 'bg-emerald-50' : m.kind === 'system' ? 'bg-blue-50' : 'bg-gray-50'}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-bold text-[#1A1D2E]">{m.kind === 'system' ? '📋 System' : m.author || 'Someone'}</span>
                  <span className="text-[10px] text-gray-400">{fmtTime(m.created_at)}</span>
                </div>
                <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">{m.body}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-3">
          <div className="mx-auto max-w-md flex gap-2">
            <input value={msg} onChange={e => setMsg(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') sendMsg() }} placeholder="Message the team…" className="flex-1 border border-gray-200 rounded-full px-4 py-2.5 text-base" />
            <button onClick={sendMsg} disabled={busy || !msg.trim()} className="rounded-full px-5 py-2.5 text-white font-bold disabled:opacity-40" style={{ background: '#00854a' }}>Send</button>
          </div>
        </div>
      </div>
    </div>
  )
}
