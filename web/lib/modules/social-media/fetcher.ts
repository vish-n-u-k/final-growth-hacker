import { db } from '@/lib/db'
import { brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

// ── Types ─────────────────────────────────────────────────────────────────────

export type SocialProvider = 'youtube' | 'twitter' | 'instagram' | 'facebook' | 'linkedin' | 'tiktok'

export type SocialTier = 'none' | 'homepage' | 'url_provided' | 'api_connected'

export interface HandleQuality {
  hasNumbers: boolean
  hasUnderscores: boolean
  matchesBrandName: 'exact' | 'close' | 'weak' | 'mismatch'
  matchScore: number      // 0–100
  length: number
  isProfessional: boolean
}

export interface HandleConsistency {
  handles: { platform: string; handle: string }[]
  isConsistent: boolean
  consistencyScore: number   // % of handles matching the majority
  majorityHandle: string | null
  inconsistentPlatforms: string[]
}

export interface SocialPlatformData {
  platform: SocialProvider
  tier: SocialTier
  detectedOnWebsite: boolean
  connected: boolean
  profileUrl: string | null
  handle: string | null
  // Tier 2: scraped from public profile page
  httpStatus: number | null
  publicPageTitle: string | null
  bioFromHtml: string | null
  profileImageUrl: string | null
  handleQuality: HandleQuality | null
  // Tier 3: API fields
  followerCount: number | null
  followingCount: number | null
  postCount: number | null
  bio: string | null
  websiteInBio: boolean
  profileImageSet: boolean
  lastPostDate: string | null
  postsPerWeek: number | null
  engagementRate: number | null
  fetchError: string | null
}

export interface SocialMediaFetchResult {
  websiteUrl: string
  brandName: string
  industry: string | null
  targetAudience: string | null
  platforms: SocialPlatformData[]
  socialLinksOnWebsite: { platform: string; url: string }[]
  handleConsistency: HandleConsistency
}

// ── Social link detection from homepage ───────────────────────────────────────

const SOCIAL_LINK_PATTERNS: { regex: RegExp; platform: string }[] = [
  { regex: /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?"'\s]+)/i, platform: 'instagram' },
  { regex: /(?:https?:\/\/)?(?:www\.)?twitter\.com\/([^/?"'\s]+)/i, platform: 'twitter' },
  { regex: /(?:https?:\/\/)?(?:www\.)?x\.com\/([^/?"'\s]+)/i, platform: 'twitter' },
  { regex: /(?:https?:\/\/)?(?:www\.)?facebook\.com\/([^/?"'\s]+)/i, platform: 'facebook' },
  { regex: /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(?:company|in)\/([^/?"'\s]+)/i, platform: 'linkedin' },
  { regex: /(?:https?:\/\/)?(?:www\.)?youtube\.com\/(?:@|channel\/)([^/?"'\s]+)/i, platform: 'youtube' },
  { regex: /(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@([^/?"'\s]+)/i, platform: 'tiktok' },
  { regex: /(?:https?:\/\/)?(?:www\.)?pinterest\.com\/([^/?"'\s]+)/i, platform: 'pinterest' },
  { regex: /(?:https?:\/\/)?(?:www\.)?threads\.net\/@([^/?"'\s]+)/i, platform: 'threads' },
]

function extractSocialLinksFromHtml(html: string): { platform: string; url: string }[] {
  const found = new Map<string, string>()
  const hrefMatches = html.match(/href=["']([^"']+)["']/gi) ?? []
  for (const match of hrefMatches) {
    const urlMatch = match.match(/href=["']([^"']+)["']/i)
    if (!urlMatch) continue
    const url = urlMatch[1]
    for (const { regex, platform } of SOCIAL_LINK_PATTERNS) {
      if (regex.test(url) && !found.has(platform)) {
        found.set(platform, url)
      }
    }
  }
  return [...found.entries()].map(([platform, url]) => ({ platform, url }))
}

// ── Handle extraction from profile URLs ───────────────────────────────────────

const HANDLE_PATTERNS: Record<SocialProvider, RegExp> = {
  instagram: /instagram\.com\/([^/?#\s]+)/i,
  twitter:   /(?:twitter|x)\.com\/([^/?#\s]+)/i,
  facebook:  /facebook\.com\/([^/?#\s]+)/i,
  linkedin:  /linkedin\.com\/(?:company|in)\/([^/?#\s]+)/i,
  youtube:   /youtube\.com\/@([^/?#\s]+)/i,
  tiktok:    /tiktok\.com\/@([^/?#\s]+)/i,
}

function extractHandle(url: string, platform: SocialProvider): string | null {
  const regex = HANDLE_PATTERNS[platform]
  if (!regex) return null
  const match = url.match(regex)
  if (!match) return null
  // Clean trailing slashes or query strings
  return match[1].replace(/[/?#].*$/, '').trim() || null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function calculatePostsPerWeek(timestamps: string[]): number | null {
  if (timestamps.length < 2) return null
  const ms = timestamps.map((t) => new Date(t).getTime()).sort((a, b) => b - a)
  const daySpan = (ms[0] - ms[ms.length - 1]) / (1000 * 60 * 60 * 24)
  if (daySpan === 0) return null
  return Math.round((timestamps.length / daySpan) * 7 * 10) / 10
}

function calculateEngagementRate(totalInteractions: number, postCount: number, followerCount: number): number | null {
  if (followerCount === 0 || postCount === 0) return null
  return Math.round((totalInteractions / postCount / followerCount) * 100 * 100) / 100
}

async function safeFetch(url: string, headers: Record<string, string>): Promise<unknown | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    const res = await fetch(url, { headers, signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function fetchHtml(url: string): Promise<string> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    const res = await fetch(url, {
      headers: { 'User-Agent': 'GrowJinBot/1.0 (Site Auditor)' },
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return ''
    return await res.text()
  } catch {
    return ''
  }
}

// ── Page meta scraping ────────────────────────────────────────────────────────

interface PageMeta {
  status: number | null
  title: string | null
  description: string | null
  imageUrl: string | null
}

function extractOgTag(html: string, property: string): string | null {
  const p1 = html.match(new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'))
  const p2 = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, 'i'))
  return (p1 ?? p2)?.[1]?.trim() ?? null
}

function extractMetaName(html: string, name: string): string | null {
  const p1 = html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'))
  const p2 = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, 'i'))
  return (p1 ?? p2)?.[1]?.trim() ?? null
}

// Use Googlebot UA for platforms that block generic bots
const PLATFORM_UA: Partial<Record<SocialProvider, string>> = {
  instagram: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  twitter:   'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  tiktok:    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
}
const DEFAULT_UA = 'GrowJinBot/1.0 (Site Auditor)'

async function fetchPublicPageMeta(url: string, platform: SocialProvider): Promise<PageMeta> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    const res = await fetch(url, {
      headers: { 'User-Agent': PLATFORM_UA[platform] ?? DEFAULT_UA },
      signal: controller.signal,
    })
    clearTimeout(timer)
    const status = res.status
    if (!res.ok) return { status, title: null, description: null, imageUrl: null }
    const html = await res.text()
    const title = extractOgTag(html, 'og:title') ?? html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? null
    const description = (extractOgTag(html, 'og:description') ?? extractMetaName(html, 'description'))?.slice(0, 500) ?? null
    const imageUrl = extractOgTag(html, 'og:image')
    return { status, title, description, imageUrl }
  } catch {
    return { status: null, title: null, description: null, imageUrl: null }
  }
}

// ── Handle quality scoring ────────────────────────────────────────────────────

function computeHandleQuality(handle: string, brandName: string): HandleQuality {
  const cleanHandle = handle.replace(/^@/, '').toLowerCase().trim()
  const hasNumbers = /\d/.test(cleanHandle)
  const hasUnderscores = cleanHandle.includes('_')
  const length = cleanHandle.length

  const normHandle = cleanHandle.replace(/[^a-z0-9]/g, '')
  const normBrand = brandName.toLowerCase().replace(/[^a-z0-9]/g, '')

  let matchScore: number
  if (normHandle === normBrand) {
    matchScore = 100
  } else if (normHandle.startsWith(normBrand) || normBrand.startsWith(normHandle)) {
    matchScore = 85
  } else if (normHandle.includes(normBrand) || normBrand.includes(normHandle)) {
    matchScore = 70
  } else {
    // Dice coefficient on bigrams
    const bigrams = (s: string) => Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2))
    const a = new Set(bigrams(normHandle))
    const b = new Set(bigrams(normBrand))
    let intersection = 0
    for (const bg of a) if (b.has(bg)) intersection++
    matchScore = a.size + b.size === 0 ? 0 : Math.round((2 * intersection) / (a.size + b.size) * 100)
  }

  const matchesBrandName: HandleQuality['matchesBrandName'] =
    matchScore >= 100 ? 'exact' :
    matchScore >= 70  ? 'close' :
    matchScore >= 35  ? 'weak'  : 'mismatch'

  return {
    hasNumbers,
    hasUnderscores,
    matchesBrandName,
    matchScore,
    length,
    isProfessional: !hasNumbers && length <= 25 && matchScore >= 35,
  }
}

// ── Cross-platform handle consistency ─────────────────────────────────────────

function computeHandleConsistency(platforms: SocialPlatformData[]): HandleConsistency {
  const withHandles = platforms.filter(
    p => p.handle && (p.tier === 'url_provided' || p.tier === 'api_connected'),
  )
  if (withHandles.length === 0) {
    return { handles: [], isConsistent: true, consistencyScore: 100, majorityHandle: null, inconsistentPlatforms: [] }
  }

  const entries = withHandles.map(p => ({
    platform: p.platform,
    handle: p.handle!,
    normalized: p.handle!.replace(/^@/, '').toLowerCase().replace(/[^a-z0-9]/g, ''),
  }))

  const freq = new Map<string, number>()
  for (const { normalized } of entries) freq.set(normalized, (freq.get(normalized) ?? 0) + 1)

  let majorityNorm = ''
  let maxFreq = 0
  for (const [norm, count] of freq) {
    if (count > maxFreq) { maxFreq = count; majorityNorm = norm }
  }

  const majorityHandle = entries.find(e => e.normalized === majorityNorm)?.handle ?? null
  const inconsistentPlatforms = entries.filter(e => e.normalized !== majorityNorm).map(e => e.platform)

  return {
    handles: entries.map(e => ({ platform: e.platform, handle: e.handle })),
    isConsistent: inconsistentPlatforms.length === 0,
    consistencyScore: Math.round((maxFreq / entries.length) * 100),
    majorityHandle,
    inconsistentPlatforms,
  }
}

// ── Platform API fetchers ─────────────────────────────────────────────────────

async function fetchYouTube(apiKey: string, channelId: string): Promise<Partial<SocialPlatformData>> {
  const channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${encodeURIComponent(channelId)}&key=${apiKey}`
  const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(channelId)}&type=video&order=date&maxResults=10&key=${apiKey}`

  const [data, searchData] = await Promise.all([
    safeFetch(channelUrl, {}) as Promise<{
      items?: {
        snippet: { description: string; thumbnails: { default?: { url: string } }; customUrl?: string }
        statistics: { subscriberCount?: string; videoCount?: string }
      }[]
    } | null>,
    safeFetch(searchUrl, {}) as Promise<{
      items?: { snippet: { publishedAt: string } }[]
    } | null>,
  ])

  if (!data?.items?.length) return { fetchError: 'Channel not found or API key invalid' }

  const item = data.items[0]
  const followerCount = item.statistics.subscriberCount ? parseInt(item.statistics.subscriberCount) : null
  const postCount = item.statistics.videoCount ? parseInt(item.statistics.videoCount) : null

  const timestamps = searchData?.items?.map((v) => v.snippet.publishedAt) ?? []
  const lastPostDate = timestamps[0] ?? null
  const postsPerWeek = calculatePostsPerWeek(timestamps)

  return {
    handle: item.snippet.customUrl ?? null,
    profileUrl: item.snippet.customUrl ? `https://youtube.com/${item.snippet.customUrl}` : `https://youtube.com/channel/${channelId}`,
    followerCount,
    followingCount: null,
    postCount,
    bio: item.snippet.description?.slice(0, 500) || null,
    websiteInBio: false,
    profileImageSet: !!item.snippet.thumbnails?.default?.url,
    lastPostDate,
    postsPerWeek,
    engagementRate: null,
    fetchError: null,
  }
}

async function fetchTwitter(bearerToken: string, username: string): Promise<Partial<SocialPlatformData>> {
  const url = `https://api.twitter.com/2/users/by/username/${encodeURIComponent(username)}?user.fields=public_metrics,description,profile_image_url,entities,url`
  const data = await safeFetch(url, { Authorization: `Bearer ${bearerToken}` }) as {
    data?: {
      public_metrics: { followers_count: number; following_count: number; tweet_count: number }
      description?: string
      profile_image_url?: string
      entities?: { url?: { urls?: { expanded_url: string }[] } }
    }
    errors?: unknown[]
  } | null

  if (!data?.data) return { fetchError: 'User not found or Bearer Token invalid / rate limited' }

  const { public_metrics, description, profile_image_url, entities } = data.data
  const websiteUrl = entities?.url?.urls?.[0]?.expanded_url
  const isDefaultAvatar = profile_image_url?.includes('default_profile') ?? false

  return {
    handle: `@${username}`,
    profileUrl: `https://x.com/${username}`,
    followerCount: public_metrics.followers_count,
    followingCount: public_metrics.following_count,
    postCount: public_metrics.tweet_count,
    bio: description?.slice(0, 500) || null,
    websiteInBio: !!websiteUrl,
    profileImageSet: !!profile_image_url && !isDefaultAvatar,
    lastPostDate: null,
    postsPerWeek: null,
    engagementRate: null,
    fetchError: null,
  }
}

async function fetchInstagram(accessToken: string, accountId: string): Promise<Partial<SocialPlatformData>> {
  const profileUrl = `https://graph.instagram.com/v18.0/${accountId}?fields=biography,followers_count,media_count,username,website&access_token=${accessToken}`
  const mediaUrl = `https://graph.instagram.com/v18.0/${accountId}/media?fields=timestamp,like_count,comments_count&limit=20&access_token=${accessToken}`

  const [profileData, mediaData] = await Promise.all([
    safeFetch(profileUrl, {}) as Promise<{
      biography?: string; followers_count?: number; media_count?: number
      username?: string; website?: string; error?: { message: string }
    } | null>,
    safeFetch(mediaUrl, {}) as Promise<{
      data?: { timestamp: string; like_count?: number; comments_count?: number }[]
    } | null>,
  ])

  if (!profileData || profileData.error) return { fetchError: profileData?.error?.message ?? 'Invalid access token or account ID' }

  const posts = mediaData?.data ?? []
  const timestamps = posts.map((p) => p.timestamp)
  const lastPostDate = timestamps[0] ?? null
  const postsPerWeek = calculatePostsPerWeek(timestamps)
  const totalInteractions = posts.reduce((sum, p) => sum + (p.like_count ?? 0) + (p.comments_count ?? 0), 0)
  const engagementRate = profileData.followers_count && posts.length
    ? calculateEngagementRate(totalInteractions, posts.length, profileData.followers_count)
    : null

  return {
    handle: profileData.username ? `@${profileData.username}` : null,
    profileUrl: profileData.username ? `https://instagram.com/${profileData.username}` : null,
    followerCount: profileData.followers_count ?? null,
    followingCount: null,
    postCount: profileData.media_count ?? null,
    bio: profileData.biography?.slice(0, 500) || null,
    websiteInBio: !!profileData.website,
    profileImageSet: true,
    lastPostDate,
    postsPerWeek,
    engagementRate,
    fetchError: null,
  }
}

async function fetchFacebook(accessToken: string, pageId: string): Promise<Partial<SocialPlatformData>> {
  const pageUrl = `https://graph.facebook.com/v18.0/${pageId}?fields=name,fan_count,followers_count,about,website,link,username&access_token=${accessToken}`
  const postsUrl = `https://graph.facebook.com/v18.0/${pageId}/posts?fields=created_time,reactions.summary(true),comments.summary(true)&limit=20&access_token=${accessToken}`

  const [pageData, postsData] = await Promise.all([
    safeFetch(pageUrl, {}) as Promise<{
      name?: string; fan_count?: number; followers_count?: number; about?: string
      website?: string; link?: string; username?: string; error?: { message: string }
    } | null>,
    safeFetch(postsUrl, {}) as Promise<{
      data?: { created_time: string; reactions?: { summary?: { total_count: number } }; comments?: { summary?: { total_count: number } } }[]
    } | null>,
  ])

  if (!pageData || pageData.error) return { fetchError: pageData?.error?.message ?? 'Invalid Page access token or Page ID' }

  const posts = postsData?.data ?? []
  const timestamps = posts.map((p) => p.created_time)
  const lastPostDate = timestamps[0] ?? null
  const postsPerWeek = calculatePostsPerWeek(timestamps)
  const followerCount = pageData.followers_count ?? pageData.fan_count ?? null
  const totalInteractions = posts.reduce((sum, p) => sum + (p.reactions?.summary?.total_count ?? 0) + (p.comments?.summary?.total_count ?? 0), 0)
  const engagementRate = followerCount && posts.length ? calculateEngagementRate(totalInteractions, posts.length, followerCount) : null

  return {
    handle: pageData.username ?? null,
    profileUrl: pageData.link ?? null,
    followerCount,
    followingCount: null,
    postCount: null,
    bio: pageData.about?.slice(0, 500) || null,
    websiteInBio: !!pageData.website,
    profileImageSet: true,
    lastPostDate,
    postsPerWeek,
    engagementRate,
    fetchError: null,
  }
}

async function fetchLinkedIn(accessToken: string, organizationId: string): Promise<Partial<SocialPlatformData>> {
  const headers = { Authorization: `Bearer ${accessToken}`, 'X-Restli-Protocol-Version': '2.0.0' }

  const [orgData, followersData] = await Promise.all([
    safeFetch(`https://api.linkedin.com/v2/organizations/${organizationId}`, headers) as Promise<{
      localizedName?: string; localizedDescription?: string; vanityName?: string; error?: string; message?: string
    } | null>,
    safeFetch(`https://api.linkedin.com/v2/networkSizes/${organizationId}?edgeType=CompanyFollowedByMember`, headers) as Promise<{
      firstDegreeSize?: number
    } | null>,
  ])

  if (!orgData || orgData.error) return { fetchError: orgData?.message ?? 'Invalid access token or Organization ID' }

  return {
    handle: orgData.vanityName ?? null,
    profileUrl: orgData.vanityName ? `https://linkedin.com/company/${orgData.vanityName}` : null,
    followerCount: followersData?.firstDegreeSize ?? null,
    followingCount: null,
    postCount: null,
    bio: orgData.localizedDescription?.slice(0, 500) || null,
    websiteInBio: null as unknown as boolean,
    profileImageSet: true,
    lastPostDate: null,
    postsPerWeek: null,
    engagementRate: null,
    fetchError: null,
  }
}

async function fetchTikTok(accessToken: string): Promise<Partial<SocialPlatformData>> {
  const url = `https://open.tiktokapis.com/v2/user/info/?fields=follower_count,following_count,video_count,bio_description,display_name`
  const data = await safeFetch(url, { Authorization: `Bearer ${accessToken}` }) as {
    data?: { user?: { follower_count?: number; following_count?: number; video_count?: number; bio_description?: string; display_name?: string } }
    error?: { code: string; message: string }
  } | null

  if (!data?.data?.user || data.error) return { fetchError: data?.error?.message ?? 'Invalid TikTok access token' }

  const user = data.data.user
  return {
    handle: user.display_name ?? null,
    profileUrl: null,
    followerCount: user.follower_count ?? null,
    followingCount: user.following_count ?? null,
    postCount: user.video_count ?? null,
    bio: user.bio_description?.slice(0, 500) || null,
    websiteInBio: null as unknown as boolean,
    profileImageSet: true,
    lastPostDate: null,
    postsPerWeek: null,
    engagementRate: null,
    fetchError: null,
  }
}

// ── Main fetcher ──────────────────────────────────────────────────────────────

export async function fetchSocialMediaData(
  requirements: Record<string, string>,
): Promise<SocialMediaFetchResult> {
  const websiteUrl = requirements['website_url'] ?? ''
  const brandId = requirements['brand_id'] ?? ''
  const industry = requirements['industry'] || null
  const targetAudience = requirements['target_audience'] || null
  const brandName = requirements['brand_name'] || ''

  // Load API integrations
  const integrations = brandId
    ? await db.select().from(brandIntegrations).where(and(eq(brandIntegrations.brandId, brandId), eq(brandIntegrations.status, 'connected')))
    : []
  const integrationMap = new Map(integrations.map((i) => [i.provider, i]))

  // Social profile URLs: module requirements take priority over social_profiles integration
  const savedProfilesMeta = (integrationMap.get('social_profiles')?.metadata as Record<string, string> | null) ?? {}
  const profileUrls: Record<SocialProvider, string | null> = {
    instagram: requirements['instagram_url'] || savedProfilesMeta['instagram_url'] || null,
    twitter:   requirements['twitter_url']   || savedProfilesMeta['twitter_url']   || null,
    linkedin:  requirements['linkedin_url']  || savedProfilesMeta['linkedin_url']  || null,
    youtube:   requirements['youtube_url']   || savedProfilesMeta['youtube_url']   || null,
    facebook:  requirements['facebook_url']  || savedProfilesMeta['facebook_url']  || null,
    tiktok:    requirements['tiktok_url']    || savedProfilesMeta['tiktok_url']    || null,
  }

  // Fetch homepage HTML → detect social links
  const html = await fetchHtml(websiteUrl)
  const socialLinksOnWebsite = html ? extractSocialLinksFromHtml(html) : []
  const websitePlatforms = new Set(socialLinksOnWebsite.map((l) => l.platform))

  // For each platform: extract handle from URL, scrape og:title from public page (in parallel)
  const platforms: SocialProvider[] = ['youtube', 'twitter', 'instagram', 'facebook', 'linkedin', 'tiktok']

  const platformResults = await Promise.allSettled(
    platforms.map(async (platform): Promise<SocialPlatformData> => {
      const integration = integrationMap.get(platform)
      const profileUrl = profileUrls[platform]
      const onWebsite = websitePlatforms.has(platform)

      // Base with everything null
      const base: SocialPlatformData = {
        platform,
        tier: 'none',
        detectedOnWebsite: onWebsite || !!profileUrl,
        connected: !!integration,
        profileUrl: profileUrl || null,
        handle: null,
        httpStatus: null,
        publicPageTitle: null,
        bioFromHtml: null,
        profileImageUrl: null,
        handleQuality: null,
        followerCount: null,
        followingCount: null,
        postCount: null,
        bio: null,
        websiteInBio: false,
        profileImageSet: false,
        lastPostDate: null,
        postsPerWeek: null,
        engagementRate: null,
        fetchError: null,
      }

      // Tier 3: API connected — call platform API
      if (integration) {
        let apiData: Partial<SocialPlatformData> = {}
        try {
          switch (platform) {
            case 'youtube': {
              const apiKey = integration.apiKey
              const channelId = (integration.metadata as Record<string, string> | null)?.channel_id
              if (!apiKey || !channelId) { apiData = { fetchError: 'API key or Channel ID not set' }; break }
              apiData = await fetchYouTube(apiKey, channelId)
              break
            }
            case 'twitter': {
              const bearerToken = integration.apiKey
              const username = (integration.metadata as Record<string, string> | null)?.twitter_username
              if (!bearerToken || !username) { apiData = { fetchError: 'Bearer Token or username not set' }; break }
              apiData = await fetchTwitter(bearerToken, username)
              break
            }
            case 'instagram': {
              const accessToken = integration.accessToken
              const accountId = (integration.metadata as Record<string, string> | null)?.instagram_account_id
              if (!accessToken || !accountId) { apiData = { fetchError: 'Access token or Account ID not set' }; break }
              apiData = await fetchInstagram(accessToken, accountId)
              break
            }
            case 'facebook': {
              const accessToken = integration.accessToken
              const pageId = (integration.metadata as Record<string, string> | null)?.page_id
              if (!accessToken || !pageId) { apiData = { fetchError: 'Access token or Page ID not set' }; break }
              apiData = await fetchFacebook(accessToken, pageId)
              break
            }
            case 'linkedin': {
              const accessToken = integration.accessToken
              const orgId = (integration.metadata as Record<string, string> | null)?.organization_id
              if (!accessToken || !orgId) { apiData = { fetchError: 'Access token or Organization ID not set' }; break }
              apiData = await fetchLinkedIn(accessToken, orgId)
              break
            }
            case 'tiktok': {
              const accessToken = integration.accessToken
              if (!accessToken) { apiData = { fetchError: 'Access token not set' }; break }
              apiData = await fetchTikTok(accessToken)
              break
            }
          }
        } catch (e) {
          apiData = { fetchError: e instanceof Error ? e.message : 'Unknown error' }
        }
        return { ...base, ...apiData, tier: 'api_connected' }
      }

      // Tier 2: Profile URL provided — extract handle, scrape page meta, score quality
      if (profileUrl) {
        const rawHandle = extractHandle(profileUrl, platform)
        const handle = rawHandle ? `@${rawHandle}` : null
        const meta = await fetchPublicPageMeta(profileUrl, platform)
        const handleQuality = rawHandle && brandName ? computeHandleQuality(rawHandle, brandName) : null
        return {
          ...base,
          handle,
          httpStatus: meta.status,
          publicPageTitle: meta.title,
          bioFromHtml: meta.description,
          profileImageUrl: meta.imageUrl,
          handleQuality,
          tier: 'url_provided',
        }
      }

      // Tier 1: Only detected on homepage (link found but no URL provided by user)
      if (onWebsite) {
        return { ...base, tier: 'homepage' }
      }

      // Tier 0: Not found anywhere
      return { ...base, tier: 'none' }
    }),
  )

  const resolvedPlatforms = platformResults.map((r) =>
    r.status === 'fulfilled' ? r.value : (r as PromiseRejectedResult).reason as SocialPlatformData,
  )

  return {
    websiteUrl,
    brandName,
    industry,
    targetAudience,
    platforms: resolvedPlatforms,
    socialLinksOnWebsite,
    handleConsistency: computeHandleConsistency(resolvedPlatforms),
  }
}
