import ProGate from '@/components/ProGate'
import ComingSoonPage from '@/components/ComingSoonPage'
import { getSessionUser } from '@/lib/server-session'
import { hasEarlyAccess } from '@/lib/early-access'

// Parked as Coming soon (lib/features.ts), except for early-access users (lib/early-access.ts).
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!hasEarlyAccess(user?.email)) {
    return <ComingSoonPage feature="Outreach" blurb="Find warm leads in your inbox, draft replies in your voice and follow up on deals that went quiet." />
  }
  return <ProGate feature="Outreach" blurb="Turn your inbox into a pipeline: leads tagged hot to cold, stalled threads flagged, replies drafted for you to send.">{children}</ProGate>
}
