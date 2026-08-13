import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  const isAuthPage = pathname === '/login' || pathname === '/signup' || pathname === '/auth/callback'
  const isMcpEndpoint = pathname.startsWith('/api/mcp')
  const isOAuthPublic =
    pathname.startsWith('/api/oauth/') ||
    pathname.startsWith('/.well-known/') ||
    pathname === '/oauth/authorize'
  const isCronEndpoint = pathname.startsWith('/api/cron/')

  if (!user && !isAuthPage && !isMcpEndpoint && !isOAuthPublic && !isCronEndpoint) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && isAuthPage) {
    const next = request.nextUrl.searchParams.get('next')
    const url = request.nextUrl.clone()
    if (next && next.startsWith('/')) {
      return NextResponse.redirect(new URL(next, request.url))
    }
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
