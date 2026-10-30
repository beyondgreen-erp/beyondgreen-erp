'use client'
export const dynamic = 'force-dynamic'
/*
  System Health — the ERP watchdog's control room (admins only).

  Every 15 minutes the database runs public.watchdog_run():
    • Auto-fix checks repair mechanical problems (stale queue entries, missing timestamps,
      tallies out of step with the ledger…) and keep the old values so any fix can be undone here.
    • Report checks never touch data; they keep one ticket per problem type on the Tickets board
      (assigned to Rudy) and close it by themselves when the problem is gone.
    • Errors people hit on screen and saves the database refused are captured from every browser.
  A digest goes to Rudy every morning.
*/
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { usePermissions } from '@/lib/permissions'
import { useToast } from '@/components/Toast'

type Check = { key: string; name: string; area: string; severity: string; mode: 'fix' | 'report'; explain: string | null; enabled: boolean; sort: number; last_run_at: string | null; last_count: number | null; last_fixed: number | null; last_error: string | null; ticket_id: string | null }
type Finding = { id: string; check_key: string; record_id: string; label: string | null; link: string | null; status: string; first_seen: string; last_seen: string; fixed_at: string | null; undo: any; undone_at: string | null; undone_by: string | null }
type ClientErr = { id: string; kind: string; message: string; path: string | null; user_email: string | null; count: number; first_seen: string; last_seen: string; resolved_at: string | null; stack: string | null }
type Run = { id: number; started_at: string; finished_at: string | null; checks: number; findings: number; fixed: number; errors: number; trigger: string }

const SEV: Record<string, string> = { high: '#E2445C', medium: '#FDAB3D', low: '#579BFC' }
const ago = (iso: string | null) => {
  if (!iso) return '—'
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return Math.round(s / 60) + ' min ago'
  if (s < 86400) return Math.round(s / 3600) + ' h ago'
  return Math.round(s / 86400) + ' d ago'
}
const KIND: Record<string, string> = { crash: 'Screen crash', promise: 'Background error', db_save: 'Save refused', db_read: 'Load refused', db_delete: 'Delete refused' }

export default function HealthPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const perms = usePermissions()
  const { toast } = useToast()
  const [checks, setChecks] = useState<Check[]>([])
  const [open, setOpen] = useState<Finding[]>([])
  const [fixed, setFixed] = useState<Finding[]>([])
  const [errs, setErrs] = useState<ClientErr[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [ticketKeys, setTicketKeys] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [tab, setTab] = useState<'open' | 'fixed' | 'errors' | 'checks'>('open')
  const [showStack, setShowStack] = useState<string | null>(null)

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 7 * 86400000).toISOString()
    const [c, o, f, e, r] = await Promise.all([
      sb.from('watchdog_checks').select('*').order('sort'),
      sb.from('watchdog_findings').select('*').eq('status', 'open').order('first_seen', { ascending: false }).limit(500),
      sb.from('watchdog_findings').select('*').in('status', ['fixed', 'undone']).gte('fixed_at', since).order('fixed_at', { ascending: false }).limit(500),
      sb.from('client_errors').select('*').order('last_seen', { ascending: false }).limit(200),
      sb.from('watchdog_runs').select('*').order('started_at', { ascending: false }).limit(12),
    ])
    const cs = (c.data as Check[]) || []
    setChecks(cs); setOpen((o.data as Finding[]) || []); setFixed((f.data as Finding[]) || [])
    setErrs((e.data as ClientErr[]) || []); setRuns((r.data as Run[]) || [])
    const tids = cs.map(x => x.ticket_id).filter(Boolean) as string[]
    if (tids.length) {
      const { data: t } = await sb.from('tasks').select('id,ticket_key,status').in('id', tids)
      const m: Record<string, string> = {}
      ;((t as any[]) || []).forEach(x => { if (x.status !== 'Done') m[x.id] = x.ticket_key })
      setTicketKeys(m)
    }
    setLoading(false)
  }, [sb])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const ch = sb.channel('watchdog-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'watchdog_runs' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_errors' }, () => load())
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [sb, load])

  async function runNow() {
    setRunning(true)
    const { data, error } = await sb.rpc('watchdog_run', { p_trigger: 'manual' })
    setRunning(false)
    if (error) { toast('Run failed: ' + error.message, 'error'); return }
    const d: any = data
    toast(d?.ok ? `Checked ${d.checks} areas · ${d.fixed} fixed automatically · ${d.findings - d.fixed} need a person` : (d?.message || 'Done'))
    load()
  }
  async function undo(f: Finding) {
    if (!confirm('Put this record back exactly as it was before the watchdog changed it?\n\nThe watchdog will not re-apply this fix; it will show up under "Needs a person" instead.')) return
    const { data, error } = await sb.rpc('watchdog_undo', { p_finding: f.id })
    if (error) { toast('Undo failed: ' + error.message, 'error'); return }
    if ((data as any)?.ok === false) { toast((data as any).message, 'error'); return }
    toast('Fix undone'); load()
  }
  async function toggleCheck(c: Check) {
    const { error } = await sb.from('watchdog_checks').update({ enabled: !c.enabled }).eq('key', c.key)
    if (error) { toast(error.message, 'error'); return }
    setChecks(cs => cs.map(x => x.key === c.key ? { ...x, enabled: !c.enabled } : x))
  }
  async function resolveErr(e: ClientErr) {
    const { error } = await sb.from('client_errors').update({ resolved_at: new Date().toISOString() }).eq('id', e.id)
    if (error) { toast(error.message, 'error'); return }
    setErrs(es => es.map(x => x.id === e.id ? { ...x, resolved_at: new Date().toISOString() } : x))
  }

  // Admins, or anyone granted the System Health board (Settings → Users → board access)
  if (perms.loaded && !perms.is_admin && !perms.boards?.['/settings/health']?.can_view) {
    return <div className="p-10 text-center text-gray-500">You don&apos;t have access to System Health — ask an admin.</div>
  }

  const byCheck = (k: string) => checks.find(c => c.key === k)
  const lastRun = runs[0]
  const fixed24 = fixed.filter(f => f.status === 'fixed' && f.fixed_at && Date.now() - new Date(f.fixed_at).getTime() < 86400000).length
  const errs24 = errs.filter(e => !e.resolved_at && Date.now() - new Date(e.last_seen).getTime() < 86400000)
  const broken = checks.filter(c => c.last_error)
  const healthy = open.filter(f => byCheck(f.check_key)?.severity === 'high').length === 0 && errs24.length === 0 && broken.length === 0
  const minsSince = lastRun ? (Date.now() - new Date(lastRun.started_at).getTime()) / 60000 : 999
  const groups = checks.filter(c => open.some(f => f.check_key === c.key))

  const tabBtn = (k: typeof tab, label: string, n?: number) => (
    <button onClick={() => setTab(k)} className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors ${tab === k ? 'bg-[#1A1D2E] text-white' : 'bg-white text-gray-600 border border-[#E4E6EE] hover:border-[#C7CBE0]'}`}>
      {label}{n != null && <span className={`ml-2 text-[11px] px-1.5 py-0.5 rounded-full ${tab === k ? 'bg-white/20' : 'bg-[#F1F3F9]'}`}>{n}</span>}
    </button>
  )

  return (
    <div className="min-h-screen mon-page p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-5">
        <div>
          <span className="mon-tag" style={{ background: '#0F7A4E22', color: '#0F7A4E' }}>🩺 System Health</span>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">ERP Watchdog</h1>
          <p className="text-gray-500 text-sm mt-0.5 max-w-2xl">
            Checks the whole ERP every 15 minutes. Mechanical problems are fixed automatically (and can be undone here);
            anything touching stock or money becomes a ticket for a person. Errors people hit on screen are captured too.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${minsSince < 20 ? 'bg-[#E7F6EE] text-[#0F7A4E]' : 'bg-[#FDECEE] text-[#E2445C]'}`}>
            {lastRun ? `Last check ${ago(lastRun.started_at)}` : 'Never run'}{minsSince >= 20 && lastRun ? ' — watchdog may be stopped' : ''}
          </span>
          <button onClick={runNow} disabled={running} className="text-white font-semibold rounded-lg px-4 py-2 text-sm shadow-sm hover:opacity-90 disabled:opacity-50" style={{ background: '#0F7A4E' }}>
            {running ? 'Checking…' : 'Run checks now'}
          </button>
        </div>
      </div>

      <div className={`rounded-xl border px-5 py-4 mb-5 flex items-center gap-3 ${healthy ? 'bg-[#E7F6EE] border-[#BFE6D0]' : 'bg-[#FFF6E8] border-[#F6D9A8]'}`}>
        <span className="text-2xl">{healthy ? '✅' : '⚠️'}</span>
        <div>
          <p className="font-semibold text-[#1A1D2E]">{healthy ? 'All systems normal' : 'Attention needed'}</p>
          <p className="text-sm text-gray-600">
            {open.length} item{open.length === 1 ? '' : 's'} need a person · {fixed24} fixed automatically in the last 24 h · {errs24.length} screen error{errs24.length === 1 ? '' : 's'} in the last 24 h
            {broken.length > 0 && <> · <span className="text-[#E2445C] font-semibold">{broken.length} check{broken.length > 1 ? 's' : ''} failing</span></>}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {tabBtn('open', 'Needs a person', open.length)}
        {tabBtn('fixed', 'Auto-fixed (7 days)', fixed.length)}
        {tabBtn('errors', 'Screen errors', errs.filter(e => !e.resolved_at).length)}
        {tabBtn('checks', 'Checks', checks.length)}
      </div>

      {loading ? <p className="text-gray-400 py-16 text-center">Loading…</p> : <>
        {tab === 'open' && (
          <div className="space-y-3">
            {groups.length === 0 && <div className="bg-white rounded-xl border border-[#ECEEF3] p-10 text-center text-gray-400">Nothing needs a person right now.</div>}
            {groups.map(c => {
              const items = open.filter(f => f.check_key === c.key)
              const tk = c.ticket_id ? ticketKeys[c.ticket_id] : null
              return (
                <div key={c.key} className="bg-white rounded-xl border border-[#ECEEF3] overflow-hidden">
                  <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[#F1F3F7]" style={{ borderLeft: `5px solid ${SEV[c.severity]}` }}>
                    <span className="font-bold text-sm text-[#1A1D2E]">{c.name}</span>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: SEV[c.severity] + '22', color: SEV[c.severity] }}>{items.length}</span>
                    <span className="text-[11px] text-gray-400">{c.area}</span>
                    {tk && <Link href={`/bizdev/tasks?item=${c.ticket_id}`} className="ml-auto text-xs font-semibold text-[#5559df] hover:underline">Ticket {tk} →</Link>}
                  </div>
                  <ul className="divide-y divide-[#F4F5F8]">
                    {items.slice(0, 50).map(f => (
                      <li key={f.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                        <span className="flex-1 text-gray-700">{f.label}</span>
                        <span className="text-[11px] text-gray-400 shrink-0">since {ago(f.first_seen)}</span>
                        {f.link && <Link href={f.link} className="text-xs font-semibold text-[#0F7A4E] hover:underline shrink-0">Open</Link>}
                      </li>
                    ))}
                    {items.length > 50 && <li className="px-4 py-2 text-xs text-gray-400">…and {items.length - 50} more</li>}
                  </ul>
                </div>
              )
            })}
          </div>
        )}

        {tab === 'fixed' && (
          <div className="bg-white rounded-xl border border-[#ECEEF3] overflow-hidden">
            {fixed.length === 0 && <p className="p-10 text-center text-gray-400">No automatic fixes in the last 7 days.</p>}
            <ul className="divide-y divide-[#F4F5F8]">
              {fixed.slice(0, 300).map(f => (
                <li key={f.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-[#F1F3F9] text-gray-500 shrink-0 w-40 truncate">{byCheck(f.check_key)?.name}</span>
                  <span className="flex-1 text-gray-700">{f.label}</span>
                  <span className="text-[11px] text-gray-400 shrink-0">{ago(f.fixed_at)}</span>
                  {f.link && <Link href={f.link} className="text-xs font-semibold text-[#0F7A4E] hover:underline shrink-0">Open</Link>}
                  {f.status === 'undone'
                    ? <span className="text-[11px] text-gray-400 shrink-0">undone{f.undone_by ? ' by ' + f.undone_by.split('@')[0] : ''}</span>
                    : f.undo && <button onClick={() => undo(f)} className="text-xs font-semibold text-[#E2445C] hover:underline shrink-0">Undo</button>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === 'errors' && (
          <div className="bg-white rounded-xl border border-[#ECEEF3] overflow-hidden">
            {errs.length === 0 && <p className="p-10 text-center text-gray-400">No screen errors captured yet.</p>}
            <ul className="divide-y divide-[#F4F5F8]">
              {errs.map(e => (
                <li key={e.id} className={`px-4 py-3 text-sm ${e.resolved_at ? 'opacity-50' : ''}`}>
                  <div className="flex items-center gap-3">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded shrink-0 ${e.kind.startsWith('db') ? 'bg-[#FFF3E0] text-[#B26A00]' : 'bg-[#FDECEE] text-[#C62839]'}`}>{KIND[e.kind] || e.kind}</span>
                    <span className="flex-1 text-gray-800 font-medium break-all">{e.message}</span>
                    <span className="text-[11px] text-gray-400 shrink-0">{e.count}× · {ago(e.last_seen)}</span>
                    {!e.resolved_at && <button onClick={() => resolveErr(e)} className="text-xs font-semibold text-[#0F7A4E] hover:underline shrink-0">Mark fixed</button>}
                  </div>
                  <div className="text-[11px] text-gray-400 mt-1 flex gap-3">
                    <span>{e.path || '—'}</span>{e.user_email && <span>last hit by {e.user_email.split('@')[0]}</span>}
                    {e.stack && <button onClick={() => setShowStack(s => s === e.id ? null : e.id)} className="hover:text-gray-600 underline">{showStack === e.id ? 'hide' : 'details'}</button>}
                  </div>
                  {showStack === e.id && <pre className="mt-2 text-[11px] bg-[#F7F8FB] rounded p-2 overflow-x-auto whitespace-pre-wrap text-gray-600">{e.stack}</pre>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === 'checks' && (
          <div className="bg-white rounded-xl border border-[#ECEEF3] overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-[#EEF0F4]">
                <th className="px-4 py-2.5">Check</th><th className="px-3">Area</th><th className="px-3">Mode</th><th className="px-3">Last run</th><th className="px-3 text-right">Found</th><th className="px-3 text-right">Fixed</th><th className="px-3">On</th>
              </tr></thead>
              <tbody className="divide-y divide-[#F4F5F8]">
                {checks.map(c => (
                  <tr key={c.key} className={c.enabled ? '' : 'opacity-50'}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2"><i className="w-2 h-2 rounded-full inline-block" style={{ background: SEV[c.severity] }} /><span className="font-semibold text-[#1A1D2E]">{c.name}</span></div>
                      <div className="text-[11px] text-gray-400 mt-0.5">{c.explain}</div>
                      {c.last_error && <div className="text-[11px] text-[#E2445C] mt-0.5">Check failed: {c.last_error}</div>}
                    </td>
                    <td className="px-3 text-gray-500">{c.area}</td>
                    <td className="px-3"><span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${c.mode === 'fix' ? 'bg-[#E7F6EE] text-[#0F7A4E]' : 'bg-[#EEF0FF] text-[#5559df]'}`}>{c.mode === 'fix' ? 'Auto-fix' : 'Ticket'}</span></td>
                    <td className="px-3 text-gray-500 whitespace-nowrap">{ago(c.last_run_at)}</td>
                    <td className="px-3 text-right tabular-nums">{c.last_count ?? '—'}</td>
                    <td className="px-3 text-right tabular-nums">{c.mode === 'fix' ? (c.last_fixed ?? '—') : '—'}</td>
                    <td className="px-3"><button onClick={() => toggleCheck(c)} className={`w-9 h-5 rounded-full relative transition-colors ${c.enabled ? 'bg-[#0F7A4E]' : 'bg-gray-300'}`}><span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${c.enabled ? 'left-[18px]' : 'left-0.5'}`} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-3 border-t border-[#EEF0F4] text-[11px] text-gray-400">
              Recent runs: {runs.slice(0, 8).map(r => `${ago(r.started_at)} (${r.trigger}: ${r.fixed} fixed, ${r.findings - r.fixed} open${r.errors ? ', ' + r.errors + ' failed' : ''})`).join(' · ')}
            </div>
          </div>
        )}
      </>}
    </div>
  )
}
