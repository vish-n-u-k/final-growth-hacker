// Tools that are parked for now: hidden from the sidebar and the Tools page, and their pages
// send people to /tools. Remove a route from this list to bring it back.
// Early-access users (lib/early-access.ts) see them as live.
export const COMING_SOON_ROUTES: readonly string[] = ['/gmail-hub', '/lead-finder', '/agents', '/leads', '/search-ai']

export function isComingSoon(href: string, earlyAccess = false): boolean {
  if (earlyAccess) return false
  return COMING_SOON_ROUTES.some(r => href === r || href.startsWith(r + '/'))
}

// Ask (/ask) can be the home page for early-access users: Today and Growth Path hidden from the
// sidebar, their pages sending people to /ask, logging in landing there. Off for now (11 Nov: the app
// works as before and Ask is opened from its sidebar item or by typing /ask); NEXT_PUBLIC_ASK_HOME=on brings it back.
export function askIsHome(earlyAccess: boolean): boolean {
  return earlyAccess && process.env.NEXT_PUBLIC_ASK_HOME === 'on'
}
