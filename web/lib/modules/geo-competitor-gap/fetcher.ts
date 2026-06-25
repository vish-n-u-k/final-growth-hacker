import { fetchGeoData, type GeoFetchData } from '../geo/fetcher'

export interface CompetitorGapFetchData {
  url: string
  your: GeoFetchData
  competitors: Array<{ url: string; data: GeoFetchData }>
}

export async function fetchCompetitorGapData(
  requirements: Record<string, string>,
): Promise<CompetitorGapFetchData | { error: string }> {
  const websiteUrl = requirements['website_url']
  if (!websiteUrl) return { error: 'Website URL is required.' }

  const competitorUrlsRaw = requirements['competitor_urls']
  if (!competitorUrlsRaw?.trim()) return { error: 'At least one competitor URL is required.' }

  const competitorUrls = competitorUrlsRaw
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean)
    .slice(0, 3) // max 3 competitors

  if (competitorUrls.length === 0) return { error: 'At least one competitor URL is required.' }

  const [yourResult, ...competitorResults] = await Promise.all([
    fetchGeoData({ website_url: websiteUrl }),
    ...competitorUrls.map((url) => fetchGeoData({ website_url: url })),
  ])

  if ('error' in yourResult) return { error: `Could not fetch your site: ${yourResult.error}` }

  const competitors = competitorUrls
    .map((url, i) => {
      const result = competitorResults[i]
      if ('error' in result) return null
      return { url, data: result }
    })
    .filter((c): c is { url: string; data: GeoFetchData } => c !== null)

  if (competitors.length === 0) return { error: 'Could not fetch any competitor sites.' }

  return { url: websiteUrl, your: yourResult, competitors }
}
