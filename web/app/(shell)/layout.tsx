import { redirect } from 'next/navigation'
import { getSessionUser, getBrandForUser, getAccessCached } from '@/lib/server-session'
import { getLockedModuleTypes } from '@/lib/modules/lock-state'
import { hasEarlyAccess } from '@/lib/early-access'
import { getRoadmapModules } from '@/lib/modules/roadmap-data'
import { MODULE_REGISTRY } from '@/lib/modules/registry'
import { planLockedTypes } from '@/lib/billing/plan'
import { RoadmapProvider } from '@/components/RoadmapContext'
import AppSidebar from '@/components/AppSidebar'
import Link from 'next/link'

// Persistent sidebar shell for every authenticated app route (growth path, the
// work tools, insights, settings). Pages keep their own auth/brand checks —
// this layout's redirects are a first line of defense so the shell itself
// never renders for a signed-out user or one with no brand yet.
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const brand = await getBrandForUser(user.id)
  if (!brand) redirect('/onboarding')

  const earlyAccess = hasEarlyAccess(user.email)
  const [lockedSet, access] = await Promise.all([getLockedModuleTypes(brand.id, earlyAccess), getAccessCached(brand.id, user.email)])
  const lockedTypes = Array.from(lockedSet)
  const roadmap = await getRoadmapModules(brand.id, lockedSet, planLockedTypes(access, MODULE_REGISTRY.map(m => m.type)))

  return (
    <RoadmapProvider>
    <div className="app-shell">
      <AppSidebar brandName={brand.name} lockedTypes={lockedTypes} plan={{ enabled: access.enabled, pro: access.pro }} roadmap={roadmap} earlyAccess={earlyAccess} />
      <div className="app-shell-main">
        {access.paymentFailed && (
          <div className="billing-banner" role="alert">
            Your last Pro payment failed. <Link href="/pricing">Update your card</Link> to keep Pro.
          </div>
        )}
        {children}
      </div>
    </div>
    </RoadmapProvider>
  )
}
