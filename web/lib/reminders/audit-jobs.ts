import { db } from '@/lib/db'
import { brands, brandIntegrations, keywordSnapshots, moduleItems, modulePageAudit, modules, reminders } from '@/lib/db/schema'
import { and, desc, eq, inArray, like } from 'drizzle-orm'
import { brandedQueryMatcher } from '@/lib/modules/seo/keyword-fetchers'
import { getSitemap, kindOf } from '@/lib/modules/content-audit/fetcher'
import { completeReminder } from './complete'
import { AUDIT_PREFIX, auditJobSource } from './audit-source'

// Repeat jobs suggested from the brand's audits (SEO, Content Audit, GEO). Each is a normal
// recurring reminder whose category is `audit:<key>` (no extra column, so no migration). Its
// title stays as the user set it; the description is rewritten from the latest results each time
// reminders are shown, so it always names the exact thing to do this time ("Write: …").

export type AuditJobKey =
  | 'blog-post' | 'refresh-page' | 'search-console' | 'quick-win'
  | 'seo-rerun' | 'speed' | 'content-rerun' | 'ai-answers'

interface JobSpec {
  key: AuditJobKey
  title: string
  intervalDays: number
  why: string              // one line on the suggestion: why it's worth repeating
}

const JOBS: JobSpec[] = [
  { key: 'blog-post', title: 'Publish this week\'s blog post', intervalDays: 7, why: 'Posting on a schedule is what turns your publishing plan into search traffic.' },
  { key: 'refresh-page', title: 'Refresh one page that needs work', intervalDays: 14, why: 'Updating pages that are thin or losing clicks is quicker than writing new ones.' },
  { key: 'search-console', title: 'Check Search Console for errors and unindexed pages', intervalDays: 7, why: 'Pages that drop out of Google stop bringing visitors without anyone noticing.' },
  { key: 'quick-win', title: 'Improve one page that almost ranks', intervalDays: 14, why: 'Moving a search from page 2 to the top 5 is the cheapest traffic you can get.' },
  { key: 'seo-rerun', title: 'Re-run the SEO audit', intervalDays: 30, why: 'Site changes break things quietly; a monthly check catches them.' },
  { key: 'speed', title: 'Check page speed', intervalDays: 30, why: 'New images, scripts and plugins slow pages down over time.' },
  { key: 'content-rerun', title: 'Re-run the Content Audit', intervalDays: 30, why: 'Gets fresh page verdicts and new blog topics for the next month.' },
  { key: 'ai-answers', title: 'Check what AI assistants say about you', intervalDays: 30, why: 'ChatGPT and Perplexity answers change as they pick up new pages.' },
]
const JOB_MAP = new Map(JOBS.map(j => [j.key, j]))

export function auditJobKey(category: string): AuditJobKey | null {
  if (!category.startsWith(AUDIT_PREFIX)) return null
  const key = category.slice(AUDIT_PREFIX.length) as AuditJobKey
  return JOB_MAP.has(key) ? key : null
}


// ── What the brand's audits currently say ─────────────────────────────────────

const DAY = 86_400_000
type ModuleRow = { id: string; type: string; score: number | null; lastAnalyzedAt: Date | null }
type CalendarEntry = { date: string; topic: string; stage?: string }
type PageRow = { url: string; title: string | null; verdict: string; urgency: string; reason: string | null; action: string | null }
type QuickWin = { keyword: string; impressions: number; position: number }

interface AuditContext {
  websiteUrl: string
  mods: Map<string, ModuleRow>
  calendar: CalendarEntry[]
  pages: PageRow[]             // Content Audit verdicts that need work, most urgent first
  pagesTotal: number
  quickWins: QuickWin[]        // non-branded searches at positions 4–20, most seen first
  gscConnected: boolean
  seoFailing: number
  speedIssues: string[]        // failing speed checks' text
}

const VERDICT_ORDER: Record<string, number> = { Consolidate: 0, Refresh: 1, Repurpose: 2, Remove: 3 }
const URGENCY_ORDER: Record<string, number> = { High: 0, Medium: 1, Low: 2 }

async function loadContext(brandId: string): Promise<AuditContext | null> {
  const [brand] = await db.select({ name: brands.name, websiteUrl: brands.websiteUrl }).from(brands).where(eq(brands.id, brandId)).limit(1)
  if (!brand) return null
  const modRows = await db.select({ id: modules.id, type: modules.type, score: modules.score, lastAnalyzedAt: modules.lastAnalyzedAt })
    .from(modules).where(and(eq(modules.brandId, brandId), inArray(modules.type, ['seo', 'content-audit', 'geo'])))
  const mods = new Map(modRows.filter(m => m.lastAnalyzedAt).map(m => [m.type, m]))
  const seo = mods.get('seo'), content = mods.get('content-audit')

  const [calendarRow, pageRows, seoItems, [gsc], snapshots] = await Promise.all([
    content
      ? db.select({ aiData: moduleItems.aiData }).from(moduleItems).where(and(eq(moduleItems.moduleId, content.id), eq(moduleItems.slug, 'content-calendar-30-day'))).limit(1)
      : Promise.resolve([]),
    content
      ? db.select({ url: modulePageAudit.url, title: modulePageAudit.title, verdict: modulePageAudit.verdict, urgency: modulePageAudit.urgency, reason: modulePageAudit.reason, action: modulePageAudit.action })
          .from(modulePageAudit).where(eq(modulePageAudit.moduleId, content.id))
      : Promise.resolve([]),
    seo
      ? db.select({ slug: moduleItems.slug, aiVerified: moduleItems.aiVerified, aiDetail: moduleItems.aiDetail }).from(moduleItems).where(eq(moduleItems.moduleId, seo.id))
      : Promise.resolve([]),
    db.select({ id: brandIntegrations.id }).from(brandIntegrations)
      .where(and(eq(brandIntegrations.brandId, brandId), eq(brandIntegrations.provider, 'gsc_api'), eq(brandIntegrations.status, 'connected'))).limit(1),
    db.select({ keyword: keywordSnapshots.keyword, impressions: keywordSnapshots.impressions, position: keywordSnapshots.position, fetchedAt: keywordSnapshots.fetchedAt })
      .from(keywordSnapshots).where(eq(keywordSnapshots.brandId, brandId)).orderBy(desc(keywordSnapshots.fetchedAt)).limit(300)
      .catch(() => []),
  ])

  const calendar = Array.isArray(calendarRow[0]?.aiData) ? (calendarRow[0].aiData as unknown as CalendarEntry[]).filter(e => e?.topic && e?.date) : []
  const pages = pageRows.filter(p => p.verdict !== 'Keep')
    .sort((a, b) => (VERDICT_ORDER[a.verdict] ?? 9) - (VERDICT_ORDER[b.verdict] ?? 9) || (URGENCY_ORDER[a.urgency] ?? 9) - (URGENCY_ORDER[b.urgency] ?? 9))

  // The newest Search Console snapshot only
  const latest = snapshots[0]?.fetchedAt?.getTime()
  const isBranded = brandedQueryMatcher(brand.name, brand.websiteUrl)
  const quickWins = snapshots
    .filter(s => latest !== undefined && Math.abs(s.fetchedAt.getTime() - latest) < 60 * 60 * 1000)
    .filter(s => s.position > 3 && s.position <= 20 && s.impressions >= 20 && !isBranded(s.keyword))
    .sort((a, b) => b.impressions - a.impressions)
    .map(s => ({ keyword: s.keyword, impressions: s.impressions, position: s.position }))

  const failing = seoItems.filter(i => !i.aiVerified && i.aiDetail && !i.aiDetail.startsWith('Couldn\'t') && !/^(kw-|gsc-|lb-)/.test(i.slug))
  return {
    websiteUrl: brand.websiteUrl.startsWith('http') ? brand.websiteUrl : `https://${brand.websiteUrl}`,
    mods,
    calendar,
    pages,
    pagesTotal: pageRows.length,
    quickWins,
    gscConnected: !!gsc,
    seoFailing: failing.length,
    speedIssues: failing.filter(i => /^(cwv\.|lighthouse\.score)/.test(i.slug)).map(i => i.aiDetail!),
  }
}

const ago = (d: Date) => {
  const days = Math.floor((Date.now() - d.getTime()) / DAY)
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
}
const pathOf = (url: string) => { try { return new URL(url).pathname } catch { return url } }
const firstSentence = (s: string) => (s.replace(/\*\*/g, '').match(/^.*?[.!?](\s|$)/)?.[0] ?? s).trim()

/** Whether the job has something to go on for this brand, and where its card links to. */
function availability(key: AuditJobKey, c: AuditContext): { ok: boolean; url: string | null } {
  switch (key) {
    case 'blog-post': return { ok: c.mods.has('content-audit'), url: '/dashboard?module=content-audit' }
    case 'refresh-page': return { ok: c.pages.length > 0, url: '/dashboard?module=content-audit' }
    case 'search-console': return { ok: c.gscConnected, url: 'https://search.google.com/search-console' }
    case 'quick-win': return { ok: c.quickWins.length > 0, url: 'https://search.google.com/search-console' }
    case 'seo-rerun': return { ok: c.mods.has('seo'), url: '/dashboard?module=seo' }
    case 'speed': return { ok: c.mods.has('seo'), url: `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(c.websiteUrl)}` }
    case 'content-rerun': return { ok: c.mods.has('content-audit'), url: '/dashboard?module=content-audit' }
    case 'ai-answers': return { ok: c.mods.has('geo'), url: '/dashboard?module=geo' }
  }
}

/** This time's task, from the latest results. `period` counts the intervals since the reminder was added, to rotate through lists. */
function describe(key: AuditJobKey, c: AuditContext, r: { lastDoneAt: Date | null; createdAt: Date | null; intervalDays: number }): string {
  const period = Math.max(0, Math.floor((Date.now() - (r.createdAt?.getTime() ?? Date.now())) / (r.intervalDays * DAY)))
  switch (key) {
    case 'blog-post': {
      // One topic per interval, counted from when the reminder was added or the plan last regenerated
      const start = Math.max(r.createdAt?.getTime() ?? 0, c.mods.get('content-audit')?.lastAnalyzedAt?.getTime() ?? 0)
      const done = r.lastDoneAt && r.lastDoneAt.getTime() > start ? Math.floor((r.lastDoneAt.getTime() - start) / (r.intervalDays * DAY)) + 1 : 0
      const next = c.calendar[done] ?? null
      if (next) return `Next from your plan: "${next.topic}"${next.stage ? ` (${next.stage.toLowerCase()} stage)` : ''}. Ticks itself off when a new article shows up in your sitemap.`
      return c.calendar.length
        ? 'You\'ve written everything in your plan. Re-run the Content Audit for new topics, or answer a question a customer asked you this week.'
        : 'Answer one question your customers ask, in 800+ words. Re-run the Content Audit to get a dated publishing plan.'
    }
    case 'refresh-page': {
      if (!c.pages.length) return 'No pages need work right now. Re-run the Content Audit to check again.'
      const p = c.pages[period % c.pages.length]
      return `This time: ${p.title ? `"${p.title}" (${pathOf(p.url)})` : pathOf(p.url)} — ${p.verdict}. ${p.reason ?? ''} ${p.action ?? ''}`.replace(/\s+/g, ' ').trim()
    }
    case 'search-console':
      return 'In Search Console, open Pages for new "Not indexed" reasons, then Performance for any page whose clicks suddenly dropped. Request indexing for pages that should be in Google.'
    case 'quick-win': {
      if (!c.quickWins.length) return 'No searches just off the top results right now.'
      const q = c.quickWins[period % c.quickWins.length]
      return `This time: "${q.keyword}" — position ${Math.round(q.position)}, ${q.impressions.toLocaleString()} views in Google. Improve the page that shows for it: answer the search fully, use the words in its title and first heading, and link to it from related pages.`
    }
    case 'seo-rerun': {
      const m = c.mods.get('seo')
      return m?.lastAnalyzedAt
        ? `Last run ${ago(m.lastAnalyzedAt)}: score ${m.score ?? 0}, ${c.seoFailing} check${c.seoFailing === 1 ? '' : 's'} failing. Re-run it and fix anything new.`
        : 'Run the SEO audit and fix anything new.'
    }
    case 'speed':
      return c.speedIssues.length
        ? `Last check: ${firstSentence(c.speedIssues[0])} Run Google's speed test and see if it improved.`
        : 'Speed passed last time. Run Google\'s speed test to make sure new images or scripts haven\'t slowed the page down.'
    case 'content-rerun': {
      const m = c.mods.get('content-audit')
      return m?.lastAnalyzedAt
        ? `Last run ${ago(m.lastAnalyzedAt)}: ${c.pages.length} of ${c.pagesTotal} pages needed work. Re-run it for fresh verdicts and next month's topics.`
        : 'Run the Content Audit for page verdicts and a publishing plan.'
    }
    case 'ai-answers': {
      const m = c.mods.get('geo')
      return m?.lastAnalyzedAt
        ? `Last run ${ago(m.lastAnalyzedAt)}: score ${m.score ?? 0}. Re-run the GEO audit to see whether AI assistants mention you now.`
        : 'Run the GEO audit to see whether AI assistants mention you.'
    }
  }
}

// ── Suggestions ───────────────────────────────────────────────────────────────

export interface AuditJobSuggestion {
  key: AuditJobKey
  title: string
  why: string
  source: string
  intervalDays: number
  preview: string   // what the first one would ask
}

/** Jobs the brand's audits support that it hasn't added yet. */
export async function getAuditJobSuggestions(brandId: string): Promise<AuditJobSuggestion[]> {
  const [c, existing] = await Promise.all([
    loadContext(brandId),
    db.select({ category: reminders.category }).from(reminders).where(and(eq(reminders.brandId, brandId), like(reminders.category, `${AUDIT_PREFIX}%`))),
  ])
  if (!c) return []
  const added = new Set(existing.map(r => r.category))
  const now = new Date()
  return JOBS
    .filter(j => !added.has(AUDIT_PREFIX + j.key) && availability(j.key, c).ok)
    .map(j => ({ key: j.key, title: j.title, why: j.why, source: auditJobSource(AUDIT_PREFIX + j.key) ?? '', intervalDays: j.intervalDays, preview: describe(j.key, c, { lastDoneAt: null, createdAt: now, intervalDays: j.intervalDays }) }))
}

/** The reminder row to insert for a suggested job, or null if the key is unknown. */
export async function buildAuditJobReminder(brandId: string, key: string): Promise<typeof reminders.$inferInsert | null> {
  const job = JOB_MAP.get(key as AuditJobKey)
  if (!job) return null
  const c = await loadContext(brandId)
  if (!c) return null
  const now = new Date()
  return {
    brandId,
    title: job.title,
    description: describe(job.key, c, { lastDoneAt: null, createdAt: now, intervalDays: job.intervalDays }),
    category: AUDIT_PREFIX + job.key,
    url: availability(job.key, c).url,
    intervalDays: job.intervalDays,
    // Weekly jobs start in a couple of days; monthly ones in a week
    nextDueAt: new Date(now.getTime() + (job.intervalDays <= 7 ? 2 : 7) * DAY),
    isPreset: true,
    enabled: true,
  }
}

// ── Keeping them current ──────────────────────────────────────────────────────

/** Has a new article appeared in the sitemap since `since`? (Pages the last Content Audit already read don't count.) */
async function newPostSince(c: AuditContext, contentModuleId: string | undefined, since: Date): Promise<boolean> {
  const origin = new URL(c.websiteUrl).origin
  const sitemap = await Promise.race([
    getSitemap(origin),
    new Promise<Map<string, string | null>>(resolve => setTimeout(() => resolve(new Map()), 6000)),
  ])
  const known = contentModuleId
    ? new Set((await db.select({ url: modulePageAudit.url }).from(modulePageAudit).where(eq(modulePageAudit.moduleId, contentModuleId))).map(r => r.url.replace(/\/$/, '')))
    : new Set<string>()
  for (const [url, lastmod] of sitemap) {
    if (!lastmod || Date.parse(lastmod) <= since.getTime()) continue
    if (kindOf(url, c.websiteUrl) === 'post' && !known.has(url.replace(/\/$/, ''))) return true
  }
  return false
}

/**
 * Rewrites each audit reminder's description from the latest results. With `autoDone`, a due
 * blog-post reminder is ticked off when a new article shows up in the sitemap (a network call,
 * so only from the Reminders page and the daily email, not Today).
 */
export async function refreshAuditReminders(brandId: string, opts: { autoDone?: boolean } = {}): Promise<void> {
  const rows = await db.select().from(reminders).where(and(eq(reminders.brandId, brandId), like(reminders.category, `${AUDIT_PREFIX}%`)))
  if (rows.length === 0) return
  const c = await loadContext(brandId)
  if (!c) return
  for (const r of rows) {
    const key = auditJobKey(r.category)
    if (!key || !r.enabled) continue
    if (key === 'blog-post' && opts.autoDone && r.nextDueAt.getTime() - Date.now() < 3 * DAY) {
      const since = r.lastDoneAt ?? r.createdAt ?? new Date(Date.now() - r.intervalDays * DAY)
      if (await newPostSince(c, c.mods.get('content-audit')?.id, since).catch(() => false)) {
        const done = await completeReminder(brandId, r.id)
        if (done) { r.lastDoneAt = done.lastDoneAt; r.nextDueAt = done.nextDueAt }
      }
    }
    const description = describe(key, c, r)
    if (description !== r.description) {
      await db.update(reminders).set({ description }).where(eq(reminders.id, r.id))
    }
  }
}
