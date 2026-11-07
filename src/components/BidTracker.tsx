'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

/**
 * Bid Tracker: one row per item on a large customer bid (first one: the PIC bagel brands bid).
 * Each item is Made in Santa Ana, costed from quotes we already have, or out for RFQ.
 * Profit = (Delivered cost - COGS) x annual units, split with the partner at the bid's split %.
 * The Command Center logs supplier replies and quotes into the same tables, so this tab stays current.
 */

const ITEM_STATUSES = ['Open', 'Costing', 'RFQ Sent', 'Quoted', 'Costed', 'Bid Ready', 'No Bid'] as const
const RFQ_STATUSES = ['Draft', 'Sent', 'Replied', 'Quoted', 'Declined', 'No Reply'] as const
const STATUS_COLOR: Record<string, string> = {
  Open: 'bg-gray-100 text-gray-600', Costing: 'bg-amber-50 text-amber-700', 'RFQ Sent': 'bg-blue-50 text-blue-700',
  Quoted: 'bg-violet-50 text-violet-700', Costed: 'bg-emerald-50 text-emerald-700', 'Bid Ready': 'bg-emerald-600 text-white', 'No Bid': 'bg-red-50 text-red-600',
  Draft: 'bg-gray-100 text-gray-600', Sent: 'bg-blue-50 text-blue-700', Replied: 'bg-amber-50 text-amber-700', Declined: 'bg-red-50 text-red-600', 'No Reply': 'bg-orange-50 text-orange-700',
}
const PATH_COLOR = (p: string) => /^make/i.test(p) ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : /^have/i.test(p) ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-amber-50 text-amber-700 border-amber-200'

const n = (v: any) => { const x = typeof v === 'number' ? v : parseFloat(String(v ?? '')); return Number.isFinite(x) ? x : null }
const usd = (v: number | null, d = 2) => v == null ? '—' : v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: d, maximumFractionDigits: d })
const big = (v: number | null) => v == null ? '—' : v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? '$' + (v / 1e3).toFixed(1) + 'K' : usd(v, 0)
const units = (v: any) => { const x = n(v); return x == null ? '—' : x >= 1e6 ? (x / 1e6).toFixed(1) + 'M' : x >= 1e3 ? (x / 1e3).toFixed(0) + 'K' : x.toFixed(0) }
const ago = (s?: string | null) => { if (!s) return ''; const m = (Date.now() - new Date(s).getTime()) / 6e4; return m < 60 ? Math.max(1, Math.round(m)) + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }

export default function BidTracker() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [me, setMe] = useState('')
  const [bids, setBids] = useState<any[]>([])
  const [bidId, setBidId] = useState('')
  const [items, setItems] = useState<any[]>([])
  const [rfqs, setRfqs] = useState<any[]>([])
  const [quotes, setQuotes] = useState<any[]>([])
  const [acts, setActs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [fPath, setFPath] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [open, setOpen] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [view, setView] = useState<'items' | 'rfqs' | 'activity'>('items')
  const [qf, setQf] = useState<any>({})
  const [saving, setSaving] = useState('')

  useEffect(() => { sb.auth.getUser().then(({ data }) => setMe(data.user?.email || '')) }, [sb])

  const loadBids = useCallback(async () => {
    const { data, error } = await sb.from('bid_projects').select('*, customers(company_name)').order('created_at', { ascending: false })
    if (error) { setErr('The Bid Tracker tables are not set up yet.'); setLoading(false); return }
    setBids(data || [])
    setBidId(cur => cur || (data?.[0]?.id ?? ''))
    if (!data?.length) setLoading(false)
  }, [sb])

  const loadBid = useCallback(async (id: string) => {
    if (!id) return
    setLoading(true)
    const [it, rf, ac] = await Promise.all([
      sb.from('bid_items').select('*').eq('bid_id', id).order('line_no'),
      sb.from('bid_rfqs').select('*').eq('bid_id', id).order('supplier_name'),
      sb.from('bid_activity').select('*').eq('bid_id', id).order('at', { ascending: false }).limit(200),
    ])
    const ids = (it.data || []).map((x: any) => x.id)
    const qu = ids.length ? await sb.from('bid_quotes').select('*').in('bid_item_id', ids).order('created_at', { ascending: false }) : { data: [] as any[] }
    setItems(it.data || []); setRfqs(rf.data || []); setActs(ac.data || []); setQuotes(qu.data || [])
    setLoading(false)
  }, [sb])

  useEffect(() => { loadBids() }, [loadBids])
  useEffect(() => { if (bidId) loadBid(bidId) }, [bidId, loadBid])
  // Supplier replies and quotes come in from the Command Center; refresh every minute while open.
  useEffect(() => { if (!bidId) return; const t = setInterval(() => loadBid(bidId), 60000); return () => clearInterval(t) }, [bidId, loadBid])

  const bid = bids.find(b => b.id === bidId)
  const split = (n(bid?.profit_split_pct) ?? 50) / 100

  const log = async (message: string, extra: any = {}) => {
    const row = { bid_id: bidId, kind: extra.kind || 'item', message, actor: me || 'ERP', item_id: extra.item_id || null, rfq_id: extra.rfq_id || null }
    const { data } = await sb.from('bid_activity').insert(row).select().single()
    if (data) setActs(a => [data, ...a])
  }

  const saveItem = async (it: any, patch: any, label: string) => {
    setSaving(it.id)
    const { error } = await sb.from('bid_items').update({ ...patch, updated_at: new Date().toISOString(), updated_by: me }).eq('id', it.id)
    setSaving('')
    if (error) { alert('Could not save: ' + error.message); return }
    setItems(xs => xs.map(x => x.id === it.id ? { ...x, ...patch } : x))
    await log(`${it.item_name}: ${label}`, { item_id: it.id })
  }

  const saveRfq = async (r: any, patch: any) => {
    const { error } = await sb.from('bid_rfqs').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', r.id)
    if (error) { alert('Could not save: ' + error.message); return }
    setRfqs(xs => xs.map(x => x.id === r.id ? { ...x, ...patch } : x))
    await log(`${r.supplier_name} RFQ set to ${patch.status ?? 'updated'}`, { kind: 'rfq', rfq_id: r.id })
  }

  const addQuote = async (it: any) => {
    const f = qf[it.id] || {}
    if (!String(f.supplier_name || '').trim()) { alert('Add the supplier name.'); return }
    const row = { bid_item_id: it.id, supplier_name: f.supplier_name.trim(), unit_price: n(f.unit_price), incoterm: f.incoterm || null, landed_unit: n(f.landed_unit), moq: f.moq || null, lead_time: f.lead_time || null, notes: f.notes || null, source: 'ERP', created_by: me }
    const { data, error } = await sb.from('bid_quotes').insert(row).select().single()
    if (error) { alert('Could not save the quote: ' + error.message); return }
    setQuotes(qs => [data, ...qs]); setQf((s: any) => ({ ...s, [it.id]: {} }))
    if (['Open', 'Costing', 'RFQ Sent'].includes(it.status)) await saveItem(it, { status: 'Quoted' }, 'status Quoted')
    await log(`${row.supplier_name} quoted ${it.item_name}${row.unit_price != null ? ' at $' + row.unit_price + ' ' + (row.incoterm || '') : ''}`, { kind: 'quote', item_id: it.id })
  }

  const pickQuote = async (it: any, qu: any) => {
    const c = n(qu.landed_unit) ?? n(qu.unit_price)
    if (c == null) return
    await sb.from('bid_quotes').update({ is_selected: false }).eq('bid_item_id', it.id)
    await sb.from('bid_quotes').update({ is_selected: true }).eq('id', qu.id)
    setQuotes(qs => qs.map(x => x.bid_item_id === it.id ? { ...x, is_selected: x.id === qu.id } : x))
    await saveItem(it, { cogs_unit: c, cogs_basis: `${qu.supplier_name} quote${qu.incoterm ? ' ' + qu.incoterm : ''}${n(qu.landed_unit) != null ? ' (landed)' : ''}${qu.quote_date ? ', ' + qu.quote_date : ''}`, status: 'Costed' }, `COGS set from ${qu.supplier_name} quote`)
  }

  const shown = items.filter(it => {
    if (fPath && !String(it.sourcing_path || '').toLowerCase().startsWith(fPath)) return false
    if (fStatus && it.status !== fStatus) return false
    if (q && !(`${it.item_name} ${it.category} ${it.target_suppliers}`.toLowerCase().includes(q.toLowerCase()))) return false
    return true
  })
  const groups = useMemo(() => {
    const m = new Map<string, any[]>()
    shown.forEach(it => { const k = it.category || 'Other'; if (!m.has(k)) m.set(k, []); m.get(k)!.push(it) })
    return [...m.entries()].sort((a, b) => b[1].reduce((s, x) => s + (n(x.annual_units) || 0), 0) - a[1].reduce((s, x) => s + (n(x.annual_units) || 0), 0))
  }, [shown])

  const profitOf = (it: any) => { const c = n(it.cogs_unit), d = n(it.delivered_unit), u = n(it.annual_units); return c != null && d != null && u != null ? (d - c) * u : null }
  const tot = useMemo(() => {
    let rev = 0, cogs = 0, prof = 0, costed = 0, priced = 0
    items.forEach(it => { const c = n(it.cogs_unit), d = n(it.delivered_unit), u = n(it.annual_units) || 0; if (c != null) { costed++; cogs += c * u } if (d != null) { priced++; rev += d * u } const p = profitOf(it); if (p != null) prof += p })
    return { rev, cogs, prof, costed, priced, rfqItems: items.filter(i => /rfq/i.test(i.sourcing_path || '') && n(i.cogs_unit) == null).length }
  }, [items])
  const rfqStat = (s: string) => rfqs.filter(r => r.status === s).length

  const exportCsv = () => {
    const h = ['Line', 'Item', 'Case pack', 'Annual cases', 'Annual units', 'Branded', 'Category', 'Path', 'COGS / unit', 'COGS basis', 'Delivered / unit', 'Profit total', 'bG profit', 'Partner profit', 'Status', 'Suppliers', 'Notes']
    const rows = items.map(it => { const p = profitOf(it); return [it.line_no, it.item_name, it.case_pack, it.annual_cases, it.annual_units, it.branded, it.category, it.sourcing_path, it.cogs_unit, it.cogs_basis, it.delivered_unit, p, p == null ? '' : p * split, p == null ? '' : p * (1 - split), it.status, it.target_suppliers, it.notes] })
    const csv = [h, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `${(bid?.name || 'bid').replace(/[^\w]+/g, '_')}_tracker.csv`; a.click()
  }

  if (err) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">{err}</div>
  if (!loading && !bids.length) return <div className="rounded-xl border border-[#E4E6EE] bg-white p-8 text-center text-sm text-gray-500">No bids yet.</div>

  const Cell = ({ it, k, label }: { it: any; k: 'cogs_unit' | 'delivered_unit'; label: string }) => (
    <input
      key={it.id + k + String(it[k] ?? '')}
      defaultValue={it[k] ?? ''}
      inputMode="decimal"
      placeholder="—"
      aria-label={label}
      onBlur={e => { const v = e.target.value.trim(); const nv = v === '' ? null : n(v); if (nv === n(it[k])) return; saveItem(it, { [k]: nv, ...(k === 'cogs_unit' && nv != null && it.status === 'Open' ? { status: 'Costed' } : {}) }, `${label} ${nv == null ? 'cleared' : '$' + nv}`) }}
      className="w-20 text-right border border-[#E4E6EE] rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
    />
  )

  return (
    <div className="space-y-4">
      {/* Bid picker + summary */}
      <div className="bg-white rounded-xl border border-[#ECEEF3] shadow-sm p-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <div className="min-w-0">
            <select value={bidId} onChange={e => setBidId(e.target.value)} className="text-base font-bold text-[#1A1D2E] bg-transparent border-0 p-0 focus:ring-0 max-w-full">
              {bids.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <p className="text-xs text-gray-500 mt-0.5">{bid?.customers?.company_name || 'No customer linked'} · {bid?.status} · profit split {Math.round(split * 100)}/{Math.round((1 - split) * 100)} · updates every minute</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => loadBid(bidId)} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#E4E6EE] hover:bg-gray-50">Refresh</button>
            <button onClick={exportCsv} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">Export CSV</button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mt-4">
          {[
            ['Items', String(items.length), `${items.filter(i => /^make/i.test(i.sourcing_path || '')).length} made in Santa Ana`],
            ['Costed', `${tot.costed} / ${items.length}`, `${tot.rfqItems} still need a supplier quote`],
            ['RFQs out', String(rfqs.length), `${rfqStat('Sent')} sent · ${rfqStat('Draft')} drafts`],
            ['Supplier replies', String(rfqStat('Replied') + rfqStat('Quoted')), `${rfqStat('Quoted')} with prices`],
            ['Annual COGS (costed)', big(tot.cogs), 'landed to Santa Ana'],
            ['bG profit (priced)', big(tot.priced ? tot.prof * split : null), `${tot.priced} items priced · revenue ${big(tot.priced ? tot.rev : null)}`],
          ].map(([k, v, s]) => (
            <div key={k} className="rounded-lg border border-[#ECEEF3] p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{k}</div>
              <div className="text-lg font-bold text-[#1A1D2E] mt-0.5">{v}</div>
              <div className="text-[11px] text-gray-500 leading-tight">{s}</div>
            </div>
          ))}
        </div>
      </div>

      {/* View switch + filters */}
      <div className="flex flex-col md:flex-row md:items-center gap-2 justify-between">
        <div className="flex gap-1 bg-white border border-[#E4E6EE] rounded-lg p-1 w-fit">
          {(['items', 'rfqs', 'activity'] as const).map(v => (
            <button key={v} onClick={() => setView(v)} className={`text-xs font-semibold px-3 py-1.5 rounded-md ${view === v ? 'bg-[#1A1D2E] text-white' : 'text-gray-500 hover:text-gray-800'}`}>
              {v === 'items' ? `Items (${items.length})` : v === 'rfqs' ? `Supplier RFQs (${rfqs.length})` : 'Activity'}
            </button>
          ))}
        </div>
        {view === 'items' && (
          <div className="flex flex-wrap gap-2">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search items or suppliers…" className="bg-white border border-[#E4E6EE] rounded-lg px-3 py-1.5 text-sm w-full sm:w-56" />
            <select value={fPath} onChange={e => setFPath(e.target.value)} className="bg-white border border-[#E4E6EE] rounded-lg px-2 py-1.5 text-sm">
              <option value="">All paths</option><option value="make">Make in Santa Ana</option><option value="have">Have cost</option><option value="rfq">Needs RFQ</option>
            </select>
            <select value={fStatus} onChange={e => setFStatus(e.target.value)} className="bg-white border border-[#E4E6EE] rounded-lg px-2 py-1.5 text-sm">
              <option value="">All statuses</option>{ITEM_STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        )}
      </div>

      {loading ? (
        <div className="rounded-xl border border-[#E4E6EE] bg-white flex items-center justify-center py-16"><div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-600 rounded-full animate-spin" /></div>
      ) : view === 'items' ? (
        <div className="space-y-3">
          {groups.map(([cat, rows]) => {
            const gp = rows.reduce((s, it) => s + (profitOf(it) || 0), 0)
            const gc = rows.filter(it => n(it.cogs_unit) != null).length
            return (
              <div key={cat} className="bg-white rounded-xl border border-[#ECEEF3] shadow-sm overflow-hidden">
                <button onClick={() => setCollapsed(c => ({ ...c, [cat]: !c[cat] }))} className="w-full flex items-center gap-2 px-4 py-2.5 text-left border-l-4 border-emerald-500">
                  <span className="text-gray-400 text-xs">{collapsed[cat] ? '▸' : '▾'}</span>
                  <span className="font-semibold text-sm text-[#1A1D2E]">{cat}</span>
                  <span className="text-[11px] text-gray-500">{rows.length} items · {gc} costed · {units(rows.reduce((s, it) => s + (n(it.annual_units) || 0), 0))} units/yr</span>
                  {gp ? <span className="ml-auto text-[11px] font-semibold text-emerald-700">bG {big(gp * split)}</span> : null}
                </button>
                {!collapsed[cat] && (
                  <>
                    {/* Desktop table */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-[#F7F8FB] text-gray-500 uppercase text-[10px] tracking-wide">
                          <tr><th className="text-left px-3 py-2">#</th><th className="text-left px-2 py-2">Item</th><th className="text-right px-2 py-2">Units / yr</th><th className="text-left px-2 py-2">Path</th><th className="text-right px-2 py-2">COGS / unit</th><th className="text-right px-2 py-2">Delivered / unit</th><th className="text-right px-2 py-2">bG profit / yr</th><th className="text-left px-2 py-2">Status</th><th className="text-left px-2 py-2">Suppliers</th></tr>
                        </thead>
                        <tbody>
                          {rows.map(it => {
                            const p = profitOf(it); const iq = quotes.filter(x => x.bid_item_id === it.id)
                            return [
                              <tr key={it.id} className={`border-t border-[#F0F2F7] hover:bg-[#FAFBFD] ${saving === it.id ? 'opacity-60' : ''}`}>
                                <td className="px-3 py-2 text-gray-400">{it.line_no}</td>
                                <td className="px-2 py-2 max-w-[280px]">
                                  <button onClick={() => setOpen(o => o === it.id ? '' : it.id)} className="text-left font-medium text-[#1A1D2E] hover:text-emerald-700">{it.item_name}</button>
                                  <div className="text-[10px] text-gray-400">{it.case_pack ? `${it.case_pack}/cs` : ''}{it.branded && it.branded !== 'None' ? ' · ' + it.branded : ''}{iq.length ? ` · ${iq.length} quote${iq.length > 1 ? 's' : ''}` : ''}</div>
                                </td>
                                <td className="px-2 py-2 text-right tabular-nums">{units(it.annual_units)}</td>
                                <td className="px-2 py-2"><span className={`inline-block border rounded-full px-2 py-0.5 text-[10px] font-semibold ${PATH_COLOR(it.sourcing_path || '')}`}>{it.sourcing_path || 'RFQ'}</span></td>
                                <td className="px-2 py-2 text-right"><Cell it={it} k="cogs_unit" label="COGS" /></td>
                                <td className="px-2 py-2 text-right"><Cell it={it} k="delivered_unit" label="Delivered cost" /></td>
                                <td className={`px-2 py-2 text-right tabular-nums font-semibold ${p == null ? 'text-gray-300' : p >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{p == null ? '—' : big(p * split)}</td>
                                <td className="px-2 py-2">
                                  <select value={it.status} onChange={e => saveItem(it, { status: e.target.value }, `status ${e.target.value}`)} className={`text-[10px] font-semibold rounded-full px-2 py-0.5 border-0 ${STATUS_COLOR[it.status] || ''}`}>{ITEM_STATUSES.map(s => <option key={s}>{s}</option>)}</select>
                                </td>
                                <td className="px-2 py-2 text-[10px] text-gray-500 max-w-[200px]">{it.target_suppliers || '—'}</td>
                              </tr>,
                              open === it.id && <tr key={it.id + 'x'} className="bg-[#FAFBFD]"><td colSpan={9} className="px-4 py-3"><ItemDetail it={it} iq={iq} qf={qf} setQf={setQf} addQuote={addQuote} pickQuote={pickQuote} saveItem={saveItem} split={split} /></td></tr>,
                            ]
                          })}
                        </tbody>
                      </table>
                    </div>
                    {/* Phone cards */}
                    <div className="md:hidden divide-y divide-[#F0F2F7]">
                      {rows.map(it => {
                        const p = profitOf(it); const iq = quotes.filter(x => x.bid_item_id === it.id)
                        return (
                          <div key={it.id} className="p-3 space-y-2">
                            <button onClick={() => setOpen(o => o === it.id ? '' : it.id)} className="text-left w-full">
                              <div className="text-[11px] text-gray-400">#{it.line_no} · {units(it.annual_units)} units/yr · {it.case_pack}/cs</div>
                              <div className="font-semibold text-sm text-[#1A1D2E]">{it.item_name}</div>
                            </button>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`border rounded-full px-2 py-0.5 text-[10px] font-semibold ${PATH_COLOR(it.sourcing_path || '')}`}>{it.sourcing_path || 'RFQ'}</span>
                              <select value={it.status} onChange={e => saveItem(it, { status: e.target.value }, `status ${e.target.value}`)} className={`text-[10px] font-semibold rounded-full px-2 py-0.5 border-0 ${STATUS_COLOR[it.status] || ''}`}>{ITEM_STATUSES.map(s => <option key={s}>{s}</option>)}</select>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-[11px]">
                              <label className="text-gray-500">COGS<div><Cell it={it} k="cogs_unit" label="COGS" /></div></label>
                              <label className="text-gray-500">Delivered<div><Cell it={it} k="delivered_unit" label="Delivered cost" /></div></label>
                              <div className="text-gray-500">bG profit<div className={`font-semibold text-sm ${p == null ? 'text-gray-300' : 'text-emerald-700'}`}>{p == null ? '—' : big(p * split)}</div></div>
                            </div>
                            <div className="text-[11px] text-gray-500">Suppliers: {it.target_suppliers || '—'}</div>
                            {open === it.id && <ItemDetail it={it} iq={iq} qf={qf} setQf={setQf} addQuote={addQuote} pickQuote={pickQuote} saveItem={saveItem} split={split} />}
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            )
          })}
          {!groups.length && <div className="rounded-xl border border-[#E4E6EE] bg-white p-8 text-center text-sm text-gray-500">No items match.</div>}
        </div>
      ) : view === 'rfqs' ? (
        <div className="bg-white rounded-xl border border-[#ECEEF3] shadow-sm divide-y divide-[#F0F2F7]">
          {rfqs.map(r => {
            const its = items.filter(i => (r.item_ids || []).includes(i.id))
            return (
              <div key={r.id} className="p-4 flex flex-col md:flex-row md:items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-sm text-[#1A1D2E]">{r.supplier_name}</span>
                    <span className="text-[11px] text-gray-400">{r.country}</span>
                    <span className="text-[11px] text-gray-500 break-all">{r.email}</span>
                  </div>
                  <div className="text-[11px] text-gray-500 mt-1">{r.rfq_group} · {its.length} items: {its.slice(0, 6).map(i => i.item_name).join('; ')}{its.length > 6 ? '…' : ''}</div>
                  {r.reply_preview && <div className="mt-2 text-xs bg-amber-50 border border-amber-100 rounded-lg p-2 text-amber-900">Last reply {ago(r.last_reply_at)}: {r.reply_preview}</div>}
                  <div className="text-[10px] text-gray-400 mt-1">{r.mailbox ? `From ${r.mailbox}` : ''}{r.sent_at ? ` · sent ${ago(r.sent_at)}` : ''}{r.reply_count ? ` · ${r.reply_count} repl${r.reply_count > 1 ? 'ies' : 'y'}` : ''}</div>
                </div>
                <select value={r.status} onChange={e => saveRfq(r, { status: e.target.value, ...(e.target.value === 'Sent' && !r.sent_at ? { sent_at: new Date().toISOString() } : {}) })} className={`text-xs font-semibold rounded-full px-3 py-1 border-0 self-start ${STATUS_COLOR[r.status] || ''}`}>{RFQ_STATUSES.map(s => <option key={s}>{s}</option>)}</select>
              </div>
            )
          })}
          {!rfqs.length && <div className="p-8 text-center text-sm text-gray-500">No supplier RFQs logged yet.</div>}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-[#ECEEF3] shadow-sm divide-y divide-[#F0F2F7]">
          {acts.map(a => (
            <div key={a.id} className="px-4 py-2.5 flex gap-3 text-xs">
              <span className="text-gray-400 w-20 shrink-0">{ago(a.at)}</span>
              <span className={`shrink-0 text-[10px] font-semibold uppercase rounded px-1.5 py-0.5 h-fit ${a.kind === 'reply' ? 'bg-amber-50 text-amber-700' : a.kind === 'quote' ? 'bg-violet-50 text-violet-700' : a.kind === 'rfq' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{a.kind}</span>
              <span className="text-[#1A1D2E] flex-1">{a.message}</span>
              <span className="text-gray-400 shrink-0 hidden sm:inline">{a.actor}</span>
            </div>
          ))}
          {!acts.length && <div className="p-8 text-center text-sm text-gray-500">No activity yet.</div>}
        </div>
      )}
    </div>
  )
}

function ItemDetail({ it, iq, qf, setQf, addQuote, pickQuote, saveItem, split }: any) {
  const f = qf[it.id] || {}
  const set = (k: string, v: string) => setQf((s: any) => ({ ...s, [it.id]: { ...(s[it.id] || {}), [k]: v } }))
  return (
    <div className="space-y-3 text-xs">
      <div className="grid md:grid-cols-3 gap-3">
        <div><div className="text-[10px] uppercase text-gray-400 font-semibold">How COGS was set</div><div className="text-gray-700">{it.cogs_basis || '—'}</div></div>
        <div><div className="text-[10px] uppercase text-gray-400 font-semibold">Origin</div><div className="text-gray-700">{it.origin || '—'}</div></div>
        <div><div className="text-[10px] uppercase text-gray-400 font-semibold">Customer notes</div><div className="text-gray-700">{it.customer_notes || '—'}</div></div>
      </div>
      <div>
        <div className="text-[10px] uppercase text-gray-400 font-semibold mb-1">Notes</div>
        <textarea defaultValue={it.notes || ''} key={it.id + (it.notes || '')} onBlur={e => { if ((e.target.value || '') !== (it.notes || '')) saveItem(it, { notes: e.target.value }, 'notes updated') }} rows={2} className="w-full border border-[#E4E6EE] rounded-lg px-2 py-1.5" placeholder="Specs, art status, follow ups…" />
      </div>
      <div>
        <div className="text-[10px] uppercase text-gray-400 font-semibold mb-1">Supplier quotes</div>
        {iq.length ? (
          <div className="space-y-1">
            {iq.map((x: any) => (
              <div key={x.id} className={`flex flex-wrap items-center gap-2 rounded-lg border px-2 py-1.5 ${x.is_selected ? 'border-emerald-400 bg-emerald-50' : 'border-[#ECEEF3] bg-white'}`}>
                <span className="font-semibold">{x.supplier_name}</span>
                <span>{x.unit_price != null ? usd(Number(x.unit_price), 4) : '—'} {x.incoterm || ''}</span>
                {x.landed_unit != null && <span className="text-emerald-700">landed {usd(Number(x.landed_unit), 4)}</span>}
                {x.moq && <span className="text-gray-500">MOQ {x.moq}</span>}
                {x.lead_time && <span className="text-gray-500">{x.lead_time}</span>}
                <span className="text-gray-400">{x.quote_date}</span>
                <button onClick={() => pickQuote(it, x)} className="ml-auto text-[11px] font-semibold text-emerald-700 hover:underline">{x.is_selected ? 'In use' : 'Use as COGS'}</button>
              </div>
            ))}
          </div>
        ) : <div className="text-gray-400">No quotes yet.</div>}
        <div className="grid grid-cols-2 md:grid-cols-7 gap-1.5 mt-2">
          {[['supplier_name', 'Supplier'], ['unit_price', 'Price / unit'], ['incoterm', 'FOB / DDP'], ['landed_unit', 'Landed / unit'], ['moq', 'MOQ'], ['lead_time', 'Lead time']].map(([k, ph]) => (
            <input key={k} value={f[k] || ''} onChange={e => set(k, e.target.value)} placeholder={ph} className="border border-[#E4E6EE] rounded px-2 py-1" />
          ))}
          <button onClick={() => addQuote(it)} className="bg-[#1A1D2E] text-white rounded px-2 py-1 font-semibold">Add quote</button>
        </div>
      </div>
      {it.delivered_unit != null && it.cogs_unit != null && (
        <div className="text-[11px] text-gray-500">Margin {(((it.delivered_unit - it.cogs_unit) / it.delivered_unit) * 100).toFixed(1)}% · split {Math.round(split * 100)}/{Math.round((1 - split) * 100)} with the partner</div>
      )}
    </div>
  )
}
