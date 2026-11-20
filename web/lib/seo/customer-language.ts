import { getSnapshot, saveSnapshot } from '@/lib/signals'
import { loadBrandContext, brandBlock, parseJsonLoose } from '@/lib/agents/context'
import { readSearchData, defaultCountry, addUsage, newMeter, type UsageMeter } from '@/lib/agents/store'
import { dfsRaw, locationOf, languageOf, dataForSeoConfigured } from '@/lib/agents/dataforseo'
import { brandMatcher } from '@/lib/search-hub/model'
import { callAI, withAIContext } from '@/lib/ai/client'
import { gsc } from '@/lib/mcp/tools/google_raw'
import { listReplies } from '@/lib/mcp/tools/inbox'
import { apify } from '@/lib/mcp/tools/apify'
import { pageFacts } from './blog-keywords'
import { compareMonths, isProblemSearch, quoteIsReal, wordsMissing, type MonthPhrase } from './customer-language-pure'

// The customer_language tool: the exact words buyers use for their problems, from Search Console,
// replies to emails GrowJin sent, Reddit and Hacker News threads, Google's "People also ask" and
// related searches, competitor reviews and anything pasted in. One AI call groups them by problem,
// compares them with the site's own wording and suggests where to use them. Run about monthly;
// each month is saved, so the next one shows new, growing and fading phrases.

const KEY = 'seo:customer-language'
const DAY = 86_400_000
const CACHE_DAYS = 30
const MODEL = 'claude-sonnet-5-5'
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
type Json = Record<string, unknown>

export interface Snippet { source: string; text: string; url?: string; where?: string }

interface Month { at: string; seeds: string[]; phrases: MonthPhrase[]; answer: Json }
interface Store {
  months?: Month[]                                                   // newest last, 12 kept
  reviews?: { at: string; urls: string[]; items: Snippet[]; run_id?: string; status?: string }
}

async function readStore(brandId: string): Promise<Store> {
  return (await getSnapshot<Store>(brandId, KEY).catch(() => null)) ?? {}
}
async function writeStore(brandId: string, change: (s: Store) => void) {
  const s = await readStore(brandId)
  change(s)
  s.months = (s.months ?? []).slice(-12)
  await saveSnapshot(brandId, KEY, s).catch(() => {})
}

const tidy = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/\s+/g, ' ').trim()
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

// ── Sources ──────────────────────────────────────────────────────────────────

/** Searches that read like a problem, from Search Console's last 90 days (free). */
async function fromSearchConsole(brandId: string, isBrand: (k: string) => boolean): Promise<{ items: Snippet[]; error?: string }> {
  const now = Date.now()
  const r = await gsc(brandId, { request: { dimensions: ['query'], startDate: iso(now - 92 * DAY), endDate: iso(now - 2 * DAY), rowLimit: 1000 } }) as { rows?: { query: string; impressions: number; clicks: number }[]; error?: string; message?: string }
  const rows = (r.rows ?? []).filter(x => isProblemSearch(x.query, isBrand)).sort((a, b) => b.impressions - a.impressions).slice(0, 120)
  return { items: rows.map(x => ({ source: 'Google search', text: x.query, where: `${x.impressions} impressions, ${x.clicks} clicks in 90 days` })), error: r.error ?? r.message }
}

/** Replies to emails GrowJin sent (last 90 days): the reply note, then the words of up to 6 of them. */
async function fromReplies(brandId: string): Promise<{ items: Snippet[]; error?: string }> {
  const list = await listReplies(brandId, { show: 'replies', days: 90, include_answered: true, limit: 30 }).catch(e => ({ error: String(e) })) as { threads?: { thread_id: string; to: string; says?: string }[]; error?: string }
  const threads = list.threads ?? []
  const items: Snippet[] = []
  const read = await Promise.all(threads.slice(0, 6).map(t =>
    listReplies(brandId, { thread_id: t.thread_id, messages: 4 }).catch(() => null) as Promise<{ messages?: { mine: boolean; text: string }[] } | null>))
  threads.forEach((t, i) => {
    const theirs = (read[i]?.messages ?? []).filter(m => !m.mine).map(m => m.text).join(' ')
    const text = theirs || t.says || ''
    if (text) items.push({ source: 'Email reply', text: cut(tidy(text), 700), where: `reply from ${t.to}` })
  })
  return { items, error: list.error }
}

/** Hacker News comments about the problem in the last 2 years (free, Algolia). */
async function fromHackerNews(seeds: string[]): Promise<{ items: Snippet[]; error?: string }> {
  const since = Math.floor((Date.now() - 730 * DAY) / 1000)
  const items: Snippet[] = []
  let error: string | undefined
  await Promise.all(seeds.map(async s => {
    try {
      const res = await fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(s)}&tags=comment&hitsPerPage=8&numericFilters=created_at_i>${since}`, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) { error = `Hacker News search answered ${res.status}.`; return }
      const hits = ((await res.json()) as { hits?: { comment_text?: string; story_title?: string; objectID: string }[] }).hits ?? []
      for (const h of hits) {
        const text = tidy(h.comment_text ?? '')
        if (text.length > 40) items.push({ source: 'Hacker News', text: cut(text, 600), url: `https://news.ycombinator.com/item?id=${h.objectID}`, where: h.story_title ?? undefined })
      }
    } catch (e) { error = `Hacker News search failed (${e instanceof Error ? e.message : 'error'}).` }
  }))
  return { items, error }
}

type SerpItem = { type?: string; title?: string; description?: string; url?: string; items?: ({ title?: string } | string)[] }

async function serp(keyword: string, country: string, meter: UsageMeter): Promise<{ items: SerpItem[]; error?: string }> {
  try {
    const r = await dfsRaw('/serp/google/organic/live/advanced', [{ keyword, location_code: locationOf(country), language_code: languageOf(country), depth: 20, people_also_ask_click_depth: 1 }], meter)
    const t = (r.json as { tasks?: { status_code?: number; status_message?: string; result?: { items?: SerpItem[] | null }[] | null }[] })?.tasks?.[0]
    if (!t || (t.status_code !== 20000 && t.status_code !== 40102)) return { items: [], error: `DataForSEO: ${t?.status_message ?? `HTTP ${r.status}`}` }
    return { items: t.result?.[0]?.items ?? [] }
  } catch (e) {
    return { items: [], error: e instanceof Error ? e.message : String(e) }
  }
}

/** A Reddit thread's post and top comments through its public .json (often refused; then Google's snippet is kept). */
async function redditThread(url: string): Promise<string> {
  try {
    const res = await fetch(`${url.replace(/\/?(\?.*)?$/, '')}.json?limit=12&sort=top`, { headers: { 'User-Agent': 'GrowJinBot/1.0 (customer language research)' }, signal: AbortSignal.timeout(6_000) })
    if (!res.ok) return ''
    const j = await res.json() as { data?: { children?: { data?: { selftext?: string; body?: string; title?: string } }[] } }[]
    const post = j[0]?.data?.children?.[0]?.data
    const comments = (j[1]?.data?.children ?? []).map(c => c.data?.body ?? '').filter(b => b && b !== '[deleted]' && b !== '[removed]').slice(0, 8)
    return tidy([post?.title, post?.selftext, ...comments].filter(Boolean).join(' • '))
  } catch { return '' }
}

/** Reddit threads (found through Google) and Google's People also ask / related searches. */
async function fromGoogle(seeds: string[], country: string, meter: UsageMeter): Promise<{ items: Snippet[]; errors: string[] }> {
  if (!dataForSeoConfigured()) return { items: [], errors: ['DataForSEO is not set up, so Reddit threads and People also ask are left out.'] }
  const items: Snippet[] = []
  const errors: string[] = []
  const answers = await Promise.all(seeds.flatMap(s => [serp(`site:reddit.com ${s}`, country, meter), serp(s, country, meter)]))
  const threads: { url: string; title: string; snippet: string }[] = []
  answers.forEach((a, i) => {
    if (a.error) errors.push(a.error)
    const reddit = i % 2 === 0
    for (const it of a.items) {
      if (reddit && it.type === 'organic' && it.url && /reddit\.com\/r\/[^/]+\/comments\//.test(it.url)) threads.push({ url: it.url, title: it.title ?? '', snippet: it.description ?? '' })
      if (!reddit && it.type === 'people_also_ask') for (const q of it.items ?? []) { const t = typeof q === 'string' ? q : q.title; if (t) items.push({ source: 'People also ask', text: t }) }
      if (!reddit && it.type === 'related_searches') for (const q of it.items ?? []) { const t = typeof q === 'string' ? q : q.title; if (t) items.push({ source: 'Related search', text: t }) }
    }
  })
  const unique = threads.filter((t, i) => threads.findIndex(x => x.url === t.url) === i).slice(0, 12)
  const full = await Promise.all(unique.slice(0, 5).map(t => redditThread(t.url)))
  unique.forEach((t, i) => {
    const sub = /reddit\.com\/(r\/[^/]+)/i.exec(t.url)?.[1]
    items.push({ source: 'Reddit', text: cut(full[i] || `${t.title}. ${t.snippet}`, 1500), url: t.url, where: sub })
  })
  return { items, errors }
}

// ── Competitor reviews (action "reviews") ──────────────────────────────────────

/** Reads low-star reviews from Capterra product pages through Apify and keeps them 30 days for listen. */
async function reviews(brandId: string, args: Json) {
  const store = await readStore(brandId)
  const urls = Array.isArray(args.review_urls) ? args.review_urls.map(String).filter(u => /^https?:\/\//.test(u)).slice(0, 3) : []
  const pending = store.reviews?.status === 'RUNNING' && store.reviews.run_id ? store.reviews : null
  if (!urls.length && !pending) return { error: 'review_urls is required: up to 3 Capterra product review pages of competitors, e.g. "https://www.capterra.com/p/123456/Product/reviews/".' }
  const r = (pending && !urls.length
    ? await apify(brandId, { run_id: pending.run_id })
    : await apify(brandId, { actor: 'capterra', input: { startUrls: urls }, limit: 40 })) as { items?: Json[]; run_id?: string; status?: string; error?: string }
  if (r.error) return { error: r.error }
  const pick = (o: Json, ...k: string[]) => { for (const x of k) { const v = o[x]; if (typeof v === 'string' && v.trim()) return v; if (typeof v === 'number') return String(v) } return '' }
  const items: Snippet[] = (r.items ?? []).flatMap(o => {
    const stars = Number(pick(o, 'overallRating', 'rating', 'stars', 'reviewRating'))
    if (Number.isFinite(stars) && stars > 3) return []
    const text = tidy([pick(o, 'title', 'reviewTitle'), pick(o, 'cons', 'consText'), pick(o, 'comments', 'review', 'text', 'reviewText', 'overall')].filter(Boolean).join(' • '))
    return text.length > 30 ? [{ source: 'Competitor review', text: cut(text, 800), url: pick(o, 'url', 'reviewUrl', 'productUrl') || undefined, where: [pick(o, 'productName', 'product'), Number.isFinite(stars) ? `${stars}★` : ''].filter(Boolean).join(' · ') || undefined }] : []
  })
  const running = r.status === 'RUNNING'
  await writeStore(brandId, s => { s.reviews = { at: new Date().toISOString(), urls: urls.length ? urls : pending?.urls ?? [], items, run_id: r.run_id, status: running ? 'RUNNING' : 'done' } })
  return running
    ? { status: 'still reading', note: 'Capterra is still being read. Call customer_language with action "reviews" again (no review_urls) in a minute.' }
    : { saved: items.length, kept_for_days: CACHE_DAYS, sample: items.slice(0, 3), next: 'Now call customer_language (action "listen", fresh: true if a month was already saved) and these reviews are included.' }
}

// ── listen ───────────────────────────────────────────────────────────────────

const SYSTEM = `You study the exact words buyers use to describe their problems, for a small business's positioning and content.
You get the brand, its own wording (homepage and main pages) and numbered snippets of what real people wrote or searched.
Rules:
- Only use what is in the snippets. Quotes must be copied word for word from one snippet (you may cut with "…"). Never invent a quote, a count or a source.
- Group by the PROBLEM or desire in the buyer's words ("no time to post every day"), not by product features. 4-8 groups, biggest first.
- Phrases are short buyer wordings (2-8 words) as they say them, lower case.
- count = how many snippets express that group / phrase.
- Leave out snippets about something unrelated to the brand's buyers.
- Keep it short and plain. No marketing jargon.
Answer with JSON only:
{"groups":[{"problem":"","phrases":[{"phrase":"","count":0}],"count":0,"sources":["Reddit"],"quotes":[{"text":"","snippet":1}]}],
 "words_you_dont_use":[{"buyers_say":"","you_say":"","where":"homepage title / H1 / a page path"}],
 "use_them":{"headlines":[""],"subheadings":[""],"page_sections":[""],"blog_topics":[""]},
 "summary":"2-3 sentences"}`

export async function listen(brandId: string, args: Json = {}) {
  const b = await loadBrandContext(brandId)
  if (!b) return { error: 'Brand not found.' }
  const store = await readStore(brandId)
  const last = store.months?.at(-1)
  const fresh = args.fresh === true
  const pasted = (Array.isArray(args.pasted) ? args.pasted : typeof args.pasted === 'string' ? [args.pasted] : []).map(String).map(tidy).filter(t => t.length > 10).slice(0, 50)
  if (last && !fresh && !pasted.length && Date.now() - Date.parse(last.at) < CACHE_DAYS * DAY) {
    return { ...last.answer, from_cache: `Saved ${last.at.slice(0, 10)} (kept ${CACHE_DAYS} days; pass fresh: true to listen again, which costs again).` }
  }

  const search = await readSearchData(brandId).catch(() => null)
  const country = String(args.country ?? search?.settings.country ?? defaultCountry(b.websiteUrl)).toUpperCase()
  const isBrand = brandMatcher({ name: b.name, domain: b.domain })
  const meter = newMeter()

  // What to listen for: given topics, else problem phrases written from the brand (once a month)
  let seeds = (Array.isArray(args.topics) ? args.topics.map(String) : []).map(s => s.trim()).filter(Boolean).slice(0, 3)
  if (!seeds.length) {
    const raw = await withAIContext({ brandId, moduleType: 'customer-language', websiteUrl: b.websiteUrl }, () => callAI({
      system: 'Write 3 short searches (3-6 words) a buyer of this brand would type when they have the PROBLEM it solves, in their words, not the product category or the brand. JSON array of strings only.',
      prompt: brandBlock(b), maxTokens: 200, model: MODEL, feature: 'customer-language',
    })).catch(() => '')
    seeds = (parseJsonLoose<string[]>(raw, 'array') ?? []).map(String).filter(Boolean).slice(0, 3)
    if (!seeds.length) seeds = (search?.settings.seeds ?? []).slice(0, 3)
    if (!seeds.length && b.keywords) seeds = b.keywords.split(/[,;\n]/).map(s => s.trim()).filter(Boolean).slice(0, 3)
    if (!seeds.length) return { error: 'No topics to listen for. Pass topics, e.g. ["no time to post on social media"].' }
  }

  const home = /^https?:\/\//.test(b.websiteUrl) ? b.websiteUrl : `https://${b.domain}`
  const [gscR, replies, hn, google, homePage] = await Promise.all([
    fromSearchConsole(brandId, isBrand),
    fromReplies(brandId),
    fromHackerNews(seeds),
    fromGoogle(seeds, country, meter),
    pageFacts(home),
  ])
  const savedReviews = store.reviews && store.reviews.status !== 'RUNNING' && Date.now() - Date.parse(store.reviews.at) < CACHE_DAYS * DAY ? store.reviews.items : []
  const snippets: Snippet[] = [
    ...pasted.map(t => ({ source: 'Pasted in', text: cut(t, 1500) })),
    ...replies.items, ...savedReviews, ...google.items, ...hn.items, ...gscR.items,
  ]
  const bySource: Record<string, number> = {}
  for (const s of snippets) bySource[s.source] = (bySource[s.source] ?? 0) + 1
  const problems = Object.fromEntries(Object.entries({
    search_console: gscR.error, email_replies: replies.error, hacker_news: hn.error, google: google.errors[0],
  }).filter(([, v]) => v))

  if (snippets.length < 5) {
    await addUsage(brandId, meter, 'Claude (MCP)').catch(() => {})
    return { error: 'Too little was found to say how buyers talk. Pass topics in other words, paste messages (pasted), or read competitor reviews first (action "reviews").', seeds, found: bySource, ...(Object.keys(problems).length ? { not_available: problems } : {}) }
  }

  // The site's own wording, to find the buyers' words it never uses
  const pages = (search?.pages ?? []).slice(0, 8)
  const siteText = [
    homePage.title, homePage.meta, ...homePage.h1, ...homePage.h2.slice(0, 12), homePage.first_100_words,
    ...pages.flatMap(p => [p.title, p.h1, ...p.h2s.slice(0, 5)]),
  ].filter(Boolean).join(' | ')
  const sitePart = [
    `Homepage: title "${homePage.title}" · H1 "${homePage.h1.join(' / ')}" · description "${homePage.meta}"`,
    homePage.h2.length ? `Homepage H2s: ${homePage.h2.slice(0, 12).join(' | ')}` : '',
    ...pages.map(p => `${p.path}: title "${p.title}" · H1 "${p.h1}"`),
  ].filter(Boolean).join('\n')

  // Numbered snippets, capped so the prompt stays small
  let budget = 28_000
  const used: Snippet[] = []
  for (const s of snippets) {
    const line = `${s.source}${s.where ? ` (${s.where})` : ''}: ${s.text}`
    if (line.length > budget) continue
    budget -= line.length
    used.push(s)
  }
  const prompt = [
    brandBlock(b), '', 'THE SITE\'S OWN WORDING', sitePart, '',
    `WHAT BUYERS WROTE OR SEARCHED (${used.length} snippets, listening for: ${seeds.join('; ')})`,
    ...used.map((s, i) => `[${i + 1}] ${s.source}${s.where ? ` (${s.where})` : ''}: ${s.text}`),
  ].join('\n')

  const raw = await withAIContext({ brandId, moduleType: 'customer-language', websiteUrl: b.websiteUrl }, () => callAI({ system: SYSTEM, prompt, maxTokens: 4000, model: MODEL, feature: 'customer-language' })).catch(e => `ERROR ${e instanceof Error ? e.message : e}`)
  type Out = { groups?: { problem: string; phrases?: { phrase: string; count: number }[]; count?: number; sources?: string[]; quotes?: { text: string; snippet?: number }[] }[]; words_you_dont_use?: Json[]; use_them?: Json; summary?: string }
  const ai = parseJsonLoose<Out>(raw, 'object')
  if (!ai?.groups) {
    await addUsage(brandId, meter, 'Claude (MCP)').catch(() => {})
    return { error: `The AI couldn't group what was found${raw.startsWith('ERROR') ? ` (${raw.slice(6, 200)})` : ''}. Try again.`, found: bySource }
  }

  // Keep only quotes copied from a snippet, with the snippet's link and source
  let dropped = 0
  const groups = ai.groups.map(g => ({
    problem: g.problem,
    count: g.count ?? 0,
    sources: g.sources ?? [],
    phrases: (g.phrases ?? []).slice(0, 8),
    quotes: (g.quotes ?? []).flatMap(q => {
      const s = q.snippet ? used[q.snippet - 1] : undefined
      const from = s && quoteIsReal(q.text, s.text) ? s : used.find(x => quoteIsReal(q.text, x.text))
      if (!from) { dropped++; return [] }
      return [{ text: q.text, source: from.source, ...(from.where ? { where: from.where } : {}), ...(from.url ? { url: from.url } : {}) }]
    }).slice(0, 3),
  }))
  const phrases: MonthPhrase[] = groups.flatMap(g => g.phrases.map(p => ({ phrase: p.phrase, count: p.count, problem: g.problem })))
  const changes = compareMonths(phrases, last?.phrases ?? null)

  const answer: Json = {
    listened_for: seeds,
    found: bySource,
    summary: ai.summary,
    groups,
    words_you_dont_use: ai.words_you_dont_use ?? [],
    buyer_words_missing_from_site: wordsMissing(phrases.map(p => p.phrase), siteText),
    use_them: ai.use_them ?? {},
    vs_last_month: changes
      ? { compared_with: last!.at.slice(0, 10), new: changes.new.slice(0, 10), growing: changes.growing.slice(0, 10), fading: changes.fading.slice(0, 10) }
      : 'First listen saved; next month shows new, growing and fading phrases.',
    ...(dropped ? { quotes_left_out: `${dropped} quote(s) the AI gave weren't found word for word in what was collected, so they were left out.` } : {}),
    ...(Object.keys(problems).length ? { not_available: problems } : {}),
    can_not_read: 'Slack groups, Discord and private communities can\'t be read automatically: paste messages in with pasted.',
    next: 'Blog topics can go to blog_keywords (action evaluate with keywords) to check searches and difficulty.',
    cost_usd: Math.round(meter.dataforseo * 10000) / 10000,
  }
  await addUsage(brandId, meter, 'Claude (MCP)').catch(() => {})
  await writeStore(brandId, s => { s.months = [...(s.months ?? []), { at: new Date().toISOString(), seeds, phrases, answer }] })
  return answer
}

// ── The tool ─────────────────────────────────────────────────────────────────

export async function customerLanguage(brandId: string, args: Json) {
  const action = String(args.action ?? 'listen')
  if (action === 'listen') return listen(brandId, args)
  if (action === 'reviews') return reviews(brandId, args)
  if (action === 'history') {
    const s = await readStore(brandId)
    return {
      months: (s.months ?? []).slice().reverse().map(m => ({ at: m.at.slice(0, 10), listened_for: m.seeds, top_phrases: m.phrases.sort((a, b) => b.count - a.count).slice(0, 10) })),
      reviews_saved: s.reviews ? { at: s.reviews.at.slice(0, 10), from: s.reviews.urls, count: s.reviews.items.length, status: s.reviews.status } : null,
    }
  }
  return { error: 'action must be listen, reviews or history.' }
}
