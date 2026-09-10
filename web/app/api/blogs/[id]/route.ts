import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandBlogs } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const { status } = body as { status?: string }

  if (!status) return NextResponse.json({ error: 'status required' }, { status: 400 })

  const [brand] = await db.select({ id: brands.id })
    .from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'No brand' }, { status: 404 })

  const updates: Record<string, unknown> = { status }
  if (status === 'published') updates.publishedAt = new Date()

  const [updated] = await db.update(brandBlogs)
    .set(updates)
    .where(and(eq(brandBlogs.id, id), eq(brandBlogs.brandId, brand.id)))
    .returning({
      id: brandBlogs.id,
      status: brandBlogs.status,
      publishedAt: brandBlogs.publishedAt,
      verificationStatus: brandBlogs.verificationStatus,
      liveUrl: brandBlogs.liveUrl,
    })

  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ blog: updated })
}
