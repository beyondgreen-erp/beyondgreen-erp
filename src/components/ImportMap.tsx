'use client'

import { useState } from 'react'
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
  Line,
  ZoomableGroup,
} from 'react-simple-maps'

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'

interface Shipment {
  id: string
  vessel_name?: string | null
  freight_method?: string | null
  status?: string | null
  eta_los_angeles?: string | null
  etd?: string | null
  booking_number?: string | null
  shipper?: string | null
  current_lat?: number | null
  current_lng?: number | null
  last_tracked?: string | null
}

// react-simple-maps uses [longitude, latitude]
function getOrigin(shipper: string | null, vessel: string | null): [number, number] {
  const s = (shipper || '').toUpperCase()
  const v = (vessel || '').toUpperCase()
  if (s.includes('PARAS') || s.includes('BUZIL') || s.includes('PVT'))
    return [72.83, 18.92]   // Mumbai
  if (s.includes('SHANDONG') || s.includes('SHENGHE'))
    return [120.37, 36.07]  // Qingdao
  if (s.includes('XIAMEN') || s.includes('HONGJU'))
    return [118.09, 24.48]  // Xiamen
  if (s.includes('YICHEN') || s.includes('ENTEN'))
    return [121.47, 31.23]  // Shanghai
  if (v.includes('KLM') || s.includes('KLM'))
    return [4.76, 52.31]    // Amsterdam
  return [121.47, 31.23]    // Default Shanghai
}

function getWaypoints(origin: [number, number], freight: string): [number, number][] {
  const LA: [number, number] = [-118.28, 33.74]
  const LAX: [number, number] = [-118.41, 33.94]

  if (freight === 'AIR') {
    if (origin[0] < 20 && origin[1] > 45) {
      // Europe to LAX
      return [origin, [-10, 55], [-30, 50], [-55, 45], [-90, 40], LAX]
    }
    // Asia polar to LAX
    return [origin, [135, 45], [160, 55], [-175, 60], [-150, 58], [-130, 52], [-125, 45], LAX]
  }

  // India via Malacca Strait
  if (origin[0] < 85) {
    return [
      origin,
      [77, 8], [98, 3], [103.8, 1.3], [110, 7], [118, 15],
      [125, 22], [135, 30], [152, 40], [172, 44],
      [-178, 44], [-158, 41], [-140, 37], [-125, 35], [-122, 34],
      LA,
    ]
  }

  // Qingdao (north China, lat > 33)
  if (origin[1] > 33) {
    return [
      origin,
      [128, 34], [140, 36], [155, 42], [170, 46],
      [178, 46], [-178, 46], [-160, 43], [-140, 38], [-122, 34],
      LA,
    ]
  }

  // Xiamen / south China
  if (origin[1] < 30) {
    return [
      origin,
      [122, 22], [135, 28], [152, 38], [170, 44],
      [-178, 44], [-160, 41], [-138, 36], [-122, 34],
      LA,
    ]
  }

  // Shanghai default
  return [
    origin,
    [125, 28], [140, 32], [155, 40], [175, 45],
    [-178, 45], [-160, 42], [-140, 37], [-122, 34],
    LA,
  ]
}

function interpolate(pts: [number, number][], t: number): [number, number] {
  if (t <= 0) return pts[0]
  if (t >= 1) return pts[pts.length - 1]
  const n = pts.length - 1
  const i = Math.floor(t * n)
  const f = (t * n) - i
  if (i >= n) return pts[n]
  return [
    pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f,
    pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f,
  ]
}

const VESSEL_COLORS = [
  '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899',
  '#14b8a6', '#f97316', '#84cc16', '#a855f7',
  '#ef4444', '#06b6d4',
]

interface VesselInfo {
  key: string
  name: string
  color: string
  isAir: boolean
  isDone: boolean
  currentPos: [number, number]
  waypoints: [number, number][]
  progress: number
  status: string
  eta: string
  daysLeft: number | null
  itemCount: number
  booking: string
  isLive: boolean
  shipper: string
}

export default function ImportMap({ shipments }: { shipments: Shipment[] }) {
  const [tooltip, setTooltip] = useState<VesselInfo | null>(null)
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

  const now = Date.now()

  const groups: Record<string, Shipment[]> = {}
  shipments.forEach(s => {
    const k = s.booking_number || s.id
    if (!groups[k]) groups[k] = []
    groups[k].push(s)
  })

  const vessels: VesselInfo[] = Object.entries(groups).map(([key, items], idx) => {
    const first = items[0]
    const isAir = (first.freight_method || '') === 'AIR'
    const isDone = first.status === 'Received' || first.status === 'Delivered'

    let progress = 0
    if (first.etd && first.eta_los_angeles) {
      const etd = new Date(first.etd).getTime()
      const eta = new Date(first.eta_los_angeles).getTime()
      progress = Math.max(0, Math.min(0.98, (now - etd) / (eta - etd)))
    }

    const origin = getOrigin(first.shipper ?? null, first.vessel_name ?? null)
    const waypoints = getWaypoints(origin, first.freight_method || 'OCEAN')

    const isLive = !!(
      first.current_lat && first.current_lng && first.last_tracked &&
      Date.now() - new Date(first.last_tracked).getTime() < 4 * 3600000
    )

    let currentPos: [number, number]
    if (isDone) {
      currentPos = [-118.28, 33.74]
    } else if (isLive) {
      currentPos = [first.current_lng!, first.current_lat!]
    } else {
      currentPos = interpolate(waypoints, progress)
    }

    const etaDate = first.eta_los_angeles
      ? new Date(first.eta_los_angeles + 'T12:00:00')
      : null
    const daysLeft = etaDate
      ? Math.ceil((etaDate.getTime() - now) / 86400000)
      : null
    const etaLabel = etaDate
      ? etaDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : '—'

    const color = isAir ? '#22d3ee' : VESSEL_COLORS[idx % VESSEL_COLORS.length]

    return {
      key,
      name: first.vessel_name || 'Unknown',
      color,
      isAir,
      isDone,
      currentPos,
      waypoints,
      progress: Math.round(progress * 100),
      status: first.status || 'Unknown',
      eta: etaLabel,
      daysLeft,
      itemCount: items.length,
      booking: first.booking_number || '—',
      isLive,
      shipper: (first.shipper || '').split(',')[0].split(' ').slice(0, 3).join(' '),
    }
  })

  return (
    <div className="space-y-3">
      {/* Map */}
      <div
        className="relative bg-[#EFF3FA] rounded-2xl overflow-hidden border border-[#E4E6EE]"
        onMouseMove={e => {
          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
          setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
        }}
        onMouseLeave={() => setTooltip(null)}
      >
        <ComposableMap
          projection="geoNaturalEarth1"
          projectionConfig={{ scale: 153, center: [10, 20] }}
          style={{ width: '100%', height: '520px', background: '#0a1628' }}
        >
          <ZoomableGroup>
            <Geographies geography={GEO_URL}>
              {({ geographies }) =>
                geographies.map(geo => (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill="#1a3a28"
                    stroke="#2d5a40"
                    strokeWidth={0.3}
                    style={{
                      default: { outline: 'none' },
                      hover: { outline: 'none', fill: '#1f4530' },
                      pressed: { outline: 'none' },
                    }}
                  />
                ))
              }
            </Geographies>

            {/* Full route lines (dim dashed) */}
            {vessels.map(v => {
              if (v.isDone) return null
              return (
                <Line
                  key={`route-${v.key}`}
                  coordinates={v.waypoints}
                  stroke={v.color}
                  strokeWidth={0.8}
                  strokeOpacity={0.25}
                  strokeDasharray="3,3"
                  fill="none"
                />
              )
            })}

            {/* Completed route (bright) */}
            {vessels.map(v => {
              if (v.isDone || v.progress <= 0) return null
              const n = v.waypoints.length - 1
              const stopIdx = Math.floor((v.progress / 100) * n)
              const completed: [number, number][] = [
                ...v.waypoints.slice(0, stopIdx + 1),
                v.currentPos,
              ]
              return (
                <Line
                  key={`done-${v.key}`}
                  coordinates={completed}
                  stroke={v.color}
                  strokeWidth={2}
                  strokeOpacity={0.9}
                  fill="none"
                />
              )
            })}

            {/* LA Port */}
            <Marker coordinates={[-118.28, 33.74]}>
              <circle r={5} fill="#00C896" fillOpacity={0.3} stroke="#00C896" strokeWidth={1.5} />
              <circle r={2.5} fill="#00C896" />
              <text y={-10} textAnchor="middle" fill="#00C896" fontSize={9} fontWeight="bold">
                LA/LB Port
              </text>
            </Marker>

            {/* Vessel markers */}
            {vessels.map(v => (
              <Marker
                key={`marker-${v.key}`}
                coordinates={v.currentPos}
                onMouseEnter={() => setTooltip(v)}
                onMouseLeave={() => setTooltip(null)}
              >
                {!v.isDone && (
                  <circle r={10} fill="none" stroke={v.color} strokeWidth={1} opacity={0.4} />
                )}
                <circle
                  r={7}
                  fill={v.isDone ? '#00C896' : v.color}
                  stroke="white"
                  strokeWidth={1}
                  style={{ cursor: 'pointer' }}
                />
                <text
                  textAnchor="middle"
                  y={4}
                  fontSize={8}
                  fill="white"
                  style={{ pointerEvents: 'none' }}
                >
                  {v.isDone ? '✓' : v.isAir ? '✈' : '▲'}
                </text>
                <text
                  textAnchor="middle"
                  y={-13}
                  fontSize={8}
                  fill="white"
                  fontWeight="500"
                  style={{ pointerEvents: 'none' }}
                >
                  {v.name.split(' ').slice(0, 3).join(' ').substring(0, 16)}
                </text>
                {v.isLive && <circle cx={9} cy={-9} r={3} fill="#00C896" />}
              </Marker>
            ))}
          </ZoomableGroup>
        </ComposableMap>

        {/* Floating tooltip */}
        {tooltip && (
          <div
            className="absolute z-50 bg-[#0f1f2e] border rounded-xl p-3 shadow-2xl pointer-events-none text-xs min-w-48"
            style={{
              left: Math.min(mousePos.x + 12, 600),
              top: Math.max(mousePos.y - 80, 8),
              borderColor: tooltip.color,
            }}
          >
            <p className="font-bold text-white mb-1">{tooltip.name}</p>
            <p className="text-gray-400">{tooltip.isAir ? '✈ Air' : '🚢 Ocean'} · {tooltip.status}</p>
            <p style={{ color: tooltip.color }}>Progress: {tooltip.progress}%</p>
            <p className="text-gray-400">
              ETA: {tooltip.eta}
              {tooltip.daysLeft !== null && (
                <span className={tooltip.daysLeft < 0 ? ' text-red-400' : tooltip.daysLeft < 4 ? ' text-amber-400' : ' text-blue-400'}>
                  {' '}({tooltip.daysLeft > 0 ? tooltip.daysLeft + 'd left' : 'overdue'})
                </span>
              )}
            </p>
            <p className="text-gray-400">{tooltip.itemCount} items · Bkg: {tooltip.booking.substring(0, 14)}</p>
            {tooltip.shipper && <p className="text-gray-500 mt-0.5">{tooltip.shipper}</p>}
            <p className={`mt-1 font-medium ${tooltip.isLive ? 'text-emerald-400' : 'text-amber-400'}`}>
              {tooltip.isLive ? '🟢 Live GPS position' : '🟡 Estimated from ETD/ETA'}
            </p>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-2 px-1">
        {vessels.map(v => (
          <div
            key={v.key}
            className="flex items-center gap-1.5 text-xs text-gray-400 cursor-default"
            onMouseEnter={() => setTooltip(v)}
            onMouseLeave={() => setTooltip(null)}
          >
            <span className="w-3 h-1.5 rounded-full inline-block" style={{ backgroundColor: v.color }} />
            <span>{v.name.substring(0, 20)}</span>
            <span className="text-gray-600">
              ({v.isDone ? '✅ Received' : v.eta})
            </span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 text-xs text-emerald-400">
          <span className="w-3 h-1.5 rounded-full inline-block bg-emerald-400" />
          LA/LB Port
        </div>
      </div>

      <p className="text-xs text-gray-600 text-center">
        Hover vessels for details · Positions estimated from ETD/ETA ·{' '}
        <a
          href="https://www.marinetraffic.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:underline"
        >
          MarineTraffic.com for live tracking
        </a>
      </p>
    </div>
  )
}
