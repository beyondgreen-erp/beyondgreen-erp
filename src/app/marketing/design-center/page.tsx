'use client'
export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react'

const API = '/api/site/design'
const SITE = 'https://beyondgreen-site.vercel.app'
const STATUSES = ['Awaiting payment', 'Paid', 'Quote requested', 'Quote sent', 'Proof sent', 'Proof approved', 'In production', 'Shipped', 'Canceled']
const inp = 'w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] rounded-lg px-2 py-1.5 text-sm'
const fmt = (s: string) => new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function DesignCenterAdmin() {
  const [tab, setTab] = useState<'orders' | 'pricing'>('orders')
  const [rows, setRows] = useState<any[]>([]); const [prods, setProds] = useState<any[]>([])
  const [loading, setLoading] = useState(true); const [q, setQ] = useState(''); const [edit, setEdit] = useState<Record<string, any>>({})
  const load = useCallback(async () => {
    setLoading(true); const r = await fetch(`${API}/admin-orders`, { cache: 'no-store' }); const j = await r.json()
    setRows(j.rows || []); setProds(j.products || []); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])
  async function setStatus(o: any, status: string) { await fetch(`${API}/admin-status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: o.id, status }) }); load() }
  async function saveProd(p: any) { await fetch(`${API}/admin-product`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ template_id: p.template_id, ...edit[p.template_id] }) }); setEdit({ ...edit, [p.template_id]: undefined }); load() }
  const shown = useMemo(() => prods.filter(p => p.site_templates?.is_active && (!q || `${p.site_templates?.item} ${p.site_templates?.category}`.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => (a.mode === b.mode ? 0 : a.mode === 'buy' ? -1 : 1) || String(a.site_templates?.category).localeCompare(String(b.site_templates?.category))), [prods, q])
  const tb = (k: 'orders' | 'pricing', l: string) => <button onClick={() => setTab(k)} className={`text-sm px-3 py-1.5 rounded-lg font-semibold ${tab === k ? 'bg-[#1b8a3a] text-white' : 'bg-white border border-[#E4E6EE] text-gray-600'}`}>{l}</button>
  const paid = rows.filter(r => r.status !== 'Awaiting payment' && r.kind === 'order' && r.status !== 'Canceled')
  return (
    <div className="min-h-screen mon-page p-4 md:p-6">
      <span className="mon-tag t-green">🎨 Website · Design Center</span>
      <h1 className="text-2xl font-bold text-[#1A1D2E] mt-1.5">Design Center orders and pricing</h1>
      <p className="text-gray-500 text-sm mt-0.5 mb-4">Customer designs, printed orders and quote requests from the website. <a className="text-[#1b8a3a] font-semibold" href={`${SITE}/design`} target="_blank" rel="noreferrer">Open the Design Center ↗</a></p>
      <div className="flex gap-2 mb-4">{tb('orders', `Orders and quotes (${rows.length})`)}{tb('pricing', 'Pricing rules')}</div>
      {loading ? <p className="text-gray-400 text-sm">Loading…</p> : tab === 'orders' ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
            {[['Orders', rows.filter(r => r.kind === 'order').length], ['Paid or later', paid.length], ['Paid value', '$' + paid.reduce((a, r) => a + Number(r.subtotal || 0), 0).toFixed(2)], ['Quote requests', rows.filter(r => r.kind === 'quote').length]].map(([k, v]) => <div key={String(k)} className="bg-white rounded-xl border border-[#ECEEF3] p-3"><p className="text-[10px] uppercase text-gray-400 font-semibold">{k}</p><p className="text-lg font-bold">{v}</p></div>)}
          </div>
          {rows.length === 0 ? <div className="bg-white rounded-xl border border-[#ECEEF3] p-8 text-center text-sm text-gray-500">No designs submitted yet.</div> : (
            <div className="space-y-2">{rows.map(r => (
              <div key={r.id} className="bg-white rounded-xl border border-[#ECEEF3] p-3 text-sm flex gap-3 flex-wrap">
                {r.proof_url && <a href={r.proof_url} target="_blank" rel="noreferrer"><img src={r.proof_url} alt="Proof" className="w-32 h-24 object-contain rounded border border-[#EEF0F4] bg-[#F5F7FA]" /></a>}
                <div className="flex-1 min-w-[220px]">
                  <div className="flex justify-between gap-2 flex-wrap"><b>{r.kind === 'quote' ? 'Quote: ' : 'Order: '}{r.template_item}</b><span className="text-xs text-gray-400">{fmt(r.created_at)}</span></div>
                  <div className="text-gray-600">{r.company || '-'} · {r.name} · {r.email}{r.phone ? ` · ${r.phone}` : ''}</div>
                  <div className="text-gray-600">{r.quantity ? `${Number(r.quantity).toLocaleString()} pcs · ` : ''}{r.colors} color(s) · {r.product_color || '-'} · {r.origin === 'US' ? 'USA' : 'International'}{r.subtotal ? ` · $${r.subtotal} (unit $${r.unit_price}, plates $${r.plate_fee})` : ''}</div>
                  {r.notes && <div className="text-gray-500 text-xs mt-1">Notes: {r.notes}</div>}
                  {!!(r.asset_urls || []).length && <div className="text-xs mt-1 flex gap-2 flex-wrap">{r.asset_urls.map((u: string, i: number) => u && <a key={i} href={u} target="_blank" rel="noreferrer" className="text-[#1b8a3a] underline">Artwork file {i + 1}</a>)}</div>}
                  <div className="flex gap-2 mt-2 items-center flex-wrap">
                    <select value={r.status} onChange={e => setStatus(r, e.target.value)} className={inp + ' w-auto'}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select>
                    {r.shopify_order_name && <span className="text-xs text-gray-500">Shopify {r.shopify_order_name}</span>}
                    {r.checkout_url && r.status === 'Awaiting payment' && <a href={r.checkout_url} target="_blank" rel="noreferrer" className="text-xs text-[#1b8a3a] underline">Payment link</a>}
                  </div>
                </div>
              </div>
            ))}</div>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-gray-500 mb-2">Costs stay inside the ERP. The website only sees selling prices: cost ÷ (1 − margin), with margin stepping down by volume (45% at the minimum, 38% at 2.5×, 30% at 5×, 24% at 10×, 18% at 25×). Plate fees are cost ÷ 0.75, one time per color.</p>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search items" className={inp + ' mb-2 max-w-sm'} />
          <div className="bg-white rounded-xl border border-[#ECEEF3] overflow-x-auto">
            <table className="w-full text-sm"><thead><tr className="text-left text-[11px] uppercase text-gray-400">{['Item', 'Mode', 'Made', 'Unit cost', 'Print / color', 'Plate / color', 'MOQ', 'Max colors', ''].map(h => <th key={h} className="px-2 py-2">{h}</th>)}</tr></thead>
              <tbody>{shown.map(p => { const e = edit[p.template_id] || {}; const v = (k: string) => e[k] ?? p[k] ?? ''; const set = (k: string, val: any) => setEdit({ ...edit, [p.template_id]: { ...e, [k]: val } }); return (
                <tr key={p.template_id} className="border-t border-[#EEF0F4]">
                  <td className="px-2 py-1.5"><b>{p.site_templates?.item}</b><div className="text-[11px] text-gray-400">{p.site_templates?.category}</div></td>
                  <td className="px-2"><select value={v('mode')} onChange={x => set('mode', x.target.value)} className={inp}><option value="buy">Buy online</option><option value="quote">Quote</option></select></td>
                  <td className="px-2"><select value={v('origin')} onChange={x => set('origin', x.target.value)} className={inp}><option value="US">USA</option><option value="INTL">Intl</option></select></td>
                  {['base_cost', 'print_cost_per_color', 'plate_cost_per_color', 'moq', 'max_colors'].map(k => <td key={k} className="px-2"><input value={v(k)} onChange={x => set(k, x.target.value)} className={inp + ' w-24'} /></td>)}
                  <td className="px-2">{edit[p.template_id] && <button onClick={() => saveProd(p)} className="text-xs px-2 py-1 rounded bg-[#1b8a3a] text-white">Save</button>}</td>
                </tr>) })}</tbody></table>
          </div>
        </>
      )}
    </div>
  )
}
