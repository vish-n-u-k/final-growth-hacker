import { db } from '@/lib/db'
import { brandBlogs } from '@/lib/db/schema'
import { and, desc, eq, inArray } from 'drizzle-orm'

// Blog posts written in GrowJin (Today › Weekly blog), so Claude can add them to the user's
// website and then mark them published here.

const UUID = /^[0-9a-f-]{36}$/i

export async function getBlogPost(brandId: string, blogId?: string) {
  const where = blogId
    ? and(eq(brandBlogs.brandId, brandId), eq(brandBlogs.id, blogId))
    : and(eq(brandBlogs.brandId, brandId), inArray(brandBlogs.status, ['draft', 'scheduled']))
  if (blogId && !UUID.test(blogId)) return { error: 'blog_id must be a UUID.' }
  const [post] = await db.select().from(brandBlogs).where(where).orderBy(desc(brandBlogs.createdAt)).limit(1)
  if (!post) return { error: blogId ? 'Blog post not found.' : 'No unpublished blog posts. Write one on the GrowJin Today page first.' }
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    meta_title: post.metaTitle ?? post.title,
    meta_description: post.metaDescription,
    target_keyword: post.targetKeyword,
    status: post.status,
    content_markdown: post.content,
    created_at: post.createdAt,
    next_step: 'Add this post to the website following how the site already publishes posts, then call mark_blog_published with the live URL once it is deployed.',
  }
}

export async function markBlogPublished(brandId: string, blogId: string, liveUrl?: string) {
  if (!UUID.test(blogId)) return { error: 'blog_id must be a UUID.' }
  let url: string | null = null
  if (liveUrl) {
    try { url = new URL(liveUrl).href } catch { return { error: 'live_url must be a full URL, e.g. https://example.com/blog/my-post' } }
  }
  const [row] = await db.update(brandBlogs)
    .set({ status: 'published', publishedAt: new Date(), ...(url ? { liveUrl: url, verificationStatus: 'pending' } : {}) })
    .where(and(eq(brandBlogs.brandId, brandId), eq(brandBlogs.id, blogId)))
    .returning({ id: brandBlogs.id, title: brandBlogs.title })
  if (!row) return { error: 'Blog post not found.' }
  return { ok: true, id: row.id, title: row.title, live_url: url, message: 'Marked as published in GrowJin.' }
}
