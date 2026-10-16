// ── Search signals (Google Search Console) ────────────────────────────────────
// Rule-based, no AI. Compares the last 28 days with the 28 days before and raises
// a signal per page / query that changed enough to act on:
//   page-decay:<path>     a page lost a big share of its Google clicks
//   low-ctr:<path>        a page ranks on page 1 but far fewer people click than usual
//   off-page-one:<query>  a query that ranked on page 1 slipped to page 2+
// Each signal says why now (the numbers), where (the page) and what to change.
// Signals clear on their own once the numbers recover. Runs from the daily-signals cron.

import { db } from '@/lib/db'
import { brandBlogs } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getGscAccessToken } from '@/lib/modules/seo/keyword-fetchers'
import { openSignal, clearSignals, getOpenSignals, saveSnapshot, type SignalInput } from '@/lib/signals'

const SOURCE = 'seo'
const PREFIXES = ['page-decay:', 'low-ctr:', 'off-page-one:']

const WINDOW_DAYS = 28
const GSC_LAG_DAYS = 3 // Search Console data for the last ~2 days is incomplete

// Page decay: enough clicks before to be meaningful, and most of them gone
const DECAY_MIN_PRIOR_CLICKS = 20
const DECAY_MAX_RATIO = 0.6 // current ≤ 60% of prior
const DECAY_MAX = 3

// Low CTR: seen a lot on page 1, clicked far less than pages at that position usually are
const LOW_CTR_MIN_IMPRESSIONS = 300
const LOW_CTR_MAX_POSITION = 8
const LOW_CTR_RATIO = 0.5
const LOW_CTR_MAX = 2
// Rough organic CTR by position (industry averages) — only used as a "far below" threshold
const EXPECTED_CTR = [0, 0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025]

// Off page one: was in the top 10, now isn't, and still searched
const OFF_PAGE_MIN_IMPRESSIONS = 50
const OFF_PAGE_MAX = 3

// A dismissed search signal stays quiet longer than the default week
const COOLDOWN_DAYS = 21

export type Row = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }

const day = (offset: number) => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10)

async function query(token: string, siteIds: string[], body: object): Promise<{ siteId: string; rows: Row[] } | null> {
  for (const siteId of siteIds) {
    try {
      const res = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${siteId}/searchAnalytics/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) continue
      return { siteId, rows: ((await res.json()) as { rows?: Row[] }).rows ?? [] }
    } catch { /* try the next property format */ }
  }
  return null
}

function pathOf(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname + u.search || '/'
  } catch { return url }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)
}

const pct = (n: number) => `${Math.round(n * 100)}%`
const fmt = (n: number) => Math.round(n).toLocaleString()

// Pure rules: two 28-day periods of Search Console rows in, signals out (unit-testable)
export function findSearchChanges(
  curPages: Row[],
  prevPages: Row[],
  curQueries: Row[],
  prevQueries: Row[],
  blogByPath: Map<string, string> = new Map(),
): SignalInput[] {
  const triggered: SignalInput[] = []
  const curByPage = new Map(curPages.map((r) => [r.keys[0], r]))

  // ── Page decay ─────────────────────────────────────────────────────────────
  const decays = prevPages
    .filter((p) => p.clicks >= DECAY_MIN_PRIOR_CLICKS)
    .map((p) => {
      const c = curByPage.get(p.keys[0])
      return { url: p.keys[0], prev: p, curClicks: c?.clicks ?? 0, curImpr: c?.impressions ?? 0, curPos: c?.position ?? null }
    })
    .filter((d) => d.curClicks <= d.prev.clicks * DECAY_MAX_RATIO)
    .sort((a, b) => (b.prev.clicks - b.curClicks) - (a.prev.clicks - a.curClicks))
    .slice(0, DECAY_MAX)

  for (const d of decays) {
    const path = pathOf(d.url)
    const blog = blogByPath.get(path)
    const imprRatio = d.prev.impressions > 0 ? d.curImpr / d.prev.impressions : 0
    // Impressions held up but clicks fell → the search snippet stopped winning clicks.
    // Impressions fell too → the page lost rankings or the topic lost demand.
    const snippetProblem = imprRatio >= 0.8
    const posNote = d.curPos !== null ? ` Average position ${d.prev.position.toFixed(1)} → ${d.curPos.toFixed(1)}.` : ''
    triggered.push({
      source: SOURCE,
      signalKey: `page-decay:${slug(path) || 'home'}`,
      title: `Google clicks to ${blog ? `"${blog}"` : path} fell ${pct(1 - d.curClicks / d.prev.clicks)}`,
      detail: `${d.url} got ${fmt(d.curClicks)} clicks from Google in the last 28 days, down from ${fmt(d.prev.clicks)} the 28 days before. Impressions ${fmt(d.prev.impressions)} → ${fmt(d.curImpr)}.${posNote}`,
      action: snippetProblem
        ? `People still see this page in Google but click it less. Rewrite its title tag and meta description so they match what searchers want, and check that a competitor hasn't taken the top spot with a better snippet.`
        : `This page is showing up in Google less. Refresh it: update outdated facts and dates, cover the questions people now search for, improve the intro, and link to it from your newer pages.${blog ? ' It is a GrowJin blog post, so you can regenerate or edit it from Blogs.' : ''}`,
      route: blog ? 'content' : 'code',
      priority: d.prev.clicks >= 100 ? 3 : 2,
      cooldownDays: COOLDOWN_DAYS,
    })
  }

  // ── Low CTR on page 1 ──────────────────────────────────────────────────────
  const decayed = new Set(decays.map((d) => d.url))
  const lowCtr = curPages
    .filter((p) => !decayed.has(p.keys[0]) && p.impressions >= LOW_CTR_MIN_IMPRESSIONS && p.position <= LOW_CTR_MAX_POSITION)
    .map((p) => ({ p, expected: EXPECTED_CTR[Math.max(1, Math.round(p.position))] }))
    .filter(({ p, expected }) => p.ctr < expected * LOW_CTR_RATIO)
    .sort((a, b) => b.p.impressions * (b.expected - b.p.ctr) - a.p.impressions * (a.expected - a.p.ctr))
    .slice(0, LOW_CTR_MAX)

  for (const { p, expected } of lowCtr) {
    const path = pathOf(p.keys[0])
    const missed = p.impressions * expected - p.clicks
    triggered.push({
      source: SOURCE,
      signalKey: `low-ctr:${slug(path) || 'home'}`,
      title: `${path} ranks on page 1 but few people click it`,
      detail: `${p.keys[0]} was shown ${fmt(p.impressions)} times in Google in the last 28 days at average position ${p.position.toFixed(1)}, but only ${(p.ctr * 100).toFixed(1)}% clicked (pages at that position usually get around ${pct(expected)}). That's roughly ${fmt(missed)} missed visits.`,
      action: 'Rewrite the page title and meta description: lead with the main keyword, promise a clear benefit, and keep the title under 60 characters so Google doesn\'t cut it off.',
      route: 'code',
      priority: 2,
      cooldownDays: COOLDOWN_DAYS,
    })
  }

  // ── Queries that fell off page 1 ───────────────────────────────────────────
  const curByQuery = new Map(curQueries.map((r) => [r.keys[0], r]))
  const offPage = prevQueries
    .filter((q) => q.position <= 10)
    .map((q) => ({ q, c: curByQuery.get(q.keys[0]) }))
    .filter((x): x is { q: Row; c: Row } => !!x.c && x.c.position > 10 && x.c.impressions >= OFF_PAGE_MIN_IMPRESSIONS)
    .sort((a, b) => b.q.clicks - a.q.clicks || b.c.impressions - a.c.impressions)
    .slice(0, OFF_PAGE_MAX)

  for (const { q, c } of offPage) {
    triggered.push({
      source: SOURCE,
      signalKey: `off-page-one:${slug(q.keys[0])}`,
      title: `"${q.keys[0]}" dropped off Google's first page`,
      detail: `Average position moved from ${q.position.toFixed(1)} to ${c.position.toFixed(1)} (last 28 days vs the 28 before). It was searched ${fmt(c.impressions)} times and brought you ${fmt(q.clicks)} clicks before the drop.`,
      action: `Search "${q.keys[0]}" on Google and compare your page with the ones now above you. Add what they cover that you don't, update the content, and make sure the page targets this phrase in its title and headings.`,
      route: 'code',
      priority: 2,
      cooldownDays: COOLDOWN_DAYS,
    })
  }

  return triggered
}

export async function detectSearchChanges(brandId: string, websiteUrl: string, clientEmail: string, privateKey: string) {
  let token: string
  try {
    token = await getGscAccessToken(clientEmail, privateKey)
  } catch (e) {
    return { skipped: `gsc auth failed: ${e instanceof Error ? e.message : String(e)}` }
  }

  const site = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`
  let hostname: string
  try { hostname = new URL(site).hostname.replace(/^www\./, '') } catch { return { skipped: 'invalid url' } }
  const prefix = site.endsWith('/') ? site : `${site}/`
  const siteIds = [encodeURIComponent(prefix), `sc-domain%3A${hostname}`]

  const cur = { startDate: day(GSC_LAG_DAYS + WINDOW_DAYS - 1), endDate: day(GSC_LAG_DAYS) }
  const prev = { startDate: day(GSC_LAG_DAYS + 2 * WINDOW_DAYS - 1), endDate: day(GSC_LAG_DAYS + WINDOW_DAYS) }
  const pages = (r: typeof cur) => ({ ...r, dimensions: ['page'], rowLimit: 250, orderBy: [{ fieldName: 'clicks', sortOrder: 'DESCENDING' }] })
  const queries = (r: typeof cur) => ({ ...r, dimensions: ['query'], rowLimit: 250, orderBy: [{ fieldName: 'impressions', sortOrder: 'DESCENDING' }] })

  // Find the working property once, then reuse it
  const first = await query(token, siteIds, pages(cur))
  if (!first) return { skipped: 'gsc property not found' }
  const ids = [first.siteId]
  const [prevPages, curQueries, prevQueries] = await Promise.all([
    query(token, ids, pages(prev)),
    query(token, ids, queries(cur)),
    query(token, ids, queries(prev)),
  ])
  const curPages = first.rows
  // Not enough history yet (new property) — nothing to compare against
  if (!prevPages?.rows.length) return { skipped: 'no prior period data' }

  const blogs = await db
    .select({ title: brandBlogs.title, liveUrl: brandBlogs.liveUrl })
    .from(brandBlogs)
    .where(eq(brandBlogs.brandId, brandId))
  const blogByPath = new Map(blogs.filter((b) => b.liveUrl).map((b) => [pathOf(b.liveUrl!), b.title]))

  const triggered = findSearchChanges(curPages, prevPages.rows, curQueries?.rows ?? [], prevQueries?.rows ?? [], blogByPath)

  const opened: string[] = []
  for (const s of triggered) {
    if (await openSignal(brandId, s)) opened.push(s.signalKey)
  }

  // Close search signals whose condition no longer holds
  const keep = new Set(triggered.map((s) => s.signalKey))
  const stale = (await getOpenSignals(brandId))
    .filter((s) => s.source === SOURCE && PREFIXES.some((p) => s.signalKey.startsWith(p)) && !keep.has(s.signalKey))
    .map((s) => s.signalKey)
  await clearSignals(brandId, SOURCE, stale)

  await saveSnapshot(brandId, 'search', {
    checkedAt: new Date().toISOString(),
    period: { cur, prev },
    pages: curPages.length,
    triggered: [...keep],
  })
  return { opened, cleared: stale, triggered: keep.size }
}
