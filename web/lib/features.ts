// Tools that are parked for now: shown as "Coming soon" in the sidebar and the Tools page,
// and their pages show a coming-soon screen. Add a route to this list to park it.
export const COMING_SOON_ROUTES: readonly string[] = []

export function isComingSoon(href: string): boolean {
  return COMING_SOON_ROUTES.some(r => href === r || href.startsWith(r + '/'))
}

// For now every Growth Path module is open, whatever the previous module scored.
// Set to false to bring back the "previous module must reach 80%" lock.
export const UNLOCK_ALL_MODULES = true
