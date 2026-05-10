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

// City+State → [lat, lng]. Key format: "City_ST"
const CITY_COORDS: Record<string, [number, number]> = {
  // Illinois
  'Chicago_IL': [41.8781, -87.6298],
  'Rockford_IL': [42.2711, -89.0940],
  'Naperville_IL': [41.7508, -88.1535],
  'Springfield_IL': [39.7817, -89.6501],
  'Evanston_IL': [42.0451, -87.6877],
  'Oak Park_IL': [41.8850, -87.7845],
  // California
  'Los Angeles_CA': [34.0522, -118.2437],
  'San Francisco_CA': [37.7749, -122.4194],
  'San Diego_CA': [32.7157, -117.1611],
  'Santa Ana_CA': [33.7455, -117.8677],
  'Encinitas_CA': [33.0369, -117.2920],
  'Berkeley_CA': [37.8716, -122.2727],
  'Daly City_CA': [37.6879, -122.4702],
  'Garden Grove_CA': [33.7739, -117.9600],
  'Sacramento_CA': [38.5816, -121.4944],
  'Oakland_CA': [37.8044, -122.2712],
  'Long Beach_CA': [33.7701, -118.1937],
  'Anaheim_CA': [33.8353, -117.9145],
  'Irvine_CA': [33.6846, -117.8265],
  'Santa Monica_CA': [34.0195, -118.4912],
  'Pasadena_CA': [34.1478, -118.1445],
  'Glendale_CA': [34.1425, -118.2551],
  'Fresno_CA': [36.7378, -119.7871],
  'Santa Barbara_CA': [34.4208, -119.6982],
  // New York
  'New York_NY': [40.7128, -74.0060],
  'Brooklyn_NY': [40.6782, -73.9442],
  'Queens_NY': [40.7282, -73.7949],
  'Bronx_NY': [40.8448, -73.8648],
  'Staten Island_NY': [40.5795, -74.1502],
  'Rye_NY': [40.9807, -73.6871],
  'Buffalo_NY': [42.8864, -78.8784],
  'Rochester_NY': [43.1566, -77.6088],
  'Albany_NY': [42.6526, -73.7562],
  // Nevada
  'Las Vegas_NV': [36.1699, -115.1398],
  'Reno_NV': [39.5296, -119.8138],
  'Henderson_NV': [36.0395, -114.9817],
  // Texas
  'San Antonio_TX': [29.4241, -98.4936],
  'Austin_TX': [30.2672, -97.7431],
  'Dallas_TX': [32.7767, -96.7970],
  'Houston_TX': [29.7604, -95.3698],
  'Plainview_TX': [34.1845, -101.7068],
  'The Colony_TX': [33.0851, -96.8886],
  'Fort Worth_TX': [32.7555, -97.3308],
  'El Paso_TX': [31.7619, -106.4850],
  'Lubbock_TX': [33.5779, -101.8552],
  'Amarillo_TX': [35.2220, -101.8313],
  'Plano_TX': [33.0198, -96.6989],
  'Arlington_TX': [32.7357, -97.1081],
  'Corpus Christi_TX': [27.8006, -97.3964],
  'Waco_TX': [31.5493, -97.1467],
  'Irving_TX': [32.8140, -96.9489],
  // Florida
  'Plantation_FL': [26.1276, -80.2331],
  'St Petersburg_FL': [27.7676, -82.6403],
  'Saint Petersburg_FL': [27.7676, -82.6403],
  'Miami_FL': [25.7617, -80.1918],
  'Orlando_FL': [28.5383, -81.3792],
  'Jacksonville_FL': [30.3322, -81.6557],
  'Tampa_FL': [27.9506, -82.4572],
  'Fort Lauderdale_FL': [26.1224, -80.1373],
  'Boca Raton_FL': [26.3683, -80.1289],
  'Fort Myers_FL': [26.6406, -81.8723],
  'Tallahassee_FL': [30.4518, -84.2807],
  'Gainesville_FL': [29.6516, -82.3248],
  'Sarasota_FL': [27.3364, -82.5307],
  // New Jersey
  'Cherry Hill_NJ': [39.9348, -74.9813],
  'Summit_NJ': [40.7154, -74.3593],
  'Westampton_NJ': [40.0076, -74.8327],
  'Newark_NJ': [40.7357, -74.1724],
  'Jersey City_NJ': [40.7178, -74.0431],
  'Trenton_NJ': [40.2171, -74.7429],
  'Camden_NJ': [39.9259, -75.1196],
  'Hoboken_NJ': [40.7440, -74.0324],
  'Montclair_NJ': [40.8259, -74.2090],
  // Washington
  'Seattle_WA': [47.6062, -122.3321],
  'Spokane_WA': [47.6588, -117.4260],
  'Tacoma_WA': [47.2529, -122.4443],
  'Bellevue_WA': [47.6101, -122.2015],
  'Olympia_WA': [47.0379, -122.9007],
  // Delaware
  'Dover_DE': [39.1582, -75.5244],
  'Wilmington_DE': [39.7447, -75.5484],
  // South Carolina
  'Lancaster_SC': [34.7204, -80.7737],
  'Columbia_SC': [34.0007, -81.0348],
  'Charleston_SC': [32.7765, -79.9311],
  'Greenville_SC': [34.8526, -82.3940],
  'Myrtle Beach_SC': [33.6891, -78.8867],
  // Pennsylvania
  'Philadelphia_PA': [39.9526, -75.1652],
  'Pittsburgh_PA': [40.4406, -79.9959],
  'Allentown_PA': [40.6084, -75.4902],
  'Erie_PA': [42.1292, -80.0851],
  // Ohio
  'Columbus_OH': [39.9612, -82.9988],
  'Cleveland_OH': [41.4993, -81.6944],
  'Cincinnati_OH': [39.1031, -84.5120],
  'Toledo_OH': [41.6528, -83.5379],
  'Akron_OH': [41.0814, -81.5190],
  // Georgia
  'Atlanta_GA': [33.7490, -84.3880],
  'Savannah_GA': [32.0835, -81.0998],
  'Augusta_GA': [33.4735, -82.0105],
  // Arizona
  'Phoenix_AZ': [33.4484, -112.0740],
  'Scottsdale_AZ': [33.4942, -111.9261],
  'Tucson_AZ': [32.2226, -110.9747],
  'Tempe_AZ': [33.4255, -111.9400],
  'Mesa_AZ': [33.4152, -111.8315],
  // Colorado
  'Denver_CO': [39.7392, -104.9903],
  'Colorado Springs_CO': [38.8339, -104.8214],
  'Boulder_CO': [40.0150, -105.2705],
  'Fort Collins_CO': [40.5853, -105.0844],
  // Massachusetts
  'Boston_MA': [42.3601, -71.0589],
  'Cambridge_MA': [42.3736, -71.1097],
  'Worcester_MA': [42.2626, -71.8023],
  'Springfield_MA': [42.1015, -72.5898],
  // Michigan
  'Detroit_MI': [42.3314, -83.0458],
  'Grand Rapids_MI': [42.9634, -85.6681],
  'Ann Arbor_MI': [42.2808, -83.7430],
  // Minnesota
  'Minneapolis_MN': [44.9778, -93.2650],
  'Saint Paul_MN': [44.9537, -93.0900],
  'St Paul_MN': [44.9537, -93.0900],
  'Duluth_MN': [46.7867, -92.1005],
  // Oregon
  'Portland_OR': [45.5051, -122.6750],
  'Eugene_OR': [44.0521, -123.0868],
  'Salem_OR': [44.9429, -123.0351],
  // Virginia
  'Richmond_VA': [37.5407, -77.4360],
  'Virginia Beach_VA': [36.8529, -75.9780],
  'Arlington_VA': [38.8816, -77.0910],
  'Alexandria_VA': [38.8048, -77.0469],
  // Maryland
  'Baltimore_MD': [39.2904, -76.6122],
  'Annapolis_MD': [38.9784, -76.4922],
  'Bethesda_MD': [38.9807, -77.1003],
  // Tennessee
  'Nashville_TN': [36.1627, -86.7816],
  'Memphis_TN': [35.1495, -90.0490],
  'Knoxville_TN': [35.9606, -83.9207],
  'Chattanooga_TN': [35.0456, -85.3097],
  // North Carolina
  'Charlotte_NC': [35.2271, -80.8431],
  'Raleigh_NC': [35.7796, -78.6382],
  'Greensboro_NC': [36.0726, -79.7920],
  'Durham_NC': [35.9940, -78.8986],
  'Asheville_NC': [35.5951, -82.5515],
  // Missouri
  'St Louis_MO': [38.6270, -90.1994],
  'Saint Louis_MO': [38.6270, -90.1994],
  'Kansas City_MO': [39.0997, -94.5786],
  // Wisconsin
  'Milwaukee_WI': [43.0389, -87.9065],
  'Madison_WI': [43.0731, -89.4012],
  // Indiana
  'Indianapolis_IN': [39.7684, -86.1581],
  'Fort Wayne_IN': [41.0793, -85.1394],
  'Bloomington_IN': [39.1653, -86.5264],
  // Kentucky
  'Louisville_KY': [38.2527, -85.7585],
  'Lexington_KY': [38.0406, -84.5037],
  // Oklahoma
  'Oklahoma City_OK': [35.4676, -97.5164],
  'Tulsa_OK': [36.1540, -95.9928],
  // Nebraska
  'Omaha_NE': [41.2565, -95.9345],
  'Lincoln_NE': [40.8136, -96.7026],
  // Iowa
  'Des Moines_IA': [41.5868, -93.6250],
  'Cedar Rapids_IA': [41.9779, -91.6656],
  // Kansas
  'Wichita_KS': [37.6872, -97.3301],
  'Kansas City_KS': [39.1142, -94.6275],
  // New Mexico
  'Albuquerque_NM': [35.0844, -106.6504],
  'Santa Fe_NM': [35.6870, -105.9378],
  // Utah
  'Salt Lake City_UT': [40.7608, -111.8910],
  'Provo_UT': [40.2338, -111.6585],
  // Idaho
  'Boise_ID': [43.6150, -116.2023],
  // Montana
  'Billings_MT': [45.7833, -108.5007],
  'Missoula_MT': [46.8721, -113.9940],
  // South Dakota
  'Sioux Falls_SD': [43.5460, -96.7313],
  // North Dakota
  'Fargo_ND': [46.8772, -96.7898],
  // Wyoming
  'Cheyenne_WY': [41.1400, -104.8202],
  // Louisiana
  'New Orleans_LA': [29.9511, -90.0715],
  'Baton Rouge_LA': [30.4515, -91.1871],
  // Alabama
  'Birmingham_AL': [33.5186, -86.8104],
  'Montgomery_AL': [32.3668, -86.3000],
  'Mobile_AL': [30.6954, -88.0399],
  // Mississippi
  'Jackson_MS': [32.2988, -90.1848],
  // Arkansas
  'Little Rock_AR': [34.7465, -92.2896],
  // Hawaii
  'Honolulu_HI': [21.3069, -157.8583],
  // Alaska
  'Anchorage_AK': [61.2181, -149.9003],
  // Connecticut
  'Hartford_CT': [41.7658, -72.6851],
  'New Haven_CT': [41.3082, -72.9279],
  'Stamford_CT': [41.0534, -73.5387],
  // Rhode Island
  'Providence_RI': [41.8240, -71.4128],
  // New Hampshire
  'Manchester_NH': [42.9956, -71.4548],
  'Concord_NH': [43.2081, -71.5376],
  // Vermont
  'Burlington_VT': [44.4759, -73.2121],
  // Maine
  'Portland_ME': [43.6591, -70.2568],
  // West Virginia
  'Charleston_WV': [38.3498, -81.6326],
}

// State-center fallbacks when city not found
const STATE_CENTER: Record<string, [number, number]> = {
  AL:[32.806671,-86.791130], AK:[61.370716,-152.404419], AZ:[33.729759,-111.431221],
  AR:[34.969704,-92.373123], CA:[36.116203,-119.681564], CO:[39.059811,-105.311104],
  CT:[41.597782,-72.755371], DE:[39.318523,-75.507141], FL:[27.766279,-81.686783],
  GA:[33.040619,-83.643074], HI:[21.094318,-157.498337], ID:[44.240459,-114.478828],
  IL:[40.349457,-88.986137], IN:[39.849426,-86.258278], IA:[42.011539,-93.210526],
  KS:[38.526600,-96.726486], KY:[37.668140,-84.670067], LA:[31.169960,-91.867805],
  ME:[44.693947,-69.381927], MD:[39.063946,-76.802101], MA:[42.230171,-71.530106],
  MI:[43.326618,-84.536095], MN:[45.694454,-93.900192], MS:[32.741646,-89.678696],
  MO:[38.456085,-92.288368], MT:[46.921925,-110.454353], NE:[41.125370,-98.268082],
  NV:[38.313515,-117.055374], NH:[43.452492,-71.563896], NJ:[40.298904,-74.521011],
  NM:[34.840515,-106.248482], NY:[42.165726,-74.948051], NC:[35.630066,-79.806419],
  ND:[47.528912,-99.784012], OH:[40.388783,-82.764915], OK:[35.565342,-96.928917],
  OR:[44.572021,-122.070938], PA:[40.590752,-77.209755], RI:[41.680893,-71.511780],
  SC:[33.856892,-80.945007], SD:[44.299782,-99.438828], TN:[35.747845,-86.692345],
  TX:[31.054487,-97.563461], UT:[40.150032,-111.862434], VT:[44.045876,-72.710686],
  VA:[37.769337,-78.169968], WA:[47.400902,-121.490494], WV:[38.491226,-80.954453],
  WI:[44.268543,-89.616508], WY:[42.755966,-107.302490],
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

function getCoords(s: ShipmentPoint): [number, number] | null {
  if (s.city && s.state) {
    const key = `${s.city}_${s.state}`
    if (CITY_COORDS[key]) return CITY_COORDS[key]
    // Try state center as fallback
    if (STATE_CENTER[s.state]) return STATE_CENTER[s.state]
  } else if (s.state && STATE_CENTER[s.state]) {
    return STATE_CENTER[s.state]
  }
  return null
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

function MapCounter({ mapped, total }: { mapped: number; total: number }) {
  const map = useMap()
  useEffect(() => {
    const el = document.createElement('div')
    el.style.cssText = 'position:absolute;top:10px;left:50px;z-index:1000;background:rgba(17,24,39,0.9);color:white;padding:6px 12px;border-radius:8px;font-size:12px;border:1px solid rgba(255,255,255,0.1)'
    el.textContent = mapped === total
      ? `${total} shipments mapped`
      : `${mapped} of ${total} shipments mapped`
    map.getContainer().appendChild(el)
    return () => { el.remove() }
  }, [map, mapped, total])
  return null
}

export default function ShipmentMap({ shipments, mode }: Props) {
  const withCoords = shipments
    .map(s => ({ s, coords: getCoords(s) }))
    .filter((x): x is { s: ShipmentPoint; coords: [number, number] } => x.coords !== null)

  // Build per-location aggregates for heatmap
  const cityAgg: Record<string, { lat: number; lng: number; count: number; value: number }> = {}
  withCoords.forEach(({ s, coords }) => {
    const key = s.city && s.state ? `${s.city}_${s.state}` : `${coords[0]}_${coords[1]}`
    if (!cityAgg[key]) cityAgg[key] = { lat: coords[0], lng: coords[1], count: 0, value: 0 }
    cityAgg[key].count++
    cityAgg[key].value += s.ship_cost || 0
  })
  const heatPoints = Object.values(cityAgg)

  return (
    <div style={{ height: '100%', width: '100%', minHeight: 480, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 480 }}>
        <MapContainer center={[39.5, -98.35]} zoom={4} style={{ height: '100%', width: '100%', minHeight: 480, borderRadius: 8 }}>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
          <MapCounter mapped={withCoords.length} total={shipments.length} />

          {mode === 'map' && withCoords.map(({ s, coords }, i) => (
            <CircleMarker key={s.id || i} center={coords} radius={7}
              pathOptions={{ fillColor: getCarrierColor(s.carrier), fillOpacity: 0.85, color: '#fff', weight: 1 }}>
              <Popup>
                <div style={{ fontSize: 12, minWidth: 160 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{s.customer_name || '—'}</div>
                  <div>Carrier: {s.carrier || '—'}</div>
                  <div>Date: {s.ship_date || '—'}</div>
                  <div>Cost: ${(s.ship_cost || 0).toFixed(2)}</div>
                  <div>Location: {[s.city, s.state].filter(Boolean).join(', ') || '—'}</div>
                  {s.tracking_number && <div style={{ marginTop: 4, wordBreak: 'break-all' }}>Tracking: {s.tracking_number}</div>}
                </div>
              </Popup>
            </CircleMarker>
          ))}

          {mode === 'heatmap' && <HeatLayer points={heatPoints} />}
        </MapContainer>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap', fontSize: 11, alignItems: 'center' }}>
        {mode === 'map' ? (
          <>
            {Object.entries(CARRIER_COLORS).concat([['Other', '#666666']]).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#9ca3af' }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: v, flexShrink: 0 }} />
                {k}
              </div>
            ))}
            {withCoords.length < shipments.length && (
              <span style={{ color: '#6b7280', marginLeft: 'auto' }}>
                {shipments.length - withCoords.length} shipment{shipments.length - withCoords.length !== 1 ? 's' : ''} without address not shown
              </span>
            )}
          </>
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
