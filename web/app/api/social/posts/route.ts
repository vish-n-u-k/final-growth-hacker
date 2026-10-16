import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { frektoScheduledPosts, socialSuggestions } from '@/lib/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { createDraft, refreshPost, toClientPost } from '@/lib/frekto/drafts'
import { socialBrand } from '@/lib/frekto/route-auth'

export const maxDuration = 90

// GET — the brand's posts (newest first), with unfinished previews re-checked
export async function GET() {
  const auth = await socialBrand()
  if ('response' in auth) return auth.response
  const rows = await db.select().from(frektoScheduledPosts)
    .where(eq(frektoScheduledPosts.brandId, auth.brandId))
    .orderBy(desc(frektoScheduledPosts.scheduledAt))
    .limit(60)
  const posts = await Promise.all(rows.map((p) => refreshPost(auth.brandId, p)))
  return NextResponse.json({ posts: posts.map(toClientPost) })
}

// POST { suggestionId } or { platform, topic, postType, scheduledAt? } — render a PREVIEW.
// Nothing is published; the post is saved as a draft for the user to approve.
export async function POST(request: NextRequest) {
  const auth = await socialBrand()
  if ('response' in auth) return auth.response
  const body = await request.json() as { suggestionId?: string; platform?: string; topic?: string; postType?: string; scheduledAt?: string }

  let input: { platform: string; topic: string; postType: string; scheduledAt: Date | null; source: string; suggestionId: string | null }
  if (body.suggestionId) {
    const [s] = await db.select().from(socialSuggestions)
      .where(and(eq(socialSuggestions.id, body.suggestionId), eq(socialSuggestions.brandId, auth.brandId), eq(socialSuggestions.kind, 'post')))
      .limit(1)
    if (!s) return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 })
    input = { platform: s.platform, topic: s.topic, postType: s.postType ?? 'image', scheduledAt: s.suggestedAt, source: 'suggestion', suggestionId: s.id }
  } else {
    if (!body.platform || !body.topic?.trim()) return NextResponse.json({ error: 'platform and topic are required' }, { status: 400 })
    const at = body.scheduledAt && !isNaN(Date.parse(body.scheduledAt)) ? new Date(body.scheduledAt) : null
    input = { platform: body.platform, topic: body.topic, postType: body.postType ?? 'image', scheduledAt: at, source: 'manual', suggestionId: null }
  }

  const result = await createDraft(auth.brandId, { ...input, waitMs: 70000 })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status ?? 500 })
  return NextResponse.json({ post: toClientPost(result.post) })
}
