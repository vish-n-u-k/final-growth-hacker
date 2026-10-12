import { cache } from 'react'
import { eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { getAccess } from '@/lib/billing/plan'

// Per-request helpers for server components. The shell layout, ProGate and the page all need the
// same user, brand and plan; React's cache() makes them share one lookup per request instead of
// repeating it. The session comes from the cookie: middleware has already verified it (getClaims)
// on this request, so there's no extra round trip to Supabase Auth here.

export const getSessionUser = cache(async () => {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return session?.user ?? null
})

export const getBrandForUser = cache(async (userId: string) => {
  const [brand] = await db.select().from(brands).where(eq(brands.userId, userId)).limit(1)
  return brand ?? null
})

export const getAccessCached = cache((brandId: string, email?: string | null) => getAccess(brandId, email))
