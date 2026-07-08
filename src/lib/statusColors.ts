// Monday.com-style status colors for the beyondGREEN ERP.
// Maps arbitrary status/label strings to a colorful, consistent palette.

export interface StatusColor { solid: string; bg: string; fg: string }

const C = {
  green:  { solid: '#00A84F', bg: '#E6F7EE', fg: '#036B34' },
  lime:   { solid: '#9CD326', bg: '#F1F9E0', fg: '#5B7A16' },
  orange: { solid: '#FDAB3D', bg: '#FFF3E0', fg: '#9A5B00' },
  red:    { solid: '#E2445C', bg: '#FCE8EC', fg: '#A11B30' },
  blue:   { solid: '#0086C0', bg: '#E4F2FA', fg: '#03567A' },
  sky:    { solid: '#579BFC', bg: '#E9F2FF', fg: '#1E5FC0' },
  purple: { solid: '#A25DDC', bg: '#F4EAFB', fg: '#6C2FA0' },
  teal:   { solid: '#00C7C7', bg: '#E0F7F7', fg: '#017070' },
  pink:   { solid: '#FF5AC4', bg: '#FFE8F7', fg: '#B01582' },
  grey:   { solid: '#9699A6', bg: '#EDEEF2', fg: '#5A5E6B' },
  navy:   { solid: '#323338', bg: '#EAEAEC', fg: '#323338' },
} as const

const PALETTE: StatusColor[] = [C.green, C.blue, C.purple, C.orange, C.teal, C.sky, C.pink, C.lime, C.red]

// keyword → color
const MAP: { test: RegExp; color: StatusColor }[] = [
  { test: /(done|complete|delivered|shipped|paid|won|approved|active|closed won|fulfilled|ready to ship|in stock|verified|success|passed)/i, color: C.green },
  { test: /(progress|working|packing|in transit|processing|building|running|assigned|pu date|partial|review|pending review|sent)/i, color: C.orange },
  { test: /(stuck|cancel|lost|failed|overdue|rejected|error|exception|blocked|declined|unpaid|out of stock|void|closed lost)/i, color: C.red },
  { test: /(new|open|draft|todo|to do|backlog|lead|inquiry|quote|quotation|requested|created)/i, color: C.sky },
  { test: /(hold|on hold|waiting|paused|deferred|snoozed|scheduled)/i, color: C.purple },
  { test: /(pending|queued|not started|unassigned|awaiting)/i, color: C.grey },
]

function hashColor(s: string): StatusColor {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

export function statusColor(status?: string | null): StatusColor {
  const s = (status || '').trim()
  if (!s) return C.grey
  for (const m of MAP) if (m.test.test(s)) return m.color
  return hashColor(s.toLowerCase())
}

// Deterministic colorful accent for group headers / avatars by any key
export function accentColor(key?: string | null): StatusColor {
  const s = (key || '').trim()
  if (!s) return C.green
  return hashColor(s.toLowerCase())
}

export const MON = C
