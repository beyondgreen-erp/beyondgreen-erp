/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const {
    primary_id,
    merge_ids,
    primary_name,
    merge_accounts,
  }: {
    primary_id: string
    merge_ids: string[]
    primary_name: string
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

  const merged: any[] = merge_accounts ?? []
  const mergeNames: string[] = merged.map((a: any) => a.company_name ?? '').filter(Boolean)

  // 1. Set the surviving name
  const { error: e1 } = await sb.from('customers').update({
    company_name: primary_name, updated_at: new Date().toISOString(),
  }).eq('id', primary_id)
  if (e1) return NextResponse.json({ error: `update primary: ${e1.message}` }, { status: 500 })

  // 2. merge_customers (database) moves every linked record (orders, quotes, invoices, contacts,
  //    ship locations, activity, comments, tasks, documents...), fills missing contact fields,
  //    archives the duplicates and recalculates totals from the Shipments board.
  const { error: e2 } = await sb.rpc('merge_customers', {
    p_primary: primary_id,
    p_dups: merge_ids,
    p_note: `Merged ${mergeNames.length} account${mergeNames.length !== 1 ? 's' : ''} into this record: ${mergeNames.join(', ')}. All contacts, ship locations, orders, and history transferred.`,
  })
  if (e2) return NextResponse.json({ error: `merge: ${e2.message}` }, { status: 500 })

  return NextResponse.json({ ok: true, merged: merge_ids.length, primary_id })
}
