import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Hostnames that serve ONLY the client portal (comma-separated in the env var).
// e.g. NEXT_PUBLIC_PORTAL_HOSTS="portal.byndgrn.com,byndgrn-portal.vercel.app"
// On one of these hosts the ERP is completely invisible: every non-portal path is
// redirected to /portal, so clients can never reach the staff login by trimming the
// URL. Leave the env var empty and nothing changes.
const PORTAL_HOSTS = (process.env.NEXT_PUBLIC_PORTAL_HOSTS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

const STATIC_RE = /\.(?:pdf|png|jpe?g|gif|svg|webp|ico|txt|xml|json|webmanifest|woff2?|ttf|csv|zip|map|html)$/i

// The client portal and its APIs are public — clients authenticate with their own
// portal session (bg_portal cookie), never the ERP staff login.
function isPortalPath(pathname: string): boolean {
  return pathname === '/portal' || pathname.startsWith('/portal/') ||
    pathname.startsWith('/api/portal') || pathname.startsWith('/api/avatar')
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const host = (request.headers.get('host') || '').toLowerCase().split(':')[0]

  // ── Dedicated portal host: only the portal exists here; the ERP is hidden. ──
  if (PORTAL_HOSTS.length > 0 && PORTAL_HOSTS.includes(host)) {
    if (isPortalPath(pathname) || STATIC_RE.test(pathname) || pathname.startsWith('/_next/')) {
      return NextResponse.next({ request })
    }
    // Any other path (the bare domain, the staff login, any ERP route) → back to the portal.
    const url = request.nextUrl.clone()
    url.pathname = '/portal'
    url.search = ''
    return NextResponse.redirect(url)
  }

  // ── Client portal is public on any host (no ERP auth required). ──
  if (isPortalPath(pathname)) {
    return NextResponse.next({ request })
  }

  // Public warehouse ticket pages + their API bypass auth entirely (no-login, token-gated).
  // Landing pages under /lp/ are also public so they can be linked from cold outreach emails.
  if (
    pathname.startsWith('/t/') || pathname.startsWith('/api/ct/') ||
    pathname.startsWith('/w/') || pathname.startsWith('/api/wh/') ||
    pathname.startsWith('/dp/') || pathname.startsWith('/api/dp/') ||
    pathname.startsWith('/lp/') || pathname.startsWith('/api/lp/')
  ) {
    return NextResponse.next({ request })
  }

  // Public static assets (catalog PDF, images, fonts, docs) bypass auth entirely.
  if (STATIC_RE.test(pathname)) {
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isLoginPage = request.nextUrl.pathname === '/login'
  const isAccessDenied = request.nextUrl.pathname === '/access-denied'

  const ALLOWED_DOMAIN = /@(beyondgreenbiotech\.com|byndgrn\.com)$/i

  if (!user) {
    if (!isLoginPage) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      return NextResponse.redirect(url)
    }
    return supabaseResponse
  }

  if (!ALLOWED_DOMAIN.test(user.email || '')) {
    if (!isAccessDenied) {
      const url = request.nextUrl.clone()
      url.pathname = '/access-denied'
      return NextResponse.redirect(url)
    }
    return supabaseResponse
  }

  if (isLoginPage || isAccessDenied) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
