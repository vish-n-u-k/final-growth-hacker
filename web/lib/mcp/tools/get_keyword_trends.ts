import { db } from '@/lib/db'
import { trackedKeywords, keywordSnapshots } from '@/lib/db/schema'
import { eq, and, asc, inArray } from 'drizzle-orm'

export async function getKeywordTrends(brandId: string) {
  // Get all actively tracked or implemented keywords
  const tracked = await db
    .select()
    .from(trackedKeywords)
    .where(and(
      eq(trackedKeywords.brandId, brandId),
      inArray(trackedKeywords.status, ['tracking', 'implemented']),
    ))

  if (tracked.length === 0) {
    return {
      keywords: [],
      message: 'No keywords are being tracked yet. Go to the Keywords section in GrowJin to start tracking keywords.',
      summary: null,
    }
  }

  // Get all snapshots ordered ascending (latest last)
  const allSnapshots = await db
    .select()
    .from(keywordSnapshots)
    .where(eq(keywordSnapshots.brandId, brandId))
    .orderBy(asc(keywordSnapshots.fetchedAt))

  if (allSnapshots.length === 0) {
    return {
      keywords: tracked.map(t => ({
        keyword: t.keyword,
        status: t.status,
        startPosition: t.startPosition ?? null,
        currentPosition: null,
        positionDelta: null,
        trend: 'no data' as const,
        impressions: null,
        clicks: null,
      })),
      message: 'Keywords are tracked but no GSC snapshot data exists yet. Refresh your keyword data in the Keywords section.',
      summary: null,
    }
  }

  // Isolate latest batch
  const lastFetchedAt = allSnapshots[allSnapshots.length - 1].fetchedAt.toISOString()
  const latestBatch = allSnapshots.filter(s => s.fetchedAt.toISOString() === lastFetchedAt)

  // Fuzzy match: find best GSC snapshot for a tracked keyword
  function findBestMatch(keyword: string) {
    const kl = keyword.toLowerCase()
    const matches = latestBatch.filter(s => {
      const sl = s.keyword.toLowerCase()
      return sl === kl || sl.includes(kl) || kl.includes(sl)
    })
    if (matches.length === 0) return null
    return matches.sort((a, b) => b.impressions - a.impressions)[0]
  }

  const keywords = tracked.map(t => {
    const match = findBestMatch(t.keyword)
    const startPosition = t.startPosition ?? null
    const currentPosition = match ? match.position : null

    // positionDelta positive = improved (moved up in rankings)
    const positionDelta =
      startPosition !== null && currentPosition !== null
        ? Math.round((startPosition - currentPosition) * 10) / 10
        : null

    const trend =
      positionDelta === null ? 'no data' :
      positionDelta > 1 ? 'improving' :
      positionDelta < -1 ? 'declining' :
      'stable'

    return {
      keyword: t.keyword,
      status: t.status,
      intent: t.aiIntent ?? null,
      startPosition,
      currentPosition: currentPosition ? Math.round(currentPosition * 10) / 10 : null,
      positionDelta,
      trend,
      impressions: match?.impressions ?? null,
      clicks: match?.clicks ?? null,
      trackingStartedAt: t.trackingStartedAt?.toISOString() ?? null,
    }
  })

  // Summary stats
  const withData = keywords.filter(k => k.positionDelta !== null)
  const improving = withData.filter(k => k.trend === 'improving').length
  const declining = withData.filter(k => k.trend === 'declining').length
  const stable = withData.filter(k => k.trend === 'stable').length

  const biggestWin = withData
    .filter(k => (k.positionDelta ?? 0) > 0)
    .sort((a, b) => (b.positionDelta ?? 0) - (a.positionDelta ?? 0))[0] ?? null

  const biggestDrop = withData
    .filter(k => (k.positionDelta ?? 0) < 0)
    .sort((a, b) => (a.positionDelta ?? 0) - (b.positionDelta ?? 0))[0] ?? null

  return {
    keywords: keywords.sort((a, b) => (b.positionDelta ?? -999) - (a.positionDelta ?? -999)),
    lastSnapshotAt: lastFetchedAt,
    summary: {
      total: keywords.length,
      improving,
      declining,
      stable,
      noData: keywords.length - withData.length,
      biggestWin: biggestWin ? { keyword: biggestWin.keyword, positionsGained: biggestWin.positionDelta } : null,
      biggestDrop: biggestDrop ? { keyword: biggestDrop.keyword, positionsLost: Math.abs(biggestDrop.positionDelta ?? 0) } : null,
    },
  }
}
