import ProGate from '@/components/ProGate'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/server-session'
import { hasEarlyAccess } from '@/lib/early-access'
import { isComingSoon } from '@/lib/features'

// Parked like the other new tools (lib/features.ts): only early-access users can open it.
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (isComingSoon('/engagement', await hasEarlyAccess(user?.email))) redirect('/tools')
  return <ProGate feature="Engagement Leads" blurb="Finds the Reddit threads, Instagram posts and competitor followers where your buyers are, so you can follow and comment by hand.">{children}</ProGate>
}
