'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { TONES } from '@/lib/portalStages'

const GREEN = '#037f4c'
const GREEN2 = '#05a866'
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
const timeAgo = (iso: string | null) => {
  if (!iso) return ''
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 3600) return 'just now'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  const d = Math.floor(s / 86400)
  if (d < 30) return d + (d === 1 ? ' day ago' : ' days ago')
  return fmtDate(iso)
}

function Badge({ stage, big }: { stage: { label: string; tone: string }; big?: boolean }) {
  const t = TONES[(stage?.tone as keyof typeof TONES)] || TONES.gray
  return <span className={`font-bold rounded-full inline-block whitespace-nowrap ${big ? 'text-xs px-3 py-1.5' : 'text-[11px] px-2.5 py-1'}`} style={{ background: t.bg, color: t.text }}>{stage?.label || '—'}</span>
}

// Horizontal progress tracker (like a shipment / bank status tracker)
function Tracker({ items }: { items: any[] }) {
  if (!items || items.length === 0) return null
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <div className="flex items-start min-w-max py-1">
        {items.map((it, i) => {
          const t = TONES[(it.tone as keyof typeof TONES)] || TONES.gray
          const isCurrent = i === items.length - 1
          return (
            <div key={i} className="flex items-start">
              <div className="flex flex-col items-center" style={{ width: 118 }}>
                <div className="flex items-center w-full">
                  <span className="h-[3px] flex-1 rounded-full" style={{ background: i === 0 ? 'transparent' : GREEN }} />
                  <span className="rounded-full grid place-items-center shrink-0" style={{ width: isCurrent ? 26 : 18, height: isCurrent ? 26 : 18, background: isCurrent ? t.text : GREEN, boxShadow: isCurrent ? `0 0 0 5px ${t.bg}` : 'none' }}>
                    {isCurrent ? <span className="w-2 h-2 rounded-full bg-white" /> : <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L4 10.9a1 1 0 111.4-1.4l2.6 2.6 6.8-6.8a1 1 0 011.4 0z" clipRule="evenodd" /></svg>}
                  </span>
                  <span className="h-[3px] flex-1 rounded-full" style={{ background: isCurrent ? 'transparent' : GREEN }} />
                </div>
                <p className={`text-center mt-2 leading-tight ${isCurrent ? 'font-bold text-[#1A1D2E]' : 'font-medium text-gray-500'}`} style={{ fontSize: 12 }}>{it.label}</p>
                <p className="text-center text-[10px] text-gray-400 mt-0.5">{fmtDate(it.date)}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function ClientPortalPage() {
  const [phase, setPhase] = useState<'loading' | 'login' | 'app'>('loading')
  const [data, setData] = useState<any | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [msgState, setMsgState] = useState<'idle' | 'sending' | 'sent'>('idle')

  const loadMe = useCallback(async () => {
    const r = await fetch('/api/portal/me', { cache: 'no-store' })
    if (r.ok) { setData(await r.json()); setPhase('app') } else { setPhase('login') }
  }, [])
  useEffect(() => { loadMe() }, [loadMe])
  // Auto-refresh: pick up Sales Order / RFQ saves without a manual reload.
  useEffect(() => {
    const refresh = async () => {
      try { const r = await fetch('/api/portal/me', { cache: 'no-store' }); if (r.ok) setData(await r.json()) } catch { /* ignore transient */ }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)
    const id = setInterval(refresh, 30000)
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', onVisible); clearInterval(id) }
  }, [])

  async function login(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      const r = await fetch('/api/portal/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(j.error || 'Login failed.'); return }
      setPassword(''); await loadMe()
    } finally { setBusy(false) }
  }
  async function logout() { await fetch('/api/portal/logout', { method: 'POST' }).catch(() => {}); setData(null); setEmail(''); setPassword(''); setPhase('login') }
  async function sendMessage(e: React.FormEvent) {
    e.preventDefault(); if (!msg.trim()) return
    setMsgState('sending')
    const r = await fetch('/api/portal/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg }) })
    if (r.ok) { setMsg(''); setMsgState('sent'); setTimeout(() => setMsgState('idle'), 4000) } else { setMsgState('idle'); alert('Could not send. Please try again.') }
  }

  const projects = data?.projects || []
  const broker = data?.broker || null
  const money = (n: number) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const cstatusPill = (s: string, label: string) => (
    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap" style={s === 'paid_by_bg' ? { background: '#DCFCE7', color: '#037f4c' } : { background: '#FEF3C7', color: '#B45309' }}>{label}</span>
  )

  const ordersTable = (rows: any[], emptyMsg: string) => (
    <table className="w-full text-sm min-w-[880px]">
      <thead>
        <tr className="text-[11px] uppercase text-gray-400 border-b border-[#EEF0F4]">
          <th className="text-left px-4 py-2 font-semibold">Project</th>
          <th className="text-left px-3 py-2 font-semibold">PO</th>
          <th className="text-right px-3 py-2 font-semibold">Cost</th>
          <th className="text-right px-3 py-2 font-semibold">Selling</th>
          <th className="text-right px-3 py-2 font-semibold">Profit / Loss</th>
          <th className="text-left px-3 py-2 font-semibold">Commission</th>
          <th className="text-left px-3 py-2 font-semibold">Commission Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400 text-sm">{emptyMsg}</td></tr>
        ) : rows.map((d: any, i: number) => {
          const pl = d.cost != null ? d.selling - d.cost : null
          return (
          <tr key={d.id} className={i % 2 ? 'bg-[#F8FAFC]' : 'bg-white'}>
            <td className="px-4 py-2.5 font-semibold text-[#1A1D2E]">{d.name}{d.status ? <span className="ml-2 text-[10px] font-normal text-gray-400">{d.status}</span> : null}</td>
            <td className="px-3 py-2.5">{d.po_url ? <a href={d.po_url} target="_blank" rel="noopener noreferrer" className="text-[#3B6FE0] font-semibold hover:underline">📄 {d.po_number || 'View PO'}</a> : (d.po_number || <span className="text-gray-300">—</span>)}</td>
            <td className="px-3 py-2.5 text-right text-gray-600">{d.cost != null ? money(d.cost) : '—'}</td>
            <td className="px-3 py-2.5 text-right text-gray-600">{money(d.selling)}</td>
            <td className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">{pl == null ? <span className="text-gray-300">—</span> : <span style={{ color: pl < 0 ? '#DC2626' : GREEN }}>{pl < 0 ? `-${money(Math.abs(pl))}` : money(pl)} <span className="text-[11px] font-normal text-gray-400">{pl < 0 ? 'loss' : 'profit'}</span></span>}</td>
            <td className="px-3 py-2.5"><span className="font-bold" style={{ color: GREEN }}>{money(d.commission)}</span> <span className="text-[11px] text-gray-400">({d.basis === 'none' ? 'no commission' : d.basis === 'profit_50' ? '50% profit' : '7% PO'})</span></td>
            <td className="px-3 py-2.5">{cstatusPill(d.commission_status, d.commission_status_label)}</td>
          </tr>
          )
        })}
      </tbody>
    </table>
  )

  const groupCard = (title: string, color: string, count: number, children: any) => (
    <details className="rb bg-white rounded-xl overflow-hidden shadow-sm border border-[#ECEEF3]" open>
      <summary className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none" style={{ background: `${color}14`, borderLeft: `5px solid ${color}` }}>
        <span className="chev text-[10px]" style={{ color, display: 'inline-block' }}>&#9654;</span>
        <span className="font-bold text-sm" style={{ color }}>{title}</span>
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${color}26`, color }}>{count}</span>
      </summary>
      <div className="overflow-x-auto">{children}</div>
    </details>
  )
  const company = data?.client?.company || data?.client?.name || 'Your account'
  const stats = useMemo(() => {
    let inProgress = 0, done = 0
    for (const p of projects) { const l = (p.current?.label || '').toLowerCase(); if (l.includes('deliver') || l.includes('complete') || l.includes('accepted')) done++; else inProgress++ }
    return { total: projects.length, inProgress, done }
  }, [projects])
  const lastUpdate = useMemo(() => {
    let latest: string | null = null
    for (const p of projects) { const t = p.timeline?.[p.timeline.length - 1]?.date; if (t && (!latest || t > latest)) latest = t }
    return latest
  }, [projects])

  if (phase === 'loading') return <div className="min-h-screen grid place-items-center text-gray-400" style={{ background: '#F4F6F9' }}>Loading…</div>

  if (phase === 'login') {
    return (
      <div className="min-h-screen grid place-items-center p-4" style={{ background: `linear-gradient(160deg, ${GREEN} 0%, #024a2d 100%)` }}>
        <div className="w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="w-16 h-16 rounded-2xl mx-auto grid place-items-center bg-white/15 backdrop-blur text-white font-black text-xl">bG</div>
            <h1 className="text-xl font-bold text-white mt-3">beyondGREEN Client Portal</h1>
            <p className="text-sm text-white/70 mt-1">Sign in to track your projects.</p>
          </div>
          <form onSubmit={login} className="bg-white rounded-2xl p-6 space-y-4 shadow-2xl">
            {err && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{err}</div>}
            <label className="block"><span className="text-xs font-semibold text-gray-600">Email</span>
              <input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required className="w-full mt-1 bg-white border border-[#E4E6EE] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#037f4c]/40" /></label>
            <label className="block"><span className="text-xs font-semibold text-gray-600">Password</span>
              <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required className="w-full mt-1 bg-white border border-[#E4E6EE] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#037f4c]/40" /></label>
            <button type="submit" disabled={busy} className="w-full text-white font-semibold py-2.5 rounded-lg disabled:opacity-50 shadow-sm" style={{ background: GREEN }}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
          <p className="text-center text-xs text-white/60 mt-4">Trouble signing in? Email info@byndgrn.com</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen pb-10" style={{ background: '#F4F6F9' }}>
      {/* Header */}
      <div style={{ background: `linear-gradient(120deg, ${GREEN} 0%, ${GREEN2} 100%)` }}>
        <div className="mx-auto max-w-4xl px-5 pt-5 pb-16">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl grid place-items-center bg-white/20 text-white font-black text-sm">bG</div>
              <span className="text-white font-semibold tracking-tight">beyondGREEN</span>
            </div>
            <button onClick={logout} className="text-xs font-semibold text-white bg-white/15 hover:bg-white/25 rounded-lg px-3 py-1.5">Sign out</button>
          </div>
          <p className="text-white/70 text-xs uppercase tracking-wider mt-6">Client Portal</p>
          <h1 className="text-white text-2xl sm:text-3xl font-bold leading-tight">{company}</h1>
          {lastUpdate && <p className="text-white/70 text-sm mt-1">Last update {timeAgo(lastUpdate)}</p>}
        </div>
      </div>

      {/* Summary cards (overlap header) */}
      <div className="mx-auto max-w-4xl px-4 -mt-10">
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Total Projects', value: stats.total, color: '#1A1D2E' },
            { label: 'In Progress', value: stats.inProgress, color: GREEN },
            { label: 'Completed', value: stats.done, color: '#1D4ED8' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-2xl border border-[#EAECF2] shadow-sm px-4 py-3.5">
              <p className="text-2xl sm:text-3xl font-bold" style={{ color: s.color }}>{s.value}</p>
              <p className="text-[11px] sm:text-xs text-gray-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Projects */}
      <div className="mx-auto max-w-4xl px-4 mt-6 space-y-6">
        {broker && (
          <>
            <style>{`summary{list-style:none}summary::-webkit-details-marker{display:none}details.rb .chev{transition:transform .15s}details.rb[open]>summary .chev{transform:rotate(90deg)}`}</style>

            {/* Open A/R hero */}
            <div className="rounded-2xl p-5 text-white shadow-sm" style={{ background: `linear-gradient(120deg, ${GREEN}, ${GREEN2})` }}>
              <p className="text-white/80 text-xs uppercase tracking-wider font-semibold">Your open commission (accounts receivable)</p>
              <p className="text-4xl font-extrabold mt-1">{money(broker.ar)}</p>
              <p className="text-white/80 text-sm mt-1">{(() => {
                const n = [...broker.openOrders, ...broker.completedOrders].filter((o: any) => o.commission_status !== 'paid_by_bg').length
                return `Across ${n} project${n === 1 ? '' : 's'} still awaiting customer payment — keep the projects coming to grow this.`
              })()}</p>
            </div>

            {/* Revenue & profit snapshot */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-white rounded-2xl border border-[#EAECF2] shadow-sm p-4">
                <p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Revenue · Active projects</p>
                <p className="text-2xl font-extrabold text-[#1A1D2E] mt-1">{money(broker.revenueActive)}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">{broker.openOrders.length} open order{broker.openOrders.length === 1 ? '' : 's'}</p>
              </div>
              <div className="bg-white rounded-2xl border border-[#EAECF2] shadow-sm p-4">
                <p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Revenue · Completed</p>
                <p className="text-2xl font-extrabold text-[#1A1D2E] mt-1">{money(broker.revenueCompleted)}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">{broker.completedOrders.length} completed project{broker.completedOrders.length === 1 ? '' : 's'}</p>
              </div>
              <div className="rounded-2xl shadow-sm p-4 text-white" style={{ background: `linear-gradient(120deg, ${GREEN}, ${GREEN2})` }}>
                <p className="text-[11px] uppercase tracking-wider text-white/80 font-semibold">Total profit generated</p>
                <p className="text-2xl font-extrabold mt-1">{money(broker.totalProfit)}</p>
                <p className="text-[11px] text-white/80 mt-0.5">on {money(broker.totalRevenue)} total revenue</p>
              </div>
            </div>

            {/* Open RFQs */}
            {groupCard('Open RFQs', '#F59E0B', broker.openRfqs.length, (
              broker.openRfqs.length === 0
                ? <p className="px-4 py-6 text-center text-gray-400 text-sm">No open RFQs right now.</p>
                : <div className="divide-y divide-[#F1F3F9]">
                    {broker.openRfqs.map((r: any) => (
                      <details key={r.id}>
                        <summary className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer hover:bg-[#FFFBF3]">
                          <div className="min-w-0">
                            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">RFQ · {r.number}</p>
                            <p className="font-semibold text-[#1A1D2E] truncate">{r.name}</p>
                          </div>
                          <span className="text-xs text-gray-400 shrink-0">{r.date ? timeAgo(r.date) : ''}</span>
                        </summary>
                        <div className="px-4 pb-4">
                          {r.lines.length === 0 ? <p className="text-sm text-gray-400 py-1">No line items on this RFQ.</p> : (
                            <table className="w-full text-sm">
                              <thead><tr className="text-[11px] uppercase text-gray-400"><th className="text-left py-1.5">Item</th><th className="text-left py-1.5">SKU</th><th className="text-right py-1.5">Qty</th></tr></thead>
                              <tbody>
                                {r.lines.map((l: any, i: number) => (
                                  <tr key={i} className="border-t border-[#F4F5F8]"><td className="py-1.5 text-gray-700">{l.description || '—'}</td><td className="py-1.5 text-gray-500 font-mono text-xs">{l.sku || '—'}</td><td className="py-1.5 text-right text-gray-600">{l.quantity ?? '—'} {l.unit || ''}</td></tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </details>
                    ))}
                  </div>
            ))}

            {/* Open Orders */}
            {groupCard('Open Orders', '#3B6FE0', broker.openOrders.length, ordersTable(broker.openOrders, 'No open orders right now.'))}

            {/* Closed & Completed Orders */}
            {groupCard('Closed & Completed Orders', GREEN, broker.completedOrders.length, ordersTable(broker.completedOrders, 'No completed orders yet.'))}
          </>
        )}
        {broker && (
          <div className="flex justify-end px-1">
            <button onClick={loadMe} className="text-xs font-semibold" style={{ color: GREEN }}>↻ Refresh</button>
          </div>
        )}
        {!broker && (
        <section>
          <div className="flex items-center justify-between mb-3 px-1">
            <h2 className="font-bold text-[#1A1D2E] text-lg">Your Projects</h2>
            <button onClick={loadMe} className="text-xs font-semibold" style={{ color: GREEN }}>↻ Refresh</button>
          </div>
          <div className="space-y-4">
            {projects.length === 0 ? (
              <div className="bg-white rounded-2xl border border-[#EAECF2] shadow-sm p-8 text-center text-sm text-gray-400">No projects to show yet. We&apos;ll add them here as they get going.</div>
            ) : projects.map((p: any) => (
              <div key={p.id} className="bg-white rounded-2xl border border-[#EAECF2] shadow-sm overflow-hidden">
                <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">{p.kind}</p>
                    <p className="font-bold text-[#1A1D2E] text-lg leading-snug">{p.name}</p>
                  </div>
                  <Badge stage={p.current} big />
                </div>
                <div className="px-5 pb-4 pt-2 border-t border-[#F1F3F9]">
                  <Tracker items={p.timeline} />
                </div>
              </div>
            ))}
          </div>
        </section>
        )}

        {/* Message */}
        <section>
          <h2 className="font-bold text-[#1A1D2E] text-lg mb-3 px-1">Message us</h2>
          <form onSubmit={sendMessage} className="bg-white rounded-2xl border border-[#EAECF2] shadow-sm p-4">
            {msgState === 'sent' && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-lg px-3 py-2 mb-3">Message sent — our team will get back to you.</div>}
            <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={3} placeholder="Ask a question or send us an update…" className="w-full bg-white border border-[#E4E6EE] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#037f4c]/40 resize-none" />
            <div className="flex justify-end mt-2">
              <button type="submit" disabled={msgState === 'sending' || !msg.trim()} className="text-white font-semibold rounded-lg px-5 py-2 text-sm disabled:opacity-50 shadow-sm" style={{ background: GREEN }}>{msgState === 'sending' ? 'Sending…' : 'Send message'}</button>
            </div>
          </form>
        </section>

        <p className="text-center text-[11px] text-gray-400 pt-2">beyondGREEN Biotech · For anything else, message us above or email info@byndgrn.com.</p>
      </div>
    </div>
  )
}
