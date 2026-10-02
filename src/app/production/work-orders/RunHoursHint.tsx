'use client'

/**
 * What past runs of this item actually took.
 *
 * The run hours field is left blank on purpose so the number the shop types is
 * their own and not a copy of an estimate. This sits beside it and reports what
 * finished work orders say, so the scheduler has something to sanity-check
 * against without being led by it.
 *
 * The history is the work orders themselves — hours entered, quantity completed
 * — so it starts working the moment the team fills a few in. Nothing to seed.
 */

import { useCallback, useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

const sb = createSupabaseBrowserClient()

type Any = Record<string, any>

const n = (v: any) => {
  const x = Number(v)
  return isFinite(x) ? x : 0
}

function median(xs: number[]) {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const fmt = (v: number, dp = 1) =>
  v.toLocaleString('en-US', { maximumFractionDigits: dp })

/** Hours per unit from one finished work order, or null if it cannot be read. */
function perUnit(w: Any): number | null {
  const hrs = n(w.scheduled_hours)
  const qty = n(w.qty_completed) || n(w.qty_required) || n(w.qty_ordered)
  if (hrs <= 0 || qty <= 0) return null
  return hrs / qty
}

export default function RunHoursHint({
  machineId,
  sku,
  qty,
}: {
  machineId: string | null | undefined
  sku: string | null | undefined
  qty: number | null | undefined
}) {
  const [hint, setHint] = useState<{ est: number; samples: number; scope: string; lo: number; hi: number } | null>(null)
  const [done, setDone] = useState(false)

  const clean = String(sku ?? '').trim()
  const q = n(qty)

  const load = useCallback(async () => {
    setDone(false)
    setHint(null)
    if (!clean) { setDone(true); return }

    const base = () => sb
      .from('work_orders')
      .select('scheduled_hours,qty_completed,qty_required,qty_ordered,completed_at,machine_id')
      .ilike('item_part_number', clean)
      .not('scheduled_hours', 'is', null)
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(12)

    // Same item on the same machine first — that is the honest comparison.
    let rows: Any[] = []
    let scope = ''
    if (machineId) {
      const { data } = await base().eq('machine_id', machineId)
      rows = ((data ?? []) as Any[])
      scope = 'this machine'
    }
    if (rows.length < 2) {
      const { data } = await base()
      const all = ((data ?? []) as Any[])
      if (all.length > rows.length) { rows = all; scope = 'any machine' }
    }

    const rates = rows.map(perUnit).filter((x): x is number => x !== null)
    if (!rates.length) { setDone(true); return }

    const med = median(rates)
    setHint({
      est: q > 0 ? med * q : 0,
      samples: rates.length,
      scope,
      lo: Math.min(...rates) * q,
      hi: Math.max(...rates) * q,
    })
    setDone(true)
  }, [clean, machineId, q])

  useEffect(() => { load() }, [load])

  if (!done) return null

  if (!hint) {
    return (
      <p className="text-[11px] text-gray-400 mt-1">
        No finished runs of this item yet — once a few are completed with hours filled in,
        the typical time shows up here.
      </p>
    )
  }

  if (!hint.est) {
    return (
      <p className="text-[11px] text-gray-500 mt-1">
        {hint.samples} finished run{hint.samples === 1 ? '' : 's'} on file for this item.
        Set a quantity to see the typical time.
      </p>
    )
  }

  return (
    <p className="text-[11px] text-gray-500 mt-1">
      Past runs: <span className="font-semibold text-gray-700">{fmt(hint.est)} hr</span> typical for this quantity
      {' '}({hint.samples} run{hint.samples === 1 ? '' : 's'}, {hint.scope}
      {hint.samples > 1 ? `, ${fmt(hint.lo)}–${fmt(hint.hi)} hr` : ''}). Enter what you expect, not this.
    </p>
  )
}
