import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import JourneyDashboard from './JourneyDashboard'

export default async function AuthJourneyPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) redirect('/login')

  const [brand] = await db
    .select()
    .from(brands)
    .where(eq(brands.userId, session.user.id))
    .limit(1)
  if (!brand) redirect('/onboarding')

  return <JourneyDashboard brandId={brand.id} brandName={brand.name} />
}
