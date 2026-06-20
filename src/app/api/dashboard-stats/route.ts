import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const OPEN_STATUSES = [
  'New', 'Confirmed', 'Awaiting BOM Components', 'Awaiting Production',
  'Production Queue', 'In Production', 'QC', 'Ready to Ship', 'Partially Shipped', 'On Hold'
]

export async function GET() {
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { count: openOrders } = await sb
      .from('sales_orders')
      .select('id', { count: 'exact', head: true })
      .in('status', OPEN_STATUSES)
    return NextResponse.json({ openOrders: openOrders ?? 0 })
  } catch (e) {
    console.error('[dashboard-stats]', e)
    return NextResponse.json({ openOrders: 0 }, { status: 500 })
  }
}
