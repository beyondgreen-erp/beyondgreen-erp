/* Shared display-name helpers for sales orders.
 * The board/table "order name" should read: linked customer name · PO # · Ship City
 * (each part omitted when unavailable), falling back to the SO number. */

const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
])
// Street-suffix / directional tokens that should never be treated as part of a city name.
const STREET_STOP = new Set([
  'ST','AVE','AVENUE','BLVD','DR','DRIVE','RD','ROAD','LN','LANE','WAY','PKWY','PARKWAY','HWY','HIGHWAY',
  'CT','PL','PLACE','FWY','FREEWAY','TER','TERRACE','CIR','CIRCLE','SQ','TRL','TRAIL','LOOP','PT','EXPY',
  'STREET','N','S','E','W','NE','NW','SE','SW',
])

function titleCaseIfShouting(s: string): string {
  if (s === s.toUpperCase()) {
    return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
  }
  return s
}

/** Walk backward through address words collecting up to 3 alphabetic, non-street
 *  tokens as the city (stops at a house number / unit or a street suffix). */
function cityFromTail(words: string[]): string | null {
  const parts: string[] = []
  for (let j = words.length - 1; j >= 0 && parts.length < 3; j--) {
    const raw = words[j]
    if (/\d/.test(raw)) break
    const clean = raw.replace(/[.,]/g, '')
    if (!/[A-Za-z]/.test(clean)) break
    if (STREET_STOP.has(clean.toUpperCase())) break
    parts.unshift(clean)
  }
  return parts.length ? titleCaseIfShouting(parts.join(' ')) : null
}

/** Best-effort extraction of the city from a free-text US shipping address.
 *  Returns null when no plausible city can be found. */
export function extractShipCity(addr?: string | null): string | null {
  if (!addr) return null
  const s = String(addr).replace(/\s+/g, ' ').trim()
  if (!s) return null

  // 1. Comma-delimited: find the segment that begins with a state code; the city is
  //    the tail of the previous segment (last 1-2 words), or the whole short segment.
  const segs = s.split(',').map(x => x.trim()).filter(Boolean)
  for (let i = 1; i < segs.length; i++) {
    const first = (segs[i].split(/\s+/)[0] || '').replace(/[^A-Za-z]/g, '').toUpperCase()
    if (US_STATES.has(first)) {
      const city = cityFromTail(segs[i - 1].split(/\s+/))
      if (city) return city
    }
  }

  // 2. No usable commas: scan tokens for a state code (optionally followed by a ZIP),
  //    then walk backwards collecting alphabetic, non-street tokens as the city.
  const toks = s.split(/\s+/)
  for (let i = 1; i < toks.length; i++) {
    const t = toks[i].replace(/[^A-Za-z]/g, '').toUpperCase()
    if (!US_STATES.has(t)) continue
    const next = (toks[i + 1] || '').replace(/[^0-9]/g, '')
    const nextIsZip = /^\d{5}$/.test(next)
    const nearEnd = i >= toks.length - 3
    if (!nextIsZip && !nearEnd) continue
    const city = cityFromTail(toks.slice(0, i))
    if (city) return city
  }
  return null
}

export interface OrderNameFields {
  order_number?: string | null
  po_number?: string | null
  notes?: string | null
  shipping_address?: string | null
  customer?: { company_name?: string | null; city?: string | null; state?: string | null } | null
  customers?: { company_name?: string | null; city?: string | null; state?: string | null } | null
}

/** Composed order display name: "Customer · PO 12345 · City".
 *  Falls back to the typed notes name, then the SO number. */
export function orderDisplayName(o: OrderNameFields): string {
  const cust = o.customer ?? o.customers ?? null
  const customerName =
    (cust?.company_name && cust.company_name.trim()) ||
    ((o.notes ?? '').split('|')[0].trim() || '')
  const po = (o.po_number ?? '').trim()
  const city = extractShipCity(o.shipping_address) || (cust?.city ? cust.city.trim() : '')

  const parts = [
    customerName || null,
    po ? `PO ${po}` : null,
    city || null,
  ].filter(Boolean) as string[]

  if (parts.length) return parts.join(' · ')
  return (o.order_number ?? '').trim() || 'Order'
}
