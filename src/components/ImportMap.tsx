'use client'

import { useState } from 'react'

export interface ImportShipment {
  id: string
  vessel_name: string | null
  freight_method: string
  status: string
  eta_los_angeles: string | null
  etd: string | null
  booking_number: string | null
  shipper: string | null
  container_number: string | null
  bl_number: string | null
  current_lat: number | null
  current_lng: number | null
  last_tracked: string | null
  description?: string
  case_qty?: number
  comm_inv_amt?: number
}

// ── Projection (equirectangular, viewBox 0 0 1000 500) ────────────────────────
function project(lat: number, lng: number): [number, number] {
  return [(lng + 180) * (1000 / 360), (90 - lat) * (500 / 180)]
}

// ── Vessel colors — one per booking group ─────────────────────────────────────
const VESSEL_COLORS = [
  '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899',
  '#14b8a6', '#f97316', '#84cc16', '#a855f7', '#ef4444',
]
const AIR_COLOR = '#22d3ee'

// ── Origin ports ──────────────────────────────────────────────────────────────
function getOriginPort(shipper: string | null, vessel: string | null): [number, number] {
  const s = (shipper ?? '').toUpperCase()
  const v = (vessel ?? '').toUpperCase()
  if (s.includes('PARAS') || s.includes('BUZIL') || s.includes('PVT')) return [18.92, 72.83]
  if (s.includes('SHANDONG') || s.includes('SHENGHE')) return [36.07, 120.37]
  if (s.includes('XIAMEN') || s.includes('HONGJU') || v.includes('XMN')) return [24.48, 118.09]
  if (s.includes('YICHEN') || s.includes('ENTEN')) return [31.23, 121.47]
  if (v.includes('KLM') || v.includes('AMSTERDAM') || s.includes('AMSTERDAM')) return [52.31, 4.76]
  return [31.23, 121.47]
}

// ── Ocean waypoints — hug real shipping lanes, cross Date Line correctly ──────
function getWaypoints(
  origin: [number, number],
  freight: string,
  shipper: string | null
): [number, number][] {
  const s = (shipper ?? '').toUpperCase()
  const LA: [number, number] = [33.74, -118.28]
  const LAX: [number, number] = [33.94, -118.41]

  if (freight === 'AIR') {
    // Amsterdam / Europe → LAX
    if (origin[0] > 45 && origin[1] < 20) {
      return [origin, [55.0, -10.0], [50.0, -30.0], [45.0, -55.0], [42.0, -75.0], [38.0, -100.0], LAX]
    }
    // Asia → LAX polar route
    return [origin, [45.0, 135.0], [55.0, 160.0], [60.0, -175.0], [58.0, -150.0], [52.0, -130.0], [45.0, -125.0], LAX]
  }

  // OCEAN — India/Mumbai via Malacca Strait
  if (origin[0] < 25 && origin[1] < 85) {
    return [
      origin,
      [8.0, 77.0],
      [3.0, 98.0],
      [1.28, 103.83],  // Singapore
      [7.0, 110.0],
      [15.0, 118.0],
      [22.0, 125.0],
      [30.0, 135.0],
      [40.0, 152.0],
      [44.0, 172.0],
      [44.0, -175.0],  // Cross Date Line
      [41.0, -158.0],
      [35.0, -130.0],
      LA,
    ]
  }

  // Qingdao (north China, lat > 33) — Korea Strait
  if (origin[0] > 33 && !s.includes('XIAMEN') && !s.includes('HONGJU')) {
    return [
      origin,
      [34.0, 128.0],  // Korea Strait
      [36.0, 140.0],
      [42.0, 158.0],
      [46.0, 175.0],
      [46.0, -175.0],
      [43.0, -158.0],
      [38.0, -138.0],
      [34.5, -122.0],
      LA,
    ]
  }

  // Xiamen / South China (lat 20-30) — clear Taiwan east side
  if (origin[0] < 30 && origin[1] > 100) {
    return [
      origin,
      [22.0, 122.0],  // East of Taiwan
      [28.0, 135.0],
      [38.0, 155.0],
      [44.0, 175.0],
      [44.0, -175.0],
      [41.0, -158.0],
      [36.0, -138.0],
      [34.0, -122.0],
      LA,
    ]
  }

  // Shanghai / default East China
  return [
    origin,
    [28.0, 125.0],  // East of Taiwan
    [32.0, 140.0],
    [40.0, 155.0],
    [45.0, 175.0],
    [45.0, -175.0],
    [42.0, -160.0],
    [37.0, -140.0],
    [34.0, -122.0],
    LA,
  ]
}

// ── Interpolation along waypoints ─────────────────────────────────────────────
function interpolate(waypoints: [number, number][], progress: number): [number, number] {
  if (progress <= 0) return waypoints[0]
  if (progress >= 1) return waypoints[waypoints.length - 1]
  const n = waypoints.length - 1
  const t = progress * n
  const i = Math.floor(t)
  const f = t - i
  if (i >= n) return waypoints[n]
  return [
    waypoints[i][0] + (waypoints[i + 1][0] - waypoints[i][0]) * f,
    waypoints[i][1] + (waypoints[i + 1][1] - waypoints[i][1]) * f,
  ]
}

// ── Landmasses ────────────────────────────────────────────────────────────────
const LANDMASSES = [
  'M 80,55 L 95,50 L 110,52 L 130,58 L 145,65 L 155,75 L 160,90 L 155,105 L 145,115 L 140,130 L 130,140 L 120,148 L 110,155 L 100,165 L 92,175 L 88,168 L 80,160 L 72,148 L 68,135 L 65,120 L 62,108 L 60,95 L 62,80 L 68,68 Z',
  'M 95,175 L 105,170 L 118,168 L 125,175 L 128,188 L 130,205 L 128,225 L 122,245 L 115,262 L 108,278 L 102,290 L 96,285 L 90,270 L 86,252 L 84,232 L 86,210 L 90,192 Z',
  'M 462,52 L 510,40 L 570,38 L 640,42 L 680,48 L 700,55 L 690,65 L 660,68 L 620,65 L 580,62 L 545,60 L 515,62 L 490,65 L 468,62 Z',
  'M 468,95 L 490,90 L 512,92 L 530,100 L 540,115 L 544,132 L 542,155 L 536,175 L 526,198 L 512,215 L 498,228 L 484,232 L 470,225 L 460,210 L 453,192 L 451,170 L 452,148 L 455,128 L 460,110 Z',
  'M 520,55 L 590,48 L 660,44 L 720,46 L 775,52 L 820,58 L 850,68 L 858,82 L 850,96 L 832,106 L 806,110 L 778,114 L 748,116 L 720,113 L 695,118 L 670,124 L 648,126 L 625,122 L 600,115 L 575,108 L 548,104 L 525,98 L 515,82 L 514,66 Z',
  'M 590,115 L 618,112 L 632,118 L 635,132 L 630,148 L 618,160 L 605,163 L 594,156 L 586,140 L 585,126 Z',
  'M 682,116 L 718,113 L 742,120 L 750,136 L 744,150 L 728,157 L 710,158 L 695,150 L 685,138 Z',
  'M 718,268 L 762,260 L 806,262 L 832,272 L 842,288 L 840,305 L 826,318 L 805,324 L 780,326 L 756,320 L 735,308 L 718,292 L 712,278 Z',
  'M 789,86 L 800,83 L 808,90 L 804,97 L 793,100 L 785,94 Z',
  'M 125,18 L 148,14 L 165,18 L 170,30 L 162,42 L 145,46 L 128,40 L 118,28 Z',
  'M 450,57 L 462,54 L 468,60 L 464,68 L 455,71 L 448,65 Z',
  'M 452,58 L 462,55 L 468,60 L 465,68 L 458,72 L 450,68 Z',
]

// ── Component ─────────────────────────────────────────────────────────────────
export default function ImportMap({ shipments }: { shipments: ImportShipment[] }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; lines: string[] } | null>(null)

  const groups: Record<string, ImportShipment[]> = {}
  shipments.forEach(s => {
    const k = s.booking_number ?? s.id
    if (!groups[k]) groups[k] = []
    groups[k].push(s)
  })

  const LA = project(33.74, -118.28)
  const now = Date.now()

  type VesselEntry = {
    svgPos: [number, number]
    svgWaypoints: [number, number][]
    progress: number
    isAir: boolean
    isReceived: boolean
    isLive: boolean
    label: string
    eta: string
    booking: string
    items: number
    status: string
    totalCases: number
    totalInv: number
    color: string
  }

  const vessels: VesselEntry[] = Object.values(groups).map((items, groupIdx) => {
    const rep = items[0]
    const isReceived = ['Received', 'Cleared', 'Delivered'].includes(rep.status)
    const isAir = rep.freight_method === 'AIR'
    const color = isAir ? AIR_COLOR : VESSEL_COLORS[groupIdx % VESSEL_COLORS.length]

    let liveLatLng: [number, number] | null = null
    if (rep.current_lat && rep.current_lng && rep.last_tracked) {
      if (now - new Date(rep.last_tracked).getTime() < 4 * 3600 * 1000) {
        liveLatLng = [rep.current_lat, rep.current_lng]
      }
    }

    const origin = getOriginPort(rep.shipper, rep.vessel_name)
    const waypointsGeo = getWaypoints(origin, rep.freight_method, rep.shipper)

    let progress = 0
    if (rep.etd && rep.eta_los_angeles) {
      const etd = new Date(rep.etd).getTime()
      const eta = new Date(rep.eta_los_angeles).getTime()
      progress = Math.max(0, Math.min(0.99, (now - etd) / (eta - etd)))
    }

    const posGeo = isReceived
      ? [33.74, -118.28] as [number, number]
      : liveLatLng ?? interpolate(waypointsGeo, progress)

    const daysLeft = rep.eta_los_angeles
      ? Math.ceil((new Date(rep.eta_los_angeles).getTime() - now) / 86400000)
      : null
    const etaLabel = rep.eta_los_angeles
      ? new Date(rep.eta_los_angeles + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : '—'
    const eta = daysLeft !== null
      ? `${etaLabel} (${daysLeft > 0 ? daysLeft + 'd' : daysLeft === 0 ? 'today' : 'late'})`
      : '—'

    return {
      svgPos: project(posGeo[0], posGeo[1]),
      svgWaypoints: waypointsGeo.map(([lat, lng]) => project(lat, lng)),
      progress,
      isAir,
      isReceived,
      isLive: !!liveLatLng,
      label: (rep.vessel_name ?? 'Unknown').split(' ').slice(0, 3).join(' ').substring(0, 20),
      eta,
      booking: rep.booking_number ?? '—',
      items: items.length,
      status: rep.status,
      totalCases: items.reduce((a, s) => a + (s.case_qty ?? 0), 0),
      totalInv: items.reduce((a, s) => a + (s.comm_inv_amt ?? 0), 0),
      color,
    }
  })

  return (
    <div>
      <div className="bg-[#0d1520] rounded-2xl overflow-hidden border border-[#2A2A35]">
        <svg
          viewBox="0 0 1000 500"
          className="w-full"
          style={{ height: 520 }}
          onMouseLeave={() => setTooltip(null)}
        >
          <rect width="1000" height="500" fill="#0d1520" />

          {/* Grid */}
          {[-60, -30, 0, 30, 60].map(lat => {
            const [, y] = project(lat, 0)
            return <line key={`lat${lat}`} x1={0} y1={y} x2={1000} y2={y} stroke="#1a2535" strokeWidth="0.5" />
          })}
          {[-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150].map(lng => {
            const [x] = project(0, lng)
            return <line key={`lng${lng}`} x1={x} y1={0} x2={x} y2={500} stroke="#1a2535" strokeWidth="0.5" />
          })}

          {/* Landmasses */}
          {LANDMASSES.map((d, i) => (
            <path key={i} d={d} fill="#1e3a2f" stroke="#2d5a42" strokeWidth="0.8" />
          ))}

          {/* Route lines — dim full route, bright completed */}
          {vessels.map((v, i) => {
            if (v.isReceived) return null
            const wp = v.svgWaypoints
            const [cx, cy] = v.svgPos
            const fullD = wp.map(([x, y], j) => `${j === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
            const cutIdx = Math.min(Math.ceil(v.progress * (wp.length - 1)), wp.length - 1)
            const donePoints: [number, number][] = [...wp.slice(0, cutIdx + 1), [cx, cy]]
            const doneD = donePoints.map(([x, y], j) => `${j === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
            return (
              <g key={i}>
                <path d={fullD} fill="none" stroke={v.color} strokeWidth="1" strokeOpacity="0.15" strokeDasharray="4,3" />
                <path d={doneD} fill="none" stroke={v.color} strokeWidth="2.5" strokeOpacity="0.85" />
              </g>
            )
          })}

          {/* LA Port anchor */}
          <g>
            <circle cx={LA[0]} cy={LA[1]} r="10" fill="#00C896" fillOpacity="0.2" stroke="#00C896" strokeWidth="1.5" />
            <circle cx={LA[0]} cy={LA[1]} r="4" fill="#00C896" />
            <text x={LA[0] + 13} y={LA[1] + 4} fill="#00C896" fontSize="9" fontWeight="bold">LA/LB Port</text>
          </g>

          {/* Vessel markers */}
          {vessels.map((v, i) => {
            const [vx, vy] = v.svgPos
            const markerColor = v.isReceived ? '#00C896' : v.color
            const icon = v.isReceived ? '✓' : v.isAir ? '✈' : '▲'
            return (
              <g key={i} style={{ cursor: 'pointer' }}
                onMouseEnter={() => setTooltip({
                  x: vx, y: vy,
                  lines: [
                    v.label,
                    `${v.isAir ? 'AIR' : 'OCEAN'} · ${v.status}`,
                    `ETA: ${v.eta}`,
                    `${v.items} item${v.items !== 1 ? 's' : ''}${v.totalCases ? ' · ' + v.totalCases + ' cases' : ''}`,
                    `Booking: ${v.booking}`,
                    v.isLive ? '🟢 LIVE POSITION' : '🟡 ESTIMATED',
                  ],
                })}
              >
                {!v.isReceived && (
                  <circle cx={vx} cy={vy} r="14" fill="none" stroke={markerColor} strokeWidth="1" strokeOpacity="0.3" />
                )}
                <circle cx={vx} cy={vy} r="8" fill={markerColor} fillOpacity="0.95" stroke={markerColor} strokeWidth="1" />
                <text x={vx} y={vy + 4} textAnchor="middle" fontSize="8" fill="white">{icon}</text>
                <text x={vx} y={vy - 14} textAnchor="middle" fill="white" fontSize="7.5" fontWeight="500" style={{ pointerEvents: 'none' }}>
                  {v.label}
                </text>
                {v.isLive && <circle cx={vx + 9} cy={vy - 9} r="3.5" fill="#22c55e" />}
              </g>
            )
          })}

          {/* Tooltip */}
          {tooltip && (() => {
            const W = 180, LH = 14, PAD = 8
            const H = tooltip.lines.length * LH + PAD * 2
            let tx = tooltip.x + 14
            let ty = tooltip.y - H / 2
            if (tx + W > 985) tx = tooltip.x - W - 10
            if (ty < 4) ty = 4
            if (ty + H > 496) ty = 496 - H
            return (
              <g style={{ pointerEvents: 'none' }}>
                <rect x={tx - PAD} y={ty - PAD} width={W + PAD * 2} height={H + PAD} rx="6" fill="#111827" stroke="#374151" strokeWidth="1" />
                {tooltip.lines.map((line, j) => (
                  <text key={j} x={tx} y={ty + j * LH + LH / 2}
                    fill={j === 0 ? '#ffffff' : '#9ca3af'}
                    fontSize="9" fontWeight={j === 0 ? 'bold' : 'normal'}
                    dominantBaseline="middle"
                  >{line}</text>
                ))}
              </g>
            )
          })()}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-between mt-3 px-1 flex-wrap gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
          {vessels.filter(v => !v.isReceived && !v.isAir).map((v, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: v.color }} />
              {v.label || `Group ${i + 1}`}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 inline-block" />Air freight
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />Received
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Live GPS
          </span>
        </div>
        <p className="text-gray-600 text-xs shrink-0">
          Hover for details ·{' '}
          <a href="https://shipsgo.com" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">ShipsGo</a>
        </p>
      </div>
    </div>
  )
}
