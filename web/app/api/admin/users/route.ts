import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules, analysisRequests } from '@/lib/db/schema'
import { desc, eq, sql } from 'drizzle-orm'

function isAdmin(email: string | undefined): boolean {
  const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return adminEmails.includes(email ?? '')
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Get all brands with module count and last active timestamp
  const allBrands = await db
    .select({
      brandId: brands.id,
      userId: brands.userId,
      brandName: brands.name,
      websiteUrl: brands.websiteUrl,
      createdAt: brands.createdAt,
    })
    .from(brands)
    .orderBy(desc(brands.createdAt))

  if (allBrands.length === 0) {
    return NextResponse.json({ users: [] })
  }

  // Get module counts per brand
  const moduleCounts = await db
    .select({
      brandId: modules.brandId,
      count: sql<number>`count(*)`.as('count'),
      lastActive: sql<Date>`max(${modules.lastAnalyzedAt})`.as('last_active'),
    })
    .from(modules)
    .groupBy(modules.brandId)

  const moduleCountMap = new Map(moduleCounts.map(r => [r.brandId, r]))

  // Get most recent userEmail from analysisRequests per userId
  const recentRequests = await db
    .select({
      userId: analysisRequests.userId,
      userEmail: analysisRequests.userEmail,
    })
    .from(analysisRequests)
    .orderBy(desc(analysisRequests.requestedAt))

  // Build userId -> email map (first occurrence = most recent)
  const emailMap = new Map<string, string>()
  for (const r of recentRequests) {
    if (!emailMap.has(r.userId)) emailMap.set(r.userId, r.userEmail)
  }

  const users = allBrands.map(b => {
    const mc = moduleCountMap.get(b.brandId)
    return {
      brandId: b.brandId,
      userId: b.userId,
      userEmail: emailMap.get(b.userId) ?? '(no requests yet)',
      brandName: b.brandName,
      websiteUrl: b.websiteUrl,
      moduleCount: mc ? Number(mc.count) : 0,
      lastActive: mc?.lastActive ?? null,
    }
  })

  return NextResponse.json({ users })
}
