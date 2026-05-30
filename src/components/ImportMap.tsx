'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export interface ImportShipment {
  id: string
  description: string
  freight_method: string
  vessel_name: string | null
  vessel_number: string | null
  booking_number: string | null
  container_number: string | null
  status: string
  etd: string | null
  eta_los_angeles: string | null
  shipper: string | null
  case_qty: number
  comm_inv_amt: number
  total_landed_cost: number
  bg_po_number: string | null
  current_lat: number | null
  current_lng: number | null
  last_tracked: string | null
}

interface Props {
  shipments: ImportShipment[]
}

// ── Ports ────────────────────────────────────────────────────────────────────

const PORTS = {
  SHANGHAI:    { lat: 31.2304,  lng: 121.4737, label: 'Shanghai' },
  XIAMEN:      { lat: 24.4798,  lng: 118.0894, label: 'Xiamen' },
  QINGDAO:     { lat: 36.0671,  lng: 120.3826, label: 'Qingdao' },
  MUMBAI:      { lat: 18.9220,  lng: 72.8347,  label: 'Mumbai' },
  AMSTERDAM:   { lat: 52.3086,  lng: 4.7639,   label: 'Amsterdam' },
  LOS_ANGELES: { lat: 33.7405,  lng: -118.2764, label: 'Los Angeles' },
  LAX:         { lat: 33.9425,  lng: -118.4081, label: 'LAX' },
}

// Trans-Pacific waypoints (China → LA)
const WP_CHINA_LA: [number, number][] = [
  [30, 135], [40, 160], [45, 180], [42, -160], [38, -140], [34, -125],
]
// India via Malacca → LA
const WP_INDIA_LA: [number, number][] = [
  [6, 80], [1.3, 103.8], [10, 115], [25, 130], [35, 150], [42, 170], [45, 180], [42, -160], [35, -130],
]
// Air Asia → LAX (polar)
const WP_AIR_ASIA: [number, number][] = [
  [45, 140], [55, 160], [55, -160], [48, -125],
]
// Air Amsterdam → LAX
const WP_AIR_AMS: [number, number][] = [
  [55, -20], [45, -60], [40, -90],
]

// ── Helpers ──────────────────────────────────────────────────────────────────

function getOrigin(s: ImportShipment) {
  const t = `${s.shipper ?? ''} ${s.vessel_name ?? ''}`.toUpperCase()
  if (t.includes('PARAS') || t.includes('BUZIL') || t.includes('INDIA')) return PORTS.MUMBAI
  if (t.includes('SHANDONG') || t.includes('SHENGHE') || t.includes('QINGDAO')) return PORTS.QINGDAO
  if (t.includes('XIAMEN') || t.includes('HONGJU') || t.includes('CNXMN')) return PORTS.XIAMEN
  if (t.includes('KLM') || t.includes('AMSTERDAM')) return PORTS.AMSTERDAM
  return PORTS.SHANGHAI
}

function getRouteWaypoints(s: ImportShipment, origin: { lat: number; lng: number }): [number, number][] {
  const o: [number, number] = [origin.lat, origin.lng]
  const dest: [number, number] = [PORTS.LOS_ANGELES.lat, PORTS.LOS_ANGELES.lng]
  if (s.freight_method === 'AIR') {
    const isAms = origin.lng < 20
    return [o, ...(isAms ? WP_AIR_AMS : WP_AIR_ASIA), dest]
  }
  if (origin === PORTS.MUMBAI) return [o, ...WP_INDIA_LA, dest]
  return [o, ...WP_CHINA_LA, dest]
}

function getLivePosition(s: ImportShipment): [number, number] | null {
  if (!s.current_lat || !s.current_lng || !s.last_tracked) return null
  const fourHoursAgo = Date.now() - 4 * 60 * 60 * 1000
  if (new Date(s.last_tracked).getTime() < fourHoursAgo) return null
  return [s.current_lat, s.current_lng]
}

function interpolateRoute(waypoints: [number, number][], progress: number): [number, number] {
  if (progress <= 0) return waypoints[0]
  if (progress >= 1) return waypoints[waypoints.length - 1]

  // Compute cumulative distances
  const segs: number[] = []
  let total = 0
  for (let i = 0; i < waypoints.length - 1; i++) {
    const d = Math.hypot(waypoints[i + 1][0] - waypoints[i][0], waypoints[i + 1][1] - waypoints[i][1])
    segs.push(d)
    total += d
  }

  let target = progress * total
  for (let i = 0; i < segs.length; i++) {
    if (target <= segs[i]) {
      const t = target / segs[i]
      return [
        waypoints[i][0] + (waypoints[i + 1][0] - waypoints[i][0]) * t,
        waypoints[i][1] + (waypoints[i + 1][1] - waypoints[i][1]) * t,
      ]
    }
    target -= segs[i]
  }
  return waypoints[waypoints.length - 1]
}

function getProgress(etd: string | null, eta: string | null): number {
  if (!etd || !eta) return 0
  return Math.max(0, Math.min(1, (Date.now() - new Date(etd).getTime()) / (new Date(eta).getTime() - new Date(etd).getTime())))
}

function etaDays(eta: string | null): string {
  if (!eta) return '—'
  const diff = Math.round((new Date(eta).getTime() - Date.now()) / 86400000)
  if (diff < 0) return `${Math.abs(diff)}d late`
  if (diff === 0) return 'TODAY'
  if (diff === 1) return 'Tomorrow'
  return `${diff} days`
}

function makeIcon(emoji: string) {
  return L.divIcon({
    className: '',
    html: `<div style="font-size:22px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.8));cursor:pointer;">${emoji}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  })
}

const STATUS_COLOR: Record<string, string> = {
  'In Transit': '#3B82F6', 'Gated': '#6B7280', 'At Port of Dispatch': '#F59E0B',
  'Air Cargo Warehouse': '#06B6D4', 'Arriving Tomorrow': '#F59E0B',
  'Arriving Today': '#EF4444', 'Received': '#10B981', 'Cleared': '#14B8A6',
  'Delivered': '#059669', 'Pending': '#4B5563',
}

function FitBounds({ bounds }: { bounds: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (bounds.length > 1) map.fitBounds(bounds as any, { padding: [40, 40] })
  }, [map, bounds])
  return null
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ImportMap({ shipments }: Props) {
  const dest = PORTS.LOS_ANGELES
  const bounds: [number, number][] = [[dest.lat, dest.lng]]

  // Group by booking/vessel for one route line per vessel
  const groups: Record<string, ImportShipment[]> = {}
  for (const s of shipments) {
    const key = s.booking_number ?? s.vessel_name ?? s.id
    if (!groups[key]) groups[key] = []
    groups[key].push(s)
  }

  type RouteEntry = {
    key: string
    rep: ImportShipment
    origin: { lat: number; lng: number; label: string }
    markerPos: [number, number]
    routeLine: [number, number][]
    isLive: boolean
    isReceived: boolean
    isNotDeparted: boolean
    progress: number
    items: ImportShipment[]
  }

  const routes: RouteEntry[] = []

  for (const [key, items] of Object.entries(groups)) {
    const rep = items[0]
    const isReceived = ['Received', 'Cleared', 'Delivered'].includes(rep.status)
    const origin = getOrigin(rep)
    const waypoints = getRouteWaypoints(rep, origin)
    const progress = getProgress(rep.etd, rep.eta_los_angeles)
    const isNotDeparted = progress <= 0 && !isReceived

    const livePos = getLivePosition(rep)
    const isLive = !!livePos

    let markerPos: [number, number]
    if (isReceived) {
      markerPos = [dest.lat, dest.lng]
    } else if (isNotDeparted) {
      markerPos = [origin.lat, origin.lng]
    } else if (isLive) {
      markerPos = livePos!
    } else {
      markerPos = interpolateRoute(waypoints, progress)
    }

    routes.push({ key, rep, origin, markerPos, routeLine: waypoints, isLive, isReceived, isNotDeparted, progress, items })
    bounds.push(markerPos)
    if (!isReceived) bounds.push([origin.lat, origin.lng])
  }

  return (
    <div className="w-full" style={{ minHeight: 480 }}>
      <MapContainer
        center={[30, 160]}
        zoom={3}
        style={{ height: 480, width: '100%', borderRadius: 12, background: '#0d1117' }}
        zoomControl
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; OpenStreetMap &copy; CARTO'
          subdomains="abcd"
          maxZoom={19}
        />
        <FitBounds bounds={bounds} />

        {/* LA port anchor */}
        <Marker position={[dest.lat, dest.lng]} icon={makeIcon('⚓')}>
          <Popup>
            <div style={{ fontWeight: 700 }}>Port of Los Angeles</div>
            <div style={{ color: '#888', fontSize: 12 }}>Destination</div>
          </Popup>
        </Marker>

        {routes.map(({ key, rep, origin, markerPos, routeLine, isLive, isReceived, isNotDeparted, progress, items }) => {
          const isAir = rep.freight_method === 'AIR'
          const emoji = isReceived ? '📦' : isNotDeparted ? '🏭' : isAir ? '✈️' : '🚢'
          const color = STATUS_COLOR[rep.status] ?? '#6B7280'
          const totalCases = items.reduce((a, s) => a + (s.case_qty ?? 0), 0)
          const totalInv = items.reduce((a, s) => a + (s.comm_inv_amt ?? 0), 0)

          // Route line: origin → current pos (solid) + current → dest (dashed)
          const traveledLine: [number, number][] = isReceived
            ? []
            : [...routeLine.slice(0, Math.ceil(routeLine.length * Math.min(progress, 0.99) + 1)), markerPos]
          const remainingLine: [number, number][] = isReceived
            ? []
            : [markerPos, ...routeLine.slice(-3), [dest.lat, dest.lng]]

          const posLabel = isLive
            ? '<span style="color:#22c55e;font-weight:700">🟢 LIVE POSITION</span>'
            : isNotDeparted
            ? '<span style="color:#9898A8">⬜ NOT YET DEPARTED</span>'
            : '<span style="color:#f59e0b;font-weight:700">🟡 ESTIMATED</span>'

          return (
            <div key={key}>
              {/* Traveled portion */}
              {traveledLine.length > 1 && (
                <Polyline
                  positions={traveledLine}
                  pathOptions={{ color, weight: 2.5, opacity: 0.8 }}
                />
              )}
              {/* Remaining portion */}
              {remainingLine.length > 1 && (
                <Polyline
                  positions={remainingLine}
                  pathOptions={{ color, weight: 1.5, opacity: 0.35, dashArray: '6 5' }}
                />
              )}

              <Marker position={markerPos} icon={makeIcon(emoji)}>
                <Popup>
                  <div style={{ fontSize: 13, minWidth: 230, lineHeight: 1.6 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                      {isAir ? '✈️' : '🚢'} {rep.vessel_name ?? 'Unknown Vessel'}
                    </div>
                    <div dangerouslySetInnerHTML={{ __html: posLabel }} style={{ marginBottom: 6 }} />
                    <div><b>Status:</b> {rep.status}</div>
                    <div><b>Booking:</b> {rep.booking_number ?? '—'}</div>
                    {rep.container_number && <div><b>Container:</b> {rep.container_number}</div>}
                    <div><b>From:</b> {origin.label}</div>
                    <div><b>ETD:</b> {rep.etd ?? '—'}</div>
                    <div><b>ETA LA:</b> {rep.eta_los_angeles ?? '—'} ({etaDays(rep.eta_los_angeles)})</div>
                    <div><b>Items:</b> {items.length} · {totalCases} cases</div>
                    {totalInv > 0 && (
                      <div><b>Comm Inv:</b> ${totalInv.toLocaleString('en-US', { minimumFractionDigits: 0 })}</div>
                    )}
                    {isLive && rep.last_tracked && (
                      <div style={{ color: '#888', fontSize: 11, marginTop: 4 }}>
                        Updated {new Date(rep.last_tracked).toLocaleString()}
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>
            </div>
          )
        })}
      </MapContainer>

      {/* Legend */}
      <div className="flex items-center justify-between mt-2 px-1">
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span>🚢 Ocean</span>
          <span>✈️ Air</span>
          <span>🏭 Not departed</span>
          <span>📦 Received</span>
          <span>⚓ LA Port</span>
          <span className="text-green-400">🟢 Live</span>
          <span className="text-amber-400">🟡 Estimated</span>
        </div>
        <p className="text-xs text-gray-600">
          Live tracking by{' '}
          <a href="https://shipsgo.com" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
            ShipsGo
          </a>
          {' '}· Estimated from ETD/ETA
        </p>
      </div>
    </div>
  )
}
