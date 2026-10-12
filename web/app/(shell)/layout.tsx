import { redirect } from 'next/navigation'
import { getSessionUser, getBrandForUser, getAccessCached } from '@/lib/server-session'
import { getLockedModuleTypes } from '@/lib/modules/lock-state'
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

  const [lockedSet, access] = await Promise.all([getLockedModuleTypes(brand.id), getAccessCached(brand.id, user.email)])
  const lockedTypes = Array.from(lockedSet)

  return (
    <div className="app-shell">
      <AppSidebar brandName={brand.name} lockedTypes={lockedTypes} plan={{ enabled: access.enabled, pro: access.pro }} />
      <div className="app-shell-main">
        {access.paymentFailed && (
          <div className="billing-banner" role="alert">
            Your last Pro payment failed. <Link href="/pricing">Update your card</Link> to keep Pro.
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
