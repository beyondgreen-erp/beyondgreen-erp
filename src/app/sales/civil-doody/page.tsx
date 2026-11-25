'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
// Civil Doody consumer orders pulled from their Odoo store. One row per Odoo delivery order.
// Pack it, enter carrier + tracking, and the shipment is sent back to Odoo from here.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Line { move_id: number; sku: string; name: string; qty: number; reserved: number; print_file: string | null; sticker: string | null }
interface Order {
  id: string; target: 'test' | 'live'; picking_id: number; picking_name: string; sale_order_name: string | null; odoo_state: string | null
  customer_name: string | null; customer_email: string | null; customer_phone: string | null; ship_address: string | null
  scheduled_date: string | null; order_date: string | null; is_subscription: boolean | null; lines: Line[]
  status: string; carrier: string | null; tracking_number: string | null; shipped_at: string | null; shipped_by: string | null
  shipped_lines: { move_id: number; qty: number }[] | null
  sync_status: 'sent' | 'failed' | 'blocked' | null; sync_message: string | null; synced_at: string | null; notes: string | null; pulled_at: string
}

const STATUS_COLOR: Record<string, string> = {
  'New': '#0086C0', 'On Hold': '#A25DDC', 'Waiting on Stock': '#9699A6', 'Packed': '#FDAB3D',
  'Shipped': '#00A84F', 'Partial': '#FF9900', 'Cancelled': '#E2445C', 'Closed in Odoo': '#676879',
}
const TABS: { key: string; label: string; match: (o: Order) => boolean }[] = [
  { key: 'todo', label: 'To pack', match: o => o.status === 'New' || o.status === 'Packed' },
  { key: 'hold', label: 'On hold', match: o => o.status === 'On Hold' },
  { key: 'wait', label: 'Waiting on stock', match: o => o.status === 'Waiting on Stock' },
  { key: 'shipped', label: 'Shipped', match: o => o.status === 'Shipped' || o.status === 'Partial' },
  { key: 'closed', label: 'Cancelled / closed', match: o => o.status === 'Cancelled' || o.status === 'Closed in Odoo' },
  { key: 'all', label: 'All', match: () => true },
]
const CARRIERS = ['USPS', 'UPS', 'FedEx', 'DHL', 'Other']
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
const fmtDT = (d: string | null) => d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''

function Stat({ label, value, c }: { label: string; value: number; c: string }) {
  return (
    <div className="mon-stat stat-card" style={{ ['--c']: c } as any}>
      <p className="text-xs font-semibold text-gray-400">{label}</p>
      <p className="mon-stat-val mt-0.5">{value.toLocaleString()}</p>
    </div>
  )
}

export default function CivilDoodyOrdersPage() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [target, setTarget] = useState<'test' | 'live'>('test')
  const [rows, setRows] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('todo')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [ship, setShip] = useState<Order | null>(null)
  const [carrier, setCarrier] = useState('USPS')
  const [tracking, setTracking] = useState('')
  const [qty, setQty] = useState<Record<number, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await sb.from('odoo_orders').select('*').eq('target', target).order('scheduled_date', { ascending: true }).limit(2000)
    if (error) setMsg({ kind: 'err', text: error.message })
    setRows((data || []) as Order[])
    setLoading(false)
  }, [sb, target])
  useEffect(() => { load() }, [load])

  async function api(body: any) {
    const r = await fetch('/api/odoo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return r.json().catch(() => ({ error: 'The ERP did not answer. Please try again.' }))
  }
  async function pull() {
    setBusy('pull'); setMsg(null)
    const j = await api({ action: 'pull', target })
    if (j.ok) setMsg({ kind: 'ok', text: `Pulled from Odoo: ${j.open_in_odoo} open orders, ${j.added} new, ${j.updated} refreshed, ${j.closed_or_cancelled} closed or cancelled.` })
    else setMsg({ kind: 'err', text: j.error || 'Pull failed' })
    setBusy(''); load()
  }
  async function setStatus(o: Order, status: string) {
    setBusy(o.id)
    const { error } = await sb.from('odoo_orders').update({ status, updated_at: new Date().toISOString() }).eq('id', o.id)
    if (error) setMsg({ kind: 'err', text: error.message })
    setBusy(''); load()
  }
  function openShip(o: Order) {
    setShip(o); setCarrier(o.carrier || 'USPS'); setTracking(o.tracking_number || '')
    setQty(Object.fromEntries(o.lines.map(l => [l.move_id, String(l.qty)])))
  }
  async function submitShip() {
    if (!ship) return
    setBusy('ship'); setMsg(null)
    const j = await api({ action: 'ship', id: ship.id, carrier, tracking_number: tracking, lines: ship.lines.map(l => ({ move_id: l.move_id, qty: Number(qty[l.move_id] ?? l.qty) })) })
    if (j.error) setMsg({ kind: 'err', text: j.error })
    else setMsg({ kind: j.ok ? 'ok' : 'err', text: `${ship.picking_name}: ${j.sync_message || (j.ok ? 'sent to Odoo.' : 'not sent to Odoo.')}` })
    setBusy(''); setShip(null); load()
  }
  async function retry(o: Order) {
    setBusy(o.id); setMsg(null)
    const j = await api({ action: 'retry', id: o.id })
    setMsg({ kind: j.ok ? 'ok' : 'err', text: `${o.picking_name}: ${j.sync_message || j.error || 'no answer'}` })
    setBusy(''); load()
  }

  const counts = useMemo(() => Object.fromEntries(TABS.map(t => [t.key, rows.filter(t.match).length])), [rows])
  const shown = useMemo(() => {
    const t = TABS.find(x => x.key === tab) || TABS[0]
    const q = search.trim().toLowerCase()
    return rows.filter(t.match).filter(o => !q || [o.picking_name, o.sale_order_name, o.customer_name, o.customer_email, o.ship_address, o.tracking_number, ...o.lines.map(l => l.name + ' ' + l.sku)].some(v => (v || '').toLowerCase().includes(q)))
  }, [rows, tab, search])
  const unsent = rows.filter(o => (o.status === 'Shipped' || o.status === 'Partial') && o.sync_status !== 'sent').length
  const lastPull = rows.reduce((m, o) => (o.pulled_at > m ? o.pulled_at : m), '')

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="mon-tag t-blue">Civil Doody</span>
          <h1 className="text-2xl font-bold text-gray-900 mt-2">Civil Doody Orders</h1>
          <p className="text-sm text-gray-500 mt-1">Consumer orders from the Civil Doody store in Odoo. Pack the box, enter the carrier and tracking number, and the shipment is sent back to Odoo.</p>
          {lastPull && <p className="text-xs text-gray-400 mt-1">Last pulled from Odoo: {fmtDT(lastPull)}</p>}
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-sm font-semibold">
            {(['test', 'live'] as const).map(t => (
              <button key={t} onClick={() => setTarget(t)} className={`px-3 py-2 ${target === t ? (t === 'test' ? 'bg-amber-500 text-white' : 'bg-green-600 text-white') : 'bg-white text-gray-600'}`}>{t === 'test' ? 'Testing' : 'Live'}</button>
            ))}
          </div>
          <button className="mon-btn" onClick={pull} disabled={busy === 'pull'}>{busy === 'pull' ? 'Pulling...' : 'Pull from Odoo'}</button>
        </div>
      </div>

      {target === 'test' && <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm px-4 py-2">Testing database. These are test orders, not real customers. Shipping one here updates the Odoo testing copy only.</div>}
      {target === 'live' && <div className="rounded-lg bg-green-50 border border-green-200 text-green-900 text-sm px-4 py-2">Live Civil Doody store. Orders can be pulled and packed here. Sending shipments back to live Odoo stays off until go-live is switched on.</div>}
      {msg && <div className={`rounded-lg text-sm px-4 py-2 border ${msg.kind === 'ok' ? 'bg-green-50 border-green-200 text-green-900' : 'bg-red-50 border-red-200 text-red-900'}`}>{msg.text}</div>}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="To pack" value={counts.todo || 0} c="#0086C0" />
        <Stat label="On hold" value={counts.hold || 0} c="#A25DDC" />
        <Stat label="Waiting on stock" value={counts.wait || 0} c="#9699A6" />
        <Stat label="Shipped" value={counts.shipped || 0} c="#00A84F" />
        <Stat label="Not yet sent to Odoo" value={unsent} c="#E2445C" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`px-3 py-1.5 rounded-full text-sm font-semibold border ${tab === t.key ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'}`}>{t.label} ({counts[t.key] || 0})</button>
        ))}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search order, name, address, tracking" className="ml-auto border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-full md:w-72" />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-100">
              <th className="px-3 py-2">Odoo order</th><th className="px-3 py-2">Ship to</th><th className="px-3 py-2">Items</th>
              <th className="px-3 py-2">Ship date</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Carrier / tracking</th>
              <th className="px-3 py-2">Odoo update</th><th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">Loading...</td></tr>}
            {!loading && !shown.length && <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">{rows.length ? 'No orders in this view.' : 'No orders yet. Click "Pull from Odoo" to bring them in.'}</td></tr>}
            {shown.map(o => (
              <tr key={o.id} className="border-b border-gray-50 align-top">
                <td className="px-3 py-2">
                  <div className="font-semibold text-gray-900">{o.picking_name}</div>
                  <div className="text-xs text-gray-500">{o.sale_order_name}{o.is_subscription ? ' · subscription' : ''}</div>
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium text-gray-900">{o.customer_name}</div>
                  <div className="text-xs text-gray-500 whitespace-pre-line">{o.ship_address}</div>
                  <div className="text-xs text-gray-400">{[o.customer_email, o.customer_phone].filter(Boolean).join(' · ')}</div>
                </td>
                <td className="px-3 py-2">
                  {o.lines.map(l => (
                    <div key={l.move_id} className="mb-1">
                      <span className="font-semibold">{l.qty} x</span> {l.name} {l.sku && <span className="text-xs text-gray-400">[{l.sku}]</span>}
                      {(l.print_file || l.sticker) && <div className="text-xs text-gray-500">{l.print_file ? `Print file: ${l.print_file}` : ''}{l.print_file && l.sticker ? ' · ' : ''}{l.sticker ? `Sticker: ${l.sticker}` : ''}</div>}
                    </div>
                  ))}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{fmtDate(o.scheduled_date)}</td>
                <td className="px-3 py-2"><span className="mon-status" style={{ background: STATUS_COLOR[o.status] || '#9699A6' }}>{o.status}</span></td>
                <td className="px-3 py-2">
                  {o.tracking_number ? <><div className="font-medium">{o.carrier}</div><div className="text-xs text-gray-600 break-all">{o.tracking_number}</div><div className="text-xs text-gray-400">{fmtDT(o.shipped_at)}</div></> : <span className="text-gray-300">-</span>}
                </td>
                <td className="px-3 py-2 max-w-[220px]">
                  {o.sync_status === 'sent' && <span className="mon-pill" style={{ background: '#E6F6EC', color: '#037F4C' }}>Sent {fmtDT(o.synced_at)}</span>}
                  {o.sync_status === 'failed' && <span className="mon-pill" style={{ background: '#FDECEF', color: '#C4314B' }}>Failed</span>}
                  {o.sync_status === 'blocked' && <span className="mon-pill" style={{ background: '#FFF4E0', color: '#9A5B00' }}>Held (live is read-only)</span>}
                  {o.sync_message && <div className="text-xs text-gray-500 mt-1">{o.sync_message}</div>}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-right space-x-1">
                  {o.status === 'New' && <button className="px-2 py-1 rounded border border-gray-200 text-xs font-semibold" disabled={busy === o.id} onClick={() => setStatus(o, 'Packed')}>Mark packed</button>}
                  {o.status === 'Packed' && <button className="px-2 py-1 rounded border border-gray-200 text-xs font-semibold" disabled={busy === o.id} onClick={() => setStatus(o, 'New')}>Unpack</button>}
                  {o.status === 'On Hold' && <button className="px-2 py-1 rounded border border-gray-200 text-xs font-semibold" disabled={busy === o.id} onClick={() => setStatus(o, 'New')}>Release</button>}
                  {['New', 'Packed', 'On Hold', 'Waiting on Stock'].includes(o.status) && <button className="mon-btn !py-1 !px-2 !text-xs" onClick={() => openShip(o)}>Ship</button>}
                  {(o.status === 'Shipped' || o.status === 'Partial') && o.sync_status !== 'sent' && <button className="mon-btn !py-1 !px-2 !text-xs" disabled={busy === o.id} onClick={() => retry(o)}>{busy === o.id ? 'Sending...' : 'Send to Odoo again'}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ship && (
        <div className="mon-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => busy !== 'ship' && setShip(null)}>
          <div className="mon-modal mon-pop bg-white rounded-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="mon-modal-head h-blue px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg">Ship {ship.picking_name}</h2>
              <button className="mon-modal-close" onClick={() => setShip(null)}>×</button>
            </div>
            <div className="mon-modal-body space-y-4">
              <div className="text-sm">
                <div className="font-semibold">{ship.customer_name}</div>
                <div className="text-gray-500 whitespace-pre-line">{ship.ship_address}</div>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Quantity shipped</p>
                {ship.lines.map(l => (
                  <div key={l.move_id} className="flex items-center gap-2 mb-2">
                    <input type="number" min={0} max={l.qty} value={qty[l.move_id] ?? ''} onChange={e => setQty({ ...qty, [l.move_id]: e.target.value })} className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-sm" />
                    <span className="text-sm">of {l.qty} · {l.name}</span>
                  </div>
                ))}
                <p className="text-xs text-gray-400">Ship less than ordered and Odoo keeps the rest open as a backorder.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm">Carrier
                  <select value={carrier} onChange={e => setCarrier(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm">{CARRIERS.map(c => <option key={c}>{c}</option>)}</select>
                </label>
                <label className="text-sm">Tracking number
                  <input value={tracking} onChange={e => setTracking(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <button className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-semibold" onClick={() => setShip(null)} disabled={busy === 'ship'}>Cancel</button>
                <button className="mon-btn" onClick={submitShip} disabled={busy === 'ship' || !tracking.trim()}>{busy === 'ship' ? 'Sending to Odoo...' : 'Mark shipped and send to Odoo'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
