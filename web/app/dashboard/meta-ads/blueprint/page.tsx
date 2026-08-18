import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules, moduleCategories, moduleItems } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import NextCampaignBlueprintPage from '@/components/NextCampaignBlueprintPage'
import type { DBItemFull } from '@/lib/modules/types'

export default async function BlueprintPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) redirect('/onboarding')

  const [metaMod] = await db
    .select()
    .from(modules)
    .where(and(eq(modules.brandId, brand.id), eq(modules.type, 'meta-ads')))
    .limit(1)

  if (!metaMod) redirect('/dashboard')

  const [nextCat] = await db
    .select()
    .from(moduleCategories)
    .where(and(eq(moduleCategories.moduleId, metaMod.id), eq(moduleCategories.slug, 'next-campaign')))
    .limit(1)

  const items: DBItemFull[] = nextCat
    ? (await db.select().from(moduleItems).where(eq(moduleItems.categoryId, nextCat.id))).map((item) => ({
        id: item.id,
        slug: item.slug,
        label: item.label,
        weight: item.weight,
        categorySlug: 'next-campaign',
        aiDetail: item.aiDetail,
        aiHighlight: item.aiHighlight ?? null,
        aiNarrative: item.aiNarrative,
        aiAction: item.aiAction,
        aiDraft: item.aiDraft ?? null,
        aiData: item.aiData ?? null,
        aiVerified: item.aiVerified ?? false,
        userChecked: item.userChecked ?? false,
        completedBy: item.completedBy,
        fixable: false,
        fixType: null,
        fixInputKey: null,
        fixIntegrationProvider: null,
        userSkipped: item.userSkipped ?? false,
        userSkipReason: item.userSkipReason ?? null,
        exportType: null,
        choiceOptions: null,
        userChoice: null,
      }))
    : []

  return (
    <NextCampaignBlueprintPage
      brandName={brand.name}
      lastAnalyzedAt={metaMod.lastAnalyzedAt?.toISOString() ?? null}
      items={items}
    />
  )
}
