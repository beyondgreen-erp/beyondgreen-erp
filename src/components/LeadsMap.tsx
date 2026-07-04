'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { MapContainer, TileLayer, Circle, CircleMarker, Popup, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

export interface LeadPoint { id: string; name: string | null; lat: number; lng: number; email?: string | null; city?: string | null; state?: string | null }
export interface ScrapeArea { id: string; center_lat: number; center_lng: number; radius_miles: number; prompt?: string | null; created_at?: string | null; new_count?: number | null }

function FitBounds({ pts }: { pts: [number, number][] }) {
  const map = useMap()
  if (pts.length) {
    try {
      if (pts.length === 1) map.setView(pts[0], 10)
      else map.fitBounds(pts as any, { padding: [30, 30] })
    } catch { /* ignore */ }
  }
  return null
}

export default function LeadsMap({ leads, scrapes }: { leads: LeadPoint[]; scrapes: ScrapeArea[] }) {
  const pts: [number, number][] = [
    ...leads.filter(l => l.lat && l.lng).map(l => [l.lat, l.lng] as [number, number]),
    ...scrapes.filter(s => s.center_lat && s.center_lng).map(s => [s.center_lat, s.center_lng] as [number, number]),
  ]
  const center: [number, number] = pts[0] || [39.5, -98.35] // US center fallback
  return (
    <MapContainer center={center} zoom={5} style={{ height: '100%', width: '100%', borderRadius: 12 }} scrollWheelZoom>
      <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {scrapes.filter(s => s.center_lat && s.center_lng).map(s => (
        <Circle key={s.id} center={[s.center_lat, s.center_lng]} radius={(s.radius_miles || 25) * 1609.34}
          pathOptions={{ color: '#6366F1', fillColor: '#6366F1', fillOpacity: 0.08, weight: 1.5 }}>
          <Popup>
            <b>{s.prompt || 'Scrape'}</b><br />
            {s.radius_miles} mi radius{s.new_count != null ? ` · ${s.new_count} leads` : ''}<br />
            <span style={{ color: '#666' }}>{s.created_at ? new Date(s.created_at).toLocaleDateString() : ''}</span>
          </Popup>
        </Circle>
      ))}
      {leads.filter(l => l.lat && l.lng).map(l => (
        <CircleMarker key={l.id} center={[l.lat, l.lng]} radius={5}
          pathOptions={{ color: l.email ? '#10B981' : '#F59E0B', fillColor: l.email ? '#10B981' : '#F59E0B', fillOpacity: 0.9, weight: 1 }}>
          <Popup>
            <b>{l.name}</b><br />
            {[l.city, l.state].filter(Boolean).join(', ')}<br />
            {l.email ? <a href={`mailto:${l.email}`}>{l.email}</a> : <span style={{ color: '#B45309' }}>no email found</span>}
          </Popup>
        </CircleMarker>
      ))}
      <FitBounds pts={pts} />
    </MapContainer>
  )
}
