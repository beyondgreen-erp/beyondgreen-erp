'use client'
/**
 * Walmart Production — Activity log & accountability.
 * Every log, void, release, claim, undo, PO move and PO change on the Walmart board is written
 * to walmart_activity by database triggers (nobody can skip it from the app). This tab shows:
 *  1. Logged but not released — per person, with each log's age (who logged it and left it sitting).
 *  2. Releases by PO — every release, which PO/load it went to, who released, who claimed, and whose log it came from.
 *  3. Discrepancies — logs released for more than was logged, releases not tied to any log, old unreleased logs.
 *  4. The full activity feed with filters + CSV export.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'

type Act = { id: string; at: string; actor: string | null; action: string; sku: string | null; qty: number | null; po_number: string | null; load_number: string | null; walmart_order_id: string | null; entry_id: string | null; release_id: string | null; details: any; source: string }
type Unrel = { entry_id: string; production_date: string; logged_at: string; logged_by: string | null; sku: string; logged: number; released_direct: number; released_other: number; unreleased: number; over_released: number; age_hours: number; note: string | null }
type Rel = { id: string; entry_id: string | null; walmart_order_id: string | null; sku: string; qty: number; status: string; released_by: string | null; released_at: string; claimed_by: string | null; claimed_at: string | null; note: string | null; walmart_board_orders?: { po_number: string | null; load_number: string | null; group_name: string | null } | null }

const nameOf = (e: string | null | undefined) => !e ? '—' : e.includes('@') ? e.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : e
const SKU_NAME: Record<string, string> = { '22GVA24': 'Assorted 24', '22GVA48': 'Assorted 48', '22GVF24': 'Fork 24', '22GVF48': 'Fork 48', '22GVK48': 'Knife 48', '22GVS24': 'Spoon 24', '22GVS48': 'Spoon 48' }
const skuName = (s: string | null) => (s && SKU_NAME[s.toUpperCase()]) || s || ''
const n0 = (v: number | null | undefined) => (v == null ? '' : Math.round(Number(v)).toLocaleString())
const when = (s: string) => new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const ago = (h: number) => h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const ACTION_COLOR: Record<string, string> = {
  'logged': '#0073ea', 'released': '#00a85a', 'released from stock': '#00a85a', 'claimed': '#7e3af2',
  'log voided': '#e2445c', 'log deleted': '#e2445c', 'release cancelled': '#e2445c', 'release deleted': '#e2445c',
  'log edited': '#fdab3d', 'release qty changed': '#fdab3d', 'release moved to PO': '#fdab3d', 'release relinked': '#9aa0b4',
  'release reopened': '#fdab3d', 'log restored': '#fdab3d', 'PO updated': '#579bfc', 'PO added': '#579bfc', 'PO deleted': '#e2445c',
  'PO line added': '#579bfc', 'PO line changed': '#579bfc', 'PO line removed': '#e2445c', 'daily plan confirmed': '#037f4c',
}
const Badge = ({ a }: { a: string }) => <span className="inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold text-white whitespace-nowrap" style={{ background: ACTION_COLOR[a] || '#676879' }}>{a}</span>

function detailText(a: Act): string {
  const d = a.details || {}
  const bits: string[] = []
  if (d.production_date) bits.push(`for ${d.production_date}`)
  if (d.reason) bits.push(`reason: ${d.reason}`)
  if (d.logged_by && d.logged_by !== a.actor) bits.push(`logged by ${nameOf(d.logged_by)}`)
  if (d.released_by && d.released_by !== a.actor) bits.push(`released by ${nameOf(d.released_by)}`)
  if (d.from_po) bits.push(`from PO ${d.from_po}`)
  if (d.from_qty != null) bits.push(`was ${n0(d.from_qty)}`)
  if (d.before) bits.push(`was ${d.before.qty ?? ''} ${skuName(d.before.sku)} ${d.before.date ?? ''}`.trim())
  if (d.why) bits.push(d.why)
  if (d.plan_date) bits.push(`plan for ${d.plan_date}`)
  if (a.action === 'PO updated') for (const [k, v] of Object.entries(d)) bits.push(`${k}: ${(v as any)?.from ?? '—'} → ${(v as any)?.to ?? '—'}`)
  if (d.note) bits.push(String(d.note))
  if (a.source === 'backfill') bits.push('(from records before the log started)')
  return bits.join(' · ')
}

export default function WalmartActivityLog({ sb, woId, weekLabel }: { sb: any; woId: string | null; weekLabel?: string }) {
  const [acts, setActs] = useState<Act[]>([])
  const [unrel, setUnrel] = useState<Unrel[]>([])
  const [rels, setRels] = useState<Rel[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [from, setFrom] = useState(() => ymd(new Date(Date.now() - 13 * 864e5)))
  const [to, setTo] = useState(() => ymd(new Date()))
  const [who, setWho] = useState('')
  const [act, setAct] = useState('')
  const [q, setQ] = useState('')
  const [openPerson, setOpenPerson] = useState<string | null>(null)
  const [poFilter, setPoFilter] = useState('')
  const [section, setSection] = useState<'who' | 'po' | 'issues' | 'feed'>('who')

  const load = useCallback(async () => {
    setErr('')
    const end = new Date(to + 'T00:00:00'); end.setDate(end.getDate() + 1)
    const [a, u, r] = await Promise.all([
      sb.from('walmart_activity').select('*').gte('at', new Date(from + 'T00:00:00').toISOString()).lt('at', end.toISOString()).order('at', { ascending: false }).limit(3000),
      woId ? sb.rpc('walmart_unreleased_entries', { p_wo: woId }) : Promise.resolve({ data: [] }),
      woId ? sb.from('walmart_releases').select('id,entry_id,walmart_order_id,sku,qty,status,released_by,released_at,claimed_by,claimed_at,note,walmart_board_orders(po_number,load_number,group_name)').eq('work_order_id', woId).order('released_at', { ascending: false }) : Promise.resolve({ data: [] }),
    ])
    if (a.error) setErr(a.error.message)
    setActs(a.data || []); setUnrel(u.data || []); setRels(r.data || []); setLoading(false)
  }, [sb, woId, from, to])

  useEffect(() => { load() }, [load])
  useEffect(() => {   // live: anything anyone does shows up here straight away
    const ch = sb.channel('wm-activity-' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'walmart_activity' }, () => load())
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [sb, load])

  // who logged what (entry id → logger) for the releases table
  const entryBy = useMemo(() => {
    const m: Record<string, string> = {}
    for (const a of acts) if (a.action === 'logged' && a.entry_id) m[a.entry_id] = a.actor || ''
    for (const u of unrel) m[u.entry_id] = u.logged_by || ''
    return m
  }, [acts, unrel])

  const open = unrel.filter(u => u.unreleased > 0)
  const byPerson = useMemo(() => {
    const m: Record<string, { who: string; logs: Unrel[]; srp: number; oldest: number }> = {}
    for (const u of open) {
      const k = u.logged_by || 'unknown'
      m[k] ||= { who: k, logs: [], srp: 0, oldest: 0 }
      m[k].logs.push(u); m[k].srp += Number(u.unreleased); m[k].oldest = Math.max(m[k].oldest, Number(u.age_hours))
    }
    return Object.values(m).sort((a, b) => b.srp - a.srp)
  }, [open])

  const issues = useMemo(() => {
    const out: { kind: string; text: string; who?: string | null; at?: string }[] = []
    for (const u of unrel) if (u.over_released > 0) out.push({ kind: 'Released more than logged', who: u.logged_by, at: u.logged_at, text: `${skuName(u.sku)} log of ${n0(u.logged)} SRP (${u.production_date}) has ${n0(u.logged + u.over_released)} SRP released against it — ${n0(u.over_released)} more than was logged.` })
    for (const u of open) if (u.age_hours >= 24) out.push({ kind: 'Logged, not released 24h+', who: u.logged_by, at: u.logged_at, text: `${n0(u.unreleased)} of ${n0(u.logged)} ${skuName(u.sku)} SRP logged ${ago(u.age_hours)} ago and still not released.` })
    for (const r of rels) if (r.status !== 'Cancelled' && !r.entry_id) out.push({ kind: 'Release not tied to a log', who: r.released_by, at: r.released_at, text: `${n0(r.qty)} ${skuName(r.sku)} released to PO ${r.walmart_board_orders?.po_number || '—'} from logged stock (no single log).` })
    for (const a of acts) if (['log voided', 'release cancelled', 'release moved to PO', 'log edited', 'release qty changed', 'log deleted', 'release deleted'].includes(a.action))
      out.push({ kind: a.action, who: a.actor, at: a.at, text: `${n0(a.qty)} ${skuName(a.sku)}${a.po_number ? ' · PO ' + a.po_number : ''}${detailText(a) ? ' — ' + detailText(a) : ''}` })
    return out.sort((a, b) => (b.at || '').localeCompare(a.at || ''))
  }, [unrel, open, rels, acts])

  const people = useMemo(() => Array.from(new Set(acts.map(a => a.actor || '').filter(Boolean))).sort(), [acts])
  const actions = useMemo(() => Array.from(new Set(acts.map(a => a.action))).sort(), [acts])
  const feed = useMemo(() => {
    const s = q.trim().toLowerCase()
    return acts.filter(a => (!who || a.actor === who) && (!act || a.action === act) &&
      (!s || [a.sku, skuName(a.sku), a.po_number, a.load_number, a.actor, detailText(a)].join(' ').toLowerCase().includes(s)))
  }, [acts, who, act, q])

  const poRows = useMemo(() => {
    const s = poFilter.trim().toLowerCase()
    return rels.filter(r => !s || [r.walmart_board_orders?.po_number, r.walmart_board_orders?.load_number, r.sku, skuName(r.sku), r.released_by, r.claimed_by].join(' ').toLowerCase().includes(s))
  }, [rels, poFilter])

  function exportCsv() {
    const head = ['When', 'Who', 'Action', 'SKU', 'Item', 'SRP', 'PO', 'Load', 'Details']
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [head.join(','), ...feed.map(a => [new Date(a.at).toLocaleString(), a.actor, a.action, a.sku, skuName(a.sku), a.qty, a.po_number, a.load_number, detailText(a)].map(esc).join(','))]
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
    const el = document.createElement('a'); el.href = url; el.download = `walmart-activity-${from}-to-${to}.csv`; el.click(); URL.revokeObjectURL(url)
  }

  const totalOpen = open.reduce((s, u) => s + Number(u.unreleased), 0)
  const relNotClaimed = rels.filter(r => r.status === 'Released').reduce((s, r) => s + Number(r.qty), 0)
  const overCount = unrel.filter(u => u.over_released > 0).length
  const card = 'rounded-2xl border border-[#E4E6EE] bg-white'
  const th = 'text-left text-[11px] uppercase tracking-wide text-gray-400 font-semibold px-3 py-2'
  const td = 'px-3 py-2 text-[13px] text-gray-800 border-t border-[#F0F1F5] align-top'

  return (
    <div>
      <div className="mb-3 rounded-lg bg-[#579bfc]/10 border border-[#579bfc]/25 text-[12px] text-[#1f4e99] px-3 py-2">
        📜 Every log, release, claim, undo, removal and PO change on this board is recorded automatically with who did it and when. Nobody can skip it. {weekLabel ? <>Not-released and PO numbers are for <b>{weekLabel}</b>.</> : null}
      </div>
      {err && <div className="mb-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">{err}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
        {[
          ['Logged, not released', `${n0(totalOpen)} SRP`, `${open.length} logs · ${byPerson.length} people`, '#e2445c', 'who'],
          ['Released, not claimed', `${n0(relNotClaimed)} SRP`, 'waiting for the build team', '#fdab3d', 'po'],
          ['Discrepancies', String(issues.length), `${overCount} logs released for more than logged`, '#7e3af2', 'issues'],
          ['Actions in range', String(acts.length), `${from} → ${to}`, '#0073ea', 'feed'],
        ].map(([t, v, s, c, k]) => (
          <button key={t} onClick={() => setSection(k as any)} className={`${card} text-left p-3 border-t-4 ${section === k ? 'ring-2 ring-offset-1' : ''}`} style={{ borderTopColor: c as string, ['--tw-ring-color' as any]: c }}>
            <p className="text-[11px] uppercase text-gray-400 font-semibold">{t}</p>
            <p className="text-xl font-bold text-[#1A1D2E]">{v}</p>
            <p className="text-[11px] text-gray-500">{s}</p>
          </button>
        ))}
      </div>

      <div className="flex gap-1 p-1 mb-3 rounded-xl bg-[#EEF0F4] overflow-x-auto">
        {([['who', '👤 Logged, not released'], ['po', '🧾 Releases by PO'], ['issues', '⚠ Discrepancies'], ['feed', '📜 Full activity']] as const).map(([k, l]) =>
          <button key={k} data-ro-ok onClick={() => setSection(k)} className={`h-9 px-4 rounded-lg text-sm font-semibold whitespace-nowrap ${section === k ? 'bg-white shadow-sm text-[#1A1D2E]' : 'text-gray-500'}`}>{l}</button>)}
      </div>

      {loading ? <p className="text-sm text-gray-400 px-1 py-6">Loading activity…</p> : <>

      {section === 'who' && (
        <div className={card}>
          <div className="px-4 py-3 border-b border-[#F0F1F5]">
            <p className="font-semibold text-[#1A1D2E]">Who logged production that has not been released</p>
            <p className="text-[12px] text-gray-500">Releases tied to a log count against it; releases from logged stock are applied to the oldest logs first. Click a person to see each log.</p>
          </div>
          {!byPerson.length ? <p className="px-4 py-6 text-sm text-emerald-700">✓ Everything logged this week has been released.</p> :
          <table className="w-full">
            <thead><tr><th className={th}>Logged by</th><th className={th}>Logs</th><th className={th + ' text-right'}>SRP not released</th><th className={th}>Oldest</th></tr></thead>
            <tbody>{byPerson.map(p => <Fragment key={p.who}>
              <tr key={p.who} className="cursor-pointer hover:bg-[#F7F8FB]" onClick={() => setOpenPerson(openPerson === p.who ? null : p.who)}>
                <td className={td}><span className="font-semibold">{openPerson === p.who ? '▾' : '▸'} {nameOf(p.who)}</span> <span className="text-gray-400 text-[11px]">{p.who}</span></td>
                <td className={td}>{p.logs.length}</td>
                <td className={td + ' text-right font-bold text-[#e2445c]'}>{n0(p.srp)}</td>
                <td className={td}><span className={p.oldest >= 24 ? 'text-[#e2445c] font-semibold' : ''}>{ago(p.oldest)} ago</span></td>
              </tr>
              {openPerson === p.who && <tr key={p.who + '-d'}><td colSpan={4} className="bg-[#FAFBFD] px-3 pb-3">
                <table className="w-full mt-1">
                  <thead><tr><th className={th}>Logged at</th><th className={th}>For day</th><th className={th}>Item</th><th className={th + ' text-right'}>Logged</th><th className={th + ' text-right'}>Released</th><th className={th + ' text-right'}>Not released</th><th className={th}>Note</th></tr></thead>
                  <tbody>{p.logs.map(u => <tr key={u.entry_id}>
                    <td className={td}>{when(u.logged_at)} <span className="text-gray-400 text-[11px]">({ago(u.age_hours)} ago)</span></td>
                    <td className={td}>{u.production_date}</td>
                    <td className={td}>{skuName(u.sku)} <span className="text-gray-400 text-[11px]">{u.sku}</span></td>
                    <td className={td + ' text-right'}>{n0(u.logged)}</td>
                    <td className={td + ' text-right'}>{n0(Number(u.released_direct) + Number(u.released_other))}</td>
                    <td className={td + ' text-right font-bold text-[#e2445c]'}>{n0(u.unreleased)}</td>
                    <td className={td + ' text-gray-500'}>{u.note || ''}</td>
                  </tr>)}</tbody>
                </table>
              </td></tr>}
            </Fragment>)}</tbody>
          </table>}
        </div>
      )}

      {section === 'po' && (
        <div className={card}>
          <div className="px-4 py-3 border-b border-[#F0F1F5] flex flex-wrap gap-2 items-center justify-between">
            <div><p className="font-semibold text-[#1A1D2E]">Every release and the PO it went to</p><p className="text-[12px] text-gray-500">Who logged it, who released it, and who claimed it.</p></div>
            <input value={poFilter} onChange={e => setPoFilter(e.target.value)} placeholder="Search PO, load, item, person…" className="h-9 w-64 rounded-lg border border-[#E4E6EE] px-3 text-sm" />
          </div>
          <div className="overflow-x-auto"><table className="w-full min-w-[900px]">
            <thead><tr><th className={th}>PO</th><th className={th}>Load</th><th className={th}>Item</th><th className={th + ' text-right'}>SRP</th><th className={th}>Status</th><th className={th}>Logged by</th><th className={th}>Released</th><th className={th}>Claimed</th><th className={th}>Note</th></tr></thead>
            <tbody>{poRows.map(r => <tr key={r.id} className={r.status === 'Cancelled' ? 'opacity-50' : ''}>
              <td className={td + ' font-semibold'}>{r.walmart_board_orders?.po_number || '—'}</td>
              <td className={td}>{r.walmart_board_orders?.load_number || '—'}</td>
              <td className={td}>{skuName(r.sku)}</td>
              <td className={td + ' text-right font-semibold'}>{n0(r.qty)}</td>
              <td className={td}><Badge a={r.status === 'Claimed' ? 'claimed' : r.status === 'Cancelled' ? 'release cancelled' : 'released'} /></td>
              <td className={td}>{r.entry_id ? nameOf(entryBy[r.entry_id]) : <span className="text-gray-400">from stock</span>}</td>
              <td className={td}>{nameOf(r.released_by)}<br /><span className="text-[11px] text-gray-400">{when(r.released_at)}</span></td>
              <td className={td}>{r.claimed_by ? <>{nameOf(r.claimed_by)}<br /><span className="text-[11px] text-gray-400">{r.claimed_at ? when(r.claimed_at) : ''}</span></> : <span className="text-gray-400">—</span>}</td>
              <td className={td + ' text-gray-500 text-[12px]'}>{r.note || ''}</td>
            </tr>)}</tbody>
          </table></div>
          {!poRows.length && <p className="px-4 py-6 text-sm text-gray-400">No releases.</p>}
        </div>
      )}

      {section === 'issues' && (
        <div className={card}>
          <div className="px-4 py-3 border-b border-[#F0F1F5]"><p className="font-semibold text-[#1A1D2E]">Things that don&apos;t add up</p><p className="text-[12px] text-gray-500">Over-releases, old unreleased logs, releases from stock, and every removal, undo, edit or PO move in the date range.</p></div>
          {!issues.length ? <p className="px-4 py-6 text-sm text-emerald-700">✓ Nothing to flag.</p> :
          <table className="w-full"><tbody>{issues.map((i, k) => <tr key={k}>
            <td className={td + ' w-48'}><Badge a={i.kind} /></td>
            <td className={td}>{i.text}</td>
            <td className={td + ' whitespace-nowrap'}>{nameOf(i.who)}<br /><span className="text-[11px] text-gray-400">{i.at ? when(i.at) : ''}</span></td>
          </tr>)}</tbody></table>}
        </div>
      )}

      {section === 'feed' && (
        <div className={card}>
          <div className="px-4 py-3 border-b border-[#F0F1F5] flex flex-wrap gap-2 items-end">
            <label className="text-[11px] text-gray-500">From<input type="date" value={from} onChange={e => setFrom(e.target.value)} className="block h-9 rounded-lg border border-[#E4E6EE] px-2 text-sm" /></label>
            <label className="text-[11px] text-gray-500">To<input type="date" value={to} onChange={e => setTo(e.target.value)} className="block h-9 rounded-lg border border-[#E4E6EE] px-2 text-sm" /></label>
            <label className="text-[11px] text-gray-500">Person<select value={who} onChange={e => setWho(e.target.value)} className="block h-9 rounded-lg border border-[#E4E6EE] px-2 text-sm bg-white"><option value="">Everyone</option>{people.map(p => <option key={p} value={p}>{nameOf(p)}</option>)}</select></label>
            <label className="text-[11px] text-gray-500">Action<select value={act} onChange={e => setAct(e.target.value)} className="block h-9 rounded-lg border border-[#E4E6EE] px-2 text-sm bg-white"><option value="">All</option>{actions.map(a => <option key={a} value={a}>{a}</option>)}</select></label>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search PO, load, item…" className="h-9 flex-1 min-w-[160px] rounded-lg border border-[#E4E6EE] px-3 text-sm" />
            <button data-ro-ok onClick={exportCsv} className="h-9 px-3 rounded-lg border border-[#E4E6EE] text-sm font-semibold text-gray-700 bg-white">⬇ CSV</button>
          </div>
          <div className="overflow-x-auto"><table className="w-full min-w-[820px]">
            <thead><tr><th className={th}>When</th><th className={th}>Who</th><th className={th}>Action</th><th className={th}>Item</th><th className={th + ' text-right'}>SRP</th><th className={th}>PO / Load</th><th className={th}>Details</th></tr></thead>
            <tbody>{feed.map(a => <tr key={a.id}>
              <td className={td + ' whitespace-nowrap'}>{when(a.at)}</td>
              <td className={td + ' whitespace-nowrap font-semibold'}>{nameOf(a.actor)}</td>
              <td className={td}><Badge a={a.action} /></td>
              <td className={td}>{skuName(a.sku)}</td>
              <td className={td + ' text-right'}>{n0(a.qty)}</td>
              <td className={td}>{a.po_number ? <>PO {a.po_number}{a.load_number ? <span className="text-gray-400 text-[11px]"> · load {a.load_number}</span> : null}</> : <span className="text-gray-300">—</span>}</td>
              <td className={td + ' text-[12px] text-gray-500'}>{detailText(a)}</td>
            </tr>)}</tbody>
          </table></div>
          {!feed.length && <p className="px-4 py-6 text-sm text-gray-400">No activity in this range.</p>}
        </div>
      )}
      </>}
    </div>
  )
}
