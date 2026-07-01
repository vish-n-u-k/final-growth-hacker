import { load } from 'cheerio'
import { db } from '@/lib/db'
import { brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import type { CommunityFinderFetchResult, Community } from './types'

// ── Data sources ──────────────────────────────────────────────────────────────
// Reddit: free, keyless — discovered via DuckDuckGo search (Reddit content is
//   indexed by search engines, unlike FB/LinkedIn groups). Always runs.
// Facebook + LinkedIn: no free/official discovery exists (FB Groups API removed
//   2024, LinkedIn Groups API long dead). Only reachable via a paid scraper.
//   Apify's group-search actors handle it; Apify's free tier ($5/mo) covers it.
//   These only run if the brand has connected an Apify token in Settings.

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Shared scoring helpers ─────────────────────────────────────────────────────

function parseMemberCount(text: string): number {
  const match = text.match(/([\d,]+(?:\.\d+)?)\s*(K|M)?\+?\s*(members?|subscribers?|professionals?)?/i)
  if (!match) return 0
  const raw = parseFloat(match[1].replace(/,/g, ''))
  if (Number.isNaN(raw)) return 0
  const multiplier = match[2]?.toUpperCase() === 'M' ? 1_000_000 : match[2]?.toUpperCase() === 'K' ? 1_000 : 1
  return Math.round(raw * multiplier)
}

function computeRelevanceScore(name: string, extra: string, keywords: string[]): number {
  const lowerName = name.toLowerCase()
  const lowerAll = `${name} ${extra}`.toLowerCase()
  let score = 40
  for (const kw of keywords) {
    if (!kw) continue
    const lowerKw = kw.toLowerCase()
    if (lowerName.includes(lowerKw)) score += 15
    else if (lowerAll.includes(lowerKw)) score += 8
  }
  return Math.max(0, Math.min(100, score))
}

// ── Reddit discovery (free, via DuckDuckGo) ────────────────────────────────────

interface SearchResult {
  title: string
  link: string
  snippet: string
}

const SUBREDDIT_LINK_RE = /reddit\.com\/r\/([A-Za-z0-9_]+)\/?$/i

async function searchDuckDuckGo(query: string): Promise<{ results: SearchResult[]; rateLimited: boolean }> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return { results: [], rateLimited: false }
    const html = await res.text()
    if (html.includes('anomaly.js')) return { results: [], rateLimited: true }

    const $ = load(html)
    const results: SearchResult[] = []
    $('.result').each((_, el) => {
      const titleEl = $(el).find('.result__title a')
      const title = titleEl.text().trim()
      let link = titleEl.attr('href') ?? ''
      const uddgMatch = link.match(/[?&]uddg=([^&]+)/)
      if (uddgMatch) link = decodeURIComponent(uddgMatch[1])
      const snippet = $(el).find('.result__snippet').text().trim()
      if (title && link) results.push({ title, link, snippet })
    })
    return { results, rateLimited: false }
  } catch {
    return { results: [], rateLimited: false }
  }
}

function cleanRedditName(title: string): string {
  return title.replace(/\s*[|\-–—]\s*Reddit\s*$/i, '').trim() || title.trim()
}

async function discoverReddit(
  searchKeywords: string[],
  allKeywords: string[],
): Promise<{ communities: Community[]; rateLimited: boolean }> {
  const seen = new Map<string, Community>()
  let rank = 0
  let anyRateLimited = false

  // Sequential with a delay — parallel requests trip DuckDuckGo's rate limiter.
  for (let i = 0; i < searchKeywords.length; i++) {
    if (i > 0) await sleep(1500)
    const { results, rateLimited } = await searchDuckDuckGo(`reddit community for ${searchKeywords[i]}`)
    if (rateLimited) anyRateLimited = true

    for (const r of results) {
      const match = r.link.match(SUBREDDIT_LINK_RE)
      if (!match) continue
      const subreddit = match[1]
      if (seen.has(subreddit)) continue
      rank++

      const name = cleanRedditName(r.title) || `r/${subreddit}`
      const now = new Date().toISOString()

      seen.set(subreddit, {
        id: `reddit-${seen.size + 1}`,
        platform: 'reddit',
        platformId: subreddit,
        name,
        description: r.snippet ? r.snippet.slice(0, 300) : undefined,
        link: `https://www.reddit.com/r/${subreddit}/`,
        memberCount: parseMemberCount(`${r.title} ${r.snippet}`),
        // No API counts without an account — proxy activity from search rank.
        activityScore: Math.max(30, 80 - (rank - 1) * 6),
        relevanceScore: computeRelevanceScore(r.title, r.snippet, allKeywords),
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  const communities = [...seen.values()].sort(
    (a, b) => b.relevanceScore - a.relevanceScore || b.memberCount - a.memberCount,
  )
  return { communities, rateLimited: anyRateLimited && communities.length === 0 }
}

// ── Apify discovery (Facebook + LinkedIn) ──────────────────────────────────────
// Actor IDs (stable) — scraper-engine/facebook-groups-search-scraper and
// unseenuser/LinkedIn-Groups-Scraper. Both verified returning real data.
const FACEBOOK_ACTOR = 'KIfpJkST5OAX2A4EL'
const LINKEDIN_ACTOR = 'tA9KOqhX47HKuOCtY'
const APIFY_MAX_PER_KEYWORD = 6

async function runApifyActor<T>(actorId: string, input: Record<string, unknown>, apiKey: string): Promise<T[]> {
  try {
    const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${encodeURIComponent(apiKey)}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(70000),
    })
    if (!res.ok) return []
    return (await res.json()) as T[]
  } catch {
    return []
  }
}

interface FacebookActorItem {
  id?: string
  name?: string
  url?: string
  visibility?: string
  memberInfo?: string // e.g. "63,275 total members"
  postFrequency?: string // e.g. "6.5 posts a week" | "47.2 posts a day" | "Very low activity"
}

interface LinkedInActorItem {
  id?: string
  linkedinUrl?: string
  name?: string
  summary?: string
  members?: string // e.g. "639K members"
  membersCount?: number
}

function parseFacebookActivity(postFrequency: string | undefined): number {
  if (!postFrequency) return 40
  const lower = postFrequency.toLowerCase()
  if (lower.includes('very low')) return 20
  if (lower.includes('low')) return 35
  const perDay = lower.match(/([\d.]+)\s*posts?\s*a\s*day/)
  if (perDay) return Math.max(0, Math.min(100, Math.round(50 + parseFloat(perDay[1]) * 5)))
  const perWeek = lower.match(/([\d.]+)\s*posts?\s*a\s*week/)
  if (perWeek) return Math.max(0, Math.min(100, Math.round(30 + parseFloat(perWeek[1]) * 3)))
  return 40
}

async function discoverFacebook(
  searchKeywords: string[],
  allKeywords: string[],
  apiKey: string,
): Promise<Community[]> {
  const resultsPerKeyword = await Promise.all(
    searchKeywords.map((kw) =>
      runApifyActor<FacebookActorItem>(FACEBOOK_ACTOR, { startUrls: [kw], maxItems: APIFY_MAX_PER_KEYWORD }, apiKey),
    ),
  )

  const seen = new Map<string, Community>()
  for (const items of resultsPerKeyword) {
    for (const item of items) {
      if (!item.url || !item.name) continue
      if (seen.has(item.url)) continue
      const description = item.visibility ? `${item.visibility} group` : undefined
      const now = new Date().toISOString()

      seen.set(item.url, {
        id: `facebook-${seen.size + 1}`,
        platform: 'facebook',
        platformId: item.id ?? item.url,
        name: item.name,
        description,
        link: item.url,
        memberCount: parseMemberCount(item.memberInfo ?? ''),
        activityScore: parseFacebookActivity(item.postFrequency),
        relevanceScore: computeRelevanceScore(item.name, description ?? '', allKeywords),
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  return [...seen.values()].sort((a, b) => b.relevanceScore - a.relevanceScore || b.memberCount - a.memberCount)
}

async function discoverLinkedIn(
  searchKeywords: string[],
  allKeywords: string[],
  apiKey: string,
): Promise<Community[]> {
  const resultsPerKeyword = await Promise.all(
    searchKeywords.map((kw) =>
      runApifyActor<LinkedInActorItem>(
        LINKEDIN_ACTOR,
        { mode: 'search_groups', searchKeywords: kw, maxResults: APIFY_MAX_PER_KEYWORD },
        apiKey,
      ),
    ),
  )

  const seen = new Map<string, Community>()
  for (const items of resultsPerKeyword) {
    for (const item of items) {
      if (!item.linkedinUrl || !item.name) continue
      if (seen.has(item.linkedinUrl)) continue
      const description = item.summary ? item.summary.slice(0, 300) : undefined
      const now = new Date().toISOString()

      seen.set(item.linkedinUrl, {
        id: `linkedin-${seen.size + 1}`,
        platform: 'linkedin',
        platformId: item.id ?? item.linkedinUrl,
        name: item.name,
        description,
        link: item.linkedinUrl,
        memberCount: item.membersCount ?? parseMemberCount(item.members ?? ''),
        // LinkedIn group search exposes no activity signal.
        activityScore: 50,
        relevanceScore: computeRelevanceScore(item.name, description ?? '', allKeywords),
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  return [...seen.values()].sort((a, b) => b.relevanceScore - a.relevanceScore || b.memberCount - a.memberCount)
}

// ── Main fetcher ──────────────────────────────────────────────────────────────

export async function fetchCommunityDiscovery(
  requirements: Record<string, string>,
): Promise<CommunityFinderFetchResult> {
  const brandId = requirements['brand_id'] ?? ''
  const brandName = requirements['brand_name'] ?? ''
  const websiteUrl = requirements['website_url'] ?? ''
  const keywords = (requirements['brand_keywords'] ?? '').split(',').map((k) => k.trim()).filter(Boolean)

  const base: CommunityFinderFetchResult = {
    connected: true,
    brandId,
    brandName,
    websiteUrl,
    keywords,
    fetchErrors: [],
  }

  if (!brandId || keywords.length === 0) {
    base.fetchErrors.push('Brand ID and keywords are required')
    base.connected = false
    return base
  }

  // Optional Apify token unlocks Facebook + LinkedIn.
  let apifyKey: string | undefined
  try {
    const [apifyRow] = await db
      .select()
      .from(brandIntegrations)
      .where(
        and(
          eq(brandIntegrations.brandId, brandId),
          eq(brandIntegrations.provider, 'apify'),
          eq(brandIntegrations.status, 'connected'),
        ),
      )
    apifyKey = apifyRow?.apiKey ?? undefined
  } catch {
    // Non-fatal — Reddit still runs
  }

  const redditKeywords = keywords.slice(0, 2) // keeps below DuckDuckGo's rate limit
  const apifyKeywords = keywords.slice(0, 2) // bounds Apify cost per run

  const [redditResult, facebookGroups, linkedinGroups] = await Promise.all([
    discoverReddit(redditKeywords, keywords),
    apifyKey ? discoverFacebook(apifyKeywords, keywords, apifyKey) : Promise.resolve([]),
    apifyKey ? discoverLinkedIn(apifyKeywords, keywords, apifyKey) : Promise.resolve([]),
  ])

  // Flat list, capped per platform — the agent splits it back out by platform
  // into separate sub-module categories.
  const communities = [
    ...redditResult.communities.slice(0, 6),
    ...facebookGroups.slice(0, 6),
    ...linkedinGroups.slice(0, 6),
  ]

  if (communities.length === 0 && redditResult.rateLimited) {
    base.fetchErrors.push('Search was rate-limited. Wait a minute and try again.')
  }

  // Signals to the agent whether FB/LinkedIn discovery was available this run.
  base.apifyConnected = !!apifyKey

  base.discovery = {
    communities,
    totalFound: communities.length,
    completedAt: new Date().toISOString(),
  }

  return base
}
