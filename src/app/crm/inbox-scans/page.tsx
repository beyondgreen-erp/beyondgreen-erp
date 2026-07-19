'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Lead { email: string; company: string | null; customer_id: string; intent?: string; reason?: string }
interface Run {
  id: string
  ran_at: string
  triggered_by: string
  mailboxes: string[] | null
  scanned: number
  bounced: number
  ooo: number
  replies: number
  interested: number
  unsubscribed: number
  declined: number
  already_bounced: number
  already_ooo: number
  details: { bounced?: Lead[]; ooo?: Lead[]; replies?: Lead[]; message?: string } | null
  error: string | null
}

const fmtDT = (d?: string | null) => d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border border-[#ECEEF3] bg-white px-3 py-2">
      <p className="text-[10px] uppercase font-bold text-gray-400">{label}</p>
      <p className="text-lg font-bold" style={{ color: tone }}>{value}</p>
    </div>
  )
}

function LeadChips({ title, leads, tone }: { title: string; leads: Lead[]; tone: string }) {
  if (!leads || !leads.length) return null
  return (
    <div className="mb-3">
      <p className="text-[11px] font-bold mb-1.5" style={{ color: tone }}>{title} ({leads.length})</p>
      <div className="flex flex-wrap gap-1.5">
        {leads.map((l, i) => (
          <Link key={i} href={`/sales/leads?item=${l.customer_id}`} className="text-[11px] px-2 py-1 rounded-full border border-[#E4E6EE] bg-white hover:bg-[#F2F6FF] text-[#1A1D2E]" title={l.email}>
            {l.company || l.email}{l.intent ? ` · ${l.intent}` : ''}
          </Link>
        ))}
      </div>
    </div>
  )
}

export default function InboxScansPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    const { data } = await sb.from('reply_scan_runs').select('*').order('ran_at', { ascending: false }).limit(100)
    setRuns((data as Run[]) || [])
  }, [sb])
  useEffect(() => { load() }, [load])

  async function runNow() {
    setRunning(true); setToast('')
    try {
      const r = await fetch('/api/leads/reply-scan')
      const j = await r.json()
      setToast(j.message || j.error || 'Scan complete.')
    } catch { setToast('Scan failed.') }
    setRunning(false); load()
  }

  const totals = useMemo(() => {
    const rs = runs || []
    return {
      bounced: rs.reduce((s, r) => s + (r.bounced || 0), 0),
      ooo: rs.reduce((s, r) => s + (r.ooo || 0), 0),
      replies: rs.reduce((s, r) => s + (r.replies || 0), 0),
    }
  }, [runs])

  return (
    <div className="min-h-screen mon-page p-4 sm:p-6 lg:p-8">
      {toast && <div className="fixed top-4 right-4 z-[70] bg-[#1A1D2E] text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-lg max-w-md">{toast}</div>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
        <div>
          <span className="mon-tag" style={{ background: '#3B6FE022', color: '#3B6FE0' }}>📥 Inbox Scans</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">Inbox Scan Reports</h1>
          <p className="text-gray-500 text-sm mt-0.5">Automatic daily scan of the outreach inbox. Bounces mark the lead inactive, out-of-office replies get noted, and real replies are classified — every run is logged here.</p>
        </div>
        <button onClick={runNow} disabled={running} className="text-white font-semibold rounded-lg px-4 py-2 text-sm shadow-sm hover:opacity-90 disabled:opacity-50 whitespace-nowrap" style={{ background: '#037f4c' }}>
          {running ? 'Scanning…' : 'Run scan now'}
        </button>
      </div>

      <div className="bg-[#EEF3FF] border border-[#D3E0FB] rounded-lg px-4 py-2.5 mb-4 text-[13px] text-[#274690]">
        Runs automatically every morning. You can also press <strong>Run scan now</strong> any time. Counts show what was <strong>new</strong> that run — already-handled bounces and notes are skipped so nothing is double-processed.
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4 max-w-md">
        <Stat label="Bounced (all runs)" value={totals.bounced} tone="#DC2626" />
        <Stat label="Out of office" value={totals.ooo} tone="#B45309" />
        <Stat label="Real replies" value={totals.replies} tone="#037f4c" />
      </div>

      <div className="bg-white rounded-xl border border-[#ECEEF3] overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead><tr className="text-[11px] uppercase text-gray-400 border-b border-[#EEF0F4]">
              <th className="text-left px-4 py-2.5 font-semibold">When</th>
              <th className="text-left px-3 py-2.5 font-semibold">Trigger</th>
              <th className="text-right px-3 py-2.5 font-semibold">Scanned</th>
              <th className="text-right px-3 py-2.5 font-semibold">Bounced</th>
              <th className="text-right px-3 py-2.5 font-semibold">Out of office</th>
              <th className="text-right px-3 py-2.5 font-semibold">Replies</th>
              <th className="text-right px-4 py-2.5 font-semibold"></th>
            </tr></thead>
            <tbody>
              {runs == null ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400 text-sm">Loading…</td></tr>
              ) : runs.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-sm">No scans yet. Press “Run scan now” to run the first one.</td></tr>
              ) : runs.map((r, i) => {
                const isOpen = expanded === r.id
                const affected = (r.bounced || 0) + (r.ooo || 0) + (r.replies || 0)
                return (
                  <>
                    <tr key={r.id} className={`border-b border-[#EEF0F4] cursor-pointer hover:bg-[#F2F6FF] ${i % 2 ? 'bg-[#F8FAFC]' : 'bg-white'}`} onClick={() => setExpanded(isOpen ? null : r.id)}>
                      <td className="px-4 py-2.5 font-medium text-[#1A1D2E] whitespace-nowrap">{fmtDT(r.ran_at)}</td>
                      <td className="px-3 py-2.5"><span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${r.triggered_by === 'cron' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>{r.triggered_by === 'cron' ? 'Automatic' : 'Manual'}</span></td>
                      <td className="px-3 py-2.5 text-right text-gray-600">{r.scanned}</td>
                      <td className="px-3 py-2.5 text-right font-semibold" style={{ color: r.bounced ? '#DC2626' : '#9CA3AF' }}>{r.bounced}</td>
                      <td className="px-3 py-2.5 text-right font-semibold" style={{ color: r.ooo ? '#B45309' : '#9CA3AF' }}>{r.ooo}</td>
                      <td className="px-3 py-2.5 text-right font-semibold" style={{ color: r.replies ? '#037f4c' : '#9CA3AF' }}>{r.replies}</td>
                      <td className="px-4 py-2.5 text-right text-[11px] text-gray-400">{affected ? (isOpen ? 'Hide ▲' : 'Details ▾') : ''}</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={7} className="bg-[#FBFCFE] px-4 py-3 border-b border-[#EEF0F4]">
                          {r.error && <p className="text-xs text-red-600 mb-2">Error: {r.error}</p>}
                          {affected === 0 ? (
                            <p className="text-xs text-gray-400">No new leads affected this run{r.already_bounced || r.already_ooo ? ` (${r.already_bounced} bounces + ${r.already_ooo} out-of-office were already handled earlier).` : '.'}</p>
                          ) : (
                            <>
                              <LeadChips title="Marked inactive (bounced)" leads={r.details?.bounced || []} tone="#DC2626" />
                              <LeadChips title="Out of office (noted)" leads={r.details?.ooo || []} tone="#B45309" />
                              <LeadChips title="Replies" leads={r.details?.replies || []} tone="#037f4c" />
                            </>
                          )}
                          <p className="text-[11px] text-gray-400 mt-1">Mailbox: {(r.mailboxes || []).join(', ') || '—'}</p>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
