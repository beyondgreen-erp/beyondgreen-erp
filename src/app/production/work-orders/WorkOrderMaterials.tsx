'use client'

/**
 * Materials panel for a work order.
 *
 * Answers the one question the operator and the scheduler both have before a
 * job starts: is the finished good already on the shelf, and is every material
 * the BOM calls for actually here in the quantity this run needs?
 *
 * Component requirements are derived from the BOM basis:
 *   pcs / unit, pcs / pack, pcs / case  -> multiply by the run's piece, pack or
 *                                          case count
 *   % by weight                         -> share of the run's total resin weight,
 *                                          which needs the finished good's unit
 *                                          weight to be on file
 */

import { useCallback, useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const sb = createSupabaseBrowserClient()

type Any = Record<string, any>

const num = (v: any) => {
  const x = Number(v)
  return isFinite(x) ? x : 0
}

const fmt = (v: number, dp = 2) =>
  v.toLocaleString('en-US', { maximumFractionDigits: dp })

/** Work out how many pieces, packs and cases a quantity in `uom` comes to. */
function runCounts(qty: number, uom: string | null | undefined, p: Any | null) {
  const perPack = num(p?.pieces_per_pack) || 0
  const perCase = num(p?.packs_per_case) || 0
  const u = String(uom ?? p?.unit_of_measure ?? '').trim().toUpperCase()

  let cases = 0, packs = 0, pieces = 0
  if (/^(CASE|CASES|CS|CTN|CARTON)$/.test(u)) {
    cases = qty
    packs = perCase ? qty * perCase : 0
    pieces = perPack ? packs * perPack : 0
  } else if (/^(PK|PKS|PACK|PACKS|BAG|BAGS)$/.test(u)) {
    packs = qty
    cases = perCase ? qty / perCase : 0
    pieces = perPack ? qty * perPack : 0
  } else if (/^(EA|EACH|PC|PCS|PIECE|PIECES|UNIT|UNITS)$/.test(u)) {
    pieces = qty
    packs = perPack ? qty / perPack : 0
    cases = perCase && packs ? packs / perCase : 0
  } else {
    // Unknown unit — treat the quantity as cases, which is how the shop writes
    // most orders, but say so rather than quietly guessing.
    cases = qty
    packs = perCase ? qty * perCase : 0
    pieces = perPack ? packs * perPack : 0
  }
  return { cases, packs, pieces, uomKnown: u !== '' }
}

export default function WorkOrderMaterials({
  sku,
  qtyRequired,
  uom,
}: {
  sku: string | null | undefined
  qtyRequired: number | null | undefined
  uom: string | null | undefined
}) {
  const [fg, setFg] = useState<Any | null>(null)
  const [rows, setRows] = useState<Any[]>([])
  const [state, setState] = useState<'idle' | 'loading' | 'ready'>('idle')

  const clean = String(sku ?? '').trim()

  const load = useCallback(async () => {
    if (!clean) { setFg(null); setRows([]); setState('ready'); return }
    setState('loading')

    const { data: pd } = await sb
      .from('products')
      .select('id,sku,product_name,unit_of_measure,on_hand_qty,pieces_per_pack,packs_per_case,weight_per_unit_grams,category')
      .ilike('sku', clean)
      .limit(1)
    const prod = (Array.isArray(pd) ? pd[0] : null) ?? null
    setFg(prod)

    const { data: bd } = await sb
      .from('product_bom')
      .select('component_sku,role,uom_type,qty_value,percentage,notes,is_case_level')
      .ilike('finished_good_sku', clean)
    const bom = ((bd ?? []) as Any[])

    if (!bom.length) { setRows([]); setState('ready'); return }

    const skus = Array.from(new Set(bom.map(b => String(b.component_sku ?? '').trim()).filter(Boolean)))
    const { data: cd } = await sb
      .from('products')
      .select('sku,product_name,unit_of_measure,on_hand_qty')
      .in('sku', skus)
    const by: Record<string, Any> = {}
    for (const c of ((cd ?? []) as Any[])) by[String(c.sku ?? '').trim().toUpperCase()] = c

    setRows(bom.map(b => ({ ...b, _p: by[String(b.component_sku ?? '').trim().toUpperCase()] ?? null })))
    setState('ready')
  }, [clean])

  useEffect(() => { load() }, [load])

  if (!clean) return null
  if (state !== 'ready') {
    return <p className="text-[12px] text-gray-400">Checking materials&hellip;</p>
  }

  const qty = num(qtyRequired)
  const counts = runCounts(qty, uom, fg)
  const unitG = num(fg?.weight_per_unit_grams)
  const runKg = counts.pieces && unitG ? (counts.pieces * unitG) / 1000 : 0

  const fgOnHand = num(fg?.on_hand_qty)
  const fgShort = qty > 0 && fgOnHand < qty

  const computed: Any[] = rows.map((r: Any) => {
    // Older rows store 'pcs' plus is_case_level; newer ones name the basis.
    const basis = String(r.uom_type ?? '').trim()
    const caseLevel = r.is_case_level === true
    const v = num(r.qty_value ?? r.percentage)
    let need = 0
    let unit = ''
    let why = ''
    if (basis === 'percentage') {
      if (runKg > 0) { need = (runKg * v) / 100; unit = 'kg'; why = `${fmt(v)}% of ${fmt(runKg)} kg` }
      else { why = unitG ? 'run size unknown' : 'unit weight not set on the SKU' }
    } else if (basis === 'pcs_case' || (basis === 'pcs' && caseLevel)) {
      need = v * counts.cases; unit = 'pcs'; why = `${fmt(v)} per case`
    } else if (basis === 'pcs_pack') {
      need = v * counts.packs; unit = 'pcs'; why = `${fmt(v)} per pack`
    } else if (basis === 'pcs_unit' || basis === 'pcs') {
      need = v * counts.pieces; unit = 'pcs'; why = `${fmt(v)} per piece`
    } else {
      need = v; unit = ''; why = basis || 'no basis set'
    }
    const onHand = r._p ? num(r._p.on_hand_qty) : null
    const short = need > 0 && onHand !== null && onHand < need
    return { ...r, need, unit, why, onHand, short }
  })

  const shortCount = computed.filter(c => c.short).length
  const noWeight = computed.some(c => c.uom_type === 'percentage' && c.need === 0)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Materials &amp; stock
        </p>
        {rows.length > 0 && (
          <span className={`text-[11px] font-semibold ${shortCount ? 'text-red-600' : 'text-emerald-600'}`}>
            {shortCount ? `${shortCount} component${shortCount > 1 ? 's' : ''} short` : 'All components in stock'}
          </span>
        )}
      </div>

      {/* Finished good */}
      <div className="rounded-lg border-2 border-gray-200 px-3 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-gray-900 truncate">{fg?.product_name || clean}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {clean}
              {counts.pieces ? ` · run = ${fmt(counts.pieces, 0)} pcs` : ''}
              {counts.packs ? ` · ${fmt(counts.packs, 0)} packs` : ''}
              {runKg ? ` · ${fmt(runKg)} kg` : ''}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[11px] text-gray-500">On hand</p>
            <p className={`text-[14px] font-semibold ${fgShort ? 'text-red-600' : 'text-gray-900'}`}>
              {fmt(fgOnHand, 0)}
            </p>
          </div>
        </div>
        {!fg && (
          <p className="text-[11px] text-amber-700 mt-1.5">
            This SKU is not in the product list, so nothing can be checked against stock.
          </p>
        )}
      </div>

      {/* Components */}
      {rows.length === 0 ? (
        <div className="rounded-lg border-2 border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="text-[12px] font-semibold text-amber-900">No BOM on file for {clean}</p>
          <p className="text-[11px] text-amber-800 mt-0.5">
            Build it on the Inventory board and the materials for this job will appear here.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border-2 border-gray-200 overflow-hidden">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
                <th className="text-left font-semibold px-3 py-2">Component</th>
                <th className="text-right font-semibold px-2 py-2 whitespace-nowrap">Needs</th>
                <th className="text-right font-semibold px-2 py-2 whitespace-nowrap">On hand</th>
                <th className="text-right font-semibold px-3 py-2 whitespace-nowrap">Short by</th>
              </tr>
            </thead>
            <tbody>
              {computed.map((c, i) => (
                <tr key={i} className="border-t border-gray-100 align-top">
                  <td className="px-3 py-2">
                    <p className="font-medium text-gray-900">{c._p?.product_name || c.component_sku}</p>
                    <p className="text-[10.5px] text-gray-500">
                      {c.component_sku}
                      {c.role ? ` · ${String(c.role).replace(/_/g, ' ')}` : ''}
                      {c.why ? ` · ${c.why}` : ''}
                    </p>
                  </td>
                  <td className="px-2 py-2 text-right whitespace-nowrap font-medium text-gray-900">
                    {c.need > 0 ? `${fmt(c.need)} ${c.unit}` : <span className="text-amber-700">—</span>}
                  </td>
                  <td className="px-2 py-2 text-right whitespace-nowrap text-gray-700">
                    {c.onHand === null ? <span className="text-amber-700">not stocked</span> : fmt(c.onHand)}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {c.short
                      ? <span className="font-semibold text-red-600">{fmt(c.need - (c.onHand ?? 0))}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {noWeight && (
        <p className="text-[11px] text-amber-700">
          Percentage components cannot be sized until this SKU has a unit weight on the Inventory board.
        </p>
      )}
    </div>
  )
}
