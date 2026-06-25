import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { moduleId, requirements: newReqs } = body as {
    moduleId: string
    requirements: Record<string, string>
  }

  if (!moduleId || !newReqs || typeof newReqs !== 'object') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const [mod] = await db.select().from(modules).where(eq(modules.id, moduleId))
  if (!mod) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [brand] = await db.select().from(brands).where(eq(brands.id, mod.brandId))
  if (!brand || brand.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const merged = { ...(mod.requirements as Record<string, string> | null ?? {}), ...newReqs }
  await db.update(modules).set({ requirements: merged }).where(eq(modules.id, moduleId))

  return NextResponse.json({ ok: true })
}
