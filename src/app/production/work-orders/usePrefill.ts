'use client'

/**
 * Fills the work order sheet from what the ERP already knows.
 *
 * The sheets started life as a typed copy of the paper forms, so the shop was
 * re-entering bag dimensions, colours and the resin blend by hand on every job
 * even though the item record and the BOM already hold them. Anything this
 * returns is rendered read only on the sheet and marked with where it came
 * from; the operator is left with the things that genuinely change per run —
 * lot numbers, roller size, machine, group, schedule, operator and run hours.
 *
 * A field is only claimed when there is a real value behind it. Where the item
 * record is still blank the sheet keeps the ordinary input, so a spec can still
 * be captured for the SKUs that have not been filled in yet.
 */

import { useCallback, useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const sb = createSupabaseBrowserClient()

type Any = Record<string, any>

export type Pulled = Record<string, { value: any; from: string }>

const FROM_ITEM = 'from item'
const FROM_BOM = 'from BOM'

const has = (v: any) => v !== null && v !== undefined && String(v).trim() !== '' && String(v).trim() !== '0'

const numOr0 = (v: any) => {
  const x = Number(v)
  return isFinite(x) ? x : 0
}

/** Pieces in the run, from the ordered quantity and the pack/case breakdown. */
function piecesInRun(qty: number, uom: string | null | undefined, p: Any | null) {
  const perPack = numOr0(p?.pieces_per_pack)
  const perCase = numOr0(p?.packs_per_case)
  const u = String(uom ?? p?.unit_of_measure ?? '').trim().toUpperCase()
  if (/^(EA|EACH|PC|PCS|PIECE|PIECES|UNIT|UNITS)$/.test(u)) return qty
  if (/^(PK|PKS|PACK|PACKS|BAG|BAGS)$/.test(u)) return perPack ? qty * perPack : 0
  // Anything else is treated as cases, which is how most orders are written.
  return perPack && perCase ? qty * perCase * perPack : 0
}

export function usePrefill(
  sku: string | null | undefined,
  qty: number | null | undefined,
  uom: string | null | undefined,
) {
  const [pulled, setPulled] = useState<Pulled>({})
  const clean = String(sku ?? '').trim()
  const q = numOr0(qty)

  const load = useCallback(async () => {
    if (!clean) { setPulled({}); return }

    const [{ data: pd }, { data: bd }] = await Promise.all([
      sb.from('products')
        .select('sku,product_name,unit_of_measure,pieces_per_pack,packs_per_case,case_size,cases_per_pallet,pallet_ti_hi,product_color,print_color,product_thickness,product_size,bag_width_in,bag_length_in,weight_per_unit_grams,special_instructions')
        .ilike('sku', clean).limit(1),
      sb.from('product_bom')
        .select('component_sku,role,uom_type,qty_value,percentage,is_case_level')
        .ilike('finished_good_sku', clean),
    ])

    const p: Any | null = (Array.isArray(pd) ? pd[0] : null) ?? null
    const bom: Any[] = ((bd ?? []) as Any[])

    const out: Pulled = {}
    const put = (key: string, value: any, from: string) => {
      if (has(value)) out[key] = { value, from }
    }

    if (p) {
      put('item_part_number', p.sku, FROM_ITEM)
      put('uom', p.unit_of_measure, FROM_ITEM)
      put('bag_width_in', p.bag_width_in, FROM_ITEM)
      put('bag_length_in', p.bag_length_in, FROM_ITEM)
      put('bag_thickness_um', p.product_thickness, FROM_ITEM)
      put('bag_weight_g', p.weight_per_unit_grams, FROM_ITEM)
      put('bag_color', p.product_color, FROM_ITEM)
      put('straw_color', p.product_color, FROM_ITEM)
      put('ink_color', p.print_color, FROM_ITEM)
      put('print_color', p.print_color, FROM_ITEM)
      put('packs_per_case', p.packs_per_case, FROM_ITEM)
      put('case_size_in', p.case_size, FROM_ITEM)
      put('cases_per_pallet', p.cases_per_pallet, FROM_ITEM)
      put('pallet_size', p.pallet_ti_hi, FROM_ITEM)
      put('special_instructions', p.special_instructions, FROM_ITEM)

      const pieces = piecesInRun(q, uom, p)
      put('bags_needed', pieces || '', FROM_ITEM)
      put('straw_quantity', pieces || '', FROM_ITEM)
    }

    if (bom.length) {
      const role = (r: Any) => String(r.role ?? '').trim().toLowerCase()
      const byRole = (name: string) => bom.filter(r => role(r) === name)

      // Legacy rows have no role. Percentage rows are the blend, so they stand
      // in for the materials when nothing is labelled.
      let materials = byRole('rm')
      if (!materials.length) {
        materials = bom.filter(r => String(r.uom_type ?? '') === 'percentage' && !role(r))
      }
      materials.slice(0, 3).forEach((r, i) => {
        const n = i + 1
        put(`material_${n}_type`, r.component_sku, FROM_BOM)
        put(`material_${n}`, r.component_sku, FROM_BOM)
        put(`material_${n}_pct`, r.qty_value ?? r.percentage, FROM_BOM)
      })

      const colour = byRole('color')[0]
      if (colour) {
        put('color_type', colour.component_sku, FROM_BOM)
        put('color_material', colour.component_sku, FROM_BOM)
        put('color_material_type', colour.component_sku, FROM_BOM)
        put('color_pct', colour.qty_value ?? colour.percentage, FROM_BOM)
        // The extrusion and straw calculators read color_material_pct.
        put('color_material_pct', colour.qty_value ?? colour.percentage, FROM_BOM)
      }

      const plate = byRole('print_plate')[0]
      if (plate) put('print_plate', plate.component_sku, FROM_BOM)

      const pack = byRole('pack')[0]
      if (pack) put('packaging_part_number', pack.component_sku, FROM_BOM)

      const label = byRole('label')[0]
      if (label) put('label_part_number', label.component_sku, FROM_BOM)

      const core = byRole('paper_core')[0]
      if (core) put('core', core.component_sku, FROM_BOM)
    }

    setPulled(out)
  }, [clean, q, uom])

  useEffect(() => { load() }, [load])

  return pulled
}
