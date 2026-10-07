import { db } from '@/lib/db'
import { modules, moduleItems } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

// Drops a checklist item the user says doesn't apply. Skipped items leave
// today's list and the pending list (same as the Skip button in the app).
export async function skipItem(brandId: string, itemId: string, reason?: string) {
  const [item] = await db.select().from(moduleItems).where(eq(moduleItems.id, itemId)).limit(1)
  if (!item) return { error: 'Item not found.' }

  const [mod] = await db.select().from(modules).where(eq(modules.id, item.moduleId)).limit(1)
  if (!mod || mod.brandId !== brandId) return { error: 'Not found.' }

  await db
    .update(moduleItems)
    .set({ userSkipped: true, userSkipReason: reason ?? null, updatedAt: new Date() })
    .where(eq(moduleItems.id, itemId))

  return { ok: true, itemId, skipped: true }
}
