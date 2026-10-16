import * as cheerio from 'cheerio'
import { db } from '@/lib/db'
import { brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { isJsShell } from '@/lib/audit/js-shell'
import { detectBlock, type BlockInfo } from '@/lib/audit/blocked'

// ── Types ─────────────────────────────────────────────────────────────────────

export type SocialProvider = 'youtube' | 'twitter' | 'instagram' | 'facebook' | 'linkedin' | 'tiktok'
export const SOCIAL_PLATFORMS: SocialProvider[] = ['instagram', 'linkedin', 'facebook', 'youtube', 'twitter', 'tiktok']
export const PLATFORM_NAME: Record<SocialProvider, string> = {
  instagram: 'Instagram', linkedin: 'LinkedIn', facebook: 'Facebook', youtube: 'YouTube', twitter: 'X (Twitter)', tiktok: 'TikTok',
}

/** Where we learned about a profile: module setup / Settings, the website's links, or a connected account. */
export type ProfileSource = 'setup' | 'website' | 'connected'

// Numbers read from a connected account. null = the platform didn't give us this one.
export interface PlatformMetrics {
  via: string                     // which connection: 'Instagram (one-click)', 'Facebook page'…
  followerCount: number | null
  postCount: number | null
  bio: string | null
  websiteInBio: boolean | null
  lastPostDate: string | null
  postsPerWeek: number | null
  engagementRate: number | null   // % of followers who like/comment on an average recent post
  fetchError: string | null
}

export interface SocialPlatformData {
  platform: SocialProvider
  profileUrl: string | null
  source: ProfileSource | null
  onWebsite: boolean
  handle: string | null           // without @
  // The profile link, opened by our checker: 'ok' (it opens), 'broken' (404/410), 'unknown' (the
  // platform blocked or redirected us, as Instagram, X and LinkedIn often do)
  link: 'ok' | 'broken' | 'unknown' | null
  linkStatus: number | null
  publicTitle: string | null
  // A YouTube channel's newest video date, from its public feed (no API needed)
  publicLastPostDate: string | null
  metrics: PlatformMetrics | null // null = no connected account for this platform
}

export interface SocialMediaFetchResult {
  websiteUrl: string
  brandName: string
  industry: string | null
  targetAudience: string | null
  homepageLoaded: boolean
  homepageIsJsShell: boolean      // links are added by JavaScript, so we can't see them
  homepageBlocked: BlockInfo | null // a firewall answered instead of the site
  socialLinksOnWebsite: { platform: SocialProvider; url: string }[]
  platforms: SocialPlatformData[]
}

// ── Profile links ─────────────────────────────────────────────────────────────

const HOSTS: [RegExp, SocialProvider][] = [
  [/(^|\.)instagram\.com$/i, 'instagram'],
  [/(^|\.)(twitter\.com|x\.com)$/i, 'twitter'],
  [/(^|\.)(facebook\.com|fb\.com)$/i, 'facebook'],
  [/(^|\.)linkedin\.com$/i, 'linkedin'],
  [/(^|\.)youtube\.com$/i, 'youtube'],
  [/(^|\.)tiktok\.com$/i, 'tiktok'],
]

// Paths that are share buttons, posts or app pages, not a profile
const NOT_PROFILE: Record<SocialProvider, RegExp> = {
  instagram: /^\/(p|reel|reels|stories|explore|tv|accounts|direct)(\/|$)/i,
  twitter: /^\/(intent|share|home|search|hashtag|i|explore|login|signup)(\/|$)|\/status\//i,
  facebook: /^\/(sharer|share|dialog|plugins|login|tr|events|watch|photo|groups|story\.php|permalink\.php)(\/|\.php|$)/i,
  linkedin: /^\/(shareArticle|sharing|feed|posts|pulse|jobs|login)(\/|$)/i,
  youtube: /^\/(watch|embed|shorts|playlist|results|redirect)(\/|$)/i,
  tiktok: /^\/(share|embed|tag|music|discover)(\/|$)|\/video\//i,
}

/** The platform and handle a profile URL points to, or null when it isn't a profile link. */
export function parseProfileUrl(raw: string): { platform: SocialProvider; handle: string | null; url: string } | null {
  let u: URL
  try { u = new URL(raw.startsWith('http') ? raw : `https://${raw}`) } catch { return null }
  const platform = HOSTS.find(([re]) => re.test(u.hostname))?.[1]
  if (!platform) return null
  const path = u.pathname.replace(/\/+$/, '') || '/'
  if (path === '/' || NOT_PROFILE[platform].test(path)) return null
  const seg = path.split('/').filter(Boolean)
  let handle: string | null = null
  switch (platform) {
    case 'linkedin':
      // Company pages only: /company/<name> (a personal /in/ profile isn't the brand's page)
      if (seg[0] !== 'company' && seg[0] !== 'showcase' && seg[0] !== 'school') return null
      handle = seg[1] ?? null
      break
    case 'youtube':
      handle = seg[0].startsWith('@') ? seg[0].slice(1) : (seg[0] === 'c' || seg[0] === 'user') ? seg[1] ?? null : null // /channel/UC… has no handle
      if (!seg[0].startsWith('@') && !['c', 'user', 'channel'].includes(seg[0])) return null
      break
    case 'tiktok':
      if (!seg[0].startsWith('@')) return null
      handle = seg[0].slice(1)
      break
    case 'facebook':
      // facebook.com/profile.php?id=123 and /people/… have no readable handle
      handle = /^profile\.php$/i.test(seg[0]) || seg[0] === 'people' || seg[0] === 'pages' ? null : seg[0]
      break
    default:
      handle = seg[0].replace(/^@/, '')
  }
  return { platform, handle: handle ? decodeURIComponent(handle) : null, url: u.href }
}

/** Profile links on the page (header, footer, anywhere), first one per platform. */
function profileLinksIn(html: string, pageUrl: string): { platform: SocialProvider; url: string }[] {
  const $ = cheerio.load(html)
  const found = new Map<SocialProvider, string>()
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    let abs: string
    try { abs = new URL(href, pageUrl).href } catch { return }
    const p = parseProfileUrl(abs)
    if (p && !found.has(p.platform)) found.set(p.platform, p.url)
  })
  return [...found].map(([platform, url]) => ({ platform, url }))
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

const UA = 'Mozilla/5.0 (compatible; GrowJinBot/1.0; +https://growjin.com)'

async function getJson(url: string, headers: Record<string, string> = {}): Promise<Record<string, any>> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) })
  const body = (await res.json().catch(() => ({}))) as Record<string, any>
  if (!res.ok || body.error) {
    const msg = body.error?.message ?? body.message ?? `HTTP ${res.status}`
    throw new Error(String(msg))
  }
  return body
}

async function fetchText(url: string, timeoutMs = 10000): Promise<{ status: number | null; html: string; block: BlockInfo | null }> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) })
    const body = await res.text().catch(() => '')
    const block = detectBlock(res.status, res.headers, body)
    return { status: res.status, html: res.ok && !block ? body : '', block }
  } catch {
    return { status: null, html: '', block: null }
  }
}

function postsPerWeek(timestamps: string[]): number | null {
  if (timestamps.length < 2) return null
  const ms = timestamps.map((t) => Date.parse(t)).filter(Number.isFinite).sort((a, b) => b - a)
  const days = (ms[0] - ms[ms.length - 1]) / 86_400_000
  return days > 0 ? Math.round((ms.length / days) * 7 * 10) / 10 : null
}

function engagement(interactions: number, posts: number, followers: number | null): number | null {
  if (!followers || !posts) return null
  return Math.round((interactions / posts / followers) * 100 * 100) / 100
}

const newest = (dates: (string | null | undefined)[]) => dates.filter((d): d is string => !!d && Number.isFinite(Date.parse(d))).sort().at(-1) ?? null

const emptyMetrics = (via: string): PlatformMetrics => ({
  via, followerCount: null, postCount: null, bio: null, websiteInBio: null,
  lastPostDate: null, postsPerWeek: null, engagementRate: null, fetchError: null,
})

// ── Connected accounts ────────────────────────────────────────────────────────

type Integration = typeof brandIntegrations.$inferSelect
const metaOf = (i: Integration | undefined) => (i?.metadata as Record<string, string> | null) ?? {}

/** Instagram business account via Facebook (Meta one-click) or the Instagram one-click login. */
async function instagramMetrics(conn: Integration, viaMeta: boolean): Promise<PlatformMetrics> {
  const m = metaOf(conn)
  const out = emptyMetrics(viaMeta ? 'Instagram (via Meta)' : 'Instagram (one-click)')
  const id = m.instagram_id
  const token = (viaMeta ? m.page_access_token : '') || conn.accessToken || ''
  if (!id || !token) return { ...out, fetchError: 'The Instagram connection has no account ID — reconnect it in Settings.' }
  const base = viaMeta ? 'https://graph.facebook.com/v21.0' : 'https://graph.instagram.com/v21.0'
  try {
    const [profile, media] = await Promise.all([
      getJson(`${base}/${id}?fields=username,followers_count,media_count,biography,website&access_token=${encodeURIComponent(token)}`),
      getJson(`${base}/${id}/media?fields=timestamp,like_count,comments_count&limit=20&access_token=${encodeURIComponent(token)}`).catch(() => ({ data: [] })),
    ])
    const posts = (media.data ?? []) as { timestamp: string; like_count?: number; comments_count?: number }[]
    const followers = typeof profile.followers_count === 'number' ? profile.followers_count : null
    return {
      ...out,
      followerCount: followers,
      postCount: typeof profile.media_count === 'number' ? profile.media_count : null,
      bio: profile.biography ?? null,
      websiteInBio: !!profile.website,
      lastPostDate: newest(posts.map(p => p.timestamp)),
      postsPerWeek: postsPerWeek(posts.map(p => p.timestamp)),
      engagementRate: engagement(posts.reduce((n, p) => n + (p.like_count ?? 0) + (p.comments_count ?? 0), 0), posts.length, followers),
    }
  } catch (e) {
    return { ...out, fetchError: (e as Error).message }
  }
}

async function instagramManual(conn: Integration): Promise<PlatformMetrics> {
  const id = metaOf(conn).instagram_account_id
  if (!conn.accessToken || !id) return { ...emptyMetrics('Instagram (token)'), fetchError: 'Access token or account ID not set' }
  return instagramMetrics({ ...conn, metadata: { instagram_id: id } }, false).then(r => ({ ...r, via: 'Instagram (token)' }))
}

async function facebookMetrics(pageId: string, token: string, via: string): Promise<PlatformMetrics> {
  const out = emptyMetrics(via)
  try {
    const [page, feed] = await Promise.all([
      getJson(`https://graph.facebook.com/v21.0/${pageId}?fields=name,fan_count,followers_count,about,website,username&access_token=${encodeURIComponent(token)}`),
      getJson(`https://graph.facebook.com/v21.0/${pageId}/posts?fields=created_time,reactions.summary(true),comments.summary(true)&limit=20&access_token=${encodeURIComponent(token)}`).catch(() => ({ data: [] })),
    ])
    const posts = (feed.data ?? []) as { created_time: string; reactions?: { summary?: { total_count: number } }; comments?: { summary?: { total_count: number } } }[]
    const followers = page.followers_count ?? page.fan_count ?? null
    return {
      ...out,
      followerCount: followers,
      bio: page.about ?? null,
      websiteInBio: !!page.website,
      lastPostDate: newest(posts.map(p => p.created_time)),
      postsPerWeek: postsPerWeek(posts.map(p => p.created_time)),
      engagementRate: engagement(posts.reduce((n, p) => n + (p.reactions?.summary?.total_count ?? 0) + (p.comments?.summary?.total_count ?? 0), 0), posts.length, followers),
    }
  } catch (e) {
    return { ...out, fetchError: (e as Error).message }
  }
}

async function linkedinMetrics(token: string, orgId: string, via: string): Promise<PlatformMetrics> {
  const out = emptyMetrics(via)
  const urn = orgId.startsWith('urn:') ? orgId : `urn:li:organization:${orgId}`
  const id = urn.split(':').pop()
  const v2 = { Authorization: `Bearer ${token}`, 'X-Restli-Protocol-Version': '2.0.0' }
  const rest = { ...v2, 'LinkedIn-Version': '202401' }
  try {
    const [org, size, posts] = await Promise.all([
      getJson(`https://api.linkedin.com/v2/organizations/${id}`, v2),
      getJson(`https://api.linkedin.com/v2/networkSizes/${encodeURIComponent(urn)}?edgeType=CompanyFollowedByMember`, v2).catch((): Record<string, any> => ({})),
      getJson(`https://api.linkedin.com/rest/posts?q=author&author=${encodeURIComponent(urn)}&count=20&sortBy=CREATED`, rest).catch(() => ({ elements: [] })),
    ])
    const dates = ((posts.elements ?? []) as { publishedAt?: number; createdAt?: number }[])
      .map(p => p.publishedAt ?? p.createdAt).filter((t): t is number => typeof t === 'number').map(t => new Date(t).toISOString())
    return {
      ...out,
      followerCount: typeof size.firstDegreeSize === 'number' ? size.firstDegreeSize : null,
      bio: org.localizedDescription ?? null,
      websiteInBio: org.localizedWebsite ? true : null,
      lastPostDate: newest(dates),
      postsPerWeek: postsPerWeek(dates),
    }
  } catch (e) {
    return { ...out, fetchError: (e as Error).message }
  }
}

async function youtubeMetrics(apiKey: string, channelId: string): Promise<PlatformMetrics> {
  const out = emptyMetrics('YouTube API key')
  try {
    const [ch, search] = await Promise.all([
      getJson(`https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${encodeURIComponent(channelId)}&key=${apiKey}`),
      getJson(`https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(channelId)}&type=video&order=date&maxResults=10&key=${apiKey}`).catch(() => ({ items: [] })),
    ])
    const item = ch.items?.[0]
    if (!item) return { ...out, fetchError: 'Channel not found' }
    const dates = ((search.items ?? []) as { snippet: { publishedAt: string } }[]).map(v => v.snippet.publishedAt)
    return {
      ...out,
      followerCount: item.statistics?.subscriberCount ? Number(item.statistics.subscriberCount) : null,
      postCount: item.statistics?.videoCount ? Number(item.statistics.videoCount) : null,
      bio: item.snippet?.description || null,
      lastPostDate: newest(dates),
      postsPerWeek: postsPerWeek(dates),
    }
  } catch (e) {
    return { ...out, fetchError: (e as Error).message }
  }
}

async function twitterMetrics(bearer: string, username: string): Promise<PlatformMetrics> {
  const out = emptyMetrics('X API token')
  try {
    const body = await getJson(`https://api.twitter.com/2/users/by/username/${encodeURIComponent(username)}?user.fields=public_metrics,description,url`, { Authorization: `Bearer ${bearer}` })
    const d = body.data
    if (!d) return { ...out, fetchError: 'Account not found' }
    return { ...out, followerCount: d.public_metrics?.followers_count ?? null, postCount: d.public_metrics?.tweet_count ?? null, bio: d.description ?? null, websiteInBio: !!d.url }
  } catch (e) {
    return { ...out, fetchError: (e as Error).message }
  }
}

async function tiktokMetrics(token: string): Promise<PlatformMetrics> {
  const out = emptyMetrics('TikTok token')
  try {
    const body = await getJson('https://open.tiktokapis.com/v2/user/info/?fields=follower_count,video_count,bio_description', { Authorization: `Bearer ${token}` })
    const u = body.data?.user
    if (!u) return { ...out, fetchError: 'Account not found' }
    return { ...out, followerCount: u.follower_count ?? null, postCount: u.video_count ?? null, bio: u.bio_description ?? null }
  } catch (e) {
    return { ...out, fetchError: (e as Error).message }
  }
}

/** Metrics for each platform with a connected account (one-click connections first, then tokens). */
async function connectedMetrics(by: Map<string, Integration>): Promise<Partial<Record<SocialProvider, Promise<PlatformMetrics>>>> {
  const out: Partial<Record<SocialProvider, Promise<PlatformMetrics>>> = {}
  const metaConn = by.get('meta_oauth')
  const igConn = by.get('instagram_oauth')

  if (igConn && metaOf(igConn).instagram_id) out.instagram = instagramMetrics(igConn, false)
  else if (metaConn && metaOf(metaConn).instagram_id) out.instagram = instagramMetrics(metaConn, true)
  else if (by.get('instagram')) out.instagram = instagramManual(by.get('instagram')!)

  if (metaConn && metaOf(metaConn).page_id) out.facebook = facebookMetrics(metaOf(metaConn).page_id, metaOf(metaConn).page_access_token || metaConn.accessToken || '', 'Facebook page (via Meta)')
  else if (by.get('facebook')?.accessToken && metaOf(by.get('facebook')).page_id) out.facebook = facebookMetrics(metaOf(by.get('facebook')).page_id, by.get('facebook')!.accessToken!, 'Facebook (token)')

  const li = by.get('linkedin_oauth')?.accessToken ? by.get('linkedin_oauth') : by.get('linkedin')
  const liOrg = metaOf(by.get('linkedin_oauth')).org_id || metaOf(by.get('linkedin')).organization_id
  if (li?.accessToken && liOrg) out.linkedin = linkedinMetrics(li.accessToken, liOrg, li.provider === 'linkedin_oauth' ? 'LinkedIn (one-click)' : 'LinkedIn (token)')
  else if (li) out.linkedin = Promise.resolve({ ...emptyMetrics('LinkedIn'), fetchError: 'No company page found on the LinkedIn connection — reconnect with a page admin account.' })

  const yt = by.get('youtube')
  if (yt?.apiKey && metaOf(yt).channel_id) out.youtube = youtubeMetrics(yt.apiKey, metaOf(yt).channel_id)
  const tw = by.get('twitter')
  if (tw?.apiKey && metaOf(tw).twitter_username) out.twitter = twitterMetrics(tw.apiKey, metaOf(tw).twitter_username.replace(/^@/, ''))
  const tt = by.get('tiktok')
  if (tt?.accessToken) out.tiktok = tiktokMetrics(tt.accessToken)
  return out
}

/** Handles a connected account tells us (for a profile link when none was given). */
function connectedProfileUrl(platform: SocialProvider, by: Map<string, Integration>): string | null {
  const ig = metaOf(by.get('instagram_oauth')).instagram_username || metaOf(by.get('meta_oauth')).instagram_username
  if (platform === 'instagram' && ig) return `https://www.instagram.com/${ig}`
  const tw = metaOf(by.get('twitter')).twitter_username
  if (platform === 'twitter' && tw) return `https://x.com/${tw.replace(/^@/, '')}`
  return null
}

// ── Profile page check ────────────────────────────────────────────────────────

async function checkProfile(url: string, platform: SocialProvider) {
  const { status, html } = await fetchText(url)
  const link: SocialPlatformData['link'] = status === 404 || status === 410 ? 'broken' : status === 200 ? 'ok' : 'unknown'
  const $ = html ? cheerio.load(html) : null
  const publicTitle = $ ? ($('meta[property="og:title"]').attr('content') ?? $('title').first().text()).trim() || null : null

  // YouTube: newest video date from the channel's public feed
  let publicLastPostDate: string | null = null
  if (platform === 'youtube' && html) {
    const channelId = /channel_id=(UC[\w-]{20,})/.exec(html)?.[1] ?? /"(?:channelId|externalId)":"(UC[\w-]{20,})"/.exec(html)?.[1]
    if (channelId) {
      const feed = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`)
      publicLastPostDate = newest([...feed.html.matchAll(/<published>([^<]+)<\/published>/g)].slice(1).map((m) => m[1]))
    }
  }
  return { link, linkStatus: status, publicTitle, publicLastPostDate }
}

// ── Main fetcher ──────────────────────────────────────────────────────────────

export async function fetchSocialMediaData(requirements: Record<string, string>): Promise<SocialMediaFetchResult> {
  const websiteUrl = requirements['website_url'] ?? ''
  const brandId = requirements['brand_id'] ?? ''

  const integrations = brandId
    ? await db.select().from(brandIntegrations).where(and(eq(brandIntegrations.brandId, brandId), eq(brandIntegrations.status, 'connected')))
    : []
  const by = new Map(integrations.map((i) => [i.provider, i]))
  const saved = metaOf(by.get('social_profiles'))

  // Homepage → profile links (header, footer, anywhere on the page)
  const pageUrl = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`
  const home = websiteUrl ? await fetchText(pageUrl, 12000) : { status: null, html: '', block: null }
  const socialLinksOnWebsite = home.html ? profileLinksIn(home.html, pageUrl) : []
  const homepageIsJsShell = home.html ? isJsShell(cheerio.load(home.html)) : false
  const metricsBy = await connectedMetrics(by)

  const platforms = await Promise.all(SOCIAL_PLATFORMS.map(async (platform): Promise<SocialPlatformData> => {
    const fromSetup = requirements[`${platform}_url`] || saved[`${platform}_url`] || ''
    const fromSite = socialLinksOnWebsite.find(l => l.platform === platform)?.url ?? ''
    const fromConn = connectedProfileUrl(platform, by) ?? ''
    const raw = fromSetup || fromSite || fromConn
    const parsed = raw ? parseProfileUrl(raw) : null
    const profileUrl = parsed?.url ?? (raw || null)
    const check = profileUrl ? await checkProfile(profileUrl, platform) : null
    return {
      platform,
      profileUrl,
      source: fromSetup ? 'setup' : fromSite ? 'website' : fromConn ? 'connected' : null,
      onWebsite: !!fromSite,
      handle: parsed?.handle ?? null,
      link: check?.link ?? null,
      linkStatus: check?.linkStatus ?? null,
      publicTitle: check?.publicTitle ?? null,
      publicLastPostDate: check?.publicLastPostDate ?? null,
      metrics: metricsBy[platform] ? await metricsBy[platform]! : null,
    }
  }))

  return {
    websiteUrl,
    brandName: requirements['brand_name'] || '',
    industry: requirements['industry'] || null,
    targetAudience: requirements['target_audience'] || null,
    homepageLoaded: !!home.html,
    homepageIsJsShell,
    homepageBlocked: home.block,
    socialLinksOnWebsite,
    platforms,
  }
}
