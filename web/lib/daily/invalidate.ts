import { db } from '@/lib/db'
import { brands, signalSnapshots } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'

/**
 * Today keeps its diagnosis (up to 20h) and its cards (up to 4h), and Analytics keeps its data
 * (up to 1h). After an integration is connected, changed or removed they're all out of date
 * (e.g. "Google Analytics is not connected" right after connecting it), so drop them and let the
 * next visit recompute. The Analytics data itself stays as a fallback; only its age is cleared.
 */
export async function invalidateToday(brandId: string): Promise<void> {
  await Promise.all([
    db.delete(signalSnapshots).where(and(eq(signalSnapshots.brandId, brandId), eq(signalSnapshots.source, 'diagnosis'))),
    db.update(brands).set({ signalsCachedAt: null, analyticsSnapshotAt: null }).where(eq(brands.id, brandId)),
  ]).catch((err) => console.error('[invalidateToday]', err))
}
