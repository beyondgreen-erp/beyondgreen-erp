/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const {
    primary_id,
    merge_ids,
    primary_name,
    primary_account,
    merge_accounts,
  }: {
    primary_id: string
    merge_ids: string[]
    primary_name: string
    primary_account: any
    merge_accounts: any[]
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

  const primary = primary_account ?? {}
  const merged: any[] = merge_accounts ?? []
  const mergeNames: string[] = merged.map((a: any) => a.company_name ?? '')

  // Combine totals from passed account data
  const allAccounts = [primary, ...merged]
  const combinedSpend = allAccounts.reduce((s: number, a: any) => s + (a.lifetime_spend ?? 0), 0)
  const combinedShipments = allAccounts.reduce((s: number, a: any) => s + (a.total_shipments ?? 0), 0)

  const allMergedNames = Array.from(new Set([
    ...(primary.merged_from_names ?? []),
    ...merged.flatMap((a: any) => [a.company_name, ...(a.merged_from_names ?? [])]),
  ]))

  // Fill missing fields on primary from merged accounts
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
  await sb.from('customer_contacts').update({ customer_id: primary_id }).in('customer_id', merge_ids)

  // 3. Move ship locations
  const { error: e3 } = await sb.from('customer_ship_locations')
    .update({ customer_id: primary_id, is_default: false })
    .in('customer_id', merge_ids)
  if (e3) console.error('ship_locations:', e3.message)

  // 4. Move activity
  await sb.from('customer_activity').update({ customer_id: primary_id }).in('customer_id', merge_ids)

  // 5. Move comments
  await sb.from('comments').update({ record_id: primary_id }).in('record_id', merge_ids).eq('record_type', 'customers')

  // 6. Re-link orders, quotes, tasks, invoices
  await sb.from('sales_orders').update({ customer_id: primary_id }).in('customer_id', merge_ids)
  await sb.from('quotations').update({ customer_id: primary_id }).in('customer_id', merge_ids)
  await sb.from('tasks').update({ customer_id: primary_id }).in('customer_id', merge_ids)
  await sb.from('invoices').update({ customer_id: primary_id }).in('customer_id', merge_ids)

  // 7. Update shipments customer_name
  for (const name of mergeNames) {
    if (name) await sb.from('shipments').update({ customer_name: primary_name }).ilike('customer_name', name)
  }

  // 8. Archive merged accounts
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
