import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const ALLOWED_DOMAINS = ['beyondgreenbiotech.com', 'byndgrn.com']

// Hostnames that serve ONLY the client portal. On these hosts the ERP is hidden:
// every non-portal path (including the bare domain and /login) redirects to /portal,
// so clients can never reach the staff login by trimming the URL. The built-in
// default guarantees isolation even if the env var isn't inlined into the Edge runtime.
const PORTAL_HOSTS = Array.from(new Set([
  'byndgrn-portal.vercel.app',
  ...(process.env.NEXT_PUBLIC_PORTAL_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
]))

function isPortalPath(pathname: string): boolean {
  return pathname === '/portal' || pathname.startsWith('/portal/') ||
    pathname.startsWith('/api/portal') || pathname.startsWith('/api/avatar') ||
    pathname.startsWith('/_next') || pathname === '/sw.js' || pathname === '/manifest.json' ||
    /\.(?:png|jpe?g|gif|svg|ico|webp|css|js|woff2?|ttf|otf|map)$/i.test(pathname)
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const host = (request.headers.get('host') || '').toLowerCase().split(':')[0]

  // Dedicated portal host: only the client portal is reachable; the ERP is invisible.
  if (PORTAL_HOSTS.includes(host)) {
    if (isPortalPath(pathname)) return NextResponse.next()
    const url = request.nextUrl.clone()
    url.pathname = '/portal'
    url.search = ''
    return NextResponse.redirect(url)
  }

  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/professional') ||
    pathname.startsWith('/t/') ||
    pathname.startsWith('/p/') ||
    pathname.startsWith('/w/') ||
    pathname.startsWith('/portal') ||
    pathname.startsWith('/ship-docs') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/offline') ||
    pathname === '/sw.js' ||
    pathname === '/manifest.json' ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.ico')
  ) {
    return NextResponse.next()
  }

  const response = NextResponse.next({
    request: { headers: request.headers },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    {
      // Remember where they were headed so login can send them straight back
      // (e.g. a saved /warehouse/scan link opens login, then lands on the scan page).
      const loginUrl = new URL('/login', request.url)
      const dest = pathname + (request.nextUrl.search || '')
      if (dest && dest !== '/' && !dest.startsWith('/login')) loginUrl.searchParams.set('next', dest)
      return NextResponse.redirect(loginUrl)
    }
  }

  const domain = user.email?.split('@')[1]?.toLowerCase() ?? ''
  if (!ALLOWED_DOMAINS.includes(domain)) {
    await supabase.auth.signOut()
    const url = new URL('/login', request.url)
    url.searchParams.set('error', 'unauthorized')
    return NextResponse.redirect(url)
  }

  // Role gate: users marked Production/Warehouse are locked to the scan tools only.
  const inScanTools = pathname === '/warehouse/produce' || pathname.startsWith('/warehouse/produce/') ||
    pathname === '/warehouse/scans' || pathname.startsWith('/warehouse/scans/')
  if (!inScanTools) {
    const { data: prof } = await supabase.from('user_profiles').select('role').ilike('email', user.email || '').maybeSingle()
    const role = String((prof as { role?: string } | null)?.role || '').toLowerCase()
    if (role === 'production' || role === 'warehouse') {
      const url = request.nextUrl.clone()
      url.pathname = '/warehouse/produce'
      url.search = ''
      return NextResponse.redirect(url)
    }
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|otf|css|js)$).*)',
  ],
}
