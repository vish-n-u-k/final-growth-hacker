// ── Growth diagnosis ──────────────────────────────────────────────────────────
// Finds the brand's current bottleneck from live data, then turns it into
// "plays" (suggested actions) using only the channels the brand has connected.
//
//   awareness  → not enough website traffic        → blog / SEO / GEO / social / ads / outreach
//   conversion → traffic, but visitors don't act   → landing page + CTA fixes, conversion tracking
//   retention  → signups, but users go quiet       → win-back + onboarding emails
//   growth     → funnel healthy                    → double down on the best channel
//
// Plays are stored as signals (source 'diagnosis') so they get completion,
// dismissal, cooldown and auto-clear for free. Rule-based, no AI calls.

import { db } from '@/lib/db'
import { brands, brandIntegrations, modules, keywordSnapshots } from '@/lib/db/schema'
import { and, eq, gte } from 'drizzle-orm'
import { getGaAnalytics } from '@/lib/mcp/tools/get_ga_analytics'
import { getGscData } from '@/lib/mcp/tools/get_gsc_data'
import { getPosthogSegments } from '@/lib/mcp/tools/get_posthog_segments'
import { openSignal, clearSignals, getOpenSignals, saveSnapshot, type SignalInput } from '@/lib/signals'
import { getActivity } from '@/lib/signals/activity'

export type GrowthStage = 'awareness' | 'conversion' | 'retention' | 'growth' | 'unknown'

// Thresholds — tune here
const LOW_TRAFFIC_PER_DAY = 30      // avg sessions/day below this = awareness problem
const LOW_CONVERSION_RATE = 0.01    // signups or conversions per session below 1% = conversion problem
const LOW_RETURN_PCT = 30           // under 30% of last period's users came back = retention problem
const MIN_RETURN_BASE = 20          // need this many users in the base period to judge retention
const MIN_PAGE_SESSIONS = 50        // landing page needs this many sessions (30d) to judge it
const SOCIAL_GAP_DAYS = 3           // suggest a post if nothing went out in this many days
const BLOG_GAP_DAYS = 7

export interface DiagnosisMetrics {
  websiteType: string | null
  traffic: {
    sessions30d: number
    perDay: number
    conversions30d: number
    channels: { channel: string; sessions: number; pct: number }[]
    landingPages: { page: string; sessions: number; conversions: number }[]
  } | null
  search: { opportunities: { query: string; impressions: number; clicks: number; position: number }[] } | null
  // returnPct: % of users active 15–30 days ago who were active again in the last 14 days
  app: { newThisWeek: number | null; newLastWeek: number | null; growthPct: number | null; returnPct: number | null; returnBase: number | null; active30d: number | null } | null
  // From the real website (RSS / sitemap) and real social accounts, checked daily.
  // canSee=false means GrowJin couldn't check, NOT that there's no activity.
  blog: { canSee: boolean; source: string | null; postCount: number; daysSinceLast: number | null }
  social: { canSee: boolean; daysSinceLast: number | null; lastPlatform: string | null; accounts: string[]; unreadable: string[] }
  socialConnected: boolean // Frekto connected (GrowJin can schedule posts)
  metaAdsConnected: boolean
  gmailConnected: boolean
  githubConnected: boolean
  seoScore: number | null
  geoScore: number | null
  emailMarketingScore: number | null
  rankingDrop: number | null // avg position worsened by this many spots (last 3d vs prior 4d)
}

export interface Diagnosis {
  stage: GrowthStage
  summary: string
  computedAt: string
  metrics: DiagnosisMetrics
}

type Play = Omit<SignalInput, 'source'>

const daysSince = (d: Date | null | undefined) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 864e5) : null)
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

// ── 1. Gather metrics ────────────────────────────────────────────────────────

const NON_APP_TYPES = new Set(['event', 'ecommerce', 'agency', 'blog', 'local', 'nonprofit', 'portfolio'])

async function hogql(host: string, projectId: string, apiKey: string, query: string): Promise<number | null> {
  try {
    const res = await fetch(`${host}/api/projects/${projectId}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { results?: unknown[][] }
    const v = json.results?.[0]?.[0]
    return typeof v === 'number' ? v : null
  } catch { return null }
}

// Of the users active 15–30 days ago, how many came back in the last 14 days
async function posthogReturnRate(brandId: string): Promise<{ returnPct: number | null; returnBase: number | null }> {
  const [ph] = await db.select().from(brandIntegrations)
    .where(and(eq(brandIntegrations.brandId, brandId), eq(brandIntegrations.provider, 'posthog'), eq(brandIntegrations.status, 'connected')))
    .limit(1)
  const meta = (ph?.metadata as Record<string, string> | null) ?? {}
  if (!ph?.apiKey || !meta.project_id) return { returnPct: null, returnBase: null }
  const host = (meta.posthog_host ?? 'https://us.posthog.com').replace(/\/$/, '')
  const basePeriod = `SELECT DISTINCT person_id FROM events WHERE timestamp > now() - interval 30 day AND timestamp <= now() - interval 14 day`
  const [base, returned] = await Promise.all([
    hogql(host, meta.project_id, ph.apiKey, `SELECT count() FROM (${basePeriod})`),
    hogql(host, meta.project_id, ph.apiKey, `SELECT count(DISTINCT person_id) FROM events WHERE timestamp > now() - interval 14 day AND person_id IN (${basePeriod})`),
  ])
  if (base == null || returned == null || base === 0) return { returnPct: null, returnBase: base }
  return { returnPct: Math.round((returned / base) * 100), returnBase: base }
}


export async function gatherMetrics(brandId: string): Promise<DiagnosisMetrics> {
  const [brandRows, integrations, mods, kwRows, ga, gsc, ph, ret] = await Promise.all([
    db.select({ websiteType: brands.websiteType, websiteUrl: brands.websiteUrl }).from(brands).where(eq(brands.id, brandId)).limit(1),
    db.select({ provider: brandIntegrations.provider }).from(brandIntegrations)
      .where(and(eq(brandIntegrations.brandId, brandId), eq(brandIntegrations.status, 'connected'))),
    db.select({ type: modules.type, score: modules.score, lastAnalyzedAt: modules.lastAnalyzedAt, status: modules.status })
      .from(modules).where(eq(modules.brandId, brandId)),
    db.select({ position: keywordSnapshots.position, fetchedAt: keywordSnapshots.fetchedAt }).from(keywordSnapshots)
      .where(and(eq(keywordSnapshots.brandId, brandId), gte(keywordSnapshots.fetchedAt, new Date(Date.now() - 7 * 864e5)))),
    getGaAnalytics(brandId, '30d').catch(() => null),
    getGscData(brandId, 28, 50).catch(() => null),
    getPosthogSegments(brandId).catch(() => null),
    posthogReturnRate(brandId).catch(() => ({ returnPct: null, returnBase: null })),
  ])

  const providers = new Set(integrations.map((i) => i.provider))
  const activity = await getActivity(brandId, brandRows[0]?.websiteUrl ?? null)
  const scoreOf = (type: string) => {
    const m = mods.find((x) => x.type === type && x.status !== 'locked' && x.status !== 'not-applicable')
    return m?.lastAnalyzedAt ? (m.score ?? 0) : null
  }

  let traffic: DiagnosisMetrics['traffic'] = null
  if (ga && 'overview' in ga && ga.overview && ga.channels && ga.landingPages) {
    traffic = {
      sessions30d: ga.overview.sessions,
      perDay: Math.round(ga.overview.sessions / 30),
      conversions30d: ga.overview.conversions,
      channels: ga.channels.map((c) => ({ channel: c.channel, sessions: c.sessions, pct: c.pct })),
      landingPages: ga.landingPages.map((p) => ({ page: p.page, sessions: p.sessions, conversions: p.conversions })),
    }
  }

  let search: DiagnosisMetrics['search'] = null
  if (gsc && 'topQueries' in gsc && gsc.topQueries) {
    // Striking distance: people already see you for it (impressions) but you're not top 3
    const opportunities = gsc.topQueries
      .filter((q) => q.position >= 4 && q.position <= 20 && q.impressions >= 50)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 5)
      .map((q) => ({ query: q.query, impressions: q.impressions, clicks: q.clicks, position: q.position }))
    search = { opportunities }
  }

  let app: DiagnosisMetrics['app'] = null
  if (ph && 'segments' in ph) {
    app = {
      newThisWeek: ph.segments.newUsersThisWeek,
      newLastWeek: ph.segments.newUsersLastWeek,
      growthPct: ph.segments.weekOverWeekGrowthPct,
      returnPct: ret.returnPct,
      returnBase: ret.returnBase,
      active30d: ph.segments.totalActive30d,
    }
  }

  let rankingDrop: number | null = null
  const now = Date.now()
  const recent = kwRows.filter((r) => now - new Date(r.fetchedAt).getTime() < 3 * 864e5)
  const older = kwRows.filter((r) => now - new Date(r.fetchedAt).getTime() >= 3 * 864e5)
  if (recent.length && older.length) {
    const avg = (a: typeof kwRows) => a.reduce((s, r) => s + r.position, 0) / a.length
    const drop = avg(recent) - avg(older)
    rankingDrop = drop > 3 ? Math.round(drop * 10) / 10 : null
  }

  return {
    websiteType: brandRows[0]?.websiteType ?? null,
    traffic,
    search,
    app,
    blog: {
      canSee: activity.blog.canSee,
      source: activity.blog.source,
      postCount: activity.blog.postCount,
      daysSinceLast: daysSince(activity.blog.lastPublishedAt ? new Date(activity.blog.lastPublishedAt) : null),
    },
    social: {
      canSee: activity.social.canSee,
      daysSinceLast: daysSince(activity.social.lastPostAt ? new Date(activity.social.lastPostAt) : null),
      lastPlatform: activity.social.lastPlatform,
      accounts: activity.social.platforms.filter((p) => !p.error && p.platform !== 'growjin').map((p) => p.platform),
      unreadable: activity.social.unreadable ?? [],
    },
    socialConnected: providers.has('frekto'),
    metaAdsConnected: providers.has('meta_ads'),
    gmailConnected: providers.has('gmail'),
    githubConnected: providers.has('github'),
    seoScore: scoreOf('seo'),
    geoScore: scoreOf('geo'),
    emailMarketingScore: scoreOf('email-marketing'),
    rankingDrop,
  }
}

// ── 2. Find the bottleneck ───────────────────────────────────────────────────

// PostHog connected → treat as an app, unless the website type says otherwise
function isAppBrand(m: DiagnosisMetrics): boolean {
  return m.app?.newThisWeek != null && !NON_APP_TYPES.has(m.websiteType ?? '')
}

export function findStage(m: DiagnosisMetrics): { stage: GrowthStage; summary: string } {
  const t = m.traffic
  if (!t) {
    return { stage: 'unknown', summary: 'Google Analytics is not connected, so traffic and conversions can\'t be measured yet.' }
  }

  if (t.sessions30d === 0) {
    return { stage: 'unknown', summary: 'Google Analytics recorded zero visits in the last 30 days, so tracking is probably broken or pointed at the wrong site.' }
  }

  if (t.perDay < LOW_TRAFFIC_PER_DAY) {
    return { stage: 'awareness', summary: `Your site gets about ${t.perDay} visits a day. The main problem is that not enough people find you yet.` }
  }

  // Signups: PostHog new users for apps, GA4 conversions otherwise
  const isApp = isAppBrand(m)
  const signups30d = isApp ? Math.round((m.app!.newThisWeek ?? 0) * 30 / 7) : t.conversions30d
  const rate = t.sessions30d > 0 ? signups30d / t.sessions30d : 0

  if (signups30d === 0) {
    return { stage: 'conversion', summary: `You get about ${t.perDay} visits a day but no ${isApp ? 'signups' : 'conversions'} were recorded in 30 days. Either visitors aren't acting or conversions aren't being tracked.` }
  }
  if (rate < LOW_CONVERSION_RATE) {
    return { stage: 'conversion', summary: `You get about ${t.perDay} visits a day but only ${(rate * 100).toFixed(1)}% ${isApp ? 'sign up' : 'convert'}. The main problem is turning visitors into ${isApp ? 'users' : 'customers'}.` }
  }

  if (isApp && m.app?.returnPct != null && (m.app.returnBase ?? 0) >= MIN_RETURN_BASE && m.app.returnPct < LOW_RETURN_PCT) {
    return {
      stage: 'retention',
      summary: `People sign up, but only ${m.app.returnPct}% of last month's users came back in the last 2 weeks. The main problem is keeping users.`,
    }
  }

  return { stage: 'growth', summary: `Traffic (${t.perDay}/day) and ${isApp ? 'signups' : 'conversions'} (${(rate * 100).toFixed(1)}%) look healthy. Focus on scaling what already works.` }
}

// ── 3. Turn the bottleneck into plays (only via connected channels) ──────────

function blogPlay(m: DiagnosisMetrics, reason: string): Play | null {
  const opp = m.search?.opportunities[0]
  if (opp) {
    return {
      signalKey: `blog-query:${slug(opp.query)}`,
      title: `Write a blog post targeting "${opp.query}"`,
      detail: `${reason} Google already shows you for "${opp.query}" (${opp.impressions} impressions in 28 days) but you rank around #${opp.position}. A focused post can move you onto page one.`,
      action: `Write a 1,200+ word post that fully answers "${opp.query}", use the phrase in the title and H1, link to it from your homepage or a relevant page, and publish it.`,
      route: 'content',
      priority: 3,
    }
  }
  // Only when we can actually see the blog and its newest post is old.
  // Unknown dates or no visible blog → say nothing rather than guess.
  if (m.blog.canSee && m.blog.daysSinceLast !== null && m.blog.daysSinceLast >= BLOG_GAP_DAYS) {
    const where = m.blog.source === 'rss' ? 'your blog feed' : m.blog.source === 'sitemap' ? 'your sitemap' : 'GrowJin'
    return {
      signalKey: 'blog-weekly',
      title: 'Publish a new blog post',
      detail: `${reason} Your newest blog post (found via ${where}) is ${m.blog.daysSinceLast} days old. Regular posts are the cheapest way to grow search traffic.`,
      action: 'Pick one question your customers ask often, write a clear post answering it, and publish it on your site.',
      route: 'content',
      priority: 2,
      cooldownDays: 5,
    }
  }
  return null
}

function socialPlay(m: DiagnosisMetrics, reason: string, priority: 1 | 2 | 3 = 2): Play | null {
  // Only when real accounts were checked — never claim "nothing posted" from GrowJin's own table
  if (!m.social.canSee) return null
  if (m.social.daysSinceLast !== null && m.social.daysSinceLast < SOCIAL_GAP_DAYS) return null
  const cap = (a: string) => a[0].toUpperCase() + a.slice(1)
  const accounts = m.social.accounts.map(cap).join(', ')
  const unseen = m.social.unreadable.map(cap).join(', ')
  const caveat = unseen ? ` GrowJin can't read ${unseen} yet, so if you posted there recently, mark this not relevant.` : ''
  const platform = m.social.lastPlatform && m.social.lastPlatform !== 'growjin'
    ? m.social.lastPlatform[0].toUpperCase() + m.social.lastPlatform.slice(1)
    : null
  return {
    signalKey: 'social-post',
    title: 'Post on social media today',
    detail: `${reason} ${m.social.daysSinceLast === null
      ? `No posts found on ${accounts || 'your connected accounts'}.`
      : `Your last post${platform ? ` on ${platform}` : ''} was ${m.social.daysSinceLast} days ago.`}${caveat}`,
    action: `Draft one post about a customer problem you solve, with a link back to your site, and ${m.socialConnected ? 'schedule it through Frekto' : `post it${platform ? ` on ${platform}` : ''}`}.`,
    route: 'content',
    priority: unseen ? 1 : priority,
    cooldownDays: 2,
  }
}

export function buildPlays(stage: GrowthStage, m: DiagnosisMetrics): Play[] {
  const plays: (Play | null)[] = []
  const t = m.traffic

  switch (stage) {
    case 'unknown':
      plays.push(t
        ? {
            signalKey: 'fix-ga4-tracking',
            title: 'Fix Google Analytics tracking',
            detail: 'Google Analytics recorded zero visits in 30 days. Either the tracking tag is missing from the site or the connected GA4 property is the wrong one.',
            action: 'Check the GA4 tag (gtag.js or Google Tag Manager) loads on every page of the site, and that the property ID in GrowJin Settings → Integrations matches the property receiving data.',
            route: 'code',
            priority: 3,
          }
        : {
            signalKey: 'connect-ga4',
            title: 'Connect Google Analytics',
            detail: 'Without traffic data GrowJin can\'t tell whether your problem is getting visitors, converting them, or keeping them, so suggestions are generic.',
            action: 'In GrowJin go to Settings → Integrations → Google Analytics Data API and add your service account credentials.',
            route: 'manual',
            priority: 3,
          })
      plays.push(blogPlay(m, 'Content builds traffic over time.'))
      plays.push(socialPlay(m, 'Regular posts keep you visible.'))
      break

    case 'awareness': {
      const why = `Your site gets about ${t!.perDay} visits a day.`
      plays.push(blogPlay(m, why))
      plays.push(socialPlay(m, why, 2))
      if (m.websiteType !== 'local' && m.geoScore !== null && m.geoScore < 50) {
        plays.push({
          signalKey: 'geo-improve',
          title: `Get found in AI search (GEO score ${m.geoScore}%)`,
          detail: `${why} More people now ask ChatGPT, Perplexity and Google AI instead of searching. Your GEO score is ${m.geoScore}%, so AI tools rarely mention you.`,
          action: 'Call get_pending_items with module_type "geo" and fix the highest-priority item in the codebase.',
          route: 'code',
          priority: 2,
        })
      }
      if (m.seoScore !== null && m.seoScore < 60) {
        plays.push({
          signalKey: 'seo-basics',
          title: `Fix your SEO basics (SEO score ${m.seoScore}%)`,
          detail: `${why} Your SEO score is ${m.seoScore}%, so Google has trouble understanding and ranking your pages.`,
          action: 'Call get_pending_items with module_type "seo" and fix the critical items in the codebase.',
          route: 'code',
          priority: 2,
        })
      }
      if (m.metaAdsConnected) {
        plays.push({
          signalKey: 'meta-traffic-campaign',
          title: 'Run a small Meta traffic campaign',
          detail: `${why} Organic channels take weeks. A small paid campaign brings visitors now and shows which message works.`,
          action: 'In Ads Manager, create a Traffic campaign to your best landing page with a small daily budget for 7 days, then review click rate and cost per click.',
          route: 'manual',
          priority: 1,
        })
      }
      if (m.gmailConnected) {
        plays.push({
          signalKey: 'outreach-batch',
          title: 'Send 5 outreach emails',
          detail: `${why} Direct outreach to people who fit your customer profile is the fastest free way to get first visitors and feedback.`,
          action: 'Pick 5 prospects, write a short personal email for each about the problem you solve, and send them from Gmail Hub.',
          route: 'content',
          priority: 1,
          cooldownDays: 3,
        })
      }
      break
    }

    case 'conversion': {
      const isApp = isAppBrand(m)
      const why = `You get about ${t!.perDay} visits a day but few of them ${isApp ? 'sign up' : 'convert'}.`
      if (t!.conversions30d === 0 && !isApp) {
        plays.push({
          signalKey: 'setup-conversion-tracking',
          title: 'Set up conversion tracking',
          detail: `${t!.sessions30d} visits in 30 days but zero conversions recorded in Google Analytics. Without tracking you can't tell what's working.`,
          action: 'In GA4 → Admin → Events, mark your key action (form submit, signup, purchase) as a key event. If the event doesn\'t exist yet, add it to the site.',
          route: 'manual',
          priority: 3,
        })
      }
      // With GA4 conversions tracked: the busy page that converts worst. Without: the busiest page.
      const busy = t!.landingPages.filter((p) => p.sessions >= MIN_PAGE_SESSIONS)
      const weakPage = t!.conversions30d > 0
        ? busy.sort((a, b) => (a.conversions / a.sessions) - (b.conversions / b.sessions) || b.sessions - a.sessions)[0]
        : busy.sort((a, b) => b.sessions - a.sessions)[0]
      if (weakPage) {
        const pageName = weakPage.page === '/' ? 'your homepage' : weakPage.page
        plays.push({
          signalKey: `conversion-page:${slug(weakPage.page) || 'home'}`,
          title: `Make ${pageName} turn visitors into ${isApp ? 'signups' : 'customers'}`,
          detail: t!.conversions30d > 0
            ? `${why} ${pageName} got ${weakPage.sessions} visits in 30 days with ${weakPage.conversions} conversions.`
            : `${why} ${pageName === 'your homepage' ? 'Your homepage' : pageName} is your most-visited page (${weakPage.sessions} visits in 30 days), so improving it has the biggest effect.`,
          action: `Edit ${pageName}: make the main call-to-action clear and visible above the fold, add proof (testimonials, logos, numbers) next to it, and remove distractions.`,
          route: 'code',
          priority: 3,
        })
      }
      plays.push({
        signalKey: 'conversion-checklist',
        title: 'Fix your homepage message and call-to-action',
        detail: `${why} Unclear value propositions and weak calls-to-action are the most common reason visitors leave.`,
        action: 'Call get_pending_items with module_type "foundation" and fix items about value proposition, call-to-action and social proof first.',
        route: 'code',
        priority: 2,
      })
      break
    }

    case 'retention': {
      const why = `Only ${m.app?.returnPct}% of last month's users came back in the last 2 weeks.`
      plays.push({
        signalKey: 'reengage-churned',
        title: 'Win back users who went quiet',
        detail: `${why} A short personal email to inactive users is the cheapest way to bring some back and learn why they left.`,
        action: 'Call get_posthog_churned_users to get the list, draft a short personal check-in email asking what stopped them, and send it.',
        route: 'content',
        priority: 3,
      })
      if (m.emailMarketingScore === null || m.emailMarketingScore < 60) {
        plays.push({
          signalKey: 'onboarding-emails',
          title: 'Set up an onboarding email sequence',
          detail: `${why} New users who get a helpful email in their first week are much more likely to stick around.`,
          action: 'Draft a 3-email sequence (welcome + first win, day 2 tip, day 5 check-in) and set it up in your email tool.',
          route: 'content',
          priority: 2,
        })
      }
      break
    }

    case 'growth': {
      const top = t!.channels[0]
      const name = top?.channel.toLowerCase() ?? ''
      const why = top ? `${top.channel} is your top channel (${top.pct}% of visits).` : 'Your funnel looks healthy.'
      if (name.includes('organic search')) plays.push(blogPlay(m, why))
      else if (name.includes('social')) plays.push(socialPlay(m, why, 3))
      else if (name.includes('paid') && m.metaAdsConnected) {
        plays.push({
          signalKey: 'scale-best-campaign',
          title: 'Scale your best ad campaign',
          detail: `${why} Paid is working. Increasing budget gradually on the best campaign usually keeps costs stable.`,
          action: 'In Ads Manager, raise the budget of your best-performing campaign by about 20% and check results in 3 days.',
          route: 'manual',
          priority: 2,
        })
      } else {
        plays.push({
          signalKey: 'referrals-reviews',
          title: 'Ask happy customers for referrals and reviews',
          detail: `${why} Word of mouth compounds. Reviews also help SEO and AI search.`,
          action: 'Email 5 of your happiest customers asking for a review (G2, Google, Trustpilot) or an intro to someone who would benefit.',
          route: 'content',
          priority: 2,
          cooldownDays: 14,
        })
      }
      plays.push(blogPlay(m, why))
      break
    }
  }

  // Any stage: keyword rankings slipping
  if (m.rankingDrop !== null) {
    plays.push({
      signalKey: 'ranking-drop',
      title: 'Your Google rankings slipped this week',
      detail: `Tracked keywords dropped about ${m.rankingDrop} positions on average over the last few days.`,
      action: 'Call get_keyword_trends to see which keywords dropped, check those pages still load and match the search intent, and refresh their content.',
      route: 'code',
      priority: 2,
    })
  }

  // De-dupe by key (blogPlay can be added twice in growth)
  const seen = new Set<string>()
  return plays.filter((p): p is Play => !!p && !seen.has(p.signalKey) && !!seen.add(p.signalKey))
}

// ── 4. Run: compute, store plays as signals, snapshot the diagnosis ──────────

export async function runDiagnosis(brandId: string): Promise<Diagnosis> {
  const metrics = await gatherMetrics(brandId)
  const { stage, summary } = findStage(metrics)
  const plays = buildPlays(stage, metrics)

  for (const p of plays) await openSignal(brandId, { ...p, source: 'diagnosis' })

  // Plays that no longer apply (stage changed, page fixed, post went out) are cleared
  const keep = new Set(plays.map((p) => p.signalKey))
  const stale = (await getOpenSignals(brandId))
    .filter((s) => s.source === 'diagnosis' && !keep.has(s.signalKey))
    .map((s) => s.signalKey)
  await clearSignals(brandId, 'diagnosis', stale)

  const diagnosis: Diagnosis = { stage, summary, computedAt: new Date().toISOString(), metrics }
  await saveSnapshot(brandId, 'diagnosis', diagnosis)
  return diagnosis
}
