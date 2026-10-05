import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, reminders } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import RemindersPage from '@/components/RemindersPage'

export default async function Reminders() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) redirect('/login')

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) redirect('/onboarding')

  const rows = await db.select().from(reminders)
    .where(eq(reminders.brandId, brand.id))
    .orderBy(reminders.nextDueAt)

  const serialized = rows.map(r => ({
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    intervalDays: r.intervalDays,
    lastDoneAt: r.lastDoneAt?.toISOString() ?? null,
    nextDueAt: r.nextDueAt?.toISOString() ?? new Date().toISOString(),
    snoozedUntil: r.snoozedUntil?.toISOString() ?? null,
    enabled: r.enabled,
    isPreset: r.isPreset,
    createdAt: r.createdAt?.toISOString() ?? null,
  }))

  const brandProfile = {
    name: brand.name,
    websiteType: brand.websiteType,
    industry: brand.industry,
    targetAudience: brand.targetAudience,
  }

  return <RemindersPage initialReminders={serialized} brandProfile={brandProfile} />
}
