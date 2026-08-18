import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(errorDescription || error)}`, origin)
    )
  }

  // Prefer query param (email/password flow), fall back to cookie (Google OAuth flow)
  const cookieStore = await cookies()
  const cookieNext = cookieStore.get('auth_next')?.value
  const nextParam = searchParams.get('next')
  const rawNext = nextParam ?? (cookieNext ? decodeURIComponent(cookieNext) : null)
  const redirectTo = rawNext && rawNext.startsWith('/') ? rawNext : '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

    if (exchangeError) {
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(exchangeError.message)}`, origin)
      )
    }

    const response = NextResponse.redirect(new URL(redirectTo, origin))
    // Clear the auth_next cookie now that it has been consumed
    if (cookieNext) response.cookies.delete('auth_next')
    return response
  }

  const response = NextResponse.redirect(new URL(redirectTo, origin))
  if (cookieNext) response.cookies.delete('auth_next')
  return response
}
