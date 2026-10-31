// Call booking for the client portal: availability from the host's Outlook calendar
// (Microsoft Graph, via the mailbox already connected to the ERP), a Zoom meeting per call,
// and an Outlook event that invites the client.
//
// Setup (one time):
//  1. Azure app registration used by the ERP: add the delegated permission Calendars.ReadWrite.
//  2. In the ERP, reconnect the host mailbox (Settings > Email connection) so the token carries it.
//  3. Zoom: create a Server-to-Server OAuth app (scope meeting:write:admin or meeting:write)
//     and set ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET in Vercel.
//     Without those, ZOOM_PERSONAL_MEETING_URL (your personal room link) is used instead.
// If the calendar can't be read, the portal falls back to "request a time" (client picks 3 slots,
// the team confirms) so booking never breaks.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { getOutlookAccessToken } from '@/lib/outlook'

export const BOOKING_HOST = (process.env.PORTAL_BOOKING_HOST || 'rudyp@beyondgreenbiotech.com').toLowerCase()
export const BOOKING_TZ = process.env.PORTAL_BOOKING_TZ || 'America/Los_Angeles'
export const SLOT_MINUTES = Number(process.env.PORTAL_BOOKING_SLOT_MIN || 30)
const DAY_START = process.env.PORTAL_BOOKING_DAY_START || '09:00'
const DAY_END = process.env.PORTAL_BOOKING_DAY_END || '16:30'       // last slot must END by this time
const DAYS_AHEAD = Number(process.env.PORTAL_BOOKING_DAYS || 14)
const MIN_LEAD_HOURS = Number(process.env.PORTAL_BOOKING_LEAD_HOURS || 18)

// Offset (minutes) of a time zone at a given instant, e.g. -420 for PDT.
function tzOffsetMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at)
  const g = (t: string) => Number(parts.find(p => p.type === t)?.value)
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'))
  return Math.round((asUtc - at.getTime()) / 60000)
}

// Wall-clock time in tz -> UTC Date
export function zoned(dateYmd: string, hhmm: string, tz = BOOKING_TZ): Date {
  const [y, m, d] = dateYmd.split('-').map(Number)
  const [hh, mm] = hhmm.split(':').map(Number)
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm))
  const off = tzOffsetMinutes(guess, tz)
  const first = new Date(guess.getTime() - off * 60000)
  const off2 = tzOffsetMinutes(first, tz)   // handles DST edges
  return off2 === off ? first : new Date(guess.getTime() - off2 * 60000)
}

function ymdInTz(at: Date, tz = BOOKING_TZ): { ymd: string; dow: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(at)
  const g = (t: string) => parts.find(p => p.type === t)?.value || ''
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday'))
  return { ymd: `${g('year')}-${g('month')}-${g('day')}`, dow }
}

// All business-hour slots in the window, before removing busy time.
export function candidateSlots(now = new Date()): { start: Date; end: Date }[] {
  const out: { start: Date; end: Date }[] = []
  const earliest = now.getTime() + MIN_LEAD_HOURS * 3600000
  for (let i = 0; i <= DAYS_AHEAD; i++) {
    const day = new Date(now.getTime() + i * 86400000)
    const { ymd, dow } = ymdInTz(day)
    if (dow === 0 || dow === 6) continue
    const dayStart = zoned(ymd, DAY_START)
    const dayEnd = zoned(ymd, DAY_END)
    for (let t = dayStart.getTime(); t + SLOT_MINUTES * 60000 <= dayEnd.getTime(); t += SLOT_MINUTES * 60000) {
      if (t < earliest) continue
      out.push({ start: new Date(t), end: new Date(t + SLOT_MINUTES * 60000) })
    }
  }
  return out
}

export interface Busy { start: number; end: number }

// Busy blocks from the host's Outlook calendar. Returns null when the calendar can't be read.
export async function outlookBusy(from: Date, to: Date): Promise<Busy[] | null> {
  const tokenStr = await getOutlookAccessToken(BOOKING_HOST)
  if (!tokenStr) return null
  const busy: Busy[] = []
  let url: string | null = `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${encodeURIComponent(from.toISOString())}&endDateTime=${encodeURIComponent(to.toISOString())}&$select=start,end,showAs,isCancelled&$top=200`
  let guard = 0
  while (url && guard++ < 10) {
    const r: Response = await fetch(url, { headers: { Authorization: `Bearer ${tokenStr}`, Prefer: 'outlook.timezone="UTC"' } })
    if (!r.ok) return null
    const j: any = await r.json()
    for (const ev of (j.value || []) as any[]) {
      if (ev.isCancelled) continue
      if (ev.showAs === 'free' || ev.showAs === 'workingElsewhere') continue
      const utc = (x: string) => Date.parse(String(x).replace(/\.\d+$/, '') + 'Z')
      busy.push({ start: utc(ev.start.dateTime), end: utc(ev.end.dateTime) })
    }
    url = j['@odata.nextLink'] || null
  }
  return busy
}

export function freeSlots(cands: { start: Date; end: Date }[], busy: Busy[]): { start: Date; end: Date }[] {
  return cands.filter(s => !busy.some(b => s.start.getTime() < b.end && b.start < s.end.getTime()))
}

// ── Zoom ─────────────────────────────────────────────────────
async function zoomToken(): Promise<string | null> {
  const id = process.env.ZOOM_ACCOUNT_ID, cid = process.env.ZOOM_CLIENT_ID, sec = process.env.ZOOM_CLIENT_SECRET
  if (!id || !cid || !sec) return null
  const r = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(id)}`, {
    method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(`${cid}:${sec}`).toString('base64') },
  })
  if (!r.ok) return null
  const j: any = await r.json()
  return j.access_token || null
}

export async function createZoomMeeting(topic: string, start: Date, minutes: number): Promise<{ join_url: string; id: string | null } | null> {
  const t = await zoomToken()
  if (t) {
    const user = process.env.ZOOM_USER || 'me'
    const r = await fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(user)}/meetings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: topic.slice(0, 190), type: 2, start_time: start.toISOString(), duration: minutes, timezone: BOOKING_TZ, settings: { join_before_host: false, waiting_room: true, mute_upon_entry: true } }),
    })
    if (r.ok) { const j: any = await r.json(); if (j.join_url) return { join_url: j.join_url, id: j.id ? String(j.id) : null } }
  }
  const personal = process.env.ZOOM_PERSONAL_MEETING_URL
  return personal ? { join_url: personal, id: null } : null
}

// ── Outlook event (sends the invite to the client) ──────────
export async function createOutlookEvent(opts: { subject: string; html: string; start: Date; end: Date; attendee: { email: string; name?: string | null }; joinUrl?: string | null }): Promise<string | null> {
  const tokenStr = await getOutlookAccessToken(BOOKING_HOST)
  if (!tokenStr) return null
  const r = await fetch('https://graph.microsoft.com/v1.0/me/events', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenStr}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject: opts.subject,
      body: { contentType: 'HTML', content: opts.html },
      start: { dateTime: opts.start.toISOString().replace('Z', ''), timeZone: 'UTC' },
      end: { dateTime: opts.end.toISOString().replace('Z', ''), timeZone: 'UTC' },
      location: { displayName: opts.joinUrl ? 'Zoom' : 'Zoom (link to follow)', locationUri: opts.joinUrl || undefined },
      attendees: [{ emailAddress: { address: opts.attendee.email, name: opts.attendee.name || opts.attendee.email }, type: 'required' }],
      allowNewTimeProposals: true,
      isReminderOn: true,
      reminderMinutesBeforeStart: 15,
    }),
  })
  if (!r.ok) return null
  const j: any = await r.json()
  return j.id || null
}

export async function cancelOutlookEvent(eventId: string, comment: string): Promise<boolean> {
  const tokenStr = await getOutlookAccessToken(BOOKING_HOST)
  if (!tokenStr) return false
  const r = await fetch(`https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(eventId)}/cancel`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokenStr}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ comment }),
  })
  return r.ok || r.status === 202
}

export function fmtSlot(d: Date): string {
  return d.toLocaleString('en-US', { timeZone: BOOKING_TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
}
