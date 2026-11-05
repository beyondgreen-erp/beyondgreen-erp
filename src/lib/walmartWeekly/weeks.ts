// Walmart fiscal weeks run Sunday to Saturday. WK 1 of a fiscal year starts on the Sunday
// on or before February 1 (2026: Sunday 2/1; 2027: Sunday 1/31). Orders are placed on
// Thursdays, so "the WK 39 order" is the Thursday inside WK 39.

const DAY = 86400000
export const iso = (d: Date) => d.toISOString().slice(0, 10)
export const parse = (s: string) => new Date(s + 'T00:00:00Z')
export const addDays = (s: string, n: number) => iso(new Date(parse(s).getTime() + n * DAY))
export const md = (s: string | null | undefined) => { if (!s) return ''; const d = parse(s); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}` }
export const mdy = (s: string) => { const d = parse(s); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}` }
export const longDate = (s: string) => parse(s).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
export const dow = (s: string) => parse(s).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })

export function wk1Start(fy: number): string {
  const feb1 = new Date(Date.UTC(fy, 1, 1))
  const back = feb1.getUTCDay() // Sunday = 0
  return iso(new Date(feb1.getTime() - back * DAY))
}

// Fiscal week for a calendar date: { fy, wk, abs } where abs counts weeks from 2026 WK 1
// so weeks can be compared across the year boundary (2026 WK 52 = 52, 2027 WK 1 = 53).
export function fiscalWeek(dateStr: string): { fy: number; wk: number; abs: number; start: string } {
  const d = parse(dateStr)
  let fy = d.getUTCFullYear()
  if (dateStr < wk1Start(fy)) fy -= 1
  const start = parse(wk1Start(fy))
  const wk = Math.floor((d.getTime() - start.getTime()) / (7 * DAY)) + 1
  const base = parse(wk1Start(2026))
  const abs = Math.floor((d.getTime() - base.getTime()) / (7 * DAY)) + 1
  return { fy, wk, abs, start: iso(new Date(start.getTime() + (wk - 1) * 7 * DAY)) }
}
export function weekLabel(abs: number): string {
  if (abs <= 52) return `WK ${abs}`
  const fyLabel = 27 + Math.floor((abs - 53) / 52)
  return `FY${fyLabel} WK ${((abs - 53) % 52) + 1}`
}
export function weekSpan(dateStr: string): string {
  const { start } = fiscalWeek(dateStr)
  return `${md(start)} to ${md(addDays(start, 6))}`
}
// Thursday order date for an absolute week number.
export function orderDateForAbs(abs: number): string {
  return addDays(wk1Start(2026), (abs - 1) * 7 + 4)
}
// Most recent Thursday on or before the date.
export function lastThursday(dateStr: string): string {
  const d = parse(dateStr)
  const back = (d.getUTCDay() - 4 + 7) % 7
  return addDays(dateStr, -back)
}
