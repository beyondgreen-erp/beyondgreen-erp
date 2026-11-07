/* eslint-disable @typescript-eslint/no-explicit-any */
// Compliance rules shared by the Compliance dashboard and the compliance boards.
// Each board says which date proves the work was done and how often it must be repeated,
// so the ERP can tell the team what is overdue, what is due next and when the next report is due.

export type DueState = 'overdue' | 'missing' | 'soon' | 'ok' | 'archive'

export interface ComplianceBoardRule {
  key: string                 // board_key in the boards table
  short: string               // label used on the dashboard
  program: string             // HACCP / GMP program area an auditor would look for
  mode: 'entry' | 'scope' | 'none'
  dateKeys?: string[]         // first filled one is the "last done" date
  dueKey?: string             // explicit next-due date column (wins when filled)
  cadenceDays?: number        // default repeat interval
  cadenceKey?: string         // per-entry frequency text, e.g. "Annual", "Monthly"
  scopeKey?: string           // scope mode: one reporting stream per value (e.g. site)
  requireFile?: boolean       // every entry needs a file (SDS, score card, signed doc)
  requireFileGroups?: string[] // only entries in groups containing these words need a file
  openKey?: string            // status column that marks open work
  closedValues?: string[]
  openOverdueDays?: number    // open work older than this is overdue
  weight: number              // share of the audit readiness score
  task: string                // what "logging it" means, shown on prompts
}

export const COMPLIANCE_RULES: ComplianceBoardRule[] = [
  { key: 'compliance-haccp-gmp', short: 'Program Documents', program: 'HACCP Plan & Document Control', mode: 'entry', dateKeys: ['date'], cadenceDays: 365, requireFile: true, weight: 15, task: 'Review the document, update Rev and Date, attach the signed copy' },
  { key: 'compliance-iso9001', short: 'ISO 9001', program: 'HACCP Plan & Document Control', mode: 'entry', dateKeys: ['date'], cadenceDays: 365, requireFile: true, weight: 5, task: 'Annual document review' },
  { key: 'compliance-osha', short: 'OSHA Safety', program: 'Training & Worker Safety', mode: 'entry', dateKeys: ['trained_on', 'date'], cadenceDays: 182, requireFile: true, weight: 10, task: 'Run the semi-annual training and record Trained On' },
  { key: 'compliance-haccp-signoff', short: 'Monthly Sign-off', program: 'Monitoring Records', mode: 'entry', dateKeys: ['last_signoff'], cadenceDays: 30, weight: 5, task: 'Attach this month’s completed form and set Last signed off' },
  { key: 'compliance-pm-cgmp', short: 'PM / cGMP', program: 'Maintenance & Sanitation', mode: 'entry', dateKeys: ['last_pm'], cadenceDays: 30, cadenceKey: 'frequency', weight: 10, task: 'Attach the PM / inspection record and set Last PM done' },
  { key: 'compliance-pest', short: 'Pest Control', program: 'Pest Control', mode: 'scope', scopeKey: 'site', dateKeys: ['service_date'], cadenceDays: 31, requireFile: true, weight: 10, task: 'Add the monthly service report with its PDF' },
  { key: 'compliance-chemicals', short: 'Chemical List / SDS', program: 'Chemical Control', mode: 'none', requireFileGroups: ['Chemical'], weight: 5, task: 'Attach the current SDS' },
  { key: 'compliance-asl', short: 'Approved Suppliers', program: 'Supplier Approval', mode: 'none', requireFile: true, weight: 5, task: 'Attach the supplier score card / certificate' },
  { key: 'compliance-filings', short: 'Permits & Filings', program: 'Regulatory', mode: 'entry', dateKeys: ['submitted_date'], dueKey: 'due_date', cadenceDays: 365, cadenceKey: 'frequency', weight: 5, task: 'Renew and attach the new permit' },
  { key: 'compliance-traceability', short: 'Mock Recall', program: 'Traceability & Recall', mode: 'scope', dateKeys: ['lot_date'], cadenceDays: 365, weight: 5, task: 'Run the annual mock recall and log the lot trace' },
  { key: 'compliance-hold', short: 'HOLD Log', program: 'Hold & Release', mode: 'none', openKey: 'status', closedValues: ['done', 'released', 'closed', 'complete', 'completed'], openOverdueDays: 14, weight: 0, task: 'Disposition the held product' },
  { key: 'compliance-corrective-maint', short: 'Corrective Maintenance', program: 'Maintenance & Sanitation', mode: 'none', openKey: 'status', closedValues: ['complete', 'completed', 'done', 'closed'], openOverdueDays: 7, weight: 0, task: 'Finish the repair and set Completion Date' },
  { key: 'compliance-audits', short: 'Audits', program: 'Verification & Audits', mode: 'none', dueKey: 'scheduled_date', weight: 0, task: 'Prepare for the audit' },
]

export const RULE_BY_KEY: Record<string, ComplianceBoardRule> = Object.fromEntries(COMPLIANCE_RULES.map(r => [r.key, r]))

const DAY = 86400000
export function parseDate(v: any): Date | null {
  if (!v) return null
  const s = String(v).trim()
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}
export function ymd(d: Date | null): string { if (!d) return ''; const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }
export function fmtDate(d: Date | string | null): string {
  const x = typeof d === 'string' ? parseDate(d) : d
  return x ? x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-'
}
export function today(): Date { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()) }
export function daysBetween(a: Date, b: Date) { return Math.round((b.getTime() - a.getTime()) / DAY) }
export function addDays(d: Date, n: number) { return new Date(d.getTime() + n * DAY) }

export function cadenceFromText(t: any, fallback: number): number {
  const s = String(t || '').toLowerCase()
  if (!s) return fallback
  if (/daily|every day/.test(s)) return 1
  if (/week/.test(s)) return 7
  if (/semi|bi-?annual|6 ?month|twice a year/.test(s)) return 182
  if (/quarter|3 ?month/.test(s)) return 91
  if (/month/.test(s)) return 30
  if (/annual|year|12 ?month/.test(s)) return 365
  if (/one ?time|once|n\/a/.test(s)) return 0
  return fallback
}
export function cadenceLabel(days: number): string {
  if (!days) return 'One time'
  if (days <= 1) return 'Daily'; if (days <= 7) return 'Weekly'; if (days <= 31) return 'Monthly'
  if (days <= 92) return 'Quarterly'; if (days <= 183) return 'Semi-annual'; return 'Annual'
}

export interface DueRow {
  boardKey: string; board: string; program: string; itemId?: string; item: string; scope?: string
  owner?: string; last?: string; next?: string; state: DueState; daysLeft?: number; cadence: string; task: string; group?: string
}

export interface BoardItem { id: string; group_name: string | null; data: Record<string, any> }

// Due status for one compliance board. activeSites: entries whose site is not active are archived (not scored).
export function evaluateBoard(rule: ComplianceBoardRule, label: string, items: BoardItem[], fileCounts: Record<string, number>, activeSites: string[]) {
  const t = today()
  const isActive = (it: BoardItem) => { const s = String(it.data?.site || '').trim(); return !s || !activeSites.length || activeSites.includes(s) }
  const live = items.filter(isActive)
  const owner = (d: any) => d.person || d.responsible || d.approved_by || d.owner || ''
  const lastOf = (d: any) => { for (const k of rule.dateKeys || []) { const p = parseDate(d[k]); if (p) return p } return null }
  const rows: DueRow[] = []
  const stateFor = (next: Date | null, last: Date | null, cad: number): { state: DueState; days?: number } => {
    if (!next) return { state: last && cad === 0 ? 'ok' : 'missing' }
    const days = daysBetween(t, next)
    return { state: days < 0 ? 'overdue' : days <= 30 ? 'soon' : 'ok', days }
  }
  if (rule.mode === 'entry') {
    for (const it of live) {
      const d = it.data || {}
      const cad = rule.cadenceKey ? cadenceFromText(d[rule.cadenceKey], rule.cadenceDays || 365) : (rule.cadenceDays || 365)
      const last = lastOf(d)
      const explicit = rule.dueKey ? parseDate(d[rule.dueKey]) : null
      const next = explicit || (last && cad ? addDays(last, cad) : null)
      const s = stateFor(next, last, cad)
      rows.push({ boardKey: rule.key, board: label, program: rule.program, itemId: it.id, item: String(d.name || d.title || '(untitled)'), owner: owner(d), last: ymd(last), next: ymd(next), state: s.state, daysLeft: s.days, cadence: cadenceLabel(cad), task: rule.task, group: it.group_name || '' })
    }
  } else if (rule.mode === 'scope') {
    const by: Record<string, BoardItem[]> = {}
    for (const it of live) { const k = rule.scopeKey ? String(it.data?.[rule.scopeKey] || 'All') : 'All'; (by[k] ||= []).push(it) }
    if (!Object.keys(by).length) by['All'] = []
    for (const [scope, list] of Object.entries(by)) {
      let last: Date | null = null; let lastItem: BoardItem | null = null
      for (const it of list) { const p = lastOf(it.data || {}); if (p && (!last || p > last)) { last = p; lastItem = it } }
      const cad = rule.cadenceDays || 365
      const next = last ? addDays(last, cad) : null
      const s = stateFor(next, last, cad)
      rows.push({ boardKey: rule.key, board: label, program: rule.program, itemId: lastItem?.id, item: scope === 'All' ? label : `${label} · ${scope}`, scope, owner: lastItem ? owner(lastItem.data) : '', last: ymd(last), next: ymd(next), state: s.state, daysLeft: s.days, cadence: cadenceLabel(cad), task: rule.task })
    }
  } else if (rule.dueKey) {
    for (const it of live) {
      const next = parseDate(it.data?.[rule.dueKey]); if (!next) continue
      const days = daysBetween(t, next); if (days < 0) continue
      rows.push({ boardKey: rule.key, board: label, program: rule.program, itemId: it.id, item: String(it.data?.name || '(untitled)'), owner: owner(it.data), next: ymd(next), state: days <= 30 ? 'soon' : 'ok', daysLeft: days, cadence: 'Scheduled', task: rule.task })
    }
  }
  // Open work (holds, repairs) that has sat too long
  if (rule.openKey) {
    for (const it of live) {
      const st = String(it.data?.[rule.openKey] || '').toLowerCase().trim()
      if (rule.closedValues?.includes(st)) continue
      const opened = parseDate(it.data?.date) || null
      const age = opened ? daysBetween(opened, t) : 0
      const due = opened ? addDays(opened, rule.openOverdueDays || 14) : null
      rows.push({ boardKey: rule.key, board: label, program: rule.program, itemId: it.id, item: String(it.data?.name || '(untitled)'), owner: owner(it.data), last: ymd(opened), next: ymd(due), state: age > (rule.openOverdueDays || 14) ? 'overdue' : 'soon', daysLeft: due ? daysBetween(t, due) : undefined, cadence: 'Open', task: rule.task })
    }
  }
  // File coverage
  const needsFile = (it: BoardItem) => rule.requireFile || (rule.requireFileGroups || []).some(w => (it.group_name || '').includes(w))
  const fileScope = live.filter(needsFile)
  const withFile = fileScope.filter(it => (fileCounts[it.id] || 0) > 0).length
  const fileCoverage = fileScope.length ? withFile / fileScope.length : null
  const dueRows = rows.filter(r => r.cadence !== 'Open' && r.cadence !== 'Scheduled')
  const onTime = dueRows.length ? dueRows.filter(r => r.state === 'ok' || r.state === 'soon').length / dueRows.length : null
  const openRows = rows.filter(r => r.cadence === 'Open')
  const parts = [onTime, fileCoverage].filter((x): x is number => x !== null)
  let score = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null
  if (rule.openKey && openRows.length) score = Math.max(0, (score ?? 1) - 0.1 * openRows.filter(r => r.state === 'overdue').length)
  return {
    rows, score, fileCoverage, withFile, fileScope: fileScope.length, onTime,
    archived: items.length - live.length, total: items.length, live: live.length,
    overdue: rows.filter(r => r.state === 'overdue' || r.state === 'missing').length,
    soon: rows.filter(r => r.state === 'soon').length,
    nextReport: rows.filter(r => r.next && (r.state === 'soon' || r.state === 'ok')).map(r => r.next!).sort()[0] || '',
  }
}

export const STATE_STYLE: Record<DueState, { label: string; bg: string; fg: string }> = {
  overdue: { label: 'Overdue', bg: '#FDE8EC', fg: '#C8102E' },
  missing: { label: 'Never logged', bg: '#FFF1E0', fg: '#B45309' },
  soon: { label: 'Due soon', bg: '#FFF7D6', fg: '#8A6100' },
  ok: { label: 'On track', bg: '#E3F6EC', fg: '#00753A' },
  archive: { label: 'Archive', bg: '#EEF0F4', fg: '#6B7280' },
}

export function scoreColor(s: number | null) { if (s === null) return '#9CA3AF'; if (s >= 0.85) return '#00A84F'; if (s >= 0.7) return '#F59E0B'; return '#DC2626' }
export function scoreGrade(s: number | null) { if (s === null) return 'No data'; if (s >= 0.9) return 'Audit ready'; if (s >= 0.8) return 'Minor gaps'; if (s >= 0.65) return 'Needs work'; return 'Not ready' }
