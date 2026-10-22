// Saved state of the two AI Agents, one JSON document per brand and agent in signal_snapshots
// (no extra tables). Writes re-read the latest document and apply a change function, so a user
// approving an email while the agent runs doesn't lose either change.

import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { aiUsageLogs } from '@/lib/db/schema'
import { getSnapshot, saveSnapshot } from '@/lib/signals'
import { changedItems, saveSuggestions } from '@/lib/tool-suggestions'

export const LEAD_KEY = 'agent:lead'
export const SEARCH_KEY = 'agent:search'
const USAGE_KEY = 'agent:usage'

// ── Lead Agent ────────────────────────────────────────────────────────────────

export interface LeadSettings {
  enabled: boolean
  customer: string              // who the brand sells to, in plain words
  country: string               // ISO code (see LOCATION_CODES)
  sources: { reddit: boolean; reviews: boolean; local: boolean }
  competitors: string[]         // domains whose unhappy Trustpilot reviewers become leads
  localQuery: string            // e.g. "cafés in Pune"
  dailyLimit: number            // new first emails a day
  followUpDays: number[]        // days after the first email, e.g. [3, 7]
  skipEU: boolean               // don't cold-email leads in the EU
  mode: 'approve' | 'auto'      // auto = send 8+ leads without asking once 20 were approved
}

export type LeadSource = 'reddit' | 'forum' | 'review' | 'local'
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
  repliedAt?: string
  error?: string
}

export interface LeadAgentData {
  settings: LeadSettings
  leads: Lead[]
  sentLog: string[]             // when first emails went out (daily limit)
  approvedCount: number         // first emails the user approved (auto mode unlocks at 20)
  rejected?: string[]           // ids of finds scored too low, so they aren't scored again
  demo?: boolean                // made with demo data (lib/agents/demo.ts)
  queries?: { for: string; list: string[] }
  lastRunAt?: string
  lastRunSummary?: string
  lastError?: string | null
}

// ── Search Agent ──────────────────────────────────────────────────────────────

export interface SearchSettings {
  enabled: boolean
  country: string
  seeds: string[]               // starting keywords
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
}

export interface RankRow { keyword: string; volume: number; rank: number; url: string }
export interface RankChange { keyword: string; before: number | null; now: number | null; url: string }

export interface AiAnswer {
  question: string
  engine: string
  mentioned: boolean
  position: number | null       // 1 = named first among the brands we track
  brands: string[]              // tracked brands named, in order
  citations: { domain: string; url: string; title: string }[]
  error?: string
}

export interface AgentTask {
  key: string
  kind: 'write' | 'listing' | 'refresh' | 'fix' | 'ads'
  title: string
  detail: string
  url?: string
  status: 'open' | 'done' | 'dismissed'
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
  error?: string
}

export interface SearchAgentData {
  settings: SearchSettings
  topics: Topic[]
  ranks: { at: string; rows: RankRow[] } | null
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
      sources: { reddit: true, reviews: competitorDomains.length > 0, local: false },
      competitors: competitorDomains.slice(0, 3),
      localQuery: '',
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
      seeds: (brand.keywords ?? '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 5),
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
  return getSnapshot<LeadAgentData>(brandId, LEAD_KEY)
}

export async function readSearchData(brandId: string): Promise<SearchAgentData | null> {
  return getSnapshot<SearchAgentData>(brandId, SEARCH_KEY)
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
  await saveSnapshot(brandId, LEAD_KEY, d)
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
  await saveSnapshot(brandId, SEARCH_KEY, d)
  return d
}

// ── Usage (what the agents spent on data this month) ──────────────────────────

export interface UsageMeter { dataforseo: number; hunter: number }
export const newMeter = (): UsageMeter => ({ dataforseo: 0, hunter: 0 })

interface UsageDoc { month: string; dataforseo: number; hunter: number }
const thisMonth = () => new Date().toISOString().slice(0, 7)

export async function addUsage(brandId: string, m: UsageMeter) {
  if (!m.dataforseo && !m.hunter) return
  const cur = await getSnapshot<UsageDoc>(brandId, USAGE_KEY)
  const base = cur && cur.month === thisMonth() ? cur : { month: thisMonth(), dataforseo: 0, hunter: 0 }
  await saveSnapshot(brandId, USAGE_KEY, {
    month: base.month,
    dataforseo: Math.round((base.dataforseo + m.dataforseo) * 10000) / 10000,
    hunter: base.hunter + m.hunter,
  })
}

export interface AgentUsage { dataforseoUsd: number; hunterLookups: number; aiUsd: number }

export async function readUsage(brandId: string): Promise<AgentUsage> {
  const monthStart = new Date(`${thisMonth()}-01T00:00:00Z`)
  const [doc, ai] = await Promise.all([
    getSnapshot<UsageDoc>(brandId, USAGE_KEY).catch(() => null),
    db.select({ usd: sql<number>`coalesce(sum(cast(${aiUsageLogs.costUsd} as numeric)), 0)` }).from(aiUsageLogs)
      .where(and(eq(aiUsageLogs.brandId, brandId), inArray(aiUsageLogs.moduleType, ['lead-agent', 'search-agent']), gte(aiUsageLogs.createdAt, monthStart)))
      .catch(() => [{ usd: 0 }]),
  ])
  const cur = doc && doc.month === thisMonth() ? doc : null
  return { dataforseoUsd: cur?.dataforseo ?? 0, hunterLookups: cur?.hunter ?? 0, aiUsd: Number(ai[0]?.usd ?? 0) }
}
