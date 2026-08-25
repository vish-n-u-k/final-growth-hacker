import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import KeywordTracker from '@/components/KeywordTracker'

export default async function KeywordsPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) redirect('/login')

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) redirect('/onboarding')

  const [seoMod] = await db
    .select({ lastAnalyzedAt: modules.lastAnalyzedAt })
    .from(modules)
    .where(and(eq(modules.brandId, brand.id), eq(modules.type, 'seo')))
    .limit(1)

  return (
    <KeywordTracker
      brandName={brand.name}
      seoAnalyzed={!!seoMod?.lastAnalyzedAt}
    />
  )
}
