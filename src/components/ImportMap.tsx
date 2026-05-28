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
}

interface Props {
  shipments: ImportShipment[]
}

const PORTS: Record<string, { lat: number; lng: number; label: string }> = {
  SHANGHAI: { lat: 31.2304, lng: 121.4737, label: 'Shanghai' },
  XIAMEN: { lat: 24.4798, lng: 118.0894, label: 'Xiamen' },
  QINGDAO: { lat: 36.0671, lng: 120.3826, label: 'Qingdao' },
  LOS_ANGELES: { lat: 33.7405, lng: -118.2764, label: 'Los Angeles' },
  AMSTERDAM: { lat: 52.3676, lng: 4.9041, label: 'Amsterdam' },
  GUANGZHOU: { lat: 23.3924, lng: 113.2988, label: 'Guangzhou' },
  INDIA: { lat: 19.0760, lng: 72.8777, label: 'Mumbai' },
}

function getOriginPort(shipper: string | null, vesselName: string | null) {
  if (!shipper && !vesselName) return PORTS.SHANGHAI
  const text = `${shipper ?? ''} ${vesselName ?? ''}`.toUpperCase()
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
): { lat: number; lng: number; progress: number } {
  if (!etd || !eta) return { ...origin, progress: 0 }
  const start = new Date(etd).getTime()
  const end = new Date(eta).getTime()
  const now = Date.now()
  const progress = Math.max(0, Math.min(1, (now - start) / (end - start)))
  // Great circle interpolation with Pacific arc
  const lat = origin.lat + (dest.lat - origin.lat) * progress
  // Handle Pacific crossing (lng wraps)
  let lngDiff = dest.lng - origin.lng
  if (lngDiff < -180) lngDiff += 360
  if (lngDiff > 180) lngDiff -= 360
  const lng = origin.lng + lngDiff * progress
  return { lat, lng, progress }
}

function makeShipIcon(color: string, emoji: string) {
  return L.divIcon({
    className: '',
    html: `<div style="font-size:22px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.8));cursor:pointer;">${emoji}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  })
}

const STATUS_LINE_COLOR: Record<string, string> = {
  'In Transit': '#3B82F6',
  'Gated': '#6B7280',
  'At Port of Dispatch': '#F59E0B',
  'Air Cargo Warehouse': '#06B6D4',
  'Arriving Tomorrow': '#F59E0B',
  'Arriving Today': '#EF4444',
  'Received': '#10B981',
  'Cleared': '#14B8A6',
  'Delivered': '#059669',
  'Pending': '#4B5563',
}

function etaDays(eta: string | null): string {
  if (!eta) return '—'
  const diff = Math.round((new Date(eta).getTime() - Date.now()) / 86400000)
  if (diff < 0) return `${Math.abs(diff)}d late`
  if (diff === 0) return 'TODAY'
  if (diff === 1) return 'Tomorrow'
  return `${diff} days`
}

function FitBounds({ bounds }: { bounds: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (bounds.length > 0) {
      map.fitBounds(bounds as any, { padding: [40, 40] })
    }
  }, [map, bounds])
  return null
}

// Group shipments by booking/vessel to show one route line per vessel
function groupByVessel(shipments: ImportShipment[]) {
  const groups: Record<string, ImportShipment[]> = {}
  for (const s of shipments) {
    const key = s.booking_number ?? s.vessel_name ?? s.id
    if (!groups[key]) groups[key] = []
    groups[key].push(s)
  }
  return groups
}

export default function ImportMap({ shipments }: Props) {
  const activeShipments = shipments.filter(s => s.status !== 'Delivered')
  const vesselGroups = groupByVessel(activeShipments)
  const dest = PORTS.LOS_ANGELES

  type RouteInfo = {
    key: string
    rep: ImportShipment
    origin: { lat: number; lng: number; label: string }
    pos: { lat: number; lng: number; progress: number }
    items: ImportShipment[]
    icon: any
    color: string
  }
  const routes: RouteInfo[] = []
  const bounds: [number, number][] = [[dest.lat, dest.lng]]

  for (const [key, items] of Object.entries(vesselGroups)) {
    const rep = items[0]
    const origin = getOriginPort(rep.shipper, rep.vessel_name)
    const pos = estimatePosition(rep.etd, rep.eta_los_angeles, origin, dest)
    const isAir = rep.freight_method === 'AIR'
    const isReceived = ['Received', 'Cleared', 'Delivered'].includes(rep.status)
    const emoji = isReceived ? '📦' : isAir ? '✈️' : '🚢'
    const color = STATUS_LINE_COLOR[rep.status] ?? '#6B7280'
    routes.push({ key, rep, origin, pos, items, icon: makeShipIcon(color, emoji), color })
    bounds.push([pos.lat, pos.lng])
    bounds.push([origin.lat, origin.lng])
  }

  return (
    <div className="relative w-full h-full" style={{ minHeight: 480 }}>
      <MapContainer
        center={[20, 160]}
        zoom={3}
        style={{ height: '100%', width: '100%', minHeight: 480, borderRadius: 12, background: '#0d1117' }}
        zoomControl={true}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          subdomains="abcd"
          maxZoom={19}
        />

        <FitBounds bounds={bounds} />

        {/* LA port marker */}
        <Marker
          position={[dest.lat, dest.lng]}
          icon={makeShipIcon('#00C896', '⚓')}
        >
          <Popup>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Port of Los Angeles</div>
            <div style={{ fontSize: 12, color: '#666' }}>Destination</div>
          </Popup>
        </Marker>

        {routes.map(({ key, rep, origin, pos, items, icon, color }) => {
          const linePositions: [number, number][] = [
            [origin.lat, origin.lng],
            [pos.lat, pos.lng],
            [dest.lat, dest.lng],
          ]
          const isReceived = ['Received', 'Cleared', 'Delivered'].includes(rep.status)
          const totalCases = items.reduce((a, s) => a + (s.case_qty ?? 0), 0)
          return (
            <div key={key}>
              <Polyline
                positions={linePositions}
                pathOptions={{
                  color,
                  weight: 2,
                  opacity: isReceived ? 0.3 : 0.7,
                  dashArray: rep.status === 'In Transit' ? '8 4' : rep.status === 'Gated' ? '4 4' : undefined,
                }}
              />
              <Marker position={[pos.lat, pos.lng]} icon={icon}>
                <Popup>
                  <div style={{ fontSize: 13, minWidth: 220 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 14 }}>
                      {rep.freight_method === 'AIR' ? '✈️' : '🚢'} {rep.vessel_name ?? 'Unknown Vessel'}
                    </div>
                    <div><b>Status:</b> {rep.status}</div>
                    <div><b>Booking:</b> {rep.booking_number ?? '—'}</div>
                    <div><b>From:</b> {origin.label}</div>
                    <div><b>To:</b> Los Angeles</div>
                    <div><b>ETD:</b> {rep.etd ?? '—'}</div>
                    <div><b>ETA:</b> {rep.eta_los_angeles ?? '—'} ({etaDays(rep.eta_los_angeles)})</div>
                    <div><b>Items:</b> {items.length} line items | {totalCases} cases</div>
                  </div>
                </Popup>
              </Marker>
            </div>
          )
        })}
      </MapContainer>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 z-[1000] bg-[#111113]/90 border border-[#2A2A35] rounded-xl px-3 py-2 flex flex-col gap-1 text-xs text-[#9898A8]">
        <div className="flex items-center gap-2"><span>🚢</span> Ocean Freight</div>
        <div className="flex items-center gap-2"><span>✈️</span> Air Cargo</div>
        <div className="flex items-center gap-2"><span>📦</span> Received</div>
        <div className="flex items-center gap-2"><span>⚓</span> LA Port</div>
      </div>
    </div>
  )
}
