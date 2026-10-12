import { redirect } from 'next/navigation'
import { getSessionUser, getBrandForUser } from '@/lib/server-session'
import { db } from '@/lib/db'
import { brandIntegrations, modules, frektoScheduledPosts } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import SocialStudioPage from '@/components/SocialStudioPage'

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

  const queue = await db
    .select()
    .from(frektoScheduledPosts)
    .where(eq(frektoScheduledPosts.brandId, brand.id))
    .orderBy(desc(frektoScheduledPosts.scheduledAt))
    .limit(20)

  const initialQueue = queue.map(p => ({
    id: p.id,
    platform: p.platform,
    topic: p.topic,
    postType: p.postType,
    scheduledAt: p.scheduledAt?.toISOString() ?? null,
    status: p.status,
    outputUrl: p.outputUrl,
    createdAt: p.createdAt?.toISOString() ?? null,
  }))

  return (
    <SocialStudioPage
      brandId={brand.id}
      brandName={brand.name}
      frektoConnected={frektoConnected}
      socialModuleId={socialMod?.id ?? null}
      autoPostEnabled={brand.frektoAutoPostEnabled ?? false}
      frektoMeta={{
        timezone: frektoMeta['timezone'] ?? 'UTC',
        preferred_time: frektoMeta['preferred_time'] ?? '10:00',
        auto_post_platforms: frektoMeta['auto_post_platforms'] ?? '',
      }}
      initialQueue={initialQueue}
    />
  )
}
