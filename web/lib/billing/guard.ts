import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { billingEnabled, getAccess } from '@/lib/billing/plan'

/**
 * For Pro-only API routes: returns a 402 response for a free account, or null to continue.
 * A no-op unless BILLING_ENABLED=true. Unauthenticated/brandless requests fall through to the
 * route's own checks.
 */
export async function requirePro(): Promise<NextResponse | null> {
  if (!billingEnabled()) return null
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return null
  const access = await getAccess(brand.id, user.email)
  if (access.pro) return null
  return NextResponse.json({ error: 'This feature is part of GrowJin Pro.', upgrade: true }, { status: 402 })
}
