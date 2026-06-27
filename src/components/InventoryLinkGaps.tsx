'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import CollapsibleCard from '@/components/CollapsibleCard'

type TableKind = 'sales' | 'po'
interface Gap { sales: number; po: number; salesSkus: string[]; poSkus: string[] }
interface Prod { id: string; sku: string; name: string; onHand: number | null; uom: string }

export default function InventoryLinkGaps() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [gap, setGap] = useState<Gap | null>(null)
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState<{ sku: string; table: TableKind } | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Prod[]>([])
  const [linking, setLinking] = useState(false)
  const [done, setDone] = useState<string[]>([])

  async function load() {
    const [sc, pc, sr, pr] = await Promise.all([
      sb.from('sales_order_lines').select('id', { count: 'exact', head: true }).is('product_id', null),
      sb.from('purchase_order_lines').select('id', { count: 'exact', head: true }).is('product_id', null),
      sb.from('sales_order_lines').select('sku').is('product_id', null).not('sku', 'is', null).limit(1000),
      sb.from('purchase_order_lines').select('sku').is('product_id', null).not('sku', 'is', null).limit(1000),
    ])
    const distinct = (rows: any) => Array.from(new Set(((rows.data || []) as any[]).map(r => (r.sku || '').trim()).filter(Boolean))).sort()
    setGap({ sales: sc.count || 0, po: pc.count || 0, salesSkus: distinct(sr), poSkus: distinct(pr) })
    setLoading(false)
  }
  useEffect(() => { load() }, []) // eslint-disable-line

  // product search when a SKU is selected
  useEffect(() => {
    if (!sel) { setResults([]); return }
    let active = true
    const run = async () => {
      let q = sb.from('products').select('id,sku,product_name,on_hand_qty,unit_of_measure').limit(8)
      const term = query.trim()
      q = term ? q.or(`sku.ilike.%${term}%,product_name.ilike.%${term}%`) : q.ilike('sku', `%${sel.sku}%`)
      const { data } = await q
      if (!active) return
      setResults((data || []).map((p: any) => ({ id: p.id, sku: p.sku, name: p.product_name || p.sku, onHand: p.on_hand_qty == null ? null : Number(p.on_hand_qty), uom: p.unit_of_measure || '' })))
    }
    run()
    return () => { active = false }
  }, [sel, query]) // eslint-disable-line

  function pick(sku: string, table: TableKind) {
    if (sel && sel.sku === sku && sel.table === table) { setSel(null); return }
    setSel({ sku, table }); setQuery('')
  }

  async function linkTo(prod: Prod) {
    if (!sel) return
    setLinking(true)
    const tbl = sel.table === 'sales' ? 'sales_order_lines' : 'purchase_order_lines'
    await sb.from(tbl).update({ product_id: prod.id, sku_flagged: false }).eq('sku', sel.sku).is('product_id', null)
    setDone(d => [...d, sel.table + ':' + sel.sku])
    setSel(null); setLinking(false)
    load()
  }

  if (loading || !gap) return null
  const total = gap.sales + gap.po
  if (total === 0) return null

  const headerRight = <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold text-xs">{total} need linking</span>

  function SkuChips({ label, skus, table, href }: { label: string; skus: string[]; table: TableKind; href: string }) {
    const remaining = skus.filter(s => !done.includes(table + ':' + s))
    if (remaining.length === 0) return null
    return (
      <div className="mt-4">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs font-semibold text-gray-600">{label} — {remaining.length} unmatched SKU{remaining.length === 1 ? '' : 's'}</p>
          <Link href={href} className="text-xs text-[#3B6FE0] font-semibold hover:underline">Open list →</Link>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {remaining.slice(0, 60).map(s => {
            const active = sel && sel.sku === s && sel.table === table
            return (
              <button key={s} onClick={() => pick(s, table)}
                className={`text-[11px] font-mono rounded px-1.5 py-0.5 border transition-colors ${active ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-[#F5F6FA] border-[#E4E6EE] text-gray-600 hover:border-emerald-400 hover:text-emerald-700'}`}>
                {s}
              </button>
            )
          })}
          {remaining.length > 60 && <span className="text-[11px] text-gray-400 px-1">+{remaining.length - 60} more</span>}
        </div>
      </div>
    )
  }

  return (
    <CollapsibleCard title="Inventory Link Gaps" storageKey="inventory_link_gaps" headerRight={headerRight} defaultCollapsed>
      <p className="text-sm text-gray-600">
        These order lines aren&apos;t linked to an inventory product, so stock won&apos;t track against them.
        <span className="font-medium text-gray-700"> Click an SKU below, then pick the matching inventory product to link every line with that SKU.</span>
      </p>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <div className="rounded-xl border border-[#E4E6EE] bg-[#FBFCFE] p-3">
          <p className="text-2xl font-bold text-amber-600">{gap.sales}</p>
          <p className="text-xs text-gray-500">sales order lines unlinked</p>
        </div>
        <div className="rounded-xl border border-[#E4E6EE] bg-[#FBFCFE] p-3">
          <p className="text-2xl font-bold text-amber-600">{gap.po}</p>
          <p className="text-xs text-gray-500">purchase order lines unlinked</p>
        </div>
      </div>

      {sel && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-gray-700">Link <span className="font-mono font-semibold">{sel.sku}</span> ({sel.table === 'sales' ? 'Sales' : 'Purchase'}) to an inventory product:</p>
            <button onClick={() => setSel(null)} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
          </div>
          <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search inventory by SKU or name…"
            className="w-full rounded-lg border border-[#E4E6EE] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          <div className="mt-2 max-h-56 overflow-y-auto divide-y divide-[#EEF0F4] rounded-lg border border-[#E4E6EE] bg-white">
            {results.length === 0 && (
              <div className="p-3 text-sm text-gray-500">
                No matching product. <Link href="/sales/inventory" className="text-[#3B6FE0] font-medium hover:underline">Add it to inventory →</Link>
              </div>
            )}
            {results.map(p => (
              <button key={p.id} disabled={linking} onClick={() => linkTo(p)}
                className="w-full text-left px-3 py-2 hover:bg-emerald-50 flex items-center justify-between gap-2 disabled:opacity-50">
                <div className="min-w-0">
                  <p className="text-sm text-[#1A1D2E] truncate">{p.name}</p>
                  <p className="text-[11px] font-mono text-gray-400">{p.sku}</p>
                </div>
                <span className="text-xs text-gray-500 shrink-0">{p.onHand == null ? '' : `${new Intl.NumberFormat('en-US').format(p.onHand)} ${p.uom}`}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <SkuChips label="Sales Orders" skus={gap.salesSkus} table="sales" href="/sales/orders" />
      <SkuChips label="Purchase Orders" skus={gap.poSkus} table="po" href="/sales/purchase-orders" />
    </CollapsibleCard>
  )
}
