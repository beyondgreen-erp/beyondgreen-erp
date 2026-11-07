/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { COMPLIANCE_RULES, evaluateBoard, parseDate, today, daysBetween, addDays, ymd, DueRow } from '@/lib/compliance'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function all(table: string, select: string, apply?: (q: any) => any) {
  const out: any[] = []
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(select).range(from, from + 999)
    if (apply) q = apply(q)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

export async function GET() {
  try {
    const t = today()
    const yearAgo = addDays(t, -365)

    const [boards, cfgRows] = await Promise.all([
      all('boards', 'id,board_key,label,href,is_hidden', q => q.in('board_key', COMPLIANCE_RULES.map(r => r.key))),
      all('erp_config', 'key,value', q => q.eq('key', 'compliance_active_sites')),
    ])
    const activeSites = String(cfgRows[0]?.value || 'SNA').split(',').map(s => s.trim()).filter(Boolean)
    const boardIds = boards.map(b => b.id)
    const [items, files] = await Promise.all([
      boardIds.length ? all('custom_board_items', 'id,board_id,group_name,data', q => q.in('board_id', boardIds)) : Promise.resolve([]),
      all('file_attachments', 'record_id,record_type', q => q.like('record_type', 'board:compliance-%')),
    ])
    const fileCounts: Record<string, number> = {}
    files.forEach(f => { fileCounts[f.record_id] = (fileCounts[f.record_id] || 0) + 1 })

    // ---- compliance boards
    const boardResults = COMPLIANCE_RULES.map(rule => {
      const b = boards.find(x => x.board_key === rule.key)
      if (!b) return null
      const list = items.filter(i => i.board_id === b.id)
      const ev = evaluateBoard(rule, b.label, list, fileCounts, activeSites)
      return { key: rule.key, label: b.label, short: rule.short, program: rule.program, href: b.href || `/board/${rule.key}`, weight: rule.weight, ...ev }
    }).filter(Boolean) as any[]

    // ---- CAPA
    const capas = await all('capa_log', 'id,capa_number,capa_date,status,source,department,responsible_person,description,corrective_target_date,verified_date,created_at')
    const isClosed = (s: any) => /closed|verified|complete|done/i.test(String(s || ''))
    const capaRows: DueRow[] = []
    let capaOverdue = 0; const closeDays: number[] = []
    for (const c of capas) {
      const opened = parseDate(c.capa_date) || parseDate(c.created_at)
      if (isClosed(c.status)) {
        const closed = parseDate(c.verified_date)
        if (opened && closed && closed >= opened && closed >= yearAgo) closeDays.push(daysBetween(opened, closed))
        continue
      }
      const due = parseDate(c.corrective_target_date) || (opened ? addDays(opened, 30) : null)
      const days = due ? daysBetween(t, due) : undefined
      const state = due && days! < 0 ? 'overdue' : 'soon'
      if (state === 'overdue') capaOverdue++
      capaRows.push({ boardKey: 'capa', board: 'CAPA Log', program: 'Corrective & Preventive Action', itemId: c.id, item: `${c.capa_number || 'CAPA'}${c.description ? ' · ' + String(c.description).slice(0, 60) : ''}`, owner: c.responsible_person || '', last: ymd(opened), next: ymd(due), state: state as any, daysLeft: days, cadence: 'Open', task: 'Complete the corrective action and verify it' })
    }
    const capaOpen = capaRows.length
    // Share of CAPAs in play over the last year (open now, or closed in the last 12 months) that are not overdue
    const capaRelevant = capaOpen + closeDays.length
    const capaScore = capaRelevant ? 1 - capaOverdue / capaRelevant : (capas.length ? 1 : null)
    // ---- complaints
    const complaints = await all('customer_complaints', 'id,complaint_number,title,product,complaint_received_date,status,created_at')
    const cDate = (c: any) => parseDate(c.complaint_received_date) || parseDate(c.created_at)
    const complaints12 = complaints.filter(c => { const d = cDate(c); return d && d >= yearAgo })
    const complaintOpen = complaints.filter(c => !isClosed(c.status))
    const complaintRows: DueRow[] = complaintOpen.map(c => {
      const d = cDate(c); const due = d ? addDays(d, 30) : null; const days = due ? daysBetween(t, due) : undefined
      return { boardKey: 'complaints', board: 'Customer Complaints', program: 'Complaints', itemId: c.id, item: `${c.complaint_number || ''} ${c.title || c.product || 'Complaint'}`.trim(), last: ymd(d), next: ymd(due), state: (days !== undefined && days < 0 ? 'overdue' : 'soon') as any, daysLeft: days, cadence: 'Open', task: 'Investigate, respond and close the complaint' }
    })
    const complaintScore = complaints12.length || complaintOpen.length ? 1 - complaintRows.filter(r => r.state === 'overdue').length / Math.max(complaints12.length, complaintOpen.length, 1) : 1

    // ---- units shipped (packs) for complaints per million units
    const [orders, lines, wm] = await Promise.all([
      all('sales_orders', 'id,ship_date,order_date,created_at'),
      all('sales_order_lines', 'sales_order_id,order_id,quantity_shipped', q => q.gt('quantity_shipped', 0)),
      all('walmart_board_orders', 'id,units,bol_date,sales_order_id', q => q.not('bol_date', 'is', null)),
    ])
    const wmLinked = new Set(wm.map(w => w.sales_order_id).filter(Boolean))
    const orderDate: Record<string, Date | null> = {}
    orders.forEach(o => { orderDate[o.id] = parseDate(o.ship_date) || parseDate(o.order_date) || parseDate(o.created_at) })
    let unitsShipped = 0; let firstShip: Date | null = null
    const unitsByMonth: Record<string, number> = {}
    const addUnits = (d: Date | null, n: number) => {
      if (!d || d < yearAgo || !n) return
      unitsShipped += n; unitsByMonth[monthKey(d)] = (unitsByMonth[monthKey(d)] || 0) + n
      if (!firstShip || d < firstShip) firstShip = d
    }
    lines.forEach(l => { const oid = l.sales_order_id || l.order_id; if (!oid || wmLinked.has(oid)) return; addUnits(orderDate[oid] || null, Number(l.quantity_shipped) || 0) })
    wm.forEach(w => addUnits(parseDate(w.bol_date), Number(w.units) || 0))
    const fs = firstShip as Date | null
    const cpmuComplaints = fs ? complaints12.filter(c => { const d = cDate(c); return d && d >= fs }).length : 0
    const cpmu = unitsShipped ? (cpmuComplaints / unitsShipped) * 1_000_000 : null

    // ---- certifications
    const certs = await all('certifications', 'id,cert_name,issuing_body,expiry_date,is_active,status')
    const certRows: DueRow[] = []
    let certExpired = 0
    for (const c of certs) {
      if (c.is_active === false) continue
      const exp = parseDate(c.expiry_date); if (!exp) continue
      const days = daysBetween(t, exp)
      if (days < 0) certExpired++
      if (days <= 90) certRows.push({ boardKey: 'certifications', board: 'Certifications', program: 'Certifications', itemId: c.id, item: String(c.cert_name).slice(0, 90), owner: c.issuing_body || '', next: ymd(exp), state: days < 0 ? 'overdue' : 'soon', daysLeft: days, cadence: 'Renewal', task: 'Renew the certificate and upload it' })
    }
    const activeCerts = certs.filter(c => c.is_active !== false && parseDate(c.expiry_date)).length
    const certScore = activeCerts ? 1 - certExpired / activeCerts : null

    // ---- readiness
    const components = [
      ...boardResults.filter(b => b.weight > 0).map(b => ({ key: b.key, label: b.short, program: b.program, href: b.href, weight: b.weight, score: b.score, detail: `${b.overdue} overdue · ${b.soon} due soon${b.fileScope ? ` · files ${b.withFile}/${b.fileScope}` : ''}` })),
      { key: 'capa', label: 'CAPA closure', program: 'Corrective & Preventive Action', href: '/compliance/capa', weight: 15, score: capaScore === null ? null : Math.max(0, capaScore), detail: `${capaOpen} open · ${capaOverdue} overdue` },
      { key: 'complaints', label: 'Complaint handling', program: 'Complaints', href: '/compliance/complaints', weight: 5, score: complaintScore, detail: `${complaintOpen.length} open · ${complaints12.length} in 12 months` },
      { key: 'certifications', label: 'Certifications current', program: 'Certifications', href: '/bizdev/certifications', weight: 5, score: certScore, detail: `${certExpired} expired · ${certRows.filter(r => r.state === 'soon').length} expiring in 90 days` },
    ]
    const scored = components.filter(c => c.score !== null && c.weight > 0)
    const readiness = scored.length ? scored.reduce((a, c) => a + (c.score as number) * c.weight, 0) / scored.reduce((a, c) => a + c.weight, 0) : null

    // ---- action list + calendar
    const allRows: DueRow[] = [...boardResults.flatMap(b => b.rows), ...capaRows, ...complaintRows, ...certRows]
    const actions = allRows.filter(r => r.state === 'overdue' || r.state === 'missing' || r.state === 'soon')
      .sort((a, b) => (a.state === 'missing' ? 1 : 0) - (b.state === 'missing' ? 1 : 0) || (a.daysLeft ?? -9999) - (b.daysLeft ?? -9999))
    const horizon = addDays(t, 90)
    const calendar = allRows.filter(r => r.next && parseDate(r.next)! >= t && parseDate(r.next)! <= horizon).sort((a, b) => a.next!.localeCompare(b.next!)).slice(0, 60)

    // ---- trend (last 12 months)
    const months: string[] = []
    for (let i = 11; i >= 0; i--) { const d = new Date(t.getFullYear(), t.getMonth() - i, 1); months.push(monthKey(d)) }
    const trend = months.map(m => {
      const inM = (d: Date | null) => d && monthKey(d) === m
      return {
        month: m,
        label: new Date(Number(m.slice(0, 4)), Number(m.slice(5)) - 1, 1).toLocaleDateString('en-US', { month: 'short' }),
        complaints: complaints.filter(c => inM(cDate(c))).length,
        capaOpened: capas.filter(c => inM(parseDate(c.capa_date) || parseDate(c.created_at))).length,
        capaClosed: capas.filter(c => isClosed(c.status) && inM(parseDate(c.verified_date))).length,
        units: unitsByMonth[m] || 0,
      }
    })
    const capaBySource: Record<string, number> = {}
    capas.forEach(c => { const k = String(c.source || 'Other').split(',')[0].trim() || 'Other'; capaBySource[k] = (capaBySource[k] || 0) + 1 })

    // ---- next audit
    const audits = boardResults.find(b => b.key === 'compliance-audits')
    const nextAudit = audits?.rows?.filter((r: DueRow) => r.next && r.cadence === 'Scheduled').sort((a: DueRow, b: DueRow) => a.next!.localeCompare(b.next!))[0] || null
    // Latest mock audit and recall status, straight from the board records
    const auditBoard = boards.find(b => b.board_key === 'compliance-audits')
    const mockAudits = items.filter(i => i.board_id === auditBoard?.id && i.group_name === 'Mock / Internal Audits' && parseDate(i.data?.audit_date))
      .sort((a, b) => String(b.data.audit_date).localeCompare(String(a.data.audit_date)))
    const lastMock = mockAudits[0]?.data || null
    const traceBoard = boards.find(b => b.board_key === 'compliance-traceability')
    const lastMockRecall = items.filter(i => i.board_id === traceBoard?.id && i.group_name === 'Mock Recalls' && parseDate(i.data?.lot_date))
      .sort((a, b) => String(b.data.lot_date).localeCompare(String(a.data.lot_date)))[0]?.data || null
    const recallBoard = boards.find(b => b.board_key === 'compliance-recalls')
    const recalls = items.filter(i => i.board_id === recallBoard?.id)
    const openRecalls = recalls.filter(i => !/closed|complete|terminated/i.test(String(i.data?.status || '')))
    const shippedR = openRecalls.reduce((a, i) => a + (Number(i.data?.qty_shipped) || 0), 0)
    const recoveredR = openRecalls.reduce((a, i) => a + (Number(i.data?.qty_recovered) || 0), 0)
    const lastRecall = lastMockRecall?.lot_date || boardResults.find(b => b.key === 'compliance-traceability')?.rows?.[0]?.last || ''

    return NextResponse.json({
      asOf: new Date().toISOString(), activeSites,
      readiness, components, boards: boardResults.map(({ rows, ...b }) => ({ ...b, rows: rows.filter((r: DueRow) => r.state !== 'ok').slice(0, 200) })),
      actions: actions.slice(0, 300), calendar, trend, capaBySource,
      kpis: {
        capaOpen, capaOverdue, capaAvgCloseDays: closeDays.length ? Math.round(closeDays.reduce((a, b) => a + b, 0) / closeDays.length) : null, capaTotal: capas.length,
        complaints12: complaints12.length, complaintsOpen: complaintOpen.length, cpmu, cpmuComplaints, unitsShipped, unitsSince: fs ? ymd(fs) : '',
        certExpired, certExpiring: certRows.filter(r => r.state === 'soon').length,
        holdsOpen: boardResults.find(b => b.key === 'compliance-hold')?.rows?.filter((r: DueRow) => r.cadence === 'Open').length || 0,
        repairsOpen: boardResults.find(b => b.key === 'compliance-corrective-maint')?.rows?.filter((r: DueRow) => r.cadence === 'Open').length || 0,
        lastRecall, daysSinceRecall: lastRecall ? daysBetween(parseDate(lastRecall)!, t) : null,
        mockAuditScore: lastMock && lastMock.score !== undefined && lastMock.score !== '' ? Number(lastMock.score) : null,
        mockAuditDate: lastMock?.audit_date || '', mockAuditFindings: lastMock ? (Number(lastMock.major_findings) || 0) + (Number(lastMock.minor_findings) || 0) : null,
        mockRecallResult: lastMockRecall?.result || '', mockRecallMinutes: lastMockRecall?.trace_minutes ? Number(lastMockRecall.trace_minutes) : null, mockRecallPct: lastMockRecall?.pct_accounted ? Number(lastMockRecall.pct_accounted) : null,
        recallsOpen: openRecalls.length, recallEffectiveness: shippedR ? recoveredR / shippedR : null,
        sdsCoverage: boardResults.find(b => b.key === 'compliance-chemicals')?.fileCoverage ?? null,
        overdue: actions.filter(a => a.state === 'overdue' || a.state === 'missing').length,
        dueSoon: actions.filter(a => a.state === 'soon').length,
      },
      nextAudit,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 })
  }
}
