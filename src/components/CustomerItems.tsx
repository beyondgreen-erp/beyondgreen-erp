'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const sb = createSupabaseBrowserClient()

/**
 * Items a customer buys, linked to the inventory board.
 *
 * Rows live in customer_products. The QuickBooks history (through Jul 25, 2026) sits in the
 * qb_* columns; everything the ERP has ordered since is kept current in the erp_* columns by
 * a trigger on sales_order_lines. The total_* columns add the two together. A row with no
 * product_id is a QuickBooks item we could not match to a SKU; the team can link it here.
 */
type Row = {
  id: string
  customer_id: string
  product_id: string | null
  item_code: string | null
  item_description: string | null
  uom: string | null
  total_qty: number
  total_revenue: number
  qb_qty: number
  qb_revenue: number
  qb_invoice_count: number
  erp_qty: number
  erp_revenue: number
  erp_order_count: number
  first_purchase_date: string | null
  last_purchase_date: string | null
  last_unit_price: number | null
  source: string
  notes: string | null
  product: { id: string; sku: string; product_name: string; on_hand_qty: number | null; unit_price: number | null; product_category: string | null; product_image_url: string | null } | null
}

type ProductHit = { id: string; sku: string; product_name: string; on_hand_qty: number | null; unit_price: number | null }

const fmt$ = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const fmt$2 = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtN = (n: number | null | undefined) => n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
const fmtD = (d: string | null | undefined) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

type SortKey = 'revenue' | 'qty' | 'last' | 'name'

export default function CustomerItems({ customerId, currentUserEmail }: { customerId: string; currentUserEmail?: string | null }) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<SortKey>('revenue')
  const [showUnlinkedOnly, setShowUnlinkedOnly] = useState(false)
  const [linking, setLinking] = useState<Row | null>(null)
  const [adding, setAdding] = useState(false)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<ProductHit[]>([])
  const [searching, setSearching] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await sb
      .from('customer_products')
      .select('*, product:products(id, sku, product_name, on_hand_qty, unit_price, product_category, product_image_url)')
      .eq('customer_id', customerId)
    setRows((data as any[] | null)?.map(r => ({ ...r, total_qty: Number(r.total_qty ?? 0), total_revenue: Number(r.total_revenue ?? 0), qb_qty: Number(r.qb_qty ?? 0), qb_revenue: Number(r.qb_revenue ?? 0), erp_qty: Number(r.erp_qty ?? 0), erp_revenue: Number(r.erp_revenue ?? 0) })) ?? [])
    setLoading(false)
  }, [customerId])

  useEffect(() => { load() }, [load])

  // Product search for linking an unmatched item or adding a new one
  useEffect(() => {
    if (!linking && !adding) return
    const term = q.trim()
    if (term.length < 2) { setHits([]); return }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(async () => {
      const { data } = await sb
        .from('products')
        .select('id, sku, product_name, on_hand_qty, unit_price')
        .or(`sku.ilike.%${term}%,product_name.ilike.%${term}%`)
        .order('sku')
        .limit(15)
      if (!cancelled) { setHits((data as ProductHit[]) ?? []); setSearching(false) }
    }, 200)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q, linking, adding])

  const sorted = useMemo(() => {
    const list = showUnlinkedOnly ? rows.filter(r => !r.product_id) : rows
    return [...list].sort((a, b) => {
      if (sort === 'revenue') return b.total_revenue - a.total_revenue
      if (sort === 'qty') return b.total_qty - a.total_qty
      if (sort === 'last') return (b.last_purchase_date ?? '').localeCompare(a.last_purchase_date ?? '')
      const an = a.product?.product_name ?? a.item_description ?? a.item_code ?? ''
      const bn = b.product?.product_name ?? b.item_description ?? b.item_code ?? ''
      return an.localeCompare(bn)
    })
  }, [rows, sort, showUnlinkedOnly])

  const totals = useMemo(() => ({
    items: rows.length,
    linked: rows.filter(r => r.product_id).length,
    revenue: rows.reduce((s, r) => s + r.total_revenue, 0),
    erpRevenue: rows.reduce((s, r) => s + r.erp_revenue, 0),
  }), [rows])

  async function linkToProduct(row: Row, p: ProductHit) {
    setMsg('')
    // If this customer already has a row for that product, fold the QuickBooks figures into it
    const existing = rows.find(r => r.product_id === p.id && r.id !== row.id)
    if (existing) {
      const { error } = await sb.from('customer_products').update({
        qb_qty: existing.qb_qty + row.qb_qty,
        qb_revenue: existing.qb_revenue + row.qb_revenue,
        qb_invoice_count: (existing.qb_invoice_count ?? 0) + (row.qb_invoice_count ?? 0),
        qb_first_date: [existing.first_purchase_date, row.first_purchase_date].filter(Boolean).sort()[0] ?? null,
        qb_last_date: [existing.last_purchase_date, row.last_purchase_date].filter(Boolean).sort().reverse()[0] ?? null,
        notes: [existing.notes, `Merged QuickBooks item "${row.item_code}" on ${new Date().toISOString().slice(0, 10)}${currentUserEmail ? ' by ' + currentUserEmail : ''}`].filter(Boolean).join('\n'),
      }).eq('id', existing.id)
      if (!error) await sb.from('customer_products').delete().eq('id', row.id)
      if (error) setMsg(error.message)
    } else {
      const { error } = await sb.from('customer_products').update({
        product_id: p.id,
        notes: [row.notes, `Linked to ${p.sku} on ${new Date().toISOString().slice(0, 10)}${currentUserEmail ? ' by ' + currentUserEmail : ''} (QuickBooks item "${row.item_code}")`].filter(Boolean).join('\n'),
      }).eq('id', row.id)
      if (error) setMsg(error.message)
    }
    setLinking(null); setQ(''); setHits([])
    await load()
  }

  async function addProduct(p: ProductHit) {
    setMsg('')
    if (rows.some(r => r.product_id === p.id)) { setMsg(`${p.sku} is already on this customer.`); setAdding(false); setQ(''); return }
    const { error } = await sb.from('customer_products').insert({
      customer_id: customerId, product_id: p.id, item_code: p.sku, item_description: p.product_name,
      source: 'manual', notes: `Added manually on ${new Date().toISOString().slice(0, 10)}${currentUserEmail ? ' by ' + currentUserEmail : ''}`,
    })
    if (error) setMsg(error.message)
    setAdding(false); setQ(''); setHits([])
    await load()
  }

  async function removeRow(row: Row) {
    if (!confirm(`Remove "${row.product?.sku ?? row.item_code}" from this customer's items? Purchase history for it will be lost.`)) return
    const { error } = await sb.from('customer_products').delete().eq('id', row.id)
    if (error) setMsg(error.message)
    await load()
  }

  const picker = (onPick: (p: ProductHit) => void, title: string, onClose: () => void) => (
    <div className="border border-blue-200 bg-blue-50/40 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-[#1A1D2E]">{title}</p>
        <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
      </div>
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search inventory by SKU or name…" className="w-full bg-white border border-[#E4E6EE] text-[#1A1D2E] rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
      {searching && <p className="text-xs text-gray-400">Searching…</p>}
      {!searching && q.trim().length >= 2 && hits.length === 0 && <p className="text-xs text-gray-500 italic">No inventory item matches. <Link href="/sales/inventory" className="text-[#3B6FE0] hover:underline">Add it to inventory →</Link></p>}
      {hits.length > 0 && (
        <ul className="max-h-56 overflow-y-auto divide-y divide-[#E4E6EE] bg-white rounded-lg border border-[#E4E6EE]">
          {hits.map(h => (
            <li key={h.id}>
              <button onClick={() => onPick(h)} className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="text-xs font-mono font-semibold text-[#1A1D2E]">{h.sku}</span>
                  <span className="block text-xs text-gray-500 truncate">{h.product_name}</span>
                </span>
                <span className="text-xs text-gray-400 shrink-0">{h.on_hand_qty != null ? `${fmtN(h.on_hand_qty)} on hand` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="grid grid-cols-4 gap-px bg-[#F9FAFB] rounded-lg overflow-hidden border border-[#E4E6EE]">
        <div className="bg-white px-4 py-2.5"><p className="text-xs text-gray-500">Items</p><p className="text-sm font-semibold text-[#1A1D2E] mt-0.5">{totals.items}</p></div>
        <div className="bg-white px-4 py-2.5"><p className="text-xs text-gray-500">Linked to Inventory</p><p className={`text-sm font-semibold mt-0.5 ${totals.linked === totals.items ? 'text-emerald-500' : 'text-amber-500'}`}>{totals.linked} / {totals.items}</p></div>
        <div className="bg-white px-4 py-2.5"><p className="text-xs text-gray-500">Item Revenue (all time)</p><p className="text-sm font-semibold text-emerald-500 mt-0.5">{fmt$(totals.revenue)}</p></div>
        <div className="bg-white px-4 py-2.5"><p className="text-xs text-gray-500">Since QuickBooks Cutover</p><p className="text-sm font-semibold text-blue-500 mt-0.5">{fmt$(totals.erpRevenue)}</p></div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-500">Sort</span>
          {(['revenue', 'qty', 'last', 'name'] as SortKey[]).map(k => (
            <button key={k} onClick={() => setSort(k)} className={`px-2.5 py-1 rounded-md border transition-colors ${sort === k ? 'bg-[#1A1D2E] text-white border-[#1A1D2E]' : 'bg-white text-gray-600 border-[#E4E6EE] hover:border-gray-300'}`}>
              {k === 'revenue' ? 'Revenue' : k === 'qty' ? 'Quantity' : k === 'last' ? 'Last Bought' : 'Name'}
            </button>
          ))}
          {totals.linked < totals.items && (
            <label className="flex items-center gap-1.5 ml-2 cursor-pointer select-none text-amber-600">
              <input type="checkbox" checked={showUnlinkedOnly} onChange={e => setShowUnlinkedOnly(e.target.checked)} className="w-3.5 h-3.5 rounded" />
              Unlinked only ({totals.items - totals.linked})
            </label>
          )}
        </div>
        <button onClick={() => { setAdding(true); setLinking(null); setQ('') }} className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors">+ Add Item</button>
      </div>

      {msg && <p className="text-xs text-red-500">{msg}</p>}
      {adding && picker(addProduct, 'Add an inventory item this customer buys', () => { setAdding(false); setQ('') })}

      {/* Table */}
      {loading ? (
        <p className="text-sm text-gray-400">Loading items…</p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-gray-500 italic">{showUnlinkedOnly ? 'Every item is linked to inventory.' : 'No purchase history on file yet. Items appear here automatically when a sales order is entered, or add one above.'}</p>
      ) : (
        <div className="border border-[#E4E6EE] rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-[#F9FAFB] text-gray-500">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Item</th>
                <th className="text-right px-3 py-2 font-medium">Qty</th>
                <th className="text-right px-3 py-2 font-medium">Revenue</th>
                <th className="text-right px-3 py-2 font-medium">Last Price</th>
                <th className="text-left px-3 py-2 font-medium">First</th>
                <th className="text-left px-3 py-2 font-medium">Last</th>
                <th className="text-right px-3 py-2 font-medium">On Hand</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4E6EE]">
              {sorted.map(r => {
                const name = r.product?.product_name ?? r.item_description ?? r.item_code ?? '—'
                const sku = r.product?.sku ?? r.item_code
                return (
                  <Fragment key={r.id}>
                    <tr className="bg-white hover:bg-[#F9FAFB] align-top">
                      <td className="px-3 py-2 max-w-[22rem]">
                        <div className="flex items-start gap-2">
                          {r.product?.product_image_url
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={r.product.product_image_url} alt="" className="w-8 h-8 rounded object-cover border border-[#E4E6EE] shrink-0" />
                            : <div className={`w-8 h-8 rounded border shrink-0 flex items-center justify-center text-[10px] font-semibold ${r.product_id ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 'bg-amber-50 border-amber-100 text-amber-600'}`}>{r.product_id ? 'INV' : '?'}</div>}
                          <div className="min-w-0">
                            {r.product_id ? (
                              <Link href={`/sales/inventory?item=${r.product_id}`} className="font-mono font-semibold text-[#3B6FE0] hover:underline">{sku}</Link>
                            ) : (
                              <span className="font-mono font-semibold text-gray-700">{sku}</span>
                            )}
                            <p className="text-gray-500 truncate" title={name}>{name}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {!r.product_id && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-100">Not in inventory</span>}
                              {r.erp_order_count > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100">{r.erp_order_count} ERP order{r.erp_order_count === 1 ? '' : 's'}</span>}
                              {r.qb_invoice_count > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-50 text-gray-500 border border-gray-200">{r.qb_invoice_count} QB invoice{r.qb_invoice_count === 1 ? '' : 's'}</span>}
                              {r.source === 'manual' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 border border-purple-100">Manual</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-[#1A1D2E]">{fmtN(r.total_qty)}{r.uom ? <span className="text-gray-400 ml-1">{r.uom}</span> : null}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-600 font-medium">{fmt$2(r.total_revenue)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600">{r.last_unit_price != null ? fmt$2(r.last_unit_price) : '—'}</td>
                      <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{fmtD(r.first_purchase_date)}</td>
                      <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{fmtD(r.last_purchase_date)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600">{r.product ? fmtN(r.product.on_hand_qty) : '—'}</td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        {!r.product_id && <button onClick={() => { setLinking(r); setAdding(false); setQ(r.item_code ?? '') }} className="text-[#3B6FE0] hover:underline mr-2">Link</button>}
                        <button onClick={() => removeRow(r)} className="text-gray-400 hover:text-red-500" title="Remove">✕</button>
                      </td>
                    </tr>
                    {linking?.id === r.id && (
                      <tr className="bg-white"><td colSpan={8} className="px-3 pb-3">{picker(p => linkToProduct(r, p), `Link "${r.item_code}" to an inventory item`, () => { setLinking(null); setQ('') })}</td></tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-gray-400">Quantities and revenue combine QuickBooks history through Jul 25, 2026 with ERP sales orders entered since. Linked items open on the Inventory board.</p>
    </div>
  )
}
