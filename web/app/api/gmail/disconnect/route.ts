import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select({ id: brands.id })
    .from(brands)
    .where(eq(brands.userId, user.id))
    .limit(1)

  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  // Get the access token so we can revoke it with Google
  const [integration] = await db
    .select({ accessToken: brandIntegrations.accessToken })
    .from(brandIntegrations)
    .where(
      and(
        eq(brandIntegrations.brandId, brand.id),
        eq(brandIntegrations.provider, 'gmail'),
      )
    )
    .limit(1)

  // Best-effort revoke with Google (don't fail if it errors)
  if (integration?.accessToken) {
    await fetch(
      `https://oauth2.googleapis.com/revoke?token=${integration.accessToken}`,
      { method: 'POST' }
    ).catch(() => {})
  }

  // Delete from DB
  await db
    .delete(brandIntegrations)
    .where(
      and(
        eq(brandIntegrations.brandId, brand.id),
        eq(brandIntegrations.provider, 'gmail'),
      )
    )

  return NextResponse.json({ ok: true })
}
