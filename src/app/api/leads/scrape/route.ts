import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

export const maxDuration = 60

const KEY = process.env.GOOGLE_PLACES_API_KEY || ''
const G = 'https://maps.googleapis.com/maps/api'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function jget(url: string): Promise<any> { const r = await fetch(url); return r.json() }

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
  const found = (text.match(EMAIL_RE) || []).map(e => e.toLowerCase()).filter(e => !JUNK.some(j => e.includes(j)) && e.length < 60)
  if (!found.length) return null
  for (const p of PREFER) { const m = found.find(e => e.startsWith(p)); if (m) return m }
  return found[0]
}
async function findEmail(website: string): Promise<string | null> {
  if (!website) return null
  let base = website
  try { base = new URL(website).origin } catch { return null }
  let email = pickEmail(await fetchText(website, 4500))
  if (!email) email = pickEmail(await fetchText(base + '/contact', 4000))
  if (!email) email = pickEmail(await fetchText(base + '/contact-us', 3500))
  return email
}
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0
  async function worker() { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]) } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}
function parseCityState(addr: string): { city: string | null; state: string | null } {
  const m = addr.match(/,\s*([^,]+),\s*([A-Z]{2})\s*\d{5}/)
  return m ? { city: m[1].trim(), state: m[2] } : { city: null, state: null }
}

// Grid of query points covering the whole radius, so we sweep the area (Google caps ~20-60 per point).
function gridPoints(lat: number, lng: number, radiusMiles: number, maxPoints: number): { lat: number; lng: number }[] {
  const pts = [{ lat, lng }]
  const step = Math.max(6, radiusMiles / 3)
  const latPerMile = 1 / 69
  const lngPerMile = 1 / (69 * Math.cos((lat * Math.PI) / 180))
  for (let dLat = -radiusMiles; dLat <= radiusMiles + 0.001; dLat += step) {
    for (let dLng = -radiusMiles; dLng <= radiusMiles + 0.001; dLng += step) {
      if (dLat === 0 && dLng === 0) continue
      if (Math.sqrt(dLat * dLat + dLng * dLng) > radiusMiles) continue
      pts.push({ lat: lat + dLat * latPerMile, lng: lng + dLng * lngPerMile })
      if (pts.length >= maxPoints) return pts
    }
  }
  return pts
}

export async function POST(req: NextRequest) {
  try {
    if (!KEY) return NextResponse.json({ error: 'GOOGLE_PLACES_API_KEY is not configured. Add it in Vercel → Settings → Environment Variables, then redeploy.' }, { status: 400 })
    const { prompt, zip, radiusMiles, createdBy } = await req.json() as { prompt?: string; zip?: string; radiusMiles?: number; createdBy?: string }
    if (!prompt || !zip) return NextResponse.json({ error: 'prompt and zip are required' }, { status: 400 })
    const miles = radiusMiles && radiusMiles > 0 ? radiusMiles : 25

    const geo = await jget(`${G}/geocode/json?address=${encodeURIComponent(zip + ' USA')}&key=${KEY}`)
    if (geo.status !== 'OK' || !geo.results?.length) return NextResponse.json({ error: `Could not geocode ZIP ${zip} (${geo.status})` }, { status: 400 })
    const loc = geo.results[0].geometry.location as { lat: number; lng: number }

    // Sweep a grid of points across the radius, 1 page each (fast, broad coverage).
    const tiles = gridPoints(loc.lat, loc.lng, miles, 20)
    const tileRadiusM = Math.min(Math.round((miles / 3) * 1.6 * 1609.34), 40000)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byPlace: Record<string, any> = {}
    await mapLimit(tiles, 6, async (t) => {
      try {
        const res = await jget(`${G}/place/textsearch/json?query=${encodeURIComponent(prompt)}&location=${t.lat},${t.lng}&radius=${tileRadiusM}&key=${KEY}`)
        if (res.status === 'OK') for (const p of (res.results || [])) if (p.place_id && !byPlace[p.place_id]) byPlace[p.place_id] = p
      } catch { /* ignore tile errors */ }
    })
    const places = Object.values(byPlace)

    const sb = createSupabaseAdminClient()
    const { data: scrape } = await sb.from('lead_scrapes').insert({
      prompt, zip, radius_miles: miles, center_lat: loc.lat, center_lng: loc.lng,
      result_count: places.length, new_count: 0, emails_found: 0, created_by: createdBy || null,
    }).select().single()
    const scrapeId = scrape?.id || null

    if (!places.length) return NextResponse.json({ found: 0, added: 0, emails: 0, scrapeId, newLeads: [], moreAvailable: false, message: 'No businesses found for that search.' })

    // Dedupe against existing leads by place_id.
    const ids = places.map((p: any) => p.place_id)
    const { data: existing } = await sb.from('customers').select('place_id').in('place_id', ids)
    const seen = new Set((existing || []).map((r: { place_id: string }) => r.place_id))
    const freshAll = places.filter((p: any) => !seen.has(p.place_id))
    const PROCESS_CAP = 55
    const fresh = freshAll.slice(0, PROCESS_CAP)
    const moreAvailable = freshAll.length > fresh.length

    const rows = await mapLimit(fresh, 8, async (p: any) => {
      let website = p.website || ''; let phone = ''
      try {
        const d = await jget(`${G}/place/details/json?place_id=${p.place_id}&fields=website,formatted_phone_number&key=${KEY}`)
        website = d.result?.website || website; phone = d.result?.formatted_phone_number || ''
      } catch { /* ignore */ }
      const email = website ? await findEmail(website) : null
      const cs = parseCityState(p.formatted_address || '')
      return {
        company_name: p.name, email, phone: phone || null, website: website || null,
        city: cs.city, state: cs.state, place_id: p.place_id,
        maps_url: `https://www.google.com/maps/place/?q=place_id:${p.place_id}`,
        latitude: p.geometry?.location?.lat ?? null, longitude: p.geometry?.location?.lng ?? null,
        is_scraped_lead: true, customer_status: 'Lead', pipeline_stage: 'Lead', lead_source: 'Cold Outreach',
        board: 'Leads', account_type: 'lead', industry: prompt.slice(0, 80),
        scrape_region: zip, scrape_id: scrapeId, scraped_at: new Date().toISOString(),
      }
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let newLeads: any[] = []
    if (rows.length) {
      const { data: ins, error } = await sb.from('customers').insert(rows).select('id, company_name, email, city, state')
      if (error) return NextResponse.json({ error: 'Insert failed: ' + error.message }, { status: 400 })
      newLeads = ins || []
    }
    const emails = newLeads.filter(r => r.email).length
    if (scrapeId) await sb.from('lead_scrapes').update({ new_count: newLeads.length, emails_found: emails }).eq('id', scrapeId)

    return NextResponse.json({
      found: places.length, added: newLeads.length, emails, center: loc, scrapeId, newLeads, moreAvailable,
      message: `Swept ${tiles.length} sub-areas, found ${places.length} businesses, added ${newLeads.length} new (${emails} with email).` + (moreAvailable ? ' More remain — run again to continue.' : ''),
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'scrape failed' }, { status: 500 })
  }
}
