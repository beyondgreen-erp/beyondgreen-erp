import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Public, token-keyed endpoint used by the printed pick-ticket QR codes.
// GET  → return the pallet + its contents so the mobile page can display it.
// POST → mark the pallet built and roll its unit quantities into the order's
//        line-item completed_qty. Idempotent: a pallet already built is a no-op.

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function loadPallet(sb: ReturnType<typeof admin>, token: string) {
  const { data: pallet } = await sb
    .from('shipment_pallets')
    .select('id, sales_order_id, pallet_number, total_pallets, sscc, case_count, weight, pick_token, built_at, built_by')
    .eq('pick_token', token)
    .single()
  if (!pallet) return null

  const { data: cases } = await sb
    .from('shipment_cases')
    .select('sku, description, total_cases, units_in_case')
    .eq('pallet_id', pallet.id)

  let order: { id: string; order_number: string | null; notes: string | null } | null = null
  if (pallet.sales_order_id) {
    const { data: o } = await sb
      .from('sales_orders')
      .select('id, order_number, notes')
      .eq('id', pallet.sales_order_id)
      .single()
    order = o ?? null
  }
  return { pallet, cases: cases ?? [], order }
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    if (!params.token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })
    const sb = admin()
    const data = await loadPallet(sb, params.token)
    if (!data) return NextResponse.json({ error: 'Pick ticket not found' }, { status: 404 })
    return NextResponse.json({ ok: true, ...data })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'lookup failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    if (!params.token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })
    const sb = admin()
    const body = await req.json().catch(() => ({})) as { builtBy?: string }

    const data = await loadPallet(sb, params.token)
    if (!data) return NextResponse.json({ error: 'Pick ticket not found' }, { status: 404 })
    const { pallet, cases, order } = data

    // Idempotent: don't double-count a pallet that's already been confirmed.
    if (pallet.built_at) {
      return NextResponse.json({ ok: true, alreadyDone: true, builtAt: pallet.built_at, builtBy: pallet.built_by })
    }

    // Units to add to completed_qty, grouped by SKU.
    const unitsBySku = new Map<string, number>()
    for (const c of cases) {
      const units = (Number(c.total_cases) || 0) * (Number(c.units_in_case) || 0)
      if (!c.sku || units <= 0) continue
      unitsBySku.set(c.sku, (unitsBySku.get(c.sku) ?? 0) + units)
    }

    const updated: { sku: string; added: number; completed_qty: number }[] = []
    if (order?.id) {
      for (const [sku, addUnits] of unitsBySku) {
        const { data: lines } = await sb
          .from('sales_order_lines')
          .select('id, completed_qty')
          .eq('sales_order_id', order.id)
          .eq('sku', sku)
          .order('line_number', { ascending: true })
        if (!lines || lines.length === 0) continue
        // Add all of this SKU's units to the first matching line.
        const target = lines[0] as { id: string; completed_qty: number | null }
        const newVal = (Number(target.completed_qty) || 0) + addUnits
        await sb.from('sales_order_lines').update({ completed_qty: newVal }).eq('id', target.id)
        updated.push({ sku, added: addUnits, completed_qty: newVal })
      }
    }

    await sb
      .from('shipment_pallets')
      .update({ built_at: new Date().toISOString(), built_by: body.builtBy || 'Scan' })
      .eq('id', pallet.id)

    return NextResponse.json({ ok: true, confirmed: true, updated })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'confirm failed' }, { status: 500 })
  }
}
