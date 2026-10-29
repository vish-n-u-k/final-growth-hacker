// Saved state of the two AI Agents, one JSON document per brand and agent in signal_snapshots
// (no extra tables). Writes re-read the latest document and apply a change function, so a user
// approving an email while the agent runs doesn't lose either change.

import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { aiUsageLogs } from '@/lib/db/schema'
import { getSnapshot, saveSnapshot } from '@/lib/signals'
import { changedItems, saveSuggestions } from '@/lib/tool-suggestions'
import { agentsDemo } from './demo'
import type { ReplyIntent } from '@/lib/gmail/reply-check'

export const LEAD_KEY = 'agent:lead'
export const SEARCH_KEY = 'agent:search'
const USAGE_KEY = 'agent:usage'
const DEMO_KEY = 'agent:demo'
// Demo data lives under its own keys, so turning demo mode on or off never loses real leads
const leadKey = () => (agentsDemo() ? `${LEAD_KEY}:demo` : LEAD_KEY)
const searchKey = () => (agentsDemo() ? `${SEARCH_KEY}:demo` : SEARCH_KEY)

/** The brand's demo-mode switch on the agent pages (lib/agents/demo.ts). */
export async function readDemoSwitch(brandId: string): Promise<boolean> {
  return (await getSnapshot<{ on?: boolean }>(brandId, DEMO_KEY).catch(() => null))?.on === true
}
export async function saveDemoSwitch(brandId: string, on: boolean) {
  await saveSnapshot(brandId, DEMO_KEY, { on })
}

// ── Lead Agent ────────────────────────────────────────────────────────────────

export interface LeadSettings {
  enabled: boolean
  customer: string              // who the brand sells to, in plain words
  country: string               // ISO code (see LOCATION_CODES)
  // reviews / competitors: no longer used. Competitor reviews are Competitor Leads' job (lib/lead-finder)
  // companies = "Companies like your customers": websites found with DataForSEO, emails with Hunter
  sources: { reddit: boolean; reviews: boolean; local: boolean; companies: boolean }
  competitors: string[]
  localQuery: string            // e.g. "cafés in Pune"
  companyQuery: string          // who to look for among companies, e.g. "small fashion and beauty online stores"
  // GrowJin picked the sources from the brand (pickSources in lead-agent.ts); why = one line for the page
  picked?: { at: string; why: string } | null
  dailyLimit: number            // new first emails a day
  followUpDays: number[]        // days after the first email, e.g. [3, 7]
  skipEU: boolean               // don't cold-email leads in the EU
  mode: 'approve' | 'auto'      // auto = send 8+ leads without asking once 20 were approved
  // The ideal-customer card: drafted by the AI from the brand (and example customers), editable.
  // Every search, check and score reads it; changing it starts the search afresh.
  icp?: Icp | null
  // Off: the Lead Agent leaves the brand profile's audience, keywords and notes out of its prompts
  // and goes only by these search settings (the product description stays, to judge need and write)
  useBrand?: boolean
}

export type IcpKind = 'ecommerce' | 'saas' | 'local' | 'creator' | 'other'
export interface Icp {
  kind: IcpKind                 // what kind of business the buyers are: picks the sources
  who: string                   // who they are, in plain words
  marketing: string             // how they market today, e.g. "the founder posts on X and LinkedIn themselves"
  trades?: string[]             // kinds of business to search for, one at a time ("yoga studio", "candle maker")
  fit: string[]                 // signs of a good fit
  notFit: string[]              // not a fit, e.g. "has a marketing team or agency", "hires creators"
  examples: string[]            // domains of ideal customers the user gave
  by: 'ai' | 'user'
}

// own = added by the user from their own list (Email tab, "Add your own emails")
// company = a website found with DataForSEO ("Companies like your customers")
// profile = a seller's page on a marketplace or social network (Etsy shop, Instagram…), messaged by hand
export type LeadSource = 'reddit' | 'forum' | 'review' | 'local' | 'company' | 'own' | 'profile'
export type LeadStatus =
  | 'ready'          // draft waiting for the user's OK
  | 'needs_contact'  // good fit, no email found
  | 'queued'         // approved, waiting for tomorrow's sending limit
  | 'sent' | 'replied' | 'opted_out' | 'bounced'
  | 'posted'         // Reddit / forum reply posted by the user
  | 'skipped'

export interface Lead {
  id: string
  source: LeadSource
  foundAt: string
  title: string                 // post title, reviewer or business name
  url: string                   // where it was found
  snippet: string
  name?: string
  company?: string
  website?: string
  phone?: string
  rating?: number | null
  score: number
  why: string
  email?: string
  emailVerified?: boolean
  draft?: { subject: string; body: string }
  reply?: string                // drafted Reddit / forum reply
  status: LeadStatus
  approvedBy?: 'user' | 'auto'
  sentAt?: string
  threadId?: string
  followupsSent: number
  nextFollowUpAt?: string
  replyNote?: string
  replyIntent?: ReplyIntent
  repliedAt?: string
  handledAt?: string            // the user answered their reply (moves it to Done)
  listId?: string               // source 'own': the list it was added with (OwnList.id)
  queryId?: string              // source 'company': the search that found it (LeadQuery.id)
  skippedBy?: 'auto'            // skipped by the agent (no longer what you look for), not by the user
  error?: string
}

/** A website found but not checked yet. */
// profile: the platform ("Etsy") when `domain` is a seller page's link ("etsy.com/shop/candleco"), not a website
export interface WaitingSite { domain: string; name: string; about?: string; socials?: string[]; email?: string; from: string; queryId?: string; visits?: number | null; profile?: string }

/**
 * One question the Lead Agent asks DataForSEO for companies, picked with the playbook in
 * lead-playbook.ts, and how it has done so far (the next plan keeps the good ones, replaces the rest).
 * google = a Google search with operators; stores = the technology index (trade words + platforms);
 * lookalike = sites that rank for the same searches as one of your customers.
 */
export interface LeadQuery {
  id: string
  kind: 'google' | 'stores' | 'lookalike'
  q: string                     // google: the search; stores: trade words, comma separated; lookalike: a domain
  platforms?: string[]          // stores only
  why: string
  page: number                  // searches made with it (each asks for the next page)
  checked: number               // sites it found that the AI checked
  kept: number                  // of those, kept as leads
  empty: number                 // searches in a row that brought nothing new
  retired?: string              // why it was dropped (kept for the planner's history)
}
export interface LeadPlan { for: string; at: string; queries: LeadQuery[]; retired: LeadQuery[]; seeds?: { at: string; domains: string[] } }
/** A forum post found but not scored yet. */
export interface WaitingPost { source: LeadSource; url: string; title: string; snippet: string; name?: string }
/** A find the checks didn't keep, with the reason, shown under the leads ("Use anyway"). */
export interface MaybeLead {
  id: string
  source: LeadSource
  title: string
  url: string
  snippet: string
  website?: string
  name?: string
  email?: string
  why: string                   // the AI's sentence
  reason: string                // why it wasn't kept, in plain words
  score: number
  at: string
}

/** A list of people the user added themselves: one email for all, approved at once, sent over days. */
export interface OwnList {
  id: string
  name: string
  createdAt: string
  size: number
  about?: string                // the one line the email was written from
}

export interface LeadAgentData {
  settings: LeadSettings
  leads: Lead[]
  sentLog: string[]             // when first emails went out (daily limit)
  approvedCount: number         // first emails the user approved (auto mode unlocks at 20)
  rejected?: string[]           // ids of finds scored too low, so they aren't scored again
  // Finds not checked yet (a search brings back more than a run checks): "Show 10 more" uses these first
  waiting?: { sites: WaitingSite[]; posts: WaitingPost[] }
  // Checked but not kept (wrong trade, unclear need, a middling score), newest first, so the user can use one anyway
  maybe?: MaybeLead[]
  // Where the next search starts: each search moves on to the next page of websites and the next phrase
  cursor?: { sites: number; phrase: number }
  lists?: OwnList[]             // lists the user added (newest first)
  demo?: boolean                // made with demo data (lib/agents/demo.ts)
  queries?: { for: string; list: string[] }
  // companyQuery turned into DataForSEO search terms (written once per query)
  // platforms: online-store platforms to search (DataForSEO technology index); [] when the buyers aren't online stores
  companyFilters?: { for: string; keywords: string[]; headcount: string[]; platforms?: string[] }
  plan?: LeadPlan               // the DataForSEO questions for companies, and how each has done
  lastRunAt?: string
  lastRunSummary?: string
  lastError?: string | null
}

// ── Search Agent ──────────────────────────────────────────────────────────────

export interface SearchSettings {
  enabled: boolean
  country: string
  seeds: string[]               // starting keywords
  // Who chose the seeds: 'auto' = written and improved by the agent each research; 'user' = typed in
  // Settings, left alone. Missing = saved before this existed (copied from the brand profile): rewritten once.
  seedsBy?: 'auto' | 'user'
  questions: string[]           // buyer questions asked to the AI engines
}

export interface Topic {
  keyword: string
  volume: number
  difficulty: number | null
  cpc: number | null
  why: string
  status: 'picked' | 'writing' | 'drafted' | 'approved' | 'published' | 'skipped'
  pickedAt: string
  blogId?: string
  brief?: { top: string; beats: string[] }
  // improve = the site already ranks for it (#5-#20) or a page dropped: rewrite that page instead of a new post
  kind?: 'new' | 'improve'
  pageUrl?: string              // improve: the page to rewrite
  // What only the business knows, asked before writing (all optional)
  inputs?: { example?: string; number?: string; opinion?: string }
}

export interface RankRow { keyword: string; volume: number; rank: number; url: string }

// A keyword idea from the last research, with why it was or wasn't picked (Keywords tab)
export type IdeaVerdict = 'picked' | 'fit' | 'broad' | 'hard' | 'off' | 'unknown' | 'small' | 'branded' | 'unchecked'
export interface IdeaRow { keyword: string; volume: number; difficulty: number | null; cpc: number | null; verdict: IdeaVerdict }
export interface RankChange { keyword: string; before: number | null; now: number | null; url: string }

export interface AiAnswer {
  question: string
  engine: string
  mentioned: boolean
  position: number | null       // 1 = named first among the brands we track
  brands: string[]              // tracked brands named, in order
  citations: { domain: string; url: string; title: string }[]
  // The same question is asked more than once (answers vary): how often the brand was named
  samples?: number
  hits?: number
  error?: string
}

export interface AgentTask {
  key: string
  kind: 'write' | 'listing' | 'refresh' | 'fix' | 'ads'
  title: string
  detail: string
  url?: string
  status: 'open' | 'done' | 'dismissed'
  // 'Fix how AI describes you': new wording for the site, written on request (lib/agents/task-help.ts)
  copy?: { headline: string; meta: string; about: string }
}

export interface AdsTip { kind: 'try-ads' | 'wasted'; title: string; detail: string }

// A site that should link to (or list) the brand: it links to competitors, or lists them in a
// "best X" / "X alternatives" article, but leaves the brand out. Found weekly, pitched from Gmail.
export type LinkSource = 'gap' | 'list'
export type LinkStatus =
  | 'new'        // found, no email yet (contact page only)
  | 'ready'      // pitch drafted and an email found: waiting for the user
  | 'sent' | 'replied' | 'bounced' | 'opted_out'
  | 'won'        // the user got the link or the listing
  | 'skipped'

export interface LinkOpportunity {
  id: string                    // idOf(domain)
  domain: string
  source: LinkSource
  url: string                   // the page that links to / lists the competitors
  title: string
  authority: number | null      // 0-100 (DataForSEO domain rank / 10)
  names: string[]               // competitors it links to or lists
  why: string                   // one plain sentence
  email?: string
  emailVerified?: boolean
  contactName?: string
  pitch?: { subject: string; body: string }
  status: LinkStatus
  foundAt: string
  sentAt?: string
  threadId?: string
  followupSent?: boolean
  nextFollowUpAt?: string
  replyNote?: string
  replyIntent?: ReplyIntent
  error?: string
}

export interface SearchAgentData {
  settings: SearchSettings
  topics: Topic[]
  ranks: { at: string; rows: RankRow[] } | null
  ideas?: { at: string; rows: IdeaRow[] } | null   // keyword ideas from the last research
  rankChanges: RankChange[]
  answers: { at: string; items: AiAnswer[] } | null
  mentionHistory: { at: string; mentioned: number; asked: number }[]
  description: { text: string; issue: string | null; at: string } | null
  tasks: AgentTask[]
  adsTips: AdsTip[]
  links?: LinkOpportunity[]     // link opportunities (lib/agents/link-opportunities.ts)
  demo?: boolean                // made with demo data (lib/agents/demo.ts)
  lastResearchAt?: string
  lastWriteAt?: string
  lastLinksAt?: string
  linksError?: string | null     // problem on the last link-opportunities run
  lastError?: string | null
}

// ── Defaults ──────────────────────────────────────────────────────────────────

export function defaultCountry(websiteUrl: string | null | undefined): string {
  const host = (websiteUrl ?? '').replace(/^https?:\/\//, '').split('/')[0]
  if (/\.in$/i.test(host)) return 'IN'
  if (/\.(co\.)?uk$/i.test(host)) return 'GB'
  if (/\.ca$/i.test(host)) return 'CA'
  if (/\.(com\.)?au$/i.test(host)) return 'AU'
  return 'US'
}

export function defaultLeadData(brand: { websiteUrl?: string | null; targetAudience?: string | null }, competitorDomains: string[]): LeadAgentData {
  return {
    settings: {
      enabled: false,
      customer: brand.targetAudience ?? '',
      country: defaultCountry(brand.websiteUrl),
      sources: { reddit: true, reviews: false, local: true, companies: false },
      competitors: competitorDomains.slice(0, 3),
      localQuery: '',
      companyQuery: '',
      picked: null,
      dailyLimit: 15,
      followUpDays: [3, 7],
      skipEU: true,
      mode: 'approve',
    },
    leads: [],
    sentLog: [],
    approvedCount: 0,
  }
}

export function defaultSearchData(brand: { websiteUrl?: string | null; keywords?: string | null }): SearchAgentData {
  return {
    settings: {
      enabled: false,
      country: defaultCountry(brand.websiteUrl),
      // The profile's keywords describe the product, not what buyers type: the agent writes these
      seeds: [],
      seedsBy: 'auto',
      questions: [],
    },
    topics: [],
    ranks: null,
    rankChanges: [],
    answers: null,
    mentionHistory: [],
    description: null,
    tasks: [],
    adsTips: [],
  }
}

// ── Read / write ──────────────────────────────────────────────────────────────

export async function readLeadData(brandId: string): Promise<LeadAgentData | null> {
  const d = await getSnapshot<LeadAgentData>(brandId, leadKey())
  // Saved before "Companies like your customers" existed
  if (d?.settings) {
    d.settings.sources = { ...d.settings.sources, companies: d.settings.sources?.companies ?? false }
    d.settings.companyQuery ??= ''
  }
  return d
}

export async function readSearchData(brandId: string): Promise<SearchAgentData | null> {
  return getSnapshot<SearchAgentData>(brandId, searchKey())
}

/** Re-reads the saved document, applies `change` and saves it. Returns the saved document. */
export async function updateLeadData(brandId: string, fallback: () => LeadAgentData, change: (d: LeadAgentData) => void): Promise<LeadAgentData> {
  const d = (await readLeadData(brandId)) ?? fallback()
  const before = structuredClone(d.leads)
  change(d)
  // Every lead also gets its own row before the list below is trimmed, so none is ever lost
  if (!d.demo) {
    await saveSuggestions(brandId, 'lead_agent', changedItems(before, d.leads, l => l.id).map(l => ({
      kind: 'lead', externalId: l.id, title: l.name || l.company || l.title, payload: { ...l }, status: l.status,
    })))
  }
  // Keep the list bounded: drop the oldest finished leads first
  if (d.leads.length > 300) {
    const finished = new Set<LeadStatus>(['skipped', 'posted', 'bounced', 'opted_out'])
    const keep = d.leads.filter(l => !finished.has(l.status))
    const old = d.leads.filter(l => finished.has(l.status)).slice(0, Math.max(0, 300 - keep.length))
    d.leads = [...keep, ...old].slice(0, 300)
  }
  d.sentLog = d.sentLog.slice(-200)
  if (d.rejected) d.rejected = d.rejected.slice(-600)
  await saveSnapshot(brandId, leadKey(), d)
  return d
}

export async function updateSearchData(brandId: string, fallback: () => SearchAgentData, change: (d: SearchAgentData) => void): Promise<SearchAgentData> {
  const d = (await readSearchData(brandId)) ?? fallback()
  const before = structuredClone({ topics: d.topics, links: d.links, tasks: d.tasks })
  change(d)
  // Topics, link targets and to-dos also get their own rows before the lists below are trimmed
  if (!d.demo) {
    await saveSuggestions(brandId, 'search_agent', [
      ...changedItems(before.topics, d.topics, t => t.keyword).map(t => ({
        kind: 'topic' as const, externalId: `topic:${t.keyword.toLowerCase()}`, title: t.keyword, payload: { ...t }, status: t.status,
      })),
      ...changedItems(before.links, d.links, l => l.id).map(l => ({
        kind: 'link' as const, externalId: `link:${l.id}`, title: l.domain, payload: { ...l }, status: l.status,
      })),
      ...changedItems(before.tasks, d.tasks, t => t.key).map(t => ({
        kind: 'task' as const, externalId: `task:${t.key}`, title: t.title, payload: { ...t }, status: t.status,
      })),
    ])
  }
  d.topics = d.topics.slice(-60)
  // Keep the list bounded: skipped ones go first, then the oldest
  if (d.links && d.links.length > 150) d.links = [...d.links.filter(l => l.status !== 'skipped'), ...d.links.filter(l => l.status === 'skipped')].slice(0, 150)
  d.mentionHistory = d.mentionHistory.slice(-26)
  await saveSnapshot(brandId, searchKey(), d)
  return d
}

// ── Usage (what the agents spent on data, per month) ──────────────────────────
// One document per brand: a month's DataForSEO dollars and Hunter credits, split by tool and by
// DataForSEO API. The last 12 months are kept, so Settings can show the history.

// hunter = Hunter credits used (emails returned); hunterOut = Hunter said the credits are used up
export interface UsageMeter { dataforseo: number; hunter: number; apis: Record<string, number>; hunterOut?: boolean }
export const newMeter = (): UsageMeter => ({ dataforseo: 0, hunter: 0, apis: {} })

export type UsageTool = 'Lead Agent' | 'Search Agent' | 'Competitor Leads'
export interface UsageMonth {
  dataforseo: number
  hunter: number
  tools: Record<string, { dataforseo: number; hunter: number }>
  apis: Record<string, number>   // DataForSEO dollars per API ("Google Maps businesses", …)
  hunterOutAt?: string | null    // when Hunter last said its credits were used up (cleared once it finds emails again)
}
interface UsageDoc { months?: Record<string, UsageMonth>; month?: string; dataforseo?: number; hunter?: number }
const thisMonth = () => new Date().toISOString().slice(0, 7)
const round4 = (n: number) => Math.round(n * 10000) / 10000

/** Months from the document, oldest shape included (one month, totals only, no breakdown). */
function monthsOf(doc: UsageDoc | null): Record<string, UsageMonth> {
  if (!doc) return {}
  if (doc.months) return doc.months
  if (!doc.month) return {}
  return { [doc.month]: { dataforseo: doc.dataforseo ?? 0, hunter: doc.hunter ?? 0, tools: {}, apis: {} } }
}

export async function addUsage(brandId: string, m: UsageMeter, tool: UsageTool) {
  if (!m.dataforseo && !m.hunter && !m.hunterOut) return
  const months = monthsOf(await getSnapshot<UsageDoc>(brandId, USAGE_KEY))
  const key = thisMonth()
  const cur = months[key] ?? { dataforseo: 0, hunter: 0, tools: {}, apis: {} }
  cur.dataforseo = round4(cur.dataforseo + m.dataforseo)
  cur.hunter += m.hunter
  const t = cur.tools[tool] ?? { dataforseo: 0, hunter: 0 }
  cur.tools[tool] = { dataforseo: round4(t.dataforseo + m.dataforseo), hunter: t.hunter + m.hunter }
  // Costs the meter couldn't place on an API still count, under "Other"
  const placed = Object.values(m.apis).reduce((a, b) => a + b, 0)
  const apis = { ...m.apis, ...(m.dataforseo - placed > 0.00005 ? { Other: m.dataforseo - placed } : {}) }
  for (const [api, usd] of Object.entries(apis)) cur.apis[api] = round4((cur.apis[api] ?? 0) + usd)
  if (m.hunterOut) cur.hunterOutAt = new Date().toISOString()
  else if (m.hunter > 0) cur.hunterOutAt = null
  months[key] = cur
  const kept = Object.fromEntries(Object.entries(months).sort(([a], [b]) => b.localeCompare(a)).slice(0, 12))
  await saveSnapshot(brandId, USAGE_KEY, { months: kept })
}

export interface AgentUsage { dataforseoUsd: number; hunterCredits: number; hunterOut: boolean; aiUsd: number }

export async function readUsage(brandId: string): Promise<AgentUsage> {
  const monthStart = new Date(`${thisMonth()}-01T00:00:00Z`)
  const [doc, ai] = await Promise.all([
    getSnapshot<UsageDoc>(brandId, USAGE_KEY).catch(() => null),
    db.select({ usd: sql<number>`coalesce(sum(cast(${aiUsageLogs.costUsd} as numeric)), 0)` }).from(aiUsageLogs)
      .where(and(eq(aiUsageLogs.brandId, brandId), inArray(aiUsageLogs.moduleType, ['lead-agent', 'search-agent']), gte(aiUsageLogs.createdAt, monthStart)))
      .catch(() => [{ usd: 0 }]),
  ])
  const cur = monthsOf(doc)[thisMonth()]
  return { dataforseoUsd: cur?.dataforseo ?? 0, hunterCredits: cur?.hunter ?? 0, hunterOut: !!cur?.hunterOutAt, aiUsd: Number(ai[0]?.usd ?? 0) }
}

/** Hunter said its credits were used up this month, and hasn't found an email since. */
export async function hunterOutThisMonth(brandId: string): Promise<boolean> {
  const doc = await getSnapshot<UsageDoc>(brandId, USAGE_KEY).catch(() => null)
  return !!monthsOf(doc)[thisMonth()]?.hunterOutAt
}

/** Everything this account spent, for Settings → Usage: data per month plus AI per month and feature. */
export interface AccountCosts {
  months: { month: string; dataforseo: number; hunter: number; ai: number }[]   // newest first
  current: UsageMonth & { month: string; ai: number; aiByFeature: Record<string, number> }
}

export async function readAccountCosts(brandId: string): Promise<AccountCosts> {
  const key = thisMonth()
  const since = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 11, 1))
  const monthExpr = sql<string>`to_char(${aiUsageLogs.createdAt} at time zone 'UTC', 'YYYY-MM')`
  const [doc, ai] = await Promise.all([
    getSnapshot<UsageDoc>(brandId, USAGE_KEY).catch(() => null),
    db.select({ month: monthExpr, feature: aiUsageLogs.moduleType, usd: sql<number>`coalesce(sum(cast(${aiUsageLogs.costUsd} as numeric)), 0)` })
      .from(aiUsageLogs)
      .where(and(eq(aiUsageLogs.brandId, brandId), gte(aiUsageLogs.createdAt, since)))
      .groupBy(monthExpr, aiUsageLogs.moduleType)
      .catch(() => [] as { month: string; feature: string; usd: number }[]),
  ])
  const data = monthsOf(doc)
  const aiByMonth: Record<string, number> = {}
  const aiByFeature: Record<string, number> = {}
  for (const r of ai) {
    const usd = Number(r.usd) || 0
    aiByMonth[r.month] = (aiByMonth[r.month] ?? 0) + usd
    if (r.month === key) aiByFeature[r.feature] = (aiByFeature[r.feature] ?? 0) + usd
  }
  const months = [...new Set([key, ...Object.keys(data), ...Object.keys(aiByMonth)])]
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 12)
    .map(month => ({ month, dataforseo: data[month]?.dataforseo ?? 0, hunter: data[month]?.hunter ?? 0, ai: aiByMonth[month] ?? 0 }))
  const cur = data[key] ?? { dataforseo: 0, hunter: 0, tools: {}, apis: {} }
  return { months, current: { ...cur, month: key, ai: aiByMonth[key] ?? 0, aiByFeature } }
}
