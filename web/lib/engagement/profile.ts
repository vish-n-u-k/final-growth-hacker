import { callAI, withAIContext } from '@/lib/ai/client'
import { brandBlock, loadBrandContext, parseJsonLoose } from '@/lib/agents/context'
import type { EngagementProfile } from './types'

// Turns what GrowJin knows about the brand into the search inputs: how its buyers describe their
// problem, where they talk (subreddits), the tags they use, and the competitors to watch. The
// buyer decides everything: a business brand's leads are owners and founders, a consumer brand's
// leads are people with the problem. Nothing here is reused from another brand.

const clean = (v: unknown, max: number, len = 80) =>
  (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string').map(x => x.trim().slice(0, len)).filter(Boolean).slice(0, max)

const handle = (s: string) => s.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/\/.*$/, '').trim().toLowerCase()
const IG_HANDLE = /^[a-z0-9._]{2,30}$/
const sub = (s: string) => s.replace(/^https?:\/\/(www\.)?reddit\.com\//i, '').replace(/^\/?r\//i, '').replace(/\/.*$/, '').trim()
const SUBREDDIT = /^[A-Za-z0-9_]{2,25}$/
const tag = (s: string) => s.replace(/^#/, '').replace(/\s+/g, '').toLowerCase()
const HASHTAG = /^[a-z0-9_]{3,40}$/

export async function buildProfile(brandId: string): Promise<EngagementProfile | null> {
  const b = await loadBrandContext(brandId)
  if (!b) return null
  const rivals = b.competitors.map(c => c.domain).filter(Boolean).slice(0, 5)

  const raw = await withAIContext({ brandId: b.id, moduleType: 'engagement-leads', websiteUrl: b.websiteUrl }, () => callAI({
    feature: 'engagement-leads',
    model: 'claude-sonnet-4-6',
    maxTokens: 900,
    system: 'You plan where a brand\'s real buyers talk on social media. Return only a raw JSON object. Never invent: leave a list empty rather than guess.',
    prompt: `${brandBlock(b)}
${rivals.length ? `Known competitors (websites): ${rivals.join(', ')}` : ''}

Work out who BUYS from this brand and where they talk. If the buyers are businesses, the leads are owners and founders. If they are consumers, the leads are people with the problem.

Return {"buyer":"...","problem":"...","phrases":[...],"subreddits":[...],"hashtags":[...],"competitors":[...],"exclude":[...]}
- buyer: who buys, in under 15 words.
- problem: what they struggle with, in under 15 words.
- phrases: 5-8 phrases the BUYER would type or say about that problem, in their own words (for example "what to post on social media for my business"). Not the brand's marketing words.
- subreddits: 5-8 real subreddit names (no r/) where the buyer asks for help. Only ones you are sure exist.
- hashtags: 5-8 Instagram tags the BUYER uses (not tags of the brand's own industry), no # sign, one word each.
- competitors: Instagram handles of competitors you are sure about (no @). [] if not sure.
- exclude: 3-6 kinds of accounts to leave out, in a few words each (for example "marketing agencies", "freelancers who sell the same service", "resellers").`,
  }))

  const j = parseJsonLoose<Record<string, unknown>>(raw, 'object')
  if (!j) return null
  const p: EngagementProfile = {
    buyer: typeof j.buyer === 'string' ? j.buyer.trim().slice(0, 160) : '',
    problem: typeof j.problem === 'string' ? j.problem.trim().slice(0, 160) : '',
    phrases: clean(j.phrases, 8, 120),
    subreddits: [...new Set(clean(j.subreddits, 8, 60).map(sub).filter(s => SUBREDDIT.test(s)))],
    hashtags: [...new Set(clean(j.hashtags, 8, 50).map(tag).filter(t => HASHTAG.test(t)))],
    competitors: [...new Set(clean(j.competitors, 5, 80).map(handle).filter(h => IG_HANDLE.test(h)))],
    exclude: clean(j.exclude, 6, 60),
    by: 'ai',
    at: new Date().toISOString(),
  }
  if (!p.phrases.length && !p.hashtags.length && !p.competitors.length) return null
  return p
}

/** What the user typed in the settings, cleaned the same way. */
export function cleanProfile(input: Partial<Record<keyof EngagementProfile, unknown>>, before: EngagementProfile | null): EngagementProfile {
  const lines = (v: unknown) => (typeof v === 'string' ? v.split(/[\n,]/) : Array.isArray(v) ? v : []).map(x => String(x).trim()).filter(Boolean)
  return {
    buyer: typeof input.buyer === 'string' ? input.buyer.trim().slice(0, 160) : before?.buyer ?? '',
    problem: typeof input.problem === 'string' ? input.problem.trim().slice(0, 160) : before?.problem ?? '',
    phrases: lines(input.phrases).map(x => x.slice(0, 120)).slice(0, 8),
    subreddits: [...new Set(lines(input.subreddits).map(sub).filter(s => SUBREDDIT.test(s)))].slice(0, 8),
    hashtags: [...new Set(lines(input.hashtags).map(tag).filter(t => HASHTAG.test(t)))].slice(0, 8),
    competitors: [...new Set(lines(input.competitors).map(handle).filter(h => IG_HANDLE.test(h)))].slice(0, 5),
    exclude: lines(input.exclude).map(x => x.slice(0, 60)).slice(0, 6),
    by: 'user',
    at: new Date().toISOString(),
  }
}
