// Keep the Supabase session in a long-lived cookie. Without an explicit maxAge a mobile browser or
// installed PWA can treat it as a session cookie and drop it when the app is closed, which logs the
// user out every day. The refresh token keeps rotating while the app is used, so this is a ceiling.
export const AUTH_COOKIE_OPTIONS = {
  path: '/',
  sameSite: 'lax' as const,
  maxAge: 60 * 60 * 24 * 400, // 400 days, the longest lifetime browsers allow
}
