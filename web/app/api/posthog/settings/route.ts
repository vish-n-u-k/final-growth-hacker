import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as { unique_filter_enabled?: boolean; unique_filter_property?: string; display_name_field?: string }

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand found' }, { status: 404 })

  const [integration] = await db
    .select()
    .from(brandIntegrations)
    .where(and(
      eq(brandIntegrations.brandId, brand.id),
      eq(brandIntegrations.provider, 'posthog'),
      eq(brandIntegrations.status, 'connected'),
    ))
    .limit(1)

  if (!integration) return NextResponse.json({ error: 'PostHog not connected' }, { status: 404 })

  const existingMeta = (integration.metadata as Record<string, string> | null) ?? {}
  const updatedMeta = {
    ...existingMeta,
    unique_filter_enabled: String(body.unique_filter_enabled ?? false),
    ...(body.unique_filter_property != null ? { unique_filter_property: body.unique_filter_property } : {}),
    ...(body.display_name_field != null ? { display_name_field: body.display_name_field } : {}),
  }

  await db
    .update(brandIntegrations)
    .set({ metadata: updatedMeta })
    .where(eq(brandIntegrations.id, integration.id))

  return NextResponse.json({ ok: true })
}
