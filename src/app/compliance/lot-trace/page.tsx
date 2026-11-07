'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import { fmtDate, ymd, today } from '@/lib/compliance'

const TARGET_MIN = 240 // 4 hours
const TARGET_PCT = 99

function mmss(sec: number) { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (h ? `${h}:` : '') + `${String(m).padStart(h ? 2 : 1, '0')}:${String(s).padStart(2, '0')}` }

export default function LotTracePage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const router = useRouter()
  const [q, setQ] = useState('')
  const [days, setDays] = useState(90)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<any>(null)
  const [err, setErr] = useState('')
  const [mock, setMock] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  const [me, setMe] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState('')

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  useEffect(() => {
    sb.auth.getUser().then(async ({ data }) => {
      const email = data.user?.email || ''
      if (!email) return
      const { data: emp } = await sb.from('employees').select('name').ilike('email', email).maybeSingle()
      setMe(emp?.name || email)
    })
    const p = new URLSearchParams(window.location.search)
    if (p.get('mock')) { setMock(true); setStartedAt(Date.now()) }
    const lot = p.get('lot'); if (lot) { setQ(lot); run(lot) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function run(term?: string) {
    const v = (term ?? q).trim(); if (!v) return
    setBusy(true); setErr(''); setSaved('')
    try {
      const r = await fetch(`/api/compliance/lot-trace?q=${encodeURIComponent(v)}&days=${days}`, { cache: 'no-store' })
      const j = await r.json()
      if (j.error) setErr(j.error); else setRes(j)
    } catch (e: any) { setErr(e?.message || 'Trace failed') }
    setBusy(false)
  }

  const elapsedSec = startedAt ? Math.floor((now - startedAt) / 1000) : 0
  const minutes = Math.max(1, Math.round(elapsedSec / 60))
  const t = res?.totals
  const pass = mock && t ? minutes <= TARGET_MIN && (t.pct ?? 0) >= TARGET_PCT : null

  async function boardId(key: string) { const { data } = await sb.from('boards').select('id').eq('board_key', key).maybeSingle(); return data?.id as string | undefined }

  async function saveMock() {
    if (!res?.found) return
    setSaving(true)
    const id = await boardId('compliance-traceability')
    const data = {
      name: `Mock recall ${fmtDate(today())} · ${res.lot.lot_number}`,
      result: pass ? 'Pass' : 'Fail', lot_date: ymd(today()), lot: res.lot.lot_number, sku: res.lot.sku, direction: 'Both',
      trace_minutes: minutes, qty_produced: t.qtyProduced, qty_accounted: t.accounted, pct_accounted: t.pct === null ? '' : Math.round(t.pct * 10) / 10,
      conducted_by: me, findings: [
        `Traced in ${minutes} min (target ${TARGET_MIN}); ${t.pct === null ? 'n/a' : t.pct.toFixed(1)}% accounted for (target ${TARGET_PCT}%).`,
        `${res.exposure.length} shipment(s) to ${t.customers} customer(s) in the ${res.windowDays}-day window; ${t.onHand ?? 'unknown'} on hand.`,
        ...res.gaps,
      ].join('\n'),
    }
    const { data: row, error } = await sb.from('custom_board_items').insert({ board_id: id, group_name: 'Mock Recalls', data, created_by: me }).select('id').single()
    setSaving(false)
    if (error) { alert('Could not save: ' + error.message); return }
    setSaved(row.id); setStartedAt(null)
  }

  async function startRecall() {
    if (!res?.found) return
    if (!confirm(`Open a REAL recall record for lot ${res.lot.lot_number}? This logs an active recall in the ERP (it does not contact anyone).`)) return
    setSaving(true)
    const id = await boardId('compliance-recalls')
    const custLines = res.exposure.filter((e: any) => e.estimatedFromLot > 0 || !t.estimatedShipped).map((e: any) => `${e.customer} · ${e.channel} ${e.ref || ''} · ${fmtDate(e.date)} · qty ${e.qty}${e.contact ? ' · ' + e.contact : ''} · NOT YET NOTIFIED`).join('\n')
    const data = {
      name: `Recall ${res.lot.sku} lot ${res.lot.lot_number}`, status: 'Active', recall_type: 'Recall', date: ymd(today()), sku: res.lot.sku, lots: res.lot.lot_number,
      qty_affected: t.qtyProduced, qty_shipped: t.shippedExact || t.estimatedShipped, qty_recovered: 0, qty_on_hand: t.onHand ?? '', customers: custLines, coordinator: me,
    }
    const { data: row, error } = await sb.from('custom_board_items').insert({ board_id: id, group_name: 'Active', data, created_by: me }).select('id').single()
    setSaving(false)
    if (error) { alert('Could not create the recall: ' + error.message); return }
    router.push(`/board/compliance-recalls?item=${row.id}`)
  }

  return (
    <div className="min-h-screen pb-10" style={{ background: '#F5F6FA' }}>
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 mb-4 print:hidden">
        <div className="flex-1">
          <Link href="/compliance" className="text-xs font-semibold text-emerald-700 hover:underline">&larr; Compliance Dashboard</Link>
          <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1">Lot Trace &amp; Mock Recall</h1>
          <p className="text-sm text-gray-500">Trace a lot back to its raw materials and forward to every customer. Run it as a timed mock recall, or open a real recall from the result.</p>
        </div>
        {!mock ? (
          <button onClick={() => { setMock(true); setStartedAt(Date.now()); setRes(null); setSaved('') }} className="text-sm font-semibold px-4 py-2 rounded-lg text-white" style={{ background: '#00A84F' }}><i className="ti ti-player-play" /> Start a mock recall</button>
        ) : (
          <div className="rounded-xl px-4 py-2 text-white text-sm font-semibold flex items-center gap-2" style={{ background: elapsedSec / 60 > TARGET_MIN ? '#C8102E' : '#0B3D2E' }}>
            <i className="ti ti-clock" /> Mock recall running {mmss(elapsedSec)} <span className="font-normal text-white/70">/ 4:00:00 target</span>
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-[#E4E6EE] p-4 mb-4 print:hidden">
        <div className="flex flex-col sm:flex-row gap-2">
          <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') run() }} placeholder="Lot number (e.g. WM-22GVF48-261107) or SKU" className="flex-1 border border-[#E4E6EE] rounded-lg px-3 py-2.5 text-sm" />
          <select value={days} onChange={e => setDays(Number(e.target.value))} className="border border-[#E4E6EE] rounded-lg px-2 py-2.5 text-sm bg-white">
            {[30, 60, 90, 180, 365].map(d => <option key={d} value={d}>Shipments within {d} days</option>)}
          </select>
          <button onClick={() => run()} disabled={busy} className="text-sm font-semibold px-5 py-2.5 rounded-lg text-white disabled:opacity-50" style={{ background: '#1A1D2E' }}>{busy ? 'Tracing…' : 'Trace'}</button>
        </div>
        {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
      </div>

      {res && !res.found && (
        <div className="bg-white rounded-2xl border border-[#E4E6EE] p-4">
          <p className="text-sm text-gray-600 mb-2">No finished lot matched. Pick a lot:</p>
          <div className="flex flex-wrap gap-2">
            {res.candidates.map((c: any) => <button key={c.lot_number} onClick={() => { setQ(c.lot_number); run(c.lot_number) }} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#E4E6EE] hover:bg-gray-50">{c.lot_number} · {fmtDate(c.produced_date)} · {c.qty_produced}</button>)}
            {!res.candidates.length && <p className="text-sm text-gray-400">No lots found for that SKU.</p>}
          </div>
          {res.rawLots?.length > 0 && <>
            <p className="text-sm text-gray-600 mt-4 mb-2">Raw material lots received:</p>
            <ul className="text-sm space-y-1">{res.rawLots.map((r: any, i: number) => <li key={i}>{r.lot_number} · {r.product_name || r.sku} · {r.supplier} · {fmtDate(r.received_date)} · {r.qty_received}</li>)}</ul>
          </>}
        </div>
      )}

      {res?.found && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              { l: 'Lot', v: res.lot.lot_number, s: `${res.lot.sku}${res.lot.product_name ? ' · ' + res.lot.product_name : ''}` },
              { l: 'Made', v: fmtDate(res.lot.produced_date), s: [res.lot.machine, res.lot.operator].filter(Boolean).join(' · ') || res.lot.lot_type },
              { l: 'Qty produced', v: Number(t.qtyProduced).toLocaleString(), s: `${t.onHand ?? 'unknown'} still on hand` },
              { l: 'Shipped', v: Number(t.shippedExact || t.estimatedShipped).toLocaleString(), s: t.shippedExact ? 'by lot number' : 'estimated, first in first out' },
              { l: 'Accounted for', v: t.pct === null ? '-' : `${t.pct.toFixed(1)}%`, s: `target ${TARGET_PCT}% · ${t.customers} customer(s)`, c: t.pct !== null && t.pct >= TARGET_PCT ? '#00753A' : '#C8102E' },
            ].map(x => <div key={x.l} className="bg-white rounded-xl border border-[#E4E6EE] p-3 min-w-0"><p className="text-[11px] text-gray-500">{x.l}</p><p className="text-lg font-bold break-words" style={{ color: (x as any).c || '#1A1D2E' }}>{x.v}</p><p className="text-[11px] text-gray-500 break-words">{x.s}</p></div>)}
          </div>

          {res.gaps.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-sm font-semibold text-amber-800"><i className="ti ti-alert-circle" /> Traceability gaps an auditor will ask about</p>
              <ul className="list-disc ml-5 mt-1 text-sm text-amber-900 space-y-0.5">{res.gaps.map((g: string, i: number) => <li key={i}>{g}</li>)}</ul>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl border border-[#E4E6EE] p-4">
              <h2 className="font-semibold text-[#1A1D2E] mb-2"><i className="ti ti-arrow-back-up text-gray-400" /> Back: raw materials</h2>
              {res.rawMaterials.length ? res.rawMaterials.map((r: any, i: number) => <div key={i} className="text-sm py-1.5 border-b border-[#F1F2F6]"><p className="font-medium">{r.lot_number}</p><p className="text-xs text-gray-500">{r.product_name || r.sku} · {r.supplier} · received {fmtDate(r.received_date)}</p></div>)
                : <p className="text-sm text-gray-400">{res.inputLots.length ? `Input lots ${res.inputLots.join(', ')} were not found in Receiving.` : 'No input lots recorded.'}</p>}
            </div>
            <div className="bg-white rounded-2xl border border-[#E4E6EE] p-4">
              <h2 className="font-semibold text-[#1A1D2E] mb-2"><i className="ti ti-building-factory-2 text-gray-400" /> Production</h2>
              {res.workOrder && <p className="text-sm mb-2">Work order <b>{res.workOrder.number || res.workOrder.id.slice(0, 8)}</b>{res.workOrder.machine ? ` on ${res.workOrder.machine}` : ''}</p>}
              {res.production.length ? res.production.map((p: any, i: number) => <div key={i} className="text-sm py-1 flex justify-between border-b border-[#F1F2F6]"><span>{fmtDate(p.date)}{p.by ? <span className="text-xs text-gray-500"> · {p.by}</span> : null}</span><span className="font-semibold">{p.qty}</span></div>)
                : <p className="text-sm text-gray-400">Lot recorded as {Number(t.qtyProduced).toLocaleString()} on {fmtDate(res.lot.produced_date)}.</p>}
            </div>
            <div className="bg-white rounded-2xl border border-[#E4E6EE] p-4">
              <h2 className="font-semibold text-[#1A1D2E] mb-2"><i className="ti ti-truck-delivery text-gray-400" /> Forward: who got it</h2>
              {res.exact.length > 0 && res.exact.map((e: any, i: number) => <div key={i} className="text-sm py-1.5 border-b border-[#F1F2F6]"><p className="font-medium">{e.customer_name}</p><p className="text-xs text-gray-500">{fmtDate(e.ship_date)} · PO {e.po_number} · qty {e.qty_shipped} · by lot</p></div>)}
              {res.exposure.length === 0 && res.exact.length === 0 && <p className="text-sm text-gray-400">No shipments of {res.lot.sku} in the {res.windowDays} days after this lot was made.</p>}
              {res.exposure.map((e: any, i: number) => (
                <div key={i} className={'text-sm py-1.5 border-b border-[#F1F2F6] ' + (e.estimatedFromLot > 0 ? '' : 'opacity-60')}>
                  <p className="font-medium">{e.customer}</p>
                  <p className="text-xs text-gray-500">{e.channel} {e.ref} · {fmtDate(e.date)} · qty {e.qty}{e.estimatedFromLot > 0 ? ` · ~${e.estimatedFromLot} from this lot` : ' · likely later lots'}</p>
                  {e.contact && <p className="text-xs text-gray-500">{e.contact}</p>}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-[#E4E6EE] p-4 flex flex-col sm:flex-row sm:items-center gap-3 print:hidden">
            {mock ? (
              <div className="flex-1 text-sm">
                <p className="font-semibold">Mock recall result: <span style={{ color: pass ? '#00753A' : '#C8102E' }}>{pass ? 'PASS' : 'FAIL'}</span></p>
                <p className="text-xs text-gray-500">Traced in {minutes} min (target 240 or less) · {t.pct === null ? 'n/a' : t.pct.toFixed(1) + '%'} accounted for (target {TARGET_PCT}%+). Saving logs it on Mock Recalls &amp; Traceability with the gaps above as findings.</p>
              </div>
            ) : <p className="flex-1 text-sm text-gray-500">Use <b>Start a mock recall</b> to time this as a drill, or open a real recall below.</p>}
            {mock && !saved && <button onClick={saveMock} disabled={saving} className="text-sm font-semibold px-4 py-2 rounded-lg text-white disabled:opacity-50" style={{ background: '#00A84F' }}>Save mock recall</button>}
            {saved && <Link href={`/board/compliance-traceability?item=${saved}`} className="text-sm font-semibold px-4 py-2 rounded-lg border border-emerald-600 text-emerald-700">Saved. Open record</Link>}
            <button onClick={() => window.print()} className="text-sm font-semibold px-4 py-2 rounded-lg border border-[#E4E6EE]">Print / PDF</button>
            <button onClick={startRecall} disabled={saving} className="text-sm font-semibold px-4 py-2 rounded-lg border border-red-300 text-red-700 hover:bg-red-50">Start a real recall</button>
          </div>
        </div>
      )}
    </div>
  )
}
