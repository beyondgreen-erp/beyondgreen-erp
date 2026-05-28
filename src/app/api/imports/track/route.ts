export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const PORTS: Record<string, { lat: number; lng: number }> = {
  SHANGHAI: { lat: 31.2304, lng: 121.4737 },
  XIAMEN: { lat: 24.4798, lng: 118.0894 },
  QINGDAO: { lat: 36.0671, lng: 120.3826 },
  LOS_ANGELES: { lat: 33.7405, lng: -118.2764 },
  AMSTERDAM: { lat: 52.3676, lng: 4.9041 },
  INDIA: { lat: 19.0760, lng: 72.8777 },
}

function getOriginPort(shipper: string | null, vessel: string | null) {
  const text = `${shipper ?? ''} ${vessel ?? ''}`.toUpperCase()
  if (text.includes('XIAMEN') || text.includes('CNXMN')) return PORTS.XIAMEN
  if (text.includes('QINGDAO') || text.includes('SHANDONG')) return PORTS.QINGDAO
  if (text.includes('AMSTERDAM') || text.includes('KLM')) return PORTS.AMSTERDAM
  if (text.includes('PARAS') || text.includes('INDIA')) return PORTS.INDIA
  return PORTS.SHANGHAI
}

function estimatePosition(
  etd: string | null,
  eta: string | null,
  origin: { lat: number; lng: number },
  dest: { lat: number; lng: number }
): { lat: number; lng: number } {
  if (!etd || !eta) return origin
  const start = new Date(etd).getTime()
  const end = new Date(eta).getTime()
  const now = Date.now()
  const progress = Math.max(0, Math.min(1, (now - start) / (end - start)))
  const lat = origin.lat + (dest.lat - origin.lat) * progress
  let lngDiff = dest.lng - origin.lng
  if (lngDiff < -180) lngDiff += 360
  if (lngDiff > 180) lngDiff -= 360
  const lng = origin.lng + lngDiff * progress
  return { lat, lng }
}

export async function GET() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const { data: shipments, error } = await supabase
    .from('import_shipments')
    .select('id,vessel_name,vessel_number,shipper,etd,eta_los_angeles,status,freight_method')
    .not('status', 'in', '("Received","Cleared","Delivered")')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const dest = PORTS.LOS_ANGELES
  const updates = (shipments ?? []).map((s: { id: string; vessel_name: string | null; shipper: string | null; etd: string | null; eta_los_angeles: string | null; status: string }) => {
    const origin = getOriginPort(s.shipper, s.vessel_name)
    const pos = estimatePosition(s.etd, s.eta_los_angeles, origin, dest)
    return { id: s.id, vessel: s.vessel_name ?? '—', lat: pos.lat, lng: pos.lng, status: s.status, last_updated: new Date().toISOString() }
  })

  // Update positions in DB
  for (const u of updates) {
    await supabase.from('import_shipments').update({
      current_lat: u.lat,
      current_lng: u.lng,
      last_tracked: u.last_updated,
    }).eq('id', u.id)
  }

  return NextResponse.json({ shipments: updates })
}
