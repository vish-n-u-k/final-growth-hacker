import { db } from '@/lib/db'
import { brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

// ── Types ─────────────────────────────────────────────────────────────────────

export type SocialProvider = 'youtube' | 'twitter' | 'instagram' | 'facebook' | 'linkedin' | 'tiktok'

export interface SocialPlatformData {
  platform: SocialProvider
  connected: boolean          // true = API integration connected
  detectedOnWebsite: boolean  // true = social link found on homepage
  profileUrl: string | null
  handle: string | null
  followerCount: number | null
  followingCount: number | null
  postCount: number | null
  bio: string | null
  websiteInBio: boolean
  profileImageSet: boolean
  lastPostDate: string | null
  postsPerWeek: number | null
  engagementRate: number | null  // percentage, e.g. 3.2
  fetchError: string | null
}

export interface SocialMediaFetchResult {
  websiteUrl: string
  brandName: string
  industry: string | null
  targetAudience: string | null
  platforms: SocialPlatformData[]
  socialLinksOnWebsite: { platform: string; url: string }[]
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
  // Extract all href values
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function calculatePostsPerWeek(timestamps: string[]): number | null {
  if (timestamps.length < 2) return timestamps.length === 1 ? null : null
  const ms = timestamps.map((t) => new Date(t).getTime()).sort((a, b) => b - a)
  const daySpan = (ms[0] - ms[ms.length - 1]) / (1000 * 60 * 60 * 24)
  if (daySpan === 0) return null
  return Math.round((timestamps.length / daySpan) * 7 * 10) / 10
}

function calculateEngagementRate(
  totalInteractions: number,
  postCount: number,
  followerCount: number,
): number | null {
  if (followerCount === 0 || postCount === 0) return null
  const avgInteractions = totalInteractions / postCount
  return Math.round((avgInteractions / followerCount) * 100 * 100) / 100
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

async function fetchWebsiteHtml(url: string): Promise<string> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    const res = await fetch(url, {
      headers: { 'User-Agent': 'GrowthHackerBot/1.0 (Site Auditor)' },
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return ''
    return await res.text()
  } catch {
    return ''
  }
}

// ── Platform API fetchers ─────────────────────────────────────────────────────

async function fetchYouTube(
  apiKey: string,
  channelId: string,
): Promise<Partial<SocialPlatformData>> {
  const channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${encodeURIComponent(channelId)}&key=${apiKey}`
  const data = await safeFetch(channelUrl, {}) as {
    items?: {
      snippet: { description: string; thumbnails: { default?: { url: string } }; customUrl?: string }
      statistics: { subscriberCount?: string; videoCount?: string }
    }[]
  } | null

  if (!data?.items?.length) return { fetchError: 'Channel not found or API key invalid' }

  const item = data.items[0]
  const followerCount = item.statistics.subscriberCount ? parseInt(item.statistics.subscriberCount) : null
  const postCount = item.statistics.videoCount ? parseInt(item.statistics.videoCount) : null

  // Fetch recent videos for posting frequency
  const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(channelId)}&type=video&order=date&maxResults=10&key=${apiKey}`
  const searchData = await safeFetch(searchUrl, {}) as {
    items?: { snippet: { publishedAt: string } }[]
  } | null

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
    websiteInBio: false, // YouTube doesn't expose website-in-bio via basic snippet
    profileImageSet: !!item.snippet.thumbnails?.default?.url,
    lastPostDate,
    postsPerWeek,
    engagementRate: null, // Would require fetching individual video stats
    fetchError: null,
  }
}

async function fetchTwitter(
  bearerToken: string,
  username: string,
): Promise<Partial<SocialPlatformData>> {
  const url = `https://api.twitter.com/2/users/by/username/${encodeURIComponent(username)}?user.fields=public_metrics,description,profile_image_url,entities,url`
  const data = await safeFetch(url, {
    Authorization: `Bearer ${bearerToken}`,
  }) as {
    data?: {
      public_metrics: { followers_count: number; following_count: number; tweet_count: number }
      description?: string
      profile_image_url?: string
      entities?: { url?: { urls?: { expanded_url: string }[] } }
    }
    errors?: unknown[]
  } | null

  if (!data?.data) {
    return { fetchError: 'User not found or Bearer Token invalid / rate limited' }
  }

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
    lastPostDate: null, // Requires timeline endpoint (paid tier)
    postsPerWeek: null, // Requires timeline endpoint (paid tier)
    engagementRate: null, // Requires per-tweet data (paid tier)
    fetchError: null,
  }
}

async function fetchInstagram(
  accessToken: string,
  accountId: string,
): Promise<Partial<SocialPlatformData>> {
  const profileUrl = `https://graph.instagram.com/v18.0/${accountId}?fields=biography,followers_count,media_count,username,website&access_token=${accessToken}`
  const profileData = await safeFetch(profileUrl, {}) as {
    biography?: string
    followers_count?: number
    media_count?: number
    username?: string
    website?: string
    error?: { message: string }
  } | null

  if (!profileData || profileData.error) {
    return { fetchError: profileData?.error?.message ?? 'Invalid access token or account ID' }
  }

  // Fetch recent media for posting frequency and engagement
  const mediaUrl = `https://graph.instagram.com/v18.0/${accountId}/media?fields=timestamp,like_count,comments_count&limit=20&access_token=${accessToken}`
  const mediaData = await safeFetch(mediaUrl, {}) as {
    data?: { timestamp: string; like_count?: number; comments_count?: number }[]
  } | null

  const posts = mediaData?.data ?? []
  const timestamps = posts.map((p) => p.timestamp)
  const lastPostDate = timestamps[0] ?? null
  const postsPerWeek = calculatePostsPerWeek(timestamps)

  const totalInteractions = posts.reduce(
    (sum, p) => sum + (p.like_count ?? 0) + (p.comments_count ?? 0),
    0,
  )
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
    profileImageSet: true, // Instagram always has a profile image; can't check via API
    lastPostDate,
    postsPerWeek,
    engagementRate,
    fetchError: null,
  }
}

async function fetchFacebook(
  accessToken: string,
  pageId: string,
): Promise<Partial<SocialPlatformData>> {
  const pageUrl = `https://graph.facebook.com/v18.0/${pageId}?fields=name,fan_count,followers_count,about,website,link,username&access_token=${accessToken}`
  const pageData = await safeFetch(pageUrl, {}) as {
    name?: string
    fan_count?: number
    followers_count?: number
    about?: string
    website?: string
    link?: string
    username?: string
    error?: { message: string }
  } | null

  if (!pageData || pageData.error) {
    return { fetchError: pageData?.error?.message ?? 'Invalid Page access token or Page ID' }
  }

  // Fetch recent posts for frequency and engagement
  const postsUrl = `https://graph.facebook.com/v18.0/${pageId}/posts?fields=created_time,reactions.summary(true),comments.summary(true)&limit=20&access_token=${accessToken}`
  const postsData = await safeFetch(postsUrl, {}) as {
    data?: {
      created_time: string
      reactions?: { summary?: { total_count: number } }
      comments?: { summary?: { total_count: number } }
    }[]
  } | null

  const posts = postsData?.data ?? []
  const timestamps = posts.map((p) => p.created_time)
  const lastPostDate = timestamps[0] ?? null
  const postsPerWeek = calculatePostsPerWeek(timestamps)

  const followerCount = pageData.followers_count ?? pageData.fan_count ?? null
  const totalInteractions = posts.reduce(
    (sum, p) => sum + (p.reactions?.summary?.total_count ?? 0) + (p.comments?.summary?.total_count ?? 0),
    0,
  )
  const engagementRate = followerCount && posts.length
    ? calculateEngagementRate(totalInteractions, posts.length, followerCount)
    : null

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

async function fetchLinkedIn(
  accessToken: string,
  organizationId: string,
): Promise<Partial<SocialPlatformData>> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'X-Restli-Protocol-Version': '2.0.0',
  }

  const orgUrl = `https://api.linkedin.com/v2/organizations/${organizationId}`
  const orgData = await safeFetch(orgUrl, headers) as {
    localizedName?: string
    localizedDescription?: string
    vanityName?: string
    error?: string
    message?: string
  } | null

  if (!orgData || orgData.error) {
    return { fetchError: orgData?.message ?? 'Invalid access token or Organization ID' }
  }

  // Fetch follower count
  const followersUrl = `https://api.linkedin.com/v2/networkSizes/${organizationId}?edgeType=CompanyFollowedByMember`
  const followersData = await safeFetch(followersUrl, headers) as {
    firstDegreeSize?: number
  } | null

  return {
    handle: orgData.vanityName ?? null,
    profileUrl: orgData.vanityName ? `https://linkedin.com/company/${orgData.vanityName}` : null,
    followerCount: followersData?.firstDegreeSize ?? null,
    followingCount: null,
    postCount: null,
    bio: orgData.localizedDescription?.slice(0, 500) || null,
    websiteInBio: null as unknown as boolean, // Can't determine via basic API
    profileImageSet: true, // Can't determine without media API scope
    lastPostDate: null, // Requires ugcPosts endpoint
    postsPerWeek: null,
    engagementRate: null,
    fetchError: null,
  }
}

async function fetchTikTok(
  accessToken: string,
): Promise<Partial<SocialPlatformData>> {
  const url = `https://open.tiktokapis.com/v2/user/info/?fields=follower_count,following_count,video_count,bio_description,display_name`
  const data = await safeFetch(url, {
    Authorization: `Bearer ${accessToken}`,
  }) as {
    data?: {
      user?: {
        follower_count?: number
        following_count?: number
        video_count?: number
        bio_description?: string
        display_name?: string
      }
    }
    error?: { code: string; message: string }
  } | null

  if (!data?.data?.user || data.error) {
    return { fetchError: data?.error?.message ?? 'Invalid TikTok access token' }
  }

  const user = data.data.user

  return {
    handle: user.display_name ?? null,
    profileUrl: null, // Can't determine without username
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

  // Load all social integrations for this brand
  const integrations = brandId
    ? await db
        .select()
        .from(brandIntegrations)
        .where(
          and(
            eq(brandIntegrations.brandId, brandId),
            eq(brandIntegrations.status, 'connected'),
          ),
        )
    : []

  const integrationMap = new Map(integrations.map((i) => [i.provider, i]))

  // Fetch homepage HTML for social link detection
  const html = await fetchWebsiteHtml(websiteUrl)
  const socialLinksOnWebsite = html ? extractSocialLinksFromHtml(html) : []
  const websitePlatforms = new Set(socialLinksOnWebsite.map((l) => l.platform))

  // Fetch each connected platform in parallel
  const platformResults = await Promise.allSettled([
    (async (): Promise<SocialPlatformData> => {
      const integration = integrationMap.get('youtube')
      const base: SocialPlatformData = {
        platform: 'youtube',
        connected: !!integration,
        detectedOnWebsite: websitePlatforms.has('youtube'),
        profileUrl: null, handle: null, followerCount: null, followingCount: null,
        postCount: null, bio: null, websiteInBio: false, profileImageSet: false,
        lastPostDate: null, postsPerWeek: null, engagementRate: null, fetchError: null,
      }
      if (!integration) return base
      const apiKey = integration.apiKey
      const channelId = (integration.metadata as Record<string, string> | null)?.channel_id
      if (!apiKey || !channelId) return { ...base, fetchError: 'API key or Channel ID not set in integration' }
      return { ...base, ...await fetchYouTube(apiKey, channelId) }
    })(),

    (async (): Promise<SocialPlatformData> => {
      const integration = integrationMap.get('twitter')
      const base: SocialPlatformData = {
        platform: 'twitter',
        connected: !!integration,
        detectedOnWebsite: websitePlatforms.has('twitter'),
        profileUrl: null, handle: null, followerCount: null, followingCount: null,
        postCount: null, bio: null, websiteInBio: false, profileImageSet: false,
        lastPostDate: null, postsPerWeek: null, engagementRate: null, fetchError: null,
      }
      if (!integration) return base
      const bearerToken = integration.apiKey
      const username = (integration.metadata as Record<string, string> | null)?.twitter_username
      if (!bearerToken || !username) return { ...base, fetchError: 'Bearer Token or username not set in integration' }
      return { ...base, ...await fetchTwitter(bearerToken, username) }
    })(),

    (async (): Promise<SocialPlatformData> => {
      const integration = integrationMap.get('instagram')
      const base: SocialPlatformData = {
        platform: 'instagram',
        connected: !!integration,
        detectedOnWebsite: websitePlatforms.has('instagram'),
        profileUrl: null, handle: null, followerCount: null, followingCount: null,
        postCount: null, bio: null, websiteInBio: false, profileImageSet: false,
        lastPostDate: null, postsPerWeek: null, engagementRate: null, fetchError: null,
      }
      if (!integration) return base
      const accessToken = integration.accessToken
      const accountId = (integration.metadata as Record<string, string> | null)?.instagram_account_id
      if (!accessToken || !accountId) return { ...base, fetchError: 'Access token or Account ID not set in integration' }
      return { ...base, ...await fetchInstagram(accessToken, accountId) }
    })(),

    (async (): Promise<SocialPlatformData> => {
      const integration = integrationMap.get('facebook')
      const base: SocialPlatformData = {
        platform: 'facebook',
        connected: !!integration,
        detectedOnWebsite: websitePlatforms.has('facebook'),
        profileUrl: null, handle: null, followerCount: null, followingCount: null,
        postCount: null, bio: null, websiteInBio: false, profileImageSet: false,
        lastPostDate: null, postsPerWeek: null, engagementRate: null, fetchError: null,
      }
      if (!integration) return base
      const accessToken = integration.accessToken
      const pageId = (integration.metadata as Record<string, string> | null)?.page_id
      if (!accessToken || !pageId) return { ...base, fetchError: 'Access token or Page ID not set in integration' }
      return { ...base, ...await fetchFacebook(accessToken, pageId) }
    })(),

    (async (): Promise<SocialPlatformData> => {
      const integration = integrationMap.get('linkedin')
      const base: SocialPlatformData = {
        platform: 'linkedin',
        connected: !!integration,
        detectedOnWebsite: websitePlatforms.has('linkedin'),
        profileUrl: null, handle: null, followerCount: null, followingCount: null,
        postCount: null, bio: null, websiteInBio: false, profileImageSet: false,
        lastPostDate: null, postsPerWeek: null, engagementRate: null, fetchError: null,
      }
      if (!integration) return base
      const accessToken = integration.accessToken
      const orgId = (integration.metadata as Record<string, string> | null)?.organization_id
      if (!accessToken || !orgId) return { ...base, fetchError: 'Access token or Organization ID not set in integration' }
      return { ...base, ...await fetchLinkedIn(accessToken, orgId) }
    })(),

    (async (): Promise<SocialPlatformData> => {
      const integration = integrationMap.get('tiktok')
      const base: SocialPlatformData = {
        platform: 'tiktok',
        connected: !!integration,
        detectedOnWebsite: websitePlatforms.has('tiktok'),
        profileUrl: null, handle: null, followerCount: null, followingCount: null,
        postCount: null, bio: null, websiteInBio: false, profileImageSet: false,
        lastPostDate: null, postsPerWeek: null, engagementRate: null, fetchError: null,
      }
      if (!integration) return base
      const accessToken = integration.accessToken
      if (!accessToken) return { ...base, fetchError: 'Access token not set in integration' }
      return { ...base, ...await fetchTikTok(accessToken) }
    })(),
  ])

  const platforms = platformResults.map((r) =>
    r.status === 'fulfilled' ? r.value : (r.reason as SocialPlatformData),
  )

  return {
    websiteUrl,
    brandName,
    industry,
    targetAudience,
    platforms,
    socialLinksOnWebsite,
  }
}
