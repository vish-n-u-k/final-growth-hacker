import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getLockedModuleTypes } from '@/lib/modules/lock-state'
import AppSidebar from '@/components/AppSidebar'

// Persistent sidebar shell for every authenticated app route (growth path, the
// work tools, insights, settings). Pages keep their own auth/brand checks —
// this layout's redirects are a first line of defense so the shell itself
// never renders for a signed-out user or one with no brand yet.
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) redirect('/login')

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) redirect('/onboarding')

  const lockedTypes = Array.from(await getLockedModuleTypes(brand.id))

  return (
    <div className="app-shell">
      <AppSidebar brandName={brand.name} lockedTypes={lockedTypes} />
      <div className="app-shell-main">{children}</div>
    </div>
  )
}
