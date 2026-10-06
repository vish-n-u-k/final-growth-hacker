// ── Activity checks (blog + social) ──────────────────────────────────────────
// Looks at the REAL website and REAL social accounts — not just what was made
// inside GrowJin — so the diagnosis never says "no blogs" / "nothing posted"
// when the user is actually active. Results are cached as snapshots and
// refreshed at most once a day (see getActivity).
//
// When nothing can be checked (no sitemap/RSS, no connected accounts) the
// result says so (canSee: false) instead of pretending there's no activity.

import { db } from '@/lib/db'
import { brandBlogs, brandIntegrations, frektoScheduledPosts } from '@/lib/db/schema'
import { and, desc, eq, ne } from 'drizzle-orm'
import { getSnapshot, saveSnapshot } from '@/lib/signals'

export interface BlogActivity {
  canSee: boolean                  // found a sitemap or RSS feed (or GrowJin blogs)
  source: 'rss' | 'sitemap' | 'growjin' | null
  postCount: number                // blog-like URLs / feed items found
  lastPublishedAt: string | null   // newest post date we could find
  checkedAt: string
}

export interface SocialActivity {
  canSee: boolean                  // at least one account answered
  platforms: { platform: string; lastPostAt: string | null; error?: string }[]
  lastPostAt: string | null        // newest post across all platforms
  lastPlatform: string | null
  unreadable: string[]             // accounts the brand has (profile link) that GrowJin can't read
  checkedAt: string
}

const MAX_AGE_MS = 20 * 3600000
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; GrowJinBot/1.0)' }

// Paths that usually hold articles, e.g. /blog/my-post, /resources/guide-to-x
const BLOG_PATH = /\/(blog|blogs|articles?|posts?|news|insights|resources|guides?|learn|stories|journal)\/[^/?#]+/i

async function fetchText(url: string, ms = 8000): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms), redirect: 'follow' })
    if (!res.ok) return null
    return await res.text()
  } catch { return null }
}

function newest(dates: (string | null | undefined)[]): string | null {
  let best: number | null = null
  for (const d of dates) {
    const t = d ? Date.parse(d) : NaN
    if (!isNaN(t) && t <= Date.now() + 864e5 && (best === null || t > best)) best = t
  }
  return best === null ? null : new Date(best).toISOString()
}

// ── Blog ─────────────────────────────────────────────────────────────────────

// RSS/Atom: item dates are real publish dates, so prefer them over sitemap lastmod
async function checkFeed(origin: string, homepage: string | null) {
  const candidates = new Set<string>()
  const linkRe = /<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/gi
  for (const tag of homepage?.match(linkRe) ?? []) {
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1]
    if (href) { try { candidates.add(new URL(href, origin).toString()) } catch { /* skip */ } }
  }
  for (const p of ['/feed', '/rss.xml', '/feed.xml', '/blog/rss.xml', '/blog/feed', '/atom.xml']) candidates.add(origin + p)

  for (const url of [...candidates].slice(0, 6)) {
    const xml = await fetchText(url, 6000)
    if (!xml || !/<(rss|feed)[\s>]/i.test(xml)) continue
    const items = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? []
    const dates = items.map((i) => /<(pubDate|published|updated|dc:date)>([^<]+)</i.exec(i)?.[2]?.trim())
    return { postCount: items.length, lastPublishedAt: newest(dates) }
  }
  return null
}

async function checkSitemap(origin: string, robots: string | null) {
  const roots = new Set<string>()
  for (const m of robots?.matchAll(/^sitemap:\s*(\S+)/gim) ?? []) roots.add(m[1])
  roots.add(`${origin}/sitemap.xml`)
  roots.add(`${origin}/sitemap_index.xml`)

  for (const root of roots) {
    const xml = await fetchText(root)
    if (!xml || !/<(urlset|sitemapindex)/i.test(xml)) continue

    // Sitemap index → only child sitemaps that look blog-related (or all, if none do), max 5
    let docs = [xml]
    if (/<sitemapindex/i.test(xml)) {
      const children = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&')).filter((u) => !u.endsWith('.gz'))
      const blogChildren = children.filter((u) => /blog|post|article|news/i.test(u))
      docs = (await Promise.all((blogChildren.length ? blogChildren : children).slice(0, 5).map((u) => fetchText(u)))).filter((d): d is string => !!d)
    }

    const entries: { loc: string; lastmod: string | null }[] = []
    for (const doc of docs) {
      for (const block of doc.match(/<url>[\s\S]*?<\/url>/gi) ?? []) {
        const loc = /<loc>\s*([^<\s]+)\s*<\/loc>/i.exec(block)?.[1]
        if (loc) entries.push({ loc, lastmod: /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i.exec(block)?.[1] ?? null })
      }
    }
    const posts = entries.filter((e) => { try { return BLOG_PATH.test(new URL(e.loc).pathname) } catch { return false } })
    return { postCount: posts.length, lastPublishedAt: newest(posts.map((p) => p.lastmod)) }
  }
  return null
}

export async function checkBlogActivity(brandId: string, websiteUrl: string | null): Promise<BlogActivity> {
  const checkedAt = new Date().toISOString()
  const [lastGrowjin] = await db.select({ createdAt: brandBlogs.createdAt }).from(brandBlogs)
    .where(and(eq(brandBlogs.brandId, brandId), ne(brandBlogs.status, 'replaced')))
    .orderBy(desc(brandBlogs.createdAt)).limit(1)
  const growjinAt = lastGrowjin?.createdAt ? new Date(lastGrowjin.createdAt).toISOString() : null

  let origin: string | null = null
  try { origin = websiteUrl ? new URL(websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`).origin : null } catch { /* invalid */ }

  if (origin) {
    const [homepage, robots] = await Promise.all([fetchText(origin), fetchText(`${origin}/robots.txt`, 5000)])
    const feed = await checkFeed(origin, homepage)
    if (feed && feed.postCount > 0) {
      return { canSee: true, source: 'rss', postCount: feed.postCount, lastPublishedAt: newest([feed.lastPublishedAt, growjinAt]), checkedAt }
    }
    // A sitemap with no blog-like URLs proves nothing (posts may live at the root), so it doesn't count
    const sitemap = await checkSitemap(origin, robots)
    if (sitemap && sitemap.postCount > 0) {
      return { canSee: true, source: 'sitemap', postCount: sitemap.postCount, lastPublishedAt: newest([sitemap.lastPublishedAt, growjinAt]), checkedAt }
    }
  }
  if (growjinAt) return { canSee: true, source: 'growjin', postCount: 1, lastPublishedAt: growjinAt, checkedAt }
  return { canSee: false, source: null, postCount: 0, lastPublishedAt: null, checkedAt }
}

// ── Social ───────────────────────────────────────────────────────────────────

type Check = { platform: string; run: () => Promise<string | null> } // resolves to newest post date

async function getJson(url: string, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok || body.error) {
    const msg = (body.error as { message?: string } | undefined)?.message ?? (body.message as string | undefined) ?? `HTTP ${res.status}`
    throw new Error(msg)
  }
  return body
}

const firstOf = (body: Record<string, unknown>, key: string, field: string): string | null => {
  const list = body[key] as Record<string, unknown>[] | undefined
  const v = list?.[0]?.[field]
  return typeof v === 'number' ? new Date(v).toISOString() : (typeof v === 'string' ? v : null)
}

export async function checkSocialActivity(brandId: string): Promise<SocialActivity> {
  const integrations = await db.select().from(brandIntegrations)
    .where(and(eq(brandIntegrations.brandId, brandId), eq(brandIntegrations.status, 'connected')))
  const byProvider = new Map(integrations.map((i) => [i.provider, i]))
  const meta = (p: string) => (byProvider.get(p)?.metadata as Record<string, string> | null) ?? {}
  const checks: Check[] = []

  // Instagram — OAuth (via Facebook page) or direct API connection
  const igOauth = byProvider.get('instagram_oauth') ?? byProvider.get('meta_oauth')
  const igMeta = (igOauth?.metadata as Record<string, string> | null) ?? {}
  if (igOauth && igMeta.instagram_id) {
    const token = igMeta.page_access_token || igOauth.accessToken || ''
    checks.push({ platform: 'instagram', run: async () => firstOf(await getJson(`https://graph.facebook.com/v21.0/${igMeta.instagram_id}/media?fields=timestamp&limit=1&access_token=${encodeURIComponent(token)}`), 'data', 'timestamp') })
  } else if (byProvider.get('instagram')?.accessToken && meta('instagram').instagram_account_id) {
    const token = byProvider.get('instagram')!.accessToken!
    checks.push({ platform: 'instagram', run: async () => firstOf(await getJson(`https://graph.instagram.com/v18.0/${meta('instagram').instagram_account_id}/media?fields=timestamp&limit=1&access_token=${encodeURIComponent(token)}`), 'data', 'timestamp') })
  }

  // Facebook page
  const fb = byProvider.get('meta_oauth') ?? byProvider.get('facebook')
  const fbMeta = (fb?.metadata as Record<string, string> | null) ?? {}
  if (fb && fbMeta.page_id) {
    const token = fbMeta.page_access_token || fb.accessToken || ''
    checks.push({ platform: 'facebook', run: async () => firstOf(await getJson(`https://graph.facebook.com/v21.0/${fbMeta.page_id}/posts?fields=created_time&limit=1&access_token=${encodeURIComponent(token)}`), 'data', 'created_time') })
  }

  // LinkedIn organization page — OAuth connection or token + organization ID
  const li = byProvider.get('linkedin_oauth')?.accessToken ? byProvider.get('linkedin_oauth') : byProvider.get('linkedin')
  const liOrg = meta('linkedin_oauth').org_id || meta('linkedin').organization_id
  if (li?.accessToken && liOrg) {
    const urn = liOrg.startsWith('urn:') ? liOrg : `urn:li:organization:${liOrg}`
    checks.push({
      platform: 'linkedin',
      run: async () => firstOf(await getJson(`https://api.linkedin.com/rest/posts?q=author&author=${encodeURIComponent(urn)}&count=1&sortBy=CREATED`, {
        Authorization: `Bearer ${li.accessToken}`, 'LinkedIn-Version': '202401', 'X-Restli-Protocol-Version': '2.0.0',
      }), 'elements', 'publishedAt'),
    })
  }

  // YouTube channel — API key if set, otherwise the channel's public RSS feed (works from just a URL)
  const yt = byProvider.get('youtube')
  const ytUrl = meta('youtube').url || meta('social_profiles').youtube_url
  if (yt?.apiKey && meta('youtube').channel_id) {
    checks.push({ platform: 'youtube', run: async () => {
      const body = await getJson(`https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(meta('youtube').channel_id)}&type=video&order=date&maxResults=1&key=${yt.apiKey}`)
      const item = (body.items as { snippet?: { publishedAt?: string } }[] | undefined)?.[0]
      return item?.snippet?.publishedAt ?? null
    } })
  } else if (ytUrl) {
    checks.push({ platform: 'youtube', run: async () => {
      const page = await fetchText(ytUrl.startsWith('http') ? ytUrl : `https://${ytUrl}`)
      const channelId = page && (/channel_id=(UC[\w-]{20,})/.exec(page)?.[1] ?? /"(?:channelId|externalId)":"(UC[\w-]{20,})"/.exec(page)?.[1])
      if (!channelId) throw new Error('Could not find YouTube channel ID')
      const feed = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`)
      if (!feed) throw new Error('YouTube feed unavailable')
      return newest([...feed.matchAll(/<published>([^<]+)<\/published>/g)].slice(1).map((m) => m[1])) // [0] is the channel itself
    } })
  }

  // Pinterest
  const pin = byProvider.get('pinterest_oauth')
  if (pin?.accessToken) {
    checks.push({ platform: 'pinterest', run: async () => firstOf(await getJson('https://api.pinterest.com/v5/pins?page_size=1', { Authorization: `Bearer ${pin.accessToken}` }), 'items', 'created_at') })
  }

  // Posts published through GrowJin's Frekto integration
  checks.push({ platform: 'growjin', run: async () => {
    const [row] = await db.select({ scheduledAt: frektoScheduledPosts.scheduledAt }).from(frektoScheduledPosts)
      .where(and(eq(frektoScheduledPosts.brandId, brandId), eq(frektoScheduledPosts.status, 'done')))
      .orderBy(desc(frektoScheduledPosts.scheduledAt)).limit(1)
    return row ? new Date(row.scheduledAt).toISOString() : null
  } })

  const settled = await Promise.allSettled(checks.map((c) => c.run()))
  const platforms = checks.map((c, i) => {
    const r = settled[i]
    return r.status === 'fulfilled'
      ? { platform: c.platform, lastPostAt: r.value }
      : { platform: c.platform, lastPostAt: null, error: String((r.reason as Error)?.message ?? r.reason).slice(0, 200) }
  })

  // GrowJin's own table only proves activity when it has a post; on its own it can't prove inactivity
  const realAccounts = platforms.filter((p) => p.platform !== 'growjin' && !p.error)
  const growjin = platforms.find((p) => p.platform === 'growjin')
  const canSee = realAccounts.length > 0 || !!growjin?.lastPostAt

  const visible = platforms.filter((p) => p.lastPostAt)
  const lastPostAt = newest(visible.map((p) => p.lastPostAt))
  const lastPlatform = visible.find((p) => p.lastPostAt && Date.parse(p.lastPostAt) === Date.parse(lastPostAt ?? ''))?.platform ?? null

  // Accounts listed by profile URL only (no API access) — their posts are invisible to us
  const listed = new Set<string>()
  for (const name of ['instagram', 'facebook', 'linkedin', 'youtube', 'twitter', 'tiktok']) {
    if (meta(name).url || meta('social_profiles')[`${name}_url`]) listed.add(name)
  }
  const readable = new Set(realAccounts.map((p) => p.platform))
  const unreadable = [...listed].filter((n) => !readable.has(n))

  return { canSee, platforms, lastPostAt, lastPlatform, unreadable, checkedAt: new Date().toISOString() }
}

// ── Cached access (period check: at most once per ~day per brand) ────────────

export async function getActivity(brandId: string, websiteUrl: string | null): Promise<{ blog: BlogActivity; social: SocialActivity }> {
  const fresh = (s: { checkedAt: string } | null) => !!s && Date.now() - Date.parse(s.checkedAt) < MAX_AGE_MS
  const [cachedBlog, cachedSocial] = await Promise.all([
    getSnapshot<BlogActivity>(brandId, 'blog-activity').catch(() => null),
    getSnapshot<SocialActivity>(brandId, 'social-activity').catch(() => null),
  ])

  const [blog, social] = await Promise.all([
    fresh(cachedBlog) ? cachedBlog! : checkBlogActivity(brandId, websiteUrl),
    fresh(cachedSocial) ? cachedSocial! : checkSocialActivity(brandId),
  ])
  if (!fresh(cachedBlog)) await saveSnapshot(brandId, 'blog-activity', blog).catch(() => {})
  if (!fresh(cachedSocial)) await saveSnapshot(brandId, 'social-activity', social).catch(() => {})
  return { blog, social }
}
