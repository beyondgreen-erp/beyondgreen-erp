'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { useEmployees } from '@/lib/useEmployees'
import { fmtDate, ymd, today, addDays } from '@/lib/compliance'

type Ans = 'yes' | 'no' | 'na' | ''
interface Q { id: string; text: string; critical?: boolean; auto?: (d: any) => { ok: boolean; evidence: string; href?: string } | null; hint?: string }
interface Section { title: string; items: Q[] }

const board = (d: any, key: string) => (d?.boards || []).find((b: any) => b.key === key)
const late = (d: any, key: string, label: string, href: string) => {
  const b = board(d, key); if (!b) return null
  return { ok: b.overdue === 0, evidence: b.overdue === 0 ? `${label}: all ${b.live} records current` : `${label}: ${b.overdue} overdue or never logged`, href }
}

// HACCP / GMP mock audit, walked the way a third-party food-contact packaging auditor walks the plant.
// Items with an ERP check are pre-answered from live data; the auditor confirms or overrides each one.
const CHECKLIST: Section[] = [
  { title: 'Management commitment & HACCP plan', items: [
    { id: 'm1', text: 'HACCP / food safety team is named, roles are defined and the org chart is current', hint: 'Program Documents: ORG-001 and team list' },
    { id: 'm2', text: 'HACCP plan, hazard analysis and flow diagrams reviewed and re-validated in the last 12 months', critical: true, auto: d => late(d, 'compliance-haccp-gmp', 'Program Documents', '/board/compliance-haccp-gmp') },
    { id: 'm3', text: 'Food safety and quality policy is signed by management and posted' },
    { id: 'm4', text: 'Management review of the food safety system held in the last 12 months (minutes on file)' },
  ] },
  { title: 'Document & record control', items: [
    { id: 'd1', text: 'Every SOP and form on the floor is the current revision, with approval and date', auto: d => late(d, 'compliance-iso9001', 'ISO 9001 documents', '/board/compliance-iso9001') },
    { id: 'd2', text: 'Monthly monitoring forms are complete, signed and verified', auto: d => late(d, 'compliance-haccp-signoff', 'Monthly Sign-offs', '/board/compliance-haccp-signoff') },
    { id: 'd3', text: 'Records are legible, in ink or electronic, with no blanks or uncorrected errors' },
  ] },
  { title: 'Critical control points', items: [
    { id: 'c1', text: 'Magnet / metal detection CCP is checked and recorded every shift', critical: true },
    { id: 'c2', text: 'Every CCP deviation has a recorded corrective action and product disposition', critical: true },
    { id: 'c3', text: 'CCP records are verified by a supervisor or the HACCP coordinator', critical: true },
  ] },
  { title: 'Prerequisite programs', items: [
    { id: 'p1', text: 'Pest control serviced in the last 31 days, report and trap map on file, no activity trends unaddressed', critical: true, auto: d => late(d, 'compliance-pest', 'Pest Control', '/board/compliance-pest') },
    { id: 'p2', text: 'Every chemical on site is on the approved list with a current SDS', auto: d => { const b = board(d, 'compliance-chemicals'); return b ? { ok: (b.fileCoverage ?? 0) >= 1, evidence: `SDS on file for ${b.withFile} of ${b.fileScope} chemicals`, href: '/board/compliance-chemicals' } : null } },
    { id: 'p3', text: 'Preventive maintenance is current for all production equipment', auto: d => late(d, 'compliance-pm-cgmp', 'PM / cGMP Schedule', '/board/compliance-pm-cgmp') },
    { id: 'p4', text: 'Master sanitation schedule followed, cleaning records signed', critical: true },
    { id: 'p5', text: 'Glass and brittle plastic register is current and inspected' },
    { id: 'p6', text: 'Knife / blade and foreign material controls in place and logged', critical: true },
    { id: 'p7', text: 'Scales and measuring devices calibrated on schedule' },
    { id: 'p8', text: 'Compressed air contacting product is filtered and tested' },
  ] },
  { title: 'Supplier & incoming material control', items: [
    { id: 's1', text: 'All active suppliers are on the Approved Supplier List with a score card, COA or certificate', auto: d => { const b = board(d, 'compliance-asl'); return b ? { ok: (b.fileCoverage ?? 0) >= 0.9, evidence: `Score card / certificate on file for ${b.withFile} of ${b.fileScope} suppliers`, href: '/board/compliance-asl' } : null } },
    { id: 's2', text: 'Incoming resin and packaging are inspected and their lot numbers recorded at receiving', critical: true, hint: 'Lot Trace shows whether raw material lots are captured' },
  ] },
  { title: 'Training', items: [
    { id: 't1', text: 'Employees are trained on GMP, HACCP and safety, with current sign-off records', auto: d => late(d, 'compliance-osha', 'OSHA / safety training', '/board/compliance-osha') },
    { id: 't2', text: 'New hires complete GMP training before working on the floor' },
  ] },
  { title: 'Traceability & recall', items: [
    { id: 'r1', text: 'Mock recall done in the last 6 months and passed (4 hours or less, 99%+ accounted for)', critical: true, auto: d => { const k = d?.kpis; if (!k) return null; const ok = k.daysSinceRecall !== null && k.daysSinceRecall <= 182 && !/fail/i.test(k.mockRecallResult || ''); return { ok, evidence: k.lastRecall ? `Last mock recall ${fmtDate(k.lastRecall)}${k.mockRecallResult ? ' · ' + k.mockRecallResult : ''}${k.mockRecallMinutes ? ' · ' + k.mockRecallMinutes + ' min' : ''}` : 'No mock recall on record', href: '/compliance/lot-trace?mock=1' } } },
    { id: 'r2', text: 'Finished goods lot numbers are recorded on every shipment', critical: true, hint: 'Run Lot Trace on a recent lot to check' },
    { id: 'r3', text: 'Recall plan and customer / regulator contact list reviewed in the last 12 months' },
    { id: 'r4', text: 'No open recalls without effectiveness checks', auto: d => { const k = d?.kpis; if (!k) return null; return { ok: !k.recallsOpen, evidence: k.recallsOpen ? `${k.recallsOpen} open recall(s)` : 'No open recalls', href: '/board/compliance-recalls' } } },
  ] },
  { title: 'Complaints, CAPA & holds', items: [
    { id: 'x1', text: 'Customer complaints investigated and closed within 30 days', auto: d => { const k = d?.kpis; if (!k) return null; return { ok: !k.complaintsOpen, evidence: `${k.complaintsOpen} complaint(s) still open`, href: '/compliance/complaints' } } },
    { id: 'x2', text: 'CAPAs have a root cause and are closed by their target date', critical: true, auto: d => { const k = d?.kpis; if (!k) return null; return { ok: !k.capaOverdue, evidence: `${k.capaOpen} open CAPAs · ${k.capaOverdue} past target date`, href: '/compliance/capa' } } },
    { id: 'x3', text: 'Held product is tagged, segregated and dispositioned', auto: d => { const k = d?.kpis; if (!k) return null; return { ok: !k.holdsOpen, evidence: k.holdsOpen ? `${k.holdsOpen} open hold(s)` : 'No open holds', href: '/board/compliance-hold' } } },
  ] },
  { title: 'GMP plant walk-through', items: [
    { id: 'g1', text: 'Hand-wash stations stocked (soap, towels), hand-wash signage posted in English and Spanish' },
    { id: 'g2', text: 'No jewelry, food, drink or gum on the floor; hair and beard nets worn', critical: true },
    { id: 'g3', text: 'Building tight: no gaps under doors, dock seals intact, no holes in walls or ceiling', critical: true },
    { id: 'g4', text: 'Floors, walls and machines clean; no product or packaging on the floor' },
    { id: 'g5', text: 'Pallets off the floor and 18 inches from walls, inspection aisle clear' },
    { id: 'g6', text: 'Visitor and contractor log kept, GMP rules signed' },
    { id: 'g7', text: 'Lighting over open product is shatter-proof or covered' },
  ] },
  { title: 'Regulatory & certifications', items: [
    { id: 'l1', text: 'Business, fire and environmental permits are current', auto: d => late(d, 'compliance-filings', 'Permits & Filings', '/board/compliance-filings') },
    { id: 'l2', text: 'Product certifications (BPI, TUV, USDA BioPreferred) are current', auto: d => { const k = d?.kpis; if (!k) return null; return { ok: !k.certExpired, evidence: k.certExpired ? `${k.certExpired} certification(s) expired` : 'All current', href: '/bizdev/certifications' } } },
  ] },
]
const ALL = CHECKLIST.flatMap(s => s.items)

export default function MockAuditPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const router = useRouter()
  const employees = useEmployees()
  const [d, setD] = useState<any>(null)
  const [ans, setAns] = useState<Record<string, Ans>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [capa, setCapa] = useState<Record<string, boolean>>({})
  const [auditor, setAuditor] = useState('')
  const [owner, setOwner] = useState('')
  const [date, setDate] = useState(ymd(today()))
  const [nextDate, setNextDate] = useState(ymd(addDays(today(), 91)))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/compliance/summary', { cache: 'no-store' }).then(r => r.json()).then(j => {
      setD(j)
      // pre-answer from live ERP data
      const a: Record<string, Ans> = {}; const c: Record<string, boolean> = {}
      ALL.forEach(q => { const r = q.auto?.(j); if (r) { a[q.id] = r.ok ? 'yes' : 'no'; if (!r.ok) c[q.id] = true } })
      setAns(prev => ({ ...a, ...prev })); setCapa(prev => ({ ...c, ...prev }))
    }).catch(() => {})
    sb.auth.getUser().then(async ({ data }) => {
      const email = data.user?.email; if (!email) return
      const { data: emp } = await sb.from('employees').select('name').ilike('email', email).maybeSingle()
      setAuditor(a => a || emp?.name || email)
    })
  }, [sb])

  const counts = useMemo(() => {
    let yes = 0, no = 0, na = 0, open = 0, major = 0, minor = 0
    for (const q of ALL) { const v = ans[q.id]; if (v === 'yes') yes++; else if (v === 'no') { no++; if (q.critical) major++; else minor++ } else if (v === 'na') na++; else open++ }
    return { yes, no, na, open, major, minor, score: yes + no ? Math.round((yes / (yes + no)) * 100) : null }
  }, [ans])
  const color = counts.score === null ? '#9CA3AF' : counts.score >= 90 ? '#00A84F' : counts.score >= 75 ? '#F59E0B' : '#DC2626'

  async function save() {
    if (counts.open > 0 && !confirm(`${counts.open} item(s) are unanswered. Save anyway?`)) return
    setSaving(true)
    const fails = ALL.filter(q => ans[q.id] === 'no')
    // 1) raise CAPAs for the findings that need one
    const capaNums: string[] = []
    for (const q of fails.filter(q => capa[q.id])) {
      const num = `MA-${date.replace(/-/g, '').slice(2)}-${q.id.toUpperCase()}`
      const r = await fetch('/api/haccp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', board: 'capa', created_by: auditor, data: {
        capa_number: num, capa_date: date, source: 'Internal Audit', department: 'SNA', responsible_person: owner || auditor, status: 'Open',
        description: `Mock audit ${fmtDate(date)} finding${q.critical ? ' (MAJOR)' : ''}: ${q.text}${notes[q.id] ? ' Note: ' + notes[q.id] : ''}`,
        corrective_target_date: ymd(addDays(new Date(date + 'T00:00'), q.critical ? 14 : 30)),
      } }) })
      const j = await r.json().catch(() => ({}))
      if (j.ok) capaNums.push(num)
    }
    // 2) log the audit
    const { data: b } = await sb.from('boards').select('id').eq('board_key', 'compliance-audits').maybeSingle()
    const findings = fails.map(q => `${q.critical ? '[MAJOR] ' : '[minor] '}${q.text}${notes[q.id] ? ' - ' + notes[q.id] : ''}`).join('\n')
    const results = CHECKLIST.map(s => `${s.title}\n` + s.items.map(q => `  ${(ans[q.id] || '-').toUpperCase().padEnd(3)} ${q.text}${notes[q.id] ? ' (' + notes[q.id] + ')' : ''}`).join('\n')).join('\n')
    const { data: row, error } = await sb.from('custom_board_items').insert({ board_id: b?.id, group_name: 'Mock / Internal Audits', created_by: auditor, data: {
      name: `Mock audit ${fmtDate(date)}`, status: 'Complete', audit_type: 'Mock / Internal', standard: 'HACCP / GMP mock audit (food-contact packaging)',
      audit_date: date, scheduled_date: nextDate, auditor, score: counts.score ?? '', major_findings: counts.major, minor_findings: counts.minor,
      findings: findings || 'No findings', capas: capaNums.join(', '), checklist: results,
    } }).select('id').single()
    setSaving(false)
    if (error) { alert('Could not save the audit: ' + error.message); return }
    router.push(`/board/compliance-audits?item=${row.id}`)
  }

  const btn = (q: Q, v: Ans, label: string, on: string) => (
    <button onClick={() => setAns(a => ({ ...a, [q.id]: a[q.id] === v ? '' : v }))} className="text-xs font-bold px-3 py-1.5 rounded-lg border"
      style={ans[q.id] === v ? { background: on, color: '#fff', borderColor: on } : { background: '#fff', color: '#4B5563', borderColor: '#E4E6EE' }}>{label}</button>
  )

  return (
    <div className="min-h-screen pb-28" style={{ background: '#F5F6FA' }}>
      <Link href="/compliance" className="text-xs font-semibold text-emerald-700 hover:underline">&larr; Compliance Dashboard</Link>
      <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1">Run a Mock Audit</h1>
      <p className="text-sm text-gray-500 mb-4">A HACCP / GMP walk-through the way a third-party auditor does it. Items with live ERP data are pre-answered; confirm or change each one on the floor. Every &quot;No&quot; can raise a CAPA. Major findings get a 14-day target, minor ones 30 days.</p>

      <div className="bg-white rounded-2xl border border-[#E4E6EE] p-4 mb-4 grid grid-cols-1 sm:grid-cols-4 gap-3">
        <datalist id="ma-emp">{employees.map(e => <option key={e.id} value={e.name} />)}</datalist>
        <label className="text-xs text-gray-500">Auditor<input list="ma-emp" value={auditor} onChange={e => setAuditor(e.target.value)} className="mt-1 w-full border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm text-[#1A1D2E]" /></label>
        <label className="text-xs text-gray-500">CAPA owner<input list="ma-emp" value={owner} onChange={e => setOwner(e.target.value)} placeholder="Defaults to the auditor" className="mt-1 w-full border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm text-[#1A1D2E]" /></label>
        <label className="text-xs text-gray-500">Audit date<input type="date" value={date} onChange={e => setDate(e.target.value)} className="mt-1 w-full border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm text-[#1A1D2E]" /></label>
        <label className="text-xs text-gray-500">Next mock audit<input type="date" value={nextDate} onChange={e => setNextDate(e.target.value)} className="mt-1 w-full border border-[#E4E6EE] rounded-lg px-3 py-2 text-sm text-[#1A1D2E]" /></label>
      </div>

      <div className="space-y-4">
        {CHECKLIST.map(s => (
          <div key={s.title} className="bg-white rounded-2xl border border-[#E4E6EE] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#F1F2F6] flex items-center justify-between">
              <h2 className="font-semibold text-[#1A1D2E]">{s.title}</h2>
              <span className="text-xs text-gray-500">{s.items.filter(q => ans[q.id]).length}/{s.items.length} answered</span>
            </div>
            <div className="divide-y divide-[#F1F2F6]">
              {s.items.map(q => {
                const auto = d ? q.auto?.(d) : null
                return (
                  <div key={q.id} className="px-4 py-3">
                    <div className="flex flex-col md:flex-row md:items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[#1A1D2E]">{q.critical && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-600 mr-1.5">MAJOR</span>}{q.text}</p>
                        {auto && <p className="text-[11px] mt-0.5" style={{ color: auto.ok ? '#00753A' : '#C8102E' }}><i className="ti ti-database" /> ERP: {auto.evidence}{auto.href && <> · <Link href={auto.href} className="underline">open</Link></>}</p>}
                        {!auto && q.hint && <p className="text-[11px] text-gray-400 mt-0.5">{q.hint}</p>}
                      </div>
                      <div className="flex gap-1.5 shrink-0">{btn(q, 'yes', 'Yes', '#00A84F')}{btn(q, 'no', 'No', '#DC2626')}{btn(q, 'na', 'N/A', '#6B7280')}</div>
                    </div>
                    {ans[q.id] === 'no' && (
                      <div className="mt-2 flex flex-col sm:flex-row gap-2">
                        <input value={notes[q.id] || ''} onChange={e => setNotes(n => ({ ...n, [q.id]: e.target.value }))} placeholder="What did you find?" className="flex-1 border border-red-200 rounded-lg px-3 py-1.5 text-sm" />
                        <label className="text-xs text-gray-600 flex items-center gap-1.5 shrink-0"><input type="checkbox" checked={!!capa[q.id]} onChange={e => setCapa(c => ({ ...c, [q.id]: e.target.checked }))} /> Raise a CAPA</label>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* sticky score bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#E4E6EE] px-4 py-3 z-40">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-3">
          <div className="text-2xl font-extrabold" style={{ color }}>{counts.score === null ? '-' : counts.score + '%'}</div>
          <div className="text-xs text-gray-600 flex-1 min-w-[180px]">{counts.yes} yes · {counts.no} no ({counts.major} major, {counts.minor} minor) · {counts.na} n/a · {counts.open} unanswered · {Object.entries(capa).filter(([k, v]) => v && ans[k] === 'no').length} CAPAs to raise</div>
          <button onClick={save} disabled={saving} className="text-sm font-semibold px-5 py-2.5 rounded-lg text-white disabled:opacity-50" style={{ background: '#00A84F' }}>{saving ? 'Saving…' : 'Save audit & raise CAPAs'}</button>
        </div>
      </div>
    </div>
  )
}
