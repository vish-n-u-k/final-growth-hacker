import { redirect } from 'next/navigation'
import { getSessionUser, getBrandForUser } from '@/lib/server-session'
import { db } from '@/lib/db'
import { brandIntegrations, modules, frektoScheduledPosts } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import SocialStudioPage from '@/components/SocialStudioPage'
import { loadOpenSuggestions } from '@/lib/frekto/suggest'
import { refreshPost, toClientPost, validTimezone } from '@/lib/frekto/drafts'

export default async function SocialPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const brand = await getBrandForUser(user.id)
  if (!brand) redirect('/onboarding')

  const [frektoInt] = await db
    .select()
    .from(brandIntegrations)
    .where(and(
      eq(brandIntegrations.brandId, brand.id),
      eq(brandIntegrations.provider, 'frekto'),
    ))
    .limit(1)

  const frektoConnected = frektoInt?.status === 'connected' && !!frektoInt?.apiKey
  const frektoMeta = (frektoInt?.metadata as Record<string, string> | null) ?? {}

  const [socialMod] = await db
    .select({ id: modules.id })
    .from(modules)
    .where(and(
      eq(modules.brandId, brand.id),
      eq(modules.type, 'social-media'),
    ))
    .limit(1)

  const [rows, openSuggestions] = await Promise.all([
    db.select()
      .from(frektoScheduledPosts)
      .where(eq(frektoScheduledPosts.brandId, brand.id))
      .orderBy(desc(frektoScheduledPosts.scheduledAt))
      .limit(60),
    loadOpenSuggestions(brand.id).catch(() => []),
  ])

  // Previews that were still rendering last time — check if they're ready now
  const posts = frektoConnected
    ? await Promise.all(rows.map((p) => refreshPost(brand.id, p, frektoInt!.apiKey!).catch(() => p)))
    : rows

  const postSuggestions = openSuggestions.filter(s => s.kind === 'post').map(s => ({
    id: s.id,
    platform: s.platform,
    shouldPost: true,
    topic: s.topic,
    postType: s.postType ?? 'image',
    scheduledAt: s.suggestedAt?.toISOString() ?? '',
    reason: s.reason ?? '',
  }))
  const seriesSuggestions = openSuggestions.filter(s => s.kind === 'series').map(s => {
    const p = (s.payload ?? {}) as Record<string, unknown>
    return {
      id: s.id,
      platform: s.platform,
      shouldPost: true,
      instruction: s.topic,
      count: Number(p.count ?? 3),
      cadence: String(p.cadence ?? ''),
      format: String(p.format ?? '1:1'),
      outputFormat: String(p.outputFormat ?? 'png'),
      startDate: String(p.startDate ?? ''),
      reason: Array.isArray(p.reason) ? (p.reason as string[]) : [],
    }
  })

  return (
    <SocialStudioPage
      brandId={brand.id}
      brandName={brand.name}
      frektoConnected={frektoConnected}
      socialModuleId={socialMod?.id ?? null}
      autoPostEnabled={brand.frektoAutoPostEnabled ?? false}
      frektoMeta={{
        timezone: validTimezone(frektoMeta['timezone']) ? frektoMeta['timezone'] : 'UTC',
        preferred_time: frektoMeta['preferred_time'] ?? '10:00',
        auto_post_platforms: frektoMeta['auto_post_platforms'] ?? '',
        auto_post_mode: frektoMeta['auto_post_mode'] === 'auto' ? 'auto' : 'approve',
      }}
      initialPosts={posts.map(toClientPost)}
      initialSuggestions={postSuggestions}
      initialSeriesSuggestions={seriesSuggestions}
      renderedAt={new Date().toISOString()}
    />
  )
}
