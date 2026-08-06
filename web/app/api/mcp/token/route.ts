import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { randomBytes } from 'crypto'

async function getBrandForUser(userId: string) {
  const [brand] = await db.select().from(brands).where(eq(brands.userId, userId)).limit(1)
  return brand ?? null
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const brand = await getBrandForUser(user.id)
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  const [row] = await db
    .select({ apiKey: brandIntegrations.apiKey })
    .from(brandIntegrations)
    .where(
      and(
        eq(brandIntegrations.brandId, brand.id),
        eq(brandIntegrations.provider, 'mcp'),
      ),
    )
    .limit(1)

  if (!row?.apiKey) {
    return NextResponse.json({ exists: false, keyPrefix: null })
  }

  return NextResponse.json({ exists: true, keyPrefix: row.apiKey.slice(0, 8) })
}

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const brand = await getBrandForUser(user.id)
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  const apiKey = randomBytes(20).toString('hex') // 40-char hex key

  await db
    .insert(brandIntegrations)
    .values({
      brandId: brand.id,
      provider: 'mcp',
      type: 'api_key',
      status: 'connected',
      apiKey,
    })
    .onConflictDoUpdate({
      target: [brandIntegrations.brandId, brandIntegrations.provider],
      set: { apiKey, status: 'connected', lastUsedAt: new Date() },
    })

  return NextResponse.json({ apiKey })
}
