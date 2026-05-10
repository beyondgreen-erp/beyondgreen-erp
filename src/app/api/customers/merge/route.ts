/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { primary_id, merge_ids }: { primary_id: string; merge_ids: string[] } = await req.json()
  if (!primary_id || !merge_ids?.length) return NextResponse.json({ error: 'primary_id and merge_ids required' }, { status: 400 })

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // 1. Fetch all accounts
  const { data: allAccounts, error: fetchErr } = await sb.from('customers')
    .select('id,company_name,lifetime_spend,total_shipments,merged_from_names')
    .in('id', [primary_id, ...merge_ids])
  if (fetchErr || !allAccounts) return NextResponse.json({ error: fetchErr?.message ?? 'fetch failed' }, { status: 500 })

  const primary = allAccounts.find(a => a.id === primary_id)
  if (!primary) return NextResponse.json({ error: 'primary not found' }, { status: 400 })
  const merging = allAccounts.filter(a => a.id !== primary_id)
  const mergeNames = merging.map(a => a.company_name as string)

  // 2-3. Sum totals
  const combinedSpend = allAccounts.reduce((s, a) => s + (a.lifetime_spend ?? 0), 0)
  const combinedShipments = allAccounts.reduce((s, a) => s + (a.total_shipments ?? 0), 0)
  const existingMergedNames: string[] = primary.merged_from_names ?? []
  const allMergedNames = Array.from(new Set([...existingMergedNames, ...mergeNames]))

  // 4. Update primary totals
  await sb.from('customers').update({
    lifetime_spend: combinedSpend,
    total_shipments: combinedShipments,
    merged_from_names: allMergedNames,
    updated_at: new Date().toISOString(),
  }).eq('id', primary_id)

  // 5. Move contacts
  await sb.from('customer_contacts').update({ customer_id: primary_id }).in('customer_id', merge_ids)

  // 6. Move ship locations (skip exact city+state dupes)
  const { data: existingLocs } = await sb.from('customer_ship_locations').select('city,state').eq('customer_id', primary_id)
  const existingKeys = new Set((existingLocs ?? []).map((l: any) => `${l.city}_${l.state}`))
  const { data: incomingLocs } = await sb.from('customer_ship_locations').select('*').in('customer_id', merge_ids)
  for (const loc of incomingLocs ?? []) {
    const key = `${loc.city}_${loc.state}`
    if (!existingKeys.has(key)) {
      await sb.from('customer_ship_locations').update({ customer_id: primary_id, is_default: false }).eq('id', loc.id)
      existingKeys.add(key)
    }
  }

  // 7. Move activity feed
  await sb.from('customer_activity').update({ customer_id: primary_id }).in('customer_id', merge_ids)

  // 8. Move comments (record_type = 'customers')
  await sb.from('comments').update({ record_id: primary_id }).in('record_id', merge_ids).eq('record_type', 'customers')

  // 9-11. Re-link orders, quotes, tasks
  await sb.from('sales_orders').update({ customer_id: primary_id }).in('customer_id', merge_ids)
  await sb.from('quotations').update({ customer_id: primary_id }).in('customer_id', merge_ids)
  await sb.from('tasks').update({ customer_id: primary_id }).in('customer_id', merge_ids)

  // 12. Update shipments customer_name to match primary
  for (const name of mergeNames) {
    await sb.from('shipments').update({ customer_name: primary.company_name }).ilike('customer_name', name)
  }

  // 13. Mark merged accounts
  await sb.from('customers').update({
    is_merged: true,
    merged_into: primary_id,
    updated_at: new Date().toISOString(),
  }).in('id', merge_ids)

  // 14. Activity entry
  await sb.from('customer_activity').insert({
    customer_id: primary_id,
    activity_type: 'note',
    source_type: 'customers',
    source_id: primary_id,
    source_label: 'Account Merge',
    author_email: 'system',
    content: `Accounts merged into this record: ${mergeNames.join(', ')}`,
  })

  return NextResponse.json({ ok: true, merged: merge_ids.length, primary_id })
}
