import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public warehouse ticket pages + their API bypass auth entirely (no-login, token-gated).
  if (pathname.startsWith('/t/') || pathname.startsWith('/api/ct/')) {
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

  // The ERP is restricted to beyondGREEN company accounts. Other accounts in the
  // shared Supabase project (e.g. the portal / epsilonpacific site) are blocked.
  const ALLOWED_DOMAIN = /@(beyondgreenbiotech\.com|byndgrn\.com)$/i

  if (!user) {
    if (!isLoginPage) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      return NextResponse.redirect(url)
    }
    return supabaseResponse
  }

  // Authenticated but not a company account → block from the ERP.
  if (!ALLOWED_DOMAIN.test(user.email || '')) {
    if (!isAccessDenied) {
      const url = request.nextUrl.clone()
      url.pathname = '/access-denied'
      return NextResponse.redirect(url)
    }
    return supabaseResponse
  }

  // Company account → keep them out of the login / access-denied pages.
  if (isLoginPage || isAccessDenied) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // Public static assets (images, PDFs, catalog/HTML, fonts, manifest) bypass auth.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|pdf|html|txt|xml|webmanifest|woff|woff2|ttf|csv|zip)$).*)',
  ],
}
