import { NextRequest } from 'next/server'

// Same-origin avatar proxy: renders DiceBear avataaars through our own domain so
// avatars don't depend on the client being able to reach the third-party
// api.dicebear.com (ad-blockers / privacy filters / corporate networks often
// block it). Responses are cached at the edge to avoid rate limits.
const UPSTREAM = 'https://api.dicebear.com/9.x/avataaars/svg'

export async function GET(req: NextRequest) {
  const qs = req.nextUrl.search // includes leading "?" (already URL-encoded)
  const url = qs ? `${UPSTREAM}${qs}` : UPSTREAM
  try {
    const res = await fetch(url, {
      headers: { Accept: 'image/svg+xml' },
      // Cache the generated SVG; identical configs are reused across users/sessions.
      next: { revalidate: 86400 },
    })
    if (!res.ok) {
      return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>', {
        status: 200, headers: { 'Content-Type': 'image/svg+xml' },
      })
    }
    const svg = await res.text()
    return new Response(svg, {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
      },
    })
  } catch {
    return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>', {
      status: 200, headers: { 'Content-Type': 'image/svg+xml' },
    })
  }
}
