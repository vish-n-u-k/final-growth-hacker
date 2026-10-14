import { getGscAccessToken } from './keyword-fetchers'

// Google indexing checks for the SEO module, straight from Search Console with the brand's
// service-account key: is the homepage indexed, are the sitemap's pages indexed, and is a sitemap
// submitted. URL Inspection quota is 2,000/day per property, so we only inspect a handful of pages.

export interface InspectedUrl {
  url: string
  indexed: boolean
  coverageState: string    // Google's own wording, e.g. "Submitted and indexed", "Crawled - currently not indexed"
  robotsTxtState: string   // ALLOWED | DISALLOWED
  indexingState: string    // INDEXING_ALLOWED | BLOCKED_BY_META_TAG | BLOCKED_BY_HTTP_HEADER | …
  lastCrawlTime: string
  googleCanonical: string
  userCanonical: string
}

export interface SubmittedSitemap {
  path: string
  lastSubmitted: string
  lastDownloaded: string
  isPending: boolean
  errors: number
  warnings: number
  urls: number
}

export type GscIndexingResult =
  | { ok: true; property: string; homepage: InspectedUrl | null; pages: InspectedUrl[]; sitemaps: SubmittedSitemap[] | null }
  | { ok: false; reason: string }

const MAX_PAGES = 8

async function gscFetch<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json() as Promise<T>
}

// Picks the Search Console property that covers this URL: the longest URL-prefix property it
// starts with, else a domain property (sc-domain:example.com) for its host.
export function pickProperty(entries: { siteUrl: string; permissionLevel: string }[], pageUrl: string): string | null {
  const usable = entries.filter(e => e.permissionLevel !== 'siteUnverifiedUser')
  const prefix = usable
    .filter(e => !e.siteUrl.startsWith('sc-domain:') && pageUrl.startsWith(e.siteUrl))
    .sort((a, b) => b.siteUrl.length - a.siteUrl.length)[0]
  if (prefix) return prefix.siteUrl
  const host = new URL(pageUrl).hostname
  const domain = usable.find(e => {
    if (!e.siteUrl.startsWith('sc-domain:')) return false
    const d = e.siteUrl.slice('sc-domain:'.length)
    return host === d || host.endsWith(`.${d}`)
  })
  return domain?.siteUrl ?? null
}

function inProperty(property: string, url: string): boolean {
  if (!property.startsWith('sc-domain:')) return url.startsWith(property)
  try {
    const host = new URL(url).hostname
    const d = property.slice('sc-domain:'.length)
    return host === d || host.endsWith(`.${d}`)
  } catch { return false }
}

async function inspect(token: string, property: string, url: string): Promise<InspectedUrl | null> {
  try {
    const data = await gscFetch<{ inspectionResult?: { indexStatusResult?: Record<string, string> } }>(
      token,
      'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect',
      { method: 'POST', body: JSON.stringify({ inspectionUrl: url, siteUrl: property, languageCode: 'en-US' }) },
    )
    const r = data.inspectionResult?.indexStatusResult ?? {}
    return {
      url,
      indexed: r.verdict === 'PASS',
      coverageState: r.coverageState ?? 'Unknown',
      robotsTxtState: r.robotsTxtState ?? '',
      indexingState: r.indexingState ?? '',
      lastCrawlTime: r.lastCrawlTime ?? '',
      googleCanonical: r.googleCanonical ?? '',
      userCanonical: r.userCanonical ?? '',
    }
  } catch {
    return null
  }
}

async function listSitemaps(token: string, property: string): Promise<SubmittedSitemap[] | null> {
  try {
    const data = await gscFetch<{ sitemap?: {
      path: string; lastSubmitted?: string; lastDownloaded?: string; isPending?: boolean
      errors?: string; warnings?: string; contents?: { submitted?: string }[]
    }[] }>(token, `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/sitemaps`)
    return (data.sitemap ?? []).map(s => ({
      path: s.path,
      lastSubmitted: s.lastSubmitted ?? '',
      lastDownloaded: s.lastDownloaded ?? '',
      isPending: !!s.isPending,
      errors: Number(s.errors ?? 0) || 0,
      warnings: Number(s.warnings ?? 0) || 0,
      urls: (s.contents ?? []).reduce((sum, c) => sum + (Number(c.submitted ?? 0) || 0), 0),
    }))
  } catch {
    return null
  }
}

export async function fetchGscIndexing(
  clientEmail: string,
  privateKey: string,
  homepageUrl: string,
  sitemapUrls: string[],
): Promise<GscIndexingResult> {
  let token: string
  try {
    token = await getGscAccessToken(clientEmail, privateKey)
  } catch {
    return { ok: false, reason: 'Google rejected the Search Console key. Re-check the service account email and private key in Settings → Integrations.' }
  }

  let property: string | null = null
  try {
    const data = await gscFetch<{ siteEntry?: { siteUrl: string; permissionLevel: string }[] }>(token, 'https://www.googleapis.com/webmasters/v3/sites')
    property = pickProperty(data.siteEntry ?? [], homepageUrl)
  } catch {
    return { ok: false, reason: 'Could not reach Google Search Console right now. Re-analyse to try again.' }
  }
  if (!property) {
    const host = (() => { try { return new URL(homepageUrl).hostname } catch { return homepageUrl } })()
    return {
      ok: false,
      reason: `The Search Console key can't see a property for ${host}. In Search Console → Settings → Users and permissions, add ${clientEmail} as a user on that property, then re-analyse.`,
    }
  }

  const home = homepageUrl.replace(/\/$/, '')
  // Shallowest pages first (/pricing before /blog/2024/some-post): those are the ones that matter most.
  const depth = (u: string) => { try { return new URL(u).pathname.split('/').filter(Boolean).length } catch { return 99 } }
  const pageUrls = [...new Set(sitemapUrls)]
    .filter(u => u.replace(/\/$/, '') !== home && inProperty(property!, u))
    .sort((a, b) => depth(a) - depth(b))
    .slice(0, MAX_PAGES)

  const sitemapsPromise = listSitemaps(token, property)
  // Three at a time keeps us well under the 600/minute URL Inspection limit.
  const inspected: (InspectedUrl | null)[] = []
  const queue = [homepageUrl, ...pageUrls]
  for (let i = 0; i < queue.length; i += 3) {
    inspected.push(...await Promise.all(queue.slice(i, i + 3).map(u => inspect(token, property!, u))))
  }
  const sitemaps = await sitemapsPromise

  return {
    ok: true,
    property,
    homepage: inspected[0] ?? null,
    pages: inspected.slice(1).filter((p): p is InspectedUrl => p !== null),
    sitemaps,
  }
}
