import ProGate from '@/components/ProGate'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/server-session'
import { hasEarlyAccess } from '@/lib/early-access'
import { isComingSoon } from '@/lib/features'

// Parked for now (lib/features.ts): only early-access users (lib/early-access.ts) can open it.
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (isComingSoon('/lead-finder', await hasEarlyAccess(user?.email))) redirect('/tools')
  return <ProGate feature="Competitor Leads" blurb="Mine competitor reviews for unhappy customers that fit your product, scored and ready for outreach.">{children}</ProGate>
}
