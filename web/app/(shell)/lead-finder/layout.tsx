import ProGate from '@/components/ProGate'
import ComingSoonPage from '@/components/ComingSoonPage'
import { getSessionUser } from '@/lib/server-session'
import { hasEarlyAccess } from '@/lib/early-access'

// Parked as Coming soon (lib/features.ts), except for early-access users (lib/early-access.ts).
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!hasEarlyAccess(user?.email)) {
    return <ComingSoonPage feature="Lead Finder" blurb="Turn competitor reviews into a list of prospects who already need what you sell." />
  }
  return <ProGate feature="Lead Finder" blurb="Mine competitor reviews for unhappy customers that fit your product, scored and ready for outreach.">{children}</ProGate>
}
