import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchFull(token: string): Promise<any> {
  const { data: pl } = await admin.from('walmart_pallets').select('*').eq('token', token).maybeSingle()
  if (!pl) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = pl as any
  const { data: order } = await admin.from('walmart_board_orders')
    .select('id, name, po_number, load_number, ship_due_date, status, ship_to').eq('id', p.order_id).maybeSingle()
  const { data: lines } = await admin.from('walmart_board_lines')
    .select('part_number, qty, uom').eq('order_id', p.order_id).order('line_number', { ascending: true })
  const { data: items } = await admin.from('walmart_pallet_items')
    .select('id, sku, qty, created_at').eq('pallet_id', p.id).order('created_at', { ascending: true })
  // Suggested SKUs = the order's line part numbers (deduped, non-empty)
  const skus = Array.from(new Set(((lines as { part_number: string | null }[]) || [])
    .map(l => (l.part_number || '').trim()).filter(Boolean)))
  return { pallet: p, order, lines: lines || [], items: items || [], skus }
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const data = await fetchFull(params.token)
  if (!data) return NextResponse.json({ error: 'Pallet not found' }, { status: 404, headers: NO_STORE })
  return NextResponse.json(data, { headers: NO_STORE })
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const body = await req.json().catch(() => ({}))
  const { data: pl } = await admin.from('walmart_pallets').select('id, status').eq('token', params.token).maybeSingle()
  if (!pl) return NextResponse.json({ error: 'Pallet not found' }, { status: 404, headers: NO_STORE })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = pl as any
  const by = (body.by || 'Production').toString().slice(0, 80)

  if (p.status === 'complete' && body.action !== 'noop') {
    return NextResponse.json({ error: 'This pallet is already completed.' }, { status: 400, headers: NO_STORE })
  }

  if (body.action === 'add_item') {
    const sku = (body.sku || '').toString().trim()
    const qty = Number(body.qty)
    if (!sku || !qty || qty <= 0) return NextResponse.json({ error: 'Enter a SKU and a quantity.' }, { status: 400, headers: NO_STORE })
    const { data: ord } = await admin.from('walmart_pallets').select('order_id').eq('id', p.id).maybeSingle()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await admin.from('walmart_pallet_items').insert({ pallet_id: p.id, order_id: (ord as any)?.order_id, sku, qty, created_by: by })
  } else if (body.action === 'remove_item' && body.itemId) {
    await admin.from('walmart_pallet_items').delete().eq('id', body.itemId).eq('pallet_id', p.id)
  } else if (body.action === 'complete') {
    const { error } = await admin.rpc('walmart_complete_pallet', { p_pallet_id: p.id, p_by: by })
    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })
  }

  const data = await fetchFull(params.token)
  return NextResponse.json(data, { headers: NO_STORE })
}
