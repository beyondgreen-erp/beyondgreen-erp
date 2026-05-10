/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const {
    primary_id,
    merge_ids,
    primary_name,
    merge_names = [],
    primary_lifetime_spend = 0,
    primary_total_shipments = 0,
    merge_lifetime_spend = 0,
    merge_total_shipments = 0,
    primary_merged_from_names = [],
  }: {
    primary_id: string
    merge_ids: string[]
    primary_name: string
    merge_names: string[]
    primary_lifetime_spend: number
    primary_total_shipments: number
    merge_lifetime_spend: number
    merge_total_shipments: number
    primary_merged_from_names: string[]
  } = await req.json()

  if (!primary_id || !merge_ids?.length) {
    return NextResponse.json({ error: 'primary_id and merge_ids required' }, { status: 400 })
  }
  if (!primary_name) {
    return NextResponse.json({ error: 'primary_name required' }, { status: 400 })
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const combinedSpend = primary_lifetime_spend + merge_lifetime_spend
  const combinedShipments = primary_total_shipments + merge_total_shipments
  const allMergedNames = Array.from(new Set([...primary_merged_from_names, ...merge_names]))

  // 1. Update primary totals
  await sb.from('customers').update({
    lifetime_spend: combinedSpend,
    total_shipments: combinedShipments,
    merged_from_names: allMergedNames,
    updated_at: new Date().toISOString(),
  }).eq('id', primary_id)

  // 2. Move contacts
  await sb.from('customer_contacts').update({ customer_id: primary_id }).in('customer_id', merge_ids)

  // 3. Move ALL ship locations to primary (keep all — one entity can have many locations)
  await sb.from('customer_ship_locations')
    .update({ customer_id: primary_id, is_default: false })
    .in('customer_id', merge_ids)

  // 4. Move activity feed
  await sb.from('customer_activity').update({ customer_id: primary_id }).in('customer_id', merge_ids)

  // 5. Move comments
  await sb.from('comments').update({ record_id: primary_id }).in('record_id', merge_ids).eq('record_type', 'customers')

  // 6. Re-link orders, quotes, tasks
  await sb.from('sales_orders').update({ customer_id: primary_id }).in('customer_id', merge_ids)
  await sb.from('quotations').update({ customer_id: primary_id }).in('customer_id', merge_ids)
  await sb.from('tasks').update({ customer_id: primary_id }).in('customer_id', merge_ids)

  // 7. Update shipments customer_name to match primary
  for (const name of merge_names) {
    await sb.from('shipments').update({ customer_name: primary_name }).ilike('customer_name', name)
  }

  // 8. Mark merged accounts
  await sb.from('customers').update({
    is_merged: true,
    merged_into: primary_id,
    updated_at: new Date().toISOString(),
  }).in('id', merge_ids)

  // 9. Activity entry
  await sb.from('customer_activity').insert({
    customer_id: primary_id,
    activity_type: 'note',
    source_type: 'customers',
    source_id: primary_id,
    source_label: 'Account Merge',
    author_email: 'system',
    content: `Accounts merged into this record: ${merge_names.join(', ')}`,
  })

  return NextResponse.json({ ok: true, merged: merge_ids.length, primary_id })
}
