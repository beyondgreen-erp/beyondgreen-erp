import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Public, token-keyed endpoint behind the pallet-label QR. Returns only the
// saved shipping-document snapshot (packing slip + BOL inputs) — no ERP access,
// no other orders, nothing beyond what's already printed on the paperwork.

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    if (!params.token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })
    const sb = admin()
    const { data } = await sb
      .from('sales_orders')
      .select('order_number, ship_docs')
      .eq('docs_token', params.token)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docs = (data as any)?.ship_docs
    if (!data || !docs) return NextResponse.json({ error: 'Documents not found for this code' }, { status: 404 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return NextResponse.json({ ok: true, orderNumber: (data as any).order_number, docs })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'lookup failed' }, { status: 500 })
  }
}
