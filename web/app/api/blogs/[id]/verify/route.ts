import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandBlogs } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export const maxDuration = 30

const SLUG_PATTERNS = [
  (base: string, slug: string) => `${base}/blog/${slug}`,
  (base: string, slug: string) => `${base}/posts/${slug}`,
  (base: string, slug: string) => `${base}/articles/${slug}`,
  (base: string, slug: string) => `${base}/news/${slug}`,
  (base: string, slug: string) => `${base}/${slug}`,
]

async function tryUrl(url: string, title: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'GrowJin-Verifier/1.0' },
    })
    if (!res.ok) return false
    const html = await res.text()
    // Check title words appear in the page (case-insensitive, first 4 words)
    const titleWords = title.toLowerCase().split(/\s+/).slice(0, 4)
    const body = html.toLowerCase()
    return titleWords.every(w => body.includes(w))
  } catch {
    return false
  }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const [brand] = await db.select({ id: brands.id, websiteUrl: brands.websiteUrl })
    .from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  const [blog] = await db.select({
    id: brandBlogs.id,
    slug: brandBlogs.slug,
    title: brandBlogs.title,
    status: brandBlogs.status,
  })
    .from(brandBlogs)
    .where(and(eq(brandBlogs.id, id), eq(brandBlogs.brandId, brand.id)))
    .limit(1)

  if (!blog) return NextResponse.json({ error: 'Blog not found' }, { status: 404 })

  // Mark as pending immediately
  await db.update(brandBlogs)
    .set({ verificationStatus: 'pending' })
    .where(eq(brandBlogs.id, id))

  const base = brand.websiteUrl.replace(/\/$/, '')

  // Try each pattern sequentially — stop on first hit
  let liveUrl: string | null = null
  for (const pattern of SLUG_PATTERNS) {
    const url = pattern(base, blog.slug)
    const found = await tryUrl(url, blog.title)
    if (found) { liveUrl = url; break }
  }

  if (liveUrl) {
    await db.update(brandBlogs)
      .set({
        verificationStatus: 'live',
        verifiedLiveAt: new Date(),
        liveUrl,
      })
      .where(eq(brandBlogs.id, id))

    return NextResponse.json({ status: 'live', liveUrl })
  }

  await db.update(brandBlogs)
    .set({ verificationStatus: 'not_found' })
    .where(eq(brandBlogs.id, id))

  return NextResponse.json({ status: 'not_found', triedPatterns: SLUG_PATTERNS.map(p => p(base, blog.slug)) })
}
