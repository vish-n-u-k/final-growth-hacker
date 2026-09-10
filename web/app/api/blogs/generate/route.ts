import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandBlogs } from '@/lib/db/schema'
import { eq, and, ne, count } from 'drizzle-orm'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60

const BLOG_LIMITS: Record<string, number> = {
  blog: 30, saas: 15, ecommerce: 12, agency: 10,
  local: 6, nonprofit: 8, event: 4, portfolio: 6,
}
const DEFAULT_BLOG_LIMIT = 10

const anthropic = new Anthropic()

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const replaceId: string | null = body.replaceId ?? null

  const [brand] = await db.select({
    id: brands.id,
    name: brands.name,
    websiteUrl: brands.websiteUrl,
    websiteType: brands.websiteType,
    keywords: brands.keywords,
    targetAudience: brands.targetAudience,
  }).from(brands).where(eq(brands.userId, user.id)).limit(1)

  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  const limit = BLOG_LIMITS[brand.websiteType ?? ''] ?? DEFAULT_BLOG_LIMIT

  // Count active blogs (status != 'replaced')
  const [row] = await db.select({ n: count() })
    .from(brandBlogs)
    .where(and(eq(brandBlogs.brandId, brand.id), ne(brandBlogs.status, 'replaced')))

  const activeCount = Number(row?.n ?? 0)

  // If at limit with no replaceId — ask client to choose a blog to replace
  if (activeCount >= limit && !replaceId) {
    const existing = await db.select({
      id: brandBlogs.id,
      title: brandBlogs.title,
      slug: brandBlogs.slug,
      status: brandBlogs.status,
      createdAt: brandBlogs.createdAt,
    })
      .from(brandBlogs)
      .where(and(eq(brandBlogs.brandId, brand.id), ne(brandBlogs.status, 'replaced')))
      .orderBy(brandBlogs.createdAt)

    return NextResponse.json({ atLimit: true, limit, blogs: existing })
  }

  // Mark replaced blog
  if (replaceId) {
    await db.update(brandBlogs)
      .set({ status: 'replaced' })
      .where(and(eq(brandBlogs.id, replaceId), eq(brandBlogs.brandId, brand.id)))
  }

  // Build prompt
  const systemPrompt = `You are an expert SEO content writer. You produce well-structured, engaging, keyword-optimised blog posts that rank on Google.`

  const userPrompt = `Generate a complete SEO blog post for ${brand.name} (${brand.websiteUrl}).
${brand.targetAudience ? `Target audience: ${brand.targetAudience}` : ''}
${brand.keywords ? `Brand keywords: ${brand.keywords}` : ''}

Output STRICT JSON only — no markdown fences, no explanation:
{
  "title": "...",
  "slug": "...",
  "metaTitle": "50-60 chars",
  "metaDescription": "145-160 chars",
  "targetKeyword": "primary keyword",
  "content": "...full markdown blog post..."
}

Rules:
- content: 900-1200 words, proper H2/H3 headings, include the primary keyword naturally, 2-3 LSI keywords, end with a clear call-to-action
- slug: lowercase, hyphenated, no special chars
- metaTitle: exactly 50-60 characters including brand name
- metaDescription: exactly 145-160 characters, include primary keyword`

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const raw = (message.content[0] as { type: string; text: string }).text ?? ''

  let parsed: {
    title: string
    slug: string
    metaTitle?: string
    metaDescription?: string
    targetKeyword?: string
    content: string
  }

  try {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
  }

  const [blog] = await db.insert(brandBlogs).values({
    brandId: brand.id,
    title: parsed.title,
    slug: parsed.slug,
    metaTitle: parsed.metaTitle ?? null,
    metaDescription: parsed.metaDescription ?? null,
    targetKeyword: parsed.targetKeyword ?? null,
    content: parsed.content,
    status: 'draft',
  }).returning({
    id: brandBlogs.id,
    title: brandBlogs.title,
    slug: brandBlogs.slug,
    metaTitle: brandBlogs.metaTitle,
    metaDescription: brandBlogs.metaDescription,
    targetKeyword: brandBlogs.targetKeyword,
    content: brandBlogs.content,
    status: brandBlogs.status,
    createdAt: brandBlogs.createdAt,
  })

  return NextResponse.json({ blog })
}
