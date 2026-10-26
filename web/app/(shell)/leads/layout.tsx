import ProGate from '@/components/ProGate'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/server-session'
import { hasEarlyAccess } from '@/lib/early-access'
import { isComingSoon } from '@/lib/features'

// Parked for now like the tools it combines (lib/features.ts): only early-access users can open it.
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (isComingSoon('/leads', await hasEarlyAccess(user?.email))) redirect('/tools')
  return <ProGate feature="Lead Finder" blurb="Finds people who need what you sell on Google Maps, in your competitors' reviews and on Reddit, writes to them and follows up.">{children}</ProGate>
}
