'use client'

import { useState } from 'react'

interface Shipment {
  id: string
  vessel_name?: string | null
  freight_method?: string
  status?: string
  eta_los_angeles?: string | null
  etd?: string | null
  booking_number?: string | null
  shipper?: string | null
  current_lat?: number | null
  current_lng?: number | null
  last_tracked?: string | null
}

// Equirectangular projection — maps lat/lng to percentage positions on map
function toXY(lat: number, lng: number): [number, number] {
  const x = ((lng + 180) / 360) * 100
  const y = ((90 - lat) / 180) * 100
  return [x, y]
}

function getOrigin(shipper: string | null, vessel: string | null): [number, number] {
  const s = (shipper || '').toUpperCase()
  const v = (vessel || '').toUpperCase()
  if (s.includes('PARAS') || s.includes('BUZIL') || s.includes('PVT'))
    return [18.92, 72.83]
  if (s.includes('SHANDONG') || s.includes('SHENGHE'))
    return [36.07, 120.37]
  if (s.includes('XIAMEN') || s.includes('HONGJU'))
    return [24.48, 118.09]
  if (s.includes('YICHEN') || s.includes('ENTEN'))
    return [31.23, 121.47]
  if (v.includes('KLM') || s.includes('KLM'))
    return [52.31, 4.76]
  return [31.23, 121.47]
}

function getWaypoints(origin: [number, number], freight: string): [number, number][] {
  const LA: [number, number] = [33.74, -118.28]
  const LAX: [number, number] = [33.94, -118.41]

  if (freight === 'AIR') {
    if (origin[0] > 45) {
      // Europe to LAX
      return [origin, [55, -10], [50, -30], [45, -55], [40, -90], LAX]
    }
    // Asia to LAX polar
    return [origin, [45, 135], [55, 160], [60, -175], [55, -150], [48, -125], LAX]
  }

  // India via Malacca
  if (origin[1] < 85) {
    return [origin, [8, 77], [1.3, 103.8], [8, 112], [20, 125], [35, 150], [44, 175], [44, -175], [40, -158], [34, -125], LA]
  }
  // China north
  if (origin[0] > 33) {
    return [origin, [34, 128], [38, 145], [44, 165], [46, 178], [46, -178], [42, -158], [37, -138], [34, -122], LA]
  }
  // China south/central
  return [origin, [22, 122], [28, 135], [38, 155], [44, 175], [44, -175], [41, -160], [36, -138], [34, -122], LA]
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

const COLORS = [
  '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899',
  '#14b8a6', '#f97316', '#84cc16', '#a855f7',
  '#ef4444', '#06b6d4',
]

export default function ImportMap({ shipments }: { shipments: Shipment[] }) {
  const [hovered, setHovered] = useState<string | null>(null)

  const groups: Record<string, Shipment[]> = {}
  shipments.forEach(s => {
    const k = s.booking_number || s.id
    if (!groups[k]) groups[k] = []
    groups[k].push(s)
  })

  const now = Date.now()
  const LA = toXY(33.74, -118.28)

  const vessels = Object.entries(groups).map(([key, items], idx) => {
    const first = items[0]
    const isAir = first.freight_method === 'AIR'
    const isDone = first.status === 'Received' || first.status === 'Delivered'

    let progress = 0
    if (first.etd && first.eta_los_angeles) {
      const etd = new Date(first.etd).getTime()
      const eta = new Date(first.eta_los_angeles).getTime()
      progress = Math.max(0, Math.min(0.98, (now - etd) / (eta - etd)))
    }

    const origin = getOrigin(first.shipper ?? null, first.vessel_name ?? null)
    const waypoints = getWaypoints(origin, first.freight_method || 'OCEAN')

    let currentLatLng: [number, number]
    if (isDone) {
      currentLatLng = [33.74, -118.28]
    } else if (first.current_lat && first.current_lng) {
      currentLatLng = [first.current_lat, first.current_lng]
    } else {
      currentLatLng = interpolate(waypoints, progress)
    }

    const color = isAir ? '#22d3ee' : COLORS[idx % COLORS.length]
    const eta = first.eta_los_angeles
      ? new Date(first.eta_los_angeles + 'T12:00:00')
          .toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : '—'
    const daysLeft = first.eta_los_angeles
      ? Math.ceil((new Date(first.eta_los_angeles).getTime() - now) / 86400000)
      : null

    return { key, items, first, origin, waypoints, currentLatLng, progress, color, isAir, isDone, eta, daysLeft }
  })

  return (
    <div className="space-y-3">
      {/* Map container */}
      <div className="relative bg-[#0a1628] rounded-2xl overflow-hidden border border-[#2A2A35]" style={{ paddingTop: '50%' }}>
        <div className="absolute inset-0">
          <svg viewBox="0 0 100 50" className="w-full h-full" preserveAspectRatio="none">
            <rect width="100" height="50" fill="#0a1628" />

            {/* Grid lines - latitude */}
            {[-60, -30, 0, 30, 60].map(lat => {
              const [, y] = toXY(lat, 0)
              return <line key={lat} x1="0" y1={y} x2="100" y2={y} stroke="#1a2a3a" strokeWidth="0.1" />
            })}
            {/* Grid lines - longitude */}
            {[-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150, 180].map(lng => {
              const [x] = toXY(0, lng)
              return <line key={lng} x1={x} y1="0" x2={x} y2="50" stroke="#1a2a3a" strokeWidth="0.1" />
            })}

            {/* Continent outlines — coordinates in equirectangular % space (toXY output) */}
            {/* North America */}
            <polygon points="8,10 15,9 22,11 26,13 28,16 27,20 24,23 22,26 19,29 16,31 13,29 10,26 8,22 7,18 7,14" fill="#1a3a28" stroke="#2d5a40" strokeWidth="0.2" />
            {/* South America */}
            <polygon points="18,29 22,28 26,30 27,34 26,40 23,45 19,47 16,45 14,40 14,35 15,31" fill="#1a3a28" stroke="#2d5a40" strokeWidth="0.2" />
            {/* Europe */}
            <polygon points="45,8 52,7 55,9 54,12 50,14 47,13 44,11" fill="#1a3a28" stroke="#2d5a40" strokeWidth="0.2" />
            {/* Africa */}
            <polygon points="44,13 52,12 57,14 59,18 58,24 55,30 50,35 45,36 41,32 40,26 40,20 41,16" fill="#1a3a28" stroke="#2d5a40" strokeWidth="0.2" />
            {/* Russia/Europe landmass */}
            <polygon points="46,6 60,5 75,7 85,8 90,10 88,13 80,14 70,13 60,12 50,11 46,9" fill="#1a3a28" stroke="#2d5a40" strokeWidth="0.2" />
            {/* Asia main */}
            <polygon points="55,8 75,7 88,8 92,10 94,13 90,16 85,18 80,19 75,20 70,21 65,20 60,18 56,15 54,12" fill="#1a3a28" stroke="#2d5a40" strokeWidth="0.2" />
            {/* India */}
            <polygon points="58,17 64,16 67,18 67,22 65,26 62,27 59,25 57,21" fill="#1a3a28" stroke="#2d5a40" strokeWidth="0.2" />
            {/* SE Asia */}
            <polygon points="72,18 78,17 82,19 83,22 80,24 75,24 72,22" fill="#1a3a28" stroke="#2d5a40" strokeWidth="0.2" />
            {/* Australia */}
            <polygon points="76,32 84,31 88,33 89,37 87,41 82,43 76,42 72,39 71,35 73,32" fill="#1a3a28" stroke="#2d5a40" strokeWidth="0.2" />
            {/* Greenland */}
            <polygon points="32,3 38,2 42,4 41,8 37,10 32,9 30,6" fill="#1a3a28" stroke="#2d5a40" strokeWidth="0.2" />
            {/* Japan */}
            <polygon points="86,14 88,13 89,15 88,17 86,16" fill="#1a3a28" stroke="#2d5a40" strokeWidth="0.2" />

            {/* Route lines — full dashed */}
            {vessels.map((v, i) => {
              if (v.isDone) return null
              const segments: string[][] = []
              let current: string[] = []
              v.waypoints.forEach(([lat, lng], idx) => {
                const [x, y] = toXY(lat, lng)
                if (idx > 0) {
                  const prevLng = v.waypoints[idx - 1][1]
                  if (Math.abs(lng - prevLng) > 180) {
                    segments.push(current)
                    current = []
                  }
                }
                current.push(`${x.toFixed(2)},${y.toFixed(2)}`)
              })
              segments.push(current)
              return segments.map((seg, si) => (
                <polyline key={`${i}-${si}`}
                  points={seg.join(' ')}
                  fill="none"
                  stroke={v.color}
                  strokeWidth="0.3"
                  strokeOpacity="0.4"
                  strokeDasharray="0.5,0.5"
                />
              ))
            })}

            {/* Completed route portions */}
            {vessels.map((v, i) => {
              if (v.isDone || v.progress <= 0) return null
              const completedWps: [number, number][] = []
              const totalSeg = v.waypoints.length - 1
              const stopAt = Math.floor(v.progress * totalSeg)
              for (let j = 0; j <= stopAt && j < v.waypoints.length; j++) {
                completedWps.push(v.waypoints[j])
              }
              completedWps.push(v.currentLatLng)

              const segments: string[][] = []
              let current: string[] = []
              completedWps.forEach(([lat, lng], idx) => {
                const [x, y] = toXY(lat, lng)
                if (idx > 0) {
                  const prevLng = completedWps[idx - 1][1]
                  if (Math.abs(lng - prevLng) > 180) {
                    segments.push(current)
                    current = []
                  }
                }
                current.push(`${x.toFixed(2)},${y.toFixed(2)}`)
              })
              segments.push(current)

              return segments.map((seg, si) => (
                <polyline key={`comp-${i}-${si}`}
                  points={seg.join(' ')}
                  fill="none"
                  stroke={v.color}
                  strokeWidth="0.6"
                  strokeOpacity="0.9"
                />
              ))
            })}

            {/* LA Port */}
            <circle cx={LA[0]} cy={LA[1]} r="0.8" fill="#00C896" opacity="0.5" />
            <circle cx={LA[0]} cy={LA[1]} r="0.4" fill="#00C896" />
            <text x={LA[0] + 0.8} y={LA[1] + 0.3} fill="#00C896" fontSize="1.2" fontWeight="bold">LA</text>

            {/* Vessel markers */}
            {vessels.map((v) => {
              const [x, y] = toXY(v.currentLatLng[0], v.currentLatLng[1])
              const isHovered = hovered === v.key

              return (
                <g key={v.key}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHovered(v.key)}
                  onMouseLeave={() => setHovered(null)}
                >
                  {/* Pulse ring */}
                  {!v.isDone && (
                    <circle cx={x} cy={y} r={isHovered ? '2.5' : '1.8'}
                      fill="none"
                      stroke={v.color}
                      strokeWidth="0.3"
                      opacity="0.5"
                    />
                  )}
                  {/* Vessel dot */}
                  <circle cx={x} cy={y} r="1"
                    fill={v.isDone ? '#00C896' : v.color}
                    stroke="white"
                    strokeWidth="0.2"
                  />
                  {/* Icon */}
                  <text x={x} y={y + 0.4}
                    textAnchor="middle"
                    fontSize="1"
                    fill="white"
                  >
                    {v.isDone ? '✓' : v.isAir ? '✈' : '▲'}
                  </text>
                  {/* Vessel name label */}
                  <text x={x} y={y - 1.4}
                    textAnchor="middle"
                    fill="white"
                    fontSize="0.9"
                    fontWeight="500"
                    opacity="0.9"
                  >
                    {(v.first.vessel_name || '').split(' ').slice(0, 2).join(' ').substring(0, 14)}
                  </text>

                  {/* Tooltip on hover */}
                  {isHovered && (() => {
                    const tw = 18
                    const th = 8
                    let tx = x + 1.5
                    let ty = y - th / 2
                    if (tx + tw > 98) tx = x - tw - 1.5
                    if (ty < 1) ty = 1
                    if (ty + th > 48) ty = 48 - th
                    return (
                      <g>
                        <rect x={tx} y={ty} width={tw} height={th}
                          rx="0.5" fill="#0f1f2e" stroke={v.color}
                          strokeWidth="0.2" opacity="0.95"
                        />
                        <text x={tx + 0.6} y={ty + 1.8} fill="white" fontSize="1.1" fontWeight="bold">
                          {(v.first.vessel_name || 'Unknown').substring(0, 20)}
                        </text>
                        <text x={tx + 0.6} y={ty + 3.2} fill="#9ca3af" fontSize="0.9">
                          {v.first.freight_method} · {v.first.status}
                        </text>
                        <text x={tx + 0.6} y={ty + 4.4} fill={v.color} fontSize="0.9">
                          Progress: {Math.round(v.progress * 100)}% · ETA: {v.eta}
                        </text>
                        <text x={tx + 0.6} y={ty + 5.6} fill="#9ca3af" fontSize="0.9">
                          {v.items.length} items · Bkg: {(v.first.booking_number || '—').substring(0, 12)}
                        </text>
                        <text x={tx + 0.6} y={ty + 6.8} fill={v.first.current_lat ? '#00C896' : '#f59e0b'} fontSize="0.85">
                          {v.first.current_lat ? '🟢 Live position' : '🟡 Estimated position'}
                        </text>
                      </g>
                    )
                  })()}
                </g>
              )
            })}
          </svg>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1">
        {vessels.map(v => (
          <div key={v.key}
            className="flex items-center gap-1.5 text-xs text-gray-400"
            onMouseEnter={() => setHovered(v.key)}
            onMouseLeave={() => setHovered(null)}
          >
            <span className="w-3 h-1.5 rounded-full inline-block"
              style={{ backgroundColor: v.color }} />
            <span>{(v.first.vessel_name || 'Unknown').substring(0, 20)}</span>
            <span className="text-gray-600">
              ({v.isDone ? 'Received' : v.eta})
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
        <a href="https://www.marinetraffic.com" target="_blank"
          className="text-blue-500 hover:underline">
          MarineTraffic.com
        </a>
      </p>
    </div>
  )
}
