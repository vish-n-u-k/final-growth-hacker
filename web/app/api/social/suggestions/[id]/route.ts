import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { socialSuggestions } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { socialBrand } from '@/lib/frekto/route-auth'

// PATCH { status: 'dismissed' } — "Not interested". The topic is then never suggested again.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await socialBrand()
  if ('response' in auth) return auth.response
  const { id } = await params
  const { status } = await request.json() as { status?: string }
  if (status !== 'dismissed') return NextResponse.json({ error: 'Only status "dismissed" is supported' }, { status: 400 })

  const rows = await db.update(socialSuggestions)
    .set({ status: 'dismissed', updatedAt: new Date() })
    .where(and(eq(socialSuggestions.id, id), eq(socialSuggestions.brandId, auth.brandId), eq(socialSuggestions.status, 'suggested')))
    .returning({ id: socialSuggestions.id })
  if (rows.length === 0) return NextResponse.json({ error: 'Suggestion not found or already used' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
