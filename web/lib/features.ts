// Tools that are parked for now: shown as "Coming soon" in the sidebar and the Tools page,
// and their pages show a coming-soon screen. Remove a route from this list to bring it back.
// Early-access users (lib/early-access.ts) see them as live.
export const COMING_SOON_ROUTES: readonly string[] = ['/gmail-hub', '/lead-finder']

export function isComingSoon(href: string, earlyAccess = false): boolean {
  if (earlyAccess) return false
  return COMING_SOON_ROUTES.some(r => href === r || href.startsWith(r + '/'))
}
