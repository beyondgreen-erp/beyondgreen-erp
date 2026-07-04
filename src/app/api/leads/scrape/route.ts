import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

export const maxDuration = 60

const KEY = process.env.GOOGLE_PLACES_API_KEY || ''
const G = 'https://maps.googleapis.com/maps/api'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function jget(url: string): Promise<any> {
  const r = await fetch(url)
  return r.json()
}

// Fetch a URL as text with a hard timeout (for website email scraping).
async function fetchText(url: string, ms: number): Promise<string> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 beyondGREEN-lead-bot' } })
    if (!r.ok) return ''
    return (await r.text()).slice(0, 250000)
  } catch { return '' } finally { clearTimeout(t) }
}

const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g
const JUNK = ['example.com', 'sentry', 'wixpress', 'godaddy', 'squarespace', 'gstatic', 'schema.org', 'w3.org', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', 'yourdomain', 'domain.com', 'email.com']
const PREFER = ['info@', 'contact@', 'sales@', 'hello@', 'orders@', 'admin@']

function pickEmail(text: string): string | null {
  const found = (text.match(EMAIL_RE) || [])
    .map(e => e.toLowerCase())
    .filter(e => !JUNK.some(j => e.includes(j)) && e.length < 60)
  if (!found.length) return null
  for (const p of PREFER) { const m = found.find(e => e.startsWith(p)); if (m) return m }
  return found[0]
}

async function findEmail(website: string): Promise<string | null> {
  if (!website) return null
  let base = website
  try { base = new URL(website).origin } catch { return null }
  const home = await fetchText(website, 4500)
  let email = pickEmail(home)
  if (!email) { const c = await fetchText(base + '/contact', 4000); email = pickEmail(c) }
  if (!email) { const c = await fetchText(base + '/contact-us', 3500); email = pickEmail(c) }
  return email
}

// run async fn over items with a concurrency cap
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  async function worker() { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]) } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

function parseCityState(addr: string): { city: string | null; state: string | null } {
  // "123 Main St, City, ST 12345, USA"
  const m = addr.match(/,\s*([^,]+),\s*([A-Z]{2})\s*\d{5}/)
  if (m) return { city: m[1].trim(), state: m[2] }
  return { city: null, state: null }
}

export async function POST(req: NextRequest) {
  try {
    if (!KEY) return NextResponse.json({ error: 'GOOGLE_PLACES_API_KEY is not configured. Add it in Vercel → Settings → Environment Variables, then redeploy.' }, { status: 400 })
    const { prompt, zip, radiusMiles, createdBy } = await req.json() as { prompt?: string; zip?: string; radiusMiles?: number; createdBy?: string }
    if (!prompt || !zip) return NextResponse.json({ error: 'prompt and zip are required' }, { status: 400 })
    const miles = radiusMiles && radiusMiles > 0 ? radiusMiles : 25
    const radiusM = Math.min(Math.round(miles * 1609.34), 50000) // Google caps single search radius at 50km

    // 1) Geocode ZIP → center
    const geo = await jget(`${G}/geocode/json?address=${encodeURIComponent(zip + ' USA')}&key=${KEY}`)
    if (geo.status !== 'OK' || !geo.results?.length) return NextResponse.json({ error: `Could not geocode ZIP ${zip} (${geo.status})` }, { status: 400 })
    const loc = geo.results[0].geometry.location as { lat: number; lng: number }

    // 2) Places Text Search (up to 2 pages)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const places: any[] = []
    let url = `${G}/place/textsearch/json?query=${encodeURIComponent(prompt)}&location=${loc.lat},${loc.lng}&radius=${radiusM}&key=${KEY}`
    for (let page = 0; page < 2; page++) {
      const res = await jget(url)
      if (res.status !== 'OK' && res.status !== 'ZERO_RESULTS') {
        if (page === 0) return NextResponse.json({ error: `Places search failed: ${res.status} ${res.error_message || ''}` }, { status: 400 })
        break
      }
      places.push(...(res.results || []))
      if (!res.next_page_token) break
      await new Promise(r => setTimeout(r, 2100)) // token needs a moment to activate
      url = `${G}/place/textsearch/json?pagetoken=${res.next_page_token}&key=${KEY}`
    }
    if (!places.length) return NextResponse.json({ found: 0, added: 0, emails: 0, message: 'No businesses found for that search.' })

    const sb = createSupabaseAdminClient()

    // 3) Dedupe against existing leads by place_id
    const ids = places.map(p => p.place_id).filter(Boolean)
    const { data: existing } = await sb.from('customers').select('place_id').in('place_id', ids)
    const seen = new Set((existing || []).map((r: { place_id: string }) => r.place_id))
    const fresh = places.filter(p => p.place_id && !seen.has(p.place_id)).slice(0, 45)

    // 4) Details + email extraction (concurrency-limited)
    const enriched = await mapLimit(fresh, 8, async (p) => {
      let website = p.website || ''
      let phone = ''
      try {
        const d = await jget(`${G}/place/details/json?place_id=${p.place_id}&fields=website,formatted_phone_number&key=${KEY}`)
        website = d.result?.website || website
        phone = d.result?.formatted_phone_number || ''
      } catch { /* ignore */ }
      const email = website ? await findEmail(website) : null
      const cs = parseCityState(p.formatted_address || '')
      return {
        company_name: p.name,
        email,
        phone: phone || null,
        website: website || null,
        city: cs.city, state: cs.state,
        place_id: p.place_id,
        maps_url: `https://www.google.com/maps/place/?q=place_id:${p.place_id}`,
        latitude: p.geometry?.location?.lat ?? null,
        longitude: p.geometry?.location?.lng ?? null,
        is_scraped_lead: true,
        customer_status: 'Lead',
        pipeline_stage: 'Lead',
        lead_source: 'Cold Outreach',
        board: 'Leads',
        account_type: 'lead',
        industry: prompt.slice(0, 80),
        scrape_region: zip,
        scraped_at: new Date().toISOString(),
      }
    })

    const rows = enriched
    let added = 0, emails = 0
    if (rows.length) {
      const { data: ins, error } = await sb.from('customers').insert(rows).select('id, email')
      if (error) return NextResponse.json({ error: 'Insert failed: ' + error.message }, { status: 400 })
      added = ins?.length || 0
      emails = (ins || []).filter((r: { email: string | null }) => r.email).length
    }

    await sb.from('lead_scrapes').insert({
      prompt, zip, radius_miles: miles, center_lat: loc.lat, center_lng: loc.lng,
      result_count: places.length, new_count: added, emails_found: emails, created_by: createdBy || null,
    })

    return NextResponse.json({ found: places.length, added, emails, center: loc, message: `Found ${places.length}, added ${added} new leads (${emails} with email).` })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'scrape failed' }, { status: 500 })
  }
}
