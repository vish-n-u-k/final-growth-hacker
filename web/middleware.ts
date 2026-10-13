import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

async function handle(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  // Without these, createServerClient throws and Vercel shows a bare MIDDLEWARE_INVOCATION_FAILED page.
  // Say which setting is missing instead, so a misconfigured deployment is obvious.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!supabaseUrl || !supabaseKey) {
    const missing = [!supabaseUrl && 'NEXT_PUBLIC_SUPABASE_URL', !supabaseKey && 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'].filter(Boolean).join(', ')
    console.error(`[middleware] missing environment variables: ${missing}`)
    return new NextResponse(
      `This deployment is missing environment variables: ${missing}. Add them in Vercel (Settings → Environment Variables) and redeploy.`,
      { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    )
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseKey,
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

  // getClaims verifies the session token locally when the project uses asymmetric JWT signing keys
  // (and falls back to asking the Auth server otherwise), so most requests skip a network round trip
  // that getUser always made. It refreshes an expired session the same way.
  const { data: claimsData } = await supabase.auth.getClaims()
  const user = claimsData?.claims ?? null

  const { pathname } = request.nextUrl

  const isAuthPage = pathname === '/login' || pathname === '/signup' || pathname === '/auth/callback'
  const isMcpEndpoint = pathname.startsWith('/api/mcp')
  const isOAuthPublic =
    pathname.startsWith('/api/oauth/') ||
    pathname.startsWith('/.well-known/') ||
    pathname === '/oauth/authorize'
  const isCronEndpoint = pathname.startsWith('/api/cron/')
  const isTrackedLink = pathname.startsWith('/api/r/') // signed email links, e.g. "Do it in Claude"
  const isStripeWebhook = pathname === '/api/billing/webhook' // authenticated by Stripe's signature

  if (!user && !isAuthPage && !isMcpEndpoint && !isOAuthPublic && !isCronEndpoint && !isTrackedLink && !isStripeWebhook) {
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

// Any failure in here (e.g. a malformed Supabase URL) otherwise surfaces only as Vercel's bare
// MIDDLEWARE_INVOCATION_FAILED page. Log it and show the message so the cause is visible.
export async function middleware(request: NextRequest) {
  try {
    return await handle(request)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[middleware] failed:', err)
    return new NextResponse(`This deployment couldn't start: ${message}`, {
      status: 500,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }
}

export const config = {
  // Static files in /public skip auth, and so do sw.js and the app manifest: a login redirect there
  // stops the app from being installable. fb-widget.js used to get the login page's HTML back
  // whenever there was no session (login/signup pages), which threw "Unexpected token '<'".
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|js|css|txt|woff2?|webmanifest)$).*)'],
}
