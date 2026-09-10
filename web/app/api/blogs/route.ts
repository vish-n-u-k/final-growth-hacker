import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandBlogs } from '@/lib/db/schema'
import { eq, and, ne, desc, count } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

const BLOG_LIMITS: Record<string, number> = {
  blog: 30, saas: 15, ecommerce: 12, agency: 10,
  local: 6, nonprofit: 8, event: 4, portfolio: 6,
}
const DEFAULT_BLOG_LIMIT = 10

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select({
    id: brands.id,
    websiteType: brands.websiteType,
  }).from(brands).where(eq(brands.userId, user.id)).limit(1)

  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  const limit = BLOG_LIMITS[brand.websiteType ?? ''] ?? DEFAULT_BLOG_LIMIT

  const [blogs, [countRow]] = await Promise.all([
    db.select({
      id: brandBlogs.id,
      title: brandBlogs.title,
      slug: brandBlogs.slug,
      metaTitle: brandBlogs.metaTitle,
      metaDescription: brandBlogs.metaDescription,
      targetKeyword: brandBlogs.targetKeyword,
      status: brandBlogs.status,
      publishedAt: brandBlogs.publishedAt,
      verificationStatus: brandBlogs.verificationStatus,
      verifiedLiveAt: brandBlogs.verifiedLiveAt,
      liveUrl: brandBlogs.liveUrl,
      createdAt: brandBlogs.createdAt,
    })
      .from(brandBlogs)
      .where(and(eq(brandBlogs.brandId, brand.id), ne(brandBlogs.status, 'replaced')))
      .orderBy(desc(brandBlogs.createdAt)),

    db.select({ n: count() })
      .from(brandBlogs)
      .where(and(eq(brandBlogs.brandId, brand.id), ne(brandBlogs.status, 'replaced'))),
  ])

  const activeCount = Number(countRow?.n ?? 0)

  // weeklyDue: true if no blogs or most recent blog was > 7 days ago
  const lastBlog = blogs[0] ?? null
  const daysSinceLast = lastBlog?.createdAt
    ? Math.floor((Date.now() - new Date(lastBlog.createdAt).getTime()) / 864e5)
    : null

  const weeklyDue = daysSinceLast === null || daysSinceLast >= 7

  return NextResponse.json({ blogs, limit, activeCount, weeklyDue })
}
