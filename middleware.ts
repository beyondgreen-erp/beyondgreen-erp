import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public warehouse ticket pages + their API bypass auth entirely (no-login, token-gated).
  // Landing pages under /lp/ are also public so they can be linked from cold outreach emails.
  if (
    pathname.startsWith('/t/') || pathname.startsWith('/api/ct/') ||
    pathname.startsWith('/w/') || pathname.startsWith('/api/wh/') ||
    pathname.startsWith('/lp/') || pathname.startsWith('/api/lp/')
  ) {
    return NextResponse.next({ request })
  }

  // Public static assets (catalog PDF, images, fonts, docs) bypass auth entirely.
  if (/\.(?:pdf|png|jpe?g|gif|svg|webp|ico|txt|xml|json|webmanifest|woff2?|ttf|csv|zip|map|html)$/i.test(pathname)) {
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
