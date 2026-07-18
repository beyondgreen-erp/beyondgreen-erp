import { NextRequest } from 'next/server'

// Same-origin avatar proxy: renders DiceBear avataaars through our own domain so
// avatars don't depend on the client being able to reach the third-party
// api.dicebear.com (ad-blockers / privacy filters / corporate networks often
// block it). Responses are cached at the edge to avoid rate limits.
const SVG_UPSTREAM = 'https://api.dicebear.com/9.x/avataaars/svg'
const PNG_UPSTREAM = 'https://api.dicebear.com/9.x/avataaars/png'
const CACHE = 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400'

export async function GET(req: NextRequest) {
  // format=png returns a raster image (needed for email clients, which don't render SVG avatars)
  const isPng = req.nextUrl.searchParams.get('format') === 'png'
  const upstream = isPng ? PNG_UPSTREAM : SVG_UPSTREAM
  const qs = req.nextUrl.search // includes leading "?" (already URL-encoded)
  const url = qs ? `${upstream}${qs}` : upstream
  try {
    const res = await fetch(url, {
      headers: { Accept: isPng ? 'image/png' : 'image/svg+xml' },
      next: { revalidate: 86400 },
    })
    if (!res.ok) {
      return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>', {
        status: 200, headers: { 'Content-Type': 'image/svg+xml' },
      })
    }
    if (isPng) {
      const buf = await res.arrayBuffer()
      return new Response(buf, { status: 200, headers: { 'Content-Type': 'image/png', 'Cache-Control': CACHE } })
    }
    const svg = await res.text()
    return new Response(svg, {
      status: 200,
      headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': CACHE },
    })
  } catch {
    return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>', {
      status: 200, headers: { 'Content-Type': 'image/svg+xml' },
    })
  }
}
