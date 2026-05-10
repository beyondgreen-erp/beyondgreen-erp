'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

interface ShipmentPoint {
  id: string
  customer_name: string | null
  ship_date: string | null
  carrier: string | null
  tracking_number: string | null
  ship_cost: number | null
  city: string | null
  state: string | null
}

interface Props {
  shipments: ShipmentPoint[]
  mode: 'map' | 'heatmap'
}

const CITY_COORDS: Record<string, [number, number]> = {
  'Chicago_IL': [41.8781, -87.6298],
  'Los Angeles_CA': [34.0522, -118.2437],
  'New York_NY': [40.7128, -74.0060],
  'Las Vegas_NV': [36.1699, -115.1398],
  'San Antonio_TX': [29.4241, -98.4936],
  'Austin_TX': [30.2672, -97.7431],
  'Plantation_FL': [26.1276, -80.2331],
  'Seattle_WA': [47.6062, -122.3321],
  'Encinitas_CA': [33.0369, -117.2920],
  'Berkeley_CA': [37.8716, -122.2727],
  'Santa Ana_CA': [33.7455, -117.8677],
  'Daly City_CA': [37.6879, -122.4702],
  'Garden Grove_CA': [33.7739, -117.9600],
  'Rye_NY': [40.9807, -73.6871],
  'Cherry Hill_NJ': [39.9348, -74.9813],
  'Summit_NJ': [40.7154, -74.3593],
  'Westampton_NJ': [40.0076, -74.8327],
  'Dover_DE': [39.1582, -75.5244],
  'Lancaster_SC': [34.7204, -80.7737],
  'The Colony_TX': [33.0851, -96.8886],
  'St Petersburg_FL': [27.7676, -82.6403],
  'Plainview_TX': [34.1845, -101.7068],
}

const CARRIER_COLORS: Record<string, string> = {
  'UPS': '#8B4513',
  'FedEx': '#4B0082',
  'Walmart Fleet': '#0071CE',
  'USPS': '#CC0000',
}

function getCarrierColor(carrier: string | null): string {
  if (!carrier) return '#666666'
  for (const [k, v] of Object.entries(CARRIER_COLORS)) {
    if (carrier.toLowerCase().includes(k.toLowerCase())) return v
  }
  return '#666666'
}

function getCoords(s: ShipmentPoint, index: number): [number, number] | null {
  if (s.city && s.state) {
    const key = `${s.city}_${s.state}`
    if (CITY_COORDS[key]) return CITY_COORDS[key]
  }
  // Place unknown shipments at a central US point with jitter
  const seed = index * 13.7
  const lat = 39.5 + ((seed % 10) - 5) * 0.8
  const lng = -98.35 + ((seed % 7) - 3.5) * 1.2
  return [lat, lng]
}

function HeatLayer({ points }: { points: { lat: number; lng: number; count: number; value: number }[] }) {
  const maxCount = Math.max(...points.map(p => p.count), 1)
  return (
    <>
      {points.map((p, i) => {
        const intensity = p.count / maxCount
        const r = Math.round(255 * Math.min(intensity * 2, 1))
        const g = Math.round(255 * Math.max(1 - intensity * 1.5, 0))
        const color = `rgb(${r},${g},0)`
        const radius = 15 + intensity * 50
        return (
          <CircleMarker key={i} center={[p.lat, p.lng]} radius={radius}
            pathOptions={{ fillColor: color, fillOpacity: 0.5, color: color, weight: 1, opacity: 0.6 }}>
            <Popup>
              <div className="text-xs">
                <div className="font-semibold">{p.count} shipments</div>
                <div>${p.value.toFixed(2)} total cost</div>
              </div>
            </Popup>
          </CircleMarker>
        )
      })}
    </>
  )
}

function ShipmentCounter({ count }: { count: number }) {
  const map = useMap()
  useEffect(() => {
    const el = document.createElement('div')
    el.style.cssText = 'position:absolute;top:10px;left:50px;z-index:1000;background:rgba(17,24,39,0.9);color:white;padding:6px 12px;border-radius:8px;font-size:12px;border:1px solid rgba(255,255,255,0.1)'
    el.textContent = `${count} shipments`
    map.getContainer().appendChild(el)
    return () => { el.remove() }
  }, [map, count])
  return null
}

export default function ShipmentMap({ shipments, mode }: Props) {
  // Build per-city aggregates for heatmap
  const cityAgg: Record<string, { lat: number; lng: number; count: number; value: number }> = {}

  shipments.forEach((s, i) => {
    const coords = getCoords(s, i)
    if (!coords) return
    const key = s.city && s.state ? `${s.city}_${s.state}` : `center_${i}`
    if (!cityAgg[key]) cityAgg[key] = { lat: coords[0], lng: coords[1], count: 0, value: 0 }
    cityAgg[key].count++
    cityAgg[key].value += s.ship_cost || 0
  })

  const heatPoints = Object.values(cityAgg)

  const withCoords = shipments.map((s, i) => ({ s, coords: getCoords(s, i) })).filter(x => x.coords)

  return (
    <div style={{ height: '100%', width: '100%', minHeight: 480 }}>
      <MapContainer center={[39.5, -98.35]} zoom={4} style={{ height: '100%', width: '100%', minHeight: 480, borderRadius: 8 }}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        <ShipmentCounter count={shipments.length} />

        {mode === 'map' && withCoords.map(({ s, coords }, i) => (
          <CircleMarker key={s.id || i} center={coords!} radius={7}
            pathOptions={{ fillColor: getCarrierColor(s.carrier), fillOpacity: 0.85, color: '#fff', weight: 1 }}>
            <Popup>
              <div style={{ fontSize: 12, minWidth: 160 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{s.customer_name || '—'}</div>
                <div>Carrier: {s.carrier || '—'}</div>
                <div>Date: {s.ship_date || '—'}</div>
                <div>Cost: ${(s.ship_cost || 0).toFixed(2)}</div>
                {s.tracking_number && <div style={{ marginTop: 4, wordBreak: 'break-all' }}>Tracking: {s.tracking_number}</div>}
              </div>
            </Popup>
          </CircleMarker>
        ))}

        {mode === 'heatmap' && <HeatLayer points={heatPoints} />}
      </MapContainer>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap', fontSize: 11 }}>
        {mode === 'map' ? (
          Object.entries(CARRIER_COLORS).concat([['Other', '#666666']]).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#9ca3af' }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: v, flexShrink: 0 }} />
              {k}
            </div>
          ))
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#9ca3af' }}>
            <span>Low density</span>
            {['#ffff00','#ff8800','#ff0000'].map((c, i) => (
              <div key={i} style={{ width: 16, height: 16, borderRadius: '50%', background: c, opacity: 0.7 }} />
            ))}
            <span>High density</span>
          </div>
        )}
      </div>
    </div>
  )
}
