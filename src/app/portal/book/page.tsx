'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import PortalShell, { api, GREEN, INK, cardCls, inputCls, labelCls, btnCls, btnGhostCls, Pill, Empty } from '@/components/portal/PortalShell'

const TOPICS = ['New project or product', 'Quote review', 'Order or delivery question', 'Private label or custom printing', 'Certifications and compliance', 'Something else']

function dayKey(iso: string, tz: string) { return new Date(iso).toLocaleDateString('en-CA', { timeZone: tz }) }
function dayLabel(iso: string, tz: string) { return new Date(iso).toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }) }
function timeLabel(iso: string, tz: string) { return new Date(iso).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }) }
function full(iso: string, tz: string) { return new Date(iso).toLocaleString('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) }

function BookBody() {
  const [slots, setSlots] = useState<{ mode: string; tz: string; minutes: number; slots: string[] } | null>(null)
  const [bookings, setBookings] = useState<any[]>([])
  const [day, setDay] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [topic, setTopic] = useState(TOPICS[0])
  const [notes, setNotes] = useState('')
  const [project, setProject] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<any>(null)
  // Show times in the visitor's own zone.
  const viewerTz = useMemo(() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles' } catch { return 'America/Los_Angeles' } }, [])

  const load = useCallback(async () => {
    const [s, b] = await Promise.all([api('slots'), api('bookings')])
    setSlots(s.data); setBookings(b.data.bookings || [])
    const first = (s.data.slots || [])[0]; if (first) setDay(dayKey(first, viewerTz))
  }, [viewerTz])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    if (p.get('project')) setProject(p.get('project'))
    if (p.get('topic')) setTopic(p.get('topic') as string)
  }, [])

  const days = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const s of slots?.slots || []) { const k = dayKey(s, viewerTz); if (!m.has(k)) m.set(k, []); m.get(k)!.push(s) }
    return Array.from(m.entries())
  }, [slots, viewerTz])
  const live = slots?.mode === 'live'
  const togglePick = (s: string) => {
    if (live) { setPicked([s]); return }
    setPicked(p => p.includes(s) ? p.filter(x => x !== s) : p.length >= 3 ? p : [...p, s])
  }

  async function book() {
    setErr('')
    if (!picked.length) { setErr(live ? 'Pick a time.' : 'Pick up to 3 times that work.'); return }
    setBusy(true)
    try {
      const body: any = { topic, notes, quotation_id: project }
      if (live) body.start = picked[0]; else body.preferred = picked
      const { ok, data } = await api('book', body)
      if (!ok) { setErr(data.error || 'Could not book.'); if (data.error && /taken|available/i.test(data.error)) load(); return }
      setDone({ ...data, picked }); setPicked([]); load()
    } finally { setBusy(false) }
  }
  async function cancel(id: string) {
    if (!confirm('Cancel this call?')) return
    const { ok, data } = await api('booking-cancel', { id }); if (!ok) alert(data.error || 'Could not cancel.'); else load()
  }

  if (!slots) return <Empty>Loading availability…</Empty>
  const upcoming = bookings.filter(b => b.status !== 'Cancelled' && (!b.start_at || new Date(b.start_at).getTime() > Date.now() - 3600000))

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-4 items-start">
      <div className={`${cardCls} p-4 sm:p-5 space-y-4`}>
        {done ? (
          <div className="text-center py-6">
            <div className="mx-auto w-12 h-12 rounded-full grid place-items-center text-xl font-bold" style={{ background: '#E4F7EE', color: GREEN }}>✓</div>
            {done.status === 'Confirmed' ? (<>
              <h2 className="text-lg font-bold mt-3" style={{ color: INK }}>You&apos;re booked</h2>
              <p className="text-sm text-gray-600 mt-1">{full(done.picked[0], viewerTz)}</p>
              <p className="text-sm text-gray-600 mt-1">{done.invite_sent ? 'A calendar invite is on its way to your email.' : 'A confirmation is on its way to your email.'}</p>
              {done.zoom && <a href={done.zoom} target="_blank" rel="noreferrer" className={`${btnCls} mt-4`} style={{ background: GREEN }}>Zoom link</a>}
            </>) : (<>
              <h2 className="text-lg font-bold mt-3" style={{ color: INK }}>Request sent</h2>
              <p className="text-sm text-gray-600 mt-1">We will confirm one of your times by email with a Zoom link, usually within a few business hours.</p>
            </>)}
            <button onClick={() => setDone(null)} className={`${btnGhostCls} mt-4 ml-2`}>Book another</button>
          </div>
        ) : (<>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block"><span className={labelCls}>Topic</span>
              <select className={inputCls} value={TOPICS.includes(topic) ? topic : '__custom'} onChange={e => setTopic(e.target.value === '__custom' ? topic : e.target.value)}>
                {!TOPICS.includes(topic) && <option value="__custom">{topic}</option>}
                {TOPICS.map(t => <option key={t}>{t}</option>)}
              </select>
            </label>
            <div className="text-xs text-gray-500 sm:pt-6">{slots.minutes || 30}-minute Zoom call · times shown in your time zone ({viewerTz.replace('_', ' ')})</div>
          </div>
          {!live && <p className="text-[13px] rounded-xl bg-[#F7F8FA] px-3 py-2 text-gray-600">Pick up to 3 times that work for you and we will confirm one.</p>}
          {days.length === 0 ? <p className="text-sm text-gray-500">No open times in the next two weeks. Message us and we will find a time.</p> : (<>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {days.map(([k, list]) => <button key={k} onClick={() => setDay(k)} className={`shrink-0 rounded-xl px-3 py-2 text-left border ${day === k ? 'text-white border-transparent' : 'bg-white border-[#E4E6EE]'}`} style={day === k ? { background: GREEN } : {}}><span className="block text-xs font-bold">{dayLabel(list[0], viewerTz)}</span><span className={`block text-[10px] ${day === k ? 'text-white/80' : 'text-gray-400'}`}>{list.length} open</span></button>)}
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {(days.find(([k]) => k === day)?.[1] || []).map(s => { const on = picked.includes(s); return <button key={s} onClick={() => togglePick(s)} className={`rounded-xl py-2 text-sm font-semibold border ${on ? 'text-white border-transparent' : 'bg-white border-[#E4E6EE] text-gray-700 hover:border-[#037f4c]'}`} style={on ? { background: GREEN } : {}}>{timeLabel(s, viewerTz)}</button> })}
            </div>
          </>)}
          <label className="block"><span className={labelCls}>Anything we should prepare?</span><textarea rows={3} className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} /></label>
          {picked.length > 0 && <p className="text-sm" style={{ color: INK }}>{live ? 'Selected: ' : 'Your picks: '}{picked.map(p => full(p, viewerTz)).join(' · ')}</p>}
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end"><button onClick={book} disabled={busy || !picked.length} className={btnCls} style={{ background: GREEN }}>{busy ? 'Booking…' : live ? 'Book this time' : 'Send my times'}</button></div>
        </>)}
      </div>

      <div className={`${cardCls} p-4`}>
        <p className="text-sm font-bold mb-2" style={{ color: INK }}>Your calls</p>
        {upcoming.length === 0 ? <p className="text-sm text-gray-500">No upcoming calls.</p> : upcoming.map(b => (
          <div key={b.id} className="py-2 border-t border-[#F1F3F9] first:border-0">
            <div className="flex items-start justify-between gap-2"><p className="text-sm font-semibold">{b.topic}</p><Pill tone={b.status === 'Confirmed' ? 'green' : 'amber'}>{b.status === 'Requested' ? 'Awaiting confirmation' : b.status}</Pill></div>
            <p className="text-xs text-gray-500 mt-0.5">{b.start_at ? full(b.start_at, viewerTz) : (b.preferred_times || []).map((p: string) => full(p, viewerTz)).join(' / ')}</p>
            <div className="flex gap-3 mt-1">
              {b.zoom_join_url && <a href={b.zoom_join_url} target="_blank" rel="noreferrer" className="text-xs font-semibold" style={{ color: GREEN }}>Join Zoom</a>}
              <button onClick={() => cancel(b.id)} className="text-xs font-semibold text-gray-400 hover:text-red-600">Cancel</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function BookPage() {
  return <PortalShell title="Book a call" subtitle="Pick a time with our team. You get a Zoom link and a calendar invite."><BookBody /></PortalShell>
}
