import { db } from '@/lib/db'
import { brands, modules, moduleItems } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { updateUserResolved } from '@/lib/brain'

export async function toggleItem(brandId: string, itemId: string, checked: boolean) {
  const [item] = await db.select().from(moduleItems).where(eq(moduleItems.id, itemId)).limit(1)
  if (!item) return { error: 'Item not found.' }

  const [mod] = await db.select().from(modules).where(eq(modules.id, item.moduleId)).limit(1)
  if (!mod) return { error: 'Module not found.' }

  const [brand] = await db.select().from(brands).where(eq(brands.id, mod.brandId)).limit(1)
  if (!brand || brand.id !== brandId) return { error: 'Not found.' }

  await db
    .update(moduleItems)
    .set({
      userChecked: checked,
      userCheckedAt: checked ? new Date() : null,
      completedBy: checked ? (item.aiVerified ? 'ai' : 'user') : null,
      updatedAt: new Date(),
    })
    .where(eq(moduleItems.id, itemId))

  try {
    await updateUserResolved(brand.id, item.slug, checked)
  } catch {
    // Non-fatal
  }

  return { ok: true, itemId, checked }
}
