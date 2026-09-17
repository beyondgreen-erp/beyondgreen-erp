/* eslint-disable @typescript-eslint/no-explicit-any */
// Scheduling is held on the work order: the day it runs, the time it starts on its
// machine, and who is on it. Nothing stores a finish time — it is the start plus the run
// hours the sheet already calculates, so changing a quantity moves the finish and
// everything queued behind it. The floor runs round the clock, so a job may end the
// following day; that is shown as +1d rather than being truncated at a shift boundary.

export interface SchedulableWO {
  id: string
  wo_code: string | null
  wo_number: string | number
  group_name: string | null
  form_type: string | null
  item_part_number: string | null
  qty_ordered: number | null
  uom: string | null
  status: string
  machine_id: string | null
  scheduled_date: string | null
  scheduled_start: string | null
  scheduled_hours: number | null
  assigned_operator: string | null
  spec: Record<string, any> | null
}

/** Hours this job is expected to run: the sheet's calculator, else the typed fallback. */
export function runHours(wo: Pick<SchedulableWO, 'spec' | 'scheduled_hours'>): number | null {
  const calc = Number(wo.spec?.calc_production_hours)
  if (isFinite(calc) && calc > 0) return calc
  const typed = Number(wo.scheduled_hours)
  if (isFinite(typed) && typed > 0) return typed
  return null
}

/** True when the run length comes from the sheet rather than being typed. */
export const hoursAreCalculated = (wo: Pick<SchedulableWO, 'spec'>) => {
  const c = Number(wo.spec?.calc_production_hours)
  return isFinite(c) && c > 0
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "14:30:00" | "14:30" -> minutes past midnight. */
export function toMinutes(t: string | null | undefined): number | null {
  if (!t) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(t)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

export function fmtClock(mins: number | null): string {
  if (mins === null) return '—'
  const day = Math.floor(mins / 1440)
  const r = ((mins % 1440) + 1440) % 1440
  const h24 = Math.floor(r / 60)
  const mm = r % 60
  const ampm = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${pad(mm)} ${ampm}${day > 0 ? ` +${day}d` : ''}`
}

export interface ScheduledJob {
  wo: SchedulableWO
  startMins: number | null
  endMins: number | null
  hours: number | null
  /** the job that follows this one on the same machine, same day */
  next?: ScheduledJob
  /** starts before the job before it has finished */
  overlapsPrevious?: boolean
}

/**
 * Order one machine's jobs for a day and work out what follows what. Jobs without a
 * start time keep their place at the end, in creation order, so a half-planned day still
 * lists everything rather than hiding it.
 */
export function buildMachineQueue(wos: SchedulableWO[]): ScheduledJob[] {
  const jobs: ScheduledJob[] = wos.map(wo => {
    const startMins = toMinutes(wo.scheduled_start)
    const hours = runHours(wo)
    return {
      wo,
      startMins,
      hours,
      endMins: startMins !== null && hours !== null ? Math.round(startMins + hours * 60) : null,
    }
  })
  jobs.sort((a, b) => {
    if (a.startMins === null && b.startMins === null) return 0
    if (a.startMins === null) return 1
    if (b.startMins === null) return -1
    return a.startMins - b.startMins
  })
  for (let i = 0; i < jobs.length; i++) {
    if (i + 1 < jobs.length) jobs[i].next = jobs[i + 1]
    const prev = jobs[i - 1]
    if (prev && prev.endMins !== null && jobs[i].startMins !== null && jobs[i].startMins! < prev.endMins) {
      jobs[i].overlapsPrevious = true
    }
  }
  return jobs
}

/** Group a day's work orders by machine, each machine's jobs in running order. */
export function queuesByMachine(wos: SchedulableWO[]): Record<string, ScheduledJob[]> {
  const byMachine: Record<string, SchedulableWO[]> = {}
  for (const wo of wos) (byMachine[wo.machine_id ?? 'unassigned'] ||= []).push(wo)
  const out: Record<string, ScheduledJob[]> = {}
  for (const [mid, list] of Object.entries(byMachine)) out[mid] = buildMachineQueue(list)
  return out
}

/** The time the machine is free again — the last finish on that queue. */
export function freeFrom(jobs: ScheduledJob[]): number | null {
  let last: number | null = null
  for (const j of jobs) if (j.endMins !== null && (last === null || j.endMins > last)) last = j.endMins
  return last
}

export const woLabel = (wo: Pick<SchedulableWO, 'wo_code' | 'wo_number'>) => wo.wo_code || `WO-${wo.wo_number}`

/** Tomorrow, in the local calendar, as YYYY-MM-DD. */
export function tomorrowISO(from = new Date()): string {
  const d = new Date(from)
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function todayISO(from = new Date()): string {
  return `${from.getFullYear()}-${pad(from.getMonth() + 1)}-${pad(from.getDate())}`
}
