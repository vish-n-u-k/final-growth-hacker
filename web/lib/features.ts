// Tools that are parked for now: hidden from the sidebar and the Tools page, and their pages
// send people to /tools. Remove a route from this list to bring it back.
// Early-access users (lib/early-access.ts) see them as live.
export const COMING_SOON_ROUTES: readonly string[] = ['/gmail-hub', '/lead-finder', '/agents', '/leads']

export function isComingSoon(href: string, earlyAccess = false): boolean {
  if (earlyAccess) return false
  return COMING_SOON_ROUTES.some(r => href === r || href.startsWith(r + '/'))
}

// Ask (/ask, md_files/ASK_PLAN.md phase 5) is the home page for early-access users: Today and Growth
// Path are hidden from the sidebar, their pages send people to /ask, and logging in lands there.
// Nothing is deleted: set NEXT_PUBLIC_ASK_HOME=off to bring Today and Growth Path back for everyone.
export function askIsHome(earlyAccess: boolean): boolean {
  return earlyAccess && process.env.NEXT_PUBLIC_ASK_HOME !== 'off'
}
