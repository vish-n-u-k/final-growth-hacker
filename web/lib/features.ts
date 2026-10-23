// Tools that are parked for now: hidden from the sidebar and the Tools page, and their pages
// send people to /tools. Remove a route from this list to bring it back.
// Early-access users (lib/early-access.ts) see them as live.
export const COMING_SOON_ROUTES: readonly string[] = ['/gmail-hub', '/lead-finder', '/agents']

export function isComingSoon(href: string, earlyAccess = false): boolean {
  if (earlyAccess) return false
  return COMING_SOON_ROUTES.some(r => href === r || href.startsWith(r + '/'))
}
