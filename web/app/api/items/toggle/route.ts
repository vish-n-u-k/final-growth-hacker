import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules, moduleItems } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { updateUserResolved } from '@/lib/brain'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { itemId, checked } = await request.json()

  const [item] = await db.select().from(moduleItems).where(eq(moduleItems.id, itemId))
  if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

  const [mod] = await db.select().from(modules).where(eq(modules.id, item.moduleId))
  if (!mod) return NextResponse.json({ error: 'Module not found' }, { status: 404 })

  const [brand] = await db.select().from(brands).where(eq(brands.id, mod.brandId))
  if (!brand || brand.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await db
    .update(moduleItems)
    .set({
      userChecked: checked,
      userCheckedAt: checked ? new Date() : null,
      completedBy: checked ? (item.aiVerified ? 'ai' : 'user') : null,
      updatedAt: new Date(),
    })
    .where(eq(moduleItems.id, itemId))

  // Update brain memory with user's self-reported resolution
  try {
    await updateUserResolved(brand.id, item.slug, checked)
  } catch {
    // Non-fatal
  }

  return NextResponse.json({ ok: true })
}
