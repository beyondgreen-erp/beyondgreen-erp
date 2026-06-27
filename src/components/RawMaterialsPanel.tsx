'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'
import CollapsibleCard from '@/components/CollapsibleCard'

interface Material { sku: string; name: string; uom: string; onHand: number | null; reorder: number | null }
type Status = 'out' | 'low' | 'ok'
function statusOf(m: Material): Status {
  if (m.onHand === null || m.onHand <= 0) return 'out'
  if (m.reorder !== null && m.reorder > 0 && m.onHand <= m.reorder) return 'low'
  return 'ok'
}
const RANK: Record<Status, number> = { out: 0, low: 1, ok: 2 }
function fmtQty(n: number | null) { return n === null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n) }
const STYLE: Record<Status, { bar: string; chip: string; label: string }> = {
  out: { bar: '#DC2626', chip: 'bg-red-100 text-red-700', label: 'OUT' },
  low: { bar: '#F59E0B', chip: 'bg-amber-100 text-amber-700', label: 'LOW' },
  ok:  { bar: '#10B981', chip: 'bg-emerald-50 text-emerald-700', label: 'OK' },
}

export default function RawMaterialsPanel() {
  const sb = useMemo(() => createSupabaseBrowserClient(), [])
  const [materials, setMaterials] = useState<Material[]>([])
  const [loading, setLoading] = useState(true)
  const [editSku, setEditSku] = useState<string | null>(null)
  const [editVal, setEditVal] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    const { data } = await sb.from('products')
      .select('sku,product_name,unit_of_measure,on_hand_qty,reorder_point,product_category,category,is_active,is_discontinued')
      .or('product_category.eq.RAW MATERIAL,category.eq.Raw Material')
    const rows: Material[] = (data || [])
      .filter((p: any) => p.is_active !== false && p.is_discontinued !== true)
      .filter((p: any) => p.product_category !== 'ADDITIVES' && p.category !== 'Additives')
      .map((p: any) => ({
        sku: p.sku, name: p.product_name || p.sku, uom: p.unit_of_measure || '',
        onHand: p.on_hand_qty == null ? null : Number(p.on_hand_qty),
        reorder: p.reorder_point == null ? null : Number(p.reorder_point),
      }))
      .sort((a, b) => (RANK[statusOf(a)] - RANK[statusOf(b)]) || a.name.localeCompare(b.name))
    setMaterials(rows)
    setLoading(false)
  }
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t) }, []) // eslint-disable-line

  function startEdit(m: Material) { setEditSku(m.sku); setEditVal(m.reorder != null ? String(m.reorder) : '') }
  async function saveEdit(sku: string) {
    setSaving(true)
    const val = editVal.trim() === '' ? 0 : Number(editVal)
    await sb.from('products').update({ reorder_point: isNaN(val) ? 0 : val }).eq('sku', sku)
    setMaterials(prev => prev.map(m => m.sku === sku ? { ...m, reorder: isNaN(val) ? 0 : val } : m)
      .sort((a, b) => (RANK[statusOf(a)] - RANK[statusOf(b)]) || a.name.localeCompare(b.name)))
    setEditSku(null); setSaving(false)
  }

  const outCount = materials.filter(m => statusOf(m) === 'out').length
  const lowCount = materials.filter(m => statusOf(m) === 'low').length
  const cleanName = (n: string) => n.length > 42 ? n.slice(0, 41).trimEnd() + '…' : n

  const headerRight = (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-gray-500">{materials.length} tracked</span>
      {outCount > 0 && <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">{outCount} out</span>}
      {lowCount > 0 && <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">{lowCount} low</span>}
      {outCount === 0 && lowCount === 0 && !loading && <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold">All stocked</span>}
    </div>
  )

  return (
    <CollapsibleCard title="Raw Materials" storageKey="raw_materials" headerRight={headerRight}>
      <p className="text-xs text-gray-400 mb-3">Click <span className="font-medium text-gray-500">Warn ≤</span> on any material to set the level where it flags amber.</p>
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-20 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {materials.map(m => {
            const s = statusOf(m); const st = STYLE[s]; const editing = editSku === m.sku
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
                <div className="mt-1 flex items-center justify-between gap-1">
                  <p className="text-[9px] text-gray-400 truncate">{m.sku}</p>
                  {editing ? (
                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      <input autoFocus type="number" value={editVal} onChange={e => setEditVal(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(m.sku); if (e.key === 'Escape') setEditSku(null) }}
                        className="w-14 text-[10px] border border-emerald-400 rounded px-1 py-0.5 focus:outline-none" placeholder="level" />
                      <button onClick={() => saveEdit(m.sku)} disabled={saving} className="text-emerald-600 text-xs font-bold px-1">✓</button>
                      <button onClick={() => setEditSku(null)} className="text-gray-400 text-xs px-0.5">✕</button>
                    </div>
                  ) : (
                    <button onClick={() => startEdit(m)}
                      className={`text-[9px] px-1.5 py-0.5 rounded-full border transition-colors ${m.reorder && m.reorder > 0 ? 'border-amber-200 text-amber-700 bg-amber-50' : 'border-[#E4E6EE] text-gray-400 hover:text-gray-600 hover:border-gray-300'}`}>
                      Warn ≤ {m.reorder && m.reorder > 0 ? fmtQty(m.reorder) : '—'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </CollapsibleCard>
  )
}
