import ProGate from '@/components/ProGate'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/server-session'
import { hasEarlyAccess } from '@/lib/early-access'
import { isComingSoon } from '@/lib/features'

// Parked for now (lib/features.ts): only early-access users (lib/early-access.ts) can open it.
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (isComingSoon('/gmail-hub', await hasEarlyAccess(user?.email))) redirect('/tools')
  return <ProGate feature="Email Outreach" blurb="Turn your inbox into a pipeline: leads tagged hot to cold, stalled threads flagged, replies drafted for you to send.">{children}</ProGate>
}
