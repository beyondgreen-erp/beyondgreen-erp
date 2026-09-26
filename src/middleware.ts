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

// Hostnames that serve ONLY the external printer-proof portal (Packaging Design ▸ Printer Share).
// Printers get links on this host; everything else (ERP, login, client portal) is invisible here.
// NOTE: keep this block — the printer share links depend on it.
const PROOF_HOSTS = Array.from(new Set([
  'beyondgreen-proofs.vercel.app',
  ...(process.env.NEXT_PUBLIC_PROOF_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
]))

// Hostnames that serve ONLY the outbound supplier RFQ form. Suppliers get their
// tokenised link on this host, so they never see an ERP URL and cannot reach the
// ERP by trimming it — every other path here goes to the public website.
const RFQ_HOSTS = Array.from(new Set([
  'beyondgreen-rfq.vercel.app',
  ...(process.env.NEXT_PUBLIC_RFQ_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
]))

const RFQ_PUBLIC_SITE = 'https://beyondgreenbiotech.com'

function isRfqHostPath(pathname: string): boolean {
  return pathname.startsWith('/rfq/supplier/') || pathname.startsWith('/api/rfq/vendor-response/') ||
    pathname.startsWith('/_next') || pathname === '/manifest.json' ||
    /\.(?:png|jpe?g|gif|svg|ico|webp|css|js|woff2?|ttf|otf|map)$/i.test(pathname)
}

function isProofPath(pathname: string): boolean {
  return pathname === '/proof' || pathname.startsWith('/proof/') || pathname.startsWith('/api/proof/') ||
    pathname.startsWith('/_next') || pathname === '/manifest.json' ||
    /\.(?:png|jpe?g|gif|svg|ico|webp|css|js|woff2?|ttf|otf|map)$/i.test(pathname)
}

function isPortalPath(pathname: string): boolean {
  return pathname === '/portal' || pathname.startsWith('/portal/') ||
    pathname.startsWith('/api/portal') || pathname.startsWith('/api/avatar') ||
    pathname.startsWith('/_next') || pathname === '/sw.js' || pathname === '/manifest.json' ||
    /\.(?:png|jpe?g|gif|svg|ico|webp|css|js|woff2?|ttf|otf|map)$/i.test(pathname)
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const host = (request.headers.get('host') || '').toLowerCase().split(':')[0]

  // Dedicated supplier-RFQ host: only the quote form is reachable.
  if (RFQ_HOSTS.includes(host)) {
    if (isRfqHostPath(pathname)) {
      const res = NextResponse.next()
      res.headers.set('X-Robots-Tag', 'noindex, nofollow')
      return res
    }
    return NextResponse.redirect(RFQ_PUBLIC_SITE)
  }

  // Dedicated portal host: only the client portal is reachable; the ERP is invisible.
  if (PORTAL_HOSTS.includes(host)) {
    if (isPortalPath(pathname)) return NextResponse.next()
    const url = request.nextUrl.clone()
    url.pathname = '/portal'
    url.search = ''
    return NextResponse.redirect(url)
  }

  // Dedicated printer-proof host: only /proof pages + their API exist; the ERP is invisible.
  if (PROOF_HOSTS.includes(host)) {
    if (isProofPath(pathname)) {
      const res = NextResponse.next()
      res.headers.set('X-Robots-Tag', 'noindex, nofollow')
      return res
    }
    const url = request.nextUrl.clone()
    url.pathname = '/proof'
    url.search = ''
    return NextResponse.redirect(url)
  }

  if (
    pathname === '/proof' || pathname.startsWith('/proof/') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/professional') ||
    pathname.startsWith('/t/') ||
    pathname.startsWith('/p/') ||
    pathname.startsWith('/rfq/supplier/') ||
    pathname.startsWith('/w/') ||
    pathname.startsWith('/scan/') ||
    pathname.startsWith('/dp/') ||
    pathname.startsWith('/wo/') ||
    pathname.startsWith('/board/') ||
    pathname.startsWith('/shift/') ||
    pathname.startsWith('/portal') ||
    pathname.startsWith('/ship-docs') ||
    pathname.startsWith('/forms') ||
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
