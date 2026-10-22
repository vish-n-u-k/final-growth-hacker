// The Search Agent. Two steps, so each fits in one request:
//   research (weekly): keyword ideas, where the site ranks and what moved, what ChatGPT /
//     Perplexity / Gemini answer to buyer questions (and whether they name the brand), how
//     ChatGPT describes the brand, Google Ads waste. Picks up to 3 blog topics the site can win
//     and turns the gaps into tasks (Today cards).
//   write (the day after): reads today's top 3 Google results for the next topic and writes a
//     draft that covers more, saved as a blog draft for the user to read and add to the site.

import * as cheerio from 'cheerio'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { brandBlogs } from '@/lib/db/schema'
import { callAI, withAIContext } from '@/lib/ai/client'
import { openSignal, clearSignals } from '@/lib/signals'
import { fetchHtml } from '@/lib/lead-finder/reviews'
import { slugify } from '@/lib/frekto/blog'
import {
  AI_ENGINES, ENGINE_LABEL, aiAnswer, searchDataReady, googleResults, keywordIdeas, rankedKeywords,
  type AiEngine, type KeywordIdea, type RankedKeyword,
} from './dataforseo'
import { readGoogleAdsCreds, wastedSearchTerms } from './google-ads'
import { agentsDemo, demoWastedSpend, setDemoContext } from './demo'
import { Progress } from './progress'
import {
  addUsage, defaultSearchData, newMeter, readSearchData, updateSearchData,
  type AdsTip, type AgentTask, type AiAnswer, type RankChange, type SearchAgentData, type Topic,
} from './store'
import { brandBlock, domainOf, idOf, loadBrandContext, parseJsonLoose, type BrandContext } from './context'

export const searchFallback = (b: BrandContext) => () => defaultSearchData(b)
const WEEK = 6.5 * 86_400_000

// ── Setup the agent needs once ────────────────────────────────────────────────

async function ensureSeedsAndQuestions(b: BrandContext, d: SearchAgentData) {
  if (d.settings.seeds.length && d.settings.questions.length) return
  const raw = await callAI({
    feature: 'search-agent',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 900,
    system: 'You help a small business with search. Return only a raw JSON object.',
    prompt: `${brandBlock(b)}

Return {"seeds":[...],"questions":[...]}:
- seeds: 5 short keywords (1-3 words) people type into Google when looking for what ${b.name} offers. Never the brand name.
- questions: 10 questions a buyer would ask ChatGPT when choosing a product like this, e.g. "What's the best tool for ...?", "Which app can ... for a small business?". Never mention ${b.name} or any brand.`,
  })
  const j = parseJsonLoose<{ seeds?: string[]; questions?: string[] }>(raw, 'object') ?? {}
  if (!d.settings.seeds.length) d.settings.seeds = (j.seeds ?? []).filter(s => typeof s === 'string').slice(0, 5)
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

async function askEngines(b: BrandContext, questions: string[], meter: ReturnType<typeof newMeter>): Promise<AiAnswer[]> {
  const jobs = questions.flatMap(q => AI_ENGINES.map(engine => ({ q, engine })))
  const settled = await Promise.allSettled(jobs.map(j => aiAnswer(j.engine, j.q, meter)))
  return settled.map((r, i) => r.status === 'fulfilled'
    ? analyseAnswer(jobs[i].q, jobs[i].engine, r.value.text, r.value.citations, b)
    : { question: jobs[i].q, engine: jobs[i].engine, mentioned: false, position: null, brands: [], citations: [], error: r.reason instanceof Error ? r.reason.message : 'failed' })
}

async function checkDescription(b: BrandContext, meter: ReturnType<typeof newMeter>): Promise<SearchAgentData['description']> {
  const at = new Date().toISOString()
  const r = await aiAnswer('chat_gpt', `What is ${b.name} (${b.domain})? Answer in two sentences.`, meter).catch(() => null)
  if (!r) return null
  const text = r.text.trim()
  if (!text || firstIndex(text, [b.name, b.domain]) === -1) {
    return { text, issue: `ChatGPT doesn't seem to know ${b.name} yet.`, at }
  }
  const verdict = await callAI({
    feature: 'search-agent',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 120,
    system: 'You check whether an AI assistant describes a business correctly. Be brief.',
    prompt: `How ChatGPT describes the brand:\n"""${text.slice(0, 1200)}"""\n\nWhat the brand actually is:\n${brandBlock(b)}\n\nIf the description is wrong, vague or outdated in a way that would cost customers, reply with ONE plain sentence saying what's wrong (e.g. "ChatGPT calls you a design tool, but you write and schedule posts."). If it's broadly right, reply exactly OK.`,
  }).catch(() => 'OK')
  return { text, issue: /^\s*OK\.?\s*$/i.test(verdict) ? null : verdict.trim().slice(0, 300), at }
}

// ── Topics ────────────────────────────────────────────────────────────────────

const difficultyLabel = (d: number | null) => d === null ? 'difficulty unknown' : d <= 29 ? `easy (${d})` : d <= 49 ? `medium (${d})` : `hard (${d})`

function pickTopics(b: BrandContext, d: SearchAgentData, ideas: KeywordIdea[], ranked: RankedKeyword[]): Topic[] {
  const brandWords = [b.name.toLowerCase(), b.domain.split('.')[0]]
  const used = new Set(d.topics.map(t => t.keyword.toLowerCase()))
  const isBranded = (k: string) => brandWords.some(w => w.length > 2 && k.includes(w))
  const now = new Date().toISOString()
  type C = Topic & { score: number }
  const cands: C[] = []
  for (const r of ranked) {
    if (r.rank < 5 || r.rank > 20 || r.volume < 30 || isBranded(r.keyword)) continue
    const idea = ideas.find(i => i.keyword === r.keyword)
    cands.push({
      keyword: r.keyword, volume: r.volume, difficulty: idea?.difficulty ?? null, cpc: idea?.cpc ?? null,
      why: `You already rank #${r.rank}. A better page can reach the top 3.`, status: 'picked', pickedAt: now,
      score: (r.volume / 10) * 2,
    })
  }
  for (const i of ideas) {
    if (i.volume < 50 || i.difficulty === null || i.difficulty > 40 || isBranded(i.keyword)) continue
    cands.push({
      keyword: i.keyword, volume: i.volume, difficulty: i.difficulty, cpc: i.cpc,
      why: `${i.volume.toLocaleString('en-US')} searches a month, ${difficultyLabel(i.difficulty)}${i.intent === 'commercial' ? ', people comparing options' : ''}.`,
      status: 'picked', pickedAt: now, score: i.volume / (i.difficulty + 10),
    })
  }
  const words = (k: string) => new Set(k.toLowerCase().split(/\s+/))
  const similar = (x: string, y: string) => {
    const a = words(x), c = words(y)
    const shared = [...a].filter(w => c.has(w)).length
    return shared / Math.min(a.size, c.size) >= 0.75
  }
  const open = d.topics.filter(t => t.status === 'picked' || t.status === 'writing').length
  const out: Topic[] = []
  for (const c of cands.sort((x, y) => y.score - x.score)) {
    if (out.length >= Math.max(0, 3 - open)) break
    if (used.has(c.keyword.toLowerCase())) continue
    if ([...d.topics.map(t => t.keyword), ...out.map(t => t.keyword)].some(k => similar(k, c.keyword))) continue
    const { score: _score, ...topic } = c
    out.push(topic)
  }
  return out
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

function buildTasks(b: BrandContext, answers: AiAnswer[], changes: RankChange[], desc: SearchAgentData['description']): AgentTask[] {
  const tasks: AgentTask[] = []
  const ok = answers.filter(a => !a.error)
  // Questions where rivals are named and the brand never is
  const byQ = new Map<string, AiAnswer[]>()
  for (const a of ok) byQ.set(a.question, [...(byQ.get(a.question) ?? []), a])
  const gaps = [...byQ.entries()]
    .filter(([, list]) => !list.some(a => a.mentioned) && list.some(a => a.brands.length))
    .slice(0, 3)
  for (const [q, list] of gaps) {
    const rivals = [...new Set(list.flatMap(a => a.brands))].slice(0, 3)
    tasks.push({
      key: `write:${idOf(q)}`, kind: 'write', status: 'open',
      title: `Write a page answering "${q}"`,
      detail: `${rivals.join(', ')} come${rivals.length === 1 ? 's' : ''} up in AI answers to this question. ${b.name} doesn't.`,
    })
  }
  // Sites AI keeps citing in answers that leave the brand out
  const own = new Set([b.domain, ...b.competitors.map(c => c.domain)])
  const counts = new Map<string, { n: number; url: string; title: string }>()
  for (const a of ok.filter(x => !x.mentioned)) {
    for (const c of a.citations) {
      if (!c.domain || own.has(c.domain) || /(^|\.)google\.|vertexaisearch/.test(c.domain)) continue
      const cur = counts.get(c.domain) ?? { n: 0, url: c.url, title: c.title }
      cur.n += 1
      counts.set(c.domain, cur)
    }
  }
  for (const [dom, c] of [...counts.entries()].filter(([, c]) => c.n >= 2).sort((x, y) => y[1].n - x[1].n).slice(0, 3)) {
    tasks.push({
      key: `listing:${dom}`, kind: 'listing', status: 'open', url: c.url,
      title: dom.includes('reddit.com') ? 'Join the Reddit threads AI answers cite' : `Get mentioned on ${dom}`,
      detail: `AI answers cited ${dom} ${c.n} times this week, in answers that don't mention ${b.name}.${c.title ? ` Example: "${c.title}".` : ''}`,
    })
  }
  // Pages that dropped on Google
  for (const c of changes.filter(x => x.before !== null && (x.now === null || x.now - x.before >= 3)).slice(0, 3)) {
    let path = c.url
    try { path = new URL(c.url).pathname || '/' } catch { /* keep the url */ }
    tasks.push({
      key: `refresh:${idOf(c.url || c.keyword)}`, kind: 'refresh', status: 'open', url: c.url,
      title: `Refresh ${path === '/' ? 'your homepage' : path}`,
      detail: `"${c.keyword}" dropped from #${c.before} to ${c.now === null ? 'outside the top 100' : `#${c.now}`} on Google.`,
    })
  }
  if (desc?.issue) {
    tasks.push({ key: 'fix:description', kind: 'fix', status: 'open', title: 'Fix how AI describes you', detail: desc.issue })
  }
  // Most urgent first: these order the page and decide which become Today cards
  const order: Record<AgentTask['kind'], number> = { fix: 0, refresh: 1, write: 2, listing: 3, ads: 4 }
  return tasks.sort((x, y) => order[x.kind] - order[y.kind])
}

function rankChanges(prev: SearchAgentData['ranks'], rows: RankedKeyword[], topics: Topic[]): RankChange[] {
  if (!prev) return []
  const before = new Map(prev.rows.map(r => [r.keyword, r]))
  const now = new Map(rows.map(r => [r.keyword, r]))
  const watch = new Set([...prev.rows.slice(0, 30).map(r => r.keyword), ...rows.slice(0, 30).map(r => r.keyword), ...topics.map(t => t.keyword)])
  const out: (RankChange & { volume: number })[] = []
  for (const k of watch) {
    const a = before.get(k), c = now.get(k)
    if (!a && !c) continue
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
      x.description = null; x.tasks = []; x.adsTips = []; x.lastError = null; x.demo = agentsDemo()
    })
  }
  const d = (await readSearchData(brandId)) ?? fallback()
  const meter = newMeter()
  const errors: string[] = []

  const n = (x: number, one: string, many = `${one}s`) => `${x.toLocaleString('en-US')} ${x === 1 ? one : many}`
  const p = new Progress(brandId, 'search', 'Search Agent research', [
    { key: 'setup', label: 'Reading your brand, keywords and competitors' },
    { key: 'keywords', label: 'Getting keyword ideas with search volume and difficulty' },
    { key: 'ranks', label: 'Checking where your site ranks on Google' },
    { key: 'ai', label: 'Asking ChatGPT, Perplexity and Gemini what they recommend' },
    { key: 'describe', label: 'Checking how ChatGPT describes you' },
    { key: 'ads', label: 'Looking for wasted Google Ads spend' },
    { key: 'topics', label: 'Picking blog topics you can win' },
    { key: 'tasks', label: 'Finding sites to get listed on and pages to refresh' },
  ])

  return withAIContext({ brandId, moduleType: 'search-agent', websiteUrl: b.websiteUrl }, async () => {
    await p.step('setup', () => ensureSeedsAndQuestions(b, d), () => `${n(d.settings.seeds.length, 'starting keyword')}, ${n(d.settings.questions.length, 'buyer question')}`)
      .catch(e => errors.push(e instanceof Error ? e.message : 'Setup failed'))
    setDemoContext({ brand: b.name, domain: b.domain, competitors: b.competitors, seeds: d.settings.seeds, round: d.mentionHistory.length })
    const s = d.settings
    const demo = agentsDemo()
    const ads = demo ? null : await readGoogleAdsCreds(brandId).catch(() => null)
    if (!demo && !ads) p.set('ads', 'skipped', 'Google Ads isn\'t connected')
    const [ideas, ranked, answers, desc, wasted] = await Promise.all([
      p.step('keywords', () => keywordIdeas(s.seeds, s.country, meter), r => [`${n(r.length, 'keyword idea')} found`, ...r.slice(0, 3).map(i => `“${i.keyword}” ${i.volume.toLocaleString('en-US')}/mo`)].join(' · '))
        .catch(e => { errors.push(`Keywords: ${e instanceof Error ? e.message : e}`); return [] as KeywordIdea[] }),
      p.step('ranks', () => rankedKeywords(b.domain, s.country, meter), r => `${b.domain} shows up for ${n(r.length, 'search', 'searches')}, ${r.filter(x => x.rank <= 10).length} on page 1`)
        .catch(e => { errors.push(`Rankings: ${e instanceof Error ? e.message : e}`); return null }),
      p.step('ai', () => askEngines(b, s.questions, meter), r => {
        const ok = r.filter(a => !a.error)
        return `${n(s.questions.length, 'question')} × 3 assistants: ${b.name} named in ${ok.filter(a => a.mentioned).length} of ${ok.length} answers`
      }),
      p.step('describe', () => checkDescription(b, meter), r => r?.issue ? `Problem: ${r.issue}` : 'Looks right').catch(() => null),
      demo ? p.step('ads', () => Promise.resolve(demoWastedSpend()), r => `${r.currency} ${r.total} on ${n(r.terms.length, 'search term')} that never converted`)
        : ads ? p.step('ads', () => wastedSearchTerms(ads), r => r.total ? `${r.currency} ${r.total} wasted on ${n(r.terms.length, 'search term')}` : 'No wasted spend found')
          .catch(e => { errors.push(`Google Ads: ${e instanceof Error ? e.message : e}`); return null }) : Promise.resolve(null),
    ])
    if (desc?.issue) p.set('describe', 'warn', `Problem: ${desc.issue}`)
    const rows = ranked ?? []
    const changes = ranked ? rankChanges(d.ranks, rows, d.topics) : d.rankChanges
    const picks = pickTopics(b, d, ideas, rows)
    p.set('topics', 'done', picks.length ? picks.map(t => `“${t.keyword}”`).join(', ') : 'No new topics this week (3 still waiting)')
    const fresh = buildTasks(b, answers, changes, desc)
    const listings = fresh.filter(t => t.kind === 'listing').map(t => t.key.replace(/^listing:/, ''))
    p.set('tasks', 'done', [
      listings.length ? `Get listed on ${listings.join(', ')}` : null,
      fresh.some(t => t.kind === 'refresh') ? `${n(fresh.filter(t => t.kind === 'refresh').length, 'page')} to refresh` : null,
      fresh.some(t => t.kind === 'write') ? `${n(fresh.filter(t => t.kind === 'write').length, 'question')} to answer` : null,
    ].filter(Boolean).join(' · ') || 'Nothing new')

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
    if (!okAnswers.length && answers.length) errors.push(`AI answers: ${answers[0].error ?? 'failed'}`)

    const saved = await updateSearchData(brandId, fallback, x => {
      x.settings.seeds = x.settings.seeds.length ? x.settings.seeds : s.seeds
      x.settings.questions = x.settings.questions.length ? x.settings.questions : s.questions
      x.topics.push(...picks)
      if (ranked) { x.ranks = { at: new Date().toISOString(), rows: rows.slice(0, 200) }; x.rankChanges = changes }
      if (okAnswers.length) {
        x.answers = { at: new Date().toISOString(), items: answers }
        x.mentionHistory.push({ at: new Date().toISOString(), mentioned: okAnswers.filter(a => a.mentioned).length, asked: okAnswers.length })
      }
      if (desc) x.description = desc
      // Keep what the user already closed; drop open tasks the data no longer supports
      const prev = new Map(x.tasks.map(t => [t.key, t]))
      x.tasks = fresh.map(t => prev.get(t.key)?.status && prev.get(t.key)!.status !== 'open' ? { ...t, status: prev.get(t.key)!.status } : t)
      x.adsTips = tips
      x.lastResearchAt = new Date().toISOString()
      x.demo = demo
      x.lastError = errors.length ? errors.join(' · ') : null
    })
    await addUsage(brandId, meter).catch(() => {})

    // Today cards: the top 3 open tasks
    try {
      const open = saved.tasks.filter(t => t.status === 'open')
      for (const t of open.slice(0, 3)) {
        await openSignal(brandId, { source: 'search-agent', signalKey: t.key, title: t.title, detail: t.detail, action: 'Open the Search Agent for details.', priority: t.kind === 'refresh' || t.kind === 'fix' ? 3 : 2 })
      }
      const stale = saved.tasks.filter(t => t.status !== 'open').map(t => t.key)
      await clearSignals(brandId, 'search-agent', stale)
    } catch { /* Today cards are optional */ }

    const mentioned = okAnswers.filter(a => a.mentioned).length
    const summary = [
      `${picks.length} new topic${picks.length === 1 ? '' : 's'}`,
      okAnswers.length ? `named in ${mentioned} of ${okAnswers.length} AI answers` : null,
      `${fresh.length} task${fresh.length === 1 ? '' : 's'}`,
    ].filter(Boolean).join(' · ')
    await p.finish(summary)
    return { ok: !errors.length, summary, error: errors.join(' · ') || undefined }
  }).catch(async e => {
    await p.finish(`Stopped: ${e instanceof Error ? e.message : 'failed'}`, true)
    throw e
  })
}

// ── Write step ────────────────────────────────────────────────────────────────

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

export async function runSearchWrite(brandId: string): Promise<{ ok: boolean; summary: string; error?: string }> {
  const b = await loadBrandContext(brandId)
  if (!b) return { ok: false, summary: '', error: 'Brand not found.' }
  const fallback = searchFallback(b)
  const d = (await readSearchData(brandId)) ?? fallback()
  const topic = d.topics.find(t => t.status === 'picked')
  if (!topic) return { ok: true, summary: 'No topic waiting to be written.' }
  const meter = newMeter()
  const p = new Progress(brandId, 'search', `Writing a post for “${topic.keyword}”`, [
    { key: 'serp', label: `Finding today's top Google results for “${topic.keyword}”` },
    { key: 'read', label: 'Reading those pages: length, sections, how current they are' },
    { key: 'write', label: 'Writing an article that covers more (1,200–1,600 words, FAQ, table)' },
    { key: 'save', label: 'Saving it as a blog draft for you to review' },
  ])

  return withAIContext({ brandId, moduleType: 'search-agent', websiteUrl: b.websiteUrl }, async () => {
    await updateSearchData(brandId, fallback, x => { const t = x.topics.find(y => y.keyword === topic.keyword); if (t) t.status = 'writing' })
    try {
      const serp = searchDataReady()
        ? await p.step('serp', async () => (await googleResults(topic.keyword, d.settings.country, meter).catch(() => [])).filter(r => domainOf(r.url) !== b.domain).slice(0, 3),
            r => r.length ? r.map(x => `#${x.rank} ${x.domain}`).join(', ') : 'No results to compare with')
        : (p.set('serp', 'skipped', 'Search data isn\'t set up'), [])
      const pages = await p.step('read', () => Promise.all(serp.map(async r => `#${r.rank} ${r.url}\n${await readPage(r.url)}`)), r => `${r.length} page${r.length === 1 ? '' : 's'} read`)
      p.set('write', 'running')
      const raw = await callAI({
        feature: 'search-agent',
        model: 'claude-sonnet-4-6',
        maxTokens: 7000,
        system: 'You are an expert SEO writer. You write genuinely useful articles that beat the current top Google results by covering more, being more current and being more practical. Return only a raw JSON object.',
        prompt: `${brandBlock(b)}

Target search: "${topic.keyword}" (${topic.volume} searches a month)

Today's top Google results:
${pages.join('\n\n') || 'Not available. Write the best possible article for this search.'}

Return:
{
  "brief": { "top": "one sentence on what today's #1 result offers and lacks", "beats": ["3-4 short points on how this article beats it"] },
  "title": "...",
  "metaTitle": "50-60 characters",
  "metaDescription": "145-160 characters, includes the search phrase",
  "content": "the full article in markdown"
}

Article rules: 1,200-1,600 words; H2/H3 headings; answer the search in the first paragraph; practical examples; a comparison table if it helps; an FAQ with 3-4 questions; mention ${b.name} honestly where it fits (never more than 3 times) and end with a short call to action. No invented statistics, prices or quotes: if a number is needed, describe it without inventing it.`,
      })
      const j = parseJsonLoose<{ brief?: { top?: string; beats?: string[] }; title?: string; metaTitle?: string; metaDescription?: string; content?: string }>(raw, 'object')
      if (!j?.title || !j.content) { p.set('write', 'error', 'The writer returned no article.'); throw new Error('The writer returned no article.') }
      p.set('write', 'done', `“${j.title}” · about ${j.content.split(/\s+/).length.toLocaleString('en-US')} words`)
      p.set('save', 'running')
      const [blog] = await db.insert(brandBlogs).values({
        brandId, title: j.title, slug: slugify(j.title),
        metaTitle: j.metaTitle ?? null, metaDescription: j.metaDescription ?? null,
        targetKeyword: topic.keyword, content: j.content, status: 'draft',
      }).returning({ id: brandBlogs.id })
      await updateSearchData(brandId, fallback, x => {
        const t = x.topics.find(y => y.keyword === topic.keyword)
        if (t) { t.status = 'drafted'; t.blogId = blog.id; t.brief = { top: j.brief?.top ?? '', beats: (j.brief?.beats ?? []).slice(0, 4) } }
        x.lastWriteAt = new Date().toISOString()
      })
      await addUsage(brandId, meter).catch(() => {})
      await openSignal(brandId, {
        source: 'search-agent', signalKey: `draft:${blog.id}`, priority: 2,
        title: `Blog draft ready: "${j.title}"`,
        detail: `Written by your Search Agent for "${topic.keyword}" to beat today's #1 result.`,
        action: 'Read it in the Search Agent, then add it to your site.',
      }).catch(() => {})
      p.set('save', 'done', 'Saved to your blog drafts')
      await p.finish(`Draft ready: “${j.title}”`)
      return { ok: true, summary: `Drafted "${j.title}"` }
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

/** Cron: research once a week; on other days write the next topic if one is waiting. */
export async function runSearchAgentScheduled(brandId: string): Promise<{ ok: boolean; summary: string; error?: string }> {
  const d = await readSearchData(brandId)
  if (!d?.settings.enabled) return { ok: true, summary: 'Agent is off.' }
  const last = d.lastResearchAt ? Date.parse(d.lastResearchAt) : 0
  if (Date.now() - last > WEEK) return runSearchResearch(brandId)
  const lastWrite = d.lastWriteAt ? Date.parse(d.lastWriteAt) : 0
  if (Date.now() - lastWrite > WEEK && d.topics.some(t => t.status === 'picked')) return runSearchWrite(brandId)
  return { ok: true, summary: 'Nothing due today.' }
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
