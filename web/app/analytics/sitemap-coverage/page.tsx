import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import SitemapCoverageDashboard from './SitemapCoverageDashboard'

export default async function SitemapCoveragePage() {
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
    <SitemapCoverageDashboard
      brandId={brand.id}
      brandName={brand.name}
      websiteUrl={brand.websiteUrl}
    />
  )
}
