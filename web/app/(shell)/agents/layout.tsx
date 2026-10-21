import ProGate from '@/components/ProGate'
import ComingSoonPage from '@/components/ComingSoonPage'
import { getSessionUser } from '@/lib/server-session'
import { hasEarlyAccess } from '@/lib/early-access'
import { isComingSoon } from '@/lib/features'

// Parked as Coming soon (lib/features.ts), except for early-access users (lib/early-access.ts).
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (isComingSoon('/agents', await hasEarlyAccess(user?.email))) {
    return <ComingSoonPage feature="AI Agents" blurb="A Search Agent that grows your Google and AI visibility, and a Lead Agent that finds customers and follows up for you." />
  }
  return <ProGate feature="AI Agents" blurb="A Search Agent that grows your Google and AI visibility, and a Lead Agent that finds customers and follows up for you.">{children}</ProGate>
}
