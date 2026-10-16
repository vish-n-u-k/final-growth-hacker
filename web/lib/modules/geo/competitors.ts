import { db } from '@/lib/db'
import { competitors, modules } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { callAI } from '@/lib/ai/client'
import { fetchGeoData, type GeoFetchData } from './fetcher'

// Competitor sites for GEO Audit's side-by-side checks. Sources, in order:
//   1. GEO setup (competitor_urls requirement)
//   2. competitors found by Competitor Analysis (competitors table)
//   3. Competitor Analysis setup (its competitor_urls requirement)
//   4. a short AI suggestion from the brand context, kept only if the sites load
// AI suggestions are saved into GEO's setup so later runs compare against the same sites
// (and the user can see and edit them there). Results compared against suggested sites say so,
// until the user changes the list.

const MAX = 3

function normalise(raw: string): string | null {
  const t = raw.trim().replace(/^["']|["']$/g, '')
  if (!t) return null
  try {
    const u = new URL(t.startsWith('http') ? t : `https://${t}`)
    return u.hostname.includes('.') ? u.origin : null
  } catch { return null }
}

function hostOf(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u }
}

async function suggestCompetitors(websiteUrl: string, brandName: string, brainCtx?: string): Promise<string[]> {
  try {
    const raw = await callAI({
      system: 'You name real, currently operating direct competitors of a business. Reply with JSON only.',
      prompt: `Business: ${brandName || websiteUrl} (${websiteUrl})
${brainCtx ? `Context:\n${brainCtx.slice(0, 1500)}\n` : ''}
List up to 5 direct competitors that sell a similar product to the same customers. Only well-known companies you are confident exist; no marketplaces or review sites.
Return a JSON array of homepage URLs, e.g. ["https://example.com"]. Return [] if unsure.`,
      maxTokens: 300,
      model: 'claude-haiku-4-5-20251001',
    })
    const arr = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1)) as unknown[]
    return arr.map(String)
  } catch {
    return []
  }
}

export async function loadGeoCompetitors(
  brandId: string | undefined,
  requirements: Record<string, string>,
  ownUrl: string,
  brainCtx?: string,
): Promise<{ url: string; data: GeoFetchData; suggested?: boolean }[]> {
  const ownHost = hostOf(normalise(ownUrl) ?? ownUrl)
  const pick = (list: string[]) => [...new Set(list.map(normalise).filter((u): u is string => !!u && hostOf(u) !== ownHost))]

  let urls = pick((requirements['competitor_urls'] ?? '').split(/[,\n]/))
  // Still the list GrowJin suggested earlier (the user hasn't changed it)
  const listKey = (v: string | undefined) => pick((v ?? '').split(/[,\n]/)).sort().join(',')
  let suggested = urls.length > 0 && listKey(requirements['competitor_urls']) === listKey(requirements['competitor_urls_suggested'])
  if (urls.length === 0 && brandId) {
    const rows = await db.select({ url: competitors.url }).from(competitors).where(eq(competitors.brandId, brandId)).catch(() => [])
    urls = pick(rows.map(r => r.url))
  }
  if (urls.length === 0 && brandId) {
    const [ca] = await db.select({ requirements: modules.requirements }).from(modules)
      .where(and(eq(modules.brandId, brandId), eq(modules.type, 'competitor-analysis'))).limit(1).catch(() => [])
    urls = pick(((ca?.requirements as Record<string, string> | null)?.competitor_urls ?? '').split(/[,\n]/))
  }
  if (urls.length === 0) {
    urls = pick(await suggestCompetitors(ownUrl, requirements['brand_name'] ?? '', brainCtx))
    suggested = true
  }

  // Load candidates (light fetch: homepage, robots, llms.txt, sitemap, one post, FAQ page) until we have 3 that work.
  const loaded: { url: string; data: GeoFetchData; suggested?: boolean }[] = []
  for (let i = 0; i < urls.length && loaded.length < MAX; i += MAX) {
    const batch = urls.slice(i, i + MAX)
    const results = await Promise.all(batch.map(u => fetchGeoData({ website_url: u }, { light: true })))
    // (a competitor whose firewall blocks us can't be compared)
    results.forEach((r, j) => { if (!('error' in r) && !r.blocked && loaded.length < MAX) loaded.push({ url: batch[j], data: r, suggested }) })
  }

  if (suggested && loaded.length > 0 && brandId && !requirements['competitor_urls']) {
    const list = loaded.map(c => hostOf(c.url)).join(', ')
    const [geo] = await db.select({ id: modules.id, requirements: modules.requirements }).from(modules)
      .where(and(eq(modules.brandId, brandId), eq(modules.type, 'geo'))).limit(1).catch(() => [])
    if (geo) {
      const req = (geo.requirements as Record<string, string> | null) ?? {}
      await db.update(modules).set({ requirements: { ...req, competitor_urls: list, competitor_urls_suggested: list } }).where(eq(modules.id, geo.id)).catch(() => {})
    }
  }
  return loaded
}
