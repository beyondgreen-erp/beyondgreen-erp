'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import CollapsibleCard from '@/components/CollapsibleCard'

interface Gap { sales: number; po: number; salesSkus: string[]; poSkus: string[] }

export default function InventoryLinkGaps() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [gap, setGap] = useState<Gap | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    const [salesCount, poCount, salesRows, poRows] = await Promise.all([
      sb.from('sales_order_lines').select('id', { count: 'exact', head: true }).is('product_id', null),
      sb.from('purchase_order_lines').select('id', { count: 'exact', head: true }).is('product_id', null),
      sb.from('sales_order_lines').select('sku').is('product_id', null).not('sku', 'is', null).limit(1000),
      sb.from('purchase_order_lines').select('sku').is('product_id', null).not('sku', 'is', null).limit(1000),
    ])
    const distinct = (rows: any) => Array.from(new Set(((rows.data || []) as any[]).map(r => (r.sku || '').trim()).filter(Boolean))).sort()
    setGap({
      sales: salesCount.count || 0,
      po: poCount.count || 0,
      salesSkus: distinct(salesRows),
      poSkus: distinct(poRows),
    })
    setLoading(false)
  }

  useEffect(() => { load(); const t = setInterval(load, 120_000); return () => clearInterval(t) }, []) // eslint-disable-line

  if (loading || !gap) return null
  const total = gap.sales + gap.po
  if (total === 0) return null

  const headerRight = (
    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold text-xs">{total} need linking</span>
  )

  function SkuList({ label, skus, href }: { label: string; skus: string[]; href: string }) {
    if (skus.length === 0) return null
    return (
      <div className="mt-3">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs font-semibold text-gray-600">{label} — {skus.length} unmatched SKU{skus.length === 1 ? '' : 's'}</p>
          <Link href={href} className="text-xs text-[#3B6FE0] font-semibold hover:underline">Open →</Link>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {skus.slice(0, 40).map(s => (
            <span key={s} className="text-[11px] font-mono bg-[#F5F6FA] border border-[#E4E6EE] text-gray-600 rounded px-1.5 py-0.5">{s}</span>
          ))}
          {skus.length > 40 && <span className="text-[11px] text-gray-400 px-1">+{skus.length - 40} more</span>}
        </div>
      </div>
    )
  }

  return (
    <CollapsibleCard title="Inventory Link Gaps" storageKey="inventory_link_gaps" headerRight={headerRight} defaultCollapsed>
      <p className="text-sm text-gray-600">
        These order lines aren&apos;t linked to an inventory product, so stock won&apos;t track against them. The SKU didn&apos;t match a product —
        add the SKU to inventory or correct it on the line to link them.
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
      <SkuList label="Sales Orders" skus={gap.salesSkus} href="/sales/orders" />
      <SkuList label="Purchase Orders" skus={gap.poSkus} href="/sales/purchase-orders" />
    </CollapsibleCard>
  )
}
