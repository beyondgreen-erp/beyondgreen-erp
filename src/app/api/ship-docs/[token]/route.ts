import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Public, token-keyed endpoint behind the pallet-label QR. Returns ONLY the routing
// for this one shipment — where it ships from and where it's going — read LIVE from the
// order, so editing the ship-to address on the sales order updates this page automatically.
// No ERP access, no other orders, nothing beyond the from/to on the paperwork.

const SHIP_FROM = { name: 'beyondGREEN Biotech, Inc.', address: '1202 E. Wakeham Ave.\nSanta Ana, CA 92705 USA' }

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    if (!params.token) return NextResponse.json({ error: 'Missing code' }, { status: 400 })
    const sb = admin()
    const { data } = await sb
      .from('sales_orders')
      .select('order_number, po_number, shipping_address, customers(company_name, shipping_address)')
      .eq('docs_token', params.token)
      .single()
    if (!data) return NextResponse.json({ error: 'No shipment found for this code' }, { status: 404 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = data as any
    const cust = Array.isArray(d.customers) ? d.customers[0] : d.customers
    const shipTo = {
      name: cust?.company_name || 'Customer',
      address: String(d.shipping_address || cust?.shipping_address || '').trim(),
    }
    return NextResponse.json(
      { ok: true, orderNumber: d.order_number || '', poNumber: d.po_number || '', shipFrom: SHIP_FROM, shipTo },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'lookup failed' }, { status: 500 })
  }
}
