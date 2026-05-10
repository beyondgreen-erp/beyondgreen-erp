/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const {
    primary_id,
    merge_ids,
    primary_name,
  }: {
    primary_id: string
    merge_ids: string[]
    primary_name: string
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

  // Fetch all accounts fresh from DB
  const allIds = [primary_id, ...merge_ids]
  const { data: accounts, error: fetchErr } = await sb
    .from('customers')
    .select('*')
    .in('id', allIds)

  if (fetchErr) return NextResponse.json({ error: `fetch: ${fetchErr.message}` }, { status: 500 })
  if (!accounts?.length) return NextResponse.json({ error: 'No accounts found' }, { status: 404 })

  const primary = accounts.find((a: any) => a.id === primary_id)
  const merged = accounts.filter((a: any) => merge_ids.includes(a.id))
  if (!primary) return NextResponse.json({ error: 'Primary account not found' }, { status: 404 })

  // Combine totals
  const combinedSpend = accounts.reduce((s: number, a: any) => s + (a.lifetime_spend ?? 0), 0)
  const combinedShipments = accounts.reduce((s: number, a: any) => s + (a.total_shipments ?? 0), 0)

  const allMergedNames = Array.from(new Set([
    ...(primary.merged_from_names ?? []),
    ...merged.flatMap((a: any) => [a.company_name, ...(a.merged_from_names ?? [])]),
  ]))

  const mergeNames = merged.map((a: any) => a.company_name as string)

  // Fields to copy from merged accounts to fill gaps in primary
  // Excludes computed fields (first_shipment_date, last_shipment_date) to avoid trigger conflicts
  const fillFields: Record<string, any> = {}
  const fieldsToCopy = [
    'contact_name', 'email', 'phone', 'billing_address', 'shipping_address',
    'payment_terms', 'industry', 'lead_source', 'pipeline_stage', 'customer_status',
    'deal_value', 'probability', 'priority', 'expected_close_date', 'next_follow_up',
    'notes', 'spend_notes',
  ]
  for (const field of fieldsToCopy) {
    if (primary[field] == null || primary[field] === '') {
      const donor = merged.find((a: any) => a[field] != null && a[field] !== '')
      if (donor) fillFields[field] = donor[field]
    }
  }

  // 1. Update primary
  const { error: e1 } = await sb.from('customers').update({
    company_name: primary_name,
    lifetime_spend: combinedSpend,
    total_shipments: combinedShipments,
    merged_from_names: allMergedNames,
    updated_at: new Date().toISOString(),
    ...fillFields,
  }).eq('id', primary_id)
  if (e1) return NextResponse.json({ error: `update primary: ${e1.message}` }, { status: 500 })

  // 2. Move contacts
  const { error: e2 } = await sb.from('customer_contacts')
    .update({ customer_id: primary_id })
    .in('customer_id', merge_ids)
  if (e2) console.error('contacts:', e2.message)

  // 3. Move ship locations
  const { error: e3 } = await sb.from('customer_ship_locations')
    .update({ customer_id: primary_id, is_default: false })
    .in('customer_id', merge_ids)
  if (e3) console.error('ship_locations:', e3.message)

  // 4. Move activity
  const { error: e4 } = await sb.from('customer_activity')
    .update({ customer_id: primary_id })
    .in('customer_id', merge_ids)
  if (e4) console.error('activity:', e4.message)

  // 5. Move comments
  const { error: e5 } = await sb.from('comments')
    .update({ record_id: primary_id })
    .in('record_id', merge_ids)
    .eq('record_type', 'customers')
  if (e5) console.error('comments:', e5.message)

  // 6. Re-link orders, quotes, tasks, invoices
  await sb.from('sales_orders').update({ customer_id: primary_id }).in('customer_id', merge_ids)
  await sb.from('quotations').update({ customer_id: primary_id }).in('customer_id', merge_ids)
  await sb.from('tasks').update({ customer_id: primary_id }).in('customer_id', merge_ids)
  await sb.from('invoices').update({ customer_id: primary_id }).in('customer_id', merge_ids)

  // 7. Update shipments customer_name
  for (const name of mergeNames) {
    await sb.from('shipments').update({ customer_name: primary_name }).ilike('customer_name', name)
  }

  // 8. Archive merged accounts — only columns we know exist
  const { error: e8 } = await sb.from('customers').update({
    is_active: false,
    is_merged: true,
    updated_at: new Date().toISOString(),
  }).in('id', merge_ids)
  if (e8) return NextResponse.json({ error: `archive: ${e8.message}` }, { status: 500 })

  // 9. Activity log
  await sb.from('customer_activity').insert({
    customer_id: primary_id,
    activity_type: 'note',
    source_type: 'customers',
    source_id: primary_id,
    source_label: 'Account Merge',
    author_email: 'system',
    content: `Merged ${mergeNames.length} account${mergeNames.length !== 1 ? 's' : ''} into this record: ${mergeNames.join(', ')}. All contacts, ship locations, orders, and history transferred.`,
  })

  return NextResponse.json({ ok: true, merged: merge_ids.length, primary_id })
}
