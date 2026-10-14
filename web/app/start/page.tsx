import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { modules } from '@/lib/db/schema'
import { getSessionUser, getBrandForUser, getAccessCached } from '@/lib/server-session'

export const dynamic = 'force-dynamic'

// Where people land after logging in (and when they open the app): returning users go to Today,
// new users to Growth Path, which sends anyone who hasn't finished onboarding there. Today is a
// Pro tool, so Free users land on Growth Path instead of an upgrade screen.
export default async function Start() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const brand = await getBrandForUser(user.id)
  if (!brand) redirect('/onboarding')
  const [[mod], access] = await Promise.all([
    db.select({ id: modules.id }).from(modules).where(eq(modules.brandId, brand.id)).limit(1),
    getAccessCached(brand.id, user.email),
  ])
  redirect(mod && access.pro ? '/today' : '/dashboard')
}
