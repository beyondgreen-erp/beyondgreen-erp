'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Material {
  sku: string
  name: string
  uom: string
  onHand: number | null
  reorder: number | null
}

type Status = 'out' | 'low' | 'ok'
function statusOf(m: Material): Status {
  if (m.onHand === null || m.onHand <= 0) return 'out'
  if (m.reorder !== null && m.reorder > 0 && m.onHand <= m.reorder) return 'low'
  return 'ok'
}
const RANK: Record<Status, number> = { out: 0, low: 1, ok: 2 }

function fmtQty(n: number | null) {
  if (n === null) return '—'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n)
}

const STYLE: Record<Status, { bar: string; chip: string; label: string }> = {
  out: { bar: '#DC2626', chip: 'bg-red-100 text-red-700', label: 'OUT' },
  low: { bar: '#F59E0B', chip: 'bg-amber-100 text-amber-700', label: 'LOW' },
  ok:  { bar: '#10B981', chip: 'bg-emerald-50 text-emerald-700', label: 'OK' },
}

export default function RawMaterialsPanel() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [materials, setMaterials] = useState<Material[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    const { data } = await sb.from('products')
      .select('sku,product_name,unit_of_measure,on_hand_qty,reorder_point,product_category,category,is_active,is_discontinued')
      .or('product_category.eq.RAW MATERIAL,category.eq.Raw Material')
    const rows: Material[] = (data || [])
      .filter((p: any) => p.is_active !== false && p.is_discontinued !== true)
      // keep true raw materials, exclude colorant additives
      .filter((p: any) => p.product_category !== 'ADDITIVES' && p.category !== 'Additives')
      .map((p: any) => ({
        sku: p.sku,
        name: p.product_name || p.sku,
        uom: p.unit_of_measure || '',
        onHand: p.on_hand_qty === null || p.on_hand_qty === undefined ? null : Number(p.on_hand_qty),
        reorder: p.reorder_point === null || p.reorder_point === undefined ? null : Number(p.reorder_point),
      }))
      .sort((a, b) => (RANK[statusOf(a)] - RANK[statusOf(b)]) || a.name.localeCompare(b.name))
    setMaterials(rows)
    setLoading(false)
  }

  useEffect(() => {
    load()
    const poll = setInterval(load, 60_000)
    return () => clearInterval(poll)
  }, []) // eslint-disable-line

  const outCount = materials.filter(m => statusOf(m) === 'out').length
  const lowCount = materials.filter(m => statusOf(m) === 'low').length

  function cleanName(name: string) {
    // trim long descriptive suffixes for compact display
    return name.length > 42 ? name.slice(0, 41).trimEnd() + '…' : name
  }

  return (
    <div className="bg-white rounded-2xl border border-[#E4E6EE] p-5 mb-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-[#1A1D2E]">Raw Materials</h2>
          <span className="text-xs text-gray-500">{materials.length} tracked</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {outCount > 0 && <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">{outCount} out of stock</span>}
          {lowCount > 0 && <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">{lowCount} low</span>}
          {outCount === 0 && lowCount === 0 && !loading && <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold">All stocked</span>}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-16 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {materials.map(m => {
            const s = statusOf(m)
            const st = STYLE[s]
            return (
              <div key={m.sku} title={`${m.name} (${m.sku})`}
                className="relative rounded-xl border border-[#E4E6EE] bg-[#FBFCFE] pl-3 pr-2.5 py-2.5 overflow-hidden">
                <span className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: st.bar }} />
                <div className="flex items-start justify-between gap-1">
                  <p className="text-[11px] leading-tight text-gray-600 font-medium">{cleanName(m.name)}</p>
                  <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${st.chip}`}>{st.label}</span>
                </div>
                <div className="mt-1.5 flex items-baseline gap-1">
                  <span className={`text-lg font-bold ${s === 'out' ? 'text-red-600' : 'text-[#1A1D2E]'}`}>{fmtQty(m.onHand)}</span>
                  <span className="text-[10px] text-gray-400">{m.uom}</span>
                </div>
                <p className="text-[9px] text-gray-400 truncate">{m.sku}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
