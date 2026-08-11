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
async function getDevice(serial: string): Promise<any | null> {
  const { data } = await admin.from('scan_devices').select('*').eq('serial', serial).maybeSingle()
  return data || null
}
const num = (v: unknown) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.-]/g, '')); return isNaN(n) ? 0 : n }

// Public device metadata (label + mode) — never returns the PIN.
export async function GET(_req: NextRequest, { params }: { params: { serial: string } }) {
  const d = await getDevice(params.serial)
  if (!d || !d.is_active) return NextResponse.json({ error: 'Device not found or inactive' }, { status: 404, headers: NO_STORE })
  return NextResponse.json({ ok: true, label: d.label, mode: d.mode }, { headers: NO_STORE })
}

export async function POST(req: NextRequest, { params }: { params: { serial: string } }) {
  const body = await req.json().catch(() => ({}))
  const d = await getDevice(params.serial)
  if (!d || !d.is_active) return NextResponse.json({ error: 'Device not found or inactive' }, { status: 404, headers: NO_STORE })

  // Every action requires the device PIN.
  if (String(body.pin ?? '') !== String(d.pin)) {
    return NextResponse.json({ error: 'Wrong PIN' }, { status: 401, headers: NO_STORE })
  }
  const who = d.label as string
  const action = String(body.action || '')

  // Touch last-used (non-blocking).
  admin.from('scan_devices').update({ last_used_at: new Date().toISOString() }).eq('id', d.id).then(() => {}, () => {})

  try {
    if (action === 'auth') {
      return NextResponse.json({ ok: true, label: d.label, mode: d.mode }, { headers: NO_STORE })
    }

    if (action === 'search') {
      const q = String(body.q || '').trim()
      if (q.length < 2) return NextResponse.json({ ok: true, results: [] }, { headers: NO_STORE })
      const { data } = await admin.from('products')
        .select('id, sku, product_name, case_qty, unit_of_measure, requires_bom')
        .or(`sku.ilike.%${q}%,product_name.ilike.%${q}%`).eq('is_active', true).limit(10)
      return NextResponse.json({ ok: true, results: data || [] }, { headers: NO_STORE })
    }

    if (action === 'pos') {
      const CLOSED = ['Received', 'PO Canceled']
      const { data } = await admin.from('purchasing_requests')
        .select('id,name,po_number,supplier,qty_ordered,qty_received,balance,status')
        .order('po_date', { ascending: false }).limit(500)
      const open = ((data as unknown[]) || []).filter((r) => !CLOSED.includes(String((r as { status?: string }).status || '')))
      return NextResponse.json({ ok: true, pos: open }, { headers: NO_STORE })
    }

    // ---- Receiving actions ----
    if (action === 'receive') {
      if (d.mode !== 'receiving') return NextResponse.json({ error: 'This device is not a receiving device' }, { status: 403, headers: NO_STORE })
      const { data, error } = await admin.rpc('receive_scan', {
        p_code: String(body.code || '').trim(),
        p_qty: body.qty != null ? Number(body.qty) : 1,
        p_lot: body.lot || null,
        p_user: who,
        p_pack_qty: body.pack_qty != null ? Number(body.pack_qty) : null,
        p_uom: body.uom || null,
      })
      if (error) return NextResponse.json({ error: error.message }, { status: 400, headers: NO_STORE })
      return NextResponse.json(data, { headers: NO_STORE })
    }

    if (action === 'adjust') {
      if (d.mode !== 'receiving') return NextResponse.json({ error: 'This device is not a receiving device' }, { status: 403, headers: NO_STORE })
      const { data, error } = await admin.rpc('adjust_receive_qty', {
        p_product_id: String(body.product_id || ''),
        p_delta: Number(body.delta),
        p_lot: body.lot || null,
        p_user: who,
      })
      if (error) return NextResponse.json({ error: error.message }, { status: 400, headers: NO_STORE })
      return NextResponse.json(data, { headers: NO_STORE })
    }

    if (action === 'link') {
      if (d.mode !== 'receiving') return NextResponse.json({ error: 'This device is not a receiving device' }, { status: 403, headers: NO_STORE })
      const { data, error } = await admin.rpc('link_barcode_and_receive', {
        p_code: String(body.code || '').trim(),
        p_product_id: String(body.product_id || ''),
        p_qty: body.qty != null ? Number(body.qty) : 1,
        p_lot: body.lot || null,
        p_user: who,
      })
      if (error) return NextResponse.json({ error: error.message }, { status: 400, headers: NO_STORE })
      return NextResponse.json(data, { headers: NO_STORE })
    }

    if (action === 'finish_po') {
      if (d.mode !== 'receiving') return NextResponse.json({ error: 'This device is not a receiving device' }, { status: 403, headers: NO_STORE })
      const poId = String(body.po_id || '')
      const added = Number(body.received || 0)
      if (!poId) return NextResponse.json({ ok: true, skipped: true }, { headers: NO_STORE })
      const { data: po } = await admin.from('purchasing_requests').select('qty_ordered,qty_received,balance').eq('id', poId).maybeSingle()
      const p = (po || {}) as { qty_ordered?: string; qty_received?: string; balance?: string }
      const received = num(p.qty_received) + added
      const ordered = num(p.qty_ordered)
      const balance = ordered ? Math.max(0, ordered - received) : null
      const status = balance !== null && balance <= 0 ? 'Received' : 'Partial Received'
      await admin.from('purchasing_requests').update({
        qty_received: String(received),
        balance: balance !== null ? String(balance) : p.balance,
        status,
        date_received: new Date().toISOString().slice(0, 10),
        received_by: who,
      }).eq('id', poId)
      return NextResponse.json({ ok: true, received, balance, status }, { headers: NO_STORE })
    }

    // ---- Production actions ----
    if (action === 'produce') {
      if (d.mode !== 'production') return NextResponse.json({ error: 'This device is not a production device' }, { status: 403, headers: NO_STORE })
      const { data, error } = await admin.rpc('produce_scan', {
        p_code: String(body.code || '').trim(),
        p_qty: body.qty != null ? Number(body.qty) : 1,
        p_wo_id: body.wo_id || null,
        p_user: who,
      })
      if (error) return NextResponse.json({ error: error.message }, { status: 400, headers: NO_STORE })
      return NextResponse.json(data, { headers: NO_STORE })
    }

    if (action === 'undo_production') {
      if (d.mode !== 'production') return NextResponse.json({ error: 'This device is not a production device' }, { status: 403, headers: NO_STORE })
      const { error } = await admin.rpc('undo_production', { p_movement_id: String(body.movement_id || '') })
      if (error) return NextResponse.json({ error: error.message }, { status: 400, headers: NO_STORE })
      return NextResponse.json({ ok: true }, { headers: NO_STORE })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400, headers: NO_STORE })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'Server error' }, { status: 500, headers: NO_STORE })
  }
}
