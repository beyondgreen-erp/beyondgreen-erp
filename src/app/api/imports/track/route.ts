export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function trackContainer(containerNo: string, apiKey: string): Promise<{ lat: number; lng: number; vessel?: string; shipsgoStatus?: string } | null> {
  const clean = containerNo.replace(/\s/g, '').split('/')[0].split('&')[0].trim()
  if (!clean || clean.includes('#') || clean.length < 4) return null

  try {
    const res = await fetch(
      `https://shipsgo.com/api/v2/container/${encodeURIComponent(clean)}?authCode=${apiKey}`,
      { headers: { Accept: 'application/json' }, next: { revalidate: 3600 } }
    )
    if (!res.ok) {
      console.log(`[ShipsGo] ${clean}: HTTP ${res.status}`)
      return null
    }
    const data = await res.json()

    // ShipsGo v2 response shape variants
    const loc =
      data?.containerData?.currentLocation ??
      data?.data?.currentLocation ??
      data?.currentLocation ??
      null

    if (!loc) return null

    const lat = parseFloat(loc.latitude ?? loc.lat ?? '')
    const lng = parseFloat(loc.longitude ?? loc.lng ?? loc.lon ?? '')
    if (isNaN(lat) || isNaN(lng)) return null

    const vessel =
      data?.containerData?.vessel?.name ??
      data?.data?.vessel?.name ??
      data?.vessel?.name ??
      undefined

    const shipsgoStatus =
      data?.containerData?.status ??
      data?.data?.status ??
      undefined

    return { lat, lng, vessel, shipsgoStatus }
  } catch (err) {
    console.error(`[ShipsGo] ${clean}:`, err)
    return null
  }
}

export async function GET() {
  const SHIPSGO_KEY = process.env.SHIPSGO_API_KEY
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data: shipments, error } = await supabase
    .from('import_shipments')
    .select('id, container_number, bl_number, vessel_name, shipper, status, freight_method, etd, eta_los_angeles')
    .not('status', 'in', '("Received","Cleared","Delivered")')
    .eq('freight_method', 'OCEAN')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const results: { id: string; container: string; lat: number; lng: number; source: 'live' | 'estimated'; vessel?: string }[] = []
  const total = (shipments ?? []).filter(s => s.container_number).length

  for (const ship of shipments ?? []) {
    const containerNo = ship.container_number
    if (!containerNo || containerNo === '—') continue

    // Try ShipsGo first (skip if no key)
    const livePos = SHIPSGO_KEY ? await trackContainer(containerNo, SHIPSGO_KEY) : null

    if (livePos) {
      await supabase.from('import_shipments').update({
        current_lat: livePos.lat,
        current_lng: livePos.lng,
        last_tracked: new Date().toISOString(),
        ...(livePos.vessel ? { vessel_name: livePos.vessel } : {}),
      }).eq('id', ship.id)

      results.push({ id: ship.id, container: containerNo, lat: livePos.lat, lng: livePos.lng, source: 'live', vessel: livePos.vessel ?? ship.vessel_name })
    } else {
      // Fallback: estimated from ETD/ETA
      const est = estimateFallback(ship)
      if (est) {
        await supabase.from('import_shipments').update({
          current_lat: est.lat,
          current_lng: est.lng,
          last_tracked: new Date().toISOString(),
        }).eq('id', ship.id)
        results.push({ id: ship.id, container: containerNo, lat: est.lat, lng: est.lng, source: 'estimated' })
      }
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 300))
  }

  const live = results.filter(r => r.source === 'live').length
  return NextResponse.json({
    tracked: live,
    estimated: results.length - live,
    total,
    positions: results,
    timestamp: new Date().toISOString(),
  })
}

const PORTS = {
  SHANGHAI:    { lat: 31.2304, lng: 121.4737 },
  XIAMEN:      { lat: 24.4798, lng: 118.0894 },
  QINGDAO:     { lat: 36.0671, lng: 120.3826 },
  LOS_ANGELES: { lat: 33.7405, lng: -118.2764 },
  AMSTERDAM:   { lat: 52.3086, lng: 4.7639 },
  MUMBAI:      { lat: 18.9220, lng: 72.8347 },
}

function getOrigin(ship: { shipper: string | null; vessel_name: string | null }) {
  const t = `${ship.shipper ?? ''} ${ship.vessel_name ?? ''}`.toUpperCase()
  if (t.includes('PARAS') || t.includes('BUZIL') || t.includes('INDIA')) return PORTS.MUMBAI
  if (t.includes('SHANDONG') || t.includes('SHENGHE') || t.includes('QINGDAO')) return PORTS.QINGDAO
  if (t.includes('XIAMEN') || t.includes('HONGJU') || t.includes('CNXMN')) return PORTS.XIAMEN
  if (t.includes('KLM') || t.includes('AMSTERDAM')) return PORTS.AMSTERDAM
  return PORTS.SHANGHAI
}

function estimateFallback(ship: { shipper: string | null; vessel_name: string | null; etd: string | null; eta_los_angeles: string | null }) {
  if (!ship.etd || !ship.eta_los_angeles) return null
  const start = new Date(ship.etd).getTime()
  const end = new Date(ship.eta_los_angeles).getTime()
  const progress = Math.max(0, Math.min(1, (Date.now() - start) / (end - start)))
  const origin = getOrigin(ship)
  const dest = PORTS.LOS_ANGELES
  const lat = origin.lat + (dest.lat - origin.lat) * progress
  let lngDiff = dest.lng - origin.lng
  if (lngDiff < -180) lngDiff += 360
  if (lngDiff > 180) lngDiff -= 360
  return { lat, lng: origin.lng + lngDiff * progress }
}
