'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import PortalShell, { api, usePortal, GREEN, INK, cardCls, inputCls, labelCls, btnCls, btnGhostCls, fmtDate, money, qty, Pill, Empty, FileDrop } from '@/components/portal/PortalShell'

function trackUrl(carrier: string | null, num: string | null): string | null {
  if (!num) return null
  const c = (carrier || '').toLowerCase()
  if (c.includes('ups') || /^1Z/i.test(num)) return `https://www.ups.com/track?tracknum=${encodeURIComponent(num)}`
  if (c.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(num)}`
  if (c.includes('usps')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(num)}`
  return null
}

function Tracking({ carrier, num }: { carrier: string | null; num: string | null }) {
  if (!num) return <span className="text-gray-400">—</span>
  const u = trackUrl(carrier, num)
  return u ? <a href={u} target="_blank" rel="noreferrer" className="font-semibold hover:underline" style={{ color: GREEN }}>{num}</a> : <span>{num}</span>
}

function OrderCard({ o, onReorder }: { o: any; onReorder: (o: any) => void }) {
  return (
    <details className={`${cardCls} overflow-hidden`}>
      <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[#FAFBFD]">
        <div className="min-w-0 flex-1">
          <p className="font-bold text-sm" style={{ color: INK }}>SO {o.number}{o.po ? <span className="text-gray-500 font-medium"> · PO {o.po}</span> : null}</p>
          <p className="text-xs text-gray-500 mt-0.5">Ordered {fmtDate(o.date)}{o.ship_by ? ` · ship by ${fmtDate(o.ship_by)}` : ''}{o.shipped_on ? ` · shipped ${fmtDate(o.shipped_on)}` : ''}</p>
        </div>
        <Pill tone={o.stage?.tone}>{o.stage?.label}</Pill>
      </summary>
      <div className="px-4 pb-4 pt-1 border-t border-[#F1F3F9] space-y-3">
        {o.lines.length > 0 && (
          <div className="overflow-x-auto"><table className="w-full text-xs min-w-[460px]">
            <thead><tr className="text-gray-400 text-[10px] uppercase"><th className="text-left py-1.5">Item</th><th className="text-right py-1.5">Ordered</th><th className="text-right py-1.5">Shipped</th><th className="text-right py-1.5">Price</th></tr></thead>
            <tbody>{o.lines.map((l: any, i: number) => (
              <tr key={i} className="border-t border-[#F3F4F8]"><td className="py-1.5 pr-2"><span className="font-semibold text-gray-700">{l.sku}</span> {l.description}</td><td className="text-right">{qty(l.quantity)} {l.unit || ''}</td><td className="text-right">{qty(l.shipped)}</td><td className="text-right">{l.unit_price != null ? money(l.unit_price) : ''}</td></tr>
            ))}</tbody>
          </table></div>
        )}
        {o.shipments.length > 0 && (
          <div className="text-xs space-y-1">
            <p className="font-semibold text-gray-500 uppercase text-[10px]">Shipments</p>
            {o.shipments.map((s: any, i: number) => <p key={i}>{fmtDate(s.date)} · {s.carrier || 'Carrier'} · <Tracking carrier={s.carrier} num={s.tracking} />{s.status ? ` · ${s.status}` : ''}</p>)}
          </div>
        )}
        {!o.shipments.length && o.tracking && <p className="text-xs">Tracking: {o.carrier || ''} <Tracking carrier={o.carrier} num={o.tracking} /></p>}
        <div className="flex flex-wrap items-center gap-2 justify-between">
          {o.total ? <span className="text-sm font-bold" style={{ color: INK }}>Total {money(o.total)}</span> : <span />}
          {o.lines.length > 0 && <button onClick={() => onReorder(o)} className={btnGhostCls}>Reorder these items</button>}
        </div>
      </div>
    </details>
  )
}

function NewOrder({ catalog, prefill, onDone, onCancel }: { catalog: any; prefill: any[] | null; onDone: (n: string) => void; onCancel: () => void }) {
  const { customer } = usePortal()
  const [lines, setLines] = useState<any[]>(() => (prefill || []).map(l => ({ ...l })))
  const [q, setQ] = useState('')
  const [search, setSearch] = useState<any[]>([])
  const [po, setPo] = useState('')
  const [poFile, setPoFile] = useState<{ path: string; name: string } | null>(null)
  const [shipDate, setShipDate] = useState('')
  const [shipTo, setShipTo] = useState(customer?.shipping_address || '')
  const [delivery, setDelivery] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (q.trim().length < 2) { setSearch([]); return }
    const t = setTimeout(async () => { const { data } = await api('catalog?q=' + encodeURIComponent(q.trim())); setSearch(data.search || []) }, 300)
    return () => clearTimeout(t)
  }, [q])

  const key = (i: any) => (i.product_id || i.sku || i.description || '').toString()
  const inCart = (i: any) => lines.find(l => key(l) === key(i))
  const setQty = (i: any, v: string) => {
    const n = Number(v)
    setLines(ls => {
      const ex = ls.find(l => key(l) === key(i))
      if (!v || !n) return ls.filter(l => key(l) !== key(i))
      if (ex) return ls.map(l => key(l) === key(i) ? { ...l, quantity: n } : l)
      return [...ls, { product_id: i.product_id || null, sku: i.sku || null, description: i.name || i.description || '', unit: i.unit || null, last_price: i.last_price ?? null, quantity: n }]
    })
  }

  async function submit() {
    setErr('')
    if (!lines.length && !poFile) { setErr('Add at least one item or attach your PO.'); return }
    setBusy(true)
    try {
      const { ok, data } = await api('order-request', { lines, po_number: po, po_path: poFile?.path, po_name: poFile?.name, requested_ship_date: shipDate, ship_to: shipTo, delivery_notes: delivery, notes })
      if (!ok) { setErr(data.error || 'Could not submit.'); return }
      onDone(data.request_number)
    } finally { setBusy(false) }
  }

  const items = catalog?.items || []
  return (
    <div className={`${cardCls} p-4 sm:p-5 space-y-5`}>
      <div className="flex items-center justify-between"><h2 className="text-lg font-bold" style={{ color: INK }}>New order</h2><button onClick={onCancel} className="text-sm text-gray-400 hover:text-gray-600">Close</button></div>

      <section>
        <p className={labelCls}>Items you buy</p>
        {items.length === 0 ? <p className="text-sm text-gray-500">No order history yet. Search below, or just attach your PO.</p> : (
          <div className="divide-y divide-[#F1F3F9] border border-[#EEF0F4] rounded-xl">
            {items.map((i: any) => (
              <div key={key(i)} className="flex items-center gap-3 px-3 py-2.5">
                {i.image ? <img src={i.image} alt="" className="w-10 h-10 rounded-lg object-contain bg-[#F7F8FA] shrink-0" /> : <span className="w-10 h-10 rounded-lg bg-[#F1F5F2] shrink-0" />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate" style={{ color: INK }}>{i.name || i.description}</p>
                  <p className="text-[11px] text-gray-500">{i.sku}{i.case_qty ? ` · ${qty(i.case_qty)}/case` : ''} · last ordered {fmtDate(i.last_ordered)}{i.last_qty ? ` (${qty(i.last_qty)} ${i.unit || ''})` : ''}{i.last_price != null ? ` · ${money(i.last_price)}/${(i.unit || 'unit').toLowerCase()}` : ''}{i.discontinued ? ' · discontinued' : ''}</p>
                </div>
                <input inputMode="numeric" placeholder="Qty" className="w-20 border border-[#E4E6EE] rounded-lg px-2 py-1.5 text-sm text-right" value={inCart(i)?.quantity || ''} onChange={e => setQty(i, e.target.value.replace(/[^0-9.]/g, ''))} />
                <span className="w-10 text-[11px] text-gray-400">{i.unit || ''}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <p className={labelCls}>Add another product</p>
        <input className={inputCls} placeholder="Search by name or SKU (e.g. fork, jumbo straw, 13 gallon)" value={q} onChange={e => setQ(e.target.value)} />
        {search.length > 0 && (
          <div className="mt-2 divide-y divide-[#F1F3F9] border border-[#EEF0F4] rounded-xl max-h-72 overflow-auto">
            {search.map((i: any) => (
              <div key={key(i)} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1"><p className="text-sm font-semibold truncate">{i.name}</p><p className="text-[11px] text-gray-500">{i.sku}{i.case_qty ? ` · ${qty(i.case_qty)}/case` : ''}</p></div>
                <input inputMode="numeric" placeholder="Qty" className="w-20 border border-[#E4E6EE] rounded-lg px-2 py-1.5 text-sm text-right" value={inCart(i)?.quantity || ''} onChange={e => setQty(i, e.target.value.replace(/[^0-9.]/g, ''))} />
                <span className="w-10 text-[11px] text-gray-400">{i.unit || ''}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {lines.length > 0 && (
        <section className="rounded-xl bg-[#F7FBF9] border border-[#D7EEE1] p-3">
          <p className="text-xs font-bold mb-1.5" style={{ color: GREEN }}>Your order ({lines.length} item{lines.length === 1 ? '' : 's'})</p>
          {lines.map(l => <div key={key(l)} className="flex justify-between text-sm py-0.5"><span className="truncate pr-2">{l.sku ? <b>{l.sku} </b> : null}{l.description}</span><span className="shrink-0">{qty(l.quantity)} {l.unit || ''} <button onClick={() => setLines(ls => ls.filter(x => key(x) !== key(l)))} className="ml-2 text-gray-400 hover:text-red-500">×</button></span></div>)}
        </section>
      )}

      <section className="grid sm:grid-cols-2 gap-3">
        <label className="block"><span className={labelCls}>PO number</span><input className={inputCls} value={po} onChange={e => setPo(e.target.value)} /></label>
        <label className="block"><span className={labelCls}>Requested ship date</span><input type="date" className={inputCls} value={shipDate} onChange={e => setShipDate(e.target.value)} min={new Date().toISOString().slice(0, 10)} /></label>
        <div className="sm:col-span-2">
          <span className={labelCls}>Attach your PO (optional)</span>
          {poFile ? <p className="text-sm">📄 {poFile.name} <button onClick={() => setPoFile(null)} className="ml-2 text-xs text-gray-400 hover:text-red-500">remove</button></p> : <FileDrop kind="po" multiple={false} label="Drop your PO or tap to upload" onUploaded={f => setPoFile(f)} />}
        </div>
        <label className="block sm:col-span-2"><span className={labelCls}>Ship to</span><textarea rows={2} className={inputCls} value={shipTo} onChange={e => setShipTo(e.target.value)} /></label>
        <label className="block sm:col-span-2"><span className={labelCls}>Delivery requirements</span><input className={inputCls} placeholder="Receiving hours, liftgate, appointment, dock…" value={delivery} onChange={e => setDelivery(e.target.value)} /></label>
        <label className="block sm:col-span-2"><span className={labelCls}>Notes</span><textarea rows={2} className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} /></label>
      </section>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className={btnGhostCls}>Cancel</button>
        <button onClick={submit} disabled={busy} className={btnCls} style={{ background: GREEN }}>{busy ? 'Submitting…' : 'Submit order'}</button>
      </div>
      <p className="text-[11px] text-gray-400">Prices shown are what you last paid; your sales order confirmation is final. We confirm portal orders within one business day.</p>
    </div>
  )
}

function OrdersBody() {
  const { account } = usePortal()
  const [data, setData] = useState<any>(null)
  const [catalog, setCatalog] = useState<any>(null)
  const [tab, setTab] = useState<'open' | 'history' | 'invoices' | 'web'>('open')
  const [ordering, setOrdering] = useState<any[] | null>(null)
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    const [o, c] = await Promise.all([api('orders'), api('catalog')])
    setData(o.data); setCatalog(c.data)
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('new') === '1') setOrdering([]) }, [])

  const open = useMemo(() => (data?.orders || []).filter((o: any) => o.open), [data])
  const closed = useMemo(() => (data?.orders || []).filter((o: any) => !o.open), [data])
  const pendingWeb = (data?.requests || []).filter((r: any) => r.status === 'Submitted').length

  function reorder(o: any) {
    setOrdering(o.lines.map((l: any) => ({ product_id: l.product_id || null, sku: l.sku, description: l.description, unit: l.unit, last_price: l.unit_price, quantity: l.quantity })))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  async function cancelReq(id: string) {
    if (!confirm('Cancel this order before we process it?')) return
    const { ok, data: d } = await api('order-cancel', { id })
    if (!ok) alert(d.error || 'Could not cancel.'); else load()
  }

  if (!data) return <Empty>Loading your orders…</Empty>
  const tabs: [typeof tab, string, number][] = [['open', 'Open orders', open.length], ['history', 'History', closed.length + (data.past_shipments?.length || 0)], ['invoices', 'Invoices', data.invoices?.length || 0], ['web', 'Placed online', pendingWeb]]

  return (
    <div className="space-y-4">
      {toast && <div className="rounded-xl bg-[#E4F7EE] border border-[#BFE6D0] text-[#0F5132] px-4 py-3 text-sm">{toast}</div>}
      {ordering ? (
        account?.approved
          ? <NewOrder catalog={catalog} prefill={ordering} onCancel={() => setOrdering(null)} onDone={n => { setOrdering(null); setToast(`Order ${n} received. We will confirm it within one business day.`); setTab('web'); load() }} />
          : <Empty>Ordering unlocks once your account is approved. Finish your onboarding packet under Account, or send us your PO in a message and we will enter it for you.</Empty>
      ) : (
        <div className="flex justify-end -mt-2"><button onClick={() => setOrdering([])} className={btnCls} style={{ background: GREEN }}>+ New order / upload PO</button></div>
      )}

      <div className="flex gap-2 overflow-x-auto">
        {tabs.map(([k, label, n]) => <button key={k} onClick={() => setTab(k)} className={`whitespace-nowrap text-sm font-semibold rounded-full px-3.5 py-1.5 border ${tab === k ? 'text-white border-transparent' : 'bg-white text-gray-600 border-[#E4E6EE]'}`} style={tab === k ? { background: GREEN } : {}}>{label}{n ? ` (${n})` : ''}</button>)}
      </div>

      {tab === 'open' && (open.length ? <div className="space-y-2">{open.map((o: any) => <OrderCard key={o.id} o={o} onReorder={reorder} />)}</div> : <Empty>No open orders right now.</Empty>)}

      {tab === 'history' && (
        <div className="space-y-2">
          {closed.map((o: any) => <OrderCard key={o.id} o={o} onReorder={reorder} />)}
          {data.past_shipments?.length > 0 && (
            <div className={`${cardCls} overflow-x-auto`}>
              <p className="px-4 pt-3 text-xs font-bold text-gray-500 uppercase">Earlier shipments</p>
              <table className="w-full text-xs min-w-[520px]"><thead><tr className="text-gray-400 text-[10px] uppercase"><th className="text-left px-4 py-2">Date</th><th className="text-left py-2">PO</th><th className="text-left py-2">Carrier</th><th className="text-left py-2">Tracking</th><th className="text-right px-4 py-2">Total</th></tr></thead>
                <tbody>{data.past_shipments.map((s: any, i: number) => <tr key={i} className="border-t border-[#F3F4F8]"><td className="px-4 py-1.5">{fmtDate(s.date)}</td><td>{s.po || '—'}</td><td>{s.carrier || '—'}</td><td><Tracking carrier={s.carrier} num={s.tracking} /></td><td className="text-right px-4">{s.total ? money(s.total) : ''}</td></tr>)}</tbody></table>
            </div>
          )}
          {!closed.length && !data.past_shipments?.length && <Empty>No past orders yet.</Empty>}
        </div>
      )}

      {tab === 'invoices' && (data.invoices?.length ? (
        <div className={`${cardCls} overflow-x-auto`}>
          <table className="w-full text-sm min-w-[560px]"><thead><tr className="text-gray-400 text-[10px] uppercase"><th className="text-left px-4 py-2.5">Invoice</th><th className="text-left py-2.5">Date</th><th className="text-left py-2.5">Due</th><th className="text-left py-2.5">PO</th><th className="text-right py-2.5">Total</th><th className="text-right py-2.5">Balance</th><th className="text-right px-4 py-2.5">Status</th></tr></thead>
            <tbody>{data.invoices.map((v: any, i: number) => <tr key={i} className="border-t border-[#F3F4F8]"><td className="px-4 py-2 font-semibold">{v.number}</td><td>{fmtDate(v.date)}</td><td>{fmtDate(v.due)}</td><td>{v.po || '—'}</td><td className="text-right">{money(v.total)}</td><td className="text-right font-semibold" style={{ color: v.balance > 0 ? '#B45309' : GREEN }}>{money(v.balance)}</td><td className="text-right px-4"><Pill tone={v.balance > 0 ? 'amber' : 'green'}>{v.status || (v.balance > 0 ? 'Open' : 'Paid')}</Pill></td></tr>)}</tbody></table>
        </div>
      ) : <Empty>No invoices yet.</Empty>)}

      {tab === 'web' && ((data.requests || []).length ? (
        <div className="space-y-2">{data.requests.map((r: any) => (
          <div key={r.id} className={`${cardCls} px-4 py-3`}>
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1"><p className="font-bold text-sm" style={{ color: INK }}>{r.request_number}{r.po_number ? <span className="text-gray-500 font-medium"> · PO {r.po_number}</span> : null}</p><p className="text-xs text-gray-500">Placed {fmtDate(r.created_at)}{r.requested_ship_date ? ` · ship by ${fmtDate(r.requested_ship_date)}` : ''}{r.po_file_name ? ` · ${r.po_file_name}` : ''}</p></div>
              <Pill tone={r.status === 'Converted' ? 'green' : r.status === 'Submitted' ? 'amber' : r.status === 'Declined' ? 'red' : 'gray'}>{r.status === 'Converted' ? 'Confirmed' : r.status === 'Submitted' ? 'Received' : r.status}</Pill>
            </div>
            {(r.lines || []).length > 0 && <p className="text-xs text-gray-600 mt-2">{r.lines.map((l: any) => `${qty(l.quantity)} ${l.unit || ''} ${l.sku || l.description}`).join(' · ')}</p>}
            {r.decline_reason && <p className="text-xs text-red-600 mt-1">{r.decline_reason}</p>}
            {r.status === 'Submitted' && <button onClick={() => cancelReq(r.id)} className="mt-2 text-xs font-semibold text-gray-500 hover:text-red-600">Cancel order</button>}
          </div>
        ))}</div>
      ) : <Empty>Orders you place in the portal show here until they are confirmed.</Empty>)}
    </div>
  )
}

export default function OrdersPage() {
  return <PortalShell title="Orders" subtitle="Track current orders, reorder in a few taps, and upload POs."><OrdersBody /></PortalShell>
}
