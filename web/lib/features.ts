// Tools that are parked for now: shown as "Coming soon" in the sidebar and the Tools page,
// and their pages show a coming-soon screen. Remove a route from this list to bring it back.
export const COMING_SOON_ROUTES = ['/gmail-hub', '/lead-finder'] as const

export function isComingSoon(href: string): boolean {
  return (COMING_SOON_ROUTES as readonly string[]).some(r => href === r || href.startsWith(r + '/'))
}
