import ProGate from '@/components/ProGate'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/server-session'
import { hasEarlyAccess } from '@/lib/early-access'
import { isComingSoon } from '@/lib/features'

// Parked for now like the Search Agent it builds on (lib/features.ts): only early-access users can open it.
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (isComingSoon('/search-ai', await hasEarlyAccess(user?.email))) redirect('/tools')
  return <ProGate feature="Search & AI" blurb="Tracks your Google rankings and AI answers week by week, and tells you which keywords to keep, change or drop.">{children}</ProGate>
}
