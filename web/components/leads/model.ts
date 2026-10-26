// Lead Finder's one list (components/leads/LeadFinderHub): Lead Agent leads (lib/agents/store) and
// Competitor Leads reviewers (lib/lead-finder/saved) turned into the same kind of item, each with a
// source (the buttons at the top) and a stage (the board's lanes).

import type { Lead, LeadAgentData } from '@/lib/agents/store'
import type { Platform, SavedReview, SavedScan } from '@/lib/lead-finder/saved'
import { competitorLabel } from '@/components/lead-finder/ui'

export type Stage = 'todo' | 'contacted' | 'replied' | 'done' | 'nofit' | 'checking'
export type SourceType = 'maps' | 'companies' | 'rival' | 'forum' | 'own' | 'other'

export interface Source {
  id: string
  type: SourceType
  name: string
  glyph: string
  hue: number
  on: boolean
  // A competitor: where its reviews come from and its reviews, newest read first
  platform?: Platform
  competitor?: string
  scans?: SavedScan[]
}

export type Item =
  | { key: string; origin: 'agent'; src: string; stage: Stage; kind: 'email' | 'post'; name: string; fit: number; lead: Lead }
  | { key: string; origin: 'rival'; src: string; stage: Stage; kind: 'email'; name: string; fit: number; review: SavedReview }

export const GOOD_FIT = 7      // Competitor Leads: a good fit is 7+ out of 10
export const MAX_SCORED = 40   // unhappy reviewers checked per read (time and cost)

export const hueOf = (s: string) => [...s].reduce((a, c) => a + c.charCodeAt(0) * 7, 0) % 360
export const rivalId = (platform: Platform, competitor: string) => `rival:${platform}:${competitorLabel(competitor).toLowerCase()}`

/** 0–10 fit as 1–4 bars. */
export const bars = (score: number) => Math.max(1, Math.min(4, Math.round((score - 5) / 1.25)))

export function agentSrc(l: Lead): string {
  if (l.source === 'local') return 'maps'
  if (l.source === 'company') return 'companies'
  if (l.source === 'reddit') return 'reddit'
  if (l.source === 'forum') return 'hn'
  if (l.source === 'own') return 'own'
  return 'other'
}

export function agentStage(l: Lead): Stage {
  if (l.status === 'ready' || l.status === 'needs_contact') return 'todo'
  if (l.status === 'queued' || l.status === 'sent' || l.status === 'posted') return 'contacted'
  if (l.status === 'replied') return l.handledAt ? 'done' : 'replied'
  return 'done'
}

export function reviewStage(r: SavedReview): Stage | null {
  if (r.status === 'sent') return 'contacted'
  if (r.status === 'skipped') return 'done'
  if (r.rating > 3) return null           // happy customers are not leads
  if (r.fit === undefined) return 'checking'
  return r.fit >= GOOD_FIT ? 'todo' : 'nofit'
}

export const isForum = (l: Lead) => l.source === 'reddit' || l.source === 'forum'
// Businesses by their name, people from your own list by theirs
export const leadName = (l: Lead) => (isForum(l) ? l.title : l.source === 'own' ? l.name || l.company || l.title : l.company || l.name || l.title)

/** One reviewer per person across a competitor's reads: the one already acted on wins, then the newest. */
export function mergeReviews(lists: SavedReview[][]): SavedReview[] {
  const seen = new Map<string, SavedReview>()
  const weight = (r: SavedReview) => (r.status !== 'new' ? 3 : 0) + (r.fit !== undefined ? 1 : 0)
  for (const list of lists) {
    for (const r of list) {
      const k = r.reviewUrl || `${r.name}|${r.date ?? ''}`
      const had = seen.get(k)
      if (!had || weight(r) > weight(had)) seen.set(k, r)
    }
  }
  return [...seen.values()]
}

/** The buttons at the top: Google Maps, companies like your customers, each competitor, Reddit, Hacker News, your list. */
export function buildSources(data: LeadAgentData, scans: SavedScan[], competitors: string[], extra: { platform: Platform; competitor: string }[]): Source[] {
  const s = data.settings
  const out: Source[] = [
    { id: 'maps', type: 'maps', name: 'Google Maps', glyph: 'M', hue: 145, on: s.sources.local },
    { id: 'companies', type: 'companies', name: 'Companies', glyph: 'C', hue: 200, on: !!s.sources.companies },
  ]
  const rivals = new Map<string, Source>()
  const addRival = (platform: Platform, competitor: string, scan?: SavedScan) => {
    const id = rivalId(platform, competitor)
    const name = competitorLabel(competitor)
    const r = rivals.get(id) ?? { id, type: 'rival' as const, name, glyph: name.charAt(0).toUpperCase(), hue: hueOf(name), on: true, platform, competitor, scans: [] }
    if (scan) r.scans!.push(scan)
    rivals.set(id, r)
  }
  for (const scan of scans) addRival(scan.platform, scan.competitor, scan)
  for (const c of competitors) if (![...rivals.values()].some(r => r.name.toLowerCase() === competitorLabel(c).toLowerCase())) addRival('trustpilot', c)
  for (const e of extra) addRival(e.platform, e.competitor)
  // A steady order, so a competitor doesn't jump when it's read again
  out.push(...[...rivals.values()].sort((a, b) => a.name.localeCompare(b.name)))
  out.push({ id: 'reddit', type: 'forum', name: 'Reddit', glyph: 'r/', hue: 16, on: s.sources.reddit })
  out.push({ id: 'hn', type: 'forum', name: 'Hacker News', glyph: 'Y', hue: 34, on: s.sources.reddit })
  out.push({ id: 'own', type: 'own', name: 'Your list', glyph: '', hue: 145, on: true })
  if (data.leads.some(l => agentSrc(l) === 'other')) out.push({ id: 'other', type: 'other', name: 'Earlier finds', glyph: '·', hue: 220, on: true })
  return out
}

export function buildItems(data: LeadAgentData, reviewsBySource: Map<string, SavedReview[]>): Item[] {
  const items: Item[] = data.leads.map(l => ({
    key: `a:${l.id}`, origin: 'agent' as const, src: agentSrc(l), stage: agentStage(l), kind: isForum(l) ? 'post' as const : 'email' as const,
    name: leadName(l), fit: bars(l.score), lead: l,
  }))
  for (const [src, reviews] of reviewsBySource) {
    for (const r of reviews) {
      const stage = reviewStage(r)
      if (!stage) continue
      items.push({ key: `r:${r.id}`, origin: 'rival', src, stage, kind: 'email', name: r.name, fit: r.fit === undefined ? 0 : bars(r.fit), review: r })
    }
  }
  return items
}

/** Best fit first, then the newest. */
export function byFit(a: Item, b: Item): number {
  const score = (x: Item) => (x.origin === 'agent' ? x.lead.score : x.review.fit ?? 0)
  const when = (x: Item) => (x.origin === 'agent' ? x.lead.foundAt : x.review.date ?? '')
  return score(b) - score(a) || when(b).localeCompare(when(a))
}
