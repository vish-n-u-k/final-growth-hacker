import { ApifyError, num, runActor, str } from './apify'
import type { EngagementPlatform, EngagementProfile } from './types'

// The three places buyers can be found, each one Apify call (capped): Reddit threads asking for
// help, Instagram posts under the tags buyers use, and the people commenting on a competitor's
// newest posts. What comes back is only a candidate: the filter in engine.ts decides who is kept.

export interface Candidate {
  key: string                        // the same person or thread found twice has the same key
  platform: EngagementPlatform
  source: 'reddit' | 'hashtag' | 'competitor'
  handle: string                     // @account, or the thread title for Reddit
  title: string | null
  url: string
  profileUrl: string | null
  community: string | null           // subreddit, tag or competitor it came from
  text: string
  engagement: number | null
  postedAt: string | null
}

export interface Collected { candidates: Candidate[]; cost: number; note?: string }

const cut = (s: string | null, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const igProfile = (h: string) => `https://www.instagram.com/${h}/`
const iso = (v: unknown): string | null => {
  if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v).toISOString()
  if (typeof v === 'string' && v.trim()) { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null }
  return null
}
// "Apify has no credit" and "not switched on" are the developer's problem, said once and plainly
const failNote = (what: string, e: unknown) =>
  e instanceof ApifyError && (e.status === 402 || e.status === 403)
    ? `${what} could not run: the search service has no credit left this month.`
    : `${what} did not work this time.`

// ── Reddit threads ────────────────────────────────────────────────────────────
// Searches are scoped to subreddits: a search of all of Reddit ignores the words when sorted by newest.
export async function collectReddit(p: EngagementProfile): Promise<Collected> {
  const subs = p.subreddits.slice(0, 3)
  const phrases = p.phrases.slice(0, 2)
  if (!subs.length || !phrases.length) return { candidates: [], cost: 0 }
  const startUrls = subs.flatMap(s => phrases.map(q => ({ url: `https://www.reddit.com/r/${encodeURIComponent(s)}/search/?q=${encodeURIComponent(q)}&restrict_sr=1&sort=new&t=month` })))
  try {
    const rows = await runActor('harshmaur/reddit-scraper', { startUrls, maxPostsCount: 10, crawlCommentsPerPost: false, includeNSFW: false }, { maxItems: 60, capUsd: 0.25, timeoutSec: 150 })
    const out: Candidate[] = []
    for (const r of rows) {
      const url = str(r, 'postUrl', 'url')
      const title = str(r, 'title')
      if (!url || !title || !/reddit\.com\/r\//i.test(url)) continue
      out.push({
        key: `reddit:${url}`, platform: 'reddit', source: 'reddit',
        handle: cut(title, 140), title: cut(title, 140), url, profileUrl: null,
        community: str(r, 'communityName', 'subreddit'), text: cut(str(r, 'body', 'text', 'selftext'), 400),
        engagement: num(r, 'commentsCount', 'numComments'), postedAt: iso(r.createdAt ?? r.created ?? r.createdUtc),
      })
    }
    return { candidates: out, cost: rows.length * 0.002 + 0.02 }
  } catch (e) {
    return { candidates: [], cost: 0, note: failNote('The Reddit search', e) }
  }
}

// ── Instagram hashtags ────────────────────────────────────────────────────────
// A free plan returns only the newest page: good for fresh posts with few comments.
export async function collectHashtags(p: EngagementProfile): Promise<Collected> {
  const tags = p.hashtags.slice(0, 4)
  if (!tags.length) return { candidates: [], cost: 0 }
  try {
    const rows = await runActor('apify/instagram-hashtag-scraper', { hashtags: tags, resultsType: 'posts', resultsLimit: 15 }, { maxItems: 60, capUsd: 0.25, timeoutSec: 150 })
    const out: Candidate[] = []
    for (const r of rows) {
      const owner = str(r, 'ownerUsername')?.toLowerCase()
      const url = str(r, 'url')
      if (!owner || !url) continue
      out.push({
        key: `ig:${owner}`, platform: 'instagram', source: 'hashtag',
        handle: `@${owner}`, title: null, url, profileUrl: igProfile(owner),
        community: (Array.isArray(r.hashtags) && typeof r.hashtags[0] === 'string' ? `#${r.hashtags[0]}` : null),
        text: cut(str(r, 'caption'), 300), engagement: num(r, 'commentsCount', 'likesCount'), postedAt: iso(r.timestamp),
      })
    }
    return { candidates: out, cost: rows.length * 0.0026 }
  } catch (e) {
    return { candidates: [], cost: 0, note: failNote('The Instagram tag search', e) }
  }
}

// ── Competitor commenters ─────────────────────────────────────────────────────
// The warmest leads: people who comment on a competitor's newest posts already care about the category.
export async function collectCompetitorCommenters(p: EngagementProfile): Promise<Collected> {
  const rivals = p.competitors.slice(0, 2)
  if (!rivals.length) return { candidates: [], cost: 0 }
  try {
    const profiles = await runActor('apify/instagram-profile-scraper', { usernames: rivals }, { maxItems: rivals.length, capUsd: 0.1, timeoutSec: 90 })
    const posts: { url: string; rival: string }[] = []
    for (const pr of profiles) {
      const rival = str(pr, 'username')?.toLowerCase() ?? ''
      const latest = Array.isArray(pr.latestPosts) ? pr.latestPosts as Record<string, unknown>[] : []
      for (const post of latest.slice(0, 2)) {
        const url = str(post, 'url')
        if (url) posts.push({ url, rival })
      }
    }
    const cost = profiles.length * 0.0026
    if (!posts.length) return { candidates: [], cost, note: 'No recent competitor posts could be read.' }

    const rows = await runActor('apify/instagram-comment-scraper', { directUrls: posts.map(x => x.url), resultsLimit: 15 }, { maxItems: 60, capUsd: 0.2, timeoutSec: 150 })
    const out: Candidate[] = []
    for (const r of rows) {
      const owner = str(r, 'ownerUsername')?.toLowerCase()
      const text = cut(str(r, 'text'), 300)
      if (!owner || !text || rivals.includes(owner)) continue
      const url = str(r, 'postUrl', 'inputUrl', 'url') ?? posts[0].url
      out.push({
        key: `ig:${owner}`, platform: 'instagram', source: 'competitor',
        handle: `@${owner}`, title: null, url, profileUrl: igProfile(owner),
        community: `@${posts.find(x => url.includes(x.url.split('/p/')[1]?.split('/')[0] ?? '~'))?.rival ?? rivals[0]}`,
        text, engagement: num(r, 'likesCount'), postedAt: iso(r.timestamp),
      })
    }
    return { candidates: out, cost: cost + rows.length * 0.0026 }
  } catch (e) {
    return { candidates: [], cost: 0, note: failNote('The competitor comments search', e) }
  }
}
