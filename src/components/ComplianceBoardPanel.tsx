'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'
import { ComplianceBoardRule, evaluateBoard, STATE_STYLE, scoreColor, fmtDate, ymd, today, DueRow } from '@/lib/compliance'

interface Props {
  rule: ComplianceBoardRule
  label: string
  rows: { id: string; group_name: string | null; data: Record<string, any> }[]
  fileCounts: Record<string, number>
  activeSites: string[]
  onOpen: (id: string) => void
  onAdd: (group?: string, prefill?: Record<string, any>) => void
}

// Header for a compliance board: score, what is late, next report date, a chart, and one-tap logging.
export default function ComplianceBoardPanel({ rule, label, rows, fileCounts, activeSites, onOpen, onAdd }: Props) {
  const ev = useMemo(() => evaluateBoard(rule, label, rows, fileCounts, activeSites), [rule, label, rows, fileCounts, activeSites])
  const [showAll, setShowAll] = useState(false)
  const pending = ev.rows.filter(r => r.state === 'overdue' || r.state === 'missing' || r.state === 'soon')
    .sort((a, b) => (a.state === 'missing' ? 1 : 0) - (b.state === 'missing' ? 1 : 0) || (a.daysLeft ?? -9999) - (b.daysLeft ?? -9999))

  const chart = useMemo(() => {
    const byGroup: Record<string, any> = {}
    const stateById: Record<string, string> = {}
    ev.rows.forEach(r => { if (r.itemId) stateById[r.itemId] = r.state })
    rows.forEach(it => {
      const g = (it.group_name || 'Items').replace(/\s*\(.*?\)\s*/g, ' ').replace(/ - .*$/, '').trim().slice(0, 22)
      const row = (byGroup[g] ||= { group: g, onTrack: 0, late: 0, noFile: 0, archive: 0 })
      const site = String(it.data?.site || '')
      if (site && activeSites.length && !activeSites.includes(site)) { row.archive++; return }
      const st = stateById[it.id]
      if (st === 'overdue' || st === 'missing') row.late++
      else if ((rule.requireFile || (rule.requireFileGroups || []).some(w => (it.group_name || '').includes(w))) && !(fileCounts[it.id] > 0)) row.noFile++
      else row.onTrack++
    })
    return Object.values(byGroup)
  }, [ev, rows, fileCounts, activeSites, rule])

  const logPrefill = (r: DueRow): Record<string, any> => {
    const k = rule.dateKeys?.[0]; const p: Record<string, any> = {}
    if (k) p[k] = ymd(today())
    if (rule.scopeKey && r.scope && r.scope !== 'All') p[rule.scopeKey] = r.scope
    return p
  }
  const doLog = (r: DueRow) => {
    if (rule.key === 'compliance-audits') { window.location.href = '/compliance/mock-audit'; return }
    if (rule.key === 'compliance-traceability') { window.location.href = '/compliance/lot-trace?mock=1'; return }
    if (rule.mode === 'scope') onAdd(undefined, { ...logPrefill(r), name: `${new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}${r.scope && r.scope !== 'All' ? ' ' + r.scope : ''}` })
    else if (r.itemId) onOpen(r.itemId)
  }

  const tiles = [
    { l: 'Readiness', v: ev.score === null ? '-' : `${Math.round(ev.score * 100)}%`, c: scoreColor(ev.score) },
    { l: 'Overdue / never logged', v: ev.overdue, c: ev.overdue ? '#C8102E' : '#00753A' },
    { l: 'Due in 30 days', v: ev.soon, c: ev.soon ? '#B45309' : '#00753A' },
    { l: 'Next report due', v: ev.nextReport ? fmtDate(ev.nextReport) : (ev.overdue ? 'Now' : '-'), c: '#1A1D2E' },
    ...(ev.fileScope ? [{ l: 'Records with file', v: `${ev.withFile}/${ev.fileScope}`, c: ev.withFile === ev.fileScope ? '#00753A' : '#B45309' }] : []),
  ]

  return (
    <div className="mb-5 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        {tiles.map(x => (
          <div key={x.l} className="bg-white rounded-xl border border-[#E4E6EE] p-3">
            <p className="text-[11px] text-gray-500">{x.l}</p>
            <p className="text-xl font-bold mt-0.5" style={{ color: x.c }}>{x.v}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        <div className="lg:col-span-3 bg-white rounded-xl border border-[#E4E6EE] p-3">
          <div className="flex items-center justify-between mb-2 gap-2">
            <p className="text-sm font-semibold text-[#1A1D2E]">Pending as of {fmtDate(today())}</p>
            {rule.mode === 'scope' && <button onClick={() => doLog(pending[0] || ev.rows[0] || ({ scope: 'All' } as any))} className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white" style={{ background: '#00A84F' }}>+ Log this period</button>}
          </div>
          {pending.length === 0 ? (
            <p className="text-sm text-emerald-700 py-3">Everything on this board is up to date.{ev.nextReport ? ` Next report due ${fmtDate(ev.nextReport)}.` : ''}</p>
          ) : (
            <div className="divide-y divide-[#F1F2F6] max-h-72 overflow-y-auto">
              {(showAll ? pending : pending.slice(0, 8)).map((r, i) => {
                const s = STATE_STYLE[r.state]
                return (
                  <div key={i} className="flex items-center gap-2.5 py-2">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: s.bg, color: s.fg }}>{s.label}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[#1A1D2E] truncate">{r.item}</p>
                      <p className="text-[11px] text-gray-500 truncate">{r.cadence} · {r.next ? `due ${fmtDate(r.next)}` : 'no record yet'}{r.last ? ` · last ${fmtDate(r.last)}` : ''}</p>
                    </div>
                    <button onClick={() => doLog(r)} className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-[#00A84F] text-[#00753A] hover:bg-emerald-50 shrink-0">Log</button>
                  </div>
                )
              })}
              {pending.length > 8 && <button onClick={() => setShowAll(v => !v)} className="text-xs text-gray-500 hover:underline pt-2">{showAll ? 'Show fewer' : `Show all ${pending.length}`}</button>}
            </div>
          )}
          <p className="text-[11px] text-gray-400 mt-2"><i className="ti ti-info-circle" /> {rule.task}. Repeats {rule.mode === 'none' ? 'as needed' : (rule.cadenceKey ? 'per each record’s frequency' : `every ${rule.cadenceDays} days`)}.</p>
        </div>
        <div className="lg:col-span-2 bg-white rounded-xl border border-[#E4E6EE] p-3">
          <p className="text-sm font-semibold text-[#1A1D2E] mb-1">Status by group</p>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} layout="vertical" margin={{ top: 0, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F4" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: '#6B7280' }} />
                <YAxis type="category" dataKey="group" width={110} tick={{ fontSize: 10, fill: '#6B7280' }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="onTrack" name="On track" stackId="a" fill="#00A84F" />
                <Bar dataKey="noFile" name="Missing file" stackId="a" fill="#F59E0B" />
                <Bar dataKey="late" name="Late" stackId="a" fill="#DC2626" />
                <Bar dataKey="archive" name="Archive" stackId="a" fill="#CBD2DC" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {ev.archived > 0 && <p className="text-[11px] text-gray-400">{ev.archived} records from closed sites kept as archive, not scored.</p>}
          <Link href="/compliance" className="text-xs font-semibold text-emerald-700 hover:underline">Open the Compliance Dashboard &rarr;</Link>
        </div>
      </div>
    </div>
  )
}
