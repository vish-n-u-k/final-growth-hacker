// "Why am I not on Google?", the smart part: for each sitemap page that hasn't shown up in a search,
// what Google itself says about it (URL Inspection), how old it is (the sitemap's lastmod), how new
// the whole site is (the first day it showed up in Search Console), and whether the owner already
// asked Google to index it (tracked here, from the "Done, I asked Google" button).
//
// URL Inspection allows 2,000 a day per site, so each fill inspects at most INSPECT_PER_FILL pages
// and keeps answers for INSPECT_KEEP_MS. Pages the owner asked about are checked first.

import { getSnapshot, saveSnapshot } from '@/lib/signals'
import { agentsDemo } from '@/lib/agents/demo'
import { getGscAccessToken, searchAnalytics } from '@/lib/modules/seo/keyword-fetchers'
import { gscFetch, inspect, listSitemaps, pickProperty } from '@/lib/modules/seo/gsc-indexing'
import type { IndexRow } from './types'
import { norm } from './urls'

const CACHE = 'ask:index'
const ASKS = 'ask:index-asks'
const k = (base: string) => (agentsDemo() ? `${base}:demo` : base)
const DAY = 86_400_000
const INSPECT_PER_FILL = 20
const INSPECT_KEEP_MS = 3 * DAY
const FIRST_SEEN_KEEP_MS = 7 * DAY
/** A page this new hasn't had a fair chance yet. */
export const NEW_PAGE_DAYS = 14
/** A site Google first showed this recently is still being picked up. */
export const NEW_SITE_DAYS = 90
/** After asking Google, give it this long before calling it stuck. */
export const ASK_WAIT_DAYS = 21

export interface Inspected { verdict: 'pass' | 'other'; coverage: string; indexing: string; robots: string; crawled: string; googleCanonical: string; userCanonical: string; at: string }
export interface IndexInfo {
  property: string | null
  firstSeen: string | null          // first day with any impression, as far back as Search Console keeps (16 months)
  firstSeenAt?: string
  oldest?: boolean                  // firstSeen is the oldest day Search Console keeps: the site is older than that
  sitemaps: { path: string; submitted: string; downloaded: string; pending: boolean; errors: number }[] | null
  pages: Record<string, Inspected>  // by norm(url)
}
export type Asks = Record<string, { at: string }>   // by norm(url)

const iso = (d: number) => new Date(Date.now() - d * DAY).toISOString().slice(0, 10)
const days = (from: string | null | undefined, now: number) => (from ? Math.floor((now - Date.parse(from)) / DAY) : null)

export async function readAsks(brandId: string): Promise<Asks> {
  return (await getSnapshot<Asks>(brandId, k(ASKS))) ?? {}
}

/** "Done, I asked Google" (asked: true) or Undo (asked: false). */
export async function markAsked(brandId: string, url: string, asked: boolean): Promise<Asks> {
  const asks = await readAsks(brandId)
  const id = norm(url)
  if (asked) asks[id] = { at: new Date().toISOString() }
  else delete asks[id]
  await saveSnapshot(brandId, k(ASKS), asks)
  return asks
}

/** What Google says about the pages that haven't shown up (cached), plus the site's first day on Google. */
export async function indexInfo(brandId: string, key: { client_email: string; private_key: string }, websiteUrl: string, notShown: string[], lastmod: Record<string, string | null>, asks: Asks): Promise<IndexInfo | null> {
  const saved = await getSnapshot<IndexInfo>(brandId, k(CACHE))
  let token: string
  try { token = await getGscAccessToken(key.client_email, key.private_key) } catch { return saved }
  const url = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`
  const now = Date.now()

  const property = saved?.property ?? await gscFetch<{ siteEntry?: { siteUrl: string; permissionLevel: string }[] }>(token, 'https://www.googleapis.com/webmasters/v3/sites')
    .then(d => pickProperty(d.siteEntry ?? [], url.endsWith('/') ? url : `${url}/`)).catch(() => null)

  // The first day the site showed up in a search (weekly)
  let { firstSeen = null, firstSeenAt, oldest } = saved ?? {}
  if (!firstSeenAt || now - Date.parse(firstSeenAt) > FIRST_SEEN_KEEP_MS) {
    const start = iso(480)
    const { rows } = await searchAnalytics(key.client_email, key.private_key, websiteUrl, { startDate: start, endDate: iso(0), dimensions: ['date'], rowLimit: 500 })
      .catch(() => ({ rows: null }))
    const dates = (rows ?? []).filter(r => r.impressions > 0).map(r => r.keys[0]).sort()
    firstSeen = dates[0] ?? null
    oldest = !!firstSeen && Date.parse(firstSeen) - Date.parse(start) < 4 * DAY
    firstSeenAt = new Date().toISOString()
  }

  // Inspect: pages asked about first (to see if they're in yet), then the shallowest, newest pages
  const pages: Record<string, Inspected> = {}
  const keep = new Set(notShown.map(norm))
  for (const [u, p] of Object.entries(saved?.pages ?? {})) if (keep.has(u)) pages[u] = p
  const depth = (u: string) => { try { return new URL(u).pathname.split('/').filter(Boolean).length } catch { return 99 } }
  const due = notShown.filter(u => !pages[norm(u)] || now - Date.parse(pages[norm(u)].at) > INSPECT_KEEP_MS)
    .sort((a, b) => Number(!!asks[norm(b)]) - Number(!!asks[norm(a)]) || depth(a) - depth(b) || (Date.parse(lastmod[b] ?? '') || 0) - (Date.parse(lastmod[a] ?? '') || 0))
    .slice(0, property ? INSPECT_PER_FILL : 0)
  for (let i = 0; i < due.length; i += 4) {
    const got = await Promise.all(due.slice(i, i + 4).map(u => inspect(token, property!, u)))
    got.forEach((r, j) => {
      if (r) pages[norm(due[i + j])] = { verdict: r.indexed ? 'pass' : 'other', coverage: r.coverageState, indexing: r.indexingState, robots: r.robotsTxtState, crawled: r.lastCrawlTime, googleCanonical: r.googleCanonical, userCanonical: r.userCanonical, at: new Date().toISOString() }
    })
  }

  const sitemaps = property
    ? await listSitemaps(token, property).then(s => s?.map(m => ({ path: m.path, submitted: m.lastSubmitted, downloaded: m.lastDownloaded, pending: m.isPending, errors: m.errors })) ?? null)
    : null
  const out: IndexInfo = { property, firstSeen, firstSeenAt, oldest, sitemaps: sitemaps ?? saved?.sitemaps ?? null, pages }
  await saveSnapshot(brandId, k(CACHE), out)
  return out
}

// ── Sorting the pages (pure, so the preview can run it) ──────────────────────

const short = (t: string) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const dayWord = (n: number) => (n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`)

/** Google's reason a page is left out, in plain words; null when asking Google to index it is the fix. */
function blockedWhy(p: Inspected): string | null {
  const c = p.coverage.toLowerCase()
  if (/noindex/.test(c) || /BLOCKED_BY_META|BLOCKED_BY_HTTP/.test(p.indexing)) return 'Has a noindex tag, so Google won’t list it. Remove the tag if you want it on Google.'
  if (/robots/.test(c) || p.robots === 'DISALLOWED') return 'Your robots.txt tells Google not to read it.'
  if (/redirect/.test(c)) return 'It redirects to another page. Take it out of your sitemap and list the page it goes to.'
  if (/soft 404/.test(c)) return 'Google thinks it’s an empty or error page. Add real content or take it out of your sitemap.'
  if (/404|not found/.test(c)) return 'The page doesn’t exist any more. Take it out of your sitemap.'
  if (/server error|5xx/.test(c)) return 'Your server gave Google an error. Check the page loads.'
  if (/401|403|unauthorized|forbidden/.test(c)) return 'It needs a login, so Google can’t read it.'
  if (/canonical|duplicate|alternate/.test(c)) return `Google treats it as a copy of ${p.googleCanonical && p.googleCanonical !== p.userCanonical ? p.googleCanonical.replace(/^https?:\/\/[^/]+/, '') || 'your homepage' : 'another page'}. Make it clearly different, or point it at that page.`
  return null
}

export interface IndexSort {
  rows: IndexRow[]
  counts: Record<IndexRow['group'], number>
  siteDays: number | null           // days since the site first showed up; null when it never has (or unknown)
  newSite: boolean
  askedIn: number                   // pages the owner asked about that are on Google now
}

/** Sorts the pages that haven't shown up into what to do with each. */
export function sortPages({ notShown, shown, lastmod, info, asks, now = Date.now() }: {
  notShown: string[]; shown: Set<string>; lastmod: Record<string, string | null>; info: IndexInfo | null; asks: Asks; now?: number
}): IndexSort {
  const siteDays = info?.oldest ? null : days(info?.firstSeen, now)
  // No first day at all only counts as new when nothing has shown up (else the lookup just failed)
  const newSite = !info?.oldest && (siteDays == null ? !!info && !info.firstSeen && !shown.size : siteDays < NEW_SITE_DAYS)
  const rows: IndexRow[] = []
  for (const url of notShown) {
    const id = norm(url)
    const p = info?.pages[id]
    const age = days(lastmod[url] ?? lastmod[id], now)
    const asked = asks[id]?.at
    const askedDays = days(asked, now)
    const crawled = p?.crawled && !p.crawled.startsWith('1970') ? p.crawled : ''
    const path = (() => { try { return new URL(url).pathname || '/' } catch { return url } })()
    const row = (group: IndexRow['group'], note: string): IndexRow => ({ url, path, group, note, ...(asked ? { askedAt: asked } : {}) })
    const blocked = p && p.verdict !== 'pass' ? blockedWhy(p) : null

    if (p?.verdict === 'pass') { rows.push(row('indexed', `Google has it${asked ? ` (in since you asked on ${short(asked)})` : ''}. Nobody has searched words it answers yet: link to it, and make its title say what people search.`)); continue }
    if (blocked) { rows.push(row('blocked', blocked)); continue }
    const coverage = p?.coverage.toLowerCase() ?? ''
    const readAndSkipped = /crawled/.test(coverage)
    if (asked && askedDays! < ASK_WAIT_DAYS) { rows.push(row('wait', `You asked Google ${dayWord(askedDays!)}. It usually takes a few days to 2 weeks; we check every morning.`)); continue }
    if (asked) { rows.push(row('improve', `You asked on ${short(asked)} and it’s still not in. Google usually skips pages with little of their own text: add to it, link to it from a page that shows up, then ask again.`)); continue }
    if (age != null && age < NEW_PAGE_DAYS) { rows.push(row('wait', `Added ${dayWord(age)}. New pages usually take a few days to 2 weeks.`)); continue }
    if (readAndSkipped) { rows.push(row('improve', `Google read it${crawled ? ` on ${short(crawled)}` : ''} and left it out. Usually too little text, or too like another page. Add to it, then ask Google again.`)); continue }
    rows.push(row('todo',
      /discovered/.test(coverage) ? 'Google knows about it but hasn’t visited yet. Asking moves it up the queue.'
        : /unknown/.test(coverage) ? 'Google hasn’t found it yet. Ask Google, and link to it from a page that shows up.'
          : age != null ? `In your sitemap for ${age} days and not in a search yet.` : 'Not in a search yet.'))
  }
  const ORDER: IndexRow['group'][] = ['todo', 'improve', 'blocked', 'wait', 'indexed']
  const depth = (r: IndexRow) => r.path.split('/').filter(Boolean).length
  rows.sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group) || depth(a) - depth(b) || a.path.localeCompare(b.path))
  const counts = { todo: 0, improve: 0, blocked: 0, wait: 0, indexed: 0 }
  for (const r of rows) counts[r.group]++
  const askedIn = Object.keys(asks).filter(u => shown.has(u) || info?.pages[u]?.verdict === 'pass').length
  return { rows, counts, siteDays, newSite, askedIn }
}
