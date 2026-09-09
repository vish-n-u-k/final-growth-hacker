import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules, moduleCategories, moduleItems } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import NextCampaignBlueprintPage from '@/components/NextCampaignBlueprintPage'
import type { DBItemFull } from '@/lib/modules/types'

export interface OGTagResult {
  property: string
  label: string
  value: string | null
  why: string
  snippet: string
}

export interface PixelStatus {
  found: boolean | null  // null = could not check
  websiteChecked: boolean
}

const OG_CHECKS: Omit<OGTagResult, 'value'>[] = [
  { property: 'og:title',       label: 'Ad Title',       why: 'The headline Meta shows when your page is linked in an ad', snippet: '<meta property="og:title" content="Your Page Title" />' },
  { property: 'og:description', label: 'Ad Description', why: 'The supporting text shown below the headline in link ads',   snippet: '<meta property="og:description" content="A short description of your page" />' },
  { property: 'og:image',       label: 'Ad Image',       why: 'The image Meta uses for your ad — ideally 1200×630px',      snippet: '<meta property="og:image" content="https://yourdomain.com/og-image.jpg" />' },
  { property: 'og:url',         label: 'Page URL',       why: 'Confirms the exact URL linked in your ad',                  snippet: '<meta property="og:url" content="https://yourdomain.com/" />' },
  { property: 'og:type',        label: 'Content Type',   why: 'Tells Facebook what kind of page this is (website, article, product)', snippet: '<meta property="og:type" content="website" />' },
]

async function fetchWebsiteData(websiteUrl: string): Promise<{ ogTags: OGTagResult[]; pixelStatus: PixelStatus }> {
  const empty = { ogTags: OG_CHECKS.map((c) => ({ ...c, value: null })), pixelStatus: { found: null, websiteChecked: false } }
  if (!websiteUrl) return empty
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(websiteUrl, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } })
    clearTimeout(timer)
    if (!res.ok) return empty
    const html = await res.text()
    const ogTags = OG_CHECKS.map((check) => {
      const match = html.match(new RegExp(`<meta[^>]+property=["']${check.property}["'][^>]+content=["']([^"']+)["']`, 'i'))
               ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${check.property}["']`, 'i'))
      return { ...check, value: match?.[1] ?? null }
    })
    const found = /connect\.facebook\.net.*fbevents\.js|fbq\s*\(/.test(html)
    return { ogTags, pixelStatus: { found, websiteChecked: true } }
  } catch {
    return empty
  }
}

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

  const allCats = await db
    .select()
    .from(moduleCategories)
    .where(eq(moduleCategories.moduleId, metaMod.id))

  const catMap = new Map(allCats.map((c) => [c.id, c.slug]))

  const [rawItems, { ogTags, pixelStatus }] = await Promise.all([
    allCats.length > 0
      ? db.select().from(moduleItems).where(eq(moduleItems.moduleId, metaMod.id))
      : Promise.resolve([]),
    fetchWebsiteData(brand.websiteUrl ?? ''),
  ])

  const items: DBItemFull[] = rawItems.map((item) => ({
    id: item.id,
    slug: item.slug,
    label: item.label,
    weight: item.weight,
    categorySlug: catMap.get(item.categoryId) ?? '',
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

  return (
    <NextCampaignBlueprintPage
      moduleId={metaMod.id}
      moduleStatus={metaMod.status}
      brandName={brand.name}
      websiteUrl={brand.websiteUrl ?? ''}
      lastAnalyzedAt={metaMod.lastAnalyzedAt?.toISOString() ?? null}
      items={items}
      ogTags={ogTags}
      pixelStatus={pixelStatus}
    />
  )
}
