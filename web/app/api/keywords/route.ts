import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations, keywordSnapshots, trackedKeywords } from '@/lib/db/schema'
import { eq, and, asc, desc } from 'drizzle-orm'

export type GscKeywordRow = {
  keyword: string
  position: number
  impressions: number
  clicks: number
  ctr: number
  trackedId: string | null     // non-null if this keyword is in tracked_keywords
  trackedStatus: string | null // 'tracking' | 'implemented' | 'dismissed' | 'suggested'
}

export type SuggestionRow = {
  id: string
  keyword: string
  aiReason: string | null
  aiIntent: string | null
  suggestedAt: string
}

export type TrackedWithGsc = {
  id: string
  keyword: string
  status: string
  source: string | null
  aiReason: string | null
  aiIntent: string | null
  trackingStartedAt: string | null
  implementedAt: string | null
  currentPosition: number | null
  startPosition: number | null
  positionDelta: number | null
  impressions: number | null
  clicks: number | null
}

// Kept for backwards compat
export type KeywordRow = {
  keyword: string
  impressions: number
  clicks: number
  position: number
  ctr: number
  positionDelta: number | null
  impressionsDelta: number | null
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  // Check GSC connection
  const [gscRow] = await db
    .select({ id: brandIntegrations.id })
    .from(brandIntegrations)
    .where(and(
      eq(brandIntegrations.brandId, brand.id),
      eq(brandIntegrations.provider, 'gsc_api'),
      eq(brandIntegrations.status, 'connected'),
    ))
    .limit(1)
  const hasGsc = !!gscRow

  // GSC 7d summary from cached analytics snapshot
  const snapshot = brand.analyticsSnapshot as Record<string, Record<string, number> | null> | null
  const gscData = snapshot?.['gsc']
  const gscSummary = typeof gscData?.['clicks7d'] === 'number'
    ? { clicks7d: gscData['clicks7d'], impressions7d: gscData['impressions7d'] ?? 0 }
    : null

  // All snapshots, ascending so latest is last
  const allSnapshots = await db
    .select()
    .from(keywordSnapshots)
    .where(eq(keywordSnapshots.brandId, brand.id))
    .orderBy(asc(keywordSnapshots.fetchedAt))

  const lastFetchedAt = allSnapshots.length > 0
    ? allSnapshots[allSnapshots.length - 1].fetchedAt.toISOString()
    : null

  // Isolate the latest batch
  const latestBatch = lastFetchedAt
    ? allSnapshots.filter(s => s.fetchedAt.toISOString() === lastFetchedAt)
    : []

  // ── Fuzzy match helper ────────────────────────────────────────────────────
  // Returns the highest-impression snapshot in `batch` where the tracked keyword
  // and the GSC query overlap (one contains the other, case-insensitive).
  function findBestFuzzyMatch(keyword: string, batch: typeof allSnapshots) {
    const kl = keyword.toLowerCase()
    const matches = batch.filter(s => {
      const sl = s.keyword.toLowerCase()
      return sl === kl || sl.includes(kl) || kl.includes(sl)
    })
    if (matches.length === 0) return null
    return matches.sort((a, b) => b.impressions - a.impressions)[0]
  }

  // ── Tracked keywords ──────────────────────────────────────────────────────
  const tracked = await db
    .select()
    .from(trackedKeywords)
    .where(eq(trackedKeywords.brandId, brand.id))
    .orderBy(desc(trackedKeywords.suggestedAt))

  // Map for cross-referencing GSC rows
  const trackedByKeyword = new Map(
    tracked.map(t => [t.keyword.toLowerCase(), { id: t.id, status: t.status }]),
  )

  // ── GSC Rankings table (raw latest batch, sorted by impressions) ──────────
  const gscKeywords: GscKeywordRow[] = latestBatch
    .slice()
    .sort((a, b) => b.impressions - a.impressions)
    .map(s => {
      const t = trackedByKeyword.get(s.keyword.toLowerCase())
      return {
        keyword: s.keyword,
        position: s.position,
        impressions: s.impressions,
        clicks: s.clicks,
        ctr: s.impressions > 0 ? s.clicks / s.impressions : 0,
        trackedId: t?.id ?? null,
        trackedStatus: t?.status ?? null,
      }
    })

  // ── computeGscData with fuzzy matching ────────────────────────────────────
  function computeGscData(t: typeof tracked[0]) {
    // Current position: best fuzzy match in the latest batch
    const currentMatch = findBestFuzzyMatch(t.keyword, latestBatch)
    if (!currentMatch) {
      return { currentPosition: null, startPosition: null, positionDelta: null, impressions: null, clicks: null }
    }

    // Start position: best fuzzy match in the first snapshot batch after tracking started
    let startPosition: number | null = null
    if (t.trackingStartedAt) {
      const afterTracking = allSnapshots.filter(s => s.fetchedAt >= t.trackingStartedAt!)
      if (afterTracking.length > 0) {
        const firstBatchTime = afterTracking[0].fetchedAt.toISOString()
        const firstBatch = afterTracking.filter(s => s.fetchedAt.toISOString() === firstBatchTime)
        const startMatch = findBestFuzzyMatch(t.keyword, firstBatch)
        startPosition = startMatch?.position ?? null
      }
    }

    return {
      currentPosition: currentMatch.position,
      startPosition,
      positionDelta: startPosition !== null ? startPosition - currentMatch.position : null,
      impressions: currentMatch.impressions,
      clicks: currentMatch.clicks,
    }
  }

  const suggestions: SuggestionRow[] = tracked
    .filter(t => t.status === 'suggested')
    .map(t => ({
      id: t.id,
      keyword: t.keyword,
      aiReason: t.aiReason,
      aiIntent: t.aiIntent,
      suggestedAt: t.suggestedAt.toISOString(),
    }))

  const tracking: TrackedWithGsc[] = tracked
    .filter(t => t.status === 'tracking')
    .map(t => ({
      id: t.id,
      keyword: t.keyword,
      status: t.status,
      source: t.source,
      aiReason: t.aiReason,
      aiIntent: t.aiIntent,
      trackingStartedAt: t.trackingStartedAt?.toISOString() ?? null,
      implementedAt: t.implementedAt?.toISOString() ?? null,
      ...computeGscData(t),
    }))

  const implemented: TrackedWithGsc[] = tracked
    .filter(t => t.status === 'implemented')
    .map(t => ({
      id: t.id,
      keyword: t.keyword,
      status: t.status,
      source: t.source,
      aiReason: t.aiReason,
      aiIntent: t.aiIntent,
      trackingStartedAt: t.trackingStartedAt?.toISOString() ?? null,
      implementedAt: t.implementedAt?.toISOString() ?? null,
      ...computeGscData(t),
    }))

  return NextResponse.json({
    hasGsc,
    lastFetchedAt,
    gscSummary,
    gscKeywords,
    suggestions,
    tracking,
    implemented,
  })
}
