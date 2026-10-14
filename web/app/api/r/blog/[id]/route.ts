import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { brandBlogs } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { isValidBlogSig } from '@/lib/blog-share'

export const dynamic = 'force-dynamic'

// GET /api/r/blog/:id?s=<sig> → the blog post as markdown with front matter (no login; signed).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const s = request.nextUrl.searchParams.get('s') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(id) || !isValidBlogSig(id, s)) return new Response('Not found', { status: 404 })
  const [post] = await db.select().from(brandBlogs).where(eq(brandBlogs.id, id)).limit(1)
  if (!post || post.status === 'replaced') return new Response('Not found', { status: 404 })
  const yaml = (v: string | null) => JSON.stringify(v ?? '')
  const md = [
    '---',
    `title: ${yaml(post.title)}`,
    `slug: ${yaml(post.slug)}`,
    `meta_title: ${yaml(post.metaTitle ?? post.title)}`,
    `meta_description: ${yaml(post.metaDescription)}`,
    `target_keyword: ${yaml(post.targetKeyword)}`,
    '---',
    '',
    post.content,
    '',
  ].join('\n')
  return new Response(md, { headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' } })
}
