// Saves the audit's full-page screenshot to Supabase Storage: one image per brand, overwritten on
// each analysis, in a private bucket served through /api/brands/screenshot (owner only).

import { createAdminClient } from '@/lib/supabase/admin'
import type { PageScreenshot } from '@/lib/audit/elements'

export const SHOT_BUCKET = 'page-shots'
export const shotKey = (brandId: string) => `${brandId}/website`

let bucketReady: Promise<void> | null = null
function ensureBucket(storage: ReturnType<typeof createAdminClient>['storage']) {
  // createBucket fails harmlessly when it already exists
  bucketReady ??= storage.createBucket(SHOT_BUCKET, { public: false }).then(() => undefined, () => undefined)
  return bucketReady
}

/** Uploads the screenshot; returns its size and time, or null when storing failed. */
export async function saveScreenshot(brandId: string, shot: PageScreenshot): Promise<{ w: number; h: number; at: string } | null> {
  const m = /^data:(image\/[a-z]+);base64,(.+)$/i.exec(shot.data)
  if (!brandId || !m) return null
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error('[screenshot] SUPABASE_SERVICE_ROLE_KEY is not set: not saving'); return null }
  try {
    const { storage } = createAdminClient()
    await ensureBucket(storage)
    const { error } = await storage.from(SHOT_BUCKET).upload(shotKey(brandId), Buffer.from(m[2], 'base64'), {
      contentType: m[1],
      upsert: true,
      cacheControl: '60',
    })
    if (error) { console.error('[screenshot] upload failed:', error.message); return null }
    return { w: shot.w, h: shot.h, at: new Date().toISOString() }
  } catch (err) {
    console.error('[screenshot] upload failed:', err)
    return null
  }
}
