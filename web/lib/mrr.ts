import { cache } from 'react'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { parseMrrSettings, type MrrSettings } from '@/lib/mrr-shared'

// brands.mrr_settings (drizzle/brands_mrr.sql) isn't in the Drizzle schema on purpose: every
// select().from(brands) would fail until the column exists. Raw SQL here tolerates it missing.

export const getMrrSettings = cache(async (brandId: string): Promise<MrrSettings | null> => {
  try {
    const rows = await db.execute(sql`select mrr_settings from brands where id = ${brandId}`)
    const row = (rows as unknown as { mrr_settings: unknown }[])[0]
    return parseMrrSettings(row?.mrr_settings)
  } catch {
    return null
  }
})

/** false = the mrr_settings column hasn't been added yet. */
export async function saveMrrSettings(brandId: string, settings: MrrSettings | null): Promise<boolean> {
  try {
    const value = settings ? JSON.stringify(settings) : null
    await db.execute(sql`update brands set mrr_settings = ${value}::jsonb where id = ${brandId}`)
    return true
  } catch (err) {
    console.error('[mrr] save failed — has drizzle/brands_mrr.sql been run?', err)
    return false
  }
}
