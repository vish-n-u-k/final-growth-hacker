// The Search Agent. Two steps, so each fits in one request:
//   research (weekly): keyword ideas, where the site ranks and what moved, what ChatGPT /
//     Perplexity / Gemini answer to buyer questions (and whether they name the brand), how
//     ChatGPT describes the brand, Google Ads waste. Picks up to 3 blog topics the site can win
//     and turns the gaps into tasks (Today cards).
//   write (the day after): reads today's top 3 Google results for the next topic and writes a
//     draft that covers more, saved as a blog draft for the user to read and add to the site.
//   links (weekly, on another day): sites that link to or list competitors but not the brand,
//     each with a contact and a drafted pitch (lib/agents/link-opportunities.ts).

import * as cheerio from 'cheerio'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { brandBlogs, brandIntegrations } from '@/lib/db/schema'
import { fetchGscQueryPages } from '@/lib/modules/seo/keyword-fetchers'
import { callAI, withAIContext } from '@/lib/ai/client'
import { openSignal, clearSignals } from '@/lib/signals'
import { fetchHtml } from '@/lib/lead-finder/reviews'
import { slugify } from '@/lib/frekto/blog'
import {
  AI_ENGINES, ENGINE_LABEL, aiAnswer, googleAiOverview, searchDataReady, googleResults, keywordIdeas, rankedKeywords,
  type AiEngine, type KeywordIdea, type RankedKeyword,
} from './dataforseo'
import { readGoogleAdsCreds, wastedSearchTerms } from './google-ads'
import { agentsDemo, demoWastedSpend, setDemoContext } from './demo'
import { Progress } from './progress'
import {
  addUsage, defaultSearchData, newMeter, readSearchData, updateSearchData,
  type AdsTip, type AgentTask, type IdeaRow, type IdeaVerdict, type AiAnswer, type RankChange, type SearchAgentData, type Topic, type LinkOpportunity, type SitePage, type SiteChange,
} from './store'
import { listingDomain } from './task-kinds'
import { brandBlock, domainOf, idOf, isNamedRival, loadBrandContext, namedRivals, parseJsonLoose, type BrandContext } from './context'
import { pitchable, runLinkFollowUps, runLinkOpportunities } from './link-opportunities'
import { costNote } from './services'
import { ensureTracked, kwKey, recordSnapshot } from '@/lib/search-hub/verdict'
import { refreshSitePages } from '@/lib/search-hub/pages'

export const searchFallback = (b: BrandContext) => () => defaultSearchData(b)

/**
 * A cited site worth a "Get mentioned on" to-do: someone there can be asked to add the brand. Not
 * the brand, not a rival's own site or blog (blog.hootsuite.com won't list Frekto), not a platform
 * (instagram.com). Reddit stays: its to-do is joining the threads, not pitching an editor.
 */
function citableSite(dom: string, b: BrandContext, named: Set<string>): boolean {
  return dom !== b.domain && !dom.endsWith(`.${b.domain}`) && (isReddit(dom) || (pitchable(dom, b.competitors) && !isNamedRival(dom, named)))
}
const isReddit = (dom: string) => /(^|\.)reddit\.com$/.test(dom)
// A page the brand can be added to lists or compares options ("9 best AI tools…", "X vs Y");
// a how-to such as "How to Use Canva AI for Presentations" has no list to join
const LISTY = /\b(best|top|\d+|alternatives?|vs\.?|versus|compared|comparison|reviews?|tools|apps|software|platforms)\b/i
const listyCitation = (dom: string, title: string) => isReddit(dom) || !title.trim() || LISTY.test(title)

/**
 * Which of these sites belong to a company selling something like the brand (blog.hootsuite.com,
 * socialbee.com for Frekto), when the saved competitor list doesn't name them. One fast AI call for
 * the domains not decided before; answers are kept in `rivalCheck`, so each is asked once.
 */
async function rivalSites(b: BrandContext, d: SearchAgentData, domains: string[]): Promise<{ rivals: Set<string>; learned: Record<string, boolean> }> {
  const known = d.rivalCheck ?? {}
  const ask = [...new Set(domains)].filter(dom => !(dom in known) && !isReddit(dom)).slice(0, 30)
  const learned: Record<string, boolean> = {}
  if (ask.length && !agentsDemo()) {
    const raw = await withAIContext({ brandId: b.id, moduleType: 'search-agent', websiteUrl: b.websiteUrl }, () => callAI({
      feature: 'search-agent',
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 600,
      system: 'You know software companies and websites. Return only a raw JSON array.',
      prompt: `${brandBlock(b)}

Which of these websites belong to a company that sells a product competing with ${b.name} (the same kind of product, for the same buyers)? A company's blog or help site counts as that company. Publishers, magazines, social networks, directories, review sites and tools of a different kind are NOT competitors.

${ask.join('\n')}

Return the competitor domains exactly as written, e.g. ["example.com"], or [].`,
    })).catch(() => null)
    const arr = raw === null ? null : parseJsonLoose<string[]>(raw, 'array')
    if (Array.isArray(arr)) {
      const yes = new Set(arr.map(x => String(x).trim().toLowerCase()))
      for (const dom of ask) learned[dom] = yes.has(dom)
    }
  }
  const all = { ...known, ...learned }
  return { rivals: new Set(domains.filter(dom => all[dom])), learned }
}

/**
 * Suggestions saved before the checks above existed: open "Get mentioned on" to-dos and unsent
 * pitches for platforms or rivals' sites are removed (with their Today cards). Writes only when
 * something has to go or a site was newly checked.
 */
export async function tidySearchData(brandId: string, b: BrandContext, d: SearchAgentData): Promise<SearchAgentData> {
  const named = namedRivals((d.answers?.items ?? []).filter(a => !a.error), b.name)
  const openListing = d.tasks.filter(t => t.kind === 'listing' && t.status === 'open')
  const unsent = (l: LinkOpportunity) => l.status === 'new' || l.status === 'ready'
  const { rivals, learned } = await rivalSites(b, d, [...openListing.map(listingDomain), ...(d.links ?? []).filter(unsent).map(l => l.domain)])
  const badTask = (t: AgentTask) => {
    if (t.kind !== 'listing' || t.status !== 'open') return false
    const dom = listingDomain(t)
    const example = t.detail.match(/Example: "(.*)"\.?$/)?.[1]
    return !citableSite(dom, b, named) || rivals.has(dom) || (example !== undefined && !listyCitation(dom, example))
  }
  const badLink = (l: LinkOpportunity) => unsent(l) && (!pitchable(l.domain, b.competitors) || isNamedRival(l.domain, named) || rivals.has(l.domain))
  const tasks = d.tasks.filter(badTask).map(t => t.key)
  if (!tasks.length && !(d.links ?? []).some(badLink) && !Object.keys(learned).length) return d
  const out = await updateSearchData(brandId, searchFallback(b), x => {
    x.tasks = x.tasks.filter(t => !badTask(t))
    x.links = (x.links ?? []).filter(l => !badLink(l))
    x.rivalCheck = { ...(x.rivalCheck ?? {}), ...learned }
  })
  if (tasks.length) await clearSignals(brandId, 'search-agent', tasks).catch(() => {})
  if (!(out.links ?? []).some(l => l.status === 'ready')) await clearSignals(brandId, 'search-agent', ['links']).catch(() => {})
  return out
}

/** tidySearchData for a brand by id (Today and other pages that don't have its context loaded). */
export async function tidySearchFor(brandId: string): Promise<void> {
  const d = await readSearchData(brandId)
  if (!d) return
  const b = await loadBrandContext(brandId)
  if (b) await tidySearchData(brandId, b, d)
}

// Each question is asked to 3 AI engines, the costliest part of research. Answers vary from one ask
// to the next, so fewer questions are asked more times: AGENTS_AI_QUESTIONS (default 5) questions,
// each AGENTS_AI_REPEATS times (default 2) per engine. Same cost as 10 questions asked once.
const aiQuestionLimit = () => Math.max(1, Math.min(15, Number(process.env.AGENTS_AI_QUESTIONS) || 5))
const aiRepeats = () => Math.max(1, Math.min(4, Number(process.env.AGENTS_AI_REPEATS) || 2))
const WEEK = 6.5 * 86_400_000

/** This week's buyer questions: `n` of them, moving on by `n` each research so every question gets asked. */
function rotate(questions: string[], n: number, round: number): string[] {
  if (questions.length <= n) return questions
  const start = (round * n) % questions.length
  return Array.from({ length: n }, (_, i) => questions[(start + i) % questions.length])
}

// ── Setup the agent needs once ────────────────────────────────────────────────

async function ensureSeedsAndQuestions(b: BrandContext, d: SearchAgentData) {
  // Seeds saved before seedsBy existed were copied from the brand profile: written afresh once
  const writeSeeds = d.settings.seedsBy !== 'user' && (!d.settings.seeds.length || !d.settings.seedsBy)
  if (!writeSeeds && d.settings.questions.length) return
  const raw = await callAI({
    feature: 'search-agent',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 900,
    system: 'You help a small business with search. Return only a raw JSON object.',
    prompt: `${brandBlock(b)}

Return {"seeds":[...],"questions":[...]}:
- seeds: 5 searches a buyer types into Google to find a product like ${b.name}. 2-5 words each, in the buyer's plain words: the kind of tool plus what it makes or who it's for (e.g. "ai instagram post generator", "social media post maker for small business"). Not the site's own slogans or category words, not one broad word like "marketing", never a brand name.
- questions: 10 questions a buyer would ask ChatGPT when choosing a product like this, e.g. "What's the best tool for ...?", "Which app can ... for a small business?". Never mention ${b.name} or any brand.`,
  })
  const j = parseJsonLoose<{ seeds?: string[]; questions?: string[] }>(raw, 'object') ?? {}
  const seeds = (j.seeds ?? []).filter(s => typeof s === 'string' && s.trim()).map(s => s.trim().toLowerCase()).slice(0, 5)
  if (writeSeeds && seeds.length) { d.settings.seeds = seeds; d.settings.seedsBy = 'auto' }
  if (!d.settings.questions.length) d.settings.questions = (j.questions ?? []).filter(s => typeof s === 'string').slice(0, 10)
}

// ── AI answers ────────────────────────────────────────────────────────────────

function firstIndex(text: string, names: string[]): number {
  const t = text.toLowerCase()
  let best = -1
  for (const n of names) {
    const k = n.toLowerCase().trim()
    if (k.length < 3) continue
    const re = new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`)
    const m = re.exec(t)
    if (m && (best === -1 || m.index < best)) best = m.index
  }
  return best
}

function analyseAnswer(question: string, engine: AiEngine, text: string, citations: { url: string; title: string }[], b: BrandContext): AiAnswer {
  const tracked = [
    { name: b.name, keys: [b.name, b.domain] },
    ...b.competitors.map(c => ({ name: c.name, keys: [c.name, c.domain] })),
  ]
  const found = tracked
    .map(x => ({ name: x.name, at: firstIndex(text, x.keys) }))
    .filter(x => x.at >= 0)
    .sort((x, y) => x.at - y.at)
  const pos = found.findIndex(x => x.name === b.name)
  return {
    question, engine,
    mentioned: pos >= 0,
    position: pos >= 0 ? pos + 1 : null,
    brands: found.map(x => x.name),
    citations: citations.slice(0, 12).map(c => ({ domain: domainOf(c.url), url: c.url, title: c.title })),
  }
}

type Raw = { question: string; engine: string; text: string; citations: { url: string; title: string }[]; error?: string }

/**
 * Which tracked brands each answer names, in order, read by a fast AI model: it catches spelling
 * variants ("Frekto AI", "frekto.ai") and doesn't take ordinary words for short brand names. Also
 * lists the other products it recommends, so a rival missing from the competitor list still counts.
 * Returns null on failure (the text search is used instead).
 */
async function namedBrands(b: BrandContext, raws: Raw[]): Promise<{ brands: string[]; others: string[] }[] | null> {
  const tracked = [b.name, ...b.competitors.map(c => c.name)]
  const list = raws.map((r, i) => `[${i}]\n${r.text.slice(0, 1500)}`).join('\n\n')
  const raw = await callAI({
    feature: 'search-agent',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 2500,
    system: 'You read AI assistant answers and list which brands they recommend or name. Return only a raw JSON array.',
    prompt: `Brands we track: ${tracked.map(t => `"${t}"`).join(', ')}
(${b.name}'s website is ${b.domain}; ${b.competitors.map(c => `${c.name} is ${c.domain}`).join('; ') || 'no competitors set'}.)

For each answer below, list which of the tracked brands it names, in the order they first appear. Count a brand when it's named in any form (a spelling variant, with or without "AI" or ".com", its website). Don't count an ordinary word that happens to match a short brand name.
Also list, as "others", up to 10 other products or tools the answer recommends as options of the same kind (their plain names, e.g. "Hootsuite"), not the tracked ones, and not platforms or publishers it merely cites (e.g. Instagram, Zapier's blog).

${list}

Return [{"i":0,"brands":["..."],"others":["..."]}] using the tracked names exactly as written above.`,
  }).catch(() => null)
  const arr = raw === null ? null : parseJsonLoose<{ i: number; brands?: string[]; others?: unknown }[]>(raw, 'array')
  if (!Array.isArray(arr)) return null
  const out = raws.map(() => ({ brands: [] as string[], others: [] as string[] }))
  const known = new Map(tracked.map(t => [t.toLowerCase(), t]))
  for (const x of arr) {
    if (typeof x?.i !== 'number' || !out[x.i]) continue
    out[x.i] = {
      brands: [...new Set((x.brands ?? []).map(n => known.get(String(n).toLowerCase())).filter((n): n is string => !!n))],
      others: Array.isArray(x.others) ? [...new Set(x.others.map(n => String(n).trim().slice(0, 40)).filter(n => n && !known.has(n.toLowerCase())))].slice(0, 10) : [],
    }
  }
  return out
}

/**
 * Asks every question to every engine `aiRepeats()` times, plus Google's AI Overview for each
 * starting keyword, then merges the repeats: one answer per question and engine, with how many of
 * its samples named the brand (named = half or more).
 */
async function askEngines(b: BrandContext, questions: string[], seeds: string[], country: string, meter: ReturnType<typeof newMeter>): Promise<AiAnswer[]> {
  const jobs = questions.flatMap(q => AI_ENGINES.flatMap(engine => Array.from({ length: aiRepeats() }, () => ({ q, engine: engine as string }))))
  const [settled, overviews] = await Promise.all([
    Promise.allSettled(jobs.map(j => aiAnswer(j.engine as AiEngine, j.q, meter))),
    Promise.allSettled(seeds.slice(0, 8).map(k => googleAiOverview(k, country, meter))),
  ])
  const raws: Raw[] = [
    ...settled.map((r, i) => r.status === 'fulfilled'
      ? { question: jobs[i].q, engine: jobs[i].engine, text: r.value.text, citations: r.value.citations }
      : { question: jobs[i].q, engine: jobs[i].engine, text: '', citations: [], error: r.reason instanceof Error ? r.reason.message : 'failed' }),
    // Google's AI Overview, for the searches themselves (only when Google shows one)
    ...overviews.flatMap((r, i) => (r.status === 'fulfilled' && r.value ? [{ question: seeds[i], engine: 'google_ai', text: r.value.text, citations: r.value.citations }] : [])),
  ]
  const ok = raws.filter(r => !r.error && r.text)
  const named = ok.length ? await namedBrands(b, ok) : null
  const one = (r: Raw): AiAnswer => {
    if (r.error || !r.text) return { question: r.question, engine: r.engine, mentioned: false, position: null, brands: [], citations: [], error: r.error ?? 'empty answer' }
    const base = analyseAnswer(r.question, r.engine as AiEngine, r.text, r.citations, b)
    const found = named?.[ok.indexOf(r)]
    if (!found) return base
    const pos = found.brands.indexOf(b.name)
    return { ...base, brands: found.brands, others: found.others, mentioned: pos >= 0, position: pos >= 0 ? pos + 1 : null }
  }
  // Merge the repeats of each question and engine
  const groups = new Map<string, AiAnswer[]>()
  for (const r of raws) {
    const k = `${r.engine}|${r.question}`
    groups.set(k, [...(groups.get(k) ?? []), one(r)])
  }
  return [...groups.values()].map(list => {
    const good = list.filter(a => !a.error)
    if (!good.length) return list[0]
    const hits = good.filter(a => a.mentioned).length
    const positions = good.map(a => a.position).filter((p): p is number => p !== null)
    const seen = new Set<string>()
    return {
      question: good[0].question, engine: good[0].engine,
      mentioned: hits * 2 >= good.length && hits > 0,
      position: positions.length ? Math.min(...positions) : null,
      brands: [...new Set(good.flatMap(a => a.brands))],
      others: [...new Set(good.flatMap(a => a.others ?? []))].slice(0, 15),
      citations: good.flatMap(a => a.citations).filter(c => !seen.has(c.url) && seen.add(c.url)).slice(0, 15),
      samples: good.length, hits,
    }
  })
}

/**
 * How AI assistants describe the brand. Asks ChatGPT and Perplexity (one answer each is too easy to
 * misread) and only flags a problem both answers share, or that the one answer that came back has.
 */
async function checkDescription(b: BrandContext, meter: ReturnType<typeof newMeter>): Promise<SearchAgentData['description']> {
  const at = new Date().toISOString()
  const engines: AiEngine[] = ['chat_gpt', 'perplexity']
  const settled = await Promise.allSettled(engines.map(e => aiAnswer(e, `What is ${b.name} (${b.domain})? Answer in two sentences.`, meter)))
  const got = settled.flatMap((r, i) => r.status === 'fulfilled' && r.value.text.trim() ? [{ engine: engines[i], text: r.value.text.trim() }] : [])
  if (!got.length) return null
  // The text shown on the page: ChatGPT's when it answered
  const text = got[0].text
  const knows = got.filter(g => firstIndex(g.text, [b.name, b.domain]) !== -1)
  if (!knows.length) {
    return { text, issue: `${got.map(g => ENGINE_LABEL[g.engine]).join(' and ')} ${got.length === 1 ? "doesn't" : "don't"} seem to know ${b.name} yet.`, at }
  }
  const verdict = await callAI({
    feature: 'search-agent',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 150,
    system: 'You check whether AI assistants describe a business correctly. Be brief.',
    prompt: `How AI assistants describe the brand:
${knows.map(g => `${ENGINE_LABEL[g.engine]}:\n"""${g.text.slice(0, 1000)}"""`).join('\n\n')}

What the brand says it is (its own profile; it may itself be out of date, so only flag clear contradictions about what the product does or who it's for):
${brandBlock(b)}

If ${knows.length > 1 ? 'both descriptions are' : 'the description is'} wrong, vague or outdated in the same way that would cost customers, reply with ONE plain sentence saying what's wrong (e.g. "ChatGPT calls you a design tool, but you write and schedule posts."). If ${knows.length > 1 ? 'at least one is' : 'it is'} broadly right, reply exactly OK.`,
  }).catch(() => 'OK')
  return { text, issue: /^\s*OK\.?\s*$/i.test(verdict) ? null : verdict.trim().slice(0, 300), at }
}

// ── Topics ────────────────────────────────────────────────────────────────────

// DataForSEO gives 0 when it has no score: that is unknown, not easy
const difficultyLabel = (d: number | null) => !d ? 'difficulty unknown' : d <= 29 ? `easy (${d})` : d <= 49 ? `medium (${d})` : `hard (${d})`

// Above this, an idea is a broad head term ("online advertising platform"): a small site can't win
// it and Labs' difficulty for it is unreliable. Searches the site already ranks for are exempt.
const MAX_IDEA_VOLUME = 20_000

/** Claude keeps only the keywords a buyer of this brand would type. On failure, keeps them all. */
async function relevantKeywords(b: BrandContext, keywords: string[]): Promise<Set<string>> {
  if (!keywords.length) return new Set()
  const raw = await callAI({
    feature: 'search-agent',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 600,
    system: 'You pick blog topics for a small business. Return only a raw JSON array of strings.',
    prompt: `${brandBlock(b)}

Google searches:
${keywords.map(k => `- ${k}`).join('\n')}

Return the searches, copied exactly, where the person searching could become a customer of ${b.name}: they want what ${b.name} offers, or a close alternative to it. Leave out searches that are too broad (a whole industry) or about something else (an agency, a job, a different kind of product). Return [] if none fit.`,
  }).catch(() => null)
  const picked = raw === null ? null : parseJsonLoose<unknown[]>(raw, 'array')
  if (!Array.isArray(picked)) return new Set(keywords)
  const wanted = new Set(picked.filter((x): x is string => typeof x === 'string').map(x => x.toLowerCase().trim()))
  return new Set(keywords.filter(k => wanted.has(k.toLowerCase())))
}

async function pickTopics(b: BrandContext, d: SearchAgentData, ideas: KeywordIdea[], ranked: RankedKeyword[]): Promise<{ picks: Topic[]; checked: Set<string>; fits: Set<string> }> {
  const brandWords = [b.name.toLowerCase(), b.domain.split('.')[0]]
  const used = new Set(d.topics.map(t => t.keyword.toLowerCase()))
  const isBranded = (k: string) => brandWords.some(w => w.length > 2 && k.includes(w))
  const now = new Date().toISOString()
  type C = Topic & { score: number }
  const cands: C[] = []
  for (const r of ranked) {
    if (r.rank < 5 || r.rank > 20 || r.volume < 30 || isBranded(r.keyword)) continue
    const idea = ideas.find(i => i.keyword === r.keyword)
    // Improve the page that already ranks: a new post on the same search would compete with it
    let path = r.url
    try { path = new URL(r.url).pathname || '/' } catch { /* keep the url */ }
    cands.push({
      keyword: r.keyword, volume: r.volume, difficulty: idea?.difficulty ?? null, cpc: idea?.cpc ?? null,
      why: `Your page ${path === '/' ? '(your homepage)' : path} ranks #${r.rank}. Improving it can reach the top 3.`, status: 'picked', pickedAt: now,
      kind: 'improve', pageUrl: r.url,
      score: (r.volume / 10) * 2,
    })
  }
  for (const i of ideas) {
    if (i.volume < 50 || i.volume > MAX_IDEA_VOLUME || i.difficulty === null || i.difficulty > 40 || isBranded(i.keyword)) continue
    cands.push({
      keyword: i.keyword, volume: i.volume, difficulty: i.difficulty, cpc: i.cpc,
      why: `${i.volume.toLocaleString('en-US')} searches a month, ${difficultyLabel(i.difficulty)}${i.intent === 'commercial' ? ', people comparing options' : ''}.`,
      status: 'picked', pickedAt: now, kind: 'new', score: i.volume / (i.difficulty + 10),
    })
  }
  const words = (k: string) => new Set(k.toLowerCase().split(/\s+/))
  const similar = (x: string, y: string) => {
    const a = words(x), c = words(y)
    const shared = [...a].filter(w => c.has(w)).length
    return shared / Math.min(a.size, c.size) >= 0.75
  }
  const open = d.topics.filter(t => t.status === 'picked' || t.status === 'writing').length
  if (open >= 3) return { picks: [], checked: new Set(), fits: new Set() }
  // The best 20 unused candidates go to Claude for a fit check
  const short = cands.sort((x, y) => y.score - x.score).filter(c => !used.has(c.keyword.toLowerCase())).slice(0, 20)
  const checked = new Set(short.map(c => c.keyword))
  const fits = await relevantKeywords(b, [...checked])
  const out: Topic[] = []
  for (const c of short) {
    if (out.length >= 3 - open) break
    if (!fits.has(c.keyword)) continue
    if ([...d.topics.map(t => t.keyword), ...out.map(t => t.keyword)].some(k => similar(k, c.keyword))) continue
    const { score: _score, ...topic } = c
    out.push(topic)
  }
  return { picks: out, checked, fits }
}

/** The top 100 ideas, each with why it was or wasn't picked, in the same order as pickTopics' checks. */
function ideaRows(b: BrandContext, topics: Topic[], ideas: KeywordIdea[], checked: Set<string>, fits: Set<string>): IdeaRow[] {
  const brandWords = [b.name.toLowerCase(), b.domain.split('.')[0]]
  const topicWords = new Set(topics.filter(t => t.status !== 'skipped').map(t => t.keyword.toLowerCase()))
  const verdict = (i: KeywordIdea): IdeaVerdict =>
    topicWords.has(i.keyword.toLowerCase()) ? 'picked'
      : brandWords.some(w => w.length > 2 && i.keyword.includes(w)) ? 'branded'
      : i.volume < 50 ? 'small'
      : i.volume > MAX_IDEA_VOLUME ? 'broad'
      : i.difficulty === null ? 'unknown'
      : i.difficulty > 40 ? 'hard'
      : !checked.has(i.keyword) ? 'unchecked'
      : fits.has(i.keyword) ? 'fit' : 'off'
  return ideas.slice(0, 100).map(i => ({ keyword: i.keyword, volume: i.volume, difficulty: i.difficulty, cpc: i.cpc, verdict: verdict(i) }))
}

/**
 * The agent's own seeds get better each research: a seed with too few or too many searches, or that
 * Claude says isn't a buyer's search, is swapped for the best good-fit idea (at most 2 a week, so the
 * list stays broad). One fit check covers the seeds and the candidates. Typed-in seeds are left alone.
 */
async function reviewSeeds(b: BrandContext, seeds: string[], ideas: KeywordIdea[]): Promise<{ seeds: string[]; dropped: string[] }> {
  if (!seeds.length || !ideas.length) return { seeds, dropped: [] }
  const brandWords = [b.name.toLowerCase(), b.domain.split('.')[0]]
  const volume = new Map(ideas.map(i => [i.keyword.toLowerCase(), i.volume]))
  const words = (k: string) => new Set(k.toLowerCase().split(/\s+/))
  const similar = (x: string, y: string) => {
    const a = words(x), c = words(y)
    return [...a].filter(w => c.has(w)).length / Math.min(a.size, c.size) >= 0.75
  }
  const cands = ideas
    .filter(i => i.volume >= 50 && i.volume <= MAX_IDEA_VOLUME && i.difficulty !== null && i.difficulty <= 40
      && !brandWords.some(w => w.length > 2 && i.keyword.includes(w)) && !seeds.some(x => similar(x, i.keyword)))
    .sort((x, y) => y.volume / (y.difficulty! + 10) - x.volume / (x.difficulty! + 10))
    .slice(0, 15)
    .map(i => i.keyword)
  const fits = await relevantKeywords(b, [...seeds, ...cands])
  // A seed with no search data is kept unless the fit check says no: DataForSEO may just not list it
  const weak = seeds.filter(x => {
    const v = volume.get(x.toLowerCase())
    return !fits.has(x) || (v !== undefined && (v < 50 || v > MAX_IDEA_VOLUME))
  })
  const out = [...seeds]
  const dropped: string[] = []
  for (const w of weak.slice(0, 2)) {
    const next = cands.find(c => fits.has(c) && !out.some(x => similar(x, c)))
    if (!next) break
    out[out.indexOf(w)] = next
    dropped.push(w)
  }
  return { seeds: out, dropped }
}

/** "Write about this" on the Keywords tab: a saved idea becomes a post to write. */
export async function ideaToTopic(brandId: string, keyword: string): Promise<{ ok: boolean; message?: string }> {
  const b = await loadBrandContext(brandId)
  if (!b) return { ok: false, message: 'Brand not found.' }
  const row = (await readSearchData(brandId))?.ideas?.rows.find(r => r.keyword === keyword)
  if (!row) return { ok: false, message: 'That keyword is gone. Refresh the page.' }
  await updateSearchData(brandId, searchFallback(b), x => {
    const t = x.topics.find(y => y.keyword === keyword)
    const why = `You picked it. ${row.volume.toLocaleString('en-US')} searches a month, ${difficultyLabel(row.difficulty)}.`
    // A skipped or finished topic goes back on the list; one already there is left as it is
    if (t && (t.status === 'skipped' || t.status === 'published')) Object.assign(t, { status: 'picked', why, pickedAt: new Date().toISOString() })
    else if (!t) x.topics.push({ keyword, volume: row.volume, difficulty: row.difficulty, cpc: row.cpc, why, status: 'picked', pickedAt: new Date().toISOString(), kind: 'new' })
    const r = x.ideas?.rows.find(y => y.keyword === keyword)
    if (r) r.verdict = 'picked'
  })
  return { ok: true }
}

// ── Where the site ranks ──────────────────────────────────────────────────────

type RankSource = 'gsc' | 'labs'
type GscCreds = { email: string; key: string }

async function readGscCreds(brandId: string): Promise<GscCreds | null> {
  const [row] = await db.select({ metadata: brandIntegrations.metadata }).from(brandIntegrations)
    .where(and(eq(brandIntegrations.brandId, brandId), eq(brandIntegrations.provider, 'gsc_api'), eq(brandIntegrations.status, 'connected')))
    .limit(1)
  const meta = (row?.metadata as Record<string, string> | null) ?? {}
  return meta.client_email && meta.private_key ? { email: meta.client_email, key: meta.private_key } : null
}

// Fewer impressions than this in 28 days and Google's average position is mostly noise
const GSC_MIN_IMPRESSIONS = 5

/**
 * Where the site really shows up on Google, from Search Console (last 28 days): one row per search,
 * the page shown most for it, and the average position weighted by impressions. Volume is a rough
 * stand-in (impressions a month) until it's swapped for DataForSEO's searches a month where known.
 * null = Search Console has no data for the site.
 */
async function gscRanks(b: BrandContext, c: GscCreds): Promise<RankedKeyword[] | null> {
  const rows = await fetchGscQueryPages(c.email, c.key, b.websiteUrl, 28)
  if (!rows) return null
  const by = new Map<string, { impressions: number; clicks: number; posSum: number; pages: Map<string, number> }>()
  for (const r of rows) {
    const k = r.query.toLowerCase().trim()
    if (!k) continue
    const cur = by.get(k) ?? { impressions: 0, clicks: 0, posSum: 0, pages: new Map<string, number>() }
    cur.impressions += r.impressions
    cur.clicks += r.clicks ?? 0
    cur.posSum += r.position * r.impressions
    cur.pages.set(r.page, (cur.pages.get(r.page) ?? 0) + r.impressions)
    by.set(k, cur)
  }
  return [...by.entries()]
    .filter(([, x]) => x.impressions >= GSC_MIN_IMPRESSIONS)
    .map(([keyword, x]) => ({
      keyword,
      rank: Math.max(1, Math.round(x.posSum / x.impressions)),
      url: [...x.pages.entries()].sort((p, q) => q[1] - p[1])[0][0],
      impressions: Math.round(x.impressions),
      clicks: Math.round(x.clicks),
      volume: Math.round((x.impressions * 30) / 28),
    }))
    .sort((x, y) => y.impressions - x.impressions)
    .slice(0, 200)
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

/** Buyer questions where a rival (tracked or not) was named and the brand never was. Google's AI
 *  Overviews answer searches, not the questions, so they're left out. */
function gapsIn(list: AiAnswer[]): Map<string, AiAnswer[]> {
  const byQ = new Map<string, AiAnswer[]>()
  for (const a of list.filter(x => x.engine !== 'google_ai')) byQ.set(a.question, [...(byQ.get(a.question) ?? []), a])
  return new Map([...byQ.entries()].filter(([, l]) => !l.some(a => (a.hits ?? (a.mentioned ? 1 : 0)) > 0) && l.some(a => a.brands.length || a.others?.length)))
}

function buildTasks(
  b: BrandContext, answers: AiAnswer[], changes: RankChange[], desc: SearchAgentData['description'], prev: AiAnswer[] | null,
  log: SearchAgentData['questionLog'], source: RankSource,
): AgentTask[] {
  const tasks: AgentTask[] = []
  const ok = answers.filter(a => !a.error)
  const prevOk = (prev ?? []).filter(a => !a.error)
  // Answers vary, so a gap becomes a to-do only when it holds: it was also there the last time this
  // question was asked, or (first time asked) in every sample now, which gapsIn already requires.
  // Brands saved before the log existed read it from last week's answers.
  const last: Record<string, { gap: boolean }> = log ?? Object.fromEntries(
    [...new Set(prevOk.filter(a => a.engine !== 'google_ai').map(a => a.question))].map(q => [q, { gap: gapsIn(prevOk).has(q) }]))
  const gaps = [...gapsIn(ok).entries()]
    .filter(([q]) => !last[q] || last[q].gap)
    .slice(0, 3)
  for (const [q, list] of gaps) {
    const rivals = [...new Set([...list.flatMap(a => a.brands), ...list.flatMap(a => a.others ?? [])])].slice(0, 3)
    tasks.push({
      key: `write:${idOf(q)}`, kind: 'write', status: 'open',
      title: `Write a page answering "${q}"`,
      detail: `${rivals.join(', ')} come${rivals.length === 1 ? 's' : ''} up in AI answers to this question. ${b.name} doesn't.`,
    })
  }
  // Sites AI keeps citing in answers that leave the brand out
  const named = namedRivals(ok, b.name)
  const citable = (dom: string) => citableSite(dom, b, named)
  const counts = new Map<string, { n: number; url: string; title: string }>()
  for (const a of ok.filter(x => !x.mentioned)) {
    for (const c of a.citations) {
      if (!c.domain || !citable(c.domain) || !listyCitation(c.domain, c.title ?? '') || /(^|\.)google\.|vertexaisearch/.test(c.domain)) continue
      const cur = counts.get(c.domain) ?? { n: 0, url: c.url, title: c.title }
      cur.n += 1
      counts.set(c.domain, cur)
    }
  }
  // Cited last week too (or 3+ times in the first week): a site AI keeps going back to
  const citedBefore = new Set(prevOk.filter(x => !x.mentioned).flatMap(a => a.citations.map(c => c.domain)))
  const holds = (dom: string, n: number) => (prevOk.length ? citedBefore.has(dom) && n >= 2 : n >= 3)
  for (const [dom, c] of [...counts.entries()].filter(([dom, c]) => holds(dom, c.n)).sort((x, y) => y[1].n - x[1].n).slice(0, 3)) {
    tasks.push({
      key: `listing:${dom}`, kind: 'listing', status: 'open', url: c.url,
      title: dom.includes('reddit.com') ? 'Join the Reddit threads AI answers cite' : `Get mentioned on ${dom}`,
      detail: `AI answers cited ${dom} ${c.n} times this week${prevOk.length ? ' and last week' : ''}, in answers that don't mention ${b.name}.${c.title ? ` Example: "${c.title}".` : ''}`,
    })
  }
  // Pages that dropped on Google. DataForSEO's rankings are an estimate refreshed every few weeks,
  // so only a bigger drop there counts; Search Console's are real averages.
  const minDrop = source === 'gsc' ? 3 : 5
  for (const c of changes.filter(x => x.before !== null && (x.now === null || x.now - x.before >= minDrop)).slice(0, 3)) {
    let path = c.url
    try { path = new URL(c.url).pathname || '/' } catch { /* keep the url */ }
    tasks.push({
      key: `refresh:${idOf(c.url || c.keyword)}`, kind: 'refresh', status: 'open', url: c.url,
      title: `Refresh ${path === '/' ? 'your homepage' : path}`,
      detail: source === 'gsc'
        ? `"${c.keyword}" ${c.now === null ? `was around #${c.before} and stopped showing up` : `slipped from about #${c.before} to #${c.now}`} on Google (Search Console, last 28 days).`
        : `"${c.keyword}" dropped from #${c.before} to #${c.now} on Google (DataForSEO's estimate).`,
    })
  }
  if (desc?.issue) {
    tasks.push({ key: 'fix:description', kind: 'fix', status: 'open', title: 'Fix how AI describes you', detail: desc.issue })
  }
  // Most urgent first: these order the page and decide which become Today cards
  const order: Record<AgentTask['kind'], number> = { fix: 0, refresh: 1, write: 2, listing: 3, ads: 4 }
  return tasks.sort((x, y) => order[x.kind] - order[y.kind])
}

// A search needs this many impressions (28 days) for its Search Console move to count
const GSC_MOVE_IMPRESSIONS = 20

/**
 * What moved since the last research. Only compares like with like (Search Console with Search
 * Console). A search missing from DataForSEO's list is not a drop: the list is capped and its
 * database changes; one gone from Search Console is, when it was seen often enough before.
 */
function rankChanges(prev: SearchAgentData['ranks'], rows: RankedKeyword[], topics: Topic[], source: RankSource): RankChange[] {
  if (!prev || (prev.source ?? 'labs') !== source) return []
  const before = new Map(prev.rows.map(r => [r.keyword, r]))
  const now = new Map(rows.map(r => [r.keyword, r]))
  const watch = new Set([...prev.rows.slice(0, 30).map(r => r.keyword), ...rows.slice(0, 30).map(r => r.keyword), ...topics.map(t => t.keyword)])
  const out: (RankChange & { volume: number })[] = []
  for (const k of watch) {
    const a = before.get(k), c = now.get(k)
    if (!a && !c) continue
    if (a && !c && (source === 'labs' || (a.impressions ?? 0) < GSC_MOVE_IMPRESSIONS + 10)) continue
    if (a && c && source === 'gsc' && Math.min(a.impressions ?? 0, c.impressions ?? 0) < GSC_MOVE_IMPRESSIONS) continue
    const delta = a && c ? Math.abs(c.rank - a.rank) : 99
    if (delta < 3) continue
    out.push({ keyword: k, before: a?.rank ?? null, now: c?.rank ?? null, url: c?.url || a?.url || '', volume: c?.volume ?? a?.volume ?? 0 })
  }
  return out.sort((x, y) => y.volume - x.volume).slice(0, 12).map(({ volume: _v, ...r }) => r)
}

// ── Research step ─────────────────────────────────────────────────────────────

export async function runSearchResearch(brandId: string): Promise<{ ok: boolean; summary: string; error?: string }> {
  const b = await loadBrandContext(brandId)
  if (!b) return { ok: false, summary: '', error: 'Brand not found.' }
  if (!searchDataReady()) return { ok: false, summary: '', error: 'DataForSEO is not set up yet (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD).' }
  const fallback = searchFallback(b)
  // Switching between demo and real data: start the results afresh (settings are kept)
  const saved = await readSearchData(brandId)
  if (saved && !!saved.demo !== agentsDemo()) {
    await updateSearchData(brandId, fallback, x => {
      x.topics = []; x.ranks = null; x.rankChanges = []; x.answers = null; x.mentionHistory = []
      x.description = null; x.ideas = null; x.tasks = []; x.adsTips = []; x.links = []; x.lastError = null; x.demo = agentsDemo()
    })
  }
  const d = (await readSearchData(brandId)) ?? fallback()
  const meter = newMeter()
  const errors: string[] = []

  const n = (x: number, one: string, many = `${one}s`) => `${x.toLocaleString('en-US')} ${x === 1 ? one : many}`
  const p = new Progress(brandId, 'search', 'Search Agent research', [
    { key: 'setup', label: 'Reading your brand', hint: 'Your keywords, competitors and buyer questions' },
    { key: 'pages', label: 'Reading your pages', hint: 'Titles, H1s and headings of your homepage and main pages' },
    { key: 'keywords', label: 'Finding keywords', hint: 'Ideas with monthly searches and difficulty' },
    { key: 'ranks', label: 'Checking Google rankings', hint: `Where ${b.domain} shows up on Google` },
    { key: 'ai', label: 'Asking AI assistants', hint: 'Who ChatGPT, Perplexity, Gemini and Google’s AI Overviews recommend' },
    { key: 'describe', label: 'Checking how AI describes you', hint: 'Whether ChatGPT gets your product right' },
    { key: 'ads', label: 'Checking Google Ads', hint: 'Spend on searches that never converted' },
    { key: 'topics', label: 'Picking blog topics', hint: 'Searches you can realistically win' },
    { key: 'tasks', label: 'Listing what to do', hint: 'Sites to get listed on, pages to refresh' },
  ])

  return withAIContext({ brandId, moduleType: 'search-agent', websiteUrl: b.websiteUrl }, async () => {
    await p.step('setup', () => ensureSeedsAndQuestions(b, d), () => ({ detail: `${n(d.settings.seeds.length, 'keyword')} · ${n(d.settings.questions.length, 'question')}`, items: d.settings.seeds }))
      .catch(e => errors.push(e instanceof Error ? e.message : 'Setup failed'))
    setDemoContext({ brand: b.name, domain: b.domain, competitors: b.competitors, seeds: d.settings.seeds, round: d.mentionHistory.length })
    const s = d.settings
    const demo = agentsDemo()
    // Search & AI page: read the homepage and main pages (free), the search each one targets, and any
    // title / H1 changed since the last check (each becomes a test)
    let site: { pages: SitePage[]; changes: SiteChange[] } | null = null
    await p.step('pages', async () => (site = await refreshSitePages(b, d, meter)), r => ({
      detail: `${n(r.pages.length, 'page')}`,
      items: r.pages.filter(x => x.keyword).map(x => `${x.path} · ${x.keyword}`).slice(0, 5),
      note: r.changes.length ? `Changed since the last check: ${r.changes.map(c => `${c.what.toLowerCase()} on ${c.path}`).join(', ')}. Testing from today.` : undefined,
    })).catch(e => { errors.push(`Your pages: ${e instanceof Error ? e.message : e}`); return null })
    const siteNow = site as { pages: SitePage[]; changes: SiteChange[] } | null
    const pageKws = (siteNow?.pages ?? d.pages ?? []).map(x => x.keyword).filter((k): k is string => !!k)
    const ads = demo ? null : await readGoogleAdsCreds(brandId).catch(() => null)
    const gsc = demo ? null : await readGscCreds(brandId).catch(() => null)
    // Where the site ranks: Search Console when connected (real positions), else DataForSEO's estimate
    let source = 'labs' as RankSource
    const readRanks = async (): Promise<RankedKeyword[]> => {
      if (gsc) {
        try {
          const r = await gscRanks(b, gsc)
          if (r) { source = 'gsc'; return r }
          errors.push('Search Console has no search data for this site yet, so rankings are DataForSEO’s estimate')
        } catch (e) {
          errors.push(`Search Console: ${e instanceof Error ? e.message.split('\n')[0] : e}, so rankings are DataForSEO’s estimate`)
        }
      }
      return rankedKeywords(b.domain, s.country, meter)
    }
    // This week's buyer questions: they rotate, so all of them get asked over the weeks
    const asked = rotate(s.questions, aiQuestionLimit(), d.questionRound ?? d.mentionHistory.length)
    if (!demo && !ads) p.set('ads', 'skipped', 'Not connected')
    const [ideas, ranked, answers, desc, wasted] = await Promise.all([
      p.step('keywords', () => keywordIdeas(s.seeds, s.country, meter), r => ({ detail: n(r.length, 'idea'), note: 'Top ideas, with searches a month:', items: r.slice(0, 4).map(i => `${i.keyword} · ${i.volume.toLocaleString('en-US')}`) }))
        .catch(e => { errors.push(`Keywords: ${e instanceof Error ? e.message : e}`); return [] as KeywordIdea[] }),
      p.step('ranks', readRanks, r => ({ detail: `${r.filter(x => x.rank <= 10).length} on page 1`, note: source === 'gsc'
        ? `${b.domain} showed up for ${n(r.length, 'search', 'searches')} in the last 28 days (Google Search Console).`
        : `${b.domain} shows up for about ${n(r.length, 'search', 'searches')} (DataForSEO’s estimate${gsc ? '' : '; connect Search Console for real positions'}).` }))
        .catch(e => { errors.push(`Rankings: ${e instanceof Error ? e.message : e}`); return null }),
      // Google's AI Overview for the starting keywords, then the other keywords the Search & AI page tracks
      p.step('ai', () => askEngines(b, asked, [...new Set([...pageKws, ...s.seeds.map(kwKey), ...(d.tracked ?? []).filter(t => t.status === 'active').map(t => t.keyword)])], s.country, meter), r => {
        const ok = r.filter(a => !a.error && a.engine !== 'google_ai')
        const samples = ok.reduce((t, a) => t + (a.samples ?? 1), 0), hits = ok.reduce((t, a) => t + (a.hits ?? (a.mentioned ? 1 : 0)), 0)
        return { detail: `Named in ${hits} of ${samples}`, note: `${n(asked.length, 'buyer question')} asked ${aiRepeats()}× to ChatGPT, Perplexity and Gemini (through their APIs), plus Google’s AI Overviews.` }
      }),
      p.step('describe', () => checkDescription(b, meter), r => r?.issue ? 'Needs a fix' : 'Looks right').catch(() => null),
      demo ? p.step('ads', () => Promise.resolve(demoWastedSpend()), r => ({ detail: `${r.currency} ${r.total} wasted`, items: r.terms.slice(0, 4).map(t => t.term) }))
        : ads ? p.step('ads', () => wastedSearchTerms(ads), r => r.total ? { detail: `${r.currency} ${r.total} wasted`, items: r.terms.slice(0, 4).map(t => t.term) } : 'No waste found')
          .catch(e => { errors.push(`Google Ads: ${e instanceof Error ? e.message : e}`); return null }) : Promise.resolve(null),
    ])
    if (desc?.issue) p.set('describe', 'warn', { detail: 'Needs a fix', note: desc.issue })
    // Search Console has no searches a month: DataForSEO's figure where the idea list has it
    const ideaVolume = new Map(ideas.map(i => [i.keyword.toLowerCase(), i.volume]))
    const rows = (ranked ?? []).map(r => source === 'gsc' ? { ...r, volume: ideaVolume.get(r.keyword) ?? r.volume } : r)
    const changes = ranked ? rankChanges(d.ranks, rows, d.topics, source) : d.rankChanges
    const { picks, checked, fits } = await pickTopics(b, d, ideas, rows).catch(() => ({ picks: [] as Topic[], checked: new Set<string>(), fits: new Set<string>() }))
    // The agent's own starting keywords: weak ones are swapped for good-fit ideas for next week
    const review = s.seedsBy === 'auto' ? await reviewSeeds(b, s.seeds, ideas).catch(() => null) : null
    const swapped = review?.dropped.length ? `Starting keywords for next time: dropped ${review.dropped.map(x => `“${x}”`).join(', ')}.` : undefined
    p.set('topics', 'done', picks.length ? { detail: `${picks.length} new`, items: picks.map(t => t.keyword), note: swapped } : { detail: 'None new', note: swapped ?? 'Topics from earlier are still waiting to be written.' })
    const built = buildTasks(b, answers, changes, desc, d.answers?.items ?? null, d.questionLog, ranked ? source : (d.ranks?.source ?? 'labs'))
    // A cited site that turns out to be a competitor's (its blog won't list you) is no to-do
    const check = await rivalSites(b, d, built.filter(t => t.kind === 'listing').map(listingDomain)).catch(() => ({ rivals: new Set<string>(), learned: {} as Record<string, boolean> }))
    const fresh = built.filter(t => t.kind !== 'listing' || !check.rivals.has(listingDomain(t)))
    const listings = fresh.filter(t => t.kind === 'listing').map(t => t.key.replace(/^listing:/, ''))
    p.set('tasks', 'done', { items: listings, detail: fresh.length ? n(fresh.length, 'task') : 'Nothing new', note: [
      listings.length ? `${n(listings.length, 'site')} to get listed on` : null,
      fresh.some(t => t.kind === 'refresh') ? `${n(fresh.filter(t => t.kind === 'refresh').length, 'page')} to refresh` : null,
      fresh.some(t => t.kind === 'write') ? `${n(fresh.filter(t => t.kind === 'write').length, 'question')} to answer` : null,
    ].filter(Boolean).join(' · ') || undefined })

    const tips: AdsTip[] = ideas
      .filter(i => (i.difficulty ?? 0) >= 60 && i.volume >= 100 && i.cpc && i.cpc < 3)
      .slice(0, 2)
      .map(i => ({
        kind: 'try-ads' as const,
        title: `Try ads for "${i.keyword}"`,
        detail: `Hard to rank for on Google (difficulty ${i.difficulty}), but about $${i.cpc!.toFixed(2)} a click. ${i.volume.toLocaleString('en-US')} searches a month.`,
      }))
    if (wasted && wasted.total > 0 && wasted.terms.length) {
      tips.unshift({
        kind: 'wasted',
        title: `${wasted.currency} ${wasted.total.toLocaleString('en-US')} spent on searches that never converted`,
        detail: `Last 30 days. Add these as negative keywords: ${wasted.terms.slice(0, 5).map(t => `"${t.term}"`).join(', ')}.`,
      })
    }
    const okAnswers = answers.filter(a => !a.error)
    // The weekly "named in X of Y" counts the buyer questions only: AI Overviews show up some weeks
    // and not others, which would move the number by itself
    const counted = okAnswers.filter(a => a.engine !== 'google_ai')
    const gapsNow = gapsIn(okAnswers)
    const failed = answers.filter(a => a.error && a.engine !== 'google_ai')
    if (!okAnswers.length && answers.length) errors.push(`AI answers: ${answers[0].error ?? 'failed'}`)
    // Some failed: say so, or the AI answers tab quietly shows fewer questions than were asked
    else if (failed.length) errors.push(`AI answers: ${failed.length} of ${answers.filter(a => a.engine !== 'google_ai').length} couldn't be read (${failed[0].error ?? 'failed'}), so this week's numbers use fewer answers`)

    const saved = await updateSearchData(brandId, fallback, x => {
      // Unless the user typed their own keywords in the meantime
      if (x.settings.seedsBy !== 'user' && s.seedsBy === 'auto') { x.settings.seeds = review?.seeds ?? s.seeds; x.settings.seedsBy = 'auto' }
      x.settings.questions = x.settings.questions.length ? x.settings.questions : s.questions
      x.topics.push(...picks)
      // Keep the last ideas when this run got none (a DataForSEO error)
      if (ideas.length) x.ideas = { at: new Date().toISOString(), rows: ideaRows(b, x.topics, ideas, checked, fits) }
      if (ranked) { x.ranks = { at: new Date().toISOString(), rows: rows.slice(0, 200), source }; x.rankChanges = changes }
      // Search & AI page: new starting keywords and written topics join the tracked list, then this
      // week's numbers for every tracked keyword go into its history
      if (siteNow) {
        x.pages = siteNow.pages
        x.changes = [...(x.changes ?? []), ...siteNow.changes].slice(-40)
      }
      ensureTracked(x)
      if (ranked) recordSnapshot(x, rows, source, answers)
      if (okAnswers.length) {
        x.answers = { at: new Date().toISOString(), items: answers }
        if (counted.length) x.mentionHistory.push({ at: new Date().toISOString(), mentioned: counted.reduce((t, a) => t + (a.hits ?? (a.mentioned ? 1 : 0)), 0), asked: counted.reduce((t, a) => t + (a.samples ?? 1), 0) })
        x.questionRound = (d.questionRound ?? d.mentionHistory.length) + 1
        const log = { ...(x.questionLog ?? {}) }
        for (const q of new Set(counted.map(a => a.question))) log[q] = { at: new Date().toISOString(), gap: gapsNow.has(q) }
        // Forget questions no longer in the list
        x.questionLog = Object.fromEntries(Object.entries(log).filter(([q]) => x.settings.questions.includes(q) || s.questions.includes(q)))
      }
      if (desc) x.description = desc
      // Keep what the user already closed; drop open tasks the data no longer supports
      const prev = new Map(x.tasks.map(t => [t.key, t]))
      x.rivalCheck = { ...(x.rivalCheck ?? {}), ...check.learned }
      x.tasks = fresh.map(t => prev.get(t.key)?.status && prev.get(t.key)!.status !== 'open' ? { ...t, status: prev.get(t.key)!.status } : t)
      x.adsTips = tips
      x.lastResearchAt = new Date().toISOString()
      x.demo = demo
      x.lastError = errors.length ? errors.join(' · ') : null
    })
    await addUsage(brandId, meter, 'Search Agent').catch(() => {})

    // Today cards: the top 3 open tasks
    try {
      const open = saved.tasks.filter(t => t.status === 'open')
      for (const t of open.slice(0, 3)) {
        await openSignal(brandId, { source: 'search-agent', signalKey: t.key, title: t.title, detail: t.detail, action: 'Open the Search Agent for details.', priority: t.kind === 'refresh' || t.kind === 'fix' ? 3 : 2 })
      }
      // Closed tasks, and tasks this research dropped, lose their Today card
      const kept = new Set(saved.tasks.map(t => t.key))
      const stale = [...saved.tasks.filter(t => t.status !== 'open').map(t => t.key), ...d.tasks.map(t => t.key).filter(k => !kept.has(k))]
      await clearSignals(brandId, 'search-agent', stale)
    } catch { /* Today cards are optional */ }

    // A single week is noisy: the summary gives the 4-week average
    const last4 = saved.mentionHistory.slice(-4)
    const avg = last4.reduce((t, h) => t + h.asked, 0) ? Math.round(100 * last4.reduce((t, h) => t + h.mentioned, 0) / last4.reduce((t, h) => t + h.asked, 0)) : null
    const summary = [
      `${picks.length} new topic${picks.length === 1 ? '' : 's'}`,
      avg !== null ? `named in ${avg}% of AI answers (${last4.length}-week average)` : null,
      `${fresh.length} task${fresh.length === 1 ? '' : 's'}`,
      costNote(meter),
    ].filter(Boolean).join(' · ')
    await p.finish(summary)
    return { ok: !errors.length, summary, error: errors.join(' · ') || undefined }
  }).catch(async e => {
    await p.finish(`Stopped: ${e instanceof Error ? e.message : 'failed'}`, true)
    throw e
  })
}

// ── Write step ────────────────────────────────────────────────────────────────

/** The text of one of the brand's own pages, for a rewrite (headings kept as markdown). */
async function readOwnPage(url: string): Promise<string> {
  if (agentsDemo()) return '# Your current page\n\nAbout 600 words, written in 2023. Sections: What it is | Features | Pricing'
  const html = await fetchHtml(url)
  if (!html) return ''
  const $ = cheerio.load(html)
  $('script,style,nav,footer,header,noscript,form').remove()
  const root = $('main').length ? $('main') : $('body')
  const parts: string[] = []
  root.find('h1,h2,h3,p,li').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim()
    if (!t) return
    const tag = el.tagName.toLowerCase()
    parts.push(tag === 'h1' ? `# ${t}` : tag === 'h2' ? `## ${t}` : tag === 'h3' ? `### ${t}` : tag === 'li' ? `- ${t}` : t)
  })
  return parts.join('\n').slice(0, 9000)
}

async function readPage(url: string): Promise<string> {
  // Demo results point at made-up pages: describe a typical competitor article instead
  if (agentsDemo()) return 'Title: A typical list article\nAbout 900 words. Newest year mentioned: 2024.\nSections: Intro | 8 tools | Pricing (no numbers) | Conclusion'
  const html = await fetchHtml(url)
  if (!html) return 'Could not read the page.'
  const $ = cheerio.load(html)
  $('script,style,nav,footer,header,noscript').remove()
  const heads = $('h2,h3').map((_, el) => $(el).text().trim()).get().filter(Boolean).slice(0, 15)
  const text = $('main').text() || $('body').text()
  const words = text.split(/\s+/).filter(Boolean).length
  const years = (text.match(/\b20\d\d\b/g) ?? []).map(Number).filter(y => y <= new Date().getFullYear())
  return `Title: ${$('title').first().text().trim()}\nAbout ${words} words. Newest year mentioned: ${years.length ? Math.max(...years) : 'none'}.\nSections: ${heads.join(' | ') || 'none found'}`
}

export async function runSearchWrite(brandId: string, keyword?: string, inputs?: Topic['inputs']): Promise<{ ok: boolean; summary: string; error?: string }> {
  const b = await loadBrandContext(brandId)
  if (!b) return { ok: false, summary: '', error: 'Brand not found.' }
  const fallback = searchFallback(b)
  // What only the business knows, if the user answered before writing
  if (keyword && inputs) await updateSearchData(brandId, fallback, x => { const t = x.topics.find(y => y.keyword === keyword); if (t) t.inputs = inputs })
  const d = (await readSearchData(brandId)) ?? fallback()
  // A topic the user picked to write now, else the next one in line
  const topic = d.topics.find(t => t.status === 'picked' && (!keyword || t.keyword === keyword))
  if (!topic) return { ok: true, summary: 'No topic waiting to be written.' }
  const meter = newMeter()
  const p = new Progress(brandId, 'search', topic.kind === 'improve' ? `Rewriting your page for “${topic.keyword}”` : `Writing a post for “${topic.keyword}”`, [
    { key: 'serp', label: 'Checking top results', hint: `Today's top Google results for “${topic.keyword}”` },
    { key: 'read', label: 'Reading them', hint: 'Length, sections and how current they are' },
    { key: 'write', label: topic.kind === 'improve' ? 'Rewriting your page' : 'Writing the article', hint: 'As long as the search needs, with an FAQ' },
    { key: 'save', label: 'Saving the draft', hint: 'To your blog drafts, for you to review' },
  ])

  return withAIContext({ brandId, moduleType: 'search-agent', websiteUrl: b.websiteUrl }, async () => {
    await updateSearchData(brandId, fallback, x => { const t = x.topics.find(y => y.keyword === topic.keyword); if (t) t.status = 'writing' })
    try {
      const serp = searchDataReady()
        ? await p.step('serp', async () => (await googleResults(topic.keyword, d.settings.country, meter).catch(() => [])).filter(r => domainOf(r.url) !== b.domain).slice(0, 3),
            r => r.length ? { detail: `${r.length} to beat`, items: r.map(x => `#${x.rank} ${x.domain}`) } : 'None to compare')
        : (p.set('serp', 'skipped', 'Not set up'), [])
      const pages = await p.step('read', () => Promise.all(serp.map(async r => `#${r.rank} ${r.url}\n${await readPage(r.url)}`)), r => `${r.length} page${r.length === 1 ? '' : 's'}`)
      // The length follows what ranks now (a bit longer than the typical top result), within 600-2,500 words
      const counts = pages.map(x => Number(x.match(/About (\d+) words/)?.[1] ?? 0)).filter(w => w > 200).sort((x, y) => x - y)
      const typical = counts.length ? counts[Math.floor(counts.length / 2)] : 0
      const target = typical ? Math.min(2500, Math.max(600, Math.round((typical * 1.15) / 100) * 100)) : 0
      const length = target ? `about ${target.toLocaleString('en-US')} words (the top results run about ${typical.toLocaleString('en-US')})` : '1,200-1,600 words'
      const improve = topic.kind === 'improve' && !!topic.pageUrl
      const current = improve ? await readOwnPage(topic.pageUrl!) : ''
      const inp = topic.inputs ?? {}
      const own = [
        inp.example?.trim() && `A real example or customer story: ${inp.example.trim()}`,
        inp.number?.trim() && `A number they know: ${inp.number.trim()}`,
        inp.opinion?.trim() && `Their own view: ${inp.opinion.trim()}`,
      ].filter(Boolean)
      p.set('write', 'running')
      const raw = await callAI({
        feature: 'search-agent',
        model: 'claude-sonnet-4-6',
        maxTokens: 7000,
        system: 'You are an expert SEO writer. You write genuinely useful articles that beat the current top Google results by covering more, being more current and being more practical. Return only a raw JSON object.',
        prompt: `${brandBlock(b)}

Target search: "${topic.keyword}" (${topic.volume} searches a month)
${improve ? `
This is a REWRITE of the brand's own page ${topic.pageUrl}, which already ranks for this search. Keep what works, keep the same topic and promise so the page keeps its place, and make it the best answer on the page: fix what's out of date, fill what the top results cover and this page lacks, cut padding. The page now:
--- current page ---
${current || 'Could not read the page; write the best version of a page on this topic.'}
--- end of current page ---
` : ''}
Today's top Google results:
${pages.join('\n\n') || 'Not available. Write the best possible article for this search.'}

${own.length ? `From the business itself (use these, they are what no other page has; don't change the facts):\n${own.map(x => `- ${x}`).join('\n')}` : `The business gave no examples or numbers: don't invent customer stories, numbers or quotes.`}

Return:
{
  "brief": { "top": "one sentence on what today's #1 result offers and lacks", "beats": ["3-4 short points on how this article beats it"] },
  "title": "...",
  "metaTitle": "50-60 characters",
  "metaDescription": "145-160 characters, includes the search phrase",
  "content": "the full article in markdown"${improve ? ',\n  "changes": ["3-5 short points on what changed from the current page"]' : ''}
}

Article rules: ${length}; H2/H3 headings; answer the search in the first paragraph; practical examples; a comparison table if it helps; an FAQ with 3-4 questions; mention ${b.name} honestly where it fits (never more than 3 times) and end with a short call to action. If ${b.name} makes something people can see (posts, designs, copy, templates), add a short section showing 2-3 realistic examples of what it would make for this topic, labelled as examples made with ${b.name}. No invented statistics, prices or quotes: if a number is needed, describe it without inventing it.`,
      })
      const j = parseJsonLoose<{ brief?: { top?: string; beats?: string[] }; title?: string; metaTitle?: string; metaDescription?: string; content?: string; changes?: string[] }>(raw, 'object')
      if (!j?.title || !j.content) { p.set('write', 'error', 'No article came back'); throw new Error('The writer returned no article.') }
      p.set('write', 'done', { detail: `~${j.content.split(/\s+/).length.toLocaleString('en-US')} words`, note: `“${j.title}”` })
      p.set('save', 'running')
      const [blog] = await db.insert(brandBlogs).values({
        brandId, title: j.title, slug: slugify(j.title),
        metaTitle: j.metaTitle ?? null, metaDescription: j.metaDescription ?? null,
        targetKeyword: topic.keyword, content: j.content, status: 'draft',
      }).returning({ id: brandBlogs.id })
      await updateSearchData(brandId, fallback, x => {
        const t = x.topics.find(y => y.keyword === topic.keyword)
        // A rewrite lists what changed; a new post how it beats today's #1
        if (t) { t.status = 'drafted'; t.blogId = blog.id; t.brief = { top: j.brief?.top ?? '', beats: ((improve && j.changes?.length ? j.changes : j.brief?.beats) ?? []).slice(0, 5) } }
        x.lastWriteAt = new Date().toISOString()
      })
      await addUsage(brandId, meter, 'Search Agent').catch(() => {})
      await openSignal(brandId, {
        source: 'search-agent', signalKey: `draft:${blog.id}`, priority: 2,
        title: improve ? `Page rewrite ready: "${j.title}"` : `Blog draft ready: "${j.title}"`,
        detail: improve ? `A better version of ${topic.pageUrl}, which ranks for "${topic.keyword}".` : `Written by your Search Agent for "${topic.keyword}" to beat today's #1 result.`,
        action: 'Read it in the Search Agent, then add it to your site.',
      }).catch(() => {})
      p.set('save', 'done', 'Saved')
      await p.finish(`Draft ready: “${j.title}”`)
      return { ok: true, summary: [`Drafted "${j.title}"`, costNote(meter)].filter(Boolean).join(' · ') }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Writing failed'
      await p.finish(`Stopped: ${msg}`, true)
      await updateSearchData(brandId, fallback, x => {
        const t = x.topics.find(y => y.keyword === topic.keyword)
        if (t && t.status === 'writing') t.status = 'picked'
        x.lastError = msg
      })
      return { ok: false, summary: '', error: msg }
    }
  })
}

/** Cron: research once a week; on other days find link opportunities (weekly) or write the next topic. */
export async function runSearchAgentScheduled(brandId: string): Promise<{ ok: boolean; summary: string; error?: string }> {
  const d = await readSearchData(brandId)
  if (!d?.settings.enabled) return { ok: true, summary: 'Agent is off.' }
  // Every day: replies to link pitches and their one follow-up (nothing to do most days)
  await runLinkFollowUps(brandId).catch(() => {})
  // Old suggestions that fail today's checks go (and their Today cards with them)
  const b = await loadBrandContext(brandId)
  if (b) await tidySearchData(brandId, b, d).catch(() => {})
  const last = d.lastResearchAt ? Date.parse(d.lastResearchAt) : 0
  if (Date.now() - last > WEEK) return runSearchResearch(brandId)
  // Link opportunities weekly, on a day after the research (one heavy step per day)
  const lastLinks = d.lastLinksAt ? Date.parse(d.lastLinksAt) : 0
  if (Date.now() - lastLinks > WEEK) return runLinkOpportunities(brandId)
  const lastWrite = d.lastWriteAt ? Date.parse(d.lastWriteAt) : 0
  if (Date.now() - lastWrite > WEEK && d.topics.some(t => t.status === 'picked')) return runSearchWrite(brandId)
  return { ok: true, summary: 'Nothing due today.' }
}

/** A "Refresh a page" to-do (its search dropped) becomes a page to rewrite. */
export async function refreshToTopic(brandId: string, key: string): Promise<{ ok: boolean; keyword?: string; message?: string }> {
  const b = await loadBrandContext(brandId)
  if (!b) return { ok: false, message: 'Brand not found.' }
  const d = await readSearchData(brandId)
  const t = d?.tasks.find(x => x.key === key && x.kind === 'refresh')
  const kw = t?.detail.match(/^"([^"]+)"/)?.[1]
  if (!t || !kw || !t.url) return { ok: false, message: 'That to-do is gone. Refresh the page.' }
  const row = d?.ranks?.rows.find(r => r.keyword === kw)
  await updateSearchData(brandId, searchFallback(b), x => {
    if (!x.topics.some(y => y.keyword === kw && (y.status === 'picked' || y.status === 'writing'))) {
      x.topics.push({ keyword: kw, volume: row?.volume ?? 0, difficulty: null, cpc: null, why: t.detail, status: 'picked', pickedAt: new Date().toISOString(), kind: 'improve', pageUrl: t.url })
    }
    const y = x.tasks.find(z => z.key === key)
    if (y) y.status = 'done'
  })
  await clearSignals(brandId, 'search-agent', [key]).catch(() => {})
  return { ok: true, keyword: kw }
}

/** Marks a topic / draft as approved, published or skipped. */
export async function setTopicStatus(brandId: string, keyword: string, status: Topic['status']): Promise<boolean> {
  const b = await loadBrandContext(brandId)
  if (!b) return false
  let blogId: string | undefined
  await updateSearchData(brandId, searchFallback(b), x => {
    const t = x.topics.find(y => y.keyword === keyword)
    if (t) { t.status = status; blogId = t.blogId }
  })
  if (blogId && status === 'published') {
    await db.update(brandBlogs).set({ status: 'published', publishedAt: new Date() })
      .where(and(eq(brandBlogs.id, blogId), eq(brandBlogs.brandId, brandId)))
  }
  if (blogId && (status === 'published' || status === 'skipped' || status === 'approved')) {
    await clearSignals(brandId, 'search-agent', [`draft:${blogId}`]).catch(() => {})
  }
  return true
}

export { ENGINE_LABEL }
