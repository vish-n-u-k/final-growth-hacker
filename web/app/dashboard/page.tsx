import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { MODULE_MAP } from '@/lib/modules/registry'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) redirect('/onboarding')

  const allModules = await db
    .select()
    .from(modules)
    .where(eq(modules.brandId, brand.id))
    .orderBy(modules.order)

  if (allModules.length === 0) redirect('/onboarding')

  // Redirect to the first non-locked module (Foundation)
  const active = allModules.find((m) => m.status !== 'locked') ?? allModules[0]
  redirect(`/dashboard/${active.id}`)
}
