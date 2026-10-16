import { redirect } from 'next/navigation'
import { getSessionUser, getBrandForUser } from '@/lib/server-session'
import { db } from '@/lib/db'
import { reminders, brandIntegrations } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { getOpenSignals } from '@/lib/signals'
import { getPresetsForWebsiteType } from '@/lib/reminders/presets'
import RemindersPage from '@/components/RemindersPage'

const SOURCE_LABEL: Record<string, string> = {
  seo: 'Google Search',
  'email-marketing': 'Email deliverability',
  'meta-ads': 'Meta Ads',
  'business-stage': 'Business stage',
}

export default async function Reminders() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const brand = await getBrandForUser(user.id)
  if (!brand) redirect('/onboarding')

  const [rows, signals, [gsc]] = await Promise.all([
    db.select().from(reminders)
      .where(eq(reminders.brandId, brand.id))
      .orderBy(reminders.nextDueAt),
    // Signal tables may not exist before their migration — show reminders only
    getOpenSignals(brand.id).catch(() => []),
    db.select({ id: brandIntegrations.id }).from(brandIntegrations)
      .where(and(eq(brandIntegrations.brandId, brand.id), eq(brandIntegrations.provider, 'gsc_api'), eq(brandIntegrations.status, 'connected')))
      .limit(1),
  ])

  const serialized = rows.map(r => ({
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    url: r.url,
    intervalDays: r.intervalDays,
    lastDoneAt: r.lastDoneAt?.toISOString() ?? null,
    nextDueAt: r.nextDueAt?.toISOString() ?? new Date().toISOString(),
    snoozedUntil: r.snoozedUntil?.toISOString() ?? null,
    enabled: r.enabled,
    isPreset: r.isPreset,
    createdAt: r.createdAt?.toISOString() ?? null,
  }))

  // "What changed": alerts raised by detectors. Growth-focus plays (source 'diagnosis')
  // are daily suggestions, not changes — they stay on Today.
  const changes = signals
    .filter(s => s.source !== 'diagnosis')
    .sort((a, b) => b.priority - a.priority || (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
    .map(s => ({
      id: s.id,
      source: SOURCE_LABEL[s.source] ?? s.source,
      title: s.title,
      detail: s.detail,
      action: s.action,
      priority: s.priority,
      createdAt: s.createdAt?.toISOString() ?? null,
    }))

  const brandProfile = {
    name: brand.name,
    websiteType: brand.websiteType,
    industry: brand.industry,
    targetAudience: brand.targetAudience,
  }

  return (
    <RemindersPage
      initialReminders={serialized}
      initialChanges={changes}
      commonChecks={getPresetsForWebsiteType(brand.websiteType)}
      searchConnected={!!gsc}
      brandProfile={brandProfile}
    />
  )
}
