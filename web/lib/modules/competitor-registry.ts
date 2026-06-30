import { db } from '@/lib/db'
import { competitors } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export interface CompetitorRecord {
  url: string
  name?: string
  type?: 'direct' | 'indirect' | 'aspirational'
  marketPosition?: 'leader' | 'challenger' | 'niche_player' | 'new_entrant'
  primaryStrength?: string
  discoveredIn: string
}

/**
 * Store a competitor in the registry (or update if exists)
 */
export async function storeCompetitor(
  brandId: string,
  competitor: CompetitorRecord,
): Promise<void> {
  const normalized = competitor.url.startsWith('http')
    ? competitor.url
    : `https://${competitor.url}`

  await db
    .insert(competitors)
    .values({
      brandId,
      url: normalized,
      name: competitor.name,
      type: competitor.type,
      marketPosition: competitor.marketPosition,
      primaryStrength: competitor.primaryStrength,
      discoveredIn: competitor.discoveredIn,
      discoveredAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [competitors.brandId, competitors.url],
      set: {
        name: competitor.name,
        type: competitor.type,
        marketPosition: competitor.marketPosition,
        primaryStrength: competitor.primaryStrength,
        lastAnalyzedAt: new Date(),
      },
    })
}

/**
 * Store multiple competitors at once
 */
export async function storeCompetitors(
  brandId: string,
  competitorList: CompetitorRecord[],
): Promise<void> {
  await Promise.all(competitorList.map(c => storeCompetitor(brandId, c)))
}

/**
 * Get all registered competitors for a brand
 */
export async function getCompetitors(brandId: string): Promise<CompetitorRecord[]> {
  const results = await db
    .select()
    .from(competitors)
    .where(eq(competitors.brandId, brandId))

  return results.map(r => ({
    url: r.url,
    name: r.name || undefined,
    type: (r.type as any) || undefined,
    marketPosition: (r.marketPosition as any) || undefined,
    primaryStrength: r.primaryStrength || undefined,
    discoveredIn: r.discoveredIn || 'unknown',
  }))
}

/**
 * Get competitor URLs as a comma-separated string (for auto-populating requirements)
 */
export async function getCompetitorUrlsString(brandId: string): Promise<string> {
  const comps = await getCompetitors(brandId)
  return comps.map(c => c.url).join(',')
}

/**
 * Check if brand has any registered competitors
 */
export async function hasCompetitors(brandId: string): Promise<boolean> {
  const results = await db
    .select()
    .from(competitors)
    .where(eq(competitors.brandId, brandId))
    .limit(1)
  return results.length > 0
}
