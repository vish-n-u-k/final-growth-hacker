import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import TrafficDashboard from './TrafficDashboard'

export default async function TrafficPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [brand] = await db
    .select()
    .from(brands)
    .where(eq(brands.userId, user.id))
    .limit(1)
  if (!brand) redirect('/onboarding')

  return (
    <TrafficDashboard
      brandId={brand.id}
      brandName={brand.name}
    />
  )
}
