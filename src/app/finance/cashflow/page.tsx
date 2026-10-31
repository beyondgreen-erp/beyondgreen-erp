'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Cash Flow & Liabilities — private board (Rudy, Veejay, Vaishu) behind an emailed 2-step code.
 * Everything goes through /api/cashflow; the tables are not readable from the browser.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, AreaChart, Area, BarChart, ReferenceLine } from 'recharts'
import {
  type Liability, type Expense, type Income, type Erp, type Settings,
  n, money, short$, fmtDate, ymd, parse, addDays, monday, quarterOf, weeklyOf, kindLabel, isOpen, target, over90,
  payoffWeeks, rankLiabilities, forecast, simulate,
} from './engine'

const G = '#127a4a'
const api = async (path: string, body?: any) => {
  const r = await fetch('/api/cashflow/' + path, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, ...j }
}
const card = 'bg-white rounded-2xl border border-[#ECEEF3] shadow-sm'
const inp = 'h-10 border border-[#E4E6EE] rounded-lg px-3 text-sm w-full bg-white'
const th = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 whitespace-nowrap'
const td = 'px-3 py-2 text-[13px] border-t border-[#F0F2F6] align-top'
type Tab = 'overview' | 'liabilities' | 'plan' | 'cash' | 'advisor' | 'funding' | 'activity'
const STRATS: Record<string, string> = {
  smart: 'Smart (critical suppliers, settlements, interest, oldest bills; loans last)',
  avalanche: 'Highest interest first', snowball: 'Smallest balance first', aging: 'Oldest vendor bills first', custom: 'My priority numbers only',
}

/* ───────────── 2-step gate ───────────── */
function Gate({ onIn }: { onIn: () => void }) {
  const [me, setMe] = useState<any>(null)
  const [sent, setSent] = useState('')
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api('me').then(setMe) }, [])
  if (!me) return <p className="p-10 text-gray-400 text-sm">Checking access…</p>
  if (!me.signedIn) return <div className={card + ' max-w-md mx-auto mt-16 p-8 text-center'}><p className="font-bold">Please sign in to the ERP first.</p></div>
  if (!me.member) return (
    <div className={card + ' max-w-md mx-auto mt-16 p-8 text-center'}>
      <p className="text-3xl mb-2">🔒</p><p className="font-bold text-[#1A1D2E]">This board is private</p>
      <p className="text-sm text-gray-500 mt-1">Only Finance, Veejay and Rudy can open it.</p>
    </div>)
  async function send() {
    setErr(''); setBusy(true)
    const r = await api('send-code', {}); setBusy(false)
    if (!r.ok) { setErr(r.error || 'Could not send the code.'); return }
    setSent(r.to || 'your email')
  }
  async function verify() {
    setErr(''); setBusy(true)
    const r = await api('verify', { code }); setBusy(false)
    if (!r.ok) { setErr(r.error || 'Wrong code.'); return }
    onIn()
  }
  return (
    <div className={card + ' max-w-md mx-auto mt-16 p-8'}>
      <p className="text-3xl mb-2 text-center">🔐</p>
      <h1 className="text-lg font-bold text-center text-[#1A1D2E]">Cash Flow &amp; Liabilities</h1>
      <p className="text-sm text-gray-500 text-center mb-5">Private board. Every visit needs a 6-digit code sent to {me.email}.</p>
      {!sent ? (
        <button onClick={send} disabled={busy} className="w-full h-12 rounded-xl text-white font-bold disabled:opacity-50" style={{ background: G }}>{busy ? 'Sending…' : 'Email me a code'}</button>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">Code sent to <b>{sent}</b>. It works for 10 minutes.</p>
          <input autoFocus inputMode="numeric" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} onKeyDown={e => { if (e.key === 'Enter' && code.length === 6) verify() }}
            placeholder="123456" className="w-full h-14 text-center text-2xl tracking-[0.5em] font-bold border border-[#E4E6EE] rounded-xl" />
          <button onClick={verify} disabled={busy || code.length !== 6} className="w-full h-12 rounded-xl text-white font-bold disabled:opacity-40" style={{ background: G }}>{busy ? 'Checking…' : 'Open the board'}</button>
          <button onClick={send} disabled={busy} className="w-full text-xs text-gray-500 underline">Send a new code</button>
        </div>)}
      {err && <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
    </div>)
}

/* ───────────── tiny markdown ───────────── */
function Md({ text }: { text: string }) {
  const inline = (s: string, k: number) => {
    const parts: any[] = []; let rest = s; let i = 0
    const re = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/
    while (rest) {
      const m = rest.match(re)
      if (!m || m.index == null) { parts.push(rest); break }
      if (m.index) parts.push(rest.slice(0, m.index))
      const t = m[0]
      if (t.startsWith('**')) parts.push(<b key={k + '-' + i++}>{t.slice(2, -2)}</b>)
      else { const mm = t.match(/\[([^\]]+)\]\(([^)]+)\)/)!; parts.push(<a key={k + '-' + i++} href={mm[2]} target="_blank" rel="noreferrer" className="text-[#0071ce] underline">{mm[1]}</a>) }
      rest = rest.slice(m.index + t.length)
    }
    return parts
  }
  return (
    <div className="space-y-1.5 text-[13.5px] leading-relaxed text-[#1A1D2E]">
      {text.split('\n').map((ln, k) => {
        const t = ln.trimEnd()
        if (!t.trim()) return <div key={k} className="h-1" />
        if (/^#{1,4}\s/.test(t)) return <h3 key={k} className="font-bold text-[15px] pt-2" style={{ color: G }}>{inline(t.replace(/^#+\s/, ''), k)}</h3>
        if (/^\s*[-*•]\s/.test(t)) return <div key={k} className="flex gap-2" style={{ paddingLeft: (t.match(/^\s*/)![0].length) * 6 }}><span className="text-gray-400">•</span><span>{inline(t.replace(/^\s*[-*•]\s/, ''), k)}</span></div>
        if (/^\s*\d+[.)]\s/.test(t)) return <div key={k} className="flex gap-2"><span className="text-gray-500 font-semibold">{t.match(/^\s*(\d+)/)![1]}.</span><span>{inline(t.replace(/^\s*\d+[.)]\s/, ''), k)}</span></div>
        if (/^\|/.test(t)) return <div key={k} className="font-mono text-[11.5px] text-gray-700 whitespace-pre overflow-x-auto">{t}</div>
        return <p key={k}>{inline(t, k)}</p>
      })}
    </div>)
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'red' | 'green' | 'amber' }) {
  const c = tone === 'red' ? '#d83a52' : tone === 'green' ? G : tone === 'amber' ? '#c47b00' : '#1A1D2E'
  return <div className={card + ' p-4'}><p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">{label}</p><p className="text-2xl font-extrabold mt-1" style={{ color: c }}>{value}</p>{sub && <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>}</div>
}

function Modal({ title, children, onClose }: { title: string; children: any; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto p-4" style={{ background: 'rgba(26,32,53,0.5)' }} onClick={onClose}>
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl my-8" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-[#EEF0F4] flex items-center justify-between"><h2 className="font-bold text-[#1A1D2E]">{title}</h2><button onClick={onClose} className="text-2xl text-gray-400">&times;</button></div>
        <div className="p-5">{children}</div>
      </div>
    </div>)
}
const F = ({ label, children, hint }: { label: string; children: any; hint?: string }) => <label className="block"><span className="text-xs font-semibold text-gray-500">{label}</span><div className="mt-1">{children}</div>{hint && <span className="text-[10px] text-gray-400">{hint}</span>}</label>

/* ───────────── board ───────────── */
export default function CashflowPage() {
  const [unlocked, setUnlocked] = useState(false)
  const [d, setD] = useState<any>(null)
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState('')
  const [tab, setTab] = useState<Tab>('overview')
  const load = useCallback(async () => {
    const r = await api('data')
    if (r.status === 401) { setUnlocked(false); return }
    if (!r.ok) { setErr(r.error || 'Could not load'); return }
    setD(r); setUnlocked(true)
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(''), 6000); return () => clearTimeout(t) }, [flash])

  if (!unlocked) return <Gate onIn={load} />
  if (!d) return <p className="p-10 text-gray-400">{err || 'Loading…'}</p>
  return <Board d={d} reload={load} tab={tab} setTab={setTab} flash={flash} setFlash={setFlash} lock={async () => { await api('lock', {}); setUnlocked(false); setD(null) }} />
}

function Board({ d, reload, tab, setTab, flash, setFlash, lock }: { d: any; reload: () => void; tab: Tab; setTab: (t: Tab) => void; flash: string; setFlash: (s: string) => void; lock: () => void }) {
  const L: Liability[] = d.liabilities.map((x: any) => ({ ...x, balance: n(x.balance), apr: n(x.apr) }))
  const E: Expense[] = d.expenses, I: Income[] = d.income, erp: Erp = d.erp
  const S: Settings = {
    cash_on_hand: n(d.settings.cash_on_hand), cash_as_of: String(d.settings.cash_as_of || ymd(new Date())), min_reserve: n(d.settings.min_reserve),
    weekly_budget: n(d.settings.weekly_budget), quarterly_goal: n(d.settings.quarterly_goal), strategy: String(d.settings.strategy || 'smart'),
    collect_rate: d.settings.collect_rate == null ? 85 : n(d.settings.collect_rate), collect_lag_days: n(d.settings.collect_lag_days),
  }
  const [what, setWhat] = useState<{ budget: number; strategy: string } | null>(null) // what-if overrides on the plan tab
  const S2: Settings = what ? { ...S, weekly_budget: what.budget, strategy: what.strategy } : S

  const open = L.filter(isOpen)
  const totals = useMemo(() => {
    const by = (k: string) => open.filter(l => l.kind === k).reduce((t, l) => t + l.balance, 0)
    const credits = L.filter(l => l.balance < 0).reduce((t, l) => t + l.balance, 0)
    return { all: open.reduce((t, l) => t + l.balance, 0), ap: by('ap'), loans: by('loan'), cards: by('credit_card'), other: by('other'), credits,
      ap90: open.filter(l => l.kind === 'ap').reduce((t, l) => t + over90(l), 0), arOpen: erp.ar.reduce((t, a) => t + a.open, 0),
      pipe: erp.pipeline.reduce((t, a) => t + a.value, 0) + erp.walmart.reduce((t, a) => t + a.value, 0),
      fixedMonthly: E.filter(e => e.active).reduce((t, e) => t + weeklyOf(e.amount, e.frequency) * 52 / 12, 0) }
  }, [d]) // eslint-disable-line react-hooks/exhaustive-deps
  const fc = useMemo(() => forecast(S2, L, E, I, erp, 13), [d, what]) // eslint-disable-line react-hooks/exhaustive-deps
  const plan = useMemo(() => simulate(S2, L, i => i < fc.length ? fc[i].payoff : n(S2.weekly_budget)), [d, what, fc]) // eslint-disable-line react-hooks/exhaustive-deps
  const free13 = fc.reduce((t, w) => t + w.free, 0)
  const qNow = quarterOf(new Date())
  const qStart = new Date(new Date().getFullYear(), Math.floor(new Date().getMonth() / 3) * 3, 1)
  const paidQ = d.payments.filter((p: any) => !p.voided_at && parse(p.paid_on) >= qStart).reduce((t: number, p: any) => t + n(p.amount), 0)
  const quarters = useMemo(() => {
    const m = new Map<string, number>()
    for (const w of plan.weeks.slice(0, 104)) { const q = quarterOf(w.start); m.set(q, (m.get(q) || 0) + w.total) }
    return Array.from(m.entries()).slice(0, 8).map(([q, v]) => ({ q, plan: Math.round(v), goal: S.quarterly_goal }))
  }, [plan]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (type: string, row: any, msg = '✓ Saved.') => { const r = await api('save', { type, row }); if (!r.ok) { setFlash('⚠ ' + (r.error || 'Not saved')); return false } setFlash(msg); reload(); return true }
  const del = async (type: string, id: string) => { if (!window.confirm('Delete this row?')) return; const r = await api('delete', { type, id }); setFlash(r.ok ? '🗑 Deleted.' : '⚠ ' + r.error); reload() }
  const saveSettings = async (values: any) => { const r = await api('settings', { values }); setFlash(r.ok ? '✓ Settings saved.' : '⚠ ' + r.error); reload() }

  const snapshot = () => ({
    today: ymd(new Date()), settings: S, totals,
    liabilities: L.map(l => ({ name: l.name, kind: l.kind, balance: Math.round(l.balance), aging: l.aging, apr: l.apr, min_payment: l.min_payment, min_frequency: l.min_frequency, negotiated: l.negotiated_amount, critical: l.critical, priority: l.priority, notes: l.notes, status: l.status, planned_payoff: plan.payoff[l.id]?.date ? ymd(plan.payoff[l.id].date!) : null })),
    fixed_expenses: E.filter(e => e.active).map(e => ({ name: e.name, category: e.category, amount: e.amount, frequency: e.frequency })),
    other_income: I.filter(x => x.active).map(x => ({ name: x.name, amount: x.amount, frequency: x.frequency, date: x.expected_date, probability: x.probability })),
    receivables_open: Math.round(totals.arOpen), receivables_overdue: Math.round(erp.ar.filter(a => a.due && parse(a.due) < new Date()).reduce((t, a) => t + a.open, 0)),
    top_receivables: [...erp.ar].sort((a, b) => b.open - a.open).slice(0, 15).map(a => ({ customer: a.customer, number: a.number, due: a.due, open: Math.round(a.open) })),
    open_orders_value: Math.round(totals.pipe), collected_last_180d: Math.round(erp.collected180),
    forecast_13w: fc.map(w => ({ week: ymd(w.start), inflow: Math.round(w.inflow), outflow: Math.round(w.outflow), free: Math.round(w.free), payoff: Math.round(w.payoff), cash_end: Math.round(w.cash) })),
    plan: { debt_free: plan.debtFree ? ymd(plan.debtFree) : 'not within 10 years at this pace', interest: Math.round(plan.totalInterest), settlement_savings: Math.round(plan.savings), quarters },
    payments_recent: d.payments.slice(0, 30).map((p: any) => ({ date: p.paid_on, amount: p.amount, to: L.find(l => l.id === p.liability_id)?.name, voided: !!p.voided_at })),
  })

  const TABS: [Tab, string][] = [['overview', 'Overview'], ['liabilities', `Liabilities (${open.length})`], ['plan', 'Payoff plan'], ['cash', 'Cash flow inputs'], ['advisor', 'AI advisor'], ['funding', 'Funding & grants'], ['activity', 'Activity']]
  return (
    <div className="max-w-[1400px] mx-auto pb-16">
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="mr-auto">
          <p className="text-[11px] uppercase tracking-[0.15em] font-bold" style={{ color: G }}>Finance · private</p>
          <h1 className="text-2xl font-extrabold text-[#1A1D2E]">Cash Flow &amp; Liabilities</h1>
          <p className="text-xs text-gray-500">Signed in as {d.me.name} · 2-step verified · data from the ERP refreshes each time you open the board</p>
        </div>
        <button onClick={reload} className="h-9 px-3 rounded-lg border border-[#E4E6EE] text-xs font-semibold text-gray-600">↻ Refresh</button>
        <button onClick={lock} className="h-9 px-3 rounded-lg border border-[#E4E6EE] text-xs font-semibold text-gray-600">🔒 Lock</button>
      </div>
      <div className="flex flex-wrap gap-1 p-1 mb-4 rounded-xl bg-[#EEF0F4]">
        {TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`h-10 px-4 rounded-lg text-sm font-semibold ${tab === k ? 'bg-white shadow-sm text-[#1A1D2E]' : 'text-gray-500'}`}>{l}</button>)}
      </div>
      {flash && <div className={`mb-3 rounded-xl border text-sm px-4 py-3 ${flash.startsWith('⚠') ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>{flash}</div>}

      {tab === 'overview' && <Overview {...{ S, totals, fc, plan, free13, paidQ, qNow, quarters, open, saveSettings, setTab }} />}
      {tab === 'liabilities' && <Liabilities {...{ L, plan, save, del, reload, setFlash, payments: d.payments }} />}
      {tab === 'plan' && <PlanTab {...{ S, S2, L, plan, fc, quarters, what, setWhat, saveSettings }} />}
      {tab === 'cash' && <CashInputs {...{ E, I, erp, fc, save, del, S }} />}
      {tab === 'advisor' && <Advisor kind="plan" runs={d.ai.filter((r: any) => r.kind === 'plan')} snapshot={snapshot} reload={reload} />}
      {tab === 'funding' && <Advisor kind="funding" runs={d.ai.filter((r: any) => r.kind === 'funding')} snapshot={snapshot} reload={reload} />}
      {tab === 'activity' && <Activity audit={d.audit} payments={d.payments} L={L} reload={reload} setFlash={setFlash} />}
    </div>)
}

/* ───────────── Overview ───────────── */
function Overview({ S, totals, fc, plan, free13, paidQ, qNow, quarters, open, saveSettings, setTab }: any) {
  const [edit, setEdit] = useState(false)
  const [v, setV] = useState<any>(S)
  const debtLine = plan.weeks.filter((_: any, i: number) => i % 4 === 0).slice(0, 40).map((w: any) => ({ date: w.start.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), debt: Math.round(w.debt) }))
  const fcData = fc.map((w: any) => ({ week: w.label, Inflow: Math.round(w.inflow), Outflow: -Math.round(w.outflow), Payoff: -Math.round(w.payoff), Cash: Math.round(w.cash) }))
  const lowest = Math.min(...fc.map((w: any) => w.cash))
  const qPlan = quarters.find((q: any) => q.q === qNow)?.plan || 0
  const top = rankLiabilities(open, S.strategy).slice(0, 6)
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Total liabilities" value={money(totals.all)} sub={`AP ${short$(totals.ap)} · Loans ${short$(totals.loans)} · Cards ${short$(totals.cards)}`} tone="red" />
        <Kpi label="Vendor bills over 90 days" value={money(totals.ap90)} sub={`${Math.round(totals.ap90 / Math.max(1, totals.ap) * 100)}% of AP`} tone="amber" />
        <Kpi label="Free cash, next 13 weeks" value={money(free13)} sub={`after fixed costs and minimums · ${money(free13 / 13)}/wk`} tone={free13 >= 0 ? 'green' : 'red'} />
        <Kpi label="Debt-free at this pace" value={plan.debtFree ? fmtDate(plan.debtFree) : 'Over 10 yrs'} sub={`${money(S.weekly_budget)}/wk · ${STRATS[S.strategy]?.split(' (')[0]}`} />
        <Kpi label="Cash on hand" value={money(S.cash_on_hand)} sub={`as of ${fmtDate(S.cash_as_of)} · reserve ${money(S.min_reserve)}`} tone={S.cash_on_hand > S.min_reserve ? 'green' : 'amber'} />
        <Kpi label="Lowest cash, 13 weeks" value={money(lowest)} sub={lowest < S.min_reserve ? 'dips under the reserve, see forecast' : 'stays above the reserve'} tone={lowest < S.min_reserve ? 'red' : 'green'} />
        <Kpi label={`${qNow} paydown`} value={money(paidQ)} sub={`paid so far · plan ${money(qPlan)} · goal ${money(S.quarterly_goal)}`} tone={paidQ >= S.quarterly_goal ? 'green' : 'amber'} />
        <Kpi label="Coming in (ERP)" value={money(totals.arOpen + totals.pipe)} sub={`invoices ${short$(totals.arOpen)} · open orders ${short$(totals.pipe)}`} tone="green" />
      </div>

      <div className={card + ' p-4'}>
        <div className="flex items-center mb-2"><p className="font-bold text-[#1A1D2E] mr-auto">Plan settings</p><button onClick={() => { setV(S); setEdit(e => !e) }} className="text-xs font-semibold text-[#0071ce]">{edit ? 'Cancel' : '✎ Edit'}</button></div>
        {!edit ? (
          <p className="text-[13px] text-gray-600">Cash {money(S.cash_on_hand)} (as of {fmtDate(S.cash_as_of)}) · keep at least {money(S.min_reserve)} · pay down {money(S.weekly_budget)}/week · goal {money(S.quarterly_goal)}/quarter · order: {STRATS[S.strategy]} · expect {S.collect_rate}% of invoices/orders to be collected, {S.collect_lag_days} days after due</p>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <F label="Cash on hand (bank)"><input className={inp} value={v.cash_on_hand} onChange={e => setV({ ...v, cash_on_hand: e.target.value })} /></F>
            <F label="As of"><input type="date" className={inp} value={v.cash_as_of} onChange={e => setV({ ...v, cash_as_of: e.target.value })} /></F>
            <F label="Minimum cash reserve"><input className={inp} value={v.min_reserve} onChange={e => setV({ ...v, min_reserve: e.target.value })} /></F>
            <F label="Weekly payoff budget"><input className={inp} value={v.weekly_budget} onChange={e => setV({ ...v, weekly_budget: e.target.value })} /></F>
            <F label="Quarterly paydown goal"><input className={inp} value={v.quarterly_goal} onChange={e => setV({ ...v, quarterly_goal: e.target.value })} /></F>
            <F label="Payoff order"><select className={inp} value={v.strategy} onChange={e => setV({ ...v, strategy: e.target.value })}>{Object.entries(STRATS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></F>
            <F label="Collection rate %" hint="share of open invoices/orders expected to be paid"><input className={inp} value={v.collect_rate} onChange={e => setV({ ...v, collect_rate: e.target.value })} /></F>
            <F label="Paid days after due" hint="how late customers usually pay"><input className={inp} value={v.collect_lag_days} onChange={e => setV({ ...v, collect_lag_days: e.target.value })} /></F>
            <div className="col-span-2 lg:col-span-4"><button onClick={() => { const num = (x: any) => Number(String(x).replace(/[$,\s]/g, '')) || 0; saveSettings({ cash_on_hand: num(v.cash_on_hand), cash_as_of: v.cash_as_of, min_reserve: num(v.min_reserve), weekly_budget: num(v.weekly_budget), quarterly_goal: num(v.quarterly_goal), strategy: v.strategy, collect_rate: num(v.collect_rate), collect_lag_days: num(v.collect_lag_days) }); setEdit(false) }} className="h-10 px-5 rounded-lg text-white text-sm font-bold" style={{ background: G }}>Save settings</button></div>
          </div>)}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className={card + ' p-4'}>
          <p className="font-bold text-[#1A1D2E]">13-week cash forecast</p>
          <p className="text-[11px] text-gray-500 mb-2">Money in (invoices, open orders, other income) vs fixed costs, minimums and the planned payoff. Line = cash left.</p>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={fcData} stackOffset="sign">
              <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F4" />
              <XAxis dataKey="week" tick={{ fontSize: 10 }} /><YAxis tickFormatter={short$} tick={{ fontSize: 10 }} width={56} />
              <Tooltip formatter={(x: any) => money(Math.abs(x))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine y={S.min_reserve} stroke="#d83a52" strokeDasharray="4 4" />
              <Bar dataKey="Inflow" stackId="a" fill="#00c875" /><Bar dataKey="Outflow" stackId="a" fill="#fdab3d" /><Bar dataKey="Payoff" stackId="a" fill="#579bfc" />
              <Line dataKey="Cash" stroke="#1A1D2E" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className={card + ' p-4'}>
          <p className="font-bold text-[#1A1D2E]">Total debt over time (plan)</p>
          <p className="text-[11px] text-gray-500 mb-2">At {money(S.weekly_budget)}/week once cash allows, in the &quot;{STRATS[S.strategy]?.split(' (')[0]}&quot; order. Settlements save {money(plan.savings)}.</p>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={debtLine}><CartesianGrid strokeDasharray="3 3" stroke="#EEF0F4" /><XAxis dataKey="date" tick={{ fontSize: 10 }} /><YAxis tickFormatter={short$} tick={{ fontSize: 10 }} width={56} /><Tooltip formatter={(x: any) => money(x)} /><Area dataKey="debt" stroke="#d83a52" fill="#d83a5233" /></AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className={card + ' p-4'}>
          <p className="font-bold text-[#1A1D2E] mb-2">Quarterly paydown: plan vs goal</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={quarters}><CartesianGrid strokeDasharray="3 3" stroke="#EEF0F4" /><XAxis dataKey="q" tick={{ fontSize: 10 }} /><YAxis tickFormatter={short$} tick={{ fontSize: 10 }} width={56} /><Tooltip formatter={(x: any) => money(x)} /><Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="plan" name="Plan pays" fill={G} /><Bar dataKey="goal" name="Goal" fill="#CFE6D8" /></BarChart>
          </ResponsiveContainer>
        </div>
        <div className={card + ' p-4'}>
          <div className="flex items-center mb-2"><p className="font-bold text-[#1A1D2E] mr-auto">Next in line to pay</p><button onClick={() => setTab('plan')} className="text-xs font-semibold text-[#0071ce]">Full plan →</button></div>
          {top.map((l: Liability, i: number) => (
            <div key={l.id} className="flex items-center gap-2 py-1.5 border-t border-[#F0F2F6] text-[13px]">
              <span className="w-5 text-gray-400 font-bold">{i + 1}</span>
              <span className="flex-1 min-w-0 truncate"><b>{l.name}</b> <span className="text-[11px] text-gray-400">{kindLabel[l.kind]}{l.critical ? ' · critical' : ''}{n(l.negotiated_amount) > 0 ? ` · settle ${money(l.negotiated_amount)}` : ''}</span></span>
              <span className="font-semibold">{money(target(l))}</span>
              <span className="text-[11px] text-gray-500 w-24 text-right">{plan.payoff[l.id]?.date ? fmtDate(plan.payoff[l.id].date) : '—'}</span>
            </div>))}
        </div>
      </div>
    </div>)
}

/* ───────────── Liabilities ───────────── */
function Liabilities({ L, plan, save, del, reload, setFlash, payments }: any) {
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('all')
  const [calc, setCalc] = useState('1000')
  const [edit, setEdit] = useState<any>(null)
  const [pay, setPay] = useState<Liability | null>(null)
  const [sort, setSort] = useState<'balance' | 'name' | 'over90' | 'payoff'>('balance')
  const per = Number(String(calc).replace(/[$,]/g, '')) || 0
  const rows = (L as Liability[]).filter(l => (kind === 'all' || l.kind === kind) && (!q || l.name.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'over90' ? over90(b) - over90(a) : sort === 'payoff' ? ((plan.payoff[a.id]?.week ?? 1e9) - (plan.payoff[b.id]?.week ?? 1e9)) : b.balance - a.balance)
  const sum = rows.filter(isOpen).reduce((t, l) => t + l.balance, 0)
  return (
    <div className="space-y-3">
      <div className={card + ' p-3 flex flex-wrap items-center gap-2'}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" className={inp + ' max-w-[220px]'} />
        <select value={kind} onChange={e => setKind(e.target.value)} className={inp + ' max-w-[170px]'}><option value="all">All types</option>{Object.entries(kindLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select value={sort} onChange={e => setSort(e.target.value as any)} className={inp + ' max-w-[190px]'}><option value="balance">Largest first</option><option value="over90">Most over 90 days</option><option value="payoff">Plan payoff date</option><option value="name">Name</option></select>
        <span className="text-xs text-gray-500 ml-2">Payoff calculator: pay</span><input value={calc} onChange={e => setCalc(e.target.value)} className={inp + ' max-w-[110px]'} /><span className="text-xs text-gray-500">per week on each</span>
        <span className="ml-auto text-sm font-bold">{rows.length} · {money(sum)}</span>
        <button onClick={() => setEdit({ kind: 'ap', name: '', balance: '', apr: 0, critical: false })} className="h-10 px-4 rounded-lg text-white text-sm font-bold" style={{ background: G }}>+ Add</button>
      </div>
      <div className={card + ' overflow-x-auto'}>
        <table className="w-full min-w-[1150px]">
          <thead><tr className="bg-[#FBFCFE]"><th className={th + ' text-left'}>Name</th><th className={th + ' text-left'}>Type</th><th className={th + ' text-right'}>Balance</th><th className={th + ' text-right'}>Over 90</th><th className={th + ' text-right'}>APR</th><th className={th + ' text-right'}>Min pay</th><th className={th + ' text-right'}>Settle at</th><th className={th + ' text-right'}>At {money(per)}/wk</th><th className={th + ' text-right'}>Plan pays off</th><th className={th}></th></tr></thead>
          <tbody>{rows.map(l => {
            const c = payoffWeeks(target(l), l.apr, per)
            const p = plan.payoff[l.id]
            return (
              <tr key={l.id} className={l.status === 'paid' ? 'opacity-50' : ''}>
                <td className={td}><button onClick={() => setEdit({ ...l })} className="text-left"><b className="text-[#1A1D2E] hover:underline">{l.name}</b>{l.critical && <span className="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-600">CRITICAL</span>}{l.priority != null && <span className="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">#{l.priority}</span>}
                  <span className="block text-[10px] text-gray-400">{l.account_code ? l.account_code + ' · ' : ''}{l.notes || l.source || ''}</span></button></td>
                <td className={td + ' text-[12px] text-gray-600'}>{kindLabel[l.kind]}</td>
                <td className={td + ' text-right font-bold'}>{money(l.balance, 2)}</td>
                <td className={td + ' text-right ' + (over90(l) > 0 ? 'text-red-600' : 'text-gray-300')}>{over90(l) ? money(over90(l)) : '—'}</td>
                <td className={td + ' text-right'}>{l.apr ? l.apr + '%' : <span className="text-gray-300">0%</span>}</td>
                <td className={td + ' text-right'}>{l.min_payment ? `${money(l.min_payment)}/${(l.min_frequency || 'monthly').replace('ly', '')}` : <span className="text-gray-300">—</span>}</td>
                <td className={td + ' text-right'}>{n(l.negotiated_amount) > 0 ? <span className="text-emerald-700 font-semibold">{money(l.negotiated_amount)}</span> : <span className="text-gray-300">—</span>}</td>
                <td className={td + ' text-right text-[12px]'}>{!isOpen(l) ? '✓ paid' : c.never ? <span className="text-red-600">never (interest)</span> : `${c.weeks} wks · ${fmtDate(addDays(monday(new Date()), c.weeks * 7))}`}</td>
                <td className={td + ' text-right text-[12px]'}>{p?.date ? fmtDate(p.date) : isOpen(l) ? <span className="text-gray-400">after 10 yrs</span> : '—'}</td>
                <td className={td + ' text-right whitespace-nowrap'}>{isOpen(l) && <button onClick={() => setPay(l)} className="h-8 px-3 rounded-lg text-xs font-bold text-white" style={{ background: G }}>Pay</button>}</td>
              </tr>)
          })}</tbody>
        </table>
      </div>
      {edit && <EditLiability row={edit} onClose={() => setEdit(null)} save={save} del={del} payments={payments.filter((p: any) => p.liability_id === edit.id)} />}
      {pay && <PayModal l={pay} onClose={() => setPay(null)} done={(m: string) => { setPay(null); setFlash(m); reload() }} />}
    </div>)
}

function EditLiability({ row, onClose, save, del, payments }: any) {
  const [r, setR] = useState<any>({ ...row })
  const set = (k: string, v: any) => setR((x: any) => ({ ...x, [k]: v }))
  const num = (x: any) => x === '' || x == null ? null : Number(String(x).replace(/[$,\s%]/g, ''))
  const [per, setPer] = useState('1000')
  const c = payoffWeeks(n(num(r.negotiated_amount)) > 0 && n(num(r.negotiated_amount)) < n(num(r.balance)) ? n(num(r.negotiated_amount)) : n(num(r.balance)), n(num(r.apr)), Number(per) || 0)
  return (
    <Modal title={row.id ? row.name : 'Add a liability'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><F label="Name"><input className={inp} value={r.name || ''} onChange={e => set('name', e.target.value)} /></F></div>
        <F label="Type"><select className={inp} value={r.kind} onChange={e => set('kind', e.target.value)}>{Object.entries(kindLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></F>
        <F label="Account / ref"><input className={inp} value={r.account_code || ''} onChange={e => set('account_code', e.target.value)} /></F>
        <F label="Current balance"><input className={inp} value={r.balance ?? ''} onChange={e => set('balance', e.target.value)} /></F>
        <F label="Interest rate (APR %)"><input className={inp} value={r.apr ?? ''} onChange={e => set('apr', e.target.value)} /></F>
        <F label="Minimum payment"><input className={inp} value={r.min_payment ?? ''} onChange={e => set('min_payment', e.target.value)} /></F>
        <F label="Minimum is paid"><select className={inp} value={r.min_frequency || 'monthly'} onChange={e => set('min_frequency', e.target.value)}>{['weekly', 'biweekly', 'monthly', 'quarterly', 'annual'].map(f => <option key={f}>{f}</option>)}</select></F>
        <F label="Settle for (negotiated)" hint="vendor agreed to accept this to close the bill"><input className={inp} value={r.negotiated_amount ?? ''} onChange={e => set('negotiated_amount', e.target.value)} /></F>
        <F label="Due / maturity date"><input type="date" className={inp} value={r.due_date || ''} onChange={e => set('due_date', e.target.value)} /></F>
        <F label="Priority (1 = pay first)" hint="overrides the payoff order"><input className={inp} value={r.priority ?? ''} onChange={e => set('priority', e.target.value)} /></F>
        <F label="Critical supplier?"><select className={inp} value={r.critical ? 'yes' : 'no'} onChange={e => set('critical', e.target.value === 'yes')}><option value="no">No</option><option value="yes">Yes, keep them current</option></select></F>
        <div className="col-span-2"><F label="Contact"><input className={inp} value={r.contact || ''} onChange={e => set('contact', e.target.value)} /></F></div>
        <div className="col-span-2"><F label="Notes / deal terms"><textarea className={inp + ' h-20 py-2'} value={r.notes || ''} onChange={e => set('notes', e.target.value)} /></F></div>
      </div>
      <div className="mt-4 rounded-xl bg-[#F6FBF8] border border-[#D6E9DD] p-3 text-sm">
        <p className="font-semibold text-[#0f7a4a] mb-1">Payoff time calculator</p>
        <div className="flex items-center gap-2">Paying <input className={inp + ' max-w-[110px]'} value={per} onChange={e => setPer(e.target.value.replace(/[^\d.]/g, ''))} /> a week clears it in
          <b>{c.never ? 'never (does not cover interest)' : `${c.weeks} weeks (${fmtDate(addDays(monday(new Date()), c.weeks * 7))})`}</b>{!c.never && c.interest > 0 && <span className="text-gray-500">, {money(c.interest)} interest</span>}</div>
      </div>
      {payments?.length > 0 && <div className="mt-3"><p className="text-xs font-semibold text-gray-500 mb-1">Payments</p>{payments.map((p: any) => <p key={p.id} className={`text-[12px] ${p.voided_at ? 'line-through text-gray-400' : ''}`}>{fmtDate(p.paid_on)} · {money(p.amount, 2)} · {p.method || ''} {p.note || ''} · {String(p.entered_by || '').split('@')[0]}</p>)}</div>}
      <div className="flex gap-2 mt-4">
        {row.id && <button onClick={() => { del('liability', row.id); onClose() }} className="h-10 px-3 rounded-lg text-red-600 text-sm">Delete</button>}
        <button onClick={onClose} className="ml-auto h-10 px-4 rounded-lg border border-[#E4E6EE] text-sm">Cancel</button>
        <button onClick={async () => { if (!r.name) return; if (await save('liability', { ...r, balance: num(r.balance) ?? 0, apr: num(r.apr) ?? 0, min_payment: num(r.min_payment), negotiated_amount: num(r.negotiated_amount), priority: num(r.priority) })) onClose() }} className="h-10 px-5 rounded-lg text-white text-sm font-bold" style={{ background: G }}>Save</button>
      </div>
    </Modal>)
}

function PayModal({ l, onClose, done }: { l: Liability; onClose: () => void; done: (m: string) => void }) {
  const [amt, setAmt] = useState('')
  const [date, setDate] = useState(ymd(new Date()))
  const [method, setMethod] = useState('ACH')
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function go() {
    const a = Number(amt.replace(/[$,\s]/g, ''))
    if (!(a > 0)) { setErr('Enter the amount paid.'); return }
    setBusy(true)
    const r = await api('payment', { liability_id: l.id, amount: a, paid_on: date, method, note })
    setBusy(false)
    if (!r.ok) { setErr(r.error); return }
    done(`✓ ${money(a, 2)} paid to ${l.name}. New balance ${money(r.balance, 2)}.`)
  }
  return (
    <Modal title={`Record a payment: ${l.name}`} onClose={onClose}>
      <p className="text-sm text-gray-500 mb-3">Balance {money(l.balance, 2)}{n(l.negotiated_amount) > 0 ? ` · settle for ${money(l.negotiated_amount)}` : ''}. This lowers the balance on this board (record it in QuickBooks too).</p>
      <div className="grid grid-cols-2 gap-3">
        <F label="Amount"><input autoFocus className={inp} value={amt} onChange={e => setAmt(e.target.value)} /></F>
        <F label="Date paid"><input type="date" className={inp} value={date} onChange={e => setDate(e.target.value)} /></F>
        <F label="Method"><select className={inp} value={method} onChange={e => setMethod(e.target.value)}>{['ACH', 'Wire', 'Check', 'Card', 'Credit / offset', 'Other'].map(m => <option key={m}>{m}</option>)}</select></F>
        <F label="Note / ref #"><input className={inp} value={note} onChange={e => setNote(e.target.value)} /></F>
      </div>
      {err && <p className="mt-3 text-sm text-red-700">{err}</p>}
      <div className="flex gap-2 mt-4"><button onClick={onClose} className="ml-auto h-10 px-4 rounded-lg border border-[#E4E6EE] text-sm">Cancel</button><button onClick={go} disabled={busy} className="h-10 px-5 rounded-lg text-white text-sm font-bold disabled:opacity-50" style={{ background: G }}>{busy ? 'Saving…' : 'Record payment'}</button></div>
    </Modal>)
}

/* ───────────── Payoff plan ───────────── */
function PlanTab({ S, S2, L, plan, fc, quarters, what, setWhat, saveSettings }: any) {
  const [budget, setBudget] = useState(String(S2.weekly_budget))
  const [strategy, setStrategy] = useState(S2.strategy)
  const order = rankLiabilities(L, S2.strategy)
  const weeks = plan.weeks.slice(0, 13)
  const csv = () => {
    const lines = [['Week of', 'Pay to', 'Amount'].join(',')]
    for (const w of plan.weeks.slice(0, 104)) for (const p of w.paid) lines.push([ymd(w.start), '"' + p.name.replace(/"/g, '""') + '"', p.amount.toFixed(2)].join(','))
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `payoff-schedule-${ymd(new Date())}.csv`; a.click()
  }
  return (
    <div className="space-y-4">
      <div className={card + ' p-4 flex flex-wrap items-end gap-3'}>
        <F label="What if we pay this much a week?"><input className={inp + ' w-40'} value={budget} onChange={e => setBudget(e.target.value)} /></F>
        <F label="In this order"><select className={inp + ' w-80'} value={strategy} onChange={e => setStrategy(e.target.value)}>{Object.entries(STRATS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></F>
        <button onClick={() => setWhat({ budget: Number(budget.replace(/[$,]/g, '')) || 0, strategy })} className="h-10 px-4 rounded-lg text-white text-sm font-bold" style={{ background: '#579bfc' }}>Run what-if</button>
        {what && <><button onClick={() => setWhat(null)} className="h-10 px-3 rounded-lg border border-[#E4E6EE] text-sm">Back to saved plan</button>
          <button onClick={() => { saveSettings({ weekly_budget: what.budget, strategy: what.strategy }); setWhat(null) }} className="h-10 px-3 rounded-lg text-white text-sm font-bold" style={{ background: G }}>Make this the plan</button></>}
        <button onClick={csv} className="ml-auto h-10 px-3 rounded-lg border border-[#E4E6EE] text-sm">⬇ Schedule (CSV)</button>
        <p className="w-full text-[12px] text-gray-500">{what ? 'What-if: ' : 'Saved plan: '}<b>{money(S2.weekly_budget)}/week</b> (less in weeks where cash would drop under the {money(S.min_reserve)} reserve), {STRATS[S2.strategy]}. Debt-free <b>{plan.debtFree ? fmtDate(plan.debtFree) : 'not within 10 years'}</b> · interest {money(plan.totalInterest)} · settlement savings {money(plan.savings)}.</p>
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className={card + ' p-4 lg:col-span-2 overflow-x-auto'}>
          <p className="font-bold text-[#1A1D2E] mb-2">Next 13 weeks: who gets paid</p>
          <table className="w-full min-w-[600px]"><thead><tr><th className={th + ' text-left'}>Week of</th><th className={th + ' text-right'}>Free cash</th><th className={th + ' text-right'}>Pay down</th><th className={th + ' text-left'}>To</th><th className={th + ' text-right'}>Cash after</th></tr></thead>
            <tbody>{weeks.map((w: any, i: number) => (
              <tr key={i}><td className={td}>{fmtDate(w.start)}</td><td className={td + ' text-right ' + (fc[i]?.free < 0 ? 'text-red-600' : '')}>{money(fc[i]?.free)}</td><td className={td + ' text-right font-bold'}>{money(w.total)}</td>
                <td className={td + ' text-[12px]'}>{w.paid.length ? w.paid.map((p: any) => `${p.name} ${short$(p.amount)}`).join(' · ') : <span className="text-gray-400">nothing free this week</span>}</td>
                <td className={td + ' text-right ' + (fc[i]?.cash < S.min_reserve ? 'text-red-600 font-semibold' : '')}>{money(fc[i]?.cash)}</td></tr>))}</tbody></table>
        </div>
        <div className={card + ' p-4'}>
          <p className="font-bold text-[#1A1D2E] mb-2">Quarterly goal check</p>
          {quarters.map((q: any) => <div key={q.q} className="flex items-center gap-2 py-1 text-[13px] border-t border-[#F0F2F6]"><span className="w-20 font-semibold">{q.q}</span>
            <div className="flex-1 h-2 bg-[#F0F2F6] rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: Math.min(100, q.plan / Math.max(1, q.goal) * 100) + '%', background: q.plan >= q.goal ? '#00c875' : '#fdab3d' }} /></div>
            <span className="w-28 text-right text-[12px]">{short$(q.plan)} / {short$(q.goal)}</span></div>)}
          <p className="text-[11px] text-gray-500 mt-2">To hit {money(S.quarterly_goal)} a quarter you need about {money(S.quarterly_goal / 13)} a week going to debt.</p>
        </div>
      </div>
      <div className={card + ' overflow-x-auto'}>
        <p className="font-bold text-[#1A1D2E] px-4 pt-3">Payoff order and dates</p>
        <table className="w-full min-w-[800px] mt-2"><thead><tr><th className={th + ' text-left'}>#</th><th className={th + ' text-left'}>Name</th><th className={th + ' text-right'}>Pay</th><th className={th + ' text-right'}>Paid off</th><th className={th + ' text-right'}>Interest</th><th className={th + ' text-left'}>Why here</th></tr></thead>
          <tbody>{order.map((l: Liability, i: number) => { const p = plan.payoff[l.id]; return (
            <tr key={l.id}><td className={td + ' text-gray-400'}>{i + 1}</td><td className={td}><b>{l.name}</b> <span className="text-[11px] text-gray-400">{kindLabel[l.kind]}</span></td><td className={td + ' text-right'}>{money(target(l))}</td>
              <td className={td + ' text-right'}>{p?.date ? fmtDate(p.date) : 'after 10 yrs'}</td><td className={td + ' text-right'}>{p?.interest ? money(p.interest) : '—'}</td>
              <td className={td + ' text-[12px] text-gray-500'}>{[l.priority != null && `priority #${l.priority}`, l.critical && 'critical supplier', n(l.negotiated_amount) > 0 && `settle for ${money(l.negotiated_amount)} (saves ${money(l.balance - n(l.negotiated_amount))})`, l.apr > 0 && `${l.apr}% interest`, over90(l) > 0 && `${money(over90(l))} over 90 days`].filter(Boolean).join(' · ') || '—'}</td></tr>) })}</tbody></table>
      </div>
    </div>)
}

/* ───────────── Cash flow inputs ───────────── */
function CashInputs({ E, I, erp, fc, save, del, S }: any) {
  const [e, setE] = useState<any>(null)
  const [i, setI] = useState<any>(null)
  const num = (x: any) => Number(String(x ?? '').replace(/[$,\s%]/g, '')) || 0
  const monthly = (E as Expense[]).filter(x => x.active).reduce((t, x) => t + weeklyOf(x.amount, x.frequency) * 52 / 12, 0)
  const od = erp.ar.filter((a: any) => a.due && parse(a.due) < new Date())
  return (
    <div className="space-y-4">
      <div className="grid lg:grid-cols-2 gap-4">
        <div className={card + ' p-4'}>
          <div className="flex items-center mb-2"><p className="font-bold text-[#1A1D2E] mr-auto">Fixed expenses <span className="text-xs font-normal text-gray-400">· {money(monthly)}/month</span></p><button onClick={() => setE({ name: '', category: 'Payroll', amount: '', frequency: 'monthly', active: true })} className="h-8 px-3 rounded-lg text-white text-xs font-bold" style={{ background: G }}>+ Add</button></div>
          {E.length === 0 && <p className="text-sm text-gray-500">Add rent, payroll, utilities, insurance, software, loan payments not listed as liabilities, etc. The forecast uses these.</p>}
          {(E as Expense[]).map(x => <div key={x.id} className={`flex items-center gap-2 py-1.5 border-t border-[#F0F2F6] text-[13px] ${x.active ? '' : 'opacity-50'}`}><button onClick={() => setE({ ...x })} className="flex-1 text-left"><b>{x.name}</b> <span className="text-[11px] text-gray-400">{x.category}{x.day_of_month ? ` · on the ${x.day_of_month}th` : ''}</span></button><span className="font-semibold">{money(x.amount)}</span><span className="text-[11px] text-gray-500 w-16">{x.frequency}</span></div>)}
        </div>
        <div className={card + ' p-4'}>
          <div className="flex items-center mb-2"><p className="font-bold text-[#1A1D2E] mr-auto">Other money coming in</p><button onClick={() => setI({ name: '', category: 'Funding', amount: '', frequency: 'once', probability: 100, active: true })} className="h-8 px-3 rounded-lg text-white text-xs font-bold" style={{ background: G }}>+ Add</button></div>
          <p className="text-[11px] text-gray-500 mb-1">Invoices and orders come from the ERP automatically. Add things it does not know: a loan or grant, an investor, a deposit, a refund.</p>
          {(I as Income[]).map(x => <div key={x.id} className={`flex items-center gap-2 py-1.5 border-t border-[#F0F2F6] text-[13px] ${x.active ? '' : 'opacity-50'}`}><button onClick={() => setI({ ...x })} className="flex-1 text-left"><b>{x.name}</b> <span className="text-[11px] text-gray-400">{x.category} · {x.probability}% likely{x.expected_date ? ' · ' + fmtDate(x.expected_date) : ''}</span></button><span className="font-semibold">{money(x.amount)}</span><span className="text-[11px] text-gray-500 w-16">{x.frequency}</span></div>)}
        </div>
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <Kpi label="Open invoices (ERP)" value={money(erp.ar.reduce((t: number, a: any) => t + a.open, 0))} sub={`${erp.ar.length} invoices · ${od.length} past due (${short$(od.reduce((t: number, a: any) => t + a.open, 0))})`} />
        <Kpi label="Open orders not yet billed" value={money(erp.pipeline.reduce((t: number, a: any) => t + a.value, 0))} sub={`${erp.pipeline.length} sales orders, counted at ship date + terms`} />
        <Kpi label="Walmart orders open" value={money(erp.walmart.reduce((t: number, a: any) => t + a.value, 0))} sub={`${erp.walmart.length} POs, counted at ship date + 30 days`} />
      </div>
      <div className={card + ' overflow-x-auto'}>
        <p className="font-bold text-[#1A1D2E] px-4 pt-3">13-week cash flow</p>
        <p className="text-[11px] text-gray-500 px-4">Invoices and orders are counted at {S.collect_rate}%, {S.collect_lag_days} days after they are due.</p>
        <table className="w-full min-w-[1000px] mt-2"><thead><tr><th className={th + ' text-left'}>Week of</th><th className={th + ' text-right'}>Invoices</th><th className={th + ' text-right'}>Orders</th><th className={th + ' text-right'}>Walmart</th><th className={th + ' text-right'}>Other</th><th className={th + ' text-right'}>Fixed costs</th><th className={th + ' text-right'}>Minimums</th><th className={th + ' text-right'}>Free cash</th><th className={th + ' text-right'}>Payoff</th><th className={th + ' text-right'}>Cash end</th></tr></thead>
          <tbody>{fc.map((w: any, k: number) => <tr key={k}><td className={td}>{w.label}</td><td className={td + ' text-right'}>{short$(w.ar)}</td><td className={td + ' text-right'}>{short$(w.pipeline)}</td><td className={td + ' text-right'}>{short$(w.walmart)}</td><td className={td + ' text-right'}>{short$(w.other)}</td><td className={td + ' text-right text-amber-700'}>{short$(w.expenses)}</td><td className={td + ' text-right text-amber-700'}>{short$(w.minimums)}</td><td className={td + ' text-right font-bold ' + (w.free < 0 ? 'text-red-600' : 'text-emerald-700')}>{short$(w.free)}</td><td className={td + ' text-right text-blue-700'}>{short$(w.payoff)}</td><td className={td + ' text-right font-semibold ' + (w.cash < S.min_reserve ? 'text-red-600' : '')}>{short$(w.cash)}</td></tr>)}</tbody></table>
      </div>
      <div className={card + ' overflow-x-auto'}>
        <p className="font-bold text-[#1A1D2E] px-4 pt-3">Past-due invoices to chase</p>
        <table className="w-full min-w-[600px] mt-2"><thead><tr><th className={th + ' text-left'}>Customer</th><th className={th + ' text-left'}>Invoice</th><th className={th + ' text-right'}>Due</th><th className={th + ' text-right'}>Days late</th><th className={th + ' text-right'}>Open</th></tr></thead>
          <tbody>{[...od].sort((a: any, b: any) => b.open - a.open).slice(0, 40).map((a: any) => <tr key={a.id}><td className={td}>{a.customer || '—'}</td><td className={td}>{a.number}</td><td className={td + ' text-right'}>{fmtDate(a.due)}</td><td className={td + ' text-right text-red-600'}>{Math.round((Date.now() - parse(a.due).getTime()) / 864e5)}</td><td className={td + ' text-right font-semibold'}>{money(a.open, 2)}</td></tr>)}</tbody></table>
      </div>
      {e && <Modal title={e.id ? 'Edit expense' : 'Add a fixed expense'} onClose={() => setE(null)}>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><F label="Name"><input className={inp} value={e.name} onChange={x => setE({ ...e, name: x.target.value })} /></F></div>
          <F label="Category"><select className={inp} value={e.category || ''} onChange={x => setE({ ...e, category: x.target.value })}>{['Payroll', 'Rent', 'Utilities', 'Insurance', 'Raw materials', 'Freight', 'Software', 'Loan / lease payment', 'Taxes', 'Professional fees', 'Other'].map(c => <option key={c}>{c}</option>)}</select></F>
          <F label="Amount"><input className={inp} value={e.amount} onChange={x => setE({ ...e, amount: x.target.value })} /></F>
          <F label="How often"><select className={inp} value={e.frequency} onChange={x => setE({ ...e, frequency: x.target.value })}>{['weekly', 'biweekly', 'monthly', 'quarterly', 'annual'].map(f => <option key={f}>{f}</option>)}</select></F>
          <F label="Day of month (monthly)"><input className={inp} value={e.day_of_month ?? ''} onChange={x => setE({ ...e, day_of_month: x.target.value })} /></F>
          <F label="Active"><select className={inp} value={e.active ? 'yes' : 'no'} onChange={x => setE({ ...e, active: x.target.value === 'yes' })}><option value="yes">Yes</option><option value="no">Paused</option></select></F>
          <div className="col-span-2"><F label="Notes"><input className={inp} value={e.notes || ''} onChange={x => setE({ ...e, notes: x.target.value })} /></F></div>
        </div>
        <div className="flex gap-2 mt-4">{e.id && <button onClick={() => { del('expense', e.id); setE(null) }} className="h-10 px-3 text-red-600 text-sm">Delete</button>}<button onClick={() => setE(null)} className="ml-auto h-10 px-4 rounded-lg border border-[#E4E6EE] text-sm">Cancel</button>
          <button onClick={async () => { if (e.name && await save('expense', { ...e, amount: num(e.amount), day_of_month: e.day_of_month ? num(e.day_of_month) : null })) setE(null) }} className="h-10 px-5 rounded-lg text-white text-sm font-bold" style={{ background: G }}>Save</button></div>
      </Modal>}
      {i && <Modal title={i.id ? 'Edit expected money' : 'Add expected money'} onClose={() => setI(null)}>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><F label="Name"><input className={inp} value={i.name} onChange={x => setI({ ...i, name: x.target.value })} /></F></div>
          <F label="Category"><select className={inp} value={i.category || ''} onChange={x => setI({ ...i, category: x.target.value })}>{['Funding', 'Grant', 'Loan', 'Investor', 'Customer deposit', 'Refund', 'Asset sale', 'Other'].map(c => <option key={c}>{c}</option>)}</select></F>
          <F label="Amount"><input className={inp} value={i.amount} onChange={x => setI({ ...i, amount: x.target.value })} /></F>
          <F label="How often"><select className={inp} value={i.frequency} onChange={x => setI({ ...i, frequency: x.target.value })}>{['once', 'weekly', 'biweekly', 'monthly', 'quarterly'].map(f => <option key={f}>{f}</option>)}</select></F>
          <F label="Expected date (or start)"><input type="date" className={inp} value={i.expected_date || ''} onChange={x => setI({ ...i, expected_date: x.target.value })} /></F>
          <F label="How likely (%)"><input className={inp} value={i.probability} onChange={x => setI({ ...i, probability: x.target.value })} /></F>
          <F label="Active"><select className={inp} value={i.active ? 'yes' : 'no'} onChange={x => setI({ ...i, active: x.target.value === 'yes' })}><option value="yes">Yes</option><option value="no">Paused</option></select></F>
          <div className="col-span-2"><F label="Notes"><input className={inp} value={i.notes || ''} onChange={x => setI({ ...i, notes: x.target.value })} /></F></div>
        </div>
        <div className="flex gap-2 mt-4">{i.id && <button onClick={() => { del('income', i.id); setI(null) }} className="h-10 px-3 text-red-600 text-sm">Delete</button>}<button onClick={() => setI(null)} className="ml-auto h-10 px-4 rounded-lg border border-[#E4E6EE] text-sm">Cancel</button>
          <button onClick={async () => { if (i.name && await save('income', { ...i, amount: num(i.amount), probability: Math.min(100, Math.max(0, num(i.probability))) })) setI(null) }} className="h-10 px-5 rounded-lg text-white text-sm font-bold" style={{ background: G }}>Save</button></div>
      </Modal>}
    </div>)
}

/* ───────────── AI advisor / funding ───────────── */
function Advisor({ kind, runs, snapshot, reload }: { kind: 'plan' | 'funding'; runs: any[]; snapshot: () => any; reload: () => void }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [pick, setPick] = useState(0)
  const r = runs[pick]
  async function run() {
    setErr(''); setBusy(true)
    const res = await api('ai', { kind, question: q.trim() || null, snapshot: kind === 'plan' ? snapshot() : undefined })
    setBusy(false)
    if (!res.ok) { setErr(res.error || 'Could not run'); return }
    setPick(0); setQ(''); reload()
  }
  return (
    <div className="space-y-4">
      <div className={card + ' p-4'}>
        <p className="font-bold text-[#1A1D2E]">{kind === 'plan' ? 'AI cash & payoff advisor' : 'Funding, grants & financing finder'}</p>
        <p className="text-[12px] text-gray-500 mb-3">{kind === 'plan'
          ? 'Reads everything on this board (liabilities, aging, settlements, fixed costs, open invoices and orders, the forecast and the plan) and writes this week\'s payments, a 90-day plan, negotiation moves and ways to speed up cash. Guidance only, not legal or tax advice.'
          : 'Searches the web right now for grants, loans and financing beyondGREEN can apply for (federal, California, local, SBA, CDFIs, PO/inventory financing for Walmart suppliers, sustainability grants) and ranks the best fits with links. Check each program page before applying.'}</p>
        <div className="flex flex-wrap gap-2">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={kind === 'plan' ? 'Optional: ask something specific (e.g. "Can we settle BASF for 60%?")' : 'Optional: focus (e.g. "equipment loans" or "California only")'} className={inp + ' flex-1 min-w-[260px]'} />
          <button onClick={run} disabled={busy} className="h-10 px-5 rounded-lg text-white text-sm font-bold disabled:opacity-50" style={{ background: G }}>{busy ? (kind === 'plan' ? 'Thinking… (up to a minute)' : 'Searching… (1-2 minutes)') : kind === 'plan' ? '✨ Get a plan' : '🔎 Find funding now'}</button>
        </div>
        {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
      </div>
      {runs.length > 0 && <div className="flex flex-wrap gap-1">{runs.map((x, k) => <button key={x.id} onClick={() => setPick(k)} className={`text-[11px] px-2.5 py-1 rounded-full border ${k === pick ? 'bg-[#1A1D2E] text-white border-[#1A1D2E]' : 'border-[#E4E6EE] text-gray-600'}`}>{new Date(x.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {String(x.created_by || '').split('@')[0]}</button>)}</div>}
      {r ? <div className={card + ' p-5'}><Md text={r.content || ''} />
        {Array.isArray(r.sources) && r.sources.length > 0 && <div className="mt-4 pt-3 border-t border-[#F0F2F6]"><p className="text-xs font-semibold text-gray-500 mb-1">Sources</p>{r.sources.map((s: any) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="block text-[12px] text-[#0071ce] underline truncate">{s.title}</a>)}</div>}
      </div> : <div className={card + ' p-8 text-center text-sm text-gray-500'}>Nothing yet. Press the button above.</div>}
    </div>)
}

/* ───────────── Activity ───────────── */
function Activity({ audit, payments, L, reload, setFlash }: any) {
  const name = (id: string) => L.find((l: Liability) => l.id === id)?.name || '—'
  async function voidP(p: any) { const reason = window.prompt('Why void this payment? The balance goes back up.'); if (!reason) return; const r = await api('void-payment', { id: p.id, reason }); setFlash(r.ok ? '↩ Payment voided.' : '⚠ ' + r.error); reload() }
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className={card + ' p-4'}>
        <p className="font-bold text-[#1A1D2E] mb-2">Payments</p>
        {payments.length === 0 && <p className="text-sm text-gray-500">No payments recorded yet.</p>}
        {payments.map((p: any) => <div key={p.id} className={`flex items-center gap-2 py-1.5 border-t border-[#F0F2F6] text-[13px] ${p.voided_at ? 'opacity-50 line-through' : ''}`}><span className="w-24 text-gray-500">{fmtDate(p.paid_on)}</span><span className="flex-1">{name(p.liability_id)} <span className="text-[11px] text-gray-400">{p.method} {p.note}</span></span><b>{money(p.amount, 2)}</b>{!p.voided_at && <button onClick={() => voidP(p)} className="text-[11px] text-gray-400 hover:text-red-600">void</button>}</div>)}
      </div>
      <div className={card + ' p-4'}>
        <p className="font-bold text-[#1A1D2E] mb-2">Who did what (sign-ins, edits, AI runs)</p>
        {audit.map((a: any) => <div key={a.id} className="py-1 border-t border-[#F0F2F6] text-[12px]"><span className="text-gray-400">{new Date(a.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span> · <b>{String(a.email || '').split('@')[0]}</b> · {String(a.action).replace(/_/g, ' ')}{a.detail?.name ? ` · ${a.detail.name}` : a.detail?.liability ? ` · ${a.detail.liability} ${money(a.detail.amount, 2)}` : ''}</div>)}
      </div>
    </div>)
}
