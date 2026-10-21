import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/admin'
import { db } from '@/lib/db'
import { aiUsageLogs, brands } from '@/lib/db/schema'
import { desc, eq, gte, sql } from 'drizzle-orm'

// AI spend from ai_usage_logs, for the admin Costs tab. Costs are estimates from list prices
// (lib/ai/pricing.ts); Gemini calls are counted but have no cost.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdminEmail(user.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const now = Date.now()
  const since30 = new Date(now - 30 * 86_400_000)
  const cost = sql<number>`coalesce(sum(${aiUsageLogs.costUsd}::numeric), 0)::float`
  const calls = sql<number>`count(*)::int`
  const sinceCost = (ms: number) => sql<number>`coalesce(sum(${aiUsageLogs.costUsd}::numeric) filter (where ${aiUsageLogs.createdAt} >= ${new Date(now - ms).toISOString()}), 0)::float`

  try {
    const [[totals], byFeature, byBrand, byModel, byDay] = await Promise.all([
      db.select({
        day: sinceCost(86_400_000),
        week: sinceCost(7 * 86_400_000),
        month: cost,
        calls,
      }).from(aiUsageLogs).where(gte(aiUsageLogs.createdAt, since30)),
      db.select({ feature: aiUsageLogs.moduleType, cost, calls })
        .from(aiUsageLogs).where(gte(aiUsageLogs.createdAt, since30))
        .groupBy(aiUsageLogs.moduleType).orderBy(desc(cost)),
      db.select({ brandId: aiUsageLogs.brandId, brandName: brands.name, websiteUrl: brands.websiteUrl, cost, calls })
        .from(aiUsageLogs).leftJoin(brands, eq(brands.id, aiUsageLogs.brandId))
        .where(gte(aiUsageLogs.createdAt, since30))
        .groupBy(aiUsageLogs.brandId, brands.name, brands.websiteUrl).orderBy(desc(cost)).limit(25),
      db.select({ model: aiUsageLogs.model, cost, calls })
        .from(aiUsageLogs).where(gte(aiUsageLogs.createdAt, since30))
        .groupBy(aiUsageLogs.model).orderBy(desc(cost)),
      db.select({ day: sql<string>`to_char(date_trunc('day', ${aiUsageLogs.createdAt}), 'YYYY-MM-DD')`, cost, calls })
        .from(aiUsageLogs).where(gte(aiUsageLogs.createdAt, new Date(now - 14 * 86_400_000)))
        .groupBy(sql`1`).orderBy(sql`1`),
    ])
    return NextResponse.json({ totals, byFeature, byBrand, byModel, byDay })
  } catch (err) {
    console.error('[admin/costs] query failed:', err)
    return NextResponse.json({ error: `Could not load costs: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 })
  }
}
